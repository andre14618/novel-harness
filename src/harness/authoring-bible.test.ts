import { describe, expect, test } from "bun:test"

import type { ChapterOutline, CharacterProfile, WorldBible } from "../types"
import {
  buildAuthoringBiblePacket,
  deriveAuthoringBibleVerdict,
  renderAuthoringBiblePromptSections,
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
    expect(trace.ruleSelections).toContainEqual({
      ruleId: "char-rule:char-kael:driver",
      kind: "character",
      reason: "scene_character_present",
      characterName: "Kael",
    })

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
    expect(renderAuthoringBibleSlice(slice!)).toContain("Four days. No witness. One patron")
  })

  test("keeps world-system rules out of scenes that do not need that system", () => {
    const packet = buildAuthoringBiblePacket({
      genre: "adult mercenary progression fantasy",
      worldBible: worldBibleWithBrineWards(),
      characters: characters(),
      packIds: ["rillgate-contrast-v1"],
    })
    const outline = chapterOutline()
    const streetScene = {
      ...outline.scenes[0]!,
      description: "Kael leaves the contract hall with Mira's debt marker and Lady Varn's address.",
      goal: "Choose whether to approach the patron before the sale date.",
      opposition: "The debt bell makes the marker feel transferable.",
      outcome: "Kael starts toward Copper Alley.",
      consequence: "He accepts that a patron owns the next move.",
      placeAnchor: "Rillgate street outside the Contract Hall",
    }
    const slice = selectAuthoringBibleSlice({ packet, outline, scene: streetScene, sceneIndex: 0 })
    const trace = summarizeAuthoringBibleSlice(slice!)
    const ids = trace.ruleIds

    expect(ids).toContain("world-rule:system:sys-debt-market")
    expect(ids).not.toContain("world-rule:system:sys-brine-wards")
    const debtSelection = trace.ruleSelections.find(selection => selection.ruleId === "world-rule:system:sys-debt-market")
    expect(debtSelection?.reason).toBe("selection_hint")
    expect(debtSelection?.matchedHints).toContain("marker")
  })

  test("includes brine-ward rules when the scene actually invokes ward pressure", () => {
    const packet = buildAuthoringBiblePacket({
      genre: "adult mercenary progression fantasy",
      worldBible: worldBibleWithBrineWards(),
      characters: characters(),
    })
    const outline = chapterOutline()
    const wardScene = {
      ...outline.scenes[0]!,
      description: "Kael enters the mine and sees a ward line bloom with salt under old blood.",
      goal: "Cross the brine ward without triggering the salt cloud.",
      opposition: "The ward line reacts to unranked blood near the stolen core.",
      outcome: "He marks the ward line and backs away.",
      consequence: "The route through the mine is narrower.",
      placeAnchor: "Gray Salt Mine wall",
    }
    const slice = selectAuthoringBibleSlice({ packet, outline, scene: wardScene, sceneIndex: 0 })
    const ids = summarizeAuthoringBibleSlice(slice!).ruleIds

    expect(ids).toContain("world-rule:system:sys-brine-wards")
  })

  test("does not feed earned-progression payoff for mere rank desire", () => {
    const packet = buildAuthoringBiblePacket({
      genre: "adult mercenary progression fantasy",
      worldBible: worldBible(),
      characters: characters(),
    })
    const outline = chapterOutline()
    const searchScene = {
      ...outline.scenes[0]!,
      description: "Kael searches postings for a rank path before Mira's marker sale.",
      goal: "Find a contract that might eventually earn bronze rank.",
      opposition: "Every posting is too slow or requires a witness.",
      outcome: "He asks Orin for a legal path.",
      consequence: "No rank is gained yet.",
    }
    const slice = selectAuthoringBibleSlice({ packet, outline, scene: searchScene, sceneIndex: 0 })
    const ids = summarizeAuthoringBibleSlice(slice!).ruleIds

    expect(ids).not.toContain("story-rule:earned-progression-payoff")
  })

  test("does not select relationship rules through a shared surname", () => {
    const packet = buildAuthoringBiblePacket({
      genre: "adult mercenary progression fantasy",
      characters: [{
        id: "char-kael-rusk",
        name: "Kael Rusk",
        role: "protagonist",
        backstory: "Debt-pressed salvager.",
        traits: ["guarded"],
        speechPattern: "short",
        goals: "Protect Mira's marker.",
        fears: "Losing leverage.",
        relationships: [{ characterName: "Mira Rusk", nature: "sibling debt pressure" }],
        culturalBackground: [],
        systemAwareness: [],
        exampleLines: [],
      }],
    })
    const outline = chapterOutline()
    const scene = {
      ...outline.scenes[0]!,
      characters: ["Kael Rusk"],
      description: "Kael Rusk scans the contract hall board alone.",
    }
    const slice = selectAuthoringBibleSlice({
      packet,
      outline: { ...outline, povCharacter: "Kael Rusk", scenes: [scene] },
      scene,
      sceneIndex: 0,
    })
    const ids = summarizeAuthoringBibleSlice(slice!).ruleIds

    expect(ids).not.toContain("rel-rule:kael-rusk:mira-rusk")
  })

  test("still matches honorific names by operative name", () => {
    const packet = buildAuthoringBiblePacket({
      genre: "adult mercenary progression fantasy",
      characters: [{
        id: "char-lady-varn",
        name: "Lady Varn",
        role: "patron",
        backstory: "Broker with polite pressure.",
        traits: ["controlled"],
        speechPattern: "precise velvet threats",
        goals: "Buy risk cheaply.",
        fears: "Public exposure.",
        relationships: [],
        culturalBackground: [],
        systemAwareness: [],
        exampleLines: [],
      }],
    })
    const outline = chapterOutline()
    const scene = {
      ...outline.scenes[0]!,
      characters: ["Varn"],
      description: "Varn reviews the contract from behind her desk.",
    }
    const slice = selectAuthoringBibleSlice({
      packet,
      outline: { ...outline, povCharacter: "Kael", scenes: [scene] },
      scene,
      sceneIndex: 0,
    })
    const ids = summarizeAuthoringBibleSlice(slice!).ruleIds

    expect(ids).toContain("char-rule:char-lady-varn:driver")
  })

  test("splits cache-stable prelude from scene-local rules without dropping selected IDs", () => {
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

    expect(slice).not.toBeNull()
    const sections = renderAuthoringBiblePromptSections(slice!)
    const trace = summarizeAuthoringBibleSlice(slice!)
    const renderedIds = [
      ...extractRuleIds(sections.stablePrelude),
      ...extractRuleIds(sections.sceneSlice),
    ]

    expect(sections.stablePrelude).toContain("AUTHORING BIBLE STABLE PRELUDE")
    expect(sections.sceneSlice).toContain("AUTHORING BIBLE SCENE SLICE")
    expect(sections.stablePreludeRuleIds).toContain("story-rule:scene-pressure-consequence")
    expect(sections.stablePreludeRuleIds).toContain("world-rule:sensory-palette-operational")
    expect(sections.stablePreludeRuleIds).toContain("voice-rule:close-pov-tactical")
    expect(sections.sceneSliceRuleIds).toContain("char-rule:char-kael:driver")
    expect(sections.sceneSliceRuleIds).not.toContain("voice-rule:close-pov-tactical")
    expect(new Set(renderedIds)).toEqual(new Set(trace.ruleIds))
    expect(renderedIds.length).toBe(trace.ruleIds.length)
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

function worldBibleWithBrineWards(): WorldBible {
  return {
    ...worldBible(),
    systems: [
      ...worldBible().systems,
      {
        id: "sys_brine_wards",
        name: "Brine Wards",
        type: "technology",
        description: "Chemical seals inscribed on mine walls that react to blood, rank tokens, and stolen cores.",
        rules: ["Blood triggers a ward within 5 feet.", "They do not work in open air."],
        manifestations: ["Inscribed symbols on mine walls.", "Salt crystals forming on surfaces."],
        vocabulary: ["ward line", "salt bloom", "brine cloud", "trigger"],
        constraints: ["Wards reset after a few hours."],
      },
      {
        id: "sys_debt_market",
        name: "Debt Market",
        type: "economy",
        description: "Creditors buy and sell debt markers.",
        rules: ["Markers can be sold without the debtor's consent."],
        manifestations: ["Creditors display markers on boards."],
        vocabulary: ["marker", "debt board", "sale date", "creditor"],
        constraints: ["Only physical markers can be traded."],
      },
    ],
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

function extractRuleIds(value: string | null): string[] {
  return [...(value ?? "").matchAll(/\[([^\]]+)\]/g)].map(match => match[1]!)
}
