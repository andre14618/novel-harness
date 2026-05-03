#!/usr/bin/env python3
"""Extract dialogue lines with character attribution from Salvatore corpus.

Input:  novels/salvatore-icewind-dale/analysis/dialogue-extract.jsonl
        (2,447 attributed dialogue lines, DeepSeek-extracted from the full
        Icewind Dale corpus — see docs/corpus-pipeline.md. Replaces the old
        regex path over the 777-beat tagged training file, which yielded
        only 39 usable lines.)
Output: scripts/finetune/archetype-poc/dialogue-lines.jsonl

Each output row: { char, line, beat_id, pattern }
  - `line` is the raw dialogue quote (field renamed from corpus `quote`).
  - `pattern` carries the corpus `attribution_method` (named | flow | ...)
    so downstream steps can inspect extraction provenance.

Strategy:
  1. Stream the LLM-extracted JSONL. No regex scan of prose.
  2. Filter to 5 target characters (Drizzt, Bruenor, Wulfgar, Regis,
     Catti-brie). Note: corpus spells it `Catti-brie` with a single 't`;
     we also accept `Catti-brie` for safety.
  3. Word-length gate: 6..40 words (drop fragments and cross-paragraph
     artifacts; matches the prior gate).
  4. Dedupe by normalized line text per character.
  5. Cap per character at PER_CHAR_TARGET.

Target: ~100 pairs per character × 5 = ~500 total (bumped from 120).
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
REPO_ROOT = HERE.parent.parent.parent
CORPUS = REPO_ROOT / "novels" / "salvatore-icewind-dale" / "analysis" / "dialogue-extract.jsonl"
OUT = HERE / "dialogue-lines.jsonl"

# Canonical target set. Salvatore spells it `Catti-brie` (single 't') —
# that's the canonical form used in salvatore-character-snapshots.json.
# Accept both spellings on input; normalize to the canonical Catti-brie.
TARGET_CHARS = {"Drizzt", "Bruenor", "Wulfgar", "Regis", "Catti-brie", "Catti-brie"}
CHAR_ALIAS = {"Catti-brie": "Catti-brie"}  # normalize to snapshot spelling
PER_CHAR_TARGET = 100


def word_count(s: str) -> int:
    return len(re.findall(r"\S+", s))


def main() -> None:
    if not CORPUS.exists():
        sys.exit(f"corpus not found: {CORPUS}")

    per_char: dict[str, list[dict]] = defaultdict(list)
    total_rows = 0
    kept_pre_cap = 0

    with CORPUS.open() as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            total_rows += 1
            row = json.loads(raw)
            char = row.get("char", "")
            if char not in TARGET_CHARS:
                continue
            quote = row.get("quote", "").strip()
            if not quote:
                continue
            if not (6 <= word_count(quote) <= 40):
                continue
            canonical = CHAR_ALIAS.get(char, char)
            per_char[canonical].append(
                {
                    "char": canonical,
                    "line": quote,
                    "beat_id": row.get("beat_id", "?"),
                    "pattern": row.get("attribution_method", "unknown"),
                }
            )
            kept_pre_cap += 1

    # Dedupe + cap per character.
    final: list[dict] = []
    per_char_kept: dict[str, int] = {}
    for char in ("Drizzt", "Bruenor", "Wulfgar", "Regis", "Catti-brie"):
        seen: set[str] = set()
        keep: list[dict] = []
        for item in per_char.get(char, []):
            norm = item["line"].strip().lower()
            if norm in seen:
                continue
            seen.add(norm)
            keep.append(item)
            if len(keep) >= PER_CHAR_TARGET:
                break
        per_char_kept[char] = len(keep)
        final.extend(keep)

    with OUT.open("w") as fh:
        for item in final:
            fh.write(json.dumps(item) + "\n")

    # Report.
    print(f"Source: {CORPUS.relative_to(REPO_ROOT)}")
    print(f"Scanned {total_rows} attributed lines")
    print(f"Passed filters (target char + 6..40 words): {kept_pre_cap}")
    print("Per-character kept (after dedupe + cap):")
    for char in ("Drizzt", "Bruenor", "Wulfgar", "Regis", "Catti-brie"):
        raw_count = len(per_char.get(char, []))
        print(f"  {char}: {per_char_kept[char]} (raw {raw_count})")
    print(f"\nTotal: {len(final)} dialogue lines → {OUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
