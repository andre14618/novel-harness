import { getDB } from "./connection"
import type { Fact } from "../types"

export function saveFact(novelId: string, fact: Omit<Fact, "id">): void {
  const id = crypto.randomUUID()
  getDB().prepare("INSERT INTO facts (id, novel_id, fact, category, established_in_chapter) VALUES (?, ?, ?, ?, ?)").run(id, novelId, fact.fact, fact.category, fact.establishedInChapter)
}

export function getFactsUpToChapter(novelId: string, chapterNum: number): Fact[] {
  const rows = getDB().prepare("SELECT id, fact, category, established_in_chapter FROM facts WHERE novel_id = ? AND established_in_chapter <= ? ORDER BY established_in_chapter").all(novelId, chapterNum) as any[]
  return rows.map(r => ({ id: r.id, fact: r.fact, category: r.category, establishedInChapter: r.established_in_chapter }))
}

export function getFactsForChapter(novelId: string, chapterNum: number): Fact[] {
  const rows = getDB().prepare("SELECT id, fact, category, established_in_chapter FROM facts WHERE novel_id = ? AND established_in_chapter = ? ORDER BY created_at").all(novelId, chapterNum) as any[]
  return rows.map(r => ({ id: r.id, fact: r.fact, category: r.category, establishedInChapter: r.established_in_chapter }))
}

export function clearFactsForChapter(novelId: string, chapterNum: number): void {
  getDB().prepare("DELETE FROM facts WHERE novel_id = ? AND established_in_chapter = ?").run(novelId, chapterNum)
}
