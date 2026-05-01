import { expect, test } from "bun:test"

import { planningStateMapperSchema } from "./schema"

test("planningStateMapperSchema normalizes aliases and optional mapper fields", () => {
  const parsed = planningStateMapperSchema.parse({
    establishedFacts: [
      { id: "archive-key", fact: "The archive key opens the sealed vault", category: "object" },
    ],
    characterStateChanges: [
      { characterName: "Istra", emotionalState: "furious clarity" },
    ],
    knowledgeChanges: [
      { characterName: "Istra", knowledge: "Aldric falsified the plague ledgers", source: "rumor" },
    ],
    beatMappings: [
      {
        beatIndex: 1,
        obligations: {
          mustEstablish: [{ id: "archive-key", text: "The archive key opens the sealed vault" }],
          mustTransferKnowledge: ["Istra learns Aldric falsified the plague ledgers"],
        },
        requiredPayoffs: [{ fact_id: "archive-key", payoff_beat: "later" }],
      },
    ],
  })

  expect(parsed.establishedFacts[0].category).toBe("physical")
  expect(parsed.characterStateChanges[0].name).toBe("Istra")
  expect(parsed.knowledgeChanges[0].source).toBe("witnessed")
  expect(parsed.beatMappings[0].obligations.mustTransferKnowledge[0].text).toBe("Istra learns Aldric falsified the plague ledgers")
  expect(parsed.beatMappings[0].requiredPayoffs).toEqual([])
})
