#!/usr/bin/env bun
/**
 * Build an unlabeled current-surface checker panel from recent beat attempts.
 *
 * The output is JSONL. Natural rows are unlabeled until adjudicated. Synthetic
 * rows are controlled single-fault candidates and should still be reviewed
 * before they become score-bearing.
 *
 * Usage:
 *   bun scripts/hallucination/current-surface-manifest.ts --out /tmp/current-surface.json
 *   bun scripts/hallucination/build-current-surface-panel.ts \
 *     --run-id 567 \
 *     --surface /tmp/current-surface.json \
 *     --out /tmp/halluc-current-panel.jsonl \
 *     --limit 40 \
 *     --synthetic-per-kind 10
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import db from "../../src/db/connection"

type Agent = "beat-writer" | "halluc-ungrounded" | "adherence-events"

interface Args {
  runIds: number[]
  novelIds: string[]
  surfacePath?: string
  out: string
  limit: number
  syntheticPerKind: number
}

interface LlmRow {
  id: number
  run_id: number | null
  novel_id: string
  chapter: number | null
  beat_index: number | null
  attempt: number | null
  agent: Agent
  response_content: string | null
  request_json: any
  failed: boolean | null
  error_text: string | null
}

interface BeatAttempt {
  key: string
  runId: number | null
  novelId: string
  chapter: number
  beatIndex: number
  attempt: number
  writer?: LlmRow
  halluc?: LlmRow
  adherence?: LlmRow
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const runIds: number[] = []
  const novelIds: string[] = []
  let surfacePath: string | undefined
  let out = ""
  let limit = 50
  let syntheticPerKind = 0

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--run-id") {
      runIds.push(...argv[++i].split(",").map(v => Number(v)).filter(Number.isFinite))
    } else if (arg === "--novel-id") {
      novelIds.push(...argv[++i].split(",").filter(Boolean))
    } else if (arg === "--surface") {
      surfacePath = argv[++i]
    } else if (arg === "--out") {
      out = argv[++i]
    } else if (arg === "--limit") {
      limit = Number(argv[++i])
    } else if (arg === "--synthetic-per-kind") {
      syntheticPerKind = Number(argv[++i])
    }
  }

  if (!out || (runIds.length === 0 && novelIds.length === 0)) {
    console.error("usage: --out <path> (--run-id <ids> | --novel-id <ids>) [--surface <manifest.json>] [--limit N] [--synthetic-per-kind N]")
    process.exit(1)
  }
  return { runIds, novelIds, surfacePath, out, limit, syntheticPerKind }
}

async function assertLlmCallColumns() {
  const expected = [
    "id", "run_id", "novel_id", "chapter", "beat_index", "attempt", "agent",
    "response_content", "request_json", "failed", "error_text",
  ]
  const rows = await db`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${"public"}
      AND table_name = ${"llm_calls"}
  `
  const cols = new Set((rows as any[]).map(r => r.column_name))
  const missing = expected.filter(c => !cols.has(c))
  if (missing.length > 0) throw new Error(`llm_calls missing expected columns: ${missing.join(", ")}`)
}

async function loadRows(args: Args): Promise<LlmRow[]> {
  await assertLlmCallColumns()
  const agents: Agent[] = ["beat-writer", "halluc-ungrounded", "adherence-events"]
  if (args.runIds.length > 0 && args.novelIds.length > 0) {
    return await db`
      SELECT id, run_id, novel_id, chapter, beat_index, attempt, agent,
             response_content, request_json, failed, error_text
      FROM llm_calls
      WHERE run_id IN ${db(args.runIds)}
        AND novel_id IN ${db(args.novelIds)}
        AND agent IN ${db(agents)}
      ORDER BY novel_id, chapter, beat_index, attempt, agent, id
    ` as LlmRow[]
  }
  if (args.runIds.length > 0) {
    return await db`
      SELECT id, run_id, novel_id, chapter, beat_index, attempt, agent,
             response_content, request_json, failed, error_text
      FROM llm_calls
      WHERE run_id IN ${db(args.runIds)}
        AND agent IN ${db(agents)}
      ORDER BY novel_id, chapter, beat_index, attempt, agent, id
    ` as LlmRow[]
  }
  return await db`
    SELECT id, run_id, novel_id, chapter, beat_index, attempt, agent,
           response_content, request_json, failed, error_text
    FROM llm_calls
    WHERE novel_id IN ${db(args.novelIds)}
      AND agent IN ${db(agents)}
    ORDER BY novel_id, chapter, beat_index, attempt, agent, id
  ` as LlmRow[]
}

function parseJson(value: string | null): any | null {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function buildAttempts(rows: LlmRow[]): BeatAttempt[] {
  const attempts = new Map<string, BeatAttempt>()
  for (const row of rows) {
    if (!row.novel_id || row.chapter === null || row.beat_index === null) continue
    const attempt = row.attempt ?? 1
    const key = `${row.novel_id}|${row.chapter}|${row.beat_index}|${attempt}`
    let item = attempts.get(key)
    if (!item) {
      item = {
        key,
        runId: row.run_id,
        novelId: row.novel_id,
        chapter: row.chapter,
        beatIndex: row.beat_index,
        attempt,
      }
      attempts.set(key, item)
    }
    if (row.agent === "beat-writer") item.writer = row
    else if (row.agent === "halluc-ungrounded") item.halluc = row
    else if (row.agent === "adherence-events") item.adherence = row
  }
  return [...attempts.values()].filter(a => a.writer).slice(0, Number.MAX_SAFE_INTEGER)
}

function baseFixture(attempt: BeatAttempt, checker: "halluc-ungrounded" | "adherence-events", surface: any) {
  const checkerRow = checker === "halluc-ungrounded" ? attempt.halluc : attempt.adherence
  return {
    fixture_id: `cs-${attempt.runId ?? "run"}-${attempt.novelId}-c${attempt.chapter}-b${attempt.beatIndex}-a${attempt.attempt}-${checker}`,
    checker,
    case_role: "current_surface_natural",
    split: "unlabeled",
    source_kind: "natural_current_surface",
    runtime_surface: surface ? {
      manifest_version: surface.manifest_version,
      canonical_commit: surface.canonical_commit,
      git_commit: surface.git_commit,
      deployed_commit_marker: surface.deployed_commit_marker,
      surface_fingerprint: surface.surface_fingerprint,
      beat_entity_list_variant: surface.beat_entity_list_variant,
      dirty_worktree: surface.dirty_worktree,
    } : null,
    source: {
      run_id: attempt.runId,
      novel_id: attempt.novelId,
      chapter: attempt.chapter,
      beat_index: attempt.beatIndex,
      attempt: attempt.attempt,
      writer_call_id: attempt.writer?.id,
      checker_call_id: checkerRow?.id ?? null,
    },
    task: {
      prose: attempt.writer?.response_content ?? "",
      writer_request_meta: attempt.writer?.request_json?.meta ?? null,
      checker_request_meta: checkerRow?.request_json ?? null,
    },
    actual: checkerRow ? {
      failed: Boolean(checkerRow.failed),
      error_text: checkerRow.error_text,
      output: parseJson(checkerRow.response_content),
    } : null,
    gold: {
      adjudication_status: "unlabeled",
      expected_pass: null,
      issues: [],
    },
  }
}

const SYNTHETIC_ENTITIES = [
  "Veyr Dominion",
  "Ivory Cartographers",
  "Saint Ormica's Index",
  "The Glass Principality",
]

function chooseAbsentEntity(attempt: BeatAttempt): string | null {
  const haystack = [
    attempt.writer?.response_content ?? "",
    JSON.stringify(attempt.writer?.request_json ?? {}),
    JSON.stringify(attempt.halluc?.request_json ?? {}),
  ].join("\n").toLowerCase()
  return SYNTHETIC_ENTITIES.find(e => !haystack.includes(e.toLowerCase())) ?? null
}

function syntheticHallucinationFixture(attempt: BeatAttempt, surface: any) {
  const entity = chooseAbsentEntity(attempt)
  if (!entity || !attempt.writer?.response_content) return null
  const prose = `${attempt.writer.response_content.trim()}\n\nA courier pressed the black seal of the ${entity} into the damp table wax before anyone could stop him.`
  return {
    ...baseFixture(attempt, "halluc-ungrounded", surface),
    fixture_id: `cs-${attempt.runId ?? "run"}-${attempt.novelId}-c${attempt.chapter}-b${attempt.beatIndex}-a${attempt.attempt}-synthetic-entity-insertion`,
    checker: "halluc-ungrounded",
    case_role: "synthetic_fixture",
    split: "candidate_score",
    source_kind: "synthetic_from_current_surface",
    fixture_class: "synthetic_entity_insertion",
    task: {
      prose,
      writer_request_meta: attempt.writer.request_json?.meta ?? null,
      checker_request_meta: attempt.halluc?.request_json ?? null,
    },
    mutation: {
      type: "entity_insertion",
      entity,
      inserted_text: `A courier pressed the black seal of the ${entity} into the damp table wax before anyone could stop him.`,
    },
    actual: null,
    gold: {
      adjudication_status: "synthetic_unreviewed",
      expected_pass: false,
      expected_severity: "blocker",
      issues: [{ type: "ungrounded_entity", entity }],
    },
  }
}

function syntheticAdherenceOmissionFixture(attempt: BeatAttempt, surface: any) {
  const meta = attempt.writer?.request_json?.meta
  const chars = Array.isArray(meta?.beatCharacters) && meta.beatCharacters.length > 0
    ? meta.beatCharacters.join(", ")
    : "The characters"
  const chapterTitle = meta?.chapterTitle ?? "the chapter"
  const prose = `${chars} remained in place while the moment drifted past. No one confronted the planned problem, no one made the required discovery, and ${chapterTitle} moved no closer to its next consequence.`
  return {
    ...baseFixture(attempt, "adherence-events", surface),
    fixture_id: `cs-${attempt.runId ?? "run"}-${attempt.novelId}-c${attempt.chapter}-b${attempt.beatIndex}-a${attempt.attempt}-synthetic-event-omission`,
    checker: "adherence-events",
    case_role: "synthetic_fixture",
    split: "candidate_score",
    source_kind: "synthetic_from_current_surface",
    fixture_class: "synthetic_event_omission",
    task: {
      prose,
      writer_request_meta: meta ?? null,
      checker_request_meta: attempt.adherence?.request_json ?? null,
    },
    mutation: {
      type: "event_omission",
      base_beat_description: meta?.beatDescription ?? null,
    },
    actual: null,
    gold: {
      adjudication_status: "synthetic_unreviewed",
      expected_pass: false,
      expected_severity: "blocker",
      issues: [{ type: "event_omission", expected_event: meta?.beatDescription ?? null }],
    },
  }
}

async function main() {
  const args = parseArgs()
  const surface = args.surfacePath ? JSON.parse(readFileSync(args.surfacePath, "utf8")) : null
  const rows = await loadRows(args)
  const attempts = buildAttempts(rows).slice(0, args.limit)
  const outRows: any[] = []

  for (const attempt of attempts) {
    outRows.push(baseFixture(attempt, "halluc-ungrounded", surface))
    outRows.push(baseFixture(attempt, "adherence-events", surface))
  }

  if (args.syntheticPerKind > 0) {
    let hallucCount = 0
    let adherenceCount = 0
    for (const attempt of attempts) {
      if (hallucCount < args.syntheticPerKind) {
        const row = syntheticHallucinationFixture(attempt, surface)
        if (row) { outRows.push(row); hallucCount++ }
      }
      if (adherenceCount < args.syntheticPerKind) {
        outRows.push(syntheticAdherenceOmissionFixture(attempt, surface))
        adherenceCount++
      }
      if (hallucCount >= args.syntheticPerKind && adherenceCount >= args.syntheticPerKind) break
    }
  }

  const outPath = resolve(args.out)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, outRows.map(row => JSON.stringify(row)).join("\n") + "\n")
  console.log(`Wrote ${outRows.length} rows from ${attempts.length} beat attempts to ${outPath}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
