#!/usr/bin/env python3
"""Extract beat briefs from segmented beats for training data.

prepare: writes batches of beats to per-batch prompt files + manifest with
         expected beat_ids.
merge:   cross-checks manifest against result files, validates brief schema,
         emits <output>.merge-report.json with missing/orphan/malformed stats.

Usage:
  python3 scripts/finetune/extract-briefs.py prepare \
    --beats scripts/lora-data/salvatore-1988-beats.jsonl \
    --prompt-dir /tmp/brief-prompts \
    --batch-size 10

  # Claude Code runs sub-agents → /tmp/brief-results/batch_NNN.json

  python3 scripts/finetune/extract-briefs.py merge \
    --beats scripts/lora-data/salvatore-1988-beats.jsonl \
    --results-dir /tmp/brief-results \
    --output scripts/lora-data/salvatore-1988-training-pairs.jsonl
"""

import argparse
import json
import sys
from pathlib import Path

PROMPT_TEMPLATE = """You are extracting structured beat briefs from R.A. Salvatore's Icewind Dale Trilogy for training data.

For each beat below, extract:
- **characters**: list of character names present or mentioned in action
- **pov**: the POV character (whose thoughts/perceptions we follow; "omniscient" if none)
- **setting**: brief location (e.g., "Bryn Shander gates", "dark alley in Easthaven", "tundra")
- **tone**: 1-3 words (e.g., "tense", "grim humor", "desperate fury")
- **transition_in**: how this beat connects FROM the previous beat. First beat of scene = "scene_start"

Return a JSON array with one object per beat:
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

REQUIRED_BRIEF_FIELDS = ["beat_id", "characters", "pov", "setting", "tone", "transition_in"]


def validate_brief(brief: dict) -> list[str]:
    errors = []
    for f in REQUIRED_BRIEF_FIELDS:
        if f not in brief:
            errors.append(f"missing field: {f}")
    if "characters" in brief and not isinstance(brief["characters"], list):
        errors.append(f"characters must be list, got {type(brief['characters']).__name__}")
    return errors


def cmd_prepare(args):
    beats = [json.loads(l) for l in open(args.beats)]
    prompt_dir = Path(args.prompt_dir)
    prompt_dir.mkdir(parents=True, exist_ok=True)

    batches = []
    batch = []
    for i, beat in enumerate(beats):
        beat_id = f"{beat['scene_id']}_b{beat['beat_idx']}"
        batch.append({
            "beat_id": beat_id,
            "beat_idx": beat["beat_idx"],
            "scene_id": beat["scene_id"],
            "kind": beat["kind"],
            "boundary_signal": beat["boundary_signal"],
            "summary": beat["summary"],
            "words": beat["words"],
            "text": beat["text"],
        })
        if len(batch) >= args.batch_size:
            batches.append(batch)
            batch = []
    if batch:
        batches.append(batch)

    for bi, b in enumerate(batches):
        block = ""
        for beat in b:
            block += f"\n### Beat: {beat['beat_id']} ({beat['words']}w, {beat['kind']})\n"
            block += f"Summary: {beat['summary']}\nText:\n{beat['text']}\n"
        (prompt_dir / f"batch_{bi:03d}.txt").write_text(PROMPT_TEMPLATE.format(beats_block=block))

    manifest = {
        "total_beats": len(beats),
        "batch_size": args.batch_size,
        "num_batches": len(batches),
        "expected_beat_ids": [b["beat_id"] for batch in batches for b in batch],
        "batches": [
            {"batch_idx": bi, "prompt_file": str(prompt_dir / f"batch_{bi:03d}.txt"),
             "beat_ids": [b["beat_id"] for b in batch], "num_beats": len(batch)}
            for bi, batch in enumerate(batches)
        ],
    }
    (prompt_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"Prepared {len(beats)} beats in {len(batches)} batches of {args.batch_size}")
    print(f"Manifest: {prompt_dir / 'manifest.json'}")


def cmd_merge(args):
    beats = [json.loads(l) for l in open(args.beats)]
    beat_map = {f"{b['scene_id']}_b{b['beat_idx']}": b for b in beats}
    expected_ids = set(beat_map.keys())

    results_dir = Path(args.results_dir)
    result_files = sorted(results_dir.glob("*.json"))
    if not result_files:
        sys.exit(f"No result files in {results_dir}")

    briefs = {}
    report = {
        "beats_expected": len(expected_ids),
        "result_files_read": 0,
        "malformed_result_files": [],
        "malformed_briefs": [],
        "orphan_briefs": [],
        "beats_without_brief": [],
    }

    for rf in result_files:
        try:
            data = json.load(open(rf))
        except Exception as e:
            report["malformed_result_files"].append({"file": str(rf), "error": str(e)})
            print(f"WARN: {rf.name} not valid JSON: {e}", file=sys.stderr)
            continue
        report["result_files_read"] += 1

        items = data if isinstance(data, list) else data.get("briefs", [])
        for item in items:
            errs = validate_brief(item)
            if errs:
                report["malformed_briefs"].append({"beat_id": item.get("beat_id", "?"), "errors": errs, "file": str(rf)})
                continue
            briefs[item["beat_id"]] = item

    training_pairs = []
    for beat_id, beat in beat_map.items():
        brief = briefs.get(beat_id)
        if not brief:
            report["beats_without_brief"].append(beat_id)
            continue
        training_pairs.append({
            "brief": {
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
            },
            "prose": beat["text"],
        })

    # Orphans: brief exists for a beat_id not in the beats file
    report["orphan_briefs"] = sorted(set(briefs.keys()) - expected_ids)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w") as f:
        for p in training_pairs:
            f.write(json.dumps(p) + "\n")

    report["training_pairs_written"] = len(training_pairs)
    report_path = output.with_suffix(".merge-report.json")
    report_path.write_text(json.dumps(report, indent=2, default=str))

    print(f"\n=== Training Pair Results ===")
    print(f"Beats expected: {report['beats_expected']}")
    print(f"Result files read: {report['result_files_read']}")
    print(f"Malformed result files: {len(report['malformed_result_files'])}")
    print(f"Malformed briefs: {len(report['malformed_briefs'])}")
    print(f"Orphan briefs (no matching beat): {len(report['orphan_briefs'])}")
    print(f"Beats without brief: {len(report['beats_without_brief'])}")
    print(f"Training pairs written: {len(training_pairs)}")
    print(f"Output: {output}")
    print(f"Report: {report_path}")


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
    if args.cmd == "prepare": cmd_prepare(args)
    elif args.cmd == "merge": cmd_merge(args)
    else: ap.print_help()


if __name__ == "__main__":
    main()
