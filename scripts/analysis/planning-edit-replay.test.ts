import { describe, expect, test } from "bun:test"
import {
  createPlanningProposalBodyForReplay,
  effectivePlanningEditPayload,
  parseArgs,
  previewTargetForReplay,
  renderReport,
  type PlanningEditReplayReport,
  type PlanningEditReplaySource,
} from "./planning-edit-replay"

describe("planning-edit-replay", () => {
  test("parseArgs requires a target and an approved proposal source", () => {
    expect(() => parseArgs([])).toThrow("--to-novel is required")
    expect(() => parseArgs(["--to-novel", "target"])).toThrow("--from-novel or --proposal-id is required")
    expect(() => parseArgs(["--to-novel", "target", "--from-novel", "source"])).toThrow("--all-approved is required")
    expect(parseArgs([
      "--to-novel", "target",
      "--from-novel", "source-a",
      "--from-novel", "source-b",
      "--all-approved",
      "--approve",
      "--dry-run",
      "--limit", "5",
      "--output", "report.md",
      "--json",
    ])).toEqual({
      fromNovels: ["source-a", "source-b"],
      toNovel: "target",
      proposalIds: [],
      allApproved: true,
      approve: true,
      dryRun: true,
      limit: 5,
      outputPath: "report.md",
      json: true,
    })
  })

  test("effectivePlanningEditPayload prefers modified payload and validates planning edit shape", () => {
    const payload = effectivePlanningEditPayload({
      payload: planningPayload("old"),
      modified_payload: JSON.stringify(planningPayload("new")),
    })

    expect(payload.action).toBe("field_replace")
    expect(payload.proposedValue).toBe("new")
    expect(() => effectivePlanningEditPayload({ payload: { action: "nope" }, modified_payload: null })).toThrow()
  })

  test("createPlanningProposalBodyForReplay builds a normal planning proposal create body", () => {
    const source: PlanningEditReplaySource = {
      id: "planning_edit:source:abc",
      novelId: "source",
      status: "approved",
      payload: planningPayload("replacement"),
    }

    expect(createPlanningProposalBodyForReplay(source)).toMatchObject({
      action: "field_replace",
      target: {
        kind: "scene_plan",
        ref: "scene-1",
        fieldPath: "description",
      },
      proposedValue: "replacement",
      source: {
        agent: "planning-edit-replay",
        parentEnvelopeId: "planning_edit:source:abc",
      },
    })
  })

  test("previewTargetForReplay strips structural pseudo-fields for target lookup", () => {
    expect(previewTargetForReplay({
      action: "beat_replace",
      target: {
        kind: "scene_plan",
        ref: "scene-1",
        fieldPath: "self",
      },
      previousValue: {},
      proposedValue: {
        sceneId: "scene-1",
        description: "Replacement scene.",
      },
    }.target)).toEqual({
      kind: "scene_plan",
      ref: "scene-1",
    })

    expect(previewTargetForReplay(planningPayload("replacement").target)).toEqual({
      kind: "scene_plan",
      ref: "scene-1",
      fieldPath: "description",
    })
  })

  test("renderReport summarizes replay outcomes", () => {
    const rendered = renderReport(report())
    expect(rendered).toContain("Planning Edit Replay")
    expect(rendered).toContain("created: 1")
    expect(rendered).toContain("proposal=planning_edit:target:abc")
  })
})

function planningPayload(proposedValue: string) {
  return {
    action: "field_replace",
    target: {
      kind: "scene_plan",
      ref: "scene-1",
      fieldPath: "description",
    },
    previousValue: "before",
    proposedValue,
  } as const
}

function report(): PlanningEditReplayReport {
  return {
    generatedAt: "2026-05-10T00:00:00.000Z",
    fromNovels: ["source"],
    toNovel: "target",
    dryRun: false,
    approve: false,
    summary: {
      requested: 1,
      replayable: 1,
      created: 1,
      approved: 0,
      errors: 0,
    },
    items: [{
      sourceProposalId: "planning_edit:source:abc",
      sourceNovelId: "source",
      action: "field_replace",
      target: {
        kind: "scene_plan",
        ref: "scene-1",
        fieldPath: "description",
      },
      dryRun: false,
      targetAvailable: true,
      createdProposalId: "planning_edit:target:abc",
      approved: false,
      ok: true,
      error: null,
    }],
  }
}
