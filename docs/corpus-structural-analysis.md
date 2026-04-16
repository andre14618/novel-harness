# Corpus Structural Analysis — Icewind Dale Trilogy

**Date:** 2026-04-15
**Target:** 1988 Salvatore action-pulp rhythm (Path B)
**Source:** Crystal Shard + Streams of Silver + Halfling's Gem

## Scene inventory

| | Crystal Shard | Streams of Silver | Halfling's Gem | Total |
|---|---|---|---|---|
| Scenes | 128 | 68 | 127 | 323 |
| Bounded (both sides `* * *`) | 69 | 21 | 87 | 177 |
| Author-placed scene breaks | 105 | 47 | 108 | 260 |

**"Bounded" = both sides of the scene have a `* * *` marker.** These are the highest-confidence training data — we know exactly where the author placed the cuts.

## Scene size distribution

```
      0-  200w:  46 total ( 27 bounded)  ← transition snippets, skip
    200-  400w:  64 total ( 42 bounded)  ← 1-2 beats each
    400-  600w:  62 total ( 40 bounded)  ← 2-3 beats each ← SWEET SPOT
    600-  800w:  29 total ( 23 bounded)  ← 3-5 beats each ← SWEET SPOT
    800- 1000w:  28 total ( 12 bounded)  ← 4-6 beats each
   1000- 1500w:  46 total ( 18 bounded)  ← 5-8 beats each
   1500- 2000w:  13 total (  5 bounded)  ← long, include cautiously
   2000- 3000w:  19 total (  9 bounded)  ← long, pass 2
   3000+    w:  16 total (  1 bounded)  ← monolithic, pass 2
```

Bounded scene stats: min 32w, **median 515w**, p75 823w, p90 1340w, max 3658w, mean 667w.

## Scoping decisions

**Pass 1 corpus:** bounded scenes, 200–1500 words. **135 scenes**, estimated ~600–800 paired beats at ~150–200w target.

**Excluded from pass 1:**
- Scenes <200w (transition snippets, too short for meaningful beat structure)
- Scenes >1500w (long/monolithic, uncertain beat boundaries dilute training signal)
- Unbounded scenes (chapter-open / chapter-close — one side has no `* * *` anchor)

**Pass 2 (later):** unbounded scenes + long monolithic chapters, using beat-boundary signals calibrated from pass 1.

## Beat target (calibrated)

**~100–120 words per beat**, uniform. Calibrated from 10-scene sample (56 beats across 3 size strata):

| Stat | Value |
|---|---|
| Median | 105w |
| Mean | 103w |
| p10–p90 | 60w–148w |
| p25–p75 | 80w–126w |
| Min / Max | 37w / 168w |

```
    0- 50w:   2 ( 3.6%)   ← transition fragments
   50- 80w:  11 (19.6%)   ← short punchy beats
   80-120w:  25 (44.6%)   ← CORE CLUSTER
  120-160w:  15 (26.8%)   ← dialogue-heavy beats
  160-200w:   3 ( 5.4%)   ← rare long beats
  200+   w:   0 ( 0.0%)
```

Initial assumption was 150–200w based on rough chapter-level averages. Calibration showed Salvatore's natural beat is much shorter — one shift of attention, one exchange, one action sequence. The 80–120w core cluster holds nearly half of all beats.

**Beat kinds** (what the beat does):
- Dialogue: 39% — exchanges with tags + reaction
- Action: 25% — physical movement, combat, environmental
- Interiority: 20% — POV reflection, decision, emotion
- Description: 16% — setting, atmosphere, sensory

**Boundary signals** (what triggers a new beat):
- POV attention shift: 25%
- Action shift: 21%
- Scene start: 18%
- Narration↔dialogue transitions: 18% (11% narr→dial + 7% dial→narr)
- Stakes recalibration: 9%
- Speaker change: 7%
- Sensory channel change: 2%

## Expected yield (calibrated)

At ~105w average: 135 scenes × median 515w / 105w ≈ **~660 paired (beat brief, real prose) training examples** from pass 1 alone. Adding pass 2 later could bring total to ~1,400+.

660 is comfortably in range for voice-imprinting LoRA (r=16 on 14B). 200-500 high-quality pairs has been sufficient in published voice-SFT work; 660 gives margin.

## Beat segmentation calibration (complete)

10-scene sample (3 small 200–400w, 4 medium 400–800w, 3 large 800–1500w) segmented into 56 beats. Key findings:
1. Natural beat size ~105w median, NOT 150–200w — revised target accordingly
2. Dominant boundary signals: POV attention shift (25%) and action shift (21%)
3. Beat kinds cluster as dialogue-dominant (39%), consistent with Salvatore's exchange-heavy style
4. Per-scene averages remarkably stable: 81–121w/beat across all 10 scenes regardless of scene length

## Phase A complete — 777 paired training beats
*2026-04-16*

Full 6-stage pipeline executed end-to-end:

| Stage | Tool | Output |
|---|---|---|
| 1. Mechanical split | `scripts/finetune/decompose-corpus.py` | 323 raw scenes |
| 2. Scene label | `scripts/finetune/label-scenes.py` (Sonnet sub-agents) | Bounded scene metadata |
| 3. Beat segment | `scripts/finetune/segment-beats.py` (Sonnet sub-agents) | 777 beats from 135 bounded scenes |
| 4. Brief extract | `scripts/finetune/extract-briefs.py` (Sonnet sub-agents, 78 batches → merge) | Per-beat brief (characters, POV, setting, tone, kind, transition_in, boundary_signal, summary) |
| 5. Style tag | `scripts/finetune/tag-style.py` (deterministic) | Per-beat style features + aggregate baseline |
| 6. Round-trip validate | `scripts/finetune/validate-roundtrip.py` (Sonnet writers, 20 beats) | Confirms brief schema is sufficient |

**Final corpus stats:**
- 777 beats, 83,641 prose words
- Median 100w, mean 108w (matches calibrated target)
- Aggregate Salvatore baseline: avg sentence 18.3w · dialogue ratio 0.28 · clause complexity 0.62 · sensory density 1.56 hits/100w
- Train/val split: 703 / 74 (90/10 stratified by book × kind)
- Output: `scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl` (canonical), `finetune-data/salvatore-1988-sft-{train,val}.jsonl` (W&B messages format)

**Round-trip finding:** Sonnet reconstructions from briefs land in-spec on every dimension EXCEPT sentence rhythm (Sonnet ~12w avg vs Salvatore 18.3w). This is intentional — the brief deliberately omits rhythm so the LoRA learns it from the prose side of each pair.

## Phase B chunk-size A/B (complete)
*2026-04-16 · `scripts/finetune/phase-b-chunk-size.py`*

15 real Salvatore briefs (5 per kind) × 3 chunk sizes (80 / 120 / 160w) = 45 DeepSeek V3.2 generations, scored against the Salvatore aggregate baseline.

| size | n | avg words | avg sent | dial | clause | sens | Δ-sum |
|---|---|---|---|---|---|---|---|
| 80w  | 15 | 64.8  | 11.8 | 0.28 | 0.60 | 4.77 | 2.28 |
| 120w | 15 | 92.5  | 12.1 | 0.27 | 0.62 | 3.91 | **1.81** |
| 160w | 15 | 116.1 | 12.2 | 0.25 | 0.64 | 4.47 | 2.11 |

**Verdict:** 120w wins. Confirms calibrated beat target.

**Style gaps DeepSeek-vs-Salvatore (LoRA must close these):**
- Sentences: 11.8–12.2w (DeepSeek) vs 18.3w (Salvatore) — pull longer
- Sensory density: 3.91–4.77 hits/100w vs 1.56 — dial way back
- Dialogue ratio + clause complexity already track baseline at 120w

Result file: `scripts/lora-data/phase-b-chunk-size-results.jsonl`.

## Next: training (in progress)

Adapter `salvatore-1988-v1` submitted to W&B Serverless SFT (ART framework) on `OpenPipe/Qwen3-14B-Instruct`. Tracked as `tuning_experiment` id=192. See `docs/decisions.md` "Salvatore 1988 voice LoRA training kicked off" for run config and validation plan.
