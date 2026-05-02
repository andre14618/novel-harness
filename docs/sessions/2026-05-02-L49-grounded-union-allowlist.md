---
status: completed
updated: 2026-05-02
role: primary-lane-context
---

# L49 Grounded-Union Allowlist Matching

## Loop Contract

- Objective: Build deterministic allowlist matching against the full halluc-ungrounded grounded union so grounded names are recognized consistently before LLM adjudication.
- Starting commit: 33f900e
- Experiment ID: 373
- Budget cap: $2 local/test budget first; no LXC smoke unless deterministic tests pass and a follow-up validation lane explicitly needs it.
- Primary lane: L49 deterministic grounded-union allowlist matching.
- Causal hypothesis: Some residual halluc-ungrounded edge cases persist because deterministic name matching does not yet cover the complete checker-visible grounded union with consistent exact/component normalization, especially title+surname and grounded surname forms.
- Baseline: Current halluc-ungrounded NER prepass uses normalized matching and selected grounded sources, but `docs/todo.md` still tracks a gap to build deterministic allowlist matching across speakers, beat characters, POV, setting, world bible names, From-brief, Beat-entities, and `allowedNewEntities`.
- Changed runtime lever: Consolidate or extend deterministic grounded-union matching for halluc-ungrounded so exact/name-component matching applies uniformly across all checker-visible grounded sources without adding new LLM blocker behavior.
- Feedback signal: Focused tests show title+surname and grounded surname cases pass, sanctioned allowed-new-entity cases pass, and unsanctioned names still fail/warn as designed; no regression to existing halluc-ungrounded tests.
- Stop gate: Stop on (a) deterministic grounded-union tests pass and the todo gap is closed, (b) matching semantics require a broader checker-output/schema lane, (c) false-positive risk appears in tests/review, (d) DB/test infrastructure blocks validation, or (e) the $2 local budget is exceeded.
- Escalation rule: If the matching fix requires changing checker severity, multi-call convergence, or persisted result schema, stop and queue a separate checker-calibration/schema lane instead of bundling it here.
- Allowed parallel support work: focused halluc-ungrounded tests, docs-impact audit, small helper extraction, lane-message evidence requests, docs-finalizer handoff when results are known.
- DeepSeek V4 Flash concurrency plan: None planned. This is a deterministic code/test lane; use DeepSeek only for docs-finalizer or review support if needed.
- Deferred out-of-lane runtime changes: halluc blocker threshold promotion, multi-call convergence, confidence scoring, checker-output structured metadata, phase-eval persistence improvements.
- Files/scripts expected to change: `src/lint/entity-candidates.ts`, `src/agents/halluc-ungrounded/**`, focused halluc tests, and durable docs if runtime behavior changes.
- Evidence artifact: Experiment #373 plus focused test output and any inspected halluc panel/fixture refs.
- Event log: output/agent-runs/2026-05-02-L49-grounded-union-allowlist/events.jsonl
- Dashboard command: bun scripts/agent/lane-dashboard.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --watch --latest-novel
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 30 --max-hours 8 --max-no-change-cycles 3 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: NER prepass exists and has closed several named-entity false negatives, but the full grounded-union allowlist matching todo remains open.
- Baseline command(s): inspect `src/lint/entity-candidates.ts`, `src/agents/halluc-ungrounded/index.ts`, and existing halluc-ungrounded tests; run the narrowest focused tests before editing.
- Baseline result: Pending; first cycle should establish exact current matching behavior and identify the smallest deterministic gap.

## Stop Gates

- (a) Clean pass: deterministic grounded-union tests pass and close the todo gap.
- (b) Scope split: checker schema/severity/persistence changes are needed.
- (c) Regression: grounded matching creates plausible false positives/false negatives in existing tests.
- (d) Infrastructure failure: tests, DB, or provider availability prevents interpretation.
- (e) Cost cap: local/test budget exceeded before readable result.

## Command Plan

- Sample shape / N: local unit tests only unless a follow-up validation lane is queued.
- Probe-family key or fixed panel: `L49-grounded-union-allowlist`.
- Expected cost: $0 for deterministic tests; DeepSeek only for optional docs-finalizer/review.
- Command 1: `bun test src/agents/halluc-ungrounded/index.test.ts src/lint/entity-candidates.test.ts`
- Command 2: `bun scripts/preflight-docs-impact.ts --strict`
- Runner dry-run: `bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --queue docs/sessions/lane-queue.md --dry-run`
- Verification command(s): focused tests, `git diff --check`, docs-finalizer packet when lane result is known.

## Progress Log

- Pending. Created after L38-G clean pass so the queued runner can return to concrete novel-harness checker hardening work instead of stopping on an exhausted lane queue.
- 2026-05-02 (cycle 1): Established baseline — `bun test src/agents/halluc-ungrounded/index.test.ts` 48/48 pass; `buildNerGroundedSet` already unions all checker-visible evidence components and adds per-token shards; the remaining gap was `isNerGrounded`'s four-tier whole-phrase check failing on title+surname patterns when only the surname was grounded. Pre-existing test at `index.test.ts:103` documented the FN. Implemented bounded tier-5 title-strip in `isNerGrounded` gated on `TITLE_TOKENS` lexicon (~22 tokens) so "Master Orin" with grounded "Orin" is grounded but generic "Aldric Venn" with grounded "Venn" still fires. Updated the FN test to assert grounding, added 3 new tests (tier-3 normalized-form path via `Arbiter Cassel` + `Cassels`; negative bound for non-title prefixes; case-insensitivity on the title token). 174/174 pass on focused suites.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome: CLEAN PASS — deterministic grounded-union allowlist matching reaches lane acceptance ("exact/name-component matching catches title+surname cases without flagging grounded surnames"). `isNerGrounded` now applies a bounded tier-5 title-strip fallback gated on the closed `TITLE_TOKENS` lexicon. Generic multi-word phrases without a title prefix still fire when their non-grounded tokens warrant it (negative test asserts).
- Stop gate fired: (a) deterministic grounded-union tests pass and the todo gap is closed.
- Evidence link/row/path: `src/agents/halluc-ungrounded/index.ts` (isNerGrounded tier-5 + TITLE_TOKENS_LOWER), `src/agents/halluc-ungrounded/index.test.ts` (4 new/updated tests), `bun test src/agents/halluc-ungrounded/index.test.ts src/lint/entity-candidates.test.ts` → 174/174 pass.
- Cost: $0 (deterministic test lane; no LLM calls).
- Commit(s): `559e8c8` [checker] L49: title-strip tier-5 closes title+surname grounding gap.

## Finalization Checklist

- [x] Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- [x] Experiment concluded: exp #373 — `CLEAN PASS` — deterministic grounded-union allowlist matching reaches lane acceptance via bounded tier-5 title-strip fallback gated on closed `TITLE_TOKENS` lexicon.
- [x] Classified pending gates resolved as `orphaned` after dry-run, if any.
- [x] Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- [x] Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- **Status: COMPLETED** — lane closed on stop gate (a) after CLEAN PASS. Commits: `559e8c8`, `16add53`.
- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --json`
- If failed, failure fingerprint: N/A (passed).
- Next action: §7 todo item closed. Next checker-hardening priority is per-class hallucination metrics (todo §7 line 109) and fresh functional-state warning calibration panel (todo §8 line 123).
