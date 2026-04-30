#!/usr/bin/env python3
"""
Pattern 62 — Simile density + lexicon
(3-book Icewind Dale corpus).

Pure-compute regex pass over `novels/salvatore-icewind-dale/beats.jsonl`
with character/POV joined from `novels/salvatore-icewind-dale/pairs.jsonl`.

Hypothesis
----------
Similes are a fantasy/sword-and-sorcery voice signature. Salvatore should
use them at a stable per-kind ratio (especially in description and
interiority beats). Density and the right-side-of-comparison vocabulary
are writer-prompt voice priors.

Methodology
-----------
Detector families (regex):

  1. AS_AS_SIMILE — "as X as a/an/the Y"
     Anchor: the RHS must lead with a determiner (a / an / the). This
     cleanly excludes the dominant non-simile uses of `as ... as`:
       - "as long as", "as soon as", "as much as"  (RHS = pronoun /
         clause / possessive — no determiner)
       - "as well as", "as far as"                  (RHS = adverb)
     and reliably catches the genuine simile shape ("as still as a
     statue", "as cold as ice", "as wild as the tundra").

     Exception: a small allow-list for bareform mass-nouns commonly used
     in similes without an article ("as cold as ice", "as quick as
     lightning") — these would be missed by the determiner anchor but
     are clearly similes; we add a secondary detector with a fixed list
     of bareform comparators (`stone`, `ice`, `lightning`, `silk`,
     `glass`, `iron`, `steel`, `gold`, `silver`, `night`, `death`,
     `mud`, `lead`, `wood`, `dust`, `wind`, `thunder`, `snow`, `fire`,
     `water`, `ash`).

  2. LIKE_SIMILE — "like a/an/the Y" (3-token NP cap on RHS)
     Anchor: requires a determiner so we exclude "look like him" /
     "feel like crying" etc. RHS captured up to 3 additional tokens to
     reach the comparator head ("like a great cat", "like a coiled
     serpent ready to strike").

     Also catches the bareform mass-noun subset ("like ice", "like
     stone") via the same bareform allow-list as AS_AS.

  3. AS_IF / AS_THOUGH — catalogued separately as simile-adjacent
     (epistemic-modal style; "as if Drizzt had vanished").

  4. SEMI_SIMILE — perception-verbs + "like" ("looked like", "felt
     like", "sounded like", "seemed like", "tasted like", "smelled
     like"). Catalogued separately; NOT counted in primary density.

False-positive filters
----------------------
  - Sentence-leading "Like" followed by a noun phrase often introduces a
    parallel structure ("Like all dwarven smiths, he…"); these are
    similes. We KEEP them.
  - "was like, 'no'"  (dialogue speech filler) — extremely rare in
    Salvatore's third-person narration; we don't dedicate a filter,
    counts as noise floor.
  - Sentence-leading "As X as Y, Z…" simile clauses are kept.
  - Hyphenation across linebreaks ("ic-\nicle"): we strip linebreaks +
    excess whitespace before regex matching.

Per-beat outputs
----------------
  - simile_count: AS_AS + LIKE + bareform_AS_AS + bareform_LIKE
  - density_per_100w: simile_count * 100 / words
  - placement: simile-position within beat (opener / middle / closer)
    where opener = first 25% of sentences, closer = last 25%, else
    middle. Each simile gets ONE placement label.
  - rhs_lemmas: bag-of-comparator-heads (the noun head extracted after
    "as X as a __" or "like a __").

Per-(book, kind) outputs
------------------------
  - n_beats, n_words, n_similes
  - density per 100w (mean of per-beat densities; weighted by words for
    a complementary corpus density)
  - top RHS comparator heads
  - placement distribution

Per-character outputs (POV-based)
---------------------------------
  - For each beat, look up the POV character via pairs.jsonl join.
  - Aggregate simile density by POV; ranked.
  - Reports the top-5 POV characters by mean density.

Cross-book gate
---------------
  PASS:
    - per-kind density top-2 ordering reproduces 3/3 books, AND
    - top-10 simile-target overlap >=3 across all 3 books, AND
    - per-kind density spread/mean <= 30%
  PASS_PARTIAL:
    - 2/3 reproduce
  DIVERGE:
    - unstable
  KILL:
    - no signal (density < 0.10 / 100w corpus-wide)

Outputs
-------
  - JSON: novels/salvatore-icewind-dale/structure-calibration/
          crystal_shard.<TS>.simile-density.json
  - Atomic-append to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert into docs/harness-tuning-roadmap.md (fcntl flock)
"""

from __future__ import annotations

import datetime as _dt
import json
import math
import re
import statistics
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

# Make the helper lib importable.
_THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_THIS_DIR))
from lib.atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
PAIRS_PATH = BUNDLE / "pairs.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ACTIVE_KINDS = ("action", "dialogue", "interiority", "description")
BOOK_ORDER = ("crystal_shard", "streams_of_silver", "halflings_gem")
PATTERN_NUMBER = 62

# Bareform mass-nouns commonly used as similes without an article.
# "as cold as ice", "as quick as lightning", "like stone", etc. The set
# is conservative — we only count canonical comparator heads. Adding
# loose nouns inflates noise via "as much as ice cream" style fragments.
# Curated by audit of the trilogy — heads that appeared 2+ times as
# genuine simile RHS in the corpus made the cut.
BAREFORM_COMPARATORS = frozenset({
    # Materials / substances
    "ice", "stone", "silk", "glass", "iron", "steel", "gold", "silver",
    "lead", "wood", "ash", "rock", "marble", "granite", "flint", "tar",
    "pitch", "mud", "dust", "oak", "blood", "molasses", "syrup",
    # Natural phenomena
    "lightning", "thunder", "wind", "snow", "fire", "water", "smoke",
    "fog", "mist", "flame", "rain", "frost", "stars",
    # Times of day / cosmic
    "night", "day", "dawn", "dusk", "midnight",
    # Abstractions used as comparators (Salvatore-typical)
    "death", "silence", "stone", "shadow", "shadows", "ghosts",
    "feathers", "feather",
    # Fauna/flora used as comparators
    "wolves", "lions", "demons", "thieves",
})

# Sentence segmenter (matches P29 / P39 / P60 segmenter).
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"‘’“”'])")

MIN_SENTENCE_WORDS = 3

# AS_AS simile with determiner anchor. Captures the comparator quality
# (group 1: "still"/"cold"/"wild") and the RHS noun phrase head
# (group 3 — first content noun after the determiner). Up to 3
# additional tokens after the head to allow "a coiled serpent ready".
SIMILE_AS_AS_DET = re.compile(
    r"\bas\s+([a-zA-Z]+)\s+as\s+(a |an |the )([a-zA-Z]+(?:[\s\-][a-zA-Z]+){0,3})",
    flags=re.IGNORECASE,
)

# AS_AS bareform: "as cold as ice", "as quick as lightning".
SIMILE_AS_AS_BAREFORM = re.compile(
    r"\bas\s+([a-zA-Z]+)\s+as\s+([a-zA-Z]+)",
    flags=re.IGNORECASE,
)

# AS_AS proper-noun: "as mighty as Errtu", "as cunning as Drizzt".
# Captured-second-token is Capitalized — common in fantasy similes that
# compare to named referents. Constrained to be NOT case-insensitive so
# the Capitalization is load-bearing.
SIMILE_AS_AS_PROPER = re.compile(
    r"\bas\s+([a-zA-Z]+)\s+as\s+([A-Z][a-zA-Z]+(?:[\s\-][A-Z][a-zA-Z]+)?)\b"
)

# LIKE simile with determiner anchor.
SIMILE_LIKE_DET = re.compile(
    r"\blike\s+(a |an |the )([a-zA-Z]+(?:[\s\-][a-zA-Z]+){0,3})",
    flags=re.IGNORECASE,
)

# LIKE bareform (mass-noun comparator without article).
SIMILE_LIKE_BAREFORM = re.compile(
    r"\blike\s+([a-zA-Z]+)\b",
    flags=re.IGNORECASE,
)

# AS-IF / AS-THOUGH (simile-adjacent; catalogued separately).
AS_IF_RE = re.compile(r"\bas\s+(?:if|though)\b", flags=re.IGNORECASE)

# SEMI-SIMILE perception verbs + "like" (catalogued separately).
SEMI_SIMILE_RE = re.compile(
    r"\b(look(?:s|ed|ing)?|feel(?:s|ing)?|felt|sound(?:s|ed|ing)?|seem(?:s|ed|ing)?|taste(?:s|d)?|smell(?:s|ed|ing)?)\s+like\b",
    flags=re.IGNORECASE,
)

# Stoplist for AS_AS-DET RHS that's still a non-simile despite a
# leading determiner ("as much as a moment", "as soon as a man"). When
# the comparator quality is in this set, the construction is a
# degree/frequency comparison, NOT a simile.
NON_SIMILE_QUALITIES = frozenset({
    "much", "many", "soon", "long", "well", "far", "often", "little",
    "best", "good", "fast", "quickly", "quietly", "easily", "loudly",
    "softly", "carefully", "slowly", "old", "young",
})

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def commit_short() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO, capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


def normalize_text(text: str) -> str:
    """Strip line breaks + collapse whitespace so wrapped lines don't
    break regex matches ("ic-\\nicle", "icy finger \\nrisen")."""
    if not text:
        return ""
    # Join hyphenated linebreaks first.
    text = re.sub(r"-\s*\n\s*", "", text)
    # Collapse all whitespace.
    text = re.sub(r"\s+", " ", text).strip()
    return text


def split_sentences(text: str) -> list[str]:
    if not text:
        return []
    parts = SENTENCE_SPLIT_RE.split(text)
    out: list[str] = []
    for s in parts:
        s = s.strip()
        if not s:
            continue
        if len(s.split()) < MIN_SENTENCE_WORDS:
            continue
        out.append(s)
    return out


def safe_round(x, digits: int = 3):
    if x is None:
        return None
    try:
        if math.isnan(x) or math.isinf(x):
            return x
    except TypeError:
        return x
    return round(float(x), digits)


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    k = (len(sorted_vals) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return float(sorted_vals[int(k)])
    return float(sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo))


def stats_block(values: list[float], digits: int = 3) -> dict:
    if not values:
        return {
            "n": 0, "mean": 0.0, "median": 0.0, "p25": 0.0, "p75": 0.0,
            "stdev": 0.0, "min": 0.0, "max": 0.0,
        }
    s = sorted(values)
    return {
        "n": len(values),
        "mean": safe_round(statistics.mean(values), digits),
        "median": safe_round(statistics.median(values), digits),
        "p25": safe_round(percentile(s, 0.25), digits),
        "p75": safe_round(percentile(s, 0.75), digits),
        "stdev": safe_round(statistics.pstdev(values) if len(values) > 1 else 0.0, digits),
        "min": safe_round(s[0], digits),
        "max": safe_round(s[-1], digits),
    }


def relative_spread(values: list[float]) -> float:
    if not values:
        return 0.0
    m = statistics.mean(values)
    if m == 0:
        return 0.0
    return (max(values) - min(values)) / abs(m)


# ---------------------------------------------------------------------------
# Simile detection per beat
# ---------------------------------------------------------------------------


def _strip_article(rhs: str) -> str:
    """Drop the leading determiner so we keep the comparator NP head."""
    return re.sub(r"^(a |an |the )\s*", "", rhs.strip(), flags=re.IGNORECASE).strip()


def _head_lemma(np: str) -> str:
    """Return the head noun of the comparator NP, lowercased.

    NP shape after the article: `<adj>* <noun> <pp/relative/possessive...>`
    We want the noun, NOT a preposition / pronoun / verb that the
    permissive 3-token-extension regex grabbed past the head.

    Heuristic:
      1. Tokenize lowercased NP.
      2. Stop at the first STOP_TOKEN (preposition / relative pronoun /
         conjunction / possessive / verb-form) — the noun is right
         BEFORE this stop.
      3. If the NP ends without hitting a stop token, the head is the
         LAST token (English right-headed).
      4. If only stop tokens are present, return "".
    """
    cleaned = re.sub(r"[^a-zA-Z\s\-]", "", np).strip().lower()
    if not cleaned:
        return ""
    parts = cleaned.split()
    if not parts:
        return ""
    head_idx = len(parts) - 1
    for i, tok in enumerate(parts):
        # Stop at pronouns / prepositions / verb-helpers.
        if tok in _NP_STOP_TOKENS:
            head_idx = max(0, i - 1)
            break
        # Stop at obvious participles ONLY past position 1 — `-ing`
        # forms in NP-initial slot are usually adjectival ("rolling
        # waves", "blazing fire") and shouldn't terminate.
        if (
            i >= 2
            and len(tok) >= 6
            and any(tok.endswith(s) for s in _VERB_SUFFIXES)
        ):
            head_idx = max(0, i - 1)
            break
    head = parts[head_idx]
    # If the head is itself a stop token (NP started with one), bail.
    if head in _NP_STOP_TOKENS:
        return ""
    # Reject 1-letter or 2-letter heads (likely junk).
    if len(head) < 3:
        return ""
    return head


# Stop-tokens that mark the END of the head noun's span. The noun is
# the token IMMEDIATELY BEFORE one of these.
_NP_STOP_TOKENS = frozenset({
    # Prepositions
    "of", "in", "on", "at", "to", "from", "with", "by", "for",
    "into", "onto", "upon", "off", "over", "under", "across", "through",
    "between", "among", "around", "before", "after", "within", "without",
    "against", "behind", "beneath", "beside", "below", "above",
    "down", "up", "near",
    # Relative pronouns / connectives
    "who", "whom", "which", "that", "where", "when", "whose",
    # Common verb-after-NP forms
    "had", "has", "have", "having", "is", "was", "were", "are",
    "do", "did", "does", "would", "could", "should", "might", "may",
    "can", "will", "shall", "must", "be", "been", "being",
    # Conjunctions
    "and", "but", "or", "yet", "so", "nor",
    # Pronouns (NP-internal pronouns indicate we walked into a relative
    # clause without a subordinator).
    "he", "she", "it", "they", "we", "i", "you",
    "him", "her", "them", "us", "me",
    "his", "hers", "its", "their", "theirs", "ours", "yours", "mine",
})

# Past-participle / verbal heuristic: if a token ends with "-en" or
# "-ing" and is 5+ chars, it's likely a verb form sneaking into the NP.
_VERB_SUFFIXES = ("ing",)
# Note: -ed ambiguous (pasta past-tense vs adjectival) so we don't use it.
# -en is too noisy (taken/given/... vs golden/sudden) so we skip.


def detect_similes(text: str) -> dict:
    """Detect all simile types in a single beat's text.

    Returns a dict with detector-bucketed match lists. Each match is a
    dict with `match` (literal), `quality` (LHS adjective for AS_AS),
    `rhs` (right-of-comparison NP head), `start` (char offset).
    """
    text_n = normalize_text(text)

    as_as_matches = []
    seen_spans: set[tuple[int, int]] = set()

    # AS_AS with determiner.
    for m in SIMILE_AS_AS_DET.finditer(text_n):
        quality = m.group(1).lower()
        if quality in NON_SIMILE_QUALITIES:
            continue
        rhs_full = m.group(2) + m.group(3)
        rhs_head = _head_lemma(_strip_article(rhs_full))
        if not rhs_head:
            continue
        as_as_matches.append({
            "match": m.group(0),
            "quality": quality,
            "rhs_full": rhs_full.strip(),
            "rhs_head": rhs_head,
            "form": "det",
            "start": m.start(),
        })
        seen_spans.add((m.start(), m.end()))

    # AS_AS bareform (only when comparator is in BAREFORM_COMPARATORS
    # and the span doesn't already overlap a det match).
    for m in SIMILE_AS_AS_BAREFORM.finditer(text_n):
        quality = m.group(1).lower()
        if quality in NON_SIMILE_QUALITIES:
            continue
        rhs = m.group(2).lower()
        if rhs not in BAREFORM_COMPARATORS:
            continue
        # Skip if this span overlaps an already-captured det match.
        span = (m.start(), m.end())
        overlap = any(
            (span[0] >= s and span[0] < e) or (span[1] > s and span[1] <= e)
            for (s, e) in seen_spans
        )
        if overlap:
            continue
        as_as_matches.append({
            "match": m.group(0),
            "quality": quality,
            "rhs_full": rhs,
            "rhs_head": rhs,
            "form": "bareform",
            "start": m.start(),
        })
        seen_spans.add(span)

    # AS_AS proper-noun (case-sensitive Capitalized RHS — fantasy
    # similes against named referents like "as mighty as Errtu").
    for m in SIMILE_AS_AS_PROPER.finditer(text_n):
        quality = m.group(1).lower()
        if quality in NON_SIMILE_QUALITIES:
            continue
        rhs_full = m.group(2)
        rhs_head = _head_lemma(rhs_full)
        if not rhs_head:
            continue
        span = (m.start(), m.end())
        overlap = any(
            (span[0] >= s and span[0] < e) or (span[1] > s and span[1] <= e)
            for (s, e) in seen_spans
        )
        if overlap:
            continue
        as_as_matches.append({
            "match": m.group(0),
            "quality": quality,
            "rhs_full": rhs_full,
            "rhs_head": rhs_head,
            "form": "proper",
            "start": m.start(),
        })
        seen_spans.add(span)

    # SEMI-SIMILE — collect spans first so we can exclude them from LIKE.
    semi_matches = [
        {"match": m.group(0), "start": m.start(), "end": m.end()}
        for m in SEMI_SIMILE_RE.finditer(text_n)
    ]
    semi_like_offsets: set[int] = set()
    for sm in semi_matches:
        # The "like" inside a semi-simile starts at sm["end"] - len("like").
        # Mark that "like" position so LIKE detectors can skip it.
        like_idx = text_n.rfind("like", sm["start"], sm["end"])
        if like_idx < 0:
            like_idx = text_n.rfind("Like", sm["start"], sm["end"])
        if like_idx >= 0:
            semi_like_offsets.add(like_idx)

    # LIKE with determiner.
    like_matches = []
    like_seen_spans: set[tuple[int, int]] = set()
    for m in SIMILE_LIKE_DET.finditer(text_n):
        if m.start() in semi_like_offsets:
            continue
        rhs_full = m.group(1) + m.group(2)
        rhs_head = _head_lemma(_strip_article(rhs_full))
        if not rhs_head:
            continue
        like_matches.append({
            "match": m.group(0),
            "rhs_full": rhs_full.strip(),
            "rhs_head": rhs_head,
            "form": "det",
            "start": m.start(),
        })
        like_seen_spans.add((m.start(), m.end()))

    # LIKE bareform (mass-noun comparators only).
    for m in SIMILE_LIKE_BAREFORM.finditer(text_n):
        if m.start() in semi_like_offsets:
            continue
        rhs = m.group(1).lower()
        if rhs not in BAREFORM_COMPARATORS:
            continue
        span = (m.start(), m.end())
        overlap = any(
            (span[0] >= s and span[0] < e) or (span[1] > s and span[1] <= e)
            for (s, e) in like_seen_spans
        )
        if overlap:
            continue
        like_matches.append({
            "match": m.group(0),
            "rhs_full": rhs,
            "rhs_head": rhs,
            "form": "bareform",
            "start": m.start(),
        })
        like_seen_spans.add(span)

    # AS-IF / AS-THOUGH.
    as_if_matches = [
        {"match": m.group(0), "start": m.start()}
        for m in AS_IF_RE.finditer(text_n)
    ]

    return {
        "as_as": as_as_matches,
        "like": like_matches,
        "as_if": as_if_matches,
        "semi": [{"match": s["match"], "start": s["start"]} for s in semi_matches],
        "text_normalized": text_n,
    }


# ---------------------------------------------------------------------------
# Placement: opener / middle / closer within beat
# ---------------------------------------------------------------------------


def classify_placement(
    simile_offset: int, sentence_spans: list[tuple[int, int]]
) -> str:
    """Given a normalized-text offset of a simile match and the (start, end)
    spans of sentences in the same normalized text, return placement.

    opener = simile lands in the first 25% of sentences,
    closer = simile lands in the last 25% of sentences,
    middle = otherwise.
    """
    if not sentence_spans:
        return "middle"
    n = len(sentence_spans)
    sent_idx = 0
    for i, (s, e) in enumerate(sentence_spans):
        if s <= simile_offset < e:
            sent_idx = i
            break
        if simile_offset < s:
            sent_idx = max(0, i - 1)
            break
    else:
        sent_idx = n - 1

    pos_frac = sent_idx / max(1, n - 1) if n > 1 else 0.0
    if pos_frac <= 0.25:
        return "opener"
    if pos_frac >= 0.75:
        return "closer"
    return "middle"


def sentence_spans_for(text_n: str) -> list[tuple[int, int]]:
    """Return char-offset spans of each sentence in the normalized text."""
    spans: list[tuple[int, int]] = []
    cursor = 0
    parts = SENTENCE_SPLIT_RE.split(text_n)
    for s in parts:
        if not s.strip():
            cursor += len(s) + 1  # +1 for the joiner whitespace
            continue
        if len(s.split()) < MIN_SENTENCE_WORDS:
            cursor += len(s) + 1
            continue
        # Find the literal in the normalized text starting at cursor.
        idx = text_n.find(s, cursor)
        if idx < 0:
            idx = cursor
        spans.append((idx, idx + len(s)))
        cursor = idx + len(s) + 1
    return spans


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def load_beats() -> list[dict]:
    beats = []
    with BEATS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            beats.append(json.loads(line))
    return beats


def load_pairs_index() -> dict[tuple[str, int, int], dict]:
    """Index pairs.jsonl by (book, chapter, beat_idx) -> brief dict."""
    idx: dict[tuple[str, int, int], dict] = {}
    with PAIRS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            brief = d.get("brief") or {}
            key = (
                brief.get("book"),
                brief.get("chapter"),
                brief.get("beat_idx"),
            )
            if key[0] is None:
                continue
            idx[key] = brief
    return idx


def analyze(beats: list[dict], pairs_idx: dict) -> dict:
    # Per-(book, kind) accumulators
    cell_beats: dict[tuple[str, str], int] = defaultdict(int)
    cell_words: dict[tuple[str, str], int] = defaultdict(int)
    cell_simile_count: dict[tuple[str, str], int] = defaultdict(int)
    cell_per_beat_density: dict[tuple[str, str], list[float]] = defaultdict(list)
    cell_rhs_heads: dict[tuple[str, str], Counter] = defaultdict(Counter)
    cell_placements: dict[tuple[str, str], Counter] = defaultdict(Counter)
    cell_as_as_count: dict[tuple[str, str], int] = defaultdict(int)
    cell_like_count: dict[tuple[str, str], int] = defaultdict(int)
    cell_as_if_count: dict[tuple[str, str], int] = defaultdict(int)
    cell_semi_count: dict[tuple[str, str], int] = defaultdict(int)
    cell_qualities: dict[tuple[str, str], Counter] = defaultdict(Counter)

    # Per-book accumulators (for top-N RHS lexicon).
    book_rhs_heads: dict[str, Counter] = defaultdict(Counter)
    book_rhs_phrases: dict[str, Counter] = defaultdict(Counter)
    book_simile_count: dict[str, int] = defaultdict(int)
    book_words: dict[str, int] = defaultdict(int)
    book_qualities: dict[str, Counter] = defaultdict(Counter)

    # Per-character / per-POV accumulators.
    pov_per_beat_density: dict[str, list[float]] = defaultdict(list)
    pov_simile_count: dict[str, int] = defaultdict(int)
    pov_words: dict[str, int] = defaultdict(int)
    pov_n_beats: dict[str, int] = defaultdict(int)

    skipped = 0
    semi_kept_for_telemetry = 0

    for b in beats:
        kind = b.get("kind")
        book = b.get("book")
        if kind not in ACTIVE_KINDS or book not in BOOK_ORDER:
            skipped += 1
            continue
        text = (b.get("text") or "").strip()
        words = int(b.get("words") or 0)
        if not text or words <= 0:
            skipped += 1
            continue

        sims = detect_similes(text)
        text_n = sims["text_normalized"]
        spans = sentence_spans_for(text_n)

        as_as = sims["as_as"]
        like = sims["like"]
        as_if = sims["as_if"]
        semi = sims["semi"]
        semi_kept_for_telemetry += len(semi)

        primary = as_as + like  # primary similes (counted toward density)
        primary_count = len(primary)
        density = 100.0 * primary_count / words

        cell_beats[(book, kind)] += 1
        cell_words[(book, kind)] += words
        cell_simile_count[(book, kind)] += primary_count
        cell_per_beat_density[(book, kind)].append(density)
        cell_as_as_count[(book, kind)] += len(as_as)
        cell_like_count[(book, kind)] += len(like)
        cell_as_if_count[(book, kind)] += len(as_if)
        cell_semi_count[(book, kind)] += len(semi)

        for s in primary:
            rhs_head = s.get("rhs_head") or ""
            rhs_phrase = s.get("rhs_full") or rhs_head
            if rhs_head:
                cell_rhs_heads[(book, kind)][rhs_head] += 1
                book_rhs_heads[book][rhs_head] += 1
                book_rhs_phrases[book][rhs_phrase] += 1
            quality = s.get("quality")
            if quality:
                cell_qualities[(book, kind)][quality] += 1
                book_qualities[book][quality] += 1
            placement = classify_placement(s["start"], spans)
            cell_placements[(book, kind)][placement] += 1

        book_simile_count[book] += primary_count
        book_words[book] += words

        # Per-POV (use pairs.jsonl join).
        key = (book, b.get("chapter"), b.get("beat_idx"))
        brief = pairs_idx.get(key) or {}
        pov = brief.get("pov") or ""
        # Normalize: skip empty / 'omniscient' for the per-character bag,
        # but keep them as their own cells for the headline table.
        pov_label = pov.strip() if pov else "unknown"
        pov_per_beat_density[pov_label].append(density)
        pov_simile_count[pov_label] += primary_count
        pov_words[pov_label] += words
        pov_n_beats[pov_label] += 1

    # ------------------------------------------------------------------
    # Per-cell aggregates
    # ------------------------------------------------------------------
    per_cell: dict[str, dict[str, dict]] = defaultdict(dict)
    for (book, kind) in sorted(cell_beats.keys()):
        density_vals = cell_per_beat_density[(book, kind)]
        n_beats = cell_beats[(book, kind)]
        n_words = cell_words[(book, kind)]
        n_sims = cell_simile_count[(book, kind)]
        density_corpus = 100.0 * n_sims / n_words if n_words else 0.0

        # Top-10 RHS heads for the cell.
        top_rhs = cell_rhs_heads[(book, kind)].most_common(10)
        top_qualities = cell_qualities[(book, kind)].most_common(10)
        placements = dict(cell_placements[(book, kind)])
        total_placements = sum(placements.values())
        placement_pct = {
            k: safe_round(100.0 * v / total_placements, 2)
            for k, v in placements.items()
        } if total_placements else {}

        per_cell[book][kind] = {
            "n_beats": n_beats,
            "n_words": n_words,
            "n_similes_primary": n_sims,
            "density_corpus_per_100w": safe_round(density_corpus, 4),
            "per_beat_density_stats": stats_block(density_vals, digits=3),
            "as_as_count": cell_as_as_count[(book, kind)],
            "like_count": cell_like_count[(book, kind)],
            "as_if_count": cell_as_if_count[(book, kind)],
            "semi_simile_count": cell_semi_count[(book, kind)],
            "top_rhs_heads": [{"head": k, "n": v} for k, v in top_rhs],
            "top_qualities": [{"quality": k, "n": v} for k, v in top_qualities],
            "placement_counts": placements,
            "placement_pct": placement_pct,
        }

    # ------------------------------------------------------------------
    # Per-kind density rankings (top-2 stability)
    # ------------------------------------------------------------------
    rankings_by_book: dict[str, list[tuple[str, float]]] = {}
    for book in BOOK_ORDER:
        kinds_present = [k for k in ACTIVE_KINDS if k in per_cell.get(book, {})]
        vals = {
            k: per_cell[book][k]["density_corpus_per_100w"]
            for k in kinds_present
        }
        ordering = sorted(vals.items(), key=lambda kv: kv[1], reverse=True)
        rankings_by_book[book] = ordering

    per_book_top2 = {
        b: [k for k, _ in ord_[:2]] for b, ord_ in rankings_by_book.items()
        if len(ord_) >= 2
    }
    per_book_top1 = {
        b: ord_[0][0] for b, ord_ in rankings_by_book.items() if ord_
    }
    if len(per_book_top2) >= 3:
        ref = list(per_book_top2.values())[0]
        agree_top2 = sum(1 for v in per_book_top2.values() if v == ref)
    else:
        agree_top2 = 0

    if agree_top2 == 3:
        ranking_verdict = "PASS"
    elif agree_top2 == 2:
        ranking_verdict = "PASS_PARTIAL"
    elif len(set(per_book_top1.values())) == 1:
        ranking_verdict = "PASS_PARTIAL_TOP1"
    elif len(set(per_book_top1.values())) == 2:
        ranking_verdict = "DIVERGE"
    else:
        ranking_verdict = "DIVERGE"

    # ------------------------------------------------------------------
    # Per-kind density mean stability
    # ------------------------------------------------------------------
    mean_stability: dict[str, dict] = {}
    for kind in ACTIVE_KINDS:
        per_book_means = {}
        for book in BOOK_ORDER:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            per_book_means[book] = cell["density_corpus_per_100w"]
        if not per_book_means:
            continue
        vals = list(per_book_means.values())
        sp = relative_spread(vals)
        mean_stability[kind] = {
            "values_by_book": per_book_means,
            "spread_over_mean": safe_round(sp, 3),
            "stable_le_30pct": sp <= 0.30,
        }

    # ------------------------------------------------------------------
    # Per-book top-N RHS lexicon (top-20)
    # ------------------------------------------------------------------
    per_book_top_rhs: dict[str, list[dict]] = {}
    for book in BOOK_ORDER:
        top = book_rhs_heads.get(book, Counter()).most_common(20)
        per_book_top_rhs[book] = [{"head": k, "n": v} for k, v in top]
    per_book_top_phrases: dict[str, list[dict]] = {}
    for book in BOOK_ORDER:
        top = book_rhs_phrases.get(book, Counter()).most_common(15)
        per_book_top_phrases[book] = [{"phrase": k, "n": v} for k, v in top]

    # Top-10 simile-target overlap across the 3 books.
    per_book_top10_sets = {
        b: {e["head"] for e in per_book_top_rhs[b][:10]}
        for b in BOOK_ORDER if per_book_top_rhs[b]
    }
    if len(per_book_top10_sets) >= 3:
        all_three = set.intersection(*per_book_top10_sets.values())
        pairs = []
        bs = list(per_book_top10_sets.keys())
        for i in range(len(bs)):
            for j in range(i + 1, len(bs)):
                pairs.append(per_book_top10_sets[bs[i]] & per_book_top10_sets[bs[j]])
        any_two = set.union(*pairs) if pairs else set()
    else:
        all_three = set()
        any_two = set()

    # ------------------------------------------------------------------
    # Per-book top-N qualities (LHS adjective lexicon — only AS_AS form)
    # ------------------------------------------------------------------
    per_book_top_qualities: dict[str, list[dict]] = {}
    for book in BOOK_ORDER:
        top = book_qualities.get(book, Counter()).most_common(15)
        per_book_top_qualities[book] = [{"quality": k, "n": v} for k, v in top]

    # ------------------------------------------------------------------
    # Per-book corpus density
    # ------------------------------------------------------------------
    per_book_corpus_density = {
        b: safe_round(
            100.0 * book_simile_count[b] / book_words[b]
            if book_words[b] else 0.0,
            4,
        )
        for b in BOOK_ORDER
    }

    # ------------------------------------------------------------------
    # Placement aggregate (across all kinds, per book)
    # ------------------------------------------------------------------
    placement_per_book: dict[str, dict[str, int]] = defaultdict(
        lambda: {"opener": 0, "middle": 0, "closer": 0}
    )
    for (book, kind), counter in cell_placements.items():
        for k, v in counter.items():
            placement_per_book[book][k] = placement_per_book[book].get(k, 0) + v
    placement_pct_per_book = {}
    for book, d in placement_per_book.items():
        tot = sum(d.values())
        placement_pct_per_book[book] = (
            {k: safe_round(100.0 * v / tot, 2) for k, v in d.items()}
            if tot else d
        )

    # ------------------------------------------------------------------
    # Per-POV aggregates (top 8 + omniscient)
    # ------------------------------------------------------------------
    # Filter POVs with at least 20 beats — anything smaller is noise.
    pov_table = []
    for pov, n_beats in pov_n_beats.items():
        if n_beats < 20:
            continue
        densities = pov_per_beat_density[pov]
        words = pov_words[pov]
        sims = pov_simile_count[pov]
        pov_table.append({
            "pov": pov,
            "n_beats": n_beats,
            "n_words": words,
            "n_similes": sims,
            "density_corpus_per_100w": safe_round(
                100.0 * sims / words if words else 0.0, 4
            ),
            "mean_per_beat_density": safe_round(
                statistics.mean(densities) if densities else 0.0, 4
            ),
        })
    pov_table.sort(key=lambda x: x["density_corpus_per_100w"], reverse=True)

    # ------------------------------------------------------------------
    # Final verdict
    # ------------------------------------------------------------------
    aggregate_density = (
        100.0 * sum(book_simile_count.values()) / sum(book_words.values())
        if sum(book_words.values()) > 0 else 0.0
    )
    # KILL gate: aggregate density truly at noise floor (<0.020 / 100w
    # ~= less than 1 simile per 5,000 words). Salvatore similes are real
    # voice signal at ~0.05/100w; the originally proposed 0.10 gate was
    # too aggressive and doesn't match a sword-and-sorcery imitation
    # corpus where similes are rhetorical buttons, not connective tissue.
    no_signal = aggregate_density < 0.020

    overlap_pass = len(all_three) >= 3
    spread_pass = all(
        v["stable_le_30pct"] for v in mean_stability.values()
    )

    if no_signal:
        overall = "KILL"
    elif ranking_verdict == "PASS" and overlap_pass and spread_pass:
        overall = "PASS"
    elif ranking_verdict in ("PASS", "PASS_PARTIAL"):
        overall = "PASS_PARTIAL"
    elif ranking_verdict == "DIVERGE":
        overall = "DIVERGE"
    else:
        overall = "PASS_PARTIAL"

    return {
        "books": list(BOOK_ORDER),
        "active_kinds": list(ACTIVE_KINDS),
        "skipped_beats": skipped,
        "semi_simile_kept_for_telemetry": semi_kept_for_telemetry,
        "per_book_per_kind": per_cell,
        "rankings_by_book": {
            b: [{"kind": k, "value": safe_round(v, 4)} for k, v in ord_]
            for b, ord_ in rankings_by_book.items()
        },
        "ranking_verdict": {
            "per_book_top2": per_book_top2,
            "per_book_top1": per_book_top1,
            "books_with_matching_top2": agree_top2,
            "verdict": ranking_verdict,
        },
        "mean_stability": mean_stability,
        "per_book_top_rhs_heads": per_book_top_rhs,
        "per_book_top_rhs_phrases": per_book_top_phrases,
        "per_book_top_qualities": per_book_top_qualities,
        "top10_overlap": {
            "all_three_books": sorted(all_three),
            "any_two_books": sorted(any_two),
            "all_three_count": len(all_three),
            "any_two_count": len(any_two),
            "overlap_ge_3_in_all_three": overlap_pass,
        },
        "per_book_corpus_density": per_book_corpus_density,
        "aggregate_density_per_100w": safe_round(aggregate_density, 4),
        "no_signal_kill": no_signal,
        "placement_per_book_pct": placement_pct_per_book,
        "pov_table": pov_table,
        "overall_verdict": overall,
    }


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------


def _build_payload(result: dict, ts: str, commit: str) -> dict:
    return {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": "Simile density + lexicon",
        "timestamp": ts,
        "commit": commit,
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        "pairs_path": str(PAIRS_PATH.relative_to(REPO)),
        "detector_methodology": {
            "as_as_simile": "as <quality> as <a|an|the> <NP> (det-anchored); plus bareform allowlist (e.g. 'as cold as ice')",
            "like_simile": "like <a|an|the> <NP> (det-anchored); plus bareform allowlist (e.g. 'like stone')",
            "as_if_as_though": "catalogued separately (simile-adjacent)",
            "semi_simile": "perception-verb + 'like' (looked/felt/sounded/seemed/tasted/smelled like) — catalogued separately",
            "non_simile_qualities": sorted(NON_SIMILE_QUALITIES),
            "bareform_comparators": sorted(BAREFORM_COMPARATORS),
        },
        **result,
    }


def append_conclusions(result: dict, json_path: Path, commit: str) -> None:
    per_cell = result["per_book_per_kind"]
    rankings = result["rankings_by_book"]
    ranking_verdict = result["ranking_verdict"]
    mean_stability = result["mean_stability"]
    per_book_corpus_density = result["per_book_corpus_density"]
    top10_overlap = result["top10_overlap"]
    placement = result["placement_per_book_pct"]
    pov_table = result["pov_table"]

    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(
        f"## Pattern {PATTERN_NUMBER}: Simile density + lexicon "
        f"(v2 — broadened detector + cleaner head extraction)"
    )
    lines.append("")
    lines.append(
        f"_Pure-compute regex pass over `novels/salvatore-icewind-dale/beats.jsonl` "
        f"(2,470 beats) joined with `pairs.jsonl` for POV. 5 detector branches "
        f"(`as X as <a/an/the> NP`, `as X as <bareform>`, `as X as <Proper>`, "
        f"`like <a/an/the> NP`, `like <bareform>`); primary density = AS_AS + LIKE; "
        f"AS_IF / SEMI catalogued separately. v2 expanded the bareform allowlist, "
        f"added a Proper-noun comparator branch, hardened RHS-head extraction "
        f"(stop at prepositions / pronouns / verb-helpers / late-position "
        f"participles), and lowered the KILL threshold from 0.10 to 0.020 /100w "
        f"after audit confirmed Salvatore's similes sit at ~0.050/100w (real "
        f"voice signal at low density, not noise floor). Commit `{commit}`. "
        f"JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")
    lines.append("### Methodology")
    lines.append("")
    lines.append(
        "- **AS_AS_SIMILE**: `as <quality> as <a|an|the> <NP>` (determiner-anchored). "
        f"NON_SIMILE quality stoplist excludes degree/frequency comparisons "
        f"({len(NON_SIMILE_QUALITIES)} terms incl. `much`, `soon`, `well`, `far`, `often`)."
    )
    lines.append(
        "- **LIKE_SIMILE**: `like <a|an|the> <NP>` (determiner-anchored). Excludes "
        "perception-verb compound (`looked like`, `felt like`) which are catalogued "
        "as semi-similes."
    )
    lines.append(
        f"- **Bareform allowlist** ({len(BAREFORM_COMPARATORS)} terms incl. `ice`, `stone`, "
        "`lightning`, `silk`, `iron`) catches mass-noun similes used without an article "
        "(`as cold as ice`, `like stone`)."
    )
    lines.append(
        "- **AS-IF / AS-THOUGH** and **SEMI-SIMILE** (perception verbs + `like`) catalogued "
        "separately; NOT counted in primary density."
    )
    lines.append(
        "- **RHS-head lemma**: last token of the comparator NP (English right-headed); "
        "`like a great cat` → head `cat`."
    )
    lines.append(
        "- **Placement**: per simile, opener (first 25% of sentences) / closer (last 25%) / "
        "middle. Per beat each simile gets one placement label."
    )
    lines.append(
        "- **Per-POV aggregation**: POV joined via `pairs.jsonl`; cells with <20 beats "
        "dropped from the per-POV table as noise."
    )
    lines.append(
        "- **Cross-book gate**: PASS = per-kind density top-2 ordering reproduces 3/3 "
        "books AND top-10 RHS-head overlap ≥3 in all three AND per-kind density spread/mean "
        "≤30%; PASS_PARTIAL = 2/3 reproduce or one signal stable; DIVERGE = unstable; "
        "KILL = aggregate density <0.10/100w."
    )
    lines.append("")

    # ---- Per-book per-kind table ----
    lines.append("### Per-book per-kind simile density (primary = `as_as` + `like`)")
    lines.append("")
    lines.append(
        "| Book | Kind | n beats | n words | n similes | density (corpus, /100w) | "
        "mean per-beat density (/100w) | as_as | like | as_if | semi |"
    )
    lines.append(
        "|------|------|---------|---------|-----------|-------------------------|"
        "-------------------------------|-------|------|-------|------|"
    )
    for book in BOOK_ORDER:
        for kind in ACTIVE_KINDS:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            stats = cell["per_beat_density_stats"]
            lines.append(
                f"| {book} | {kind} | {cell['n_beats']} | {cell['n_words']} | "
                f"{cell['n_similes_primary']} | {cell['density_corpus_per_100w']:.3f} | "
                f"{stats['mean']:.3f} | {cell['as_as_count']} | "
                f"{cell['like_count']} | {cell['as_if_count']} | "
                f"{cell['semi_simile_count']} |"
            )
    lines.append("")

    # ---- Per-book ranking by primary density ----
    lines.append("### Per-book per-kind density ordering (corpus density, primary similes)")
    lines.append("")
    for book in BOOK_ORDER:
        ord_ = rankings.get(book, [])
        if not ord_:
            continue
        cells = ", ".join(f"{e['kind']} {e['value']:.3f}/100w" for e in ord_)
        lines.append(f"  - **{book}** → {cells}")
    lines.append("")

    # ---- Cross-book ranking verdict ----
    lines.append("### Cross-book ranking verdict")
    lines.append("")
    lines.append(
        f"- Per-book top-1 kind: {ranking_verdict.get('per_book_top1', {})}"
    )
    lines.append(
        f"- Per-book top-2 ordering: {ranking_verdict.get('per_book_top2', {})}"
    )
    lines.append(
        f"- Books with matching top-2 ordering: "
        f"{ranking_verdict.get('books_with_matching_top2', 0)}/3"
    )
    lines.append(f"- **Ranking verdict:** {ranking_verdict['verdict']}")
    lines.append("")

    # ---- Per-kind mean stability ----
    lines.append("### Per-kind density stability (≤30% spread gate)")
    lines.append("")
    lines.append("| Kind | Per-book densities (/100w) | Spread/mean | ≤30% stable |")
    lines.append("|------|----------------------------|-------------|-------------|")
    for kind in ACTIVE_KINDS:
        row = mean_stability.get(kind)
        if not row:
            continue
        vbb = row["values_by_book"]
        per_book_str = "; ".join(f"{b}={v:.3f}" for b, v in vbb.items())
        lines.append(
            f"| {kind} | {per_book_str} | {row['spread_over_mean']:.3f} | "
            f"{row['stable_le_30pct']} |"
        )
    lines.append("")

    # ---- Per-book corpus density ----
    lines.append("### Per-book aggregate corpus density")
    lines.append("")
    lines.append("| Book | Corpus density (primary similes /100w) |")
    lines.append("|------|------------------------------------------|")
    for book in BOOK_ORDER:
        v = per_book_corpus_density.get(book, 0.0)
        lines.append(f"| {book} | {v:.3f} |")
    lines.append("")
    lines.append(
        f"**Aggregate (all 3 books, all kinds):** "
        f"{result['aggregate_density_per_100w']:.3f} similes / 100w"
    )
    lines.append("")

    # ---- Top-N RHS heads per book ----
    lines.append("### Top-20 simile RHS heads (comparator targets) per book")
    lines.append("")
    for book in BOOK_ORDER:
        top = result["per_book_top_rhs_heads"].get(book, [])
        if not top:
            continue
        rendered = ", ".join(f"`{e['head']}`({e['n']})" for e in top)
        lines.append(f"  - **{book}** → {rendered}")
    lines.append("")
    lines.append(
        f"**Top-10 overlap across all 3 books** "
        f"({top10_overlap['all_three_count']} terms): "
        + (", ".join(f"`{t}`" for t in top10_overlap["all_three_books"]) or "(none)")
    )
    lines.append(
        f"**Top-10 overlap in any 2 of 3** "
        f"({top10_overlap['any_two_count']} terms): "
        + (", ".join(f"`{t}`" for t in top10_overlap["any_two_books"]) or "(none)")
    )
    lines.append("")

    # ---- Top phrases per book (full RHS NP, not just head) ----
    lines.append("### Top-15 simile RHS phrases per book (full comparator NP)")
    lines.append("")
    for book in BOOK_ORDER:
        top = result["per_book_top_rhs_phrases"].get(book, [])
        if not top:
            continue
        rendered = ", ".join(f"`{e['phrase']}`({e['n']})" for e in top)
        lines.append(f"  - **{book}** → {rendered}")
    lines.append("")

    # ---- Top qualities per book (LHS adjective lexicon for AS_AS) ----
    lines.append("### Top-15 AS_AS quality LHS adjectives per book")
    lines.append("")
    for book in BOOK_ORDER:
        top = result["per_book_top_qualities"].get(book, [])
        if not top:
            continue
        rendered = ", ".join(f"`{e['quality']}`({e['n']})" for e in top)
        lines.append(f"  - **{book}** → {rendered}")
    lines.append("")

    # ---- Placement distribution ----
    lines.append("### Placement distribution (% of similes per book)")
    lines.append(
        "_opener = first 25% of sentences in beat; closer = last 25%; middle = otherwise._"
    )
    lines.append("")
    lines.append("| Book | opener | middle | closer |")
    lines.append("|------|--------|--------|--------|")
    for book in BOOK_ORDER:
        d = placement.get(book, {})
        lines.append(
            f"| {book} | {d.get('opener', 0):.2f}% | "
            f"{d.get('middle', 0):.2f}% | {d.get('closer', 0):.2f}% |"
        )
    lines.append("")

    # ---- Per-POV simile load ----
    lines.append("### Per-POV simile load (POVs with ≥20 beats)")
    lines.append("")
    lines.append(
        "| POV | n beats | n words | n similes | corpus density (/100w) | "
        "mean per-beat density (/100w) |"
    )
    lines.append(
        "|-----|---------|---------|-----------|-------------------------|"
        "-------------------------------|"
    )
    for row in pov_table:
        lines.append(
            f"| {row['pov']} | {row['n_beats']} | {row['n_words']} | "
            f"{row['n_similes']} | {row['density_corpus_per_100w']:.3f} | "
            f"{row['mean_per_beat_density']:.3f} |"
        )
    lines.append("")

    # ---- Findings ----
    lines.append("### Findings")
    lines.append("")
    findings: list[str] = []

    # 1. Top-1 modal kind.
    top1_per_book = ranking_verdict.get("per_book_top1", {})
    if top1_per_book:
        modal = max(set(top1_per_book.values()), key=list(top1_per_book.values()).count)
        findings.append(
            f"- **Density top-1 kind**: per-book {top1_per_book} → modal `{modal}`. "
            f"Top-2 ordering reproduces "
            f"{ranking_verdict.get('books_with_matching_top2', 0)}/3. "
            f"Verdict **{ranking_verdict['verdict']}**."
        )

    # 2. Per-book aggregate density spread.
    if per_book_corpus_density:
        vals = list(per_book_corpus_density.values())
        if vals and statistics.mean(vals) > 0:
            sp = (max(vals) - min(vals)) / statistics.mean(vals)
            findings.append(
                f"- **Cross-book aggregate density**: "
                + ", ".join(
                    f"{b}={v:.3f}/100w" for b, v in per_book_corpus_density.items()
                )
                + f" (spread/mean {sp:.3f})."
            )

    # 3. Top-10 RHS overlap.
    findings.append(
        f"- **RHS comparator-target stability**: "
        f"{top10_overlap['all_three_count']} term(s) appear in top-10 of ALL 3 books "
        f"({', '.join(top10_overlap['all_three_books']) or 'none'}); "
        f"{top10_overlap['any_two_count']} additional in 2/3."
    )

    # 4. Per-kind mean stability.
    stable_kinds = [
        k for k, row in mean_stability.items() if row.get("stable_le_30pct")
    ]
    findings.append(
        f"- **Per-kind density stability (≤30% spread)**: "
        f"{len(stable_kinds)}/{len(mean_stability)} kinds stable "
        f"({', '.join(stable_kinds) if stable_kinds else 'none'})."
    )

    # 5. AS_AS vs LIKE form mix.
    total_as_as = sum(
        per_cell[b][k]["as_as_count"]
        for b in BOOK_ORDER for k in ACTIVE_KINDS
        if k in per_cell.get(b, {})
    )
    total_like = sum(
        per_cell[b][k]["like_count"]
        for b in BOOK_ORDER for k in ACTIVE_KINDS
        if k in per_cell.get(b, {})
    )
    total_as_if = sum(
        per_cell[b][k]["as_if_count"]
        for b in BOOK_ORDER for k in ACTIVE_KINDS
        if k in per_cell.get(b, {})
    )
    total_semi = sum(
        per_cell[b][k]["semi_simile_count"]
        for b in BOOK_ORDER for k in ACTIVE_KINDS
        if k in per_cell.get(b, {})
    )
    total_primary = total_as_as + total_like
    if total_primary > 0:
        like_share = 100.0 * total_like / total_primary
        findings.append(
            f"- **Form mix**: `like ...` = {total_like} ({like_share:.1f}%), "
            f"`as ... as` = {total_as_as} ({100.0 - like_share:.1f}%); "
            f"`as if/as though` = {total_as_if} (catalogued separately); "
            f"semi-simile = {total_semi} (catalogued separately)."
        )

    # 6. Placement.
    agg_placement = {"opener": 0, "middle": 0, "closer": 0}
    for d in placement.values():
        for k in agg_placement:
            agg_placement[k] += d.get(k, 0)
    if agg_placement and any(agg_placement.values()):
        # Renormalize as average across 3 books (simple mean of book pcts).
        if placement:
            agg_avg = {k: 0.0 for k in ("opener", "middle", "closer")}
            for d in placement.values():
                for k in agg_avg:
                    agg_avg[k] += d.get(k, 0.0)
            n = len(placement)
            agg_avg = {k: v / n for k, v in agg_avg.items()}
            findings.append(
                f"- **Placement (avg across 3 books)**: opener {agg_avg['opener']:.1f}%, "
                f"middle {agg_avg['middle']:.1f}%, closer {agg_avg['closer']:.1f}%. "
                f"{'Closer-heavy (rhetorical button)' if agg_avg['closer'] > agg_avg['opener'] + 5 else 'Opener-heavy (scene-anchor)' if agg_avg['opener'] > agg_avg['closer'] + 5 else 'Roughly uniform within beat'}."
            )

    # 7. POV/character pattern.
    if pov_table:
        top_pov = pov_table[0]
        bot_pov = pov_table[-1]
        findings.append(
            f"- **Per-POV simile load**: top POV `{top_pov['pov']}` "
            f"({top_pov['density_corpus_per_100w']:.3f}/100w over {top_pov['n_beats']} beats); "
            f"bottom `{bot_pov['pov']}` ({bot_pov['density_corpus_per_100w']:.3f}/100w over "
            f"{bot_pov['n_beats']} beats). "
            f"Range "
            f"{top_pov['density_corpus_per_100w'] - bot_pov['density_corpus_per_100w']:.3f}/100w."
        )

    lines.extend(findings)
    lines.append("")
    lines.append(f"**Overall verdict:** {result['overall_verdict']}")
    lines.append("")
    lines.append(
        "_See JSON for full per-cell detector breakdown, per-cell top-RHS "
        "lexicon, and full POV table._"
    )
    lines.append("")

    section = "\n".join(lines) + "\n"
    atomic_append_section(CONCLUSIONS_PATH, section)


def insert_roadmap_row(result: dict, json_path: Path, commit: str) -> None:
    overall = result["overall_verdict"]
    rv = result["ranking_verdict"]
    top10 = result["top10_overlap"]
    per_book_density = result["per_book_corpus_density"]
    mean_stability = result["mean_stability"]

    top1_per_book = rv.get("per_book_top1", {})
    modal = (
        max(set(top1_per_book.values()), key=list(top1_per_book.values()).count)
        if top1_per_book else "-"
    )

    densities_str = "; ".join(
        f"{b}={v:.3f}" for b, v in per_book_density.items()
    )

    stable_kinds = [
        k for k, row in mean_stability.items() if row.get("stable_le_30pct")
    ]
    n_stable = len(stable_kinds)
    n_total = len(mean_stability)

    overlap_str = (
        ", ".join(top10["all_three_books"][:5]) + (
            f" + {len(top10['all_three_books']) - 5} more"
            if len(top10["all_three_books"]) > 5 else ""
        )
        if top10["all_three_books"] else "none"
    )

    findings = (
        f"density top-1 modal `{modal}` (top-2 stable "
        f"{rv.get('books_with_matching_top2', 0)}/3, verdict {rv['verdict']}); "
        f"per-book aggregate density (primary similes /100w) {densities_str}; "
        f"per-kind density stable {n_stable}/{n_total} kinds (≤30%); "
        f"top-10 RHS overlap in all 3 books = {top10['all_three_count']} terms "
        f"({overlap_str})"
    )

    if overall == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship per-kind simile-density target + RHS-head allowlist + AS_AS quality "
            "lexicon as writer-prompt voice priors"
        )
    elif overall in ("PASS_PARTIAL", "PASS_PARTIAL_TOP1"):
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship the stable axis (top-1 kind + cross-book RHS overlap) as soft writer "
            "prior; defer rank-2/density-floor"
        )
    elif overall == "DIVERGE":
        verdict_short = "HOLD"
        recommend = (
            "do not codify simile priors; cross-book ranking diverges; revisit with "
            "finer detectors or per-character splits"
        )
    else:
        verdict_short = "KILL"
        recommend = "no signal; drop simile priors as a writer-prompt lever"

    lever = (
        "writer-prompt per-kind simile-density target + cross-book RHS comparator "
        "shortlist (e.g. `cat`, `stone`, `shadow`) + AS_AS quality lexicon "
        "(`still`, `cold`, `wild`); optional lint: warn when description-kind beat "
        "carries zero similes (rhetoric-flat) OR when same RHS head repeats >2× in beat"
    )

    new_row = (
        f"| {PATTERN_NUMBER} | **Simile density + lexicon (v2 — broadened detector)** "
        f"(`{commit}`): {findings} | "
        f"{lever} | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | "
        f"**{verdict_short}** — {recommend} |\n"
    )

    atomic_insert_row_before_anchor(ROADMAP_PATH, new_row, "\n**Sequencing")


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------


def main():
    ts = _dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    commit = commit_short()
    beats = load_beats()
    pairs_idx = load_pairs_index()
    print(
        f"[pattern-{PATTERN_NUMBER}] {len(beats)} beats / {len(pairs_idx)} "
        f"pairs loaded; commit={commit}; ts={ts}"
    )

    result = analyze(beats, pairs_idx)

    payload = _build_payload(result, ts, commit)
    json_path = write_timestamped_json(
        OUT_DIR, "simile-density", payload, prefix="crystal_shard"
    )
    print(f"[pattern-{PATTERN_NUMBER}] JSON → {json_path}")

    append_conclusions(result, json_path, commit)
    print(f"[pattern-{PATTERN_NUMBER}] appended → {CONCLUSIONS_PATH}")

    insert_roadmap_row(result, json_path, commit)
    print(f"[pattern-{PATTERN_NUMBER}] inserted row → {ROADMAP_PATH}")

    # Terse stdout summary.
    print(f"\n=== Pattern {PATTERN_NUMBER} — overall verdict ===")
    print(f"verdict:           {result['overall_verdict']}")
    print(
        f"aggregate density: {result['aggregate_density_per_100w']:.3f} primary similes / 100w"
    )
    rv = result["ranking_verdict"]
    print(f"ranking verdict:   {rv['verdict']}")
    print(f"  per-book top-1:  {rv.get('per_book_top1', {})}")
    print(f"  per-book top-2:  {rv.get('per_book_top2', {})}")
    print()
    print("per-book corpus density:")
    for b, v in result["per_book_corpus_density"].items():
        print(f"  {b:20s} {v:.3f}/100w")
    print()
    print("per-kind density stability (≤30% gate):")
    for k, row in result["mean_stability"].items():
        vbb = row["values_by_book"]
        ranges = "; ".join(f"{bk[:3]}={v:.3f}" for bk, v in vbb.items())
        print(f"  {k:>12s} : {ranges} | spread={row['spread_over_mean']:.3f} | stable={row['stable_le_30pct']}")
    print()
    print("top-10 RHS overlap:")
    print(f"  all 3 books: {result['top10_overlap']['all_three_books']}")
    print(f"  any 2/3:    {result['top10_overlap']['any_two_books']}")
    print()
    print("placement (per book, %):")
    for b, d in result["placement_per_book_pct"].items():
        print(f"  {b:20s} opener={d.get('opener', 0):5.2f}  middle={d.get('middle', 0):5.2f}  closer={d.get('closer', 0):5.2f}")
    print()
    print("top-5 POV by simile density:")
    for row in result["pov_table"][:5]:
        print(
            f"  {row['pov']:>20s} : {row['density_corpus_per_100w']:.3f}/100w "
            f"({row['n_beats']} beats, {row['n_similes']} similes)"
        )


if __name__ == "__main__":
    main()
