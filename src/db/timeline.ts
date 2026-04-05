import { getDB } from "./connection"
import { randomUUID } from "crypto"

export interface TimelineEvent {
  id?: string
  chapterNumber: number
  event: string
  location: string
  participants: string[]
  witnesses: string[]
  consequences: string
}

export function saveTimelineEvent(novelId: string, te: TimelineEvent): void {
  const id = te.id || randomUUID()
  getDB().prepare(
    `INSERT OR REPLACE INTO timeline_events (id, novel_id, chapter_number, event, location, participants_json, witnesses_json, consequences)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, novelId, te.chapterNumber, te.event, te.location, JSON.stringify(te.participants), JSON.stringify(te.witnesses), te.consequences)
}

/** Get all timeline events up to (not including) a given chapter */
export function getTimelineEventsUpToChapter(novelId: string, chapterNum: number): TimelineEvent[] {
  const rows = getDB().prepare(
    "SELECT * FROM timeline_events WHERE novel_id = ? AND chapter_number < ? ORDER BY chapter_number ASC"
  ).all(novelId, chapterNum) as any[]
  return rows.map(mapRow)
}

/** Get timeline events for a specific chapter */
export function getTimelineEventsForChapter(novelId: string, chapterNum: number): TimelineEvent[] {
  const rows = getDB().prepare(
    "SELECT * FROM timeline_events WHERE novel_id = ? AND chapter_number = ? ORDER BY rowid ASC"
  ).all(novelId, chapterNum) as any[]
  return rows.map(mapRow)
}

/** Get recent timeline events involving specific characters */
export function getRecentEventsForCharacters(novelId: string, chapterNum: number, characterNames: string[], limit: number = 20): TimelineEvent[] {
  const allEvents = getTimelineEventsUpToChapter(novelId, chapterNum)
  const names = new Set(characterNames.map(n => n.toLowerCase()))
  return allEvents
    .filter(e => e.participants.some(p => names.has(p.toLowerCase())) || e.witnesses.some(w => names.has(w.toLowerCase())))
    .slice(-limit)
}

/** Get timeline events at a specific location */
export function getEventsAtLocation(novelId: string, location: string, chapterNum: number): TimelineEvent[] {
  const allEvents = getTimelineEventsUpToChapter(novelId, chapterNum)
  const loc = location.toLowerCase()
  return allEvents.filter(e => e.location.toLowerCase().includes(loc) || loc.includes(e.location.toLowerCase()))
}

export function clearTimelineEventsForChapter(novelId: string, chapterNum: number): void {
  getDB().prepare("DELETE FROM timeline_events WHERE novel_id = ? AND chapter_number = ?").run(novelId, chapterNum)
}

function mapRow(r: any): TimelineEvent {
  return {
    id: r.id, chapterNumber: r.chapter_number, event: r.event,
    location: r.location, participants: JSON.parse(r.participants_json),
    witnesses: JSON.parse(r.witnesses_json), consequences: r.consequences,
  }
}
