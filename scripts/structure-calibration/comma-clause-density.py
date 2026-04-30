#!/usr/bin/env python3
"""
Pattern 60 — Comma density + clause-count per sentence.

Hypothesis: comma density and clause count per sentence are sentence-rhythm
signatures complementary to P29 (sentence + paragraph length). Salvatore's
rhythm should show:
  - Action sentences  → short, fewer commas, fewer clauses (kinetic rhythm)
  - Description       → long, more commas, multi-clause (layered)
  - Dialogue          → mixed (depends on speaker)
  - Interiority       → layered like description, with mid-sentence
                        conjunction rhythm complement to P39

Per-kind comma-density signature is a writer-prompt rhythm prior; mean
clauses-per-sentence is also a target.

Methodology (pure compute):
  1. Sentence segment per beat.
  2. Per sentence: comma_count, clause_count proxy, words.
  3. Per (book, kind, sentence) cell: distributions (mean comma density per
     100w, mean clauses per sentence, median sentence words, p25/p75,
     comma-per-sentence histogram).
  4. Per-kind ordering: rank kinds by comma density and clauses-per-sentence.
  5. Mid-sentence conjunction signature (interiority complement to P39).
  6. Sentence-rhythm variability per beat (stddev of comma density per beat).

Cross-book gate:
  - PASS  : per-kind comma-density top-2 ordering reproduces 3/3 books AND
            clauses-per-sentence top-2 ordering reproduces 3/3 books AND
            mean values stable (≤25% spread)
  - PASS_PARTIAL : 2/3 reproduce or one signal stable
  - DIVERGE : unstable
  - KILL    : no signal

Outputs:
  - JSON: novels/salvatore-icewind-dale/structure-calibration/
          crystal_shard.<TS>.comma-clause-density.json
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
PATTERN_NUMBER = 60

# Coordinating conjunctions (case-insensitive, word-boundary, mid-sentence
# only — leading conjunctions are P39's surface). Used to compute a
# secondary clause-count proxy and the interiority "and yet…" signature.
COORDINATING_CONJUNCTIONS = ("and", "but", "or", "yet", "so", "nor", "for")
COORD_CONJ_RE = re.compile(
    r"\b(?:" + "|".join(COORDINATING_CONJUNCTIONS) + r")\b",
    flags=re.IGNORECASE,
)

# Sentence segmenter — same approach as P29 / P39 with quote/curly-quote
# tolerance: terminator (.!?) followed by whitespace, lookahead for an
# uppercase letter or opening quote (any flavor). Drops empty fragments and
# sentences with <3 words (filters list-marker artifacts and stray
# sub-sentence chunks).
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"‘’“”'])")

MIN_SENTENCE_WORDS = 3

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


def split_sentences(text: str) -> list[str]:
    if not text:
        return []
    parts = SENTENCE_SPLIT_RE.split(text)
    out: list[str] = []
    for s in parts:
        s = s.strip()
        if not s:
            continue
        # crude word count
        if len(s.split()) < MIN_SENTENCE_WORDS:
            continue
        out.append(s)
    return out


def count_words(sentence: str) -> int:
    return len(sentence.split())


def count_commas(sentence: str) -> int:
    return sentence.count(",")


def count_punct_break_clauses(sentence: str) -> int:
    """Punctuation-break clause proxy: commas + semicolons + colons + 1.

    Matches the spec: clause_count = max(1, commas + ';'s + ':'s + 1).
    Uses raw counts on the full sentence (dialogue commas inside quotes are
    counted; this is a proxy, not a parser).
    """
    n = sentence.count(",") + sentence.count(";") + sentence.count(":") + 1
    return max(1, n)


def count_mid_conjunctions(sentence: str) -> int:
    """Mid-sentence coordinating conjunctions (excludes a sentence-leading
    conjunction so we don't double-count the P39 surface).
    """
    matches = list(COORD_CONJ_RE.finditer(sentence))
    if not matches:
        return 0
    # If the first match is at position 0 (or only preceded by quote/paren/
    # whitespace), treat it as sentence-leading and exclude.
    first = matches[0]
    leading_excluded = 0
    pre = sentence[: first.start()]
    if not pre.strip(' \t"\'“”‘’(['):
        leading_excluded = 1
    return max(0, len(matches) - leading_excluded)


def comma_histogram_bucket(commas: int) -> str:
    if commas == 0:
        return "0"
    if commas == 1:
        return "1"
    if commas == 2:
        return "2"
    return "3+"


def pct(part: int, whole: int) -> float:
    return 100.0 * part / whole if whole > 0 else 0.0


def safe_round(x: float, digits: int = 3) -> float:
    if x is None or math.isnan(x) or math.isinf(x):
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


def spread(values: list[float]) -> float:
    """Relative spread = (max - min) / max(|mean|, eps). Used to flag
    instability (the gate is ≤25%)."""
    if not values:
        return 0.0
    m = statistics.mean(values)
    if m == 0:
        return 0.0
    return (max(values) - min(values)) / abs(m)


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
    # Per-sentence records keyed by (book, kind).
    sent_records: dict[tuple[str, str], list[dict]] = defaultdict(list)

    # Per-beat records keyed by (book, kind) — each entry is the per-beat
    # mean comma density + the within-beat stddev of comma density across
    # sentences (rhythm-variability metric).
    beat_records: dict[tuple[str, str], list[dict]] = defaultdict(list)

    # Beat-level word totals (kept for quick density audits).
    cell_beats: dict[tuple[str, str], int] = defaultdict(int)
    cell_words: dict[tuple[str, str], int] = defaultdict(int)
    skipped_beats = 0
    too_short_sentences = 0

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

        sents = split_sentences(text)
        # Track sentence-fragments dropped by the <3-word filter for telemetry.
        # We approximate by re-splitting without the filter and counting the
        # difference (cheap, just for transparency).
        raw_parts = [s for s in SENTENCE_SPLIT_RE.split(text) if s.strip()]
        too_short_sentences += max(0, len(raw_parts) - len(sents))

        if not sents:
            skipped_beats += 1
            continue

        cell_beats[(book, kind)] += 1
        cell_words[(book, kind)] += words

        per_beat_comma_density = []
        for s in sents:
            sw = count_words(s)
            if sw <= 0:
                continue
            commas = count_commas(s)
            clauses_punct = count_punct_break_clauses(s)
            mid_conj = count_mid_conjunctions(s)
            # Conjunction-augmented clause proxy: (commas+semis+colons) +
            # mid-sentence conjunctions + 1
            clauses_conj = max(
                1,
                s.count(",") + s.count(";") + s.count(":") + mid_conj + 1,
            )
            comma_density_100w = 100.0 * commas / sw
            sent_records[(book, kind)].append({
                "words": sw,
                "commas": commas,
                "clauses_punct": clauses_punct,
                "clauses_conj": clauses_conj,
                "mid_conjunctions": mid_conj,
                "comma_density_100w": comma_density_100w,
            })
            per_beat_comma_density.append(comma_density_100w)

        if per_beat_comma_density:
            beat_mean = statistics.mean(per_beat_comma_density)
            beat_std = (
                statistics.pstdev(per_beat_comma_density)
                if len(per_beat_comma_density) > 1 else 0.0
            )
            beat_records[(book, kind)].append({
                "n_sentences": len(per_beat_comma_density),
                "mean_comma_density_100w": beat_mean,
                "stdev_comma_density_100w": beat_std,
            })

    # ------------------------------------------------------------------
    # Per-cell aggregates
    # ------------------------------------------------------------------
    per_cell: dict[str, dict[str, dict]] = defaultdict(dict)
    for (book, kind), recs in sent_records.items():
        if not recs:
            continue
        commas_per_sentence = [r["commas"] for r in recs]
        comma_density = [r["comma_density_100w"] for r in recs]
        clauses_punct = [r["clauses_punct"] for r in recs]
        clauses_conj = [r["clauses_conj"] for r in recs]
        words = [r["words"] for r in recs]
        mid_conj = [r["mid_conjunctions"] for r in recs]

        # Comma-per-sentence histogram (0 / 1 / 2 / 3+).
        hist: dict[str, int] = {"0": 0, "1": 0, "2": 0, "3+": 0}
        for c in commas_per_sentence:
            hist[comma_histogram_bucket(c)] += 1
        n = len(commas_per_sentence)
        hist_pct = {k: safe_round(pct(v, n), 2) for k, v in hist.items()}

        # Mean mid-sentence conjunctions per 100w (interiority complement).
        total_words = sum(words)
        total_mid_conj = sum(mid_conj)
        mid_conj_per_100w = (
            100.0 * total_mid_conj / total_words if total_words > 0 else 0.0
        )

        # Within-beat stddev of comma density — averaged across beats.
        beats_in_cell = beat_records[(book, kind)]
        within_beat_stdevs = [r["stdev_comma_density_100w"] for r in beats_in_cell]
        within_beat_mean_stdev = (
            statistics.mean(within_beat_stdevs) if within_beat_stdevs else 0.0
        )

        per_cell[book][kind] = {
            "n_sentences": n,
            "n_beats": cell_beats[(book, kind)],
            "n_words": cell_words[(book, kind)],
            "comma_density_per_100w": stats_block(comma_density, digits=3),
            "commas_per_sentence": stats_block(
                [float(x) for x in commas_per_sentence], digits=3
            ),
            "clauses_per_sentence_punct": stats_block(
                [float(x) for x in clauses_punct], digits=3
            ),
            "clauses_per_sentence_conj": stats_block(
                [float(x) for x in clauses_conj], digits=3
            ),
            "sentence_words": stats_block([float(x) for x in words], digits=2),
            "comma_histogram": {"counts": hist, "pct": hist_pct},
            "mid_sentence_conjunctions_per_100w": safe_round(mid_conj_per_100w, 3),
            "within_beat_comma_density_stdev_mean": safe_round(within_beat_mean_stdev, 3),
        }

    # ------------------------------------------------------------------
    # Per-kind orderings (rank books separately, then check stability)
    # ------------------------------------------------------------------
    # For each book → ordering of kinds by metric (comma density mean,
    # clauses-per-sentence-punct mean).
    rankings_by_metric: dict[str, dict[str, list[tuple[str, float]]]] = defaultdict(dict)
    for metric in ("comma_density_mean", "clauses_punct_mean"):
        for book in BOOK_ORDER:
            kinds_present = [k for k in ACTIVE_KINDS if k in per_cell.get(book, {})]
            if metric == "comma_density_mean":
                vals = {
                    k: per_cell[book][k]["comma_density_per_100w"]["mean"]
                    for k in kinds_present
                }
            else:
                vals = {
                    k: per_cell[book][k]["clauses_per_sentence_punct"]["mean"]
                    for k in kinds_present
                }
            ordering = sorted(vals.items(), key=lambda kv: kv[1], reverse=True)
            rankings_by_metric[metric][book] = ordering

    def per_metric_verdict(metric: str) -> dict:
        per_book_top2: dict[str, list[str]] = {}
        per_book_top1: dict[str, str] = {}
        for book in BOOK_ORDER:
            ord_ = rankings_by_metric[metric].get(book, [])
            if len(ord_) < 2:
                continue
            per_book_top2[book] = [k for k, _ in ord_[:2]]
            per_book_top1[book] = ord_[0][0]

        if len(per_book_top2) < 3:
            return {
                "per_book_top2": per_book_top2,
                "books_with_matching_top2": 0,
                "verdict": "INSUFFICIENT_BOOKS",
            }

        vals = list(per_book_top2.values())
        ref = vals[0]
        agree_top2 = sum(1 for v in vals if v == ref)
        agree_top1 = len(set(per_book_top1.values()))  # 1 == all agree
        if agree_top2 == 3:
            verdict = "PASS"
        elif agree_top2 == 2:
            verdict = "PASS_PARTIAL"
        elif agree_top1 == 1:
            verdict = "PASS_PARTIAL_TOP1"
        elif len(set(per_book_top1.values())) == 2:
            verdict = "DIVERGE"
        else:
            verdict = "KILL"
        return {
            "per_book_top2": per_book_top2,
            "per_book_top1": per_book_top1,
            "books_with_matching_top2": agree_top2,
            "verdict": verdict,
        }

    metric_verdicts = {
        "comma_density": per_metric_verdict("comma_density_mean"),
        "clauses_per_sentence_punct": per_metric_verdict("clauses_punct_mean"),
    }

    # Mean-value stability: per kind, per metric, compute spread across books.
    mean_stability: dict[str, dict[str, dict]] = defaultdict(dict)
    for kind in ACTIVE_KINDS:
        comma_means = []
        clause_means = []
        for book in BOOK_ORDER:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            comma_means.append(cell["comma_density_per_100w"]["mean"])
            clause_means.append(cell["clauses_per_sentence_punct"]["mean"])
        mean_stability["comma_density_per_100w"][kind] = {
            "values_by_book": {
                b: per_cell[b][kind]["comma_density_per_100w"]["mean"]
                for b in BOOK_ORDER if kind in per_cell.get(b, {})
            },
            "spread_over_mean": safe_round(spread(comma_means), 3),
            "stable_le_25pct": spread(comma_means) <= 0.25,
        }
        mean_stability["clauses_per_sentence_punct"][kind] = {
            "values_by_book": {
                b: per_cell[b][kind]["clauses_per_sentence_punct"]["mean"]
                for b in BOOK_ORDER if kind in per_cell.get(b, {})
            },
            "spread_over_mean": safe_round(spread(clause_means), 3),
            "stable_le_25pct": spread(clause_means) <= 0.25,
        }

    # ------------------------------------------------------------------
    # Mid-sentence conjunction signature (interiority hypothesis)
    # ------------------------------------------------------------------
    mid_conj_per_kind = {}
    for kind in ACTIVE_KINDS:
        per_book = {}
        for book in BOOK_ORDER:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            per_book[book] = cell["mid_sentence_conjunctions_per_100w"]
        if per_book:
            vals = list(per_book.values())
            mid_conj_per_kind[kind] = {
                "per_book": per_book,
                "mean_across_books": safe_round(statistics.mean(vals), 3),
                "spread_over_mean": safe_round(spread(vals), 3),
            }

    # Order kinds by mean across books for the interiority complement.
    mid_conj_ranking_per_book = {}
    for book in BOOK_ORDER:
        present = [
            (k, per_cell[book][k]["mid_sentence_conjunctions_per_100w"])
            for k in ACTIVE_KINDS if k in per_cell.get(book, {})
        ]
        present.sort(key=lambda kv: kv[1], reverse=True)
        mid_conj_ranking_per_book[book] = present
    # Top-1 stability.
    mid_conj_top1 = {
        book: (ranking[0][0] if ranking else None)
        for book, ranking in mid_conj_ranking_per_book.items()
    }
    mid_conj_top1_stable = len({v for v in mid_conj_top1.values() if v is not None}) == 1

    # ------------------------------------------------------------------
    # Sentence-rhythm variability per kind (within-beat comma-density stdev)
    # ------------------------------------------------------------------
    rhythm_variability: dict[str, dict] = {}
    for kind in ACTIVE_KINDS:
        per_book = {}
        for book in BOOK_ORDER:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            per_book[book] = cell["within_beat_comma_density_stdev_mean"]
        if per_book:
            vals = list(per_book.values())
            rhythm_variability[kind] = {
                "per_book_mean_within_beat_stdev": per_book,
                "mean_across_books": safe_round(statistics.mean(vals), 3),
                "spread_over_mean": safe_round(spread(vals), 3),
            }

    # Order kinds by mean within-beat comma-density stdev (variability).
    variability_ranking_per_book = {}
    for book in BOOK_ORDER:
        present = [
            (k, per_cell[book][k]["within_beat_comma_density_stdev_mean"])
            for k in ACTIVE_KINDS if k in per_cell.get(book, {})
        ]
        present.sort(key=lambda kv: kv[1], reverse=True)
        variability_ranking_per_book[book] = present
    variability_top1 = {
        book: (ranking[0][0] if ranking else None)
        for book, ranking in variability_ranking_per_book.items()
    }
    variability_top1_stable = (
        len({v for v in variability_top1.values() if v is not None}) == 1
    )

    # ------------------------------------------------------------------
    # Overall verdict: combine metric verdicts + mean stability gates.
    # ------------------------------------------------------------------
    severity = {
        "PASS": 0, "PASS_PARTIAL": 1, "PASS_PARTIAL_TOP1": 2,
        "DIVERGE": 3, "KILL": 4, "INSUFFICIENT_BOOKS": 5,
    }

    metric_levels = {m: severity[v["verdict"]] for m, v in metric_verdicts.items()}
    # comma + clauses ordering both PASS, AND all 4 kinds × both metrics
    # stable_le_25pct → PASS.
    both_pass_top2 = all(
        metric_verdicts[m]["verdict"] == "PASS" for m in metric_verdicts
    )
    means_all_stable = all(
        mean_stability[metric][kind]["stable_le_25pct"]
        for metric in ("comma_density_per_100w", "clauses_per_sentence_punct")
        for kind in ACTIVE_KINDS
        if kind in per_cell.get(BOOK_ORDER[0], {})
    )

    one_metric_partial_or_better = any(
        metric_levels[m] <= severity["PASS_PARTIAL"] for m in metric_levels
    )

    if both_pass_top2 and means_all_stable:
        overall = "PASS"
    elif one_metric_partial_or_better:
        overall = "PASS_PARTIAL"
    else:
        worst = max(metric_verdicts.values(), key=lambda v: severity[v["verdict"]])
        overall = worst["verdict"]

    return {
        "books": list(BOOK_ORDER),
        "active_kinds": list(ACTIVE_KINDS),
        "skipped_beats_or_outliers": skipped_beats,
        "sentences_filtered_under_3_words": too_short_sentences,
        "per_book_per_kind": per_cell,
        "rankings_by_metric": {
            metric: {
                book: [{"kind": k, "value": safe_round(v, 4)} for k, v in ord_]
                for book, ord_ in books_ord.items()
            }
            for metric, books_ord in rankings_by_metric.items()
        },
        "metric_verdicts": metric_verdicts,
        "mean_stability": mean_stability,
        "mid_sentence_conjunctions": {
            "per_kind": mid_conj_per_kind,
            "per_book_ranking": {
                book: [{"kind": k, "value": safe_round(v, 3)} for k, v in ord_]
                for book, ord_ in mid_conj_ranking_per_book.items()
            },
            "per_book_top1": mid_conj_top1,
            "top1_stable": mid_conj_top1_stable,
        },
        "rhythm_variability": {
            "per_kind": rhythm_variability,
            "per_book_ranking": {
                book: [{"kind": k, "value": safe_round(v, 3)} for k, v in ord_]
                for book, ord_ in variability_ranking_per_book.items()
            },
            "per_book_top1": variability_top1,
            "top1_stable": variability_top1_stable,
        },
        "overall_verdict": overall,
    }


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------


def write_json(result: dict, ts: str, commit: str) -> Path:
    path = OUT_DIR / f"crystal_shard.{ts}.comma-clause-density.json"
    payload = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": "Comma density + clause-count per sentence",
        "timestamp": ts,
        "commit": commit,
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        "sentence_segmenter": "regex (?<=[.!?])\\s+(?=[A-Z\"openquote]) — sentences with <3 words dropped",
        "clause_count_methodology": (
            "punct_break_proxy = max(1, commas + ';' + ':' + 1); "
            "conj_augmented_proxy adds mid-sentence coordinating conjunctions"
        ),
        "coordinating_conjunctions": list(COORDINATING_CONJUNCTIONS),
        **result,
    }
    path.write_text(json.dumps(payload, indent=2, default=str))
    return path


def append_conclusions(result: dict, json_path: Path, commit: str) -> None:
    target = CONCLUSIONS_PATH

    per_cell = result["per_book_per_kind"]
    metric_verdicts = result["metric_verdicts"]
    mean_stability = result["mean_stability"]
    rankings = result["rankings_by_metric"]

    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_NUMBER}: Comma + clause-count per sentence")
    lines.append("")
    lines.append(
        f"_Pure-compute sentence-rhythm signature complementary to P29 (sentence + paragraph length) "
        f"and P39 (sentence-opener distribution). 3 books × 4 active beat-kinds; sentence-segmented "
        f"per beat with <3-word sentences dropped. Commit `{commit}`. JSON: "
        f"`{json_path.relative_to(REPO)}`._"
    )
    lines.append("")
    lines.append("### Methodology")
    lines.append("")
    lines.append(
        "- Sentence segmentation: terminator (`.!?`) + whitespace + uppercase/quote lookahead; "
        f"sentences with <3 words dropped ({result['sentences_filtered_under_3_words']} filtered)."
    )
    lines.append(
        "- Per sentence: `comma_count`, `clause_count_punct = max(1, commas + ';' + ':' + 1)`, "
        "`clause_count_conj` (adds mid-sentence coordinating conjunctions), `sentence_words`."
    )
    lines.append(
        "- Per `(book, kind, sentence)` cell: comma-density per 100w, mean clauses, "
        "median/p25/p75 sentence-words, comma-per-sentence histogram (0/1/2/3+)."
    )
    lines.append(
        "- Mid-sentence conjunctions per 100w (interiority complement to P39 — leading-conjunction "
        "openers excluded so we don't double-count P39 surface)."
    )
    lines.append(
        "- Sentence-rhythm variability: per beat, stddev of comma density across sentences; "
        "averaged within (book, kind)."
    )
    lines.append(
        "- Cross-book gate: PASS = top-2 ordering reproduces 3/3 books for BOTH metrics AND "
        "per-kind mean values stable (≤25% spread); PASS_PARTIAL = 2/3 reproduce or one signal "
        "stable; DIVERGE = unstable; KILL = no signal."
    )
    lines.append("")

    # Per-book per-kind tables.
    lines.append("### Per-book per-kind sentence-rhythm signature")
    lines.append("")
    lines.append(
        "| Book | Kind | n sent | comma/100w (mean ± stdev) | commas/sent (mean) | "
        "clauses/sent punct (mean) | clauses/sent +conj (mean) | sentence words (median, p25–p75) |"
    )
    lines.append(
        "|------|------|--------|---------------------------|--------------------|"
        "----------------------------|----------------------------|---------------------------------|"
    )
    for book in BOOK_ORDER:
        for kind in ACTIVE_KINDS:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            cd = cell["comma_density_per_100w"]
            cs = cell["commas_per_sentence"]
            clp = cell["clauses_per_sentence_punct"]
            clc = cell["clauses_per_sentence_conj"]
            sw = cell["sentence_words"]
            lines.append(
                f"| {book} | {kind} | {cell['n_sentences']} | "
                f"{cd['mean']:.3f} ± {cd['stdev']:.3f} | "
                f"{cs['mean']:.2f} | {clp['mean']:.2f} | {clc['mean']:.2f} | "
                f"{sw['median']:.0f} ({sw['p25']:.0f}–{sw['p75']:.0f}) |"
            )
    lines.append("")

    # Per-kind ordering by metric.
    def fmt_ranking(metric_key: str) -> list[str]:
        sub: list[str] = []
        for book in BOOK_ORDER:
            ord_ = rankings.get(metric_key, {}).get(book, [])
            if not ord_:
                continue
            cells = ", ".join(f"{e['kind']} {e['value']:.3f}" for e in ord_)
            sub.append(f"  - **{book}** → {cells}")
        return sub

    lines.append("### Per-book ranking by comma density (mean per 100w)")
    lines.append("")
    lines.extend(fmt_ranking("comma_density_mean"))
    lines.append("")
    lines.append("### Per-book ranking by clauses per sentence (punctuation-break proxy)")
    lines.append("")
    lines.extend(fmt_ranking("clauses_punct_mean"))
    lines.append("")

    # Verdicts.
    lines.append("### Cross-book ordering verdict")
    lines.append("")
    lines.append("| Metric | Top-2 ordering by book | Books agreeing | Verdict |")
    lines.append("|--------|-------------------------|----------------|---------|")
    for metric_key, label in (
        ("comma_density", "Comma density"),
        ("clauses_per_sentence_punct", "Clauses/sentence (punct proxy)"),
    ):
        v = metric_verdicts[metric_key]
        per_book = "; ".join(
            f"{b}: {' > '.join(ks)}"
            for b, ks in v.get("per_book_top2", {}).items()
        )
        lines.append(
            f"| {label} | {per_book} | {v.get('books_with_matching_top2', 0)}/3 | "
            f"**{v['verdict']}** |"
        )
    lines.append("")

    # Mean stability.
    lines.append("### Per-kind mean stability (≤25% spread gate)")
    lines.append("")
    lines.append(
        "| Metric | Kind | Per-book means | Spread/mean | ≤25% stable |"
    )
    lines.append("|--------|------|----------------|-------------|-------------|")
    for metric in ("comma_density_per_100w", "clauses_per_sentence_punct"):
        for kind in ACTIVE_KINDS:
            row = mean_stability[metric].get(kind)
            if not row:
                continue
            vbb = row["values_by_book"]
            per_book_str = "; ".join(f"{b}={v:.3f}" for b, v in vbb.items())
            lines.append(
                f"| {metric} | {kind} | {per_book_str} | "
                f"{row['spread_over_mean']:.3f} | {row['stable_le_25pct']} |"
            )
    lines.append("")
    lines.append(f"**Overall verdict:** {result['overall_verdict']}")
    lines.append("")

    # Comma histogram.
    lines.append("### Comma-per-sentence histogram (% of sentences in cell)")
    lines.append("")
    lines.append(
        "| Book | Kind | 0 commas | 1 comma | 2 commas | 3+ commas |"
    )
    lines.append("|------|------|----------|---------|----------|-----------|")
    for book in BOOK_ORDER:
        for kind in ACTIVE_KINDS:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            h = cell["comma_histogram"]["pct"]
            lines.append(
                f"| {book} | {kind} | {h['0']:.1f}% | {h['1']:.1f}% | "
                f"{h['2']:.1f}% | {h['3+']:.1f}% |"
            )
    lines.append("")

    # Mid-sentence conjunction signature (interiority complement).
    mc = result["mid_sentence_conjunctions"]
    lines.append("### Mid-sentence coordinating-conjunction density per 100w")
    lines.append(
        "_Complement to P39 — leading-conjunction sentence openers excluded so we don't "
        "double-count P39's signal._"
    )
    lines.append("")
    lines.append("| Kind | crystal_shard | streams_of_silver | halflings_gem | mean | spread/mean |")
    lines.append("|------|---------------|-------------------|---------------|------|-------------|")
    for kind in ACTIVE_KINDS:
        row = mc["per_kind"].get(kind)
        if not row:
            continue
        pb = row["per_book"]
        lines.append(
            f"| {kind} | {pb.get('crystal_shard', 0):.3f} | "
            f"{pb.get('streams_of_silver', 0):.3f} | "
            f"{pb.get('halflings_gem', 0):.3f} | {row['mean_across_books']:.3f} | "
            f"{row['spread_over_mean']:.3f} |"
        )
    lines.append("")
    top1_per_book_mc = "; ".join(
        f"{b}={k}" for b, k in mc["per_book_top1"].items() if k
    )
    lines.append(
        f"**Per-book top-1 kind for mid-sentence conjunctions:** {top1_per_book_mc} "
        f"(stable_top1={mc['top1_stable']})"
    )
    lines.append("")

    # Sentence-rhythm variability.
    rv = result["rhythm_variability"]
    lines.append("### Within-beat comma-density variability (mean stdev of comma/100w across sentences in beat)")
    lines.append(
        "_Higher = more mixed-rhythm within a beat (sentences swing between heavy and sparse)._"
    )
    lines.append("")
    lines.append("| Kind | crystal_shard | streams_of_silver | halflings_gem | mean | spread/mean |")
    lines.append("|------|---------------|-------------------|---------------|------|-------------|")
    for kind in ACTIVE_KINDS:
        row = rv["per_kind"].get(kind)
        if not row:
            continue
        pb = row["per_book_mean_within_beat_stdev"]
        lines.append(
            f"| {kind} | {pb.get('crystal_shard', 0):.3f} | "
            f"{pb.get('streams_of_silver', 0):.3f} | "
            f"{pb.get('halflings_gem', 0):.3f} | {row['mean_across_books']:.3f} | "
            f"{row['spread_over_mean']:.3f} |"
        )
    lines.append("")
    top1_per_book_rv = "; ".join(
        f"{b}={k}" for b, k in rv["per_book_top1"].items() if k
    )
    lines.append(
        f"**Per-book top-1 kind for within-beat rhythm variability:** {top1_per_book_rv} "
        f"(stable_top1={rv['top1_stable']})"
    )
    lines.append("")

    # Findings.
    lines.append("### Findings")
    lines.append("")

    findings: list[str] = []
    # Comma-density top kind.
    cd_v = metric_verdicts["comma_density"]
    if cd_v.get("per_book_top1"):
        top1s = list(cd_v["per_book_top1"].values())
        modal = max(set(top1s), key=top1s.count) if top1s else None
        findings.append(
            f"- **Comma-density signature**: top-1 kind across books "
            f"{cd_v['per_book_top1']} → modal `{modal}`. Top-2 ordering reproduces "
            f"{cd_v['books_with_matching_top2']}/3. Verdict **{cd_v['verdict']}**."
        )
    # Clauses-per-sentence top kind.
    cl_v = metric_verdicts["clauses_per_sentence_punct"]
    if cl_v.get("per_book_top1"):
        top1s = list(cl_v["per_book_top1"].values())
        modal = max(set(top1s), key=top1s.count) if top1s else None
        findings.append(
            f"- **Clauses-per-sentence signature**: top-1 kind across books "
            f"{cl_v['per_book_top1']} → modal `{modal}`. Top-2 ordering reproduces "
            f"{cl_v['books_with_matching_top2']}/3. Verdict **{cl_v['verdict']}**."
        )

    # Action vs description axis.
    def safe_metric(book: str, kind: str, key: str, sub: str) -> float | None:
        c = per_cell.get(book, {}).get(kind)
        if not c:
            return None
        return c[key][sub]

    cs_action = safe_metric("crystal_shard", "action", "comma_density_per_100w", "mean")
    cs_desc = safe_metric("crystal_shard", "description", "comma_density_per_100w", "mean")
    if cs_action is not None and cs_desc is not None and cs_action > 0:
        ratio = cs_desc / cs_action
        findings.append(
            f"- **Action-vs-description axis (CS reference)**: description {cs_desc:.2f} commas/100w "
            f"vs action {cs_action:.2f} → description is {ratio:.2f}× action's comma density."
        )

    # Interiority mid-sentence conjunction.
    mc_per_kind = mc["per_kind"]
    if "interiority" in mc_per_kind and "action" in mc_per_kind:
        i = mc_per_kind["interiority"]["mean_across_books"]
        a = mc_per_kind["action"]["mean_across_books"]
        if a > 0:
            ratio = i / a
            findings.append(
                f"- **Interiority mid-sentence conjunction signature**: "
                f"{i:.3f}/100w vs action {a:.3f}/100w → interiority is {ratio:.2f}× action "
                f"(complements P39's conjunction-first opener finding)."
            )

    # Within-beat variability — which kind has the widest swing?
    if rv["per_book_top1"]:
        top1_v = list(rv["per_book_top1"].values())
        modal = max(set(top1_v), key=top1_v.count) if top1_v else None
        findings.append(
            f"- **Within-beat rhythm variability**: top-1 kind by mean within-beat "
            f"comma-density stddev = {rv['per_book_top1']} → modal `{modal}` "
            f"(stable_top1={rv['top1_stable']})."
        )

    # Comma-zero rate as kinetic-rhythm proxy.
    zero_rates = {}
    for book in BOOK_ORDER:
        for kind in ACTIVE_KINDS:
            cell = per_cell.get(book, {}).get(kind)
            if not cell:
                continue
            zero_rates.setdefault(kind, []).append(cell["comma_histogram"]["pct"]["0"])
    zero_kind_means = {k: statistics.mean(v) for k, v in zero_rates.items()}
    if "action" in zero_kind_means and "description" in zero_kind_means:
        findings.append(
            f"- **Zero-comma-sentence rate** (kinetic rhythm proxy): action "
            f"{zero_kind_means['action']:.1f}%, dialogue "
            f"{zero_kind_means.get('dialogue', 0):.1f}%, interiority "
            f"{zero_kind_means.get('interiority', 0):.1f}%, description "
            f"{zero_kind_means['description']:.1f}% — action sentences are "
            f"{zero_kind_means['action'] / max(zero_kind_means['description'], 0.01):.2f}× "
            f"as likely to carry zero commas as description sentences."
        )

    lines.extend(findings)
    lines.append("")
    lines.append(
        "_See JSON for full per-cell distributions, p25/p75 sentence-words, raw histograms, "
        "and per-book mid-conjunction + variability rankings._"
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
    metric_verdicts = result["metric_verdicts"]
    per_cell = result["per_book_per_kind"]

    # Compact findings string.
    cd_v = metric_verdicts["comma_density"]
    cl_v = metric_verdicts["clauses_per_sentence_punct"]
    cd_top1 = cd_v.get("per_book_top1", {})
    cl_top1 = cl_v.get("per_book_top1", {})

    def modal(d: dict) -> str:
        if not d:
            return "-"
        vals = list(d.values())
        return max(set(vals), key=vals.count)

    cd_modal = modal(cd_top1)
    cl_modal = modal(cl_top1)

    # Description:action comma-density ratio (CS reference).
    cs_action = (
        per_cell.get("crystal_shard", {}).get("action", {})
        .get("comma_density_per_100w", {}).get("mean")
    )
    cs_desc = (
        per_cell.get("crystal_shard", {}).get("description", {})
        .get("comma_density_per_100w", {}).get("mean")
    )
    ratio_str = (
        f"{cs_desc / cs_action:.2f}×" if cs_action and cs_desc and cs_action > 0 else "n/a"
    )

    # Interiority mid-conj vs action ratio (across-book mean).
    mc_per_kind = result["mid_sentence_conjunctions"]["per_kind"]
    mc_int = mc_per_kind.get("interiority", {}).get("mean_across_books")
    mc_act = mc_per_kind.get("action", {}).get("mean_across_books")
    mc_ratio_str = (
        f"{mc_int / mc_act:.2f}×" if mc_act and mc_int and mc_act > 0 else "n/a"
    )

    findings = (
        f"comma-density top-1 modal `{cd_modal}` (verdict {cd_v['verdict']}); "
        f"clauses/sent top-1 modal `{cl_modal}` (verdict {cl_v['verdict']}); "
        f"description:action comma-density ratio CS={ratio_str}; "
        f"interiority:action mid-sentence conjunctions {mc_ratio_str}"
    )

    if overall == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship per-kind comma-density + clauses/sentence priors as writer-prompt rhythm targets"
        )
    elif overall in ("PASS_PARTIAL", "PASS_PARTIAL_TOP1"):
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship the stable axis (comma density or clauses-per-sentence ordering) as soft "
            "writer-prompt prior; defer the unstable axis"
        )
    elif overall == "DIVERGE":
        verdict_short = "HOLD"
        recommend = "do not codify per-kind rhythm priors; revisit with finer methodology"
    else:
        verdict_short = "KILL"
        recommend = "no signal; drop as a writer-prompt prior"

    lever = (
        "writer-prompt per-kind comma-density + clauses-per-sentence rhythm priors "
        "(action=fewer commas/clauses, description=denser, interiority=mid-sentence "
        "conjunction-leaning); optional lint: warn when action-kind beats average comma "
        "density >= description-kind mean (rhythm collapse)"
    )

    new_row = (
        f"| {PATTERN_NUMBER} | **Comma + clause-count per sentence** (`{commit}`): {findings} | "
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
    print(f"verdict: {result['overall_verdict']}")
    for m, v in result["metric_verdicts"].items():
        per_book = ", ".join(
            f"{b}: {' > '.join(ks)}" for b, ks in v.get("per_book_top2", {}).items()
        )
        print(f"  {m:>30s} → {v['verdict']:<22s} | {per_book}")
    print()
    for kind in ACTIVE_KINDS:
        cd_means = {
            b: result["per_book_per_kind"].get(b, {}).get(kind, {})
            .get("comma_density_per_100w", {}).get("mean")
            for b in BOOK_ORDER
        }
        cl_means = {
            b: result["per_book_per_kind"].get(b, {}).get(kind, {})
            .get("clauses_per_sentence_punct", {}).get("mean")
            for b in BOOK_ORDER
        }
        print(
            f"  {kind:>12s} comma/100w: " +
            ", ".join(f"{b[:8]}={v}" for b, v in cd_means.items() if v is not None) +
            f" | clauses/sent: " +
            ", ".join(f"{b[:8]}={v}" for b, v in cl_means.items() if v is not None)
        )


if __name__ == "__main__":
    main()
