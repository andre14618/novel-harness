import { describe, expect, test } from "bun:test"
import { detectProseIntegrityIssues, offsetToBeatIndex, repairMechanicalQuoteIntegrity, validateLintFixIntegrity } from "./integrity"

describe("validateLintFixIntegrity", () => {
  test("passes unchanged prose", () => {
    const prose = "She lifted the blade. She waited again."
    expect(validateLintFixIntegrity(prose, prose).pass).toBe(true)
  })

  test("rejects exp #265 fused-boundary corruption", () => {
    const original = "She lifted the blade. She waited again."
    const fixed = "She lifted the blade.She waited again."
    const result = validateLintFixIntegrity(original, fixed)

    expect(result.pass).toBe(false)
    expect(result.issues.some(i => i.kind === "fused-boundary" && i.excerpt.includes("blade.She"))).toBe(true)
  })

  test("rejects exp #265 dropped-space camel fusion", () => {
    const original = "She waited again. She listened."
    const fixed = "She waited againShe listened."
    const result = validateLintFixIntegrity(original, fixed)

    expect(result.pass).toBe(false)
    expect(result.issues.some(i => i.kind === "camel-fusion" && i.excerpt === "againShe")).toBe(true)
  })

  test("rejects exp #265 malformed fragment join", () => {
    const original = "She turned to find her hand empty."
    const fixed = "She turned to f.ind her hand empty."
    const result = validateLintFixIntegrity(original, fixed)

    expect(result.pass).toBe(false)
    expect(result.issues.some(i => i.kind === "fused-boundary" && i.excerpt.includes(".ind her"))).toBe(true)
  })

  test("rejects newly introduced adjacent duplicate sentences", () => {
    const original = "She crossed the threshold. The hall narrowed."
    const fixed = "She crossed the threshold. The hall narrowed. The hall narrowed."
    const result = validateLintFixIntegrity(original, fixed)

    expect(result.pass).toBe(false)
    expect(result.issues.some(i => i.kind === "duplicate-sentence")).toBe(true)
  })

  test("does not reject duplicate sentence pairs that already existed", () => {
    const original = "The hall narrowed. The hall narrowed. She stopped."
    const fixed = "The hall narrowed. The hall narrowed. She paused."
    const result = validateLintFixIntegrity(original, fixed)

    expect(result.issues.some(i => i.kind === "duplicate-sentence")).toBe(false)
  })
})

describe("detectProseIntegrityIssues", () => {
  test("detects approved-prose duplicate seam", () => {
    const issues = detectProseIntegrityIssues(
      "He set his daughter down on the cot. He set his daughter down on the cot.",
    )

    expect(issues.some(i => i.kind === "duplicate-sentence")).toBe(true)
  })

  test("detects adjacent duplicate fragment seam from exp #268", () => {
    const prose = `Wren's father's face crumpled. He set his daughter down on the cot with a tenderness that made Istra's chest tighten, then turned, his hands outstretched.

"Please," he said. "She's all I have left."

He set his daughter down on the cot with a tenderness that made Istra's chest tighten, then turned, his hands outstretched. "Please," he said. "She's all I have left."`
    const issues = detectProseIntegrityIssues(prose)

    expect(issues.some(i => i.kind === "duplicate-fragment")).toBe(true)
  })

  test("detects malformed dialogue from exp #268", () => {
    const malformed = `Then I will revoke your license myself." He folded his hands. "The malady kills, Colleague. We will investigate when the crisis abates." He slid the parchment closer. "That is the best I can offer.""`
    const issues = detectProseIntegrityIssues(malformed)

    expect(issues.some(i => i.kind === "quote-integrity")).toBe(true)
  })

  test("allows ordinary balanced dialogue", () => {
    const prose = `"Report," Istra said. He bowed. "The patient is awake."`
    const issues = detectProseIntegrityIssues(prose)

    expect(issues.filter(i => i.kind === "quote-integrity")).toEqual([])
  })

  test("repairs reversed closing curly quote without a rewrite", () => {
    const prose = `She did not stop writing. “If it pleases you, I am nearly finished. The margins require—“`
    const before = detectProseIntegrityIssues(prose)

    expect(before.some(i => i.kind === "quote-integrity")).toBe(true)

    const repaired = repairMechanicalQuoteIntegrity(prose)
    const after = detectProseIntegrityIssues(repaired.prose)

    expect(repaired.fixed).toBe(1)
    expect(repaired.prose).toContain("require—”")
    expect(after.filter(i => i.kind === "quote-integrity")).toEqual([])
  })

  test("does not guess at unrecoverable odd quote counts", () => {
    const prose = `She did not stop writing. “If it pleases you, I am nearly finished.`
    const repaired = repairMechanicalQuoteIntegrity(prose)

    expect(repaired.fixed).toBe(0)
    expect(repaired.prose).toBe(prose)
  })

  // L63 / Lever A: duplicate-sentence and duplicate-fragment carry a `firstExcerpt`
  // so the writer can see both halves of the collision and paraphrase one side.
  test("duplicate-sentence carries firstExcerpt of the prior sentence (L63)", () => {
    const prose = "She crossed the threshold. The hall narrowed. The hall narrowed."
    const issues = detectProseIntegrityIssues(prose)
    const dup = issues.find(i => i.kind === "duplicate-sentence")

    expect(dup).toBeDefined()
    expect(dup!.firstExcerpt).toBeDefined()
    // Both halves carry "The hall narrowed" — for an exact duplicate, the
    // surface text matches by definition. Lever A's value is that the writer
    // sees the pair labeled (first/second) so the collision is explicit.
    expect(dup!.excerpt).toContain("The hall narrowed")
    expect(dup!.firstExcerpt).toContain("The hall narrowed")
  })

  test("duplicate-fragment carries firstExcerpt from the first occurrence's char offset (L63)", () => {
    const prose = `He set his daughter down on the cot with a tenderness that made Istra's chest tighten, then turned, his hands outstretched. Please he said. She is all I have left.

He set his daughter down on the cot with a tenderness that made Istra's chest tighten, then turned, his hands outstretched. Please he said. She is all I have left.`
    const issues = detectProseIntegrityIssues(prose)
    const frag = issues.find(i => i.kind === "duplicate-fragment")

    expect(frag).toBeDefined()
    expect(frag!.firstExcerpt).toBeDefined()
    expect(frag!.excerpt).toBeDefined()
    // Both excerpts come from contextExcerpt: 20 before + 24 after the position;
    // they may overlap in surface text but must be distinct payloads.
    expect(frag!.firstExcerpt).not.toBe(frag!.excerpt)
  })

  test("non-duplicate kinds do NOT carry firstExcerpt (L63 boundary check)", () => {
    const prose = `She lifted the blade.She waited again.`
    const issues = detectProseIntegrityIssues(prose)
    const fused = issues.find(i => i.kind === "fused-boundary")

    expect(fused).toBeDefined()
    expect(fused!.firstExcerpt).toBeUndefined()
  })

  // L62: LitRPG / System-style identifiers like SCRIBE.GUILD.VALDRIS.MARET.ANNUAL
  // are a legitimate genre construct (see exp #384, novel-1777761636607 ch1 a3).
  // Internal dots inside an all-caps dotted run are part of the token, not
  // sentence terminators.
  test("allows LitRPG System path identifier inside narration (L62)", () => {
    const prose = "She stared at the System UID: SCRIBE.GUILD.VALDRIS.MARET.ANNUAL. The class flickered."
    const issues = detectProseIntegrityIssues(prose)

    expect(issues.filter(i => i.kind === "fused-boundary")).toEqual([])
  })

  test("allows multi-segment System UID at sentence start (L62)", () => {
    const prose = "*SCRIBE.GUILD.VALDRIS.MARET.ANNUAL.* Class: Archivist. Rank: Journeyman."
    const issues = detectProseIntegrityIssues(prose)

    expect(issues.filter(i => i.kind === "fused-boundary")).toEqual([])
  })

  test("still catches a real fused boundary near a System UID (L62)", () => {
    const prose = "He read SCRIBE.GUILD.VALDRIS.MARET.ANNUAL. then frowned.She turned away."
    const issues = detectProseIntegrityIssues(prose)

    expect(issues.some(i => i.kind === "fused-boundary" && i.excerpt.includes("frowned.She"))).toBe(true)
  })

  test("does not falsely accept a single-letter abbreviation (L62 boundary check)", () => {
    const prose = "She said O.She turned away."
    const issues = detectProseIntegrityIssues(prose)

    expect(issues.some(i => i.kind === "fused-boundary" && i.excerpt.includes("O.She"))).toBe(true)
  })
})

// L70b / Lever I-D form (a): offset metadata + beat-index mapping
// for per-fragment beat-targeted rewrite.

describe("LintFixIntegrityIssue offsets (L70b)", () => {
  test("fused-boundary issue carries char offset of the punctuation", () => {
    const prose = "alpha beta. gamma.She delta."
    const issues = detectProseIntegrityIssues(prose)
    const fused = issues.find(i => i.kind === "fused-boundary" && i.excerpt.includes("gamma.She"))

    expect(fused).toBeDefined()
    expect(fused!.offset).toBeDefined()
    expect(prose[fused!.offset!]).toBe(".")
    // The matched '.' sits immediately before 'S' in "gamma.She".
    expect(prose[fused!.offset! + 1]).toBe("S")
  })

  test("camel-fusion issue carries char offset of the fused token", () => {
    const prose = "She paused thenShe turned."
    const issues = detectProseIntegrityIssues(prose)
    const camel = issues.find(i => i.kind === "camel-fusion" && i.excerpt === "thenShe")

    expect(camel).toBeDefined()
    expect(camel!.offset).toBeDefined()
    expect(prose.slice(camel!.offset!, camel!.offset! + 7)).toBe("thenShe")
  })

  test("duplicate-sentence issue carries offset + firstOffset for both occurrences", () => {
    const prose = "Open. The hall narrowed. The hall narrowed. Close."
    const issues = detectProseIntegrityIssues(prose)
    const dup = issues.find(i => i.kind === "duplicate-sentence")

    expect(dup).toBeDefined()
    expect(dup!.firstOffset).toBeDefined()
    expect(dup!.offset).toBeDefined()
    // The first occurrence appears earlier in the text than the second.
    expect(dup!.firstOffset!).toBeLessThan(dup!.offset!)
    // Both offsets land at sentence-start whitespace (extractSentences captures
    // the leading space) or the actual char.
    expect(prose.slice(dup!.firstOffset!, dup!.firstOffset! + 20)).toContain("hall narrowed")
    expect(prose.slice(dup!.offset!, dup!.offset! + 20)).toContain("hall narrowed")
  })

  test("duplicate-fragment issue carries offset + firstOffset for the matched n-gram", () => {
    // 8-gram (gramSize=8) repeated twice within 120-token window.
    const fragment = "she set her hand on the silver railing"
    const prose = `She walked the corridor. ${fragment}. He paused. ${fragment}. She moved on.`
    const issues = detectProseIntegrityIssues(prose)
    const dup = issues.find(i => i.kind === "duplicate-fragment")

    expect(dup).toBeDefined()
    expect(dup!.firstOffset).toBeDefined()
    expect(dup!.offset).toBeDefined()
    expect(dup!.firstOffset!).toBeLessThan(dup!.offset!)
    // Both offsets sit at the start of the matched n-gram text.
    expect(prose.slice(dup!.firstOffset!).startsWith("she") || prose.slice(dup!.firstOffset!).startsWith("She")).toBe(true)
    expect(prose.slice(dup!.offset!).startsWith("she") || prose.slice(dup!.offset!).startsWith("She")).toBe(true)
  })

  test("non-duplicate kinds do not set firstOffset", () => {
    const prose = "alpha.Beta gamma."
    const issues = detectProseIntegrityIssues(prose)
    const fused = issues.find(i => i.kind === "fused-boundary")

    expect(fused).toBeDefined()
    expect(fused!.firstOffset).toBeUndefined()
  })
})

// L72 / Lever I-A: duplicate-sentence false-positive on punctuation-only
// differences. Single-word dialogue like "No." vs "No?" must NOT be treated
// as duplicate sentences (different intent: declarative vs interrogative).

describe("detectAdjacentDuplicateSentences punctuation discrimination (L72)", () => {
  test("does NOT flag single-word dialogue with different terminal punctuation", () => {
    // Real case from debt ch2 att 1 (novel-1777782556256, exp #399).
    const prose = `She paused.

"No."

"No?"

He stepped back.`
    const issues = detectProseIntegrityIssues(prose)
    expect(issues.filter(i => i.kind === "duplicate-sentence")).toEqual([])
  })

  test("does NOT flag short interjections with different terminators", () => {
    const prose = `"Wait!"

"Wait?"`
    const issues = detectProseIntegrityIssues(prose)
    expect(issues.filter(i => i.kind === "duplicate-sentence")).toEqual([])
  })

  test("STILL catches genuine adjacent duplicate sentences (regression guard)", () => {
    const prose = "She crossed the threshold. The hall narrowed. The hall narrowed."
    const issues = detectProseIntegrityIssues(prose)
    expect(issues.some(i => i.kind === "duplicate-sentence")).toBe(true)
  })

  test("STILL catches duplicates of single-word dialogue when terminator matches", () => {
    const prose = `"No."

"No."`
    const issues = detectProseIntegrityIssues(prose)
    expect(issues.some(i => i.kind === "duplicate-sentence")).toBe(true)
  })

  test("preserves distinction between `.` and `...` (ellipsis vs full stop)", () => {
    const prose = "The hall narrowed... The hall narrowed."
    const issues = detectProseIntegrityIssues(prose)
    expect(issues.filter(i => i.kind === "duplicate-sentence")).toEqual([])
  })
})

describe("offsetToBeatIndex (L70b)", () => {
  test("returns -1 when beatProses is empty", () => {
    expect(offsetToBeatIndex(0, [])).toBe(-1)
    expect(offsetToBeatIndex(100, [])).toBe(-1)
  })

  test("clamps negative offsets to beat 0", () => {
    expect(offsetToBeatIndex(-5, ["alpha", "beta", "gamma"])).toBe(0)
  })

  test("offset inside the first beat returns 0", () => {
    const beats = ["alpha beat", "beta beat", "gamma beat"]
    // beats[0].length === 10; "alpha beat\n\nbeta beat\n\ngamma beat"
    expect(offsetToBeatIndex(0, beats)).toBe(0)
    expect(offsetToBeatIndex(5, beats)).toBe(0)
    expect(offsetToBeatIndex(9, beats)).toBe(0) // last char of beat 0
  })

  test("offset inside the separator after beat 0 attributes to beat 1", () => {
    const beats = ["alpha beat", "beta beat", "gamma beat"]
    // beat 0 ends at char index 10; separator "\n\n" occupies 10..11.
    expect(offsetToBeatIndex(10, beats)).toBe(1) // first char of separator
    expect(offsetToBeatIndex(11, beats)).toBe(1) // second char of separator
  })

  test("offset inside beat 1 returns 1", () => {
    const beats = ["alpha beat", "beta beat", "gamma beat"]
    // beat 1 starts at char 12 (after "\n\n").
    expect(offsetToBeatIndex(12, beats)).toBe(1)
    expect(offsetToBeatIndex(20, beats)).toBe(1) // last char of beat 1 (12+8=20, "beta beat" len=9)
  })

  test("offset past last beat clamps to last index", () => {
    const beats = ["alpha", "beta", "gamma"]
    const joined = beats.join("\n\n")
    expect(offsetToBeatIndex(joined.length + 100, beats)).toBe(2)
  })

  test("matches the actual joined-string layout", () => {
    const beats = ["First beat ends here.", "Second beat starts now.", "Third beat closes."]
    const joined = beats.join("\n\n")
    // For every char in `joined`, find which beat it belongs to via slicing
    // each beat's substring on the joined text and check the helper agrees.
    for (let i = 0; i < beats[0].length; i++) {
      expect(offsetToBeatIndex(i, beats)).toBe(0)
    }
    const beat1Start = beats[0].length + 2
    for (let i = beat1Start; i < beat1Start + beats[1].length; i++) {
      expect(offsetToBeatIndex(i, beats)).toBe(1)
    }
    const beat2Start = beat1Start + beats[1].length + 2
    for (let i = beat2Start; i < beat2Start + beats[2].length; i++) {
      expect(offsetToBeatIndex(i, beats)).toBe(2)
    }
  })

  test("custom separator works", () => {
    const beats = ["alpha", "beta"]
    // With a 4-char separator, beat 1 starts at offset 5+4=9.
    expect(offsetToBeatIndex(9, beats, "----")).toBe(1)
    expect(offsetToBeatIndex(8, beats, "----")).toBe(1) // in separator
    expect(offsetToBeatIndex(4, beats, "----")).toBe(0) // last char of beat 0
  })
})
