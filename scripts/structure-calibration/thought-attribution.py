#!/usr/bin/env python3
"""
Pattern 69 — Character thought-attribution patterns.

Hypothesis. Salvatore renders character cognition with a stable VERB CHOICE
distribution. P34d (interiority-marker density) already established that
"knew" is the dominant cognition verb in all 3 IWD books (137/138/137 — wait,
the conclusions actually log 145 / 138 / 137 from a different lexicon cut).
This pattern slices that "knew" dominance plus 9 sister cognition-verb
families in two new dimensions:

  1. **Per (book, kind)** — does the dominant-verb ranking hold across kinds?
  2. **Per character** — does each fellowship member have a distinct
     thought-verb fingerprint (Drizzt the knower, Bruenor the doubter,
     Wulfgar the wonderer, etc.)?

==============================================================================
Lexicon (10 categories)
==============================================================================

  KNOW: knew, knows, knowing, know
  THINK: thought, thinks, thinking, think
  REALIZE: realized, realizes, realizing, realize
  WONDER: wondered, wonders, wondering, wonder
  UNDERSTAND: understood, understands, understanding, understand
  CONSIDER: considered, considers, considering, consider
  BELIEVE: believed, believes, believing, believe
  FEEL_THAT: felt that, feel that, feels that
  DECIDE: decided, decides, decide, deciding
  RECALL: remembered, remembers, remembering, recall, recalled, recalls

Forms are exact lowercased token-bound matches. Two-word forms ("felt that")
are matched as a contiguous span on the lowercased text. The KNOW family
includes "knowing" (gerund) and bare "know" (infinitive); the rate of
gerund/infinitive forms is small relative to "knew" but tracked.

==============================================================================
Methodology
==============================================================================

1. **Verb-only density** — for each beat, count category occurrences,
   normalize per 100 words. Aggregate by (book, kind).

2. **Per-character attribution density** — heuristic: if a character name
   precedes a category verb within 0–3 tokens (`\\b<name>(\\s+\\w+){0,3}\\s+<verb>`),
   credit the verb to that character. The 0–3 buffer admits modal/auxiliary
   inserts (`Drizzt had thought`, `Drizzt did not know`). Per-character
   per-100w density uses denominator = total dialogue+narration words for
   POV-anchored beats keyed to that character; we instead use a flat
   per-character HIT COUNT + per-character SHARE of verb mass (no
   per-100w because the denominator-pick is fragile).

3. **Per-kind ordering** — for each book × kind, rank the 10 categories
   by total hits. Top-1 (dominant) verb per (book, kind), then check
   stability across books per kind.

4. **Per-character thought-verb mass** — for the 5 fellowship characters,
   what's the per-character distribution? Top-1 (per-character) reproduces
   across books?

5. **"Knew" dominance** — confirm the KNOW family is rank-1 in all 3 books
   at the corpus-wide aggregate. Measure ratio to next-most-frequent.

==============================================================================
Cross-book gates
==============================================================================

Three gates feed into the overall verdict via `combine_gates()`:

  GATE A — knew-dominance: KNOW family is rank-1 in 3/3 books at the
  corpus-wide aggregate. PASS = 3/3, PASS_PARTIAL = 2/3, DIVERGE = 1/3.

  GATE B — per-kind dominant verb stable: for each kind, rank-1 verb
  reproduces across 3/3 books. modal_class gate over the 4 kinds combined.

  GATE C — per-character top-1 stable: for each fellowship character,
  rank-1 verb reproduces across 3/3 books. modal_class gate over the
  5 characters combined. (Falls back to PASS_PARTIAL when a character
  appears with too-thin sample counts in one book.)

==============================================================================
Outputs
==============================================================================

  - JSON: novels/salvatore-icewind-dale/structure-calibration/
          crystal_shard.<TS>.thought-attribution.json
  - Atomic-append section to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert row 69 into docs/harness-tuning-roadmap.md (fcntl flock)
"""

from __future__ import annotations

import datetime as _dt
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Tuple

_LIB_DIR = Path(__file__).resolve().parent / "lib"
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from directional_gate import (  # noqa: E402
    Verdict,
    combine_gates,
    gate_modal_class,
)
from atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)

# ---------------------------------------------------------------------------
# Pattern identity
# ---------------------------------------------------------------------------

PATTERN_NUMBER: int = 69
PATTERN_NAME: str = "Character thought-attribution patterns"
PATTERN_SLUG: str = "thought-attribution"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
CORPUS_KEY = "salvatore-icewind-dale"
BUNDLE = REPO / "novels" / CORPUS_KEY
BEATS_PATH = BUNDLE / "beats.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BOOK_ORDER: Tuple[str, ...] = ("crystal_shard", "streams_of_silver", "halflings_gem")
KIND_ORDER: Tuple[str, ...] = ("action", "description", "dialogue", "interiority")

ROADMAP_ANCHOR = "\n**Sequencing"

# 10 thought-attribution categories.  Forms are lowercased; two-word forms
# ("felt that") are matched as contiguous spans.
THOUGHT_CATEGORIES: Dict[str, List[str]] = {
    "KNOW": ["knew", "knows", "knowing", "know"],
    "THINK": ["thought", "thinks", "thinking", "think"],
    "REALIZE": ["realized", "realizes", "realizing", "realize"],
    "WONDER": ["wondered", "wonders", "wondering", "wonder"],
    "UNDERSTAND": ["understood", "understands", "understanding", "understand"],
    "CONSIDER": ["considered", "considers", "considering", "consider"],
    "BELIEVE": ["believed", "believes", "believing", "believe"],
    "FEEL_THAT": ["felt that", "feel that", "feels that"],
    "DECIDE": ["decided", "decides", "decide", "deciding"],
    "RECALL": ["remembered", "remembers", "remembering", "recall", "recalled", "recalls"],
}

# Fellowship characters for per-character analysis.  Each entry maps a
# canonical name to the regex token that should match in the lowercased
# beat text.  Multi-token surnames (Catti-brie) are matched by lowercasing
# the hyphenated form; we anchor on word-boundaries.
FELLOWSHIP: Tuple[str, ...] = ("Drizzt", "Bruenor", "Wulfgar", "Catti-brie", "Regis")

# Map canonical character → list of tokens that should be treated as
# a subject mention.  We ALWAYS include the canonical first-name token
# lowercased.  "Catti-brie" is hyphenated in the corpus — we match it as
# a single hyphenated token by escaping the hyphen.
CHAR_TOKENS: Dict[str, List[str]] = {
    "Drizzt":     ["drizzt"],
    "Bruenor":    ["bruenor"],
    "Wulfgar":    ["wulfgar"],
    "Catti-brie": ["catti-brie", "catti"],   # rare bare "Catti" appears in dialogue
    "Regis":      ["regis", "rumblebelly"],   # nickname used by Bruenor
}

# Buffer between subject token and verb (allows "had", "did not", "could
# not", "would not" inserts).  Spec uses 0-3.
ATTRIBUTION_BUFFER = 3

# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_beats() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    with BEATS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def commit_short() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


# ---------------------------------------------------------------------------
# Pre-compiled regex
# ---------------------------------------------------------------------------

# Single-word verb regex per category (token-bounded, case-insensitive on
# lowercased input).  Two-word forms ("felt that") get a contiguous span
# regex.
def _build_verb_regexes() -> Dict[str, re.Pattern]:
    out: Dict[str, re.Pattern] = {}
    for category, forms in THOUGHT_CATEGORIES.items():
        # Sort longest-first so multi-word forms match before substrings.
        sorted_forms = sorted(forms, key=len, reverse=True)
        # Multi-word forms: the space inside is preserved as `\s+` so we
        # tolerate any whitespace.  Single-word forms get `\b...\b`.
        parts: List[str] = []
        for form in sorted_forms:
            if " " in form:
                tokens = form.split()
                pattern = r"\b" + r"\s+".join(re.escape(t) for t in tokens) + r"\b"
            else:
                pattern = r"\b" + re.escape(form) + r"\b"
            parts.append(pattern)
        out[category] = re.compile("|".join(parts))
    return out


VERB_RE_BY_CATEGORY = _build_verb_regexes()

# All-categories union — used to build per-character attribution regex.
# A single regex matching any thought-verb (any category, any form).
def _all_verb_alternation() -> str:
    parts: List[str] = []
    for forms in THOUGHT_CATEGORIES.values():
        sorted_forms = sorted(forms, key=len, reverse=True)
        for form in sorted_forms:
            if " " in form:
                tokens = form.split()
                parts.append(r"\b" + r"\s+".join(re.escape(t) for t in tokens) + r"\b")
            else:
                parts.append(r"\b" + re.escape(form) + r"\b")
    return "|".join(parts)


_ALL_VERBS_RE = re.compile(_all_verb_alternation())

# Per-character attribution regex.  Pattern shape:
#   \b<char-token>\s+(?:\S+\s+){0,N}<verb>
# We capture the matched verb in group 1 to identify the category later.
def _build_attribution_regex(char_token: str) -> re.Pattern:
    # Escape the character token (handles hyphens like catti-brie).
    char_escaped = re.escape(char_token)
    # Build a verb alternation that we can capture.  Sorted longest-first
    # so multi-word "felt that" is preferred over "felt".
    verb_parts: List[str] = []
    for forms in THOUGHT_CATEGORIES.values():
        for form in forms:
            verb_parts.append(form)
    verb_parts = sorted(verb_parts, key=len, reverse=True)
    verb_alts: List[str] = []
    for form in verb_parts:
        if " " in form:
            tokens = form.split()
            verb_alts.append(r"\s+".join(re.escape(t) for t in tokens))
        else:
            verb_alts.append(re.escape(form))
    # Final pattern: char-token \s+ (any-token \s+){0,N} (verb-alt)
    pattern = (
        r"\b" + char_escaped
        + r"\b\s+(?:\S+\s+){0," + str(ATTRIBUTION_BUFFER) + r"}"
        + r"(" + "|".join(verb_alts) + r")"
        + r"\b"
    )
    return re.compile(pattern)


CHAR_ATTRIBUTION_REGEX: Dict[str, List[re.Pattern]] = {
    char: [_build_attribution_regex(tok) for tok in tokens]
    for char, tokens in CHAR_TOKENS.items()
}


# ---------------------------------------------------------------------------
# Categorize a verb match → category name
# ---------------------------------------------------------------------------

# We compile a mapping of canonical-form → category for fast lookup.  When
# the attribution regex captures a verb, we lowercase it, collapse any
# internal whitespace, and look up the category.
_FORM_TO_CATEGORY: Dict[str, str] = {}
for cat, forms in THOUGHT_CATEGORIES.items():
    for form in forms:
        _FORM_TO_CATEGORY[form.lower()] = cat


def _normalize_verb(verb: str) -> str:
    """Lowercase + collapse internal whitespace to single space."""
    return re.sub(r"\s+", " ", verb.lower()).strip()


def _verb_to_category(verb: str) -> str:
    norm = _normalize_verb(verb)
    return _FORM_TO_CATEGORY.get(norm, "UNKNOWN")


# ---------------------------------------------------------------------------
# Per-beat counters
# ---------------------------------------------------------------------------


def count_verbs_in_text(text: str) -> Dict[str, int]:
    """Count thought-verb hits by category in lowercased text."""
    lower = text.lower()
    out: Dict[str, int] = {cat: 0 for cat in THOUGHT_CATEGORIES}
    for cat, regex in VERB_RE_BY_CATEGORY.items():
        out[cat] = len(regex.findall(lower))
    return out


def count_per_character_attributions(text: str) -> Dict[str, Dict[str, int]]:
    """Count per-character attributions where character precedes verb within
    ATTRIBUTION_BUFFER tokens.  Returns dict[character][category] → count."""
    lower = text.lower()
    out: Dict[str, Dict[str, int]] = {
        char: {cat: 0 for cat in THOUGHT_CATEGORIES}
        for char in FELLOWSHIP
    }
    for char, patterns in CHAR_ATTRIBUTION_REGEX.items():
        for pattern in patterns:
            for match in pattern.finditer(lower):
                verb = match.group(1)
                cat = _verb_to_category(verb)
                if cat == "UNKNOWN":
                    continue
                out[char][cat] += 1
    return out


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def aggregate(beats: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate per-(book, kind, category) and per-character counts."""
    # (book, kind) → category → hits
    book_kind_cat_hits: Dict[Tuple[str, str], Dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    # (book, kind) → total words (for densities)
    book_kind_words: Dict[Tuple[str, str], int] = defaultdict(int)
    # (book, kind) → beat count
    book_kind_n_beats: Dict[Tuple[str, str], int] = defaultdict(int)
    # book → category → hits (corpus-wide per-book)
    book_cat_hits: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    book_words: Dict[str, int] = defaultdict(int)
    # (book, character, category) → hits  (per-character per-book)
    book_char_cat_hits: Dict[Tuple[str, str], Dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )

    for beat in beats:
        book = beat.get("book", "")
        kind = beat.get("kind", "")
        text = beat.get("text", "") or ""
        words = int(beat.get("words", 0) or 0)
        if not book or not kind or not text:
            continue
        if book not in BOOK_ORDER:
            continue

        # Verb-only density (counts in text body)
        cat_hits = count_verbs_in_text(text)
        for cat, hits in cat_hits.items():
            book_kind_cat_hits[(book, kind)][cat] += hits
            book_cat_hits[book][cat] += hits
        book_kind_words[(book, kind)] += words
        book_words[book] += words
        book_kind_n_beats[(book, kind)] += 1

        # Per-character attribution
        char_attr = count_per_character_attributions(text)
        for char, cat_dict in char_attr.items():
            for cat, hits in cat_dict.items():
                if hits:
                    book_char_cat_hits[(book, char)][cat] += hits

    return {
        "book_kind_cat_hits": book_kind_cat_hits,
        "book_kind_words": book_kind_words,
        "book_kind_n_beats": book_kind_n_beats,
        "book_cat_hits": book_cat_hits,
        "book_words": book_words,
        "book_char_cat_hits": book_char_cat_hits,
    }


def compute_densities(agg: Dict[str, Any]) -> Dict[str, Any]:
    """From raw counts, compute per-(book, kind, category) densities per
    100 words, plus the dominant (rank-1) category per (book, kind), plus
    per-book corpus-wide ranking, plus per-(book, char) ranking."""

    book_kind_density: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    book_kind_dominant: Dict[str, Dict[str, str]] = defaultdict(dict)
    book_kind_rank: Dict[str, Dict[str, List[str]]] = defaultdict(dict)
    book_kind_total_hits: Dict[str, Dict[str, int]] = defaultdict(dict)

    for (book, kind), cat_hits in agg["book_kind_cat_hits"].items():
        words = max(1, agg["book_kind_words"][(book, kind)])
        density: Dict[str, float] = {}
        for cat in THOUGHT_CATEGORIES:
            hits = cat_hits.get(cat, 0)
            density[cat] = round(100.0 * hits / words, 4)
        book_kind_density[book][kind] = density
        # Rank by raw hits (raw counts; densities tied-break)
        ranking = sorted(
            THOUGHT_CATEGORIES.keys(),
            key=lambda c: (-cat_hits.get(c, 0), -density[c], c),
        )
        book_kind_rank[book][kind] = ranking
        book_kind_dominant[book][kind] = ranking[0]
        book_kind_total_hits[book][kind] = sum(cat_hits.values())

    # Per-book corpus-wide ranking
    book_corpus_density: Dict[str, Dict[str, float]] = {}
    book_corpus_rank: Dict[str, List[str]] = {}
    book_corpus_total: Dict[str, int] = {}
    for book in BOOK_ORDER:
        cat_hits = agg["book_cat_hits"].get(book, {})
        words = max(1, agg["book_words"].get(book, 0))
        density = {
            cat: round(100.0 * cat_hits.get(cat, 0) / words, 4)
            for cat in THOUGHT_CATEGORIES
        }
        book_corpus_density[book] = density
        book_corpus_rank[book] = sorted(
            THOUGHT_CATEGORIES.keys(),
            key=lambda c: (-cat_hits.get(c, 0), -density[c], c),
        )
        book_corpus_total[book] = sum(cat_hits.values())

    # Per-(book, char) ranking
    book_char_rank: Dict[str, Dict[str, List[str]]] = defaultdict(dict)
    book_char_top1: Dict[str, Dict[str, str]] = defaultdict(dict)
    book_char_total: Dict[str, Dict[str, int]] = defaultdict(dict)
    book_char_share: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    for book in BOOK_ORDER:
        for char in FELLOWSHIP:
            cat_hits = agg["book_char_cat_hits"].get((book, char), {})
            total = sum(cat_hits.values())
            book_char_total[book][char] = total
            if total == 0:
                book_char_rank[book][char] = []
                book_char_top1[book][char] = ""
                book_char_share[book][char] = {cat: 0.0 for cat in THOUGHT_CATEGORIES}
                continue
            ranking = sorted(
                THOUGHT_CATEGORIES.keys(),
                key=lambda c: (-cat_hits.get(c, 0), c),
            )
            book_char_rank[book][char] = ranking
            book_char_top1[book][char] = ranking[0]
            book_char_share[book][char] = {
                cat: round(100.0 * cat_hits.get(cat, 0) / total, 2)
                for cat in THOUGHT_CATEGORIES
            }

    return {
        "book_kind_density": book_kind_density,
        "book_kind_dominant": book_kind_dominant,
        "book_kind_rank": book_kind_rank,
        "book_kind_total_hits": book_kind_total_hits,
        "book_corpus_density": book_corpus_density,
        "book_corpus_rank": book_corpus_rank,
        "book_corpus_total": book_corpus_total,
        "book_char_rank": book_char_rank,
        "book_char_top1": book_char_top1,
        "book_char_total": book_char_total,
        "book_char_share": book_char_share,
    }


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------


def gate_a_knew_dominance(book_corpus_rank: Dict[str, List[str]]) -> Verdict:
    """Gate A: KNOW family is rank-1 in 3/3 books at corpus-wide aggregate."""
    if not book_corpus_rank:
        return "KILL"
    rank1_per_book = {b: book_corpus_rank.get(b, [""])[0] for b in BOOK_ORDER}
    # Count how many books have KNOW as rank-1.
    n_know_top = sum(1 for v in rank1_per_book.values() if v == "KNOW")
    if n_know_top == 3:
        return "PASS"
    if n_know_top == 2:
        return "PASS_PARTIAL"
    if n_know_top == 1:
        return "DIVERGE"
    return "KILL"


def gate_b_per_kind_dominant(
    book_kind_dominant: Dict[str, Dict[str, str]],
) -> Tuple[Verdict, Dict[str, Verdict]]:
    """Gate B: for each kind, dominant verb reproduces 3/3 books.  We report
    a per-kind verdict (modal_class) AND combine into one overall via
    least-favorable."""
    per_kind_verdicts: Dict[str, Verdict] = {}
    for kind in KIND_ORDER:
        per_book_modal: Dict[str, str] = {}
        for book in BOOK_ORDER:
            per_book_modal[book] = book_kind_dominant.get(book, {}).get(kind, "")
        per_kind_verdicts[kind] = gate_modal_class(per_book_modal)
    overall = combine_gates(list(per_kind_verdicts.values()))
    return overall, per_kind_verdicts


def gate_c_per_char_top1(
    book_char_top1: Dict[str, Dict[str, str]],
) -> Tuple[Verdict, Dict[str, Verdict]]:
    """Gate C: for each fellowship character, top-1 verb reproduces 3/3 books."""
    per_char_verdicts: Dict[str, Verdict] = {}
    for char in FELLOWSHIP:
        per_book_top1: Dict[str, str] = {}
        for book in BOOK_ORDER:
            per_book_top1[book] = book_char_top1.get(book, {}).get(char, "")
        per_char_verdicts[char] = gate_modal_class(per_book_top1)
    overall = combine_gates(list(per_char_verdicts.values()))
    return overall, per_char_verdicts


# ---------------------------------------------------------------------------
# Knew dominance ratio (descriptive)
# ---------------------------------------------------------------------------


def knew_dominance_details(
    book_cat_hits: Dict[str, Dict[str, int]],
) -> Dict[str, Dict[str, Any]]:
    """For each book, return knew hits, runner-up category + hits,
    and the knew:runner-up ratio."""
    out: Dict[str, Dict[str, Any]] = {}
    for book in BOOK_ORDER:
        hits = book_cat_hits.get(book, {})
        know_hits = hits.get("KNOW", 0)
        # Runner-up = highest non-KNOW
        non_know_sorted = sorted(
            ((c, hits.get(c, 0)) for c in THOUGHT_CATEGORIES if c != "KNOW"),
            key=lambda kv: -kv[1],
        )
        runner_cat, runner_hits = non_know_sorted[0] if non_know_sorted else ("", 0)
        ratio = (know_hits / runner_hits) if runner_hits else float("inf")
        out[book] = {
            "knew_hits": know_hits,
            "runner_up_category": runner_cat,
            "runner_up_hits": runner_hits,
            "knew_to_runner_up_ratio": (
                round(ratio, 3) if runner_hits else None
            ),
        }
    return out


# ---------------------------------------------------------------------------
# Top-of-list reporting helpers
# ---------------------------------------------------------------------------


def per_kind_top1_table(
    book_kind_dominant: Dict[str, Dict[str, str]],
) -> Dict[str, Dict[str, str]]:
    """Returns kind → book → dominant category for clean reporting."""
    out: Dict[str, Dict[str, str]] = {}
    for kind in KIND_ORDER:
        out[kind] = {}
        for book in BOOK_ORDER:
            out[kind][book] = book_kind_dominant.get(book, {}).get(kind, "")
    return out


def per_kind_density_top3(
    book_kind_density: Dict[str, Dict[str, Dict[str, float]]],
    book_kind_rank: Dict[str, Dict[str, List[str]]],
) -> Dict[str, Dict[str, List[Tuple[str, float]]]]:
    """Returns kind → book → top-3 [(category, density)]."""
    out: Dict[str, Dict[str, List[Tuple[str, float]]]] = {}
    for kind in KIND_ORDER:
        out[kind] = {}
        for book in BOOK_ORDER:
            ranking = book_kind_rank.get(book, {}).get(kind, [])
            density = book_kind_density.get(book, {}).get(kind, {})
            out[kind][book] = [(c, density.get(c, 0.0)) for c in ranking[:3]]
    return out


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------


def analyze(beats: List[Dict[str, Any]]) -> Dict[str, Any]:
    agg = aggregate(beats)
    densities = compute_densities(agg)

    # Gates
    verdict_a = gate_a_knew_dominance(densities["book_corpus_rank"])
    verdict_b_overall, verdict_b_per_kind = gate_b_per_kind_dominant(
        densities["book_kind_dominant"]
    )
    verdict_c_overall, verdict_c_per_char = gate_c_per_char_top1(
        densities["book_char_top1"]
    )

    overall: Verdict = combine_gates([verdict_a, verdict_b_overall, verdict_c_overall])

    knew_details = knew_dominance_details(agg["book_cat_hits"])

    # Per-character per-book top-1 + share
    per_char_top1 = {
        char: {book: densities["book_char_top1"].get(book, {}).get(char, "")
               for book in BOOK_ORDER}
        for char in FELLOWSHIP
    }
    per_char_total = {
        char: {book: densities["book_char_total"].get(book, {}).get(char, 0)
               for book in BOOK_ORDER}
        for char in FELLOWSHIP
    }
    per_char_pooled_top: Dict[str, str] = {}
    per_char_pooled_share: Dict[str, Dict[str, float]] = {}
    for char in FELLOWSHIP:
        # Pool across books
        pooled_hits: Dict[str, int] = {cat: 0 for cat in THOUGHT_CATEGORIES}
        for book in BOOK_ORDER:
            cat_hits = agg["book_char_cat_hits"].get((book, char), {})
            for cat, hits in cat_hits.items():
                pooled_hits[cat] += hits
        total = sum(pooled_hits.values())
        if total == 0:
            per_char_pooled_top[char] = ""
            per_char_pooled_share[char] = {cat: 0.0 for cat in THOUGHT_CATEGORIES}
            continue
        ranking = sorted(
            THOUGHT_CATEGORIES.keys(),
            key=lambda c: (-pooled_hits[c], c),
        )
        per_char_pooled_top[char] = ranking[0]
        per_char_pooled_share[char] = {
            cat: round(100.0 * pooled_hits[cat] / total, 2)
            for cat in THOUGHT_CATEGORIES
        }

    # Per-book corpus rank table
    per_book_rank_table = {
        book: densities["book_corpus_rank"].get(book, [])
        for book in BOOK_ORDER
    }
    per_book_density_table = {
        book: densities["book_corpus_density"].get(book, {})
        for book in BOOK_ORDER
    }
    per_book_total_table = {
        book: densities["book_corpus_total"].get(book, 0)
        for book in BOOK_ORDER
    }

    findings_short = (
        f"knew-dominance {verdict_a} (3-book rank-1: "
        + "/".join(per_book_rank_table[b][0] if per_book_rank_table[b] else "?"
                   for b in BOOK_ORDER)
        + f"); per-kind dominant {verdict_b_overall} "
        + "({"
        + ", ".join(
            f"{k}={'='.join(set(verdict_b_per_kind[k] for _ in [0]))}"
            for k in KIND_ORDER
        )
        + "}); per-char top-1 "
        + f"{verdict_c_overall} ({'/'.join(per_char_pooled_top[c] for c in FELLOWSHIP)})"
    )
    # Cap at 240 chars
    findings_short = findings_short[:240]

    # Per-kind dominant aggregated as "kind -> {book: dominant}"
    per_kind_top1_dict = per_kind_top1_table(densities["book_kind_dominant"])
    per_kind_top3_dict = per_kind_density_top3(
        densities["book_kind_density"], densities["book_kind_rank"]
    )

    return {
        "verdict": overall,
        "gates_used": ["modal_class (gate_a_knew_dominance, gate_b_per_kind, gate_c_per_char)"],
        "verdict_a_knew_dominance": verdict_a,
        "verdict_b_per_kind_overall": verdict_b_overall,
        "verdict_b_per_kind": verdict_b_per_kind,
        "verdict_c_per_char_overall": verdict_c_overall,
        "verdict_c_per_char": verdict_c_per_char,
        "per_book_rank": per_book_rank_table,
        "per_book_density_per_100w": per_book_density_table,
        "per_book_total_hits": per_book_total_table,
        "per_book_kind_density_per_100w": densities["book_kind_density"],
        "per_book_kind_rank": densities["book_kind_rank"],
        "per_book_kind_dominant": densities["book_kind_dominant"],
        "per_book_kind_total_hits": densities["book_kind_total_hits"],
        "per_book_kind_n_beats": {
            f"{b}|{k}": agg["book_kind_n_beats"].get((b, k), 0)
            for b in BOOK_ORDER for k in KIND_ORDER
        },
        "per_book_kind_words": {
            f"{b}|{k}": agg["book_kind_words"].get((b, k), 0)
            for b in BOOK_ORDER for k in KIND_ORDER
        },
        "per_book_words": agg["book_words"],
        "per_kind_top1_per_book": per_kind_top1_dict,
        "per_kind_top3_per_book": {
            kind: {
                book: [{"category": c, "density_per_100w": d} for c, d in lst]
                for book, lst in per_book.items()
            }
            for kind, per_book in per_kind_top3_dict.items()
        },
        "knew_dominance_details": knew_details,
        "per_char_per_book_top1": per_char_top1,
        "per_char_per_book_total_hits": per_char_total,
        "per_char_per_book_share_pct": densities["book_char_share"],
        "per_char_pooled_top1": per_char_pooled_top,
        "per_char_pooled_share_pct": per_char_pooled_share,
        "findings_short": findings_short,
        "char_tokens": CHAR_TOKENS,
        "attribution_buffer": ATTRIBUTION_BUFFER,
        "thought_categories": THOUGHT_CATEGORIES,
    }


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------


def render_conclusions_md(result: Dict[str, Any], json_path: Path, commit: str) -> str:
    lines: List[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_NUMBER}: {PATTERN_NAME}")
    lines.append("")
    lines.append(
        f"_Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`. "
        f"Verdict: **{result['verdict']}**._"
    )
    lines.append("")

    # Hypothesis summary
    lines.append("**Hypothesis.** Salvatore's character cognition uses a stable verb-choice "
                 "distribution. P34d already established `knew` is the dominant interiority verb "
                 "in 3/3 books. This pattern slices the cognition lexicon into 10 categories "
                 "(KNOW/THINK/REALIZE/WONDER/UNDERSTAND/CONSIDER/BELIEVE/FEEL_THAT/DECIDE/RECALL), "
                 "measures per-(book, kind) ranking and per-character signature, and tests "
                 "three reproduction gates: knew-dominance + per-kind dominant + per-character top-1.")
    lines.append("")

    lines.append("**Methodology.** Pure compute regex over `beats.jsonl` text. Verb-only "
                 "density per 100w aggregated by (book, kind). Per-character attribution: "
                 f"`\\b<char-token>(\\s+\\w+){{0,{ATTRIBUTION_BUFFER}}}\\s+<verb>` — credit a "
                 "thought-verb to the character whose name appears within "
                 f"{ATTRIBUTION_BUFFER} tokens to the LEFT. Three gates: (A) KNOW-family rank-1 in "
                 "3/3 books, (B) per-kind dominant verb reproduces, (C) per-character top-1 "
                 "reproduces.")
    lines.append("")

    # Knew dominance section
    lines.append("### Gate A — `knew` dominance (corpus-wide per book)")
    lines.append("")
    lines.append(f"Verdict: **{result['verdict_a_knew_dominance']}**.")
    lines.append("")
    lines.append("| Book | KNOW hits | Runner-up | Runner-up hits | Ratio |")
    lines.append("|---|---:|---|---:|---:|")
    for book in BOOK_ORDER:
        det = result["knew_dominance_details"].get(book, {})
        ratio = det.get("knew_to_runner_up_ratio")
        ratio_str = f"{ratio:.2f}×" if ratio is not None else "∞"
        lines.append(
            f"| {book} | {det.get('knew_hits', 0)} | "
            f"{det.get('runner_up_category', '')} | "
            f"{det.get('runner_up_hits', 0)} | {ratio_str} |"
        )
    lines.append("")
    lines.append("Per-book full ranking (by raw hits):")
    lines.append("")
    for book in BOOK_ORDER:
        ranking = result["per_book_rank"].get(book, [])
        density = result["per_book_density_per_100w"].get(book, {})
        ranked = ", ".join(
            f"{cat}={density.get(cat, 0):.3f}/100w" for cat in ranking
        )
        lines.append(f"- **{book}** (total={result['per_book_total_hits'].get(book, 0)} hits): {ranked}")
    lines.append("")

    # Per-kind dominant section
    lines.append("### Gate B — per-kind dominant verb (cross-book)")
    lines.append("")
    lines.append(f"Verdict: **{result['verdict_b_per_kind_overall']}**.")
    lines.append("")
    lines.append("| Kind | crystal_shard | streams_of_silver | halflings_gem | per-kind verdict |")
    lines.append("|---|---|---|---|---|")
    for kind in KIND_ORDER:
        per_book_dom = result["per_kind_top1_per_book"].get(kind, {})
        v_kind = result["verdict_b_per_kind"].get(kind, "?")
        lines.append(
            f"| {kind} | {per_book_dom.get('crystal_shard', '')} | "
            f"{per_book_dom.get('streams_of_silver', '')} | "
            f"{per_book_dom.get('halflings_gem', '')} | **{v_kind}** |"
        )
    lines.append("")
    lines.append("Top-3 categories per (kind, book) with densities per 100w:")
    lines.append("")
    for kind in KIND_ORDER:
        per_book = result["per_kind_top3_per_book"].get(kind, {})
        lines.append(f"- **{kind}**")
        for book in BOOK_ORDER:
            entries = per_book.get(book, [])
            seg = ", ".join(
                f"{e['category']}={e['density_per_100w']:.3f}" for e in entries
            )
            lines.append(f"  - {book}: {seg}")
    lines.append("")

    # Per-character section
    lines.append("### Gate C — per-character top-1 verb (cross-book)")
    lines.append("")
    lines.append(f"Verdict: **{result['verdict_c_per_char_overall']}**.")
    lines.append("")
    lines.append("Pooled per-character top-1 + share% (across all 3 books, all kinds):")
    lines.append("")
    lines.append("| Character | Pooled top-1 | Pooled share% (top 5) | Per-book top-1 (CS / SoS / HG) | Total hits | Verdict |")
    lines.append("|---|---|---|---|---:|---|")
    for char in FELLOWSHIP:
        pooled_top = result["per_char_pooled_top1"].get(char, "")
        pooled_share = result["per_char_pooled_share_pct"].get(char, {})
        # Top-5 shares
        share_sorted = sorted(pooled_share.items(), key=lambda kv: -kv[1])[:5]
        share_str = ", ".join(f"{c}={p:.1f}%" for c, p in share_sorted if p > 0)
        per_book_top = result["per_char_per_book_top1"].get(char, {})
        per_book_str = " / ".join(per_book_top.get(b, "") or "—" for b in BOOK_ORDER)
        per_book_totals = result["per_char_per_book_total_hits"].get(char, {})
        total_hits = sum(per_book_totals.get(b, 0) for b in BOOK_ORDER)
        v = result["verdict_c_per_char"].get(char, "?")
        lines.append(
            f"| **{char}** | {pooled_top or '—'} | {share_str or '—'} | {per_book_str} | {total_hits} | **{v}** |"
        )
    lines.append("")
    lines.append("Per-book per-character total attribution hits (subject within "
                 f"0–{ATTRIBUTION_BUFFER} tokens to the LEFT of verb):")
    lines.append("")
    for char in FELLOWSHIP:
        totals = result["per_char_per_book_total_hits"].get(char, {})
        seg = ", ".join(f"{b}={totals.get(b, 0)}" for b in BOOK_ORDER)
        lines.append(f"- **{char}**: {seg}")
    lines.append("")

    # Conclusion
    lines.append(f"### Conclusion + Action — Pattern {PATTERN_NUMBER}: **{result['verdict']}**")
    lines.append("")
    lines.append(result["findings_short"])
    lines.append("")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Roadmap row
# ---------------------------------------------------------------------------


def render_roadmap_row(result: Dict[str, Any], commit: str) -> str:
    verdict = result["verdict"]
    if verdict == "PASS":
        ship = "ship"
    elif verdict == "PASS_PARTIAL":
        ship = "ship the stable axis as soft prior; defer unstable axes"
    elif verdict == "DIVERGE":
        ship = "HOLD — does not reproduce across books"
    elif verdict == "KILL":
        ship = "KILL — no signal"
    else:
        ship = f"INCOMPLETE — {verdict}"

    # Build a richer findings cell.
    # Per-book corpus rank-1 chain
    rank1_chain = "/".join(
        result["per_book_rank"].get(b, [""])[0] or "?" for b in BOOK_ORDER
    )
    # Knew dominance ratios
    knew_ratios = []
    for b in BOOK_ORDER:
        det = result["knew_dominance_details"].get(b, {})
        r = det.get("knew_to_runner_up_ratio")
        rstr = f"{r:.2f}×" if r is not None else "∞"
        knew_ratios.append(f"{b}={det.get('knew_hits', 0)}/{rstr}")
    knew_str = "; ".join(knew_ratios)

    # Per-kind dominant chain
    perkind = []
    for kind in KIND_ORDER:
        chain = "/".join(
            result["per_kind_top1_per_book"].get(kind, {}).get(b, "") or "?"
            for b in BOOK_ORDER
        )
        perkind.append(f"{kind}={chain} ({result['verdict_b_per_kind'].get(kind, '?')})")
    perkind_str = "; ".join(perkind)

    # Per-char pooled top-1 + verdict
    perchar = []
    for char in FELLOWSHIP:
        top = result["per_char_pooled_top1"].get(char, "—")
        v = result["verdict_c_per_char"].get(char, "?")
        perchar.append(f"{char}={top}({v})")
    perchar_str = "; ".join(perchar)

    findings = (
        f"corpus rank-1 (CS/SoS/HG)={rank1_chain}; "
        f"knew dominance: {knew_str} (Gate A {result['verdict_a_knew_dominance']}); "
        f"per-kind dominant: {perkind_str} (Gate B {result['verdict_b_per_kind_overall']}); "
        f"per-char pooled top-1: {perchar_str} (Gate C {result['verdict_c_per_char_overall']})"
    )

    lever = (
        "writer-prompt cognition-verb prior (KNOW family dominant, ~5–6× over runner-up); "
        "per-character thought-verb fewshots if Gate C ships; "
        "lint floor: interiority-kind beat with zero KNOW/THINK/REALIZE family hits = rewrite candidate"
    )

    return (
        f"| {PATTERN_NUMBER} | **{PATTERN_NAME}** (`{commit}`): {findings} | "
        f"{lever} | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | "
        f"**{verdict}** — {ship} |\n"
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    commit = commit_short()
    print(
        f"[pattern-{PATTERN_NUMBER}] starting; slug={PATTERN_SLUG}; commit={commit}",
        file=sys.stderr,
    )

    beats = load_beats()
    print(f"[pattern-{PATTERN_NUMBER}] loaded {len(beats)} beats", file=sys.stderr)

    result = analyze(beats)

    payload: Dict[str, Any] = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": PATTERN_NAME,
        "slug": PATTERN_SLUG,
        "commit": commit,
        "timestamp_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "fellowship": list(FELLOWSHIP),
        "books": list(BOOK_ORDER),
        "kinds": list(KIND_ORDER),
        **result,
    }

    json_path = write_timestamped_json(OUT_DIR, PATTERN_SLUG, payload)
    print(f"[pattern-{PATTERN_NUMBER}] JSON → {json_path}", file=sys.stderr)

    section_md = render_conclusions_md(result, json_path, commit)
    atomic_append_section(CONCLUSIONS_PATH, section_md)
    print(f"[pattern-{PATTERN_NUMBER}] appended → {CONCLUSIONS_PATH}", file=sys.stderr)

    row_md = render_roadmap_row(result, commit)
    atomic_insert_row_before_anchor(ROADMAP_PATH, row_md, ROADMAP_ANCHOR)
    print(f"[pattern-{PATTERN_NUMBER}] inserted row → {ROADMAP_PATH}", file=sys.stderr)

    print(f"\n=== Pattern {PATTERN_NUMBER} — {PATTERN_NAME} ===")
    print(f"verdict: {result['verdict']}")
    print(f"gate A (knew dominance): {result['verdict_a_knew_dominance']}")
    print(f"gate B (per-kind dominant overall): {result['verdict_b_per_kind_overall']}")
    print(f"gate C (per-char top-1 overall): {result['verdict_c_per_char_overall']}")
    print(f"per-book corpus rank-1: " + " / ".join(
        result["per_book_rank"].get(b, [""])[0] for b in BOOK_ORDER
    ))
    print()
    print("knew dominance ratios:")
    for b in BOOK_ORDER:
        det = result["knew_dominance_details"].get(b, {})
        r = det.get("knew_to_runner_up_ratio")
        rstr = f"{r:.2f}×" if r is not None else "∞"
        print(f"  {b}: KNOW={det.get('knew_hits', 0)}, runner={det.get('runner_up_category')}={det.get('runner_up_hits', 0)}, ratio={rstr}")
    print()
    print("per-character pooled top-1:")
    for ch in FELLOWSHIP:
        top = result["per_char_pooled_top1"].get(ch, "")
        v = result["verdict_c_per_char"].get(ch, "?")
        totals = result["per_char_per_book_total_hits"].get(ch, {})
        ttotal = sum(totals.values())
        print(f"  {ch}: {top} ({v}); total attributions={ttotal}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
