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
 *   1. sceneId (entry identity for `outline.scenes[]`; beatId only on beat hints / legacy beat entries).
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
      sceneId: "ch-001-confront-the-archive-scene-001-confront-orvath",
      // Slice 0 scene-contract additions.
      temporalAnchor: "after closing",
      placeAnchor: "empty archive",
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
        {
          beatId: "ch-001-confront-the-archive-beat-001-threaten-davan",
          kind: "dialogue",
          boundarySignal: "interruption",
          gapSize: "wide",
          purpose: "Orvath threatens Davan.",
        },
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

  expect(scene.sceneId).toBe("ch-001-confront-the-archive-scene-001-confront-orvath")
  expect(scene.temporalAnchor).toBe("after closing")
  expect(scene.placeAnchor).toBe("empty archive")
  expect(scene.beatId).toBeUndefined()
  expect(scene.beatHints?.[0]?.beatId).toBe("ch-001-confront-the-archive-beat-001-threaten-davan")

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

test("L096 Slice 1.5: enrichOutlineIds mints payoffEventId for payoff stages with parent payoffId", () => {
  const outline = chapterOutlineSchema.parse({
    chapterId: "ch-001-trial",
    chapterNumber: 1,
    title: "Trial",
    purpose: "Trial purpose.",
    setting: "Trial setting.",
    povCharacter: "Calla",
    charactersPresent: ["Calla"],
    targetWords: 1500,
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    scenes: [
      {
        description: "Calla resolves the script ledger payoff.",
        characters: ["Calla"],
        beatId: "ch-001-trial-beat-001-resolve-script",
        obligations: {
          mustEstablish: [],
          mustPayOff: [
            {
              text: "The script burns publicly.",
              sourceId: "payoff-script-burn",
              sourceKind: "payoff",
              obligationId: "obl-trial-beat-001-payoff-001-script-burn",
              payoffId: "payoff-script-burn",
              storyDebtStage: "final_payoff",
            },
            {
              text: "The empire's leverage chain breaks.",
              sourceId: "payoff-leverage-break",
              sourceKind: "payoff",
              obligationId: "obl-trial-beat-001-payoff-002-leverage-break",
              payoffId: "payoff-leverage-break",
              storyDebtStage: "partial_payoff",
              payoffEventId: "evt-existing-leverage-event",
            },
            {
              text: "Continuing progress on a story debt.",
              sourceId: "payoff-progress",
              sourceKind: "payoff",
              obligationId: "obl-trial-beat-001-payoff-003-progress",
              payoffId: "payoff-progress",
              storyDebtStage: "progress",
            },
          ],
          mustTransferKnowledge: [],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
    ],
  })

  enrichOutlineIds(outline)

  const obligations = outline.scenes[0].obligations.mustPayOff as Array<Record<string, unknown>>

  // Final payoff with parent payoffId but missing event id → minted
  // deterministically as `evt-<obligationId-tail>`.
  expect(obligations[0].payoffEventId).toBe("evt-trial-beat-001-payoff-001-script-burn")

  // Partial payoff with existing payoffEventId → preserved verbatim.
  expect(obligations[1].payoffEventId).toBe("evt-existing-leverage-event")

  // Progress stage (not a payoff stage) → no mint, payoffEventId remains
  // undefined.
  expect(obligations[2].payoffEventId).toBeUndefined()
})

test("L096 Slice 1.5: payoffEventId mint is idempotent across reruns", () => {
  const outline = chapterOutlineSchema.parse({
    chapterId: "ch-002-payoff",
    chapterNumber: 2,
    title: "Payoff",
    purpose: "Payoff.",
    setting: "Setting.",
    povCharacter: "Calla",
    charactersPresent: ["Calla"],
    targetWords: 1500,
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    scenes: [{
      description: "Calla pays the debt.",
      characters: ["Calla"],
      beatId: "ch-002-payoff-beat-001-pay-debt",
      obligations: {
        mustEstablish: [],
        mustPayOff: [{
          text: "The debt is paid.",
          sourceId: "payoff-debt",
          sourceKind: "payoff",
          obligationId: "obl-payoff-beat-001-payoff-001-debt",
          payoffId: "payoff-debt",
          storyDebtStage: "final_payoff",
        }],
        mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
      },
    }],
  })

  enrichOutlineIds(outline)
  const firstId = (outline.scenes[0].obligations.mustPayOff[0] as Record<string, unknown>).payoffEventId
  expect(firstId).toBe("evt-payoff-beat-001-payoff-001-debt")

  enrichOutlineIds(outline)
  const secondId = (outline.scenes[0].obligations.mustPayOff[0] as Record<string, unknown>).payoffEventId
  expect(secondId).toBe(firstId)
})

test("ID-propagation baseline: enrichOutlineIds preserves every well-formed ID", () => {
  const outline = chapterOutlineSchema.parse(FIXTURE)
  const report = enrichOutlineIds(outline)

  // Chapter ID preserved.
  expect(outline.chapterId).toBe("ch-001-confront-the-archive")
  expect(report.chapterId).toBe("ch-001-confront-the-archive")

  // sceneId preserved (no remint); scene-contract entries do not need a
  // generic beatId. Beat-specific IDs live inside beatHints.
  expect(outline.scenes[0].sceneId).toBe(
    "ch-001-confront-the-archive-scene-001-confront-orvath",
  )
  expect(outline.scenes[0].beatId).toBeUndefined()
  expect(outline.scenes[0].beatHints?.[0]?.beatId).toBe("ch-001-confront-the-archive-beat-001-threaten-davan")

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
