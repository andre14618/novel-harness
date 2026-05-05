import {
  buildProseEditEnvelopesFromLintIssues,
  type BuildLintProseEditEnvelopesArgs,
} from "../canon/lint-to-prose-edit"
import {
  runEditorialBeatCoverageCheck,
  type EditorialBeatCoverageCallLlm,
} from "../canon/editorial-beat-coverage"
import type { EditorialFlagEnvelope, ProseEditEnvelope } from "../canon/editorial-proposal"
import { insertEditorialFlagEnvelope, insertProseEditEnvelope } from "../db/editorial-envelopes"
import type { LintIssue } from "../lint/types"
import type { ChapterOutline } from "../types"
import { createHash } from "crypto"

export interface PersistLintProseEditProposalsResult {
  generated: number
  inserted: number
  skipped: number
  errors: Array<{ envelopeId: string; error: string }>
}

export interface PersistEditorialBeatCoverageProposalsResult {
  generated: number
  inserted: number
  skipped: number
  errors: Array<{ envelopeId: string; error: string }>
  coveredBeats: number
  uncoveredBeats: number
}

export async function persistLintProseEditProposals(args: {
  novelId: string
  chapter: number
  prose: string
  issues: readonly LintIssue[]
  outline?: ChapterOutline
  beatProses?: readonly string[]
  now?: Date
  insertEnvelope?: (envelope: ProseEditEnvelope) => Promise<boolean>
}): Promise<PersistLintProseEditProposalsResult> {
  const envelopeArgs: BuildLintProseEditEnvelopesArgs = {
    novelId: args.novelId,
    chapterRef: `chapter:${args.chapter}`,
    prose: args.prose,
    issues: args.issues,
    agent: "lint-to-prose-edit",
    ...(args.outline !== undefined && args.beatProses !== undefined ? {
      beatContext: {
        beatProses: args.beatProses,
        beatRefs: args.outline.scenes.map(beat => beat.beatId),
      },
    } : {}),
    ...(args.now !== undefined ? { now: args.now } : {}),
  }
  const envelopes = buildProseEditEnvelopesFromLintIssues(envelopeArgs)
  const insert = args.insertEnvelope ?? insertProseEditEnvelope
  const errors: PersistLintProseEditProposalsResult["errors"] = []
  let inserted = 0
  let skipped = 0

  for (const envelope of envelopes) {
    try {
      if (await insert(envelope)) inserted++
      else skipped++
    } catch (err) {
      errors.push({
        envelopeId: envelope.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    generated: envelopes.length,
    inserted,
    skipped,
    errors,
  }
}

export async function persistEditorialBeatCoverageProposals(args: {
  novelId: string
  chapter: number
  prose: string
  outline: ChapterOutline
  now?: Date
  callLLM: EditorialBeatCoverageCallLlm
  insertEnvelope?: (envelope: EditorialFlagEnvelope) => Promise<boolean>
}): Promise<PersistEditorialBeatCoverageProposalsResult> {
  const result = await runEditorialBeatCoverageCheck({
    novelId: args.novelId,
    chapterRef: `chapter:${args.chapter}`,
    prose: args.prose,
    outline: args.outline,
    draftHash: computeDraftHash(args.prose),
    agent: "editorial-beat-coverage",
    rationale: `Editorial beat-coverage check after drafting chapter ${args.chapter}.`,
    ...(args.now !== undefined ? { now: args.now } : {}),
    callLLM: args.callLLM,
  })
  const insert = args.insertEnvelope ?? insertEditorialFlagEnvelope
  const errors: PersistEditorialBeatCoverageProposalsResult["errors"] = []
  let inserted = 0
  let skipped = 0

  for (const envelope of result.envelopes) {
    try {
      if (await insert(envelope)) inserted++
      else skipped++
    } catch (err) {
      errors.push({
        envelopeId: envelope.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    generated: result.envelopes.length,
    inserted,
    skipped,
    errors,
    coveredBeats: result.rawOutput.beatVerdicts.filter((v) => v.covered).length,
    uncoveredBeats: result.rawOutput.beatVerdicts.filter((v) => !v.covered).length,
  }
}

export function computeDraftHash(prose: string): string {
  return createHash("sha256").update(prose, "utf8").digest("hex")
}
