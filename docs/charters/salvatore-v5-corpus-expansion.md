---
status: draft
kind: experiment-charter
name: salvatore-v5-corpus-expansion
owner: andre
date: 2026-04-23
pre-gate: PDF acquisition for 3-5 additional Salvatore novels beyond the Icewind Dale Trilogy
parent-context: docs/decisions.md (conditioning-floor KILL entry, 2026-04-21, commit 639712e)
depends_on: docs/charters/salvatore-distinctness-conditioning-floor.md (conditioning-floor KILL verdict)
---

> **STATUS: DRAFT.** This charter does not proceed to `proposed` until the pre-gate is cleared: physical PDF files for 3-5 additional Salvatore novels must be on disk (local or LXC) before adversary review is requested. The acquisition step is non-trivial — the original v1 charter (last live at `7cc6322`) was blocked at Step 0 by this same missing-PDFs gate. Do not submit to `/charter-review` until that inventory exists.

# Experiment Charter — `salvatore-v5-corpus-expansion`

**What this exists to answer.** Does expanding the Salvatore training corpus beyond the Icewind Dale Trilogy — to include 3-5 novels from the Legacy of the Drow series — produce measurable improvement in multi-character voice distinctness over Salvatore v3/v4, trained on the same 777-beat Icewind Dale corpus?

This is Option D from `docs/todo.md` "Salvatore voice LoRA — multi-character distinctness options": do corpus expansion first (Option A), measure whether it alone moves the distinctness metric before adding archetype tags (Option B) or escalating to a 70B base (Option C).

## 1. Question

Given a Salvatore LoRA (v5) trained on the Icewind Dale Trilogy plus 3-5 Legacy of the Drow novels (~3,000+ total beats vs. current 777), does v5 produce measurably better multi-character voice distinctness than the current production LoRA (v3, baseline) on the same beat evaluation set?

The "same training config" constraint is load-bearing: v5 uses the same 14B base (`OpenPipe/Qwen3-14B-Instruct`), same r=16 LoRA rank, same training script (`scripts/finetune/train-lora.py`), same prompt format (harness-shaped user prompts + 3-variant rename augmentation). The only variable is corpus breadth. This isolates corpus size from other training decisions.

## 2. Hypothesis

**If** we train Salvatore v5 on the Icewind Dale Trilogy plus the Legacy of the Drow series (candidates: *The Legacy*, *Starless Night*, *Siege of Darkness*, *Passage to Dawn*) and evaluate v5 vs. v3 on the same 20-beat distinctness evaluation set, **then** v5 will show a character-distinctness pass rate improvement of ≥10 percentage points over v3, **because** the current 777-beat Icewind Dale corpus is dominated by Drizzt/Wulfgar/Bruenor as POV characters. The Legacy of the Drow series introduces Jarlaxle (theatrical, oblique), Artemis Entreri (clipped, transactional), and Catti-brie in a different emotional register — characters Salvatore himself writes with distinct voices. A LoRA that has seen these distinctions in weight-level training should generalize them to novel fantasy characters even under rename augmentation.

**Falsification threshold:** if v5 character-distinctness pass rate is within 5 percentage points of v3 on the evaluation set (i.e., improvement < 5pt), the corpus-expansion lever is not sufficient alone. Move to Option B (archetype tags on expanded corpus) per the stacked Option D path.

## 3. Pre-gate

**PDF acquisition is the hard Step-0 prerequisite.** The v1 charter was superseded partly because this step was not completed. Do not begin corpus ingestion, training data build, or any spend until the following is confirmed:

- [ ] PDFs for a minimum of 3 Salvatore novels beyond the Icewind Dale Trilogy exist on disk (local machine or LXC)
- [ ] Candidate titles: *The Legacy* (1992), *Starless Night* (1993), *Siege of Darkness* (1994), *Passage to Dawn* (1996) — Legacy of the Drow series. All feature Jarlaxle, Entreri, and Catti-brie as POV or significant-voice characters.
- [ ] Inventory logged before proceeding (title, file path, file size sanity check, source)

Once PDFs are confirmed, upgrade this charter's status from `draft` to `proposed` and submit to adversary review.

## 4. Baseline ladder

| Slot | Config | Role |
|------|--------|------|
| **v3 (baseline)** | `wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v3` | Current production. Icewind Dale Trilogy, 777 beats. |
| **v5 (treatment)** | `wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v5` (to be trained) | Icewind Dale + Legacy of the Drow, ~3,000+ beats, same training config. |

No cross-model arms in this charter. The question is whether corpus breadth alone moves the metric on the same 14B base; cross-model questions (e.g., 70B base, DeepSeek base) are covered by separate charters.

## 5. Arms

- **Arm A (control):** v3 LoRA generating beats on the shared evaluation set (20 beats stratified across fantasy character types, consistent with the conditioning-floor evaluation instrument).
- **Arm B (treatment):** v5 LoRA, same evaluation set, same BeatContext, same generation parameters.

Both arms run with `WRITER_CONDITIONING` unset (raw mode). The evaluation set and prompt construction are identical across arms. Parity harness (per `experiment-design-rules.md §4.7`) confirms arm B's prompt bytes are byte-equal to arm A's except for the model URI in the request envelope.

## 6. Measurement

**Primary instrument:** decomposed character-distinctness Sonnet audit. Same rubric as `voice-shaping-ablation-v1` and the conditioning-floor evaluation:

> For each beat with two or more speaking characters, decide: do the characters sound meaningfully different from each other — in diction, cadence, register, or signature phrasing — grounded in their speaker profiles?
>
> Mandatory grounding: quote one line from each speaking character, cite the specific speaker-profile attribute (voice, drives, avoids, conflict) the line reflects, and decide.
>
> Do NOT reward length, sensory richness, prose polish, or dialogue tag variety. A distinctness win means "the reader could tell who's speaking without the tag."
>
> Label: PASS / FAIL / UNCLEAR (with quote-required justification).

**Secondary instrument:** halluc-leak-salvatore fire rate on v5 output. Corpus expansion must not increase corpus-vocabulary leakage vs. v3. The expanded corpus includes "Drizzt", "Mithril Hall", and Legacy-of-the-Drow-specific vocabulary (Menzoberranzan, Jarlaxle, Bregan D'aerthe). A per-term regex scan (same as `halluc-leak-salvatore-v1` pattern) confirms v5 leak rate does not exceed v3 + 5 percentage points.

**Tertiary check:** underlength rate (<50 words per beat) and error rate across both arms. Corpus expansion must not destabilize output length.

## 7. Cheapest counterfactual

**The cheapest untried counterfactual is: what if corpus expansion just adds more of the same Drizzt-POV voice and doesn't increase character distinctness?**

This is a real risk. The Legacy of the Drow series still has Drizzt as the central POV character; Jarlaxle and Entreri appear prominently but are not always POV. If the expanded corpus is still 60-70% Drizzt-POV, the LoRA may learn more Drizzt-voice signal without learning cross-character discrimination.

**Detection plan:** before training, run a POV distribution analysis on the corpus breakdown:

- Count beats by POV character across all ingested novels.
- If Drizzt-POV > 60% of the expanded corpus, the hypothesis is at risk. Flag before committing training spend.
- If flagged: either (a) use stratified sampling to cap Drizzt-POV at ~50% across training pairs, or (b) escalate directly to Option B (archetype tags) which addresses the POV-imbalance problem structurally rather than hoping breadth solves it.

This detection step happens at Stage 3 of the corpus pipeline (beat segmentation outputs include speaker/POV labels) and costs $0 in model spend.

## 8. Budget

- **Corpus ingestion:** `scripts/finetune/ingest-corpus.py` per `docs/corpus-ingestion.md`. 3-5 novels × ~307K words each → ~1.2M–1.5M total words. Ingestion is CPU-bound text processing; ~$0 model cost. ~2-4 hours wall-clock per `docs/corpus-pipeline.md` Stage 1-4 timeline.
- **SFT training:** 1 training run on W&B Serverless (ART framework). ~$3-10 at metered $500/month cap, actual burn ~$3.76/month per CLAUDE.md. r=16 adapter, `OpenPipe/Qwen3-14B-Instruct` base. Intermediate artifacts ~3.7 GB; `train-lora.py` auto-cleans after training.
- **Eval pass:** 20 beats × 2 arms = 40 generation calls (v3 arm reusable from conditioning-floor eval if within 30-day freshness window). Distinctness audit via Sonnet subagents, same concurrency pattern as conditioning-floor. ~$0.05 generation + ~$0.10 judge. Total eval: < $0.20.
- **Total spend estimate:** under $15. Under $5 if prior v3 eval rows are reused.
- **Hard stop:** if W&B training run fails or storage cap is exceeded, pause and resolve before retrying. See `python3 scripts/finetune/cleanup-wandb-storage.py --delete` for manual cleanup.

W&B Inference serving: $0.05/$0.22 per 1M tokens input/output. See `docs/decisions.md` "W&B Inference on OpenPipe/Qwen3-14B-Instruct" for full pricing and serving SOP.

## 9. Success criteria

| Outcome | Condition | Action |
|---------|-----------|--------|
| **CORPUS EXPANSION WORKS** | v5 distinctness pass rate ≥ v3 + 10pt AND leak rate ≤ v3 + 5pt | Promote v5 to production `WRITER_GENRE_PACKS` fantasy route. Option B (archetype tags) deferred unless users request further improvement. |
| **MARGINAL IMPROVEMENT** | v5 distinctness in the 5-9pt improvement range over v3 | Hold v3 in production. Proceed to Option B (archetype tags on v5 corpus) as next experiment. |
| **FLAT OR REGRESSION** | v5 distinctness within 5pt of v3 (improvement < 5pt) OR distinctness regresses | Corpus expansion alone is insufficient. Proceed to Option B per stacked Option D path. If POV-distribution analysis flagged Drizzt-POV imbalance, that explains the null; stratified training set is the intervention before escalating. |
| **LEAK GATE FAILS** | v5 leak rate > v3 + 5pt absolute | Reject v5. Investigate whether expanded corpus vocabulary (Menzoberranzan, Jarlaxle) is bleeding through rename augmentation; adjust strip list in `train-lora.py` before retraining. |

## 10. Linked context

- **Triggering decision:** `docs/decisions.md` conditioning-floor KILL entry (2026-04-21, commit `639712e`). §7 KILL post-outcome path explicitly listed "Reopen `salvatore-v5-corpus-expansion` as a separate charter."
- **Option D definition:** `docs/todo.md` "Salvatore voice LoRA — multi-character distinctness options" §Option D — stacked path (A first, B if needed, C in reserve).
- **Prior v1 charter:** superseded at commit `7cc6322` by the conditioning-floor charter; full RED verdict and blocking issues recorded in `docs/decisions.md` "`salvatore-v5-corpus-expansion` (2026-04-18)."
- **Corpus pipeline:** `docs/corpus-pipeline.md` — canonical 5-stage architecture. Salvatore Icewind Dale bundle at `novels/salvatore-icewind-dale/` is the reference implementation (2,470 training pairs, all 14 invariants pass).
- **Corpus ingestion SOP:** `docs/corpus-ingestion.md` + `scripts/finetune/ingest-corpus.py`.
- **Training SOP:** `docs/decisions.md` "W&B Inference on OpenPipe/Qwen3-14B-Instruct" + `scripts/finetune/train-lora.py` + `docs/lora-style-transfer-report.md`.
- **Measurement instrument:** same decomposed Sonnet audit rubric as `voice-shaping-ablation-v1` and conditioning-floor.

## 11. Adversary review

Status: **not submitted** (charter is `draft`; pre-gate not cleared).

Primary reviewer when ready: `/codex:adversarial-review` (GPT-5.4, high effort). Fallback: `experiment-adversary` (Opus).

Block execution on YELLOW or RED. The v1 charter received 6 blocking issues from Codex adversary review (2026-04-18) — read that record in `docs/decisions.md` before submitting this charter to avoid repeating the same structural gaps.

Key concerns to address in adversary review:
1. POV distribution analysis result (Drizzt-POV %, sampling strategy if imbalanced)
2. Eval instrument — confirm same frozen rubric, same judge, same beat pool as conditioning-floor
3. Halluc-leak gate bounds justified by actual v3 fire rates from production `llm_calls`
4. Budget accounting for corpus ingestion wall-clock time (not modeled in prior v1 budget)
