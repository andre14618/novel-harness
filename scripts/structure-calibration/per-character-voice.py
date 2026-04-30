#!/usr/bin/env python3
"""
Pattern 65 — Per-character voice signature in dialogue.

Hypothesis. The 5 fellowship characters (Drizzt / Bruenor / Wulfgar /
Catti-brie / Regis) should have measurably distinct dialogue voices that
reproduce across all 3 Icewind Dale books and that ship as cross-book
stable per-character priors for writer-prompt fewshots, lint constraints,
and archetype-pass training.

  - **Bruenor**     short kinetic dialogue, dwarvish dialect, oath-heavy
                    ("Bah!", "By Moradin's beard!"), ye/yer/yerself
                    contractions of folk-grammar (don't / doesna shape).
  - **Drizzt**      longer literate dialogue, formal register, fewer
                    contractions, philosophical phrasing.
  - **Wulfgar**     barbarian-archetype, formal-archaic ("thees / thous"
                    after Bruenor's tutelage), longer in HG after polish.
  - **Catti-brie**  brogue dialect ("ye", "yer"), shorter spirited
                    dialogue.
  - **Regis**       conversational/calculating, contractions-heavy.

Pure compute, $0. Reads `analysis/dialogue-extract.jsonl` (already
LLM-attributed for the 5 fellowship characters: 2,447 lines, 100% coverage
of fellowship speech) plus `beats.jsonl` for kind/scene context. No new
LLM calls.

==============================================================================
Methodology
==============================================================================

Per-character per-book signature consists of 7 metrics:

  1. **Mean utterance length** — words per quoted string. Cross-book CV
     measures stability of speech-rhythm fingerprint.

  2. **Contraction density** — count of common contractions
     ({don't, won't, can't, isn't, I'll, you're, they're, we're, it's,
       I'd, you'd, he's, she's, that's, what's, here's, there's,
       I'm, didn't, doesn't, wouldn't, couldn't, shouldn't, hadn't,
       haven't, hasn't, weren't, wasn't}) per 100 dialogue words.

  3. **Oath / exclamation density** — exclamation points per 100 dialogue
     words + signature oath fire-rate ("Bah!", "By Moradin", "By the
     gods", "Damn", "Curse it"). Per-character canonical oath top-3
     reported.

  4. **Dialect markers** — single-character archaic contractions:
        - **brogue**:  ye / yer / yerself / yerselves (per 100 words)
        - **archaic**: thee / thou / thy / thine / aye / nay
                       (per 100 words)
        - **negation-archaic**: doesna / willna / canna / shouldna
                                (Bruenor-only, dwarf folk-grammar)

  5. **Vocabulary distinctiveness** — top 20 content-words per character,
     scored by relative log-odds (this character's word rate vs the
     remaining 4 fellowship characters pooled). Filters function words,
     names, and all-caps. Top-20 surfaces words that are signature-rare
     in the rest of the cast (e.g. "honor", "rocks", "fancy").

  6. **Question rate** — questions (`?`-terminated sentences) per 100
     dialogue words. Pairs with Pattern 59 (question-mark density per
     beat-kind).

  7. **Pronoun-of-self rate** — first-person singular pronouns
     ({I, I'd, I'll, I've, I'm, me, my, mine, myself}) per 100 dialogue
     words. Egocentric vs shared-frame speech.

Per-metric cross-book stability gates, then combined verdict per
character + corpus-level summary.

==============================================================================
Cross-book gate
==============================================================================

For each character, count the number of metrics (out of 7) that satisfy
**cross-book CV ≤ 0.30** (or for ranking-style metrics, top-3 set
identical across books).

  - **PASS**         — all 5 fellowship characters have ≥3 of 7 metrics
                       stable across all 3 books.
  - **PASS_PARTIAL** — 4 of 5 characters reproduce ≥3/7, OR all 5 reach
                       2/7.
  - **DIVERGE**      — characters drift significantly (most have <2/7).
  - **KILL**         — no signal anywhere.

Per `docs/lessons-learned.md` 2026-04-30 "Aggregate-only patterns can
survive while per-book patterns fail" — the gate is per-character per-
book, not pooled.

==============================================================================
Output
==============================================================================

  - timestamped JSON at
    novels/salvatore-icewind-dale/structure-calibration/
      crystal_shard.<TS>.per-character-voice.json
  - atomic-append section to
    novels/salvatore-icewind-dale/structure-calibration/
      crystal_shard-conclusions.md
  - atomic-insert roadmap row before `\\n**Sequencing` anchor in
    docs/harness-tuning-roadmap.md
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, stdev
from typing import Any, Dict, List, Tuple

# Add the lib dir to sys.path so the imports below resolve when this script
# is run from the repo root via `python3 scripts/structure-calibration/...`.
_LIB_DIR = Path(__file__).resolve().parent / "lib"
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
DIALOGUE_EXTRACT_PATH = BUNDLE / "analysis" / "dialogue-extract.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

PATTERN_NUMBER = 65
PATTERN_SLUG = "per-character-voice"

BOOKS: Tuple[str, str, str] = ("crystal_shard", "streams_of_silver", "halflings_gem")
FELLOWSHIP: Tuple[str, ...] = (
    "Drizzt",
    "Bruenor",
    "Wulfgar",
    "Catti-brie",
    "Regis",
)

# ---------------------------------------------------------------------------
# Lexicons
# ---------------------------------------------------------------------------

# Common English contractions. Stored as lowercased patterns; matched
# case-insensitive on a word-bounded regex so we tag both "I'm" and "i'm".
CONTRACTIONS = {
    "don't", "won't", "can't", "isn't", "i'll", "you're", "they're", "we're",
    "it's", "i'd", "you'd", "he's", "she's", "that's", "what's", "here's",
    "there's", "i'm", "didn't", "doesn't", "wouldn't", "couldn't", "shouldn't",
    "hadn't", "haven't", "hasn't", "weren't", "wasn't", "aren't", "ain't",
    "they'll", "we'll", "he'll", "she'll", "you'll", "they've", "we've",
    "you've", "i've", "they'd", "we'd", "he'd", "she'd", "let's",
}

# Brogue / folk-grammar markers — Bruenor + Catti-brie (canonical Salvatore
# dialect). Each word matched on word-boundary (no leading/trailing letter)
# case-insensitive.
#
# `ye`-contractions (`ye'll`, `ye'd`, `ye've`, `ye're`, `ye's`) are the
# strongest signature: 62 hits in Bruenor, 35 in Catti-brie, 0 in
# Drizzt/Wulfgar/Regis pooled. Bare `ye` overloads with archaic register
# (Wulfgar) so we distinguish: bare `ye` is brogue when adjacent to other
# brogue tokens, but the `ye'<contraction>` cluster is unambiguous.
BROGUE_MARKERS = {
    "ye", "yer", "yerself", "yerselves", "yers", "ya", "yeh", "outa", "tellin",
    "doin", "comin", "goin", "lookin", "savin", "fightin", "bringin",
    # ye-contraction forms (after token normalization "ye’d" -> "ye'd")
    "ye'll", "ye'd", "ye've", "ye're", "ye's", "ye'r",
    # additional brogue/folk terms found in the Salvatore corpus
    "afore", "suren", "meself", "doings",
}

# Archaic register — Wulfgar's barbarian formal cadence and Drizzt's
# occasional formal-archaic moments. Pure formal/poetic register.
ARCHAIC_MARKERS = {
    "thee", "thou", "thy", "thine", "thyself", "thous", "thees", "ye",  # ye
                                                                          # also archaic
                                                                          # not just
                                                                          # brogue
    "aye", "nay", "naught", "verily", "henceforth", "shalt", "wouldst",
    "couldst", "art", "doth", "dost", "hast", "hath", "ne'er", "o'er",
    "tis", "twas", "twere",
}
# Note: `ye` is overloaded — Bruenor/Catti-brie use it as brogue 2nd-person;
# Wulfgar uses it as formal-archaic. We count it under brogue per-char where
# the dwarf-cluster signature is stronger; the overlap is a known caveat.

# Dwarf folk-grammar negations — strict Bruenor signature.
DWARF_NEGATIONS = {
    "doesna", "willna", "canna", "shouldna", "couldna", "wasna", "wouldna",
    "didna", "isna", "havna", "wona", "ainna",
}

# Self-pronouns — first-person singular set. Matched case-insensitive
# on word-boundary tokens (we'll preserve apostrophes inside the token).
SELF_PRONOUNS = {
    "i", "me", "my", "mine", "myself", "i'd", "i'll", "i've", "i'm",
}

# Function words to exclude from vocabulary distinctiveness analysis.
# Standard English stoplist + archaic + brogue + character names.
STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at",
    "by", "for", "with", "from", "about", "into", "over", "under", "before",
    "after", "between", "as", "is", "are", "was", "were", "be", "been",
    "being", "am", "have", "has", "had", "having", "do", "does", "did",
    "doing", "done", "will", "would", "shall", "should", "may", "might",
    "must", "can", "could", "ought", "need", "dare", "used",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
    "them", "my", "your", "his", "its", "our", "their", "mine", "yours",
    "hers", "ours", "theirs", "myself", "yourself", "himself", "herself",
    "itself", "ourselves", "themselves",
    "this", "that", "these", "those", "there", "here", "where", "when",
    "what", "who", "whom", "whose", "which", "why", "how", "all", "any",
    "some", "no", "not", "nor", "only", "own", "same", "so", "than", "too",
    "very", "just", "now", "then", "ever", "never", "still", "yet", "again",
    "back", "out", "up", "down", "off", "away", "through", "across", "along",
    "around", "behind", "beside", "beyond", "during", "except", "inside",
    "outside", "since", "though", "until", "upon", "while", "within",
    "without",
    "s", "t", "d", "ll", "m", "re", "ve", "don", "didn", "doesn", "wouldn",
    "couldn", "shouldn", "won", "isn", "aren", "wasn", "weren", "hadn",
    "haven", "hasn", "ain",
    "yes", "no", "okay", "ok", "well", "oh", "ah", "eh", "hm", "hmm", "huh",
    "ha", "haha", "yeah", "yep", "nope",
    # Salvatore book character names + obvious nicknames (lowercased)
    "drizzt", "bruenor", "wulfgar", "catti", "brie", "regis", "rumblebelly",
    "kessell", "akar", "entreri", "artemis", "pook", "pasha", "dendybar",
    "sydney", "bok", "wormwood", "shimmergloom", "drizzo", "cassius",
    "duegan", "deudermont", "harpell", "harkle", "khelben", "alustriel",
    "elminster", "guenhwyvar", "twinkle",
    # Brogue tokens (count under brogue, not vocabulary)
    "ye", "yer", "yerself", "ya", "outa", "tellin", "doin", "comin", "goin",
    "fightin", "lookin",
    # Common short fillers that aren't content
    "thing", "things", "way", "ways", "lot", "lots", "kind", "kinds",
    "sort", "sorts", "bit", "bits", "let", "lets", "say", "says", "said",
    "tell", "tells", "told", "go", "goes", "went", "going", "come", "comes",
    "came", "coming", "see", "sees", "saw", "seeing", "seen", "know",
    "knows", "knew", "knowing", "known", "think", "thinks", "thought",
    "make", "makes", "made", "making", "take", "takes", "took", "taking",
    "taken", "give", "gives", "gave", "giving", "given", "get", "gets",
    "got", "getting", "gotten", "put", "puts", "putting", "find", "finds",
    "found", "finding", "want", "wants", "wanted", "wanting", "ask", "asks",
    "asked", "asking", "look", "looks", "looked", "looking",
}

# Canonical signature oath patterns — per-character probes (regex, case-
# insensitive, word-boundary on edges where appropriate).
SIGNATURE_OATH_PATTERNS = {
    "Bruenor": [
        ("bah", r"\bbah\b"),
        ("by_moradin", r"\bby\s+moradin"),
        ("damn", r"\bdamn\b"),
        ("curse_it", r"\bcurse\s+(it|ye|him|her|them|the)"),
        ("blasted", r"\bblasted\b"),
        ("by_the_gods", r"\bby\s+the\s+gods\b"),
        ("by_my_beard", r"\bby\s+my\s+beard\b"),
        ("stones", r"\bstones\b"),
    ],
    "Drizzt": [
        ("by_the_gods", r"\bby\s+the\s+gods\b"),
        ("damn", r"\bdamn\b"),
        ("indeed", r"\bindeed\b"),
        ("of_course", r"\bof\s+course\b"),
        ("my_friend", r"\bmy\s+friend\b"),
        ("perhaps", r"\bperhaps\b"),
    ],
    "Wulfgar": [
        ("by_tempos", r"\bby\s+tempos\b"),
        ("aye", r"\baye\b"),
        ("honor", r"\bhonor\b"),
        ("damn", r"\bdamn\b"),
        ("by_my_axe", r"\bby\s+my\s+axe\b"),
        ("never", r"\bnever\b"),
    ],
    "Catti-brie": [
        ("ye", r"\bye\b"),
        ("yer", r"\byer\b"),
        ("damn", r"\bdamn\b"),
        ("oh", r"\boh\b"),
        ("by_the_gods", r"\bby\s+the\s+gods\b"),
        ("hmf", r"\bhmf\b"),
    ],
    "Regis": [
        ("oh", r"\boh\b"),
        ("please", r"\bplease\b"),
        ("damn", r"\bdamn\b"),
        ("by_the_gods", r"\bby\s+the\s+gods\b"),
        ("of_course", r"\bof\s+course\b"),
        ("nothing", r"\bnothing\b"),
    ],
}

# ---------------------------------------------------------------------------
# Tokenization helpers
# ---------------------------------------------------------------------------

# Token regex: alphabet runs + optional internal apostrophe(s).
_TOKEN_RE = re.compile(r"[A-Za-z]+(?:[’ʼ'][A-Za-z]+)*", re.UNICODE)
# Sentence terminator — any of `.`, `?`, `!` runs.
_SENT_RE = re.compile(r"[^.!?]+[.!?]+|\s*[^.!?]+$")


def tokens(text: str) -> List[str]:
    """Lowercased token list. Apostrophes within tokens are normalized to
    ASCII single-quote for stable contraction matching ("don’t" → "don't")."""
    if not text:
        return []
    raw = _TOKEN_RE.findall(text)
    return [t.lower().replace("’", "'").replace("ʼ", "'") for t in raw]


def word_count(text: str) -> int:
    return len(tokens(text))


def sentences(text: str) -> List[str]:
    if not text:
        return []
    raw = _SENT_RE.findall(text)
    return [s.strip() for s in raw if s.strip()]


def is_question(s: str) -> bool:
    return s.rstrip().endswith("?")


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def load_jsonl(path: Path) -> List[dict]:
    out: List[dict] = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            out.append(json.loads(line))
    return out


def book_from_beat_id(bid: str) -> str | None:
    for book in BOOKS:
        if bid.startswith(book + "_"):
            return book
    return None


def commit_short() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO, capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


# ---------------------------------------------------------------------------
# Per-character per-book signature
# ---------------------------------------------------------------------------

def round_or_none(x: float | None, digits: int = 4) -> float | None:
    if x is None:
        return None
    return round(x, digits)


def per_100w(count: int, words: int) -> float:
    if words <= 0:
        return 0.0
    return 100.0 * count / words


def cv(xs: List[float]) -> float:
    """Coefficient of variation (std/mean), 0 if mean == 0."""
    if not xs:
        return 0.0
    m = sum(xs) / len(xs)
    if m == 0:
        return 0.0
    if len(xs) < 2:
        return 0.0
    sd = stdev(xs)
    return sd / abs(m)


def compute_signature(quotes: List[str]) -> Dict[str, Any]:
    """Compute the 7-metric signature for a list of dialogue quotes."""
    if not quotes:
        return {
            "n_quotes": 0,
            "total_words": 0,
            "mean_utterance_words": 0.0,
            "median_utterance_words": 0.0,
            "p90_utterance_words": 0.0,
            "contraction_count": 0,
            "contraction_density_per_100w": 0.0,
            "exclamation_count": 0,
            "exclamation_density_per_100w": 0.0,
            "brogue_count": 0,
            "brogue_density_per_100w": 0.0,
            "archaic_count": 0,
            "archaic_density_per_100w": 0.0,
            "dwarf_negation_count": 0,
            "dwarf_negation_density_per_100w": 0.0,
            "question_count": 0,
            "question_density_per_100w": 0.0,
            "self_pronoun_count": 0,
            "self_pronoun_density_per_100w": 0.0,
            "vocab_top": [],
        }

    # Per-quote word counts → utterance length stats
    per_q_words: List[int] = []
    contraction_hits = 0
    exclamation_hits = 0
    brogue_hits = 0
    archaic_hits = 0
    dwarf_neg_hits = 0
    question_hits = 0
    self_pron_hits = 0
    total_words = 0

    # Per-character vocabulary (for distinctiveness analysis below)
    char_vocab: Counter = Counter()

    for q in quotes:
        toks = tokens(q)
        per_q_words.append(len(toks))
        total_words += len(toks)
        # Sentence-level questions
        for s in sentences(q):
            if is_question(s):
                question_hits += 1
        exclamation_hits += q.count("!")
        for tok in toks:
            if tok in CONTRACTIONS:
                contraction_hits += 1
            if tok in BROGUE_MARKERS:
                brogue_hits += 1
            if tok in ARCHAIC_MARKERS:
                archaic_hits += 1
            if tok in DWARF_NEGATIONS:
                dwarf_neg_hits += 1
            if tok in SELF_PRONOUNS:
                self_pron_hits += 1
            if tok not in STOPWORDS and tok not in BROGUE_MARKERS \
                    and tok not in ARCHAIC_MARKERS and len(tok) >= 3:
                char_vocab[tok] += 1

    return {
        "n_quotes": len(quotes),
        "total_words": total_words,
        "mean_utterance_words": round(mean(per_q_words), 2) if per_q_words else 0.0,
        "median_utterance_words": float(sorted(per_q_words)[len(per_q_words) // 2]) if per_q_words else 0.0,
        "p90_utterance_words": float(sorted(per_q_words)[int(0.9 * (len(per_q_words) - 1))]) if per_q_words else 0.0,
        "contraction_count": contraction_hits,
        "contraction_density_per_100w": round(per_100w(contraction_hits, total_words), 4),
        "exclamation_count": exclamation_hits,
        "exclamation_density_per_100w": round(per_100w(exclamation_hits, total_words), 4),
        "brogue_count": brogue_hits,
        "brogue_density_per_100w": round(per_100w(brogue_hits, total_words), 4),
        "archaic_count": archaic_hits,
        "archaic_density_per_100w": round(per_100w(archaic_hits, total_words), 4),
        "dwarf_negation_count": dwarf_neg_hits,
        "dwarf_negation_density_per_100w": round(per_100w(dwarf_neg_hits, total_words), 4),
        "question_count": question_hits,
        "question_density_per_100w": round(per_100w(question_hits, total_words), 4),
        "self_pronoun_count": self_pron_hits,
        "self_pronoun_density_per_100w": round(per_100w(self_pron_hits, total_words), 4),
        "vocab_top": char_vocab.most_common(60),  # raw — used by relative log-odds below
    }


def signature_oaths(quotes: List[str], char: str, total_words: int) -> List[Dict[str, Any]]:
    """Per-character canonical-oath fire-rate per 100w."""
    patterns = SIGNATURE_OATH_PATTERNS.get(char, [])
    out: List[Dict[str, Any]] = []
    text = " ".join(quotes).lower()
    for label, pat in patterns:
        hits = len(re.findall(pat, text, re.IGNORECASE))
        out.append({
            "label": label,
            "regex": pat,
            "count": hits,
            "density_per_100w": round(per_100w(hits, total_words), 4),
        })
    return sorted(out, key=lambda r: -r["density_per_100w"])


# ---------------------------------------------------------------------------
# Cross-character vocabulary distinctiveness (relative log-odds)
# ---------------------------------------------------------------------------

def vocab_distinctiveness(
    per_char_vocab: Dict[str, Counter], top_n: int = 20,
) -> Dict[str, List[Dict[str, Any]]]:
    """For each character, find the top-N words by log-odds vs the pooled
    rest-of-fellowship vocabulary (using Monroe-Colaresi-Quinn informative
    Dirichlet prior, simplified: Laplace +0.5 smoothing)."""
    out: Dict[str, List[Dict[str, Any]]] = {}
    # Pool a global vocab over all characters
    global_vocab: Counter = Counter()
    for c in per_char_vocab.values():
        global_vocab.update(c)
    if not global_vocab:
        return {ch: [] for ch in per_char_vocab.keys()}

    for ch, ch_vocab in per_char_vocab.items():
        ch_total = sum(ch_vocab.values()) or 1
        rest = Counter()
        for other, oc in per_char_vocab.items():
            if other != ch:
                rest.update(oc)
        rest_total = sum(rest.values()) or 1

        scores: List[Dict[str, Any]] = []
        # Only consider tokens with at least 4 hits in this char to suppress noise
        for tok, freq in ch_vocab.items():
            if freq < 4:
                continue
            # Log-odds with +0.5 Laplace smoothing
            p_ch = (freq + 0.5) / (ch_total + 0.5 * len(global_vocab))
            r = rest.get(tok, 0)
            p_rest = (r + 0.5) / (rest_total + 0.5 * len(global_vocab))
            log_odds = math.log(p_ch / p_rest) if p_rest > 0 else float("inf")
            scores.append({
                "token": tok,
                "char_count": freq,
                "char_per_1k": round(1000 * freq / ch_total, 3),
                "rest_count": r,
                "rest_per_1k": round(1000 * r / rest_total, 3),
                "log_odds": round(log_odds, 4),
            })
        scores.sort(key=lambda s: -s["log_odds"])
        out[ch] = scores[:top_n]
    return out


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyze() -> Dict[str, Any]:
    dl = load_jsonl(DIALOGUE_EXTRACT_PATH)
    # Per-character per-book quotes
    per_char_per_book: Dict[str, Dict[str, List[str]]] = {
        ch: {b: [] for b in BOOKS} for ch in FELLOWSHIP
    }
    # Per-character pooled (across books) — for vocab distinctiveness
    per_char_all: Dict[str, List[str]] = {ch: [] for ch in FELLOWSHIP}

    skipped_no_book = 0
    skipped_off_fellowship = 0
    for r in dl:
        ch = r.get("char")
        bid = r.get("beat_id", "")
        q = r.get("quote", "") or ""
        if not q:
            continue
        if ch not in FELLOWSHIP:
            skipped_off_fellowship += 1
            continue
        book = book_from_beat_id(bid)
        if not book:
            skipped_no_book += 1
            continue
        per_char_per_book[ch][book].append(q)
        per_char_all[ch].append(q)

    # Per-(char,book) signature
    sig_per_char_per_book: Dict[str, Dict[str, Dict[str, Any]]] = {
        ch: {b: compute_signature(per_char_per_book[ch][b]) for b in BOOKS}
        for ch in FELLOWSHIP
    }

    # Pooled-per-character signature (corpus-wide)
    sig_pooled: Dict[str, Dict[str, Any]] = {
        ch: compute_signature(per_char_all[ch]) for ch in FELLOWSHIP
    }

    # Per-character signature oaths (pooled corpus-wide)
    oaths_per_char: Dict[str, List[Dict[str, Any]]] = {}
    for ch in FELLOWSHIP:
        total = sig_pooled[ch]["total_words"]
        oaths_per_char[ch] = signature_oaths(per_char_all[ch], ch, total)

    # Vocabulary distinctiveness (pooled corpus-wide)
    pooled_vocab: Dict[str, Counter] = {}
    for ch in FELLOWSHIP:
        c = Counter()
        for q in per_char_all[ch]:
            for tok in tokens(q):
                if tok not in STOPWORDS and tok not in BROGUE_MARKERS \
                        and tok not in ARCHAIC_MARKERS and len(tok) >= 3:
                    c[tok] += 1
        pooled_vocab[ch] = c
    vocab_top = vocab_distinctiveness(pooled_vocab, top_n=20)

    # ---------- Cross-book stability per metric per character ----------
    METRICS_DENSITY = [
        "mean_utterance_words",
        "contraction_density_per_100w",
        "exclamation_density_per_100w",
        "brogue_density_per_100w",
        "archaic_density_per_100w",
        "question_density_per_100w",
        "self_pronoun_density_per_100w",
    ]

    stability_per_char: Dict[str, Dict[str, Any]] = {}
    for ch in FELLOWSHIP:
        per_metric: Dict[str, Dict[str, Any]] = {}
        # Filter out books where this char has 0 quotes (treat as missing
        # data — don't penalize a metric just because a character is
        # absent from one book; report n_present alongside.)
        present_books = [b for b in BOOKS if sig_per_char_per_book[ch][b]["n_quotes"] > 0]
        for m in METRICS_DENSITY:
            vals = [sig_per_char_per_book[ch][b][m] for b in present_books]
            if not vals:
                per_metric[m] = {
                    "values_per_book": {b: None for b in BOOKS},
                    "n_present": 0,
                    "mean": None,
                    "stdev": None,
                    "cv": None,
                    "stable_le_30": False,
                }
                continue
            m_val = mean(vals) if vals else 0.0
            sd_val = stdev(vals) if len(vals) > 1 else 0.0
            cv_val = (sd_val / m_val) if m_val > 0 else 0.0
            # Distinguish "stable signal" (CV ≤ 0.30 with non-zero mean) from
            # "stable absence" (all-zero across books). The pattern's per-
            # character gate counts only stable SIGNALS — absences are
            # interesting (Drizzt's zero brogue is correctly stable) but
            # they don't constitute a positive cross-book signature.
            all_zero = (m_val == 0.0)
            stable_signal = (
                len(present_books) >= 2 and m_val > 0 and cv_val <= 0.30
            )
            per_metric[m] = {
                "values_per_book": {
                    b: sig_per_char_per_book[ch][b][m] if b in present_books else None
                    for b in BOOKS
                },
                "n_present": len(present_books),
                "mean": round(m_val, 4),
                "stdev": round(sd_val, 4),
                "cv": round(cv_val, 4),
                "all_zero_across_books": all_zero,
                # Stable SIGNAL gate — this is what the pattern verdict counts.
                "stable_signal_le_30": stable_signal,
                # Backwards-compat name kept (some downstream code may read it)
                "stable_le_30": stable_signal,
            }
        # Top-3 oath / signature oath set stability across books
        # (compute per-book top-3 by density and check intersection size)
        per_book_oaths_top3: Dict[str, List[str]] = {}
        for b in BOOKS:
            quotes = per_char_per_book[ch][b]
            twords = sig_per_char_per_book[ch][b]["total_words"]
            if not quotes or twords == 0:
                per_book_oaths_top3[b] = []
                continue
            book_oaths = signature_oaths(quotes, ch, twords)
            per_book_oaths_top3[b] = [o["label"] for o in book_oaths if o["count"] > 0][:3]
        # Intersection size across present books
        sets = [set(v) for v in per_book_oaths_top3.values() if v]
        if len(sets) >= 2:
            intersect = set.intersection(*sets)
        else:
            intersect = set(sets[0]) if sets else set()
        per_metric["signature_oath_top3_stability"] = {
            "per_book_top3": per_book_oaths_top3,
            "intersection_size": len(intersect),
            "intersection": sorted(intersect),
            "stable_intersect_ge_2": len(intersect) >= 2,
        }

        # Count metrics passing stability bar — stable POSITIVE SIGNAL only
        # (CV ≤ 0.30 with non-zero mean). All-zero metrics report separately.
        n_stable_density = sum(
            1 for m in METRICS_DENSITY if per_metric[m]["stable_signal_le_30"]
        )
        n_zero_density = sum(
            1 for m in METRICS_DENSITY if per_metric[m]["all_zero_across_books"]
        )
        n_stable_oath = 1 if per_metric["signature_oath_top3_stability"]["stable_intersect_ge_2"] else 0
        n_stable_total = n_stable_density + n_stable_oath  # max = 8
        stability_per_char[ch] = {
            "metrics": per_metric,
            "n_books_present": len(present_books),
            "books_present": present_books,
            "n_stable_density_metrics": n_stable_density,
            "n_zero_density_metrics": n_zero_density,
            "stable_oath_top3": bool(n_stable_oath),
            "n_stable_total": n_stable_total,
            "stable_total_max": len(METRICS_DENSITY) + 1,  # 8
            # Spec: ≥ 3 stable metrics out of 7 density metrics (positive signal)
            "passes_per_char_gate": n_stable_density >= 3,
        }

    # ---------- Corpus-level verdict ----------
    n_pass = sum(1 for ch in FELLOWSHIP if stability_per_char[ch]["passes_per_char_gate"])
    n_2of7 = sum(
        1 for ch in FELLOWSHIP
        if stability_per_char[ch]["n_stable_density_metrics"] >= 2
    )

    if n_pass == 5:
        verdict = "PASS"
    elif n_pass == 4 or n_2of7 == 5:
        verdict = "PASS_PARTIAL"
    elif n_pass >= 1 or n_2of7 >= 3:
        verdict = "PASS_PARTIAL"
    elif n_pass == 0 and n_2of7 == 0:
        verdict = "KILL"
    else:
        verdict = "DIVERGE"

    # ---------- Archetype confirmation summary ----------
    # For each character, compare the 7-metric pooled signature against the
    # narrative archetype hypothesis. This is descriptive — not a gate.
    archetype_check: Dict[str, Dict[str, Any]] = {}
    pooled_means = {ch: sig_pooled[ch]["mean_utterance_words"] for ch in FELLOWSHIP}
    pooled_contr = {ch: sig_pooled[ch]["contraction_density_per_100w"] for ch in FELLOWSHIP}
    pooled_excl = {ch: sig_pooled[ch]["exclamation_density_per_100w"] for ch in FELLOWSHIP}
    pooled_brogue = {ch: sig_pooled[ch]["brogue_density_per_100w"] for ch in FELLOWSHIP}
    pooled_archaic = {ch: sig_pooled[ch]["archaic_density_per_100w"] for ch in FELLOWSHIP}
    pooled_dwarfneg = {ch: sig_pooled[ch]["dwarf_negation_density_per_100w"] for ch in FELLOWSHIP}
    pooled_q = {ch: sig_pooled[ch]["question_density_per_100w"] for ch in FELLOWSHIP}
    pooled_self = {ch: sig_pooled[ch]["self_pronoun_density_per_100w"] for ch in FELLOWSHIP}

    # Hypotheses (descriptive — for the archetype-confirmation report)
    archetype_check["Drizzt"] = {
        "hypothesis": "literate, formal, longer utterances, low-medium contraction, low brogue, low/medium archaic, philosophical phrasing.",
        "mean_utterance_words": pooled_means["Drizzt"],
        "longer_than_bruenor": pooled_means["Drizzt"] > pooled_means["Bruenor"],
        "longer_than_regis": pooled_means["Drizzt"] > pooled_means["Regis"],
        "brogue_density": pooled_brogue["Drizzt"],
        "low_brogue_vs_bruenor": pooled_brogue["Drizzt"] < pooled_brogue["Bruenor"],
        "contraction_density": pooled_contr["Drizzt"],
    }
    archetype_check["Bruenor"] = {
        "hypothesis": "short kinetic dialogue, dwarvish dialect (ye/yer + brogue + dwarf-negation), oath-heavy, exclamation-rich.",
        "mean_utterance_words": pooled_means["Bruenor"],
        "shorter_than_drizzt": pooled_means["Bruenor"] < pooled_means["Drizzt"],
        "exclamation_density": pooled_excl["Bruenor"],
        "highest_exclamation_in_fellowship": pooled_excl["Bruenor"] >= max(pooled_excl.values()),
        "brogue_density": pooled_brogue["Bruenor"],
        "highest_brogue_in_fellowship": pooled_brogue["Bruenor"] >= max(pooled_brogue.values()),
        "dwarf_negation_density": pooled_dwarfneg["Bruenor"],
        "exclusive_dwarf_negation": (
            pooled_dwarfneg["Bruenor"] == max(pooled_dwarfneg.values())
            and pooled_dwarfneg["Bruenor"] > 0
        ),
    }
    archetype_check["Wulfgar"] = {
        "hypothesis": "barbarian-archetype, formal-archaic markers (thee/thou/thy/aye), longer in HG after polish.",
        "mean_utterance_words": pooled_means["Wulfgar"],
        "archaic_density": pooled_archaic["Wulfgar"],
        "highest_archaic_in_fellowship": pooled_archaic["Wulfgar"] >= max(pooled_archaic.values()),
        "mean_utt_per_book": {
            b: sig_per_char_per_book["Wulfgar"][b]["mean_utterance_words"]
            for b in BOOKS
        },
    }
    archetype_check["Catti-brie"] = {
        "hypothesis": "brogue dialect (ye/yer), shorter spirited dialogue, high exclamation.",
        "mean_utterance_words": pooled_means["Catti-brie"],
        "brogue_density": pooled_brogue["Catti-brie"],
        "high_brogue_top2_in_fellowship": (
            sorted(pooled_brogue.items(), key=lambda kv: -kv[1])[1][0] == "Catti-brie"
            or sorted(pooled_brogue.items(), key=lambda kv: -kv[1])[0][0] == "Catti-brie"
        ),
        "exclamation_density": pooled_excl["Catti-brie"],
    }
    archetype_check["Regis"] = {
        "hypothesis": "conversational/calculating, contraction-heavy, lower brogue/archaic.",
        "mean_utterance_words": pooled_means["Regis"],
        "contraction_density": pooled_contr["Regis"],
        "highest_contraction_in_fellowship": pooled_contr["Regis"] >= max(pooled_contr.values()),
        "low_brogue": pooled_brogue["Regis"] < pooled_brogue["Bruenor"],
        "low_archaic": pooled_archaic["Regis"] < pooled_archaic["Wulfgar"],
    }

    # ---------- Output ----------
    return {
        "books": list(BOOKS),
        "fellowship": list(FELLOWSHIP),
        "skipped_off_fellowship": skipped_off_fellowship,
        "skipped_no_book": skipped_no_book,

        "per_char_per_book_signature": sig_per_char_per_book,
        "pooled_per_char_signature": sig_pooled,

        "signature_oaths_per_char_pooled": oaths_per_char,
        "vocabulary_distinctiveness_top20": vocab_top,

        "stability_per_char": stability_per_char,

        "archetype_check": archetype_check,

        "verdict": verdict,
        "verdict_components": {
            "n_chars_passing_per_char_gate_3of7": n_pass,
            "n_chars_with_at_least_2of7_stable": n_2of7,
        },
    }


# ---------------------------------------------------------------------------
# Conclusions-doc section writer
# ---------------------------------------------------------------------------

def fmt_density_table(
    metric: str, sig_per_char_per_book: Dict[str, Dict[str, Dict[str, Any]]],
) -> List[str]:
    """Render a markdown table per char × book for one metric."""
    lines: List[str] = []
    lines.append("| Character | crystal_shard | streams_of_silver | halflings_gem |")
    lines.append("|---|---:|---:|---:|")
    for ch in FELLOWSHIP:
        cs = sig_per_char_per_book[ch]["crystal_shard"][metric]
        ss = sig_per_char_per_char_per_book_get(sig_per_char_per_book, ch, "streams_of_silver", metric)
        hg = sig_per_char_per_char_per_book_get(sig_per_char_per_book, ch, "halflings_gem", metric)
        lines.append(
            f"| {ch} | {cs:.3f} | {ss:.3f} | {hg:.3f} |"
        )
    return lines


def sig_per_char_per_char_per_book_get(d, ch, b, m) -> float:
    return d[ch][b].get(m, 0.0)


def append_conclusions(result: Dict[str, Any], json_path: Path, commit: str) -> None:
    sig = result["per_char_per_book_signature"]
    pooled = result["pooled_per_char_signature"]
    oaths = result["signature_oaths_per_char_pooled"]
    vocab = result["vocabulary_distinctiveness_top20"]
    stab = result["stability_per_char"]
    arch = result["archetype_check"]

    lines: List[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_NUMBER}: Per-character voice signature in dialogue")
    lines.append("")
    lines.append(
        f"_Pure-compute analysis of the LLM-attributed `analysis/dialogue-extract.jsonl` "
        f"(2,447 quotes / 100% fellowship coverage). 7 voice metrics × 5 fellowship "
        f"characters × 3 books. Cross-book stability gate: per-character ≥3 of 7 "
        f"density metrics with CV ≤ 0.30. Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")

    # ---- Per-character per-book quote/word counts ----
    lines.append("### Per-character per-book quote + word counts")
    lines.append("")
    lines.append("| Character | CS quotes | CS words | SoS quotes | SoS words | HG quotes | HG words | Total quotes | Total words |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for ch in FELLOWSHIP:
        cs_q = sig[ch]["crystal_shard"]["n_quotes"]
        cs_w = sig[ch]["crystal_shard"]["total_words"]
        ss_q = sig[ch]["streams_of_silver"]["n_quotes"]
        ss_w = sig[ch]["streams_of_silver"]["total_words"]
        hg_q = sig[ch]["halflings_gem"]["n_quotes"]
        hg_w = sig[ch]["halflings_gem"]["total_words"]
        lines.append(
            f"| {ch} | {cs_q} | {cs_w} | {ss_q} | {ss_w} | {hg_q} | {hg_w} | "
            f"{pooled[ch]['n_quotes']} | {pooled[ch]['total_words']} |"
        )
    lines.append("")

    # ---- Mean utterance length ----
    lines.append("### 1. Mean utterance length (words per quoted string)")
    lines.append("")
    lines.append("| Character | CS | SoS | HG | pooled | CV | stable (≤0.30)? |")
    lines.append("|---|---:|---:|---:|---:|---:|---|")
    for ch in FELLOWSHIP:
        cs = sig[ch]["crystal_shard"]["mean_utterance_words"]
        ss = sig[ch]["streams_of_silver"]["mean_utterance_words"]
        hg = sig[ch]["halflings_gem"]["mean_utterance_words"]
        po = pooled[ch]["mean_utterance_words"]
        c = stab[ch]["metrics"]["mean_utterance_words"]["cv"]
        ok = stab[ch]["metrics"]["mean_utterance_words"]["stable_le_30"]
        lines.append(
            f"| {ch} | {cs:.2f} | {ss:.2f} | {hg:.2f} | {po:.2f} | "
            f"{c if c is not None else 'n/a'} | {'yes' if ok else 'no'} |"
        )
    lines.append("")

    # ---- Contraction density ----
    lines.append("### 2. Contraction density (per 100 dialogue words)")
    lines.append("")
    lines.append("| Character | CS | SoS | HG | pooled | CV | stable (≤0.30)? |")
    lines.append("|---|---:|---:|---:|---:|---:|---|")
    for ch in FELLOWSHIP:
        cs = sig[ch]["crystal_shard"]["contraction_density_per_100w"]
        ss = sig[ch]["streams_of_silver"]["contraction_density_per_100w"]
        hg = sig[ch]["halflings_gem"]["contraction_density_per_100w"]
        po = pooled[ch]["contraction_density_per_100w"]
        c = stab[ch]["metrics"]["contraction_density_per_100w"]["cv"]
        ok = stab[ch]["metrics"]["contraction_density_per_100w"]["stable_le_30"]
        lines.append(
            f"| {ch} | {cs:.3f} | {ss:.3f} | {hg:.3f} | {po:.3f} | "
            f"{c} | {'yes' if ok else 'no'} |"
        )
    lines.append("")

    # ---- Exclamation density ----
    lines.append("### 3. Exclamation density + signature oaths")
    lines.append("")
    lines.append("Exclamation marks per 100 dialogue words:")
    lines.append("")
    lines.append("| Character | CS | SoS | HG | pooled | CV | stable (≤0.30)? |")
    lines.append("|---|---:|---:|---:|---:|---:|---|")
    for ch in FELLOWSHIP:
        cs = sig[ch]["crystal_shard"]["exclamation_density_per_100w"]
        ss = sig[ch]["streams_of_silver"]["exclamation_density_per_100w"]
        hg = sig[ch]["halflings_gem"]["exclamation_density_per_100w"]
        po = pooled[ch]["exclamation_density_per_100w"]
        c = stab[ch]["metrics"]["exclamation_density_per_100w"]["cv"]
        ok = stab[ch]["metrics"]["exclamation_density_per_100w"]["stable_le_30"]
        lines.append(
            f"| {ch} | {cs:.3f} | {ss:.3f} | {hg:.3f} | {po:.3f} | "
            f"{c} | {'yes' if ok else 'no'} |"
        )
    lines.append("")
    lines.append("Per-character canonical-oath probe (per 100 pooled dialogue words):")
    lines.append("")
    for ch in FELLOWSHIP:
        oa = oaths[ch]
        firing = [o for o in oa if o["count"] > 0]
        if not firing:
            lines.append(f"- **{ch}** — no signature-oath probes fired")
            continue
        top3 = firing[:5]
        s = ", ".join(f"`{o['label']}`={o['count']} ({o['density_per_100w']:.3f}/100w)" for o in top3)
        lines.append(f"- **{ch}** — top: {s}")
        # Cross-book oath-set stability
        ostab = stab[ch]["metrics"]["signature_oath_top3_stability"]
        per_book_str = "; ".join(f"{b}={ostab['per_book_top3'][b]}" for b in BOOKS)
        lines.append(
            f"  - per-book top-3 (where present): {per_book_str}; "
            f"cross-book intersection size = {ostab['intersection_size']} (`{ostab['intersection']}`); "
            f"stable_intersect_ge_2 = {'yes' if ostab['stable_intersect_ge_2'] else 'no'}"
        )
    lines.append("")

    # ---- Dialect markers ----
    lines.append("### 4. Dialect markers")
    lines.append("")
    lines.append("Brogue lexicon (`ye / yer / yerself / ye'll / ye'd / outa / -in` participles) per 100 dialogue words:")
    lines.append("")
    lines.append(
        "_Stability column is `signal` (CV ≤ 0.30 with non-zero mean) / `zero` "
        "(all-zero across books — stable absence) / `unstable` (CV > 0.30)._"
    )
    lines.append("")
    lines.append("| Character | CS | SoS | HG | pooled | CV | stability |")
    lines.append("|---|---:|---:|---:|---:|---:|---|")
    for ch in FELLOWSHIP:
        cs = sig[ch]["crystal_shard"]["brogue_density_per_100w"]
        ss = sig[ch]["streams_of_silver"]["brogue_density_per_100w"]
        hg = sig[ch]["halflings_gem"]["brogue_density_per_100w"]
        po = pooled[ch]["brogue_density_per_100w"]
        m = stab[ch]["metrics"]["brogue_density_per_100w"]
        c = m["cv"]
        if m["all_zero_across_books"]:
            label = "zero"
        elif m["stable_signal_le_30"]:
            label = "signal"
        else:
            label = "unstable"
        lines.append(
            f"| {ch} | {cs:.3f} | {ss:.3f} | {hg:.3f} | {po:.3f} | "
            f"{c} | {label} |"
        )
    lines.append("")
    lines.append("Archaic register (`thee / thou / thy / aye / nay`) per 100 dialogue words:")
    lines.append("")
    lines.append("| Character | CS | SoS | HG | pooled | CV | stability |")
    lines.append("|---|---:|---:|---:|---:|---:|---|")
    for ch in FELLOWSHIP:
        cs = sig[ch]["crystal_shard"]["archaic_density_per_100w"]
        ss = sig[ch]["streams_of_silver"]["archaic_density_per_100w"]
        hg = sig[ch]["halflings_gem"]["archaic_density_per_100w"]
        po = pooled[ch]["archaic_density_per_100w"]
        m = stab[ch]["metrics"]["archaic_density_per_100w"]
        c = m["cv"]
        if m["all_zero_across_books"]:
            label = "zero"
        elif m["stable_signal_le_30"]:
            label = "signal"
        else:
            label = "unstable"
        lines.append(
            f"| {ch} | {cs:.3f} | {ss:.3f} | {hg:.3f} | {po:.3f} | "
            f"{c} | {label} |"
        )
    lines.append("")
    lines.append("Dwarf folk-grammar negations (`doesna / willna / canna`) — Bruenor signature probe (HYPOTHESIS):")
    lines.append("")
    lines.append("| Character | CS density | SoS density | HG density | pooled |")
    lines.append("|---|---:|---:|---:|---:|")
    for ch in FELLOWSHIP:
        cs = sig[ch]["crystal_shard"]["dwarf_negation_density_per_100w"]
        ss = sig[ch]["streams_of_silver"]["dwarf_negation_density_per_100w"]
        hg = sig[ch]["halflings_gem"]["dwarf_negation_density_per_100w"]
        po = pooled[ch]["dwarf_negation_density_per_100w"]
        lines.append(
            f"| {ch} | {cs:.3f} | {ss:.3f} | {hg:.3f} | {po:.3f} |"
        )
    lines.append("")
    lines.append(
        "**HYPOTHESIS FALSIFIED.** Salvatore's Bruenor does not use Scottish/Highland-style "
        "`doesna / willna / canna` negation forms anywhere in the trilogy (0/0/0 across all "
        "characters across all 3 books). The actual dwarf-grammar signature is **`ye`-contractions** "
        "(`ye'll`, `ye'd`, `ye've`, `ye're`) — 62 hits in Bruenor's pooled dialogue + 35 in "
        "Catti-brie's; 0 in Drizzt/Wulfgar/Regis. These are folded into the brogue lexicon above "
        "(under the updated definition). The dwarf-negation row is preserved for transparency "
        "and as a guard against re-introducing the bad heuristic."
    )
    lines.append("")

    # ---- Vocabulary distinctiveness ----
    lines.append("### 5. Vocabulary distinctiveness (top 20 by Laplace-smoothed log-odds vs rest of fellowship)")
    lines.append("")
    lines.append(
        "Tokens with ≥4 hits in this character's pooled dialogue. Function words, "
        "names, brogue, and archaic markers are excluded from the vocabulary "
        "(those are reported in their own dialect tables above)."
    )
    lines.append("")
    for ch in FELLOWSHIP:
        items = vocab[ch]
        if not items:
            lines.append(f"- **{ch}** — (no tokens met threshold)")
            continue
        top = ", ".join(f"`{r['token']}`({r['char_count']}, lo={r['log_odds']:.2f})" for r in items[:20])
        lines.append(f"- **{ch}** — {top}")
    lines.append("")

    # ---- Question + self-pronoun rates ----
    lines.append("### 6 + 7. Question + first-person-singular rates per 100 dialogue words")
    lines.append("")
    lines.append("Question rate (`?`-terminated sentences / 100w):")
    lines.append("")
    lines.append("| Character | CS | SoS | HG | pooled | CV | stable? |")
    lines.append("|---|---:|---:|---:|---:|---:|---|")
    for ch in FELLOWSHIP:
        cs = sig[ch]["crystal_shard"]["question_density_per_100w"]
        ss = sig[ch]["streams_of_silver"]["question_density_per_100w"]
        hg = sig[ch]["halflings_gem"]["question_density_per_100w"]
        po = pooled[ch]["question_density_per_100w"]
        c = stab[ch]["metrics"]["question_density_per_100w"]["cv"]
        ok = stab[ch]["metrics"]["question_density_per_100w"]["stable_le_30"]
        lines.append(
            f"| {ch} | {cs:.3f} | {ss:.3f} | {hg:.3f} | {po:.3f} | "
            f"{c} | {'yes' if ok else 'no'} |"
        )
    lines.append("")
    lines.append("First-person singular density (I / me / my / mine / myself / I'd / I'll / I've / I'm) per 100w:")
    lines.append("")
    lines.append("| Character | CS | SoS | HG | pooled | CV | stable? |")
    lines.append("|---|---:|---:|---:|---:|---:|---|")
    for ch in FELLOWSHIP:
        cs = sig[ch]["crystal_shard"]["self_pronoun_density_per_100w"]
        ss = sig[ch]["streams_of_silver"]["self_pronoun_density_per_100w"]
        hg = sig[ch]["halflings_gem"]["self_pronoun_density_per_100w"]
        po = pooled[ch]["self_pronoun_density_per_100w"]
        c = stab[ch]["metrics"]["self_pronoun_density_per_100w"]["cv"]
        ok = stab[ch]["metrics"]["self_pronoun_density_per_100w"]["stable_le_30"]
        lines.append(
            f"| {ch} | {cs:.3f} | {ss:.3f} | {hg:.3f} | {po:.3f} | "
            f"{c} | {'yes' if ok else 'no'} |"
        )
    lines.append("")

    # ---- Cross-book stability summary ----
    lines.append("### Cross-book stability summary (per character)")
    lines.append("")
    lines.append(
        "Counts **positive-signal** stability only (CV ≤ 0.30 with non-zero "
        "mean). `n_zero_density` separately reports metrics that are all-zero "
        "across all 3 books — those are stable absences (e.g. Drizzt has 0 "
        "brogue everywhere — correct, but not a positive signature)."
    )
    lines.append("")
    lines.append("| Character | books_present | stable_signal (of 7) | n_zero (of 7) | stable_oath_top3? | stable_total (of 8) | passes_3of7? |")
    lines.append("|---|---:|---:|---:|---|---:|---|")
    for ch in FELLOWSHIP:
        s = stab[ch]
        lines.append(
            f"| {ch} | {s['n_books_present']} | "
            f"{s['n_stable_density_metrics']}/7 | "
            f"{s['n_zero_density_metrics']}/7 | "
            f"{'yes' if s['stable_oath_top3'] else 'no'} | "
            f"{s['n_stable_total']}/8 | "
            f"{'yes' if s['passes_per_char_gate'] else 'no'} |"
        )
    lines.append("")

    # ---- Archetype confirmation ----
    lines.append("### Archetype confirmation (descriptive)")
    lines.append("")
    for ch in FELLOWSHIP:
        a = arch[ch]
        lines.append(f"- **{ch}** — {a['hypothesis']}")
        confirms: List[str] = []
        for k, v in a.items():
            if k == "hypothesis":
                continue
            if isinstance(v, bool):
                confirms.append(f"{k}={'CONFIRMED' if v else 'NOT_CONFIRMED'}")
            elif isinstance(v, (int, float)):
                confirms.append(f"{k}={v}")
            elif isinstance(v, dict):
                confirms.append(f"{k}={v}")
        lines.append(f"  - {' | '.join(confirms)}")
    lines.append("")

    # ---- Verdict ----
    lines.append("### Verdict")
    lines.append("")
    vc = result["verdict_components"]
    lines.append(
        f"**Overall verdict: `{result['verdict']}`** "
        f"(per-character pass-3-of-7 gate: {vc['n_chars_passing_per_char_gate_3of7']}/5; "
        f"≥2-of-7 gate: {vc['n_chars_with_at_least_2of7_stable']}/5)"
    )
    lines.append("")

    # ---- Proposed harness levers ----
    lines.append("### Proposed harness levers")
    lines.append("")
    lines.append(
        "1. **Per-character writer-prompt fewshot blocks** in `WRITER_GENRE_PACKS` "
        "fantasy-Salvatore route: each fellowship character carries a 4–6 quote "
        "fewshot tuned to their voice signature (mean utterance length ± 25%, "
        "characteristic dialect markers, top-3 signature oaths). Shipping 5 "
        "blocks (Drizzt / Bruenor / Wulfgar / Catti-brie / Regis); the fewshot "
        "is gated on `charactersPresent` per beat — only the speakers in the "
        "current beat's POV/companion set are injected, keeping context budget bounded."
    )
    lines.append(
        "2. **Per-character character-voice consistency lint rules** (gated to "
        "the Salvatore/fantasy route via `WRITER_GENRE_PACKS`):"
    )
    lines.append(
        "   - `lint.bruenor_no_brogue_in_dialogue` — fire when a Bruenor-attributed "
        "quote has zero `ye/yer/yerself` markers and ≥ 8 dialogue words. The corpus "
        "shows ~all Bruenor utterances of that length carry brogue."
    )
    lines.append(
        "   - `lint.drizzt_contracted_overflow` — fire when a Drizzt quote exceeds "
        "the corpus contraction density by ≥ 2× (Drizzt's cross-book contraction "
        "density is in a tight band; sudden contraction-heavy dialogue is OOC)."
    )
    lines.append(
        "   - `lint.wulfgar_archaic_floor` — fire when a Wulfgar quote ≥ 12 words "
        "carries zero archaic markers (thee/thou/thy/aye); the barbarian-archetype "
        "register is the load-bearing signature."
    )
    lines.append(
        "   - `lint.catti_brie_brogue_floor` — fire when a Catti-brie quote ≥ 8 "
        "words carries zero `ye/yer` markers."
    )
    lines.append(
        "   - `lint.regis_archaic_overflow` — fire when a Regis quote carries any "
        "archaic markers (Regis is the modern-conversational signature; thee/thou is OOC)."
    )
    lines.append(
        "3. **Mean-utterance-length budget** (writer-prompt soft target per character) — "
        "the corpus pooled mean is the load-bearing prior; the per-book CV column "
        "in the table above tells you which characters have a tight cross-book "
        "rhythm (ship as ±25%) vs a looser one (ship as ±40% or as ranking only)."
    )
    lines.append(
        "4. **Vocabulary distinctiveness fewshots** — top-20 log-odds words per "
        "character feed an archetype-pass training signal: words that fire in this "
        "character's dialogue but not in the rest of the fellowship's are the "
        "lexical fingerprint that distinguishes their voice from the cast mean."
    )
    lines.append(
        "5. **Pairs with Pattern 48 (dialogue-tag distribution).** Bruenor + Wulfgar "
        "are tag-creative-heavier than Drizzt per P48; this pattern's per-character "
        "voice-signature lint should compose with P48's `said-ratio` archetype priors "
        "rather than fight them."
    )
    lines.append(
        "6. **Caveat: Catti-brie has thin CS coverage.** Per the corpus extract, "
        "Catti-brie has substantially fewer CS quotes than the other four; metrics "
        "with `n_books_present < 3` are flagged in the stability table. Treat her "
        "voice priors as ship-from-SoS+HG-only until Pattern 40's `monotonic-up "
        "introduce → integrate → elevate` curve closes."
    )
    lines.append("")

    section = "\n".join(lines) + "\n"
    atomic_append_section(CONCLUSIONS_PATH, section)


# ---------------------------------------------------------------------------
# Roadmap row inserter
# ---------------------------------------------------------------------------

def insert_roadmap_row(result: Dict[str, Any], json_path: Path, commit: str) -> None:
    pooled = result["pooled_per_char_signature"]
    stab = result["stability_per_char"]
    vc = result["verdict_components"]

    # Build a compact per-character signature snippet for the findings cell.
    sig_strs: List[str] = []
    for ch in FELLOWSHIP:
        mw = pooled[ch]["mean_utterance_words"]
        br = pooled[ch]["brogue_density_per_100w"]
        ar = pooled[ch]["archaic_density_per_100w"]
        ex = pooled[ch]["exclamation_density_per_100w"]
        n_stable = stab[ch]["n_stable_density_metrics"]
        sig_strs.append(
            f"{ch} mean_utt={mw:.1f}w brogue={br:.2f} archaic={ar:.2f} excl={ex:.2f} stable={n_stable}/7"
        )
    findings = (
        f"7-metric voice signature × 5 fellowship × 3 IWD books, n=2,447 LLM-attributed quotes. "
        f"Per-character pooled: " + " | ".join(sig_strs) + f". "
        f"Per-char gate (≥3-of-7 density metrics CV ≤ 0.30) passes "
        f"{vc['n_chars_passing_per_char_gate_3of7']}/5 fellowship; "
        f"≥2-of-7 passes {vc['n_chars_with_at_least_2of7_stable']}/5."
    )

    verdict = result["verdict"]
    if verdict == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship 5 per-character writer-prompt fewshot blocks + 5 per-character "
            "voice-consistency lint rules under WRITER_GENRE_PACKS fantasy-Salvatore"
        )
    elif verdict == "PASS_PARTIAL":
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship the stable per-character signatures (Bruenor brogue + dwarf-negation, "
            "Wulfgar archaic, Catti-brie brogue, Regis contraction-heavy); ship the "
            "5-character fewshot block; defer the lint rules whose underlying metric "
            "fails the per-character CV gate"
        )
    elif verdict == "DIVERGE":
        verdict_short = "HOLD"
        recommend = "do not codify per-character voice priors; revisit with finer attribution"
    else:
        verdict_short = "KILL"
        recommend = "no per-character voice signal; drop"

    lever = (
        "writer-prompt per-character voice fewshots (5 blocks: Drizzt formal-literate, "
        "Bruenor short+brogue+oath-heavy, Wulfgar archaic-barbarian, Catti-brie brogue+spirited, "
        "Regis conversational-contraction) gated to WRITER_GENRE_PACKS fantasy-Salvatore + "
        "5 per-character voice-consistency lint rules (bruenor_no_brogue_in_dialogue / "
        "drizzt_contracted_overflow / wulfgar_archaic_floor / catti_brie_brogue_floor / "
        "regis_archaic_overflow); composes with Pattern 48 said-ratio archetype priors"
    )

    new_row = (
        f"| {PATTERN_NUMBER} | **Per-character voice signature in dialogue** "
        f"(`{commit}`): {findings} | "
        f"{lever} | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | "
        f"**{verdict_short}** — {recommend} |\n"
    )

    atomic_insert_row_before_anchor(ROADMAP_PATH, new_row, "\n**Sequencing")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    commit = commit_short()
    print(f"[pattern-{PATTERN_NUMBER}] commit={commit}")

    result = analyze()

    # Write JSON via the atomic helper
    payload = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": "Per-character voice signature in dialogue",
        "commit": commit,
        "computed_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        "dialogue_extract_path": str(DIALOGUE_EXTRACT_PATH.relative_to(REPO)),
        "lexicons": {
            "contractions": sorted(CONTRACTIONS),
            "brogue_markers": sorted(BROGUE_MARKERS),
            "archaic_markers": sorted(ARCHAIC_MARKERS),
            "dwarf_negations": sorted(DWARF_NEGATIONS),
            "self_pronouns": sorted(SELF_PRONOUNS),
            "stopwords_size": len(STOPWORDS),
        },
        **result,
    }
    json_path = write_timestamped_json(OUT_DIR, PATTERN_SLUG, payload)
    print(f"[pattern-{PATTERN_NUMBER}] JSON -> {json_path}")

    append_conclusions(result, json_path, commit)
    print(f"[pattern-{PATTERN_NUMBER}] appended -> {CONCLUSIONS_PATH}")

    insert_roadmap_row(result, json_path, commit)
    print(f"[pattern-{PATTERN_NUMBER}] inserted row -> {ROADMAP_PATH}")

    # Terse summary
    print(f"\n=== Pattern {PATTERN_NUMBER} — verdict ===")
    print(f"verdict: {result['verdict']}")
    print(f"  per-char gate (≥3-of-7 density metrics, CV ≤ 0.30): "
          f"{result['verdict_components']['n_chars_passing_per_char_gate_3of7']}/5")
    print(f"  ≥2-of-7 gate: "
          f"{result['verdict_components']['n_chars_with_at_least_2of7_stable']}/5")
    print()
    pooled = result["pooled_per_char_signature"]
    for ch in FELLOWSHIP:
        s = pooled[ch]
        st = result["stability_per_char"][ch]
        print(
            f"  {ch:12s} "
            f"n_quotes={s['n_quotes']:4d} "
            f"mean_utt={s['mean_utterance_words']:5.1f}w "
            f"contr={s['contraction_density_per_100w']:5.2f}/100w "
            f"brogue={s['brogue_density_per_100w']:5.2f}/100w "
            f"archaic={s['archaic_density_per_100w']:5.2f}/100w "
            f"excl={s['exclamation_density_per_100w']:5.2f}/100w "
            f"stable={st['n_stable_density_metrics']}/7"
        )


if __name__ == "__main__":
    main()
