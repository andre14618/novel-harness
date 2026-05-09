import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  buildCorpusRecreationProseReviewReport,
  buildProseReviewTasks,
  renderProseReviewReport,
} from "./corpus-recreation-prose-review"

describe("corpus-recreation-prose-review", () => {
  test("builds one narrow prose-review task per scene and dimension", () => {
    const packet = packetFixture()
    const plan = planFixture()
    const chapter = chapterFixture("The bell rang and forced Nara through the gate.")

    const tasks = buildProseReviewTasks({
      pocDir: "output/test",
      packet,
      plan,
      chapter,
      dimensions: ["dramatization", "povVoice"],
    })

    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({
      sceneId: "analog-sc01",
      dimension: "dramatization",
    })
    expect(tasks[0]!.prompt).toContain("Scene contract")
    expect(tasks[0]!.prompt).toContain("The bell rang")
    expect(tasks[1]!.prompt).toContain("Dimension to judge: povVoice")
  })

  test("dry-run report produces advisory summaries and operator queue shape", async () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-prose-review-"))
    try {
      writeFixture(root)
      const report = await buildCorpusRecreationProseReviewReport({
        pocDir: root,
        outputDir: null,
        live: false,
        model: "deepseek-v4-flash",
        thinking: false,
        maxTokens: 1200,
        concurrency: 2,
        dimensions: ["dramatization", "payoffPropulsion"],
      }, "2026-05-09T00:00:00.000Z")

      expect(report.resultCount).toBe(2)
      expect(report.variantLabel).toBe("baseline + thread-context-v1")
      expect(report.summaries).toHaveLength(2)
      expect(report.summaries[0]!.meanOrdinal).toBe(2)
      expect(report.operatorAttention).toEqual([])

      const rendered = renderProseReviewReport(report)
      expect(rendered).toContain("Corpus Recreation Prose Review")
      expect(rendered).toContain("Variant: baseline + thread-context-v1")
      expect(rendered).toContain("dramatization")
      expect(rendered).toContain("DRAMA-2:1")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeFixture(root: string): void {
  writeJson(join(root, "packet.json"), packetFixture())
  writeJson(join(root, "plan.json"), planFixture())
  writeJson(join(root, "chapter.json"), chapterFixture("The bell rang and forced Nara through the gate."))
}

function packetFixture() {
  return {
    sourceReference: { book: "crystal_shard", chapterLabel: "1" },
    diagnosticConfig: { plannerVariant: "baseline", writerContextMode: "thread-context-v1" },
    originalAnalogSeed: {
      genreLane: "commercial fantasy adventure",
      premise: "A courier carries a dangerous key.",
      readerPromise: "Fast action with operational magic.",
      protagonist: {
        name: "Nara",
        want: "restore her oathmark",
        need: "trust witnesses",
        lie: "escape restores honor",
        truth: "public responsibility restores honor",
      },
    },
  }
}

function planFixture() {
  return {
    chapterId: "analog-ch01",
    title: "The Gate",
    chapterFunction: "Expose Nara's broken oath.",
    endpointOrHook: "The city marks her as oath-broken.",
    scenes: [
      {
        sceneId: "analog-sc01",
        referenceSceneOrdinal: 0,
        targetWords: 500,
        structuralRole: "Open the threat.",
        goal: "Enter the city.",
        opposition: "The bell rejects oath-breakers.",
        turningPoint: "The bell rings.",
        crisisChoice: "Enter or retreat.",
        outcome: "Nara enters.",
        consequence: "The city marks her.",
        valueIn: "+",
        valueOut: "-",
        miceThread: "M",
      },
    ],
    obligations: [
      {
        obligationId: "obl-bell",
        sceneId: "analog-sc01",
        sourceId: "world-bell",
        requirementText: "Make the bell change the scene outcome.",
      },
    ],
  }
}

function chapterFixture(prose: string) {
  return {
    chapterTitle: "The Gate",
    scenes: [
      { sceneId: "analog-sc01", prose },
    ],
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
