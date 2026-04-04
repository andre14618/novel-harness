/**
 * Context builder for lint-improver agent.
 *
 * Assembles: current writer prompt, lint snapshot, previous cycle history
 * (from DB), git diffs of recent prompt changes, experiment conclusions.
 */

import { readFileSync, existsSync } from "node:fs"
import db from "../../../data/connection"

const HARNESS_ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")
const WRITER_PROMPT_PATH = `${HARNESS_ROOT}/src/agents/writer/prompt.md`

// ── Current writer prompt ─────────────────────────────────────────────────

export function loadWriterPrompt(): string {
  return readFileSync(WRITER_PROMPT_PATH, "utf-8")
}

// ── Previous lint-improvement cycles from DB ──────────────────────────────

async function loadPreviousCycles(): Promise<string> {
  const experiments = await db`
    SELECT id, description, conclusion, created_at::date as date,
           config->>'seeds' as seeds
    FROM tuning_experiments
    WHERE type = 'lint-improvement'
    AND conclusion IS NOT NULL
    ORDER BY id DESC
    LIMIT 5
  ` as any[]

  if (experiments.length === 0) return ""

  return "PREVIOUS LINT IMPROVEMENT CYCLES:\n" + experiments.map((e: any) =>
    `  #${e.id} (${e.date}): ${e.conclusion?.slice(0, 300)}`
  ).join("\n")
}

// ── Git diffs of recent writer prompt changes ─────────────────────────────

async function loadGitDiffs(): Promise<string> {
  try {
    const logProc = Bun.spawn(
      ["git", "log", "--oneline", "-8", "--follow", "--", "src/agents/writer/prompt.md"],
      { cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe" },
    )
    const logOutput = await new Response(logProc.stdout).text()
    await logProc.exited

    const commits = logOutput.trim().split("\n").filter(Boolean)
    if (commits.length === 0) return ""

    const diffs: string[] = []
    for (const line of commits.slice(0, 5)) {
      const sha = line.split(" ")[0]
      const msg = line.slice(sha.length + 1)
      const diffProc = Bun.spawn(
        ["git", "diff", `${sha}~1..${sha}`, "--", "src/agents/writer/prompt.md"],
        { cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe" },
      )
      const diffOutput = await new Response(diffProc.stdout).text()
      await diffProc.exited
      const trimmed = diffOutput.trim().slice(0, 600)
      if (trimmed) diffs.push(`--- ${sha} ${msg} ---\n${trimmed}`)
    }

    return diffs.length > 0 ? `RECENT PROMPT CHANGES (git log):\n${diffs.join("\n\n")}` : ""
  } catch { return "" }
}

// ── Lint category analysis from recent experiments ────────────────────────

async function loadLintTrends(): Promise<string> {
  // Get the last 3 lint-improvement runs and their category breakdowns
  const runs = await db`
    SELECT r.id as run_id, r.variant, r.created_at::date as date,
           COUNT(li.id) as total_issues,
           lp.category,
           COUNT(li.id) FILTER (WHERE li.resolved = 0) as unresolved
    FROM runs r
    JOIN generations g ON g.run_id = r.id
    JOIN lint_issues li ON li.generation_id = g.id
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    WHERE r.benchmark = 'lint-improve'
    GROUP BY r.id, r.variant, r.created_at, lp.category
    ORDER BY r.id DESC
    LIMIT 30
  ` as any[]

  if (runs.length === 0) return ""

  // Group by run
  const byRun = new Map<number, { variant: string; date: string; categories: Record<string, number> }>()
  for (const r of runs) {
    if (!byRun.has(r.run_id)) byRun.set(r.run_id, { variant: r.variant, date: r.date, categories: {} })
    byRun.get(r.run_id)!.categories[r.category] = r.total_issues
  }

  const lines = [...byRun.entries()].slice(0, 3).map(([id, data]) => {
    const cats = Object.entries(data.categories).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(", ")
    return `  Run ${id} (${data.variant}, ${data.date}): ${cats}`
  })

  return lines.length > 0 ? `LINT TRENDS (recent runs):\n${lines.join("\n")}` : ""
}

// ── Main context builder ──────────────────────────────────────────────────

export interface LintSnapshot {
  totalIssues: number
  totalAfterFix: number
  categories: Record<string, number>
  persistentCategories: Record<string, number>
}

export async function buildImprovementContext(
  lintSnapshot: LintSnapshot,
  iterationNum: number,
  maxIterations: number,
  previousAttempts: string[],
): Promise<string> {
  const [writerPrompt, previousCycles, gitDiffs, lintTrends] = await Promise.all([
    Promise.resolve(loadWriterPrompt()),
    loadPreviousCycles(),
    loadGitDiffs(),
    loadLintTrends(),
  ])

  const topAll = Object.entries(lintSnapshot.categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cat, count]) => `  ${cat}: ${count} issues`)
    .join("\n")

  const topPersistent = Object.entries(lintSnapshot.persistentCategories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat, count]) => `  ${cat}: ${count} issues`)
    .join("\n")

  let context = `CURRENT WRITER PROMPT:\n${writerPrompt}\n\n`

  context += `LINT RESULTS (${lintSnapshot.totalIssues} total, ${lintSnapshot.totalAfterFix} persistent after auto-fix):\n\n`
  context += `All issues by category:\n${topAll}\n\n`
  context += `Persistent issues (survive deterministic + LLM fixing):\n${topPersistent || "(none — all fixable)"}\n\n`

  context += `Iteration: ${iterationNum}/${maxIterations}\n\n`

  if (previousAttempts.length > 0) {
    context += `THIS CYCLE'S ATTEMPTS:\n${previousAttempts.join("\n")}\n\n`
  }

  if (previousCycles) context += `${previousCycles}\n\n`
  if (gitDiffs) context += `${gitDiffs}\n\n`
  if (lintTrends) context += `${lintTrends}\n\n`

  return context
}
