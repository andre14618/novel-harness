import { describe, expect, test } from "bun:test"
import {
  buildPanel,
  extractFindings,
  panelToJsonl,
  renderPanelSummary,
  stridedSample,
  type ContinuityCallRow,
} from "./continuity-grayzone-extract"

describe("continuity-grayzone-extract", () => {
  test("extracts both contradictions and violations from the right agents", () => {
    const rows: ContinuityCallRow[] = [
      {
        id: 100,
        agent: "continuity-facts",
        novel_id: "novel-a",
        chapter: 2,
        attempt: 1,
        timestamp: "2026-05-04T12:00:00Z",
        user_prompt: "CHAPTER DRAFT:\nProse paragraph one. Prose paragraph two.\n\nFACTS:\n- alpha\n",
        response_content: JSON.stringify({
          contradictions: [
            {
              fact: "[ch1] [physical] hand was bandaged",
              severity: "blocker",
              evidence: "her hand was bare",
              reasoning: "the bandage from ch1 is gone with no on-page change",
            },
            {
              fact: "[ch1] [emotional] character is tired",
              severity: "warning",
              evidence: "she sprinted up the stairs",
              reasoning: "the prose contradicts her stated exhaustion",
            },
          ],
        }),
      },
      {
        id: 200,
        agent: "continuity-state",
        novel_id: "novel-a",
        chapter: 2,
        attempt: 1,
        timestamp: "2026-05-04T12:00:01Z",
        user_prompt: "CHAPTER DRAFT:\nState prose body.\n\nCHARACTER STATES:\n- alpha\n",
        response_content: JSON.stringify({
          violations: [
            {
              character: "Maret",
              type: "knowledge",
              severity: "warning",
              evidence: "Maret references the Compiler's prediction",
              reasoning: "Maret has not learned about the Compiler in any prior chapter",
            },
          ],
        }),
      },
    ]

    const findings = extractFindings(rows, 200)
    expect(findings).toHaveLength(3)

    const factBlocker = findings.find((f) => f.findingId === "100:facts:0")!
    expect(factBlocker.agent).toBe("continuity-facts")
    expect(factBlocker.severity).toBe("blocker")
    expect(factBlocker.polarity).toBe("ambiguous")
    expect(factBlocker.subject).toContain("hand was bandaged")
    expect(factBlocker.stateType).toBeNull()
    expect(factBlocker.proseExcerpt.startsWith("Prose paragraph one")).toBe(true)

    const stateWarning = findings.find((f) => f.findingId === "200:state:0")!
    expect(stateWarning.agent).toBe("continuity-state")
    expect(stateWarning.severity).toBe("warning")
    expect(stateWarning.polarity).toBe("ambiguous")
    expect(stateWarning.subject).toBe("Maret")
    expect(stateWarning.stateType).toBe("knowledge")
  })

  test("buildPanel stratifies by agent × severity and respects per-stratum target", () => {
    const findings = [
      ...buildSyntheticFindings("continuity-facts", "blocker", 12),
      ...buildSyntheticFindings("continuity-facts", "warning", 8),
      ...buildSyntheticFindings("continuity-facts", "nit", 3),
      ...buildSyntheticFindings("continuity-state", "blocker", 6),
      ...buildSyntheticFindings("continuity-state", "warning", 15),
      ...buildSyntheticFindings("continuity-state", "nit", 0),
    ]

    const panel = buildPanel(findings, {
      perStratumTarget: 5,
      proseExcerptCharCap: 1000,
      generatedAt: "2026-05-05T00:00:00Z",
    })

    expect(panel.totalFindings).toBe(44)
    expect(panel.polarityFilter).toBe("all")
    expect(panel.byPolarity).toEqual({ negative: 0, positive: 0, ambiguous: 44 })
    expect(panel.strata).toHaveLength(6)
    expect(panel.sampledFindings).toBe(5 + 5 + 3 + 5 + 5 + 0)

    const factsBlocker = panel.strata.find(
      (s) => s.key.agent === "continuity-facts" && s.key.severity === "blocker",
    )!
    expect(factsBlocker.total).toBe(12)
    expect(factsBlocker.sampled).toBe(5)

    const stateNit = panel.strata.find(
      (s) => s.key.agent === "continuity-state" && s.key.severity === "nit",
    )!
    expect(stateNit.total).toBe(0)
    expect(stateNit.sampled).toBe(0)
  })

  test("panelToJsonl emits one record per finding with stratum tag", () => {
    const findings = buildSyntheticFindings("continuity-facts", "warning", 3)
    const panel = buildPanel(findings, { perStratumTarget: 5 })
    const jsonl = panelToJsonl(panel)
    const lines = jsonl.trim().split("\n")
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      const parsed = JSON.parse(line)
      expect(parsed.stratum).toEqual({ agent: "continuity-facts", severity: "warning" })
      expect(parsed.polarity).toBe("ambiguous")
      expect(parsed.findingId).toBeDefined()
    }
  })

  test("buildPanel can filter to positive-polarity findings for adjudication", () => {
    const findings = [
      ...buildSyntheticFindings("continuity-facts", "blocker", 2, "negative"),
      ...buildSyntheticFindings("continuity-facts", "blocker", 3, "positive"),
      ...buildSyntheticFindings("continuity-state", "warning", 4, "positive"),
      ...buildSyntheticFindings("continuity-state", "warning", 5, "ambiguous"),
    ]

    const panel = buildPanel(findings, {
      polarityFilter: "positive",
      perStratumTarget: 10,
      generatedAt: "2026-05-05T00:00:00Z",
    })

    expect(panel.totalFindings).toBe(7)
    expect(panel.byPolarity).toEqual({ negative: 0, positive: 7, ambiguous: 0 })
    expect(panel.strata.find(s => s.key.agent === "continuity-facts" && s.key.severity === "blocker")!.sampled).toBe(3)
    expect(panel.strata.find(s => s.key.agent === "continuity-state" && s.key.severity === "warning")!.sampled).toBe(4)
    expect(renderPanelSummary(panel)).toContain("Polarity filter: positive")
  })

  test("renderPanelSummary lists every stratum with sampled/total", () => {
    const findings = [
      ...buildSyntheticFindings("continuity-facts", "blocker", 4),
      ...buildSyntheticFindings("continuity-state", "nit", 2),
    ]
    const panel = buildPanel(findings, { perStratumTarget: 5, generatedAt: "2026-05-05T00:00:00Z" })
    const text = renderPanelSummary(panel)
    expect(text).toContain("continuity-facts/blocker: 4/4 sampled")
    expect(text).toContain("continuity-state/nit: 2/2 sampled")
    expect(text).toContain("continuity-state/warning: 0/0 sampled")
  })

  test("stridedSample picks distinct items deterministically", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
    const first = stridedSample(items, 4, 7)
    const second = stridedSample(items, 4, 7)
    expect(first).toEqual(second)
    expect(new Set(first).size).toBe(4)
    expect(stridedSample(items, 0, 1)).toEqual([])
    expect(stridedSample(items, 99, 1).sort()).toEqual([...items].sort())
  })

  test("ignores malformed response_content and missing fields", () => {
    const rows: ContinuityCallRow[] = [
      {
        id: 1,
        agent: "continuity-facts",
        novel_id: null,
        chapter: null,
        attempt: null,
        timestamp: null,
        user_prompt: null,
        response_content: "not json",
      },
      {
        id: 2,
        agent: "continuity-facts",
        novel_id: null,
        chapter: null,
        attempt: null,
        timestamp: null,
        user_prompt: null,
        response_content: JSON.stringify({
          contradictions: [{ fact: "incomplete" /* missing severity / evidence / reasoning */ }],
        }),
      },
    ]
    const findings = extractFindings(rows)
    expect(findings).toHaveLength(0)
  })
})

function buildSyntheticFindings(
  agent: "continuity-facts" | "continuity-state",
  severity: "blocker" | "warning" | "nit",
  n: number,
  polarity: "negative" | "positive" | "ambiguous" = "ambiguous",
) {
  return Array.from({ length: n }, (_, i) => ({
    findingId: `${agent}:${severity}:${i}`,
    llmCallId: i,
    agent,
    novelId: `novel-${i}`,
    chapter: 1,
    attempt: 1,
    timestamp: "2026-05-05T00:00:00Z",
    severity,
    polarity,
    subject: `subject ${i}`,
    stateType: agent === "continuity-state" ? "location" : null,
    evidence: `evidence ${i}`,
    reasoning: `reasoning ${i}`,
    proseExcerpt: `prose ${i}`,
  }))
}
