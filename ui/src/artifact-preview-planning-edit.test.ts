import { describe, expect, test } from "bun:test"
import {
  mapArtifactPreviewPlanningEdit,
  unsupportedArtifactPreviewEditMessage,
} from "./artifact-preview-planning-edit"

describe("mapArtifactPreviewPlanningEdit", () => {
  test("maps supported world fields to world_bible planning_edit targets", () => {
    expect(mapArtifactPreviewPlanningEdit({
      surface: "world",
      novelId: "novel-1",
      fieldPath: "setting",
    })).toEqual({
      ok: true,
      target: { kind: "world_bible", ref: "novel-1", fieldPath: "setting" },
    })
  })

  test("maps supported character fields only when a character id is present", () => {
    expect(mapArtifactPreviewPlanningEdit({
      surface: "character",
      novelId: "novel-1",
      characterId: "char-asta",
      fieldPath: "goals",
    })).toEqual({
      ok: true,
      target: { kind: "character", ref: "char-asta", fieldPath: "goals" },
    })

    expect(mapArtifactPreviewPlanningEdit({
      surface: "character",
      novelId: "novel-1",
      fieldPath: "goals",
    })).toEqual({
      ok: false,
      reason: "character.id is required to queue a planning_edit proposal",
    })
  })

  test("maps supported spine fields to story_spine planning_edit targets", () => {
    expect(mapArtifactPreviewPlanningEdit({
      surface: "spine",
      novelId: "novel-1",
      fieldPath: "endingDirection",
    })).toEqual({
      ok: true,
      target: { kind: "story_spine", ref: "novel-1", fieldPath: "endingDirection" },
    })
  })

  test("rejects unsupported direct-edit fields instead of inventing targets", () => {
    expect(mapArtifactPreviewPlanningEdit({
      surface: "character",
      novelId: "novel-1",
      characterId: "char-asta",
      fieldPath: "name",
    })).toEqual({
      ok: false,
      reason: "character.name is not supported by planning_edit proposals yet",
    })

    expect(unsupportedArtifactPreviewEditMessage("world", "rules")).toContain("read-only")
  })
})
