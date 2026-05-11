import { expect, test, describe } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildDraftingIsolatedRunReport,
  draftingIsolatedDeltas,
  parseArgs,
  flagsForArm,
  renderDraftingIsolatedRunReport,
  WRITER_ARM_NAMES,
  summarizeDraftingBriefTelemetry,
  sceneSemanticSummary,
  sourceDraftingIsolationIssue,
  writeSceneSemanticFailureArtifacts,
  writeDraftingIsolatedSceneSemanticComparison,
  writePlanningContextArtifacts,
} from "./test-drafting-isolated"
import type { ArmResult, Args } from "./test-drafting-isolated"
import type { PlanningToDraftingContextReport } from "./analysis/planning-drafting-context-report"
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

  test("accepts the seven supported arms in any combination", () => {
    const args = parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--writer-arms", "baseline,id-suppress,contract-render-only,scene-call-no-expansion,drafting-brief-v1,drafting-brief-scene-turn-v1,scene-call-v1",
    ])
    expect(args.arms).toEqual(["baseline", "id-suppress", "contract-render-only", "scene-call-no-expansion", "drafting-brief-v1", "drafting-brief-scene-turn-v1", "scene-call-v1"])
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
    expect(defaults.sceneSemanticMaxTokens).toBe(2200)
    expect(defaults.sceneSemanticDimensions).toEqual([
      "endpointLanding",
      "sceneDramaturgy",
      "characterMateriality",
      "worldFactPressure",
    ])

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

  test("--report-dir defaults to automatic output and can be overridden", () => {
    expect(parseArgs(["--source", "n", "--target-prefix", "ab"]).reportDir).toBeNull()
    expect(parseArgs(["--source", "n", "--target-prefix", "ab", "--report-dir", "output/custom"]).reportDir).toBe("output/custom")
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

describe("drafting isolated report", () => {
  test("buildDraftingIsolatedRunReport preserves source hygiene and telemetry summaries", () => {
    const report = buildDraftingIsolatedRunReport({
      generatedAt: "2026-05-10T00:00:00.000Z",
      args: args(),
      sourceAssessment: {
        clean: true,
        issue: null,
        guidance: null,
        state: {
          phase: "drafting",
          currentChapter: 1,
          outlineCount: 2,
          draftCount: 0,
        },
      },
      results: [
        armResult({ arm: "baseline", novelId: "ab-baseline", totalWords: 3000, meanRatio: 1 }),
        armResult({
          arm: "scene-call-v1",
          novelId: "ab-scene-call-v1",
          totalWords: 3300,
          meanRatio: 1.12,
          expansionEvents: 2,
          planningContext: {
            outputDir: "output/planning-context",
            surfaceCount: 11,
            gapCount: 1,
            readiness: {
              outputDir: "output/planning-context",
              groupCount: 2,
              findingCount: 2,
              labels: { "SCENE-LOAD-OVERLOADED": 2 },
            },
            gaps: [{
              surface: "resolvedReferences",
              status: "missing_downstream",
              upstreamCount: 2,
              downstreamCount: 0,
            }],
            upstream: {
              worldBibleAvailable: true,
              storySpineAvailable: true,
              characterCount: 3,
              chapterPlanCount: 2,
              plannedSceneCount: 10,
              scenesWithSceneContract: 10,
              scenesWithObligations: 8,
              scenesWithImplicitReferences: 2,
            },
            downstream: {
              events: 11,
              withCharacterContext: 11,
              withWorldContext: 4,
              withStoryContext: 9,
              withReaderInfoState: 5,
              withImplicitReferences: 0,
              withResolvedReferences: 0,
              referenceLookups: 0,
              withSceneContract: 11,
              withObligations: 9,
              withDraftingBriefTrace: 11,
            },
          },
          proseSemantic: {
            outputDir: "output/prose",
            resultCount: 4,
            lowRows: 0,
            errorRows: 0,
            saturationNotes: [],
            lengthSignal: "ok",
            qualityRisk: "low",
            recommendation: "keep",
          },
          sceneSemantic: {
            outputDir: "output/scene",
            taskCount: 4,
            skipCount: 0,
            lowRows: 1,
            errorRows: 0,
            dimensions: [],
            recommendation: "review",
          },
        }),
      ],
    })

    expect(report.v).toBe("drafting-isolated-report-v1")
    expect(report.summary.cleanSource).toBe(true)
    expect(report.summary.totalWordsByArm["scene-call-v1"]).toBe(3300)
    expect(report.summary.planningContextGapsByArm["scene-call-v1"]).toBe(1)
    expect(report.summary.planningContextReadinessByArm["scene-call-v1"]).toBe(2)
    expect(report.summary.proseSemanticLowRowsByArm["scene-call-v1"]).toBe(0)
    expect(report.summary.sceneSemanticLowRowsByArm["scene-call-v1"]).toBe(1)
    expect(report.deltas[0]).toMatchObject({
      arm: "scene-call-v1",
      baselineArm: "baseline",
      expansionEvents: 2,
      error: null,
      pocMagnitude: "improvement",
    })
    expect(report.deltas[0]?.meanRatioDelta).toBeCloseTo(0.12, 6)

    const rendered = renderDraftingIsolatedRunReport(report)
    expect(rendered).toContain("Clean source: yes")
    expect(rendered).toContain("planningContext surfaces=11 gaps=1")
    expect(rendered).toContain("planningContextReadiness groups=2 findings=2")
    expect(rendered).toContain("planningContextGaps resolvedReferences:missing_downstream")
    expect(rendered).toContain("sceneSemantic tasks=4 lows=1")
  })

  test("draftingIsolatedDeltas reports failed arms and skips when baseline failed", () => {
    expect(draftingIsolatedDeltas([
      armResult({ arm: "baseline", error: "failed" }),
      armResult({ arm: "scene-call-v1" }),
    ])).toEqual([])

    expect(draftingIsolatedDeltas([
      armResult({ arm: "baseline", meanRatio: 1 }),
      armResult({ arm: "scene-call-v1", meanRatio: 1.01, error: "timeout" }),
    ])[0]).toMatchObject({
      arm: "scene-call-v1",
      error: "timeout",
      pocMagnitude: "failed",
    })
  })

  test("writePlanningContextArtifacts writes readiness sidecars from scene load", () => {
    const dir = mkdtempSync(join(tmpdir(), "planning-context-artifacts-"))
    try {
      const readiness = writePlanningContextArtifacts(planningContextReport(), dir)

      expect(readiness).toMatchObject({
        outputDir: dir,
        groupCount: 1,
        findingCount: 1,
        labels: { "SCENE-LOAD-OVERLOADED": 1 },
      })
      const aggregate = JSON.parse(readFileSync(join(dir, "planning-context-readiness.json"), "utf8"))
      expect(aggregate.groups[0]).toMatchObject({
        chapterId: "ch-001",
        findings: [{ label: "SCENE-LOAD-OVERLOADED" }],
      })
      expect(readFileSync(join(dir, "planning-context-readiness.md"), "utf8")).toContain("Should this chapter be split")
      expect(readFileSync(join(dir, "planning-drafting-context-report.json"), "utf8")).toContain('"chapterId": "ch-001"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

  test("drafting-brief-scene-turn-v1 flips only the production drafting brief mode", () => {
    const flags = flagsForArm("drafting-brief-scene-turn-v1")
    expect(flags.writerDraftingBriefMode).toBe("scene-turn-v1")
    expect(flags.sceneCallWriterV1).toBe(false)
    expect(flags.writerExpansionMode).toBe("off")
    expect(flags.forceRenderSceneContractWhenAvailable).toBe(false)
    expect(flags.writerPromptIdRendering).toBe("raw")
  })

  test("WRITER_ARM_NAMES enumerates the seven supported arms in declaration order", () => {
    expect(WRITER_ARM_NAMES).toEqual(["baseline", "id-suppress", "contract-render-only", "scene-call-no-expansion", "drafting-brief-v1", "drafting-brief-scene-turn-v1", "scene-call-v1"])
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

  test("writes durable failure artifacts when scene semantic replay fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "scene-semantic-failure-"))
    try {
      const outputDir = join(dir, "run", "drafting-brief-v1")
      const jsonPath = writeSceneSemanticFailureArtifacts({
        novelId: "novel-1",
        targetPrefix: "run",
        arm: "drafting-brief-v1",
        outputDir,
        error: "DeepSeek deepseek-v4-flash hit max token cap",
        opts: {
          sceneSemanticLive: true,
          sceneSemanticConcurrency: 4,
          sceneSemanticMaxTokens: 2200,
          sceneSemanticDimensions: ["endpointLanding", "sceneDramaturgy"],
        },
      })

      const artifact = JSON.parse(readFileSync(jsonPath, "utf8"))
      expect(artifact.v).toBe("scene-semantic-review-failure-v1")
      expect(artifact.error).toContain("max token cap")
      expect(artifact.options.maxTokens).toBe(2200)
      expect(artifact.options.dimensions).toEqual(["endpointLanding", "sceneDramaturgy"])

      const markdown = readFileSync(join(outputDir, "scene-semantic-review-failure.md"), "utf8")
      expect(markdown).toContain("Scene-Semantic Replay Failure")
      expect(markdown).toContain("DeepSeek deepseek-v4-flash hit max token cap")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("writes an arm-to-arm scene semantic comparison sidecar", () => {
    const dir = mkdtempSync(join(tmpdir(), "drafting-scene-semantic-compare-"))
    try {
      const baselineDir = join(dir, "scene-semantic-review", "baseline")
      const candidateDir = join(dir, "scene-semantic-review", "scene-call-v1")
      writeSceneReport(baselineDir, semanticReport("scene-semantic-review:test:baseline", [
        resultRow("endpointLanding", "ENDPOINT-1", 1),
      ]))
      writeSceneReport(candidateDir, semanticReport("scene-semantic-review:test:scene-call-v1", [
        resultRow("endpointLanding", "ENDPOINT-2", 2),
      ]))

      const comparison = writeDraftingIsolatedSceneSemanticComparison([
        armResult({
          arm: "baseline",
          sceneSemantic: sceneSemanticTelemetry(baselineDir),
        }),
        armResult({
          arm: "scene-call-v1",
          sceneSemantic: sceneSemanticTelemetry(candidateDir),
        }),
      ], join(dir, "drafting-report"))

      expect(comparison).not.toBeNull()
      expect(comparison?.baselineArm).toBe("baseline")
      expect(comparison?.comparisons[0]).toMatchObject({
        candidateArm: "scene-call-v1",
        verdict: "improved",
        comparedRows: 1,
      })
      expect(comparison?.comparisons[0]?.dimensions[0]).toMatchObject({
        dimension: "endpointLanding",
        lowDelta: -1,
        resolvedLowRows: 1,
      })
      const markdown = readFileSync(join(dir, "drafting-report", "scene-semantic-compare.md"), "utf8")
      expect(markdown).toContain("ENDPOINT-1 -> ENDPOINT-2")

      const report = buildDraftingIsolatedRunReport({
        args: args({ arms: ["baseline", "scene-call-v1"] }),
        sourceAssessment: {
          clean: true,
          issue: null,
          guidance: null,
          state: {
            phase: "drafting",
            currentChapter: 1,
            outlineCount: 2,
            draftCount: 0,
          },
        },
        results: [
          armResult({ arm: "baseline", sceneSemantic: sceneSemanticTelemetry(baselineDir) }),
          armResult({ arm: "scene-call-v1", sceneSemantic: sceneSemanticTelemetry(candidateDir) }),
        ],
        sceneSemanticComparison: comparison,
      })
      expect(renderDraftingIsolatedRunReport(report)).toContain("## Scene Semantic Comparison")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

function planningContextReport(): PlanningToDraftingContextReport {
  return {
    novelId: "novel-load",
    upstream: {
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characterCount: 3,
      chapterPlanCount: 1,
      plannedSceneCount: 10,
      sceneLoad: {
        maxScenesPerChapter: 10,
        minTargetWordsPerScene: 120,
        denseChapterCount: 0,
        overloadedChapterCount: 1,
        chapters: [{
          chapterNumber: 1,
          chapterId: "ch-001",
          sceneRefs: ["scene-1", "scene-2"],
          sceneCount: 10,
          targetWords: 1200,
          targetWordsPerScene: 120,
          signal: "overloaded",
        }],
      },
      scenesWithCharacters: 10,
      scenesWithSceneIds: 10,
      scenesWithSceneContract: 0,
      scenesWithObligations: 8,
      scenesWithImplicitReferences: 0,
      chaptersWithSetting: 1,
      chaptersWithCharactersPresentIds: 1,
      readerInfoSourceChapters: 0,
      obligationIds: 8,
      obligationSourceRefs: 8,
      activeStoryRefIds: 0,
    },
    downstream: {
      events: 0,
      beatEvents: 0,
      chapterEvents: 0,
      targetWords: 0,
      withCharacterContext: 0,
      withCharacterProfiles: 0,
      withCharacterSnapshots: 0,
      withCharacterContextCapsules: 0,
      withSceneContract: 0,
      withObligations: 0,
      withWorldContext: 0,
      withWorldBible: 0,
      withSetting: 0,
      withStoryContext: 0,
      withImplicitReferences: 0,
      withReaderInfoState: 0,
      withResolvedReferences: 0,
      referenceLookups: 0,
      referenceLlmCalls: 0,
      withDraftingBriefTrace: 0,
      draftingBriefEnabledEvents: 0,
      avgDraftingBriefCharsRatio: null,
      avgSelectedPromptChars: null,
      avgFullContextPromptChars: null,
      totalDraftingBriefCharsDelta: 0,
      missingCharacterIds: 0,
    },
    surfaces: [],
    gaps: [],
  }
}

function semanticReport(setName: string, results: SceneSemanticReplayReport["results"]): SceneSemanticReplayReport {
  return {
    generatedAt: "2026-05-11T00:00:00.000Z",
    novelId: "novel",
    setName,
    chapters: [1],
    live: true,
    model: "deepseek-v4-flash",
    thinking: true,
    promptMode: "evidence-first",
    dimensions: [...new Set(results.map(row => row.dimension))],
    taskCount: results.length,
    skipCount: 0,
    results,
    skips: [],
    summaries: [],
  }
}

function writeSceneReport(outputDir: string, report: SceneSemanticReplayReport): void {
  mkdirSync(outputDir, { recursive: true })
  const path = join(outputDir, "scene-semantic-review.json")
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
}

function sceneSemanticTelemetry(outputDir: string): NonNullable<ArmResult["sceneSemantic"]> {
  return {
    outputDir,
    taskCount: 1,
    skipCount: 0,
    lowRows: 0,
    errorRows: 0,
    dimensions: [{
      dimension: "endpointLanding",
      count: 1,
      meanOrdinal: 2,
      lowCount: 0,
      labelCounts: { "ENDPOINT-2": 1 },
    }],
    recommendation: "review",
  }
}

function args(overrides: Partial<Args> = {}): Args {
  return {
    source: "source",
    targetPrefix: "ab",
    arms: ["baseline", "scene-call-v1"],
    writerOnly: false,
    proseSemanticEval: true,
    proseSemanticDryRun: false,
    proseSemanticConcurrency: 4,
    sceneSemanticReview: true,
    sceneSemanticLive: true,
    sceneSemanticConcurrency: 4,
    sceneSemanticMaxTokens: 2200,
    sceneSemanticDimensions: ["endpointLanding", "sceneDramaturgy"],
    allowDraftedSource: false,
    perArmTimeoutMs: null,
    reportDir: null,
    ...overrides,
  }
}

function armResult(overrides: Partial<ArmResult> = {}): ArmResult {
  return {
    arm: "baseline",
    novelId: "novel",
    chapters: [],
    totalWords: 3000,
    totalTarget: 3000,
    meanRatio: 1,
    expansionEvents: 0,
    draftingBrief: {
      events: 0,
      enabledEvents: 0,
      modes: {},
      avgCharsRatio: null,
      avgSelectedPromptChars: null,
      avgFullContextPromptChars: null,
      totalCharsDelta: 0,
    },
    ...overrides,
  }
}
