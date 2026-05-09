import { expect, test } from "bun:test"

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
