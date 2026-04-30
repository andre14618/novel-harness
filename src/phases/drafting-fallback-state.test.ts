import { expect, test } from "bun:test"

import { clearAbandonedBeatLevelState } from "./drafting"

test("chapter-level fallback discards abandoned beat-level prose and blockers", () => {
  const state = {
    beatProses: ["partial beat prose"],
    acceptedBeatCheckIssues: [
      {
        beatIndex: 0,
        issues: [{ source: "adherence" as const, severity: "blocker" as const, description: "stale blocker" }],
      },
    ],
  }

  clearAbandonedBeatLevelState(state)

  expect(state.beatProses).toEqual([])
  expect(state.acceptedBeatCheckIssues).toEqual([])
})
