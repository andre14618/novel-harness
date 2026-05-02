---
loop: L37-data
status: shipped
created: 2026-05-02
experiment: 361
phase_eval_run: none
---

# L37-data — Multi-seed evidence for L37 design call (continuity-blocker handling)

## Summary

L37-data ran two back-to-back single-seed smokes (`fantasy-system-heretic`, then `fantasy-inscription`) against the L31 stack to measure (a) how often chapter-level continuity blockers fire on first attempt across fantasy seeds, and (b) whether the L31 stack continues to hold under different scenarios. The L31d run on `fantasy-debt` (exp #358) had surfaced a chapter-level continuity blocker on chapter 2 attempt 1 (ledger color), which routes directly to the plan-assist gate. The L37 design call is whether to (i) add a continuity-once retry path or (ii) document current routing as expected.

**Headline:** Across 6 chapters drafted (2 seeds × 3 chapters), only chapter 2 of `fantasy-inscription` hit a chapter-level continuity blocker (1 / 6 fire rate). `fantasy-system-heretic` halted at chapter 1 attempt 3 on a different exhaustion path — the **adherence checker blocker** (Beat 4 missing event), which DID exhaust all three chapter-attempt retries. `fantasy-inscription` chapter 2 attempt 2 also produced two adherence beat blockers in addition to the continuity blocker — the continuity blocker was not the sole cause.

**Stop condition: (c) — Mixed.** One seed bailed on continuity (mixed with adherence); the other bailed on adherence-only (no continuity blocker fired anywhere in 3 attempts). The L31 stack itself held: zero L17/L22/L24/L26/L32 cluster regressions across both seeds. The dominant remaining halt class is **the adherence beat blocker** (`[beat-check:adherence] Beat N: Beat event missing`) — fires on both seeds — not continuity (fires on 1/2 seeds, only 1/6 chapters).

**L37 recommendation:** **Option (ii) — document current routing.** Continuity blockers fire rarely (1/6 chapters); a continuity-once retry path would only have helped `fantasy-inscription` chapter 2 (and even there only after the adherence blockers were resolved, since both fired together). The dominant halt class is **adherence beat blockers exhausting all three chapter-attempt retries** — a separate problem class that would not be addressed by a continuity-only retry. Recommend documenting current routing in `docs/overnight-runbook.md` and queuing a separate sprint to investigate adherence-blocker exhaustion.

## Acceptance Check

| Criterion | Result |
|-----------|--------|
| 6/6 chapters draft cleanly | ❌ fantasy-system-heretic 0/3 (ch1 exhausted attempts), fantasy-inscription 1/3 (ch1 approved, ch2 plan-assist) |
| L17 cluster regressions | ✅ 0 across both seeds |
| L22 cluster regressions | ✅ 0 across both seeds |
| L24-(a) NER-only-warning exhaust regressions | ✅ 0 across both seeds |
| L24-(b) adherence stage-1 variance regressions | ✅ 0 across both seeds (6 stage-2 overrides correctly fired) |
| L26/L32 mapper dup-FPs | ✅ 0 across both seeds |
| Continuity-blocker fire rate (chapters) | 1 / 6 chapters fired chapter-level continuity blocker (16%) |
| Total cost < $8 budget | ✅ $0.1267 across both seeds (1.6% of budget) |

## Per-Seed Results

| Seed | Novel ID | Chapters complete | Halt reason | Cost | LLM calls (failed/retried) |
|------|----------|-------------------|-------------|------|----------------------------|
| fantasy-system-heretic | `novel-1777709036403` | 0 / 3 | ch1 attempt 3 — `plan-check-exhausted` (1 deviation: beat 3 adherence — Beat 4 event missing) | $0.0619 | 200 (0 / 52) |
| fantasy-inscription | `novel-1777710252345` | 1 / 3 | ch2 attempt 2 — `plan-check-exhausted` (3 deviations: 2 beat-9 adherence, 1 chapter-level continuity) | $0.0648 | 186 (0 / 38) |

**Combined:** 6 chapters scoped, 1 chapter approved (`fantasy-inscription` ch1, 1192 words on attempt 1, used chapter-level fallback when beats failed to generate). Total cost $0.1267.

## Cluster Verification (per seed)

### fantasy-system-heretic (smoke 1)

| Cluster | Verification | Pass |
|---------|--------------|:----:|
| L17 (Brennan/Aldric/Sorcerer's Tower/etc.) | 0 fires across 51 halluc-ungrounded calls | ✅ |
| L22 (T.C./Guildmaster/derived titles) | 0 fires across 51 halluc-ungrounded calls | ✅ |
| L24-(a) NER-only-warning exhaust | 33 NER-only events (65%), all returned `pass: true` (per L31a); zero retries burned by NER-only path | ✅ |
| L24-(b) adherence stage-1 stochastic variance | 2 `adherence-stage2-override` events fired correctly (per L31c) | ✅ |
| L26/L32 mapper allowedNewEntities dup-FPs | 0 dup-FPs across 3 mapper calls (per L32) | ✅ |
| L31d-(NEW) chapter-level continuity blocker | 0 chapter-level continuity blockers fired across 3 attempts of ch1 | ✅ (no fire) |

**Halt mechanism:** All three chapter-1 attempts produced complete 13-beat drafts. Plan check passed all three times. Continuity passed all three times. The halt was driven by an **adherence beat blocker on beat 3** that survived all three writer retries: `[beat-check:adherence] Beat 4: Beat event missing: Maret considers destroying the file but reshelves it untouched because the System logs all accesses`. After attempt 3 the adherence blocker was bundled into `pendingExhaustion` (`kind: plan-check-exhausted`) and routed to the plan-assist gate. This is the existing chapter-attempt-retry exhaustion path.

### fantasy-inscription (smoke 2)

| Cluster | Verification | Pass |
|---------|--------------|:----:|
| L17 (Brennan/Aldric/Sorcerer's Tower/etc.) | 0 fires across 50 halluc-ungrounded calls | ✅ |
| L22 (T.C./Guildmaster/derived titles) | 0 fires across 50 halluc-ungrounded calls | ✅ |
| L24-(a) NER-only-warning exhaust | 24 NER-only events (48%), all returned `pass: true` (per L31a); zero retries burned by NER-only path | ✅ |
| L24-(b) adherence stage-1 stochastic variance | 4 `adherence-stage2-override` events fired correctly (per L31c) | ✅ |
| L26/L32 mapper allowedNewEntities dup-FPs | 0 dup-FPs across 3 mapper calls (per L32) | ✅ |
| L31d-(NEW) chapter-level continuity blocker | **1 chapter-level continuity blocker fired on ch2 attempt 2** (Calla had-already-cut state divergence) | ⚠ FIRED |

**Halt mechanism:** Chapter 1 approved on attempt 1 (1192 words; beat generation fell back to chapter-level mode mid-draft). Chapter 2 attempt 1 produced a 7311-word draft; plan-check passed; continuity-state flagged 1 warning (Orvath-knowledge violation) — the chapter retried. Chapter 2 attempt 2 produced another 7311-word draft (same length); plan-check passed; continuity-state escalated to a chapter-level blocker (`The draft shows Calla hesitating before making any cut, contradicting the fact that she had already made the first cut`) PLUS two beat-9 adherence blockers. The plan-assist gate fired with three deviations bundled into one `chapter_exhaustions` row.

## AND-Gate Matrix Comparison

| Decision | fantasy-system-heretic | fantasy-inscription | L24 baseline (debt) | L31d (debt) |
|----------|------------------------|---------------------|---------------------|-------------|
| pass | 16 (31%) | 21 (42%) | — | 23 (57%) |
| ner-only-warning | 33 (65%) | 24 (48%) | — | 9 (23%) |
| ner+llm-blocker | 2 (4%) | 3 (6%) | — | 4 (10%) |
| llm-only-blocker | 0 | 2 (4%) | — | 4 (10%) |
| **TOTAL** | **51** | **50** | — | **40** |

`fantasy-system-heretic` had the highest NER-only-warning rate (65%) of any smoke so far. Critically, all 33 events returned `pass: true` per L31a — zero retry budget consumed by NER-only-warning. `fantasy-inscription` is closer to `fantasy-debt` baseline shape.

## Two-Stage Adherence

| Seed | stage-1 calls | stage-2 calls | stage-2 overrides |
|------|---------------|---------------|-------------------|
| fantasy-system-heretic | 63 | 0 (per operator-summary; see note) | 2 |
| fantasy-inscription | 58 | 0 (per operator-summary; see note) | 4 |

**Note:** `operator-summary --latest` reports `stage 2: 0` even though `pipeline_events` has 6 `adherence-stage2-override` events across both novels. The L36 fix (commit `43721cf`) splits stages by `system_prompt` prefix, but neither smoke recorded any `agent='adherence-events'` calls with the stage-2 prompt prefix in `llm_calls` — likely because stage-2 only runs when stage-1 returns `events_present: false` AND the override fires inside the stage-2 wrapper. The override event count (2 + 4 = 6) is the accurate figure. This is consistent with L31d.

**Stage-2-override events total: 6** (2 in fantasy-system-heretic, 4 in fantasy-inscription).

Sample override stage-1 reasons (truncated):
- `fantasy-system-heretic` ch1 beat 4 attempt 2: "trembling hands and spilling ink, but she does not start over"
- `fantasy-inscription` ch1 beat 4 attempt 1: "the prose shows her freezing, staring..."
- `fantasy-inscription` ch2 beat 13 attempt 1: "the prose enacts Davan shivering and the barrier flickering, but does not show Calla explicitly realizing she must choose"

All 6 overrides match the L31c design intent: stage-2 found all `obligated_events` enacted; stage-1's binary verdict was overridden.

## Continuity-Blocker Frequency

**Fire rate: 1 / 6 chapters (16%)** at chapter level.

Per-attempt continuity outcomes:

| Seed | Chapter | Attempt 1 continuity | Attempt 2 continuity | Attempt 3 continuity |
|------|---------|----------------------|----------------------|----------------------|
| fantasy-system-heretic | 1 | no issues | no issues | no issues |
| fantasy-system-heretic | 2 | (not reached) | — | — |
| fantasy-system-heretic | 3 | (not reached) | — | — |
| fantasy-inscription | 1 | no issues (approved) | — | — |
| fantasy-inscription | 2 | 1 issue (warning, retry) | **1 blocker (halt)** | — |
| fantasy-inscription | 3 | (not reached) | — | — |

The single chapter-level continuity blocker fired on `fantasy-inscription` ch2 attempt 2 — a state-history violation (Calla shown hesitating to make first cut after the prior beat had her already make it). Importantly, this blocker fired ALONGSIDE two beat-9 adherence blockers — so a continuity-once retry would only have addressed 1 of the 3 deviations, not closed the chapter independently.

The L31d (`fantasy-debt`) continuity fire on chapter 2 attempt 1 was a SOLE continuity blocker (no co-occurring adherence blockers). That makes the cross-seed picture: 2 chapters across 3 seeds had a chapter-level continuity blocker (fantasy-debt ch2, fantasy-inscription ch2), one with co-occurring adherence blockers and one without.

## L37 Design Recommendation

**Option (ii) — document current routing as expected.**

Rationale:
1. **Low fire rate.** 1 / 6 chapters fired the chapter-level continuity blocker on first attempt in this evidence-gathering window. Even counting L31d's `fantasy-debt` ch2 blocker, the cross-seed rate is 2 / 9 chapters (~22%) including `fantasy-debt` re-tested data — but `fantasy-debt` is the same seed that surfaced the issue, so it inflates the rate.
2. **Continuity is rarely the sole cause.** Of the 2 cross-seed continuity fires, one (`fantasy-inscription` ch2) had two co-occurring adherence blockers; only `fantasy-debt` ch2 was a sole continuity blocker. A continuity-once retry would not have closed `fantasy-inscription` ch2 because the adherence blockers would have remained.
3. **The dominant halt class is adherence-beat-blocker exhaustion, NOT continuity.** `fantasy-system-heretic` exhausted all three chapter-attempt retries on a single repeating adherence blocker (Beat 4 missing event) and had ZERO continuity issues. This is a different problem class than the continuity-once retry would address. The right next sprint targets why an adherence beat blocker can survive 3 writer retries on the same beat.
4. **Implementation cost asymmetry.** Option (i) requires (a) reviser-class wiring for continuity descriptions, (b) deciding which continuity severities trigger retry vs. immediate halt, (c) test coverage. Option (ii) is a docs change. Given the 1/6 fire rate and the co-occurrence pattern, Option (ii) ships immediate operator clarity at near-zero cost.

**Implementation for Option (ii):** add a section to `docs/overnight-runbook.md` titled "Continuity-blocker plan-assist halts" describing:
- The exhaustion path (`drafting.ts:1116-1133` / `buildCheckerBlockerDeviations`)
- That continuity blockers route directly to plan-assist on first attempt
- Recommended operator response (edit outline OR override OR abort)
- Heuristics for distinguishing real planner→prose state divergence vs. transient writer hallucination

**Future sprint candidate (NOT L37):** investigate adherence-beat-blocker exhaustion. `fantasy-system-heretic` ch1 had the same beat-4 adherence blocker survive three writer retries — the writer is consistently failing to enact a specific obligated event ("Maret considers destroying the file but reshelves it untouched because the System logs all accesses"). This may be a writer-side issue (DeepSeek refuses to surface the destructive consideration) or a beat-prompt issue (the obligated event is too abstract for the current beat-context format). Worth a focused probe.

## Cost Summary

| Seed | Cost | LLM calls |
|------|------|-----------|
| fantasy-system-heretic | $0.0619 | 200 |
| fantasy-inscription | $0.0648 | 186 |
| **TOTAL** | **$0.1267** | **386** |

Combined cost is 1.6% of the $8 budget. The L31 stack remains cost-disciplined.

## Conclusion

L37-data confirms the L31 stack continues to hold across two new fantasy seeds with zero L17/L22/L24/L26/L32 regressions. The chapter-level continuity blocker that L31d surfaced on `fantasy-debt` did not generalize — `fantasy-system-heretic` had no continuity issues; `fantasy-inscription` had one continuity blocker but co-occurred with adherence blockers. The dominant remaining halt class is **adherence-beat-blocker chapter-attempt exhaustion**, not chapter-level continuity.

**L37 recommendation:** Option (ii) — document the continuity-blocker → plan-assist routing as expected behavior in `docs/overnight-runbook.md`. The continuity-once retry path (Option (i)) does not match the observed failure shape; the right next investment is adherence-blocker exhaustion handling, which is a separate sprint.

Stop condition: **(c) — Mixed**. Continuity fired on one seed; adherence-blocker exhaustion fired on the other.
