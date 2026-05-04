/**
 * Editorial Proposal payload schemas (Phase 5 commit 1).
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 5 — Editorial Proposal Workbench"
 *
 * Two payload shapes that ride on the shared `ReviewProposalEnvelope`
 * structure from Phase 3 commit 1:
 *
 *   - `EditorialFlagProposal` — "this draft has a problem" — issue type,
 *     severity, evidence quotes, beat/chapter refs, canon refs, suggested
 *     action. The output of an editorial-LLM (or deterministic check) saying
 *     "review this; here's why."
 *
 *   - `ProseEditProposal` — "here's a specific edit to apply" — draft
 *     version, target span/beat ref, replacement text, rationale. The
 *     concrete patch the workbench can apply (or that the operator can
 *     accept/modify/reject).
 *
 * Both are payloads for an envelope kind already declared in
 * `proposal-envelope.ts`'s `ProposalEnvelopeKind` enum (`editorial_flag`,
 * `prose_edit`). Persistence in `proposal_envelopes` is automatic — the
 * polymorphic `payload` JSONB column from Phase 3 commit 4 already
 * accepts any kind's shape; this commit just defines what the shape is
 * for the editorial kinds.
 *
 * No LLM editorial module ships in this commit (that's Phase 5 commit 2,
 * which produces these proposal shapes from a real chapter draft).
 * No persistence helpers — `insertArtifactPatchEnvelope` from
 * `src/db/proposal-envelopes.ts` is artifact_patch-specific; future
 * commits add `insertEditorialFlagEnvelope` etc. once a real producer
 * exists. Decoupling schema definition from producer + persistence
 * lets the schema land first and stabilize before we wire producers
 * around it.
 */

import { createHash } from "node:crypto"
import { z } from "zod"
import type {
  ProposalEnvelopeRisk,
  ReviewProposalEnvelope,
} from "./proposal-envelope"

// ── EditorialFlagProposal ───────────────────────────────────────────────

/**
 * Categories of editorial issue. Kept narrow at MVP — adding a category
 * is cheap, but the union should reflect what producers actually emit
 * so the UI's filter/sort surfaces stay meaningful.
 *
 * Semantics:
 *   - `off-canon`             — draft contradicts an approved canon fact.
 *   - `missing-beat-coverage` — chapter outline beat has no clear coverage in the draft.
 *   - `tone-drift`            — voice/style drifts from the world's established register.
 *   - `logic-error`           — internal contradiction (cause/effect, character knowledge, time).
 *   - `obligation-unfulfilled`— a planner-declared writer obligation isn't satisfied.
 *   - `other`                 — escape hatch for cases we haven't categorized; producer
 *                               should still set `summary` + `rationale` clearly.
 */
export type EditorialFlagIssueType =
  | "off-canon"
  | "missing-beat-coverage"
  | "tone-drift"
  | "logic-error"
  | "obligation-unfulfilled"
  | "other"

export const editorialFlagIssueTypeSchema = z.enum([
  "off-canon",
  "missing-beat-coverage",
  "tone-drift",
  "logic-error",
  "obligation-unfulfilled",
  "other",
])

/**
 * Severity dictates default policy routing in Phase 6's evaluator:
 *   - `info`     — informational only; auto-shadow by default.
 *   - `warning`  — flag for review; queue for human.
 *   - `blocker`  — must be resolved before drafting can complete.
 *
 * The Phase 6 ApprovalPolicy can override these defaults; the severity
 * is the producer's recommended level, not the binding decision.
 */
export type EditorialFlagSeverity = "info" | "warning" | "blocker"

export const editorialFlagSeveritySchema = z.enum(["info", "warning", "blocker"])

/**
 * One quoted span of evidence. `text` is the verbatim quote (writer/
 * checker output, draft prose, beat description); `ref` (when present)
 * is a stable locator the UI can render as a click-to-scroll target —
 * format examples: `chapter:12#beat:b3` / `draft:v2#span:1024-1086` /
 * `canon:fact:c1-f1`.
 */
export interface EditorialEvidenceQuote {
  text: string
  ref?: string
}

export const editorialEvidenceQuoteSchema = z.object({
  text: z.string(),
  ref: z.string().optional(),
})

/** Optional canonical reference to a canon fact / state / promise. */
export interface EditorialCanonRef {
  kind: "fact" | "state" | "promise" | "payoff"
  id: string
}

export const editorialCanonRefSchema = z.object({
  kind: z.enum(["fact", "state", "promise", "payoff"]),
  id: z.string(),
})

/**
 * The flag proposal payload itself. Producers (an LLM editorial module,
 * or a deterministic check) emit one of these per identified issue.
 *
 * `suggestedAction` is free-form prose — the producer's recommendation
 * for what should happen ("delete the second sentence of beat b3";
 * "add a sensory detail consistent with humid-air world setting"). It's
 * NOT a machine-applicable patch (that's `ProseEditProposal`'s job);
 * it's the operator-facing hint for what kind of fix is wanted.
 */
export interface EditorialFlagProposal {
  issueType: EditorialFlagIssueType
  severity: EditorialFlagSeverity
  /** Stable refs to where the issue lives. */
  beatRef?: string
  chapterRef?: string
  /** Canon refs the issue interacts with (e.g. the contradicted fact). */
  canonRefs: readonly EditorialCanonRef[]
  /** Quoted evidence pinning the claim. Empty arrays mean "no quote available." */
  evidenceQuotes: readonly EditorialEvidenceQuote[]
  suggestedAction: string
}

export const editorialFlagProposalSchema: z.ZodType<EditorialFlagProposal> = z.object({
  issueType: editorialFlagIssueTypeSchema,
  severity: editorialFlagSeveritySchema,
  beatRef: z.string().optional(),
  chapterRef: z.string().optional(),
  canonRefs: z.array(editorialCanonRefSchema),
  evidenceQuotes: z.array(editorialEvidenceQuoteSchema),
  suggestedAction: z.string(),
})

export type EditorialFlagEnvelope = ReviewProposalEnvelope<EditorialFlagProposal> & {
  kind: "editorial_flag"
}

// ── ProseEditProposal ───────────────────────────────────────────────────

/**
 * The target of a prose edit — a span (offset range in a draft string)
 * or a beat (named beat slot in a chapter outline). Span targets are
 * the typical case; beat targets are useful when the producer wants
 * to suggest "rewrite this entire beat" without committing to specific
 * offsets.
 *
 * Span targets carry `start`/`end` byte offsets *into the draft text
 * version recorded in `draftVersion`*. Drafts are versioned — the
 * `precondition.hash` on the envelope must match the draft hash at
 * apply time, or the apply rejects (analogous to artifact_patch
 * envelopes' currentVersion check).
 */
export type ProseEditTarget =
  | { kind: "span"; chapterRef: string; start: number; end: number }
  | { kind: "beat"; chapterRef: string; beatRef: string }

export const proseEditTargetSchema: z.ZodType<ProseEditTarget> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("span"),
    chapterRef: z.string(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("beat"),
    chapterRef: z.string(),
    beatRef: z.string(),
  }),
])

/**
 * The patch payload itself. The replacement text REPLACES the targeted
 * span or beat content in the draft version pinned by the envelope's
 * precondition. Rationale is the operator-facing explanation.
 */
export interface ProseEditProposal {
  /** Stable identifier for the source draft (e.g. `chapter:12:draft:v3`). */
  draftVersion: string
  target: ProseEditTarget
  /** Verbatim replacement. Empty string = delete the span. */
  replacement: string
  rationale: string
}

export const proseEditProposalSchema: z.ZodType<ProseEditProposal> = z.object({
  draftVersion: z.string(),
  target: proseEditTargetSchema,
  replacement: z.string(),
  rationale: z.string(),
})

export type ProseEditEnvelope = ReviewProposalEnvelope<ProseEditProposal> & {
  kind: "prose_edit"
}

// ── Builders ────────────────────────────────────────────────────────────

const ENVELOPE_ID_VERSION = "v1"

interface BuildEditorialFlagEnvelopeArgs {
  novelId: string
  chapterRef: string
  proposal: EditorialFlagProposal
  proposalIndex: number
  /** The producer (e.g. "editorial-flag-checker"). Stable id, not a model name. */
  agent: string
  /** The hash committed against. For a chapter-scoped flag this is the chapter draft hash. */
  draftHash: string
  rationale: string
  now: Date
  /** Optional regen lineage (Phase 5 will mirror Phase 3's commit-4 pattern when persistence lands). */
  parentEnvelopeId?: string
}

interface BuildProseEditEnvelopeArgs {
  novelId: string
  proposal: ProseEditProposal
  proposalIndex: number
  agent: string
  draftHash: string
  rationale: string
  now: Date
  parentEnvelopeId?: string
}

function stableHashHex(value: unknown): string {
  // Local copy of canonicalize-then-sha256 to avoid circular imports.
  // Behavior matches `stableHash` in proposal-envelope.ts.
  return createHash("sha256").update(canonicalize(value)).digest("hex")
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]"
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const parts: string[] = []
  for (const k of keys) {
    const v = obj[k]
    if (v === undefined) continue
    parts.push(JSON.stringify(k) + ":" + canonicalize(v))
  }
  return "{" + parts.join(",") + "}"
}

/**
 * Editorial flags are review-class by default — a flag is "the producer
 * thinks something needs human attention." The mapping to envelope risk:
 *
 *   blocker → high      (must clear before drafting completes)
 *   warning → medium    (review queue)
 *   info    → low       (typically auto-shadow under default policy)
 */
export function classifyFlagRisk(severity: EditorialFlagSeverity): ProposalEnvelopeRisk {
  switch (severity) {
    case "blocker": return "high"
    case "warning": return "medium"
    case "info":    return "low"
  }
}

/**
 * Prose edits default to medium — they're concrete byte changes to a
 * draft, but typically narrow (one span). The Phase 6 policy can tighten
 * by issue category if a producer wants to mark specific edits as
 * mechanical (e.g., a deterministic typo fixer would emit `low`).
 */
export function classifyEditRisk(_proposal: ProseEditProposal): ProposalEnvelopeRisk {
  return "medium"
}

export function buildEditorialFlagEnvelope(
  args: BuildEditorialFlagEnvelopeArgs,
): EditorialFlagEnvelope {
  const idSeed = stableHashHex({
    version: ENVELOPE_ID_VERSION,
    kind: "editorial_flag",
    novelId: args.novelId,
    chapterRef: args.chapterRef,
    proposal: args.proposal,
    draftHash: args.draftHash,
    proposalIndex: args.proposalIndex,
  })
  const summary =
    `${args.proposal.severity}: ${args.proposal.issueType}` +
    (args.proposal.chapterRef ? ` @ ${args.proposal.chapterRef}` : "")
  return {
    id: `editorial-flag:${args.novelId}:${idSeed.slice(0, 16)}`,
    kind: "editorial_flag",
    novelId: args.novelId,
    target: {
      kind: "chapter_outline",
      ref: args.chapterRef,
      currentVersion: args.draftHash,
    },
    source: {
      agent: args.agent,
      ...(args.parentEnvelopeId !== undefined ? { parentEnvelopeId: args.parentEnvelopeId } : {}),
    },
    status: "pending",
    risk: classifyFlagRisk(args.proposal.severity),
    summary,
    rationale: args.rationale,
    evidence: args.proposal.evidenceQuotes.map(q => ({
      kind: "quote" as const,
      text: q.text,
      ...(q.ref !== undefined ? { ref: q.ref } : {}),
    })),
    payload: args.proposal,
    precondition: {
      kind: "draft_hash",
      hash: args.draftHash,
    },
    policyRecommendation: {
      decision: "queue",
      reasons: [
        `severity=${args.proposal.severity}; editorial_flag proposals route through manual review by default until Phase 6 ApprovalPolicy ships`,
      ],
    },
    createdAt: args.now.toISOString(),
  }
}

export function buildProseEditEnvelope(
  args: BuildProseEditEnvelopeArgs,
): ProseEditEnvelope {
  const idSeed = stableHashHex({
    version: ENVELOPE_ID_VERSION,
    kind: "prose_edit",
    novelId: args.novelId,
    proposal: args.proposal,
    draftHash: args.draftHash,
    proposalIndex: args.proposalIndex,
  })
  const targetSummary = args.proposal.target.kind === "span"
    ? `span:${args.proposal.target.chapterRef}@${args.proposal.target.start}-${args.proposal.target.end}`
    : `beat:${args.proposal.target.chapterRef}#${args.proposal.target.beatRef}`
  return {
    id: `prose-edit:${args.novelId}:${idSeed.slice(0, 16)}`,
    kind: "prose_edit",
    novelId: args.novelId,
    target: {
      kind: "prose_span",
      ref: targetSummary,
      currentVersion: args.draftHash,
    },
    source: {
      agent: args.agent,
      ...(args.parentEnvelopeId !== undefined ? { parentEnvelopeId: args.parentEnvelopeId } : {}),
    },
    status: "pending",
    risk: classifyEditRisk(args.proposal),
    summary: `Edit ${targetSummary}`,
    rationale: args.rationale,
    evidence: [],
    payload: args.proposal,
    precondition: {
      kind: "draft_hash",
      hash: args.draftHash,
    },
    policyRecommendation: {
      decision: "queue",
      reasons: [
        "prose_edit proposals route through manual review by default until Phase 6 ApprovalPolicy ships",
      ],
    },
    createdAt: args.now.toISOString(),
  }
}
