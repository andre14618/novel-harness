---
status: active
updated: 2026-04-16
derived-from: scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl (777 beats, Icewind Dale Trilogy)
---

# Salvatore 1988 — Structural Analysis

Beat-type sequencing, transition probabilities, chapter-opening/closing patterns, pacing statistics. Extracted from the decomposed Icewind Dale Trilogy training corpus (777 beats across 54 chapters, 140 scenes).

**Purpose:** this is the ground-truth structural signature of Salvatore-style action-pulp fantasy. The planner should target these distributions when generating chapter outlines for fantasy seeds. See `docs/archive/2026-04/beat-writer-architecture.md` §5.3 for the "real fiction uses ≤3 active characters per beat" constraint that complements this data.

**Script:** `scripts/analysis/beat-sequence-analysis.py`

---

=== Global beat-kind distribution ===
  action            323  (41.6%)
  dialogue          222  (28.6%)
  interiority       134  (17.2%)
  description        97  (12.5%)
  stakes_recalibration     1  (0.1%)
  TOTAL             777

=== Transition matrix P(next | current) ===
      from \ to    action  descript  dialogue  interior  stakes_r     N
  ---------------------------------------------------------------------
         action     55.6%      9.3%     20.5%     14.2%      0.3%   302
    description     34.0%     22.3%     21.3%     22.3%      0.0%    94
       dialogue     28.8%      4.8%     53.4%     13.0%      0.0%   208
    interiority     40.7%     12.7%     18.6%     28.0%      0.0%   118
  stakes_recalibration    100.0%      0.0%      0.0%      0.0%      0.0%     1

=== Boundary signal distribution ===
  pov_attention_shift         163  (21.0%)
  scene_start                 140  (18.0%)
  stakes_recalibration        140  (18.0%)
  action_shift                125  (16.1%)
  speaker_change               93  (12.0%)
  narration_to_dialogue        75  (9.7%)
  dialogue_to_narration        26  (3.3%)
  sensory_channel_change       14  (1.8%)
  description                   1  (0.1%)

=== Per-chapter beat-type ratios (n=54 chapters) ===
             kind     mean      std      min      max
           action   33.9%   21.9%    0.0%   88.9%
      description   13.6%   14.4%    0.0%   62.5%
         dialogue   30.7%   22.3%    0.0%   75.0%
      interiority   21.6%   19.5%    0.0%  100.0%
  stakes_recalibration    0.1%    0.6%    0.0%    4.8%

=== Top 15 beat-type trigrams ===
  action → action → action                        98
  dialogue → dialogue → dialogue                  59
  dialogue → action → action                      31
  dialogue → dialogue → action                    29
  action → dialogue → dialogue                    28
  action → interiority → action                   26
  action → action → interiority                   24
  interiority → action → action                   24
  action → dialogue → action                      21
  action → action → dialogue                      21
  action → description → action                   14
  action → action → description                   14
  dialogue → action → dialogue                    14
  dialogue → dialogue → interiority               11
  interiority → interiority → interiority         11

=== Chapter openers (first beat kind) ===
  description       23  (42.6%)
  action            14  (25.9%)
  interiority       10  (18.5%)
  dialogue           7  (13.0%)

=== Chapter closers (last beat kind) ===
  action            21  (38.9%)
  interiority       16  (29.6%)
  dialogue          14  (25.9%)
  description        3  (5.6%)

=== Beats per chapter ===
  mean: 14.4
  std:  10.9
  min:  2
  max:  71

  beats  chapters
      2         2  ██
      3         2  ██
      4         2  ██
      5         3  ███
      6         2  ██
      7         2  ██
      8         4  ████
      9         6  ██████
     10         4  ████
     13         1  █
     14         1  █
     15         4  ████
     16         2  ██
     17         4  ████
     19         1  █
     20         1  █
     21         5  █████
     24         1  █
     25         2  ██
     26         2  ██
     28         1  █
     36         1  █
     71         1  █

=== Beats per scene (n=140 scenes) ===
  mean: 5.5
  std:  2.6
  min:  1
  max:  15

=== Word count by beat kind ===
             kind    mean     std    min    max  median
           action     110      40     40    298     105
      description     114      41     40    217     109
         dialogue     102      40     22    280      95
      interiority     106      42     30    272      99
  stakes_recalibration      42       0     42     42      42

=== Analysis complete ===
