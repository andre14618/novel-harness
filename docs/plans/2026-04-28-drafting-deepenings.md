---
ticket: drafting-deepenings
status: planning
created: 2026-04-28
codex-rounds: 4 (GREEN on round 4, agent thread `a125655226814600d`)
---

# Plan — drafting-layer deepenings

Concentrate three load-bearing pieces of structure currently spread across `src/phases/drafting.ts` and the writer/checker surfaces, plus a fourth deepening (debug-seam unification) that retires invariant #2 once the others land.

## Architecture vocabulary (per `improve-codebase-architecture` skill)

- **Module** — interface + implementation
- **Depth** — leverage at the interface
- **Seam** — where an interface lives
- **Adapter** — concrete satisfier at a seam
- **Deletion test** — would deleting concentrate complexity (load-bearing) or just move it (shallow)?

## Codex review lineage

| Round | Agent thread | Verdict | Outcome |
|-------|--------------|---------|---------|
| 1 | `a9ea255816118d32b` | Pushed back on 5 candidates | Killed Checker / BeatRewrite / move-orchestration; flagged ReviserPolicy as missed deepening |
| 2 | `adec32954690322dd` | Found 8 wrong calls + 1 missed deepening | Round-3 plan adds D4 (debug-seam unification), promotes ReviserPolicy ahead of SettleLoop |
| 3 | `ab676e0c0e325a617` | Found 5 fixes; D1+D2 ready, D3 needs 2 fixes, D4 splits | Round-4 plan: codify sequential-ascending `rewriteBeat` contract, add `onIteration` + `onSettleComplete`, split D4 into D4a/D4b |
| 4 | `a125655226814600d` | **GREEN** — converged | `exampleLines` typed as required; `logRevision` is also a callback alongside `persistAcceptedOutline` |

## Goal

Five commits, in order, on `autonomous-harness-loop` branch:

| Commit | Concern | Files | Risk gate |
|--------|---------|-------|-----------|
| **D1** | Typed `BeatContext` (slots + render seam) | `src/agents/writer/beat-context.ts`, new `beat-context-render.ts`, new `tests/beat-context-parity.test.ts` | Byte-parity test on ~20 representative fixtures; must remain in suite long-term |
| **D2** | `attemptRevision` policy module | new `src/phases/reviser-policy.ts`, edit `src/phases/drafting.ts` | Existing `drafting-reviser-escalation.test.ts` + `drafting-revision-used-persistence.test.ts` pass without changes |
| **D3** | `runSettleLoop` shell | new `src/phases/settle-loop.ts`, edit `src/phases/drafting.ts` | Same reviser tests pass; **invariant #2 stays live** |
| **D4a** | Migrate `forcePlanCheck` + `forceReviser` to V2 transport-interceptor | edit `src/phases/drafting.ts`, new V2 rule registrations in test/orchestrator code | V1 `forceValidation` guards stay; `src/config/debug-injection.ts` stays; invariant #2 stays |
| **D4b** | Generic deterministic-check interception layer; retire invariant #2 | TBD detailed design (deferred until D4a in production for one full-novel run) | Validation V1 migrated; `debug-injection.ts` deleted; invariant #2 removed; `docs/invariants.md` updated |

## Non-goals

- **No checker interface.** Codex round 1 killed it: the 7 "checkers" are not one stack; `runBeatChecks` aggregates only 3 beat-level checkers; chapter-plan-checker / continuity / validation have legitimately different shapes.
- **No `BeatRewrite` operation extraction.** Codex round 1: the prompt logic is already in `src/agents/writer/retry-context.ts:67-90`; the remaining duplication is subsumed by D3.
- **No moving `start/resume/redraft/tonal-pass` into `src/harness/`.** Codex round 1: routes own process-local run state, CLI-mode init, fire-and-forget pipeline spawn, in-process SSE emission. Wrong layer.
- **No new context levers in this charter** (`outline.characterStateChanges` / `knowledgeChanges` / voice-shaping integration). Each is a separate measured change AFTER D1 lands.
- **No retiring invariant #2 in D3.** Codex round 3: removing the safety net during the risky refactor throws away the structural property the AST check exists to enforce. Retirement happens in D4b, after V1 seam injection is fully gone.

## Exit criteria

Per commit:

1. `./ui/node_modules/.bin/tsc -p tsconfig.json --noEmit` green
2. `./ui/node_modules/.bin/tsc -p ui/tsconfig.json --noEmit` green
3. `bun build --target bun src/index.ts --outfile /tmp/index.js` green
4. `bun build --target bun src/orchestrator/server.ts --outfile /tmp/orchestrator.js` green
5. `bun test` green
6. `bun scripts/preflight.ts` green
7. Per-commit gate (see per-commit section below)
8. Codex implementation review verdict PASS (or PASS-WITH-MINOR on LOW findings)

## File slices

### D1 — Typed BeatContext (slots + render seam)

**Files**:
- EDIT `src/agents/writer/beat-context.ts`
- CREATE `src/agents/writer/beat-context-render.ts`
- CREATE `tests/beat-context-parity.test.ts`
- CREATE `tests/beat-context-fixtures/` (~20 fixtures, checked into git)

**Final interface** (Codex GREEN):

```ts
export interface BeatContext {
  beatSpec: BeatSpec
  transitionBridge: string | null
  landingTarget: string | null
  characterSnapshots: CharacterSnapshot[]
  resolvedReferencesText: string | null
  setting: SettingBlock | null
}

export interface BeatSpec {
  beatNumber: number; totalBeats: number; pov: string; setting: string; kind: string
  description: string; charactersPresent: string[]
  seeds: SeedLink[]; payoffsDue: PayoffDue[]
}

export interface CharacterSnapshot {
  name: string                 // required (type-system enforced)
  exampleLines: string[]       // required (empty array if none)
  voice?: string
  drives?: string
  avoids?: string
  conflict?: string
  state?: string
  withPov?: { trustLevel: string; dynamic: string; tension?: string }
  doesNotKnow?: string[]
}

export async function buildBeatContextSlots(input: BeatContextInput): Promise<BeatContext>
// ↑ owns ALL async/data selection: conditioning resolution via resolveWriterPack,
//   compact-vs-full async branching (compact = sync flatMap, full = Promise.all
//   over formatCharacterSnapshot which fetches getRelationshipBetween),
//   getCharacterStatesAtChapter lookups.

export function renderBeatContext(ctx: BeatContext, opts: { compact: boolean }): string
// ↑ pure deterministic string assembly; emits only fields present in slot data.
//   No async, no DB, no I/O.

// Existing public interface preserved (byte-parity gate ensures observable equivalence):
export async function buildBeatContext(input: BeatContextInput): Promise<BeatContextResult> {
  const ctx = await buildBeatContextSlots(input)
  return {
    userPrompt: renderBeatContext(ctx, { compact: !!input.compactMode }),
    targetWords: deriveTargetWords(input.outline),
  }
}
```

**Byte-parity gate**: ~20 fixtures checked into `tests/beat-context-fixtures/`. Diversity covers:
- compactMode true and false
- beat 0 (setting renders) vs beat N (setting skipped unless location change)
- with vs without prev beat (transition bridge)
- with vs without seeds, with vs without payoffsDue
- characters with full data, characters with sparse data, multi-character beats
- with vs without resolvedReferencesText

Test runs `buildBeatContextLegacy` (preserved) and `buildBeatContext` (new); asserts byte-equal `userPrompt` + equal `targetWords`. **Test stays in suite long-term as regression test** (not deleted after refactor lands).

**Risks**:
- Subtle whitespace from `sections.filter(Boolean).join("\n\n")` chained with nested `lines.join("\n")` and template literals — handle by precise sequencing of slot content + explicit join behavior in renderer.
- Conditional sections (setting-on-beat-0-only, bridge-only-if-prev-exists, location-change heuristic at `beat-context.ts:356-362`) move to slot construction (slot = null), not renderer.
- compactMode async-vs-sync branching is data-selection, not rendering — slot-builder owns the branch.

**Out of scope for D1 commit**:
- Wiring `outline.characterStateChanges` / `outline.knowledgeChanges` to writer (would break parity).
- Wiring `voice-shaping-prompts.ts` into production (typed slots ARE the integration surface; voice-shaping becomes `BeatContext → BeatContext` later via separate flag-gated commit).

---

### D2 — `attemptRevision` policy module

**Files**:
- CREATE `src/phases/reviser-policy.ts`
- EDIT `src/phases/drafting.ts` (collapse plan-check reviser path at lines 703-838 + validation reviser path at lines 1035-1159 to ~15-line call sites each)

**Final interface** (Codex GREEN):

```ts
export interface ReviserStrategy {
  buildReviserContext(outline: ChapterOutline, prose: string, issues: ReviserIssue[]): string
  telemetryLabel: "plan-check" | "validation"
}

export interface ReviserPolicyInput {
  novelId: string
  chapter: number
  attempt: number
  outline: ChapterOutline
  prose: string
  issues: ReviserIssue[]            // pre-normalized by caller
  rawDeviations: unknown[]          // for chapter_revisions logRevision payload
  strategy: ReviserStrategy
  eligibility: {
    revisionUsed: boolean
    lastUnresolvedSig: string | null
    canSettle: boolean
  }
  persistAcceptedOutline: (outline: ChapterOutline) => Promise<void>
  logRevision: (entry: RevisionLogEntry) => Promise<void>
}

export type ReviserOutcome =
  | { kind: "accepted"; revisedOutline: ChapterOutline }       // already persisted via callback
  | { kind: "rejected"; reason: "beat_floor" | "new_characters"; pendingExhaustion: PendingExhaustion }
  | { kind: "error"; pendingExhaustion: PendingExhaustion }
  | { kind: "ineligible"; reason: "already_revised" | "duplicate_sig" | "no_beat_state"; pendingExhaustion: PendingExhaustion }

/**
 * Caller contract: ALL failed settle outcomes from `runSettleLoop`
 * (exhausted, no-routing, ineligible) MUST funnel through this policy.
 * The policy module owns: revisionUsed write-before-call guard,
 * reviser LLM dispatch, sanity checks (beat floor, new characters),
 * chapter_revisions writes, pendingExhaustion construction. Caller
 * branches only on outcome.kind for restart/bail flow.
 */
export async function attemptRevision(input: ReviserPolicyInput): Promise<ReviserOutcome>
```

**Module owns**:
- `revisionUsed` write-before-call guard (the durable-inconsistency fix from `drafting.ts:706-717`)
- Reviser LLM call dispatch (via `callAgent` with `chapterPlanReviseSchema`)
- Sanity checks: beat floor (`Math.max(3, Math.ceil(targetWords / 300))`), no new characters
- `logRevision` call (injected) for `chapter_revisions` telemetry
- `persistAcceptedOutline` call (injected) on acceptance
- `pendingExhaustion` construction for all 4 non-accepted outcomes

**Stays out** (caller responsibility):
- `plan-assist` gate dispatch (`drafting.ts:1186-1215`, the consumer of pendingExhaustion)
- Settle loop (D3)
- Outline restart logic (caller branches on `outcome.kind === "accepted"` to restart with revised outline; otherwise bails to plan-assist with pendingExhaustion)

**Per-commit verification gate**: existing `drafting-reviser-escalation.test.ts` + `drafting-revision-used-persistence.test.ts` continue to pass without test edits. The policy module's behavior is reachable through the integrated drafting.ts surface those tests already exercise.

---

### D3 — `runSettleLoop` shell

**Files**:
- CREATE `src/phases/settle-loop.ts`
- EDIT `src/phases/drafting.ts` (collapse loops at lines 546-687 + 899-993 to ~10-line call sites each)

**Final interface** (Codex GREEN):

```ts
export interface SettleLoopInput<TCheckResult> {
  /** Run the check; arrives already-debug-wired by caller closure (no per-loop debug knobs). */
  check: () => Promise<TCheckResult>

  /** Pass discriminator. */
  isPass: (result: TCheckResult) => boolean

  /**
   * Map check failure to per-beat issue map. Empty map → SettleOutcome
   * { kind: "no-routing" } — distinct from exhaustion. The full result
   * is passed (not just flattened issues) so chapter-level fallback
   * heuristics (settings_match, emotional_arc_correct) can read their
   * own fields.
   */
  route: (result: TCheckResult) => Map<number, string[]>

  /**
   * Rewrite a single beat. Returns new prose or null if rejected.
   *
   * **CONTRACT (load-bearing):** invocations are ASCENDING beat-index
   * order, sequentially. Each rewrite reads upstream beat state (e.g.
   * beatProses[bi-1] for transition bridge) and the caller is expected
   * to mutate beatProses[bi] immediately after a non-null return so
   * subsequent rewrites in the same pass see the new state.
   * Parallel/out-of-order dispatch is NOT supported — it would break
   * this invariant. The loop enforces order; the caller's rewriteBeat
   * implementation must not introduce hidden parallelism.
   */
  rewriteBeat: (beatIndex: number, issues: string[]) => Promise<string | null>

  budget: number

  /** Hard precondition. False → SettleOutcome { kind: "ineligible" } without running. */
  canSettle: () => boolean

  /** Per-iteration telemetry: fires on initial check (passNumber=0) + every recheck. */
  onIteration?: (passNumber: number, result: TCheckResult) => Promise<void>

  /** Terminal hook: fires once when loop returns. */
  onSettleComplete?: (outcome: SettleOutcome<TCheckResult>) => Promise<void>
}

export type SettleOutcome<TCheckResult> =
  | { kind: "accepted"; passes: number; finalResult: TCheckResult }
  | { kind: "exhausted"; passes: number; finalResult: TCheckResult }   // budget hit
  | { kind: "no-routing"; passes: number; finalResult: TCheckResult }  // route returned empty
  | { kind: "ineligible" }                                              // canSettle() false at start

export async function runSettleLoop<TCheckResult>(input: SettleLoopInput<TCheckResult>): Promise<SettleOutcome<TCheckResult>>
```

**Module owns**: while-loop, budget bookkeeping, single recheck dispatch (debug-injection lives in caller's `check` closure, not in the loop), telemetry hook calls, ascending-order sequential rewrite dispatch.

**Stays out**: `routeValidationBlockers` heuristic, plan-check chapter-level fallback heuristics (settings_match, emotional_arc_correct mapping), reviser escalation, `pendingExhaustion` mutation, beat prose mutation (caller's `rewriteBeat` callback decides when to mutate `beatProses[bi]`).

**Plan-check adapter** (drafting.ts call site, ~10 lines):
```ts
const settleOutcome = await runSettleLoop<ChapterPlanCheckResult>({
  check: async () => inject.forcePlanCheck === "fail"
    ? { pass: false as const, deviations: [...synthetic...], setting_match: undefined, emotional_arc_correct: undefined }
    : (await callAgent({ agentName: "chapter-plan-checker", ... })).output,
  isPass: r => r.pass,
  route: r => routePlanCheckDeviations(r, outline),
  rewriteBeat: (bi, issues) => rewritePlanCheckBeat(bi, issues, /* closure context */),
  budget: pipeline.maxChapterPlanRewritePasses,
  canSettle: () => beatProses.length === outline.scenes.length,
  onIteration: (pass, r) => trace(novelId, { eventType: "plan-check-outcome", chapter: ch, payload: {...} }),
})
if (settleOutcome.kind !== "accepted") {
  // Forward to D2 attemptRevision per its caller contract
}
```

**Validation adapter** (analogous shape).

**Per-commit verification gate**: same reviser tests pass. **Invariant #2 (Seam-recheck symmetry) STAYS LIVE** — the AST check at `scripts/lint/invariants-check.ts:checkSeamRecheckSymmetry` continues to enforce the V1 seam discipline through D3. Retirement happens only after V1 seams are gone (D4b).

---

### D4a — Migrate `forcePlanCheck` + `forceReviser` to V2 transport-interceptor

**Files**:
- EDIT `src/phases/drafting.ts` (drop V1 guards at `:525-532, :658-666, :731-742, :1053-1064` for plan-check + reviser)
- EDIT existing tests that drive `DEBUG_FORCE_PLAN_CHECK` / `DEBUG_FORCE_REVISER` env vars (port to V2 rule registration via `registerInjection` from `src/debug/injection-store.ts`)

**Migration mappings**:

| V1 guard | V2 rule |
|----------|---------|
| `inject.forcePlanCheck === "fail"` | `force-result` on `agentName="chapter-plan-checker"`, `content` = JSON-encoded `{ pass: false, deviations: [{ description: "forced plan-check failure via debug-inject", beat_index: 0 }] }` matching `chapterPlanCheckSchema` |
| `inject.forceReviser === "throw"` | `force-error` on `agentName="chapter-plan-reviser"` with `errorName: "Error"`, `message: "forced reviser throw via debug-inject"` |
| `inject.forceReviser === "reject"` | `force-result` on `agentName="chapter-plan-reviser"`, `content` = JSON-encoded synthetic 1-beat plan matching `chapterPlanReviseSchema` |

**Stays through D4a**:
- `inject.forceValidation` guards at `drafting.ts:495-503` and `:970-983` (validation is deterministic, not LLM — V2 transport-interceptor can't reach it)
- `src/config/debug-injection.ts` (still serves the validation V1 guard)
- Invariant #2 (still scans `validateChapterDraft` call sites at `scripts/lint/invariants-check.ts:95-105`)

**Per-commit verification gate**: campaign tests R1/R6/R7 (per `docs/test-campaign-plan.md`) pass via V2 rule registration. Tests touching only `forceValidation` continue to pass via unchanged V1 path.

---

### D4b — Generic deterministic-check interception + retire invariant #2

**Files**:
- DESIGN: detailed interface for "deterministic-check interception layer" — explicitly NOT a synthetic-LLM-call wrapper (Codex Q7). Likely shape: a thin wrapper around chapter-level deterministic checks (`validateChapterDraft`) that consults a registry of injection rules keyed by check name + chapter + run id, returning either the real result or a synthetic `ValidationResult`. Detail produced just before D4b ships, after D4a observed in production for ≥1 full-novel run.
- EDIT `src/phases/validation.ts` (call new wrapper instead of bare `validateChapterDraft`)
- EDIT `src/phases/drafting.ts` (drop V1 guards at `:495-503, :970-983`)
- DELETE `src/config/debug-injection.ts`
- EDIT `scripts/lint/invariants-check.ts` (remove `checkSeamRecheckSymmetry`)
- EDIT `docs/invariants.md` (record retirement of #2)

**Per-commit verification gate**: campaign tests R5 (validation-driven exhaustion) pass via new layer. Invariant #2 removed from registry; preflight green.

**Constraint** (Codex Q7): the deterministic-check seam must replace V1 forceValidation BEFORE invariant #2 is removed. This is the only sequencing constraint inside D4b.

---

## Cross-cutting

### Branch
Continue on `autonomous-harness-loop`. All five commits land here; rebase/merge to `main` only after the full sequence is validated end-to-end on at least one full-novel run.

### Commit conventions
Per `docs/commit-conventions.md`. One concern per commit. Commit message bodies must include `docs-impact` line per `docs/current-state.md` "Same-commit update rule" — D1 changes the writer prompt assembly contract (testable via parity); D2 + D3 + D4a do not change runtime semantics (refactor only); D4b retires an invariant and changes a test interception mechanism.

### Tracked work
Each commit gets a `tuning_experiment` entry via `harness.experiments.createTuningExperiment("ticket", ...)` with `concludeExperiment` on commit. Per memory note "Always Record Experiments."

### Documentation
After each commit lands, spawn a Sonnet subagent (parallel with next commit's work) to update `docs/current-state.md` + append to `docs/lessons-learned.md` if a generalizable pattern emerged. Per memory note "Documentation Subagent."

## Linked context

- This plan: `docs/plans/2026-04-28-drafting-deepenings.md`
- Architecture skill output: this conversation
- Codex thread continuity: `a9ea255816118d32b` → `adec32954690322dd` → `ab676e0c0e325a617` → `a125655226814600d`
- Related: `docs/current-state.md` "Active Pipeline" section, "Retry / escalation flow"
- Codex prior follow-on flagging the V2 migration: `current-state.md` 2026-04-19 entry "V2 transport-interceptor (Codex ae23f96a5f5cf8247) as the durable replacement"
- Invariant #2 registry: `docs/invariants.md` entry #2 (Seam-recheck symmetry)
- Implementation order rationale: Codex round-3 Q13 (extract simpler module first → ReviserPolicy before SettleLoop)

## Open status

`status: planning` — awaits user sign-off before implementation begins. Codex GREEN on round 4 (all 14 round-2 questions + 5 round-3 fixes integrated). No further design-time blockers identified.
