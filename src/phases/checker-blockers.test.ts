import { describe, expect, test } from "bun:test"
import { buildCheckerBlockerDeviations } from "./checker-blockers"

describe("buildCheckerBlockerDeviations", () => {
  test("promotes accepted beat-check blockers to beat-indexed deviations", () => {
    const deviations = buildCheckerBlockerDeviations({
      acceptedBeatIssues: [
        {
          beatIndex: 4,
          beatId: "ch-001-test-beat-005",
          issues: [
            { source: "adherence", severity: "blocker", description: "Beat events not enacted" },
            { source: "halluc-ungrounded", severity: "warning", description: "soft signal" },
          ],
        },
      ],
      continuityIssues: [],
    })

    expect(deviations).toEqual([
      { beat_index: 4, beatId: "ch-001-test-beat-005", description: "[beat-check:adherence] Beat 5: Beat events not enacted" },
    ])
  })

  test("preserves halluc-ungrounded stable entity metadata on blocker deviations", () => {
    const deviations = buildCheckerBlockerDeviations({
      acceptedBeatIssues: [
        {
          beatIndex: 0,
          beatId: "ch-001-test-beat-001",
          issues: [{
            source: "halluc-ungrounded",
            severity: "blocker",
            description: 'Ungrounded entity "Kael"',
            metadata: {
              entityRefs: [{
                kind: "character",
                ref: "char-kael",
                label: "Character: Kael",
                matchedName: "Kael",
                match: "exact",
              }],
            },
          }],
        },
      ],
      continuityIssues: [],
    })

    expect(deviations[0]?.beatId).toBe("ch-001-test-beat-001")
    expect((deviations[0]?.metadata?.entityRefs as any[] | undefined)?.[0]?.ref).toBe("char-kael")
  })

  test("keeps continuity blockers diagnostic-only", () => {
    const deviations = buildCheckerBlockerDeviations({
      acceptedBeatIssues: [],
      continuityIssues: [
        { severity: "warning", description: "minor", conflictsWith: undefined, suggestedFix: undefined },
        { severity: "blocker", description: "Wren location violation", conflictsWith: "home", suggestedFix: undefined },
      ],
    })

    expect(deviations).toEqual([])
  })

  test("does not promote continuity-state warnings into plan-assist blockers", () => {
    const deviations = buildCheckerBlockerDeviations({
      acceptedBeatIssues: [],
      continuityIssues: [
        {
          severity: "warning",
          description: "Wren location violation: prior state had her in the tower.",
          conflictsWith: "Wren crossed the market.",
          suggestedFix: undefined,
        },
      ],
    })

    expect(deviations).toEqual([])
  })

  test("promotes functional blockers with their checker source", () => {
    const deviations = buildCheckerBlockerDeviations({
      acceptedBeatIssues: [],
      continuityIssues: [],
      functionalIssues: [
        { checker: "functional-state-grounding", severity: "warning", beat_index: null, description: "soft" },
        { checker: "payoff-link-integrity", severity: "blocker", beat_index: 2, description: "missing fact id" },
      ],
    })

    expect(deviations).toEqual([
      { beat_index: 2, description: "[functional:payoff-link-integrity] missing fact id" },
    ])
  })
})
