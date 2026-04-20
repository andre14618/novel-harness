#!/usr/bin/env bun

/**
 * run-conditioning-floor-replay.ts
 *
 * Per-beat replay runner for the salvatore-distinctness-conditioning-floor charter
 * (slim-live-v1-replay).
 *
 * Closes Codex leak #4 (the previousBeatProse feedback-loop confound) by
 * construction: both arms replay against the same source-novel prior-beat prose,
 * so only the exampleLines subset differs at the writer call site.
 *
 * Usage:
 *   bun scripts/evals/run-conditioning-floor-replay.ts \
 *     --source <novel-id> \
 *     --pairs output/evals/conditioning-floor-pairs.jsonl \
 *     --experiment-id <n> \
 *     [--out output/evals/conditioning-floor-replay-pairs.jsonl] \
 *     [--min-words 50] \
 *     [--seed conditioning-floor-v1-replay]
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { resolve, dirname } from "node:path"
import db from "../../src/db/connection"
import { getChapterOutline } from "../../src/db/outlines"
import { getCharacters, getWorldBible } from "../../src/db/world"
import { getCharacterStatesAtChapter } from "../../src/db/character-states"
import { buildBeatContext } from "../../src/agents/writer/beat-context"
import { resolveReferences, type ResolvedReferences } from "../../src/agents/writer/reference-resolver"
import { resolveWriterPack } from "../../src/models/roles"
import { executeAndLog } from "../../src/llm"
import { getTokenCost } from "../../src/models/registry"
import type { LLMRequest } from "../../src/transport"
import type { PairRow } from "./conditioning-floor-judge"

// ── Types ─────────────────────────────────────────────────────────────────────

/** One row from the pre-registered beat JSONL (pair-builder output). */
type PairEntry = {
  novel_id_source: string
  chapter_number: number
  beat_index_in_chapter: number
  global_beat_index: number
  pov_character: string
  characters_present: string[]
  kind: string
  description: string
}

/** Extended PairRow with replay-specific fields. */
export type ReplayPairRow = PairRow & {
  /** true if the fixed arm produced fewer than minWords */
  loss_fixed?: boolean
  /** true if the rotation arm produced fewer than minWords */
  loss_rotation?: boolean
  /** error text if either arm failed all retries */
  error_text?: string
  /** word count produced by fixed arm */
  words_fixed?: number
  /** word count produced by rotation arm */
  words_rotation?: number
}

type ParsedArgs = {
  sourceNovelId: string
  pairsPath: string
  out: string
  experimentId: number
  minWords: number
  seed: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EVAL_ID = "conditioning-floor-slim-live-v1-replay"
const AGENT_NAME = "conditioning-floor-replay"
const DEFAULT_OUT = "output/evals/conditioning-floor-replay-pairs.jsonl"
const DEFAULT_MIN_WORDS = 50
const DEFAULT_SEED = "conditioning-floor-v1-replay"
const MAX_RETRIES = 3

// ── Guardrails ────────────────────────────────────────────────────────────────

/**
 * Assert startup guardrails (closes Codex leaks #2 + #5).
 *
 * Aborts with a clear message if any of:
 * - WRITER_MODEL_OVERRIDE is set
 * - WRITER_PROVIDER_OVERRIDE is set
 * - STYLE_PRIMER is set
 * - any DEBUG_FORCE_* env var is set
 * - state/agent-overrides.json exists and is non-empty
 *
 * Exported for unit testing.
 */
export function assertGuardrails(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): void {
  const violations: string[] = []

  if (env.WRITER_MODEL_OVERRIDE !== undefined) {
    violations.push(`WRITER_MODEL_OVERRIDE is set (value: "${env.WRITER_MODEL_OVERRIDE}") — unset before running the replay`)
  }
  if (env.WRITER_PROVIDER_OVERRIDE !== undefined) {
    violations.push(`WRITER_PROVIDER_OVERRIDE is set (value: "${env.WRITER_PROVIDER_OVERRIDE}") — unset before running the replay`)
  }
  if (env.STYLE_PRIMER !== undefined) {
    violations.push(`STYLE_PRIMER is set (value: "${env.STYLE_PRIMER}") — unset before running the replay`)
  }

  // Check for any DEBUG_FORCE_* env vars
  const debugForceKeys = Object.keys(env).filter((k) => k.startsWith("DEBUG_FORCE_"))
  for (const key of debugForceKeys) {
    violations.push(`${key} is set — DEBUG_FORCE_* vars must be unset before running the replay`)
  }

  // Check state/agent-overrides.json
  const overridesFile = resolve(dirname(new URL(import.meta.url).pathname), "../../state/agent-overrides.json")
  if (existsSync(overridesFile)) {
    try {
      const raw = readFileSync(overridesFile, "utf8")
      const parsed = JSON.parse(raw) as { overrides?: Record<string, unknown> }
      const overrides = parsed.overrides ?? {}
      if (Object.keys(overrides).length > 0) {
        violations.push(
          `state/agent-overrides.json is non-empty (${Object.keys(overrides).length} override(s): ${Object.keys(overrides).join(", ")}) — clear via the web UI or delete the file before running the replay`
        )
      }
    } catch (err) {
      // Corrupt or unreadable — treat as a warning but don't block
      console.warn(`[guardrail] Warning: could not parse state/agent-overrides.json — ${err instanceof Error ? err.message : err}`)
    }
  }

  if (violations.length > 0) {
    console.error("\n[GUARDRAIL FAIL] Cannot run replay — the following invariants are violated:")
    for (const v of violations) {
      console.error(`  - ${v}`)
    }
    console.error("\nFix the above before running. Both arms must see IDENTICAL writer routing.")
    process.exit(1)
  }

  console.log("[guardrail] PASS — WRITER_MODEL_OVERRIDE, WRITER_PROVIDER_OVERRIDE, STYLE_PRIMER, DEBUG_FORCE_* all unset; state/agent-overrides.json is empty or absent.")
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag)
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "usage: bun scripts/evals/run-conditioning-floor-replay.ts \\\n" +
      "  --source <novel-id> \\\n" +
      "  --pairs <path.jsonl> \\\n" +
      "  --experiment-id <n> \\\n" +
      "  [--out <path>] \\\n" +
      "  [--min-words <n>] \\\n" +
      "  [--seed <string>]"
    )
    process.exit(0)
  }

  const sourceNovelId = get("--source")
  if (!sourceNovelId) {
    console.error("error: --source is required")
    process.exit(1)
  }

  const pairsPath = get("--pairs")
  if (!pairsPath) {
    console.error("error: --pairs is required")
    process.exit(1)
  }

  const experimentIdRaw = get("--experiment-id")
  if (!experimentIdRaw) {
    console.error("error: --experiment-id is required")
    process.exit(1)
  }
  const experimentId = Number.parseInt(experimentIdRaw, 10)
  if (!Number.isInteger(experimentId) || experimentId < 1) {
    console.error(`error: --experiment-id must be a positive integer, got ${experimentIdRaw}`)
    process.exit(1)
  }

  const out = get("--out") ?? DEFAULT_OUT
  const minWordsRaw = get("--min-words")
  const minWords = minWordsRaw !== undefined ? Number.parseInt(minWordsRaw, 10) : DEFAULT_MIN_WORDS
  if (minWordsRaw !== undefined && (!Number.isInteger(minWords) || minWords < 1)) {
    console.error(`error: --min-words must be a positive integer, got ${minWordsRaw}`)
    process.exit(1)
  }
  const seed = get("--seed") ?? DEFAULT_SEED

  return {
    sourceNovelId,
    pairsPath: path.resolve(pairsPath),
    out: path.resolve(out),
    experimentId,
    minWords,
    seed,
  }
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8")
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// ── Prior-beat lookup ─────────────────────────────────────────────────────────

/**
 * Derive the (chapter, beatIndex) coordinates of the beat immediately prior
 * to the given one in the source novel. Returns null if there is no prior beat
 * (i.e. chapter 1, beat index 0).
 *
 * If beat_index_in_chapter is 0 and chapter_number > 1, we step to the prior
 * chapter's last beat. We need the outline to know how many beats the prior
 * chapter has.
 *
 * Exported for unit testing.
 */
export function derivePriorBeatCoords(
  chapterNumber: number,
  beatIndexInChapter: number,
  priorChapterBeatCount: number | null,
): { chapter: number; beatIndex: number } | null {
  // Match live drafting contract (src/phases/drafting.ts): chapter-openers
  // receive NO transition bridge. Prior drafting contract is beatProses[bi - 1]
  // within the same chapter only; there is no cross-chapter bridge path.
  // Changed 2026-04-20 after Codex round-5 blocker #4.
  //
  // priorChapterBeatCount is kept in the signature for API compatibility with
  // existing unit tests but is no longer consulted.
  void priorChapterBeatCount
  if (beatIndexInChapter <= 0) {
    return null
  }
  return { chapter: chapterNumber, beatIndex: beatIndexInChapter - 1 }
}

/**
 * Retrieve per-beat prose from llm_calls for the source novel.
 *
 * Beat prose for 'beat-writer' agent calls is stored in
 * llm_calls.response_content (sql/017_llm_call_inspection.sql) with columns
 * novel_id, chapter, beat_index. We fetch the FIRST (earliest by id) non-null
 * response for the given coordinates — i.e. the prose the downstream beat
 * actually saw when it was originally drafted. Targeted rewrites later can
 * update llm_calls for the same beat coordinates; using the latest row would
 * feed the replay a bridge the production writer never saw.
 *
 * Changed ORDER BY id DESC → ASC 2026-04-20 after Codex round-5 blocker #4.
 */
async function getBeatProseFromLLMCalls(
  novelId: string,
  chapterNumber: number,
  beatIndex: number,
): Promise<string | null> {
  const rows = await db<Array<{ response_content: string }>>`
    SELECT response_content
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'beat-writer'
      AND chapter = ${chapterNumber}
      AND beat_index = ${beatIndex}
      AND response_content IS NOT NULL
      AND failed IS NOT TRUE
    ORDER BY id ASC
    LIMIT 1
  `
  if (rows.length === 0) return null
  return rows[0].response_content
}

/**
 * Get the last N sentences of a prose string as the transition bridge.
 */
function extractLastSentences(prose: string, count: number): string | null {
  const sentences = prose.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
  if (sentences.length === 0) return null
  return sentences.slice(-count).join(" ")
}

// ── Writer call ───────────────────────────────────────────────────────────────

/**
 * Read the writer system prompt file for the given pack.
 */
async function readWriterSystemPrompt(systemPromptFile: string): Promise<string> {
  const promptPath = path.resolve(
    dirname(new URL(import.meta.url).pathname),
    "../../src/agents/writer",
    systemPromptFile
  )
  return readFile(promptPath, "utf8")
}

/**
 * Build the LLMRequest for a single beat arm call. The request shape MUST
 * match the live drafting request shape from src/phases/drafting.ts exactly,
 * or the replay isn't measuring the production writer path. The parity
 * harness (scripts/evals/conditioning-floor-parity-check.ts) diffs this
 * output against a real llm_calls row; the diff must be empty for any
 * field that materially affects writer behavior.
 *
 * Exported for the parity harness.
 */
export function buildWriterRequest(
  systemPrompt: string,
  userPrompt: string,
  pack: NonNullable<ReturnType<typeof resolveWriterPack>>,
): LLMRequest {
  return {
    systemPrompt,
    userPrompt,
    model: pack.model.model,
    provider: pack.model.provider,
    temperature: pack.model.temperature ?? 0.8,
    maxTokens: pack.model.maxTokens ?? 4000,
    // Match the live beat-writer path exactly — src/phases/drafting.ts sends
    // response_format: {type: "text"}. Without this, the transport layer
    // defaults to {type: "json_object"} which changes provider-side behavior.
    // Added 2026-04-20 after Codex round-5 critical blocker #1.
    responseFormat: { type: "text" },
  }
}

/**
 * Shared per-beat inputs that must be byte-identical between the two arms.
 *
 * Built ONCE per beat by the caller and passed unchanged into both arm
 * invocations. This closes Codex round-5 blocker #2: if each arm rebuilt
 * buildBeatContext independently, resolveReferences() could return different
 * BACKGROUND blocks via its LLM fallback path, breaking the "conditioning
 * alone differs" claim.
 */
export type SharedBeatInputs = {
  outline: Awaited<ReturnType<typeof getChapterOutline>>
  characters: Awaited<ReturnType<typeof getCharacters>>
  characterStates: Awaited<ReturnType<typeof getCharacterStatesAtChapter>>
  worldBible: Awaited<ReturnType<typeof getWorldBible>>
  preResolvedRefs: ResolvedReferences
  previousBeatProse: string | null
  genre: string
}

/**
 * Build the shared per-beat inputs, resolving references exactly once. The
 * returned payload is frozen (by convention, not by Object.freeze) — do not
 * mutate it between arm invocations.
 */
async function buildSharedBeatInputs(
  entry: PairEntry,
  sourceNovelId: string,
  genre: string,
): Promise<SharedBeatInputs | { error: string }> {
  const outline = await getChapterOutline(sourceNovelId, entry.chapter_number)
  const characters = await getCharacters(sourceNovelId)
  const characterStates = await getCharacterStatesAtChapter(sourceNovelId, entry.chapter_number)
  const worldBible = await getWorldBible(sourceNovelId)

  // Locate the beat spec inside the outline so resolveReferences can read it.
  // outline.scenes is a flat array of SceneBeat rows (one per beat, not one
  // per scene — naming is historical). Index == beat_index_in_chapter.
  const beatSpec = outline.scenes[entry.beat_index_in_chapter]
  if (!beatSpec) {
    return { error: `beat_index_in_chapter ${entry.beat_index_in_chapter} out of range for chapter ${entry.chapter_number} (outline has ${outline.scenes.length} beats)` }
  }

  // Resolve references ONCE. Identical payload feeds both arms.
  const preResolvedRefs = await resolveReferences(beatSpec, outline, sourceNovelId, entry.chapter_number, characters)

  // Prior-beat prose is bounded to within-chapter (matching live drafting
  // contract). Cross-chapter bridge disabled after Codex round-5 blocker #4.
  let previousBeatProse: string | null = null
  const priorCoords = derivePriorBeatCoords(
    entry.chapter_number,
    entry.beat_index_in_chapter,
    null,
  )
  if (priorCoords !== null) {
    const rawProse = await getBeatProseFromLLMCalls(
      sourceNovelId,
      priorCoords.chapter,
      priorCoords.beatIndex,
    )
    if (rawProse) previousBeatProse = extractLastSentences(rawProse, 3)
  }

  return {
    outline,
    characters,
    characterStates,
    worldBible,
    preResolvedRefs,
    previousBeatProse,
    genre,
  }
}

/**
 * Call the writer for one arm, with exponential-backoff retry. Both arms see
 * IDENTICAL shared inputs (outline/characters/states/worldBible/refs/prior
 * prose); the ONLY difference is the WRITER_CONDITIONING env var, which
 * pickExampleLineSubset consults when rendering character profiles.
 *
 * We save and restore process.env.WRITER_CONDITIONING around each arm.
 */
async function callWriterWithRetry(
  entry: PairEntry,
  sourceNovelId: string,
  systemPrompt: string,
  pack: NonNullable<ReturnType<typeof resolveWriterPack>>,
  conditioning: "fixed" | "rotation",
  shared: SharedBeatInputs,
): Promise<{ prose: string; costUsd: number } | { error: string }> {
  const originalConditioning = process.env.WRITER_CONDITIONING
  process.env.WRITER_CONDITIONING = conditioning

  let lastError: Error | null = null

  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoffMs = 2 ** attempt * 1000
        await new Promise((r) => setTimeout(r, backoffMs))
        console.warn(`    retry ${attempt}/${MAX_RETRIES - 1} (${conditioning} arm, pair ${entry.global_beat_index})`)
      }

      try {
        const beatCtx = await buildBeatContext({
          novelId: sourceNovelId,
          chapterNumber: entry.chapter_number,
          beatIndex: entry.beat_index_in_chapter,
          previousBeatProse: shared.previousBeatProse ?? undefined,
          outline: shared.outline,
          characters: shared.characters,
          characterStates: shared.characterStates,
          worldBible: shared.worldBible,
          preResolvedRefs: shared.preResolvedRefs,
          compactMode: true,
          genre: shared.genre,
        })

        const request = buildWriterRequest(systemPrompt, beatCtx.userPrompt, pack)
        const response = await executeAndLog(
          request,
          undefined, // no novelId — standalone eval call, not a live novel run
          AGENT_NAME,
          { chapter: entry.chapter_number, beatIndex: entry.beat_index_in_chapter, attempt: attempt + 1 },
          {
            meta: {
              evalId: EVAL_ID,
              beatId: `${sourceNovelId}-ch${entry.chapter_number}-b${entry.beat_index_in_chapter}`,
              arm: conditioning,
            },
          },
        )

        const costUsd = getTokenCost(
          pack.model.provider,
          pack.model.model,
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          response.usage.cached_tokens,
        )

        return { prose: response.content, costUsd }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        console.warn(`    [${conditioning}] attempt ${attempt + 1} failed: ${lastError.message.slice(0, 120)}`)
      }
    }

    return { error: lastError?.message ?? `${MAX_RETRIES} retries exhausted` }
  } finally {
    // Always restore the original conditioning value
    if (originalConditioning === undefined) {
      delete process.env.WRITER_CONDITIONING
    } else {
      process.env.WRITER_CONDITIONING = originalConditioning
    }
  }
}

// ── Pair assembly ─────────────────────────────────────────────────────────────

/**
 * Assemble one PairRow from a pre-registered beat entry.
 *
 * Steps:
 * 1. Build shared beat inputs ONCE (outline, characters, states, world bible,
 *    resolved references, prior-beat prose). Both arms see this identical
 *    payload — closes Codex round-5 blocker #2.
 * 2. Call writer with WRITER_CONDITIONING=fixed   → arm_a_prose
 * 3. Call writer with WRITER_CONDITIONING=rotation → arm_b_prose
 * 4. Apply minWords loss gate (closes Codex round-5 blocker #3 at encode
 *    time; the judge wrapper enforces it at score time via short-circuit).
 * 5. Emit UNSHUFFLED row (arm_a_label="fixed", arm_b_label="rotation"). The
 *    judge wrapper owns the seeded A/B shuffle; double-shuffling here would
 *    break seed ownership (Codex round-5 warning #1).
 */
async function assembleOnePair(
  entry: PairEntry,
  sourceNovelId: string,
  genre: string,
  systemPrompt: string,
  pack: NonNullable<ReturnType<typeof resolveWriterPack>>,
  minWords: number,
): Promise<{ row: ReplayPairRow; costUsd: number }> {
  const pairId = `${sourceNovelId}-ch${entry.chapter_number}-b${entry.beat_index_in_chapter}`

  // Build shared inputs ONCE. If this fails (e.g. beat out of range), record
  // a mutual-loss row and move on.
  const shared = await buildSharedBeatInputs(entry, sourceNovelId, genre)
  if ("error" in shared) {
    return {
      row: {
        pair_id: pairId,
        pov_character: entry.pov_character,
        characters_present: entry.characters_present,
        beat_description: entry.description,
        arm_a_prose: "",
        arm_b_prose: "",
        arm_a_label: "fixed",
        arm_b_label: "rotation",
        loss_fixed: true,
        loss_rotation: true,
        error_text: `buildSharedBeatInputs: ${shared.error}`,
        words_fixed: 0,
        words_rotation: 0,
      },
      costUsd: 0,
    }
  }

  let totalCost = 0

  // Fixed arm
  console.log(`    [fixed] calling writer...`)
  const fixedResult = await callWriterWithRetry(
    entry, sourceNovelId, systemPrompt, pack, "fixed", shared,
  )
  const fixedProse = "error" in fixedResult ? "" : fixedResult.prose
  const fixedWords = countWords(fixedProse)
  const fixedError = "error" in fixedResult ? fixedResult.error : undefined
  if ("costUsd" in fixedResult) totalCost += fixedResult.costUsd

  // Rotation arm
  console.log(`    [rotation] calling writer...`)
  const rotationResult = await callWriterWithRetry(
    entry, sourceNovelId, systemPrompt, pack, "rotation", shared,
  )
  const rotationProse = "error" in rotationResult ? "" : rotationResult.prose
  const rotationWords = countWords(rotationProse)
  const rotationError = "error" in rotationResult ? rotationResult.error : undefined
  if ("costUsd" in rotationResult) totalCost += rotationResult.costUsd

  // Loss encoding per charter §7
  const lossFixed = fixedWords < minWords
  const lossRotation = rotationWords < minWords
  const errorText = [fixedError, rotationError].filter(Boolean).join("; ") || undefined

  // Emit UNSHUFFLED row. Judge owns the shuffle (single seed owner).
  return {
    row: {
      pair_id: pairId,
      pov_character: entry.pov_character,
      characters_present: entry.characters_present,
      beat_description: entry.description,
      arm_a_prose: fixedProse,
      arm_b_prose: rotationProse,
      arm_a_label: "fixed",
      arm_b_label: "rotation",
      loss_fixed: lossFixed || undefined,
      loss_rotation: lossRotation || undefined,
      error_text: errorText,
      words_fixed: fixedWords || undefined,
      words_rotation: rotationWords || undefined,
    },
    costUsd: totalCost,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Guardrails (closes Codex leaks #2 + #5)
  assertGuardrails()

  const args = parseArgs()
  const { sourceNovelId, pairsPath, out, experimentId, minWords } = args
  // Note: --seed is accepted for CLI backward compatibility but not used by
  // this script. The judge wrapper (conditioning-floor-judge.ts) owns the
  // A/B shuffle so there is a single seed owner (Codex round-5 warning #1).

  console.log(`\n[replay] Source novel:   ${sourceNovelId}`)
  console.log(`[replay] Pairs file:     ${pairsPath}`)
  console.log(`[replay] Output:         ${out}`)
  console.log(`[replay] Experiment ID:  ${experimentId}`)
  console.log(`[replay] Min words:      ${minWords}`)
  console.log(`[replay] Shuffle:        deferred to judge wrapper (single seed owner)`)

  // 2. Load source novel metadata
  const novelRows = await db<Array<{ phase: string; seed_json: Record<string, unknown> }>>`
    SELECT phase, seed_json FROM novels WHERE id = ${sourceNovelId}
  `
  if (novelRows.length === 0) {
    console.error(`error: novel "${sourceNovelId}" not found in DB`)
    process.exit(1)
  }
  const novelPhase = novelRows[0].phase
  const seedJson = novelRows[0].seed_json
  const genre = (seedJson as any).genre as string | undefined

  if (!genre) {
    console.error(`error: source novel "${sourceNovelId}" has no genre in seed_json — cannot resolve writer pack`)
    process.exit(1)
  }

  console.log(`[replay] Novel phase:    ${novelPhase}`)
  console.log(`[replay] Genre:          ${genre}`)

  if (novelPhase !== "done" && !novelPhase.includes("draft")) {
    console.warn(`[warn] Novel phase is "${novelPhase}" — expected "done" or a drafting phase. Proceeding, but some beats may be missing.`)
  }

  // 3. Resolve writer pack (must resolve, because this is the live path)
  // Temporarily clear WRITER_CONDITIONING so resolveWriterPack returns the
  // pack's configured default (not any stale env override).
  const savedConditioning = process.env.WRITER_CONDITIONING
  delete process.env.WRITER_CONDITIONING
  const pack = resolveWriterPack(genre)
  if (savedConditioning !== undefined) process.env.WRITER_CONDITIONING = savedConditioning

  if (!pack) {
    console.error(`error: no WRITER_GENRE_PACKS entry matches genre "${genre}" — cannot run the fantasy voice LoRA replay`)
    process.exit(1)
  }
  console.log(`[replay] Writer pack:    ${pack.label}`)
  console.log(`[replay] Writer model:   ${pack.model.model}`)

  // 4. Load system prompt
  const systemPrompt = await readWriterSystemPrompt(pack.systemPromptFile)

  // 5. Load pre-registered pairs
  const entries = await readJsonLines<PairEntry>(pairsPath)
  console.log(`[replay] Pairs loaded:   ${entries.length}`)

  // 6. Process each pair
  const rows: ReplayPairRow[] = []
  let totalCostUsd = 0
  let lossCount = 0
  let errorCount = 0

  for (const entry of entries) {
    const label = `ch${entry.chapter_number}-b${entry.beat_index_in_chapter} (global #${entry.global_beat_index})`
    console.log(`\n[replay] Processing ${label} — "${entry.description.slice(0, 60)}..."`)

    try {
      const { row, costUsd } = await assembleOnePair(
        entry, sourceNovelId, genre, systemPrompt, pack, minWords,
      )
      rows.push(row)
      totalCostUsd += costUsd

      const hadLoss = row.loss_fixed || row.loss_rotation
      const hadError = !!row.error_text

      if (hadError) {
        errorCount++
        console.log(`  [SKIP] error: ${row.error_text}`)
      } else if (hadLoss) {
        lossCount++
        const lossArms = [row.loss_fixed && "fixed", row.loss_rotation && "rotation"].filter(Boolean).join("+")
        console.log(`  [LOSS] ${lossArms} arm(s) below ${minWords}-word threshold (fixed=${row.words_fixed}w, rotation=${row.words_rotation}w)`)
      } else {
        console.log(`  [OK]   fixed=${row.words_fixed}w, rotation=${row.words_rotation}w, cost=$${costUsd.toFixed(5)}`)
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      console.error(`  [ERROR] unexpected error on pair ${label}: ${errorText}`)

      // Emit a loss row so the pair is counted (not dropped) per charter §7
      rows.push({
        pair_id: `${sourceNovelId}-ch${entry.chapter_number}-b${entry.beat_index_in_chapter}`,
        pov_character: entry.pov_character,
        characters_present: entry.characters_present,
        beat_description: entry.description,
        arm_a_prose: "",
        arm_b_prose: "",
        arm_a_label: "fixed",
        arm_b_label: "rotation",
        loss_fixed: true,
        loss_rotation: true,
        error_text: errorText,
        words_fixed: 0,
        words_rotation: 0,
      })
      errorCount++
    }
  }

  // 7. Write JSONL output
  await mkdir(path.dirname(out), { recursive: true })
  const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
  await writeFile(out, jsonl, "utf8")

  // 8. Persist results to eval_results for provenance
  for (const row of rows) {
    try {
      await db`
        INSERT INTO eval_results (
          experiment_id,
          set_name,
          beat_id,
          adapter_uri,
          cell_label,
          actual_label_json,
          latency_ms,
          error_text
        ) VALUES (
          ${experimentId},
          ${EVAL_ID},
          ${row.pair_id},
          ${pack.model.model},
          ${"assembled"},
          ${JSON.stringify({ loss_fixed: row.loss_fixed ?? false, loss_rotation: row.loss_rotation ?? false, words_fixed: row.words_fixed ?? 0, words_rotation: row.words_rotation ?? 0 })},
          ${0},
          ${row.error_text ?? null}
        )
      `
    } catch (dbErr) {
      console.warn(`[warn] Failed to persist eval_result for ${row.pair_id}: ${dbErr instanceof Error ? dbErr.message : dbErr}`)
    }
  }

  // 9. Summary
  const validPairs = rows.filter((r) => !r.loss_fixed && !r.loss_rotation && !r.error_text)
  console.log("\n── Replay Summary ───────────────────────────────────────")
  console.log(`  Total pairs processed:     ${rows.length}`)
  console.log(`  Valid pairs (both arms OK): ${validPairs.length}`)
  console.log(`  Pairs with a loss arm:     ${lossCount}`)
  console.log(`  Pairs with errors:         ${errorCount}`)
  console.log(`  Total writer call cost:    $${totalCostUsd.toFixed(5)}`)
  console.log(`  Output file:               ${out}`)
  console.log("")
  console.log("  Per-pair word counts:")
  for (const row of rows) {
    const status = row.error_text ? "[ERR]" : (row.loss_fixed || row.loss_rotation ? "[LOSS]" : "[OK]")
    console.log(`    ${status} ${row.pair_id}: fixed=${row.words_fixed ?? 0}w, rotation=${row.words_rotation ?? 0}w`)
  }
  console.log("─────────────────────────────────────────────────────────")
  console.log(`\nDone. Pass ${out} to conditioning-floor-judge.ts.`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
