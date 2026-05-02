# L41 Validation — Chapter-Attempt Integrity Issue Carry-Over

**Date:** 2026-05-02
**Experiment:** #368
**Commit:** `78dc138 [drafting] L41 — carry chapter-attempt integrity issues into next attempt`
**Verdict:** Mechanistically + retroactively validated; live trigger pending.

## What L41 changed

Pre-L41, every chapter retry started the writer from a clean slate. The chapter-level prose-integrity check (`detectProseIntegrityIssues` — fused-boundary, camel-fusion, duplicate-sentence, duplicate-fragment, quote-integrity) would fail attempt N, log issues, and `continue` the chapter loop without communicating those issues to attempt N+1.

L41 captures the failed attempt's `{kind, excerpt}` issue list at the integrity-fail site in `src/phases/drafting.ts` (line 1281) into a chapter-scoped `priorIntegrityIssues` variable, then appends a formatted avoidance block to every beat-writer userPrompt in attempt N+1 via `formatChapterIntegrityRetryContext` (`src/agents/writer/retry-context.ts`). Issues clear on integrity pass. Cap of 12 issues per block; excerpts sliced to 200 chars; instruction text adds three positive-framed rules (clean boundaries, no verbatim repetition, paired-and-attributed quotes).

## Live exercise (heretic seed, novel-1777721066908)

- Chapter 1: integrity passed on attempt 1 (0 issues) → L41 no-op (working as designed).
- Chapter 2: bailed at plan-assist gate on attempt 1 with 5 continuity blockers — never reached the integrity check, so L41 didn't activate.
- **L41 was not exercised live in this smoke.** The trigger condition (chapter prose fails integrity → retry chapter) didn't occur on this seed.

## Mechanistic validation

The helper `formatChapterIntegrityRetryContext` is exhaustively unit-tested (`src/agents/writer/retry-context.test.ts`, 6 tests, all pass):
- Empty array → empty string
- Single issue → `--- AVOID THESE INTEGRITY ISSUES FROM YOUR PRIOR DRAFT ---` header + `- {kind}: "{excerpt}"` line + 3 instruction lines
- Multiple issues → all kinds appear in original order
- Long excerpts → sliced to 200 chars
- 50 issues → capped to 12 (excerpt-0..excerpt-11 in, excerpt-12 out)
- Whitespace-only padding around excerpts → trimmed

Wiring in `drafting.ts`:
- Declaration: chapter-scoped `let priorIntegrityIssues = []` (line 227)
- Application: `const resolvedUserPrompt = baseUserPrompt + formatChapterIntegrityRetryContext(priorIntegrityIssues)` (line 331)
- Capture on fail: `priorIntegrityIssues = proseIntegrityIssues.map(i => ({kind, excerpt}))` (line 1281)
- Clear on pass: `priorIntegrityIssues = []` (line 1291)

Mechanically, when integrity fails on attempt N, every beat-writer call in attempt N+1 sees the prior attempt's specific issues appended to its userPrompt. The behavior matches the design.

## Retroactive validation — the surprise finding

The `prose-integrity-check` event was added to drafting.ts in commit `275e031` (2026-04-30, two days pre-L41). All 17 events in `pipeline_events` represent the integrity-fail history during the pre-L41 window:

| novel:chapter | issue trajectory across attempts | direction |
|---------------|----------------------------------|-----------|
| novel-1777588579141:1 | 0 | pass — no retry |
| novel-1777591510985:1 | 1 → 2 | **regressed** |
| novel-1777596835809:1 | 3 | single attempt logged |
| novel-1777698707087:1 | 1 → 2 | **regressed** |
| novel-1777707348615:1 | 0 | pass — no retry |
| novel-1777709036403:1 | 1 → 8 | **regressed (sharply)** |
| novel-1777710252345:1 | 0 | pass — no retry |
| novel-1777710252345:2 | 2 | single attempt logged |
| novel-1777712370271:1 | 4 → 2 | converged |
| novel-1777719198533:1 | 3 → 2 → 1 | converged |
| novel-1777721066908:1 (today) | 0 | pass — no retry |

**Of 6 chapters with multi-attempt or single-fail history, 3 actually got *worse* on retry (50%).** One chapter went from 1 integrity issue to 8 — the writer drifted into more failures, not fewer, when given another stochastic shot without context.

This reframes L41's value:
- **Original motivation** (per L43-val notes): accelerate convergence (3→2→1 looked slow; targeting 3→0 in one retry).
- **Discovered motivation:** *prevent regression*. Without the prior-attempt issue list, the writer is sometimes blind to what just failed and can introduce *more* integrity issues on retry than they had before. The 1→8 case demonstrates the writer has no negative anchor pulling them away from the failure shape.

## What we still need

- **Live trigger validation:** A future smoke on a seed prone to integrity failures (e.g., fast-paced action, dense dialogue) needs to hit the L41 path and demonstrate that attempt 2's issue count is non-increasing relative to attempt 1. Until that lands, the "L41 prevents regression" claim is theoretical.
- **Convergence rate baseline:** Pre-L41 had 2/6 converging chapters in 1-2 retries. Post-L41 we want to show a higher convergence rate AND a lower mean issue count at attempt 2.

## Decision

L41 ships as deployed. The mechanistic and retroactive evidence is strong enough to keep it in production: zero downside (no-op on chapters that pass on attempt 1, which is the dominant case), positive-framed prompt addition (no priming-suppression risk), bounded prompt growth (~500 chars max), and a clear theory of why pre-L41 retries were sometimes regressing.

A future seed-targeted smoke is queued to obtain the live activation evidence; not blocking on it because (a) the chapter integrity gate is already operational and (b) L41 is purely additive — its worst case is identical to pre-L41 behavior on chapters that pass on attempt 1.

## Cluster surfaced for next sprint

The heretic seed (`novel-1777721066908`) bailed chapter 2 at the plan-assist gate on **5 continuity blockers**, all of the form "Maret's internal monologue treats X as new discovery, contradicting prior chapter state." This is a planned-state-vs-prose-execution mismatch — the planner placed Maret in a state that the chapter 2 dramatization contradicts. Likely L38 territory (writer prior-chapter state propagation) or a planning-layer state-update bug. Queued as the next sprint after L41 doc closure.
