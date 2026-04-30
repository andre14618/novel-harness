import { describe, expect, test } from "bun:test"
import { buildCheckerBlockerDeviations } from "./checker-blockers"

describe("buildCheckerBlockerDeviations", () => {
  test("promotes accepted beat-check blockers to beat-indexed deviations", () => {
    const deviations = buildCheckerBlockerDeviations({
      acceptedBeatIssues: [
        {
          beatIndex: 4,
          issues: [
            { source: "adherence", severity: "blocker", description: "Beat events not enacted" },
            { source: "halluc-ungrounded", severity: "warning", description: "soft signal" },
          ],
        },
      ],
      continuityIssues: [],
    })

    expect(deviations).toEqual([
      { beat_index: 4, description: "[beat-check:adherence] Beat 5: Beat events not enacted" },
    ])
  })

  test("promotes continuity blockers to chapter-level deviations", () => {
    const deviations = buildCheckerBlockerDeviations({
      acceptedBeatIssues: [],
      continuityIssues: [
        { severity: "warning", description: "minor", conflictsWith: undefined, suggestedFix: undefined },
        { severity: "blocker", description: "Wren location violation", conflictsWith: "home", suggestedFix: undefined },
      ],
    })

    expect(deviations).toEqual([
      { beat_index: null, description: "[continuity] Wren location violation" },
    ])
  })
})
