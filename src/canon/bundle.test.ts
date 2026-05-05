import { describe, expect, test } from "bun:test"
import {
  assembleL1,
  assertL1Boundary,
  L1_BOUNDARY_MARKER,
  L1_TOKEN_CAP,
  type CanonSource,
} from "./bundle"
import type { CanonFact, CharacterState, Entity, StoryPromise } from "./api"

// ── Fixtures ─────────────────────────────────────────────────────────────────

function fact(id: string, text: string, chapter = 1): CanonFact {
  return {
    id,
    kind: "established_fact",
    text,
    provenance: {
      source: "planner-output",
      chapter,
      extractorVersion: "test-v1",
      approvalStatus: "human-approved",
      origin: "planned",
      createdAt: "2026-05-03T00:00:00Z",
      updatedAt: "2026-05-03T00:00:00Z",
    },
    role: "operational",
  }
}

function entity(id: string, name: string): Entity {
  return {
    id,
    name,
    aliases: [],
    kind: "character",
    provenance: {
      source: "planner-output",
      chapter: 1,
      extractorVersion: "test-v1",
      approvalStatus: "human-approved",
      origin: "planned",
      createdAt: "2026-05-03T00:00:00Z",
      updatedAt: "2026-05-03T00:00:00Z",
    },
  }
}

const TEST_PROVENANCE = {
  source: "planner-output" as const,
  chapter: 1,
  extractorVersion: "test-v1",
  approvalStatus: "human-approved" as const,
  origin: "planned" as const,
  createdAt: "2026-05-03T00:00:00Z",
  updatedAt: "2026-05-03T00:00:00Z",
}

function characterState(characterId: string, name: string, chapter = 1): CharacterState {
  return {
    characterId,
    characterName: name,
    knownFacts: [],
    state: { location: "starting-village" },
    asOfChapter: chapter,
    provenance: TEST_PROVENANCE,
  }
}

function promise(id: string, status: StoryPromise["status"] = "open"): StoryPromise {
  return {
    id,
    setupChapter: 1,
    status,
    promiseFactId: `${id}-fact`,
    provenance: TEST_PROVENANCE,
  }
}

class MockCanonSource implements CanonSource {
  constructor(
    private readonly data: {
      facts?: CanonFact[]
      entities?: Entity[]
      states?: CharacterState[]
      promises?: StoryPromise[]
      version?: string
    },
  ) {}

  factsAsOfChapter() { return this.data.facts ?? [] }
  entitiesAsOfChapter() { return this.data.entities ?? [] }
  characterStatesAsOfChapter() { return this.data.states ?? [] }
  promisesAsOfChapter() { return this.data.promises ?? [] }
  snapshotVersion() { return this.data.version ?? "test-v1" }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("assembleL1 — determinism", () => {
  test("byte-identical reruns on same input", () => {
    const source = new MockCanonSource({
      facts: [fact("fact-a", "Aldric is a sorcerer."), fact("fact-b", "The kingdom is at war.")],
      entities: [entity("aldric", "Aldric"), entity("kingdom", "Eldoria")],
      states: [characterState("aldric", "Aldric")],
      promises: [promise("p-1")],
    })
    const a = assembleL1(source, "novel-1", 1)
    const b = assembleL1(source, "novel-1", 1)
    expect(a.bytes).toBe(b.bytes)
    expect(a.packetHash).toBe(b.packetHash)
    expect(a.byteLength).toBe(b.byteLength)
  })

  test("input shuffle invariance — same content in different order produces same bytes", () => {
    const factsA = [fact("fact-a", "A"), fact("fact-b", "B"), fact("fact-c", "C")]
    const factsB = [fact("fact-c", "C"), fact("fact-a", "A"), fact("fact-b", "B")]
    const a = assembleL1(new MockCanonSource({ facts: factsA }), "novel-1", 1)
    const b = assembleL1(new MockCanonSource({ facts: factsB }), "novel-1", 1)
    expect(a.bytes).toBe(b.bytes)
    expect(a.packetHash).toBe(b.packetHash)
  })

  test("entity-list shuffle invariance", () => {
    const entA = [entity("e-1", "Alpha"), entity("e-2", "Beta"), entity("e-3", "Gamma")]
    const entB = [entity("e-3", "Gamma"), entity("e-1", "Alpha"), entity("e-2", "Beta")]
    const a = assembleL1(new MockCanonSource({ entities: entA }), "novel-1", 1)
    const b = assembleL1(new MockCanonSource({ entities: entB }), "novel-1", 1)
    expect(a.bytes).toBe(b.bytes)
  })

  test("different content → different hash", () => {
    const a = assembleL1(
      new MockCanonSource({ facts: [fact("fact-a", "A")] }),
      "novel-1",
      1,
    )
    const b = assembleL1(
      new MockCanonSource({ facts: [fact("fact-a", "B")] }),
      "novel-1",
      1,
    )
    expect(a.packetHash).not.toBe(b.packetHash)
    expect(a.bytes).not.toBe(b.bytes)
  })

  test("different chapter → different packet (passed-through inputs differ)", () => {
    // Even with identical mock data, the packet records chapterN; downstream
    // consumers can verify they got the right chapter's packet.
    const source = new MockCanonSource({ facts: [fact("fact-a", "A")] })
    const a = assembleL1(source, "novel-1", 1)
    const b = assembleL1(source, "novel-1", 2)
    expect(a.chapterN).toBe(1)
    expect(b.chapterN).toBe(2)
  })
})

describe("assembleL1 — promise filtering", () => {
  test("only open promises appear in active-promises section", () => {
    const promises = [
      promise("p-open", "open"),
      promise("p-resolved", "resolved"),
      promise("p-abandoned", "abandoned"),
    ]
    const packet = assembleL1(new MockCanonSource({ promises }), "novel-1", 1)
    expect(packet.sections.activePromises).toHaveLength(1)
    expect(packet.sections.activePromises[0].id).toBe("p-open")
  })
})

describe("assembleL1 — cascade boundary", () => {
  test("L1 ends with the boundary marker", () => {
    const packet = assembleL1(
      new MockCanonSource({ facts: [fact("fact-a", "A")] }),
      "novel-1",
      1,
    )
    expect(packet.bytes.endsWith(L1_BOUNDARY_MARKER)).toBe(true)
  })

  test("boundaryStart offset equals byteLength minus marker length", () => {
    const packet = assembleL1(
      new MockCanonSource({ facts: [fact("fact-a", "A")] }),
      "novel-1",
      1,
    )
    expect(packet.sectionOffsets.boundaryStart).toBe(
      packet.byteLength - L1_BOUNDARY_MARKER.length,
    )
  })

  test("section offsets are monotonic and non-overlapping", () => {
    const packet = assembleL1(
      new MockCanonSource({
        facts: [fact("fact-a", "A")],
        entities: [entity("e-1", "Alpha")],
        states: [characterState("c-1", "Aldric")],
        promises: [promise("p-1")],
      }),
      "novel-1",
      1,
    )
    const o = packet.sectionOffsets
    expect(o.factsStart).toBe(0)
    expect(o.entitiesStart).toBeGreaterThan(o.factsStart)
    expect(o.characterStatesStart).toBeGreaterThan(o.entitiesStart)
    expect(o.activePromisesStart).toBeGreaterThan(o.characterStatesStart)
    expect(o.boundaryStart).toBeGreaterThan(o.activePromisesStart)
  })
})

describe("assertL1Boundary", () => {
  test("passes when prompt starts with packet bytes", () => {
    const packet = assembleL1(
      new MockCanonSource({ facts: [fact("fact-a", "A")] }),
      "novel-1",
      1,
    )
    const fullPrompt = packet.bytes + "[L2 role instructions go here]"
    expect(() => assertL1Boundary(fullPrompt, packet)).not.toThrow()
  })

  test("fails when prompt does not start with packet bytes", () => {
    const packet = assembleL1(
      new MockCanonSource({ facts: [fact("fact-a", "A")] }),
      "novel-1",
      1,
    )
    const tampered = "PREFIX_INTRUDER" + packet.bytes
    expect(() => assertL1Boundary(tampered, packet)).toThrow(
      /L1 must be the contiguous prefix/,
    )
  })

  test("fails when boundary marker has been altered", () => {
    const packet = assembleL1(
      new MockCanonSource({ facts: [fact("fact-a", "A")] }),
      "novel-1",
      1,
    )
    // Mutate the bytes after construction (simulating a buggy assembler that
    // mutates the prefix in place between assembleL1 and assertL1Boundary).
    const tamperedBytes = packet.bytes.replace(L1_BOUNDARY_MARKER, "\n<<<TAMPERED>>>\n")
    expect(() => assertL1Boundary(tamperedBytes, packet)).toThrow(
      /does not start with the L1 packet bytes|boundary marker not found/,
    )
  })
})

describe("assembleL1 — token cap (sanity ceiling, not optimization target)", () => {
  test("does NOT throw when bundle exceeds L1_TOKEN_CAP; surfaces flag instead", () => {
    // Need ~240K characters to exceed the 60K-token sanity ceiling.
    const largeText = "x".repeat(8_000)
    const facts = Array.from({ length: 32 }, (_, i) => fact(`fact-${i}`, largeText))
    const packet = assembleL1(new MockCanonSource({ facts }), "novel-1", 1)
    expect(packet.tokenCapExceeded).toBe(true)
    expect(packet.approxTokens).toBeGreaterThan(L1_TOKEN_CAP)
    // Hitting this in production means scope rules are pathological,
    // not that the bundle is too big — investigate, don't trim.
  })

  test("typical bundle stays well under the sanity ceiling and flag false", () => {
    const packet = assembleL1(
      new MockCanonSource({ facts: [fact("fact-a", "A")] }),
      "novel-1",
      1,
    )
    expect(packet.approxTokens).toBeLessThan(L1_TOKEN_CAP)
    expect(packet.approxTokens).toBeGreaterThan(0)
    expect(packet.tokenCapExceeded).toBe(false)
  })
})

describe("assembleL1 — snapshot version pass-through", () => {
  test("snapshotVersion from source flows into packet", () => {
    const packet = assembleL1(
      new MockCanonSource({ version: "novel-1@v42" }),
      "novel-1",
      1,
    )
    expect(packet.snapshotVersion).toBe("novel-1@v42")
  })
})
