#!/usr/bin/env bun
/**
 * Builds diagnostic-only CFA v1 cohort fixtures from the existing CFA v0
 * frozen concepts. The v1 additions are intentionally authored here so the
 * fixture transformation is repeatable and reviewable.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

interface StrategyPacket {
  strategyPacketId: string
  logline: string
  paragraphSummary: string
  majorReversals: string[]
  endingDirection: string
  readerPromise: string
  protagonistWant: string
  protagonistNeed: string
  protagonistLie: string
  protagonistTruth: string
  antagonistPressure: string
  worldPressureRule: string
}

interface StoryDebt {
  storyDebtId: string
  promiseText: string
  openedBySlotId: string
  expectedProgressSlotIds: string[]
  expectedPayoffSlotId: string
  payoffPolicy: string
}

interface V1Additions {
  strategyPacket: StrategyPacket
  storyDebts: StoryDebt[]
}

const SOURCE_DIR = "docs/fixtures/method-packs/commercial-fantasy-adventure-v0/cohort"
const TARGET_DIR = "docs/fixtures/method-packs/commercial-fantasy-adventure-v1/cohort"

const ADDITIONS: Record<string, V1Additions> = {
  "desert-clockwork-pilgrimage": {
    strategyPacket: {
      strategyPacketId: "strategy-desert-clockwork-pilgrimage-v1",
      logline: "A caravan guide crosses a treaty desert with a water-stealing automaton.",
      paragraphSummary: "Sariq wants a caravan license and water rights for his city. A broken pilgrimage automaton predicts vanishing wells, but each prediction may steal certainty from future travelers. Amina can guide him through taboo routes if he shares the machine's truth. Matriarch Sahel hunts the automaton before it breaks the treaty. Sariq must choose a route that saves the city without hiding whose future water disappears.",
      majorReversals: [
        "The automaton predicts wells by consuming oath memories and future certainty.",
        "The safest route for Sariq's city may doom unseen travelers.",
        "Amina's taboo route works only if Sariq admits the machine's true cost.",
      ],
      endingDirection: "Sariq exposes the automaton's cost and chooses shared rationing over private rescue.",
      readerPromise: "A desert pilgrimage where prophecy, scarcity, and oath-bound water choices decide survival.",
      protagonistWant: "earn a caravan license and bring water rights back to his city",
      protagonistNeed: "admit the human cost of every calculated survival choice",
      protagonistLie: "calculation can keep him morally innocent",
      protagonistTruth: "survival choices require named responsibility",
      antagonistPressure: "Matriarch Sahel can destroy the automaton and strand the caravan under treaty law.",
      worldPressureRule: "Wells vanish when clockwork predictions draw certainty from their future.",
    },
    storyDebts: [
      {
        storyDebtId: "debt-future-water",
        promiseText: "Sariq can save the city only by learning whose future water the automaton consumes.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-06", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off when Sariq names the cost and chooses a public water bargain.",
      },
      {
        storyDebtId: "debt-named-responsibility",
        promiseText: "Sariq must stop hiding ethical choices inside calculations.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off when he accepts responsibility for who receives and loses water.",
      },
    ],
  },
  "ember-library-heist": {
    strategyPacket: {
      strategyPacketId: "strategy-ember-library-heist-v1",
      logline: "A failed archivist wakes forbidden books to clear his condemned sister.",
      paragraphSummary: "Orin wants his apprentice rank restored and his sister Mira saved. An ember index points to banned books only when Orin names someone he will betray. Sable can guide the heist if Orin pays in painful favors. Warden Cass burns memories before witnesses can wake. Orin must wake the right book and accept that saving Mira may expose someone else's innocence to fire.",
      majorReversals: [
        "The index demands a named betrayal before it reveals a witness.",
        "The right book may prove Mira's innocence by endangering another innocent person.",
        "Cass can burn the memory of the crime before testimony becomes usable.",
      ],
      endingDirection: "Orin wakes the witness, exposes the planted book, and chooses public testimony over private theft.",
      readerPromise: "A forbidden-library heist where loyalty, betrayal, and living testimony decide a treason case.",
      protagonistWant: "restore his apprentice rank and save his condemned sister",
      protagonistNeed: "ask for trust instead of hiding behind clever thefts",
      protagonistLie: "the right theft can solve what honest trust cannot",
      protagonistTruth: "truth needs witnesses willing to risk being named",
      antagonistPressure: "Warden Cass can burn memories, rooms, and records before testimony wakes.",
      worldPressureRule: "Ember indexes demand betrayal names and memory fire erases events before paper.",
    },
    storyDebts: [
      {
        storyDebtId: "debt-wake-witness",
        promiseText: "Orin can prove who framed Mira if he wakes the right banned book.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-06", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off through awakened testimony that costs Orin a named betrayal.",
      },
      {
        storyDebtId: "debt-trust-over-theft",
        promiseText: "Orin must learn whether trust can do what theft cannot.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off when Orin asks allies to testify instead of stealing alone.",
      },
    ],
  },
  "ironwood-succession": {
    strategyPacket: {
      strategyPacketId: "strategy-ironwood-succession-v1",
      logline: "A neutral forester must prove a living crown is being poisoned.",
      paragraphSummary: "Rowan wants to serve the Ironwood without entering noble politics. Silver-veined leaves suggest the favored heir is feeding ghostroot to the crown roots. Lena can prove poison, but helping her makes Rowan complicit with a banned rural order. Princess Elayne turns court law against anyone challenging the forest. Rowan must risk his bloodline and reject neutrality to stop a poisoned coronation.",
      majorReversals: [
        "The Ironwood's chosen future may be a ghostroot hallucination.",
        "Court law requires Rowan's bloodline as collateral for challenging the crown.",
        "Neutral silence protects the poisoning more than the forest.",
      ],
      endingDirection: "Rowan offers his bloodline as collateral, exposes ghostroot, and rejects neutrality.",
      readerPromise: "A forest-court adventure where duty, succession, and living roots test whether silence is betrayal.",
      protagonistWant: "serve as crown forester without entering noble politics",
      protagonistNeed: "accept that neutrality becomes complicity when truth is poisoned",
      protagonistLie: "silence can remain honorable in a corrupt succession",
      protagonistTruth: "protecting the forest requires public risk",
      antagonistPressure: "Princess Elayne controls court witnesses and can brand forest dissent as treason.",
      worldPressureRule: "Crown roots reveal lies through shadows, while ghostroot makes them hear false futures.",
    },
    storyDebts: [
      {
        storyDebtId: "debt-true-heir",
        promiseText: "Rowan can stop the wrong heir if he proves the coronation is poisoned.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-06", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off when Rowan proves ghostroot poisoning in public succession law.",
      },
      {
        storyDebtId: "debt-neutrality-betrayal",
        promiseText: "Rowan must decide whether neutrality is honor or betrayal.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off when Rowan risks his own bloodline instead of staying silent.",
      },
    ],
  },
  "mapmaker-erased-province": {
    strategyPacket: {
      strategyPacketId: "strategy-mapmaker-erased-province-v1",
      logline: "A disgraced cartographer maps a hidden road that punishes lies.",
      paragraphSummary: "Mara wants her Crown Survey charter restored after a failed expedition ruined her name. A true-ink omission reveals that an entire province has been erased from official maps. A living road forces Mara to state a truthful destination and trust Sena's illegal routes. Lord Ashren offers to restore Mara if she hides the omission and abandons the villages. Mara must publish the true road with witnesses, sacrificing sanctioned status to make the hidden province legally visible.",
      majorReversals: [
        "The official map is safe only because it is a legal lie.",
        "Ashren can restore Mara's charter if she helps keep the province erased.",
        "The living road will stabilize only when Mara trusts another witness with the truth.",
      ],
      endingDirection: "Mara publishes the true road with witnesses, loses sanctioned status, and makes the hidden province legally visible.",
      readerPromise: "A map-driven fantasy adventure where truth, trust, and living roads decide whether hidden villages survive.",
      protagonistWant: "restore her cartographer charter and prove her last expedition was sabotaged",
      protagonistNeed: "trust people outside sanctioned law enough to make truth public",
      protagonistLie: "measurements are safer than people",
      protagonistTruth: "truthful maps require trusted witnesses",
      antagonistPressure: "Lord Ashren weaponizes charter law to make truthful unauthorized maps criminal.",
      worldPressureRule: "Living roads punish false destinations, and true-ink burns omissions from maps.",
    },
    storyDebts: [
      {
        storyDebtId: "debt-erased-province",
        promiseText: "Mara can reveal whether the erased province still exists and whether the Crown abandoned its people.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-06", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off through a public true map that costs Mara sanctioned status.",
      },
      {
        storyDebtId: "debt-trust-witness",
        promiseText: "Mara must learn whether trusting witnesses is safer than private measurement.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off when Mara chooses public witnesses over isolated expertise.",
      },
    ],
  },
  "saltglass-curse": {
    strategyPacket: {
      strategyPacketId: "strategy-saltglass-curse-v1",
      logline: "A tide-priest breaks a protective curse built from stolen names.",
      paragraphSummary: "Neris wants to become keeper of the harbor ward before the ghost tide returns. Saltglass memories reveal the ward protects citizens by redirecting danger toward stolen-name victims. Lio demands reparations while Vela needs the ward intact for tonight's fleet. Admiral Corven's preserved command can still redirect the tide and protect his crimes. Neris must break the theft-backed bargain without freeing Corven's command.",
      majorReversals: [
        "The protective ward survives by redirecting danger toward unnamed victims.",
        "Neris's family may have benefited from the stolen-name bargain.",
        "Breaking the ward can free Admiral Corven's preserved command.",
      ],
      endingDirection: "Neris names the stolen dead, redirects the ghost tide away from victims, and limits the ward's power.",
      readerPromise: "A sea-haunted adventure where memory, guilt, and reparations decide what protection deserves to survive.",
      protagonistWant: "become the ward's official keeper and protect the harbor fleet",
      protagonistNeed: "make reparations that cost power instead of treating confession as enough",
      protagonistLie: "naming guilt is enough to repair stolen protection",
      protagonistTruth: "protection built on theft must give power back",
      antagonistPressure: "Admiral Corven's preserved command can redirect the ghost tide through saltglass orders.",
      worldPressureRule: "Saltglass stores true names, and the ghost tide follows ships whose dead remain unnamed.",
    },
    storyDebts: [
      {
        storyDebtId: "debt-break-ward",
        promiseText: "Neris can redirect the ghost tide if she uncovers the stolen names.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-06", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off when Neris names victims and changes who the ward protects.",
      },
      {
        storyDebtId: "debt-reparation-cost",
        promiseText: "Neris must learn whether confession without cost is empty.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off when Neris gives up ward power to repair stolen-name harm.",
      },
    ],
  },
  "skybridge-rebellion": {
    strategyPacket: {
      strategyPacketId: "strategy-skybridge-rebellion-v1",
      logline: "A bridge climber turns forbidden repairs into a vertical-city rebellion.",
      paragraphSummary: "Talia wants a master rigger license and her crew safe. Liftstone fatigue marks show the lower bridges are being drained to keep one palace aloft. Bren sees sabotage before Talia accepts that repair is political. Mina can expose ledgers, but her family is held in the upper city. Talia must turn a repair crew into public rebellion before the bridges fall.",
      majorReversals: [
        "The bridge failures are engineered to keep the palace aloft.",
        "Repairing quietly protects Regent Voss's theft.",
        "The crew's tether oaths turn abandonment during collapse into physical pain.",
      ],
      endingDirection: "Talia exposes the stolen liftstone, saves lower bridges, and chooses rebellion over quiet repair.",
      readerPromise: "A vertical-city adventure where repair, sabotage, and loyalty decide who gets to stand above others.",
      protagonistWant: "earn a master rigger license and protect her bridge crew",
      protagonistNeed: "confront the rulers who profit from dangerous systems",
      protagonistLie: "quiet repair can fix an unjust structure",
      protagonistTruth: "some systems must be exposed before they can be repaired",
      antagonistPressure: "Regent Voss controls licenses and can condemn crews as gravity traitors.",
      worldPressureRule: "Liftstone fatigue is hidden by law, and tether oaths make abandonment physically painful.",
    },
    storyDebts: [
      {
        storyDebtId: "debt-bridge-collapse",
        promiseText: "Talia can save the lower bridges if she proves the palace is stealing liftstone.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-06", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off when Talia exposes the liftstone theft and stops quiet collapse.",
      },
      {
        storyDebtId: "debt-repair-to-rebellion",
        promiseText: "Talia must learn whether repair is enough when the structure is corrupt.",
        openedBySlotId: "CFA-01",
        expectedProgressSlotIds: ["CFA-04", "CFA-11", "CFA-17"],
        expectedPayoffSlotId: "CFA-22",
        payoffPolicy: "Pay off when Talia turns repair work into public rebellion.",
      },
    ],
  },
}

function main(): void {
  const sourceDir = resolve(process.cwd(), SOURCE_DIR)
  const targetDir = resolve(process.cwd(), TARGET_DIR)
  mkdirSync(targetDir, { recursive: true })

  const files = readdirSync(sourceDir).filter(file => file.endsWith(".json")).sort()
  for (const file of files) {
    const slug = file.replace(/\.json$/u, "")
    const additions = ADDITIONS[slug]
    if (!additions) throw new Error(`missing CFA v1 additions for ${slug}`)
    const raw = JSON.parse(readFileSync(join(sourceDir, file), "utf-8"))
    const fixture = {
      ...raw,
      diagnosticId: raw.diagnosticId.replace(/^cfa-cohort-/u, "cfa-v1-cohort-"),
      methodPackId: "commercial-fantasy-adventure-v1",
      templateId: "commercial-24-flex-v1",
      concept: {
        ...raw.concept,
        strategyPacket: additions.strategyPacket,
        storyDebts: additions.storyDebts,
        constraints: [
          ...raw.concept.constraints,
          "Preserve the Snowflake-lite strategy packet in chapter and scene contracts.",
          "Route storyDebtId values into obligations and scene requiredSourceIds.",
        ],
      },
    }
    const target = join(targetDir, basename(file))
    writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`)
    console.log(`wrote ${target}`)
  }
}

main()
