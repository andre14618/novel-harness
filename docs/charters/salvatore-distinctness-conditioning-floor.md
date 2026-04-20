---
status: proposed
kind: experiment-charter
experiment-family: salvatore-distinctness-conditioning-floor
proposed-by: Codex
proposed-date: 2026-04-18
revised-date: 2026-04-20
adversary-verdict: RED
adversary-review-date: 2026-04-20
supersedes: docs/charters/salvatore-v5-corpus-expansion.md
depends_on: docs/evals/salvatore-distinctness-v1.md
---

# Experiment Charter — `salvatore-distinctness-conditioning-floor`

Supersedes the RED `salvatore-v5-corpus-expansion` charter. This charter is conditioning-first by design: test the measured inference-time floor on the frozen distinctness eval before reopening any corpus-expansion claim.

**Revision 2026-04-20** addresses all three blocking issues from §10.1 (Codex adversarial review RED verdict):
- Splits the conditioning lever into two independent knobs (example-line rotation vs profile-field rotation) with their own arms — closes blocker #1 (bundled lever).
- Adds a live-writer pilot on `buildBeatContext` as a required ship gate; no default-rollout claim from proxy eval alone — closes blocker #2 (distribution mismatch).
- Rewrites success thresholds to the single-run aggregate the scorer emits (total exact-assignment cells across the rotation cycle); drops the per-sweep min/max/mean wording the tooling does not produce — closes blocker #3 (metric not producible).
- Corrects the §4 ceiling rung label: the shipped `sonnet-profile` arm is `profile-only` (no exampleLines), not the looser "Sonnet+profile" phrasing — closes the warning.

## 1. Question

On the frozen distinctness eval, does rotating **either** the `exampleLines` subset **or** the profile fields (`tics`/`avoid`) at v4 inference improve multi-character separation enough, and does that lift survive the live `buildBeatContext` writer surface, so corpus expansion can wait?

## 2. Hypothesis

Two independent sub-hypotheses, each with its own causal claim:

**H1 (example-line rotation).** **If** `salvatore-1988-v4` keeps the same adapter but rotates frozen `exampleLines` subsets at inference across presets `preset-a`/`preset-b`/`preset-c` (arm `v4-rotation`), `tics`/`avoid` held fixed, **then** the primary metric (aggregate exact-assignment cells across the 24-cell proxy eval) improves by at least `+4` over fixed v4, **because** one-subset luck and paraphrase collapse are the cheapest remaining explanation for v4 blur given the adapter already bakes character-conditioned `exampleLines` into training.

**H2 (profile-field rotation).** **If** `salvatore-1988-v4` rotates the profile fields (`tics`/`avoid`) across three frozen profile-subset presets (arm `v4-profile-rotation`), `exampleLines` held fixed at `preset-a`, **then** the same primary metric improves by at least `+4` over fixed v4, **because** the profile payload carries per-character deontic/prosodic cues that may be the load-bearing conditioning surface rather than the example lines themselves.

Either H1 or H2 winning on the proxy eval is a candidate signal; **neither is a ship signal on its own**. §7 adds a live-writer pilot as the ship gate.

Retention floor applies to both: `salvatore-original-v1` plus held-out val Δ-sum worsens by no more than `+0.10` versus fixed v4.

Primary metric artifact:
- [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md)

Secondary retention artifacts:
- [docs/voice-lora-salvatore.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/voice-lora-salvatore.md)
- [docs/writer-imitation-benchmark.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/writer-imitation-benchmark.md)

This charter inherits the frozen judge choice and circularity rationale from the eval artifact. It does not reopen judge selection.

## 3. Falsification threshold

The conditioning-first mechanism is wrong if **all** of the following fire:

1. Both H1 and H2 rotation arms gain `<=+2` aggregate cells versus fixed v4 on the proxy eval. No isolated surface moves the metric.
2. OR — whichever rotation arm shows the largest proxy-eval gain fails to reproduce on the live `buildBeatContext` pilot (gain collapses to `<=+1` on the pilot's adherence + hallucination + eyeball-distinctness composite).
3. OR — retention regresses by `>+0.10 Δ-sum` versus v4 on `salvatore-original-v1` plus held-out val for whichever rotation arm otherwise passed the proxy gate.

If any prong fires, kill the conditioning-first approach and reopen corpus expansion as a candidate in a separate charter. PDF acquisition for corpus expansion remains a pre-gate there, not in this charter.

## 4. Baseline ladder

| Slot | Model / config | Purpose |
|------|----------------|---------|
| Floor | `salvatore-1988-v3` | Earlier writer LoRA before full-trilogy corpus and runtime `exampleLines` conditioning |
| Current prod | `salvatore-1988-v4` + fixed `preset-a` conditioning | Fixed-conditioning baseline |
| Example-line rotation (H1) | `salvatore-1988-v4` + rotated `exampleLines` subsets, `tics`/`avoid` held fixed | Primary test arm for H1 |
| Profile-field rotation (H2) | `salvatore-1988-v4` + rotated `tics`/`avoid`, `exampleLines` held fixed at `preset-a` | Primary test arm for H2 |
| Ceiling (profile-only) | Sonnet-4.6 with `profile-only` conditioning (tics + avoid, no exampleLines) — matches exp `#220` archetype POC | Stronger instruction-following anchor for the distinctness axis; labelled `profile-only` to match what the shipped arm config emits |

No training arm. All arms use the frozen proxy eval (§6). The live-writer pilot (§7.2) is a separate run, not a rung.

## 5. Cheapest counterfactuals considered

| Lever | Estimated cost | Disposition |
|-------|----------------|-------------|
| v4 + rotated `exampleLines` subsets (H1 arm) on the proxy eval | Eval-generation + pairwise judging for one arm | MUST-MEASURE. Isolates example-line contribution. |
| v4 + rotated profile fields (H2 arm) on the proxy eval | Same | MUST-MEASURE. Isolates profile-payload contribution. The pre-revision charter had this bundled with H1 and/or flagged as a follow-on; revision promotes it to primary so a win can be attributed to a specific surface. |
| 3-chapter fantasy pilot on live `buildBeatContext` with the winning proxy arm | Full writer + checker passes on a single seed | MUST-MEASURE before any ship action. Confirms the proxy lift survives production prompt shape (per exp #195 lesson). |
| Combined rotation (both `exampleLines` AND `tics`/`avoid` rotating together) | Same as H1 / H2 | DEFERRED. Only run if both H1 and H2 win and the question is whether combining them compounds. Not a ship gate. |
| Corpus expansion retrain (`salvatore-v5-corpus-expansion`) | Training + corpus-prep + eval spend | EXPLICITLY DEFERRED. Reopen only if both conditioning arms fail and the separate corpus charter clears its own source-acquisition gate. |

Work-order reminder: `src/agents/writer/beat-context.ts` is the runtime surface for the live pilot because `exampleLines`, `tics`, and `avoid` are all rendered there under each character profile.

## 6. Distribution match

- **Train set stratification:** Not applicable. This is an inference-conditioning ablation charter, not a training-data change.
- **Proxy-eval stratification:** The proxy run is the frozen [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md) surface: `24` assignment cells, `3` hard pairs, `4` beat archetypes, `3` fixed rotation presets per character. That yields `24` per-arm generations under single-run rotation. The charter compares four non-baseline arms against fixed v4: `v3`, `v4-rotation` (H1), `v4-profile-rotation` (H2), and `sonnet-profile` (ceiling), for `24 × 4 = 96` generations + `48` judge calls × `4` comparisons = `192` judge calls.
- **Proxy-eval caveat (Codex RED blocker #2).** The proxy scorer uses a stripped single-speaker dialogue prompt (beat spec + character profile only). It does NOT exercise the live `buildBeatContext` path with transition bridges, landing-target sentences, resolved references, setting, or multi-character cards. exp #195 already showed Salvatore writer conclusions can fail once the real prompt shape lands. The proxy is a triage surface, not a ship gate.
- **Live-pilot stratification (§7.2).** A single fantasy seed (`fantasy-archive`, `fantasy-cartographer`, or `fantasy-debt` — author's choice at pilot launch) run for 3 chapters end-to-end with the winning proxy arm's conditioning vs fixed v4, same adapter, same prompt otherwise. Measured on: adherence-checker fire rate, chapter-plan-checker deviation count, halluc-leak Rung 0 regex fire rate, subagent-eyeball distinctness score across voiced lines. No new training data, no new judge, no widened seed pool on this charter.

Known proxy-eval mismatch, inherited transparently from the frozen eval:

- `Jarlaxle` and `Zaknafein` do not exist as direct speaking characters in the Icewind Dale trilogy bundle on disk, so [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md) freezes them as explicitly disclosed nearest-match proxy cards. `Jarlaxle` proxies derive from `Pook` / `Malchor`; `Zaknafein` proxies derive from `Drizzt`'s drow-coded confession / teaching register.
- This limitation is acceptable only because it is frozen and disclosed in the eval spec up front. The charter inherits that limitation; it does not hide it.

## 7. Success criteria

### 7.1 Proxy-eval gate (triage; produced by the scorer)

Primary metric is the frozen `salvatore-distinctness-v1` aggregate exact-assignment cell count per arm (out of `24`), reported by [scripts/evals/run-salvatore-distinctness-v1.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/run-salvatore-distinctness-v1.ts) as `arms.arm_{a,b}.exact_assignment_cells_total` plus per-pair counts out of `8` cells each. This is a **single-run aggregate**, not a per-sweep min/max/mean; the rotation arms exercise all three presets across the 24-cell generation cycle but the scorer does not partition output by preset.

Secondary metric is retention on `salvatore-original-v1` plus held-out val, measured as Δ-sum change versus v4.

| Outcome | Condition | Action |
|---------|-----------|--------|
| PROXY PASS (candidate for pilot) | Either H1 or H2 arm adds `>=+4` aggregate cells over fixed v4, AND no anchor pair falls below `3/8`, AND retention worsens by `<=+0.10 Δ-sum` versus v4 | Escalate the winning arm to §7.2 live-writer pilot. Do NOT promote to default routing from the proxy alone. |
| PROXY ITERATE | The arm shows a gain of `+3/24` OR a weaker retention breach (`+0.10 < Δ-sum <= +0.20`) | Document the residual failure by pair; decide whether to run the pilot anyway, run the combined-rotation counterfactual first, or re-scope to corpus expansion. |
| PROXY KILL | Both H1 and H2 arms gain `<=+2/24`, OR retention breach `> +0.20 Δ-sum` for both | End the conditioning-first claim on this charter. Reopen corpus expansion separately, with PDF acquisition treated as that charter's pre-gate. |

### 7.2 Live-writer pilot gate (ship gate; produced by a real 3-chapter novel run)

Only runs if §7.1 emits PROXY PASS for at least one arm. Pilot compares fixed v4 vs the winning arm's conditioning on one fantasy seed, 3 chapters, under the live `buildBeatContext` path.

| Outcome | Condition | Action |
|---------|-----------|--------|
| PILOT PASS (ship) | Winning arm holds a discernible distinctness lift on the live pilot (subagent-eyeball distinctness: the rotation chapters are judged more distinct in a blind A/B more often than not), adherence-checker fire rate does not regress by more than `+2 events per chapter` versus fixed v4, halluc-leak Rung 0 regex fire rate does not regress at all, chapter-plan-checker deviation count does not regress by more than `+1 per chapter` | Promote rotation to default v4 conditioning in `WRITER_GENRE_PACKS` fantasy route IF the implementation stays inference-local. If production needs preset-state plumbing, telemetry changes, or a broader runtime contract, that is a new charter, not scope creep hidden inside this one. |
| PILOT ITERATE | Mixed: distinctness lift is real but one of the regression gates fires | Document and decide between a second seed, a scope-narrowed shipping gate (e.g., behind a feature flag), or kill. |
| PILOT KILL | No discernible distinctness lift, OR a regression gate fires cleanly | End the conditioning-first claim. Reopen corpus expansion. |

Interpretation rule: use count units for all cell/event/deviation thresholds. Do not translate these gates into points or percentages.

## 8. Budget

- **Spend cap:** No training budget. This charter pays only for eval-generation + pairwise judging + one 3-chapter live novel run.
- **Workload anchor:** Use the same pairwise-judging workload shape as exp `#220`, scaled to this eval's 4-comparison arm count. Live-pilot workload anchored to a standard 3-chapter fantasy novel run (~30 beats + standard checker passes).
- **Estimate formula:**
  - Proxy: `(24 generations per arm × 4 comparison arms × avg_cost_per_beat_generation) + (48 pairwise judge calls per comparison × 4 comparisons × avg_cost_per_gpt54_judge_call)`
  - Pilot: `one 3-chapter novel run × avg_cost_per_fantasy_novel_run` (anchor against recent `novels` rows with `seed_key LIKE 'fantasy-%'` in `llm_calls` aggregation).
- **Why this stays formula-only in draft:** recent `llm_calls` were not queryable from the current workspace during charter drafting, so freezing a dollar number here would be invented precision.
- **Pre-run fill-in rule:** If recent `llm_calls` are queryable at launch time, replace the average-cost placeholders with measured recent values and freeze the resulting dollar amount before running. If recent `llm_calls` are not queryable, keep the formula explicit and treat the estimate as anchored to exp `#220` pairwise workload + recent fantasy novel run cost rather than an invented numeric certainty.
- **Time cap:** Under one working day for proxy generation + judging. The pilot is a separate ~3-hour wall-clock run on the LXC (one fantasy novel, 3 chapters).
- **Stop if:** the frozen eval surface changes, the named judge changes, or the comparison requires editing anything beyond inference conditioning / eval orchestration.

## 9. Linked context

- RED original superseded here: [docs/charters/salvatore-v5-corpus-expansion.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/charters/salvatore-v5-corpus-expansion.md)
- Work order: [docs/charters/revision-work-order-2026-04-18.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/charters/revision-work-order-2026-04-18.md)
- Frozen eval spec: [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md)
- Frozen beat pool: [docs/evals/salvatore-distinctness-v1-beats.jsonl](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1-beats.jsonl)
- Frozen voice cards: [docs/evals/salvatore-distinctness-v1-voice-cards.json](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1-voice-cards.json)
- Scoring script skeleton / remaining implementation gate: [scripts/evals/run-salvatore-distinctness-v1.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/run-salvatore-distinctness-v1.ts)
- Runtime conditioning surface: [src/agents/writer/beat-context.ts](/Users/andre/Desktop/personal_projects/novel-harness/src/agents/writer/beat-context.ts)
- Retention / lineage context: [docs/voice-lora-salvatore.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/voice-lora-salvatore.md), [docs/writer-imitation-benchmark.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/writer-imitation-benchmark.md)
- Decision precedent for model-dependent voice judgments: [docs/decisions.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/decisions.md) (`2026-04-17 Archetype POC`)

## 10. Adversary review

§11 readiness gate satisfied by commit `e54b1fe` (scorer TODOs closed: generation, judge, shuffler, arm-config schema). Primary reviewer ran 2026-04-20 and returned **RED**. Charter requires revision before re-review.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — primary | RED | 2026-04-20 | Three blocking issues (see verdict block below). Recommended next action: REVISE CHARTER. |
| `experiment-adversary` (Opus) — fallback only | pending | pending | Only run if Codex is unavailable or a second opinion is explicitly requested after Codex review |

### 10.1 Primary reviewer verdict (2026-04-20, commit `e54b1fe` scorer state)

> VERDICT: RED
>
> SUMMARY: No-ship: the charter's causal claim, ship metric, and rollout decision are misaligned with the landed scorer, so even a win would not cleanly tell you whether live v4 conditioning improved enough to defer corpus expansion (§11.5, §7.1, exp #195).
>
> BLOCKING ISSUES (must fix before run, numbered):
> 1. **Axis 1 / Axis 3 — bundled lever.** §5 defines the tested lever as rotating `exampleLines` / profile subsets, but the landed scorer/configs only vary example-line subsets and never isolate profile contribution; that bundled, misnamed intervention is uninterpretable under §11.5. Fix: scope the charter to example-line rotation only, or add explicit profile-surface arms before treating this as a conditioning-family result.
> 2. **Axis 4 / Axis 7 — distribution mismatch with live writer surface.** §6 treats `salvatore-distinctness-v1` as close to the shipped v4 runtime and §7 allows direct promotion, but exp #195 already showed Salvatore writer conclusions can fail once the real prompt shape lands; under §4.6 and §7.1 this proxy is too far from `buildBeatContext` to justify default rollout. The scorer uses a stripped single-speaker dialogue prompt, not the production `buildBeatContext` path with transition bridge, landing target, resolved references, setting, and multiple character cards. Fix: require a production-shaped A/B pilot on the live writer surface before any ship action.
> 3. **Axis 5 / Axis 7 — threshold metric not producible.** §7 gates on the three-sweep protocol and count thresholds, but the linked scorer/arm configs do not emit separate A/B/C sweep totals or mean/min/max; they collapse presets into one report, violating §11.5 and leaving the ship/kill rules unverifiable. Fix: land explicit sweep-level configs/reporting or rewrite the charter to the single-run metric the tooling can actually produce.
>
> WARNINGS:
> - Axis 2 — §4 calls the ceiling "Sonnet+profile" from exp #220, but the shipped ceiling arm is `profile-only` (no exampleLines), so the ladder anchor is weaker than claimed (§2.1, exp #220).
>
> CHEAPEST UNTRIED COUNTERFACTUAL:
> ExampleLines-only fixed-vs-rotation A/B/C runs on the live `buildBeatContext` surface, plus one 3-chapter fantasy pilot; ~$0 training spend, expected to show whether any distinctness lift survives production prompt shape before corpus work (§4.6, §7.1, exp #195).
>
> RECOMMENDED NEXT ACTION: REVISE CHARTER.

Codex full output: background job `bshvls959`, thread `019dac87-b12a-7d30-9e47-32656ee7e7b4`.

## 11. Open questions / readiness gate

- Original gate ("do not re-review until `salvatore-distinctness-v1` exists as a frozen eval artifact with a named judge and the charter is scoped to conditioning-first rather than corpus expansion") — **closed** by the frozen eval spec (`status: frozen-2026-04-18`, judge `gpt-5.4`).
- Scorer-implementation gate — **closed by commit `e54b1fe` (2026-04-20).** `generateSample()`, `judgePair()`, `shufflePairDeterministic()`, and the on-disk arm-config schema all shipped.
- Adversary-review gate — **in flight.** Codex returned RED on 2026-04-20 against the pre-revision charter (§10.1). This revision restructures the lever into H1/H2, rewrites §7 into proxy + pilot gates, and downgrades the proxy eval from a ship metric to a triage metric. Re-review required before executing §7.1 proxy generation.
- **Scorer extension gate — open.** The H2 arm (`v4-profile-rotation`) requires the scorer to gain a new `conditioning: "profile-rotation"` mode that rotates `tics`/`avoid` across frozen profile-subset presets while holding `exampleLines` fixed at `preset-a`. A corresponding `docs/evals/arm-configs/v4-profile-rotation.json` must land. Cannot run §7.1 before this lands.
- **Live-writer pilot plumbing gate — open.** No existing script runs a 3-chapter novel with a conditioning override on the `buildBeatContext` surface. Either (a) the conditioning override is plumbed through `WRITER_GENRE_PACKS` / `buildBeatContext` temporarily with a feature flag, or (b) the pilot runs are hand-configured by editing the `WRITER_GENRE_PACKS` fantasy pack in place (not persisted) and reverted after the pilot novels land in `public.novels`. §7.2 cannot run before this is chosen.
- Open post-win path: if the pilot passes, does rotation ship behind a feature flag or as the unconditional default? Inference-local implementation is allowed here; anything broader (preset-state plumbing, telemetry changes, runtime contract changes) spawns a new charter.
- Corpus-expansion acquisition remains orthogonal. If both arms fail §7.1, reopen the corpus charter separately and treat source-book acquisition as that charter's pre-gate.
