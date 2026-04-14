import db from "./connection"

export interface TimelineEvent {
  id?: string
  chapterNumber: number
  event: string
  location: string
  participants: string[]
  witnesses: string[]
  consequences: string
}

export async function saveTimelineEvent(novelId: string, te: TimelineEvent): Promise<string> {
  if (te.id) {
    await db`INSERT INTO timeline_events (id, novel_id, chapter_number, event, location, participants_json, witnesses_json, consequences)
             VALUES (${te.id}::uuid, ${novelId}, ${te.chapterNumber}, ${te.event}, ${te.location},
                     ${te.participants}, ${te.witnesses}, ${te.consequences})
             ON CONFLICT (id) DO UPDATE SET
               event = EXCLUDED.event, location = EXCLUDED.location,
               participants_json = EXCLUDED.participants_json, witnesses_json = EXCLUDED.witnesses_json,
               consequences = EXCLUDED.consequences`
    return te.id
  }
  const rows = await db`INSERT INTO timeline_events (novel_id, chapter_number, event, location, participants_json, witnesses_json, consequences)
                        VALUES (${novelId}, ${te.chapterNumber}, ${te.event}, ${te.location},
                                ${te.participants}, ${te.witnesses}, ${te.consequences})
                        RETURNING id`
  return rows[0].id
}

export async function getTimelineEventsUpToChapter(novelId: string, chapterNum: number): Promise<TimelineEvent[]> {
  const rows = await db`SELECT * FROM timeline_events WHERE novel_id = ${novelId} AND chapter_number < ${chapterNum} ORDER BY chapter_number ASC, created_at ASC`
  return rows.map(mapRow)
}

export async function getTimelineEventsForChapter(novelId: string, chapterNum: number): Promise<TimelineEvent[]> {
  const rows = await db`SELECT * FROM timeline_events WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum} ORDER BY created_at ASC`
  return rows.map(mapRow)
}

export async function getRecentEventsForCharacters(novelId: string, chapterNum: number, characterNames: string[], limit: number = 20): Promise<TimelineEvent[]> {
  // Use Postgres array overlap for efficient character matching
  const namesLower = characterNames.map(n => n.toLowerCase())
  const allEvents = await getTimelineEventsUpToChapter(novelId, chapterNum)
  const names = new Set(namesLower)
  return allEvents
    .filter(e => e.participants.some(p => names.has(p.toLowerCase())) || e.witnesses.some(w => names.has(w.toLowerCase())))
    .slice(-limit)
}

export async function getEventsAtLocation(novelId: string, location: string, chapterNum: number): Promise<TimelineEvent[]> {
  const allEvents = await getTimelineEventsUpToChapter(novelId, chapterNum)
  const loc = location.toLowerCase()
  return allEvents.filter(e => e.location.toLowerCase().includes(loc) || loc.includes(e.location.toLowerCase()))
}

export async function clearTimelineEventsForChapter(novelId: string, chapterNum: number): Promise<void> {
  await db`DELETE FROM timeline_events WHERE novel_id = ${novelId} AND chapter_number = ${chapterNum}`
}

function mapRow(r: any): TimelineEvent {
  return {
    id: r.id, chapterNumber: r.chapter_number, event: r.event,
    location: r.location, participants: r.participants_json as string[],
    witnesses: r.witnesses_json as string[], consequences: r.consequences,
  }
}
