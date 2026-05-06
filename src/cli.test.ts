import { describe, expect, test } from "bun:test"

import { formatPlanAssistDeviationBeatLabel } from "./cli"

describe("formatPlanAssistDeviationBeatLabel", () => {
  test("keeps chapter-level deviations explicit", () => {
    expect(formatPlanAssistDeviationBeatLabel({ beat_index: null })).toBe("chapter-level")
    expect(formatPlanAssistDeviationBeatLabel({})).toBe("chapter-level")
  })

  test("renders zero-based beat indexes as operator-facing one-based labels", () => {
    expect(formatPlanAssistDeviationBeatLabel({ beat_index: 0 })).toBe("beat 1")
    expect(formatPlanAssistDeviationBeatLabel({ beat_index: 4 })).toBe("beat 5")
  })
})
