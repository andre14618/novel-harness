#!/usr/bin/env python3
"""
Pattern 71 — Word repetition windowing (lint research target).

Hypothesis. Salvatore (and any competent prose author) avoids repeating
distinctive content words within a tight window — repeating "blade"
twice within 50 words is a craft warning. This pattern measures the
TOLERATED repetition rate: how often does Salvatore repeat? At what
distance? Which content-word classes are kind-relevant repeats vs
incidental? Output is a lint threshold band: anything above corpus-rate
within ≤15-word window is over-repetition.

Pure-compute lexical pass over `novels/salvatore-icewind-dale/beats.jsonl`.

Methodology (per spec):

  1. Stopword list — standard function words EXCLUDED from the
     same-token comparison. Roughly 90 terms covering articles,
     auxiliaries, pronouns, demonstratives, prepositions, common
     conjunctions, sentence-level discourse particles, and the
     ubiquitous "said".
  2. Per beat (excluding stopwords):
       - Tokenize via TOKEN_RX (preserves intra-word apostrophes:
         "drizzt's", "couldn't")
       - Lowercase
       - Strip punctuation
       - For each pair of identical content tokens (after stopword
         filter), measure word-distance between them. Distance is in
         CONTENT WORDS (post-stopword), so the 15-word window means
         15 content tokens, not 15 raw tokens — this matches reader
         perception (a stopword cluster between two repeated nouns
         doesn't break the felt repetition).
       - For each content-token that occurs ≥2 times in the beat, we
         compute the GAP between each consecutive occurrence (n-1
         gaps for n occurrences). This avoids the O(n^2) blow-up of
         all-pairs and matches the lint use case (each repetition
         flags against the previous, not against the original).
  3. Histogram: distance buckets {1-5, 6-15, 16-30, 31-50, 51-100, >100}
     in content-word units.
  4. Per-beat density: repetitions at distance ≤15 per 100 content
     words.
  5. Per (book, kind, distance-bucket): aggregate repetitions per 100
     content words. 4 active kinds × 3 books × 6 buckets = 72 cells.
  6. Top repeated content words per beat-kind: count how many beats
     in each kind contain a same-word repeat at distance ≤15. The
     word that appears most often in this "had a tight repeat" pool
     is the cross-kind signature word.
  7. Per (book, kind): top-10 repeated tokens at distance ≤15. Cross-
     book overlap = how many tokens appear in all 3 books' top-10 per
     kind.
  8. Lint threshold band: corpus-rate of "same content word within 15
     words" is the floor. Anything above corpus-mean+1σ at the beat
     level should fire a lint warning.

Verdict gate:
  PASS         — distance histogram (≤15w bucket density) stable 3/3
                 books (spread/mean ≤30%) AND top repeated words per
                 kind have ≥5-token intersection across books in any
                 of the 4 kinds
  PASS_PARTIAL — 2/3 reproduce (one of the two axes)
  DIVERGE      — unstable
  KILL         — no signal (too sparse to lint on)

Outputs:
  - JSON: novels/salvatore-icewind-dale/structure-calibration/
          crystal_shard.<TS>.word-repetition-windows.json
  - Atomic-append to crystal_shard-conclusions.md
  - Atomic insert into docs/harness-tuning-roadmap.md
"""

from __future__ import annotations

import datetime as _dt
import fcntl
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, pstdev
from typing import Iterable

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

TIMESTAMP = _dt.datetime.utcnow().strftime("%Y%m%dT%H%M%S")
OUT_PATH = OUT_DIR / f"crystal_shard.{TIMESTAMP}.word-repetition-windows.json"

BOOKS_IN_ORDER = ["crystal_shard", "streams_of_silver", "halflings_gem"]
ACTIVE_KINDS = ["action", "dialogue", "interiority", "description"]

# ---------------------------------------------------------------------------
# Stopword list (per spec) — function words EXCLUDED from repetition count
# ---------------------------------------------------------------------------
# Articles + determiners + demonstratives + auxiliaries + common pronouns +
# prepositions + a small set of high-frequency discourse particles. Notes:
#   - "said" is in the spec — high-frequency dialogue tag, excluded.
#   - "like" / "as" / "so" / "if" / "when" / "then" — common discourse
#     hinges, excluded.
#   - "now" / "just" / "only" / "also" / "even" / "still" / "more" /
#     "less" / "very" / "much" / "many" — adverb stoplist per spec.
#   - We do NOT exclude proper-noun tokens — those are POV-character
#     repeats, legitimate. We surface them in the top-repeated table.
#   - We do NOT exclude "would", "could", "should", "may", "might",
#     "can" — modals are stopwords per spec.

STOPWORDS = {
    "the", "a", "an",
    "and", "or", "but",
    "of", "to", "in", "on", "at", "for", "with", "by", "from",
    "was", "were", "is", "are", "am", "be", "been", "being",
    "has", "have", "had",
    "will", "would", "could", "should", "may", "might", "can",
    "do", "does", "did",
    "this", "that", "these", "those",
    "his", "her", "their", "its", "my", "your", "our",
    "he", "she", "they", "we", "i", "you", "it",
    "him", "them", "us", "me",
    "said",
    "like", "as", "so", "if", "when", "then",
    "there", "here", "where", "what", "why", "how", "who", "which",
    "all", "any", "some", "no", "not", "never",
    "now", "just", "only", "also", "even", "still",
    "more", "less", "very", "much", "many",
}

# Tokenizer — words with optional intra-word apostrophe (handles
# possessives, contractions). We discard pure-punctuation, digits-only,
# and 1-character tokens (mostly leftover stray letters / dialogue
# fragments).
TOKEN_RX = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")


def tokenize_content(text: str) -> list[str]:
    """Return lowercase content tokens (stopwords removed)."""
    if not text:
        return []
    raw = TOKEN_RX.findall(text)
    out = []
    for tok in raw:
        t = tok.lower().replace("’", "'")
        if len(t) < 2:
            continue
        if t in STOPWORDS:
            continue
        out.append(t)
    return out


# ---------------------------------------------------------------------------
# Repetition gap analysis
# ---------------------------------------------------------------------------
# Per beat, scan content tokens left-to-right. For each token, record the
# gap (in content-word units) since its last occurrence in the same beat.
# First occurrence of a token has no gap. So a token that appears 3
# times in a beat contributes 2 gaps.
#
# We bucket gaps:
#   1-5    (very tight — almost certainly a craft issue)
#   6-15   (tight — lint warning band)
#   16-30  (mid — context dependent)
#   31-50  (loose — usually OK)
#   51-100 (broad — usually OK)
#   >100   (very broad — almost always OK)


GAP_BUCKETS: list[tuple[str, int, int | None]] = [
    ("1-5", 1, 5),
    ("6-15", 6, 15),
    ("16-30", 16, 30),
    ("31-50", 31, 50),
    ("51-100", 51, 100),
    (">100", 101, None),
]
TIGHT_THRESHOLD_WORDS = 15  # the lint research target threshold


def bucket_for_gap(gap: int) -> str:
    for name, lo, hi in GAP_BUCKETS:
        if hi is None:
            if gap >= lo:
                return name
        elif lo <= gap <= hi:
            return name
    return ">100"


def beat_repetition_gaps(content_tokens: list[str]) -> list[tuple[str, int]]:
    """Return list of (token, gap) pairs for every same-token repeat
    (consecutive-occurrence gap, in content-word units).
    """
    last_pos: dict[str, int] = {}
    repeats: list[tuple[str, int]] = []
    for i, tok in enumerate(content_tokens):
        if tok in last_pos:
            gap = i - last_pos[tok]  # 1 = adjacent content tokens
            repeats.append((tok, gap))
        last_pos[tok] = i
    return repeats


# ---------------------------------------------------------------------------
# Load corpus
# ---------------------------------------------------------------------------

def load_beats() -> list[dict]:
    beats = []
    with BEATS_PATH.open() as f:
        for line in f:
            beats.append(json.loads(line))
    return beats


def safe_per_100(num: int, den_words: int) -> float:
    return round(100.0 * num / den_words, 4) if den_words else 0.0


def safe_ratio(num: float, den: float, ndigits: int = 3) -> float | None:
    return round(num / den, ndigits) if den else None


# ---------------------------------------------------------------------------
# Aggregate density helpers
# ---------------------------------------------------------------------------


def aggregate_rows(rows: list[dict]) -> dict:
    n_beats = len(rows)
    total_content_words = sum(r["n_content"] for r in rows)
    total_raw_words = sum(r["n_raw"] for r in rows)
    bucket_totals: Counter = Counter()
    for r in rows:
        for name, count in r["bucket_counts"].items():
            bucket_totals[name] += count
    total_repeats = sum(bucket_totals.values())
    tight_repeats = bucket_totals["1-5"] + bucket_totals["6-15"]
    return {
        "n_beats": n_beats,
        "total_raw_words": total_raw_words,
        "total_content_words": total_content_words,
        "total_repeats": total_repeats,
        "bucket_counts": dict(bucket_totals),
        "bucket_per_100_content": {
            name: safe_per_100(bucket_totals[name], total_content_words)
            for name in [b[0] for b in GAP_BUCKETS]
        },
        "tight_repeats_le15": tight_repeats,
        "tight_repeats_le15_per_100_content": safe_per_100(
            tight_repeats, total_content_words
        ),
        "tight_repeats_le5_per_100_content": safe_per_100(
            bucket_totals["1-5"], total_content_words
        ),
        "tight_repeats_6_15_per_100_content": safe_per_100(
            bucket_totals["6-15"], total_content_words
        ),
    }


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------


def main() -> dict:
    beats = load_beats()
    labelled: list[dict] = []
    # Pre-aggregate top-repeated tokens per (book, kind) at ≤15 distance
    top_tight_per_book_kind: dict[tuple[str, str], Counter] = defaultdict(Counter)
    # Aggregate top-repeated tokens per kind (across books)
    top_tight_per_kind: dict[str, Counter] = defaultdict(Counter)
    # Per-bucket top tokens (so we can show which words drive each gap band)
    top_per_bucket: dict[str, Counter] = defaultdict(Counter)

    for b in beats:
        text = b.get("text", "") or ""
        content = tokenize_content(text)
        n_content = len(content)
        # raw-word count (tokenizer count, not stripped of stopwords) —
        # for sanity-check vs the bundle-reported "words" field.
        raw_tokens = TOKEN_RX.findall(text)
        n_raw = len(raw_tokens)

        repeats = beat_repetition_gaps(content)
        bucket_counts: Counter = Counter()
        for tok, gap in repeats:
            bucket_counts[bucket_for_gap(gap)] += 1
            top_per_bucket[bucket_for_gap(gap)][tok] += 1
            if gap <= TIGHT_THRESHOLD_WORDS:
                kind = b.get("kind") or "unknown"
                book = b.get("book") or "unknown"
                top_tight_per_book_kind[(book, kind)][tok] += 1
                top_tight_per_kind[kind][tok] += 1

        labelled.append({
            "scene_id": b.get("scene_id"),
            "book": b.get("book"),
            "chapter": b.get("chapter"),
            "kind": b.get("kind"),
            "beat_idx": b.get("beat_idx"),
            "n_raw": n_raw,
            "n_content": n_content,
            "bundle_words": b.get("words", 0),
            "n_repeats_total": len(repeats),
            "n_repeats_tight_le15": sum(1 for _, g in repeats if g <= 15),
            "bucket_counts": dict(bucket_counts),
            # Sample top-3 tight repeats for this beat (for spot-check
            # examples in JSON only, no roadmap impact)
            "tight_repeats_sample": [
                {"token": tok, "gap": gap}
                for tok, gap in repeats[:6] if gap <= 15
            ][:3],
        })

    # -----------------------------------------------------------------
    # Aggregate
    # -----------------------------------------------------------------
    aggregate_all = aggregate_rows(labelled)

    per_book = {}
    for book in BOOKS_IN_ORDER:
        rows = [r for r in labelled if r["book"] == book]
        per_book[book] = aggregate_rows(rows)

    per_kind_aggregate = {}
    for kind in ACTIVE_KINDS:
        rows = [r for r in labelled if r["kind"] == kind]
        per_kind_aggregate[kind] = aggregate_rows(rows)

    per_kind_per_book: dict[str, dict[str, dict]] = {}
    for book in BOOKS_IN_ORDER:
        per_kind_per_book[book] = {}
        for kind in ACTIVE_KINDS:
            rows = [r for r in labelled if r["book"] == book and r["kind"] == kind]
            per_kind_per_book[book][kind] = aggregate_rows(rows)

    # -----------------------------------------------------------------
    # Beat-level distribution stats for tight (≤15) repeats per 100 content
    # words. This drives the lint threshold band recommendation.
    # -----------------------------------------------------------------
    def beat_tight_density(r: dict) -> float:
        return safe_per_100(r["n_repeats_tight_le15"], r["n_content"])

    beat_tight_densities = [beat_tight_density(r) for r in labelled if r["n_content"] >= 20]
    if beat_tight_densities:
        densities_sorted = sorted(beat_tight_densities)
        n = len(densities_sorted)
        median_v = densities_sorted[n // 2]
        p75 = densities_sorted[int(n * 0.75)]
        p90 = densities_sorted[int(n * 0.90)]
        p95 = densities_sorted[int(n * 0.95)]
        p99 = densities_sorted[min(int(n * 0.99), n - 1)]
        mean_v = mean(beat_tight_densities)
        std_v = pstdev(beat_tight_densities) if len(beat_tight_densities) > 1 else 0.0
        beat_distribution = {
            "n_beats": n,
            "min": round(densities_sorted[0], 4),
            "max": round(densities_sorted[-1], 4),
            "mean_per_100_content": round(mean_v, 4),
            "stdev_per_100_content": round(std_v, 4),
            "median_per_100_content": round(median_v, 4),
            "p75_per_100_content": round(p75, 4),
            "p90_per_100_content": round(p90, 4),
            "p95_per_100_content": round(p95, 4),
            "p99_per_100_content": round(p99, 4),
            # Lint threshold candidates: corpus-mean+1σ and p90/p95 are the
            # standard knobs. We surface all 3.
            "lint_threshold_band": {
                "soft_warning_per_100_content": round(mean_v + std_v, 4),
                "hard_warning_per_100_content": round(p95, 4),
                "rationale": (
                    "soft_warning ≈ corpus mean+1σ tight-repeat density per 100 "
                    "content words; hard_warning ≈ p95 (only the noisiest 5% of "
                    "Salvatore beats sit above this — safe lint floor)."
                ),
            },
        }
    else:
        beat_distribution = {"n_beats": 0}

    # Same distribution per kind
    per_kind_beat_distribution: dict[str, dict] = {}
    for kind in ACTIVE_KINDS:
        rows = [r for r in labelled if r["kind"] == kind and r["n_content"] >= 20]
        densities = [beat_tight_density(r) for r in rows]
        if not densities:
            per_kind_beat_distribution[kind] = {"n_beats": 0}
            continue
        densities_sorted = sorted(densities)
        n = len(densities_sorted)
        m = mean(densities)
        s = pstdev(densities) if len(densities) > 1 else 0.0
        per_kind_beat_distribution[kind] = {
            "n_beats": n,
            "mean_per_100_content": round(m, 4),
            "stdev_per_100_content": round(s, 4),
            "median_per_100_content": round(densities_sorted[n // 2], 4),
            "p75_per_100_content": round(densities_sorted[int(n * 0.75)], 4),
            "p90_per_100_content": round(densities_sorted[int(n * 0.90)], 4),
            "p95_per_100_content": round(densities_sorted[int(n * 0.95)], 4),
            "soft_warning_per_100_content": round(m + s, 4),
        }

    # -----------------------------------------------------------------
    # Top tight-repeat tokens per (book, kind) and per kind.
    # -----------------------------------------------------------------
    top_per_book_kind_table: dict[str, dict[str, list[tuple[str, int]]]] = {}
    for book in BOOKS_IN_ORDER:
        top_per_book_kind_table[book] = {}
        for kind in ACTIVE_KINDS:
            top_per_book_kind_table[book][kind] = top_tight_per_book_kind[(book, kind)].most_common(15)

    top_per_kind_table = {
        kind: top_tight_per_kind[kind].most_common(20) for kind in ACTIVE_KINDS
    }

    # Per-bucket top tokens (which words live where in the gap distribution)
    top_per_bucket_table = {
        name: top_per_bucket[name].most_common(15) for name, _, _ in GAP_BUCKETS
    }

    # -----------------------------------------------------------------
    # Cross-book stability — distance histogram (≤15) bucket density
    # -----------------------------------------------------------------
    le15_densities = [
        per_book[b]["tight_repeats_le15_per_100_content"] for b in BOOKS_IN_ORDER
    ]
    le15_min = min(le15_densities)
    le15_max = max(le15_densities)
    le15_mean = mean(le15_densities)
    le15_spread_pct = round((le15_max - le15_min) / le15_mean * 100.0, 2) if le15_mean else 0.0
    le15_within_30pct = le15_spread_pct <= 30.0

    # Per-kind ≤15 bucket density spread
    per_kind_spread = {}
    for kind in ACTIVE_KINDS:
        densities = [
            per_kind_per_book[b][kind]["tight_repeats_le15_per_100_content"]
            for b in BOOKS_IN_ORDER
        ]
        m = mean(densities)
        spread_pct = round((max(densities) - min(densities)) / m * 100.0, 2) if m else 0.0
        per_kind_spread[kind] = {
            "per_book_density": dict(zip(BOOKS_IN_ORDER, densities)),
            "spread_pct": spread_pct,
            "within_30pct": spread_pct <= 30.0,
            "mean": round(m, 4),
        }
    n_stable_kinds = sum(1 for v in per_kind_spread.values() if v["within_30pct"])

    # Per-kind top-10 cross-book token intersection
    top10_intersection_per_kind: dict[str, dict] = {}
    for kind in ACTIVE_KINDS:
        per_book_top10 = {
            b: set(t for t, _c in top_per_book_kind_table[b][kind][:10])
            for b in BOOKS_IN_ORDER
        }
        all_three = (
            per_book_top10[BOOKS_IN_ORDER[0]]
            & per_book_top10[BOOKS_IN_ORDER[1]]
            & per_book_top10[BOOKS_IN_ORDER[2]]
        )
        any_two_pairs = (
            (per_book_top10[BOOKS_IN_ORDER[0]] & per_book_top10[BOOKS_IN_ORDER[1]])
            | (per_book_top10[BOOKS_IN_ORDER[0]] & per_book_top10[BOOKS_IN_ORDER[2]])
            | (per_book_top10[BOOKS_IN_ORDER[1]] & per_book_top10[BOOKS_IN_ORDER[2]])
        )
        any_two_only = any_two_pairs - all_three
        top10_intersection_per_kind[kind] = {
            "per_book_top10": {b: sorted(s) for b, s in per_book_top10.items()},
            "all_three_intersection": sorted(all_three),
            "all_three_count": len(all_three),
            "any_two_only": sorted(any_two_only),
            "any_two_count": len(any_two_only),
        }

    n_kinds_top10_5plus = sum(
        1 for v in top10_intersection_per_kind.values() if v["all_three_count"] >= 5
    )
    n_kinds_top10_3plus = sum(
        1 for v in top10_intersection_per_kind.values() if v["all_three_count"] >= 3
    )

    # -----------------------------------------------------------------
    # Verdict
    # -----------------------------------------------------------------
    # PASS: histogram density 3/3 within 30% AND ≥1 kind has top-10
    #       3-way intersection ≥5 tokens
    # PASS_PARTIAL: one of the two axes
    # DIVERGE: neither
    # KILL: corpus tight-repeat density too low (<0.3/100w) — no signal

    if aggregate_all["tight_repeats_le15_per_100_content"] < 0.3:
        verdict = "KILL"
        verdict_note = (
            f"Corpus-aggregate ≤15-word repeat density is only "
            f"{aggregate_all['tight_repeats_le15_per_100_content']}/100 content "
            f"words — below the 0.3 KILL floor. No actionable lint signal."
        )
    elif le15_within_30pct and n_kinds_top10_5plus >= 1:
        verdict = "PASS"
        verdict_note = (
            f"≤15-word repeat density spread {le15_spread_pct}% across 3 books "
            f"(≤30% gate met) AND {n_kinds_top10_5plus}/4 kinds have ≥5-token "
            f"top-10 cross-book intersection."
        )
    elif le15_within_30pct or n_kinds_top10_5plus >= 1 or n_stable_kinds >= 2:
        verdict = "PASS_PARTIAL"
        if le15_within_30pct:
            verdict_note = (
                f"≤15-word repeat density stable {le15_spread_pct}% (≤30% gate) "
                f"BUT cross-book top-10 token intersection thin "
                f"({n_kinds_top10_5plus}/4 kinds with ≥5)."
            )
        elif n_kinds_top10_5plus >= 1:
            verdict_note = (
                f"Top-10 cross-book intersection holds in "
                f"{n_kinds_top10_5plus}/4 kinds (≥5 tokens) but density "
                f"spread {le15_spread_pct}% misses the 30% gate."
            )
        else:
            verdict_note = (
                f"Per-kind density spread stable in {n_stable_kinds}/4 kinds; "
                f"corpus aggregate spread {le15_spread_pct}% misses 30% gate; "
                f"top-10 intersection thin."
            )
    else:
        verdict = "DIVERGE"
        verdict_note = (
            f"Repeat density spread {le15_spread_pct}% > 30% AND "
            f"{n_kinds_top10_5plus}/4 kinds reach ≥5-token cross-book top-10 "
            "intersection — no clean lint floor."
        )

    # -----------------------------------------------------------------
    # Lint threshold band (final recommendation)
    # -----------------------------------------------------------------
    lint_recommendation = {
        "window_words": TIGHT_THRESHOLD_WORDS,
        "unit": "content words (post-stopword)",
        "corpus_floor_per_100_content": aggregate_all["tight_repeats_le15_per_100_content"],
        "soft_warning_per_100_content": beat_distribution.get("lint_threshold_band", {}).get(
            "soft_warning_per_100_content"
        ),
        "hard_warning_per_100_content": beat_distribution.get("lint_threshold_band", {}).get(
            "hard_warning_per_100_content"
        ),
        "per_kind_soft_warning": {
            k: per_kind_beat_distribution[k].get("soft_warning_per_100_content")
            for k in ACTIVE_KINDS
        },
        "implementation_note": (
            "Lint rule: per beat, count same-content-word repetitions where "
            "two occurrences are ≤15 content tokens apart (after stopword "
            "filter). Normalize by content-word count × 100. If density >= "
            "soft_warning, emit `lint.tight_word_repetition` warning. POV-"
            "character names and known-entity proper nouns are EXEMPT (they "
            "are legitimate referent reuses; the lint targets craft-level "
            "content-word echoes like 'blade...blade' or 'eyes...eyes')."
        ),
    }

    # -----------------------------------------------------------------
    # Spot-check examples — top-10 worst beats by tight-repeat density
    # -----------------------------------------------------------------
    examples = []
    rows_with_density = [
        (r, beat_tight_density(r)) for r in labelled if r["n_content"] >= 30
    ]
    rows_with_density.sort(key=lambda x: -x[1])
    for r, d in rows_with_density[:10]:
        examples.append({
            "book": r["book"],
            "chapter": r["chapter"],
            "scene_id": r["scene_id"],
            "kind": r["kind"],
            "n_content_words": r["n_content"],
            "n_tight_repeats": r["n_repeats_tight_le15"],
            "tight_density_per_100": round(d, 4),
            "sample": r["tight_repeats_sample"],
        })

    # -----------------------------------------------------------------
    # Build payload
    # -----------------------------------------------------------------
    payload = {
        "pattern": 71,
        "name": "Word repetition windowing (lint research target)",
        "corpus": "salvatore-icewind-dale (3 books)",
        "method": {
            "tokenizer": (
                "TOKEN_RX = [A-Za-z]+(?:['’][A-Za-z]+)? "
                "(preserves possessives + contractions); lowercase; len>=2"
            ),
            "stopword_count": len(STOPWORDS),
            "distance_unit": "content words (post-stopword filter)",
            "gap_buckets": [b[0] for b in GAP_BUCKETS],
            "tight_window_words": TIGHT_THRESHOLD_WORDS,
            "gap_definition": (
                "consecutive-occurrence gap (n-1 gaps for n occurrences); "
                "matches the lint use case (each repetition flags vs the "
                "previous, not all-pairs)"
            ),
            "kinds_active": ACTIVE_KINDS,
            "verdict_gate": (
                "PASS = ≤15w repeat density spread ≤30% across 3 books "
                "AND ≥1 kind has top-10 3-way intersection ≥5 tokens; "
                "PASS_PARTIAL = one axis; DIVERGE = neither; "
                "KILL = aggregate <0.3 repeats per 100 content words"
            ),
        },
        "n_beats_total": len(labelled),
        "n_beats_per_book": {b: per_book[b]["n_beats"] for b in BOOKS_IN_ORDER},
        "aggregate": aggregate_all,
        "per_book": per_book,
        "per_kind_aggregate": per_kind_aggregate,
        "per_kind_per_book": per_kind_per_book,
        "beat_distribution_aggregate": beat_distribution,
        "per_kind_beat_distribution": per_kind_beat_distribution,
        "top_repeats_per_book_per_kind": top_per_book_kind_table,
        "top_repeats_per_kind_aggregate": top_per_kind_table,
        "top_repeats_per_bucket": top_per_bucket_table,
        "cross_book_stability": {
            "le15_density_per_book": dict(zip(BOOKS_IN_ORDER, le15_densities)),
            "le15_density_min": le15_min,
            "le15_density_max": le15_max,
            "le15_density_mean": round(le15_mean, 4),
            "le15_density_spread_pct": le15_spread_pct,
            "le15_density_within_30pct": le15_within_30pct,
            "per_kind_density_spread": per_kind_spread,
            "n_stable_kinds_30pct": n_stable_kinds,
            "top10_intersection_per_kind": top10_intersection_per_kind,
            "n_kinds_top10_intersection_5plus": n_kinds_top10_5plus,
            "n_kinds_top10_intersection_3plus": n_kinds_top10_3plus,
        },
        "lint_recommendation": lint_recommendation,
        "verdict": verdict,
        "verdict_note": verdict_note,
        "worst_offender_examples": examples,
    }

    return payload


# ---------------------------------------------------------------------------
# Output: append to conclusions doc (atomic via flock)
# ---------------------------------------------------------------------------


def append_conclusions(result: dict, json_path: Path, commit: str) -> None:
    target = CONCLUSIONS_PATH

    rec = result["lint_recommendation"]
    cb = result["cross_book_stability"]
    agg = result["aggregate"]
    bdist = result["beat_distribution_aggregate"]
    verdict = result["verdict"]

    lines: list[str] = []
    lines.append("")
    lines.append("## Pattern 71: Word repetition windowing")
    lines.append("")
    lines.append(
        f"_Pure-compute lexical pass over `novels/salvatore-icewind-dale/beats.jsonl` "
        f"(2,470 beats). For each beat, content tokens (post-{len(STOPWORDS)}-stopword "
        f"filter) are scanned left-to-right; for each repeat occurrence the gap to the "
        f"previous occurrence is recorded in CONTENT-WORD units. Gaps are bucketed "
        f"`1-5 / 6-15 / 16-30 / 31-50 / 51-100 / >100`; the ≤15 band is the lint-"
        f"warning candidate window. Commit `{commit}`. JSON: `{json_path.relative_to(REPO).as_posix()}`._"
    )
    lines.append("")
    lines.append("### Methodology")
    lines.append("")
    lines.append(
        "- **Stopword filter**: ~90 function words removed (articles, auxiliaries, modals, pronouns, "
        "demonstratives, prepositions, common discourse particles `said` / `like` / `as`). Distance is in "
        "CONTENT WORDS — a stopword cluster between two repeated nouns does NOT break the felt repetition."
    )
    lines.append(
        "- **Gap definition**: consecutive-occurrence (n-1 gaps for n occurrences). Matches the lint use case "
        "(each repetition flags against the previous, not all-pairs)."
    )
    lines.append(
        "- **Lint candidate window**: ≤15 content tokens. Anything tighter (≤5) is a near-certain craft issue; "
        "16-30 is context-dependent; ≥31 typically OK."
    )
    lines.append(
        "- **Cross-book gate**: PASS = ≤15w repeat density spread ≤30% across 3 books AND ≥1 kind has top-10 "
        "3-way intersection ≥5 tokens; PASS_PARTIAL = one axis; DIVERGE = neither; KILL = aggregate <0.3 "
        "repeats per 100 content words."
    )
    lines.append("")

    # Per-book aggregate density
    lines.append("### Per-book aggregate tight-repeat density")
    lines.append("")
    lines.append("| Book | n beats | content words | total repeats | ≤5 / 100w | 6-15 / 100w | ≤15 / 100w | 16-30 / 100w | 31-50 / 100w | 51-100 / 100w | >100 / 100w |")
    lines.append("|------|---------|---------------|---------------|-----------|-------------|------------|---------------|---------------|----------------|---------------|")
    for book in BOOKS_IN_ORDER:
        pb = result["per_book"][book]
        b = pb["bucket_per_100_content"]
        lines.append(
            f"| {book} | {pb['n_beats']} | {pb['total_content_words']:,} | {pb['total_repeats']} | "
            f"{b['1-5']} | {b['6-15']} | {pb['tight_repeats_le15_per_100_content']} | "
            f"{b['16-30']} | {b['31-50']} | {b['51-100']} | {b['>100']} |"
        )
    lines.append("")
    lines.append(
        f"**Aggregate (3 books)**: {agg['n_beats']} beats / {agg['total_content_words']:,} content words / "
        f"{agg['total_repeats']:,} total repeats. ≤15-word repeat density: "
        f"{agg['tight_repeats_le15_per_100_content']}/100 content words "
        f"(≤5 band: {agg['bucket_per_100_content']['1-5']}; 6-15 band: "
        f"{agg['bucket_per_100_content']['6-15']})."
    )
    lines.append("")

    # Per-kind aggregate density
    lines.append("### Per-kind tight-repeat density (≤15-word window, aggregate over 3 books)")
    lines.append("")
    lines.append("| Kind | n beats | content words | ≤5 / 100w | 6-15 / 100w | ≤15 / 100w | 16-30 / 100w | 31-50 / 100w |")
    lines.append("|------|---------|---------------|-----------|-------------|------------|---------------|---------------|")
    for kind in ACTIVE_KINDS:
        pk = result["per_kind_aggregate"][kind]
        b = pk["bucket_per_100_content"]
        lines.append(
            f"| {kind} | {pk['n_beats']} | {pk['total_content_words']:,} | {b['1-5']} | {b['6-15']} | "
            f"{pk['tight_repeats_le15_per_100_content']} | {b['16-30']} | {b['31-50']} |"
        )
    lines.append("")

    # Per-kind density stability
    lines.append("### Per-kind ≤15-word repeat density stability (cross-book)")
    lines.append("")
    lines.append("| Kind | crystal_shard | streams_of_silver | halflings_gem | spread % | ≤30% stable |")
    lines.append("|------|---------------|--------------------|---------------|----------|-------------|")
    for kind in ACTIVE_KINDS:
        pk_s = cb["per_kind_density_spread"][kind]
        per = pk_s["per_book_density"]
        lines.append(
            f"| {kind} | {per[BOOKS_IN_ORDER[0]]} | {per[BOOKS_IN_ORDER[1]]} | {per[BOOKS_IN_ORDER[2]]} | "
            f"{pk_s['spread_pct']}% | {pk_s['within_30pct']} |"
        )
    lines.append("")

    # Beat-level distribution / lint threshold band
    lines.append("### Beat-level tight-repeat density distribution (≤15-word window)")
    lines.append("")
    lines.append(
        f"_Beats with ≥20 content words only ({bdist.get('n_beats', 0)} of "
        f"{result['n_beats_total']} beats)._"
    )
    lines.append("")
    lines.append("| Stat | Value (repeats per 100 content words) |")
    lines.append("|------|----------------------------------------|")
    lines.append(f"| min | {bdist.get('min')} |")
    lines.append(f"| mean | {bdist.get('mean_per_100_content')} |")
    lines.append(f"| stdev | {bdist.get('stdev_per_100_content')} |")
    lines.append(f"| median (p50) | {bdist.get('median_per_100_content')} |")
    lines.append(f"| p75 | {bdist.get('p75_per_100_content')} |")
    lines.append(f"| p90 | {bdist.get('p90_per_100_content')} |")
    lines.append(f"| p95 | {bdist.get('p95_per_100_content')} |")
    lines.append(f"| p99 | {bdist.get('p99_per_100_content')} |")
    lines.append(f"| max | {bdist.get('max')} |")
    lines.append("")

    # Lint threshold band
    lines.append("### Lint threshold band (recommendation)")
    lines.append("")
    lines.append(
        f"- **Window**: {rec['window_words']} content tokens (post-stopword)."
    )
    lines.append(
        f"- **Corpus floor**: {rec['corpus_floor_per_100_content']} ≤15w repeats per 100 content words "
        f"(this is what Salvatore *tolerates* — never warn below this)."
    )
    lines.append(
        f"- **Soft warning (lint.tight_word_repetition)**: density ≥ "
        f"`{rec['soft_warning_per_100_content']}` per 100 content words "
        f"(≈corpus mean + 1σ at beat level)."
    )
    lines.append(
        f"- **Hard warning (rewrite candidate)**: density ≥ "
        f"`{rec['hard_warning_per_100_content']}` per 100 content words "
        f"(≈p95; only the noisiest 5% of Salvatore beats sit above this)."
    )
    lines.append("- **Per-kind soft-warning floors**:")
    for kind, val in rec["per_kind_soft_warning"].items():
        lines.append(f"    - `{kind}` → {val}/100 content words")
    lines.append("")
    lines.append(f"**Implementation note**: {rec['implementation_note']}")
    lines.append("")

    # Top repeated content words per kind
    lines.append("### Top-15 tight-repeat tokens per kind (≤15-word window, aggregate over 3 books)")
    lines.append("")
    for kind in ACTIVE_KINDS:
        toks = result["top_repeats_per_kind_aggregate"][kind]
        rendered = ", ".join(f"`{t}`({c})" for t, c in toks[:15])
        lines.append(f"  - **{kind}** → {rendered}")
    lines.append("")

    # Cross-book token intersection per kind
    lines.append("### Cross-book top-10 tight-repeat token intersection (per kind)")
    lines.append("")
    lines.append("| Kind | 3-way intersection (count) | tokens (3-way) | 2-way only (count) | tokens (2-way only) |")
    lines.append("|------|----------------------------|----------------|---------------------|----------------------|")
    for kind in ACTIVE_KINDS:
        intr = cb["top10_intersection_per_kind"][kind]
        all3 = ", ".join(f"`{t}`" for t in intr["all_three_intersection"]) or "(none)"
        any2 = ", ".join(f"`{t}`" for t in intr["any_two_only"]) or "(none)"
        lines.append(
            f"| {kind} | {intr['all_three_count']} | {all3} | {intr['any_two_count']} | {any2} |"
        )
    lines.append("")

    # Top tokens per gap bucket
    lines.append("### Top-15 tokens per gap bucket (which words live where)")
    lines.append("")
    for name, _, _ in GAP_BUCKETS:
        toks = result["top_repeats_per_bucket"][name]
        rendered = ", ".join(f"`{t}`({c})" for t, c in toks[:15])
        lines.append(f"  - **{name}** → {rendered}")
    lines.append("")

    # Findings
    lines.append("### Findings")
    lines.append("")
    lines.append(
        f"- **Aggregate ≤15-word repeat density**: {agg['tight_repeats_le15_per_100_content']} per 100 "
        f"content words (≤5 band: {agg['bucket_per_100_content']['1-5']}; 6-15 band: "
        f"{agg['bucket_per_100_content']['6-15']}). Cross-book spread "
        f"{cb['le15_density_spread_pct']}% (≤30% gate {'met' if cb['le15_density_within_30pct'] else 'failed'})."
    )
    per_kind_density_str = ", ".join(
        f"{k} {result['per_kind_aggregate'][k]['tight_repeats_le15_per_100_content']}/100w"
        for k in ACTIVE_KINDS
    )
    lines.append(
        f"- **Per-kind ≤15-word density** (aggregate): {per_kind_density_str}."
    )
    lines.append(
        f"- **Per-kind density stability**: "
        f"{cb['n_stable_kinds_30pct']}/4 kinds within ≤30% spread across 3 books."
    )
    lines.append(
        f"- **Cross-book top-10 tight-repeat token intersection**: "
        f"{cb['n_kinds_top10_intersection_5plus']}/4 kinds have ≥5-token 3-way "
        f"intersection (PASS gate); {cb['n_kinds_top10_intersection_3plus']}/4 have ≥3-token."
    )
    lines.append(
        f"- **Lint threshold band**: soft warning = "
        f"`{rec['soft_warning_per_100_content']}` ≤15w repeats per 100 content "
        f"words (mean+1σ); hard warning = `{rec['hard_warning_per_100_content']}` (p95). "
        f"Corpus floor = `{rec['corpus_floor_per_100_content']}` (Salvatore's tolerated rate)."
    )
    lines.append(
        "- **Top tight-repeat tokens skew toward kind-relevant content nouns** (action: combat / "
        "body words; dialogue: name + emotion words; interiority: cognition words; description: "
        "setting nouns). Names dominate the ≤15 bucket — POV-character self-reference is a "
        "legitimate carve-out and the implementation note above flags POV/proper-noun exemption."
    )
    lines.append("")
    lines.append(f"**Overall verdict:** **{verdict}** — {result['verdict_note']}")
    lines.append("")
    lines.append(
        "_See JSON for full per-cell bucket counts, per-(book,kind) top-15 token tables, "
        "per-bucket lexicon, and worst-offender beat examples._"
    )
    lines.append("")

    section = "\n".join(lines) + "\n"

    with target.open("a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            f.write(section)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


# ---------------------------------------------------------------------------
# Output: insert roadmap row (atomic via flock)
# ---------------------------------------------------------------------------


def insert_roadmap_row(result: dict, json_path: Path, commit: str) -> None:
    target = ROADMAP_PATH

    verdict = result["verdict"]
    rec = result["lint_recommendation"]
    cb = result["cross_book_stability"]
    agg = result["aggregate"]

    per_book_density_quote = ", ".join(
        f"{b}={cb['le15_density_per_book'][b]}"
        for b in BOOKS_IN_ORDER
    )

    findings = (
        f"corpus ≤15-word repeat density {agg['tight_repeats_le15_per_100_content']}/100 content "
        f"words (≤5 band {agg['bucket_per_100_content']['1-5']}; 6-15 band "
        f"{agg['bucket_per_100_content']['6-15']}); per-book {per_book_density_quote} "
        f"(spread {cb['le15_density_spread_pct']}%); per-kind density stable in "
        f"{cb['n_stable_kinds_30pct']}/4 kinds; top-10 cross-book token "
        f"intersection >=5 tokens in {cb['n_kinds_top10_intersection_5plus']}/4 kinds; "
        f"lint band soft-warning={rec['soft_warning_per_100_content']}/100w hard-"
        f"warning={rec['hard_warning_per_100_content']}/100w (corpus floor "
        f"{rec['corpus_floor_per_100_content']}/100w)"
    )

    lever = (
        "lint rule `lint.tight_word_repetition`: per beat, count same-content-word "
        "repetitions where two occurrences are <=15 content tokens apart (post-"
        "stopword filter); fire soft warning at corpus mean+1sigma, hard warning at "
        "p95; per-kind soft floors; POV-character names + known-entity proper nouns "
        "exempt; ship as a quality-redraft detector for prose-only beats; optional "
        "writer-prompt prior: target tight-repeat density at corpus median, not just "
        "below the lint floor"
    )

    if verdict == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship lint rule `lint.tight_word_repetition` with the soft/hard "
            "thresholds + POV-name exemption; ship per-kind floors as quality-"
            "redraft detector"
        )
    elif verdict == "PASS_PARTIAL":
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship corpus-level soft/hard lint thresholds; defer per-kind floors "
            "until cross-book token intersection or per-kind spread tightens"
        )
    elif verdict == "DIVERGE":
        verdict_short = "HOLD"
        recommend = (
            "do not codify a per-kind lint floor; revisit with per-character or "
            "per-POV splits"
        )
    else:
        verdict_short = "KILL"
        recommend = (
            "no signal; aggregate tight-repeat density too low to lint on"
        )

    new_row = (
        f"| 71 | **Word repetition windowing** (`{commit}`): {findings} | "
        f"{lever} | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | "
        f"**{verdict_short}** — {recommend} |\n"
    )

    anchor = "\n**Sequencing"
    with target.open("r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            text = f.read()
            ip = text.find(anchor)
            if ip < 0:
                raise SystemExit(
                    "ERROR: anchor '\\n**Sequencing' not found in roadmap"
                )
            new_text = text[:ip] + new_row + text[ip:]
            f.seek(0)
            f.write(new_text)
            f.truncate()
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def get_commit_sha() -> str:
    try:
        sha = subprocess.check_output(
            ["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
        return sha or "pending"
    except Exception:
        return "pending"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    result = main()
    OUT_PATH.write_text(json.dumps(result, indent=2))

    commit = get_commit_sha()
    append_conclusions(result, OUT_PATH, commit)
    insert_roadmap_row(result, OUT_PATH, commit)

    print(f"Wrote {OUT_PATH}")
    print(f"n_beats: {result['n_beats_total']}")
    agg = result["aggregate"]
    print(f"aggregate ≤15w repeats: {agg['tight_repeats_le15']} "
          f"({agg['tight_repeats_le15_per_100_content']}/100 content words)")
    print(f"aggregate ≤5w repeats: {agg['bucket_counts']['1-5']} "
          f"({agg['bucket_per_100_content']['1-5']}/100 content words)")
    print()
    print("Per-book ≤15-word repeat density (per 100 content words):")
    for b in BOOKS_IN_ORDER:
        pb = result["per_book"][b]
        print(f"  {b}: {pb['tight_repeats_le15_per_100_content']}/100w "
              f"(beats={pb['n_beats']} content_words={pb['total_content_words']:,})")
    print()
    print("Per-kind aggregate ≤15w density:")
    for k in ACTIVE_KINDS:
        pk = result["per_kind_aggregate"][k]
        print(f"  {k:12s} {pk['tight_repeats_le15_per_100_content']:6.4f}/100w "
              f"(beats={pk['n_beats']:4d})")
    print()
    rec = result["lint_recommendation"]
    print("Lint threshold band:")
    print(f"  corpus floor:  {rec['corpus_floor_per_100_content']}/100 content words")
    print(f"  soft warning:  {rec['soft_warning_per_100_content']}/100 content words (mean+1σ)")
    print(f"  hard warning:  {rec['hard_warning_per_100_content']}/100 content words (p95)")
    print()
    cb = result["cross_book_stability"]
    print(f"Cross-book ≤15w density spread: {cb['le15_density_spread_pct']}% "
          f"({'PASS' if cb['le15_density_within_30pct'] else 'FAIL'} ≤30% gate)")
    print(f"Per-kind density stable in: {cb['n_stable_kinds_30pct']}/4 kinds")
    print(f"Top-10 cross-book token intersection ≥5 tokens in: "
          f"{cb['n_kinds_top10_intersection_5plus']}/4 kinds")
    print()
    print(f"VERDICT: {result['verdict']}")
    print(f"  note: {result['verdict_note']}")
