#!/usr/bin/env bun
/**
 * Smoke validator for the two-stage adherence-events checker
 * (binary first, per-event enumeration on FAIL).
 *
 * Per-fixture invariants:
 *   - PASS fixture (events_present=true)  → exactly 1 LLM call (stage 1).
 *   - FAIL fixture (events_present=false) → exactly 2 LLM calls (stage 1 + stage 2).
 *
 * Counts are gathered by spying on every callAgent invocation tagged
 * `agentName: "adherence-events"`. The fixtures are deliberately small,
 * self-contained, and ground-truthed by a human author so the smoke
 * remains stable as long as DeepSeek V4 Flash retains a basic ability
 * to recognize "this action does/doesn't appear in this prose".
 *
 * Acceptance: PASS-fixture call count == 1, FAIL-fixture call count == 2.
 *
 * Usage:
 *   bun scripts/adherence-two-stage-smoke.ts \
 *     [--out /tmp/adherence-two-stage-smoke-<ts>.json]
 */

import { writeFileSync } from "node:fs"
import db from "../src/db/connection"
import { initExperimentRun } from "../src/logger"
import { checkBeatAdherence } from "../src/agents/writer/adherence-checker"
import type { ChapterOutline, CharacterProfile, SceneBeat, BeatObligationsContract } from "../src/types"

interface CliArgs {
  outPath: string
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2)
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  let outPath = `/tmp/adherence-two-stage-smoke-${ts}.json`
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") outPath = argv[++i]
  }
  return { outPath }
}

const emptyObligations: BeatObligationsContract = {
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
}

function makeBeat(description: string, characters: string[]): SceneBeat {
  return {
    description,
    characters,
    kind: "action",
    requiredPayoffs: [],
    obligations: emptyObligations,
  } as SceneBeat
}

function makeOutline(pov: string): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Smoke",
    povCharacter: pov,
    setting: "Workshop",
    purpose: "smoke",
    scenes: [],
    targetWords: 500,
    charactersPresent: [pov],
    charactersPresentIds: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  }
}

interface SmokeFixture {
  id: string
  expected: "pass" | "fail"
  beat: SceneBeat
  prose: string
  outline: ChapterOutline
  characters: CharacterProfile[]
  expectedCallCount: 1 | 2
}

const FIXTURES: SmokeFixture[] = [
  // ── PASS: single-event beat fully enacted in prose. ──────────────────
  {
    id: "pass-door-open",
    expected: "pass",
    beat: makeBeat("Maren walks across the workshop and opens the south door.", ["Maren"]),
    prose:
      "Maren crossed the workshop in five strides, her boots loud on the boards. She set both hands to the south door and pulled it open. Cold air spilled in around her ankles.",
    outline: makeOutline("Maren"),
    characters: [],
    expectedCallCount: 1,
  },
  // ── FAIL: two-event beat, second event missing. ──────────────────────
  {
    id: "fail-door-open-and-call",
    expected: "fail",
    beat: makeBeat(
      "Maren opens the south door and calls Tomas's name into the yard.",
      ["Maren"],
    ),
    prose:
      "Maren set both hands to the south door and pulled it open. Cold air spilled in around her ankles. She stood in the doorway, listening to the wind, and said nothing.",
    outline: makeOutline("Maren"),
    characters: [],
    expectedCallCount: 2,
  },
  // ── FAIL: action attributed to wrong character. ──────────────────────
  {
    id: "fail-wrong-attribution",
    expected: "fail",
    beat: makeBeat(
      "Maren picks up the broken lantern from the bench and carries it outside.",
      ["Maren"],
    ),
    prose:
      "Maren stayed where she was. Tomas crossed to the bench, picked up the broken lantern, and carried it out into the yard.",
    outline: makeOutline("Maren"),
    characters: [],
    expectedCallCount: 2,
  },
]

interface FixtureResult {
  id: string
  expected: "pass" | "fail"
  expectedCallCount: 1 | 2
  actualCallCount: number
  callCountOk: boolean
  pass: boolean
  issues: string[]
}

async function countAdherenceCalls(novelId: string): Promise<number> {
  const rows = await db`
    SELECT COUNT(*)::int AS n
    FROM llm_calls
    WHERE agent = 'adherence-events' AND novel_id = ${novelId}
  ` as Array<{ n: number }>
  return rows[0]?.n ?? 0
}

async function main(): Promise<void> {
  const args = parseArgs()
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)

  // Initialize an experiment-scoped run so logger.logLLMCallStructured
  // has a `currentRunId` to attach adherence-events rows to. Without it,
  // the logger drops every call (printed `[logger] ... no currentRunId`)
  // and the post-hoc COUNT(*) returns 0 even though the LLM ran.
  const experimentId = process.env.EXPERIMENT_ID ? Number(process.env.EXPERIMENT_ID) : 317
  const runId = await initExperimentRun(experimentId, "smoke", `adherence-two-stage-${runStamp}`)
  console.log(`[smoke] initExperimentRun id=${runId} experiment=${experimentId}`)

  // Each fixture gets a unique novelId so its adherence-events calls land
  // in llm_calls under a distinct tag and can be counted post-hoc. This
  // sidesteps the ESM-readonly-export problem with monkey-patching
  // src/llm.callAgent and observes the persisted source of truth that
  // production already relies on.

  const results: FixtureResult[] = []
  for (const fx of FIXTURES) {
    const novelId = `smoke-${fx.id}-${runStamp}`
    const t0 = Date.now()
    const r = await checkBeatAdherence(
      fx.prose,
      fx.beat,
      fx.outline,
      fx.characters,
      { novelId, chapter: 1, beatIndex: 0, attempt: 1 },
    )
    const t1 = Date.now()
    const actualCallCount = await countAdherenceCalls(novelId)

    const expectedPass = fx.expected === "pass"
    const passed = r.pass === expectedPass && actualCallCount === fx.expectedCallCount

    const result: FixtureResult = {
      id: fx.id,
      expected: fx.expected,
      expectedCallCount: fx.expectedCallCount,
      actualCallCount,
      callCountOk: actualCallCount === fx.expectedCallCount,
      pass: r.pass,
      issues: r.issues,
    }
    results.push(result)

    const tag = passed ? "OK" : "MISMATCH"
    console.log(
      `[${tag}] ${fx.id}: expected=${fx.expected} pass=${r.pass} calls=${actualCallCount}/${fx.expectedCallCount} latency=${t1 - t0}ms novel_id=${novelId}`,
    )
    if (r.issues.length > 0) {
      for (const issue of r.issues) console.log(`         issue: ${issue}`)
    }
  }

  const summary = {
    git_commit: process.env.GIT_COMMIT ?? null,
    experiment_id: experimentId,
    run_id: runId,
    timestamp: new Date().toISOString(),
    fixtures: results,
    aggregate: {
      total: results.length,
      call_count_ok: results.every(r => r.callCountOk),
      verdict_ok: results.every(r => r.pass === (r.expected === "pass")),
      pass_path_calls: results.filter(r => r.expected === "pass").reduce((s, r) => s + r.actualCallCount, 0),
      fail_path_calls: results.filter(r => r.expected === "fail").reduce((s, r) => s + r.actualCallCount, 0),
    },
  }
  writeFileSync(args.outPath, JSON.stringify(summary, null, 2) + "\n")
  console.log(`\n[summary] pass-path calls=${summary.aggregate.pass_path_calls}  fail-path calls=${summary.aggregate.fail_path_calls}`)
  console.log(`[summary] call-count-ok=${summary.aggregate.call_count_ok}  verdict-ok=${summary.aggregate.verdict_ok}`)
  console.log(`[summary] wrote ${args.outPath}`)

  if (!summary.aggregate.call_count_ok) {
    console.error("\nFAIL: at least one fixture had the wrong adherence-events call count.")
    process.exit(1)
  }

  // Cleanly close the DB pool so the script terminates without an
  // unreleased Postgres connection holding the event loop open.
  await db.end()
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
