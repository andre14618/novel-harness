/**
 * Phase 1 — gather ~15 beats for Sonnet-label prototype.
 *
 * For each beat: prose (from llm_calls), beat brief (from chapter_outline),
 * world bible, and per-character snapshots. Package into a single JSON
 * bundle that one Sonnet subagent can label.
 *
 * Output: /tmp/hallucination-prototype-bundle.json
 */
import db from "../../src/db/connection"
import { getWorldBible, getCharacters, getChapterOutline } from "../../src/db"

const PROTOTYPE_NOVELS = [
  "novel-1776427754298",  // cultivation-fantasy (fresh, post-planner-fix)
  "novel-1776427633981",  // epic-fantasy (fresh)
  "novel-1776395458961",  // dark fantasy (v3-sweep era — likely has hallucinations)
]

interface BeatSample {
  id: number
  novel_id: string
  chapter: number
  beat_index: number
  genre: string
  prose: string
  brief: {
    summary: string
    kind: string
    pov: string
    setting: string
    characters: string[]
  }
  world_bible: {
    setting: string
    time_period: string
    locations: Array<{ name: string; description: string }>
    cultures: Array<{ name: string; description: string; values: string[] }>
    world_systems: Array<{ name: string; description: string }>
    rules: string[]
  }
  character_profiles: Record<string, any>
}

async function main() {
  const samples: BeatSample[] = []
  let id = 0

  for (const novelId of PROTOTYPE_NOVELS) {
    const novel = await (db as any)`SELECT seed_json FROM novels WHERE id = ${novelId}`
    const seed = typeof novel[0].seed_json === "string" ? JSON.parse(novel[0].seed_json) : novel[0].seed_json
    const genre = seed.genre ?? "unknown"

    const wb = await getWorldBible(novelId)
    const allChars = await getCharacters(novelId)
    const charByName: Record<string, any> = {}
    for (const c of allChars as any[]) charByName[c.name] = c

    // Pull 5 beat-writer responses spread across chapters
    const beats = await (db as any)`
      SELECT chapter, beat_index, response_content
      FROM llm_calls
      WHERE novel_id = ${novelId} AND agent = 'beat-writer'
        AND beat_index IS NOT NULL AND response_content IS NOT NULL
        AND length(response_content) > 300
      ORDER BY random()
      LIMIT 5
    `

    for (const b of beats) {
      let outline: any
      try { outline = await getChapterOutline(novelId, b.chapter) } catch { continue }
      const beat = outline.scenes?.[b.beat_index]
      if (!beat) continue

      const speakers = (beat.characters ?? []).map((n: string) => n)
      const charProfiles: Record<string, any> = {}
      for (const name of speakers) {
        if (charByName[name]) {
          const c = charByName[name]
          charProfiles[name] = {
            role: c.role,
            speechPattern: c.speechPattern,
            traits: c.traits,
            goals: c.goals,
            avoids: c.avoids,
            internalConflict: c.internalConflict,
          }
        }
      }

      samples.push({
        id: id++,
        novel_id: novelId,
        chapter: b.chapter,
        beat_index: b.beat_index,
        genre,
        prose: b.response_content,
        brief: {
          summary: beat.description ?? "",
          kind: beat.kind ?? "action",
          pov: outline.povCharacter ?? "",
          setting: outline.setting ?? "",
          characters: speakers,
        },
        world_bible: {
          setting: wb.setting,
          time_period: wb.timePeriod,
          locations: (wb.locations ?? []).map((l: any) => ({ name: l.name, description: l.description })),
          cultures: (wb.cultures ?? []).map((c: any) => ({ name: c.name, description: c.description, values: c.values })),
          world_systems: (wb.systems ?? []).map((s: any) => ({ name: s.name, description: s.description })),
          rules: wb.rules ?? [],
        },
        character_profiles: charProfiles,
      })
    }
  }

  const outPath = "/tmp/hallucination-prototype-bundle.json"
  await Bun.write(outPath, JSON.stringify(samples, null, 2))
  console.log(`Bundle: ${samples.length} beats across ${PROTOTYPE_NOVELS.length} novels`)
  for (const s of samples.slice(0, 3)) {
    console.log(`  [${s.id}] ${s.novel_id} ch${s.chapter} beat${s.beat_index} (${s.brief.kind}, ${s.brief.characters.length} speakers)`)
  }
  console.log(`Wrote → ${outPath}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
