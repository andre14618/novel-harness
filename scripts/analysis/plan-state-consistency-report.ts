#!/usr/bin/env bun
/**
 * Adjacent-chapter plan/state consistency review.
 *
 * This is a source-plan diagnostic: it evaluates whether chapter N's declared
 * end state can feed chapter N+1 without contradiction, then emits
 * Plan-Readiness-compatible repair targets. It does not mutate plans.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { z } from "zod"
import { callAgent } from "../../src/llm"
import { initNovelRun } from "../../src/logger"
import type { ChapterOutline } from "../../src/types"

type Severity = "high" | "medium" | "low" | "info"
type Verdict = "clear" | "contradiction" | "status_ambiguity" | "handoff_risk"

export interface PlanStateConsistencyArgs {
  novelId: string
  outputDirPath: string | null
  live: boolean
  importReadiness: boolean
}

export interface PlanStateConsistencyPairPacket {
  pairId: string
  priorChapter: ChapterPacket
  nextChapter: ChapterPacket
  targetOptions: Array<{
    key: string
    kind: "chapter_outline" | "scene_plan"
    ref: string
    fieldPath: string
    summary: string
  }>
}

interface ChapterPacket {
  chapterNumber: number
  chapterId: string
  title: string
  purpose: string
  setting: string
  charactersPresent: string[]
  scenes: ScenePacket[]
  establishedFacts: Array<{
    id: string
    fact: string
    category: string
    factStatus: "completed" | "intended" | "pending" | "belief"
  }>
  characterStateChanges: Array<{
    id: string
    characterId: string
    name: string
    location: string
    emotionalState: string
    knows: string[]
    doesNotKnow: string[]
  }>
  knowledgeChanges: Array<{
    id: string
    characterId: string
    characterName: string
    knowledge: string
    source: string
  }>
}

interface ScenePacket {
  sceneId: string
  description: string
  goal: string
  opposition: string
  outcome: string
  consequence: string
  characters: string[]
}

const judgeFindingSchema = z.object({
  verdict: z.enum(["clear", "contradiction", "status_ambiguity", "handoff_risk"]).default("clear").catch("clear"),
  severity: z.enum(["high", "medium", "low", "info"]).default("info").catch("info"),
  label: z.string().default("PLAN-STATE-CONSISTENCY").catch("PLAN-STATE-CONSISTENCY"),
  repairTargetKey: z.string().default("").catch(""),
  rationale: z.string().default("").catch(""),
  evidence: z.string().default("").catch(""),
  missingForNextLevel: z.string().default("").catch(""),
})

const judgeOutputSchema = z.object({
  findings: z.array(judgeFindingSchema).default([]).catch([]),
})

export type PlanStateConsistencyJudgeOutput = z.infer<typeof judgeOutputSchema>
export type PlanStateConsistencyJudge = (
  packet: PlanStateConsistencyPairPacket,
) => Promise<PlanStateConsistencyJudgeOutput> | PlanStateConsistencyJudgeOutput

interface PlanStateConsistencyFinding {
  findingId: string
  pairId: string
  sourceReport: string
  promptMode: string
  dimension: "planConsistency"
  label: string
  severity: Severity
  verdict: Exclude<Verdict, "clear">
  fixIntent: string
  rationale: string
  missingForNextLevel: string
  evidence: Record<string, string>
  target: {
    kind: "chapter_outline" | "scene_plan"
    ref: string
    fieldPath: string
  }
}

interface PlanStateConsistencyGroup {
  groupId: string
  fixtureId: string
  armId: "plan-state-consistency"
  methodPackEnabled: false
  unitType: "chapter_pair"
  chapterId: string
  sceneId: string
  sourceIds: SourceIds
  highestSeverity: Severity
  fixIntents: string[]
  dimensions: ["planConsistency"]
  findings: Array<Omit<PlanStateConsistencyFinding, "pairId" | "verdict" | "target">>
  rewritePacket: {
    targetSummary: string
    rewriteGoals: string[]
    preserveIds: SourceIds
    proposalCandidate: {
      action: "field_replace"
      target: {
        kind: "chapter_outline" | "scene_plan"
        ref: string
        fieldPath: string
      }
      requiresProposedValue: true
      proposedValueStatus: "operator_required"
      safeToAutoApply: false
      sourceAgent: "plan-state-consistency"
    }
  }
  excerpt: string
}

interface SourceIds {
  obligationIds: string[]
  characterIds: string[]
  worldFactIds: string[]
  sceneTurnIds: string[]
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  sourceIds: string[]
}

export interface PlanStateConsistencyAggregate {
  generatedAt: string
  sourceReports: string[]
  labels: string[]
  maxOrdinal: 1
  findingCount: number
  groupCount: number
  groups: PlanStateConsistencyGroup[]
}

export interface PlanStateConsistencyReport {
  generatedAt: string
  novelId: string
  mode: "semantic-live" | "heuristic-dry-run"
  pairCount: number
  findingCount: number
  pairs: Array<{
    pairId: string
    priorChapter: number
    nextChapter: number
    findingCount: number
    findings: PlanStateConsistencyFinding[]
    error?: string
  }>
}

export function parseArgs(argv = process.argv.slice(2)): PlanStateConsistencyArgs {
  let novelId = ""
  let outputDirPath: string | null = null
  let live = false
  let importReadiness = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      novelId = requireValue(argv[++i], "--novel")
    } else if (arg === "--output-dir") {
      outputDirPath = requireValue(argv[++i], "--output-dir")
    } else if (arg === "--live") {
      live = true
    } else if (arg === "--dry-run") {
      live = false
    } else if (arg === "--import-readiness") {
      importReadiness = true
    } else if (arg === "--no-import-readiness") {
      importReadiness = false
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }

  if (!novelId) throw new Error("--novel is required")
  return { novelId, outputDirPath, live, importReadiness }
}

export async function buildPlanStateConsistencyReport(input: {
  novelId: string
  outlines: readonly ChapterOutline[]
  live?: boolean
  judgePair?: PlanStateConsistencyJudge
  generatedAt?: string
}): Promise<{
  report: PlanStateConsistencyReport
  aggregate: PlanStateConsistencyAggregate
}> {
  const live = input.live === true
  const packets = buildPlanStateConsistencyPairPackets(input.outlines)
  const pairs: PlanStateConsistencyReport["pairs"] = []
  const allFindings: PlanStateConsistencyFinding[] = []
  const generatedAt = input.generatedAt ?? new Date().toISOString()

  for (const packet of packets) {
    let parsed: PlanStateConsistencyJudgeOutput
    try {
      const judged = input.judgePair
        ? await input.judgePair(packet)
        : live
          ? await judgePlanStateConsistencyPair(packet, input.novelId)
          : heuristicJudgePair(packet)
      parsed = judgeOutputSchema.parse(judged)
    } catch (err) {
      pairs.push({
        pairId: packet.pairId,
        priorChapter: packet.priorChapter.chapterNumber,
        nextChapter: packet.nextChapter.chapterNumber,
        findingCount: 0,
        findings: [],
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    const findings = parsed.findings
      .filter(finding => finding.verdict !== "clear")
      .map((finding, index) => normalizeJudgeFinding({
        finding,
        packet,
        novelId: input.novelId,
        findingIndex: index,
        promptMode: live ? "deepseek-v4-flash-semantic" : "heuristic-dry-run",
      }))
    pairs.push({
      pairId: packet.pairId,
      priorChapter: packet.priorChapter.chapterNumber,
      nextChapter: packet.nextChapter.chapterNumber,
      findingCount: findings.length,
      findings,
    })
    allFindings.push(...findings)
  }

  const report: PlanStateConsistencyReport = {
    generatedAt,
    novelId: input.novelId,
    mode: live ? "semantic-live" : "heuristic-dry-run",
    pairCount: packets.length,
    findingCount: allFindings.length,
    pairs,
  }
  const aggregate = buildPlanStateConsistencyReadinessAggregate(report)
  return { report, aggregate }
}

export function buildPlanStateConsistencyPairPackets(
  outlines: readonly ChapterOutline[],
): PlanStateConsistencyPairPacket[] {
  const sorted = [...outlines].sort((a, b) => a.chapterNumber - b.chapterNumber)
  const packets: PlanStateConsistencyPairPacket[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const prior = chapterPacket(sorted[i]!)
    const next = chapterPacket(sorted[i + 1]!)
    const pairId = `ch-${prior.chapterNumber}-to-${next.chapterNumber}`
    packets.push({
      pairId,
      priorChapter: {
        ...prior,
        scenes: prior.scenes.slice(-2),
      },
      nextChapter: {
        ...next,
        scenes: next.scenes.slice(0, 3),
        establishedFacts: [],
        characterStateChanges: [],
        knowledgeChanges: [],
      },
      targetOptions: [
        chapterTargetOption(prior, "purpose"),
        chapterTargetOption(prior, "establishedFacts"),
        chapterTargetOption(next, "purpose"),
        ...prior.scenes.slice(-2).flatMap(scene => sceneTargetOptions(scene)),
        ...next.scenes.slice(0, 3).flatMap(scene => sceneTargetOptions(scene)),
      ],
    })
  }
  return packets
}

async function judgePlanStateConsistencyPair(
  packet: PlanStateConsistencyPairPacket,
  novelId: string,
): Promise<PlanStateConsistencyJudgeOutput> {
  const result = await callAgent({
    systemPrompt: PLAN_STATE_CONSISTENCY_SYSTEM_PROMPT,
    userPrompt: JSON.stringify(packet, null, 2),
    schema: judgeOutputSchema,
    temperature: 0.1,
    maxTokens: 3000,
    thinking: true,
    novelId,
    agentName: "plan-state-consistency",
    provider: "deepseek",
    model: "deepseek-v4-flash",
  })
  return result.output
}

const PLAN_STATE_CONSISTENCY_SYSTEM_PROMPT = `You are a plan-state consistency judge for a novel-planning harness.

Compare one adjacent chapter pair. Decide whether chapter N's declared end state can feed chapter N+1's opening plan without contradiction.

Important distinction:
- A character deciding, intending, preparing, or planning to do X is not the same as X being completed.
- If prior chapter state says an action is completed, chapter N+1 must honor that completed state.
- If prior state only says an action is intended/pending, chapter N+1 may show that the intended action happened offscreen during the chapter break, as long as the transition is plausible and the next opening honors the planned route, participants, and consequences.
- Do not require an intended/pending state to be rewritten as completed just because chapter N+1 opens after the intended action has occurred.
- Flag intended/pending transitions only when the next opening contradicts the intended plan, skips a material required scene turn, or makes an impossible spatial/physical jump.

Flag only chapter-handoff issues, not prose quality. Prefer "status_ambiguity" when the likely fix is to label or word a state as intended rather than completed. Use "contradiction" when the two plans cannot both be true as written.

Return ONLY JSON:
{
  "findings": [
    {
      "verdict": "contradiction" | "status_ambiguity" | "handoff_risk" | "clear",
      "severity": "high" | "medium" | "low" | "info",
      "label": "CROSS-CHAPTER-STATE-CONTRADICTION" | "PLANNED-VS-EXECUTED-AMBIGUITY" | "PLAN-HANDOFF-RISK",
      "repairTargetKey": "one exact key from targetOptions",
      "rationale": "brief reason",
      "evidence": "short evidence from the provided plan fields",
      "missingForNextLevel": "what a planning edit needs to change"
    }
  ]
}

If no actionable issue exists, return {"findings":[]}.`

function heuristicJudgePair(packet: PlanStateConsistencyPairPacket): PlanStateConsistencyJudgeOutput {
  const priorText = packetText(packet.priorChapter)
  const nextText = packetText(packet.nextChapter)
  const priorMentionsSplit = /\b(split|separat(?:e|ely|ion)|different routes?|alone)\b/i.test(priorText)
  const priorMentionsIntention = /\b(decide|decides|decided|intend|intends|intended|plan|plans|planned|prepare|prepares|prepared)\b/i.test(priorText)
  const nextMentionsTogether = /\b(together|with each other|side by side|both reach|they reach|they leave)\b/i.test(nextText)
  if (!priorMentionsSplit || !nextMentionsTogether) return { findings: [] }
  const repairTarget = priorMentionsIntention
    ? packet.targetOptions.find(target => target.kind === "scene_plan" && target.fieldPath === "consequence")?.key
    : undefined
  return {
    findings: [{
      verdict: priorMentionsIntention ? "status_ambiguity" : "contradiction",
      severity: "high",
      label: priorMentionsIntention ? "PLANNED-VS-EXECUTED-AMBIGUITY" : "CROSS-CHAPTER-STATE-CONTRADICTION",
      repairTargetKey: repairTarget ?? packet.targetOptions.find(target => target.kind === "chapter_outline" && target.fieldPath === "purpose")?.key ?? "",
      rationale: "Prior chapter state mentions a split/separate route while the next chapter opens as if the characters remain together.",
      evidence: "split/separate/alone language in prior chapter; together language in next chapter",
      missingForNextLevel: "Revise the upstream plan so the split is either only an intended plan that gets interrupted, or revise the next chapter opening to honor the completed separation.",
    }],
  }
}

function normalizeJudgeFinding(input: {
  finding: z.infer<typeof judgeFindingSchema>
  packet: PlanStateConsistencyPairPacket
  novelId: string
  findingIndex: number
  promptMode: string
}): PlanStateConsistencyFinding {
  const target = targetFromKey(input.finding.repairTargetKey, input.packet)
    ?? defaultRepairTarget(input.packet)
  return {
    findingId: `${input.packet.pairId}.${input.findingIndex + 1}`,
    pairId: input.packet.pairId,
    sourceReport: `plan-state-consistency:${input.novelId}`,
    promptMode: input.promptMode,
    dimension: "planConsistency",
    label: input.finding.label || "PLAN-STATE-CONSISTENCY",
    severity: input.finding.severity,
    verdict: input.finding.verdict as Exclude<Verdict, "clear">,
    fixIntent: input.finding.verdict === "status_ambiguity"
      ? "clarify_planned_vs_completed_state"
      : "resolve_cross_chapter_plan_state_contradiction",
    rationale: input.finding.rationale || "Adjacent chapter plans have a state handoff issue.",
    missingForNextLevel: input.finding.missingForNextLevel || "Revise the upstream chapter/scene plan so the next chapter receives a consistent state handoff.",
    target,
    evidence: {
      pairId: input.packet.pairId,
      priorChapter: String(input.packet.priorChapter.chapterNumber),
      nextChapter: String(input.packet.nextChapter.chapterNumber),
      verdict: input.finding.verdict,
      repairTargetKey: targetKey(target),
      evidence: input.finding.evidence,
      priorChapterId: input.packet.priorChapter.chapterId,
      nextChapterId: input.packet.nextChapter.chapterId,
    },
  }
}

export function buildPlanStateConsistencyReadinessAggregate(
  report: PlanStateConsistencyReport,
): PlanStateConsistencyAggregate {
  const groupsByKey = new Map<string, PlanStateConsistencyGroup>()
  for (const pair of report.pairs) {
    for (const finding of pair.findings) {
      const key = targetKey(finding.target)
      const sourceIds = emptySourceIds()
      const readinessFinding = {
        findingId: finding.findingId,
        sourceReport: finding.sourceReport,
        promptMode: finding.promptMode,
        dimension: finding.dimension,
        label: finding.label,
        severity: finding.severity,
        fixIntent: finding.fixIntent,
        rationale: finding.rationale,
        missingForNextLevel: finding.missingForNextLevel,
        evidence: finding.evidence,
      }
      const existing = groupsByKey.get(key)
      if (existing) {
        existing.findings.push(readinessFinding)
        if (severityRank(finding.severity) > severityRank(existing.highestSeverity)) {
          existing.highestSeverity = finding.severity
        }
        existing.excerpt = consistencyGroupExcerpt(existing.findings)
        existing.rewritePacket.rewriteGoals = consistencyRewriteGoals(existing.findings)
      } else {
        groupsByKey.set(key, {
          groupId: "000",
          fixtureId: report.novelId,
          armId: "plan-state-consistency",
          methodPackEnabled: false,
          unitType: "chapter_pair",
          chapterId: finding.evidence.nextChapterId,
          sceneId: finding.target.kind === "scene_plan" ? finding.target.ref : "",
          sourceIds,
          highestSeverity: finding.severity,
          fixIntents: [finding.fixIntent],
          dimensions: ["planConsistency"],
          findings: [readinessFinding],
          rewritePacket: {
            targetSummary: key,
            rewriteGoals: consistencyRewriteGoals([readinessFinding]),
            preserveIds: sourceIds,
            proposalCandidate: {
              action: "field_replace",
              target: finding.target,
              requiresProposedValue: true,
              proposedValueStatus: "operator_required",
              safeToAutoApply: false,
              sourceAgent: "plan-state-consistency",
            },
          },
          excerpt: finding.rationale,
        })
      }
    }
  }
  const groups = [...groupsByKey.values()].sort((a, b) =>
    severityRank(b.highestSeverity) - severityRank(a.highestSeverity)
    || a.rewritePacket.targetSummary.localeCompare(b.rewritePacket.targetSummary)
  )
  groups.forEach((group, groupIndex) => {
    group.groupId = `${groupIndex + 1}`.padStart(3, "0")
    group.findings.forEach((finding, findingIndex) => {
      finding.findingId = `${group.groupId}.${findingIndex + 1}`
    })
  })
  const findingCount = groups.reduce((sum, group) => sum + group.findings.length, 0)
  return {
    generatedAt: report.generatedAt,
    sourceReports: [`plan-state-consistency:${report.novelId}`],
    labels: [...new Set(groups.flatMap(group => group.findings.map(finding => finding.label)))].sort(),
    maxOrdinal: 1,
    findingCount,
    groupCount: groups.length,
    groups,
  }
}

export function renderPlanStateConsistencyReport(report: PlanStateConsistencyReport): string {
  const lines: string[] = []
  lines.push("# Plan-State Consistency Report")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Novel: ${report.novelId}`)
  lines.push(`Mode: ${report.mode}`)
  lines.push(`Pairs: ${report.pairCount}`)
  lines.push(`Findings: ${report.findingCount}`)
  lines.push("")
  for (const pair of report.pairs) {
    lines.push(`## ${pair.pairId}`)
    lines.push("")
    lines.push(`Chapters: ${pair.priorChapter} -> ${pair.nextChapter}`)
    if (pair.findings.length === 0) {
      lines.push(pair.error ? `Review error: ${pair.error}` : "No handoff issue found.")
      lines.push("")
      continue
    }
    for (const finding of pair.findings) {
      lines.push(`- [${finding.severity}] ${finding.label}: ${finding.rationale}`)
      lines.push(`  Target: ${targetKey(finding.target)}`)
      lines.push(`  Missing: ${finding.missingForNextLevel}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

export function renderPlanStateConsistencyReadinessAggregate(
  aggregate: PlanStateConsistencyAggregate,
): string {
  const lines: string[] = []
  lines.push("# Plan-State Consistency Readiness")
  lines.push("")
  lines.push(`Generated: ${aggregate.generatedAt}`)
  lines.push(`Groups: ${aggregate.groupCount}`)
  lines.push(`Findings: ${aggregate.findingCount}`)
  lines.push("")
  for (const group of aggregate.groups) {
    lines.push(`## ${group.groupId} ${group.highestSeverity.toUpperCase()} ${group.rewritePacket.targetSummary}`)
    lines.push("")
    for (const finding of group.findings) {
      lines.push(`- ${finding.findingId} ${finding.label}: ${finding.rationale}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

export function writePlanStateConsistencyArtifacts(input: {
  report: PlanStateConsistencyReport
  aggregate: PlanStateConsistencyAggregate
  outputDirPath: string
}): void {
  mkdirSync(input.outputDirPath, { recursive: true })
  writeFileSync(`${input.outputDirPath}/plan-state-consistency-report.json`, `${JSON.stringify(input.report, null, 2)}\n`)
  writeFileSync(`${input.outputDirPath}/plan-state-consistency-report.md`, renderPlanStateConsistencyReport(input.report))
  writeFileSync(`${input.outputDirPath}/plan-state-consistency-readiness.json`, `${JSON.stringify(input.aggregate, null, 2)}\n`)
  writeFileSync(`${input.outputDirPath}/plan-state-consistency-readiness.md`, renderPlanStateConsistencyReadinessAggregate(input.aggregate))
}

export async function loadPlanStateConsistencyOutlines(novelId: string): Promise<ChapterOutline[]> {
  const { default: db } = await import("../../src/db/connection")
  const rows = await db`
    SELECT outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  ` as Array<{ outline_json: ChapterOutline }>
  return rows.map(row => row.outline_json)
}

function chapterPacket(outline: ChapterOutline): ChapterPacket {
  return {
    chapterNumber: outline.chapterNumber,
    chapterId: outline.chapterId ?? `chapter:${outline.chapterNumber}`,
    title: outline.title,
    purpose: outline.purpose,
    setting: outline.setting,
    charactersPresent: outline.charactersPresent ?? [],
    scenes: (outline.scenes ?? []).map((scene, index) => ({
      sceneId: scene.sceneId ?? scene.beatId ?? `${outline.chapterId ?? `chapter-${outline.chapterNumber}`}-scene-${index + 1}`,
      description: scene.description ?? "",
      goal: scene.goal ?? "",
      opposition: scene.opposition ?? "",
      outcome: scene.outcome ?? "",
      consequence: scene.consequence ?? "",
      characters: scene.characters ?? [],
    })),
    establishedFacts: (outline.establishedFacts ?? []).map(fact => ({
      id: fact.id ?? "",
      fact: fact.fact,
      category: fact.category,
      factStatus: (fact as { factStatus?: ChapterPacket["establishedFacts"][number]["factStatus"] }).factStatus ?? "completed",
    })),
    characterStateChanges: (outline.characterStateChanges ?? []).map(change => ({
      id: change.id ?? "",
      characterId: change.characterId ?? "",
      name: change.name,
      location: change.location,
      emotionalState: change.emotionalState,
      knows: change.knows ?? [],
      doesNotKnow: change.doesNotKnow ?? [],
    })),
    knowledgeChanges: (outline.knowledgeChanges ?? []).map(change => ({
      id: change.id ?? "",
      characterId: change.characterId ?? "",
      characterName: change.characterName,
      knowledge: change.knowledge,
      source: change.source,
    })),
  }
}

function chapterTargetOption(chapter: ChapterPacket, fieldPath: string): PlanStateConsistencyPairPacket["targetOptions"][number] {
  return {
    key: targetKey({ kind: "chapter_outline", ref: chapter.chapterId, fieldPath }),
    kind: "chapter_outline",
    ref: chapter.chapterId,
    fieldPath,
    summary: `Chapter ${chapter.chapterNumber} ${fieldPath}`,
  }
}

function sceneTargetOptions(scene: ScenePacket): PlanStateConsistencyPairPacket["targetOptions"] {
  return ["description", "opposition", "outcome", "consequence"].map(fieldPath => ({
    key: targetKey({ kind: "scene_plan", ref: scene.sceneId, fieldPath }),
    kind: "scene_plan" as const,
    ref: scene.sceneId,
    fieldPath,
    summary: `Scene ${scene.sceneId} ${fieldPath}`,
  }))
}

function targetFromKey(
  key: string,
  packet: PlanStateConsistencyPairPacket,
): PlanStateConsistencyFinding["target"] | null {
  const option = packet.targetOptions.find(target => target.key === key)
  if (!option) return null
  return { kind: option.kind, ref: option.ref, fieldPath: option.fieldPath }
}

function defaultRepairTarget(packet: PlanStateConsistencyPairPacket): PlanStateConsistencyFinding["target"] {
  const priorConsequence = packet.targetOptions.find(target =>
    target.kind === "scene_plan" && target.fieldPath === "consequence"
  )
  const option = priorConsequence ?? packet.targetOptions.find(target =>
    target.kind === "chapter_outline" && target.fieldPath === "purpose"
  ) ?? packet.targetOptions[0]
  if (!option) {
    return { kind: "chapter_outline", ref: packet.nextChapter.chapterId, fieldPath: "purpose" }
  }
  return { kind: option.kind, ref: option.ref, fieldPath: option.fieldPath }
}

function targetKey(target: { kind: string; ref: string; fieldPath?: string }): string {
  return `${target.kind}:${target.ref}${target.fieldPath ? `:${target.fieldPath}` : ""}`
}

function packetText(packet: ChapterPacket): string {
  return [
    packet.purpose,
    ...packet.scenes.flatMap(scene => [scene.description, scene.goal, scene.outcome, scene.consequence]),
    ...packet.establishedFacts.map(fact => `${fact.factStatus}: ${fact.fact}`),
    ...packet.characterStateChanges.flatMap(change => [change.location, change.emotionalState, ...change.knows, ...change.doesNotKnow]),
  ].join("\n")
}

function consistencyRewriteGoals(findings: readonly PlanStateConsistencyGroup["findings"][number][]): string[] {
  return [
    ...new Set(findings.map(finding => finding.missingForNextLevel)),
    "Keep the repair upstream in the chapter/scene plan before relying on prose retries.",
  ]
}

function consistencyGroupExcerpt(findings: readonly PlanStateConsistencyGroup["findings"][number][]): string {
  return findings.map(finding => finding.rationale).join(" | ")
}

function emptySourceIds(): SourceIds {
  return {
    obligationIds: [],
    characterIds: [],
    worldFactIds: [],
    sceneTurnIds: [],
    threadIds: [],
    promiseIds: [],
    payoffIds: [],
    sourceIds: [],
  }
}

function severityRank(severity: Severity): number {
  return severity === "high" ? 4 : severity === "medium" ? 3 : severity === "low" ? 2 : 1
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

async function closeDb(): Promise<void> {
  const { default: db } = await import("../../src/db/connection")
  await db.end().catch(() => {})
}

async function main(): Promise<number> {
  let args: PlanStateConsistencyArgs
  try {
    args = parseArgs()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/plan-state-consistency-report.ts --novel <novelId> [--output-dir <dir>] [--live|--dry-run] [--import-readiness]")
    return 2
  }

  try {
    if (args.live) await initNovelRun(args.novelId)
    const { report, aggregate } = await buildPlanStateConsistencyReport({
      novelId: args.novelId,
      outlines: await loadPlanStateConsistencyOutlines(args.novelId),
      live: args.live,
    })
    const rendered = renderPlanStateConsistencyReport(report)
    const renderedReadiness = renderPlanStateConsistencyReadinessAggregate(aggregate)
    if (args.outputDirPath) {
      writePlanStateConsistencyArtifacts({ report, aggregate, outputDirPath: args.outputDirPath })
    }
    console.log(rendered)
    console.log(renderedReadiness)
    if (args.importReadiness) {
      const { importPlanReadinessAggregateForNovel } = await import("../../src/harness/plan-readiness-import")
      const imported = await importPlanReadinessAggregateForNovel({
        novelId: args.novelId,
        aggregate,
        importedByKind: "script",
        importedByRef: "plan-state-consistency-report",
        refreshStaleness: true,
        replaceExistingImport: true,
      })
      console.log(`imported ${imported.inserted} readiness items, updated ${imported.updated}, stale-replaced ${imported.staleReplaced}, skipped ${imported.skipped.length}`)
    }
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.stack : String(err))
    return 1
  } finally {
    await closeDb()
  }
}

if (import.meta.main) {
  process.exit(await main())
}
