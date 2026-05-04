/**
 * Editorial Beat-Coverage Producer (Phase 5 commit 2 — tracer bullet).
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 5 — Editorial Proposal Workbench"
 *
 * The first LLM editorial module under the Phase-5 workflow. Reads a
 * chapter draft + the chapter outline (the planner's beat contract) and
 * asks the LLM, beat-by-beat, whether the draft prose covers the planned
 * beat. Each uncovered beat becomes one `EditorialFlagProposal` of kind
 * `missing-beat-coverage`, wrapped into an `EditorialFlagEnvelope` ready
 * for the workbench (Phase 5 commits 3-4 ship typed persistence + apply).
 *
 * **Why beat-coverage first.** Phase 5 names two candidates for the
 * tracer bullet — chapter-contract coverage and continuity-against-Canon.
 * Beat-coverage is the cleaner first surface: the reference data (a
 * structured beat list) is already typed, the LLM job is per-beat
 * boolean + evidence quote (low schema complexity), and uncovered beats
 * map 1:1 to flag proposals with no entity-resolution / cross-fact-graph
 * reasoning. Continuity-against-Canon needs the canon facts loader plus
 * cross-fact ranking; it ships in a later Phase-5 commit once the
 * editorial plumbing is exercised.
 *
 * **DI'd LLM call.** The orchestrator `runEditorialBeatCoverageCheck`
 * takes a `callLLM` function as a parameter. Tests pass a mock that
 * returns a fixed `BeatCoverageLlmOutput`; production wiring (a future
 * commit) threads `callAgent` from `src/agents/index.ts`. This keeps the
 * tracer-bullet shape pure-testable without a transport stub layer.
 *
 * **No DB writes here.** This commit ships envelope construction only.
 * Persistence (`insertEditorialFlagEnvelope`) is Phase 5 commit 3, after
 * a real producer demonstrates the envelope shape lands cleanly.
 */

import { z } from "zod"
import type { ChapterOutline } from "../types"
import {
  buildEditorialFlagEnvelope,
  type EditorialFlagEnvelope,
  type EditorialFlagProposal,
  type EditorialFlagSeverity,
} from "./editorial-proposal"

// ── LLM output schema ───────────────────────────────────────────────────

/**
 * Per-beat verdict the LLM returns. `beatIndex` is 0-based to match
 * `outline.scenes[i]` directly. `evidenceQuote` is required when
 * `covered=true` (the model must show its work) and optional when
 * `covered=false` (no quote to give).
 *
 * The model is instructed to use INDICES, not beat ids, because beat ids
 * (`b1`, `b2`, …) and stable hashed `beatId`s coexist in the planner
 * data and the index is the single canonical reference shared by every
 * shape of outline.
 */
export const beatCoverageVerdictSchema = z
  .object({
    beatIndex: z.number().int().nonnegative(),
    covered: z.boolean(),
    evidenceQuote: z.string().optional(),
    reason: z.string(),
  })
  .refine(
    v => !v.covered || (typeof v.evidenceQuote === "string" && v.evidenceQuote.length > 0),
    {
      message: "evidenceQuote is required (and non-empty) when covered=true",
      path: ["evidenceQuote"],
    },
  )

export type BeatCoverageVerdict = z.infer<typeof beatCoverageVerdictSchema>

export const beatCoverageLlmOutputSchema = z.object({
  beatVerdicts: z.array(beatCoverageVerdictSchema),
})

export type BeatCoverageLlmOutput = z.infer<typeof beatCoverageLlmOutputSchema>

/**
 * OpenCode review MEDIUM H1: post-validate the LLM output against the
 * outline so the producer can't silently swallow malformed responses.
 * Returns null on success; returns an error message describing the
 * first detected violation otherwise. Throwing is the caller's choice
 * (the orchestrator throws; a tolerant caller can collect issues).
 *
 * Checks:
 *   1. Exactly one verdict per outline beat (no missing).
 *   2. No duplicate verdicts on the same beatIndex.
 *   3. No out-of-range beatIndex (>= outline.scenes.length).
 */
export function validateBeatCoverageLlmOutput(
  output: BeatCoverageLlmOutput,
  outline: ChapterOutline,
): string | null {
  const expected = outline.scenes.length
  const seen = new Set<number>()
  const seenDup: number[] = []
  for (const v of output.beatVerdicts) {
    if (v.beatIndex >= expected) {
      return `beatIndex ${v.beatIndex} out of range (outline has ${expected} beats; valid 0..${expected - 1})`
    }
    if (seen.has(v.beatIndex)) {
      seenDup.push(v.beatIndex)
    }
    seen.add(v.beatIndex)
  }
  if (seenDup.length > 0) {
    return `duplicate beatIndex verdicts: ${seenDup.join(", ")}`
  }
  if (seen.size !== expected) {
    const missing: number[] = []
    for (let i = 0; i < expected; i++) {
      if (!seen.has(i)) missing.push(i)
    }
    return `missing verdicts for beatIndex ${missing.join(", ")} (outline has ${expected} beats; LLM emitted ${seen.size})`
  }
  return null
}

// ── System prompt ───────────────────────────────────────────────────────

export const EDITORIAL_BEAT_COVERAGE_SYSTEM_PROMPT = `You are an editorial coverage checker. Your job is to verify whether each planned chapter beat actually appears in the chapter draft prose.

For each beat listed by the user, decide:
  - covered: true if the beat's planned events / character moments appear in the prose; false if missing, partial, or unclear.
  - evidenceQuote: a short verbatim quote from the prose pinning the coverage (REQUIRED when covered=true; omit when covered=false).
  - reason: one sentence — what was found if covered, or what's missing / unclear if uncovered.

Return JSON of shape:
{
  "beatVerdicts": [
    { "beatIndex": 0, "covered": true,  "evidenceQuote": "...", "reason": "..." },
    { "beatIndex": 1, "covered": false,                          "reason": "..." }
  ]
}

Beat indices are 0-based and must match the indices from the user prompt's beat list. Emit one verdict per beat the user listed; do not skip beats and do not invent beats outside the listed range.

Be conservative — when the prose only loosely gestures at a beat, mark uncovered. A beat is "covered" only when concrete prose maps to its planned events.`

// ── User-prompt builder ─────────────────────────────────────────────────

/**
 * Assemble the user-facing prompt: chapter metadata, the beat list with
 * 0-based indices (so the model returns indices the parser can dispatch
 * to `outline.scenes[i]`), then the draft prose.
 *
 * Beats are listed without their planner-side `obligations` /
 * `requiredPayoffs` fields — the coverage check is "did the events
 * happen?", not "did every obligation land?". Obligation-level checks
 * are a separate editorial module (a Phase 5 commit 2 follow-on).
 */
export function buildBeatCoveragePrompt(
  prose: string,
  outline: ChapterOutline,
): string {
  const lines: string[] = []
  lines.push(`CHAPTER ${outline.chapterNumber}: "${outline.title}"`)
  if (outline.povCharacter) lines.push(`POV: ${outline.povCharacter}`)
  if (outline.setting) lines.push(`Setting: ${outline.setting}`)
  if (outline.purpose) lines.push(`Purpose: ${outline.purpose}`)
  lines.push("")
  lines.push("BEATS TO VERIFY COVERAGE FOR (0-based indices):")
  outline.scenes.forEach((s, i) => {
    const kind = s.kind ? ` [${s.kind}]` : ""
    lines.push(`  Beat ${i}${kind}: ${s.description}`)
    if (s.characters && s.characters.length > 0) {
      lines.push(`    Characters: ${s.characters.join(", ")}`)
    }
  })
  lines.push("")
  lines.push("DRAFT PROSE:")
  lines.push(prose)
  lines.push("")
  lines.push(
    "For each beat above, return a verdict per the system instructions. Use the same 0-based beatIndex.",
  )
  return lines.join("\n")
}

// ── Pure: LLM output → EditorialFlagProposal[] ──────────────────────────

export interface BuildBeatCoverageProposalsArgs {
  llmOutput: BeatCoverageLlmOutput
  outline: ChapterOutline
  /**
   * Canonical chapter reference for the proposal payload's `chapterRef`
   * field. MUST equal the `chapterRef` the caller will pass to
   * `buildBeatCoverageEnvelopes` so the proposal payload and the
   * envelope target both point at the same chapter (OpenCode review
   * MEDIUM H2: pre-fix, the proposal derived `chapterRef` from
   * `outline.chapterId` while the envelope target used the caller's
   * `chapterRef`; enriching `chapterId` later moved the proposal-level
   * id seed, breaking determinism for the same beat across runs).
   */
  chapterRef: string
  /**
   * Severity to assign to each "missing-beat-coverage" flag. Defaults to
   * "warning" — the operator can review and choose to escalate. A
   * stricter caller (e.g., a future blocker-class drafting gate) can
   * pass "blocker" so the Phase-6 policy auto-routes these as gating.
   */
  uncoveredSeverity?: EditorialFlagSeverity
}

/**
 * Pure function: given the LLM verdict list and the outline, emit one
 * `EditorialFlagProposal` per uncovered beat. Defensive against:
 *
 *   - `beatIndex` out of range (model hallucinated an index — silently skipped).
 *   - duplicate `beatIndex` entries (use the first uncovered verdict per index).
 *   - covered=true verdicts (no flag).
 *
 * The proposal carries the model's `reason` as a single evidence quote
 * (no `ref` — it's a model-generated claim, not a verbatim prose span)
 * and a synthesized `suggestedAction` pointing back at the planner beat
 * description.
 */
export function buildBeatCoverageProposalsFromLlm(
  args: BuildBeatCoverageProposalsArgs,
): EditorialFlagProposal[] {
  const severity: EditorialFlagSeverity = args.uncoveredSeverity ?? "warning"
  const seenIndex = new Set<number>()
  const proposals: EditorialFlagProposal[] = []
  for (const v of args.llmOutput.beatVerdicts) {
    if (v.covered) continue
    if (seenIndex.has(v.beatIndex)) continue
    seenIndex.add(v.beatIndex)
    const beat = args.outline.scenes[v.beatIndex]
    if (!beat) continue
    const beatNumber1Based = v.beatIndex + 1
    proposals.push({
      issueType: "missing-beat-coverage",
      severity,
      beatRef: `b${beatNumber1Based}`,
      chapterRef: args.chapterRef,
      canonRefs: [],
      evidenceQuotes: v.reason ? [{ text: v.reason }] : [],
      suggestedAction:
        `Add coverage for beat ${beatNumber1Based} (${beat.description}).`,
    })
  }
  return proposals
}

// ── Pure: proposals → envelopes ─────────────────────────────────────────

export interface BuildBeatCoverageEnvelopesArgs {
  novelId: string
  chapterRef: string
  proposals: readonly EditorialFlagProposal[]
  /** Stable producer id (e.g. `"editorial-beat-coverage"`). */
  agent: string
  /** Hash of the draft the LLM saw — pinned as the precondition. */
  draftHash: string
  /** Operator-facing rationale for why the check ran. */
  rationale: string
  now: Date
  /**
   * Optional regen lineage (Phase 5 will wire this when persistence + UI
   * regen lands; included here for forward compatibility — the builder
   * already accepts it from Phase 5 commit 1).
   */
  parentEnvelopeId?: string
}

export function buildBeatCoverageEnvelopes(
  args: BuildBeatCoverageEnvelopesArgs,
): EditorialFlagEnvelope[] {
  return args.proposals.map((p, i) =>
    buildEditorialFlagEnvelope({
      novelId: args.novelId,
      chapterRef: args.chapterRef,
      proposal: p,
      proposalIndex: i,
      agent: args.agent,
      draftHash: args.draftHash,
      rationale: args.rationale,
      now: args.now,
      parentEnvelopeId: args.parentEnvelopeId,
    }),
  )
}

// ── Orchestrator: prompt → LLM (DI) → envelopes ─────────────────────────

export type EditorialBeatCoverageCallLlm = (args: {
  systemPrompt: string
  userPrompt: string
}) => Promise<unknown>

export interface RunEditorialBeatCoverageArgs {
  novelId: string
  /** Stable chapter reference for the envelope target (e.g. `chapter:12`). */
  chapterRef: string
  prose: string
  outline: ChapterOutline
  /** Hash of the draft prose — the envelope precondition pins this. */
  draftHash: string
  /** Stable producer id; defaults to `"editorial-beat-coverage"`. */
  agent?: string
  /** Severity for uncovered-beat flags; defaults to `"warning"`. */
  uncoveredSeverity?: EditorialFlagSeverity
  /** Override timestamp; defaults to `new Date()` at call time. */
  now?: Date
  /** Operator-facing rationale stored on each envelope. */
  rationale?: string
  /** DI'd LLM transport; tests inject a mock returning `BeatCoverageLlmOutput`. */
  callLLM: EditorialBeatCoverageCallLlm
  /** Optional regen lineage. */
  parentEnvelopeId?: string
}

export interface RunEditorialBeatCoverageResult {
  envelopes: EditorialFlagEnvelope[]
  /** The parsed LLM output, exposed for telemetry / debugging. */
  rawOutput: BeatCoverageLlmOutput
  /** The user prompt that was sent (exposed for telemetry / debugging). */
  userPrompt: string
}

/**
 * End-to-end tracer-bullet: build the prompt, fire the LLM, parse the
 * output, build envelopes for uncovered beats. Returns the envelopes
 * plus the raw output for caller-side telemetry.
 *
 * Throws on:
 *   - schema parse failure (covered=true without evidenceQuote, etc.)
 *   - structural validation failure (missing/duplicate/out-of-range
 *     beatIndex), per OpenCode MEDIUM H1.
 *
 * Caller decides whether to retry / escalate / log telemetry on either
 * throw class.
 */
export async function runEditorialBeatCoverageCheck(
  args: RunEditorialBeatCoverageArgs,
): Promise<RunEditorialBeatCoverageResult> {
  const userPrompt = buildBeatCoveragePrompt(args.prose, args.outline)
  const raw = await args.callLLM({
    systemPrompt: EDITORIAL_BEAT_COVERAGE_SYSTEM_PROMPT,
    userPrompt,
  })
  const parsed = beatCoverageLlmOutputSchema.parse(raw)
  const validationError = validateBeatCoverageLlmOutput(parsed, args.outline)
  if (validationError !== null) {
    throw new Error(`editorial beat-coverage validation failed: ${validationError}`)
  }
  const proposals = buildBeatCoverageProposalsFromLlm({
    llmOutput: parsed,
    outline: args.outline,
    chapterRef: args.chapterRef,
    uncoveredSeverity: args.uncoveredSeverity,
  })
  const envelopes = buildBeatCoverageEnvelopes({
    novelId: args.novelId,
    chapterRef: args.chapterRef,
    proposals,
    agent: args.agent ?? "editorial-beat-coverage",
    draftHash: args.draftHash,
    rationale:
      args.rationale ??
      `Editorial beat-coverage check on ${args.chapterRef}.`,
    now: args.now ?? new Date(),
    parentEnvelopeId: args.parentEnvelopeId,
  })
  return { envelopes, rawOutput: parsed, userPrompt }
}
