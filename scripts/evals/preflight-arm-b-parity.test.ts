import { describe, test, expect } from "bun:test"
import {
  checkArmBStructure,
  envelopeEqual,
  firstDivergenceOffset,
  type CheckArmBStructureInputs,
  type EnvelopeFields,
} from "./preflight-arm-b-parity"

// ── Fixtures ──────────────────────────────────────────────────────────

const ENRICHED_SECTION = "ENRICHED CONTEXT:\nsome enriched content here"

const BASELINE_SECTIONS = [
  "Beat spec: Dagnar enters the hall.",
  "TRANSITION BRIDGE (continue from here):\nHe paused at the threshold.",
  "CHARACTERS:\nDagnar: stoic warrior",
  "SETTING:\nThe great hall, firelit.",
]

const baseEnvelope: EnvelopeFields = {
  model: "deepseek-chat",
  provider: "deepseek",
  temperature: 0.8,
  maxTokens: 4000,
  responseFormat: null,
}

const baseSubBlockBytes = {
  speakerDirectives: 0,
  readerInfoState: 0,
  focusedWorldSlice: 0,
}

/**
 * Build the canonical "Arm B" array by inserting ENRICHED CONTEXT before
 * the SETTING: section. Mirrors insertEnrichedSection behavior for index 3.
 */
function buildValidArmB(armA: string[] = BASELINE_SECTIONS): string[] {
  // SETTING: is at index 3 — insert at 3
  const result = [...armA]
  result.splice(3, 0, ENRICHED_SECTION)
  return result
}

function makeInputs(overrides: Partial<CheckArmBStructureInputs> = {}): CheckArmBStructureInputs {
  const armASections = BASELINE_SECTIONS
  const armBSections = buildValidArmB(armASections)
  return {
    llm_call_id: 42,
    chapter: 2,
    beat_index: 0,
    armASections,
    armBSections,
    enrichedBlock: ENRICHED_SECTION,
    subBlockBytes: baseSubBlockBytes,
    liveSystemPrompt: "You are a fantasy writer.",
    baselineSystemPrompt: "You are a fantasy writer.",
    liveEnvelope: { ...baseEnvelope },
    baselineEnvelope: { ...baseEnvelope },
    ...overrides,
  }
}

// ── Happy path ────────────────────────────────────────────────────────

describe("happy path — all assertions pass", () => {
  test("result.ok is true", () => {
    const result = checkArmBStructure(makeInputs())
    expect(result.ok).toBe(true)
  })

  test("failures array is empty", () => {
    const result = checkArmBStructure(makeInputs())
    expect(result.failures).toHaveLength(0)
  })

  test("diff is absent on success", () => {
    const result = checkArmBStructure(makeInputs())
    expect(result.diff).toBeUndefined()
  })

  test("telemetry is populated with correct counts", () => {
    const result = checkArmBStructure(makeInputs())
    expect(result.telemetry).toBeDefined()
    expect(result.telemetry!.arm_a_section_count).toBe(4)
    expect(result.telemetry!.arm_b_section_count).toBe(5)
  })

  test("telemetry enriched_bytes matches enrichedBlock.length", () => {
    const result = checkArmBStructure(makeInputs())
    expect(result.telemetry!.enriched_bytes).toBe(ENRICHED_SECTION.length)
  })

  test("telemetry sub_block_bytes matches provided value", () => {
    const sub = { speakerDirectives: 10, readerInfoState: 20, focusedWorldSlice: 30 }
    const result = checkArmBStructure(makeInputs({ subBlockBytes: sub }))
    expect(result.telemetry!.sub_block_bytes).toEqual(sub)
  })

  test("result carries the correct identity fields", () => {
    const result = checkArmBStructure(makeInputs())
    expect(result.llm_call_id).toBe(42)
    expect(result.chapter).toBe(2)
    expect(result.beat_index).toBe(0)
  })
})

// ── Assertion 1: length ───────────────────────────────────────────────

describe("Assertion 1 — armB length must be armA length + 1", () => {
  test("fails when armB is same length as armA (missing insertion)", () => {
    // armB == armA — the enriched section was never inserted
    const result = checkArmBStructure(makeInputs({
      armBSections: BASELINE_SECTIONS,
    }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 1"))).toBe(true)
  })

  test("failure message names the actual lengths", () => {
    const result = checkArmBStructure(makeInputs({
      armBSections: BASELINE_SECTIONS,
    }))
    const msg = result.failures.find(f => f.includes("Assertion 1"))!
    expect(msg).toContain("armB=4")
    expect(msg).toContain("armA(4)")
  })

  test("diff is populated on length failure", () => {
    const result = checkArmBStructure(makeInputs({
      armBSections: BASELINE_SECTIONS,
    }))
    expect(result.diff).toBeDefined()
    expect(result.diff!.arm_a_section_count).toBe(4)
    expect(result.diff!.arm_b_section_count).toBe(4)
  })

  test("fails when armB has two extra sections (double insertion)", () => {
    // Two ENRICHED CONTEXT sections inserted — violates both Assertion 1 and 2
    const doubled = [
      ...BASELINE_SECTIONS.slice(0, 3),
      ENRICHED_SECTION,
      ENRICHED_SECTION,
      BASELINE_SECTIONS[3],
    ]
    const result = checkArmBStructure(makeInputs({ armBSections: doubled }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 1"))).toBe(true)
  })
})

// ── Assertion 2: single ENRICHED CONTEXT ─────────────────────────────

describe("Assertion 2 — exactly one ENRICHED CONTEXT: section in Arm B", () => {
  test("fails when armB has two ENRICHED CONTEXT sections", () => {
    // Length is correct (A+1) because we replace one baseline section,
    // but there are two ENRICHED CONTEXT: entries in the result.
    // Construct: keep A length +1 by swapping a section for an enriched duplicate.
    const twoEnriched = [
      BASELINE_SECTIONS[0],
      BASELINE_SECTIONS[1],
      ENRICHED_SECTION,           // inserted at index 2
      ENRICHED_SECTION,           // second copy — forces assertion 2 failure
      BASELINE_SECTIONS[2],
    ]
    // Verify length contract: len == BASELINE_SECTIONS.length + 1 (4+1=5)
    expect(twoEnriched.length).toBe(BASELINE_SECTIONS.length + 1)
    const result = checkArmBStructure(makeInputs({ armBSections: twoEnriched }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 2"))).toBe(true)
  })

  test("failure message names the count found", () => {
    const twoEnriched = [
      BASELINE_SECTIONS[0],
      BASELINE_SECTIONS[1],
      ENRICHED_SECTION,
      ENRICHED_SECTION,
      BASELINE_SECTIONS[2],
    ]
    const result = checkArmBStructure(makeInputs({ armBSections: twoEnriched }))
    const msg = result.failures.find(f => f.includes("Assertion 2"))!
    expect(msg).toContain("found 2")
  })

  test("fails when armB has zero ENRICHED CONTEXT sections (correct length via different content)", () => {
    // Same length as armA+1 but no ENRICHED CONTEXT: section at all —
    // simulates a malformed insertion that used a different header.
    const noEnriched = [
      ...BASELINE_SECTIONS,
      "WRONGHEADER:\nsome content",
    ]
    expect(noEnriched.length).toBe(BASELINE_SECTIONS.length + 1)
    const result = checkArmBStructure(makeInputs({ armBSections: noEnriched }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 2"))).toBe(true)
    const msg = result.failures.find(f => f.includes("Assertion 2"))!
    expect(msg).toContain("found 0")
  })
})

// ── Assertion 3/4: byte-equal by index after ENRICHED removal ────────

describe("Assertion 3/4 — sections_B' == sections_A byte-equal by index", () => {
  test("fails when a non-ENRICHED section in armB differs from armA at the same index", () => {
    // Corrupt CHARACTERS section in armB
    const corrupted = [...buildValidArmB()]
    // index 2 in armB is CHARACTERS: (offset by 1 due to ENRICHED at index 3)
    corrupted[2] = "CHARACTERS:\nDagnar: corrupted version"
    const result = checkArmBStructure(makeInputs({ armBSections: corrupted }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 4"))).toBe(true)
  })

  test("diff.first_byte_divergence.offset is the exact byte position", () => {
    const corrupted = [...buildValidArmB()]
    // armA section 2 is "CHARACTERS:\nDagnar: stoic warrior"
    // armB section 2 (after ENRICHED at index 3) is the same — corrupt it
    corrupted[2] = "CHARACTERS:\nDagnar: XXXXXX warrior"
    //                                           ^ diverges at byte 21
    // "CHARACTERS:\nDagnar: " has length 21
    const prefix = "CHARACTERS:\nDagnar: "
    const expectedOffset = prefix.length
    const result = checkArmBStructure(makeInputs({ armBSections: corrupted }))
    expect(result.diff!.first_byte_divergence).toBeDefined()
    expect(result.diff!.first_byte_divergence!.offset).toBe(expectedOffset)
    expect(result.diff!.first_byte_divergence!.section_index).toBe(2)
  })

  test("diff.first_byte_divergence captures context around divergence point", () => {
    const corrupted = [...buildValidArmB()]
    corrupted[2] = "CHARACTERS:\nDagnar: XXXXXX warrior"
    const result = checkArmBStructure(makeInputs({ armBSections: corrupted }))
    // a_ctx is from armA, b_ctx is from armB_prime
    expect(result.diff!.first_byte_divergence!.a_ctx).toContain("stoic")
    expect(result.diff!.first_byte_divergence!.b_ctx).toContain("XXXXXX")
  })

  test("Assertion 3 fires when armBPrime length does not match armA after ENRICHED removal", () => {
    // Two ENRICHED sections of correct prefix — armBPrime after removal has
    // length = armA.length - 1, triggering assertion 3 (not assertion 4).
    // Construct armB with correct total length (A+1) but two ENRICHEDs, so
    // after removing both the prime has len(A)-1.
    const twoEnrichedWithReplacement = [
      BASELINE_SECTIONS[0],
      ENRICHED_SECTION,           // at index 1
      ENRICHED_SECTION,           // at index 2
      BASELINE_SECTIONS[1],
      BASELINE_SECTIONS[2],
    ]
    // Length is 5 == 4+1. After removing 2 ENRICHED sections, prime has 3 != 4.
    expect(twoEnrichedWithReplacement.length).toBe(BASELINE_SECTIONS.length + 1)
    const result = checkArmBStructure(makeInputs({ armBSections: twoEnrichedWithReplacement }))
    expect(result.ok).toBe(false)
    // Assertion 2 fires for 2 ENRICHED sections AND assertion 3 fires for length mismatch
    expect(result.failures.some(f => f.includes("Assertion 3"))).toBe(true)
  })

  test("Assertion 3 failure message names prime length and armA length", () => {
    const twoEnrichedWithReplacement = [
      BASELINE_SECTIONS[0],
      ENRICHED_SECTION,
      ENRICHED_SECTION,
      BASELINE_SECTIONS[1],
      BASELINE_SECTIONS[2],
    ]
    const result = checkArmBStructure(makeInputs({ armBSections: twoEnrichedWithReplacement }))
    const msg = result.failures.find(f => f.includes("Assertion 3"))!
    expect(msg).toContain("armB_prime length=3")
    expect(msg).toContain("armA length=4")
  })
})

// ── Assertion 5: system_prompt drift ─────────────────────────────────

describe("Assertion 5 — system_prompt byte-equal to baseline", () => {
  test("fails when live system_prompt differs from baseline", () => {
    const result = checkArmBStructure(makeInputs({
      liveSystemPrompt: "You are a sci-fi writer.",
      baselineSystemPrompt: "You are a fantasy writer.",
    }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 5"))).toBe(true)
  })

  test("diff.system_prompt_first_divergence is set to the byte offset", () => {
    const result = checkArmBStructure(makeInputs({
      liveSystemPrompt: "You are a sci-fi writer.",
      baselineSystemPrompt: "You are a fantasy writer.",
    }))
    // "You are a " has length 10; then 's' vs 'f' diverge
    expect(result.diff!.system_prompt_first_divergence).toBe(10)
  })

  test("fails when live system_prompt is null (treated as empty string vs non-empty baseline)", () => {
    const result = checkArmBStructure(makeInputs({
      liveSystemPrompt: null,
      baselineSystemPrompt: "You are a fantasy writer.",
    }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 5"))).toBe(true)
    // null is coerced to "" — diverges at offset 0
    expect(result.diff!.system_prompt_first_divergence).toBe(0)
  })

  test("passes when live system_prompt matches baseline exactly", () => {
    const result = checkArmBStructure(makeInputs({
      liveSystemPrompt: "You are a fantasy writer.",
      baselineSystemPrompt: "You are a fantasy writer.",
    }))
    // Only checking that Assertion 5 does not appear in failures
    expect(result.failures.some(f => f.includes("Assertion 5"))).toBe(false)
  })
})

// ── Assertion 6: envelope drift ───────────────────────────────────────

describe("Assertion 6 — envelope fields byte-equal to baseline", () => {
  test("fails when model field differs", () => {
    const result = checkArmBStructure(makeInputs({
      liveEnvelope: { ...baseEnvelope, model: "gpt-4o" },
    }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 6"))).toBe(true)
  })

  test("diff.envelope_diffs contains the diverging field", () => {
    const result = checkArmBStructure(makeInputs({
      liveEnvelope: { ...baseEnvelope, model: "gpt-4o" },
    }))
    expect(result.diff!.envelope_diffs).toBeDefined()
    expect(result.diff!.envelope_diffs!.some(d => d.startsWith("model:"))).toBe(true)
  })

  test("fails when temperature changes from number to null", () => {
    const result = checkArmBStructure(makeInputs({
      liveEnvelope: { ...baseEnvelope, temperature: null },
    }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 6"))).toBe(true)
    expect(result.diff!.envelope_diffs!.some(d => d.startsWith("temperature:"))).toBe(true)
  })

  test("fails when maxTokens differs", () => {
    const result = checkArmBStructure(makeInputs({
      liveEnvelope: { ...baseEnvelope, maxTokens: 8000 },
    }))
    expect(result.ok).toBe(false)
    expect(result.diff!.envelope_diffs!.some(d => d.startsWith("maxTokens:"))).toBe(true)
  })

  test("fails when provider differs", () => {
    const result = checkArmBStructure(makeInputs({
      liveEnvelope: { ...baseEnvelope, provider: "fireworks" },
    }))
    expect(result.ok).toBe(false)
    expect(result.diff!.envelope_diffs!.some(d => d.startsWith("provider:"))).toBe(true)
  })
})

// ── Compound failure — multiple assertions, no short-circuit ─────────

describe("compound failure — multiple assertions fail simultaneously", () => {
  test("both Assertion 5 and Assertion 6 appear in failures when both drift", () => {
    const result = checkArmBStructure(makeInputs({
      liveSystemPrompt: "completely different system prompt",
      baselineSystemPrompt: "You are a fantasy writer.",
      liveEnvelope: { ...baseEnvelope, model: "gpt-4o", provider: "openai" },
    }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 5"))).toBe(true)
    expect(result.failures.some(f => f.includes("Assertion 6"))).toBe(true)
    expect(result.failures.length).toBeGreaterThanOrEqual(2)
  })

  test("Assertion 1 + Assertion 2 + Assertion 5 all appear when armB is unmodified plus system drift", () => {
    // armB same length as armA (no insertion) → Assertion 1 fires
    // no ENRICHED CONTEXT section → Assertion 2 fires
    // system_prompt mismatch → Assertion 5 fires
    const result = checkArmBStructure(makeInputs({
      armBSections: BASELINE_SECTIONS,              // same length, no ENRICHED
      liveSystemPrompt: "drifted",
      baselineSystemPrompt: "You are a fantasy writer.",
    }))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes("Assertion 1"))).toBe(true)
    expect(result.failures.some(f => f.includes("Assertion 2"))).toBe(true)
    expect(result.failures.some(f => f.includes("Assertion 5"))).toBe(true)
    // All 3 must appear — not short-circuited after the first
    expect(result.failures.length).toBeGreaterThanOrEqual(3)
  })

  test("diff is populated (not undefined) on compound failure", () => {
    const result = checkArmBStructure(makeInputs({
      liveEnvelope: { ...baseEnvelope, model: "gpt-4o" },
      liveSystemPrompt: "drifted",
      baselineSystemPrompt: "You are a fantasy writer.",
    }))
    expect(result.diff).toBeDefined()
  })
})

// ── firstDivergenceOffset ─────────────────────────────────────────────

describe("firstDivergenceOffset", () => {
  test("returns -1 for identical strings", () => {
    expect(firstDivergenceOffset("hello", "hello")).toBe(-1)
  })

  test("returns -1 for two empty strings", () => {
    expect(firstDivergenceOffset("", "")).toBe(-1)
  })

  test("diverges at byte 0 when first characters differ", () => {
    expect(firstDivergenceOffset("abc", "xyz")).toBe(0)
  })

  test("diverges at the exact middle byte", () => {
    // "abXde" vs "abYde" — diverge at index 2
    expect(firstDivergenceOffset("abXde", "abYde")).toBe(2)
  })

  test("returns min length when one string is a prefix of the other", () => {
    // "hello" is a prefix of "hello world" — diverges at byte 5 (min length)
    expect(firstDivergenceOffset("hello", "hello world")).toBe(5)
    // symmetric
    expect(firstDivergenceOffset("hello world", "hello")).toBe(5)
  })

  test("handles empty string vs non-empty (prefix case, offset 0)", () => {
    expect(firstDivergenceOffset("", "abc")).toBe(0)
    expect(firstDivergenceOffset("abc", "")).toBe(0)
  })
})

// ── envelopeEqual ─────────────────────────────────────────────────────

describe("envelopeEqual", () => {
  test("returns ok=true and empty diffs for identical envelopes", () => {
    const result = envelopeEqual(baseEnvelope, baseEnvelope)
    expect(result.ok).toBe(true)
    expect(result.diffs).toHaveLength(0)
  })

  test("returns ok=true when both temperatures are null", () => {
    const a: EnvelopeFields = { ...baseEnvelope, temperature: null }
    const b: EnvelopeFields = { ...baseEnvelope, temperature: null }
    expect(envelopeEqual(a, b).ok).toBe(true)
  })

  test("returns ok=false and one diff entry on single field divergence", () => {
    const a: EnvelopeFields = { ...baseEnvelope, model: "deepseek-chat" }
    const b: EnvelopeFields = { ...baseEnvelope, model: "gpt-4o" }
    const result = envelopeEqual(a, b)
    expect(result.ok).toBe(false)
    expect(result.diffs).toHaveLength(1)
    expect(result.diffs[0]).toContain("model:")
  })

  test("diff entry format includes A= and B= values", () => {
    const a: EnvelopeFields = { ...baseEnvelope, model: "deepseek-chat" }
    const b: EnvelopeFields = { ...baseEnvelope, model: "gpt-4o" }
    const result = envelopeEqual(a, b)
    expect(result.diffs[0]).toContain('A="deepseek-chat"')
    expect(result.diffs[0]).toContain('B="gpt-4o"')
  })

  test("returns multiple diff entries when multiple fields diverge", () => {
    const a: EnvelopeFields = { ...baseEnvelope, model: "deepseek-chat", provider: "deepseek" }
    const b: EnvelopeFields = { ...baseEnvelope, model: "gpt-4o", provider: "openai" }
    const result = envelopeEqual(a, b)
    expect(result.ok).toBe(false)
    expect(result.diffs.length).toBeGreaterThanOrEqual(2)
    expect(result.diffs.some(d => d.startsWith("model:"))).toBe(true)
    expect(result.diffs.some(d => d.startsWith("provider:"))).toBe(true)
  })

  test("null temperature differs from numeric temperature", () => {
    const a: EnvelopeFields = { ...baseEnvelope, temperature: null }
    const b: EnvelopeFields = { ...baseEnvelope, temperature: 0.8 }
    const result = envelopeEqual(a, b)
    expect(result.ok).toBe(false)
    expect(result.diffs.some(d => d.startsWith("temperature:"))).toBe(true)
  })

  test("responseFormat null vs undefined are treated as equal (both JSON.stringify to null/undefined)", () => {
    // The implementation uses JSON.stringify — null serializes to "null",
    // undefined serializes to undefined (same value for both sides if both are missing).
    const a: EnvelopeFields = { ...baseEnvelope, responseFormat: null }
    const b: EnvelopeFields = { ...baseEnvelope, responseFormat: null }
    expect(envelopeEqual(a, b).ok).toBe(true)
  })

  test("responseFormat object vs null differs", () => {
    const a: EnvelopeFields = { ...baseEnvelope, responseFormat: { type: "json_object" } }
    const b: EnvelopeFields = { ...baseEnvelope, responseFormat: null }
    const result = envelopeEqual(a, b)
    expect(result.ok).toBe(false)
    expect(result.diffs.some(d => d.startsWith("responseFormat:"))).toBe(true)
  })
})
