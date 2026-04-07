/**
 * Pure plan-vs-state diff. Detects contradictions between a planner's
 * proposed chapter outline and the accumulated character state from
 * prior chapters. No DB calls — caller pre-loads state.
 *
 * The planner emits per-chapter deltas (only what meaningfully changed
 * this chapter), not cumulative snapshots. So accumulation is the union
 * of all prior knows[] across every prior chapter, keyed per character.
 * Doing latest-only would miss contradictions against topics established
 * in earlier chapters that weren't repeated in the most recent state.
 *
 * Detections:
 *   - knowledge_regression: planner marks doesNotKnow something the
 *     character previously knew (in any prior chapter).
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

interface AccumulatedKnowledge {
  // normalized topic → { original display string, earliest chapter learned }
  knows: Map<string, { topic: string; chapter: number }>
}

export function diffPlanAgainstState(
  outline: ChapterOutline,
  priorStates: PriorCharacterState[],
): DiffResult {
  const conflicts: DiffConflict[] = []
  const byName = accumulateByName(priorStates)

  for (const change of outline.characterStateChanges) {
    const prior = byName.get(normalizeName(change.name))
    if (!prior) continue

    for (const unknown of change.doesNotKnow) {
      const norm = normalizeTopic(unknown)
      const learned = prior.knows.get(norm)
      if (learned) {
        conflicts.push({
          type: "knowledge_regression",
          characterName: change.name,
          topic: unknown,
          detail: `${change.name} previously knew "${learned.topic}" (chapter ${learned.chapter}) but the plan marks it as unknown`,
          priorChapter: learned.chapter,
        })
      }
    }
  }

  for (const learn of outline.knowledgeChanges) {
    const prior = byName.get(normalizeName(learn.characterName))
    if (!prior) continue
    const learned = prior.knows.get(normalizeTopic(learn.knowledge))
    if (learned) {
      conflicts.push({
        type: "redundant_learning",
        characterName: learn.characterName,
        topic: learn.knowledge,
        detail: `${learn.characterName} already knew "${learned.topic}" as of chapter ${learned.chapter}`,
        priorChapter: learned.chapter,
      })
    }
  }

  return { ok: conflicts.length === 0, conflicts }
}

function accumulateByName(states: PriorCharacterState[]): Map<string, AccumulatedKnowledge> {
  // Process in chapter order so the earliest chapter wins for each topic.
  const sorted = [...states].sort((a, b) => a.chapterNumber - b.chapterNumber)
  const out = new Map<string, AccumulatedKnowledge>()
  for (const s of sorted) {
    const key = normalizeName(s.characterName)
    let acc = out.get(key)
    if (!acc) {
      acc = { knows: new Map() }
      out.set(key, acc)
    }
    for (const topic of s.knows) {
      const norm = normalizeTopic(topic)
      if (!acc.knows.has(norm)) {
        acc.knows.set(norm, { topic, chapter: s.chapterNumber })
      }
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
