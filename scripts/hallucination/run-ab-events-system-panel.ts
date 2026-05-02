#!/usr/bin/env bun
/**
 * A/B test: EVENTS_SYSTEM v1 vs v2 — ambient/mechanical action equality (L21)
 *
 * Runs BOTH v1 (current live) and v2 (proposed) EVENTS_SYSTEM prompts against:
 *   (a) L18 partial-enactment panel (shapes: two-of-three, reversed-order,
 *       substituted-actor, acceptable-embellishment)
 *   (b) Labeled panel (adherence-events / current_surface_natural rows)
 *
 * Computes per-shape recall/precision/F1 for each prompt version and outputs
 * a side-by-side comparison.
 *
 * Acceptance:
 *   v2 lifts two-of-three recall ≥67% AND keeps labeled-panel precision=100%
 *   AND keeps embellishment-control TN=100%
 *
 * Usage:
 *   ORCHESTRATOR_DB_URL=... bun scripts/hallucination/run-ab-events-system-panel.ts \
 *     [--partial-enact scripts/hallucination/synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl] \
 *     [--labeled /tmp/halluc-current-panel-exp299-labeled.jsonl] \
 *     [--persist] [--exp-id N]
 *
 * Outputs (timestamped, never overwritten):
 *   /tmp/ab-events-system-<YYYYMMDDTHHMMSS>.jsonl
 *   /tmp/ab-events-system-<YYYYMMDDTHHMMSS>.summary.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { callAgent } from "../../src/llm"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../src/types"
import { z } from "zod"

// ── Arg parsing ──────────────────────────────────────────────────────────────

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

// ── Timestamp ────────────────────────────────────────────────────────────────

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

// ── Prompt versions ──────────────────────────────────────────────────────────

const EVENTS_SYSTEM_V1 = `You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- Each action must be performed by the character the beat assigns it to. If the beat says Character A does something but the prose has Character B do it, the action is NOT correctly enacted.
- If ANY key action from the beat is missing, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

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

const EVENTS_SYSTEM_V3 = `You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — whether dramatic, mechanical, or ambient — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens explicitly IN SCENE during this prose — characters visibly performing the action, dialogue, or direct narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- An action is NOT enacted if it is: referenced off-page, implied by another character's response, summarized as backstory, or inferred from context. It must be shown happening.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- Each action must be performed by the character the beat assigns it to. If the beat says Character A does something but the prose has Character B do it, the action is NOT correctly enacted.
- Treat every listed action as equally obligated regardless of dramatic weight. Mechanical or ambient actions (lighting candles, opening doors, picking up objects, asking sub-questions) are as obligated as dramatic actions if the beat specifies them. Do not distinguish between major and minor events — if the beat names it, it must appear.
- If ANY action from the beat is missing, set events_present=false. Your reasoning field must be consistent with your verdict: if your reasoning identifies a missing event, events_present must be false.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

const EVENTS_SYSTEM_V4 = `You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — whether dramatic, mechanical, or ambient — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens explicitly IN SCENE during this prose — characters visibly performing the action, dialogue, or direct narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- An action is NOT enacted if it is: referenced off-page, implied by another character's response, summarized as backstory, or inferred from context. It must be shown happening.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- Each action must be performed by the character the beat assigns it to. If the beat says Character A does something but the prose has Character B do it, the action is NOT correctly enacted.
- Treat every listed action as equally obligated regardless of dramatic weight. Mechanical or ambient actions (lighting candles, opening doors, picking up objects, asking sub-questions) are as obligated as dramatic actions if the beat specifies them.

Your response MUST follow this exact format — reasoning comes first so you commit to your finding before stating the verdict:
1. Write the reasoning field first, identifying any missing events.
2. Then set events_present=false if your reasoning identifies ANY missing event, true only if ALL events are enacted.

Respond with ONLY valid JSON in this exact shape:
{
  "reasoning": "<one sentence identifying the specific event(s) missing, or confirming all events are present>",
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "events_present": true | false
}`

// ── Schema ──────────────────────────────────────────────────────────────────

const eventsSchema = z.object({
  events_present: z.boolean(),
  evidence: z.string().optional().default(""),
  reasoning: z.string().optional().default(""),
})

// ── Panel row types ──────────────────────────────────────────────────────────

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

// ── Stub builders ────────────────────────────────────────────────────────────

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

function makeOutlineFromPartialEnact(row: PartialEnactRow): ChapterOutline {
  const pov = row.task.writer_request_meta.beatCharacters[0] ?? "POV"
  return {
    chapterNumber: 1,
    title: "A/B Panel",
    summary: "",
    beats: [],
    povCharacter: pov,
    themes: [],
    openingHook: "",
    closingMoment: "",
    setting: "Archive",
    purpose: "panel",
    scenes: [],
    targetWords: 500,
    charactersPresent: [],
    charactersPresentIds: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  } as unknown as ChapterOutline
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

function makeOutlineFromLabeled(row: LabeledRow): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "The Scribe's Anomaly",
    summary: "",
    beats: [],
    povCharacter: "Maret",
    themes: [],
    openingHook: "",
    closingMoment: "",
  }
}

// ── Single LLM call for one prompt version ───────────────────────────────────

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

// ── Per-row result ───────────────────────────────────────────────────────────

interface ABRowResult {
  fixture_id: string
  panel: "partial-enact" | "labeled"
  fixture_shape: string
  oracle_pass: boolean
  v1_pass: boolean
  v2_pass: boolean
  v3_pass: boolean
  v1_reasoning: string
  v2_reasoning: string
  v3_reasoning: string
  v1_disposition: "TP" | "FP" | "FN" | "TN"
  v2_disposition: "TP" | "FP" | "FN" | "TN"
  v3_disposition: "TP" | "FP" | "FN" | "TN"
  v1_correct: boolean
  v2_correct: boolean
  v3_correct: boolean
}

function classify(checkerPass: boolean, oraclePass: boolean): "TP" | "FP" | "FN" | "TN" {
  if (!checkerPass && !oraclePass) return "TP"
  if (!checkerPass && oraclePass) return "FP"
  if (checkerPass && !oraclePass) return "FN"
  return "TN"
}

// ── Per-shape metrics ────────────────────────────────────────────────────────

interface ShapeMetrics {
  shape: string
  n_fail: number
  n_pass: number
  v1: { tp: number; fp: number; fn: number; tn: number; recall: number | null; precision: number | null; f1: number | null }
  v2: { tp: number; fp: number; fn: number; tn: number; recall: number | null; precision: number | null; f1: number | null }
  v3: { tp: number; fp: number; fn: number; tn: number; recall: number | null; precision: number | null; f1: number | null }
}

function computeShapeMetrics(rows: ABRowResult[]): ShapeMetrics[] {
  const shapes = [...new Set(rows.map(r => r.fixture_shape))]
  return shapes.map(shape => {
    const sr = rows.filter(r => r.fixture_shape === shape)
    const nFail = sr.filter(r => !r.oracle_pass).length
    const nPass = sr.filter(r => r.oracle_pass).length

    function metrics(version: "v1" | "v2" | "v3") {
      const vDisp = version === "v1" ? "v1_disposition" : version === "v2" ? "v2_disposition" : "v3_disposition"
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
    return { shape, n_fail: nFail, n_pass: nPass, v1: metrics("v1"), v2: metrics("v2"), v3: metrics("v3") }
  })
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  const ts = timestamp()
  const results: ABRowResult[] = []

  // ── (a) Partial-enactment panel ──────────────────────────────────────────

  console.log("=== L21 A/B: EVENTS_SYSTEM v1 vs v2 vs v3 ===")
  console.log()
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

    let v1: { events_present: boolean; reasoning: string; evidence: string }
    let v2: { events_present: boolean; reasoning: string; evidence: string }
    let v3: { events_present: boolean; reasoning: string; evidence: string }

    try {
      v1 = await runEventsCheck(row.task.prose, beat, EVENTS_SYSTEM_V1)
    } catch (err) {
      console.error(`  v1 CHECKER ERROR on ${row.fixture_id}: ${err}`)
      v1 = { events_present: false, reasoning: `ERROR: ${err}`, evidence: "" }
    }
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

    const v1Disp = classify(v1.events_present, oraclePass)
    const v2Disp = classify(v2.events_present, oraclePass)
    const v3Disp = classify(v3.events_present, oraclePass)
    const v1Correct = v1.events_present === oraclePass
    const v2Correct = v2.events_present === oraclePass
    const v3Correct = v3.events_present === oraclePass

    const row_result: ABRowResult = {
      fixture_id: row.fixture_id,
      panel: "partial-enact",
      fixture_shape: row.fixture_shape,
      oracle_pass: oraclePass,
      v1_pass: v1.events_present,
      v2_pass: v2.events_present,
      v3_pass: v3.events_present,
      v1_reasoning: v1.reasoning,
      v2_reasoning: v2.reasoning,
      v3_reasoning: v3.reasoning,
      v1_disposition: v1Disp,
      v2_disposition: v2Disp,
      v3_disposition: v3Disp,
      v1_correct: v1Correct,
      v2_correct: v2Correct,
      v3_correct: v3Correct,
    }
    results.push(row_result)

    const v1tag = v1Correct ? "✓" : "✗"
    const v2tag = v2Correct ? "✓" : "✗"
    const v3tag = v3Correct ? "✓" : "✗"
    const changedV2 = v1Disp !== v2Disp ? " v2-CHANGED" : ""
    const changedV3 = v1Disp !== v3Disp ? " v3-CHANGED" : ""
    console.log(
      `  [${peIdx}/${peRows.length}] [${row.fixture_shape}] ${row.fixture_id}` +
      `\n    v1: ${v1tag} ${v1Disp}  v2: ${v2tag} ${v2Disp}${changedV2}  v3: ${v3tag} ${v3Disp}${changedV3}`
    )
    if (v1Disp !== v2Disp || v1Disp !== v3Disp) {
      if (v1Disp !== v2Disp) console.log(`    v2 reasoning: ${v2.reasoning}`)
      if (v1Disp !== v3Disp) console.log(`    v3 reasoning: ${v3.reasoning}`)
    }
  }

  // ── (b) Labeled panel ────────────────────────────────────────────────────

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

      let v1: { events_present: boolean; reasoning: string; evidence: string }
      let v2: { events_present: boolean; reasoning: string; evidence: string }
      let v3: { events_present: boolean; reasoning: string; evidence: string }

      try {
        v1 = await runEventsCheck(row.task.prose, beat, EVENTS_SYSTEM_V1)
      } catch (err) {
        console.error(`  v1 CHECKER ERROR on ${row.fixture_id}: ${err}`)
        v1 = { events_present: false, reasoning: `ERROR: ${err}`, evidence: "" }
      }
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

      const v1Disp = classify(v1.events_present, oraclePass)
      const v2Disp = classify(v2.events_present, oraclePass)
      const v3Disp = classify(v3.events_present, oraclePass)
      const v1Correct = v1.events_present === oraclePass
      const v2Correct = v2.events_present === oraclePass
      const v3Correct = v3.events_present === oraclePass

      const row_result: ABRowResult = {
        fixture_id: row.fixture_id,
        panel: "labeled",
        fixture_shape: "labeled-panel",
        oracle_pass: oraclePass,
        v1_pass: v1.events_present,
        v2_pass: v2.events_present,
        v3_pass: v3.events_present,
        v1_reasoning: v1.reasoning,
        v2_reasoning: v2.reasoning,
        v3_reasoning: v3.reasoning,
        v1_disposition: v1Disp,
        v2_disposition: v2Disp,
        v3_disposition: v3Disp,
        v1_correct: v1Correct,
        v2_correct: v2Correct,
        v3_correct: v3Correct,
      }
      results.push(row_result)

      const v1tag = v1Correct ? "✓" : "✗"
      const v2tag = v2Correct ? "✓" : "✗"
      const v3tag = v3Correct ? "✓" : "✗"
      const changedV2 = v1Disp !== v2Disp ? " v2-CHANGED" : ""
      const changedV3 = v1Disp !== v3Disp ? " v3-CHANGED" : ""
      console.log(
        `  [${lIdx}/${lRows.length}] [labeled] ${row.fixture_id}` +
        `\n    v1: ${v1tag} ${v1Disp}  v2: ${v2tag} ${v2Disp}${changedV2}  v3: ${v3tag} ${v3Disp}${changedV3}`
      )
      if (v1Disp !== v2Disp) {
        console.log(`    v2 reasoning: ${v2.reasoning}`)
      }
      if (v1Disp !== v3Disp) {
        console.log(`    v3 reasoning: ${v3.reasoning}`)
      }
    }
  }

  // ── Aggregates ────────────────────────────────────────────────────────────

  console.log()
  console.log("=== Per-shape A/B matrix (partial-enact panel) ===")

  const peResults = results.filter(r => r.panel === "partial-enact")
  const peShapeMetrics = computeShapeMetrics(peResults)
  const pct = (v: number | null) => v === null ? "N/A" : `${(v * 100).toFixed(0)}%`

  console.log(
    "  Shape".padEnd(30) + "N_fail".padEnd(8) +
    "v1_TP".padEnd(7) + "v1_FN".padEnd(7) + "v1_Rec".padEnd(9) +
    "v2_TP".padEnd(7) + "v2_FN".padEnd(7) + "v2_Rec".padEnd(9) +
    "v3_TP".padEnd(7) + "v3_FN".padEnd(7) + "v3_Rec"
  )
  for (const m of peShapeMetrics) {
    console.log(
      `  ${m.shape}`.padEnd(30) + String(m.n_fail).padEnd(8) +
      String(m.v1.tp).padEnd(7) + String(m.v1.fn).padEnd(7) + pct(m.v1.recall).padEnd(9) +
      String(m.v2.tp).padEnd(7) + String(m.v2.fn).padEnd(7) + pct(m.v2.recall).padEnd(9) +
      String(m.v3.tp).padEnd(7) + String(m.v3.fn).padEnd(7) + pct(m.v3.recall)
    )
  }

  // Labeled panel summary
  const lResults = results.filter(r => r.panel === "labeled")
  if (lResults.length > 0) {
    console.log()
    console.log("=== Labeled panel binary matrix ===")
    for (const version of ["v1", "v2", "v3"] as const) {
      const vDisp = `${version}_disposition` as "v1_disposition" | "v2_disposition" | "v3_disposition"
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
    for (const version of ["v1", "v2", "v3"] as const) {
      const vDisp = `${version}_disposition` as "v1_disposition" | "v2_disposition" | "v3_disposition"
      const tn = embRows.filter(r => r[vDisp] === "TN").length
      const fp = embRows.filter(r => r[vDisp] === "FP").length
      console.log(`  ${version}: TN=${tn}/${embRows.length}  FP=${fp}`)
    }
  }

  // ── Acceptance verdict for v3 (the candidate for promotion) ──────────────

  const twoOfThreeMetrics = peShapeMetrics.find(m => m.shape === "two-of-three")
  const v1TwoOfThreeRecall = twoOfThreeMetrics?.v1.recall ?? null
  const v2TwoOfThreeRecall = twoOfThreeMetrics?.v2.recall ?? null
  const v3TwoOfThreeRecall = twoOfThreeMetrics?.v3.recall ?? null

  const lV3Fp = lResults.filter(r => r.v3_disposition === "FP").length
  const lV3Prec = (() => {
    const tp = lResults.filter(r => r.v3_disposition === "TP").length
    const fp = lV3Fp
    return tp + fp === 0 ? null : tp / (tp + fp)
  })()
  const lV3Fn = lResults.filter(r => r.v3_disposition === "FN").length

  const embV3Tn = embRows.length > 0
    ? embRows.filter(r => r.v3_disposition === "TN").length === embRows.length
    : true

  const twoOfThreeLifted = v3TwoOfThreeRecall !== null && v3TwoOfThreeRecall >= 0.67 - 0.001
  const labeledPrecOk = lV3Prec === null || lV3Prec >= 0.999
  const labeledRecOk = lV3Fn === 0  // no new FNs vs labeled panel
  const embTnOk = embV3Tn

  const acceptanceVerdict =
    twoOfThreeLifted && labeledPrecOk && labeledRecOk && embTnOk
      ? "PASS — v3 PROMOTED"
      : !twoOfThreeLifted
        ? `FAIL — two-of-three recall ${pct(v3TwoOfThreeRecall)} < 67% threshold`
        : !labeledPrecOk
          ? `FAIL — labeled panel precision regression: ${pct(lV3Prec)}`
          : !labeledRecOk
            ? `FAIL — labeled panel recall regression: ${lV3Fn} new FN(s) introduced`
            : "FAIL — embellishment TN regression"

  console.log()
  console.log(`=== Acceptance verdict (v3 candidate): ${acceptanceVerdict} ===`)
  console.log(`  two-of-three recall: v1=${pct(v1TwoOfThreeRecall)} → v3=${pct(v3TwoOfThreeRecall)}`)
  console.log(`  labeled-panel precision: v3=${pct(lV3Prec)}`)
  console.log(`  labeled-panel recall: v3 new FNs=${lV3Fn}`)
  console.log(`  embellishment TN: v3=${embV3Tn ? "100%" : "REGRESSED"}`)

  // ── Write output ─────────────────────────────────────────────────────────

  const outBase = `/tmp/ab-events-system-${ts}`
  const jsonlPath = `${outBase}.jsonl`
  const summaryPath = `${outBase}.summary.json`

  writeFileSync(jsonlPath, results.map(r => JSON.stringify(r)).join("\n") + "\n")

  const lV2Fp = lResults.filter(r => r.v2_disposition === "FP").length
  const lV2Prec = (() => {
    const tp = lResults.filter(r => r.v2_disposition === "TP").length
    const fp = lV2Fp
    return tp + fp === 0 ? null : tp / (tp + fp)
  })()

  const summary = {
    timestamp: ts,
    partial_enact_path: args.partialEnactPath,
    labeled_path: args.labeledPath,
    acceptance_verdict: acceptanceVerdict,
    two_of_three: {
      v1_recall_pct: v1TwoOfThreeRecall === null ? null : Math.round(v1TwoOfThreeRecall * 1000) / 10,
      v2_recall_pct: v2TwoOfThreeRecall === null ? null : Math.round(v2TwoOfThreeRecall * 1000) / 10,
      v3_recall_pct: v3TwoOfThreeRecall === null ? null : Math.round(v3TwoOfThreeRecall * 1000) / 10,
    },
    labeled_panel: {
      n_rows: lResults.length,
      v2_fp: lV2Fp,
      v2_precision_pct: lV2Prec === null ? null : Math.round(lV2Prec * 1000) / 10,
      v3_fp: lV3Fp,
      v3_fn: lV3Fn,
      v3_precision_pct: lV3Prec === null ? null : Math.round(lV3Prec * 1000) / 10,
    },
    embellishment_control: {
      n_rows: embRows.length,
      v2_tn_count: embRows.filter(r => r.v2_disposition === "TN").length,
      v3_tn_count: embRows.filter(r => r.v3_disposition === "TN").length,
    },
    per_shape: peShapeMetrics.map(m => ({
      shape: m.shape,
      n_fail: m.n_fail,
      n_pass: m.n_pass,
      v1: {
        tp: m.v1.tp, fp: m.v1.fp, fn: m.v1.fn, tn: m.v1.tn,
        recall_pct: m.v1.recall === null ? null : Math.round(m.v1.recall * 1000) / 10,
        precision_pct: m.v1.precision === null ? null : Math.round(m.v1.precision * 1000) / 10,
        f1_pct: m.v1.f1 === null ? null : Math.round(m.v1.f1 * 1000) / 10,
      },
      v2: {
        tp: m.v2.tp, fp: m.v2.fp, fn: m.v2.fn, tn: m.v2.tn,
        recall_pct: m.v2.recall === null ? null : Math.round(m.v2.recall * 1000) / 10,
        precision_pct: m.v2.precision === null ? null : Math.round(m.v2.precision * 1000) / 10,
        f1_pct: m.v2.f1 === null ? null : Math.round(m.v2.f1 * 1000) / 10,
      },
      v3: {
        tp: m.v3.tp, fp: m.v3.fp, fn: m.v3.fn, tn: m.v3.tn,
        recall_pct: m.v3.recall === null ? null : Math.round(m.v3.recall * 1000) / 10,
        precision_pct: m.v3.precision === null ? null : Math.round(m.v3.precision * 1000) / 10,
        f1_pct: m.v3.f1 === null ? null : Math.round(m.v3.f1 * 1000) / 10,
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
      probeName: "adherence-events-system-v1v2v3-ab",
      gitCommit: currentGitCommit(),
      experimentId: args.expId ?? null,
      seedsUsed: ["synthetic-L18", "labeled-exp299"],
      variantLabels: ["events-system-v1", "events-system-v2", "events-system-v3"],
      summaryJson: summary,
      verdict: acceptanceVerdict,
      notes: `L21 A/B: two-of-three recall v1=${pct(v1TwoOfThreeRecall)} v2=${pct(v2TwoOfThreeRecall)} v3=${pct(v3TwoOfThreeRecall)} labeled_prec_v3=${pct(lV3Prec)} labeled_fn_v3=${lV3Fn} emb_tn_v3=${embV3Tn ? "ok" : "REGRESSED"}`,
    })
    console.log(`[persist] phase_eval_runs.id=${runId}`)
    const db = (await import("../../src/db/connection")).default
    await db.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
