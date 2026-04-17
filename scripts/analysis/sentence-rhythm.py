#!/usr/bin/env python3
"""Sentence rhythm analyzer — deterministic.

Per-beat sentence length distribution, grouped by kind.

Output: novels/<key>/analysis/sentence-rhythm.json
"""
import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from base import load_beats, write_analysis

SENTENCE_RE = re.compile(r'[^.!?]+[.!?]+(?:[\'"]\s*)?')


def sentence_lengths(text: str) -> list[int]:
    sentences = SENTENCE_RE.findall(text)
    return [len(s.split()) for s in sentences if s.strip()]


def stats(xs: list[int]) -> dict:
    xs = sorted(xs)
    if not xs: return {}
    n = len(xs)
    return {
        "count": n,
        "mean": round(sum(xs) / n, 1),
        "median": xs[n // 2],
        "min": xs[0],
        "max": xs[-1],
        "p10": xs[max(0, n // 10)],
        "p25": xs[n // 4],
        "p75": xs[3 * n // 4],
        "p90": xs[min(n - 1, 9 * n // 10)],
    }


def analyze(beats: list[dict]) -> dict:
    by_kind: dict[str, list[int]] = defaultdict(list)
    all_sentences: list[int] = []

    for b in beats:
        lengths = sentence_lengths(b.get("text", ""))
        by_kind[b.get("kind", "?")].extend(lengths)
        all_sentences.extend(lengths)

    return {
        "overall": stats(all_sentences),
        "by_kind": {k: stats(v) for k, v in by_kind.items()},
        "total_beats_analyzed": len(beats),
        "total_sentences": len(all_sentences),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--novel", required=True)
    args = ap.parse_args()
    sig = analyze(load_beats(args.novel))
    out = write_analysis(args.novel, "sentence-rhythm", sig)
    print(f"Output: {out}")
    print(f"\nOverall: {sig['overall']}")
    print(f"\nBy kind:")
    for k, v in sig["by_kind"].items():
        print(f"  {k}: median={v.get('median')}w, mean={v.get('mean')}w, p10/p90={v.get('p10')}/{v.get('p90')}")


if __name__ == "__main__":
    main()
