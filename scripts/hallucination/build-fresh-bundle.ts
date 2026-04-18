/**
 * Build fresh-pipeline bundle for hallucination-checker training.
 * Mines beats generated after the fresh-novel launch timestamp.
 * Tagged by writer (v4 LoRA vs DeepSeek) for balance.
 *
 * Output: 10 batches of ~80 beats each → /tmp/halluc-fresh-batch-{0..9}.json
 */
import db from "../../src/db/connection"

const START_TS = 1776477948  // halluc-fresh-start-ts
const PER_WRITER = 400
const BATCHES = 10

interface BeatSample {
  id: number
  writer: "v4" | "ds"
  novel_id: string
  chapter: number
  beat_index: number
  genre: string
  prose: string
  brief: { summary: string; kind: string; pov: string; setting: string; characters: string[] }
  world_bible_excerpt: { setting: string; locations: Array<{ name: string }>; cultures: Array<{ name: string }>; world_systems: Array<{ name: string }> }
  speakers: Record<string, { speechPattern: string; goals: string; avoids: string; traits: string[] }>
}

async function fetchByWriter(writer: "v4" | "ds", limit: number, idStart: number): Promise<BeatSample[]> {
  const modelFilter = writer === "v4" ? "%salvatore-1988-v4%" : "deepseek-chat"
  // Pick ONE beat-writer call per (novel, chapter, beat) — the first (lowest attempt) for cleanliness
  const beats = writer === "v4"
    ? await (db as any)`
        SELECT DISTINCT ON (lc.novel_id, lc.chapter, lc.beat_index)
          lc.novel_id, lc.chapter, lc.beat_index, lc.response_content as prose,
          n.seed_json->>'genre' as genre
        FROM public.llm_calls lc
        JOIN public.novels n ON n.id = lc.novel_id
        WHERE lc.agent = 'beat-writer'
          AND lc.beat_index IS NOT NULL
          AND lc.timestamp >= to_timestamp(${START_TS})
          AND length(lc.response_content) > 300
          AND lc.response_content NOT LIKE 'ERROR%'
          AND lc.model LIKE ${modelFilter}
        ORDER BY lc.novel_id, lc.chapter, lc.beat_index, lc.timestamp
        LIMIT ${limit}
      `
    : await (db as any)`
        SELECT DISTINCT ON (lc.novel_id, lc.chapter, lc.beat_index)
          lc.novel_id, lc.chapter, lc.beat_index, lc.response_content as prose,
          n.seed_json->>'genre' as genre
        FROM public.llm_calls lc
        JOIN public.novels n ON n.id = lc.novel_id
        WHERE lc.agent = 'beat-writer'
          AND lc.beat_index IS NOT NULL
          AND lc.timestamp >= to_timestamp(${START_TS})
          AND length(lc.response_content) > 300
          AND lc.response_content NOT LIKE 'ERROR%'
          AND lc.model = ${modelFilter}
        ORDER BY lc.novel_id, lc.chapter, lc.beat_index, lc.timestamp
        LIMIT ${limit}
      `

  const out: BeatSample[] = []
  let id = idStart
  for (const b of beats) {
    try {
      const outlineRows = await (db as any)`
        SELECT outline_json FROM public.chapter_outlines
        WHERE novel_id = ${b.novel_id} AND chapter_number = ${b.chapter} LIMIT 1`
      if (!outlineRows.length) continue
      const outline = typeof outlineRows[0].outline_json === "string"
        ? JSON.parse(outlineRows[0].outline_json) : outlineRows[0].outline_json
      const beat = outline.scenes?.[b.beat_index]
      if (!beat) continue

      const wbRows = await (db as any)`
        SELECT content_json FROM public.world_bibles WHERE novel_id = ${b.novel_id} LIMIT 1`
      if (!wbRows.length) continue
      const wb = typeof wbRows[0].content_json === "string" ? JSON.parse(wbRows[0].content_json) : wbRows[0].content_json

      const charRows = await (db as any)`
        SELECT profile_json FROM public.characters WHERE novel_id = ${b.novel_id}`
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
        writer,
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
    } catch { /* skip */ }
  }
  return out
}

async function main() {
  console.log(`Mining fresh beats since ${new Date(START_TS * 1000).toISOString()}...`)
  const [v4, ds] = await Promise.all([
    fetchByWriter("v4", PER_WRITER, 0),
    fetchByWriter("ds", PER_WRITER, 100000),
  ])
  console.log(`  v4: ${v4.length} beats, ds: ${ds.length} beats`)

  const all = [...v4, ...ds]
  all.forEach((s, i) => s.id = i)
  console.log(`Total: ${all.length} beats`)

  const perBatch = Math.ceil(all.length / BATCHES)
  for (let i = 0; i < BATCHES; i++) {
    const slice = all.slice(i * perBatch, (i + 1) * perBatch)
    await Bun.write(`/tmp/halluc-fresh-batch-${i}.json`, JSON.stringify(slice, null, 2))
  }

  const stats = {
    total: all.length,
    v4: all.filter(s => s.writer === "v4").length,
    ds: all.filter(s => s.writer === "ds").length,
    novels: new Set(all.map(s => s.novel_id)).size,
    genres: [...new Set(all.map(s => s.genre))].slice(0, 10),
    avg_prose_chars: Math.round(all.reduce((s, b) => s + b.prose.length, 0) / all.length),
  }
  await Bun.write("/tmp/halluc-fresh-bundle-stats.json", JSON.stringify(stats, null, 2))
  console.log("Stats:", stats)
  console.log(`Wrote ${BATCHES} batches of ~${perBatch} beats`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
