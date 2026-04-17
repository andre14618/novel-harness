#!/usr/bin/env python3
"""Extract dialogue lines with character attribution from Salvatore corpus.

Input:  scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl
Output: scripts/finetune/archetype-poc/dialogue-lines.jsonl

Each output row: { char: str, line: str, beat_id: str, kind: str }

Strategy:
  1. For each beat, scan prose for quoted strings followed by attribution
     verbs (said, replied, asked, muttered, ...) near a character name.
  2. Canonical character list from salvatore-character-snapshots.json.
  3. De-duplicate identical lines (same char may have repeat phrases);
     keep one representative.
  4. Filter: lines must be 6+ words and <=40 words (too short = fragment,
     too long = cross-paragraph artifact).

Target: 5 characters (Drizzt, Bruenor, Wulfgar, Regis, Cattie-brie),
~24 lines each post-filter = ~120 lines total.
"""

import json, re, sys
from pathlib import Path
from collections import defaultdict

HERE = Path(__file__).parent
CORPUS = HERE.parent.parent / "lora-data" / "salvatore-1988-training-pairs-tagged.jsonl"
SNAPS  = HERE.parent / "salvatore-character-snapshots.json"
OUT    = HERE / "dialogue-lines.jsonl"

TARGET_CHARS = ["Drizzt", "Bruenor", "Wulfgar", "Regis", "Cattie-brie"]
PER_CHAR_TARGET = 24

ATTRIB_VERBS = r"(?:said|asked|replied|answered|muttered|whispered|shouted|growled|grumbled|cried|called|added|noted|offered|returned|agreed|demanded|protested|scoffed|chuckled|snapped|hissed|sighed|began|finished|continued|went on|told|said to)"
# Patterns:
#   "Quote," said X.     → post-attribution
#   X said, "Quote."     → pre-attribution
POST_PATTERN = re.compile(
    r'"([^"]{10,200})[",.!?]"?\s*(?:,|\.)?\s*' + ATTRIB_VERBS + r'\s+(\w[\w-]*)',
    re.IGNORECASE,
)
PRE_PATTERN = re.compile(
    r'(\w[\w-]*)\s+' + ATTRIB_VERBS + r'[,.]?\s*"([^"]{10,200})[",.!?]"?',
    re.IGNORECASE,
)

def word_count(s: str) -> int:
    return len(re.findall(r"\S+", s))

def main():
    if not CORPUS.exists():
        sys.exit(f"corpus not found: {CORPUS} (check LXC vs local; this script expects local)")
    per_char = defaultdict(list)
    total_scanned = 0

    with CORPUS.open() as fh:
        for line in fh:
            beat = json.loads(line)
            prose = beat.get("prose", "")
            beat_id = beat.get("brief", {}).get("beat_id", "?")
            total_scanned += 1

            for m in POST_PATTERN.finditer(prose):
                quote, speaker = m.group(1), m.group(2)
                speaker = speaker.capitalize()
                if speaker in TARGET_CHARS and 6 <= word_count(quote) <= 40:
                    per_char[speaker].append({"char": speaker, "line": quote, "beat_id": beat_id, "pattern": "post"})
            for m in PRE_PATTERN.finditer(prose):
                speaker, quote = m.group(1), m.group(2)
                speaker = speaker.capitalize()
                if speaker in TARGET_CHARS and 6 <= word_count(quote) <= 40:
                    per_char[speaker].append({"char": speaker, "line": quote, "beat_id": beat_id, "pattern": "pre"})

    # Dedupe + cap
    final = []
    for char in TARGET_CHARS:
        seen = set()
        keep = []
        for row in per_char[char]:
            norm = row["line"].strip().lower()
            if norm in seen: continue
            seen.add(norm)
            keep.append(row)
            if len(keep) >= PER_CHAR_TARGET: break
        final.extend(keep)
        print(f"  {char}: {len(keep)} (raw {len(per_char[char])})")

    with OUT.open("w") as fh:
        for row in final:
            fh.write(json.dumps(row) + "\n")
    print(f"\nScanned {total_scanned} beats → {len(final)} dialogue lines → {OUT}")

if __name__ == "__main__":
    main()
