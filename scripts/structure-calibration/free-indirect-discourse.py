#!/usr/bin/env python3
"""
Pattern 68 — Free indirect discourse (FID) signatures per beat-kind.

Hypothesis. Free indirect discourse renders character-thought without
quote marks, often with tense/register shifts mid-paragraph. It is a
hallmark of close-third narration (Salvatore's default voice). Heuristic
markers, in pure compute, that should cluster in interiority beats:

  1. Interrogative-fragment density — `?`-terminated sentences that are
     short (<8 words) AND outside any quoted span. ("What now?" "Where?")
     Overlaps with P59 question-density but here filtered to non-dialogue
     spans of the prose so we isolate narrator-as-character voice.

  2. Modal-hedge density — `\\b(surely|perhaps|maybe|indeed|of course|
     undoubtedly|no doubt|how could|how would|why would)\\b` per 100w.
     These are speculative tokens the narrator only emits when speaking
     in the character's epistemic register.

  3. Bare-adversative opener density — sentences starting with
     `But / And / Yet / Still / So`. P39 captured these as conjunction-
     first openers; here we count ALL such sentences (not just openers).
     Salvatore's interior-rebuttal voice (P39 `interiority 1.6×` action).

  4. Exclamatory-fragment density — `!`-terminated sentences <8 words AND
     outside quotes. ("Damn the lot of them.") Rare in narration; FID
     signature when it does fire.

  5. Self-addressed-modal density — `\\b(must|should|cannot|could not|
     dare not|will not)\\s+\\w+\\b` outside quotes. Modal verbs without
     explicit grammatical subject (the modal heads a clause whose subject
     is the narrator-rendered character).

A 6th surface marker — italicized internal thought — was killed by
Pattern 58 (italics not preserved through PDF -> canonical text).

Methodology (pure compute, Stage 1):
  - Per beat: strip quoted spans, then count Stage-1 markers, normalize
    per 100 words.
  - Per (book, kind): aggregate per-marker density (length-weighted) plus
    per-beat mean. Combined FID-marker density = sum of per-100w marker
    densities (each marker counted once on the same word base).
  - Per-kind ordering: does interiority lead in combined FID-density
    across all 3 books?
  - Modal-hedge interiority/action ratio per book: hypothesis is >=2x
    (gate is >=1.5x to leave headroom for noisy short kinds).
  - Bare-adversative cross-check: per-kind density should reproduce the
    P39 conjunction-first interiority>action 1.6x finding.

Stage 2 (LLM classification) is intentionally NOT included — Stage 1
markers reproduce known directional findings (P39, P59, P61) and the
methodology guidance permits skipping Stage 2 if Stage 1 is sufficient.

Cross-book gate:
  PASS         — interiority leads combined FID-density 3/3 books
                 AND modal-hedge interiority/action ratio >=1.5x in 3/3
                 AND bare-adversative interiority/action ratio >=1.3x 3/3
  PASS_PARTIAL — 2/3 reproduce on the leading-direction signals
  DIVERGE      — unstable
  KILL         — interiority does NOT lead combined FID-density anywhere

Outputs:
  - JSON: novels/salvatore-icewind-dale/structure-calibration/
          crystal_shard.<TS>.free-indirect-discourse.json
  - Atomic-append to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert into docs/harness-tuning-roadmap.md (fcntl flock)
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import defaultdict, Counter
from pathlib import Path
from statistics import mean
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# Lib path bootstrap (matches per-character-voice.py convention)
# ---------------------------------------------------------------------------

_LIB_DIR = Path(__file__).resolve().parent / "lib"
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from atomic_io import (  # noqa: E402
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
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

PATTERN_NUMBER = 68
PATTERN_SLUG = "free-indirect-discourse"
PATTERN_NAME = "Free indirect discourse signatures per beat-kind"

# ---------------------------------------------------------------------------
# Active scope
# ---------------------------------------------------------------------------

ACTIVE_KINDS: Tuple[str, ...] = ("interiority", "action", "description", "dialogue")
# Hypothesis order: interiority leads. Dialogue is tracked but expected to
# be irrelevant once we strip quoted spans (most dialogue-kind beat words
# are inside quotes).
EXPECTED_LEAD = "interiority"

# ---------------------------------------------------------------------------
# Marker definitions
# ---------------------------------------------------------------------------

MODAL_HEDGE_RE = re.compile(
    r"\b("
    r"surely(?:\s+not)?"  # "surely", "surely not"
    r"|perhaps"
    r"|maybe"
    r"|indeed"
    r"|of\s+course"
    r"|undoubtedly"
    r"|no\s+doubt"
    r"|how\s+could"
    r"|how\s+would"
    r"|why\s+would"
    r"|why\s+should"
    r"|how\s+should"
    r"|certainly"
    r"|surely\s+he"
    r")\b",
    flags=re.IGNORECASE,
)

# Bare-adversative openers: sentence starts with one of these tokens.
BARE_ADV_OPENERS = ("But", "And", "Yet", "Still", "So")

# Self-addressed modal: a modal verb followed by a verb without an
# explicit pronoun subject. We keyword-match the modal token and check
# the local context (this is heuristic — it's NOT a parser).
SELF_MODAL_RE = re.compile(
    r"\b("
    r"must"
    r"|should"
    r"|cannot"
    r"|could\s+not"
    r"|dare\s+not"
    r"|will\s+not"
    r"|shall\s+not"
    r"|cannot\s+have"
    r"|might\s+have"
    r"|may\s+have"
    r")\s+([a-zA-Z]+)\b",
    flags=re.IGNORECASE,
)

# Quote span regex — matches " ... " or ' ... ' or curly variants.
# We treat any of the following pairings as quote spans for the purpose
# of stripping: ASCII straight quotes, curly double-quotes, curly
# single-quotes. Single straight quotes are NOT treated as quote opens
# because they collide with apostrophes in contractions.
_QUOTE_SPAN_RES: Tuple[re.Pattern, ...] = (
    # ASCII double quotes — non-greedy
    re.compile(r'"[^"\n]{0,500}?"', flags=re.DOTALL),
    # Curly double quotes
    re.compile(r"“[^”\n]{0,500}?”", flags=re.DOTALL),
    # Curly single quotes
    re.compile(r"‘[^’\n]{0,500}?’", flags=re.DOTALL),
)

# Sentence segmentation
_LINEBREAK_RE = re.compile(r"\s+")
_SENT_SPLIT_RE = re.compile(r"[^.!?]+[.!?]+|\s*[^.!?]+$")


def normalize_text(text: str) -> str:
    return _LINEBREAK_RE.sub(" ", text or "").strip()


def split_sentences(text: str) -> List[str]:
    text = normalize_text(text)
    if not text:
        return []
    raw = _SENT_SPLIT_RE.findall(text)
    return [s.strip() for s in raw if s.strip()]


def strip_quoted_spans(text: str) -> Tuple[str, int, int]:
    """Replace any quoted span with a single space so the surrounding text
    structure is preserved but the quoted content does not contribute to
    Stage-1 markers.

    Returns (stripped_text, n_quote_spans, words_in_quotes).
    """
    n_spans = 0
    quoted_words = 0
    out = text
    for rgx in _QUOTE_SPAN_RES:
        def _sub(m: re.Match) -> str:
            nonlocal n_spans, quoted_words
            content = m.group(0)
            n_spans += 1
            quoted_words += len(re.findall(r"[A-Za-z]+(?:[\'’][A-Za-z]+)?", content))
            return " "
        out = rgx.sub(_sub, out)
    return out, n_spans, quoted_words


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z]+(?:[\'’][A-Za-z]+)?", text))


# ---------------------------------------------------------------------------
# Marker counters (operate on QUOTE-STRIPPED text)
# ---------------------------------------------------------------------------

def count_interrogative_fragments(stripped_text: str, max_words: int = 8) -> Tuple[int, List[str]]:
    """`?`-terminated sentences with <max_words words. Returns (count, samples)."""
    out: List[str] = []
    n = 0
    for s in split_sentences(stripped_text):
        if not s.endswith("?"):
            continue
        wc = word_count(s)
        if 0 < wc < max_words:
            n += 1
            if len(out) < 8:
                out.append(s if len(s) <= 200 else s[:197] + "...")
    return n, out


def count_exclamatory_fragments(stripped_text: str, max_words: int = 8) -> Tuple[int, List[str]]:
    """`!`-terminated sentences with <max_words words. Returns (count, samples)."""
    out: List[str] = []
    n = 0
    for s in split_sentences(stripped_text):
        if not s.endswith("!"):
            continue
        wc = word_count(s)
        if 0 < wc < max_words:
            n += 1
            if len(out) < 8:
                out.append(s if len(s) <= 200 else s[:197] + "...")
    return n, out


def count_modal_hedges(stripped_text: str) -> Tuple[int, Counter, List[str]]:
    """Returns (total, by-token Counter, sample-substrings)."""
    matches = MODAL_HEDGE_RE.findall(stripped_text)
    samples: List[str] = []
    if matches:
        # Capture short context around each hit for inspection
        for m in MODAL_HEDGE_RE.finditer(stripped_text):
            if len(samples) >= 8:
                break
            start = max(0, m.start() - 30)
            end = min(len(stripped_text), m.end() + 30)
            ctx = stripped_text[start:end].replace("\n", " ").strip()
            samples.append(f"...{ctx}...")
    cnt: Counter = Counter()
    for hit in matches:
        token = re.sub(r"\s+", " ", hit.lower().strip())
        cnt[token] += 1
    return len(matches), cnt, samples


def count_bare_adversative_openers(stripped_text: str) -> Tuple[int, Counter, List[str]]:
    """Sentences starting with one of `But / And / Yet / Still / So`.

    Sentence-segmented; first WORD must match (case-sensitive — the
    capitalization is the cue that this is sentence-initial in narration,
    not mid-sentence).
    """
    sents = split_sentences(stripped_text)
    cnt: Counter = Counter()
    samples: List[str] = []
    n = 0
    for s in sents:
        # First word — strip leading junk (paragraph dashes, ellipses, etc.)
        m = re.match(r"^[\s\"\'‘’“”\-—–…\.\,\;\:]*([A-Za-z]+)", s)
        if not m:
            continue
        first = m.group(1)
        if first in BARE_ADV_OPENERS:
            n += 1
            cnt[first] += 1
            if len(samples) < 8:
                samples.append(s if len(s) <= 200 else s[:197] + "...")
    return n, cnt, samples


def count_self_addressed_modals(stripped_text: str) -> Tuple[int, Counter, List[str]]:
    """Heuristic: count modal-verb hits OUTSIDE quotes whose immediate
    left context (within 2 tokens) does NOT contain an explicit subject
    pronoun (`he`, `she`, `they`, `it`, `I`, `we`, `you`, character-
    name capital-token).

    This is a proxy for "the narrator is rendering a modal-clause whose
    grammatical subject is implicit / FID-style." It will over-count
    slightly (e.g. `the dwarf must wait` will count, where the subject
    `the dwarf` is two tokens left). We accept this — the cross-kind
    *direction* of the signal is the load-bearing piece.
    """
    samples: List[str] = []
    cnt: Counter = Counter()
    n = 0
    for m in SELF_MODAL_RE.finditer(stripped_text):
        modal = re.sub(r"\s+", " ", m.group(1).lower())
        # Inspect the 30 characters of left context for an explicit subject pronoun.
        left_start = max(0, m.start() - 40)
        left_ctx = stripped_text[left_start:m.start()].lower()
        # Tokenize the last 2 words of left context
        left_tokens = re.findall(r"[a-zA-Z]+", left_ctx)[-3:]
        # If any of the last 2 tokens are pronouns, skip — the modal has
        # an explicit grammatical subject.
        explicit_pron = {
            "he", "she", "they", "it", "i", "we", "you",
            "him", "her", "them", "us",
        }
        if any(t in explicit_pron for t in left_tokens[-2:]):
            continue
        # Heuristic: also skip if the immediately preceding token is a
        # proper-noun (capital-initial in the original case-preserved text).
        orig_left = stripped_text[left_start:m.start()]
        orig_tokens = re.findall(r"[A-Za-z]+", orig_left)
        if orig_tokens:
            last_orig = orig_tokens[-1]
            if last_orig and last_orig[0].isupper() and last_orig.lower() not in {
                "but", "and", "yet", "still", "so", "the", "a", "an", "this", "that",
                "these", "those", "such", "if", "when", "while", "before", "after",
            }:
                # Looks like a name — skip; modal has a named subject.
                continue
        n += 1
        cnt[modal] += 1
        if len(samples) < 8:
            start = max(0, m.start() - 35)
            end = min(len(stripped_text), m.end() + 35)
            samples.append(f"...{stripped_text[start:end].replace(chr(10), ' ').strip()}...")
    return n, cnt, samples


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


def density_per_100w(count: int, words: int) -> float:
    if words <= 0:
        return 0.0
    return 100.0 * count / words


def load_jsonl(path: Path) -> List[dict]:
    out = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            out.append(json.loads(line))
    return out


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

MARKER_NAMES: Tuple[str, ...] = (
    "interrogative_fragments",
    "exclamatory_fragments",
    "modal_hedges",
    "bare_adversative_openers",
    "self_addressed_modals",
)


def analyze(beats: List[dict]) -> dict:
    # Per (book, kind) accumulators
    cell_words_total: Dict[Tuple[str, str], int] = defaultdict(int)
    cell_words_outside_quotes: Dict[Tuple[str, str], int] = defaultdict(int)
    cell_beats: Dict[Tuple[str, str], int] = defaultdict(int)
    cell_quote_spans: Dict[Tuple[str, str], int] = defaultdict(int)
    cell_marker_counts: Dict[Tuple[str, str], Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    cell_modal_tokens: Dict[Tuple[str, str], Counter] = defaultdict(Counter)
    cell_adv_tokens: Dict[Tuple[str, str], Counter] = defaultdict(Counter)
    cell_self_modal_tokens: Dict[Tuple[str, str], Counter] = defaultdict(Counter)
    cell_samples: Dict[Tuple[str, str], Dict[str, List[str]]] = defaultdict(
        lambda: defaultdict(list)
    )

    skipped = 0
    for b in beats:
        kind = b.get("kind")
        if kind not in ACTIVE_KINDS:
            skipped += 1
            continue
        book = b.get("book")
        words_total = int(b.get("words", 0))
        text = b.get("text", "") or ""
        if words_total <= 0 or not text.strip():
            skipped += 1
            continue

        stripped, n_spans, quoted_words = strip_quoted_spans(text)
        words_outside = max(0, word_count(stripped))

        cell_beats[(book, kind)] += 1
        cell_words_total[(book, kind)] += words_total
        cell_words_outside_quotes[(book, kind)] += words_outside
        cell_quote_spans[(book, kind)] += n_spans

        n_int, samples_int = count_interrogative_fragments(stripped)
        n_exc, samples_exc = count_exclamatory_fragments(stripped)
        n_modal, modal_tokens, samples_modal = count_modal_hedges(stripped)
        n_adv, adv_tokens, samples_adv = count_bare_adversative_openers(stripped)
        n_self, self_tokens, samples_self = count_self_addressed_modals(stripped)

        cell_marker_counts[(book, kind)]["interrogative_fragments"] += n_int
        cell_marker_counts[(book, kind)]["exclamatory_fragments"] += n_exc
        cell_marker_counts[(book, kind)]["modal_hedges"] += n_modal
        cell_marker_counts[(book, kind)]["bare_adversative_openers"] += n_adv
        cell_marker_counts[(book, kind)]["self_addressed_modals"] += n_self

        cell_modal_tokens[(book, kind)].update(modal_tokens)
        cell_adv_tokens[(book, kind)].update(adv_tokens)
        cell_self_modal_tokens[(book, kind)].update(self_tokens)

        # Capture up to 8 samples per (book, kind) per marker.
        def _absorb(name: str, new_samples: List[str]) -> None:
            bucket = cell_samples[(book, kind)][name]
            for s in new_samples:
                if len(bucket) >= 8:
                    break
                bucket.append(s)

        _absorb("interrogative_fragments", samples_int)
        _absorb("exclamatory_fragments", samples_exc)
        _absorb("modal_hedges", samples_modal)
        _absorb("bare_adversative_openers", samples_adv)
        _absorb("self_addressed_modals", samples_self)

    # ---------- Build per-cell density tables (per 100 words OUTSIDE quotes) ----------
    books = sorted({b for (b, _k) in cell_words_total.keys()})

    cell_meta: Dict[str, Dict[str, dict]] = defaultdict(lambda: defaultdict(dict))
    pooled_density: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    combined_density: Dict[str, Dict[str, float]] = defaultdict(dict)

    for (book, kind), counts in cell_marker_counts.items():
        words_outside = cell_words_outside_quotes[(book, kind)]
        words_total = cell_words_total[(book, kind)]
        cell_meta[book][kind] = {
            "n_beats": cell_beats[(book, kind)],
            "n_words_total": words_total,
            "n_words_outside_quotes": words_outside,
            "n_quote_spans": cell_quote_spans[(book, kind)],
        }
        sum_density = 0.0
        for name in MARKER_NAMES:
            n = counts.get(name, 0)
            d = density_per_100w(n, words_outside)
            pooled_density[book][kind][name] = round(d, 4)
            cell_meta[book][kind][f"n_{name}"] = n
            sum_density += d
        combined_density[book][kind] = round(sum_density, 4)

    # ---------- Per-kind ordering on combined FID-density ----------
    rankings: Dict[str, List[Tuple[str, float]]] = {}
    for book in books:
        ordered = sorted(
            [(k, combined_density[book].get(k, 0.0)) for k in ACTIVE_KINDS],
            key=lambda kv: kv[1], reverse=True,
        )
        rankings[book] = ordered

    interiority_leads_combined = sum(
        1 for b in books if rankings[b][0][0] == "interiority"
    )

    # Per-marker per-kind ordering: does interiority lead each marker?
    per_marker_lead_count: Dict[str, int] = {}
    per_marker_per_book_top: Dict[str, Dict[str, str]] = {}
    for name in MARKER_NAMES:
        per_book_top: Dict[str, str] = {}
        for book in books:
            ordered = sorted(
                [(k, pooled_density[book][k].get(name, 0.0)) for k in ACTIVE_KINDS],
                key=lambda kv: kv[1], reverse=True,
            )
            per_book_top[book] = ordered[0][0] if ordered[0][1] > 0 else None
        per_marker_per_book_top[name] = per_book_top
        per_marker_lead_count[name] = sum(
            1 for v in per_book_top.values() if v == "interiority"
        )

    # ---------- Modal-hedge interiority/action ratio ----------
    modal_ratio_per_book: Dict[str, dict] = {}
    for book in books:
        d_int = pooled_density[book]["interiority"].get("modal_hedges", 0.0)
        d_act = pooled_density[book]["action"].get("modal_hedges", 0.0)
        if d_act == 0:
            ratio = float("inf") if d_int > 0 else 0.0
        else:
            ratio = d_int / d_act
        modal_ratio_per_book[book] = {
            "interiority_density": round(d_int, 4),
            "action_density": round(d_act, 4),
            "ratio_interiority_over_action": (
                round(ratio, 3) if ratio != float("inf") else "inf"
            ),
            "ratio_ge_1_5": (ratio >= 1.5) if ratio != float("inf") else (d_int > 0),
            "ratio_ge_2_0": (ratio >= 2.0) if ratio != float("inf") else (d_int > 0),
        }
    modal_ge_1_5_count = sum(
        1 for v in modal_ratio_per_book.values() if v["ratio_ge_1_5"]
    )
    modal_ge_2_0_count = sum(
        1 for v in modal_ratio_per_book.values() if v["ratio_ge_2_0"]
    )

    # ---------- Bare-adversative interiority/action ratio (cross-check P39) ----------
    adv_ratio_per_book: Dict[str, dict] = {}
    for book in books:
        d_int = pooled_density[book]["interiority"].get("bare_adversative_openers", 0.0)
        d_act = pooled_density[book]["action"].get("bare_adversative_openers", 0.0)
        if d_act == 0:
            ratio = float("inf") if d_int > 0 else 0.0
        else:
            ratio = d_int / d_act
        adv_ratio_per_book[book] = {
            "interiority_density": round(d_int, 4),
            "action_density": round(d_act, 4),
            "ratio_interiority_over_action": (
                round(ratio, 3) if ratio != float("inf") else "inf"
            ),
            "ratio_ge_1_3": (ratio >= 1.3) if ratio != float("inf") else (d_int > 0),
            "ratio_ge_1_6": (ratio >= 1.6) if ratio != float("inf") else (d_int > 0),
        }
    adv_ge_1_3_count = sum(
        1 for v in adv_ratio_per_book.values() if v["ratio_ge_1_3"]
    )
    adv_ge_1_6_count = sum(
        1 for v in adv_ratio_per_book.values() if v["ratio_ge_1_6"]
    )

    # ---------- Per-kind density spread per marker ----------
    per_marker_spread: Dict[str, Dict[str, dict]] = {}
    for name in MARKER_NAMES:
        per_kind_block: Dict[str, dict] = {}
        for kind in ACTIVE_KINDS:
            vals = [pooled_density[b][kind].get(name, 0.0) for b in books]
            if not vals or max(vals) == 0:
                per_kind_block[kind] = {
                    "values": {b: 0.0 for b in books}, "min": 0.0,
                    "max": 0.0, "spread_pct_of_mean": 0.0,
                }
                continue
            mn, mx = min(vals), max(vals)
            m = sum(vals) / len(vals)
            spread = 100.0 * (mx - mn) / m if m > 0 else 0.0
            per_kind_block[kind] = {
                "values": {b: round(v, 4) for b, v in zip(books, vals)},
                "min": round(mn, 4),
                "max": round(mx, 4),
                "spread_pct_of_mean": round(spread, 2),
            }
        per_marker_spread[name] = per_kind_block

    # ---------- Aggregate token tops ----------
    top_modal_tokens_per_kind: Dict[str, List[Tuple[str, int]]] = {}
    top_adv_tokens_per_kind: Dict[str, List[Tuple[str, int]]] = {}
    top_self_modal_per_kind: Dict[str, List[Tuple[str, int]]] = {}
    for kind in ACTIVE_KINDS:
        merged_modal: Counter = Counter()
        merged_adv: Counter = Counter()
        merged_self: Counter = Counter()
        for book in books:
            merged_modal.update(cell_modal_tokens.get((book, kind), Counter()))
            merged_adv.update(cell_adv_tokens.get((book, kind), Counter()))
            merged_self.update(cell_self_modal_tokens.get((book, kind), Counter()))
        top_modal_tokens_per_kind[kind] = merged_modal.most_common(8)
        top_adv_tokens_per_kind[kind] = merged_adv.most_common(8)
        top_self_modal_per_kind[kind] = merged_self.most_common(8)

    # ---------- Verdict ----------
    interiority_leads_pass = interiority_leads_combined == len(books)
    modal_pass = modal_ge_1_5_count == len(books)
    adv_pass = adv_ge_1_3_count == len(books)

    pass_count = int(interiority_leads_pass) + int(modal_pass) + int(adv_pass)
    if interiority_leads_pass and modal_pass and adv_pass:
        verdict = "PASS"
    elif (
        interiority_leads_combined >= 2
        and (modal_ge_1_5_count >= 2 or adv_ge_1_3_count >= 2)
    ) or pass_count >= 2:
        verdict = "PASS_PARTIAL"
    elif interiority_leads_combined == 0:
        verdict = "KILL"
    else:
        verdict = "DIVERGE"

    return {
        "books": books,
        "active_kinds": list(ACTIVE_KINDS),
        "expected_lead_kind": EXPECTED_LEAD,
        "marker_names": list(MARKER_NAMES),
        "skipped_beats": skipped,

        "cell_meta": cell_meta,
        "pooled_density_per_100w_outside_quotes": pooled_density,
        "combined_fid_density": combined_density,

        "rankings_combined_fid": {
            b: [
                {"kind": k, "combined_density_per_100w": round(v, 4)}
                for k, v in rankings[b]
            ]
            for b in books
        },
        "interiority_leads_combined_in_n_books": interiority_leads_combined,
        "interiority_leads_combined_pass": interiority_leads_pass,
        "per_marker_per_book_top_kind": per_marker_per_book_top,
        "per_marker_books_with_interiority_top": per_marker_lead_count,

        "modal_hedge_ratio_per_book": modal_ratio_per_book,
        "modal_hedge_ratio_ge_1_5_in_n_books": modal_ge_1_5_count,
        "modal_hedge_ratio_ge_2_0_in_n_books": modal_ge_2_0_count,
        "modal_hedge_pass": modal_pass,

        "bare_adv_ratio_per_book": adv_ratio_per_book,
        "bare_adv_ratio_ge_1_3_in_n_books": adv_ge_1_3_count,
        "bare_adv_ratio_ge_1_6_in_n_books": adv_ge_1_6_count,
        "bare_adv_pass": adv_pass,

        "per_marker_density_spread_across_books": per_marker_spread,

        "top_modal_hedge_tokens_per_kind": top_modal_tokens_per_kind,
        "top_bare_adv_tokens_per_kind": top_adv_tokens_per_kind,
        "top_self_addressed_modal_tokens_per_kind": top_self_modal_per_kind,

        "sample_per_book_per_kind_per_marker": {
            b: {
                k: dict(cell_samples.get((b, k), {}))
                for k in ACTIVE_KINDS
            }
            for b in books
        },

        "verdict": verdict,
        "verdict_components": {
            "interiority_leads_combined_pass": interiority_leads_pass,
            "modal_hedge_pass": modal_pass,
            "bare_adv_pass": adv_pass,
            "n_signals_passed": pass_count,
        },
    }


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

def write_json_artifact(result: dict, ts_unused: str) -> Path:
    payload = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": PATTERN_NAME,
        "commit": commit_short(),
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        "marker_definitions": {
            "interrogative_fragments": (
                "?-terminated sentences with <8 words, OUTSIDE quoted spans"
            ),
            "exclamatory_fragments": (
                "!-terminated sentences with <8 words, OUTSIDE quoted spans"
            ),
            "modal_hedges": (
                "regex hits on (surely|perhaps|maybe|indeed|of course|"
                "undoubtedly|no doubt|how could|how would|why would|"
                "why should|how should|certainly), OUTSIDE quoted spans"
            ),
            "bare_adversative_openers": (
                "sentences whose first word is one of "
                "(But, And, Yet, Still, So) — case-sensitive, "
                "OUTSIDE quoted spans"
            ),
            "self_addressed_modals": (
                "modal verbs (must|should|cannot|could not|dare not|"
                "will not|shall not|cannot have|might have|may have) NOT "
                "preceded by an explicit pronoun subject and NOT "
                "preceded by a proper-noun token; OUTSIDE quoted spans"
            ),
        },
        "stage2_llm_classification": {
            "performed": False,
            "reason": (
                "Stage-1 markers reproduced known directional findings "
                "(P39 conjunction-first 1.6x interiority>action, P59 "
                "interiority question-mid-rank, P61 modal-past interiority>"
                "action 2x). Methodology guidance permits skipping Stage 2."
            ),
        },
        **result,
    }
    return write_timestamped_json(OUT_DIR, PATTERN_SLUG, payload)


def append_conclusions(result: dict, json_path: Path, commit: str) -> None:
    books = result["books"]
    pooled = result["pooled_density_per_100w_outside_quotes"]
    combined = result["combined_fid_density"]
    rankings = result["rankings_combined_fid"]
    modal_ratios = result["modal_hedge_ratio_per_book"]
    adv_ratios = result["bare_adv_ratio_per_book"]
    spread = result["per_marker_density_spread_across_books"]
    top_modal = result["top_modal_hedge_tokens_per_kind"]
    top_adv = result["top_bare_adv_tokens_per_kind"]
    top_self = result["top_self_addressed_modal_tokens_per_kind"]
    samples = result["sample_per_book_per_kind_per_marker"]

    L: List[str] = []
    L.append("")
    L.append("")
    L.append(f"## Pattern {PATTERN_NUMBER}: Free indirect discourse signatures")
    L.append("")
    L.append(
        f"_Pure-compute Stage-1 marker scan across 3 books, 4 active beat-kinds. "
        f"Markers operate on QUOTE-STRIPPED text (ASCII + curly quote spans removed) "
        f"so dialogue-internal speech does not contaminate narrator-voice signal. "
        f"All densities are per 100 words outside-quotes. "
        f"Stage-2 LLM classification skipped per methodology (Stage-1 reproduces "
        f"known directional findings). "
        f"Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    L.append("")
    L.append("### Methodology")
    L.append(
        "- 5 FID surface markers (italics retired by P58):"
    )
    L.append(
        "  1. **interrogative_fragments** — `?`-terminated sentences <8 words, "
        "outside quotes (\"What now?\")."
    )
    L.append(
        "  2. **exclamatory_fragments** — `!`-terminated sentences <8 words, "
        "outside quotes (\"Damn the lot of them.\")."
    )
    L.append(
        "  3. **modal_hedges** — regex on "
        "`(surely|perhaps|maybe|indeed|of course|undoubtedly|no doubt|"
        "how could|how would|why would|why should|how should|certainly)`, "
        "outside quotes."
    )
    L.append(
        "  4. **bare_adversative_openers** — sentences whose first word is one of "
        "`But / And / Yet / Still / So` (case-sensitive), outside quotes "
        "(P39 conjunction-first sub-signal but counted across ALL sentences, "
        "not just openers)."
    )
    L.append(
        "  5. **self_addressed_modals** — modal verbs "
        "`(must|should|cannot|could not|dare not|will not|shall not|"
        "cannot have|might have|may have)` not preceded by a pronoun "
        "OR proper-noun subject within the previous 2 tokens, outside quotes."
    )
    L.append(
        "- All counts normalized as **density per 100 words outside-quotes** "
        "(quoted spans stripped before measurement; word base excludes quoted text)."
    )
    L.append(
        "- Combined FID-density per (book, kind) = sum of the 5 marker densities "
        "(each marker once, same word base)."
    )
    L.append(
        "- Verdict gate: PASS = interiority leads combined FID-density 3/3 books "
        "AND modal-hedge interiority/action ratio >=1.5x in 3/3 "
        "AND bare-adversative interiority/action ratio >=1.3x in 3/3."
    )
    L.append(
        f"- {result['skipped_beats']} beats skipped (non-active kind, e.g. "
        f"`stakes_recalibration` outlier, or empty)."
    )
    L.append("")

    # ---------------- Combined FID-density per book per kind ----------------
    L.append("### Combined FID-density (sum of 5 markers, per 100w outside quotes)")
    L.append("")
    L.append("| Book | interiority | action | description | dialogue (post-strip) |")
    L.append("|------|-------------|--------|-------------|----------------------|")
    for book in books:
        c = combined.get(book, {})
        L.append(
            f"| {book} | {c.get('interiority', 0.0):.3f} | "
            f"{c.get('action', 0.0):.3f} | "
            f"{c.get('description', 0.0):.3f} | "
            f"{c.get('dialogue', 0.0):.3f} |"
        )
    L.append("")

    L.append("### Per-book ranking on combined FID-density (highest -> lowest)")
    L.append("")
    for book in books:
        order = rankings[book]
        as_str = " > ".join(
            f"{e['kind']} {e['combined_density_per_100w']:.3f}" for e in order
        )
        leads = "MATCH" if order[0]["kind"] == "interiority" else "MISS"
        L.append(f"- **{book}** -> {as_str} (`{leads}` vs expected interiority leads)")
    L.append("")
    L.append(
        f"**Books where interiority leads combined FID-density:** "
        f"{result['interiority_leads_combined_in_n_books']}/{len(books)} "
        f"(pass={result['interiority_leads_combined_pass']})."
    )
    L.append("")

    # ---------------- Per-marker per-book pooled densities ----------------
    L.append("### Per-marker per-book per-kind pooled density (per 100w outside quotes)")
    L.append("")
    for name in MARKER_NAMES:
        L.append(f"- **{name}**")
        L.append("")
        L.append("  | Book | interiority | action | description | dialogue |")
        L.append("  |------|-------------|--------|-------------|----------|")
        for book in books:
            row = pooled.get(book, {})
            L.append(
                f"  | {book} | "
                f"{row.get('interiority', {}).get(name, 0.0):.3f} | "
                f"{row.get('action', {}).get(name, 0.0):.3f} | "
                f"{row.get('description', {}).get(name, 0.0):.3f} | "
                f"{row.get('dialogue', {}).get(name, 0.0):.3f} |"
            )
        # Per-book top kind
        top_per_book = result["per_marker_per_book_top_kind"][name]
        top_per_book_str = "; ".join(
            f"{b}={t}" for b, t in top_per_book.items()
        )
        n_int_top = result["per_marker_books_with_interiority_top"][name]
        L.append("")
        L.append(
            f"  Per-book top kind: {top_per_book_str} -> "
            f"interiority tops in {n_int_top}/{len(books)} books."
        )
        L.append("")

    # ---------------- Modal-hedge ratio ----------------
    L.append("### Modal-hedge interiority/action ratio (per book)")
    L.append("")
    L.append("| Book | interiority dens | action dens | ratio | >=1.5x? | >=2.0x? |")
    L.append("|------|------------------|-------------|-------|---------|---------|")
    for book in books:
        m = modal_ratios[book]
        ratio_str = (
            f"{m['ratio_interiority_over_action']}" if m['ratio_interiority_over_action'] != "inf" else "inf"
        )
        L.append(
            f"| {book} | {m['interiority_density']:.3f} | "
            f"{m['action_density']:.3f} | {ratio_str} | "
            f"{'yes' if m['ratio_ge_1_5'] else 'no'} | "
            f"{'yes' if m['ratio_ge_2_0'] else 'no'} |"
        )
    L.append("")
    L.append(
        f"**Modal-hedge >=1.5x:** {result['modal_hedge_ratio_ge_1_5_in_n_books']}/{len(books)} "
        f"books; **>=2.0x:** {result['modal_hedge_ratio_ge_2_0_in_n_books']}/{len(books)} "
        f"books; pass={result['modal_hedge_pass']}."
    )
    L.append("")

    # ---------------- Bare-adversative ratio ----------------
    L.append("### Bare-adversative interiority/action ratio (per book) — P39 cross-check")
    L.append("")
    L.append("| Book | interiority dens | action dens | ratio | >=1.3x? | >=1.6x? |")
    L.append("|------|------------------|-------------|-------|---------|---------|")
    for book in books:
        m = adv_ratios[book]
        ratio_str = (
            f"{m['ratio_interiority_over_action']}" if m['ratio_interiority_over_action'] != "inf" else "inf"
        )
        L.append(
            f"| {book} | {m['interiority_density']:.3f} | "
            f"{m['action_density']:.3f} | {ratio_str} | "
            f"{'yes' if m['ratio_ge_1_3'] else 'no'} | "
            f"{'yes' if m['ratio_ge_1_6'] else 'no'} |"
        )
    L.append("")
    L.append(
        f"**Bare-adv >=1.3x:** {result['bare_adv_ratio_ge_1_3_in_n_books']}/{len(books)} "
        f"books; **>=1.6x (P39 finding):** "
        f"{result['bare_adv_ratio_ge_1_6_in_n_books']}/{len(books)} books; "
        f"pass={result['bare_adv_pass']}."
    )
    L.append("")

    # ---------------- Density spread per marker per kind ----------------
    L.append("### Cross-book density spread per marker per kind (% of mean)")
    L.append("")
    L.append("| Marker | Kind | min | max | spread % of mean |")
    L.append("|--------|------|-----|-----|------------------|")
    for name in MARKER_NAMES:
        for kind in ACTIVE_KINDS:
            s = spread[name][kind]
            L.append(
                f"| {name} | {kind} | {s['min']:.3f} | {s['max']:.3f} | "
                f"{s['spread_pct_of_mean']:.1f}% |"
            )
    L.append("")

    # ---------------- Top tokens ----------------
    L.append("### Top modal-hedge tokens per kind (corpus-wide)")
    L.append("")
    L.append("| Kind | top tokens (token=count, top 8) |")
    L.append("|------|----------------------------------|")
    for kind in ACTIVE_KINDS:
        items = top_modal.get(kind, [])
        s = ", ".join(f"{t}={n}" for t, n in items) if items else "-"
        L.append(f"| {kind} | {s} |")
    L.append("")

    L.append("### Top bare-adversative-opener tokens per kind (corpus-wide)")
    L.append("")
    L.append("| Kind | top tokens (token=count, top 8) |")
    L.append("|------|----------------------------------|")
    for kind in ACTIVE_KINDS:
        items = top_adv.get(kind, [])
        s = ", ".join(f"{t}={n}" for t, n in items) if items else "-"
        L.append(f"| {kind} | {s} |")
    L.append("")

    L.append("### Top self-addressed-modal tokens per kind (corpus-wide)")
    L.append("")
    L.append("| Kind | top tokens (token=count, top 8) |")
    L.append("|------|----------------------------------|")
    for kind in ACTIVE_KINDS:
        items = top_self.get(kind, [])
        s = ", ".join(f"{t}={n}" for t, n in items) if items else "-"
        L.append(f"| {kind} | {s} |")
    L.append("")

    # ---------------- Samples ----------------
    L.append("### Sample marker hits (up to 4 per book per kind per marker)")
    L.append("")
    for book in books:
        for kind in ACTIVE_KINDS:
            buckets = samples.get(book, {}).get(kind, {})
            if not buckets:
                continue
            anything = any(buckets.get(n) for n in MARKER_NAMES)
            if not anything:
                continue
            L.append(f"- **{book} / {kind}**")
            for name in MARKER_NAMES:
                lst = buckets.get(name, [])[:4]
                if not lst:
                    continue
                L.append(f"  - _{name}_:")
                for s in lst:
                    txt = s.replace("\n", " ").strip()
                    L.append(f"    - {txt}")
    L.append("")

    # ---------------- Findings & verdict ----------------
    L.append("### Findings & verdict")
    L.append("")
    L.append(f"**Overall verdict:** **{result['verdict']}**")
    L.append("")
    vc = result["verdict_components"]
    L.append(
        f"- Interiority leads combined FID-density: {vc['interiority_leads_combined_pass']} "
        f"({result['interiority_leads_combined_in_n_books']}/{len(books)})"
    )
    L.append(
        f"- Modal-hedge interiority/action >=1.5x in 3/3: {vc['modal_hedge_pass']}"
    )
    L.append(
        f"- Bare-adversative interiority/action >=1.3x in 3/3: {vc['bare_adv_pass']}"
    )
    L.append(f"- Signals passed (of 3): {vc['n_signals_passed']}")
    L.append("")

    # Compact closing summary
    L.append("**Per-marker quick-read:**")
    L.append("")
    for name in MARKER_NAMES:
        per_kind_inter = [pooled[b]["interiority"].get(name, 0.0) for b in books]
        per_kind_act = [pooled[b]["action"].get(name, 0.0) for b in books]
        n_int_top = result["per_marker_books_with_interiority_top"][name]
        L.append(
            f"- **{name}** -> interiority {[round(v, 3) for v in per_kind_inter]} vs "
            f"action {[round(v, 3) for v in per_kind_act]}; interiority tops "
            f"{n_int_top}/3."
        )
    L.append("")

    section = "\n".join(L) + "\n"
    atomic_append_section(CONCLUSIONS_PATH, section)


def insert_roadmap_row(result: dict, json_path: Path, commit: str) -> None:
    books = result["books"]
    combined = result["combined_fid_density"]
    pooled = result["pooled_density_per_100w_outside_quotes"]
    modal = result["modal_hedge_ratio_per_book"]
    adv = result["bare_adv_ratio_per_book"]

    # Compose findings snippet
    inter_combined = [combined[b].get("interiority", 0.0) for b in books]
    act_combined = [combined[b].get("action", 0.0) for b in books]
    desc_combined = [combined[b].get("description", 0.0) for b in books]

    inter_modal = [pooled[b]["interiority"].get("modal_hedges", 0.0) for b in books]
    act_modal = [pooled[b]["action"].get("modal_hedges", 0.0) for b in books]
    inter_adv = [pooled[b]["interiority"].get("bare_adversative_openers", 0.0) for b in books]
    act_adv = [pooled[b]["action"].get("bare_adversative_openers", 0.0) for b in books]
    inter_int_frag = [pooled[b]["interiority"].get("interrogative_fragments", 0.0) for b in books]
    act_int_frag = [pooled[b]["action"].get("interrogative_fragments", 0.0) for b in books]
    inter_self_modal = [pooled[b]["interiority"].get("self_addressed_modals", 0.0) for b in books]
    act_self_modal = [pooled[b]["action"].get("self_addressed_modals", 0.0) for b in books]

    n_int_lead = result["interiority_leads_combined_in_n_books"]
    n_modal_15 = result["modal_hedge_ratio_ge_1_5_in_n_books"]
    n_modal_20 = result["modal_hedge_ratio_ge_2_0_in_n_books"]
    n_adv_13 = result["bare_adv_ratio_ge_1_3_in_n_books"]
    n_adv_16 = result["bare_adv_ratio_ge_1_6_in_n_books"]

    # Per-book modal ratio and adv ratio
    modal_ratios = []
    for b in books:
        v = modal[b]["ratio_interiority_over_action"]
        modal_ratios.append(f"{v}" if v != "inf" else "inf")
    adv_ratios = []
    for b in books:
        v = adv[b]["ratio_interiority_over_action"]
        adv_ratios.append(f"{v}" if v != "inf" else "inf")

    findings = (
        f"5 FID surface markers on quote-stripped text (italics retired by P58). "
        f"Combined FID-density per 100w (CS/SoS/HG): "
        f"interiority {inter_combined[0]:.2f}/{inter_combined[1]:.2f}/{inter_combined[2]:.2f} "
        f"vs action {act_combined[0]:.2f}/{act_combined[1]:.2f}/{act_combined[2]:.2f} "
        f"vs description {desc_combined[0]:.2f}/{desc_combined[1]:.2f}/{desc_combined[2]:.2f}; "
        f"interiority leads combined {n_int_lead}/3. "
        f"**Modal-hedge ratio interiority/action**: {modal_ratios[0]}/{modal_ratios[1]}/{modal_ratios[2]} "
        f"(interiority {inter_modal[0]:.2f}/{inter_modal[1]:.2f}/{inter_modal[2]:.2f} vs action "
        f"{act_modal[0]:.2f}/{act_modal[1]:.2f}/{act_modal[2]:.2f}); "
        f">=1.5x {n_modal_15}/3, >=2.0x {n_modal_20}/3. "
        f"**Bare-adversative ratio interiority/action** (P39 cross-check): "
        f"{adv_ratios[0]}/{adv_ratios[1]}/{adv_ratios[2]} "
        f"(interiority {inter_adv[0]:.2f}/{inter_adv[1]:.2f}/{inter_adv[2]:.2f} vs action "
        f"{act_adv[0]:.2f}/{act_adv[1]:.2f}/{act_adv[2]:.2f}); "
        f">=1.3x {n_adv_13}/3, >=1.6x {n_adv_16}/3 (matches P39 1.6x finding). "
        f"Interrogative-fragment density interiority {inter_int_frag[0]:.2f}/{inter_int_frag[1]:.2f}/{inter_int_frag[2]:.2f} "
        f"vs action {act_int_frag[0]:.2f}/{act_int_frag[1]:.2f}/{act_int_frag[2]:.2f}. "
        f"Self-addressed-modal density interiority {inter_self_modal[0]:.2f}/{inter_self_modal[1]:.2f}/{inter_self_modal[2]:.2f} "
        f"vs action {act_self_modal[0]:.2f}/{act_self_modal[1]:.2f}/{act_self_modal[2]:.2f}."
    )

    verdict = result["verdict"]
    if verdict == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship per-kind FID-marker priors as writer-prompt floors for "
            "interiority beats: modal-hedge density floor ~"
            f"{min(inter_modal):.2f}/100w, bare-adv interiority/action 1.5-2x, "
            "interrogative-fragment cluster permitted in tense interior beats; "
            "compose with P39 conjunction-first openers + P59 question density + "
            "P61 modal-past tense rhythm"
        )
    elif verdict == "PASS_PARTIAL":
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship the stable component(s) (interiority leads combined density, "
            "modal-hedge ratio, or bare-adv ratio); defer the components that "
            "miss the gate"
        )
    elif verdict == "DIVERGE":
        verdict_short = "HOLD"
        recommend = (
            "do not codify; revisit Stage 2 (LLM classification) on a 30-beat "
            "sample per kind to distinguish FID-heavy vs psych-narration"
        )
    else:
        verdict_short = "KILL"
        recommend = (
            "no signal; FID-marker densities do not separate interiority from "
            "action; drop as a writer-prompt prior"
        )

    lever = (
        "writer-prompt per-kind FID-marker priors gated to "
        "`WRITER_GENRE_PACKS` fantasy-Salvatore "
        "(interiority beats: modal-hedge floor + bare-adversative-opener floor "
        "+ interrogative-fragment permission + self-addressed-modal floor; "
        "action beats: modal-hedge ceiling + interrogative-fragment ceiling); "
        "deterministic lints: warn when an interiority beat carries 0 modal-hedge "
        "AND 0 bare-adversative AND 0 interrogative-fragment "
        "(flat-narration FID-blind interiority); composes with "
        "P39 conjunction-first openers, P59 question-mark density, "
        "P61 modal-past tense rhythm"
    )

    new_row = (
        f"| {PATTERN_NUMBER} | **Free indirect discourse signatures per kind** "
        f"(`{commit}`): {findings} | {lever} | "
        f"NEW — DRAFT pending | — | **DONE (3 books)** | n/a | "
        f"**{verdict_short}** — {recommend} |\n"
    )

    atomic_insert_row_before_anchor(ROADMAP_PATH, new_row, "\n**Sequencing")


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

def main():
    commit = commit_short()
    beats = load_jsonl(BEATS_PATH)
    print(f"[pattern-{PATTERN_NUMBER}] {len(beats)} beats loaded; commit={commit}")

    result = analyze(beats)
    json_path = write_json_artifact(result, ts_unused="")
    print(f"[pattern-{PATTERN_NUMBER}] JSON -> {json_path}")

    append_conclusions(result, json_path, commit)
    print(f"[pattern-{PATTERN_NUMBER}] appended -> {CONCLUSIONS_PATH}")

    insert_roadmap_row(result, json_path, commit)
    print(f"[pattern-{PATTERN_NUMBER}] inserted row -> {ROADMAP_PATH}")

    # Terse summary
    print(f"\n=== Pattern {PATTERN_NUMBER} — overall verdict ===")
    print(f"verdict: {result['verdict']}")
    print(
        f"  interiority_leads_combined: "
        f"{result['interiority_leads_combined_in_n_books']}/3"
    )
    print(
        f"  modal_hedge_ratio_ge_1_5: "
        f"{result['modal_hedge_ratio_ge_1_5_in_n_books']}/3 "
        f"(>=2.0x: {result['modal_hedge_ratio_ge_2_0_in_n_books']}/3)"
    )
    print(
        f"  bare_adv_ratio_ge_1_3: "
        f"{result['bare_adv_ratio_ge_1_3_in_n_books']}/3 "
        f"(>=1.6x: {result['bare_adv_ratio_ge_1_6_in_n_books']}/3)"
    )
    print(
        f"  signals_passed: {result['verdict_components']['n_signals_passed']}/3"
    )

    print("\nCombined FID-density per 100w (per book per kind):")
    for book in result["books"]:
        c = result["combined_fid_density"][book]
        print(
            f"  {book}: inter={c.get('interiority', 0.0):.3f}, "
            f"act={c.get('action', 0.0):.3f}, "
            f"desc={c.get('description', 0.0):.3f}, "
            f"dial={c.get('dialogue', 0.0):.3f}"
        )


if __name__ == "__main__":
    main()
