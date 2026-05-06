import { describe, expect, test } from "bun:test"

import {
  buildContinuityEditorialFlagEnvelopes,
  buildContinuityEditorialFlagProposals,
} from "./continuity-editorial-flags"

describe("continuity editorial flags", () => {
  test("maps fact-scoped blocker issues to warning editorial flags", () => {
    const proposals = buildContinuityEditorialFlagProposals({
      chapterRef: "chapter:2",
      issues: [{
        severity: "blocker",
        description: "Draft says Cassel can verify stats without a witness.",
        conflictsWith: "Witness is required if the citizen requests it.",
        factId: "fact-witness-required",
      }],
    })

    expect(proposals).toEqual([{
      issueType: "off-canon",
      severity: "warning",
      chapterRef: "chapter:2",
      canonRefs: [{ kind: "fact", id: "fact-witness-required" }],
      evidenceQuotes: [
        { text: "Draft says Cassel can verify stats without a witness." },
        { text: "Conflicts with: Witness is required if the citizen requests it." },
      ],
      suggestedAction: expect.stringContaining("create a prose_edit"),
    }])
  })

  test("filters low-confidence or state-only continuity findings", () => {
    const proposals = buildContinuityEditorialFlagProposals({
      chapterRef: "chapter:2",
      issues: [
        {
          severity: "warning",
          description: "Location warning that should stay diagnostic-only.",
          characterId: "char-maret",
        },
        {
          severity: "nit",
          description: "Minor wording issue.",
          conflictsWith: "A fact.",
        },
        {
          severity: "blocker",
          description: "State-only knowledge issue with no fact anchor.",
          characterId: "char-maret",
        },
      ],
    })

    expect(proposals).toEqual([])
  })

  test("wraps proposals in deterministic editorial_flag envelopes", () => {
    const envelopes = buildContinuityEditorialFlagEnvelopes({
      novelId: "novel-1",
      chapterRef: "chapter:2",
      draftHash: "draft-hash",
      now: new Date("2026-05-06T12:00:00.000Z"),
      issues: [{
        severity: "blocker",
        description: "Draft contradicts the registry rule.",
        conflictsWith: "Registry rules require witness consent.",
        factId: "fact-registry-witness",
      }],
    })
    const rerun = buildContinuityEditorialFlagEnvelopes({
      novelId: "novel-1",
      chapterRef: "chapter:2",
      draftHash: "draft-hash",
      now: new Date("2026-05-06T12:01:00.000Z"),
      issues: [{
        severity: "blocker",
        description: "Draft contradicts the registry rule.",
        conflictsWith: "Registry rules require witness consent.",
        factId: "fact-registry-witness",
      }],
    })

    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]).toMatchObject({
      kind: "editorial_flag",
      novelId: "novel-1",
      source: { agent: "continuity-editorial-flags" },
      target: {
        kind: "chapter_outline",
        ref: "chapter:2",
        currentVersion: "draft-hash",
      },
      payload: {
        issueType: "off-canon",
        severity: "warning",
        chapterRef: "chapter:2",
      },
      precondition: { kind: "draft_hash", hash: "draft-hash" },
    })
    expect(rerun[0]?.id).toBe(envelopes[0]?.id)
  })
})
