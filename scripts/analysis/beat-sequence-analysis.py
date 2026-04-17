#!/usr/bin/env python3
"""Beat-type sequence analysis on a decomposed novel corpus.

Extracts structural signatures from the beat-type sequence:
  - Transition matrix: P(next_kind | current_kind)
  - Per-chapter beat-type distributions
  - Sequence pattern frequencies (sliding windows)
  - Pacing statistics (chapter-level kind ratios, beat density)

Input: a training-pairs JSONL (from the decomposition pipeline) with
  brief.kind, brief.beat_idx, brief.chapter, brief.book, brief.scene_id

Usage:
  python3 scripts/analysis/beat-sequence-analysis.py \
    --input scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl
"""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path)
    args = ap.parse_args()

    pairs = [json.loads(l) for l in args.input.open() if l.strip()]
    pairs.sort(key=lambda p: (p["brief"]["book"], p["brief"]["chapter"], p["brief"].get("scene_id", ""), p["brief"].get("beat_idx", 0)))

    # ── 1. Global beat-kind distribution ────────────────────────────────
    kinds = [p["brief"]["kind"] for p in pairs]
    kind_counts = Counter(kinds)
    total = len(kinds)
    print("=== Global beat-kind distribution ===")
    for k, n in kind_counts.most_common():
        print(f"  {k:15s}  {n:4d}  ({n/total*100:.1f}%)")
    print(f"  {'TOTAL':15s}  {total:4d}")

    # ── 2. Transition matrix P(next | current) ────────────────────────
    # Group beats into chapter-ordered sequences
    chapters = defaultdict(list)
    for p in pairs:
        key = (p["brief"]["book"], p["brief"]["chapter"])
        chapters[key].append(p["brief"]["kind"])

    transitions = Counter()
    for ch_beats in chapters.values():
        for i in range(len(ch_beats) - 1):
            transitions[(ch_beats[i], ch_beats[i + 1])] += 1

    kind_list = sorted(kind_counts.keys())
    print("\n=== Transition matrix P(next | current) ===")
    # Header
    header = f"{'from \\ to':>15s}"
    for k in kind_list:
        header += f"  {k[:8]:>8s}"
    header += "     N"
    print(header)
    print("  " + "-" * (len(header) - 2))

    for from_k in kind_list:
        row_total = sum(transitions[(from_k, to_k)] for to_k in kind_list)
        if row_total == 0:
            continue
        row = f"  {from_k:>13s}"
        for to_k in kind_list:
            n = transitions[(from_k, to_k)]
            pct = n / row_total * 100 if row_total else 0
            row += f"  {pct:7.1f}%"
        row += f"  {row_total:4d}"
        print(row)

    # ── 3. Boundary signal distribution ─────────────────────────────────
    boundaries = Counter(p["brief"].get("boundary_signal", "?") for p in pairs)
    print("\n=== Boundary signal distribution ===")
    for b, n in boundaries.most_common():
        print(f"  {b:25s}  {n:4d}  ({n/total*100:.1f}%)")

    # ── 4. Per-chapter beat-type distribution ──────────────────────────
    print(f"\n=== Per-chapter beat-type ratios (n={len(chapters)} chapters) ===")
    ch_ratios = []
    for (book, ch_num), ch_beats in sorted(chapters.items()):
        ch_counter = Counter(ch_beats)
        ch_total = len(ch_beats)
        ratios = {k: ch_counter.get(k, 0) / ch_total for k in kind_list}
        ch_ratios.append(ratios)

    # Aggregate mean/std
    print(f"  {'kind':>15s}  {'mean':>7s}  {'std':>7s}  {'min':>7s}  {'max':>7s}")
    for k in kind_list:
        vals = [r[k] for r in ch_ratios]
        mean = sum(vals) / len(vals)
        std = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5
        mn = min(vals)
        mx = max(vals)
        print(f"  {k:>15s}  {mean:6.1%}  {std:6.1%}  {mn:6.1%}  {mx:6.1%}")

    # ── 5. Sequence patterns (3-gram sliding window) ───────────────────
    trigrams = Counter()
    for ch_beats in chapters.values():
        for i in range(len(ch_beats) - 2):
            trigram = (ch_beats[i], ch_beats[i + 1], ch_beats[i + 2])
            trigrams[trigram] += 1

    print(f"\n=== Top 15 beat-type trigrams ===")
    for tri, n in trigrams.most_common(15):
        arrow = " → ".join(tri)
        print(f"  {arrow:45s}  {n:3d}")

    # ── 6. Chapter-opening and chapter-closing patterns ────────────────
    openers = Counter()
    closers = Counter()
    for ch_beats in chapters.values():
        if ch_beats:
            openers[ch_beats[0]] += 1
            closers[ch_beats[-1]] += 1

    print(f"\n=== Chapter openers (first beat kind) ===")
    for k, n in openers.most_common():
        print(f"  {k:15s}  {n:3d}  ({n/len(chapters)*100:.1f}%)")

    print(f"\n=== Chapter closers (last beat kind) ===")
    for k, n in closers.most_common():
        print(f"  {k:15s}  {n:3d}  ({n/len(chapters)*100:.1f}%)")

    # ── 7. Beat density per chapter ───────────────────────────────────
    ch_lengths = [len(beats) for beats in chapters.values()]
    print(f"\n=== Beats per chapter ===")
    print(f"  mean: {sum(ch_lengths)/len(ch_lengths):.1f}")
    print(f"  std:  {(sum((l - sum(ch_lengths)/len(ch_lengths))**2 for l in ch_lengths) / len(ch_lengths))**0.5:.1f}")
    print(f"  min:  {min(ch_lengths)}")
    print(f"  max:  {max(ch_lengths)}")

    # Distribution
    print(f"\n  {'beats':>5s}  {'chapters':>8s}")
    for n_beats in sorted(set(ch_lengths)):
        count = ch_lengths.count(n_beats)
        print(f"  {n_beats:>5d}  {count:>8d}  {'█' * count}")

    # ── 8. Scene structure ─────────────────────────────────────────────
    scenes = defaultdict(list)
    for p in pairs:
        scenes[p["brief"].get("scene_id", "?")].append(p["brief"]["kind"])

    scene_lengths = [len(beats) for beats in scenes.values()]
    print(f"\n=== Beats per scene (n={len(scenes)} scenes) ===")
    print(f"  mean: {sum(scene_lengths)/len(scene_lengths):.1f}")
    print(f"  std:  {(sum((l - sum(scene_lengths)/len(scene_lengths))**2 for l in scene_lengths) / len(scene_lengths))**0.5:.1f}")
    print(f"  min:  {min(scene_lengths)}")
    print(f"  max:  {max(scene_lengths)}")

    # ── 9. Word count distribution by kind ────────────────────────────
    print(f"\n=== Word count by beat kind ===")
    wc_by_kind = defaultdict(list)
    for p in pairs:
        wc = len(p["prose"].split())
        wc_by_kind[p["brief"]["kind"]].append(wc)

    print(f"  {'kind':>15s}  {'mean':>6s}  {'std':>6s}  {'min':>5s}  {'max':>5s}  {'median':>6s}")
    for k in kind_list:
        vals = sorted(wc_by_kind[k])
        if not vals:
            continue
        mean = sum(vals) / len(vals)
        std = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5
        median = vals[len(vals) // 2]
        print(f"  {k:>15s}  {mean:6.0f}  {std:6.0f}  {min(vals):5d}  {max(vals):5d}  {median:6d}")

    print("\n=== Analysis complete ===")


if __name__ == "__main__":
    main()
