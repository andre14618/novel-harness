import {
  buildEditorialFlagEnvelope,
  type EditorialFlagEnvelope,
  type EditorialFlagProposal,
} from "./editorial-proposal"
import type { ContinuityIssue } from "../types"

const PRODUCER = "continuity-editorial-flags"

export interface BuildContinuityEditorialFlagProposalsArgs {
  chapterRef: string
  issues: readonly ContinuityIssue[]
}

export interface BuildContinuityEditorialFlagEnvelopesArgs extends BuildContinuityEditorialFlagProposalsArgs {
  novelId: string
  draftHash: string
  now: Date
  agent?: string
  rationale?: string
  parentEnvelopeId?: string
}

export function buildContinuityEditorialFlagProposals(
  args: BuildContinuityEditorialFlagProposalsArgs,
): EditorialFlagProposal[] {
  return args.issues
    .filter(isReviewableContinuityIssue)
    .map(issue => ({
      issueType: "off-canon",
      severity: "warning",
      chapterRef: args.chapterRef,
      canonRefs: issue.factId ? [{ kind: "fact" as const, id: issue.factId }] : [],
      evidenceQuotes: continuityEvidenceQuotes(issue),
      suggestedAction:
        "Review the draft against the continuity finding. If the prose is wrong, create a prose_edit; if canon has intentionally changed, create a canon_update; otherwise reject this flag as checker noise.",
    }))
}

export function buildContinuityEditorialFlagEnvelopes(
  args: BuildContinuityEditorialFlagEnvelopesArgs,
): EditorialFlagEnvelope[] {
  return buildContinuityEditorialFlagProposals(args).map((proposal, index) =>
    buildEditorialFlagEnvelope({
      novelId: args.novelId,
      chapterRef: args.chapterRef,
      proposal,
      proposalIndex: index,
      agent: args.agent ?? PRODUCER,
      draftHash: args.draftHash,
      rationale: args.rationale ?? `Continuity diagnostic review for ${args.chapterRef}.`,
      now: args.now,
      parentEnvelopeId: args.parentEnvelopeId,
    }),
  )
}

function isReviewableContinuityIssue(issue: ContinuityIssue): boolean {
  return issue.severity === "blocker" && (Boolean(issue.factId) || Boolean(issue.conflictsWith))
}

function continuityEvidenceQuotes(issue: ContinuityIssue): EditorialFlagProposal["evidenceQuotes"] {
  const quotes = [{ text: issue.description }]
  if (issue.conflictsWith) quotes.push({ text: `Conflicts with: ${issue.conflictsWith}` })
  if (issue.suggestedFix) quotes.push({ text: `Suggested fix: ${issue.suggestedFix}` })
  return quotes
}
