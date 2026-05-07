import { describe, expect, test } from "bun:test"

import {
  buildDiscernmentSystemPrompt,
  deriveLabel,
  scoreCase,
  summarizeResults,
} from "./planner-discernment-calibration"

describe("planner-discernment-calibration", () => {
  test("uses one dimension rubric per live prompt", () => {
    const agencyPrompt = buildDiscernmentSystemPrompt("characterAgency", "direct-label")
    expect(agencyPrompt).toContain("AGENCY-0")
    expect(agencyPrompt).not.toContain("WORLD-0")
    expect(agencyPrompt).not.toContain("ENDPOINT-0")

    const worldPrompt = buildDiscernmentSystemPrompt("worldPressure", "evidence-first")
    expect(worldPrompt).toContain("WORLD-0")
    expect(worldPrompt).not.toContain("AGENCY-0")
    expect(worldPrompt).not.toContain("ENDPOINT-0")

    const causalPrompt = buildDiscernmentSystemPrompt("causalMomentum", "direct-label")
    expect(causalPrompt).toContain("CAUSAL-0")
    expect(causalPrompt).not.toContain("AGENCY-0")
    expect(causalPrompt).not.toContain("WORLD-0")
    expect(causalPrompt).not.toContain("SCENE-0")

    const scenePrompt = buildDiscernmentSystemPrompt("sceneDramaturgy", "direct-label")
    expect(scenePrompt).toContain("SCENE-0")
    expect(scenePrompt).not.toContain("CAUSAL-0")
    expect(scenePrompt).not.toContain("PROMISE-0")

    const promisePrompt = buildDiscernmentSystemPrompt("promiseProgress", "direct-label")
    expect(promisePrompt).toContain("PROMISE-0")
    expect(promisePrompt).not.toContain("SCENE-0")
    expect(promisePrompt).not.toContain("ENDPOINT-0")

    const motivePrompt = buildDiscernmentSystemPrompt("motivationSpecificity", "direct-label")
    expect(motivePrompt).toContain("MOTIVE-0")
    expect(motivePrompt).not.toContain("PROMISE-0")
    expect(motivePrompt).not.toContain("REL-0")

    const relationshipPrompt = buildDiscernmentSystemPrompt("relationshipDelta", "direct-label")
    expect(relationshipPrompt).toContain("REL-0")
    expect(relationshipPrompt).not.toContain("MOTIVE-0")
    expect(relationshipPrompt).not.toContain("STAKES-0")

    const stakesPrompt = buildDiscernmentSystemPrompt("stakesValueShift", "direct-label")
    expect(stakesPrompt).toContain("STAKES-0")
    expect(stakesPrompt).not.toContain("REL-0")
    expect(stakesPrompt).not.toContain("AGENCY-0")
  })

  test("derives anchored labels from binary gates", () => {
    expect(deriveLabel("characterAgency", {
      hasChoice: true,
      hasOpposition: true,
      hasCost: true,
      hasConsequence: true,
      hasValueTradeoff: false,
    })).toBe("AGENCY-2")
    expect(deriveLabel("worldPressure", {
      referencesWorldRule: true,
      ruleAffectsAction: true,
      createsCostOrConstraint: true,
      causesTurnOrConsequence: true,
    })).toBe("WORLD-3")
    expect(deriveLabel("endpointLanding", {
      declaredEndpoint: true,
      finalActionMatchesEndpoint: true,
      consequenceChangesNextChapter: true,
      createsForwardQuestion: false,
    })).toBe("ENDPOINT-2")
    expect(deriveLabel("causalMomentum", {
      hasEvents: true,
      hasCausalLink: true,
      escalatesPressure: true,
      hasConcreteConsequence: true,
      outcomeForcesNextAction: true,
    })).toBe("CAUSAL-3")
    expect(deriveLabel("sceneDramaturgy", {
      hasConcreteGoal: true,
      hasOpposition: true,
      hasTurn: true,
      hasOutcome: true,
      hasConsequence: true,
      hasStakesOrValueShift: false,
    })).toBe("SCENE-2")
    expect(deriveLabel("promiseProgress", {
      referencesPromise: true,
      addsNewInformation: true,
      paysOffSetup: true,
      changesGoalOrObligation: false,
      reframesCentralConflict: false,
    })).toBe("PROMISE-2")
    expect(deriveLabel("motivationSpecificity", {
      hasMotivation: true,
      tiesToSpecificCharacterDriver: true,
      driverShapesChoice: true,
      hasInternalPressureOrTradeoff: true,
      consequenceExpressesDriver: true,
    })).toBe("MOTIVE-3")
    expect(deriveLabel("relationshipDelta", {
      hasRelationshipPair: true,
      hasInteraction: true,
      changesRelationshipState: true,
      changeAffectsSceneOutcome: true,
      changeCreatesFutureObligationOrThreat: false,
    })).toBe("REL-2")
    expect(deriveLabel("stakesValueShift", {
      hasStartingValueState: true,
      hasStakes: true,
      hasTurn: true,
      endingStateDiffers: true,
      shiftHasCostOrEscalation: true,
      shiftIsIrreversibleOrForcesNext: false,
    })).toBe("STAKES-2")
  })

  test("tracks exact, off-by-one, and severe over-label rates", () => {
    const exact = scoreCase(caseWith("agency-2", "AGENCY-2"), "direct-label", "AGENCY-2", output("AGENCY-2"))
    const offByOne = scoreCase(caseWith("agency-1", "AGENCY-1"), "direct-label", "AGENCY-2", output("AGENCY-2"))
    const severeOver = scoreCase(caseWith("agency-0", "AGENCY-0"), "direct-label", "AGENCY-3", output("AGENCY-3"))

    const summary = summarizeResults([exact, offByOne, severeOver])[0]!

    expect(summary.exactAccuracy).toBeCloseTo(1 / 3)
    expect(summary.offByOneAccuracy).toBeCloseTo(2 / 3)
    expect(summary.overLabelRate).toBeCloseTo(2 / 3)
    expect(summary.severeOverLabelRate).toBeCloseTo(1 / 3)
    expect(summary.verdict).toBe("NOT-USEFUL")
  })
})

function caseWith(caseId: string, expectedLabel: string) {
  return {
    caseId,
    dimension: "characterAgency" as const,
    expectedLabel,
    text: "example",
  }
}

function output(label: string) {
  return {
    label,
    confidence: 0.8,
    evidence: { choice: "example" },
    missingForNextLevel: "",
    gates: {},
  }
}
