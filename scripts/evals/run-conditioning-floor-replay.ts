#!/usr/bin/env bun

/**
 * run-conditioning-floor-replay.ts
 *
 * Per-beat replay runner for the salvatore-distinctness-conditioning-floor charter
 * (slim-live-v1-replay).
 *
 * Closes Codex leak #4 (the previousBeatProse feedback-loop confound) by
 * construction: all arms replay against the same source-novel prior-beat prose,
 * so only the exampleLines subset differs at the writer call site.
 *
 * Three-arm design (Codex round-6 blocker #1):
 *   raw      — production default (WRITER_CONDITIONING unset → lines.slice(0,5))
 *   fixed    — preset-a subset always (WRITER_CONDITIONING=fixed)
 *   rotation — cycles preset-a/b/c (WRITER_CONDITIONING=rotation)
 *
 * Usage:
 *   bun scripts/evals/run-conditioning-floor-replay.ts \
 *     --source <novel-id> \
 *     --pairs output/evals/conditioning-floor-pairs.jsonl \
 *     --experiment-id <n> \
 *     [--out output/evals/conditioning-floor-pairs] \
 *     [--min-words 50] \
 *     [--seed conditioning-floor-v1-replay]
 *
 * Output (--out is a path PREFIX):
 *   <prefix>-fixed-vs-rotation.jsonl   — ship gate (arm_a=fixed, arm_b=rotation)
 *   <prefix>-raw-vs-rotation.jsonl     — diagnostic (arm_a=raw, arm_b=rotation)
 *   <prefix>-raw-vs-fixed.jsonl        — descriptive (arm_a=raw, arm_b=fixed)
 *   <prefix>-triplets.json             — full three-arm audit log
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
import { initExperimentRun } from "../../src/logger"
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

/**
 * Extended PairRow with replay-specific fields.
 *
 * loss_a / loss_b generalize the old loss_fixed / loss_rotation naming.
 * The old field names are preserved for backward compatibility (the judge reads
 * them if loss_a / loss_b are absent).
 */
export type ReplayPairRow = PairRow & {
  /** true if arm_a produced fewer than minWords */
  loss_a?: boolean
  /** true if arm_b produced fewer than minWords */
  loss_b?: boolean
  /** @deprecated Use loss_a. Kept for backward compat with old judge versions. */
  loss_fixed?: boolean
  /** @deprecated Use loss_b. Kept for backward compat with old judge versions. */
  loss_rotation?: boolean
  /** error text if any arm failed all retries */
  error_text?: string
  /** word count produced by arm_a */
  words_a?: number
  /** word count produced by arm_b */
  words_b?: number
  /** @deprecated Use words_a. Kept for backward compat. */
  words_fixed?: number
  /** @deprecated Use words_b. Kept for backward compat. */
  words_rotation?: number
  /** Number of HTTP attempts made for arm_a (should be 1 with noRetries) */
  http_attempts_a?: number
  /** Number of HTTP attempts made for arm_b (should be 1 with noRetries) */
  http_attempts_b?: number
}

/**
 * Per-arm telemetry captured on each writer call. Persisted into the
 * ReplayTriplet and the triplet-audit JSON so post-hoc attribution can
 * distinguish conditioning deltas from cache-hit variance, token drift, or
 * latency noise. Closes Codex telemetry audit finding #2.
 */
export type ArmTelemetry = {
  prose: string
  words: number
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number
  latency_ms: number
  http_attempts: number
  retry_errors: Array<{ status: number; delay: number; error?: string }>
  cost_usd: number
  /** Preset chosen for this arm. "preset-a" for fixed, rotating for rotation, null for raw. */
  preset_name: "preset-a" | "preset-b" | "preset-c" | null
  /** The exampleLines indexes shown in the prompt. null for raw (shows all). */
  preset_indexes: number[] | null
  /** SHA-256 of the user prompt for cheap byte-level replay auditing. */
  user_prompt_hash: string
  error_text?: string
}

/**
 * Internal triplet holding all three arm results for a single beat.
 * Assembled before being fanned out into three PairRow JSONLs.
 */
export type ReplayTriplet = {
  pair_id: string
  pov_character: string
  characters_present: string[]
  beat_description: string
  raw: ArmTelemetry
  fixed: ArmTelemetry
  rotation: ArmTelemetry
  loss_raw: boolean
  loss_fixed: boolean
  loss_rotation: boolean
  error_text?: string
  cost_usd: number
  // Legacy fields preserved for backward compat with fan-out functions + tests.
  raw_prose: string
  fixed_prose: string
  rotation_prose: string
  words_raw: number
  words_fixed: number
  words_rotation: number
  http_attempts_raw: number
  http_attempts_fixed: number
  http_attempts_rotation: number
}

type ParsedArgs = {
  sourceNovelId: string
  pairsPath: string
  outPrefix: string
  experimentId: number
  minWords: number
  seed: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EVAL_ID = "conditioning-floor-slim-live-v1-replay"
const AGENT_NAME = "conditioning-floor-replay"
const DEFAULT_OUT_PREFIX = "output/evals/conditioning-floor-pairs"
const DEFAULT_MIN_WORDS = 50
const DEFAULT_SEED = "conditioning-floor-v1-replay"

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
    console.error("\nFix the above before running. All arms must see IDENTICAL writer routing.")
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
      "  [--out <prefix>] \\\n" +
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

  const outPrefix = get("--out") ?? DEFAULT_OUT_PREFIX
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
    outPrefix: path.resolve(outPrefix),
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
 * noRetries: true is set per charter §6 experiment-discipline guarantee —
 * ensures "conditioning alone differs" isn't contaminated by one arm retrying
 * and another not. Added 2026-04-20 after Codex adversarial round 6 blocker #2.
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
    // Experiment-discipline flag: zero retries so all arms have identical
    // retry behavior. One arm quietly retrying would break the "conditioning
    // alone differs" claim. See LLMRequest.noRetries in src/transport.ts.
    noRetries: true,
  }
}

/**
 * Shared per-beat inputs that must be byte-identical between all three arms.
 *
 * Built ONCE per beat by the caller and passed unchanged into all arm
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

  // Resolve references ONCE. Identical payload feeds all arms.
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
 * Conditioning arm identifier. "raw" means production-default: WRITER_CONDITIONING
 * is unset so resolveWriterPack returns pack.conditioning = undefined and
 * pickExampleLineSubset returns lines.slice(0, 5).
 */
type ArmConditioning = "raw" | "fixed" | "rotation"

/**
 * Call the writer for one arm. noRetries: true is set in buildWriterRequest, so
 * a single provider error immediately returns an error result — no retry loop.
 *
 * For the "raw" arm, WRITER_CONDITIONING is temporarily DELETED so that
 * resolveWriterPack returns pack.conditioning = undefined (real production
 * behavior). For "fixed" and "rotation" arms it is set to the respective value.
 *
 * The env var is always restored to its original state (or deleted if it wasn't
 * set) after the call, regardless of success or failure.
 */
/**
 * Compute the preset_name and preset_indexes that pickExampleLineSubset
 * will select for the given arm + beat coordinates + character line count.
 * Mirrors the logic in src/agents/writer/beat-context.ts so we can persist
 * per-arm preset selection into telemetry without refactoring the renderer.
 * Closes Codex telemetry audit finding #2 (preset metadata not persisted).
 */
export function computePresetSelection(
  conditioning: ArmConditioning,
  chapterNumber: number,
  beatIndex: number,
  charLineCount: number,
): { preset_name: "preset-a" | "preset-b" | "preset-c" | null; preset_indexes: number[] | null } {
  if (conditioning === "raw") return { preset_name: null, preset_indexes: null }
  if (charLineCount < 4) return { preset_name: null, preset_indexes: null }
  const INDEXES_5: Record<"preset-a" | "preset-b" | "preset-c", number[]> = {
    "preset-a": [0, 1, 2], "preset-b": [0, 3, 4], "preset-c": [1, 3, 4],
  }
  const INDEXES_4: Record<"preset-a" | "preset-b" | "preset-c", number[]> = {
    "preset-a": [0, 1, 2], "preset-b": [0, 1, 3], "preset-c": [1, 2, 3],
  }
  const CYCLE: Array<"preset-a" | "preset-b" | "preset-c"> = ["preset-a", "preset-b", "preset-c"]
  const family = charLineCount >= 5 ? INDEXES_5 : INDEXES_4
  const preset: "preset-a" | "preset-b" | "preset-c" =
    conditioning === "fixed" ? "preset-a" : CYCLE[(chapterNumber * 100 + beatIndex) % 3]
  return { preset_name: preset, preset_indexes: family[preset] }
}

async function callWriterArm(
  entry: PairEntry,
  sourceNovelId: string,
  systemPrompt: string,
  pack: NonNullable<ReturnType<typeof resolveWriterPack>>,
  conditioning: ArmConditioning,
  shared: SharedBeatInputs,
): Promise<ArmTelemetry | { error: string }> {
  const originalConditioning = process.env.WRITER_CONDITIONING

  if (conditioning === "raw") {
    delete process.env.WRITER_CONDITIONING
  } else {
    process.env.WRITER_CONDITIONING = conditioning
  }

  // POV character's exampleLines count — drives which preset family
  // pickExampleLineSubset uses. Mirrors src/agents/writer/beat-context.ts.
  const povCharLines = shared.characters.find(
    c => c.name.toLowerCase() === entry.pov_character.toLowerCase(),
  )?.exampleLines?.length ?? 0
  const { preset_name, preset_indexes } = computePresetSelection(
    conditioning, entry.chapter_number, entry.beat_index_in_chapter, povCharLines,
  )

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

    const userPromptHash = createHash("sha256").update(beatCtx.userPrompt).digest("hex")

    const request = buildWriterRequest(systemPrompt, beatCtx.userPrompt, pack)
    const response = await executeAndLog(
      request,
      undefined, // no novelId — experiment-scoped run handles llm_calls persistence
      AGENT_NAME,
      { chapter: entry.chapter_number, beatIndex: entry.beat_index_in_chapter, attempt: 1 },
      {
        meta: {
          evalId: EVAL_ID,
          beatId: `${sourceNovelId}-ch${entry.chapter_number}-b${entry.beat_index_in_chapter}`,
          arm: conditioning,
          source_novel_id: sourceNovelId,
          preset_name,
          preset_indexes,
          user_prompt_hash: userPromptHash,
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

    return {
      prose: response.content,
      words: countWords(response.content),
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      cached_tokens: response.usage.cached_tokens,
      latency_ms: response.latencyMs,
      http_attempts: response.httpAttempts,
      retry_errors: response.retryErrors,
      cost_usd: costUsd,
      preset_name,
      preset_indexes,
      user_prompt_hash: userPromptHash,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`    [${conditioning}] call failed: ${message.slice(0, 120)}`)
    return { error: message }
  } finally {
    if (originalConditioning === undefined) {
      delete process.env.WRITER_CONDITIONING
    } else {
      process.env.WRITER_CONDITIONING = originalConditioning
    }
  }
}

// ── Triplet assembly ──────────────────────────────────────────────────────────

/**
 * Assemble one ReplayTriplet from a pre-registered beat entry.
 *
 * Steps:
 * 1. Build shared beat inputs ONCE (outline, characters, states, world bible,
 *    resolved references, prior-beat prose). All arms see this identical
 *    payload — closes Codex round-5 blocker #2.
 * 2. Call writer with WRITER_CONDITIONING unset     → raw arm
 * 3. Call writer with WRITER_CONDITIONING=fixed     → fixed arm
 * 4. Call writer with WRITER_CONDITIONING=rotation  → rotation arm
 * 5. Check httpAttempts on each response (defense-in-depth): if any arm
 *    retried despite noRetries=true, record the pair as an error so it's
 *    excluded from judging (contaminated by asymmetric retry).
 * 6. Apply minWords loss gate per charter §7.
 */
async function assembleOneTriplet(
  entry: PairEntry,
  sourceNovelId: string,
  genre: string,
  systemPrompt: string,
  pack: NonNullable<ReturnType<typeof resolveWriterPack>>,
  minWords: number,
): Promise<{ triplet: ReplayTriplet; costUsd: number }> {
  const pairId = `${sourceNovelId}-ch${entry.chapter_number}-b${entry.beat_index_in_chapter}`

  // Build shared inputs ONCE. If this fails (e.g. beat out of range), record
  // a mutual-loss triplet and move on.
  const shared = await buildSharedBeatInputs(entry, sourceNovelId, genre)
  if ("error" in shared) {
    return {
      triplet: {
        pair_id: pairId,
        pov_character: entry.pov_character,
        characters_present: entry.characters_present,
        beat_description: entry.description,
        raw_prose: "",
        fixed_prose: "",
        rotation_prose: "",
        words_raw: 0,
        words_fixed: 0,
        words_rotation: 0,
        http_attempts_raw: 0,
        http_attempts_fixed: 0,
        http_attempts_rotation: 0,
        loss_raw: true,
        loss_fixed: true,
        loss_rotation: true,
        error_text: `buildSharedBeatInputs: ${shared.error}`,
        cost_usd: 0,
      },
      costUsd: 0,
    }
  }

  /**
   * Build a sentinel ArmTelemetry for an arm that errored/aborted. Keeps the
   * ReplayTriplet shape uniform even when the writer call never returned.
   */
  const sentinel = (errText: string): ArmTelemetry => ({
    prose: "", words: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0,
    latency_ms: 0, http_attempts: 0, retry_errors: [], cost_usd: 0,
    preset_name: null, preset_indexes: null, user_prompt_hash: "",
    error_text: errText,
  })

  const resolveArm = (r: ArmTelemetry | { error: string }): ArmTelemetry =>
    "error" in r ? sentinel(r.error) : r

  console.log(`    [raw] calling writer...`)
  const rawTel = resolveArm(await callWriterArm(entry, sourceNovelId, systemPrompt, pack, "raw", shared))
  console.log(`    [fixed] calling writer...`)
  const fixedTel = resolveArm(await callWriterArm(entry, sourceNovelId, systemPrompt, pack, "fixed", shared))
  console.log(`    [rotation] calling writer...`)
  const rotationTel = resolveArm(await callWriterArm(entry, sourceNovelId, systemPrompt, pack, "rotation", shared))

  const totalCost = rawTel.cost_usd + fixedTel.cost_usd + rotationTel.cost_usd

  // Defense-in-depth: if any arm retried despite noRetries=true, the pair is
  // contaminated by asymmetric retry behavior — mark as error.
  const retryViolations: string[] = []
  if (rawTel.http_attempts > 1) retryViolations.push(`raw arm made ${rawTel.http_attempts} HTTP attempts`)
  if (fixedTel.http_attempts > 1) retryViolations.push(`fixed arm made ${fixedTel.http_attempts} HTTP attempts`)
  if (rotationTel.http_attempts > 1) retryViolations.push(`rotation arm made ${rotationTel.http_attempts} HTTP attempts`)
  const retryErrorText = retryViolations.length > 0 ? `noRetries violated: ${retryViolations.join("; ")}` : undefined

  // Triplet-level abort on ANY arm failure (Codex round-7 blocker #2).
  const anyArmErrored = !!(rawTel.error_text || fixedTel.error_text || rotationTel.error_text)
  const tripletAbort = retryErrorText !== undefined || anyArmErrored

  if (tripletAbort) {
    const erroredArms: string[] = []
    if (rawTel.error_text) erroredArms.push(`raw: ${rawTel.error_text}`)
    if (fixedTel.error_text) erroredArms.push(`fixed: ${fixedTel.error_text}`)
    if (rotationTel.error_text) erroredArms.push(`rotation: ${rotationTel.error_text}`)
    if (retryErrorText) erroredArms.push(retryErrorText)
    console.warn(`    [TRIPLET-ABORT] ${erroredArms.join("; ")} — all three pair sets drop this beat`)
  }

  const baseErrorText = [rawTel.error_text, fixedTel.error_text, rotationTel.error_text, retryErrorText]
    .filter(Boolean).join("; ") || undefined

  // Loss encoding per charter §7. Triplet-abort forces all three arms to
  // loss; otherwise per-arm word-count gate applies.
  const lossRaw = tripletAbort || rawTel.words < minWords
  const lossFixed = tripletAbort || fixedTel.words < minWords
  const lossRotation = tripletAbort || rotationTel.words < minWords

  return {
    triplet: {
      pair_id: pairId,
      pov_character: entry.pov_character,
      characters_present: entry.characters_present,
      beat_description: entry.description,
      raw: rawTel,
      fixed: fixedTel,
      rotation: rotationTel,
      loss_raw: lossRaw,
      loss_fixed: lossFixed,
      loss_rotation: lossRotation,
      error_text: baseErrorText,
      cost_usd: totalCost,
      // Legacy flat fields for backward-compat with fan-out + existing tests.
      raw_prose: rawTel.prose,
      fixed_prose: fixedTel.prose,
      rotation_prose: rotationTel.prose,
      words_raw: rawTel.words,
      words_fixed: fixedTel.words,
      words_rotation: rotationTel.words,
      http_attempts_raw: rawTel.http_attempts,
      http_attempts_fixed: fixedTel.http_attempts,
      http_attempts_rotation: rotationTel.http_attempts,
    },
    costUsd: totalCost,
  }
}

// ── Triplet → PairRow fan-out ─────────────────────────────────────────────────

/**
 * Convert a triplet into a PairRow for the fixed-vs-rotation pair set (ship gate).
 * arm_a = fixed, arm_b = rotation.
 */
export function tripletToFixedVsRotation(t: ReplayTriplet): ReplayPairRow {
  return {
    pair_id: t.pair_id,
    pov_character: t.pov_character,
    characters_present: t.characters_present,
    beat_description: t.beat_description,
    arm_a_prose: t.fixed_prose,
    arm_b_prose: t.rotation_prose,
    arm_a_label: "fixed",
    arm_b_label: "rotation",
    loss_a: t.loss_fixed || undefined,
    loss_b: t.loss_rotation || undefined,
    // backward compat aliases
    loss_fixed: t.loss_fixed || undefined,
    loss_rotation: t.loss_rotation || undefined,
    error_text: t.error_text,
    words_a: t.words_fixed || undefined,
    words_b: t.words_rotation || undefined,
    words_fixed: t.words_fixed || undefined,
    words_rotation: t.words_rotation || undefined,
    http_attempts_a: t.http_attempts_fixed || undefined,
    http_attempts_b: t.http_attempts_rotation || undefined,
  }
}

/**
 * Convert a triplet into a PairRow for the raw-vs-rotation pair set (diagnostic).
 * arm_a = raw, arm_b = rotation.
 */
export function tripletToRawVsRotation(t: ReplayTriplet): ReplayPairRow {
  return {
    pair_id: t.pair_id,
    pov_character: t.pov_character,
    characters_present: t.characters_present,
    beat_description: t.beat_description,
    arm_a_prose: t.raw_prose,
    arm_b_prose: t.rotation_prose,
    arm_a_label: "raw",
    arm_b_label: "rotation",
    loss_a: t.loss_raw || undefined,
    loss_b: t.loss_rotation || undefined,
    error_text: t.error_text,
    words_a: t.words_raw || undefined,
    words_b: t.words_rotation || undefined,
    http_attempts_a: t.http_attempts_raw || undefined,
    http_attempts_b: t.http_attempts_rotation || undefined,
  }
}

/**
 * Convert a triplet into a PairRow for the raw-vs-fixed pair set (descriptive).
 * arm_a = raw, arm_b = fixed.
 */
export function tripletToRawVsFixed(t: ReplayTriplet): ReplayPairRow {
  return {
    pair_id: t.pair_id,
    pov_character: t.pov_character,
    characters_present: t.characters_present,
    beat_description: t.beat_description,
    arm_a_prose: t.raw_prose,
    arm_b_prose: t.fixed_prose,
    arm_a_label: "raw",
    arm_b_label: "fixed",
    loss_a: t.loss_raw || undefined,
    loss_b: t.loss_fixed || undefined,
    error_text: t.error_text,
    words_a: t.words_raw || undefined,
    words_b: t.words_fixed || undefined,
    http_attempts_a: t.http_attempts_raw || undefined,
    http_attempts_b: t.http_attempts_fixed || undefined,
  }
}

// ── Experiment-spine helpers (Codex telemetry audit #6) ─────────────────────

async function sha256OfFile(p: string): Promise<string> {
  const content = await readFile(path.resolve(p), "utf8")
  return createHash("sha256").update(content).digest("hex")
}

/**
 * Validate that the tuning_experiments row exists and has a non-null
 * commit_hash, then merge replay provenance metadata into its config JSON.
 * Fails closed if either check breaks — Codex telemetry audit #6 flagged
 * that createTuningExperiment() allows commit_hash to be null and the replay
 * CLI wasn't updating the config with source novel, pair-file SHA, artifact
 * paths, etc. After this, the experiment row has the full replay provenance
 * and the run can be SQL-joined back to it via runs.experiment_id.
 */
async function validateAndUpdateExperimentSpine(
  experimentId: number,
  meta: Record<string, unknown>,
): Promise<void> {
  const rows = await db<Array<{ id: number; commit_hash: string | null; config: Record<string, unknown> | null }>>`
    SELECT id, commit_hash, config FROM tuning_experiments WHERE id = ${experimentId}
  `
  if (rows.length === 0) {
    console.error(`[replay] tuning_experiments row ${experimentId} not found — create it first`)
    process.exit(1)
  }
  const row = rows[0]
  if (!row.commit_hash) {
    console.error(`[replay] tuning_experiments.commit_hash is NULL for experiment ${experimentId} — fail-closed per Codex audit #6`)
    console.error(`[replay] fix: re-create the experiment after committing the runtime state, or UPDATE tuning_experiments SET commit_hash = ... WHERE id = ${experimentId}`)
    process.exit(1)
  }
  const existing = row.config ?? {}
  const merged = { ...existing, replay: meta }
  await db`UPDATE tuning_experiments SET config = ${merged} WHERE id = ${experimentId}`
  console.log(`[replay] tuning_experiments #${experimentId} spine OK (commit ${row.commit_hash.slice(0, 8)}); config.replay updated`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Guardrails (closes Codex leaks #2 + #5)
  assertGuardrails()

  const args = parseArgs()
  const { sourceNovelId, pairsPath, outPrefix, experimentId, minWords } = args
  // Note: --seed is accepted for CLI backward compatibility but not used by
  // this script. The judge wrapper (conditioning-floor-judge.ts) owns the
  // A/B shuffle so there is a single seed owner (Codex round-5 warning #1).

  // Derive output file paths from prefix
  const outFixedVsRotation = `${outPrefix}-fixed-vs-rotation.jsonl`
  const outRawVsRotation = `${outPrefix}-raw-vs-rotation.jsonl`
  const outRawVsFixed = `${outPrefix}-raw-vs-fixed.jsonl`
  const outTriplets = `${outPrefix}-triplets.json`

  // 1a. Telemetry spine — verify the experiment row, assert commit_hash, and
  // update config JSON with the full replay provenance. Closes Codex audit #6.
  await validateAndUpdateExperimentSpine(experimentId, {
    source_novel_id: sourceNovelId,
    pairs_path: pairsPath,
    pairs_sha256: await sha256OfFile(pairsPath),
    min_words: minWords,
    out_prefix: outPrefix,
    out_files: {
      fixed_vs_rotation: outFixedVsRotation,
      raw_vs_rotation: outRawVsRotation,
      raw_vs_fixed: outRawVsFixed,
      triplets: outTriplets,
    },
    no_retries: true,
    started_at: new Date().toISOString(),
  })

  // 1b. Telemetry spine — create an experiment-scoped run so every writer call
  // lands in llm_calls under runs.experiment_id = this experiment. Closes
  // Codex audit #1 (writer calls previously bypassed the canonical ledger).
  const runId = await initExperimentRun(
    experimentId,
    "conditioning-floor-replay",
    sourceNovelId,
    "slim-live-v1-replay-3arm",
  )

  console.log(`\n[replay] Source novel:   ${sourceNovelId}`)
  console.log(`[replay] Pairs file:     ${pairsPath}`)
  console.log(`[replay] Out prefix:     ${outPrefix}`)
  console.log(`[replay] Experiment ID:  ${experimentId}`)
  console.log(`[replay] Run ID:         ${runId}  (runs.experiment_id=${experimentId} for SQL joins)`)
  console.log(`[replay] Min words:      ${minWords}`)
  console.log(`[replay] Shuffle:        deferred to judge wrapper (single seed owner)`)
  console.log(`[replay] Arms:           raw / fixed / rotation`)
  console.log(`[replay] noRetries:      true (charter §6 experiment discipline)`)

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
  const triplets: ReplayTriplet[] = []
  let totalCostUsd = 0
  let lossCount = 0
  let errorCount = 0

  for (const entry of entries) {
    const label = `ch${entry.chapter_number}-b${entry.beat_index_in_chapter} (global #${entry.global_beat_index})`
    console.log(`\n[replay] Processing ${label} — "${entry.description.slice(0, 60)}..."`)

    try {
      const { triplet, costUsd } = await assembleOneTriplet(
        entry, sourceNovelId, genre, systemPrompt, pack, minWords,
      )
      triplets.push(triplet)
      totalCostUsd += costUsd

      const hadLoss = triplet.loss_raw || triplet.loss_fixed || triplet.loss_rotation
      const hadError = !!triplet.error_text

      if (hadError && triplet.loss_raw && triplet.loss_fixed && triplet.loss_rotation) {
        errorCount++
        console.log(`  [SKIP] error: ${triplet.error_text}`)
      } else if (hadLoss) {
        lossCount++
        const lossArms = [
          triplet.loss_raw && "raw",
          triplet.loss_fixed && "fixed",
          triplet.loss_rotation && "rotation",
        ].filter(Boolean).join("+")
        console.log(`  [LOSS] ${lossArms} arm(s) below ${minWords}-word threshold (raw=${triplet.words_raw}w, fixed=${triplet.words_fixed}w, rotation=${triplet.words_rotation}w)`)
      } else {
        console.log(`  [OK]   raw=${triplet.words_raw}w, fixed=${triplet.words_fixed}w, rotation=${triplet.words_rotation}w, cost=$${costUsd.toFixed(5)}`)
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      console.error(`  [ERROR] unexpected error on pair ${label}: ${errorText}`)

      // Emit a full-loss triplet so the pair is counted (not dropped) per charter §7
      triplets.push({
        pair_id: `${sourceNovelId}-ch${entry.chapter_number}-b${entry.beat_index_in_chapter}`,
        pov_character: entry.pov_character,
        characters_present: entry.characters_present,
        beat_description: entry.description,
        raw_prose: "",
        fixed_prose: "",
        rotation_prose: "",
        words_raw: 0,
        words_fixed: 0,
        words_rotation: 0,
        http_attempts_raw: 0,
        http_attempts_fixed: 0,
        http_attempts_rotation: 0,
        loss_raw: true,
        loss_fixed: true,
        loss_rotation: true,
        error_text: errorText,
        cost_usd: 0,
      })
      errorCount++
    }
  }

  // 7. Fan triplets out into three PairRow JSONL files
  const fixedVsRotationRows = triplets.map(tripletToFixedVsRotation)
  const rawVsRotationRows = triplets.map(tripletToRawVsRotation)
  const rawVsFixedRows = triplets.map(tripletToRawVsFixed)

  await mkdir(path.dirname(outPrefix), { recursive: true })

  await writeFile(
    outFixedVsRotation,
    fixedVsRotationRows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8"
  )
  await writeFile(
    outRawVsRotation,
    rawVsRotationRows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8"
  )
  await writeFile(
    outRawVsFixed,
    rawVsFixedRows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8"
  )
  await writeFile(
    outTriplets,
    JSON.stringify(triplets, null, 2) + "\n",
    "utf8"
  )

  // 8. Persist results to eval_results for provenance (one row per triplet)
  for (const triplet of triplets) {
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
          ${triplet.pair_id},
          ${pack.model.model},
          ${"assembled"},
          ${JSON.stringify({
            loss_raw: triplet.loss_raw,
            loss_fixed: triplet.loss_fixed,
            loss_rotation: triplet.loss_rotation,
            words_raw: triplet.words_raw,
            words_fixed: triplet.words_fixed,
            words_rotation: triplet.words_rotation,
            http_attempts_raw: triplet.http_attempts_raw,
            http_attempts_fixed: triplet.http_attempts_fixed,
            http_attempts_rotation: triplet.http_attempts_rotation,
          })},
          ${0},
          ${triplet.error_text ?? null}
        )
      `
    } catch (dbErr) {
      console.warn(`[warn] Failed to persist eval_result for ${triplet.pair_id}: ${dbErr instanceof Error ? dbErr.message : dbErr}`)
    }
  }

  // 9. Summary
  const validTriplets = triplets.filter((t) => !t.loss_raw && !t.loss_fixed && !t.loss_rotation && !t.error_text)
  console.log("\n── Replay Summary ───────────────────────────────────────")
  console.log(`  Total pairs processed:          ${triplets.length}`)
  console.log(`  Valid triplets (all arms OK):   ${validTriplets.length}`)
  console.log(`  Pairs with a loss arm:          ${lossCount}`)
  console.log(`  Pairs with errors:              ${errorCount}`)
  console.log(`  Total writer call cost:         $${totalCostUsd.toFixed(5)}`)
  console.log("")
  console.log(`  Output files:`)
  console.log(`    Ship gate:   ${outFixedVsRotation}`)
  console.log(`    Diagnostic:  ${outRawVsRotation}`)
  console.log(`    Descriptive: ${outRawVsFixed}`)
  console.log(`    Audit log:   ${outTriplets}`)
  console.log("")
  console.log("  Per-pair word counts:")
  for (const triplet of triplets) {
    const status = triplet.error_text
      ? "[ERR]"
      : (triplet.loss_raw || triplet.loss_fixed || triplet.loss_rotation ? "[LOSS]" : "[OK]")
    console.log(`    ${status} ${triplet.pair_id}: raw=${triplet.words_raw}w, fixed=${triplet.words_fixed}w, rotation=${triplet.words_rotation}w`)
  }
  console.log("─────────────────────────────────────────────────────────")
  console.log(`\nDone. Pass the pair JSONLs to conditioning-floor-judge.ts with --set-name to control eval_results.set_name:`)
  console.log(`  Ship gate:   --pairs ${outFixedVsRotation} --set-name conditioning-floor-slim-live-v1-replay-fixed-vs-rotation`)
  console.log(`  Diagnostic:  --pairs ${outRawVsRotation} --set-name conditioning-floor-slim-live-v1-replay-raw-vs-rotation`)
  console.log(`  Descriptive: --pairs ${outRawVsFixed} --set-name conditioning-floor-slim-live-v1-replay-raw-vs-fixed`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
