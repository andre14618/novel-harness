import { expect, test } from "bun:test"

import { sceneBeatSchema } from "./shared"

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
