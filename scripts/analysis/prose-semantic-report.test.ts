import { expect, test } from "bun:test"
import {
  buildProseSemanticReport,
  parseArgs,
  renderChapterJudgePrompt,
  renderProseSemanticReport,
  type ProseSemanticChapterInput,
} from "./prose-semantic-report"

function chapter(overrides: Partial<ProseSemanticChapterInput> = {}): ProseSemanticChapterInput {
  return {
    novelId: "novel-1",
    chapterNumber: 1,
    draftVersion: 2,
    draftStatus: "approved",
    prose: "Maren closed the ledger. Halric stepped back, and the room changed.",
    proseWords: 12,
    outline: {
      title: "The Choice",
      povCharacter: "Maren",
      endpointOrHook: "Maren refuses Halric and changes the room's balance of power.",
      targetWords: 1000,
      scenes: [
        {
          sceneId: "scene-secret-id",
          beatId: "beat-secret-id",
          kind: "dialogue",
          description: "Maren confronts Halric.",
          characters: ["Maren", "Halric"],
          contract: {
            goal: "force a decision",
            opposition: "Halric threatens her post",
            turningPoint: "Maren names the hidden cost",
            crisisChoice: "obey or refuse",
            outcome: "Maren refuses",
            consequence: "Halric loses control of the room",
            valueIn: "obedient",
            valueOut: "defiant",
          },
          obligations: [
            {
              obligationId: "obligation-secret-id",
              sourceId: "source-secret-id",
              requirementText: "Halric hid the cost.",
            },
          ],
        },
      ],
    },
    ...overrides,
  }
}

test("parses prose semantic diagnostic args", () => {
  const args = parseArgs([
    "--novel",
    "novel-1",
    "--dimension",
    "earnedLength",
    "--dry-run",
    "--json",
    "--approved-only",
    "--concurrency",
    "2",
    "--max-chapters",
    "3",
    "--no-trace-summary",
  ])

  expect(args.novelId).toBe("novel-1")
  expect(args.dimensions).toEqual(["earnedLength"])
  expect(args.dryRun).toBe(true)
  expect(args.json).toBe(true)
  expect(args.approvedOnly).toBe(true)
  expect(args.concurrency).toBe(2)
  expect(args.maxChapters).toBe(3)
  expect(args.traceSummary).toBe(false)
})

test("chapter judge prompt omits raw traceability IDs", () => {
  const prompt = renderChapterJudgePrompt(chapter(), "earnedLength")

  expect(prompt).toContain("Maren confronts Halric")
  expect(prompt).toContain("force a decision")
  expect(prompt).not.toContain("scene-secret-id")
  expect(prompt).not.toContain("beat-secret-id")
  expect(prompt).not.toContain("obligation-secret-id")
  expect(prompt).not.toContain("source-secret-id")
})

test("dry-run report builds advisory summaries and saturation notes", async () => {
  const chapters = [1, 2, 3, 4].map(chapterNumber => chapter({ chapterNumber }))
  const report = await buildProseSemanticReport({
    novelId: "novel-1",
    chapters,
    dimensions: ["earnedLength"],
    dryRun: true,
    concurrency: 2,
  }, "2026-05-10T00:00:00.000Z")

  expect(report.chaptersJudged).toBe(4)
  expect(report.resultCount).toBe(4)
  expect(report.summaries[0]!.labelCounts).toEqual({ "LENGTH-2": 4 })
  expect(report.saturationNotes[0]).toContain("earnedLength saturated at LENGTH-2")
  expect(report.telemetry.lowRows).toBe(0)
  expect(report.telemetry.errorRows).toBe(0)
  expect(report.telemetry.saturatedDimensions).toEqual(["earnedLength"])
  expect(report.telemetry.wordShape.meanWordRatio).toBe(0.01)
  expect(report.telemetry.harnessGuidance.lengthSignal).toBe("not_falsified_as_padding")

  const markdown = renderProseSemanticReport(report)
  expect(markdown).toContain("Prose Semantic Diagnostics")
  expect(markdown).toContain("Harness guidance")
  expect(markdown).toContain("Diagnostic only")
})
