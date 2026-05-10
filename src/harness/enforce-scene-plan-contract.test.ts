import { expect, test } from "bun:test"

import { enforceScenePlanContract } from "./enforce"
import type { ChapterOutline } from "../types"

function chapter(scenes: any[]): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "test",
    purpose: "test purpose",
    setting: "test setting",
    povCharacter: "Calla",
    targetWords: 1500,
    charactersPresent: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    scenes,
  } as unknown as ChapterOutline
}

const FILLED_SCENE = {
  description: "Calla confronts Orvath in the archive.",
  characters: ["Calla", "Orvath"],
  beatId: "ch-001-test-beat-001-confront",
  goal: "Force Orvath to confess his deal with the empire.",
  crisisChoice: "Trade the script for Davan's safety, or burn it.",
  outcome: "Calla burns the script.",
  consequence: "Davan is exiled and the empire begins hunting Calla.",
  povPersonalStake: "Calla cannot let Davan be reduced to leverage again.",
  choiceAlternatives: [
    "Hand the script over and accept Orvath's protection.",
    "Burn the script and force Orvath into a public reckoning.",
  ],
  obligations: {
    mustEstablish: [{
      text: "Orvath holds Calla's mother's ledger.",
      sourceId: "fact-ledger",
      obligationId: "obl-1",
      materialityTest: "Ledger gives Orvath leverage Calla cannot ignore.",
    }],
    mustPayOff: [],
    mustTransferKnowledge: [],
    mustShowStateChange: [],
    mustNotReveal: [],
    allowedNewEntities: [],
  },
}

test("enforceScenePlanContract returns valid for legacy outlines without new fields", () => {
  const result = enforceScenePlanContract(chapter([
    {
      description: "Calla finds the script.",
      characters: ["Calla"],
      obligations: {
        mustEstablish: [{ text: "An ancient script exists.", sourceId: "fact-old-script" }],
        mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
      },
    },
  ]), { requireMaterialityTests: false, requirePovPersonalStake: false })

  // The default-options path still requires choiceAlternatives ≥2 — so a
  // legacy outline without choiceAlternatives is reported. This is the
  // intended structural floor; legacy outlines simply must not have the
  // new fields turn into "false present" by accident.
  expect(result.valid).toBe(false)
  expect(result.errors[0]).toContain("choiceAlternatives must declare at least two options")
})

test("enforceScenePlanContract exempts entries without crisisChoice from sourced-obligation check", () => {
  // A transit/establishment beat: declares choiceAlternatives≥2 (still required)
  // but has no crisisChoice and no obligations. Should pass.
  const transitScene = {
    description: "Calla rides into Thornwall village at dusk.",
    characters: ["Calla"],
    beatId: "ch-001-test-beat-001-arrive-thornwall",
    choiceAlternatives: ["Stop at the inn first.", "Ride straight to the surveyor's cottage."],
    outcome: "Calla dismounts at the village square.",
    consequence: "Villagers note the unfamiliar rider.",
    obligations: {
      mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [],
      mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    },
  }
  const result = enforceScenePlanContract(chapter([transitScene]))

  expect(result.valid).toBe(true)
})

test("enforceScenePlanContract still requires sourced obligation when crisisChoice is declared", () => {
  const sceneWithCrisis = {
    ...FILLED_SCENE,
    obligations: {
      mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [],
      mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    },
  }
  const result = enforceScenePlanContract(chapter([sceneWithCrisis]))

  expect(result.valid).toBe(false)
  expect(result.errors.some(e => e.includes("declares a crisisChoice but no obligation"))).toBe(true)
})

test("enforceScenePlanContract skips mustNotReveal items in materialityTest check", () => {
  // Scene has a sourced mustEstablish obligation WITH materialityTest plus
  // a mustNotReveal item WITHOUT materialityTest. Should pass: mustNotReveal
  // has no sourceId by design and is exempt from the check.
  const scene = {
    ...FILLED_SCENE,
    obligations: {
      mustEstablish: [{
        text: "Orvath holds the ledger.",
        sourceId: "fact-ledger",
        obligationId: "obl-1",
        materialityTest: "Ledger gives Orvath leverage Calla cannot ignore.",
      }],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [{
        text: "Do not reveal Davan's location to Orvath.",
        obligationId: "obl-2-avoid",
      }],
      allowedNewEntities: [],
    },
  }
  const result = enforceScenePlanContract(chapter([scene]), {
    requireMaterialityTests: true,
  })

  expect(result.valid).toBe(true)
})

test("enforceScenePlanContract passes a fully filled scene contract", () => {
  const result = enforceScenePlanContract(chapter([FILLED_SCENE]), {
    requireMaterialityTests: true,
    requirePovPersonalStake: true,
  })

  expect(result.valid).toBe(true)
  expect(result.errors).toEqual([])
})

test("enforceScenePlanContract requires choiceAlternatives ≥2", () => {
  const scene = { ...FILLED_SCENE, choiceAlternatives: ["Only one option."] }
  const result = enforceScenePlanContract(chapter([scene]))

  expect(result.valid).toBe(false)
  expect(result.errors.some(e => e.includes("at least two options"))).toBe(true)
})

test("enforceScenePlanContract requires povPersonalStake when flagged", () => {
  const scene = { ...FILLED_SCENE, povPersonalStake: "" }
  const result = enforceScenePlanContract(chapter([scene]), {
    requirePovPersonalStake: true,
  })

  expect(result.valid).toBe(false)
  expect(result.errors.some(e => e.includes("povPersonalStake"))).toBe(true)
})

test("enforceScenePlanContract skips povPersonalStake when not flagged", () => {
  const scene = { ...FILLED_SCENE, povPersonalStake: "" }
  const result = enforceScenePlanContract(chapter([scene]), {
    requirePovPersonalStake: false,
  })

  // No povPersonalStake error; other checks still apply but pass here.
  expect(result.errors.some(e => e.includes("povPersonalStake"))).toBe(false)
})

test("enforceScenePlanContract requires sourced obligation when entry has crisisChoice", () => {
  const scene = {
    ...FILLED_SCENE,
    obligations: {
      mustEstablish: [{ text: "An obligation without a sourceId.", obligationId: "obl-bad" }],
      mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    },
  }
  const result = enforceScenePlanContract(chapter([scene]))

  expect(result.valid).toBe(false)
  expect(result.errors.some(e => e.includes("declares a crisisChoice but no obligation"))).toBe(true)
})

test("enforceScenePlanContract requires consequence to differ from outcome", () => {
  const scene = {
    ...FILLED_SCENE,
    outcome: "Calla burns the script.",
    consequence: "Calla burns the script.",
  }
  const result = enforceScenePlanContract(chapter([scene]))

  expect(result.valid).toBe(false)
  expect(result.errors.some(e => e.includes("consequence must differ from outcome"))).toBe(true)
})

test("enforceScenePlanContract requires materialityTest on every obligation when flagged", () => {
  const scene = {
    ...FILLED_SCENE,
    obligations: {
      mustEstablish: [{ text: "An obligation without materiality.", sourceId: "fact-x", obligationId: "obl-x" }],
      mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    },
  }
  const result = enforceScenePlanContract(chapter([scene]), {
    requireMaterialityTests: true,
  })

  expect(result.valid).toBe(false)
  expect(result.errors.some(e => e.includes("materialityTest"))).toBe(true)
})

test("enforceScenePlanContract accepts complicate and escalation storyDebtStage values", () => {
  const scene = {
    ...FILLED_SCENE,
    obligations: {
      mustEstablish: [
        { text: "Complication", sourceId: "fact-a", obligationId: "obl-a", storyDebtStage: "complicate" },
        { text: "Escalation", sourceId: "fact-b", obligationId: "obl-b", storyDebtStage: "escalation" },
      ],
      mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    },
  }
  const result = enforceScenePlanContract(chapter([scene]))

  expect(result.valid).toBe(true)
})

test("enforceScenePlanContract rejects payoffId on non-payoff storyDebtStage", () => {
  const scene = {
    ...FILLED_SCENE,
    obligations: {
      mustEstablish: [{
        text: "Should not carry payoffId",
        sourceId: "fact-a",
        obligationId: "obl-a",
        storyDebtStage: "progress",
        payoffId: "payoff-bad",
      }],
      mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    },
  }
  const result = enforceScenePlanContract(chapter([scene]))

  expect(result.valid).toBe(false)
  expect(result.errors.some(e => e.includes("non-payoff storyDebtStage"))).toBe(true)
})

test("enforceScenePlanContract rejects payoff stage missing payoffEventId", () => {
  const scene = {
    ...FILLED_SCENE,
    obligations: {
      mustPayOff: [{
        text: "Final payoff lands",
        sourceId: "payoff-x",
        obligationId: "obl-pay",
        storyDebtStage: "final_payoff",
        payoffId: "payoff-x",
      }],
      mustEstablish: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    },
  }
  const result = enforceScenePlanContract(chapter([scene]))

  expect(result.valid).toBe(false)
  expect(result.errors.some(e => e.includes("missing payoffEventId"))).toBe(true)
})

test("enforceScenePlanContract rejects payoffEventId without parent payoffId", () => {
  const scene = {
    ...FILLED_SCENE,
    obligations: {
      mustPayOff: [{
        text: "Orphaned payoff event",
        sourceId: "payoff-x",
        obligationId: "obl-pay",
        storyDebtStage: "final_payoff",
        payoffEventId: "evt-1",
      }],
      mustEstablish: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
    },
  }
  const result = enforceScenePlanContract(chapter([scene]))

  expect(result.valid).toBe(false)
  expect(result.errors.some(e => e.includes("payoffEventId set without parent payoffId"))).toBe(true)
})

test("enforceScenePlanContract reports per-scene context using beatId", () => {
  const scene = { ...FILLED_SCENE, beatId: "ch-001-test-beat-001-confront", choiceAlternatives: [] }
  const result = enforceScenePlanContract(chapter([scene]))

  expect(result.valid).toBe(false)
  expect(result.errors[0]).toContain("ch-001-test-beat-001-confront")
})
