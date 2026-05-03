import { describe, expect, test } from "bun:test"
import {
  InMemoryCanonSubstrate,
  type ProposalInput,
} from "./substrate"
import { assembleL1 } from "./bundle"
import type {
  ApprovalStatus,
  CanonFact,
  CharacterState,
  Entity,
  Provenance,
  StoryPromise,
} from "./api"

// ── Fixture builders ─────────────────────────────────────────────────────────

function provenance(opts: Partial<Provenance> = {}): Provenance {
  return {
    source: opts.source ?? "post-draft-extraction",
    chapter: opts.chapter ?? 1,
    extractorVersion: opts.extractorVersion ?? "test-v1",
    approvalStatus: opts.approvalStatus ?? "human-approved",
    origin: opts.origin ?? "observed",
    createdAt: opts.createdAt ?? "2026-05-03T00:00:00Z",
    updatedAt: opts.updatedAt ?? "2026-05-03T00:00:00Z",
    confidence: opts.confidence,
    beat: opts.beat,
    supersedes: opts.supersedes,
  }
}

function fact(id: string, text: string, prov: Partial<Provenance> = {}): CanonFact {
  return { id, kind: "established_fact", text, provenance: provenance(prov) }
}

function entity(id: string, name: string, prov: Partial<Provenance> = {}): Entity {
  return {
    id,
    name,
    aliases: [],
    kind: "character",
    firstAppearedChapter: prov.chapter,
    provenance: provenance(prov),
  }
}

function characterState(
  characterId: string,
  name: string,
  asOfChapter: number,
  approvalStatus: ApprovalStatus = "human-approved",
): CharacterState {
  return {
    characterId,
    characterName: name,
    knownFacts: [],
    state: { location: "anywhere" },
    asOfChapter,
    provenance: provenance({ chapter: asOfChapter, approvalStatus }),
  }
}

function storyPromise(
  id: string,
  setupChapter: number,
  approvalStatus: ApprovalStatus = "human-approved",
): StoryPromise {
  return {
    id,
    setupChapter,
    status: "open",
    promiseFactId: `${id}-fact`,
    provenance: provenance({
      chapter: setupChapter,
      approvalStatus,
      source: "planner-output",
      origin: "planned",
    }),
  }
}

function proposalInput(
  factToPropose: CanonFact,
  targetFactId?: string,
): ProposalInput {
  return {
    source: "post-draft-extraction",
    targetFactId,
    proposedFact: {
      id: factToPropose.id,
      kind: factToPropose.kind,
      text: factToPropose.text,
      data: factToPropose.data,
      provenance: {
        source: factToPropose.provenance.source,
        chapter: factToPropose.provenance.chapter,
        beat: factToPropose.provenance.beat,
        extractorVersion: factToPropose.provenance.extractorVersion,
        confidence: factToPropose.provenance.confidence,
        origin: factToPropose.provenance.origin,
        supersedes: factToPropose.provenance.supersedes,
      },
    },
  }
}

const NOVEL = "test-novel"

// ── No-ghost-canon (pending/rejected/contested invisible to reads) ──────────

describe("CanonSubstrate — no-ghost-canon: pending proposals never appear in reads", () => {
  test("propose without committing — fact NOT visible", async () => {
    const sub = new InMemoryCanonSubstrate()
    const newFact = fact("fact-magic-burns", "Magic burns the user.", { chapter: 3 })
    await sub.proposeCanonUpdate(NOVEL, proposalInput(newFact))
    expect(sub.factsAsOfChapter(NOVEL, 5)).toEqual([])
  })

  test("propose then reject — fact NOT visible after rejection", async () => {
    const sub = new InMemoryCanonSubstrate()
    const newFact = fact("fact-bogus", "Pretend canon.", { chapter: 3 })
    const proposal = await sub.proposeCanonUpdate(NOVEL, proposalInput(newFact))
    await sub.resolveProposal(proposal.id, "rejected", { operatorNote: "wrong" })
    expect(sub.factsAsOfChapter(NOVEL, 5)).toEqual([])
    // Generation bumped so consumers can detect the state change.
    expect(sub.snapshotVersion(NOVEL)).not.toBe(`${NOVEL}@0`)
  })

  test("propose then approve — fact IS visible after approval", async () => {
    const sub = new InMemoryCanonSubstrate()
    const newFact = fact("fact-real", "Real canon.", { chapter: 3 })
    const proposal = await sub.proposeCanonUpdate(NOVEL, proposalInput(newFact))
    const result = await sub.resolveProposal(proposal.id, "approved")
    expect(result.committedFact?.id).toBe("fact-real")
    expect(result.committedFact?.provenance.approvalStatus).toBe("human-approved")
    const visible = sub.factsAsOfChapter(NOVEL, 5)
    expect(visible).toHaveLength(1)
    expect(visible[0].id).toBe("fact-real")
  })

  test("listPendingProposals returns pending only; commits and rejects drop off", async () => {
    const sub = new InMemoryCanonSubstrate()
    const a = await sub.proposeCanonUpdate(NOVEL, proposalInput(fact("a", "A", { chapter: 1 })))
    const b = await sub.proposeCanonUpdate(NOVEL, proposalInput(fact("b", "B", { chapter: 1 })))
    const c = await sub.proposeCanonUpdate(NOVEL, proposalInput(fact("c", "C", { chapter: 1 })))
    await sub.resolveProposal(a.id, "approved")
    await sub.resolveProposal(b.id, "rejected")
    const pending = await sub.listPendingProposals(NOVEL)
    expect(pending.map((p) => p.id)).toEqual([c.id])
  })
})

// ── Approval-status filter ───────────────────────────────────────────────────

describe("CanonSubstrate — approval-status filter", () => {
  test("seedFact rejects auto-extracted (would be ghost canon)", () => {
    const sub = new InMemoryCanonSubstrate()
    expect(() =>
      sub.seedFact(NOVEL, fact("f", "x", { approvalStatus: "auto-extracted" })),
    ).toThrow(/no ghost canon/i)
  })

  test("seedFact rejects contested", () => {
    const sub = new InMemoryCanonSubstrate()
    expect(() =>
      sub.seedFact(NOVEL, fact("f", "x", { approvalStatus: "contested" })),
    ).toThrow(/no ghost canon/i)
  })

  test("seedFact rejects rejected", () => {
    const sub = new InMemoryCanonSubstrate()
    expect(() =>
      sub.seedFact(NOVEL, fact("f", "x", { approvalStatus: "rejected" })),
    ).toThrow(/no ghost canon/i)
  })

  test("seedFact accepts human-approved and human-edited", () => {
    const sub = new InMemoryCanonSubstrate()
    expect(() =>
      sub.seedFact(NOVEL, fact("a", "A", { approvalStatus: "human-approved" })),
    ).not.toThrow()
    expect(() =>
      sub.seedFact(NOVEL, fact("b", "B", { approvalStatus: "human-edited" })),
    ).not.toThrow()
    expect(sub.factsAsOfChapter(NOVEL, 5)).toHaveLength(2)
  })
})

// ── Point-in-time snapshot semantics ─────────────────────────────────────────

describe("CanonSubstrate — point-in-time snapshot at chapter N", () => {
  test("future commits are NOT visible in earlier-chapter snapshots", () => {
    const sub = new InMemoryCanonSubstrate()
    sub.seedFact(NOVEL, fact("fact-ch1", "Established at ch1.", { chapter: 1 }))
    sub.seedFact(NOVEL, fact("fact-ch5", "Established at ch5.", { chapter: 5 }))
    expect(sub.factsAsOfChapter(NOVEL, 3).map((f) => f.id)).toEqual(["fact-ch1"])
    expect(
      sub.factsAsOfChapter(NOVEL, 7).map((f) => f.id).sort(),
    ).toEqual(["fact-ch1", "fact-ch5"])
  })

  test("supersession: chapter-3 read sees v1; chapter-7 read sees v2", () => {
    const sub = new InMemoryCanonSubstrate()
    // v1 committed at chapter 3.
    sub.seedFact(NOVEL, fact("logical-x", "Original value", { chapter: 3 }))
    // v2 committed at chapter 6 (an edit/correction of the same logical id).
    sub.seedFact(NOVEL, fact("logical-x", "Corrected value", { chapter: 6 }))

    const at3 = sub.factsAsOfChapter(NOVEL, 3)
    expect(at3).toHaveLength(1)
    expect(at3[0].text).toBe("Original value")

    const at5 = sub.factsAsOfChapter(NOVEL, 5)
    expect(at5).toHaveLength(1)
    expect(at5[0].text).toBe("Original value") // chapter-5 still pre-supersession

    const at8 = sub.factsAsOfChapter(NOVEL, 8)
    expect(at8).toHaveLength(1)
    expect(at8[0].text).toBe("Corrected value") // post-supersession
  })

  test("supersession via resolveProposal: corrects an existing fact", async () => {
    const sub = new InMemoryCanonSubstrate()
    sub.seedFact(NOVEL, fact("logical-y", "v1 text", { chapter: 2 }))

    // Operator proposes a correction in chapter 5.
    const correction = fact("logical-y", "v2 text", { chapter: 5 })
    const proposal = await sub.proposeCanonUpdate(
      NOVEL,
      proposalInput(correction, "logical-y"),
    )
    await sub.resolveProposal(proposal.id, "approved")

    expect(sub.factsAsOfChapter(NOVEL, 4)[0].text).toBe("v1 text")
    expect(sub.factsAsOfChapter(NOVEL, 6)[0].text).toBe("v2 text")
  })

  test("snapshotVersion bumps on every commit and on rejection", async () => {
    const sub = new InMemoryCanonSubstrate()
    const v0 = sub.snapshotVersion(NOVEL)
    sub.seedFact(NOVEL, fact("a", "A", { chapter: 1 }))
    const v1 = sub.snapshotVersion(NOVEL)
    expect(v1).not.toBe(v0)

    const proposal = await sub.proposeCanonUpdate(
      NOVEL,
      proposalInput(fact("b", "B", { chapter: 1 })),
    )
    // Pending proposal does NOT bump generation.
    expect(sub.snapshotVersion(NOVEL)).toBe(v1)

    await sub.resolveProposal(proposal.id, "rejected")
    const v2 = sub.snapshotVersion(NOVEL)
    expect(v2).not.toBe(v1)
  })
})

// ── CharacterState + StoryPromise: provenance + committed-only ───────────────

describe("CanonSubstrate — CharacterState/StoryPromise no-ghost-canon", () => {
  test("seedCharacterState rejects non-committed approval", () => {
    const sub = new InMemoryCanonSubstrate()
    expect(() =>
      sub.seedCharacterState(
        NOVEL,
        characterState("aldric", "Aldric", 3, "auto-extracted"),
      ),
    ).toThrow(/no ghost canon/i)
  })

  test("seedStoryPromise rejects non-committed approval", () => {
    const sub = new InMemoryCanonSubstrate()
    expect(() =>
      sub.seedStoryPromise(
        NOVEL,
        storyPromise("promise-x", 2, "contested"),
      ),
    ).toThrow(/no ghost canon/i)
  })

  test("approved CharacterState appears at and after asOfChapter; latest-snapshot semantic", () => {
    const sub = new InMemoryCanonSubstrate()
    sub.seedCharacterState(NOVEL, characterState("aldric", "Aldric", 1))
    sub.seedCharacterState(NOVEL, characterState("aldric", "Aldric", 4))
    sub.seedCharacterState(NOVEL, characterState("aldric", "Aldric", 7))

    const at2 = sub.characterStatesAsOfChapter(NOVEL, 2)
    expect(at2).toHaveLength(1)
    expect(at2[0].asOfChapter).toBe(1)

    const at5 = sub.characterStatesAsOfChapter(NOVEL, 5)
    expect(at5).toHaveLength(1)
    expect(at5[0].asOfChapter).toBe(4)

    const at8 = sub.characterStatesAsOfChapter(NOVEL, 8)
    expect(at8).toHaveLength(1)
    expect(at8[0].asOfChapter).toBe(7)
  })

  test("approved StoryPromise becomes visible at setupChapter onward", () => {
    const sub = new InMemoryCanonSubstrate()
    sub.seedStoryPromise(NOVEL, storyPromise("promise-arc", 3))
    expect(sub.promisesAsOfChapter(NOVEL, 2)).toHaveLength(0)
    expect(sub.promisesAsOfChapter(NOVEL, 5)).toHaveLength(1)
  })
})

// ── Adapter satisfies bundle.ts CanonSource (the seam end-to-end) ────────────

describe("CanonSubstrate — adapter satisfies bundle.ts CanonSource", () => {
  test("assembleL1 against an InMemoryCanonSubstrate produces a valid L1Packet", () => {
    const sub = new InMemoryCanonSubstrate()
    sub.seedFact(NOVEL, fact("fact-w1", "World rule one.", { chapter: 0 }))
    sub.seedFact(NOVEL, fact("fact-w2", "World rule two.", { chapter: 0 }))
    sub.seedEntity(NOVEL, entity("aldric", "Aldric", { chapter: 1 }))
    sub.seedCharacterState(NOVEL, characterState("aldric", "Aldric", 2))
    sub.seedStoryPromise(NOVEL, storyPromise("promise-arc", 2))

    const packet = assembleL1(sub, NOVEL, 5, {
      povCharacterId: "aldric",
      charactersPresentIds: [],
      chapterEntityIds: ["aldric"],
    })
    expect(packet.bytes.length).toBeGreaterThan(0)
    expect(packet.packetHash).toMatch(/^[0-9a-f]{64}$/)
    expect(packet.snapshotVersion).toBe(sub.snapshotVersion(NOVEL))
    expect(packet.sections.facts.map((f) => f.id).sort()).toEqual([
      "fact-w1",
      "fact-w2",
    ])
    expect(packet.sections.entities.map((e) => e.id)).toEqual(["aldric"])
    expect(packet.sections.characterStates.map((s) => s.characterId)).toEqual([
      "aldric",
    ])
    expect(packet.sections.activePromises.map((p) => p.id)).toEqual(["promise-arc"])
    expect(packet.tokenCapExceeded).toBe(false)
  })

  test("rejected proposal does not affect the assembled packet", async () => {
    const sub = new InMemoryCanonSubstrate()
    sub.seedFact(NOVEL, fact("fact-real", "Real fact.", { chapter: 0 }))

    // Propose a ghost fact; reject it. The packet should NOT contain it.
    const ghost = await sub.proposeCanonUpdate(
      NOVEL,
      proposalInput(fact("fact-ghost", "Should not appear.", { chapter: 0 })),
    )
    await sub.resolveProposal(ghost.id, "rejected")

    const packet = assembleL1(sub, NOVEL, 5, {
      povCharacterId: "",
      charactersPresentIds: [],
    })
    const ids = packet.sections.facts.map((f) => f.id)
    expect(ids).toContain("fact-real")
    expect(ids).not.toContain("fact-ghost")
  })

  test("packet hash changes after a commit — snapshot is observable to consumers", async () => {
    const sub = new InMemoryCanonSubstrate()
    sub.seedFact(NOVEL, fact("a", "A", { chapter: 0 }))
    const before = assembleL1(sub, NOVEL, 5, {
      povCharacterId: "",
      charactersPresentIds: [],
    })
    sub.seedFact(NOVEL, fact("b", "B", { chapter: 0 }))
    const after = assembleL1(sub, NOVEL, 5, {
      povCharacterId: "",
      charactersPresentIds: [],
    })
    expect(after.packetHash).not.toBe(before.packetHash)
    expect(after.snapshotVersion).not.toBe(before.snapshotVersion)
  })
})
