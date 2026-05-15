import { describe, expect, test } from "bun:test"

import {
  normalizeAuthoringBibleReviewEvidencePayload,
  renderAuthoringBibleSceneReviewReport,
} from "./authoring-bible-review"

describe("authoring-bible-review evidence normalization", () => {
  test("keeps object evidence unchanged", () => {
    expect(normalizeAuthoringBibleReviewEvidencePayload({
      proseMoment: "Kael prices the risk.",
      satisfaction: "The rule is visible.",
    })).toEqual({
      proseMoment: "Kael prices the risk.",
      satisfaction: "The rule is visible.",
    })
  })

  test("accepts common DeepSeek evidence strings and arrays", () => {
    expect(normalizeAuthoringBibleReviewEvidencePayload("direct evidence")).toEqual({
      satisfaction: "direct evidence",
    })
    expect(normalizeAuthoringBibleReviewEvidencePayload(["one", "two"])).toEqual({
      satisfaction: "one; two",
    })
  })

  test("renders per-scene selector reasons and omitted rule rows", () => {
    const markdown = renderAuthoringBibleSceneReviewReport({
      generatedAt: "2026-05-14T00:00:00.000Z",
      novelId: "novel-test",
      setName: "test",
      packIds: ["rillgate-contrast-v1"],
      live: false,
      model: "deepseek-v4-flash",
      taskCount: 1,
      results: [],
      scenes: [{
        chapterNumber: 1,
        sceneIndex: 0,
        sceneId: "scene-1",
        proseSource: "scene_writer_call",
        selectedRules: [{
          ruleId: "pack:test:world:paper",
          kind: "world",
          title: "Paper is weapon",
          reason: "selection_hint",
          matchedHints: ["contract"],
          verdict: "pass",
        }],
        omittedRuleIds: {
          story: [],
          world: ["pack:test:world:brine"],
          character: [],
          relationship: [],
          voice: [],
        },
        proseExcerpt: "Kael checks the contract.",
      }],
      summaries: [],
      repairLayers: [],
    } as any)

    expect(markdown).toContain("selection_hint")
    expect(markdown).toContain("pack:test:world:brine")
    expect(markdown).toContain("Kael checks the contract")
  })
})
