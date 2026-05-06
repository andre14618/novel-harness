import { describe, expect, test } from "bun:test"
import {
  computeDraftHash,
  persistContinuityEditorialFlagProposals,
  persistEditorialBeatCoverageProposals,
  persistLintProseEditProposals,
} from "./proposal-persistence"
import type { EditorialFlagEnvelope, ProseEditEnvelope } from "../canon/editorial-proposal"
import { chapterOutlineSchema } from "../agents/planning-plotter/schema"

describe("persistLintProseEditProposals", () => {
  test("persists deterministic lint fixes as prose_edit envelopes", async () => {
    const inserted: ProseEditEnvelope[] = []
    const result = await persistLintProseEditProposals({
      novelId: "novel-1",
      chapter: 1,
      prose: "She paused in order to listen.",
      issues: [
        {
          patternId: 1,
          charOffset: 11,
          category: "FILLER_PHRASE",
          match: "in order to",
          sentence: "She paused in order to listen.",
          fixTemplate: "to",
        },
      ],
      now: new Date("2026-05-04T12:00:00.000Z"),
      insertEnvelope: async (envelope) => {
        inserted.push(envelope)
        return true
      },
    })

    expect(result).toEqual({
      generated: 1,
      inserted: 1,
      skipped: 0,
      errors: [],
    })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      id: "prose-edit:novel-1:0a22987f95d28f75",
      kind: "prose_edit",
      novelId: "novel-1",
      source: { agent: "lint-to-prose-edit" },
      risk: "mechanical",
      payload: {
        target: { kind: "span", chapterRef: "chapter:1", start: 11, end: 22 },
        replacement: "to",
      },
    })
  })

  test("threads durable beat refs onto lint prose_edit span targets when available", async () => {
    const inserted: ProseEditEnvelope[] = []
    const beatProses = [
      "Mira waited by the sealed archive.",
      "She paused in order to listen.",
    ]
    const prose = beatProses.join("\n\n")
    const result = await persistLintProseEditProposals({
      novelId: "novel-1",
      chapter: 1,
      prose,
      beatProses,
      outline: chapterOutlineSchema.parse({
        chapterNumber: 1,
        chapterId: "ch-001-archive",
        title: "Archive",
        povCharacter: "Mira",
        targetWords: 1000,
        charactersPresent: ["Mira"],
        scenes: [
          { beatId: "ch-001-beat-001-waiting", description: "Mira waits", characters: ["Mira"], kind: "description" },
          { beatId: "ch-001-beat-002-listening", description: "Mira listens", characters: ["Mira"], kind: "action" },
        ],
      }),
      issues: [
        {
          patternId: 1,
          charOffset: prose.indexOf("in order to"),
          category: "FILLER_PHRASE",
          match: "in order to",
          sentence: "She paused in order to listen.",
          fixTemplate: "to",
        },
      ],
      now: new Date("2026-05-04T12:00:00.000Z"),
      insertEnvelope: async (envelope) => {
        inserted.push(envelope)
        return true
      },
    })

    expect(result.generated).toBe(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].payload.target).toMatchObject({
      kind: "span",
      chapterRef: "chapter:1",
      beatRef: "ch-001-beat-002-listening",
    })
  })

  test("reports idempotent skips and per-envelope persistence errors", async () => {
    const result = await persistLintProseEditProposals({
      novelId: "novel-1",
      chapter: 1,
      prose: "She paused in order to listen. He nodded in order to agree.",
      issues: [
        {
          patternId: 1,
          charOffset: 11,
          category: "FILLER_PHRASE",
          match: "in order to",
          sentence: "She paused in order to listen.",
          fixTemplate: "to",
        },
        {
          patternId: 1,
          charOffset: 44,
          category: "FILLER_PHRASE",
          match: "in order to",
          sentence: "He nodded in order to agree.",
          fixTemplate: "to",
        },
      ],
      now: new Date("2026-05-04T12:00:00.000Z"),
      insertEnvelope: async (envelope) => {
        if (envelope.payload.target.kind === "span" && envelope.payload.target.start === 11) {
          return false
        }
        throw new Error("db unavailable")
      },
    })

    expect(result).toMatchObject({
      generated: 2,
      inserted: 0,
      skipped: 1,
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe("db unavailable")
  })
})

describe("persistEditorialBeatCoverageProposals", () => {
  test("runs beat-coverage producer and persists uncovered beats as editorial_flag envelopes", async () => {
    const inserted: EditorialFlagEnvelope[] = []
    const result = await persistEditorialBeatCoverageProposals({
      novelId: "novel-1",
      chapter: 2,
      prose: "Mira walked the corridor.",
      outline: chapterOutlineSchema.parse({
        chapterNumber: 2,
        title: "Door",
        povCharacter: "Mira",
        targetWords: 1000,
        charactersPresent: ["Mira"],
        scenes: [
          { description: "Mira walks the corridor", characters: ["Mira"], kind: "action" },
          { description: "Mira opens the locked door", characters: ["Mira"], kind: "action" },
        ],
      }),
      now: new Date("2026-05-04T12:00:00.000Z"),
      callLLM: async () => ({
        beatVerdicts: [
          { beatIndex: 0, covered: true, evidenceQuote: "Mira walked the corridor.", reason: "covered" },
          { beatIndex: 1, covered: false, reason: "no locked-door opening appears" },
        ],
      }),
      insertEnvelope: async (envelope) => {
        inserted.push(envelope)
        return true
      },
    })

    expect(result).toEqual({
      generated: 1,
      inserted: 1,
      skipped: 0,
      errors: [],
      coveredBeats: 1,
      uncoveredBeats: 1,
    })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      kind: "editorial_flag",
      novelId: "novel-1",
      source: { agent: "editorial-beat-coverage" },
      target: {
        kind: "chapter_outline",
        ref: "chapter:2",
        currentVersion: computeDraftHash("Mira walked the corridor."),
      },
      payload: {
        issueType: "missing-beat-coverage",
        beatRef: "b2",
        chapterRef: "chapter:2",
      },
    })
  })

  test("reports idempotent skips and per-envelope persistence errors", async () => {
    const result = await persistEditorialBeatCoverageProposals({
      novelId: "novel-1",
      chapter: 2,
      prose: "No planned beats happen.",
      outline: chapterOutlineSchema.parse({
        chapterNumber: 2,
        title: "Door",
        targetWords: 1000,
        charactersPresent: [],
        scenes: [
          { description: "Mira walks the corridor", characters: ["Mira"], kind: "action" },
          { description: "Mira opens the locked door", characters: ["Mira"], kind: "action" },
        ],
      }),
      callLLM: async () => ({
        beatVerdicts: [
          { beatIndex: 0, covered: false, reason: "missing corridor walk" },
          { beatIndex: 1, covered: false, reason: "missing locked-door opening" },
        ],
      }),
      insertEnvelope: async (envelope) => {
        if (envelope.payload.beatRef === "b1") return false
        throw new Error("db unavailable")
      },
    })

    expect(result).toMatchObject({
      generated: 2,
      inserted: 0,
      skipped: 1,
      coveredBeats: 0,
      uncoveredBeats: 2,
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe("db unavailable")
  })
})

describe("persistContinuityEditorialFlagProposals", () => {
  test("persists fact-scoped continuity blockers as editorial_flag envelopes", async () => {
    const inserted: EditorialFlagEnvelope[] = []
    const result = await persistContinuityEditorialFlagProposals({
      novelId: "novel-1",
      chapter: 2,
      prose: "Cassel verifies stats without a witness.",
      issues: [{
        severity: "blocker",
        description: "Draft says Cassel can verify stats without a witness.",
        conflictsWith: "A witness is required if the citizen requests it.",
        factId: "fact-witness-required",
      }],
      now: new Date("2026-05-06T12:00:00.000Z"),
      insertEnvelope: async envelope => {
        inserted.push(envelope)
        return true
      },
    })

    expect(result).toEqual({
      generated: 1,
      inserted: 1,
      skipped: 0,
      errors: [],
    })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      kind: "editorial_flag",
      novelId: "novel-1",
      source: { agent: "continuity-editorial-flags" },
      target: {
        kind: "chapter_outline",
        ref: "chapter:2",
        currentVersion: computeDraftHash("Cassel verifies stats without a witness."),
      },
      payload: {
        issueType: "off-canon",
        severity: "warning",
        canonRefs: [{ kind: "fact", id: "fact-witness-required" }],
      },
    })
  })

  test("reports idempotent skips and per-envelope persistence errors", async () => {
    const result = await persistContinuityEditorialFlagProposals({
      novelId: "novel-1",
      chapter: 2,
      prose: "Conflicting prose.",
      issues: [
        {
          severity: "blocker",
          description: "first",
          conflictsWith: "fact one",
          factId: "fact-one",
        },
        {
          severity: "blocker",
          description: "second",
          conflictsWith: "fact two",
          factId: "fact-two",
        },
      ],
      insertEnvelope: async envelope => {
        if (envelope.payload.canonRefs[0]?.id === "fact-one") return false
        throw new Error("db unavailable")
      },
    })

    expect(result).toMatchObject({
      generated: 2,
      inserted: 0,
      skipped: 1,
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toBe("db unavailable")
  })
})
