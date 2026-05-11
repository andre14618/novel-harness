import { describe, expect, test } from "bun:test"
import {
  buildReviewPlanReport,
  parseArgs,
  renderReviewPlanReport,
} from "./plan-readiness-review-plan"
import type { PlanReadinessItem } from "../../src/db/plan-readiness"

describe("plan-readiness-review-plan", () => {
  test("parseArgs requires a novel and parses output controls", () => {
    expect(() => parseArgs([])).toThrow("--novel is required")
    expect(parseArgs([
      "--novel", "n",
      "--output", "review.md",
      "--json", "plan.json",
      "--status", "all",
      "--limit", "25",
      "--default-decision", "accepted_as_is",
    ])).toEqual({
      novelId: "n",
      outputPath: "review.md",
      jsonPath: "plan.json",
      status: "all",
      limit: 25,
      defaultDecision: "accepted_as_is",
    })
  })

  test("buildReviewPlanReport creates an apply-compatible action for each item", () => {
    const report = buildReviewPlanReport({
      novelId: "novel",
      status: "open",
      generatedAt: "2026-05-10T00:00:00.000Z",
      items: [
        item({
          id: "low",
          severity: "medium",
          diagnosticLabel: "ENDPOINT-1",
          dimension: "endpointLanding",
          target: { kind: "scene_plan", ref: "scene-2", fieldPath: "description" },
        }),
        item({
          id: "high",
          severity: "high",
          diagnosticLabel: "CONTINUITY-BLOCKER",
          dimension: "planConsistency",
          target: { kind: "chapter_outline", ref: "chapter-2", fieldPath: "purpose" },
          metadata: {
            proposalCandidate: {
              action: "field_replace",
              target: { kind: "chapter_outline", ref: "chapter-2", fieldPath: "purpose" },
              requiresProposedValue: true,
              safeToAutoApply: false,
            },
          },
        }),
      ],
    })

    expect(report.summary.byLabel).toEqual({
      "CONTINUITY-BLOCKER": 1,
      "ENDPOINT-1": 1,
    })
    expect(report.plan.actions.map(action => action.match.itemId)).toEqual(["high", "low"])
    expect(report.plan.actions[0]).toMatchObject({
      match: {
        itemId: "high",
        label: "CONTINUITY-BLOCKER",
        dimension: "planConsistency",
        targetKind: "chapter_outline",
        targetRef: "chapter-2",
        targetFieldPath: "purpose",
      },
      decision: "deferred",
      proposalCandidate: {
        action: "field_replace",
        target: { kind: "chapter_outline", ref: "chapter-2", fieldPath: "purpose" },
      },
      proposedValueTemplate: {
        target: { kind: "chapter_outline", ref: "chapter-2", fieldPath: "purpose" },
        replaceWithReviewedValue: true,
      },
    })
    expect(report.plan.actions[0]?.proposalInstruction).toContain("set decision to the candidate action")
  })

  test("renderReviewPlanReport includes review context without requiring proposals", () => {
    const report = buildReviewPlanReport({
      novelId: "novel",
      status: "open",
      generatedAt: "2026-05-10T00:00:00.000Z",
      draftingSource: {
        clean: false,
        issue: "source already has 1 chapter_drafts and is not a clean planning source",
        guidance: "Use a clean planning/drafting source.",
        state: {
          phase: "complete",
          currentChapter: 2,
          outlineCount: 1,
          draftCount: 1,
        },
      },
      items: [item({
        id: "item-1",
        diagnosticLabel: "SCENE-1",
        dimension: "sceneDramaturgy",
        evidence: { score: "1", reason: "No choice turn." },
        preserveIds: {
          obligationIds: ["obl-1"],
          characterIds: [],
          worldFactIds: [],
          sceneTurnIds: [],
          threadIds: [],
          promiseIds: [],
          payoffIds: [],
          sourceIds: [],
        },
      })],
    })

    const rendered = renderReviewPlanReport(report)
    expect(rendered).toContain("## Drafting Source")
    expect(rendered).toContain("clean for drafting evidence: no")
    expect(rendered).toContain("Review and edit the JSON plan")
    expect(rendered).toContain("### SCENE-1 scene_plan:scene")
    expect(rendered).toContain("evidence: score=1; reason=No choice turn.")
    expect(rendered).toContain("preserve IDs: obligationIds=obl-1")
  })
})

function item(overrides: Partial<PlanReadinessItem>): PlanReadinessItem {
  return {
    id: "item",
    novelId: "novel",
    target: { kind: "scene_plan", ref: "scene" },
    sourceHash: "hash",
    sourceHashKind: "target_current_version",
    diagnosticLabel: "ENDPOINT-1",
    dimension: "endpointLanding",
    fixIntent: "review",
    severity: "medium",
    explanation: "explanation",
    missingForNextLevel: null,
    preserveIds: {
      obligationIds: [],
      characterIds: [],
      worldFactIds: [],
      sceneTurnIds: [],
      threadIds: [],
      promiseIds: [],
      payoffIds: [],
      sourceIds: [],
    },
    evidence: {},
    sourceReportPaths: [],
    status: "open",
    operatorDisposition: null,
    operatorNote: null,
    proposalEnvelopeId: null,
    importedByKind: "test",
    importedByRef: null,
    resolvedAt: null,
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    metadata: {},
    ...overrides,
  }
}
