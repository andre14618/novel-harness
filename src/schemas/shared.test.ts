import { expect, test } from "bun:test"

import { sceneBeatSchema, beatObligationItemSchema } from "./shared"

test("sceneBeatSchema defaults beat obligations for legacy outlines", () => {
  const beat = sceneBeatSchema.parse({
    description: "Calla finds the old script.",
    characters: ["Calla"],
  })

  expect(beat.obligations).toEqual({
    mustEstablish: [],
    mustPayOff: [],
    mustTransferKnowledge: [],
    mustShowStateChange: [],
    mustNotReveal: [],
    allowedNewEntities: [],
  })
})

test("sceneBeatSchema accepts planner-authored beat obligations", () => {
  const beat = sceneBeatSchema.parse({
    description: "Calla deciphers Davan's inscription.",
    characters: ["Calla", "Davan"],
    obligations: {
      mustEstablish: [{
        id: "old-script",
        text: "Davan bears the Old Tongue",
        threadId: "thread-old-tongue",
        promiseId: "debt-old-tongue",
        sceneTurnId: "turn-script-reveal",
        affectedCharacterIds: ["char-davan"],
      }],
      mustTransferKnowledge: [{ characterName: "Calla", text: "Calla learns the script predates the empire" }],
      allowedNewEntities: ["Old Tongue"],
    },
  })

  expect(beat.obligations.mustEstablish[0]).toMatchObject({
    id: "old-script",
    text: "Davan bears the Old Tongue",
    threadId: "thread-old-tongue",
    promiseId: "debt-old-tongue",
    sceneTurnId: "turn-script-reveal",
    affectedCharacterIds: ["char-davan"],
  })
  expect(beat.obligations.mustTransferKnowledge[0]).toEqual({ characterName: "Calla", text: "Calla learns the script predates the empire" })
  expect(beat.obligations.mustPayOff).toEqual([])
  expect(beat.obligations.allowedNewEntities).toEqual(["Old Tongue"])
})

test("sceneBeatSchema tolerates malformed optional obligation metadata", () => {
  const beat = sceneBeatSchema.parse({
    description: "Calla deciphers Davan's inscription.",
    characters: ["Calla", "Davan"],
    obligations: {
      mustPayOff: [{ factId: "old-script" }],
      mustNotReveal: [{ text: "Do not reveal Orvath's plan", untilBeat: "later" }],
      mustTransferKnowledge: ["Calla learns Davan is marked"],
    },
  })

  expect(beat.obligations.mustPayOff[0].text).toBe("")
  expect(beat.obligations.mustNotReveal[0].untilBeat).toBeUndefined()
  expect(beat.obligations.mustTransferKnowledge[0].text).toBe("Calla learns Davan is marked")
})

test("sceneBeatSchema drops invalid optional soft-prior arrays", () => {
  const beat = sceneBeatSchema.parse({
    description: "Calla deciphers Davan's inscription.",
    characters: ["Calla", "Davan"],
    lifeValueAxes: ["agency"],
    miceActive: ["E"],
    miceOpens: ["E"],
    miceCloses: ["E"],
  })

  expect(beat.lifeValueAxes).toEqual(["agency"])
  expect(beat.miceActive).toEqual([])
  expect(beat.miceOpens).toEqual([])
  expect(beat.miceCloses).toEqual(["E"])
})

// ── L095 Slice 0: scene-contract substrate ────────────────────────────────

test("sceneBeatSchema accepts optional scene-contract fields when provided", () => {
  const beat = sceneBeatSchema.parse({
    description: "Calla confronts Orvath in the empty archive.",
    characters: ["Calla", "Orvath"],
    goal: "Force Orvath to confess his deal with the empire.",
    opposition: "Orvath knows where the script is hidden and can ruin Davan.",
    turningPoint: "Calla realises she has been the leverage all along.",
    crisisChoice: "Trade the script for Davan's safety, or burn it.",
    choiceAlternatives: [
      "Hand the script over and accept Orvath's protection.",
      "Burn the script and force Orvath into a public reckoning.",
    ],
    outcome: "Calla burns the script.",
    consequence: "Davan is exiled and the empire begins hunting Calla.",
    valueIn: "compliance",
    valueOut: "rupture",
    targetWords: 720,
    beatHints: [
      { kind: "dialogue", boundarySignal: "interruption", gapSize: "wide", purpose: "Orvath threatens to expose Davan." },
    ],
  })

  expect(beat.goal).toBe("Force Orvath to confess his deal with the empire.")
  expect(beat.choiceAlternatives).toHaveLength(2)
  expect(beat.targetWords).toBe(720)
  expect(beat.beatHints?.[0]?.kind).toBe("dialogue")
})

test("sceneBeatSchema legacy outlines round-trip without scene-contract fields", () => {
  const beat = sceneBeatSchema.parse({
    description: "Calla finds the old script.",
    characters: ["Calla"],
  })

  expect(beat.goal).toBeUndefined()
  expect(beat.opposition).toBeUndefined()
  expect(beat.choiceAlternatives).toBeUndefined()
  expect(beat.beatHints).toBeUndefined()
  expect(beat.targetWords).toBeUndefined()
})

test("beatObligationItemSchema accepts the seven storyDebtStage values", () => {
  const stages = [
    "open", "progress", "complicate", "partial_payoff", "final_payoff", "aftermath", "escalation",
  ] as const

  for (const stage of stages) {
    const obligation = beatObligationItemSchema.parse({
      text: "Davan must answer for the inscription.",
      sourceId: "fact-old-script",
      storyDebtStage: stage,
    }) as { storyDebtStage?: string }
    expect(obligation.storyDebtStage).toBe(stage)
  }
})

test("beatObligationItemSchema accepts optional materialityTest", () => {
  const obligation = beatObligationItemSchema.parse({
    text: "The empire's edict must close Davan's exile path.",
    sourceId: "fact-edict",
    materialityTest: "Edict removes the safe-haven option Calla was relying on.",
  }) as { materialityTest?: string }

  expect(obligation.materialityTest).toBe(
    "Edict removes the safe-haven option Calla was relying on.",
  )
})

test("beatObligationItemSchema legacy obligation rows have undefined materialityTest", () => {
  const obligation = beatObligationItemSchema.parse({
    text: "Davan bears the Old Tongue",
    sourceId: "fact-old-script",
  }) as { materialityTest?: string }

  expect(obligation.materialityTest).toBeUndefined()
})
