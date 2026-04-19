# novel-harness Codex preamble — 2026-04-19T22:36:40.196Z

> Regenerated preamble. Commit-pinned to `f8e531a`. Cite `git show f8e531a` in any review response.

> **Runtime topology:** orchestrator + Postgres on the LXC host; local shell state may differ from target runtime. SSH/API probes are authoritative.

## Open experiments (55)
- #242 [infrastructure] Canonical invariants registry + visibility. docs/invariants.md becomes the single home for invariants (planned + shippe…
- #236 [charter] Charter — planner-phase2-payoff-floor (mini-pilot: does an aggressive prompt-only setup/payoff floor on pre-planner-pha…
- #229 [sft_training] Small-model POC — Qwen3-1.7B halluc-checker on Together AI (400-pair v2 train set)
- #205 [validation_sweep] v3 narrow-strip production sweep on fantasy-system-heretic
- #204 [validation_sweep] v3 narrow-strip production sweep on fantasy-tower-cartographer
- …50 more (query tuning_experiments WHERE conclusion IS NULL)

## Recently closed (top 5)
- #241 [infrastructure] Status dashboard + Codex preamble generator. Completes session-handoff ranked priorities #2 + #3. scripts/status.ts = o…
- #240 [infrastructure] WorkflowPage UI — visual dashboard of the Claude+Codex orchestration pattern captured in .claude/skills/implement-ticke…
- #239 [validation_sweep] Clean no-forced-flags validation run, RE-attempt. Experiment #238 FAILed environmentally — orchestrator had DEBUG_FORCE…
- #238 [validation_sweep] Clean no-forced-flags validation run: verify exhaustion handlers stay silent on a normal novel that never exhausts retr…
- #237 [charter] Non-blind-retry architecture + V2 debug-injection interceptor. Round A (exhaustion-handler architecture: plan-assist ga…

## Architectural decisions (last 7 days)
- Exhaustion-handler 5-step architecture canonicalized (2026-04-19)
- Debug-injection MVP as test-only infrastructure (2026-04-19)
- PipelineBailError auto-mode contract (2026-04-19)
- Non-blind-retry as canonical quality gate (2026-04-19)
- Round A + Round B architecture — non-blind-retry shipped, V2 interceptor Phase 1 coexisting with V1 (2026-04-19)
- Context-engineering-forward architecture — craft is a model problem, not a prompt problem (2026-04-18)
- Hallucination-checker narrow scope — two categories, no taxonomy (2026-04-18)
- Enterprise-grade labeling SOP — rubric + gold examples + κ monitoring (2026-04-18)
- Hallucination-checker v2 — chapter-plan methodology replicated, synth-to-natural distribution shift confirmed (2026-04-18)
- Hallucination-checker v3 — two-adapter architecture (ungrounded-entity + Salvatore-leak), name-drift dropped (2026-04-18)
- …40 more (see docs/decisions.md)

## Pattern watch-list (docs/patterns/)
- in-memory-state-restart-data-loss — Any in-memory-only state (JS `Map`, module-level `let`, `const` cached across calls) that the pipel…
- fetch-without-abortcontroller — `fetch()` without an `AbortController` signal will hang indefinitely if the remote socket drops sil…

## Repo-specific failure classes to look for
> Canonical registry: `docs/invariants.md`. The list below is the quick-reference subset.
1. Restart state — in-memory guards (`let flag = false`) must persist to DB if the guard is load-bearing across restarts
2. Retry-path truth — every timeout/network failure must enter retry, no fast-fail branches
3. Event-emission symmetry — if a state transition fires event E on branch A, branch B to the same state must also fire E
4. Seam coverage — forced-flag injections must cover every recheck site (initial + settle-loop + recheck-after-revision)
5. Replayable observability — don't use persisted trace events as 'happened after X' signals if the stream replays history on connect
6. Target-runtime state validation — probe the target process's env/state directly; local process.env doesn't catch contamination in the orchestrator process
7. Body-already-used — any template literal with `await X.text()` that is ALSO followed by `await X.json()` on the same Response object
8. Fail-open coverage — matcher errors, applyAction errors, AND enrichment errors all need try/catch with fail-open semantics

## What this preamble OMITS (cite repo refs on demand)
- Full architecture narrative → `CLAUDE.md` + `docs/current-state.md` + `/app/guide`
- Specific bug details → commit refs + `git show <sha>`
- Session retrospectives → `docs/sessions/YYYY-MM-DD-*.md`
- Full pattern docs → `docs/patterns/<slug>.md`
- Full decisions rationale → `docs/decisions.md` (titles above, full bodies there)
- Full invariants registry → `docs/invariants.md` (shape taxonomy + allowlist + status)

