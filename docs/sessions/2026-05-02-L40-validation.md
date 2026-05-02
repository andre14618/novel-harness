---
loop: L40-validation
date: 2026-05-02
experiment: 365
result_doc: docs/l40-validation-2026-05-02.md
status: shipped
stop_condition: b
---

# L40-validation — Heretic re-smoke after NER post-filter ship (2026-05-02)

## Goal

Validate the L40 NER post-filter (commit `d356443`, `src/agents/halluc-ungrounded/index.ts`) by re-smoking `fantasy-system-heretic` 3 chapters. Acceptance: ch1 attempt 3 does not bail on `Ungrounded entity "System"` llm-only-blocker.

## Outcome

**Stop condition: (b) — NEW out-of-scope cluster found.**

L40 fix VALIDATED via mechanistic + retroactive analysis: at the exact L39-val bail point (`ch1 b1 a3 [System]`), `isNerGrounded("System", surface)` returns true via tier-1 (per-token shard) AND tier-3 (normalize). 100% of L39-val LLM-only-blocker entities (3/3) would be rescued by L40. 0% of genuine `ner+llm-blocker` entities are touched.

The current L40-val novel did not stochastically trigger the `System` case (writer prose was different — the LLM never disagreed on a grounded entity in the 19 halluc calls). Bailed at chapter 1 plan-assist on a NEW cluster: the writer invented unsanctioned named entities for scene-setting at beat 4 (`Journeyman Veth`, `Senior Scribe Haldor`, `Chronicle of Northern Incursions`).

| Metric | Value |
|---|---|
| L39-val retroactive rescue rate | 3/7 (43%) |
| L40-val live rescue events | 0 (writer didn't trigger disagreement) |
| AND-gate `pass` rate (L40-val ch1) | 13/19 (68%) |
| Spurious L40 rescues | 0 |
| Bail cluster | NEW: writer-invented unsanctioned entities (planner-writer interface gap) |

## Pickup Instructions (if returning to this thread)

L40 is shipped + validated. The pending plan-assist gate on `novel-1777716659610` (ch1, beat 3 attempt 3 with 4 unresolved issues) can be left for the next loop's L35 stale-gates audit (`--min-age-hours 6`) to auto-orphan after threshold.

Next loop candidates (in priority order):

1. **L42 — Writer-side discipline for unsanctioned named entities.** Candidate fix: instruct the writer (in beat-writer prompt) to use generic descriptors (`a junior scribe`, `a senior records ledger`) for ambient walk-on entities not in `allowedNewEntities`. Lower-cost alternative to (b) planner pre-budgeting or (c) lint-fixer rewriting. Acceptance: heretic re-smoke ch1 doesn't bail on writer-invented junior-character / document names that lack planner sanction. **HIGH PRIORITY** — this is now the dominant heretic bail cluster after L39 + L40 close their respective clusters.

2. **L41 — Investigate prose-integrity retry instability.** L37-data + L39-val both hit prose integrity early. This run did NOT (chapter prose passed integrity on attempt 1) — possibly because the chapter was different stochastically, or because integrity issues simply weren't triggered this run. Lower priority than L42 since it didn't fire here, but still queued.

3. **L38 — Writer prior-chapter state propagation.** From L31d / L37-data continuity-blocker pattern. Surface prior-chapter `mustEstablish` facts into the writer's beat brief. Lower priority than L42+L41 because L37-data showed continuity blockers fire less often than originally thought.

## What Went Well

- **Mechanistic + retroactive validation in lieu of forward stochastic.** When the live run did not trigger the case, retroactively reconstructed the L39-val grounded surface and ran the L40 grounding check directly. Strong proof without needing to re-run novels until "System" stochastically appears.
- **Telemetry payload extension paid off.** The `llmRescuedByNer` count field added in this commit confirmed (with `0` events) that L40 didn't fire spuriously on the live run. Without telemetry, we couldn't distinguish "L40 working but inactive" from "L40 broken silently".
- **Atomic commit discipline.** Source change (`d356443`), docs (`f2a8bfa`), result doc (this commit), session retro (this commit) — each isolated, each readable independently.
- **Single-cycle pipeline: code → test → commit → deploy → smoke → validate.** ~30 min total wall time including 8 new unit tests, typecheck, deploy, novel run, telemetry queries, retroactive analysis.

## What Was Learned

- **Stochastic validation has blind spots; mechanistic validation closes them.** A re-smoke that doesn't trigger the original case looks like "L40 didn't help" — but the fix is still mechanistically sound; the case just didn't recur. Always backstop a stochastic re-smoke with mechanistic + retroactive analysis when the case doesn't fire live.
- **The dominant heretic bail cluster shifts as upstream clusters close.** L39 closed adherence truncation FNs → L39-val exposed gamelit "System" cluster. L40 closes "System" → L40-val exposes writer-invented unsanctioned entities. Each cluster fix shifts the next bottleneck. Healthy progression.
- **`allowedNewEntities` is a planner-writer interface gap.** The planner emits `[]` for most beats. The writer often introduces ambient walk-on entities (junior characters, scene-setting documents) that are NOT in any grounded surface. Currently caught by halluc-ungrounded as `llm-only-blocker` — correct behavior, but the harness doesn't carry that signal back to either the writer or the planner. L42 candidate.

## Lessons for `docs/lessons-learned.md`

Two candidate generalizable lessons:

1. **"Stochastic re-smokes need mechanistic backstops."** When a fix targets a specific disagreement class but the live re-smoke happens to not trigger that class (writer prose is stochastic), reconstruct the prior bail's grounded surface from `request_json.groundedSources` and run the fix's check function directly. A 100% retroactive rescue rate on the prior bail-class entities is stronger evidence than waiting for the live case to recur.
2. **"Telemetry payload extensions pay for themselves on the same day they ship."** Added `llmRescuedByNer` count to `ner_prepass_json` in the same commit as the L40 fix. That field IMMEDIATELY answered "did L40 fire spuriously this run?" (answer: no, 0 events) without re-instrumentation. Always extend telemetry alongside any defensive code change.

Will append both to `docs/lessons-learned.md` in the L40-validation commit.

## Telemetry Quick-References

- L40-val novel: `novel-1777716659610`
- Experiment: 365 (L40, in `tuning_experiments`, conclusion shipped)
- Plan-assist gate: ch1, kind plan-check-exhausted, 4 unresolved (1 adherence + 3 halluc)
- Halluc calls: 19 (13 pass / 5 ner-only-warning / 1 llm-only-blocker / 0 ner+llm-blocker)
- L40 rescue events: 0 (case did not fire stochastically)
- Smoke log: `/tmp/smoke-l40val-heretic-1777716659.log` (LXC)
- L39-val parent novel: `novel-1777712370271` (used for retroactive rescue analysis)

## Commit Chain (this session)

- `d356443 [halluc-ungrounded] L40 — NER post-filter for LLM-flagged entities`
- `f2a8bfa [docs] L40 — record NER post-filter ship + queue heretic validation`
- `[docs] L40-validation — heretic re-smoke + mechanistic + retroactive validation (exp #365)` (this commit)
