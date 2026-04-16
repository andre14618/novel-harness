#!/usr/bin/env python3
"""Stage 5: Deterministic style tagging per beat.

Reads training pairs, computes per-beat style features, normalizes POV names,
and writes augmented training pairs. No LLM calls — pure regex/stats.

Features added to each brief:
  style.sentence_count
  style.avg_sentence_words
  style.sentence_length_std
  style.max_sentence_words
  style.dialogue_ratio       (0-1, fraction of sentences with quoted speech)
  style.exclamation_count
  style.question_count
  style.clause_complexity    (0-1, fraction of sentences with subordinate clauses)
  style.sensory_density      (per 100 words — hits on sight/sound/touch/smell/taste vocab)

POV normalization merges aliases (e.g. "Drizzt Do'Urden" → "Drizzt").

Usage:
  python3 scripts/finetune/tag-style.py \
    --input scripts/lora-data/salvatore-1988-training-pairs.jsonl \
    --output scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl
"""

import argparse
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from style_features import compute_style  # noqa: E402

POV_ALIASES = {
    "Drizzt Do'Urden": "Drizzt",
    "Drizzt DoUrden": "Drizzt",
    "Bruenor Battlehammer": "Bruenor",
    "Akar Kessell": "Kessell",
    "Artemis Entreri": "Entreri",
    "Morkai the Red": "Morkai",
    "Dendybar the Mottled": "Dendybar",
}


def normalize_character(name: str) -> str:
    return POV_ALIASES.get(name, name)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()

    pairs = [json.loads(l) for l in open(args.input)]
    tagged = []
    for pair in pairs:
        brief = dict(pair["brief"])
        brief["pov"] = normalize_character(brief.get("pov", "omniscient"))
        brief["characters"] = [normalize_character(c) for c in brief.get("characters", [])]
        seen = set()
        deduped = []
        for c in brief["characters"]:
            if c not in seen:
                seen.add(c)
                deduped.append(c)
        brief["characters"] = deduped
        brief["style"] = compute_style(pair["prose"])
        tagged.append({"brief": brief, "prose": pair["prose"]})

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        for p in tagged:
            f.write(json.dumps(p) + "\n")

    avg_sent = statistics.mean(p["brief"]["style"]["avg_sentence_words"] for p in tagged if p["brief"]["style"]["sentence_count"])
    avg_dial = statistics.mean(p["brief"]["style"]["dialogue_ratio"] for p in tagged)
    avg_sens = statistics.mean(p["brief"]["style"]["sensory_density"] for p in tagged)
    avg_clause = statistics.mean(p["brief"]["style"]["clause_complexity"] for p in tagged)

    print(f"=== Style Tagging Results ===")
    print(f"Tagged pairs: {len(tagged)}")
    print(f"Avg sentence length: {avg_sent:.1f}w")
    print(f"Avg dialogue ratio: {avg_dial:.2f}")
    print(f"Avg clause complexity: {avg_clause:.2f}")
    print(f"Avg sensory density: {avg_sens:.2f} hits/100w")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
