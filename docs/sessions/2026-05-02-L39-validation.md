---
loop: L39-validation
date: 2026-05-02
experiment: 364
result_doc: docs/l39-validation-2026-05-02.md
status: shipped
stop_condition: b
---

# L39-validation — Heretic re-smoke after adherence truncation fix (2026-05-02)

## Goal

Validate the L39 adherence-checker prose truncation fix (2000 → 8000 chars, commit `0dc2b0c`) by re-smoking `fantasy-system-heretic` 3 chapters. Acceptance: ch1 drafts cleanly OR bails on a different cluster than the original heretic's adherence FN (Beat 4 reshelves missing).

## Outcome

**Stop condition: (b) — NEW out-of-scope cluster found.**

L39 VALIDATED. Heretic ch1 attempt 3 had no adherence blockers (vs. original heretic which bailed here on the truncation FN). Bailed on a NEW cluster: gamelit "the System" entity not in the grounded surface.

| Metric | Original heretic | L39-val heretic | Delta |
|---|---|---|---|
| Calls on retry | 52 | 25 | **-52%** |
| AND-gate pass rate | 31% | 51% | +20 pts |
| Cost | $0.0619 | $0.0606 | -2% (essentially equal) |
| Bail cluster | adherence FN (truncation) | halluc "System" ungrounded | DIFFERENT |

Adherence FN cluster: closed. Cost: unchanged (L39 cost-neutral as predicted).

## Pickup Instructions (if returning to this thread)

L39 fix is shipped + validated. The pending plan-assist gate `#78` on `novel-1777712370271` can be left for the next loop's L35 stale-gates audit (`--min-age-hours 6`) to auto-orphan after threshold.

Next loop candidates (in priority order):

1. **L40 — Extend grounded surface for gamelit/litRPG genre-specific vocabulary.** Add "System", "Class", "Status", and similar game-mechanic terms to the halluc-ungrounded grounded surface for heretic-style seeds. Three options: (a) patch the heretic seed's world_bible_json, (b) extend `buildOutlineEntityList` to extract repeated capitalized single-word terms, (c) add a litRPG-genre vocabulary extractor. Acceptance: heretic re-smoke ch1 doesn't bail on "System" ungrounded.

2. **L41 — Investigate prose-integrity retry instability.** L37-data heretic and L39-val heretic BOTH bailed on prose integrity in early attempts (8 / 2 / 4 issues across runs). The lint-fix-rejected → chapter-retry path doesn't carry integrity descriptions back to the writer; retries vary stochastically. Worth probing the prose-integrity guard rules and whether a targeted-rewrite path could close common cases.

3. **L38 — Writer prior-chapter state propagation.** From L31d / L37-data continuity-blocker pattern. Surface prior-chapter `mustEstablish` facts into the writer's beat brief. Lower priority than L40+L41 because L37-data showed continuity blockers fire less often than originally thought (1/6 chapters, often co-occurring with adherence).

## What Went Well

- **Clean validation methodology.** Pre-deploy guard, single SSH+nohup launch, ScheduleWakeup ~270s cadence, telemetry pulled from DB via operator-summary.
- **Cost analysis was accurate.** Predicted L39 cost-neutral; actual cost essentially identical to original heretic ($0.0606 vs $0.0619). The 4× prose budget for stage-1 + stage-2 LLM calls had no measurable cost impact thanks to prefix caching.
- **Direct comparison surfaced the win.** Same seed, same scenario, same code path except L39 — measurable 52% retry reduction is strong signal.
- **NEW cluster surfaced cleanly.** Stop condition (b) with named cluster (gamelit "System" entity grounding) feeds directly into next sprint design.

## What Was Learned

- **Prose truncation in checker prompts is a high-leverage tunable.** A 4× context bump (2000 → 8000 chars) in the adherence checker had immediate, large effects (52% fewer retries) for a single-line code change. Worth auditing other checker truncations (continuity, functional-state, halluc-ungrounded) for similar bottlenecks.
- **Gamelit world-builder gaps create entity-grounding FPs.** "System" is a meta-token in the heretic seed but isn't in the world-bible. Genre-specific vocabulary (System, Class, Status, etc.) needs explicit grounding. This may be a broader pattern: world-builder produces specific entries (e.g., named locations) but the writer naturally references higher-level abstractions (the System, the Citadel, the order) that reference common nouns.
- **Stage-2 override count is a usage signal.** 6 overrides on L39-val (vs 2 on original heretic) means L31c is doing more work — but this is partly because L39-val's chapter narrative was different (different stochastic outline). Not directly comparable.

## Lessons for `docs/lessons-learned.md`

Two candidate generalizable lessons:

1. **"Audit checker truncation limits before declaring an FN cluster."** When a checker reports false negatives systematically, check whether the prose was truncated before reaching the model. The L39 cluster (Maret-reshelves-missing) looked like a writer-side or model-side issue; the actual cause was a 2000-char truncation cutting the resolution actions. Truncation limits are a high-leverage, low-risk tunable.
2. **"L31-stack gains compound with seed-specific gaps."** With L17/L22/L24/L26 all closed and L39 added, retry-budget consumption on heretic dropped 52%. Each cluster fix matters; compound effects are large. The remaining halt classes (gamelit System grounding, prose integrity instability) are seed/genre-specific gaps that are now unblocked for investigation.

Will append both to `docs/lessons-learned.md` in the L39-validation commit.

## Telemetry Quick-References

- L39-val novel: `novel-1777712370271`
- Experiment: 364 (L39-validation, in `tuning_experiments`)
- Plan-assist gate: id 78 (PENDING, ch1 attempt 3 — halluc Beat 2 "System")
- Stage-2-override events: 6 (vs original heretic 2)
- Smoke log: `/tmp/smoke-l39val-heretic-1777712370.log` (LXC)

## Commit Chain (this session)

- `[docs] L39-validation — heretic re-smoke result + L39 fix validated (exp #364)`
- `[docs] L39-validation — session retro + decisions.md + L40 todo`
