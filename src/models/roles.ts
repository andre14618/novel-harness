/**
 * Agent-to-model mapping.
 *
 * Change a model here and that agent picks it up on next run.
 * This is the single place to control which model every agent uses,
 * including call parameters (temperature, maxTokens, thinking).
 */

import type { ProviderName } from "./registry"
import { resolve, dirname } from "node:path"
import { mkdirSync } from "node:fs"

// Persistent overrides live outside src/ so the web UI's "Save to File"
// button doesn't drift the checked-in source tree on every click.
const STATE_DIR = resolve(dirname(new URL(import.meta.url).pathname), "../../state")
const OVERRIDES_FILE = resolve(STATE_DIR, "agent-overrides.json")

export interface ModelAssignment {
  provider: ProviderName
  model: string
  temperature?: number   // default: 0.7
  maxTokens?: number     // default: 4096
  thinking?: boolean     // default: false
}

const DEFAULTS = { temperature: 0.7, maxTokens: 4096, thinking: false } as const

const groqQwen32B: ModelAssignment = { provider: "groq", model: "qwen/qwen3-32b" }
const cerebrasQwen235B: ModelAssignment = { provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" }
const groqKimiK2: ModelAssignment = { provider: "groq", model: "moonshotai/kimi-k2-instruct-0905" }
// DeepSeek V4 Flash — single API model. Thinking mode is a per-agent toggle
// via the `thinking` flag. When true, llm.ts injects `thinking: {type:
// "enabled"}` into the request body. Same pricing in both modes
// ($0.14/$0.28 per 1M; cache hit $0.0028/M).
//
// Decision rule for setting `thinking: true` on an agent:
//   - YES if the agent does multi-step reasoning under structural constraints
//     (cross-beat coherence judgment, minimal-edit planning, structural
//     sequencing). Reasoning tokens are billed but pay back in output quality.
//   - NO for creative/prose generation (writer, beat-writer) — reasoning
//     adds latency without quality gain on creative output.
//   - NO for one-shot extraction/revision (planning-extractor,
//     artifact-adjuster) — single-step transforms don't need think tokens.
//   - NO for design-with-creative-output (world-builder, character-agent,
//     plotter, planning-plotter) — these emit creative artifacts; thinking
//     mode adds cost without proportional quality lift.
//
// Toggle individual agents by adding/removing `thinking: true` in the
// AGENT_MODELS entry below — no other plumbing required. v4-pro exists in
// the registry as a reasoning-tier escalation but is NOT routed by default
// (~12× output cost vs Flash at base rate; reserved for cases where Flash
// thinking proves insufficient).
const deepseekV4Flash: ModelAssignment = { provider: "deepseek", model: "deepseek-v4-flash" }
const mimoFlash: ModelAssignment = { provider: "mimo", model: "mimo-v2-flash" }

export const AGENT_MODELS: Record<string, ModelAssignment> = {
  // ── Writers (creative prose, high output) ─────────────────────────────
  // DeepSeek V4 Flash non-thinking. Prose generation doesn't benefit from
  // reasoning tokens (creative output, not multi-step inference); thinking
  // mode would slow per-beat latency without quality lift. Writer-layer LoRA
  // routing is retired; genre-specific data now affects planner structure,
  // not the drafting model or context shape.
  "writer":                    { ...deepseekV4Flash, temperature: 0.8, maxTokens: 8000 },
  "beat-writer":               { ...deepseekV4Flash, temperature: 0.8, maxTokens: 4000 },
  // rewriter removed 2026-04-17 — validation is diagnostic-only now

  // ── Planners (structured creative output) ─────────────────────────────
  // Most planners emit creative artifacts and don't benefit from think tokens.
  // planning-beats is now beat-shape only. planning-state-mapper owns the
  // judgment-heavy state/obligation placement, so it keeps thinking enabled.
  // planning-state-repair is a narrow patch surface: cheap, non-thinking,
  // validator-backed, and used before a full chapter mapper retry.
  "world-builder":             { ...deepseekV4Flash, maxTokens: 8192 },
  "character-agent":           { ...deepseekV4Flash, maxTokens: 8192 },
  "plotter":                   { ...deepseekV4Flash, maxTokens: 8192 },
  "planning-plotter":          { ...deepseekV4Flash, temperature: 0.6, maxTokens: 8192 },
  "planning-beats":            { ...deepseekV4Flash, temperature: 0.6, maxTokens: 8192 },
  "planning-state-mapper":     { ...deepseekV4Flash, thinking: true, temperature: 0.25, maxTokens: 16384 },
  "planning-state-repair":     { ...deepseekV4Flash, thinking: false, temperature: 0.2, maxTokens: 2048 },

  // ── Studio: pre-planning chat + extraction ───────────────────────────
  // Chat: Groq Qwen3-32B (high-volume, cheap).
  // Extractor: one-shot transcript → PlanningDirectives. Single-step, no
  // thinking. Adjuster: light revision under feedback. Single-step, no thinking.
  "planning-conversationalist": { ...groqQwen32B, temperature: 0.65, maxTokens: 2048 },
  "planning-extractor":         { ...deepseekV4Flash, temperature: 0.2, maxTokens: 2048 },
  "artifact-adjuster":          { ...deepseekV4Flash, temperature: 0.3, maxTokens: 2048 },

  // ── Beat support ──────────────────────────────────────────────────────
  // reference-resolver stays on Llama 3.1 8B Groq — set-union over implicit
  // references, fast tier is the right home, parallel-N may or may not
  // help (different output shape than adherence-checker — pending its own
  // benchmark via scripts/best-of-n-experiment.ts).
  "reference-resolver":        { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1, maxTokens: 512 },

  // Runtime checkers default to bounded DeepSeek V4 Flash non-thinking calls.
  // Existing W&B checker adapters are retained only as historical artifacts;
  // they are not the active base-writer workflow.
  "adherence-events":          { ...deepseekV4Flash, temperature: 0.1, maxTokens: 512 },

  // ── Entity grounding ───────────────────────────────────────────────────
  // Corpus-leak detection was tied to the retired Salvatore writer LoRA path.
  // The remaining grounding check judges only against the writer-visible
  // evidence surface and runs on base DeepSeek V4 Flash.
  "halluc-ungrounded":         { ...deepseekV4Flash, temperature: 0.1, maxTokens: 512 },

  // Planned story-state grounding. Warning-only until oracle calibration;
  // deterministic payoff-link integrity remains in src/phases/functional-checks.ts.
  "functional-state-checker":  { ...deepseekV4Flash, temperature: 0.1, maxTokens: 1536 },
  "editorial-beat-coverage":  { ...deepseekV4Flash, temperature: 0.1, maxTokens: 4096 },

  // ── Extractors (structured extraction from prose) ─────────────────────
  "summary-extractor":         { ...mimoFlash, temperature: 0.2, maxTokens: 8192 },
  "fact-extractor":            { ...mimoFlash, temperature: 0.1, maxTokens: 8192 },
  "character-state":           { ...mimoFlash, temperature: 0.1, maxTokens: 8192 },
  "relationship-timeline":     { ...deepseekV4Flash, temperature: 0.2, maxTokens: 8192 },
  "graph-linker":              { ...mimoFlash, temperature: 0.2, maxTokens: 4096 },

  // ── Validators (analytical checks) ────────────────────────────────────
  // continuity: decomposed into 2 parallel calls (facts + state) via check.ts.
  // Sub-check aliases — same model, distinct agent names for tracing in llm_calls.
  "continuity-facts":          { ...deepseekV4Flash, temperature: 0.1, maxTokens: 2048 },
  "continuity-state":          { ...deepseekV4Flash, temperature: 0.1, maxTokens: 2048 },

  // ── Lint fixer (per-sentence creative fixes via LLM) ──────────────────
  // Stays on Cerebras 235B — high call count (6–17/run), latency-sensitive,
  // sentence-level rewrites where DeepSeek's voice advantage doesn't help.
  "lint-fixer":                { ...cerebrasQwen235B, temperature: 0.2 },

  // ── Chapter plan checker (structural adherence) ────────────────────
  // Reverted to DeepSeek V3.2 base model 2026-04-18 after a dual-oracle
  // audit (Sonnet + Codex gpt-5.4) on 12 pilot FAILs showed the SFT adapter
  // chapter-plan-checker-v2:v1 hallucinated a fail mode ("required fact not
  // verbatim") not present in its prompt. Observed false-positive rate ~92%
  // vs validated 96% accuracy on Phase C.3 evals (exp #178) — distribution
  // drift on real fantasy plans. SFT recalibration on TODO as low-priority;
  // context engineering takes precedence over local-model SFT for now.
  "chapter-plan-checker":      { ...deepseekV4Flash, thinking: true, temperature: 0.2, maxTokens: 4096 },

  // ── Chapter plan reviser ─────────────────────────────────────────────
  // Invoked ONCE per chapter (across all drafting attempts) when the
  // chapter-plan-checker settle loop exhausts its in-place rewrite budget.
  // Takes original plan + current prose + persistent unresolved issues and
  // returns the smallest beat-list edit that would make the issues
  // satisfiable. Validation-failure paths (word count, pov-missing) do NOT
  // invoke the reviser — those are routed to targeted beat rewrites only.
  // Same DeepSeek model as the checker; higher maxTokens since output is a
  // full beats+state JSON (matches planning-beats shape). L71 (2026-05-03,
  // exp #400) raised the cap 6144 → 12288 after exp #399 surfaced a 1/25
  // long-tail novel (fantasy-system-heretic ch1) hitting finish_reason=length
  // and bailing the whole novel at the plan-assist gate. Thinking-mode
  // reasoning tokens consume budget alongside structured output, so the old
  // cap was tight on chapters needing substantial re-plans.
  "chapter-plan-reviser":      { ...deepseekV4Flash, thinking: true, temperature: 0.3, maxTokens: 12288 },

  // ── Lint research (offline scripts only — NOT in the pipeline) ─────
  // Used by scripts/lint/lint-discover.ts + scripts/lint/lint-discover-lib.ts
  // for lint-pattern research. Retained from the (deleted) Improvement
  // Daemon role; kept alive because the lint tooling imports it. When the
  // autoresearch loop on the autonomous-harness-loop branch lands, this
  // role may be repurposed or dropped.
  "improver":                  { ...deepseekV4Flash, maxTokens: 8192 },

  // ── Corpus structural extractors (Stage 6 — offline scripts ONLY) ───
  // Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3.
  // Invoked from scripts/corpus/extract-structure.ts to tag a corpus
  // bundle with per-scene value-charge + per-novel PromiseRegistry
  // structural metadata. NOT in the runtime drafting pipeline; produces
  // calibration evidence for downstream Bucket 3 charters.
  //
  // value-charge: non-thinking + low-temp because the schema is small
  // (5 enum fields + an evidence quote), per-scene scope is narrow,
  // and we want repeatable outputs for the calibration smoke.
  // promise: thinking-ON because cross-chapter promise-payoff reasoning
  // needs extended deliberation across the full novel context (~50K in).
  // maxTokens policy across all structural extractors — be GENEROUS.
  // Output cost is metered on tokens emitted, not the cap; bumping
  // maxTokens just removes silent truncation risk on long evidence
  // quotes / multi-element schemas. Caps below give 4-8× headroom over
  // observed worst-case outputs from the crystal_shard run.
  "structure-value-charge":    { ...deepseekV4Flash, temperature: 0.1, maxTokens: 4096 },
  "structure-promise":         { ...deepseekV4Flash, thinking: true, temperature: 0.3, maxTokens: 32_768 },
  "structure-character-arcs":  { ...deepseekV4Flash, thinking: true, temperature: 0.3, maxTokens: 16_384 },
  "structure-mice":            { ...deepseekV4Flash, temperature: 0.1, maxTokens: 4096 },
  "structure-mckee-gap":       { ...deepseekV4Flash, temperature: 0.1, maxTokens: 8192 },

  // ── Stage 6 LLM-judge slots (cross-tier, NOT in the runtime pipeline) ─
  // Per docs/charters/corpus-structural-decomposition-v1.md (R7 pivot).
  // Replaces the R6 single-human-rater gold protocol with an automated
  // LLM judge that re-runs the same prompts/schemas as the extractor
  // through a stronger model. The capability gradient (V4 Pro reasoning
  // > V4 Flash non-thinking/thinking-on) gives independence-by-strength;
  // for premium semantic validation, route a sample subset through the
  // Sonnet / Codex subagent paths documented in the charter.
  //
  // V4 Pro pricing: $1.74/$3.48 per 1M tokens (75%-off promo until
  // 2026-05-31: $0.435/$0.87). For a 50-row judge pass: ~$0.17 base /
  // ~$0.04 promo; cheap enough that running twice for self-consistency
  // is also affordable.
  // V4 Pro thinking-mode chews tokens before emitting JSON. Be generous
  // — the 75%-off promo (until 2026-05-31) makes 16-32K caps trivial in
  // cost. A truncated judge call wastes the entire row plus needs a
  // retry, which costs more than just provisioning headroom upfront.
  "structure-value-charge-judge": {
    provider: "deepseek", model: "deepseek-v4-pro",
    thinking: true, temperature: 0.1, maxTokens: 16_384,
  },
  "structure-promise-judge": {
    provider: "deepseek", model: "deepseek-v4-pro",
    thinking: true, temperature: 0.3, maxTokens: 32_768,
  },
  // T=0 variant for Phase C.3 — tests whether the run-to-run stochasticity
  // observed in Phase B (Pro extractor F1=0.54 / Pro judge gold F1=1.00,
  // ~30% variance on identical input) is just temperature noise. Same
  // role config except temperature=0. Cost identical.
  "structure-promise-judge-t0": {
    provider: "deepseek", model: "deepseek-v4-pro",
    thinking: true, temperature: 0, maxTokens: 32_768,
  },
  "structure-character-arcs-judge": {
    provider: "deepseek", model: "deepseek-v4-pro",
    thinking: true, temperature: 0.3, maxTokens: 32_768,
  },
  "structure-mice-judge": {
    provider: "deepseek", model: "deepseek-v4-pro",
    thinking: true, temperature: 0.1, maxTokens: 16_384,
  },
  "structure-mckee-gap-judge": {
    provider: "deepseek", model: "deepseek-v4-pro",
    thinking: true, temperature: 0.1, maxTokens: 16_384,
  },
  // ── Flash variants of judge roles for 2×2 calibration matrix ──────────
  // Tests whether Flash can play the judge role as well as Pro on the same
  // prompts. Same temp/maxTokens/thinking as Pro judge so the model is the
  // only varying factor.
  "structure-value-charge-judge-flash": {
    provider: "deepseek", model: "deepseek-v4-flash",
    thinking: true, temperature: 0.1, maxTokens: 16_384,
  },
  "structure-promise-judge-flash": {
    provider: "deepseek", model: "deepseek-v4-flash",
    thinking: true, temperature: 0.3, maxTokens: 32_768,
  },
  "structure-character-arcs-judge-flash": {
    provider: "deepseek", model: "deepseek-v4-flash",
    thinking: true, temperature: 0.3, maxTokens: 32_768,
  },
  "structure-mice-judge-flash": {
    provider: "deepseek", model: "deepseek-v4-flash",
    thinking: true, temperature: 0.1, maxTokens: 16_384,
  },
  "structure-mckee-gap-judge-flash": {
    provider: "deepseek", model: "deepseek-v4-flash",
    thinking: true, temperature: 0.1, maxTokens: 16_384,
  },

  // Planner Canon semantic audit (offline Step 2C only). Flash gives cheap
  // repeated labels; Pro is the cross-tier adjudicator. Both use thinking mode
  // because the task compares emitted planner IDs against outline/prose evidence.
  "planner-semantic-label-flash": {
    provider: "deepseek", model: "deepseek-v4-flash",
    thinking: true, temperature: 0.1, maxTokens: 8192,
  },
  "planner-semantic-label-pro": {
    provider: "deepseek", model: "deepseek-v4-pro",
    thinking: true, temperature: 0.1, maxTokens: 8192,
  },

  // Promise pair-matcher — used by compute-calibration.ts to bridge
  // paraphrased predicted-vs-gold promise text. Replaces the old
  // Jaccard/Levenshtein gate which silently rejected semantically-equal
  // promises that happened to share few tokens (e.g. "Errtu will pursue
  // the crystal shard" vs "Errtu, a powerful demon, seeks Crenshinibon"
  // share 2 tokens / Jaccard ~0.17, but they are the same narrative
  // promise). V4 Pro emits a single batched mapping per book.
  "structure-promise-match": {
    provider: "deepseek", model: "deepseek-v4-pro",
    thinking: true, temperature: 0.0, maxTokens: 16_384,
  },
  // V4 Pro semantic character-name matcher for character-arcs calibration.
  // Matches characters across pred/gold lists by fictional identity
  // ("Drizzt" = "Drizzt Do'Urden" = "the dark elf hero"). Single batched
  // call per book; larger maxTokens than promise-match because arc fields
  // (lie/truth/want/need) are longer than promise_text snippets.
  "structure-character-match": {
    provider: "deepseek", model: "deepseek-v4-pro",
    thinking: true, temperature: 0.0, maxTokens: 8_192,
  },
}

// ── Runtime overrides (set via web UI, cleared on restart) ──────────────

const runtimeOverrides = new Map<string, Partial<ModelAssignment>>()

export function setAgentOverride(agentName: string, override: Partial<ModelAssignment>): void {
  runtimeOverrides.set(agentName, override)
}

export function clearAgentOverride(agentName: string): void {
  runtimeOverrides.delete(agentName)
}

export function getAgentOverrides(): Record<string, Partial<ModelAssignment>> {
  return Object.fromEntries(runtimeOverrides)
}

/**
 * Persist the current override map to state/agent-overrides.json so it
 * survives restart. Previously this rewrote src/models/roles.ts via regex,
 * which drifted the checked-in source on every production toggle — now
 * runtime state stays out of src/.
 */
export async function persistOverrides(): Promise<{ changed: string[] }> {
  const overrides = [...runtimeOverrides.entries()]
  const changed = overrides.filter(([name]) => AGENT_MODELS[name] !== undefined).map(([name]) => name)

  mkdirSync(STATE_DIR, { recursive: true })
  const payload = {
    overrides: Object.fromEntries(overrides),
    savedAt: new Date().toISOString(),
  }
  await Bun.write(OVERRIDES_FILE, JSON.stringify(payload, null, 2) + "\n")

  return { changed }
}

/**
 * Load persisted overrides from state/agent-overrides.json (if it exists)
 * and merge them into the runtimeOverrides map. Called once at module
 * load so a restart re-applies the user's last saved config.
 */
async function loadPersistedOverrides(): Promise<void> {
  try {
    const file = Bun.file(OVERRIDES_FILE)
    if (!(await file.exists())) return
    const data = await file.json() as { overrides?: Record<string, Partial<ModelAssignment>> }
    for (const [name, override] of Object.entries(data.overrides ?? {})) {
      runtimeOverrides.set(name, override)
    }
  } catch {
    // Corrupt file or unreadable — ignore; user can re-save from the UI.
  }
}

await loadPersistedOverrides()

export function getModelForAgent(agentName: string): ModelAssignment | undefined {
  const base = AGENT_MODELS[agentName]
  const override = runtimeOverrides.get(agentName)
  if (!base && !override) return undefined
  return override ? { ...base, ...override } as ModelAssignment : base
}

// ── Genre-scoped structural priors ───────────────────────────────────────
// Genre matching now feeds the planner only. The beat writer always uses the
// base `beat-writer` model assignment and full runtime context; no genre match
// can swap in a LoRA adapter, compact prompt, or corpus-leak profile.

export interface StructuralPriors {
  beatDistribution: Record<string, number>
  clusterSustain: Record<string, [number, number]>
  openerKinds: string[]
  closerKinds: string[]
  maxActiveChars: number
  beatsPerScene: [number, number]
  beatsPerChapter: [number, number]
}

export interface StructuralGenrePack {
  label: string
  match: RegExp
  structuralPriors: StructuralPriors
}

// Structural priors from novels/salvatore-icewind-dale/analysis/structural-signature.json
// (2,470 beats, full Icewind Dale Trilogy: crystal_shard + streams_of_silver + halflings_gem,
// via corpus-pipeline, 2026-04-17). Generated by scripts/analysis/structural.py.
// New genre packs should derive their own priors via the same analyzer on their corpus.
const SALVATORE_PRIORS: StructuralPriors = {
  beatDistribution: { action: 0.36, dialogue: 0.31, interiority: 0.20, description: 0.12 },
  clusterSustain: { action: [3, 5], dialogue: [2, 4] },
  openerKinds: ["description", "action"],
  closerKinds: ["action", "interiority"],
  maxActiveChars: 3,
  beatsPerScene: [2, 15],
  beatsPerChapter: [11, 40],
}

export const STRUCTURAL_GENRE_PACKS: StructuralGenrePack[] = [
  {
    label: "fantasy-structural-priors",
    match: /\b(action.?pulp|sword.?and.?sorcery|sword.?&.?sorcery|epic fantasy|heroic fantasy|dark fantasy|fantasy)\b/i,
    structuralPriors: SALVATORE_PRIORS,
  },
]

export function resolveStructuralPriors(genre: string | undefined): StructuralPriors | null {
  if (!genre) return null
  const pack = STRUCTURAL_GENRE_PACKS.find(p => p.match.test(genre)) ?? null
  return pack?.structuralPriors ?? null
}

export function renderStructuralPriorsForPlanner(priors: StructuralPriors): string {
  const dist = Object.entries(priors.beatDistribution)
    .map(([k, v]) => `${k} ~${Math.round(v * 100)}%`)
    .join(", ")

  const clusters = Object.entries(priors.clusterSustain)
    .map(([k, [lo, hi]]) => `${k} sequences should sustain ${lo}-${hi} consecutive beats`)
    .join(". ")

  return `
STRUCTURAL PRIORS (derived from published ${priors.maxActiveChars <= 3 ? "fantasy" : "fiction"} analysis):

Beat-type labeling — each beat MUST include a "kind" field:
- "action" — physical conflict, chase, combat, urgent movement
- "dialogue" — conversation-driven, 2+ characters exchanging speech
- "interiority" — internal thought, reflection, emotional processing
- "description" — scene-setting, atmosphere, worldbuilding, transition

Beat-type distribution per chapter:
  Target: ${dist}.
  Every chapter with 2+ characters MUST have at least 2 dialogue beats.
  Pure-action chapters can skew to 60%+ action but still need at least 1 interiority beat.

Pacing — sustain sequences, don't fragment them:
  ${clusters}.
  Interiority and description are transitional — they lead INTO action or dialogue, not sustain on their own.
  Two consecutive description beats is stasis; avoid it.

Chapter structure:
  Open with: ${priors.openerKinds.join(" or ")} beat. Do NOT open with interiority unless the POV character is alone.
  Close with: ${priors.closerKinds.join(" or ")} beat. NEVER close with pure description.

Scene structure:
  ${priors.beatsPerScene[0]}-${priors.beatsPerScene[1]} beats per scene (one continuous location + timeframe).
  Under ${priors.beatsPerScene[0]} = too sparse (combine with adjacent scene). Over ${priors.beatsPerScene[1]} = too long (split at natural pivot).

Character discipline per beat:
  CRITICAL: maximum ${priors.maxActiveChars} named characters actively speaking or acting per beat.
  Additional characters become collective nouns: "the guards," "the goblin scouts," "the crowd."
  If a scene has 5+ characters present, each beat focuses on the ${priors.maxActiveChars} who matter most for THAT beat's dramatic function.
  Others can be acknowledged ("Helix waited at the extraction point") but not given active dialogue or action.
`
}

// Universal structural rules that go in the base planner prompt regardless
// of genre pack. These are fiction-universal, not author-specific.
export const UNIVERSAL_STRUCTURAL_RULES = `
Beat descriptions — keep to 1-2 sentences. Longer descriptions constrain the writer's creative latitude.
Chapters should NOT close with pure description — the reader needs momentum or emotional resonance at chapter end.
`

// ── DB generation config (autoresearcher-tunable temperature/maxTokens) ──

let dbGenConfigCache: Map<string, { temperature?: number; maxTokens?: number }> | null = null

/** Load all agent generation overrides from DB into cache */
export async function loadGenerationConfig(): Promise<void> {
  try {
    const db = (await import("../db/connection")).default
    const rows = await db`SELECT agent_name, temperature, max_tokens FROM agent_generation_config`
    dbGenConfigCache = new Map()
    for (const r of rows) {
      dbGenConfigCache.set(r.agent_name, {
        temperature: r.temperature ?? undefined,
        maxTokens: r.max_tokens ?? undefined,
      })
    }
  } catch {
    dbGenConfigCache = new Map() // DB not available — empty overrides
  }
}

/** Save a generation config override (for autoresearcher) */
export async function saveGenerationConfig(agentName: string, config: { temperature?: number; maxTokens?: number }): Promise<void> {
  const db = (await import("../db/connection")).default
  await db`INSERT INTO agent_generation_config (agent_name, temperature, max_tokens, updated_at)
           VALUES (${agentName}, ${config.temperature ?? null}, ${config.maxTokens ?? null}, now())
           ON CONFLICT (agent_name) DO UPDATE SET
             temperature = COALESCE(EXCLUDED.temperature, agent_generation_config.temperature),
             max_tokens = COALESCE(EXCLUDED.max_tokens, agent_generation_config.max_tokens),
             updated_at = now()`
  dbGenConfigCache = null // invalidate
}

/** Get generation config for an agent from DB cache */
export async function getGenerationConfig(agentName: string): Promise<{ temperature?: number; maxTokens?: number } | undefined> {
  if (!dbGenConfigCache) await loadGenerationConfig()
  return dbGenConfigCache?.get(agentName)
}

/** Returns the full agent config with defaults applied, including DB + runtime overrides. */
export function getAgentConfig(agentName: string): {
  provider: ProviderName; model: string
  temperature: number; maxTokens: number; thinking: boolean
} | undefined {
  const base = AGENT_MODELS[agentName]
  if (!base) return undefined
  const dbOverride = dbGenConfigCache?.get(agentName)
  const runtimeOverride = runtimeOverrides.get(agentName)
  // Priority: runtime > DB > base > defaults
  const merged = { ...base, ...dbOverride, ...runtimeOverride } as ModelAssignment
  return {
    provider: merged.provider,
    model: merged.model,
    temperature: merged.temperature ?? DEFAULTS.temperature,
    maxTokens: merged.maxTokens ?? DEFAULTS.maxTokens,
    thinking: merged.thinking ?? DEFAULTS.thinking,
  }
}
