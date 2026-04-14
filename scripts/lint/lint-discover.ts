/**
 * Lint pattern discovery via LLM + craft principles.
 *
 * Analyzes generated prose against established craft principles to discover
 * new detectable anti-patterns not covered by existing lint rules.
 *
 * Flow:
 *   1. Load craft principles (condensed from docs/ai-tells-*.md)
 *   2. Load existing lint rules (so LLM knows what's covered)
 *   3. Feed prose samples from recent generations
 *   4. LLM proposes new patterns with regex, craft citations, and fix templates
 *   5. Validate: test proposed regex against generation corpus
 *   6. Report hit rates and sample matches for human review
 *   7. Optionally add validated patterns to lint_patterns DB
 *
 * Usage:
 *   bun scripts/lint-discover.ts                        # analyze recent prose
 *   bun scripts/lint-discover.ts --run 225              # analyze specific run
 *   bun scripts/lint-discover.ts --apply                # auto-add validated patterns to DB
 *   bun scripts/lint-discover.ts --principles-only      # just show principles sent to LLM
 */

import { parseArgs } from "node:util"
import { readFileSync, existsSync } from "node:fs"
import db from "../../data/connection"
import { getTransport } from "../../src/transport"
import { extractJSON } from "../../src/llm"
import { getModelForAgent } from "../../models/roles"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { isHeuristicOnly } from "../../src/lint/concepts"

const HARNESS_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    apply: { type: "boolean", default: false },
    "principles-only": { type: "boolean", default: false },
    "max-proposals": { type: "string", default: "5" },
  },
})

const APPLY = values.apply!
const MAX_PROPOSALS = parseInt(values["max-proposals"]!)

// ── Craft principles (condensed from research docs) ───────────────────────

const CRAFT_PRINCIPLES = `
## Craft Principles for Prose Quality (sourced from published references)

### R.U.E. — Resist the Urge to Explain (Browne & King, "Self-Editing for Fiction Writers")
After showing an emotion through physical action or dialogue, do NOT explain it with an emotion label. "Her hands trembled. She was terrified." — the tell after the show undermines the reader's experience. Trust the showing.

### Motivation-Reaction Units (Swain, "Techniques of the Selling Writer")
Reactions follow: feeling → involuntary physical action → conscious action → speech. Violating this order breaks immersion. Naming an emotion after showing it physically reverses the sequence.

### Psychic Distance (Gardner, "The Art of Fiction")
Prose should maintain consistent narrative distance. Close distance (sensory, visceral) followed immediately by far distance (abstract label) creates jarring zoom-out. "Snow under your collar" → "He felt cold" breaks the dream.

### Show Don't Tell — with exceptions (Ursula K. Le Guin, "Steering the Craft")
Telling is legitimate for: time skips, transitions, rapid pacing, known facts, sequel compression. Telling is a defect when: it follows adequate showing (redundant), it replaces showing in high-intensity scenes, it distances the reader during intimate moments.

### Sentence Rhythm (Gary Provost, "100 Ways to Improve Your Writing"; Roy Peter Clark, "Writing Tools")
Vary sentence length deliberately. Short sentences for impact. Long flowing sentences for reflection. Monotonous rhythm (all sentences ~15 words) signals mechanical prose. Published fiction CV (coefficient of variation) typically 0.4-0.8; AI output typically 0.15-0.30.

### Filter Words (Renni Browne, "Self-Editing for Fiction Writers")
"She could see," "He seemed to," "She felt" — these filter the reader's experience through the character's perception instead of presenting it directly. "She could see the fire" → "The fire" (in close POV, the character IS seeing it).

### Said Bookisms (Stephen King, "On Writing")
"Said" is invisible. "Exclaimed," "proclaimed," "opined" draw attention to the tag. "Said + adverb" (said softly) tells instead of showing through dialogue rhythm and word choice.

### Redundant Body Language (Ackerman & Puglisi, "The Emotion Thesaurus")
"Nodded his head" (what else would you nod?), "shrugged her shoulders," "blinked his eyes." The body part is redundant when the verb already implies it.

### Hedge Qualifiers (Strunk & White, "The Elements of Style")
"Sort of," "kind of," "perhaps," "somewhat," "almost as if" — weaken assertions. In fiction, hedging undermines conviction. Characters who "sort of smiled" are less vivid than those who "smiled."

### AI-Characteristic Clichés (observed across GPT/Claude/Llama outputs)
Weight/burden metaphors ("the weight of silence"), charged air ("tension crackled"), vague internal shifts ("something shifted inside"), flickering emotions ("hope flickered"), objects hanging in air ("words hung between them"). These are statistically overrepresented in AI prose vs. published fiction.

### Purple Prose / Adjective Stacking
3+ adjectives modifying a single noun signals over-decoration. "The dark, cold, unforgiving, merciless night" — each adjective dilutes the others. Pick the one that does the most work.

### Paragraph Rhythm
Varied paragraph length creates visual rhythm on the page. 4+ consecutive paragraphs of similar length (within 20%) signals mechanical structure. Mix: a single-sentence paragraph for impact, a long descriptive paragraph, short dialogue exchanges.

### Opening Repetition
3+ consecutive sentences starting with the same word ("She... She... She...") or 3+ paragraphs opening with the same word signals mechanical generation, not intentional anaphora.
`.trim()

// ── Load existing patterns ────────────────────────────────────────────────

async function getExistingPatterns(): Promise<string> {
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
      const examples = pats.slice(0, 3).map((p: any) =>
        p.pattern === "-- heuristic --" ? `  (heuristic detector)` : `  regex: ${p.pattern}`
      ).join("\n")
      return `${cat} (${pats.length} patterns):\n${examples}`
    })
    .join("\n\n")
}

// ── Load prose samples ────────────────────────────────────────────────────

async function getProseSamples(runId?: number): Promise<string[]> {
  let rows: any[]
  if (runId) {
    rows = await db`
      SELECT prose FROM generations WHERE run_id = ${runId} AND prose IS NOT NULL
      ORDER BY seed, attempt LIMIT 6
    `
  } else {
    // Get recent generations
    rows = await db`
      SELECT prose FROM generations WHERE prose IS NOT NULL
      ORDER BY id DESC LIMIT 6
    `
  }
  return rows.map(r => r.prose).filter(Boolean)
}

// ── Discovery: ask LLM to propose new patterns ───────────────────────────

interface ProposedPattern {
  category: string
  name: string
  description: string
  regex: string
  regexFlags: string
  tier: number
  fixTemplate: string
  craftCitation: string
  dialogueOk: boolean
  examples: { flagged: string; why: string }[]
}

async function discoverPatterns(
  principles: string,
  existingRules: string,
  proseSamples: string[],
): Promise<ProposedPattern[]> {
  const improver = getModelForAgent("improver")
  if (!improver) { console.error("No improver model configured"); return [] }

  const systemPrompt = `You are an expert in fiction craft and regex pattern design. Your job is to analyze AI-generated prose and propose NEW lint rules that catch recurring anti-patterns.

CRITICAL RULES:
1. Every proposed pattern MUST cite a specific craft principle (book + chapter/concept).
2. Every proposed pattern MUST be detectable via regex (JavaScript regex syntax).
3. Do NOT propose patterns already covered by existing rules (provided below).
4. Focus on patterns that appear MULTIPLE TIMES across the prose samples — not one-off issues.
5. Each pattern must have a clear fix (what the writer should do instead).
6. Prefer high-precision patterns over high-recall — false positives erode trust in the linter.
7. The regex must work with JavaScript \`new RegExp(pattern, flags)\` — use gi flags for case-insensitive global.
8. Provide 2-3 concrete examples from the prose samples where the pattern fires.

Return valid JSON:
{
  "patterns": [
    {
      "category": "CATEGORY_NAME",
      "name": "Short descriptive name",
      "description": "What this catches and why it's a problem",
      "regex": "the regex pattern (JavaScript compatible)",
      "regexFlags": "gi",
      "tier": 2,
      "fixTemplate": "How to fix when flagged",
      "craftCitation": "Author, Book Title (Year), concept/chapter",
      "dialogueOk": false,
      "examples": [
        { "flagged": "exact text that matches", "why": "why this is a problem" }
      ]
    }
  ]
}`

  const sampleText = proseSamples.map((p, i) =>
    `--- Sample ${i + 1} (${p.split(/\s+/).length} words) ---\n${p.slice(0, 2000)}`
  ).join("\n\n")

  const userPrompt = `## CRAFT PRINCIPLES
${principles}

## EXISTING LINT RULES (already covered — do NOT duplicate)
${existingRules}

## PROSE SAMPLES (AI-generated fiction to analyze)
${sampleText}

Analyze these prose samples against the craft principles. Find ${MAX_PROPOSALS} recurring anti-patterns that:
- Appear in 2+ samples
- Are NOT already covered by the existing lint rules
- Can be detected with a JavaScript regex
- Have a clear craft citation explaining why it's a defect

Prioritize patterns with the highest frequency and lowest false positive risk.`

  try {
    const response = await getTransport().execute({
      systemPrompt,
      userPrompt,
      model: improver.model,
      provider: improver.provider,
      temperature: 0.5,
      maxTokens: 8192,
      responseFormat: { type: "json_object" },
    })

    const json = JSON.parse(extractJSON(response.content))
    return json.patterns ?? []
  } catch (err) {
    console.error("Discovery LLM call failed:", err instanceof Error ? err.message : err)
    return []
  }
}

// ── Validate: test proposed regex against corpus ──────────────────────────

interface ValidationResult {
  pattern: ProposedPattern
  hitCount: number
  sampleCount: number
  hitRate: number // hits per sample
  sampleMatches: string[] // first 3 matching texts for human review
  regexValid: boolean
  regexError?: string
}

function validatePattern(pattern: ProposedPattern, proseSamples: string[]): ValidationResult {
  let regex: RegExp
  try {
    regex = new RegExp(pattern.regex, pattern.regexFlags || "gi")
  } catch (err) {
    return {
      pattern, hitCount: 0, sampleCount: proseSamples.length, hitRate: 0,
      sampleMatches: [], regexValid: false, regexError: String(err),
    }
  }

  let hitCount = 0
  const sampleMatches: string[] = []

  for (const prose of proseSamples) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(prose)) !== null) {
      hitCount++
      if (sampleMatches.length < 5) {
        // Extract surrounding context
        const start = Math.max(0, match.index - 40)
        const end = Math.min(prose.length, match.index + match[0].length + 40)
        sampleMatches.push(`...${prose.slice(start, end)}...`)
      }
    }
  }

  return {
    pattern, hitCount, sampleCount: proseSamples.length,
    hitRate: hitCount / proseSamples.length,
    sampleMatches, regexValid: true,
  }
}

// ── Integrate: add validated pattern to DB ────────────────────────────────

async function addPatternToDb(pattern: ProposedPattern): Promise<number> {
  if (isHeuristicOnly(pattern.category)) {
    throw new Error(`Category "${pattern.category}" is heuristic-only — regex patterns are not valid for it`)
  }
  const [row] = await db`
    INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, enabled, rationale, edge_cases)
    VALUES (
      ${pattern.tier},
      ${pattern.category},
      ${pattern.regex},
      ${pattern.regexFlags || "gi"},
      ${pattern.fixTemplate},
      ${pattern.dialogueOk},
      true,
      ${`${pattern.craftCitation}. ${pattern.description}`},
      ${`Examples: ${pattern.examples.map(e => e.flagged).join("; ")}`}
    )
    RETURNING id
  `
  return (row as any).id
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(60))
  console.log("  LINT PATTERN DISCOVERY")
  console.log("=".repeat(60))

  // Load existing rules
  const existingRules = await getExistingPatterns()
  const existingCount = (existingRules.match(/\n/g) || []).length

  if (values["principles-only"]) {
    console.log("\n--- CRAFT PRINCIPLES ---\n")
    console.log(CRAFT_PRINCIPLES)
    console.log("\n--- EXISTING RULES ---\n")
    console.log(existingRules)
    return
  }

  // Load prose samples
  const runId = values.run ? parseInt(values.run) : undefined
  const proseSamples = await getProseSamples(runId)
  if (proseSamples.length === 0) {
    console.error("No prose samples found. Run a benchmark first or specify --run <id>.")
    process.exit(1)
  }
  console.log(`  Prose samples: ${proseSamples.length}`)
  console.log(`  Existing rules: ${existingRules.split("\n\n").length} categories`)
  console.log(`  Max proposals: ${MAX_PROPOSALS}`)
  console.log()

  // Create experiment
  const experimentId = await createTuningExperiment(
    "lint-discovery",
    `Lint pattern discovery from ${proseSamples.length} prose samples`,
    { runId, maxProposals: MAX_PROPOSALS, apply: APPLY },
    { target: "lint", dimension: "coverage" },
  )

  // Discover
  console.log("  Discovering patterns via LLM...")
  const proposals = await discoverPatterns(CRAFT_PRINCIPLES, existingRules, proseSamples)
  console.log(`  Got ${proposals.length} proposals\n`)

  if (proposals.length === 0) {
    await concludeExperiment(experimentId, "No new patterns discovered")
    console.log("  No patterns proposed. Existing coverage may be sufficient.\n")
    return
  }

  // Validate each proposal
  const results: ValidationResult[] = []
  for (const proposal of proposals) {
    const result = validatePattern(proposal, proseSamples)
    results.push(result)

    const status = !result.regexValid ? "INVALID REGEX" :
      result.hitCount === 0 ? "NO HITS" :
      result.hitRate < 0.5 ? "LOW HIT RATE" : "VIABLE"

    console.log(`  [${status}] ${proposal.category}: ${proposal.name}`)
    console.log(`    Regex: /${proposal.regex}/${proposal.regexFlags}`)
    console.log(`    Citation: ${proposal.craftCitation}`)
    console.log(`    Hits: ${result.hitCount} across ${result.sampleCount} samples (${result.hitRate.toFixed(1)}/sample)`)
    if (result.regexError) console.log(`    Error: ${result.regexError}`)
    if (result.sampleMatches.length > 0) {
      console.log(`    Matches:`)
      for (const m of result.sampleMatches.slice(0, 3)) {
        console.log(`      "${m.slice(0, 100)}"`)
      }
    }
    console.log()
  }

  // Filter viable patterns (valid regex, hits in multiple samples)
  const viable = results.filter(r => r.regexValid && r.hitRate >= 0.3)

  console.log("─".repeat(60))
  console.log(`  Viable patterns: ${viable.length}/${results.length}`)

  if (APPLY && viable.length > 0) {
    console.log(`  Adding ${viable.length} patterns to lint_patterns DB...\n`)
    const added: string[] = []
    for (const v of viable) {
      const id = await addPatternToDb(v.pattern)
      added.push(`${v.pattern.category}:${v.pattern.name} (id=${id}, ${v.hitCount} hits)`)
      console.log(`    Added: ${v.pattern.category} — ${v.pattern.name} (pattern #${id})`)
    }
    await concludeExperiment(experimentId,
      `Discovered ${proposals.length} patterns, ${viable.length} viable, ${added.length} added to DB. ` +
      added.join("; ")
    )
  } else {
    const summary = viable.map(v =>
      `${v.pattern.category}:${v.pattern.name} (${v.hitCount} hits, citation: ${v.pattern.craftCitation})`
    ).join("; ")
    await concludeExperiment(experimentId,
      `Discovered ${proposals.length} patterns, ${viable.length} viable. ${APPLY ? "" : "Dry run — use --apply to add. "}${summary}`
    )
  }

  console.log(`\n  Experiment: #${experimentId}`)
  console.log()
}

main().catch(err => {
  console.error("Discovery failed:", err)
  process.exit(1)
})
