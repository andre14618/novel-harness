#!/usr/bin/env bun
/**
 * Organic-run verification — clean no-forced-flags validation.
 *
 * Round B subagent B2 of the debug-injection work. Proves that on a
 * normal novel that never exhausts retries, the plan-assist exhaustion
 * path stays quiet: no chapter_exhaustions rows, no PipelineBailError.
 *
 * Every scripted exhaustion test up to this point has used DEBUG_FORCE_*
 * env flags to force failure paths. This script is the complement —
 * it runs with NO forced flags, so all the handler machinery should
 * stay idle. If any chapter_exhaustions row lands, or lastRunError
 * matches an exhaustion kind, the Round A work has a false-positive
 * somewhere.
 *
 * Pass gate (Codex review add543640220037e1):
 *   - Zero rows in chapter_exhaustions for this novel.
 *   - No PipelineBailError / no exhaustion-kind lastRunError.
 *
 * Usage:
 *   bun scripts/test/organic-run-verify.ts [--seed fantasy-healer] [--timeout-min 45] [--chapters 1]
 *
 * Options:
 *   --seed NAME         Seed name (without .json). Default: fantasy-healer.
 *   --timeout-min N     Overall timeout in minutes. Default: 45.
 *   --chapters N        Number of chapters to draft. Default: 1.
 *   --base URL          Orchestrator base URL. Default: $API_BASE or
 *                       $ORCHESTRATOR_URL or http://localhost:3006.
 *   --api-key KEY       API key. Default: $API_KEY or $ORCHESTRATOR_API_KEY.
 *
 * Environment:
 *   API_BASE, ORCHESTRATOR_URL    Orchestrator base URL
 *   API_KEY, ORCHESTRATOR_API_KEY Orchestrator API key
 *   DATABASE_URL                  Required — for post-run DB queries
 *
 * Exits 0 on PASS, 1 on FAIL / timeout.
 */

import { resolve } from "node:path"
import { existsSync } from "node:fs"
import db from "../../src/db/connection"

// ── CLI flags ────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function flagValue(name: string): string | undefined {
  // Support both "--name=val" and "--name val" shapes.
  const eq = args.find(a => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(`--${name}=`.length)
  const idx = args.indexOf(`--${name}`)
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]
  return undefined
}

const SEED        = flagValue("seed") ?? "fantasy-healer"
const TIMEOUT_MIN = Number(flagValue("timeout-min") ?? "45")
const CHAPTERS    = Number(flagValue("chapters") ?? "1")
const API_BASE    = flagValue("base")
  ?? process.env.API_BASE
  ?? process.env.ORCHESTRATOR_URL
  ?? "http://localhost:3006"
const API_KEY     = flagValue("api-key")
  ?? process.env.API_KEY
  ?? process.env.ORCHESTRATOR_API_KEY
  ?? ""

// ── API helpers (mirror exhaustion-campaign.ts shape) ────────────────────
async function apiPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function apiGet(path: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    headers: API_KEY ? { "x-api-key": API_KEY } : {},
  })
}

// ── Seed loading ─────────────────────────────────────────────────────────
interface SeedFile {
  premise?: string
  title?: string
  genre?: string
  chapterCount?: number
  characters?: Array<{ name: string; role?: string; description?: string }>
  targetWordsPerChapter?: number
}

async function loadSeed(seedName: string, overrideChapters: number): Promise<SeedFile> {
  // Resolve relative to the harness root (two levels up from scripts/test).
  const seedPath = resolve(import.meta.dir, "..", "..", "src", "seeds", `${seedName}.json`)
  if (!existsSync(seedPath)) {
    throw new Error(`Seed file not found: ${seedPath}`)
  }
  const raw = await Bun.file(seedPath).json() as SeedFile
  // Clone and override chapter count so a 1-chapter dry run doesn't reuse
  // the seed's default (e.g. fantasy-healer.json is 10 chapters).
  return { ...raw, chapterCount: overrideChapters }
}

// ── Start a novel (reuses the customSeed shape the campaigns use) ────────
async function startNovel(seed: SeedFile): Promise<string> {
  // mode="auto" so no approval gates block; unlike the web-campaign tests
  // there's no background gate-auto-approver loop here.
  const r = await apiPost("/api/novel/start", { customSeed: seed, mode: "auto" })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`POST /api/novel/start failed (${r.status}): ${text}`)
  }
  const data = await r.json() as { novelId?: string }
  if (!data.novelId) throw new Error(`No novelId in response: ${JSON.stringify(data)}`)
  return data.novelId
}

// ── Poll loop ────────────────────────────────────────────────────────────
interface NovelState {
  id: string
  phase: string
  currentChapter: number
  totalChapters: number
  active: boolean
  lastRunError: { kind?: string; bailKind?: string; message?: string; chapter?: number } | null
}

async function pollState(novelId: string): Promise<NovelState> {
  const r = await apiGet(`/api/novel/${novelId}/state`)
  if (!r.ok) throw new Error(`GET /state failed (${r.status})`)
  return await r.json() as NovelState
}

// Returns once novel finishes or errors, or null on timeout.
async function waitForTerminal(novelId: string, timeoutMs: number): Promise<NovelState | null> {
  const startedAt = Date.now()
  let lastProgressLog = 0
  while (Date.now() - startedAt < timeoutMs) {
    let state: NovelState
    try {
      state = await pollState(novelId)
    } catch (err) {
      console.warn(`  [poll] transient error: ${err instanceof Error ? err.message : err}`)
      await new Promise(res => setTimeout(res, 5_000))
      continue
    }

    // Progress log every ~30s
    if (Date.now() - lastProgressLog > 30_000) {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000)
      console.log(
        `  [${elapsedSec}s] phase=${state.phase}, chapter=${state.currentChapter}/${state.totalChapters}, active=${state.active}${state.lastRunError ? `, error=${state.lastRunError.kind ?? "yes"}` : ""}`
      )
      lastProgressLog = Date.now()
    }

    // Terminal conditions — in priority order:
    //   1. lastRunError populated → something bailed (expected to be null for pass)
    //   2. !active && phase === 'done' → success
    //   3. !active && phase !== 'done' → inactive-but-not-done (treat as terminal
    //      because the pipeline has yielded; let the assertion suite interpret it)
    if (state.lastRunError) return state
    if (!state.active) return state

    await new Promise(res => setTimeout(res, 5_000))
  }
  return null // timeout
}

// ── Diagnostic queries ───────────────────────────────────────────────────
async function queryFinalPlanCheckOutcomes(novelId: string): Promise<unknown[]> {
  // Latest plan-check-outcome per chapter (ordered by pipeline_events.id desc
  // which tracks insertion order). DISTINCT ON picks the most recent row
  // per chapter after the ORDER BY.
  const rows = await db`
    SELECT DISTINCT ON (chapter) chapter, payload, timestamp
    FROM pipeline_events
    WHERE novel_id = ${novelId}
      AND event_type = 'plan-check-outcome'
    ORDER BY chapter, id DESC
  ` as any[]
  return rows
}

async function queryFinalValidationChecks(novelId: string): Promise<unknown[]> {
  // Post-settle validation-check rows only (source='post-settle'). Both the
  // pre-settle and post-settle events carry eventType='validation-check', so
  // filter on payload.source to get Deliverable 1's new final-state trace.
  const rows = await db`
    SELECT chapter, payload, timestamp
    FROM pipeline_events
    WHERE novel_id = ${novelId}
      AND event_type = 'validation-check'
      AND payload->>'source' = 'post-settle'
    ORDER BY chapter, id
  ` as any[]
  return rows
}

async function queryChapterRevisions(novelId: string): Promise<unknown[]> {
  const rows = await db`
    SELECT chapter, attempt, outcome, issue_count, original_beat_count, revised_beat_count,
           rejection_reason, invoked_at
    FROM chapter_revisions
    WHERE novel_id = ${novelId}
    ORDER BY invoked_at
  ` as any[]
  return rows
}

async function queryChapterExhaustions(novelId: string): Promise<unknown[]> {
  const rows = await db`
    SELECT chapter, attempt, kind, resolver_mode, decision, decided_at, fired_at
    FROM chapter_exhaustions
    WHERE novel_id = ${novelId}
    ORDER BY fired_at
  ` as any[]
  return rows
}

function printTable(title: string, rows: unknown[]): void {
  console.log(`\n  ── ${title} (${rows.length} rows) ──`)
  if (rows.length === 0) {
    console.log(`    (empty)`)
    return
  }
  for (const row of rows) {
    console.log(`    ${JSON.stringify(row)}`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\nOrganic-run verification (clean no-forced-flags)`)
  console.log(`  Base: ${API_BASE}`)
  console.log(`  API key: ${API_KEY ? "set" : "(none)"}`)
  console.log(`  Seed: ${SEED}`)
  console.log(`  Chapters: ${CHAPTERS}`)
  console.log(`  Timeout: ${TIMEOUT_MIN} min`)
  console.log()

  // Paranoia check — Round A work is scoped to debug-injection. If any
  // DEBUG_FORCE_* flag is somehow set in the client env (shouldn't affect
  // the remote orchestrator, but this script's value is "clean"), bail early.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("DEBUG_FORCE_")) {
      console.error(`  [ABORT] DEBUG_FORCE_* env var set in this shell: ${key}=${process.env[key]}`)
      console.error(`          The organic-run-verify contract requires a clean environment.`)
      console.error(`          Note: this only checks the LOCAL env; the orchestrator process`)
      console.error(`          runs remotely and must also be free of forced flags. Verify on LXC.`)
      process.exit(2)
    }
  }

  // V2 store contamination check — Round B added an in-memory injection store
  // behind DEBUG_ENABLE_INJECTION. A leftover rule from a previous test run
  // could silently contaminate this "clean" run and produce a false failure.
  // GET /api/debug/active returns [] when the store is empty OR when the env
  // gate is off (the route 404s, caught below). Any non-empty result is a hard
  // abort. Codex review a1f0d145132145414 M2.
  try {
    const activeR = await apiGet(`/api/debug/active`)
    if (activeR.ok) {
      const activeBody = await activeR.json() as { rules?: unknown[] }
      const rules = Array.isArray(activeBody.rules) ? activeBody.rules : []
      if (rules.length > 0) {
        console.error(`  [ABORT] V2 injection store has ${rules.length} active rule(s) on the orchestrator.`)
        console.error(`          The organic-run contract requires a clean store.`)
        console.error(`          Clear with: curl -X DELETE $API_BASE/api/debug/clear/<novelId-or-wildcard> -H 'x-api-key: ...'`)
        console.error(`          Or restart the orchestrator (store is in-memory only).`)
        process.exit(2)
      }
    }
    // activeR not ok = env gate off (404) or auth fail — both acceptable.
    // If the env gate is off, no rules can be registered anyway.
  } catch (err) {
    console.warn(`  [warn] /api/debug/active probe failed (${err instanceof Error ? err.message : err}) — continuing, store may be unreachable`)
  }

  // 1. Load seed with chapter override
  let seed: SeedFile
  try {
    seed = await loadSeed(SEED, CHAPTERS)
  } catch (err) {
    console.error(`  [FATAL] seed load failed: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
  console.log(`  Loaded seed "${SEED}" (chapters overridden to ${CHAPTERS})`)
  console.log(`  Premise: ${seed.premise?.slice(0, 120)}${(seed.premise?.length ?? 0) > 120 ? "..." : ""}`)
  console.log()

  // 2. Start the novel
  let novelId: string
  const runStartedAt = Date.now()
  try {
    novelId = await startNovel(seed)
  } catch (err) {
    console.error(`  [FATAL] start failed: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
  console.log(`  Novel started: ${novelId}`)
  console.log(`  Polling /api/novel/${novelId}/state every 5s (progress every 30s)...`)
  console.log()

  // 3. Wait for terminal
  const timeoutMs = TIMEOUT_MIN * 60 * 1000
  const finalState = await waitForTerminal(novelId, timeoutMs)

  if (finalState === null) {
    console.error(`\n  [TIMEOUT] Novel did not reach terminal state within ${TIMEOUT_MIN} min`)
    console.error(`  Dumping diagnostics for post-mortem...`)
    await dumpDiagnostics(novelId)
    process.exit(1)
  }

  const elapsedSec = Math.floor((Date.now() - runStartedAt) / 1000)
  console.log(`\n  Novel reached terminal state after ~${elapsedSec}s`)
  console.log(`    phase=${finalState.phase}`)
  console.log(`    currentChapter=${finalState.currentChapter}/${finalState.totalChapters}`)
  console.log(`    active=${finalState.active}`)
  console.log(`    lastRunError=${finalState.lastRunError ? JSON.stringify(finalState.lastRunError) : "null"}`)

  // 4. Pass-gate assertions
  const failures: string[] = []

  // (a) Zero chapter_exhaustions rows.
  const exhRows = await queryChapterExhaustions(novelId)
  if (exhRows.length !== 0) {
    failures.push(`Expected 0 chapter_exhaustions rows, got ${exhRows.length}`)
  }

  // (b) No PipelineBailError / exhaustion-kind lastRunError.
  //     Legit lastRunError values for a clean run: null. Anything with kind
  //     "plan-assist-bail" or message containing "PipelineBailError" is a fail.
  if (finalState.lastRunError) {
    const err = finalState.lastRunError
    const msg = JSON.stringify(err)
    if (err.kind === "plan-assist-bail" || /PipelineBailError/.test(msg)) {
      failures.push(`lastRunError indicates pipeline bail: ${msg}`)
    } else {
      // Non-exhaustion legit errors (e.g. LLM network blip that killed the run)
      // still fail the PASS gate — a clean run should complete. We flag these
      // separately so the retro identifies them as "legit error, not handler bug."
      failures.push(`lastRunError populated (not an exhaustion but still a failure): ${msg}`)
    }
  }

  // 5. Print diagnostics regardless of pass/fail (per spec)
  console.log(`\n──────────────────────────────────────────────────────────`)
  console.log(`DIAGNOSTICS (not additional pass criteria)`)
  console.log(`──────────────────────────────────────────────────────────`)
  await dumpDiagnostics(novelId)

  // 6. Verdict
  console.log(`\n──────────────────────────────────────────────────────────`)
  if (failures.length === 0) {
    console.log(`  VERDICT: PASS`)
    console.log(`    novel=${novelId}`)
    console.log(`    chapter_exhaustions=0, lastRunError=null`)
    console.log(`──────────────────────────────────────────────────────────`)
    process.exit(0)
  } else {
    console.log(`  VERDICT: FAIL`)
    for (const f of failures) {
      console.log(`    - ${f}`)
    }
    console.log(`──────────────────────────────────────────────────────────`)
    process.exit(1)
  }
}

async function dumpDiagnostics(novelId: string): Promise<void> {
  try {
    const planChecks = await queryFinalPlanCheckOutcomes(novelId)
    printTable("Final plan-check-outcome per chapter", planChecks)
  } catch (err) {
    console.log(`  [warn] plan-check-outcome query failed: ${err instanceof Error ? err.message : err}`)
  }

  try {
    const valChecks = await queryFinalValidationChecks(novelId)
    printTable("Post-settle validation-check per chapter (Deliverable 1)", valChecks)
  } catch (err) {
    console.log(`  [warn] validation-check query failed: ${err instanceof Error ? err.message : err}`)
  }

  try {
    const revisions = await queryChapterRevisions(novelId)
    printTable("chapter_revisions rows", revisions)
  } catch (err) {
    console.log(`  [warn] chapter_revisions query failed: ${err instanceof Error ? err.message : err}`)
  }

  try {
    const exhaustions = await queryChapterExhaustions(novelId)
    printTable("chapter_exhaustions rows", exhaustions)
  } catch (err) {
    console.log(`  [warn] chapter_exhaustions query failed: ${err instanceof Error ? err.message : err}`)
  }
}

main().catch(err => {
  console.error(`\nOrganic-run-verify crashed:`, err)
  process.exit(1)
})
