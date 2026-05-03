/**
 * Adapter-equivalence test suite for `CanonSubstrate`.
 *
 * Charter: docs/charters/world-bible-architecture.md §1
 * Lane:    docs/sessions/2026-05-03-canon-substrate-postgres-adapter.md
 *
 * Same behavioral spec runs against both:
 *   - `InMemoryCanonSubstrate` (src/canon/substrate.ts), and
 *   - `PostgresCanonSubstrate` (src/harness/canon-substrate.ts) when the DB
 *     is reachable.
 *
 * Charter §1 stop gate: the property "`getCanonForChapter(N)` returns what was
 * canonical at the time chapter N was written, regardless of subsequent edits"
 * must hold under both adapters. The Postgres branch skips via
 * `describe.skipIf(!reachable)` when Postgres is unconfigured, mirroring the
 * pattern in `src/db/chapter-exhaustions.test.ts`. A passing run on both
 * adapters is what flips charter §1 from "seam cleared" to formally cleared.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "../db/connection"
import { dbReachable } from "../db/test-helpers"
import { deleteAllForNovel } from "../db/canon-substrate"
import { InMemoryCanonSubstrate } from "./substrate"
import { PostgresCanonSubstrate } from "../harness/canon-substrate"
import { assembleL1 } from "./bundle"
import type {
  ApprovalStatus,
  CanonFact,
  CharacterState,
  Entity,
  Provenance,
  StoryPromise,
} from "./api"
import type { CanonSubstrate, ProposalInput } from "./substrate"

const reachable = await dbReachable()

// ── Shared fixture builders ──────────────────────────────────────────────────

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

// ── Test harness wrapper: unifies sync in-memory + async Postgres APIs ──────

interface Harness {
  sub: CanonSubstrate
  loadSnapshot(novelId: string, chapterN: number): Promise<void>
  seedFact(novelId: string, f: CanonFact): Promise<void>
  seedEntity(novelId: string, e: Entity): Promise<void>
  seedCharacterState(novelId: string, s: CharacterState): Promise<void>
  seedStoryPromise(novelId: string, p: StoryPromise): Promise<void>
  cleanup(novelId: string): Promise<void>
}

function makeInMemoryHarness(): Harness {
  const sub = new InMemoryCanonSubstrate()
  return {
    sub,
    loadSnapshot: async () => {
      // No-op: in-memory adapter is "always loaded".
    },
    seedFact: async (novelId, f) => sub.seedFact(novelId, f),
    seedEntity: async (novelId, e) => sub.seedEntity(novelId, e),
    seedCharacterState: async (novelId, s) => sub.seedCharacterState(novelId, s),
    seedStoryPromise: async (novelId, p) => sub.seedStoryPromise(novelId, p),
    cleanup: async () => {
      // No persistent state to clean.
    },
  }
}

function makePostgresHarness(): Harness {
  const sub = new PostgresCanonSubstrate()
  return {
    sub,
    loadSnapshot: (novelId, chapterN) => sub.loadSnapshot(novelId, chapterN),
    seedFact: (novelId, f) => sub.seedFact(novelId, f),
    seedEntity: (novelId, e) => sub.seedEntity(novelId, e),
    seedCharacterState: (novelId, s) => sub.seedCharacterState(novelId, s),
    seedStoryPromise: (novelId, p) => sub.seedStoryPromise(novelId, p),
    cleanup: (novelId) => deleteAllForNovel(novelId),
  }
}

// ── Behavioral spec — runs against any adapter that satisfies Harness ───────

function runCanonSubstrateSpec(label: string, makeHarness: () => Harness): void {
  describe(`CanonSubstrate equivalence — ${label}`, () => {
    let harness: Harness
    let novelId: string

    beforeEach(async () => {
      harness = makeHarness()
      novelId = `test-canon-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    })

    afterEach(async () => {
      await harness.cleanup(novelId)
    })

    // ── No-ghost-canon ─────────────────────────────────────────────────────

    test("propose without committing — fact NOT visible", async () => {
      const newFact = fact("fact-magic-burns", "Magic burns.", { chapter: 3 })
      await harness.sub.proposeCanonUpdate(novelId, proposalInput(newFact))
      await harness.loadSnapshot(novelId, 5)
      expect(harness.sub.factsAsOfChapter(novelId, 5)).toEqual([])
    })

    test("propose then reject — fact NOT visible after rejection", async () => {
      const newFact = fact("fact-bogus", "Pretend.", { chapter: 3 })
      const proposal = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(newFact),
      )
      await harness.sub.resolveProposal(proposal.id, "rejected", {
        operatorNote: "wrong",
      })
      await harness.loadSnapshot(novelId, 5)
      expect(harness.sub.factsAsOfChapter(novelId, 5)).toEqual([])
      expect(harness.sub.snapshotVersion(novelId)).not.toBe(`${novelId}@0`)
    })

    test("propose then approve — fact IS visible after approval", async () => {
      const newFact = fact("fact-real", "Real.", { chapter: 3 })
      const proposal = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(newFact),
      )
      const result = await harness.sub.resolveProposal(proposal.id, "approved")
      expect(result.committedFact?.id).toBe("fact-real")
      expect(result.committedFact?.provenance.approvalStatus).toBe("human-approved")
      await harness.loadSnapshot(novelId, 5)
      const visible = harness.sub.factsAsOfChapter(novelId, 5)
      expect(visible).toHaveLength(1)
      expect(visible[0].id).toBe("fact-real")
    })

    test("listPendingProposals returns pending only", async () => {
      const a = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(fact("a", "A", { chapter: 1 })),
      )
      const b = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(fact("b", "B", { chapter: 1 })),
      )
      const c = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(fact("c", "C", { chapter: 1 })),
      )
      await harness.sub.resolveProposal(a.id, "approved")
      await harness.sub.resolveProposal(b.id, "rejected")
      const pending = await harness.sub.listPendingProposals(novelId)
      expect(pending.map((p) => p.id)).toEqual([c.id])
    })

    // ── Approval-status filter (no-ghost at the seed boundary) ─────────────

    test("seedFact rejects auto-extracted (would be ghost canon)", async () => {
      await expect(
        harness.seedFact(
          novelId,
          fact("f", "x", { approvalStatus: "auto-extracted" }),
        ),
      ).rejects.toThrow(/no ghost canon/i)
    })

    test("seedFact rejects contested", async () => {
      await expect(
        harness.seedFact(novelId, fact("f", "x", { approvalStatus: "contested" })),
      ).rejects.toThrow(/no ghost canon/i)
    })

    test("seedFact rejects rejected", async () => {
      await expect(
        harness.seedFact(novelId, fact("f", "x", { approvalStatus: "rejected" })),
      ).rejects.toThrow(/no ghost canon/i)
    })

    test("seedFact accepts human-approved and human-edited", async () => {
      await harness.seedFact(
        novelId,
        fact("a", "A", { approvalStatus: "human-approved" }),
      )
      await harness.seedFact(
        novelId,
        fact("b", "B", { approvalStatus: "human-edited" }),
      )
      await harness.loadSnapshot(novelId, 5)
      expect(harness.sub.factsAsOfChapter(novelId, 5)).toHaveLength(2)
    })

    test("seedCharacterState rejects non-committed approval", async () => {
      await expect(
        harness.seedCharacterState(
          novelId,
          characterState("aldric", "Aldric", 3, "auto-extracted"),
        ),
      ).rejects.toThrow(/no ghost canon/i)
    })

    test("seedStoryPromise rejects non-committed approval", async () => {
      await expect(
        harness.seedStoryPromise(
          novelId,
          storyPromise("promise-x", 2, "contested"),
        ),
      ).rejects.toThrow(/no ghost canon/i)
    })

    // ── Point-in-time snapshot semantics ───────────────────────────────────

    test("future commits are NOT visible in earlier-chapter snapshots", async () => {
      await harness.seedFact(
        novelId,
        fact("fact-ch1", "ch1.", { chapter: 1 }),
      )
      await harness.seedFact(
        novelId,
        fact("fact-ch5", "ch5.", { chapter: 5 }),
      )
      await harness.loadSnapshot(novelId, 3)
      expect(harness.sub.factsAsOfChapter(novelId, 3).map((f) => f.id)).toEqual([
        "fact-ch1",
      ])
      await harness.loadSnapshot(novelId, 7)
      expect(
        harness.sub.factsAsOfChapter(novelId, 7).map((f) => f.id).sort(),
      ).toEqual(["fact-ch1", "fact-ch5"])
    })

    test("supersession via seed: chapter-3 read sees v1; chapter-7 read sees v2", async () => {
      await harness.seedFact(
        novelId,
        fact("logical-x", "Original", { chapter: 3 }),
      )
      await harness.seedFact(
        novelId,
        fact("logical-x", "Corrected", { chapter: 6 }),
      )

      await harness.loadSnapshot(novelId, 3)
      const at3 = harness.sub.factsAsOfChapter(novelId, 3)
      expect(at3).toHaveLength(1)
      expect(at3[0].text).toBe("Original")

      await harness.loadSnapshot(novelId, 5)
      const at5 = harness.sub.factsAsOfChapter(novelId, 5)
      expect(at5).toHaveLength(1)
      expect(at5[0].text).toBe("Original")

      await harness.loadSnapshot(novelId, 8)
      const at8 = harness.sub.factsAsOfChapter(novelId, 8)
      expect(at8).toHaveLength(1)
      expect(at8[0].text).toBe("Corrected")
    })

    test("supersession via resolveProposal: corrects an existing fact", async () => {
      await harness.seedFact(
        novelId,
        fact("logical-y", "v1", { chapter: 2 }),
      )
      const correction = fact("logical-y", "v2", { chapter: 5 })
      const proposal = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(correction, "logical-y"),
      )
      await harness.sub.resolveProposal(proposal.id, "approved")

      await harness.loadSnapshot(novelId, 4)
      expect(harness.sub.factsAsOfChapter(novelId, 4)[0].text).toBe("v1")
      await harness.loadSnapshot(novelId, 6)
      expect(harness.sub.factsAsOfChapter(novelId, 6)[0].text).toBe("v2")
    })

    test("snapshotVersion bumps on every commit and on rejection", async () => {
      await harness.loadSnapshot(novelId, 1)
      const v0 = harness.sub.snapshotVersion(novelId)
      await harness.seedFact(novelId, fact("a", "A", { chapter: 1 }))
      await harness.loadSnapshot(novelId, 1)
      const v1 = harness.sub.snapshotVersion(novelId)
      expect(v1).not.toBe(v0)

      const proposal = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(fact("b", "B", { chapter: 1 })),
      )
      // Pending proposal does NOT bump generation.
      await harness.loadSnapshot(novelId, 1)
      expect(harness.sub.snapshotVersion(novelId)).toBe(v1)

      await harness.sub.resolveProposal(proposal.id, "rejected")
      await harness.loadSnapshot(novelId, 1)
      const v2 = harness.sub.snapshotVersion(novelId)
      expect(v2).not.toBe(v1)
    })

    // ── CharacterState + StoryPromise no-ghost ─────────────────────────────

    test("approved CharacterState appears at and after asOfChapter; latest-snapshot semantic", async () => {
      await harness.seedCharacterState(
        novelId,
        characterState("aldric", "Aldric", 1),
      )
      await harness.seedCharacterState(
        novelId,
        characterState("aldric", "Aldric", 4),
      )
      await harness.seedCharacterState(
        novelId,
        characterState("aldric", "Aldric", 7),
      )

      await harness.loadSnapshot(novelId, 2)
      const at2 = harness.sub.characterStatesAsOfChapter(novelId, 2)
      expect(at2).toHaveLength(1)
      expect(at2[0].asOfChapter).toBe(1)

      await harness.loadSnapshot(novelId, 5)
      const at5 = harness.sub.characterStatesAsOfChapter(novelId, 5)
      expect(at5).toHaveLength(1)
      expect(at5[0].asOfChapter).toBe(4)

      await harness.loadSnapshot(novelId, 8)
      const at8 = harness.sub.characterStatesAsOfChapter(novelId, 8)
      expect(at8).toHaveLength(1)
      expect(at8[0].asOfChapter).toBe(7)
    })

    test("approved StoryPromise becomes visible at setupChapter onward", async () => {
      await harness.seedStoryPromise(novelId, storyPromise("promise-arc", 3))
      await harness.loadSnapshot(novelId, 2)
      expect(harness.sub.promisesAsOfChapter(novelId, 2)).toHaveLength(0)
      await harness.loadSnapshot(novelId, 5)
      expect(harness.sub.promisesAsOfChapter(novelId, 5)).toHaveLength(1)
    })

    // ── Adapter satisfies bundle.ts CanonSource ────────────────────────────

    test("assembleL1 against the substrate produces a valid L1Packet", async () => {
      await harness.seedFact(
        novelId,
        fact("fact-w1", "World rule one.", { chapter: 0 }),
      )
      await harness.seedFact(
        novelId,
        fact("fact-w2", "World rule two.", { chapter: 0 }),
      )
      await harness.seedEntity(
        novelId,
        entity("aldric", "Aldric", { chapter: 1 }),
      )
      await harness.seedCharacterState(
        novelId,
        characterState("aldric", "Aldric", 2),
      )
      await harness.seedStoryPromise(novelId, storyPromise("promise-arc", 2))

      await harness.loadSnapshot(novelId, 5)
      const packet = assembleL1(harness.sub, novelId, 5, {
        povCharacterId: "aldric",
        charactersPresentIds: [],
        chapterEntityIds: ["aldric"],
      })
      expect(packet.bytes.length).toBeGreaterThan(0)
      expect(packet.packetHash).toMatch(/^[0-9a-f]{64}$/)
      expect(packet.snapshotVersion).toBe(harness.sub.snapshotVersion(novelId))
      expect(packet.sections.facts.map((f) => f.id).sort()).toEqual([
        "fact-w1",
        "fact-w2",
      ])
      expect(packet.sections.entities.map((e) => e.id)).toEqual(["aldric"])
      expect(packet.sections.characterStates.map((s) => s.characterId)).toEqual([
        "aldric",
      ])
      expect(packet.sections.activePromises.map((p) => p.id)).toEqual([
        "promise-arc",
      ])
    })

    test("rejected proposal does not affect the assembled packet", async () => {
      await harness.seedFact(
        novelId,
        fact("fact-real", "Real.", { chapter: 0 }),
      )
      const ghost = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(fact("fact-ghost", "ghost.", { chapter: 0 })),
      )
      await harness.sub.resolveProposal(ghost.id, "rejected")

      await harness.loadSnapshot(novelId, 5)
      const packet = assembleL1(harness.sub, novelId, 5, {
        povCharacterId: "",
        charactersPresentIds: [],
      })
      const ids = packet.sections.facts.map((f) => f.id)
      expect(ids).toContain("fact-real")
      expect(ids).not.toContain("fact-ghost")
    })

    // ── Modified-resolution normalization (Codex H1 regression) ────────────

    test("status='modified' without modifiedFact throws and does NOT mutate proposal", async () => {
      const proposal = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(fact("logical-x", "v1", { chapter: 3 })),
      )
      await expect(
        harness.sub.resolveProposal(proposal.id, "modified"),
      ).rejects.toThrow(/requires opts\.modifiedFact/)
      const pending = await harness.sub.listPendingProposals(novelId)
      expect(pending.map((p) => p.id)).toContain(proposal.id)
    })

    test("modified path normalizes provenance: forced approvalStatus=human-edited, fresh timestamps", async () => {
      const proposed = fact("logical-y", "operator-original", { chapter: 4 })
      const proposal = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(proposed),
      )
      const sneaky: CanonFact = {
        ...proposed,
        text: "operator-modified",
        provenance: {
          ...proposed.provenance,
          approvalStatus: "contested",
          createdAt: "1999-01-01T00:00:00Z",
          updatedAt: "1999-01-01T00:00:00Z",
        },
      }
      const result = await harness.sub.resolveProposal(proposal.id, "modified", {
        modifiedFact: sneaky,
      })
      expect(result.committedFact?.provenance.approvalStatus).toBe(
        "human-edited",
      )
      expect(result.committedFact?.provenance.createdAt).not.toBe(
        "1999-01-01T00:00:00Z",
      )
      expect(result.committedFact?.provenance.updatedAt).not.toBe(
        "1999-01-01T00:00:00Z",
      )
      expect(result.committedFact?.text).toBe("operator-modified")
    })

    test("modified path normalizes supersedes from proposal.targetFactId", async () => {
      await harness.seedFact(
        novelId,
        fact("logical-z", "original", { chapter: 1 }),
      )
      const proposal = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(fact("logical-z", "edited", { chapter: 5 }), "logical-z"),
      )
      const modifiedFact = fact("logical-z", "edited-and-modified", {
        chapter: 5,
      })
      const result = await harness.sub.resolveProposal(proposal.id, "modified", {
        modifiedFact,
      })
      expect(result.committedFact?.provenance.supersedes).toBe("logical-z")
    })

    test("modified path persists committed canon's edited body", async () => {
      const proposed = fact("logical-w", "v1", { chapter: 2 })
      const proposal = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(proposed),
      )
      const operatorEdit: CanonFact = { ...proposed, text: "operator-touched" }
      await harness.sub.resolveProposal(proposal.id, "modified", {
        modifiedFact: operatorEdit,
      })
      const allProposals = await harness.sub.listPendingProposals(novelId)
      expect(allProposals).toHaveLength(0)
      await harness.loadSnapshot(novelId, 5)
      const facts = harness.sub.factsAsOfChapter(novelId, 5)
      expect(facts.find((f) => f.id === "logical-w")?.text).toBe(
        "operator-touched",
      )
    })

    // ── Supersession invariant (Codex H2) ──────────────────────────────────

    test("cross-id supersession also closes the new id's prior active version", async () => {
      await harness.seedFact(novelId, fact("fact-x", "x-v1", { chapter: 1 }))
      await harness.seedFact(novelId, fact("fact-y", "y-v1", { chapter: 2 }))
      const proposal = await harness.sub.proposeCanonUpdate(
        novelId,
        proposalInput(fact("fact-y", "y-v2", { chapter: 5 }), "fact-x"),
      )
      await harness.sub.resolveProposal(proposal.id, "approved")
      await harness.loadSnapshot(novelId, 6)
      const at6 = harness.sub.factsAsOfChapter(novelId, 6)
      expect(at6).toHaveLength(1)
      expect(at6[0].id).toBe("fact-y")
      expect(at6[0].text).toBe("y-v2")
    })

    test("same-chapter replacement: later commit at the same chapter wins", async () => {
      await harness.seedFact(novelId, fact("fact-q", "first", { chapter: 3 }))
      await harness.seedFact(novelId, fact("fact-q", "second", { chapter: 3 }))
      await harness.loadSnapshot(novelId, 3)
      const at3 = harness.sub.factsAsOfChapter(novelId, 3)
      expect(at3).toHaveLength(1)
      expect(at3[0].text).toBe("second")
    })

    // ── Read-shape cleanliness (Codex M1) ──────────────────────────────────

    test("returned CanonFact does NOT carry committedAtChapter or supersededAtChapter", async () => {
      await harness.seedFact(novelId, fact("fact-clean", "clean.", { chapter: 1 }))
      await harness.loadSnapshot(novelId, 5)
      const out = harness.sub.factsAsOfChapter(novelId, 5)
      expect(out).toHaveLength(1)
      const r = out[0] as unknown as Record<string, unknown>
      expect(Object.hasOwn(r, "committedAtChapter")).toBe(false)
      expect(Object.hasOwn(r, "supersededAtChapter")).toBe(false)
    })

    test("returned Entity has no internal commit fields", async () => {
      await harness.seedEntity(novelId, entity("e1", "Entity One", { chapter: 1 }))
      await harness.loadSnapshot(novelId, 5)
      const out = harness.sub.entitiesAsOfChapter(novelId, 5)
      const r = out[0] as unknown as Record<string, unknown>
      expect(Object.hasOwn(r, "committedAtChapter")).toBe(false)
      expect(Object.hasOwn(r, "supersededAtChapter")).toBe(false)
    })

    test("returned CharacterState has no internal commit fields", async () => {
      await harness.seedCharacterState(novelId, characterState("c1", "Char One", 1))
      await harness.loadSnapshot(novelId, 5)
      const out = harness.sub.characterStatesAsOfChapter(novelId, 5)
      const r = out[0] as unknown as Record<string, unknown>
      expect(Object.hasOwn(r, "committedAtChapter")).toBe(false)
      expect(Object.hasOwn(r, "supersededAtChapter")).toBe(false)
    })

    test("returned StoryPromise has no internal commit fields", async () => {
      await harness.seedStoryPromise(novelId, storyPromise("p1", 1))
      await harness.loadSnapshot(novelId, 5)
      const out = harness.sub.promisesAsOfChapter(novelId, 5)
      const r = out[0] as unknown as Record<string, unknown>
      expect(Object.hasOwn(r, "committedAtChapter")).toBe(false)
      expect(Object.hasOwn(r, "supersededAtChapter")).toBe(false)
    })
  })
}

// ── Run the spec twice ───────────────────────────────────────────────────────

runCanonSubstrateSpec("InMemory", makeInMemoryHarness)

describe.skipIf(!reachable)("PostgresCanonSubstrate (DB-backed)", () => {
  // Sanity probe: the canon_facts table exists. If migrations haven't been
  // applied to the local DB, this test reports the issue clearly rather than
  // the whole suite failing on `relation does not exist`.
  test("canon substrate tables are present", async () => {
    const rows = (await db`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'canon_facts', 'canon_entities', 'canon_character_states',
          'canon_promises', 'canon_proposals', 'canon_snapshot_meta'
        )
    `) as Array<{ table_name: string }>
    const names = new Set(rows.map((r) => r.table_name))
    expect(names.size).toBe(6)
  })

  // Postgres-only: snapshot-not-loaded throws.
  test("sync read for unloaded snapshot throws (snapshot-not-loaded contract)", () => {
    const sub = new PostgresCanonSubstrate()
    expect(() =>
      sub.factsAsOfChapter(`unloaded-novel-${Date.now()}`, 5),
    ).toThrow(/snapshot not loaded/i)
  })

  test("sync read works after explicit loadSnapshot", async () => {
    const sub = new PostgresCanonSubstrate()
    const novelId = `pg-loaded-${Date.now()}`
    try {
      await sub.seedFact(novelId, fact("a", "A", { chapter: 1 }))
      await sub.loadSnapshot(novelId, 5)
      const facts = sub.factsAsOfChapter(novelId, 5)
      expect(facts).toHaveLength(1)
      expect(facts[0].id).toBe("a")
    } finally {
      await deleteAllForNovel(novelId)
    }
  })
})

// Run the full spec against Postgres only when the DB is reachable.
if (reachable) {
  runCanonSubstrateSpec("Postgres", makePostgresHarness)
}
