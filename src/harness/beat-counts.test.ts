import { expect, test } from "bun:test"

import {
  assessBeatCountForTarget,
  minimumBeatCountForTarget,
  recommendedBeatCountForTarget,
} from "./beat-counts"

test("calibrates minimum beat counts to current writer expansion length", () => {
  expect(minimumBeatCountForTarget(600)).toBe(3)
  expect(minimumBeatCountForTarget(1200)).toBe(3)
  expect(minimumBeatCountForTarget(1500)).toBe(4)
  expect(minimumBeatCountForTarget(2000)).toBe(5)
})

test("keeps recommended beat counts slightly above the hard floor", () => {
  expect(recommendedBeatCountForTarget(1200)).toBe(4)
  expect(recommendedBeatCountForTarget(1500)).toBe(5)
  expect(recommendedBeatCountForTarget(2000)).toBe(7)
})

test("uses the default target when target words are missing or invalid", () => {
  expect(minimumBeatCountForTarget(undefined)).toBe(3)
  expect(recommendedBeatCountForTarget(null)).toBe(4)
  expect(minimumBeatCountForTarget(0)).toBe(3)
})

test("assesses under- and over-planned beat counts with the planner tolerance", () => {
  expect(assessBeatCountForTarget(1500, 3)).toMatchObject({
    minRecommendedBeats: 4,
    recommendedBeats: 5,
    beatDeltaFromRecommended: -2,
    underPlanned: true,
    overPlanned: false,
  })
  expect(assessBeatCountForTarget(1500, 6)).toMatchObject({
    beatDeltaFromRecommended: 1,
    underPlanned: false,
    overPlanned: false,
  })
  expect(assessBeatCountForTarget(1500, 7)).toMatchObject({
    beatDeltaFromRecommended: 2,
    underPlanned: false,
    overPlanned: true,
  })
})
