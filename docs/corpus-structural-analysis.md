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

## Next: full Phase A batch decomposition

Segment all 135 bounded candidate scenes using the calibrated prompt (~100–120w target, boundary signals above). Output: `scripts/lora-data/salvatore-1988-beats.jsonl`.
