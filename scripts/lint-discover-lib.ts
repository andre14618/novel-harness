/**
 * Shared library for lint pattern discovery.
 * Used by both lint-discover.ts (standalone) and lint-improve.ts (--discover flag).
 *
 * Uses the lint-discoverer agent (prompt.md + context.ts) for principled,
 * cited pattern proposals. Context includes craft reference docs, existing
 * rules, prior discovery history, and prose samples.
 */

import { readFileSync } from "node:fs"
import db from "../data/connection"
import { getTransport } from "../src/transport"
import { extractJSON } from "../src/llm"
import { getModelForAgent } from "../models/roles"
import { buildDiscoveryContext } from "../src/agents/lint-discoverer/context"

const AGENT_PROMPT = readFileSync(
  new URL("../src/agents/lint-discoverer/prompt.md", import.meta.url).pathname, "utf-8",
)

interface ProposedPattern {
  category: string
  name: string
  regex: string
  regexFlags: string
  tier: number
  fixTemplate: string
  craftCitation: string
  dialogueOk: boolean
  description: string
}

export async function discoverAndApply(runId?: number): Promise<number> {
  const improver = getModelForAgent("improver")
  if (!improver) return 0

  // Build rich context from reference docs, DB, and prose samples
  const context = await buildDiscoveryContext(runId)

  const response = await getTransport().execute({
    systemPrompt: AGENT_PROMPT,
    userPrompt: `${context}\n\nAnalyze the prose samples above against the craft principles. Propose 3-5 new high-precision lint patterns not covered by existing rules.`,
    model: improver.model,
    provider: improver.provider,
    temperature: 0.5,
    maxTokens: 4096,
    responseFormat: { type: "json_object" },
  })

  let proposals: ProposedPattern[]
  try {
    const json = JSON.parse(extractJSON(response.content))
    proposals = json.patterns ?? []
  } catch { return 0 }

  // Load prose samples for validation
  const rows = runId
    ? await db`SELECT prose FROM generations WHERE run_id = ${runId} AND prose IS NOT NULL ORDER BY seed, attempt LIMIT 6`
    : await db`SELECT prose FROM generations WHERE prose IS NOT NULL ORDER BY id DESC LIMIT 6`
  const proseSamples = (rows as any[]).map(r => r.prose).filter(Boolean)

  // Validate and add
  let added = 0
  for (const p of proposals) {
    try { new RegExp(p.regex, p.regexFlags || "gi") }
    catch { console.log(`    Skip invalid regex: ${p.name}`); continue }

    const regex = new RegExp(p.regex, p.regexFlags || "gi")
    let hits = 0
    for (const prose of proseSamples) {
      regex.lastIndex = 0
      while (regex.exec(prose)) hits++
    }

    if (hits < 2) { console.log(`    Skip low-hit: ${p.name} (${hits} hits)`); continue }

    const existing = await db`SELECT id FROM lint_patterns WHERE pattern = ${p.regex} LIMIT 1`
    if (existing.length > 0) { console.log(`    Skip duplicate: ${p.name}`); continue }

    await db`
      INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, enabled, rationale)
      VALUES (${p.tier || 2}, ${p.category}, ${p.regex}, ${p.regexFlags || "gi"}, ${p.fixTemplate}, ${p.dialogueOk || false}, true, ${p.craftCitation + ". " + p.description})
    `
    console.log(`    Added: ${p.category} — ${p.name} (${hits} hits, ${p.craftCitation})`)
    added++
  }

  return added
}
