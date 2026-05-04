/**
 * Planning Snapshot — deterministic hash over the active planning artifacts.
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 4 — Planning Snapshot Review Before Drafting"
 *
 * Phase 4 commit 1 shipped the v1 tracer-bullet (world / characters /
 * spine / outlines). OpenCode review HIGH 2 flagged that the writer
 * also reads world systems, cultures, character cultures, and
 * character system awareness from the planning graph (see
 * `src/agents/writer/context.ts` lines 52, 314, 386). Mutations to
 * those rows changed drafting context while drift stayed false. v2
 * extends the input set to cover those graph rows. v1 callers can
 * still recompute v1 hashes by passing `version: "v1"` explicitly;
 * new callers default to v2.
 *
 * ## What the snapshot covers (v2)
 *
 *   - World bible                  (single object — `world_bibles.content_json`)
 *   - Characters                   (array, ordered by id)
 *   - Story spine                  (single object — `story_spines.content_json`)
 *   - Chapter outlines             (array, ordered by chapter_number)
 *   - World systems                (array, ordered by id) — magic / religion / politics / etc.
 *   - Cultures                     (array, ordered by id)
 *   - Character cultures           (array, ordered by character_id, culture_id)
 *   - Character system awareness   (array, ordered by character_id, system_id)
 *
 * Future commits may extend the input set further (planner Canon
 * proposals, planning directives) once the data shape stabilizes.
 * Adding inputs later changes the hash domain — clients that pinned
 * an older version see drift. To isolate that, the helper takes an
 * explicit `version` byte and mixes it into the digest. Bumping
 * produces a different hash even if the underlying artifacts haven't
 * changed; old hashes can still be recomputed by passing the older
 * version explicitly.
 *
 * ## Determinism
 *
 * `stableHash` (canonical-JSON sha256 from `proposal-envelope.ts`) handles
 * recursive key sorting; the array fields use deterministic accessor
 * orderings (`ORDER BY id` for characters / world_systems / cultures,
 * `ORDER BY chapter_number` for outlines, composite ORDER BY for the
 * per-character join tables). Together the hash is restart-stable
 * across runtimes and insensitive to the order objects' keys were
 * originally inserted.
 *
 * Two snapshots equal iff they were taken against bytewise-equivalent
 * planning state. Pending canon proposals are intentionally NOT in the
 * snapshot (no-ghost-canon — pending proposals don't contribute to canon
 * reads, so they shouldn't move the snapshot hash either). Approved/
 * rejected proposal status changes WILL move the hash because they alter
 * `factsAsOfChapter` and downstream reads.
 */

import { stableHash } from "./proposal-envelope"
import db from "../db/connection"
import { getLockedPlanningSnapshot } from "../db/planning-snapshots"
import type { PlanningSnapshotRow } from "../db/planning-snapshots"
import type { WorldBible, CharacterProfile, StorySpine, ChapterOutline } from "../types"
import type { WorldSystem, Culture } from "../db/world-systems"

type Executor = typeof db

/** Per-character culture row, snapshot-shape (no joined Culture object). */
export interface CharacterCultureSnapshotRow {
  characterId: string
  cultureId: string
  relationship: string
}

/** Per-character system-awareness row, snapshot-shape (no joined WorldSystem). */
export interface CharacterSystemAwarenessSnapshotRow {
  characterId: string
  systemId: string
  awarenessLevel: string
  perspective: string
  chapterEstablished: number
}

export interface PlanningSnapshotInputs {
  // v1 inputs.
  world: WorldBible | null
  characters: readonly CharacterProfile[]
  spine: StorySpine | null
  outlines: readonly ChapterOutline[]
  // v2 inputs. Optional on the type so v1 callers don't have to fill them
  // (compute branches on `version` and ignores v2 fields under v1).
  worldSystems?: readonly WorldSystem[]
  cultures?: readonly Culture[]
  characterCultures?: readonly CharacterCultureSnapshotRow[]
  characterSystemAwareness?: readonly CharacterSystemAwarenessSnapshotRow[]
}

export type PlanningSnapshotVersion = "v1" | "v2"

/**
 * Pure compute: takes already-loaded inputs and returns the deterministic
 * hash. Useful for tests and for callers that already have the inputs in
 * memory (avoids an extra DB roundtrip).
 *
 * The hashed shape branches on `version`:
 *   - v1: world / characters / spine / outlines only.
 *   - v2: v1 inputs + worldSystems / cultures / characterCultures /
 *     characterSystemAwareness. v2 fields default to `[]` when absent so
 *     a v2 hash on a fresh novel (no graph rows yet) is well-defined.
 *
 * Callers MUST pre-sort arrays per the documented orderings — the
 * helper does NOT re-sort, because re-sorting in two layers would
 * mask a drift in the source order.
 */
export function computePlanningSnapshotHashFromInputs(
  inputs: PlanningSnapshotInputs,
  version: PlanningSnapshotVersion = "v2",
): string {
  if (version === "v1") {
    return stableHash({
      version,
      world: inputs.world ?? null,
      characters: inputs.characters,
      spine: inputs.spine ?? null,
      outlines: inputs.outlines,
    })
  }
  // v2 — extend with the writer-consumed graph rows.
  return stableHash({
    version,
    world: inputs.world ?? null,
    characters: inputs.characters,
    spine: inputs.spine ?? null,
    outlines: inputs.outlines,
    worldSystems: inputs.worldSystems ?? [],
    cultures: inputs.cultures ?? [],
    characterCultures: inputs.characterCultures ?? [],
    characterSystemAwareness: inputs.characterSystemAwareness ?? [],
  })
}

/**
 * DB-bound entrypoint: reads the artifact slices under a single
 * read-only transaction and computes the snapshot hash. Missing
 * world / spine / outlines / graph rows surface as null / empty
 * (not an error) — a fresh novel pre-planning still has a valid
 * (mostly-null) snapshot, which keeps the lock-snapshot path
 * straightforward.
 *
 * **Atomicity.** Reads run inside `db.begin(tx => …)` so all
 * slices see a consistent state — a concurrent planning write
 * between reads cannot produce a "mixed" hash that nobody actually
 * intended.
 *
 * **Error handling.** Earlier versions wrapped each accessor in
 * `.catch(() => null|[])`, which silently masked transient DB
 * errors as "fresh novel" (drift detection would miss real state).
 * The reads are now done inline via the executor; only the "row not
 * present" case (rows.length === 0) coerces to null / empty. Real
 * DB errors propagate to the caller, which surfaces them as 500
 * in the route layer instead of locking a phantom hash.
 *
 * **Version branching.** v1 reads the four artifact slices (legacy
 * shape). v2 additionally reads the planning-graph rows (world_systems,
 * cultures, character_cultures, character_system_awareness) — the
 * surfaces the writer reads at draft time per
 * `src/agents/writer/context.ts`. Default is v2.
 */
export async function computePlanningSnapshotHash(
  novelId: string,
  version: PlanningSnapshotVersion = "v2",
): Promise<string> {
  return await db.begin(async (tx: Executor) => {
    const [world, characters, spine, outlines] = await Promise.all([
      readWorldBibleOrNull(tx, novelId),
      readCharactersOrdered(tx, novelId),
      readStorySpineOrNull(tx, novelId),
      readChapterOutlinesOrdered(tx, novelId),
    ])
    if (version === "v1") {
      return computePlanningSnapshotHashFromInputs(
        { world, characters, spine, outlines },
        "v1",
      )
    }
    const [worldSystems, cultures, characterCultures, characterSystemAwareness] =
      await Promise.all([
        readWorldSystemsOrdered(tx, novelId),
        readCulturesOrdered(tx, novelId),
        readCharacterCulturesOrdered(tx, novelId),
        readCharacterSystemAwarenessOrdered(tx, novelId),
      ])
    return computePlanningSnapshotHashFromInputs(
      {
        world, characters, spine, outlines,
        worldSystems, cultures, characterCultures, characterSystemAwareness,
      },
      "v2",
    )
  })
}

// ── Internal accessor helpers ───────────────────────────────────────────
//
// These read the planning slices through the supplied executor so
// `computePlanningSnapshotHash` can run them under one tx. The "or null"
// shape distinguishes "no row exists for this novel" (legit fresh-novel
// state — return null / empty) from real DB errors (which propagate to
// the caller; we never silently coerce them to "fresh novel").

async function readWorldBibleOrNull(
  executor: Executor,
  novelId: string,
): Promise<WorldBible | null> {
  const rows = (await executor`
    SELECT content_json FROM world_bibles WHERE novel_id = ${novelId}
  `) as { content_json: WorldBible }[]
  return rows.length > 0 ? rows[0].content_json : null
}

async function readCharactersOrdered(
  executor: Executor,
  novelId: string,
): Promise<CharacterProfile[]> {
  // ORDER BY id mirrors `db/world.ts:getCharacters` (Codex
  // conditioning-floor leak #3 keeps prompt rendering stable across
  // A/B arms; the snapshot hash inherits the same constraint).
  const rows = (await executor`
    SELECT profile_json FROM characters WHERE novel_id = ${novelId} ORDER BY id
  `) as { profile_json: CharacterProfile }[]
  return rows.map(r => r.profile_json)
}

async function readStorySpineOrNull(
  executor: Executor,
  novelId: string,
): Promise<StorySpine | null> {
  const rows = (await executor`
    SELECT content_json FROM story_spines WHERE novel_id = ${novelId}
  `) as { content_json: StorySpine }[]
  return rows.length > 0 ? rows[0].content_json : null
}

async function readChapterOutlinesOrdered(
  executor: Executor,
  novelId: string,
): Promise<ChapterOutline[]> {
  const rows = (await executor`
    SELECT outline_json FROM chapter_outlines WHERE novel_id = ${novelId} ORDER BY chapter_number
  `) as { outline_json: ChapterOutline }[]
  return rows.map(r => r.outline_json)
}

async function readWorldSystemsOrdered(
  executor: Executor,
  novelId: string,
): Promise<WorldSystem[]> {
  const rows = (await executor`
    SELECT id, name, type, description, rules_json, manifestations_json, vocabulary_json, constraints_json
    FROM world_systems WHERE novel_id = ${novelId} ORDER BY id
  `) as Array<{
    id: string; name: string; type: string; description: string;
    rules_json: string[]; manifestations_json: string[];
    vocabulary_json: string[]; constraints_json: string[];
  }>
  return rows.map(r => ({
    id: r.id, name: r.name, type: r.type, description: r.description,
    rules: r.rules_json, manifestations: r.manifestations_json,
    vocabulary: r.vocabulary_json, constraints: r.constraints_json,
  }))
}

async function readCulturesOrdered(
  executor: Executor,
  novelId: string,
): Promise<Culture[]> {
  const rows = (await executor`
    SELECT id, name, description, values_json, taboos_json, speech_influences, customs_json, system_views_json
    FROM cultures WHERE novel_id = ${novelId} ORDER BY id
  `) as Array<{
    id: string; name: string; description: string;
    values_json: string[]; taboos_json: string[];
    speech_influences: string; customs_json: string[];
    system_views_json: Record<string, string>;
  }>
  return rows.map(r => ({
    id: r.id, name: r.name, description: r.description,
    values: r.values_json, taboos: r.taboos_json,
    speechInfluences: r.speech_influences, customs: r.customs_json,
    systemViews: r.system_views_json,
  }))
}

async function readCharacterCulturesOrdered(
  executor: Executor,
  novelId: string,
): Promise<CharacterCultureSnapshotRow[]> {
  const rows = (await executor`
    SELECT character_id, culture_id, relationship
    FROM character_cultures WHERE novel_id = ${novelId}
    ORDER BY character_id, culture_id
  `) as Array<{ character_id: string; culture_id: string; relationship: string }>
  return rows.map(r => ({
    characterId: r.character_id,
    cultureId: r.culture_id,
    relationship: r.relationship,
  }))
}

async function readCharacterSystemAwarenessOrdered(
  executor: Executor,
  novelId: string,
): Promise<CharacterSystemAwarenessSnapshotRow[]> {
  const rows = (await executor`
    SELECT character_id, system_id, awareness_level, perspective, chapter_established
    FROM character_system_awareness WHERE novel_id = ${novelId}
    ORDER BY character_id, system_id
  `) as Array<{
    character_id: string; system_id: string;
    awareness_level: string; perspective: string;
    chapter_established: number;
  }>
  return rows.map(r => ({
    characterId: r.character_id,
    systemId: r.system_id,
    awarenessLevel: r.awareness_level,
    perspective: r.perspective,
    chapterEstablished: r.chapter_established,
  }))
}

// ── Phase 4 commit 5: replay-on-stale enforcement at draft start ─────────
//
// `assertDraftableSnapshot(novelId)` is the gate the drafting phase calls
// before generating any chapter. Contract:
//
//   - No locked snapshot → `{ ok: true, locked: false }`. Backward-compat
//     for novels that predate Phase 4 or operators who never opted into
//     the lock workflow. Drafting proceeds unchanged.
//   - Locked snapshot AND live hash matches the lock → `{ ok: true,
//     locked: true, lockedHash, liveHash, drift: false }`. Drafting
//     proceeds against the agreed-upon planning state.
//   - Locked snapshot AND live hash differs → `{ ok: false, drift: true,
//     lockedHash, liveHash }`. Drafting must NOT proceed; the operator
//     either rolls planning back to the locked state or re-locks the
//     current state via `POST /lock`. Phase 4's design is explicit:
//     "Require redraft/replan if locked planning artifacts change."
//
// The live hash is computed at the default version (v2). A v1 locked
// snapshot will register as drift even if the v1 inputs haven't changed
// — that's the right behavior, since the lock predated the v2 input
// expansion (HIGH 2) and cannot be trusted to evidence today's drafting
// surface.
//
// Production wiring: called from `runDraftingPhase` (`src/phases/drafting.ts`)
// before the chapter loop begins. The drafting phase converts a `false`
// result into a `paused` PhaseResult and emits a structured event so the
// orchestrator UI can surface the drift to the operator.

export interface DraftSnapshotGateResult {
  ok: boolean
  /** Whether a locked snapshot exists for this novel at all. */
  locked: boolean
  /** True iff `locked && lockedHash !== liveHash`. */
  drift: boolean
  /** Always present. */
  liveHash: string
  /** Present iff `locked`. */
  lockedHash?: string
  /** Present iff `locked`. */
  lockedSnapshot?: PlanningSnapshotRow
  /** Human-readable reason when `ok=false`. Empty otherwise. */
  reason: string
}

export async function assertDraftableSnapshot(
  novelId: string,
): Promise<DraftSnapshotGateResult> {
  const [locked, liveHash] = await Promise.all([
    getLockedPlanningSnapshot(novelId),
    computePlanningSnapshotHash(novelId),
  ])
  if (!locked) {
    return { ok: true, locked: false, drift: false, liveHash, reason: "" }
  }
  const lockedHash = locked.id
  if (lockedHash === liveHash) {
    return {
      ok: true,
      locked: true,
      drift: false,
      liveHash,
      lockedHash,
      lockedSnapshot: locked,
      reason: "",
    }
  }
  return {
    ok: false,
    locked: true,
    drift: true,
    liveHash,
    lockedHash,
    lockedSnapshot: locked,
    reason:
      `planning-snapshot-drift: locked=${lockedHash.slice(0, 16)}… ` +
      `live=${liveHash.slice(0, 16)}…. Drafting refuses; operator must ` +
      `roll back planning or re-lock via POST /planning-snapshot/lock.`,
  }
}
