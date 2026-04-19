# novel-harness Codex preamble — 2026-04-19T20:20:47.530Z

> Regenerated preamble. Commit-pinned to `ce34df9`. Cite `git show ce34df9` in any review response.

## Open experiments (20)
- #241 [infrastructure] Status dashboard + Codex preamble generator. Completes session-handoff ranked priorities #2 + #3. scripts/status.ts = o…
- #236 [charter] Charter — planner-phase2-payoff-floor (mini-pilot: does an aggressive prompt-only setup/payoff floor on pre-planner-pha…
- #229 [sft_training] Small-model POC — Qwen3-1.7B halluc-checker on Together AI (400-pair v2 train set)
- #205 [validation_sweep] v3 narrow-strip production sweep on fantasy-system-heretic
- #204 [validation_sweep] v3 narrow-strip production sweep on fantasy-tower-cartographer
- …15 more (query tuning_experiments WHERE conclusion IS NULL)

## Recently closed (top 5)
- #240 [infrastructure] WorkflowPage UI — visual dashboard of the Claude+Codex orchestration pattern captured in .claude/skills/implement-ticke…
- #239 [validation_sweep] Clean no-forced-flags validation run, RE-attempt. Experiment #238 FAILed environmentally — orchestrator had DEBUG_FORCE…
- #238 [validation_sweep] Clean no-forced-flags validation run: verify exhaustion handlers stay silent on a normal novel that never exhausts retr…
- #237 [charter] Non-blind-retry architecture + V2 debug-injection interceptor. Round A (exhaustion-handler architecture: plan-assist ga…
- #235 [data-generation] halluc-leak-salvatore vocabulary expansion — 49 tokens × 5 examples via DeepSeek

## Architectural decisions (last 7 days)
- Extractor V1 adapters trained — structural eval passed, content eval pending (2026-04-13)
- Extraction architecture audit — 3 of 4 extractors redundant with planner (2026-04-13)
- Tonal pass V4 verdict — lexical-only, dead end as a voice tool; writer-side style training is the path forward (2026-04-14)
- Tonal pass stores a separate version; on-demand run for existing novels (2026-04-14)
- Canonical corpus-bundle architecture with 14 conservation invariants (2026-04-17)
- Regex-based prose evaluation is a last resort, not a default (2026-04-17)
- Per-task model selection for corpus pipeline — validated head-to-head (2026-04-17)
- Programmatic DeepSeek V3.2 for corpus-wide extraction tasks (replaces Sonnet subagents) (2026-04-17)
- Salvatore bundle — complete corpus re-ingestion post-audit (2026-04-17)
- Two-phase planner (skeleton + per-chapter beat expansion) with beat-count floor (2026-04-17)
- …40 more (see docs/decisions.md)

## Pattern watch-list (docs/patterns/)
- in-memory-state-restart-data-loss — Any in-memory-only state (JS `Map`, module-level `let`, `const` cached across calls) that the pipel…
- fetch-without-abortcontroller — `fetch()` without an `AbortController` signal will hang indefinitely if the remote socket drops sil…

## Repo-specific failure classes to look for
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

