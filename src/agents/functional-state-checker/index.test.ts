/**
 * Functional-state-checker — stable-ID coverage tests (2026-05-04, additive).
 *
 * No real LLM calls. The wrapper's ID-resolution helpers (`findingToWarning`,
 * `resolvePlannedItemId`) are pure and exported, so the tests exercise them
 * directly. Pin: `beatId` is added when the outline is enriched and
 * `beat_index` is in range, absent otherwise; `plannedItemId` resolves only
 * on exact safe match (emitted id ∈ planned-state registry, or
 * `planned_item` text matches an established-fact `fact` / knowledge-change
 * `knowledge` string verbatim after `trim()`); existing `description` and
 * `beat_index` stay unchanged.
 */

import { describe, expect, test } from "bun:test"
import { findingToWarning, resolvePlannedItemId } from "./index"
import { buildContext } from "./context"
import { enrichOutlineIds } from "../../harness/ids"
import type { ChapterOutline, SceneBeat } from "../../types"
import type { FunctionalStateCheckerFinding } from "./schema"

const emptyObligations = {
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
}

function makeBeat(overrides: Partial<SceneBeat>): SceneBeat {
  return {
    description: "",
    characters: [],
    kind: "action",
    requiredPayoffs: [],
    obligations: emptyObligations,
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    ...overrides,
  } as SceneBeat
}

function baseOutline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 4,
    title: "The Mended Vow",
    povCharacter: "Mira",
    setting: "Highvane Cathedral",
    purpose: "Test functional-state ID propagation.",
    targetWords: 2000,
    charactersPresent: ["Mira"],
    charactersPresentIds: [],
    scenes: [
      makeBeat({ description: "Mira approaches the altar.", characters: ["Mira"] }),
      makeBeat({ description: "Mira finds the vow stone cracked.", characters: ["Mira"] }),
      makeBeat({ description: "Mira leaves with the broken stone.", characters: ["Mira"] }),
    ],
    establishedFacts: [
      { id: "fact-vow-cracked", fact: "The vow stone shows a fresh crack", category: "physical" },
      { id: "fact-altar-cold", fact: "The altar runs cold to the touch", category: "physical" },
    ],
    characterStateChanges: [
      {
        id: "state-mira-shaken",
        characterId: "char-mira",
        name: "Mira",
        location: "Highvane Cathedral",
        emotionalState: "shaken",
        knows: ["the vow is broken"],
        doesNotKnow: [],
      } as ChapterOutline["characterStateChanges"][number],
    ],
    knowledgeChanges: [
      {
        id: "know-mira-broken",
        characterId: "char-mira",
        characterName: "Mira",
        knowledge: "The vow is broken",
        source: "witnessed",
      },
    ],
    ...overrides,
  } as ChapterOutline
}

function makeFinding(overrides: Partial<FunctionalStateCheckerFinding>): FunctionalStateCheckerFinding {
  return {
    kind: "established_fact_missing",
    planned_item: "",
    beat_index: null,
    evidence_quote: "",
    explanation: "",
    ...overrides,
  } as FunctionalStateCheckerFinding
}

describe("findingToWarning — beatId resolution", () => {
  test("populates beatId from outline.scenes[beat_index].beatId on enriched outlines", () => {
    const outline = baseOutline()
    enrichOutlineIds(outline)
    const expectedBeatId = outline.scenes[1]!.beatId
    expect(typeof expectedBeatId).toBe("string")
    expect((expectedBeatId as string).length).toBeGreaterThan(0)

    const w = findingToWarning(
      makeFinding({
        kind: "established_fact_missing",
        planned_item: "The vow stone shows a fresh crack",
        beat_index: 1,
        explanation: "No mention of the crack in the prose.",
      }),
      "Mira walked the nave and never looked at the stone.",
      outline,
    )

    expect(w.beatId).toBe(expectedBeatId)
    // Existing description + beat_index must be byte-identical to the
    // pre-2026-05-04 wrapper output.
    expect(w.beat_index).toBe(1)
    expect(w.description).toBe(
      "established_fact_missing: The vow stone shows a fresh crack. No mention of the crack in the prose.",
    )
  })

  test("leaves beatId absent for un-enriched outlines (no beatId on the scene)", () => {
    const outline = baseOutline()
    // Outline never enriched — scenes do not carry beatId.
    const w = findingToWarning(
      makeFinding({
        kind: "established_fact_missing",
        planned_item: "The vow stone shows a fresh crack",
        beat_index: 1,
        explanation: "x",
      }),
      "x",
      outline,
    )
    expect(w.beatId).toBeUndefined()
  })

  test("leaves beatId absent when beat_index is null", () => {
    const outline = baseOutline()
    enrichOutlineIds(outline)
    const w = findingToWarning(
      makeFinding({
        kind: "planned_state_contradicted",
        planned_item: "Mira leaves shaken",
        beat_index: null,
        explanation: "x",
      }),
      "x",
      outline,
    )
    expect(w.beatId).toBeUndefined()
    expect(w.beat_index).toBeNull()
  })

  test("leaves beatId absent for out-of-range beat_index", () => {
    const outline = baseOutline()
    enrichOutlineIds(outline)
    const w = findingToWarning(
      makeFinding({
        kind: "established_fact_missing",
        planned_item: "x",
        beat_index: 99,
        explanation: "y",
      }),
      "z",
      outline,
    )
    expect(w.beatId).toBeUndefined()
    // Legacy beat_index is preserved verbatim — out-of-range is the model's
    // problem, not the wrapper's to silently rewrite.
    expect(w.beat_index).toBe(99)
  })

  test("leaves beatId absent when outline arg is omitted (back-compat 2-arg form)", () => {
    const w = findingToWarning(
      makeFinding({
        kind: "established_fact_missing",
        planned_item: "x",
        beat_index: 0,
        explanation: "y",
      }),
      "prose",
    )
    expect(w.beatId).toBeUndefined()
    expect(w.beat_index).toBe(0)
  })
})

describe("resolvePlannedItemId — exact-match contract", () => {
  test("resolves when the model echoes a planned-state id verbatim (fact)", () => {
    const outline = baseOutline()
    expect(
      resolvePlannedItemId(outline, {
        kind: "established_fact_missing",
        planned_item: "anything goes here",
        planned_item_id: "fact-vow-cracked",
      }),
    ).toBe("fact-vow-cracked")
  })

  test("resolves when the model echoes a knowledge id verbatim", () => {
    const outline = baseOutline()
    expect(
      resolvePlannedItemId(outline, {
        kind: "knowledge_change_missing",
        planned_item: "ignored when id matches",
        planned_item_id: "know-mira-broken",
      }),
    ).toBe("know-mira-broken")
  })

  test("resolves when the model echoes a character-state id verbatim", () => {
    const outline = baseOutline()
    expect(
      resolvePlannedItemId(outline, {
        kind: "character_state_missing",
        planned_item: "Mira shaken at cathedral",
        planned_item_id: "state-mira-shaken",
      }),
    ).toBe("state-mira-shaken")
  })

  test("falls back to exact established-fact text match (with trim) when no id was emitted", () => {
    const outline = baseOutline()
    expect(
      resolvePlannedItemId(outline, {
        kind: "established_fact_missing",
        planned_item: "  The vow stone shows a fresh crack  ",
      }),
    ).toBe("fact-vow-cracked")
  })

  test("falls back to exact knowledge text match (with trim)", () => {
    const outline = baseOutline()
    expect(
      resolvePlannedItemId(outline, {
        kind: "knowledge_change_missing",
        planned_item: "The vow is broken",
      }),
    ).toBe("know-mira-broken")
  })

  test("returns undefined for paraphrases", () => {
    const outline = baseOutline()
    expect(
      resolvePlannedItemId(outline, {
        kind: "established_fact_missing",
        planned_item: "the stone has cracked",
      }),
    ).toBeUndefined()
    expect(
      resolvePlannedItemId(outline, {
        kind: "knowledge_change_missing",
        planned_item: "Mira learned the vow has shattered",
      }),
    ).toBeUndefined()
  })

  test("returns undefined for substrings of canonical text", () => {
    const outline = baseOutline()
    expect(
      resolvePlannedItemId(outline, {
        kind: "established_fact_missing",
        planned_item: "vow stone shows a fresh crack",
      }),
    ).toBeUndefined()
    expect(
      resolvePlannedItemId(outline, {
        kind: "knowledge_change_missing",
        planned_item: "vow is broken",
      }),
    ).toBeUndefined()
  })

  test("ignores unverified ids and falls through to the text path", () => {
    const outline = baseOutline()
    // Model emitted a plausible-looking id that is NOT in the planned-state
    // registry. Wrapper must drop it silently and try the text path.
    expect(
      resolvePlannedItemId(outline, {
        kind: "established_fact_missing",
        planned_item: "The vow stone shows a fresh crack",
        planned_item_id: "fact-not-real",
      }),
    ).toBe("fact-vow-cracked")
    // No text match either — undefined.
    expect(
      resolvePlannedItemId(outline, {
        kind: "established_fact_missing",
        planned_item: "totally different text",
        planned_item_id: "fact-not-real",
      }),
    ).toBeUndefined()
  })

  test("returns undefined when the matched fact has no id", () => {
    const outline = baseOutline({
      establishedFacts: [{ id: "", fact: "The vow stone shows a fresh crack", category: "physical" }],
    })
    expect(
      resolvePlannedItemId(outline, {
        kind: "established_fact_missing",
        planned_item: "The vow stone shows a fresh crack",
      }),
    ).toBeUndefined()
  })

  test("returns undefined for character-state findings without an emitted id (no display-name fallback)", () => {
    // The model often invents composite character-state strings like
    // "Mira at Highvane, shaken". The wrapper has no canonical text field
    // to match these against, so it must NOT guess — character-state ids
    // resolve via the id-path only.
    const outline = baseOutline()
    expect(
      resolvePlannedItemId(outline, {
        kind: "character_state_missing",
        planned_item: "Mira at Highvane Cathedral, shaken",
      }),
    ).toBeUndefined()
    expect(
      resolvePlannedItemId(outline, {
        kind: "planned_state_contradicted",
        planned_item: "Mira",
      }),
    ).toBeUndefined()
  })

  test("returns undefined for empty / missing planned_item with no id", () => {
    const outline = baseOutline()
    expect(
      resolvePlannedItemId(outline, {
        kind: "established_fact_missing",
        planned_item: "",
      }),
    ).toBeUndefined()
    expect(
      resolvePlannedItemId(outline, {
        kind: "established_fact_missing",
        planned_item: "   ",
      }),
    ).toBeUndefined()
  })
})

describe("findingToWarning — plannedItemId on warning", () => {
  test("threads the resolved plannedItemId onto the warning", () => {
    const outline = baseOutline()
    enrichOutlineIds(outline)
    const w = findingToWarning(
      makeFinding({
        kind: "established_fact_missing",
        planned_item: "The vow stone shows a fresh crack",
        beat_index: 1,
        explanation: "Crack never appears.",
      }),
      "Mira walked through.",
      outline,
    )
    expect(w.plannedItemId).toBe("fact-vow-cracked")
    // beatId stays in sync — both deterministic refs land together.
    expect(w.beatId).toBe(outline.scenes[1]!.beatId)
  })

  test("leaves plannedItemId absent when no exact match exists", () => {
    const outline = baseOutline()
    enrichOutlineIds(outline)
    const w = findingToWarning(
      makeFinding({
        kind: "established_fact_missing",
        planned_item: "the stone has cracked",
        beat_index: 1,
        explanation: "x",
      }),
      "x",
      outline,
    )
    expect(w.plannedItemId).toBeUndefined()
    expect(w.beatId).toBe(outline.scenes[1]!.beatId)
  })
})

describe("buildContext — beat_id surfacing", () => {
  test("emits beat_id alongside beat_index when the outline is enriched", () => {
    const outline = baseOutline()
    enrichOutlineIds(outline)
    const ctx = buildContext(outline, ["beat 0 prose", "beat 1 prose", "beat 2 prose"])
    expect(ctx).toContain('"beat_index": 0')
    expect(ctx).toContain(`"beat_id": "${outline.scenes[0]!.beatId}"`)
    expect(ctx).toContain(`"beat_id": "${outline.scenes[1]!.beatId}"`)
    expect(ctx).toContain(`"beat_id": "${outline.scenes[2]!.beatId}"`)
  })

  test("omits beat_id for un-enriched outlines (legacy round-trip)", () => {
    const outline = baseOutline()
    const ctx = buildContext(outline, ["a", "b", "c"])
    expect(ctx).toContain('"beat_index": 0')
    expect(ctx).not.toContain("beat_id")
  })

  test("PLANNED_STATE preserves established-fact / knowledge / character-state ids verbatim", () => {
    const outline = baseOutline()
    const ctx = buildContext(outline, ["x"])
    expect(ctx).toContain('"id": "fact-vow-cracked"')
    expect(ctx).toContain('"id": "know-mira-broken"')
    expect(ctx).toContain('"id": "state-mira-shaken"')
  })
})
