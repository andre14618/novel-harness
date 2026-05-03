import { describe, expect, test } from "bun:test"
import { detectProseIntegrityIssues, validateLintFixIntegrity } from "./integrity"

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
