#!/usr/bin/env bun
/**
 * Tier-ordering probe v1 — the adversary's cheapest-untried-counterfactual
 * from `docs/charters/tier-ordering-validation-v1.md` §10.
 *
 * PIVOT from charter v1: the original lever (establishedFacts density +
 * characterStateChanges floor) was shown to be vacuous during the terrain
 * survey — neither field flows bulk-wise to the writer prompt per the
 * finding captured in charter §11. This probe uses `requiredPayoffs`
 * density as the lever instead, because `src/agents/writer/beat-context.ts`
 * renders requiredPayoffs into the writer's SEEDS and PAYOFFS DUE blocks
 * (beat-context.ts:255-281), so density changes are actually writer-visible.
 *
 * QUESTION:
 *   Does the DeepSeek beat-writer respond (in adherence-events pass rate)
 *   to programmatically inflating `requiredPayoffs` per beat from ~0-1 to
 *   ≥3?
 *
 * DECISION RULE:
 *   - Positive delta (loud > baseline, >=5pt) → full 2x2 charter revision
 *     is worth commissioning (proceed to stage 2 with Salvatore + Llama 8B).
 *   - Zero or negative delta → structured-state-density isn't a load-bearing
 *     writer-visible lever at 14-beat chapter scale; roadmap Tier 1 needs
 *     to focus on different writer-visible knobs.
 *
 * FIXTURE:
 *   - novel-1776691080571 (epic-fantasy, debt-magic premise)
 *   - Chapters 1 + 2 (13 beats each, 5 & 4 establishedFacts respectively,
 *     2 total requiredPayoffs each → plenty of headroom to inflate)
 *   - DeepSeek V3.2 only (probe stage; writer transfer is stage 2)
 *
 * USAGE:
 *   EXPERIMENT_ID=N bun scripts/evals/tier-ordering-probe-v1.ts \
 *     [--novel <id>] [--chapters 1,2] [--create-experiment]
 *
 * PERSISTENCE:
 *   eval_results with set_name='tier-ordering-probe-v1', cell_label in
 *   {baseline, loud}, adapter_uri='deepseek-v4-flash'. `actual_label_json`
 *   holds the adherence-events result; `correct` mirrors adherence.pass.
 */

import db from "../../src/db/connection"
import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"
import { initExperimentRun } from "../../src/logger"
import { executeAndLog } from "../../src/llm"
import { getTokenCost } from "../../src/models/registry"
import type { ProviderName } from "../../src/models/registry"
import {
  getNovel, getChapterOutline, getCharacters,
  getCharacterStatesAtChapter, getWorldBible,
} from "../../src/db"
import { buildBeatContext } from "../../src/agents/writer/beat-context"
import { checkBeatAdherence } from "../../src/agents/writer/adherence-checker"
import { BEAT_WRITER_PROMPT } from "../../src/prompts"
import type { ChapterOutline, SceneBeat } from "../../src/types"

const DEEPSEEK_MODEL = "deepseek-v4-flash"
const DEEPSEEK_PROVIDER: ProviderName = "deepseek"
const ADAPTER_URI = "deepseek-v4-flash"
const PAYOFF_FLOOR = 3

interface GenResult {
  cell: "baseline" | "loud"
  chapter: number
  beatIndex: number
  prose: string
  wordCount: number
  cost: number
  adherencePass: boolean
  adherenceIssues: string[]
  error?: string
}

// ── Lever: inflate requiredPayoffs ─────────────────────────────────────

/**
 * Single-knob transformation — does not modify establishedFacts (those are
 * already populated by the planner; we only ensure each beat has at least
 * `floor` links to them). Does not modify beat.description.
 *
 * Contract:
 *   - Skip last 2 beats (can't seed a payoff past chapter end).
 *   - Each added link uses a fact_id not already seeded by this beat.
 *   - payoff_beat distributes uniformly between i+1 and scenes.length-1.
 *   - Returns a deep-cloned outline; original is untouched.
 */
function inflateRequiredPayoffs(outline: ChapterOutline, floor = PAYOFF_FLOOR): ChapterOutline {
  const clone = structuredClone(outline) as ChapterOutline
  const facts = (clone.establishedFacts ?? []).filter(f => !!f.id)
  if (facts.length === 0) return clone
  const scenes = clone.scenes
  for (let i = 0; i < scenes.length - 2; i++) {
    const beat = scenes[i]
    beat.requiredPayoffs = beat.requiredPayoffs ?? []
    const existing = new Set(beat.requiredPayoffs.map(p => p.fact_id))
    for (const fact of facts) {
      if (beat.requiredPayoffs.length >= floor) break
      if (existing.has(fact.id)) continue
      const range = scenes.length - 1 - i
      const offset = 1 + (beat.requiredPayoffs.length % range)
      const payoff_beat = Math.min(i + offset, scenes.length - 1)
      beat.requiredPayoffs.push({ fact_id: fact.id, payoff_beat })
      existing.add(fact.id)
    }
  }
  return clone
}

// ── Per-beat generation + measurement ──────────────────────────────────

async function generateAndMeasure(
  cell: "baseline" | "loud",
  outline: ChapterOutline,
  chapterNumber: number,
  beatIndex: number,
  previousProse: string | undefined,
  novelId: string,
  characters: any[],
  characterStates: any[],
  worldBible: any,
  genre: string | undefined,
  setName: string,
): Promise<GenResult> {
  const beat = outline.scenes[beatIndex]
  const beatId = `${novelId}::ch${chapterNumber}::b${beatIndex}::${cell}`

  const ctx = await buildBeatContext({
    novelId, chapterNumber, beatIndex,
    previousBeatProse: previousProse,
    outline, characters, characterStates, worldBible,
    compactMode: false,
    genre,
  })

  try {
    const resp = await executeAndLog(
      {
        systemPrompt: BEAT_WRITER_PROMPT,
        userPrompt: ctx.userPrompt,
        model: DEEPSEEK_MODEL,
        provider: DEEPSEEK_PROVIDER,
        temperature: 0.8,
        maxTokens: 4000,
        responseFormat: { type: "text" },
      },
      novelId,
      `tier-probe-${cell}-writer`,
      { chapter: chapterNumber, beatIndex, attempt: 1 },
      { meta: { charter: "tier-ordering-probe-v1", cell, beat_id: beatId } },
    )

    const prose = resp.content.trim()
    const wordCount = prose.split(/\s+/).filter(Boolean).length
    const cost = getTokenCost(
      DEEPSEEK_PROVIDER, DEEPSEEK_MODEL,
      resp.usage.prompt_tokens, resp.usage.completion_tokens, resp.usage.cached_tokens,
    )

    const adherence = await checkBeatAdherence(prose, beat, outline, characters, {
      novelId, chapter: chapterNumber, beatIndex, attempt: 1,
    })

    return {
      cell, chapter: chapterNumber, beatIndex, prose, wordCount, cost,
      adherencePass: adherence.pass, adherenceIssues: adherence.issues,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      cell, chapter: chapterNumber, beatIndex, prose: "", wordCount: 0, cost: 0,
      adherencePass: false, adherenceIssues: [`gen-error: ${msg}`], error: msg,
    }
  }
}

async function persistResult(
  r: GenResult,
  novelId: string,
  setName: string,
  experimentId: number | null,
): Promise<void> {
  const beatId = `${novelId}::ch${r.chapter}::b${r.beatIndex}::${r.cell}`
  await db`
    INSERT INTO eval_results (
      experiment_id, set_name, beat_id, adapter_uri, cell_label,
      generated_prose, word_count,
      actual_label_json, correct, error_text
    ) VALUES (
      ${experimentId}, ${setName}, ${beatId}, ${ADAPTER_URI}, ${r.cell},
      ${r.prose}, ${r.wordCount},
      ${JSON.stringify({ adherence_pass: r.adherencePass, adherence_issues: r.adherenceIssues })},
      ${r.adherencePass},
      ${r.error ?? null}
    )
  `
}

// ── Summary analysis ───────────────────────────────────────────────────

function summarize(results: GenResult[]): void {
  const byCell: Record<string, GenResult[]> = { baseline: [], loud: [] }
  for (const r of results) byCell[r.cell].push(r)

  function cellStats(rs: GenResult[]) {
    const n = rs.length
    const passed = rs.filter(r => r.adherencePass).length
    const passRate = n ? passed / n : 0
    const avgWords = n ? rs.reduce((s, r) => s + r.wordCount, 0) / n : 0
    const avgIssues = n ? rs.reduce((s, r) => s + r.adherenceIssues.length, 0) / n : 0
    const errors = rs.filter(r => r.error).length
    return { n, passed, passRate, avgWords, avgIssues, errors }
  }

  const base = cellStats(byCell.baseline)
  const loud = cellStats(byCell.loud)

  console.log("")
  console.log("=".repeat(70))
  console.log("TIER-ORDERING PROBE v1 — summary")
  console.log("=".repeat(70))
  console.log(`BASELINE: n=${base.n} adh_pass=${base.passed}/${base.n} (${(base.passRate*100).toFixed(1)}%) avg_words=${base.avgWords.toFixed(1)} avg_issues=${base.avgIssues.toFixed(2)} errors=${base.errors}`)
  console.log(`LOUD:     n=${loud.n} adh_pass=${loud.passed}/${loud.n} (${(loud.passRate*100).toFixed(1)}%) avg_words=${loud.avgWords.toFixed(1)} avg_issues=${loud.avgIssues.toFixed(2)} errors=${loud.errors}`)
  const delta = (loud.passRate - base.passRate) * 100
  console.log("")
  console.log(`DELTA (loud - baseline) adh_pass_rate: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts`)
  console.log("")
  console.log("Decision guidance:")
  if (Math.abs(delta) < 5) {
    console.log("  → FLAT (|Δ|<5pt). Writer is indifferent to requiredPayoffs density at this chapter scale.")
    console.log("    Do NOT commission the full 2×2. Roadmap Tier 1 needs a different writer-visible lever.")
  } else if (delta >= 5) {
    console.log("  → POSITIVE (Δ≥+5pt). Writer responds to density. Proceed to revised 2×2:")
    console.log("    {baseline, loud} × {DeepSeek, Salvatore v4, Llama 8B} with adversary's other fixes.")
  } else {
    console.log("  → NEGATIVE (Δ≤-5pt). Writer REGRESSES on density. Investigate before commissioning 2×2;")
    console.log("    may indicate the loud variant overloads the SEEDS/PAYOFFS blocks.")
  }
  console.log("")
  console.log(`Writer cost: $${results.reduce((s, r) => s + r.cost, 0).toFixed(4)} (${results.length} beat-writer calls)`)
}

// ── Main ───────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  return {
    novelId: get("--novel") ?? "novel-1776691080571",
    chapters: (get("--chapters") ?? "1,2").split(",").map(s => parseInt(s.trim(), 10)),
    setName: get("--set-name") ?? "tier-ordering-probe-v1",
    createExperiment: argv.includes("--create-experiment"),
    experimentIdArg: get("--experiment-id"),
  }
}

async function main() {
  const args = parseArgs()

  console.log(`[probe] novel=${args.novelId} chapters=${args.chapters.join(",")} set=${args.setName}`)

  const novel = await getNovel(args.novelId)
  const characters = await getCharacters(args.novelId)
  const worldBible = await getWorldBible(args.novelId)
  const genre: string | undefined = (novel.seed as any)?.genre

  const chapterData: Array<{ ch: number; baselineOutline: ChapterOutline; loudOutline: ChapterOutline; characterStates: any[] }> = []
  for (const ch of args.chapters) {
    const outline = await getChapterOutline(args.novelId, ch)
    const characterStates = await getCharacterStatesAtChapter(args.novelId, ch)
    const baseline = outline
    const loud = inflateRequiredPayoffs(outline, PAYOFF_FLOOR)

    const baseTot = baseline.scenes.reduce((s, b) => s + (b.requiredPayoffs?.length ?? 0), 0)
    const loudTot = loud.scenes.reduce((s, b) => s + (b.requiredPayoffs?.length ?? 0), 0)
    console.log(`  ch${ch}: beats=${outline.scenes.length} facts=${outline.establishedFacts?.length ?? 0} payoffs baseline=${baseTot} loud=${loudTot}`)
    if (loudTot <= baseTot) {
      console.warn(`  [warn] ch${ch}: loud total payoffs (${loudTot}) not greater than baseline (${baseTot}) — fixture too saturated for density lever`)
    }

    chapterData.push({ ch, baselineOutline: baseline, loudOutline: loud, characterStates })
  }

  let experimentId: number | null = null
  if (args.experimentIdArg) experimentId = parseInt(args.experimentIdArg, 10)
  else if (process.env.EXPERIMENT_ID) experimentId = parseInt(process.env.EXPERIMENT_ID, 10)
  else if (args.createExperiment) {
    experimentId = await createTuningExperiment(
      "ticket",
      `Tier-ordering probe v1 — ${args.setName}. Tests whether the DeepSeek beat-writer responds to programmatically inflated requiredPayoffs density (baseline vs floor-of-${PAYOFF_FLOOR}/beat) on chapters ${args.chapters.join(",")} of ${args.novelId}. Cheapest-untried-counterfactual from docs/charters/tier-ordering-validation-v1.md §10 (Opus adversary RED verdict), pivoted to requiredPayoffs after terrain-survey kill of the original establishedFacts lever (charter §11).`,
      {
        set_name: args.setName,
        novel_id: args.novelId,
        chapters: args.chapters,
        payoff_floor: PAYOFF_FLOOR,
        writer: `${DEEPSEEK_PROVIDER}/${DEEPSEEK_MODEL}`,
        charter: "docs/charters/tier-ordering-validation-v1.md",
      },
    )
    console.log(`[probe] created experiment #${experimentId}`)
  }

  if (experimentId !== null) {
    const runId = await initExperimentRun(experimentId, "eval", args.setName, `tier-ordering-probe-v1 ${args.setName}`)
    console.log(`[probe] initialized run #${runId} (llm_calls persistence enabled)`)
  }

  const allResults: GenResult[] = []
  for (const cd of chapterData) {
    for (const cell of ["baseline", "loud"] as const) {
      const outline = cell === "baseline" ? cd.baselineOutline : cd.loudOutline
      console.log(`[probe] ch${cd.ch} ${cell}: ${outline.scenes.length} beats`)
      let previousProse: string | undefined = undefined
      for (let bi = 0; bi < outline.scenes.length; bi++) {
        const r = await generateAndMeasure(
          cell, outline, cd.ch, bi, previousProse,
          args.novelId, characters, cd.characterStates, worldBible, genre, args.setName,
        )
        allResults.push(r)
        await persistResult(r, args.novelId, args.setName, experimentId)
        console.log(`    ch${cd.ch}b${bi} ${cell}: ${r.wordCount}w adh=${r.adherencePass ? "PASS" : "FAIL"}${r.error ? " (err)" : ""}${r.adherenceIssues.length ? " issues=" + r.adherenceIssues.length : ""}`)
        if (!r.error && r.prose) previousProse = r.prose
      }
    }
  }

  summarize(allResults)

  if (experimentId !== null && (args.createExperiment || process.env.EXPERIMENT_ID)) {
    const byCell = { baseline: allResults.filter(r => r.cell === "baseline"), loud: allResults.filter(r => r.cell === "loud") }
    const baseRate = byCell.baseline.length ? byCell.baseline.filter(r => r.adherencePass).length / byCell.baseline.length : 0
    const loudRate = byCell.loud.length ? byCell.loud.filter(r => r.adherencePass).length / byCell.loud.length : 0
    const delta = (loudRate - baseRate) * 100
    const totalCost = allResults.reduce((s, r) => s + r.cost, 0)
    await concludeExperiment(
      experimentId,
      `Probe complete. n=${allResults.length} beat-writer calls. baseline adh_pass=${(baseRate*100).toFixed(1)}% loud adh_pass=${(loudRate*100).toFixed(1)}% delta=${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pt. Writer cost: $${totalCost.toFixed(4)}. ${Math.abs(delta) < 5 ? "FLAT — do not commission 2x2." : delta >= 5 ? "POSITIVE — proceed to 2x2 with Salvatore v4 + Llama 8B anchor." : "NEGATIVE — investigate SEEDS/PAYOFFS overload before 2x2."}`,
    )
  }
  process.exit(0)
}

if (import.meta.main) {
  main().catch(e => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1) })
}
