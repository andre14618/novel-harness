#!/usr/bin/env bun
/**
 * Voice-shaping ablation runner per
 * `docs/charters/voice-shaping-ablation-v1.md` (revision 2).
 *
 * Generates 4 DeepSeek arms on the same 20-beat pool:
 *   - D0-bare              : DeepSeek + byte-equal baseline prompt
 *   - D1-style-guide       : D0 + VOICE STYLE GUIDE system-prompt addition
 *   - D2-few-shot          : D0 + VOICE REFERENCE PASSAGES (actual corpus)
 *   - D3-char-directives   : D0 with CHARACTERS section replaced by
 *                            CHARACTER VOICE DIRECTIVES block
 *
 * Salvatore v4 anchor arm `S` is NOT regenerated — reuses
 * eval_results from arm-d-writer-upgrade-v1 cell `A-salvatore-v4`.
 * Mapped into analysis at aggregation time.
 *
 * Usage:
 *   bun scripts/evals/run-voice-shaping-ablation.ts \
 *     --baseline output/evals/arm-b-direct-pairwise-baseline.json \
 *     --set-name voice-shaping-ablation-v1 \
 *     --create-experiment
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import db from "../../src/db/connection"
import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"
import { initExperimentRun } from "../../src/logger"
import { executeAndLog } from "../../src/llm"
import { getTokenCost } from "../../src/models/registry"
import { getAblationArms, type ArmConfig } from "../../src/agents/writer/voice-shaping-prompts"
import type { LLMRequest } from "../../src/transport"
import type { ProviderName } from "../../src/models/registry"

const DEEPSEEK_MODEL = "deepseek-chat"
const DEEPSEEK_PROVIDER: ProviderName = "deepseek"

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

// ── Parity assertion helpers (inline per charter §5) ───────────────

/**
 * D1/D2: assert systemPrompt parity — the only allowed delta is a
 * named block appended via `\n\n` separator. D0 baseline systemPrompt
 * must be a prefix.
 */
function assertSystemPromptDelta(
  baselineSys: string,
  armSys: string,
  armLabel: string,
): void {
  if (armSys === baselineSys) return  // D0 case
  if (!armSys.startsWith(baselineSys)) {
    throw new Error(`[parity] arm ${armLabel} system_prompt does not prefix-match baseline; structural drift detected`)
  }
  const tail = armSys.slice(baselineSys.length)
  if (!tail.startsWith("\n\n")) {
    throw new Error(`[parity] arm ${armLabel} system_prompt addition not separated by \\n\\n`)
  }
  // Verify the addition contains a single section (starts with a named block)
  const trimmed = tail.trim()
  const firstLine = trimmed.split("\n")[0]
  if (!/^[A-Z][A-Z\s]+:/.test(firstLine)) {
    throw new Error(`[parity] arm ${armLabel} system_prompt addition doesn't start with an uppercase-named block header: ${JSON.stringify(firstLine)}`)
  }
}

// ── Per-arm per-beat generation ─────────────────────────────────────

interface GenResult {
  cell_label: string
  prose: string
  wordCount: number
  cost: number
  error?: string
}

async function generateArm(
  arm: ArmConfig,
  beat: ArchivedBaseline["beats"][0],
  novelId: string,
  setName: string,
  experimentId: number | null,
): Promise<GenResult> {
  const beatId = `${novelId}-ch${beat.chapter}-b${beat.beat_index}-call${beat.llm_call_id}`
  const baselineSystemPrompt = beat.system_prompt
  const baselineUserPrompt = beat.sections.join("\n\n")

  const armSystemPrompt = baselineSystemPrompt + arm.systemPromptAddition
  const armUserPrompt = arm.transformUserPrompt
    ? arm.transformUserPrompt(baselineUserPrompt)
    : baselineUserPrompt

  // Parity assertions
  assertSystemPromptDelta(baselineSystemPrompt, armSystemPrompt, arm.cell_label)
  // For D3, verify user_prompt actually changed (CHARACTER VOICE DIRECTIVES present)
  if (arm.cell_label === "D3-char-directives" && armUserPrompt === baselineUserPrompt) {
    console.warn(`[parity] warn ${arm.cell_label} ${beatId}: user_prompt unchanged — no CHARACTERS section to transform?`)
  }

  const request: LLMRequest = {
    systemPrompt: armSystemPrompt,
    userPrompt: armUserPrompt,
    model: DEEPSEEK_MODEL,
    provider: DEEPSEEK_PROVIDER,
    temperature: beat.envelope.temperature ?? 0.8,
    maxTokens: beat.envelope.maxTokens ?? 4000,
    responseFormat: beat.envelope.responseFormat as { type: string } | undefined,
    noRetries: true,
    callerId: arm.callerId,
  }

  try {
    const resp = await executeAndLog(
      request,
      novelId,
      `voice-shaping-${arm.cell_label}-writer`,
      { chapter: beat.chapter, beatIndex: beat.beat_index, attempt: 1 },
      { meta: { charter: "voice-shaping-ablation-v1", arm: arm.cell_label, beat_id: beatId } },
    )
    const wordCount = resp.content.trim().split(/\s+/).filter(Boolean).length
    const cost = getTokenCost(
      DEEPSEEK_PROVIDER, DEEPSEEK_MODEL,
      resp.usage.prompt_tokens, resp.usage.completion_tokens, resp.usage.cached_tokens,
    )
    await db`
      INSERT INTO eval_results (
        experiment_id, set_name, beat_id, adapter_uri, cell_label,
        generated_prose, word_count,
        actual_label_json, error_text
      ) VALUES (
        ${experimentId}, ${setName}, ${beatId}, ${DEEPSEEK_MODEL}, ${arm.cell_label},
        ${resp.content}, ${wordCount},
        ${JSON.stringify({ fresh_generation: true })}, ${null}
      )
    `
    return { cell_label: arm.cell_label, prose: resp.content, wordCount, cost }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`    ${arm.cell_label} FAIL: ${msg}`)
    await db`
      INSERT INTO eval_results (
        experiment_id, set_name, beat_id, adapter_uri, cell_label,
        generated_prose, error_text
      ) VALUES (
        ${experimentId}, ${setName}, ${beatId}, ${DEEPSEEK_MODEL}, ${arm.cell_label},
        ${""}, ${msg}
      )
    `
    return { cell_label: arm.cell_label, prose: "", wordCount: 0, cost: 0, error: msg }
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
    setName: get("--set-name") ?? `voice-shaping-ablation-${Date.now()}`,
    experimentId: get("--experiment-id"),
    createExperiment: argv.includes("--create-experiment"),
  }
}

async function main() {
  const args = parseArgs()
  if (!args.baseline) {
    console.error("usage: --baseline <path> [--set-name <name>] [--create-experiment]")
    process.exit(2)
  }
  const baselineRaw = await readFile(path.resolve(args.baseline), "utf8")
  const baseline = JSON.parse(baselineRaw) as ArchivedBaseline

  const arms = getAblationArms()
  console.log(`[voice-shaping] baseline: ${args.baseline} (${baseline.beats.length} beats on ${baseline.novel_id})`)
  console.log(`[voice-shaping] set_name: ${args.setName}`)
  console.log(`[voice-shaping] arms: ${arms.map(a => a.cell_label).join(", ")}`)

  let experimentId: number | null = null
  if (args.experimentId) experimentId = parseInt(args.experimentId, 10)
  else if (args.createExperiment) {
    experimentId = await createTuningExperiment(
      "checker_eval",
      `Voice-shaping ablation v1 — ${args.setName}. Four DeepSeek arms (bare / style-guide / few-shot / char-directives) on the 20-beat pool from arm-b-direct-pairwise-v1 + Salvatore v4 anchor from arm-d-writer-upgrade-v1. Charter: docs/charters/voice-shaping-ablation-v1.md (revision 2).`,
      {
        set_name: args.setName,
        baseline_path: args.baseline,
        novel_id: baseline.novel_id,
        beat_count: baseline.beats.length,
        arms: arms.map(a => a.cell_label),
        charter: "docs/charters/voice-shaping-ablation-v1.md",
      },
    )
    console.log(`[voice-shaping] created experiment #${experimentId}`)
  }

  // Initialize a run row so executeAndLog persists llm_calls with
  // run_id → runs.experiment_id (FK chain per sql/003). Without this,
  // llm_calls rows are silently dropped — see Codex consult
  // `a67d200f4fe05168a` (2026-04-21).
  if (experimentId !== null) {
    const runId = await initExperimentRun(experimentId, "eval", args.setName, `voice-shaping-ablation-v1 ${args.setName}`)
    console.log(`[voice-shaping] initialized run #${runId} (llm_calls persistence enabled)`)
  }

  let totalCost = 0
  const perArm: Record<string, { fires: number; errors: number; totalWords: number; n: number }> = {}
  for (const arm of arms) perArm[arm.cell_label] = { fires: 0, errors: 0, totalWords: 0, n: 0 }

  for (const beat of baseline.beats) {
    console.log(`  beat ch${beat.chapter}b${beat.beat_index}`)
    for (const arm of arms) {
      const r = await generateArm(arm, beat, baseline.novel_id, args.setName, experimentId)
      totalCost += r.cost
      perArm[arm.cell_label].n++
      if (r.error) perArm[arm.cell_label].errors++
      else perArm[arm.cell_label].totalWords += r.wordCount
      console.log(`    ${arm.cell_label}: ${r.wordCount}w${r.error ? " (err)" : ""}`)
    }
  }

  console.log("")
  console.log(`[voice-shaping] completed ${baseline.beats.length} beats × ${arms.length} arms`)
  for (const arm of arms) {
    const s = perArm[arm.cell_label]
    const avgWords = s.n > 0 ? (s.totalWords / s.n).toFixed(1) : "0"
    console.log(`  ${arm.cell_label}: n=${s.n} avg_words=${avgWords} errors=${s.errors}`)
  }
  console.log(`  Total writer cost: $${totalCost.toFixed(4)}`)

  if (experimentId !== null && args.createExperiment) {
    await concludeExperiment(
      experimentId,
      `Generation complete. Beats: ${baseline.beats.length}. Arms: ${arms.map(a => a.cell_label).join(", ")}. Writer cost: $${totalCost.toFixed(4)}. Decomposed audit pending (voice-shape metrics + adherence + halluc-leak + character-distinctness).`,
    )
  }
}

if (import.meta.main) {
  main().catch(e => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1) })
}
