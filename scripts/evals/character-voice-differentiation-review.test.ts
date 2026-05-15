import { describe, expect, test } from "bun:test"

import {
  deriveVoiceDifferentiationVerdict,
  normalizeVoiceDifferentiationReviewPayload,
  type VoiceDifferentiationReview,
} from "./character-voice-differentiation-review"

describe("character voice differentiation verdicts", () => {
  test("marks single-voice scenes not applicable", () => {
    expect(deriveVoiceDifferentiationVerdict(review({
      sceneHasMultipleSpeakingCharacters: false,
      voicesDifferentiated: null,
      attributionRisk: "medium",
    }))).toBe("not_applicable")
  })

  test("passes when evidence shows differentiated voices", () => {
    expect(deriveVoiceDifferentiationVerdict(review({
      sceneHasMultipleSpeakingCharacters: true,
      voicesDifferentiated: true,
      attributionRisk: "low",
      characterSignals: [{
        name: "Kael Rusk",
        evidencePresent: true,
        distinctFromOthers: true,
        evidence: "Uses clipped risk math.",
        missingReason: "",
      }],
    }))).toBe("pass")
  })

  test("misses blurred or high-risk voices and leaves incomplete evidence uncertain", () => {
    expect(deriveVoiceDifferentiationVerdict(review({
      sceneHasMultipleSpeakingCharacters: true,
      voicesDifferentiated: false,
      attributionRisk: "medium",
    }))).toBe("miss")
    expect(deriveVoiceDifferentiationVerdict(review({
      sceneHasMultipleSpeakingCharacters: true,
      voicesDifferentiated: null,
      attributionRisk: "high",
    }))).toBe("miss")
    expect(deriveVoiceDifferentiationVerdict(review({
      sceneHasMultipleSpeakingCharacters: true,
      voicesDifferentiated: null,
      attributionRisk: "medium",
    }))).toBe("uncertain")
  })
})

describe("character voice differentiation payload normalization", () => {
  test("accepts keyed character signal objects and snake-case fields", () => {
    expect(normalizeVoiceDifferentiationReviewPayload({
      scene_has_multiple_speaking_characters: true,
      voices_differentiated: "true",
      character_signals: {
        "Kael Rusk": {
          evidence_present: true,
          distinct_from_others: "yes",
          prose_evidence: "Clipped risk math.",
        },
        "Orin Vale": {
          has_evidence: false,
          distinct_from_others: null,
          missing_reason: "No line.",
        },
      },
      attribution_risk: "low",
      repair_layer: "prose",
      summary: "Distinct enough.",
    })).toEqual({
      sceneHasMultipleSpeakingCharacters: true,
      voicesDifferentiated: true,
      characterSignals: [
        {
          name: "Kael Rusk",
          evidence_present: true,
          distinct_from_others: "yes",
          prose_evidence: "Clipped risk math.",
        },
        {
          name: "Orin Vale",
          has_evidence: false,
          distinct_from_others: null,
          missing_reason: "No line.",
        },
      ],
      attributionRisk: "low",
      repairLayer: "prose",
      summary: "Distinct enough.",
    })
  })
})

function review(overrides: Partial<VoiceDifferentiationReview>): VoiceDifferentiationReview {
  return {
    sceneHasMultipleSpeakingCharacters: true,
    voicesDifferentiated: null,
    characterSignals: [],
    attributionRisk: "medium",
    repairLayer: "none",
    summary: "",
    ...overrides,
  }
}
