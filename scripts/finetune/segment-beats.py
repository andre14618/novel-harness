#!/usr/bin/env python3
"""Batch beat-segmentation: reads pass-1 scenes, writes segmented beats JSONL.

This script prepares the input for Claude Code sub-agents. It:
1. Reads extracted scenes from the pass-1 JSONL
2. Writes per-scene prompt files to a temp directory
3. Collects completed results and merges sub-60w beats
4. Outputs final segmented beats JSONL

The actual sub-agent calls happen in Claude Code (not in this script).
This is the pre/post-processing wrapper.

Usage:
  # Step 1: Prepare prompts
  python3 scripts/finetune/segment-beats.py prepare \
    --scenes /tmp/salvatore-pass1-scenes.jsonl \
    --prompt-dir /tmp/beat-prompts \
    --batch-size 5

  # Step 2: (Claude Code runs sub-agents on each batch)

  # Step 3: Post-process results
  python3 scripts/finetune/segment-beats.py merge \
    --results-dir /tmp/beat-results \
    --scenes /tmp/salvatore-pass1-scenes.jsonl \
    --output scripts/lora-data/salvatore-1988-beats.jsonl \
    --min-words 60
"""

import argparse
import json
import sys
from pathlib import Path

PROMPT_TEMPLATE = """You are segmenting a scene from R.A. Salvatore's Icewind Dale Trilogy (1988-1990) into dramatic beats for training data.

## Task

Read the scene text below and split it into sequential beats. Each beat is one unit of dramatic action — a single shift in attention, one exchange, one action sequence.

## Beat boundaries

A new beat starts when you detect one of these signals:
- POV attention shift — the "camera" moves to a different character or object
- Action shift — physical movement changes direction
- Narration↔dialogue transition — prose switches into or out of a spoken exchange
- Stakes recalibration — tension level visibly rises or resets
- Speaker change — a different character takes the dialogue lead
- Sensory channel change — sight→sound, sound→touch, etc.

## Target size

**~80–140 words per beat.** Median should land near 105 words. If a beat would be under 60 words, merge it with the previous beat. If over 170 words, look harder for a boundary.

## Output format

Return ONLY a JSON array. Each beat object must have these fields:
- beat_idx (int, starting at 0)
- words (int, word count of this beat)
- kind: one of "dialogue", "action", "interiority", "description"
- boundary_signal: one of "scene_start", "pov_attention_shift", "action_shift", "narration_to_dialogue", "dialogue_to_narration", "stakes_recalibration", "speaker_change", "sensory_channel_change"
- summary: one sentence describing the dramatic action
- first_sentence: exact first sentence of the beat
- last_sentence: exact last sentence of the beat
- text: the FULL VERBATIM text of this beat, every word, no omissions

First beat always has boundary_signal "scene_start". Every word of the scene must appear in exactly one beat. Beats must be sequential.

## Scene: {scene_id} ({words} words)

{text}

Return ONLY the JSON array."""


def cmd_prepare(args):
    scenes = [json.loads(l) for l in open(args.scenes)]
    prompt_dir = Path(args.prompt_dir)
    prompt_dir.mkdir(parents=True, exist_ok=True)

    batches = []
    batch = []
    for i, scene in enumerate(scenes):
        prompt = PROMPT_TEMPLATE.format(
            scene_id=scene["scene_id"],
            words=scene["words"],
            text=scene["text"],
        )
        prompt_file = prompt_dir / f"scene_{i:03d}_{scene['scene_id']}.txt"
        prompt_file.write_text(prompt)
        batch.append({
            "index": i,
            "scene_id": scene["scene_id"],
            "prompt_file": str(prompt_file),
            "words": scene["words"],
        })
        if len(batch) >= args.batch_size:
            batches.append(batch)
            batch = []
    if batch:
        batches.append(batch)

    manifest = prompt_dir / "manifest.json"
    manifest.write_text(json.dumps({
        "total_scenes": len(scenes),
        "batch_size": args.batch_size,
        "num_batches": len(batches),
        "batches": batches,
    }, indent=2))

    print(f"Prepared {len(scenes)} scene prompts in {len(batches)} batches")
    print(f"Manifest: {manifest}")
    total_words = sum(s["words"] for s in scenes)
    est_tokens = total_words * 1.3 + len(scenes) * 800  # input prose + prompt overhead
    print(f"Estimated input tokens: ~{est_tokens/1000:.0f}K")


def merge_small_beats(beats: list[dict], min_words: int) -> list[dict]:
    """Merge beats smaller than min_words into the preceding beat."""
    if not beats:
        return beats

    merged = [beats[0]]
    for beat in beats[1:]:
        if beat["words"] < min_words:
            prev = merged[-1]
            prev["text"] = prev["text"].rstrip() + "\n" + beat["text"]
            prev["words"] = len(prev["text"].split())
            prev["last_sentence"] = beat["last_sentence"]
            prev["summary"] = prev["summary"].rstrip(".") + "; " + beat["summary"]
        else:
            merged.append(beat)

    # Re-index
    for i, b in enumerate(merged):
        b["beat_idx"] = i

    return merged


def cmd_merge(args):
    results_dir = Path(args.results_dir)
    scenes = [json.loads(l) for l in open(args.scenes)]
    scene_map = {s["scene_id"]: s for s in scenes}

    result_files = sorted(results_dir.glob("*.json"))
    if not result_files:
        sys.exit(f"No result files in {results_dir}")

    all_beats = []
    stats = {"total_scenes": 0, "total_beats_raw": 0, "total_beats_merged": 0, "merged_count": 0}

    for rf in result_files:
        data = json.load(open(rf))
        scene_id = data.get("scene_id", rf.stem)
        beats = data.get("beats", data if isinstance(data, list) else [])

        raw_count = len(beats)
        beats = merge_small_beats(beats, args.min_words)
        merged_count = raw_count - len(beats)

        scene_meta = scene_map.get(scene_id, {})
        for beat in beats:
            beat["scene_id"] = scene_id
            beat["book"] = scene_meta.get("book", "unknown")
            beat["chapter"] = scene_meta.get("chapter", 0)

        all_beats.extend(beats)
        stats["total_scenes"] += 1
        stats["total_beats_raw"] += raw_count
        stats["total_beats_merged"] += len(beats)
        stats["merged_count"] += merged_count

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w") as f:
        for beat in all_beats:
            f.write(json.dumps(beat) + "\n")

    word_counts = [b["words"] for b in all_beats]
    print(f"\n=== Beat Segmentation Results ===")
    print(f"Scenes processed: {stats['total_scenes']}")
    print(f"Raw beats: {stats['total_beats_raw']}")
    print(f"After merge (<{args.min_words}w): {stats['total_beats_merged']} ({stats['merged_count']} merged)")
    print(f"Median beat size: {sorted(word_counts)[len(word_counts)//2]}w")
    print(f"Mean beat size: {sum(word_counts)/len(word_counts):.0f}w")
    print(f"Total words: {sum(word_counts):,}")
    print(f"Output: {output}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")

    prep = sub.add_parser("prepare")
    prep.add_argument("--scenes", required=True, type=Path)
    prep.add_argument("--prompt-dir", required=True, type=Path)
    prep.add_argument("--batch-size", type=int, default=5)

    mrg = sub.add_parser("merge")
    mrg.add_argument("--results-dir", required=True, type=Path)
    mrg.add_argument("--scenes", required=True, type=Path)
    mrg.add_argument("--output", required=True, type=Path)
    mrg.add_argument("--min-words", type=int, default=60)

    args = ap.parse_args()
    if args.cmd == "prepare":
        cmd_prepare(args)
    elif args.cmd == "merge":
        cmd_merge(args)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
