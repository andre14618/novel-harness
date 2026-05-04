import { describe, expect, test } from "bun:test"
import {
  buildArtifactPatchEnvelope,
  classifyPatchRisk,
  stableHash,
  summarizePatch,
  targetForPatch,
} from "./proposal-envelope"
import type { AdjusterPatch } from "../agents/artifact-adjuster/schema"

const novelId = "novel-test-1"
const baseArtifacts = {
  world: { setting: "Tower" },
  characters: [
    { id: "char-hero", name: "Aria", goals: "Find the key" },
    { id: "char-foe", name: "Mord", goals: "Stop her" },
  ],
  spine: { centralConflict: "Aria vs Mord" },
}
const fixedNow = new Date("2026-05-04T12:00:00.000Z")

describe("ReviewProposalEnvelope — Phase 3 commit 1", () => {
  test("classifyPatchRisk: characterRename = medium, others = low", () => {
    expect(
      classifyPatchRisk({ type: "characterRename", characterId: "x", newName: "Y" }),
    ).toBe("medium")
    expect(
      classifyPatchRisk({
        type: "characterUpdate",
        characterId: "x",
        patch: { goals: "test" },
      }),
    ).toBe("low")
    expect(
      classifyPatchRisk({ type: "worldUpdate", patch: { setting: "T" } }),
    ).toBe("low")
    expect(
      classifyPatchRisk({ type: "spineUpdate", patch: { theme: "test" } }),
    ).toBe("low")
  })

  test("targetForPatch: character patches reference character id", () => {
    const t = targetForPatch(
      { type: "characterUpdate", characterId: "char-hero", patch: { goals: "Y" } },
      novelId,
      baseArtifacts,
    )
    expect(t.kind).toBe("character")
    expect(t.ref).toBe("char-hero")
    expect(t.currentVersion).toBe(stableHash(baseArtifacts.characters[0]))
  })

  test("targetForPatch: world patches reference novel + hash world artifact", () => {
    const t = targetForPatch(
      { type: "worldUpdate", patch: { setting: "Tower 2" } },
      novelId,
      baseArtifacts,
    )
    expect(t.kind).toBe("world_bible")
    expect(t.ref).toBe(novelId)
    expect(t.currentVersion).toBe(stableHash(baseArtifacts.world))
  })

  test("targetForPatch: spine patches reference novel + hash spine artifact", () => {
    const t = targetForPatch(
      { type: "spineUpdate", patch: { theme: "Hope" } },
      novelId,
      baseArtifacts,
    )
    expect(t.kind).toBe("story_spine")
    expect(t.ref).toBe(novelId)
    expect(t.currentVersion).toBe(stableHash(baseArtifacts.spine))
  })

  test("targetForPatch: characterRename of a character that doesn't exist hashes null (audit-trail signal)", () => {
    const t = targetForPatch(
      { type: "characterRename", characterId: "char-missing", newName: "Z" },
      novelId,
      baseArtifacts,
    )
    expect(t.kind).toBe("character")
    expect(t.ref).toBe("char-missing")
    expect(t.currentVersion).toBe(stableHash(null))
  })

  test("summarizePatch is human-readable for each kind", () => {
    expect(
      summarizePatch({
        type: "characterRename",
        characterId: "char-hero",
        newName: "Aria the Brave",
      }),
    ).toBe('Rename character char-hero → "Aria the Brave"')
    expect(
      summarizePatch({
        type: "characterUpdate",
        characterId: "char-hero",
        patch: { goals: "x", fears: "y" },
      }),
    ).toBe("Update character char-hero: goals, fears")
    expect(
      summarizePatch({ type: "worldUpdate", patch: { setting: "x" } }),
    ).toBe("Update world bible: setting")
    expect(
      summarizePatch({ type: "spineUpdate", patch: { theme: "x" } }),
    ).toBe("Update story spine: theme")
  })

  test("buildArtifactPatchEnvelope produces the expected shape for a characterUpdate", () => {
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "New goals" },
    }
    const env = buildArtifactPatchEnvelope({
      novelId,
      patch,
      patchIndex: 0,
      userMessage: "make Aria more goal-focused",
      rationale: "Tightens motivation per user feedback.",
      artifacts: baseArtifacts,
      now: fixedNow,
    })
    expect(env.kind).toBe("artifact_patch")
    expect(env.novelId).toBe(novelId)
    expect(env.status).toBe("pending")
    expect(env.risk).toBe("low")
    expect(env.target.kind).toBe("character")
    expect(env.target.ref).toBe("char-hero")
    expect(env.precondition.kind).toBe("artifact_hash")
    expect(env.precondition.hash).toBe(env.target.currentVersion)
    expect(env.payload).toEqual(patch)
    expect(env.source.agent).toBe("artifact-adjuster")
    expect(env.source.userMessage).toBe("make Aria more goal-focused")
    expect(env.rationale).toBe("Tightens motivation per user feedback.")
    expect(env.evidence).toEqual([])
    expect(env.policyRecommendation.decision).toBe("queue")
    expect(env.createdAt).toBe(fixedNow.toISOString())
    expect(env.id).toMatch(/^artifact-patch:novel-test-1:[0-9a-f]{16}$/)
  })

  test("buildArtifactPatchEnvelope id is deterministic for the same inputs", () => {
    const patch: AdjusterPatch = {
      type: "characterRename",
      characterId: "char-hero",
      newName: "Aria the Brave",
    }
    const a = buildArtifactPatchEnvelope({
      novelId,
      patch,
      patchIndex: 0,
      userMessage: "u",
      rationale: "r",
      artifacts: baseArtifacts,
      now: fixedNow,
    })
    const b = buildArtifactPatchEnvelope({
      novelId,
      patch,
      patchIndex: 0,
      userMessage: "u",
      rationale: "r",
      artifacts: baseArtifacts,
      now: fixedNow,
    })
    expect(a.id).toBe(b.id)
    // Different patchIndex → different id (so two consecutive same-content
    // patches in one /adjust response don't collapse).
    const c = buildArtifactPatchEnvelope({
      novelId,
      patch,
      patchIndex: 1,
      userMessage: "u",
      rationale: "r",
      artifacts: baseArtifacts,
      now: fixedNow,
    })
    expect(c.id).not.toBe(a.id)
  })

  test("buildArtifactPatchEnvelope id changes when the target artifact changes (precondition coupling)", () => {
    const patch: AdjusterPatch = {
      type: "worldUpdate",
      patch: { setting: "New Tower" },
    }
    const a = buildArtifactPatchEnvelope({
      novelId,
      patch,
      patchIndex: 0,
      userMessage: "u",
      rationale: "r",
      artifacts: baseArtifacts,
      now: fixedNow,
    })
    const b = buildArtifactPatchEnvelope({
      novelId,
      patch,
      patchIndex: 0,
      userMessage: "u",
      rationale: "r",
      artifacts: { ...baseArtifacts, world: { setting: "Different" } },
      now: fixedNow,
    })
    expect(a.id).not.toBe(b.id)
    expect(a.precondition.hash).not.toBe(b.precondition.hash)
  })

  test("characterRename gets risk=medium (cascading impact across references)", () => {
    const patch: AdjusterPatch = {
      type: "characterRename",
      characterId: "char-hero",
      newName: "Aria the Brave",
    }
    const env = buildArtifactPatchEnvelope({
      novelId,
      patch,
      patchIndex: 0,
      userMessage: "u",
      rationale: "r",
      artifacts: baseArtifacts,
      now: fixedNow,
    })
    expect(env.risk).toBe("medium")
    expect(env.policyRecommendation.reasons[0]).toMatch(/risk=medium/)
  })

  // Codex round-3 MEDIUM: stableHash must be restart-stable (canonical
  // JSON, not insertion-order JSON.stringify). Equivalent values that
  // differ only in key insertion order — e.g. across server restarts or
  // JSON parse round-trips that re-shuffle keys — must hash identically.
  test("stableHash is order-independent across object key insertion order", () => {
    const a = { name: "Aria", id: "char-hero", goals: "Find the key" }
    const b = { goals: "Find the key", id: "char-hero", name: "Aria" }
    const c = { id: "char-hero", goals: "Find the key", name: "Aria" }
    expect(stableHash(a)).toBe(stableHash(b))
    expect(stableHash(a)).toBe(stableHash(c))
  })

  test("stableHash is order-independent for nested objects", () => {
    const a = {
      world: { setting: "Tower", era: "modern" },
      meta: { kind: "world", version: 1 },
    }
    const b = {
      meta: { version: 1, kind: "world" },
      world: { era: "modern", setting: "Tower" },
    }
    expect(stableHash(a)).toBe(stableHash(b))
  })

  test("stableHash preserves array order (semantically meaningful)", () => {
    expect(stableHash([1, 2, 3])).not.toBe(stableHash([3, 2, 1]))
    expect(stableHash(["a", "b"])).not.toBe(stableHash(["b", "a"]))
  })

  test("stableHash distinguishes structurally different values", () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }))
    expect(stableHash({ a: 1, b: 2 })).not.toBe(stableHash({ a: 1 }))
    expect(stableHash("a")).not.toBe(stableHash(1))
    expect(stableHash(0)).not.toBe(stableHash(false))
    // Note: `undefined` is not JSON-representable, so `stableHash(undefined)`
    // and `stableHash(null)` collide by design — root-level undefined never
    // appears in artifact-content hashing in practice.
  })

  test("stableHash survives a JSON parse round-trip on the same value", () => {
    const original = { id: "x", nested: { k: 1, j: 2 }, arr: [{ b: 1, a: 2 }] }
    // Reorder keys via stringify+parse with a replacer that emits keys in
    // a different order — mimics what an external tool / cache layer might
    // do after a server restart.
    const reordered = JSON.parse(
      JSON.stringify(original, ["arr", "nested", "id", "j", "k", "a", "b"]),
    )
    expect(stableHash(original)).toBe(stableHash(reordered))
  })

  test("envelope id and target.currentVersion are restart-stable", () => {
    // Build the same envelope from key-shuffled artifact snapshots; the
    // envelope id and the precondition hash MUST collide. This is the
    // contract Phase 3 commits 2-5 will rely on (per-patch resolve routes
    // verify `precondition.hash === target.currentVersion`).
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "Find the second key" },
    }
    const reorderedCharacters = baseArtifacts.characters.map((c) => {
      // Same fields, different insertion order.
      const entries = Object.entries(c).reverse()
      return Object.fromEntries(entries) as typeof c
    })
    const a = buildArtifactPatchEnvelope({
      novelId,
      patch,
      patchIndex: 0,
      userMessage: "u",
      rationale: "r",
      artifacts: baseArtifacts,
      now: fixedNow,
    })
    const b = buildArtifactPatchEnvelope({
      novelId,
      patch,
      patchIndex: 0,
      userMessage: "u",
      rationale: "r",
      artifacts: { ...baseArtifacts, characters: reorderedCharacters },
      now: fixedNow,
    })
    expect(a.id).toBe(b.id)
    expect(a.target.currentVersion).toBe(b.target.currentVersion)
    expect(a.precondition.hash).toBe(b.precondition.hash)
  })

  // ── Phase 3 commit 4 follow-up B: parentEnvelopeId provenance ────────
  //
  // Regenerate-from-stale should record the stale envelope's id as
  // `source.parentEnvelopeId`. Crucially, parentEnvelopeId must NOT enter
  // the deterministic id seed: identical patch + identical target version
  // = identical envelope id regardless of how it was reached. Lineage is
  // provenance metadata, not identity. (Justifies the
  // `INSERT … ON CONFLICT (id) DO NOTHING` semantics in the persistence
  // layer — a regen that lands on the same id keeps the original row.)

  test("buildArtifactPatchEnvelope: parentEnvelopeId surfaces on source", () => {
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "X" },
    }
    const envelope = buildArtifactPatchEnvelope({
      novelId,
      patch,
      patchIndex: 0,
      userMessage: "u",
      rationale: "r",
      artifacts: baseArtifacts,
      now: fixedNow,
      parentEnvelopeId: "artifact-patch:novel-test-1:abc123def4567890",
    })
    expect(envelope.source.parentEnvelopeId).toBe(
      "artifact-patch:novel-test-1:abc123def4567890",
    )
  })

  test("buildArtifactPatchEnvelope: omitted parentEnvelopeId leaves source.parentEnvelopeId undefined", () => {
    const envelope = buildArtifactPatchEnvelope({
      novelId,
      patch: { type: "characterUpdate", characterId: "char-hero", patch: { goals: "X" } },
      patchIndex: 0,
      userMessage: "u",
      rationale: "r",
      artifacts: baseArtifacts,
      now: fixedNow,
    })
    expect(envelope.source.parentEnvelopeId).toBeUndefined()
  })

  test("buildArtifactPatchEnvelope: parentEnvelopeId does NOT affect envelope id (lineage is metadata, not identity)", () => {
    const patch: AdjusterPatch = {
      type: "characterUpdate",
      characterId: "char-hero",
      patch: { goals: "X" },
    }
    const args = {
      novelId,
      patch,
      patchIndex: 0,
      userMessage: "u",
      rationale: "r",
      artifacts: baseArtifacts,
      now: fixedNow,
    } as const
    const noParent = buildArtifactPatchEnvelope(args)
    const parentA = buildArtifactPatchEnvelope({ ...args, parentEnvelopeId: "parent-A" })
    const parentB = buildArtifactPatchEnvelope({ ...args, parentEnvelopeId: "parent-B" })
    expect(parentA.id).toBe(noParent.id)
    expect(parentB.id).toBe(noParent.id)
    expect(parentA.target.currentVersion).toBe(noParent.target.currentVersion)
    expect(parentA.precondition.hash).toBe(noParent.precondition.hash)
    // The parent links themselves do differ.
    expect(parentA.source.parentEnvelopeId).toBe("parent-A")
    expect(parentB.source.parentEnvelopeId).toBe("parent-B")
  })
})
