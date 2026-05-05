/**
 * Generic targeted-rewrite settle loop.
 *
 * Concentrates the duplicated control flow that used to live inline in
 * `src/phases/drafting.ts` for both the plan-check rewrite path and the
 * validation rewrite path. Both paths follow the same shape:
 *
 *   1. Run a check.
 *   2. If it passes → done.
 *   3. If it fails → route the failure into a per-beat issue map, rewrite
 *      each affected beat with targeted guidance, re-run the check.
 *   4. Stop when (a) the check passes, (b) the per-pass budget is hit, or
 *      (c) the failure has no actionable per-beat routing.
 *
 * What this module owns:
 *
 *   - The while-loop and budget bookkeeping.
 *   - A SINGLE recheck dispatch site (debug-injection lives in the caller's
 *     `check` closure, not in the loop). This replaces the V1 "every recheck
 *     site needs its own debug guard" pattern enforced by invariant #2 —
 *     after this module is wired in for both call sites, the structural
 *     property is "by construction" rather than "AST-checked". The actual
 *     retirement of invariant #2 is deferred to D4b once the V1 seams are
 *     fully migrated to V2 transport-interception.
 *   - Sequential ascending-index dispatch of the per-beat rewriter. See the
 *     `rewriteBeat` JSDoc for the load-bearing contract.
 *
 * What it deliberately does NOT own (per Codex round-3 Q5/Q6):
 *
 *   - Per-checker routing heuristics (validation's POV-missing detection,
 *     plan-check's setting_match / emotional_arc_correct
 *     fallbacks, the "[validation] " issue prefix). All routing is the
 *     caller's `route` callback.
 *   - Reviser escalation. After `runSettleLoop` returns a non-accepted
 *     outcome, the caller funnels the result into `attemptRevision` per
 *     the D2 contract — see `src/phases/reviser-policy.ts`.
 *   - `pendingExhaustion` mutation, beat-prose mutation. The caller's
 *     `rewriteBeat` callback is responsible for mutating beatProses[bi]
 *     after a successful rewrite — the loop only orchestrates.
 *
 * See `docs/plans/2026-04-28-drafting-deepenings.md` (D3) for the
 * converged interface decisions and Codex review lineage.
 */

export interface SettleLoopInput<TCheckResult> {
  /**
   * Optional pre-computed initial result. When provided, the loop skips
   * its own initial `check()` call and uses this as `passNumber=0`.
   * Both production call sites today compute the initial result outside
   * (plan-check via `Promise.allSettled` parallel to continuity;
   * validation via a deterministic call before the if-block). Avoiding
   * a duplicate initial dispatch matters more for plan-check (an LLM
   * call) than validation (deterministic).
   *
   * If omitted, `check()` is invoked for the initial result too.
   */
  initialResult?: TCheckResult

  /**
   * Run the check. Caller's closure is responsible for any debug-injection
   * synthesis (the V1 `inject.forceXxx` short-circuits). When
   * `initialResult` is provided, this callback is invoked only for
   * rechecks (passNumber=1, 2, ...).
   */
  check: () => Promise<TCheckResult>

  /** Pass-or-fail discriminator over the check's result type. */
  isPass: (result: TCheckResult) => boolean

  /**
   * Map a failing check result to a per-beat issue map. Empty map →
   * `SettleOutcome { kind: "no-routing" }` (distinct from exhaustion;
   * the loop terminates immediately because the caller can't do anything
   * with the failure at the per-beat level). The full result is passed
   * (not just flattened issues) so chapter-level fallback heuristics
   * (settings_match, emotional_arc_correct) can read their own fields
   * out of `TCheckResult`.
   */
  route: (result: TCheckResult) => Map<number, string[]>

  /**
   * Rewrite a single beat. Returns the new prose string on success, or
   * `null` if the rewrite was rejected (e.g. <50 words, transport error
   * caught at the callback boundary).
   *
   * **CONTRACT (load-bearing):** invocations are ASCENDING beat-index
   * order, sequentially. Each rewrite reads upstream beat state (e.g.
   * the previous beat's prose for the transition bridge), and the caller
   * is expected to mutate `beatProses[bi]` immediately on a non-null
   * return so subsequent rewrites in the same pass see the new state.
   * Parallel/out-of-order dispatch is NOT supported — it would break
   * this invariant. The loop enforces order; the caller's `rewriteBeat`
   * implementation must not introduce hidden parallelism.
   */
  rewriteBeat: (beatIndex: number, issues: string[]) => Promise<string | null>

  /** Maximum recheck passes before the loop returns `exhausted`. */
  budget: number

  /**
   * Hard precondition. Evaluated once at loop entry. Returning `false`
   * yields `SettleOutcome { kind: "ineligible" }` without calling
   * `check`. Today's caller uses this to guard against the per-beat
   * state being unavailable (`beatProses.length !== outline.scenes.length`).
   */
  canSettle: () => boolean

  /**
   * Per-iteration telemetry hook for check results.
   *
   * - When `initialResult` is provided (caller computed the initial check
   *   externally), this fires only for rechecks: `passNumber=1, 2, …`.
   * - When `initialResult` is omitted (loop calls `check()` for the
   *   initial result too), this fires for the initial check too:
   *   `passNumber=0` for the initial result, `1, 2, …` for rechecks.
   *
   * Today's call sites both provide `initialResult` and hold the
   * initial-trace dispatch outside the loop (where it lives now), so this
   * hook covers only the per-recheck telemetry. Awaited so trace events
   * land in order.
   */
  onIteration?: (passNumber: number, result: TCheckResult) => Promise<void>

  /**
   * Per-pass pre-rewrite hook. Fires after `route()` produces a non-empty
   * `perBeat` map and BEFORE the per-beat rewriter dispatches. Used for
   * "starting settle pass N — rewriting K beats" log lines that need
   * both the pass number and the routed beat set. `passNumber` is the
   * 1-based pass count (1 for the first rewrite pass, 2 for the second,
   * etc.).
   */
  onPassStart?: (passNumber: number, perBeat: Map<number, string[]>) => Promise<void>

  /**
   * Terminal hook. Fires exactly once when the loop returns, with the
   * final outcome. Used for post-settle trace events that need to know
   * the terminal state (`accepted`, `exhausted`, `no-routing`,
   * `ineligible`).
   */
  onSettleComplete?: (outcome: SettleOutcome<TCheckResult>) => Promise<void>
}

export type SettleOutcome<TCheckResult> =
  /** The check passed (initial or after one or more rewrite passes). */
  | { kind: "accepted"; passes: number; finalResult: TCheckResult }
  /** Budget hit before the check passed. */
  | { kind: "exhausted"; passes: number; finalResult: TCheckResult }
  /** A failing check produced no per-beat routing — caller must escalate. */
  | { kind: "no-routing"; passes: number; finalResult: TCheckResult }
  /** `canSettle()` returned false at entry; loop never ran. */
  | { kind: "ineligible" }

/**
 * Run the settle loop. See module docstring for shape + ownership.
 *
 * Caller contract (per D2 docstring): all non-`accepted` outcomes MUST
 * be funneled through `attemptRevision`. This module does not enforce
 * that — it's the caller's job — but the type system makes the
 * branching explicit.
 */
export async function runSettleLoop<TCheckResult>(
  input: SettleLoopInput<TCheckResult>,
): Promise<SettleOutcome<TCheckResult>> {
  if (!input.canSettle()) {
    const outcome: SettleOutcome<TCheckResult> = { kind: "ineligible" }
    if (input.onSettleComplete) await input.onSettleComplete(outcome)
    return outcome
  }

  // Initial check (passNumber=0). Use the pre-computed `initialResult`
  // when provided to avoid a duplicate dispatch; otherwise call `check()`
  // and fire `onIteration(0, …)` so the caller can hook the initial-trace
  // dispatch in one place.
  const initialWasProvided = input.initialResult !== undefined
  let result = initialWasProvided ? (input.initialResult as TCheckResult) : await input.check()
  if (!initialWasProvided && input.onIteration) await input.onIteration(0, result)

  if (input.isPass(result)) {
    const outcome: SettleOutcome<TCheckResult> = { kind: "accepted", passes: 0, finalResult: result }
    if (input.onSettleComplete) await input.onSettleComplete(outcome)
    return outcome
  }

  let passNumber = 0
  while (!input.isPass(result) && passNumber < input.budget) {
    const perBeat = input.route(result)
    if (perBeat.size === 0) {
      const outcome: SettleOutcome<TCheckResult> = { kind: "no-routing", passes: passNumber, finalResult: result }
      if (input.onSettleComplete) await input.onSettleComplete(outcome)
      return outcome
    }

    passNumber++
    if (input.onPassStart) await input.onPassStart(passNumber, perBeat)

    // Sequential ascending-index dispatch (load-bearing — see rewriteBeat
    // JSDoc). Sort keys before iterating so the order is independent of
    // map insertion order.
    const sortedEntries = [...perBeat.entries()].sort(([a], [b]) => a - b)
    for (const [beatIndex, issues] of sortedEntries) {
      // We don't act on the rewriteBeat result here beyond what the
      // callback itself does. The callback is responsible for mutating
      // its own external prose store on success and for absorbing
      // transport errors.
      await input.rewriteBeat(beatIndex, issues)
    }

    // Single recheck dispatch site. Caller's `check` closure carries any
    // debug-injection synthesis that must replicate across initial + recheck.
    result = await input.check()
    if (input.onIteration) await input.onIteration(passNumber, result)
  }

  const outcome: SettleOutcome<TCheckResult> = input.isPass(result)
    ? { kind: "accepted", passes: passNumber, finalResult: result }
    : { kind: "exhausted", passes: passNumber, finalResult: result }
  if (input.onSettleComplete) await input.onSettleComplete(outcome)
  return outcome
}
