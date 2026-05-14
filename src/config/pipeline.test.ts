import { expect, test, describe } from "bun:test"
import {
  pipeline,
  resolveSceneCallWriterV1,
  resolveWriterExpansionMode,
  resolveForceRenderSceneContractWhenAvailable,
  resolveWriterPromptIdRendering,
  resolveDraftCaptureModeV1,
  resolveLintAutoFixEnabled,
  resolveScenePlanContractV1,
  resolveNativePlanningContractV1,
  resolvePlanningMaterialPressureV1,
  resolvePlanningSceneTurnShapingV1,
  resolveSceneSatisfactionCheckerV1,
  resolveSceneEntityGroundingMode,
  resolveWriterDraftingBriefMode,
} from "./pipeline"

describe("pipeline default flag values (production runtime)", () => {
  test("writer-arm experiment flags preserve production defaults", () => {
    expect(pipeline.sceneCallWriterV1).toBe(false)
    expect(pipeline.writerExpansionMode).toBe("off")
    expect(pipeline.forceRenderSceneContractWhenAvailable).toBe(true)
    expect(pipeline.writerPromptIdRendering).toBe("raw")
    expect(pipeline.writerDraftingBriefMode).toBe("off")
    expect(pipeline.draftCaptureModeV1).toBe(false)
    expect(pipeline.lintAutoFixEnabled).toBe(false)
    expect(pipeline.scenePlanContractV1).toBe(false)
    expect(pipeline.planningSceneTurnShapingV1).toBe(false)
    expect(pipeline.planningMaterialPressureV1).toBe(false)
    expect(pipeline.sceneSatisfactionCheckerV1).toBe(false)
    expect(pipeline.sceneEntityGroundingMode).toBe("off")
  })

  test("writerContextMode default is the production-wired thread-character-context-v1", () => {
    expect(pipeline.writerContextMode).toBe("thread-character-context-v1")
  })

  test("nativePlanningContractV1 default is the production-wired true", () => {
    expect(pipeline.nativePlanningContractV1).toBe(true)
  })
})

describe("override resolvers fall back to pipeline defaults when override absent or undefined", () => {
  test("resolveSceneCallWriterV1", () => {
    expect(resolveSceneCallWriterV1(undefined)).toBe(false)
    expect(resolveSceneCallWriterV1({})).toBe(false)
    expect(resolveSceneCallWriterV1({ sceneCallWriterV1: true })).toBe(true)
  })

  test("resolveWriterExpansionMode", () => {
    expect(resolveWriterExpansionMode(undefined)).toBe("off")
    expect(resolveWriterExpansionMode({})).toBe("off")
    expect(resolveWriterExpansionMode({ writerExpansionMode: "retry-short-scenes-v1" })).toBe("retry-short-scenes-v1")
  })

  test("resolveForceRenderSceneContractWhenAvailable", () => {
    expect(resolveForceRenderSceneContractWhenAvailable(undefined)).toBe(true)
    expect(resolveForceRenderSceneContractWhenAvailable({})).toBe(true)
    expect(resolveForceRenderSceneContractWhenAvailable({ forceRenderSceneContractWhenAvailable: true })).toBe(true)
    expect(resolveForceRenderSceneContractWhenAvailable({ forceRenderSceneContractWhenAvailable: false })).toBe(false)
  })

  test("resolveWriterPromptIdRendering", () => {
    expect(resolveWriterPromptIdRendering(undefined)).toBe("raw")
    expect(resolveWriterPromptIdRendering({})).toBe("raw")
    expect(resolveWriterPromptIdRendering({ writerPromptIdRendering: "suppress" })).toBe("suppress")
    expect(resolveWriterPromptIdRendering({ writerPromptIdRendering: "raw" })).toBe("raw")
  })

  test("resolveWriterDraftingBriefMode", () => {
    expect(resolveWriterDraftingBriefMode(undefined)).toBe("off")
    expect(resolveWriterDraftingBriefMode({})).toBe("off")
    expect(resolveWriterDraftingBriefMode({ writerDraftingBriefMode: "scene-budget-v1" })).toBe("scene-budget-v1")
    expect(resolveWriterDraftingBriefMode({ writerDraftingBriefMode: "scene-budget-tight-v1" })).toBe("scene-budget-tight-v1")
    expect(resolveWriterDraftingBriefMode({ writerDraftingBriefMode: "scene-turn-v1" })).toBe("scene-turn-v1")
    expect(resolveWriterDraftingBriefMode({ writerDraftingBriefMode: "scene-turn-anchored-v1" })).toBe("scene-turn-anchored-v1")
    expect(resolveWriterDraftingBriefMode({ writerDraftingBriefMode: "scene-budget-tight-anchored-v1" })).toBe("scene-budget-tight-anchored-v1")
  })

  test("resolveDraftCaptureModeV1", () => {
    expect(resolveDraftCaptureModeV1(undefined)).toBe(false)
    expect(resolveDraftCaptureModeV1({})).toBe(false)
    expect(resolveDraftCaptureModeV1({ draftCaptureModeV1: true })).toBe(true)
  })

  test("resolveLintAutoFixEnabled", () => {
    expect(resolveLintAutoFixEnabled(undefined)).toBe(false)
    expect(resolveLintAutoFixEnabled({})).toBe(false)
    expect(resolveLintAutoFixEnabled({ lintAutoFixEnabled: true })).toBe(true)
  })

  test("resolveScenePlanContractV1", () => {
    expect(resolveScenePlanContractV1(undefined)).toBe(false)
    expect(resolveScenePlanContractV1({ scenePlanContractV1: true })).toBe(true)
  })

  test("resolveNativePlanningContractV1", () => {
    expect(resolveNativePlanningContractV1(undefined)).toBe(true)
    expect(resolveNativePlanningContractV1({ nativePlanningContractV1: false })).toBe(false)
  })

  test("resolvePlanningSceneTurnShapingV1", () => {
    expect(resolvePlanningSceneTurnShapingV1(undefined)).toBe(false)
    expect(resolvePlanningSceneTurnShapingV1({})).toBe(false)
    expect(resolvePlanningSceneTurnShapingV1({ planningSceneTurnShapingV1: true })).toBe(true)
  })

  test("resolvePlanningMaterialPressureV1", () => {
    expect(resolvePlanningMaterialPressureV1(undefined)).toBe(false)
    expect(resolvePlanningMaterialPressureV1({})).toBe(false)
    expect(resolvePlanningMaterialPressureV1({ planningMaterialPressureV1: true })).toBe(true)
  })

  test("resolveSceneSatisfactionCheckerV1", () => {
    expect(resolveSceneSatisfactionCheckerV1(undefined)).toBe(false)
    expect(resolveSceneSatisfactionCheckerV1({ sceneSatisfactionCheckerV1: true })).toBe(true)
  })

  test("resolveSceneEntityGroundingMode", () => {
    expect(resolveSceneEntityGroundingMode(undefined)).toBe("off")
    expect(resolveSceneEntityGroundingMode({})).toBe("off")
    expect(resolveSceneEntityGroundingMode({ sceneEntityGroundingMode: "llm-blocking" })).toBe("llm-blocking")
  })
})
