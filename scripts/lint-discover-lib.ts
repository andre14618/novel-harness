/**
 * Lint pattern discovery — per-concept focused passes.
 *
 * Instead of one broad call with 10 principles, runs a focused discovery
 * pass for each concept that has a reference doc. Each pass gives the LLM
 * deep context on ONE craft concept and asks it to find instances of THAT
 * specific defect, then propose regex rules for uncovered instances.
 */

import { readFileSync } from "node:fs"
import db from "../data/connection"
import { getTransport } from "../src/transport"
import { extractJSON } from "../src/llm"
import { getModelForAgent } from "../models/roles"
import { CONCEPTS, loadConceptContext, isHeuristicOnly, type LintConcept } from "../src/lint/concepts"

const AGENT_PROMPT = readFileSync(
  new URL("../src/agents/lint-discoverer/prompt.md", import.meta.url).pathname, "utf-8",
)

// ── Load existing rules for a specific category ───────────────────────────

async function getExistingRulesForCategories(categories: string[]): Promise<string> {
  // Fetch all enabled patterns and filter in JS (avoids bun SQL array parameter issues)
  const allPatterns = await db`
    SELECT category, pattern, fix_template
    FROM lint_patterns WHERE enabled = true
    ORDER BY category, id
  ` as any[]
  const patterns = allPatterns.filter((p: any) => categories.includes(p.category))

  if (patterns.length === 0) return "(none)"

  return patterns
    .filter((p: any) => p.pattern !== "-- heuristic --")
    .map((p: any) => `  /${p.pattern}/ → ${p.fix_template.slice(0, 80)}`)
    .join("\n")
}

// ── Load prose samples ────────────────────────────────────────────────────

async function getProseSamples(runId?: number): Promise<string[]> {
  const rows = runId
    ? await db`SELECT prose FROM generations WHERE run_id = ${runId} AND prose IS NOT NULL ORDER BY seed, attempt LIMIT 4`
    : await db`SELECT prose FROM generations WHERE prose IS NOT NULL ORDER BY id DESC LIMIT 4`
  return (rows as any[]).map(r => r.prose).filter(Boolean)
}

// ── Single-concept discovery pass ─────────────────────────────────────────

async function discoverForConcept(
  concept: LintConcept,
  proseSamples: string[],
): Promise<number> {
  // Skip concepts where ALL categories are heuristic-only (no regex patterns possible)
  if (concept.categories.every(isHeuristicOnly)) {
    console.log(`  [${concept.id}] Skipped — all categories are heuristic-only`)
    return 0
  }

  const improver = getModelForAgent("improver")
  if (!improver) return 0

  const conceptContext = loadConceptContext(concept)
  const existingRules = await getExistingRulesForCategories(concept.categories)

  const sampleText = proseSamples
    .map((p, i) => `--- Sample ${i + 1} ---\n${p.slice(0, 1500)}`)
    .join("\n\n")

  console.log(`  [${concept.id}] Analyzing ${proseSamples.length} samples...`)

  const response = await getTransport().execute({
    systemPrompt: AGENT_PROMPT,
    userPrompt: `${conceptContext}\nEXISTING RULES FOR THIS CATEGORY:\n${existingRules}\n\nPROSE SAMPLES:\n${sampleText}\n\nFind 1-3 new patterns for the "${concept.name}" concept that the existing rules miss. If existing rules already cover everything visible in these samples, return {"patterns": []}.`,
    model: improver.model,
    provider: improver.provider,
    temperature: 0.4,
    maxTokens: 4096,
    responseFormat: { type: "json_object" },
  })

  let proposals: any[]
  try {
    const json = JSON.parse(extractJSON(response.content))
    proposals = json.patterns ?? []
  } catch { return 0 }

  if (proposals.length === 0) {
    console.log(`  [${concept.id}] No new patterns found (existing coverage sufficient)`)
    return 0
  }

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
    if (existing.length > 0) { console.log(`    Skip duplicate regex: ${p.name}`); continue }

    const category = p.category || concept.categories[0]
    if (isHeuristicOnly(category)) {
      console.log(`    Skip heuristic-only category: ${category} — ${p.name}`)
      continue
    }
    await db`
      INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, enabled, rationale)
      VALUES (${p.tier || 2}, ${category}, ${p.regex}, ${p.regexFlags || "gi"}, ${p.fixTemplate}, ${p.dialogueOk || false}, true, ${(p.craftCitation || concept.craftSource) + ". " + (p.description || p.name)})
    `
    console.log(`    Added: ${category} — ${p.name} (${hits} hits)`)
    added++
  }

  return added
}

// ── Main entry point: run focused passes for each concept ─────────────────

export async function discoverAndApply(runId?: number): Promise<number> {
  const proseSamples = await getProseSamples(runId)
  if (proseSamples.length === 0) {
    console.log("  No prose samples available for discovery")
    return 0
  }

  // Run concept discovery passes with bounded concurrency
  let totalAdded = 0
  const CONCURRENCY = 3
  for (let i = 0; i < CONCEPTS.length; i += CONCURRENCY) {
    const batch = CONCEPTS.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (concept) => {
        try {
          return await discoverForConcept(concept, proseSamples)
        } catch (err) {
          console.log(`  [${concept.id}] Discovery failed: ${err instanceof Error ? err.message : err}`)
          return 0
        }
      })
    )
    totalAdded += results.reduce((sum, n) => sum + n, 0)
  }

  return totalAdded
}
