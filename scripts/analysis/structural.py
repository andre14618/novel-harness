#!/usr/bin/env python3
"""Structural signature analyzer — deterministic, feeds planner priors.

Computes the same shape as SALVATORE_PRIORS in src/models/roles.ts:
  - Beat-kind distribution (action/dialogue/interiority/description %)
  - Cluster sustain rates (kind→kind self-transitions)
  - Chapter opener/closer kinds
  - Beats per scene + per chapter
  - Trigram transition patterns

Output: novels/<key>/analysis/structural-signature.json
"""
import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from base import load_beats, write_analysis


def analyze(beats: list[dict]) -> dict:
    if not beats:
        return {"error": "no beats"}

    # Group by scene
    by_scene: dict[str, list[dict]] = defaultdict(list)
    by_chapter: dict[tuple, list[dict]] = defaultdict(list)
    for b in beats:
        by_scene[b["scene_id"]].append(b)
        by_chapter[(b.get("book"), b.get("chapter"))].append(b)

    # Sort beats within scenes/chapters
    for seq in by_scene.values():
        seq.sort(key=lambda x: x.get("beat_idx", 0))
    for seq in by_chapter.values():
        seq.sort(key=lambda x: (x.get("scene_id", ""), x.get("beat_idx", 0)))

    # 1. Global beat-kind distribution
    kind_counts = Counter(b.get("kind", "?") for b in beats)
    total = sum(kind_counts.values())
    kind_dist = {k: round(n / total, 4) for k, n in kind_counts.items()}

    # 2. Cluster sustain — kind→kind self-transition rates within scenes
    transitions = Counter()
    for scene_beats in by_scene.values():
        for i in range(len(scene_beats) - 1):
            a = scene_beats[i].get("kind", "?")
            b = scene_beats[i + 1].get("kind", "?")
            transitions[(a, b)] += 1

    sustain: dict[str, float] = {}
    for kind in kind_counts:
        total_out = sum(n for (a, _), n in transitions.items() if a == kind)
        same = transitions.get((kind, kind), 0)
        sustain[kind] = round(same / total_out, 3) if total_out else 0.0

    # 3. Chapter openers/closers
    openers = Counter(); closers = Counter()
    for ch_beats in by_chapter.values():
        if ch_beats:
            openers[ch_beats[0].get("kind", "?")] += 1
            closers[ch_beats[-1].get("kind", "?")] += 1
    opener_dist = {k: round(n / max(1, sum(openers.values())), 3) for k, n in openers.items()}
    closer_dist = {k: round(n / max(1, sum(closers.values())), 3) for k, n in closers.items()}

    # 4. Beats per scene / chapter
    beats_per_scene = [len(v) for v in by_scene.values()]
    beats_per_chapter = [len(v) for v in by_chapter.values()]

    def stats(xs):
        xs = sorted(xs)
        if not xs: return {}
        return {
            "mean": round(sum(xs) / len(xs), 1),
            "median": xs[len(xs) // 2],
            "min": xs[0],
            "max": xs[-1],
            "p10": xs[max(0, len(xs) // 10)],
            "p90": xs[min(len(xs) - 1, 9 * len(xs) // 10)],
        }

    # 5. Top trigrams
    trigrams = Counter()
    for scene_beats in by_scene.values():
        kinds = [b.get("kind", "?") for b in scene_beats]
        for i in range(len(kinds) - 2):
            trigrams[(kinds[i], kinds[i + 1], kinds[i + 2])] += 1
    top_trigrams = [{"pattern": " → ".join(t), "count": n}
                    for t, n in trigrams.most_common(20)]

    # 6. Per-book breakdown
    per_book: dict[str, dict] = {}
    for book in set(b.get("book") for b in beats):
        book_beats = [b for b in beats if b.get("book") == book]
        per_book[book or "unknown"] = {
            "beats": len(book_beats),
            "kind_distribution": {
                k: round(v / len(book_beats), 4)
                for k, v in Counter(b.get("kind", "?") for b in book_beats).items()
            },
        }

    return {
        "total_beats": total,
        "beat_kind_distribution": kind_dist,
        "cluster_sustain": sustain,
        "chapter_openers": opener_dist,
        "chapter_closers": closer_dist,
        "beats_per_scene": stats(beats_per_scene),
        "beats_per_chapter": stats(beats_per_chapter),
        "top_trigrams": top_trigrams,
        "per_book": per_book,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--novel", required=True)
    args = ap.parse_args()
    sig = analyze(load_beats(args.novel))
    out = write_analysis(args.novel, "structural-signature", sig)
    print(f"Output: {out}")
    print(f"\nBeat-kind distribution:")
    for k, v in sorted(sig["beat_kind_distribution"].items(), key=lambda x: -x[1]):
        print(f"  {k}: {v:.1%}")
    print(f"\nCluster sustain:")
    for k, v in sig["cluster_sustain"].items():
        print(f"  {k} → {k}: {v:.1%}")
    print(f"\nBeats per chapter: {sig['beats_per_chapter']}")
    print(f"Chapter openers (top): {sorted(sig['chapter_openers'].items(), key=lambda x: -x[1])[:3]}")
    print(f"Chapter closers (top): {sorted(sig['chapter_closers'].items(), key=lambda x: -x[1])[:3]}")


if __name__ == "__main__":
    main()
