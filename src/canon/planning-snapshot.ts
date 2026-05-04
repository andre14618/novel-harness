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
import { getWorldBible, getCharacters, getStorySpine } from "../db/world"
import { getChapterOutlines } from "../db/outlines"
import type { WorldBible, CharacterProfile, StorySpine, ChapterOutline } from "../types"

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
 * DB-bound entrypoint: reads the four artifact slices and computes the
 * snapshot hash. Missing world / spine / outlines surface as null /
 * empty (not an error) — a fresh novel pre-planning still has a valid
 * (mostly-null) snapshot, which keeps the lock-snapshot-anyway path
 * straightforward.
 */
export async function computePlanningSnapshotHash(
  novelId: string,
  version: PlanningSnapshotVersion = "v1",
): Promise<string> {
  const [world, characters, spine, outlines] = await Promise.all([
    getWorldBible(novelId).catch(() => null),
    getCharacters(novelId).catch(() => [] as CharacterProfile[]),
    getStorySpine(novelId).catch(() => null),
    getChapterOutlines(novelId).catch(() => [] as ChapterOutline[]),
  ])
  return computePlanningSnapshotHashFromInputs(
    { world, characters, spine, outlines },
    version,
  )
}
