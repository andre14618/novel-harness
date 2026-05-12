import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import {
  emptyDirectives,
  normalizePlanningDirectiveRefs,
  planningDirectivesSchema,
  renderDirectivesForPlanner,
} from "./planning-directives"

test("planning directives render stable story thread and debt refs for planner", () => {
  const directives = planningDirectivesSchema.parse({
    ...emptyDirectives,
    storyThreads: [{
      label: "Folio inquiry",
      description: "Noor follows the dangerous folio truth.",
    }],
    storyDebts: [{
      promiseText: "The folio predicts a succession crime.",
      payoffPolicy: "Pay off when Noor proves the prediction has a human cause.",
    }],
    storyPayoffs: [{
      storyDebtId: "debt-the-folio-predicts-a-succession-crime",
      payoffText: "Noor proves the prediction has a human cause.",
      targetChapter: 6,
    }],
  })

  const refs = normalizePlanningDirectiveRefs(directives)
  expect(refs.storyThreads[0]?.threadId).toBe("thread-folio-inquiry")
  expect(refs.storyDebts[0]?.storyDebtId).toBe("debt-the-folio-predicts-a-succession-crime")
  expect(refs.storyDebts[0]?.threadId).toBe("thread-folio-inquiry")
  expect(refs.storyPayoffs[0]?.storyDebtId).toBe("debt-the-folio-predicts-a-succession-crime")
  expect(refs.storyPayoffs[0]?.threadId).toBe("thread-folio-inquiry")

  const rendered = renderDirectivesForPlanner(directives)
  expect(rendered).toContain("STORY THREADS")
  expect(rendered).toContain("threadId=thread-folio-inquiry")
  expect(rendered).toContain("STORY DEBTS / PROMISES")
  expect(rendered).toContain("promiseId=debt-the-folio-predicts-a-succession-crime")
  expect(rendered).toContain("STORY PAYOFF TARGETS")
  expect(rendered).toContain("payoffId=payoff-noor-proves-the-prediction-has-a-human-cause")
  expect(rendered).toContain("STORY REF RULE")
})

test("mercenary progression seed renders Book 1 contract packet for the planner", () => {
  const seed = JSON.parse(readFileSync("src/seeds/mercenary-rillgate-saltmine.json", "utf8")) as {
    chapterCount: number
    directives?: unknown
  }
  const directives = planningDirectivesSchema.parse(seed.directives)

  expect(seed.chapterCount).toBe(10)
  expect(directives.requiredBeats.map(beat => beat.chapter)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  expect(directives.requiredBeats.map(beat => beat.mustInclude[0])).toEqual([
    "MPA-01",
    "MPA-02",
    "MPA-03",
    "MPA-04",
    "MPA-05",
    "MPA-06",
    "MPA-07",
    "MPA-08",
    "MPA-09",
    "MPA-10",
  ])

  const rendered = renderDirectivesForPlanner(directives)
  expect(rendered).toContain("MPA-01 Hub pressure")
  expect(rendered).toContain("MPA-10 Return and next hook")
  expect(rendered).toContain("threadId=thread-rillgate-contract-loop")
  expect(rendered).toContain("promiseId=debt-bronze-rank")
  expect(rendered).toContain("payoffId=payoff-provisional-bronze-rank")
  expect(rendered).toContain("First two chapter scene pressure notes")
  expect(rendered).toContain("objectivePressure=Kael must get a bronze path")
})
