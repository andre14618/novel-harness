#!/usr/bin/env bun
/**
 * Exhaustion-handler web-mode test campaign runner.
 * See docs/test-campaign-plan.md §R2, §R3, §R4.
 *
 * Covers the three WEB-MODE decision paths that require programmatic gate
 * resolution via the plan-assist decide route:
 *   R2 — override    (plan_check_overridden persisted, no second gate fires)
 *   R3 — edit-plan   (outline replaced in chapter_outlines, DB telemetry matches)
 *   R4 — abort       (novel stops at drafting phase, no post-abort beat-writer activity)
 *
 * Usage:
 *   bun scripts/test/exhaustion-web-campaign.ts [--assume-env] [--base=URL] [--api-key=KEY]
 *
 * Options:
 *   --assume-env   Assume DEBUG_FORCE_PLAN_CHECK=fail is already set on the
 *                  orchestrator. Required for all three tests to proceed.
 *   --base=URL     Orchestrator base URL. Default: $ORCHESTRATOR_URL or http://localhost:3006
 *   --api-key=KEY  API key. Default: $ORCHESTRATOR_API_KEY
 *
 * Note: F11 (override persistence across orchestrator restart) is NOT scripted —
 * that sub-test requires a manual orchestrator restart mid-run. Codex flagged
 * it as unsafe to automate (in-memory gate state is lost across restarts and
 * timing is non-deterministic). Run it manually as described in docs/test-campaign-plan.md.
 */

import db from "../../src/db/connection"

// ── CLI flags ────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const assumeEnv = args.includes("--assume-env")
const baseArg   = args.find(a => a.startsWith("--base="))
const keyArg    = args.find(a => a.startsWith("--api-key="))

const API_BASE = baseArg ? baseArg.slice("--base=".length) : (process.env.ORCHESTRATOR_URL ?? "http://localhost:3006")
const API_KEY  = keyArg  ? keyArg.slice("--api-key=".length) : (process.env.ORCHESTRATOR_API_KEY ?? "")

// ── Types ────────────────────────────────────────────────────────────────
interface TestResult {
  name: string
  pass: boolean
  details?: string
  error?: string
}

// ── Minimal test seed (3 chapters, 500w target) ──────────────────────────
function makeTestSeed(label: string) {
  return {
    title: `test-exhaustion-web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    premise: `A lone ranger named ${label} crosses a dying land to deliver a message that may end a war.`,
    genre: "fantasy",
    chapterCount: 3,
    characters: [
      { name: label, role: "protagonist", description: "A weathered courier who trusts only the road." },
      { name: "Marshal Vex", role: "supporting", description: "Commander of the eastern border garrison." },
    ],
    targetWordsPerChapter: 500,
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

// Poll novel state until active===false.
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

// Poll novel state until pendingPlanAssist is non-null (gate open).
async function waitForGate(novelId: string, timeoutMs = 90_000): Promise<any> {
  return waitFor(
    async () => {
      const r = await apiGet(`/api/novel/${novelId}/state`)
      if (!r.ok) return null
      const state = await r.json() as any
      return state.pendingPlanAssist !== null ? state : null
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

// ── Shared env-check guard ───────────────────────────────────────────────
function requireEnv(testName: string): TestResult | null {
  if (!assumeEnv) {
    return {
      name: testName,
      pass: false,
      error: "[SKIP] Set DEBUG_FORCE_PLAN_CHECK=fail on the orchestrator process and rerun with --assume-env",
    }
  }
  return null
}

// ── R2 — Web-mode override ────────────────────────────────────────────────
async function runR2_webOverride(): Promise<TestResult> {
  const name = "R2 — web-mode override (DEBUG_FORCE_PLAN_CHECK=fail, action=override)"
  const skip = requireEnv(name)
  if (skip) return skip

  try {
    const seed = makeTestSeed("Rynn")
    const novelId = await startNovel(seed, "web")
    console.log(`  [R2] novel=${novelId}, waiting for gate...`)

    // Gate opens when plan-check is exhausted after the settle loop
    const stateAtGate = await waitForGate(novelId, 90_000)
    assert(stateAtGate.pendingPlanAssist !== null, "pendingPlanAssist should be set when gate opens")
    assert(stateAtGate.pendingPlanAssist.chapter === 1,
      `Expected gate for chapter 1, got chapter=${stateAtGate.pendingPlanAssist.chapter}`)

    // Submit override decision
    const decideR = await apiPost(`/api/novel/${novelId}/plan-assist/1/decide`, { action: "override" })
    assert(decideR.ok, `decide returned ${decideR.status}: ${await decideR.text()}`)
    const decideBody = await decideR.json() as any
    assert(decideBody.ok === true, `decide response ok not true: ${JSON.stringify(decideBody)}`)
    assert(decideBody.action === "override", `Expected action=override in response, got: ${decideBody.action}`)

    // DB: plan_check_overridden should now be true
    const outlineRows = await db`
      SELECT plan_check_overridden FROM chapter_outlines
      WHERE novel_id = ${novelId} AND chapter_number = 1
    ` as any[]
    assert(outlineRows.length > 0, "No chapter_outlines row found for chapter 1")
    assert(outlineRows[0].plan_check_overridden === true,
      `Expected plan_check_overridden=true, got: ${outlineRows[0].plan_check_overridden}`)

    // DB: chapter_exhaustions decision should be 'override'
    const exhRows = await db`
      SELECT decision FROM chapter_exhaustions
      WHERE novel_id = ${novelId}
    ` as any[]
    assert(exhRows.length >= 1, `Expected >=1 chapter_exhaustions row, got ${exhRows.length}`)
    const overrideRow = exhRows.find((r: any) => r.decision === "override")
    assert(overrideRow !== undefined,
      `Expected decision='override' in chapter_exhaustions, found: ${exhRows.map((r: any) => r.decision).join(",")}`)

    // Wait for novel to finish (or hit maxDraftAttempts) — gate resolved,
    // plan-check skipped, approval gate should open then auto-advance or idle
    console.log(`  [R2] override submitted, waiting for novel to settle...`)
    await waitForIdle(novelId, 120_000)

    // Final guard: exactly ONE chapter_exhaustions row — no second gate fire
    const exhFinal = await db`
      SELECT COUNT(*)::int AS cnt FROM chapter_exhaustions WHERE novel_id = ${novelId}
    ` as any[]
    assert(exhFinal[0].cnt === 1,
      `Expected exactly 1 exhaustion row (no second gate fire), got: ${exhFinal[0].cnt}`)

    return {
      name, pass: true,
      details: `novelId=${novelId}, plan_check_overridden=true, decision=override, exhaustion_count=1`,
    }
  } catch (e) {
    return { name, pass: false, error: String(e) }
  }
}

// ── R3 — Web-mode edit-plan ───────────────────────────────────────────────
async function runR3_webEditPlan(): Promise<TestResult> {
  const name = "R3 — web-mode edit-plan (DEBUG_FORCE_PLAN_CHECK=fail, action=edit-plan)"
  const skip = requireEnv(name)
  if (skip) return skip

  try {
    const seed = makeTestSeed("Kaela")
    const novelId = await startNovel(seed, "web")
    console.log(`  [R3] novel=${novelId}, waiting for gate...`)

    const stateAtGate = await waitForGate(novelId, 90_000)
    assert(stateAtGate.pendingPlanAssist !== null, "pendingPlanAssist should be set when gate opens")
    assert(stateAtGate.pendingPlanAssist.chapter === 1,
      `Expected gate for chapter 1, got chapter=${stateAtGate.pendingPlanAssist.chapter}`)

    // The payload carries the current outline — use it as the base for the replacement
    const existingOutline = stateAtGate.pendingPlanAssist.payload?.outline ?? null

    // Build a valid replacement outline: keep chapterNumber, title, setting,
    // povCharacter, charactersPresent from the original; replace scenes with
    // 4 new beats that satisfy the beat floor.
    // Beat floor = Math.max(3, Math.ceil(targetWords / 300)) per the spec.
    // With targetWordsPerChapter=500 → Math.ceil(500/300)=2 → max(3,2)=3.
    // We use 4 beats to give a clear margin above the floor.
    const targetWords = existingOutline?.targetWords ?? 500
    const beatFloor = Math.max(3, Math.ceil(targetWords / 300))
    const beatCount = Math.max(4, beatFloor)

    const replacementScenes = Array.from({ length: beatCount }, (_, i) => ({
      description: `R3 replacement beat ${i + 1}: Kaela advances toward the garrison.`,
      characters: existingOutline?.charactersPresent ?? ["Kaela"],
      kind: "action" as const,
      requiredPayoffs: [],
    }))

    const replacementOutline = {
      chapterNumber: 1,
      title: existingOutline?.title ?? "Chapter 1",
      povCharacter: existingOutline?.povCharacter ?? "Kaela",
      setting: existingOutline?.setting ?? "the borderlands",
      purpose: existingOutline?.purpose ?? "establish protagonist",
      scenes: replacementScenes,
      targetWords: existingOutline?.targetWords ?? 500,
      charactersPresent: existingOutline?.charactersPresent ?? ["Kaela"],
      establishedFacts: [],
      characterStateChanges: [],
      knowledgeChanges: [],
    }

    // Submit edit-plan decision
    const decideR = await apiPost(`/api/novel/${novelId}/plan-assist/1/decide`, {
      action: "edit-plan",
      outline: replacementOutline,
    })
    assert(decideR.ok, `decide returned ${decideR.status}: ${await decideR.text()}`)
    const decideBody = await decideR.json() as any
    assert(decideBody.ok === true, `decide response ok not true: ${JSON.stringify(decideBody)}`)
    assert(decideBody.action === "edit-plan", `Expected action=edit-plan in response, got: ${decideBody.action}`)

    // DB: chapter_outlines.outline_json should now have the replacement scenes
    const outlineRows = await db`
      SELECT outline_json FROM chapter_outlines
      WHERE novel_id = ${novelId} AND chapter_number = 1
    ` as any[]
    assert(outlineRows.length > 0, "No chapter_outlines row found for chapter 1")
    const savedOutline = outlineRows[0].outline_json
    const savedSceneCount = Array.isArray(savedOutline?.scenes) ? savedOutline.scenes.length : -1
    assert(savedSceneCount === replacementScenes.length,
      `Expected ${replacementScenes.length} scenes in saved outline, got ${savedSceneCount}`)

    // DB: chapter_exhaustions.decision='edit-plan' and decision_details matches
    const exhRows = await db`
      SELECT decision, decision_details FROM chapter_exhaustions
      WHERE novel_id = ${novelId}
    ` as any[]
    assert(exhRows.length >= 1, `Expected >=1 chapter_exhaustions row, got ${exhRows.length}`)
    const editRow = exhRows.find((r: any) => r.decision === "edit-plan")
    assert(editRow !== undefined,
      `Expected decision='edit-plan' in chapter_exhaustions, found: ${exhRows.map((r: any) => r.decision).join(",")}`)
    // decision_details JSONB should reflect the submitted outline (check scenes length)
    const detailsSceneCount = Array.isArray(editRow.decision_details?.scenes)
      ? editRow.decision_details.scenes.length
      : -1
    assert(detailsSceneCount === replacementScenes.length,
      `Expected decision_details.scenes.length=${replacementScenes.length}, got ${detailsSceneCount}`)

    // ── Semantic guard sub-test: empty scenes → 400 ──────────────────────
    // Use a FRESH novel so the gate is open when we submit the invalid body.
    // We do NOT wait for this novel to fully finish — just need the gate open.
    console.log(`  [R3] testing empty-scenes semantic guard...`)
    const seed2 = makeTestSeed("Vael")
    const novelId2 = await startNovel(seed2, "web")
    console.log(`  [R3] guard novel=${novelId2}, waiting for gate...`)
    await waitForGate(novelId2, 90_000)

    // Fetch the outline from state to build a structurally-valid but empty-scenes body
    const guardStateR = await apiGet(`/api/novel/${novelId2}/state`)
    const guardState = await guardStateR.json() as any
    const guardOutline = guardState.pendingPlanAssist?.payload?.outline ?? {}

    const badBody = {
      action: "edit-plan",
      outline: {
        chapterNumber: 1,
        title: guardOutline.title ?? "Chapter 1",
        povCharacter: guardOutline.povCharacter ?? "Vael",
        setting: guardOutline.setting ?? "the road",
        purpose: guardOutline.purpose ?? "introduce protagonist",
        scenes: [],    // ← semantic guard should reject this
        targetWords: 500,
        charactersPresent: guardOutline.charactersPresent ?? ["Vael"],
        establishedFacts: [],
        characterStateChanges: [],
        knowledgeChanges: [],
      },
    }

    const badR = await apiPost(`/api/novel/${novelId2}/plan-assist/1/decide`, badBody)
    assert(badR.status === 400,
      `Expected 400 for empty-scenes body, got ${badR.status}`)
    const badBody2 = await badR.json() as any
    const errText = (badBody2.error ?? "").toLowerCase()
    assert(errText.includes("at least one beat"),
      `Expected error mentioning "at least one beat", got: ${badBody2.error}`)

    // Abort the guard novel so it doesn't linger
    await apiPost(`/api/novel/${novelId2}/plan-assist/1/decide`, { action: "abort" })

    return {
      name, pass: true,
      details: `novelId=${novelId}, scenes_in_outline=${savedSceneCount}, decision=edit-plan, ` +
               `decision_details_scenes=${detailsSceneCount}; guard 400 test passed`,
    }
  } catch (e) {
    return { name, pass: false, error: String(e) }
  }
}

// ── R4 — Web-mode abort ───────────────────────────────────────────────────
async function runR4_webAbort(): Promise<TestResult> {
  const name = "R4 — web-mode abort (DEBUG_FORCE_PLAN_CHECK=fail, action=abort)"
  const skip = requireEnv(name)
  if (skip) return skip

  try {
    const seed = makeTestSeed("Dael")
    const novelId = await startNovel(seed, "web")
    console.log(`  [R4] novel=${novelId}, waiting for gate...`)

    const stateAtGate = await waitForGate(novelId, 90_000)
    assert(stateAtGate.pendingPlanAssist !== null, "pendingPlanAssist should be set when gate opens")
    assert(stateAtGate.pendingPlanAssist.chapter === 1,
      `Expected gate for chapter 1, got chapter=${stateAtGate.pendingPlanAssist.chapter}`)

    // Record the timestamp just before abort so we can check for post-abort LLM calls
    const abortIssuedAt = new Date().toISOString()

    // Submit abort decision
    const decideR = await apiPost(`/api/novel/${novelId}/plan-assist/1/decide`, { action: "abort" })
    assert(decideR.ok, `decide returned ${decideR.status}: ${await decideR.text()}`)
    const decideBody = await decideR.json() as any
    assert(decideBody.ok === true, `decide response ok not true: ${JSON.stringify(decideBody)}`)
    assert(decideBody.action === "abort", `Expected action=abort in response, got: ${decideBody.action}`)

    // Poll until active===false
    console.log(`  [R4] abort submitted, waiting for novel to stop...`)
    const finalState = await waitForIdle(novelId, 60_000)
    assert(finalState.active === false, "Novel should be inactive after abort")

    // phase should still be 'drafting' (not advanced past it)
    assert(finalState.phase === "drafting",
      `Expected phase='drafting' after abort, got: '${finalState.phase}'`)

    // DB: chapter_exhaustions.decision = 'abort'
    const exhRows = await db`
      SELECT decision FROM chapter_exhaustions
      WHERE novel_id = ${novelId}
    ` as any[]
    assert(exhRows.length >= 1, `Expected >=1 chapter_exhaustions row, got ${exhRows.length}`)
    const abortRow = exhRows.find((r: any) => r.decision === "abort")
    assert(abortRow !== undefined,
      `Expected decision='abort' in chapter_exhaustions, found: ${exhRows.map((r: any) => r.decision).join(",")}`)

    // Confirm no beat-writer LLM calls arrived after the abort decision was issued.
    // Use decided_at from the chapter_exhaustions row for the authoritative timestamp.
    const decidedAtRows = await db`
      SELECT decided_at FROM chapter_exhaustions
      WHERE novel_id = ${novelId} AND decision = 'abort'
      LIMIT 1
    ` as any[]
    const decidedAt = decidedAtRows.length > 0
      ? new Date(decidedAtRows[0].decided_at).toISOString()
      : abortIssuedAt

    const postAbortCalls = await db`
      SELECT COUNT(*)::int AS cnt
      FROM llm_calls
      WHERE novel_id = ${novelId}
        AND agent = 'beat-writer'
        AND timestamp > ${decidedAt}
    ` as any[]
    assert(postAbortCalls[0].cnt === 0,
      `Expected 0 post-abort beat-writer calls, got: ${postAbortCalls[0].cnt}`)

    return {
      name, pass: true,
      details: `novelId=${novelId}, phase=drafting, decision=abort, post_abort_beat_writer_calls=0`,
    }
  } catch (e) {
    return { name, pass: false, error: String(e) }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\nExhaustion-handler web-mode test campaign (R2 / R3 / R4)`)
  console.log(`  Base: ${API_BASE}`)
  console.log(`  API key: ${API_KEY ? "set" : "(none)"}`)
  console.log(`  --assume-env: ${assumeEnv}`)
  console.log()

  if (!assumeEnv) {
    console.log("  [NOTE] All three tests require DEBUG_FORCE_PLAN_CHECK=fail on the orchestrator.")
    console.log("         Set the env var on the orchestrator process and rerun with --assume-env.")
    console.log()
  }

  const results: TestResult[] = []

  // Sequential execution — all three tests talk to the same orchestrator process.
  // Running in parallel risks gate-state confusion (two concurrent web-mode novels
  // both opening plan-assist gates against the same in-process gates map).
  console.log("Running R2 (web-mode override)...")
  results.push(await runR2_webOverride())

  console.log("Running R3 (web-mode edit-plan)...")
  results.push(await runR3_webEditPlan())

  console.log("Running R4 (web-mode abort)...")
  results.push(await runR4_webAbort())

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

  if (failed > 0) {
    console.log("\nExiting 1 (failures present)")
    process.exit(1)
  }
  console.log("\nExiting 0 (all pass)")
}

main().catch(err => {
  console.error("Web campaign runner crashed:", err)
  process.exit(1)
})
