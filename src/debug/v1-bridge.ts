/**
 * V1-to-V2 debug-injection bridge.
 *
 * Translates the legacy `DEBUG_FORCE_PLAN_CHECK` / `DEBUG_FORCE_REVISER`
 * env-var seams (read inline at the drafting.ts call sites in the V1
 * implementation) into equivalent V2 transport-interceptor rules. Called
 * once at orchestrator startup.
 *
 * Why this module exists:
 *
 *   - The architectural goal of D4a is to remove the inline short-circuits
 *     from `src/phases/drafting.ts` so plan-check + reviser interception
 *     lives in ONE place (the transport interceptor) instead of two
 *     (transport + drafting.ts). See `docs/plans/2026-04-28-drafting-deepenings.md` D4a.
 *   - The existing campaign-test harness (`scripts/test/exhaustion-campaign.ts`,
 *     R1/R6/R7) drives forced failures by setting V1 env vars on the
 *     orchestrator process. Porting those tests to register V2 rules per
 *     run via HTTP POST is a separate workflow. The bridge preserves the
 *     env-var ergonomics so the test campaign keeps working without edits
 *     while the inline V1 short-circuits in drafting.ts are removed.
 *
 * Scope:
 *
 *   - Translates `DEBUG_FORCE_PLAN_CHECK=fail` → force-result on
 *     `chapter-plan-checker` (synthetic failing schema-shaped JSON).
 *   - Translates `DEBUG_FORCE_REVISER=throw` → force-error on
 *     `chapter-plan-reviser`.
 *   - Translates `DEBUG_FORCE_REVISER=reject` → force-result on
 *     `chapter-plan-reviser` with a 1-scene plan (below the 3-scene floor,
 *     so the reviser-policy scene-count sanity check rejects it; this is
 *     what R6 asserts: `gate:plan-assist kind="reviser-rejected"`).
 *   - DOES NOT translate `DEBUG_FORCE_VALIDATION` — V2 cannot reach the
 *     deterministic validation pipeline. That guard stays at V1 until
 *     D4b lands the deterministic-check interception layer (see plan).
 *
 * Master-gate ergonomics:
 *
 *   The transport interceptor is gated on `DEBUG_ENABLE_INJECTION=true`.
 *   When ANY `DEBUG_FORCE_PLAN_CHECK` / `DEBUG_FORCE_REVISER` value is
 *   present, this bridge auto-sets `process.env.DEBUG_ENABLE_INJECTION =
 *   "true"` for the lifetime of the orchestrator process so the
 *   translated rules actually fire. Setting a V1 force flag is a clear
 *   operator intent; requiring a separate flag would silently break
 *   pre-D4a workflows.
 *
 * Rule shape choices:
 *
 *   - `exhaustAfter`: 10_000. The campaign tests run 1 chapter and expect
 *     forced failures across multiple attempts × multiple plan-check
 *     passes. Using `Number.MAX_SAFE_INTEGER` would mask a regression in
 *     the rule lifecycle (we'd rather see the test fail than have an
 *     infinite-fire bug go unnoticed). 10k is well above the largest
 *     plausible test run.
 *   - `ttlMs`: 24h. Same rationale — campaigns are minutes, but giving
 *     the rule a calendar-sized lifetime mirrors the "set env var, leave
 *     it set" V1 ergonomic.
 *
 * Failure mode: this module never throws. A bad env value is logged and
 * skipped so the orchestrator boot is not coupled to bridge correctness.
 */

import { registerInjectionRule } from "./injection-store"

/** Used in note + log output so operators can grep the boot logs. */
const BRIDGE_LABEL = "v1-bridge"

/** Long lifetime — see module docstring. */
const LONG_TTL_MS = 24 * 60 * 60 * 1000
const EXHAUST_LARGE = 10_000

export interface BridgeReport {
  /** Number of V2 rules registered. */
  translated: number
  /** Human-readable summaries (one per translation), for boot-log emission. */
  reasons: string[]
  /** True if the master gate was auto-enabled by this bridge call. */
  enabledMasterGate: boolean
}

/**
 * Inspect process.env for V1 debug-force flags and register equivalent
 * V2 rules. Idempotent in the sense that registering twice yields two
 * rules — but the orchestrator only calls this once at boot.
 */
export function applyV1EnvVarsAsV2Rules(): BridgeReport {
  const reasons: string[] = []
  let translated = 0
  let enabledMasterGate = false

  const planCheck = process.env.DEBUG_FORCE_PLAN_CHECK
  const reviser = process.env.DEBUG_FORCE_REVISER

  // Auto-enable the master gate if any V1 force flag is set. See module
  // docstring §"Master-gate ergonomics" for the rationale.
  const anyV1Set =
    planCheck === "fail" ||
    reviser === "throw" ||
    reviser === "reject"

  if (anyV1Set && process.env.DEBUG_ENABLE_INJECTION !== "true") {
    process.env.DEBUG_ENABLE_INJECTION = "true"
    enabledMasterGate = true
  }

  if (planCheck === "fail") {
    // chapterPlanCheckSchema (src/agents/chapter-plan-checker/schema.ts)
    // requires `pass: boolean` and `deviations: ChapterPlanDeviation[]`
    // (defaults to []). `setting_match` and `emotional_arc_correct` are
    // optional. The single beat-indexed deviation routes the failure into
    // a per-beat rewrite at beat 0, mirroring V1 behavior.
    const content = JSON.stringify({
      pass: false,
      deviations: [
        {
          description: "forced plan-check failure via DEBUG_FORCE_PLAN_CHECK=fail (v1-bridge)",
          beat_index: 0,
        },
      ],
    })
    registerInjectionRule({
      note: `${BRIDGE_LABEL}: DEBUG_FORCE_PLAN_CHECK=fail`,
      match: { agentName: "chapter-plan-checker" },
      action: { kind: "force-result", content },
      exhaustAfter: EXHAUST_LARGE,
      ttlMs: LONG_TTL_MS,
    })
    translated++
    reasons.push("DEBUG_FORCE_PLAN_CHECK=fail → force-result on chapter-plan-checker")
  }

  if (reviser === "throw") {
    registerInjectionRule({
      note: `${BRIDGE_LABEL}: DEBUG_FORCE_REVISER=throw`,
      match: { agentName: "chapter-plan-reviser" },
      action: {
        kind: "force-error",
        errorName: "Error",
        message: "forced reviser throw via DEBUG_FORCE_REVISER=throw (v1-bridge)",
      },
      exhaustAfter: EXHAUST_LARGE,
      ttlMs: LONG_TTL_MS,
    })
    translated++
    reasons.push("DEBUG_FORCE_REVISER=throw → force-error on chapter-plan-reviser")
  } else if (reviser === "reject") {
    // chapterScenePlanSchema requires `scenes: SceneBeat[]`; sceneBeatSchema
    // requires only `description`. All other fields default. One scene
    // is below the calibrated scene-count floor of 3, so the reviser-policy module
    // rejects this with reason="beat_floor"
    // and emits the `gate:plan-assist kind="reviser-rejected"` event.
    const content = JSON.stringify({
      scenes: [
        {
          description: "forced single-beat plan via DEBUG_FORCE_REVISER=reject (v1-bridge)",
        },
      ],
      establishedFacts: [],
      characterStateChanges: [],
      knowledgeChanges: [],
    })
    registerInjectionRule({
      note: `${BRIDGE_LABEL}: DEBUG_FORCE_REVISER=reject`,
      match: { agentName: "chapter-plan-reviser" },
      action: { kind: "force-result", content },
      exhaustAfter: EXHAUST_LARGE,
      ttlMs: LONG_TTL_MS,
    })
    translated++
    reasons.push("DEBUG_FORCE_REVISER=reject → force-result on chapter-plan-reviser")
  }

  return { translated, reasons, enabledMasterGate }
}
