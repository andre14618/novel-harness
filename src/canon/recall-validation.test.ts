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
  RECALL_MIN_QUERY_COUNT,
  RECALL_MIN_CATEGORY_COUNT,
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
      provenance: {
        source: "post-draft-extraction",
        chapter: 4,
        extractorVersion: "test-v1",
        approvalStatus: "human-approved",
        origin: "observed",
        createdAt: "2026-05-03T00:00:00Z",
        updatedAt: "2026-05-03T00:00:00Z",
      },
    },
  ],
  promises: [
    {
      id: "promise-prophecy",
      setupChapter: 3,
      expectedPayoffChapter: 12,
      status: "open",
      promiseFactId: "fact-event-ch3",
      provenance: {
        source: "planner-output",
        chapter: 3,
        extractorVersion: "test-v1",
        approvalStatus: "human-approved",
        origin: "planned",
        createdAt: "2026-05-03T00:00:00Z",
        updatedAt: "2026-05-03T00:00:00Z",
      },
    },
  ],
}

const SYNTHETIC_QUERY: LabeledQuery = {
  id: "q-aldric-state-ch5",
  category: "character-state-at-time",
  question: "What does Aldric know as of chapter 5?",
  chapterN: 5,
  relevantIds: [
    "entity:aldric",
    "state:aldric",
    "fact:fact-event-ch3",
    "fact:fact-world-magic",
    "promise:promise-prophecy",
  ],
}

const SYNTHETIC_QUERIES: QueryFixture = {
  novelId: "test-novel",
  snapshotVersion: "test-v1",
  chapters: [
    {
      chapterN: 5,
      hints: { povCharacterId: "aldric", charactersPresentIds: [] },
    },
  ],
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
        },
      ],
    } as unknown as QueryFixture
    expect(() => validateQueryFixture(bad)).toThrow(/chapterN must be number/)
  })

  test("rejects un-namespaced relevantId", () => {
    const bad: QueryFixture = {
      ...SYNTHETIC_QUERIES,
      queries: [
        // Cast to unknown to bypass the typed RelevantId compile-time check —
        // we're testing the runtime validator's behavior on bad JSON input.
        { ...SYNTHETIC_QUERY, relevantIds: ["aldric"] as unknown as never },
      ],
    }
    expect(() => validateQueryFixture(bad)).toThrow(
      /relevantId must be namespaced/,
    )
  })

  test("rejects relevantId with prefix-only string (empty body)", () => {
    const bad: QueryFixture = {
      ...SYNTHETIC_QUERIES,
      queries: [
        { ...SYNTHETIC_QUERY, relevantIds: ["fact:"] as unknown as never },
      ],
    }
    expect(() => validateQueryFixture(bad)).toThrow(
      /relevantId must be namespaced/,
    )
  })

  test("rejects fixture missing chapters manifest", () => {
    const bad = {
      novelId: "test-novel",
      snapshotVersion: "test-v1",
      queries: [SYNTHETIC_QUERY],
    } as unknown as QueryFixture
    expect(() => validateQueryFixture(bad)).toThrow(
      /chapters manifest must be an array/,
    )
  })

  test("rejects chapter manifest entry missing chapterN", () => {
    const bad = {
      ...SYNTHETIC_QUERIES,
      chapters: [{ hints: { povCharacterId: "aldric", charactersPresentIds: [] } }],
    } as unknown as QueryFixture
    expect(() => validateQueryFixture(bad)).toThrow(/missing chapterN/)
  })

  test("rejects chapter manifest with empty hints object (would crash assembler later)", () => {
    const bad = {
      ...SYNTHETIC_QUERIES,
      chapters: [{ chapterN: 5, hints: {} }],
    } as unknown as QueryFixture
    expect(() => validateQueryFixture(bad)).toThrow(/povCharacterId must be a string/)
  })

  test("rejects chapter manifest hints missing charactersPresentIds", () => {
    const bad = {
      ...SYNTHETIC_QUERIES,
      chapters: [{ chapterN: 5, hints: { povCharacterId: "aldric" } }],
    } as unknown as QueryFixture
    expect(() => validateQueryFixture(bad)).toThrow(
      /charactersPresentIds must be an array/,
    )
  })

  test("rejects chapter manifest charactersPresentIds with non-string entries", () => {
    const bad = {
      ...SYNTHETIC_QUERIES,
      chapters: [
        {
          chapterN: 5,
          hints: { povCharacterId: "aldric", charactersPresentIds: [42, "bren"] },
        },
      ],
    } as unknown as QueryFixture
    expect(() => validateQueryFixture(bad)).toThrow(
      /charactersPresentIds entries must all be strings/,
    )
  })

  test("rejects fixture missing snapshotVersion", () => {
    const bad = {
      novelId: "test-novel",
      chapters: SYNTHETIC_QUERIES.chapters,
      queries: [SYNTHETIC_QUERY],
    } as unknown as QueryFixture
    expect(() => validateQueryFixture(bad)).toThrow(/missing or invalid snapshotVersion/)
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

describe("runValidation — per-query metrics", () => {
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

  test("perfect recall when relevant facts are subset of emitted set", () => {
    const queryWorldOnly: LabeledQuery = {
      id: "q-world-only",
      category: "entity-grounding",
      question: "What world rules apply?",
      chapterN: 5,
      relevantIds: ["fact:fact-world-magic"],
    }
    const report = runValidation(SYNTHETIC_CANON, {
      ...SYNTHETIC_QUERIES,
      queries: [queryWorldOnly],
    })
    const m = report.queries[0]
    expect(m.recall).toBe(1)
    expect(m.recalledIds).toEqual(["fact:fact-world-magic"])
    expect(m.missedIds).toEqual([])
    expect(m.precision).toBeLessThan(1)
    // Spurious set is non-empty: scoping correctly emits world rule + active
    // promise + recent event for this chapter, even though the labeler only
    // marked the world rule as relevant for THIS query. That's rules working
    // as designed, not a precision failure.
    expect(m.spuriousIds.length).toBeGreaterThan(0)
  })

  test("zero recall when relevant ID isn't anywhere in canon", () => {
    const queryUnreachable: LabeledQuery = {
      id: "q-unreachable",
      category: "entity-grounding",
      question: "What about a non-existent entity?",
      chapterN: 5,
      relevantIds: ["entity:entity-that-doesnt-exist"],
    }
    const report = runValidation(SYNTHETIC_CANON, {
      ...SYNTHETIC_QUERIES,
      queries: [queryUnreachable],
    })
    const m = report.queries[0]
    expect(m.recall).toBe(0)
    expect(m.missedIds).toEqual(["entity:entity-that-doesnt-exist"])
  })

  test("emitted IDs are namespaced (entity vs state disambiguation)", () => {
    // Aldric is BOTH an entity and a character state. Without namespacing,
    // the harness can't tell these apart in relevantIds. With namespacing,
    // they're distinct strings in the emitted set.
    const queryAldricBoth: LabeledQuery = {
      id: "q-aldric-both",
      category: "character-state-at-time",
      question: "Get both the entity and the state for Aldric.",
      chapterN: 5,
      relevantIds: ["entity:aldric", "state:aldric"],
    }
    const report = runValidation(SYNTHETIC_CANON, {
      ...SYNTHETIC_QUERIES,
      queries: [queryAldricBoth],
    })
    const m = report.queries[0]
    expect(m.emittedIds).toContain("entity:aldric")
    expect(m.emittedIds).toContain("state:aldric")
    expect(m.recall).toBe(1)
  })
})

// ── Per-chapter packet caching ───────────────────────────────────────────────

describe("runValidation — one packet per chapter (cache shared across queries)", () => {
  test("multiple queries about the same chapter see identical emittedIds", () => {
    // The architecture says: one packet per chapter, reused by every role.
    // The harness mirrors this: every query about chapter 5 gets graded
    // against the same packet, so emittedIds must be byte-identical across
    // queries that share a chapter.
    const queries: QueryFixture = {
      ...SYNTHETIC_QUERIES,
      queries: [
        { ...SYNTHETIC_QUERY, id: "q-a", relevantIds: ["entity:aldric"] },
        { ...SYNTHETIC_QUERY, id: "q-b", relevantIds: ["fact:fact-world-magic"] },
        { ...SYNTHETIC_QUERY, id: "q-c", relevantIds: ["promise:promise-prophecy"] },
      ],
    }
    const report = runValidation(SYNTHETIC_CANON, queries)
    expect(report.queries).toHaveLength(3)
    const emittedSetA = JSON.stringify([...report.queries[0].emittedIds].sort())
    const emittedSetB = JSON.stringify([...report.queries[1].emittedIds].sort())
    const emittedSetC = JSON.stringify([...report.queries[2].emittedIds].sort())
    expect(emittedSetA).toBe(emittedSetB)
    expect(emittedSetB).toBe(emittedSetC)
  })

  test("throws if query references chapter not in manifest", () => {
    const queryOrphan: LabeledQuery = {
      ...SYNTHETIC_QUERY,
      id: "q-orphan",
      chapterN: 99, // not in SYNTHETIC_QUERIES.chapters
    }
    expect(() =>
      runValidation(SYNTHETIC_CANON, {
        ...SYNTHETIC_QUERIES,
        queries: [queryOrphan],
      }),
    ).toThrow(/no entry in chapter manifest/)
  })

  test("throws on duplicate chapter manifest entries", () => {
    const dupedManifest: QueryFixture = {
      ...SYNTHETIC_QUERIES,
      chapters: [
        { chapterN: 5, hints: { povCharacterId: "aldric", charactersPresentIds: [] } },
        { chapterN: 5, hints: { povCharacterId: "bren", charactersPresentIds: [] } },
      ],
    }
    expect(() => runValidation(SYNTHETIC_CANON, dupedManifest)).toThrow(
      /duplicate chapter manifest/,
    )
  })

  test("throws on novelId mismatch between canon and queries", () => {
    const queryFixtureWrong: QueryFixture = { ...SYNTHETIC_QUERIES, novelId: "other-novel" }
    expect(() => runValidation(SYNTHETIC_CANON, queryFixtureWrong)).toThrow(/novelId mismatch/)
  })

  test("throws on snapshotVersion mismatch between canon and queries", () => {
    // A query fixture authored against an older canon snapshot must not be
    // run against a newer canon — the IDs may still exist but the labels
    // were against a different state.
    const queryFixtureStale: QueryFixture = {
      ...SYNTHETIC_QUERIES,
      snapshotVersion: "test-v0-old",
    }
    expect(() => runValidation(SYNTHETIC_CANON, queryFixtureStale)).toThrow(
      /snapshotVersion mismatch/,
    )
  })
})

// ── Stop-gate semantics ──────────────────────────────────────────────────────

describe("runValidation — recall stop gate", () => {
  test("thresholds expose recall floor + observability + sample-size + category requirements", () => {
    const report = runValidation(SYNTHETIC_CANON, SYNTHETIC_QUERIES)
    expect(report.thresholds.recallFloor).toBe(RECALL_FLOOR)
    expect(report.thresholds.recallMinQueryCount).toBe(RECALL_MIN_QUERY_COUNT)
    expect(report.thresholds.recallMinCategoryCount).toBe(RECALL_MIN_CATEGORY_COUNT)
    expect(report.thresholds.precisionObservability).toBe(PRECISION_OBSERVABILITY)
    expect(typeof report.thresholds.recallGateClear).toBe("boolean")
    expect(typeof report.thresholds.sanityCeilingClear).toBe("boolean")
  })

  test("recallGateClear is FALSE with too few queries even at perfect recall", () => {
    // One query, perfect recall — not enough sample to clear the gate.
    const report = runValidation(SYNTHETIC_CANON, {
      ...SYNTHETIC_QUERIES,
      queries: [
        {
          id: "q-perfect",
          category: "entity-grounding",
          question: "Just the world rule.",
          chapterN: 5,
          relevantIds: ["fact:fact-world-magic"],
        },
      ],
    })
    expect(report.queries[0].recall).toBe(1)
    expect(report.aggregate.queryCount).toBeLessThan(RECALL_MIN_QUERY_COUNT)
    expect(report.thresholds.recallGateClear).toBe(false)
  })

  test("recallGateClear is FALSE when only one category is represented", () => {
    // Synthesize ≥ 40 queries all in one category — sample size satisfied,
    // but category coverage isn't, so the gate stays closed.
    const queries: LabeledQuery[] = []
    for (let i = 0; i < RECALL_MIN_QUERY_COUNT + 5; i++) {
      queries.push({
        id: `q-${i}`,
        category: "entity-grounding",
        question: `Query ${i}`,
        chapterN: 5,
        relevantIds: ["fact:fact-world-magic"], // perfect-recall query
      })
    }
    const report = runValidation(SYNTHETIC_CANON, {
      ...SYNTHETIC_QUERIES,
      queries,
    })
    expect(report.aggregate.queryCount).toBeGreaterThanOrEqual(
      RECALL_MIN_QUERY_COUNT,
    )
    expect(report.aggregate.meanRecall).toBe(1)
    // Only one category represented → gate refuses to clear.
    expect(report.thresholds.recallGateClear).toBe(false)
  })

  test("recallGateClear is TRUE when sample size, categories, and recall all clear", () => {
    const queries: LabeledQuery[] = []
    const cats: ReadonlyArray<LabeledQuery["category"]> = [
      "entity-grounding",
      "character-state-at-time",
      "active-promises-and-payoffs",
    ]
    // 14 queries per category × 3 cats = 42 ≥ RECALL_MIN_QUERY_COUNT.
    for (let i = 0; i < 14; i++) {
      for (const cat of cats) {
        queries.push({
          id: `q-${cat}-${i}`,
          category: cat,
          question: `Query ${cat} ${i}`,
          chapterN: 5,
          relevantIds: ["fact:fact-world-magic"], // always emitted by rule 5 → recall=1
        })
      }
    }
    const report = runValidation(SYNTHETIC_CANON, {
      ...SYNTHETIC_QUERIES,
      queries,
    })
    expect(report.aggregate.queryCount).toBeGreaterThanOrEqual(
      RECALL_MIN_QUERY_COUNT,
    )
    for (const cat of cats) {
      expect(report.aggregate.byCategory[cat].count).toBeGreaterThan(0)
    }
    expect(report.aggregate.meanRecall).toBeGreaterThanOrEqual(RECALL_FLOOR)
    expect(report.thresholds.recallGateClear).toBe(true)
  })
})
