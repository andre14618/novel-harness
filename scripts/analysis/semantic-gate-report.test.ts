import { describe, expect, test } from "bun:test"

import { buildCheckerWarningReport } from "./checker-warning-report"
import { buildPlanAssistLineageReport } from "./plan-assist-lineage-report"
import { buildPlanDriftReport } from "./plan-drift-report"
import {
  buildSemanticGateReport,
  renderSemanticGateReport,
} from "./semantic-gate-report"
import { buildWriterExpansionReport } from "./writer-expansion-report"

describe("semantic-gate-report", () => {
  test("rolls up expansion, drift, checker, and plan-assist signals by chapter", () => {
    const writerExpansion = buildWriterExpansionReport([
      outline(1, 1500, 12),
      outline(2, 1800, 12),
    ], [
      { chapter_number: 1, version: 1, status: "approved", word_count: 2400 },
    ], "novel-test")
    const planDrift = buildPlanDriftReport([
      {
        id: 101,
        novel_id: "novel-test",
        chapter: 2,
        attempt: 1,
        response_content: JSON.stringify({
          pass: false,
          deviations: [{ description: "Changed the planned target action.", beat_index: 3, beatId: "beat-2-4" }],
        }),
      },
    ], "novel-test")
    const checkerWarnings = buildCheckerWarningReport({
      functionalEvents: [
        {
          id: 201,
          chapter: 2,
          payload: {
            blockers: [
              { description: "Ungrounded invention", beat_index: 3, beatId: "beat-2-4" },
            ],
          },
        },
      ],
    }, "novel-test")
    const planAssistLineage = buildPlanAssistLineageReport([
      {
        id: "lineage-1",
        novel_id: "novel-test",
        source_table: "chapter_exhaustions",
        field_path: "outline",
        source: null,
        actor_kind: "human",
        actor_ref: null,
        previous_ref: "chapter:2@before",
        next_ref: "chapter:2@after",
        previous_version: "1",
        next_version: "2",
        changed_at: "2026-05-06T00:00:00.000Z",
        reason: "test",
        metadata: {
          chapter: 2,
          attempt: 1,
          decision: "edit-plan",
          previousBeatIds: ["beat-2-1"],
          nextBeatIds: ["beat-2-1", "beat-2-2"],
        },
      },
    ], "novel-test")

    const report = buildSemanticGateReport({
      writerExpansion,
      planDrift,
      checkerWarnings,
      planAssistLineage,
      planAssistGates: [
        {
          chapter: 2,
          attempt: 1,
          kind: "plan-check-exhausted",
          pending: true,
          unresolvedCount: 0,
        },
      ],
    }, "novel-test")

    expect(report.totals.bySignal).toMatchObject({
      no_draft: 1,
      outline_shape: 2,
      writer_expansion: 1,
      plan_adherence_drift: 1,
      checker_blocker: 1,
      plan_assist_gate: 1,
    })
    expect(report.chapters[0]!).toMatchObject({
      chapter: 1,
      signals: ["outline_shape", "writer_expansion"],
      draftWords: 2400,
    })
    expect(report.chapters[1]!).toMatchObject({
      chapter: 2,
      signals: ["no_draft", "outline_shape", "plan_adherence_drift", "checker_blocker", "plan_assist_gate"],
      planDrift: { unresolved: true, deviationCount: 1, driftedBeatRefs: ["beat-2-4"] },
      checker: { blockers: 1, sources: ["functional-check"] },
      planAssist: { totalEvents: 1, gateCount: 1, pendingGates: 1, planAssistEdits: 1 },
    })

    const rendered = renderSemanticGateReport(report)
    expect(rendered).toContain("Semantic gate report for novel-test")
    expect(rendered).toContain("chapter 2: signals=no_draft,outline_shape,plan_adherence_drift,checker_blocker,plan_assist_gate")
    expect(rendered).toContain("plan drift: final=fail")
    expect(rendered).toContain("plan assist gates: total=1, pending=1")
  })

  test("renders empty input", () => {
    const report = buildSemanticGateReport({
      writerExpansion: buildWriterExpansionReport([], [], null),
      planDrift: buildPlanDriftReport([], null),
      checkerWarnings: buildCheckerWarningReport({}, null),
      planAssistLineage: buildPlanAssistLineageReport([], null),
    }, null)

    expect(report.totals.chapters).toBe(0)
    expect(renderSemanticGateReport(report)).toContain("No outline, checker, drift, or plan-assist data found.")
  })
})

function outline(chapter: number, targetWords: number, beats: number) {
  return {
    chapter_number: chapter,
    outline_json: {
      chapterNumber: chapter,
      targetWords,
      scenes: Array.from({ length: beats }, (_, i) => ({ beatId: `beat-${chapter}-${i + 1}` })),
    },
  }
}
