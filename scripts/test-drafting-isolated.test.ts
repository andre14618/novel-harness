import { expect, test, describe } from "bun:test"
import {
  parseArgs,
  flagsForArm,
  WRITER_ARM_NAMES,
  summarizeDraftingBriefTelemetry,
  sceneSemanticSummary,
  sourceDraftingIsolationIssue,
} from "./test-drafting-isolated"
import type { SceneSemanticReplayReport } from "./evals/scene-semantic-review"

describe("test-drafting-isolated parseArgs", () => {
  test("requires --source", () => {
    expect(() => parseArgs(["--target-prefix", "ab"])).toThrow(/--source.*required/i)
  })

  test("requires --target-prefix", () => {
    expect(() => parseArgs(["--source", "n"])).toThrow(/--target-prefix.*required/i)
  })

  test("defaults to baseline + scene-call-v1 arms", () => {
    const args = parseArgs(["--source", "n", "--target-prefix", "ab"])
    expect(args.arms).toEqual(["baseline", "scene-call-v1"])
  })

  test("accepts the six supported arms in any combination", () => {
    const args = parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--writer-arms", "baseline,id-suppress,contract-render-only,scene-call-no-expansion,drafting-brief-v1,scene-call-v1",
    ])
    expect(args.arms).toEqual(["baseline", "id-suppress", "contract-render-only", "scene-call-no-expansion", "drafting-brief-v1", "scene-call-v1"])
  })

  test("rejects unknown arm names", () => {
    expect(() => parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--writer-arms", "baseline,foo",
    ])).toThrow(/--writer-arms entries must be one of/)
  })

  test("rejects empty arm list", () => {
    expect(() => parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--writer-arms", "",
    ])).toThrow(/empty arm list/)
  })

  test("--writer-only defaults to false and enables when present", () => {
    expect(parseArgs(["--source", "n", "--target-prefix", "ab"]).writerOnly).toBe(false)
    expect(parseArgs(["--source", "n", "--target-prefix", "ab", "--writer-only"]).writerOnly).toBe(true)
  })

  test("prose semantic eval is default-on, can dry-run, and can opt out", () => {
    const defaults = parseArgs(["--source", "n", "--target-prefix", "ab"])
    expect(defaults.proseSemanticEval).toBe(true)
    expect(defaults.proseSemanticDryRun).toBe(false)

    const live = parseArgs(["--source", "n", "--target-prefix", "ab", "--prose-semantic-eval", "--prose-semantic-concurrency", "2"])
    expect(live.proseSemanticEval).toBe(true)
    expect(live.proseSemanticDryRun).toBe(false)
    expect(live.proseSemanticConcurrency).toBe(2)

    const dry = parseArgs(["--source", "n", "--target-prefix", "ab", "--prose-semantic-dry-run"])
    expect(dry.proseSemanticEval).toBe(true)
    expect(dry.proseSemanticDryRun).toBe(true)

    const disabled = parseArgs(["--source", "n", "--target-prefix", "ab", "--no-prose-semantic-eval"])
    expect(disabled.proseSemanticEval).toBe(false)
    expect(disabled.proseSemanticDryRun).toBe(false)
  })

  test("scene semantic replay is default-off and can be enabled live or dry-run", () => {
    const defaults = parseArgs(["--source", "n", "--target-prefix", "ab"])
    expect(defaults.sceneSemanticReview).toBe(false)
    expect(defaults.sceneSemanticLive).toBe(true)
    expect(defaults.sceneSemanticDimensions).toEqual(["endpointLanding", "sceneDramaturgy"])

    const live = parseArgs(["--source", "n", "--target-prefix", "ab", "--scene-semantic-review"])
    expect(live.sceneSemanticReview).toBe(true)
    expect(live.sceneSemanticLive).toBe(true)

    const dry = parseArgs(["--source", "n", "--target-prefix", "ab", "--scene-semantic-dry-run"])
    expect(dry.sceneSemanticReview).toBe(true)
    expect(dry.sceneSemanticLive).toBe(false)
  })

  test("scene semantic replay parses dimensions and tuning flags", () => {
    const args = parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--scene-semantic-dimension", "endpointLanding",
      "--scene-semantic-dimension", "sceneDramaturgy",
      "--scene-semantic-concurrency", "2",
      "--scene-semantic-max-tokens", "900",
    ])
    expect(args.sceneSemanticReview).toBe(true)
    expect(args.sceneSemanticDimensions).toEqual(["endpointLanding", "sceneDramaturgy"])
    expect(args.sceneSemanticConcurrency).toBe(2)
    expect(args.sceneSemanticMaxTokens).toBe(900)
  })

  test("scene semantic replay rejects unsupported dimensions and non-positive tuning", () => {
    expect(() => parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--scene-semantic-dimension", "notReal",
    ])).toThrow(/unsupported --scene-semantic-dimension/)
    expect(() => parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--scene-semantic-concurrency", "0",
    ])).toThrow(/positive integer/)
    expect(() => parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--scene-semantic-max-tokens", "abc",
    ])).toThrow(/positive integer/)
  })

  test("--prose-semantic-concurrency rejects non-positive / non-numeric values", () => {
    expect(() => parseArgs(["--source", "n", "--target-prefix", "ab", "--prose-semantic-concurrency", "0"])).toThrow(/positive integer/)
    expect(() => parseArgs(["--source", "n", "--target-prefix", "ab", "--prose-semantic-concurrency", "abc"])).toThrow(/positive integer/)
  })

  test("--per-arm-timeout-ms defaults to null and parses positive integers", () => {
    expect(parseArgs(["--source", "n", "--target-prefix", "ab"]).perArmTimeoutMs).toBeNull()
    expect(parseArgs(["--source", "n", "--target-prefix", "ab", "--per-arm-timeout-ms", "60000"]).perArmTimeoutMs).toBe(60000)
  })

  test("--per-arm-timeout-ms rejects non-positive / non-numeric values", () => {
    expect(() => parseArgs(["--source", "n", "--target-prefix", "ab", "--per-arm-timeout-ms", "0"])).toThrow(/positive integer/)
    expect(() => parseArgs(["--source", "n", "--target-prefix", "ab", "--per-arm-timeout-ms", "-1"])).toThrow(/positive integer/)
    expect(() => parseArgs(["--source", "n", "--target-prefix", "ab", "--per-arm-timeout-ms", "abc"])).toThrow(/positive integer/)
  })

  test("--allow-drafted-source defaults false and enables explicit contaminated-source replay", () => {
    expect(parseArgs(["--source", "n", "--target-prefix", "ab"]).allowDraftedSource).toBe(false)
    expect(parseArgs(["--source", "n", "--target-prefix", "ab", "--allow-drafted-source"]).allowDraftedSource).toBe(true)
  })
})

describe("sourceDraftingIsolationIssue", () => {
  test("accepts a clean chapter-1 source with outlines and no drafts", () => {
    expect(sourceDraftingIsolationIssue({
      phase: "drafting",
      currentChapter: 1,
      outlineCount: 2,
      draftCount: 0,
    })).toBeNull()
  })

  test("rejects a source that already has drafts", () => {
    expect(sourceDraftingIsolationIssue({
      phase: "drafting",
      currentChapter: 1,
      outlineCount: 2,
      draftCount: 2,
    })).toMatch(/already has 2 chapter_drafts/)
  })

  test("rejects terminal phase sources even without visible drafts", () => {
    expect(sourceDraftingIsolationIssue({
      phase: "complete",
      currentChapter: 3,
      outlineCount: 2,
      draftCount: 0,
    })).toMatch(/phase is complete/)
  })

  test("rejects sources advanced beyond chapter 1", () => {
    expect(sourceDraftingIsolationIssue({
      phase: "drafting",
      currentChapter: 2,
      outlineCount: 2,
      draftCount: 0,
    })).toMatch(/current_chapter is 2/)
  })
})

describe("flagsForArm", () => {
  test("baseline arm preserves production defaults across all writer flags", () => {
    expect(flagsForArm("baseline")).toEqual({
      sceneCallWriterV1: false,
      writerExpansionMode: "off",
      forceRenderSceneContractWhenAvailable: false,
      writerPromptIdRendering: "raw",
      writerDraftingBriefMode: "off",
    })
  })

  test("id-suppress arm flips ONLY the writer-prompt ID rendering flag", () => {
    const flags = flagsForArm("id-suppress")
    expect(flags.writerPromptIdRendering).toBe("suppress")
    // The other flags must match baseline so the ablation isolates
    // the prompt-rendering effect.
    expect(flags.sceneCallWriterV1).toBe(false)
    expect(flags.writerExpansionMode).toBe("off")
    expect(flags.forceRenderSceneContractWhenAvailable).toBe(false)
    expect(flags.writerDraftingBriefMode).toBe("off")
  })

  test("contract-render-only arm flips ONLY the scene-contract-render flag", () => {
    const flags = flagsForArm("contract-render-only")
    expect(flags.forceRenderSceneContractWhenAvailable).toBe(true)
    expect(flags.sceneCallWriterV1).toBe(false)
    expect(flags.writerExpansionMode).toBe("off")
    expect(flags.writerPromptIdRendering).toBe("raw")
    expect(flags.writerDraftingBriefMode).toBe("off")
  })

  test("scene-call-v1 arm enables scene-call writer + expansion-retry; ID rendering stays raw", () => {
    const flags = flagsForArm("scene-call-v1")
    expect(flags.sceneCallWriterV1).toBe(true)
    expect(flags.writerExpansionMode).toBe("retry-short-scenes-v1")
    expect(flags.writerPromptIdRendering).toBe("raw")
    expect(flags.writerDraftingBriefMode).toBe("off")
  })

  test("scene-call-no-expansion isolates scene-call from expansion retry", () => {
    const flags = flagsForArm("scene-call-no-expansion")
    expect(flags.sceneCallWriterV1).toBe(true)
    expect(flags.writerExpansionMode).toBe("off")
    expect(flags.forceRenderSceneContractWhenAvailable).toBe(false)
    expect(flags.writerPromptIdRendering).toBe("raw")
    expect(flags.writerDraftingBriefMode).toBe("off")
  })

  test("drafting-brief-v1 flips only the production drafting brief mode", () => {
    const flags = flagsForArm("drafting-brief-v1")
    expect(flags.writerDraftingBriefMode).toBe("scene-budget-v1")
    expect(flags.sceneCallWriterV1).toBe(false)
    expect(flags.writerExpansionMode).toBe("off")
    expect(flags.forceRenderSceneContractWhenAvailable).toBe(false)
    expect(flags.writerPromptIdRendering).toBe("raw")
  })

  test("WRITER_ARM_NAMES enumerates the six supported arms in declaration order", () => {
    expect(WRITER_ARM_NAMES).toEqual(["baseline", "id-suppress", "contract-render-only", "scene-call-no-expansion", "drafting-brief-v1", "scene-call-v1"])
  })
})

describe("summarizeDraftingBriefTelemetry", () => {
  test("aggregates writer-context drafting brief payload stats by mode", () => {
    const summary = summarizeDraftingBriefTelemetry([{
      draftingBrief: {
        mode: "off",
        selectedPromptChars: 1000,
        fullContextPromptChars: 1000,
        charsRatio: 1,
        charsDelta: 0,
      },
    }, {
      draftingBrief: {
        mode: "scene-budget-v1",
        selectedPromptChars: 600,
        fullContextPromptChars: 1200,
        charsRatio: 0.5,
        charsDelta: -600,
      },
    }, {
      eventType: "other",
    }])

    expect(summary.events).toBe(2)
    expect(summary.enabledEvents).toBe(1)
    expect(summary.modes).toEqual({ off: 1, "scene-budget-v1": 1 })
    expect(summary.avgCharsRatio).toBe(0.75)
    expect(summary.avgSelectedPromptChars).toBe(800)
    expect(summary.avgFullContextPromptChars).toBe(1100)
    expect(summary.totalCharsDelta).toBe(-600)
  })

  test("returns an empty summary when no drafting brief trace exists", () => {
    const summary = summarizeDraftingBriefTelemetry([{ draftingBrief: null }, {}])
    expect(summary.events).toBe(0)
    expect(summary.enabledEvents).toBe(0)
    expect(summary.modes).toEqual({})
    expect(summary.avgCharsRatio).toBeNull()
  })
})

describe("sceneSemanticSummary", () => {
  test("summarizes low rows and dimension counts for harness output", () => {
    const summary = sceneSemanticSummary({
      generatedAt: "2026-05-10T00:00:00.000Z",
      novelId: "novel-1",
      setName: "scene-semantic-review:test",
      chapters: [1],
      live: true,
      model: "deepseek-v4-flash",
      thinking: true,
      promptMode: "evidence-first",
      dimensions: ["endpointLanding", "sceneDramaturgy"],
      taskCount: 2,
      skipCount: 0,
      results: [
        resultRow("endpointLanding", "ENDPOINT-1", 1),
        resultRow("sceneDramaturgy", "SCENE-3", 3),
      ],
      skips: [],
      summaries: [{
        dimension: "endpointLanding",
        count: 1,
        meanOrdinal: 1,
        lowCount: 1,
        labelCounts: { "ENDPOINT-1": 1 },
      }, {
        dimension: "sceneDramaturgy",
        count: 1,
        meanOrdinal: 3,
        lowCount: 0,
        labelCounts: { "SCENE-3": 1 },
      }],
    } satisfies SceneSemanticReplayReport, "output/scene-semantic-review/ab/brief")

    expect(summary.taskCount).toBe(2)
    expect(summary.lowRows).toBe(1)
    expect(summary.errorRows).toBe(0)
    expect(summary.dimensions.map(d => d.dimension)).toEqual(["endpointLanding", "sceneDramaturgy"])
    expect(summary.recommendation).toContain("inspect low")
  })
})

function resultRow(dimension: "endpointLanding" | "sceneDramaturgy", label: string, ordinal: number): SceneSemanticReplayReport["results"][number] {
  return {
    taskId: `task-${dimension}`,
    chapterNumber: 1,
    sceneIndex: 0,
    sceneId: "scene-1",
    dimension,
    promptMode: "evidence-first",
    excerpt: "excerpt",
    obligationIds: [],
    relevantCharacterIds: [],
    relevantWorldFactIds: [],
    sceneTurnIds: [],
    threadIds: [],
    promiseIds: [],
    payoffIds: [],
    sourceIds: [],
    label,
    ordinal,
    confidence: 0.9,
    evidenceFields: 3,
    missingForNextLevel: "",
    output: {
      label,
      confidence: 0.9,
      evidence: { strength: "x", weakness: "y", cue: "z" },
      missingForNextLevel: "",
      gates: {},
    },
  }
}
