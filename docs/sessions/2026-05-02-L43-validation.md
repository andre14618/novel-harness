---
loop: L43-validation
date: 2026-05-02
experiment: 367
result_doc: docs/l43-validation-2026-05-02.md
status: shipped
stop_condition: b
---

# L43-validation — Heretic re-smoke after verbal-action enactment rule (2026-05-02)

## Goal

Validate the L43 verbal-action enactment rule (commit `091eaa3`, +1 line in both beat-writer prompts) by re-smoking `fantasy-system-heretic` 3 chapters. Acceptance: ch1 doesn't bail on adherence FN where writer dramatized physical equivalent instead of obligated verbal exchange.

## Outcome

**Stop condition: (b) — NEW out-of-scope cluster found** (L41 prose-integrity instability surfaced as solo bail cluster).

L43 SOLIDLY VALIDATED. **Zero adherence checker blockers fired across all 3 chapter attempts** (vs 2 fires in L42-val that caused the bail). Plan check, continuity, and adherence all PASSED on every attempt. Chapter exhausted retry budget purely on prose-integrity failures (L41 cluster, was already queued).

| Metric | L42-val | L43-val | Delta |
|---|---|---|---|
| Adherence checker blockers (chapter-bailing) | 2 | **0** | -100% |
| Halluc llm-only-blocker (chapter-bailing) | 0 | 0 | unchanged |
| L40 rescues | 1 | 1 | unchanged |
| Halluc ner+llm-blocker (beat-level, retried) | 0 | 2 (resolved) | beat retry working |
| Bail cluster | adherence FN (verbal-vs-physical) | L41 prose-integrity | DIFFERENT |
| Bail code path | plan-assist gate | chapter-attempts-exhausted | DIFFERENT |
| Integrity convergence | n/a (bailed earlier) | 3 → 2 → 1 | trending toward 0 |

## Pickup Instructions (if returning to this thread)

L43 is shipped + validated. The pending novel `novel-1777719198533` is in `chapter-attempts-exhausted:ch1` state — can be resumed with `bun src/index.ts --resume novel-1777719198533` if needed for further investigation, or left for L35 stale-gates audit cleanup.

Next loop candidates (in priority order):

1. **L41 — Prose-integrity retry instability.** Now THE dominant heretic bail cluster. L43-val ch1 bailed at chapter-attempts-exhausted with integrity convergence 3 → 2 → 1 issues across 3 attempts. Two top remediation options: (a) pass integrity issue descriptions back to writer in next-attempt prompt (analogous to existing adherence retry context in `retry-context.ts`); (d) bump chapter retry budget 3 → 5 (band-aid). Recommend (a) first. **HIGH PRIORITY** — only remaining bail cluster after L31/L39/L40/L42/L43 close their respective clusters.

2. **L38 — Writer prior-chapter state propagation.** From L31d / L37-data continuity-blocker pattern. Lower priority than L41 since L43-val continuity passed cleanly.

## What Went Well

- **Fourth +1-line prompt rule in a row that produces measurable cluster-class shift.** L42 closed walk-on-entity cluster (blocker → warning shift). L43 closes verbal-action adherence cluster (blocker count: 2 → 0). Two prompt rules at 1 line each have closed the two dominant writer-side bail clusters surfaced over L40-validation + L42-validation.
- **Beat-level halluc retry path proves robust.** 2 ner+llm-blocker events fired during L43-val (writer invented locations + characters), and both resolved on beat-level retry without needing chapter-level escalation. Confirms the AND-gate retry logic works end-to-end when writer compliance is partial.
- **Validation through 3-attempt exhaustion + telemetry.** Letting the chapter run all 3 attempts gives a much richer signal than bailing after 1. The 3 → 2 → 1 prose-integrity convergence is itself diagnostic information for the next sprint (L41).
- **Cluster ladder progress is systematic.** L31/L39/L40/L42/L43 stack now closes 5 distinct heretic-class bail clusters. Each fix was small, well-scoped, and validated via direct A/B against the prior bail point.

## What Was Learned

- **Bail-mode code paths split: plan-assist vs chapter-attempts-exhausted.** L42-val bailed via plan-assist (per-beat retry exhausted → operator gate). L43-val bailed via chapter-attempts-exhausted (chapter-level retry budget exhausted). Different code paths, both terminal. The plan-assist path requires operator action; the chapter-attempts-exhausted path just halts. Worth understanding which is preferable for which failure class.
- **The cluster ladder will eventually run out of writer-side prompt rules.** L42 + L43 = 2 rules, both 1 line. Adding more rules will eventually saturate or contradict each other. The next cluster (L41 prose integrity) is structurally different — not a writer-discipline gap but a lint-fixer / retry-context limitation. Cheapest fix shifts to the retry-context layer.
- **Convergence trends are diagnostic.** 3 → 2 → 1 integrity issues across attempts means the writer IS making progress, just running out of attempts. This is different from "writer is making no progress" (where integrity stays at 3 → 3 → 3) or "writer is regressing" (where it goes 3 → 4 → 5). The convergence trend tells you which fix is needed.

## Lessons for `docs/lessons-learned.md`

One candidate generalizable lesson:

1. **"Cluster ladders shift the dominant bail cluster predictably."** L40 → L42 → L43 → L41. Each close exposes the next bottleneck in the dependency stack. By the time you've closed 5 clusters in a row, you have strong evidence about which class of fix the next sprint should target. Plan the ladder; don't chase clusters opportunistically.

Will append to `docs/lessons-learned.md` in the L43-validation commit.

## Telemetry Quick-References

- L43-val novel: `novel-1777719198533`
- Experiment: 367 (L43, in `tuning_experiments`, conclusion shipped)
- Chapter 1 exhausted at attempt 3/3 on prose integrity
- Halluc calls: 39 (19 pass / 18 ner-only-warning / 2 ner+llm-blocker / 0 llm-only-blocker)
- L40 rescue events: 1
- Adherence checker blockers (chapter-bailing): 0
- Smoke log: `/tmp/smoke-l43val-heretic-1777719198.log` (LXC)
- L42-val comparison novel: `novel-1777718105222`

## Commit Chain (this session)

- `091eaa3 [writer] L43 — verbal-action obligation enactment rule for beat brief dialogue`
- `[docs] L43-validation — heretic re-smoke validates verbal-action rule closes adherence FN cluster (exp #367)` (this commit)
