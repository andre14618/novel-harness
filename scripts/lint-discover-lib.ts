/**
 * Shared library for lint pattern discovery.
 * Used by both lint-discover.ts (standalone) and lint-improve.ts (--discover flag).
 */

import db from "../data/connection"
import { getTransport } from "../src/transport"
import { extractJSON } from "../src/llm"
import { getModelForAgent } from "../models/roles"

// ── Craft principles (condensed) ──────────────────────────────────────────

export const CRAFT_PRINCIPLES = `
R.U.E. — Resist the Urge to Explain (Browne & King, "Self-Editing for Fiction Writers"): After showing through action/dialogue, don't explain with emotion labels.
Motivation-Reaction Units (Swain, "Techniques of the Selling Writer"): Reactions follow feeling → involuntary physical → conscious action → speech. Don't reverse.
Psychic Distance (Gardner, "The Art of Fiction"): Maintain consistent narrative distance. Don't zoom out (abstract label) right after zooming in (sensory detail).
Sentence Rhythm (Provost, "100 Ways"; Clark, "Writing Tools"): Vary sentence length. Monotonous rhythm signals mechanical prose.
Filter Words (Browne, "Self-Editing"): "She could see," "He seemed to" — present directly instead.
Said Bookisms (King, "On Writing"): "Said" is invisible. Fancy tags and said+adverb tell instead of show.
Redundant Body Language (Ackerman & Puglisi, "Emotion Thesaurus"): "Nodded his head" — the body part is redundant.
Hedge Qualifiers (Strunk & White, "Elements of Style"): "Sort of," "perhaps," "almost as if" weaken assertions.
AI Clichés: Weight metaphors, charged air, vague internal shifts, flickering emotions — overrepresented in AI vs published.
Purple Prose: 3+ adjectives on one noun dilutes each. Pick the strongest.
Opening Repetition: 3+ sentences/paragraphs starting with same word signals mechanical generation.
`.trim()

// ── Load existing patterns ────────────────────────────────────────────────

async function getExistingPatterns(): Promise<string> {
  const patterns = await db`
    SELECT category, pattern, fix_template FROM lint_patterns WHERE enabled = true ORDER BY category, id
  ` as any[]

  const byCategory = new Map<string, any[]>()
  for (const p of patterns) {
    const list = byCategory.get(p.category) ?? []
    list.push(p)
    byCategory.set(p.category, list)
  }

  return [...byCategory.entries()]
    .map(([cat, pats]) => `${cat} (${pats.length} rules)`)
    .join(", ")
}

// ── Load prose samples ────────────────────────────────────────────────────

async function getProseSamples(runId?: number): Promise<string[]> {
  const rows = runId
    ? await db`SELECT prose FROM generations WHERE run_id = ${runId} AND prose IS NOT NULL ORDER BY seed, attempt LIMIT 6`
    : await db`SELECT prose FROM generations WHERE prose IS NOT NULL ORDER BY id DESC LIMIT 6`
  return (rows as any[]).map(r => r.prose).filter(Boolean)
}

// ── Discover new patterns ─────────────────────────────────────────────────

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

  const existingRules = await getExistingPatterns()
  const proseSamples = await getProseSamples(runId)
  if (proseSamples.length === 0) return 0

  const sampleText = proseSamples.map((p, i) =>
    `--- Sample ${i + 1} ---\n${p.slice(0, 1500)}`
  ).join("\n\n")

  const response = await getTransport().execute({
    systemPrompt: `You analyze AI-generated prose against craft principles to propose NEW lint rules. Every rule must: cite a craft source, provide a working JavaScript regex, and appear in 2+ samples. Return JSON: {"patterns": [{"category","name","regex","regexFlags":"gi","tier":2,"fixTemplate","craftCitation","dialogueOk":false,"description"}]}. Propose only 3-5 high-precision patterns not covered by existing rules.`,
    userPrompt: `CRAFT PRINCIPLES:\n${CRAFT_PRINCIPLES}\n\nEXISTING RULES (do NOT duplicate):\n${existingRules}\n\nPROSE SAMPLES:\n${sampleText}\n\nFind 3-5 recurring anti-patterns.`,
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

  // Validate and add
  let added = 0
  for (const p of proposals) {
    // Test regex validity
    try { new RegExp(p.regex, p.regexFlags || "gi") }
    catch { console.log(`    Skip invalid regex: ${p.name}`); continue }

    // Test hit rate
    const regex = new RegExp(p.regex, p.regexFlags || "gi")
    let hits = 0
    for (const prose of proseSamples) {
      regex.lastIndex = 0
      while (regex.exec(prose)) hits++
    }

    if (hits < 2) { console.log(`    Skip low-hit: ${p.name} (${hits} hits)`); continue }

    // Check not duplicate
    const existing = await db`SELECT id FROM lint_patterns WHERE pattern = ${p.regex} LIMIT 1`
    if (existing.length > 0) { console.log(`    Skip duplicate: ${p.name}`); continue }

    // Add to DB
    await db`
      INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, enabled, rationale)
      VALUES (${p.tier || 2}, ${p.category}, ${p.regex}, ${p.regexFlags || "gi"}, ${p.fixTemplate}, ${p.dialogueOk || false}, true, ${p.craftCitation + ". " + p.description})
    `
    console.log(`    Added: ${p.category} — ${p.name} (${hits} hits, ${p.craftCitation})`)
    added++
  }

  return added
}
