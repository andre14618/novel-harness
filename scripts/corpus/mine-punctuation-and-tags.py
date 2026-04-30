#!/usr/bin/env python3
"""
Mine two corpus patterns from the Icewind Dale beats:
  - Pattern 42 — Punctuation density (em-dash, semicolon, parenthetical, ellipsis)
                 per book, per kind.
  - Pattern 48 — Dialogue-tag distribution (said-ratio, top alternative tags,
                 per-character tag distribution) per book.

Pure compute (no LLM). Writes two timestamped JSON files to
novels/salvatore-icewind-dale/structure-calibration/, append-only.

Run:
  python3 scripts/corpus/mine-punctuation-and-tags.py
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIR = ROOT / "novels" / "salvatore-icewind-dale"
BEATS_PATH = CORPUS_DIR / "beats.jsonl"
OUT_DIR = CORPUS_DIR / "structure-calibration"

# -----------------------------------------------------------------------------
# Tokenization helpers
# -----------------------------------------------------------------------------

WORD_RE = re.compile(r"\b[\w']+\b")


def word_count(text: str) -> int:
    return len(WORD_RE.findall(text))


# -----------------------------------------------------------------------------
# Pattern 42 — Punctuation density
# -----------------------------------------------------------------------------

# Em-dash: rendering varies across the three books because of EPUB/OCR
# conversion (sampled 2026-04-30):
#   - streams_of_silver: real U+2014 em-dash
#   - crystal_shard:     '---' (three or more ASCII hyphens) and '--' (double-
#                         hyphen). Crystal Shard is a hybrid render — most em-
#                         dashes survive as multi-hyphen runs; a handful end
#                         up rendered as ' - '.
#   - halflings_gem:     ' - ' (space-hyphen-space) — the OCR collapsed every
#                         em-dash to a spaced single hyphen.
# All three forms are counted as an em-dash. Hyphenated compounds ('Ten-Towns',
# 'Mithril Hall') are not affected because the regex requires word-space-
# hyphen-space-word OR hyphen-runs ≥2.
EM_DASH_RE = re.compile(r"—|-{2,}|(?<=\w)\s-\s(?=\w)")
SEMICOLON_RE = re.compile(r";")
# Parenthetical: count opening parens; we don't want to double-count the close.
PAREN_RE = re.compile(r"\(")
# Ellipsis: the unicode glyph or three+ consecutive ASCII dots (with optional
# spaces, as some EPUB OCR inserts spaces between dots: ". . .").
ELLIPSIS_RE = re.compile(r"…|\.{3,}|(?:\.\s){2,}\.")


def punct_counts(text: str) -> dict:
    return {
        "em_dash": len(EM_DASH_RE.findall(text)),
        "semicolon": len(SEMICOLON_RE.findall(text)),
        "parenthetical": len(PAREN_RE.findall(text)),
        "ellipsis": len(ELLIPSIS_RE.findall(text)),
    }


def per_100_words(count: int, words: int) -> float:
    if words == 0:
        return 0.0
    return round(count / words * 100, 3)


# -----------------------------------------------------------------------------
# Pattern 48 — Dialogue-tag distribution
# -----------------------------------------------------------------------------

DIALOGUE_VERBS = [
    "said", "asked", "replied", "answered", "muttered", "whispered",
    "shouted", "growled", "declared", "cried", "spat", "hissed",
    "grunted", "chuckled", "laughed", "sighed",
]
# Extended dialogue-tag inventory observed in the Icewind Dale corpus when
# scanning post-closing-quote words (frequency >= 30 across the trilogy).
# 'nodded'/'turned' look like action beats but were filtered to verbs that
# can grammatically take a quoted-object as in "X explained, '...'".
EXTENDED_TAG_VERBS = sorted(set(DIALOGUE_VERBS + [
    "explained", "continued", "remarked", "called", "told", "barked",
    "gasped", "rasped", "snapped", "screamed", "snarled", "smirked",
    "boasted", "warned", "ordered", "snickered", "scoffed", "begged",
    "added", "mused", "murmured", "stammered", "stuttered", "exclaimed",
    "blurted", "yelled",
]))
VERB_ALT = "|".join(DIALOGUE_VERBS)
EXTENDED_VERB_ALT = "|".join(EXTENDED_TAG_VERBS)

# Two attribution forms after a closing quote:
#   form A: VERB SUBJECT     — e.g. `"..." said Kessell`
#   form B: SUBJECT VERB     — e.g. `"..." Kessell said`, `"..." he asked`
# Inverted-comma forms (`,"` / `,"` ending the quote) are absorbed because we
# allow optional terminal punctuation inside the quote. Subject capture allows
# pronouns and 1-2 capitalized tokens (handles `Kessell`, `the wizard`,
# `Bruenor Battlehammer`, plus trailing modifier `the dwarf`).
TAG_RE = re.compile(
    r'"([^"]+?)"\s+'
    r'(?:'
    r'(?P<verbA>' + VERB_ALT + r')\s+(?P<subjA>(?:the\s+)?[A-Z][\w\'\-]+(?:\s+[A-Z][\w\'\-]+)?)'
    r'|'
    r'(?P<subjB>(?:he|she|they|[A-Z][\w\'\-]+)(?:\s+(?:the\s+)?[A-Z][\w\'\-]+)?)\s+(?P<verbB>' + VERB_ALT + r')'
    r')\b',
    re.IGNORECASE,
)

# A coarse "any capitalized name following a quote-tag verb" — used as a
# tag-without-character fallback to keep the totals honest.
TAG_FALLBACK_VERB_RE = re.compile(
    r'"[^"]+?"\s*[,.]?\s*(?:[A-Z][\w\'\-]+\s+)?(' + VERB_ALT + r')\b',
    re.IGNORECASE,
)

# Extended fallback — tracks the broader tag inventory so we can compute
# said-ratio against the actual full tag base (not just the 16 user-tracked
# verbs). The 16-verb said-ratio is reported for cross-corpus comparability;
# the extended said-ratio is the corpus-internal honest reading.
TAG_EXTENDED_VERB_RE = re.compile(
    r'"[^"]+?"\s*[,.]?\s*(?:[A-Z][\w\'\-]+\s+)?(' + EXTENDED_VERB_ALT + r')\b',
    re.IGNORECASE,
)

# Pronouns are bucketed under PRONOUN, not as a per-character row. Multi-word
# subjects collapse to "OTHER" if they don't look like proper names.
PRONOUNS = {"he", "she", "they", "i", "we", "you"}


def normalize_subject(raw: str | None) -> str:
    if not raw:
        return "UNKNOWN"
    raw = raw.strip()
    low = raw.lower()
    if low in PRONOUNS:
        return f"PRONOUN_{low}"
    # Strip leading "the " modifier on title-cased subjects ("the dwarf" stays
    # OTHER, but "the Dwarf" — title-cased — is treated as a title noun).
    parts = raw.split()
    head = parts[0]
    if head.lower() == "the":
        if len(parts) >= 2 and parts[1][0].isupper():
            return parts[1]  # "the Dwarf" → "Dwarf"
        return "OTHER"
    # Single capitalized word → that's the character ("Kessell").
    if len(parts) == 1 and head[0].isupper():
        return head
    # Two capitalized words → first name + last name; key on first name to
    # collapse `Bruenor Battlehammer` → `Bruenor`.
    if len(parts) >= 2 and head[0].isupper():
        return head
    return "OTHER"


def find_dialogue_tags(text: str) -> list[tuple[str, str]]:
    """Return list of (subject_normalized, verb_lower) pairs found via TAG_RE."""
    out: list[tuple[str, str]] = []
    for m in TAG_RE.finditer(text):
        verb = (m.group("verbA") or m.group("verbB") or "").lower()
        subj_raw = m.group("subjA") or m.group("subjB")
        subj = normalize_subject(subj_raw)
        if verb:
            out.append((subj, verb))
    return out


def fallback_verb_count(text: str) -> Counter:
    """Coarser fall-back that just counts any tracked verb adjacent to a closing
    quote — used to compute the said-ratio from the broadest possible base, so
    that named-attribution misses don't deflate it."""
    c: Counter = Counter()
    for m in TAG_FALLBACK_VERB_RE.finditer(text):
        c[m.group(1).lower()] += 1
    return c


def extended_verb_count(text: str) -> Counter:
    """Same shape as fallback_verb_count but over the EXTENDED tag inventory."""
    c: Counter = Counter()
    for m in TAG_EXTENDED_VERB_RE.finditer(text):
        c[m.group(1).lower()] += 1
    return c


# -----------------------------------------------------------------------------
# Main mining loop
# -----------------------------------------------------------------------------

def load_beats(path: Path) -> list[dict]:
    out: list[dict] = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            out.append(json.loads(line))
    return out


def mine() -> tuple[dict, dict]:
    beats = load_beats(BEATS_PATH)

    # Group by book.
    by_book: dict[str, list[dict]] = defaultdict(list)
    for b in beats:
        by_book[b.get("book", "unknown")].append(b)

    # ---------------- Pattern 42 — Punctuation ----------------
    p42_per_book: dict[str, dict] = {}
    p42_per_book_per_kind: dict[str, dict[str, dict]] = {}

    for book, blist in by_book.items():
        agg = Counter()
        words_total = 0
        per_kind: dict[str, dict] = defaultdict(lambda: {"words": 0, "em_dash": 0, "semicolon": 0, "parenthetical": 0, "ellipsis": 0})

        for b in blist:
            text = b.get("text", "")
            kind = b.get("kind", "unknown")
            words = word_count(text)
            counts = punct_counts(text)
            words_total += words
            for k, v in counts.items():
                agg[k] += v
            per_kind[kind]["words"] += words
            for k, v in counts.items():
                per_kind[kind][k] += v

        p42_per_book[book] = {
            "total_words": words_total,
            "counts": dict(agg),
            "per_100_words": {k: per_100_words(agg[k], words_total) for k in ("em_dash", "semicolon", "parenthetical", "ellipsis")},
        }
        # Densities per kind
        per_kind_out: dict[str, dict] = {}
        for kind, data in per_kind.items():
            w = data["words"]
            per_kind_out[kind] = {
                "words": w,
                "counts": {k: data[k] for k in ("em_dash", "semicolon", "parenthetical", "ellipsis")},
                "per_100_words": {k: per_100_words(data[k], w) for k in ("em_dash", "semicolon", "parenthetical", "ellipsis")},
            }
        p42_per_book_per_kind[book] = per_kind_out

    # Cross-book summary for P42
    book_order = list(p42_per_book.keys())
    cross_p42: dict[str, dict] = {}
    for kind_punct in ("em_dash", "semicolon", "parenthetical", "ellipsis"):
        vals = [p42_per_book[bk]["per_100_words"][kind_punct] for bk in book_order]
        cross_p42[kind_punct] = {
            "per_book": {bk: p42_per_book[bk]["per_100_words"][kind_punct] for bk in book_order},
            "mean": round(sum(vals) / len(vals), 3),
            "min": min(vals),
            "max": max(vals),
            "spread": round(max(vals) - min(vals), 3),
        }

    p42_payload = {
        "pattern": "42",
        "name": "Punctuation patterns (em-dash, semicolon, parenthetical, ellipsis)",
        "computedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "corpus": "salvatore-icewind-dale",
        "books": book_order,
        "rationale": (
            "Punctuation choice is part of an author's voice signature — em-dash density "
            "tracks interruption / aside rhythm, semicolons track compound-clause prose, "
            "parentheticals mark narrator-aside style, and ellipsis tracks trailed-off "
            "speech and hesitation. Per-kind splits (action vs dialogue vs interiority "
            "vs description) test whether Salvatore deploys these glyphs context-dependently."
        ),
        "methodology": {
            "em_dash_regex": (
                "U+2014 OR two-or-more ASCII hyphens ('--', '---') OR space-"
                "hyphen-space between word characters (' - ' as in 'A - B'). "
                "Three forms because EPUB/OCR rendered the em-dash differently "
                "across the three books: Streams of Silver kept U+2014, Crystal "
                "Shard rendered most as '---', and Halfling's Gem collapsed "
                "all em-dashes to ' - '."
            ),
            "semicolon_regex": "';'",
            "parenthetical_regex": "'(' (opening paren only — closing paren ignored to avoid double-count)",
            "ellipsis_regex": "U+2026 OR three-or-more consecutive ASCII dots OR space-separated dot-runs ('. . .')",
            "word_tokenizer": r"\\b[\\w']+\\b",
            "caveats": (
                "Em-dash via '--' captures both genuine em-dashes and ASCII hyphen-runs "
                "from older typesetting; the corpus is post-OCR EPUB so true em-dashes "
                "(U+2014) dominate. Parenthetical density is opening-paren count, which "
                "matches paired-paren count except for stray glyphs."
            ),
        },
        "per_book": p42_per_book,
        "per_book_per_kind": p42_per_book_per_kind,
        "cross_book_summary": cross_p42,
    }

    # ---------------- Pattern 48 — Dialogue tags ----------------
    p48_per_book: dict[str, dict] = {}

    for book, blist in by_book.items():
        verb_counter: Counter = Counter()
        verb_counter_fallback: Counter = Counter()
        verb_counter_extended: Counter = Counter()
        per_char: dict[str, Counter] = defaultdict(Counter)
        total_words = 0

        for b in blist:
            text = b.get("text", "")
            total_words += word_count(text)
            tags = find_dialogue_tags(text)
            for subj, verb in tags:
                verb_counter[verb] += 1
                per_char[subj][verb] += 1
            for verb, count in fallback_verb_count(text).items():
                verb_counter_fallback[verb] += count
            for verb, count in extended_verb_count(text).items():
                verb_counter_extended[verb] += count

        # Said-ratio is computed three ways for transparency:
        #   * named: against the 16-verb tracked list using subject-attribution
        #   * fallback: against the 16-verb list with the looser quote-adjacent regex
        #   * extended: against the broader observed-in-corpus tag inventory
        # Cross-corpus comparison should use `extended` (it's the most honest
        # reading); cross-author comparison vs Howard etc. should use the
        # `fallback` 16-verb basis for shape parity.
        total_named = sum(verb_counter.values())
        total_fallback = sum(verb_counter_fallback.values())
        total_extended = sum(verb_counter_extended.values())
        said_ratio_named = (
            round(verb_counter.get("said", 0) / total_named, 4) if total_named else None
        )
        said_ratio_fallback = (
            round(verb_counter_fallback.get("said", 0) / total_fallback, 4) if total_fallback else None
        )
        said_ratio_extended = (
            round(verb_counter_extended.get("said", 0) / total_extended, 4) if total_extended else None
        )

        # Top 10 alternative tags (excluding 'said'). From the broader fallback set.
        alt_tags = [(v, c) for v, c in verb_counter_fallback.items() if v != "said"]
        alt_tags.sort(key=lambda x: (-x[1], x[0]))
        top10_alt = [{"verb": v, "count": c} for v, c in alt_tags[:10]]

        # Per-character tag distribution — keep characters with >= 5 named tags.
        per_char_out: dict[str, dict] = {}
        for char, vc in per_char.items():
            tot = sum(vc.values())
            if tot < 5:
                continue
            top_verbs = vc.most_common()
            per_char_out[char] = {
                "total_tags": tot,
                "said_count": vc.get("said", 0),
                "said_ratio": round(vc.get("said", 0) / tot, 4) if tot else None,
                "verb_counts": dict(top_verbs),
                "top_alt_verb": next((v for v, _ in top_verbs if v != "said"), None),
            }

        # Sort per_char_out by total tags desc for stable top-N display.
        per_char_sorted = dict(sorted(
            per_char_out.items(), key=lambda kv: -kv[1]["total_tags"]
        ))

        # Top 10 alternative tags using the EXTENDED inventory too.
        ext_alt = [(v, c) for v, c in verb_counter_extended.items() if v != "said"]
        ext_alt.sort(key=lambda x: (-x[1], x[0]))
        top10_alt_extended = [{"verb": v, "count": c} for v, c in ext_alt[:10]]

        p48_per_book[book] = {
            "total_words": total_words,
            "total_tags_named": total_named,
            "total_tags_fallback": total_fallback,
            "total_tags_extended": total_extended,
            "said_ratio_named_attr": said_ratio_named,
            "said_ratio_fallback": said_ratio_fallback,
            "said_ratio_extended": said_ratio_extended,
            "verb_counts_named": dict(verb_counter),
            "verb_counts_fallback": dict(verb_counter_fallback),
            "verb_counts_extended": dict(verb_counter_extended),
            "top10_alternative_tags_user_list": top10_alt,
            "top10_alternative_tags_extended": top10_alt_extended,
            "per_character": per_char_sorted,
        }

    # Cross-book summary for P48
    cross_p48: dict[str, dict] = {}
    for ratio_key in ("said_ratio_fallback", "said_ratio_extended"):
        cross_p48[ratio_key] = {
            "per_book": {bk: p48_per_book[bk][ratio_key] for bk in book_order},
            "mean": round(
                sum(p48_per_book[bk][ratio_key] for bk in book_order) / len(book_order),
                4,
            ),
            "min": min(p48_per_book[bk][ratio_key] for bk in book_order),
            "max": max(p48_per_book[bk][ratio_key] for bk in book_order),
        }
    # Top-3 alternative tags shared across books — both user-list and extended
    user_book_top3 = {bk: {x["verb"] for x in p48_per_book[bk]["top10_alternative_tags_user_list"][:3]} for bk in book_order}
    ext_book_top3 = {bk: {x["verb"] for x in p48_per_book[bk]["top10_alternative_tags_extended"][:3]} for bk in book_order}
    if book_order:
        common_top3_user = set.intersection(*user_book_top3.values()) if len(book_order) > 1 else user_book_top3[book_order[0]]
        common_top3_ext = set.intersection(*ext_book_top3.values()) if len(book_order) > 1 else ext_book_top3[book_order[0]]
    else:
        common_top3_user = set()
        common_top3_ext = set()
    cross_p48["shared_top3_alt_tags_user_list"] = sorted(common_top3_user)
    cross_p48["shared_top3_alt_tags_extended"] = sorted(common_top3_ext)

    p48_payload = {
        "pattern": "48",
        "name": "Dialogue-tag distribution (said-ratio + alternative tag inventory + per-character tags)",
        "computedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "corpus": "salvatore-icewind-dale",
        "books": book_order,
        "rationale": (
            "Howard's craft principle (and modern style guides — King, Leonard, Strunk) "
            "argue for a high said-ratio: 'said' is invisible, alternative tags ("
            "'declared', 'spat', 'hissed') call attention to themselves and are usually "
            "doing work better done by the surrounding action or dialogue. Measuring "
            "Salvatore's actual said-ratio sets the imitator-target for the writer "
            "layer and the lint layer's 'replace creative tag with said+action' rule."
        ),
        "methodology": {
            "tracked_verbs_user_list": DIALOGUE_VERBS,
            "tracked_verbs_extended": EXTENDED_TAG_VERBS,
            "named_attribution_regex": (
                "Closing-quote followed by either VERB+SUBJECT (e.g. 'said Kessell') "
                "or SUBJECT+VERB (e.g. 'Kessell said' or 'he asked'); subject is a "
                "pronoun, a single capitalized token, or 'the X' / 'X Y' two-token "
                "compounds. Subject collapsed to first capitalized token "
                "(e.g. 'Bruenor Battlehammer' → 'Bruenor')."
            ),
            "fallback_regex": (
                "Closing-quote followed by ANY tracked verb (with optional "
                "intervening capitalized name). Used to compute said-ratio from "
                "the broadest base — named-attribution misses do not deflate it."
            ),
            "extended_regex": (
                "Same shape as fallback_regex but over the EXTENDED tag "
                "inventory. Reveals the corpus-internal said-ratio when scoped "
                "to all tag verbs Salvatore actually uses (not just the 16-verb "
                "list shared across cross-author comparisons)."
            ),
            "caveats": (
                "Pure pattern matching — no coreference resolution, no inverted-quote "
                "form ('Kessell — said the wizard') support, no detection of "
                "action-beat attribution ('Kessell smirked. \"Yes.\"'). Numbers are "
                "lower bounds on actual tag usage; said-ratio is robust because both "
                "'said' and the alternatives miss at similar rates. Per-character "
                "split is keyed on first-name tokenization which collapses "
                "'Drizzt Do'Urden' → 'Drizzt' and 'Bruenor Battlehammer' → 'Bruenor'."
            ),
        },
        "per_book": p48_per_book,
        "cross_book_summary": cross_p48,
    }

    return p42_payload, p48_payload


def main() -> int:
    p42, p48 = mine()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    p42_path = OUT_DIR / f"crystal_shard.{stamp}.punctuation-patterns.json"
    p48_path = OUT_DIR / f"crystal_shard.{stamp}.dialogue-tag-distribution.json"
    if p42_path.exists() or p48_path.exists():
        print(f"Refusing to overwrite: {p42_path} or {p48_path}", file=sys.stderr)
        return 1
    p42_path.write_text(json.dumps(p42, indent=2))
    p48_path.write_text(json.dumps(p48, indent=2))
    print(f"Wrote {p42_path}")
    print(f"Wrote {p48_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
