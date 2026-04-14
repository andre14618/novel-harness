/**
 * Context builder for lint-discoverer agent.
 *
 * Minimal context: prose samples + existing rule names (to avoid duplication).
 * Craft principles live in the agent antipattern-discoverer-system.md — they're static methodology,
 * not per-call context.
 */

import db from "../../db/connection"

// ── Existing rule categories (names only — just enough to avoid duplicates)

async function loadExistingCategories(): Promise<string> {
  const rows = await db`
    SELECT category, COUNT(*) as count
    FROM lint_patterns WHERE enabled = true
    GROUP BY category ORDER BY category
  ` as any[]

  return rows.map((r: any) => `${r.category} (${r.count} rules)`).join(", ")
}

// ── Prose samples ─────────────────────────────────────────────────────────

async function loadProseSamples(runId?: number, limit = 4): Promise<string[]> {
  const rows = runId
    ? await db`SELECT prose FROM generations WHERE run_id = ${runId} AND prose IS NOT NULL ORDER BY seed, attempt LIMIT ${limit}`
    : await db`SELECT prose FROM generations WHERE prose IS NOT NULL ORDER BY id DESC LIMIT ${limit}`
  return (rows as any[]).map(r => r.prose).filter(Boolean)
}

// ── Main context builder ──────────────────────────────────────────────────

export async function buildDiscoveryContext(runId?: number): Promise<string> {
  const [existingCategories, proseSamples] = await Promise.all([
    loadExistingCategories(),
    loadProseSamples(runId),
  ])

  let context = `EXISTING LINT CATEGORIES (do NOT duplicate): ${existingCategories}\n\n`

  context += proseSamples
    .map((p, i) => `--- Sample ${i + 1} (${p.split(/\s+/).length} words) ---\n${p.slice(0, 1800)}`)
    .join("\n\n")

  return context
}
