/**
 * Sample solo-ungrounded fires for precision estimation.
 *
 * A "solo-ungrounded" fire is a beat attempt where halluc-ungrounded.pass === false
 * AND halluc-leak-salvatore.has_leak === false AND adherence-events didn't fire.
 * These are the cleanest candidates for precision estimation: if the ungrounded call
 * flags an entity with no other signal, is the flag correct?
 *
 * Output is one JSON blob per sample with:
 *   - novel_id, chapter, beat_index, attempt
 *   - beat brief (beat description / characters / kind)
 *   - world-bible snippet (names the adapter saw)
 *   - prose (what the writer produced on this attempt)
 *   - halluc-ungrounded response (issues: [{entity, excerpt}, ...])
 *
 * Write to scripts/hallucination/solo-ungrounded-samples.jsonl.
 */

import db from "../../src/db/connection.ts"
import { writeFileSync } from "node:fs"

const CLEAN_NOVELS = [
  "novel-1776627411728",
  "novel-1776614270831",
  "novel-1776612087459",
  "novel-1776611156855",
  "novel-1776609267761",
  "novel-1776608819617",
  "novel-1776608639218",
]

const N_SAMPLES = 20

async function main() {
  // Pull ALL solo-ungrounded beat attempts in a single sweep.
  // Using the scripts/halluc-v3-fire-rate logic: solo = hu fired, hl didn't, adh didn't.
  // Easier: pull all checker rows + filter in-process.

  const rows = await db`
    SELECT novel_id, chapter, beat_index, attempt, agent, response_content, failed,
           user_prompt
    FROM llm_calls
    WHERE novel_id IN ${db(CLEAN_NOVELS)}
      AND agent IN ('beat-writer', 'adherence-events', 'halluc-ungrounded', 'halluc-leak-salvatore')
    ORDER BY novel_id, chapter, beat_index, attempt, agent
  `

  type Beat = {
    novel_id: string
    chapter: number
    beat_index: number
    attempt: number
    bw?: any
    adh?: any
    hu?: any
    hl?: any
  }
  const beats = new Map<string, Beat>()

  for (const r of rows as any[]) {
    if (r.beat_index === null || r.beat_index === undefined) continue
    const key = `${r.novel_id}|${r.chapter}|${r.beat_index}|${r.attempt ?? 1}`
    let b = beats.get(key)
    if (!b) {
      b = {
        novel_id: r.novel_id,
        chapter: r.chapter,
        beat_index: r.beat_index,
        attempt: r.attempt ?? 1,
      }
      beats.set(key, b)
    }
    if (r.agent === "beat-writer") b.bw = r
    else if (r.agent === "adherence-events") b.adh = r
    else if (r.agent === "halluc-ungrounded") b.hu = r
    else if (r.agent === "halluc-leak-salvatore") b.hl = r
  }

  const solos: Beat[] = []
  for (const b of beats.values()) {
    if (!b.bw || !b.hu) continue
    let hu: any = null
    try { hu = JSON.parse(b.hu.response_content) } catch { continue }
    if (hu?.pass !== false) continue

    let hl: any = null
    if (b.hl && !b.hl.failed) {
      try { hl = JSON.parse(b.hl.response_content) } catch { }
    }
    if (hl?.has_leak === true) continue // not solo

    let adh: any = null
    if (b.adh && !b.adh.failed) {
      try { adh = JSON.parse(b.adh.response_content) } catch { }
    }
    if (adh?.events_present === false) continue // not solo

    solos.push(b)
  }

  console.log(`Found ${solos.length} solo-ungrounded beat attempts across ${CLEAN_NOVELS.length} novels.`)

  // Evenly sample across novels
  const byNovel = new Map<string, Beat[]>()
  for (const b of solos) {
    const arr = byNovel.get(b.novel_id) ?? []
    arr.push(b)
    byNovel.set(b.novel_id, arr)
  }
  const sampled: Beat[] = []
  const perNovelTarget = Math.ceil(N_SAMPLES / byNovel.size)
  for (const arr of byNovel.values()) {
    const shuffled = arr.sort(() => Math.random() - 0.5)
    for (const b of shuffled.slice(0, perNovelTarget)) {
      if (sampled.length < N_SAMPLES) sampled.push(b)
    }
  }

  const outLines: string[] = []
  for (const b of sampled) {
    const huParsed = JSON.parse(b.hu.response_content)
    const bwPrompt: string = b.bw.user_prompt ?? ""

    // Extract beat brief section from bw user_prompt (it's the primary instruction)
    // The writer prompt has "BEAT:\n..." or similar
    const briefMatch = bwPrompt.match(/BEAT[^\n]*\n+([\s\S]{0,1500}?)(?:\n---|\nWRITE NOW|\nCONTEXT|$)/i)
    const brief = briefMatch ? briefMatch[1].trim().slice(0, 1500) : bwPrompt.slice(0, 1500)

    // Pull prose from beat-writer response
    const prose: string = b.bw.response_content ?? ""

    // Pull halluc-ungrounded user_prompt (has the world-bible block the adapter actually saw)
    const huUserPrompt: string = b.hu.user_prompt ?? ""

    outLines.push(JSON.stringify({
      novel_id: b.novel_id,
      chapter: b.chapter,
      beat_index: b.beat_index,
      attempt: b.attempt,
      flagged_issues: huParsed.issues ?? [],
      beat_brief_excerpt: brief,
      prose: prose.slice(0, 3000),
      halluc_ungrounded_user_prompt: huUserPrompt.slice(0, 4000),
    }))
  }

  const outPath = "scripts/hallucination/solo-ungrounded-samples.jsonl"
  writeFileSync(outPath, outLines.join("\n") + "\n")
  console.log(`Wrote ${sampled.length} samples to ${outPath}`)
  console.log(`Per-novel distribution:`)
  const dist = new Map<string, number>()
  for (const b of sampled) dist.set(b.novel_id, (dist.get(b.novel_id) ?? 0) + 1)
  for (const [k, v] of dist) console.log(`  ${k}: ${v}`)

  process.exit(0)
}

main()
