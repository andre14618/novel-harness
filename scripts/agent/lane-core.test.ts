import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendLaneEvent,
  appendLaneMessage,
  assessLane,
  field,
  laneEventLogPath,
  laneIdFromPath,
  laneMessageLogPath,
  normalizePanels,
  parseLaneDoc,
  readLaneEvents,
  readLaneMessages,
  reduceLaneMessages,
  summarizeAgentActivity,
  summarizeLaneMessages,
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

describe("lane message bus helpers", () => {
  test("laneMessageLogPath uses output/agent-runs/<lane>/messages.jsonl", () => {
    expect(laneMessageLogPath("docs/sessions/L50.md")).toBe("output/agent-runs/L50/messages.jsonl")
  })

  test("appendLaneMessage writes JSONL that readLaneMessages loads", () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-message-"))
    const path = join(dir, "messages.jsonl")
    appendLaneMessage(path, {
      id: "msg-1",
      ts: "2026-05-02T12:00:00Z",
      lane: "L50",
      from: "captain",
      to: "evidence",
      kind: "request",
      status: "open",
      subject: "Monitor replay",
    })
    const messages = readLaneMessages(path)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.subject).toBe("Monitor replay")
  })

  test("reduceLaneMessages collapses claim and resolve updates by message id", () => {
    const reduced = reduceLaneMessages([
      {
        id: "msg-1",
        ts: "2026-05-02T12:00:00Z",
        lane: "L50",
        from: "captain",
        to: "evidence",
        kind: "request",
        status: "open",
        subject: "Monitor replay",
        refs: ["novel-1"],
      },
      {
        id: "msg-1",
        ts: "2026-05-02T12:01:00Z",
        lane: "L50",
        from: "captain",
        to: "evidence",
        kind: "request",
        status: "claimed",
        subject: "Monitor replay",
        claimBy: "evidence",
        leaseUntil: "2026-05-02T12:31:00Z",
      },
      {
        id: "msg-1",
        ts: "2026-05-02T12:02:00Z",
        lane: "L50",
        from: "captain",
        to: "evidence",
        kind: "request",
        status: "resolved",
        subject: "Monitor replay",
        resolvedBy: "evidence",
        result: "row #84 found",
      },
    ])
    expect(reduced).toHaveLength(1)
    expect(reduced[0]!.status).toBe("resolved")
    expect(reduced[0]!.claimBy).toBe("evidence")
    expect(reduced[0]!.refs).toEqual(["novel-1"])
    expect(reduced[0]!.result).toBe("row #84 found")
  })

  test("summarizeLaneMessages highlights expired claimed work", () => {
    const lines = summarizeLaneMessages([
      {
        id: "msg-1",
        ts: "2026-05-02T12:00:00Z",
        lane: "L50",
        from: "captain",
        to: "evidence",
        kind: "request",
        status: "claimed",
        subject: "Monitor replay",
        claimBy: "evidence",
        leaseUntil: "2026-05-02T12:10:00Z",
      },
    ], "messages.jsonl", new Date("2026-05-02T12:11:00Z"))
    expect(lines[1]).toContain("expired_leases=1")
    expect(lines[2]).toContain("EXPIRED msg-1")
  })

  test("summarizeAgentActivity shows active worker, heartbeat, claimed work, and latest result", () => {
    const lines = summarizeAgentActivity([
      {
        ts: "2026-05-02T12:00:00Z",
        type: "cycle_start",
        actor: "lane-runner",
        status: "continue",
        step: "cycle 1/4",
        workerId: "captain-claude",
        workerRole: "captain",
        workerEngine: "claude",
      },
      { ts: "2026-05-02T12:01:00Z", type: "heartbeat", actor: "captain-claude", status: "continue", step: "checking replay" },
    ], [
      {
        id: "msg-1",
        ts: "2026-05-02T12:00:30Z",
        lane: "L50",
        from: "captain-claude",
        to: "evidence",
        kind: "request",
        status: "claimed",
        subject: "Monitor replay",
        claimBy: "evidence-dsv4",
        leaseUntil: "2026-05-02T12:31:00Z",
      },
      {
        id: "msg-2",
        ts: "2026-05-02T12:00:40Z",
        lane: "L50",
        from: "evidence-dsv4",
        to: "captain",
        kind: "result",
        status: "resolved",
        subject: "Replay result",
        resolvedBy: "evidence-dsv4",
        result: "row #84 found",
      },
    ], new Date("2026-05-02T12:02:00Z"))
    expect(lines[0]).toContain("active runner worker: captain-claude")
    expect(lines[1]).toContain("latest heartbeat: captain-claude")
    expect(lines[2]).toContain("evidence-dsv4=1")
    expect(lines[3]).toContain("row #84 found")
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
    expect(normalizePanels(["outside,coordination,evidence", "hygiene"])).toEqual(["outside", "coordination", "evidence", "hygiene"])
  })

  test("rejects unknown panels", () => {
    expect(() => normalizePanels(["unknown"])).toThrow("unknown monitor panel")
  })
})
