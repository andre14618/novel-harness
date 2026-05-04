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
})
