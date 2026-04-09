/**
 * Adherence-checker decomposed-call benchmark.
 *
 * Companion to score-adherence-baseline.ts (exp #110, flat schema, single call)
 * and score-adherence-checklist.ts (exp #111, structured-checklist, single call).
 *
 * Hypothesis: the production adherence-checker prompt asks 3 different questions
 * (events present? right setting? characters in role?) in ONE call, and is missing
 * a 4th question entirely (FAIL_TANGENT — "is the bulk of the prose on-spec?").
 * Exp #111 disconfirmed structured-checklist (forcing more structure inside one
 * call), but per-API-call decomposition is a different shape that hasn't been
 * tested. Each call gets its own attention budget AND can be prompted in the
 * direction of the failure mode it's targeting.
 *
 * This script splits the LLM check into FOUR parallel calls per pair:
 *
 *   1. Events call    — "Quote the passage where the beat's action happens.
 *                       Off-page references don't count." → catches FAIL_MISSING
 *   2. Setting call   — "Does the prose's setting match the expected setting?"
 *                       → catches FAIL_SETTING (added after the smoke run showed
 *                       events doesn't naturally catch wrong-place; 235B
 *                       regressed 96→88% in the 3-call version because of this)
 *   3. Tangent call   — "Estimate the off-spec fraction. Quote off-spec passages."
 *                       → catches FAIL_TANGENT (the orphaned failure mode)
 *   4. Character call — "Quote any line where a character acts contrary to role."
 *                       → catches FAIL_CHAR
 *
 * Aggregate verdict: PASS = events_present AND setting_matches AND NOT is_tangent
 *                    AND NOT character_contradiction.
 *                    FAIL = any of the four flags fires.
 *
 * Reads:  lora-data/adherence-checker-pairs.jsonl (160 pairs)
 * Writes: tuning_experiment row with full per-call breakdown.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... GROQ_API_KEY=... WANDB_API_KEY=... \
 *     bun scripts/score-adherence-decomposed.ts
 *   ... --sample 16   (smoke run, 2 per variant)
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import type { ProviderName } from "../models/registry"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/adherence-checker-pairs.jsonl")
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N   = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

interface ModelTarget {
  key: string
  label: string
  provider: ProviderName
  model: string
}

const MODELS: ModelTarget[] = [
  { key: "llama8b",  label: "Llama 3.1 8B (Groq)",      provider: "groq",     model: "llama-3.1-8b-instant" },
  { key: "qwen14b",  label: "Qwen3-14B base (W&B)",     provider: "wandb",    model: "OpenPipe/Qwen3-14B-Instruct" },
  { key: "qwen235b", label: "Qwen 235B (Cerebras)",     provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" },
]

// ── Pair parsing ──────────────────────────────────────────────────────────

interface ParsedPair {
  scenario: string
  variant: string
  beat: string
  setting: string
  characters: string[]
  prose: string
  expectedPass: boolean
}

function parsePair(p: Pair): ParsedPair {
  const user = p.messages[1].content
  const expected = JSON.parse(p.messages[2].content) as { pass: boolean }

  const beatMatch = user.match(/Beat:\s*"([^"]*)"/)
  const settingMatch = user.match(/Setting:\s*"([^"]*)"/)
  const charsMatch = user.match(/Characters expected:\s*([^\n]*)/)
  const proseMatch = user.match(/Prose:\n---\n([\s\S]*?)\n---/)

  return {
    scenario: p._meta.scenario,
    variant: p._meta.variant,
    beat: beatMatch?.[1] ?? "",
    setting: settingMatch?.[1] ?? "",
    characters: (charsMatch?.[1] ?? "").split(",").map(s => s.trim()).filter(Boolean),
    prose: proseMatch?.[1].trim() ?? "",
    expectedPass: expected.pass,
  }
}

// ── Four decomposed prompts ───────────────────────────────────────────────

const EVENTS_SYSTEM = `You verify whether the prose ENACTS a specific scene beat on-page.

Find the passage where the beat's action happens — characters performing the action, dialogue, narration of the action as it occurs in scene.

Rules:
- "Enacted" means the action happens IN SCENE during this prose. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized in narration as backstory) does NOT count as enacted.
- Characters being merely present in the scene is NOT enough — the beat's specific action must occur.
- If you cannot find a passage where the beat is enacted, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

const SETTING_SYSTEM = `You verify whether the prose's setting matches the expected setting for a scene beat.

The expected setting is a brief description (e.g., "a crowded tavern, evening, smoky torchlight"). The prose's actual setting is wherever the action takes place — the location, time of day, and atmospheric markers.

A "setting mismatch" is when the prose places the scene in a clearly different location, time, or environment than what was expected. Minor variation in atmospheric detail is fine. Different building, different time of day, different outdoor/indoor, different city — those are mismatches.

If the prose has no clear setting at all (purely abstract or interior monologue with no place markers), return setting_matches=false with reasoning noting the absence.

Respond with ONLY valid JSON in this exact shape:
{
  "setting_matches": true | false,
  "expected_setting": "<the expected setting, restated>",
  "actual_setting": "<the setting the prose actually establishes>",
  "reasoning": "<one sentence>"
}`

const TANGENT_SYSTEM = `You measure how much of the prose advances a specific scene beat versus going off on tangents.

A "tangent" is content that does not serve the beat: unrelated subplot, lengthy backstory, scene drift to another topic, atmospheric description that's longer than the actual beat content, or the prose pivoting to something the beat does not call for.

Atmospheric details that decorate the beat are NOT tangents. Backstory that the beat itself implies is NOT a tangent. The threshold for is_tangent=true is when the bulk of the prose (more than ~40%) is doing something other than executing the beat.

Estimate the off-spec fraction (0.0 = entirely on-spec, 1.0 = entirely off-spec). Quote any clearly off-spec passage.

Respond with ONLY valid JSON in this exact shape:
{
  "off_spec_fraction": 0.0,
  "off_spec_quote": "<quoted passage, or empty string>",
  "is_tangent": true | false,
  "reasoning": "<one sentence>"
}`

const CHARACTER_SYSTEM = `You verify whether characters in the prose behave consistently with their roles in a scene beat.

A character "acts contrary to their role" when they do something the beat says they should NOT do, or when they take an action that reverses the beat's intended dynamic (e.g., the beat calls for the character to refuse but the prose has them immediately agree, or the beat calls for confrontation but the prose has them stay silent).

Do NOT flag normal creative interpretation: dialogue rewording, gesture additions, emotional shading, or pacing variation. Only flag clear contradictions.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where contradiction occurs, or empty string>",
  "reasoning": "<one sentence>"
}`

function buildEventsUser(p: ParsedPair): string {
  return `BEAT: ${p.beat}
CHARACTERS EXPECTED: ${p.characters.join(", ")}

PROSE:
---
${p.prose}
---`
}

function buildSettingUser(p: ParsedPair): string {
  return `BEAT: ${p.beat}
EXPECTED SETTING: ${p.setting}

PROSE:
---
${p.prose}
---`
}

function buildTangentUser(p: ParsedPair): string {
  return `BEAT: ${p.beat}

PROSE:
---
${p.prose}
---`
}

function buildCharacterUser(p: ParsedPair): string {
  return `BEAT: ${p.beat}
CHARACTERS EXPECTED: ${p.characters.join(", ")}

PROSE:
---
${p.prose}
---`
}

// ── Per-call dispatcher ───────────────────────────────────────────────────

interface CallOutcome {
  ok: boolean
  flag?: boolean   // "issue fired?" — true means this call flagged a problem
  ms: number
  promptTokens?: number
  completionTokens?: number
  raw?: string
  error?: string
}

type Slot = "events" | "setting" | "tangent" | "character"

async function runSlot(target: ModelTarget, slot: Slot, p: ParsedPair): Promise<CallOutcome> {
  const transport = getTransport()
  const t0 = performance.now()
  let system: string, user: string
  if (slot === "events")        { system = EVENTS_SYSTEM;    user = buildEventsUser(p) }
  else if (slot === "setting")  { system = SETTING_SYSTEM;   user = buildSettingUser(p) }
  else if (slot === "tangent")  { system = TANGENT_SYSTEM;   user = buildTangentUser(p) }
  else                          { system = CHARACTER_SYSTEM; user = buildCharacterUser(p) }

  try {
    const result = await transport.execute({
      systemPrompt: system,
      userPrompt: user,
      provider: target.provider,
      model: target.model,
      temperature: 0.1,
      maxTokens: 384,
      responseFormat: { type: "json_object" },
    })
    const ms = performance.now() - t0
    let content = result.content.trim()
    if (content.startsWith("```")) {
      content = content.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
    }
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) content = jsonMatch[0]
    const parsed = JSON.parse(content)

    let flag: boolean
    if (slot === "events")        flag = parsed.events_present === false
    else if (slot === "setting")  flag = parsed.setting_matches === false
    else if (slot === "tangent")  flag = parsed.is_tangent === true
    else                          flag = parsed.character_contradiction === true

    return {
      ok: true,
      flag,
      ms,
      promptTokens: result.usage.prompt_tokens,
      completionTokens: result.usage.completion_tokens,
    }
  } catch (e: any) {
    return { ok: false, ms: performance.now() - t0, error: e?.message ?? String(e) }
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────

interface VariantStats {
  agree: number
  disagree: number
  errors: number
  truePass: number
  trueFail: number
  falsePass: number
  falseFail: number
}

function emptyStats(): VariantStats {
  return { agree: 0, disagree: 0, errors: 0, truePass: 0, trueFail: 0, falsePass: 0, falseFail: 0 }
}

interface SlotFireStats {
  fired: number   // # of times this slot returned flag=true
  total: number   // # of successful calls
  errors: number
}

interface ModelStats {
  byVariant: Map<string, VariantStats>
  overall: VariantStats
  pairLatencies: number[]
  inTokens: number[]
  outTokens: number[]
  slotStats: Record<Slot, SlotFireStats>
  // Per-variant fire rate per slot — for diagnosing which call drives gains
  byVariantSlotFires: Map<string, Record<Slot, number>>
}

function emptyModelStats(): ModelStats {
  return {
    byVariant: new Map<string, VariantStats>(),
    overall: emptyStats(),
    pairLatencies: [],
    inTokens: [],
    outTokens: [],
    slotStats: {
      events:    { fired: 0, total: 0, errors: 0 },
      setting:   { fired: 0, total: 0, errors: 0 },
      tangent:   { fired: 0, total: 0, errors: 0 },
      character: { fired: 0, total: 0, errors: 0 },
    },
    byVariantSlotFires: new Map(),
  }
}

function recordPair(stats: ModelStats, variant: string, expectedPass: boolean, modelPass: boolean | null) {
  if (!stats.byVariant.has(variant)) stats.byVariant.set(variant, emptyStats())
  const v = stats.byVariant.get(variant)!
  if (modelPass === null) {
    v.errors++
    stats.overall.errors++
    return
  }
  const matches = modelPass === expectedPass
  if (matches) { v.agree++; stats.overall.agree++ }
  else         { v.disagree++; stats.overall.disagree++ }
  if (expectedPass && modelPass)        { v.truePass++; stats.overall.truePass++ }
  else if (!expectedPass && !modelPass) { v.trueFail++; stats.overall.trueFail++ }
  else if (!expectedPass && modelPass)  { v.falsePass++; stats.overall.falsePass++ }
  else                                  { v.falseFail++; stats.overall.falseFail++ }
}

function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 100)
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  let rawPairs: Pair[] = lines.map(l => JSON.parse(l))

  if (SAMPLE_N && SAMPLE_N < rawPairs.length) {
    rawPairs = [...rawPairs].sort(() => Math.random() - 0.5).slice(0, SAMPLE_N)
    console.log(`Sampling ${SAMPLE_N} of ${lines.length} pairs`)
  }

  const pairs = rawPairs.map(parsePair)
  console.log(`Pairs: ${pairs.length}  models: ${MODELS.length}  slots: 4`)
  console.log(`Approx LLM calls: ${pairs.length * MODELS.length * 4}\n`)

  const expId = await createTuningExperiment(
    "decomposed-calls",
    `Adherence-checker decomposed: 4 parallel calls per pair (events / setting / tangent / character) on Llama 8B / Qwen3-14B / Qwen 235B (${pairs.length} pairs)`,
    {
      pairs: pairs.length,
      models: MODELS.map(m => ({ key: m.key, label: m.label, provider: m.provider, model: m.model })),
      temperature: 0.1,
      maxTokensPerCall: 384,
      pairsFile: "lora-data/adherence-checker-pairs.jsonl",
      slots: ["events", "setting", "tangent", "character"],
      hypothesis: "Production adherence-checker prompt asks 3 questions (events / setting / character) in ONE call and entirely lacks a question for FAIL_TANGENT. Exp #111 disconfirmed structured-checklist (single call, more output structure) but per-API-call decomposition is a different shape: each call gets its own attention budget AND a tailored prompt for one failure mode. Four calls: (1) events with positive-evidence quoting → catches FAIL_MISSING, (2) setting matches expected → catches FAIL_SETTING (added after smoke run showed events doesn't naturally catch wrong-place; 235B regressed 96→88% in the 3-call version), (3) tangent with off-spec fraction estimation → catches FAIL_TANGENT (the orphaned failure mode in #110/#111), (4) character contradiction quoting → catches FAIL_CHAR. Aggregate: PASS only if all four return clean. Target: close the 14B 79% gap by addressing the meaningful-vs-nominal collapse on FAIL_TANGENT specifically. If 14B closes meaningfully, this becomes a production prompt swap candidate AND may eliminate the SFT need.",
      relatedExperiments: [110, 111],
    },
    { target: "adherence-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}\n`)

  const allStats = new Map<string, ModelStats>()
  for (const m of MODELS) allStats.set(m.key, emptyModelStats())

  // 4 pairs × 3 models × 4 slots = 48 in-flight peak. Within rate limits.
  const PAIR_CONCURRENCY = 4
  const SLOTS: Slot[] = ["events", "setting", "tangent", "character"]

  for (let i = 0; i < pairs.length; i += PAIR_CONCURRENCY) {
    const batch = pairs.slice(i, i + PAIR_CONCURRENCY)
    await Promise.all(batch.map(async (parsed, batchIdx) => {
      const idx = i + batchIdx

      const perModel = await Promise.all(MODELS.map(async (m) => {
        const tPair0 = performance.now()
        const slotOutcomes = await Promise.all(SLOTS.map(slot => runSlot(m, slot, parsed)))
        const pairMs = performance.now() - tPair0

        const stats = allStats.get(m.key)!
        let anyError = false
        let anyFlag = false
        if (!stats.byVariantSlotFires.has(parsed.variant)) {
          stats.byVariantSlotFires.set(parsed.variant, { events: 0, setting: 0, tangent: 0, character: 0 })
        }
        const variantFires = stats.byVariantSlotFires.get(parsed.variant)!

        for (let si = 0; si < SLOTS.length; si++) {
          const slot = SLOTS[si]
          const o = slotOutcomes[si]
          const ss = stats.slotStats[slot]
          if (!o.ok || o.flag === undefined) {
            ss.errors++
            anyError = true
            continue
          }
          ss.total++
          if (o.flag) {
            ss.fired++
            variantFires[slot]++
            anyFlag = true
          }
          if (o.promptTokens) stats.inTokens.push(o.promptTokens)
          if (o.completionTokens) stats.outTokens.push(o.completionTokens)
        }

        let pairPass: boolean | null
        if (anyError && !anyFlag) pairPass = null
        else pairPass = !anyFlag

        stats.pairLatencies.push(pairMs)
        recordPair(stats, parsed.variant, parsed.expectedPass, pairPass)
        return { key: m.key, pairPass, slotOutcomes }
      }))

      const tags = perModel.map(r => {
        if (r.pairPass === null) return `${r.key}:ERR`
        const got = r.pairPass === parsed.expectedPass ? "OK" : "✗"
        return `${r.key}:${got}`
      }).join(" ")
      console.log(`[${idx + 1}/${pairs.length}] ${parsed.scenario}/${parsed.variant} (${parsed.expectedPass ? "PASS" : "FAIL"}) → ${tags}`)
    }))
  }

  // ── Report ──────────────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(96))
  console.log("RESULTS — adherence decomposed (3 parallel calls)")
  console.log("═".repeat(96) + "\n")

  const variants = ["PASS_CLEAN", "PASS_PARAPHRASE", "PASS_REORDER", "PASS_ATMOSPHERIC",
                    "FAIL_MISSING", "FAIL_CHAR", "FAIL_SETTING", "FAIL_TANGENT"]

  process.stdout.write("variant".padEnd(22))
  for (const m of MODELS) process.stdout.write(m.key.padStart(14))
  process.stdout.write("\n")
  console.log("─".repeat(22 + 14 * MODELS.length))

  for (const variant of variants) {
    process.stdout.write(variant.padEnd(22))
    for (const m of MODELS) {
      const s = allStats.get(m.key)!.byVariant.get(variant)
      if (!s) { process.stdout.write("—".padStart(14)); continue }
      const total = s.agree + s.disagree
      process.stdout.write(`${pct(s.agree, total)}% (${s.agree}/${total})`.padStart(14))
    }
    process.stdout.write("\n")
  }
  console.log("─".repeat(22 + 14 * MODELS.length))

  process.stdout.write("OVERALL".padEnd(22))
  for (const m of MODELS) {
    const o = allStats.get(m.key)!.overall
    const total = o.agree + o.disagree
    process.stdout.write(`${pct(o.agree, total)}% (${o.agree}/${total})`.padStart(14))
  }
  process.stdout.write("\n\n")

  console.log("Per-model confusion + slot fire rates + cost:")
  for (const m of MODELS) {
    const s = allStats.get(m.key)!
    const o = s.overall
    console.log(`  ${m.label}`)
    console.log(`    truePass=${o.truePass} trueFail=${o.trueFail} falsePass=${o.falsePass} falseFail=${o.falseFail} errors=${o.errors}`)
    for (const slot of ["events", "setting", "tangent", "character"] as Slot[]) {
      const ss = s.slotStats[slot]
      console.log(`    ${slot.padEnd(10)} fired ${ss.fired}/${ss.total} (${pct(ss.fired, ss.total)}%)  errors=${ss.errors}`)
    }
    console.log(`    pair latency (parallel max) avg=${Math.round(avg(s.pairLatencies))}ms  tokens in=${Math.round(avg(s.inTokens))}/out=${Math.round(avg(s.outTokens))}`)
  }

  console.log("\nSlot-fire rates per variant (where each call is firing the loudest):")
  for (const m of MODELS) {
    console.log(`  ${m.key}:`)
    for (const variant of variants) {
      const fires = allStats.get(m.key)!.byVariantSlotFires.get(variant)
      if (!fires) continue
      const vs = allStats.get(m.key)!.byVariant.get(variant)!
      const tot = vs.agree + vs.disagree
      console.log(`    ${variant.padEnd(20)} events=${fires.events}/${tot} setting=${fires.setting}/${tot} tangent=${fires.tangent}/${tot} character=${fires.character}/${tot}`)
    }
  }

  // Comparison with #110 baseline (hardcoded for at-a-glance):
  console.log("\n#110/#111 baseline overall (single-call, flat / checklist):")
  console.log("  llama8b=58%/59%  qwen14b=79%/68%  qwen235b=96%/79%")

  // Persist
  const conclusion = JSON.stringify({
    pairs: pairs.length,
    shape: "decomposed-3-calls (events / tangent / character)",
    models: MODELS.map(m => {
      const s = allStats.get(m.key)!
      const o = s.overall
      const total = o.agree + o.disagree
      const variantTable: Record<string, { agree: number; total: number; pct: number; falsePass: number; falseFail: number }> = {}
      for (const [v, st] of s.byVariant) {
        const t = st.agree + st.disagree
        variantTable[v] = { agree: st.agree, total: t, pct: pct(st.agree, t), falsePass: st.falsePass, falseFail: st.falseFail }
      }
      const slotsOut: Record<string, { fired: number; total: number; pct: number; errors: number }> = {}
      for (const slot of ["events", "setting", "tangent", "character"] as Slot[]) {
        const ss = s.slotStats[slot]
        slotsOut[slot] = { fired: ss.fired, total: ss.total, pct: pct(ss.fired, ss.total), errors: ss.errors }
      }
      return {
        key: m.key,
        label: m.label,
        provider: m.provider,
        model: m.model,
        overallAgreementPct: pct(o.agree, total),
        agree: o.agree,
        total,
        errors: o.errors,
        truePass: o.truePass,
        trueFail: o.trueFail,
        falsePass: o.falsePass,
        falseFail: o.falseFail,
        slots: slotsOut,
        avgPairLatencyMs: Math.round(avg(s.pairLatencies)),
        avgInTokens: Math.round(avg(s.inTokens)),
        avgOutTokens: Math.round(avg(s.outTokens)),
        byVariant: variantTable,
      }
    }),
  })
  await concludeExperiment(expId, conclusion)
  console.log(`\nConcluded experiment ${expId}.`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
