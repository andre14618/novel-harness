---
status: active
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

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 373 --conclusion "<summary>"`.
- Classified pending gates resolved as `orphaned` after dry-run, if any.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L49-grounded-union-allowlist.md --json`
- If failed, failure fingerprint:
- Next action: Establish current deterministic grounded-union matching behavior with focused tests before editing runtime code.
