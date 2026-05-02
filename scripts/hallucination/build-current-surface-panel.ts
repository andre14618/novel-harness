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

/**
 * Synthetic hallucination entity classes — one per failure shape the
 * halluc-ungrounded checker is required to detect per
 * `src/agents/halluc-ungrounded/halluc-ungrounded-system.md`. Each class
 * contributes one or more (entity, insertion_sentence) pairs that should
 * fire as ungrounded named entities when introduced cold. Sentences are
 * hand-written novel-style prose; do NOT generate via LLM.
 */
interface FailExample {
  entity: string
  insertion: string
}

interface SyntheticEntityClass {
  class_name: string
  fail_examples: FailExample[]
}

export const SYNTHETIC_ENTITY_CLASSES: SyntheticEntityClass[] = [
  {
    class_name: "named_place_or_realm",
    fail_examples: [
      {
        entity: "Veyr Dominion",
        insertion: "A courier pressed the black seal of the Veyr Dominion into the damp table wax before anyone could stop him.",
      },
      {
        entity: "Halrune Vale",
        insertion: "Two riders wearing the muddy colors of Halrune Vale dismounted at the gate and asked, very politely, after the wounded.",
      },
      {
        entity: "the Splinter Coast",
        insertion: "Tide-glass from the Splinter Coast made a soft tick on the sill, the way it always did when the wind turned offshore.",
      },
    ],
  },
  {
    class_name: "title_plus_ungrounded_surname",
    fail_examples: [
      {
        entity: "Master Orin",
        insertion: "Master Orin had not spoken since the bell, and the silence at his end of the table was beginning to dictate the meeting.",
      },
      {
        entity: "Lord Caelin",
        insertion: "A page came in red-faced with running and said only that Lord Caelin was waiting in the lower gallery.",
      },
      {
        entity: "Arbiter Vesh",
        insertion: "Arbiter Vesh signed the warrant without rereading it, which was, in itself, a kind of verdict.",
      },
    ],
  },
  {
    class_name: "named_institution",
    fail_examples: [
      {
        entity: "Office of Structural Integrity",
        insertion: "The seal at the bottom of the page belonged to the Office of Structural Integrity, and that alone made the clerk read it twice.",
      },
      {
        entity: "Vault of Mirrored Names",
        insertion: "He had been told, once, that the Vault of Mirrored Names kept a duplicate ledger for exactly this kind of dispute.",
      },
    ],
  },
  {
    class_name: "named_artifact",
    fail_examples: [
      {
        entity: "the Sundered Crown",
        insertion: "She glanced, almost without meaning to, at the Sundered Crown on its iron pedestal, then made herself look at the wall instead.",
      },
      {
        entity: "Vellis Quill",
        insertion: "The Vellis Quill lay in its lacquered case between them, point dry, untouched since the last contract had failed.",
      },
    ],
  },
  {
    class_name: "named_historical_event",
    fail_examples: [
      {
        entity: "the Siege of Briar Pass",
        insertion: "Old men in the kitchen still measured every cold spring against the one before the Siege of Briar Pass, as if weather had taken sides.",
      },
      {
        entity: "the Withering of '47",
        insertion: "Half the orchards along the lower river had never quite recovered from the Withering of '47, and everyone in the room knew it.",
      },
    ],
  },
  {
    class_name: "plural_ungrounded_faction",
    fail_examples: [
      {
        entity: "the Bellward Order",
        insertion: "Three of the riders carried the gray sash of the Bellward Order, though they had taken care to hide the embroidery beneath their cloaks.",
      },
      {
        entity: "the Quiet Concord",
        insertion: "It was the kind of arrangement only the Quiet Concord ever brokered, and no one at the table wanted to be the first to name them.",
      },
    ],
  },
]

/**
 * PASS controls — generic phrases the halluc-ungrounded prompt explicitly
 * lists as non-firing (see system.md "Pass" rules). These should NOT be
 * flagged as ungrounded entities. Each insertion is hand-written prose.
 */
interface PassExample {
  control_kind: string
  insertion: string
}

export const SYNTHETIC_PASS_CONTROLS: PassExample[] = [
  {
    control_kind: "generic_role_label",
    insertion: "The captain looked up from the map, then back down, and tapped the rim of his cup against the table to call the meeting to order.",
  },
  {
    control_kind: "generic_role_label",
    insertion: "A courier in the wrong colors was loitering near the gate, pretending to fix a strap that was already fastened.",
  },
  {
    control_kind: "generic_role_label",
    insertion: "The priest had not slept, and it showed in the way he held the lantern lower than usual on the stairs.",
  },
  {
    control_kind: "generic_location",
    insertion: "She passed through the storeroom on the way out and made a small note, in the back of her mind, of where the lamp oil had been moved.",
  },
  {
    control_kind: "generic_location",
    insertion: "The hall was colder than it had been an hour ago, and the draft was coming from a direction that had been bricked up for years.",
  },
  {
    control_kind: "generic_location",
    insertion: "By the time they reached the road again, the rain had set in for the night and there was no point pretending otherwise.",
  },
  {
    control_kind: "generic_document",
    insertion: "The document had been folded and refolded so many times the seam where the wax had once held it together was beginning to give.",
  },
  {
    control_kind: "generic_document",
    insertion: "A letter, unaddressed, sat at the bottom of the stack, and she did not need to open it to know whose hand had written it.",
  },
  {
    control_kind: "generic_document",
    insertion: "He read the message once, then a second time, and on the second reading he set down the cup he had been holding without drinking from.",
  },
]

function flatFailExamples(): Array<{ class_name: string; entity: string; insertion: string }> {
  // Round-robin across classes so that small --synthetic-per-kind values
  // (e.g. 6) still cover all six entity classes once before doubling up.
  const out: Array<{ class_name: string; entity: string; insertion: string }> = []
  const maxLen = Math.max(...SYNTHETIC_ENTITY_CLASSES.map(c => c.fail_examples.length))
  for (let i = 0; i < maxLen; i++) {
    for (const cls of SYNTHETIC_ENTITY_CLASSES) {
      const ex = cls.fail_examples[i]
      if (ex) out.push({ class_name: cls.class_name, entity: ex.entity, insertion: ex.insertion })
    }
  }
  return out
}

function entityIsAbsent(attempt: BeatAttempt, entity: string): boolean {
  const haystack = [
    attempt.writer?.response_content ?? "",
    JSON.stringify(attempt.writer?.request_json ?? {}),
    JSON.stringify(attempt.halluc?.request_json ?? {}),
  ].join("\n").toLowerCase()
  return !haystack.includes(entity.toLowerCase())
}

function syntheticHallucinationFixture(
  attempt: BeatAttempt,
  surface: any,
  entry: { class_name: string; entity: string; insertion: string },
) {
  if (!attempt.writer?.response_content) return null
  if (!entityIsAbsent(attempt, entry.entity)) return null
  const prose = `${attempt.writer.response_content.trim()}\n\n${entry.insertion}`
  const slug = entry.entity.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return {
    ...baseFixture(attempt, "halluc-ungrounded", surface),
    fixture_id: `cs-${attempt.runId ?? "run"}-${attempt.novelId}-c${attempt.chapter}-b${attempt.beatIndex}-a${attempt.attempt}-synthetic-entity-insertion-${slug}`,
    checker: "halluc-ungrounded",
    case_role: "synthetic_fixture",
    split: "candidate_score",
    source_kind: "synthetic_from_current_surface",
    fixture_class: "synthetic_entity_insertion",
    entity_class: entry.class_name,
    task: {
      prose,
      writer_request_meta: attempt.writer.request_json?.meta ?? null,
      checker_request_meta: attempt.halluc?.request_json ?? null,
    },
    mutation: {
      type: "entity_insertion",
      entity: entry.entity,
      entity_class: entry.class_name,
      inserted_text: entry.insertion,
    },
    actual: null,
    gold: {
      adjudication_status: "synthetic_unreviewed",
      expected_pass: false,
      expected_severity: "blocker",
      issues: [{ type: "ungrounded_entity", entity: entry.entity, entity_class: entry.class_name }],
    },
  }
}

function syntheticHallucPassControlFixture(
  attempt: BeatAttempt,
  surface: any,
  control: PassExample,
  index: number,
) {
  if (!attempt.writer?.response_content) return null
  const prose = `${attempt.writer.response_content.trim()}\n\n${control.insertion}`
  return {
    ...baseFixture(attempt, "halluc-ungrounded", surface),
    fixture_id: `cs-${attempt.runId ?? "run"}-${attempt.novelId}-c${attempt.chapter}-b${attempt.beatIndex}-a${attempt.attempt}-synthetic-pass-control-${control.control_kind}-${index}`,
    checker: "halluc-ungrounded",
    case_role: "synthetic_fixture",
    split: "candidate_score",
    source_kind: "synthetic_from_current_surface",
    fixture_class: "synthetic_pass_control",
    entity_class: control.control_kind,
    task: {
      prose,
      writer_request_meta: attempt.writer.request_json?.meta ?? null,
      checker_request_meta: attempt.halluc?.request_json ?? null,
    },
    mutation: {
      type: "pass_control_insertion",
      control_kind: control.control_kind,
      inserted_text: control.insertion,
    },
    actual: null,
    gold: {
      adjudication_status: "synthetic_unreviewed",
      expected_pass: true,
      expected_severity: "none",
      issues: [],
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
    // Halluc fail fixtures — round-robin across the 6 entity classes so any
    // --synthetic-per-kind value covers as many distinct shapes as possible.
    const failPool = flatFailExamples()
    let hallucCount = 0
    let poolIdx = 0
    for (const attempt of attempts) {
      if (hallucCount >= args.syntheticPerKind) break
      // Try entity-class entries until we find one absent from this attempt
      let placed = false
      for (let tried = 0; tried < failPool.length && !placed; tried++) {
        const entry = failPool[(poolIdx + tried) % failPool.length]
        const row = syntheticHallucinationFixture(attempt, surface, entry)
        if (row) {
          outRows.push(row)
          hallucCount++
          poolIdx = (poolIdx + tried + 1) % failPool.length
          placed = true
        }
      }
    }

    // Halluc PASS controls — generic role / location / document phrases that
    // the prompt's pass-rules say should NOT fire. Cycle through the pool the
    // same way and tag each attempt with a different control kind.
    let passCount = 0
    let passIdx = 0
    for (const attempt of attempts) {
      if (passCount >= args.syntheticPerKind) break
      const control = SYNTHETIC_PASS_CONTROLS[passIdx % SYNTHETIC_PASS_CONTROLS.length]
      const row = syntheticHallucPassControlFixture(attempt, surface, control, passIdx)
      if (row) {
        outRows.push(row)
        passCount++
      }
      passIdx++
    }

    // Adherence omission fixtures — unchanged shape; one per attempt.
    let adherenceCount = 0
    for (const attempt of attempts) {
      if (adherenceCount >= args.syntheticPerKind) break
      outRows.push(syntheticAdherenceOmissionFixture(attempt, surface))
      adherenceCount++
    }
  }

  const outPath = resolve(args.out)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, outRows.map(row => JSON.stringify(row)).join("\n") + "\n")
  console.log(`Wrote ${outRows.length} rows from ${attempts.length} beat attempts to ${outPath}`)
}

// Only run when invoked directly (allows test/import use of the exported
// fixture constants without triggering DB I/O).
if (import.meta.path === Bun.main) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
