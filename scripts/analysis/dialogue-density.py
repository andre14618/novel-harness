#!/usr/bin/env python3
"""Dialogue density analyzer — deterministic.

Per beat, measures:
  - Quoted-words as fraction of total beat words
  - Quote count

Aggregates by beat-kind and per chapter, producing the ratios the
adherence checker + writer can use to set expectations.

Output: novels/<key>/analysis/dialogue-density.json
"""
import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from base import load_beats, write_analysis

QUOTE_RE = re.compile(r'"([^"]+)"')


def beat_dialogue_fraction(text: str) -> tuple[float, int]:
    if not text: return 0.0, 0
    quotes = QUOTE_RE.findall(text)
    quote_words = sum(len(q.split()) for q in quotes)
    total_words = len(text.split())
    return (quote_words / total_words if total_words else 0.0, len(quotes))


def analyze(beats: list[dict]) -> dict:
    by_kind: dict[str, list[float]] = defaultdict(list)
    by_chapter: dict[tuple, list[float]] = defaultdict(list)
    per_beat = []

    for b in beats:
        frac, q_count = beat_dialogue_fraction(b.get("text", ""))
        per_beat.append({
            "scene_id": b.get("scene_id"),
            "beat_idx": b.get("beat_idx"),
            "kind": b.get("kind"),
            "dialogue_fraction": round(frac, 3),
            "quote_count": q_count,
        })
        by_kind[b.get("kind", "?")].append(frac)
        by_chapter[(b.get("book"), b.get("chapter"))].append(frac)

    def mean(xs): return round(sum(xs) / len(xs), 3) if xs else 0.0

    by_kind_stats = {
        k: {
            "mean_fraction": mean(v),
            "beat_count": len(v),
            "n_beats_with_any_dialogue": sum(1 for x in v if x > 0),
        }
        for k, v in by_kind.items()
    }

    # Global stats
    all_fractions = [p["dialogue_fraction"] for p in per_beat]
    overall_mean = mean(all_fractions)

    # Chapter-level: top-10 highest + lowest dialogue density
    ch_means = [
        {"book": k[0], "chapter": k[1], "mean_dialogue_fraction": mean(v), "beat_count": len(v)}
        for k, v in by_chapter.items()
    ]
    ch_means.sort(key=lambda x: -x["mean_dialogue_fraction"])

    return {
        "overall_mean_dialogue_fraction": overall_mean,
        "by_kind": by_kind_stats,
        "top_10_dialogue_heavy_chapters": ch_means[:10],
        "top_10_dialogue_light_chapters": ch_means[-10:],
        "total_beats_analyzed": len(beats),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--novel", required=True)
    args = ap.parse_args()
    sig = analyze(load_beats(args.novel))
    out = write_analysis(args.novel, "dialogue-density", sig)
    print(f"Output: {out}")
    print(f"\nOverall mean dialogue fraction: {sig['overall_mean_dialogue_fraction']:.1%}")
    print(f"By kind:")
    for k, v in sig["by_kind"].items():
        print(f"  {k}: {v['mean_fraction']:.1%} ({v['beat_count']} beats)")


if __name__ == "__main__":
    main()
