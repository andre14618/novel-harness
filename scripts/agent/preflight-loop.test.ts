import { describe, expect, test } from "bun:test"
import { parseLaneDoc } from "./lane-core"
import {
  exitCodeForResult,
  parseArgs,
  renderPreflightResult,
  runPreflightChecks,
  type PreflightContext,
} from "./preflight-loop"

const COMPLETE_LANE = `---
status: active
updated: 2026-05-02
---

# L99 Fixture Lane

## Loop Contract

- Objective: Build a fixture lane.
- Starting commit: abc1234
- Experiment ID: 999
- Budget cap: $1.
- Primary lane: L99 fixture.
- Causal hypothesis: This is the hypothesis.
- Baseline: existing behavior.
- Changed runtime lever: None.
- Feedback signal: tests pass.
- Stop gate: Stop on (a)/(b)/(c).
- Escalation rule: stop and ask.
- Allowed parallel support work: tests, docs.
- DeepSeek V4 Flash concurrency plan: None.
- Deferred out-of-lane runtime changes: none.
- Files/scripts expected to change: scripts/agent/foo.ts, tests.
- Evidence artifact: Experiment #999.
`

function ctxFromDoc(doc: string, opts: { dirty?: string[]; resolveCommit?: (sha: string) => boolean } = {}): PreflightContext {
  return {
    doc: parseLaneDoc(doc, "docs/sessions/fixture.md"),
    dirtyFiles: opts.dirty ?? [],
    resolveCommit: opts.resolveCommit ?? (sha => sha === "abc1234"),
  }
}

describe("preflight-loop checks", () => {
  test("complete lane on a clean tree passes", () => {
    const result = runPreflightChecks(ctxFromDoc(COMPLETE_LANE), { allowDirty: false })
    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
    expect(exitCodeForResult(result)).toBe(0)
    expect(renderPreflightResult(result)).toContain("PASS")
  })

  test("missing required loop contract field fails with code 10", () => {
    const broken = COMPLETE_LANE.replace("- Experiment ID: 999\n", "")
    const result = runPreflightChecks(ctxFromDoc(broken), { allowDirty: false })
    expect(result.ok).toBe(false)
    const failureNames = result.failures.map(f => f.name)
    expect(failureNames).toContain("loop contract complete")
    expect(failureNames).toContain("experiment id numeric")
    expect(exitCodeForResult(result)).toBe(10)
  })

  test("non-numeric experiment id fails", () => {
    const broken = COMPLETE_LANE.replace("- Experiment ID: 999", "- Experiment ID: TBD")
    const result = runPreflightChecks(ctxFromDoc(broken), { allowDirty: false })
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.name === "experiment id numeric")).toBe(true)
    expect(exitCodeForResult(result)).toBe(10)
  })

  test("missing files/scripts scope fails with lane-context code", () => {
    const broken = COMPLETE_LANE.replace(
      "- Files/scripts expected to change: scripts/agent/foo.ts, tests.\n",
      "",
    )
    const result = runPreflightChecks(ctxFromDoc(broken), { allowDirty: false })
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.name === "files/scripts expected to change declared")).toBe(true)
    expect(exitCodeForResult(result)).toBe(10)
  })

  test("unresolvable starting commit fails with git-infra exit code", () => {
    const ctx = ctxFromDoc(COMPLETE_LANE, { resolveCommit: () => false })
    const result = runPreflightChecks(ctx, { allowDirty: false })
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.name === "starting commit resolves" && f.code === "git-infra")).toBe(true)
    expect(exitCodeForResult(result)).toBe(22)
  })

  test("empty starting commit fails as lane-context, not git-infra", () => {
    const broken = COMPLETE_LANE.replace("- Starting commit: abc1234", "- Starting commit: ")
    const result = runPreflightChecks(ctxFromDoc(broken), { allowDirty: false })
    expect(result.ok).toBe(false)
    const startingCommitFailure = result.failures.find(f => f.name === "starting commit resolves")
    expect(startingCommitFailure?.code).toBe("lane-context")
    expect(exitCodeForResult(result)).toBe(10)
  })

  test("dirty worktree fails by default with code 20", () => {
    const ctx = ctxFromDoc(COMPLETE_LANE, { dirty: ["src/a.ts", "scripts/b.ts"] })
    const result = runPreflightChecks(ctx, { allowDirty: false })
    expect(result.ok).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.name).toBe("worktree clean")
    expect(exitCodeForResult(result)).toBe(20)
  })

  test("--allow-dirty turns dirty worktree into a pass", () => {
    const ctx = ctxFromDoc(COMPLETE_LANE, { dirty: ["src/a.ts"] })
    const result = runPreflightChecks(ctx, { allowDirty: true })
    expect(result.ok).toBe(true)
    expect(exitCodeForResult(result)).toBe(0)
    const worktree = result.checks.find(c => c.name === "worktree clean")
    expect(worktree?.message).toContain("dirty allowed")
  })

  test("multiple distinct failure codes resolve to lane-context (10)", () => {
    // Lane-context + dirty-worktree → 10 (not 20, because lane-context dominates)
    const broken = COMPLETE_LANE.replace("- Experiment ID: 999", "- Experiment ID: TBD")
    const ctx = ctxFromDoc(broken, { dirty: ["src/a.ts"] })
    const result = runPreflightChecks(ctx, { allowDirty: false })
    expect(result.ok).toBe(false)
    expect(exitCodeForResult(result)).toBe(10)
  })

  test("git-infra dominates other codes", () => {
    const broken = COMPLETE_LANE.replace("- Experiment ID: 999", "- Experiment ID: TBD")
    const ctx = ctxFromDoc(broken, { dirty: ["src/a.ts"], resolveCommit: () => false })
    const result = runPreflightChecks(ctx, { allowDirty: false })
    expect(result.ok).toBe(false)
    expect(exitCodeForResult(result)).toBe(22)
  })
})

describe("preflight-loop CLI args", () => {
  test("parses lane path with default flags", () => {
    const args = parseArgs(["docs/sessions/fixture.md"])
    expect(args.lanePath).toBe("docs/sessions/fixture.md")
    expect(args.allowDirty).toBe(false)
    expect(args.json).toBe(false)
  })

  test("parses --allow-dirty and --json", () => {
    const args = parseArgs(["docs/sessions/fixture.md", "--allow-dirty", "--json"])
    expect(args.allowDirty).toBe(true)
    expect(args.json).toBe(true)
  })

  test("rejects unknown flag", () => {
    expect(() => parseArgs(["docs/sessions/fixture.md", "--bogus"])).toThrow(/unknown arg/)
  })

  test("requires a lane path", () => {
    expect(() => parseArgs([])).toThrow(/requires a lane/)
  })
})
