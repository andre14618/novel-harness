#!/usr/bin/env bun
/**
 * Classify corpus recreation character-ref closure across planner-only POC dirs.
 *
 * Diagnostic-only. This does not call an LLM, mutate plans, create proposals,
 * or write to the DB. It summarizes whether `requiredCharacterIds` and
 * `affectedCharacterIds` are closing the local-vs-downstream character refs
 * before any writer-context experiment.
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

type CharacterRefIssueKind =
  | "missing_local_required_or_source"
  | "missing_affected_ref"
  | "unknown_required_character"
  | "unknown_affected_character"
  | "unknown_character_source"
  | "missing_pov"
  | "unknown_pov"
  | "no_active_character_refs"
  | "other"

interface Args {
  pocDirs: string[]
  output: string | null
  json: string | null
}

interface CharacterRefIssue {
  pocDir: string
  chapterLabel: string
  sceneId: string
  kind: CharacterRefIssueKind
  issue: string
  characterIds: string[]
}

interface CharacterRefCohortRow {
  pocDir: string
  chapterLabel: string
  sceneCount: number
  obligationCount: number
  planIssueCount: number
  declaredObligationCount: number
  knownSourceIdCount: number
  knownThreadRefCount: number
  sceneTurnRefIssueCount: number
  characterRefClosureCount: number
  characterRefIssueCount: number
  requiredCharacterRefCount: number
  affectedCharacterRefCount: number
  characterContextIssueCount: number
  classifiedIssues: CharacterRefIssue[]
}

export interface CharacterRefCohortReport {
  generatedAt: string
  rowCount: number
  rows: CharacterRefCohortRow[]
  totals: {
    sceneCount: number
    obligationCount: number
    planIssueCount: number
    declaredObligationCount: number
    knownSourceIdCount: number
    knownThreadRefCount: number
    sceneTurnRefIssueCount: number
    characterRefClosureCount: number
    characterRefIssueCount: number
    requiredCharacterRefCount: number
    affectedCharacterRefCount: number
    characterContextIssueCount: number
    classifiedIssueCount: number
    byKind: Record<CharacterRefIssueKind, number>
  }
}

const ISSUE_KINDS: CharacterRefIssueKind[] = [
  "missing_local_required_or_source",
  "missing_affected_ref",
  "unknown_required_character",
  "unknown_affected_character",
  "unknown_character_source",
  "missing_pov",
  "unknown_pov",
  "no_active_character_refs",
  "other",
]

export function buildCharacterRefCohortReport(
  pocDirs: string[],
  generatedAt = new Date().toISOString(),
): CharacterRefCohortReport {
  const rows = pocDirs.map(readCohortRow)
  const classifiedIssues = rows.flatMap(row => row.classifiedIssues)
  const totals = {
    sceneCount: sum(rows, "sceneCount"),
    obligationCount: sum(rows, "obligationCount"),
    planIssueCount: sum(rows, "planIssueCount"),
    declaredObligationCount: sum(rows, "declaredObligationCount"),
    knownSourceIdCount: sum(rows, "knownSourceIdCount"),
    knownThreadRefCount: sum(rows, "knownThreadRefCount"),
    sceneTurnRefIssueCount: sum(rows, "sceneTurnRefIssueCount"),
    characterRefClosureCount: sum(rows, "characterRefClosureCount"),
    characterRefIssueCount: sum(rows, "characterRefIssueCount"),
    requiredCharacterRefCount: sum(rows, "requiredCharacterRefCount"),
    affectedCharacterRefCount: sum(rows, "affectedCharacterRefCount"),
    characterContextIssueCount: sum(rows, "characterContextIssueCount"),
    classifiedIssueCount: classifiedIssues.length,
    byKind: Object.fromEntries(ISSUE_KINDS.map(kind => [
      kind,
      classifiedIssues.filter(issue => issue.kind === kind).length,
    ])) as Record<CharacterRefIssueKind, number>,
  }
  return {
    generatedAt,
    rowCount: rows.length,
    rows,
    totals,
  }
}

export function renderCharacterRefCohortReport(report: CharacterRefCohortReport): string {
  const lines: string[] = []
  lines.push("# Character Ref Cohort")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Rows: ${report.rowCount}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(`- Scenes: ${report.totals.sceneCount}`)
  lines.push(`- Obligations: ${report.totals.obligationCount}`)
  lines.push(`- Declared obligation scenes: ${report.totals.declaredObligationCount}/${report.totals.sceneCount}`)
  lines.push(`- Known source-id scenes: ${report.totals.knownSourceIdCount}/${report.totals.sceneCount}`)
  lines.push(`- Known thread-ref scenes: ${report.totals.knownThreadRefCount}/${report.totals.sceneCount}`)
  lines.push(`- Scene-turn ref issues: ${report.totals.sceneTurnRefIssueCount}`)
  lines.push(`- Character refs closed: ${report.totals.characterRefClosureCount}/${report.totals.sceneCount}`)
  lines.push(`- Character context structural issues: ${report.totals.characterContextIssueCount}`)
  lines.push(`- Required character refs: ${report.totals.requiredCharacterRefCount}`)
  lines.push(`- Affected character refs: ${report.totals.affectedCharacterRefCount}`)
  lines.push("")
  lines.push("## Issue Classification")
  lines.push("")
  for (const kind of ISSUE_KINDS) {
    const count = report.totals.byKind[kind]
    if (count > 0) lines.push(`- ${kind}: ${count}`)
  }
  if (report.totals.classifiedIssueCount === 0) lines.push("- none")
  lines.push("")
  lines.push("## Rows")
  lines.push("")
  lines.push("| Chapter | Scenes | Obligations | Thread Valid | Character Closed | Required Refs | Affected Refs | Issues |")
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
  for (const row of report.rows) {
    lines.push(`| ${row.chapterLabel || basename(row.pocDir)} | ${row.sceneCount} | ${row.obligationCount} | ${row.knownThreadRefCount}/${row.sceneCount} | ${row.characterRefClosureCount}/${row.sceneCount} | ${row.requiredCharacterRefCount} | ${row.affectedCharacterRefCount} | ${row.classifiedIssues.length} |`)
  }
  lines.push("")
  if (report.totals.classifiedIssueCount > 0) {
    lines.push("## Findings")
    for (const issue of report.rows.flatMap(row => row.classifiedIssues)) {
      const ids = issue.characterIds.length > 0 ? ` (${issue.characterIds.join(", ")})` : ""
      lines.push(`- ${issue.chapterLabel}/${issue.sceneId} ${issue.kind}${ids}: ${issue.issue}`)
    }
    lines.push("")
  }
  lines.push("## Interpretation Boundary")
  lines.push("")
  lines.push("- This is deterministic structure evidence only.")
  lines.push("- `requiredCharacterIds` should feed local scene writer context.")
  lines.push("- `affectedCharacterIds` should feed downstream impact/staleness reasoning, not active writer cards.")
  lines.push("- A remaining issue means the plan contract needs operator/readiness review before drafting; it does not prove the story is semantically bad.")
  return `${lines.join("\n")}\n`
}

function readCohortRow(pocDir: string): CharacterRefCohortRow {
  const resolved = resolve(pocDir)
  const packet = readOptionalJson(`${resolved}/packet.json`) ?? {}
  const plan = readOptionalJson(`${resolved}/plan.json`) ?? {}
  const planComparison = readOptionalJson(`${resolved}/plan-comparison.json`) ?? {}
  const characterContext = readOptionalJson(`${resolved}/character-context.json`) ?? {}
  const source = packet.sourceReference ?? {}
  const sceneContract = planComparison.sceneContract ?? {}
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : []
  const contexts = Array.isArray(characterContext.contexts) ? characterContext.contexts : []
  const chapterLabel = String(plan.chapterId ?? source.chapterLabel ?? basename(resolved))
  const classifiedIssues = contexts.flatMap((context: any) =>
    stringArray(context.structuralIssues).map(issue => ({
      pocDir: resolved,
      chapterLabel,
      sceneId: String(context.sceneId ?? ""),
      kind: classifyCharacterRefIssue(issue),
      issue,
      characterIds: characterIdsFromText(issue),
    })),
  )
  return {
    pocDir: resolved,
    chapterLabel,
    sceneCount: numberOrZero(planComparison.sceneCount?.actual ?? scenes.length),
    obligationCount: Array.isArray(plan.obligations) ? plan.obligations.length : 0,
    planIssueCount: Array.isArray(planComparison.issues) ? planComparison.issues.length : 0,
    declaredObligationCount: numberOrZero(sceneContract.declaredObligationCount),
    knownSourceIdCount: numberOrZero(sceneContract.knownSourceIdCount),
    knownThreadRefCount: numberOrZero(sceneContract.knownThreadRefCount),
    sceneTurnRefIssueCount: numberOrZero(sceneContract.sceneTurnRefIssueCount),
    characterRefClosureCount: numberOrZero(sceneContract.characterRefClosureCount),
    characterRefIssueCount: numberOrZero(sceneContract.characterRefIssueCount),
    requiredCharacterRefCount: scenes.reduce((total: number, scene: any) => total + stringArray(scene.requiredCharacterIds).length, 0),
    affectedCharacterRefCount: scenes.reduce((total: number, scene: any) => total + stringArray(scene.affectedCharacterIds).length, 0),
    characterContextIssueCount: numberOrZero(characterContext.issueCount),
    classifiedIssues,
  }
}

function classifyCharacterRefIssue(issue: string): CharacterRefIssueKind {
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
  bun scripts/evals/corpus-recreation-character-ref-cohort.ts --poc-dir <dir> [--poc-dir <dir> ...]
  bun scripts/evals/corpus-recreation-character-ref-cohort.ts <dir> <dir> --output output/character-ref-cohort.md --json output/character-ref-cohort.json
`)
}

function readOptionalJson(path: string): any | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf8"))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sum(rows: CharacterRefCohortRow[], key: keyof CharacterRefCohortRow): number {
  return rows.reduce((total, row) => total + numberOrZero(row[key]), 0)
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const report = buildCharacterRefCohortReport(args.pocDirs)
    const rendered = renderCharacterRefCohortReport(report)
    if (args.output) writeOutput(args.output, rendered)
    if (args.json) writeOutput(args.json, `${JSON.stringify(report, null, 2)}\n`)
    writeManifestIfArtifactProduced(args, report)
    console.log(rendered)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

function writeManifestIfArtifactProduced(args: Args, report: CharacterRefCohortReport): void {
  const primaryOutput = args.json ?? args.output
  if (!primaryOutput) return
  const parentManifests = args.pocDirs
    .map(dir => parentManifestForPocDir(dir))
    .filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))
  writeRunManifest(manifestPathForSidecar(primaryOutput), buildRunManifest({
    generatedAt: report.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-character-ref-cohort",
    variantId: "character-ref-cohort",
    parentRunId: parentManifests.length === 1 ? parentManifests[0]!.runId : null,
    rootRunId: parentManifests.length === 1 ? parentManifests[0]!.rootRunId : null,
    command: {
      name: "diagnostics:corpus-recreation-character-ref-cohort",
      argv: process.argv.slice(2),
    },
    inputs: characterRefCohortInputRefs(args.pocDirs),
    outputs: existingArtifactRefs([
      ...(args.output ? [{ path: args.output, role: "character-ref-cohort-markdown" }] : []),
      ...(args.json ? [{ path: args.json, role: "character-ref-cohort-json" }] : []),
    ]),
    relatedRunIds: parentManifests.map(manifest => manifest.runId),
    discriminator: `rows-${report.rowCount}-issues-${report.totals.classifiedIssueCount}`,
    metadata: {
      pocDirs: args.pocDirs,
      rowCount: report.rowCount,
      classifiedIssueCount: report.totals.classifiedIssueCount,
      characterRefClosureCount: report.totals.characterRefClosureCount,
      sceneCount: report.totals.sceneCount,
    },
  }))
}

function characterRefCohortInputRefs(pocDirs: string[]) {
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
