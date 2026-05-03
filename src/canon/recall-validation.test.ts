import { describe, expect, test } from "bun:test"
import {
  fixtureToCanonSource,
  runValidation,
  validateCanonFixture,
  validateQueryFixture,
  type CanonFixture,
  type LabeledQuery,
  type QueryFixture,
  FixtureValidationError,
  PRECISION_OBSERVABILITY,
  RECALL_FLOOR,
} from "./recall-validation"

// ── Synthetic fixture ────────────────────────────────────────────────────────

const SYNTHETIC_CANON: CanonFixture = {
  novelId: "test-novel",
  snapshotVersion: "test-v1",
  description: "Synthetic fixture exercising the harness end-to-end.",
  facts: [
    {
      id: "fact-world-magic",
      kind: "established_fact",
      text: "Magic exists.",
      provenance: {
        source: "planner-output",
        chapter: 0,
        extractorVersion: "test-v1",
        approvalStatus: "human-approved",
        origin: "planned",
        createdAt: "2026-05-03T00:00:00Z",
        updatedAt: "2026-05-03T00:00:00Z",
      },
    },
    {
      id: "fact-event-ch3",
      kind: "knowledge_change",
      text: "Aldric learned about the prophecy.",
      data: { characterId: "aldric" },
      provenance: {
        source: "post-draft-extraction",
        chapter: 3,
        extractorVersion: "test-v1",
        approvalStatus: "human-approved",
        origin: "observed",
        createdAt: "2026-05-03T00:00:00Z",
        updatedAt: "2026-05-03T00:00:00Z",
      },
    },
  ],
  entities: [
    {
      id: "aldric",
      name: "Aldric",
      aliases: [],
      kind: "character",
      firstAppearedChapter: 1,
      provenance: {
        source: "planner-output",
        chapter: 1,
        extractorVersion: "test-v1",
        approvalStatus: "human-approved",
        origin: "planned",
        createdAt: "2026-05-03T00:00:00Z",
        updatedAt: "2026-05-03T00:00:00Z",
      },
    },
  ],
  characterStates: [
    {
      characterId: "aldric",
      characterName: "Aldric",
      knownFacts: ["fact-event-ch3"],
      state: { location: "village" },
      asOfChapter: 4,
    },
  ],
  promises: [
    {
      id: "promise-prophecy",
      setupChapter: 3,
      expectedPayoffChapter: 12,
      status: "open",
      promiseFactId: "fact-event-ch3",
    },
  ],
}

const SYNTHETIC_QUERY: LabeledQuery = {
  id: "q-aldric-state-ch5",
  category: "character-state-at-time",
  question: "What does Aldric know as of chapter 5?",
  chapterN: 5,
  hints: { povCharacterId: "aldric", charactersPresentIds: [] },
  relevantIds: ["aldric", "fact-event-ch3", "fact-world-magic", "promise-prophecy"],
}

const SYNTHETIC_QUERIES: QueryFixture = {
  novelId: "test-novel",
  snapshotVersion: "test-v1",
  queries: [SYNTHETIC_QUERY],
}

// ── Format validation ────────────────────────────────────────────────────────

describe("validateCanonFixture", () => {
  test("accepts well-formed fixture", () => {
    expect(() => validateCanonFixture(SYNTHETIC_CANON)).not.toThrow()
  })

  test("rejects missing novelId", () => {
    const bad = { ...SYNTHETIC_CANON, novelId: "" }
    expect(() => validateCanonFixture(bad)).toThrow(FixtureValidationError)
  })

  test("rejects non-array facts section", () => {
    const bad = { ...SYNTHETIC_CANON, facts: "not-an-array" as unknown as never }
    expect(() => validateCanonFixture(bad)).toThrow(/section facts must be an array/)
  })

  test("rejects fact missing provenance", () => {
    const bad = {
      ...SYNTHETIC_CANON,
      facts: [{ id: "f", kind: "established_fact", text: "x" }] as unknown as never,
    }
    expect(() => validateCanonFixture(bad)).toThrow(/missing provenance/)
  })

  test("rejects characterState missing characterId", () => {
    const bad = {
      ...SYNTHETIC_CANON,
      characterStates: [{ characterName: "x", asOfChapter: 1 }] as unknown as never,
    }
    expect(() => validateCanonFixture(bad)).toThrow(/missing characterId or asOfChapter/)
  })
})

describe("validateQueryFixture", () => {
  test("accepts well-formed fixture", () => {
    expect(() => validateQueryFixture(SYNTHETIC_QUERIES)).not.toThrow()
  })

  test("rejects invalid category", () => {
    const bad: QueryFixture = {
      ...SYNTHETIC_QUERIES,
      queries: [
        { ...SYNTHETIC_QUERY, category: "bogus" as unknown as never },
      ],
    }
    expect(() => validateQueryFixture(bad)).toThrow(/invalid category/)
  })

  test("rejects query missing chapterN", () => {
    const bad = {
      ...SYNTHETIC_QUERIES,
      queries: [
        {
          id: "q",
          category: "entity-grounding",
          relevantIds: [],
          hints: { povCharacterId: "x", charactersPresentIds: [] },
        },
      ],
    } as unknown as QueryFixture
    expect(() => validateQueryFixture(bad)).toThrow(/chapterN must be number/)
  })
})

// ── CanonSource adapter ──────────────────────────────────────────────────────

describe("fixtureToCanonSource", () => {
  test("returns the fixture sections through the CanonSource interface", () => {
    const src = fixtureToCanonSource(SYNTHETIC_CANON)
    expect(src.factsAsOfChapter("test-novel", 1)).toEqual(SYNTHETIC_CANON.facts)
    expect(src.entitiesAsOfChapter("test-novel", 1)).toEqual(SYNTHETIC_CANON.entities)
    expect(src.characterStatesAsOfChapter("test-novel", 1)).toEqual(SYNTHETIC_CANON.characterStates)
    expect(src.promisesAsOfChapter("test-novel", 1)).toEqual(SYNTHETIC_CANON.promises)
    expect(src.snapshotVersion("test-novel")).toBe("test-v1")
  })
})

// ── End-to-end validation ────────────────────────────────────────────────────

describe("runValidation", () => {
  test("computes recall and precision against synthetic fixture", () => {
    const report = runValidation(SYNTHETIC_CANON, SYNTHETIC_QUERIES)
    expect(report.queries).toHaveLength(1)
    const m = report.queries[0]
    expect(m.queryId).toBe("q-aldric-state-ch5")
    expect(m.recall).toBeGreaterThan(0)
    expect(m.recall).toBeLessThanOrEqual(1)
    expect(m.precision).toBeGreaterThan(0)
    expect(m.precision).toBeLessThanOrEqual(1)
    expect(m.approxTokens).toBeGreaterThan(0)
  })

  test("aggregate report includes by-category breakdown", () => {
    const report = runValidation(SYNTHETIC_CANON, SYNTHETIC_QUERIES)
    expect(report.aggregate.queryCount).toBe(1)
    expect(report.aggregate.byCategory["character-state-at-time"].count).toBe(1)
    expect(report.aggregate.byCategory["entity-grounding"].count).toBe(0)
    expect(report.aggregate.byCategory["active-promises-and-payoffs"].count).toBe(0)
  })

  test("thresholds expose recall floor + observability + sanity ceiling", () => {
    const report = runValidation(SYNTHETIC_CANON, SYNTHETIC_QUERIES)
    expect(report.thresholds.recallFloor).toBe(RECALL_FLOOR)
    expect(report.thresholds.precisionObservability).toBe(PRECISION_OBSERVABILITY)
    // recallGateClear, sanityCeilingClear, allCleared are all booleans.
    expect(typeof report.thresholds.recallGateClear).toBe("boolean")
    expect(typeof report.thresholds.sanityCeilingClear).toBe("boolean")
    expect(typeof report.thresholds.allCleared).toBe("boolean")
  })

  test("throws on novelId mismatch between canon and queries", () => {
    const queryFixtureWrong: QueryFixture = { ...SYNTHETIC_QUERIES, novelId: "other-novel" }
    expect(() => runValidation(SYNTHETIC_CANON, queryFixtureWrong)).toThrow(/novelId mismatch/)
  })

  test("perfect recall when relevant facts are subset of emitted set", () => {
    // Recall = (relevant ∩ emitted) / relevant.
    // If we ask for fact-world-magic (always emitted by rule 5), recall = 1.
    // Precision will be < 1 because scoping also emits the active promise
    // and the recent event — that's the rules working as designed, not
    // a precision failure for THIS query.
    const queryWorldOnly: LabeledQuery = {
      id: "q-world-only",
      category: "entity-grounding",
      question: "What world rules apply?",
      chapterN: 5,
      hints: { povCharacterId: "", charactersPresentIds: [] },
      relevantIds: ["fact-world-magic"],
    }
    const report = runValidation(SYNTHETIC_CANON, {
      ...SYNTHETIC_QUERIES,
      queries: [queryWorldOnly],
    })
    const m = report.queries[0]
    expect(m.recall).toBe(1)
    expect(m.recalledIds).toEqual(["fact-world-magic"])
    expect(m.missedIds).toEqual([])
    expect(m.precision).toBeLessThan(1)
    // Spurious set is the gap: this is what tells us rule 5 is "padding"
    // for entity-grounding queries that don't care about events/promises.
    expect(m.spuriousIds.length).toBeGreaterThan(0)
  })

  test("zero recall when no scoping hints select anything relevant", () => {
    // Query asks about an entity that's not POV/present and has no rule
    // catching it — recall should be 0 with no spurious matches happening
    // to align.
    const queryUnreachable: LabeledQuery = {
      id: "q-unreachable",
      category: "entity-grounding",
      question: "What about a non-existent entity?",
      chapterN: 5,
      hints: { povCharacterId: "", charactersPresentIds: [] },
      relevantIds: ["entity-that-doesnt-exist"],
    }
    const report = runValidation(SYNTHETIC_CANON, {
      ...SYNTHETIC_QUERIES,
      queries: [queryUnreachable],
    })
    const m = report.queries[0]
    expect(m.recall).toBe(0)
    expect(m.missedIds).toEqual(["entity-that-doesnt-exist"])
  })
})
