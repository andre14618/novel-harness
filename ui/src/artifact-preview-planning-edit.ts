export type ArtifactPreviewSurface = "world" | "character" | "spine"

export type ArtifactPreviewPlanningTarget =
  | { kind: "world_bible"; ref: string; fieldPath: string }
  | { kind: "character"; ref: string; fieldPath: string }
  | { kind: "story_spine"; ref: string; fieldPath: string }

export type ArtifactPreviewPlanningEditMapping =
  | { ok: true; target: ArtifactPreviewPlanningTarget }
  | { ok: false; reason: string }

const SUPPORTED_FIELDS: Record<ArtifactPreviewSurface, ReadonlySet<string>> = {
  world: new Set([
    "setting",
    "timePeriod",
    "geography",
    "politicalStructure",
    "technologyConstraints",
    "sensoryPalette",
    "culture",
    "history",
  ]),
  character: new Set([
    "backstory",
    "goals",
    "fears",
    "speechPattern",
    "internalConflict",
    "avoids",
  ]),
  spine: new Set(["centralConflict", "theme", "endingDirection"]),
}

export function mapArtifactPreviewPlanningEdit(input: {
  surface: ArtifactPreviewSurface
  novelId: string
  fieldPath: string
  characterId?: string | null
}): ArtifactPreviewPlanningEditMapping {
  if (!SUPPORTED_FIELDS[input.surface].has(input.fieldPath)) {
    return {
      ok: false,
      reason: `${input.surface}.${input.fieldPath} is not supported by planning_edit proposals yet`,
    }
  }

  if (input.surface === "world") {
    return {
      ok: true,
      target: { kind: "world_bible", ref: input.novelId, fieldPath: input.fieldPath },
    }
  }

  if (input.surface === "spine") {
    return {
      ok: true,
      target: { kind: "story_spine", ref: input.novelId, fieldPath: input.fieldPath },
    }
  }

  if (!input.characterId) {
    return { ok: false, reason: "character.id is required to queue a planning_edit proposal" }
  }

  return {
    ok: true,
    target: { kind: "character", ref: input.characterId, fieldPath: input.fieldPath },
  }
}

export function unsupportedArtifactPreviewEditMessage(
  surface: ArtifactPreviewSurface,
  fieldPath: string,
): string {
  return `${surface}.${fieldPath} is read-only here because direct artifact edits are disabled and this field is not supported by planning_edit proposals yet.`
}
