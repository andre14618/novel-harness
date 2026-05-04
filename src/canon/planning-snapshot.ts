/**
 * Planning Snapshot — deterministic hash over the active planning artifacts.
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 4 — Planning Snapshot Review Before Drafting"
 *
 * Phase 4 commit 1 ships the smallest tracer-bullet for the snapshot lane:
 * a pure compute function. No persistence (Phase 4 commit 2), no UI panel
 * (commit 3), no replay-on-stale enforcement (commit 4) — those follow.
 *
 * ## What the snapshot covers
 *
 *   - World bible              (single object — `world_bibles.content_json`)
 *   - Characters               (array, ordered by id)
 *   - Story spine              (single object — `story_spines.content_json`)
 *   - Chapter outlines         (array, ordered by chapterNumber)
 *
 * Future commits may extend the input set (planner Canon proposals, planning
 * directives) once the data shape stabilizes. Adding inputs later changes
 * the hash domain — clients that pinned a v1 hash would see drift. To
 * isolate that, the helper takes an explicit `version: "v1"` byte and
 * mixes it into the digest. Bumping to v2 produces a different hash even
 * if the underlying artifacts haven't changed; old v1 hashes can still
 * be recomputed by passing `version: "v1"` explicitly.
 *
 * ## Determinism
 *
 * `stableHash` (canonical-JSON sha256 from `proposal-envelope.ts`) handles
 * recursive key sorting; the array fields use deterministic accessor
 * orderings (`ORDER BY id` for characters, `ORDER BY chapter_number` for
 * outlines). Together the hash is restart-stable across runtimes and
 * insensitive to the order objects' keys were originally inserted.
 *
 * Two snapshots equal iff they were taken against bytewise-equivalent
 * planning state. Pending canon proposals are intentionally NOT in the
 * snapshot (no-ghost-canon — pending proposals don't contribute to canon
 * reads, so they shouldn't move the snapshot hash either). Approved/
 * rejected proposal status changes WILL move the hash because they alter
 * `factsAsOfChapter` and downstream reads.
 *
 * Note: §1's no-ghost-canon rule means the canon-substrate state is
 * already reflected in the planning artifacts the writer reads
 * (chapter_outlines render approved facts, etc.). v1 hashes the artifacts
 * directly; an explicit canon-state byte can be added if a future commit
 * needs to detect approve/reject events that don't surface as outline
 * changes within v1's input set.
 */

import { stableHash } from "./proposal-envelope"
import db from "../db/connection"
import type { WorldBible, CharacterProfile, StorySpine, ChapterOutline } from "../types"

type Executor = typeof db

export interface PlanningSnapshotInputs {
  world: WorldBible | null
  characters: readonly CharacterProfile[]
  spine: StorySpine | null
  outlines: readonly ChapterOutline[]
}

export type PlanningSnapshotVersion = "v1"

/**
 * Pure compute: takes already-loaded inputs and returns the deterministic
 * hash. Useful for tests and for callers that already have the inputs in
 * memory (avoids an extra DB roundtrip).
 *
 * Characters and outlines are NOT re-sorted here — the contract is that
 * they arrive in canonical order from `getCharacters` / `getChapterOutlines`
 * (`ORDER BY id` / `ORDER BY chapter_number`). If a future caller ingests
 * them from a non-DB source, they MUST pre-sort to match.
 */
export function computePlanningSnapshotHashFromInputs(
  inputs: PlanningSnapshotInputs,
  version: PlanningSnapshotVersion = "v1",
): string {
  return stableHash({
    version,
    world: inputs.world ?? null,
    characters: inputs.characters,
    spine: inputs.spine ?? null,
    outlines: inputs.outlines,
  })
}

/**
 * DB-bound entrypoint: reads the four artifact slices under a single
 * read-only transaction and computes the snapshot hash. Missing world /
 * spine / outlines surface as null / empty (not an error) — a fresh
 * novel pre-planning still has a valid (mostly-null) snapshot, which
 * keeps the lock-snapshot path straightforward.
 *
 * **Atomicity.** Reads run inside `db.begin(tx => …)` so the four
 * slices see a consistent state — a concurrent planning write between
 * reads cannot produce a "mixed" hash that nobody actually intended.
 *
 * **Error handling.** Earlier versions wrapped each accessor in
 * `.catch(() => null|[])`, which silently masked transient DB errors
 * as "fresh novel" (a real bug surface — a connection drop on one
 * read would yield a hash that doesn't reflect actual planning
 * state). The reads are now done inline via the executor; only the
 * "row not present" case (rows.length === 0) coerces to null /
 * empty. Real DB errors propagate to the caller, which surfaces them
 * as 500 in the route layer instead of locking a phantom hash.
 */
export async function computePlanningSnapshotHash(
  novelId: string,
  version: PlanningSnapshotVersion = "v1",
): Promise<string> {
  return await db.begin(async (tx: Executor) => {
    const [world, characters, spine, outlines] = await Promise.all([
      readWorldBibleOrNull(tx, novelId),
      readCharactersOrdered(tx, novelId),
      readStorySpineOrNull(tx, novelId),
      readChapterOutlinesOrdered(tx, novelId),
    ])
    return computePlanningSnapshotHashFromInputs(
      { world, characters, spine, outlines },
      version,
    )
  })
}

// ── Internal accessor helpers ───────────────────────────────────────────
//
// These read the four planning slices through the supplied executor so
// `computePlanningSnapshotHash` can run them under one tx. The "or null"
// shape distinguishes "no row exists for this novel" (legit fresh-novel
// state — return null/empty) from real DB errors (which propagate to the
// caller; we never silently coerce them to "fresh novel").

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
