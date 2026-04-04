/**
 * Context builder for lint-improver agent.
 *
 * Focused context: writer prompt + deep explanation of ONE target category
 * + the specific flagged instances from the prose + this cycle's attempts.
 */

import { readFileSync } from "node:fs"
import { getConceptForCategory, loadConceptContext } from "../../lint/concepts"

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
  /** Specific flagged instances per category (sentence-level) */
  instances?: Record<string, string[]>
}

export function buildImprovementContext(
  snapshot: LintSnapshot,
  iterationNum: number,
  maxIterations: number,
  previousAttempts: string[],
): string {
  const writerPrompt = loadWriterPrompt()

  // Find the top persistent category to target
  const targetEntry = Object.entries(snapshot.persistentCategories)
    .sort((a, b) => b[1] - a[1])[0]

  // Fall back to top total category if nothing persists
  const targetCategory = targetEntry?.[0]
    ?? Object.entries(snapshot.categories).sort((a, b) => b[1] - a[1])[0]?.[0]

  if (!targetCategory) {
    return `WRITER PROMPT:\n${writerPrompt}\n\nNo lint issues found. No changes needed.`
  }

  // Load deep context for THIS specific concept
  const concept = getConceptForCategory(targetCategory)
  const conceptContext = concept
    ? loadConceptContext(concept)
    : `Category: ${targetCategory}`

  // Get specific instances for this category
  const instances = snapshot.instances?.[targetCategory] ?? []
  const instanceText = instances.length > 0
    ? instances.slice(0, 6).map((s, i) => `  ${i + 1}. "${s.slice(0, 120)}"`).join("\n")
    : "(no specific instances captured)"

  let context = `WRITER PROMPT:\n${writerPrompt}\n\n`

  context += `TARGET CATEGORY: ${targetCategory} (${targetEntry?.[1] ?? 0} persistent issues)\n\n`

  context += `WHAT THIS DEFECT IS:\n${conceptContext}\n`

  context += `SPECIFIC INSTANCES IN CURRENT PROSE:\n${instanceText}\n\n`

  context += `ALL CATEGORIES: ${Object.entries(snapshot.categories).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(", ")}\n\n`

  context += `Iteration ${iterationNum}/${maxIterations}\n`

  if (previousAttempts.length > 0) {
    context += `\nPREVIOUS THIS CYCLE:\n${previousAttempts.slice(-3).join("\n")}\n`
  }

  return context
}
