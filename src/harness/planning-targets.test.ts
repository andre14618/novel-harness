import { describe, expect, test } from "bun:test"

import { buildPlanningTargetMap } from "./planning-targets"
import type { CharacterProfile, ChapterOutline, SceneBeat, StorySpine, WorldBible } from "../types"

describe("buildPlanningTargetMap", () => {
  test("extracts durable planning targets from existing authoring artifacts", () => {
    const map = buildPlanningTargetMap({
      novelId: "target-map-test",
      seed: {
        premise: "A city resists a false cure.",
        genre: "fantasy",
        characters: [],
        directives: {
          lockedCharacters: [],
          requiredBeats: [],
          forbidden: [],
          tonalAnchors: ["restrained gothic"],
          structuralConstraints: {
            povRotation: "",
            pacing: "",
          },
          storyThreads: [],
          storyDebts: [],
          storyPayoffs: [],
          rawNotes: "Keep the narration spare.",
        },
      },
      world: { setting: "The bell city", rules: ["Bells carry memory"] } as WorldBible,
      characters: [character("char-istra", "Istra")],
      spine: { centralConflict: "Truth versus civic comfort" } as StorySpine,
      outlines: [outline()],
      worldSystems: [{
        id: "system-bells",
        name: "Memory Bells",
        type: "magic",
        description: "Bells preserve witnessed memory.",
        rules: ["Only witnessed memories bind."],
        manifestations: ["audible echoes"],
        vocabulary: ["chime-witness"],
        constraints: ["No invented memory can bind."],
      }],
      cultures: [{
        id: "culture-scribes",
        name: "Scribes",
        description: "Record keepers.",
        values: ["accuracy"],
        taboos: ["false witness"],
        speechInfluences: "precise",
        customs: ["public ledgers"],
        systemViews: {},
      }],
      planningSnapshotHash: "a".repeat(64),
    })

    expect(map.ok).toBe(true)
    expect(map.planningSnapshotVersion).toBe("v2")
    expect(map.targets.map((target) => `${target.kind}:${target.ref}`)).toEqual(
      expect.arrayContaining([
        "world_bible:target-map-test",
        "character:char-istra",
        "story_spine:target-map-test",
        "chapter_outline:ch-001-ledger-test",
        "scene_plan:ch-001-ledger-test-scene-001-istra-proves-ledger-forged-chooses",
        "beat_obligation:obl-ledger-fact",
        "world_fact:fact-ledger-forgery",
        "world_system:system-bells",
        "culture:culture-scribes",
        "planning_directive:rawNotes",
        "planning_directive:tonalAnchors",
      ]),
    )

    const beat = map.targets.find((target) =>
      target.kind === "scene_plan" &&
      target.ref === "ch-001-ledger-test-scene-001-istra-proves-ledger-forged-chooses"
    )
    expect(beat?.upstreamRefs).toEqual(
      expect.arrayContaining([
        { kind: "chapter_outline", ref: "ch-001-ledger-test" },
        { kind: "world_fact", ref: "fact-ledger-forgery" },
      ]),
    )
    const characterTarget = map.targets.find((target) =>
      target.kind === "character" &&
      target.ref === "char-istra"
    )
    expect(characterTarget?.fieldPaths).toEqual(
      expect.arrayContaining(["goals", "fears", "speechPattern"]),
    )
    const worldTarget = map.targets.find((target) =>
      target.kind === "world_bible" &&
      target.ref === "target-map-test"
    )
    expect(worldTarget?.fieldPaths).toEqual(
      expect.arrayContaining(["setting", "history", "sensoryPalette"]),
    )
    expect(worldTarget?.fieldPaths).not.toContain("rules")
    const spineTarget = map.targets.find((target) =>
      target.kind === "story_spine" &&
      target.ref === "target-map-test"
    )
    expect(spineTarget?.fieldPaths).toEqual([
      "centralConflict",
      "endingDirection",
      "theme",
    ])
    expect(spineTarget?.fieldPaths).not.toContain("acts")
    const obligation = map.targets.find((target) =>
      target.kind === "beat_obligation" &&
      target.ref === "obl-ledger-fact"
    )
    expect(obligation?.fieldPaths).toContain("sourceLink")
    const tonalAnchors = map.targets.find((target) =>
      target.kind === "planning_directive" &&
      target.ref === "tonalAnchors"
    )
    expect(tonalAnchors?.fieldPaths).toEqual(["tonalAnchors"])
    expect(map.validationFindings).toEqual([])
  })

  test("surfaces missing persisted IDs instead of silently treating them as clean", () => {
    const raw = outline({
      chapterId: undefined,
      scenes: [
        beat({
          sceneId: undefined,
          beatId: undefined,
          obligations: {
            mustEstablish: [
              { text: "Aldric falsified the plague ledgers", sourceKind: "fact" } as any,
            ],
            mustPayOff: [],
            mustTransferKnowledge: [],
            mustShowStateChange: [],
            mustNotReveal: [],
            allowedNewEntities: [],
          },
        }),
      ],
    })

    const map = buildPlanningTargetMap({
      novelId: "missing-id-test",
      seed: null,
      world: null,
      characters: [],
      spine: null,
      outlines: [raw],
      worldSystems: [],
      cultures: [],
      planningSnapshotHash: "b".repeat(64),
    })

    const codes = map.validationFindings.map((finding) => finding.code)
    expect(codes).toContain("missing-persisted-chapter-id")
    expect(codes).toContain("missing-persisted-scene-id")
    expect(codes).toContain("missing-persisted-obligation-id")
    expect(codes).toContain("missing-obligation-source-id")
  })
})

function character(id: string, name: string): CharacterProfile {
  return {
    id,
    name,
    role: "protagonist",
    backstory: "",
    traits: [],
    speechPattern: "",
    goals: "Expose the false cure.",
    fears: "Losing Wren.",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: [],
  } as CharacterProfile
}

function outline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-001-ledger-test",
    title: "Ledger Test",
    povCharacter: "Istra",
    povCharacterId: "char-istra",
    setting: "The Chancel Infirmary",
    purpose: "Reveal the forged ledger.",
    targetWords: 450,
    charactersPresent: ["Istra"],
    charactersPresentIds: ["char-istra"],
    scenes: [beat()],
    establishedFacts: [
      { id: "fact-ledger-forgery", fact: "Aldric falsified the plague ledgers", category: "knowledge" },
    ],
    knowledgeChanges: [],
    characterStateChanges: [],
    ...overrides,
  } as ChapterOutline
}

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description: "Istra proves the ledger is forged and chooses to protect Wren.",
    characters: ["Istra"],
    kind: "action",
    sceneId: "ch-001-ledger-test-scene-001-istra-proves-ledger-forged-chooses",
    beatId: "ch-001-ledger-test-beat-001-ledger-breaks",
    requiredPayoffs: [],
    obligations: {
      mustEstablish: [
        {
          obligationId: "obl-ledger-fact",
          sourceId: "fact-ledger-forgery",
          sourceKind: "fact",
          text: "Aldric falsified the plague ledgers",
        } as any,
      ],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    ...overrides,
  } as SceneBeat
}
