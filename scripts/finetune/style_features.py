"""Shared style-feature computation for beat prose.

Used by tag-style.py (bulk corpus tagging) and validate-roundtrip.py
(reconstruction scoring).
"""

import re
import statistics

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
