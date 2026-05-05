/**
 * Phase 5 commit 5 — lint-fix → prose_edit converter tests.
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 5"
 *
 * Pure unit tests — no DB, no LLM, no network. Pin: span computation
 * on rendered prose, deterministic-rule replacement, said-bookism in
 * dialogue, non-fixable filtering, batch produces parallel envelopes,
 * envelopes share one draft hash, rationale + agent passthrough.
 */

import { describe, expect, test } from "bun:test"
import {
  findFixForIssue,
  buildProseEditProposalFromIssue,
  buildProseEditEnvelopesFromLintIssues,
} from "./lint-to-prose-edit"
import type { LintIssue } from "../lint/types"
import { createHash } from "crypto"

const fixedNow = new Date("2026-05-04T12:00:00.000Z")

function makeIssue(
  category: string,
  match: string,
  sentence: string,
  patternId = 1,
  fixTemplate = "",
): LintIssue {
  return {
    patternId,
    charOffset: 0,
    category,
    match,
    sentence,
    fixTemplate,
  }
}

describe("findFixForIssue — deterministic rules", () => {
  test("FILLER_PHRASE 'in order to' → 'to' at the right span", () => {
    const prose = "She paused in order to listen."
    const sentence = "She paused in order to listen."
    const issue = makeIssue("FILLER_PHRASE", "in order to", sentence)
    const fix = findFixForIssue(prose, issue)
    expect(fix).not.toBeNull()
    expect(fix!.replacement).toBe("to")
    expect(fix!.category).toBe("FILLER_PHRASE")
    expect(prose.slice(fix!.start, fix!.end)).toBe("in order to")
  })

  test("REDUNDANT_BODY 'nodded his head' → 'nodded'", () => {
    const prose = "He nodded his head and walked away."
    const sentence = "He nodded his head and walked away."
    const issue = makeIssue("REDUNDANT_BODY", "nodded his head", sentence)
    const fix = findFixForIssue(prose, issue)
    expect(fix).not.toBeNull()
    expect(fix!.replacement).toBe("nodded")
    expect(prose.slice(fix!.start, fix!.end)).toBe("nodded his head")
  })

  test("FILTER_WORD 'could see' → 'saw'", () => {
    const prose = "She could see the harbor below."
    const sentence = "She could see the harbor below."
    const issue = makeIssue("FILTER_WORD", "could see", sentence)
    const fix = findFixForIssue(prose, issue)
    expect(fix).not.toBeNull()
    expect(fix!.replacement).toBe("saw")
    expect(prose.slice(fix!.start, fix!.end)).toBe("could see")
  })

  test("EMPTY_TRANSITION 'And then' → '' (deletion)", () => {
    const prose = "She paused. And then she ran."
    const sentence = "And then she ran."
    const issue = makeIssue("EMPTY_TRANSITION", "And then", sentence)
    const fix = findFixForIssue(prose, issue)
    expect(fix).not.toBeNull()
    expect(fix!.replacement).toBe("")
    expect(prose.slice(fix!.start, fix!.end)).toBe("And then")
  })
})

describe("findFixForIssue — said-bookism", () => {
  test("'exclaimed' in dialogue → 'said'", () => {
    const prose = `"Stop!" he exclaimed.`
    const sentence = `"Stop!" he exclaimed.`
    const issue = makeIssue("SAID_BOOKISM", "exclaimed", sentence)
    const fix = findFixForIssue(prose, issue)
    expect(fix).not.toBeNull()
    expect(fix!.replacement).toBe("said")
    expect(prose.slice(fix!.start, fix!.end)).toBe("exclaimed")
  })

  test("said-bookism term NOT in deterministic rule list AND no quotes → no fix (fallback bails)", () => {
    // The deterministic SAID_BOOKISM rule matches a closed list (exclaimed,
    // proclaimed, declared, …). For any other said-bookism — say "yelled"
    // — the converter falls through to the dialogue fallback, which
    // requires quote characters in the sentence. With no quotes, fallback
    // bails and the issue produces no proposal.
    const prose = "He yelled at the empty hall."
    const sentence = "He yelled at the empty hall."
    const issue = makeIssue("SAID_BOOKISM", "yelled", sentence)
    const fix = findFixForIssue(prose, issue)
    expect(fix).toBeNull()
  })

  test("'said softly' adverb form → 'said' via deterministic rule", () => {
    const prose = `"Hello," she said softly.`
    const sentence = `"Hello," she said softly.`
    const issue = makeIssue("SAID_BOOKISM", "said softly", sentence)
    const fix = findFixForIssue(prose, issue)
    expect(fix).not.toBeNull()
    expect(fix!.replacement).toBe("said")
  })
})

describe("findFixForIssue — non-fixable cases", () => {
  test("RHYTHM_MONOTONY → null (structural)", () => {
    const issue = makeIssue("RHYTHM_MONOTONY", "x", "x x x")
    expect(findFixForIssue("x x x", issue)).toBeNull()
  })

  test("PARAGRAPH_HOMOGENEITY → null (structural)", () => {
    const issue = makeIssue("PARAGRAPH_HOMOGENEITY", "x", "x x x")
    expect(findFixForIssue("x x x", issue)).toBeNull()
  })

  test("category with no matching DETERMINISTIC_FIXES rule → null", () => {
    const prose = "Some prose."
    const issue = makeIssue("UNKNOWN_CATEGORY", "Some", "Some prose.")
    expect(findFixForIssue(prose, issue)).toBeNull()
  })

  test("sentence not present in prose → null", () => {
    // Operator scenario: the prose has been mutated since detection.
    const prose = "Different prose entirely."
    const issue = makeIssue("FILLER_PHRASE", "in order to", "She paused in order to listen.")
    expect(findFixForIssue(prose, issue)).toBeNull()
  })
})

describe("findFixForIssue — span correctness with multiple sentences", () => {
  test("first occurrence of sentence is used (multi-sentence prose)", () => {
    const prose =
      "She nodded her head once. Then she walked away.\n\nLater, she nodded her head again."
    const issue = makeIssue(
      "REDUNDANT_BODY",
      "nodded her head",
      "She nodded her head once.",
    )
    const fix = findFixForIssue(prose, issue)
    expect(fix).not.toBeNull()
    // Must point to the FIRST sentence, not the second.
    expect(fix!.start).toBeLessThan(prose.indexOf("Later"))
    expect(prose.slice(fix!.start, fix!.end)).toBe("nodded her head")
  })

  test("issue match later in the sentence is located correctly", () => {
    const prose = "He had nodded his head and shrugged his shoulders."
    const issue = makeIssue(
      "REDUNDANT_BODY",
      "shrugged his shoulders",
      "He had nodded his head and shrugged his shoulders.",
    )
    const fix = findFixForIssue(prose, issue)
    expect(fix).not.toBeNull()
    expect(prose.slice(fix!.start, fix!.end)).toBe("shrugged his shoulders")
    expect(fix!.replacement).toBe("shrugged")
  })
})

describe("buildProseEditProposalFromIssue", () => {
  test("returns a span proposal with chapterRef + replacement + rationale", () => {
    const prose = "She paused in order to listen."
    const sentence = "She paused in order to listen."
    const issue = makeIssue("FILLER_PHRASE", "in order to", sentence)
    const proposal = buildProseEditProposalFromIssue(prose, issue, "chapter:7")
    expect(proposal).not.toBeNull()
    expect(proposal!.target.kind).toBe("span")
    if (proposal!.target.kind !== "span") throw new Error("type narrow")
    expect(proposal!.target.chapterRef).toBe("chapter:7")
    expect(prose.slice(proposal!.target.start, proposal!.target.end)).toBe("in order to")
    expect(proposal!.replacement).toBe("to")
    expect(proposal!.rationale).toContain("FILLER_PHRASE")
    expect(proposal!.draftVersion).toBe("lint:FILLER_PHRASE")
  })

  test("adds beatRef when beat prose maps the span to a durable beat id", () => {
    const beatProses = [
      "Mira waited by the sealed archive.",
      "She paused in order to listen.",
    ]
    const prose = beatProses.join("\n\n")
    const issue = makeIssue("FILLER_PHRASE", "in order to", beatProses[1])
    const proposal = buildProseEditProposalFromIssue(prose, issue, "chapter:7", {
      beatProses,
      beatRefs: ["beat-waiting", "beat-listening"],
    })

    expect(proposal).not.toBeNull()
    expect(proposal!.target).toMatchObject({
      kind: "span",
      chapterRef: "chapter:7",
      beatRef: "beat-listening",
    })
  })

  test("omits beatRef when beat prose does not match the rendered prose", () => {
    const prose = "She paused in order to listen."
    const issue = makeIssue("FILLER_PHRASE", "in order to", prose)
    const proposal = buildProseEditProposalFromIssue(prose, issue, "chapter:7", {
      beatProses: ["Different beat prose."],
      beatRefs: ["beat-different"],
    })

    expect(proposal).not.toBeNull()
    expect(proposal!.target.kind).toBe("span")
    if (proposal!.target.kind === "span") {
      expect(proposal!.target.beatRef).toBeUndefined()
    }
  })

  test("returns null when the issue has no deterministic fix", () => {
    const prose = "x"
    const issue = makeIssue("RHYTHM_MONOTONY", "x", "x")
    expect(buildProseEditProposalFromIssue(prose, issue, "chapter:1")).toBeNull()
  })
})

describe("buildProseEditEnvelopesFromLintIssues", () => {
  const novelId = "novel-test-1"

  test("batches multiple fixable issues into parallel envelopes", () => {
    const prose =
      `She nodded her head and paused in order to listen. ` +
      `"Stop!" he exclaimed.`
    const issues: LintIssue[] = [
      makeIssue(
        "REDUNDANT_BODY",
        "nodded her head",
        "She nodded her head and paused in order to listen.",
      ),
      makeIssue(
        "FILLER_PHRASE",
        "in order to",
        "She nodded her head and paused in order to listen.",
      ),
      makeIssue("SAID_BOOKISM", "exclaimed", `"Stop!" he exclaimed.`),
    ]
    const envelopes = buildProseEditEnvelopesFromLintIssues({
      novelId,
      chapterRef: "chapter:3",
      prose,
      issues,
      agent: "lint-converter",
      now: fixedNow,
    })
    expect(envelopes).toHaveLength(3)

    const expectedHash = createHash("sha256").update(prose, "utf8").digest("hex")
    for (const env of envelopes) {
      expect(env.kind).toBe("prose_edit")
      expect(env.precondition.kind).toBe("draft_hash")
      expect(env.precondition.hash).toBe(expectedHash)
      expect(env.target.currentVersion).toBe(expectedHash)
      expect(env.source.agent).toBe("lint-converter")
      expect(env.novelId).toBe(novelId)
      expect(env.risk).toBe("mechanical")
      expect(env.policyRecommendation.decision).toBe("approve")
    }
    // Each envelope has a distinct id (unique proposalIndex per fix).
    expect(new Set(envelopes.map(e => e.id)).size).toBe(envelopes.length)
  })

  test("filters out non-fixable issues silently", () => {
    const prose = "She paused in order to listen."
    const issues: LintIssue[] = [
      makeIssue("FILLER_PHRASE", "in order to", "She paused in order to listen."),
      makeIssue("RHYTHM_MONOTONY", "in order to", "She paused in order to listen."),
      makeIssue("UNKNOWN_CATEGORY", "in order to", "She paused in order to listen."),
    ]
    const envelopes = buildProseEditEnvelopesFromLintIssues({
      novelId,
      chapterRef: "chapter:1",
      prose,
      issues,
      agent: "test",
      now: fixedNow,
    })
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0].payload.target.kind).toBe("span")
    if (envelopes[0].payload.target.kind === "span") {
      expect(prose.slice(envelopes[0].payload.target.start, envelopes[0].payload.target.end))
        .toBe("in order to")
    }
  })

  test("empty issue list → empty envelope list", () => {
    const envelopes = buildProseEditEnvelopesFromLintIssues({
      novelId,
      chapterRef: "chapter:1",
      prose: "anything",
      issues: [],
      agent: "test",
      now: fixedNow,
    })
    expect(envelopes).toHaveLength(0)
  })

  test("parentEnvelopeId surfaces on every envelope when supplied", () => {
    const prose = "She paused in order to listen."
    const envelopes = buildProseEditEnvelopesFromLintIssues({
      novelId,
      chapterRef: "chapter:1",
      prose,
      issues: [
        makeIssue("FILLER_PHRASE", "in order to", "She paused in order to listen."),
      ],
      agent: "test",
      parentEnvelopeId: "parent-batch-1",
      now: fixedNow,
    })
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0].source.parentEnvelopeId).toBe("parent-batch-1")
  })

  test("two issues at the same category but different matches → distinct envelopes with distinct spans", () => {
    const prose =
      "He nodded his head. She also nodded her head later that day."
    const issues: LintIssue[] = [
      makeIssue("REDUNDANT_BODY", "nodded his head", "He nodded his head."),
      makeIssue(
        "REDUNDANT_BODY",
        "nodded her head",
        "She also nodded her head later that day.",
      ),
    ]
    const envelopes = buildProseEditEnvelopesFromLintIssues({
      novelId,
      chapterRef: "chapter:1",
      prose,
      issues,
      agent: "test",
      now: fixedNow,
    })
    expect(envelopes).toHaveLength(2)
    const spans = envelopes.map(e =>
      e.payload.target.kind === "span"
        ? [e.payload.target.start, e.payload.target.end]
        : null,
    )
    expect(spans[0]).not.toEqual(spans[1])
    if (
      envelopes[0].payload.target.kind === "span" &&
      envelopes[1].payload.target.kind === "span"
    ) {
      expect(prose.slice(envelopes[0].payload.target.start, envelopes[0].payload.target.end))
        .toBe("nodded his head")
      expect(prose.slice(envelopes[1].payload.target.start, envelopes[1].payload.target.end))
        .toBe("nodded her head")
    }
  })

  test("envelopes share one draft hash; modifying prose between proposals is the operator's concern", () => {
    // The producer's contract: all envelopes from one call carry the
    // SAME precondition.hash (computed once over the input prose). The
    // resolve route is what enforces the "still-current" check at apply
    // time — once the first envelope applies, subsequent ones with the
    // same hash will 409 (stale).
    const prose = "She paused in order to listen. He nodded his head."
    const issues: LintIssue[] = [
      makeIssue("FILLER_PHRASE", "in order to", "She paused in order to listen."),
      makeIssue("REDUNDANT_BODY", "nodded his head", "He nodded his head."),
    ]
    const envelopes = buildProseEditEnvelopesFromLintIssues({
      novelId,
      chapterRef: "chapter:1",
      prose,
      issues,
      agent: "test",
      now: fixedNow,
    })
    const expected = createHash("sha256").update(prose, "utf8").digest("hex")
    expect(new Set(envelopes.map(e => e.precondition.hash))).toEqual(new Set([expected]))
  })
})
