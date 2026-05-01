#!/usr/bin/env bun
/**
 * A/B test a candidate halluc-ungrounded system prompt against the
 * labeled current-surface panel. Re-invokes halluc-ungrounded on every
 * natural + synthetic row using the candidate prompt and compares
 * pass/issues to the gold labels (oracle for natural; expected_pass for
 * synthetic). Prints a per-row delta and a calibration-matrix summary
 * vs the v1 baseline.
 *
 * Usage:
 *   bun scripts/hallucination/ab-halluc-prompt.ts \
 *     --in /tmp/halluc-current-panel-exp299-labeled.jsonl \
 *     --candidate /tmp/halluc-ungrounded-system.v2-candidate.md \
 *     --out /tmp/halluc-ab-results.jsonl
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"
import { callAgent } from "../../src/llm"
import { hallucUngroundedSchema } from "../../src/agents/halluc-ungrounded"

interface Args {
  inPath: string
  candidatePath: string
  outPath: string
  temperature?: number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let inPath = "", candidatePath = "", outPath = ""
  let temperature: number | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") inPath = argv[++i]
    else if (argv[i] === "--candidate") candidatePath = argv[++i]
    else if (argv[i] === "--out") outPath = argv[++i]
    else if (argv[i] === "--temperature") temperature = Number(argv[++i])
  }
  if (!inPath || !candidatePath || !outPath) {
    console.error("usage: --in <panel.jsonl> --candidate <prompt.md> --out <results.jsonl> [--temperature N]")
    process.exit(1)
  }
  return { inPath, candidatePath, outPath, temperature }
}

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

interface OracleLabel {
  pass: boolean | null
  source: "oracle" | "synthetic_expected"
  expected_entities: string[]
}

function getOracleLabel(row: any): OracleLabel {
  if (row.case_role === "synthetic_fixture") {
    return {
      pass: row.gold.expected_pass,
      source: "synthetic_expected",
      expected_entities: (row.gold.issues ?? []).map((i: any) => i.entity ?? i.expected_event ?? "").filter(Boolean),
    }
  }
  // Natural row — derive from the labeled gold structure
  const goldStatus = row.gold?.calibration_status
  // For halluc, oracle_pass = TN/MIXED-with-fp (oracle thought clean) vs FN/TP (oracle thought hallucination present)
  if (goldStatus === "TN") return { pass: true, source: "oracle", expected_entities: [] }
  if (goldStatus === "FN") {
    const missed = (row.gold.missed_entities ?? []).map((m: any) => m.entity).filter(Boolean)
    return { pass: false, source: "oracle", expected_entities: missed }
  }
  if (goldStatus === "TP") return { pass: false, source: "oracle", expected_entities: [] }  // checker correctly fired; entities in issue_judgments
  if (goldStatus === "MIXED") {
    // The MIXED row had Cassel (FP) + Silver Coast (TP). Oracle says Silver Coast IS a hallucination → expected_pass: false
    const trueHallucs = (row.gold.issue_judgments ?? [])
      .filter((j: any) => j.rubric_label === "true_hallucination")
      .map((j: any) => j.entity_from_checker)
    return { pass: trueHallucs.length === 0, source: "oracle", expected_entities: trueHallucs }
  }
  return { pass: null, source: "oracle", expected_entities: [] }
}

async function main() {
  const args = parseArgs()
  const candidatePrompt = readFileSync(resolve(args.candidatePath), "utf8")
  const lines = readFileSync(resolve(args.inPath), "utf8").trim().split("\n")
  const rows = lines.map(l => JSON.parse(l)).filter(r => r.checker === "halluc-ungrounded")
  const tempLabel = args.temperature !== undefined ? ` at temp=${args.temperature}` : ""
  console.log(`Testing candidate prompt on ${rows.length} halluc rows${tempLabel}…`)

  const results: any[] = []
  for (const row of rows) {
    const userPrompt = buildHallucUserPrompt(row)
    let invoked: any
    try {
      const result = await callAgent({
        agentName: "halluc-ungrounded" as const,
        systemPrompt: candidatePrompt,
        userPrompt,
        schema: hallucUngroundedSchema,
        ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      })
      invoked = result.output
    } catch (err) {
      invoked = null
    }

    const oracle = getOracleLabel(row)
    const candidatePass = invoked?.pass ?? null
    const candidateEntities = (invoked?.issues ?? []).map((i: any) => i.entity)

    let calibration_status = "ERROR"
    if (candidatePass !== null && oracle.pass !== null) {
      if (oracle.pass === true && candidatePass === true) calibration_status = "TN"
      else if (oracle.pass === true && candidatePass === false) calibration_status = "FP"
      else if (oracle.pass === false && candidatePass === false) calibration_status = "TP"
      else if (oracle.pass === false && candidatePass === true) calibration_status = "FN"
    }

    const result = {
      fixture_id: row.fixture_id,
      case_role: row.case_role,
      oracle_pass: oracle.pass,
      oracle_expected_entities: oracle.expected_entities,
      candidate_pass: candidatePass,
      candidate_entities: candidateEntities,
      calibration_status,
    }
    results.push(result)
    const exp = oracle.expected_entities.length > 0 ? ` exp=[${oracle.expected_entities.join(", ")}]` : ""
    const got = candidateEntities.length > 0 ? ` got=[${candidateEntities.join(", ")}]` : ""
    console.log(`  ${row.fixture_id}: ${calibration_status}${exp}${got}`)
  }

  writeFileSync(resolve(args.outPath), results.map(r => JSON.stringify(r)).join("\n") + "\n")

  // Matrix summary by case_role
  console.log("\nCalibration matrix (candidate prompt):")
  for (const caseRole of ["current_surface_natural", "synthetic_fixture"]) {
    const sub = results.filter(r => r.case_role === caseRole)
    const counts: Record<string, number> = {}
    for (const r of sub) counts[r.calibration_status] = (counts[r.calibration_status] ?? 0) + 1
    console.log(`  ${caseRole} (n=${sub.length}):`, counts)
  }
  // Combined
  const all = results
  const counts: Record<string, number> = {}
  for (const r of all) counts[r.calibration_status] = (counts[r.calibration_status] ?? 0) + 1
  console.log(`  COMBINED (n=${all.length}):`, counts)
  const tp = counts.TP ?? 0, fp = counts.FP ?? 0, fn = counts.FN ?? 0, tn = counts.TN ?? 0
  const recall = tp + fn > 0 ? (tp / (tp + fn) * 100).toFixed(1) : "n/a"
  const precision = tp + fp > 0 ? (tp / (tp + fp) * 100).toFixed(1) : "n/a"
  console.log(`  Recall: ${recall}%   Precision: ${precision}%`)

  console.log(`\nWrote ${results.length} rows to ${args.outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
