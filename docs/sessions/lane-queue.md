# Lane Queue

## Active
- (empty — grounding phase G-A lever closed and validated live (non-regressive on exp #392); G-B priority elevated based on new drift-invention failure-mode evidence)

## Next
- (empty — G-B candidate, writer-side BIBLE-binding constraint, motivated by exp #392 trace)

## Completed

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
