import { describe, expect, test } from "bun:test"

import {
  buildPlannerQualityReport,
  renderPlannerQualityReport,
  type PlannerQualityOutlineRow,
} from "./planner-quality-report"
import type { ChapterOutline, SceneBeat } from "../../src/types"

describe("planner-quality-report", () => {
  test("flags inactive listed characters and weak endpoint overlap", () => {
    const report = buildPlannerQualityReport([
      row(chapter({
        purpose: "Maret flees after interrogation. The chapter ends with Maret standing over the guard's body, realizing she is now a criminal.",
        charactersPresent: ["Maret", "Journeyman Theo", "Arbiter Cassel"],
        scenes: [
          beat("Maret bolts through the tavern and into the Lower Ward.", ["Maret"]),
          beat("Cassel orders guards to seal the streets while Maret runs.", ["Maret", "Arbiter Cassel"]),
          beat("Maret shoves a guard, who strikes the barrels and falls still.", ["Maret"]),
          beat("Maret flees deeper into the docks as pursuit rises behind her.", ["Maret"]),
        ],
      })),
    ], "novel-test")

    expect(report.totals.inactiveCharacterFindings).toBe(1)
    expect(report.totals.endpointIssues).toBe(1)
    expect(report.chapters[0]!.flags).toContain("character_not_visible_in_beat_text")
    expect(report.chapters[0]!.flags).toContain("endpoint_low_overlap")
    expect(report.chapters[0]!.characters.find(c => c.character === "Journeyman Theo")?.visible).toBe(false)

    const rendered = renderPlannerQualityReport(report)
    expect(rendered).toContain("inactive listed characters=Journeyman Theo")
    expect(rendered).toContain("endpoint overlap=")
  })

  test("accepts visible supporting character and fulfilled endpoint", () => {
    const report = buildPlannerQualityReport([
      row(chapter({
        purpose: "Maret proves the System can lie. The chapter ends with Theo standing beside Maret while Cassel lets them leave.",
        scenes: [
          beat("Maret breaks the vault door while Cassel watches his certainty fracture.", ["Maret", "Arbiter Cassel"]),
          beat("Theo stands beside Maret and offers to help spread the truth.", ["Maret", "Journeyman Theo"]),
          beat("Cassel lets Maret and Theo leave, choosing not to stop them.", ["Maret", "Journeyman Theo", "Arbiter Cassel"]),
        ],
      })),
    ])

    expect(report.totals.inactiveCharacterFindings).toBe(0)
    expect(report.chapters[0]!.endpoint.overlapRatio).toBeGreaterThanOrEqual(0.45)
    expect(report.chapters[0]!.flags).not.toContain("character_not_visible_in_beat_text")
    expect(report.chapters[0]!.flags).not.toContain("endpoint_low_overlap")
  })

  test("surfaces over-planned chapters and obligation coverage errors", () => {
    const outline = chapter({
      targetWords: 1500,
      scenes: Array.from({ length: 8 }, (_, i) =>
        beat(`Maret confronts pressure ${i + 1} and makes a concrete choice.`, ["Maret"])
      ),
      establishedFacts: [{ id: "fact-system-lies", fact: "The System can lie", category: "knowledge" }],
    })

    const report = buildPlannerQualityReport([row(outline)])

    expect(report.totals.overPlannedChapters).toBe(1)
    expect(report.totals.obligationErrorChapters).toBe(1)
    expect(report.chapters[0]!.flags).toContain("over_planned_beats")
    expect(report.chapters[0]!.flags).toContain("obligation_coverage_error")
  })
})

function row(outline: ChapterOutline): PlannerQualityOutlineRow {
  return { chapter_number: outline.chapterNumber, outline_json: outline }
}

function chapter(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "The Test",
    povCharacter: "Maret",
    setting: "The Archive",
    purpose: "Maret faces pressure. The chapter ends with Maret choosing to act.",
    targetWords: 1200,
    charactersPresent: ["Maret", "Journeyman Theo", "Arbiter Cassel"],
    charactersPresentIds: [],
    scenes: [
      beat("Maret chooses to act while Theo watches and Cassel waits.", ["Maret", "Journeyman Theo", "Arbiter Cassel"]),
    ],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  }
}

function beat(description: string, characters: string[] = ["Maret"]): SceneBeat {
  return {
    description,
    characters,
    kind: "action",
    requiredPayoffs: [],
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
  }
}
