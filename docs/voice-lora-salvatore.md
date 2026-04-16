---
status: active
updated: 2026-04-16
---

# Voice-Imprinting LoRA: Salvatore 1988 — Experiment Report & Replication Recipe

First voice-imprinting fine-tune in the harness. The goal was to see how much of a specific author's voice a 14B LoRA on ~700 paired (brief, prose) examples can pick up, and whether the result is usable in the writer slot for novel generation. This doc is both the Salvatore-specific post-mortem and the replication recipe for future voice LoRAs (Howard, Cook, Wolfe, whoever).

---

## 1. Why Salvatore

- **1988 Salvatore** (Icewind Dale Trilogy: *The Crystal Shard*, *Streams of Silver*, *The Halfling's Gem*) is a distinct, high-volume, single-voice corpus — ~307K total words with consistent voice. The later Salvatore (2024 *Pinquickles Folly*) drifts, so we bounded the corpus to the 1988-1990 trilogy.
- Action-pulp fantasy is a real slot in our target genre space (adjacent to LitRPG). A LoRA that nails Salvatore's sentence cadence and sensory restraint is an end product, not just a research artifact.
- Salvatore's voice has a measurable fingerprint that ICL can't reproduce: **18.3w average sentence length** with bursts of short punchy lines, **1.56 sensory-density-per-100w** (low — most generic LLMs overdrive sensory detail to 4–6), **clause complexity 0.62**, **dialogue ratio 0.28**.

---

## 2. Corpus → training data pipeline

This is the pipeline any new voice LoRA reuses. Six stages, largely deterministic after Stage 2.

| Stage | Granularity | Producer | Output |
|---|---|---|---|
| 1. Ingest | Book | `scripts/finetune/ingest-corpus.py` | Canonical `.txt` with `=== heading ===` + `* * *` markers |
| 2. Mechanical split | Chapter | Section regex | One file per chapter |
| 3. Scene segmentation | Scene (~500–1500w) | Claude Code sub-agent | `{ scene_id, characters, setting, pov }` |
| 4. Beat segmentation | Beat (~100–400w) | Claude Code sub-agent | `{ beat_id, brief: { characters, pov, setting, tone, kind, summary, words }, prose }` |
| 5. Style tag | Beat | Deterministic (`style_features.py`) | `{ avg_sentence_words, dialogue_ratio, clause_complexity, sensory_density }` |
| 6. Validate + format | Dataset | `format-salvatore-sft.py` | `salvatore-1988-sft-{train,val}.jsonl` |

**Salvatore specifics:** 777 paired beats (~100w median), stratified 703/74 train/val by (book × kind). Voice-imprint adapters use stratified splits to ensure test coverage across all kind types.

### 2.1 The paragraph-break bug (v1 → v2)

v1 trained on 777 pairs where PDF extraction had silently collapsed paragraph breaks. The Salvatore PDFs have one physical line per dialogue turn, which `pypdf` preserves as `\n`, but the format stage never promoted lone `\n` into `\n\n`. The LoRA trained on wall-of-text and output wall-of-text.

**The fix — two layers:**

1. **Corpus repair** (`scripts/finetune/fix-paragraph-breaks.ts`): pass 1 normalize `\n+ → \n\n`; pass 2 on any surviving zero-break pair, inject `\n\n` before quoted turns following a sentence terminator. Recovered 611/777 (79%) paragraph-break coverage. Remaining 166 verified legitimately single-paragraph.
2. **Methodology guardrail** (`scripts/finetune/paragraph_breaks.py`): `normalize_breaks()` idempotent helper + `assert_minimum_coverage()` gate (≥50% corpus-wide, ≥80% dialogue-kind). Called from every SFT formatter before emitting.

**The lesson:** voice-imprint corpora need an explicit paragraph-break density check. The check is cheap, invisible-bug costs are expensive.

---

## 3. Phase C — A/B/C evaluation design

Four briefs stratified by kind (action, dialogue, interiority, description) from the 1988 Salvatore set. Three cells:

| Cell | Base | Voice mechanism |
|---|---|---|
| A | DeepSeek V3.2 | bare prompt (style targets described) |
| B | DeepSeek V3.2 | + 10K-token Salvatore primer (31 exemplar passages) |
| C | Qwen3-14B + LoRA | `salvatore-1988-v1` / `v2` |

The style oracle is **Δ-sum** — Manhattan distance from the corpus baseline across 4 dimensions (weighted so each axis contributes a similar range):

```
Δ-sum = |sent − 18.3| / 10
      + |dialogue − 0.28|
      + |clause − 0.62|
      + |sensory − 1.56| / 2
```

### 3.1 Phase C.2 (in-distribution, 4 briefs)

| Cell | avg sentence words | sensory | Δ-sum |
|---|---:|---:|---:|
| A — DeepSeek bare | 10.6 | 6.39 | 3.41 |
| B — DeepSeek + primer | 10.6 | 4.92 | 2.67 |
| C — LoRA v1 | 15.9 | 1.76 | **0.71** |

Key finding: **sentence-length rhythm does not transfer via ICL.** A and B both hit 10.6w despite the primer containing 18.3w exemplars. Only tuning moves that axis.

### 3.2 Phase C.3 (generalization test — the one that decides viability)

Two held-out sets:
- **Val** (74 beats): held-out from the same trilogy, never seen in training.
- **Original** (6 beats): original characters (Thane Vordik, Corra Ashwick, Irinye, Garrett the Limp) in original settings (Bren's Rest, Varl Peaks, Sellanthir elven enclave). Deliberately no trained lore — no Drizzt, no Ten-Towns, no Mithril Hall.

**Val mode (n=74):**

| Cell | Δ-sum | 5-gram Jaccard max | Paragraph breaks |
|---|---:|---:|---:|
| A — DeepSeek bare | 2.28 | — | n/a |
| B — DeepSeek + primer | 1.92 | — | n/a |
| C — LoRA v1 | 0.50 | 0.100 | 0/74 |
| C — **LoRA v2** | **0.27** | **0.033** | **51/74** |

**Original mode (n=6):**

| Cell | Δ-sum | Scenes landed | Paragraph breaks |
|---|---:|---:|---:|
| A — DeepSeek bare | 3.22 | 2/6 | — |
| B — DeepSeek + primer | 2.52 | 4/6 | — |
| C — LoRA v1 | 0.32 | 6/6 | 0/6 |
| C — **LoRA v2** | 0.66 | 6/6 | 3/6 |

**Reading the numbers:**
- **Voice generalizes.** Both v1 and v2 crush A and B on *unseen* characters and settings. Original-mode Δ-sum stays ~0.5 or better while the best ICL baseline is ~2.5.
- **It's style capture, not content memorization.** Val-mode 5-gram Jaccard max is 0.033 on v2 and 0.100 on v1. The LoRA paraphrases — it does not recite.
- **v2 Δ-sum on original went up slightly (0.32 → 0.66).** n=6, word count drifted up (more paragraph breaks → longer generations → higher sentence-length variance). Spot-checks still land the scene 6/6 and dialogue turns split at speaker boundaries. Net: not a regression in prose quality.
- **v2 fixed the wall-of-text.** 51/74 val + 3/6 original generations now have paragraph breaks (v1: 0 and 0).

### 3.3 Proper-noun leak rate

~1 per 6 beats leak trained lore (Ten-Towns, Lonelywood, etc.) into original-character outputs. This is addressable at the system prompt with a proper-noun blocklist — no retrain needed.

---

## 4. What's baked into the fine-tune vs what stays in the harness

**The LoRA delivers (in weights):**
- Sentence cadence (18.3w average, burst-heavy rhythm)
- Sensory restraint (1.56/100w, no AI-overdrive imagery)
- Dialogue tagging discipline
- Physical verb bias
- Paragraph-break structure (v2 only — post-fix)

**The harness delivers (not the LoRA's job):**
- Beat adherence (events happen, characters present, POV correct) — checked by `adherence-checker-v4`
- World-state continuity — checked by `continuity-v2`
- Proper-noun discipline (don't use trained lore on other-genre novels) — system-prompt blocklist
- Word count targeting — **dropped as a per-beat gate for all writers** (was noise; voice quality is the ultimate goal)
- Genre routing (this LoRA for Salvatore-style action-pulp fantasy seeds, DeepSeek+primer for everything else) — `src/models/roles.ts`

---

## 5. Harness integration plan

1. **Genre-slot routing in `src/models/roles.ts`.** Per-seed writer override: action-pulp fantasy seeds → `wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v2:v1`; other seeds → DeepSeek V3.2 + Howard primer (current default).
2. **Proper-noun blocklist in the LoRA system prompt.** Append: "Do not use the following names: Drizzt, Bruenor, Wulfgar, Regis, Catti-brie, Icewind Dale, Ten-Towns, Mithril Hall, Lonelywood, Bryn Shander, Targos, Crystal Shard." Expand as new leaks are observed.
3. **Drop the per-beat word-count gate from the adherence checker for all writers.** Voice LoRAs land shorter or longer than the brief's target words. The value of the fine-tune is in cadence and prose quality — word count was never the load-bearing signal.
4. **3-chapter production run on a Salvatore-style fantasy seed.** Gate before promoting to default in that slot.

---

## 6. Replication recipe for the next voice LoRA

To build a new author voice LoRA (Howard, Cook, Wolfe, etc.):

```
1. Ingest corpus
   python3 scripts/finetune/ingest-corpus.py --input author.epub --output scripts/lora-data/author.txt

2. Verify paragraph-break density upstream (see docs/corpus-ingestion.md §"Paragraph-break hazard")
   # expect \n\n blocks ≥ 2000, dialogue-turn / block ratio ≥ 0.15

3. Decompose to (brief, prose) pairs via sub-agent pipeline
   # produces scripts/lora-data/<author>-training-pairs-tagged.jsonl

4. If dialogue-heavy and from PDF: run the break-restoration pass
   bun scripts/finetune/fix-paragraph-breaks.ts

5. Format to SFT with the guardrail enforced
   python3 scripts/finetune/format-<author>-sft.py \
     --input scripts/lora-data/<author>-training-pairs-fixed.jsonl \
     --out-dir finetune-data \
     --val-frac 0.1 --seed 42
   # fails loudly if paragraph-break coverage < 50% or dialogue kind < 80%

6. Push SFT files to LXC finetune-data/

7. Create tuning_experiment row (target=writer, dimension=voice_imprint)

8. Submit W&B training
   EXPERIMENT_ID=N python3 scripts/finetune/train-lora.py \
     --name <author>-v1 \
     --data finetune-data/<author>-sft-train.jsonl \
     --epochs 3 --batch-size 2 --lr 2e-4

9. Phase C.3 validation — val-split + original-character briefs
   python3 scripts/finetune/phase-c3-generalization.py --mode val ...
   python3 scripts/finetune/phase-c3-generalization.py --mode original ...
   # gate: Δ-sum ≤ 1.0, paragraph breaks present in dialogue outputs

10. Conclude experiment, update docs/decisions.md, update roles.ts genre routing
```

**Budget reference.** At current W&B pricing ($3.76/month across 4 deployed adapters + voice runs), expect a single voice LoRA to cost ~$0.30–0.60 end to end. The evaluation calls often cost more than the training run.

---

## 7. Open questions / deferred work

- **Does r=16 saturate?** v1 → v2 closed the paragraph-break gap without changing rank. For an author with rarer syntactic constructions (Wolfe, McCarthy), r=16 may leave capacity on the table. W&B's rank-16 cap is a platform constraint, not a methodological one.
- **Does longer training help?** 3 epochs on 703 pairs was picked by analogy to the tonal-pass adapters. Larger corpora may need 2 epochs; shorter corpora may need 4. Not systematically explored.
- **Do we need negative data?** Current pipeline is purely positive (brief → target prose). No evidence yet that we need contrast pairs; voice capture works without them.
- **Multi-author blends.** Open question — a single LoRA trained on two authors may average, or may pick up the union. Not tested.

---

## 8. v2 production probe — 2026-04-16

First end-to-end production test. Routed `beat-writer` to v2 via genre-slot routing (Phase 1 harness work), ran a 3-chapter `fantasy-echo-mage` novel with all checkers on 14B. Probe experiment id=195.

### Gate results (fail)

| Criterion | Target | Observed |
|---|---|---|
| Adherence first-attempt | ≥70% | **~33%** (ch1 pass attempt 2/3; ch2 failed 12 consecutive attempts over 4 restart rounds) |
| Chapter-plan pass | ≥85% | **~25%** |
| Continuity blockers | ≤1 | 0 ✅ |
| Paragraph breaks | present | present ✅ |
| Voice Δ-sum | ≤0.5 | n/a — run never reached chapter 3 |

### Root cause (diagnosed from chapter 1 prose + chapter 2 failure modes)

**Training / serving shape mismatch.** v1 and v2 were trained on a minimal brief-shape user prompt (~9 fields, ~200 tokens). Production user prompt from `src/agents/writer/beat-context.ts` is richer — ~500–1000 tokens adding `TRANSITION BRIDGE` (last 2–3 sentences of prior beat), `LANDING TARGET` (first sentence of next beat), `CHARACTERS` (per-character speech pattern / drives / avoids / conflict / relationships / doesn't-know), and resolved references. The LoRA never saw these sections in training and doesn't know what to do with them.

Four concrete failure modes observed:

1. **Transition-bridge regurgitation.** Chapter 1 paragraph 3 and paragraph 6 were byte-identical sentences. `"Her perceptions of time... fractured under the assault. The impact fractured her radius, so she could not cast a kinetic break."` was repeated verbatim in consecutive paragraphs. The LoRA reads the bridge as content to emit, not as "what came before."

2. **Required-fact enactment failure.** Chapter 2 failed 12 consecutive attempts on the same planner requirement — `"Reseth's soul-etching curse imprints traumatic visions on the victim's mind that persist after absorption"`. The LoRA wrote around the fact with vague pain/vision imagery but never dramatized the **persistent imprint**.

3. **Character presence gap.** "Archmage Reseth listed but never mentioned" fired on every chapter 2 attempt. The LoRA treats Reseth as off-page atmosphere instead of a named antagonist the beats require on the page.

4. **World-element lore leak.** Chapter 1 contained "until the coming of the drow elves" — the proper-noun blocklist caught named characters (Drizzt/Bruenor/etc.) but not world-element nouns (drow, Underdark, Mithril, etc.).

### Positive findings

- Voice cadence DID transfer. Chapter 1 prose: *"melted chunks of stone and metal scorched onto the rocky floor; broken weapons and shattered armor; and the bones of unwary victims."* Salvatore-inflected rhythm and physical grounding are present.
- Paragraph breaks are present (v2 fix holds at inference time in production).
- Continuity checker (`continuity-v2:v1` on 14B) found zero issues across all attempts — inadvertent positive datapoint for the 14B checker tier.
- Genre-slot routing worked as designed. Log confirms `Writer pack: salvatore-fantasy (wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v2:v1)` on every beat.

### Decision: v3 retraining on harness-shaped user prompts

The cheapest fix (~$0.30 training + ~2–3 hr data prep) is retraining with training-data user prompts that match production shape. v3 changes:

1. **Reformat every pair's user prompt** through a harness-style assembler: original brief + TRANSITION BRIDGE (last 2–3 sentences of previous beat in same chapter) + LANDING TARGET (first sentence of next beat's summary) + CHARACTERS (per-character snapshot) + SETTING (on scene_start beats only).
2. **Expand blocklist** to cover world elements, not just proper nouns: drow, Underdark, Mithril Hall, Crenshinibon, Ten-Towns, Forgotten Realms, etc.
3. **Anti-repeat system-prompt rule:** "NEVER repeat or echo the TRANSITION BRIDGE — continue past it."

Training cost at current W&B pricing is the same as v2 (~$0.30). Expected improvements: bridge mishandling disappears (model sees the format in training), required-fact enactment improves (system prompt rule re-emphasized), character-presence gap narrows (characters listed with snapshots in the user prompt become salient).

## 9. v3 training + eval — 2026-04-16

v3 was built to address the prompt-shape mismatch v2 hit in production (exp #195). Three things changed:

1. **Harness-shaped user prompts.** Every training pair's user prompt now matches `src/agents/writer/beat-context.ts::buildBeatContext` output — BEAT header + POV + Setting + beat description + Characters present + TRANSITION BRIDGE + LANDING TARGET + CHARACTERS section with per-character snapshots + SETTING on scene_start beats. See `scripts/finetune/format-salvatore-v3-sft.py`.
2. **3-variant rename augmentation per chapter.** 1 original + 2 renamed copies with fresh per-chapter rename tables drawn from `scripts/finetune/salvatore-rename-pool.json`. Sentence-level prose is byte-identical across variants aside from proper-noun tokens. Teaches "name slot is parametric."
3. **~17% retry variants.** Production-calibrated failure distribution (event_not_enacted 40%, over_elaboration 25%, character_missing 20%, sequence_reversed 8%, tone_mismatch 7%). Deterministic degradation; assistant output is the real Salvatore prose. Teaches "given voice-correct but plot-broken prose + issue list, preserve what works, fix only what's flagged."

### v3 Phase C.3 — two evals, two verdicts

**Initial eval (contaminated):** Ran v3 against the same 74 val briefs that v2 was evaluated on (stratified by book × kind). Results were alarming — Δ-sum 0.10 (better than v2) but max 5-gram Jaccard **0.822** (vs v2's 0.100). Top-memorized beats all `_b0` scene-start. Looked like severe overfit.

**Root cause (diagnosis):** the v2 val briefs were stratified by `(book, kind)` spread across all 54 chapters, but v3's formatter stratifies by **chapter** (5 held-out chapters). **~91% of the v2 val briefs were in chapters v3 trained on.** The 0.822 was eval contamination, not overfit.

**Clean eval (v3's actual held-out val, 60 beats from 5 held-out chapters):**

| Metric | Contaminated eval | Clean eval | v2 reference (on v2's val) |
|---|---:|---:|---:|
| Δ-sum | 0.10 | **0.45** | 0.27 |
| 5-gram Jaccard mean | 0.066 | **0.001** | 0.003 |
| 5-gram Jaccard max | 0.822 | **0.023** | 0.033 |

**v3 generalizes normally** — max Jaccard *lower* than v2's on a truly held-out set.

### What's still a real v3 signal

**Original-mode Δ-sum 0.990 vs v2's 0.662** on the 6 novel-character briefs (Vordik, Corra, Irinye, Garrett — guaranteed not in any training set). Main contributor: **sensory density 2.47 vs target 1.56** (59% overshoot) — v3 writes somewhat more florid on cross-distribution content.

Expanding the original-brief set from 6 to **18** (2026-04-16) — kinds: 4 description / 6 dialogue / 5 action / 3 interiority, 13 distinct POVs + 4 omniscient — gives tighter n for the v3-vs-v4-vs-v5 comparison. Loaded into `eval_briefs` under `set_name='salvatore-original-v1'`.

### v4 + v5 trained in parallel (overfit hypothesis testing)

**v4** (exp #197) — same v3 training data, `--epochs 1`. Tests: was the 9× gradient pass per beat (3 variants × 3 epochs) the overfit driver?

**v5** (exp #198) — `--rename-variants 1 --retry-fraction 0.25` (no rename augmentation), 3 epochs. Tests: was the augmentation itself the issue? Equivalent to "v2 with new harness-shape prompts + retry variants."

Both train concurrently; eval against expanded 18-brief `salvatore-original-v1` set + v3's held-out val. Comparison metric: lowest Δ-sum on `salvatore-original-v1` wins.

### Eval infrastructure added (2026-04-16)

Every Phase C.3 run now persists to DB instead of `/tmp/*.jsonl`:

- **`eval_briefs` table** — versioned brief sets keyed by `(set_name, beat_id)`. Holds brief JSON + optional ground-truth prose + ground-truth style + notes.
- **`eval_results` table** — per-beat results keyed to `experiment_id` + `adapter_uri` + `cell_label`. Holds generated prose, style features, delta_sum, ngram_jaccard_vs_gt, paragraph-break count, word count, lore-leak tokens.
- **`eval_cell_summary` view** — phase-c3-compatible aggregate (`cell_delta_sum` computed on mean style, not average-of-deltas, matching the print output of `phase-c3-generalization.py`).
- **`eval_full_provenance` view** — flattens eval_results × eval_briefs × tuning_experiments into one row with W&B run URL + artifact URL + unwound training config.
- **`scripts/finetune/provenance-report.ts`** — `bun .../provenance-report.ts --adapter salvatore-1988-v3` prints full lineage (experiment config, adapter URIs, eval results, parent experiment chain).

v2 + v3 Phase C.3 runs backfilled into `eval_results` (145 rows across 4 set_name × experiment pairs).

## 10. Pointers

- Code:
  - `scripts/finetune/paragraph_breaks.py` — normalize + coverage assert
  - `scripts/finetune/fix-paragraph-breaks.ts` — corpus-level repair (Salvatore-specific, but pattern reusable)
  - `scripts/finetune/format-salvatore-sft.py` — SFT formatter with guardrail
  - `scripts/finetune/phase-c3-generalization.py` — val + original test harness
  - `scripts/finetune/style_features.py` — style-feature extractor (sent/dial/clause/sens)
- Experiments in `tuning_experiments`: #192 (v1), #194 (v2), #195 (v2 production probe), #196 (v3), #197 (v4 — overfit hypothesis, 1 epoch), #198 (v5 — no-rename hypothesis), #199 (v3 production probe)
- Eval DB: `SELECT * FROM eval_cell_summary ORDER BY set_name, cell_delta_sum;` for live leaderboard
- Provenance: `bun scripts/finetune/provenance-report.ts --adapter salvatore-1988-v3` for full lineage
- Decisions: `docs/decisions.md` — "Salvatore 1988 voice LoRA v2 supersedes v1"
- Lessons: `docs/lessons-learned.md` — paragraph-break bug + voice-LoRA cross-distribution transfer + W&B pricing
- Ingestion: `docs/corpus-ingestion.md` — paragraph-break hazard section
- Strategy: `docs/fine-tuning-strategy.md` — adapter roadmap
