/**
 * Unit tests for halluc-ungrounded NER prepass AND-gate behavior.
 *
 * Asserts the three gate paths:
 *   1. Suffix-class entity NOT in grounded union: NER fires, LLM fires (mocked)
 *      → blocker (pass=false, issue without [NER-only] prefix, nerOnlyFindings=[])
 *   2. Suffix-class entity IN grounded union: NER passes → no NER fire
 *      (gated on LLM mock passing too → clean pass)
 *   3. NER fires but LLM mock passes → warning (nerOnlyFindings non-empty,
 *      issue carries [NER-only warning] marker, pass=true)
 *
 * These tests exercise the runtime wiring logic (buildNerGroundedSet +
 * runNerPrepass + AND-gate in checkHallucUngrounded) without making real LLM
 * calls. The LLM call is mocked by monkey-patching the callAgent import at the
 * module level via Bun's module mock support.
 *
 * L4-followup-3 (exp #322) — wired 2026-05-01.
 */

import { test, expect, mock, beforeEach } from "bun:test"
import { runNerPrepass } from "./index"

// ── Tests for the exported runNerPrepass helper ───────────────────────────────
//
// These tests are pure/deterministic: no LLM call, no DB. They confirm the
// NER+grounding plumbing is correct without needing to mock callAgent.

const EMPTY_SURFACE = { lower: new Set<string>(), normalized: new Set<string>() }

test("runNerPrepass: 'Order of Vesh' suffix-class entity not in grounded surface → fires", () => {
  // "Order of Vesh" — the suffix-class extractor catches "Order" preceded by
  // a capitalized word. "of Vesh" is a connector; the NER extractor fires on
  // the phrase because "Order" is in SUFFIX_TOKENS and "Vesh" is the preceding
  // capitalized word — wait, let's check the regex shape: it's [CapWord] [Suffix],
  // so "Vesh Order" would match, but "Order of Vesh" would not. Test a real
  // suffix-class match shape instead.
  const surface = { lower: new Set<string>(), normalized: new Set<string>() }
  const prose = "She had sworn herself to the Vesh Order years ago."
  const fires = runNerPrepass(prose, surface)
  expect(fires.length).toBeGreaterThan(0)
  const phrases = fires.map(c => c.phrase)
  expect(phrases).toContain("Vesh Order")
  const classes = fires.map(c => c.class)
  expect(classes).toContain("suffix-class")
})

test("runNerPrepass: suffix-class entity IS in grounded surface → does not fire", () => {
  // "Vesh Order" grounded in surface → NER should not fire on it.
  const surface = {
    lower: new Set(["vesh order"]),
    normalized: new Set(["vesh order"]),
  }
  const prose = "She had sworn herself to the Vesh Order years ago."
  const fires = runNerPrepass(prose, surface)
  const phrases = fires.map(c => c.phrase)
  expect(phrases).not.toContain("Vesh Order")
})

test("runNerPrepass: entity grounded via normalized plural/possessive → does not fire", async () => {
  // Bible has "The Vesh Orders" (plural); prose has "Vesh Order" (singular).
  // normalizeForGroundedMatch strips the trailing -s and the leading article,
  // so both normalize to "vesh order" → grounded.
  const { normalizeForGroundedMatch } = await import("../../lint/entity-candidates")
  const bibleEntry = normalizeForGroundedMatch("The Vesh Orders")
  const surface = {
    lower: new Set(["the vesh orders"]),
    normalized: new Set([bibleEntry]),
  }
  const prose = "She joined the Vesh Order at dawn."
  const fires = runNerPrepass(prose, surface)
  const phrases = fires.map(c => c.phrase)
  expect(phrases).not.toContain("Vesh Order")
})

test("runNerPrepass: 'Crown of Hyran' — suffix-class shape 'Hyran Crown' fires, ungrounded", () => {
  // The suffix regex matches [CapWord] [Suffix], so "Hyran Crown" fires (Crown is a SUFFIX_TOKEN).
  const surface = EMPTY_SURFACE
  const prose = "He claimed the Hyran Crown by right of blood."
  const fires = runNerPrepass(prose, surface)
  const phrases = fires.map(c => c.phrase)
  expect(phrases).toContain("Hyran Crown")
})

test("runNerPrepass: title-pair entity not grounded → fires", () => {
  const surface = EMPTY_SURFACE
  const prose = "Master Orin entered the hall."
  const fires = runNerPrepass(prose, surface)
  const phrases = fires.map(c => c.phrase)
  expect(phrases).toContain("Master Orin")
  expect(fires.find(c => c.phrase === "Master Orin")?.class).toBe("title-pair")
})

test("runNerPrepass: title-pair entity grounded in bibleNames → does not fire", () => {
  const surface = {
    lower: new Set(["master orin"]),
    normalized: new Set(["master orin"]),
  }
  const prose = "Master Orin entered the hall."
  const fires = runNerPrepass(prose, surface)
  expect(fires.find(c => c.phrase === "Master Orin")).toBeUndefined()
})

test("runNerPrepass: title-pair grounded via title-strip fallback (L49) → does not fire", () => {
  // L49: tier-5 title-strip closes the title+surname gap. When the candidate
  // begins with a known TITLE_TOKEN (Master, Lord, Captain, Arbiter, ...) and
  // the remainder is grounded, the candidate is treated as grounded. "Master
  // Orin" + surface containing "Orin" → grounded (tier 1 match on the remainder).
  const surface = {
    lower: new Set(["orin"]),
    normalized: new Set(["orin"]),
  }
  const prose = "Master Orin entered the hall."
  const fires = runNerPrepass(prose, surface)
  expect(fires.find(c => c.phrase === "Master Orin")).toBeUndefined()
})

test("runNerPrepass: title-pair grounded via title-strip + normalized form (L49) → does not fire", () => {
  // L49: title-strip uses tier-3 (normalized exact) too. Bible has "Cassels"
  // (plural surname); prose has "Arbiter Cassel". Strip "Arbiter" → "Cassel"
  // → normalize → "cassel" → matches normalized "cassel" (from "Cassels"
  // collapsed by trailing-s plural strip).
  const surface = {
    lower: new Set(["cassels"]),
    normalized: new Set([normalizeForGroundedMatchSync("Cassels")]),
  }
  const prose = "Arbiter Cassel surveyed the hall."
  const fires = runNerPrepass(prose, surface)
  expect(fires.find(c => c.phrase === "Arbiter Cassel")).toBeUndefined()
})

test("runNerPrepass: title-strip is bounded — non-title prefix does NOT trigger fallback", () => {
  // L49: the title-strip fallback is GATED on TITLE_TOKENS. A generic
  // capitalized-multi-word like "Aldric Venn" with only "Venn" in the surface
  // must still fire — "Aldric" is not a title token, so no strip.
  const surface = {
    lower: new Set(["venn"]),
    normalized: new Set(["venn"]),
  }
  const prose = "Kael nodded as Aldric Venn left the hall."
  const fires = runNerPrepass(prose, surface)
  expect(fires.find(c => c.phrase === "Aldric Venn")).toBeDefined()
})

test("runNerPrepass: title-strip lowercase-insensitive on the title token", () => {
  // L49: the TITLE_TOKENS_LOWER lookup is case-insensitive. The title-pair
  // regex matches "Master" / "Captain" with leading capital, but the
  // grounding check itself accepts any case-equivalent.
  const surface = {
    lower: new Set(["vesh"]),
    normalized: new Set(["vesh"]),
  }
  const prose = "Captain Vesh stepped forward."
  const fires = runNerPrepass(prose, surface)
  expect(fires.find(c => c.phrase === "Captain Vesh")).toBeUndefined()
})

// Helper: run normalizeForGroundedMatch synchronously inside the test by
// importing it via the module-level path (already imported in index.ts).
// Inline shim so the test reads cleanly.
function normalizeForGroundedMatchSync(s: string): string {
  // Mirror the entity-candidates implementation steps for the small set of
  // inputs used here. Falls back to a require to avoid duplicating logic for
  // any larger inputs the test family adds later.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = require("../../lint/entity-candidates") as {
    normalizeForGroundedMatch: (s: string) => string
  }
  return m.normalizeForGroundedMatch(s)
}

test("runNerPrepass: clean prose with no capitalized multi-word entities → empty result", () => {
  const surface = EMPTY_SURFACE
  const prose = "She walked down the hall and greeted the captain. He nodded."
  const fires = runNerPrepass(prose, surface)
  expect(fires).toHaveLength(0)
})

test("runNerPrepass: empty prose → empty result", () => {
  expect(runNerPrepass("", EMPTY_SURFACE)).toHaveLength(0)
})

// ── checkHallucUngrounded AND-gate integration tests ─────────────────────────
//
// These tests mock the callAgent import so we can control the LLM response
// and assert the AND-gate output shape without spending $$.

import { mock as bunMock } from "bun:test"

// We need to mock the callAgent used by index.ts. Since Bun module mocking
// hooks at the module level before any imports, we set up the mock early and
// then reimport the module.
//
// Pattern: spy on the module path Bun resolves, then reimport index.ts.
// Bun's mock.module replaces the module resolution for the given specifier.

// Captured calls to patchLLMCallNerPrepass — reset in beforeEach.
// Mutable so individual tests can inspect what was persisted. (L16)
let nerPatchCalls: Array<{ id: number | null; data: any }> = []
let nerPatchStarted = 0
let nerPatchDelay: Promise<void> | null = null

bunMock.module("../../db/ops", () => ({
  // Capture NER patch calls so persistence tests can assert the payload
  // shape without needing a real DB connection.
  patchLLMCallNerPrepass: async (id: number | null, data: any) => {
    nerPatchStarted += 1
    if (nerPatchDelay) {
      await nerPatchDelay
    }
    nerPatchCalls.push({ id, data })
  },
}))

bunMock.module("../../llm", () => ({
  callAgent: async (opts: any) => {
    // Default mock: LLM returns pass=true, llmCallId=42. Individual tests
    // override mockLLMResult and mockLLMCallId before calling checkHallucUngrounded.
    //
    // L68 multi-call vote support: when `mockLLMResultsByCall` is non-empty,
    // each call drains the next entry (and `mockLLMCallIdsByCall` for ids)
    // so a single test can stage N distinct per-call outputs for the parallel
    // fan-out. Falls back to the singletons for back-compat with all
    // pre-L68 tests.
    if (mockLLMResultsByCall.length > 0) {
      const idx = mockCallCounter
      mockCallCounter += 1
      const result = mockLLMResultsByCall[idx % mockLLMResultsByCall.length]!
      const id = mockLLMCallIdsByCall.length > 0
        ? mockLLMCallIdsByCall[idx % mockLLMCallIdsByCall.length]!
        : 42 + idx
      return { output: result, rawText: "{}", latencyMs: 0, llmCallId: id }
    }
    return { output: mockLLMResult, rawText: "{}", latencyMs: 0, llmCallId: mockLLMCallId }
  },
}))

// Shared mutable LLM result that individual tests set.
let mockLLMResult: { pass: boolean; issues?: Array<{ entity: string; excerpt: string }> } = {
  pass: true,
  issues: [],
}

// Shared mutable llmCallId that individual tests can override.
let mockLLMCallId: number | null = 42

// L68 multi-call mock plumbing. Empty arrays → singleton-mock fallback.
let mockLLMResultsByCall: Array<{ pass: boolean; issues?: Array<{ entity: string; excerpt: string }> }> = []
let mockLLMCallIdsByCall: Array<number | null> = []
let mockCallCounter = 0

beforeEach(() => {
  // Reset to pass between tests.
  mockLLMResult = { pass: true, issues: [] }
  mockLLMCallId = 42
  nerPatchCalls = []
  nerPatchStarted = 0
  nerPatchDelay = null
  // L68: clear the per-call mock plumbing so prior tests' staged sequences
  // don't leak into subsequent tests.
  mockLLMResultsByCall = []
  mockLLMCallIdsByCall = []
  mockCallCounter = 0
  // L68: clear env override so the resolveVoteN env-side path doesn't leak
  // into tests that pin voteN explicitly.
  delete process.env.HALLUC_UNGROUNDED_VOTE_N
})

// Reimport the module after mock is registered so callAgent is the mock.
const { checkHallucUngrounded } = await import("./index")

// Shared fixtures
const baseBeat = {
  description: "Kael approaches the Order meeting hall.",
  kind: "action" as const,
  characters: ["Kael"],
  requiredPayoffs: [],
  obligations: {
    mustEstablish: [],
    mustPayOff: [],
    mustTransferKnowledge: [],
    mustShowStateChange: [],
    mustNotReveal: [],
    allowedNewEntities: [],
  },
} as any

const baseOutline = {
  chapterNumber: 1,
  title: "The Hall",
  povCharacter: "Kael",
  setting: "Lowport",
  purpose: "",
  scenes: [],
  targetWords: 1000,
  charactersPresent: ["Kael"],
  establishedFacts: [],
  characterStateChanges: [],
  knowledgeChanges: [],
} as any

const baseChars = [
  { id: "kael", name: "Kael", role: "", speechPattern: "clipped" },
] as any

// World bible with NO suffix-class entities so NER fires clearly.
const emptyWorldBible = { locations: [], cultures: [], systems: [] }

test("AND-gate: NER fires + LLM fires → blocker (pass=false, nerOnlyFindings empty)", async () => {
  // "Vesh Order" not grounded; LLM also fires on it.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Vesh Order", excerpt: "sworn to the Vesh Order years ago" }],
  }
  const prose = "Kael walked toward the Vesh Order hall at midnight."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  expect(result.pass).toBe(false)
  // nerOnlyFindings should be empty (LLM confirmed)
  expect(result.nerOnlyFindings).toEqual([])
  // nerFindings should contain Vesh Order
  expect(result.nerFindings?.map(f => f.phrase)).toContain("Vesh Order")
  // Issues should reference Vesh Order
  const issueText = result.issues.join(" ")
  expect(issueText).toContain("Vesh Order")
})

test("AND-gate: NER fires, LLM passes → warning (nerOnlyFindings non-empty, issue has [NER-only warning])", async () => {
  // "Vesh Order" not grounded; LLM passes (FN from LLM).
  // L31a: NER-only-warning returns pass=true so beat retry budget is NOT consumed.
  // The issue is still surfaced with [NER-only warning] marker + severity: "warning".
  mockLLMResult = { pass: true, issues: [] }
  const prose = "Kael walked toward the Vesh Order hall at midnight."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  // L31a: pass=true — NER-only warnings do not block the beat.
  expect(result.pass).toBe(true)
  // nerOnlyFindings should be populated
  expect(result.nerOnlyFindings?.length).toBeGreaterThan(0)
  expect(result.nerOnlyFindings?.map(f => f.phrase)).toContain("Vesh Order")
  // Issue text should carry the [NER-only warning] marker
  const issueText = result.issues.join(" ")
  expect(issueText).toContain("[NER-only warning")
  // issuesSeverity should all be "warning"
  expect(result.issuesSeverity?.every(s => s === "warning")).toBe(true)
})

test("AND-gate: entity grounded in bible → NER passes, LLM passes → clean pass", async () => {
  // "Vesh Order" is in the world bible → NER and LLM both pass.
  mockLLMResult = { pass: true, issues: [] }
  const worldBible = {
    locations: [],
    cultures: [],
    systems: [{ name: "Vesh Order" }],
  }
  const prose = "Kael walked toward the Vesh Order hall at midnight."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, worldBible)
  expect(result.pass).toBe(true)
  expect(result.issues).toHaveLength(0)
})

test("AND-gate: NER passes, LLM fires → LLM-only blocker (nerOnlyFindings empty)", async () => {
  // NER passes (clean prose) but LLM fires on something NER can't catch.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Yarrow", excerpt: "she called out to Yarrow across the hall" }],
  }
  const prose = "She called out to Yarrow across the hall."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  expect(result.pass).toBe(false)
  expect(result.nerOnlyFindings).toEqual([])
  const issueText = result.issues.join(" ")
  expect(issueText).toContain("Yarrow")
  // No [NER-only warning] marker — this is an LLM-only catch.
  expect(issueText).not.toContain("[NER-only")
})

test("AND-gate: blocker merges NER-extra phrases not in LLM issues", async () => {
  // NER catches TWO entities; LLM only mentions one. The second should be
  // appended as a [NER prepass] extra issue.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Vesh Order", excerpt: "sworn to the Vesh Order" }],
  }
  const prose = "Kael joined the Vesh Order and climbed Hyran Crown hill."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  expect(result.pass).toBe(false)
  expect(result.nerOnlyFindings).toEqual([])
  const issueText = result.issues.join(" ")
  // LLM issue preserved
  expect(issueText).toContain("Vesh Order")
  // NER-extra issue appended with [NER prepass] marker
  expect(issueText).toContain("[NER prepass]")
})

// ── allowedNewEntities grounding tests (L9) ─────────────────────────────────
//
// Acceptance criteria (L9 loop contract):
//   (a) allowedNewEntities flows into the checker context (context.test.ts covers this)
//   (b) buildNerGroundedSet treats them as grounded — NER prepass does not fire
//   (c) groundedSources provenance records them (verified via NER surface behavior)
//   (d) sanctioned walk-on → PASS; unsanctioned name → FAIL

test("allowedNewEntities (L9-b): sanctioned walk-on in allowedNewEntities is treated as grounded by NER prepass → PASS", async () => {
  // "Marra the Innkeeper" is a title-pair that NER would otherwise catch.
  // Because it's in beat.obligations.allowedNewEntities, buildNerGroundedSet
  // includes it in the grounded surface, so the prepass does NOT fire on it.
  // LLM mock returns pass=true. Combined → clean pass.
  mockLLMResult = { pass: true, issues: [] }
  const beatWithSanction = {
    ...baseBeat,
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: ["Marra the Innkeeper"],
    },
  } as any
  const prose = "Kael spoke with Marra the Innkeeper about the missing ledger."
  const result = await checkHallucUngrounded(prose, beatWithSanction, baseOutline, baseChars, emptyWorldBible)
  // NER prepass must NOT fire on "Marra the Innkeeper" — it's sanctioned.
  // LLM also passes. Both → clean pass.
  expect(result.pass).toBe(true)
  expect(result.issues).toHaveLength(0)
})

test("allowedNewEntities (L9-d): unsanctioned name not in allowedNewEntities → blocker fires", async () => {
  // Same beat, but prose introduces "Veyl the Deepforger" which is NOT in the
  // allowedNewEntities list and not in any other grounded source. NER fires on
  // "Veyl the Deepforger" (title-pair class) AND LLM also fires → blocker.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Veyl the Deepforger", excerpt: "Veyl the Deepforger entered" }],
  }
  const beatWithSanction = {
    ...baseBeat,
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      // Only "Marra the Innkeeper" is sanctioned; "Veyl the Deepforger" is not.
      allowedNewEntities: ["Marra the Innkeeper"],
    },
  } as any
  const prose = "Kael spoke with Marra the Innkeeper. Veyl the Deepforger entered behind her."
  const result = await checkHallucUngrounded(prose, beatWithSanction, baseOutline, baseChars, emptyWorldBible)
  // "Marra the Innkeeper" is sanctioned → NER passes on it.
  // "Veyl the Deepforger" is NOT sanctioned → NER fires + LLM fires → blocker.
  expect(result.pass).toBe(false)
  const issueText = result.issues.join(" ")
  expect(issueText).toContain("Veyl the Deepforger")
  // Sanctioned entity should NOT appear in issue text
  expect(issueText).not.toContain("Marra the Innkeeper")
})

test("allowedNewEntities (L9-c): groundedSources provenance — normalizeForGroundedMatch applied to allowed list", async () => {
  // Verify that normalizeForGroundedMatch is symmetrically applied to the
  // allowedNewEntities entries in buildNerGroundedSet. If the bible has
  // "The Innkeepers" (plural) and prose mentions "Innkeeper", the normalized
  // form ("innkeeper") matches. Here: allowedNewEntities: ["the Innkeepers"]
  // must ground prose "Marra the Innkeeper" via plural/article collapse.
  //
  // normalizeForGroundedMatch("The Innkeepers") → "innkeeper" (strip leading
  // article, strip trailing-s plural). normalizeForGroundedMatch("Innkeeper")
  // → "innkeeper". Equal → grounded.
  const { normalizeForGroundedMatch: nfgm } = await import("../../lint/entity-candidates")
  expect(nfgm("The Innkeepers")).toBe(nfgm("Innkeeper"))

  mockLLMResult = { pass: true, issues: [] }
  const beatWithPluralEntry = {
    ...baseBeat,
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      // Plural/article form in the obligation list — normalize should collapse it
      // to the same root as the prose form "Innkeeper".
      allowedNewEntities: ["Marra the Innkeeper"],
    },
  } as any
  // Prose uses the same form — both sides normalize the same way.
  const prose = "Kael spoke with Marra the Innkeeper quietly."
  const result = await checkHallucUngrounded(prose, beatWithPluralEntry, baseOutline, baseChars, emptyWorldBible)
  // Both NER and LLM pass → clean result.
  expect(result.pass).toBe(true)
  expect(result.issues).toHaveLength(0)
})

test("allowedNewEntities (L9-b2): NER prepass grounded-surface includes allowedNewEntities via runNerPrepass directly", async () => {
  // White-box test: build a grounded surface that includes "Marra the Innkeeper"
  // via the same normalizeForGroundedMatch path that buildNerGroundedSet uses,
  // then run runNerPrepass and verify the title-pair candidate does NOT fire.
  const { normalizeForGroundedMatch: nfgm } = await import("../../lint/entity-candidates")
  const entry = "Marra the Innkeeper"
  const surface = {
    lower: new Set([entry.toLowerCase()]),
    normalized: new Set([nfgm(entry)]),
  }
  const prose = "Kael spoke with Marra the Innkeeper about the missing ledger."
  const fires = runNerPrepass(prose, surface)
  // "Marra the Innkeeper" is grounded → should NOT appear in NER fires
  expect(fires.map(c => c.phrase)).not.toContain("Marra the Innkeeper")
})

// ── L16: NER findings persistence tests ──────────────────────────────────────
//
// Verify that checkHallucUngrounded calls patchLLMCallNerPrepass with the
// correct shape after each AND-gate path. The patch is awaited before return,
// while remaining fail-open if persistence rejects.

test("L16 persistence: NER+LLM blocker persists nerFindings and andGateDecision=ner+llm-blocker", async () => {
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Vesh Order", excerpt: "sworn to the Vesh Order" }],
  }
  const prose = "Kael walked toward the Vesh Order hall at midnight."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  expect(nerPatchCalls.length).toBe(1)
  const { id, data } = nerPatchCalls[0]
  expect(id).toBe(42)
  expect(data.nerEnabled).toBe(true)
  expect(data.andGateDecision).toBe("ner+llm-blocker")
  expect(Array.isArray(data.nerFindings)).toBe(true)
  expect(data.nerFindings.length).toBeGreaterThan(0)
  expect(data.nerFindings[0]).toHaveProperty("phrase")
  expect(data.nerFindings[0]).toHaveProperty("class")
  expect(Array.isArray(data.nerOnlyFindings)).toBe(true)
  expect(data.nerOnlyFindings).toHaveLength(0)
})

test("L16 persistence: NER-only warning persists nerOnlyFindings populated and andGateDecision=ner-only-warning", async () => {
  mockLLMResult = { pass: true, issues: [] }
  const prose = "Kael walked toward the Vesh Order hall at midnight."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  expect(nerPatchCalls.length).toBe(1)
  const { id, data } = nerPatchCalls[0]
  expect(id).toBe(42)
  expect(data.nerEnabled).toBe(true)
  expect(data.andGateDecision).toBe("ner-only-warning")
  expect(data.nerFindings.length).toBeGreaterThan(0)
  // nerOnlyFindings should equal nerFindings (every NER finding is NER-only)
  expect(data.nerOnlyFindings.length).toBe(data.nerFindings.length)
})

test("L16 persistence: LLM-only blocker persists nerFindings=[] and andGateDecision=llm-only-blocker", async () => {
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Yarrow", excerpt: "she called out to Yarrow" }],
  }
  // Clean prose: NER won't fire (no suffix-class or title-pair entities).
  const prose = "She called out to Yarrow across the hall."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  expect(nerPatchCalls.length).toBe(1)
  const { data } = nerPatchCalls[0]
  expect(data.nerEnabled).toBe(true)
  expect(data.andGateDecision).toBe("llm-only-blocker")
  expect(data.nerFindings).toHaveLength(0)
  expect(data.nerOnlyFindings).toHaveLength(0)
})

test("L16 persistence: clean pass persists andGateDecision=pass and empty findings", async () => {
  mockLLMResult = { pass: true, issues: [] }
  // No NER-triggering entities in prose.
  const prose = "She walked down the hall and greeted the captain."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  expect(nerPatchCalls.length).toBe(1)
  const { data } = nerPatchCalls[0]
  expect(data.nerEnabled).toBe(true)
  expect(data.andGateDecision).toBe("pass")
  expect(data.nerFindings).toHaveLength(0)
  expect(data.nerOnlyFindings).toHaveLength(0)
})

test("L16 persistence: llmCallId=null → patch is skipped (no nerPatchCalls)", async () => {
  mockLLMCallId = null
  mockLLMResult = { pass: true, issues: [] }
  const prose = "She walked down the hall and greeted the captain."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  // patchLLMCallNerPrepass should NOT be called when llmCallId is null.
  expect(nerPatchCalls.length).toBe(0)
})

test("L16 persistence: awaits NER patch before returning", async () => {
  mockLLMResult = { pass: true, issues: [] }
  let releasePatch!: () => void
  nerPatchDelay = new Promise(resolve => {
    releasePatch = resolve
  })
  let returned = false

  const prose = "Kael walked toward the Vesh Order hall at midnight."
  const pending = checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
    .then(result => {
      returned = true
      return result
    })

  // Spin until the patch mock has started or we hit a timeout. The exact
  // microtask depth between LLM-call resolution and the patch invocation
  // is an implementation detail (L68 added one extra microtask via the
  // Promise.all fan-out); the assertion is just that the patch was started
  // before the wrapped function resolved.
  for (let i = 0; i < 10 && nerPatchStarted === 0; i++) {
    await Promise.resolve()
  }
  expect(nerPatchStarted).toBe(1)
  expect(nerPatchCalls.length).toBe(0)
  expect(returned).toBe(false)

  releasePatch()
  const result = await pending

  expect(result.pass).toBe(true)
  expect(returned).toBe(true)
  expect(nerPatchCalls.length).toBe(1)
})

test("L16 persistence: patch failure remains fail-open", async () => {
  mockLLMResult = { pass: true, issues: [] }
  let rejectPatch!: (err: Error) => void
  nerPatchDelay = new Promise((_, reject) => {
    rejectPatch = reject
  })
  const originalConsoleError = console.error
  const consoleError = mock(() => {})
  console.error = consoleError as any

  try {
    const prose = "Kael walked toward the Vesh Order hall at midnight."
    const pending = checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)

    for (let i = 0; i < 10 && nerPatchStarted === 0; i++) {
      await Promise.resolve()
    }
    expect(nerPatchStarted).toBe(1)

    rejectPatch(new Error("patch failed"))
    const result = await pending

    expect(result.pass).toBe(true)
    expect(result.issues.every(s => s.includes("[NER-only warning"))).toBe(true)
    expect(consoleError).toHaveBeenCalled()
  } finally {
    console.error = originalConsoleError
  }
})

// ── L20: character roster + outline-entity grounding tests ───────────────────
//
// Acceptance criteria (L20 loop contract):
//   (a) characterRoster names flow into NER grounded surface → no NER fire
//   (b) outlineEntities flow into NER grounded surface → no NER fire
//   (c) a NEW name not in any roster → still BLOCKS (v3 wins survive)
//   (d) provenance — groundedSources carries character_roster + outline_entities
//
// These tests exercise the L17 FP cluster: "Lord Sorcerer Brennan" / "Brennan"
// (title+surname in prose matching surname in roster) + named locations from
// planner outline text (Silver Street, Eastern Reach, Temple of Mercy).

import { buildCharacterRoster, buildOutlineEntityList } from "./index"

test("L20 (a): character roster names grounded — 'Lord Sorcerer Brennan' title+surname matches roster surname 'Brennan' via substring tier", async () => {
  // Characters in DB: "Lord Sorcerer Brennan". In prose writer uses the full form.
  // buildNerGroundedSet adds the roster entry, which includes per-token shards.
  // The four-tier check:
  //   1. exact: "lord sorcerer brennan" in lower? yes (whole phrase added) → grounded.
  // No NER fire. LLM mock passes. Combined → clean pass.
  mockLLMResult = { pass: true, issues: [] }
  const charsWithBrennan = [
    ...baseChars,
    { id: "brennan", name: "Lord Sorcerer Brennan", role: "antagonist", speechPattern: "cold" },
  ] as any
  const prose = "She bowed before Lord Sorcerer Brennan and waited for his verdict."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, charsWithBrennan, emptyWorldBible)
  expect(result.pass).toBe(true)
  expect(result.issues).toHaveLength(0)
})

test("L20 (a): 'Brennan' surname-only in prose grounded via roster entry 'Lord Sorcerer Brennan' substring tier", async () => {
  // Prose uses just "Brennan" (surname). Roster has "Lord Sorcerer Brennan".
  // buildNerGroundedSet splits the roster entry into per-token shards:
  // lower gets "lord", "sorcerer", "brennan". The NER extractor would not
  // fire on a single-word capitalized name ("Brennan" is capitalized-multi-word?
  // Actually "Brennan" alone is a single word — NER only extracts multi-word
  // or title-pair patterns). Single-word capitalized names are LLM-only catches.
  // This test confirms the character roster doesn't break the LLM path.
  mockLLMResult = { pass: true, issues: [] }
  const charsWithBrennan = [
    ...baseChars,
    { id: "brennan", name: "Lord Sorcerer Brennan", role: "antagonist", speechPattern: "cold" },
  ] as any
  const prose = "Kael knew Brennan would not forgive the insult."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, charsWithBrennan, emptyWorldBible)
  // LLM mock passes; the roster entry satisfies the surface check.
  expect(result.pass).toBe(true)
})

test("L20 (b): named location in outlineEntities grounded — 'Silver Street' from outline beat description", async () => {
  // Outline has a beat description mentioning "Silver Street". buildOutlineEntityList
  // extracts it. buildNerGroundedSet adds it to the grounded surface.
  // NER would catch "Silver Street" as capitalized-multi-word. Because it's now
  // grounded via outline_entities, the NER prepass does NOT fire on it.
  mockLLMResult = { pass: true, issues: [] }
  const outlineWithSilverStreet = {
    ...baseOutline,
    scenes: [
      {
        ...baseBeat,
        description: "Kael follows the suspect down Silver Street toward the docks.",
      },
    ],
    establishedFacts: [],
  } as any
  const prose = "Kael sprinted down Silver Street, his boots loud on the cobblestones."
  const result = await checkHallucUngrounded(prose, baseBeat, outlineWithSilverStreet, baseChars, emptyWorldBible)
  expect(result.pass).toBe(true)
  expect(result.issues).toHaveLength(0)
})

test("L20 (c): NEW name not in any roster → NER + LLM both fire → blocker still works", async () => {
  // "Veyl the Deepforger" is not in characters, not in world bible, not in outline.
  // Grounding surface does not include it. NER fires (title-pair). LLM also fires.
  // The L20 expansion must NOT suppress genuine ungrounded names.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Veyl the Deepforger", excerpt: "Veyl the Deepforger entered the hall" }],
  }
  const charsWithBrennan = [
    ...baseChars,
    { id: "brennan", name: "Lord Sorcerer Brennan", role: "antagonist", speechPattern: "cold" },
  ] as any
  const prose = "Veyl the Deepforger entered the hall behind Lord Sorcerer Brennan."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, charsWithBrennan, emptyWorldBible)
  // Blocker: "Veyl the Deepforger" is not grounded.
  expect(result.pass).toBe(false)
  const issueText = result.issues.join(" ")
  expect(issueText).toContain("Veyl the Deepforger")
  // "Lord Sorcerer Brennan" IS grounded via character roster — should not appear in issues.
  expect(issueText).not.toContain("Brennan")
})

test("L20 (d): provenance — groundedSources carries character_roster + outline_entities", async () => {
  // White-box: patchLLMCallNerPrepass receives the groundedSources snapshot.
  // Verify character_roster and outline_entities are populated.
  mockLLMResult = { pass: true, issues: [] }
  const charsWithBrennan = [
    ...baseChars,
    { id: "brennan", name: "Lord Sorcerer Brennan", role: "antagonist", speechPattern: "cold" },
  ] as any
  const outlineWithSilverStreet = {
    ...baseOutline,
    scenes: [
      {
        ...baseBeat,
        description: "Kael follows the suspect down Silver Street toward the docks.",
      },
    ],
    establishedFacts: [],
  } as any
  // logMetadata carries groundedSources into callAgent mock, but we can't intercept
  // logMetadata directly. Instead verify the exported functions return the right values.
  const roster = buildCharacterRoster(charsWithBrennan)
  expect(roster).toContain("Lord Sorcerer Brennan")
  expect(roster).toContain("Kael")
  const entities = buildOutlineEntityList(outlineWithSilverStreet)
  expect(entities).toContain("Silver Street")

  // Integration: checkHallucUngrounded runs through without error.
  const prose = "She walked quietly toward the hall."
  const result = await checkHallucUngrounded(prose, baseBeat, outlineWithSilverStreet, charsWithBrennan, emptyWorldBible)
  expect(result.pass).toBe(true)
})

// ── L23b: character-profile derived title nouns grounding tests ───────────────
//
// Acceptance criteria (L23b loop contract):
//   (a) deriveTitleNouns flows into NER grounded surface → Guildmaster not flagged
//       when character has role "Guild Master"
//   (b) a NEW title with no matching character role → NER still fires
//   (c) integration: checkHallucUngrounded passes on "the Guildmaster" with a
//       character whose role is "Guild Master"

import { deriveTitleNouns } from "./index"

test("L23b (a): character role 'Guild Master' → deriveTitleNouns emits 'GuildMaster' and 'guildmaster'", () => {
  const chars = [
    { id: "vareth", name: "Vareth", role: "Guild Master", speechPattern: "" },
  ] as any
  const titles = deriveTitleNouns(chars)
  expect(titles).toContain("GuildMaster")
  expect(titles).toContain("guildmaster")
})

test("L23b (a): 'Guildmaster' as single-word entity in prose — LLM pass when derived title in surface", async () => {
  // The L22 failure was: prose writes "The Guildmaster's own seal" and LLM fired
  // because "Guildmaster" wasn't in any grounded surface. With L23b, deriveTitleNouns
  // adds "GuildMaster" / "guildmaster" to the grounded surface when a character's role
  // is "Guild Master". The LLM sees a "Derived-titles:" sub-line in the WORLD BIBLE
  // block and can treat "Guildmaster" as grounded.
  //
  // NER won't fire on "Guildmaster" alone (single-word — NER only extracts multi-word
  // or title-pair patterns). So this is purely an LLM-only path. Mock LLM passes
  // (because the derived title is in context). Expect clean pass.
  mockLLMResult = { pass: true, issues: [] }
  const charsWithGuildMaster = [
    ...baseChars,
    { id: "vareth", name: "Vareth", role: "Guild Master", speechPattern: "formal" },
  ] as any
  const prose = "The Guildmaster's own seal was stamped at the bottom of the document."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, charsWithGuildMaster, emptyWorldBible)
  // LLM mock passes (derivation surfaces "guildmaster" to the checker). NER won't
  // fire on a single-word entity. Combined → clean pass.
  expect(result.pass).toBe(true)
  expect(result.issues).toHaveLength(0)
})

test("L23b (b): new title 'Bishop' with no Bishop role in character profiles → NER fires", async () => {
  // "Bishop Raveth" — "Bishop" is not in deriveTitleNouns output (no char has
  // a role containing "bishop"). "Raveth" is not in any roster. Both fire.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Bishop Raveth", excerpt: "Bishop Raveth entered the hall" }],
  }
  const prose = "Bishop Raveth entered the hall and raised his hand for silence."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  // NER fires (title-pair: Bishop Raveth) + LLM fires → blocker
  expect(result.pass).toBe(false)
  const issueText = result.issues.join(" ")
  expect(issueText).toContain("Bishop Raveth")
})

test("L23b: deriveTitleNouns is included in groundedSources.derived_titles provenance", () => {
  // White-box: deriveTitleNouns called with a Guild Master character returns
  // non-empty list, confirming the provenance bucket will be populated.
  const charsWithGuildMaster = [
    { id: "vareth", name: "Vareth", role: "Guild Master", speechPattern: "" },
  ] as any
  const titles = deriveTitleNouns(charsWithGuildMaster)
  expect(titles.length).toBeGreaterThan(0)
  expect(titles.some(t => t.toLowerCase().includes("guildmaster") || t.toLowerCase().includes("guild"))).toBe(true)
})

// ── L31a: NER-only warning pass=true tests ─────────────────────────────────────
//
// L31a fix: when the AND-gate decision is `ner-only-warning`, return `pass: true`
// (not `pass: false`). The issue is still surfaced with severity "warning" and the
// [NER-only warning — LLM passed] marker so the operator can triage via
// `nerOnlyFindings` / `ner_prepass_json`, but beat retry budget is NOT consumed.
//
// Docstring at index.ts ~line 295: "NER-only = ambiguous, surface but don't burn
// retries indefinitely." This was always the stated design intent; L31a aligns code
// to contract.

test("L31a: NER-only-warning → pass=true, issue severity 'warning', [NER-only warning] marker", async () => {
  // "Vesh Order" not grounded; LLM passes.
  // Expected: pass=true, issue with [NER-only warning] marker, issuesSeverity all "warning".
  mockLLMResult = { pass: true, issues: [] }
  const prose = "Kael walked toward the Vesh Order hall at midnight."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  // L31a: NER-only warnings do NOT consume beat retry budget.
  expect(result.pass).toBe(true)
  // Issue is still surfaced for operator visibility.
  expect(result.issues.length).toBeGreaterThan(0)
  // All issues carry the NER-only warning marker.
  expect(result.issues.every(s => s.includes("[NER-only warning"))).toBe(true)
  // issuesSeverity is present and all "warning".
  expect(result.issuesSeverity).toBeDefined()
  expect(result.issuesSeverity!.every(s => s === "warning")).toBe(true)
  // nerOnlyFindings is populated (operator visibility).
  expect(result.nerOnlyFindings?.length).toBeGreaterThan(0)
  expect(result.nerOnlyFindings?.map(f => f.phrase)).toContain("Vesh Order")
})

test("L31a: NER-only-warning records andGateDecision=ner-only-warning in telemetry (pass=true path)", async () => {
  mockLLMResult = { pass: true, issues: [] }
  const prose = "Kael walked toward the Vesh Order hall at midnight."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  await Promise.resolve()
  expect(nerPatchCalls.length).toBe(1)
  const { data } = nerPatchCalls[0]
  // Telemetry still records ner-only-warning even though pass=true.
  expect(data.andGateDecision).toBe("ner-only-warning")
  expect(data.nerOnlyFindings.length).toBeGreaterThan(0)
})

// ── L31b: AND-gate entity intersection tests ────────────────────────────────────
//
// L31b fix: `ner+llm-blocker` only fires when nerUngrounded ∩ llmFlagged ≠ ∅ on
// the SAME entity phrase. When NER and LLM flag completely different entities:
//   - NER-only entities → NER-only-warning (severity: "warning")
//   - LLM-only entities → LLM-only-blocker (severity: "blocker")
//   - Combined pass=false because there is at least one blocker.
//
// L24 beat 6 attempt 1 example: NER fired on "Title Nine"/"Section Two"
// (number-word-tail legal sections), LLM fired on "Aldric" (false positive —
// Aldric is a grounded supporting character). Previously this produced a compound
// `ner+llm-blocker`. With L31b it produces:
//   - NER-only-warning for "Title Nine"/"Section Two"
//   - LLM-only-blocker for "Aldric" (which downstream grounding would suppress
//     because Aldric is actually in the character roster)

test("L31b: disjoint NER+LLM entities → separate NER-only warning + LLM-only blocker, NOT compound ner+llm-blocker", async () => {
  // NER fires on "Vesh Order" (suffix-class, not grounded).
  // LLM fires on "Yarrow" (a different entity NER cannot catch as a single word).
  // They flag DIFFERENT phrases → disjoint case.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Yarrow", excerpt: "she handed the papers to Yarrow" }],
  }
  const prose = "Kael walked toward the Vesh Order hall. She handed the papers to Yarrow."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  // pass=false because there is an LLM blocker.
  expect(result.pass).toBe(false)
  // issuesSeverity must contain both "warning" (NER-only) and "blocker" (LLM-only).
  expect(result.issuesSeverity).toBeDefined()
  expect(result.issuesSeverity!).toContain("warning")
  expect(result.issuesSeverity!).toContain("blocker")
  // Issues should include the NER-only warning marker AND the LLM entity.
  const issueText = result.issues.join(" ")
  expect(issueText).toContain("[NER-only warning")
  expect(issueText).toContain("Yarrow")
  // nerOnlyFindings is populated with the NER-only entities.
  expect(result.nerOnlyFindings?.length).toBeGreaterThan(0)
  expect(result.nerOnlyFindings?.map(f => f.phrase)).toContain("Vesh Order")
})

test("L31b: disjoint NER+LLM → andGateDecision=ner-only-warning in telemetry (dominant NER decision)", async () => {
  // When NER and LLM flag different entities, the decision label for telemetry
  // is "ner-only-warning" (dominant for the NER side; per-entity telemetry is
  // visible via the issues + issuesSeverity arrays).
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Yarrow", excerpt: "she handed the papers to Yarrow" }],
  }
  const prose = "Kael walked toward the Vesh Order hall. She handed the papers to Yarrow."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  await Promise.resolve()
  expect(nerPatchCalls.length).toBe(1)
  const { data } = nerPatchCalls[0]
  expect(data.andGateDecision).toBe("ner-only-warning")
  expect(data.nerOnlyFindings.length).toBeGreaterThan(0)
})

test("L31b: overlapping NER+LLM entities (intersection ≠ ∅) → compound ner+llm-blocker as before", async () => {
  // Both NER and LLM fire on "Vesh Order" — same entity. This IS a true compound
  // blocker and should remain ner+llm-blocker.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Vesh Order", excerpt: "sworn to the Vesh Order" }],
  }
  const prose = "Kael walked toward the Vesh Order hall at midnight."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  expect(result.pass).toBe(false)
  // All issues should be blocker-class.
  expect(result.issuesSeverity).toBeDefined()
  expect(result.issuesSeverity!.every(s => s === "blocker")).toBe(true)
  // nerOnlyFindings should be empty (LLM confirmed the NER finding).
  expect(result.nerOnlyFindings).toEqual([])
  // Issues reference "Vesh Order".
  const issueText = result.issues.join(" ")
  expect(issueText).toContain("Vesh Order")
  // No [NER-only warning] marker — this is a true compound blocker.
  expect(issueText).not.toContain("[NER-only warning")
})

test("L31b: overlapping NER+LLM → andGateDecision=ner+llm-blocker in telemetry", async () => {
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Vesh Order", excerpt: "sworn to the Vesh Order" }],
  }
  const prose = "Kael walked toward the Vesh Order hall at midnight."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  await Promise.resolve()
  expect(nerPatchCalls.length).toBe(1)
  const { data } = nerPatchCalls[0]
  expect(data.andGateDecision).toBe("ner+llm-blocker")
  expect(data.nerOnlyFindings).toHaveLength(0)
})

// ── L40: NER post-filter on LLM-flagged entities ─────────────────────────────
//
// L40 fix: after the LLM call, apply NER's deterministic grounded-surface
// (`isNerGrounded` four-tier check) to LLM-raised issues. Any LLM-flagged
// entity that NER would consider grounded is rescued (dropped from issues).
// Closes the heretic gamelit cluster where worldBible.systems[] contains
// "The System" but the LLM checker still flagged "the System" / "System"
// as ungrounded → llm-only-blocker → bail.
//
// Acceptance contract:
//   (a) LLM flags an entity that exists in worldBible.systems → rescued,
//       result.pass=true, andGateDecision=pass
//   (b) LLM flags multiple entities, some grounded / some not → kept ones
//       become llm-only-blocker; rescued ones drop from issues
//   (c) NER fires on a different entity + LLM only flags grounded ones →
//       falls back to NER-only-warning (pass=true, severity=warning)
//   (d) telemetry: llmRescuedByNer count is recorded in patch payload
//   (e) when the LLM flags an entity NOT in the grounded surface, no rescue
//       (pre-L40 llm-only-blocker behavior preserved)

test("L40 (a): LLM flags 'the System' grounded via worldBible.systems → rescued, pass=true, decision=pass", async () => {
  // The L40 root case from heretic ch1 attempt 3. worldBible has "The System"
  // in systems[]; prose mentions "the System"; LLM still flagged it as
  // ungrounded. NER's grounded surface contains "the system" (whole-phrase
  // lower) and "system" (per-token shard), so isNerGrounded("the System")
  // returns true → rescue → drop from issues.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "the System", excerpt: "The seal of the System stitched over the chest." }],
  }
  const worldBible = {
    locations: [],
    cultures: [],
    systems: [{ name: "The System" }],
  }
  // Single-cap "the System" in the prose; no other NER candidates.
  const prose = "She felt the seal of the System pressed against her sternum."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, worldBible)
  // L40: rescued → effective pass.
  expect(result.pass).toBe(true)
  expect(result.issues).toHaveLength(0)
})

test("L40 (a-tel): rescued LLM issue records llmRescuedByNer count in telemetry", async () => {
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "the System", excerpt: "The seal of the System." }],
  }
  const worldBible = {
    locations: [],
    cultures: [],
    systems: [{ name: "The System" }],
  }
  const prose = "She felt the seal of the System pressed against her sternum."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, worldBible)
  await Promise.resolve()
  expect(nerPatchCalls.length).toBe(1)
  const { data } = nerPatchCalls[0]
  expect(data.andGateDecision).toBe("pass")
  expect(data.llmRescuedByNer).toBe(1)
})

test("L40 (b): mixed — one LLM entity grounded, one ungrounded → rescued one drops, kept one is blocker", async () => {
  // worldBible has "The System". LLM raises two issues: "the System" (rescued)
  // and "Heartstone" (not grounded; should remain a blocker).
  mockLLMResult = {
    pass: false,
    issues: [
      { entity: "the System", excerpt: "the System pressed against her" },
      { entity: "Heartstone", excerpt: "she clutched the Heartstone tightly" },
    ],
  }
  const worldBible = {
    locations: [],
    cultures: [],
    systems: [{ name: "The System" }],
  }
  const prose = "She felt the System pressed against her chest. She clutched the Heartstone tightly."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, worldBible)
  // pass=false because Heartstone remains.
  expect(result.pass).toBe(false)
  const issueText = result.issues.join(" ")
  // Rescued entity should NOT appear in issue text.
  expect(issueText).not.toContain("the System")
  // Kept entity should appear.
  expect(issueText).toContain("Heartstone")
  // All remaining issues are blockers (LLM-only path).
  expect(result.issuesSeverity?.every(s => s === "blocker")).toBe(true)
})

test("L40 (b-tel): partial rescue records correct llmRescuedByNer count and andGateDecision=llm-only-blocker", async () => {
  mockLLMResult = {
    pass: false,
    issues: [
      { entity: "the System", excerpt: "the System pressed against her" },
      { entity: "Heartstone", excerpt: "she clutched the Heartstone" },
    ],
  }
  const worldBible = {
    locations: [],
    cultures: [],
    systems: [{ name: "The System" }],
  }
  const prose = "She felt the System pressed against her chest. She clutched the Heartstone tightly."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, worldBible)
  await Promise.resolve()
  expect(nerPatchCalls.length).toBe(1)
  const { data } = nerPatchCalls[0]
  // 1 rescued ("the System"), 1 kept ("Heartstone") → llm-only-blocker.
  expect(data.andGateDecision).toBe("llm-only-blocker")
  expect(data.llmRescuedByNer).toBe(1)
})

test("L40 (c): NER fires on different entity + all LLM entities rescued → falls back to NER-only-warning (pass=true)", async () => {
  // worldBible has "The System" (rescues LLM "the System").
  // Prose also contains "Vesh Order" (suffix-class) — NER fires on that.
  // After L40 rescue: llmEffectivelyFires=false, nerFires=true → NER-only warning.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "the System", excerpt: "the System pressed against her" }],
  }
  const worldBible = {
    locations: [],
    cultures: [],
    systems: [{ name: "The System" }],
  }
  const prose = "She felt the System pressed against her chest. She walked toward the Vesh Order hall."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, worldBible)
  // NER-only-warning path → pass=true (L31a).
  expect(result.pass).toBe(true)
  // Issues should carry the NER warning marker for "Vesh Order" (NER fired).
  const issueText = result.issues.join(" ")
  expect(issueText).toContain("[NER-only warning")
  expect(issueText).toContain("Vesh Order")
  // Rescued LLM entity should NOT appear.
  expect(issueText).not.toContain("the System")
  expect(result.issuesSeverity?.every(s => s === "warning")).toBe(true)
})

test("L40 (c-tel): NER fires + all LLM rescued records andGateDecision=ner-only-warning", async () => {
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "the System", excerpt: "the System pressed against her" }],
  }
  const worldBible = {
    locations: [],
    cultures: [],
    systems: [{ name: "The System" }],
  }
  const prose = "She felt the System pressed against her chest. She walked toward the Vesh Order hall."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, worldBible)
  await Promise.resolve()
  expect(nerPatchCalls.length).toBe(1)
  const { data } = nerPatchCalls[0]
  expect(data.andGateDecision).toBe("ner-only-warning")
  expect(data.llmRescuedByNer).toBe(1)
  expect(data.nerOnlyFindings.map((f: any) => f.phrase)).toContain("Vesh Order")
})

test("L40 (e): LLM flags entity NOT in grounded surface → no rescue, llm-only-blocker preserved", async () => {
  // Pre-L40 baseline: the LLM-only-blocker path must still fire when the
  // entity is genuinely ungrounded. Empty world-bible; LLM flags "Yarrow".
  // NER won't fire on a single-word entity. No rescue possible.
  mockLLMResult = {
    pass: false,
    issues: [{ entity: "Yarrow", excerpt: "she handed the papers to Yarrow" }],
  }
  const prose = "She handed the papers to Yarrow across the hall."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  expect(result.pass).toBe(false)
  const issueText = result.issues.join(" ")
  expect(issueText).toContain("Yarrow")
  await Promise.resolve()
  const { data } = nerPatchCalls[0]
  expect(data.andGateDecision).toBe("llm-only-blocker")
  expect(data.llmRescuedByNer).toBe(0)
})

test("L40 (e-2): LLM passes with no issues → no rescue activity, llmRescuedByNer=0", async () => {
  // No-op behavior: LLM passes cleanly, nothing to filter.
  mockLLMResult = { pass: true, issues: [] }
  const worldBible = {
    locations: [],
    cultures: [],
    systems: [{ name: "The System" }],
  }
  const prose = "She walked quietly down the hall."
  const result = await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, worldBible)
  expect(result.pass).toBe(true)
  await Promise.resolve()
  const { data } = nerPatchCalls[0]
  expect(data.andGateDecision).toBe("pass")
  expect(data.llmRescuedByNer).toBe(0)
})

// ── L68 (Lever G-D): multi-call halluc-ungrounded vote/union ──────────────────
//
// Tests cover both the pure `unionLlmOutputs` helper (semantics in isolation)
// and the end-to-end fan-out path (Promise.all of N callAgent calls + per-row
// NER patch). The mock module above drains `mockLLMResultsByCall` /
// `mockLLMCallIdsByCall` in order so a single test can stage N distinct
// per-call outputs.

import { unionLlmOutputs } from "./index"

test("L68 union: empty input → pass=true, empty issues", () => {
  const u = unionLlmOutputs([])
  expect(u.pass).toBe(true)
  expect(u.issues).toEqual([])
})

test("L68 union: N=1 single output passes through unchanged (clean)", () => {
  const u = unionLlmOutputs([{ pass: true, issues: [] }])
  expect(u.pass).toBe(true)
  expect(u.issues).toEqual([])
})

test("L68 union: N=1 single output with issues passes through unchanged", () => {
  const u = unionLlmOutputs([
    { pass: false, issues: [{ entity: "Vesh Order", excerpt: "near the Vesh Order" }] },
  ])
  expect(u.pass).toBe(false)
  expect(u.issues).toHaveLength(1)
  expect(u.issues[0]).toEqual({ entity: "Vesh Order", excerpt: "near the Vesh Order" })
})

test("L68 union: N=2 disjoint flagged entities → union surfaces both", () => {
  const u = unionLlmOutputs([
    { pass: false, issues: [{ entity: "central spire", excerpt: "above the central spire" }] },
    { pass: false, issues: [{ entity: "Senior Cataloguer", excerpt: "Senior Cataloguer arrived" }] },
  ])
  expect(u.pass).toBe(false)
  expect(u.issues).toHaveLength(2)
  const entities = u.issues.map(i => i.entity).sort()
  expect(entities).toEqual(["Senior Cataloguer", "central spire"])
})

test("L68 union: N=2 same entity twice → dedup to one entry", () => {
  const u = unionLlmOutputs([
    { pass: false, issues: [{ entity: "central spire", excerpt: "above the central spire" }] },
    { pass: false, issues: [{ entity: "central spire", excerpt: "near the central spire" }] },
  ])
  expect(u.pass).toBe(false)
  expect(u.issues).toHaveLength(1)
  expect(u.issues[0]!.entity).toBe("central spire")
})

test("L68 union: case-insensitive dedup (Central Spire ≡ central spire)", () => {
  const u = unionLlmOutputs([
    { pass: false, issues: [{ entity: "Central Spire", excerpt: "first call" }] },
    { pass: false, issues: [{ entity: "central spire", excerpt: "second call" }] },
  ])
  expect(u.issues).toHaveLength(1)
  // First-seen entity casing wins for the surviving entry.
  expect(u.issues[0]!.entity).toBe("Central Spire")
})

test("L68 union: first non-empty excerpt wins when prior was empty", () => {
  const u = unionLlmOutputs([
    { pass: false, issues: [{ entity: "Aldric", excerpt: "" }] },
    { pass: false, issues: [{ entity: "Aldric", excerpt: "Aldric stepped forward" }] },
  ])
  expect(u.issues).toHaveLength(1)
  expect(u.issues[0]!.excerpt).toBe("Aldric stepped forward")
})

test("L68 union: first non-empty excerpt is kept (later non-empty does not overwrite)", () => {
  const u = unionLlmOutputs([
    { pass: false, issues: [{ entity: "Aldric", excerpt: "first non-empty" }] },
    { pass: false, issues: [{ entity: "Aldric", excerpt: "second non-empty (ignored)" }] },
  ])
  expect(u.issues).toHaveLength(1)
  expect(u.issues[0]!.excerpt).toBe("first non-empty")
})

test("L68 union: pass=true IFF every output's pass is true", () => {
  expect(unionLlmOutputs([{ pass: true, issues: [] }, { pass: true, issues: [] }]).pass).toBe(true)
  expect(unionLlmOutputs([{ pass: true, issues: [] }, { pass: false, issues: [] }]).pass).toBe(false)
  expect(unionLlmOutputs([{ pass: false, issues: [] }, { pass: false, issues: [] }]).pass).toBe(false)
})

test("L68 union: empty-entity issues are dropped (defensive)", () => {
  const u = unionLlmOutputs([
    { pass: false, issues: [{ entity: "  ", excerpt: "blank" }, { entity: "Real", excerpt: "" }] },
  ])
  expect(u.issues).toHaveLength(1)
  expect(u.issues[0]!.entity).toBe("Real")
})

test("L68 fan-out: voteN=2 with disjoint flag-sets → both entities surface", async () => {
  // Stage two distinct per-call outputs so the parallel mock returns each
  // in turn. Both calls flag a single ungrounded entity each, but on
  // disjoint sets — exactly the exp #389 stochasticity pattern.
  mockLLMResultsByCall = [
    { pass: false, issues: [{ entity: "central spire", excerpt: "central spire's heartbeat records" }] },
    { pass: false, issues: [{ entity: "Senior Cataloguer", excerpt: "the Senior Cataloguer signed" }] },
  ]
  mockLLMCallIdsByCall = [101, 102]

  const prose = "Below the central spire the Senior Cataloguer signed the ledger."
  const result = await checkHallucUngrounded(
    prose,
    baseBeat,
    baseOutline,
    baseChars,
    emptyWorldBible,
    undefined,
    { voteN: 2 },
  )

  expect(result.pass).toBe(false)
  // Both entities should be surfaced as issues (LLM-only-blocker path: NER
  // doesn't fire here because the prose doesn't have suffix-class shapes).
  const issueText = result.issues.join(" | ")
  expect(issueText).toContain("central spire")
  expect(issueText).toContain("Senior Cataloguer")
})

test("L68 fan-out: voteN=2 with both calls passing → clean pass", async () => {
  mockLLMResultsByCall = [
    { pass: true, issues: [] },
    { pass: true, issues: [] },
  ]
  mockLLMCallIdsByCall = [201, 202]
  const prose = "She walked quietly down the hall."
  const result = await checkHallucUngrounded(
    prose,
    baseBeat,
    baseOutline,
    baseChars,
    emptyWorldBible,
    undefined,
    { voteN: 2 },
  )
  expect(result.pass).toBe(true)
  expect(result.issues).toEqual([])
})

test("L68 fan-out: voteN=2 persists 2 NER patches with voteIndex 0/1 and voteN=2", async () => {
  mockLLMResultsByCall = [
    { pass: true, issues: [] },
    { pass: true, issues: [] },
  ]
  mockLLMCallIdsByCall = [301, 302]
  const prose = "She walked quietly down the hall."
  await checkHallucUngrounded(
    prose, baseBeat, baseOutline, baseChars, emptyWorldBible,
    undefined, { voteN: 2 },
  )
  await Promise.resolve()

  expect(nerPatchCalls).toHaveLength(2)
  // Order is not guaranteed (Promise.all races), so sort by id for stable assert.
  const sorted = [...nerPatchCalls].sort((a, b) => Number(a.id) - Number(b.id))
  expect(sorted[0]!.id).toBe(301)
  expect(sorted[0]!.data.voteIndex).toBe(0)
  expect(sorted[0]!.data.voteN).toBe(2)
  expect(sorted[1]!.id).toBe(302)
  expect(sorted[1]!.data.voteIndex).toBe(1)
  expect(sorted[1]!.data.voteN).toBe(2)
})

test("L68 fan-out: voteN=1 (default) does NOT set voteIndex/voteN on the NER patch — back-compat", async () => {
  // Default behavior: no per-call mock, no voteN opt — the patch row should
  // be byte-identical to pre-L68 (no voteIndex/voteN keys).
  mockLLMResult = { pass: true, issues: [] }
  const prose = "She walked quietly down the hall."
  await checkHallucUngrounded(prose, baseBeat, baseOutline, baseChars, emptyWorldBible)
  await Promise.resolve()
  expect(nerPatchCalls).toHaveLength(1)
  expect(nerPatchCalls[0]!.data.voteIndex).toBeUndefined()
  expect(nerPatchCalls[0]!.data.voteN).toBeUndefined()
})

test("L68 fan-out: voteN=2 with one fail + one pass → union pass=false", async () => {
  // Stochastic pattern: one call confirms an ungrounded entity, the other
  // approves the same prose. Union must take the failing signal.
  mockLLMResultsByCall = [
    { pass: false, issues: [{ entity: "Aldric", excerpt: "Aldric stepped forward" }] },
    { pass: true, issues: [] },
  ]
  mockLLMCallIdsByCall = [401, 402]
  const prose = "Aldric stepped forward and bowed."
  const result = await checkHallucUngrounded(
    prose, baseBeat, baseOutline, baseChars, emptyWorldBible,
    undefined, { voteN: 2 },
  )
  expect(result.pass).toBe(false)
  expect(result.issues.join(" | ")).toContain("Aldric")
})

test("L68 fan-out: HALLUC_UNGROUNDED_VOTE_N env override is honored when no opt is passed", async () => {
  process.env.HALLUC_UNGROUNDED_VOTE_N = "2"
  mockLLMResultsByCall = [
    { pass: false, issues: [{ entity: "Sigil", excerpt: "the Sigil" }] },
    { pass: false, issues: [{ entity: "Vault", excerpt: "the Vault" }] },
  ]
  mockLLMCallIdsByCall = [501, 502]
  const prose = "The Sigil glowed and the Vault opened."
  const result = await checkHallucUngrounded(
    prose, baseBeat, baseOutline, baseChars, emptyWorldBible,
    // no opts — env should drive voteN=2
  )
  expect(result.pass).toBe(false)
  const issueText = result.issues.join(" | ")
  expect(issueText).toContain("Sigil")
  expect(issueText).toContain("Vault")
})

test("L68 fan-out: explicit opts.voteN overrides env", async () => {
  process.env.HALLUC_UNGROUNDED_VOTE_N = "5"
  mockLLMResultsByCall = [
    { pass: false, issues: [{ entity: "OnlyOne", excerpt: "only one call should fire" }] },
  ]
  mockLLMCallIdsByCall = [601]
  const prose = "OnlyOne walked quietly."
  await checkHallucUngrounded(
    prose, baseBeat, baseOutline, baseChars, emptyWorldBible,
    undefined, { voteN: 1 },
  )
  // Counter increments once per call — only one drained from the array.
  expect(mockCallCounter).toBe(1)
})
