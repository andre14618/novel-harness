/**
 * L38-A slot-selector gating test.
 *
 * Pins three behaviors of `selectReaderInfoStateForBeat` (the helper that
 * `buildBeatContextSlots` calls to populate the readerInfoState slot):
 *   1. Chapter 1 → always returns null (no prior chapter).
 *   2. Chapter > 1 with prior facts → returns rendered block surfacing
 *      facts + per-present-character `doesNotKnow`.
 *   3. Chapter > 1 with no signal (empty facts and no doesNotKnow on
 *      present chars) → returns null.
 *
 * Why this imports the selector directly from `enriched-context` rather
 * than going through `buildBeatContext`: the drafting suite installs a
 * process-global `mock.module("../agents/writer/beat-context", …)` that
 * replaces `buildBeatContext` with a stub returning a fixed string, which
 * would mask any real slot behavior. The render placement is covered by
 * `beat-context-render.test.ts`.
 */
import { describe, expect, test } from "bun:test"

import { selectReaderInfoStateForBeat } from "./enriched-context"
import type { ChapterOutline, CharacterProfile, CharacterState, Fact } from "../../types"
import type { SceneBeat } from "../../schemas/shared"

const baseBeat: SceneBeat = {
  description: "Maret enters the High Temple.",
  characters: ["Maret"],
  kind: "action",
  requiredPayoffs: [],
  obligations: {
    mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [],
    mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [],
  },
  lifeValueAxes: [],
  miceActive: [],
  miceOpens: [],
  miceCloses: [],
}

const baseOutline: ChapterOutline = {
  scenes: [baseBeat],
  establishedFacts: [],
  title: "",
  povCharacter: "Maret",
  setting: "High Temple",
  targetWords: 1000,
  characterStateChanges: [],
  knowledgeChanges: [],
} as unknown as ChapterOutline

const maret: CharacterProfile = {
  id: "maret",
  name: "Maret",
  role: "protagonist",
  backstory: "",
  traits: [],
  speechPattern: "",
  goals: "",
  fears: "",
  relationships: [],
  culturalBackground: [],
  systemAwareness: [],
  exampleLines: [],
} as unknown as CharacterProfile

describe("selectReaderInfoStateForBeat — L38-A gating", () => {
  test("chapter 1 returns null even when priorChapterFacts is non-empty", () => {
    const facts: Fact[] = [
      { id: "f1", fact: "Cassel arrived in the village", category: "event", establishedInChapter: 1, role: "operational" },
    ]
    const result = selectReaderInfoStateForBeat(1, facts, baseOutline, baseBeat, [maret], [])
    expect(result).toBeNull()
  })

  test("chapter 2 with prior facts + present-character doesNotKnow surfaces both signals", () => {
    const facts: Fact[] = [
      { id: "f1", fact: "Maret copied the sealed report months ago", category: "event", establishedInChapter: 1, role: "operational" },
      { id: "f2", fact: "Cassel noticed ink smudges on Maret's hands", category: "character", establishedInChapter: 1, role: "operational" },
    ]
    const states: CharacterState[] = [
      {
        characterId: "maret",
        chapterNumber: 2,
        location: "",
        emotionalState: "",
        knows: [],
        doesNotKnow: ["The sealed log records a deliberate stat override eight years ago"],
      },
    ]
    const result = selectReaderInfoStateForBeat(2, facts, baseOutline, baseBeat, [maret], states)
    expect(result).not.toBeNull()
    expect(result!).toContain("READER-INFO STATE:")
    expect(result!).toContain("[ch1] Maret copied the sealed report months ago")
    expect(result!).toContain("Hidden from Maret: The sealed log records a deliberate stat override eight years ago")
  })

  test("chapter 2 with no prior facts and no doesNotKnow returns null (preserves byte parity)", () => {
    const result = selectReaderInfoStateForBeat(2, undefined, baseOutline, baseBeat, [maret], [])
    expect(result).toBeNull()
  })

  test("chapter 2 with empty facts array but absent doesNotKnow signal returns null", () => {
    const result = selectReaderInfoStateForBeat(2, [], baseOutline, baseBeat, [maret], [])
    expect(result).toBeNull()
  })

  test("chapter 2 with only doesNotKnow signal still emits the section", () => {
    const states: CharacterState[] = [
      {
        characterId: "maret",
        chapterNumber: 2,
        location: "",
        emotionalState: "",
        knows: [],
        doesNotKnow: ["Cassel's true mission"],
      },
    ]
    const result = selectReaderInfoStateForBeat(2, [], baseOutline, baseBeat, [maret], states)
    expect(result).not.toBeNull()
    expect(result!).toContain("Hidden from Maret: Cassel's true mission")
    expect(result!).not.toContain("Reader already knows:")
  })
})
