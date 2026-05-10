import { describe, expect, test } from "bun:test"

import {
  parseArgs,
  requestBodyForPlanAction,
  selectReadinessActions,
} from "./plan-readiness-apply"
import type { PlanReadinessItem } from "../../src/db/plan-readiness"

describe("plan-readiness-apply", () => {
  test("parseArgs requires a novel and plan file", () => {
    expect(() => parseArgs([])).toThrow("--novel is required")
    expect(() => parseArgs(["--novel", "n"])).toThrow("--plan is required")
    expect(parseArgs([
      "--novel", "n",
      "--plan", "review.json",
      "--output", "report.md",
      "--dry-run",
      "--json",
      "--limit", "50",
    ])).toEqual({
      novelId: "n",
      planPath: "review.json",
      outputPath: "report.md",
      dryRun: true,
      json: true,
      limit: 50,
    })
  })

  test("selectReadinessActions matches only open/deferred items and consumes matches once", () => {
    const selected = selectReadinessActions([
      item({ id: "a", diagnosticLabel: "ENDPOINT-1", status: "open", target: { kind: "scene_plan", ref: "s1", fieldPath: "description" } }),
      item({ id: "b", diagnosticLabel: "ENDPOINT-1", status: "open", target: { kind: "scene_plan", ref: "s2", fieldPath: "description" } }),
      item({ id: "c", diagnosticLabel: "TURN-PLAN-1", status: "fixed", target: { kind: "scene_plan", ref: "s3", fieldPath: "description" } }),
    ], [
      {
        match: { label: "ENDPOINT-1", targetKind: "scene_plan" },
        decision: "deferred",
      },
      {
        match: { label: "ENDPOINT-1", targetKind: "scene_plan" },
        decision: "not_applicable",
      },
      {
        match: { label: "TURN-PLAN-1" },
        decision: "accepted_as_is",
      },
    ])

    expect(selected.map(row => row.item?.id ?? row.error)).toEqual([
      "a",
      "b",
      "no matching open/deferred readiness item",
    ])
  })

  test("requestBodyForPlanAction builds disposition and proposal route payloads", () => {
    expect(requestBodyForPlanAction({
      match: { itemId: "item-1" },
      decision: "not_applicable",
      operatorNote: "not a relationship scene",
    })).toEqual({
      status: "not_applicable",
      operatorNote: "not a relationship scene",
    })

    expect(requestBodyForPlanAction({
      match: { label: "ENDPOINT-PLAN-1" },
      decision: "field_replace",
      proposedValue: "A sharper final scene description.",
      operatorNote: "make endpoint concrete",
      rationale: "operator-reviewed endpoint fix",
    })).toEqual({
      action: "field_replace",
      proposedValue: "A sharper final scene description.",
      operatorNote: "make endpoint concrete",
      rationale: "operator-reviewed endpoint fix",
    })
  })
})

function item(overrides: Partial<PlanReadinessItem>): PlanReadinessItem {
  return {
    id: "item",
    novelId: "novel",
    target: { kind: "scene_plan", ref: "scene", fieldPath: "description" },
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
