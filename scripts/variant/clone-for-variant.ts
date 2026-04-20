/**
 * clone-for-variant.ts — plan-freeze infrastructure for the
 * beat-entity-list charter (docs/charters/beat-entity-list-v1.md §4, §6).
 *
 * Deep-copies every pre-drafting table keyed by `novel_id` from a source
 * novel to a target novel. The target starts at phase="drafting" with
 * current_chapter=1 so the variant run re-drafts from the identical
 * frozen plan. Eliminates planner stochasticity as a confound when
 * comparing V0/V1/V2/V3/V4 on the same seed.
 *
 * Tables copied (per charter §4):
 *   - novels              — seed_json + metadata; phase reset to "drafting"
 *   - world_bibles        — world-bible JSON
 *   - characters          — character profiles
 *   - chapter_outlines    — frozen plans (row per chapter)
 *   - facts               — materialized establishedFacts
 *   - character_states    — materialized characterStateChanges
 *   - character_knowledge — materialized knowledgeChanges
 *   - relationship_states — defensive (no current write-site)
 *   - timeline_events     — defensive (no current write-site)
 *
 * Mirrored write-sites in `src/planned-state.ts` (required by charter
 * gate — any new save* helper added to savePlannedState() must force a
 * clone-script audit):
 *   - facts              ← src/db/facts.ts:4   saveFact
 *   - character_states   ← src/db/character-states.ts:4  saveCharacterState
 *   - character_knowledge ← src/db/knowledge.ts:15  saveCharacterKnowledge
 *
 * Defensive copies cover the two `save*` helpers that exist in
 * `src/db/` but are not currently invoked by `savePlannedState()`:
 *   - relationship_states ← src/db/relationships.ts:13  saveRelationshipState
 *   - timeline_events     ← src/db/timeline.ts:13  saveTimelineEvent
 *
 * Usage:
 *   bun scripts/variant/clone-for-variant.ts \
 *     --source <source-novel-id> \
 *     --target <target-novel-id>
 *
 * The script is idempotent on target-novel creation (errors if target
 * already exists) to prevent silent data mixing across variant runs.
 * Clone happens in a single transaction — either the full frozen plan
 * lands or nothing does.
 */

import { db } from "../../src/db/connection"

interface Args {
  source: string
  target: string
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  let source: string | null = null
  let target: string | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source") source = args[++i] ?? null
    else if (args[i] === "--target") target = args[++i] ?? null
  }
  if (!source || !target) {
    console.error("Usage: bun scripts/variant/clone-for-variant.ts --source <id> --target <id>")
    process.exit(1)
  }
  if (source === target) {
    console.error("--source and --target must differ.")
    process.exit(1)
  }
  return { source, target }
}

async function main() {
  const { source, target } = parseArgs()

  // Pre-flight: target must not exist, source must exist.
  const [{ exists: targetExists } = { exists: false }] = await db`
    SELECT EXISTS (SELECT 1 FROM novels WHERE id = ${target}) AS exists
  ` as any
  if (targetExists) {
    console.error(`Target novel_id ${target} already exists. Refusing to overwrite.`)
    process.exit(1)
  }
  const [{ exists: sourceExists } = { exists: false }] = await db`
    SELECT EXISTS (SELECT 1 FROM novels WHERE id = ${source}) AS exists
  ` as any
  if (!sourceExists) {
    console.error(`Source novel_id ${source} not found.`)
    process.exit(1)
  }

  await db.begin(async (tx: any) => {
    // novels — reset phase to 'drafting' and current_chapter to 1 so
    // the variant run re-drafts from chapter 1 on the frozen plan.
    await tx`
      INSERT INTO novels (id, phase, seed_json, current_chapter, total_chapters, created_at, updated_at)
      SELECT ${target}, 'drafting', seed_json, 1, total_chapters, now(), now()
      FROM novels WHERE id = ${source}
    `

    // world_bibles — straight copy.
    await tx`
      INSERT INTO world_bibles (novel_id, content_json)
      SELECT ${target}, content_json FROM world_bibles WHERE novel_id = ${source}
    `

    // characters — straight copy (id stays the same per-character so
    // references from chapter_outlines / states / knowledge keep
    // resolving).
    await tx`
      INSERT INTO characters (id, novel_id, name, profile_json)
      SELECT id, ${target}, name, profile_json FROM characters WHERE novel_id = ${source}
    `

    // chapter_outlines — the frozen plan, row per chapter.
    await tx`
      INSERT INTO chapter_outlines (novel_id, chapter_number, outline_json)
      SELECT ${target}, chapter_number, outline_json
      FROM chapter_outlines WHERE novel_id = ${source}
    `

    // facts — materialized from planner's establishedFacts by
    // saveFact (src/db/facts.ts:4). New UUIDs; drop embedding/tsv
    // (regenerated on first read path that needs them).
    await tx`
      INSERT INTO facts (novel_id, fact, category, established_in_chapter, created_at)
      SELECT ${target}, fact, category, established_in_chapter, created_at
      FROM facts WHERE novel_id = ${source}
    `

    // character_states — materialized by saveCharacterState
    // (src/db/character-states.ts:4). Composite PK
    // (novel_id, character_id, chapter_number) so target inherits
    // the same per-chapter snapshots.
    await tx`
      INSERT INTO character_states (novel_id, character_id, chapter_number, state_json)
      SELECT ${target}, character_id, chapter_number, state_json
      FROM character_states WHERE novel_id = ${source}
    `

    // character_knowledge — materialized by saveCharacterKnowledge
    // (src/db/knowledge.ts:15). Fresh UUIDs via gen_random_uuid().
    await tx`
      INSERT INTO character_knowledge (
        novel_id, character_id, knowledge, source, chapter_learned,
        category, is_false, source_character_id, source_event_id
      )
      SELECT ${target}, character_id, knowledge, source, chapter_learned,
             category, is_false, source_character_id, source_event_id
      FROM character_knowledge WHERE novel_id = ${source}
    `

    // relationship_states — defensive copy. Not currently written by
    // savePlannedState() (no helper wired in), but pre-copying guards
    // against a future write-site being added without updating this
    // script. Write-site: src/db/relationships.ts:13 saveRelationshipState.
    await tx`
      INSERT INTO relationship_states (
        novel_id, character_a, character_b, chapter_number,
        trust_level, dynamic, tension, recent_shift
      )
      SELECT ${target}, character_a, character_b, chapter_number,
             trust_level, dynamic, tension, recent_shift
      FROM relationship_states WHERE novel_id = ${source}
    `

    // timeline_events — defensive copy. Write-site:
    // src/db/timeline.ts:13 saveTimelineEvent. New UUIDs.
    await tx`
      INSERT INTO timeline_events (
        novel_id, chapter_number, event, location, participants_json,
        witnesses_json, consequences, created_at
      )
      SELECT ${target}, chapter_number, event, location, participants_json,
             witnesses_json, consequences, created_at
      FROM timeline_events WHERE novel_id = ${source}
    `
  })

  // Post-condition audit: verify row counts match per table so a silent
  // transaction-level truncation can't pass through.
  const tables = [
    "world_bibles", "characters", "chapter_outlines", "facts",
    "character_states", "character_knowledge",
    "relationship_states", "timeline_events",
  ] as const
  const mismatches: string[] = []
  for (const t of tables) {
    const [srcRow] = await db.unsafe(`SELECT COUNT(*)::int AS n FROM ${t} WHERE novel_id = $1`, [source]) as any
    const [tgtRow] = await db.unsafe(`SELECT COUNT(*)::int AS n FROM ${t} WHERE novel_id = $1`, [target]) as any
    const src = Number(srcRow?.n ?? 0)
    const tgt = Number(tgtRow?.n ?? 0)
    if (src !== tgt) mismatches.push(`${t}: source=${src} target=${tgt}`)
    else console.log(`  ${t.padEnd(22)} ${src} rows copied`)
  }
  if (mismatches.length > 0) {
    console.error("\n  Row-count mismatch detected:")
    for (const m of mismatches) console.error(`    ${m}`)
    process.exit(1)
  }

  console.log(`\n  Cloned ${source} → ${target} (phase='drafting', current_chapter=1)`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
