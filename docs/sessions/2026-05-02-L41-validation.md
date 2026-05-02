# Session 2026-05-02 — L41 Validation

**Sprint:** L41 chapter-attempt prose-integrity issue carry-over
**Experiment:** #368
**Implementation commit:** `78dc138 [drafting] L41 — carry chapter-attempt integrity issues into next attempt`
**Validation outcome:** Mechanistic + retroactive validated; live trigger pending.

## What I shipped

- `src/agents/writer/retry-context.ts` — added `formatChapterIntegrityRetryContext(issues)` helper that emits a positive-framed `--- AVOID THESE INTEGRITY ISSUES FROM YOUR PRIOR DRAFT ---` block listing each `{kind, excerpt}` with cap 12 / excerpt slice 200 chars.
- `src/agents/writer/retry-context.test.ts` — 6 unit tests (empty, single, multi-with-order, long-excerpt-cap, 12-issue-cap, whitespace-trim) all pass.
- `src/phases/drafting.ts` — chapter-scoped `priorIntegrityIssues` declaration, append at beat-write site, populate at integrity-fail, clear at integrity-pass.
- `docs/l41-validation-2026-05-02.md` — full result doc with mechanistic + retroactive evidence.
- `docs/decisions.md` — §L41 design decision + §L41-validation entries appended.
- `docs/lessons-learned.md` — new lesson "Stochastic retries can regress, not just converge" capturing the surprise finding.
- `docs/todo.md` — L41 closed; L41-live-trigger queued; new dominant cluster (L38 chapter-2 continuity) opened.

## What I learned

- **The retroactive surprise.** I expected to see 3→2→1 convergence everywhere. The data showed 3/6 multi-attempt chapters actually REGRESSED on retry (1→2, 1→2, 1→8). Pre-L41, the writer had no negative anchor pulling them away from the failed shape, and stochastic redrafts could drift into *more* failure modes. L41's primary value is regression prevention, not convergence acceleration.
- **Live-trigger validation is hard when fix is purely additive.** L41 only fires when chapter prose fails integrity → retries chapter. The heretic re-smoke didn't hit that path: ch1 passed integrity attempt 1, ch2 bailed on continuity at plan-assist before reaching the integrity check. The right framing is: mechanistic + retroactive evidence is sufficient for an additive fix; live-trigger validation is a "nice to have" queued for a seed-targeted future smoke.
- **Issue-trajectory queries should precede retry-context design.** Before designing L41, I should have queried per-attempt issue counts on past data. The data would have told me to frame success as "attempt N+1 ≤ attempt N" rather than "attempt N+1 → 0." Captured as a lesson in lessons-learned.

## Cluster ladder advance

| Sprint | Status | Bail cluster surfaced after |
|--------|--------|----------------------------|
| L31a/L39/L40/L42/L43 | shipped + validated this session | each surfaced the next cluster within a single re-smoke |
| L41 | shipped, mechanistic+retroactive validated | revealed 3/6 chapters regressed pre-L41 (surprise) |
| L41-live-trigger | queued (additive, not blocking) | requires integrity-prone seed |
| L38 / continuity-state-propagation | NEW dominant cluster | L41-val ch2 bailed on 5 "Maret treats X as new discovery, contradicting prior chapter state" continuity blockers |

The cluster ladder shifts again: writer-discipline rules (L42, L43) were saturating; L41 was retry-context infrastructure; the next cluster (L38) is planning-vs-execution state propagation — yet another infrastructure layer.

## Pickup notes for next session

1. **L38 investigation candidate cluster.** Audit `src/phases/drafting.ts` and the brief-builder for chapter 2: does the brief receive Maret's chapter-1-derived state? Compare against `chapter_summaries` and `chapter_outlines` rows for `novel-1777721066908`. Is the planner re-deriving wrong? Is the writer ignoring? Both?
2. **Optional: L41 live trigger.** Pick a seed known to produce wall-of-text or fused-boundary issues (high-action / dense dialogue) and run a 3-chapter smoke. Verify that attempt 2's prose-integrity issue count is ≤ attempt 1's.
3. **Don't lose the regression-prevention framing.** The lessons-learned entry captures this; refer to it when designing future retry-context interventions for other checkers (continuity, adherence, halluc).

## Files touched (single commit `78dc138`, separate doc commit pending)

```
src/agents/writer/retry-context.ts        (helper added)
src/agents/writer/retry-context.test.ts   (6 tests)
src/phases/drafting.ts                    (3 sites: declare, append, populate, clear)
```

Doc commit (this commit):
```
docs/l41-validation-2026-05-02.md         (new)
docs/decisions.md                         (+§L41, §L41-validation)
docs/lessons-learned.md                   (+regression lesson)
docs/todo.md                              (L41 closed, L41-live-trigger + L38 queued)
docs/sessions/2026-05-02-L41-validation.md (this file)
```
