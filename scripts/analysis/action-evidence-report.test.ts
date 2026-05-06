import { describe, expect, test } from "bun:test"

import {
  buildActionEvidenceSummary,
  extractTargetedRewriteIssueSamples,
  formatActionEvidenceItem,
  renderActionEvidenceReport,
} from "./action-evidence-report"

describe("action-evidence-report", () => {
  test("extractTargetedRewriteIssueSamples reads issue bullets from retry context", () => {
    const samples = extractTargetedRewriteIssueSamples(`
--- TARGETED REWRITE (chapter-plan check) ---
Chapter-plan issues found:
- Arbiter's name is Vellic instead of Cassel as planned
- The chapter ends in the wrong location
Rewrite this beat to address the issues above.
`)

    expect(samples).toEqual([
      "Arbiter's name is Vellic instead of Cassel as planned",
      "The chapter ends in the wrong location",
    ])
  })

  test("buildActionEvidenceSummary sorts and counts action evidence", () => {
    const summary = buildActionEvidenceSummary([
      {
        source: "pipeline_events",
        sourceId: "2",
        kind: "lint-fix-rejected",
        chapter: 1,
        beat: null,
        attempt: null,
        summary: "guard rejected fix",
        timestamp: "2026-05-06T12:00:02.000Z",
      },
      {
        source: "llm_calls",
        sourceId: "1",
        kind: "targeted-rewrite:chapter-plan-check",
        chapter: 1,
        beat: 5,
        attempt: 12,
        summary: "wrong name",
        timestamp: "2026-05-06T12:00:01.000Z",
      },
    ])

    expect(summary.byKind).toEqual({
      "targeted-rewrite:chapter-plan-check": 1,
      "lint-fix-rejected": 1,
    })
    expect(summary.items.map(item => item.sourceId)).toEqual(["1", "2"])
  })

  test("formatActionEvidenceItem renders location and source", () => {
    expect(formatActionEvidenceItem({
      source: "llm_calls",
      sourceId: "42",
      kind: "targeted-rewrite:chapter-plan-check",
      chapter: 2,
      beat: 5,
      attempt: 12,
      summary: "emotional arc reversed",
      timestamp: null,
    })).toBe("targeted-rewrite:chapter-plan-check (ch2 beat5 attempt12): emotional arc reversed [llm_calls#42]")
  })

  test("renderActionEvidenceReport includes empty and populated summaries", () => {
    expect(renderActionEvidenceReport(buildActionEvidenceSummary([]), "novel-a"))
      .toContain("No targeted rewrites")

    const rendered = renderActionEvidenceReport(buildActionEvidenceSummary([{
      source: "chapter_exhaustions",
      sourceId: "7",
      kind: "plan-assist:plan-check-exhausted",
      chapter: 2,
      beat: null,
      attempt: 1,
      summary: "pending gate; unresolved=1",
      timestamp: "2026-05-06T12:00:00.000Z",
    }]), "novel-a")

    expect(rendered).toContain("Action evidence for novel-a")
    expect(rendered).toContain("plan-assist:plan-check-exhausted=1")
    expect(rendered).toContain("pending gate; unresolved=1")
  })
})
