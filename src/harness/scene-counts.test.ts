import { expect, test } from "bun:test"

import {
  assessSceneCountForTarget,
  minimumSceneCountForTarget,
  planningSceneCountPolicy,
  recommendedSceneCountForTarget,
} from "./scene-counts"

test("calibrates minimum scene counts to current writer expansion length", () => {
  expect(minimumSceneCountForTarget(600)).toBe(3)
  expect(minimumSceneCountForTarget(1200)).toBe(3)
  expect(minimumSceneCountForTarget(1500)).toBe(4)
  expect(minimumSceneCountForTarget(2000)).toBe(5)
})

test("keeps recommended scene counts slightly above the hard floor", () => {
  expect(recommendedSceneCountForTarget(1200)).toBe(4)
  expect(recommendedSceneCountForTarget(1500)).toBe(5)
  expect(recommendedSceneCountForTarget(2000)).toBe(7)
})

test("uses the default target when target words are missing or invalid", () => {
  expect(minimumSceneCountForTarget(undefined)).toBe(3)
  expect(recommendedSceneCountForTarget(null)).toBe(4)
  expect(minimumSceneCountForTarget(0)).toBe(3)
})

test("assesses under- and over-planned scene counts with the planner tolerance", () => {
  expect(assessSceneCountForTarget(1500, 3)).toMatchObject({
    minRecommendedScenes: 4,
    recommendedScenes: 5,
    sceneDeltaFromRecommended: -2,
    underPlanned: true,
    overPlanned: false,
  })
  expect(assessSceneCountForTarget(1500, 6)).toMatchObject({
    sceneDeltaFromRecommended: 1,
    underPlanned: false,
    overPlanned: false,
  })
  expect(assessSceneCountForTarget(1500, 7)).toMatchObject({
    sceneDeltaFromRecommended: 2,
    underPlanned: false,
    overPlanned: true,
  })
})

test("resolves default-off planning scene cap policy", () => {
  expect(planningSceneCountPolicy(1500, null)).toMatchObject({
    minRecommendedScenes: 4,
    recommendedScenes: 5,
    configuredMaxScenes: null,
    effectiveMaxScenes: null,
    capRaisedToFloor: false,
  })

  expect(planningSceneCountPolicy(1500, 5)).toMatchObject({
    configuredMaxScenes: 5,
    effectiveMaxScenes: 5,
    capRaisedToFloor: false,
  })
})

test("raises an experiment cap below the calibrated floor", () => {
  expect(planningSceneCountPolicy(2000, 4)).toMatchObject({
    minRecommendedScenes: 5,
    configuredMaxScenes: 4,
    effectiveMaxScenes: 5,
    capRaisedToFloor: true,
  })
})
