#!/usr/bin/env bun
/**
 * Preflight wrapper — blocking gate before Codex implementation review.
 *
 * Runs, in order:
 *   1. `bun test src/`                                   — tests green
 *   2. `bunx tsc --noEmit`                               — no NEW type errors
 *   3. `bun scripts/lint/invariants-check.ts`            — invariants green
 *   4. `bun scripts/lint/invariants-check.ts --self-test` — fixture rot check
 *
 * Exits non-zero on any failure. Sits between subagent completion and
 * Phase 6 per `.claude/skills/implement-ticket.md` Phase 5.
 *
 * Step 2 (tsc) compares the new error count against a baseline of 26
 * pre-existing implicit-any errors recorded at invariant-ship time
 * (2026-04-19, commits ce6452c / 10ce979 / 7afe4dd / dedc0b6). If a new
 * error surfaces, the step fails. The baseline should be tightened when
 * the implicit-any debt is paid down.
 */

import { spawnSync } from "node:child_process"

const BASELINE_TSC_ERRORS = 26

/**
 * Baseline of pre-existing `bun test src/` failures. Now 0: T3 (exp #246)
 * resolved the cross-file `bun:test` mock-pollution issue that previously
 * caused `src/phases/beat-checks.test.ts` to SyntaxError when a sibling
 * drafting test ran first in the same process. The fix extends the two
 * `mock.module("./beat-checks", ...)` bodies in
 * `src/phases/drafting-reviser-escalation.test.ts` and
 * `src/phases/drafting-revision-used-persistence.test.ts` to re-export
 * the full beat-checks shape (`aggregateIssues` / `formatRetryLine` /
 * `summarizeIssues` with real-signature parity). With the baseline at 0,
 * any new failure fails preflight immediately instead of hiding in the
 * tolerance window.
 */
const BASELINE_TEST_FAILURES = 0

interface StepResult {
  name: string
  exitCode: number
  summary: string
}

function run(cmd: string, args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] })
  return {
    exitCode: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  }
}

function step1_tests(): StepResult {
  console.log("[preflight 1/4] bun test src/")
  const r = run("bun", ["test", "src/"])
  const combined = r.stdout + r.stderr
  const pass = Number(combined.match(/(\d+) pass/)?.[1] ?? "0")
  const fail = Number(combined.match(/(\d+) fail/)?.[1] ?? "0")
  const name = "bun test src/"
  if (fail > BASELINE_TEST_FAILURES) {
    process.stdout.write(r.stdout)
    process.stderr.write(r.stderr)
    return {
      name,
      exitCode: 1,
      summary: `${pass} pass / ${fail} fail (baseline ${BASELINE_TEST_FAILURES}) — NEW failures`,
    }
  }
  return {
    name,
    exitCode: 0,
    summary: `${pass} pass / ${fail} fail (${fail === BASELINE_TEST_FAILURES ? "at" : "under"} baseline ${BASELINE_TEST_FAILURES})`,
  }
}

function step2_tsc(): StepResult {
  console.log("[preflight 2/4] bunx tsc --noEmit")
  const r = run("bunx", ["tsc", "--noEmit"])
  const errorCount = (r.stdout + r.stderr).match(/error TS/g)?.length ?? 0
  const name = "bunx tsc --noEmit"
  if (errorCount > BASELINE_TSC_ERRORS) {
    process.stdout.write(r.stdout)
    process.stderr.write(r.stderr)
    return {
      name,
      exitCode: 1,
      summary: `${errorCount} errors (baseline ${BASELINE_TSC_ERRORS}) — NEW errors introduced`,
    }
  }
  return {
    name,
    exitCode: 0,
    summary: `${errorCount}/${BASELINE_TSC_ERRORS} baseline errors, no new`,
  }
}

function step3_invariantsDefault(): StepResult {
  console.log("[preflight 3/4] bun scripts/lint/invariants-check.ts")
  const r = run("bun", ["scripts/lint/invariants-check.ts"])
  process.stdout.write(r.stdout)
  process.stderr.write(r.stderr)
  const line = (r.stdout + r.stderr).match(/invariants-check:.*/)?.[0] ?? ""
  return {
    name: "invariants-check (default)",
    exitCode: r.exitCode,
    summary: line || (r.exitCode === 0 ? "green" : "failed"),
  }
}

function step4_invariantsSelfTest(): StepResult {
  console.log("[preflight 4/4] bun scripts/lint/invariants-check.ts --self-test")
  const r = run("bun", ["scripts/lint/invariants-check.ts", "--self-test"])
  process.stdout.write(r.stdout)
  process.stderr.write(r.stderr)
  const line = (r.stdout + r.stderr).match(/invariants-check --self-test:.*/)?.[0] ?? ""
  return {
    name: "invariants-check --self-test",
    exitCode: r.exitCode,
    summary: line || (r.exitCode === 0 ? "green" : "failed"),
  }
}

async function main(): Promise<void> {
  const results: StepResult[] = []
  let firstFailure: StepResult | null = null
  for (const stepFn of [step1_tests, step2_tsc, step3_invariantsDefault, step4_invariantsSelfTest]) {
    const r = stepFn()
    results.push(r)
    if (r.exitCode !== 0 && !firstFailure) firstFailure = r
  }

  console.log("")
  console.log("─".repeat(60))
  console.log("PREFLIGHT SUMMARY")
  console.log("─".repeat(60))
  for (const r of results) {
    const marker = r.exitCode === 0 ? "✓" : "✗"
    console.log(`${marker} ${r.name}: ${r.summary}`)
  }
  console.log("─".repeat(60))

  if (firstFailure) {
    console.error(`\npreflight FAILED at "${firstFailure.name}" — halting before Codex review`)
    process.exit(1)
  }
  console.log("\npreflight PASS — ready for Phase 6 Codex implementation review")
  process.exit(0)
}

await main()
