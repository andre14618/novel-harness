#!/usr/bin/env bun
/**
 * Arm B preflight parity harness per `docs/charters/arm-b-detector-preflight.md`
 * §6. Implements the 7 runtime assertions:
 *
 *   1. len(sections_B) == len(sections_A) + 1
 *   2. Exactly one ENRICHED CONTEXT: section in sections_B
 *   3. (derived) Remove ENRICHED CONTEXT from sections_B → sections_B'
 *   4. sections_B' == sections_A byte-equal by index
 *   5. systemPrompt_B == systemPrompt_A byte-equal
 *   6. Envelope fields byte-equal (model, provider, temperature, maxTokens, responseFormat)
 *   7. Aborts on any violation with structured diff (per-index section
 *      identity + byte length + first divergence offset)
 *
 * Two modes:
 *   - `--dry-run`: offline archival parity dry-run per charter §6 step 1-4.
 *     Pulls stored llm_calls rows for a pre-registered beat pool, recovers
 *     sections[] from each, writes the archival baseline JSON. No Arm B
 *     construction.
 *   - `--beat <llmCallId>`: runtime parity check for a single beat.
 *     Loads the archived baseline + builds Arm B from the stored Arm A
 *     sections[] + runs all 7 assertions. Used by the preflight runner.
 *
 * Usage:
 *   # Dry-run (build baseline)
 *   bun scripts/evals/preflight-arm-b-parity.ts --dry-run \
 *     --novel novel-1776690960321 \
 *     --pool output/evals/arm-b-preflight-pool.json \
 *     --baseline output/evals/arm-b-preflight-baseline.json
 *
 *   # Runtime (verify a single constructed Arm B against the baseline)
 *   bun scripts/evals/preflight-arm-b-parity.ts --beat <llm_call_id> \
 *     --baseline output/evals/arm-b-preflight-baseline.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import db from "../../../src/db/connection"
import { getChapterOutline } from "../../../src/db/outlines"
import { getCharacters, getWorldBible } from "../../../src/db/world"
import { getCharacterStatesAtChapter } from "../../../src/db/character-states"
import { getFactsUpToChapter } from "../../../src/db/facts"
import {
  buildEnrichedContext,
  insertEnrichedSection,
} from "../../../src/agents/writer/enriched-context"
import {
  recoverSections,
  sectionHeader,
  computeSignature,
  type SectionSignature,
} from "./beat-prompt-sections"

// ── Types ──────────────────────────────────────────────────────────────

interface LlmCallRow {
  id: number
  novel_id: string
  chapter: number
  beat_index: number
  system_prompt: string | null
  user_prompt: string | null
  model: string | null
  provider: string | null
  temperature: number | null
  max_tokens: number | null
  request_json: string | null  // stored as TEXT, not JSONB — must JSON.parse
}

interface ArchivedBaseline {
  created_at: string
  novel_id: string
  beats: Array<{
    llm_call_id: number
    chapter: number
    beat_index: number
    sections: string[]             // full section strings
    signature: SectionSignature[]  // integrity signature
    system_prompt: string
    envelope: EnvelopeFields
  }>
}

interface EnvelopeFields {
  model: string
  provider: string
  temperature: number | null
  maxTokens: number | null
  responseFormat: unknown
}

const ENVELOPE_FIELD_NAMES = [
  "model",
  "provider",
  "temperature",
  "maxTokens",
  "responseFormat",
] as const

// ── Helpers ───────────────────────────────────────────────────────────

function extractEnvelope(row: LlmCallRow): EnvelopeFields {
  // Dedicated columns are the source of truth for model/provider/temperature/
  // max_tokens. `request_json` is stored as TEXT (not JSONB) so we parse it
  // only to recover `responseFormat`, which has no dedicated column.
  let parsedRequest: Record<string, unknown> = {}
  if (row.request_json) {
    try {
      parsedRequest = JSON.parse(row.request_json) as Record<string, unknown>
    } catch {
      // corrupted row — leave responseFormat as null
    }
  }
  return {
    model: row.model ?? "",
    provider: row.provider ?? "",
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    responseFormat: parsedRequest.responseFormat ?? null,
  }
}

export function envelopeEqual(a: EnvelopeFields, b: EnvelopeFields): {
  ok: boolean
  diffs: string[]
} {
  const diffs: string[] = []
  for (const field of ENVELOPE_FIELD_NAMES) {
    const va = JSON.stringify((a as Record<string, unknown>)[field])
    const vb = JSON.stringify((b as Record<string, unknown>)[field])
    if (va !== vb) diffs.push(`${field}: A=${va} B=${vb}`)
  }
  return { ok: diffs.length === 0, diffs }
}

export function firstDivergenceOffset(a: string, b: string): number {
  const min = Math.min(a.length, b.length)
  for (let i = 0; i < min; i++) {
    if (a[i] !== b[i]) return i
  }
  return a.length === b.length ? -1 : min
}

export type { EnvelopeFields }

async function loadBeatRow(llmCallId: number): Promise<LlmCallRow> {
  const rows = await db<LlmCallRow[]>`
    SELECT id, novel_id, chapter, beat_index, system_prompt, user_prompt,
           model, provider, temperature, max_tokens, request_json
    FROM llm_calls
    WHERE id = ${llmCallId}
    LIMIT 1
  `
  if (rows.length === 0) throw new Error(`llm_call ${llmCallId} not found`)
  return rows[0]
}

// ── Parity check types ────────────────────────────────────────────────

export interface ParityResult {
  llm_call_id: number
  chapter: number
  beat_index: number
  ok: boolean
  failures: string[]
  // Structured diff (populated only on failure)
  diff?: {
    arm_a_section_count: number
    arm_b_section_count: number
    arm_a_headers: string[]
    arm_b_headers: string[]
    first_byte_divergence?: { section_index: number; offset: number; a_ctx: string; b_ctx: string }
    envelope_diffs?: string[]
    system_prompt_first_divergence?: number
  }
  // Observability on success
  telemetry?: {
    arm_a_section_count: number
    arm_b_section_count: number
    enriched_bytes: number
    sub_block_bytes: { speakerDirectives: number; readerInfoState: number; focusedWorldSlice: number }
  }
}

// ── Pure assertion core (no DB, testable) ─────────────────────────────

export interface CheckArmBStructureInputs {
  llm_call_id: number
  chapter: number
  beat_index: number
  armASections: string[]
  armBSections: string[]
  /** enriched block string — used for telemetry byte count */
  enrichedBlock: string
  subBlockBytes: { speakerDirectives: number; readerInfoState: number; focusedWorldSlice: number }
  liveSystemPrompt: string | null
  baselineSystemPrompt: string
  liveEnvelope: EnvelopeFields
  baselineEnvelope: EnvelopeFields
}

/**
 * Run all 7 parity assertions against pre-resolved inputs.
 * Pure function — no DB reads, no async. Called by `checkBeatParity`
 * after it has fetched all required data; also directly testable.
 */
export function checkArmBStructure(inputs: CheckArmBStructureInputs): ParityResult {
  const {
    llm_call_id, chapter, beat_index,
    armASections, armBSections,
    enrichedBlock, subBlockBytes,
    liveSystemPrompt, baselineSystemPrompt,
    liveEnvelope, baselineEnvelope,
  } = inputs

  const failures: string[] = []
  const diff: ParityResult["diff"] = {
    arm_a_section_count: armASections.length,
    arm_b_section_count: armBSections.length,
    arm_a_headers: armASections.map(sectionHeader),
    arm_b_headers: armBSections.map(sectionHeader),
  }

  // Assertion 1: len(B) == len(A) + 1
  if (armBSections.length !== armASections.length + 1) {
    failures.push(
      `Assertion 1 (length): armB=${armBSections.length} != armA(${armASections.length})+1`,
    )
  }

  // Assertion 2: exactly one ENRICHED CONTEXT: section in B
  const enrichedCount = armBSections.filter(s =>
    s.startsWith("ENRICHED CONTEXT:"),
  ).length
  if (enrichedCount !== 1) {
    failures.push(
      `Assertion 2 (single ENRICHED): found ${enrichedCount} ENRICHED CONTEXT sections in Arm B`,
    )
  }

  // Assertion 3+4: sections_B' == sections_A byte-equal by index
  const armBPrime = armBSections.filter(s => !s.startsWith("ENRICHED CONTEXT:"))
  if (armBPrime.length === armASections.length) {
    for (let i = 0; i < armASections.length; i++) {
      if (armBPrime[i] !== armASections[i]) {
        const offset = firstDivergenceOffset(armBPrime[i], armASections[i])
        diff.first_byte_divergence = {
          section_index: i,
          offset,
          a_ctx: armASections[i].slice(Math.max(0, offset - 20), offset + 20),
          b_ctx: armBPrime[i].slice(Math.max(0, offset - 20), offset + 20),
        }
        failures.push(
          `Assertion 4 (byte-equal by index): section ${i} (${sectionHeader(armASections[i])}) differs at byte ${offset}`,
        )
        break
      }
    }
  } else {
    failures.push(
      `Assertion 3 (len post-remove): armB_prime length=${armBPrime.length} armA length=${armASections.length}`,
    )
  }

  // Assertion 5: systemPrompt byte-equal
  if (liveSystemPrompt !== baselineSystemPrompt) {
    const offset = firstDivergenceOffset(
      liveSystemPrompt ?? "",
      baselineSystemPrompt,
    )
    diff.system_prompt_first_divergence = offset
    failures.push(
      `Assertion 5 (system_prompt): live row differs from archived baseline at byte ${offset}`,
    )
  }

  // Assertion 6: envelope fields byte-equal
  const envCheck = envelopeEqual(liveEnvelope, baselineEnvelope)
  if (!envCheck.ok) {
    diff.envelope_diffs = envCheck.diffs
    failures.push(
      `Assertion 6 (envelope): ${envCheck.diffs.length} field(s) differ: ${envCheck.diffs.join("; ")}`,
    )
  }

  const ok = failures.length === 0
  return {
    llm_call_id,
    chapter,
    beat_index,
    ok,
    failures,
    ...(ok
      ? {
          telemetry: {
            arm_a_section_count: armASections.length,
            arm_b_section_count: armBSections.length,
            enriched_bytes: enrichedBlock.length,
            sub_block_bytes: subBlockBytes,
          },
        }
      : { diff }),
  }
}

// ── Parity check (runtime, single beat) ───────────────────────────────

export async function checkBeatParity(
  llmCallId: number,
  baseline: ArchivedBaseline,
): Promise<ParityResult> {
  const row = await loadBeatRow(llmCallId)
  const baselineBeat = baseline.beats.find(b => b.llm_call_id === llmCallId)
  if (!baselineBeat) {
    return {
      llm_call_id: llmCallId,
      chapter: row.chapter,
      beat_index: row.beat_index,
      ok: false,
      failures: [`No archived baseline for llm_call_id=${llmCallId}`],
    }
  }

  // Build Arm B fresh from stored inputs
  const outline = await getChapterOutline(row.novel_id, row.chapter)
  const beat = outline.scenes[row.beat_index]
  if (!beat) {
    return {
      llm_call_id: llmCallId,
      chapter: row.chapter,
      beat_index: row.beat_index,
      ok: false,
      failures: [`No beat at outline.scenes[${row.beat_index}] for chapter ${row.chapter}`],
    }
  }
  const characters = await getCharacters(row.novel_id)
  const characterStates = await getCharacterStatesAtChapter(row.novel_id, row.chapter)
  const worldBible = await getWorldBible(row.novel_id)
  const priorChapterFacts = row.chapter > 1
    ? await getFactsUpToChapter(row.novel_id, row.chapter - 1)
    : []

  const enriched = buildEnrichedContext({
    beat, outline, characters, characterStates, worldBible,
    priorChapterFacts, chapterNumber: row.chapter,
  })

  const armASections = baselineBeat.sections
  const armBSections = insertEnrichedSection(armASections, enriched.block)

  return checkArmBStructure({
    llm_call_id: llmCallId,
    chapter: row.chapter,
    beat_index: row.beat_index,
    armASections,
    armBSections,
    enrichedBlock: enriched.block,
    subBlockBytes: enriched.subBlockBytes,
    // Assertion 5: Arm B's system_prompt is the live row's system_prompt —
    // reused verbatim. Compare against baseline to detect mid-run drift.
    liveSystemPrompt: row.system_prompt,
    baselineSystemPrompt: baselineBeat.system_prompt,
    liveEnvelope: extractEnvelope(row),
    baselineEnvelope: baselineBeat.envelope,
  })
}

// ── Dry-run (offline archival baseline) ───────────────────────────────

async function runDryRun(
  novelId: string,
  poolPath: string,
  baselinePath: string,
): Promise<void> {
  // Load the pre-registered beat pool (array of {llm_call_id, chapter, beat_index})
  const poolRaw = await readFile(poolPath, "utf8")
  const pool = JSON.parse(poolRaw) as Array<{
    llm_call_id: number
    chapter: number
    beat_index: number
  }>
  console.log(`[parity dry-run] pool size: ${pool.length} beats`)

  const beats: ArchivedBaseline["beats"] = []
  let dropped = 0
  const dropReasons: string[] = []

  for (const { llm_call_id } of pool) {
    try {
      const row = await loadBeatRow(llm_call_id)
      if (!row.user_prompt || !row.system_prompt) {
        dropped++
        dropReasons.push(`beat ${llm_call_id}: missing system/user_prompt`)
        continue
      }
      const sections = recoverSections(row.user_prompt)
      const rejoined = sections.join("\n\n")
      if (rejoined !== row.user_prompt) {
        dropped++
        dropReasons.push(`beat ${llm_call_id}: round-trip mismatch`)
        continue
      }
      beats.push({
        llm_call_id: row.id,
        chapter: row.chapter,
        beat_index: row.beat_index,
        sections,
        signature: computeSignature(sections),
        system_prompt: row.system_prompt,
        envelope: extractEnvelope(row),
      })
    } catch (e) {
      dropped++
      dropReasons.push(`beat ${llm_call_id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const yieldPct = (beats.length / pool.length) * 100
  console.log(`[parity dry-run] recovered ${beats.length}/${pool.length} (${yieldPct.toFixed(1)}%)`)
  if (dropped > 0) {
    console.log(`[parity dry-run] dropped ${dropped} beats:`)
    for (const r of dropReasons.slice(0, 10)) console.log(`  ${r}`)
  }

  // Charter §6 yield gate
  if (yieldPct < 40) {
    console.error(`[parity dry-run] VERDICT: FAIL (<40% yield). Re-select source novel.`)
    process.exit(1)
  } else if (yieldPct < 70) {
    console.error(
      `[parity dry-run] VERDICT: SCHEMA-DRIFT ABORT (40-70% yield on post-sql/017 novel). Investigate drift before proceeding.`,
    )
    process.exit(1)
  }

  const baseline: ArchivedBaseline = {
    created_at: new Date().toISOString(),
    novel_id: novelId,
    beats,
  }
  await mkdir(path.dirname(path.resolve(baselinePath)), { recursive: true })
  await writeFile(path.resolve(baselinePath), JSON.stringify(baseline, null, 2))
  console.log(`[parity dry-run] baseline written: ${baselinePath}`)
  console.log(`[parity dry-run] VERDICT: PASS (≥70% yield)`)
}

// ── CLI ───────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2)
  const has = (flag: string) => argv.includes(flag)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  return {
    dryRun: has("--dry-run"),
    novel: get("--novel"),
    pool: get("--pool"),
    baseline: get("--baseline"),
    beat: get("--beat"),
  }
}

async function main() {
  const args = parseArgs()

  if (args.dryRun) {
    if (!args.novel || !args.pool || !args.baseline) {
      console.error("usage: --dry-run --novel <id> --pool <path> --baseline <path>")
      process.exit(2)
    }
    await runDryRun(args.novel, args.pool, args.baseline)
    process.exit(0)
  }

  if (args.beat) {
    if (!args.baseline) {
      console.error("usage: --beat <llm_call_id> --baseline <path>")
      process.exit(2)
    }
    const baselineRaw = await readFile(path.resolve(args.baseline), "utf8")
    const baseline = JSON.parse(baselineRaw) as ArchivedBaseline
    const result = await checkBeatParity(parseInt(args.beat, 10), baseline)
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.ok ? 0 : 1)
  }

  console.error("usage: --dry-run ... OR --beat <llm_call_id> --baseline <path>")
  process.exit(2)
}

if (import.meta.main) {
  main().catch(e => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1) })
}
