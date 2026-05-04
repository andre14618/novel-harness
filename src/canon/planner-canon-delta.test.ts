import { describe, expect, test } from "bun:test"
import { runPlannerCanonDeltaAudit } from "./planner-canon-delta"
import type { ChapterOutline } from "../types"

describe("runPlannerCanonDeltaAudit", () => {
  test("reports a coherent live planner ID graph across chapters", () => {
    const report = runPlannerCanonDeltaAudit("test", [chapterOne(), chapterTwo()])

    expect(report.summary.artifactGateClear).toBe(true)
    expect(report.summary.idGraphGateClear).toBe(true)
    expect(report.summary.recommendation).toBe("ready-for-semantic-labeling")
    expect(report.summary.chapterCount).toBe(2)
    expect(report.summary.sourceItemCount).toBe(5)
    expect(report.summary.factCount).toBe(2)
    expect(report.summary.knowledgeCount).toBe(2)
    expect(report.summary.stateCount).toBe(1)
    expect(report.summary.payoffLinkCount).toBe(1)
    expect(report.summary.invalidPayoffLinkCount).toBe(0)
    expect(report.summary.validationErrorCount).toBe(0)
    expect(report.duplicateSourceIds).toEqual([])
    expect(report.cumulativeByChapter).toEqual([
      { chapterN: 1, facts: 1, knowledge: 1, states: 1, totalSourceItems: 3 },
      { chapterN: 2, facts: 2, knowledge: 2, states: 1, totalSourceItems: 5 },
    ])
  })

  test("flags duplicate source IDs across chapters", () => {
    const ch1 = chapterOne()
    const ch2 = chapterTwo()
    ch2.establishedFacts[0].id = ch1.establishedFacts[0].id
    ch2.scenes[0].obligations.mustEstablish[0].sourceId = ch1.establishedFacts[0].id

    const report = runPlannerCanonDeltaAudit("dupe", [ch1, ch2])

    expect(report.summary.artifactGateClear).toBe(true)
    expect(report.summary.idGraphGateClear).toBe(false)
    expect(report.summary.recommendation).toBe("fix-id-graph")
    expect(report.summary.duplicateSourceIdCount).toBe(1)
    expect(report.duplicateSourceIds[0].id).toBe("fact-maret-hidden-strength")
    expect(report.duplicateSourceIds[0].occurrences.map((o) => o.chapterN)).toEqual([1, 2])
  })

  test("flags missing coverage and invalid payoff targets", () => {
    const ch = chapterOne()
    ch.scenes[0].obligations.mustEstablish = []
    ch.scenes[1].obligations.mustPayOff = []
    ch.scenes[0].requiredPayoffs = [{ fact_id: "fact-maret-hidden-strength", payoff_beat: 99 }]

    const report = runPlannerCanonDeltaAudit("broken", [ch])

    expect(report.summary.artifactGateClear).toBe(true)
    expect(report.summary.idGraphGateClear).toBe(false)
    expect(report.summary.recommendation).toBe("fix-id-graph")
    expect(report.summary.invalidPayoffLinkCount).toBe(1)
    expect(report.summary.validationErrorCount).toBeGreaterThan(0)
    expect(report.chapters[0].validation.errors.join("\n")).toContain("established fact")
  })
})

function chapterOne(): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Hidden Strength",
    povCharacter: "Maret",
    setting: "Guild archive",
    purpose: "Reveal the false stat anomaly.",
    targetWords: 1000,
    charactersPresent: ["Maret", "Arbiter Cassel"],
    charactersPresentIds: ["char-maret", "char-arbiter-cassel"],
    establishedFacts: [
      {
        id: "fact-maret-hidden-strength",
        fact: "Maret's displayed Strength stat is far lower than her actual strength.",
        category: "identity",
      },
    ],
    knowledgeChanges: [
      {
        id: "know-cassel-investigates-anomaly",
        characterId: "char-maret",
        characterName: "Maret",
        knowledge: "Cassel has arrived to investigate her anomaly.",
        source: "told",
      },
    ],
    characterStateChanges: [
      {
        id: "state-maret-fearful-in-archive",
        characterId: "char-maret",
        name: "Maret",
        location: "Guild archive",
        emotionalState: "afraid but controlled",
        knows: ["Cassel is investigating"],
        doesNotKnow: [],
      },
    ],
    scenes: [
      {
        beatId: "ch-001-hidden-strength-beat-001-maret-hides-strength",
        description: "Maret hides evidence of her strength as Cassel enters.",
        characters: ["Maret", "Arbiter Cassel"],
        kind: "action",
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
        requiredPayoffs: [{ fact_id: "fact-maret-hidden-strength", payoff_beat: 1 }],
        obligations: {
          mustEstablish: [
            {
              text: "Establish Maret's false Strength stat.",
              sourceId: "fact-maret-hidden-strength",
              sourceKind: "fact",
            },
          ],
          mustPayOff: [],
          mustTransferKnowledge: [],
          mustShowStateChange: [
            {
              text: "Show Maret afraid but controlled in the archive.",
              sourceId: "state-maret-fearful-in-archive",
              sourceKind: "state",
              characterId: "char-maret",
            },
          ],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
      {
        beatId: "ch-001-hidden-strength-beat-002-cassel-names-case",
        description: "Cassel names the investigation and Maret understands the danger.",
        characters: ["Maret", "Arbiter Cassel"],
        kind: "dialogue",
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
        requiredPayoffs: [],
        obligations: {
          mustEstablish: [],
          mustPayOff: [
            {
              text: "Pay off the false Strength setup by making the anomaly visible.",
              sourceId: "fact-maret-hidden-strength",
              sourceKind: "payoff",
            },
          ],
          mustTransferKnowledge: [
            {
              text: "Maret learns Cassel is investigating her anomaly.",
              sourceId: "know-cassel-investigates-anomaly",
              sourceKind: "knowledge",
              characterId: "char-maret",
            },
          ],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
    ],
  }
}

function chapterTwo(): ChapterOutline {
  return {
    chapterNumber: 2,
    title: "Witness Rule",
    povCharacter: "Maret",
    setting: "Assessment hall",
    purpose: "Force the assessment into public view.",
    targetWords: 1000,
    charactersPresent: ["Maret", "Journeyman Theo"],
    charactersPresentIds: ["char-maret", "char-journeyman-theo"],
    establishedFacts: [
      {
        id: "fact-witness-required-for-assessment",
        fact: "A citizen may request a witness for a System assessment.",
        category: "rule",
      },
    ],
    knowledgeChanges: [
      {
        id: "know-theo-learns-maret-afraid",
        characterId: "char-journeyman-theo",
        characterName: "Journeyman Theo",
        knowledge: "Theo learns that Maret is afraid of the assessment.",
        source: "witnessed",
      },
    ],
    characterStateChanges: [],
    scenes: [
      {
        beatId: "ch-002-witness-rule-beat-001-theo-offers-witness",
        description: "Theo offers to witness Maret's assessment.",
        characters: ["Maret", "Journeyman Theo"],
        kind: "dialogue",
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
        requiredPayoffs: [],
        obligations: {
          mustEstablish: [
            {
              text: "Establish that a citizen may request a witness.",
              sourceId: "fact-witness-required-for-assessment",
              sourceKind: "fact",
            },
          ],
          mustPayOff: [],
          mustTransferKnowledge: [
            {
              text: "Theo learns Maret fears the assessment.",
              sourceId: "know-theo-learns-maret-afraid",
              sourceKind: "knowledge",
              characterId: "char-journeyman-theo",
            },
          ],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
    ],
  }
}
