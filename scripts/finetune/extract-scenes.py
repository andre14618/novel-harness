#!/usr/bin/env python3
"""Extract scene text from ingested corpus files using scene metadata.

Reads salvatore-scenes.jsonl (metadata) + the three corpus .txt files,
splits each corpus by `* * *` and chapter markers, and outputs a JSONL
with the actual scene text added.

Filters to pass-1 candidates: bounded scenes, 200-1500 words.

Usage:
  python3 scripts/finetune/extract-scenes.py \
    --output /tmp/salvatore-pass1-scenes.jsonl
"""

import argparse
import json
import re
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
    """Split corpus text into scenes, tracking chapter context."""
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
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--min-words", type=int, default=200)
    ap.add_argument("--max-words", type=int, default=1500)
    args = ap.parse_args()

    all_scenes = []
    for book_key, corpus_path in CORPUS_FILES.items():
        if not corpus_path.exists():
            print(f"SKIP: {corpus_path} not found")
            continue
        text = corpus_path.read_text()
        scenes = split_into_scenes(text)
        for s in scenes:
            s["book"] = book_key
            s["scene_id"] = f"{book_key}_ch{s['chapter']}_s{s['scene_idx']}"

        bounded = [
            s for s in scenes
            if s["boundary"] == "bounded"
            and args.min_words <= s["words"] <= args.max_words
        ]
        all_scenes.extend(bounded)
        print(f"{book_key}: {len(scenes)} total scenes, {len(bounded)} pass-1 candidates")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        for s in all_scenes:
            f.write(json.dumps(s) + "\n")

    total_words = sum(s["words"] for s in all_scenes)
    print(f"\nTotal: {len(all_scenes)} scenes, {total_words:,} words")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
