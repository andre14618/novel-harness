#!/usr/bin/env bun
/**
 * Deterministic authoring-bible selector/context audit.
 *
 * Reads planned scenes and reports which authoring-bible rules would enter the
 * production writer context. No LLM calls; no source mutation.
 */

import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { resolveAuthoringBiblePackIds } from "../../src/config/pipeline"
import db from "../../src/db/connection"
import {
  buildAuthoringBiblePacket,
  renderAuthoringBiblePromptSections,
  selectAuthoringBibleSlice,
  summarizeAuthoringBibleSlice,
  type AuthoringBibleRule,
  type AuthoringBibleRuleKind,
  type AuthoringBibleRuleSelection,
} from "../../src/harness/authoring-bible"
import type { ChapterOutline, CharacterProfile, SceneBeat, SeedInput, StorySpine, WorldBible } from "../../src/types"

export interface Args {
  novelId: string
  chapters: number[] | null
  outputDir: string | null
  packIds: string[]
  maxRulesWarning: number
  json: boolean
}

type NameMatchStatus = "exact" | "honorific" | "primary_token" | "missing"
type AuditSeverity = "error" | "warning"

export interface NameMatchEvidence {
  value: string
  status: NameMatchStatus
  matchedSceneName?: string
  token?: string
}

export interface SelectorAuditFinding {
  severity: AuditSeverity
  chapterNumber: number
  sceneIndex: number
  sceneId: string
  ruleId?: string
  kind?: AuthoringBibleRuleKind
  code: string
  message: string
}

export interface SelectorAuditRuleRow {
  ruleId: string
  kind: AuthoringBibleRuleKind
  title: string
  reason: string
  matchedHints: string[]
  characterMatch?: NameMatchEvidence
  relatedCharacterMatch?: NameMatchEvidence
}

export interface SelectorAuditSceneRow {
  chapterNumber: number
  sceneIndex: number
  sceneId: string
  sceneNames: string[]
  selectedRuleCount: number
  selectedRules: SelectorAuditRuleRow[]
  stablePreludeRuleIds: string[]
  sceneSliceRuleIds: string[]
  stablePreludeHash: string | null
  findings: SelectorAuditFinding[]
}

export interface SelectorAuditReport {
  v: "authoring-bible-selector-audit-v1"
  generatedAt: string
  novelId: string
  packIds: string[]
  chapters: number[] | null
  maxRulesWarning: number
  packetCounts: Record<AuthoringBibleRuleKind, number>
  totals: {
    chapters: number
    scenes: number
    scenesWithSlice: number
    selectedRules: number
    maxSelectedRules: number
    avgSelectedRules: number
    errors: number
    warnings: number
    stablePreludeHashes: Record<string, number>
    selectedByKind: Record<AuthoringBibleRuleKind, number>
    selectedByReason: Record<string, number>
  }
  scenes: SelectorAuditSceneRow[]
  findings: SelectorAuditFinding[]
}

const stablePreludeReasons = new Set(["always_scene_pressure", "always_sensory_palette", "baseline_voice"])

export async function buildSelectorAuditReport(args: Args, generatedAt = new Date().toISOString()): Promise<SelectorAuditReport> {
  const novel = await loadNovelArtifacts(args.novelId)
  const outlines = await loadChapterOutlines(args.novelId, args.chapters)
  const packIds = args.packIds.length > 0
    ? args.packIds
    : resolveAuthoringBiblePackIds(novel.seed.pipelineOverrides)
  const packet = buildAuthoringBiblePacket({
    genre: novel.seed.genre,
    worldBible: novel.worldBible,
    storySpine: novel.storySpine,
    characters: novel.characters,
    packIds,
  })
  const scenes: SelectorAuditSceneRow[] = []
  for (const outline of outlines) {
    for (let sceneIndex = 0; sceneIndex < outline.scenes.length; sceneIndex++) {
      const scene = outline.scenes[sceneIndex]!
      const slice = selectAuthoringBibleSlice({ packet, outline, scene, sceneIndex })
      if (!slice) {
        const sceneId = scene.sceneId ?? scene.beatId ?? `ch${outline.chapterNumber}-scene${sceneIndex + 1}`
        scenes.push({
          chapterNumber: outline.chapterNumber,
          sceneIndex,
          sceneId,
          sceneNames: sceneNamesFor(outline, scene),
          selectedRuleCount: 0,
          selectedRules: [],
          stablePreludeRuleIds: [],
          sceneSliceRuleIds: [],
          stablePreludeHash: null,
          findings: [{
            severity: "warning",
            chapterNumber: outline.chapterNumber,
            sceneIndex,
            sceneId,
            code: "NO_AUTHORING_BIBLE_SLICE",
            message: "No authoring-bible rules selected for this scene.",
          }],
        })
        continue
      }
      scenes.push(auditScene({
        outline,
        scene,
        sceneIndex,
        rules: rulesFromSlice(slice),
        selections: slice.ruleSelections,
        stablePreludeRuleIds: renderAuthoringBiblePromptSections(slice).stablePreludeRuleIds,
        sceneSliceRuleIds: renderAuthoringBiblePromptSections(slice).sceneSliceRuleIds,
        stablePrelude: renderAuthoringBiblePromptSections(slice).stablePrelude,
        maxRulesWarning: args.maxRulesWarning,
      }))
    }
  }
  const findings = scenes.flatMap(scene => scene.findings)
  const selectedRules = scenes.reduce((sum, scene) => sum + scene.selectedRuleCount, 0)
  return {
    v: "authoring-bible-selector-audit-v1",
    generatedAt,
    novelId: args.novelId,
    packIds: packet.packIds,
    chapters: args.chapters,
    maxRulesWarning: args.maxRulesWarning,
    packetCounts: {
      story: packet.storyRules.length,
      world: packet.worldRules.length,
      character: packet.characterRules.length,
      relationship: packet.relationshipRules.length,
      voice: packet.voiceRules.length,
    },
    totals: {
      chapters: outlines.length,
      scenes: scenes.length,
      scenesWithSlice: scenes.filter(scene => scene.selectedRuleCount > 0).length,
      selectedRules,
      maxSelectedRules: Math.max(0, ...scenes.map(scene => scene.selectedRuleCount)),
      avgSelectedRules: scenes.length > 0 ? selectedRules / scenes.length : 0,
      errors: findings.filter(finding => finding.severity === "error").length,
      warnings: findings.filter(finding => finding.severity === "warning").length,
      stablePreludeHashes: countBy(scenes.flatMap(scene => scene.stablePreludeHash ? [scene.stablePreludeHash] : [])),
      selectedByKind: countByKind(scenes.flatMap(scene => scene.selectedRules.map(rule => rule.kind))),
      selectedByReason: countBy(scenes.flatMap(scene => scene.selectedRules.map(rule => rule.reason))),
    },
    scenes,
    findings,
  }
}

export function auditScene(args: {
  outline: ChapterOutline
  scene: SceneBeat
  sceneIndex: number
  rules: AuthoringBibleRule[]
  selections: AuthoringBibleRuleSelection[]
  stablePreludeRuleIds: string[]
  sceneSliceRuleIds: string[]
  stablePrelude: string | null
  maxRulesWarning: number
}): SelectorAuditSceneRow {
  const sceneId = args.scene.sceneId ?? args.scene.beatId ?? `ch${args.outline.chapterNumber}-scene${args.sceneIndex + 1}`
  const names = sceneNamesFor(args.outline, args.scene)
  const selectionById = new Map(args.selections.map(selection => [selection.ruleId, selection]))
  const rulesById = new Map(args.rules.map(rule => [rule.id, rule]))
  const findings: SelectorAuditFinding[] = []
  const stableIds = new Set(args.stablePreludeRuleIds)
  const sceneIds = new Set(args.sceneSliceRuleIds)
  const selectedRules = args.rules.map(rule => {
    const selection = selectionById.get(rule.id)
    const row: SelectorAuditRuleRow = {
      ruleId: rule.id,
      kind: rule.kind,
      title: rule.title,
      reason: selection?.reason ?? "selected",
      matchedHints: selection?.matchedHints ?? [],
    }
    if (rule.kind === "character") {
      row.characterMatch = matchNameForScene(rule.characterName, names)
      inspectNameMatch({ row, match: row.characterMatch, findings, sceneId, chapterNumber: args.outline.chapterNumber, sceneIndex: args.sceneIndex, rule, role: "character" })
    }
    if (rule.kind === "relationship") {
      row.characterMatch = matchNameForScene(rule.characterName, names)
      row.relatedCharacterMatch = matchNameForScene(rule.relatedCharacterName, names)
      inspectNameMatch({ row, match: row.characterMatch, findings, sceneId, chapterNumber: args.outline.chapterNumber, sceneIndex: args.sceneIndex, rule, role: "relationship-character" })
      inspectNameMatch({ row, match: row.relatedCharacterMatch, findings, sceneId, chapterNumber: args.outline.chapterNumber, sceneIndex: args.sceneIndex, rule, role: "relationship-related" })
    }
    if (rule.kind === "world" && row.reason === "world_title_terms") {
      findings.push({
        severity: "warning",
        chapterNumber: args.outline.chapterNumber,
        sceneIndex: args.sceneIndex,
        sceneId,
        ruleId: rule.id,
        kind: rule.kind,
        code: "WORLD_TITLE_TERM_SELECTION",
        message: "World rule selected by title terms rather than explicit selection hints; inspect for possible overinclude.",
      })
    }
    return row
  })

  for (const ruleId of args.stablePreludeRuleIds) {
    const rule = rulesById.get(ruleId)
    const selection = selectionById.get(ruleId)
    if (!rule || !selection) continue
    if (rule.kind === "character" || rule.kind === "relationship") {
      findings.push({
        severity: "error",
        chapterNumber: args.outline.chapterNumber,
        sceneIndex: args.sceneIndex,
        sceneId,
        ruleId,
        kind: rule.kind,
        code: "SCENE_LOCAL_RULE_IN_STABLE_PREFIX",
        message: "Character/relationship rule appeared in the cache-stable prelude.",
      })
    }
    if (!stablePreludeReasons.has(selection.reason)) {
      findings.push({
        severity: "error",
        chapterNumber: args.outline.chapterNumber,
        sceneIndex: args.sceneIndex,
        sceneId,
        ruleId,
        kind: rule.kind,
        code: "UNSTABLE_REASON_IN_STABLE_PREFIX",
        message: `Rule with selector reason '${selection.reason}' appeared in the cache-stable prelude.`,
      })
    }
  }
  for (const ruleId of args.stablePreludeRuleIds) {
    if (sceneIds.has(ruleId)) {
      const rule = rulesById.get(ruleId)
      findings.push({
        severity: "error",
        chapterNumber: args.outline.chapterNumber,
        sceneIndex: args.sceneIndex,
        sceneId,
        ruleId,
        kind: rule?.kind,
        code: "RULE_DUPLICATED_ACROSS_PREFIX_AND_SCENE_SLICE",
        message: "Rule appeared in both stable prelude and scene-local slice.",
      })
    }
  }
  if (args.rules.length > args.maxRulesWarning) {
    findings.push({
      severity: "warning",
      chapterNumber: args.outline.chapterNumber,
      sceneIndex: args.sceneIndex,
      sceneId,
      code: "HIGH_RULE_COUNT",
      message: `Scene selected ${args.rules.length} rules; inspect for context overinclude.`,
    })
  }

  return {
    chapterNumber: args.outline.chapterNumber,
    sceneIndex: args.sceneIndex,
    sceneId,
    sceneNames: names,
    selectedRuleCount: args.rules.length,
    selectedRules,
    stablePreludeRuleIds: args.stablePreludeRuleIds,
    sceneSliceRuleIds: args.sceneSliceRuleIds,
    stablePreludeHash: args.stablePrelude ? shortHash(args.stablePrelude) : null,
    findings,
  }
}

function inspectNameMatch(args: {
  row: SelectorAuditRuleRow
  match: NameMatchEvidence | undefined
  findings: SelectorAuditFinding[]
  sceneId: string
  chapterNumber: number
  sceneIndex: number
  rule: AuthoringBibleRule
  role: string
}): void {
  if (!args.match || args.match.status === "missing") {
    args.findings.push({
      severity: "error",
      chapterNumber: args.chapterNumber,
      sceneIndex: args.sceneIndex,
      sceneId: args.sceneId,
      ruleId: args.rule.id,
      kind: args.rule.kind,
      code: "NAME_MATCH_MISSING",
      message: `${args.role} name '${args.match?.value ?? ""}' did not match POV/present scene names.`,
    })
    return
  }
  if (args.match.status === "primary_token") {
    args.findings.push({
      severity: "warning",
      chapterNumber: args.chapterNumber,
      sceneIndex: args.sceneIndex,
      sceneId: args.sceneId,
      ruleId: args.rule.id,
      kind: args.rule.kind,
      code: "PRIMARY_TOKEN_NAME_MATCH",
      message: `${args.role} name '${args.match.value}' matched by primary token '${args.match.token}' against '${args.match.matchedSceneName}'.`,
    })
  }
}

export function matchNameForScene(value: string | undefined | null, sceneNames: readonly string[]): NameMatchEvidence {
  const clean = cleanKey(value)
  const original = value?.trim() ?? ""
  if (!clean) return { value: original, status: "missing" }
  for (const sceneName of sceneNames) {
    if (cleanKey(sceneName) === clean) return { value: original, status: "exact", matchedSceneName: sceneName }
  }
  const operative = stripHonorific(clean)
  if (operative !== clean) {
    for (const sceneName of sceneNames) {
      if (cleanKey(sceneName) === operative) return { value: original, status: "honorific", matchedSceneName: sceneName }
    }
  }
  const token = primaryNameToken(clean)
  if (token) {
    for (const sceneName of sceneNames) {
      const tokens = new Set(cleanKey(sceneName).split(/\s+/u).filter(Boolean))
      if (tokens.has(token)) return { value: original, status: "primary_token", matchedSceneName: sceneName, token }
    }
  }
  return { value: original, status: "missing" }
}

function sceneNamesFor(outline: ChapterOutline, scene: SceneBeat): string[] {
  return uniqueStrings([outline.povCharacter, ...(scene.characters ?? [])])
}

function rulesFromSlice(slice: NonNullable<ReturnType<typeof selectAuthoringBibleSlice>>): AuthoringBibleRule[] {
  const trace = summarizeAuthoringBibleSlice(slice)
  const rules = [
    ...slice.storyRules,
    ...slice.worldRules,
    ...slice.characterRules,
    ...slice.relationshipRules,
    ...slice.voiceRules,
  ]
  const seenIds = new Set<string>()
  for (const rule of rules) seenIds.add(rule.id)
  if (seenIds.size !== trace.counts.rules) {
    throw new Error("authoring-bible slice rule count mismatch")
  }
  return rules
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

function cleanKey(value: string | undefined | null): string {
  return value?.trim().toLowerCase().replace(/\s+/gu, " ") ?? ""
}

function stripHonorific(value: string): string {
  const parts = value.split(/\s+/u).filter(Boolean)
  if (parts.length >= 2 && honorifics.has(parts[0]!)) return parts.slice(1).join(" ")
  return value
}

function primaryNameToken(value: string): string | null {
  const parts = value.split(/\s+/u).filter(part => part.length > 1)
  if (parts.length === 0) return null
  if (honorifics.has(parts[0]!) && parts[1]) return parts[1]!
  return parts[0]!
}

const honorifics = new Set(["lady", "lord", "sir", "dame", "master", "mistress"])

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return out
}

function countByKind(values: readonly AuthoringBibleRuleKind[]): Record<AuthoringBibleRuleKind, number> {
  return {
    story: values.filter(value => value === "story").length,
    world: values.filter(value => value === "world").length,
    character: values.filter(value => value === "character").length,
    relationship: values.filter(value => value === "relationship").length,
    voice: values.filter(value => value === "voice").length,
  }
}

function renderReportMarkdown(report: SelectorAuditReport): string {
  const lines = [
    "# Authoring-Bible Selector Audit",
    "",
    `Novel: ${report.novelId}`,
    `Packs: ${report.packIds.join(", ") || "none"}`,
    `Chapters: ${report.chapters?.join(", ") || "all"}`,
    "",
    "## Totals",
    "",
    `- chapters: ${report.totals.chapters}`,
    `- scenes: ${report.totals.scenes}`,
    `- scenes with slice: ${report.totals.scenesWithSlice}`,
    `- selected rules: ${report.totals.selectedRules}`,
    `- avg selected rules/scene: ${report.totals.avgSelectedRules.toFixed(2)}`,
    `- max selected rules/scene: ${report.totals.maxSelectedRules}`,
    `- errors: ${report.totals.errors}`,
    `- warnings: ${report.totals.warnings}`,
    `- stable prelude hashes: ${Object.entries(report.totals.stablePreludeHashes).map(([hash, count]) => `${hash}=${count}`).join(", ") || "none"}`,
    "",
    "## Selected By Kind",
    "",
    ...Object.entries(report.totals.selectedByKind).map(([kind, count]) => `- ${kind}: ${count}`),
    "",
    "## Selected By Reason",
    "",
    ...Object.entries(report.totals.selectedByReason).sort((a, b) => a[0].localeCompare(b[0])).map(([reason, count]) => `- ${reason}: ${count}`),
  ]
  if (report.findings.length > 0) {
    lines.push("", "## Findings", "")
    for (const finding of report.findings.slice(0, 80)) {
      const rule = finding.ruleId ? ` ${finding.ruleId}` : ""
      lines.push(`- ${finding.severity.toUpperCase()} ch${finding.chapterNumber} scene${finding.sceneIndex + 1}${rule} ${finding.code}: ${finding.message}`)
    }
    if (report.findings.length > 80) lines.push(`- ... ${report.findings.length - 80} more`)
  }
  lines.push("", "## Scene Samples", "")
  for (const scene of report.scenes.slice(0, 12)) {
    lines.push(`- ch${scene.chapterNumber} scene${scene.sceneIndex + 1} ${scene.sceneId}: rules=${scene.selectedRuleCount}, stable=${scene.stablePreludeRuleIds.length}, local=${scene.sceneSliceRuleIds.length}, names=${scene.sceneNames.join(", ")}`)
  }
  return `${lines.join("\n")}\n`
}

async function loadNovelArtifacts(novelId: string): Promise<{
  seed: SeedInput
  worldBible: WorldBible | null
  storySpine: StorySpine | null
  characters: CharacterProfile[]
}> {
  const novelRows = await db`SELECT seed_json FROM novels WHERE id = ${novelId}` as Array<{ seed_json: SeedInput }>
  if (!novelRows.length) throw new Error(`novel not found: ${novelId}`)
  const worldRows = await db`SELECT content_json FROM world_bibles WHERE novel_id = ${novelId}` as Array<{ content_json: WorldBible }>
  const spineRows = await db`SELECT content_json FROM story_spines WHERE novel_id = ${novelId}` as Array<{ content_json: StorySpine }>
  const characterRows = await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} ORDER BY id` as Array<{ profile_json: CharacterProfile }>
  return {
    seed: novelRows[0]!.seed_json,
    worldBible: worldRows[0]?.content_json ?? null,
    storySpine: spineRows[0]?.content_json ?? null,
    characters: characterRows.map(row => row.profile_json),
  }
}

async function loadChapterOutlines(novelId: string, chapterFilter: number[] | null): Promise<ChapterOutline[]> {
  const rows = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number ASC
  ` as Array<{ chapter_number: number; outline_json: ChapterOutline }>
  const filter = chapterFilter && chapterFilter.length > 0 ? new Set(chapterFilter) : null
  return rows.flatMap(row => filter && !filter.has(row.chapter_number) ? [] : [row.outline_json])
}

function parseArgs(argv: string[]): Args {
  let novelId = ""
  let chapters: number[] | null = null
  let outputDir: string | null = null
  let packIds: string[] = []
  let maxRulesWarning = 32
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--novel-id" || arg === "--novel") { novelId = argv[++i] ?? ""; continue }
    if (arg === "--chapters") { chapters = parseChapterList(argv[++i] ?? ""); continue }
    if (arg === "--output-dir") { outputDir = argv[++i] ?? null; continue }
    if (arg === "--pack-id") { packIds = uniqueStrings([...packIds, argv[++i] ?? ""]); continue }
    if (arg === "--pack-ids") { packIds = uniqueStrings([...packIds, ...parseStringList(argv[++i] ?? "")]); continue }
    if (arg === "--max-rules-warning") { maxRulesWarning = positiveInt(argv[++i] ?? "", "--max-rules-warning"); continue }
    if (arg === "--json") { json = true; continue }
    throw new Error(`unknown arg: ${arg}`)
  }
  if (!novelId) throw new Error("--novel-id is required")
  return { novelId, chapters, outputDir, packIds, maxRulesWarning, json }
}

function parseChapterList(raw: string): number[] {
  const out: number[] = []
  for (const part of raw.split(",")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const range = trimmed.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = Number.parseInt(range[1]!, 10)
      const end = Number.parseInt(range[2]!, 10)
      for (let n = start; n <= end; n++) out.push(n)
    } else {
      out.push(Number.parseInt(trimmed, 10))
    }
  }
  return [...new Set(out.filter(Number.isFinite))].sort((a, b) => a - b)
}

function positiveInt(raw: string, name: string): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} requires a positive integer`)
  return parsed
}

function parseStringList(raw: string): string[] {
  return raw.split(",").map(value => value.trim()).filter(Boolean)
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map(value => value?.trim() ?? "").filter(Boolean))]
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const report = await buildSelectorAuditReport(args)
  const outputDir = args.outputDir ?? join("output", "authoring-bible-selector-audit", args.novelId)
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "authoring-bible-selector-audit.json"), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(outputDir, "authoring-bible-selector-audit.md"), renderReportMarkdown(report))
  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      outputDir,
      scenes: report.totals.scenes,
      selectedRules: report.totals.selectedRules,
      errors: report.totals.errors,
      warnings: report.totals.warnings,
      stablePreludeHashes: report.totals.stablePreludeHashes,
    }, null, 2))
  } else {
    console.log(renderReportMarkdown(report))
    console.log(`Artifacts: ${outputDir}`)
  }
  return report.totals.errors > 0 ? 1 : 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(code => process.exit(code)).catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
