#!/usr/bin/env python3
"""Extract scene text from a novel bundle's source files.

Reads the bundle's source/*.txt files, splits each by chapter markers and
`* * *` scene breaks, writes `scenes.jsonl` with actual scene text included.

Default behavior: keep everything. Word-count filters apply only when
explicitly requested via --min-words / --max-words. A sibling
`scenes.report.json` always records per-book stats, dropped items, and
warnings so nothing is silently lost.

Usage:
  python3 scripts/finetune/extract-scenes.py --novel salvatore-icewind-dale
  python3 scripts/finetune/extract-scenes.py --novel salvatore-icewind-dale --min-words 100

  # Legacy (explicit paths) — still supported for ad-hoc one-offs:
  python3 scripts/finetune/extract-scenes.py --output /tmp/scenes.jsonl --corpus key=path
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

# Import via file path (script may run without PYTHONPATH setup)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bundle import load_bundle, Bundle  # noqa: E402

CHAPTER_RE = re.compile(r"(?:CHAPTER \d+[^\n]*|=== [^=]+ ===)")
SCENE_BREAK = "* * *"


def split_into_scenes(text: str) -> list[dict]:
    """Split corpus text into scenes, tracking chapter context + boundary type.

    Chapter identifier is collision-free:
      - `CHAPTER N — Title`     → chapter=N (int)
      - `=== Prelude ===`       → chapter="prelude" (or "prelude2" etc. if repeated)
      - `=== Epilogue ===`      → chapter="epilogue" (or "epilogue2" etc.)
      - `=== Part 1 - ... ===`  → chapter="part1"
    Salvatore's Crystal Shard legitimately has 3 Epilogue markers; the
    suffixing keeps scene_ids unique across the file.
    """
    chapters = list(CHAPTER_RE.finditer(text))
    scenes = []
    section_counts: dict[str, int] = {}
    for ci, ch_match in enumerate(chapters):
        ch_start = ch_match.end()
        ch_end = chapters[ci + 1].start() if ci + 1 < len(chapters) else len(text)
        ch_body = text[ch_start:ch_end]
        ch_title = ch_match.group()

        ch_num_match = re.search(r"CHAPTER (\d+)", ch_title)
        if ch_num_match:
            ch_id = int(ch_num_match.group(1))
        else:
            inner = ch_title.strip("= ").lower()
            if "prelude" in inner:      base = "prelude"
            elif "prologue" in inner:   base = "prologue"
            elif "epilogue" in inner:   base = "epilogue"
            elif inner.startswith("part"):
                m = re.search(r"part\s*(\d+)", inner)
                base = f"part{m.group(1)}" if m else f"section_{ci}"
            else:
                base = f"section_{re.sub(r'[^a-z0-9]+', '_', inner).strip('_') or ci}"
            # Suffix repeat occurrences within the same file
            section_counts[base] = section_counts.get(base, 0) + 1
            n = section_counts[base]
            ch_id = base if n == 1 else f"{base}{n}"

        parts = ch_body.split(SCENE_BREAK)
        for si, part in enumerate(parts):
            scene_text = part.strip()
            if not scene_text:
                continue
            wc = len(scene_text.split())
            if len(parts) == 1:
                boundary = "unbounded"
            elif si == 0:
                boundary = "chapter-open"
            elif si == len(parts) - 1:
                boundary = "chapter-close"
            else:
                boundary = "bounded"
            scenes.append({
                "chapter": ch_id,
                "chapter_title": ch_title,
                "scene_idx": si,
                "words": wc,
                "boundary": boundary,
                "text": scene_text,
            })
    return scenes


def run_for_sources(sources: dict[str, Path], min_words: int, max_words: int
                    ) -> tuple[list[dict], dict]:
    all_scenes = []
    report = {"books": {}, "warnings": []}

    for book_key, corpus_path in sources.items():
        if not corpus_path.exists():
            msg = f"{book_key}: source file not found: {corpus_path}"
            report["warnings"].append(msg)
            print(f"WARN: {msg}", file=sys.stderr)
            continue

        text = corpus_path.read_text()
        scenes = split_into_scenes(text)
        for s in scenes:
            s["book"] = book_key
            s["scene_id"] = f"{book_key}_ch{s['chapter']}_s{s['scene_idx']}"

        kept, dropped_low, dropped_high = [], [], []
        for s in scenes:
            if s["words"] < min_words:
                dropped_low.append({"scene_id": s["scene_id"], "words": s["words"]})
            elif s["words"] > max_words:
                dropped_high.append({"scene_id": s["scene_id"], "words": s["words"]})
            else:
                kept.append(s)

        chapters_with_scenes = {s["chapter"] for s in kept}
        chapter_num_re = re.compile(r"CHAPTER (\d+)")
        all_chapters: set = {int(m.group(1)) for m in chapter_num_re.finditer(text)}
        # Only report numeric chapters missing — section markers like "prelude"
        # are optional content, not always present
        missing_chapters = sorted(all_chapters - chapters_with_scenes,
                                  key=lambda x: (isinstance(x, str), x))
        if missing_chapters:
            msg = f"{book_key}: chapters with zero kept scenes: {missing_chapters}"
            report["warnings"].append(msg)
            print(f"WARN: {msg}", file=sys.stderr)

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
              f"({len(dropped_low)} below {min_words}w, {len(dropped_high)} above {max_words}w), "
              f"{len(chapters_with_scenes)}/{len(all_chapters)} chapters covered")

    report["total_scenes_kept"] = len(all_scenes)
    report["total_words_kept"] = sum(s["words"] for s in all_scenes)
    report["min_words_threshold"] = min_words
    report["max_words_threshold"] = max_words
    return all_scenes, report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--novel", help="Bundle key (e.g., 'salvatore-icewind-dale')")
    ap.add_argument("--output", type=Path, help="Explicit output path (overrides bundle default)")
    ap.add_argument("--corpus", action="append",
                    help="key=path pairs for ad-hoc use without a bundle (repeatable)")
    ap.add_argument("--min-words", type=int, default=0)
    ap.add_argument("--max-words", type=int, default=10**9)
    args = ap.parse_args()

    # Determine sources + output
    if args.novel:
        bundle: Bundle = load_bundle(args.novel)
        sources = bundle.source_files
        output = args.output or bundle.scenes_jsonl
        report_path = bundle.scenes_report
    elif args.corpus:
        sources = {}
        for pair in args.corpus:
            key, _, path = pair.partition("=")
            sources[key] = Path(path)
        if not args.output:
            sys.exit("--output required when using --corpus without --novel")
        output = args.output
        report_path = output.with_suffix(".report.json")
    else:
        sys.exit("provide --novel <key> or --corpus key=path pairs")

    all_scenes, report = run_for_sources(sources, args.min_words, args.max_words)

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w") as f:
        for s in all_scenes:
            f.write(json.dumps(s) + "\n")
    report_path.write_text(json.dumps(report, indent=2, default=str))

    print(f"\nTotal: {len(all_scenes)} scenes, {report['total_words_kept']:,} words")
    print(f"Output: {output}")
    print(f"Report: {report_path}")
    if report["warnings"]:
        print(f"\n{len(report['warnings'])} warnings (see report.json):")
        for w in report["warnings"]:
            print(f"  - {w}")


if __name__ == "__main__":
    main()
