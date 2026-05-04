/**
 * Phase 4 commit 1 — computePlanningSnapshotHash tracer-bullet tests.
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 4"
 *
 * Tests the pure variant directly (no DB needed). The DB-bound
 * `computePlanningSnapshotHash(novelId)` is a thin wrapper that hands
 * results from the existing accessors to the pure variant; the
 * accessors are themselves DB-tested. We pin the contract that matters
 * here: determinism and the right input set.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  computePlanningSnapshotHashFromInputs,
  computePlanningSnapshotHash,
  assertDraftableSnapshot,
} from "./planning-snapshot"
import type { PlanningSnapshotInputs } from "./planning-snapshot"
import db from "../db/connection"
import { dbReachable } from "../db/test-helpers"
import {
  recordPlanningSnapshot,
  lockPlanningSnapshot,
  deletePlanningSnapshotsForNovel,
} from "../db/planning-snapshots"

const reachable = await dbReachable()

const baseInputs: PlanningSnapshotInputs = {
  world: { setting: "Tower" } as any,
  characters: [
    { id: "char-foe", name: "Mord", goals: "Stop her" } as any,
    { id: "char-hero", name: "Aria", goals: "Find the key" } as any,
  ],
  spine: { centralConflict: "Aria vs Mord" } as any,
  outlines: [
    { chapterNumber: 1, beats: [{ id: "b1", text: "open" }] } as any,
    { chapterNumber: 2, beats: [{ id: "b2", text: "act" }] } as any,
  ],
}

describe("computePlanningSnapshotHash — Phase 4 commit 1", () => {
  test("returns a 64-char hex sha256 string", () => {
    const hash = computePlanningSnapshotHashFromInputs(baseInputs)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test("is deterministic across calls with the same inputs", () => {
    const a = computePlanningSnapshotHashFromInputs(baseInputs)
    const b = computePlanningSnapshotHashFromInputs(baseInputs)
    expect(a).toBe(b)
  })

  test("survives JSON round-trip (canonical-JSON serializer in stableHash)", () => {
    const a = computePlanningSnapshotHashFromInputs(baseInputs)
    const roundTripped = JSON.parse(JSON.stringify(baseInputs)) as PlanningSnapshotInputs
    const b = computePlanningSnapshotHashFromInputs(roundTripped)
    expect(a).toBe(b)
  })

  test("changes when the world bible changes", () => {
    const a = computePlanningSnapshotHashFromInputs(baseInputs)
    const b = computePlanningSnapshotHashFromInputs({
      ...baseInputs,
      world: { setting: "Harbor" } as any,
    })
    expect(a).not.toBe(b)
  })

  test("changes when a character is updated", () => {
    const a = computePlanningSnapshotHashFromInputs(baseInputs)
    const editedChars = baseInputs.characters.map(c =>
      c.id === "char-hero" ? { ...c, goals: "Find the second key" } : c,
    )
    const b = computePlanningSnapshotHashFromInputs({
      ...baseInputs,
      characters: editedChars,
    })
    expect(a).not.toBe(b)
  })

  test("changes when an outline is added", () => {
    const a = computePlanningSnapshotHashFromInputs(baseInputs)
    const b = computePlanningSnapshotHashFromInputs({
      ...baseInputs,
      outlines: [
        ...baseInputs.outlines,
        { chapterNumber: 3, beats: [{ id: "b3", text: "climax" }] } as any,
      ],
    })
    expect(a).not.toBe(b)
  })

  test("changes when the story spine is updated", () => {
    const a = computePlanningSnapshotHashFromInputs(baseInputs)
    const b = computePlanningSnapshotHashFromInputs({
      ...baseInputs,
      spine: { centralConflict: "Aria vs Empire" } as any,
    })
    expect(a).not.toBe(b)
  })

  test("v1 vs v2 (future) version tag yields different hashes for same artifacts", () => {
    const v1 = computePlanningSnapshotHashFromInputs(baseInputs, "v1")
    // Use a future version tag via a type assertion — the function accepts
    // any string at runtime via the union; this is the contract that lets
    // a future schema bump re-namespace hashes without changing inputs.
    const v2 = computePlanningSnapshotHashFromInputs(baseInputs, "v2" as any)
    expect(v1).not.toBe(v2)
  })

  test("null world / null spine / empty arrays produce a stable hash (fresh-novel case)", () => {
    const empty: PlanningSnapshotInputs = {
      world: null,
      characters: [],
      spine: null,
      outlines: [],
    }
    const a = computePlanningSnapshotHashFromInputs(empty)
    const b = computePlanningSnapshotHashFromInputs(empty)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  test("character key order doesn't affect hash (canonical JSON sorts keys recursively)", () => {
    const a = computePlanningSnapshotHashFromInputs(baseInputs)
    // Same character with keys in different insertion order — stableHash
    // normalizes via canonicalize() (recursive key sort).
    const reorderedChars = baseInputs.characters.map(c => ({
      goals: (c as any).goals,
      name: c.name,
      id: c.id,
    } as any))
    const b = computePlanningSnapshotHashFromInputs({
      ...baseInputs,
      characters: reorderedChars,
    })
    expect(a).toBe(b)
  })
})

describe("v2 input sensitivity (OpenCode HIGH 2)", () => {
  // Each test extends baseInputs with one v2 input slice, then mutates
  // that slice and confirms the hash moves. v1 callers don't exercise
  // these paths because v1 ignores the v2 fields.

  test("changes when a worldSystem is added", () => {
    const a = computePlanningSnapshotHashFromInputs({ ...baseInputs }, "v2")
    const b = computePlanningSnapshotHashFromInputs(
      {
        ...baseInputs,
        worldSystems: [
          {
            id: "sys-magic", name: "Sigilcraft", type: "magic",
            description: "Glyphs bind power",
            rules: ["binding"], manifestations: ["glow"],
            vocabulary: ["sigil"], constraints: ["written"],
          },
        ],
      },
      "v2",
    )
    expect(a).not.toBe(b)
  })

  test("changes when a culture is added", () => {
    const a = computePlanningSnapshotHashFromInputs({ ...baseInputs }, "v2")
    const b = computePlanningSnapshotHashFromInputs(
      {
        ...baseInputs,
        cultures: [
          {
            id: "cult-mer", name: "Merfolk", description: "...",
            values: ["water"], taboos: ["fire"], speechInfluences: "",
            customs: [], systemViews: {},
          },
        ],
      },
      "v2",
    )
    expect(a).not.toBe(b)
  })

  test("changes when a characterCulture link is added", () => {
    const a = computePlanningSnapshotHashFromInputs({ ...baseInputs }, "v2")
    const b = computePlanningSnapshotHashFromInputs(
      {
        ...baseInputs,
        characterCultures: [
          { characterId: "char-hero", cultureId: "cult-mer", relationship: "native" },
        ],
      },
      "v2",
    )
    expect(a).not.toBe(b)
  })

  test("changes when characterSystemAwareness is added", () => {
    const a = computePlanningSnapshotHashFromInputs({ ...baseInputs }, "v2")
    const b = computePlanningSnapshotHashFromInputs(
      {
        ...baseInputs,
        characterSystemAwareness: [
          {
            characterId: "char-hero", systemId: "sys-magic",
            awarenessLevel: "practitioner", perspective: "...",
            chapterEstablished: 1,
          },
        ],
      },
      "v2",
    )
    expect(a).not.toBe(b)
  })

  test("v2 ignores v2 fields when called with version='v1' (back-compat)", () => {
    const a = computePlanningSnapshotHashFromInputs({ ...baseInputs }, "v1")
    const b = computePlanningSnapshotHashFromInputs(
      {
        ...baseInputs,
        worldSystems: [
          {
            id: "sys-magic", name: "Sigilcraft", type: "magic", description: "...",
            rules: [], manifestations: [], vocabulary: [], constraints: [],
          },
        ],
      },
      "v1",
    )
    // v1 namespace IS unchanged by v2 inputs — the contract is that
    // v1 hashes a fixed input set so a v1-pinned client stays stable.
    expect(a).toBe(b)
  })

  test("v2 default — same v1 inputs produce different v2 hash than v1 hash", () => {
    const v1 = computePlanningSnapshotHashFromInputs(baseInputs, "v1")
    const v2 = computePlanningSnapshotHashFromInputs(baseInputs, "v2")
    expect(v1).not.toBe(v2)
  })

  test("v2 default — character culture order doesn't matter when pre-sorted by accessor", () => {
    // Snapshot accessor sorts characterCultures by (characterId, cultureId).
    // Test that two equivalent inputs yield the same hash.
    const a = computePlanningSnapshotHashFromInputs(
      {
        ...baseInputs,
        characterCultures: [
          { characterId: "char-foe", cultureId: "cult-a", relationship: "native" },
          { characterId: "char-hero", cultureId: "cult-b", relationship: "adopted" },
        ],
      },
      "v2",
    )
    const b = computePlanningSnapshotHashFromInputs(
      {
        ...baseInputs,
        characterCultures: [
          { characterId: "char-foe", cultureId: "cult-a", relationship: "native" },
          { characterId: "char-hero", cultureId: "cult-b", relationship: "adopted" },
        ],
      },
      "v2",
    )
    expect(a).toBe(b)
  })
})

// ── Phase 4 commit 5 — replay-on-stale enforcement ──────────────────────

describe.skipIf(!reachable)("assertDraftableSnapshot — Phase 4 commit 5", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = `test-ds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await db`INSERT INTO novels (id, seed_json) VALUES (${novelId}, ${{ premise: "test" }})
             ON CONFLICT (id) DO NOTHING`
  })

  afterEach(async () => {
    await deletePlanningSnapshotsForNovel(novelId)
    await db`DELETE FROM novels WHERE id = ${novelId}`
  })

  test("no locked snapshot → ok=true, locked=false (backward compat)", async () => {
    const result = await assertDraftableSnapshot(novelId)
    expect(result.ok).toBe(true)
    expect(result.locked).toBe(false)
    expect(result.drift).toBe(false)
    expect(result.liveHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.lockedHash).toBeUndefined()
    expect(result.reason).toBe("")
  })

  test("locked at live hash → ok=true, drift=false", async () => {
    // Lock the live hash itself — drafting should proceed cleanly.
    const liveHash = await computePlanningSnapshotHash(novelId)
    await recordPlanningSnapshot({ hash: liveHash, novelId, version: "v2" })
    await lockPlanningSnapshot({
      hash: liveHash,
      lockedByKind: "human",
      lockedByRef: null,
      lockedNote: null,
    })

    const result = await assertDraftableSnapshot(novelId)
    expect(result.ok).toBe(true)
    expect(result.locked).toBe(true)
    expect(result.drift).toBe(false)
    expect(result.lockedHash).toBe(liveHash)
    expect(result.liveHash).toBe(liveHash)
    expect(result.lockedSnapshot?.id).toBe(liveHash)
    expect(result.reason).toBe("")
  })

  test("locked at a different hash → ok=false, drift=true, reason populated", async () => {
    // Lock a hash that does NOT correspond to the current planning state.
    const fakeLockedHash = "f".repeat(64)
    await recordPlanningSnapshot({ hash: fakeLockedHash, novelId, version: "v2" })
    await lockPlanningSnapshot({
      hash: fakeLockedHash,
      lockedByKind: "human",
      lockedByRef: null,
      lockedNote: null,
    })

    const result = await assertDraftableSnapshot(novelId)
    expect(result.ok).toBe(false)
    expect(result.locked).toBe(true)
    expect(result.drift).toBe(true)
    expect(result.lockedHash).toBe(fakeLockedHash)
    expect(result.liveHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.liveHash).not.toBe(fakeLockedHash)
    expect(result.reason).toContain("planning-snapshot-drift")
    expect(result.reason).toContain(fakeLockedHash.slice(0, 16))
    expect(result.reason).toContain(result.liveHash.slice(0, 16))
    expect(result.reason).toContain("re-lock")
  })

  test("v1 lock against current default (v2) live hash registers as drift", async () => {
    // Operator locked at v1 in the past; now the default has bumped to
    // v2. The old lock cannot evidence today's writer surface (HIGH 2),
    // so the gate must refuse to draft until they re-lock.
    const liveV1 = await computePlanningSnapshotHash(novelId, "v1")
    const liveV2 = await computePlanningSnapshotHash(novelId, "v2")
    expect(liveV1).not.toBe(liveV2)
    await recordPlanningSnapshot({ hash: liveV1, novelId, version: "v1" })
    await lockPlanningSnapshot({
      hash: liveV1,
      lockedByKind: "human",
      lockedByRef: null,
      lockedNote: null,
    })

    const result = await assertDraftableSnapshot(novelId)
    expect(result.ok).toBe(false)
    expect(result.drift).toBe(true)
    expect(result.lockedHash).toBe(liveV1)
    expect(result.liveHash).toBe(liveV2)
  })
})
