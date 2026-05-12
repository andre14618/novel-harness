import { describe, expect, test } from "bun:test"

import {
  assertDisposableBaselineAllowed,
  buildBaselineTerminalSummary,
  capOutlineScenes,
  extractPlanAssistGateLogEvidence,
  parseArgs,
  renderSemanticGateBaselineReport,
  scopeWriterExpansionRows,
  type SemanticGateBaselineReport,
} from "./semantic-gate-baseline"

describe("semantic-gate-baseline", () => {
  test("parseArgs requires a source and defaults to disposable two-chapter output", () => {
    const args = parseArgs(["--source", "fantasy-system-heretic"])

    expect(args.source).toBe("fantasy-system-heretic")
    expect(args.chapters).toBe(2)
    expect(args.allowDisposableBaseline).toBe(false)
    expect(args.keepNovel).toBe(false)
    expect(args.target).toBeNull()
    expect(args.maxScenesPerChapter).toBeNull()
    expect(args.continuityEditorialFlagProposals).toBe(false)
    expect(args.timeoutMinutes).toBe(30)
    expect(args.outputBase).toContain("output/evals/semantic-gate-baseline")
  })

  test("requires explicit disposable baseline acknowledgement", () => {
    expect(() => assertDisposableBaselineAllowed(parseArgs(["--source", "source-novel"])))
      .toThrow(/disposable clone runner/)
    expect(() => assertDisposableBaselineAllowed(parseArgs(["--allow-disposable-baseline", "--source", "source-novel"])))
      .not.toThrow()
    expect(() => assertDisposableBaselineAllowed(parseArgs(["--allow-disposable-eval", "--source", "source-novel"])))
      .not.toThrow()
  })

  test("parseArgs accepts scoped cap, explicit target, and kept disposable novel", () => {
    const args = parseArgs([
      "--allow-disposable-baseline",
      "--source", "source-novel",
      "--chapters", "3",
      "--max-scenes-per-chapter", "5",
      "--target", "target-novel",
      "--timeout-minutes", "12",
      "--keep-novel",
      "--continuity-editorial-flag-proposals",
      "--output-base", "output/evals/custom",
    ])

    expect(args.chapters).toBe(3)
    expect(args.allowDisposableBaseline).toBe(true)
    expect(args.maxScenesPerChapter).toBe(5)
    expect(args.target).toBe("target-novel")
    expect(args.keepNovel).toBe(true)
    expect(args.continuityEditorialFlagProposals).toBe(true)
    expect(args.timeoutMinutes).toBe(12)
    expect(args.outputBase).toContain("output/evals/custom")
  })

  test("parseArgs accepts the short continuity editorial flag alias", () => {
    const args = parseArgs(["--source", "source-novel", "--continuity-editorial-flags"])

    expect(args.continuityEditorialFlagProposals).toBe(true)
  })

  test("parseArgs accepts --pack-strategy calibrated-packed", () => {
    const args = parseArgs(["--source", "source-novel", "--pack-strategy", "calibrated-packed"])

    expect(args.packStrategy).toBe("calibrated-packed")
  })

  test("parseArgs rejects unknown pack strategies", () => {
    expect(() => parseArgs(["--source", "source-novel", "--pack-strategy", "wishful-thinking"]))
      .toThrow("--pack-strategy: unsupported value")
  })

  test("capOutlineScenes trims clone outlines without mutating the original", () => {
    const outline = {
      chapterNumber: 1,
      scenes: [{ beatId: "a" }, { beatId: "b" }, { beatId: "c" }],
    }

    const capped = capOutlineScenes(outline, 2)

    expect(capped).not.toBe(outline)
    expect(capped.scenes).toEqual([{ beatId: "a" }, { beatId: "b" }])
    expect(outline.scenes).toHaveLength(3)
  })

  test("scopeWriterExpansionRows excludes source outlines beyond requested chapters", () => {
    const scoped = scopeWriterExpansionRows([
      { chapter_number: 1, outline_json: { scenes: [] } },
      { chapter_number: 2, outline_json: { scenes: [] } },
      { chapter_number: 3, outline_json: { scenes: [] } },
    ], [
      { chapter_number: 1, version: 1, status: "approved", word_count: 1200 },
      { chapter_number: 3, version: 1, status: "approved", word_count: 900 },
    ], 2)

    expect(scoped.outlines.map(row => row.chapter_number)).toEqual([1, 2])
    expect(scoped.drafts.map(row => row.chapter_number)).toEqual([1])
  })

  test("terminal summary surfaces pending plan-assist before generic process failure", () => {
    const summary = buildBaselineTerminalSummary(
      { exitCode: 1, signal: null },
      false,
      [{
        id: 9,
        chapter: 2,
        attempt: 1,
        kind: "plan-check-exhausted",
        resolverMode: "auto",
        decision: null,
        pending: true,
        unresolvedCount: 1,
        unresolvedSamples: ["[chapter-level] drift"],
      }],
    )

    expect(summary.status).toBe("pending-plan-assist")
    expect(summary.reason).toContain("chapter 2")
    expect(summary.latestPlanAssistGate?.id).toBe(9)
  })

  test("terminal summary surfaces process timeout when no gate is pending", () => {
    const summary = buildBaselineTerminalSummary(
      { exitCode: null, signal: "SIGTERM", timedOut: true, timeoutMs: 720_000 },
      false,
      [],
    )

    expect(summary.status).toBe("process-timeout")
    expect(summary.reason).toContain("720s")
  })

  test("extractPlanAssistGateLogEvidence reads unresolved samples from stdout", () => {
    const evidence = extractPlanAssistGateLogEvidence(`
PLAN-ASSIST GATE - plan-check-exhausted (chapter 2)
Unresolved issues (2):
  - [chapter-level] [continuity] The draft claims the wrong location.
  - [beat 3] planned action changed.
[WAITING] Plan-assist pending in web UI...
`)

    expect(evidence).toEqual({
      unresolvedCount: 2,
      unresolvedSamples: [
        "[chapter-level] [continuity] The draft claims the wrong location.",
        "[beat 3] planned action changed.",
      ],
    })
  })

  test("renderSemanticGateBaselineReport carries the semantic gate evidence", () => {
    const rendered = renderSemanticGateBaselineReport(reportFixture())

    expect(rendered).toContain("# Semantic Gate Baseline")
    expect(rendered).toContain("Terminal status: pending-plan-assist")
    expect(rendered).toContain("Max scenes per chapter: 5")
    expect(rendered).toContain("Planning max scenes override: 5")
    expect(rendered).toContain("Continuity editorial flags: enabled")
    expect(rendered).toContain("Approved: 1/2")
    expect(rendered).toContain("Signals: no_draft=1, outline_shape=2")
    expect(rendered).toContain("calibration=standard=2, low-confidence=3")
    expect(rendered).toContain("Halluc-ungrounded raw: calls=2; blockerIssues=0 (pre-retry checker output)")
    expect(rendered).toContain("Action Evidence")
    expect(rendered).toContain("targeted-rewrite:chapter-plan-check")
    expect(rendered).toContain("Proposal Envelopes")
    expect(rendered).toContain("continuity-editorial-flags")
    expect(rendered).toContain("Latest Plan-Assist Gate")
  })

  test("renderSemanticGateBaselineReport falls back to plan-assist stdout evidence", () => {
    const fixture = reportFixture()
    fixture.terminal.latestPlanAssistGate!.unresolvedSamples = []
    fixture.terminal.planAssistLogEvidence = {
      unresolvedCount: 1,
      unresolvedSamples: ["[chapter-level] Prose integrity quote-integrity"],
    }

    const rendered = renderSemanticGateBaselineReport(fixture)

    expect(rendered).toContain("Log evidence:")
    expect(rendered).toContain("[chapter-level] Prose integrity quote-integrity")
  })
})

function reportFixture(): SemanticGateBaselineReport {
  return {
    generatedAt: "2026-05-06T12:00:00.000Z",
    sourceNovelId: "fantasy-system-heretic",
    novelId: "semantic-gate-baseline-test",
    chapters: 2,
    outputBase: "/tmp/semantic-gate-baseline",
    maxScenesPerChapter: 5,
    packStrategy: null,
    packing: null,
    pipelineOverrides: {
      planningMaxScenesPerChapter: 5,
      continuityEditorialFlagProposals: true,
    },
    keptNovel: false,
    sourcePreflight: {
      sourceNovelId: "fantasy-system-heretic",
      phase: "drafting",
      totalChapters: 3,
      outlineCount: 3,
    },
    process: {
      exitCode: 1,
      signal: null,
      stdoutPath: "/tmp/stdout.log",
      stderrPath: "/tmp/stderr.log",
      timedOut: false,
      timeoutMs: 1_800_000,
    },
    novel: {
      phase: "drafting",
      currentChapter: 2,
      totalChapters: 2,
      completed: false,
    },
    proposals: {
      total: 1,
      byKind: { editorial_flag: 1 },
      byStatus: { pending: 1 },
      bySourceAgent: { "continuity-editorial-flags": 1 },
      samples: [{
        id: "editorial-flag:novel:abc",
        kind: "editorial_flag",
        status: "pending",
        sourceAgent: "continuity-editorial-flags",
        summary: "warning: off-canon @ chapter:1",
        createdAt: "2026-05-06T12:00:01.000Z",
      }],
    },
    terminal: {
      status: "pending-plan-assist",
      reason: "stopped at pending plan-assist gate: chapter 2, kind plan-check-exhausted",
      latestPlanAssistGate: {
        id: 9,
        chapter: 2,
        attempt: 1,
        kind: "plan-check-exhausted",
        resolverMode: "auto",
        decision: null,
        pending: true,
        unresolvedCount: 1,
        unresolvedSamples: ["[chapter-level] drift"],
      },
      planAssistLogEvidence: null,
    },
    drafts: {
      latestChapters: 1,
      approvedChapters: 1,
      totalWords: 1900,
      rows: [{ chapter: 1, version: 1, status: "approved", wordCount: 1900 }],
    },
    llm: {
      calls: 12,
      failedCalls: 0,
      costUsd: 0.0123,
      agents: [{ agent: "beat-writer", calls: 5, failedCalls: 0, costUsd: 0.004 }],
    },
    checker: {
      semanticGate: {
        novelId: "semantic-gate-baseline-test",
        chapters: [{
          chapter: 1,
          signals: ["outline_shape", "writer_expansion"],
          targetWords: 1500,
          plannedScenes: 5,
          draftWords: 1900,
          wordRatio: 1.27,
          wordsPerScene: 380,
          expansionFlags: ["over_target"],
          planDrift: { totalCalls: 1, finalPass: true, recovered: false, unresolved: false, deviationCount: 0, driftedBeatRefs: [] },
          checker: {
            totalItems: 2,
            blockers: 0,
            loadBearingBlockers: 0,
            continuityBlockers: 0,
            warnings: 2,
            positivePolarityBlockers: 0,
            positivePolarityLoadBearingBlockers: 0,
            ambiguousPolarityBlockers: 0,
            sources: ["continuity-state"],
          },
          planAssist: { totalEvents: 0, gateCount: 0, pendingGates: 0, planAssistEdits: 0, planAssistOverrides: 0, reviserAccepted: 0 },
        }, {
          chapter: 2,
          signals: ["no_draft", "outline_shape", "plan_assist_gate"],
          targetWords: 1800,
          plannedScenes: 5,
          draftWords: null,
          wordRatio: null,
          wordsPerScene: null,
          expansionFlags: ["no_draft"],
          planDrift: { totalCalls: 0, finalPass: null, recovered: false, unresolved: false, deviationCount: 0, driftedBeatRefs: [] },
          checker: {
            totalItems: 0,
            blockers: 0,
            loadBearingBlockers: 0,
            continuityBlockers: 0,
            warnings: 0,
            positivePolarityBlockers: 0,
            positivePolarityLoadBearingBlockers: 0,
            ambiguousPolarityBlockers: 0,
            sources: [],
          },
          planAssist: { totalEvents: 0, gateCount: 1, pendingGates: 1, planAssistEdits: 0, planAssistOverrides: 0, reviserAccepted: 0 },
        }],
        totals: {
          chapters: 2,
          bySignal: {
            no_draft: 1,
            outline_shape: 2,
            writer_expansion: 1,
            plan_adherence_drift: 0,
            checker_blocker: 0,
            plan_assist_gate: 1,
          },
        },
      },
      writerExpansion: {} as SemanticGateBaselineReport["checker"]["writerExpansion"],
      planDrift: {} as SemanticGateBaselineReport["checker"]["planDrift"],
      warnings: {
        novelId: "semantic-gate-baseline-test",
        totalItems: 5,
        bySeverity: { warning: 5 },
        byPolarity: { negative: 0, positive: 0, ambiguous: 5 },
        byCalibration: { standard: 2, "low-confidence": 3 },
        chapters: [],
      },
      planAssistLineage: {} as SemanticGateBaselineReport["checker"]["planAssistLineage"],
      hallucUngrounded: { calls: 2, blockerIssues: 0, samples: [] },
      actionEvidence: {
        total: 1,
        byKind: { "targeted-rewrite:chapter-plan-check": 1 },
        items: [{
          source: "llm_calls",
          sourceId: "42",
          kind: "targeted-rewrite:chapter-plan-check",
          chapter: 1,
          beat: 5,
          attempt: 12,
          summary: "Arbiter's name is Vellic instead of Cassel as planned",
          timestamp: "2026-05-06T12:00:01.000Z",
        }],
      },
    },
  }
}
