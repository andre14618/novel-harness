#!/usr/bin/env python3
"""POV rotation analyzer — deterministic (uses briefs' pov field).

Per chapter: POV character and rotation cadence. Identifies which
chapters belong to which POV character.

Output: novels/<key>/analysis/pov-rotation.json
"""
import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from base import load_pairs, write_analysis


def analyze(pairs: list[dict]) -> dict:
    if not pairs:
        return {"error": "no pairs (run brief extraction first)"}

    # Chapter-level POV: the POV that dominates a chapter's beats
    by_chapter: dict[tuple, list[str]] = defaultdict(list)
    for p in pairs:
        brief = p.get("brief", {}) or {}
        key = (brief.get("book"), brief.get("chapter"))
        pov = brief.get("pov") or "omniscient"
        by_chapter[key].append(pov)

    chapter_pov = {}
    for key, povs in by_chapter.items():
        c = Counter(povs)
        dominant, dom_count = c.most_common(1)[0]
        chapter_pov[f"{key[0]}_ch{key[1]}"] = {
            "book": key[0],
            "chapter": key[1],
            "dominant_pov": dominant,
            "dominance_fraction": round(dom_count / len(povs), 3),
            "beat_count": len(povs),
            "pov_distribution": dict(c.most_common()),
        }

    # Rotation pattern (ordered by book/chapter)
    ordered = sorted(chapter_pov.values(),
                     key=lambda x: (x["book"] or "", isinstance(x["chapter"], str), x["chapter"]))
    pov_sequence = [c["dominant_pov"] for c in ordered]

    # Rotation rate: fraction of chapter-to-chapter transitions where POV changes
    rotations = sum(1 for i in range(1, len(pov_sequence))
                    if pov_sequence[i] != pov_sequence[i-1])
    rotation_rate = rotations / max(1, len(pov_sequence) - 1)

    # Per-character chapter count
    per_char = Counter(pov_sequence)

    return {
        "total_chapters": len(chapter_pov),
        "pov_sequence": pov_sequence,
        "rotation_rate": round(rotation_rate, 3),
        "chapters_per_pov_character": dict(per_char.most_common()),
        "chapter_pov_detail": chapter_pov,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--novel", required=True)
    args = ap.parse_args()
    sig = analyze(load_pairs(args.novel))
    out = write_analysis(args.novel, "pov-rotation", sig)
    print(f"Output: {out}")
    if "error" in sig: print(f"\n{sig['error']}")
    else:
        print(f"\nTotal chapters: {sig['total_chapters']}")
        print(f"Rotation rate: {sig['rotation_rate']:.1%}")
        print(f"\nChapters per POV character:")
        for c, n in sig["chapters_per_pov_character"].items():
            print(f"  {c}: {n}")


if __name__ == "__main__":
    main()
