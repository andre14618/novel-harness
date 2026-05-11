import { describe, expect, test } from "bun:test"
import { collectStructuralPlanningMutationLineage } from "./planning-structural-lineage"
import type { ChapterOutline } from "../types"

describe("collectStructuralPlanningMutationLineage", () => {
  test("records beat reorder by exact stable beat id without obligation noise", () => {
    const previous = outline([
      beat("beat-a", "Open the vault", [obligation("obl-a")]),
      beat("beat-b", "Inspect the map", [obligation("obl-b")]),
      beat("beat-c", "Close the gate", [obligation("obl-c")]),
    ])
    const next = outline([
      beat("beat-b", "Inspect the map", [obligation("obl-b")]),
      beat("beat-a", "Open the vault", [obligation("obl-a")]),
      beat("beat-c", "Close the gate", [obligation("obl-c")]),
    ])

    const drafts = collectStructuralPlanningMutationLineage(previous, next)

    expect(drafts.map((draft) => draft.metadata.structuralOperation)).toEqual([
      "beat_reorder",
      "beat_reorder",
    ])
    expect(drafts[0]).toMatchObject({
      targetKind: "scene_plan",
      previousRef: "beat-a",
      nextRef: "beat-a",
      fieldPath: "scenes",
      metadata: {
        previousIndex: 0,
        nextIndex: 1,
        exactIdMatch: true,
      },
    })
    expect(drafts[0]!.previousVersion).not.toBe(drafts[0]!.nextVersion)
    expect(drafts.every((draft) => draft.targetKind === "scene_plan")).toBe(true)
  })

  test("prefers sceneId over beatId for scene-level structural lineage", () => {
    const previous = outline([
      scene("scene-a", "beat-a", "Open the vault", [obligation("obl-a")]),
      scene("scene-b", "beat-b", "Inspect the map", [obligation("obl-b")]),
    ])
    const next = outline([
      scene("scene-b", "beat-b", "Inspect the map", [obligation("obl-b")]),
      scene("scene-a", "beat-a", "Open the vault", [obligation("obl-a")]),
    ])

    const drafts = collectStructuralPlanningMutationLineage(previous, next)

    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({
      targetKind: "scene_plan",
      previousRef: "scene-a",
      nextRef: "scene-a",
      metadata: {
        structuralOperation: "beat_reorder",
        previousSceneRef: "scene-a",
        nextSceneRef: "scene-a",
        previousSceneRefKind: "sceneId",
        nextSceneRefKind: "sceneId",
      },
    })
    expect(drafts[0]!.metadata.previousBeatId).toBeUndefined()
    expect(drafts[0]!.metadata.nextBeatId).toBeUndefined()
  })

  test("records beat replacement only when old and new ids supersede the same slot", () => {
    const previous = outline([
      beat("beat-a", "Open the vault"),
      beat("beat-b", "Inspect the map"),
    ])
    const next = outline([
      beat("beat-a", "Open the vault"),
      beat("beat-c", "Negotiate with the guards"),
    ])

    const drafts = collectStructuralPlanningMutationLineage(previous, next)

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      targetKind: "scene_plan",
      previousRef: "beat-b",
      nextRef: "beat-c",
      fieldPath: "scenes",
      metadata: {
        structuralOperation: "beat_replace",
        previousIndex: 1,
        nextIndex: 1,
        supersessionBasis: "same_index_exact_id_absence",
      },
    })
  })

  test("records scene selection removals without treating compressed slots as replacements", () => {
    const previous = outline([
      scene("scene-a", "beat-a", "Open the vault"),
      scene("scene-b", "beat-b", "Inspect the map"),
      scene("scene-c", "beat-c", "Close the gate"),
    ])
    const next = outline([
      scene("scene-a", "beat-a", "Open the vault"),
      scene("scene-c", "beat-c", "Close the gate"),
    ])

    const drafts = collectStructuralPlanningMutationLineage(previous, next)

    expect(drafts.some((draft) => draft.metadata.structuralOperation === "beat_replace")).toBe(false)
    expect(drafts).toContainEqual(expect.objectContaining({
      targetKind: "scene_plan",
      previousRef: "scene-b",
      nextRef: "scene-b",
      fieldPath: "scenes",
      metadata: expect.objectContaining({
        structuralOperation: "scene_select",
        previousIndex: 1,
        removedFromChapterScenes: true,
        previousSceneCount: 3,
        nextSceneCount: 2,
      }),
    }))
  })

  test("does not infer beat replacement when ids are missing", () => {
    const previous = outline([
      beat("beat-a", "Open the vault"),
      beat(undefined, "Legacy beat without id"),
    ])
    const next = outline([
      beat("beat-a", "Open the vault"),
      beat("beat-b", "New id in legacy slot"),
    ])

    expect(collectStructuralPlanningMutationLineage(previous, next)).toEqual([])
  })

  test("does not compress beat slots around missing ids when detecting replacements", () => {
    const previous = outline([
      beat(undefined, "Legacy opener"),
      beat("beat-a", "Open the vault"),
    ])
    const next = outline([
      beat("beat-b", "New opener"),
      beat("beat-c", "Negotiate with the guards"),
    ])

    const drafts = collectStructuralPlanningMutationLineage(previous, next)

    expect(drafts).toEqual([
      expect.objectContaining({
        previousRef: "beat-a",
        nextRef: "beat-c",
        metadata: expect.objectContaining({
          structuralOperation: "beat_replace",
          previousIndex: 1,
          nextIndex: 1,
        }),
      }),
    ])
  })

  test("records obligation reorder within a stable beat list", () => {
    const previous = outline([
      beat("beat-a", "Open the vault", [
        obligation("obl-a", "First"),
        obligation("obl-b", "Second"),
      ]),
    ])
    const next = outline([
      beat("beat-a", "Open the vault", [
        obligation("obl-b", "Second"),
        obligation("obl-a", "First"),
      ]),
    ])

    const drafts = collectStructuralPlanningMutationLineage(previous, next)

    expect(drafts.map((draft) => draft.metadata.structuralOperation)).toEqual([
      "obligation_reorder",
      "obligation_reorder",
    ])
    expect(drafts[0]).toMatchObject({
      targetKind: "beat_obligation",
      previousRef: "obl-a",
      nextRef: "obl-a",
      fieldPath: "obligations.mustEstablish",
      metadata: {
        previousBeatId: "beat-a",
        nextBeatId: "beat-a",
        previousIndex: 0,
        nextIndex: 1,
        exactIdMatch: true,
      },
    })
    expect(drafts[0]!.previousVersion).not.toBe(drafts[0]!.nextVersion)
  })

  test("records obligation replacement by same beat/list/index exact-id absence", () => {
    const previous = outline([
      beat("beat-a", "Open the vault", [
        obligation("obl-a", "First"),
        obligation("obl-b", "Second"),
      ]),
    ])
    const next = outline([
      beat("beat-a", "Open the vault", [
        obligation("obl-a", "First"),
        obligation("obl-c", "Replacement"),
      ]),
    ])

    const drafts = collectStructuralPlanningMutationLineage(previous, next)

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      targetKind: "beat_obligation",
      previousRef: "obl-b",
      nextRef: "obl-c",
      fieldPath: "obligations.mustEstablish",
      metadata: {
        structuralOperation: "obligation_replace",
        beatId: "beat-a",
        listKey: "mustEstablish",
        previousIndex: 1,
        nextIndex: 1,
        supersessionBasis: "same_beat_list_index_exact_id_absence",
      },
    })
  })
})

function outline(scenes: ChapterOutline["scenes"]): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-001-test",
    title: "Test Chapter",
    povCharacter: "Mara",
    setting: "Archive",
    purpose: "Exercise structural lineage",
    scenes,
    targetWords: 1000,
    charactersPresent: ["Mara"],
    charactersPresentIds: ["mara"],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  }
}

function beat(
  beatId: string | undefined,
  description: string,
  mustEstablish: Array<ReturnType<typeof obligation>> = [],
): NonNullable<ChapterOutline["scenes"]>[number] {
  return {
    ...(beatId !== undefined ? { beatId } : {}),
    description,
    characters: ["Mara"],
    kind: "action",
    requiredPayoffs: [],
    obligations: {
      mustEstablish,
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
  }
}

function scene(
  sceneId: string,
  beatId: string,
  description: string,
  mustEstablish: Array<ReturnType<typeof obligation>> = [],
): NonNullable<ChapterOutline["scenes"]>[number] {
  return {
    ...beat(beatId, description, mustEstablish),
    sceneId,
  }
}

function obligation(obligationId: string, text = "Establish a fact") {
  return {
    obligationId,
    text,
    sourceId: `fact-${obligationId}`,
    sourceKind: "fact" as const,
  }
}
