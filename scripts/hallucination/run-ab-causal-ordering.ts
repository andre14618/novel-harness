#!/usr/bin/env bun
/**
 * A/B test: EVENTS_SYSTEM v2 (baseline) vs v3-causal-ordering vs v4-causal-ordering-tighter (L25)
 *
 * Targets the reversed-order shape recall gap from L21/L18:
 *   - reversed-order-fail-02 (mage drain before binding) is the sole FN after v2 promotion.
 *   - reversed-order-fail-01 (Sara calls before seeing) is already caught by v2.
 *   - reversed-order-pass-01 (Kael draws+shouts, parallel) must remain TN.
 *
 * Acceptance (all must hold for promotion):
 *   - reversed-order-fail-02 caught (was FN in v2)
 *   - reversed-order-pass-01 still passes (no FP)
 *   - embellishment TN=100% retained
 *   - labeled panel 100/100 retained
 *   - two-of-three + substituted-actor recall do NOT regress
 *
 * v3 design: add one positive-framed bullet about causal sequencing.
 *   Positive framing only per feedback_priming_suppression_ab.
 *   Language: "When the beat sequences events with 'then', 'after', 'before', or
 *   causal logic (X is a prerequisite for Y), check that the prose preserves that
 *   sequence. If a prerequisite action occurs after its consequence in the prose,
 *   return events_present=false even if all events are present."
 *
 * v4 design: tighter version of v3 — adds explicit example (binding requires
 *   being cast before the drain can happen; Sara must open the door before seeing).
 *
 * Usage:
 *   DATABASE_URL=... bun scripts/hallucination/run-ab-causal-ordering.ts \
 *     [--partial-enact <path>] [--labeled <path>] [--persist] [--exp-id N]
 *
 * Outputs (timestamped, never overwritten):
 *   /tmp/ab-causal-ordering-<YYYYMMDDTHHMMSS>.jsonl
 *   /tmp/ab-causal-ordering-<YYYYMMDDTHHMMSS>.summary.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { callAgent } from "../../src/llm"
import type { ChapterOutline, SceneBeat } from "../../src/types"
import { z } from "zod"

// ── Arg parsing ───────────────────────────────────────────────────────────────

interface Args {
  partialEnactPath: string
  labeledPath: string
  persist: boolean
  expId?: number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let partialEnactPath = resolve(
    "scripts/hallucination/synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl"
  )
  let labeledPath = "/tmp/halluc-current-panel-exp299-labeled.jsonl"
  let persist = false
  let expId: number | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--partial-enact") partialEnactPath = argv[++i]
    else if (argv[i] === "--labeled") labeledPath = argv[++i]
    else if (argv[i] === "--persist") persist = true
    else if (argv[i] === "--exp-id") expId = Number(argv[++i])
  }
  return { partialEnactPath, labeledPath, persist, expId }
}

// ── Timestamp ─────────────────────────────────────────────────────────────────

function timestamp(): string {
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  return (
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "T" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  )
}

// ── Prompt versions ───────────────────────────────────────────────────────────

// v2: current live production prompt (baseline for this run)
const EVENTS_SYSTEM_V2 = `You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — whether dramatic, mechanical, or ambient — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- Each action must be performed by the character the beat assigns it to. If the beat says Character A does something but the prose has Character B do it, the action is NOT correctly enacted.
- Treat every listed action as equally obligated regardless of dramatic weight. Mechanical or ambient actions (lighting candles, opening doors, picking up objects, asking sub-questions) are as obligated as dramatic actions if the beat specifies them. Do not distinguish between major and minor events — if the beat names it, it must appear.
- If ANY action from the beat is missing, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

// v3: v2 + causal-ordering rule (positive framing, no neg-prime patterns)
// Approach: add one bullet after the "ALL must appear" rule, before the
// "equally obligated" rule. Uses "then" / "after" / prerequisite language
// to cue the model to verify sequence, not just presence.
const EVENTS_SYSTEM_V3 = `You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — whether dramatic, mechanical, or ambient — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- Each action must be performed by the character the beat assigns it to. If the beat says Character A does something but the prose has Character B do it, the action is NOT correctly enacted.
- Treat every listed action as equally obligated regardless of dramatic weight. Mechanical or ambient actions (lighting candles, opening doors, picking up objects, asking sub-questions) are as obligated as dramatic actions if the beat specifies them. Do not distinguish between major and minor events — if the beat names it, it must appear.
- When the beat sequences events with "then", "after", "before", "next", or implicit causal logic (where X is a prerequisite for Y to occur), verify that the prose enacts them in the same order. If a prerequisite action occurs after its consequence in the prose, return events_present=false even when all events are present.
- If ANY action from the beat is missing, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

// v4: tighter version of v3 — same causal-ordering bullet plus one concrete
// example grounding what "prerequisite" means in practice.
const EVENTS_SYSTEM_V4 = `You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — whether dramatic, mechanical, or ambient — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- Each action must be performed by the character the beat assigns it to. If the beat says Character A does something but the prose has Character B do it, the action is NOT correctly enacted.
- Treat every listed action as equally obligated regardless of dramatic weight. Mechanical or ambient actions (lighting candles, opening doors, picking up objects, asking sub-questions) are as obligated as dramatic actions if the beat specifies them. Do not distinguish between major and minor events — if the beat names it, it must appear.
- When the beat sequences events with "then", "after", "before", "next", or causal logic (where action A must occur before action B can follow), check that the prose preserves that sequence. For example: if the beat says "casts the binding, then drains the well", the prose must show the binding cast first; if the beat says "unlocks the door, then sees the body", the door must be opened before the body is visible. If the prose reverses a causally-ordered sequence, return events_present=false even when all events are present.
- If ANY action from the beat is missing, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

// ── Schema ────────────────────────────────────────────────────────────────────

const eventsSchema = z.object({
  events_present: z.boolean(),
  evidence: z.string().optional().default(""),
  reasoning: z.string().optional().default(""),
})

// ── Panel row types ───────────────────────────────────────────────────────────

interface PartialEnactRow {
  fixture_id: string
  checker: string
  case_role: string
  fixture_shape: string
  oracle_label: string
  task: {
    prose: string
    writer_request_meta: {
      beatDescription: string
      beatCharacters: string[]
    }
  }
  gold: {
    expected_pass: boolean
    oracle_label: string
    obligated_events: string[]
    missing_events: string[]
    notes: string
  }
}

interface LabeledRow {
  fixture_id: string
  checker: string
  case_role: string
  task: {
    prose: string
    writer_request_meta: {
      beatDescription: string
      beatCharacters: string[]
    }
  }
  gold: {
    oracle_label: string
    expected_pass: boolean
    obligated_events: string[]
    missing_events: Array<string | { event?: string; text?: string }>
  }
}

// ── Stub builders ─────────────────────────────────────────────────────────────

function makeBeatFromPartialEnact(row: PartialEnactRow): SceneBeat {
  const meta = row.task.writer_request_meta
  return {
    description: meta.beatDescription,
    characters: meta.beatCharacters ?? [],
    kind: "action",
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
    requiredPayoffs: [],
  }
}

function makeBeatFromLabeled(row: LabeledRow): SceneBeat {
  const meta = row.task.writer_request_meta
  return {
    description: meta.beatDescription,
    characters: meta.beatCharacters ?? [],
    kind: "action",
    obligations: { facts: [], characterState: [], payoffs: [] },
    requiredPayoffs: [],
  }
}

// ── Single LLM call ───────────────────────────────────────────────────────────

async function runEventsCheck(
  prose: string,
  beat: SceneBeat,
  systemPrompt: string,
): Promise<{ events_present: boolean; reasoning: string; evidence: string }> {
  const proseTrimmed = prose.slice(0, 2000)
  const charsLine = beat.characters.join(", ")
  const userPrompt = `BEAT: ${beat.description}
CHARACTERS EXPECTED: ${charsLine}

PROSE:
---
${proseTrimmed}
---`

  const result = await callAgent({
    agentName: "adherence-events" as const,
    systemPrompt,
    userPrompt,
    schema: eventsSchema,
  })
  return {
    events_present: result.output.events_present,
    reasoning: result.output.reasoning ?? "",
    evidence: result.output.evidence ?? "",
  }
}

// ── Per-row result ────────────────────────────────────────────────────────────

interface ABRowResult {
  fixture_id: string
  panel: "partial-enact" | "labeled"
  fixture_shape: string
  oracle_pass: boolean
  v2_pass: boolean
  v3_pass: boolean
  v4_pass: boolean
  v2_reasoning: string
  v3_reasoning: string
  v4_reasoning: string
  v2_disposition: "TP" | "FP" | "FN" | "TN"
  v3_disposition: "TP" | "FP" | "FN" | "TN"
  v4_disposition: "TP" | "FP" | "FN" | "TN"
  v2_correct: boolean
  v3_correct: boolean
  v4_correct: boolean
}

function classify(checkerPass: boolean, oraclePass: boolean): "TP" | "FP" | "FN" | "TN" {
  if (!checkerPass && !oraclePass) return "TP"
  if (!checkerPass && oraclePass) return "FP"
  if (checkerPass && !oraclePass) return "FN"
  return "TN"
}

// ── Per-shape metrics ─────────────────────────────────────────────────────────

interface ShapeMetrics {
  shape: string
  n_fail: number
  n_pass: number
  v2: { tp: number; fp: number; fn: number; tn: number; recall: number | null; precision: number | null; f1: number | null }
  v3: { tp: number; fp: number; fn: number; tn: number; recall: number | null; precision: number | null; f1: number | null }
  v4: { tp: number; fp: number; fn: number; tn: number; recall: number | null; precision: number | null; f1: number | null }
}

function computeShapeMetrics(rows: ABRowResult[]): ShapeMetrics[] {
  const shapes = [...new Set(rows.map(r => r.fixture_shape))]
  return shapes.map(shape => {
    const sr = rows.filter(r => r.fixture_shape === shape)
    const nFail = sr.filter(r => !r.oracle_pass).length
    const nPass = sr.filter(r => r.oracle_pass).length

    function metrics(version: "v2" | "v3" | "v4") {
      const vDisp = `${version}_disposition` as "v2_disposition" | "v3_disposition" | "v4_disposition"
      const tp = sr.filter(r => r[vDisp] === "TP").length
      const fp = sr.filter(r => r[vDisp] === "FP").length
      const fn = sr.filter(r => r[vDisp] === "FN").length
      const tn = sr.filter(r => r[vDisp] === "TN").length
      const recall = tp + fn === 0 ? null : tp / (tp + fn)
      const precision = tp + fp === 0 ? null : tp / (tp + fp)
      const f1 = recall !== null && precision !== null && recall + precision > 0
        ? 2 * recall * precision / (recall + precision) : null
      return { tp, fp, fn, tn, recall, precision, f1 }
    }
    return { shape, n_fail: nFail, n_pass: nPass, v2: metrics("v2"), v3: metrics("v3"), v4: metrics("v4") }
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  const ts = timestamp()
  const results: ABRowResult[] = []

  console.log("=== L25 A/B: EVENTS_SYSTEM v2 (baseline) vs v3-causal-ordering vs v4-causal-ordering-tighter ===")
  console.log()

  // ── (a) Partial-enactment panel ───────────────────────────────────────────

  console.log("--- Panel (a): L18 partial-enactment panel ---")

  const peLines = readFileSync(resolve(args.partialEnactPath), "utf8").trim().split("\n")
  const peRows: PartialEnactRow[] = peLines
    .filter(l => l.trim())
    .map(l => JSON.parse(l))
    .filter((r: any) => r.checker === "adherence-events")

  console.log(`  ${peRows.length} rows from ${args.partialEnactPath}`)
  console.log()

  let peIdx = 0
  for (const row of peRows) {
    peIdx++
    const beat = makeBeatFromPartialEnact(row)
    const oraclePass = row.gold.expected_pass

    let v2: { events_present: boolean; reasoning: string; evidence: string }
    let v3: { events_present: boolean; reasoning: string; evidence: string }
    let v4: { events_present: boolean; reasoning: string; evidence: string }

    try {
      v2 = await runEventsCheck(row.task.prose, beat, EVENTS_SYSTEM_V2)
    } catch (err) {
      console.error(`  v2 CHECKER ERROR on ${row.fixture_id}: ${err}`)
      v2 = { events_present: false, reasoning: `ERROR: ${err}`, evidence: "" }
    }
    try {
      v3 = await runEventsCheck(row.task.prose, beat, EVENTS_SYSTEM_V3)
    } catch (err) {
      console.error(`  v3 CHECKER ERROR on ${row.fixture_id}: ${err}`)
      v3 = { events_present: false, reasoning: `ERROR: ${err}`, evidence: "" }
    }
    try {
      v4 = await runEventsCheck(row.task.prose, beat, EVENTS_SYSTEM_V4)
    } catch (err) {
      console.error(`  v4 CHECKER ERROR on ${row.fixture_id}: ${err}`)
      v4 = { events_present: false, reasoning: `ERROR: ${err}`, evidence: "" }
    }

    const v2Disp = classify(v2.events_present, oraclePass)
    const v3Disp = classify(v3.events_present, oraclePass)
    const v4Disp = classify(v4.events_present, oraclePass)

    const row_result: ABRowResult = {
      fixture_id: row.fixture_id,
      panel: "partial-enact",
      fixture_shape: row.fixture_shape,
      oracle_pass: oraclePass,
      v2_pass: v2.events_present,
      v3_pass: v3.events_present,
      v4_pass: v4.events_present,
      v2_reasoning: v2.reasoning,
      v3_reasoning: v3.reasoning,
      v4_reasoning: v4.reasoning,
      v2_disposition: v2Disp,
      v3_disposition: v3Disp,
      v4_disposition: v4Disp,
      v2_correct: v2.events_present === oraclePass,
      v3_correct: v3.events_present === oraclePass,
      v4_correct: v4.events_present === oraclePass,
    }
    results.push(row_result)

    const v2tag = v2Disp === "TP" || v2Disp === "TN" ? "✓" : "✗"
    const v3tag = v3Disp === "TP" || v3Disp === "TN" ? "✓" : "✗"
    const v4tag = v4Disp === "TP" || v4Disp === "TN" ? "✓" : "✗"
    const changedV3 = v2Disp !== v3Disp ? " v3-CHANGED" : ""
    const changedV4 = v2Disp !== v4Disp ? " v4-CHANGED" : ""
    console.log(
      `  [${peIdx}/${peRows.length}] [${row.fixture_shape}] ${row.fixture_id}` +
      `\n    v2: ${v2tag} ${v2Disp}  v3: ${v3tag} ${v3Disp}${changedV3}  v4: ${v4tag} ${v4Disp}${changedV4}`
    )
    if (v2Disp !== v3Disp) {
      console.log(`    v3 reasoning: ${v3.reasoning}`)
    }
    if (v2Disp !== v4Disp) {
      console.log(`    v4 reasoning: ${v4.reasoning}`)
    }
    // Always print reasoning for reversed-order rows (key shape)
    if (row.fixture_shape === "reversed-order") {
      console.log(`    v2 reasoning: ${v2.reasoning}`)
      if (v2Disp === v3Disp) console.log(`    v3 reasoning: ${v3.reasoning}`)
      if (v2Disp === v4Disp) console.log(`    v4 reasoning: ${v4.reasoning}`)
    }
  }

  // ── (b) Labeled panel ─────────────────────────────────────────────────────

  console.log()
  console.log("--- Panel (b): Labeled panel (adherence-events / current_surface_natural) ---")

  if (!existsSync(args.labeledPath)) {
    console.warn(`  WARNING: labeled panel not found at ${args.labeledPath} — skipping`)
  } else {
    const lLines = readFileSync(resolve(args.labeledPath), "utf8").trim().split("\n")
    const lRows: LabeledRow[] = lLines
      .filter(l => l.trim())
      .map(l => JSON.parse(l))
      .filter((r: any) => r.checker === "adherence-events" && r.case_role === "current_surface_natural")

    console.log(`  ${lRows.length} rows from ${args.labeledPath}`)
    console.log()

    let lIdx = 0
    for (const row of lRows) {
      lIdx++
      const beat = makeBeatFromLabeled(row)
      const oraclePass = row.gold.expected_pass ?? (row.gold.oracle_label === "events_fully_enacted")

      let v2: { events_present: boolean; reasoning: string; evidence: string }
      let v3: { events_present: boolean; reasoning: string; evidence: string }
      let v4: { events_present: boolean; reasoning: string; evidence: string }

      try {
        v2 = await runEventsCheck(row.task.prose, beat, EVENTS_SYSTEM_V2)
      } catch (err) {
        console.error(`  v2 CHECKER ERROR on ${row.fixture_id}: ${err}`)
        v2 = { events_present: false, reasoning: `ERROR: ${err}`, evidence: "" }
      }
      try {
        v3 = await runEventsCheck(row.task.prose, beat, EVENTS_SYSTEM_V3)
      } catch (err) {
        console.error(`  v3 CHECKER ERROR on ${row.fixture_id}: ${err}`)
        v3 = { events_present: false, reasoning: `ERROR: ${err}`, evidence: "" }
      }
      try {
        v4 = await runEventsCheck(row.task.prose, beat, EVENTS_SYSTEM_V4)
      } catch (err) {
        console.error(`  v4 CHECKER ERROR on ${row.fixture_id}: ${err}`)
        v4 = { events_present: false, reasoning: `ERROR: ${err}`, evidence: "" }
      }

      const v2Disp = classify(v2.events_present, oraclePass)
      const v3Disp = classify(v3.events_present, oraclePass)
      const v4Disp = classify(v4.events_present, oraclePass)

      const row_result: ABRowResult = {
        fixture_id: row.fixture_id,
        panel: "labeled",
        fixture_shape: "labeled-panel",
        oracle_pass: oraclePass,
        v2_pass: v2.events_present,
        v3_pass: v3.events_present,
        v4_pass: v4.events_present,
        v2_reasoning: v2.reasoning,
        v3_reasoning: v3.reasoning,
        v4_reasoning: v4.reasoning,
        v2_disposition: v2Disp,
        v3_disposition: v3Disp,
        v4_disposition: v4Disp,
        v2_correct: v2.events_present === oraclePass,
        v3_correct: v3.events_present === oraclePass,
        v4_correct: v4.events_present === oraclePass,
      }
      results.push(row_result)

      const v2tag = v2Disp === "TP" || v2Disp === "TN" ? "✓" : "✗"
      const v3tag = v3Disp === "TP" || v3Disp === "TN" ? "✓" : "✗"
      const v4tag = v4Disp === "TP" || v4Disp === "TN" ? "✓" : "✗"
      const changedV3 = v2Disp !== v3Disp ? " v3-CHANGED" : ""
      const changedV4 = v2Disp !== v4Disp ? " v4-CHANGED" : ""
      console.log(
        `  [${lIdx}/${lRows.length}] [labeled] ${row.fixture_id}` +
        `\n    v2: ${v2tag} ${v2Disp}  v3: ${v3tag} ${v3Disp}${changedV3}  v4: ${v4tag} ${v4Disp}${changedV4}`
      )
      if (v2Disp !== v3Disp) console.log(`    v3 reasoning: ${v3.reasoning}`)
      if (v2Disp !== v4Disp) console.log(`    v4 reasoning: ${v4.reasoning}`)
    }
  }

  // ── Aggregates ────────────────────────────────────────────────────────────

  console.log()
  console.log("=== Per-shape A/B matrix (partial-enact panel) ===")

  const peResults = results.filter(r => r.panel === "partial-enact")
  const peShapeMetrics = computeShapeMetrics(peResults)
  const pct = (v: number | null) => v === null ? "N/A" : `${(v * 100).toFixed(0)}%`

  console.log(
    "  Shape".padEnd(32) + "N_fail".padEnd(8) +
    "v2_TP".padEnd(7) + "v2_FN".padEnd(7) + "v2_Rec".padEnd(10) +
    "v3_TP".padEnd(7) + "v3_FN".padEnd(7) + "v3_Rec".padEnd(10) +
    "v4_TP".padEnd(7) + "v4_FN".padEnd(7) + "v4_Rec"
  )
  for (const m of peShapeMetrics) {
    console.log(
      `  ${m.shape}`.padEnd(32) + String(m.n_fail).padEnd(8) +
      String(m.v2.tp).padEnd(7) + String(m.v2.fn).padEnd(7) + pct(m.v2.recall).padEnd(10) +
      String(m.v3.tp).padEnd(7) + String(m.v3.fn).padEnd(7) + pct(m.v3.recall).padEnd(10) +
      String(m.v4.tp).padEnd(7) + String(m.v4.fn).padEnd(7) + pct(m.v4.recall)
    )
  }

  // Labeled panel summary
  const lResults = results.filter(r => r.panel === "labeled")
  if (lResults.length > 0) {
    console.log()
    console.log("=== Labeled panel binary matrix ===")
    for (const version of ["v2", "v3", "v4"] as const) {
      const vDisp = `${version}_disposition` as "v2_disposition" | "v3_disposition" | "v4_disposition"
      const tp = lResults.filter(r => r[vDisp] === "TP").length
      const fp = lResults.filter(r => r[vDisp] === "FP").length
      const fn = lResults.filter(r => r[vDisp] === "FN").length
      const tn = lResults.filter(r => r[vDisp] === "TN").length
      const prec = tp + fp === 0 ? null : tp / (tp + fp)
      const rec = tp + fn === 0 ? null : tp / (tp + fn)
      console.log(`  ${version}: TP=${tp} FP=${fp} FN=${fn} TN=${tn}  Prec=${pct(prec)} Rec=${pct(rec)}`)
    }
  }

  // Embellishment TN check
  const embRows = peResults.filter(r => r.fixture_shape === "acceptable-embellishment")
  if (embRows.length > 0) {
    console.log()
    console.log("=== Embellishment control (must be TN=100%) ===")
    for (const version of ["v2", "v3", "v4"] as const) {
      const vDisp = `${version}_disposition` as "v2_disposition" | "v3_disposition" | "v4_disposition"
      const tn = embRows.filter(r => r[vDisp] === "TN").length
      const fp = embRows.filter(r => r[vDisp] === "FP").length
      console.log(`  ${version}: TN=${tn}/${embRows.length}  FP=${fp}`)
    }
  }

  // ── Reversed-order detail ─────────────────────────────────────────────────

  const roRows = peResults.filter(r => r.fixture_shape === "reversed-order")
  console.log()
  console.log("=== Reversed-order shape detail ===")
  for (const row of roRows) {
    const v2tag = row.v2_disposition === "TP" || row.v2_disposition === "TN" ? "✓" : "✗"
    const v3tag = row.v3_disposition === "TP" || row.v3_disposition === "TN" ? "✓" : "✗"
    const v4tag = row.v4_disposition === "TP" || row.v4_disposition === "TN" ? "✓" : "✗"
    console.log(`  ${row.fixture_id} [oracle=${row.oracle_pass ? "PASS" : "FAIL"}]`)
    console.log(`    v2: ${v2tag} ${row.v2_disposition} | reasoning: ${row.v2_reasoning}`)
    console.log(`    v3: ${v3tag} ${row.v3_disposition} | reasoning: ${row.v3_reasoning}`)
    console.log(`    v4: ${v4tag} ${row.v4_disposition} | reasoning: ${row.v4_reasoning}`)
  }

  // ── Acceptance verdict ────────────────────────────────────────────────────

  const roMetrics = peShapeMetrics.find(m => m.shape === "reversed-order")
  const v2RoRecall = roMetrics?.v2.recall ?? null
  const v3RoRecall = roMetrics?.v3.recall ?? null
  const v4RoRecall = roMetrics?.v4.recall ?? null

  const twoOfThreeMetrics = peShapeMetrics.find(m => m.shape === "two-of-three")
  const v3TwoOfThreeRecall = twoOfThreeMetrics?.v3.recall ?? null
  const v4TwoOfThreeRecall = twoOfThreeMetrics?.v4.recall ?? null

  const subActorMetrics = peShapeMetrics.find(m => m.shape === "substituted-actor")
  const v3SubActorRecall = subActorMetrics?.v3.recall ?? null
  const v4SubActorRecall = subActorMetrics?.v4.recall ?? null

  const embV3Tn = embRows.length > 0
    ? embRows.filter(r => r.v3_disposition === "TN").length === embRows.length
    : true
  const embV4Tn = embRows.length > 0
    ? embRows.filter(r => r.v4_disposition === "TN").length === embRows.length
    : true

  const lV3Fp = lResults.filter(r => r.v3_disposition === "FP").length
  const lV3Fn = lResults.filter(r => r.v3_disposition === "FN").length
  const lV3Prec = (() => {
    const tp = lResults.filter(r => r.v3_disposition === "TP").length
    const fp = lV3Fp
    return tp + fp === 0 ? null : tp / (tp + fp)
  })()

  const lV4Fp = lResults.filter(r => r.v4_disposition === "FP").length
  const lV4Fn = lResults.filter(r => r.v4_disposition === "FN").length
  const lV4Prec = (() => {
    const tp = lResults.filter(r => r.v4_disposition === "TP").length
    const fp = lV4Fp
    return tp + fp === 0 ? null : tp / (tp + fp)
  })()

  // v2 baseline for reference (reversed-order recall)
  const v2BaselineRoRecall = 67 // from L21 definitive run

  function candidateVerdict(
    versionLabel: string,
    roRecall: number | null,
    twoOfThreeRecall: number | null,
    subActorRecall: number | null,
    embTn: boolean,
    labeledFp: number,
    labeledFn: number,
    labeledPrec: number | null,
  ): string {
    // Acceptance: reversed-order-fail-02 caught (recall=100%), pass-01 TN,
    // embellishment TN=100%, labeled 100/100, two-of-three+substituted-actor not regressed
    const roOk = roRecall !== null && roRecall >= 0.999
    const embOk = embTn
    const labeledPrecOk = labeledPrec === null || labeledPrec >= 0.999
    const labeledRecOk = labeledFn === 0
    const twoOfThreeOk = twoOfThreeRecall === null || twoOfThreeRecall >= (67 / 100 - 0.001)
    const subActorOk = subActorRecall === null || subActorRecall >= (67 / 100 - 0.001)

    if (roOk && embOk && labeledPrecOk && labeledRecOk && twoOfThreeOk && subActorOk) {
      return `PASS — ${versionLabel} PROMOTED`
    }
    const failures = []
    if (!roOk) failures.push(`reversed-order recall ${pct(roRecall)} < 100% (fail-02 still FN)`)
    if (!embOk) failures.push("embellishment TN regressed")
    if (!labeledPrecOk) failures.push(`labeled panel precision ${pct(labeledPrec)} < 100%`)
    if (!labeledRecOk) failures.push(`labeled panel FN=${labeledFn}`)
    if (!twoOfThreeOk) failures.push(`two-of-three recall ${pct(twoOfThreeRecall)} regressed`)
    if (!subActorOk) failures.push(`substituted-actor recall ${pct(subActorRecall)} regressed`)
    return `FAIL — ${failures.join("; ")}`
  }

  const v3Verdict = candidateVerdict(
    "v3",
    v3RoRecall, v3TwoOfThreeRecall, v3SubActorRecall,
    embV3Tn, lV3Fp, lV3Fn, lV3Prec,
  )
  const v4Verdict = candidateVerdict(
    "v4",
    v4RoRecall, v4TwoOfThreeRecall, v4SubActorRecall,
    embV4Tn, lV4Fp, lV4Fn, lV4Prec,
  )

  console.log()
  console.log("=== Acceptance verdict ===")
  console.log(`  v3: ${v3Verdict}`)
  console.log(`    reversed-order recall: v2=${pct(v2RoRecall)} → v3=${pct(v3RoRecall)}`)
  console.log(`    two-of-three recall:   v3=${pct(v3TwoOfThreeRecall)}`)
  console.log(`    substituted-actor:     v3=${pct(v3SubActorRecall)}`)
  console.log(`    labeled precision:     v3=${pct(lV3Prec)} (FP=${lV3Fp} FN=${lV3Fn})`)
  console.log(`    embellishment TN:      v3=${embV3Tn ? "100%" : "REGRESSED"}`)
  console.log()
  console.log(`  v4: ${v4Verdict}`)
  console.log(`    reversed-order recall: v2=${pct(v2RoRecall)} → v4=${pct(v4RoRecall)}`)
  console.log(`    two-of-three recall:   v4=${pct(v4TwoOfThreeRecall)}`)
  console.log(`    substituted-actor:     v4=${pct(v4SubActorRecall)}`)
  console.log(`    labeled precision:     v4=${pct(lV4Prec)} (FP=${lV4Fp} FN=${lV4Fn})`)
  console.log(`    embellishment TN:      v4=${embV4Tn ? "100%" : "REGRESSED"}`)

  // Overall session acceptance: best candidate among v3/v4
  const promotedVersion =
    v3Verdict.startsWith("PASS") ? "v3" :
    v4Verdict.startsWith("PASS") ? "v4" :
    null

  const sessionVerdict = promotedVersion
    ? `PROMOTED — ${promotedVersion} passes all acceptance criteria`
    : `DEFERRED — no candidate passes all acceptance criteria`

  console.log()
  console.log(`=== Session verdict: ${sessionVerdict} ===`)

  // ── Write output ──────────────────────────────────────────────────────────

  const outBase = `/tmp/ab-causal-ordering-${ts}`
  const jsonlPath = `${outBase}.jsonl`
  const summaryPath = `${outBase}.summary.json`

  writeFileSync(jsonlPath, results.map(r => JSON.stringify(r)).join("\n") + "\n")

  const summary = {
    timestamp: ts,
    session: "L25",
    experiment_id: args.expId ?? null,
    partial_enact_path: args.partialEnactPath,
    labeled_path: args.labeledPath,
    session_verdict: sessionVerdict,
    promoted_version: promotedVersion,
    reversed_order: {
      v2_recall_pct: v2RoRecall === null ? null : Math.round(v2RoRecall * 1000) / 10,
      v3_recall_pct: v3RoRecall === null ? null : Math.round(v3RoRecall * 1000) / 10,
      v4_recall_pct: v4RoRecall === null ? null : Math.round(v4RoRecall * 1000) / 10,
      v3_verdict: v3Verdict,
      v4_verdict: v4Verdict,
    },
    labeled_panel: {
      n_rows: lResults.length,
      v3_fp: lV3Fp,
      v3_fn: lV3Fn,
      v3_precision_pct: lV3Prec === null ? null : Math.round(lV3Prec * 1000) / 10,
      v4_fp: lV4Fp,
      v4_fn: lV4Fn,
      v4_precision_pct: lV4Prec === null ? null : Math.round(lV4Prec * 1000) / 10,
    },
    embellishment_control: {
      n_rows: embRows.length,
      v3_tn_count: embRows.filter(r => r.v3_disposition === "TN").length,
      v4_tn_count: embRows.filter(r => r.v4_disposition === "TN").length,
    },
    per_shape: peShapeMetrics.map(m => ({
      shape: m.shape,
      n_fail: m.n_fail,
      n_pass: m.n_pass,
      v2: {
        tp: m.v2.tp, fp: m.v2.fp, fn: m.v2.fn, tn: m.v2.tn,
        recall_pct: m.v2.recall === null ? null : Math.round(m.v2.recall * 1000) / 10,
      },
      v3: {
        tp: m.v3.tp, fp: m.v3.fp, fn: m.v3.fn, tn: m.v3.tn,
        recall_pct: m.v3.recall === null ? null : Math.round(m.v3.recall * 1000) / 10,
      },
      v4: {
        tp: m.v4.tp, fp: m.v4.fp, fn: m.v4.fn, tn: m.v4.tn,
        recall_pct: m.v4.recall === null ? null : Math.round(m.v4.recall * 1000) / 10,
      },
    })),
    per_row: results,
  }
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))

  console.log()
  console.log(`Wrote ${results.length} rows to ${jsonlPath}`)
  console.log(`Wrote summary to ${summaryPath}`)

  // ── Persist to DB ─────────────────────────────────────────────────────────

  if (args.persist) {
    const { persistPhaseEvalRun, currentGitCommit } = await import("../phase-eval/persist-run")
    const runId = await persistPhaseEvalRun({
      probeName: "adherence-events-causal-ordering-v2v3v4-ab",
      gitCommit: currentGitCommit(),
      experimentId: args.expId ?? null,
      seedsUsed: ["synthetic-L18", "labeled-exp299"],
      variantLabels: ["events-system-v2", "events-system-v3-causal-ordering", "events-system-v4-causal-ordering-tighter"],
      summaryJson: summary,
      verdict: sessionVerdict,
      notes: `L25 causal-ordering A/B: reversed-order recall v2=${pct(v2RoRecall)} v3=${pct(v3RoRecall)} v4=${pct(v4RoRecall)} promoted=${promotedVersion ?? "none"} labeled_prec_v3=${pct(lV3Prec)} labeled_prec_v4=${pct(lV4Prec)}`,
    })
    console.log(`[persist] phase_eval_runs.id=${runId}`)
    const db = (await import("../../src/db/connection")).default
    await db.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
