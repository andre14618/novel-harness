/**
 * Phase 2 — gather 500 beats for Sonnet labeling. Mix current-pipeline
 * (~250) and archive (~250, v3-sweep era — known hallucination-rich).
 *
 * For each beat: prose, brief, world bible excerpt, speaker profiles.
 * Output: 10 batches of ~50 beats each → /tmp/halluc-batch-{0..9}.json
 */
import db from "../../src/db/connection"

const TARGET_TOTAL = 500
const BATCHES = 10

interface BeatSample {
  id: number
  source: "public" | "archive"
  novel_id: string
  chapter: number
  beat_index: number
  genre: string
  prose: string
  brief: { summary: string; kind: string; pov: string; setting: string; characters: string[] }
  world_bible_excerpt: { setting: string; locations: Array<{ name: string }>; cultures: Array<{ name: string }>; world_systems: Array<{ name: string }> }
  speakers: Record<string, { speechPattern: string; goals: string; avoids: string; traits: string[] }>
}

async function fetchPublic(limit: number, idStart: number): Promise<BeatSample[]> {
  const beats = await (db as any)`
    SELECT lc.novel_id, lc.chapter, lc.beat_index, lc.response_content as prose,
           n.seed_json->>'genre' as genre
    FROM public.llm_calls lc
    JOIN public.novels n ON n.id = lc.novel_id
    WHERE lc.agent = 'beat-writer'
      AND lc.beat_index IS NOT NULL
      AND length(lc.response_content) > 300
      AND lc.response_content NOT LIKE 'ERROR%'
    ORDER BY random()
    LIMIT ${limit}
  `
  return enrichBeats(beats, idStart, "public")
}

async function fetchArchive(limit: number, idStart: number): Promise<BeatSample[]> {
  const beats = await (db as any)`
    SELECT lc.novel_id, lc.chapter, lc.beat_index, lc.response_content as prose,
           n.seed_json->>'genre' as genre
    FROM archive.llm_calls lc
    JOIN archive.novels n ON n.id = lc.novel_id
    WHERE lc.agent = 'beat-writer'
      AND lc.beat_index IS NOT NULL
      AND length(lc.response_content) > 300
      AND lc.response_content NOT LIKE 'ERROR%'
    ORDER BY random()
    LIMIT ${limit}
  `
  return enrichBeats(beats, idStart, "archive")
}

async function enrichBeats(beats: any[], idStart: number, source: "public" | "archive"): Promise<BeatSample[]> {
  const out: BeatSample[] = []
  let id = idStart
  let skipOutline = 0, skipBeat = 0, skipWb = 0, errored = 0
  console.log(`  enrichBeats ${source}: ${beats.length} input`)
  for (const b of beats) {
    try {
      const outlineRows = source === "public"
        ? await (db as any)`SELECT outline_json FROM public.chapter_outlines WHERE novel_id = ${b.novel_id} AND chapter_number = ${b.chapter} LIMIT 1`
        : await (db as any)`SELECT outline_json FROM archive.chapter_outlines WHERE novel_id = ${b.novel_id} AND chapter_number = ${b.chapter} LIMIT 1`
      if (!outlineRows.length) { skipOutline++; continue }
      const outline = typeof outlineRows[0].outline_json === "string"
        ? JSON.parse(outlineRows[0].outline_json)
        : outlineRows[0].outline_json
      const beat = outline.scenes?.[b.beat_index]
      if (!beat) { skipBeat++; continue }

      const wbRows = source === "public"
        ? await (db as any)`SELECT content_json FROM public.world_bibles WHERE novel_id = ${b.novel_id} LIMIT 1`
        : await (db as any)`SELECT content_json FROM archive.world_bibles WHERE novel_id = ${b.novel_id} LIMIT 1`
      if (!wbRows.length) { skipWb++; continue }
      const wb = typeof wbRows[0].content_json === "string" ? JSON.parse(wbRows[0].content_json) : wbRows[0].content_json

      const charRows = source === "public"
        ? await (db as any)`SELECT profile_json FROM public.characters WHERE novel_id = ${b.novel_id}`
        : await (db as any)`SELECT profile_json FROM archive.characters WHERE novel_id = ${b.novel_id}`
      const charByName: Record<string, any> = {}
      for (const r of charRows) {
        const p = typeof r.profile_json === "string" ? JSON.parse(r.profile_json) : r.profile_json
        if (p?.name) charByName[p.name] = p
      }

      const speakers: Record<string, any> = {}
      for (const name of (beat.characters ?? [])) {
        const c = charByName[name]
        if (c) speakers[name] = {
          speechPattern: c.speechPattern ?? "",
          goals: c.goals ?? "",
          avoids: c.avoids ?? "",
          traits: c.traits ?? [],
        }
      }

      out.push({
        id: id++,
        source,
        novel_id: b.novel_id,
        chapter: b.chapter,
        beat_index: b.beat_index,
        genre: b.genre ?? "?",
        prose: b.prose,
        brief: {
          summary: beat.description ?? "",
          kind: beat.kind ?? "",
          pov: outline.povCharacter ?? "",
          setting: outline.setting ?? "",
          characters: beat.characters ?? [],
        },
        world_bible_excerpt: {
          setting: wb.setting ?? "",
          locations: (wb.locations ?? []).map((l: any) => ({ name: l.name })),
          cultures: (wb.cultures ?? []).map((c: any) => ({ name: c.name })),
          world_systems: (wb.systems ?? []).map((s: any) => ({ name: s.name })),
        },
        speakers,
      })
    } catch (e) {
      errored++
      if (errored <= 2) console.log(`    err: ${(e as Error).message}`)
    }
  }
  console.log(`  enrichBeats ${source}: ${out.length} kept; skip outline=${skipOutline}, beat=${skipBeat}, wb=${skipWb}, err=${errored}`)
  return out
}

async function main() {
  const halfTarget = Math.ceil(TARGET_TOTAL / 2)
  // Pull ~1.5x targets to allow for skips
  console.log(`Fetching ${halfTarget * 1.5} from public + ${halfTarget * 1.5} from archive...`)
  const [current, archive] = await Promise.all([
    fetchPublic(Math.ceil(halfTarget * 1.5), 0),
    fetchArchive(Math.ceil(halfTarget * 1.5), 100000),
  ])
  console.log(`  collected ${current.length} current + ${archive.length} archive`)

  const all = [...current.slice(0, halfTarget), ...archive.slice(0, halfTarget)]
  // Reassign sequential ids
  all.forEach((s, i) => s.id = i)
  console.log(`Total: ${all.length} beats`)

  const perBatch = Math.ceil(all.length / BATCHES)
  for (let i = 0; i < BATCHES; i++) {
    const slice = all.slice(i * perBatch, (i + 1) * perBatch)
    await Bun.write(`/tmp/halluc-batch-${i}.json`, JSON.stringify(slice, null, 2))
  }

  const stats = {
    total: all.length,
    current: all.filter(s => s.source === "public").length,
    archive: all.filter(s => s.source === "archive").length,
    novels: new Set(all.map(s => s.novel_id)).size,
    genres: [...new Set(all.map(s => s.genre))].slice(0, 10),
    avg_prose_chars: Math.round(all.reduce((s, b) => s + b.prose.length, 0) / all.length),
  }
  await Bun.write("/tmp/halluc-bundle-stats.json", JSON.stringify(stats, null, 2))
  console.log("Stats:", stats)
  console.log(`Wrote ${BATCHES} batches of ~${perBatch} beats to /tmp/halluc-batch-N.json`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
