#!/usr/bin/env python3
"""Batch beat-segmentation: reads pass-1 scenes, writes segmented beats JSONL.

Uses Claude Code sub-agents for segmentation. This script handles
pre/post-processing only.

`prepare` emits per-scene prompt files + a manifest listing expected scene_ids.
`merge` cross-checks the manifest against actual result files and warns on
missing/orphaned/malformed results — no silent data loss.

Usage:
  python3 scripts/finetune/segment-beats.py prepare \
    --scenes /tmp/salvatore-pass1-scenes.jsonl \
    --prompt-dir /tmp/beat-prompts \
    --batch-size 5

  # Step 2: Claude Code runs sub-agents on each batch, writes /tmp/beat-results/<scene_id>.json

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

REQUIRED_BEAT_FIELDS = ["beat_idx", "words", "kind", "boundary_signal", "summary",
                        "first_sentence", "last_sentence", "text"]


def cmd_prepare(args):
    scenes = [json.loads(l) for l in open(args.scenes)]
    prompt_dir = Path(args.prompt_dir)
    prompt_dir.mkdir(parents=True, exist_ok=True)

    batches = []
    batch = []
    prepared_scene_ids = []
    for i, scene in enumerate(scenes):
        prompt = PROMPT_TEMPLATE.format(
            scene_id=scene["scene_id"],
            words=scene["words"],
            text=scene["text"],
        )
        prompt_file = prompt_dir / f"scene_{i:03d}_{scene['scene_id']}.txt"
        prompt_file.write_text(prompt)
        prepared_scene_ids.append(scene["scene_id"])
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
        "expected_scene_ids": prepared_scene_ids,
        "batches": batches,
    }, indent=2))

    total_words = sum(s["words"] for s in scenes)
    est_tokens = total_words * 1.3 + len(scenes) * 800
    print(f"Prepared {len(scenes)} scene prompts in {len(batches)} batches")
    print(f"Manifest: {manifest}")
    print(f"Estimated input tokens: ~{est_tokens/1000:.0f}K")


def merge_small_beats(beats: list[dict], min_words: int) -> tuple[list[dict], int]:
    """Merge beats under min_words into the preceding beat. Returns (merged, merged_count)."""
    if not beats:
        return beats, 0
    merged = [beats[0]]
    merged_count = 0
    for beat in beats[1:]:
        if beat["words"] < min_words:
            prev = merged[-1]
            prev["text"] = prev["text"].rstrip() + "\n" + beat["text"]
            prev["words"] = len(prev["text"].split())
            prev["last_sentence"] = beat["last_sentence"]
            prev["summary"] = prev["summary"].rstrip(".") + "; " + beat["summary"]
            merged_count += 1
        else:
            merged.append(beat)
    for i, b in enumerate(merged):
        b["beat_idx"] = i
    return merged, merged_count


def validate_beat(beat: dict) -> list[str]:
    """Return list of validation errors on a single beat (empty = valid)."""
    errors = []
    for f in REQUIRED_BEAT_FIELDS:
        if f not in beat:
            errors.append(f"missing field: {f}")
    if "words" in beat and not isinstance(beat["words"], int):
        errors.append(f"words must be int, got {type(beat['words']).__name__}")
    if "text" in beat and (not isinstance(beat["text"], str) or not beat["text"].strip()):
        errors.append("text is empty or not a string")
    return errors


def cmd_merge(args):
    results_dir = Path(args.results_dir)
    scenes = [json.loads(l) for l in open(args.scenes)]
    scene_map = {s["scene_id"]: s for s in scenes}
    expected_ids = set(scene_map.keys())

    result_files = sorted(results_dir.glob("*.json"))
    if not result_files:
        sys.exit(f"No result files in {results_dir}")

    all_beats = []
    report = {
        "scenes_expected": len(expected_ids),
        "scenes_processed": 0,
        "scenes_with_malformed_results": [],
        "scenes_with_zero_beats": [],
        "scenes_missing_results": [],
        "orphan_results": [],
        "per_scene": {},
        "total_beats_raw": 0,
        "total_beats_after_merge": 0,
        "total_beats_merged": 0,
    }

    processed_ids = set()
    for rf in result_files:
        try:
            data = json.load(open(rf))
        except Exception as e:
            report["scenes_with_malformed_results"].append({"file": str(rf), "error": str(e)})
            print(f"WARN: {rf.name} is not valid JSON: {e}", file=sys.stderr)
            continue

        scene_id = data.get("scene_id", rf.stem)
        raw_beats = data.get("beats", data if isinstance(data, list) else [])

        # Validate each beat
        errors_per_beat = []
        valid_beats = []
        for idx, beat in enumerate(raw_beats):
            errs = validate_beat(beat)
            if errs:
                errors_per_beat.append({"beat_idx": idx, "errors": errs})
            else:
                valid_beats.append(beat)

        if errors_per_beat:
            report["scenes_with_malformed_results"].append({
                "scene_id": scene_id,
                "file": str(rf),
                "errors": errors_per_beat,
            })
            print(f"WARN: {scene_id} had {len(errors_per_beat)} malformed beats (dropped)", file=sys.stderr)

        if not valid_beats:
            report["scenes_with_zero_beats"].append(scene_id)
            print(f"WARN: {scene_id} produced zero valid beats", file=sys.stderr)
            processed_ids.add(scene_id)
            continue

        raw_count = len(valid_beats)
        merged_beats, merged_count = merge_small_beats(valid_beats, args.min_words)

        scene_meta = scene_map.get(scene_id, {})
        for beat in merged_beats:
            beat["scene_id"] = scene_id
            beat["book"] = scene_meta.get("book", "unknown")
            beat["chapter"] = scene_meta.get("chapter", 0)

        all_beats.extend(merged_beats)
        processed_ids.add(scene_id)
        report["scenes_processed"] += 1
        report["total_beats_raw"] += raw_count
        report["total_beats_after_merge"] += len(merged_beats)
        report["total_beats_merged"] += merged_count
        report["per_scene"][scene_id] = {
            "raw_beats": raw_count,
            "merged_beats": len(merged_beats),
            "words": sum(b["words"] for b in merged_beats),
        }

        # Orphan detection: result exists but scene_id wasn't in the manifest
        if scene_id not in expected_ids:
            report["orphan_results"].append(scene_id)

    # Missing: scene_id was expected but no result landed
    missing = expected_ids - processed_ids
    report["scenes_missing_results"] = sorted(missing)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w") as f:
        for beat in all_beats:
            f.write(json.dumps(beat) + "\n")

    report_path = output.with_suffix(".merge-report.json")
    report_path.write_text(json.dumps(report, indent=2, default=str))

    word_counts = [b["words"] for b in all_beats]
    print(f"\n=== Beat Segmentation Results ===")
    print(f"Scenes expected: {report['scenes_expected']}")
    print(f"Scenes processed: {report['scenes_processed']}")
    print(f"Scenes missing results: {len(report['scenes_missing_results'])}")
    print(f"Scenes with malformed results: {len(report['scenes_with_malformed_results'])}")
    print(f"Scenes with zero valid beats: {len(report['scenes_with_zero_beats'])}")
    print(f"Orphan result files: {len(report['orphan_results'])}")
    print(f"Raw beats: {report['total_beats_raw']}")
    print(f"After merge (<{args.min_words}w): {report['total_beats_after_merge']} ({report['total_beats_merged']} merged)")
    if word_counts:
        print(f"Median beat size: {sorted(word_counts)[len(word_counts)//2]}w")
        print(f"Mean beat size: {sum(word_counts)/len(word_counts):.0f}w")
        print(f"Total words: {sum(word_counts):,}")
    print(f"Output: {output}")
    print(f"Report: {report_path}")


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
