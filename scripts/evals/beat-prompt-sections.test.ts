import { describe, test, expect } from "bun:test"
import {
  recoverSections,
  sectionHeader,
  startsWithSectionHeader,
  computeSignature,
  SECTION_HEADER_PREFIXES,
} from "./beat-prompt-sections"

describe("startsWithSectionHeader", () => {
  test("recognizes each known prefix", () => {
    for (const prefix of SECTION_HEADER_PREFIXES) {
      expect(startsWithSectionHeader(prefix + " …")).toBe(true)
    }
  })
  test("rejects unknown prefixes", () => {
    expect(startsWithSectionHeader("Some narrative prose about Dagnar.")).toBe(false)
    expect(startsWithSectionHeader("    indented thing")).toBe(false)
  })
})

describe("recoverSections round-trip", () => {
  test("simple compact-mode beat with 4 sections", () => {
    const original = [
      "Beat spec text",
      "TRANSITION BRIDGE (continue from here):\nprior prose",
      "LANDING TARGET:\nnext beat first sentence",
      "CHARACTERS:\nDagnar: …",
    ].join("\n\n")
    const sections = recoverSections(original)
    expect(sections).toHaveLength(4)
    expect(sections.join("\n\n")).toBe(original)
  })

  test("non-compact CHARACTERS with internal double-newline between snapshots", () => {
    // In non-compact mode, `snapshots.join("\n\n")` produces internal
    // \n\n. The recovery must glue these back together.
    const original = [
      "Beat spec",
      "CHARACTERS:\nSnapshot A\nline 2\n\nSnapshot B\nline 2\n\nSnapshot C",
      "Sensory: dusk",
    ].join("\n\n")
    const sections = recoverSections(original)
    expect(sections).toHaveLength(3)
    expect(sections[1].startsWith("CHARACTERS:")).toBe(true)
    expect(sections[1]).toContain("Snapshot B")
    expect(sections[1]).toContain("Snapshot C")
    expect(sections.join("\n\n")).toBe(original)
  })

  test("beat-spec has no header and contains \\n\\n internally", () => {
    const original = [
      "Beat spec line 1\n\nContinued beat spec line 2",
      "CHARACTERS:\nfoo",
    ].join("\n\n")
    const sections = recoverSections(original)
    expect(sections).toHaveLength(2)
    expect(sections[0]).toContain("Continued beat spec line 2")
    expect(sections.join("\n\n")).toBe(original)
  })

  test("empty string returns empty array (or array with empty string)", () => {
    const sections = recoverSections("")
    expect(sections.length <= 1).toBe(true)
    expect(sections.join("\n\n")).toBe("")
  })

  test("idempotent on the ENRICHED CONTEXT marker (Arm B recovery)", () => {
    const original = [
      "Beat spec",
      "CHARACTERS:\nDagnar",
      "ENRICHED CONTEXT:\nfoo",
      "Sensory: dusk",
    ].join("\n\n")
    const sections = recoverSections(original)
    expect(sections).toHaveLength(4)
    expect(sections[2].startsWith("ENRICHED CONTEXT:")).toBe(true)
    expect(sections.join("\n\n")).toBe(original)
  })
})

describe("sectionHeader", () => {
  test("identifies each header", () => {
    expect(sectionHeader("TRANSITION BRIDGE (continue):\nx")).toBe("TRANSITION BRIDGE")
    expect(sectionHeader("CHARACTERS:\nx")).toBe("CHARACTERS")
    expect(sectionHeader("Sensory: cold wind")).toBe("Sensory")
    expect(sectionHeader("ENRICHED CONTEXT:\nfoo")).toBe("ENRICHED CONTEXT")
  })
  test("returns (beat-spec) for unheaded", () => {
    expect(sectionHeader("narrative beat spec")).toBe("(beat-spec)")
  })
})

describe("computeSignature", () => {
  test("produces header + byteLength + sha256 per section", () => {
    const sections = ["hello", "CHARACTERS:\nfoo"]
    const sig = computeSignature(sections)
    expect(sig).toHaveLength(2)
    expect(sig[0].header).toBe("(beat-spec)")
    expect(sig[0].byteLength).toBe(5)
    expect(sig[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(sig[1].header).toBe("CHARACTERS")
    expect(sig[1].byteLength).toBe(15)
  })
  test("different bytes produce different sha", () => {
    const a = computeSignature(["foo"])
    const b = computeSignature(["bar"])
    expect(a[0].sha256).not.toBe(b[0].sha256)
  })
})
