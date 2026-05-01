#!/usr/bin/env bun
/**
 * Prototype: obligation-aware adherence-events checker.
 *
 * Runs an experimental per-event prompt against every adherence row in
 * the labeled current-surface panel. Produces a per-event enactment
 * judgment with quote evidence, plus a roll-up `all_enacted` boolean.
 *
 * For each row, compares the prototype's per-event verdict to:
 * - the oracle's `obligated_events` list and `missing_events` list
 *   (per-event ground truth on TP rows; "all enacted" on TN rows)
 * - the live binary checker's `events_present` decision
 *
 * Calibration question: does the per-event variant correctly identify
 * WHICH event is missing on the b12 partial-enactment cluster, while
 * staying clean on the 13 fully-enacted rows?
 *
 * Usage:
 *   bun scripts/hallucination/probe-obligation-aware-adherence.ts \
 *     --in /tmp/halluc-current-panel-exp299-labeled.jsonl \
 *     --out /tmp/adherence-per-event-probe.jsonl
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"
import { callAgent } from "../../src/llm"

interface Args {
  inPath: string
  outPath: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let inPath = "", outPath = ""
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") inPath = argv[++i]
    else if (argv[i] === "--out") outPath = argv[++i]
  }
  if (!inPath || !outPath) {
    console.error("usage: --in <panel.jsonl> --out <results.jsonl>")
    process.exit(1)
  }
  return { inPath, outPath }
}

const perEventSchema = z.object({
  obligated_events: z.array(z.object({
    event: z.string(),
    enacted: z.boolean(),
    evidence_quote: z.string().optional().default(""),
  })),
  all_enacted: z.boolean(),
  missed_count: z.number().optional().default(0),
  reasoning: z.string().optional().default(""),
})

const PER_EVENT_SYSTEM = `You verify whether the prose ENACTS each obligated event in a beat description.

Step 1: Read the beat description and identify EVERY discrete event it specifies — there are usually 1 to 4 distinct events per beat. An event is a single action, decision, discovery, or state-change-on-page. Compound clauses joined by "and" / ";" / commas usually contain multiple events.

Step 2: For EACH identified event, scan the prose for an on-page enactment.
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- The action must be performed by the character the beat assigns it to. If the beat says A asks B, but the prose has B volunteer without A asking, the "ask" event is NOT enacted.
- Paraphrase, dialogue rewording, and atmospheric expansion are fine — judge by the underlying action, not the wording.

Step 3: For each event, return enacted: true | false and a short quote from the prose as evidence. If enacted is false, evidence_quote should still cite the closest passage so the reviewer can see what the prose did instead.

Step 4: Set all_enacted = true ONLY IF every event has enacted=true. Set missed_count = number of events with enacted=false.

Respond with ONLY valid JSON in this exact shape:
{
  "obligated_events": [
    { "event": "<short paraphrase of the event>", "enacted": true | false, "evidence_quote": "<short prose quote, ~10-30 words>" }
  ],
  "all_enacted": true | false,
  "missed_count": <integer>,
  "reasoning": "<one sentence summarizing the verdict>"
}`

function buildPerEventUserPrompt(row: any): string {
  const meta = row.task.writer_request_meta ?? {}
  const beatDescription = meta.beatDescription ?? ""
  const charsLine = (meta.beatCharacters ?? []).join(", ")
  const proseTrimmed = (row.task.prose ?? "").slice(0, 2000)
  return `BEAT: ${beatDescription}
CHARACTERS EXPECTED: ${charsLine}

PROSE:
---
${proseTrimmed}
---`
}

interface CalibrationRow {
  fixture_id: string
  case_role: string
  oracle_label: string | null
  oracle_obligated: string[]
  oracle_missing: string[]
  prototype_events: Array<{ event: string; enacted: boolean; evidence_quote: string }>
  prototype_all_enacted: boolean | null
  prototype_missed_count: number | null
  live_events_present: boolean | null
  binary_match: boolean
  per_event_recall_on_missing: number | null  // 0..1 of oracle missing events caught by prototype
  per_event_precision: number | null          // 0..1 of prototype-flagged events that match oracle missing
  notes: string
}

function eventTextOverlap(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z]+/g) ?? [])
  const A = tokens(a), B = tokens(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / Math.min(A.size, B.size)
}

function matchEvents(oracleEvent: string, prototypeEvents: { event: string; enacted: boolean }[]): boolean {
  for (const p of prototypeEvents) {
    if (eventTextOverlap(oracleEvent, p.event) >= 0.4 && !p.enacted) return true
  }
  return false
}

async function main() {
  const args = parseArgs()
  const lines = readFileSync(resolve(args.inPath), "utf8").trim().split("\n")
  const rows = lines.map(l => JSON.parse(l)).filter(r =>
    r.checker === "adherence-events" && r.case_role === "current_surface_natural"
  )
  console.log(`Probing per-event prototype on ${rows.length} adherence natural rows…`)

  const results: CalibrationRow[] = []
  for (const row of rows) {
    const userPrompt = buildPerEventUserPrompt(row)
    let invoked: any = null
    try {
      const result = await callAgent({
        agentName: "adherence-events" as const,
        systemPrompt: PER_EVENT_SYSTEM,
        userPrompt,
        schema: perEventSchema,
        temperature: 0.1,
        maxTokens: 1024,
      })
      invoked = result.output
    } catch (err) {
      invoked = null
    }

    const gold = row.gold ?? {}
    const oracleObligated: string[] = (gold.obligated_events ?? [])
    const oracleMissing: string[] = (gold.missing_events ?? []).map((m: any) =>
      typeof m === "string" ? m : (m.event ?? m.text ?? "")
    ).filter(Boolean)
    const liveEventsPresent = (row.actual?.output?.events_present) ?? null

    const protoEvents = invoked?.obligated_events ?? []
    const protoAll = invoked?.all_enacted ?? null
    const oracleAllEnacted = oracleMissing.length === 0
    const binaryMatch = protoAll === oracleAllEnacted

    let perEventRecall: number | null = null
    let perEventPrecision: number | null = null
    if (oracleMissing.length > 0 && protoEvents.length > 0) {
      let caughtMissing = 0
      for (const om of oracleMissing) {
        if (matchEvents(om, protoEvents)) caughtMissing++
      }
      perEventRecall = caughtMissing / oracleMissing.length
    }
    if (protoEvents.length > 0) {
      const protoUnenacted = protoEvents.filter((p: any) => !p.enacted)
      if (protoUnenacted.length > 0) {
        let validMisses = 0
        for (const pe of protoUnenacted) {
          for (const om of oracleMissing) {
            if (eventTextOverlap(pe.event, om) >= 0.4) { validMisses++; break }
          }
        }
        perEventPrecision = validMisses / protoUnenacted.length
      }
    }

    const cr: CalibrationRow = {
      fixture_id: row.fixture_id,
      case_role: row.case_role,
      oracle_label: gold.oracle_label ?? null,
      oracle_obligated: oracleObligated,
      oracle_missing: oracleMissing,
      prototype_events: protoEvents,
      prototype_all_enacted: protoAll,
      prototype_missed_count: invoked?.missed_count ?? null,
      live_events_present: liveEventsPresent,
      binary_match: binaryMatch,
      per_event_recall_on_missing: perEventRecall,
      per_event_precision: perEventPrecision,
      notes: invoked?.reasoning ?? "",
    }
    results.push(cr)
    const tag = binaryMatch ? "✓" : "✗"
    const peTag = perEventRecall !== null ? ` per-event-recall=${(perEventRecall * 100).toFixed(0)}%` : ""
    console.log(`  ${row.fixture_id}: ${tag} all_enacted=${protoAll} (oracle ${oracleAllEnacted ? "fully" : "partially"}-enacted)${peTag}`)
  }

  writeFileSync(resolve(args.outPath), results.map(r => JSON.stringify(r)).join("\n") + "\n")

  // Aggregate
  const binaryMatches = results.filter(r => r.binary_match).length
  const tp = results.filter(r => r.prototype_all_enacted === false && r.oracle_missing.length > 0).length
  const fp = results.filter(r => r.prototype_all_enacted === false && r.oracle_missing.length === 0).length
  const fn = results.filter(r => r.prototype_all_enacted === true && r.oracle_missing.length > 0).length
  const tn = results.filter(r => r.prototype_all_enacted === true && r.oracle_missing.length === 0).length
  console.log(`\nBinary calibration: TP=${tp} FP=${fp} FN=${fn} TN=${tn} (binary match ${binaryMatches}/${results.length})`)

  const peRecalls = results.map(r => r.per_event_recall_on_missing).filter((v): v is number => v !== null)
  const pePrecisions = results.map(r => r.per_event_precision).filter((v): v is number => v !== null)
  if (peRecalls.length > 0) {
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
    console.log(`Per-event recall on missing events (TP rows, n=${peRecalls.length}): mean ${(avg(peRecalls) * 100).toFixed(1)}%`)
    console.log(`Per-event precision on prototype-flagged events (n=${pePrecisions.length}): mean ${(avg(pePrecisions) * 100).toFixed(1)}%`)
  }

  console.log(`\nWrote ${results.length} rows to ${args.outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
