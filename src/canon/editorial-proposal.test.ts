/**
 * Phase 5 commit 1 — editorial proposal payload schema tests.
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 5"
 *
 * Pure unit tests — no DB, no network. Pin: schema accept/reject shape,
 * envelope-builder output, deterministic id, classify* mapping, target
 * variants for prose edits, parentEnvelopeId provenance.
 */

import { describe, expect, test } from "bun:test"
import {
  editorialFlagProposalSchema,
  proseEditProposalSchema,
  buildEditorialFlagEnvelope,
  buildProseEditEnvelope,
  classifyFlagRisk,
  classifyEditRisk,
} from "./editorial-proposal"
import type {
  EditorialFlagProposal,
  ProseEditProposal,
} from "./editorial-proposal"

const fixedNow = new Date("2026-05-04T12:00:00.000Z")
const novelId = "novel-test-1"
const draftHash = "a".repeat(64)

describe("EditorialFlagProposal — schema + builder", () => {
  test("schema accepts a minimal valid flag", () => {
    const flag: EditorialFlagProposal = {
      issueType: "off-canon",
      severity: "warning",
      canonRefs: [{ kind: "fact", id: "fact-c1-f1" }],
      evidenceQuotes: [{ text: "she opened the door", ref: "draft:v1#span:100-118" }],
      suggestedAction: "Reword to acknowledge the door is locked per fact-c1-f1.",
    }
    expect(() => editorialFlagProposalSchema.parse(flag)).not.toThrow()
  })

  test("schema rejects a bogus issueType", () => {
    const bogus = {
      issueType: "ghost-category",
      severity: "warning",
      canonRefs: [],
      evidenceQuotes: [],
      suggestedAction: "x",
    }
    expect(() => editorialFlagProposalSchema.parse(bogus)).toThrow()
  })

  test("schema rejects a bogus severity", () => {
    const bogus = {
      issueType: "logic-error",
      severity: "low",
      canonRefs: [],
      evidenceQuotes: [],
      suggestedAction: "x",
    }
    expect(() => editorialFlagProposalSchema.parse(bogus)).toThrow()
  })

  test("classifyFlagRisk: blocker → high, warning → medium, info → low", () => {
    expect(classifyFlagRisk("blocker")).toBe("high")
    expect(classifyFlagRisk("warning")).toBe("medium")
    expect(classifyFlagRisk("info")).toBe("low")
  })

  test("buildEditorialFlagEnvelope: produces correct envelope shape", () => {
    const flag: EditorialFlagProposal = {
      issueType: "missing-beat-coverage",
      severity: "blocker",
      beatRef: "b3",
      chapterRef: "chapter:12",
      canonRefs: [],
      evidenceQuotes: [
        { text: "(beat b3 has no clear coverage in draft)", ref: "draft:v2#beat:b3" },
      ],
      suggestedAction: "Add a paragraph covering b3's swordfight scene.",
    }
    const env = buildEditorialFlagEnvelope({
      novelId,
      chapterRef: "chapter:12",
      proposal: flag,
      proposalIndex: 0,
      agent: "editorial-flag-checker",
      draftHash,
      rationale: "beat-coverage scan flagged b3 as uncovered in draft v2",
      now: fixedNow,
    })
    expect(env.kind).toBe("editorial_flag")
    expect(env.id).toMatch(/^editorial-flag:novel-test-1:[0-9a-f]{16}$/)
    expect(env.target.kind).toBe("chapter_outline")
    expect(env.target.ref).toBe("chapter:12")
    expect(env.target.currentVersion).toBe(draftHash)
    expect(env.precondition.kind).toBe("draft_hash")
    expect(env.precondition.hash).toBe(draftHash)
    expect(env.risk).toBe("high")
    expect(env.summary).toContain("blocker")
    expect(env.summary).toContain("missing-beat-coverage")
    expect(env.evidence).toHaveLength(1)
    expect(env.evidence[0].kind).toBe("quote")
    expect(env.payload).toEqual(flag)
    expect(env.policyRecommendation.decision).toBe("queue")
  })

  test("buildEditorialFlagEnvelope: id is deterministic + parentEnvelopeId is metadata-only", () => {
    const flag: EditorialFlagProposal = {
      issueType: "tone-drift",
      severity: "warning",
      canonRefs: [],
      evidenceQuotes: [],
      suggestedAction: "x",
    }
    const args = {
      novelId,
      chapterRef: "chapter:1",
      proposal: flag,
      proposalIndex: 0,
      agent: "test",
      draftHash,
      rationale: "r",
      now: fixedNow,
    } as const
    const a = buildEditorialFlagEnvelope(args)
    const b = buildEditorialFlagEnvelope({ ...args, parentEnvelopeId: "parent-1" })
    const c = buildEditorialFlagEnvelope({ ...args, parentEnvelopeId: "parent-2" })
    // Identical patch + draft + index → identical id regardless of parent.
    expect(b.id).toBe(a.id)
    expect(c.id).toBe(a.id)
    // Parent link surfaces on source.
    expect(b.source.parentEnvelopeId).toBe("parent-1")
    expect(c.source.parentEnvelopeId).toBe("parent-2")
    expect(a.source.parentEnvelopeId).toBeUndefined()
  })

  test("(MEDIUM B) buildEditorialFlagEnvelope rejects self-parent (1-cycle)", () => {
    const flag: EditorialFlagProposal = {
      issueType: "tone-drift",
      severity: "warning",
      canonRefs: [],
      evidenceQuotes: [],
      suggestedAction: "x",
    }
    const args = {
      novelId,
      chapterRef: "chapter:1",
      proposal: flag,
      proposalIndex: 0,
      agent: "test",
      draftHash,
      rationale: "r",
      now: fixedNow,
    } as const
    const a = buildEditorialFlagEnvelope(args)
    expect(() =>
      buildEditorialFlagEnvelope({ ...args, parentEnvelopeId: a.id }),
    ).toThrow(/parentEnvelopeId equals computed envelope id/)
  })
})

describe("ProseEditProposal — schema + builder", () => {
  test("schema accepts a span-target edit", () => {
    const edit: ProseEditProposal = {
      draftVersion: "chapter:12:draft:v3",
      target: { kind: "span", chapterRef: "chapter:12", start: 1024, end: 1086 },
      replacement: "She paused at the threshold, mindful of the lock.",
      rationale: "Adjust to acknowledge fact-c1-f1 (door is locked).",
    }
    expect(() => proseEditProposalSchema.parse(edit)).not.toThrow()
  })

  test("schema accepts a beat-target edit", () => {
    const edit: ProseEditProposal = {
      draftVersion: "chapter:5:draft:v1",
      target: { kind: "beat", chapterRef: "chapter:5", beatRef: "b3" },
      replacement: "Replace the entire b3 beat with: …",
      rationale: "Beat b3 is currently empty.",
    }
    expect(() => proseEditProposalSchema.parse(edit)).not.toThrow()
  })

  test("schema rejects negative offsets on a span edit", () => {
    const bogus = {
      draftVersion: "x",
      target: { kind: "span", chapterRef: "x", start: -1, end: 5 },
      replacement: "y",
      rationale: "z",
    }
    expect(() => proseEditProposalSchema.parse(bogus)).toThrow()
  })

  test("schema rejects unknown target kind", () => {
    const bogus = {
      draftVersion: "x",
      target: { kind: "scene", chapterRef: "x", start: 0, end: 5 },
      replacement: "y",
      rationale: "z",
    }
    expect(() => proseEditProposalSchema.parse(bogus)).toThrow()
  })

  test("classifyEditRisk: defaults to medium", () => {
    expect(classifyEditRisk({
      draftVersion: "x",
      target: { kind: "span", chapterRef: "x", start: 0, end: 1 },
      replacement: "y",
      rationale: "z",
    })).toBe("medium")
  })

  test("buildProseEditEnvelope: produces correct envelope shape (span)", () => {
    const edit: ProseEditProposal = {
      draftVersion: "chapter:12:draft:v3",
      target: { kind: "span", chapterRef: "chapter:12", start: 1024, end: 1086 },
      replacement: "She paused at the threshold.",
      rationale: "Tighten pacing.",
    }
    const env = buildProseEditEnvelope({
      novelId,
      proposal: edit,
      proposalIndex: 0,
      agent: "prose-edit-llm",
      draftHash,
      rationale: edit.rationale,
      now: fixedNow,
    })
    expect(env.kind).toBe("prose_edit")
    expect(env.id).toMatch(/^prose-edit:novel-test-1:[0-9a-f]{16}$/)
    expect(env.target.kind).toBe("prose_span")
    expect(env.target.ref).toBe("span:chapter:12@1024-1086")
    expect(env.target.currentVersion).toBe(draftHash)
    expect(env.precondition.kind).toBe("draft_hash")
    expect(env.payload).toEqual(edit)
    expect(env.summary).toContain("Edit span:chapter:12@1024-1086")
    expect(env.risk).toBe("medium")
  })

  test("buildProseEditEnvelope: produces correct envelope shape (beat)", () => {
    const edit: ProseEditProposal = {
      draftVersion: "chapter:5:draft:v1",
      target: { kind: "beat", chapterRef: "chapter:5", beatRef: "b3" },
      replacement: "Whole new beat text",
      rationale: "Beat was empty.",
    }
    const env = buildProseEditEnvelope({
      novelId,
      proposal: edit,
      proposalIndex: 0,
      agent: "test",
      draftHash,
      rationale: edit.rationale,
      now: fixedNow,
    })
    expect(env.target.ref).toBe("beat:chapter:5#b3")
    expect(env.summary).toContain("Edit beat:chapter:5#b3")
  })

  test("buildProseEditEnvelope: id is deterministic + parentEnvelopeId is metadata-only", () => {
    const edit: ProseEditProposal = {
      draftVersion: "v1",
      target: { kind: "span", chapterRef: "c1", start: 0, end: 10 },
      replacement: "x",
      rationale: "y",
    }
    const args = {
      novelId,
      proposal: edit,
      proposalIndex: 0,
      agent: "test",
      draftHash,
      rationale: "y",
      now: fixedNow,
    } as const
    const a = buildProseEditEnvelope(args)
    const b = buildProseEditEnvelope({ ...args, parentEnvelopeId: "p1" })
    expect(b.id).toBe(a.id)
    expect(b.source.parentEnvelopeId).toBe("p1")
  })

  test("(MEDIUM B) buildProseEditEnvelope rejects self-parent (1-cycle)", () => {
    const edit: ProseEditProposal = {
      draftVersion: "v1",
      target: { kind: "span", chapterRef: "c1", start: 0, end: 10 },
      replacement: "x",
      rationale: "y",
    }
    const args = {
      novelId,
      proposal: edit,
      proposalIndex: 0,
      agent: "test",
      draftHash,
      rationale: "y",
      now: fixedNow,
    } as const
    const a = buildProseEditEnvelope(args)
    expect(() =>
      buildProseEditEnvelope({ ...args, parentEnvelopeId: a.id }),
    ).toThrow(/parentEnvelopeId equals computed envelope id/)
  })
})
