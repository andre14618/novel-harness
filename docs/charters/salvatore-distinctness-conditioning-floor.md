---
status: proposed
kind: experiment-charter
experiment-family: salvatore-distinctness-conditioning-floor
proposed-by: Codex
proposed-date: 2026-04-18
revised-date: 2026-04-20
revision: slim-live-v1 (round 3)
adversary-verdict: RED (rounds 1 + 2) — revised for round 3
adversary-review-date: 2026-04-20
supersedes: docs/charters/salvatore-v5-corpus-expansion.md
depends_on: docs/evals/salvatore-distinctness-v1.md
---

# Experiment Charter — `salvatore-distinctness-conditioning-floor` (slim-live-v1)

**Revision history.** Rounds 1 and 2 both returned RED against the proxy-eval framing (§10.1, §10.2). This revision (`slim-live-v1`) collapses the charter to Codex's cheapest untried counterfactual: an H1-only A/B on the live `buildBeatContext` surface, with a committed conditioning override and the gpt-5.4 judge already frozen in [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md). The proxy scorer is NOT the charter gate. The proxy scorer and its arm-config JSONs remain in the repo as unit-tested infrastructure but are not invoked here.

**Scope cuts from the previous revision:**

- **H2 dropped.** The production `buildBeatContext` path renders free-text `speechPattern` / `avoids` strings plus an `exampleLines` array; it does not accept preset-indexed `tics`/`avoid` arrays. A profile-field-rotation win would be unshippable without a new runtime contract. If H1 wins, H2 reopens as its own separate charter with runtime-contract work as a pre-gate. (Closes round-2 blocker #2.)
- **Proxy eval dropped as ship metric.** The two-arm scorer re-generates fresh fixed-v4 output every run at temperature 0.8, making cross-run arm comparisons noise-prone. This charter tests only on the live writer surface where same-ladder comparability is guaranteed by construction. (Closes round-2 blocker #1.)
- **Pilot infrastructure committed before run.** A `conditioning: "fixed" | "rotation"` field in `WRITER_GENRE_PACKS`, wiring in `buildBeatContext`, a committed pilot-runner script, and a committed pairwise-judge prompt + rubric all land BEFORE §7 runs. No hand-edits, no in-place reverts. (Closes round-2 blocker #3.)

## 1. Question

On one frozen fantasy seed, does rotating `exampleLines` subsets at v4 inference on the live `buildBeatContext` path produce more distinct character voices than fixed conditioning, measured by blind pairwise judgment on the same matched scenes from both runs?

## 2. Hypothesis

**If** `salvatore-1988-v4` keeps the same adapter and the fantasy `WRITER_GENRE_PACKS` entry rotates `exampleLines` subsets across `preset-a → preset-b → preset-c` per beat, with `speechPattern` / `avoids` / all other writer context unchanged, **then** on the frozen fantasy seed the rotation run will win blind pairwise distinctness judgments against the fixed run on at least `12/20` matched scenes, while retention on `salvatore-original-v1` does not regress (the adapter is unchanged, so retention is structurally identical — this is a check, not a measurement), **because** the remaining multi-character blur in v4 output is more likely an over-reliance on a single cached example-line subset than a missing-corpus problem, and rotating that surface per beat is the cheapest test of that claim.

Primary metric artifact:
- [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md) provides the frozen judge choice (`gpt-5.4` via the Codex plugin) and the pairwise-voice-distinctness rubric shape. This charter inherits both. It does not produce a new distinctness eval artifact.

This charter does not reopen judge selection. It does not reopen retention methodology — the adapter is unchanged.

## 3. Falsification threshold

Rotation is not the lever if any of:

1. Rotation wins `<= 10/20` matched scenes on the blind pairwise judge. Tie or near-tie under blind judging means the conditioning change does not produce detectable distinctness lift.
2. Rotation introduces a net adherence-event regression of `> +2 events per chapter` averaged across the three chapters.
3. Rotation introduces a net halluc-leak Rung 0 regex fire-rate regression (any increase is a regression — the regex is exact-match).

If any prong fires, kill the conditioning-first claim and reopen `salvatore-v5-corpus-expansion` as a candidate in a separate charter (PDF acquisition is that charter's pre-gate, not this one's).

## 4. Baseline ladder

| Slot | Config | Purpose |
|------|--------|---------|
| Baseline | `salvatore-1988-v4` + `conditioning: "fixed"` in the fantasy `WRITER_GENRE_PACKS` (exampleLines always drawn from `preset-a`) | Control arm — what production does today |
| Test | `salvatore-1988-v4` + `conditioning: "rotation"` (exampleLines cycle preset-a → preset-b → preset-c per beat) | Treatment arm — the question |

No v3 rung, no Sonnet rung, no H2 rung. This charter tests one lever. Other rungs belong to other charters.

## 5. Cheapest counterfactuals considered

| Lever | Cost | Disposition |
|-------|------|-------------|
| H1 live A/B via a committed conditioning flag on `buildBeatContext` with blind gpt-5.4 pairwise judging | ~$0.10 writer spend; judge routed through Codex plugin (no API cost) | **MUST-MEASURE.** This is the primary arm of the charter. |
| H2 (profile-field rotation) on live runtime | Requires new runtime contract for preset-indexed `tics`/`avoid` arrays | **DEFERRED.** Reopens only if H1 wins and the question becomes "does profile rotation compound the win?" |
| Proxy eval on `salvatore-distinctness-v1` frozen beats | ~$0.02 writer spend; judge via Codex | **REJECTED as ship gate.** Round 1 / round 2 adversary review established the proxy is too far from `buildBeatContext` (exp #195) and its two-arm runner re-draws fixed-v4 across runs, violating same-ladder comparability (§2.1, §9.4). Kept as unit-tested infrastructure but not invoked by this charter. |
| Corpus expansion retrain (`salvatore-v5-corpus-expansion`) | Training + corpus-prep + eval spend | **EXPLICITLY DEFERRED.** Reopen only if H1 fails. PDF acquisition remains that charter's pre-gate. |

## 6. Distribution match

- **Train set stratification:** not applicable; no training arm.
- **Eval surface:** the **live `buildBeatContext` path** running real 3-chapter fantasy novels. Transition bridges, landing-target sentences, resolved references, setting, multi-character cards, adherence-retry logic, chapter-plan-checker, halluc-leak regex — all production-on. Every beat in both arms uses the same plan, the same references, the same POV, the same adherence pass count — the ONLY difference is which `exampleLines` subset the fantasy writer pack exposes for that beat.
- **Frozen seed:** `fantasy-archive`. Committed in charter at run time; not author-selectable at launch. If `fantasy-archive` is unrunnable at launch (e.g., DB drift), switch to `fantasy-cartographer` and re-commit the charter before running. No mid-run seed swap.
- **Blind judging:** gpt-5.4 via Codex plugin. Judge never sees arm labels, sees only anonymized prose pairs with matched scene context (POV, intended speakers, beat purpose). Pairwise prompt + rubric committed to `docs/evals/conditioning-floor-judge-prompt.md` before §7 runs.
- **Production distribution:** this IS the production distribution. The only proxy is "one fantasy seed, 3 chapters" vs "all fantasy seeds, all chapter lengths." That scope cut is acknowledged; a follow-on second-seed pilot runs only if the first pilot is borderline.

## 7. Success criteria

Primary metric is blind pairwise win-rate on matched scenes between the two novel runs. Secondary metrics are adherence-event count and halluc-leak Rung 0 regex fire-rate, per chapter.

Matched scenes are constructed by `scripts/evals/conditioning-floor-pair-builder.ts` (committed before run) — it finds beats where both runs produced prose and the beat archetype is one of `threat / reassurance / tactical_planning / banter` with ≥2 characters speaking. Target pair count: `20` (if the runs produce fewer than 20 eligible matched pairs, document the shortfall and run the judge on all pairs produced).

| Outcome | Condition | Action |
|---------|-----------|--------|
| SHIP rotation | Rotation wins `>= 13/20` pairs, adherence regresses by `<= +2 events/chapter`, halluc-leak does not regress at all | Ship `conditioning: "rotation"` as the default in the fantasy `WRITER_GENRE_PACKS` entry. Document the decision in `docs/decisions.md`. No new infra charter needed — the flag is already in place. |
| ITERATE | Rotation wins `11-12/20` OR `>= 13/20` but adherence regresses by `+3 events/chapter` OR one halluc-leak fire appears | Do not ship. Run the second seed (`fantasy-cartographer`) as a confirmation pilot before deciding. Document the residual by pair. |
| KILL | Rotation wins `<= 10/20`, OR adherence regresses by `>= +3 events/chapter` on a `>= 13/20` result, OR halluc-leak regression > 0 | End the conditioning-first claim. Reopen `salvatore-v5-corpus-expansion` as a separate charter with its own pre-gate. |

Interpretation: count units for pairs and events. Do not convert to percentages or rates.

## 8. Budget

Real numbers from `public.llm_calls` (2026-04-20) on recent fantasy runs:

- 5-chapter fantasy novel cost: **$0.03–$0.10 total**, writer component **$0.01–$0.05**.
- Extrapolated 3-chapter fantasy novel cost: **$0.02–$0.06 total** per arm.
- Two-arm A/B: **~$0.05–$0.12 total writer + checker + plan spend.**
- Judge: gpt-5.4 via Codex plugin — routed through `${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs`, no direct API cost to this project's accounting.
- Second seed pilot (only if §7 emits ITERATE): ~$0.05–$0.12 additional.
- **Total expected spend: under $1** even including the fallback second seed. No training spend.

**Time cap:** under one working day for both novel runs (parallelizable on LXC) + judge pass + write-up.

**Stop if:** the W&B Inference serving breaks mid-run, the Codex plugin becomes unavailable, the pilot runner detects unequal plan-checker pass counts between the two arms (beats were written under different retry states), OR the matched-pair count falls below 10.

## 9. Linked context

- RED predecessor: [docs/charters/salvatore-v5-corpus-expansion.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/charters/salvatore-v5-corpus-expansion.md)
- Work order: [docs/charters/revision-work-order-2026-04-18.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/charters/revision-work-order-2026-04-18.md)
- Frozen distinctness eval (source of judge choice + rubric shape): [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md)
- Proxy scorer retained as infra only: [scripts/evals/run-salvatore-distinctness-v1.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/run-salvatore-distinctness-v1.ts)
- **Runtime conditioning surface (to be extended before run):** [src/agents/writer/beat-context.ts](/Users/andre/Desktop/personal_projects/novel-harness/src/agents/writer/beat-context.ts), [src/models/roles.ts](/Users/andre/Desktop/personal_projects/novel-harness/src/models/roles.ts) (WRITER_GENRE_PACKS)
- **Pilot runner (to be committed before run):** `scripts/evals/run-conditioning-floor-live.ts`
- **Pairwise judge prompt (to be committed before run):** `docs/evals/conditioning-floor-judge-prompt.md`
- **Matched-pair builder (to be committed before run):** `scripts/evals/conditioning-floor-pair-builder.ts`
- Retention / lineage: [docs/voice-lora-salvatore.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/voice-lora-salvatore.md)
- Prior-art judge precedent: [docs/decisions.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/decisions.md) (`2026-04-17 Archetype POC`)

## 10. Adversary review

Rounds 1 and 2 (below) both returned **RED** against earlier revisions. This is round 3 — awaiting re-review of `slim-live-v1`.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — round 1 | RED | 2026-04-20 | Bundled lever + distribution mismatch + threshold not producible. Addressed by revision `1749d16` (split lever) + `e9c8474` (scorer profile-rotation mode). |
| `/codex:adversarial-review` (GPT) — round 2 | RED | 2026-04-20 | Partial H1/H2 split didn't close the underlying issue: proxy can't support same-ladder comparability, H2 has no live analog, pilot was ad hoc. Addressed by this revision (`slim-live-v1`) — proxy dropped, H2 deferred to its own charter, pilot infrastructure committed before run. |
| `/codex:adversarial-review` (GPT) — round 3 | RED | 2026-04-20 | Within-live-surface isolation confound, post-hoc pair set, unwritten judge protocol. See §10.3. |
| `/codex:adversarial-review` (GPT) — round 4 | pending | pending | Re-review target after the §11 infrastructure lands. |
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

## 11. Open questions / readiness gate

Must close before §7 runs:

- **(closed) Frozen eval surface:** [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md) is frozen with `status: frozen-2026-04-18` and names `gpt-5.4` as the judge.
- **(closed) Proxy scorer TODOs:** commit `e54b1fe` + `e9c8474`. Not required for this revision's gate but remains in-repo as infra.
- **(open) Round-3 adversary re-review:** required before any of the new infrastructure below is committed.
- **(open) Conditioning feature flag in `WRITER_GENRE_PACKS`:** add `conditioning: "fixed" | "rotation"` to the fantasy pack; wire into `src/agents/writer/beat-context.ts` so `exampleLines` rendering honors the flag. Committed, reversible via config, no hand-edits.
- **(open) Pilot runner script:** `scripts/evals/run-conditioning-floor-live.ts` — takes a seed, runs both arms end-to-end via the existing novel pipeline, persists results to `public.novels` under two separate novel ids that share a common `conditioning_floor_pilot_id`.
- **(open) Matched-pair builder:** `scripts/evals/conditioning-floor-pair-builder.ts` — pulls beats where both runs produced prose and the beat has ≥2 characters speaking; emits a committed pair-JSONL.
- **(open) Pairwise judge prompt + rubric:** `docs/evals/conditioning-floor-judge-prompt.md` — frozen before run, checked in, used by whatever wrapper invokes Codex `gpt-5.4`.
- **(open) Judge wrapper:** one-shot script or subagent invocation that reads the pair-JSONL, calls Codex plugin pairwise, writes verdicts back to `public.eval_results` with a shared `eval_id` tying them to the pilot runs.

Post-win path: if `slim-live-v1` passes §7, ship `conditioning: "rotation"` as default in the fantasy pack. Inference-local flag flip; no new infra charter. If telemetry / preset-state plumbing later become useful, that is a separate charter (not scope creep here).

Post-fail path: if `slim-live-v1` fails §7, reopen `salvatore-v5-corpus-expansion` separately. PDF acquisition remains its own pre-gate.

H2 reopens only as a new charter, gated on H1 winning first.
