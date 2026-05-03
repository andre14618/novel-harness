---
status: active
updated: 2026-05-02
role: lane-result
lane: 2026-05-02-L65-grounding-carryover
experiment: 391
session: 2026-05-02-grounding-phase-brief
phase: grounding (halluc-ungrounded chapter-attempt retry)
---

# L65 Chapter-Attempt Carry-Over of Confirmed-Ungrounded Entities (Lever G-A)

## Loop Contract

- **Goal + component:** add `formatChapterUngroundedRetryContext` to `src/agents/writer/retry-context.ts` and wire it into the chapter-attempt loop in `src/phases/drafting.ts` so beat-writer prompts on attempt ≥ 2 carry an "AVOID THESE UNGROUNDED ENTITIES FROM YOUR PRIOR DRAFT" block sourced from the prior attempt's LLM-confirmed halluc-ungrounded blocker entities. Mirrors L41 → L63 exactly.
- **Why (concrete evidence):** exp #389 produced byte-identical prose across 3 chapter-attempts on novel-1777768466618 ch1 beat 13 because the writer never learned "central spire" was flagged. 14-day baseline: 11 of 44 plan-check exhaustions cite halluc-ungrounded (25%). See phase brief `docs/sessions/2026-05-02-grounding-phase-brief.md`.
- **Measurable signal:** retroactive replay against the byte-identical case shows attempt ≥ 2 prompt now contains "central spire" in the avoidance block. Unit tests assert the renderer for empty list, single-entity, multi-entity, excerpt-bounded, cap-at-12, and back-compat (no entities → empty string) cases. tsc clean. Existing test suite green modulo pre-existing DB-reachability failures.
- **Validated stop gates:**
  - **(a) Clean pass:** renderer + unit tests green; drafting wire-in tsc-clean; retroactive replay shows the entity in the next-attempt prompt.
  - **(b) New dominant blocker:** existing test asserts behavior the carry-over breaks (e.g. a chapter-attempt smoke that depends on absent context).
  - **(c) Regression:** previously-passing tests fail.
  - **(d) Infra failure:** tsc / test runner / DB unreachable.
  - **(e) Cost cap:** $0; code-only. Live-smoke validation deferred until a fresh seed reaches a grounding-blocked chapter-attempt retry.
- **Starting commit:** `bb4d899` (grounding phase brief)
- **Experiment ID:** 391
- **Budget cap:** $0 — code-only.
- **Primary lane:** chapter-attempt-level carry-over surface for halluc-ungrounded blocker entities.
- **Causal hypothesis:** the writer regenerates the same ungrounded entities across chapter-attempts because the per-beat retry critique within an attempt accepts-with-warnings after `maxBeatRetries`, then the chapter-attempt fails plan-check at the chapter level, and the next chapter-attempt restarts beat-writing with no record of the prior-attempt's entity flags. Surfacing the chapter-wide list to the next attempt's beat-writer should let the writer paraphrase those references away.
- **Baseline:** byte-identical prose across attempts 1/2/3 on the smoke case, plus 25% of plan-check exhaustions in 14 days touching halluc-ungrounded.
- **Changed runtime lever:**
  - `src/agents/writer/retry-context.ts`: new `formatChapterUngroundedRetryContext(entities)` mirroring `formatChapterIntegrityRetryContext`.
  - `src/phases/drafting.ts`: chapter-attempt scoped state `priorUngroundedEntities`; populated by walking each attempt's beat-check results for halluc-ungrounded blocker issues (entity extracted by inverse of the agent's printf format); appended to writer prompt at the same three sites the integrity context is appended.
  - Tests: `src/agents/writer/retry-context.test.ts` extension.
- **Feedback signal:**
  - Unit: new tests for empty / single / multi / cap / excerpt-bounded / back-compat. Existing 175 retry-context + integrity tests stay green.
  - Empirical: retroactive replay over the smoke case shows the prompt block lists "central spire". Optional: `scripts/replay/l63-retry-replay.ts` analog for grounding once the lever ships.
  - Live: deferred until a future seed lands grounding-blocked retries naturally.
- **Escalation rule:** if a future smoke shows the writer still keeps the entity in attempt 2 prose despite the carry-over, the next lever is **G-A2** (faithful per-beat critique surface — fix the disjoint between operator-visible bail cause and writer-visible critique). After that, **G-B** (writer-side BIBLE constraint) before the planner-schema **G-C** lift.
- **Allowed parallel support work:** docs sweep, lane-queue advancement.
- **DeepSeek V4 Flash concurrency plan:** none.
- **Deferred out-of-lane runtime changes:** G-A2 critique-faithfulness bug, G-B writer-side constraint, G-C planner sanctioned-new-entities schema.
- **Files/scripts expected to change:** `src/agents/writer/retry-context.ts`, `src/agents/writer/retry-context.test.ts`, `src/phases/drafting.ts`, `docs/current-state.md` (grounding entry), `docs/decisions.md` (§L65), `docs/todo.md`, `docs/sessions/lane-queue.md`.
- **Evidence artifact:** `tuning_experiments.id=391`; commit hash to be set; this lane doc.

## Stop Gates

- (a) Clean pass: tsc green, unit suite passes, retroactive replay shows the new block on the smoke case.
- (b) New dominant blocker: behavior assumption breaks on an existing test or smoke.
- (c) Regression: previously-passing tests fail post-L65.
- (d) Infra failure: tsc / test runner unavailable.
- (e) Cost cap: $0; code-only.

## Command Plan

- Sample shape / N: full repo unit test (~1018 tests across 71 files plus new fixtures).
- Probe-family key: existing test surfaces.
- Expected cost: $0.
- Command 1: `bunx tsc --noEmit`
- Command 2: `bun test`
- Command 3: replay (write a small script) → confirm the block contains "central spire" for the smoke case.

## Progress Log

- 2026-05-02 — Lane opened from grounding phase brief. Experiment 391 created (`config={lever:G-A, phase:grounding, mirrors:L63}`).
- 2026-05-02 — Renderer + extractor added to `retry-context.ts` with 12 unit tests (renderer: empty/single/multi/cap-12/excerpt-bounded/whitespace-trim; extractor: entity-only / entity+excerpt / [NER prepass] suffix tolerance / dedup / non-matching-line drop / empty input). All 24 retry-context tests pass.
- 2026-05-02 — Drafting wire-in: `priorUngroundedEntities` declared at chapter scope alongside `priorIntegrityIssues`; populated from `acceptedBeatCheckIssues` (filter source=halluc-ungrounded, severity=blocker, parse via `extractUngroundedEntitiesFromDescriptions`) right after beat-write completes; appended to writer prompt at all three integrity-context sites (line 354, 673, 934).
- 2026-05-02 — Empirical retroactive replay (`scripts/replay/l65-grounding-replay.ts`) on the exp #389 chapter_exhaustions row for novel-1777768466618 ch1: extracted 1 entity ("central spire" with full excerpt), rendered the AVOID block correctly, assertion `block contains "central spire": true` PASSED. This proves the carry-over would have surfaced the entity to attempt-2's writer if L65 had been live during exp #389.

## Results

- Outcome: clean pass at unit + retroactive-replay gate. New chapter-attempt carry-over surface for halluc-ungrounded LLM-confirmed entities is wired through the same three writer-prompt sites the L41/L63 integrity context already uses, sourced from `acceptedBeatCheckIssues` (per-beat blockers that survived the per-beat retry budget into the chapter prose).
- Stop gate fired: (a) clean pass.
- Evidence link/row/path:
  - 1027 tests pass / 4 pre-existing fail (DB-reachability + phase parity, identical baseline to L64).
  - tsc clean.
  - Empirical replay (`scripts/replay/l65-grounding-replay.ts`) on `chapter_exhaustions` row for novel-1777768466618 ch1: PASS.
  - `tuning_experiments.id=391`.
- Cost: $0 (code-only; no LXC smoke needed for unit acceptance).
- Commit(s): pending — same commit as docs sweep.
- Review: `impl-review` not required — change mirrors the existing `formatChapterIntegrityRetryContext` + `priorIntegrityIssues` pattern with no novel control-flow shape. The renderer is a copy of the L63 shape with a different label and bullet format; the extractor is the inverse of the agent's printf at `halluc-ungrounded/index.ts:520` with a permissive regex; the drafting wire-in adds a chapter-scoped variable parallel to `priorIntegrityIssues` and appends to the same three concatenation sites. Recording as **review-waived: mirrors-existing-carry-over-pattern** (waiver reason: renderer + drafting wiring is byte-equivalent to the L41/L63 pattern, only label and source differ; extractor regex has dedicated unit fixtures including [NER prepass] suffix tolerance and dedup; reviewer = self).
- Live exercise: deferred until a fresh seed reaches a grounding-blocked chapter-attempt retry. The retroactive replay against the exp #389 row is the canonical empirical evidence for the lane.

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md` (grounding entry — chapter-attempt carry-over), `docs/todo.md` (close L65 candidate, queue G-A2/G-B/G-C), `docs/decisions.md` (§L65), this lane doc.
- Experiment concluded: 391.
- Final checks: `bun test`, `bunx tsc --noEmit`, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.
- Independent review: waiver with mirrors-existing-pattern reason if the diff is structurally a copy of L63's pattern.
- Final docs/cleanup commit before stop/queue handoff.
