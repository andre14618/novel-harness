/**
 * Pure plan-vs-state diff. Detects contradictions between a planner's
 * proposed chapter outline and the accumulated character state from
 * prior chapters. No DB calls — caller pre-loads state.
 *
 * First-cut detections:
 *   - knowledge_regression: planner marks doesNotKnow something the
 *     character previously knew.
 *   - redundant_learning: knowledgeChanges entry for something the
 *     character already knew before this chapter.
 *
 * Topic strings are matched after lowercase + punctuation strip + whitespace
 * collapse. Real fuzzy/embedding match is a future layer; this catches the
 * obvious cases without LLM cost.
 */

import type { ChapterOutline } from "./agents/planning-plotter/schema"

export interface PriorCharacterState {
  characterName: string
  chapterNumber: number
  knows: string[]
  doesNotKnow: string[]
}

export type ConflictType = "knowledge_regression" | "redundant_learning"

export interface DiffConflict {
  type: ConflictType
  characterName: string
  topic: string
  detail: string
  priorChapter: number
}

export interface DiffResult {
  ok: boolean
  conflicts: DiffConflict[]
}

export function diffPlanAgainstState(
  outline: ChapterOutline,
  priorStates: PriorCharacterState[],
): DiffResult {
  const conflicts: DiffConflict[] = []
  const byName = indexLatestByName(priorStates)

  for (const change of outline.characterStateChanges) {
    const prior = byName.get(normalizeName(change.name))
    if (!prior) continue

    const priorKnows = new Set(prior.knows.map(normalizeTopic))
    for (const unknown of change.doesNotKnow) {
      const norm = normalizeTopic(unknown)
      if (priorKnows.has(norm)) {
        conflicts.push({
          type: "knowledge_regression",
          characterName: change.name,
          topic: unknown,
          detail: `${change.name} previously knew "${unknown}" (chapter ${prior.chapterNumber}) but the plan marks it as unknown`,
          priorChapter: prior.chapterNumber,
        })
      }
    }
  }

  for (const learn of outline.knowledgeChanges) {
    const prior = byName.get(normalizeName(learn.characterName))
    if (!prior) continue
    const priorKnows = new Set(prior.knows.map(normalizeTopic))
    if (priorKnows.has(normalizeTopic(learn.knowledge))) {
      conflicts.push({
        type: "redundant_learning",
        characterName: learn.characterName,
        topic: learn.knowledge,
        detail: `${learn.characterName} already knew "${learn.knowledge}" as of chapter ${prior.chapterNumber}`,
        priorChapter: prior.chapterNumber,
      })
    }
  }

  return { ok: conflicts.length === 0, conflicts }
}

function indexLatestByName(states: PriorCharacterState[]): Map<string, PriorCharacterState> {
  const out = new Map<string, PriorCharacterState>()
  for (const s of states) {
    const key = normalizeName(s.characterName)
    const existing = out.get(key)
    if (!existing || s.chapterNumber > existing.chapterNumber) {
      out.set(key, s)
    }
  }
  return out
}

function normalizeTopic(s: string): string {
  return s.toLowerCase().trim().replace(/[^\w\s]/g, "").replace(/\s+/g, " ")
}

function normalizeName(s: string): string {
  return s.toLowerCase().trim()
}
