#!/usr/bin/env python3
"""Format the 80% training split into W&B SFT JSONL.

Input:  dialogue-pairs.jsonl (post flatten-lines.ts + split-train-test.py)
Output: sft-train.jsonl + sft-val.jsonl

User prompt shape (character-name tagged — the voice anchor is the name):

  CHARACTER: DRIZZT
  VOICE PROFILE:
  {voice snapshot block from salvatore-character-snapshots.json}

  FLAT DIALOGUE LINE:
  "The dwarf is no longer the one I raised."

  Rewrite in {CHARACTER}'s voice. Output ONLY the voiced line.

Assistant output: the original voiced line (unquoted).

Random-seeded 80/20 stratified split by character keeps per-class balance
in train + val.
"""

import json, random, sys
from pathlib import Path
from collections import defaultdict

HERE   = Path(__file__).parent
SNAPS  = HERE.parent / "salvatore-character-snapshots.json"
PAIRS  = HERE / "dialogue-pairs.jsonl"
TRAIN  = HERE / "sft-train.jsonl"
VAL    = HERE / "sft-val.jsonl"
MANI   = HERE / "split-manifest.json"

SYSTEM = "You are a voice stylist for character dialogue in action-pulp fantasy."

def build_user(char: str, voice_block: dict, flat: str) -> str:
    voice = voice_block.get("voice", "")
    drives = voice_block.get("drives", "")
    avoids = voice_block.get("avoids", "")
    conflict = voice_block.get("conflict", "")
    return (
        f"CHARACTER: {char.upper()}\n"
        f"VOICE PROFILE:\n"
        f"  Voice: {voice}\n"
        f"  Drives: {drives}\n"
        f"  Avoids: {avoids}\n"
        f"  Conflict: {conflict}\n\n"
        f"FLAT DIALOGUE LINE:\n"
        f'"{flat}"\n\n'
        f"Rewrite in {char}'s voice. Output ONLY the voiced line, no quotes."
    )

def main():
    snaps = json.loads(SNAPS.read_text())
    rows = [json.loads(l) for l in PAIRS.open()]

    by_char = defaultdict(list)
    for r in rows: by_char[r["char"]].append(r)

    rng = random.Random(42)  # deterministic split
    train, val = [], []
    for char, items in by_char.items():
        rng.shuffle(items)
        cut = int(len(items) * 0.8)
        train.extend(items[:cut])
        val.extend(items[cut:])

    def to_sft(r):
        char = r["char"]
        if char not in snaps:
            sys.exit(f"character '{char}' missing from {SNAPS}")
        return {
            "messages": [
                {"role": "system",    "content": SYSTEM},
                {"role": "user",      "content": build_user(char, snaps[char], r["flat"])},
                {"role": "assistant", "content": r["voiced"]},
            ]
        }

    with TRAIN.open("w") as f:
        for r in train: f.write(json.dumps(to_sft(r)) + "\n")
    with VAL.open("w") as f:
        for r in val: f.write(json.dumps(to_sft(r)) + "\n")

    MANI.write_text(json.dumps({
        "train_count": len(train), "val_count": len(val),
        "by_char_train": {c: sum(1 for x in train if x["char"]==c) for c in by_char},
        "by_char_val":   {c: sum(1 for x in val   if x["char"]==c) for c in by_char},
        "seed": 42,
    }, indent=2))

    print(f"train={len(train)} val={len(val)}")
    print(f"manifest → {MANI}")

if __name__ == "__main__":
    main()
