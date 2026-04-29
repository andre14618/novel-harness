---
status: retrospective
updated: 2026-04-28
duration: ~6h
commits: 15
subagents_spawned: 3

wall_clock_min: 360
codex_reviews: 6                    # R1+R2+R3 plan, P0, P6b1, P6b2, P6b2-foreground, P7/P8 close-out
rework_passes: 4                    # P0→P0.1 (timestamp), P0→P0.2 (ordering), P3 planning idempotency note, P4→P4.1 (revisions ordering)
bugs_caught_by_codex: 4             # timestamp-in-stable-id (P0), ordering churn (P0.2), revisions ordering (P4.1), schema-of-record violations (R2 plan reject)
bugs_caught_by_preflight: 0         # bun test + typecheck didn't catch any of these
bugs_escaped_to_prod: 0
preflight_false_positives: 0
---

# Phase modularization (P0 → P8) — 2026-04-28

## 1. What shipped

The state-machine driver was migrated from a phase-name string-dispatch shell to a typed `Phase<I,O>` registry. Each phase (concept, planning, drafting, validation) now has a typed input, a typed output, a `loadOutput(novelId)` resume rehydrator, and a `PhaseResult<O>` return discriminated on `complete` / `paused`. The driver owns phase transitions (`updatePhase` + `phase:changed` emit) instead of phases doing it themselves at exit. `runNovel` now returns `RunOutcome = {outcome:"complete"} | {outcome:"paused", phase, reason}`. The legacy busy-retry guard (`pipeline.maxPhaseRestarts`) is gone — paused exits cleanly back to the caller. Design doc: `docs/designs/phase-modularization.md`. Final Codex verdict: GO-WITH-NIT (thread `a1c6339f41bce7561`); nits addressed in commit `577467c`. Confidence: high — 432/1/0 test suite + parity harness scaffolded for fixture-based byte-equality verification.

## 2. Architectural iterations with supersession chains

### Chain A: Schema-of-record violations in the original plan

- **Initial approach:** R1 plan assumed `chapter_drafts` had `approved_at`, that `tonal_pass_drafts` was its own table, and that resume rehydration could be optional.
- **Problem discovered:** Codex R2 review (gpt-5.4 high effort) caught the schema mismatch — `chapter_drafts` uses `status='approved'`, tonal-pass lives in `chapter_drafts WHERE status='tonal-pass'`, and skipping rehydration would leave `pipe` undefined on resume.
- **Superseded by:** R3 plan (commit `5b72fb8`) — explicit PhaseResult return per phase, status-based queries, mandatory loadOutput walk on resume.
- **Lesson:** before designing phase-output schemas, grep `sql/` and `src/db/` for the actual column names. Memory entry [Schema-of-record check](feedback_schema_of_record_check.md) already covered this — the plan author skimmed it during R1.

### Chain B: Timestamp-poisoned stable IDs in the parity harness

- **Initial approach:** P0 (`738e99a`) included `timestamp` and `fired_at` fields in the `REMAP_PK_CONFIG` business keys for `llm_calls` and `pipeline_events`, on the theory that timestamps disambiguate rows with otherwise-identical content.
- **Problem discovered:** self-review caught it before Codex did — timestamps vary by wall clock across runs, so `stableId` would never match between record and replay even with identical behavior. The whole point of the harness is undermined.
- **Superseded by:** P0.1 (`d2943f5`) drops timestamps from business keys and adds a `rowIdx` parameter so identical-content rows still get unique stable IDs.
- **Lesson:** a stable ID that varies across runs is a contradiction. Always ask "would this match across two clean runs of the same code?" before adding a field.

### Chain C: Ordering churn in the parity snapshot

- **Initial approach:** P0.1 ordered `llm_calls` and `pipeline_events` by `timestamp ASC` for snapshot stability.
- **Problem discovered:** Codex caught it — ties at the millisecond level (parallel beat writes) cause non-deterministic ordering, which makes the parity diff churn even when behavior is byte-equal.
- **Superseded by:** P0.2 (`ecd65c3`) — order both tables by `id ASC` (the SERIAL PK is monotonic per-row regardless of clock skew) and tighten the `pipeline_events` business key to include `chapter`, `beat_index`, and `agent` for sub-row precision.
- **Lesson:** for snapshot determinism, prefer monotonic PKs over wall-clock timestamps. Seen at 2 sites this session.

### Chain D: chapter_revisions row uniqueness

- **Initial approach:** P4 (`5b86dd7`) ordered `loadDraftingOutput`'s revision query by `(chapter, attempt)`.
- **Problem discovered:** Codex caught it during P4 review — a single chapter can have two revision rows with the same `attempt` number when one comes from the plan-check escalation path and the other from validation. `(chapter, attempt)` is not unique.
- **Superseded by:** P4.1 (`3cd2600`) — order by `(chapter, invoked_at, id)` matching the existing `getChapterRevisions` helper.
- **Lesson:** before assuming a `(parent_id, sequence_number)` tuple is unique, grep for existing helpers that already handle the disambiguation. Two paths can write rows with the same nominal sequence number.

## 3. Codex back-and-forth exchanges

1. **Thread `R1→R2→R3` (plan review)** — three rounds, ~90min total.
   - **Original claim:** initial plan had Phase<I,O> wrapper as a thin shim around the existing void-return runXPhase functions, with optional resume rehydration.
   - **Codex found:** 2 CRITICAL (resume rehydration mandatory; phase.run() ≠ phase complete) + 4 HIGH + 3 MEDIUM in R1, then R2 NO-GO on schema violations.
   - **Fix:** R3 plan (`5b72fb8`) — explicit PhaseResult discriminated return per phase, mandatory loadOutput walk, status-based DB queries.
   - **Sufficient?** Yes. R3 was APPROVED.

2. **Thread (P0 review)** — caught the ordering churn nit.
   - **Original claim:** P0 + P0.1 stable-ID generation should now be deterministic across runs.
   - **Codex found:** still non-deterministic when wall-clock timestamps had ties (parallel writes within the same ms).
   - **Fix:** P0.2 (`ecd65c3`).
   - **Sufficient?** Yes.

3. **Thread (P6b1 review)** — `a73e7d24495c1a2cb`.
   - **Original claim:** driver flip preserves all observable behavior.
   - **Codex found:** one LOW finding (new paused-path log line not in commit message) — cosmetic.
   - **Fix:** none needed; the log line was deliberate and is harmless.
   - **Sufficient?** Yes. GO.

4. **Thread (P6b2 review)** — `ae6acfb522722ccd0`.
   - **Original claim:** paused returns travel back to caller; busy-retry guard removed.
   - **Codex found:** all 8 review questions OK.
   - **Fix:** none.
   - **Sufficient?** Yes. GO.

5. **Thread (final close-out)** — `a1c6339f41bce7561`.
   - **Original claim:** P7 + P8 ready to merge.
   - **Codex found:** caller count off by 3 (14 vs 17), P8 registry assertion was tautological (compared hardcoded vs hardcoded), P8 design doc didn't reflect the actual single-file shape.
   - **Fix:** `577467c`.
   - **Sufficient?** Yes. GO-WITH-NIT, all nits addressed.

## 4. Class-of-bug patterns

- **Schema-of-record drift** — assumptions about column names / table names / status enum values that don't match the actual SQL. Seen at 1 site this session (R1→R2 plan reject), and is a recurring pattern (memory entry exists). The lesson: before designing typed outputs, grep `sql/` and `src/db/`.
- **Wall-clock-as-stable-key** — using millisecond timestamps in stable IDs or sort orders, which produces non-determinism on parallel writes. Seen at 2 sites this session (P0 stable-id, P0.1 sort order). Candidate for `docs/patterns/` elevation if it recurs.
- **Tautological registry-level tests** — assertions that compare two literally-equal hardcoded arrays. Seen at 1 site this session (P8 initial). Cheap to write, zero diagnostic value. Pattern: "live-surface comparison or it doesn't count."
- **Premise drift in design docs** — P7's "delete dead exports" was based on an assumption (no external callers) that was false. The premise wasn't grep-checked when written. Seen at 1 site this session.

## 5. Process observations

The Codex review-loop pattern (single Codex call per P-step, foreground, gpt-5.4 high effort, address findings, recommit) worked well at this scope. Six review calls over 15 commits is a sustainable cadence — each review took 3–6 minutes wall clock and caught real defects in 4 of 6 cases. The two clean-GO reviews (P6b1 with one LOW cosmetic finding, P6b2 with zero findings) were not wasted: they served as a tripwire confirming the previous P-step's behavior actually held.

The R1→R2→R3 plan-review loop was higher-leverage than any later step. R1's 2 CRITICAL + 4 HIGH + 3 MEDIUM findings would have caused a multi-day implementation rework if any had landed. The ratio of "plan iteration time" to "implementation time" was roughly 1:5 — extremely cheap insurance.

The single-file P8 collapse (originally four per-phase test files) is worth noting. The original design doc called for behavioral coverage at the new interface; discovered during implementation that the integration tests + parity harness already provided that, and four superficial re-runs would be cargo-cult. Elevated to a one-file shape pin instead. This is the second time in recent sessions where a multi-file design has been correctly collapsed during implementation — pattern worth keeping in mind: read the design's *intent*, not just its file count.

What didn't work as well: I didn't deploy the parity harness during P6b1/P6b2 because the LXC fixture isn't recorded yet. That's the one weak spot in this series — byte-equality is asserted by code but never measured. P0b is queued.

## 6. Open questions / next-session focus

Outstanding deferrals:
- **P0b** — record reference fixture on LXC, verify byte-parity holds across P6b1+P6b2.
- **Concept partial-save resume** — Concept's all-or-nothing resume limitation noted in `9bd7ee4`. Out of scope for P-series; tracked separately.
- **Planning + Validation idempotency** — both phases re-do work on mid-phase resume (re-emit chapter outlines, re-append issues). Not regressed by P6b1; pre-existing limitation. Tracked separately.
- **Branch merge** — `phase-modularization` is ready to merge into `autonomous-harness-loop`. No new behavior, all tests green, parity harness scaffolded.

If you're reading this on the next session, start with: (a) recording the LXC parity fixture (P0b) so future refactors of the phase code path can verify byte-equality automatically, and (b) merging `phase-modularization` into `autonomous-harness-loop` if it hasn't shipped yet. The typed `Phase<I,O>` surface is the right shape to build per-phase improvements on (the original goal that motivated the refactor: modularize so each phase can be improved in isolation). The autonomous-loop work that prompted this branch is unblocked.
