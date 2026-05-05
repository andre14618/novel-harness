import { describe, expect, test } from "bun:test"
import {
  buildPlanAssistLineageReport,
  renderPlanAssistLineageReport,
  type PlanAssistLineageRow,
} from "./plan-assist-lineage-report"

describe("plan-assist-lineage-report", () => {
  test("classifies plan-assist edit, override, and reviser-accepted rows per chapter", () => {
    const rows: PlanAssistLineageRow[] = [
      {
        id: "lineage:plan-assist:edit-1",
        novel_id: "novel-test",
        source_table: "chapter_exhaustions",
        field_path: "outline",
        source: "plan-assist:plan-check-exhausted",
        actor_kind: "human",
        actor_ref: null,
        previous_ref: "ch-001",
        next_ref: "ch-001",
        previous_version: "prev-hash",
        next_version: "next-hash",
        changed_at: "2026-05-05T18:00:00Z",
        reason: "operator edited outline at plan-assist gate",
        metadata: {
          decision: "edit-plan",
          chapter: 1,
          attempt: 3,
          planAssistKind: "plan-check-exhausted",
          unresolvedDeviationCount: 2,
          previousBeatIds: ["beat-a", "beat-b", "beat-c"],
          nextBeatIds: ["beat-a", "beat-d"],
        },
      },
      {
        id: "lineage:reviser:1",
        novel_id: "novel-test",
        source_table: "chapter_revisions",
        field_path: "outline",
        source: "chapter-plan-reviser:plan-check",
        actor_kind: "agent",
        actor_ref: "chapter-plan-reviser",
        previous_ref: "ch-002",
        next_ref: "ch-002",
        previous_version: "rev-prev",
        next_version: "rev-next",
        changed_at: "2026-05-05T17:30:00Z",
        reason: "chapter-plan-reviser accepted plan-check outline replacement",
        metadata: {
          chapter: 2,
          attempt: 1,
          source: "plan-check",
          revisionId: 42,
          issueCount: 5,
          previousBeatIds: ["b1", "b2"],
          nextBeatIds: ["b1", "b2", "b3"],
        },
      },
      {
        id: "lineage:plan-assist:override-1",
        novel_id: "novel-test",
        source_table: "chapter_exhaustions",
        field_path: "planCheckOverridden",
        source: "plan-assist:integrity-exhausted",
        actor_kind: "human",
        actor_ref: null,
        previous_ref: "ch-001",
        next_ref: "ch-001",
        previous_version: "false-hash",
        next_version: "true-hash",
        changed_at: "2026-05-05T18:30:00Z",
        reason: "operator overrode plan checks at plan-assist gate",
        metadata: {
          decision: "override",
          chapter: 1,
          attempt: 4,
          planAssistKind: "integrity-exhausted",
          previousValue: false,
          nextValue: true,
        },
      },
    ]

    const report = buildPlanAssistLineageReport(rows, "novel-test")

    expect(report).toMatchObject({
      novelId: "novel-test",
      totalEvents: 3,
      planAssistEdits: 1,
      planAssistOverrides: 1,
      reviserAccepted: 1,
      unknown: 0,
    })

    const ch1 = report.chapters.find((c) => c.chapter === 1)
    expect(ch1).toBeDefined()
    expect(ch1!.events.map((e) => e.kind)).toEqual(["plan_assist_edit", "plan_assist_override"])
    const editEvent = ch1!.events[0]!
    expect(editEvent.beatsRemoved).toEqual(["beat-b", "beat-c"])
    expect(editEvent.beatsAdded).toEqual(["beat-d"])
    expect(editEvent.beatsRetained).toEqual(["beat-a"])
    expect(editEvent.unresolvedDeviationCount).toBe(2)
    expect(editEvent.attempt).toBe(3)

    const overrideEvent = ch1!.events[1]!
    expect(overrideEvent.previousValue).toBe(false)
    expect(overrideEvent.nextValue).toBe(true)
    expect(overrideEvent.planAssistKind).toBe("integrity-exhausted")

    const ch2 = report.chapters.find((c) => c.chapter === 2)
    expect(ch2).toBeDefined()
    const reviserEvent = ch2!.events[0]!
    expect(reviserEvent.kind).toBe("reviser_accepted")
    expect(reviserEvent.reviserSource).toBe("plan-check")
    expect(reviserEvent.revisionId).toBe(42)
    expect(reviserEvent.issueCount).toBe(5)
    expect(reviserEvent.beatsAdded).toEqual(["b3"])
    expect(reviserEvent.beatsRemoved).toEqual([])

    const rendered = renderPlanAssistLineageReport(report)
    expect(rendered).toContain("Plan-assist lineage report for novel-test")
    expect(rendered).toContain("plan-assist edit-plan [plan-check-exhausted]")
    expect(rendered).toContain("plan-assist override [integrity-exhausted]")
    expect(rendered).toContain("chapter-plan-reviser accepted")
    expect(rendered).toContain("removed=2")
    expect(rendered).toContain("added=1")
    expect(rendered).toContain("retained=1")
    expect(rendered).toContain("previous=false → next=true")
    expect(rendered).toContain("revision=42")
    expect(rendered).toContain("issues=5")
  })

  test("renders empty report when no lineage rows exist", () => {
    const report = buildPlanAssistLineageReport([], "novel-empty")
    expect(report.totalEvents).toBe(0)
    expect(report.chapters).toEqual([])
    const rendered = renderPlanAssistLineageReport(report)
    expect(rendered).toContain("Plan-assist lineage report for novel-empty")
    expect(rendered).toContain("No plan-assist or reviser lineage rows found.")
  })

  test("tolerates string-encoded metadata and missing fields without throwing", () => {
    const rows: PlanAssistLineageRow[] = [
      {
        id: "lineage:malformed",
        novel_id: "novel-x",
        source_table: "chapter_exhaustions",
        field_path: "outline",
        source: null,
        actor_kind: "human",
        actor_ref: null,
        previous_ref: "ch-x",
        next_ref: "ch-x",
        previous_version: null,
        next_version: null,
        changed_at: null,
        reason: null,
        metadata: '{"decision":"edit-plan","chapter":7,"attempt":"2"}',
      },
      {
        id: "lineage:no-metadata",
        novel_id: "novel-x",
        source_table: "chapter_exhaustions",
        field_path: "unknown_field",
        source: null,
        actor_kind: "human",
        actor_ref: null,
        previous_ref: "ch-y",
        next_ref: "ch-y",
        previous_version: null,
        next_version: null,
        changed_at: null,
        reason: null,
        metadata: null,
      },
    ]

    const report = buildPlanAssistLineageReport(rows, "novel-x")
    expect(report.totalEvents).toBe(2)
    expect(report.planAssistEdits).toBe(1)
    expect(report.unknown).toBe(1)
    const editEvent = report.chapters
      .flatMap((c) => c.events)
      .find((e) => e.kind === "plan_assist_edit")
    expect(editEvent).toBeDefined()
    expect(editEvent!.attempt).toBe(2)
    expect(editEvent!.chapter).toBe(7)
  })
})
