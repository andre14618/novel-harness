#!/usr/bin/env bun
/**
 * Read-only diagnostic for planner semantic allocation quality.
 *
 * This is deliberately not a runtime gate. It exposes whether a chapter plan
 * is writer-ready before spending drafting tokens: beat budget, endpoint
 * overlap, character materiality, beat story-turn readiness, and obligation
 * coverage.
 */

import { chapterOutlineSchema, type ChapterOutline } from "../../src/agents/planning-plotter/schema"
import { assessBeatCountForTarget } from "../../src/harness/beat-counts"
import { validateBeatObligationCoverage } from "../../src/harness/beat-obligations"

export interface PlannerQualityOutlineRow {
  chapter_number: number
  outline_json: unknown
}

export type PlannerQualityFlag =
  | "over_planned_beats"
  | "under_planned_beats"
  | "endpoint_not_declared"
  | "endpoint_low_overlap"
  | "character_not_visible_in_beat_text"
  | "weak_story_turn_beat"
  | "obligation_coverage_error"
  | "overloaded_obligations"

export interface PlannerQualityCharacterMateriality {
  character: string
  listedInBeats: number
  mentionedInBeatText: number
  visible: boolean
}

export interface PlannerQualityEndpoint {
  declared: string | null
  finalBeat: string | null
  overlapRatio: number | null
  missingTokens: string[]
}

export interface PlannerQualityChapter {
  chapter: number
  title: string
  targetWords: number | null
  plannedBeats: number
  recommendedBeats: number | null
  beatDeltaFromRecommended: number | null
  purpose: string
  endpoint: PlannerQualityEndpoint
  characters: PlannerQualityCharacterMateriality[]
  weakStoryTurnBeats: Array<{ beat: number; kind: string; description: string }>
  obligationHealth: {
    valid: boolean
    errors: string[]
    warnings: string[]
    overloadedBeats: number
    missingSourceIds: number
    orphanFacts: number
    orphanKnowledgeChanges: number
    orphanStateChanges: number
  }
  flags: PlannerQualityFlag[]
}

export interface PlannerQualityReport {
  novelId: string | null
  chapters: PlannerQualityChapter[]
  totals: {
    chapters: number
    plannedBeats: number
    overPlannedChapters: number
    underPlannedChapters: number
    endpointIssues: number
    inactiveCharacterFindings: number
    weakStoryTurnBeats: number
    obligationErrorChapters: number
    overloadedObligationChapters: number
  }
}

interface Args {
  novelId: string | null
  json: boolean
}

const ENDPOINT_PATTERNS = [
  /\bchapter ends with\s+(.+?)(?:\.|$)/i,
  /\bends with\s+(.+?)(?:\.|$)/i,
  /\bending with\s+(.+?)(?:\.|$)/i,
  /\bends by\s+(.+?)(?:\.|$)/i,
]

const STOPWORDS = new Set([
  "about", "after", "again", "against", "also", "because", "before", "being",
  "between", "chapter", "could", "from", "have", "into", "that", "their",
  "them", "then", "there", "this", "through", "with", "will", "would",
  "while", "where", "which", "what", "when", "reader", "hooking",
])

const STORY_TURN_TERMS = [
  "accept", "admit", "break", "choose", "corner", "confront", "decide",
  "demand", "discover", "escape", "expose", "fail", "flee", "force",
  "kill", "learn", "prove", "realize", "refuse", "reveal", "risk",
  "sacrifice", "threaten", "warn",
]

export function buildPlannerQualityReport(
  rows: readonly PlannerQualityOutlineRow[],
  novelId: string | null = null,
): PlannerQualityReport {
  const chapters = rows
    .map(rowToChapter)
    .filter((chapter): chapter is PlannerQualityChapter => chapter !== null)
    .sort((a, b) => a.chapter - b.chapter)

  return {
    novelId,
    chapters,
    totals: {
      chapters: chapters.length,
      plannedBeats: chapters.reduce((sum, chapter) => sum + chapter.plannedBeats, 0),
      overPlannedChapters: chapters.filter(chapter => chapter.flags.includes("over_planned_beats")).length,
      underPlannedChapters: chapters.filter(chapter => chapter.flags.includes("under_planned_beats")).length,
      endpointIssues: chapters.filter(chapter =>
        chapter.flags.includes("endpoint_not_declared") ||
        chapter.flags.includes("endpoint_low_overlap")
      ).length,
      inactiveCharacterFindings: chapters.reduce(
        (sum, chapter) => sum + chapter.characters.filter(character => !character.visible).length,
        0,
      ),
      weakStoryTurnBeats: chapters.reduce((sum, chapter) => sum + chapter.weakStoryTurnBeats.length, 0),
      obligationErrorChapters: chapters.filter(chapter => chapter.flags.includes("obligation_coverage_error")).length,
      overloadedObligationChapters: chapters.filter(chapter => chapter.flags.includes("overloaded_obligations")).length,
    },
  }
}

function rowToChapter(row: PlannerQualityOutlineRow): PlannerQualityChapter | null {
  const parsed = chapterOutlineSchema.safeParse(row.outline_json)
  if (!parsed.success) return null
  const outline = parsed.data
  const targetWords = positiveNumber(outline.targetWords) ? Number(outline.targetWords) : null
  const plannedBeats = outline.scenes.length
  const beatAssessment = targetWords === null ? null : assessBeatCountForTarget(targetWords, plannedBeats)
  const endpoint = endpointAssessment(outline)
  const characters = characterMateriality(outline)
  const weakStoryTurnBeats = storyTurnWeaknesses(outline)
  const coverage = validateBeatObligationCoverage(outline)

  const flags: PlannerQualityFlag[] = []
  if (beatAssessment?.overPlanned) flags.push("over_planned_beats")
  if (beatAssessment?.underPlanned) flags.push("under_planned_beats")
  if (!endpoint.declared) flags.push("endpoint_not_declared")
  else if ((endpoint.overlapRatio ?? 0) < 0.45) flags.push("endpoint_low_overlap")
  if (characters.some(character => !character.visible)) flags.push("character_not_visible_in_beat_text")
  if (weakStoryTurnBeats.length > 0) flags.push("weak_story_turn_beat")
  if (!coverage.valid) flags.push("obligation_coverage_error")
  if (coverage.summary.overloadedBeats > 0) flags.push("overloaded_obligations")

  return {
    chapter: Number(outline.chapterNumber ?? row.chapter_number),
    title: outline.title,
    targetWords,
    plannedBeats,
    recommendedBeats: beatAssessment?.recommendedBeats ?? null,
    beatDeltaFromRecommended: beatAssessment?.beatDeltaFromRecommended ?? null,
    purpose: outline.purpose,
    endpoint,
    characters,
    weakStoryTurnBeats,
    obligationHealth: {
      valid: coverage.valid,
      errors: coverage.errors,
      warnings: coverage.warnings,
      overloadedBeats: coverage.summary.overloadedBeats,
      missingSourceIds: coverage.summary.missingSourceIds,
      orphanFacts: coverage.summary.orphanFacts,
      orphanKnowledgeChanges: coverage.summary.orphanKnowledgeChanges,
      orphanStateChanges: coverage.summary.orphanStateChanges,
    },
    flags,
  }
}

function endpointAssessment(outline: ChapterOutline): PlannerQualityEndpoint {
  const declared = extractEndpoint(outline.purpose)
  const finalBeat = outline.scenes.at(-1)?.description ?? null
  if (!declared || !finalBeat) {
    return {
      declared,
      finalBeat,
      overlapRatio: declared ? 0 : null,
      missingTokens: declared ? contentTokens(declared) : [],
    }
  }
  const declaredTokens = unique(contentTokens(declared))
  const finalTokens = new Set(contentTokens(finalBeat))
  const matched = declaredTokens.filter(token => finalTokens.has(token))
  return {
    declared,
    finalBeat,
    overlapRatio: declaredTokens.length > 0 ? matched.length / declaredTokens.length : null,
    missingTokens: declaredTokens.filter(token => !finalTokens.has(token)),
  }
}

function characterMateriality(outline: ChapterOutline): PlannerQualityCharacterMateriality[] {
  const beats = outline.scenes ?? []
  const pov = normalizeName(outline.povCharacter)
  return unique(outline.charactersPresent ?? []).map(character => {
    const name = normalizeName(character)
    const listedInBeats = beats.filter(beat =>
      (beat.characters ?? []).some(beatCharacter => normalizeName(beatCharacter) === name)
    ).length
    const mentionedInBeatText = beats.filter(beat => textMentionsCharacter(beat.description, character)).length
    return {
      character,
      listedInBeats,
      mentionedInBeatText,
      // POV characters can drive a chapter through close interiority even when
      // the name is not repeated in every beat. Non-POV characters need text
      // visibility to be considered materially present by this deterministic pass.
      visible: name === pov ? listedInBeats > 0 || mentionedInBeatText > 0 : mentionedInBeatText > 0,
    }
  })
}

function storyTurnWeaknesses(outline: ChapterOutline): Array<{ beat: number; kind: string; description: string }> {
  return outline.scenes.flatMap((beat, index) => {
    const desc = beat.description ?? ""
    const tokens = contentTokens(desc)
    if (tokens.length < 6) return [{ beat: index + 1, kind: beat.kind, description: desc }]
    const hasTurnTerm = STORY_TURN_TERMS.some(term => tokens.includes(term))
    const hasPressurePunctuation = /[;:—-]/.test(desc)
    const hasMultipleClauses = /\bbut\b|\bwhen\b|\bwhile\b|\bforcing\b|\bso\b/i.test(desc)
    if (hasTurnTerm || hasPressurePunctuation || hasMultipleClauses) return []
    return [{ beat: index + 1, kind: beat.kind, description: desc }]
  })
}

function extractEndpoint(purpose: string): string | null {
  for (const pattern of ENDPOINT_PATTERNS) {
    const match = purpose.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

function textMentionsCharacter(text: string, character: string): boolean {
  const textTokens = new Set(contentTokens(text))
  const nameTokens = contentTokens(character)
  return nameTokens.some(token => textTokens.has(token))
}

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 3 && !STOPWORDS.has(token))
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

export function renderPlannerQualityReport(report: PlannerQualityReport): string {
  const lines: string[] = []
  lines.push(`Planner quality report${report.novelId ? ` for ${report.novelId}` : ""}`)
  lines.push(
    `Chapters=${report.totals.chapters}; beats=${report.totals.plannedBeats}; ` +
      `overPlanned=${report.totals.overPlannedChapters}; underPlanned=${report.totals.underPlannedChapters}; ` +
      `endpointIssues=${report.totals.endpointIssues}; inactiveCharacters=${report.totals.inactiveCharacterFindings}; ` +
      `weakStoryTurns=${report.totals.weakStoryTurnBeats}; obligationErrors=${report.totals.obligationErrorChapters}; ` +
      `overloadedObligations=${report.totals.overloadedObligationChapters}`,
  )
  if (report.chapters.length === 0) {
    lines.push("No chapter outlines found.")
    return lines.join("\n")
  }

  for (const chapter of report.chapters) {
    lines.push("")
    lines.push(
      `ch${chapter.chapter} "${chapter.title}": target=${chapter.targetWords ?? "?"}, ` +
        `beats=${chapter.plannedBeats} (rec=${chapter.recommendedBeats ?? "?"}, ` +
        `delta=${chapter.beatDeltaFromRecommended ?? "?"}), flags=${chapter.flags.join(",") || "none"}`,
    )
    if (chapter.endpoint.declared) {
      lines.push(
        `  endpoint overlap=${formatNullable(chapter.endpoint.overlapRatio, 2)}; ` +
          `declared=${chapter.endpoint.declared}`,
      )
      if (chapter.endpoint.missingTokens.length > 0) {
        lines.push(`  endpoint missing tokens=${chapter.endpoint.missingTokens.slice(0, 8).join(",")}`)
      }
    } else {
      lines.push("  endpoint not declared in purpose")
    }
    const inactive = chapter.characters.filter(character => !character.visible)
    if (inactive.length > 0) {
      lines.push(
        `  inactive listed characters=${inactive.map(character =>
          `${character.character}(beatRefs=${character.listedInBeats}, textRefs=${character.mentionedInBeatText})`
        ).join("; ")}`,
      )
    }
    if (chapter.weakStoryTurnBeats.length > 0) {
      lines.push(
        `  weak story-turn beats=${chapter.weakStoryTurnBeats.map(beat =>
          `${beat.beat}:${beat.kind}`
        ).join(",")}`,
      )
    }
    if (!chapter.obligationHealth.valid) {
      lines.push(`  obligation errors=${chapter.obligationHealth.errors.slice(0, 3).join("; ")}`)
    }
  }
  return lines.join("\n")
}

function formatNullable(value: number | null, digits: number): string {
  return value === null ? "?" : value.toFixed(digits)
}

function parseArgs(argv: string[]): Args {
  let novelId: string | null = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      const value = argv[++i]
      if (!value) throw new Error("--novel requires a value")
      novelId = value
    } else if (arg === "--json") {
      json = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return { novelId, json }
}

async function loadRows(novelId: string): Promise<PlannerQualityOutlineRow[]> {
  const { default: db } = await import("../../src/db/connection")
  const rows = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  ` as PlannerQualityOutlineRow[]
  await db.end().catch(() => {})
  return rows
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/planner-quality-report.ts --novel <novelId> [--json]")
    return 2
  }
  if (!args.novelId) {
    console.error("usage: bun scripts/analysis/planner-quality-report.ts --novel <novelId> [--json]")
    return 2
  }
  const report = buildPlannerQualityReport(await loadRows(args.novelId), args.novelId)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderPlannerQualityReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
