# Lane Queue

## Active
- (empty — integrity ladder L40-L72 at diminishing returns on the 3-novel validation panel; dominant blocker shifted to ch2 plan-check-exhausted on continuity + halluc-ungrounded)

## Next
- (empty — L73 / Continuity candidate provisional; opens with explicit charter when user picks the next direction. Architecture question on the table re: dynamic-state vs tagged-context — see 2026-05-03 retro)

## Completed

- docs/sessions/2026-05-03-canon-substrate-postgres-adapter.md — clean pass (a). **Charter §1 (Canon Substrate) stop gate cleared** — production Postgres substrate (`sql/035`, `src/db/canon-substrate.ts`, `src/harness/canon-substrate.ts`) ships with the async-loader + sync-snapshot-wrapper pattern; adapter-equivalence suite (`src/canon/substrate-equivalence.test.ts`) runs the same 32-test behavioral spec against `InMemoryCanonSubstrate` and `PostgresCanonSubstrate` and passes against both. 178 canon tests pass, tsc clean, §0a recall still 0.927.
- exp #402 (L70b+L71+L72 stack validation A/B on `fantasy-archive`/`fantasy-debt`/`fantasy-system-heretic` ch1-2) — VALIDATED. Approval ch1: 1/3 → 3/3 across baseline → L70b → stack. debt FULL NOVEL APPROVED ($0.074). 3 settle invocations, 100% acceptance. Dominant blocker shifted to ch2 plan-check-exhausted on continuity + halluc-ungrounded (arch + heretic). $0.190 total. See `docs/decisions.md` §L70b+L71+L72 stack validation.
- docs/sessions/2026-05-03-L72-duplicate-sentence-punctuation-fp.md — SHIPPED unit-only (exp #401, Lever I-A). `normalizeSentence` was stripping all punctuation, so `"No."` and `"No?"` matched as duplicate-sentence; surfaced in debt ch2 att 1 of L70b A/B and triggered chapter regenerate cascade. Fix preserves `.?!`. 5 new tests, recall-preserving by construction.
- docs/sessions/2026-05-03-L71-chapter-plan-reviser-maxtokens.md — SHIPPED defensive (exp #400). chapter-plan-reviser maxTokens 6144 → 12288. Surfaced as 1/25 historical bail (exp #399 heretic ch1 finish_reason=length). Heretic retry ran clean but reviser never fired — defensive coverage for documented failure mode, escalation if 12288 also caps.
- docs/sessions/2026-05-03-L70b-per-fragment-targeted-rewrite.md — SHIPPED (exp #399, Lever I-D form (a)). Per-beat targeted rewrite via offset→beat mapping + `runSettleLoop` reuse, no writer-prompt change. 75% settle acceptance, +33pt approval (1/3 → 2/3 ch1), arch full novel approved. heretic regressed on plan-assist `reviser-rejected` (different surface where L70b code never ran; provably L70b-unattributable). Lesson: routing-only lanes need causal-attribution stop gates.
- docs/sessions/2026-05-02-L70-duplicate-fragment-paraphrase-ladder.md — REVERTED stop gate (b) (exp #398, Lever I-D form (b)). Prompt-only escalation; cross-surface coupling — heretic regressed approved → bailed plan-check (halluc `silver interlocking ring`); arch shifted to fused-boundary (`6 A.M.*`). Pivoted to L70b form (a). Three lessons captured in `docs/lessons-learned.md`.
- exp #392 (L65 live smoke on `fantasy-archive`) — chapter 1 approved att2 (L41/L63 verified live: 13/13 prompts carry AVOID INTEGRITY + paraphrase-one-side directives). Chapter 2 bailed at plan-check-exhausted on halluc-ungrounded "Senior Cataloguer". Critical phase finding: writer drift-invents fresh ungrounded entities each chapter-attempt ("Third Lamentation" → "Codex" → "Senior Cataloguer") rather than persisting — L65's carry-over architecture is correct but addresses persistence-mode, not drift-invention-mode. G-B priority elevated.
- docs/sessions/2026-05-02-L65-grounding-carryover.md — clean pass for chapter-attempt carry-over of LLM-confirmed ungrounded entities (exp #391, Lever G-A). Mirrors L41/L63 pattern; closes byte-identical-prose case from exp #389 (retroactive replay PASSES on `chapter_exhaustions` row for novel-1777768466618 ch1).
- docs/sessions/2026-05-02-grounding-phase-brief.md (phase brief) — 25% of plan-check-exhausted in 14 days cite halluc-ungrounded; identified Levers G-A / G-A2 / G-B / G-C with empirical sequencing.
- exp #389 (L63+L64 e2e on `fantasy-debt`) — L62/L63/L64 wires non-regressive. Chapter 1 reached integrity check with 0 fused-boundary/duplicate hits; integrity gate never had to fire. Smoke bailed at out-of-phase plan-check-exhausted (halluc-ungrounded "central spire"). Classifier: `new_blocker`. See L64 lane Results addendum.
- docs/sessions/2026-05-02-L64-integrity-exhaustion-gate.md — clean pass for routing final-attempt integrity exhaustion through `presentForExhaustion` with `kind: "integrity-exhausted"` (exp #388, Lever B; UI consumers in 826a6c1). Mirrors existing plan-check-exhausted dispatch; no SQL migration needed.
- docs/sessions/2026-05-02-L63-matched-pair-carryover.md — clean pass for matched-pair carry-over for duplicate-sentence + duplicate-fragment (exp #387, Lever A). Targets 72.9% of integrity-fail volume per phase brief. Empirical retry-replay validation deferred until a retry-bearing seed exercises the path.
- docs/sessions/2026-05-02-runner-archive-and-litrpg-validate.md (session) — runner archival + L62-validate clean pass (exp #386). Chapter 1 of fantasy-system-heretic approved with 0 fused-boundary issues from System UIDs. New blocker surfaced in continuity (out-of-phase; parked).
- docs/sessions/2026-05-02-integrity-retry-phase-brief.md (phase brief) — DB scan + code audit + L41 trace evidence; identified Levers A/B/C with empirical sequencing.
- docs/sessions/2026-05-02-L62-litrpg-integrity-guard.md — clean pass for LitRPG System-path identifier exemption in `detectFusedBoundaries` (commit `31e16a8`, exp #385). L63 candidate (chapter-attempt retry fall-through after second integrity failure) queued in `docs/todo.md`.
- docs/sessions/2026-05-02-L61-e2e-smoke-after-hardening.md — stop gate (b) new dominant blocker: prose-integrity false-positive on LitRPG System path identifiers + chapter-attempt retry escalates duplicate fragments. L62 candidate queued in `docs/todo.md`.
- docs/sessions/2026-05-02-L57-runner-review-gate.md — clean pass for review evidence before queued lane advance.
- docs/sessions/2026-05-02-L38-A-prior-context.md — refuted original missing-prior-context hypothesis.
- docs/sessions/2026-05-02-L38-F-reader-info-adherence.md — confirmed writer-side READER-INFO binding rule.
- docs/sessions/2026-05-02-L38-C-chapter-summary-wiring.md — closed chapter_summaries as obsolete.
- docs/sessions/2026-05-02-L38-G-intra-chapter-state.md — clean pass for same-chapter physical-state rule.
- docs/sessions/2026-05-02-L49-grounded-union-allowlist.md — clean pass for bounded title-strip grounded-union matching.
- docs/sessions/2026-05-02-L50-halluc-per-class-metrics.md — clean pass for halluc A/B per-class metrics.
- docs/sessions/2026-05-02-L51-halluc-structured-entity-metadata.md — clean pass for structured halluc A/B issue metadata.
- docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md — clean pass for checker calibration rollups.
- docs/sessions/2026-05-02-L53-phase-eval-family-key.md — clean pass for phase-eval family-key comparability.
- docs/sessions/2026-05-02-L54-pre-loop-gate.md — clean pass for unattended pre-loop gate.
- docs/sessions/2026-05-02-L55-commit-range-docs-impact-audit.md — clean pass for commit-range docs-impact audit.
- docs/sessions/2026-05-02-L56-smoke-stop-classifier.md — clean pass for smoke-stop classifier.
