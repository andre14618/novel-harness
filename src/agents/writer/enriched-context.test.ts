import { describe, test, expect } from "bun:test"
import {
  buildEnrichedContext,
  insertEnrichedSection,
  type EnrichedContextInput,
} from "./enriched-context"
import type { WorldBible } from "./../world-builder/schema"
import type { CharacterProfile } from "./../character-agent/schema"
import type { SceneBeat } from "../../schemas/shared"
import type { ChapterOutline, CharacterState, Fact } from "../../types"

// ── Fixtures ──────────────────────────────────────────────────────────

const emptyWorldBible: WorldBible = {
  setting: "",
  timePeriod: "",
  geography: "",
  politicalStructure: "",
  technologyConstraints: "",
  socialCustoms: [],
  sensoryPalette: "",
  rules: [],
  locations: [],
  culture: "",
  history: "",
  systems: [],
  cultures: [],
}

const baseBeat: SceneBeat = {
  description: "Dagnar meets Aisha outside the Citadel of Vane.",
  characters: ["Dagnar", "Aisha"],
  kind: "dialogue",
  requiredPayoffs: [],
  obligations: { mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [] },
  lifeValueAxes: [],
  miceActive: [],
  miceOpens: [],
  miceCloses: [],
}

const baseOutline = {
  scenes: [baseBeat],
  establishedFacts: [],
  title: "",
  povCharacter: "Dagnar",
  setting: "",
  targetWords: 1000,
  characterStateChanges: [],
  knowledgeChanges: [],
} as unknown as ChapterOutline

function makeChar(overrides: Partial<CharacterProfile>): CharacterProfile {
  return {
    id: overrides.name?.toLowerCase() ?? "id",
    name: "Default",
    role: "protagonist",
    backstory: "",
    traits: [],
    speechPattern: "",
    goals: "",
    fears: "",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: [],
    ...overrides,
  }
}

// ── SPEAKER DIRECTIVES ────────────────────────────────────────────────

describe("SPEAKER DIRECTIVES sub-block", () => {
  test("emits cultural + system awareness for present characters", () => {
    const chars: CharacterProfile[] = [
      makeChar({
        id: "1",
        name: "Dagnar",
        culturalBackground: [
          { cultureName: "Ironreach", relationship: "exile" },
        ],
        systemAwareness: [
          {
            systemName: "the Null Weaving",
            level: "aware",
            perspective: "skeptical of its moral cost",
          },
        ],
        fears: "Losing his sister to the weaving",
      }),
      makeChar({
        id: "2",
        name: "Aisha",
        culturalBackground: [],
        systemAwareness: [],
        fears: "",
      }),
    ]
    const input: EnrichedContextInput = {
      beat: baseBeat,
      outline: baseOutline,
      characters: chars,
      characterStates: [],
      worldBible: emptyWorldBible,
      priorChapterFacts: [],
      chapterNumber: 1,
    }
    const result = buildEnrichedContext(input)
    expect(result.block).toContain("SPEAKER DIRECTIVES:")
    expect(result.block).toContain("Dagnar:")
    expect(result.block).toContain("Cultural stance: exile to Ironreach")
    expect(result.block).toContain("System awareness: the Null Weaving [aware] (skeptical of its moral cost)")
    expect(result.block).toContain("Fears: Losing his sister to the weaving")
    // Aisha has no additive data so should NOT appear
    expect(result.block).not.toContain("Aisha:")
    expect(result.subBlockBytes.speakerDirectives).toBeGreaterThan(0)
  })

  test("skips ignorant system-awareness entries", () => {
    const chars: CharacterProfile[] = [
      makeChar({
        id: "1",
        name: "Dagnar",
        systemAwareness: [
          { systemName: "Magic", level: "ignorant", perspective: "" },
          { systemName: "Politics", level: "expert", perspective: "" },
        ],
      }),
    ]
    const result = buildEnrichedContext({
      beat: { ...baseBeat, characters: ["Dagnar"] },
      outline: baseOutline,
      characters: chars,
      characterStates: [],
      worldBible: emptyWorldBible,
      priorChapterFacts: [],
      chapterNumber: 1,
    })
    expect(result.block).toContain("Politics [expert]")
    expect(result.block).not.toContain("Magic [ignorant]")
  })

  test("omits SPEAKER DIRECTIVES entirely when no character has additive data", () => {
    const chars: CharacterProfile[] = [
      makeChar({ id: "1", name: "Dagnar" }),
      makeChar({ id: "2", name: "Aisha" }),
    ]
    const result = buildEnrichedContext({
      beat: baseBeat,
      outline: baseOutline,
      characters: chars,
      characterStates: [],
      worldBible: emptyWorldBible,
      priorChapterFacts: [],
      chapterNumber: 1,
    })
    expect(result.block).not.toContain("SPEAKER DIRECTIVES:")
    expect(result.subBlockBytes.speakerDirectives).toBe(0)
  })
})

// ── READER-INFO STATE ────────────────────────────────────────────────

describe("READER-INFO STATE sub-block", () => {
  test("surfaces prior-chapter facts and per-character doesNotKnow", () => {
    const chars: CharacterProfile[] = [
      makeChar({ id: "1", name: "Dagnar" }),
      makeChar({ id: "2", name: "Aisha" }),
    ]
    const facts: Fact[] = [
      { id: "f1", fact: "The Citadel was sealed in 1137", category: "event", establishedInChapter: 1 },
      { id: "f2", fact: "Aisha's brother carries the amulet", category: "character", establishedInChapter: 1 },
    ]
    const states: CharacterState[] = [
      {
        characterId: "1",
        chapterNumber: 2,
        location: "",
        emotionalState: "",
        knows: [],
        doesNotKnow: ["Aisha's brother carries the amulet"],
      },
    ]
    const result = buildEnrichedContext({
      beat: baseBeat,
      outline: baseOutline,
      characters: chars,
      characterStates: states,
      worldBible: emptyWorldBible,
      priorChapterFacts: facts,
      chapterNumber: 2,
    })
    expect(result.block).toContain("READER-INFO STATE:")
    expect(result.block).toContain("Reader already knows:")
    expect(result.block).toContain("[ch1] The Citadel was sealed in 1137")
    expect(result.block).toContain("Hidden from Dagnar: Aisha's brother carries the amulet")
    expect(result.subBlockBytes.readerInfoState).toBeGreaterThan(0)
  })

  test("omits section when neither facts nor hidden info", () => {
    const result = buildEnrichedContext({
      beat: baseBeat,
      outline: baseOutline,
      characters: [makeChar({ id: "1", name: "Dagnar" })],
      characterStates: [],
      worldBible: emptyWorldBible,
      priorChapterFacts: [],
      chapterNumber: 1,
    })
    expect(result.block).not.toContain("READER-INFO STATE:")
  })
})

// ── FOCUSED WORLD SLICE ───────────────────────────────────────────────

describe("FOCUSED WORLD SLICE sub-block", () => {
  test("emits full entries for entity names matched in beat.description", () => {
    const worldBible: WorldBible = {
      ...emptyWorldBible,
      locations: [
        { name: "Citadel of Vane", description: "A fortress carved into a mountain; sealed during the Rift War." },
        { name: "Ironreach", description: "Coastal city-state, capital of the northern league." },
      ],
      cultures: [
        {
          id: "c1",
          name: "Null Cult",
          description: "A heretical sect that denies the weaving.",
          values: ["silence", "endurance"],
          taboos: ["naming the Bright Powers"],
          speechInfluences: "",
          customs: [],
          systemViews: {},
        },
      ],
      systems: [
        {
          id: "s1",
          name: "Null Weaving",
          type: "magic",
          description: "Forbidden counter-magic that unmakes existing wards.",
          rules: ["Requires a living anchor", "Reversal is never total"],
          manifestations: [],
          vocabulary: ["unraveling", "hollow thread", "anchor"],
          constraints: [],
        },
      ],
    }
    const beat: SceneBeat = {
      description: "Dagnar enters the Citadel of Vane, where the Null Weaving first bled through.",
      characters: ["Dagnar"],
      kind: "action",
      requiredPayoffs: [],
      obligations: { mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [] },
      lifeValueAxes: [],
      miceActive: [],
      miceOpens: [],
      miceCloses: [],
    }
    const result = buildEnrichedContext({
      beat,
      outline: baseOutline,
      characters: [makeChar({ id: "1", name: "Dagnar" })],
      characterStates: [],
      worldBible,
      priorChapterFacts: [],
      chapterNumber: 1,
    })
    expect(result.block).toContain("FOCUSED WORLD SLICE:")
    expect(result.block).toContain("Citadel of Vane (location):")
    expect(result.block).toContain("A fortress carved into a mountain")
    expect(result.block).toContain("Null Weaving (system, magic):")
    expect(result.block).toContain("Rules: Requires a living anchor; Reversal is never total")
    expect(result.block).toContain("Vocabulary: unraveling, hollow thread, anchor")
    // Ironreach is in the bible but NOT in beat.description → omitted
    expect(result.block).not.toContain("Ironreach")
    // Null Cult is in the bible but NOT in beat.description → omitted
    expect(result.block).not.toContain("Null Cult")
  })

  test("word-boundary matching ignores substrings", () => {
    const worldBible: WorldBible = {
      ...emptyWorldBible,
      locations: [
        { name: "Vane", description: "A mountain." },
      ],
    }
    // "vanished" contains "vane" as a substring — must not match
    const beat: SceneBeat = {
      description: "Dagnar vanished into the morning.",
      characters: ["Dagnar"],
      kind: "action",
      requiredPayoffs: [],
      obligations: { mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [] },
      lifeValueAxes: [],
      miceActive: [],
      miceOpens: [],
      miceCloses: [],
    }
    const result = buildEnrichedContext({
      beat,
      outline: baseOutline,
      characters: [makeChar({ id: "1", name: "Dagnar" })],
      characterStates: [],
      worldBible,
      priorChapterFacts: [],
      chapterNumber: 1,
    })
    expect(result.block).not.toContain("Vane (location)")
  })

  test("omits entities with names shorter than 4 characters", () => {
    const worldBible: WorldBible = {
      ...emptyWorldBible,
      locations: [{ name: "Mar", description: "A port." }],
    }
    const beat: SceneBeat = {
      description: "Dagnar walks to the Mar.",
      characters: ["Dagnar"],
      kind: "action",
      requiredPayoffs: [],
      obligations: { mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [] },
      lifeValueAxes: [],
      miceActive: [],
      miceOpens: [],
      miceCloses: [],
    }
    const result = buildEnrichedContext({
      beat,
      outline: baseOutline,
      characters: [makeChar({ id: "1", name: "Dagnar" })],
      characterStates: [],
      worldBible,
      priorChapterFacts: [],
      chapterNumber: 1,
    })
    expect(result.block).not.toContain("Mar (location)")
  })
})

// ── Empty / fallback ──────────────────────────────────────────────────

describe("empty signal fallback", () => {
  test("block still emits ENRICHED CONTEXT header with no-signal marker when all sub-blocks are empty", () => {
    const result = buildEnrichedContext({
      beat: baseBeat,
      outline: baseOutline,
      characters: [],
      characterStates: [],
      worldBible: emptyWorldBible,
      priorChapterFacts: [],
      chapterNumber: 1,
    })
    expect(result.block).toContain("ENRICHED CONTEXT:")
    expect(result.block).toContain("(no additive signal for this beat)")
    expect(result.subBlockBytes.speakerDirectives).toBe(0)
    expect(result.subBlockBytes.readerInfoState).toBe(0)
    expect(result.subBlockBytes.focusedWorldSlice).toBe(0)
  })
})

// ── Insertion helper ──────────────────────────────────────────────────

describe("insertEnrichedSection", () => {
  test("inserts before first SETTING: section when present", () => {
    const sections = [
      "Beat spec text",
      "TRANSITION BRIDGE (continue from here):\nprior prose",
      "SETTING:\nA mountain at dusk.",
    ]
    const result = insertEnrichedSection(sections, "ENRICHED CONTEXT:\nfoo")
    expect(result).toHaveLength(4)
    expect(result[2]).toBe("ENRICHED CONTEXT:\nfoo")
    expect(result[3]).toBe("SETTING:\nA mountain at dusk.")
  })

  test("inserts before first Sensory: section (compact-mode variant)", () => {
    const sections = [
      "Beat spec",
      "CHARACTERS:\nDagnar: …",
      "Sensory: cold wind, iron taste",
    ]
    const result = insertEnrichedSection(sections, "ENRICHED CONTEXT:\nbar")
    expect(result[2]).toBe("ENRICHED CONTEXT:\nbar")
    expect(result[3]).toBe("Sensory: cold wind, iron taste")
  })

  test("appends at end when no SETTING/Sensory section present", () => {
    const sections = ["Beat spec", "CHARACTERS:\nDagnar"]
    const result = insertEnrichedSection(sections, "ENRICHED CONTEXT:\nbaz")
    expect(result).toHaveLength(3)
    expect(result[2]).toBe("ENRICHED CONTEXT:\nbaz")
  })

  test("does not mutate the input array", () => {
    const sections = ["a", "Sensory: b"]
    const before = sections.slice()
    insertEnrichedSection(sections, "x")
    expect(sections).toEqual(before)
  })
})
