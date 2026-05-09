/**
 * clone-for-variant.ts — plan-freeze infrastructure.
 *
 * Two freeze-points supported via --target-phase:
 *
 * 1. drafting (default; original behavior — beat-entity-list charter):
 *    Clone a plan-complete source so a variant re-drafts from the frozen
 *    plan. Target lands at phase="drafting", current_chapter=1.
 *
 * 2. concept-done (added 2026-04-29 for phase-variant-comparison charter):
 *    Clone a concept-complete source so a variant re-plans from a frozen
 *    concept. Target lands at phase="planning", current_chapter=1.
 *    Post-concept tables (chapter_outlines, facts, etc.) are NOT cloned
 *    and are asserted empty on the target.
 *
 * Tables cloned in `drafting` mode:
 *   - novels              — seed_json + metadata; phase='drafting'
 *   - world_bibles        — world-bible JSON
 *   - characters          — character profiles
 *   - story_spines        — concept output needed by resume rehydration
 *   - world_systems, cultures, character_cultures, character_system_awareness
 *                          — concept-side graph used by drafting context
 *   - retrieval_config    — per-novel retrieval tuning row, if present
 *   - chapter_outlines    — frozen plans (row per chapter)
 *   - facts               — materialized establishedFacts
 *   - character_states    — materialized characterStateChanges
 *   - character_knowledge — materialized knowledgeChanges
 *   - relationship_states — defensive (no current write-site)
 *   - timeline_events     — defensive (no current write-site)
 *
 * Tables cloned in `concept-done` mode (concept-side state + per-novel config):
 *   - novels                       (phase='planning' on target)
 *   - world_bibles
 *   - characters
 *   - world_systems                (PRIMARY KEY (novel_id, id))
 *   - cultures                     (PRIMARY KEY (novel_id, id))
 *   - character_cultures           (PRIMARY KEY (novel_id, character_id, culture_id))
 *   - character_system_awareness   (PRIMARY KEY (novel_id, character_id, system_id))
 *   - story_spines                 (PRIMARY KEY novel_id)
 *   - retrieval_config             (PRIMARY KEY novel_id; sql/011)
 *
 * Tables that MUST be absent on `concept-done` target (post-clone audit
 * verifies count=0):
 *   - chapter_outlines, chapter_drafts, chapter_summaries, facts,
 *     character_states, character_knowledge, relationship_states,
 *     timeline_events, issues, validation_passes, chapter_revisions,
 *     chapter_exhaustions, event_causes, knowledge_propagation
 *
 * Note: `thematic_tags` was created in sql/011 but DROPPED in sql/013;
 * intentionally omitted from the audit list.
 *
 * Mirrored write-sites in `src/planned-state.ts`:
 *   - facts              ← src/db/facts.ts:4   saveFact
 *   - character_states   ← src/db/character-states.ts:4  saveCharacterState
 *   - character_knowledge ← src/db/knowledge.ts:15  saveCharacterKnowledge
 *
 * Defensive copies (drafting mode) cover save* helpers in `src/db/` not
 * currently invoked by `savePlannedState()`:
 *   - relationship_states ← src/db/relationships.ts:13  saveRelationshipState
 *   - timeline_events     ← src/db/timeline.ts:13  saveTimelineEvent
 *
 * Usage:
 *   bun scripts/variant/clone-for-variant.ts \
 *     --source <source-novel-id> \
 *     --target <target-novel-id> \
 *     [--target-phase drafting|concept-done]   (default: drafting)
 *     [--fact-role-context-policy legacy|role-aware]
 *
 * The script is idempotent on target-novel creation (errors if target
 * already exists). Clone happens in a single transaction — either the
 * full frozen state lands or nothing does.
 */

import db from "../../src/db/connection"

type TargetPhase = "drafting" | "concept-done"

interface Args {
  source: string
  target: string
  targetPhase: TargetPhase
  factRoleContextPolicy: "legacy" | "role-aware" | null
  writerContextMode: "legacy" | "thread-character-context-v1" | null
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  let source: string | null = null
  let target: string | null = null
  let targetPhase: TargetPhase = "drafting"
  let factRoleContextPolicy: Args["factRoleContextPolicy"] = null
  let writerContextMode: Args["writerContextMode"] = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source") source = args[++i] ?? null
    else if (args[i] === "--target") target = args[++i] ?? null
    else if (args[i] === "--target-phase") {
      const val = args[++i] ?? null
      if (val !== "drafting" && val !== "concept-done") {
        console.error(`--target-phase must be 'drafting' or 'concept-done', got '${val}'`)
        process.exit(1)
      }
      targetPhase = val
    } else if (args[i] === "--fact-role-context-policy") {
      const val = args[++i] ?? null
      if (val !== "legacy" && val !== "role-aware") {
        console.error(`--fact-role-context-policy must be 'legacy' or 'role-aware', got '${val}'`)
        process.exit(1)
      }
      factRoleContextPolicy = val
    } else if (args[i] === "--writer-context-mode") {
      const val = args[++i] ?? null
      if (val !== "legacy" && val !== "thread-character-context-v1") {
        console.error(`--writer-context-mode must be 'legacy' or 'thread-character-context-v1', got '${val}'`)
        process.exit(1)
      }
      writerContextMode = val
    }
  }
  if (!source || !target) {
    console.error(
      "Usage: bun scripts/variant/clone-for-variant.ts \\\n" +
      "         --source <id> --target <id> [--target-phase drafting|concept-done] " +
      "[--fact-role-context-policy legacy|role-aware] " +
      "[--writer-context-mode legacy|thread-character-context-v1]"
    )
    process.exit(1)
  }
  if (source === target) {
    console.error("--source and --target must differ.")
    process.exit(1)
  }
  return { source, target, targetPhase, factRoleContextPolicy, writerContextMode }
}

/** Tables cloned in BOTH modes (concept-side state + per-novel config). */
const COMMON_CLONE_TABLES = [
  "world_bibles",
  "characters",
  "world_systems",
  "cultures",
  "character_cultures",
  "character_system_awareness",
  "story_spines",
  "retrieval_config",
] as const

/** Tables cloned only in drafting mode (post-concept state). */
const DRAFTING_ONLY_CLONE_TABLES = [
  "chapter_outlines",
  "facts",
  "character_states",
  "character_knowledge",
  "relationship_states",
  "timeline_events",
] as const

/** Tables that MUST be absent on a concept-done target. The runner asserts
 *  COUNT(*) = 0 for each after the clone transaction. */
const CONCEPT_DONE_MUST_BE_ABSENT = [
  "chapter_outlines",
  "chapter_drafts",
  "chapter_summaries",
  "facts",
  "character_states",
  "character_knowledge",
  "relationship_states",
  "timeline_events",
  "issues",
  "validation_passes",
  "chapter_revisions",
  "chapter_exhaustions",
  "event_causes",
  "knowledge_propagation",
] as const

async function main() {
  const { source, target, targetPhase, factRoleContextPolicy, writerContextMode } = parseArgs()

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

  // The novels.phase value the target lands in.
  // drafting → 'drafting' (current default behavior).
  // concept-done → 'planning' (concept complete, planning hasn't run).
  const targetNovelPhase = targetPhase === "concept-done" ? "planning" : "drafting"

  await db.begin(async (tx: any) => {
    // novels — set phase per the target-phase flag, current_chapter=1 in
    // both modes (variant run starts from chapter 1).
    await tx`
      INSERT INTO novels (id, phase, seed_json, current_chapter, total_chapters, created_at, updated_at)
      SELECT ${target}, ${targetNovelPhase}, seed_json, 1, total_chapters, now(), now()
      FROM novels WHERE id = ${source}
    `
    if (factRoleContextPolicy) {
      await tx`
        UPDATE novels
        SET seed_json = jsonb_set(
              jsonb_set(
                seed_json,
                '{pipelineOverrides}',
                COALESCE(seed_json->'pipelineOverrides', '{}'::jsonb),
                true
              ),
              '{pipelineOverrides,factRoleContextPolicy}',
              to_jsonb(${factRoleContextPolicy}::text),
              true
            ),
            updated_at = now()
        WHERE id = ${target}
      `
    }
    if (writerContextMode) {
      await tx`
        UPDATE novels
        SET seed_json = jsonb_set(
              jsonb_set(
                seed_json,
                '{pipelineOverrides}',
                COALESCE(seed_json->'pipelineOverrides', '{}'::jsonb),
                true
              ),
              '{pipelineOverrides,writerContextMode}',
              to_jsonb(${writerContextMode}::text),
              true
            ),
            updated_at = now()
        WHERE id = ${target}
      `
    }

    // ─── Common clones (both modes) ───────────────────────────────────

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

    // world_systems — PK (novel_id, id). Per-system metadata.
    await tx`
      INSERT INTO world_systems (
        id, novel_id, name, type, description,
        rules_json, manifestations_json, vocabulary_json, constraints_json
      )
      SELECT id, ${target}, name, type, description,
             rules_json, manifestations_json, vocabulary_json, constraints_json
      FROM world_systems WHERE novel_id = ${source}
    `

    // cultures — PK (novel_id, id).
    await tx`
      INSERT INTO cultures (
        id, novel_id, name, description,
        values_json, taboos_json, speech_influences, customs_json, system_views_json
      )
      SELECT id, ${target}, name, description,
             values_json, taboos_json, speech_influences, customs_json, system_views_json
      FROM cultures WHERE novel_id = ${source}
    `

    // character_cultures — PK (novel_id, character_id, culture_id).
    await tx`
      INSERT INTO character_cultures (novel_id, character_id, culture_id, relationship)
      SELECT ${target}, character_id, culture_id, relationship
      FROM character_cultures WHERE novel_id = ${source}
    `

    // character_system_awareness — PK (novel_id, character_id, system_id).
    await tx`
      INSERT INTO character_system_awareness (
        novel_id, character_id, system_id,
        awareness_level, perspective, chapter_established
      )
      SELECT ${target}, character_id, system_id,
             awareness_level, perspective, chapter_established
      FROM character_system_awareness WHERE novel_id = ${source}
    `

    // story_spines — PK novel_id (one row per novel). Drafting clones need
    // this because src/index resume rehydrates completed concept output before
    // entering the drafting phase.
    await tx`
      INSERT INTO story_spines (novel_id, content_json)
      SELECT ${target}, content_json FROM story_spines WHERE novel_id = ${source}
    `

    // retrieval_config — PK novel_id (per-novel tuning row, sql/011).
    // Only inserts if a row exists for the source; callers fall back to
    // defaults when absent.
    await tx`
      INSERT INTO retrieval_config (
        novel_id, max_facts, max_events, max_summaries, max_states,
        max_relationships, max_knowledge, min_similarity,
        rrf_k, fetch_per_leg, character_boost, location_boost,
        recency_half_life, updated_at
      )
      SELECT ${target}, max_facts, max_events, max_summaries, max_states,
             max_relationships, max_knowledge, min_similarity,
             rrf_k, fetch_per_leg, character_boost, location_boost,
             recency_half_life, now()
      FROM retrieval_config WHERE novel_id = ${source}
    `

    if (targetPhase === "drafting") {
      // ─── Drafting-mode clones (preserve original behavior) ─────────

      // chapter_outlines — the frozen plan, row per chapter.
      await tx`
        INSERT INTO chapter_outlines (novel_id, chapter_number, outline_json)
        SELECT ${target}, chapter_number, outline_json
        FROM chapter_outlines WHERE novel_id = ${source}
      `

      // facts — materialized from planner's establishedFacts by
      // saveFact (src/db/facts.ts:4). Preserve role so role-aware drafting
      // A/B clones do not collapse reference/hidden facts to operational.
      await tx`
        INSERT INTO facts (novel_id, fact, category, established_in_chapter, role, created_at)
        SELECT ${target}, fact, category, established_in_chapter, role, created_at
        FROM facts WHERE novel_id = ${source}
      `

      // character_states — materialized by saveCharacterState.
      await tx`
        INSERT INTO character_states (novel_id, character_id, chapter_number, state_json)
        SELECT ${target}, character_id, chapter_number, state_json
        FROM character_states WHERE novel_id = ${source}
      `

      // character_knowledge — materialized by saveCharacterKnowledge.
      await tx`
        INSERT INTO character_knowledge (
          novel_id, character_id, knowledge, source, chapter_learned,
          category, is_false, source_character_id, source_event_id
        )
        SELECT ${target}, character_id, knowledge, source, chapter_learned,
               category, is_false, source_character_id, source_event_id
        FROM character_knowledge WHERE novel_id = ${source}
      `

      // relationship_states — defensive (no current write-site).
      await tx`
        INSERT INTO relationship_states (
          novel_id, character_a, character_b, chapter_number,
          trust_level, dynamic, tension, recent_shift
        )
        SELECT ${target}, character_a, character_b, chapter_number,
               trust_level, dynamic, tension, recent_shift
        FROM relationship_states WHERE novel_id = ${source}
      `

      // timeline_events — defensive.
      await tx`
        INSERT INTO timeline_events (
          novel_id, chapter_number, event, location, participants_json,
          witnesses_json, consequences, created_at
        )
        SELECT ${target}, chapter_number, event, location, participants_json,
               witnesses_json, consequences, created_at
        FROM timeline_events WHERE novel_id = ${source}
      `
    }

    // ─── Post-condition audits (INSIDE the transaction) ────────────────
    //
    // Audits run inside the tx so any failure (row-count mismatch,
    // unexpected post-concept rows on a concept-done target, missing
    // table) throws and rolls back the entire clone. Without the
    // rollback the caller would see a committed half-cloned novel.

    const cloneTables: readonly string[] = targetPhase === "drafting"
      ? [...COMMON_CLONE_TABLES, ...DRAFTING_ONLY_CLONE_TABLES]
      : [...COMMON_CLONE_TABLES]

    const mismatches: string[] = []
    for (const t of cloneTables) {
      const [srcRow] = await tx.unsafe(`SELECT COUNT(*)::int AS n FROM ${t} WHERE novel_id = $1`, [source]) as any
      const [tgtRow] = await tx.unsafe(`SELECT COUNT(*)::int AS n FROM ${t} WHERE novel_id = $1`, [target]) as any
      const src = Number(srcRow?.n ?? 0)
      const tgt = Number(tgtRow?.n ?? 0)
      if (src !== tgt) mismatches.push(`${t}: source=${src} target=${tgt}`)
      else console.log(`  ${t.padEnd(28)} ${src} rows copied`)
    }
    if (mismatches.length > 0) {
      console.error("\n  Row-count mismatch detected:")
      for (const m of mismatches) console.error(`    ${m}`)
      throw new Error(`clone audit failed: row-count mismatch on ${mismatches.length} tables (rolling back)`)
    }

    // concept-done mode: assert MUST-be-absent set is all empty on target.
    if (targetPhase === "concept-done") {
      const violations: string[] = []
      for (const t of CONCEPT_DONE_MUST_BE_ABSENT) {
        const [tgtRow] = await tx.unsafe(`SELECT COUNT(*)::int AS n FROM ${t} WHERE novel_id = $1`, [target]) as any
        const tgt = Number(tgtRow?.n ?? 0)
        if (tgt !== 0) violations.push(`${t}: target has ${tgt} rows (expected 0 for concept-done)`)
      }
      if (violations.length > 0) {
        console.error("\n  MUST-be-absent assertion failed:")
        for (const v of violations) console.error(`    ${v}`)
        throw new Error(`clone audit failed: ${violations.length} post-concept table(s) non-empty on concept-done target (rolling back)`)
      }
      console.log(`  (asserted ${CONCEPT_DONE_MUST_BE_ABSENT.length} post-concept tables empty on target)`)
    }
  })

  console.log(`\n  Cloned ${source} → ${target} (phase='${targetNovelPhase}', current_chapter=1)`)
  if (factRoleContextPolicy) {
    console.log(`  factRoleContextPolicy=${factRoleContextPolicy}`)
  }
  if (writerContextMode) {
    console.log(`  writerContextMode=${writerContextMode}`)
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
