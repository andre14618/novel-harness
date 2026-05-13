import { describe, expect, test } from "bun:test"
import {
  buildNovelRunOverlay,
  defaultAtlasOutPath,
  parseArgs,
  renderHarnessWorkflowAtlasHtml,
} from "./render-harness-workflow-atlas"
import type { ChapterOutline, NovelState } from "../src/types"

describe("render-harness-workflow-atlas parseArgs", () => {
  test("defaults to static mode", () => {
    expect(parseArgs([])).toEqual({
      novelId: null,
      outPath: null,
      open: false,
    })
  })

  test("parses novel, output path, and open flag", () => {
    expect(parseArgs(["--novel", "novel-1", "--out", "output/atlas.html", "--open"])).toEqual({
      novelId: "novel-1",
      outPath: "output/atlas.html",
      open: true,
    })
  })

  test("rejects missing values and unknown args", () => {
    expect(() => parseArgs(["--novel"])).toThrow(/--novel requires a value/)
    expect(() => parseArgs(["--out"])).toThrow(/--out requires a value/)
    expect(() => parseArgs(["--wat"])).toThrow(/unknown arg/)
  })

  test("builds stable default output paths", () => {
    expect(defaultAtlasOutPath(null)).toBe("output/workflow-atlas/static/index.html")
    expect(defaultAtlasOutPath("novel:one/two")).toBe("output/workflow-atlas/novel-one-two/index.html")
  })
})

describe("renderHarnessWorkflowAtlasHtml", () => {
  test("renders the static harness map with core sections and components", () => {
    const html = renderHarnessWorkflowAtlasHtml()

    expect(html).toContain("Workflow Atlas")
    expect(html).toContain("Static harness map")
    expect(html).toContain("End-to-End Pipeline")
    expect(html).toContain("Component Inventory")
    expect(html).toContain("Planning Directives")
    expect(html).toContain("Scene Expansion")
    expect(html).toContain("Writer Context Renderer")
    expect(html).toContain("Quality Telemetry Packet")
    expect(html).toContain("Data Flow Contracts")
    expect(html).toContain("production default")
  })

  test("renders run overlay data and escapes novel-visible text", () => {
    const overlay = buildNovelRunOverlay({
      novel: novel(),
      chapters: [chapter()],
      llmRows: [{
        agent: "beat-writer",
        phase: "drafting",
        calls: 2,
        failed: 1,
        prompt_tokens: 100,
        completion_tokens: 50,
        cost_usd: 0.0123,
        first_at: "2026-05-13T01:00:00.000Z",
        last_at: "2026-05-13T01:02:00.000Z",
      }],
      eventRows: [{
        id: 7,
        timestamp: "2026-05-13T01:01:00.000Z",
        event_type: "agent-fail",
        agent: "beat-writer",
        chapter: 1,
        beat_index: 0,
        llm_call_id: 10,
        duration_ms: 500,
      }],
      draftRows: [{
        chapter_number: 1,
        word_count: 1234,
        status: "approved",
      }],
    })

    const html = renderHarnessWorkflowAtlasHtml({ overlay })

    expect(html).toContain("novel-&lt;atlas&gt;")
    expect(html).toContain("Run overlay")
    expect(html).toContain("beat-writer")
    expect(html).toContain("agent-fail")
    expect(html).toContain("planningSceneTurnShapingV1")
    expect(html).toContain("Chapter &amp; Salt")
    expect(html).toContain("1234 draft words")
  })
})

function novel(): NovelState {
  return {
    id: "novel-<atlas>",
    phase: "drafting",
    currentChapter: 1,
    totalChapters: 1,
    seed: {
      genre: "fantasy",
      premise: "Test",
      chapterCount: 1,
      characters: [],
      pipelineOverrides: {
        planningSceneTurnShapingV1: true,
      },
    },
  }
}

function chapter(): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-001",
    title: "Chapter & Salt",
    povCharacter: "Kael",
    setting: "Rillgate",
    purpose: "Test chapter",
    targetWords: 3100,
    charactersPresent: ["Kael"],
    charactersPresentIds: [],
    scenes: [{
      sceneId: "ch-001-scene-001",
      kind: "dialogue",
      description: "Kael signs the contract.",
      characters: ["Kael"],
    }],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  }
}
