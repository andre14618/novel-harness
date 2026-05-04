/**
 * Phase 2A.5 — proposal lifecycle telemetry tests.
 *
 * Charter: docs/charters/world-bible-architecture.md (§1 cleared)
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 2 — ... telemetry events"
 * Lane:    docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-2a-telemetry.md
 *
 * Verifies that proposal-lifecycle events land in `pipeline_events` with the
 * right `event_type` and payload shape:
 *
 *   - canon-proposal-create               — per proposal inserted
 *   - canon-proposal-resolve              — per resolution (approve/reject/modified)
 *   - canon-proposal-generate-summary     — single per generate-from-outline run
 *
 * DB-backed only — `trace()` writes to `pipeline_events` and there's no
 * meaningful in-memory equivalent.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import db from "../db/connection"
import { dbReachable } from "../db/test-helpers"
import * as canonDb from "../db/canon-substrate"
import {
  generatePlannerCanonProposals,
  plannerProposalId,
} from "./planner-canon-proposals"
import { PostgresCanonSubstrate } from "./canon-substrate"
import type { ChapterOutline } from "../types"

const reachable = await dbReachable()

// Reuse the Phase-1 fixture shape — kept inline to avoid a fragile cross-file
// import (the fixture's correctness is asserted in the Phase-1 tests).
function makeChapter(n: number): ChapterOutline {
  const facts = Array.from({ length: 4 }, (_, i) => ({
    id: `fact-c${n}-f${i + 1}`,
    fact: `Chapter ${n} fact ${i + 1}.`,
    category: "physical",
  }))
  const knowledgeChanges = Array.from({ length: 3 }, (_, i) => ({
    id: `know-c${n}-k${i + 1}`,
    characterId: `char-actor-c${n}-${i + 1}`,
    characterName: `Actor C${n}-${i + 1}`,
    knowledge: `Chapter ${n} knowledge ${i + 1}.`,
    source: "witnessed",
  }))
  const characterStateChanges = Array.from({ length: 3 }, (_, i) => ({
    id: `state-c${n}-s${i + 1}`,
    characterId: `char-actor-c${n}-${i + 1}`,
    name: `Actor C${n}-${i + 1}`,
    location: `Setting ${n}.${i + 1}`,
    emotionalState: "calm",
    knows: [],
    doesNotKnow: [],
  }))
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
    scenes: [
      {
        beatId: `ch-${String(n).padStart(3, "0")}-test-beat-001-coverage`,
        description: `Cover all chapter ${n} source items.`,
        characters: [],
        kind: "action",
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
      },
    ],
  } as unknown as ChapterOutline
}

async function readEvents(
  novelId: string,
  eventType?: string,
): Promise<Array<{ event_type: string; agent: string | null; chapter: number | null; payload: any }>> {
  if (eventType) {
    return (await db`
      SELECT event_type, agent, chapter, payload
      FROM pipeline_events
      WHERE novel_id = ${novelId} AND event_type = ${eventType}
      ORDER BY id
    `) as any
  }
  return (await db`
    SELECT event_type, agent, chapter, payload
    FROM pipeline_events
    WHERE novel_id = ${novelId}
    ORDER BY id
  `) as any
}

async function deleteEvents(novelId: string): Promise<void> {
  await db`DELETE FROM pipeline_events WHERE novel_id = ${novelId}`
}

describe.skipIf(!reachable)("canon-proposal lifecycle telemetry", () => {
  let novelId: string

  beforeEach(() => {
    novelId = `test-telemetry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  })

  afterEach(async () => {
    await canonDb.deleteAllForNovel(novelId)
    await deleteEvents(novelId)
  })

  test("generatePlannerCanonProposals fires per-create + summary events on clean gate", async () => {
    const outlines = [makeChapter(1), makeChapter(2), makeChapter(3)]
    await generatePlannerCanonProposals(novelId, outlines)

    const creates = await readEvents(novelId, "canon-proposal-create")
    expect(creates).toHaveLength(30)
    for (const e of creates) {
      expect(e.agent).toBe("planner-canon-proposals")
      expect(typeof e.payload.proposalId).toBe("string")
      expect(e.payload.proposalId.startsWith(`planner:${novelId}:`)).toBe(true)
      expect(["planner-output", "planning-state-mapper"]).toContain(
        e.payload.source,
      )
      expect(["established_fact", "knowledge_change", "character_state"]).toContain(
        e.payload.factKind,
      )
      expect(typeof e.payload.sourceItemId).toBe("string")
      expect(typeof e.payload.schemaVersion).toBe("string")
      expect(e.chapter).not.toBeNull()
      expect([1, 2, 3]).toContain(e.chapter as number)
    }

    const summary = await readEvents(novelId, "canon-proposal-generate-summary")
    expect(summary).toHaveLength(1)
    expect(summary[0].agent).toBe("planner-canon-proposals")
    expect(summary[0].payload).toMatchObject({
      outlinesCount: 3,
      gateClear: true,
      createdCount: 30,
      skippedCount: 0,
    })
  })

  test("rerun emits a summary but ZERO per-create events (skipped inserts are silent)", async () => {
    const outlines = [makeChapter(1)]
    await generatePlannerCanonProposals(novelId, outlines)
    // Clear out the first run's events; only the second-run events matter
    // for the assertion.
    await deleteEvents(novelId)

    await generatePlannerCanonProposals(novelId, outlines)

    const creates = await readEvents(novelId, "canon-proposal-create")
    expect(creates).toHaveLength(0)

    const summary = await readEvents(novelId, "canon-proposal-generate-summary")
    expect(summary).toHaveLength(1)
    expect(summary[0].payload).toMatchObject({
      gateClear: true,
      createdCount: 0,
      skippedCount: 10,
    })
  })

  test("gate failure emits a single summary with gateClear=false and the recommendation", async () => {
    const ch1 = makeChapter(1)
    const ch2 = makeChapter(2)
    ch2.establishedFacts[0].id = ch1.establishedFacts[0].id
    ch2.scenes[0].obligations.mustEstablish[0].sourceId =
      ch1.establishedFacts[0].id

    await generatePlannerCanonProposals(novelId, [ch1, ch2])

    const creates = await readEvents(novelId, "canon-proposal-create")
    expect(creates).toHaveLength(0)

    const summary = await readEvents(novelId, "canon-proposal-generate-summary")
    expect(summary).toHaveLength(1)
    expect(summary[0].payload).toMatchObject({
      outlinesCount: 2,
      gateClear: false,
      createdCount: 0,
    })
    expect(summary[0].payload.recommendation).toBe("fix-id-graph")
    expect(summary[0].payload.duplicateSourceIdCount).toBeGreaterThan(0)
  })

  test("resolveProposal approve fires canon-proposal-resolve with status + factId", async () => {
    const outlines = [makeChapter(1), makeChapter(2)]
    await generatePlannerCanonProposals(novelId, outlines)
    await deleteEvents(novelId) // focus on the resolve event only

    const targetId = plannerProposalId(novelId, "fact-c2-f1")
    const sub = new PostgresCanonSubstrate()
    await sub.resolveProposal(targetId, "approved")

    const resolves = await readEvents(novelId, "canon-proposal-resolve")
    expect(resolves).toHaveLength(1)
    expect(resolves[0].agent).toBe("canon-substrate")
    expect(resolves[0].chapter).toBe(2)
    expect(resolves[0].payload).toMatchObject({
      proposalId: targetId,
      status: "approved",
      factId: "fact-c2-f1",
    })
  })

  test("resolveProposal reject fires canon-proposal-resolve with factId=null", async () => {
    const outlines = [makeChapter(1)]
    await generatePlannerCanonProposals(novelId, outlines)
    await deleteEvents(novelId)

    const targetId = plannerProposalId(novelId, "know-c1-k1")
    const sub = new PostgresCanonSubstrate()
    await sub.resolveProposal(targetId, "rejected", { operatorNote: "no" })

    const resolves = await readEvents(novelId, "canon-proposal-resolve")
    expect(resolves).toHaveLength(1)
    expect(resolves[0].payload).toMatchObject({
      proposalId: targetId,
      status: "rejected",
      factId: null,
      operatorNote: "no",
    })
  })

  test("proposeCanonUpdate (substrate-direct path) fires canon-proposal-create with substrate agent", async () => {
    const sub = new PostgresCanonSubstrate()
    const proposal = await sub.proposeCanonUpdate(novelId, {
      source: "post-draft-extraction",
      proposedFact: {
        id: "fact-direct",
        kind: "established_fact",
        text: "Direct.",
        provenance: {
          source: "post-draft-extraction",
          chapter: 1,
          extractorVersion: "test-v1",
          origin: "observed",
        },
      },
    })

    const creates = await readEvents(novelId, "canon-proposal-create")
    expect(creates).toHaveLength(1)
    expect(creates[0].agent).toBe("canon-substrate")
    expect(creates[0].chapter).toBe(1)
    expect(creates[0].payload).toMatchObject({
      proposalId: proposal.id,
      source: "post-draft-extraction",
      factKind: "established_fact",
      factId: "fact-direct",
    })

    // Cleanup the canon row so afterEach's deleteAllForNovel works.
    // (proposeCanonUpdate doesn't write canon, so this is just the proposal.)
  })

  test("modified resolution fires canon-proposal-resolve with the committed fact id", async () => {
    const outlines = [makeChapter(1)]
    await generatePlannerCanonProposals(novelId, outlines)
    await deleteEvents(novelId)

    const targetId = plannerProposalId(novelId, "fact-c1-f1")
    const row = await canonDb.findProposal(targetId)
    const proposed = canonDb.proposalFromRow(row!).proposedFact
    // proposedFact's provenance omits approvalStatus/createdAt/updatedAt
    // (operator authorship fills them at commit). For a modified-resolution
    // payload typed as CanonFact, fill them with placeholders the substrate
    // will overwrite via normalizeForCommit.
    const ts = new Date().toISOString()
    const modifiedFact = {
      ...proposed,
      text: "edited",
      provenance: {
        ...proposed.provenance,
        approvalStatus: "human-edited" as const,
        createdAt: ts,
        updatedAt: ts,
      },
    }

    const sub = new PostgresCanonSubstrate()
    await sub.resolveProposal(targetId, "modified", { modifiedFact })

    const resolves = await readEvents(novelId, "canon-proposal-resolve")
    expect(resolves).toHaveLength(1)
    expect(resolves[0].payload).toMatchObject({
      proposalId: targetId,
      status: "modified",
      factId: "fact-c1-f1",
    })
  })
})
