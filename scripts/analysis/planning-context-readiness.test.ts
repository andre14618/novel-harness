import { describe, expect, test } from "bun:test"

import {
  buildPlanningContextReadinessAggregate,
  parseArgs,
  renderPlanningContextReadinessAggregate,
} from "./planning-context-readiness"
import type { PlanningToDraftingContextReport } from "./planning-drafting-context-report"
import { buildPlanReadinessDraftsFromAggregate } from "../../src/harness/plan-readiness"

describe("planning-context-readiness", () => {
  test("parses novel or report inputs", () => {
    expect(parseArgs(["--novel", "n"]).novelId).toBe("n")
    expect(parseArgs(["--report", "context.json", "--include-dense"]).includeDense).toBe(true)
    expect(() => parseArgs([])).toThrow(/--novel or --report/)
  })

  test("turns overloaded scene-load chapters into readiness groups", () => {
    const aggregate = buildPlanningContextReadinessAggregate({
      report: report(),
      sourceReport: "context.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(aggregate.groupCount).toBe(1)
    expect(aggregate.findingCount).toBe(1)
    const group = aggregate.groups[0]!
    expect(group.chapterId).toBe("ch-001")
    expect(group.highestSeverity).toBe("high")
    expect(group.findings[0]).toMatchObject({
      label: "SCENE-LOAD-OVERLOADED",
      dimension: "sceneLoad",
      fixIntent: "rebalance_scene_load",
      evidence: {
        sceneRefs: "scene-1,scene-2",
      },
    })
    expect(group.rewritePacket.proposalCandidate).toMatchObject({
      action: "scene_select",
      target: {
        kind: "chapter_outline",
        ref: "ch-001",
        fieldPath: "scenes",
      },
      safeToAutoApply: false,
    })
    expect(renderPlanningContextReadinessAggregate(aggregate)).toContain("Should this chapter be split")
  })

  test("includes dense chapters only when requested", () => {
    const base = buildPlanningContextReadinessAggregate({
      report: report(),
      generatedAt: "2026-05-11T00:00:00.000Z",
    })
    const withDense = buildPlanningContextReadinessAggregate({
      report: report(),
      includeDense: true,
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(base.groups.map(group => group.chapterId)).toEqual(["ch-001"])
    expect(withDense.groups.map(group => group.chapterId)).toEqual(["ch-001", "ch-002"])
    expect(withDense.groups[1]!.findings[0]!.label).toBe("SCENE-LOAD-DENSE")
    expect(withDense.groups[1]!.highestSeverity).toBe("medium")
  })

  test("accepts legacy context reports without scene refs", () => {
    const legacy = report() as unknown as PlanningToDraftingContextReport
    delete (legacy.upstream.sceneLoad.chapters[0] as { sceneRefs?: string[] }).sceneRefs

    const aggregate = buildPlanningContextReadinessAggregate({
      report: legacy,
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(aggregate.groupCount).toBe(1)
    expect(aggregate.groups[0]!.findings[0]!.evidence.sceneRefs).toBe("")
  })

  test("emits aggregates consumable by the shared readiness importer", () => {
    const aggregate = buildPlanningContextReadinessAggregate({
      report: report(),
      sourceReport: "context.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    })
    const built = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-load",
      aggregate,
      targetVersions: {
        "chapter_outline:ch-001": "outline-hash-1",
      },
      importedByKind: "script",
      importedByRef: "planning-context-readiness-test",
    })

    expect(built.skipped).toEqual([])
    expect(built.drafts).toHaveLength(1)
    expect(built.drafts[0]).toMatchObject({
      target: { kind: "chapter_outline", ref: "ch-001", fieldPath: "scenes" },
      sourceHash: "outline-hash-1",
      sourceHashKind: "target_current_version",
      diagnosticLabel: "SCENE-LOAD-OVERLOADED",
      dimension: "sceneLoad",
      fixIntent: "rebalance_scene_load",
      severity: "high",
      importedByRef: "planning-context-readiness-test",
      metadata: {
        proposalCandidate: {
          action: "scene_select",
          target: { kind: "chapter_outline", ref: "ch-001", fieldPath: "scenes" },
          requiresProposedValue: true,
          proposedValueStatus: "operator_required",
          safeToAutoApply: false,
          sourceAgent: "planning-context-readiness",
        },
      },
    })
  })

  test("turns future-event anchor findings into scene-plan readiness groups", () => {
    const aggregate = buildPlanningContextReadinessAggregate({
      report: report({
        planContinuity: {
          futureEventAnchors: [{
            label: "FUTURE-EVENT-ANCHOR-MISSING",
            severity: "medium",
            sourceChapterNumber: 1,
            sourceChapterId: "ch-001",
            targetChapterNumber: 2,
            targetChapterId: "ch-002",
            sourceRef: "fact-verification-scheduled",
            targetSceneRef: "scene-12",
            sourceText: "A mandatory Verification test is scheduled for tomorrow at dawn",
            targetTextExcerpt: "Cassel activates Verification on the bridge.",
            eventTokens: ["verification"],
            requiredTemporalCue: "Carry the dawn timing into the later scene or explicitly revise the schedule.",
          }],
          factContradictions: [],
        },
      }),
      sourceReport: "context.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(aggregate.groups).toHaveLength(2)
    const group = aggregate.groups[1]!
    expect(group).toMatchObject({
      unitType: "scene",
      chapterId: "ch-002",
      sceneId: "scene-12",
      highestSeverity: "medium",
      dimensions: ["futureEventAnchor"],
      fixIntents: ["preserve_future_event_anchor"],
    })
    expect(group.findings[0]).toMatchObject({
      label: "FUTURE-EVENT-ANCHOR-MISSING",
      dimension: "futureEventAnchor",
      fixIntent: "preserve_future_event_anchor",
      evidence: {
        sourceRef: "fact-verification-scheduled",
        targetSceneRef: "scene-12",
      },
    })
    expect(group.rewritePacket.proposalCandidate).toMatchObject({
      action: "field_replace",
      target: {
        kind: "scene_plan",
        ref: "scene-12",
        fieldPath: "temporalAnchor",
      },
      safeToAutoApply: false,
    })
    expect(renderPlanningContextReadinessAggregate(aggregate)).toContain("Should this scene contract carry the scheduled temporal anchor")

    const built = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-load",
      aggregate,
      targetVersions: {
        "chapter_outline:ch-001": "outline-hash-1",
        "scene_plan:scene-12": "scene-hash-12",
      },
    })
    expect(built.skipped).toEqual([])
    expect(built.drafts[1]).toMatchObject({
      target: { kind: "scene_plan", ref: "scene-12", fieldPath: "temporalAnchor" },
      sourceHash: "scene-hash-12",
      diagnosticLabel: "FUTURE-EVENT-ANCHOR-MISSING",
      dimension: "futureEventAnchor",
      fixIntent: "preserve_future_event_anchor",
      metadata: {
        proposalCandidate: {
          action: "field_replace",
          target: { kind: "scene_plan", ref: "scene-12", fieldPath: "temporalAnchor" },
          requiresProposedValue: true,
          proposedValueStatus: "operator_required",
          safeToAutoApply: false,
          sourceAgent: "planning-context-readiness",
        },
      },
    })
  })

  test("turns fact status contradictions into manual scene replacement readiness", () => {
    const aggregate = buildPlanningContextReadinessAggregate({
      report: report({
        planContinuity: {
          futureEventAnchors: [],
          factContradictions: [{
            label: "PLAN-FACT-STATUS-CONTRADICTION",
            severity: "high",
            sourceChapterNumber: 1,
            sourceChapterId: "ch-001",
            targetChapterNumber: 2,
            targetChapterId: "ch-002",
            sourceRef: "fact-corso-file",
            targetSceneRef: "scene-12",
            sourceText: "Foreman Corso is imprisoned for 200 silver thalers.",
            targetTextExcerpt: "Maren finds the foreman's file clean of any debt or crime.",
            sharedAnchors: ["foreman"],
            conflictTokens: ["clean-record-vs-debt"],
            requiredFactStatus: "Preserve fact-corso-file: Foreman Corso is imprisoned for 200 silver thalers.",
          }],
        },
      }),
      sourceReport: "context.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(aggregate.groups).toHaveLength(2)
    const group = aggregate.groups[1]!
    expect(group).toMatchObject({
      unitType: "scene",
      chapterId: "ch-002",
      sceneId: "scene-12",
      highestSeverity: "high",
      dimensions: ["factContinuity"],
      fixIntents: ["preserve_immutable_fact"],
      sourceIds: {
        sceneTurnIds: ["scene-12"],
        sourceIds: ["fact-corso-file"],
      },
    })
    expect(group.findings[0]).toMatchObject({
      label: "PLAN-FACT-STATUS-CONTRADICTION",
      dimension: "factContinuity",
      fixIntent: "preserve_immutable_fact",
      evidence: {
        sourceRef: "fact-corso-file",
        targetSceneRef: "scene-12",
        conflictTokens: "clean-record-vs-debt",
      },
    })
    expect(group.rewritePacket.proposalCandidate).toMatchObject({
      action: "beat_replace",
      target: {
        kind: "scene_plan",
        ref: "scene-12",
        fieldPath: "self",
      },
      safeToAutoApply: false,
    })
    expect(renderPlanningContextReadinessAggregate(aggregate)).toContain("Should this scene plan preserve the established fact")

    const built = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-load",
      aggregate,
      targetVersions: {
        "chapter_outline:ch-001": "outline-hash-1",
        "scene_plan:scene-12": "scene-hash-12",
      },
    })
    expect(built.skipped).toEqual([])
    expect(built.drafts[1]).toMatchObject({
      target: { kind: "scene_plan", ref: "scene-12", fieldPath: "self" },
      sourceHash: "scene-hash-12",
      diagnosticLabel: "PLAN-FACT-STATUS-CONTRADICTION",
      dimension: "factContinuity",
      fixIntent: "preserve_immutable_fact",
    })
  })

  test("turns partial scene-contract shape into manual scene replacement readiness", () => {
    const aggregate = buildPlanningContextReadinessAggregate({
      report: report({
        scenesWithSceneContract: 1,
        sceneContractsWithDramaticShape: 1,
        sceneContractsWithEndpointShape: 1,
        sceneContractsWithChoiceShape: 0,
        sceneContractsWithFullDramaticShape: 0,
        sceneContractShape: {
          missingDramaticShape: [],
          missingChoiceShape: [{
            label: "SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE",
            severity: "medium",
            chapterNumber: 2,
            chapterId: "ch-002",
            sceneRef: "scene-12",
            descriptionExcerpt: "Maren confronts the false transfer record.",
            hasTemporalAnchor: true,
            hasPlaceAnchor: true,
            hasObligations: true,
            hasChoiceShape: false,
            hasEndpointShape: true,
            hasFullDramaticShape: false,
            characterCount: 2,
            obligationIds: ["obl-transfer"],
            characterIds: ["char-maren"],
            sourceIds: ["fact-transfer-order"],
            threadIds: ["thread-ledger"],
            promiseIds: [],
            payoffIds: [],
            missingFields: ["crisisChoice", "choiceAlternatives"],
          }],
          missingFullDramaticShape: [{
            label: "SCENE-CONTRACT-FULL-SHAPE-INCOMPLETE",
            severity: "medium",
            chapterNumber: 2,
            chapterId: "ch-002",
            sceneRef: "scene-12",
            descriptionExcerpt: "Maren confronts the false transfer record.",
            hasTemporalAnchor: true,
            hasPlaceAnchor: true,
            hasObligations: true,
            hasChoiceShape: false,
            hasEndpointShape: true,
            hasFullDramaticShape: false,
            characterCount: 2,
            obligationIds: ["obl-transfer"],
            characterIds: ["char-maren"],
            sourceIds: ["fact-transfer-order"],
            threadIds: ["thread-ledger"],
            promiseIds: [],
            payoffIds: [],
            missingFields: ["crisisChoice", "choiceAlternatives", "povPersonalStake"],
          }],
          anchorOnly: [],
        },
      }),
      sourceReport: "context.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(aggregate.groups).toHaveLength(2)
    const group = aggregate.groups[1]!
    expect(group).toMatchObject({
      unitType: "scene",
      chapterId: "ch-002",
      sceneId: "scene-12",
      highestSeverity: "medium",
      dimensions: ["sceneContract"],
      fixIntents: ["complete_scene_contract"],
      sourceIds: {
        obligationIds: ["obl-transfer"],
        characterIds: ["char-maren"],
        sceneTurnIds: ["scene-12"],
        sourceIds: ["fact-transfer-order"],
        threadIds: ["thread-ledger"],
      },
    })
    expect(group.findings[0]).toMatchObject({
      label: "SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE",
      dimension: "sceneContract",
      fixIntent: "complete_scene_contract",
      evidence: {
        sceneRef: "scene-12",
        missingFields: "crisisChoice,choiceAlternatives",
      },
    })
    expect(group.rewritePacket.proposalCandidate).toMatchObject({
      action: "beat_replace",
      target: {
        kind: "scene_plan",
        ref: "scene-12",
        fieldPath: "self",
      },
      safeToAutoApply: false,
    })
    expect(renderPlanningContextReadinessAggregate(aggregate)).toContain("Should this scene plan be replaced")

    const built = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-load",
      aggregate,
      targetVersions: {
        "chapter_outline:ch-001": "outline-hash-1",
        "scene_plan:scene-12": "scene-hash-12",
      },
    })
    expect(built.skipped).toEqual([])
    expect(built.drafts[1]).toMatchObject({
      target: { kind: "scene_plan", ref: "scene-12", fieldPath: "self" },
      sourceHash: "scene-hash-12",
      diagnosticLabel: "SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE",
      dimension: "sceneContract",
      fixIntent: "complete_scene_contract",
      preserveIds: {
        obligationIds: ["obl-transfer"],
        characterIds: ["char-maren"],
        sceneTurnIds: ["scene-12"],
        sourceIds: ["fact-transfer-order"],
        threadIds: ["thread-ledger"],
      },
      metadata: {
        proposalCandidate: {
          action: "beat_replace",
          target: { kind: "scene_plan", ref: "scene-12", fieldPath: "self" },
          requiresProposedValue: true,
          proposedValueStatus: "operator_required",
          safeToAutoApply: false,
          sourceAgent: "planning-context-readiness",
        },
      },
    })
  })

  test("turns semantic backfill gaps into specific readiness labels", () => {
    const aggregate = buildPlanningContextReadinessAggregate({
      report: report({
        sceneContractShape: {
          missingDramaticShape: [],
          missingEndpointShape: [{
            label: "SCENE-TURN-ENDPOINT-MISSING",
            severity: "medium",
            chapterNumber: 2,
            chapterId: "ch-002",
            sceneRef: "scene-final",
            descriptionExcerpt: "Maren reaches Halric's chamber.",
            hasTemporalAnchor: false,
            hasPlaceAnchor: false,
            hasObligations: false,
            hasChoiceShape: false,
            hasEndpointShape: false,
            hasFullDramaticShape: false,
            characterCount: 1,
            obligationIds: [],
            characterIds: [],
            sourceIds: [],
            threadIds: [],
            promiseIds: [],
            payoffIds: [],
            missingFields: ["outcome", "consequence"],
          }, {
            label: "SCENE-TURN-ENDPOINT-MISSING",
            severity: "medium",
            chapterNumber: 2,
            chapterId: "ch-002",
            sceneRef: "scene-final-consequence",
            descriptionExcerpt: "Maren wins the seal but the hook is absent.",
            hasTemporalAnchor: false,
            hasPlaceAnchor: false,
            hasObligations: false,
            hasChoiceShape: false,
            hasEndpointShape: false,
            hasFullDramaticShape: false,
            characterCount: 1,
            obligationIds: [],
            characterIds: [],
            sourceIds: [],
            threadIds: [],
            promiseIds: [],
            payoffIds: [],
            missingFields: ["consequence"],
          }],
          missingTurnShape: [{
            label: "SOURCE-SCENE-TURN-SHAPE-MISSING",
            severity: "medium",
            chapterNumber: 2,
            chapterId: "ch-002",
            sceneRef: "scene-source",
            descriptionExcerpt: "Maren forces a clerk's help.",
            hasTemporalAnchor: false,
            hasPlaceAnchor: false,
            hasObligations: true,
            hasChoiceShape: false,
            hasEndpointShape: false,
            hasFullDramaticShape: false,
            characterCount: 2,
            obligationIds: ["obl-seal"],
            characterIds: [],
            sourceIds: ["fact-seal"],
            threadIds: [],
            promiseIds: [],
            payoffIds: [],
            missingFields: ["goal", "opposition", "outcome", "consequence"],
          }, {
            label: "SOURCE-SCENE-TURN-SHAPE-MISSING",
            severity: "medium",
            chapterNumber: 2,
            chapterId: "ch-002",
            sceneRef: "scene-source-goal",
            descriptionExcerpt: "Maren pressures the clerk with the seal.",
            hasTemporalAnchor: false,
            hasPlaceAnchor: false,
            hasObligations: true,
            hasChoiceShape: false,
            hasEndpointShape: false,
            hasFullDramaticShape: false,
            characterCount: 2,
            obligationIds: ["obl-seal"],
            characterIds: [],
            sourceIds: ["fact-seal"],
            threadIds: [],
            promiseIds: [],
            payoffIds: [],
            missingFields: ["goal"],
          }],
          missingMaterialityTest: [{
            label: "SOURCE-MATERIALITY-TEST-MISSING",
            severity: "medium",
            chapterNumber: 2,
            chapterId: "ch-002",
            sceneRef: "scene-source",
            descriptionExcerpt: "Maren forces a clerk's help.",
            hasTemporalAnchor: false,
            hasPlaceAnchor: false,
            hasObligations: true,
            hasChoiceShape: false,
            hasEndpointShape: false,
            hasFullDramaticShape: false,
            characterCount: 2,
            obligationIds: ["obl-seal"],
            characterIds: [],
            sourceIds: ["fact-seal"],
            threadIds: [],
            promiseIds: [],
            payoffIds: [],
            missingFields: ["materialityTest"],
          }],
          missingChoiceShape: [],
          missingFullDramaticShape: [],
          anchorOnly: [],
        },
      }),
      sourceReport: "context.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    const labels = aggregate.groups.flatMap(group => group.findings.map(finding => finding.label))
    expect(labels).toContain("SCENE-TURN-ENDPOINT-MISSING")
    expect(labels).toContain("SOURCE-SCENE-TURN-SHAPE-MISSING")
    expect(labels).toContain("SOURCE-MATERIALITY-TEST-MISSING")
    const narrowEndpoint = aggregate.groups.find(group => group.sceneId === "scene-final-consequence")
    expect(narrowEndpoint).toMatchObject({
      rewritePacket: {
        proposalCandidate: {
          action: "field_replace",
          target: { kind: "scene_plan", ref: "scene-final-consequence", fieldPath: "consequence" },
        },
      },
    })
    const narrowTurn = aggregate.groups.find(group => group.sceneId === "scene-source-goal")
    expect(narrowTurn).toMatchObject({
      rewritePacket: {
        proposalCandidate: {
          action: "field_replace",
          target: { kind: "scene_plan", ref: "scene-source-goal", fieldPath: "goal" },
        },
      },
    })
    const materiality = aggregate.groups.find(group => group.findings[0]?.label === "SOURCE-MATERIALITY-TEST-MISSING")
    expect(materiality?.rewritePacket.rewriteGoals).toContain("Annotate existing obligations only; do not add new obligations just to satisfy the field.")
    expect(materiality).toMatchObject({
      fixIntents: ["annotate_obligation_materiality"],
      rewritePacket: {
        targetSummary: "obligation obl-seal in scene scene-source",
        proposalCandidate: {
          action: "field_replace",
          target: {
            kind: "beat_obligation",
            ref: "obl-seal",
            fieldPath: "materialityTest",
          },
          safeToAutoApply: false,
        },
      },
    })
    expect(renderPlanningContextReadinessAggregate(aggregate)).toContain("SOURCE-MATERIALITY-TEST-MISSING")

    const built = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-load",
      aggregate,
      targetVersions: {
        "scene_plan:scene-final": "scene-hash-final",
        "scene_plan:scene-final-consequence": "scene-hash-final-consequence",
        "scene_plan:scene-source": "scene-hash-source",
        "scene_plan:scene-source-goal": "scene-hash-source-goal",
        "beat_obligation:obl-seal": "obl-hash-seal",
      },
    })
    expect(built.skipped).toEqual([])
    expect(built.drafts.find(draft => draft.target.ref === "scene-final-consequence")).toMatchObject({
      target: { kind: "scene_plan", ref: "scene-final-consequence", fieldPath: "consequence" },
      sourceHash: "scene-hash-final-consequence",
    })
    expect(built.drafts.find(draft => draft.target.ref === "scene-source-goal")).toMatchObject({
      target: { kind: "scene_plan", ref: "scene-source-goal", fieldPath: "goal" },
      sourceHash: "scene-hash-source-goal",
    })
    expect(built.drafts.find(draft => draft.diagnosticLabel === "SOURCE-MATERIALITY-TEST-MISSING")).toMatchObject({
      target: { kind: "beat_obligation", ref: "obl-seal", fieldPath: "materialityTest" },
      sourceHash: "obl-hash-seal",
      fixIntent: "annotate_obligation_materiality",
      metadata: {
        proposalCandidate: {
          action: "field_replace",
          target: { kind: "beat_obligation", ref: "obl-seal", fieldPath: "materialityTest" },
          requiresProposedValue: true,
          safeToAutoApply: false,
        },
      },
    })
  })

  test("turns duplicate endpoint fields into scene replacement readiness", () => {
    const aggregate = buildPlanningContextReadinessAggregate({
      report: report({
        sceneContractShape: {
          missingDramaticShape: [],
          missingChoiceShape: [],
          missingFullDramaticShape: [],
          endpointHygiene: [{
            label: "SCENE-ENDPOINT-DUPLICATE",
            severity: "medium",
            chapterNumber: 4,
            chapterId: "ch-004",
            sceneRef: "scene-duplicate-endpoint",
            descriptionExcerpt: "Maren agrees to wait outside the archive.",
            hasTemporalAnchor: false,
            hasPlaceAnchor: false,
            hasObligations: false,
            hasChoiceShape: false,
            hasEndpointShape: true,
            hasFullDramaticShape: false,
            characterCount: 1,
            obligationIds: [],
            characterIds: ["char-maren"],
            sourceIds: [],
            threadIds: [],
            promiseIds: [],
            payoffIds: [],
            missingFields: ["consequence-duplicates-outcome"],
          }],
          anchorOnly: [],
        },
      }),
      sourceReport: "context.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    const group = aggregate.groups.find(candidate => candidate.sceneId === "scene-duplicate-endpoint")
    expect(group).toMatchObject({
      unitType: "scene",
      chapterId: "ch-004",
      sceneId: "scene-duplicate-endpoint",
      dimensions: ["sceneContract"],
      fixIntents: ["complete_scene_endpoint"],
      rewritePacket: {
        proposalCandidate: {
          action: "beat_replace",
          target: { kind: "scene_plan", ref: "scene-duplicate-endpoint", fieldPath: "self" },
        },
      },
    })
    expect(group?.findings[0]).toMatchObject({
      label: "SCENE-ENDPOINT-DUPLICATE",
      fixIntent: "complete_scene_endpoint",
      missingForNextLevel: expect.stringContaining("distinct downstream effect"),
    })
  })

  test("turns unresolved reference attempts into manual scene description readiness", () => {
    const contextReport = report()
    contextReport.referenceContextAttempts = [{
      eventIds: [101, 102],
      eventCount: 2,
      chapter: 2,
      beatIndex: 4,
      stages: ["initial", "integrity-rewrite"],
      sceneRef: "scene-25",
      descriptionExcerpt: "Maren returns to Halric, her decision made.",
      referenceLookups: 6,
      referenceLlmCalls: 2,
      canonSourceRefs: 3,
      canonSourceRefValues: ["fact-ledger", "fact-riot"],
      storyRefIds: 2,
      activeThreadIdValues: ["thread-court"],
      activePromiseIdValues: ["promise-halric"],
      activePayoffIdValues: ["payoff-riot"],
      readerInfoStateChars: 552,
      missingCharacterIds: 1,
      missingCharacterIdValues: ["char-halric"],
    }]

    const aggregate = buildPlanningContextReadinessAggregate({
      report: contextReport,
      sourceReport: "context.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(aggregate.groups).toHaveLength(2)
    const group = aggregate.groups[1]!
    expect(group).toMatchObject({
      unitType: "scene",
      sceneId: "scene-25",
      highestSeverity: "low",
      dimensions: ["referenceContext"],
      fixIntents: ["resolve_reference_context"],
      sourceIds: {
        characterIds: ["char-halric"],
        sceneTurnIds: ["scene-25"],
        sourceIds: ["fact-ledger", "fact-riot"],
        threadIds: ["thread-court"],
        promiseIds: ["promise-halric"],
        payoffIds: ["payoff-riot"],
      },
    })
    expect(group.findings[0]).toMatchObject({
      label: "REFERENCE-CONTEXT-UNRESOLVED",
      dimension: "referenceContext",
      fixIntent: "resolve_reference_context",
      evidence: {
        eventIds: "101,102",
        referenceLookups: "6",
        sceneRef: "scene-25",
        canonSourceRefValues: "fact-ledger,fact-riot",
        activeThreadIdValues: "thread-court",
        activePromiseIdValues: "promise-halric",
        activePayoffIdValues: "payoff-riot",
        missingCharacterIdValues: "char-halric",
      },
    })
    expect(group.rewritePacket.proposalCandidate).toMatchObject({
      action: "field_replace",
      target: {
        kind: "scene_plan",
        ref: "scene-25",
        fieldPath: "description",
      },
      safeToAutoApply: false,
    })
    expect(renderPlanningContextReadinessAggregate(aggregate)).toContain("Should this scene description name the referenced prior context directly")

    const built = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-load",
      aggregate,
      targetVersions: {
        "chapter_outline:ch-001": "outline-hash-1",
        "scene_plan:scene-25": "scene-hash-25",
      },
    })
    expect(built.skipped).toEqual([])
    expect(built.drafts[1]).toMatchObject({
      target: { kind: "scene_plan", ref: "scene-25", fieldPath: "description" },
      sourceHash: "scene-hash-25",
      diagnosticLabel: "REFERENCE-CONTEXT-UNRESOLVED",
      dimension: "referenceContext",
      fixIntent: "resolve_reference_context",
      severity: "low",
    })
  })
})

function report(overrides: Partial<PlanningToDraftingContextReport["upstream"]> = {}): PlanningToDraftingContextReport {
  return {
    novelId: "novel-load",
    upstream: {
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characterCount: 3,
      canonFactCount: 0,
      canonKnowledgeChangeCount: 0,
      canonCharacterStateChangeCount: 0,
      canonChangeCount: 0,
      chapterPlanCount: 3,
      plannedSceneCount: 25,
      sceneLoad: {
        maxScenesPerChapter: 10,
        minTargetWordsPerScene: 120,
        denseChapterCount: 1,
        overloadedChapterCount: 1,
        chapters: [
          {
            chapterNumber: 1,
            chapterId: "ch-001",
            sceneRefs: ["scene-1", "scene-2"],
            sceneCount: 10,
            targetWords: 1200,
            targetWordsPerScene: 120,
            signal: "overloaded",
          },
          {
            chapterNumber: 2,
            chapterId: "ch-002",
            sceneRefs: ["scene-11", "scene-12"],
            sceneCount: 9,
            targetWords: 2400,
            targetWordsPerScene: 266.6666667,
            signal: "dense",
          },
          {
            chapterNumber: 3,
            chapterId: "ch-003",
            sceneRefs: ["scene-21"],
            sceneCount: 6,
            targetWords: 1800,
            targetWordsPerScene: 300,
            signal: "balanced",
          },
        ],
      },
      planContinuity: {
        futureEventAnchors: [],
        factContradictions: [],
      },
      scenesWithCharacters: 25,
      scenesWithSceneIds: 25,
      scenesWithSceneContract: 0,
      scenesWithTemporalAnchor: 0,
      scenesWithPlaceAnchor: 0,
      sceneContractsWithDramaticShape: 0,
      sceneContractsWithChoiceShape: 0,
      sceneContractsWithEndpointShape: 0,
      sceneContractsWithFullDramaticShape: 0,
      anchorOnlySceneContracts: 0,
      sceneContractShape: {
        missingDramaticShape: [],
        missingChoiceShape: [],
        missingFullDramaticShape: [],
        anchorOnly: [],
      },
      scenesWithObligations: 12,
      scenesWithImplicitReferences: 0,
      implicitReferenceScenes: [],
      chaptersWithSetting: 3,
      chaptersWithCharactersPresentIds: 3,
      readerInfoSourceChapters: 2,
      obligationIds: 12,
      obligationSourceRefs: 12,
      activeStoryRefIds: 0,
      ...overrides,
    },
    downstream: {
      events: 0,
      withCharacterContext: 0,
      withCharacterProfiles: 0,
      withCharacterSnapshots: 0,
      withCharacterContextCapsules: 0,
      withWorldContext: 0,
      withWorldBible: 0,
      withSetting: 0,
      withStoryContext: 0,
      storyRefIds: 0,
      withReaderInfoState: 0,
      readerInfoStateChars: 0,
      withImplicitReferences: 0,
      withResolvedReferences: 0,
      referenceLookups: 0,
      referenceLlmCalls: 0,
      withSceneContract: 0,
      withSceneEndpointLandingGuidance: 0,
      withSceneContractShapeCounts: 0,
      withSceneContractAnchors: 0,
      withDramaticSceneContract: 0,
      withAnchorOnlySceneContract: 0,
      sceneContractFields: 0,
      sceneContractAnchorFields: 0,
      sceneContractDramaticFields: 0,
      sceneContractEndpointFields: 0,
      sceneContractBudgetFields: 0,
      withObligations: 0,
      withCanonFactContext: 0,
      withFactContinuityAnchors: 0,
      canonSourceRefs: 0,
      canonSourceRefCounts: {},
      missingCharacterIds: 0,
      missingCharacterIdCounts: {},
      activeThreadIdCounts: {},
      activePromiseIdCounts: {},
      activePayoffIdCounts: {},
      withDraftingBriefTrace: 0,
    },
    surfaces: [],
    gaps: [],
    referenceContextAttempts: [],
  }
}
