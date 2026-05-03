#!/usr/bin/env bun
/**
 * Arm B preflight stratum-rate audit per
 * `docs/charters/arm-b-detector-preflight.md` §3 (source-novel
 * eligibility gate) and §6 (exact-pool feasibility manifest).
 *
 * Runs BEFORE any generation spend. Takes a candidate source novel,
 * classifies each deduped beat under the §6 predicates (lore-heavy,
 * state-leaning, `none` fallback — dialogue-heavy is preserved as
 * descriptive-only per revision 9), reads the historical
 * halluc-ungrounded fire labels from `llm_calls.response_content`,
 * and emits:
 *
 *   1. Overall measured fire rate (asserted ∈ [0.24, 0.34] symmetric
 *      per §3 eligibility gate)
 *   2. Per-stratum fire rate + beat count
 *   3. Realized pool manifest under the §6 reallocate-to-none policy
 *      (lore priority, then state, then fill to N=40 from none)
 *   4. Poisson-binomial expected fires/arm + std + 1-sigma-below
 *   5. Floor-clearance assertion (1-σ-below ≥ 8)
 *
 * Writes the full audit record to a JSON artifact for the results
 * memo to cite.
 *
 * Exit codes:
 *   0 — eligibility gate passes AND floor-clearance clears
 *   1 — eligibility gate fails (rate outside [0.24, 0.34])
 *   2 — floor-clearance fails (1-σ-below < 8)
 *   3 — infeasible pool (total eligible beats across all strata < 40)
 *
 * Usage:
 *   bun scripts/evals/preflight-arm-b-stratum-audit.ts \
 *     --novel novel-1776690840208 \
 *     --out output/evals/arm-b-preflight-pool-manifest-rev9.json
 */

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import db from "../../../src/db/connection"
import { getWorldBible } from "../../../src/db/world"

// ── Constants per charter §3, §6 ──────────────────────────────────────

const N_TARGET = 40
const LORE_TARGET = 16
const STATE_TARGET = 10
const ELIGIBILITY_BAND: [number, number] = [0.24, 0.34]
const FIRE_FLOOR_PER_ARM = 8

// State-leaning predicate regex — checked into the charter (§6) so it
// cannot drift silently. Matches case-insensitively against
// `beat.description`.
const STATE_REGEX =
  /\b(remember(s|ed|ing)?|recall(s|ed|ing)?|know(s|n|ew)?|recogni[sz]e(s|d|ing)?|wonder(s|ed|ing)?\s+whether|already|still|again|(for|since)\s+(the|her|his|their)\s+(first|last))\b/i

// ── Types ──────────────────────────────────────────────────────────────

type Stratum = "dialogue" | "lore" | "state" | "none"

interface ClassifiedBeat {
  llm_call_id: number
  chapter: number
  beat_index: number
  stratum: Stratum
  fired: boolean  // historical halluc-ungrounded label
}

interface AuditResult {
  novel_id: string
  audited_at: string
  eligibility: {
    overall_fire_rate: number
    band: [number, number]
    passes: boolean
  }
  strata: Record<Stratum, { count: number; fires: number; rate: number }>
  pool: {
    policy: "lore-first-then-state-then-none"
    target_N: number
    realized_N: number
    composition: Record<Stratum, number>
    beats: Array<{
      llm_call_id: number
      chapter: number
      beat_index: number
      stratum: Stratum
    }>
  }
  floor_clearance: {
    expected_fires_per_arm: number
    poisson_binomial_sigma: number
    one_sigma_below: number
    floor: number
    clears: boolean
  }
}

// ── Predicates ─────────────────────────────────────────────────────────

function buildLoreMatcher(entityNames: string[]) {
  const filtered = entityNames.filter(n => n && n.length >= 4)
  return (desc: string, priorDescs: string[]): boolean => {
    const dl = desc.toLowerCase()
    for (const n of filtered) {
      const lower = n.toLowerCase()
      const idx = dl.indexOf(lower)
      if (idx < 0) continue
      const before = idx > 0 ? dl[idx - 1] : ""
      const after = idx + lower.length < dl.length ? dl[idx + lower.length] : ""
      if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue
      // Must NOT appear in any prior beat's description in the same chapter
      if (!priorDescs.some(pd => pd.toLowerCase().includes(lower))) return true
    }
    return false
  }
}

function classifyStratum(
  beat: { kind?: string; characters?: string[]; description: string },
  chapter: number,
  priorDescs: string[],
  loreMatcher: (desc: string, prior: string[]) => boolean,
): Stratum {
  const isDialogue =
    beat.kind === "dialogue" && (beat.characters?.length ?? 0) >= 3
  if (isDialogue) return "dialogue"
  if (loreMatcher(beat.description ?? "", priorDescs)) return "lore"
  if (chapter >= 3 && STATE_REGEX.test(beat.description ?? "")) return "state"
  return "none"
}

// ── Main audit ─────────────────────────────────────────────────────────

interface BeatRow {
  llm_call_id: number
  chapter: number
  beat_index: number
  outline_json: { scenes?: Array<{ description?: string; kind?: string; characters?: string[] }> } | null
}

async function audit(novelId: string): Promise<AuditResult> {
  const wb = await getWorldBible(novelId)
  const entities = [
    ...(wb.locations ?? []).map(l => l.name),
    ...(wb.cultures ?? []).map(c => c.name),
    ...(wb.systems ?? []).map(s => s.name),
  ]
  const loreMatcher = buildLoreMatcher(entities)

  // Pull beat-writer rows with chapter outlines
  const rows = await db<BeatRow[]>`
    SELECT c.id as llm_call_id, c.chapter, c.beat_index, co.outline_json
    FROM llm_calls c
    LEFT JOIN chapter_outlines co
      ON co.novel_id = c.novel_id AND co.chapter_number = c.chapter
    WHERE c.novel_id = ${novelId}
      AND c.agent = 'beat-writer'
      AND c.failed IS NOT TRUE
      AND c.user_prompt IS NOT NULL
    ORDER BY c.chapter, c.beat_index, c.id
  `

  // Pull historical halluc-ungrounded fire labels
  const hallucRows = await db<Array<{ chapter: number; beat_index: number; response_content: string | null }>>`
    SELECT chapter, beat_index, response_content
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'halluc-ungrounded'
      AND failed IS NOT TRUE
  `
  const fireByBeat = new Map<string, boolean>()
  for (const r of hallucRows) {
    const key = `${r.chapter}:${r.beat_index}`
    let fired = false
    if (r.response_content) {
      try {
        fired = (JSON.parse(r.response_content) as { pass?: boolean }).pass === false
      } catch {
        // malformed response — treat as not fired
      }
    }
    if (fired || !fireByBeat.has(key)) fireByBeat.set(key, fired || !!fireByBeat.get(key))
  }

  // Classify each deduped beat
  const classified: ClassifiedBeat[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const key = `${r.chapter}:${r.beat_index}`
    if (seen.has(key)) continue
    seen.add(key)
    const scenes = r.outline_json?.scenes ?? []
    const beat = scenes[r.beat_index]
    if (!beat) continue
    const priorDescs = scenes.slice(0, r.beat_index).map(s => s?.description ?? "")
    const stratum = classifyStratum(beat, r.chapter, priorDescs, loreMatcher)
    classified.push({
      llm_call_id: r.llm_call_id,
      chapter: r.chapter,
      beat_index: r.beat_index,
      stratum,
      fired: fireByBeat.get(key) === true,
    })
  }

  // Per-stratum rates
  const strata: Record<Stratum, { count: number; fires: number; rate: number }> = {
    dialogue: { count: 0, fires: 0, rate: 0 },
    lore: { count: 0, fires: 0, rate: 0 },
    state: { count: 0, fires: 0, rate: 0 },
    none: { count: 0, fires: 0, rate: 0 },
  }
  for (const b of classified) {
    strata[b.stratum].count++
    if (b.fired) strata[b.stratum].fires++
  }
  for (const k of Object.keys(strata) as Stratum[]) {
    const s = strata[k]
    s.rate = s.count > 0 ? s.fires / s.count : 0
  }

  const totalCount = classified.length
  const totalFires = classified.filter(b => b.fired).length
  const overallRate = totalCount > 0 ? totalFires / totalCount : 0

  // Build pool via reallocate-to-none policy (§6 revision 9)
  const byStratum: Record<Stratum, ClassifiedBeat[]> = {
    dialogue: [],
    lore: [],
    state: [],
    none: [],
  }
  for (const b of classified) byStratum[b.stratum].push(b)

  const pool: ClassifiedBeat[] = []
  pool.push(...byStratum.lore.slice(0, LORE_TARGET))
  pool.push(...byStratum.state.slice(0, STATE_TARGET))
  const noneNeeded = N_TARGET - pool.length
  pool.push(...byStratum.none.slice(0, Math.max(0, noneNeeded)))

  const composition: Record<Stratum, number> = {
    dialogue: pool.filter(b => b.stratum === "dialogue").length,
    lore: pool.filter(b => b.stratum === "lore").length,
    state: pool.filter(b => b.stratum === "state").length,
    none: pool.filter(b => b.stratum === "none").length,
  }

  // Poisson-binomial floor-clearance math
  const expected = (Object.keys(composition) as Stratum[]).reduce(
    (sum, k) => sum + composition[k] * strata[k].rate,
    0,
  )
  const variance = (Object.keys(composition) as Stratum[]).reduce(
    (sum, k) => sum + composition[k] * strata[k].rate * (1 - strata[k].rate),
    0,
  )
  const sigma = Math.sqrt(variance)
  const oneSigmaBelow = expected - sigma

  return {
    novel_id: novelId,
    audited_at: new Date().toISOString(),
    eligibility: {
      overall_fire_rate: Number(overallRate.toFixed(4)),
      band: ELIGIBILITY_BAND,
      passes: overallRate >= ELIGIBILITY_BAND[0] && overallRate <= ELIGIBILITY_BAND[1],
    },
    strata,
    pool: {
      policy: "lore-first-then-state-then-none",
      target_N: N_TARGET,
      realized_N: pool.length,
      composition,
      beats: pool.map(b => ({
        llm_call_id: b.llm_call_id,
        chapter: b.chapter,
        beat_index: b.beat_index,
        stratum: b.stratum,
      })),
    },
    floor_clearance: {
      expected_fires_per_arm: Number(expected.toFixed(4)),
      poisson_binomial_sigma: Number(sigma.toFixed(4)),
      one_sigma_below: Number(oneSigmaBelow.toFixed(4)),
      floor: FIRE_FLOOR_PER_ARM,
      clears: oneSigmaBelow >= FIRE_FLOOR_PER_ARM,
    },
  }
}

// ── CLI ───────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  return {
    novel: get("--novel"),
    out: get("--out"),
  }
}

async function main() {
  const args = parseArgs()
  if (!args.novel) {
    console.error("usage: --novel <novel_id> [--out <manifest-path>]")
    process.exit(2)
  }
  const result = await audit(args.novel)

  console.log(`[audit] novel=${args.novel}`)
  console.log(`[audit] overall fire rate: ${(result.eligibility.overall_fire_rate * 100).toFixed(1)}% (${result.strata.dialogue.count + result.strata.lore.count + result.strata.state.count + result.strata.none.count} deduped beats)`)
  console.log(`[audit] eligibility band: [${(result.eligibility.band[0] * 100).toFixed(0)}%, ${(result.eligibility.band[1] * 100).toFixed(0)}%] → ${result.eligibility.passes ? "PASS" : "FAIL"}`)
  console.log("")
  console.log(`[audit] per-stratum rates:`)
  for (const k of ["dialogue", "lore", "state", "none"] as const) {
    const s = result.strata[k]
    console.log(`  ${k}: ${s.fires}/${s.count} = ${(s.rate * 100).toFixed(1)}%`)
  }
  console.log("")
  console.log(`[audit] realized pool (reallocate-to-none):`)
  console.log(`  composition: ${JSON.stringify(result.pool.composition)}`)
  console.log(`  realized N: ${result.pool.realized_N} (target ${result.pool.target_N})`)
  console.log("")
  console.log(`[audit] floor-clearance:`)
  console.log(`  expected fires/arm: ${result.floor_clearance.expected_fires_per_arm}`)
  console.log(`  Poisson-binomial σ: ${result.floor_clearance.poisson_binomial_sigma}`)
  console.log(`  1-σ below:          ${result.floor_clearance.one_sigma_below}`)
  console.log(`  floor:              ${result.floor_clearance.floor}`)
  console.log(`  clears floor:       ${result.floor_clearance.clears ? "YES" : "NO"}`)

  if (args.out) {
    await mkdir(path.dirname(path.resolve(args.out)), { recursive: true })
    await writeFile(path.resolve(args.out), JSON.stringify(result, null, 2))
    console.log("")
    console.log(`[audit] manifest written: ${args.out}`)
  }

  // Exit codes per charter §3 / §6
  if (!result.eligibility.passes) {
    console.error(`[audit] EXIT 1: eligibility gate FAIL — ${(result.eligibility.overall_fire_rate * 100).toFixed(1)}% outside [${(result.eligibility.band[0] * 100).toFixed(0)}%, ${(result.eligibility.band[1] * 100).toFixed(0)}%]`)
    process.exit(1)
  }
  if (result.pool.realized_N < N_TARGET) {
    console.error(`[audit] EXIT 3: infeasible pool — only ${result.pool.realized_N}/${N_TARGET} eligible beats available across all strata`)
    process.exit(3)
  }
  if (!result.floor_clearance.clears) {
    console.error(`[audit] EXIT 2: floor-clearance FAIL — 1-σ-below ${result.floor_clearance.one_sigma_below} < ${FIRE_FLOOR_PER_ARM}`)
    process.exit(2)
  }
  console.log(`[audit] EXIT 0: all gates pass`)
}

if (import.meta.main) {
  main().catch(e => {
    console.error(e instanceof Error ? e.stack ?? e.message : String(e))
    process.exit(4)
  })
}

export { audit, classifyStratum, buildLoreMatcher, type AuditResult, type Stratum }
