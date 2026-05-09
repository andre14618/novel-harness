import { expect, test } from "bun:test"
import { runFunctionalStoryChecks } from "./functional-checks"
import { enrichOutlineIds } from "../harness/ids"
import type { ChapterOutline, SceneBeat } from "../types"

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

test("functional checks pass valid payoff links", () => {
  const outline = baseOutline({
    establishedFacts: [{ id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" }],
    scenes: [
      makeBeat({ description: "Aldric plants a clue.", characters: ["Aldric"], kind: "dialogue", requiredPayoffs: [{ fact_id: "cure", payoff_beat: 1 }] }),
      makeBeat({ description: "Aldric finds the cure.", characters: ["Aldric"], kind: "action" }),
    ],
  })

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(true)
  expect(result.issues).toEqual([])
})

test("functional checks block payoff links with missing fact ids", () => {
  const outline = baseOutline({
    establishedFacts: [{ id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" }],
    scenes: [
      makeBeat({ description: "Aldric plants a clue.", characters: ["Aldric"], kind: "dialogue", requiredPayoffs: [{ fact_id: "missing", payoff_beat: 1 }] }),
      makeBeat({ description: "Aldric finds the cure.", characters: ["Aldric"], kind: "action" }),
    ],
  })

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(false)
  expect(result.issues[0]?.description).toContain("missing")
})

test("functional checks block duplicate established fact ids", () => {
  const outline = baseOutline({
    establishedFacts: [
      { id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" },
      { id: "cure", fact: "The apothecary hides the fever cure", category: "knowledge" },
    ],
  })

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(false)
  expect(result.issues[0]?.description).toContain("duplicated")
})

test("functional checks block payoff links that point backward or to the same beat", () => {
  const outline = baseOutline({
    establishedFacts: [{ id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" }],
    scenes: [
      makeBeat({ description: "Aldric finds the cure.", characters: ["Aldric"], kind: "action" }),
      makeBeat({ description: "Aldric plants a late clue.", characters: ["Aldric"], kind: "dialogue", requiredPayoffs: [{ fact_id: "cure", payoff_beat: 0 }] }),
    ],
  })

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(false)
  expect(result.issues[0]?.description).toContain("later beat")
})

test("payoff-link issues carry durable beatId / factId / payoffBeatId on enriched outlines", () => {
  // Stable-ID hardening (2026-05-04): the deterministic payoff-link checker
  // already had every id it needed in the input outline, but the
  // `FunctionalIssue` shape only exposed `beat_index`. Once the outline is
  // enriched (production read path always enriches), findings carry stable
  // `beatId`, `factId`, and `payoffBeatId` so downstream impact lookups can
  // join to scene-level targets (`scene_plan`, with legacy `beat_plan` for older
  // rows) / `world_fact` without parsing strings.
  const outline = baseOutline({
    establishedFacts: [{ id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" }],
    scenes: [
      makeBeat({
        description: "Aldric finds the cure.",
        characters: ["Aldric"],
        kind: "action",
      }),
      makeBeat({
        description: "Aldric plants a late clue.",
        characters: ["Aldric"],
        kind: "dialogue",
        requiredPayoffs: [{ fact_id: "cure", payoff_beat: 0 }],
      }),
    ],
  })
  enrichOutlineIds(outline)

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(false)
  expect(result.issues).toHaveLength(1)
  const issue = result.issues[0]!
  expect(issue.checker).toBe("payoff-link-integrity")
  expect(issue.beat_index).toBe(1)
  expect(issue.beatId).toBe(outline.scenes[1]!.beatId)
  expect(issue.factId).toBe("cure")
  expect(issue.payoffBeatIndex).toBe(0)
  expect(issue.payoffBeatId).toBe(outline.scenes[0]!.beatId)
  // Legacy human-readable surface is preserved verbatim so existing
  // consumers (checker-blockers / drafting log lines) keep working.
  expect(issue.description).toContain("later beat")
})

test("missing-fact issues carry the unresolved factId", () => {
  const outline = baseOutline({
    establishedFacts: [{ id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" }],
    scenes: [
      makeBeat({
        description: "Aldric plants a clue.",
        characters: ["Aldric"],
        kind: "dialogue",
        requiredPayoffs: [{ fact_id: "missing", payoff_beat: 1 }],
      }),
      makeBeat({ description: "Aldric finds the cure.", characters: ["Aldric"], kind: "action" }),
    ],
  })
  enrichOutlineIds(outline)

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(false)
  expect(result.issues[0]?.factId).toBe("missing")
  expect(result.issues[0]?.beatId).toBe(outline.scenes[0]!.beatId)
})

test("duplicate-fact issues expose factId without beat_index", () => {
  const outline = baseOutline({
    establishedFacts: [
      { id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" },
      { id: "cure", fact: "The apothecary hides the fever cure", category: "knowledge" },
    ],
  })
  enrichOutlineIds(outline)

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(false)
  const issue = result.issues[0]!
  expect(issue.factId).toBe("cure")
  expect(issue.beat_index).toBeNull()
  expect(issue.beatId).toBeUndefined()
})

test("un-enriched outlines keep legacy positional findings (no beatId)", () => {
  // Legacy / synthetic outlines that never went through `enrichOutlineIds`
  // do not carry beatIds. The new optional fields are simply absent so
  // downstream consumers that read only `beat_index` and `description` see
  // byte-identical findings.
  const outline = baseOutline({
    establishedFacts: [{ id: "cure", fact: "The bell tower hides the fever cure", category: "knowledge" }],
    scenes: [
      makeBeat({
        description: "Aldric finds the cure.",
        characters: ["Aldric"],
        kind: "action",
      }),
      makeBeat({
        description: "Aldric plants a late clue.",
        characters: ["Aldric"],
        kind: "dialogue",
        requiredPayoffs: [{ fact_id: "cure", payoff_beat: 0 }],
      }),
    ],
  })

  const result = runFunctionalStoryChecks({ outline })

  expect(result.pass).toBe(false)
  const issue = result.issues[0]!
  expect(issue.beat_index).toBe(1)
  // Outline never enriched — beatId stays undefined.
  expect(issue.beatId).toBeUndefined()
  expect(issue.payoffBeatId).toBeUndefined()
  // factId is still threaded because `establishedFacts[].id` is the
  // planner-emitted seed, not an enrichment-only field.
  expect(issue.factId).toBe("cure")
})

function baseOutline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Test Chapter",
    povCharacter: "Aldric",
    setting: "Istra's apothecary",
    purpose: "Test the checks",
    targetWords: 1000,
    charactersPresent: ["Aldric", "Wren"],
    charactersPresentIds: [],
    scenes: [
      makeBeat({ description: "Aldric speaks with Wren.", characters: ["Aldric", "Wren"], kind: "dialogue" }),
    ],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  } as ChapterOutline
}
