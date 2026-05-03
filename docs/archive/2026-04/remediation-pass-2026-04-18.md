# Remediation Pass Plan — 2026-04-18

> **HISTORICAL — superseded.** Execution plan derived from the (also historical) audit on 2026-04-18. The bulk of the items listed here have been addressed in subsequent commits — `bun test` now runs, root TS is down to ~12 errors (see exp #298), CLI shell-out path was patched, etc. Some items in the further-out sections may still be valid; treat individual entries as candidates rather than active work. For current pending work see [`todo.md`](todo.md).

This document is meant as an execution handoff for Claude. It converts the audit in [codebase-audit-2026-04-18.md](./codebase-audit-2026-04-18.md) into a bounded remediation sequence.

## Context

The current worktree is already dirty. Do not revert unrelated edits. Treat this as a surgical pass against current breakage, not a cleanup crusade.

Current verified state:

- `bun test` fails because there are no tests
- root TS check fails with `76` errors
- UI TS check passes
- UI build passes
- backend/orchestrator build surfaces fail on unresolved imports
- `getTokenCost()` returns `NaN` for some providers
- `/api/run/novel` currently shells user input through `bash -c`

## Goal

Restore operational integrity to the current pipeline before doing broader cleanup.

Concretely:

1. Make the CLI/orchestrator codepaths buildable again.
2. Remove the obvious security footgun.
3. Fix broken cost accounting.
4. Reconcile the event/type contract enough that root TS is no longer red from known drift.

## Pass 1: Critical Build + Security + Contract Repair

### In Scope

#### 1. Fix stale import paths and dead module references

These are hard failures, not style issues.

Targets:

- `src/orchestrator/server.ts`
- `src/orchestrator/novel-routes.ts`
- `src/models/roles.ts`
- `src/lint/fixers/per-sentence.ts`
- `src/lint/fixers/rhythm.ts`

Expected corrections:

- Replace broken `../../models/*` imports from `src/orchestrator/*` with the correct `../models/*` paths.
- Replace broken `../../data/db` imports in `src/orchestrator/server.ts` with either:
  - direct imports from `../db/ops`, or
  - re-exports added to `src/db/index.ts`, then import from `../db`.

  Prefer whichever produces the cleaner long-term surface.

- Replace broken `../data/connection` imports in `src/models/roles.ts` with `../db/connection`.
- Replace broken `../../../models/registry` imports in `src/lint/fixers/*` with `../../models/registry`.

#### 2. Fix the undefined login page symbol

Target:

- `src/orchestrator/server.ts`

`loginPageHtml()` is referenced but not defined or imported. Either:

- implement a minimal local login page helper in the same module, or
- move it into a dedicated module and import it.

Do not leave `/login` half-wired.

#### 3. Remove shell injection from novel spawning

Target:

- `src/orchestrator/server.ts`

Current problem:

- `spawnNovel()` builds a shell string
- request-provided `seed` is interpolated into it
- execution goes through `Bun.spawn(["bash", "-c", cmd], ...)`

Required fix:

- switch to argumentized process spawning
- do not invoke a shell
- validate `seed` before spawning

Recommended shape:

- `Bun.spawn(["bun", "src/index.ts", "--auto", "--seed", seed], ...)`
- if `seed` is present, verify it exists in `src/seeds/` or matches the same source used by the seeds API
- return `400` for invalid seeds rather than letting the child process fail later

#### 4. Fix process stream handling in the orchestrator

Target:

- `src/orchestrator/server.ts`

`proc.stdout` is currently treated as if it always supports `.getReader()`, but Bun types it as `number | ReadableStream`.

Required fix:

- narrow the stream type before reading
- ideally capture `stderr` too, not just `stdout`

Minimum acceptable outcome:

- no type error
- no runtime assumption that `stdout` is always a `ReadableStream`

Preferred outcome:

- preserve stdout tail and stderr tail separately in process status

#### 5. Fix `getTokenCost()` so it never returns `NaN`

Target:

- `src/models/registry.ts`

Current issue:

- providers with `cache: { type: "none" }` do not guarantee `discount`
- cached-rate math assumes `discount` exists

Required fix:

- default missing cache discount to `0`
- only apply cached-token discounted math when the provider cache strategy is actually automatic

Validation target:

- `getTokenCost("openrouter", ...)` returns a number
- `getTokenCost("wandb", "wandb-artifact:///...", ...)` returns a number
- existing cached-provider math still works

#### 6. Repair the event type contract used by the backend

Targets:

- `src/events.ts`
- `src/agents/tonal-pass/run.ts`
- `src/orchestrator/novel-routes.ts`

Current issue:

- backend event union excludes events that backend code actually emits:
  - `connected`
  - `tonal-progress`
  - `tonal-start`
  - `tonal-chapter-start`
  - `tonal-chapter-done`
  - `tonal-done`
  - `tonal-error`

Required fix:

- make the backend type contract match actual emitted events

Do not waste time over-designing a perfect shared schema in this pass. Just make the contract coherent and typed on the backend. UI contract tightening can be a follow-on improvement.

#### 7. Fix obvious type drift that blocks root TS after the above

Targets likely include:

- `src/llm.ts`
- `src/agents/writer/context.ts`
- `src/phases/concept.ts`
- `src/orchestrator/server.ts`
- `src/orchestrator/novel-routes.ts`

Known examples from the current error set:

- `MakeRequestResult.usage` does not include `cached_tokens`, but call sites expect it.
- nullability drift in `src/agents/writer/context.ts`
- generic/null issues in `src/phases/concept.ts`
- path-related inferred `unknown` / `any` fallout in orchestrator routes

Priority rule:

- clear real breakage first
- then clear any remaining TS failures on touched files
- do not paper over broken logic with `as any` unless there is no cleaner option and the reasoning is documented inline

### Out of Scope for Pass 1

Do not expand this pass into broad repo cleanup.

Specifically out of scope:

- rewriting README and current-state docs
- moving runtime mutable state out of `src/`
- removing query-param auth from the browser
- eliminating every implicit `any` in the repo
- adding a comprehensive test suite
- refactoring experimental scripts

If a small doc touch is necessary to keep a user-facing page from lying after a code change, keep it minimal.

## Acceptance Criteria

Pass 1 is complete when all of the following are true:

1. `bun build --target bun src/index.ts --outfile /tmp/index.js` passes.
2. `bun build --target bun src/orchestrator/server.ts --outfile /tmp/orchestrator.js` passes.
3. `./ui/node_modules/.bin/tsc -p tsconfig.json --noEmit` passes, or any remaining failures are clearly outside the touched critical path and documented before stopping.
4. `/api/run/novel` no longer shells untrusted input through `bash -c`.
5. `getTokenCost()` no longer returns `NaN` for `openrouter` or `wandb` examples.
6. Backend event typing matches the events actually emitted.

## Suggested Verification Commands

Run these at the end of the pass:

```bash
./ui/node_modules/.bin/tsc -p tsconfig.json --noEmit
./ui/node_modules/.bin/tsc -p ui/tsconfig.json --noEmit
bun build --target bun src/index.ts --outfile /tmp/index.js
bun build --target bun src/orchestrator/server.ts --outfile /tmp/orchestrator.js
bun -e 'import { getTokenCost } from "./src/models/registry"; console.log("openrouter", getTokenCost("openrouter","qwen/qwen3-32b",1000,500,0)); console.log("wandb", getTokenCost("wandb","wandb-artifact:///andre14618-/novel-harness/continuity-v2:v1",1000,500,0)); console.log("groq", getTokenCost("groq","qwen/qwen3-32b",1000,500,0));'
```

Optional spot check after the spawn fix:

```bash
rg --files src/seeds
```

Use that list as the validation source for accepted seed names.

## Pass 2: Current-Truth Cleanup

Only start this after Pass 1 is stable.

### Scope

- align README with actual pipeline state
- remove stale `rewriter` references from current UI pages
- remove stale “Howard primer is current default” language from current-state UI/docs
- correct counts and claims:
  - migration count
  - tests presence
  - transport capabilities
  - current writer/model statements

### Targets

- `README.md`
- `ui/src/components/PipelineFlow.tsx`
- `ui/src/components/ConfigPage.tsx`
- `ui/src/components/FinetunePage.tsx`
- any other current-state UI page that still advertises removed agents as live

## Pass 3: Operational Hygiene

Only after the system is build-clean.

### Scope

- move mutable hidden-model state out of `src/data/hidden-models.json`
- stop rewriting `src/models/roles.ts` from runtime routes
- remove browser dependence on `?key=...`
- stop logging auth-bearing URLs

### Targets

- `src/models/hidden.ts`
- `src/models/roles.ts`
- `src/orchestrator/server.ts`
- `ui/src/api.ts`
- `ui/src/hooks/useNovelSSE.ts`
- `ui/src/components/ExperimentsPage.tsx`

## Implementation Guidance

- Prefer finishing one vertical fix completely over touching many files shallowly.
- Do not revert unrelated dirty worktree changes.
- If you discover that some “broken import” targets were intentionally deleted, remove the dead route or dead feature instead of reintroducing compatibility scaffolding by default.
- If root TS still fails after the critical path is repaired, list the remaining errors by category before broadening scope.

## Desired Deliverable from Claude

For the first pass, Claude should ideally hand back:

1. the code changes
2. the exact verification results
3. any residual type errors or deferred items
4. whether Pass 2 is now safe to start
