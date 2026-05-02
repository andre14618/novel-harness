import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendLaneEvent,
  assessLane,
  field,
  laneEventLogPath,
  laneIdFromPath,
  normalizePanels,
  parseLaneDoc,
  readLaneEvents,
  summarizeOperatorJson,
} from "./lane-core"

const COMPLETE_DOC = `---
status: active
---

# L50 Example

## Loop Contract

- Objective: validate prior context
- Starting commit: abc123
- Experiment ID: 400
- Budget cap: $4
- Primary lane: L38-A prior context
- Causal hypothesis: prior facts reduce continuity bails
- Baseline: current context
- Changed runtime lever: reader-info state
- Feedback signal: continuity blockers
- Stop gate: two seeds reach chapter 3
- Escalation rule: stop on regression
- Allowed parallel support work: replay harness
- DeepSeek V4 Flash concurrency plan: fixed panel N=20
- Deferred out-of-lane runtime changes: continuity threshold
- Files/scripts expected to change: src/agents/writer/beat-context.ts
- Evidence artifact: phase_eval_runs row

## Results

- Outcome:
- Stop gate fired:
`

describe("lane doc parsing", () => {
  test("parses section fields and derives lane id", () => {
    const doc = parseLaneDoc(COMPLETE_DOC, "docs/sessions/2026-05-02-L50-example.md")
    expect(doc.laneId).toBe("2026-05-02-L50-example")
    expect(field(doc, "Loop Contract", "Primary lane")).toBe("L38-A prior context")
    expect(field(doc, "loop contract", "deepseek v4 flash concurrency plan")).toBe("fixed panel N=20")
  })

  test("parses indented continuation lines for multi-line result fields", () => {
    const doc = parseLaneDoc(`## Results

- Outcome: done
- Evidence link/row/path:
  - chapter_exhaustions.id=84
  - llm_calls.id=58325
- Commit(s): abc123
`, "docs/sessions/lane.md")
    expect(field(doc, "results", "evidence link/row/path")).toBe("- chapter_exhaustions.id=84\n- llm_calls.id=58325")
    expect(field(doc, "results", "commit(s)")).toBe("abc123")
  })

  test("laneIdFromPath sanitizes spaces", () => {
    expect(laneIdFromPath("docs/sessions/My Lane.md")).toBe("My-Lane")
  })
})

describe("lane assessment", () => {
  const now = new Date("2026-05-02T12:00:00Z")

  test("complete lane with fresh heartbeat continues", () => {
    const doc = parseLaneDoc(COMPLETE_DOC, "docs/sessions/lane.md")
    const status = assessLane(doc, [{ ts: "2026-05-02T11:59:00Z", type: "heartbeat", status: "continue" }], { now })
    expect(status.state).toBe("continue")
    expect(status.missingRequired).toEqual([])
  })

  test("missing required fields blocks", () => {
    const doc = parseLaneDoc("## Loop Contract\n\n- Objective: only objective\n", "docs/sessions/lane.md")
    const status = assessLane(doc, [], { now })
    expect(status.state).toBe("blocked")
    expect(status.reason).toContain("missing")
    expect(status.missingRequired.length).toBeGreaterThan(1)
  })

  test("result stop gate stops even when heartbeat is fresh", () => {
    const doc = parseLaneDoc(COMPLETE_DOC.replace("- Stop gate fired:", "- Stop gate fired: (b) new blocker"), "docs/sessions/lane.md")
    const status = assessLane(doc, [{ ts: "2026-05-02T11:59:00Z", type: "heartbeat", status: "continue" }], { now })
    expect(status.state).toBe("stop")
    expect(status.reason).toContain("new blocker")
  })

  test("stale heartbeat blocks", () => {
    const doc = parseLaneDoc(COMPLETE_DOC, "docs/sessions/lane.md")
    const status = assessLane(doc, [{ ts: "2026-05-02T11:00:00Z", type: "heartbeat", status: "continue" }], { now, staleMinutes: 10 })
    expect(status.state).toBe("blocked")
    expect(status.reason).toContain("stale")
  })

  test("latest non-continue event state wins", () => {
    const doc = parseLaneDoc(COMPLETE_DOC, "docs/sessions/lane.md")
    const status = assessLane(doc, [{ ts: "2026-05-02T11:59:00Z", type: "blocked", status: "human-needed", message: "choose seed" }], { now })
    expect(status.state).toBe("human-needed")
    expect(status.reason).toContain("choose seed")
  })
})

describe("event log helpers", () => {
  test("appendLaneEvent writes JSONL that readLaneEvents loads", () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-core-"))
    const path = join(dir, "events.jsonl")
    appendLaneEvent(path, { ts: "2026-05-02T12:00:00Z", type: "heartbeat", actor: "test", status: "continue" })
    expect(readFileSync(path, "utf8")).toContain("heartbeat")
    const events = readLaneEvents(path)
    expect(events).toHaveLength(1)
    expect(events[0]!.actor).toBe("test")
  })

  test("laneEventLogPath uses output/agent-runs/<lane>/events.jsonl", () => {
    expect(laneEventLogPath("docs/sessions/L50.md")).toBe("output/agent-runs/L50/events.jsonl")
  })
})

describe("operator-summary JSON summarizer", () => {
  test("summarizes cost, calls, and latest gate", () => {
    const lines = summarizeOperatorJson({
      novel: {
        id: "novel-1",
        seed_json: { seed: "fantasy-debt" },
        phase: "drafting",
        current_chapter: 2,
        total_chapters: 3,
      },
      agentCosts: [
        { cost: 0.01, calls: 3, failed_calls: 0 },
        { cost: 0.02, calls: 2, failed_calls: 1 },
      ],
      exhaustions: [
        { id: 7, chapter: 2, attempt: 1, kind: "plan-check-exhausted", decision: null },
      ],
    })
    expect(lines[0]).toContain("novel-1")
    expect(lines[1]).toContain("$0.0300")
    expect(lines[1]).toContain("pending_gates=1")
    expect(lines[2]).toContain("latest pending gate")
    expect(lines[2]).toContain("#7")
  })

  test("summarizes resolved gates without presenting them as pending", () => {
    const lines = summarizeOperatorJson({
      novel: {
        id: "novel-1",
        seed_json: { seed: "fantasy-debt" },
        phase: "drafting",
        current_chapter: 2,
        total_chapters: 3,
      },
      agentCosts: [],
      exhaustions: [
        { id: 7, chapter: 2, attempt: 1, kind: "plan-check-exhausted", decision: "orphaned" },
      ],
    })
    expect(lines[1]).toContain("pending_gates=0")
    expect(lines[2]).toContain("pending gates clear")
    expect(lines[2]).toContain("ORPHANED")
  })
})

describe("monitor panel parsing", () => {
  test("defaults to all", () => {
    expect(normalizePanels([])).toEqual(["all"])
  })

  test("accepts repeated and comma-separated panels", () => {
    expect(normalizePanels(["outside,evidence", "hygiene"])).toEqual(["outside", "evidence", "hygiene"])
  })

  test("rejects unknown panels", () => {
    expect(() => normalizePanels(["unknown"])).toThrow("unknown monitor panel")
  })
})
