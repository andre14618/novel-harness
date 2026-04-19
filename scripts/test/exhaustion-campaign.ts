#!/usr/bin/env bun
/**
 * Exhaustion-handler test campaign runner.
 * See docs/test-campaign-plan.md for the full test plan.
 *
 * Usage:
 *   bun scripts/test/exhaustion-campaign.ts [--assume-env] [--skip-env-tests] [--base=URL] [--api-key=KEY]
 *
 * Options:
 *   --assume-env       Assume DEBUG_FORCE_* env vars are already set on the orchestrator.
 *                      Required for R1/R5/R6/R7 to proceed instead of erroring out.
 *   --skip-env-tests   Skip all tests that require env injection on the orchestrator.
 *                      Useful for R0-only schema smoke.
 *   --base=URL         Orchestrator base URL. Default: $ORCHESTRATOR_URL or http://localhost:3006
 *   --api-key=KEY      API key. Default: $ORCHESTRATOR_API_KEY
 *
 * Manual tests (not scripted here):
 *   R2 — web-mode override: requires human UI interaction. See "## Manual tests" below.
 *   R3 — web-mode edit-plan: requires human UI interaction.
 *   R4 — web-mode abort: requires human UI interaction.
 *   R8 — UI SSE/panel: requires visual inspection.
 *
 * ## Manual tests
 *
 * R2 (web-mode override):
 *   1. Set DEBUG_FORCE_PLAN_CHECK=fail on the orchestrator (env or systemd override).
 *   2. POST /api/novel/start body: { customSeed: {...3ch seed...}, mode: "web" }
 *   3. Wait for Studio to show the plan-assist gate panel.
 *   4. POST /api/novel/:id/plan-assist/1/decide body: { action: "override" }
 *   5. Assert: chapter_outlines.plan_check_overridden === true,
 *      subsequent attempt logs "[OVERRIDE] plan-check + validation-reviser skipped".
 *
 * R3 (web-mode edit-plan):
 *   Same flow but decide body: { action: "edit-plan", outline: { scenes:[...3 valid beats...] } }
 *   Assert: chapter_outlines.outline_json updated, chapter_exhaustions.decision='edit-plan'.
 *
 * R4 (web-mode abort):
 *   Same flow but decide body: { action: "abort" }
 *   Assert: novels.phase === 'drafting', activeRuns.has(novelId) === false.
 *
 * R8 (UI/SSE):
 *   Open Studio in two browser tabs. Trigger a gate in one tab; confirm
 *   ExhaustionsPanel updates within 1s in the other.
 */

import db from "../../src/db/connection"

// ── CLI flags ────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const assumeEnv   = args.includes("--assume-env")
const skipEnvTests = args.includes("--skip-env-tests")
const baseArg = args.find(a => a.startsWith("--base="))
const keyArg  = args.find(a => a.startsWith("--api-key="))
const onlyArg = args.find(a => a.startsWith("--only="))
const onlyFilter = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map(s => s.trim().toUpperCase())) : null
function runsThis(tag: string): boolean { return !onlyFilter || onlyFilter.has(tag) }

const API_BASE = baseArg ? baseArg.slice("--base=".length) : (process.env.ORCHESTRATOR_URL ?? "http://localhost:3006")
const API_KEY  = keyArg  ? keyArg.slice("--api-key=".length) : (process.env.ORCHESTRATOR_API_KEY ?? "")

// ── Types ────────────────────────────────────────────────────────────────
interface TestResult {
  name: string
  pass: boolean
  details?: string
  error?: string
}

// Minimal test seed — 1 chapter, 300w target so the beat-writer pass
// terminates fast. Forced-path tests only care about chapter 1's handler
// flow, so 1 chapter suffices. Beat floor is ceil(targetWords/150)=2,
// with a hard floor of 2; planner will still emit 3-4 beats typically.
function makeTestSeed(label: string) {
  return {
    title: `test-exhaustion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    premise: `A lone ranger named ${label} crosses a dying land to deliver a message that may end a war.`,
    genre: "fantasy",
    chapterCount: 1,
    characters: [
      { name: label, role: "protagonist", description: "A weathered courier who trusts only the road." },
      { name: "Marshal Vex", role: "supporting", description: "Commander of the eastern border garrison." },
    ],
    targetWordsPerChapter: 300,
  }
}

// ── API helpers ──────────────────────────────────────────────────────────
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

// ── Polling helper ───────────────────────────────────────────────────────
async function waitFor<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 120_000,
  intervalMs = 1_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await fn()
    if (result !== null) return result
    await Bun.sleep(intervalMs)
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}

// Poll novel state until active===false (run finished or stalled).
async function waitForIdle(novelId: string, timeoutMs = 120_000): Promise<any> {
  return waitFor(
    async () => {
      const r = await apiGet(`/api/novel/${novelId}/state`)
      if (!r.ok) return null
      const state = await r.json() as any
      return state.active === false ? state : null
    },
    timeoutMs,
  )
}

// ── Start a novel and get its id ─────────────────────────────────────────
async function startNovel(seed: object, mode: "auto" | "web"): Promise<string> {
  const r = await apiPost("/api/novel/start", { customSeed: seed, mode })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`POST /api/novel/start failed (${r.status}): ${body}`)
  }
  const data = await r.json() as any
  if (!data.novelId) throw new Error(`No novelId in response: ${JSON.stringify(data)}`)
  return data.novelId as string
}

// ── Assertion helpers ────────────────────────────────────────────────────
function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`Assertion failed: ${message}`)
}

// ── R0 — Schema smoke ─────────────────────────────────────────────────────
async function runR0_schemaSmoke(): Promise<TestResult> {
  const name = "R0 — schema smoke (migrations + columns)"
  try {
    // Check that migrations 029 and 030 exist in _migrations.
    const migRows = await db`SELECT name FROM _migrations WHERE name IN ('029_plan_check_override.sql', '030_chapter_exhaustions.sql') ORDER BY name`
    const migNames = (migRows as any[]).map(r => r.name)

    // These may have different exact file names — check by pattern.
    const mig029 = (await db`SELECT name FROM _migrations WHERE name LIKE '%029%'`) as any[]
    const mig030 = (await db`SELECT name FROM _migrations WHERE name LIKE '%030%'`) as any[]

    if (mig029.length === 0) throw new Error("Migration 029 (plan_check_override) not applied")
    if (mig030.length === 0) throw new Error("Migration 030 (chapter_exhaustions) not applied")

    // Check plan_check_overridden column exists in chapter_outlines
    const colRows = await db`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'chapter_outlines' AND column_name = 'plan_check_overridden'
    `
    if ((colRows as any[]).length === 0) throw new Error("chapter_outlines.plan_check_overridden column missing")

    // Check chapter_exhaustions table exists
    const tblRows = await db`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'chapter_exhaustions'
    `
    if ((tblRows as any[]).length === 0) throw new Error("chapter_exhaustions table missing")

    // Check chapter_revisions table exists (for reviser telemetry)
    const revRows = await db`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'chapter_revisions'
    `
    if ((revRows as any[]).length === 0) throw new Error("chapter_revisions table missing")

    return {
      name, pass: true,
      details: `migrations 029+030 applied, plan_check_overridden col present, chapter_exhaustions table present, chapter_revisions table present`,
    }
  } catch (e) {
    return { name, pass: false, error: String(e) }
  }
}

// ── R1 — Auto-mode bail via plan-check ────────────────────────────────────
async function runR1_autoBailPlanCheck(assumeEnvSet: boolean): Promise<TestResult> {
  const name = "R1 — auto-mode bail via plan-check (DEBUG_FORCE_PLAN_CHECK=fail)"
  if (!assumeEnvSet) {
    return {
      name, pass: false,
      error: "[SKIP] Set DEBUG_FORCE_PLAN_CHECK=fail on the orchestrator process and rerun with --assume-env",
    }
  }
  try {
    const seed = makeTestSeed("Rynn")
    const novelId = await startNovel(seed, "auto")
    console.log(`  [R1] novel=${novelId}, waiting for idle...`)

    const state = await waitForIdle(novelId, 1_500_000)
    assert(!state.active, "Novel should be idle after bail")
    assert(state.lastRunError !== null, "lastRunError should be populated")
    assert(state.lastRunError?.kind === "plan-assist-bail",
      `Expected kind=plan-assist-bail, got: ${state.lastRunError?.kind}`)
    assert(state.lastRunError?.bailKind === "plan-check-exhausted",
      `Expected bailKind=plan-check-exhausted, got: ${state.lastRunError?.bailKind}`)
    assert(state.lastRunError?.chapter === 1,
      `Expected chapter=1, got: ${state.lastRunError?.chapter}`)

    // DB assertions
    const exhRows = await db`
      SELECT * FROM chapter_exhaustions
      WHERE novel_id = ${novelId}
        AND kind = 'plan-check-exhausted'
        AND resolver_mode = 'auto'
        AND decided_at IS NULL
    `
    assert((exhRows as any[]).length >= 1,
      `Expected >=1 chapter_exhaustions row, got ${(exhRows as any[]).length}`)

    const revRows = await db`
      SELECT * FROM chapter_revisions
      WHERE novel_id = ${novelId}
        AND outcome = 'accepted'
    `
    assert((revRows as any[]).length === 1,
      `Expected exactly 1 accepted revision row, got ${(revRows as any[]).length}`)

    return {
      name, pass: true,
      details: `novelId=${novelId}, lastRunError.bailKind=plan-check-exhausted, chapter=1, ` +
               `exhaustions=${(exhRows as any[]).length}, accepted_revisions=1`,
    }
  } catch (e) {
    return { name, pass: false, error: String(e) }
  }
}

// ── R5 — Validation-path reviser ─────────────────────────────────────────
async function runR5_validationPath(assumeEnvSet: boolean): Promise<TestResult> {
  const name = "R5 — validation-path reviser (DEBUG_FORCE_VALIDATION=pov)"
  if (!assumeEnvSet) {
    return {
      name, pass: false,
      error: "[SKIP] Set DEBUG_FORCE_VALIDATION=pov on the orchestrator process and rerun with --assume-env",
    }
  }
  try {
    const seed = makeTestSeed("Sera")
    const novelId = await startNovel(seed, "auto")
    console.log(`  [R5] novel=${novelId}, waiting for idle...`)

    const state = await waitForIdle(novelId, 1_500_000)
    assert(!state.active, "Novel should be idle after bail")
    assert(state.lastRunError !== null, "lastRunError should be populated (auto bail expected)")

    // chapter_revisions should have a row from the validation-path reviser.
    // The validation reviser either accepts (outcome='accepted') or is rejected
    // (outcome like 'rejected_*'). In either case the deviations carry the
    // "[validation]" prefix we inject. We accept any non-skip outcome.
    const revRows = await db`
      SELECT * FROM chapter_revisions
      WHERE novel_id = ${novelId}
    ` as any[]

    const validationRows = revRows.filter((r: any) =>
      // Look for the [validation] prefix in rejection_reason or deviations JSONB
      (r.rejection_reason && r.rejection_reason.includes("[validation]")) ||
      (r.deviations && JSON.stringify(r.deviations).includes("[validation]"))
    )

    assert(validationRows.length >= 1,
      `Expected >=1 chapter_revisions row with [validation] tag, got ${validationRows.length}. All rows: ${JSON.stringify(revRows.map((r: any) => ({ outcome: r.outcome, rejection_reason: r.rejection_reason })))}`)

    // chapter_exhaustions should have a row
    const exhRows = await db`
      SELECT * FROM chapter_exhaustions WHERE novel_id = ${novelId}
    ` as any[]
    assert(exhRows.length >= 1, `Expected >=1 exhaustion row, got ${exhRows.length}`)

    return {
      name, pass: true,
      details: `novelId=${novelId}, validation-path revisions=${validationRows.length}, exhaustions=${exhRows.length}`,
    }
  } catch (e) {
    return { name, pass: false, error: String(e) }
  }
}

// ── R6 — Reviser-rejected gate kind ──────────────────────────────────────
async function runR6_reviserRejected(assumeEnvSet: boolean): Promise<TestResult> {
  const name = "R6 — reviser-rejected gate kind (DEBUG_FORCE_PLAN_CHECK=fail + DEBUG_FORCE_REVISER=reject)"
  if (!assumeEnvSet) {
    return {
      name, pass: false,
      error: "[SKIP] Set DEBUG_FORCE_PLAN_CHECK=fail and DEBUG_FORCE_REVISER=reject on the orchestrator and rerun with --assume-env",
    }
  }
  try {
    const seed = makeTestSeed("Korr")
    const novelId = await startNovel(seed, "auto")
    console.log(`  [R6] novel=${novelId}, waiting for idle...`)

    const state = await waitForIdle(novelId, 1_500_000)
    assert(!state.active, "Novel should be idle")
    assert(state.lastRunError !== null, "lastRunError should be populated")
    // Either plan-assist-bail with reviser-rejected kind, or the reviser
    // rejection gets followed by plan-check-exhausted — either is valid here.
    const validKinds = ["plan-assist-bail"]
    assert(validKinds.includes(state.lastRunError?.kind),
      `Expected kind in [${validKinds.join(",")}], got: ${state.lastRunError?.kind}`)

    // chapter_exhaustions should have a reviser-rejected row with reviser_history
    const exhRows = await db`
      SELECT * FROM chapter_exhaustions
      WHERE novel_id = ${novelId}
        AND kind = 'reviser-rejected'
    ` as any[]

    assert(exhRows.length >= 1,
      `Expected >=1 reviser-rejected exhaustion row, got ${exhRows.length}`)

    const withHistory = exhRows.filter((r: any) => r.reviser_history !== null)
    assert(withHistory.length >= 1,
      `Expected >=1 exhaustion row with non-null reviser_history, got ${withHistory.length}`)

    return {
      name, pass: true,
      details: `novelId=${novelId}, reviser-rejected exhaustions=${exhRows.length}, with history=${withHistory.length}`,
    }
  } catch (e) {
    return { name, pass: false, error: String(e) }
  }
}

// ── R7 — Reviser single-escalation ───────────────────────────────────────
async function runR7_reviserSingleEscalation(assumeEnvSet: boolean): Promise<TestResult> {
  const name = "R7 — reviser fires exactly once (single-escalation guarantee)"
  if (!assumeEnvSet) {
    return {
      name, pass: false,
      error: "[SKIP] Set DEBUG_FORCE_PLAN_CHECK=fail on the orchestrator and rerun with --assume-env",
    }
  }
  try {
    const seed = makeTestSeed("Tamsin")
    const novelId = await startNovel(seed, "auto")
    console.log(`  [R7] novel=${novelId}, waiting for idle...`)

    await waitForIdle(novelId, 1_500_000)

    const allRevisions = await db`
      SELECT outcome FROM chapter_revisions WHERE novel_id = ${novelId} ORDER BY id
    ` as any[]

    // Exactly one non-skip outcome, all others are skip variants
    const nonSkipOutcomes = ["accepted", "rejected_beat_floor", "rejected_new_characters", "error"]
    const nonSkip = allRevisions.filter((r: any) => nonSkipOutcomes.includes(r.outcome))
    const skipRows = allRevisions.filter((r: any) => r.outcome.startsWith("skip_"))

    assert(nonSkip.length === 1,
      `Expected exactly 1 non-skip revision, got ${nonSkip.length}. Outcomes: ${allRevisions.map((r: any) => r.outcome).join(",")}`)
    assert(skipRows.length >= 1,
      `Expected >=1 skip revision row (attempts 2+), got ${skipRows.length}`)

    const skipAlreadyRevised = skipRows.filter((r: any) => r.outcome === "skip_already_revised")
    assert(skipAlreadyRevised.length >= 1,
      `Expected >=1 skip_already_revised row, got ${skipAlreadyRevised.length}`)

    return {
      name, pass: true,
      details: `novelId=${novelId}, non-skip revisions=1 (${nonSkip[0]?.outcome}), skip rows=${skipRows.length} (skip_already_revised=${skipAlreadyRevised.length})`,
    }
  } catch (e) {
    return { name, pass: false, error: String(e) }
  }
}

// ── Manual test stubs ────────────────────────────────────────────────────
function printManualTestInstructions(): void {
  console.log("\n[MANUAL] The following tests require human interaction and are NOT scripted:")
  console.log("")
  console.log("  R2 — Web-mode override (F6, F11)")
  console.log("    1. Set DEBUG_FORCE_PLAN_CHECK=fail on the orchestrator.")
  console.log("    2. POST /api/novel/start  { customSeed: <3ch seed>, mode: 'web' }")
  console.log("    3. Wait for Studio to show the plan-assist gate panel.")
  console.log("    4. POST /api/novel/:id/plan-assist/1/decide  { action: 'override' }")
  console.log("    5. Verify: chapter_outlines.plan_check_overridden=true,")
  console.log("       subsequent attempts log '[OVERRIDE] plan-check + validation-reviser skipped'.")
  console.log("    6. Restart the orchestrator mid-run, resume novel,")
  console.log("       confirm plan_check_overridden still true (F11 — persistence).")
  console.log("")
  console.log("  R3 — Web-mode edit-plan (F5)")
  console.log("    Same as R2 but decide body: { action: 'edit-plan', outline: { scenes: [...3 valid beats...] } }")
  console.log("    Verify: chapter_outlines.outline_json updated, chapter_exhaustions.decision='edit-plan'.")
  console.log("")
  console.log("  R4 — Web-mode abort (F7)")
  console.log("    Same trigger. Decide body: { action: 'abort' }")
  console.log("    Verify: novels.phase='drafting', activeRuns.has(novelId)=false,")
  console.log("    log line 'Chapter 1 aborted by user'.")
  console.log("")
  console.log("  R8 — UI/SSE panel (F9, F10)")
  console.log("    Open Studio in two browser tabs. Trigger a gate in one tab.")
  console.log("    Verify ExhaustionsPanel updates within 1s in the other tab.")
  console.log("    Open edit-plan panel; toggle structured <-> Raw JSON several times,")
  console.log("    verify no edits lost (F10).")
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\nExhaustion-handler test campaign`)
  console.log(`  Base: ${API_BASE}`)
  console.log(`  API key: ${API_KEY ? "set" : "(none)"}`)
  console.log(`  --assume-env: ${assumeEnv}`)
  console.log(`  --skip-env-tests: ${skipEnvTests}`)
  console.log()

  const results: TestResult[] = []

  // R0 always runs — no env flags needed
  if (runsThis("R0")) {
    console.log("Running R0...")
    results.push(await runR0_schemaSmoke())
  }

  if (!skipEnvTests) {
    if (runsThis("R1")) {
      console.log("Running R1 (requires DEBUG_FORCE_PLAN_CHECK=fail)...")
      results.push(await runR1_autoBailPlanCheck(assumeEnv))
    }
    if (runsThis("R5")) {
      console.log("Running R5 (requires DEBUG_FORCE_VALIDATION=pov)...")
      results.push(await runR5_validationPath(assumeEnv))
    }
    if (runsThis("R6")) {
      console.log("Running R6 (requires DEBUG_FORCE_PLAN_CHECK=fail + DEBUG_FORCE_REVISER=reject)...")
      results.push(await runR6_reviserRejected(assumeEnv))
    }
    if (runsThis("R7")) {
      console.log("Running R7 (requires DEBUG_FORCE_PLAN_CHECK=fail)...")
      results.push(await runR7_reviserSingleEscalation(assumeEnv))
    }
  } else {
    console.log("  [--skip-env-tests] Skipping R1/R5/R6/R7")
  }

  // Print results table
  console.log("\n─────────────────────────────────────────────────────────")
  console.log("TEST RESULTS")
  console.log("─────────────────────────────────────────────────────────")
  for (const r of results) {
    const icon = r.pass ? "PASS" : "FAIL"
    console.log(`  [${icon}] ${r.name}`)
    if (r.details) console.log(`        ${r.details}`)
    if (r.error)   console.log(`        ERROR: ${r.error}`)
  }
  console.log("─────────────────────────────────────────────────────────")
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  console.log(`  ${passed} passed, ${failed} failed`)

  printManualTestInstructions()

  if (failed > 0) {
    console.log("\nExiting 1 (failures present)")
    process.exit(1)
  }
  console.log("\nExiting 0 (all pass)")
}

main().catch(err => {
  console.error("Campaign runner crashed:", err)
  process.exit(1)
})
