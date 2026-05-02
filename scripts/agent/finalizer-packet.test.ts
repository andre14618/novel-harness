import { describe, expect, test } from "bun:test"
import { parseArgs, renderFinalizerPacket, type FinalizerPacket } from "./finalizer-packet"

describe("finalizer-packet args", () => {
  test("parses packet inputs", () => {
    const args = parseArgs([
      "docs/sessions/L50.md",
      "--result", "new blocker",
      "--commit", "abc123",
      "--evidence", "chapter_exhaustions#84",
      "--cost", "$0.12",
      "--message", "[docs] finalize L50",
      "--output", "output/packet.md",
      "--print",
    ])
    expect(args.lanePath).toBe("docs/sessions/L50.md")
    expect(args.result).toBe("new blocker")
    expect(args.commits).toEqual(["abc123"])
    expect(args.evidence).toEqual(["chapter_exhaustions#84"])
    expect(args.outputPath).toBe("output/packet.md")
    expect(args.print).toBe(true)
  })
})

describe("finalizer-packet rendering", () => {
  test("renders required, supporting, and inventory tiers", () => {
    const packet: FinalizerPacket = {
      generatedAt: "2026-05-02T12:00:00Z",
      lanePath: "docs/sessions/L50.md",
      laneId: "L50",
      result: "pass",
      cost: "$0.12",
      requestedDocsCommitMessage: "[docs] finalize L50",
      required: {
        laneFields: { objective: "finish lane" },
        suppliedCommits: ["abc123"],
        suppliedEvidence: ["experiment#400"],
        currentResults: { outcome: "", stopGateFired: "", evidence: "", cost: "", commits: "" },
      },
      supporting: {
        git: {
          branch: "main",
          head: "abc123",
          statusShort: [],
          commitsSinceStartingCommit: ["abc123 [docs] test"],
          suppliedCommitSummaries: ["abc123 [docs] test"],
        },
        recentEvents: [],
        activeMessages: [],
        resolvedMessages: [],
      },
      inventory: {
        eventLogPath: "output/events.jsonl",
        messageLogPath: "output/messages.jsonl",
        durableDocs: ["docs/current-state.md"],
        warnings: [],
      },
    }
    const rendered = renderFinalizerPacket(packet)
    expect(rendered).toContain("## Required Evidence")
    expect(rendered).toContain("## Supporting Context")
    expect(rendered).toContain("## Inventory")
    expect(rendered).toContain("experiment#400")
  })
})
