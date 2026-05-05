import db from "./connection"
import type { Fact, FactInput, FactRole } from "../types"

export async function saveFact(novelId: string, fact: FactInput): Promise<string> {
  const role: FactRole = fact.role ?? "operational"
  const rows = await db`INSERT INTO facts (novel_id, fact, category, established_in_chapter, role)
                        VALUES (${novelId}, ${fact.fact}, ${fact.category}, ${fact.establishedInChapter}, ${role})
                        RETURNING id`
  return rows[0].id
}

export async function getFactsUpToChapter(novelId: string, chapterNum: number): Promise<Fact[]> {
  const rows = await db`SELECT id, fact, category, established_in_chapter, role FROM facts
                        WHERE novel_id = ${novelId} AND established_in_chapter <= ${chapterNum}
                        ORDER BY established_in_chapter`
  return rows.map(rowToFact)
}

export async function getFactsForChapter(novelId: string, chapterNum: number): Promise<Fact[]> {
  const rows = await db`SELECT id, fact, category, established_in_chapter, role FROM facts
                        WHERE novel_id = ${novelId} AND established_in_chapter = ${chapterNum}
                        ORDER BY created_at`
  return rows.map(rowToFact)
}

export async function clearFactsForChapter(novelId: string, chapterNum: number): Promise<void> {
  await db`DELETE FROM facts WHERE novel_id = ${novelId} AND established_in_chapter = ${chapterNum}`
}

function rowToFact(r: any): Fact {
  return {
    id: r.id,
    fact: r.fact,
    category: r.category,
    establishedInChapter: r.established_in_chapter,
    role: normalizeRole(r.role),
  }
}

function normalizeRole(value: unknown): FactRole {
  if (value === "operational" || value === "reference" || value === "hidden") return value
  return "operational"
}
