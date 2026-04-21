---
status: proposed
kind: experiment-charter
experiment-family: rewrite-capability-probe
proposed-by: Claude + user + Codex strategic consult (2026-04-21)
proposed-date: 2026-04-21
adversary-verdict: pending
supersedes: none
depends_on: docs/decisions.md (conditioning-floor KILL entry, 2026-04-21)
---

# Experiment Charter — `rewrite-capability-probe`

**What this exists to answer.** Does the `salvatore-1988-v4` writer LoRA have rewrite capability, or does it only redraft? More precisely: given prose with a known quality defect and a targeted critique, does the adapter produce meaningfully better prose than the same adapter given the same inputs with NO critique (pure redraft)?

The answer is load-bearing. It gates the editor-vs-model-upgrade decision in the post-conditioning-floor strategic direction. If the adapter can rewrite, we extend the existing retry surface (beat-checks.ts) to catch more quality defects. If it can't, we either (a) collapse "editor" to "detector + fresh redraft" without critique, (b) build a rewrite-training set and fine-tune a rewrite-specialist, or (c) upgrade the writer model itself and test its rewrite capacity.

## 1. Question

On the 20 pre-registered conditioning-floor failure beats (source novel `pp2-floor__prompt__fantasy-debt__1776710485411`), does `salvatore-1988-v4` invoked via the **production retry-context builder** with a targeted critique produce better prose than the same adapter invoked with the same shared inputs and NO critique, on three separate axes (voice distinctness, repetition reduction, reliability)?

## 2. Hypothesis

**H1 (capability claim):** **If** we invoke `salvatore-1988-v4` on 20 pre-registered beats under two arms — **(a) no-critique redraft** (same BeatContext as the original, new sampling, no issue text) vs **(b) critique-driven rewrite** using the production retry-context builder with an issue string naming a specific defect — **then** on the subset of beats that exhibited repetition loops in the conditioning-floor pilot (≈4-6 beats), the rewrite arm wins ≥65% of blind pairwise repetition-reduction judgments, **because** if the adapter can interpret critique as actionable constraint, it should fix the specific failure mode named in the critique more reliably than a fresh sampling roll.

**H2 (distinctness claim):** On the voice-collapse subset (beats where Sonnet flagged collapsed voice in the conditioning-floor pilot), rewrite arm wins ≥50% of blind pairwise voice-distinctness judgments — i.e., rewrite at least ties redraft. Stronger than 50% suggests rewrite is actively preserving voice while fixing the defect.

**H3 (reliability claim):** Underlength (<50 words) rate is strictly not worse in rewrite arm than redraft arm across all 20 beats. Mechanical auto-loss outside the LLM judge (per `resolveLossShortCircuit` in the existing judge wrapper).

Failure of any of H1/H2/H3 is informative; falsification per §3.

## 3. Falsification threshold

The adapter "cannot use critique as actionable constraint" if:

1. **H1 fails:** repetition-reduction pairwise win rate of rewrite ≤ redraft on the repetition-loop subset (i.e., tied or worse). That means critique isn't guiding the adapter; it's just extra noise.
2. **H2 fails:** voice-distinctness pairwise win rate of rewrite < redraft on the voice-collapse subset (rewrite actively hurts voice while trying to fix defects). That's strong evidence critique is harmful, not neutral.
3. **H3 fails:** rewrite arm has strictly more underlength outputs than redraft. The adapter is using critique in a way that destabilizes output length.

If all three prongs fire, the adapter's critique-driven rewrite capability is absent; the "editor" recommendation collapses to "detector + redraft with same inputs," no rewrite training needed. If only H1 fires, rewrite training (option c in pre-charter discussion) becomes the next-cheapest counterfactual. If H1 passes, extending the retry surface is justified.

## 4. Baseline ladder

| Slot | Config | Role | Purpose |
|------|--------|------|---------|
| Redraft (a) | `salvatore-1988-v4` + production `BeatContext` (outline, characters, prior prose) + NO critique + fresh sampling seed | Control | What the adapter does from scratch given the same inputs |
| Rewrite (b) | `salvatore-1988-v4` + production retry-context builder output (V1 prose + issue string + the same BeatContext) | Treatment | What the adapter does with targeted critique |

No cross-model arms in this charter (no Sonnet-as-editor, no DeepSeek-as-rewriter). The question is about the 14B LoRA's capability, not relative rewrite power. Cross-model probes reopen only if H1/H2/H3 all fail AND the user wants to pursue rewrite-training or model-upgrade as next step.

## 5. Cheapest counterfactuals considered

| Lever | Cost | Disposition |
|-------|------|-------------|
| Retrospective `llm_calls` mining (V1→V2 rows from existing adherence-retries) | ~$0 | **REJECTED.** Codex audit (2026-04-21, job `bv11wtzfn`) established that existing V1→V2 rows are post-selected on failing V1s + always include critique. The "no-critique redraft" counterfactual does not exist in the data. DB is a useful beat-sampler but not a decision dataset. |
| Hand-built critique-rewrite prompt shape | ~$0.05 | **REJECTED.** The production retry surface is not "V1 prose + critique string"; it truncates prior prose, formats issues specifically, injects prior-beat alignment. A hand-built simplification wins/loses in a way that doesn't transfer to the code we'd extend. Arm (b) must invoke the real retry-context builder. |
| Probe as designed (production retry path, 3-axis judge) | ~$0.10 writer + 0 judge via Sonnet subagents | **MUST-MEASURE.** Primary arm of this charter. |
| Build a rewrite training set + fine-tune rewrite-specialist | ~$3-5 + corpus-mining | **DEFERRED.** Only opens if H1 fails and the user chooses training over redraft-collapse. |
| Upgrade base writer model (DeepSeek V3.2 as rewriter) | ~$0.20 writer on one arm | **DEFERRED.** Parallel question, not gating for this charter. Would need its own charter if pursued. |

## 6. Distribution match

- **Test set:** the same 20 pre-registered pair-builder beats from the conditioning-floor pilot (`output/evals/conditioning-floor-pairs-v1.jsonl`). These are dialogue-multi-character beats stratified across 5 chapters of `pp2-floor__prompt__fantasy-debt__1776710485411`.
- **Source for V1 prose input to arm (b):** the ROTATION-arm prose from the conditioning-floor pilot (the arm that exhibited the failure modes). Stored in `output/evals/conditioning-floor-pilot-v1-triplets.json`, fields `rotation.prose` per beat. Using rotation-arm V1 is important because the failure modes (repetition, voice collapse) are the ones we're testing rewrite on.
- **Source for critique strings:** generated per-beat by a deterministic classifier pass (repetition regex detector + a one-shot Sonnet subagent distinctness call) BEFORE arm (b) runs. Committed as `output/evals/rewrite-probe-critiques.jsonl` artifact for reproducibility.
- **Shared inputs across arms:** outline, character states, prior-beat prose (timestamp-anchored per `getBeatProseFromLLMCalls`), genre pack. Same shared-BeatInputs contract as the conditioning-floor replay runner.
- **Arm isolation:** arm (a) and arm (b) both invoke `salvatore-1988-v4` with `WRITER_CONDITIONING` unset (raw mode, matching production). Only difference: arm (a) passes NO critique; arm (b) passes the committed critique string through the production retry-context builder.
- **Parity harness (per experiment-design-rules §4.7):** must validate arm (b)'s writer request shape against a real `llm_calls` row from an historical adherence-retry. Arm (a) parity is trivial (matches fresh-draft shape, which we already validated on conditioning-floor). Arm (b) parity is the non-trivial piece and is an open §11 gate.
- **Blind judging:** pairwise (arm_a prose vs arm_b prose), shuffled per pair via sha256(seed + pair_id), judged by Sonnet via Agent subagents (NOT codex plugin — per memory `feedback_codex_plugin_subagentic_concurrency.md`). Three separate judge passes per pair: repetition, voice distinctness, overall. Judge prompt frozen in `docs/evals/rewrite-capability-judge-prompt.md` before run.

## 7. Success criteria

Three separate dimensions, scored independently. Mechanical auto-losses (underlength, error) are pre-filtered via the existing `resolveLossShortCircuit` path and do NOT enter the LLM judge.

**Primary gate: repetition-loop subset (H1).** On the subset of beats where Sonnet flagged repetition in the conditioning-floor pilot (expected ≈4-6 beats), pairwise repetition-reduction judgments. Threshold scales with N.

| Outcome | Condition (repetition subset) | Action |
|---------|-----------|--------|
| REWRITE CAPABILITY CONFIRMED | Rewrite wins ≥ round(0.65 · N_rep) pairwise + H2 not falsified + H3 not falsified | Extend the existing retry surface to trigger on repetition/voice-collapse detectors. Open follow-on charter for detector training. |
| AMBIGUOUS | Rewrite wins in the 50-64% range on repetition subset | Do not commit to editor infrastructure. Run the probe on a second source novel before deciding. |
| REWRITE CAPABILITY ABSENT | Rewrite wins ≤ 50% on repetition subset OR H2 falsified OR H3 falsified | "Editor" collapses to "detector + no-critique redraft" (arm a). Rewrite-training option stays open but requires its own charter. |

**Secondary reporting (not gating but required in the write-up):**
- Voice-distinctness pairwise win rate on voice-collapse subset
- Overall distinctness pairwise win rate on all 20 beats (for continuity with conditioning-floor)
- Per-arm underlength rate (<50 words) and error rate
- Per-beat critique string + pairwise verdicts, with reasoning from the judge

## 8. Budget

Real numbers from `public.llm_calls`:

- Writer spend: 20 beats × 2 arms × ~$0.001-0.003 per Salvatore v4 beat call = **$0.04-$0.12 total**. Plus detector calls (~20 × $0.0005 for Sonnet subagent distinctness check) ≈ $0.01 additional.
- Judge: Sonnet Agent subagents. **~$0 direct**, may add ~30-60 minutes of subagent wall time for 3 judge passes × 20 pairs.
- Detector implementation: ~1-2 hours (repetition regex is trivial; voice-collapse requires one Sonnet call per beat).
- **Total spend: under $1.** No training.

**Time cap:** under one working day for implementation + probe + judge + write-up.

**Stop if:** Arm (b) parity check fails (production retry path doesn't match expected shape on an historical `llm_calls` row); critique-generator produces empty strings on >3 of 20 beats (detector is unreliable); writer rate limiting kicks in asymmetrically between arms.

## 9. Linked context

- Triggering decision: `docs/decisions.md` 2026-04-21 conditioning-floor KILL entry.
- Strategic direction memory: `~/.claude/projects/.../memory/project_context_engineering_priority.md`.
- Codex consults informing this charter: jobs `bre6gu89b` (strategic direction), `bsbwl0v3g` (three-layer doctrine critique), `bv11wtzfn` (probe-design critique). Summaries in conversation transcript, not yet in any durable doc.
- Parity-harness SOP: `docs/experiment-design-rules.md §4.7`.
- Concurrent-Codex warning: `~/.claude/projects/.../memory/feedback_codex_plugin_subagentic_concurrency.md`. This charter uses Sonnet Agent subagents, not codex exec.
- Production retry surface (the code arm (b) must invoke): `src/phases/drafting.ts` retry path + `src/phases/beat-checks.ts` issue aggregation. To be audited as part of §11 open gate.
- Reusable infra from conditioning-floor: pair JSONL format, `shufflePair`, `resolveLossShortCircuit`, `ReplayTriplet` shape, parity-harness structural-segment diff, judge wrapper with `--concurrency` flag.

## 10. Adversary review

Awaiting round 1.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — round 1 | pending | pending | First adversarial review on this charter. |
| `experiment-adversary` (Opus) — fallback | pending | pending | Only if Codex unavailable or user requests second opinion. |

## 11. Open questions / readiness gates

Must close before §7 runs:

- **(open) Audit the production retry-context builder.** Currently embedded in `src/phases/drafting.ts`. Needs to be extracted as a callable function that takes `(beatContext, v1Prose, issues)` and returns the exact prompt bytes production sends on a checker-failure retry. Without this, arm (b) can't be invoked faithfully.
- **(open) Extend the parity harness to validate arm (b).** Take an historical `llm_calls` row from an adherence-retry (agent=beat-writer, attempt > 1, with critique in the request) and confirm arm (b) reproduces its request shape byte-for-byte. If no such row exists for this source novel, find one in archive or fall back to synthesizing via direct inspection of the retry-context builder's output.
- **(open) Detector implementation.** Repetition-loop detector: n-gram regex against each beat's prose, threshold on repeated-bigram/trigram counts. Voice-collapse detector: Sonnet subagent pairwise-within-beat check (does character A sound like character B?). Both deterministic or near-deterministic given the same input.
- **(open) Critique-string artifact generator.** Runs detectors over V1 prose (rotation arm from conditioning-floor pilot), emits `rewrite-probe-critiques.jsonl` with per-beat critique strings. Committed before arm (b) runs so the probe is reproducible.
- **(open) Frozen judge prompt.** Voice-distinctness + repetition rubrics, analogous to `docs/evals/conditioning-floor-judge-prompt.md`. Frozen before run.
- **(open) Sonnet-subagent-backed judge wrapper.** The conditioning-floor judge uses `codex exec` which failed under concurrency. This charter's judge should invoke Sonnet via the Agent tool (chunked pair-sets, parallel subagents) as the parallel-backed alternative. Reusable for future evals.

### Post-outcome paths

- **CONFIRMED:** Open follow-on charter for production detectors (repetition + voice-collapse) with a clean spec, detector SFT if needed, and integration into beat-checks.ts. Do NOT ship detectors without a second charter round — premature shipping was a prior failure mode.
- **AMBIGUOUS:** Run the probe on a second source novel (different drafted fantasy seed) using the same arm + judge setup. Decide after seeing 40 beats of evidence.
- **ABSENT:** Collapse the "editor" recommendation in the strategic direction memory to "detector + no-critique redraft." Rewrite-training charter reopens only if the user wants to pursue the v5-or-rewrite-specialist path.

Cross-model question (DeepSeek V3.2 as rewriter, or other base model) deferred to its own charter regardless of outcome here; independent of the 14B adapter's own capability.
