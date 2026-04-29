#!/usr/bin/env bun
/**
 * Arm D writer-upgrade runner per `docs/charters/arm-d-writer-upgrade.md`
 * (revision 3). Single-variable A/B: same stored production prompts,
 * different writer (Salvatore v4 LoRA vs DeepSeek V3.2 base).
 *
 * Arm A: fresh generation with Salvatore v4 voice LoRA (re-generates
 *        today so the adjudicator sees unfamiliar prose vs arm-b).
 * Arm D: fresh generation with DeepSeek V3.2 base. Prompt bytes
 *        identical to Arm A's; only `model`/`provider` envelope
 *        fields differ.
 *
 * Both generations use `noRetries=true` per experiment-discipline
 * inherited from the preflight lineage. Detector fire-rate runs as
 * secondary telemetry (primary oracle is human pairwise, not
 * detector precision).
 *
 * Persists to `eval_results` under one `set_name` with `cell_label`
 * discriminating the two arms: `A-salvatore-v4` and `D-deepseek-v3.2`.
 *
 * Usage:
 *   bun scripts/evals/run-arm-d-upgrade.ts \
 *     --baseline output/evals/arm-b-direct-pairwise-baseline.json \
 *     --set-name arm-d-writer-upgrade-v1 \
 *     --create-experiment
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import db from "../../src/db/connection"
import { getChapterOutline } from "../../src/db/outlines"
import { getCharacters, getWorldBible } from "../../src/db/world"
import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"
import { initExperimentRun } from "../../src/logger"
import { executeAndLog } from "../../src/llm"
import { checkHallucUngrounded } from "../../src/agents/halluc-ungrounded"
import { getTokenCost } from "../../src/models/registry"
import type { LLMRequest } from "../../src/transport"
import type { ProviderName } from "../../src/models/registry"

// ── Arm definitions ────────────────────────────────────────────────────

interface ArmSpec {
  cell_label: "A-salvatore-v4" | "D-deepseek-v3.2"
  model: string
  provider: ProviderName
}

const ARMS: ArmSpec[] = [
  {
    cell_label: "A-salvatore-v4",
    // Pulled from the archived baseline at runtime — see selectArmA()
    model: "",
    provider: "wandb" as ProviderName,
  },
  {
    cell_label: "D-deepseek-v3.2",
    model: "deepseek-v4-flash",
    provider: "deepseek" as ProviderName,
  },
]

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

// ── Per-beat generation ────────────────────────────────────────────────

async function generateArm(
  arm: ArmSpec,
  beatBaseline: ArchivedBaseline["beats"][0],
  novelId: string,
  setName: string,
  experimentId: number | null,
): Promise<{ cost: number; prose: string; wordCount: number; fired: boolean; error?: string }> {
  const { chapter, beat_index, sections, system_prompt, envelope } = beatBaseline
  const userPrompt = sections.join("\n\n")
  const beatId = `${novelId}-ch${chapter}-b${beat_index}-call${beatBaseline.llm_call_id}`

  // Arm A inherits envelope.model from the archived row (fresh
  // regeneration of the SAME writer). Arm D overrides model/provider.
  const effectiveModel = arm.cell_label === "A-salvatore-v4" ? envelope.model : arm.model
  const effectiveProvider = arm.cell_label === "A-salvatore-v4"
    ? (envelope.provider as ProviderName)
    : arm.provider

  const request: LLMRequest = {
    systemPrompt: system_prompt,
    userPrompt,
    model: effectiveModel,
    provider: effectiveProvider,
    temperature: envelope.temperature ?? 0.8,
    maxTokens: envelope.maxTokens ?? 4000,
    responseFormat: envelope.responseFormat as { type: string } | undefined,
    noRetries: true,
    callerId: `arm-d-upgrade-${arm.cell_label}`,
  }

  try {
    const resp = await executeAndLog(
      request,
      novelId,
      `arm-d-upgrade-${arm.cell_label}-writer`,
      { chapter, beatIndex: beat_index, attempt: arm.cell_label === "A-salvatore-v4" ? 1 : 2 },
      { meta: { charter: "arm-d-writer-upgrade", arm: arm.cell_label, beat_id: beatId } },
    )

    const wordCount = resp.content.trim().split(/\s+/).filter(Boolean).length
    const cost = getTokenCost(
      effectiveProvider, effectiveModel,
      resp.usage.prompt_tokens, resp.usage.completion_tokens, resp.usage.cached_tokens,
    )

    // Secondary telemetry: run the detector. Not gate-blocking.
    let fired = false
    try {
      const outline = await getChapterOutline(novelId, chapter)
      const beat = outline.scenes[beat_index]
      if (beat) {
        const characters = await getCharacters(novelId)
        const worldBible = await getWorldBible(novelId)
        const prevBeat = beat_index > 0 ? outline.scenes[beat_index - 1] : undefined
        const result = await checkHallucUngrounded(
          resp.content, beat, outline, characters, worldBible,
          { novelId, chapter, beatIndex: beat_index, attempt: arm.cell_label === "A-salvatore-v4" ? 1 : 2 },
          { prevBeat },
        )
        fired = !result.pass
      }
    } catch { /* detector failure is telemetry loss, not run failure */ }

    await db`
      INSERT INTO eval_results (
        experiment_id, set_name, beat_id, adapter_uri, cell_label,
        generated_prose, word_count,
        actual_label_json, error_text
      ) VALUES (
        ${experimentId}, ${setName}, ${beatId}, ${effectiveModel}, ${arm.cell_label},
        ${resp.content}, ${wordCount},
        ${JSON.stringify({ pass: !fired, fired_from_telemetry: true })}, ${null}
      )
    `

    return { cost, prose: resp.content, wordCount, fired }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`    ${arm.cell_label} FAIL: ${msg}`)
    await db`
      INSERT INTO eval_results (
        experiment_id, set_name, beat_id, adapter_uri, cell_label,
        generated_prose, error_text
      ) VALUES (
        ${experimentId}, ${setName}, ${beatId}, ${effectiveModel}, ${arm.cell_label},
        ${""}, ${msg}
      )
    `
    return { cost: 0, prose: "", wordCount: 0, fired: false, error: msg }
  }
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
    setName: get("--set-name") ?? `arm-d-upgrade-${Date.now()}`,
    experimentId: get("--experiment-id"),
    createExperiment: argv.includes("--create-experiment"),
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
  console.log(`[arm-d] baseline: ${args.baseline} (${baseline.beats.length} beats on ${baseline.novel_id})`)
  console.log(`[arm-d] set_name: ${args.setName}`)
  console.log(`[arm-d] arms: ${ARMS.map(a => a.cell_label).join(", ")}`)

  let experimentId: number | null = null
  if (args.experimentId) experimentId = parseInt(args.experimentId, 10)
  else if (args.createExperiment) {
    experimentId = await createTuningExperiment(
      "checker_eval",
      `Arm D writer-upgrade — ${args.setName}. Single-variable A/B: Salvatore v4 LoRA vs DeepSeek V3.2 on the harness's operational prompt. Forcing function for the LoRA-track-switch decision. Charter: docs/charters/arm-d-writer-upgrade.md`,
      {
        set_name: args.setName,
        baseline_path: args.baseline,
        novel_id: baseline.novel_id,
        beat_count: baseline.beats.length,
        arms: ARMS.map(a => ({ cell_label: a.cell_label, model: a.model || "(from baseline)", provider: a.provider })),
        charter: "docs/charters/arm-d-writer-upgrade.md",
      },
    )
    console.log(`[arm-d] created experiment #${experimentId}`)
  }

  // Persist llm_calls per Codex consult `a67d200f4fe05168a` (2026-04-21).
  if (experimentId !== null) {
    const runId = await initExperimentRun(experimentId, "eval", args.setName, `arm-d-writer-upgrade ${args.setName}`)
    console.log(`[arm-d] initialized run #${runId} (llm_calls persistence enabled)`)
  }

  let totalCost = 0
  let armAFires = 0, armDFires = 0
  let armAErrors = 0, armDErrors = 0
  let beatsDone = 0

  for (const beatBaseline of baseline.beats) {
    console.log(`  beat ch${beatBaseline.chapter}b${beatBaseline.beat_index}`)
    for (const arm of ARMS) {
      const r = await generateArm(arm, beatBaseline, baseline.novel_id, args.setName, experimentId)
      totalCost += r.cost
      if (arm.cell_label === "A-salvatore-v4") {
        if (r.error) armAErrors++
        else if (r.fired) armAFires++
        console.log(`    A: ${r.wordCount}w ${r.fired ? "FIRE" : "pass"}${r.error ? " (err)" : ""}`)
      } else {
        if (r.error) armDErrors++
        else if (r.fired) armDFires++
        console.log(`    D: ${r.wordCount}w ${r.fired ? "FIRE" : "pass"}${r.error ? " (err)" : ""}`)
      }
    }
    beatsDone++
  }

  console.log("")
  console.log(`[arm-d] completed ${beatsDone}/${baseline.beats.length} beats`)
  console.log(`  Arm A (Salvatore v4): ${armAFires} fires, ${armAErrors} errors`)
  console.log(`  Arm D (DeepSeek V3.2): ${armDFires} fires, ${armDErrors} errors`)
  console.log(`  Total writer cost: $${totalCost.toFixed(4)}`)
  console.log("")
  console.log(`Next: bun scripts/evals/arm-b-pairwise.ts --emit --set-name ${args.setName} --out output/evals/pairwise/arm-d-v1`)
  console.log(`(note: the pairwise emitter pairs A vs B by default; for Arm A-vs-D it already reads cell_label pairs from eval_results — works directly with the A-salvatore-v4 / D-deepseek-v3.2 labels.)`)

  if (experimentId !== null && args.createExperiment) {
    await concludeExperiment(
      experimentId,
      `Generation phase complete. Beats: ${beatsDone}/${baseline.beats.length}. Arm A fires: ${armAFires}/${beatsDone}. Arm D fires: ${armDFires}/${beatsDone}. Writer cost: $${totalCost.toFixed(4)}. Pairwise adjudication pending.`,
    )
  }
}

if (import.meta.main) {
  main().catch(e => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1) })
}
