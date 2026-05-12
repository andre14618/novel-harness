import { expect, test, describe } from "bun:test"
import { parseArgs, renderPlannerIsolatedReport, type PlannerIsolatedRunReport } from "./test-planner-isolated"

describe("test-planner-isolated parseArgs", () => {
  test("defaults to fantasy-healer when no positional or flag is given", () => {
    const args = parseArgs([])
    expect(args.seedNames).toEqual(["fantasy-healer"])
    expect(args.novelId).toBeNull()
    expect(args.fixturePath).toBeNull()
  })

  test("parses a positional seed name", () => {
    const args = parseArgs(["fantasy-archive"])
    expect(args.seedNames).toEqual(["fantasy-archive"])
  })

  test("parses comma-separated positional seed names", () => {
    const args = parseArgs(["fantasy-archive,fantasy-cartographer"])
    expect(args.seedNames).toEqual(["fantasy-archive", "fantasy-cartographer"])
  })

  test("parses --novel <id>", () => {
    const args = parseArgs(["--novel", "novel-1234"])
    expect(args.novelId).toBe("novel-1234")
    expect(args.seedNames).toEqual([])
  })

  test("parses --from-fixture <path>", () => {
    const args = parseArgs([
      "--from-fixture",
      "docs/fixtures/scene-first/concepts/over-target/P1-fantasy-debt-binder.json",
    ])
    expect(args.fixturePath).toBe("docs/fixtures/scene-first/concepts/over-target/P1-fantasy-debt-binder.json")
    expect(args.seedNames).toEqual([])
    expect(args.novelId).toBeNull()
  })

  test("parses planner-shape contract flags", () => {
    const args = parseArgs(["fantasy-healer", "--native-planning-contract", "--scene-turn-planning", "--material-pressure-planning", "--scene-plan-contract"])
    expect(args.nativePlanningContract).toBe(true)
    expect(args.planningSceneTurnShaping).toBe(true)
    expect(args.planningMaterialPressure).toBe(true)
    expect(args.scenePlanContract).toBe(true)
  })

  test("parses --report-dir", () => {
    const args = parseArgs(["fantasy-healer", "--report-dir", "output/planner-isolated/run"])
    expect(args.reportDir).toBe("output/planner-isolated/run")
  })

  test("rejects passing both --novel and a seed name", () => {
    expect(() => parseArgs(["fantasy-healer", "--novel", "n"])).toThrow(/exactly one of/i)
  })

  test("rejects passing both --novel and --from-fixture", () => {
    expect(() => parseArgs(["--novel", "n", "--from-fixture", "x.json"])).toThrow(/exactly one of/i)
  })

  test("rejects passing both seed name and --from-fixture", () => {
    expect(() => parseArgs(["fantasy-healer", "--from-fixture", "x.json"])).toThrow(/exactly one of/i)
  })

  test("rejects --from-fixture without a path value", () => {
    expect(() => parseArgs(["--from-fixture"])).toThrow(/requires a path/i)
  })

  test("rejects --report-dir without a path value", () => {
    expect(() => parseArgs(["--report-dir"])).toThrow(/requires a value/i)
  })

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["--what"])).toThrow(/unknown arg: --what/)
  })
})

describe("renderPlannerIsolatedReport", () => {
  test("includes planner scene-contract telemetry", () => {
    const report: PlannerIsolatedRunReport = {
      v: "planner-isolated-report-v1",
      generatedAt: "2026-05-11T00:00:00.000Z",
      options: {
        nativePlanningContract: true,
        planningSceneTurnShaping: true,
        planningMaterialPressure: true,
        scenePlanContract: true,
        reportDir: "output/planner-isolated/test",
      },
      results: [{
        seedName: "fixture",
        novelId: "novel-1",
        chapters: 1,
        totalScenes: 2,
        sceneCounts: [{ chapter: 1, scenes: 2, targetWords: 1200 }],
        stats: [{
          agent: "planning-scenes",
          attempt: 1,
          chapter: 1,
          prompt_tokens: 100,
          completion_tokens: 200,
          max_tokens: 1000,
          finish_reason: "stop",
          headroom_pct: 80,
        }],
        planningArtifacts: {
          worldBibleAvailable: true,
          storySpineAvailable: true,
          characterCount: 2,
          chapterPlanCount: 1,
          plannedSceneCount: 2,
          sceneLoad: {
            maxScenesPerChapter: 2,
            minTargetWordsPerScene: 600,
            denseChapterCount: 0,
            overloadedChapterCount: 0,
            chapters: [{
              chapterNumber: 1,
              chapterId: "ch-001",
              sceneRefs: ["scene-1", "scene-2"],
              sceneCount: 2,
              targetWords: 1200,
              targetWordsPerScene: 600,
              signal: "balanced",
            }],
          },
          planContinuity: { futureEventAnchors: [], factContradictions: [] },
          scenesWithCharacters: 2,
          scenesWithSceneIds: 2,
          scenesWithSceneContract: 2,
          scenesWithTemporalAnchor: 1,
          scenesWithPlaceAnchor: 1,
          sceneContractsWithDramaticShape: 2,
          sceneContractsWithChoiceShape: 2,
          sceneContractsWithEndpointShape: 2,
          sceneContractsWithFullDramaticShape: 2,
          anchorOnlySceneContracts: 0,
          sceneContractShape: {
            missingDramaticShape: [],
            missingChoiceShape: [],
            missingFullDramaticShape: [],
            anchorOnly: [],
          },
          scenesWithObligations: 2,
          scenesWithImplicitReferences: 0,
          chaptersWithSetting: 1,
          chaptersWithCharactersPresentIds: 1,
          readerInfoSourceChapters: 0,
          obligationIds: 2,
          obligationSourceRefs: 2,
          activeStoryRefIds: 0,
        },
      }],
    }

    const rendered = renderPlannerIsolatedReport(report)

    expect(rendered).toContain("scenePlanContract: on")
    expect(rendered).toContain("planningSceneTurnShaping: on")
    expect(rendered).toContain("planningMaterialPressure: on")
    expect(rendered).toContain("planShape: sceneIds=2/2; sceneContracts=2; dramatic=2; choice=2; endpoint=2; full=2")
    expect(rendered).toContain("sceneLoad: ch1=2sc/600wps/balanced")
    expect(rendered).toContain("planning-scenes: 1 calls")
  })
})
