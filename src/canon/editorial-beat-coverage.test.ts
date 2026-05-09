/**
 * Phase 5 commit 2 — editorial beat-coverage producer tests.
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 5"
 *
 * Pure unit tests — no DB, no real LLM call. The DI'd `callLLM` is a
 * fixed-output mock so every test is deterministic. Pin: prompt shape,
 * LLM-output schema accept/reject, proposal-from-output mapping
 * (covered=true skipped, out-of-range index dropped, duplicates folded,
 * severity wiring), envelope shape (ids, target, parentEnvelopeId
 * provenance), end-to-end orchestrator.
 */

import { describe, expect, test } from "bun:test"
import {
  EDITORIAL_BEAT_COVERAGE_SYSTEM_PROMPT,
  beatCoverageLlmOutputSchema,
  buildBeatCoveragePrompt,
  buildBeatCoverageProposalsFromLlm,
  buildBeatCoverageEnvelopes,
  runEditorialBeatCoverageCheck,
  validateBeatCoverageLlmOutput,
  type BeatCoverageLlmOutput,
} from "./editorial-beat-coverage"
import { chapterOutlineSchema } from "../agents/planning-plotter/schema"
import { enrichOutlineIds } from "../harness/ids"
import type { ChapterOutline } from "../types"

const fixedNow = new Date("2026-05-04T12:00:00.000Z")
const novelId = "novel-test-1"
const draftHash = "a".repeat(64)
const chapterRef = "chapter:12"

function fixtureOutline(): ChapterOutline {
  // Built via `chapterOutlineSchema.parse(...)` so all default-bearing
  // fields (obligations.mustEstablish, lifeValueAxes, etc.) populate
  // correctly. Three beats: 0, 1, 2. chapterId set so the chapter-ref
  // derivation prefers the slug path.
  return chapterOutlineSchema.parse({
    chapterNumber: 12,
    chapterId: "ch-012-locked-door",
    title: "The Locked Door",
    povCharacter: "Mira",
    setting: "humid library",
    purpose: "establish the locked-door obstacle",
    scenes: [
      { description: "Mira walks the corridor", characters: ["Mira"], kind: "action" },
      { description: "Mira tries the door; it's locked", characters: ["Mira"], kind: "action" },
      { description: "Mira pockets a key from a nearby desk", characters: ["Mira"], kind: "action" },
    ],
    targetWords: 1000,
    charactersPresent: ["Mira"],
  })
}

describe("LLM output schema", () => {
  test("accepts a minimal valid verdict list", () => {
    const out = {
      beatVerdicts: [
        { beatIndex: 0, covered: true, evidenceQuote: "she walked", reason: "ok" },
        { beatIndex: 1, covered: false, reason: "missing" },
      ],
    }
    expect(() => beatCoverageLlmOutputSchema.parse(out)).not.toThrow()
  })

  test("rejects negative beatIndex", () => {
    const out = { beatVerdicts: [{ beatIndex: -1, covered: true, reason: "x" }] }
    expect(() => beatCoverageLlmOutputSchema.parse(out)).toThrow()
  })

  test("rejects non-integer beatIndex", () => {
    const out = { beatVerdicts: [{ beatIndex: 1.5, covered: true, reason: "x" }] }
    expect(() => beatCoverageLlmOutputSchema.parse(out)).toThrow()
  })

  test("rejects missing reason", () => {
    const out = { beatVerdicts: [{ beatIndex: 0, covered: true }] }
    expect(() => beatCoverageLlmOutputSchema.parse(out)).toThrow()
  })

  test("rejects beatVerdicts not array", () => {
    const out = { beatVerdicts: "nope" }
    expect(() => beatCoverageLlmOutputSchema.parse(out)).toThrow()
  })

  test("(MEDIUM H1) rejects covered=true without evidenceQuote", () => {
    const out = {
      beatVerdicts: [{ beatIndex: 0, covered: true, reason: "ok" }],
    }
    expect(() => beatCoverageLlmOutputSchema.parse(out)).toThrow(/evidenceQuote/i)
  })

  test("(MEDIUM H1) rejects covered=true with empty evidenceQuote", () => {
    const out = {
      beatVerdicts: [{ beatIndex: 0, covered: true, evidenceQuote: "", reason: "ok" }],
    }
    expect(() => beatCoverageLlmOutputSchema.parse(out)).toThrow(/evidenceQuote/i)
  })

  test("(MEDIUM H1) accepts covered=false without evidenceQuote", () => {
    const out = { beatVerdicts: [{ beatIndex: 0, covered: false, reason: "missing" }] }
    expect(() => beatCoverageLlmOutputSchema.parse(out)).not.toThrow()
  })
})

describe("buildBeatCoveragePrompt", () => {
  test("emits 0-based beat indices and includes prose", () => {
    const prose = "Mira walked. The door was locked. She found a key."
    const prompt = buildBeatCoveragePrompt(prose, fixtureOutline())
    expect(prompt).toContain("CHAPTER 12")
    expect(prompt).toContain('"The Locked Door"')
    expect(prompt).toContain("Beat 0")
    expect(prompt).toContain("Beat 1")
    expect(prompt).toContain("Beat 2")
    expect(prompt).toContain("Mira walks the corridor")
    expect(prompt).toContain("Mira tries the door; it's locked")
    expect(prompt).toContain(prose)
    expect(prompt).toContain("0-based")
  })

  test("system prompt frames the schema and the conservative-bias rule", () => {
    expect(EDITORIAL_BEAT_COVERAGE_SYSTEM_PROMPT).toContain("beatIndex")
    expect(EDITORIAL_BEAT_COVERAGE_SYSTEM_PROMPT).toContain("evidenceQuote")
    expect(EDITORIAL_BEAT_COVERAGE_SYSTEM_PROMPT).toContain("Be conservative")
  })
})

describe("validateBeatCoverageLlmOutput (MEDIUM H1)", () => {
  test("returns null when verdicts cover every beat exactly once", () => {
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [
        { beatIndex: 0, covered: false, reason: "x" },
        { beatIndex: 1, covered: false, reason: "y" },
        { beatIndex: 2, covered: false, reason: "z" },
      ],
    }
    expect(validateBeatCoverageLlmOutput(out, fixtureOutline())).toBeNull()
  })

  test("flags out-of-range beatIndex", () => {
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [
        { beatIndex: 0, covered: false, reason: "x" },
        { beatIndex: 1, covered: false, reason: "y" },
        { beatIndex: 99, covered: false, reason: "out" },
      ],
    }
    const err = validateBeatCoverageLlmOutput(out, fixtureOutline())
    expect(err).toContain("99")
    expect(err).toContain("out of range")
  })

  test("flags duplicate beatIndex", () => {
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [
        { beatIndex: 0, covered: false, reason: "x" },
        { beatIndex: 0, covered: false, reason: "dup" },
        { beatIndex: 1, covered: false, reason: "y" },
        { beatIndex: 2, covered: false, reason: "z" },
      ],
    }
    const err = validateBeatCoverageLlmOutput(out, fixtureOutline())
    expect(err).toContain("duplicate")
    expect(err).toContain("0")
  })

  test("flags missing beatIndex (model skipped a beat)", () => {
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [
        { beatIndex: 0, covered: false, reason: "x" },
        { beatIndex: 2, covered: false, reason: "z" },
      ],
    }
    const err = validateBeatCoverageLlmOutput(out, fixtureOutline())
    expect(err).toContain("missing")
    expect(err).toContain("1")
  })
})

describe("buildBeatCoverageProposalsFromLlm", () => {
  test("returns empty when every beat is covered", () => {
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [
        { beatIndex: 0, covered: true, reason: "covered" },
        { beatIndex: 1, covered: true, reason: "covered" },
        { beatIndex: 2, covered: true, reason: "covered" },
      ],
    }
    const proposals = buildBeatCoverageProposalsFromLlm({
      llmOutput: out,
      outline: fixtureOutline(),
      chapterRef,
    })
    expect(proposals).toHaveLength(0)
  })

  test("maps each uncovered beat to one missing-beat-coverage proposal at default warning", () => {
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [
        { beatIndex: 0, covered: true, reason: "ok" },
        { beatIndex: 1, covered: false, reason: "no door attempt in draft" },
        { beatIndex: 2, covered: false, reason: "no key pickup in draft" },
      ],
    }
    const proposals = buildBeatCoverageProposalsFromLlm({
      llmOutput: out,
      outline: fixtureOutline(),
      chapterRef,
    })
    expect(proposals).toHaveLength(2)
    expect(proposals[0].issueType).toBe("missing-beat-coverage")
    expect(proposals[0].severity).toBe("warning")
    expect(proposals[0].beatRef).toBe("b2")
    // OpenCode MEDIUM H2: chapterRef now mirrors the caller-supplied
    // value (matches the envelope target.ref), not a derived string
    // from outline.chapterId.
    expect(proposals[0].chapterRef).toBe(chapterRef)
    expect(proposals[0].evidenceQuotes).toHaveLength(1)
    expect(proposals[0].evidenceQuotes[0].text).toBe("no door attempt in draft")
    expect(proposals[0].suggestedAction).toContain("Add coverage for beat 2")
    expect(proposals[1].beatRef).toBe("b3")
    expect(proposals[1].chapterRef).toBe(chapterRef)
    expect(proposals[1].suggestedAction).toContain("Add coverage for beat 3")
  })

  test("uncoveredSeverity=blocker propagates to proposals", () => {
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [{ beatIndex: 0, covered: false, reason: "missing" }],
    }
    const proposals = buildBeatCoverageProposalsFromLlm({
      llmOutput: out,
      outline: fixtureOutline(),
      chapterRef,
      uncoveredSeverity: "blocker",
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].severity).toBe("blocker")
  })

  test("out-of-range beatIndex is silently skipped", () => {
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [
        { beatIndex: 0, covered: false, reason: "missing" },
        { beatIndex: 99, covered: false, reason: "model hallucinated this beat" },
      ],
    }
    const proposals = buildBeatCoverageProposalsFromLlm({
      llmOutput: out,
      outline: fixtureOutline(),
      chapterRef,
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].beatRef).toBe("b1")
  })

  test("duplicate uncovered beatIndex folds to one proposal (first-wins)", () => {
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [
        { beatIndex: 1, covered: false, reason: "first reason" },
        { beatIndex: 1, covered: false, reason: "second reason — should be dropped" },
      ],
    }
    const proposals = buildBeatCoverageProposalsFromLlm({
      llmOutput: out,
      outline: fixtureOutline(),
      chapterRef,
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].evidenceQuotes[0].text).toBe("first reason")
  })

  test("prefers beat.beatId for beatRef when the outline has been enriched", () => {
    // Stable-ID hardening (2026-05-04): production outlines round-trip through
    // `enrichOutlineIds` via `saveChapterOutline()`, so beat.beatId is
    // populated. The producer threads that durable ref into the proposal
    // payload's beatRef so downstream impact lookups can join findings to
    // scene_plan targets (legacy `beat_plan` fallback) without parsing
    // positional `b<n>` strings.
    const enriched = fixtureOutline()
    enrichOutlineIds(enriched)
    const expectedBeatId = enriched.scenes[1]!.beatId
    expect(typeof expectedBeatId).toBe("string")
    expect((expectedBeatId as string).length).toBeGreaterThan(0)
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [
        { beatIndex: 0, covered: true, evidenceQuote: "ok", reason: "ok" },
        { beatIndex: 1, covered: false, reason: "no door attempt in draft" },
        { beatIndex: 2, covered: true, evidenceQuote: "ok", reason: "ok" },
      ],
    }
    const proposals = buildBeatCoverageProposalsFromLlm({
      llmOutput: out,
      outline: enriched,
      chapterRef,
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].beatRef).toBe(expectedBeatId)
  })

  test("falls back to positional b<n> when the outline is un-enriched", () => {
    // Legacy / synthetic outlines that never went through `enrichOutlineIds`
    // do not carry beatIds. The producer keeps emitting `b<n>` so downstream
    // consumers (UI, persisted envelopes from older runs) see byte-identical
    // beatRefs to the pre-2026-05-04 behavior.
    const unenriched = fixtureOutline()
    for (const beat of unenriched.scenes) {
      delete (beat as { beatId?: string }).beatId
    }
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [
        { beatIndex: 0, covered: false, reason: "missing" },
        { beatIndex: 1, covered: true, evidenceQuote: "ok", reason: "ok" },
        { beatIndex: 2, covered: false, reason: "missing" },
      ],
    }
    const proposals = buildBeatCoverageProposalsFromLlm({
      llmOutput: out,
      outline: unenriched,
      chapterRef,
    })
    expect(proposals).toHaveLength(2)
    expect(proposals[0].beatRef).toBe("b1")
    expect(proposals[1].beatRef).toBe("b3")
  })

  test("chapterRef is determined by caller, not by outline.chapterId enrichment (MEDIUM H2)", () => {
    // OpenCode MEDIUM H2: the proposal's chapterRef mirrors the
    // caller-supplied value. Two outlines that differ only in
    // chapterId enrichment must produce the same proposal-side
    // chapterRef when the caller passes the same chapterRef. This
    // pins the determinism contract that earlier broke when the
    // proposal derived chapterRef from outline.chapterId while the
    // envelope target used the caller's chapterRef.
    const enriched = fixtureOutline()
    const unenriched = fixtureOutline()
    delete (unenriched as { chapterId?: string }).chapterId
    const out: BeatCoverageLlmOutput = {
      beatVerdicts: [{ beatIndex: 0, covered: false, reason: "missing" }],
    }
    const a = buildBeatCoverageProposalsFromLlm({
      llmOutput: out, outline: enriched, chapterRef,
    })
    const b = buildBeatCoverageProposalsFromLlm({
      llmOutput: out, outline: unenriched, chapterRef,
    })
    expect(a[0].chapterRef).toBe(b[0].chapterRef)
    expect(a[0].chapterRef).toBe(chapterRef)
  })

  // The "falls back to chapterNumber when chapterId is absent" test
  // from the prior version is removed: OpenCode MEDIUM H2 lifted
  // chapterRef to a caller-supplied value, so the outline-based
  // fallback no longer exists.
})

describe("buildBeatCoverageEnvelopes", () => {
  test("wraps each proposal in an editorial_flag envelope", () => {
    const proposals = [
      {
        issueType: "missing-beat-coverage" as const,
        severity: "warning" as const,
        beatRef: "b2",
        chapterRef: "chapter:12",
        canonRefs: [],
        evidenceQuotes: [{ text: "no door attempt" }],
        suggestedAction: "Add coverage for beat 2.",
      },
      {
        issueType: "missing-beat-coverage" as const,
        severity: "warning" as const,
        beatRef: "b3",
        chapterRef: "chapter:12",
        canonRefs: [],
        evidenceQuotes: [{ text: "no key pickup" }],
        suggestedAction: "Add coverage for beat 3.",
      },
    ]
    const envs = buildBeatCoverageEnvelopes({
      novelId,
      chapterRef,
      proposals,
      agent: "editorial-beat-coverage",
      draftHash,
      rationale: "test",
      now: fixedNow,
    })
    expect(envs).toHaveLength(2)
    expect(envs[0].kind).toBe("editorial_flag")
    expect(envs[0].id).toMatch(/^editorial-flag:novel-test-1:[0-9a-f]{16}$/)
    expect(envs[0].target.kind).toBe("chapter_outline")
    expect(envs[0].target.ref).toBe(chapterRef)
    expect(envs[0].target.currentVersion).toBe(draftHash)
    expect(envs[0].precondition.kind).toBe("draft_hash")
    expect(envs[0].risk).toBe("medium")
    expect(envs[0].id).not.toBe(envs[1].id)
  })

  test("parentEnvelopeId surfaces on every envelope as provenance, not identity", () => {
    const proposals = [
      {
        issueType: "missing-beat-coverage" as const,
        severity: "warning" as const,
        canonRefs: [],
        evidenceQuotes: [],
        suggestedAction: "x",
      },
    ]
    const baseArgs = {
      novelId,
      chapterRef,
      proposals,
      agent: "test",
      draftHash,
      rationale: "r",
      now: fixedNow,
    }
    const a = buildBeatCoverageEnvelopes(baseArgs)
    const b = buildBeatCoverageEnvelopes({ ...baseArgs, parentEnvelopeId: "parent-1" })
    // Same payload + index → same id regardless of parent.
    expect(b[0].id).toBe(a[0].id)
    expect(b[0].source.parentEnvelopeId).toBe("parent-1")
    expect(a[0].source.parentEnvelopeId).toBeUndefined()
  })
})

describe("runEditorialBeatCoverageCheck (orchestrator)", () => {
  test("calls the DI'd LLM with system + user prompts and emits envelopes for uncovered beats", async () => {
    const captured: { systemPrompt?: string; userPrompt?: string } = {}
    const callLLM = async (args: { systemPrompt: string; userPrompt: string }) => {
      captured.systemPrompt = args.systemPrompt
      captured.userPrompt = args.userPrompt
      return {
        beatVerdicts: [
          { beatIndex: 0, covered: true, evidenceQuote: "Mira walked.", reason: "ok" },
          { beatIndex: 1, covered: false, reason: "no door attempt" },
          { beatIndex: 2, covered: false, reason: "no key pickup" },
        ],
      }
    }

    const result = await runEditorialBeatCoverageCheck({
      novelId,
      chapterRef,
      prose: "Mira walked through the corridor and stopped.",
      outline: fixtureOutline(),
      draftHash,
      now: fixedNow,
      callLLM,
    })

    expect(captured.systemPrompt).toBe(EDITORIAL_BEAT_COVERAGE_SYSTEM_PROMPT)
    expect(captured.userPrompt).toContain("Beat 0")
    expect(captured.userPrompt).toContain("Beat 2")
    expect(result.envelopes).toHaveLength(2)
    expect(result.envelopes[0].kind).toBe("editorial_flag")
    expect(result.envelopes[0].source.agent).toBe("editorial-beat-coverage")
    expect(result.rawOutput.beatVerdicts).toHaveLength(3)
    expect(result.userPrompt).toBe(captured.userPrompt!)
  })

  test("emits zero envelopes when the LLM verdicts are all covered", async () => {
    const callLLM = async () =>
      ({
        beatVerdicts: [
          { beatIndex: 0, covered: true, evidenceQuote: "...", reason: "ok" },
          { beatIndex: 1, covered: true, evidenceQuote: "...", reason: "ok" },
          { beatIndex: 2, covered: true, evidenceQuote: "...", reason: "ok" },
        ],
      })

    const result = await runEditorialBeatCoverageCheck({
      novelId,
      chapterRef,
      prose: "...",
      outline: fixtureOutline(),
      draftHash,
      now: fixedNow,
      callLLM,
    })

    expect(result.envelopes).toHaveLength(0)
    expect(result.rawOutput.beatVerdicts).toHaveLength(3)
  })

  test("throws when the LLM output fails the schema", async () => {
    const callLLM = async () => ({ beatVerdicts: "not-an-array" })
    await expect(
      runEditorialBeatCoverageCheck({
        novelId,
        chapterRef,
        prose: "...",
        outline: fixtureOutline(),
        draftHash,
        now: fixedNow,
        callLLM,
      }),
    ).rejects.toThrow()
  })

  test("(MEDIUM H1) throws when LLM emits missing/duplicate/out-of-range beatIndex", async () => {
    // Missing beatIndex — fixture has 3 beats, model only returns 2.
    const callLLMMissing = async () =>
      ({
        beatVerdicts: [
          { beatIndex: 0, covered: false, reason: "x" },
          { beatIndex: 1, covered: false, reason: "y" },
        ],
      })
    await expect(
      runEditorialBeatCoverageCheck({
        novelId, chapterRef, prose: "...", outline: fixtureOutline(),
        draftHash, now: fixedNow, callLLM: callLLMMissing,
      }),
    ).rejects.toThrow(/validation failed.*missing/)

    // Duplicate beatIndex.
    const callLLMDup = async () =>
      ({
        beatVerdicts: [
          { beatIndex: 0, covered: false, reason: "x" },
          { beatIndex: 0, covered: false, reason: "dup" },
          { beatIndex: 1, covered: false, reason: "y" },
          { beatIndex: 2, covered: false, reason: "z" },
        ],
      })
    await expect(
      runEditorialBeatCoverageCheck({
        novelId, chapterRef, prose: "...", outline: fixtureOutline(),
        draftHash, now: fixedNow, callLLM: callLLMDup,
      }),
    ).rejects.toThrow(/validation failed.*duplicate/)

    // Out-of-range beatIndex.
    const callLLMOOR = async () =>
      ({
        beatVerdicts: [
          { beatIndex: 0, covered: false, reason: "x" },
          { beatIndex: 1, covered: false, reason: "y" },
          { beatIndex: 99, covered: false, reason: "out" },
        ],
      })
    await expect(
      runEditorialBeatCoverageCheck({
        novelId, chapterRef, prose: "...", outline: fixtureOutline(),
        draftHash, now: fixedNow, callLLM: callLLMOOR,
      }),
    ).rejects.toThrow(/validation failed.*out of range/)
  })

  test("propagates LLM-call failure (caller decides retry/escalate)", async () => {
    const callLLM = async () => {
      throw new Error("transport timeout")
    }
    await expect(
      runEditorialBeatCoverageCheck({
        novelId,
        chapterRef,
        prose: "...",
        outline: fixtureOutline(),
        draftHash,
        now: fixedNow,
        callLLM,
      }),
    ).rejects.toThrow("transport timeout")
  })

  test("rationale + agent overrides are wired into envelope source", async () => {
    // OpenCode MEDIUM H1: post-validation requires one verdict per
    // outline beat. The fixture has 3 beats, so the LLM mock returns
    // verdicts for all three (only beat 0 uncovered → 1 envelope).
    const callLLM = async () =>
      ({
        beatVerdicts: [
          { beatIndex: 0, covered: false, reason: "missing" },
          { beatIndex: 1, covered: true, evidenceQuote: "the door", reason: "ok" },
          { beatIndex: 2, covered: true, evidenceQuote: "the key", reason: "ok" },
        ],
      })
    const result = await runEditorialBeatCoverageCheck({
      novelId,
      chapterRef,
      prose: "...",
      outline: fixtureOutline(),
      draftHash,
      now: fixedNow,
      agent: "editorial-coverage-experimental",
      rationale: "Custom rationale for tracer-bullet smoke run.",
      callLLM,
    })
    expect(result.envelopes).toHaveLength(1)
    expect(result.envelopes[0].source.agent).toBe("editorial-coverage-experimental")
    // The envelope's stored rationale lives on `source` per ReviewProposalEnvelope
    // shape; verify by id determinism: the same args (incl. rationale) hash stably.
    const r2 = await runEditorialBeatCoverageCheck({
      novelId,
      chapterRef,
      prose: "...",
      outline: fixtureOutline(),
      draftHash,
      now: fixedNow,
      agent: "editorial-coverage-experimental",
      rationale: "Custom rationale for tracer-bullet smoke run.",
      callLLM,
    })
    expect(r2.envelopes[0].id).toBe(result.envelopes[0].id)
  })
})
