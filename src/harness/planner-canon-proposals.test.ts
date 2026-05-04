/**
 * Phase 1 — Planner Canon Proposals service tests.
 *
 * Charter: docs/charters/world-bible-architecture.md (Step 1 cleared)
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 1"
 * Lane:    docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-1.md
 *
 * Two tiers:
 *
 *   - **Pure** (`buildPlannerCanonProposals`) — runs always; no DB. Tests the
 *     mechanical gate + per-kind mapping + deterministic id template, since
 *     these are the parts that don't need a database.
 *   - **DB-backed** (`generatePlannerCanonProposals`) — runs only when
 *     Postgres is reachable (`describe.skipIf(!reachable)`). Tests the
 *     idempotent insert path + the no-ghost-canon property end-to-end via
 *     `PostgresCanonSubstrate`.
 *
 * The DB tier is what proves the lane's stop gate (a) — re-running on the
 * same outlines is a 0-row write, and pending proposals never appear in
 * `factsAsOfChapter` reads.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "../db/connection"
import { dbReachable } from "../db/test-helpers"
import * as canonDb from "../db/canon-substrate"
import {
  autogenPlannerProposalsAfterPlanning,
  buildPlannerCanonProposals,
  generatePlannerCanonProposals,
  listPendingPlannerProposals,
  plannerProposalId,
  PLANNER_PROPOSAL_SCHEMA_VERSION,
} from "./planner-canon-proposals"
import { PostgresCanonSubstrate } from "./canon-substrate"
import type { ChapterOutline } from "../types"

const reachable = await dbReachable()

// ── Synthetic outline fixture ───────────────────────────────────────────────
//
// 3-chapter outline with 12 facts + 9 knowledge + 9 state = 30 source items
// total, distributed evenly: 4 facts + 3 knowledge + 3 state per chapter.
// Each item is referenced by exactly one beat obligation so the mechanical
// gate clears cleanly.
//
// IDs follow the pattern `<kind>-c<n>-<i>` (kebab-case, ID_RE-valid). Chapter
// number prefix guarantees uniqueness across chapters.

interface ChapterFixtureOpts {
  factCount?: number
  knowCount?: number
  stateCount?: number
}

function makeChapter(n: number, opts: ChapterFixtureOpts = {}): ChapterOutline {
  const factCount = opts.factCount ?? 4
  const knowCount = opts.knowCount ?? 3
  const stateCount = opts.stateCount ?? 3

  const facts = Array.from({ length: factCount }, (_, i) => ({
    id: `fact-c${n}-f${i + 1}`,
    fact: `Chapter ${n} fact ${i + 1}.`,
    category: "physical",
  }))
  const knowledgeChanges = Array.from({ length: knowCount }, (_, i) => ({
    id: `know-c${n}-k${i + 1}`,
    characterId: `char-actor-c${n}-${i + 1}`,
    characterName: `Actor C${n}-${i + 1}`,
    knowledge: `Chapter ${n} knowledge ${i + 1}.`,
    source: "witnessed",
  }))
  const characterStateChanges = Array.from({ length: stateCount }, (_, i) => ({
    id: `state-c${n}-s${i + 1}`,
    characterId: `char-actor-c${n}-${i + 1}`,
    name: `Actor C${n}-${i + 1}`,
    location: `Setting ${n}.${i + 1}`,
    emotionalState: "calm",
    knows: [],
    doesNotKnow: [],
  }))

  // Single beat carrying all obligations — this is the cleanest fixture
  // shape that satisfies coverage validation without spreading items
  // artificially across multiple beats.
  const coverageBeat = {
    beatId: `ch-${String(n).padStart(3, "0")}-test-beat-001-coverage`,
    description: `Cover all chapter ${n} source items.`,
    characters: [],
    kind: "action" as const,
    requiredPayoffs: [],
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    obligations: {
      mustEstablish: facts.map((f) => ({
        text: `Establish ${f.id}.`,
        sourceId: f.id,
        sourceKind: "fact",
      })),
      mustPayOff: [],
      mustTransferKnowledge: knowledgeChanges.map((k) => ({
        text: `Transfer ${k.id}.`,
        sourceId: k.id,
        sourceKind: "knowledge",
        characterId: k.characterId,
      })),
      mustShowStateChange: characterStateChanges.map((s) => ({
        text: `Show ${s.id}.`,
        sourceId: s.id,
        sourceKind: "state",
        characterId: s.characterId,
      })),
      mustNotReveal: [],
      allowedNewEntities: [],
    },
  }

  return {
    chapterNumber: n,
    title: `Chapter ${n}`,
    povCharacter: "",
    setting: "",
    purpose: `Test chapter ${n}.`,
    targetWords: 1000,
    charactersPresent: [],
    charactersPresentIds: [],
    establishedFacts: facts,
    knowledgeChanges,
    characterStateChanges,
    scenes: [coverageBeat],
  } as unknown as ChapterOutline
}

function makeOutlines(): ChapterOutline[] {
  return [makeChapter(1), makeChapter(2), makeChapter(3)]
}

// ── Pure tier ───────────────────────────────────────────────────────────────

describe("buildPlannerCanonProposals (pure mapping)", () => {
  test("clean 3-chapter outline yields 30 proposals with deterministic ids", () => {
    const novelId = "test-novel-pure-1"
    const result = buildPlannerCanonProposals(novelId, makeOutlines(), {
      createdAt: "2026-05-03T00:00:00Z",
    })

    expect(result.gateClear).toBe(true)
    expect(result.gateReport.summary.idGraphGateClear).toBe(true)
    expect(result.proposals).toHaveLength(30)

    const ids = result.proposals.map((p) => p.id)
    expect(new Set(ids).size).toBe(30)
    for (const id of ids) {
      expect(id.startsWith(`planner:${novelId}:`)).toBe(true)
      expect(id.endsWith(`:${PLANNER_PROPOSAL_SCHEMA_VERSION}`)).toBe(true)
    }
  })

  test("each kind maps to the right CanonFact.kind + ProvenanceSource", () => {
    const novelId = "test-novel-pure-2"
    const { proposals } = buildPlannerCanonProposals(novelId, makeOutlines(), {
      createdAt: "2026-05-03T00:00:00Z",
    })

    const factProposals = proposals.filter(
      (p) => p.proposedFact.kind === "established_fact",
    )
    const knowProposals = proposals.filter(
      (p) => p.proposedFact.kind === "knowledge_change",
    )
    const stateProposals = proposals.filter(
      (p) => p.proposedFact.kind === "character_state",
    )
    expect(factProposals).toHaveLength(12)
    expect(knowProposals).toHaveLength(9)
    expect(stateProposals).toHaveLength(9)

    for (const p of factProposals) {
      expect(p.source).toBe("planner-output")
      expect(p.proposedFact.provenance.source).toBe("planner-output")
      expect(p.proposedFact.provenance.origin).toBe("planned")
      expect(p.proposedFact.data?.["sourceItemKind"]).toBe("fact")
    }
    for (const p of knowProposals) {
      expect(p.source).toBe("planning-state-mapper")
      expect(p.proposedFact.provenance.source).toBe("planning-state-mapper")
      expect(p.proposedFact.data?.["sourceItemKind"]).toBe("knowledge")
      expect(p.proposedFact.data?.["characterId"]).toBeDefined()
      expect(p.proposedFact.data?.["characterName"]).toBeDefined()
    }
    for (const p of stateProposals) {
      expect(p.source).toBe("planning-state-mapper")
      expect(p.proposedFact.provenance.source).toBe("planning-state-mapper")
      expect(p.proposedFact.data?.["sourceItemKind"]).toBe("state")
      expect(p.proposedFact.data?.["characterId"]).toBeDefined()
      expect(p.proposedFact.data?.["characterName"]).toBeDefined()
      // Codex round-1 review of Package A (HIGH 2): state proposals must
      // carry the structured state fields so the committed canon row
      // preserves machine-readable state, not just the audit summary.
      expect(p.proposedFact.data?.["state"]).toBeDefined()
      const state = p.proposedFact.data!["state"] as Record<string, unknown>
      expect(state.location).toBeDefined()
      expect(state.emotionalState).toBe("calm")
    }
  })

  test("provenance carries chapter and extractorVersion from opts", () => {
    const novelId = "test-novel-pure-3"
    const { proposals } = buildPlannerCanonProposals(novelId, makeOutlines(), {
      createdAt: "2026-05-03T00:00:00Z",
      extractorVersion: "planner-test-vX",
    })
    for (const p of proposals) {
      expect(p.proposedFact.provenance.extractorVersion).toBe("planner-test-vX")
      expect([1, 2, 3]).toContain(p.proposedFact.provenance.chapter)
    }
    // Spot-check a chapter-2 fact carries chapter=2.
    const ch2fact = proposals.find(
      (p) => p.proposedFact.id === "fact-c2-f1",
    )
    expect(ch2fact?.proposedFact.provenance.chapter).toBe(2)
  })

  test("status is 'pending' on every built proposal", () => {
    const { proposals } = buildPlannerCanonProposals(
      "test-novel-pure-4",
      makeOutlines(),
    )
    for (const p of proposals) {
      expect(p.status).toBe("pending")
    }
  })

  test("schemaVersion override produces a different id", () => {
    const novelId = "test-novel-pure-5"
    const a = buildPlannerCanonProposals(novelId, [makeChapter(1)], {
      schemaVersion: "v1",
    })
    const b = buildPlannerCanonProposals(novelId, [makeChapter(1)], {
      schemaVersion: "v2",
    })
    const idA = a.proposals[0].id
    const idB = b.proposals[0].id
    expect(idA).not.toBe(idB)
    expect(idA.endsWith(":v1")).toBe(true)
    expect(idB.endsWith(":v2")).toBe(true)
  })

  test("plannerProposalId is the inverse of the deterministic template", () => {
    const id = plannerProposalId("novel-X", "fact-c1-f1", "v1")
    expect(id).toBe("planner:novel-X:fact-c1-f1:v1")
  })

  // ── Mechanical gate fail-closed ──────────────────────────────────────────

  test("duplicate source-item ids → gate fails, NO proposals built", () => {
    const ch1 = makeChapter(1)
    const ch2 = makeChapter(2)
    // Force a duplicate id across chapters.
    ch2.establishedFacts[0].id = ch1.establishedFacts[0].id
    ch2.scenes[0].obligations.mustEstablish[0].sourceId =
      ch1.establishedFacts[0].id

    const result = buildPlannerCanonProposals("test-novel-dup", [ch1, ch2])
    expect(result.gateClear).toBe(false)
    expect(result.proposals).toHaveLength(0)
    expect(result.gateReport.summary.duplicateSourceIdCount).toBeGreaterThan(0)
    expect(result.gateReport.summary.recommendation).toBe("fix-id-graph")
  })

  test("orphan obligation target → gate fails, NO proposals built", () => {
    const ch = makeChapter(1)
    // Drop a fact's obligation but keep the fact — coverage validator flags
    // it as an orphan and validationErrorCount > 0 trips idGraphGateClear.
    ch.scenes[0].obligations.mustEstablish.pop()

    const result = buildPlannerCanonProposals("test-novel-orphan", [ch])
    expect(result.gateClear).toBe(false)
    expect(result.proposals).toHaveLength(0)
    expect(result.gateReport.summary.validationErrorCount).toBeGreaterThan(0)
  })

  test("empty outlines → gate fails (insufficient artifact)", () => {
    const result = buildPlannerCanonProposals("test-novel-empty", [])
    expect(result.gateClear).toBe(false)
    expect(result.proposals).toHaveLength(0)
    expect(result.gateReport.summary.recommendation).toBe(
      "insufficient-artifact",
    )
  })
})

// ── DB-backed tier ──────────────────────────────────────────────────────────

describe.skipIf(!reachable)("generatePlannerCanonProposals (DB-backed)", () => {
  let novelId: string

  beforeEach(() => {
    novelId = `test-planner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  })

  afterEach(async () => {
    await canonDb.deleteAllForNovel(novelId)
  })

  test("first run inserts all 30 proposals; second run is a 0-row no-op", async () => {
    const outlines = makeOutlines()
    const first = await generatePlannerCanonProposals(novelId, outlines, {
      createdAt: "2026-05-03T00:00:00Z",
    })
    expect(first.gateClear).toBe(true)
    expect(first.created).toHaveLength(30)
    expect(first.skipped).toHaveLength(0)

    const second = await generatePlannerCanonProposals(novelId, outlines, {
      createdAt: "2026-05-03T00:00:00Z",
    })
    expect(second.gateClear).toBe(true)
    expect(second.created).toHaveLength(0)
    expect(second.skipped).toHaveLength(30)

    // The DB row count is exactly 30, not 60.
    const rowCount = (await db`
      SELECT COUNT(*)::int AS c FROM canon_proposals WHERE novel_id = ${novelId}
    `) as Array<{ c: number }>
    expect(rowCount[0].c).toBe(30)
  })

  test("no-ghost-canon: pending proposals are absent from factsAsOfChapter", async () => {
    const outlines = makeOutlines()
    const result = await generatePlannerCanonProposals(novelId, outlines)
    expect(result.created).toHaveLength(30)

    const sub = new PostgresCanonSubstrate()
    for (const chapterN of [1, 2, 3]) {
      await sub.loadSnapshot(novelId, chapterN)
      expect(sub.factsAsOfChapter(novelId, chapterN)).toEqual([])
      expect(sub.entitiesAsOfChapter(novelId, chapterN)).toEqual([])
      expect(sub.characterStatesAsOfChapter(novelId, chapterN)).toEqual([])
      expect(sub.promisesAsOfChapter(novelId, chapterN)).toEqual([])
    }
  })

  test("listPendingPlannerProposals returns all 30 after generate", async () => {
    await generatePlannerCanonProposals(novelId, makeOutlines())
    const pending = await listPendingPlannerProposals(novelId)
    expect(pending).toHaveLength(30)
    for (const p of pending) {
      expect(p.id.startsWith(`planner:${novelId}:`)).toBe(true)
      expect(p.status).toBe("pending")
    }
  })

  test("approving a planner proposal → committed canon includes the fact", async () => {
    const outlines = makeOutlines()
    const result = await generatePlannerCanonProposals(novelId, outlines)
    const targetId = plannerProposalId(novelId, "fact-c2-f1")
    const target = result.created.find((p) => p.id === targetId)
    expect(target).toBeDefined()

    const sub = new PostgresCanonSubstrate()
    const { committedFact } = await sub.resolveProposal(targetId, "approved")
    expect(committedFact?.id).toBe("fact-c2-f1")
    expect(committedFact?.kind).toBe("established_fact")
    expect(committedFact?.provenance.approvalStatus).toBe("human-approved")

    await sub.loadSnapshot(novelId, 2)
    const visible = sub.factsAsOfChapter(novelId, 2).map((f) => f.id)
    expect(visible).toContain("fact-c2-f1")

    // The 29 not-yet-resolved proposals are still pending and still NOT in
    // canon reads at chapter 3.
    await sub.loadSnapshot(novelId, 3)
    const at3 = sub.factsAsOfChapter(novelId, 3).map((f) => f.id)
    expect(at3).toEqual(["fact-c2-f1"])
    const stillPending = await listPendingPlannerProposals(novelId)
    expect(stillPending).toHaveLength(29)
  })

  test("approving a state proposal → committed canon row preserves structured data.state (Codex Package A HIGH 2)", async () => {
    const outlines = makeOutlines()
    await generatePlannerCanonProposals(novelId, outlines)
    const stateTargetId = plannerProposalId(novelId, "state-c1-s1")

    const sub = new PostgresCanonSubstrate()
    const { committedFact } = await sub.resolveProposal(stateTargetId, "approved")
    expect(committedFact?.id).toBe("state-c1-s1")
    expect(committedFact?.kind).toBe("character_state")

    // The structured state fields must survive the planner→proposal→canon
    // pipeline so downstream consumers can reconstruct deterministic
    // character state from canon alone (not the summarized text).
    const data = committedFact?.data as Record<string, unknown> | undefined
    expect(data).toBeDefined()
    expect(data?.["state"]).toBeDefined()
    const state = data!["state"] as Record<string, unknown>
    expect(state.location).toBe("Setting 1.1")
    expect(state.emotionalState).toBe("calm")
    expect(state.characterId).toBeUndefined() // characterId lives at data level, not under state
    expect(data?.["characterId"]).toBe("char-actor-c1-1")
    expect(data?.["characterName"]).toBe("Actor C1-1")
  })

  test("rejecting a planner proposal → canon stays clean; rejected row not pending", async () => {
    const outlines = makeOutlines()
    await generatePlannerCanonProposals(novelId, outlines)
    const targetId = plannerProposalId(novelId, "know-c1-k1")

    const sub = new PostgresCanonSubstrate()
    await sub.resolveProposal(targetId, "rejected", { operatorNote: "no" })

    await sub.loadSnapshot(novelId, 1)
    expect(sub.factsAsOfChapter(novelId, 1)).toEqual([])
    const stillPending = await listPendingPlannerProposals(novelId)
    expect(stillPending).toHaveLength(29)
    expect(stillPending.map((p) => p.id)).not.toContain(targetId)
  })

  test("rejected proposal stays rejected on rerun (operator's no survives)", async () => {
    const outlines = makeOutlines()
    await generatePlannerCanonProposals(novelId, outlines)
    const targetId = plannerProposalId(novelId, "state-c3-s1")
    const sub = new PostgresCanonSubstrate()
    await sub.resolveProposal(targetId, "rejected")

    // Rerun the service. The rejected proposal is in `skipped` (already
    // exists with a non-pending status).
    const second = await generatePlannerCanonProposals(novelId, outlines)
    expect(second.skipped.map((s) => s.proposalId)).toContain(targetId)

    const rejectedRow = await canonDb.findProposal(targetId)
    expect(rejectedRow?.status).toBe("rejected")
  })

  test("gate failure → no proposals written; canon_proposals stays empty", async () => {
    const ch1 = makeChapter(1)
    const ch2 = makeChapter(2)
    ch2.establishedFacts[0].id = ch1.establishedFacts[0].id
    ch2.scenes[0].obligations.mustEstablish[0].sourceId =
      ch1.establishedFacts[0].id

    const result = await generatePlannerCanonProposals(novelId, [ch1, ch2])
    expect(result.gateClear).toBe(false)
    expect(result.created).toHaveLength(0)

    const rows = (await db`
      SELECT COUNT(*)::int AS c FROM canon_proposals WHERE novel_id = ${novelId}
    `) as Array<{ c: number }>
    expect(rows[0].c).toBe(0)
  })

  test("two novels with overlapping source-item ids get distinct proposal ids", async () => {
    const novelA = `${novelId}-A`
    const novelB = `${novelId}-B`
    try {
      const outlines = makeOutlines()
      const a = await generatePlannerCanonProposals(novelA, outlines)
      const b = await generatePlannerCanonProposals(novelB, outlines)
      expect(a.created).toHaveLength(30)
      expect(b.created).toHaveLength(30)
      const idsA = new Set(a.created.map((p) => p.id))
      const idsB = new Set(b.created.map((p) => p.id))
      // Disjoint id sets — novelId is part of the deterministic id.
      for (const id of idsA) expect(idsB.has(id)).toBe(false)
    } finally {
      await canonDb.deleteAllForNovel(novelA)
      await canonDb.deleteAllForNovel(novelB)
    }
  })

  test("approve then rerun: approved proposal stays approved (idempotency respects committed canon)", async () => {
    const outlines = makeOutlines()
    await generatePlannerCanonProposals(novelId, outlines)
    const targetId = plannerProposalId(novelId, "fact-c1-f2")
    const sub = new PostgresCanonSubstrate()
    await sub.resolveProposal(targetId, "approved")

    // Rerun. The approved proposal should be in `skipped` — its id already
    // exists in canon_proposals (status="approved"), and ON CONFLICT DO
    // NOTHING refuses to re-insert.
    const second = await generatePlannerCanonProposals(novelId, outlines)
    expect(second.skipped.map((s) => s.proposalId)).toContain(targetId)

    // The committed canon row for fact-c1-f2 is still visible at chapter 1.
    await sub.loadSnapshot(novelId, 1)
    const ids = sub.factsAsOfChapter(novelId, 1).map((f) => f.id)
    expect(ids).toContain("fact-c1-f2")
  })

  // ── autogenPlannerProposalsAfterPlanning (Phase 1.5 pipeline auto-wire) ──

  test("autogenPlannerProposalsAfterPlanning returns counts and never throws on clean gate", async () => {
    const outlines = makeOutlines()
    const result = await autogenPlannerProposalsAfterPlanning(novelId, outlines)
    expect(result.error).toBeNull()
    expect(result.gateClear).toBe(true)
    expect(result.created).toBe(30)
    expect(result.skipped).toBe(0)

    // Idempotent: rerun produces 0 created.
    const second = await autogenPlannerProposalsAfterPlanning(novelId, outlines)
    expect(second.error).toBeNull()
    expect(second.gateClear).toBe(true)
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(30)
  })

  test("autogenPlannerProposalsAfterPlanning returns gateClear=false on broken graph (does not throw)", async () => {
    const ch1 = makeChapter(1)
    const ch2 = makeChapter(2)
    ch2.establishedFacts[0].id = ch1.establishedFacts[0].id
    ch2.scenes[0].obligations.mustEstablish[0].sourceId =
      ch1.establishedFacts[0].id

    const result = await autogenPlannerProposalsAfterPlanning(novelId, [ch1, ch2])
    expect(result.error).toBeNull()
    expect(result.gateClear).toBe(false)
    expect(result.created).toBe(0)
  })

  test("autogenPlannerProposalsAfterPlanning short-circuits empty outlines", async () => {
    const result = await autogenPlannerProposalsAfterPlanning(novelId, [])
    expect(result.error).toBe("no outlines")
    expect(result.gateClear).toBe(false)
    expect(result.created).toBe(0)
  })

  // Atomicity (Codex round-1 acf67c2/b967c69 HIGH 1) is verified in the
  // standalone file `planner-canon-proposals-atomicity.test.ts` — that
  // file mocks `../db/canon-substrate` to force a mid-batch insert
  // failure and asserts the entire batch rolls back. Mocking happens at
  // the module level, so it lives in its own file to avoid polluting
  // other tests in this suite.

  test("buildPlannerCanonProposals throw (programmer bug) propagates from autogen helper (Codex MEDIUM 1)", async () => {
    // Per Codex MEDIUM 1 finding: programmer bugs in the audit/mapping
    // path must NOT be silently demoted to a warning. Simulate by passing
    // a malformed outline shape so the audit's schema validation throws.
    const malformedOutlines = [
      { not_a_chapter: true } as unknown,
    ] as unknown as Parameters<typeof autogenPlannerProposalsAfterPlanning>[1]
    let thrown: unknown
    try {
      await autogenPlannerProposalsAfterPlanning(novelId, malformedOutlines)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
  })
})
