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
import re
import statistics
from pathlib import Path

POV_ALIASES = {
    "Drizzt Do'Urden": "Drizzt",
    "Drizzt DoUrden": "Drizzt",
    "Bruenor Battlehammer": "Bruenor",
    "Akar Kessell": "Kessell",
    "Artemis Entreri": "Entreri",
    "Morkai the Red": "Morkai",
    "Dendybar the Mottled": "Dendybar",
}

SENSORY_WORDS = {
    "sight": {"saw", "seen", "see", "looked", "watched", "glanced", "stared", "gaze", "gazed",
              "glimpse", "glimpsed", "eyes", "eye", "sight", "vision", "visible", "dim", "bright",
              "dark", "shadow", "shadows", "glow", "glowed", "shone", "gleam", "gleamed",
              "flicker", "flickered", "shimmer", "shimmered", "blur", "blurred", "sparkle"},
    "sound": {"heard", "hear", "listen", "listened", "sound", "sounds", "noise", "silent",
              "silence", "quiet", "roar", "roared", "shout", "shouted", "whisper", "whispered",
              "scream", "screamed", "cry", "cried", "echo", "echoed", "rumble", "rumbled",
              "thunder", "crash", "crashed", "ring", "rang", "hiss", "hissed", "growl"},
    "touch": {"felt", "feel", "touch", "touched", "cold", "warm", "hot", "wet", "dry", "rough",
              "smooth", "hard", "soft", "sharp", "sting", "stung", "ache", "ached", "heavy",
              "weight", "pressed", "brush", "brushed", "grip", "gripped", "clenched", "shiver",
              "shivered", "tremble", "trembled", "chill", "icy", "freezing", "burned"},
    "smell": {"smell", "smelled", "scent", "odor", "stench", "stink", "stank", "fragrant",
              "sweet", "sour", "reek", "reeked"},
    "taste": {"taste", "tasted", "bitter", "sweet", "sour", "salt", "salty", "tang", "tangy"},
}
ALL_SENSORY = set()
for bucket in SENSORY_WORDS.values():
    ALL_SENSORY |= bucket

DIALOGUE_QUOTE_RE = re.compile(r'["\u201c\u201d]')
SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?])\s+(?=[A-Z"\u201c])')
CLAUSE_MARKER_RE = re.compile(r'[,;:]\s+\w')
WORD_RE = re.compile(r"\b[a-zA-Z']+\b")


def split_sentences(text: str) -> list[str]:
    text = text.replace("\n", " ").strip()
    if not text:
        return []
    parts = SENTENCE_SPLIT_RE.split(text)
    return [p.strip() for p in parts if p.strip()]


def compute_style(prose: str) -> dict:
    sentences = split_sentences(prose)
    if not sentences:
        return {
            "sentence_count": 0,
            "avg_sentence_words": 0.0,
            "sentence_length_std": 0.0,
            "max_sentence_words": 0,
            "dialogue_ratio": 0.0,
            "exclamation_count": 0,
            "question_count": 0,
            "clause_complexity": 0.0,
            "sensory_density": 0.0,
        }

    sent_word_counts = [len(WORD_RE.findall(s)) for s in sentences]
    total_words = sum(sent_word_counts) or 1

    dialogue_sents = sum(1 for s in sentences if DIALOGUE_QUOTE_RE.search(s))
    exclamations = sum(s.count("!") for s in sentences)
    questions = sum(s.count("?") for s in sentences)
    clause_sents = sum(1 for s in sentences if CLAUSE_MARKER_RE.search(s))

    lower_words = [w.lower() for w in WORD_RE.findall(prose)]
    sensory_hits = sum(1 for w in lower_words if w in ALL_SENSORY)

    return {
        "sentence_count": len(sentences),
        "avg_sentence_words": round(statistics.mean(sent_word_counts), 1),
        "sentence_length_std": round(statistics.pstdev(sent_word_counts), 1) if len(sent_word_counts) > 1 else 0.0,
        "max_sentence_words": max(sent_word_counts),
        "dialogue_ratio": round(dialogue_sents / len(sentences), 2),
        "exclamation_count": exclamations,
        "question_count": questions,
        "clause_complexity": round(clause_sents / len(sentences), 2),
        "sensory_density": round(sensory_hits * 100 / total_words, 2),
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
