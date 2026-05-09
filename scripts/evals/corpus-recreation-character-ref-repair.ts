#!/usr/bin/env bun
/**
 * Build manual repair candidates for corpus recreation character-ref gaps.
 *
 * Diagnostic-only. This does not call an LLM, mutate plans, create proposals,
 * or write to the DB. It turns exact-ID character-context structural issues
 * into planning-edit-shaped field replacement candidates that an operator can
 * review before drafting.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import {
  buildRunManifest,
  existingArtifactRefs,
  manifestPathForSidecar,
  parentManifestForPocDir,
  writeRunManifest,
} from "./run-manifest"

type RepairFieldPath = "requiredCharacterIds" | "affectedCharacterIds"

type CharacterRefRepairIssueKind =
  | "missing_local_required_or_source"
  | "missing_affected_ref"
  | "unknown_required_character"
  | "unknown_affected_character"
  | "unknown_character_source"
  | "missing_pov"
  | "unknown_pov"
  | "no_active_character_refs"
  | "already_satisfied"
  | "other"

interface Args {
  pocDirs: string[]
  output: string | null
  json: string | null
}

interface PreserveIds {
  obligationIds: string[]
  characterIds: string[]
  sceneTurnIds: string[]
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  sourceIds: string[]
}

interface CharacterRefRepairCandidate {
  candidateId: string
  pocDir: string
  chapterId: string
  sceneId: string
  fieldPath: RepairFieldPath
  issueKind: "missing_local_required_or_source" | "missing_affected_ref"
  characterIdsToAdd: string[]
  currentValue: string[]
  proposedValue: string[]
  operatorQuestion: string
  rationale: string
  sourceIssues: string[]
  preserveIds: PreserveIds
  proposalCandidate: {
    action: "field_replace"
    target: {
      kind: "beat_plan"
      ref: string
      fieldPath: RepairFieldPath
    }
    requiresProposedValue: false
    proposedValueStatus: "deterministic_candidate_available"
    safeToAutoApply: false
    sourceAgent: "corpus-recreation-character-ref-repair"
  }
  dispositionPlanAction: {
    match: {
      label: "CHARACTERREF-1"
      targetRef: string
      targetKind: "beat_plan"
    }
    decision: "field_replace"
    proposedValue: string[]
    operatorNote: string
    rationale: string
    approve: false
  }
}

interface CharacterRefManualFinding {
  findingId: string
  pocDir: string
  chapterId: string
  sceneId: string
  kind: CharacterRefRepairIssueKind
  issue: string
  characterIds: string[]
  reason: string
}

export interface CharacterRefRepairReport {
  generatedAt: string
  pocDirCount: number
  candidates: CharacterRefRepairCandidate[]
  manualFindings: CharacterRefManualFinding[]
  dispositionPlanDraft: {
    actions: CharacterRefRepairCandidate["dispositionPlanAction"][]
  }
  totals: {
    candidateCount: number
    proposedCharacterRefAdditions: number
    manualFindingCount: number
    byField: Record<RepairFieldPath, number>
    byIssueKind: Record<CharacterRefRepairIssueKind, number>
  }
}

const ISSUE_KINDS: CharacterRefRepairIssueKind[] = [
  "missing_local_required_or_source",
  "missing_affected_ref",
  "unknown_required_character",
  "unknown_affected_character",
  "unknown_character_source",
  "missing_pov",
  "unknown_pov",
  "no_active_character_refs",
  "already_satisfied",
  "other",
]

export function buildCharacterRefRepairReport(
  pocDirs: string[],
  generatedAt = new Date().toISOString(),
): CharacterRefRepairReport {
  const draftCandidates: Array<Omit<CharacterRefRepairCandidate, "candidateId">> = []
  const manualFindings: Array<Omit<CharacterRefManualFinding, "findingId">> = []

  for (const pocDir of pocDirs.map(dir => resolve(dir))) {
    const plan = readOptionalJson(`${pocDir}/plan.json`) ?? {}
    const packet = readOptionalJson(`${pocDir}/packet.json`) ?? {}
    const characterContext = readOptionalJson(`${pocDir}/character-context.json`) ?? {}
    const chapterId = String(plan.chapterId ?? characterContext.source?.chapterLabel ?? packet.sourceReference?.chapterLabel ?? basename(pocDir))
    const pending = new Map<string, PendingRepair>()
    const contexts = Array.isArray(characterContext.contexts) ? characterContext.contexts : []

    for (const context of contexts) {
      const sceneId = String(context.sceneId ?? "")
      if (!sceneId) continue
      const scene = sceneFor(plan, sceneId)
      const issues = stringArray(context.structuralIssues)
      for (const issue of issues) {
        const kind = classifyIssue(issue)
        const characterIds = unique(characterIdsFromText(issue))
        if (kind === "missing_local_required_or_source") {
          collectPendingRepair({
            pending,
            scene,
            pocDir,
            chapterId,
            sceneId,
            fieldPath: "requiredCharacterIds",
            issueKind: kind,
            characterIds,
            issue,
          }, manualFindings)
          continue
        }
        if (kind === "missing_affected_ref") {
          collectPendingRepair({
            pending,
            scene,
            pocDir,
            chapterId,
            sceneId,
            fieldPath: "affectedCharacterIds",
            issueKind: kind,
            characterIds,
            issue,
          }, manualFindings)
          continue
        }
        manualFindings.push({
          pocDir,
          chapterId,
          sceneId,
          kind,
          issue,
          characterIds,
          reason: manualReasonFor(kind),
        })
      }
    }

    for (const repair of pending.values()) {
      const currentValue = stringArray(repair.scene?.[repair.fieldPath])
      const characterIdsToAdd = unique(repair.characterIds.filter(id => !currentValue.includes(id)))
      if (characterIdsToAdd.length === 0) {
        manualFindings.push({
          pocDir: repair.pocDir,
          chapterId: repair.chapterId,
          sceneId: repair.sceneId,
          kind: "already_satisfied",
          issue: repair.sourceIssues.join("; "),
          characterIds: repair.characterIds,
          reason: `${repair.fieldPath} already contains the referenced character IDs.`,
        })
        continue
      }
      const proposedValue = unique([...currentValue, ...characterIdsToAdd])
      draftCandidates.push({
        pocDir: repair.pocDir,
        chapterId: repair.chapterId,
        sceneId: repair.sceneId,
        fieldPath: repair.fieldPath,
        issueKind: repair.issueKind,
        characterIdsToAdd,
        currentValue,
        proposedValue,
        operatorQuestion: operatorQuestionFor(repair.fieldPath),
        rationale: rationaleFor(repair.fieldPath, characterIdsToAdd),
        sourceIssues: unique(repair.sourceIssues),
        preserveIds: preserveIdsFor(plan, repair.sceneId, proposedValue),
        proposalCandidate: {
          action: "field_replace",
          target: {
            kind: "beat_plan",
            ref: repair.sceneId,
            fieldPath: repair.fieldPath,
          },
          requiresProposedValue: false,
          proposedValueStatus: "deterministic_candidate_available",
          safeToAutoApply: false,
          sourceAgent: "corpus-recreation-character-ref-repair",
        },
        dispositionPlanAction: {
          match: {
            label: "CHARACTERREF-1",
            targetRef: repair.sceneId,
            targetKind: "beat_plan",
          },
          decision: "field_replace",
          proposedValue,
          operatorNote: operatorNoteFor(repair.fieldPath, characterIdsToAdd),
          rationale: rationaleFor(repair.fieldPath, characterIdsToAdd),
          approve: false,
        },
      })
    }
  }

  const candidates = draftCandidates
    .sort((a, b) =>
      compareChapterLabels(a.chapterId, b.chapterId)
      || a.sceneId.localeCompare(b.sceneId)
      || a.fieldPath.localeCompare(b.fieldPath)
      || a.pocDir.localeCompare(b.pocDir)
    )
    .map((candidate, index) => ({
      candidateId: `${index + 1}`.padStart(3, "0"),
      ...candidate,
    }))
  const findings = manualFindings
    .sort((a, b) =>
      compareChapterLabels(a.chapterId, b.chapterId)
      || a.sceneId.localeCompare(b.sceneId)
      || a.kind.localeCompare(b.kind)
      || a.issue.localeCompare(b.issue)
    )
    .map((finding, index) => ({
      findingId: `M${String(index + 1).padStart(3, "0")}`,
      ...finding,
    }))

  return {
    generatedAt,
    pocDirCount: pocDirs.length,
    candidates,
    manualFindings: findings,
    dispositionPlanDraft: {
      actions: candidates.map(candidate => candidate.dispositionPlanAction),
    },
    totals: {
      candidateCount: candidates.length,
      proposedCharacterRefAdditions: candidates.reduce((total, candidate) => total + candidate.characterIdsToAdd.length, 0),
      manualFindingCount: findings.length,
      byField: {
        requiredCharacterIds: candidates.filter(candidate => candidate.fieldPath === "requiredCharacterIds").length,
        affectedCharacterIds: candidates.filter(candidate => candidate.fieldPath === "affectedCharacterIds").length,
      },
      byIssueKind: Object.fromEntries(ISSUE_KINDS.map(kind => [
        kind,
        [
          ...candidates.filter(candidate => candidate.issueKind === kind),
          ...findings.filter(finding => finding.kind === kind),
        ].length,
      ])) as Record<CharacterRefRepairIssueKind, number>,
    },
  }
}

export function renderCharacterRefRepairReport(report: CharacterRefRepairReport): string {
  const lines: string[] = []
  lines.push("# Character Ref Repair Candidates")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`POC dirs: ${report.pocDirCount}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(`- Candidates: ${report.totals.candidateCount}`)
  lines.push(`- Proposed character-ref additions: ${report.totals.proposedCharacterRefAdditions}`)
  lines.push(`- Manual-only findings: ${report.totals.manualFindingCount}`)
  lines.push(`- requiredCharacterIds candidates: ${report.totals.byField.requiredCharacterIds}`)
  lines.push(`- affectedCharacterIds candidates: ${report.totals.byField.affectedCharacterIds}`)
  lines.push("")
  lines.push("These are manual Plan Readiness repair candidates. They do not auto-mutate plans.")
  lines.push("")
  if (report.candidates.length > 0) {
    lines.push("## Candidates")
    lines.push("")
    for (const candidate of report.candidates) {
      lines.push(`### ${candidate.candidateId} ${candidate.chapterId}/${candidate.sceneId}`)
      lines.push("")
      lines.push(`Target: beat_plan:${candidate.sceneId}:${candidate.fieldPath}`)
      lines.push(`Add: ${candidate.characterIdsToAdd.join(", ")}`)
      lines.push(`Current: ${JSON.stringify(candidate.currentValue)}`)
      lines.push(`Proposed: ${JSON.stringify(candidate.proposedValue)}`)
      lines.push(`Safe to auto-apply: ${candidate.proposalCandidate.safeToAutoApply}`)
      lines.push("")
      lines.push("Operator question:")
      lines.push(`- ${candidate.operatorQuestion}`)
      lines.push("")
      lines.push("Source issues:")
      for (const issue of candidate.sourceIssues) lines.push(`- ${issue}`)
      lines.push("")
      lines.push("Disposition action draft:")
      lines.push("```json")
      lines.push(JSON.stringify(candidate.dispositionPlanAction, null, 2))
      lines.push("```")
      lines.push("")
    }
  } else {
    lines.push("## Candidates")
    lines.push("")
    lines.push("- none")
    lines.push("")
  }
  lines.push("## Manual Findings")
  lines.push("")
  if (report.manualFindings.length === 0) {
    lines.push("- none")
  } else {
    for (const finding of report.manualFindings) {
      const ids = finding.characterIds.length > 0 ? ` (${finding.characterIds.join(", ")})` : ""
      lines.push(`- ${finding.findingId} ${finding.chapterId}/${finding.sceneId} ${finding.kind}${ids}: ${finding.reason}`)
      lines.push(`  Issue: ${finding.issue}`)
    }
  }
  lines.push("")
  lines.push("## Interpretation Boundary")
  lines.push("")
  lines.push("- The script only proposes array replacements for exact known character IDs found by the existing character-context diagnostic.")
  lines.push("- `requiredCharacterIds` candidates are local writer-context refs; `affectedCharacterIds` candidates are downstream/offstage impact refs.")
  lines.push("- Every candidate remains manual because adding an ID may be the wrong answer if the better fix is a character-source obligation or removing the implied character dependency.")
  return `${lines.join("\n")}\n`
}

interface PendingRepair {
  pocDir: string
  chapterId: string
  sceneId: string
  fieldPath: RepairFieldPath
  issueKind: "missing_local_required_or_source" | "missing_affected_ref"
  characterIds: string[]
  sourceIssues: string[]
  scene: any
}

function collectPendingRepair(args: {
  pending: Map<string, PendingRepair>
  scene: any
  pocDir: string
  chapterId: string
  sceneId: string
  fieldPath: RepairFieldPath
  issueKind: "missing_local_required_or_source" | "missing_affected_ref"
  characterIds: string[]
  issue: string
}, manualFindings: Array<Omit<CharacterRefManualFinding, "findingId">>): void {
  if (args.characterIds.length === 0) {
    manualFindings.push({
      pocDir: args.pocDir,
      chapterId: args.chapterId,
      sceneId: args.sceneId,
      kind: args.issueKind,
      issue: args.issue,
      characterIds: [],
      reason: "The issue did not contain an exact character ID, so no deterministic field replacement is possible.",
    })
    return
  }
  if (!args.scene) {
    manualFindings.push({
      pocDir: args.pocDir,
      chapterId: args.chapterId,
      sceneId: args.sceneId,
      kind: args.issueKind,
      issue: args.issue,
      characterIds: args.characterIds,
      reason: "The referenced scene is not present in plan.json.",
    })
    return
  }
  const key = [args.pocDir, args.sceneId, args.fieldPath, args.issueKind].join("|")
  const existing = args.pending.get(key)
  if (existing) {
    existing.characterIds = unique([...existing.characterIds, ...args.characterIds])
    existing.sourceIssues = unique([...existing.sourceIssues, args.issue])
    return
  }
  args.pending.set(key, {
    pocDir: args.pocDir,
    chapterId: args.chapterId,
    sceneId: args.sceneId,
    fieldPath: args.fieldPath,
    issueKind: args.issueKind,
    characterIds: unique(args.characterIds),
    sourceIssues: [args.issue],
    scene: args.scene,
  })
}

function classifyIssue(issue: string): CharacterRefRepairIssueKind {
  if (/missing povCharacterId/u.test(issue)) return "missing_pov"
  if (/unknown povCharacterId/u.test(issue)) return "unknown_pov"
  if (/unknown requiredCharacterId/u.test(issue)) return "unknown_required_character"
  if (/unknown affectedCharacterId/u.test(issue)) return "unknown_affected_character"
  if (/unknown character sourceId/u.test(issue)) return "unknown_character_source"
  if (/named in consequence.*missing affectedCharacterIds/u.test(issue)) return "missing_affected_ref"
  if (/named in scene contract.*missing requiredCharacterIds\/source obligation/u.test(issue)) return "missing_local_required_or_source"
  if (/no active character refs/u.test(issue)) return "no_active_character_refs"
  return "other"
}

function sceneFor(plan: any, sceneId: string): any {
  return Array.isArray(plan.scenes)
    ? plan.scenes.find((candidate: any) => String(candidate.sceneId ?? "") === sceneId)
    : null
}

function preserveIdsFor(plan: any, sceneId: string, characterIds: string[]): PreserveIds {
  const obligations = Array.isArray(plan.obligations)
    ? plan.obligations.filter((obligation: any) => String(obligation.sceneId ?? "") === sceneId)
    : []
  const obligationIds = unique(obligations.map((obligation: any) => String(obligation.obligationId ?? "")).filter(Boolean))
  const sceneTurnIds = unique(obligations.map((obligation: any) => String(obligation.sceneTurnId ?? "")).filter(Boolean))
  const threadIds = unique(obligations.map((obligation: any) => String(obligation.threadId ?? "")).filter(Boolean))
  const promiseIds = unique(obligations.map((obligation: any) => String(obligation.promiseId ?? "")).filter(Boolean))
  const payoffIds = unique(obligations.map((obligation: any) => String(obligation.payoffId ?? "")).filter(Boolean))
  const sourceIds = unique([
    ...characterIds,
    ...obligations.map((obligation: any) => String(obligation.sourceId ?? "")).filter(Boolean),
    ...sceneTurnIds,
    ...threadIds,
    ...promiseIds,
    ...payoffIds,
  ])
  return {
    obligationIds,
    characterIds,
    sceneTurnIds,
    threadIds,
    promiseIds,
    payoffIds,
    sourceIds,
  }
}

function operatorQuestionFor(fieldPath: RepairFieldPath): string {
  if (fieldPath === "requiredCharacterIds") {
    return "Should these characters become local writer-context refs, be represented by character-source obligations, or be removed from the scene contract before drafting?"
  }
  return "Should these consequence-only characters become downstream affected refs, be represented by local/source obligations, or be removed from the consequence before drafting?"
}

function operatorNoteFor(fieldPath: RepairFieldPath, characterIds: string[]): string {
  return `Deterministic character-ref repair candidate: add ${characterIds.join(", ")} to ${fieldPath} after operator review.`
}

function rationaleFor(fieldPath: RepairFieldPath, characterIds: string[]): string {
  const ids = characterIds.join(", ")
  if (fieldPath === "requiredCharacterIds") {
    return `The scene contract names ${ids} as local context but does not close those refs through requiredCharacterIds or character-source obligations.`
  }
  return `The scene consequence names ${ids} as downstream impact but does not close those refs through affectedCharacterIds, requiredCharacterIds, or character-source obligations.`
}

function manualReasonFor(kind: CharacterRefRepairIssueKind): string {
  const reasons: Record<CharacterRefRepairIssueKind, string> = {
    missing_local_required_or_source: "Exact local character-ref gaps can become requiredCharacterIds candidates.",
    missing_affected_ref: "Exact consequence-only character-ref gaps can become affectedCharacterIds candidates.",
    unknown_required_character: "Unknown required refs need mapping or removal, not deterministic addition.",
    unknown_affected_character: "Unknown affected refs need mapping or removal, not deterministic addition.",
    unknown_character_source: "Unknown character source refs need obligation/source mapping review.",
    missing_pov: "Missing POV requires planner review of the scene's viewpoint contract.",
    unknown_pov: "Unknown POV requires planner review of the scene's viewpoint contract.",
    no_active_character_refs: "No active refs may be acceptable or may require a semantic planner rewrite.",
    already_satisfied: "The target array already contains the referenced IDs.",
    other: "The issue is not a deterministic required/affected character-ref addition.",
  }
  return reasons[kind]
}

function characterIdsFromText(text: string): string[] {
  return text.match(/\bchar-[A-Za-z0-9_-]+\b/gu) ?? []
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const pocDirs: string[] = []
  let output: string | null = null
  let json: string | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--poc-dir") {
      const value = argv[index + 1]
      if (!value) throw new Error("--poc-dir requires a path")
      pocDirs.push(value)
      index += 1
    } else if (arg === "--output") {
      const value = argv[index + 1]
      if (!value) throw new Error("--output requires a path")
      output = value
      index += 1
    } else if (arg === "--json") {
      const value = argv[index + 1]
      if (!value) throw new Error("--json requires a path")
      json = value
      index += 1
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown arg: ${arg}`)
    } else {
      pocDirs.push(arg)
    }
  }
  if (pocDirs.length === 0) throw new Error("at least one --poc-dir or positional POC directory is required")
  return { pocDirs, output, json }
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/evals/corpus-recreation-character-ref-repair.ts --poc-dir <dir> [--poc-dir <dir> ...]
  bun scripts/evals/corpus-recreation-character-ref-repair.ts <dir> <dir> --output output/character-ref-repair.md --json output/character-ref-repair.json
`)
}

function readOptionalJson(path: string): any | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf8"))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function compareChapterLabels(a: string, b: string): number {
  const aNumber = Number(a.replace(/\D+/g, ""))
  const bNumber = Number(b.replace(/\D+/g, ""))
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber
  return a.localeCompare(b)
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const report = buildCharacterRefRepairReport(args.pocDirs)
    const rendered = renderCharacterRefRepairReport(report)
    if (args.output) writeOutput(args.output, rendered)
    if (args.json) writeOutput(args.json, `${JSON.stringify(report, null, 2)}\n`)
    writeManifestIfArtifactProduced(args, report)
    console.log(rendered)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

function writeManifestIfArtifactProduced(args: Args, report: CharacterRefRepairReport): void {
  const primaryOutput = args.json ?? args.output
  if (!primaryOutput) return
  const parentManifests = args.pocDirs
    .map(dir => parentManifestForPocDir(dir))
    .filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))
  writeRunManifest(manifestPathForSidecar(primaryOutput), buildRunManifest({
    generatedAt: report.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-character-ref-repair",
    variantId: "character-ref-repair",
    parentRunId: parentManifests.length === 1 ? parentManifests[0]!.runId : null,
    rootRunId: parentManifests.length === 1 ? parentManifests[0]!.rootRunId : null,
    command: {
      name: "diagnostics:corpus-recreation-character-ref-repair",
      argv: process.argv.slice(2),
    },
    inputs: characterRefRepairInputRefs(args.pocDirs),
    outputs: existingArtifactRefs([
      ...(args.output ? [{ path: args.output, role: "character-ref-repair-markdown" }] : []),
      ...(args.json ? [{ path: args.json, role: "character-ref-repair-json" }] : []),
    ]),
    relatedRunIds: parentManifests.map(manifest => manifest.runId),
    discriminator: `candidates-${report.totals.candidateCount}-adds-${report.totals.proposedCharacterRefAdditions}`,
    metadata: {
      pocDirs: args.pocDirs,
      candidateCount: report.totals.candidateCount,
      proposedCharacterRefAdditions: report.totals.proposedCharacterRefAdditions,
      manualFindingCount: report.totals.manualFindingCount,
    },
  }))
}

function characterRefRepairInputRefs(pocDirs: string[]) {
  return pocDirs.flatMap(dir => {
    const resolved = resolve(dir)
    return existingArtifactRefs([
      { path: `${resolved}/run-manifest.json`, role: "parent-run-manifest" },
      { path: `${resolved}/packet.json`, role: "packet" },
      { path: `${resolved}/plan.json`, role: "plan" },
      { path: `${resolved}/plan-comparison.json`, role: "plan-comparison-json" },
      { path: `${resolved}/character-context.json`, role: "character-context-json" },
    ])
  })
}
