"""
Pattern 52 — POV distribution per book (Salvatore Icewind Dale corpus).

For each chapter, extract first 1-2 beats' text. The classification step is done
by the LLM (the agent running this script), not by automated heuristics. This
script does:
  1. Load beats.jsonl, group by (book, chapter), sort by beat_idx.
  2. Emit a sampling JSON with chapter -> {beat0_text, beat1_text, words}
     for the LLM to classify.
  3. After classification (provided as a dict literal), compute aggregate stats:
     POV cast per book, mass per character, switch cadence, multi-POV %, cross-book.
  4. Write a timestamped JSON output.

Usage:
  python3 scripts/structure-calibration/pov-distribution.py --emit-sampling
  # then human/LLM produces classifications, paste into CLASSIFICATIONS dict below
  python3 scripts/structure-calibration/pov-distribution.py --finalize
"""
import argparse
import json
import os
import sys
from collections import defaultdict, Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "novels" / "salvatore-icewind-dale"
BEATS = BUNDLE / "beats.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
SAMPLING_PATH = OUT_DIR / "_pov-sampling-tmp.json"


def chapter_sort_key(c):
    s = str(c)
    if s.isdigit():
        return (0, int(s), s)
    # prelude before all chapters; epilogue after; part variants placed by name
    order = {
        "prelude": (-1, 0, "prelude"),
        "part1": (1, 100, "part1"),
        "part2": (1, 101, "part2"),
        "part3": (1, 102, "part3"),
        "epilogue": (2, 0, "epilogue"),
        "epilogue2": (2, 1, "epilogue2"),
        "epilogue3": (2, 2, "epilogue3"),
    }
    return order.get(s, (3, 0, s))


def load_beats():
    chapter_beats = defaultdict(list)
    with open(BEATS) as f:
        for line in f:
            b = json.loads(line)
            chapter_beats[(b["book"], str(b["chapter"]))].append(b)
    for k in chapter_beats:
        chapter_beats[k].sort(key=lambda b: b["beat_idx"])
    return chapter_beats


def emit_sampling(chapter_beats):
    sampling = {}
    for (book, ch), beats in sorted(chapter_beats.items(), key=lambda x: (x[0][0], chapter_sort_key(x[0][1]))):
        b0 = beats[0]
        b1 = beats[1] if len(beats) > 1 else None
        sampling[f"{book}::{ch}"] = {
            "book": book,
            "chapter": ch,
            "beat_count": len(beats),
            "beat0_words": b0["words"],
            "beat0_text": b0["text"],
            "beat1_words": b1["words"] if b1 else None,
            "beat1_text": b1["text"] if b1 else None,
        }
    SAMPLING_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SAMPLING_PATH, "w") as f:
        json.dump(sampling, f, indent=2)
    print(f"Wrote sampling to {SAMPLING_PATH} — {len(sampling)} chapters")


def collect_full_beat_text(chapter_beats, book, ch):
    """Collect all beat texts for one chapter (used to verify multi-POV suspicions)."""
    beats = chapter_beats[(book, ch)]
    return [(b["beat_idx"], b["words"], b["text"]) for b in beats]


def compute_stats(classifications, chapter_beats):
    """
    classifications: dict[(book, ch) -> {pov: str, multi_pov: bool, rationale: str, secondary_pov: list[str]|None}]
    """
    by_book = defaultdict(list)
    for (book, ch), info in classifications.items():
        by_book[book].append((ch, info))
    for book in by_book:
        by_book[book].sort(key=lambda x: chapter_sort_key(x[0]))

    book_stats = {}
    for book, items in by_book.items():
        povs = [info["pov"] for _, info in items]
        multi = [(ch, info) for ch, info in items if info.get("multi_pov")]
        cast = Counter(povs)
        n = len(items)

        # switch cadence: run lengths
        runs = []
        cur = povs[0]
        run_len = 1
        for p in povs[1:]:
            if p == cur:
                run_len += 1
            else:
                runs.append(run_len)
                cur = p
                run_len = 1
        runs.append(run_len)

        # mass
        mass = {pov: round(100.0 * count / n, 1) for pov, count in cast.items()}

        book_stats[book] = {
            "n_chapters": n,
            "cast_size": len(cast),
            "cast": dict(cast),
            "mass_pct": mass,
            "modal_pov": cast.most_common(1)[0][0],
            "modal_pct": cast.most_common(1)[0][1] * 100.0 / n,
            "multi_pov_count": len(multi),
            "multi_pov_pct": round(100.0 * len(multi) / n, 1),
            "multi_pov_chapters": [ch for ch, _ in multi],
            "switch_runs": runs,
            "mean_run_length": round(sum(runs) / len(runs), 2),
            "max_run_length": max(runs),
            "min_run_length": min(runs),
            "n_switches": len(runs) - 1,
        }

    # cross-book intersection
    casts = {b: set(s["cast"].keys()) for b, s in book_stats.items()}
    all_three = set.intersection(*casts.values()) if len(casts) == 3 else set()
    union = set.union(*casts.values()) if casts else set()
    in_2of3 = {p for p in union if sum(1 for s in casts.values() if p in s) == 2}
    in_1of3 = {p for p in union if sum(1 for s in casts.values() if p in s) == 1}

    multi_pcts = [s["multi_pov_pct"] for s in book_stats.values()]
    spread = max(multi_pcts) - min(multi_pcts) if multi_pcts else 0

    modal_set = {s["modal_pov"] for s in book_stats.values()}

    # core fellowship characters
    core = {"drizzt", "bruenor", "wulfgar", "catti-brie", "regis"}
    core_present_3of3 = {c for c in core if all(c in cast for cast in casts.values())}

    # verdict
    if len(modal_set) == 1 and len(core_present_3of3) >= 4 and spread <= 10:
        verdict = "PASS"
    elif len(modal_set) == 1 and len(core_present_3of3) >= 3:
        verdict = "PASS_PARTIAL"
    elif len(modal_set) <= 2:
        verdict = "PASS_PARTIAL"
    else:
        verdict = "DIVERGE"

    cross_book = {
        "modal_pov_per_book": {b: s["modal_pov"] for b, s in book_stats.items()},
        "modal_set_size": len(modal_set),
        "cast_3of3": sorted(all_three),
        "cast_2of3": sorted(in_2of3),
        "cast_1of3": sorted(in_1of3),
        "core_fellowship_3of3": sorted(core_present_3of3),
        "multi_pov_pct_spread": round(spread, 1),
        "directional_verdict": verdict,
    }

    return {"by_book": book_stats, "cross_book": cross_book}


def write_final(classifications, chapter_beats, ts):
    stats = compute_stats(classifications, chapter_beats)

    out = {
        "pattern_id": 52,
        "pattern_name": "POV distribution per book",
        "corpus": "salvatore-icewind-dale",
        "books": ["crystal_shard", "streams_of_silver", "halflings_gem"],
        "timestamp": ts,
        "methodology": (
            "For each chapter, extracted first 1-2 beats' text from beats.jsonl. "
            "Classified POV character via LLM reasoning over interiority cues, "
            "action-from-inside vs outside, and camera anchor. Suspected multi-POV "
            "chapters had full beat text scanned for POV-marker shifts. Prelude and "
            "epilogue chapters classified by their actual focal character; villain-"
            "focal chapters labeled by villain name when anchored, else "
            "'external_omniscient'."
        ),
        "classification_rules": {
            "interiority_test": "Whose thoughts/feelings/sensory perception do we get inside access to?",
            "action_anchor_test": "Whose actions are described from the inside vs outside?",
            "camera_anchor_test": "If multiple characters present, which one is the camera anchored to?",
            "multi_pov_label": "Mid-chapter switch confirmed via beats 2-N inspection",
            "external_omniscient_label": "No single character anchor; narrator floats above scene",
        },
        "per_chapter": {
            f"{b}::{c}": {
                "pov": info["pov"],
                "multi_pov": info.get("multi_pov", False),
                "secondary_pov": info.get("secondary_pov"),
                "rationale": info["rationale"],
            }
            for (b, c), info in classifications.items()
        },
        "stats": stats,
    }

    out_path = OUT_DIR / f"crystal_shard.{ts}.pov-distribution.json"
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote final to {out_path}")
    return out, out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit-sampling", action="store_true")
    ap.add_argument("--finalize", action="store_true")
    args = ap.parse_args()

    chapter_beats = load_beats()

    if args.emit_sampling:
        emit_sampling(chapter_beats)
        return

    if args.finalize:
        from pov_classifications import CLASSIFICATIONS
        ts = datetime.now().strftime("%Y%m%dT%H%M%S")
        out, path = write_final(CLASSIFICATIONS, chapter_beats, ts)
        print(json.dumps(out["stats"]["cross_book"], indent=2))
        return

    print("Specify --emit-sampling or --finalize")
    sys.exit(1)


if __name__ == "__main__":
    main()
