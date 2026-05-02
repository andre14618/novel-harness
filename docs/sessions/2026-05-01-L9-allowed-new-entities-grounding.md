---
status: shipped
updated: 2026-05-01
loop: L9
---

# L9 — Thread allowedNewEntities into halluc-ungrounded grounded surface

## Loop Contract

- Objective: Close the legitimate walk-on FP class in the NER prepass by confirming `allowedNewEntities` is wired into both the LLM context surface and the `buildNerGroundedSet` grounded union, then add acceptance tests and a panel fixture.
- Starting commit: 67b0d1b
- Experiment ID: 325
- Budget cap: $1 (code-only, no LLM calls)
- Primary lever under test: threading `scene.obligations.allowedNewEntities` through the halluc-ungrounded grounded surface so sanctioned new entities (walk-ons, props, lore terms) are not flagged by NER prepass or LLM stage
- Files/scripts expected to change:
  - `src/agents/halluc-ungrounded/index.test.ts` (4 new tests)
  - `scripts/hallucination/synthetic-allowed-new-entity-fixtures/allowed-walk-on.jsonl` (new fixture file)
  - `docs/sessions/2026-05-01-L9-allowed-new-entities-grounding.md` (this file)
  - `docs/todo.md` (close §7 first + third sub-bullets)
  - `docs/decisions.md` (append L9 entry)
- Evidence artifact: test pass count, `bunx tsc --noEmit` clean
- Stop condition: code lands + tests pass + tsc clean + commit posted
- Escalation condition: git conflict on L8-touched files (`src/agents/writer/adherence-checker.ts`, `scripts/hallucination/run-two-stage-adherence-panel.ts`) — stop and report

## Baseline

- Current behavior: `allowedNewEntities` was already threaded into `context.ts` (commit `5054fd4`) and into `buildNerGroundedSet` in `index.ts` (commit `f019c60`). The `groundedSources` snapshot carries `allowed_new_entities`. BUT: no unit tests in `index.test.ts` exercise the allowedNewEntities path, and no panel fixture exists.
- Baseline tests: `bun test src/agents/halluc-ungrounded/` → 31/31 pass before this loop
- Baseline tsc: clean

## Pre-Loop Recon Finding

Commits `5054fd4` and `f019c60` already completed the code wiring that the loop contract describes:
- `context.ts` appends `Allowed-new-entities:` to the WORLD BIBLE block
- `index.ts` passes `allowedNewEntities` into `buildNerGroundedSet` AND records it in `groundedSourcesObj.allowed_new_entities`
- `normalizeForGroundedMatch` is applied in `buildNerGroundedSet` via the four-tier check

What remains:
1. Tests (a)-(d) in `index.test.ts` — NOT yet present
2. Panel fixture file — NOT yet present
3. Todo/decisions/experiment tracking — NOT yet done

## Command Plan

- Step 1: Add 4 tests to `src/agents/halluc-ungrounded/index.test.ts`
- Step 2: Create `scripts/hallucination/synthetic-allowed-new-entity-fixtures/allowed-walk-on.jsonl`
- Step 3: Run `bun test src/agents/halluc-ungrounded/` and `bunx tsc --noEmit`
- Step 4: Create and conclude DB experiment (LXC has Postgres; local may not — use SSH)
- Step 5: Update `docs/todo.md` and `docs/decisions.md`
- Step 6: Commit in 3 batches per commit-conventions.md

## Progress Log

- [2026-05-01] L9 started. Recon: code already wired; writing tests + fixture now.
- [2026-05-01] 4 new tests added to index.test.ts. Panel fixture created. Tests pass (35/35). tsc clean. DB experiment created and concluded. Docs updated. Commits posted.

## Results

- Outcome: SHIPPED
- Tests: 35/35 pass (was 31/31 pre-loop; +4 new allowedNewEntities tests)
- tsc: clean
- Cost: $0 (code-only)
- Commits: see git log after this doc is committed

## Pickup Instructions

- Last safe command: all committed
- If failed, failure fingerprint: n/a
- Next action: next open §7 item is "Teach/verify the mapper emits allowedNewEntities only when a new named entity is sanctioned"
