---
status: proposed
kind: experiment-charter
experiment-family: salvatore-distinctness-conditioning-floor
proposed-by: Codex
proposed-date: 2026-04-18
revised-date: 2026-04-20
revision: slim-live-v1-replay-3arm (round 7)
adversary-verdict: RED (rounds 1–6) — revised for round 7
adversary-review-date: 2026-04-20
supersedes: docs/charters/salvatore-v5-corpus-expansion.md
depends_on: docs/evals/salvatore-distinctness-v1.md
---

# Experiment Charter — `salvatore-distinctness-conditioning-floor` (slim-live-v1-replay-3arm)

**Revision history.** Six RED rounds preceded this revision:
- Rounds 1 + 2 killed the proxy-eval framing (§10.1, §10.2).
- Round 3 killed the whole-novel A/B framing — even with plan-freeze + clone, running two full novels through the drafting pipeline re-runs upstream concept and planning work (§10.3).
- Round 4 killed the initial live-surface framing — the 4-line exampleLines preset bug + the deferred pilot runner owned load-bearing decision logic (§10.4).
- A targeted diagnosis (Codex `a49597f22`) then surfaced the fatal `previousBeatProse` feedback loop (§10.5).
- Round 5 validated the per-beat replay framing but flagged four concrete implementation blockers (responseFormat, per-arm refs, loss-encoding, chapter-opener bridge) + two warnings (§10.6). All closed by commit `254fb71`.
- Round 6 confirmed round-5 items closed but opened two narrower concerns (§10.7): the baseline ladder omitted shipped-production, and transport retries were unaudited.

**This revision (`slim-live-v1-replay-3arm`)** closes round 6 by adding a third arm: **`raw`** (production default — `WRITER_CONDITIONING` unset → `lines.slice(0, 5)`, matching prior live-novel behavior byte-for-byte per the parity harness). Three arms per beat:

- **`raw`** — production control (what shipped novels do today). Included as a diagnostic, NOT as the ship gate.
- **`fixed`** — `preset-a` subset always (`WRITER_CONDITIONING=fixed`). Ship-gate control.
- **`rotation`** — cycles `preset-a/b/c` (`WRITER_CONDITIONING=rotation`). Ship-gate treatment.

The runner emits three PairRow JSONLs per run: `fixed-vs-rotation` (ship gate), `raw-vs-rotation` and `raw-vs-fixed` (diagnostic). Transport retries are disabled for all arms (`LLMRequest.noRetries: true`, transport commit `851913d`), so one arm cannot silently re-roll while another fails fast. Per-arm `http_attempts` is recorded; any pair with `http_attempts > 1` on either arm is marked `error` and excluded from judging.

**Research-discipline tradeoff acknowledged up front.** This measures **beat-local conditioning isolation**: "on matched beats, does rotation's subset produce more distinct character voices than fixed's (or raw's)?" It does NOT measure whole-novel rotation policy (cumulative feedback effects across 30 beats). That tradeoff was accepted in round 3 — a whole-novel A/B can't clean-isolate conditioning under the live drafting pipeline's `previousBeatProse` feedback loop. If beat-local H1 wins, a follow-on whole-novel policy charter with a different methodology is justified; if beat-local H1 loses, the conditioning-first approach is dead and corpus expansion reopens.

**Scope cuts (cumulative across all revisions):**

- **H2 dropped.** Production `buildBeatContext` renders free-text `speechPattern` / `avoids`; preset-indexed profile rotation has no live analog. (Closes round-2 blocker #2.)
- **Proxy eval dropped as ship metric.** Two-arm scorer can't provide same-ladder comparability; not invoked here. (Closes round-2 blocker #1.)
- **Clone-for-variant pre-drafting workflow dropped.** It would need to copy `story_spines` + concept-phase knowledge-graph tables (missing per Codex leak #1), and even with full cloning it can't solve the `previousBeatProse` feedback loop (Codex leak #4). Per-beat replay on a single source novel sidesteps both.
- **Full-novel drafting pipeline dropped for this experiment.** Adherence retries, chapter-plan-checker revisions, and chapter-plan-reviser escalations all introduce arm-varying state. The replay runner calls the writer directly with a reconstructed prompt, bypassing the full drafting phase.

## 1. Question

On matched beats replayed from a single source novel, does rotating `exampleLines` subsets at the v4 `buildBeatContext` call produce more distinct character voices than fixed `preset-a` conditioning on the same beat? Secondarily: how do both experimental arms (`fixed` and `rotation`) compare against the **`raw` shipped-production** path (same v4 adapter, no preset logic)?

## 2. Hypothesis

**Primary (ship-gate, `fixed` vs `rotation`):** **If** we pre-register ~20 dialogue-multi-character beats from a single already-drafted fantasy source novel, then for each beat render `buildBeatContext` against identical source-novel inputs under THREE conditioning states (`raw`, `fixed`, `rotation`) and call `salvatore-1988-v4` once per state, **then** the rotation arm will win blind pairwise distinctness judgments against the fixed arm on at least `13/20` matched beats (adjusted proportionally for smaller N ≥ 10), **because** if the remaining multi-character blur in v4 output stems from over-reliance on a single cached example-line subset, swapping in different 3-line subsets per beat should produce measurably more differentiated dialogue register than holding it on `preset-a`.

**Diagnostic (`raw` vs `rotation`, `raw` vs `fixed`):** not a ship gate. Reports how each experimental arm compares against real shipped production. Informs a follow-on production-replacement charter if (and only if) the ship-gate passes.

Primary metric artifact:
- [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md) provides the frozen judge choice (`gpt-5.4` via the Codex plugin) and the pairwise-voice-distinctness rubric shape. This charter inherits both.

This charter does not reopen judge selection. It does not reopen retention methodology — the adapter is unchanged across arms, so adapter-level retention is structurally preserved.

## 3. Falsification threshold

Rotation is not the lever if:

1. Rotation wins `<= 10/N` matched beats against the **fixed** arm on blind pairwise judging (thresholds scale proportionally for N < 20 per §7). This is the ship gate.
2. Rotation produces prose that triggers halluc-leak Rung 0 regex fires at any rate above the fixed arm — the regex is exact-match, so any regression vs fixed is a fail. (Adherence events are not measured in beat-local replay because the replay bypasses the full drafting pipeline by design.)

If either prong fires, kill the conditioning-first claim and reopen `salvatore-v5-corpus-expansion` as a separate charter (PDF acquisition is that charter's pre-gate). The `raw` vs `rotation` result is reported but does not gate this charter's kill/ship decision — it feeds the follow-on production-replacement charter.

Secondary follow-on (post-win only): if beat-local H1 wins, a separate whole-novel policy charter + production-replacement charter address the two questions this charter deliberately defers (cumulative-effect policy and raw-vs-rotation under live-pipeline conditions).

## 4. Baseline ladder

| Slot | Config | Role | Purpose |
|------|--------|------|---------|
| Raw (production) | `salvatore-1988-v4`, `WRITER_CONDITIONING` **unset** → `lines.slice(0, 5)` unchanged. Byte-identical to shipped live novels (parity harness verified). | Diagnostic | Real shipped-production surface. Not the ship gate here. |
| Fixed | `salvatore-1988-v4` + `WRITER_CONDITIONING=fixed` → `preset-a` subset (3-of-4 for 4-line characters, 3-of-5 for 5-line). | Ship-gate control | Isolates "which 3 lines" as the only lever vs rotation. |
| Rotation | `salvatore-1988-v4` + `WRITER_CONDITIONING=rotation` → cycles `preset-a/b/c` by `(chapter*100 + beat_index) % 3`. | Ship-gate treatment | The hypothesis under test. |

No v3 rung, no Sonnet rung, no H2 rung. This charter tests one conditioning lever; the raw arm is descriptive. Other rungs belong to other charters.

## 5. Cheapest counterfactuals considered

| Lever | Cost | Disposition |
|-------|------|-------------|
| H1 three-arm replay (raw + fixed + rotation) via committed conditioning flag on `buildBeatContext` with blind gpt-5.4 pairwise judging | ~$0.15 writer spend (3 arms × 20 beats); judge routed through Codex plugin (no direct API cost) | **MUST-MEASURE.** Ship gate is `fixed` vs `rotation`; `raw` comparisons are diagnostic. |
| H2 (profile-field rotation) on live runtime | Requires new runtime contract for preset-indexed `tics`/`avoid` arrays | **DEFERRED.** Reopens only if H1 wins and the question becomes "does profile rotation compound the win?" |
| Proxy eval on `salvatore-distinctness-v1` frozen beats | ~$0.02 writer spend; judge via Codex | **REJECTED as ship gate.** Round 1 / round 2 adversary review established the proxy is too far from `buildBeatContext` (exp #195) and its two-arm runner re-draws fixed-v4 across runs, violating same-ladder comparability (§2.1, §9.4). Kept as unit-tested infrastructure but not invoked by this charter. |
| Whole-novel policy A/B | Two full novel runs + pipeline retries + reviser passes | **REJECTED for this charter.** `previousBeatProse` feedback loop (Codex leak #4, §10.5) prevents clean isolation. Follow-on charter only if H1 ship-gate passes. |
| Corpus expansion retrain (`salvatore-v5-corpus-expansion`) | Training + corpus-prep + eval spend | **EXPLICITLY DEFERRED.** Reopen only if H1 fails. PDF acquisition remains that charter's pre-gate. |

## 6. Distribution match

- **Train set stratification:** not applicable; no training arm.
- **Eval surface:** the **production `buildBeatContext` + writer call path**, invoked directly (NOT through the full drafting pipeline). `pickExampleLineSubset` + production character cards + real world-bible + real previousBeatProse from a source novel. Transition bridges, landing targets, resolved references all come from the source novel's drafted state.
- **Arm isolation via per-beat three-arm replay.** For each pre-registered beat:
  1. Reconstruct `BeatContextInput` ONCE from the source novel's frozen DB state: outline row, character rows (ORDER BY id — stable post commit `268d06d`), character states at that chapter, world bible, previous beat's prose (from `llm_calls.response_content` where `agent='beat-writer'`, ORDER BY id ASC — earliest-attempt, not post-rewrite), genre from `novels.seed_json`. **Reference resolution runs ONCE** via `resolveReferences` and the same `preResolvedRefs` is passed to all three arm builds.
  2. For each arm in `[raw, fixed, rotation]`: toggle `WRITER_CONDITIONING` (DELETE for raw, set for fixed/rotation), render `buildBeatContext(sharedInputs)`, call the writer with `LLMRequest.noRetries: true`. Capture prose + `http_attempts` from the LLMResponse.
  3. All three arm calls see byte-identical context except for the `exampleLines` subset selected by `pickExampleLineSubset`. No drafting-pipeline feedback loop, no chapter-plan-checker rewrites, no adherence retries, no transport auto-retries. Closes Codex leaks #2, #4, #5 and round-6 blockers #1, #2 by construction.
- **Three-arm output fan-out.** The runner assembles a `ReplayTriplet` per beat (raw + fixed + rotation prose + per-arm word counts + per-arm `http_attempts`) and emits FOUR artifacts:
  - `<prefix>-fixed-vs-rotation.jsonl` (ship-gate pair set)
  - `<prefix>-raw-vs-rotation.jsonl` (diagnostic)
  - `<prefix>-raw-vs-fixed.jsonl` (diagnostic)
  - `<prefix>-triplets.json` (full three-arm audit log, all prose + metadata)
- **Experiment guardrails (Codex leaks #2, #5).** Runner startup aborts if any of `WRITER_MODEL_OVERRIDE`, `WRITER_PROVIDER_OVERRIDE`, `STYLE_PRIMER`, `DEBUG_FORCE_*` env vars are set or `state/agent-overrides.json` is non-empty. Writer calls pass `noRetries: true` so any retry is a hard abort rather than silent re-roll; defense-in-depth, runner excludes any triplet where `http_attempts > 1` on any arm.
- **Pre-registered pair set.** `scripts/evals/conditioning-floor-pair-builder.ts` reads the source novel's frozen `chapter_outlines`, filters to beats with `kind==="dialogue"` and `characters.length >= 2`, stratifies round-robin across chapters, emits JSONL of up to `N=20` beat pre-registrations. Runs ONCE against the source novel BEFORE the replay. Same N drives all three pair sets. Beats where any arm fails to produce `>=50` words are counted as losses for that arm (not dropped from N). Closes round-3 blocker #2.
- **Frozen source novel.** A recent drafted fantasy novel from `public.novels` with `id LIKE '%fantasy-archive%'`, `phase='done'`, `total_chapters >= 3`. Source novel id is committed to `docs/decisions.md` + the output JSON at launch; not author-selectable at replay time. If the preferred source is unusable, a fallback (`fantasy-cartographer` or `fantasy-debt`) is selected and committed BEFORE replay begins.
- **Blind judging:** gpt-5.4 via Codex plugin (`codex exec --model gpt-5.4 -c model_reasoning_effort=high`). Judge is invoked THREE times — once per pair set — with distinct `--set-name` values so `eval_results` rows are partitionable (`...-fixed-vs-rotation`, `...-raw-vs-rotation`, `...-raw-vs-fixed`). Judge never sees arm labels — `scripts/evals/conditioning-floor-judge.ts` shuffles A/B per pair via sha256(seed+pair_id) and unshuffles verdicts after. Pairwise prompt + rubric frozen in `docs/evals/conditioning-floor-judge-prompt.md`. Runner emits UNSHUFFLED pair rows (arm_a always the pair's first arm label, arm_b always the second); judge is the single seed owner. Closes round-3 blocker #3 + round-5 warning #1.
- **Parity evidence (parity harness).** `scripts/evals/conditioning-floor-parity-check.ts --arm raw|fixed|rotation` diffs the replay writer request for a real beat against the same beat's `llm_calls` row. On source `pp2-floor__prompt__fantasy-debt__1776710485411` chapter 5 beat 22 (2026-04-20, commit `851913d`): raw → ✓ byte-equal to live (model, provider, temperature, max_tokens, system_prompt 2842ch, user_prompt 2025ch); fixed and rotation → byte-equal to live EXCEPT inside the "Example voiced lines:" block (expected delta — that's the intervention). Response format match verified by code inspection (`src/phases/drafting.ts:296/575/887` vs `buildWriterRequest` — both `{ type: "text" }`; not stored in `llm_calls.request_json`).
- **Production distribution — acknowledged scope cut.** This measures beat-local H1 isolation, NOT whole-novel policy effect. The feedback-loop confound that would make whole-novel isolation impossible is explicitly abandoned here; see §1 discussion. If beat-local H1 wins, a follow-on whole-novel policy charter takes a different methodological approach.

## 7. Success criteria

**Primary (ship-gate) metric:** blind pairwise win-rate on the **`fixed-vs-rotation`** pair set. **Secondary (ship-gate) metric:** halluc-leak Rung 0 regex fire-rate on rotation's combined prose vs fixed's combined prose. **Diagnostic metrics** (descriptive, not ship-gate): win-rate on `raw-vs-rotation` and `raw-vs-fixed` pair sets. Adherence-event count is dropped from the gate in this revision — the replay runner bypasses the drafting pipeline by design, so adherence isn't meaningfully measurable.

**Pair set size is fixed at N pairs pre-registered before the replay runs.** Same N drives all three pair sets. `N` is determined by what `conditioning-floor-pair-builder.ts` produces on the frozen source plan:

- If the eligible-beat count ≥ 20, `N = 20`.
- If 10 ≤ eligible-beat count < 20, `N` is the actual eligible count and thresholds below scale proportionally (rounded to nearest integer). The exact N used is committed to the output JSON and `docs/decisions.md`.
- If eligible-beat count < 10, the charter aborts under §8 and is not rerun on the same source plan.

**Thresholds below are written for `N = 20`.** If `N < 20`, multiply each threshold by `N / 20` and round: SHIP = `round(0.65 · N)`, ITERATE lower-bound = `round(0.55 · N)`, KILL = `round(0.50 · N)`.

Beats where any arm failed to produce prose, or produced <50 words, or had `http_attempts > 1`, are counted as losses for that arm (NOT dropped from N). This prevents intervention-induced eligibility shrinkage.

| Outcome | Ship-gate condition (fixed-vs-rotation, N=20) | Action |
|---------|-----------|--------|
| SHIP rotation | Rotation wins `>= 13/N` pairs on fixed-vs-rotation AND halluc-leak Rung 0 regex fire count on rotation's combined prose does not exceed fixed's | **Do NOT silently replace production.** Record decision in `docs/decisions.md`. Open a **production-replacement charter** that uses the `raw-vs-rotation` diagnostic data from this run as its starting evidence and gates any pack-level default change. Reason: this charter's `fixed` arm is NOT the shipped production path; a ship-gate pass here justifies a production charter, not a direct pack default change. |
| ITERATE | Rotation wins `11-12/N` on fixed-vs-rotation OR `>= 13/N` but halluc-leak regression `> 0` | Do not ship. Re-run three-arm replay against a second source novel (`fantasy-cartographer` or `fantasy-debt`) before deciding. Document the residual by pair. |
| KILL | Rotation wins `<= 10/N` on fixed-vs-rotation | End the conditioning-first claim. Reopen `salvatore-v5-corpus-expansion` as a separate charter with its own pre-gate. |

**Diagnostic reporting (required, not gating):** the experiment write-up must include a table of all three pair sets with win counts per arm + halluc-leak fire counts. `raw-vs-rotation` and `raw-vs-fixed` results do not change the SHIP/ITERATE/KILL decision on this charter but feed the follow-on production-replacement charter.

Interpretation: count units for pairs and events. Do not convert to percentages or rates when reporting.

## 8. Budget

Writer spend per arm per beat is ~$0.0005–$0.002 (one `buildBeatContext` → one `salvatore-1988-v4` W&B call). Three arms × 20 beats:

- **Writer spend:** 3 arms × 20 beats ≈ 60 W&B Inference calls. Expected $0.05–$0.15 total.
- **Judge:** gpt-5.4 via Codex plugin, invoked three times (one per pair set), ~20 judgments each = 60 total. No direct API cost (routed through the Codex plugin's own billing channel, not our `llm_calls` ledger).
- **Second source pilot (only if §7 emits ITERATE):** another 60 W&B calls + 60 judge calls = additional $0.05–$0.15.
- **Total expected spend: well under $1** even including the fallback second source. No training spend.

**Time cap:** under one working day for the replay + three judge passes + write-up.

**Stop if:** the W&B Inference serving breaks mid-run (any arm hits `http_attempts > 1`); the Codex plugin becomes unavailable; the matched-pair count falls below 10; or the parity harness reports a new non-expected delta on any arm.

## 9. Linked context

- RED predecessor: [docs/charters/salvatore-v5-corpus-expansion.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/charters/salvatore-v5-corpus-expansion.md)
- Work order: [docs/charters/revision-work-order-2026-04-18.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/charters/revision-work-order-2026-04-18.md)
- Frozen distinctness eval (source of judge choice + rubric shape): [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md)
- Proxy scorer retained as infra only: [scripts/evals/run-salvatore-distinctness-v1.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/run-salvatore-distinctness-v1.ts)
- **Runtime conditioning surface (commits `6c0897c` + `b800457` + `254fb71`):** [src/agents/writer/beat-context.ts](/Users/andre/Desktop/personal_projects/novel-harness/src/agents/writer/beat-context.ts), [src/models/roles.ts](/Users/andre/Desktop/personal_projects/novel-harness/src/models/roles.ts) — `WRITER_CONDITIONING=fixed|rotation` env-var override on the fantasy `WRITER_GENRE_PACKS` entry, wired into both `buildBeatContext` render paths via `pickExampleLineSubset`. 4-line preset family + 5-line preset family (b800457). **Pack-level conditioning is unset by default** (254fb71) — production behavior is `lines.slice(0, 5)` unchanged, matching prior live novel drafting. The env var is only set by the replay runner.
- **Stable character render order (commit `268d06d`):** [src/db/world.ts](/Users/andre/Desktop/personal_projects/novel-harness/src/db/world.ts) — `getCharacters` now has `ORDER BY id` so prompt bytes are stable between arms.
- **Transport `noRetries` flag (commit `851913d`):** [src/transport.ts](/Users/andre/Desktop/personal_projects/novel-harness/src/transport.ts) — new `LLMRequest.noRetries` boolean. When true, `DirectTransport` performs 0 retries (1 total attempt). Default false — production paths unchanged. The replay runner sets it to `true` per charter §6 experiment discipline.
- **Matched-pair builder (commit `6c0897c`):** [scripts/evals/conditioning-floor-pair-builder.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/conditioning-floor-pair-builder.ts) — reads source `chapter_outlines`, filters to dialogue beats with ≥2 characters, stratifies round-robin, emits JSONL. Aborts below N=10. 15 unit tests passing.
- **Three-arm replay runner (commit `4b3ed17`):** [scripts/evals/run-conditioning-floor-replay.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/run-conditioning-floor-replay.ts) — three-arm per-beat replay (raw + fixed + rotation). Emits 4 files per run: three pair JSONLs + one triplet audit JSON. Startup guardrails for env-var overrides + persisted agent overrides. `noRetries: true` on all writer calls; defense-in-depth exclusion of any triplet with `http_attempts > 1`. 66 unit tests passing.
- **Parity harness (commit `851913d`):** [scripts/evals/conditioning-floor-parity-check.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/conditioning-floor-parity-check.ts) — `--arm raw|fixed|rotation` byte-diffs the replay writer request against a real `llm_calls` row for the same beat. Raw arm is byte-equal to live; fixed/rotation arms are byte-equal EXCEPT inside the `Example voiced lines:` block (expected delta, logged separately). Used as a pre-run gate: any new non-expected delta aborts the pilot.
- **Frozen pairwise judge prompt (commit `76f7733`):** [docs/evals/conditioning-floor-judge-prompt.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/conditioning-floor-judge-prompt.md) — gpt-5.4 system + user prompt, voice-distinctness rubric (not identity-assignment), frozen-2026-04-20.
- **Judge wrapper (commit `26ae698` + `4b3ed17`):** [scripts/evals/conditioning-floor-judge.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/conditioning-floor-judge.ts) — seeded sha256 shuffle, `codex exec` invocation, persistence to `public.eval_results`. `--set-name` flag added so three pair-set runs emit to distinct `eval_results.set_name` values. `resolveLossShortCircuit` generalized to `loss_a` / `loss_b` with backward compat; reason strings use the actual arm labels. Single seed owner.
- **Per-beat replay runner (landing in parallel):** `scripts/evals/run-conditioning-floor-replay.ts` — reconstructs `buildBeatContext` inputs from the source novel's frozen DB state, renders twice with fixed vs rotation conditioning, invokes the writer directly, emits PairRow JSONL for the judge. Enforces startup guardrails against `WRITER_MODEL_OVERRIDE` / `WRITER_PROVIDER_OVERRIDE` / `STYLE_PRIMER` / `DEBUG_FORCE_*` / non-empty agent-overrides. Subsumes the Codex round-4 blocker #2 pilot runner by owning the load-bearing loss-encoding and pair-assembly logic.
- **Proxy scorer (unused by this charter):** [scripts/evals/run-salvatore-distinctness-v1.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/run-salvatore-distinctness-v1.ts) — retained as infra; not invoked.
- **Clone-for-variant (unused by this revision):** [scripts/variant/clone-for-variant.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/variant/clone-for-variant.ts) — was round-3's workflow; replaced by per-beat replay which sidesteps both the known clone-list gap (Codex leak #1: missing `story_spines` + concept knowledge-graph tables) and the unfixable feedback-loop confound (Codex leak #4).
- Retention / lineage: [docs/voice-lora-salvatore.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/voice-lora-salvatore.md)
- Prior-art judge precedent: [docs/decisions.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/decisions.md) (`2026-04-17 Archetype POC`)

## 10. Adversary review

Rounds 1 and 2 (below) both returned **RED** against earlier revisions. This is round 3 — awaiting re-review of `slim-live-v1`.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — round 1 | RED | 2026-04-20 | Bundled lever + distribution mismatch + threshold not producible. Addressed by revision `1749d16` (split lever) + `e9c8474` (scorer profile-rotation mode). |
| `/codex:adversarial-review` (GPT) — round 2 | RED | 2026-04-20 | Partial H1/H2 split didn't close the underlying issue: proxy can't support same-ladder comparability, H2 has no live analog, pilot was ad hoc. Addressed by this revision (`slim-live-v1`) — proxy dropped, H2 deferred to its own charter, pilot infrastructure committed before run. |
| `/codex:adversarial-review` (GPT) — round 3 | RED | 2026-04-20 | Within-live-surface isolation confound, post-hoc pair set, unwritten judge protocol. See §10.3. |
| `/codex:adversarial-review` (GPT) — round 4 | RED | 2026-04-20 | H1 likely a no-op on 4-line production characters; pilot runner still owns load-bearing §7 logic. See §10.4. |
| `/codex:adversarial-review` (GPT) — round 5 | RED | 2026-04-20 | 4 concrete blockers (responseFormat, per-arm refs, loss-encoding, chapter-opener bridge) + 2 warnings. All addressed by commit `254fb71`. See §10.6 round-6 bookkeeping. |
| `/codex:adversarial-review` (GPT) — round 6 | RED | 2026-04-20 | All round-5 items CLOSED. Two new narrower blockers: baseline-ladder omits real production (#1) + transport retries not audit-trailed (#2). See §10.7. |
| `/codex:adversarial-review` (GPT) — round 7 | pending | pending | Re-review target after the round-6 blockers are addressed. |
| `experiment-adversary` (Opus) — fallback only | pending | pending | Only run if Codex is unavailable or a second opinion is explicitly requested. |

### 10.1 Round-1 verdict (pre-revision)

> VERDICT: RED
>
> SUMMARY: No-ship: the charter's causal claim, ship metric, and rollout decision are misaligned with the landed scorer, so even a win would not cleanly tell you whether live v4 conditioning improved enough to defer corpus expansion (§11.5, §7.1, exp #195).
>
> BLOCKING ISSUES:
> 1. **Bundled lever.** §5 defines the tested lever as rotating `exampleLines` / profile subsets, but the landed scorer only varies example-line subsets. Fix: scope the charter to example-line rotation only, or add explicit profile-surface arms.
> 2. **Distribution mismatch with live writer surface.** §6 treats `salvatore-distinctness-v1` as close to the shipped v4 runtime, but exp #195 already showed Salvatore writer conclusions can fail once the real prompt shape lands. Fix: require a production-shaped A/B pilot on the live writer surface before any ship action.
> 3. **Threshold metric not producible.** §7 gates on three-sweep min/max/mean, but the scorer collapses presets into one aggregate. Fix: land explicit sweep-level configs/reporting or rewrite the charter to the single-run metric the tooling can actually produce.
>
> Full output: background job `bshvls959`.

### 10.2 Round-2 verdict (post-1749d16 + e9c8474)

> VERDICT: RED
>
> SUMMARY: Round-1 blocker #1 only partially closed; blocker #2 narrowed but replaced by an ad hoc live pilot; blocker #3 replaced by a new same-ladder comparability failure.
>
> BLOCKING ISSUES:
> 1. **No shared fixed-v4 baseline across proxy arms.** Scorer is two-arm only; re-generates fresh v4 outputs per run at temperature 0.8. Cross-run v4 draws differ; winning-arm decision is cross-run noise-prone (§2.1, §9.4).
> 2. **H2 is not the live writer surface.** `buildBeatContext` renders free-text `speechPattern`/`avoids` plus `exampleLines`, not preset-indexed `tics`/`avoid` arrays. A proxy H2 win cannot advance to §7.2 without a new runtime representation (§4.6, exp #195).
> 3. **§7.2 is ad hoc and unreproducible.** No frozen judge model, no blind A/B count, no pairwise rubric. §11 manual `WRITER_GENRE_PACKS` fallback violates §1.2.
>
> WARNING: pilot seed is author-selectable at launch (§2.1).
>
> CHEAPEST UNTRIED COUNTERFACTUAL: ExampleLines-only H1 A/B on the live `buildBeatContext` surface with a committed conditioning override and frozen reasoning judge, ~$0 training spend (§4.6, exp #195).
>
> RECOMMENDED NEXT ACTION: REVISE CHARTER.
>
> Full output: background job `bgr2j1057`.

This revision (`slim-live-v1`) adopts the round-2 cheapest-untried-counterfactual verbatim, drops H2, freezes the seed in-charter, freezes the judge choice, and commits all pilot infrastructure (feature flag, pilot runner, pair builder, judge prompt) before §7 runs. The previous "hand-edit WRITER_GENRE_PACKS and revert" path is explicitly removed from §11.

### 10.3 Round-3 verdict (post-revision `8ee48dd` slim-live-v1)

> VERDICT: RED
>
> SUMMARY: Round-1 blocker #1 and round-2 blocker #2 are closed because H2 and the proxy ship gate were removed. But round-1 blocker #2 is replaced by a within-live-surface isolation confound, round-1 blocker #3 is still open, and round-2 blockers #1 and #3 remain open in new forms because the A/B is not frozen to a shared pre-drafting source, the scored pair set is output-dependent and can fall below its own thresholds, and the blind-judge protocol is still an unreviewed promise (§1.2, §2.1, §3.6, §9.4, §11.5, exp #195).
>
> BLOCKING ISSUES:
> 1. **Live A/B still does not isolate the conditioning lever.** §6 says both arms use the same plan, references, and POV, but §11's only concrete runner description is two end-to-end novel runs through the existing pipeline. That means planner output, character profiles, and upstream-generated `exampleLines` surface can drift between arms before drafting begins, so any distinctness delta is still a bundled intervention rather than an H1 ablation (§11.5); exp #195 already showed Salvatore conclusions flip when the runtime shape changes. Fix: freeze a single pre-drafting source novel and compare draft-only clones. Reuse the existing `scripts/variant/clone-for-variant.ts` pattern so `chapter_outlines`, character cards, resolved state, and references are shared, and `conditioning` is the only arm difference.
> 2. **Scored pair set is post-hoc; thresholds unproducible when N drops below 20.** §7 defines matched scenes only AFTER generation (the pair-builder scores beats where both runs produced prose with ≥2 speakers). That lets the intervention change which scenes are eligible (§2.1, §9.4). The charter says to judge all pairs if fewer than 20, but SHIP/ITERATE/KILL remain hard-coded to `>=13/20`, `11-12/20`, `<=10/20`, so the decision rule is ill-defined under the fallback path. Fix: pre-register the exact beat IDs to score BEFORE drafting, or count missing/ineligible beats as losses. Freeze the minimum N and define SHIP/ITERATE/KILL as a function of that fixed N up front.
> 3. **Round-2 reproducibility blocker deferred, not closed.** The charter treats the frozen `salvatore-distinctness-v1` artifact as supplying the judge choice and rubric shape, but that artifact freezes identity-assignment on synthetic voice-card prompts — not the new live-scene A/B "which arm is more distinct" judgment. The actual decision-critical artifacts (pairwise prompt, judge wrapper, pair-builder, result-writing path) remain open §11 gates scheduled AFTER round-3 review. Approving this charter would be approving unwritten infrastructure, leaving round-2 blocker #3 materially open under §1.2, and §3.6 makes the exact pairwise-judge protocol load-bearing rather than an implementation detail. Fix: land `docs/evals/conditioning-floor-judge-prompt.md`, the judge wrapper, and the pair-builder now; then re-review the charter against those concrete artifacts.
>
> RECOMMENDED NEXT ACTION: land the infrastructure, then request round 4.
>
> Full output: background job `bm8n9s9pg`.

### 10.4 Round-4 verdict (post-revision `3bb483d` + infra commits)

> VERDICT: RED
>
> SUMMARY: No-ship. H1 live-surface lever is likely a runtime no-op on the deployed 4-anchor `exampleLines` surface; the deferred pilot runner still owns the loss-counting and pair-assembly logic that makes §7 reproducible. Round-1 blockers: 1 CLOSED, 2+3 REPLACED BY NEW BLOCKERS. Round-2 blockers: 1 CLOSED, 2+3 REPLACED BY NEW BLOCKERS. Round-3 blockers: 1 CLOSED, 2+3 REPLACED BY NEW BLOCKERS.
>
> BLOCKING ISSUES:
> 1. **[critical] H1 conditioning is likely a no-op on the current live runtime.** `pickExampleLineSubset()` in `src/agents/writer/beat-context.ts` short-circuits when a character has fewer than 4 `exampleLines` and its preset indexes `[0,1,2]/[0,3,4]/[1,3,4]` assume 5 canonical lines. The deployed character-agent (`src/agents/character-agent/character-profile-system.md:22,69-75`) generates exactly 4 voice anchors per character; the frozen distinctness eval (`docs/evals/salvatore-distinctness-v1.md:75-81`) assumes 5. On 4-line characters, rotation degenerates: `preset-a` returns 3 lines, `preset-b` and `preset-c` drop to 2 (index 4 missing). Fixed always returns 3. A judged delta would reflect "sometimes 3 lines, sometimes 2" — not a clean subset-rotation ablation. Architecture-vs-prompt mismatch under §4.6; non-interpretable under §11.5. Fix: either persist ≥5 canonical `exampleLines` per judged speaker with a pre-run seed audit for that invariant, or redesign presets around the deployed 4-line surface and freeze the eval artifact against that reality.
> 2. **[high] Landed artifacts are not runnable end-to-end without the pilot runner.** The judge wrapper consumes `PairRow{pair_id, arm_a_prose, arm_b_prose, arm_a_label, arm_b_label}`. The pair-builder emits only beat coordinates + metadata. The missing `run-conditioning-floor-live.ts` is NOT orchestration-only glue — it is the only place where the charter's load-bearing rules would be enforced: mapping pre-registered beats to both novels, encoding missing-or-<50-word outputs as losses, aborting on unequal plan-checker pass counts, emitting the pair-row JSONL. Under §1.2 and §3.6 the protocol is not reproducibly producible until that code lands; manual assembly could reintroduce the post-hoc selection problem (§2.1, §9.4). Fix: commit the runner (or a narrower committed pair-assembly step that implements pair-row construction + loss-encoding + stop-rule enforcement) BEFORE greenlighting.
>
> RECOMMENDED NEXT ACTION: land the 4-line preset fix and the pair-assembler, then request round 5.
>
> Full output: background job `bqr4ytw7a`.

### 10.5 Targeted diagnosis — "does conditioning alone differ?" (Codex `a49597f22`, 2026-04-20, post round-4)

Not a full adversarial review — a focused pressure-test of the single architectural claim that with plan-freeze + clone, only conditioning differs between arms. Identified five leaks:

1. **Unreplicated concept-phase state** — `clone-for-variant.ts` misses `story_spines`, `world_systems`, `cultures`, `character_cultures`, `character_system_awareness`. Irrelevant to this revision (no cloning in replay).
2. **Loose env-var and retry knobs** — `WRITER_MODEL_OVERRIDE`, `WRITER_PROVIDER_OVERRIDE`, `STYLE_PRIMER`, `DEBUG_FORCE_*` + transport auto-retry could change outputs. Addressed by replay-runner startup guardrails.
3. **Non-deterministic character render order** — `getCharacters` had no `ORDER BY`. Closed by commit `268d06d`.
4. **`previousBeatProse` feedback loop** — the fatal one. Each beat's prose feeds into the next beat's context, so arm divergence at beat 0 propagates. Unfixable under a whole-novel A/B. **Forces the switch to per-beat replay** — this revision's core design change.
5. **Mutable agent overrides** — `state/agent-overrides.json` loaded at module start. Addressed by replay-runner startup guardrails.

Overall judgment: "conditioning alone" did NOT hold under whole-novel A/B; the highest-impact leak was #4. This revision (`slim-live-v1-replay`) abandons whole-novel A/B in response.

### 10.6 Round-5 verdict (post-revision `slim-live-v1-replay` commit `b56adcf`)

> VERDICT: RED
>
> SUMMARY: Replay revision still does not cleanly measure "conditioning alone differs". The runner changes the writer request shape (responseFormat), re-resolves references per arm, and never enforces the charter's loss-scoring rule.
>
> BLOCKING ISSUES:
> 1. **[critical] Replay writer calls are not production-shaped.** `buildWriterRequest()` omits `responseFormat`, transport defaults to `{ type: "json_object" }`. Live drafting explicitly sends `{ type: "text" }`. Not measuring the production writer path.
> 2. **[high] Both arms can see different BACKGROUND context because refs are re-resolved per arm.** `callWriterWithRetry()` rebuilds `buildBeatContext()` without `preResolvedRefs`; `resolveReferences()` LLM fallback can return different BACKGROUND blocks even when `exampleLines` are identical.
> 3. **[high] Charter §7 loss-counting not implemented in scoring path.** Runner encodes `loss_fixed` / `loss_rotation` / `error_text` but the judge loop still sends every pair to Codex and decides the winner from prose positions only. A sub-50-word arm could tie or win.
> 4. **[high] Previous-beat reconstruction does not match the live drafting contract.** Replay reads latest prior prose from `llm_calls`; live drafting uses `beatProses[bi-1]` within the same chapter only. Cross-chapter bridge injection + post-hoc-rewrite contamination.
>
> WARNINGS:
> - Both runner and judge apply A/B shuffles — double-shuffle; seed ownership ambiguous.
> - Transport retries remain enabled and are not surfaced in replay output.
>
> Full output: background job `b32qgup4t`. **All four blockers + warning #1 CLOSED by commit `254fb71`; warning #2 (retries) re-opens as round-6 blocker #2.**

### 10.7 Round-6 verdict (post-revision commit `254fb71` + parity harness)

> VERDICT: RED
>
> SUMMARY: All round-5 blockers + both warnings are CLOSED. Two new narrower concerns remain: the baseline ladder no longer includes the real shipped-production path, and transport retries are still unaudited.
>
> BLOCKING ISSUES:
> 1. **[high] Baseline ladder no longer includes the real shipped-production writer surface.** §4 still says `conditioning: "fixed"` is "what production does today", but commit `254fb71` intentionally unset pack-level conditioning (roles.ts) to fix a silent production-behavior regression. `pickExampleLineSubset` now keeps live novels on raw `lines.slice(0, 5)` unless the replay runner sets `WRITER_CONDITIONING=fixed|rotation`. The experiment now compares two experiment-only preset modes; neither matches shipped production. The parity harness confirms raw-live parity but does NOT validate `fixed` or `rotation` parity against real-world prompts. A rotation-beats-fixed win would justify "rotation beats the preset-a subset", NOT the §7 ship action of replacing current production. Fix: add the real production path (conditioning undefined, raw 4-line slice) as the control arm; rewrite §4/§7 around that baseline; extend the parity harness to validate `raw` / `fixed` / `rotation` separately.
> 2. **[medium] Replay pairs can still be contaminated by hidden transport retries with no audit trail.** Charter §6 promised "transport auto-retries disabled OR every retry recorded so the pair can be excluded". Neither is true: `executeAndLog` still uses default DirectTransport which retries on 429/5xx/timeouts (`src/transport.ts`). When called with `novelId=undefined` (as the replay runner does to avoid polluting novel traces), retry metadata (`httpAttempts`, `retryErrors`) does NOT persist to `llm_calls`. A pair where one arm retried and the other didn't is no longer "conditioning alone differs" and there's no machine-readable way to quarantine it. Fix: either add an explicit no-retry mode for replay calls, OR persist per-arm `httpAttempts`/`retryErrors` into the PairRow / eval_results and exclude retried pairs before judging.
>
> RECOMMENDED NEXT ACTION: add raw as a third arm (or reframe §4/§7 as conditioning-lever-only and open a separate production-replacement charter), handle transport retries explicitly, then round 7.
>
> Full output: background job `bxr34bz4k`.

## 11. Open questions / readiness gate

- **(closed)** Frozen eval surface: `docs/evals/salvatore-distinctness-v1.md` — frozen-2026-04-18; judge gpt-5.4.
- **(closed)** Proxy scorer TODOs: commits `e54b1fe` + `e9c8474`. Retained as infra; not invoked here.
- **(closed)** Conditioning flag + 4-line preset fix + production-regression fix: commits `6c0897c` + `b800457` + `254fb71`. Pack-level conditioning unset by default.
- **(closed)** Stable character render order: commit `268d06d`.
- **(closed)** Matched-pair builder: commit `6c0897c`. 15 tests.
- **(closed)** Pairwise judge prompt: commit `76f7733`.
- **(closed)** Judge wrapper + `--set-name`: commits `26ae698` + `4b3ed17`.
- **(closed)** Per-beat replay runner (original 2-arm): commit `b56adcf`; round-5 fixes in `254fb71`.
- **(closed)** Three-arm refactor (raw + fixed + rotation): commit `4b3ed17`. Emits 4 files (3 pair JSONLs + 1 triplet audit JSON). `noRetries: true` on all writer calls; `http_attempts > 1` exclusion. 66 tests.
- **(closed)** Transport `noRetries` flag: commit `851913d`.
- **(closed)** Parity harness arm-aware: commit `851913d`. Raw / fixed / rotation each validated against a real beat on LXC (2026-04-20 source `pp2-floor__prompt__fantasy-debt__1776710485411` ch 5 beat 22): all three ✓.
- **(open)** Round-7 adversary re-review: request now.

### Post-outcome paths

- **Ship path:** if §7 ship-gate emits SHIP, **do NOT directly flip the pack default to "rotation".** The `fixed` arm is not shipped production. Instead: record decision in `docs/decisions.md` and open a follow-on **production-replacement charter** that uses this run's `raw-vs-rotation` diagnostic data as starting evidence. That charter decides whether to flip the pack default (and may require additional evidence — e.g. a whole-novel policy pilot — per the cumulative-effect caveat).
- **Iterate path:** if §7 emits ITERATE, re-run three-arm replay against a second source novel (different drafted fantasy seed) before deciding.
- **Fail path:** if §7 emits KILL, reopen `salvatore-v5-corpus-expansion` as a separate charter (PDF acquisition is its own pre-gate).
- **H2 reopens only as a new charter**, gated on H1 winning first AND a runtime-contract change that lets `buildBeatContext` accept preset-indexed `tics`/`avoid` arrays (production currently renders free-text `speechPattern` / `avoids`).
- **Whole-novel policy question (separately).** Codex correctly flagged that per-beat isolation can't answer "does rotation policy help across a full novel?" — feedback-loop confounds prevent clean isolation there. A future charter with a different methodology (e.g. accepting the confound and measuring cumulative effect on cheap telemetry) is justified only if beat-local H1 wins.
