# Novel Harness Agent Instructions

This file is the always-loaded operating contract. Keep it short and durable. Do not encode detailed live model routing, transient roadmap status, or historical rationale here; link to the source of truth instead.

## Core Architecture

Novel Harness is an AI-assisted novel creation harness. Deterministic code controls flow; LLMs are leaf-node function calls.

- **Planning layer:** structural imitation and explicit story contracts. Planner outputs beats, state, knowledge, payoff links, and writer-visible obligations.
- **Writing layer:** prose generation from the local beat contract. The writer should not be asked to police hidden plan discipline.
- **Checker/rewriter layer:** anti-hallucination and on-plan discipline. Checkers catch narrow failures; they do not add creative value or become broad style judges.

Current runtime details change often. Before changing behavior, check the live sources:

- Pipeline state and active architecture: `docs/current-state.md`
- Pending work: `docs/todo.md`
- Decisions and rationale: `docs/decisions.md`
- Model assignments: `src/models/roles.ts`
- Model registry/pricing/capabilities: `src/models/registry.ts`
- Pipeline flags: `src/config/pipeline.ts`

If this file and code disagree, trust code for runtime behavior. If this file and `docs/current-state.md` disagree on narrative status, trust `docs/current-state.md` and update this file only if the rule itself should change.

## Strategic Constraints

- Writer-layer LoRA routing, tonal/voice LoRA generation, Salvatore route-specific leak detection, and Howard-primer style prompting are retired from runtime unless explicitly re-authorized in a new decision.
- Do not add corpus-leak checkers unless a future runtime writer is trained on a known corpus and the route explicitly carries that risk.
- New writer/checker fine-tunes are not the default path. Prefer deterministic guards plus bounded DeepSeek V4 Flash calls unless `docs/decisions.md` or the user explicitly authorizes SFT work.
- Semantic planned-state grounding findings are warning-class until oracle-calibrated. Do not promote new LLM-backed blockers without a labeled current-surface panel.
- Quality is measured with structured pass/fail checks and calibrated comparisons, not generic 1-10 prose scoring.

## Development Workflow

- **Session start contract:** every session opens with a written goal + component, a one-sentence why citing concrete evidence (experiment ID, smoke result, calibration row), a measurable signal that says the work worked, and the validated stop gates that fire (a/b/c/d/e). Capture these in `docs/sessions/YYYY-MM-DD-<short-name>.md` before code or runtime action. See `docs/session-start-contract.md`. If the four questions cannot be answered, the work is exploration — bound it explicitly rather than drifting into changes.
- **Cost-threshold autonomy:** runtime actions costing under $2 per run proceed without asking — deploy + smoke + paired-replay + DB writes for normal lanes. Anything ≥$2 per run, anything touching shared/external state (orchestrator service config, shared infra), or anything that would push the standing $26 overnight budget close to its cap requires a check-in first. Record the actual cost in the lane doc when a run exceeds its quote.
- **Engineering orchestration boundary:** use established interactive engineering harnesses — Claude Code or OpenCode — as the primary layer for coding, agent orchestration, review, and queue handoff. Novel Harness should not rebuild a custom autonomous coding supervisor inside the repo. `scripts/agent/lane-runner.ts` is retired as the default engineering control plane and remains legacy/optional for headless one-shot experiments only. Runtime LLM/API calls inside Novel Harness remain appropriate for novel planning, writing, checking, evaluation, and observability features.
- Build context from code before editing. Avoid assuming schema, routing, or model details from memory.
- Make the smallest correct change. Prefer one coherent concern per commit.
- Default improvement-loop shape: one primary lane owns the causal hypothesis under validation. Parallel support work is allowed only when it improves attribution or operability without changing unrelated runtime behavior.
- A primary lane must declare its baseline, changed runtime lever, feedback signal, stop gate, and escalation rule before live validation. Do not combine prompt edits, routing changes, schema changes, checker threshold changes, and planner/context changes unless the lane explicitly requires that bundle.
- Use DeepSeek V4 Flash concurrency to increase statistical power inside the active lane: fixed panels, paired replay, repeated same-family runs, and multi-seed confirmation are encouraged when the sample shape, family key, budget cap, and promotion gate are declared first. Do not use concurrency to validate multiple unrelated runtime lanes at once.
- Support work such as tests, replay harnesses, docs-impact audits, operator summaries, and stop classifiers should be separate from the runtime behavior bundle and should not be credited as evidence for the primary lane.
- Use `src/harness/` service-layer APIs for application data access. Do not add inline SQL to daemon, benchmark, or UI code.
- Before removing a subsystem, audit reverse dependencies in `src/` and `scripts/`.
- Keep generated/runtime artifacts out of git. Existing generated paths are gitignored; do not add new generated roots.
- Root directory discipline: application code belongs under `src/`; scripts under `scripts/`; docs under `docs/`; migrations under `sql/`; UI under `ui/`; tests under `tests/`.
- Keep README current when architectural behavior changes.

## Commits And Experiments

- Commits are pre-authorized for coherent completed work with passing relevant checks. Do not ask before committing unless the commit would include secrets, credentials, large binaries, or the user has asked not to commit.
- Never push without explicit user instruction.
- Do not amend commits unless explicitly requested.
- One change per commit. Follow `docs/commit-conventions.md`.
- Every tracked work item goes in the DB via `harness.experiments.createTuningExperiment(type, ...)` and `concludeExperiment()`. Use `ticket` for standard engineering work and `charter` only for multi-commit architectural efforts.
- Every benchmark/novel/eval run that produces evidence links to an experiment with `EXPERIMENT_ID=N`.
- Every experiment links to a git commit. Commit changes before running experiments.
- Results and findings persist to the DB or tracked docs. Never leave measurement findings only in chat or stdout.
- Queued lane handoff requires `Results: Review` by default. Record independent commit-pinned review evidence such as `impl-review <sha> PASS`, or an explicit waiver reason and reviewer, before stop/queue handoff.

## Documentation Discipline

- `docs/todo.md` contains pending action items only. Completed work and rationale belong in `docs/decisions.md`, `docs/current-state.md`, result docs, or session retrospectives.
- When an experiment concludes or a path is ruled out, update `docs/decisions.md`, remove rationale from `docs/todo.md`, conclude the DB experiment, and commit docs separately when practical.
- Capture methodology surprises in `docs/lessons-learned.md` during the same session. Use generalized “when X, then Y” lessons. **A failure-mode unit fixture that caught an over-relaxed implementation is a lesson.** Missing this entry is a docs-sweep failure even if every other doc is updated.
- Capture specific findings in the appropriate persistent doc during the same session. Chat summaries die.
- After meaningful PR-sized work, update `docs/current-state.md`, `docs/lessons-learned.md`, and `docs/todo.md` as needed.
- **End-of-work documentation sweep is part of the clean-pass gate, not optional polish.** Before declaring a session/lane finished: co-stage `docs/current-state.md` (or footer `docs-impact: none`), append `docs/decisions.md` §Lxx, close the `docs/todo.md` item, append `docs/lessons-learned.md` if applicable, fill the lane doc Results, conclude the experiment row, advance `docs/sessions/lane-queue.md`, run `bun scripts/preflight-docs-impact.ts --strict` and `git diff --check`. See `docs/session-start-contract.md` for the full sweep checklist.
- Write session retrospectives under `docs/sessions/` for sessions with multiple architectural iterations, Codex reviews, or supersession chains.

## Deployment Model

Local repo is canonical for editing. LXC 307 is the runtime for orchestrator, benchmarks, and novel runs.

- Deploy code: `bash scripts/deploy-lxc.sh`
- Run on LXC: `ssh novel-harness-lxc "cd ~/apps/novel-harness && bun ..."`
- Orchestrator service: `ssh novel-harness-lxc "sudo systemctl status novel-harness-orchestrator"`
- Web UI: `http://novel-harness:3006/app?key=<ORCHESTRATOR_API_KEY>`
- DB: single Postgres database `novel_harness_orchestrator` on LXC.

Deploy after commit when changes affect runtime behavior. Required deploy surfaces include:

- `src/models/roles.ts`, `src/models/registry.ts`
- `src/agents/**`
- `src/config/pipeline.ts`
- `src/phases/**`
- `src/llm.ts`, `src/transport.ts`
- `src/lint/**`
- `sql/**` plus applying migrations on LXC

Doc-only commits do not require deploy. Local-only scripts do not require deploy unless their child entry points run on LXC. When unsure, deploy before relying on LXC results.

Never deploy while data generation is running. `deploy-lxc.sh` checks for active generation processes; respect that guard.

Use `nohup ... > /tmp/name.log 2>&1 &` for long-running LXC scripts. Do not pipe long SSH jobs through filters that can close the pipe.

## Database And SQL

- Never guess column names. Before ad-hoc SQL, query `information_schema.columns` for the table.
- Public schema contains current-pipeline data. Pre-2026-04-15 telemetry and old test-era novels live in `archive.*`.
- Eval infrastructure persists to `eval_briefs` and `eval_results`; see `docs/eval-infrastructure.md`.
- Prefer service-layer modules in `src/harness/` and per-table DB modules in `src/db/` over new ad-hoc SQL.

## Testing And Verification

- Run the narrowest relevant tests first, then broader checks when the touched surface warrants it.
- For runtime changes, verify locally before deploying, then run LXC experiments only after commit + deploy.
- Existing full TypeScript/check baselines may have known failures; document whether a failure is pre-existing or introduced.
- For human lane monitoring, route defaults through the bare `monitor` alias. Use expanded `bun run monitor`, `bun scripts/agent/monitor.ts`, or `lane-dashboard` commands only when debugging the alias or working in an environment where the alias is unavailable.
- For frontend changes, verify desktop and mobile behavior and preserve the existing design system unless explicitly changing it.

## Source Map

- Agent prompts/schemas/context: `src/agents/{name}/`
- Phase orchestration: `src/phases/`
- Shared schemas: `src/schemas/`
- Models and routing: `src/models/`
- Service layer: `src/harness/`
- DB modules: `src/db/`
- Lint/check helpers: `src/lint/`
- Orchestrator/API: `src/orchestrator/`
- React UI: `ui/`
- Migrations: `sql/`
- Tests: `tests/` and `src/**/*.test.ts`

## Reference Docs

- `docs/current-state.md` — live architecture and runtime status
- `docs/interactive-claude-captain-loop.md` — engineering orchestration boundary and captain loop
- `docs/todo.md` — pending action items only
- `docs/decisions.md` — append-only decisions and rationale
- `docs/overnight-runbook.md` — unattended loop contract, stop gates, and audit checklist
- `docs/agent-lane-protocol.md` — multi-agent lane roles, heartbeat, status, and dashboard commands
- `docs/experiment-design-rules.md` — experiment design, promotion thresholds, and lane discipline
- `docs/lessons-learned.md` — reusable methodology/process lessons
- `docs/harness-tuning-roadmap.md` — corpus pattern and variant-eval matrix
- `docs/invariants.md` — structural-property checks and preflight gates
- `docs/world-knowledge-graph.md` — knowledge graph and context assembly
- `docs/corpus-pipeline.md` — canonical novel-decomposition pipeline
- `docs/eval-infrastructure.md` — eval tables and provenance
- `docs/commit-conventions.md` — commit message format
- `docs/features-expansion-todo.md` — parked product ideas
