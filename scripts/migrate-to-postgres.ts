/**
 * One-time migration: move existing novel data from per-novel SQLite DBs to Postgres.
 *
 * Usage: bun scripts/migrate-to-postgres.ts [--embed] [--novel <id>]
 *
 * --embed: Also generate embeddings for all migrated data (requires OPENROUTER_API_KEY)
 * --novel <id>: Migrate a specific novel only
 */

import { Database } from "bun:sqlite"
import { readdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import db from "../data/connection"
import { migrate } from "../data/connection"
import {
  getEmbeddings,
  buildFactEmbedText, buildEventEmbedText, buildSummaryEmbedText,
  buildCharStateEmbedText, buildRelationshipEmbedText, buildKnowledgeEmbedText,
} from "../src/db/embed"

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "."
const doEmbed = process.argv.includes("--embed")
const novelArg = process.argv.indexOf("--novel")
const specificNovel = novelArg !== -1 ? process.argv[novelArg + 1] : null

async function main() {
  // Ensure Postgres schema is up to date
  await migrate()

  const outputDir = resolve(HARNESS_ROOT, "output")
  if (!existsSync(outputDir)) {
    console.log("No output/ directory found. Nothing to migrate.")
    return
  }

  const novelDirs = specificNovel
    ? [specificNovel]
    : readdirSync(outputDir).filter(d =>
        d.startsWith("novel-") && existsSync(resolve(outputDir, d, "novel.db"))
      )

  console.log(`Found ${novelDirs.length} novel(s) to migrate.`)

  for (const novelDir of novelDirs) {
    const dbPath = resolve(outputDir, novelDir, "novel.db")
    if (!existsSync(dbPath)) {
      console.log(`  Skipping ${novelDir} — no novel.db`)
      continue
    }

    console.log(`\nMigrating: ${novelDir}`)
    const sqlite = new Database(dbPath, { readonly: true })

    try {
      await migrateNovel(sqlite, novelDir)
      if (doEmbed) {
        await embedNovelData(novelDir)
      }
    } catch (err) {
      console.error(`  ERROR migrating ${novelDir}:`, err)
    } finally {
      sqlite.close()
    }
  }

  console.log("\nMigration complete.")
}

async function migrateNovel(sqlite: Database, novelId: string) {
  // Check if already migrated
  const existing = await db`SELECT id FROM novels WHERE id = ${novelId}`
  if (existing.length > 0) {
    console.log(`  Already in Postgres — skipping base data (use --embed to update embeddings)`)
    return
  }

  // 1. Novel metadata
  const novel = sqlite.prepare("SELECT * FROM novels WHERE id = ?").get(novelId) as any
  if (!novel) { console.log("  No novel row found"); return }

  await db`INSERT INTO novels (id, phase, seed_json, current_chapter, total_chapters, created_at)
           VALUES (${novel.id}, ${novel.phase}, ${novel.seed_json}, ${novel.current_chapter}, ${novel.total_chapters}, ${novel.created_at ?? new Date().toISOString()})`

  // 2. World bible
  const wb = sqlite.prepare("SELECT * FROM world_bibles WHERE novel_id = ?").get(novelId) as any
  if (wb) await db`INSERT INTO world_bibles (novel_id, content_json) VALUES (${novelId}, ${wb.content_json})`

  // 3. Characters
  const chars = sqlite.prepare("SELECT * FROM characters WHERE novel_id = ?").all(novelId) as any[]
  for (const c of chars) {
    await db`INSERT INTO characters (id, novel_id, name, profile_json) VALUES (${c.id}, ${novelId}, ${c.name}, ${c.profile_json})`
  }

  // 4. Story spine
  const spine = sqlite.prepare("SELECT * FROM story_spines WHERE novel_id = ?").get(novelId) as any
  if (spine) await db`INSERT INTO story_spines (novel_id, content_json) VALUES (${novelId}, ${spine.content_json})`

  // 5. Chapter outlines
  const outlines = sqlite.prepare("SELECT * FROM chapter_outlines WHERE novel_id = ?").all(novelId) as any[]
  for (const o of outlines) {
    await db`INSERT INTO chapter_outlines (novel_id, chapter_number, outline_json) VALUES (${novelId}, ${o.chapter_number}, ${o.outline_json})`
  }

  // 6. Chapter drafts
  const drafts = sqlite.prepare("SELECT * FROM chapter_drafts WHERE novel_id = ?").all(novelId) as any[]
  for (const d of drafts) {
    await db`INSERT INTO chapter_drafts (novel_id, chapter_number, version, prose, word_count, status) VALUES (${novelId}, ${d.chapter_number}, ${d.version}, ${d.prose}, ${d.word_count}, ${d.status})`
  }

  // 7. Chapter summaries
  const summaries = sqlite.prepare("SELECT * FROM chapter_summaries WHERE novel_id = ?").all(novelId) as any[]
  for (const s of summaries) {
    await db`INSERT INTO chapter_summaries (novel_id, chapter_number, summary, key_events_json, emotional_state, open_threads_json)
             VALUES (${novelId}, ${s.chapter_number}, ${s.summary}, ${s.key_events_json}, ${s.emotional_state ?? ''}, ${s.open_threads_json ?? '[]'})`
  }

  // 8. Facts
  const facts = sqlite.prepare("SELECT * FROM facts WHERE novel_id = ?").all(novelId) as any[]
  for (const f of facts) {
    await db`INSERT INTO facts (id, novel_id, fact, category, established_in_chapter) VALUES (${f.id}::uuid, ${novelId}, ${f.fact}, ${f.category}, ${f.established_in_chapter})`
  }

  // 9. Character states
  const states = sqlite.prepare("SELECT * FROM character_states WHERE novel_id = ?").all(novelId) as any[]
  for (const s of states) {
    await db`INSERT INTO character_states (novel_id, character_id, chapter_number, state_json) VALUES (${novelId}, ${s.character_id}, ${s.chapter_number}, ${s.state_json})`
  }

  // 10. Issues
  const issues = sqlite.prepare("SELECT * FROM issues WHERE novel_id = ?").all(novelId) as any[]
  for (const i of issues) {
    await db`INSERT INTO issues (id, novel_id, severity, description, chapter, conflicts_with, suggested_fix, status)
             VALUES (${i.id}::uuid, ${novelId}, ${i.severity}, ${i.description}, ${i.chapter}, ${i.conflicts_with}, ${i.suggested_fix}, ${i.status})`
  }

  // 11. Validation passes
  const passes = sqlite.prepare("SELECT * FROM validation_passes WHERE novel_id = ?").all(novelId) as any[]
  for (const p of passes) {
    await db`INSERT INTO validation_passes (novel_id, pass_number, chapter_number, status, issues_found) VALUES (${novelId}, ${p.pass_number}, ${p.chapter_number}, ${p.status}, ${p.issues_found})`
  }

  // 12. World systems
  try {
    const systems = sqlite.prepare("SELECT * FROM world_systems WHERE novel_id = ?").all(novelId) as any[]
    for (const s of systems) {
      await db`INSERT INTO world_systems (id, novel_id, name, type, description, rules_json, manifestations_json, vocabulary_json, constraints_json)
               VALUES (${s.id}, ${novelId}, ${s.name}, ${s.type}, ${s.description}, ${s.rules_json}, ${s.manifestations_json}, ${s.vocabulary_json}, ${s.constraints_json})`
    }
  } catch {} // Table may not exist in old DBs

  // 13. Cultures
  try {
    const cultures = sqlite.prepare("SELECT * FROM cultures WHERE novel_id = ?").all(novelId) as any[]
    for (const c of cultures) {
      await db`INSERT INTO cultures (id, novel_id, name, description, values_json, taboos_json, speech_influences, customs_json, system_views_json)
               VALUES (${c.id}, ${novelId}, ${c.name}, ${c.description}, ${c.values_json}, ${c.taboos_json}, ${c.speech_influences}, ${c.customs_json}, ${c.system_views_json})`
    }
  } catch {}

  // 14. Character cultures
  try {
    const cc = sqlite.prepare("SELECT * FROM character_cultures WHERE novel_id = ?").all(novelId) as any[]
    for (const c of cc) {
      await db`INSERT INTO character_cultures (novel_id, character_id, culture_id, relationship) VALUES (${novelId}, ${c.character_id}, ${c.culture_id}, ${c.relationship})`
    }
  } catch {}

  // 15. Character system awareness
  try {
    const csa = sqlite.prepare("SELECT * FROM character_system_awareness WHERE novel_id = ?").all(novelId) as any[]
    for (const c of csa) {
      await db`INSERT INTO character_system_awareness (novel_id, character_id, system_id, awareness_level, perspective, chapter_established)
               VALUES (${novelId}, ${c.character_id}, ${c.system_id}, ${c.awareness_level}, ${c.perspective}, ${c.chapter_established})`
    }
  } catch {}

  // 16. Relationship states
  try {
    const rels = sqlite.prepare("SELECT * FROM relationship_states WHERE novel_id = ?").all(novelId) as any[]
    for (const r of rels) {
      await db`INSERT INTO relationship_states (novel_id, character_a, character_b, chapter_number, trust_level, dynamic, tension, recent_shift)
               VALUES (${novelId}, ${r.character_a}, ${r.character_b}, ${r.chapter_number}, ${r.trust_level}, ${r.dynamic}, ${r.tension}, ${r.recent_shift})`
    }
  } catch {}

  // 17. Timeline events
  try {
    const events = sqlite.prepare("SELECT * FROM timeline_events WHERE novel_id = ?").all(novelId) as any[]
    for (const e of events) {
      await db`INSERT INTO timeline_events (id, novel_id, chapter_number, event, location, participants_json, witnesses_json, consequences)
               VALUES (${e.id}::uuid, ${novelId}, ${e.chapter_number}, ${e.event}, ${e.location}, ${e.participants_json}, ${e.witnesses_json}, ${e.consequences})`
    }
  } catch {}

  // 18. Character knowledge
  try {
    const knowledge = sqlite.prepare("SELECT * FROM character_knowledge WHERE novel_id = ?").all(novelId) as any[]
    for (const k of knowledge) {
      await db`INSERT INTO character_knowledge (id, novel_id, character_id, knowledge, source, chapter_learned, category, is_false)
               VALUES (${k.id}::uuid, ${novelId}, ${k.character_id}, ${k.knowledge}, ${k.source}, ${k.chapter_learned}, ${k.category}, ${k.is_false === 1})`
    }
  } catch {}

  const factCount = facts.length
  const eventCount = sqlite.prepare("SELECT COUNT(*) as c FROM timeline_events WHERE novel_id = ?").get(novelId) as any
  console.log(`  Migrated: ${chars.length} characters, ${outlines.length} outlines, ${drafts.length} drafts, ${factCount} facts, ${eventCount?.c ?? 0} events`)
}

async function embedNovelData(novelId: string) {
  console.log(`  Generating embeddings for ${novelId}...`)

  // Facts
  const facts = await db`SELECT id, fact, category FROM facts WHERE novel_id = ${novelId} AND embedding IS NULL`
  if (facts.length > 0) {
    const texts = facts.map(f => buildFactEmbedText(f.category, f.fact))
    const embeddings = await getEmbeddings(texts)
    for (let i = 0; i < facts.length; i++) {
      const embStr = `[${embeddings[i].join(",")}]`
      await db.unsafe(`UPDATE facts SET embedding = $1 WHERE id = $2`, [embStr, facts[i].id])
    }
    console.log(`    ${facts.length} facts embedded`)
  }

  // Timeline events
  const events = await db`SELECT id, event, location, participants_json, consequences FROM timeline_events WHERE novel_id = ${novelId} AND embedding IS NULL`
  if (events.length > 0) {
    const texts = events.map(e => buildEventEmbedText(e.event, e.location, e.participants_json as string[], e.consequences))
    const embeddings = await getEmbeddings(texts)
    for (let i = 0; i < events.length; i++) {
      const embStr = `[${embeddings[i].join(",")}]`
      await db.unsafe(`UPDATE timeline_events SET embedding = $1 WHERE id = $2`, [embStr, events[i].id])
    }
    console.log(`    ${events.length} events embedded`)
  }

  // Summaries
  const summaries = await db`SELECT novel_id, chapter_number, summary, key_events_json, emotional_state FROM chapter_summaries WHERE novel_id = ${novelId} AND embedding IS NULL`
  if (summaries.length > 0) {
    const texts = summaries.map(s => buildSummaryEmbedText(s.chapter_number, s.summary, s.key_events_json as string[], s.emotional_state))
    const embeddings = await getEmbeddings(texts)
    for (let i = 0; i < summaries.length; i++) {
      const embStr = `[${embeddings[i].join(",")}]`
      await db.unsafe(`UPDATE chapter_summaries SET embedding = $1 WHERE novel_id = $2 AND chapter_number = $3`, [embStr, novelId, summaries[i].chapter_number])
    }
    console.log(`    ${summaries.length} summaries embedded`)
  }

  // Character knowledge
  const knowledge = await db`SELECT id, character_id, knowledge, source, is_false FROM character_knowledge WHERE novel_id = ${novelId} AND embedding IS NULL`
  if (knowledge.length > 0) {
    const chars = await db`SELECT id, name FROM characters WHERE novel_id = ${novelId}`
    const charMap = Object.fromEntries(chars.map(c => [c.id, c.name]))
    const texts = knowledge.map(k => buildKnowledgeEmbedText(charMap[k.character_id] ?? k.character_id, k.source, k.knowledge, k.is_false))
    const embeddings = await getEmbeddings(texts)
    for (let i = 0; i < knowledge.length; i++) {
      const embStr = `[${embeddings[i].join(",")}]`
      await db.unsafe(`UPDATE character_knowledge SET embedding = $1 WHERE id = $2`, [embStr, knowledge[i].id])
    }
    console.log(`    ${knowledge.length} knowledge entries embedded`)
  }

  console.log(`  Embeddings complete for ${novelId}`)
}

main().catch(err => {
  console.error("Migration failed:", err)
  process.exit(1)
})
