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
      mustEstablish: [{ id: "old-script", text: "Davan bears the Old Tongue" }],
      mustTransferKnowledge: [{ characterName: "Calla", text: "Calla learns the script predates the empire" }],
      allowedNewEntities: ["Old Tongue"],
    },
  })

  expect(beat.obligations.mustEstablish[0]).toEqual({ id: "old-script", text: "Davan bears the Old Tongue" })
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
