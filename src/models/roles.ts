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
const deepseekV3: ModelAssignment = { provider: "deepseek", model: "deepseek-chat" }
const mimoFlash: ModelAssignment = { provider: "mimo", model: "mimo-v2-flash" }
const togetherQwen9B: ModelAssignment = { provider: "together", model: "Qwen/Qwen3.5-9B" }

export const AGENT_MODELS: Record<string, ModelAssignment> = {
  // ── Writers (creative prose, high output) ─────────────────────────────
  // DeepSeek V3.2 is the default writer (exp #189/#190). Howard primer/
  // methodology retired 2026-04-16 — voice now lands through per-genre
  // voice LoRAs (see WRITER_GENRE_PACKS below) instead of a universal
  // style primer. STYLE_PRIMER env var still works per-run for
  // experimentation but defaults to "none".
  "writer":                    { ...deepseekV3, temperature: 0.8, maxTokens: 8000 },
  "beat-writer":               { ...deepseekV3, temperature: 0.8, maxTokens: 4000 },
  // rewriter removed 2026-04-17 — validation is diagnostic-only now

  // ── Planners (structured creative output) ─────────────────────────────
  "world-builder":             { ...deepseekV3, maxTokens: 8192 },
  "character-agent":           { ...deepseekV3, maxTokens: 8192 },
  "plotter":                   { ...deepseekV3, maxTokens: 8192 },
  "planning-plotter":          { ...deepseekV3, temperature: 0.6, maxTokens: 8192 },
  "planning-beats":            { ...deepseekV3, temperature: 0.6, maxTokens: 8192 },

  // ── Studio: pre-planning chat + extraction ───────────────────────────
  // Chat is high-volume, forgiving — Groq Qwen3-32B is cheap and fast enough.
  // Extractor is load-bearing (one-shot compile of transcript → PlanningDirectives
  // that drives the planner) — DeepSeek for fidelity.
  "planning-conversationalist": { ...groqQwen32B, temperature: 0.65, maxTokens: 2048 },
  "planning-extractor":         { ...deepseekV3, temperature: 0.2, maxTokens: 2048 },
  "artifact-adjuster":          { ...deepseekV3, temperature: 0.3, maxTokens: 2048 },

  // ── Beat support ──────────────────────────────────────────────────────
  // reference-resolver stays on Llama 3.1 8B Groq — set-union over implicit
  // references, fast tier is the right home, parallel-N may or may not
  // help (different output shape than adherence-checker — pending its own
  // benchmark via scripts/best-of-n-experiment.ts).
  "reference-resolver":        { provider: "groq", model: "llama-3.1-8b-instant", temperature: 0.1, maxTokens: 512 },

  // V4 adapter: events+attribution merged prompt, Sonnet-labeled, 2134 examples (exp #161).
  // 512 tokens: V4 trained on Sonnet labels which include fuller evidence quotes than V2.
  "adherence-events":          { provider: "wandb", model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v4", temperature: 0.1, maxTokens: 512 },

  // ── Hallucination checkers (v3 two-adapter architecture) ──────────────
  // Both adapters trained on the same pool (Cerebras + DeepSeek synth +
  // v1 natural) but with narrowed rubrics (see scripts/hallucination/
  // format-v3-two-adapters.ts). Combined via OR in src/phases/drafting.ts:
  // any fired adapter = retry. Telemetry via llm_calls.agent.
  "halluc-ungrounded":         { provider: "wandb", model: "wandb-artifact:///andre14618-/novel-harness/halluc-ungrounded-v2:v1", temperature: 0.1, maxTokens: 512 },
  "halluc-leak-salvatore":     { provider: "wandb", model: "wandb-artifact:///andre14618-/novel-harness/halluc-leak-salvatore-v1:v1", temperature: 0.1, maxTokens: 256 },

  // ── Extractors (structured extraction from prose) ─────────────────────
  "summary-extractor":         { ...mimoFlash, temperature: 0.2, maxTokens: 8192 },
  "fact-extractor":            { ...mimoFlash, temperature: 0.1, maxTokens: 8192 },
  "character-state":           { ...mimoFlash, temperature: 0.1, maxTokens: 8192 },
  "relationship-timeline":     { ...deepseekV3, temperature: 0.2, maxTokens: 8192 },
  "graph-linker":              { ...mimoFlash, temperature: 0.2, maxTokens: 4096 },

  // ── Validators (analytical checks) ────────────────────────────────────
  // continuity: decomposed into 2 parallel calls (facts + state) via check.ts.
  // Sub-check aliases — same model, distinct agent names for tracing in llm_calls.
  // V2 adapter: 253 Sonnet-labeled pairs (39 scenarios × 6-7 variants), 3 epochs on Qwen3-14B.
  // Swapped from Cerebras 235B → W&B continuity-v2 adapter (2026-04-12).
  "continuity-facts":          { provider: "wandb", model: "wandb-artifact:///andre14618-/novel-harness/continuity-v2:v1", temperature: 0.2, maxTokens: 2048 },
  "continuity-state":          { provider: "wandb", model: "wandb-artifact:///andre14618-/novel-harness/continuity-v2:v1", temperature: 0.2, maxTokens: 2048 },

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
  "chapter-plan-checker":      { ...deepseekV3, temperature: 0.2, maxTokens: 4096 },

  // ── Tonal pass (per-paragraph voice rewrite, LoRA fine-tuned) ────────
  // Howard methodology RETIRED 2026-04-16 — voice now handled by per-genre
  // voice LoRAs at generation time (see WRITER_GENRE_PACKS). Adapter slot
  // retained for the on-demand POST /api/novel/:id/tonal-pass endpoint so
  // existing novels can still be re-voiced. Not invoked automatically.
  "tonal-pass":                { provider: "wandb", model: "wandb-artifact:///andre14618-/novel-harness/howard-tonal-v4-sft-resume:v8", temperature: 0.6, maxTokens: 2048 },

  // ── Improvement daemon ──────────────────────────────────────────────
  "improver":                  { ...deepseekV3, maxTokens: 8192 },
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

// ── Genre-scoped writer packs ──────────────────────────────────────────
// Per-novel writer override keyed on the seed's `genre` string. When a
// genre matches, the writer routes to the pack's model + system prompt
// instead of the default `beat-writer` assignment.
//
// Each pack bundles:
//   - model          : ModelAssignment (the adapter URI for voice LoRAs)
//   - systemPromptFile: relative to src/agents/writer/ — the training-
//                       verbatim system prompt plus any runtime riders
//                       (e.g. proper-noun blocklist)
//   - usePrimer      : whether to prepend the Howard style primer.
//                       Voice LoRAs that were trained on their own
//                       system prompt should set this false.
//
// Packs are matched in order; the first regex that matches the seed's
// genre wins. Add new packs here as voice LoRAs ship.

export interface StructuralPriors {
  beatDistribution: Record<string, number>
  clusterSustain: Record<string, [number, number]>
  openerKinds: string[]
  closerKinds: string[]
  maxActiveChars: number
  beatsPerScene: [number, number]
  beatsPerChapter: [number, number]
}

export interface WriterGenrePack {
  label: string
  match: RegExp
  model: ModelAssignment
  systemPromptFile: string
  usePrimer: boolean
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

export const WRITER_GENRE_PACKS: WriterGenrePack[] = [
  {
    label: "salvatore-fantasy",
    match: /\b(action.?pulp|sword.?and.?sorcery|sword.?&.?sorcery|epic fantasy|heroic fantasy|dark fantasy|fantasy)\b/i,
    model: {
      provider: "wandb",
      model: "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4",
      temperature: 0.8,
      maxTokens: 4000,
    },
    systemPromptFile: "beat-writer-system-salvatore.md",
    usePrimer: false,
    structuralPriors: SALVATORE_PRIORS,
  },
]

export function resolveWriterPack(genre: string | undefined): WriterGenrePack | null {
  if (!genre) return null
  const pack = WRITER_GENRE_PACKS.find(p => p.match.test(genre)) ?? null
  if (pack && process.env.WRITER_MODEL_OVERRIDE) {
    // Runtime override for A/B comparisons — overrides the pack's model only.
    // Profile + structural priors stay the same so the only variable is the model.
    return { ...pack, model: { ...pack.model, model: process.env.WRITER_MODEL_OVERRIDE, provider: (process.env.WRITER_PROVIDER_OVERRIDE as any) ?? pack.model.provider } }
  }
  return pack
}

export function resolveStructuralPriors(genre: string | undefined): StructuralPriors | null {
  const pack = resolveWriterPack(genre)
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
