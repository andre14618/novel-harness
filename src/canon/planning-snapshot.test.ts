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

import { describe, expect, test } from "bun:test"
import { computePlanningSnapshotHashFromInputs } from "./planning-snapshot"
import type { PlanningSnapshotInputs } from "./planning-snapshot"

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
