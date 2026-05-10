import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, test } from "bun:test"
import {
  buildProseEvalBatchReport,
  parseArgs,
  renderChapterJudgePrompt,
  renderProseEvalMarkdown,
} from "./prose-eval"

function chapterArtifact(overrides: Record<string, unknown> = {}) {
  return {
    runDir: "run-dir",
    runId: "run-1",
    chapterNumber: 1,
    prose: "Maren chose to close the ledger. Halric recoiled, and the room changed.",
    contracts: {
      title: "The Choice",
      povCharacter: "Maren",
      purpose: "Maren must choose whether to obey Halric.",
      targetWords: 1200,
      proseWordCount: 1400,
      scenes: [
        {
          sceneId: "ch-001-scene-secret-id",
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
          obligations: {
            mustEstablish: [
              {
                obligationId: "obl-secret-id",
                sourceId: "fact-secret-id",
                text: "Halric hid the cost.",
              },
            ],
          },
        },
      ],
      ...overrides,
    },
  }
}

test("parses prose-eval args", () => {
  const args = parseArgs([
    "--run-dir",
    "a",
    "b",
    "--dimension",
    "earnedLength",
    "--dry-run",
    "--concurrency",
    "2",
  ])

  expect(args.runDirs).toEqual(["a", "b"])
  expect(args.dimensions).toEqual(["earnedLength"])
  expect(args.dryRun).toBe(true)
  expect(args.concurrency).toBe(2)
})

test("chapter judge prompt omits raw traceability IDs", () => {
  const prompt = renderChapterJudgePrompt(chapterArtifact() as any, "earnedLength")

  expect(prompt).toContain("Maren confronts Halric")
  expect(prompt).toContain("force a decision")
  expect(prompt).not.toContain("ch-001-scene-secret-id")
  expect(prompt).not.toContain("beat-secret-id")
  expect(prompt).not.toContain("obl-secret-id")
  expect(prompt).not.toContain("fact-secret-id")
})

test("dry-run batch builds per-run semantic summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "scene-first-prose-eval-"))
  try {
    await writeFile(
      join(root, "chapter-1.md"),
      "# Chapter 1: The Choice\n\n*POV: Maren*\n*Setting: Treasury*\n*Word count: 1400 (target 1200)*\n\nMaren chose to close the ledger.",
      "utf8",
    )
    await writeFile(
      join(root, "chapter-1.scene-contracts.json"),
      JSON.stringify(chapterArtifact().contracts),
      "utf8",
    )
    await writeFile(
      join(root, "review-summary.json"),
      JSON.stringify({
        reviewStats: { proseWords: 1400, targetWords: 1200 },
        diagnosticStats: { endpointScores: [3] },
      }),
      "utf8",
    )

    const report = await buildProseEvalBatchReport({
      runDirs: [root],
      dimensions: ["dramatization", "earnedLength"],
      dryRun: true,
      outputDir: null,
      concurrency: 1,
      maxChapters: 10,
    }, "2026-05-10T00:00:00.000Z")

    expect(report.runReports).toHaveLength(1)
    expect(report.runReports[0]!.summaries).toHaveLength(2)
    expect(report.runReports[0]!.recommendation).toContain("Mixed")

    const markdown = renderProseEvalMarkdown(report)
    expect(markdown).toContain("Scene-First Prose Semantic Eval")
    expect(markdown).toContain("earnedLength")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("markdown flags saturated judge dimensions", () => {
  const report = {
    generatedAt: "2026-05-10T00:00:00.000Z",
    evalRunId: "eval-1",
    dryRun: true,
    dimensions: ["earnedLength"],
    runReports: [
      {
        runId: "run-1",
        runDir: "run-dir",
        wordRatio: 1.2,
        words: "4800/3900",
        endpointScores: [3, 3, 3],
        chaptersJudged: 4,
        dimensions: ["earnedLength"],
        summaries: [
          {
            dimension: "earnedLength",
            count: 4,
            meanOrdinal: 2,
            lowCount: 0,
            labelCounts: { "LENGTH-2": 4 },
          },
        ],
        recommendation: "Longer prose is semantically defensible.",
        results: [1, 2, 3, 4].map(chapterNumber => ({
          runId: "run-1",
          chapterNumber,
          chapterTitle: `Chapter ${chapterNumber}`,
          dimension: "earnedLength",
          label: "LENGTH-2",
          ordinal: 2,
          confidence: 0.75,
          evidence: { strength: "", burden: "", cue: "" },
          reasoning: "",
          missingForNextLevel: "",
          targetWords: 1200,
          proseWords: 1400,
          wordRatio: 1.17,
        })),
      },
    ],
  }

  const markdown = renderProseEvalMarkdown(report as any)
  expect(markdown).toContain("## Saturation Notes")
  expect(markdown).toContain("earnedLength saturated at LENGTH-2 across 4 judgments")
})
