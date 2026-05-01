#!/usr/bin/env bun
/**
 * Invoke halluc-ungrounded and adherence-events on the 10 synthetic
 * candidate-score fixtures from the current-surface panel. Compares
 * actual checker output against the gold expected_pass / issues to
 * produce a synthetic fire-rate calibration matrix.
 *
 * Usage:
 *   bun scripts/hallucination/run-synthetic-checkers.ts \
 *     --in /tmp/halluc-current-panel-exp299-labeled.jsonl \
 *     --out /tmp/halluc-synthetic-results.jsonl
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"
import { callAgent } from "../../src/llm"
import { HALLUC_UNGROUNDED_SYSTEM, hallucUngroundedSchema } from "../../src/agents/halluc-ungrounded"

interface Args {
  inPath: string
  outPath: string
  persist: boolean
  expId?: number
  note?: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let inPath = ""
  let outPath = ""
  let persist = false
  let expId: number | undefined
  let note: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") inPath = argv[++i]
    else if (argv[i] === "--out") outPath = argv[++i]
    else if (argv[i] === "--persist") persist = true
    else if (argv[i] === "--exp-id") expId = Number(argv[++i])
    else if (argv[i] === "--note") note = argv[++i]
  }
  if (!inPath || !outPath) {
    console.error("usage: --in <panel.jsonl> --out <results.jsonl> [--persist [--exp-id N] [--note STR]]")
    process.exit(1)
  }
  return { inPath, outPath, persist, expId, note }
}

const eventsSchema = z.object({
  events_present: z.boolean(),
  evidence: z.string().optional().default(""),
  reasoning: z.string().optional().default(""),
})

const EVENTS_SYSTEM = `You verify whether the prose ENACTS the scene beat on-page.

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

function buildHallucUserPrompt(row: any): string {
  const meta = row.task.writer_request_meta ?? {}
  const gs = row.task.checker_request_meta?.groundedSources ?? {}
  const bible = gs.bible ?? []
  const fromBrief = gs.from_brief ?? []
  const derivedFact = gs.derived_outline_fact ?? []
  const derivedPrior = gs.derived_prior_beat ?? []
  const beatChars = (meta.beatCharacters ?? []) as string[]

  const briefLines = [
    `Summary: ${meta.beatDescription ?? ""}`,
    `Kind: action`,
    `POV: ${beatChars[0] ?? ""}`,
    `Characters: ${beatChars.join(", ")}`,
    `Setting: `,
  ]

  const worldBibleBlock = [
    "WORLD BIBLE (relevant, names only):",
    `  Locations: ${bible.join(", ") || "(none)"}`,
    `  Cultures:  (none)`,
    `  Systems:   (none)`,
    `  From-brief: ${fromBrief.join(", ") || "(none)"}`,
    `  Beat-entities: ${[...derivedFact, ...derivedPrior].join(", ") || "(none)"}`,
  ]

  const speakers = beatChars.map((n: string) => `${n}: `)

  return [
    "BEAT BRIEF:",
    ...briefLines.map(l => `  ${l}`),
    "",
    ...worldBibleBlock,
    "",
    "SPEAKERS:",
    ...(speakers.length > 0 ? speakers.map(s => `  ${s}`) : ["  (none)"]),
    "",
    "PROSE TO CHECK:",
    row.task.prose,
  ].join("\n")
}

function buildAdherenceUserPrompt(row: any): string {
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

async function invokeHalluc(row: any) {
  const userPrompt = buildHallucUserPrompt(row)
  try {
    const result = await callAgent({
      agentName: "halluc-ungrounded" as const,
      systemPrompt: HALLUC_UNGROUNDED_SYSTEM,
      userPrompt,
      schema: hallucUngroundedSchema,
    })
    return { ok: true, output: result.output, error: null }
  } catch (err) {
    return { ok: false, output: null, error: err instanceof Error ? err.message : String(err) }
  }
}

async function invokeAdherence(row: any) {
  const userPrompt = buildAdherenceUserPrompt(row)
  try {
    const result = await callAgent({
      agentName: "adherence-events" as const,
      systemPrompt: EVENTS_SYSTEM,
      userPrompt,
      schema: eventsSchema,
    })
    return { ok: true, output: result.output, error: null }
  } catch (err) {
    return { ok: false, output: null, error: err instanceof Error ? err.message : String(err) }
  }
}

async function main() {
  const args = parseArgs()
  const lines = readFileSync(resolve(args.inPath), "utf8").trim().split("\n")
  const rows = lines.map(l => JSON.parse(l))
  const synthetic = rows.filter(r => r.case_role === "synthetic_fixture")
  console.log(`Processing ${synthetic.length} synthetic fixtures…`)

  const results: any[] = []
  for (const row of synthetic) {
    const isHalluc = row.checker === "halluc-ungrounded"
    const invoked = isHalluc ? await invokeHalluc(row) : await invokeAdherence(row)

    let calibration_status = "ERROR"
    if (invoked.ok && invoked.output) {
      const expectedPass = row.gold.expected_pass
      const actualPass = isHalluc ? invoked.output.pass : invoked.output.events_present
      if (expectedPass === false && actualPass === false) calibration_status = "TP"
      else if (expectedPass === false && actualPass === true) calibration_status = "FN"
      else if (expectedPass === true && actualPass === false) calibration_status = "FP"
      else if (expectedPass === true && actualPass === true) calibration_status = "TN"
    }

    const result = {
      fixture_id: row.fixture_id,
      checker: row.checker,
      expected: { pass: row.gold.expected_pass, issues: row.gold.issues },
      actual: invoked.output,
      calibration_status,
      error: invoked.error,
    }
    results.push(result)
    console.log(`  ${row.fixture_id}: ${calibration_status}`)
  }

  writeFileSync(resolve(args.outPath), results.map(r => JSON.stringify(r)).join("\n") + "\n")
  console.log(`\nWrote ${results.length} results to ${args.outPath}`)

  // Calibration summary
  const sum: Record<string, Record<string, number>> = { "halluc-ungrounded": {}, "adherence-events": {} }
  for (const r of results) {
    sum[r.checker][r.calibration_status] = (sum[r.checker][r.calibration_status] ?? 0) + 1
  }
  console.log("\nSynthetic calibration matrix:")
  for (const [checker, counts] of Object.entries(sum)) {
    console.log(`  ${checker}:`, counts)
  }

  if (args.persist) {
    const { persistPhaseEvalRun, currentGitCommit } = await import("../phase-eval/persist-run")
    const hRecall = (sum["halluc-ungrounded"].TP ?? 0) /
      Math.max(1, (sum["halluc-ungrounded"].TP ?? 0) + (sum["halluc-ungrounded"].FN ?? 0))
    const aRecall = (sum["adherence-events"].TP ?? 0) /
      Math.max(1, (sum["adherence-events"].TP ?? 0) + (sum["adherence-events"].FN ?? 0))
    const summary = {
      panel_path: args.inPath,
      n_synthetic: results.length,
      halluc_calibration: sum["halluc-ungrounded"],
      adherence_calibration: sum["adherence-events"],
      halluc_recall_pct: Math.round(hRecall * 1000) / 10,
      adherence_recall_pct: Math.round(aRecall * 1000) / 10,
      per_row_results: results,
    }
    const verdict = `synthetic-fire-rate halluc=${(hRecall * 100).toFixed(0)}% adherence=${(aRecall * 100).toFixed(0)}%`
    const runId = await persistPhaseEvalRun({
      probeName: "halluc-synthetic-fire-rate",
      gitCommit: currentGitCommit(),
      experimentId: args.expId ?? null,
      seedsUsed: ["fantasy-system-heretic"],
      variantLabels: ["live-checkers"],
      summaryJson: summary,
      verdict,
      notes: args.note ?? null,
    })
    console.log(`[persist] phase_eval_runs.id=${runId} probe=halluc-synthetic-fire-rate verdict=${verdict}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
