import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import {
  emptyDirectives,
  normalizePlanningDirectiveRefs,
  planningDirectivesSchema,
  renderDirectivesForPlanner,
  renderDirectivesForSceneExpansion,
  type PlanningDirectives,
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
  expect(directives.chapterContracts.map(contract => contract.contractId)).toEqual([
    "mpa-ch01-hub-debt-pressure",
    "mpa-ch02-contract-offer-departure",
    "mpa-ch03-witness-problem",
    "mpa-ch04-arena-entry",
    "mpa-ch05-false-tactical-win",
    "mpa-ch06-midpoint-reveal",
    "mpa-ch07-progression-trial",
    "mpa-ch08-faction-trail",
    "mpa-ch09-contract-climax",
    "mpa-ch10-return-hook",
  ])

  const rendered = renderDirectivesForPlanner(directives)
  expect(rendered).toContain("MPA-01 Hub pressure")
  expect(rendered).toContain("MPA-10 Return and next hook")
  expect(rendered).toContain("CHAPTER CONTRACTS")
  expect(rendered).toContain("mpa-ch01-hub-debt-pressure")
  expect(rendered).toContain("Required endpoint: Kael understands he needs a contract")
  expect(rendered).toContain("CHAPTER SEQUENCE GUARDS")
  expect(rendered).toContain("ch1-no-contract-acceptance")
  expect(rendered).toContain("Must not contain: Lady Varn's office")
  expect(rendered).toContain("signs the contract")
  expect(rendered).toContain("Must not contain: enters the mine")
  expect(rendered).toContain("ch6-harvest-reveal")
  expect(rendered).toContain("Chapter separation guard")
  expect(rendered).toContain("Ch1 is hub/debt pressure only")
  expect(rendered).toContain("Ch3 is rival claimant and salvage/witness friction at the mine approach or threshold only")
  expect(rendered).toContain("Ch6 is the midpoint reveal and first sealed-chamber/core-harvest reveal")
  expect(rendered).toContain("threadId=thread-rillgate-contract-loop")
  expect(rendered).toContain("promiseId=debt-bronze-rank")
  expect(rendered).toContain("payoffId=payoff-provisional-bronze-rank")
  expect(rendered).toContain("First two chapter pressure notes")
  expect(rendered).toContain("objectivePressure=Kael must get a bronze path")
})

test("scene expansion directives are scoped to the target chapter contract", () => {
  const seed = JSON.parse(readFileSync("src/seeds/mercenary-rillgate-saltmine.json", "utf8")) as {
    directives?: unknown
  }
  const directives = planningDirectivesSchema.parse(seed.directives)

  const chapterOne = renderDirectivesForSceneExpansion(directives, 1)
  expect(chapterOne).toContain("CHAPTER-SCOPED DIRECTIVES")
  expect(chapterOne).toContain("TARGET CHAPTER CONTRACT")
  expect(chapterOne).toContain("mpa-ch01-hub-debt-pressure")
  expect(chapterOne).toContain("Boundary locks:")
  expect(chapterOne).toContain("MPA-01 Hub pressure")
  expect(chapterOne).toContain("Next chapter owns after this handoff: Contract decision and mission launch")
  expect(chapterOne).not.toContain("First Lady Varn office meeting")
  expect(chapterOne).not.toContain("Lady Varn's office")
  expect(chapterOne).not.toContain("MPA-06 Job complication")
  expect(chapterOne).not.toContain("First two chapter scene pressure notes")
  expect(chapterOne).not.toContain("Chapter separation guard")

  const chapterFive = renderDirectivesForSceneExpansion(directives, 5)
  expect(chapterFive).toContain("mpa-ch05-false-tactical-win")
  expect(chapterFive).toContain("Withheld here because it belongs to a later payoff boundary")
  expect(chapterFive).toContain("Chapter 5 required movement from the target contract")
  expect(chapterFive).not.toContain("illegal")
  expect(chapterFive).not.toContain("monster core")
  expect(chapterFive).not.toContain("Core Vault")
  expect(chapterFive).not.toContain("hidden operation")

  const chapterSix = renderDirectivesForSceneExpansion(directives, 6)
  expect(chapterSix).toContain("mpa-ch06-midpoint-reveal")
  expect(chapterSix).toContain("MPA-06 Job complication")
  expect(chapterSix).toContain("illegal monster-core harvest")
})

test("scene expansion directives tolerate raw must-contain-only guards", () => {
  const seed = JSON.parse(readFileSync("src/seeds/mercenary-rillgate-saltmine.json", "utf8")) as {
    directives: PlanningDirectives
  }

  expect(() => renderDirectivesForSceneExpansion(seed.directives, 2)).not.toThrow()
  expect(() => renderDirectivesForSceneExpansion(seed.directives, 6)).not.toThrow()
})
