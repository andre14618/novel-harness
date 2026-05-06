#!/usr/bin/env bun
/**
 * Live disposable A/B runner for factRoleContextPolicy.
 *
 * The runtime policy is already wired in drafting. This script supplies the
 * missing eval harness: clone one frozen drafting source into legacy and
 * role-aware arms, optionally inject a small role fixture into the clones, run
 * both arms in auto mode, and write prompt-exposure/checker metrics to disk.
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"

import db from "../../src/db/connection"
import { buildCheckerWarningReport, type CheckerWarningReport, type ContinuityCallRow, type FunctionalEventRow } from "../analysis/checker-warning-report"
import { buildFactRoleContextPreview, type FactRoleContextPreviewReport } from "../analysis/fact-role-context-preview"
import { buildPlanDriftReport, type PlanCheckCallRow, type PlanDriftReport } from "../analysis/plan-drift-report"

export type ArmPolicy = "legacy" | "role-aware"
type FactRole = "operational" | "reference" | "hidden" | "unknown"

export interface Args {
  source: string
  chapters: number
  outputBase: string
  keepNovels: boolean
  injectFixture: string | null
  allowNoRoleDelta: boolean
  allowSingleChapter: boolean
}

export interface RoleFactForExposure {
  id: string
  fact: string
  category: string | null
  establishedInChapter: number
  role: FactRole
}

export interface PromptRowForExposure {
  id: number
  agent: string
  chapter: number | null
  beatIndex: number | null
  attempt: number | null
  userPrompt: string | null
}

export interface RolePromptExposure {
  byRole: Record<FactRole, RolePromptExposureRole>
}

export interface RolePromptExposureRole {
  role: FactRole
  factCount: number
  factsWithWriterHit: number
  factsWithContinuityHit: number
  writerPromptHits: number
  continuityPromptHits: number
  samples: Array<{
    factId: string
    fact: string
    writerPromptHits: number
    continuityPromptHits: number
  }>
}

export interface ArmRunSummary {
  policy: ArmPolicy
  novelId: string
  process: {
    exitCode: number | null
    signal: string | null
    stdoutPath: string
    stderrPath: string
  }
  novel: {
    phase: string | null
    currentChapter: number | null
    totalChapters: number | null
    completed: boolean
  }
  roleCounts: Record<FactRole, number>
  promptExposure: RolePromptExposure
  drafts: {
    latestChapters: number
    approvedChapters: number
    totalWords: number
    rows: Array<{
      chapter: number
      version: number
      status: string
      wordCount: number
    }>
  }
  llm: {
    calls: number
    failedCalls: number
    costUsd: number
    agents: Array<{
      agent: string
      calls: number
      failedCalls: number
      costUsd: number
    }>
  }
  checker: {
    planDrift: PlanDriftReport
    warnings: CheckerWarningReport
    hallucUngrounded: {
      calls: number
      blockerIssues: number
    }
  }
}

export interface LiveAbReport {
  generatedAt: string
  sourceNovelId: string
  chapters: number
  outputBase: string
  injectedFixture: string | null
  sourcePreflight: SourcePreflight
  sourceContextPreview: FactRoleContextPreviewReport
  arms: ArmRunSummary[]
  delta: {
    approvedChapters: number
    hiddenWriterFactsWithHit: number
    hiddenContinuityFactsWithHit: number
    referenceContinuityFactsWithHit: number
    blockerWarnings: number
    hallucBlockerIssues: number
    costUsd: number
  } | null
}

export interface SourcePreflight {
  sourceNovelId: string
  phase: string
  totalChapters: number
  outlineCount: number
  roleCounts: Record<FactRole, number>
  nonOperationalFacts: number
}

interface FixtureFact {
  fact: string
  category?: string | null
  establishedInChapter?: number
  role?: string | null
}

interface RoleContextFixture {
  facts: FixtureFact[]
}

const ARM_POLICIES: ArmPolicy[] = ["legacy", "role-aware"]

export function parseArgs(argv: string[]): Args {
  const map: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eq = arg.match(/^--([^=]+)=(.*)$/)
    if (eq) {
      map[eq[1]!] = eq[2]!
      continue
    }
    if (!arg.startsWith("--")) throw new Error(`unknown arg: ${arg}`)
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) {
      map[key] = next
      i++
    } else {
      map[key] = true
    }
  }

  const source = stringOpt(map.source)
  if (!source) throw new Error("--source is required")

  const chapters = numberOpt(map.chapters, 2)
  if (!Number.isInteger(chapters) || chapters <= 0) {
    throw new Error(`--chapters must be a positive integer, got ${String(map.chapters)}`)
  }

  const rawOutput = stringOpt(map["output-base"]) ?? join("output", "evals", "fact-role-context-live-ab", stamp())
  return {
    source,
    chapters,
    outputBase: isAbsolute(rawOutput) ? rawOutput : resolve(process.cwd(), rawOutput),
    keepNovels: boolOpt(map["keep-novels"]),
    injectFixture: stringOpt(map["inject-fixture"]) ?? null,
    allowNoRoleDelta: boolOpt(map["allow-no-role-delta"]),
    allowSingleChapter: boolOpt(map["allow-single-chapter"]),
  }
}

export function buildRolePromptExposure(
  facts: readonly RoleFactForExposure[],
  promptRows: readonly PromptRowForExposure[],
): RolePromptExposure {
  const byRole = makeExposureRoleMap()
  const writerRows = promptRows.filter(row => row.agent === "beat-writer" || row.agent === "writer")
  const continuityRows = promptRows.filter(row => row.agent === "continuity-facts")

  for (const fact of facts) {
    const role = normalizeFactRole(fact.role)
    const bucket = byRole[role]
    bucket.factCount++
    const writerPromptHits = countPromptHits(writerRows, fact.fact)
    const continuityPromptHits = countPromptHits(continuityRows, fact.fact)
    if (writerPromptHits > 0) bucket.factsWithWriterHit++
    if (continuityPromptHits > 0) bucket.factsWithContinuityHit++
    bucket.writerPromptHits += writerPromptHits
    bucket.continuityPromptHits += continuityPromptHits
    if ((writerPromptHits > 0 || continuityPromptHits > 0) && bucket.samples.length < 3) {
      bucket.samples.push({
        factId: fact.id,
        fact: snippet(fact.fact, 140),
        writerPromptHits,
        continuityPromptHits,
      })
    }
  }

  return { byRole }
}

export function buildLiveAbDelta(arms: readonly ArmRunSummary[]): LiveAbReport["delta"] {
  const legacy = arms.find(arm => arm.policy === "legacy")
  const roleAware = arms.find(arm => arm.policy === "role-aware")
  if (!legacy || !roleAware) return null
  const legacyBlockerWarnings = legacy.checker.warnings.bySeverity.blocker ?? 0
  const roleBlockerWarnings = roleAware.checker.warnings.bySeverity.blocker ?? 0
  return {
    approvedChapters: roleAware.drafts.approvedChapters - legacy.drafts.approvedChapters,
    hiddenWriterFactsWithHit:
      roleAware.promptExposure.byRole.hidden.factsWithWriterHit -
      legacy.promptExposure.byRole.hidden.factsWithWriterHit,
    hiddenContinuityFactsWithHit:
      roleAware.promptExposure.byRole.hidden.factsWithContinuityHit -
      legacy.promptExposure.byRole.hidden.factsWithContinuityHit,
    referenceContinuityFactsWithHit:
      roleAware.promptExposure.byRole.reference.factsWithContinuityHit -
      legacy.promptExposure.byRole.reference.factsWithContinuityHit,
    blockerWarnings: roleBlockerWarnings - legacyBlockerWarnings,
    hallucBlockerIssues:
      roleAware.checker.hallucUngrounded.blockerIssues -
      legacy.checker.hallucUngrounded.blockerIssues,
    costUsd: roleAware.llm.costUsd - legacy.llm.costUsd,
  }
}

export function renderLiveAbReport(report: LiveAbReport): string {
  const lines: string[] = []
  lines.push("# Fact Role Context Live A/B")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Source: ${report.sourceNovelId}`)
  lines.push(`Chapters: ${report.chapters}`)
  lines.push(`Injected fixture: ${report.injectedFixture ?? "(none)"}`)
  lines.push("")
  lines.push("## Source Preflight")
  lines.push("")
  lines.push(`phase=${report.sourcePreflight.phase}; outlines=${report.sourcePreflight.outlineCount}; facts=${formatRoleCounts(report.sourcePreflight.roleCounts)}`)
  lines.push("")
  lines.push("## Arms")
  lines.push("")
  lines.push("| policy | novel | completed | approved | words | llm calls | cost | hidden writer facts | hidden continuity facts | reference continuity facts | blockers | halluc blockers |")
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
  for (const arm of report.arms) {
    lines.push([
      arm.policy,
      arm.novelId,
      String(arm.novel.completed),
      `${arm.drafts.approvedChapters}/${report.chapters}`,
      String(arm.drafts.totalWords),
      String(arm.llm.calls),
      `$${arm.llm.costUsd.toFixed(4)}`,
      String(arm.promptExposure.byRole.hidden.factsWithWriterHit),
      String(arm.promptExposure.byRole.hidden.factsWithContinuityHit),
      String(arm.promptExposure.byRole.reference.factsWithContinuityHit),
      String(arm.checker.warnings.bySeverity.blocker ?? 0),
      String(arm.checker.hallucUngrounded.blockerIssues),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"))
  }
  if (report.delta) {
    lines.push("")
    lines.push("## Delta")
    lines.push("")
    lines.push("role-aware minus legacy:")
    lines.push(`- approvedChapters: ${signed(report.delta.approvedChapters)}`)
    lines.push(`- hiddenWriterFactsWithHit: ${signed(report.delta.hiddenWriterFactsWithHit)}`)
    lines.push(`- hiddenContinuityFactsWithHit: ${signed(report.delta.hiddenContinuityFactsWithHit)}`)
    lines.push(`- referenceContinuityFactsWithHit: ${signed(report.delta.referenceContinuityFactsWithHit)}`)
    lines.push(`- blockerWarnings: ${signed(report.delta.blockerWarnings)}`)
    lines.push(`- hallucBlockerIssues: ${signed(report.delta.hallucBlockerIssues)}`)
    lines.push(`- costUsd: ${signed(report.delta.costUsd, 4)}`)
  }
  lines.push("")
  lines.push("## Prompt Samples")
  for (const arm of report.arms) {
    lines.push("")
    lines.push(`### ${arm.policy}`)
    for (const role of ["hidden", "reference", "operational"] as FactRole[]) {
      const bucket = arm.promptExposure.byRole[role]
      lines.push(`- ${role}: writerFacts=${bucket.factsWithWriterHit}/${bucket.factCount}; continuityFacts=${bucket.factsWithContinuityHit}/${bucket.factCount}`)
      for (const sample of bucket.samples) {
        lines.push(`  - ${sample.factId}: writer=${sample.writerPromptHits}; continuity=${sample.continuityPromptHits}; ${sample.fact}`)
      }
    }
  }
  return lines.join("\n")
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/evals/fact-role-context-live-ab.ts --source <drafting-source-novel-id> [--chapters 2] [--inject-fixture tests/role-context-policy-fixtures/reference-hidden-basic.json] [--output-base output/evals/... ] [--keep-novels]")
    return 2
  }

  mkdirSync(args.outputBase, { recursive: true })
  const runTag = stamp()
  const createdNovels: string[] = []

  try {
    const preflight = await validateSource(args)
    const sourceContextPreview = await loadContextPreview(args.source)
    const targets: Array<{ policy: ArmPolicy; novelId: string }> = []

    for (const policy of ARM_POLICIES) {
      const novelId = `fact-role-ab-${runTag}-${policy.replace(/[^a-z0-9]/gi, "-")}`
      cloneForPolicy(args.source, novelId, policy)
      createdNovels.push(novelId)
      await capNovelChapters(novelId, args.chapters)
      if (args.injectFixture) await injectFixtureFacts(novelId, args.injectFixture)
      targets.push({ policy, novelId })
    }

    const arms: ArmRunSummary[] = []
    for (const target of targets) {
      const processResult = runArmProcess(target.policy, target.novelId, args.outputBase)
      arms.push(await collectArmSummary(target.policy, target.novelId, processResult, args.chapters))
    }

    const report: LiveAbReport = {
      generatedAt: new Date().toISOString(),
      sourceNovelId: args.source,
      chapters: args.chapters,
      outputBase: args.outputBase,
      injectedFixture: args.injectFixture,
      sourcePreflight: preflight,
      sourceContextPreview,
      arms,
      delta: buildLiveAbDelta(arms),
    }

    const jsonPath = join(args.outputBase, "summary.json")
    const markdownPath = join(args.outputBase, "report.md")
    writeFileSync(jsonPath, JSON.stringify(report, null, 2))
    writeFileSync(markdownPath, renderLiveAbReport(report))
    console.log(renderLiveAbReport(report))
    console.log(`\nWrote ${jsonPath}`)
    console.log(`Wrote ${markdownPath}`)

    const completed = arms.every(arm => arm.novel.completed)
    return completed ? 0 : 1
  } catch (err) {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    return 1
  } finally {
    if (!args.keepNovels) {
      await cleanupNovels(createdNovels)
    } else if (createdNovels.length > 0) {
      console.error(`Keeping disposable clones: ${createdNovels.join(", ")}`)
    }
    await db.end().catch(() => {})
  }
}

async function validateSource(args: Args): Promise<SourcePreflight> {
  const rows = await db<Array<{ id: string; phase: string; total_chapters: number }>>`
    SELECT id, phase, total_chapters FROM novels WHERE id = ${args.source}
  `
  const novel = rows[0]
  if (!novel) throw new Error(`source novel not found: ${args.source}`)

  const [{ n: outlineCount } = { n: 0 }] = await db<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM chapter_outlines WHERE novel_id = ${args.source}
  `
  const roleCounts = await loadRoleCounts(args.source)
  const nonOperationalFacts = (roleCounts.reference ?? 0) + (roleCounts.hidden ?? 0)
  if (outlineCount < args.chapters) {
    throw new Error(`source has ${outlineCount} chapter outline(s), but --chapters=${args.chapters}`)
  }
  if (args.chapters < 2 && !args.allowSingleChapter) {
    throw new Error("--chapters must be at least 2 for prior-fact writer exposure; pass --allow-single-chapter to override")
  }
  if (nonOperationalFacts === 0 && !args.injectFixture && !args.allowNoRoleDelta) {
    throw new Error("source has no reference/hidden facts; use --inject-fixture with disposable clones or pass --allow-no-role-delta")
  }
  return {
    sourceNovelId: args.source,
    phase: novel.phase,
    totalChapters: Number(novel.total_chapters ?? 0),
    outlineCount: Number(outlineCount ?? 0),
    roleCounts,
    nonOperationalFacts,
  }
}

function cloneForPolicy(source: string, target: string, policy: ArmPolicy): void {
  const result = spawnSync("bun", [
    "scripts/variant/clone-for-variant.ts",
    "--source", source,
    "--target", target,
    "--target-phase", "drafting",
    "--fact-role-context-policy", policy,
  ], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    throw new Error(`clone-for-variant failed for ${target}: exit=${result.status}`)
  }
}

async function capNovelChapters(novelId: string, chapters: number): Promise<void> {
  await db`
    UPDATE novels
    SET total_chapters = ${chapters},
        seed_json = jsonb_set(seed_json, '{chapterCount}', to_jsonb(${chapters}::int), true),
        updated_at = now()
    WHERE id = ${novelId}
  `
}

async function injectFixtureFacts(novelId: string, fixturePath: string): Promise<void> {
  const abs = isAbsolute(fixturePath) ? fixturePath : resolve(process.cwd(), fixturePath)
  const parsed = JSON.parse(await readFile(abs, "utf8")) as RoleContextFixture
  if (!Array.isArray(parsed.facts)) throw new Error(`fixture has no facts array: ${fixturePath}`)
  await db.begin(async tx => {
    for (const fact of parsed.facts) {
      const role = normalizeFactRole(fact.role)
      if (role === "unknown") throw new Error(`fixture fact has unsupported role: ${String(fact.role)}`)
      await tx`
        INSERT INTO facts (novel_id, fact, category, established_in_chapter, role)
        VALUES (
          ${novelId},
          ${fact.fact},
          ${fact.category ?? "fixture"},
          ${fact.establishedInChapter ?? 1},
          ${role}
        )
      `
    }
  })
}

function runArmProcess(policy: ArmPolicy, novelId: string, outputBase: string): ArmRunSummary["process"] {
  const stdoutPath = join(outputBase, `${policy}.stdout.log`)
  const stderrPath = join(outputBase, `${policy}.stderr.log`)
  const result = spawnSync("bun", ["src/index.ts", "--resume", novelId, "--auto"], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    env: { ...process.env },
  })
  writeFileSync(stdoutPath, result.stdout ?? "")
  writeFileSync(stderrPath, result.stderr ?? "")
  return {
    exitCode: result.status,
    signal: result.signal,
    stdoutPath,
    stderrPath,
  }
}

async function collectArmSummary(
  policy: ArmPolicy,
  novelId: string,
  processResult: ArmRunSummary["process"],
  chapters: number,
): Promise<ArmRunSummary> {
  const novelRows = await db<Array<{ phase: string; current_chapter: number; total_chapters: number }>>`
    SELECT phase, current_chapter, total_chapters FROM novels WHERE id = ${novelId}
  `
  const novel = novelRows[0] ?? null
  const roleCounts = await loadRoleCounts(novelId)
  const facts = await loadFactsForExposure(novelId, chapters)
  const promptRows = await loadPromptRows(novelId)
  const drafts = await loadDraftSummary(novelId)
  const llm = await loadLlmSummary(novelId)
  const planDrift = buildPlanDriftReport(await loadPlanCheckRows(novelId), novelId)
  const warnings = buildCheckerWarningReport(await loadCheckerWarningInputs(novelId), novelId)
  const hallucUngrounded = await loadHallucSummary(novelId)

  return {
    policy,
    novelId,
    process: processResult,
    novel: {
      phase: novel?.phase ?? null,
      currentChapter: novel?.current_chapter ?? null,
      totalChapters: novel?.total_chapters ?? null,
      completed: novel?.phase === "done" && drafts.approvedChapters >= chapters,
    },
    roleCounts,
    promptExposure: buildRolePromptExposure(facts, promptRows),
    drafts,
    llm,
    checker: { planDrift, warnings, hallucUngrounded },
  }
}

async function loadFactsForExposure(novelId: string, chapters: number): Promise<RoleFactForExposure[]> {
  const rows = await db<Array<{
    id: string
    fact: string
    category: string | null
    established_in_chapter: number
    role: string | null
  }>>`
    SELECT id::text, fact, category, established_in_chapter, role
    FROM facts
    WHERE novel_id = ${novelId}
      AND established_in_chapter <= ${chapters}
    ORDER BY established_in_chapter, id
  `
  return rows.map(row => ({
    id: row.id,
    fact: row.fact,
    category: row.category,
    establishedInChapter: Number(row.established_in_chapter),
    role: normalizeFactRole(row.role),
  }))
}

async function loadPromptRows(novelId: string): Promise<PromptRowForExposure[]> {
  const rows = await db<Array<{
    id: number
    agent: string
    chapter: number | null
    beat_index: number | null
    attempt: number | null
    user_prompt: string | null
  }>>`
    SELECT id, agent, chapter, beat_index, attempt, user_prompt
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent IN ('beat-writer', 'writer', 'continuity-facts')
    ORDER BY id
  `
  return rows.map(row => ({
    id: row.id,
    agent: row.agent,
    chapter: row.chapter,
    beatIndex: row.beat_index,
    attempt: row.attempt,
    userPrompt: row.user_prompt,
  }))
}

async function loadDraftSummary(novelId: string): Promise<ArmRunSummary["drafts"]> {
  const rows = await db<Array<{ chapter_number: number; version: number; status: string; word_count: number }>>`
    SELECT DISTINCT ON (chapter_number) chapter_number, version, status, word_count
    FROM chapter_drafts
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number, version DESC
  `
  const mapped = rows.map(row => ({
    chapter: Number(row.chapter_number),
    version: Number(row.version),
    status: row.status,
    wordCount: Number(row.word_count),
  }))
  return {
    latestChapters: mapped.length,
    approvedChapters: mapped.filter(row => row.status === "approved").length,
    totalWords: mapped.reduce((sum, row) => sum + row.wordCount, 0),
    rows: mapped,
  }
}

async function loadLlmSummary(novelId: string): Promise<ArmRunSummary["llm"]> {
  const [totals] = await db<Array<{ calls: number; failed_calls: number; cost: string }>>`
    SELECT COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE failed)::int AS failed_calls,
           COALESCE(SUM(cost), 0)::text AS cost
    FROM llm_calls
    WHERE novel_id = ${novelId}
  `
  const agents = await db<Array<{ agent: string; calls: number; failed_calls: number; cost: string }>>`
    SELECT agent,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE failed)::int AS failed_calls,
           COALESCE(SUM(cost), 0)::text AS cost
    FROM llm_calls
    WHERE novel_id = ${novelId}
    GROUP BY agent
    ORDER BY calls DESC, agent
  `
  return {
    calls: Number(totals?.calls ?? 0),
    failedCalls: Number(totals?.failed_calls ?? 0),
    costUsd: Number(totals?.cost ?? 0),
    agents: agents.map(row => ({
      agent: row.agent,
      calls: Number(row.calls),
      failedCalls: Number(row.failed_calls),
      costUsd: Number(row.cost),
    })),
  }
}

async function loadPlanCheckRows(novelId: string): Promise<PlanCheckCallRow[]> {
  return await db`
    SELECT id, novel_id, chapter, attempt, response_content, timestamp
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'chapter-plan-checker'
    ORDER BY chapter, attempt NULLS LAST, id
  ` as PlanCheckCallRow[]
}

async function loadCheckerWarningInputs(novelId: string): Promise<{
  functionalEvents: FunctionalEventRow[]
  continuityRows: ContinuityCallRow[]
}> {
  const functionalEvents = await db`
    SELECT id, chapter, payload, timestamp
    FROM pipeline_events
    WHERE novel_id = ${novelId}
      AND event_type = 'functional-check'
    ORDER BY chapter, id
  ` as FunctionalEventRow[]
  const continuityRows = await db`
    SELECT id, agent, chapter, attempt, response_content, timestamp
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent IN ('continuity-facts', 'continuity-state')
    ORDER BY chapter, attempt NULLS LAST, agent, id
  ` as ContinuityCallRow[]
  return { functionalEvents, continuityRows }
}

async function loadHallucSummary(novelId: string): Promise<ArmRunSummary["checker"]["hallucUngrounded"]> {
  const rows = await db<Array<{ response_content: string | null }>>`
    SELECT response_content
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'halluc-ungrounded'
  `
  let blockerIssues = 0
  for (const row of rows) {
    if (!row.response_content) continue
    try {
      const parsed = JSON.parse(row.response_content)
      if (parsed?.pass === false && Array.isArray(parsed.issues)) {
        blockerIssues += parsed.issues.filter((issue: any) => issue?.severity === "blocker" || issue?.severity === undefined).length
      }
    } catch {}
  }
  return { calls: rows.length, blockerIssues }
}

async function loadRoleCounts(novelId: string): Promise<Record<FactRole, number>> {
  const counts = makeRoleCountMap()
  const rows = await db<Array<{ role: string | null; count: number }>>`
    SELECT role, COUNT(*)::int AS count
    FROM facts
    WHERE novel_id = ${novelId}
    GROUP BY role
  `
  for (const row of rows) counts[normalizeFactRole(row.role)] += Number(row.count)
  return counts
}

async function loadContextPreview(novelId: string): Promise<FactRoleContextPreviewReport> {
  const legacy = await db<Array<{ novel_id: string; category: string | null; role?: string | null }>>`
    SELECT novel_id, category, role FROM facts WHERE novel_id = ${novelId}
  `
  const canon = await db<Array<{ novel_id: string; kind: string | null; role?: string | null; superseded_by_version?: number | null }>>`
    SELECT novel_id, kind, role, superseded_by_version
    FROM canon_facts
    WHERE novel_id = ${novelId}
      AND superseded_by_version IS NULL
  `
  return buildFactRoleContextPreview(legacy, canon, novelId)
}

async function cleanupNovels(novelIds: readonly string[]): Promise<void> {
  if (novelIds.length === 0) return
  const { clearNovelState } = await import("../../tests/phase-parity/db-snapshot")
  for (const novelId of novelIds) {
    try {
      await clearNovelState(novelId)
      console.error(`cleaned ${novelId}`)
    } catch (err) {
      console.error(`cleanup failed for ${novelId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

function makeExposureRoleMap(): Record<FactRole, RolePromptExposureRole> {
  return {
    operational: makeExposureRole("operational"),
    reference: makeExposureRole("reference"),
    hidden: makeExposureRole("hidden"),
    unknown: makeExposureRole("unknown"),
  }
}

function makeExposureRole(role: FactRole): RolePromptExposureRole {
  return {
    role,
    factCount: 0,
    factsWithWriterHit: 0,
    factsWithContinuityHit: 0,
    writerPromptHits: 0,
    continuityPromptHits: 0,
    samples: [],
  }
}

function makeRoleCountMap(): Record<FactRole, number> {
  return { operational: 0, reference: 0, hidden: 0, unknown: 0 }
}

function countPromptHits(rows: readonly PromptRowForExposure[], fact: string): number {
  if (fact.trim().length === 0) return 0
  return rows.reduce((count, row) => count + (row.userPrompt?.includes(fact) ? 1 : 0), 0)
}

function normalizeFactRole(value: unknown): FactRole {
  return value === "operational" || value === "reference" || value === "hidden" ? value : "unknown"
}

function stringOpt(value: string | true | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function numberOpt(value: string | true | undefined, fallback: number): number {
  const raw = stringOpt(value)
  return raw ? Number(raw) : fallback
}

function boolOpt(value: string | true | undefined): boolean {
  return value === true || value === "true"
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function snippet(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`
}

function formatRoleCounts(counts: Record<FactRole, number>): string {
  return `operational=${counts.operational}, reference=${counts.reference}, hidden=${counts.hidden}, unknown=${counts.unknown}`
}

function signed(value: number, digits = 0): string {
  const rendered = digits > 0 ? value.toFixed(digits) : String(value)
  return value > 0 ? `+${rendered}` : rendered
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
