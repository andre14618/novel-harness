#!/usr/bin/env python3
"""Diagnostic: sample dialogue passages from the corpus to see what patterns exist."""
import json, re
from pathlib import Path
from collections import Counter

CORPUS = Path("/home/andre/apps/novel-harness/scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl")
TARGET_CHARS = ["Drizzt", "Bruenor", "Wulfgar", "Regis", "Cattie-brie", "Catti-brie", "Kessell", "Biggrin"]

def main():
    data = [json.loads(l) for l in CORPUS.open()]
    print(f"{len(data)} beats")

    # Total quote count
    total_quotes = 0
    quote_lens = []
    for beat in data:
        prose = beat.get("prose", "")
        for m in re.finditer(r'"([^"]{4,300})"', prose):
            total_quotes += 1
            quote_lens.append(len(m.group(1).split()))
    print(f"Total quoted fragments: {total_quotes}")
    print(f"Word-count distribution: min={min(quote_lens)}, max={max(quote_lens)}, "
          f"mean={sum(quote_lens)/len(quote_lens):.1f}")

    # Character name mentions
    print("\nCharacter name mentions:")
    for c in TARGET_CHARS:
        count = 0
        for beat in data:
            count += len(re.findall(r'\b' + re.escape(c) + r'\b', beat.get("prose", "")))
        print(f"  {c}: {count}")

    # Sample passages showing dialogue shape
    print("\n=== 3 sample passages with dialogue ===")
    shown = 0
    for beat in data:
        prose = beat.get("prose", "")
        if '"' in prose and shown < 3:
            # Find a chunk with dialogue
            paras = prose.split("\n\n")
            for p in paras:
                if '"' in p and len(p) > 100:
                    print(f"\n--- beat {beat['brief']['beat_id']} ---")
                    print(p[:800])
                    shown += 1
                    break

if __name__ == "__main__":
    main()
