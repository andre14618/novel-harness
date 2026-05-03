#!/usr/bin/env bun
/**
 * Arm B preflight runner per `docs/charters/arm-b-detector-preflight.md`
 * §6-§7. For each beat in an archived baseline:
 *
 *   1. Arm A = byte-replay of stored `system_prompt` + `user_prompt`
 *      (no `buildBeatContext` re-execution; §6 Arm A replay contract).
 *   2. Arm B = `insertEnrichedSection(armA_sections, ENRICHED CONTEXT block)`
 *      where the block is produced by `buildEnrichedContext` from archived
 *      DB snapshots.
 *   3. Writer call for each arm with `noRetries=true` so sampling noise
 *      between arms isn't asymmetrically smoothed (§4.7 experiment
 *      discipline, inherited from conditioning-floor Codex round 6).
 *   4. `halluc-ungrounded` detector on each prose output.
 *   5. Insert per-arm `eval_results` row with `cell_label='A-baseline'`
 *      or `'B-enriched'` and the detector output in `actual_label_json`.
 *
 * The charter's dynamic stop rule (≥8 adjudicable fires/arm OR 20-beat
 * cap) is implemented as: run all beats in the baseline sequentially
 * (caller sets pool size ≤20). The adjudicable-fires count is decided
 * POST-HOC by the adjudication helper + final-verdict script — this
 * runner writes raw detector output and the adjudicator populates
 * `expected_label_json` later.
 *
 * Usage:
 *   bun scripts/evals/run-arm-b-preflight.ts \
 *     --baseline output/evals/arm-b-preflight-baseline.json \
 *     --set-name arm-b-preflight-v1 \
 *     --experiment-id <id>
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import db from "../../../src/db/connection"
import { getChapterOutline } from "../../../src/db/outlines"
import { getCharacters, getWorldBible } from "../../../src/db/world"
import { getCharacterStatesAtChapter } from "../../../src/db/character-states"
import { getFactsUpToChapter } from "../../../src/db/facts"
import { createTuningExperiment, concludeExperiment } from "../../../src/db/ops"
import { initExperimentRun } from "../../../src/logger"
import { executeAndLog } from "../../../src/llm"
import { checkHallucUngrounded } from "../../../src/agents/halluc-ungrounded"
import {
  buildEnrichedContext,
  insertEnrichedSection,
} from "../../../src/agents/writer/enriched-context"
import { recoverSections } from "./beat-prompt-sections"
import { getTokenCost } from "../../../src/models/registry"
import type { LLMRequest } from "../../../src/transport"
import type { ProviderName } from "../../../src/models/registry"

// ── Types ──────────────────────────────────────────────────────────────

interface ArchivedBaseline {
  created_at: string
  novel_id: string
  beats: Array<{
    llm_call_id: number
    chapter: number
    beat_index: number
    sections: string[]
    signature: Array<{ header: string; byteLength: number; sha256: string }>
    system_prompt: string
    envelope: {
      model: string
      provider: string
      temperature: number | null
      maxTokens: number | null
      responseFormat: unknown
    }
  }>
}

interface PerBeatResult {
  llm_call_id: number
  chapter: number
  beat_index: number
  arm: "A-baseline" | "B-enriched"
  prose: string
  wordCount: number
  detectorPass: boolean
  detectorIssues: string[]
  enrichedBytes: number | null  // null for A
  writerCost: number
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────

function buildLLMRequest(
  systemPrompt: string,
  userPrompt: string,
  envelope: ArchivedBaseline["beats"][0]["envelope"],
  callerId: string,
): LLMRequest {
  return {
    systemPrompt,
    userPrompt,
    model: envelope.model,
    provider: envelope.provider as ProviderName,
    temperature: envelope.temperature ?? 0.8,
    maxTokens: envelope.maxTokens ?? 4000,
    responseFormat: envelope.responseFormat as { type: string } | undefined,
    noRetries: true,  // experiment discipline — no asymmetric retry smoothing
    callerId,
  }
}

async function runDetector(
  prose: string,
  novelId: string,
  chapter: number,
  beatIndex: number,
  arm: "A" | "B",
): Promise<{ pass: boolean; issues: string[] }> {
  // Need beat + outline + characters + world bible for the checker's
  // grounded surface. Pull them fresh — cheap since they're small.
  const outline = await getChapterOutline(novelId, chapter)
  const beat = outline.scenes[beatIndex]
  if (!beat) throw new Error(`no beat at outline.scenes[${beatIndex}]`)
  const characters = await getCharacters(novelId)
  const worldBible = await getWorldBible(novelId)
  const prevBeat = beatIndex > 0 ? outline.scenes[beatIndex - 1] : undefined

  const result = await checkHallucUngrounded(
    prose,
    beat,
    outline,
    characters,
    worldBible,
    // tags — tag the detector calls so they're queryable by arm
    {
      novelId,
      chapter,
      beatIndex,
      attempt: arm === "A" ? 1 : 2,  // differentiate in llm_calls.attempt
    },
    { prevBeat },
  )
  return result
}

async function persistResult(
  experimentId: number | null,
  setName: string,
  beatId: string,
  cellLabel: PerBeatResult["arm"],
  prose: string,
  wordCount: number,
  detectorPass: boolean,
  detectorIssues: string[],
  adapterUri: string,
  errorText: string | null,
): Promise<void> {
  await db`
    INSERT INTO eval_results (
      experiment_id, set_name, beat_id, adapter_uri, cell_label,
      generated_prose, word_count,
      actual_label_json, error_text
    ) VALUES (
      ${experimentId}, ${setName}, ${beatId}, ${adapterUri}, ${cellLabel},
      ${prose}, ${wordCount},
      ${JSON.stringify({ pass: detectorPass, issues: detectorIssues })},
      ${errorText}
    )
  `
}

// ── Core per-beat flow ────────────────────────────────────────────────

async function runBeat(
  beatBaseline: ArchivedBaseline["beats"][0],
  novelId: string,
  setName: string,
  experimentId: number | null,
): Promise<{ armA: PerBeatResult; armB: PerBeatResult; enrichedBytes: number }> {
  const { chapter, beat_index, sections, system_prompt, envelope, llm_call_id } = beatBaseline
  const beatId = `${novelId}-ch${chapter}-b${beat_index}-call${llm_call_id}`
  console.log(`  beat ${beatId}`)

  // Pull DB snapshots for enriched-context builder
  const outline = await getChapterOutline(novelId, chapter)
  const beat = outline.scenes[beat_index]
  if (!beat) throw new Error(`no beat at outline.scenes[${beat_index}] for chapter ${chapter}`)
  const characters = await getCharacters(novelId)
  const characterStates = await getCharacterStatesAtChapter(novelId, chapter)
  const worldBible = await getWorldBible(novelId)
  const priorChapterFacts = chapter > 1 ? await getFactsUpToChapter(novelId, chapter - 1) : []

  const enriched = buildEnrichedContext({
    beat, outline, characters, characterStates, worldBible,
    priorChapterFacts, chapterNumber: chapter,
  })

  // Construct Arm B sections
  const armBSections = insertEnrichedSection(sections, enriched.block)
  const armBUserPrompt = armBSections.join("\n\n")

  // Structural sanity-check before spending writer budget
  const armBRecovered = recoverSections(armBUserPrompt)
  if (armBRecovered.length !== armBSections.length + 0 /* round-trip */) {
    // Note: armBSections is the source of truth; we compare round-trip
    // of the joined prompt. If recovery disagrees with our construction,
    // the parser is broken on our new section.
    console.warn(`  parity warning beat ${beatId}: armBRecovered=${armBRecovered.length} armBSections=${armBSections.length}`)
  }

  const adapterA = envelope.model
  const adapterB = envelope.model  // same writer for both arms

  // Arm A writer call — byte-replay stored prompts
  const requestA = buildLLMRequest(system_prompt, sections.join("\n\n"), envelope, "preflight-arm-a")
  let armAResult: PerBeatResult = {
    llm_call_id, chapter, beat_index,
    arm: "A-baseline",
    prose: "",
    wordCount: 0,
    detectorPass: false,
    detectorIssues: [],
    enrichedBytes: null,
    writerCost: 0,
  }
  try {
    const respA = await executeAndLog(
      requestA,
      novelId,
      "preflight-arm-a-writer",
      { chapter, beatIndex: beat_index, attempt: 1 },
      { meta: { preflight: "arm-b-detector-preflight", arm: "A-baseline", beat_id: beatId } },
    )
    armAResult.prose = respA.content
    armAResult.wordCount = respA.content.trim().split(/\s+/).filter(Boolean).length
    armAResult.writerCost = getTokenCost(
      envelope.provider as ProviderName,
      envelope.model,
      respA.usage.prompt_tokens,
      respA.usage.completion_tokens,
      respA.usage.cached_tokens,
    )
    const detA = await runDetector(respA.content, novelId, chapter, beat_index, "A")
    armAResult.detectorPass = detA.pass
    armAResult.detectorIssues = detA.issues
  } catch (e) {
    armAResult.error = e instanceof Error ? e.message : String(e)
    console.warn(`    arm A FAILED: ${armAResult.error}`)
  }
  await persistResult(
    experimentId, setName, beatId, "A-baseline",
    armAResult.prose, armAResult.wordCount,
    armAResult.detectorPass, armAResult.detectorIssues,
    adapterA, armAResult.error ?? null,
  )

  // Arm B writer call — insert ENRICHED CONTEXT
  const requestB = buildLLMRequest(system_prompt, armBUserPrompt, envelope, "preflight-arm-b")
  let armBResult: PerBeatResult = {
    llm_call_id, chapter, beat_index,
    arm: "B-enriched",
    prose: "",
    wordCount: 0,
    detectorPass: false,
    detectorIssues: [],
    enrichedBytes: enriched.block.length,
    writerCost: 0,
  }
  try {
    const respB = await executeAndLog(
      requestB,
      novelId,
      "preflight-arm-b-writer",
      { chapter, beatIndex: beat_index, attempt: 2 },
      { meta: { preflight: "arm-b-detector-preflight", arm: "B-enriched", beat_id: beatId, enriched_bytes: enriched.block.length, sub_block_bytes: enriched.subBlockBytes } },
    )
    armBResult.prose = respB.content
    armBResult.wordCount = respB.content.trim().split(/\s+/).filter(Boolean).length
    armBResult.writerCost = getTokenCost(
      envelope.provider as ProviderName,
      envelope.model,
      respB.usage.prompt_tokens,
      respB.usage.completion_tokens,
      respB.usage.cached_tokens,
    )
    const detB = await runDetector(respB.content, novelId, chapter, beat_index, "B")
    armBResult.detectorPass = detB.pass
    armBResult.detectorIssues = detB.issues
  } catch (e) {
    armBResult.error = e instanceof Error ? e.message : String(e)
    console.warn(`    arm B FAILED: ${armBResult.error}`)
  }
  await persistResult(
    experimentId, setName, beatId, "B-enriched",
    armBResult.prose, armBResult.wordCount,
    armBResult.detectorPass, armBResult.detectorIssues,
    adapterB, armBResult.error ?? null,
  )

  const firedA = !armAResult.detectorPass && !armAResult.error
  const firedB = !armBResult.detectorPass && !armBResult.error
  console.log(`    A: ${armAResult.wordCount}w ${firedA ? "FIRE" : "pass"} ${armAResult.error ? "(err)" : ""}`)
  console.log(`    B: ${armBResult.wordCount}w ${firedB ? "FIRE" : "pass"} enrichedBytes=${enriched.block.length}`)

  return { armA: armAResult, armB: armBResult, enrichedBytes: enriched.block.length }
}

// ── Main ──────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  return {
    baseline: get("--baseline"),
    setName: get("--set-name") ?? `arm-b-preflight-${Date.now()}`,
    experimentId: get("--experiment-id"),
    createExperiment: process.argv.includes("--create-experiment"),
  }
}

async function main() {
  const args = parseArgs()
  if (!args.baseline) {
    console.error("usage: --baseline <path> [--set-name <name>] [--experiment-id <id> | --create-experiment]")
    process.exit(2)
  }

  const baselineRaw = await readFile(path.resolve(args.baseline), "utf8")
  const baseline = JSON.parse(baselineRaw) as ArchivedBaseline
  console.log(`[preflight] baseline: ${args.baseline} (${baseline.beats.length} beats on ${baseline.novel_id})`)
  console.log(`[preflight] set_name: ${args.setName}`)

  let experimentId: number | null = null
  if (args.experimentId) {
    experimentId = parseInt(args.experimentId, 10)
    console.log(`[preflight] linked to experiment #${experimentId}`)
  } else if (args.createExperiment) {
    experimentId = await createTuningExperiment(
      "checker_eval",
      `Arm B detector preflight — ${args.setName}. Calibration preflight for replay-ladder-v1. Measures whether halluc-ungrounded detector precision holds under enriched-context distribution shift on Salvatore-routed fantasy prose. Charter: docs/charters/arm-b-detector-preflight.md`,
      {
        set_name: args.setName,
        baseline_path: args.baseline,
        novel_id: baseline.novel_id,
        beat_count: baseline.beats.length,
        charter: "docs/charters/arm-b-detector-preflight.md",
      },
    )
    console.log(`[preflight] created experiment #${experimentId}`)
  }

  // Persist llm_calls per Codex consult `a67d200f4fe05168a` (2026-04-21).
  if (experimentId !== null) {
    const runId = await initExperimentRun(experimentId, "eval", args.setName, `arm-b-preflight ${args.setName}`)
    console.log(`[preflight] initialized run #${runId} (llm_calls persistence enabled)`)
  }

  const allResults: Array<{ armA: PerBeatResult; armB: PerBeatResult; enrichedBytes: number }> = []
  let totalCost = 0

  for (const beatBaseline of baseline.beats) {
    try {
      const r = await runBeat(beatBaseline, baseline.novel_id, args.setName, experimentId)
      allResults.push(r)
      totalCost += r.armA.writerCost + r.armB.writerCost
    } catch (e) {
      console.warn(`  beat ${beatBaseline.llm_call_id} SKIPPED: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Summary
  const firesA = allResults.filter(r => !r.armA.detectorPass && !r.armA.error).length
  const firesB = allResults.filter(r => !r.armB.detectorPass && !r.armB.error).length
  const errorsA = allResults.filter(r => r.armA.error).length
  const errorsB = allResults.filter(r => r.armB.error).length
  console.log("")
  console.log(`[preflight] completed ${allResults.length}/${baseline.beats.length} beats`)
  console.log(`  Arm A (baseline): ${firesA} fires, ${errorsA} errors`)
  console.log(`  Arm B (enriched): ${firesB} fires, ${errorsB} errors`)
  console.log(`  Total writer cost: $${totalCost.toFixed(4)}`)
  console.log(`  Avg Arm B enriched block: ${Math.round(allResults.reduce((a, r) => a + r.enrichedBytes, 0) / Math.max(allResults.length, 1))} bytes`)

  // Next-step guidance per charter §7
  console.log("")
  if (firesA < 8 || firesB < 8) {
    console.log(`[preflight] Raw fires below the 8-per-arm floor on at least one arm.`)
    console.log(`  → Run adjudication anyway to get UNCLEAR excluded count; final verdict may still be INCONCLUSIVE per §3.`)
  } else {
    console.log(`[preflight] Both arms have ≥8 raw fires. Adjudicate to get adjudicable (UNCLEAR-excluded) count.`)
  }
  console.log(`  Next: bun scripts/evals/preflight-arm-b-adjudicate.ts --set-name ${args.setName}`)

  if (experimentId !== null && args.createExperiment) {
    await concludeExperiment(
      experimentId,
      `Generation + detection phase complete. Beats: ${allResults.length}/${baseline.beats.length}. Arm A fires: ${firesA}. Arm B fires: ${firesB}. Writer cost: $${totalCost.toFixed(4)}. Adjudication phase pending — run scripts/evals/preflight-arm-b-adjudicate.ts and append final verdict to this experiment's conclusion when adjudication completes.`,
    )
  }
}

if (import.meta.main) {
  main().catch(e => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1) })
}
