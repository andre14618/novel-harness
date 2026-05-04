/**
 * Phase 5 commit 5 — convert deterministic lint fixes into prose-edit
 * proposal cards.
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 5 — Editorial Proposal Workbench"
 *
 * The lint subsystem (`src/lint/`) detects deterministic prose issues —
 * filler phrases, redundant body language, hedge qualifiers, said-bookisms,
 * etc. — and `applyDeterministicFixes` rewrites them in place. Phase 5
 * commit 4 shipped the prose-edit envelope apply route; this commit
 * is the producer side: turn each fixable lint issue into a
 * `ProseEditEnvelope` that routes through the same review flow as the
 * LLM editorial proposals (commit 2's beat-coverage). The operator (or
 * Phase 6's ApprovalPolicy) accepts or rejects per-card; rejected
 * proposals become negative examples per the design's acceptance.
 *
 * ## Scope
 *
 *   - Pure helpers (no DB, no LLM). The runtime wiring (where in the
 *     drafting pipeline these envelopes get persisted + when they're
 *     surfaced to the operator) is its own follow-up.
 *   - Span-target only. A beat-target lint fix is conceivable
 *     (e.g., RHYTHM_MONOTONY rewrites a paragraph) but those
 *     deterministic fixes don't exist yet, and beat-target apply is
 *     deferred from commit 4.
 *   - Issues that don't have a deterministic fix (RHYTHM_MONOTONY,
 *     PARAGRAPH_HOMOGENEITY, no matching DETERMINISTIC_FIXES rule and
 *     not a SAID_BOOKISM-in-dialogue) are filtered out — they belong
 *     to the LLM-fix path which is its own producer module.
 *
 * ## Span computation
 *
 * The lint issue carries `match` (the offending text) and `sentence`
 * (the surrounding sentence). To produce a span on the rendered prose:
 *
 *   1. Find the sentence in prose: `sentenceIdx = prose.indexOf(sentence)`.
 *   2. Within the sentence, locate the FIRST case-insensitive match of
 *      `issue.match`. Lint detection is case-insensitive (the patterns
 *      use the `i` flag), so the issue.match is the canonical-case form
 *      from the source text but the surface in the prose may differ —
 *      the converter must locate it case-insensitively to stay in sync.
 *   3. The span is `[sentenceIdx + matchInSentence,
 *      sentenceIdx + matchInSentence + match.length)`.
 *
 * If either find fails (sentence has been mutated since detection,
 * match no longer present), the issue is silently dropped — the same
 * conservative posture `applyDeterministicFixes` takes for offsets that
 * don't resolve.
 *
 * ## Why not just call applyDeterministicFixes and diff?
 *
 * `applyDeterministicFixes` mutates a copy of the prose and returns a
 * count, not the per-issue spans. Rebuilding spans via diff after the
 * fact (a) loses the issue→span correspondence when multiple fixes
 * affect the same sentence, and (b) doesn't compose if the operator
 * accepts only some fixes. Computing spans before any fix is applied
 * keeps every proposal addressable independently.
 */

import { createHash } from "crypto"
import { DETERMINISTIC_FIXES } from "../lint/fixers/deterministic"
import type { LintIssue } from "../lint/types"
import { buildProseEditEnvelope } from "./editorial-proposal"
import type {
  ProseEditEnvelope,
  ProseEditProposal,
} from "./editorial-proposal"

export interface ProseSpanFix {
  /** 0-based, half-open: prose.slice(start, end) is the original text. */
  start: number
  /** Exclusive end offset on the prose string. */
  end: number
  /** Replacement text. May be empty (effective deletion of [start, end)). */
  replacement: string
  /** The lint category that produced this fix (e.g. "FILLER_PHRASE"). */
  category: string
}

/**
 * Compute the prose span + replacement for a single lint issue, or null
 * if the issue is not deterministically fixable. The function is pure
 * (does NOT mutate prose).
 */
export function findFixForIssue(
  prose: string,
  issue: LintIssue,
): ProseSpanFix | null {
  // Filter structural categories that lack deterministic rewrites.
  if (issue.category === "RHYTHM_MONOTONY" || issue.category === "PARAGRAPH_HOMOGENEITY") {
    return null
  }

  const sentenceIdx = prose.indexOf(issue.sentence)
  if (sentenceIdx === -1) return null

  // Try matching DETERMINISTIC_FIXES first.
  for (const rule of DETERMINISTIC_FIXES) {
    if (issue.category !== rule.category) continue
    if (!rule.pattern.test(issue.match)) {
      // Reset rule.pattern's lastIndex if the regex is global — `.test`
      // on a g-flag regex advances lastIndex. The inner `.test` here is
      // a "does this issue category match?" check; reset so subsequent
      // calls don't skip.
      rule.pattern.lastIndex = 0
      continue
    }
    rule.pattern.lastIndex = 0

    const replacement = rule.fix(issue.match, issue.sentence)
    if (replacement === null) continue

    const matchInSentence = locateCaseInsensitive(issue.sentence, issue.match)
    if (matchInSentence === -1) continue

    const start = sentenceIdx + matchInSentence
    const end = start + issue.match.length

    // Sanity: the prose substring at the computed span must equal the
    // match (case-insensitive). Drop the fix if the assumption breaks
    // (e.g., sentence appeared earlier in the prose with a different
    // surface form).
    if (prose.slice(start, end).toLowerCase() !== issue.match.toLowerCase()) {
      continue
    }

    return { start, end, replacement, category: issue.category }
  }

  // Said-bookism in dialogue — match `applyDeterministicFixes` fallback.
  if (issue.category === "SAID_BOOKISM") {
    const hasQuotes = /["“”]/.test(issue.sentence)
    if (!hasQuotes) return null
    const matchInSentence = locateCaseInsensitive(issue.sentence, issue.match)
    if (matchInSentence === -1) return null
    const start = sentenceIdx + matchInSentence
    const end = start + issue.match.length
    if (prose.slice(start, end).toLowerCase() !== issue.match.toLowerCase()) {
      return null
    }
    return { start, end, replacement: "said", category: issue.category }
  }

  return null
}

function locateCaseInsensitive(haystack: string, needle: string): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase())
}

function computeProseHash(prose: string): string {
  return createHash("sha256").update(prose, "utf8").digest("hex")
}

function buildRationale(category: string): string {
  return (
    `Deterministic lint fix: ${category} pattern. Auto-generated proposal — ` +
    `accept to apply, reject to skip. See src/lint/fixers/deterministic.ts ` +
    `for the rule that produced this match.`
  )
}

/**
 * Build a ProseEditProposal (NOT yet wrapped in an envelope) from a
 * lint issue. Returns null if the issue is not deterministically fixable.
 *
 * The proposal carries:
 *   - target.kind = "span", with prose offsets computed from the issue
 *   - replacement = the deterministic rule's output (possibly empty)
 *   - rationale = a short string naming the lint category
 *
 * `draftVersion` is set to a synthetic "lint:<category>" so the operator
 * can see the source kind in the audit history; it is NOT used for
 * precondition checking (the route compares `precondition.hash` only).
 */
export function buildProseEditProposalFromIssue(
  prose: string,
  issue: LintIssue,
  chapterRef: string,
): ProseEditProposal | null {
  const fix = findFixForIssue(prose, issue)
  if (!fix) return null
  return {
    draftVersion: `lint:${issue.category}`,
    target: {
      kind: "span",
      chapterRef,
      start: fix.start,
      end: fix.end,
    },
    replacement: fix.replacement,
    rationale: buildRationale(issue.category),
  }
}

export interface BuildLintProseEditEnvelopesArgs {
  novelId: string
  chapterRef: string
  prose: string
  issues: readonly LintIssue[]
  agent: string
  parentEnvelopeId?: string
  /** Override for tests. Defaults to `new Date()`. */
  now?: Date
}

/**
 * Convert a batch of lint issues to a batch of ProseEditEnvelopes. All
 * envelopes share the same precondition.hash (sha256 of `prose`) — the
 * operator approves them against the same draft snapshot. After the
 * first apply lands, subsequent envelopes still pinned to the prior
 * hash will 409 (the route's stale-precondition path); the producer
 * is expected to re-run on the new draft if it wants more fixes.
 *
 * Issues that lack a deterministic fix are filtered out silently.
 * Multiple issues at overlapping spans each produce their own envelope;
 * the operator's choices determine which (if any) land.
 */
export function buildProseEditEnvelopesFromLintIssues(
  args: BuildLintProseEditEnvelopesArgs,
): ProseEditEnvelope[] {
  const draftHash = computeProseHash(args.prose)
  const now = args.now ?? new Date()
  const envelopes: ProseEditEnvelope[] = []
  let proposalIndex = 0
  for (const issue of args.issues) {
    const proposal = buildProseEditProposalFromIssue(args.prose, issue, args.chapterRef)
    if (!proposal) continue
    const env = buildProseEditEnvelope({
      novelId: args.novelId,
      proposal,
      proposalIndex,
      agent: args.agent,
      draftHash,
      rationale: proposal.rationale,
      now,
      ...(args.parentEnvelopeId !== undefined ? { parentEnvelopeId: args.parentEnvelopeId } : {}),
    })
    envelopes.push(env)
    proposalIndex++
  }
  return envelopes
}
