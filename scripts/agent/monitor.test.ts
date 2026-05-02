import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findLatestLaneDoc, parseArgs } from "./monitor"

const COMPLETE_DOC = `# Complete

## Loop Contract

- Objective: objective
- Starting commit: abc123
- Experiment ID: 1
- Budget cap: $1
- Primary lane: lane
- Causal hypothesis: hypothesis
- Baseline: baseline
- Changed runtime lever: lever
- Feedback signal: signal
- Stop gate: gate
- Escalation rule: rule
- Allowed parallel support work: tests
- DeepSeek V4 Flash concurrency plan: none
- Deferred out-of-lane runtime changes: none
- Evidence artifact: doc
`

const LEGACY_DOC = `# Legacy

## Results

- Outcome: done
`

describe("monitor args", () => {
  test("defaults to watch and latest novel", () => {
    const args = parseArgs([])
    expect(args.watch).toBe(true)
    expect(args.latestNovel).toBe(true)
    expect(args.append).toBe(false)
    expect(args.panels).toEqual(["all"])
  })

  test("parses append and explicit lane path", () => {
    const args = parseArgs(["docs/sessions/L.md", "--append", "--once", "--no-latest-novel"])
    expect(args.lanePath).toBe("docs/sessions/L.md")
    expect(args.append).toBe(true)
    expect(args.watch).toBe(false)
    expect(args.latestNovel).toBe(false)
  })

  test("parses repeated and comma-separated panels", () => {
    const args = parseArgs(["--panel", "outside,evidence", "--panel", "process"])
    expect(args.panels).toEqual(["outside", "evidence", "process"])
  })
})

describe("findLatestLaneDoc", () => {
  test("skips legacy incomplete docs when requireComplete=true", () => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-"))
    mkdirSync(dir, { recursive: true })
    const complete = join(dir, "2026-05-02-complete.md")
    const legacy = join(dir, "2026-05-03-legacy.md")
    writeFileSync(complete, COMPLETE_DOC)
    writeFileSync(legacy, LEGACY_DOC)
    utimesSync(complete, new Date("2026-05-02T00:00:00Z"), new Date("2026-05-02T00:00:00Z"))
    utimesSync(legacy, new Date("2026-05-03T00:00:00Z"), new Date("2026-05-03T00:00:00Z"))

    expect(findLatestLaneDoc(dir)).toBe(complete)
    expect(findLatestLaneDoc(dir, false)).toBe(legacy)
  })

  test("returns null when no complete docs exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-"))
    writeFileSync(join(dir, "legacy.md"), LEGACY_DOC)
    expect(findLatestLaneDoc(dir)).toBeNull()
  })
})
