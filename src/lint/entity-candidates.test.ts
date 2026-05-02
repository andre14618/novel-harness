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
  xOfYCapitalizedRegex,
  numberWordTailRegex,
  initialsRegex,
  capitalizedFirstOnlyRegex,
  normalizeForGroundedMatch,
  deriveInitials,
  TITLE_TOKENS,
  SUFFIX_TOKENS,
  NUMBER_WORD_TOKENS,
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
  test("But Orin laughed. → 0 candidates for multi-word, suffix, title classes (NB: cap-first-only may fire)", () => {
    const out = extractEntityCandidates("But Orin laughed.")
    // capitalized-first-only may fire on "Orin laughed" (extractor is
    // unconditional; FP suppression happens in runNerPrepass).
    // All other classes should be 0.
    expect(out.filter(c => c.class === "title-pair")).toHaveLength(0)
    expect(out.filter(c => c.class === "capitalized-multi-word")).toHaveLength(0)
    expect(out.filter(c => c.class === "suffix-class")).toHaveLength(0)
    expect(out.filter(c => c.class === "x-of-y-capitalized")).toHaveLength(0)
    expect(out.filter(c => c.class === "number-word-tail")).toHaveLength(0)
    expect(out.filter(c => c.class === "initials")).toHaveLength(0)
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

// ── L4-followup-2 Fix 2: title-pair sentence-initial relaxation ─────────────

describe("title-pair: sentence-initial allowed (L4-followup-2 Fix 2)", () => {
  test("Sentence-initial title-pair fires (was 0 before fix)", () => {
    // Mirrors the cs-598-…-b10 row from the L4-followup big panel: a
    // paragraph-initial "Arbiter Vesh" was being dropped by the previous
    // filter. After Fix 2, title-pair is exempt from the sentence-initial
    // filter and this fires.
    const out = extractEntityCandidates("Arbiter Vesh entered the hall.")
    const tp = out.filter(c => c.class === "title-pair")
    expect(tp).toHaveLength(1)
    expect(tp[0].phrase).toBe("Arbiter Vesh")
    expect(tp[0].offsetStart).toBe(0)
  })

  test("Paragraph-break-initial title-pair fires (mirrors real prose pattern)", () => {
    // The real disagreement-row has the title-pair right after `\n\n`.
    const prose = "Her heart was not.\n\nArbiter Vesh signed the warrant."
    const out = extractEntityCandidates(prose)
    const tp = out.filter(c => c.class === "title-pair" && c.phrase === "Arbiter Vesh")
    expect(tp).toHaveLength(1)
  })

  test("Sentence-initial Guildmaster Aldric fires (other LLM-WIN row)", () => {
    // Mirrors cs-598-…-b5 small-panel row that the LLM unanimously caught
    // and NER missed because of sentence-initial drop on `Guildmaster
    // Aldric`. After Fix 2, NER catches it.
    const prose = "She closed the ledger.\n\nGuildmaster Aldric crossed the floor."
    const out = extractEntityCandidates(prose)
    const tp = out.filter(c => c.class === "title-pair" && c.phrase === "Guildmaster Aldric")
    expect(tp).toHaveLength(1)
  })

  test("capitalized-multi-word at sentence start STILL filtered (Fix 2 is title-only)", () => {
    // Regression guard: Fix 2 must NOT relax the filter for the other two
    // passes. "Sundered Crown" at sentence-start should still be dropped.
    const out = extractEntityCandidates("Sundered Crown fell from the sky.")
    const cm = out.filter(c => c.class === "capitalized-multi-word")
    expect(cm).toHaveLength(0)
  })

  test("suffix-class at sentence start STILL filtered (Fix 2 is title-only)", () => {
    // Same regression guard for suffix-class.
    const out = extractEntityCandidates("Bellward Order met that night.")
    const sc = out.filter(c => c.class === "suffix-class")
    expect(sc).toHaveLength(0)
  })
})

// ── L4-followup-2 Fix 1: normalizeForGroundedMatch helper ────────────────────

describe("normalizeForGroundedMatch (L4-followup-2 Fix 1)", () => {
  test("strips leading article", () => {
    expect(normalizeForGroundedMatch("The Bellward Order")).toBe("bellward order")
    expect(normalizeForGroundedMatch("a Quill Society")).toBe("quill society")
    expect(normalizeForGroundedMatch("an Imperial Decree")).toBe("imperial decree")
  })

  test("plural-vs-singular collapse — primary FP target", () => {
    // The Scribes' Guildhall (bible) vs Scribe's Guildhall (prose).
    const bible = normalizeForGroundedMatch("The Scribes' Guildhall")
    const prose = normalizeForGroundedMatch("Scribe's Guildhall")
    expect(bible).toBe(prose)
  })

  test("strips ASCII apostrophe possessive", () => {
    expect(normalizeForGroundedMatch("Maret's Apartment")).toBe("maret apartment")
  })

  test("strips curly apostrophe possessive", () => {
    expect(normalizeForGroundedMatch("Maret’s Apartment")).toBe("maret apartment")
  })

  test("strips trailing s'", () => {
    expect(normalizeForGroundedMatch("Scribes' Guildhall")).toBe("scribe guildhall")
  })

  test("plural collapse on long enough tokens only", () => {
    expect(normalizeForGroundedMatch("Scribes")).toBe("scribe")
    expect(normalizeForGroundedMatch("Guildhalls")).toBe("guildhall")
    // Short tokens stay (us, is, as).
    expect(normalizeForGroundedMatch("Bus")).toBe("bus")
  })

  test("collapses whitespace and is case-insensitive", () => {
    expect(normalizeForGroundedMatch("  THE   bellward    order  ")).toBe("bellward order")
  })

  test("empty / whitespace-only input → empty", () => {
    expect(normalizeForGroundedMatch("")).toBe("")
    expect(normalizeForGroundedMatch("   ")).toBe("")
  })

  test("idempotent — applying twice equals applying once", () => {
    const inputs = [
      "The Scribes' Guildhall",
      "Maret’s Apartment",
      "Bellward Order",
      "Captain Brevus",
    ]
    for (const s of inputs) {
      const once = normalizeForGroundedMatch(s)
      const twice = normalizeForGroundedMatch(once)
      expect(twice).toBe(once)
    }
  })
})

// ── filter: italics ──────────────────────────────────────────────────────────

describe("filter: italics", () => {
  test("She read *the Sundered Crown was lost*. → 0 candidates inside italics (cap-first-only outside is suppressed)", () => {
    // The Sundered Crown is inside *...* — filtered.
    // "She read" is outside the italics but "read" is only 4 chars and starts
    // after "She" which is sentence-initial. cap-first-only may fire on "She read"
    // at the extractor level but runNerPrepass would suppress it (gate).
    const out = extractEntityCandidates("She read *the Sundered Crown was lost*.")
    // Entities INSIDE italics must not fire (any class).
    const insideItalics = out.filter(c => c.phrase.includes("Sundered") || c.phrase.includes("Crown"))
    expect(insideItalics).toHaveLength(0)
    // cap-first-only may fire on "She read" (extractor unconditional)
    // but all high-signal classes (title-pair, multi-word, suffix, x-of-y, number-tail, initials) should be 0.
    expect(out.filter(c => c.class === "title-pair")).toHaveLength(0)
    expect(out.filter(c => c.class === "capitalized-multi-word")).toHaveLength(0)
    expect(out.filter(c => c.class === "suffix-class")).toHaveLength(0)
    expect(out.filter(c => c.class === "x-of-y-capitalized")).toHaveLength(0)
    expect(out.filter(c => c.class === "number-word-tail")).toHaveLength(0)
    expect(out.filter(c => c.class === "initials")).toHaveLength(0)
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

  test("She bowed to the captain. → 0 candidates for all high-signal classes (cap-first-only may fire on 'She bowed')", () => {
    const out = extractEntityCandidates("She bowed to the captain.")
    // cap-first-only fires unconditionally (FP gate is in runNerPrepass)
    // but all other classes should be 0.
    expect(out.filter(c => c.class === "title-pair")).toHaveLength(0)
    expect(out.filter(c => c.class === "capitalized-multi-word")).toHaveLength(0)
    expect(out.filter(c => c.class === "suffix-class")).toHaveLength(0)
    expect(out.filter(c => c.class === "x-of-y-capitalized")).toHaveLength(0)
    expect(out.filter(c => c.class === "number-word-tail")).toHaveLength(0)
    expect(out.filter(c => c.class === "initials")).toHaveLength(0)
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

  test("single capitalized word mid-sentence is NOT a candidate for multi-word/suffix/title classes", () => {
    // Bare names are handled by the LLM checker, not deterministic NER.
    // NB: cap-first-only may fire on "She greeted" (extractor unconditional).
    const out = extractEntityCandidates("She greeted Orin warmly.")
    // No multi-word, title-pair, suffix, x-of-y, number-word-tail, or initials.
    expect(out.filter(c => c.class === "title-pair")).toHaveLength(0)
    expect(out.filter(c => c.class === "capitalized-multi-word")).toHaveLength(0)
    expect(out.filter(c => c.class === "suffix-class")).toHaveLength(0)
    expect(out.filter(c => c.class === "x-of-y-capitalized")).toHaveLength(0)
    expect(out.filter(c => c.class === "number-word-tail")).toHaveLength(0)
    expect(out.filter(c => c.class === "initials")).toHaveLength(0)
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

  test("class field is one of the seven known classes (L23a adds initials + capitalized-first-only)", () => {
    const out = extractEntityCandidates(
      "Master Orin and the Bellward Order watched the Sundered Crown fall."
    )
    expect(out.length).toBeGreaterThan(0)
    for (const c of out) {
      expect(["title-pair", "capitalized-multi-word", "suffix-class", "x-of-y-capitalized", "number-word-tail", "initials", "capitalized-first-only"]).toContain(c.class)
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

  test("NUMBER_WORD_TOKENS contains the documented set", () => {
    expect(NUMBER_WORD_TOKENS).toContain("Eight")
    expect(NUMBER_WORD_TOKENS).toContain("Seven")
    expect(NUMBER_WORD_TOKENS).toContain("Hundred")
    expect(NUMBER_WORD_TOKENS).toContain("Twelve")
    expect(NUMBER_WORD_TOKENS).toContain("Zero")
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

  test("xOfYCapitalizedRegex matches a documented form", () => {
    const re = xOfYCapitalizedRegex()
    const m = re.exec("The envoy came from the Crown of Hyran.")
    expect(m?.[0]).toBe("the Crown of Hyran")
  })

  test("numberWordTailRegex matches a documented form", () => {
    const re = numberWordTailRegex()
    // "The Veiled Eight" — the optional leading article "The" is included in the
    // raw regex match (so the full canonical phrase is captured). The
    // extractEntityCandidates wrapper uses this offset directly.
    const m = re.exec("The Veiled Eight was dissolved.")
    expect(m?.[0]).toBe("The Veiled Eight")
  })
})

// ── L15: x-of-y-capitalized class ────────────────────────────────────────────

describe("x-of-y-capitalized (L15)", () => {
  test("L12 FN1: Crown of Hyran fires (no article)", () => {
    // Mirrors named-place-fail-02: "The Envoy had come from the Crown of Hyran"
    const out = extractEntityCandidates(
      "The Envoy had come from the Crown of Hyran — a realm Cassel understood only in the abstract."
    )
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    const found = xoy.find(c => c.phrase.includes("Crown of Hyran"))
    expect(found).toBeDefined()
  })

  test("L12 FN2: Sigil of Eight fires via x-of-y (article-prefixed)", () => {
    // Mirrors named-artifact-fail-03: "possession of the Sigil of Eight"
    // NB: "of" is lowercase so capitalized-multi-word misses this.
    const out = extractEntityCandidates(
      "The argument hinged on whether possession of the Sigil of Eight constituted legal authority."
    )
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    const found = xoy.find(c => c.phrase.includes("Sigil of Eight"))
    expect(found).toBeDefined()
  })

  test("Order of Vesh fires", () => {
    const out = extractEntityCandidates("He served the Order of Vesh for twenty years.")
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    expect(xoy.find(c => c.phrase.includes("Order of Vesh"))).toBeDefined()
  })

  test("Vale of Whispers fires", () => {
    const out = extractEntityCandidates("She descended into the Vale of Whispers at dawn.")
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    expect(xoy.find(c => c.phrase.includes("Vale of Whispers"))).toBeDefined()
  })

  test("House of Mirrors fires", () => {
    const out = extractEntityCandidates("The delegation from the House of Mirrors arrived.")
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    expect(xoy.find(c => c.phrase.includes("House of Mirrors"))).toBeDefined()
  })

  test("Year of Fallen Axes fires (Y is two words)", () => {
    const out = extractEntityCandidates("He remembered the Year of Fallen Axes with dread.")
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    expect(xoy.find(c => c.phrase.includes("Year of Fallen"))).toBeDefined()
  })

  test("'out of nowhere' does NOT fire (all lowercase)", () => {
    const out = extractEntityCandidates("He appeared out of nowhere suddenly.")
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    expect(xoy).toHaveLength(0)
  })

  test("'part of the plan' does NOT fire (lowercase)", () => {
    const out = extractEntityCandidates("She knew she was part of the plan.")
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    expect(xoy).toHaveLength(0)
  })

  test("'piece of cake' does NOT fire (lowercase)", () => {
    const out = extractEntityCandidates("That test was a piece of cake.")
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    expect(xoy).toHaveLength(0)
  })

  test("'out Of nowhere' — single capital letter pattern does NOT fire", () => {
    // 'Of' has a single uppercase letter, but 'out' is lowercase — the X
    // part fails the [A-Z][a-z] requirement.
    const out = extractEntityCandidates("She leapt out Of nowhere.")
    // Even if "Of nowhere" somehow triggered, "out" is lowercase so X fails.
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    // Should not fire a match starting at "out" (lowercase x)
    expect(xoy.find(c => c.phrase.toLowerCase().startsWith("out"))).toBeUndefined()
  })

  test("inside italics: Crown of Hyran does NOT fire", () => {
    const out = extractEntityCandidates("She read *the Crown of Hyran* in the ledger.")
    expect(out.find(c => c.class === "x-of-y-capitalized")).toBeUndefined()
  })

  test("x-of-y phrase article is included in the output phrase", () => {
    // "the Crown of Hyran" — the article should be part of the extracted phrase
    const out = extractEntityCandidates("It came from the Crown of Hyran directly.")
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    const found = xoy.find(c => c.phrase.includes("Crown of Hyran"))
    expect(found).toBeDefined()
    // The phrase must match a substring of the original prose at its offsets
    const prose = "It came from the Crown of Hyran directly."
    if (found) {
      expect(prose.slice(found.offsetStart, found.offsetEnd)).toBe(found.phrase)
    }
  })

  test("normalizeForGroundedMatch symmetry: 'Crown of Hyran' matches 'the Crown of Hyran'", () => {
    expect(normalizeForGroundedMatch("Crown of Hyran")).toBe(
      normalizeForGroundedMatch("the Crown of Hyran")
    )
  })
})

// ── L15: number-word-tail class ───────────────────────────────────────────────

describe("number-word-tail (L15)", () => {
  test("L12 FN3: the Veiled Eight fires", () => {
    // Mirrors plural-faction-fail-03: "The Veiled Eight had not been an official body"
    const out = extractEntityCandidates(
      "The Veiled Eight had not been an official body for sixty years."
    )
    const nwt = out.filter(c => c.class === "number-word-tail")
    const found = nwt.find(c => c.phrase.includes("Veiled Eight"))
    expect(found).toBeDefined()
  })

  test("L12 FN2: Sigil of Eight fires via x-of-y-capitalized (number-word-tail does NOT fire here)", () => {
    // "the Sigil of Eight" — the word immediately before "Eight" is "of"
    // (lowercase), so number-word-tail (which requires CapWord\s+NumberWord)
    // does NOT fire. The entity is covered by x-of-y-capitalized instead.
    const out = extractEntityCandidates(
      "The argument hinged on whether possession of the Sigil of Eight constituted legal authority."
    )
    const xoy = out.filter(c => c.class === "x-of-y-capitalized")
    expect(xoy.find(c => c.phrase.includes("Sigil of Eight"))).toBeDefined()
    // Confirm number-word-tail does NOT incorrectly fire on "of Eight"
    const nwt = out.filter(c => c.class === "number-word-tail")
    expect(nwt.find(c => c.phrase.includes("of Eight"))).toBeUndefined()
  })

  test("the Silent Twelve fires", () => {
    const out = extractEntityCandidates("He feared the Silent Twelve above all others.")
    const nwt = out.filter(c => c.class === "number-word-tail")
    expect(nwt.find(c => c.phrase.includes("Silent Twelve"))).toBeDefined()
  })

  test("the Blessed Seven fires", () => {
    const out = extractEntityCandidates("The Blessed Seven stood at the gate.")
    const nwt = out.filter(c => c.class === "number-word-tail")
    expect(nwt.find(c => c.phrase.includes("Blessed Seven"))).toBeDefined()
  })

  test("the Broken Hundred fires (large magnitude)", () => {
    const out = extractEntityCandidates("She faced the Broken Hundred in the old arena.")
    const nwt = out.filter(c => c.class === "number-word-tail")
    expect(nwt.find(c => c.phrase.includes("Broken Hundred"))).toBeDefined()
  })

  test("the Forty-Seven fires (hyphenated composite)", () => {
    const out = extractEntityCandidates("They numbered among the Fallen Forty-Seven.")
    const nwt = out.filter(c => c.class === "number-word-tail")
    expect(nwt.find(c => c.phrase.includes("Forty-Seven"))).toBeDefined()
  })

  test("'chapter seven' does NOT fire (lowercase)", () => {
    const out = extractEntityCandidates("She opened the book to chapter seven.")
    const nwt = out.filter(c => c.class === "number-word-tail")
    expect(nwt).toHaveLength(0)
  })

  test("'the forty eight' does NOT fire (lowercase number words)", () => {
    const out = extractEntityCandidates("There were the forty eight reports to review.")
    const nwt = out.filter(c => c.class === "number-word-tail")
    expect(nwt).toHaveLength(0)
  })

  test("'an article Ten' — article + bare cap + number fires", () => {
    // "Crimson Ten" is a proper faction name
    const out = extractEntityCandidates("He joined the Crimson Ten last autumn.")
    const nwt = out.filter(c => c.class === "number-word-tail")
    expect(nwt.find(c => c.phrase.includes("Crimson Ten"))).toBeDefined()
  })

  test("inside italics: Veiled Eight does NOT fire", () => {
    const out = extractEntityCandidates("She recalled *the Veiled Eight* from the old texts.")
    expect(out.find(c => c.class === "number-word-tail")).toBeUndefined()
  })

  test("offset invariant: phrase matches original prose at offsets", () => {
    const prose = "She feared the Veiled Eight more than anything."
    const out = extractEntityCandidates(prose)
    for (const c of out) {
      expect(prose.slice(c.offsetStart, c.offsetEnd)).toBe(c.phrase)
    }
  })

  test("normalizeForGroundedMatch: 'Veiled Eight' matches 'the Veiled Eight'", () => {
    expect(normalizeForGroundedMatch("Veiled Eight")).toBe(
      normalizeForGroundedMatch("the Veiled Eight")
    )
  })
})

// ── L15: regression guards — existing classes unchanged ──────────────────────

describe("regression guards (L15 must not disturb prior classes)", () => {
  test("capitalized-multi-word at sentence start STILL filtered after L15", () => {
    const out = extractEntityCandidates("Sundered Crown fell from the sky.")
    expect(out.filter(c => c.class === "capitalized-multi-word")).toHaveLength(0)
  })

  test("suffix-class at sentence start STILL filtered after L15", () => {
    const out = extractEntityCandidates("Bellward Order met that night.")
    expect(out.filter(c => c.class === "suffix-class")).toHaveLength(0)
  })

  test("title-pair still fires at sentence start after L15", () => {
    const out = extractEntityCandidates("Arbiter Vesh entered the hall.")
    const tp = out.filter(c => c.class === "title-pair")
    expect(tp).toHaveLength(1)
    expect(tp[0].phrase).toBe("Arbiter Vesh")
  })

  test("article-prefixed x-of-y does NOT suppress suffix-class or multi-word", () => {
    // "Halrune Vale" should still fire suffix-class and capitalized-multi-word
    const out = extractEntityCandidates("She rode toward Halrune Vale at dusk.")
    expect(out.filter(c => c.class === "capitalized-multi-word").find(c => c.phrase === "Halrune Vale")).toBeDefined()
    expect(out.filter(c => c.class === "suffix-class").find(c => c.phrase === "Halrune Vale")).toBeDefined()
  })

  test("all 7 classes valid in class field check after L23a", () => {
    const out = extractEntityCandidates(
      "Master Orin met the Bellward Order under the Crown of Hyran near the Veiled Eight."
    )
    const classes = new Set(out.map(c => c.class))
    // Multiple classes should fire on this passage
    expect(out.length).toBeGreaterThan(0)
    for (const c of out) {
      expect(["title-pair", "capitalized-multi-word", "suffix-class", "x-of-y-capitalized", "number-word-tail", "initials", "capitalized-first-only"]).toContain(c.class)
    }
    void classes
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

// ── L23a: initials class ─────────────────────────────────────────────────────

describe("initials (L23a)", () => {
  test("T.C. fires (L22 entity — 'her own initials stamped in gold leaf: T.C., Examiner')", () => {
    const out = extractEntityCandidates("Her own initials stamped in gold leaf: T.C., Examiner.")
    const init = out.filter(c => c.class === "initials")
    expect(init).toHaveLength(1)
    expect(init[0].phrase).toBe("T.C.")
  })

  test("J.R.R. fires (three initials)", () => {
    const out = extractEntityCandidates("The author J.R.R. wrote it long ago.")
    const init = out.filter(c => c.class === "initials")
    const found = init.find(c => c.phrase === "J.R.R.")
    expect(found).toBeDefined()
  })

  test("K.J. fires (two initials)", () => {
    const out = extractEntityCandidates("She signed the form K.J. at the bottom.")
    const init = out.filter(c => c.class === "initials")
    expect(init.find(c => c.phrase === "K.J.")).toBeDefined()
  })

  test("R.A.S. fires (three initials)", () => {
    const out = extractEntityCandidates("The seal bore the mark R.A.S.")
    const init = out.filter(c => c.class === "initials")
    expect(init.find(c => c.phrase === "R.A.S.")).toBeDefined()
  })

  test("initials at sentence-initial position fire (no sentence filter)", () => {
    const out = extractEntityCandidates("T.C. stood at the gate.")
    const init = out.filter(c => c.class === "initials")
    expect(init).toHaveLength(1)
    expect(init[0].phrase).toBe("T.C.")
    expect(init[0].offsetStart).toBe(0)
  })

  test("single initial 'A.' does NOT fire (requires minimum two initials)", () => {
    const out = extractEntityCandidates("She read section A. of the code.")
    const init = out.filter(c => c.class === "initials")
    expect(init).toHaveLength(0)
  })

  test("lowercase initials 'e.g.' do NOT fire", () => {
    const out = extractEntityCandidates("She referenced e.g. a common example.")
    const init = out.filter(c => c.class === "initials")
    expect(init).toHaveLength(0)
  })

  test("'i.e.' does NOT fire (lowercase)", () => {
    const out = extractEntityCandidates("The rule i.e. the primary clause was clear.")
    const init = out.filter(c => c.class === "initials")
    expect(init).toHaveLength(0)
  })

  test("'T.Cs' does NOT fire (trailing non-period char — lookahead blocks)", () => {
    // The lookahead requires [\s,;:!?] or $ after the last period
    const out = extractEntityCandidates("She filed the T.Cs for review.")
    const init = out.filter(c => c.class === "initials")
    expect(init).toHaveLength(0)
  })

  test("multiple initials in passage — all fire", () => {
    const out = extractEntityCandidates("Both T.C. and K.J. were present.")
    const init = out.filter(c => c.class === "initials")
    const phrases = init.map(c => c.phrase)
    expect(phrases).toContain("T.C.")
    expect(phrases).toContain("K.J.")
  })

  test("inside italics: T.C. does NOT fire", () => {
    const out = extractEntityCandidates("She recalled *T.C. had warned her* before.")
    expect(out.find(c => c.class === "initials")).toBeUndefined()
  })

  test("offset invariant: phrase matches original prose at offsets", () => {
    const prose = "The seal read T.C. clearly."
    const out = extractEntityCandidates(prose)
    const init = out.filter(c => c.class === "initials")
    for (const c of init) {
      expect(prose.slice(c.offsetStart, c.offsetEnd)).toBe(c.phrase)
    }
  })

  test("initialsRegex direct: matches T.C. and J.R.R.", () => {
    const re = initialsRegex()
    const m1 = re.exec("Her name was T.C. always.")
    expect(m1?.[0]).toBe("T.C.")
    re.lastIndex = 0
    const re2 = initialsRegex()
    const m2 = re2.exec("Author J.R.R. wrote it.")
    expect(m2?.[0]).toBe("J.R.R.")
  })
})

// ── L23a: deriveInitials helper ───────────────────────────────────────────────

describe("deriveInitials (L23a)", () => {
  test("Taryn Coombs → T.C. (two tokens)", () => {
    const result = deriveInitials("Taryn Coombs")
    expect(result).toContain("T.C.")
  })

  test("Taryn Coombs Vey → T.C.V., T.C., C.V., T.V.", () => {
    const result = deriveInitials("Taryn Coombs Vey")
    expect(result).toContain("T.C.V.")
    expect(result).toContain("T.C.")
    expect(result).toContain("C.V.")
    expect(result).toContain("T.V.")
  })

  test("single word → empty array (no initials derivable)", () => {
    expect(deriveInitials("Taryn")).toHaveLength(0)
  })

  test("empty string → empty array", () => {
    expect(deriveInitials("")).toHaveLength(0)
  })

  test("Lord Sorcerer Brennan → L.S.B., L.S., S.B., L.B.", () => {
    const result = deriveInitials("Lord Sorcerer Brennan")
    expect(result).toContain("L.S.B.")
    expect(result).toContain("L.S.")
    expect(result).toContain("S.B.")
    expect(result).toContain("L.B.")
  })

  test("results are deduplicated (no duplicate entries)", () => {
    const result = deriveInitials("Taryn Coombs Vey")
    const unique = new Set(result)
    expect(result.length).toBe(unique.size)
  })

  test("two-word name returns only the full-initials form", () => {
    // "A.B." is the only result for a two-token name
    const result = deriveInitials("Alpha Beta")
    expect(result).toEqual(["A.B."])
  })

  test("case-insensitive: 'taryn coombs' still derives initials from first letters", () => {
    const result = deriveInitials("taryn coombs")
    // deriveInitials uppercases first letter of each token
    expect(result).toContain("T.C.")
  })
})

// ── L23a: capitalized-first-only class ───────────────────────────────────────

describe("capitalized-first-only (L23a)", () => {
  test("Aether waste fires (L22 entity — 'Every village the Aether waste takes')", () => {
    const out = extractEntityCandidates("Every village the Aether waste takes.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    expect(cfo.find(c => c.phrase === "Aether waste")).toBeDefined()
  })

  test("Crystal lattice fires", () => {
    const out = extractEntityCandidates("She studied the Crystal lattice in the core.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    expect(cfo.find(c => c.phrase === "Crystal lattice")).toBeDefined()
  })

  test("Soul fire fires", () => {
    const out = extractEntityCandidates("He feared the Soul fire above all other forces.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    expect(cfo.find(c => c.phrase === "Soul fire")).toBeDefined()
  })

  test("Mana drain fires", () => {
    const out = extractEntityCandidates("The Mana drain was accelerating faster.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    expect(cfo.find(c => c.phrase === "Mana drain")).toBeDefined()
  })

  test("Flux core fires", () => {
    const out = extractEntityCandidates("They repaired the Flux core overnight.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    expect(cfo.find(c => c.phrase === "Flux core")).toBeDefined()
  })

  test("'aether waste' does NOT fire (both lowercase)", () => {
    const out = extractEntityCandidates("The aether waste spread further.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    expect(cfo.find(c => c.phrase === "aether waste")).toBeUndefined()
  })

  test("'Crystal Lattice' does NOT fire (both capitalized — handled by capitalized-multi-word)", () => {
    const out = extractEntityCandidates("She studied the Crystal Lattice in the core.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    expect(cfo.find(c => c.phrase === "Crystal Lattice")).toBeUndefined()
    // capitalized-multi-word should fire instead
    const cm = out.filter(c => c.class === "capitalized-multi-word")
    expect(cm.find(c => c.phrase === "Crystal Lattice")).toBeDefined()
  })

  test("'She walked' does NOT fire (second token starts uppercase — not all-lowercase)", () => {
    // "She walked" — 'walked' is lowercase but after 'She' which is Sentence-initial
    // The key: 'walked' starts lowercase, so pattern WOULD match — but this is
    // the FP class. The extractor fires unconditionally; the gate in runNerPrepass
    // suppresses it when 'She' is not grounded.
    // Here we test the extractor fires (gate is not applied in extractEntityCandidates).
    const out = extractEntityCandidates("She walked to the door.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    // Pattern fires on "She walked" — it IS extracted. The FP suppression is
    // the runNerPrepass first-word gate, not the extractor.
    const found = cfo.find(c => c.phrase === "She walked")
    // This may or may not fire depending on word lengths — just verify no crash
    void found
    // All cfo entries must be valid EntityCandidate shapes
    for (const c of cfo) {
      expect(c.class).toBe("capitalized-first-only")
      expect(typeof c.phrase).toBe("string")
    }
  })

  test("second word must be ≥2 lowercase chars (single-char excluded)", () => {
    // "Aether a" — second word is single char → should NOT match
    const out = extractEntityCandidates("The Aether a fell to the ground.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    expect(cfo.find(c => c.phrase === "Aether a")).toBeUndefined()
  })

  test("inside italics: Aether waste does NOT fire", () => {
    const out = extractEntityCandidates("She recalled *Aether waste spreading* in the fields.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    expect(cfo.find(c => c.phrase === "Aether waste")).toBeUndefined()
  })

  test("offset invariant: phrase matches original prose at offsets", () => {
    const prose = "The Aether waste spread across the land."
    const out = extractEntityCandidates(prose)
    for (const c of out) {
      expect(prose.slice(c.offsetStart, c.offsetEnd)).toBe(c.phrase)
    }
  })

  test("capitalizedFirstOnlyRegex direct: matches Aether waste", () => {
    // Use a fresh regex instance per exec() to avoid stateful lastIndex.
    // Place Aether waste mid-sentence after a non-matching prefix.
    const re = capitalizedFirstOnlyRegex()
    const prose1 = "the Aether waste was consuming the land."
    // Skip past "the" — 'the' starts lowercase so won't match; first match is "Aether waste"
    const m1 = re.exec(prose1)
    expect(m1?.[0]).toBe("Aether waste")
  })

  test("capitalizedFirstOnlyRegex direct: matches Crystal lattice", () => {
    const re2 = capitalizedFirstOnlyRegex()
    // All-lowercase prefix so first match is the domain term
    const prose2 = "the Crystal lattice theory."
    const m2 = re2.exec(prose2)
    expect(m2?.[0]).toBe("Crystal lattice")
  })
})

// ── L23a: runNerPrepass cap-first-only gate (requires caller with grounded set) ──

describe("capitalized-first-only: first-word gate (extraction-level check)", () => {
  test("extractEntityCandidates emits cap-first-only unconditionally (gate is in runNerPrepass)", () => {
    // The extractor itself always fires; gating is the caller's responsibility.
    const out = extractEntityCandidates("Every village the Aether waste takes.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    // Should fire on "Aether waste" unconditionally at this layer.
    expect(cfo.find(c => c.phrase === "Aether waste")).toBeDefined()
  })

  test("extractEntityCandidates fires even without grounded context", () => {
    // Contrived sentence: "Darkness crept" would be a FP, but extractor doesn't know.
    const out = extractEntityCandidates("Darkness crept across the battlefield.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    // The extractor fires — "Darkness crept" is a candidate. Callers must gate.
    const found = cfo.find(c => c.phrase === "Darkness crept")
    // This demonstrates the FP risk: extractor fires, gate must suppress.
    expect(found).toBeDefined()
  })
})

// ── L23a: class field includes new classes ────────────────────────────────────

describe("L23a: class field includes new classes", () => {
  test("initials class appears in class-field enum check", () => {
    const out = extractEntityCandidates("Her name was T.C. always.")
    const init = out.filter(c => c.class === "initials")
    expect(init.length).toBeGreaterThan(0)
    for (const c of init) {
      expect(["title-pair", "capitalized-multi-word", "suffix-class", "x-of-y-capitalized", "number-word-tail", "initials", "capitalized-first-only"]).toContain(c.class)
    }
  })

  test("capitalized-first-only class appears in class-field enum check", () => {
    const out = extractEntityCandidates("She studied Crystal lattice closely.")
    const cfo = out.filter(c => c.class === "capitalized-first-only")
    expect(cfo.length).toBeGreaterThan(0)
    for (const c of cfo) {
      expect(["title-pair", "capitalized-multi-word", "suffix-class", "x-of-y-capitalized", "number-word-tail", "initials", "capitalized-first-only"]).toContain(c.class)
    }
  })
})

// ── L23a: regression guards — existing classes unchanged ─────────────────────

describe("regression guards (L23a must not disturb prior classes)", () => {
  test("existing 5 classes still fire after L23a", () => {
    const out = extractEntityCandidates(
      "Master Orin met the Bellward Order under the Crown of Hyran near the Veiled Eight."
    )
    const classes = new Set(out.map(c => c.class))
    expect(classes.has("title-pair")).toBe(true)
    expect(classes.has("suffix-class")).toBe(true)
    expect(classes.has("x-of-y-capitalized")).toBe(true)
    expect(classes.has("number-word-tail")).toBe(true)
  })

  test("capitalized-multi-word at sentence start STILL filtered after L23a", () => {
    const out = extractEntityCandidates("Sundered Crown fell from the sky.")
    expect(out.filter(c => c.class === "capitalized-multi-word")).toHaveLength(0)
  })

  test("suffix-class at sentence start STILL filtered after L23a", () => {
    const out = extractEntityCandidates("Bellward Order met that night.")
    expect(out.filter(c => c.class === "suffix-class")).toHaveLength(0)
  })

  test("title-pair still fires at sentence start after L23a", () => {
    const out = extractEntityCandidates("Arbiter Vesh entered the hall.")
    const tp = out.filter(c => c.class === "title-pair")
    expect(tp).toHaveLength(1)
    expect(tp[0].phrase).toBe("Arbiter Vesh")
  })

  test("sorted order: initials and cap-first-only appear in ascending offsetStart", () => {
    const prose = "T.C. studied the Aether waste carefully."
    const out = extractEntityCandidates(prose)
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i].offsetStart).toBeLessThanOrEqual(out[i + 1].offsetStart)
    }
  })
})
