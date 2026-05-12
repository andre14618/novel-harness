import { describe, expect, test } from "bun:test"
import {
  buildReviewPlanReport,
  buildReviewTargetContextsFromOutlines,
  parseArgs,
  renderReviewPlanReport,
} from "./plan-readiness-review-plan"
import type { PlanReadinessItem } from "../../src/db/plan-readiness"
import type { ChapterOutline } from "../../src/types"

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
          fixIntent: "preserve_immutable_fact",
          evidence: { sourceRef: "fact-ledger", score: "1" },
          sourceReportPaths: ["context-report.json"],
          preserveIds: {
            obligationIds: ["obl-ledger"],
            characterIds: [],
            worldFactIds: [],
            sceneTurnIds: ["scene-2"],
            threadIds: [],
            promiseIds: [],
            payoffIds: [],
            sourceIds: ["fact-ledger"],
          },
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
      diagnostic: {
        label: "CONTINUITY-BLOCKER",
        dimension: "planConsistency",
        severity: "high",
        fixIntent: "preserve_immutable_fact",
        explanation: "explanation",
        missingForNextLevel: null,
      },
      evidence: { sourceRef: "fact-ledger", score: "1" },
      preserveIds: {
        obligationIds: ["obl-ledger"],
        sceneTurnIds: ["scene-2"],
        sourceIds: ["fact-ledger"],
      },
      sourceReportPaths: ["context-report.json"],
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

  test("buildReviewPlanReport templates scene-load selection proposals with current scene refs", () => {
    const report = buildReviewPlanReport({
      novelId: "novel",
      status: "open",
      generatedAt: "2026-05-10T00:00:00.000Z",
      targetContexts: new Map([[
        "chapter_outline:ch-001:scenes",
        {
          currentValueSummary: [
            { index: 1, ref: "scene-1", kind: "dialogue", description: "First scene." },
            { index: 2, ref: "scene-2", kind: "action", description: "Second scene." },
            { index: 3, ref: "scene-3", kind: "decision", description: "Third scene." },
          ],
        },
      ]]),
      items: [
        item({
          id: "scene-load",
          severity: "high",
          diagnosticLabel: "SCENE-LOAD-OVERLOADED",
          dimension: "sceneLoad",
          target: { kind: "chapter_outline", ref: "ch-001", fieldPath: "scenes" },
          evidence: { sceneRefs: "scene-1,scene-2,scene-3" },
          metadata: {
            proposalCandidate: {
              action: "scene_select",
              target: { kind: "chapter_outline", ref: "ch-001", fieldPath: "scenes" },
              requiresProposedValue: true,
              safeToAutoApply: false,
            },
          },
        }),
      ],
    })

    expect(report.plan.actions[0]).toMatchObject({
      match: {
        itemId: "scene-load",
        targetKind: "chapter_outline",
        targetRef: "ch-001",
        targetFieldPath: "scenes",
      },
      decision: "deferred",
      proposalCandidate: {
        action: "scene_select",
        target: { kind: "chapter_outline", ref: "ch-001", fieldPath: "scenes" },
      },
      proposedValueTemplate: ["scene-1", "scene-2", "scene-3"],
      currentValueSummary: [
        { index: 1, ref: "scene-1", kind: "dialogue", description: "First scene." },
        { index: 2, ref: "scene-2", kind: "action", description: "Second scene." },
        { index: 3, ref: "scene-3", kind: "decision", description: "Third scene." },
      ],
    })
    expect(renderReviewPlanReport(report)).toContain("1. scene-1 - First scene.")
  })

  test("buildReviewPlanReport templates scene description proposals with current scene context", () => {
    const report = buildReviewPlanReport({
      novelId: "novel",
      status: "open",
      generatedAt: "2026-05-10T00:00:00.000Z",
      targetContexts: new Map([[
        "scene_plan:scene-25:description",
        {
          currentValueSummary: {
            chapterId: "ch-002",
            index: 5,
            ref: "scene-25",
            kind: "decision",
            description: "Maren returns to Halric, her decision made.",
          },
        },
      ]]),
      items: [
        item({
          id: "ref-context",
          severity: "low",
          diagnosticLabel: "REFERENCE-CONTEXT-UNRESOLVED",
          dimension: "referenceContext",
          fixIntent: "resolve_reference_context",
          target: { kind: "scene_plan", ref: "scene-25", fieldPath: "description" },
          evidence: { eventIds: "101,102", referenceLookups: "6" },
          metadata: {
            proposalCandidate: {
              action: "field_replace",
              target: { kind: "scene_plan", ref: "scene-25", fieldPath: "description" },
              requiresProposedValue: true,
              safeToAutoApply: false,
            },
          },
        }),
      ],
    })

    expect(report.plan.actions[0]).toMatchObject({
      match: {
        itemId: "ref-context",
        targetKind: "scene_plan",
        targetRef: "scene-25",
        targetFieldPath: "description",
      },
      diagnostic: {
        label: "REFERENCE-CONTEXT-UNRESOLVED",
        dimension: "referenceContext",
        fixIntent: "resolve_reference_context",
      },
      proposalCandidate: {
        action: "field_replace",
        target: { kind: "scene_plan", ref: "scene-25", fieldPath: "description" },
      },
      proposedValueTemplate: {
        target: { kind: "scene_plan", ref: "scene-25", fieldPath: "description" },
        currentValueSummary: {
          ref: "scene-25",
          description: "Maren returns to Halric, her decision made.",
        },
        replaceWithReviewedValue: true,
      },
    })

    const rendered = renderReviewPlanReport(report)
    expect(rendered).toContain("### REFERENCE-CONTEXT-UNRESOLVED scene_plan:scene-25:description")
    expect(rendered).toContain("current scene: scene-25 (ch-002) kind=decision")
    expect(rendered).toContain("current description: Maren returns to Halric, her decision made.")
  })

  test("buildReviewPlanReport templates narrow scene scalar proposals with field context", () => {
    const targetContexts = buildReviewTargetContextsFromOutlines([{
      chapterNumber: 2,
      chapterId: "ch-002",
      title: "Seal Pressure",
      povCharacter: "Maren",
      setting: "archive",
      purpose: "Force the clerk's help.",
      targetWords: 900,
      charactersPresent: ["Maren", "Clerk"],
      scenes: [{
        sceneId: "scene-source",
        kind: "dialogue",
        description: "Maren pressures the clerk with Halric's seal.",
        goal: "Get the clerk to open the sealed transfer ledger.",
        opposition: "The clerk risks punishment if the seal is fraudulent.",
        outcome: "",
        consequence: "",
        obligations: {
          mustEstablish: [{
            obligationId: "obl-seal",
            text: "The clerk's seal proves the transfer can be forged.",
            sourceId: "fact-seal",
            sourceKind: "fact",
          }],
          mustPayOff: [],
          mustTransferKnowledge: [],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      }],
      establishedFacts: [],
    } as unknown as ChapterOutline])

    expect(targetContexts.get("scene_plan:scene-source:outcome")?.currentValueSummary).toMatchObject({
      ref: "scene-source",
      fieldPath: "outcome",
      currentValue: "",
    })

    const report = buildReviewPlanReport({
      novelId: "novel",
      status: "open",
      generatedAt: "2026-05-10T00:00:00.000Z",
      targetContexts,
      items: [
        item({
          id: "turn-outcome",
          diagnosticLabel: "SOURCE-SCENE-TURN-SHAPE-MISSING",
          dimension: "sceneContract",
          fixIntent: "complete_scene_turn",
          target: { kind: "scene_plan", ref: "scene-source", fieldPath: "outcome" },
          evidence: { sceneRef: "scene-source", missingFields: "outcome" },
          metadata: {
            proposalCandidate: {
              action: "field_replace",
              target: { kind: "scene_plan", ref: "scene-source", fieldPath: "outcome" },
              requiresProposedValue: true,
              safeToAutoApply: false,
            },
          },
        }),
      ],
    })

    expect(report.plan.actions[0]).toMatchObject({
      match: {
        itemId: "turn-outcome",
        targetKind: "scene_plan",
        targetRef: "scene-source",
        targetFieldPath: "outcome",
      },
      proposalCandidate: {
        action: "field_replace",
        target: { kind: "scene_plan", ref: "scene-source", fieldPath: "outcome" },
      },
      proposedValueTemplate: "State what materially changes by the end of the scene.",
    })

    const rendered = renderReviewPlanReport(report)
    expect(rendered).toContain("### SOURCE-SCENE-TURN-SHAPE-MISSING scene_plan:scene-source:outcome")
    expect(rendered).toContain("current scene: scene-source (ch-002) kind=dialogue")
    expect(rendered).toContain("current outcome: (empty)")
  })

  test("buildReviewPlanReport templates materiality edits as scalar obligation proposals", () => {
    const report = buildReviewPlanReport({
      novelId: "novel",
      status: "open",
      generatedAt: "2026-05-10T00:00:00.000Z",
      targetContexts: new Map([[
        "beat_obligation:obl-seal:materialityTest",
        {
          currentValueSummary: {
            ref: "obl-seal",
            chapterId: "ch-002",
            sceneRef: "scene-source",
            listKey: "mustEstablish",
            text: "The clerk's seal proves the transfer can be forged.",
            sourceId: "fact-seal",
            sourceKind: "fact",
            materialityTest: "",
          },
        },
      ]]),
      items: [
        item({
          id: "materiality",
          diagnosticLabel: "SOURCE-MATERIALITY-TEST-MISSING",
          dimension: "sceneContract",
          fixIntent: "annotate_obligation_materiality",
          target: { kind: "beat_obligation", ref: "obl-seal", fieldPath: "materialityTest" },
          evidence: { sceneRef: "scene-source", obligationIds: "obl-seal" },
          metadata: {
            proposalCandidate: {
              action: "field_replace",
              target: { kind: "beat_obligation", ref: "obl-seal", fieldPath: "materialityTest" },
              requiresProposedValue: true,
              safeToAutoApply: false,
            },
          },
        }),
      ],
    })

    expect(report.plan.actions[0]).toMatchObject({
      match: {
        itemId: "materiality",
        targetKind: "beat_obligation",
        targetRef: "obl-seal",
        targetFieldPath: "materialityTest",
      },
      decision: "deferred",
      proposalCandidate: {
        action: "field_replace",
        target: { kind: "beat_obligation", ref: "obl-seal", fieldPath: "materialityTest" },
      },
      proposedValueTemplate: "Describe how this obligation changes choice, constraint, relationship behavior, outcome, or future pressure.",
    })

    const rendered = renderReviewPlanReport(report)
    expect(rendered).toContain("### SOURCE-MATERIALITY-TEST-MISSING beat_obligation:obl-seal:materialityTest")
    expect(rendered).toContain("current obligation: obl-seal (ch-002) scene=scene-source list=mustEstablish")
    expect(rendered).toContain("current text: The clerk's seal proves the transfer can be forged.")
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
