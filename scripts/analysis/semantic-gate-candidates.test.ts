import { describe, expect, test } from "bun:test"

import {
  buildSemanticGateCandidateReport,
  renderSemanticGateCandidateReport,
  type SemanticGateCandidateNovelRow,
} from "./semantic-gate-candidates"
import type { SemanticGateReport } from "./semantic-gate-report"

describe("semantic-gate-candidates", () => {
  test("ranks novels by pending gates, blockers, drift, and writer expansion", () => {
    const novels: SemanticGateCandidateNovelRow[] = [
      novel("quiet", "planning"),
      novel("blocked", "drafting"),
      novel("expanded", "drafting"),
    ]
    const report = buildSemanticGateCandidateReport({
      novels,
      reports: [
        semanticReport("quiet", {
          no_draft: 1,
          outline_shape: 0,
          writer_expansion: 0,
          plan_adherence_drift: 0,
          checker_blocker: 0,
          plan_assist_gate: 0,
        }),
        semanticReport("blocked", {
          no_draft: 1,
          outline_shape: 1,
          writer_expansion: 1,
          plan_adherence_drift: 1,
          checker_blocker: 1,
          plan_assist_gate: 1,
        }, {
          pendingGates: 1,
          checkerBlockers: 2,
          unresolvedDrift: true,
        }),
        semanticReport("expanded", {
          no_draft: 0,
          outline_shape: 2,
          writer_expansion: 2,
          plan_adherence_drift: 0,
          checker_blocker: 0,
          plan_assist_gate: 0,
        }),
      ],
      limit: 2,
    })

    expect(report.totals).toMatchObject({
      scannedNovels: 3,
      returnedCandidates: 2,
    })
    expect(report.candidates.map(candidate => candidate.novelId)).toEqual(["blocked", "expanded"])
    expect(report.candidates[0]!).toMatchObject({
      priority: "critical",
      primaryLens: "mixed",
      evidence: {
        pendingPlanAssistGates: 1,
        checkerBlockers: 2,
        loadBearingCheckerBlockers: 2,
        effectiveCheckerBlockers: 2,
        unresolvedPlanDriftChapters: 1,
      },
    })
    expect(report.candidates[0]!.reasons).toContain("1 pending plan-assist gate(s)")
    expect(report.candidates[0]!.diagnosticsCommand).toBe("bun run diagnostics:semantic-gate -- --novel blocked")
    expect(report.candidates[0]!.actionEvidenceCommand).toBe("bun run diagnostics:action-evidence -- --novel blocked")
    expect(report.candidates[0]!.sourceDiagnosticsCommands).toContain("bun run diagnostics:checker-warnings -- --novel blocked")
  })

  test("renders an operator-facing next command", () => {
    const report = buildSemanticGateCandidateReport({
      novels: [novel("blocked", "drafting")],
      reports: [
        semanticReport("blocked", {
          no_draft: 0,
          outline_shape: 0,
          writer_expansion: 0,
          plan_adherence_drift: 0,
          checker_blocker: 1,
          plan_assist_gate: 1,
        }, {
          pendingGates: 1,
          checkerBlockers: 1,
        }),
      ],
    })

    const rendered = renderSemanticGateCandidateReport(report)
    expect(rendered).toContain("Semantic gate candidate report")
    expect(rendered).toContain("blocked: high, score=15, lens=checker_gate")
    expect(rendered).toContain("blockers=1, loadBearingBlockers=1, effectiveBlockers=1")
    expect(rendered).toContain("next: bun run diagnostics:semantic-gate -- --novel blocked")
    expect(rendered).toContain("actions: bun run diagnostics:action-evidence -- --novel blocked")
    expect(rendered).toContain("sources: bun run diagnostics:checker-warnings -- --novel blocked")
  })

  test("discounts support-echo checker blocker candidates in effective scoring", () => {
    const report = buildSemanticGateCandidateReport({
      novels: [
        novel("support-echo", "drafting"),
        novel("effective-blocker", "drafting"),
      ],
      reports: [
        semanticReport("support-echo", {
          no_draft: 0,
          outline_shape: 0,
          writer_expansion: 0,
          plan_adherence_drift: 0,
          checker_blocker: 1,
          plan_assist_gate: 0,
        }, {
          checkerBlockers: 4,
          positivePolarityBlockers: 4,
        }),
        semanticReport("effective-blocker", {
          no_draft: 0,
          outline_shape: 0,
          writer_expansion: 0,
          plan_adherence_drift: 0,
          checker_blocker: 1,
          plan_assist_gate: 0,
        }, {
          checkerBlockers: 2,
        }),
      ],
    })

    expect(report.candidates.map(candidate => candidate.novelId)).toEqual(["effective-blocker", "support-echo"])
    expect(report.candidates[1]!.score).toBe(5)
    expect(report.candidates[1]!.evidence).toMatchObject({
      checkerBlockers: 4,
      loadBearingCheckerBlockers: 4,
      effectiveCheckerBlockers: 0,
      positivePolarityBlockers: 4,
    })
    expect(report.candidates[1]!.reasons).toContain("0 effective checker blocker(s) after support-echo discount")
    expect(report.candidates[1]!.reasons).toContain("4 support-echo checker blocker candidate(s)")
  })

  test("marks over-planned candidates with the plan-shape lens", () => {
    const report = buildSemanticGateCandidateReport({
      novels: [novel("overplanned", "drafting")],
      reports: [
        semanticReport("overplanned", {
          no_draft: 1,
          outline_shape: 3,
          writer_expansion: 1,
          plan_adherence_drift: 0,
          checker_blocker: 0,
          plan_assist_gate: 0,
        }),
      ],
    })

    expect(report.candidates[0]!).toMatchObject({
      novelId: "overplanned",
      primaryLens: "plan_shape",
    })
    expect(report.candidates[0]!.sourceDiagnosticsCommands[0]).toBe("bun run diagnostics:writer-expansion -- --novel overplanned")
  })

  test("does not prioritize historical plan-assist signals without pending gates", () => {
    const report = buildSemanticGateCandidateReport({
      novels: [novel("orphaned-gate", "drafting")],
      reports: [
        semanticReport("orphaned-gate", {
          no_draft: 0,
          outline_shape: 0,
          writer_expansion: 0,
          plan_adherence_drift: 0,
          checker_blocker: 0,
          plan_assist_gate: 1,
        }),
      ],
    })

    expect(report.candidates).toEqual([])
  })

  test("keeps continuity blockers raw but excludes them from effective scoring", () => {
    const report = buildSemanticGateCandidateReport({
      novels: [novel("continuity-only", "drafting")],
      reports: [
        semanticReport("continuity-only", {
          no_draft: 0,
          outline_shape: 1,
          writer_expansion: 0,
          plan_adherence_drift: 0,
          checker_blocker: 0,
          plan_assist_gate: 0,
        }, {
          checkerBlockers: 2,
          continuityBlockers: 2,
        }),
      ],
    })

    expect(report.candidates[0]!).toMatchObject({
      novelId: "continuity-only",
      score: 1.5,
      evidence: {
        checkerBlockers: 2,
        loadBearingCheckerBlockers: 0,
        continuityCheckerBlockers: 2,
        effectiveCheckerBlockers: 0,
      },
    })
    expect(report.candidates[0]!.reasons).toContain("2 continuity checker blocker(s) kept diagnostic-only")
    expect(report.candidates[0]!.reasons).toContain("0 load-bearing checker blocker(s) after continuity diagnostic discount")
  })
})

function novel(id: string, phase: string): SemanticGateCandidateNovelRow {
  return {
    id,
    phase,
    current_chapter: 1,
    total_chapters: 3,
  }
}

function semanticReport(
  novelId: string,
  counts: SemanticGateReport["totals"]["bySignal"],
  evidence: {
    pendingGates?: number
    checkerBlockers?: number
    positivePolarityBlockers?: number
    positivePolarityLoadBearingBlockers?: number
    ambiguousPolarityBlockers?: number
    continuityBlockers?: number
    unresolvedDrift?: boolean
  } = {},
): SemanticGateReport {
  return {
    novelId,
    chapters: [
      {
        chapter: 1,
        signals: Object.entries(counts).flatMap(([signal, count]) => count > 0 ? [signal as keyof typeof counts] : []),
        targetWords: 1500,
        plannedBeats: 5,
        draftWords: counts.no_draft > 0 ? null : 1600,
        wordRatio: counts.no_draft > 0 ? null : 1.07,
        wordsPerBeat: counts.no_draft > 0 ? null : 320,
        expansionFlags: [],
        planDrift: {
          totalCalls: evidence.unresolvedDrift ? 1 : 0,
          finalPass: evidence.unresolvedDrift ? false : null,
          recovered: false,
          unresolved: Boolean(evidence.unresolvedDrift),
          deviationCount: evidence.unresolvedDrift ? 1 : 0,
          driftedBeatRefs: evidence.unresolvedDrift ? ["beat-1"] : [],
        },
        checker: {
          totalItems: evidence.checkerBlockers ?? 0,
          blockers: evidence.checkerBlockers ?? 0,
          loadBearingBlockers: (evidence.checkerBlockers ?? 0) - (evidence.continuityBlockers ?? 0),
          continuityBlockers: evidence.continuityBlockers ?? 0,
          warnings: 0,
          positivePolarityBlockers: evidence.positivePolarityBlockers ?? 0,
          positivePolarityLoadBearingBlockers: evidence.positivePolarityLoadBearingBlockers ?? evidence.positivePolarityBlockers ?? 0,
          ambiguousPolarityBlockers: evidence.ambiguousPolarityBlockers ?? 0,
          sources: evidence.checkerBlockers ? ["functional-check"] : [],
        },
        planAssist: {
          totalEvents: counts.plan_assist_gate > 0 ? 1 : 0,
          gateCount: evidence.pendingGates ?? 0,
          pendingGates: evidence.pendingGates ?? 0,
          planAssistEdits: 0,
          planAssistOverrides: 0,
          reviserAccepted: 0,
        },
      },
    ],
    totals: {
      chapters: 1,
      bySignal: counts,
    },
  }
}
