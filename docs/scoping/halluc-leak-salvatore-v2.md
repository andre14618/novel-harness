---
status: draft
kind: scoping-document
subject: halluc-leak-salvatore-v2
date: 2026-04-20
author: claude-agent
blocks-on: adversary-GREEN charter before any training spend
---

# Scoping — `halluc-leak-salvatore-v2`

Pre-charter research document. Identifies gaps in v1, proposes an intervention ladder,
and surfaces the key decisions that require user input before a charter is written.
No training scripts are included; this document gates the charter, which gates the run.

---

## 1. Gap diagnosis

### V1 training inventory

V1 was built by `scripts/hallucination/format-v3-two-adapters.ts`, which produced
`finetune-data/halluc-leak-salvatore-v1-train.jsonl`. The v1 positive examples come
exclusively from `FAIL_CORPUS_LEAK` variants in the Cerebras + DeepSeek synth pools —
one token per pair, drawn from whatever §A tokens happened to appear in those scenario
variants. No systematic per-token coverage was enforced at v1 format time.

Adapter registry (seed-adapter-registry-v3.ts, 2026-04-18) records:

| Metric | Value |
|---|---|
| synth-val precision | 1.00 |
| synth-val recall | 0.900 |
| synth-val F1 | 0.947 |
| natural-val precision | 0.80 |
| natural-val recall | 0.40 |
| natural-val F1 | 0.533 |
| training data path | `finetune-data/halluc-leak-salvatore-v1-train.jsonl` |
| eval experiments | (none assigned; registry `eval_experiment_ids: []`) |

A vocab-expansion attempt (`expand-leak-vocab.ts` → `build-leak-v2-train.ts`) was
already run but killed: the expanded v2 train set (648 pairs, 50/50 FAIL/PASS after
oversample) worsened precision from 86% → 50% while improving recall only 40% → 60%.
The mechanism failed per the retroactive charter `docs/charters/EXAMPLE-leak-v2-retroactive.md`
(adversary verdict RED; §6 class-rate mismatch predicted 15–30 pt precision hit from
the 50/50 training prior against a ~6% FAIL production distribution; additional mismatch
from DeepSeek-synthesized prose not matching the Salvatore LoRA cadence).

### Token-level coverage gaps

The §A vocabulary list in `expand-leak-vocab.ts` (49 tokens) and in `build-natural-leak-val.ts`
(~57 terms) share a core set. The following tokens were **absent from both lists** as of
the v1 training run:

- **Waterdeep** — not in `LEAK_TOKENS` (expand-leak-vocab.ts) nor in `LEAK_TERMS`
  (build-natural-leak-val.ts). Zero training examples. Zero natural-val coverage.
- **Baldur's Gate** — not in `LEAK_TOKENS`. Not in `LEAK_TERMS`. Zero training examples.
  Appears in `format-sft.ts` and `generate-halluc-data.ts` v1 system prompt as an ad-hoc
  example in Category A corpus-leakage text, but never as a named training target.
- **Drossen Ironbelly** — not in either list. Zero training examples. (Surfaced in
  exp #254 V1 fire classification: `docs/decisions.md` "beat-entity-list V1 shipped".)
- **Chionthar** (river) — not in either list. Appears in
  `classify-remaining-fires-results.jsonl` as a production leak (class C_sysleak /
  C_invention depending on attempt).

Tokens in the list but with demonstrated partial recall in production:

| Token | In LEAK_TOKENS? | In LEAK_TERMS? | Observed production recall | Source |
|---|---|---|---|---|
| Waterdeep | NO | NO | 0/4 observed fires caught | User-provided exp #254 context |
| Baldur's Gate | NO | NO | 1/4 observed fires caught | User-provided exp #254 context; `classify-remaining-fires-results.jsonl` shows 4 fires, leak adapter under-fired |
| Ten-Towns | YES | YES | 1/2 partial | User-provided exp #254 context; `classify-remaining-fires-results.jsonl` line 19 (class C_sysleak, caught); separate fire missed |
| Luskan | YES | YES | 1/2 partial | User-provided exp #254 context |
| Do'Urden | YES | YES | 1/2 partial | User-provided exp #254 context |
| Maer Dualdon | YES | YES | 1/2 partial | User-provided exp #254 context; also in `classify-remaining-fires-results.jsonl` line 15 |
| Bremen's Run | Partial ("Bryn Shander" in list, not "Bremen") | NO | Caught in replay | `replay-results.jsonl` line 1 (TP); suggests Bremen sub-tokens work but not reliable |

### Root cause: what actually happened in the v2 attempt

From `EXAMPLE-leak-v2-retroactive.md` §6: the primary mechanism failure was the
**class-rate mismatch** (50/50 training prior vs ~6% production FAIL rate → 8× calibration
shift → 15–30 pt precision hit) combined with **cadence mismatch** (DeepSeek-generated
prose in a single synthesizer cadence vs production Salvatore-LoRA output). The vocab
expansion per-token coverage itself was in the right direction but was buried under these
structural defects. The retroactive adversary verdict was **not** "token list expansion
can't work" — it was "this training construction was guaranteed to overcalibrate toward
FAIL and the training prose didn't look like production."

Key §11.2 violation from the retroactive charter: **the regex counterfactual was never
measured** before the fine-tune ran. At $0 cost, a case-insensitive substring match
against the §A vocabulary list provides an upper bound on list-match precision. This
remains the cheapest lever and must be evaluated before any v2 SFT.

### Exp #254 (beat-entity-list V1) — additional leak evidence

`docs/decisions.md` "beat-entity-list V1 shipped" (exp #254, 2026-04-20) reports:

> Class A/C fires split roughly between **Salvatore corpus leaks (Waterdeep, Luskan,
> Ten-Towns, Bryn Shander, Do'Urden, Baldur's Gate, Drossen Ironbelly — LoRA leakage
> that halluc-leak-salvatore under-fired on; 0 fires on this seed is a separate finding)**
> and novel-specific writer inventions.

This confirms: on the `fantasy-debt` seed, the leak adapter fired **0 times** despite
the Salvatore LoRA producing at least 7 distinct corpus-leak tokens in the prose.
The overall 7-novel production panel shows 15.7% fire rate (40/255 beats), which
sounds plausible until you realize many of those 40 fires may be high-frequency tokens
(Drizzt, Bruenor, drow) while the adapter is systematically blind to proper-place tokens
like Waterdeep and Baldur's Gate that are not in its training vocabulary at all.

---

## 2. Proposed data expansion

### Rung 0 (pre-charter, $0): Measure the regex ceiling

Before writing any training code, run a case-insensitive substring match against the
complete §A token list (including Waterdeep, Baldur's Gate, Drossen Ironbelly,
Chionthar, Harpells, plus all existing LEAK_TOKENS) against:

- The existing natural-val set (`finetune-data/halluc-leak-salvatore-natural-val.jsonl`)
- The 7-novel production panel `llm_calls` rows where `agent_role = 'halluc-leak-salvatore'`

This takes <1 hour and is a hard requirement per the retroactive charter §5 (§11.2
violation: "regex post-processing was not measured — required measurement"). If regex
hits ≥85% precision and ≥75% recall on natural val, the correct answer is **OR-combine
the regex with v1's adapter output** at inference time (zero training cost). Only proceed
to SFT if the regex ceiling on its own fails to hit one of those thresholds, because
some production leaks (e.g. "drow" used as a standalone word, "Do'Urden" suffix in a
constructed surname) benefit from context-aware detection that a pure substring match
can't provide.

### Rung 1 (pre-charter, $0): Widen the token list

The LEAK_TERMS list in `build-natural-leak-val.ts` and the LEAK_TOKENS list in
`expand-leak-vocab.ts` need to be synchronized and expanded. Concrete additions:

**Definitely missing (confirmed leaks in production, zero training coverage):**
- Waterdeep (major Forgotten Realms city; appears in Salvatore LoRA training corpus)
- Baldur's Gate (Forgotten Realms city; confirmed 3/4 fires missed)
- Drossen Ironbelly (character/creature name from Salvatore corpus; exp #254)
- Chionthar (river; `classify-remaining-fires-results.jsonl`)
- Harpells (family name; referenced in `build-natural-leak-val.ts` system prompt but
  not in the structured LEAK_TERMS list; also cited in the halluc-v3 production report
  "Harpells" as a missed true positive)

**Likely missing (Forgotten Realms proper nouns in Salvatore's wider bibliography
that a Qwen3-14B LoRA trained on Icewind Dale / Crystal Shard / Streams trilogy
corpus may leak):**
- Neverwinter
- Menzoberranzan
- Gauntlgrym  
- Helm's Hold
- The Sea of Swords
- Deudermont's ship names (Sea Sprite is the canonical one)

User input required on scope (see §Open questions).

### Rung 2 (training intervention, ~$2-4): Correct the training construction

If the regex + widened token list (rungs 0–1) still falls short of the precision/recall
targets, a retrained SFT adapter is warranted. The v2 attempt's failures were structural,
not inherent to the fine-tuning approach. The corrected construction must address:

**Problem 1: Class-rate calibration mismatch.**
V1 and the aborted v2 both trained with 50/50 or 1:2 FAIL:PASS ratios. Production
FAIL rate is ~6% (40 fires / 255 beats on the 7-novel panel, but many of those 40 may
be high-frequency tokens; true per-beat novel-level FAIL rate is likely 3–8%). A
training ratio closer to 1:10 (FAIL:PASS) would preserve precision. The v1 natural-val
ratio (10 FAIL / 150 PASS = 6.25% FAIL) correctly reflects production; use that as the
target training prior, not the 50/50 oversampled ratio used in build-leak-v2-train.ts.

**Problem 2: Training prose cadence mismatch.**
The aborted v2 generated 245 positive examples via DeepSeek-as-synthesizer. DeepSeek's
cadence for "write 80–120 words of fantasy prose that includes token X" is detectably
different from the Salvatore LoRA's output. The adapter learned to flag
DeepSeek-synthesis cadence, not Salvatore-LoRA cadence, which is the actual production
leak source. Two alternatives:

- (a) **Active-learning harvest from production**: pull actual beat prose from
  `llm_calls` rows where the halluc-ungrounded adapter fired on a Salvatore-corpus token
  (Waterdeep, Baldur's Gate, etc.) that the leak adapter did NOT fire on. These are
  ground-truth FAIL cases in authentic LoRA cadence. From the 7-novel panel, expAudit
  #254 found at least 7 such tokens; the full panel likely has 15–25 unique instances.
  Labeling cost: near-zero (these are already confirmed leaks by human adjudication or
  ungrounded checker + Sonnet review).

- (b) **Use the Salvatore LoRA to generate positive examples**: prompt the writer LoRA
  (`wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4`) with a beat brief
  that names Waterdeep / Baldur's Gate / etc. in the world_bible and observe whether the
  token bleeds into the output. If yes, those outputs are authentic positive training
  examples. This is more expensive ($0.05–0.10 per beat via W&B Inference) but produces
  distribution-matched prose.

**Problem 3: The negative pool.**
V1's negative pool was subsampled PASS variants from the synth pool — beats about
generic fantasy contexts. The adapter needs to see convincing near-misses: prose that
contains words phonetically similar to Salvatore tokens (e.g. "Mithral City" as a
generic fantasy place vs "Mithril Hall"), and beats that mention generic place categories
("the dwarven hall," "the northern city") without the specific corpus token. These hard
negatives prevent style generalization. Source: injection-pools.json's placeNames /
characterNames are good proxies; `scripts/hallucination/smoke-eval.ts` exists and can
be extended to generate hard-negative examples.

### What to hold stable

- The system prompt schema (prose-only input + `{"has_leak": bool, "leaks": [...]}` output)
  is correct. Do not change it.
- OR-gating with halluc-ungrounded is correct. Do not change it.
- The `writerPack.label === "salvatore-fantasy"` gate in `beat-checks.ts` is correct.

### Scripts to write/modify

| Script | Action |
|---|---|
| `scripts/hallucination/measure-regex-ceiling.ts` | NEW — runs regex match against natural-val and production panel; reports precision/recall vs v1 adapter; must be run before any training decision |
| `scripts/hallucination/expand-leak-vocab.ts` | MODIFY — add Waterdeep, Baldur's Gate, Drossen Ironbelly, Chionthar, Harpells, Neverwinter (if user confirms scope); remove from LEAK_TOKENS any tokens user decides are out-of-scope |
| `scripts/hallucination/build-natural-leak-val.ts` | MODIFY — sync LEAK_TERMS with expanded LEAK_TOKENS list; current lists are out of sync (val has ~57, train has 49) |
| `scripts/hallucination/harvest-production-leaks.ts` | NEW (if rung 2b selected) — queries `llm_calls` WHERE ungrounded fired on a known corpus token AND leak adapter did NOT fire; outputs labeled FAIL pairs in leak-adapter schema |
| `scripts/hallucination/build-leak-v3-train.ts` | NEW (if rung 2 confirmed) — correct-ratio construction (1:10 FAIL:PASS), no oversample, production-cadence positive examples |

---

## 3. Eval plan

### Primary eval set: natural-val (reuse)

`finetune-data/halluc-leak-salvatore-natural-val.jsonl` is built from the v1 natural
val (`halluc-checker-v1-val.jsonl`) by scanning for §A tokens in prose. It must be
**rebuilt** after the token list expansion (rungs 0–1) so Waterdeep / Baldur's Gate
occurrences in that val set are correctly labeled as positives rather than left as
mislabeled negatives. This is a pre-condition for any meaningful eval.

After rebuilding, the natural-val set is expected to gain 3–8 new FAIL examples
(conservative estimate, based on 10 FAIL / 160 total at v1, and the new tokens being
less frequent in held-out beats than Drizzt/Bruenor). The positive count is small; do
not oversample the natural val — keep it at production distribution for the precision
measurement.

### Supplementary eval set: targeted miss set

A **held-out miss set** for the specific tokens missed in exp #254. This is separate
from the natural-val set and is designed to measure recall on the gap tokens:

- Target tokens: Waterdeep, Baldur's Gate, Ten-Towns (partial recall), Luskan (partial),
  Do'Urden (partial), Maer Dualdon (partial), Drossen Ironbelly.
- Construction: 3–5 prose snippets per token (can use DeepSeek as generator at this
  point — these are calibration examples in a targeted eval, not training data, so cadence
  mismatch is acceptable).
- Size: ~30 FAIL examples + 30 PASS negatives = 60 pairs.
- This eval set is held out from training. It answers "did we fix the specific gap?"
  independently of the broader natural-val.

### Metrics and floors

| Metric | Target | Source | Prior v1 |
|---|---|---|---|
| Natural-val precision | ≥85% | Per charter convention (EXAMPLE-leak-v2-retroactive §7) | 80% |
| Natural-val recall | ≥65% | Δ from v1's 40%, aiming for 25-pt improvement | 40% |
| Natural-val F1 | ≥73% (derived: 2×85×65/(85+65)) | Derived | 53.3% |
| Targeted miss set recall (gap tokens) | ≥75% | New; this is the primary gap-closure signal | ~10–25% estimated |
| Production fire rate (7-novel panel equivalent) | 18–25% | v1 was 15.7%; new tokens add coverage so rate should rise | 15.7% |
| False-positive rate on clean beats | ≤5% | Standard; measured by running adapter on 50 beats with no known leaks | Unknown at v1 |

The 15.7% production fire rate at v1 is anomalously low given that the 7-novel panel
showed 7 distinct corpus-leak tokens in ungrounded fires that the leak adapter missed.
A functional v2 should see production fire rate climb toward 20–30% because it now
catches the tokens it was missing — a higher fire rate is expected and correct.

---

## 4. Decision gates

These are the concrete thresholds controlling whether v2 ships over v1:

**Gate 0 (pre-training decision gate):** Run the regex ceiling measurement
(`scripts/hallucination/measure-regex-ceiling.ts`). If regex alone achieves
natural-val precision ≥85% AND recall ≥65%, **do not train**. Instead:
- Widen the token list in `build-natural-leak-val.ts` and `format-v3-two-adapters.ts`
- OR-combine regex output with v1 adapter at inference time in `src/phases/beat-checks.ts`
- This is the $0 solution. If it hits the targets, the SFT is unnecessary.

**Gate 1 (SHIP):** Natural-val precision ≥85% AND recall ≥65% AND targeted-miss-set
recall ≥75%. Production fire rate rises to 18–25% range. No precision regression on
high-frequency tokens (Drizzt, Bruenor must still be flagged at ≥90% precision).

**Gate 2 (ITERATE):** Natural-val recall improves by ≥15 pts over v1 (i.e., ≥55%)
but precision <85%, AND F1 does not regress vs v1's 53.3%. One retrain pass allowed
with harder negatives. Requires a new charter; do not re-iterate without adversary review.

**Gate 3 (KILL):** Precision drops more than 10 pts below v1's 80% (i.e., falls below
70%) while recall gain is <15 pts. This repeats the v2 mechanism failure. Abandon SFT
entirely; use the regex OR-combination approach permanently. Record in decisions.md.

**Gate 4 (TOKEN SCOPE KILL):** If the regex ceiling measurement shows that Waterdeep /
Baldur's Gate / Drossen Ironbelly are achievable via regex at ≥90% precision, do NOT
include them in the SFT training data as positive examples. Instead, put them in the
regex layer and reserve SFT slots for tokens where context-awareness matters (e.g. "drow"
used as a proper noun vs a generic term, or "Do'Urden" suffix in a plausibly-constructed
surname). SFT and regex should cover different parts of the vocabulary, not redundant
parts.

**Minimum panel for a SHIP verdict:** 1 clean 3-chapter fantasy novel post-v2 deployment
where the leak adapter fires on at least 2 previously-missed token types (Waterdeep or
Baldur's Gate) without triggering chapter-plan exhaustions or adherence regressions.
Per `feedback_pilot_checkers_in_production.md`: synthetic eval FP rates are a lower
bound; always validate checker changes with a real production run before declaring a win.

---

## 5. Estimated cost

| Phase | Item | Estimated cost |
|---|---|---|
| Rung 0 (required) | Regex ceiling measurement on existing data | $0 (DB queries + local script) |
| Rung 1 (required) | Token list expansion + natural-val rebuild | $0 (script edits + re-run) |
| Rung 2 (conditional) | Active-learning harvest from production | $0 (DB queries + existing label adjudication) |
| Rung 2b (optional) | Salvatore LoRA positive generation (30 beats × $0.05/1M ≈ negligible) | <$0.01 via W&B Inference |
| Training (if rung 2 confirmed) | W&B SFT on Qwen3-14B-Instruct, ~600–800 pairs, ART framework | ~$1–4 per run (per lessons-learned.md; CLAUDE.md cites ~$3.76/month across 4+ adapters) |
| Eval labeling (if SFT runs) | Sonnet subagent adjudication of 20–30 natural-val fires | ~$0.20–0.50 (10 samples × 4 parallel subagents × ~$0.01 each) |
| Targeted miss set generation | DeepSeek, 60 pairs | ~$0.01 |
| Production pilot | 3-chapter fantasy novel | ~$0.40 (typical production run cost) |
| **Total if rung 0 succeeds (no SFT)** | | **~$0.50** |
| **Total if SFT is needed** | | **~$2–6** |

Note: the W&B artifact for a r=16 adapter is ~134 MB. W&B free tier is 5 GB; cleanup
script (`scripts/finetune/cleanup-wandb-storage.py --delete`) should be run after eval
to reclaim storage from intermediate training artifacts.

---

## 6. Open questions for user

1. **Scope of the §A token list: Icewind Dale trilogy only, or wider Salvatore bibliography?**
   The current list covers the Icewind Dale Trilogy + Crystal Shard era (1987–1992). The
   Salvatore LoRA was trained on that corpus specifically. However, "Waterdeep" and
   "Baldur's Gate" appear in that corpus only as referenced locales (not primary settings);
   "Neverwinter," "Menzoberranzan," and "Gauntlgrym" are more prominent in later books the
   LoRA may not have been trained on. Should the token list expand beyond the training
   corpus (on the theory that any Forgotten Realms proper noun is a leak signal) or stay
   restricted to tokens that actually appear in the LoRA training data? The answer changes
   the false-positive risk profile: tokens from books outside the training corpus may appear
   coincidentally in non-Salvatore prose with the same spelling.

2. **Is the regex OR-combination approach acceptable for production, or do we want a
   single adapter?**
   Rung 0 may show that Waterdeep / Baldur's Gate can be caught reliably by a $0 regex
   match. OR-combining that regex with v1's adapter output at inference requires a one-line
   change in `src/phases/beat-checks.ts`. This is the cheapest path, but it means
   maintaining two mechanisms. If you prefer a single adapter that handles both substring
   and context-aware detection, we proceed to SFT even if regex would suffice. Both are
   valid choices; the answer shapes the experiment.

3. **How many new positive examples per gap token is acceptable?**
   The aborted v2 used 5 examples per token × 49 tokens = 245 synthetics. The retroactive
   charter's §6 analysis showed that 245 synthetics in a single cadence destabilized
   calibration. If we use production-harvested examples instead (real LoRA output, 3–8
   examples per token maximum, with the correct 1:10 FAIL:PASS ratio), how many total FAIL
   examples is the right target? The tension is: too few (< 5 per token) and the model
   doesn't learn the token; too many (> 20 per token with oversampling) and calibration
   shifts toward FAIL. Suggest a floor of 3 confirmed-TP production harvests per gap token
   before submitting a new training run, but this requires your sign-off because it limits
   how quickly we can run v2 (we need production novels that leak the specific tokens first).

4. **Should `halluc-leak-salvatore-v2` also be used for non-fantasy seeds if the scope
   expands to include Forgotten Realms place names that could appear in any genre?**
   Currently the leak adapter is gated to `writerPack.label === "salvatore-fantasy"`. Tokens
   like "Waterdeep" or "Baldur's Gate" are Forgotten Realms names that a reader of any
   genre would recognize as corpus leaks. Should the gate remain Salvatore-route-only, or
   should it fire on all routes once the token list is widened to include broadly-recognizable
   FR place names? The conservative answer is to keep the Salvatore-route gate and document
   that non-Salvatore routes are unprotected from this class of leak — the adapter was
   trained on Salvatore-LoRA output cadence. Widening the gate to all routes risks
   false-positives on generic fantasy seeds that happen to invent place names similar to FR.

---

## Notes for charter author

Per `docs/charters/EXAMPLE-leak-v2-retroactive.md` §10 (adversary lessons):

- The §11.2 violation (regex not measured before SFT) was the primary kill-shot in the
  retroactive review. **The charter for v2 must document the regex ceiling measurement
  result in §5 before it can pass adversary review.** This scoping doc notes it as a
  required pre-step; the charter must cite the actual measured numbers, not projections.
- The previous adversary verdict on the EXAMPLE charter was RED for reasons that are now
  documented. A new charter starting from rungs 0–1 and only proceeding to SFT if the
  cheaper options fail should be reviewable as GREEN.
- The `experiment-adversary` prompt is at `docs/experiment-adversary-prompt.md`. Codex
  (GPT-5.4 high) is the primary reviewer; Opus is fallback only per charter template §10.
- If both rungs 0 and 1 are measured and documented, the charter §5 "Cheapest
  counterfactuals considered" section writes itself from this scoping doc.
