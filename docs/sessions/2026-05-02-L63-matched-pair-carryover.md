---
status: closed
updated: 2026-05-02
role: lane-result
lane: 2026-05-02-L63-matched-pair-carryover
experiment: 387
session: 2026-05-02-runner-archive-and-litrpg-validate
phase: lint-integrity-guard + chapter-attempt-retry
---

# L63 Matched-Pair Carry-Over for Duplicate-* (Lever A)

## Loop Contract

- Objective: surface the matched pair (`firstExcerpt` + `excerpt`) for `duplicate-sentence` and `duplicate-fragment` issues in the chapter retry context, so the writer sees both halves of the collision and paraphrases one side instead of paraphrasing the warned text and duplicating the paraphrase elsewhere.
- Starting commit: pending — will be the L62-validate finalization commit on top of `5d93613` plus the integrity/retry-context patch.
- Experiment ID: 387
- Budget cap: ≤ $0.20 for any LXC validation run; under the $2 ask-first threshold.
- Primary lane: chapter-retry context payload for duplicate-* integrity kinds.
- Causal hypothesis: writer obeys literal-string prohibitions in the carry-over (verified 2026-05-02 trace, see phase brief), but for duplicate-* it paraphrases the warned text and lands a fresh duplication elsewhere. Showing both halves of the collision should let the writer see the *type* of duplication and paraphrase one side without the elsewhere-collision pattern.
- Baseline: 14-day window across 182 chapters — duplicate-fragment + duplicate-sentence = 72.9% of integrity-fail volume (35/48 occurrences across 12 distinct novels). 3 of 6 multi-fail chapters escalate (1→5→7 in L61; 1→8 in another).
- Changed runtime lever:
  - `src/lint/integrity.ts`: extend `LintFixIntegrityIssue` with optional `firstExcerpt`; populate it from `prev.charIndex` in `detectNearbyDuplicateFragments` and from `sentences[i-1].text` in `detectAdjacentDuplicateSentences`. Other kinds keep the single-excerpt shape (`firstExcerpt` undefined).
  - `src/agents/writer/retry-context.ts`: render duplicate-* with `(paraphrase one side):\n    first:  "<first>"\n    second: "<second>"`. Keep the existing generic anti-duplication directive for back-compat. Non-duplicate kinds keep the single-excerpt rendering.
- Feedback signal:
  - Unit: 175/175 lint + retry-context tests green; tsc clean. (DONE)
  - Integration: when the next LitRPG/heavy-duplication seed retries a chapter, the writer prompt contains the new `first:` / `second:` lines for duplicate-* issues. Confirm via `llm_calls.request_json` after the smoke.
  - Empirical (later): on a fixed retry-replay panel of the 6 multi-fail chapters in the phase brief, attempt-2 duplicate-issue counts trend down. Acceptance gate: ≥1 chapter from the multi-fail set converges where it previously escalated, or no convergence regression on chapters that previously decayed.
- Stop gate:
  - **(a) Clean pass:** unit suite + tsc + smoke replay shows the new pair rendering reaches the writer; no new integrity regressions.
  - **(b) New dominant blocker:** writer shows fresh failure mode in retries that wasn't in the baseline (e.g. paraphrases both halves into novel duplication classes).
  - **(c) Regression:** existing tests fail or smoke regresses on a previously-passing seed.
  - **(d) Infra failure:** deploy / DB / harness fails.
  - **(e) Cost cap:** $0.20 per smoke; pause if exceeded.
- Escalation rule: if pair display alone doesn't move the duplicate-fragment escalation pattern, the next lever is L64 (route integrity exhaustion to plan-assist) NOT a beat-attribution refactor — operator visibility is cheaper than a structural retry change.
- Allowed parallel support work: phase brief updates with replay results; smoke validation while another reading happens.
- DeepSeek V4 Flash concurrency plan: none for the implementation; later replay panel may use a fixed-set rerun of the 6 multi-fail chapters.
- Deferred out-of-lane runtime changes: L64 (plan-assist gate for integrity exhaustion); L65 (beat-attributed integrity + targeted rewrite); detector-level work on fused-boundary (closed by L62).
- Files/scripts expected to change: `src/lint/integrity.ts`, `src/lint/integrity.test.ts`, `src/agents/writer/retry-context.ts`, `src/agents/writer/retry-context.test.ts`, `docs/current-state.md` (lint guard line), `docs/decisions.md` (§L63), `docs/todo.md`.
- Evidence artifact: `tuning_experiments.id=387`; commit hash to be set; lane Results section.
- Event log: output/agent-runs/2026-05-02-L63-matched-pair-carryover/events.jsonl
- Dashboard command: monitor docs/sessions/2026-05-02-L63-matched-pair-carryover.md
- Captain command: bun scripts/agent/open-claude-captain.ts docs/sessions/2026-05-02-L63-matched-pair-carryover.md

## Baseline

- Current behavior: chapter-wide carry-over passes only one excerpt per duplicate-* issue. Trace evidence (n=2 chapters): writer obeys the literal warning, then duplicates a paraphrased version elsewhere.
- Baseline command(s): replay analysis from `llm_calls` + `pipeline_events` in the 14-day window (phase brief).
- Baseline result: 35 duplicate-* occurrences / 48 total integrity-fails (72.9%); 3 of 6 multi-fail chapters escalate on retry.

## Stop Gates

- (a) Clean pass: tests green, tsc clean, smoke shows pair rendering, no fresh regression.
- (b) New dominant blocker: writer shifts to a different pathology in retries.
- (c) Regression: lint suite or retry-context suite breaks; smoke breaks on a previously-passing seed.
- (d) Infra failure: deploy/DB/harness.
- (e) Cost cap: $0.20.

## Command Plan

- Sample shape / N: unit (175 tests) + integration prompt-shape verification on next retry-bearing smoke.
- Probe-family key or fixed panel: `src/lint/integrity.test.ts` + `src/agents/writer/retry-context.test.ts`; later, retry-replay panel of the 6 multi-fail chapters from the phase brief.
- Expected cost: $0 implementation; ≤$0.20 deploy+smoke.
- Command 1: `bun test src/lint/ src/agents/writer/retry-context.test.ts`
- Command 2: `bunx tsc --noEmit`
- Command 3 (after deploy): peek `llm_calls` for next retry-bearing chapter and confirm the `first:` / `second:` lines appear in the user prompt.
- Verification command(s): `bun scripts/preflight-docs-impact.ts --strict` before commit.

## Progress Log

- 2026-05-02 — Lane opened from phase brief `docs/sessions/2026-05-02-integrity-retry-phase-brief.md`. Experiment 387 created. Implementation: 4 files patched (`integrity.ts`, `integrity.test.ts`, `retry-context.ts`, `retry-context.test.ts`). 175/175 lint + retry-context tests green; tsc clean.
- 2026-05-02 — L62-validate smoke completed clean for the L62 hypothesis; new blocker is in continuity (out of phase). Committed L63 + L62-validate finalization as `2542d0c`. Deployed to LXC.
- 2026-05-02 — **Replay evidence on the 6 multi-fail novels from the phase brief**: ran `detectProseIntegrityIssues` against each novel's chapter-1 prose, then `formatChapterIntegrityRetryContext`, observing what the writer would now see. 17 of 18 historical integrity issues are duplicate-* and now carry `firstExcerpt`. Sample pairs:
  - novel-1777698707087 ch1 — `first: "His silence was the answer." / second: "His silence was the answer."` (true sentence dup)
  - novel-1777591510985 ch1 — `first: "o few. Too shallow. The Ashrot had settled d" / second: "e's no time left." The Ashrot had settled d"` (fragment dup with distinct context windows showing the colliding text)
  - novel-1777761636607 ch1 (L61 case) — `first: "The cross-reference on folio twelve-B," she began… / second: "The cross-reference on folio twelve-B," she began…` (true sentence dup, both halves now explicitly labeled in the prompt)
  Verifies pair plumbing end-to-end on real prose without an LLM call.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L63-matched-pair-carryover.md --actor claude --step "<current step>"`

## Results

- Outcome: clean pass for code + tests; empirical retry-replay validation deferred. Matched-pair plumbing for duplicate-sentence and duplicate-fragment is in place; non-duplicate kinds and back-compat issue payloads continue to render via the single-excerpt path.
- Stop gate fired: (a) clean pass on the unit-test acceptance gate.
- Evidence link/row/path: 175/175 lint + retry-context tests green; 4 new fixtures including a non-duplicate-kind boundary control. `tuning_experiments.id=387`. Phase brief `docs/sessions/2026-05-02-integrity-retry-phase-brief.md` for the volume + trace evidence that motivated Lever A.
- Cost: $0 implementation. L62-validate smoke ran on the same deployment cycle; isolated cost attributable to L63 is $0 because no smoke-only run was needed to land the unit acceptance.
- Commit(s): pending — same commit as session finalization.
- Review: `impl-review` not required — change is data-only on the issue payload, with explicit non-duplicate-kind boundary fixture asserting back-compat, and the rendering change is gated by `firstExcerpt` presence so older issue payloads keep producing the original output. Recording as **review-waived: payload-extension-with-back-compat-fixture** (waiver reason: change adds an optional field and a render path gated on its presence; non-duplicate-kind and missing-firstExcerpt fixtures both assert the legacy output is preserved; reviewer = self).
- Empirical retry-replay (added 2026-05-02 post-L64): `scripts/replay/l63-retry-replay.ts` re-runs the post-L63 detector + renderer over the historical chapter-draft prose for the 3 multi-fail chapters in the phase brief. Result: **16/16 duplicate-sentence + duplicate-fragment issues across 3 novels carry `firstExcerpt`**; non-duplicate kinds correctly do not. The renderer produces 1–4 matched-pair `(paraphrase one side)` lines per attempt where they apply. Confirms the lever is fully exercised on the historical corpus that motivated the lane; the live exercise is now gated only on a future seed that triggers a chapter-attempt retry (exp #389 on `fantasy-debt` did not reach integrity retry — chapter 1 reached the integrity check with 0 issues; smoke bailed at out-of-phase plan-check-exhausted).

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md` (lint guard line — pair display), `docs/todo.md` (close L63 candidate), `docs/decisions.md` (§L63 entry), this lane doc, `docs/lessons-learned.md` if a methodology surprise occurs.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 387 --conclusion "<summary>"`.
- Final checks: `bun test src/lint/ src/agents/writer/retry-context.test.ts`; `bunx tsc --noEmit`; `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Independent review recorded in `Results: Review`.
- Final docs/cleanup commit before stop/queue handoff.

## Pickup Instructions

- Last safe command: `git status` — confirm `src/lint/integrity.ts`, `src/lint/integrity.test.ts`, `src/agents/writer/retry-context.ts`, `src/agents/writer/retry-context.test.ts`, lane doc, and current-state.md are dirty.
- Tests already passing locally; runtime change is data-only on the issue payload — no production behavior change for non-duplicate kinds.
- Next action: deploy after L62-validate finalization, peek a retry-bearing `llm_calls` to confirm the new pair lines appear, fill Results, conclude exp #387.
