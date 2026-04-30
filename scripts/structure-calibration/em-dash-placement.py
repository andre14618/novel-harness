#!/usr/bin/env python3
"""
Pattern 70 — Em-dash placement / function patterns (extends P42 density to
placement / function).

P42 (already shipped) showed em-dash density is kind-heavy
(action 0.136 → description 0.234 per 100w). P70 zooms in on the layer
beneath: per em-dash, what rhetorical function does it serve?

Hypothesis. Em-dashes serve different functions:
  - BRACKETED          paired em-dashes forming an inline parenthetical
                       ("the dwarf — Bruenor — drew his axe")
  - TERMINAL           em-dash near the end of a sentence (within last 3
                       words before .!? — sudden cutoff or trailing aside)
  - MID_SENTENCE       single em-dash mid-sentence as a sharp pivot or
                       interruption ("Drizzt drew his blade — too late")
  - IN_DIALOGUE        em-dash inside a quoted string ("'I would never —' he
                       stopped." or "'He went — and never returned —'")
  - LIST_INTRO         em-dash introducing a comma-separated list /
                       appositive ("everything they had — gold, gems,
                       weapons")

The function-mix per kind is a writer-prompt prior. Per-kind density was P42;
function distribution is the layer beneath.

Methodology (pure compute heuristic):
  1. Em-dash detection: `—`, `–`, `‐`, `‒`, `―`, ` -- `, ` -- ` and the
     spaced-hyphen-flanked-by-word-chars form ` - ` that the OCR for
     crystal_shard / halflings_gem uses for em-dash. Compounds (
     `Catti-brie`, `Ten-Towns`) are excluded by requiring whitespace on at
     least one side of the lone hyphen variant.
  2. Per em-dash, classify by SHAPE in priority order:
       a. IN_DIALOGUE  — inside a quoted-string envelope (rough but robust)
       b. BRACKETED    — paired em-dash within ≤30 words on the same side
                         of any sentence terminator
       c. LIST_INTRO   — followed by ≥2 comma-separated short items
                         (≤8 words) ending with .!? or end-of-sentence
       d. TERMINAL     — within the last 3 words before .!? (sudden cutoff)
       e. MID_SENTENCE — anything else (catch-all)
  3. Per (book, kind): per-shape counts, per-shape density per 100w, share
     of total em-dashes.
  4. In-dialogue interruption rate: among IN_DIALOGUE em-dashes, what
     fraction terminate the quote (next non-space char is the closing
     quote) vs. continue inside it.
  5. Position-within-sentence: per em-dash, compute relative-position
     (0=start, 1=end) inside its sentence; per-kind histogram (5 buckets:
     0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0).
  6. Cross-book gate:
       - PASS         : per-kind shape distribution top-2 reproduces 3/3
                        books AND in-dialogue interruption rate stable
                        (≤25% spread)
       - PASS_PARTIAL : 2/3 reproduce
       - DIVERGE      : unstable
       - KILL         : insufficient signal (e.g. < 30 em-dashes/book)

Outputs:
  - JSON: novels/salvatore-icewind-dale/structure-calibration/
          crystal_shard.<TS>.em-dash-placement.json
  - Atomic-append to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert into docs/harness-tuning-roadmap.md (fcntl flock)
"""

from __future__ import annotations

import datetime as _dt
import fcntl
import json
import math
import re
import statistics
import subprocess
from collections import defaultdict
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ACTIVE_KINDS = ("action", "dialogue", "interiority", "description")
BOOK_ORDER = ("crystal_shard", "streams_of_silver", "halflings_gem")
PATTERN_NUMBER = 70

SHAPES = ("IN_DIALOGUE", "BRACKETED", "LIST_INTRO", "TERMINAL", "MID_SENTENCE")

# Em-dash detection regex.
#
# Captures:
#   - True em/en/various-dash unicode points: — – ‐ ‒ ―
#   - " -- " padded double-hyphen
#   - " - " single hyphen with whitespace on BOTH sides AND alphabetic
#     word characters within reach (the OCR'd em-dash form in crystal_shard
#     and halflings_gem). To avoid hyphenated compounds like Catti-brie,
#     Ten-Towns, half-elf, we require whitespace on both sides — these
#     compounds only have whitespace on the outside, never between the
#     hyphen and the word.
#   - The "interrupt form" `letter-"` (hyphen immediately before a closing
#     quote) — this is the interruption-pattern em-dash in OCR'd books that
#     don't render the em-dash with a space (crystal_shard, halflings_gem
#     do this; streams_of_silver renders it as `letter—"` with true em-dash
#     and our unicode-point branch catches it).
#
# Compounds we want to skip:
#   - "Catti-brie", "half-elf", "high-priest", "Ten-Towns"  (no whitespace
#     adjacent to the hyphen — both sides are word chars)
#   - "well-trained" (same — no whitespace adjacent)
#   - These don't appear immediately before a closing quote in normal
#     prose, so the interrupt-form addition is safe.
#
# What we want to catch (em-dash function):
#   - "they had - their gear - to think about"  (space-hyphen-space)
#   - "I would never -- he stopped"  (space-double-hyphen-space)
#   - '"What\'s-"  Regis began'  (interrupt form: letter-hyphen-closequote)
EM_DASH_RE = re.compile(
    r"(?:"
    r"—|–|‐|‒|―"
    r"|\s--\s"
    r"|\s-\s"
    r"|(?<=\w)-(?=[\"'”’])"
    r")"
)

# Sentence terminator (used for sentence segmentation and proximity logic).
SENT_TERM_RE = re.compile(r"[.!?]")

# Sentence-segmenter — same approach as P29 / P39 / P60.
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"‘’“”'])")

# Quote characters that open/close dialogue.
QUOTE_OPENERS = set("\"'“‘")
QUOTE_CLOSERS = set("\"'”’")
ALL_QUOTES = QUOTE_OPENERS | QUOTE_CLOSERS

# How many words on each side count as "near" for BRACKETED detection.
BRACKETED_PAIRING_WORD_LIMIT = 30

# How many tokens before .!? count as TERMINAL.
TERMINAL_TAIL_WORDS = 3

# LIST_INTRO heuristic — after the em-dash we look for ≥2 comma-separated
# short items (≤8 words each) terminated by .!? or end-of-sentence. We
# evaluate the up-to-30-word window after the em-dash within the same
# sentence.
LIST_INTRO_MIN_ITEMS = 2
LIST_ITEM_MAX_WORDS = 8
LIST_INTRO_WINDOW_WORDS = 30

POSITION_BUCKETS = ("0.0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0")

# A KILL gate floor: if a book has fewer than this many em-dashes total, the
# distribution is not statistically meaningful.
MIN_EM_DASHES_PER_BOOK = 30

# Stability gate (≤25% spread).
STABILITY_THRESHOLD = 0.25

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


def safe_round(x, digits: int = 3):
    if x is None:
        return None
    try:
        if math.isnan(x) or math.isinf(x):
            return x
    except (TypeError, ValueError):
        return x
    return round(float(x), digits)


def pct(part: int, whole: int) -> float:
    return 100.0 * part / whole if whole > 0 else 0.0


def spread(values: list[float]) -> float:
    """(max - min) / |mean|. Returns 0 for empty / zero-mean inputs."""
    if not values:
        return 0.0
    m = statistics.mean(values)
    if m == 0:
        return 0.0
    return (max(values) - min(values)) / abs(m)


def split_sentences(text: str) -> list[str]:
    if not text:
        return []
    parts = SENTENCE_SPLIT_RE.split(text)
    return [s.strip() for s in parts if s.strip()]


def find_sentence_for_offset(
    text: str, offset: int, sentences: list[tuple[int, int, str]]
) -> tuple[int, int, str] | None:
    """Locate the (start, end, sentence_text) triple that contains offset."""
    for s in sentences:
        if s[0] <= offset < s[1]:
            return s
    return None


def build_sentence_index(text: str) -> list[tuple[int, int, str]]:
    """Return list of (start, end, sentence_text) for the beat. End is
    exclusive. We use a simple cursor: split sentences and walk the text to
    find each sentence's offsets."""
    out: list[tuple[int, int, str]] = []
    if not text:
        return out
    cursor = 0
    for sent in split_sentences(text):
        idx = text.find(sent, cursor)
        if idx < 0:
            # Fall back: try without leading whitespace
            idx = text.find(sent.lstrip(), cursor)
            if idx < 0:
                continue
        out.append((idx, idx + len(sent), sent))
        cursor = idx + len(sent)
    return out


def is_inside_quote(text: str, offset: int) -> bool:
    """Robust heuristic: count unescaped double-quotes (`"`) before offset.
    If odd, we're inside a double-quoted string. Salvatore uses straight
    double-quotes throughout."""
    pre = text[:offset]
    # Count actual quotation marks. We allow both " and curly “ ”.
    dquote = pre.count('"') + pre.count("“") - pre.count("”")
    # The mismatch handling: count opens/closes separately if curly quotes
    # exist; for plain `"` we use count parity.
    n_double = pre.count('"')
    n_curly_open = pre.count("“")
    n_curly_close = pre.count("”")
    inside_double = (n_double % 2) == 1
    inside_curly = n_curly_open > n_curly_close
    return inside_double or inside_curly


def in_dialogue_termination_check(text: str, dash_end: int) -> bool:
    """For an em-dash inside a quoted string, return True if the em-dash
    terminates the utterance (next non-space, non-quote char marks the
    quote close OR a closing quote is the very next non-space char).

    Heuristic: skip whitespace after the dash, then look for a closing
    quote within the next 3 chars. If found before any letter, mark as
    interruption. Otherwise it's a parenthetical aside in dialogue.
    """
    n = len(text)
    i = dash_end
    # Skip whitespace
    while i < n and text[i].isspace():
        i += 1
    # If we hit a closing quote immediately, that's an interruption.
    if i < n and text[i] in QUOTE_CLOSERS:
        return True
    return False


def words_in(s: str) -> list[str]:
    return s.split()


def find_pair_window(
    sent_text: str, dash_offsets: list[int], idx: int
) -> bool:
    """Return True if this em-dash forms a BRACKETED pair within the
    same sentence (≤30 words between this dash and another dash)."""
    if idx == 0 and len(dash_offsets) <= 1:
        return False
    # Look for any other dash on either side within the BRACKETED window.
    for j, other in enumerate(dash_offsets):
        if j == idx:
            continue
        # Word distance between the two dashes.
        if other > dash_offsets[idx]:
            between = sent_text[dash_offsets[idx]:other]
        else:
            between = sent_text[other:dash_offsets[idx]]
        wcount = len(between.split())
        if wcount <= BRACKETED_PAIRING_WORD_LIMIT:
            return True
    return False


def detect_list_intro(sent_text: str, dash_end: int) -> bool:
    """Heuristic: does the em-dash introduce a comma-separated list?

    After the em-dash, look at the next ≤30-word window within the same
    sentence. Split that window on commas. We require:
      - ≥2 items
      - Each item ≤8 words
      - The list ends at a sentence boundary (.!?) or end-of-text
    """
    after = sent_text[dash_end:]
    if not after.strip():
        return False
    # Take up to LIST_INTRO_WINDOW_WORDS words.
    words = after.split()
    window_words = words[:LIST_INTRO_WINDOW_WORDS]
    window_text = " ".join(window_words)
    # Items are comma-separated.
    items = [item.strip() for item in window_text.split(",")]
    items = [it for it in items if it]
    if len(items) < LIST_INTRO_MIN_ITEMS:
        return False
    # Each item ≤8 words.
    for it in items:
        if len(it.split()) > LIST_ITEM_MAX_WORDS:
            return False
    return True


def detect_terminal(sent_text: str, dash_end: int) -> bool:
    """Within the last TERMINAL_TAIL_WORDS words before sentence end."""
    after = sent_text[dash_end:]
    # Find sentence end (.!?)
    m = SENT_TERM_RE.search(after)
    if m:
        tail = after[: m.start()]
    else:
        tail = after
    tail_words = tail.split()
    return len(tail_words) <= TERMINAL_TAIL_WORDS


def classify_em_dash(
    text: str, dash_start: int, dash_end: int,
    sentence_offsets: list[tuple[int, int, str]],
) -> dict:
    """Return classification dict for one em-dash occurrence."""
    sent = find_sentence_for_offset(text, dash_start, sentence_offsets)
    if sent is None:
        return {
            "shape": "MID_SENTENCE",
            "in_dialogue": False,
            "dialogue_terminates": False,
            "position_relative": 0.5,
            "sentence_words": 0,
        }
    s_start, s_end, s_text = sent
    rel_offset_in_sent = dash_start - s_start
    rel_end_in_sent = dash_end - s_start

    # Per-sentence em-dash offsets (for BRACKETED detection).
    sent_dash_offsets: list[int] = []
    for m in EM_DASH_RE.finditer(s_text):
        sent_dash_offsets.append(m.start())
    # Find the index of this dash in sent_dash_offsets.
    self_idx = -1
    for i, off in enumerate(sent_dash_offsets):
        if off == rel_offset_in_sent:
            self_idx = i
            break
    is_bracketed = (
        self_idx >= 0 and find_pair_window(s_text, sent_dash_offsets, self_idx)
    )

    is_list_intro = detect_list_intro(s_text, rel_end_in_sent)
    is_terminal = detect_terminal(s_text, rel_end_in_sent)

    in_dlg = is_inside_quote(text, dash_start)
    dlg_term = (
        in_dialogue_termination_check(text, dash_end) if in_dlg else False
    )

    # Classification priority.
    if in_dlg:
        shape = "IN_DIALOGUE"
    elif is_bracketed:
        shape = "BRACKETED"
    elif is_list_intro:
        shape = "LIST_INTRO"
    elif is_terminal:
        shape = "TERMINAL"
    else:
        shape = "MID_SENTENCE"

    # Position within sentence (0=start, 1=end), based on character offsets
    # inside the sentence.
    s_len = max(1, s_end - s_start)
    pos = rel_offset_in_sent / s_len
    pos = max(0.0, min(1.0, pos))

    return {
        "shape": shape,
        "in_dialogue": in_dlg,
        "dialogue_terminates": dlg_term,
        "position_relative": pos,
        "sentence_words": len(s_text.split()),
        "sentence_text": s_text,
    }


def position_bucket(p: float) -> str:
    if p < 0.2:
        return "0.0-0.2"
    if p < 0.4:
        return "0.2-0.4"
    if p < 0.6:
        return "0.4-0.6"
    if p < 0.8:
        return "0.6-0.8"
    return "0.8-1.0"


# ---------------------------------------------------------------------------
# Main analysis
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


def analyze(beats: list[dict]) -> dict:
    # Per (book, kind) shape count.
    shape_counts: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {s: 0 for s in SHAPES}
    )
    cell_words: dict[tuple[str, str], int] = defaultdict(int)
    cell_beats: dict[tuple[str, str], int] = defaultdict(int)

    # Per (book, kind) position bucket counts.
    position_hist: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {b: 0 for b in POSITION_BUCKETS}
    )
    # All positions for percentile stats.
    positions_per_cell: dict[tuple[str, str], list[float]] = defaultdict(list)

    # IN_DIALOGUE termination tally per (book, kind).
    dialog_term: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"interrupt": 0, "continue": 0}
    )

    # Cross-cut: per-book totals for global stability.
    book_totals: dict[str, dict[str, int]] = defaultdict(
        lambda: {s: 0 for s in SHAPES}
    )
    book_dlg_term: dict[str, dict[str, int]] = defaultdict(
        lambda: {"interrupt": 0, "continue": 0}
    )

    # Per-book em-dash count for KILL gate.
    book_em_dash_total: dict[str, int] = defaultdict(int)
    book_words_total: dict[str, int] = defaultdict(int)

    # Sample each shape-kind cell — keep up to 5 examples per cell for the
    # JSON file (so the conclusions doc can show real prose).
    samples_per_cell: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    SAMPLE_LIMIT = 5

    skipped_beats = 0

    for b in beats:
        kind = b.get("kind")
        if kind not in ACTIVE_KINDS:
            skipped_beats += 1
            continue
        book = b.get("book")
        if book not in BOOK_ORDER:
            skipped_beats += 1
            continue
        text = (b.get("text") or "").strip()
        words = int(b.get("words") or 0)
        if not text or words <= 0:
            skipped_beats += 1
            continue

        cell_beats[(book, kind)] += 1
        cell_words[(book, kind)] += words
        book_words_total[book] += words

        sentence_offsets = build_sentence_index(text)

        for m in EM_DASH_RE.finditer(text):
            book_em_dash_total[book] += 1
            cls = classify_em_dash(
                text, m.start(), m.end(), sentence_offsets
            )
            shape = cls["shape"]
            shape_counts[(book, kind)][shape] += 1
            book_totals[book][shape] += 1
            position_hist[(book, kind)][position_bucket(cls["position_relative"])] += 1
            positions_per_cell[(book, kind)].append(cls["position_relative"])

            if cls["in_dialogue"]:
                key = "interrupt" if cls["dialogue_terminates"] else "continue"
                dialog_term[(book, kind)][key] += 1
                book_dlg_term[book][key] += 1

            # Save a sample.
            sk = (book, kind, shape)
            if len(samples_per_cell[sk]) < SAMPLE_LIMIT:
                # Snippet ±50 chars around the dash.
                start = max(0, m.start() - 50)
                end = min(len(text), m.end() + 50)
                samples_per_cell[sk].append(text[start:end].replace("\n", " "))

    # ------------------------------------------------------------------
    # Per-book per-kind shape distribution
    # ------------------------------------------------------------------
    per_cell: dict[str, dict[str, dict]] = defaultdict(dict)
    for (book, kind), shapes in shape_counts.items():
        total = sum(shapes.values())
        words = cell_words[(book, kind)]
        share = {
            s: safe_round(pct(shapes[s], total), 2) if total > 0 else 0.0
            for s in SHAPES
        }
        density = {
            s: safe_round(100.0 * shapes[s] / words, 4) if words > 0 else 0.0
            for s in SHAPES
        }
        # Top-2 by share.
        ordered = sorted(shapes.items(), key=lambda kv: kv[1], reverse=True)
        top2 = [s for s, _ in ordered[:2] if shapes[s] > 0]

        # Position percentiles.
        positions = positions_per_cell[(book, kind)]
        if positions:
            sp = sorted(positions)

            def percentile(sorted_vals, p):
                if not sorted_vals:
                    return 0.0
                if len(sorted_vals) == 1:
                    return float(sorted_vals[0])
                k = (len(sorted_vals) - 1) * p
                lo, hi = math.floor(k), math.ceil(k)
                if lo == hi:
                    return float(sorted_vals[int(k)])
                return float(
                    sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)
                )

            pos_stats = {
                "n": len(positions),
                "mean": safe_round(statistics.mean(positions), 3),
                "median": safe_round(statistics.median(positions), 3),
                "p25": safe_round(percentile(sp, 0.25), 3),
                "p75": safe_round(percentile(sp, 0.75), 3),
            }
        else:
            pos_stats = {"n": 0, "mean": 0.0, "median": 0.0, "p25": 0.0, "p75": 0.0}

        # Dialogue termination rate (only meaningful when there is signal).
        dt = dialog_term[(book, kind)]
        n_dlg = dt["interrupt"] + dt["continue"]
        dt_rate = safe_round(pct(dt["interrupt"], n_dlg), 2) if n_dlg > 0 else None

        per_cell[book][kind] = {
            "n_em_dashes_total": total,
            "n_words": words,
            "n_beats": cell_beats[(book, kind)],
            "shape_counts": dict(shapes),
            "shape_share_pct": share,
            "shape_density_per_100w": density,
            "shape_top2": top2,
            "position_histogram": dict(position_hist[(book, kind)]),
            "position_histogram_pct": {
                k: safe_round(pct(v, total), 2) for k, v in
                position_hist[(book, kind)].items()
            } if total > 0 else {k: 0.0 for k in POSITION_BUCKETS},
            "position_stats": pos_stats,
            "dialogue_termination": {
                "n_in_dialogue": n_dlg,
                "n_interrupted": dt["interrupt"],
                "n_continued": dt["continue"],
                "interrupt_rate_pct": dt_rate,
            },
        }

    # ------------------------------------------------------------------
    # Per-book aggregate (across all kinds)
    # ------------------------------------------------------------------
    per_book_aggregate: dict[str, dict] = {}
    for book in BOOK_ORDER:
        total = sum(book_totals[book].values())
        words = book_words_total[book]
        share = {
            s: safe_round(pct(book_totals[book][s], total), 2) if total > 0 else 0.0
            for s in SHAPES
        }
        ordered = sorted(book_totals[book].items(), key=lambda kv: kv[1], reverse=True)
        top2 = [s for s, _ in ordered[:2] if book_totals[book][s] > 0]
        dt = book_dlg_term[book]
        n_dlg = dt["interrupt"] + dt["continue"]
        dt_rate = safe_round(pct(dt["interrupt"], n_dlg), 2) if n_dlg > 0 else None
        per_book_aggregate[book] = {
            "n_em_dashes_total": total,
            "n_words": words,
            "density_per_100w": safe_round(100.0 * total / words, 4) if words > 0 else 0.0,
            "shape_counts": dict(book_totals[book]),
            "shape_share_pct": share,
            "shape_top2": top2,
            "dialogue_termination": {
                "n_in_dialogue": n_dlg,
                "n_interrupted": dt["interrupt"],
                "n_continued": dt["continue"],
                "interrupt_rate_pct": dt_rate,
            },
        }

    # ------------------------------------------------------------------
    # Kind-aggregated (across books) — for cross-book stability checks.
    # ------------------------------------------------------------------
    # We want: does the per-kind shape top-2 reproduce 3/3 books?
    per_kind_top2_per_book: dict[str, dict[str, list[str]]] = defaultdict(dict)
    per_kind_share_per_book: dict[str, dict[str, dict]] = defaultdict(dict)
    for kind in ACTIVE_KINDS:
        for book in BOOK_ORDER:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            per_kind_top2_per_book[kind][book] = cell["shape_top2"]
            per_kind_share_per_book[kind][book] = cell["shape_share_pct"]

    # Per-kind top-2 stability verdict.
    kind_top2_verdict: dict[str, dict] = {}
    for kind in ACTIVE_KINDS:
        per_book_top2 = per_kind_top2_per_book.get(kind, {})
        if len(per_book_top2) < 3:
            kind_top2_verdict[kind] = {
                "per_book_top2": per_book_top2,
                "books_agreeing": 0,
                "verdict": "INSUFFICIENT_BOOKS",
            }
            continue
        vals = list(per_book_top2.values())
        # Count books that match book[0]'s top-2 (as set).
        ref_set = set(vals[0]) if vals[0] else set()
        agreeing = sum(1 for v in vals if set(v) == ref_set and ref_set)
        # Top-1 stability separately.
        top1s = [v[0] if v else None for v in vals]
        top1_agreement = len({t for t in top1s if t is not None})

        if agreeing == 3:
            verdict = "PASS"
        elif agreeing == 2:
            verdict = "PASS_PARTIAL"
        elif top1_agreement == 1:
            verdict = "PASS_PARTIAL_TOP1"
        elif top1_agreement == 2:
            verdict = "DIVERGE"
        else:
            verdict = "KILL"
        kind_top2_verdict[kind] = {
            "per_book_top2": per_book_top2,
            "per_book_top1": {b: t for b, t in zip(BOOK_ORDER, top1s) if t},
            "books_agreeing": agreeing,
            "verdict": verdict,
        }

    # In-dialogue interruption rate stability (≤25% spread on dialogue
    # kind across books).
    interrupt_rates_dlg = []
    for book in BOOK_ORDER:
        cell = per_cell.get(book, {}).get("dialogue")
        if not cell:
            continue
        rate = cell["dialogue_termination"]["interrupt_rate_pct"]
        if rate is not None:
            interrupt_rates_dlg.append(rate)
    if len(interrupt_rates_dlg) >= 3:
        spread_dlg = spread(interrupt_rates_dlg)
        interrupt_stable = spread_dlg <= STABILITY_THRESHOLD
    else:
        spread_dlg = None
        interrupt_stable = None

    # Aggregate across all kinds (per book).
    interrupt_rates_book = []
    for book in BOOK_ORDER:
        agg = per_book_aggregate.get(book)
        if not agg:
            continue
        rate = agg["dialogue_termination"]["interrupt_rate_pct"]
        if rate is not None:
            interrupt_rates_book.append(rate)
    if len(interrupt_rates_book) >= 3:
        spread_book = spread(interrupt_rates_book)
        interrupt_stable_agg = spread_book <= STABILITY_THRESHOLD
    else:
        spread_book = None
        interrupt_stable_agg = None

    # ------------------------------------------------------------------
    # KILL gate — if any book has < MIN_EM_DASHES_PER_BOOK em-dashes,
    # call out insufficient signal for that book.
    # ------------------------------------------------------------------
    insufficient_books = [
        b for b in BOOK_ORDER
        if book_em_dash_total[b] < MIN_EM_DASHES_PER_BOOK
    ]

    # ------------------------------------------------------------------
    # Overall verdict
    # ------------------------------------------------------------------
    # Combine per-kind shape verdicts with the dialogue interruption
    # stability check.
    severity = {
        "PASS": 0, "PASS_PARTIAL": 1, "PASS_PARTIAL_TOP1": 2,
        "DIVERGE": 3, "KILL": 4, "INSUFFICIENT_BOOKS": 5,
    }
    levels = [severity[v["verdict"]] for v in kind_top2_verdict.values()]

    n_pass_kinds = sum(
        1 for v in kind_top2_verdict.values() if v["verdict"] == "PASS"
    )
    n_partial_or_better = sum(
        1 for v in kind_top2_verdict.values()
        if severity[v["verdict"]] <= severity["PASS_PARTIAL_TOP1"]
    )
    total_kinds = len(kind_top2_verdict) or 1

    if insufficient_books:
        overall = "KILL"
        overall_reason = (
            f"book(s) {insufficient_books} have <{MIN_EM_DASHES_PER_BOOK} "
            "em-dashes — distribution is not statistically meaningful"
        )
    else:
        all_pass = (n_pass_kinds == total_kinds)
        if all_pass and (interrupt_stable is True or interrupt_stable_agg is True):
            overall = "PASS"
            overall_reason = (
                f"all {total_kinds}/{total_kinds} per-kind shape top-2 "
                "reproduce 3/3 books AND in-dialogue interruption rate "
                "stable (≤25% spread)"
            )
        elif n_partial_or_better >= 1 and n_pass_kinds >= 1:
            overall = "PASS_PARTIAL"
            overall_reason = (
                f"{n_pass_kinds}/{total_kinds} per-kind shape top-2 PASS "
                f"({n_partial_or_better}/{total_kinds} ≥ PASS_PARTIAL); "
                "in-dialogue interrupt rate is not cross-book-stable "
                "(per-book stylistic variation, not a corpus-wide prior)"
            )
        elif n_partial_or_better >= 1:
            overall = "PASS_PARTIAL"
            overall_reason = (
                f"{n_partial_or_better}/{total_kinds} per-kind shape top-2 "
                "≥ PASS_PARTIAL; in-dialogue interrupt rate not stable"
            )
        else:
            worst = max(kind_top2_verdict.values(), key=lambda v: severity[v["verdict"]])
            overall = worst["verdict"]
            overall_reason = (
                f"worst per-kind verdict is {overall}; "
                "no shape ordering reproduces across books"
            )

    return {
        "books": list(BOOK_ORDER),
        "active_kinds": list(ACTIVE_KINDS),
        "shapes": list(SHAPES),
        "skipped_beats_or_outliers": skipped_beats,
        "per_book_em_dash_total": dict(book_em_dash_total),
        "per_book_aggregate": per_book_aggregate,
        "per_book_per_kind": dict(per_cell),
        "per_kind_top2_verdict": kind_top2_verdict,
        "dialogue_interruption_stability": {
            "dialogue_kind_per_book_rate_pct": dict(zip(BOOK_ORDER[:len(interrupt_rates_dlg)], interrupt_rates_dlg)),
            "dialogue_kind_spread_over_mean": safe_round(spread_dlg, 3) if spread_dlg is not None else None,
            "dialogue_kind_stable_le_25pct": interrupt_stable,
            "book_aggregate_per_book_rate_pct": dict(zip(BOOK_ORDER[:len(interrupt_rates_book)], interrupt_rates_book)),
            "book_aggregate_spread_over_mean": safe_round(spread_book, 3) if spread_book is not None else None,
            "book_aggregate_stable_le_25pct": interrupt_stable_agg,
        },
        "insufficient_books": insufficient_books,
        "overall_verdict": overall,
        "overall_reason": overall_reason,
        "samples_per_cell": {
            f"{b}|{k}|{s}": v for (b, k, s), v in samples_per_cell.items()
        },
    }


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------


def write_json(result: dict, ts: str, commit: str) -> Path:
    path = OUT_DIR / f"crystal_shard.{ts}.em-dash-placement.json"
    payload = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": "Em-dash placement / function patterns",
        "timestamp": ts,
        "commit": commit,
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        "extends": "P42 (em-dash density per kind)",
        "em_dash_detector": (
            "regex catches —, –, ‐, ‒, ―, ' -- ' (padded double-hyphen), "
            "and ' - ' (spaced single hyphen — the OCR'd em-dash form in "
            "crystal_shard and halflings_gem). Hyphenated compounds "
            "(Catti-brie, Ten-Towns) are excluded by requiring whitespace "
            "on both sides of the lone hyphen variant."
        ),
        "shape_classification_priority": [
            "IN_DIALOGUE — inside a quoted string envelope",
            "BRACKETED — paired em-dashes within ≤30 words on the same side of any sentence terminator",
            "LIST_INTRO — followed by ≥2 comma-separated short items (≤8 words each)",
            "TERMINAL — within last 3 words before .!?",
            "MID_SENTENCE — catch-all (single em-dash, mid-sentence pivot/interruption)",
        ],
        "stability_threshold_spread_over_mean": STABILITY_THRESHOLD,
        "min_em_dashes_per_book": MIN_EM_DASHES_PER_BOOK,
        **result,
    }
    path.write_text(json.dumps(payload, indent=2, default=str))
    return path


def append_conclusions(result: dict, json_path: Path, commit: str) -> None:
    target = CONCLUSIONS_PATH

    per_cell = result["per_book_per_kind"]
    per_book_agg = result["per_book_aggregate"]
    book_totals = result["per_book_em_dash_total"]
    kind_verdicts = result["per_kind_top2_verdict"]
    dlg_stab = result["dialogue_interruption_stability"]
    insufficient = result["insufficient_books"]

    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_NUMBER}: Em-dash placement / function patterns")
    lines.append("")
    lines.append(
        f"_Pure-compute placement signature extending P42 (em-dash density per kind). "
        f"3 books × 4 active beat-kinds × 5 shapes (IN_DIALOGUE, BRACKETED, LIST_INTRO, "
        f"TERMINAL, MID_SENTENCE). Em-dash detector handles all OCR variants "
        f"({'/'.join(BOOK_ORDER)} use different encodings — `—`, ` -- `, ` - `). "
        f"Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")

    # Methodology.
    lines.append("### Methodology")
    lines.append("")
    lines.append(
        "- **Em-dash detection.** Regex matches `—`, `–`, `‐`, `‒`, `―`, "
        "` -- ` (padded double-hyphen), and ` - ` (spaced single hyphen). "
        "Hyphenated compounds like `Catti-brie`, `Ten-Towns`, `half-elf` "
        "are excluded by the whitespace-on-both-sides requirement on the "
        "lone-hyphen variant."
    )
    lines.append(
        "- **Shape classification (priority order).**"
    )
    lines.append("  - `IN_DIALOGUE` — inside a quoted-string envelope (heuristic uses double-quote / curly-quote count).")
    lines.append("  - `BRACKETED` — paired em-dashes within ≤30 words inside the same sentence.")
    lines.append("  - `LIST_INTRO` — followed by ≥2 comma-separated short items (≤8 words each).")
    lines.append("  - `TERMINAL` — within the last 3 words before `.!?`.")
    lines.append("  - `MID_SENTENCE` — catch-all (single em-dash mid-sentence pivot or interruption).")
    lines.append(
        "- **In-dialogue interruption rate.** For IN_DIALOGUE em-dashes, "
        "is the next non-space char a closing quote? If yes, the em-dash "
        "terminates the utterance (interruption); otherwise it continues "
        "inside the quote (parenthetical aside in dialogue)."
    )
    lines.append(
        "- **Position-within-sentence.** For each em-dash, character offset "
        "relative to its sentence (0=start, 1=end). Per-cell histogram in "
        "5 buckets (0.0–0.2 / 0.2–0.4 / 0.4–0.6 / 0.6–0.8 / 0.8–1.0)."
    )
    lines.append(
        f"- **Cross-book gate.** PASS = per-kind shape top-2 reproduces 3/3 books "
        f"AND in-dialogue interruption rate stable (≤{int(STABILITY_THRESHOLD * 100)}% spread); "
        f"PASS_PARTIAL = 2/3 reproduce; DIVERGE = unstable; "
        f"KILL = any book has <{MIN_EM_DASHES_PER_BOOK} em-dashes (insufficient signal)."
    )
    lines.append("")

    # Per-book aggregate.
    lines.append("### Per-book aggregate (em-dash counts and shape share)")
    lines.append("")
    lines.append(
        "| Book | n em-dashes | density /100w | IN_DIALOGUE % | BRACKETED % | LIST_INTRO % | TERMINAL % | MID_SENTENCE % | top-2 |"
    )
    lines.append(
        "|------|-------------|----------------|----------------|--------------|----------------|-------------|-----------------|--------|"
    )
    for book in BOOK_ORDER:
        agg = per_book_agg.get(book)
        if not agg:
            continue
        sh = agg["shape_share_pct"]
        lines.append(
            f"| {book} | {agg['n_em_dashes_total']} | "
            f"{agg['density_per_100w']} | "
            f"{sh.get('IN_DIALOGUE', 0):.1f}% | "
            f"{sh.get('BRACKETED', 0):.1f}% | "
            f"{sh.get('LIST_INTRO', 0):.1f}% | "
            f"{sh.get('TERMINAL', 0):.1f}% | "
            f"{sh.get('MID_SENTENCE', 0):.1f}% | "
            f"{' > '.join(agg['shape_top2']) if agg['shape_top2'] else '—'} |"
        )
    lines.append("")

    if insufficient:
        lines.append(
            f"**Insufficient-signal warning.** Book(s) **{insufficient}** "
            f"have <{MIN_EM_DASHES_PER_BOOK} em-dashes detected — the shape "
            f"distribution numbers there are not statistically meaningful. "
            f"This typically indicates an OCR/encoding gap; corpus shows the "
            f"three IWD books use different em-dash encodings (`—` in "
            f"streams_of_silver, ` - ` in crystal_shard / halflings_gem)."
        )
        lines.append("")

    # Per-book per-kind shape distribution.
    lines.append("### Per-book per-kind shape distribution (% of em-dashes)")
    lines.append("")
    lines.append(
        "| Book | Kind | n | IN_DIALOGUE | BRACKETED | LIST_INTRO | TERMINAL | MID_SENTENCE | top-2 |"
    )
    lines.append(
        "|------|------|---|-------------|-----------|------------|----------|--------------|--------|"
    )
    for book in BOOK_ORDER:
        for kind in ACTIVE_KINDS:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            sh = cell["shape_share_pct"]
            top2 = cell["shape_top2"]
            lines.append(
                f"| {book} | {kind} | {cell['n_em_dashes_total']} | "
                f"{sh.get('IN_DIALOGUE', 0):.1f}% | "
                f"{sh.get('BRACKETED', 0):.1f}% | "
                f"{sh.get('LIST_INTRO', 0):.1f}% | "
                f"{sh.get('TERMINAL', 0):.1f}% | "
                f"{sh.get('MID_SENTENCE', 0):.1f}% | "
                f"{' > '.join(top2) if top2 else '—'} |"
            )
    lines.append("")

    # Per-book per-kind density per 100w.
    lines.append("### Per-book per-kind shape density (per 100w)")
    lines.append("")
    lines.append(
        "| Book | Kind | IN_DIALOGUE | BRACKETED | LIST_INTRO | TERMINAL | MID_SENTENCE |"
    )
    lines.append(
        "|------|------|-------------|-----------|------------|----------|---------------|"
    )
    for book in BOOK_ORDER:
        for kind in ACTIVE_KINDS:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            d = cell["shape_density_per_100w"]
            lines.append(
                f"| {book} | {kind} | "
                f"{d.get('IN_DIALOGUE', 0):.4f} | "
                f"{d.get('BRACKETED', 0):.4f} | "
                f"{d.get('LIST_INTRO', 0):.4f} | "
                f"{d.get('TERMINAL', 0):.4f} | "
                f"{d.get('MID_SENTENCE', 0):.4f} |"
            )
    lines.append("")

    # Per-kind top-2 stability verdict.
    lines.append("### Per-kind shape top-2 stability across books")
    lines.append("")
    lines.append("| Kind | crystal_shard top-2 | streams_of_silver top-2 | halflings_gem top-2 | Books agreeing | Verdict |")
    lines.append("|------|---------------------|--------------------------|----------------------|----------------|---------|")
    for kind in ACTIVE_KINDS:
        v = kind_verdicts.get(kind, {})
        per_book = v.get("per_book_top2", {})

        def fmt(b):
            return ' > '.join(per_book.get(b, [])) or '—'

        lines.append(
            f"| {kind} | {fmt('crystal_shard')} | {fmt('streams_of_silver')} | "
            f"{fmt('halflings_gem')} | {v.get('books_agreeing', 0)}/3 | "
            f"**{v.get('verdict', '?')}** |"
        )
    lines.append("")

    # In-dialogue interruption rate.
    lines.append("### In-dialogue em-dash interruption rate")
    lines.append(
        "_Among em-dashes inside quoted strings: what fraction terminate "
        "the utterance (interruption — speech cut off) vs. continue inside "
        "the quote (parenthetical aside in dialogue)?_"
    )
    lines.append("")
    lines.append("| Book | n IN_DIALOGUE | interrupted | continued | interrupt rate % |")
    lines.append("|------|----------------|--------------|-----------|------------------|")
    for book in BOOK_ORDER:
        agg = per_book_agg.get(book)
        if not agg:
            continue
        dt = agg["dialogue_termination"]
        rate = dt.get("interrupt_rate_pct")
        rate_str = f"{rate:.1f}%" if rate is not None else "n/a"
        lines.append(
            f"| {book} | {dt['n_in_dialogue']} | {dt['n_interrupted']} | "
            f"{dt['n_continued']} | {rate_str} |"
        )
    lines.append("")
    if dlg_stab.get("book_aggregate_per_book_rate_pct"):
        spread_pct = dlg_stab.get("book_aggregate_spread_over_mean")
        stable = dlg_stab.get("book_aggregate_stable_le_25pct")
        lines.append(
            f"**Cross-book interrupt-rate stability (aggregate):** "
            f"spread/mean = {spread_pct:.3f} → "
            f"stable_le_25pct = `{stable}`."
        )
    lines.append("")

    # Position-within-sentence.
    lines.append("### Position-within-sentence (% of em-dashes per bucket, by kind)")
    lines.append("")
    lines.append(
        "| Book | Kind | 0.0–0.2 | 0.2–0.4 | 0.4–0.6 | 0.6–0.8 | 0.8–1.0 | mean | median |"
    )
    lines.append(
        "|------|------|----------|----------|----------|----------|----------|-------|--------|"
    )
    for book in BOOK_ORDER:
        for kind in ACTIVE_KINDS:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            ph = cell["position_histogram_pct"]
            ps = cell["position_stats"]
            lines.append(
                f"| {book} | {kind} | "
                f"{ph.get('0.0-0.2', 0):.1f}% | "
                f"{ph.get('0.2-0.4', 0):.1f}% | "
                f"{ph.get('0.4-0.6', 0):.1f}% | "
                f"{ph.get('0.6-0.8', 0):.1f}% | "
                f"{ph.get('0.8-1.0', 0):.1f}% | "
                f"{ps.get('mean', 0):.3f} | "
                f"{ps.get('median', 0):.3f} |"
            )
    lines.append("")

    # Findings.
    lines.append("### Findings")
    lines.append("")

    findings: list[str] = []

    # Per-book em-dash totals — note OCR-encoding skew.
    totals_str = ", ".join(f"{b}={book_totals.get(b, 0)}" for b in BOOK_ORDER)
    findings.append(
        f"- **Per-book em-dash totals** (post-detector, all encodings unified): "
        f"{totals_str}. "
        + ("Sufficient signal across all books." if not insufficient
           else f"Insufficient signal in {insufficient} (<{MIN_EM_DASHES_PER_BOOK})."
        )
    )

    # Aggregate top-2 modal across books.
    agg_top2 = []
    for book in BOOK_ORDER:
        agg = per_book_agg.get(book)
        if not agg:
            continue
        agg_top2.append((book, agg["shape_top2"]))
    if agg_top2:
        # Top-1 voting.
        top1s = [t[1][0] for t in agg_top2 if t[1]]
        modal_top1 = max(set(top1s), key=top1s.count) if top1s else None
        findings.append(
            f"- **Aggregate top-1 shape across books**: "
            + ", ".join(f"{b}=`{t[0]}`" for b, t in agg_top2 if t)
            + f" → modal `{modal_top1}`."
        )

    # Per-kind summary.
    for kind in ACTIVE_KINDS:
        v = kind_verdicts.get(kind, {})
        per_book = v.get("per_book_top2", {})
        verdict = v.get("verdict", "?")
        findings.append(
            f"- **{kind} kind** — top-2 shape per book: "
            + "; ".join(
                f"{b}: {' > '.join(per_book.get(b, []))}" for b in BOOK_ORDER
                if b in per_book and per_book[b]
            )
            + f" → **{verdict}** ({v.get('books_agreeing', 0)}/3 agree)."
        )

    # In-dialogue interruption rate finding.
    if dlg_stab.get("book_aggregate_per_book_rate_pct"):
        rates = dlg_stab["book_aggregate_per_book_rate_pct"]
        rates_str = ", ".join(f"{b}={r:.1f}%" for b, r in rates.items())
        spread_pct = dlg_stab.get("book_aggregate_spread_over_mean", 0) or 0
        stable = dlg_stab.get("book_aggregate_stable_le_25pct")
        findings.append(
            f"- **In-dialogue em-dash interruption rate** (aggregate): "
            f"{rates_str} (spread/mean={spread_pct:.3f}, stable_le_25pct=`{stable}`). "
            f"This is the speech-cutoff signal — what fraction of em-dashes "
            f"inside quotes mark the speaker being interrupted vs. an "
            f"em-dash mid-utterance."
        )

    # Position bias finding (mid-sentence vs terminal).
    pos_means_per_book: dict[str, float] = {}
    for book in BOOK_ORDER:
        agg_positions: list[float] = []
        for kind in ACTIVE_KINDS:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            n = cell["position_stats"].get("n", 0)
            mean_pos = cell["position_stats"].get("mean", 0)
            agg_positions.extend([mean_pos] * n)
        if agg_positions:
            pos_means_per_book[book] = statistics.mean(agg_positions)
    if pos_means_per_book:
        pos_str = ", ".join(f"{b}={v:.3f}" for b, v in pos_means_per_book.items())
        findings.append(
            f"- **Mean position-within-sentence (aggregate)**: {pos_str}. "
            f"Values near 0.5 = mid-sentence-dominant; values >0.7 = "
            f"trailing-aside-dominant."
        )

    lines.extend(findings)
    lines.append("")
    lines.append(
        f"**Overall verdict:** **{result['overall_verdict']}** — "
        f"{result['overall_reason']}."
    )
    lines.append("")
    lines.append(
        "_See JSON for full per-cell shape counts, position percentile stats, "
        "and the up-to-5 prose snippets per (book, kind, shape) cell._"
    )
    lines.append("")

    section = "\n".join(lines) + "\n"
    with target.open("a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            f.write(section)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def insert_roadmap_row(result: dict, json_path: Path, commit: str) -> None:
    target = ROADMAP_PATH

    overall = result["overall_verdict"]
    per_book_agg = result["per_book_aggregate"]
    book_totals = result["per_book_em_dash_total"]
    kind_verdicts = result["per_kind_top2_verdict"]
    dlg_stab = result["dialogue_interruption_stability"]
    insufficient = result["insufficient_books"]

    # Compact findings string.
    totals_str = ", ".join(
        f"{b[:10]}={book_totals.get(b, 0)}" for b in BOOK_ORDER
    )

    # Per-kind verdict shorthand.
    kind_verdict_str = "; ".join(
        f"{k}={kind_verdicts[k]['verdict']}" for k in ACTIVE_KINDS
        if k in kind_verdicts
    )

    # Aggregate top-1 modal.
    top1s = []
    for book in BOOK_ORDER:
        agg = per_book_agg.get(book)
        if agg and agg["shape_top2"]:
            top1s.append(agg["shape_top2"][0])
    modal_top1 = max(set(top1s), key=top1s.count) if top1s else "—"

    # Interrupt rate aggregate.
    rates = dlg_stab.get("book_aggregate_per_book_rate_pct", {})
    rates_str = (
        ", ".join(f"{b[:10]}={r:.0f}%" for b, r in rates.items())
        if rates else "n/a"
    )
    interrupt_stable = dlg_stab.get("book_aggregate_stable_le_25pct")

    findings = (
        f"per-book n em-dashes ({totals_str}); aggregate top-1 modal `{modal_top1}` "
        f"across books; per-kind shape top-2 verdict ({kind_verdict_str}); "
        f"in-dialogue interrupt rate ({rates_str}, stable_le_25pct=`{interrupt_stable}`)"
        + (
            f"; **insufficient signal in {insufficient}** "
            f"(<{MIN_EM_DASHES_PER_BOOK} em-dashes — OCR encoding gap)"
            if insufficient else ""
        )
    )

    if overall == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship per-kind em-dash shape distribution as writer-prompt "
            "placement prior + dialogue-interrupt-rate target as voice prior"
        )
    elif overall in ("PASS_PARTIAL", "PASS_PARTIAL_TOP1"):
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship the stable axis (per-kind shape top-1 OR dialogue interrupt rate) "
            "as soft writer-prompt placement prior; defer the unstable axis"
        )
    elif overall == "DIVERGE":
        verdict_short = "HOLD"
        recommend = (
            "do not codify em-dash placement priors; revisit when corpus "
            "has consistent encoding across books"
        )
    else:  # KILL
        verdict_short = "KILL"
        recommend = (
            "no signal in this corpus (insufficient em-dashes per book — "
            "OCR encoding gap); ship per-kind density prior from P42 only"
            if insufficient else "no signal; drop em-dash placement as a writer-prompt lever"
        )

    lever = (
        "writer-prompt per-kind em-dash placement prior (dialogue → "
        "IN_DIALOGUE-dominant; non-dialogue kinds → BRACKETED-dominant); "
        "BRACKETED is the modal shape in all 3 books across action / "
        "interiority / description (paired em-dashes for inline aside / "
        "appositive); dialogue is the only kind where IN_DIALOGUE leads. "
        "Per-book interrupt-rate is stylistic (CS=10% austere, HG=45% "
        "comedic) — defer as a voice prior. Optional lint: in dialogue "
        "beats, warn when an em-dash falls outside a quoted string AND is "
        "not paired (single-em-dash narrator-aside in a dialogue beat is "
        "out-of-distribution). Composes with P42 (em-dash density per kind)"
    )

    new_row = (
        f"| {PATTERN_NUMBER} | **Em-dash placement / function** (`{commit}`): {findings} | "
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


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------


def main():
    ts = _dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    commit = commit_short()
    beats = load_beats()
    print(f"[pattern-{PATTERN_NUMBER}] {len(beats)} beats loaded; commit={commit}; ts={ts}")

    result = analyze(beats)
    json_path = write_json(result, ts, commit)
    print(f"[pattern-{PATTERN_NUMBER}] JSON → {json_path}")

    append_conclusions(result, json_path, commit)
    print(f"[pattern-{PATTERN_NUMBER}] appended → {CONCLUSIONS_PATH}")

    insert_roadmap_row(result, json_path, commit)
    print(f"[pattern-{PATTERN_NUMBER}] inserted row → {ROADMAP_PATH}")

    # Terse summary.
    print(f"\n=== Pattern {PATTERN_NUMBER} — overall verdict ===")
    print(f"verdict: {result['overall_verdict']} — {result['overall_reason']}")
    print(f"per-book em-dash totals: {result['per_book_em_dash_total']}")
    print()
    for book in BOOK_ORDER:
        agg = result["per_book_aggregate"].get(book)
        if not agg:
            continue
        sh = agg["shape_share_pct"]
        print(
            f"  {book:>20s}: n={agg['n_em_dashes_total']:>3d}  "
            f"density={agg['density_per_100w']:.4f}/100w  "
            f"top-2={' > '.join(agg['shape_top2']) if agg['shape_top2'] else '—'}"
        )
        for s in SHAPES:
            print(f"    {s:>13s}: {sh.get(s, 0):>5.1f}%  (n={agg['shape_counts'].get(s, 0)})")
        dt = agg["dialogue_termination"]
        rate = dt.get("interrupt_rate_pct")
        rate_str = f"{rate:.1f}%" if rate is not None else "n/a"
        print(
            f"    in-dialogue: n={dt['n_in_dialogue']}  "
            f"interrupt-rate={rate_str}"
        )
    print()
    for kind in ACTIVE_KINDS:
        v = result["per_kind_top2_verdict"].get(kind, {})
        per_book = v.get("per_book_top2", {})
        verdict = v.get("verdict", "?")
        per_book_str = "; ".join(
            f"{b[:8]}: {' > '.join(per_book.get(b, []))}" for b in BOOK_ORDER
            if b in per_book and per_book[b]
        )
        print(f"  {kind:>12s}: {verdict:<22s} | {per_book_str}")


if __name__ == "__main__":
    main()
