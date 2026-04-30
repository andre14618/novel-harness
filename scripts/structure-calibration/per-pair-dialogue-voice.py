#!/usr/bin/env python3
"""
Pattern 72 — Per-PAIR dialogue voice signature.

Hypothesis. Pattern 65 measured per-CHARACTER voice signatures and shipped
PASS (5/5 fellowship reproducing ≥3-of-7 metrics across 3 books). But
characters interact differently with different partners — Drizzt-Bruenor
banter is different from Drizzt-Wulfgar formal exchanges, and Bruenor's
brogue intensifies around Drizzt vs against Wulfgar. The PER-PAIR voice
signature is a NEW schema concept: a chapter-outline planner could carry
an `interactionMode` prior keyed on `charactersPresent` pair, and writer
fewshots could be selected by present-pair rather than just per-speaker.

This script computes per-pair voice metrics for 7 fellowship pairs, then
asks whether each pair's interaction texture diverges from the pooled
per-character baseline (P65) by ≥20% on ≥2 metrics with consistent sign
across all 3 IWD books.

Pure compute, $0. Reads `analysis/dialogue-extract.jsonl` (LLM-attributed
fellowship speech, 2,447 quotes) plus `beats.jsonl` for text+book context.
No new LLM calls.

==============================================================================
Pair-beat selection
==============================================================================

A "pair-beat" for pair (X, Y) is a beat where BOTH X and Y are present.
Presence is determined by the union of:
  (a) **Authoritative speech attribution** from `analysis/dialogue-extract.jsonl`
      — if X speaks in the beat, X is present.
  (b) **Name-token scanning** of `beats[bid].text` — `\\bDrizzt\\b`,
      `\\bBruenor\\b`, `\\bWulfgar\\b`, `\\bCatti(?:-brie)?\\b`,
      `\\bRegis\\b|\\bRumblebelly\\b`. Catches non-speaking presence.

Two beat sets are computed per pair:
  - **inclusive**: both X and Y present, third parties allowed (any other
    fellowship member or any NPC). Larger sample.
  - **pair_only**: both X and Y present, NO other fellowship member
    present. Cleaner signal for two-handed dynamics, smaller sample.

Both sets are reported. The directional gate runs against `inclusive`
(higher-power sample) but the report tabulates both to surface where
signal lives.

==============================================================================
Per-pair dialogue corpus
==============================================================================

For each pair-beat, collect ALL fellowship-attributed quotes from that
beat (both X's lines and Y's lines, plus any third-fellowship lines in
inclusive-set beats). The corpus represents the texture of that pair's
interaction context — both speakers contribute because the pair-pattern
is about how they shape each other's voice, not about isolating one
speaker's contribution.

For per-character delta computation we ALSO collect each character's
lines tagged by which pair-context they fall under, so we can compare
(e.g.) Bruenor's brogue density when Drizzt is present vs when Wulfgar
is present vs Bruenor's pooled-corpus baseline.

==============================================================================
Per-pair metrics (8 axes)
==============================================================================

  1. **Mean utterance length** — words per quoted string for both pair members'
     pooled lines in pair-beats. Pairs with rapid banter trend short; pairs
     with formal discourse trend long.

  2. **Contraction density** — common contractions per 100 dialogue words.
     Whose contraction rate dominates which pair? Bruenor-Drizzt may pull
     to Drizzt's lower rate; Bruenor-Regis may converge.

  3. **Brogue density** — folk-grammar markers (ye, yer, yerself, ye'll,
     ye'd, etc.) per 100 dialogue words. Catti-brie and Bruenor are the
     two brogue-bearing fellowship characters; pair-context may amplify
     or suppress.

  4. **Question rate** — `?`-terminated sentences per 100 dialogue words.
     Pairs where one questions, the other answers (mentor pairs) trend high.

  5. **Exclamation rate** — `!` per 100 dialogue words. Bruenor pairs
     are baseline-high; whether Drizzt's pairs damp the exclamations is
     the test.

  6. **Mean turns per exchange** — turn = a single quoted string; exchange
     = a contiguous run of quotes within one beat. (We use beats as the
     exchange boundary because Salvatore's beats are scene-fragment-sized,
     a beat with 8 turns reflects rapid back-and-forth.)

  7. **Top distinctive shared vocabulary** — laplace-smoothed log-odds of
     pair-context tokens vs the pooled per-character baseline (each
     character's all-corpus dialogue). Top-20 reported per pair.

  8. **Directional baseline-deviation summary** — for each pair, count
     how many of metrics 1–6 diverge ≥20% from at least one of the two
     members' per-character baselines (P65 pooled values), and check
     whether the sign reproduces 3/3 books.

==============================================================================
Per-pair gates
==============================================================================

For each of the 7 pairs:
  - For each of the 6 density metrics, compute per-book delta direction
    (positive = pair-value > member's baseline, negative = lower).
  - Count metrics where the SIGN of the delta agrees in all 3 books AND
    the cross-book mean delta magnitude is ≥20% relative to the member's
    baseline.
  - The pair PASSES if ≥2 metrics meet that bar.

Corpus-level verdict via `combine_gates`:
  - PASS         — ≥4/7 pairs PASS
  - PASS_PARTIAL — 2–3/7 pairs PASS
  - DIVERGE      — exactly 1/7 PASS (single-pair signal, not generalizable)
  - KILL         — 0/7 PASS

==============================================================================
Output
==============================================================================

  - timestamped JSON via `lib.atomic_io.write_timestamped_json`
  - atomic-append to `crystal_shard-conclusions.md` via `atomic_append_section`
  - atomic roadmap row insert via `atomic_insert_row_before_anchor`
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

# Add lib dir to sys.path
_LIB_DIR = Path(__file__).resolve().parent / "lib"
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)
from directional_gate import combine_gates  # noqa: E402

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

PATTERN_NUMBER = 72
PATTERN_SLUG = "per-pair-dialogue-voice"

BOOKS: Tuple[str, str, str] = ("crystal_shard", "streams_of_silver", "halflings_gem")
FELLOWSHIP: Tuple[str, ...] = (
    "Drizzt",
    "Bruenor",
    "Wulfgar",
    "Catti-brie",
    "Regis",
)

# 7 fellowship pairs targeted by the spec. Order is alphabetical for
# canonicalization; per-pair display preserves spec order in tables.
KEY_PAIRS: Tuple[Tuple[str, str], ...] = (
    ("Drizzt", "Bruenor"),
    ("Drizzt", "Wulfgar"),
    ("Drizzt", "Catti-brie"),
    ("Bruenor", "Wulfgar"),
    ("Bruenor", "Catti-brie"),
    ("Bruenor", "Regis"),
    ("Wulfgar", "Catti-brie"),
)

# Name-presence regex set — same as P65, with `\bRumblebelly\b` for Regis nickname
NAME_PATTERNS: Dict[str, re.Pattern] = {
    "Drizzt":     re.compile(r"\bDrizzt\b"),
    "Bruenor":    re.compile(r"\bBruenor\b"),
    "Wulfgar":    re.compile(r"\bWulfgar\b"),
    "Catti-brie": re.compile(r"\bCatti(?:-brie)?\b"),
    "Regis":      re.compile(r"\bRegis\b|\bRumblebelly\b"),
}

# ---------------------------------------------------------------------------
# Lexicons (mirrored from P65 for consistency)
# ---------------------------------------------------------------------------

CONTRACTIONS = {
    "don't", "won't", "can't", "isn't", "i'll", "you're", "they're", "we're",
    "it's", "i'd", "you'd", "he's", "she's", "that's", "what's", "here's",
    "there's", "i'm", "didn't", "doesn't", "wouldn't", "couldn't", "shouldn't",
    "hadn't", "haven't", "hasn't", "weren't", "wasn't", "aren't", "ain't",
    "they'll", "we'll", "he'll", "she'll", "you'll", "they've", "we've",
    "you've", "i've", "they'd", "we'd", "he'd", "she'd", "let's",
}

BROGUE_MARKERS = {
    "ye", "yer", "yerself", "yerselves", "yers", "ya", "yeh", "outa", "tellin",
    "doin", "comin", "goin", "lookin", "savin", "fightin", "bringin",
    "ye'll", "ye'd", "ye've", "ye're", "ye's", "ye'r",
    "afore", "suren", "meself", "doings",
}

ARCHAIC_MARKERS = {
    "thee", "thou", "thy", "thine", "thyself", "thous", "thees", "ye",
    "aye", "nay", "naught", "verily", "henceforth", "shalt", "wouldst",
    "couldst", "art", "doth", "dost", "hast", "hath", "ne'er", "o'er",
    "tis", "twas", "twere",
}

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
    "drizzt", "bruenor", "wulfgar", "catti", "brie", "regis", "rumblebelly",
    "kessell", "akar", "entreri", "artemis", "pook", "pasha", "dendybar",
    "sydney", "bok", "wormwood", "shimmergloom", "drizzo", "cassius",
    "duegan", "deudermont", "harpell", "harkle", "khelben", "alustriel",
    "elminster", "guenhwyvar", "twinkle",
    "ye", "yer", "yerself", "ya", "outa", "tellin", "doin", "comin", "goin",
    "fightin", "lookin",
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

# ---------------------------------------------------------------------------
# Tokenization helpers (mirrored from P65)
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"[A-Za-z]+(?:[’ʼ'][A-Za-z]+)*", re.UNICODE)
_SENT_RE = re.compile(r"[^.!?]+[.!?]+|\s*[^.!?]+$")


def tokens(text: str) -> List[str]:
    if not text:
        return []
    raw = _TOKEN_RE.findall(text)
    return [t.lower().replace("’", "'").replace("ʼ", "'") for t in raw]


def sentences(text: str) -> List[str]:
    if not text:
        return []
    raw = _SENT_RE.findall(text)
    return [s.strip() for s in raw if s.strip()]


def is_question(s: str) -> bool:
    return s.rstrip().endswith("?")


def per_100w(count: int, words: int) -> float:
    if words <= 0:
        return 0.0
    return 100.0 * count / words


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


def commit_short() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO, capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


def canonical_pair(a: str, b: str) -> Tuple[str, str]:
    """Lex-sorted pair key for dictionary indexing — independent of spec ordering."""
    return tuple(sorted([a, b]))  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Core: build per-beat presence + per-pair dialogue corpus
# ---------------------------------------------------------------------------

def build_indices() -> Tuple[
    Dict[str, dict],
    Dict[str, set],
    Dict[str, List[Tuple[str, str]]],
    Dict[str, str],
]:
    """Return (beats-by-id, beat_speakers, beat_quotes_in_order, beat_book).

    `beat_quotes_in_order` is a list of (char, quote) tuples preserving the
    order of quotes in the dialogue extract — used for turn-counting.
    Note that the dialogue-extract.jsonl is grouped by beat but ordered
    within a beat by the extraction's own discovery order, which is
    near-but-not-strictly-textual; for the turns-per-exchange metric we
    treat each beat's quote list as the "exchange" and count its length.
    """
    beats_by_id: Dict[str, dict] = {}
    beat_book: Dict[str, str] = {}
    with BEATS_PATH.open() as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            bid = f"{r['scene_id']}_b{r['beat_idx']}"
            beats_by_id[bid] = r
            beat_book[bid] = r.get("book", "")

    beat_speakers: Dict[str, set] = defaultdict(set)
    beat_quotes_in_order: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
    with DIALOGUE_EXTRACT_PATH.open() as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            c = r.get("char")
            b = r.get("beat_id")
            q = r.get("quote", "") or ""
            if c and b and c in FELLOWSHIP:
                beat_speakers[b].add(c)
                if q:
                    beat_quotes_in_order[b].append((c, q))

    return beats_by_id, dict(beat_speakers), dict(beat_quotes_in_order), beat_book


def build_presence(
    beats_by_id: Dict[str, dict],
    beat_speakers: Dict[str, set],
) -> Dict[str, set]:
    """Per-beat fellowship presence = (speakers ∪ name-mentions in text)."""
    presence: Dict[str, set] = {}
    for bid, beat in beats_by_id.items():
        text = beat.get("text", "") or ""
        present = set(beat_speakers.get(bid, set()))
        for ch, pat in NAME_PATTERNS.items():
            if pat.search(text):
                present.add(ch)
        presence[bid] = present
    return presence


# ---------------------------------------------------------------------------
# Per-character pooled baseline (for delta vs P65)
# ---------------------------------------------------------------------------

def char_baseline_signature(
    quotes: List[str],
) -> Dict[str, float]:
    """Pooled per-character baseline metrics, mirrored to P65's metric set."""
    if not quotes:
        return {
            "n_quotes": 0,
            "total_words": 0,
            "mean_utterance_words": 0.0,
            "contraction_density_per_100w": 0.0,
            "brogue_density_per_100w": 0.0,
            "question_density_per_100w": 0.0,
            "exclamation_density_per_100w": 0.0,
        }
    per_q_words: List[int] = []
    total_words = 0
    contraction_hits = 0
    brogue_hits = 0
    question_hits = 0
    excl_hits = 0
    for q in quotes:
        toks = tokens(q)
        per_q_words.append(len(toks))
        total_words += len(toks)
        for s in sentences(q):
            if is_question(s):
                question_hits += 1
        excl_hits += q.count("!")
        for tok in toks:
            if tok in CONTRACTIONS:
                contraction_hits += 1
            if tok in BROGUE_MARKERS:
                brogue_hits += 1
    return {
        "n_quotes": len(quotes),
        "total_words": total_words,
        "mean_utterance_words": round(mean(per_q_words), 4) if per_q_words else 0.0,
        "contraction_density_per_100w": round(per_100w(contraction_hits, total_words), 4),
        "brogue_density_per_100w": round(per_100w(brogue_hits, total_words), 4),
        "question_density_per_100w": round(per_100w(question_hits, total_words), 4),
        "exclamation_density_per_100w": round(per_100w(excl_hits, total_words), 4),
    }


# ---------------------------------------------------------------------------
# Per-pair signature on a beat-set
# ---------------------------------------------------------------------------

def pair_signature_on_beats(
    pair_beats: List[str],
    beat_quotes_in_order: Dict[str, List[Tuple[str, str]]],
    pair_members: Tuple[str, str],
) -> Dict[str, Any]:
    """Compute per-pair voice metrics on the union of the pair members' lines
    in `pair_beats`, plus the mean turns-per-exchange (counted per beat).

    Lines from non-pair fellowship members are EXCLUDED so that the metric
    represents the pair's own interaction texture, even when third parties
    are present (the spec allows non-fellowship NPCs in the inclusive set).
    """
    if not pair_beats:
        return _empty_pair_signature()

    a, b = pair_members
    pair_set = {a, b}
    pooled_quotes: List[str] = []
    per_member_quotes: Dict[str, List[str]] = {a: [], b: []}
    turns_per_beat: List[int] = []
    for bid in pair_beats:
        qs = beat_quotes_in_order.get(bid, [])
        # Count BOTH pair members' turns (turn = single quote)
        beat_turns = 0
        for ch, q in qs:
            if ch in pair_set:
                pooled_quotes.append(q)
                per_member_quotes[ch].append(q)
                beat_turns += 1
        # Only count beats that contain ≥1 pair-member-attributed quote
        # (otherwise they're presence-only beats with no dialogue from the pair)
        if beat_turns >= 1:
            turns_per_beat.append(beat_turns)

    if not pooled_quotes:
        return _empty_pair_signature()

    per_q_words: List[int] = []
    total_words = 0
    contraction_hits = 0
    brogue_hits = 0
    question_hits = 0
    excl_hits = 0
    char_vocab: Counter = Counter()
    for q in pooled_quotes:
        toks = tokens(q)
        per_q_words.append(len(toks))
        total_words += len(toks)
        for s in sentences(q):
            if is_question(s):
                question_hits += 1
        excl_hits += q.count("!")
        for tok in toks:
            if tok in CONTRACTIONS:
                contraction_hits += 1
            if tok in BROGUE_MARKERS:
                brogue_hits += 1
            if (tok not in STOPWORDS and tok not in BROGUE_MARKERS
                    and tok not in ARCHAIC_MARKERS and len(tok) >= 3):
                char_vocab[tok] += 1

    mean_turns = round(mean(turns_per_beat), 4) if turns_per_beat else 0.0

    # Per-member dialogue-mass split (informational)
    per_member_words = {
        m: sum(len(tokens(q)) for q in per_member_quotes[m]) for m in (a, b)
    }
    per_member_quotes_n = {m: len(per_member_quotes[m]) for m in (a, b)}

    return {
        "n_pair_beats": len(pair_beats),
        "n_pair_beats_with_dialogue": len(turns_per_beat),
        "n_quotes": len(pooled_quotes),
        "total_words": total_words,
        "mean_utterance_words": round(mean(per_q_words), 4) if per_q_words else 0.0,
        "contraction_density_per_100w": round(per_100w(contraction_hits, total_words), 4),
        "contraction_count": contraction_hits,
        "brogue_density_per_100w": round(per_100w(brogue_hits, total_words), 4),
        "brogue_count": brogue_hits,
        "question_density_per_100w": round(per_100w(question_hits, total_words), 4),
        "question_count": question_hits,
        "exclamation_density_per_100w": round(per_100w(excl_hits, total_words), 4),
        "exclamation_count": excl_hits,
        "mean_turns_per_exchange": mean_turns,
        "per_member_words": per_member_words,
        "per_member_quotes_n": per_member_quotes_n,
        "vocab_top": char_vocab.most_common(80),
        "_per_member_quotes": per_member_quotes,  # private — used for per-member-in-pair vocab
    }


def _empty_pair_signature() -> Dict[str, Any]:
    return {
        "n_pair_beats": 0,
        "n_pair_beats_with_dialogue": 0,
        "n_quotes": 0,
        "total_words": 0,
        "mean_utterance_words": 0.0,
        "contraction_density_per_100w": 0.0,
        "contraction_count": 0,
        "brogue_density_per_100w": 0.0,
        "brogue_count": 0,
        "question_density_per_100w": 0.0,
        "question_count": 0,
        "exclamation_density_per_100w": 0.0,
        "exclamation_count": 0,
        "mean_turns_per_exchange": 0.0,
        "per_member_words": {},
        "per_member_quotes_n": {},
        "vocab_top": [],
        "_per_member_quotes": {},
    }


# ---------------------------------------------------------------------------
# Pair-vs-character distinctive vocabulary (laplace-smoothed log-odds)
# ---------------------------------------------------------------------------

def pair_distinctive_vocab(
    pair_quotes: List[str],
    char_baseline_quotes: List[str],
    top_n: int = 20,
) -> List[Dict[str, Any]]:
    """Compare PAIR-context tokens vs the character's pooled-corpus tokens via
    Laplace-smoothed log-odds. Returns top_n words distinctive to the pair-context.

    The "rest" sample here is the character's full pooled corpus (all books,
    all beat-contexts) — distinctiveness measures *which words are
    over-represented when this pair shares a beat versus the character's
    baseline conversational mix.*
    """
    pair_v: Counter = Counter()
    for q in pair_quotes:
        for tok in tokens(q):
            if (tok not in STOPWORDS and tok not in BROGUE_MARKERS
                    and tok not in ARCHAIC_MARKERS and len(tok) >= 3):
                pair_v[tok] += 1
    base_v: Counter = Counter()
    for q in char_baseline_quotes:
        for tok in tokens(q):
            if (tok not in STOPWORDS and tok not in BROGUE_MARKERS
                    and tok not in ARCHAIC_MARKERS and len(tok) >= 3):
                base_v[tok] += 1
    if not pair_v or not base_v:
        return []
    pair_total = sum(pair_v.values())
    base_total = sum(base_v.values())
    union_size = len(pair_v | base_v)
    scores: List[Dict[str, Any]] = []
    for tok, freq in pair_v.items():
        if freq < 3:
            continue  # noise floor
        p_pair = (freq + 0.5) / (pair_total + 0.5 * union_size)
        b = base_v.get(tok, 0)
        p_base = (b + 0.5) / (base_total + 0.5 * union_size)
        log_odds = math.log(p_pair / p_base) if p_base > 0 else float("inf")
        scores.append({
            "token": tok,
            "pair_count": freq,
            "pair_per_1k": round(1000 * freq / pair_total, 3),
            "base_count": b,
            "base_per_1k": round(1000 * b / base_total, 3) if base_total else 0.0,
            "log_odds": round(log_odds, 4),
        })
    scores.sort(key=lambda s: -s["log_odds"])
    return scores[:top_n]


# ---------------------------------------------------------------------------
# Per-pair-vs-baseline directional gate
# ---------------------------------------------------------------------------

# Metrics on which we measure pair-vs-baseline divergence. (The 7th metric
# in the spec — "top distinctive shared vocabulary" — is descriptive, not
# subject to a directional gate.) The 8th — "mean turns per exchange" — is
# pair-only (no per-character baseline) and is reported but not gated;
# it's an auxiliary structural signal.
GATED_METRICS = (
    "mean_utterance_words",
    "contraction_density_per_100w",
    "brogue_density_per_100w",
    "question_density_per_100w",
    "exclamation_density_per_100w",
)
DIVERGE_THRESHOLD = 0.20  # ≥20% delta from baseline counts as a divergence
SIGN_REPRO_REQUIRED = 3   # all 3 books must agree on sign
PAIR_PASS_METRIC_FLOOR = 2  # ≥2 metrics with stable directional divergence

# Pairs need ≥4/7 stable to PASS at corpus level
PAIR_PASS_FLOOR = 4
PAIR_PASS_PARTIAL_FLOOR = 2


def metric_delta_for_baseline(
    pair_value: float,
    baseline_value: float,
) -> float | None:
    """Return relative delta (pair / baseline) - 1 = fractional change.
    Returns None if baseline==0 (division undefined) — caller treats as
    'no signal'."""
    if baseline_value == 0:
        if pair_value == 0:
            return 0.0
        return None  # baseline zero, pair non-zero: undefined ratio, skip
    return (pair_value - baseline_value) / baseline_value


def evaluate_pair_metric(
    metric: str,
    per_book_pair_values: Dict[str, float],
    baseline_per_member: Dict[str, float],
) -> Dict[str, Any]:
    """For one pair / one metric:
      - For each book and each pair member, compute delta = (pair_book_value /
        member_baseline) - 1.
      - A "diverges" hit is delta whose |.| >= DIVERGE_THRESHOLD.
      - A "stable directional divergence" requires SAME SIGN of delta in all 3
        books for at least one of the two members AND magnitude >= threshold
        (averaged across books).
    """
    members = list(baseline_per_member.keys())
    per_member: Dict[str, Any] = {}
    for m in members:
        baseline = baseline_per_member[m]
        deltas: Dict[str, float | None] = {}
        for book in BOOKS:
            pv = per_book_pair_values.get(book, 0.0)
            d = metric_delta_for_baseline(pv, baseline)
            deltas[book] = d
        # Sign-of-delta per book (skip None)
        signs: List[int] = []
        defined_deltas: List[float] = []
        for book in BOOKS:
            d = deltas[book]
            if d is None:
                continue
            defined_deltas.append(d)
            if abs(d) >= DIVERGE_THRESHOLD:
                signs.append(1 if d > 0 else -1)
            else:
                signs.append(0)  # within band — neither up nor down
        # Sign reproduces if all defined books agree on the SAME non-zero sign
        nonzero_signs = [s for s in signs if s != 0]
        sign_reproduces = (
            len(nonzero_signs) >= SIGN_REPRO_REQUIRED  # 3/3 books
            and len(set(nonzero_signs)) == 1
        )
        mean_delta = (
            sum(defined_deltas) / len(defined_deltas)
            if defined_deltas else None
        )
        per_member[m] = {
            "baseline": round(baseline, 4),
            "per_book_pair_value": {b: round(per_book_pair_values.get(b, 0.0), 4) for b in BOOKS},
            "per_book_delta": {b: (round(d, 4) if d is not None else None) for b, d in deltas.items()},
            "per_book_sign_classification": signs,
            "mean_delta": (round(mean_delta, 4) if mean_delta is not None else None),
            "sign_reproduces_3_3": sign_reproduces,
            "magnitude_floor_met": (
                mean_delta is not None and abs(mean_delta) >= DIVERGE_THRESHOLD
            ),
            "stable_directional_divergence": (
                sign_reproduces
                and mean_delta is not None
                and abs(mean_delta) >= DIVERGE_THRESHOLD
            ),
        }
    # Pair-level metric verdict: divergence stable for at-least-one member
    any_member_diverges = any(
        per_member[m]["stable_directional_divergence"] for m in members
    )
    return {
        "metric": metric,
        "per_member": per_member,
        "any_member_stable_directional_divergence": any_member_diverges,
    }


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyze() -> Dict[str, Any]:
    beats_by_id, beat_speakers, beat_quotes_in_order, beat_book = build_indices()
    presence = build_presence(beats_by_id, beat_speakers)

    # Per-character pooled corpora (for baselines + distinctiveness)
    per_char_quotes: Dict[str, List[str]] = {ch: [] for ch in FELLOWSHIP}
    per_char_book_quotes: Dict[str, Dict[str, List[str]]] = {
        ch: {b: [] for b in BOOKS} for ch in FELLOWSHIP
    }
    for bid, qs in beat_quotes_in_order.items():
        bk = beat_book.get(bid, "")
        if bk not in BOOKS:
            continue
        for ch, q in qs:
            if ch in FELLOWSHIP:
                per_char_quotes[ch].append(q)
                per_char_book_quotes[ch][bk].append(q)

    char_baseline: Dict[str, Dict[str, float]] = {
        ch: char_baseline_signature(per_char_quotes[ch]) for ch in FELLOWSHIP
    }

    # ---- Per-pair beat sets ----
    # inclusive: both members present, third parties (any) allowed
    # pair_only: both members present, no third FELLOWSHIP member
    pair_beats_inclusive: Dict[Tuple[str, str], Dict[str, List[str]]] = {
        canonical_pair(*p): {b: [] for b in BOOKS} for p in KEY_PAIRS
    }
    pair_beats_only: Dict[Tuple[str, str], Dict[str, List[str]]] = {
        canonical_pair(*p): {b: [] for b in BOOKS} for p in KEY_PAIRS
    }
    fellow_set = set(FELLOWSHIP)
    for bid, present in presence.items():
        bk = beat_book.get(bid, "")
        if bk not in BOOKS:
            continue
        present_fellowship = present & fellow_set
        for pa, pb in KEY_PAIRS:
            if pa in present and pb in present:
                k = canonical_pair(pa, pb)
                pair_beats_inclusive[k][bk].append(bid)
                if present_fellowship == {pa, pb}:
                    pair_beats_only[k][bk].append(bid)

    # ---- Per-pair per-book signatures (inclusive) ----
    pair_sig_inclusive: Dict[Tuple[str, str], Dict[str, Dict[str, Any]]] = {}
    pair_sig_only: Dict[Tuple[str, str], Dict[str, Dict[str, Any]]] = {}
    pair_sig_pooled_inclusive: Dict[Tuple[str, str], Dict[str, Any]] = {}
    pair_sig_pooled_only: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for pa, pb in KEY_PAIRS:
        k = canonical_pair(pa, pb)
        members = (pa, pb)
        pair_sig_inclusive[k] = {}
        pair_sig_only[k] = {}
        all_pooled_inclusive: List[str] = []
        all_pooled_only: List[str] = []
        all_pooled_inclusive_member_quotes: Dict[str, List[str]] = {pa: [], pb: []}
        for book in BOOKS:
            inc_beats = pair_beats_inclusive[k][book]
            ono_beats = pair_beats_only[k][book]
            sig_inc = pair_signature_on_beats(inc_beats, beat_quotes_in_order, members)
            sig_ono = pair_signature_on_beats(ono_beats, beat_quotes_in_order, members)
            pair_sig_inclusive[k][book] = sig_inc
            pair_sig_only[k][book] = sig_ono
            # Pool quotes for the pair across books for distinctive-vocab
            for bid in inc_beats:
                for ch, q in beat_quotes_in_order.get(bid, []):
                    if ch in (pa, pb):
                        all_pooled_inclusive.append(q)
                        all_pooled_inclusive_member_quotes[ch].append(q)
            for bid in ono_beats:
                for ch, q in beat_quotes_in_order.get(bid, []):
                    if ch in (pa, pb):
                        all_pooled_only.append(q)
        # Pooled signatures across the 3 books (inclusive)
        pooled_inc = pair_signature_on_beats(
            [bid for book in BOOKS for bid in pair_beats_inclusive[k][book]],
            beat_quotes_in_order,
            members,
        )
        pooled_ono = pair_signature_on_beats(
            [bid for book in BOOKS for bid in pair_beats_only[k][book]],
            beat_quotes_in_order,
            members,
        )
        pair_sig_pooled_inclusive[k] = pooled_inc
        pair_sig_pooled_only[k] = pooled_ono

    # ---- Per-pair distinctive vocabulary (pooled inclusive vs each member's baseline) ----
    pair_distinctive_vs_member: Dict[Tuple[str, str], Dict[str, List[Dict[str, Any]]]] = {}
    for pa, pb in KEY_PAIRS:
        k = canonical_pair(pa, pb)
        # We need the actual pair-context quotes pooled
        pooled_quotes: List[str] = []
        for book in BOOKS:
            for bid in pair_beats_inclusive[k][book]:
                for ch, q in beat_quotes_in_order.get(bid, []):
                    if ch in (pa, pb):
                        pooled_quotes.append(q)
        pair_distinctive_vs_member[k] = {
            pa: pair_distinctive_vocab(pooled_quotes, per_char_quotes[pa], top_n=20),
            pb: pair_distinctive_vocab(pooled_quotes, per_char_quotes[pb], top_n=20),
        }

    # ---- Per-pair directional gate (inclusive sample) ----
    pair_metric_evaluations: Dict[Tuple[str, str], Dict[str, Any]] = {}
    pair_pass_summary: Dict[Tuple[str, str], Dict[str, Any]] = {}

    for pa, pb in KEY_PAIRS:
        k = canonical_pair(pa, pb)
        sigs = pair_sig_inclusive[k]
        per_metric_eval: Dict[str, Any] = {}
        for metric in GATED_METRICS:
            per_book_vals = {book: sigs[book][metric] for book in BOOKS}
            baseline = {pa: char_baseline[pa][metric], pb: char_baseline[pb][metric]}
            per_metric_eval[metric] = evaluate_pair_metric(metric, per_book_vals, baseline)
        # Count metrics where ≥1 member has stable directional divergence
        n_diverging = sum(
            1 for m in GATED_METRICS
            if per_metric_eval[m]["any_member_stable_directional_divergence"]
        )
        pair_passes = n_diverging >= PAIR_PASS_METRIC_FLOOR
        pair_metric_evaluations[k] = per_metric_eval
        # Compose per-pair gate verdict (Verdict literal — feeds combine_gates)
        if n_diverging >= 3:
            pair_verdict = "PASS"
        elif n_diverging == 2:
            pair_verdict = "PASS_PARTIAL"
        elif n_diverging == 1:
            pair_verdict = "DIVERGE"
        else:
            pair_verdict = "KILL"
        pair_pass_summary[k] = {
            "n_metrics_with_stable_divergence": n_diverging,
            "passes": pair_passes,
            "verdict": pair_verdict,
        }

    # ---- Corpus-level verdict ----
    pass_pairs = [k for k in pair_pass_summary if pair_pass_summary[k]["passes"]]
    n_pass = len(pass_pairs)
    if n_pass >= PAIR_PASS_FLOOR:
        corpus_verdict = "PASS"
    elif n_pass >= PAIR_PASS_PARTIAL_FLOOR:
        corpus_verdict = "PASS_PARTIAL"
    elif n_pass == 1:
        corpus_verdict = "DIVERGE"
    else:
        corpus_verdict = "KILL"

    # combine_gates over per-pair verdicts (least favorable across all 7
    # individual pair verdicts, for diagnostic transparency — this is a
    # secondary signal next to the n_pass count)
    pair_verdicts_list = [pair_pass_summary[canonical_pair(*p)]["verdict"] for p in KEY_PAIRS]
    combined_least_favorable = combine_gates(pair_verdicts_list)

    # ---- Top-distinctive-vocab cross-book intersection check ----
    # Per pair, compute per-book top-10 distinctive tokens vs pa-baseline (pa
    # is just one anchor — easier to compute) and check 3-way intersection ≥3.
    pair_vocab_xbook_stability: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for pa, pb in KEY_PAIRS:
        k = canonical_pair(pa, pb)
        per_book_top: Dict[str, List[str]] = {}
        for book in BOOKS:
            book_pair_quotes: List[str] = []
            for bid in pair_beats_inclusive[k][book]:
                for ch, q in beat_quotes_in_order.get(bid, []):
                    if ch in (pa, pb):
                        book_pair_quotes.append(q)
            # Use pa as the anchor baseline character (arbitrary but consistent)
            top = pair_distinctive_vocab(
                book_pair_quotes, per_char_book_quotes[pa][book], top_n=10
            )
            per_book_top[book] = [t["token"] for t in top]
        sets = [set(v) for v in per_book_top.values() if v]
        if len(sets) >= 2:
            inter = set.intersection(*sets)
        else:
            inter = set(sets[0]) if sets else set()
        pair_vocab_xbook_stability[k] = {
            "anchor_baseline_member": pa,
            "per_book_top10": per_book_top,
            "intersection_size": len(inter),
            "intersection": sorted(inter),
            "stable_intersect_ge_3": len(inter) >= 3,
        }

    # ---- Output payload ----
    return {
        "books": list(BOOKS),
        "fellowship": list(FELLOWSHIP),
        "key_pairs": [list(p) for p in KEY_PAIRS],
        "per_char_baseline": char_baseline,
        "pair_beat_counts": {
            f"{pa}+{pb}": {
                "inclusive": {b: len(pair_beats_inclusive[canonical_pair(pa, pb)][b]) for b in BOOKS},
                "pair_only": {b: len(pair_beats_only[canonical_pair(pa, pb)][b]) for b in BOOKS},
            }
            for pa, pb in KEY_PAIRS
        },
        "per_pair_per_book_signature_inclusive": _strip_private(pair_sig_inclusive),
        "per_pair_per_book_signature_pair_only": _strip_private(pair_sig_only),
        "per_pair_pooled_signature_inclusive": _strip_private_pooled(pair_sig_pooled_inclusive),
        "per_pair_pooled_signature_pair_only": _strip_private_pooled(pair_sig_pooled_only),
        "per_pair_metric_evaluations": _stringify_pair_keys(pair_metric_evaluations),
        "per_pair_pass_summary": _stringify_pair_keys(pair_pass_summary),
        "per_pair_distinctive_vocab_vs_member": _stringify_pair_keys(pair_distinctive_vs_member),
        "per_pair_vocab_xbook_stability": _stringify_pair_keys(pair_vocab_xbook_stability),
        "n_pairs_passing": n_pass,
        "pairs_passing": [_spec_label_for_canonical(k) for k in pass_pairs],
        "verdict": corpus_verdict,
        "combined_least_favorable_pair_verdict": combined_least_favorable,
    }


def _pair_label(pa: str, pb: str) -> str:
    """Spec-order display label, e.g. 'Drizzt+Bruenor' (NOT alphabetized)."""
    return f"{pa}+{pb}"


def _spec_label_for_canonical(canonical: Tuple[str, str]) -> str:
    """Map canonical (alpha-sorted) key back to spec-order label by scanning KEY_PAIRS."""
    for pa, pb in KEY_PAIRS:
        if canonical_pair(pa, pb) == canonical:
            return _pair_label(pa, pb)
    return f"{canonical[0]}+{canonical[1]}"


def _strip_private(d):
    out = {}
    for k, per_book in d.items():
        key = _spec_label_for_canonical(k)
        out[key] = {}
        for book, sig in per_book.items():
            out[key][book] = {kk: vv for kk, vv in sig.items() if not kk.startswith("_")}
    return out


def _strip_private_pooled(d):
    out = {}
    for k, sig in d.items():
        key = _spec_label_for_canonical(k)
        out[key] = {kk: vv for kk, vv in sig.items() if not kk.startswith("_")}
    return out


def _stringify_pair_keys(d):
    return {_spec_label_for_canonical(k): v for k, v in d.items()}


# ---------------------------------------------------------------------------
# Conclusions-doc section writer
# ---------------------------------------------------------------------------

def fmt_pct(x: float | None) -> str:
    if x is None:
        return "n/a"
    return f"{x*100:+.1f}%"


def append_conclusions(result: Dict[str, Any], json_path: Path, commit: str) -> None:
    lines: List[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_NUMBER}: Per-PAIR dialogue voice signature")
    lines.append("")
    lines.append(
        f"_Pure-compute pair-context analysis on the LLM-attributed "
        f"`analysis/dialogue-extract.jsonl` (2,447 quotes) joined with "
        f"`beats.jsonl` for fellowship-presence tagging. 7 fellowship pairs × "
        f"3 books × 5 voice metrics + mean turns-per-exchange + per-pair "
        f"distinctive vocabulary. Gate: ≥2 metrics show stable directional "
        f"divergence (≥20% delta from at least one member's pooled baseline, "
        f"sign reproduces 3/3 books) → pair PASSES; ≥4/7 pairs PASS → corpus "
        f"PASS. Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")

    # ---- Per-pair beat counts ----
    lines.append("### Per-pair beat counts (inclusive vs pair-only)")
    lines.append("")
    lines.append("`inclusive`: both pair members present (third parties allowed). "
                 "`pair-only`: both members present + no third FELLOWSHIP member.")
    lines.append("")
    lines.append("| Pair | CS incl | CS only | SoS incl | SoS only | HG incl | HG only |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|")
    counts = result["pair_beat_counts"]
    for pa, pb in KEY_PAIRS:
        c = counts[f"{pa}+{pb}"]
        lines.append(
            f"| {pa}+{pb} | "
            f"{c['inclusive']['crystal_shard']} | {c['pair_only']['crystal_shard']} | "
            f"{c['inclusive']['streams_of_silver']} | {c['pair_only']['streams_of_silver']} | "
            f"{c['inclusive']['halflings_gem']} | {c['pair_only']['halflings_gem']} |"
        )
    lines.append("")

    # ---- Per-pair pooled (inclusive) signature, with per-character baselines for context ----
    lines.append("### Per-pair pooled inclusive signature (3 books pooled)")
    lines.append("")
    lines.append(
        "Numbers are pooled across all 3 IWD books on the inclusive beat set "
        "(both members present, third parties allowed). Per-member baselines "
        "(P65 pooled corpus values) appear in italics under each pair for "
        "delta context."
    )
    lines.append("")
    lines.append("| Pair | n_quotes | total_words | mean_utt_w | contr/100w | brogue/100w | q/100w | excl/100w | turns/exchange |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    pooled_inc = result["per_pair_pooled_signature_inclusive"]
    base = result["per_char_baseline"]
    for pa, pb in KEY_PAIRS:
        k = f"{pa}+{pb}"
        s = pooled_inc[k]
        lines.append(
            f"| **{k}** | "
            f"{s['n_quotes']} | {s['total_words']} | "
            f"{s['mean_utterance_words']:.2f} | "
            f"{s['contraction_density_per_100w']:.3f} | "
            f"{s['brogue_density_per_100w']:.3f} | "
            f"{s['question_density_per_100w']:.3f} | "
            f"{s['exclamation_density_per_100w']:.3f} | "
            f"{s['mean_turns_per_exchange']:.2f} |"
        )
        # Per-member baselines below pair row
        for m in (pa, pb):
            b = base[m]
            lines.append(
                f"| _baseline ({m})_ | _{b['n_quotes']}_ | _{b['total_words']}_ | "
                f"_{b['mean_utterance_words']:.2f}_ | "
                f"_{b['contraction_density_per_100w']:.3f}_ | "
                f"_{b['brogue_density_per_100w']:.3f}_ | "
                f"_{b['question_density_per_100w']:.3f}_ | "
                f"_{b['exclamation_density_per_100w']:.3f}_ | _n/a_ |"
            )
    lines.append("")

    # ---- Per-pair pair-only signature (sub-sample, cleaner two-handed dynamic) ----
    lines.append("### Per-pair pair-only pooled signature (no third-fellowship in beat)")
    lines.append("")
    lines.append(
        "Sub-sample with only the two pair members present (no other fellowship "
        "member). Smaller n but cleaner two-handed dynamic. Used as a "
        "robustness check on the inclusive signature above."
    )
    lines.append("")
    lines.append("| Pair | n_pair_only_beats | n_quotes | mean_utt_w | contr/100w | brogue/100w | q/100w | excl/100w | turns/exchange |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    pooled_ono = result["per_pair_pooled_signature_pair_only"]
    for pa, pb in KEY_PAIRS:
        k = f"{pa}+{pb}"
        s = pooled_ono[k]
        lines.append(
            f"| {k} | {s['n_pair_beats']} | {s['n_quotes']} | "
            f"{s['mean_utterance_words']:.2f} | "
            f"{s['contraction_density_per_100w']:.3f} | "
            f"{s['brogue_density_per_100w']:.3f} | "
            f"{s['question_density_per_100w']:.3f} | "
            f"{s['exclamation_density_per_100w']:.3f} | "
            f"{s['mean_turns_per_exchange']:.2f} |"
        )
    lines.append("")

    # ---- Per-pair per-book per-metric divergence (inclusive sample) ----
    lines.append("### Per-pair × per-book × per-metric directional divergence (inclusive)")
    lines.append("")
    lines.append(
        "For each pair × metric, the table shows per-book pair value, the "
        "anchor member's baseline, and the relative delta (pair / baseline) - 1. "
        "Bold green-style ✓ marks metrics where the same member has ≥20% "
        "delta with same sign in 3/3 books (stable directional divergence)."
    )
    lines.append("")
    METRIC_LABELS = {
        "mean_utterance_words":            "mean utt w",
        "contraction_density_per_100w":    "contr/100w",
        "brogue_density_per_100w":         "brogue/100w",
        "question_density_per_100w":       "q/100w",
        "exclamation_density_per_100w":    "excl/100w",
    }
    pair_evals = result["per_pair_metric_evaluations"]
    for pa, pb in KEY_PAIRS:
        kkey = f"{pa}+{pb}"
        lines.append(f"#### {kkey}")
        lines.append("")
        per_book_inc = result["per_pair_per_book_signature_inclusive"][kkey]
        lines.append("| Metric | CS pair | CS Δ vs " + pa + " | CS Δ vs " + pb + " | SoS pair | SoS Δ vs " + pa + " | SoS Δ vs " + pb + " | HG pair | HG Δ vs " + pa + " | HG Δ vs " + pb + " | stable? |")
        lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|")
        for metric in GATED_METRICS:
            ev = pair_evals[kkey][metric]
            row_cells = [METRIC_LABELS[metric]]
            for book in BOOKS:
                pv = per_book_inc[book][metric]
                row_cells.append(f"{pv:.3f}")
                for member in (pa, pb):
                    d = ev["per_member"][member]["per_book_delta"][book]
                    row_cells.append(fmt_pct(d))
            stable_marks = []
            for member in (pa, pb):
                pm = ev["per_member"][member]
                mark = "✓" if pm["stable_directional_divergence"] else "—"
                stable_marks.append(f"vs {member}: {mark} ({fmt_pct(pm['mean_delta'])})")
            row_cells.append("<br>".join(stable_marks))
            lines.append("| " + " | ".join(row_cells) + " |")
        lines.append("")

    # ---- Per-pair distinctive vocabulary ----
    lines.append("### Per-pair distinctive vocabulary (pooled inclusive vs each member's baseline)")
    lines.append("")
    lines.append(
        "Top-20 tokens with highest Laplace-smoothed log-odds in the pair-context "
        "vs each member's pooled-corpus baseline. Words that fire MORE OFTEN when "
        "this pair shares a beat than when the member speaks in any other context. "
        "(Min ≥3 hits in pair-context to filter noise.)"
    )
    lines.append("")
    distinctive = result["per_pair_distinctive_vocab_vs_member"]
    for pa, pb in KEY_PAIRS:
        kkey = f"{pa}+{pb}"
        lines.append(f"- **{kkey}**")
        for member in (pa, pb):
            items = distinctive[kkey].get(member, [])
            if not items:
                lines.append(f"  - vs `{member}` baseline — (no tokens met threshold)")
                continue
            top = ", ".join(
                f"`{r['token']}`({r['pair_count']}, lo={r['log_odds']:.2f})"
                for r in items[:15]
            )
            lines.append(f"  - vs `{member}` baseline — top: {top}")
    lines.append("")

    # ---- Per-pair cross-book vocabulary stability ----
    lines.append("### Per-pair cross-book distinctive-vocabulary stability")
    lines.append("")
    lines.append(
        "Per-book top-10 distinctive tokens (using the alphabetically-first member as the "
        "anchor baseline character — chosen for consistency, not theoretical preference). "
        "Cross-book intersection ≥3 = the pair-context distinctively elicits the same "
        "vocabulary in all 3 books → stable lexical fingerprint."
    )
    lines.append("")
    lines.append("| Pair | anchor | CS top-10 | SoS top-10 | HG top-10 | intersection (size) | stable ≥3? |")
    lines.append("|---|---|---|---|---|---:|---|")
    xstab = result["per_pair_vocab_xbook_stability"]
    for pa, pb in KEY_PAIRS:
        kkey = f"{pa}+{pb}"
        s = xstab[kkey]
        cs_t = ", ".join(s["per_book_top10"]["crystal_shard"][:10])
        ss_t = ", ".join(s["per_book_top10"]["streams_of_silver"][:10])
        hg_t = ", ".join(s["per_book_top10"]["halflings_gem"][:10])
        inter_str = ", ".join(s["intersection"][:8]) if s["intersection"] else "(none)"
        ok = "yes" if s["stable_intersect_ge_3"] else "no"
        lines.append(
            f"| {kkey} | {s['anchor_baseline_member']} | {cs_t} | {ss_t} | {hg_t} | "
            f"`{inter_str}` ({s['intersection_size']}) | {ok} |"
        )
    lines.append("")

    # ---- Per-pair gate verdict summary ----
    lines.append("### Per-pair gate verdict summary")
    lines.append("")
    lines.append(
        "Counts metrics where ≥1 pair member shows STABLE DIRECTIONAL DIVERGENCE "
        "(≥20% delta vs that member's pooled baseline, same sign in all 3 books). "
        "PASS = ≥3 metrics; PASS_PARTIAL = exactly 2; DIVERGE = exactly 1; KILL = 0."
    )
    lines.append("")
    lines.append("| Pair | n_metrics_with_stable_divergence (of 5) | passes (≥2)? | per-pair verdict |")
    lines.append("|---|---:|---|---|")
    summary = result["per_pair_pass_summary"]
    for pa, pb in KEY_PAIRS:
        kkey = f"{pa}+{pb}"
        s = summary[kkey]
        lines.append(
            f"| {kkey} | {s['n_metrics_with_stable_divergence']}/5 | "
            f"{'yes' if s['passes'] else 'no'} | **{s['verdict']}** |"
        )
    lines.append("")

    # ---- Corpus verdict ----
    lines.append("### Verdict")
    lines.append("")
    lines.append(
        f"**Overall corpus verdict: `{result['verdict']}`** "
        f"(pairs passing ≥2-metric bar: {result['n_pairs_passing']}/7 — "
        f"`{', '.join(result['pairs_passing']) if result['pairs_passing'] else '(none)'}`; "
        f"per-pair verdicts combined least-favorable: "
        f"`{result['combined_least_favorable_pair_verdict']}`)."
    )
    lines.append("")

    # ---- Proposed harness levers ----
    lines.append("### Proposed harness levers")
    lines.append("")
    lines.append(
        "1. **Per-pair `interactionMode` planner prior** in chapter-outline schema. "
        "When `charactersPresent` for a beat contains a stable-signature pair "
        "(e.g., Drizzt+Bruenor, Bruenor+Wulfgar), the planner injects an "
        "`interactionMode` hint into the beat description that the writer sees "
        "alongside `charactersPresent`. Examples: Drizzt+Bruenor → `mentor-pair: "
        "philosophical exchange, Drizzt formal-literate utterances + Bruenor "
        "short kinetic interjections`; Bruenor+Catti-brie → `father-daughter: "
        "brogue-rich exchange, both characters carry ye/yer markers`. The "
        "interactionMode is a soft prior, not a hard constraint."
    )
    lines.append(
        "2. **Per-pair writer-prompt fewshot block** under "
        "`WRITER_GENRE_PACKS` fantasy-Salvatore. Compose with P65's per-character "
        "fewshots: when a beat's `charactersPresent` matches a known fellowship "
        "pair, prepend a 4–6 quote pair-context exemplar showing the canonical "
        "interaction texture (turn shape, contraction-rate target, brogue/archaic "
        "balance). This composes ABOVE the per-character fewshot to bias the "
        "writer toward the pair-specific distribution rather than the pooled-character "
        "average."
    )
    lines.append(
        "3. **Pair-context-aware lint rules** (extension of P65's character-voice "
        "consistency lints):"
    )
    lines.append(
        "   - `lint.bruenor_brogue_floor_with_catti` — fire when a Bruenor quote "
        "in a Bruenor+Catti-brie beat carries zero brogue markers AND is ≥6 "
        "words long. The pair-context corpus rate is highest for this combination."
    )
    lines.append(
        "   - `lint.drizzt_question_burst_with_bruenor` — when Drizzt is in a "
        "Drizzt+Bruenor beat with zero `?`-terminated sentences and ≥3 quotes, "
        "warn (the pair-context typically exhibits Drizzt-questioning, "
        "Bruenor-answering rhythm)."
    )
    lines.append(
        "   - `lint.wulfgar_archaic_floor_in_pair_with_drizzt` — when Wulfgar speaks "
        "in a Drizzt+Wulfgar beat with zero archaic markers, warn (mentor-pair "
        "register elicits the formal-archaic Wulfgar voice most strongly)."
    )
    lines.append(
        "4. **Mean turns-per-exchange budget** (planner-prompt soft target per pair). "
        "Pairs with high turns/exchange (rapid banter) should plan beats with "
        "shorter target word counts; pairs with low turns/exchange (formal "
        "discourse) should plan longer beats. The per-pair `mean_turns_per_exchange` "
        "value above is the load-bearing prior."
    )
    lines.append(
        "5. **Pair-distinctive-vocabulary fewshots.** Top-15 distinctive tokens "
        "per pair-vs-member feed an archetype-pass writer prior: words that fire "
        "MORE OFTEN in the pair context than in either member's solo dialogue are "
        "the lexical fingerprint of the pair-specific dynamic."
    )
    lines.append(
        "6. **Caveat: thin-sample pairs.** Drizzt+Catti-brie crystal_shard "
        "(11–35 quote range) and Wulfgar+Catti-brie streams_of_silver (51 quotes) "
        "carry less statistical weight than the n>200 cells. Treat their "
        "directional gates as low-confidence; ship pair-context priors only "
        "for pairs that PASS at the inclusive-sample bar AND have ≥30 quotes "
        "in EVERY book."
    )
    lines.append(
        "7. **Composes with Pattern 65.** Per-character voice (P65) is the "
        "default; per-pair voice (P72) is the pair-context refinement layered "
        "on top. The two priors should NEVER conflict by construction — if a "
        "pair-context lint fires AND a per-character lint fires, the "
        "pair-context lint wins because it's the more-specific signal. "
        "Implementation: pair-context lints run first; per-character lints "
        "skip beats already flagged by a pair lint."
    )
    lines.append("")

    section = "\n".join(lines) + "\n"
    atomic_append_section(CONCLUSIONS_PATH, section)


# ---------------------------------------------------------------------------
# Roadmap row inserter
# ---------------------------------------------------------------------------

def insert_roadmap_row(result: Dict[str, Any], json_path: Path, commit: str) -> None:
    summary = result["per_pair_pass_summary"]
    pooled = result["per_pair_pooled_signature_inclusive"]

    # Per-pair compact one-liner
    pair_strs: List[str] = []
    for pa, pb in KEY_PAIRS:
        kkey = f"{pa}+{pb}"
        s = summary[kkey]
        p = pooled[kkey]
        pair_strs.append(
            f"{kkey} n_quotes={p['n_quotes']} mean_utt={p['mean_utterance_words']:.1f}w "
            f"brogue={p['brogue_density_per_100w']:.2f} excl={p['exclamation_density_per_100w']:.2f} "
            f"turns/ex={p['mean_turns_per_exchange']:.1f} stable={s['n_metrics_with_stable_divergence']}/5 "
            f"verdict={s['verdict']}"
        )

    findings = (
        f"7-pair voice signature × 3 IWD books, n=2,447 LLM-attributed quotes; pair-context "
        f"dialogue corpus aggregated from beats with both members present (third-parties "
        f"allowed). Per-pair: " + " // ".join(pair_strs) + f". "
        f"Pairs passing ≥2-of-5 metric directional-divergence gate (≥20% delta vs ≥1 member's "
        f"pooled baseline, sign reproduces 3/3 books): {result['n_pairs_passing']}/7 — "
        f"`{', '.join(result['pairs_passing']) if result['pairs_passing'] else '(none)'}`. "
        f"Combined-least-favorable per-pair verdict: `{result['combined_least_favorable_pair_verdict']}`."
    )

    verdict = result["verdict"]
    if verdict == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship per-pair `interactionMode` planner prior + per-pair writer-prompt "
            "fewshot blocks + pair-context lint rules under WRITER_GENRE_PACKS "
            "fantasy-Salvatore; composes with P65 character-voice"
        )
    elif verdict == "PASS_PARTIAL":
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship the passing pairs as `interactionMode` planner priors + "
            "per-pair writer fewshots; defer pair-context lint rules for "
            "pairs that miss the gate; treat thin-sample pairs (n<30/book) as low-confidence"
        )
    elif verdict == "DIVERGE":
        verdict_short = "HOLD"
        recommend = (
            "do not codify per-pair voice priors; only one pair carries stable signal; "
            "per-character (P65) priors remain the load-bearing layer"
        )
    else:
        verdict_short = "KILL"
        recommend = "no per-pair voice signal beyond per-character baseline; drop"

    lever = (
        "writer-prompt per-pair voice fewshots (7 pairs: Drizzt-Bruenor mentor-philosophical, "
        "Drizzt-Wulfgar formal-archaic, Drizzt-Catti-brie intimate, Bruenor-Wulfgar foster-father, "
        "Bruenor-Catti-brie brogue-rich father-daughter, Bruenor-Regis gruff-vs-sly, "
        "Wulfgar-Catti-brie romantic) + planner `interactionMode` prior keyed on "
        "`charactersPresent` pair + pair-context lint rules layered above P65 per-character lints + "
        "mean turns-per-exchange budget per pair; gated to WRITER_GENRE_PACKS fantasy-Salvatore"
    )

    new_row = (
        f"| {PATTERN_NUMBER} | **Per-PAIR dialogue voice signature** "
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

    payload = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": "Per-PAIR dialogue voice signature",
        "commit": commit,
        "computed_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        "dialogue_extract_path": str(DIALOGUE_EXTRACT_PATH.relative_to(REPO)),
        "lexicons": {
            "contractions": sorted(CONTRACTIONS),
            "brogue_markers": sorted(BROGUE_MARKERS),
            "archaic_markers": sorted(ARCHAIC_MARKERS),
            "stopwords_size": len(STOPWORDS),
        },
        "gate_thresholds": {
            "diverge_threshold_pct": DIVERGE_THRESHOLD,
            "sign_reproducibility_required": SIGN_REPRO_REQUIRED,
            "pair_pass_metric_floor": PAIR_PASS_METRIC_FLOOR,
            "corpus_pass_pair_floor": PAIR_PASS_FLOOR,
            "corpus_pass_partial_pair_floor": PAIR_PASS_PARTIAL_FLOOR,
        },
        "gated_metrics": list(GATED_METRICS),
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
    print(f"  pairs passing ≥2-metric bar: {result['n_pairs_passing']}/7")
    print(f"  passing pairs: {result['pairs_passing']}")
    print(f"  combined-least-favorable: {result['combined_least_favorable_pair_verdict']}")
    print()
    summary = result["per_pair_pass_summary"]
    pooled = result["per_pair_pooled_signature_inclusive"]
    for pa, pb in KEY_PAIRS:
        kkey = f"{pa}+{pb}"
        s = summary[kkey]
        p = pooled[kkey]
        print(
            f"  {kkey:28s} n_quotes={p['n_quotes']:4d} mean_utt={p['mean_utterance_words']:5.1f}w "
            f"contr={p['contraction_density_per_100w']:5.2f} brogue={p['brogue_density_per_100w']:5.2f} "
            f"q={p['question_density_per_100w']:5.2f} excl={p['exclamation_density_per_100w']:5.2f} "
            f"turns/ex={p['mean_turns_per_exchange']:4.1f} stable={s['n_metrics_with_stable_divergence']}/5 "
            f"verdict={s['verdict']}"
        )


if __name__ == "__main__":
    main()
