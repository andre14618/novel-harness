import { describe, expect, test } from "bun:test"

import {
  buildLiveAbDelta,
  buildRolePromptExposure,
  parseArgs,
  renderLiveAbReport,
  type ArmRunSummary,
  type LiveAbReport,
  type PromptRowForExposure,
  type RoleFactForExposure,
} from "./fact-role-context-live-ab"

describe("fact-role-context-live-ab", () => {
  test("prompt exposure separates writer and continuity hits by fact role", () => {
    const facts: RoleFactForExposure[] = [
      fact("op-1", "The oath clock rings at dawn.", "operational"),
      fact("ref-1", "The old calendar survives in private ledgers.", "reference"),
      fact("hid-1", "Maret is secretly the ledger heir.", "hidden"),
    ]
    const prompts: PromptRowForExposure[] = [
      prompt(1, "beat-writer", "The oath clock rings at dawn.\nThe old calendar survives in private ledgers."),
      prompt(2, "beat-writer", "The oath clock rings at dawn.\nMaret is secretly the ledger heir."),
      prompt(3, "continuity-facts", "The oath clock rings at dawn.\nThe old calendar survives in private ledgers."),
    ]

    const exposure = buildRolePromptExposure(facts, prompts)

    expect(exposure.byRole.operational).toMatchObject({
      factCount: 1,
      factsWithWriterHit: 1,
      factsWithContinuityHit: 1,
      writerPromptHits: 2,
      continuityPromptHits: 1,
    })
    expect(exposure.byRole.reference).toMatchObject({
      factCount: 1,
      factsWithWriterHit: 1,
      factsWithContinuityHit: 1,
    })
    expect(exposure.byRole.hidden).toMatchObject({
      factCount: 1,
      factsWithWriterHit: 1,
      factsWithContinuityHit: 0,
    })
  })

  test("delta is role-aware minus legacy for prompt and checker evidence", () => {
    const legacy = arm("legacy", {
      approved: 2,
      hiddenWriter: 1,
      hiddenContinuity: 1,
      referenceContinuity: 1,
      blockers: 3,
      halluc: 2,
      cost: 0.5,
    })
    const roleAware = arm("role-aware", {
      approved: 2,
      hiddenWriter: 0,
      hiddenContinuity: 0,
      referenceContinuity: 0,
      blockers: 1,
      halluc: 1,
      cost: 0.45,
    })

    expect(buildLiveAbDelta([legacy, roleAware])).toEqual({
      approvedChapters: 0,
      hiddenWriterFactsWithHit: -1,
      hiddenContinuityFactsWithHit: -1,
      referenceContinuityFactsWithHit: -1,
      blockerWarnings: -2,
      hallucBlockerIssues: -1,
      costUsd: -0.04999999999999999,
    })
  })

  test("rendered report carries the key A/B evidence", () => {
    const report: LiveAbReport = {
      generatedAt: "2026-05-05T00:00:00.000Z",
      sourceNovelId: "source-novel",
      chapters: 2,
      outputBase: "/tmp/fact-role-ab",
      injectedFixture: "tests/role-context-policy-fixtures/reference-hidden-basic.json",
      sourcePreflight: {
        sourceNovelId: "source-novel",
        phase: "drafting",
        totalChapters: 2,
        outlineCount: 2,
        roleCounts: { operational: 1, reference: 1, hidden: 1, unknown: 0 },
        nonOperationalFacts: 2,
      },
      sourceContextPreview: {} as LiveAbReport["sourceContextPreview"],
      arms: [
        arm("legacy", { approved: 2, hiddenWriter: 1, hiddenContinuity: 1, referenceContinuity: 1, blockers: 1, halluc: 0, cost: 0.1 }),
        arm("role-aware", { approved: 2, hiddenWriter: 0, hiddenContinuity: 0, referenceContinuity: 0, blockers: 0, halluc: 0, cost: 0.1 }),
      ],
      delta: null,
    }
    report.delta = buildLiveAbDelta(report.arms)

    const rendered = renderLiveAbReport(report)

    expect(rendered).toContain("# Fact Role Context Live A/B")
    expect(rendered).toContain("role-aware minus legacy")
    expect(rendered).toContain("hiddenWriterFactsWithHit: -1")
    expect(rendered).toContain("| role-aware | novel-role-aware | true | 2/2")
  })

  test("parseArgs defaults to a two-chapter disposable eval output", () => {
    const args = parseArgs(["--source", "source-novel"])

    expect(args.source).toBe("source-novel")
    expect(args.chapters).toBe(2)
    expect(args.outputBase).toContain("output/evals/fact-role-context-live-ab")
    expect(args.keepNovels).toBe(false)
    expect(args.injectFixture).toBeNull()
  })
})

function fact(id: string, factText: string, role: RoleFactForExposure["role"]): RoleFactForExposure {
  return {
    id,
    fact: factText,
    category: "fixture",
    establishedInChapter: 1,
    role,
  }
}

function prompt(id: number, agent: string, userPrompt: string): PromptRowForExposure {
  return {
    id,
    agent,
    chapter: 2,
    beatIndex: 0,
    attempt: 1,
    userPrompt,
  }
}

function arm(
  policy: "legacy" | "role-aware",
  values: {
    approved: number
    hiddenWriter: number
    hiddenContinuity: number
    referenceContinuity: number
    blockers: number
    halluc: number
    cost: number
  },
): ArmRunSummary {
  return {
    policy,
    novelId: `novel-${policy}`,
    process: {
      exitCode: 0,
      signal: null,
      stdoutPath: `/tmp/${policy}.stdout.log`,
      stderrPath: `/tmp/${policy}.stderr.log`,
    },
    novel: {
      phase: "done",
      currentChapter: 1,
      totalChapters: 2,
      completed: true,
    },
    roleCounts: { operational: 1, reference: 1, hidden: 1, unknown: 0 },
    promptExposure: {
      byRole: {
        operational: exposureRole("operational", 1, 1, 1),
        reference: exposureRole("reference", 1, 1, values.referenceContinuity),
        hidden: exposureRole("hidden", 1, values.hiddenWriter, values.hiddenContinuity),
        unknown: exposureRole("unknown", 0, 0, 0),
      },
    },
    drafts: {
      latestChapters: values.approved,
      approvedChapters: values.approved,
      totalWords: 2400,
      rows: [],
    },
    llm: {
      calls: 10,
      failedCalls: 0,
      costUsd: values.cost,
      agents: [],
    },
    checker: {
      planDrift: {} as ArmRunSummary["checker"]["planDrift"],
      warnings: {
        novelId: `novel-${policy}`,
        totalItems: values.blockers,
        bySeverity: { blocker: values.blockers },
        chapters: [],
      },
      hallucUngrounded: {
        calls: 2,
        blockerIssues: values.halluc,
      },
    },
  }
}

function exposureRole(
  role: "operational" | "reference" | "hidden" | "unknown",
  factCount: number,
  writerHits: number,
  continuityHits: number,
) {
  return {
    role,
    factCount,
    factsWithWriterHit: writerHits,
    factsWithContinuityHit: continuityHits,
    writerPromptHits: writerHits,
    continuityPromptHits: continuityHits,
    samples: [],
  }
}
