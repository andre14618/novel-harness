/**
 * Tests for entity-candidates.ts — deterministic NER telemetry extractor.
 *
 * These tests cover the three candidate classes (title-pair,
 * capitalized-multi-word, suffix-class) and the four filters (sentence-
 * initial, single-capitalized-word, all-common-words, italics).
 *
 * KNOWN LIMITATIONS documented in entity-candidates.ts (do NOT fix here
 * unless calibration evidence proves the punt costs recall):
 *   - Italics detection is single-line `*...*` only. Multi-line italics,
 *     escaped asterisks, underscore italics, and HTML <em> are not
 *     handled. The asterisk-pair heuristic catches the dominant in-prose-
 *     document case used by the writer.
 *   - The capitalized-multi-word class can OVER-emit on adjacent proper
 *     nouns ("Aldric Venn" when both names are grounded separately). The
 *     downstream calibration step de-duplicates against the grounded
 *     surface; this extractor's job is recall-floor candidates only.
 *   - Title tokens match case-sensitively. "master Orin" (lowercase) is
 *     not detected; that pattern would not look like a title binding in
 *     practice.
 */

import { test, expect, describe } from "bun:test"
import {
  extractEntityCandidates,
  titlePairRegex,
  capitalizedMultiWordRegex,
  suffixClassRegex,
  TITLE_TOKENS,
  SUFFIX_TOKENS,
  type EntityCandidate,
} from "./entity-candidates"

// ── title-pair ───────────────────────────────────────────────────────────────

describe("title-pair", () => {
  test("She bowed to Master Orin.", () => {
    const out = extractEntityCandidates("She bowed to Master Orin.")
    const tp = out.filter(c => c.class === "title-pair")
    expect(tp).toHaveLength(1)
    expect(tp[0].phrase).toBe("Master Orin")
    expect(tp[0].offsetStart).toBe("She bowed to ".length)
    expect(tp[0].offsetEnd).toBe("She bowed to Master Orin".length)
  })

  test("Castellan Vesh fires title-pair", () => {
    const out = extractEntityCandidates("In the courtyard, Castellan Vesh waited.")
    const tp = out.filter(c => c.class === "title-pair")
    expect(tp).toHaveLength(1)
    expect(tp[0].phrase).toBe("Castellan Vesh")
  })

  test("Multiple title-pairs in one passage", () => {
    const out = extractEntityCandidates(
      "Then Lord Halren entered, followed by Captain Brevus and Lady Marwen."
    )
    const tp = out.filter(c => c.class === "title-pair").map(c => c.phrase)
    expect(tp).toContain("Lord Halren")
    expect(tp).toContain("Captain Brevus")
    expect(tp).toContain("Lady Marwen")
  })

  test("title alone (no following capitalized word) does NOT fire", () => {
    const out = extractEntityCandidates("She bowed to the captain.")
    expect(out.filter(c => c.class === "title-pair")).toHaveLength(0)
  })
})

// ── capitalized-multi-word ───────────────────────────────────────────────────

describe("capitalized-multi-word", () => {
  test("He saw the Sundered Crown.", () => {
    const out = extractEntityCandidates("He saw the Sundered Crown.")
    const cm = out.filter(c => c.class === "capitalized-multi-word")
    expect(cm).toHaveLength(1)
    expect(cm[0].phrase).toBe("Sundered Crown")
  })

  test("Veyr Dominion fires capitalized-multi-word", () => {
    const out = extractEntityCandidates("They fled across the Veyr Dominion border.")
    const cm = out.filter(c => c.class === "capitalized-multi-word")
    const found = cm.find(c => c.phrase === "Veyr Dominion")
    expect(found).toBeDefined()
  })

  test("Halrune Vale fires capitalized-multi-word AND suffix-class", () => {
    const out = extractEntityCandidates("She rode toward Halrune Vale at dusk.")
    const cm = out.filter(c => c.class === "capitalized-multi-word")
    const sc = out.filter(c => c.class === "suffix-class")
    expect(cm.find(c => c.phrase === "Halrune Vale")).toBeDefined()
    expect(sc.find(c => c.phrase === "Halrune Vale")).toBeDefined()
  })
})

// ── suffix-class ─────────────────────────────────────────────────────────────

describe("suffix-class", () => {
  test("The Bellward Order met that night.", () => {
    const out = extractEntityCandidates("The Bellward Order met that night.")
    const sc = out.filter(c => c.class === "suffix-class")
    expect(sc).toHaveLength(1)
    expect(sc[0].phrase).toBe("Bellward Order")
  })

  test("Briar Pass mid-sentence", () => {
    const out = extractEntityCandidates("They climbed up to Briar Pass before dawn.")
    const sc = out.filter(c => c.class === "suffix-class")
    expect(sc.find(c => c.phrase === "Briar Pass")).toBeDefined()
  })

  test("Sundered Crown matches suffix-class via Crown suffix", () => {
    const out = extractEntityCandidates("He spoke of the Sundered Crown.")
    const sc = out.filter(c => c.class === "suffix-class")
    expect(sc.find(c => c.phrase === "Sundered Crown")).toBeDefined()
  })

  test("Suffix preceded by non-capitalized word does NOT fire", () => {
    // "the order" — generic role label, no capitalized prefix
    const out = extractEntityCandidates("She joined the order before nightfall.")
    expect(out.filter(c => c.class === "suffix-class")).toHaveLength(0)
  })

  test("Suffix preceded by article 'The' does NOT fire as suffix-class", () => {
    // "The Order" at sentence-initial — the Order is a single capitalized
    // word; the suffix regex requires a CAPITALIZED PREFIX with at least
    // one lowercase letter, so this matches nothing.
    const out = extractEntityCandidates("They knelt. The Order had spoken.")
    expect(out.filter(c => c.class === "suffix-class")).toHaveLength(0)
  })
})

// ── filter: sentence-start ───────────────────────────────────────────────────

describe("filter: sentence-start", () => {
  test("But Orin laughed. → 0 candidates (sentence-start + single capitalized word)", () => {
    const out = extractEntityCandidates("But Orin laughed.")
    expect(out).toHaveLength(0)
  })

  test("Sentence-start capitalized phrase is filtered, mid-sentence one is not", () => {
    const out = extractEntityCandidates("Sundered Crown was the prize. He sought the Sundered Crown.")
    // First "Sundered Crown" is sentence-initial → filtered.
    // Second "Sundered Crown" is mid-sentence → kept (one candidate per
    // matching class).
    const allPhrases = out.map(c => `${c.class}@${c.offsetStart}`)
    // Mid-sentence "Sundered Crown" sits at index of "Sundered" in "He sought the Sundered Crown."
    const expectedStart = "Sundered Crown was the prize. He sought the ".length
    const matches = out.filter(c => c.offsetStart === expectedStart)
    expect(matches.length).toBeGreaterThan(0)
    // No match at offset 0 (the sentence-initial "Sundered Crown")
    expect(out.find(c => c.offsetStart === 0)).toBeUndefined()
    // (silence unused-var lint — useful for debug)
    void allPhrases
  })

  test("Capitalized first word after period is sentence-initial", () => {
    // "Veyr Dominion" at sentence-start gets dropped from BOTH classes
    // (capitalized-multi-word AND suffix-class via Dominion suffix). The
    // mid-sentence occurrence remains in both classes — that's correct
    // multi-class emission, deduped downstream.
    const out = extractEntityCandidates(
      "Veyr Dominion claimed the lands. He fled the Veyr Dominion at last."
    )
    const matches = out.filter(c => c.phrase === "Veyr Dominion")
    // 2 matches expected: same mid-sentence offset, two classes.
    expect(matches.length).toBeGreaterThan(0)
    // No match at offset 0 (the sentence-initial occurrence).
    expect(matches.find(c => c.offsetStart === 0)).toBeUndefined()
    // Every kept match is mid-sentence (after the first period).
    for (const m of matches) {
      expect(m.offsetStart).toBeGreaterThan(20)
    }
    // And both classes participated (since "Dominion" is also a suffix).
    const classes = new Set(matches.map(m => m.class))
    expect(classes.has("capitalized-multi-word")).toBe(true)
    expect(classes.has("suffix-class")).toBe(true)
  })
})

// ── filter: italics ──────────────────────────────────────────────────────────

describe("filter: italics", () => {
  test("She read *the Sundered Crown was lost*. → 0 candidates inside italics", () => {
    const out = extractEntityCandidates("She read *the Sundered Crown was lost*.")
    expect(out).toHaveLength(0)
  })

  test("Italics filter does not affect candidates outside italics", () => {
    const out = extractEntityCandidates(
      "She read *the lost text* and met Master Orin afterward."
    )
    const tp = out.filter(c => c.class === "title-pair")
    expect(tp).toHaveLength(1)
    expect(tp[0].phrase).toBe("Master Orin")
  })

  test("Mixed italics and prose entities", () => {
    const out = extractEntityCandidates(
      "He whispered *Sundered Crown is lost* to Captain Brevus."
    )
    // "Sundered Crown" inside italics → filtered
    expect(out.find(c => c.phrase === "Sundered Crown")).toBeUndefined()
    // "Captain Brevus" outside italics → kept
    expect(out.find(c => c.phrase === "Captain Brevus")).toBeDefined()
  })
})

// ── pass control: lowercase prose ────────────────────────────────────────────

describe("pass control: lowercase prose", () => {
  test("the captain entered → 0 candidates (no capitalization)", () => {
    expect(extractEntityCandidates("the captain entered")).toHaveLength(0)
  })

  test("She bowed to the captain. → 0 candidates", () => {
    expect(extractEntityCandidates("She bowed to the captain.")).toHaveLength(0)
  })

  test("Generic role labels (lowercase) → 0 candidates", () => {
    const out = extractEntityCandidates(
      "the courier ran to the priest at the temple, then to the porter at the gate."
    )
    expect(out).toHaveLength(0)
  })
})

// ── filter: all-common-words ─────────────────────────────────────────────────

describe("filter: all-common-words", () => {
  test('"But And" mid-sentence is filtered as common-word-only', () => {
    // Constructed pathologically — "But And" mid-sentence (e.g. after a
    // colon) should NOT fire as a candidate.
    const out = extractEntityCandidates("She whispered: But And then she left.")
    const cm = out.filter(c => c.class === "capitalized-multi-word")
    expect(cm.find(c => c.phrase === "But And")).toBeUndefined()
  })
})

// ── pass control: empty / short input ────────────────────────────────────────

describe("pass control: empty / short input", () => {
  test("empty string → []", () => {
    expect(extractEntityCandidates("")).toEqual([])
  })

  test("single capitalized word mid-sentence is NOT a candidate", () => {
    // Bare names are handled by the LLM checker, not deterministic NER.
    const out = extractEntityCandidates("She greeted Orin warmly.")
    // No multi-word match, no title-pair match, no suffix match.
    expect(out).toHaveLength(0)
  })
})

// ── output structure invariants ──────────────────────────────────────────────

describe("output structure invariants", () => {
  test("candidates sorted by offsetStart ascending", () => {
    const out = extractEntityCandidates(
      "He saw the Sundered Crown. Then Captain Brevus rode past Briar Pass."
    )
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i].offsetStart).toBeLessThanOrEqual(out[i + 1].offsetStart)
    }
  })

  test("offsets index into the original prose string", () => {
    const prose = "She bowed to Master Orin in the hall."
    const out = extractEntityCandidates(prose)
    for (const c of out) {
      expect(prose.slice(c.offsetStart, c.offsetEnd)).toBe(c.phrase)
    }
  })

  test("class field is one of the three known classes", () => {
    const out = extractEntityCandidates(
      "Master Orin and the Bellward Order watched the Sundered Crown fall."
    )
    expect(out.length).toBeGreaterThan(0)
    for (const c of out) {
      expect(["title-pair", "capitalized-multi-word", "suffix-class"]).toContain(c.class)
    }
  })
})

// ── exported helpers ─────────────────────────────────────────────────────────

describe("exported helpers", () => {
  test("TITLE_TOKENS contains the documented set", () => {
    expect(TITLE_TOKENS).toContain("Master")
    expect(TITLE_TOKENS).toContain("Castellan")
    expect(TITLE_TOKENS).toContain("Arbiter")
    expect(TITLE_TOKENS).toContain("Guildmaster")
  })

  test("SUFFIX_TOKENS contains the documented set", () => {
    expect(SUFFIX_TOKENS).toContain("Order")
    expect(SUFFIX_TOKENS).toContain("Dominion")
    expect(SUFFIX_TOKENS).toContain("Vale")
    expect(SUFFIX_TOKENS).toContain("Crown")
  })

  test("titlePairRegex matches a documented form", () => {
    const re = titlePairRegex()
    const m = re.exec("Master Orin entered.")
    expect(m?.[0]).toBe("Master Orin")
  })

  test("capitalizedMultiWordRegex matches a documented form", () => {
    const re = capitalizedMultiWordRegex()
    const m = re.exec("the Sundered Crown fell.")
    expect(m?.[0]).toBe("Sundered Crown")
  })

  test("suffixClassRegex matches a documented form", () => {
    const re = suffixClassRegex()
    const m = re.exec("the Bellward Order convened.")
    expect(m?.[0]).toBe("Bellward Order")
  })
})

// ── EntityCandidate type usable from import ──────────────────────────────────

test("EntityCandidate type is exported and usable", () => {
  const c: EntityCandidate = {
    phrase: "Master Orin",
    class: "title-pair",
    offsetStart: 0,
    offsetEnd: 11,
  }
  expect(c.phrase).toBe("Master Orin")
})
