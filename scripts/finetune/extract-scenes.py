#!/usr/bin/env python3
"""Extract scene text from ingested corpus files.

Reads the three corpus .txt files directly, splits each by `CHAPTER N —`
headers and `* * *` scene breaks, outputs a JSONL with the actual scene
text included.

Default behavior: keep everything. Word-count filters are applied only
when explicitly requested via --min-words / --max-words. A sibling
`<output>.report.json` always records per-book stats, dropped items,
and warnings so nothing is silently lost.

Usage:
  python3 scripts/finetune/extract-scenes.py --output /tmp/scenes.jsonl
  python3 scripts/finetune/extract-scenes.py --output /tmp/scenes.jsonl --min-words 100 --max-words 10000
"""

import argparse
import json
import re
import sys
from pathlib import Path

LORA_DATA = Path(__file__).resolve().parent.parent / "lora-data"

CORPUS_FILES = {
    "crystal_shard": LORA_DATA / "salvatore-crystal-shard.txt",
    "streams_of_silver": LORA_DATA / "salvatore-streams-of-silver.txt",
    "halflings_gem": LORA_DATA / "salvatore-halflings-gem.txt",
}

CHAPTER_RE = re.compile(r"(?:CHAPTER \d+[^\n]*|=== [^=]+ ===)")
SCENE_BREAK = "* * *"


def split_into_scenes(text: str) -> list[dict]:
    """Split corpus text into scenes, tracking chapter context + boundary type."""
    chapters = list(CHAPTER_RE.finditer(text))
    scenes = []

    for ci, ch_match in enumerate(chapters):
        ch_start = ch_match.end()
        ch_end = chapters[ci + 1].start() if ci + 1 < len(chapters) else len(text)
        ch_body = text[ch_start:ch_end]
        ch_title = ch_match.group()

        ch_num_match = re.search(r"CHAPTER (\d+)", ch_title)
        ch_num = int(ch_num_match.group(1)) if ch_num_match else ci + 1

        parts = ch_body.split(SCENE_BREAK)
        for si, part in enumerate(parts):
            scene_text = part.strip()
            if not scene_text:
                continue
            wc = len(scene_text.split())

            # Boundary tells downstream whether this scene is flanked by
            # explicit `* * *` scene breaks on both sides (strongest signal
            # for a self-contained unit) or is a chapter-open/close/unbounded
            # scene. It's advisory metadata — do NOT use it as a silent filter.
            if len(parts) == 1:
                boundary = "unbounded"
            elif si == 0:
                boundary = "chapter-open"
            elif si == len(parts) - 1:
                boundary = "chapter-close"
            else:
                boundary = "bounded"

            scenes.append({
                "chapter": ch_num,
                "chapter_title": ch_title,
                "scene_idx": si,
                "words": wc,
                "boundary": boundary,
                "text": scene_text,
            })

    return scenes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--min-words", type=int, default=0,
                    help="Drop scenes below this word count (default: 0 — keep everything)")
    ap.add_argument("--max-words", type=int, default=10**9,
                    help="Drop scenes above this word count (default: effectively infinite)")
    ap.add_argument("--corpus", action="append",
                    help="Override: key=path pairs, repeatable. If omitted, uses built-in Salvatore paths.")
    args = ap.parse_args()

    # Resolve corpus paths (allow override for future non-Salvatore ingestion)
    corpus = dict(CORPUS_FILES)
    if args.corpus:
        for pair in args.corpus:
            key, _, path = pair.partition("=")
            corpus[key] = Path(path)

    all_scenes = []
    report = {"books": {}, "warnings": []}

    for book_key, corpus_path in corpus.items():
        if not corpus_path.exists():
            msg = f"corpus file not found: {corpus_path}"
            report["warnings"].append(msg)
            print(f"WARN: {msg}", file=sys.stderr)
            continue

        text = corpus_path.read_text()
        scenes = split_into_scenes(text)
        for s in scenes:
            s["book"] = book_key
            s["scene_id"] = f"{book_key}_ch{s['chapter']}_s{s['scene_idx']}"

        # Apply word-count filter (loud — we report every drop)
        kept = []
        dropped_low = []
        dropped_high = []
        for s in scenes:
            if s["words"] < args.min_words:
                dropped_low.append({"scene_id": s["scene_id"], "words": s["words"]})
            elif s["words"] > args.max_words:
                dropped_high.append({"scene_id": s["scene_id"], "words": s["words"]})
            else:
                kept.append(s)

        # Chapter coverage check — flag any chapter with zero scenes (likely
        # indicates a regex miss or a filter that ate everything)
        chapters_with_scenes = {s["chapter"] for s in kept}
        chapter_re = re.compile(r"CHAPTER (\d+)")
        all_chapters = {int(m.group(1)) for m in chapter_re.finditer(text)}
        missing_chapters = sorted(all_chapters - chapters_with_scenes)
        if missing_chapters:
            msg = f"{book_key}: chapters with zero kept scenes: {missing_chapters}"
            report["warnings"].append(msg)
            print(f"WARN: {msg}", file=sys.stderr)

        # Boundary distribution — useful diagnostic
        from collections import Counter
        boundary_dist = Counter(s["boundary"] for s in kept)

        report["books"][book_key] = {
            "path": str(corpus_path),
            "total_scenes": len(scenes),
            "kept_scenes": len(kept),
            "dropped_below_min": dropped_low,
            "dropped_above_max": dropped_high,
            "chapters_total": len(all_chapters),
            "chapters_covered": len(chapters_with_scenes),
            "missing_chapters": missing_chapters,
            "boundary_distribution": dict(boundary_dist),
            "words_kept": sum(s["words"] for s in kept),
        }
        all_scenes.extend(kept)

        print(f"{book_key}: {len(scenes)} total scenes, {len(kept)} kept "
              f"({len(dropped_low)} below {args.min_words}w, {len(dropped_high)} above {args.max_words}w), "
              f"{len(chapters_with_scenes)}/{len(all_chapters)} chapters covered")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        for s in all_scenes:
            f.write(json.dumps(s) + "\n")

    report["total_scenes_kept"] = len(all_scenes)
    report["total_words_kept"] = sum(s["words"] for s in all_scenes)
    report["min_words_threshold"] = args.min_words
    report["max_words_threshold"] = args.max_words
    report_path = args.output.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, indent=2, default=str))

    print(f"\nTotal: {len(all_scenes)} scenes, {report['total_words_kept']:,} words")
    print(f"Output: {args.output}")
    print(f"Report: {report_path}")
    if report["warnings"]:
        print(f"\n{len(report['warnings'])} warnings (see report.json):")
        for w in report["warnings"]:
            print(f"  - {w}")


if __name__ == "__main__":
    main()
