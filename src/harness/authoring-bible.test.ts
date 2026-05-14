import { describe, expect, test } from "bun:test"

import type { ChapterOutline, CharacterProfile, WorldBible } from "../types"
import {
  buildAuthoringBiblePacket,
  deriveAuthoringBibleVerdict,
  renderAuthoringBibleSlice,
  selectAuthoringBibleSlice,
  summarizeAuthoringBibleSlice,
} from "./authoring-bible"

describe("authoring bible packet and slice", () => {
  test("builds stable story, character, relationship, and voice rules from existing surfaces", () => {
    const packet = buildAuthoringBiblePacket({
      genre: "adult mercenary progression fantasy",
      worldBible: worldBible(),
      characters: characters(),
    })

    expect(packet.storyRules.map(rule => rule.id)).toContain("story-rule:mission-contract-loop")
    expect(packet.worldRules.map(rule => rule.id)).toContain("world-rule:system:guild-law")
    expect(packet.storyRules.map(rule => rule.id)).toContain("story-rule:earned-progression-payoff")
    expect(packet.characterRules.map(rule => rule.id)).toContain("char-rule:char-kael:driver")
    expect(packet.characterRules.map(rule => rule.id)).toContain("char-rule:char-kael:voice")
    expect(packet.relationshipRules.map(rule => rule.id)).toContain("rel-rule:kael:tessa")
    expect(packet.voiceRules.map(rule => rule.id)).toContain("voice-rule:close-pov-tactical")
  })

  test("selects a compact scene-specific rule slice and renders IDs", () => {
    const packet = buildAuthoringBiblePacket({
      genre: "adult mercenary progression fantasy",
      worldBible: worldBible(),
      characters: characters(),
    })
    const outline = chapterOutline()
    const slice = selectAuthoringBibleSlice({
      packet,
      outline,
      scene: outline.scenes[0]!,
      sceneIndex: 0,
    })

    expect(slice).not.toBeNull()
    const trace = summarizeAuthoringBibleSlice(slice!)
    expect(trace.ruleIds).toContain("story-rule:mission-contract-loop")
    expect(trace.ruleIds).toContain("world-rule:system:guild-law")
    expect(trace.ruleIds).toContain("char-rule:char-kael:driver")
    expect(trace.ruleIds).toContain("rel-rule:kael:tessa")
    expect(trace.counts.rules).toBeGreaterThan(0)

    const rendered = renderAuthoringBibleSlice(slice!)
    expect(rendered).toContain("AUTHORING BIBLE SLICE")
    expect(rendered).toContain("[story-rule:mission-contract-loop]")
    expect(rendered).toContain("[world-rule:system:guild-law]")
    expect(rendered).toContain("[char-rule:char-kael:driver]")
    expect(rendered).toContain("[voice-rule:close-pov-tactical]")
  })

  test("layers modular pack rules into the scene slice", () => {
    const packet = buildAuthoringBiblePacket({
      genre: "adult mercenary progression fantasy",
      worldBible: worldBible(),
      characters: characters(),
      packIds: ["rillgate-contrast-v1"],
    })
    const outline = chapterOutline()
    const slice = selectAuthoringBibleSlice({
      packet,
      outline,
      scene: outline.scenes[0]!,
      sceneIndex: 0,
    })

    expect(packet.packIds).toEqual(["rillgate-contrast-v1"])
    expect(slice).not.toBeNull()
    const ids = summarizeAuthoringBibleSlice(slice!).ruleIds
    expect(ids).toContain("pack:rillgate-contrast-v1:world:paper-is-weapon")
    expect(ids).toContain("pack:rillgate-contrast-v1:char:kael:risk-math")
    expect(ids).toContain("pack:rillgate-contrast-v1:char:tessa:line-and-point")
    expect(ids).toContain("pack:rillgate-contrast-v1:rel:kael-tessa:competence-before-trust")
    expect(ids).toContain("pack:rillgate-contrast-v1:voice:dialogue-fingerprints")
  })
})

describe("authoring bible binary verdicts", () => {
  test("derives verdicts from binary gates without numeric confidence", () => {
    expect(deriveAuthoringBibleVerdict({
      applicable: false,
      proseEvidencePresent: false,
      ruleSatisfied: null,
      contradictionPresent: false,
      evidenceSpecific: false,
    })).toBe("not_applicable")

    expect(deriveAuthoringBibleVerdict({
      applicable: true,
      proseEvidencePresent: true,
      ruleSatisfied: true,
      contradictionPresent: false,
      evidenceSpecific: true,
    })).toBe("pass")

    expect(deriveAuthoringBibleVerdict({
      applicable: true,
      proseEvidencePresent: true,
      ruleSatisfied: false,
      contradictionPresent: false,
      evidenceSpecific: true,
    })).toBe("miss")

    expect(deriveAuthoringBibleVerdict({
      applicable: true,
      proseEvidencePresent: true,
      ruleSatisfied: true,
      contradictionPresent: true,
      evidenceSpecific: true,
    })).toBe("miss")

    expect(deriveAuthoringBibleVerdict({
      applicable: true,
      proseEvidencePresent: false,
      ruleSatisfied: false,
      contradictionPresent: false,
      evidenceSpecific: false,
    })).toBe("uncertain")
  })
})

function characters(): CharacterProfile[] {
  return [
    {
      id: "char-kael",
      name: "Kael",
      role: "protagonist",
      backstory: "A bronze-ranked salvager with debt pressure.",
      traits: ["tactical", "guarded"],
      speechPattern: "short, bargaining, practical",
      goals: "Win clean contracts without begging the guild.",
      fears: "Being trapped as disposable labor.",
      avoids: "Open confession before he has leverage.",
      internalConflict: "Needs witnesses but hates owing them.",
      relationships: [{ characterName: "Tessa", nature: "rival who tests competence before offering trust" }],
      exampleLines: ["Price the risk first."],
      want: "independence",
      need: "credible witnesses",
      lie: "No one can help without owning him.",
      truth: "Trust can be negotiated without surrender.",
      arc_resolution: "partial",
    },
    {
      id: "char-tessa",
      name: "Tessa",
      role: "supporting",
      backstory: "A rival runner.",
      traits: ["sharp"],
      speechPattern: "dry, exacting",
      goals: "Avoid fools and collect what is owed.",
      fears: "Being attached to a doomed crew.",
      relationships: [{ characterName: "Kael", nature: "skeptical rival pressure" }],
      exampleLines: [],
    },
  ] as CharacterProfile[]
}

function worldBible(): WorldBible {
  return {
    setting: "Rillgate",
    timePeriod: "late guild age",
    geography: "salt roads and ruined mines",
    politicalStructure: "guild rank law",
    technologyConstraints: "bronze tools and illegal cores",
    socialCustoms: [],
    sensoryPalette: "salt dust, iron lamps, wet stone",
    rules: ["Contracts need witnesses to stand in guild court."],
    locations: [],
    culture: "guild debt culture",
    history: "old mines under faction pressure",
    systems: [{
      id: "guild-law",
      name: "Guild Law",
      type: "politics",
      description: "Ranked contracts and witness records govern salvage rights.",
      rules: ["Unwitnessed contracts weaken claims."],
      manifestations: [],
      vocabulary: ["bronze-ranked", "witnessed contract"],
      constraints: ["Unwitnessed salvage claims can be challenged."],
    }],
    cultures: [],
  }
}

function chapterOutline(): ChapterOutline {
  return {
    chapterId: "chapter-1",
    chapterNumber: 1,
    title: "The Toll Log",
    povCharacter: "Kael",
    povCharacterId: "char-kael",
    setting: "Rillgate gate",
    purpose: "Kael accepts an unwitnessed salvage contract and leaves poorer.",
    targetWords: 3100,
    charactersPresent: ["Kael", "Tessa"],
    charactersPresentIds: ["char-kael", "char-tessa"],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    scenes: [{
      sceneId: "scene-1",
      beatId: "beat-1",
      description: "Kael signs the unwitnessed guild contract while Tessa watches and the gate toll takes his last road coin.",
      kind: "dialogue",
      characters: ["Kael", "Tessa"],
      goal: "Clear the gate and keep the job.",
      opposition: "The clerk marks the job unwitnessed.",
      outcome: "Kael leaves with the unwitnessed mark.",
      consequence: "His salvage rights can be challenged later.",
      obligations: {
        mustEstablish: [],
        mustPayOff: [],
        mustTransferKnowledge: [],
        mustShowStateChange: [],
        mustNotReveal: [],
        allowedNewEntities: [],
      },
    }],
  } as unknown as ChapterOutline
}
