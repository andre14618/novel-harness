/**
 * Context builder for lint-improver agent.
 *
 * Minimal context: writer prompt + lint target + this cycle's attempts.
 * The agent makes narrow edits (one NEVER rule, one before/after example).
 * Git diffs and experiment history add noise without improving the edit.
 */

import { readFileSync } from "node:fs"

const HARNESS_ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const WRITER_PROMPT_PATH = `${HARNESS_ROOT}/src/agents/writer/prompt.md`

export function loadWriterPrompt(): string {
  return readFileSync(WRITER_PROMPT_PATH, "utf-8")
}

export interface LintSnapshot {
  totalIssues: number
  totalAfterFix: number
  categories: Record<string, number>
  persistentCategories: Record<string, number>
}

export function buildImprovementContext(
  snapshot: LintSnapshot,
  iterationNum: number,
  maxIterations: number,
  previousAttempts: string[],
): string {
  const writerPrompt = loadWriterPrompt()

  const topCategory = Object.entries(snapshot.persistentCategories)
    .sort((a, b) => b[1] - a[1])[0]

  const allCategories = Object.entries(snapshot.categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([cat, count]) => `  ${cat}: ${count}`)
    .join("\n")

  let context = `WRITER PROMPT:\n${writerPrompt}\n\n`

  context += `TARGET: ${topCategory ? `${topCategory[0]} (${topCategory[1]} persistent issues)` : "lowest total count"}\n\n`

  context += `LINT COUNTS (${snapshot.totalIssues} total, ${snapshot.totalAfterFix} persistent):\n${allCategories}\n\n`

  context += `Iteration ${iterationNum}/${maxIterations}\n`

  if (previousAttempts.length > 0) {
    context += `\nPREVIOUS THIS CYCLE:\n${previousAttempts.slice(-3).join("\n")}\n`
  }

  return context
}
