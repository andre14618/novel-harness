#!/usr/bin/env python3
"""
Pattern 57 — Pronoun density + negation density per beat-kind.

Hypothesis 1 (pronouns): Pronoun density signals POV closeness — high
he/she/I = close-third; low = distant narration. Per-kind ratio expected
to favor interiority and dialogue over description; action mid-rank.

Hypothesis 2 (negation): Negation density ("no/not/never/none/neither/
nothing/nobody/nowhere/nor/n't") may be a Salvatore voice signature —
setup-then-reversal interiority ("Drizzt could not let the matter drop").
Stable per-kind ratio across books?

Methodology: pure-compute regex lexicon density per beat, aggregated to
(book, kind, category). Cross-book directional verdict per signal +
per-kind ordering stability. Book-level pronoun-vs-negation correlation.

Outputs:
  - JSON: novels/salvatore-icewind-dale/structure-calibration/
          crystal_shard.<TS>.pronoun-negation-density.json
  - Atomic-append to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert into docs/harness-tuning-roadmap.md (fcntl flock)
"""

from __future__ import annotations

import datetime as _dt
import fcntl
import json
import math
import re
import subprocess
from collections import defaultdict
from pathlib import Path
from statistics import mean

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

PATTERN_NUMBER = 57
PATTERN_NAME = "Pronoun density + negation density"

# ---------------------------------------------------------------------------
# Lexicons (lowercase unless flagged; word-boundary matched)
# ---------------------------------------------------------------------------

# Pronoun categories. Lowercase, case-insensitive matching, except `i/I`
# which uses case-sensitive `\bI\b` to avoid matching the article-less word "i"
# inside narration noise. We treat first-person matching specially below.

PRONOUN_LEXICONS: dict[str, list[str]] = {
    "subject": ["he", "she", "it", "they", "we", "you"],  # `I` handled separately (case-sensitive)
    "object": ["him", "her", "them", "me", "us"],
    "possessive": [
        "his", "hers", "its", "their", "theirs",
        "my", "mine", "our", "ours", "your", "yours",
    ],
    "reflexive": [
        "himself", "herself", "itself", "themselves",
        "myself", "ourselves", "yourself", "yourselves",
    ],
}

# First-person `I` (subject) — case-sensitive single-letter match.
RE_I_SUBJECT = re.compile(r"\bI\b")

# Compile case-insensitive regex per pronoun category.
PRONOUN_REGEX: dict[str, re.Pattern] = {
    cat: re.compile(
        r"\b(?:" + "|".join(re.escape(t) for t in terms) + r")\b",
        flags=re.IGNORECASE,
    )
    for cat, terms in PRONOUN_LEXICONS.items()
}

PRONOUN_CATEGORIES = list(PRONOUN_LEXICONS.keys())  # ["subject","object","possessive","reflexive"]

# Negation lexicon. We split standalone tokens from the contraction suffix
# `n't`. The contraction handler counts every "...n't" occurrence (a single
# match per contracted negative) so "wouldn't / didn't / couldn't" each
# contribute 1.
NEGATION_TOKENS = [
    "no", "not", "never", "none", "neither",
    "nothing", "nobody", "nowhere", "nor",
]
RE_NEGATION_TOKENS = re.compile(
    r"\b(?:" + "|".join(re.escape(t) for t in NEGATION_TOKENS) + r")\b",
    flags=re.IGNORECASE,
)
# Contraction n't suffix — match `<letter+>n't` (case-insensitive) so that
# straight ASCII apostrophe variants count. Treat "n't" + curly apostrophe
# the same as straight via .replace below.
RE_NEGATION_NT = re.compile(r"[A-Za-z]+n['’]t\b")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ACTIVE_KINDS = ("action", "dialogue", "interiority", "description")


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


def count_pronoun_category(text: str, cat: str) -> int:
    n = len(PRONOUN_REGEX[cat].findall(text))
    if cat == "subject":
        # add case-sensitive `I` matches (subject lexicon excludes `i/I`)
        n += len(RE_I_SUBJECT.findall(text))
    return n


def count_negation(text: str) -> tuple[int, int]:
    """Return (token_count, contraction_count)."""
    tokens = len(RE_NEGATION_TOKENS.findall(text))
    contractions = len(RE_NEGATION_NT.findall(text))
    return tokens, contractions


# ---------------------------------------------------------------------------
# Statistics helpers
# ---------------------------------------------------------------------------


def pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 2 or len(ys) != n:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


def spread_pct(values: list[float]) -> float:
    """Max-min spread as % of max (returns 0..1)."""
    if not values:
        return 0.0
    mx = max(values)
    mn = min(values)
    if mx == 0:
        return 0.0
    return (mx - mn) / mx


# ---------------------------------------------------------------------------
# Load + analyze
# ---------------------------------------------------------------------------


def load_beats() -> list[dict]:
    beats: list[dict] = []
    with BEATS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            beats.append(json.loads(line))
    return beats


def analyze(beats: list[dict]) -> dict:
    # -- per-cell raw token totals + word totals (length-weighted/pooled view)
    cell_words: dict[tuple[str, str], int] = defaultdict(int)
    cell_count: dict[tuple[str, str], int] = defaultdict(int)
    pronoun_hits: dict[tuple[str, str, str], int] = defaultdict(int)  # (book,kind,cat)->n
    neg_token_hits: dict[tuple[str, str], int] = defaultdict(int)
    neg_nt_hits: dict[tuple[str, str], int] = defaultdict(int)

    # -- per-beat density samples for mean-of-densities aggregate
    pronoun_density_samples: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    pronoun_total_density_samples: dict[tuple[str, str], list[float]] = defaultdict(list)
    neg_density_samples: dict[tuple[str, str], list[float]] = defaultdict(list)

    # -- per-beat correlation samples (book-level): pronoun_total_dens vs neg_dens
    per_book_pronoun_density: dict[str, list[float]] = defaultdict(list)
    per_book_neg_density: dict[str, list[float]] = defaultdict(list)
    per_book_word_total: dict[str, int] = defaultdict(int)

    skipped = 0
    for b in beats:
        kind = b.get("kind")
        if kind not in ACTIVE_KINDS:
            skipped += 1
            continue
        book = b["book"]
        words = int(b.get("words", 0))
        text = b.get("text", "") or ""
        if words <= 0 or not text.strip():
            skipped += 1
            continue

        cell_words[(book, kind)] += words
        cell_count[(book, kind)] += 1
        per_book_word_total[book] += words

        # pronouns
        beat_pronoun_total = 0
        for cat in PRONOUN_CATEGORIES:
            n = count_pronoun_category(text, cat)
            pronoun_hits[(book, kind, cat)] += n
            d = density_per_100w(n, words)
            pronoun_density_samples[(book, kind, cat)].append(d)
            beat_pronoun_total += n
        beat_pronoun_density = density_per_100w(beat_pronoun_total, words)
        pronoun_total_density_samples[(book, kind)].append(beat_pronoun_density)
        per_book_pronoun_density[book].append(beat_pronoun_density)

        # negation
        nt, nc = count_negation(text)
        neg_total = nt + nc
        neg_token_hits[(book, kind)] += nt
        neg_nt_hits[(book, kind)] += nc
        beat_neg_density = density_per_100w(neg_total, words)
        neg_density_samples[(book, kind)].append(beat_neg_density)
        per_book_neg_density[book].append(beat_neg_density)

    books = sorted(set(b for (b, _k) in cell_words.keys()))

    # -- pooled densities (length-weighted: total hits / total words * 100)
    pooled_pronoun_per_cat: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    pooled_pronoun_total: dict[str, dict[str, float]] = defaultdict(dict)
    pooled_neg_total: dict[str, dict[str, float]] = defaultdict(dict)
    pooled_neg_token: dict[str, dict[str, float]] = defaultdict(dict)
    pooled_neg_nt: dict[str, dict[str, float]] = defaultdict(dict)

    # -- mean-of-densities aggregates (each beat weighted equally)
    mean_pronoun_per_cat: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    mean_pronoun_total: dict[str, dict[str, float]] = defaultdict(dict)
    mean_neg_total: dict[str, dict[str, float]] = defaultdict(dict)

    for (book, kind), words in cell_words.items():
        # pronouns per category
        total_pron_hits = 0
        for cat in PRONOUN_CATEGORIES:
            hits = pronoun_hits[(book, kind, cat)]
            total_pron_hits += hits
            pooled_pronoun_per_cat[book][kind][cat] = density_per_100w(hits, words)
            samples = pronoun_density_samples[(book, kind, cat)]
            mean_pronoun_per_cat[book][kind][cat] = float(mean(samples)) if samples else 0.0
        pooled_pronoun_total[book][kind] = density_per_100w(total_pron_hits, words)
        mean_total_samples = pronoun_total_density_samples[(book, kind)]
        mean_pronoun_total[book][kind] = (
            float(mean(mean_total_samples)) if mean_total_samples else 0.0
        )

        # negation
        nt = neg_token_hits[(book, kind)]
        nc = neg_nt_hits[(book, kind)]
        pooled_neg_token[book][kind] = density_per_100w(nt, words)
        pooled_neg_nt[book][kind] = density_per_100w(nc, words)
        pooled_neg_total[book][kind] = density_per_100w(nt + nc, words)
        neg_samples = neg_density_samples[(book, kind)]
        mean_neg_total[book][kind] = float(mean(neg_samples)) if neg_samples else 0.0

    # -- per-kind ordering across kinds (rank kinds by total density)
    pronoun_kind_ranking: dict[str, list[tuple[str, float]]] = {}
    neg_kind_ranking: dict[str, list[tuple[str, float]]] = {}
    for book in books:
        # pronouns: rank kinds 1..4 by mean pronoun-total density
        rows = [(k, mean_pronoun_total[book][k]) for k in ACTIVE_KINDS if k in mean_pronoun_total[book]]
        rows.sort(key=lambda kv: kv[1], reverse=True)
        pronoun_kind_ranking[book] = rows

        rows_n = [(k, mean_neg_total[book][k]) for k in ACTIVE_KINDS if k in mean_neg_total[book]]
        rows_n.sort(key=lambda kv: kv[1], reverse=True)
        neg_kind_ranking[book] = rows_n

    # -- top-2 ordering verdicts (per-signal kind-ranking stability across books)
    def order_verdict(per_book_rank: dict[str, list[tuple[str, float]]]) -> dict:
        if len(per_book_rank) < 3:
            return {"verdict": "INSUFFICIENT_BOOKS", "agree_top2": 0, "agree_top1": 0}
        top2 = {b: [k for k, _ in rows[:2]] for b, rows in per_book_rank.items()}
        top1 = {b: rows[0][0] for b, rows in per_book_rank.items()}
        ref_top2 = list(top2.values())[0]
        agree_top2 = sum(1 for v in top2.values() if v == ref_top2)
        ref_top1 = list(top1.values())[0]
        agree_top1 = sum(1 for v in top1.values() if v == ref_top1)
        if agree_top2 == 3:
            verdict = "PASS"
        elif agree_top2 == 2:
            verdict = "PASS_PARTIAL"
        elif agree_top1 == 3:
            verdict = "PASS_PARTIAL_TOP1"
        elif agree_top1 == 2:
            verdict = "DIVERGE"
        else:
            verdict = "KILL"
        return {
            "verdict": verdict,
            "per_book_top2": top2,
            "per_book_top1": top1,
            "agree_top2": agree_top2,
            "agree_top1": agree_top1,
        }

    pronoun_kind_verdict = order_verdict(pronoun_kind_ranking)
    neg_kind_verdict = order_verdict(neg_kind_ranking)

    # -- per-kind density stability across books (≤25% spread)
    def per_kind_stability(book_kind_density: dict[str, dict[str, float]]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for kind in ACTIVE_KINDS:
            vals = [book_kind_density[b][kind] for b in books if kind in book_kind_density.get(b, {})]
            sp = spread_pct(vals)
            stable = sp <= 0.25
            out[kind] = {
                "values": {b: round(book_kind_density[b][kind], 4) for b in books if kind in book_kind_density.get(b, {})},
                "spread_pct": round(sp, 4),
                "stable_le_25pct": stable,
            }
        return out

    pronoun_density_stability = per_kind_stability(mean_pronoun_total)
    neg_density_stability = per_kind_stability(mean_neg_total)

    # -- book-level totals across all 4 kinds (length-weighted)
    book_pronoun_total_density: dict[str, float] = {}
    book_neg_total_density: dict[str, float] = {}
    for book in books:
        total_words = per_book_word_total[book]
        total_pron_hits = sum(
            pronoun_hits[(book, kind, cat)]
            for kind in ACTIVE_KINDS
            for cat in PRONOUN_CATEGORIES
        )
        total_neg_hits = sum(
            neg_token_hits[(book, kind)] + neg_nt_hits[(book, kind)]
            for kind in ACTIVE_KINDS
        )
        book_pronoun_total_density[book] = density_per_100w(total_pron_hits, total_words)
        book_neg_total_density[book] = density_per_100w(total_neg_hits, total_words)

    # -- book-level pronoun↔negation correlation (3 points)
    pron_xs = [book_pronoun_total_density[b] for b in books]
    neg_ys = [book_neg_total_density[b] for b in books]
    book_level_pearson = pearson(pron_xs, neg_ys)

    # -- beat-level pronoun↔negation correlation per book (large n)
    beat_level_pearson: dict[str, float | None] = {}
    for book in books:
        xs = per_book_pronoun_density[book]
        ys = per_book_neg_density[book]
        beat_level_pearson[book] = pearson(xs, ys)

    # -- composite verdict
    pron_verdict = pronoun_kind_verdict["verdict"]
    pron_density_passes = sum(
        1 for v in pronoun_density_stability.values() if v["stable_le_25pct"]
    )
    neg_verdict = neg_kind_verdict["verdict"]
    neg_density_passes = sum(
        1 for v in neg_density_stability.values() if v["stable_le_25pct"]
    )

    # PASS criterion (per spec):
    #   - top-2 pronoun ordering reproduces 3/3 books AND
    #   - top-2 negation ordering reproduces 3/3 books AND
    #   - total densities stable (≤25% spread per-kind, all 4 kinds, both signals)
    pron_top2_ok = pron_verdict == "PASS"
    neg_top2_ok = neg_verdict == "PASS"
    density_ok = pron_density_passes == 4 and neg_density_passes == 4

    if pron_top2_ok and neg_top2_ok and density_ok:
        composite = "PASS"
    elif (pron_top2_ok or neg_top2_ok) and (pron_density_passes >= 3 or neg_density_passes >= 3):
        composite = "PASS_PARTIAL"
    elif pron_verdict in ("DIVERGE", "KILL") and neg_verdict in ("DIVERGE", "KILL"):
        composite = "KILL"
    elif pron_verdict in ("DIVERGE", "KILL") or neg_verdict in ("DIVERGE", "KILL"):
        composite = "DIVERGE"
    else:
        composite = "PASS_PARTIAL"

    return {
        "books": books,
        "active_kinds": list(ACTIVE_KINDS),
        "skipped_beats": skipped,
        "per_book_per_kind_count": {f"{b}/{k}": cell_count[(b, k)] for (b, k) in cell_count},
        "per_book_per_kind_words": {f"{b}/{k}": cell_words[(b, k)] for (b, k) in cell_words},
        "per_book_word_total": dict(per_book_word_total),

        # raw aggregate densities
        "mean_density_per_100w": {
            "pronoun_per_category": mean_pronoun_per_cat,
            "pronoun_total": mean_pronoun_total,
            "negation_total": mean_neg_total,
        },
        "pooled_density_per_100w": {
            "pronoun_per_category": pooled_pronoun_per_cat,
            "pronoun_total": pooled_pronoun_total,
            "negation_total": pooled_neg_total,
            "negation_token_only": pooled_neg_token,
            "negation_nt_only": pooled_neg_nt,
        },

        # rankings (kinds by total density)
        "pronoun_kind_ranking": {
            b: [{"kind": k, "mean_density_per_100w": round(v, 4)} for k, v in rows]
            for b, rows in pronoun_kind_ranking.items()
        },
        "negation_kind_ranking": {
            b: [{"kind": k, "mean_density_per_100w": round(v, 4)} for k, v in rows]
            for b, rows in neg_kind_ranking.items()
        },

        # ordering verdicts (do top-2 kinds reproduce across books?)
        "pronoun_kind_ordering_verdict": pronoun_kind_verdict,
        "negation_kind_ordering_verdict": neg_kind_verdict,

        # density stability per-kind (≤25% spread across books)
        "pronoun_per_kind_density_stability": pronoun_density_stability,
        "negation_per_kind_density_stability": neg_density_stability,

        # book-level totals + correlation
        "book_level_pronoun_total_density_per_100w": {
            b: round(v, 4) for b, v in book_pronoun_total_density.items()
        },
        "book_level_negation_total_density_per_100w": {
            b: round(v, 4) for b, v in book_neg_total_density.items()
        },
        "book_level_pearson_pronoun_vs_negation": (
            None if book_level_pearson is None else round(book_level_pearson, 4)
        ),
        "beat_level_pearson_pronoun_vs_negation": {
            b: (None if v is None else round(v, 4))
            for b, v in beat_level_pearson.items()
        },

        # composite verdict
        "composite_verdict": composite,
    }


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------


def write_json(result: dict, ts: str) -> Path:
    path = OUT_DIR / f"crystal_shard.{ts}.pronoun-negation-density.json"
    payload = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": PATTERN_NAME,
        "timestamp": ts,
        "commit": commit_short(),
        "lexicons": {
            "pronoun": PRONOUN_LEXICONS,
            "first_person_subject_case_sensitive": ["I"],
            "negation_tokens": NEGATION_TOKENS,
            "negation_contraction_suffix": ["n't (matches \"<stem>n't\")"],
        },
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        **result,
    }
    path.write_text(json.dumps(payload, indent=2, default=str))
    return path


def append_conclusions(result: dict, json_path: Path, commit: str) -> None:
    target = CONCLUSIONS_PATH

    books = result["books"]
    p_rank = result["pronoun_kind_ranking"]
    n_rank = result["negation_kind_ranking"]
    p_verdict = result["pronoun_kind_ordering_verdict"]
    n_verdict = result["negation_kind_ordering_verdict"]
    p_stab = result["pronoun_per_kind_density_stability"]
    n_stab = result["negation_per_kind_density_stability"]
    book_pron = result["book_level_pronoun_total_density_per_100w"]
    book_neg = result["book_level_negation_total_density_per_100w"]
    book_pearson = result["book_level_pearson_pronoun_vs_negation"]
    beat_pearson = result["beat_level_pearson_pronoun_vs_negation"]

    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_NUMBER}: {PATTERN_NAME}")
    lines.append("")
    lines.append(
        f"_Pure-compute lexicon density across 3 books, 4 active beat-kinds, 2 signals "
        f"(pronouns × 4 sub-categories + negation incl. n't contractions). "
        f"Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")

    lines.append("### Methodology")
    lines.append(
        "- Pronoun lexicon by category: subject (he/she/it/they/we/you + case-sensitive `\\bI\\b`), "
        "object (him/her/them/me/us), possessive (his/hers/its/their/theirs/my/mine/our/ours/your/yours), "
        "reflexive (himself/herself/itself/themselves/myself/ourselves/yourself/yourselves)."
    )
    lines.append(
        "- Negation lexicon: standalone tokens (no/not/never/none/neither/nothing/nobody/nowhere/nor) "
        "+ contraction suffix `<stem>n't` (matches both straight and curly apostrophes)."
    )
    lines.append(
        "- Per beat: count category matches; normalize by beat words → density per 100w. "
        "Aggregate per `(book, kind)` as the mean of per-beat densities (each beat weighted equally)."
    )
    lines.append(
        "- Cross-book ordering verdict: PASS if top-2 ranking matches in 3/3 books, "
        "PASS_PARTIAL if 2/3, PASS_PARTIAL_TOP1 if only top-1 stable, DIVERGE if even top-1 wobbles, KILL if not."
    )
    lines.append(
        "- Per-kind density stability: ≤25% spread (max-min over max) across 3 books = stable."
    )
    lines.append(
        f"- `stakes_recalibration` outlier excluded; {result['skipped_beats']} beat(s) skipped."
    )
    lines.append("")

    # -- Pronoun section
    lines.append("### Hypothesis 1 — Pronoun density per kind")
    lines.append("")
    lines.append("**Per-book pronoun-total density per 100w (mean of per-beat densities):**")
    lines.append("")
    lines.append("| Book | action | dialogue | interiority | description |")
    lines.append("|------|--------|----------|-------------|-------------|")
    mean_pron_total = result["mean_density_per_100w"]["pronoun_total"]
    for book in books:
        row = [book]
        for kind in ACTIVE_KINDS:
            v = mean_pron_total.get(book, {}).get(kind, 0.0)
            row.append(f"{v:.3f}")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")

    lines.append("**Per-book per-kind kind-ranking (high → low pronoun total density):**")
    lines.append("")
    for book in books:
        rows = p_rank[book]
        order = " > ".join(
            f"{r['kind']} ({r['mean_density_per_100w']:.3f})" for r in rows
        )
        lines.append(f"- **{book}** → {order}")
    lines.append("")

    lines.append("**Per-kind density stability across books (≤25% spread = stable):**")
    lines.append("")
    lines.append("| Kind | values | spread% | stable? |")
    lines.append("|------|--------|---------|---------|")
    for kind in ACTIVE_KINDS:
        s = p_stab[kind]
        vals_str = ", ".join(f"{b}={v}" for b, v in s["values"].items())
        lines.append(f"| {kind} | {vals_str} | {s['spread_pct']*100:.1f}% | {s['stable_le_25pct']} |")
    lines.append("")

    lines.append(
        f"**Pronoun kind-ordering verdict:** {p_verdict['verdict']} "
        f"(top-2 agreement {p_verdict['agree_top2']}/3, top-1 agreement {p_verdict['agree_top1']}/3)"
    )
    lines.append("")

    # Per-category pronoun breakdown (mean_density)
    lines.append("**Per-book per-kind pronoun breakdown by sub-category (mean density per 100w):**")
    lines.append("")
    lines.append("| Book / Kind | subject | object | possessive | reflexive |")
    lines.append("|------|---------|--------|------------|-----------|")
    mean_pron_cat = result["mean_density_per_100w"]["pronoun_per_category"]
    for book in books:
        for kind in ACTIVE_KINDS:
            cells = mean_pron_cat.get(book, {}).get(kind, {})
            sub = cells.get("subject", 0.0)
            obj = cells.get("object", 0.0)
            pos = cells.get("possessive", 0.0)
            ref = cells.get("reflexive", 0.0)
            lines.append(
                f"| {book} / {kind} | {sub:.3f} | {obj:.3f} | {pos:.3f} | {ref:.3f} |"
            )
    lines.append("")

    # -- Negation section
    lines.append("### Hypothesis 2 — Negation density per kind")
    lines.append("")
    lines.append("**Per-book negation-total density per 100w (mean of per-beat densities):**")
    lines.append("")
    lines.append("| Book | action | dialogue | interiority | description |")
    lines.append("|------|--------|----------|-------------|-------------|")
    mean_neg_total = result["mean_density_per_100w"]["negation_total"]
    for book in books:
        row = [book]
        for kind in ACTIVE_KINDS:
            v = mean_neg_total.get(book, {}).get(kind, 0.0)
            row.append(f"{v:.3f}")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")

    lines.append("**Per-book per-kind kind-ranking (high → low negation density):**")
    lines.append("")
    for book in books:
        rows = n_rank[book]
        order = " > ".join(
            f"{r['kind']} ({r['mean_density_per_100w']:.3f})" for r in rows
        )
        lines.append(f"- **{book}** → {order}")
    lines.append("")

    lines.append("**Per-kind density stability across books (≤25% spread = stable):**")
    lines.append("")
    lines.append("| Kind | values | spread% | stable? |")
    lines.append("|------|--------|---------|---------|")
    for kind in ACTIVE_KINDS:
        s = n_stab[kind]
        vals_str = ", ".join(f"{b}={v}" for b, v in s["values"].items())
        lines.append(f"| {kind} | {vals_str} | {s['spread_pct']*100:.1f}% | {s['stable_le_25pct']} |")
    lines.append("")

    lines.append(
        f"**Negation kind-ordering verdict:** {n_verdict['verdict']} "
        f"(top-2 agreement {n_verdict['agree_top2']}/3, top-1 agreement {n_verdict['agree_top1']}/3)"
    )
    lines.append("")

    # Standalone-vs-contraction split
    lines.append("**Negation token-vs-contraction split (pooled length-weighted density per 100w):**")
    lines.append("")
    pooled_neg_token = result["pooled_density_per_100w"]["negation_token_only"]
    pooled_neg_nt = result["pooled_density_per_100w"]["negation_nt_only"]
    lines.append("| Book / Kind | standalone tokens | n't contractions |")
    lines.append("|------|-------------------|------------------|")
    for book in books:
        for kind in ACTIVE_KINDS:
            tk = pooled_neg_token.get(book, {}).get(kind, 0.0)
            nt = pooled_neg_nt.get(book, {}).get(kind, 0.0)
            lines.append(f"| {book} / {kind} | {tk:.3f} | {nt:.3f} |")
    lines.append("")

    # -- Correlation analysis
    lines.append("### Cross-signal correlation (pronoun-richness vs negation-richness)")
    lines.append("")
    lines.append("**Book-level (n=3 points):**")
    lines.append("")
    lines.append("| Book | pronoun-total dens | negation-total dens |")
    lines.append("|------|--------------------|---------------------|")
    for book in books:
        lines.append(f"| {book} | {book_pron[book]:.3f} | {book_neg[book]:.3f} |")
    lines.append("")
    if book_pearson is None:
        lines.append("Book-level Pearson r: undefined (zero variance or n<2).")
    else:
        lines.append(f"**Book-level Pearson r = {book_pearson:.4f}** (n=3; high-magnitude values are weak evidence at this n).")
    lines.append("")

    lines.append("**Beat-level (per book, large n):**")
    lines.append("")
    lines.append("| Book | beat n | Pearson r |")
    lines.append("|------|--------|-----------|")
    for book in books:
        # per_book_per_kind_count keys are "book/kind" strings
        total_n = sum(
            v for k, v in result["per_book_per_kind_count"].items()
            if k.startswith(book + "/")
        )
        r = beat_pearson.get(book)
        r_str = f"{r:.4f}" if r is not None else "—"
        lines.append(f"| {book} | {total_n} | {r_str} |")
    lines.append("")

    # -- Composite verdict
    lines.append(f"### Composite verdict: {result['composite_verdict']}")
    lines.append("")
    lines.append("**Gate components:**")
    lines.append(
        f"- Pronoun top-2 kind ordering: {p_verdict['verdict']} (3/3 required for PASS)"
    )
    lines.append(
        f"- Negation top-2 kind ordering: {n_verdict['verdict']} (3/3 required for PASS)"
    )
    pron_passes = sum(1 for v in p_stab.values() if v["stable_le_25pct"])
    neg_passes = sum(1 for v in n_stab.values() if v["stable_le_25pct"])
    lines.append(
        f"- Pronoun per-kind density stability: {pron_passes}/4 kinds ≤25% spread (4/4 required for PASS)"
    )
    lines.append(
        f"- Negation per-kind density stability: {neg_passes}/4 kinds ≤25% spread (4/4 required for PASS)"
    )
    lines.append("")

    # -- Findings
    lines.append("### Findings")
    lines.append("")
    findings: list[str] = []

    # Pronoun finding
    pron_top1_consistent = p_verdict["per_book_top1"]
    if len(set(pron_top1_consistent.values())) == 1:
        consistent_kind = list(pron_top1_consistent.values())[0]
        findings.append(
            f"- **Pronoun-density ranking — top-1 kind is `{consistent_kind}` in all 3 books.** "
            f"(Hypothesis predicted interiority highest; observed top-1: {pron_top1_consistent}.)"
        )
    else:
        findings.append(
            f"- **Pronoun-density top-1 kind drifts across books:** {pron_top1_consistent}. "
            "(Hypothesis predicted interiority highest universally.)"
        )

    # Description as floor check
    desc_pron_dens = {b: mean_pron_total.get(b, {}).get("description", 0.0) for b in books}
    is_desc_floor = all(
        desc_pron_dens[b] == min(mean_pron_total.get(b, {}).get(k, 0.0) for k in ACTIVE_KINDS)
        for b in books
    )
    if is_desc_floor:
        findings.append(
            f"- **Description is the pronoun floor in 3/3 books** (densities: {desc_pron_dens}). "
            "Confirms hypothesis: description is environment-anchored, not POV-anchored."
        )
    else:
        findings.append(
            f"- **Description is NOT the pronoun floor in all books** (densities: {desc_pron_dens}). "
            "Floor varies — environment-anchoring weaker than hypothesized."
        )

    # Negation finding
    neg_top1_consistent = n_verdict["per_book_top1"]
    if len(set(neg_top1_consistent.values())) == 1:
        consistent_kind = list(neg_top1_consistent.values())[0]
        findings.append(
            f"- **Negation-density top-1 kind is `{consistent_kind}` in all 3 books** (per-book top-1: {neg_top1_consistent}). "
            "Stable per-kind ordering signals voice."
        )
    else:
        findings.append(
            f"- **Negation-density top-1 kind drifts across books:** {neg_top1_consistent}. "
            "Per-kind ordering unstable; the 'setup-then-reversal' hypothesis is not voice-load-bearing at the kind level."
        )

    # Per-kind densities stable enough?
    pron_unstable_kinds = [k for k in ACTIVE_KINDS if not p_stab[k]["stable_le_25pct"]]
    neg_unstable_kinds = [k for k in ACTIVE_KINDS if not n_stab[k]["stable_le_25pct"]]
    if not pron_unstable_kinds:
        findings.append("- **All 4 pronoun per-kind densities stable ≤25% spread across 3 books.**")
    else:
        findings.append(
            f"- **Pronoun density unstable on:** {pron_unstable_kinds} (>25% spread)."
        )
    if not neg_unstable_kinds:
        findings.append("- **All 4 negation per-kind densities stable ≤25% spread across 3 books.**")
    else:
        findings.append(
            f"- **Negation density unstable on:** {neg_unstable_kinds} (>25% spread)."
        )

    # Correlation finding
    if book_pearson is not None:
        if abs(book_pearson) >= 0.7:
            sign = "positive" if book_pearson > 0 else "negative"
            findings.append(
                f"- **Book-level pronoun↔negation Pearson r = {book_pearson:.3f}** "
                f"({sign}, but n=3; suggestive at best — multi-book corroboration would be required to ship as a 'close-third' joint signal)."
            )
        else:
            findings.append(
                f"- **Book-level pronoun↔negation Pearson r = {book_pearson:.3f}** — "
                "no joint book-level relationship between pronoun-richness and negation-richness."
            )
    beat_r_avg = mean([v for v in beat_pearson.values() if v is not None]) if any(beat_pearson.values()) else None
    if beat_r_avg is not None:
        findings.append(
            f"- **Beat-level pronoun↔negation Pearson r averages {beat_r_avg:.3f}** across 3 books "
            f"(per-book: {beat_pearson}) — the joint signal at beat granularity."
        )

    lines.extend(findings)
    lines.append("")

    # -- Harness levers
    lines.append("### Proposed harness levers")
    lines.append("")
    levers: list[str] = []

    # Pronoun lever
    if p_verdict["verdict"] in ("PASS", "PASS_PARTIAL", "PASS_PARTIAL_TOP1"):
        # use book[0] ranking as the prior
        ref_rank = [r["kind"] for r in p_rank[books[0]]]
        levers.append(
            f"1. **Writer-prompt POV-closeness prior:** beat-kind pronoun-density target ordering "
            f"`{ref_rank[0]} > {ref_rank[1]} > {ref_rank[2]} > {ref_rank[3]}`. "
            "Description-kind beats default to environment-anchored (low pronoun density); "
            "interiority-kind beats default to POV-anchored (high pronoun density) as a close-third indicator."
        )
        # density target
        # use median per-kind target across books
        levers.append(
            "2. **Per-kind pronoun-density targets (writer prompt or lint warning):** "
            + "; ".join(
                f"{kind} ~{mean([mean_pron_total[b][kind] for b in books if kind in mean_pron_total.get(b, {})]):.2f}/100w"
                for kind in ACTIVE_KINDS
            )
            + "."
        )
    else:
        levers.append(
            "1. **Pronoun-density priors NOT shippable** as a per-kind ordering — top-2 unstable. "
            "Could revisit with a finer lexicon (e.g. excluding `it/its` ambiguity, splitting 1st/2nd/3rd person)."
        )

    # Negation lever
    if n_verdict["verdict"] in ("PASS", "PASS_PARTIAL", "PASS_PARTIAL_TOP1"):
        ref_rank_n = [r["kind"] for r in n_rank[books[0]]]
        levers.append(
            f"3. **Writer-prompt negation prior:** beat-kind negation-density target ordering "
            f"`{ref_rank_n[0]} > {ref_rank_n[1]} > {ref_rank_n[2]} > {ref_rank_n[3]}`. "
            "If interiority/dialogue tops the ranking, the 'setup-then-reversal' rhetoric is a Salvatore voice tell — "
            "writer fewshot should include `could not / would not / never / nothing` framing in interiority beats."
        )
    else:
        levers.append(
            "3. **Negation-density priors NOT shippable** as a per-kind ordering — top-2 unstable. "
            "The 'setup-then-reversal' framing may be a per-character Drizzt-only tell rather than a voice-wide signature; "
            "would need per-character measurement to confirm."
        )

    # Joint signal
    if book_pearson is not None and abs(book_pearson) >= 0.7:
        sign = "positive" if book_pearson > 0 else "negative"
        levers.append(
            f"4. **Joint pronoun↔negation correlation** ({sign}, r={book_pearson:.2f} at book level) — "
            "candidate close-third combined indicator. Defer until cross-corpus validation (n=3 too small to ship)."
        )
    else:
        levers.append(
            "4. **No joint pronoun↔negation indicator** — book-level correlation is weak; treat the two signals as independent."
        )

    lines.extend(levers)
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

    p_verdict = result["pronoun_kind_ordering_verdict"]
    n_verdict = result["negation_kind_ordering_verdict"]
    p_stab = result["pronoun_per_kind_density_stability"]
    n_stab = result["negation_per_kind_density_stability"]
    composite = result["composite_verdict"]
    p_rank = result["pronoun_kind_ranking"]
    n_rank = result["negation_kind_ranking"]
    books = result["books"]
    book_pearson = result["book_level_pearson_pronoun_vs_negation"]
    beat_pearson = result["beat_level_pearson_pronoun_vs_negation"]

    # Build a compact findings cell
    pron_top1 = p_verdict["per_book_top1"]
    neg_top1 = n_verdict["per_book_top1"]
    ref_book = books[0]
    ref_pron_rank = " > ".join(r["kind"] for r in p_rank[ref_book])
    ref_neg_rank = " > ".join(r["kind"] for r in n_rank[ref_book])
    pron_passes = sum(1 for v in p_stab.values() if v["stable_le_25pct"])
    neg_passes = sum(1 for v in n_stab.values() if v["stable_le_25pct"])
    book_r_str = f"{book_pearson:.2f}" if book_pearson is not None else "—"
    beat_r_avg = mean([v for v in beat_pearson.values() if v is not None]) if any(beat_pearson.values()) else None
    beat_r_str = f"{beat_r_avg:.2f}" if beat_r_avg is not None else "—"

    findings = (
        f"pronoun kind ranking ref={ref_pron_rank} (top-2 verdict {p_verdict['verdict']}, "
        f"per-kind density stable {pron_passes}/4); "
        f"negation kind ranking ref={ref_neg_rank} (top-2 verdict {n_verdict['verdict']}, "
        f"per-kind density stable {neg_passes}/4); "
        f"book-level pronoun↔negation r={book_r_str}; mean beat-level r={beat_r_str}; "
        f"per-book pronoun-top1 {pron_top1}, negation-top1 {neg_top1}"
    )

    # Lever cell
    if composite == "PASS":
        lever = (
            "Ship per-kind pronoun + negation ordering priors as writer-prompt POV-closeness signals; "
            "treat as compound close-third indicator"
        )
        verdict_short = "PASS"
        recommend = "ship both per-kind orderings + density targets"
    elif composite == "PASS_PARTIAL":
        lever = (
            "Ship the stable signal as a writer-prompt prior (top-1 kind only); "
            "defer the unstable signal pending finer-grained analysis"
        )
        verdict_short = "PASS_PARTIAL"
        recommend = "ship stable signal as soft writer-prompt prior; defer unstable side"
    elif composite == "DIVERGE":
        lever = (
            "Do not ship as universal priors; the unstable signal may be a per-character tell — "
            "rerun at per-character granularity before drawing harness conclusions"
        )
        verdict_short = "HOLD"
        recommend = "rerun at per-character granularity; defer planner/writer prior"
    else:
        lever = "No signal — drop as a writer-prompt prior"
        verdict_short = "KILL"
        recommend = "no signal across both pronouns and negation"

    new_row = (
        f"| {PATTERN_NUMBER} | **Pronoun + negation density per beat-kind** (`{commit}`): {findings}. | "
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


def main() -> None:
    ts = _dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    commit = commit_short()
    beats = load_beats()
    print(f"[pattern-{PATTERN_NUMBER}] {len(beats)} beats loaded; commit={commit}; ts={ts}")

    result = analyze(beats)
    json_path = write_json(result, ts)
    print(f"[pattern-{PATTERN_NUMBER}] JSON → {json_path}")

    append_conclusions(result, json_path, commit)
    print(f"[pattern-{PATTERN_NUMBER}] appended → {CONCLUSIONS_PATH}")

    insert_roadmap_row(result, json_path, commit)
    print(f"[pattern-{PATTERN_NUMBER}] inserted row → {ROADMAP_PATH}")

    print(f"\n=== Pattern {PATTERN_NUMBER} — composite verdict: {result['composite_verdict']} ===")
    print(f"  pronoun-kind-ordering verdict: {result['pronoun_kind_ordering_verdict']['verdict']}  "
          f"(top-2 agree {result['pronoun_kind_ordering_verdict']['agree_top2']}/3)")
    print(f"  negation-kind-ordering verdict: {result['negation_kind_ordering_verdict']['verdict']}  "
          f"(top-2 agree {result['negation_kind_ordering_verdict']['agree_top2']}/3)")
    print(f"  pronoun per-kind density stable: "
          f"{sum(1 for v in result['pronoun_per_kind_density_stability'].values() if v['stable_le_25pct'])}/4")
    print(f"  negation per-kind density stable: "
          f"{sum(1 for v in result['negation_per_kind_density_stability'].values() if v['stable_le_25pct'])}/4")
    print(f"  book-level pronoun↔negation Pearson r = {result['book_level_pearson_pronoun_vs_negation']}")
    print(f"  per-book beat-level Pearson r = {result['beat_level_pearson_pronoun_vs_negation']}")


if __name__ == "__main__":
    main()
