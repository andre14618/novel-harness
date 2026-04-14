/**
 * Context template loader — DB-backed, cached, autoresearcher-tunable.
 *
 * Templates use {placeholder} syntax. The writer context assembly code
 * calls these to format each section. The autoresearcher can tune them
 * to improve how context is presented to the writer.
 */

import db from "./connection"

const DEFAULTS: Record<string, string> = {
  scene_query: "{pov} in {setting}. {purpose}. {beats}",
  fact_line: "ch{chapter}: [{category}] {fact}",
  event_line: "Ch{chapter}: {event} → {consequences}",
  causal_chain: "Caused by: {chain}",
  summary_line: "Chapter {chapter}: {summary}\n   Emotional throughline: {emotionalState}",
  knowledge_line: "{knowledge} ({source}ch{chapter})",
  section_facts: "ESTABLISHED FACTS ({count} most relevant):",
  section_events: "RELEVANT EVENTS:",
  section_summaries: "RELEVANT PRIOR CHAPTERS:",
  section_knowledge: "WHAT {povName} KNOWS:",
  section_threads: "OPEN THREADS:",
  section_issues: "ISSUES TO ADDRESS:",
}

let cache: Record<string, string> | null = null

async function loadTemplates(): Promise<Record<string, string>> {
  if (cache) return cache
  cache = { ...DEFAULTS }
  try {
    const rows = await db`SELECT key, template FROM context_templates`
    for (const r of rows) cache[r.key] = r.template
  } catch {
    // DB not available — use defaults
  }
  return cache
}

/** Get a single template by key */
export async function getContextTemplate(key: string): Promise<string> {
  const templates = await loadTemplates()
  return templates[key] ?? DEFAULTS[key] ?? ""
}

/** Get all templates */
export async function getAllContextTemplates(): Promise<Record<string, string>> {
  cache = null
  return loadTemplates()
}

/** Save a template (autoresearcher tuning) */
export async function saveContextTemplate(key: string, template: string): Promise<void> {
  await db`INSERT INTO context_templates (key, template, updated_at)
           VALUES (${key}, ${template}, now())
           ON CONFLICT (key) DO UPDATE SET template = EXCLUDED.template, updated_at = now()`
  cache = null
}

/** Interpolate a template with variables, collapsing empty sections */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "")
    .replace(/\.\s*\./g, ".")
    .replace(/→\s*$/gm, "")
    .trim()
}
