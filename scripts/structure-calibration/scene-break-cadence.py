#!/usr/bin/env python3
"""Pattern 51 — Scene-break density + within-chapter scene cadence.

Pure compute on scenes.jsonl. Groups scenes by (book, chapter), counts scenes
per chapter, and asks whether the per-chapter scene-count distribution is
stable enough across the trilogy to drive a planner prior (e.g. an explicit
`sceneCount` field on the chapter outline).

Boundary inventory (3-book corpus, verified upstream):
  bounded 185 / chapter-open 75 / chapter-close 75 / unbounded 17  (= 352)

Operationalization
------------------
* Each (book, chapter) group is a "chapter" for analysis.
* `scenes_per_chapter` = number of scene records in that group (always >= 1).
* A chapter is **single-scene** iff len(group) == 1; this corresponds 1:1 to
  the 17 `unbounded` records — the chapter is a single continuous unit with
  no internal white-space scene break.
* A chapter is **multi-scene** iff len(group) >= 2; the encoding is then
  always one chapter-open + 0..N bounded + one chapter-close.
* "part" markers in streams_of_silver (`part1`/`part2`/`part3`) are
  part-section dividers, not real story chapters; they are reported in the
  `all_groups` view but excluded from the headline `chapters_only` numbers.

Cross-book directional gate (brief):
  PASS         — modal scenes-per-chapter agrees in 3/3 books AND
                 single-scene-pct stable (<=15pt spread)
  PASS_PARTIAL — 2/3 books agree
  DIVERGE      — disagreement
  KILL         — no signal
"""
from __future__ import annotations

import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

CORPUS_DIR = Path("/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale")
SCENES_FILE = CORPUS_DIR / "scenes.jsonl"
OUT_DIR = CORPUS_DIR / "structure-calibration"
BOOKS = ["crystal_shard", "streams_of_silver", "halflings_gem"]
PART_MARKERS = {"part1", "part2", "part3"}


def stats(values: list[int]) -> dict:
    """Mean / median / p25 / p75 / min / max / mode summary."""
    if not values:
        return {"n": 0}
    sv = sorted(values)
    n = len(sv)
    p25 = sv[max(0, int(n * 0.25) - 1)] if n >= 4 else sv[0]
    p75 = sv[min(n - 1, int(n * 0.75))] if n >= 4 else sv[-1]
    mode_count = Counter(sv).most_common(1)[0]
    return {
        "n": n,
        "mean": round(sum(sv) / n, 3),
        "median": median(sv),
        "p25": p25,
        "p75": p75,
        "min": sv[0],
        "max": sv[-1],
        "mode": mode_count[0],
        "mode_freq": mode_count[1],
        "mode_share": round(mode_count[1] / n, 3),
    }


def histogram(values: list[int], lo: int = 1, hi: int = None) -> dict[int, int]:
    if hi is None:
        hi = max(values) if values else lo
    h = {k: 0 for k in range(lo, hi + 1)}
    for v in values:
        h[v] = h.get(v, 0) + 1
    return h


def load_scenes() -> list[dict]:
    rows = []
    with SCENES_FILE.open() as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main() -> int:
    scenes = load_scenes()

    # Verify boundary inventory upfront — the brief promises 185/75/75/17.
    bcount = Counter(s["boundary"] for s in scenes)
    expected = {"bounded": 185, "chapter-open": 75, "chapter-close": 75, "unbounded": 17}
    if dict(bcount) != expected:
        print(f"WARNING: boundary inventory drift. expected={expected} got={dict(bcount)}", file=sys.stderr)

    # Group by (book, chapter)
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for s in scenes:
        groups[(s["book"], str(s["chapter"]))].append(s)
    for k in groups:
        groups[k].sort(key=lambda s: s["scene_idx"])

    per_book: dict[str, dict] = {}

    for book in BOOKS:
        # all groups (includes part markers)
        all_groups = [items for (b, c), items in groups.items() if b == book]
        chapters_only_groups = [items for (b, c), items in groups.items()
                                if b == book and c not in PART_MARKERS]

        all_scene_counts = [len(g) for g in all_groups]
        ch_scene_counts = [len(g) for g in chapters_only_groups]
        ch_word_totals = [sum(s["words"] for s in g) for g in chapters_only_groups]
        ch_scene_words = [s["words"] for g in chapters_only_groups for s in g]

        single_scene = [c for c in ch_scene_counts if c == 1]
        multi_scene = [c for c in ch_scene_counts if c >= 2]

        # Among multi-scene chapters, count intermediate-scene boundary distribution
        intermediate_bounded = 0
        intermediate_unbounded = 0
        for g in chapters_only_groups:
            if len(g) <= 2:  # only chapter-open + chapter-close, no intermediate
                continue
            for s in g[1:-1]:
                if s["boundary"] == "bounded":
                    intermediate_bounded += 1
                elif s["boundary"] == "unbounded":
                    intermediate_unbounded += 1
        intermediate_total = intermediate_bounded + intermediate_unbounded
        bounded_share = (round(intermediate_bounded / intermediate_total, 4)
                         if intermediate_total else None)

        # Whether the chapter has any intermediate (bounded/unbounded) scene
        # is implicit in scene-count >= 3.

        per_book[book] = {
            "all_groups_count": len(all_groups),
            "chapters_only_count": len(chapters_only_groups),
            "scenes_per_chapter": stats(ch_scene_counts),
            "scenes_per_chapter_all_groups": stats(all_scene_counts),
            "histogram_scenes_per_chapter": histogram(ch_scene_counts, lo=1, hi=max(ch_scene_counts)),
            "single_scene_chapters": len(single_scene),
            "single_scene_pct": round(len(single_scene) / len(ch_scene_counts), 4),
            "multi_scene_chapters": len(multi_scene),
            "multi_scene_pct": round(len(multi_scene) / len(ch_scene_counts), 4),
            "chapter_word_totals": stats(ch_word_totals),
            "scene_word_distribution": stats(ch_scene_words),
            "intermediate_scene_count": intermediate_total,
            "intermediate_bounded": intermediate_bounded,
            "intermediate_unbounded": intermediate_unbounded,
            "bounded_share_of_intermediates": bounded_share,
        }

    # Aggregate stats across the corpus
    all_ch_groups = [items for (b, c), items in groups.items() if c not in PART_MARKERS]
    aggregate_scene_counts = [len(g) for g in all_ch_groups]
    aggregate_chapter_words = [sum(s["words"] for s in g) for g in all_ch_groups]
    aggregate_scene_words = [s["words"] for g in all_ch_groups for s in g]

    # Cross-book stability
    modes = [per_book[b]["scenes_per_chapter"]["mode"] for b in BOOKS]
    modes_agree_3of3 = len(set(modes)) == 1
    modes_agree_2of3 = (not modes_agree_3of3) and any(modes.count(m) >= 2 for m in modes)

    means = [per_book[b]["scenes_per_chapter"]["mean"] for b in BOOKS]
    mean_spread = round(max(means) - min(means), 3)

    single_pcts = [per_book[b]["single_scene_pct"] for b in BOOKS]
    single_pct_spread = round((max(single_pcts) - min(single_pcts)) * 100, 2)  # in pp

    # Bounded-share stability
    bsh = [per_book[b]["bounded_share_of_intermediates"] for b in BOOKS]
    bsh_spread = round((max(bsh) - min(bsh)) * 100, 2) if all(v is not None for v in bsh) else None

    # Directional verdict
    verdict_inputs = {
        "modes_per_book": dict(zip(BOOKS, modes)),
        "modes_agree_3of3": modes_agree_3of3,
        "modes_agree_2of3": modes_agree_2of3,
        "mean_scenes_per_chapter_per_book": dict(zip(BOOKS, means)),
        "mean_spread_pp_scenes": mean_spread,
        "single_scene_pct_per_book": dict(zip(BOOKS, single_pcts)),
        "single_scene_pct_spread_pp": single_pct_spread,
        "bounded_share_per_book": dict(zip(BOOKS, bsh)),
        "bounded_share_spread_pp": bsh_spread,
    }

    if modes_agree_3of3 and single_pct_spread <= 15.0:
        verdict = "PASS"
        verdict_summary = (
            f"Modal scenes-per-chapter = {modes[0]} in 3/3 books; single-scene-pct "
            f"spread {single_pct_spread:.1f}pp (<=15pt). Ship as planner prior."
        )
    elif modes_agree_2of3 and single_pct_spread <= 25.0:
        verdict = "PASS_PARTIAL"
        verdict_summary = (
            f"Modal scenes-per-chapter agrees in 2/3 books (modes={modes}); "
            f"single-scene-pct spread {single_pct_spread:.1f}pp."
        )
    elif modes_agree_3of3 or modes_agree_2of3:
        verdict = "DIVERGE"
        verdict_summary = (
            f"Modal agreement (modes={modes}) but single-scene-pct spread "
            f"{single_pct_spread:.1f}pp exceeds gate."
        )
    else:
        verdict = "KILL"
        verdict_summary = f"No modal agreement across books (modes={modes})."

    out = {
        "computedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pattern_id": 51,
        "pattern_name": "Scene-break density + within-chapter scene cadence",
        "description": (
            "Pure-compute analysis of scenes.jsonl. Groups scenes by (book, chapter), "
            "counts scenes per chapter, asks whether the per-chapter scene-count "
            "distribution is stable enough to drive a planner prior."
        ),
        "methodology": (
            "Per (book, chapter) grouping. Single-scene = group of size 1 (always "
            "corresponds to the 17 'unbounded' boundary records). Multi-scene = "
            "1 chapter-open + 0..N bounded + 1 chapter-close. SoS part1/part2/part3 "
            "structural markers excluded from headline chapters_only stats."
        ),
        "boundary_inventory": dict(bcount),
        "boundary_inventory_expected": expected,
        "per_book": per_book,
        "aggregate": {
            "n_chapters": len(aggregate_scene_counts),
            "scenes_per_chapter": stats(aggregate_scene_counts),
            "scene_count_histogram": histogram(aggregate_scene_counts, lo=1, hi=max(aggregate_scene_counts)),
            "chapter_word_totals": stats(aggregate_chapter_words),
            "scene_word_distribution": stats(aggregate_scene_words),
        },
        "cross_book_stability": verdict_inputs,
        "directional_verdict": verdict,
        "directional_summary": verdict_summary,
        "proposed_lever": (
            "Add OPTIONAL `sceneCount` field to chapterOutlineSchema (planner Phase 1 "
            "skeleton). Per-book single-scene rate is bimodal: CS 11.8% and HG 10.3% "
            "cluster ~10%; SoS 26.9% is an outlier (corroborates P22/P23 'SoS scenes "
            "1.8x larger'). Recommend planner default 'sceneCount in {2..5}, mode=4' "
            "with an OPTIONAL `chapterShape: continuous|fragmented` flag (continuous "
            "= sceneCount=1, target ~10-15% of chapters). All intermediate scenes in "
            "the corpus are hard breaks (bounded share = 100% across 3/3 books) so "
            "no soft-transition mode is needed. Beat-expander already targets "
            "~14 beats/chapter (P21/P37 floor); under sceneCount=1 the white-space-"
            "break linter should suppress mid-chapter scene-break warnings."
        ),
        "ship_recommendation": verdict_summary,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    out_path = OUT_DIR / f"crystal_shard.{ts}.scene-break-cadence.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"wrote {out_path}")

    # Console summary
    print("\n=== per-book scenes-per-chapter ===")
    for b in BOOKS:
        d = per_book[b]
        sc = d["scenes_per_chapter"]
        print(
            f"  {b}: n={sc['n']} mean={sc['mean']} median={sc['median']} "
            f"mode={sc['mode']} (share={sc['mode_share']}) "
            f"min={sc['min']} max={sc['max']} "
            f"single-scene={d['single_scene_chapters']} ({d['single_scene_pct']*100:.1f}%)"
        )
    print("\n=== cross-book stability ===")
    print(f"  modes per book: {dict(zip(BOOKS, modes))}")
    print(f"  modal agreement 3/3: {modes_agree_3of3}; 2/3: {modes_agree_2of3}")
    print(f"  mean spread: {mean_spread} scenes")
    print(f"  single-scene-pct spread: {single_pct_spread:.2f}pp")
    print(f"  bounded-share spread (intermediates): {bsh_spread}pp")
    print(f"\n  DIRECTIONAL VERDICT: {verdict}")
    print(f"  {verdict_summary}")
    print(f"\n  proposed lever: {out['proposed_lever']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
