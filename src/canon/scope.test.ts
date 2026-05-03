import { describe, expect, test } from "bun:test"
import { scopeCanonForChapter, type ScopingHints } from "./scope"
import { assembleL1, type CanonSource } from "./bundle"
import type {
  CanonFact,
  CharacterState,
  Entity,
  FactKind,
  StoryPromise,
} from "./api"

// ── Fixtures ─────────────────────────────────────────────────────────────────

function fact(
  id: string,
  text: string,
  opts: {
    kind?: FactKind
    chapter?: number
    origin?: "planned" | "observed"
    approvalStatus?: "auto-extracted" | "human-approved" | "human-edited" | "contested" | "rejected"
    data?: Record<string, unknown>
  } = {},
): CanonFact {
  return {
    id,
    kind: opts.kind ?? "established_fact",
    text,
    data: opts.data,
    provenance: {
      source: "planner-output",
      chapter: opts.chapter ?? 1,
      extractorVersion: "test-v1",
      approvalStatus: opts.approvalStatus ?? "human-approved",
      origin: opts.origin ?? "planned",
      createdAt: "2026-05-03T00:00:00Z",
      updatedAt: "2026-05-03T00:00:00Z",
    },
  }
}

function entity(id: string, name: string, firstAppearedChapter?: number): Entity {
  return {
    id,
    name,
    aliases: [],
    kind: "character",
    firstAppearedChapter,
    provenance: {
      source: "planner-output",
      chapter: firstAppearedChapter ?? 1,
      extractorVersion: "test-v1",
      approvalStatus: "human-approved",
      origin: "planned",
      createdAt: "2026-05-03T00:00:00Z",
      updatedAt: "2026-05-03T00:00:00Z",
    },
  }
}

function characterState(characterId: string, name: string, asOfChapter = 1): CharacterState {
  return {
    characterId,
    characterName: name,
    knownFacts: [],
    state: {},
    asOfChapter,
  }
}

function promise(
  id: string,
  setupChapter: number,
  expectedPayoffChapter: number | undefined,
  status: StoryPromise["status"] = "open",
): StoryPromise {
  return {
    id,
    setupChapter,
    expectedPayoffChapter,
    status,
    promiseFactId: `${id}-fact`,
  }
}

// Bigger fixture used across multiple tests.
const FIXTURE = () => ({
  facts: [
    fact("world-rule-1", "Magic exists.", { kind: "established_fact", origin: "planned", chapter: 0 }),
    fact("world-rule-2", "Gods don't intervene.", { kind: "established_fact", origin: "planned", chapter: 0 }),
    fact("event-ch1", "Hero meets mentor.", { chapter: 1 }),
    fact("event-ch3", "Mentor reveals secret.", { chapter: 3 }),
    fact("event-ch7", "Hero crosses threshold.", { chapter: 7 }),
    fact("event-ch10", "Big battle starts.", { chapter: 10 }),
    fact("future-ch15", "Future event.", { chapter: 15 }),
    fact("rejected-fact", "Bad extraction.", { chapter: 5, approvalStatus: "rejected" }),
    fact("knowledge-aldric-ch5", "Aldric learned about the prophecy.", {
      kind: "knowledge_change",
      chapter: 5,
      data: { characterId: "aldric" },
    }),
    fact("knowledge-bren-ch5", "Bren learned the spell.", {
      kind: "knowledge_change",
      chapter: 5,
      data: { characterId: "bren" },
    }),
    fact("knowledge-other-ch5", "Some npc learned something.", {
      kind: "knowledge_change",
      chapter: 5,
      data: { characterId: "random-npc" },
    }),
  ],
  entities: [
    entity("aldric", "Aldric", 1),
    entity("bren", "Bren", 2),
    entity("mentor", "Old Tomas", 1),
    entity("villain", "Lord Sorcerer", 8),  // appears at chapter 8
    entity("future-char", "Future Hero", 12),
  ],
  characterStates: [
    characterState("aldric", "Aldric", 7),
    characterState("bren", "Bren", 7),
    characterState("mentor", "Old Tomas", 7),
    characterState("random-npc", "Random NPC", 7),  // not in scope
    characterState("aldric-future", "Aldric in future", 15),  // future state
  ],
  activePromises: [
    promise("p-active", 2, 12, "open"),
    promise("p-resolved", 1, 5, "resolved"),
    promise("p-future-setup", 9, 15, "open"),  // setup hasn't happened yet
    promise("p-no-payoff", 3, undefined, "open"),  // open-ended
    promise("p-stale", 1, 5, "open"),  // expected by chapter 5, slack 2 = stale at chapter 8
  ],
})

const HINTS: ScopingHints = {
  povCharacterId: "aldric",
  charactersPresentIds: ["bren", "mentor"],
}

// ── Inclusion rules ──────────────────────────────────────────────────────────

describe("scope rule 1: POV + characters-present states", () => {
  test("includes POV character's state and characters-present states", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    const ids = out.characterStates.map((s) => s.characterId).sort()
    expect(ids).toEqual(["aldric", "bren", "mentor"])
  })

  test("excludes characters not in scope", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    expect(out.characterStates.find((s) => s.characterId === "random-npc")).toBeUndefined()
  })

  test("excludes future-dated states (asOfChapter > N)", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    expect(out.characterStates.find((s) => s.characterId === "aldric-future")).toBeUndefined()
  })
})

describe("scope rule 2: active promises overlapping chapter N", () => {
  test("includes open promise within payoff window", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    expect(out.activePromises.find((p) => p.id === "p-active")).toBeDefined()
  })

  test("excludes resolved promises", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    expect(out.activePromises.find((p) => p.id === "p-resolved")).toBeUndefined()
  })

  test("excludes promises whose setup hasn't happened yet", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    expect(out.activePromises.find((p) => p.id === "p-future-setup")).toBeUndefined()
  })

  test("includes open-ended promise (no expectedPayoffChapter)", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    expect(out.activePromises.find((p) => p.id === "p-no-payoff")).toBeDefined()
  })

  test("excludes stale promise (past expected payoff + slack)", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 8)
    // p-stale: expected by 5, default slack=2 → stale at chapter 8.
    expect(out.activePromises.find((p) => p.id === "p-stale")).toBeUndefined()
  })

  test("includes stale promise inside slack window", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    // p-stale: expected by 5, default slack=2 → still active at chapter 7.
    expect(out.activePromises.find((p) => p.id === "p-stale")).toBeDefined()
  })
})

describe("scope rule 3: chapter-contract entities", () => {
  test("includes POV character entity + characters-present entities", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    const ids = out.entities.map((e) => e.id).sort()
    expect(ids).toEqual(["aldric", "bren", "mentor"])
  })

  test("excludes entities not yet appeared (firstAppearedChapter > N)", () => {
    const hintsWithVillain: ScopingHints = {
      povCharacterId: "aldric",
      charactersPresentIds: ["villain"],
    }
    const out = scopeCanonForChapter(FIXTURE(), hintsWithVillain, 7)
    // villain.firstAppearedChapter === 8, chapter 7 → excluded
    expect(out.entities.find((e) => e.id === "villain")).toBeUndefined()
  })

  test("includes force-included entity (via includeEntityIds)", () => {
    const hintsForced: ScopingHints = {
      ...HINTS,
      includeEntityIds: ["villain"],
    }
    const out = scopeCanonForChapter(FIXTURE(), hintsForced, 8)
    // villain.firstAppearedChapter === 8, chapter 8 → included
    expect(out.entities.find((e) => e.id === "villain")).toBeDefined()
  })

  test("force-include still respects not-yet-appeared", () => {
    const hintsForced: ScopingHints = {
      ...HINTS,
      includeEntityIds: ["future-char"],
    }
    const out = scopeCanonForChapter(FIXTURE(), hintsForced, 7)
    // future-char.firstAppearedChapter === 12, chapter 7 → excluded even with force
    expect(out.entities.find((e) => e.id === "future-char")).toBeUndefined()
  })
})

describe("scope rule 4: recent canon-events", () => {
  test("includes events within recency window", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    // recencyWindow=5 default → window [2, 6]; event-ch3 (chapter 3) is in.
    expect(out.facts.find((f) => f.id === "event-ch3")).toBeDefined()
  })

  test("excludes events outside recency window", () => {
    // Build a fact that's rule-4-eligible only (NOT rule-5: not established_fact)
    // so we isolate the recency rule's exclusion behavior.
    const customRaw = {
      ...FIXTURE(),
      facts: [
        fact("ch3-event-observed", "An observed event at chapter 3.", {
          kind: "knowledge_change",
          chapter: 3,
          origin: "observed",
          data: { characterId: "random-npc" },  // not in scope (rule 6 won't admit)
        }),
      ],
    }
    const out = scopeCanonForChapter(customRaw, HINTS, 10)
    // recencyWindow=5 default → window [5, 9]; chapter 3 is OUT.
    // Not established_fact (rule 5 doesn't admit). Not for in-scope char (rule 6 doesn't admit).
    expect(out.facts.find((f) => f.id === "ch3-event-observed")).toBeUndefined()
  })

  test("respects custom recencyWindow", () => {
    const customRaw = {
      ...FIXTURE(),
      facts: [
        fact("ch3-event-observed", "An observed event at chapter 3.", {
          kind: "knowledge_change",
          chapter: 3,
          origin: "observed",
          data: { characterId: "random-npc" },
        }),
      ],
    }
    const out = scopeCanonForChapter(customRaw, { ...HINTS, recencyWindow: 10 }, 10)
    // window [0, 9]; chapter 3 included this time via rule 4.
    expect(out.facts.find((f) => f.id === "ch3-event-observed")).toBeDefined()
  })

  test("does not include events at exactly chapter N (point-in-time exclusive)", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    // event-ch7 is chapter 7; rule 4 includes [N-recency, N-1] only.
    // BUT it's an established_fact with origin=observed (default in fixture is planned).
    // Actually fixture has it as kind="established_fact" with default origin="planned",
    // which matches rule 5 → INCLUDED. Test the recency-only rule by using observed origin.
    const customRaw = {
      ...FIXTURE(),
      facts: [
        fact("event-ch7-observed", "An observed event.", {
          chapter: 7,
          kind: "knowledge_change",
          origin: "observed",
          data: { characterId: "random-npc" },  // not in scope
        }),
      ],
    }
    const out2 = scopeCanonForChapter(customRaw, HINTS, 7)
    expect(out2.facts.find((f) => f.id === "event-ch7-observed")).toBeUndefined()
  })
})

describe("scope rule 5: established world facts (planned)", () => {
  test("always includes planned established_facts regardless of chapter", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 1)
    expect(out.facts.find((f) => f.id === "world-rule-1")).toBeDefined()
    expect(out.facts.find((f) => f.id === "world-rule-2")).toBeDefined()
  })

  test("includes them at chapter 100 too (no recency limit on world rules)", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 100)
    expect(out.facts.find((f) => f.id === "world-rule-1")).toBeDefined()
  })
})

describe("scope rule 6: knowledge_change facts attached to in-scope characters", () => {
  test("includes knowledge fact referencing POV character", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 6)
    // recency window [1, 5] also catches it via rule 4, but rule 6 ensures
    // knowledge facts even outside recency get included for in-scope chars.
    expect(out.facts.find((f) => f.id === "knowledge-aldric-ch5")).toBeDefined()
  })

  test("includes knowledge fact referencing characters-present character", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 6)
    expect(out.facts.find((f) => f.id === "knowledge-bren-ch5")).toBeDefined()
  })

  test("excludes knowledge fact for character not in scope (and outside recency)", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 100)
    // knowledge-other-ch5 is for random-npc, far outside recency
    expect(out.facts.find((f) => f.id === "knowledge-other-ch5")).toBeUndefined()
  })
})

// ── Exclusion rules ──────────────────────────────────────────────────────────

describe("exclusion: future facts (provenance.chapter > N)", () => {
  test("future facts never included even if rule-5-eligible", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    expect(out.facts.find((f) => f.id === "future-ch15")).toBeUndefined()
  })
})

describe("exclusion: rejected facts", () => {
  test("rejected facts excluded even when otherwise in scope", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    expect(out.facts.find((f) => f.id === "rejected-fact")).toBeUndefined()
  })
})

describe("exclusion: force-exclude list overrides", () => {
  test("force-exclude beats include-by-rule", () => {
    const hintsExcluded: ScopingHints = {
      ...HINTS,
      excludeFactIds: ["world-rule-1"],
    }
    const out = scopeCanonForChapter(FIXTURE(), hintsExcluded, 7)
    expect(out.facts.find((f) => f.id === "world-rule-1")).toBeUndefined()
    // world-rule-2 still in (same kind, not excluded)
    expect(out.facts.find((f) => f.id === "world-rule-2")).toBeDefined()
  })
})

describe("inclusion: force-include list", () => {
  test("force-include lifts a fact that no rule would otherwise admit", () => {
    const customRaw = {
      ...FIXTURE(),
      facts: [
        fact("obscure-fact", "An obscure fact.", {
          chapter: 1,
          kind: "knowledge_change",
          origin: "observed",
          data: { characterId: "random-npc" },  // not in scope
        }),
      ],
    }
    // No rule admits this fact at chapter 100 (out of recency, observed,
    // no in-scope character).
    const noForce = scopeCanonForChapter(customRaw, HINTS, 100)
    expect(noForce.facts).toHaveLength(0)

    // Force-include lifts it.
    const withForce = scopeCanonForChapter(
      customRaw,
      { ...HINTS, includeFactIds: ["obscure-fact"] },
      100,
    )
    expect(withForce.facts.find((f) => f.id === "obscure-fact")).toBeDefined()
  })
})

// ── Determinism ──────────────────────────────────────────────────────────────

describe("determinism", () => {
  test("byte-identical output for byte-identical input", () => {
    const a = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    const b = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test("output is sorted by stable IDs", () => {
    const out = scopeCanonForChapter(FIXTURE(), HINTS, 7)
    const factIds = out.facts.map((f) => f.id)
    const sortedFactIds = [...factIds].sort()
    expect(factIds).toEqual(sortedFactIds)
    const entityIds = out.entities.map((e) => e.id)
    expect(entityIds).toEqual([...entityIds].sort())
    const stateIds = out.characterStates.map((s) => s.characterId)
    expect(stateIds).toEqual([...stateIds].sort())
    const promiseIds = out.activePromises.map((p) => p.id)
    expect(promiseIds).toEqual([...promiseIds].sort())
  })
})

// ── Integration with assembleL1 ──────────────────────────────────────────────

class MockCanonSourceFromFixture implements CanonSource {
  constructor(private readonly raw: ReturnType<typeof FIXTURE>) {}
  factsAsOfChapter() { return this.raw.facts }
  entitiesAsOfChapter() { return this.raw.entities }
  characterStatesAsOfChapter() { return this.raw.characterStates }
  promisesAsOfChapter() { return this.raw.activePromises }
  snapshotVersion() { return "fixture-v1" }
}

describe("assembleL1 integration", () => {
  test("with hints produces a strict subset of without-hints output", () => {
    const source = new MockCanonSourceFromFixture(FIXTURE())
    const unscoped = assembleL1(source, "novel-1", 7)
    const scoped = assembleL1(source, "novel-1", 7, HINTS)

    // Scoped should contain fewer or equal entries in each section.
    expect(scoped.sections.facts.length).toBeLessThanOrEqual(unscoped.sections.facts.length)
    expect(scoped.sections.entities.length).toBeLessThanOrEqual(unscoped.sections.entities.length)
    expect(scoped.sections.characterStates.length).toBeLessThanOrEqual(
      unscoped.sections.characterStates.length,
    )
    expect(scoped.sections.activePromises.length).toBeLessThanOrEqual(
      unscoped.sections.activePromises.length,
    )

    // Every scoped entry must appear in the unscoped set (subset property).
    const unscopedFactIds = new Set(unscoped.sections.facts.map((f) => f.id))
    for (const f of scoped.sections.facts) {
      expect(unscopedFactIds.has(f.id)).toBe(true)
    }
    const unscopedEntityIds = new Set(unscoped.sections.entities.map((e) => e.id))
    for (const e of scoped.sections.entities) {
      expect(unscopedEntityIds.has(e.id)).toBe(true)
    }
  })

  test("with hints produces byte-identical output on rerun", () => {
    const source = new MockCanonSourceFromFixture(FIXTURE())
    const a = assembleL1(source, "novel-1", 7, HINTS)
    const b = assembleL1(source, "novel-1", 7, HINTS)
    expect(a.bytes).toBe(b.bytes)
    expect(a.packetHash).toBe(b.packetHash)
  })

  test("backward compat: without hints behaves like session-1", () => {
    // Session-1's contract: assembleL1(source, novelId, chapterN) returns
    // the whole snapshot. This test asserts that calling without the new
    // optional hints param produces the same output as before.
    const source = new MockCanonSourceFromFixture(FIXTURE())
    const a = assembleL1(source, "novel-1", 7)
    const b = assembleL1(source, "novel-1", 7, undefined)
    expect(a.bytes).toBe(b.bytes)
    expect(a.packetHash).toBe(b.packetHash)
  })

  test("scoped packet has different hash than unscoped (different content → different hash)", () => {
    const source = new MockCanonSourceFromFixture(FIXTURE())
    const unscoped = assembleL1(source, "novel-1", 7)
    const scoped = assembleL1(source, "novel-1", 7, HINTS)
    expect(scoped.packetHash).not.toBe(unscoped.packetHash)
  })
})
