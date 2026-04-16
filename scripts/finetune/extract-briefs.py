#!/usr/bin/env python3
"""Extract beat briefs from segmented beats for training data.

Reads the segmented beats JSONL and produces training pairs:
  - Input: structured beat brief (characters, POV, setting, action, transition)
  - Output: the actual prose text

Two modes:
  prepare: writes batch files for sub-agent processing (LLM extracts characters/POV/setting)
  merge: combines LLM-extracted briefs with beat text into final training JSONL

Usage:
  # Step 1: Prepare batches (groups of 10 beats per prompt)
  python3 scripts/finetune/extract-briefs.py prepare \
    --beats scripts/lora-data/salvatore-1988-beats.jsonl \
    --prompt-dir /tmp/brief-prompts \
    --batch-size 10

  # Step 2: (Claude Code runs sub-agents)

  # Step 3: Merge
  python3 scripts/finetune/extract-briefs.py merge \
    --beats scripts/lora-data/salvatore-1988-beats.jsonl \
    --results-dir /tmp/brief-results \
    --output scripts/lora-data/salvatore-1988-training-pairs.jsonl
"""

import argparse
import json
import re
import sys
from pathlib import Path

PROMPT_TEMPLATE = """You are extracting structured beat briefs from R.A. Salvatore's Icewind Dale Trilogy for training data.

For each beat below, extract:
- **characters**: list of character names present or mentioned in action
- **pov**: the POV character (whose thoughts/perceptions we follow; "omniscient" if none)
- **setting**: brief location (e.g., "Bryn Shander gates", "dark alley in Easthaven", "tundra")
- **tone**: 1-3 words (e.g., "tense", "grim humor", "desperate fury")
- **transition_in**: how this beat connects FROM the previous beat (e.g., "continues dialogue", "cuts to new location", "time skip", "same action"). First beat of scene = "scene_start"

Return a JSON array with one object per beat. Each object:
```json
{{
  "beat_id": "crystal_shard_ch1_s1_b0",
  "characters": ["Kessell", "Morkai"],
  "pov": "Kessell",
  "setting": "wizard's cabin, Easthaven",
  "tone": "horrified triumph",
  "transition_in": "scene_start"
}}
```

Return ONLY the JSON array.

## Beats to process:

{beats_block}
"""


def cmd_prepare(args):
    beats = [json.loads(l) for l in open(args.beats)]
    prompt_dir = Path(args.prompt_dir)
    prompt_dir.mkdir(parents=True, exist_ok=True)

    batches = []
    batch = []
    for i, beat in enumerate(beats):
        beat_id = f"{beat['scene_id']}_b{beat['beat_idx']}"
        beat_entry = {
            "beat_id": beat_id,
            "beat_idx": beat["beat_idx"],
            "scene_id": beat["scene_id"],
            "kind": beat["kind"],
            "boundary_signal": beat["boundary_signal"],
            "summary": beat["summary"],
            "words": beat["words"],
            "text": beat["text"],
        }
        batch.append(beat_entry)
        if len(batch) >= args.batch_size:
            batches.append(batch)
            batch = []
    if batch:
        batches.append(batch)

    for bi, batch in enumerate(batches):
        beats_block = ""
        for b in batch:
            beats_block += f"\n### Beat: {b['beat_id']} ({b['words']}w, {b['kind']})\n"
            beats_block += f"Summary: {b['summary']}\n"
            beats_block += f"Text:\n{b['text']}\n"

        prompt = PROMPT_TEMPLATE.format(beats_block=beats_block)
        prompt_file = prompt_dir / f"batch_{bi:03d}.txt"
        prompt_file.write_text(prompt)

    manifest = {
        "total_beats": len(beats),
        "batch_size": args.batch_size,
        "num_batches": len(batches),
        "batches": [
            {
                "batch_idx": bi,
                "prompt_file": str(prompt_dir / f"batch_{bi:03d}.txt"),
                "beat_ids": [b["beat_id"] for b in batch],
                "num_beats": len(batch),
            }
            for bi, batch in enumerate(batches)
        ],
    }
    (prompt_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"Prepared {len(beats)} beats in {len(batches)} batches of {args.batch_size}")
    print(f"Manifest: {prompt_dir / 'manifest.json'}")


def cmd_merge(args):
    beats = [json.loads(l) for l in open(args.beats)]
    beat_map = {}
    for i, b in enumerate(beats):
        beat_id = f"{b['scene_id']}_b{b['beat_idx']}"
        beat_map[beat_id] = b

    results_dir = Path(args.results_dir)
    result_files = sorted(results_dir.glob("*.json"))
    if not result_files:
        sys.exit(f"No result files in {results_dir}")

    briefs = {}
    for rf in result_files:
        data = json.load(open(rf))
        if isinstance(data, list):
            for item in data:
                briefs[item["beat_id"]] = item
        elif isinstance(data, dict) and "briefs" in data:
            for item in data["briefs"]:
                briefs[item["beat_id"]] = item

    training_pairs = []
    missing = 0
    for beat_id, beat in beat_map.items():
        brief = briefs.get(beat_id)
        if not brief:
            missing += 1
            continue

        # Build the training input (brief)
        training_input = {
            "beat_id": beat_id,
            "scene_id": beat["scene_id"],
            "book": beat.get("book", "unknown"),
            "chapter": beat.get("chapter", 0),
            "beat_idx": beat["beat_idx"],
            "kind": beat["kind"],
            "boundary_signal": beat["boundary_signal"],
            "characters": brief.get("characters", []),
            "pov": brief.get("pov", "omniscient"),
            "setting": brief.get("setting", ""),
            "tone": brief.get("tone", ""),
            "transition_in": brief.get("transition_in", ""),
            "summary": beat["summary"],
            "words": beat["words"],
        }

        training_pairs.append({
            "brief": training_input,
            "prose": beat["text"],
        })

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w") as f:
        for pair in training_pairs:
            f.write(json.dumps(pair) + "\n")

    print(f"\n=== Training Pair Results ===")
    print(f"Total beats: {len(beat_map)}")
    print(f"Briefs extracted: {len(briefs)}")
    print(f"Missing briefs: {missing}")
    print(f"Training pairs: {len(training_pairs)}")
    print(f"Output: {output}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")

    prep = sub.add_parser("prepare")
    prep.add_argument("--beats", required=True, type=Path)
    prep.add_argument("--prompt-dir", required=True, type=Path)
    prep.add_argument("--batch-size", type=int, default=10)

    mrg = sub.add_parser("merge")
    mrg.add_argument("--beats", required=True, type=Path)
    mrg.add_argument("--results-dir", required=True, type=Path)
    mrg.add_argument("--output", required=True, type=Path)

    args = ap.parse_args()
    if args.cmd == "prepare":
        cmd_prepare(args)
    elif args.cmd == "merge":
        cmd_merge(args)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
