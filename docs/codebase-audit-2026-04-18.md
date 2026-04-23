# Codebase Audit — 2026-04-18

## Scope

This review covers the current working tree on `2026-04-18`, not just the last clean commit.

- Repo snapshot reviewed: current local branch `main`, which is `11` commits ahead of `origin/main`
- Recent delta from `origin/main`: `36 files changed`, `+3215 / -154`
- Repo shape at review time:
  - `src/`: `180` files
  - `src/seeds/`: `38` seed files
  - `sql/`: `27` migrations
- Worktree state: already dirty before this review; findings below include both committed code and current local edits

## Method

I did not try to execute networked LLM or DB flows. I reviewed the codebase holistically through:

- repository inventory (`src`, `ui`, `sql`, `scripts`, `docs`)
- recent git history and diff shape
- backend entry-point review (`src/index.ts`, `src/orchestrator/server.ts`, `src/orchestrator/novel-routes.ts`)
- runtime/config/model/transport review
- UI contract review (`ui/src/api.ts`, SSE hooks, config/models/experiments pages)
- static verification surfaces

## Verification Results

| Check | Result | Notes |
|---|---|---|
| `bun test` | Fail | Output: `No tests found!` |
| Root TS check: `./ui/node_modules/.bin/tsc -p tsconfig.json --noEmit` | Fail | `76` TS errors |
| UI TS check: `./ui/node_modules/.bin/tsc -p ui/tsconfig.json --noEmit` | Pass | UI compiles cleanly in isolation |
| UI build: `bun run --cwd ui build` | Pass | Frontend bundle builds |
| `bun build src/orchestrator/server.ts --outfile /tmp/orchestrator.js` | Fail | unresolved imports under `../../models/*` |
| `bun build --target bun src/index.ts --outfile /tmp/index.js` | Fail | unresolved import `../data/connection` from `src/models/roles.ts` |
| Runtime spot check: `getTokenCost(...)` | Fail | `openrouter` and `wandb` paths returned `NaN` |

## Executive Summary

The repo has a real architecture underneath it: good separation of agents, phases, DB modules, model registry, seeds, docs, and a UI that still builds. The problem is not “Claude wrote messy code.” The problem is integration drift. Several parts of the system have been moved or retired without the rest of the codebase being updated to match.

The highest-risk issues are not cosmetic:

- the orchestrator has dead imports and an undefined symbol
- one authenticated route is vulnerable to shell command injection
- cost accounting returns `NaN` for some providers
- the event protocol is inconsistent across backend and UI
- the documented/current pipeline state is badly out of sync
- there is effectively no enforced regression gate on the main codepath

My judgment: this codebase has solid ideas and useful infrastructure, but it is currently in a research-lab state, not an operationally reliable one.

## Highest-Priority Findings

### 1. Orchestrator and backend integration are currently broken

Severity: Critical

This is the most important finding. The orchestrator cannot be treated as a releasable surface right now.

Evidence:

- `src/orchestrator/server.ts:283`, `:295`, `:320`, `:361` import `../../data/db`, but there is no `data/db` in the repo.
- `src/orchestrator/server.ts:412`, `:413`, `:489`, `:503` import `../../models/*`, but the real files live under `src/models/*`.
- `src/orchestrator/novel-routes.ts:40-41`, `:73`, `:85-87`, `:141-142`, `:187`, `:199` repeat the same broken `../../models/*` pattern.
- `src/models/roles.ts:322`, `:338` import `../data/connection`, but the actual connection file is `src/db/connection.ts`.
- `src/orchestrator/server.ts:164` references `loginPageHtml()`, but there is no definition or import for it anywhere in `src/`.
- `bun build src/orchestrator/server.ts` fails immediately on unresolved imports.
- `bun build --target bun src/index.ts` fails on the unresolved `../data/connection` import.

Impact:

- experiment routes are dead or route-fail on demand
- model/config endpoints are dead or route-fail on demand
- generation-config persistence is dead
- the orchestrator build surface is broken even before runtime secrets/DB/network come into play
- the repo is carrying partial refactors (`data/` → `db/`, path moves under `src/`) that were never closed out

Recommendation:

- finish the `data/` → `db/` migration in one pass
- replace every stale relative import with the real `src/*` path
- add a CI gate that must pass before merge:
  - `./ui/node_modules/.bin/tsc -p tsconfig.json --noEmit`
  - `./ui/node_modules/.bin/tsc -p ui/tsconfig.json --noEmit`
  - `bun build src/orchestrator/server.ts --outfile /tmp/orchestrator.js`
  - `bun build --target bun src/index.ts --outfile /tmp/index.js`

### 2. `/api/run/novel` is vulnerable to shell command injection

Severity: Critical

Evidence:

- request body is accepted directly in `src/orchestrator/server.ts:257-261`
- `spawnNovel()` constructs a shell string in `src/orchestrator/server.ts:115-124`
- user-controlled `seed` is appended directly into `cmd`
- execution is done through `Bun.spawn(["bash", "-c", cmd], ...)`

Why this matters:

Any authenticated caller who can hit `/api/run/novel` can inject shell metacharacters via `seed`. This is a direct remote code execution footgun behind auth, not a hypothetical code smell.

Recommendation:

- never shell-string interpolate request data
- replace with argumentized spawn, e.g. `["bun", "src/index.ts", "--auto", "--seed", seed]`
- validate `seed` against the actual seed list from `src/seeds/`
- if arbitrary custom seed selection is needed, pass structured JSON through stdin or a temp file, not the shell

### 3. Cost accounting is wrong for non-cached providers

Severity: High

Evidence:

- `src/models/registry.ts:851-856` calculates:
  - `const cache = PROVIDERS[provider]?.cache`
  - `const cachedRate = cache ? model.pricing.input * (1 - cache.discount) : model.pricing.input`
- providers such as `openrouter`, `wandb`, `together`, and `fireworks` have cache objects without a `discount` field when `type: "none"`
- local runtime check produced:

```text
openrouter NaN
wandb NaN
groq 0.000585
```

Impact:

- `llm_calls.cost` can become `NaN`
- run summaries become unreliable
- experiment totals and comparison pages become misleading
- any downstream decision-making using cost data is suspect

Recommendation:

- default missing `discount` to `0`
- only apply cached-token math when `cachedTokens > 0` and `cache.type === "automatic"`
- add a unit test for representative providers:
  - cached provider with discount
  - provider with `type: "none"`
  - W&B artifact URI fallback

### 4. The SSE/event contract is internally inconsistent

Severity: High

Evidence:

- `src/events.ts:9-13` restricts `NovelEvent.type` to:
  - `phase:changed`
  - `gate:waiting`
  - `gate:resolved`
  - `progress`
  - `error`
  - `done`
- `src/events.ts:39-44` emits `type: "connected"`
- `src/agents/tonal-pass/run.ts:44-52` emits `type: "tonal-progress"`
- `src/orchestrator/novel-routes.ts:780`, `:790`, `:801`, `:812`, `:815` emit:
  - `tonal-start`
  - `tonal-chapter-start`
  - `tonal-chapter-done`
  - `tonal-done`
  - `tonal-error`
- the root TS check fails on those mismatches
- the UI side steps the issue by using `ui/src/api.ts:622-626`, where `SSEEvent.type` is just `string`

Impact:

- backend and frontend do not share a real protocol contract
- new event types can silently drift without review
- typechecking catches the backend mismatch, but the UI opts out entirely

Recommendation:

- define one shared event union in a single module and consume it from both server and UI
- include `connected` and all tonal events explicitly
- stop using `type: string` in the UI for this protocol

### 5. User-facing product state is out of sync with actual pipeline behavior

Severity: High

This repo has a “current truth” problem. Several user-visible surfaces disagree with the actual code.

Evidence:

- README says the primary writer is Cerebras:
  - `README.md:44`
- actual writer config is DeepSeek:
  - `src/models/roles.ts:30-36`

- README says validation auto-runs a tonal pass:
  - `README.md:38-39`
- actual pipeline disables auto tonal pass:
  - `src/config/pipeline.ts:9-13`
  - `src/phases/validation.ts:93-120` only runs tonal pass when `pipeline.tonalPass` is true

- README says `src/transport.ts` contains both `DirectTransport` and `BatchTransport`:
  - `README.md:47`
- `src/transport.ts:66-120` only implements `DirectTransport`

- README says there is a `tests/` Bun suite:
  - `README.md:85`
- repo has no `tests/` directory, and `bun test` reports `No tests found!`

- README says there are `20` SQL migrations:
  - `README.md:82`
- actual repo contains `27`

- UI still presents `rewriter` as an active validation-stage agent:
  - `ui/src/components/PipelineFlow.tsx:12`, `:27`
  - `ui/src/components/ConfigPage.tsx:7-28`
- but rewriter was explicitly removed:
  - `src/agents/index.ts:8`
  - `src/phases/validation.ts:16-27`

- `ui/src/components/FinetunePage.tsx:31`, `:86-88` says voice now lands via “DeepSeek + Howard primer”
- code comments say Howard methodology is retired and voice now lands through per-genre voice LoRAs:
  - `src/models/roles.ts:30-34`
  - `src/config/pipeline.ts:12`

Impact:

- new contributors cannot tell which system description is authoritative
- the UI exposes controls for removed concepts
- docs overstate supported behavior and testing maturity
- debugging time increases because stale documentation looks “official”

Recommendation:

- explicitly split docs into:
  - current operational truth
  - historical research notes
- make README describe only what is currently true
- make user-facing UI pages derive agent lists from live config instead of hard-coded names

## Important Structural Findings

### 6. The repo advertises strict TypeScript, but it is not living up to it

Severity: High

Evidence:

- `tsconfig.json:6` enables `"strict": true`
- root TS check reports `76` errors
- many are not edge-case type refinements; they are real drift indicators:
  - unresolved imports
  - undefined symbols
  - event contract mismatches
  - implicit `any` throughout DB/harness modules
- `package.json:5-8` has no `typecheck` or `build` scripts
- `tsconfig.json:13` only includes `src/**/*.ts`; `scripts/` are not typechecked at all

Why this matters:

The repo currently gets the maintenance cost of TypeScript without the safety benefit. Worse, the existence of `strict` creates a false sense of enforcement.

Recommendation:

- add explicit scripts:
  - `typecheck`
  - `typecheck:ui`
  - `build:server`
  - `build:ui`
- fail CI on them
- treat “no unresolved import paths” and “no undefined symbols” as zero-tolerance
- stage the implicit-`any` cleanup after the broken-path cleanup

### 7. Runtime admin operations mutate source files and source-adjacent state

Severity: Medium

Evidence:

- `src/models/roles.ts:119-172` persists overrides by rewriting `src/models/roles.ts` with regex
- `src/models/hidden.ts:7` stores hidden-model state under `src/data/hidden-models.json`
- `src/models/hidden.ts:27-31` writes that file at runtime

Impact:

- production actions create git drift
- behavior depends on the deploy filesystem being writable
- regex-rewriting code is brittle and hard to review
- operational state is mixed with source state

Recommendation:

- move all mutable runtime config into Postgres or a dedicated config directory outside `src/`
- never rewrite checked-in source files from a web route

### 8. Browser auth still depends on query-string API keys

Severity: Medium

Evidence:

- `src/orchestrator/server.ts:43-57` accepts `?key=...` as auth
- `src/orchestrator/server.ts:644-645` logs the full UI URL including the key
- `ui/src/api.ts:1-7` reads the key from `window.location.search`
- `ui/src/api.ts:202-206` appends the key into export URLs
- `ui/src/hooks/useNovelSSE.ts:38-42` appends the key into SSE URLs
- `ui/src/components/ExperimentsPage.tsx:3-4` appends `?key=` to API calls

Impact:

- keys leak into browser history
- keys leak into logs/screenshots/copy-pasted URLs
- auth model is split between cookie session and API key query fallback

Recommendation:

- use cookie session auth for browser traffic only
- keep API keys in headers for machine/API clients only
- remove `?key=` fallback from the UI
- stop logging the UI URL with the secret embedded

## Lower-Priority but Real Issues

### 9. Process supervision captures stdout but ignores stderr

Severity: Medium

Evidence:

- `src/orchestrator/server.ts:119-123` pipes both stdout and stderr
- `src/orchestrator/server.ts:86-100` only reads stdout

Impact:

- failures are harder to diagnose from the orchestrator UI/API
- child-process errors disappear unless separately logged by the child

Recommendation:

- capture stderr alongside stdout
- store both in tracked process status, or at minimum expose stderr tail separately

### 10. In-memory token totals are global, not run-scoped

Severity: Low

Evidence:

- `src/llm.ts:377-380` stores token counters in module-global `totalTokens`
- `src/llm.ts:433-434` increments them on every call
- `src/state-machine.ts:79` reads them at novel completion
- there is no reset per novel run

Impact:

- run summaries can include prior runs handled by the same process
- the code already expects mismatch by comparing in-memory totals with DB totals

Recommendation:

- either remove the in-memory summary entirely and trust DB totals
- or scope counters per `novelId` / `runId`

## Why These Problems Likely Happened

The repo shows a consistent pattern:

- architecture is being actively evolved
- research/feature iteration is fast
- old names and old paths are being retired
- verification gates are not keeping pace

The strongest signal is the partial migration from older module locations (`data/`, old agent inventory, Howard-primer/rewriter assumptions) to the newer structure (`db/`, DeepSeek + voice-pack writer, rewriter removed). The codebase is not primarily suffering from “bad logic”; it is suffering from “the old world was not fully deleted.”

## What Is Actually Good Here

This audit is not saying the repo is junk. There are meaningful strengths:

- The top-level architecture is coherent: `agents/`, `phases/`, `db/`, `models/`, `orchestrator/`, `ui/`.
- Model/provider centralization in `src/models/registry.ts` is the right idea.
- The UI is substantial and still builds cleanly.
- The docs are rich; there is real experimentation and learning captured here.
- The pipeline comments are often unusually candid about why changes were made.

That is exactly why the drift is fixable: there is enough structure here to recover reliability quickly once the repo is put back under hard verification.

## Recommended Remediation Order

### Phase 1: Stop shipping broken surfaces

1. Fix all stale import paths under `src/orchestrator/*`, `src/models/roles.ts`, and `src/lint/fixers/*`.
2. Define or remove `loginPageHtml`.
3. Fix `getTokenCost` so it never returns `NaN`.
4. Remove shell command construction from `spawnNovel()`.

### Phase 2: Re-establish a trustworthy contract

1. Create one shared SSE event schema for backend + UI.
2. Remove `rewriter` and Howard-primer references from current-state UI pages.
3. Rewrite README to reflect the actual pipeline and validation status.
4. Separate “historical decisions” from “current operating mode.”

### Phase 3: Make regressions expensive

1. Add root build/typecheck scripts.
2. Add CI for root TS, UI TS, orchestrator build, CLI build.
3. Add a small unit test file for:
   - `getTokenCost`
   - event typing/schema
   - path-sensitive config loading

### Phase 4: Clean up operational hygiene

1. Move mutable runtime state out of source files.
2. Remove browser query-param auth.
3. Capture stderr in process tracking.

## Bottom Line

The codebase is promising but inconsistent in exactly the places that make a system feel reliable: buildability, contract ownership, auth boundaries, and source-of-truth discipline.

If I had to compress the verdict to one sentence:

> Strong architecture, weak integration discipline.

The highest-value next step is not adding another feature. It is making the current system build-clean, contract-clean, and doc-clean again.
