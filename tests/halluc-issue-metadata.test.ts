import { describe, expect, test } from "bun:test"
import {
  buildGroundedSurface,
  buildNerCandidateSummary,
  classifyEntityViaNer,
  enrichIssues,
  isPhraseGrounded,
  readGroundedComponents,
} from "../scripts/hallucination/issue-metadata"
import { extractEntityCandidates } from "../src/lint/entity-candidates"

describe("readGroundedComponents", () => {
  test("pulls grounded sources and beat characters out of the panel row shape", () => {
    const row = {
      task: {
        checker_request_meta: {
          groundedSources: {
            bible: ["Thornwall"],
            from_brief: ["Cassel"],
            derived_outline_fact: ["Master Orin"],
            allowed_new_entities: ["the Vault of Witnesses"],
            character_roster: ["Maret"],
          },
        },
        writer_request_meta: { beatCharacters: ["Maret", "Cassel"] },
      },
    }
    const c = readGroundedComponents(row)
    expect(c.bible).toEqual(["Thornwall"])
    expect(c.fromBrief).toEqual(["Cassel"])
    expect(c.derivedOutlineFact).toEqual(["Master Orin"])
    expect(c.allowedNewEntities).toEqual(["the Vault of Witnesses"])
    expect(c.characterRoster).toEqual(["Maret"])
    expect(c.beatCharacters).toEqual(["Maret", "Cassel"])
  })

  test("returns empty arrays when fields are missing", () => {
    const c = readGroundedComponents({ task: {} })
    expect(c.bible).toEqual([])
    expect(c.beatCharacters).toEqual([])
  })
})

describe("buildGroundedSurface + isPhraseGrounded", () => {
  test("exact lowercase match grounds a multi-word entry", () => {
    const surface = buildGroundedSurface({ bible: ["Silver Coast"] })
    expect(isPhraseGrounded("Silver Coast", surface)).toBe(true)
    expect(isPhraseGrounded("silver coast", surface)).toBe(true)
  })

  test("title-strip tier grounds title+surname when only the surname is in the surface", () => {
    const surface = buildGroundedSurface({ characterRoster: ["Orin"] })
    expect(isPhraseGrounded("Master Orin", surface)).toBe(true)
  })

  test("normalized match grounds plural/possessive variants", () => {
    const surface = buildGroundedSurface({ bible: ["The Scribes' Guildhall"] })
    expect(isPhraseGrounded("Scribe's Guildhall", surface)).toBe(true)
  })

  test("does NOT ground a generic capitalized-multi-word phrase whose tokens are unknown", () => {
    const surface = buildGroundedSurface({ bible: ["Thornwall"] })
    expect(isPhraseGrounded("Aldric Venn", surface)).toBe(false)
  })
})

describe("classifyEntityViaNer", () => {
  test("returns the candidate class when the LLM-flagged phrase matches a NER candidate", () => {
    const prose = "Master Orin entered the Vault of Witnesses."
    const candidates = extractEntityCandidates(prose)
    expect(classifyEntityViaNer("Master Orin", candidates)).toBe("title-pair")
  })

  test("returns null when the LLM phrase is not in any NER class", () => {
    const prose = "She walked through the empty hall."
    const candidates = extractEntityCandidates(prose)
    expect(classifyEntityViaNer("the empty hall", candidates)).toBe(null)
  })
})

describe("enrichIssues", () => {
  test("each issue gets entity, excerpt, candidate_class, ner_grounded, and vote_count", () => {
    const prose = "Master Orin spoke to the Veyr Dominion outside the Silver Coast."
    const surface = buildGroundedSurface({
      bible: ["Silver Coast"],
      characterRoster: ["Orin"],
    })
    const issues = [
      { entity: "Master Orin", excerpt: "Master Orin spoke" },
      { entity: "the Veyr Dominion", excerpt: "the Veyr Dominion outside" },
      { entity: "Silver Coast", excerpt: "outside the Silver Coast" },
    ]
    const enriched = enrichIssues(issues, prose, surface)
    expect(enriched).toHaveLength(3)

    expect(enriched[0]).toMatchObject({
      entity: "Master Orin",
      excerpt: "Master Orin spoke",
      candidate_class: "title-pair",
      ner_grounded: true,  // grounded via title-strip tier (Orin in roster)
      vote_count: 1,
    })

    expect(enriched[1]!.entity).toBe("the Veyr Dominion")
    expect(enriched[1]!.ner_grounded).toBe(false)
    // "Veyr Dominion" matches both capitalized-multi-word and suffix-class.
    // After classOrder-stable sort, capitalized-multi-word comes first; the
    // first-match iteration in classifyEntityViaNer returns that class.
    expect(enriched[1]!.candidate_class).toBe("capitalized-multi-word")

    expect(enriched[2]!.ner_grounded).toBe(true)  // grounded via bible
  })

  test("missing excerpt becomes empty string instead of undefined", () => {
    const prose = "Some prose."
    const surface = buildGroundedSurface({})
    const enriched = enrichIssues([{ entity: "Foo" }], prose, surface)
    expect(enriched[0]!.excerpt).toBe("")
  })

  test("vote_counts map overrides the default", () => {
    const prose = "Master Orin appeared."
    const surface = buildGroundedSurface({})
    const votes = new Map<string, number>([["master orin", 3]])
    const enriched = enrichIssues(
      [{ entity: "Master Orin", excerpt: "Master Orin appeared" }],
      prose,
      surface,
      { nCalls: 5, voteCounts: votes },
    )
    expect(enriched[0]!.vote_count).toBe(3)
  })

  test("no issues produces empty output (does not throw)", () => {
    expect(enrichIssues([], "prose", buildGroundedSurface({}))).toEqual([])
  })
})

describe("buildNerCandidateSummary", () => {
  test("returns every NER candidate with its grounded status", () => {
    const prose = "Master Orin met Captain Vesh at the Silver Coast."
    const surface = buildGroundedSurface({
      bible: ["Silver Coast"],
      characterRoster: ["Orin"],
    })
    const summary = buildNerCandidateSummary(prose, surface)
    const byPhrase = Object.fromEntries(summary.map(s => [s.phrase, s]))
    expect(byPhrase["Master Orin"]).toMatchObject({
      class: "title-pair",
      grounded: true,
    })
    expect(byPhrase["Captain Vesh"]).toMatchObject({
      class: "title-pair",
      grounded: false,
    })
  })

  test("empty prose returns empty list", () => {
    expect(buildNerCandidateSummary("", buildGroundedSurface({}))).toEqual([])
  })
})
