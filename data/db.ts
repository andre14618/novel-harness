/**
 * Central operational database.
 *
 * Single source of truth for all LLM calls, run configs, model assignments,
 * and benchmark scores across both novel runs and benchmark runs.
 *
 * Per-novel creative content (drafts, outlines, facts) stays in output/{novelId}/novel.db.
 * This DB tracks the operational/performance layer only.
 */

import db from "./connection"
import { AGENT_MODELS, type ModelAssignment } from "../models/roles"

/** Backward-compat shim — callers that still call getCentralDB() get the connection object. */
export function getCentralDB() {
  return db
}

// ── Lint pattern seeding ─────────────────────────────────────────────────

async function seedLintPatterns() {
  const [tier1Row] = await db`SELECT COUNT(*) as c FROM lint_patterns WHERE tier = 1`
  if ((tier1Row as any).c > 0) {
    // Tier 1 already seeded — just check Tier 2 and 3
    await seedTier2Patterns()
    await seedTier3Patterns()
    return
  }

  const patterns: [number, string, string, string, string, boolean, string, string | null][] = [
    // ── Tier 1: Filler phrases ───────────────────────────────────
    [1, "FILLER_PHRASE", "\\b(began|started|continued|proceeded)\\s+to\\s+\\w+", "gi",
      "Remove the revving-up verb — write the action directly.", false,
      "Revving-up verbs add a layer of indirection. 'She began to run' is weaker than 'She ran.' The action itself is what matters.",
      "Gradual-onset actions like 'began to blur' or 'began to ring' may be intentional — the rewriter should judge whether the onset is meaningful. Natural in dialogue."],

    [1, "FILLER_PHRASE", "\\bin order to\\b", "gi",
      "Replace with 'to'.", true,
      "Always replaceable with 'to' — adds words without meaning.",
      null],

    [1, "FILLER_PHRASE", "\\bthe fact that\\b", "gi",
      "Cut 'the fact that' — rephrase the clause directly.", false,
      "Nominalization that bloats sentences. 'Despite the fact that' → 'Although'. 'Aware of the fact that' → 'Aware that'. Natural in dialogue — skip in speech.",
      null],

    [1, "FILLER_PHRASE", "\\bdue to the fact that\\b", "gi",
      "Replace with 'because'.", true,
      "Five words that always mean 'because'.",
      null],

    [1, "FILLER_PHRASE", "\\bin spite of the fact that\\b", "gi",
      "Replace with 'although' or 'despite'.", true,
      "Six words that always mean 'although'.",
      null],

    [1, "FILLER_PHRASE", "\\bat this point in time\\b", "gi",
      "Replace with 'now'.", true,
      "Five words that always mean 'now'.",
      null],

    [1, "FILLER_PHRASE", "\\bfor the purpose of\\b", "gi",
      "Replace with 'to' or 'for'.", true,
      "Four words that always mean 'to' or 'for'.",
      null],

    [1, "FILLER_PHRASE", "\\bhas the ability to\\b", "gi",
      "Replace with 'can'.", true,
      "Four words that always mean 'can'.",
      null],

    // ── Tier 1: Redundant body language ──────────────────────────
    [1, "REDUNDANT_BODY", "\\bnodded\\s+(his|her|their)\\s+head", "gi",
      "Remove redundant body part — 'nodded' is sufficient.", false,
      "You can only nod your head. The body part adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\bshrugged\\s+(his|her|their)\\s+shoulders", "gi",
      "Remove redundant body part — 'shrugged' is sufficient.", false,
      "You can only shrug your shoulders. The body part adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\bblinked\\s+(his|her|their)\\s+eyes", "gi",
      "Remove redundant body part — 'blinked' is sufficient.", false,
      "You can only blink your eyes. The body part adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\bclenched\\s+(his|her|their)\\s+fists", "gi",
      "'clenched' already implies fists unless the body part disambiguates or sets up a subsequent detail.", false,
      "Clenching defaults to fists. But sometimes 'fists' sets up a follow-on detail ('clenched her fists, nails digging into palms').",
      "When 'fists' is load-bearing for a subsequent detail, the rewriter should keep it."],

    [1, "REDUNDANT_BODY", "\\bsat\\s+down\\b", "gi",
      "Remove 'down' — 'sat' implies downward.", false,
      "Sitting is inherently downward. 'Down' adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\b(?:she|he|they|I|we)\\s+stood\\s+up\\b", "gi",
      "Remove 'up' — 'stood' implies upward.", false,
      "Standing is inherently upward. 'Up' adds nothing.",
      "Must have a person subject — 'hair stood up' is a different meaning."],

    [1, "REDUNDANT_BODY", "\\breturned\\s+back\\b", "gi",
      "Remove 'back' — 'returned' already means going back.", false,
      "Returning is inherently backward.",
      null],

    [1, "REDUNDANT_BODY", "\\brose\\s+up\\b", "gi",
      "Remove 'up' — 'rose' implies upward.", false,
      "Rising is inherently upward.",
      null],

    // ── Tier 1: Redundant adverb + verb ──────────────────────────
    [1, "REDUNDANT_ADVERB_VERB", "\\bwhispered\\s+softly\\b", "gi",
      "Remove 'softly' — whispering is inherently soft.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bshouted\\s+loudly\\b", "gi",
      "Remove 'loudly' — shouting is inherently loud.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bscreamed\\s+loudly\\b", "gi",
      "Remove 'loudly' — screaming is inherently loud.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bmurmured\\s+softly\\b", "gi",
      "Remove 'softly' — murmuring is inherently soft.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bcrept\\s+quietly\\b", "gi",
      "Remove 'quietly' — creeping implies stealth.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bstrolled\\s+leisurely\\b", "gi",
      "Remove 'leisurely' — strolling implies a leisurely pace.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bgripped\\s+firmly\\b", "gi",
      "Remove 'firmly' — gripping implies firmness.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\brushed\\s+quickly\\b", "gi",
      "Remove 'quickly' — rushing implies speed.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bhurried\\s+quickly\\b", "gi",
      "Remove 'quickly' — hurrying implies speed.", false,
      "The adverb restates what the verb already communicates.",
      null],

    // ── Tier 1: Empty transitions ────────────────────────────────
    [1, "EMPTY_TRANSITION", "(?:^|(?<=\\.\\s{1,2}))And then\\b", "gm",
      "Cut 'And then' — start with the action.", false,
      "Empty connector that delays the action. The reader already knows events are sequential.",
      "Occasionally used as a deliberate dramatic beat — the rewriter should judge."],

    [1, "EMPTY_TRANSITION", "(?:^|(?<=\\.\\s{1,2}))After that\\b", "gm",
      "Cut 'After that' — start with the action.", false,
      "Empty connector that delays the action.",
      null],

    [1, "EMPTY_TRANSITION", "(?:^|(?<=\\.\\s{1,2}))All of a sudden\\b", "gm",
      "Cut 'All of a sudden' — just describe what happened.", false,
      "Telling the reader something is sudden instead of making the prose feel sudden through pacing.",
      null],
  ]

  for (const [tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases] of patterns) {
    await db`
      INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases)
      VALUES (${tier}, ${category}, ${pattern}, ${flags}, ${fix_template}, ${dialogue_ok}, ${rationale}, ${edge_cases})
    `
  }

  await seedTier2Patterns()
  await seedTier3Patterns()
}

async function seedTier2Patterns() {
  const [tier2Row] = await db`SELECT COUNT(*) as c FROM lint_patterns WHERE tier = 2`
  if ((tier2Row as any).c > 0) return

  const patterns: [number, string, string, string, string, boolean, string, string | null][] = [
    // ── Tier 2: Filter words (narrator distancing) ──────────────
    [2, "FILTER_WORD", "\\bseemed\\s+to\\b", "gi",
      "Remove distancing — describe the action or sensation directly.", false,
      "'Seemed to' adds a narrator hedge between the reader and the experience. 'The rain seemed to pause' → 'The rain paused.' The POV character observes, not the narrator.",
      "Legitimate in genuinely uncertain perception: 'He seemed to recognize her' (POV character is unsure). In dialogue, natural hedging — skip."],

    [2, "FILTER_WORD", "\\bcould\\s+feel\\b", "gi",
      "Remove 'could feel' — describe the sensation directly.", false,
      "'She could feel the cold' filters through ability ('could') instead of experience. 'The cold bit her fingers' or 'Her skin prickled' is direct perception.",
      "In dialogue, natural phrasing — skip. 'Could feel' before abstract nouns ('could feel the tension') may need more than just cutting the filter."],

    [2, "FILTER_WORD", "\\bcould\\s+see\\b", "gi",
      "Remove 'could see' — describe what is seen directly.", false,
      "'She could see the tower' filters through ability. 'The tower rose' or 'The tower stood at the far end' is direct perception. The POV character's senses report — they don't narrate their own noticing.",
      "Exception: emphasis on ability or constraint ('From here she could see the whole valley' — the vantage point matters). In dialogue, skip."],

    [2, "FILTER_WORD", "\\bcould\\s+hear\\b", "gi",
      "Remove 'could hear' — describe the sound directly.", false,
      "'She could hear boots on stone' → 'Boots scraped against stone.' Direct perception is always stronger.",
      "Exception: emphasis on distance or effort ('She could barely hear him'). In dialogue, skip."],

    [2, "FILTER_WORD", "\\bfound\\s+(herself|himself|themselves|itself)\\b", "gi",
      "Remove 'found herself' — describe the action directly.", false,
      "'She found herself staring' → 'She stared.' The 'found' construction implies surprise at one's own action, but is almost always just a distancing habit.",
      "Occasionally the surprise is intentional (genuine dissociation or absent-mindedness). Rewriter should judge."],

    [2, "FILTER_WORD", "\\bcould\\s+smell\\b", "gi",
      "Remove 'could smell' — describe the scent directly.", false,
      "'She could smell smoke' → 'Smoke hung in the air' or 'The sharp tang of smoke reached her.' Direct sensory is stronger.",
      "In dialogue, skip."],

    [2, "FILTER_WORD", "\\bcould\\s+taste\\b", "gi",
      "Remove 'could taste' — describe the taste directly.", false,
      "'He could taste blood' → 'Blood coated his tongue' or 'Copper filled his mouth.' Direct sensory is stronger.",
      "In dialogue, skip."],
  ]

  for (const [tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases] of patterns) {
    await db`
      INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases)
      VALUES (${tier}, ${category}, ${pattern}, ${flags}, ${fix_template}, ${dialogue_ok}, ${rationale}, ${edge_cases})
    `
  }
}

async function seedTier3Patterns() {
  const [tier3Row] = await db`SELECT COUNT(*) as c FROM lint_patterns WHERE tier = 3`
  if ((tier3Row as any).c > 0) return

  const patterns: [number, string, string, string, string, boolean, string, string | null][] = [
    // ── Tier 3: Said bookisms (dialogue tag abuse) ──────────────
    [3, "SAID_BOOKISM", "\\b(exclaimed|proclaimed|declared|announced|stated|remarked|uttered|intoned|opined|asserted|murmured|breathed|hissed|growled|snarled|barked|snapped|chirped|quipped|mused|crooned)\\b(?=\\s|,|\\.|$)", "gi",
      "Replace with 'said' or an action beat.", false,
      "Fancy dialogue tags call attention to themselves and away from the dialogue. 'Said' is invisible to readers. Action beats ('She set down the cup.') do more work than any tag.",
      "Exception: 'whispered' and 'shouted' are fine when volume matters. 'Asked' for questions. In dialogue-heavy scenes, occasional variety is natural — flag only when the tag is doing the emotion's job."],

    [3, "SAID_BOOKISM", "\\bsaid\\s+(softly|loudly|quietly|angrily|sadly|happily|nervously|anxiously|cheerfully|sarcastically|bitterly|wearily|eagerly|reluctantly|firmly|gently|coldly|warmly)\\b", "gi",
      "Cut the adverb — let dialogue or action convey tone.", false,
      "'Said angrily' tells the reader how to hear the line instead of writing dialogue that sounds angry on its own. The adverb is a crutch for weak dialogue.",
      "Rare exception: when the adverb contradicts the words ('Fine,' she said coldly) and the contrast is the point."],

    // ── Tier 3: Declared emotions (telling feelings directly) ───
    [3, "DECLARED_EMOTION", "\\b(she|he|they|[A-Z][a-z]+)\\s+(was|were|felt)\\s+(angry|sad|happy|afraid|scared|nervous|anxious|excited|frustrated|annoyed|furious|terrified|heartbroken|devastated|elated|thrilled|relieved|embarrassed|ashamed|guilty|jealous|lonely|confused|shocked|stunned|disgusted|horrified|delighted|overjoyed|miserable|desperate|hopeful|grateful|proud|content)\\b", "g",
      "Show the emotion through body language, action, or dialogue instead.", false,
      "Naming the emotion short-circuits the reader's experience. 'She was afraid' gives information. 'Her hands shook; she couldn't get the key into the lock' creates the feeling.",
      "In rapid-fire action where pacing matters, a quick emotion label can work. In dialogue ('I'm angry'), the character is speaking — skip. Internal monologue may name emotions the character is processing."],

    [3, "DECLARED_EMOTION", "\\b(a\\s+)?(wave|surge|pang|jolt|rush|stab|flash|flicker|spark|burst)\\s+of\\s+(anger|sadness|happiness|fear|grief|joy|rage|terror|panic|dread|guilt|shame|relief|hope|love|hatred|jealousy|longing|anxiety|despair|excitement|frustration)\\b", "gi",
      "Replace the abstraction with a physical sensation or action.", false,
      "'A wave of grief' is a cliché that names the emotion wrapped in a dead metaphor. Show the grief through what the character does or feels physically: 'Her chest caved. She sat down on the curb because her legs wouldn't hold.'",
      "Occasionally the character is analytically noting their own emotion in internal monologue — the rewriter should judge."],
  ]

  for (const [tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases] of patterns) {
    await db`
      INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases)
      VALUES (${tier}, ${category}, ${pattern}, ${flags}, ${fix_template}, ${dialogue_ok}, ${rationale}, ${edge_cases})
    `
  }
}

// ── Run management ───────────────────────────────────────────────────────

export function snapshotModelConfig(): string {
  return JSON.stringify(AGENT_MODELS)
}

export async function createRun(runType: string, runRef?: string, label?: string, experimentId?: number): Promise<number> {
  const config = snapshotModelConfig()
  const [result] = await db`
    INSERT INTO runs (run_type, run_ref, model_config, label, experiment_id)
    VALUES (${runType}, ${runRef ?? null}, ${config}, ${label ?? null}, ${experimentId ?? null})
    RETURNING id
  `
  const runId = (result as any).id as number

  for (const [agent, assignment] of Object.entries(AGENT_MODELS)) {
    await db`
      INSERT INTO run_agents (run_id, agent, provider, model)
      VALUES (${runId}, ${agent}, ${(assignment as ModelAssignment).provider}, ${(assignment as ModelAssignment).model})
    `
  }

  return runId
}

// ── LLM call logging ─────────────────────────────────────────────────────

export interface LLMCallData {
  agent: string
  phase?: string
  model: string
  provider: string
  temperature?: number
  maxTokens?: number
  promptTokens: number
  completionTokens: number
  latencyMs: number
  cost: number
  chapter?: number
  seed?: string
  dimension?: string
  jsonExtractionSuccess?: boolean
  jsonExtractionRetried?: boolean
  zodValidationSuccess?: boolean
  zodErrors?: string[]
  httpAttempts?: number
  retryErrors?: Array<{ status: number; delay: number }>
}

export async function logLLMCall(runId: number, data: LLMCallData): Promise<void> {
  const tps = data.latencyMs > 0 && data.completionTokens > 0
    ? Math.round(data.completionTokens / (data.latencyMs / 1000))
    : 0

  await db`
    INSERT INTO llm_calls (
      run_id, agent, phase, model, provider, temperature, max_tokens,
      prompt_tokens, completion_tokens, latency_ms, tokens_per_sec, cost,
      chapter, seed, dimension,
      json_extraction_success, json_extraction_retried,
      zod_validation_success, zod_errors, http_attempts, retry_errors
    ) VALUES (
      ${runId}, ${data.agent}, ${data.phase ?? null}, ${data.model}, ${data.provider},
      ${data.temperature ?? null}, ${data.maxTokens ?? null},
      ${data.promptTokens}, ${data.completionTokens},
      ${Math.round(data.latencyMs)}, ${tps}, ${data.cost},
      ${data.chapter ?? null}, ${data.seed ?? null}, ${data.dimension ?? null},
      ${data.jsonExtractionSuccess ?? true},
      ${data.jsonExtractionRetried ?? false},
      ${data.zodValidationSuccess ?? true},
      ${data.zodErrors?.length ? JSON.stringify(data.zodErrors) : null},
      ${data.httpAttempts ?? 1},
      ${data.retryErrors?.length ? JSON.stringify(data.retryErrors) : null}
    )
  `
}

// ── Benchmark generations & scores ───────────────────────────────────────

export async function saveGeneration(
  runId: number, seed: string, attempt: number,
  data: { prose?: string; wordCount?: number; latencyMs?: number; tokensPerSec?: number; completionTokens?: number; passed: boolean; variantLabel?: string },
): Promise<number> {
  const [result] = await db`
    INSERT INTO generations (run_id, seed, attempt, prose, word_count, latency_ms, tokens_per_sec, completion_tokens, passed, variant_label)
    VALUES (
      ${runId}, ${seed}, ${attempt}, ${data.prose ?? null}, ${data.wordCount ?? null},
      ${data.latencyMs ?? null}, ${data.tokensPerSec ?? null}, ${data.completionTokens ?? null},
      ${data.passed}, ${data.variantLabel ?? null}
    )
    RETURNING id
  `
  return (result as any).id as number
}

export async function saveScore(generationId: number, judge: string, dimension: string, score: number, reasoning: string): Promise<void> {
  await db`
    INSERT INTO scores (generation_id, judge, dimension, score, reasoning)
    VALUES (${generationId}, ${judge}, ${dimension}, ${score}, ${reasoning})
  `
}

export async function markBaseline(runId: number, benchmarkType: string): Promise<void> {
  await db`
    INSERT INTO baselines (benchmark_type, run_id)
    VALUES (${benchmarkType}, ${runId})
    ON CONFLICT (benchmark_type) DO UPDATE SET run_id = EXCLUDED.run_id, set_at = now()
  `
}

// ── Query: per-run ───────────────────────────────────────────────────────

export interface DimensionAvg { dimension: string; avg: number; stddev: number }

export async function getRunAverages(runId: number): Promise<DimensionAvg[]> {
  return await db`
    SELECT s.dimension,
           ROUND(AVG(s.score)::numeric, 1)::float as avg,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score))::numeric, 1)::float as stddev
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${runId} AND g.passed = true
    GROUP BY s.dimension
  ` as DimensionAvg[]
}

export async function getOverallAvg(runId: number): Promise<{ mean: number; stddev: number }> {
  const [result] = await db`
    SELECT ROUND(AVG(s.score)::numeric, 1)::float as mean,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score))::numeric, 1)::float as stddev
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${runId} AND g.passed = true
  `
  return (result as any) ?? { mean: 0, stddev: 0 }
}

export async function getBaselineAverages(benchmarkType: string): Promise<DimensionAvg[] | null> {
  const [baseline] = await db`SELECT run_id FROM baselines WHERE benchmark_type = ${benchmarkType}`
  if (!baseline) return null
  return getRunAverages((baseline as any).run_id)
}

export async function getPerSeedAverages(runId: number): Promise<Array<{ seed: string; dimension: string; avg: number }>> {
  return await db`
    SELECT g.seed, s.dimension, ROUND(AVG(s.score)::numeric, 1)::float as avg
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${runId} AND g.passed = true
    GROUP BY g.seed, s.dimension
    ORDER BY g.seed, s.dimension
  ` as any[]
}

export async function getWeakestGenerations(runId: number, limit: number = 3): Promise<Array<{
  generationId: number; seed: string; attempt: number; avgScore: number; prose: string
}>> {
  return await db`
    SELECT g.id as "generationId", g.seed, g.attempt,
           ROUND(AVG(s.score)::numeric, 1)::float as "avgScore", g.prose
    FROM generations g
    JOIN scores s ON s.generation_id = g.id
    WHERE g.run_id = ${runId} AND g.passed = true
    GROUP BY g.id
    ORDER BY "avgScore" ASC
    LIMIT ${limit}
  ` as any[]
}

export async function getScoresForGeneration(generationId: number): Promise<Array<{ judge: string; dimension: string; score: number; reasoning: string }>> {
  return await db`
    SELECT judge, dimension, score, reasoning FROM scores WHERE generation_id = ${generationId}
  ` as any[]
}

// ── Query: cost & TPS ────────────────────────────────────────────────────

export async function getCallSummary(runId: number): Promise<Array<{
  agent: string; model: string; calls: number; totalCost: number; avgTps: number; totalPrompt: number; totalCompletion: number
}>> {
  return await db`
    SELECT agent, model, COUNT(*) as calls,
           ROUND(SUM(cost)::numeric, 6)::float as "totalCost",
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END))::int as "avgTps",
           SUM(prompt_tokens) as "totalPrompt",
           SUM(completion_tokens) as "totalCompletion"
    FROM llm_calls WHERE run_id = ${runId}
    GROUP BY agent, model
    ORDER BY agent, "totalCost" DESC
  ` as any[]
}

// ── Query: cross-run model comparison ────────────────────────────────────

export async function getRecentRuns(runType: string, limit: number = 10): Promise<Array<{
  id: number; label: string | null; runRef: string | null; timestamp: string; mean: number
}>> {
  return await db`
    SELECT r.id, r.label, r.run_ref as "runRef", r.timestamp,
           ROUND(AVG(s.score)::numeric, 1)::float as mean
    FROM runs r
    JOIN generations g ON g.run_id = r.id
    JOIN scores s ON s.generation_id = g.id
    WHERE r.run_type = ${runType} AND g.passed = true
    GROUP BY r.id
    ORDER BY r.timestamp DESC
    LIMIT ${limit}
  ` as any[]
}

export async function getAgentModelScores(runType: string): Promise<Array<{
  agent: string; provider: string; model: string; runs: number; avgScore: number; avgTps: number; avgCostPerCall: number
}>> {
  return await db`
    SELECT ra.agent, ra.provider, ra.model,
           COUNT(DISTINCT r.id) as runs,
           ROUND(AVG(s.score)::numeric, 1)::float as "avgScore",
           ROUND(AVG(CASE WHEN lc.tokens_per_sec > 0 THEN lc.tokens_per_sec END))::int as "avgTps",
           ROUND(AVG(lc.cost)::numeric, 6)::float as "avgCostPerCall"
    FROM run_agents ra
    JOIN runs r ON r.id = ra.run_id
    JOIN generations g ON g.run_id = r.id
    JOIN scores s ON s.generation_id = g.id
    LEFT JOIN llm_calls lc ON lc.run_id = r.id AND lc.agent = ra.agent
    WHERE r.run_type = ${runType} AND g.passed = true
    GROUP BY ra.agent, ra.provider, ra.model
    ORDER BY ra.agent, "avgScore" DESC
  ` as any[]
}

export async function compareRuns(runIdA: number, runIdB: number): Promise<{
  configDiff: Array<{ agent: string; from: string; to: string }>;
  scoreDiff: Array<{ dimension: string; scoreA: number; scoreB: number; delta: number }>;
  costDiff: { costA: number; costB: number; delta: number };
}> {
  const [runA] = await db`SELECT model_config FROM runs WHERE id = ${runIdA}`
  const [runB] = await db`SELECT model_config FROM runs WHERE id = ${runIdB}`

  const configDiff: Array<{ agent: string; from: string; to: string }> = []
  if (runA && runB) {
    const a = JSON.parse((runA as any).model_config) as Record<string, ModelAssignment>
    const b = JSON.parse((runB as any).model_config) as Record<string, ModelAssignment>
    for (const agent of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const ma = a[agent] ? `${a[agent].provider}/${a[agent].model}` : "—"
      const mb = b[agent] ? `${b[agent].provider}/${b[agent].model}` : "—"
      if (ma !== mb) configDiff.push({ agent, from: ma, to: mb })
    }
  }

  const avgsA = await getRunAverages(runIdA)
  const avgsB = await getRunAverages(runIdB)
  const allDims = new Set([...avgsA.map(a => a.dimension), ...avgsB.map(b => b.dimension)])
  const scoreDiff = [...allDims].map(dim => {
    const a = avgsA.find(x => x.dimension === dim)?.avg ?? 0
    const b = avgsB.find(x => x.dimension === dim)?.avg ?? 0
    return { dimension: dim, scoreA: a, scoreB: b, delta: Math.round((b - a) * 10) / 10 }
  })

  const [costRowA] = await db`SELECT COALESCE(SUM(cost), 0) as total FROM llm_calls WHERE run_id = ${runIdA}`
  const [costRowB] = await db`SELECT COALESCE(SUM(cost), 0) as total FROM llm_calls WHERE run_id = ${runIdB}`
  const costA = Number((costRowA as any)?.total ?? 0)
  const costB = Number((costRowB as any)?.total ?? 0)

  return { configDiff, scoreDiff, costDiff: { costA, costB, delta: Math.round((costB - costA) * 1e4) / 1e4 } }
}

// ── Query: global aggregates ─────────────────────────────────────────────

export async function getModelStats(): Promise<Array<{
  provider: string; model: string; totalCalls: number; totalCost: number; avgTps: number; avgLatencyMs: number
}>> {
  return await db`
    SELECT provider, model,
           COUNT(*) as "totalCalls",
           ROUND(SUM(cost)::numeric, 4)::float as "totalCost",
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END))::int as "avgTps",
           ROUND(AVG(latency_ms))::int as "avgLatencyMs"
    FROM llm_calls
    GROUP BY provider, model
    ORDER BY "totalCalls" DESC
  ` as any[]
}

export async function getAgentStats(): Promise<Array<{
  agent: string; totalCalls: number; totalCost: number; avgTps: number; avgLatencyMs: number
}>> {
  return await db`
    SELECT agent,
           COUNT(*) as "totalCalls",
           ROUND(SUM(cost)::numeric, 4)::float as "totalCost",
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END))::int as "avgTps",
           ROUND(AVG(latency_ms))::int as "avgLatencyMs"
    FROM llm_calls
    GROUP BY agent
    ORDER BY "totalCost" DESC
  ` as any[]
}

// ── Tuning experiments ──────────────────────────────────────────────────

export async function createTuningExperiment(
  type: string, description: string, config: Record<string, any>,
): Promise<number> {
  const [result] = await db`
    INSERT INTO tuning_experiments (experiment_type, description, config)
    VALUES (${type}, ${description}, ${config})
    RETURNING id
  `
  return (result as any).id as number
}

export async function concludeExperiment(experimentId: number, conclusion: string): Promise<void> {
  await db`UPDATE tuning_experiments SET conclusion = ${conclusion} WHERE id = ${experimentId}`
}

export async function saveTuningResult(
  experimentId: number,
  data: {
    model: string; rubric: string; sample: string; run: number;
    score?: number; issues?: Array<{ quote: string; problem: string }>;
    reasoning?: string; latencyMs?: number; failed?: boolean;
  },
): Promise<void> {
  await db`
    INSERT INTO tuning_results (experiment_id, model, rubric, sample, run, score, issues, reasoning, latency_ms, failed)
    VALUES (
      ${experimentId}, ${data.model}, ${data.rubric}, ${data.sample}, ${data.run},
      ${data.score ?? null}, ${data.issues ? JSON.stringify(data.issues) : null},
      ${data.reasoning ?? null}, ${data.latencyMs ?? null}, ${data.failed ?? false}
    )
  `
}

export async function getTuningExperiments(type?: string): Promise<Array<{
  id: number; timestamp: string; experimentType: string; description: string; config: string
}>> {
  if (type) {
    return await db`
      SELECT id, timestamp, experiment_type as "experimentType", description, config
      FROM tuning_experiments WHERE experiment_type = ${type} ORDER BY id DESC
    ` as any[]
  }
  return await db`
    SELECT id, timestamp, experiment_type as "experimentType", description, config
    FROM tuning_experiments ORDER BY id DESC
  ` as any[]
}

export async function getTuningResults(experimentId: number): Promise<Array<{
  model: string; rubric: string; sample: string; run: number;
  score: number | null; issues: string | null; reasoning: string | null;
  latencyMs: number | null; failed: boolean
}>> {
  return await db`
    SELECT model, rubric, sample, run, score, issues, reasoning, latency_ms as "latencyMs", failed
    FROM tuning_results WHERE experiment_id = ${experimentId} ORDER BY rubric, sample, run
  ` as any[]
}

// ── Experiment queries (unified) ────────────────────────────────────────

export async function getExperimentRuns(experimentId: number): Promise<Array<{
  runId: number; label: string | null; variantLabel: string | null; timestamp: string
}>> {
  return await db`
    SELECT r.id as "runId", r.label, g.variant_label as "variantLabel", r.timestamp
    FROM runs r
    LEFT JOIN generations g ON g.run_id = r.id AND g.variant_label IS NOT NULL
    WHERE r.experiment_id = ${experimentId}
    GROUP BY r.id
    ORDER BY r.id
  ` as any[]
}

export async function getExperimentScores(experimentId: number): Promise<Array<{
  variantLabel: string; dimension: string; avg: number; stddev: number; count: number
}>> {
  return await db`
    SELECT COALESCE(g.variant_label, r.label) as "variantLabel",
           s.dimension,
           ROUND(AVG(s.score)::numeric, 2)::float as avg,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score))::numeric, 2)::float as stddev,
           COUNT(*) as count
    FROM scores s
    JOIN generations g ON g.id = s.generation_id
    JOIN runs r ON r.id = g.run_id
    WHERE r.experiment_id = ${experimentId} AND g.passed = true
    GROUP BY "variantLabel", s.dimension
    ORDER BY "variantLabel", s.dimension
  ` as any[]
}

export async function getExperimentLintSummary(experimentId: number): Promise<Array<{
  variantLabel: string; category: string; count: number
}>> {
  return await db`
    SELECT COALESCE(g.variant_label, r.label) as "variantLabel",
           lp.category,
           COUNT(*) as count
    FROM lint_issues li
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    JOIN generations g ON g.id = li.generation_id
    JOIN runs r ON r.id = g.run_id
    WHERE r.experiment_id = ${experimentId}
    GROUP BY "variantLabel", lp.category
    ORDER BY "variantLabel", count DESC
  ` as any[]
}

export async function getExperimentCost(experimentId: number): Promise<Array<{
  variantLabel: string; totalCost: number; totalCalls: number
}>> {
  return await db`
    SELECT r.label as "variantLabel",
           ROUND(SUM(lc.cost)::numeric, 6)::float as "totalCost",
           COUNT(*) as "totalCalls"
    FROM llm_calls lc
    JOIN runs r ON r.id = lc.run_id
    WHERE r.experiment_id = ${experimentId}
    GROUP BY r.label
    ORDER BY r.label
  ` as any[]
}

export async function saveExperimentSummary(experimentId: number, summary: string): Promise<void> {
  await db`UPDATE tuning_experiments SET summary = ${summary} WHERE id = ${experimentId}`
}

/**
 * Delete an experiment and all its cascading data.
 * Handles FK order: scores/lint_issues → generations → run_agents/llm_calls → runs → experiment.
 */
export async function deleteExperiment(experimentId: number): Promise<void> {
  const runRows = await db`SELECT id FROM runs WHERE experiment_id = ${experimentId}`
  const runIds = runRows.map((r: any) => r.id as number)

  if (runIds.length > 0) {
    const genRows = await db`SELECT id FROM generations WHERE run_id = ANY(${runIds})`
    const genIds = genRows.map((g: any) => g.id as number)

    if (genIds.length > 0) {
      await db`DELETE FROM scores WHERE generation_id = ANY(${genIds})`
      await db`DELETE FROM lint_issues WHERE generation_id = ANY(${genIds})`
      await db`DELETE FROM generations WHERE id = ANY(${genIds})`
    }
    await db`DELETE FROM llm_calls WHERE run_id = ANY(${runIds})`
    await db`DELETE FROM run_agents WHERE run_id = ANY(${runIds})`
    await db`DELETE FROM runs WHERE id = ANY(${runIds})`
  }
  await db`DELETE FROM tuning_experiments WHERE id = ${experimentId}`
}

// ── Pairwise comparison ────────────────────────────────────────────────

export async function savePairwiseMatchup(data: {
  experimentId?: number; generationA: number; generationB: number;
  labelA: string; labelB: string; seed: string; judgeModel: string;
  winner: "A" | "B" | "tie"; confidence: "strong" | "slight" | "tie";
  reasoning: string; position: "ab" | "ba"; latencyMs: number;
}): Promise<number> {
  const [result] = await db`
    INSERT INTO pairwise_matchups (experiment_id, generation_a, generation_b, label_a, label_b, seed, judge_model, winner, confidence, reasoning, position, latency_ms)
    VALUES (
      ${data.experimentId ?? null}, ${data.generationA}, ${data.generationB},
      ${data.labelA}, ${data.labelB}, ${data.seed}, ${data.judgeModel},
      ${data.winner}, ${data.confidence}, ${data.reasoning}, ${data.position}, ${data.latencyMs}
    )
    RETURNING id
  `
  return (result as any).id as number
}

export async function getPairwiseResults(experimentId: number): Promise<Array<{
  id: number; labelA: string; labelB: string; seed: string; winner: string;
  confidence: string; reasoning: string; position: string
}>> {
  return await db`
    SELECT id, label_a as "labelA", label_b as "labelB", seed, winner, confidence, reasoning, position
    FROM pairwise_matchups WHERE experiment_id = ${experimentId} ORDER BY id
  ` as any[]
}

// ── Batch processing ───────────────────────────────────────────────────

export async function createBatch(runId: number, provider: string, judgeModel: string): Promise<number> {
  const [result] = await db`
    INSERT INTO batches (run_id, provider, judge_model)
    VALUES (${runId}, ${provider}, ${judgeModel})
    RETURNING id
  `
  return (result as any).id as number
}

export async function addBatchRequest(batchId: number, customId: string, generationId: number, dimension: string): Promise<void> {
  await db`
    INSERT INTO batch_requests (batch_id, custom_id, generation_id, dimension)
    VALUES (${batchId}, ${customId}, ${generationId}, ${dimension})
  `
}

export async function updateBatchSubmitted(batchId: number, providerBatchId: string, inputFile: string, requestCount: number): Promise<void> {
  await db`
    UPDATE batches
    SET provider_batch_id = ${providerBatchId},
        input_file = ${inputFile},
        request_count = ${requestCount},
        status = 'submitted',
        submitted_at = now()
    WHERE id = ${batchId}
  `
}

export async function updateBatchStatus(batchId: number, status: string, error?: string): Promise<void> {
  const isTerminal = status === "completed" || status === "failed"
  if (isTerminal && error != null) {
    await db`
      UPDATE batches
      SET status = ${status}, completed_at = now(), error = ${error}
      WHERE id = ${batchId}
    `
  } else if (isTerminal) {
    await db`
      UPDATE batches
      SET status = ${status}, completed_at = now()
      WHERE id = ${batchId}
    `
  } else if (error != null) {
    await db`
      UPDATE batches
      SET status = ${status}, error = ${error}
      WHERE id = ${batchId}
    `
  } else {
    await db`
      UPDATE batches
      SET status = ${status}
      WHERE id = ${batchId}
    `
  }
}

export async function updateBatchOutput(batchId: number, outputFile: string): Promise<void> {
  await db`UPDATE batches SET output_file = ${outputFile} WHERE id = ${batchId}`
}

export async function completeBatchRequest(customId: string, score: number, issuesJson: string): Promise<void> {
  await db`
    UPDATE batch_requests
    SET status = 'completed', score = ${score}, issues_json = ${issuesJson}
    WHERE custom_id = ${customId}
  `
}

export async function failBatchRequest(customId: string): Promise<void> {
  await db`UPDATE batch_requests SET status = 'failed' WHERE custom_id = ${customId}`
}

export async function getPendingBatches(): Promise<Array<{
  id: number; runId: number; provider: string; providerBatchId: string; judgeModel: string; requestCount: number; status: string
}>> {
  return await db`
    SELECT id, run_id as "runId", provider, provider_batch_id as "providerBatchId",
           judge_model as "judgeModel", request_count as "requestCount", status
    FROM batches
    WHERE status IN ('pending', 'submitted', 'validating', 'processing')
    ORDER BY id
  ` as any[]
}

export async function getBatchRequests(batchId: number): Promise<Array<{
  id: number; customId: string; generationId: number; dimension: string; status: string; score: number | null; issuesJson: string | null
}>> {
  return await db`
    SELECT id, custom_id as "customId", generation_id as "generationId",
           dimension, status, score, issues_json as "issuesJson"
    FROM batch_requests WHERE batch_id = ${batchId} ORDER BY id
  ` as any[]
}

export async function getBatchForRun(runId: number): Promise<Array<{
  id: number; provider: string; status: string; judgeModel: string; requestCount: number; submittedAt: string | null; completedAt: string | null
}>> {
  return await db`
    SELECT id, provider, status, judge_model as "judgeModel",
           request_count as "requestCount", submitted_at as "submittedAt", completed_at as "completedAt"
    FROM batches WHERE run_id = ${runId} ORDER BY id
  ` as any[]
}

export async function getPhaseStats(): Promise<Array<{
  phase: string; totalCalls: number; totalCost: number; avgTps: number
}>> {
  return await db`
    SELECT COALESCE(phase, 'unknown') as phase,
           COUNT(*) as "totalCalls",
           ROUND(SUM(cost)::numeric, 4)::float as "totalCost",
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END))::int as "avgTps"
    FROM llm_calls
    GROUP BY phase
    ORDER BY "totalCost" DESC
  ` as any[]
}

let _lintSeeded = false
export async function ensureLintPatterns() {
  if (_lintSeeded) return
  _lintSeeded = true
  await seedLintPatterns()
}
