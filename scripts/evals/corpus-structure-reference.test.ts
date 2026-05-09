import { describe, expect, test } from "bun:test"

import {
  buildCorpusStructureReference,
  renderCorpusStructureReference,
} from "./corpus-structure-reference"

describe("corpus-structure-reference", () => {
  test("aggregates corpus scenes into chapter and scene-level structure", () => {
    const reference = buildCorpusStructureReference({
      novel: "test-bundle",
      book: "test_book",
      generatedAt: "2026-05-09T00:00:00.000Z",
      includeSummaries: false,
      scenesPath: "scenes.jsonl",
      beatsPath: "beats.jsonl",
      valueChargePath: "value-charge.jsonl",
      micePath: "mice.jsonl",
      mckeeGapPath: "mckee-gap.jsonl",
      scenes: [
        scene("1", 1, 0, "test_ch1_s0", 500),
        scene("1", 1, 1, "test_ch1_s1", 400),
        scene("2", 2, 0, "test_ch2_s0", 300),
      ],
      beats: [
        beat("1", 1, 0, "test_ch1_s0", 0, "description", "scene_start", 100),
        beat("1", 1, 0, "test_ch1_s0", 1, "action", "stakes_recalibration", 110),
        beat("1", 1, 1, "test_ch1_s1", 0, "dialogue", "scene_start", 90),
        beat("2", 2, 0, "test_ch2_s0", 0, "action", "scene_start", 120),
      ],
      valueTags: [
        value("test_ch1_s0", "+", "-"),
        value("test_ch1_s1", "-", "+"),
      ],
      miceTags: [
        mice("test_ch1_s0", "M"),
        mice("test_ch1_s1", "I"),
      ],
      gapTags: [
        gap("test_ch1_s0", 0, "large"),
        gap("test_ch1_s0", 1, "medium"),
        gap("test_ch2_s0", 0, "none"),
      ],
    })

    expect(reference.aggregate.chapterCount).toBe(2)
    expect(reference.aggregate.sceneCount).toBe(3)
    expect(reference.aggregate.beatCount).toBe(4)
    expect(reference.aggregate.medianScenesPerChapter).toBe(1.5)
    expect(reference.aggregate.medianBeatsPerScene).toBe(1)
    expect(reference.chapters[0]!.scenePolarityCounts).toEqual({ "-": 1, "+": 1 })
    expect(reference.chapters[0]!.micePrimaryCounts).toEqual({ M: 1, I: 1 })
    expect(reference.chapters[0]!.gapSizeCounts).toEqual({ large: 1, medium: 1 })
    expect(renderCorpusStructureReference(reference)).toContain("Corpus Structure Reference")
  })

  test("keeps source-derived summaries out unless explicitly requested", () => {
    const reference = buildCorpusStructureReference({
      novel: "test-bundle",
      book: "test_book",
      generatedAt: "2026-05-09T00:00:00.000Z",
      includeSummaries: true,
      scenesPath: "scenes.jsonl",
      beatsPath: "beats.jsonl",
      valueChargePath: null,
      micePath: null,
      mckeeGapPath: null,
      scenes: [scene("1", 1, 0, "test_ch1_s0", 500)],
      beats: [
        { ...beat("1", 1, 0, "test_ch1_s0", 0, "action", "scene_start", 100), summary: "A meaningful turn." },
      ],
      valueTags: [],
      miceTags: [],
      gapTags: [],
    })

    expect(reference.chapters[0]!.scenes[0]!.plotPointSummary).toBe("A meaningful turn.")
  })
})

function scene(
  chapter: string,
  chapterIndex: number,
  sceneOrdinal: number,
  sceneId: string,
  words: number,
) {
  return {
    chapter,
    scene_id: sceneId,
    words,
    _chapter_canonical_index: chapterIndex,
    _scene_ordinal: sceneOrdinal,
  }
}

function beat(
  chapter: string,
  chapterIndex: number,
  sceneOrdinal: number,
  sceneId: string,
  beatIdx: number,
  kind: string,
  boundarySignal: string,
  words: number,
) {
  return {
    chapter,
    scene_id: sceneId,
    beat_idx: beatIdx,
    words,
    kind,
    boundary_signal: boundarySignal,
    _chapter_canonical_index: chapterIndex,
    _scene_ordinal: sceneOrdinal,
  }
}

function value(sceneId: string, valueIn: string, valueOut: string) {
  return {
    scene_id: sceneId,
    ok: true,
    output: { valueIn, valueOut, polarity: valueOut, lifeValue: "power-weakness" },
  }
}

function mice(sceneId: string, primaryThread: string) {
  return {
    scene_id: sceneId,
    ok: true,
    output: { primary_thread: primaryThread, opens_thread: true, closes_thread: false },
  }
}

function gap(sceneId: string, beatIdx: number, gapSize: string) {
  return {
    scene_id: sceneId,
    beat_idx: beatIdx,
    ok: true,
    output: { gap_size: gapSize, gap_type: "reversal" },
  }
}
