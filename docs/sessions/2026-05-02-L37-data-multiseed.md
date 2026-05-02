---
loop: L37-data
date: 2026-05-02
experiment: 361
result_doc: docs/l37-data-multiseed-2026-05-02.md
status: shipped
stop_condition: c
---

# L37-data — Multi-seed evidence for L37 design call (2026-05-02)

## Goal

Gather cross-seed evidence on (a) how often chapter-level continuity blockers fire on first attempt, and (b) whether the L31 stack continues to hold under different fantasy scenarios. Run two single-seed smokes back-to-back (`fantasy-system-heretic`, then `fantasy-inscription`), each 3 chapters with `--auto`, $4 budget per seed.

The L37 design call (set after L31d, exp #358) was between (i) adding a continuity-once retry path or (ii) documenting current routing as expected. The decision hinges on continuity-blocker fire rate across seeds.

## Outcome

**Stop condition: (c) — Mixed.** One seed (`fantasy-system-heretic`) bailed on chapter 1 attempt 3 with an **adherence beat blocker** (NOT continuity) — the writer failed to enact a specific obligated event across all three chapter retries. The other seed (`fantasy-inscription`) approved chapter 1 cleanly but bailed on chapter 2 attempt 2 with **3 deviations: 2 adherence beat blockers + 1 chapter-level continuity blocker** co-occurring. Across 6 chapters drafted, **only 1 chapter-level continuity blocker fired** (16% rate at chapter level).

The L31 stack itself held: zero L17/L22/L24/L26/L32 cluster regressions across both seeds. 6 stage-2-override events fired correctly across both novels (2 + 4).

| Cluster | fantasy-system-heretic | fantasy-inscription |
|---------|:---------------------:|:-------------------:|
| L17 | ✅ 0 fires | ✅ 0 fires |
| L22 | ✅ 0 fires | ✅ 0 fires |
| L24-(a) NER-only-warning exhaust | ✅ 33 fires all `pass: true` | ✅ 24 fires all `pass: true` |
| L24-(b) adherence stage-1 stochastic | ✅ 2 stage-2 overrides correct | ✅ 4 stage-2 overrides correct |
| L26/L32 mapper dup-FPs | ✅ 0 dup-FPs | ✅ 0 dup-FPs |
| L31d-(NEW) continuity blocker | ✅ 0 fires | ⚠ 1 fire (ch2 attempt 2, co-occurring with adherence) |

**Combined cost:** $0.1267 of $8 budget. 386 LLM calls, 0 failed.

## L37 Design Recommendation

**Option (ii) — document current routing as expected behavior in `docs/overnight-runbook.md`.**

Three reasons:
1. **Low fire rate.** 1 / 6 chapters at chapter-level continuity blocker.
2. **Continuity rarely the sole cause.** Of the 2 cross-seed continuity fires (counting L31d's `fantasy-debt`), only one was a SOLE blocker; `fantasy-inscription` ch2 had 2 co-occurring adherence blockers.
3. **The dominant halt class is adherence beat-blocker exhaustion, NOT continuity.** `fantasy-system-heretic` exhausted all 3 chapter-attempt retries on a single repeating adherence blocker (Beat 4 missing event) and had ZERO continuity issues across all 3 attempts.

The right next investment is **adherence-beat-blocker exhaustion handling** — a separate sprint, not L37. Worth probing why a single beat-level adherence blocker survives 3 writer retries without convergence.

## Pickup Instructions (if returning to this thread)

Two plan-assist gates remain pending:
- `fantasy-system-heretic` (`novel-1777709036403`) — ch1 attempt 3, plan-check-exhausted, 1 adherence deviation
- `fantasy-inscription` (`novel-1777710252345`) — ch2 attempt 2, plan-check-exhausted, 3 deviations (2 adherence + 1 continuity)

Either resolve via web UI with `action: "abort"`, or wait for the next overnight loop's `--stale-gates --min-age-hours 6` audit (L35) to auto-orphan them.

The L37 sprint should:
1. Update `docs/overnight-runbook.md` with the continuity-blocker → plan-assist halt section (template in result doc §"L37 Design Recommendation").
2. Close the L37 todo in `docs/todo.md`.
3. Open a new todo for **adherence-beat-blocker exhaustion investigation** (the actual dominant halt class). Specifically: probe why writer cannot enact "Maret considers destroying the file but reshelves it untouched because the System logs all accesses" across 3 chapter retries.

## What Went Well

- **Sequential smoke launches per `feedback_lxc_nohup_separate_ssh`.** Each seed had its own SSH+nohup launch with its own timestamped log. No process collisions.
- **Monitor with grep alternation per `feedback_short_checkback_cadence`.** Single Monitor task per smoke, ~120-180s effective cadence, terminal events captured exactly. No sleep-chains.
- **Telemetry pulled from DB (per `feedback_db_over_docs`).** `pipeline_events` for stage-2-override counts; `chapter_exhaustions` for halt details. Avoided re-parsing logs for structured fields.
- **Cost discipline.** Combined $0.1267 / $8 — 1.6% of budget across 6 chapters. Stack remains cheap.
- **Cross-seed verification of L31 stack.** Three different fantasy genres (debt-audit / system-heretic / inscription-magic) all had the same L17/L22/L24/L26/L32 cluster verifications pass. Strong evidence the stack generalizes.

## What Was Learned

- **The L31d-(NEW) continuity blocker did not generalize as the dominant halt class.** It fired in `fantasy-debt` and `fantasy-inscription` but NOT `fantasy-system-heretic`. The dominant remaining halt class is **adherence-beat-blocker chapter-attempt exhaustion**, which fires on both seeds (and was a recurring pattern in the L24 baseline as well).
- **Adherence beat blockers can survive all 3 chapter retries on the same beat.** `fantasy-system-heretic` ch1 had the same Beat 4 obligated-event-missing across all 3 attempts. The writer is consistently failing to enact "Maret considers destroying the file but reshelves it untouched because the System logs all accesses." This may be a writer-side refusal (DeepSeek avoids destructive intent narration), a beat-prompt issue (event description too abstract), or a beat-context issue (the obligation isn't being surfaced clearly in the beat brief). Worth a focused probe.
- **Two-stage adherence stage-2 calls don't always show in `llm_calls` but DO emit override events.** The operator-summary says `stage 2: 0` for both novels even though 6 `adherence-stage2-override` events landed in `pipeline_events`. The override events are the authoritative signal; the stage-2 LLM call counter in operator-summary is a heuristic and may undercount.
- **Beat-level fallback to chapter-level mode is a quiet path.** `fantasy-inscription` ch1 attempt 1 emitted "Beat generation incomplete, falling back to chapter-level..." mid-draft and produced a 1192-word chapter that approved cleanly. This is a separate code path from the beat-level writer. Worth knowing it exists and currently works.

## Lessons for `docs/lessons-learned.md`

Two candidate generalizable lessons:

1. **"When a single failure mode surfaces in one seed, gather cross-seed evidence before deciding whether to fix it as a class."** — L31d's continuity blocker on `fantasy-debt` looked like the new dominant halt class. Two-seed evidence showed it's seed-specific (1/6 chapters) and that the actual dominant class is something else (adherence-beat-blocker exhaustion, fired on both seeds).
2. **"Co-occurrence patterns matter for retry-class design."** — When a candidate retry path would only address one of multiple co-occurring blockers per chapter, its expected throughput improvement is bounded by the co-occurrence rate. `fantasy-inscription` ch2 had 3 deviations; a continuity-only retry would have left 2 adherence deviations unresolved and the chapter still in the plan-assist gate.

Will append both to `docs/lessons-learned.md` if not already present.

## Telemetry Quick-References

- Smoke 1 novel: `novel-1777709036403` (fantasy-system-heretic)
- Smoke 2 novel: `novel-1777710252345` (fantasy-inscription)
- Experiment: 361 (in `tuning_experiments`)
- Plan-assist gates pending: 2 (one per novel)
- Stage-2 overrides total: 6 (2 + 4)
- Smoke 1 log: `/tmp/smoke-l37-heretic-1777709036.log` (LXC)
- Smoke 2 log: `/tmp/smoke-l37-inscription-1777710251.log` (LXC)

## Commit Chain (this session)

- `[docs] L37-data — multi-seed smoke result + cluster verification (exp #361)`
- `[docs] L37-data — session retro + decisions.md`
