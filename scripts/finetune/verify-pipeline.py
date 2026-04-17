#!/usr/bin/env python3
"""End-to-end data-flow audit: raw corpus → scenes → beats → training pairs.

Cross-checks each stage's output against the prior stage and surfaces any
silent data loss (chapters missing, scenes dropped, beats unaccounted for,
training pairs not linked back to a beat).

Usage:
  python3 scripts/finetune/verify-pipeline.py \
    --corpus-dir scripts/lora-data \
    --scenes scripts/lora-data/salvatore-scenes.jsonl \
    --beats scripts/lora-data/salvatore-1988-beats.jsonl \
    --pairs scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl \
    --output /tmp/pipeline-audit.json

Report structure:
  {
    "stages": {
      "corpus": { per-book word counts, chapter counts detected },
      "scenes": { per-book scenes extracted, chapter coverage, word totals },
      "beats":  { per-book beats, chapter coverage, beats-per-scene stats },
      "pairs":  { per-book pair counts, beats without pairs, orphan pairs },
    },
    "gaps": [ human-readable descriptions of data loss between stages ],
    "summary": { "clean": bool, "gap_count": int },
  }
"""

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

CHAPTER_RE = re.compile(r"(?:CHAPTER \d+[^\n]*|=== [^=]+ ===)")
CHAPTER_NUM_RE = re.compile(r"CHAPTER (\d+)")


def audit_corpus(corpus_dir: Path) -> dict:
    """Inspect the raw .txt corpus files for chapter coverage."""
    out = {}
    for txt in sorted(corpus_dir.glob("salvatore-*.txt")):
        name = txt.stem.replace("salvatore-", "")
        book_key = {
            "crystal-shard": "crystal_shard",
            "streams-of-silver": "streams_of_silver",
            "halflings-gem": "halflings_gem",
        }.get(name, name.replace("-", "_"))

        text = txt.read_text()
        chapter_matches = list(CHAPTER_NUM_RE.finditer(text))
        chapters = sorted({int(m.group(1)) for m in chapter_matches})
        out[book_key] = {
            "path": str(txt),
            "words": len(text.split()),
            "chapters_found": chapters,
            "chapter_count": len(chapters),
            "section_markers": len(CHAPTER_RE.findall(text)),
            "scene_breaks": text.count("* * *"),
        }
    return out


def audit_scenes(scenes_path: Path) -> dict:
    if not scenes_path.exists():
        return {"error": f"not found: {scenes_path}"}
    scenes = [json.loads(l) for l in scenes_path.open()]
    per_book = defaultdict(lambda: {"scenes": 0, "words": 0, "chapters": set()})
    for s in scenes:
        b = s.get("book", "?")
        per_book[b]["scenes"] += 1
        per_book[b]["words"] += s.get("words", 0)
        if "chapter" in s:
            per_book[b]["chapters"].add(s["chapter"])
    # JSON-safe
    for b in per_book:
        per_book[b]["chapters"] = sorted(per_book[b]["chapters"], key=lambda x: (isinstance(x, str), x))
        per_book[b]["chapter_count"] = len(per_book[b]["chapters"])
    return dict(per_book)


def audit_beats(beats_path: Path) -> dict:
    if not beats_path.exists():
        return {"error": f"not found: {beats_path}"}
    beats = [json.loads(l) for l in beats_path.open()]
    per_book = defaultdict(lambda: {"beats": 0, "words": 0, "scenes": set(), "chapters": set()})
    for b in beats:
        bk = b.get("book", "?")
        per_book[bk]["beats"] += 1
        per_book[bk]["words"] += b.get("words", 0)
        if "scene_id" in b: per_book[bk]["scenes"].add(b["scene_id"])
        if "chapter" in b: per_book[bk]["chapters"].add(b["chapter"])
    for bk in per_book:
        per_book[bk]["scene_count"] = len(per_book[bk]["scenes"])
        per_book[bk]["chapters"] = sorted(per_book[bk]["chapters"])
        per_book[bk]["chapter_count"] = len(per_book[bk]["chapters"])
        del per_book[bk]["scenes"]
    return dict(per_book)


def audit_pairs(pairs_path: Path, beats_path: Path | None) -> dict:
    if not pairs_path.exists():
        return {"error": f"not found: {pairs_path}"}
    pairs = [json.loads(l) for l in pairs_path.open()]

    # Map beat_id → pair. Beats without a pair are dropped silently during
    # format-sft; we want that surfaced.
    beat_ids_in_pairs = set()
    per_book = defaultdict(lambda: {"pairs": 0})
    for p in pairs:
        brief = p.get("brief", {}) or {}
        bk = brief.get("book", "?")
        per_book[bk]["pairs"] += 1
        if "beat_id" in brief:
            beat_ids_in_pairs.add(brief["beat_id"])

    missing = {}
    if beats_path and beats_path.exists():
        all_beat_ids = set()
        for b in (json.loads(l) for l in beats_path.open()):
            bid = f"{b['scene_id']}_b{b['beat_idx']}" if "scene_id" in b else None
            if bid: all_beat_ids.add(bid)
        missing_from_pairs = all_beat_ids - beat_ids_in_pairs
        orphans = beat_ids_in_pairs - all_beat_ids
        missing = {
            "beats_without_pair": len(missing_from_pairs),
            "beats_without_pair_sample": sorted(missing_from_pairs)[:10],
            "orphan_pairs": len(orphans),
            "orphan_pairs_sample": sorted(orphans)[:10],
        }

    return {"per_book": dict(per_book), "link_check": missing}


def find_gaps(stages: dict) -> list[str]:
    gaps = []
    corpus = stages.get("corpus", {})
    scenes = stages.get("scenes", {})
    beats = stages.get("beats", {})
    pairs = stages.get("pairs", {}).get("per_book", {})

    for book_key, corpus_info in corpus.items():
        chs_corpus = set(corpus_info.get("chapters_found", []))
        chs_scenes = set(scenes.get(book_key, {}).get("chapters", []))
        chs_beats  = set(beats.get(book_key, {}).get("chapters", []))

        _sort_key = lambda x: (isinstance(x, str), x)
        missing_in_scenes = sorted(chs_corpus - chs_scenes, key=_sort_key)
        missing_in_beats  = sorted(chs_scenes - chs_beats, key=_sort_key)

        if missing_in_scenes:
            gaps.append(f"{book_key}: chapters in corpus but NOT in scenes: {missing_in_scenes}")
        if missing_in_beats:
            gaps.append(f"{book_key}: chapters in scenes but NOT in beats: {missing_in_beats}")

        corpus_w = corpus_info.get("words", 0)
        scenes_w = scenes.get(book_key, {}).get("words", 0)
        beats_w  = beats.get(book_key, {}).get("words", 0)
        if corpus_w and scenes_w and scenes_w < corpus_w * 0.5:
            gaps.append(f"{book_key}: scenes have {scenes_w:,}w, corpus has {corpus_w:,}w — losing >50% of text")
        if scenes_w and beats_w and beats_w < scenes_w * 0.5:
            gaps.append(f"{book_key}: beats have {beats_w:,}w, scenes have {scenes_w:,}w — losing >50% of text")

    # Pair linkage
    link = stages.get("pairs", {}).get("link_check", {}) or {}
    if link.get("beats_without_pair", 0):
        gaps.append(f"{link['beats_without_pair']} beats have no training pair (sample: {link['beats_without_pair_sample'][:3]})")
    if link.get("orphan_pairs", 0):
        gaps.append(f"{link['orphan_pairs']} training pairs reference beats not in the beats file")

    return gaps


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--novel", help="Bundle key (resolves all paths from novels/<key>/)")
    ap.add_argument("--corpus-dir", type=Path, default=Path("scripts/lora-data"))
    ap.add_argument("--scenes", type=Path)
    ap.add_argument("--beats", type=Path)
    ap.add_argument("--pairs", type=Path)
    ap.add_argument("--output", type=Path)
    args = ap.parse_args()

    # Bundle mode resolves all paths from the bundle
    if args.novel:
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parent))
        from bundle import load_bundle  # noqa
        b = load_bundle(args.novel)
        # Use the bundle's source dir as "corpus-dir" for stage-1 invariants
        args.corpus_dir = b.root / "source"
        args.scenes = b.scenes_jsonl
        args.beats = b.beats_jsonl
        args.pairs = b.pairs_jsonl
        if not args.output:
            args.output = b.verification_json

    stages = {"corpus": audit_corpus(args.corpus_dir)}
    if args.scenes: stages["scenes"] = audit_scenes(args.scenes)
    if args.beats:  stages["beats"]  = audit_beats(args.beats)
    if args.pairs:  stages["pairs"]  = audit_pairs(args.pairs, args.beats)

    gaps = find_gaps(stages)
    report = {
        "stages": stages,
        "gaps": gaps,
        "summary": {
            "clean": not gaps,
            "gap_count": len(gaps),
        },
    }

    # Console summary
    print("=" * 70)
    print("PIPELINE DATA-FLOW AUDIT")
    print("=" * 70)
    for stage_name, stage_data in stages.items():
        print(f"\n[{stage_name}]")
        if isinstance(stage_data, dict):
            for k, v in stage_data.items():
                if isinstance(v, dict):
                    print(f"  {k}:")
                    for kk, vv in v.items():
                        if isinstance(vv, list) and len(vv) > 5:
                            vv = f"[{len(vv)} items: {vv[:5]}...]"
                        print(f"    {kk}: {vv}")
                else:
                    print(f"  {k}: {v}")

    print(f"\n{'=' * 70}")
    if gaps:
        print(f"GAPS FOUND ({len(gaps)}):")
        for g in gaps:
            print(f"  - {g}")
    else:
        print("CLEAN — no data-loss gaps detected between stages.")
    print("=" * 70)

    if args.output:
        args.output.write_text(json.dumps(report, indent=2, default=str))
        print(f"\nReport: {args.output}")


if __name__ == "__main__":
    main()
