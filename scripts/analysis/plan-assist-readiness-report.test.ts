import { describe, expect, test } from "bun:test"
import { buildPlanReadinessDraftsFromAggregate } from "../../src/harness/plan-readiness"
import type { ExhaustionRow } from "../../src/db/chapter-exhaustions"
import {
  buildPlanAssistReadinessAggregate,
  parseArgs,
  renderPlanAssistReadinessAggregate,
  type PlanAssistReadinessChapterTarget,
} from "./plan-assist-readiness-report"

describe("plan-assist-readiness-report", () => {
  test("parseArgs requires a novel and parses output/import flags", () => {
    expect(() => parseArgs([])).toThrow("--novel is required")
    expect(parseArgs([
      "--novel", "n",
      "--output", "report.md",
      "--json", "report.json",
      "--import-readiness",
      "--include-resolved",
    ])).toEqual({
      novelId: "n",
      outputPath: "report.md",
      jsonPath: "report.json",
      importReadiness: true,
      includeResolved: true,
    })
  })

  test("converts pending Plan-Assist beat blockers into beat readiness groups", () => {
    const aggregate = buildPlanAssistReadinessAggregate({
      novelId: "novel",
      exhaustions: [
        exhaustion({
          unresolvedDeviations: [{
            description: "[beat-check:halluc-ungrounded] Beat 1: Ungrounded entity \"Silver Audit Writ\"",
            beat_index: 0,
            metadata: { hallucUngrounded: { entity: "Silver Audit Writ" } },
          }],
        }),
      ],
      chapterTargets: [chapterTarget()],
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(aggregate.groupCount).toBe(1)
    expect(aggregate.pendingRows).toBe(1)
    const group = aggregate.groups[0]!
    expect(group.unitType).toBe("beat")
    expect(group.rewritePacket.proposalCandidate).toMatchObject({
      action: "beat_replace",
      target: { kind: "beat_plan", ref: "beat-a" },
      sourceAgent: "plan-assist-readiness",
    })
    expect(group.findings[0]!.label).toBe("PLAN-ASSIST-CHECKER-BLOCKER")
    expect(group.findings[0]!.evidence.descriptions).toContain("Ungrounded entity")
    expect(group.sourceIds.sceneTurnIds).toEqual(["beat-a", "scene-a"])

    const readiness = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel",
      aggregate,
      targetVersions: {
        "beat_plan:beat-a": "b".repeat(64),
      },
    })
    expect(readiness.skipped).toHaveLength(0)
    expect(readiness.drafts).toHaveLength(1)
    expect(readiness.drafts[0]!.target).toEqual({ kind: "beat_plan", ref: "beat-a" })
    expect(readiness.drafts[0]!.metadata.proposalCandidate).toMatchObject({
      action: "beat_replace",
      sourceAgent: "plan-assist-readiness",
    })
  })

  test("falls back to chapter outline readiness when no beat target can be resolved", () => {
    const aggregate = buildPlanAssistReadinessAggregate({
      novelId: "novel",
      exhaustions: [
        exhaustion({
          kind: "integrity-exhausted",
          unresolvedDeviations: [{
            description: "Prose integrity duplicate-fragment: repeated closing image",
            beat_index: null,
          }],
        }),
      ],
      chapterTargets: [chapterTarget({ beatIdsByIndex: {}, sceneIdsByIndex: {} })],
    })

    expect(aggregate.groupCount).toBe(1)
    const group = aggregate.groups[0]!
    expect(group.rewritePacket.proposalCandidate).toMatchObject({
      action: "field_replace",
      target: {
        kind: "chapter_outline",
        ref: "ch-001",
        fieldPath: "purpose",
      },
    })
    expect(group.findings[0]!.label).toBe("PLAN-ASSIST-INTEGRITY")
    expect(renderPlanAssistReadinessAggregate(aggregate)).toContain("PLAN-ASSIST-INTEGRITY")
  })

  test("uses scene readiness targets when only a scene id can be resolved", () => {
    const aggregate = buildPlanAssistReadinessAggregate({
      novelId: "novel",
      exhaustions: [
        exhaustion({
          unresolvedDeviations: [{
            description: "[beat-check:adherence] Beat 1: missing exit action",
            beat_index: 0,
            sceneId: "scene-a",
          }],
        }),
      ],
      chapterTargets: [chapterTarget({ beatIdsByIndex: {} })],
    })

    expect(aggregate.groupCount).toBe(1)
    const group = aggregate.groups[0]!
    expect(group.unitType).toBe("scene")
    expect(group.rewritePacket.proposalCandidate).toMatchObject({
      action: "beat_replace",
      target: { kind: "scene_plan", ref: "scene-a" },
    })
  })

  test("skips resolved rows by default and can include them explicitly", () => {
    const resolved = exhaustion({
      decision: "override",
      decidedAt: "2026-05-11T00:05:00.000Z",
      unresolvedDeviations: [{
        description: "[functional:payoff] Beat 1: required payoff is impossible",
        beat_index: 0,
      }],
    })
    const chapterTargets = [chapterTarget()]

    expect(buildPlanAssistReadinessAggregate({
      novelId: "novel",
      exhaustions: [resolved],
      chapterTargets,
    }).groupCount).toBe(0)

    expect(buildPlanAssistReadinessAggregate({
      novelId: "novel",
      exhaustions: [resolved],
      chapterTargets,
      includeResolved: true,
    }).groupCount).toBe(1)
  })
})

function exhaustion(overrides: Partial<ExhaustionRow> = {}): ExhaustionRow {
  return {
    id: 17,
    novelId: "novel",
    chapter: 1,
    attempt: 2,
    firedAt: "2026-05-11T00:00:00.000Z",
    kind: "plan-check-exhausted",
    resolverMode: "auto",
    unresolvedDeviations: [],
    reviserHistory: null,
    decidedAt: null,
    decision: null,
    decisionDetails: null,
    ...overrides,
  }
}

function chapterTarget(
  overrides: Partial<PlanAssistReadinessChapterTarget> = {},
): PlanAssistReadinessChapterTarget {
  return {
    chapterNumber: 1,
    chapterId: "ch-001",
    beatIdsByIndex: { "0": "beat-a" },
    sceneIdsByIndex: { "0": "scene-a" },
    ...overrides,
  }
}
