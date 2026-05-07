import { describe, expect, test } from "bun:test"

import {
  deriveLabel,
  scoreCase,
  summarizeResults,
} from "./planner-discernment-calibration"

describe("planner-discernment-calibration", () => {
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
