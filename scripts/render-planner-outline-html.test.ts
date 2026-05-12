import { expect, test, describe } from "bun:test"
import { parseArgs, renderPlannerOutlineHtml } from "./render-planner-outline-html"
import type { ChapterOutline } from "../src/types"

describe("render-planner-outline-html parseArgs", () => {
  test("requires --novel", () => {
    expect(() => parseArgs([])).toThrow(/--novel <id> is required/)
  })

  test("parses novel, out path, and open flag", () => {
    const args = parseArgs(["--novel", "novel-1", "--out", "output/plan.html", "--open"])

    expect(args).toEqual({
      novelId: "novel-1",
      outPath: "output/plan.html",
      open: true,
    })
  })

  test("rejects unknown args", () => {
    expect(() => parseArgs(["--novel", "novel-1", "--wat"])).toThrow(/unknown arg/)
  })
})

describe("renderPlannerOutlineHtml", () => {
  test("renders chapter purposes, scene entries, turn fields, and escapes HTML", () => {
    const html = renderPlannerOutlineHtml("novel-<x>", [chapter()])

    expect(html).toContain("Novel ID: novel-&lt;x&gt;")
    expect(html).toContain("Chapter 1: Contract &amp; Salt")
    expect(html).toContain("Purpose:</strong> Kael takes the job")
    expect(html).toContain("1. dialogue")
    expect(html).toContain("Kael reads the contract")
    expect(html).toContain("Goal</dt><dd>Accept a job without losing Mira")
    expect(html).toContain("Opposition</dt><dd>Orin warns him")
    expect(html).toContain("Outcome</dt><dd>Kael signs")
    expect(html).toContain("Consequence</dt><dd>The mine deadline starts")
    expect(html).toContain("ch-001-scene-001")
  })
})

function chapter(): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Contract & Salt",
    povCharacter: "Kael Rusk",
    setting: "Rillgate Contract Hall",
    purpose: "Kael takes the job",
    targetWords: 3100,
    charactersPresent: ["Kael Rusk", "Orin Vale"],
    charactersPresentIds: [],
    scenes: [{
      sceneId: "ch-001-scene-001",
      kind: "dialogue",
      description: "Kael reads the contract.",
      characters: ["Kael Rusk", "Orin Vale"],
      goal: "Accept a job without losing Mira",
      opposition: "Orin warns him",
      outcome: "Kael signs",
      consequence: "The mine deadline starts",
    }],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  }
}
