import { describe, expect, test } from "bun:test"
import {
  buildPlanningEditDiff,
  buildPlanningEditEnvelope,
  planningEditTargetSchema,
  planningEditTargetsSameArtifact,
  validatePlanningEditActionTarget,
  validatePlanningEditProposedValue,
  validatePlanningEditValue,
} from "./planning-edit-proposal"

const now = new Date("2026-05-04T12:00:00.000Z")

describe("planning edit proposals", () => {
  test("builds deterministic manual-queue envelopes for chapter-outline fields", () => {
    const a = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      target: {
        kind: "chapter_outline",
        ref: "ch-001-ledger-test",
        fieldPath: "purpose",
        currentVersion: "a".repeat(64),
      },
      previousValue: "Reveal the ledger.",
      proposedValue: "Reveal the ledger and force Istra to choose.",
      rationale: "Make the chapter turn clearer.",
      source: { agent: "test" },
      impactPreview: {
        planningSnapshotHash: "b".repeat(64),
        impacts: [{
          kind: "direct_target",
          target: { kind: "chapter_outline", ref: "ch-001-ledger-test" },
        }],
      },
      now,
    })
    const b = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      target: {
        kind: "chapter_outline",
        ref: "ch-001-ledger-test",
        fieldPath: "purpose",
        currentVersion: "a".repeat(64),
      },
      previousValue: "Reveal the ledger.",
      proposedValue: "Reveal the ledger and force Istra to choose.",
      rationale: "Make the chapter turn clearer.",
      source: { agent: "test" },
      impactPreview: {
        planningSnapshotHash: "b".repeat(64),
        impacts: [{
          kind: "direct_target",
          target: { kind: "chapter_outline", ref: "ch-001-ledger-test" },
        }],
      },
      now,
    })

    expect(a.id).toBe(b.id)
    expect(a.kind).toBe("planning_edit")
    expect(a.target).toEqual({
      kind: "chapter_outline",
      ref: "ch-001-ledger-test",
      fieldPath: "purpose",
      currentVersion: "a".repeat(64),
    })
    expect(a.precondition).toEqual({ kind: "artifact_hash", hash: "a".repeat(64) })
    expect(a.policyRecommendation.decision).toBe("queue")
    expect(a.risk).toBe("medium")
    expect(a.payload.impactPreview?.impacts[0]?.target.ref).toBe("ch-001-ledger-test")
  })

  test("builds scene-plan envelopes with scene target refs", () => {
    const env = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      target: {
        kind: "scene_plan",
        ref: "ch-001-ledger-test-beat-001-ledger-breaks",
        fieldPath: "description",
        currentVersion: "c".repeat(64),
      },
      previousValue: "Istra proves the ledger is forged.",
      proposedValue: "Istra proves the ledger is forged and chooses public risk.",
      rationale: "Make the beat action clearer.",
      source: { agent: "test" },
      now,
    })

    expect(env.kind).toBe("planning_edit")
    expect(env.target.kind).toBe("scene_plan")
    expect(env.target.ref).toBe("ch-001-ledger-test-beat-001-ledger-breaks")
    expect(env.target.fieldPath).toBe("description")
    expect(env.precondition.hash).toBe("c".repeat(64))
    expect(env.risk).toBe("medium")
  })

  test("builds beat-obligation envelopes with obligation target refs", () => {
    const env = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      target: {
        kind: "beat_obligation",
        ref: "obl-ledger-fact",
        fieldPath: "text",
        currentVersion: "d".repeat(64),
      },
      previousValue: "Aldric falsified the plague ledgers",
      proposedValue: "Istra establishes Aldric falsified the plague ledgers",
      rationale: "Make the obligation actionable for the writer.",
      source: { agent: "test" },
      now,
    })

    expect(env.kind).toBe("planning_edit")
    expect(env.target.kind).toBe("beat_obligation")
    expect(env.target.ref).toBe("obl-ledger-fact")
    expect(env.target.fieldPath).toBe("text")
    expect(env.precondition.hash).toBe("d".repeat(64))
  })

  test("builds beat-obligation source-link envelopes", () => {
    const env = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      target: {
        kind: "beat_obligation",
        ref: "obl-knowledge-transfer",
        fieldPath: "sourceLink",
        currentVersion: "e".repeat(64),
      },
      previousValue: {
        sourceId: "know-istra-old-ledger",
        sourceKind: "knowledge",
        characterId: "char-istra",
      },
      proposedValue: {
        sourceId: "know-istra-ledger-forgery",
        sourceKind: "knowledge",
        characterId: "char-istra",
      },
      rationale: "Retarget the obligation to the durable knowledge source.",
      source: { agent: "test" },
      now,
    })

    expect(env.kind).toBe("planning_edit")
    expect(env.target.kind).toBe("beat_obligation")
    expect(env.target.fieldPath).toBe("sourceLink")
    expect(env.payload.proposedValue).toEqual({
      sourceId: "know-istra-ledger-forgery",
      sourceKind: "knowledge",
      characterId: "char-istra",
    })
  })

  test("builds planning-directive envelopes for style and voice fields", () => {
    const env = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      target: {
        kind: "planning_directive",
        ref: "tonalAnchors",
        fieldPath: "tonalAnchors",
        currentVersion: "f".repeat(64),
      },
      previousValue: ["restrained gothic"],
      proposedValue: ["restrained gothic", "plainspoken dread"],
      rationale: "Add a clearer voice anchor.",
      source: { agent: "test" },
      now,
    })

    expect(env.kind).toBe("planning_edit")
    expect(env.target.kind).toBe("planning_directive")
    expect(env.target.ref).toBe("tonalAnchors")
    expect(env.target.fieldPath).toBe("tonalAnchors")
    expect(env.payload.proposedValue).toEqual(["restrained gothic", "plainspoken dread"])
  })

  test("builds character-bible envelopes for motivation and voice fields", () => {
    const env = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      target: {
        kind: "character",
        ref: "char-istra",
        fieldPath: "speechPattern",
        currentVersion: "1".repeat(64),
      },
      previousValue: "Precise, guarded, terse.",
      proposedValue: "Precise and guarded, with abrupt questions under pressure.",
      rationale: "Make the character voice more actionable.",
      source: { agent: "test" },
      now,
    })

    expect(env.kind).toBe("planning_edit")
    expect(env.target.kind).toBe("character")
    expect(env.target.ref).toBe("char-istra")
    expect(env.target.fieldPath).toBe("speechPattern")
    expect(env.payload.proposedValue).toBe(
      "Precise and guarded, with abrupt questions under pressure.",
    )
  })

  test("builds world-bible and story-spine envelopes for scalar fields", () => {
    const world = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      target: {
        kind: "world_bible",
        ref: "novel-plan-edit",
        fieldPath: "setting",
        currentVersion: "2".repeat(64),
      },
      previousValue: "The bell city",
      proposedValue: "The bell city above a drowned archive.",
      rationale: "Make the setting more concrete.",
      source: { agent: "test" },
      now,
    })
    const spine = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      target: {
        kind: "story_spine",
        ref: "novel-plan-edit",
        fieldPath: "theme",
        currentVersion: "3".repeat(64),
      },
      previousValue: "Truth versus comfort.",
      proposedValue: "Truth costs comfort before it earns trust.",
      rationale: "Sharpen the theme.",
      source: { agent: "test" },
      now,
    })

    expect(world.kind).toBe("planning_edit")
    expect(world.target.kind).toBe("world_bible")
    expect(world.target.fieldPath).toBe("setting")
    expect(world.payload.proposedValue).toBe("The bell city above a drowned archive.")
    expect(spine.target.kind).toBe("story_spine")
    expect(spine.target.fieldPath).toBe("theme")
    expect(spine.payload.proposedValue).toBe("Truth costs comfort before it earns trust.")
  })

  test("builds structural planning edit envelopes with explicit action labels", () => {
    const env = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      action: "beat_reorder",
      target: {
        kind: "chapter_outline",
        ref: "ch-001-ledger-test",
        fieldPath: "scenes",
        currentVersion: "4".repeat(64),
      },
      previousValue: ["beat-a", "beat-b"],
      proposedValue: ["beat-b", "beat-a"],
      rationale: "Move the confrontation earlier.",
      source: { agent: "test" },
      now,
    })

    expect(env.kind).toBe("planning_edit")
    expect(env.payload.action).toBe("beat_reorder")
    expect(env.target.fieldPath).toBe("scenes")
    expect(env.summary).toBe("Update chapter_outline ch-001-ledger-test: scenes")
    expect(env.risk).toBe("medium")
  })

  test("builds beat requirement removal envelopes", () => {
    const env = buildPlanningEditEnvelope({
      novelId: "novel-plan-edit",
      action: "beat_requirement_remove",
      target: {
        kind: "scene_plan",
        ref: "beat-oath-road",
        fieldPath: "requirements",
        currentVersion: "5".repeat(64),
      },
      previousValue: {
        requiredCharacterIds: ["char-istra", "char-vey"],
        requiredWorldFactIds: ["world-oath-road"],
      },
      proposedValue: {
        requiredCharacterIds: ["char-istra"],
        requiredWorldFactIds: ["world-oath-road"],
      },
      rationale: "Remove a non-material required character from the scene contract.",
      source: { agent: "test" },
      now,
    })

    expect(env.kind).toBe("planning_edit")
    expect(env.payload.action).toBe("beat_requirement_remove")
    expect(env.target.kind).toBe("scene_plan")
    expect(env.target.fieldPath).toBe("requirements")
    expect(env.summary).toBe("Update scene_plan beat-oath-road: requirements")
  })

  test("targetWords is valid only as a positive integer", () => {
    expect(validatePlanningEditValue("targetWords", 1800)).toBeNull()
    expect(validatePlanningEditValue("targetWords", 0)).toMatch(/positive integer/)
    expect(validatePlanningEditValue("targetWords", "1800")).toMatch(/positive integer/)
  })

  test("beat kind accepts only known beat kinds", () => {
    expect(validatePlanningEditValue("kind", "dialogue")).toBeNull()
    expect(validatePlanningEditValue("kind", "montage")).toMatch(/kind must be one of/)
  })

  test("obligation text must be non-empty", () => {
    expect(validatePlanningEditValue("text", "Establish the forged ledger.")).toBeNull()
    expect(validatePlanningEditValue("text", "")).toMatch(/text must be a non-empty string/)
  })

  test("obligation source-link fields validate stable IDs and kind shape", () => {
    expect(validatePlanningEditValue("sourceId", "fact-ledger-forgery")).toBeNull()
    expect(validatePlanningEditValue("sourceId", "Fact Ledger")).toMatch(/stable-ID/)
    expect(validatePlanningEditValue("sourceKind", "knowledge")).toBeNull()
    expect(validatePlanningEditValue("sourceKind", "avoid")).toMatch(/sourceKind must be one of/)
    expect(validatePlanningEditValue("characterId", "char-istra")).toBeNull()
    expect(validatePlanningEditValue("sourceLink", {
      sourceId: "know-istra-ledger-forgery",
      sourceKind: "knowledge",
      characterId: "char-istra",
    })).toBeNull()
    expect(validatePlanningEditValue("sourceLink", {
      sourceId: "know-istra-ledger-forgery",
      sourceKind: "knowledge",
    })).toMatch(/characterId is required/)
    expect(validatePlanningEditValue("sourceLink", {
      sourceId: "fact-ledger-forgery",
      sourceKind: "fact",
    })).toBeNull()
  })

  test("planning directive values validate style and voice field shape", () => {
    expect(validatePlanningEditValue("rawNotes", "")).toBeNull()
    expect(validatePlanningEditValue("rawNotes", "Keep narration spare.")).toBeNull()
    expect(validatePlanningEditValue("rawNotes", 12)).toMatch(/rawNotes must be a string/)
    expect(validatePlanningEditValue("tonalAnchors", ["spare gothic", "dry wit"])).toBeNull()
    expect(validatePlanningEditValue("tonalAnchors", "spare gothic")).toMatch(/array/)
    expect(validatePlanningEditValue("tonalAnchors", [""])).toMatch(/non-empty/)
  })

  test("character bible scalar values validate as bounded prose strings", () => {
    expect(validatePlanningEditValue("goals", "Expose Aldric without losing Wren.")).toBeNull()
    expect(validatePlanningEditValue("fears", "")).toMatch(/non-empty/)
    expect(validatePlanningEditValue("speechPattern", 12)).toMatch(/must be a string/)
    expect(validatePlanningEditValue("speechPattern", "x".repeat(601))).toMatch(/600 characters/)
    expect(validatePlanningEditValue("internalConflict", "x".repeat(2001))).toMatch(/2000 characters/)
    expect(validatePlanningEditValue("avoids", "contact\u0000bad")).toMatch(/control characters/)
  })

  test("world and spine scalar values validate as bounded prose strings", () => {
    expect(validatePlanningEditValue("setting", "The bell city.")).toBeNull()
    expect(validatePlanningEditValue("centralConflict", "Truth versus comfort.")).toBeNull()
    expect(validatePlanningEditValue("theme", "")).toMatch(/non-empty/)
    expect(validatePlanningEditValue("history", 12)).toMatch(/must be a string/)
    expect(validatePlanningEditValue("endingDirection", "x".repeat(2001))).toMatch(/2000 characters/)
    expect(validatePlanningEditValue("sensoryPalette", "bells\u0000bad")).toMatch(/control characters/)
    expect(planningEditTargetSchema.safeParse({
      kind: "world_bible",
      ref: "novel-plan-edit",
      fieldPath: "rules",
    }).success).toBe(false)
    expect(planningEditTargetSchema.safeParse({
      kind: "story_spine",
      ref: "novel-plan-edit",
      fieldPath: "acts",
    }).success).toBe(false)
  })

  test("scene-plan target fields validate as stable-id planning fields", () => {
    expect(planningEditTargetSchema.safeParse({
      kind: "scene_plan",
      ref: "beat-a",
      fieldPath: "requiredCharacterIds",
    }).success).toBe(true)
    expect(planningEditTargetSchema.safeParse({
      kind: "scene_plan",
      ref: "beat-a",
      fieldPath: "affectedCharacterIds",
    }).success).toBe(true)
    // Keep legacy alias for older payloads.
    expect(planningEditTargetSchema.safeParse({
      kind: "beat_plan",
      ref: "beat-a",
      fieldPath: "requiredCharacterIds",
    }).success).toBe(true)
    expect(validatePlanningEditValue("requiredCharacterIds", ["char-istra", "char-vey"]))
      .toBeNull()
    expect(validatePlanningEditValue("affectedCharacterIds", []))
      .toBeNull()
    expect(validatePlanningEditValue("requiredCharacterIds", ["char-istra", "char-istra"]))
      .toMatch(/duplicate/)
    expect(validatePlanningEditValue("affectedCharacterIds", ["Char Istra"]))
      .toMatch(/stable-ID/)
  })

  test("structural action targets and proposed values validate deterministically", () => {
    // Structural action contracts are intentionally still exercised with
    // `beat_plan` to match existing route/action compatibility.
    expect(validatePlanningEditActionTarget("beat_replace", {
      kind: "beat_plan",
      ref: "beat-a",
      fieldPath: "self",
    })).toBeNull()
    expect(validatePlanningEditActionTarget("beat_replace", {
      kind: "beat_plan",
      ref: "beat-a",
      fieldPath: "description",
    })).toMatch(/fieldPath=self/)

    expect(validatePlanningEditProposedValue("beat_replace", {
      kind: "beat_plan",
      ref: "beat-a",
      fieldPath: "self",
    }, {
      beatId: "beat-b",
      description: "Move the accusation earlier.",
      kind: "dialogue",
    })).toBeNull()
    expect(validatePlanningEditProposedValue("beat_replace", {
      kind: "beat_plan",
      ref: "beat-a",
      fieldPath: "self",
    }, {
      beatId: "beat-a",
      description: "Same id is not a replacement.",
    })).toMatch(/must differ/)
    expect(validatePlanningEditProposedValue("beat_reorder", {
      kind: "chapter_outline",
      ref: "ch-001",
      fieldPath: "scenes",
    }, ["beat-a", "beat-a"])).toMatch(/duplicate/)
    expect(validatePlanningEditProposedValue("beat_obligation_reorder", {
      kind: "beat_plan",
      ref: "beat-a",
      fieldPath: "obligations",
    }, {
      listKey: "mustEstablish",
      order: ["obl-b", "obl-a"],
    })).toBeNull()
    expect(validatePlanningEditActionTarget("beat_requirement_remove", {
      kind: "scene_plan",
      ref: "beat-a",
      fieldPath: "requirements",
    })).toBeNull()
    expect(validatePlanningEditActionTarget("beat_requirement_remove", {
      kind: "beat_plan",
      ref: "beat-a",
      fieldPath: "description",
    })).toMatch(/fieldPath=requirements/)
    expect(validatePlanningEditProposedValue("beat_requirement_remove", {
      kind: "scene_plan",
      ref: "beat-a",
      fieldPath: "requirements",
    }, {
      requiredCharacterIds: ["char-hero"],
      requiredWorldFactIds: [],
    })).toBeNull()
    expect(validatePlanningEditProposedValue("beat_requirement_remove", {
      kind: "beat_plan",
      ref: "beat-a",
      fieldPath: "requirements",
    }, {
      requiredCharacterIds: ["char-hero", "char-hero"],
      requiredWorldFactIds: [],
    })).toMatch(/duplicate/)
  })

  test("builds deterministic before/after diffs for planning edits", () => {
    const diff = buildPlanningEditDiff({
      action: "field_replace",
      target: {
        kind: "beat_obligation",
        ref: "obl-ledger-fact",
        fieldPath: "sourceLink",
      },
      previousValue: {
        sourceId: "fact-ledger-forgery",
        sourceKind: "fact",
      },
      proposedValue: {
        sourceId: "fact-aldrics-motive",
        sourceKind: "fact",
      },
    })

    expect(diff.target.ref).toBe("obl-ledger-fact")
    expect(diff.before.display).toContain("fact-ledger-forgery")
    expect(diff.after.display).toContain("fact-aldrics-motive")
    expect(diff.before.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(diff.after.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(diff.changed).toBe(true)
    expect(buildPlanningEditDiff({
      action: "field_replace",
      target: { kind: "chapter_outline", ref: "ch-1", fieldPath: "purpose" },
      previousValue: "same",
      proposedValue: "same",
    }).changed).toBe(false)
    expect(buildPlanningEditDiff({
      action: "field_replace",
      target: { kind: "chapter_outline", ref: "ch-1", fieldPath: "purpose" },
      previousValue: { a: 1, b: 2 },
      proposedValue: { b: 2, a: 1 },
    }).changed).toBe(false)
  })

  test("modified payloads must keep the same target field", () => {
    const base = {
      action: "field_replace" as const,
      target: { kind: "chapter_outline" as const, ref: "ch-1", fieldPath: "purpose" as const },
      previousValue: "old",
      proposedValue: "new",
    }
    expect(planningEditTargetsSameArtifact(base, { ...base, proposedValue: "newer" })).toBe(true)
    expect(planningEditTargetsSameArtifact(base, {
      ...base,
      target: { ...base.target, fieldPath: "setting" },
    })).toBe(false)
    expect(planningEditTargetsSameArtifact(
      {
        action: "field_replace",
        target: {
          kind: "scene_plan",
          ref: "beat-1",
          fieldPath: "description",
        },
        previousValue: "old",
        proposedValue: "new",
      },
      {
        action: "field_replace",
        target: {
          kind: "beat_plan",
          ref: "beat-1",
          fieldPath: "kind",
        },
        previousValue: "action",
        proposedValue: "dialogue",
      },
    )).toBe(false)
    // Alias mapping keeps `scene_plan` and `beat_plan` on the same underlying
    // artifact for compatibility checks.
    expect(planningEditTargetsSameArtifact(
      {
        action: "field_replace",
        target: {
          kind: "scene_plan",
          ref: "beat-1",
          fieldPath: "description",
        },
        previousValue: "old",
        proposedValue: "new",
      },
      {
        action: "field_replace",
        target: {
          kind: "beat_plan",
          ref: "beat-1",
          fieldPath: "description",
        },
        previousValue: "old",
        proposedValue: "newer",
      },
    )).toBe(true)
    expect(planningEditTargetsSameArtifact(
      {
        action: "field_replace",
        target: {
          kind: "beat_obligation",
          ref: "obl-1",
          fieldPath: "text",
        },
        previousValue: "old",
        proposedValue: "new",
      },
      {
        action: "field_replace",
        target: {
          kind: "beat_obligation",
          ref: "obl-2",
          fieldPath: "text",
        },
        previousValue: "old",
        proposedValue: "new",
      },
    )).toBe(false)
    expect(planningEditTargetsSameArtifact(
      {
        action: "field_replace",
        target: {
          kind: "planning_directive",
          ref: "rawNotes",
          fieldPath: "rawNotes",
        },
        previousValue: "old",
        proposedValue: "new",
      },
      {
        action: "field_replace",
        target: {
          kind: "planning_directive",
          ref: "tonalAnchors",
          fieldPath: "tonalAnchors",
        },
        previousValue: [],
        proposedValue: ["new"],
      },
    )).toBe(false)
    expect(planningEditTargetsSameArtifact(
      {
        action: "field_replace",
        target: {
          kind: "character",
          ref: "char-istra",
          fieldPath: "goals",
        },
        previousValue: "old",
        proposedValue: "new",
      },
      {
        action: "field_replace",
        target: {
          kind: "character",
          ref: "char-istra",
          fieldPath: "speechPattern",
        },
        previousValue: "old",
        proposedValue: "new",
      },
    )).toBe(false)
    expect(planningEditTargetsSameArtifact(
      {
        action: "field_replace",
        target: {
          kind: "world_bible",
          ref: "novel-plan-edit",
          fieldPath: "setting",
        },
        previousValue: "old",
        proposedValue: "new",
      },
      {
        action: "field_replace",
        target: {
          kind: "world_bible",
          ref: "novel-plan-edit",
          fieldPath: "history",
        },
        previousValue: "old",
        proposedValue: "new",
      },
    )).toBe(false)
    expect(planningEditTargetsSameArtifact(
      {
        action: "field_replace",
        target: {
          kind: "story_spine",
          ref: "novel-plan-edit",
          fieldPath: "theme",
        },
        previousValue: "old",
        proposedValue: "new",
      },
      {
        action: "field_replace",
        target: {
          kind: "story_spine",
          ref: "novel-plan-edit",
          fieldPath: "theme",
        },
        previousValue: "old",
        proposedValue: "newer",
      },
    )).toBe(true)
  })
})
