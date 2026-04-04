/**
 * Context builder for lint-discoverer agent.
 *
 * Assembles: craft principles (from reference docs), existing rules (DB),
 * prose samples (DB), prior discovery history (DB experiments).
 */

import { readFileSync, existsSync } from "node:fs"
import db from "../../../data/connection"

const HARNESS_ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "")

// ── Craft principles from reference docs ──────────────────────────────────

function loadCraftPrinciples(): string {
  const docFiles = [
    "docs/ai-tells-emotional-echo.md",
    "docs/ai-tells-cliches-purple-prose.md",
    "docs/ai-tells-hedging-qualifying.md",
    "docs/ai-tells-rhythm-homogeneity.md",
  ]

  const sections: string[] = []
  for (const file of docFiles) {
    const fullPath = `${HARNESS_ROOT}/${file}`
    if (!existsSync(fullPath)) continue
    const content = readFileSync(fullPath, "utf-8")
    // Extract just the executive summary (first ~30 lines after frontmatter)
    const lines = content.split("\n")
    const summaryStart = lines.findIndex(l => l.startsWith("## Executive Summary"))
    if (summaryStart !== -1) {
      const summaryEnd = lines.findIndex((l, i) => i > summaryStart + 2 && l.startsWith("## "))
      const summary = lines.slice(summaryStart, summaryEnd !== -1 ? summaryEnd : summaryStart + 30).join("\n")
      sections.push(`### ${file}\n${summary.slice(0, 800)}`)
    }
  }

  // Also load lessons-learned lint section
  const lessonsPath = `${HARNESS_ROOT}/docs/lessons-learned.md`
  if (existsSync(lessonsPath)) {
    const lessons = readFileSync(lessonsPath, "utf-8")
    const lintStart = lessons.indexOf("## Lint & Deterministic Fixing")
    const lintEnd = lessons.indexOf("\n## ", lintStart + 10)
    if (lintStart !== -1) {
      sections.push(`### Lessons Learned — Lint\n${lessons.slice(lintStart, lintEnd !== -1 ? lintEnd : lintStart + 1000)}`)
    }
  }

  return sections.join("\n\n")
}

// ── Existing rules from DB ────────────────────────────────────────────────

async function loadExistingRules(): Promise<string> {
  const patterns = await db`
    SELECT category, pattern, fix_template, rationale
    FROM lint_patterns WHERE enabled = true
    ORDER BY category, id
  ` as any[]

  const byCategory = new Map<string, any[]>()
  for (const p of patterns) {
    const list = byCategory.get(p.category) ?? []
    list.push(p)
    byCategory.set(p.category, list)
  }

  return [...byCategory.entries()]
    .map(([cat, pats]) => {
      const regexExamples = pats
        .filter((p: any) => p.pattern !== "-- heuristic --")
        .slice(0, 3)
        .map((p: any) => `  /${p.pattern}/`)
        .join("\n")
      const heuristic = pats.some((p: any) => p.pattern === "-- heuristic --") ? " (+ heuristic detector)" : ""
      return `${cat} (${pats.length} rules${heuristic}):\n${regexExamples}`
    })
    .join("\n\n")
}

// ── Prior discovery history ───────────────────────────────────────────────

async function loadPriorDiscoveries(): Promise<string> {
  const experiments = await db`
    SELECT id, description, conclusion, created_at::date as date
    FROM tuning_experiments
    WHERE type = 'lint-discovery'
    AND conclusion IS NOT NULL
    ORDER BY id DESC
    LIMIT 5
  ` as any[]

  if (experiments.length === 0) return ""

  return experiments.map((e: any) =>
    `#${e.id} (${e.date}): ${e.conclusion?.slice(0, 200)}`
  ).join("\n")
}

// ── Prose samples ─────────────────────────────────────────────────────────

async function loadProseSamples(runId?: number, limit = 6): Promise<string[]> {
  const rows = runId
    ? await db`SELECT prose FROM generations WHERE run_id = ${runId} AND prose IS NOT NULL ORDER BY seed, attempt LIMIT ${limit}`
    : await db`SELECT prose FROM generations WHERE prose IS NOT NULL ORDER BY id DESC LIMIT ${limit}`
  return (rows as any[]).map(r => r.prose).filter(Boolean)
}

// ── Main context builder ──────────────────────────────────────────────────

export async function buildDiscoveryContext(runId?: number): Promise<string> {
  const [craftPrinciples, existingRules, priorDiscoveries, proseSamples] = await Promise.all([
    Promise.resolve(loadCraftPrinciples()),
    loadExistingRules(),
    loadPriorDiscoveries(),
    loadProseSamples(runId),
  ])

  let context = `## CRAFT PRINCIPLES (from reference documentation)\n\n${craftPrinciples}\n\n`
  context += `## EXISTING LINT RULES (do NOT duplicate)\n\n${existingRules}\n\n`

  if (priorDiscoveries) {
    context += `## PRIOR DISCOVERY RESULTS\n\n${priorDiscoveries}\n\n`
  }

  context += `## PROSE SAMPLES (${proseSamples.length} samples)\n\n`
  context += proseSamples
    .map((p, i) => `--- Sample ${i + 1} (${p.split(/\s+/).length} words) ---\n${p.slice(0, 1800)}`)
    .join("\n\n")

  return context
}
