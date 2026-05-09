/**
 * L095 Slice 0: ID-propagation regression baseline.
 *
 * Verifies that every ID class on `outline.scenes[]` survives parsing through
 * the schema and `enrichOutlineIds()`. This is the substrate test Slice 1
 * must preserve when it wires the `causal-motivation-v3` planner contract:
 * if any ID class is dropped between phases, this test fails before the
 * drafting smoke runs.
 *
 * The eight ID classes covered:
 *   1. beatId (entry identity for `outline.scenes[]`).
 *   2. obligationId (per obligation item).
 *   3. sourceId + sourceKind (per obligation item).
 *   4. threadId, promiseId, payoffId (story-debt graph refs).
 *   5. payoffEventId (sequence-owned payoff child).
 *   6. storyDebtStage (extended to 7 values in Slice 0).
 *   7. characterId (per obligation; per state/knowledge change).
 *   8. sceneTurnId (per obligation, when the planner emits scene turns).
 *
 * Plus the Slice 0 schema additions: `materialityTest` on obligations and
 * the optional scene-contract fields on entries.
 */

import { expect, test } from "bun:test"

import { chapterOutlineSchema } from "../agents/planning-plotter/schema"
import { enrichOutlineIds } from "./ids"

const FIXTURE = {
  chapterId: "ch-001-confront-the-archive",
  chapterNumber: 1,
  title: "Confront the Archive",
  purpose: "Calla forces Orvath into a public reckoning.",
  setting: "Imperial Archive, after closing.",
  povCharacter: "Calla",
  charactersPresent: ["Calla", "Orvath", "Davan"],
  targetWords: 1500,
  emotionalArc: "compliance to rupture",
  establishedFacts: [
    { id: "fact-old-script", fact: "Davan bears the Old Tongue inscription.", category: "knowledge" },
    { id: "fact-ledger", fact: "Orvath holds Calla's mother's ledger.", category: "knowledge" },
  ],
  characterStateChanges: [
    {
      id: "state-calla-resolve",
      characterId: "char-calla",
      name: "Calla",
      location: "Imperial Archive",
      emotionalState: "ruptured",
      knows: [],
      doesNotKnow: [],
    },
  ],
  knowledgeChanges: [
    {
      id: "know-calla-ledger",
      characterId: "char-calla",
      characterName: "Calla",
      knowledge: "Orvath used the ledger as leverage.",
      source: "deduced",
    },
  ],
  scenes: [
    {
      description: "Calla confronts Orvath in the empty archive.",
      characters: ["Calla", "Orvath"],
      kind: "dialogue",
      beatId: "ch-001-confront-the-archive-beat-001-confront-orvath",
      // Slice 0 scene-contract additions.
      goal: "Force Orvath to confess.",
      opposition: "Orvath holds Davan's safety as leverage.",
      turningPoint: "Calla realises she has been the leverage all along.",
      crisisChoice: "Trade the script for Davan, or burn it.",
      choiceAlternatives: [
        "Trade the script for Davan's safety.",
        "Burn the script and force a public reckoning.",
      ],
      outcome: "Calla burns the script.",
      consequence: "Davan is exiled and the empire begins hunting Calla.",
      povPersonalStake: "Calla cannot let Davan be reduced to leverage.",
      targetWords: 720,
      beatHints: [
        { kind: "dialogue", boundarySignal: "interruption", gapSize: "wide", purpose: "Orvath threatens Davan." },
      ],
      obligations: {
        mustEstablish: [
          {
            text: "Orvath holds Calla's mother's ledger.",
            obligationId: "obl-confront-001-fact-ledger",
            sourceId: "fact-ledger",
            sourceKind: "fact",
            characterId: "char-orvath",
            threadId: "thread-leverage",
            promiseId: "debt-leverage",
            sceneTurnId: "turn-ledger-reveal",
            structureSlotId: "slot-confrontation-open",
            worldFactId: "wf-imperial-archive",
            materialityTest: "Ledger gives Orvath leverage Calla cannot ignore.",
            storyDebtStage: "complicate",
          },
        ],
        mustPayOff: [
          {
            text: "The script is destroyed.",
            obligationId: "obl-confront-002-payoff-script",
            sourceId: "payoff-script-burn",
            sourceKind: "payoff",
            payoffId: "payoff-script-burn",
            payoffEventId: "evt-script-burn-final",
            storyDebtStage: "final_payoff",
            materialityTest: "Burning the script destroys Orvath's bargaining chip.",
          },
        ],
        mustTransferKnowledge: [],
        mustShowStateChange: [],
        mustNotReveal: [],
        allowedNewEntities: [],
      },
    },
  ],
}

test("ID-propagation baseline: scene-contract outline parses with every ID class", () => {
  const parsed = chapterOutlineSchema.parse(FIXTURE)
  const scene = parsed.scenes[0]

  expect(scene.beatId).toBe("ch-001-confront-the-archive-beat-001-confront-orvath")

  const fact = scene.obligations.mustEstablish[0] as Record<string, unknown>
  expect(fact.obligationId).toBe("obl-confront-001-fact-ledger")
  expect(fact.sourceId).toBe("fact-ledger")
  expect(fact.sourceKind).toBe("fact")
  expect(fact.characterId).toBe("char-orvath")
  expect(fact.threadId).toBe("thread-leverage")
  expect(fact.promiseId).toBe("debt-leverage")
  expect(fact.sceneTurnId).toBe("turn-ledger-reveal")
  expect(fact.structureSlotId).toBe("slot-confrontation-open")
  expect(fact.worldFactId).toBe("wf-imperial-archive")
  expect(fact.materialityTest).toBe("Ledger gives Orvath leverage Calla cannot ignore.")
  expect(fact.storyDebtStage).toBe("complicate")

  const payoff = scene.obligations.mustPayOff[0] as Record<string, unknown>
  expect(payoff.payoffId).toBe("payoff-script-burn")
  expect(payoff.payoffEventId).toBe("evt-script-burn-final")
  expect(payoff.storyDebtStage).toBe("final_payoff")
})

test("ID-propagation baseline: enrichOutlineIds preserves every well-formed ID", () => {
  const outline = chapterOutlineSchema.parse(FIXTURE)
  const report = enrichOutlineIds(outline)

  // Chapter ID preserved.
  expect(outline.chapterId).toBe("ch-001-confront-the-archive")
  expect(report.chapterId).toBe("ch-001-confront-the-archive")

  // beatId preserved (no remint).
  expect(outline.scenes[0].beatId).toBe(
    "ch-001-confront-the-archive-beat-001-confront-orvath",
  )

  // Obligation IDs preserved.
  const fact = outline.scenes[0].obligations.mustEstablish[0] as Record<string, unknown>
  expect(fact.obligationId).toBe("obl-confront-001-fact-ledger")
  expect(fact.sourceId).toBe("fact-ledger")
  expect(fact.threadId).toBe("thread-leverage")
  expect(fact.promiseId).toBe("debt-leverage")
  expect(fact.sceneTurnId).toBe("turn-ledger-reveal")

  // Materiality + storyDebtStage survive enrichment.
  expect(fact.materialityTest).toBe("Ledger gives Orvath leverage Calla cannot ignore.")
  expect(fact.storyDebtStage).toBe("complicate")

  // Payoff sequence IDs survive.
  const payoff = outline.scenes[0].obligations.mustPayOff[0] as Record<string, unknown>
  expect(payoff.payoffId).toBe("payoff-script-burn")
  expect(payoff.payoffEventId).toBe("evt-script-burn-final")
  expect(payoff.storyDebtStage).toBe("final_payoff")

  // Character/state/knowledge IDs preserved.
  expect(outline.characterStateChanges[0].id).toBe("state-calla-resolve")
  expect(outline.characterStateChanges[0].characterId).toBe("char-calla")
  expect(outline.knowledgeChanges[0].id).toBe("know-calla-ledger")
  expect(outline.knowledgeChanges[0].characterId).toBe("char-calla")

  // No obligation-link failures: every obligation declares an explicit
  // sourceId, so enrichment reports an empty failure list.
  expect(report.obligationLinkFailures).toEqual([])
})
