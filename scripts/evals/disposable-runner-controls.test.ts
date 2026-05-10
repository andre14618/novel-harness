import { readFileSync } from "node:fs"

import { describe, expect, test } from "bun:test"

interface DisposableRunnerControl {
  command: string
  path: string
  flag: string
  assertionCall: string
  messageSnippet: string
}

const runnerControls: DisposableRunnerControl[] = [
  {
    command: "poc:scene-first-novella",
    path: "poc/scene-first-novella/run.ts",
    flag: "--allow-disposable-poc",
    assertionCall: "assertDisposablePocAllowed(args)",
    messageSnippet: "historical/disposable under L106",
  },
  {
    command: "diagnostics:corpus-recreation-poc",
    path: "scripts/evals/corpus-recreation-poc.ts",
    flag: "--allow-disposable-poc",
    assertionCall: "assertDisposablePocAllowed(args)",
    messageSnippet: "historical/disposable under L106",
  },
  {
    command: "diagnostics:plan-readiness-data-loop",
    path: "scripts/evals/plan-readiness-data-loop.ts",
    flag: "--allow-disposable-data-loop",
    assertionCall: "assertDisposableDataLoopAllowed(args)",
    messageSnippet: "disposable bridge smoke under L106",
  },
  {
    command: "eval:fact-role-context-live-ab",
    path: "scripts/evals/fact-role-context-live-ab.ts",
    flag: "--allow-disposable-ab",
    assertionCall: "assertDisposableAbAllowed(args)",
    messageSnippet: "disposable live A/B runner under L82/L106",
  },
  {
    command: "diagnostics:semantic-gate-baseline",
    path: "scripts/evals/semantic-gate-baseline.ts",
    flag: "--allow-disposable-baseline",
    assertionCall: "assertDisposableBaselineAllowed(args)",
    messageSnippet: "disposable clone runner under L86/L88/L106",
  },
  {
    command: "diagnostics:semantic-gate-matrix",
    path: "scripts/evals/semantic-gate-matrix.ts",
    flag: "--allow-disposable-matrix",
    assertionCall: "assertDisposableMatrixAllowed(args)",
    messageSnippet: "disposable clone matrix under L86/L88/L106",
  },
  {
    command: "diagnostics:semantic-gate-cohort-matrix",
    path: "scripts/evals/semantic-gate-cohort-matrix.ts",
    flag: "--allow-disposable-cohort",
    assertionCall: "assertDisposableCohortAllowed(args, liveSources.length)",
    messageSnippet: "live mode is disposable under L86/L88/L106",
  },
]

describe("L106 disposable runner controls", () => {
  for (const control of runnerControls) {
    test(`${control.command} requires an explicit disposable flag`, () => {
      const source = readFileSync(control.path, "utf8")

      expect(source).toContain(control.flag)
      expect(source).toContain(control.assertionCall)
      expect(source).toContain(control.messageSnippet)
    })
  }

  test("package scripts still map disposable commands to guarded files", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }

    for (const control of runnerControls.filter(item => item.command !== "poc:scene-first-novella")) {
      expect(pkg.scripts[control.command]).toContain(control.path)
    }
  })

  test("matrix and cohort runners propagate child disposable flags", () => {
    const matrix = readFileSync("scripts/evals/semantic-gate-matrix.ts", "utf8")
    const cohort = readFileSync("scripts/evals/semantic-gate-cohort-matrix.ts", "utf8")

    expect(matrix).toContain("--allow-disposable-baseline")
    expect(cohort).toContain("--allow-disposable-matrix")
  })
})
