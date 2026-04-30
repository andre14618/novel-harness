/**
 * Shared factory for the `./beat-checks` module mock used by drafting tests.
 *
 * Why this exists: `bun:test` `mock.module()` is process-global. When
 * `drafting-revision-used-persistence.test.ts` or `drafting-reviser-escalation.test.ts`
 * installs a mock, that mock persists for every later-loaded test file in
 * the same `bun test src/` run — including `beat-checks.test.ts`, which
 * imports the REAL named exports (`aggregateIssues`, `formatRetryLine`,
 * `summarizeIssues`). If the mock doesn't provide those exports or provides
 * a divergent implementation, `beat-checks.test.ts` either errors on missing
 * imports or fails on behavior assertions. See exp #246 and the 2026-04-20
 * halluc-ungrounded wiring-in commit for the history.
 *
 * This factory returns a fresh mock object shaped exactly like the real
 * `./beat-checks` module — including `formatRetryLine` with its full
 * resolution-space suffix. Each drafting test file calls
 * `mock.module("./beat-checks", buildBeatChecksMock)`, with any per-test
 * overrides spread on top.
 *
 * Exporting from `src/phases/` (same directory as the real module) keeps
 * the relative import shape natural for tests in that directory.
 */

import type { BeatIssue, RawCheckerOutputs } from "./beat-checks"
import type { WriterLeakProfile } from "../models/roles"

// Keep this function in sync with `formatRetryLine` in beat-checks.ts. The
// pinned test in beat-checks.test.ts catches drift on the real impl; this
// mirror catches drift on the mock.
function mirroredFormatRetryLine(issue: BeatIssue): string {
  switch (issue.source) {
    case "halluc-ungrounded":
      return `${issue.description} — Fix: replace with an entity from the beat brief or world bible, or remove the reference entirely. Do not invent new named entities.`
    case "halluc-leak-salvatore":
      return `${issue.description} — Fix: remove the token or replace with a generic descriptor (e.g. "the drow warrior" instead of a Salvatore-corpus proper name).`
    case "adherence":
    default:
      return issue.description
  }
}

export function buildBeatChecksMock() {
  return {
    runBeatChecks: async () => ({ pass: true, issues: [] as BeatIssue[], retryLines: [] as string[] }),
    shouldRunLeakChecker: (profile: WriterLeakProfile | null) => profile === "salvatore",
    formatRetryLine: mirroredFormatRetryLine,
    aggregateIssues: (outputs: RawCheckerOutputs) => {
      const issues: BeatIssue[] = []
      for (const s of outputs.adherence) issues.push({ source: "adherence", severity: "blocker", description: s })
      for (const s of outputs.ungrounded) issues.push({ source: "halluc-ungrounded", severity: "blocker", description: s })
      for (const s of outputs.leak) issues.push({ source: "halluc-leak-salvatore", severity: "blocker", description: s })
      return {
        pass: issues.every(i => i.severity !== "blocker"),
        issues,
        retryLines: issues.map(mirroredFormatRetryLine),
      }
    },
    summarizeIssues: (issues: BeatIssue[]) => {
      if (issues.length === 0) return "no issues"
      const bySource: Record<string, string[]> = {}
      for (const i of issues) {
        ;(bySource[i.source] ??= []).push(i.description)
      }
      return Object.entries(bySource)
        .map(([src, descs]) => `${src}(${descs.length}): ${descs.join("; ")}`)
        .join(" | ")
    },
  }
}
