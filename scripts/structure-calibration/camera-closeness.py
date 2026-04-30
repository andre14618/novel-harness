#!/usr/bin/env python3
r"""Pattern 67 — Camera/POV closeness per beat-kind in the Salvatore Icewind
Dale 3-book corpus.

Hypothesis
----------
Salvatore writes mostly in close-third — but the CAMERA DISTANCE varies by
beat-kind:

  * action      → CLOSER ("his fingers tightened around the hilt") with
                  sensory anchors and possessive-pronoun + body-part diction.
  * description → MORE DISTANT ("the cavern stretched away into darkness")
                  with aerial-view spatial markers + existential constructions.
  * interiority → CLOSEST (interior monologue, direct thought access via
                  "he knew" / "he wondered" / "he felt that").
  * dialogue    → MIXED (camera observes from close + descriptive tags).

Lexical markers of CLOSE-third camera:
  - Possessive pronoun + noun ("his hand", "her gaze")  [overlaps P56 body-parts]
  - Sensory verbs in subject-anchored frame ("he saw", "she felt", "they heard")
  - Internal-state cognitive verbs ("he knew", "he wondered", "he felt that")

Lexical markers of DISTANT camera:
  - Definite-article noun phrases naming the POV from outside ("the man",
    "the warrior", "the dwarf").
  - "There was/were" existential constructions.
  - Aerial-view spatial markers ("across the valley", "in the distance",
    "throughout the cave", "beyond the ridge").

Methodology — pure-compute lexicon density
------------------------------------------
Per beat we compute six densities per 100 words plus a closeness ratio.

  CLOSE_POSSESSIVE   — `\b(his|her|their|its|my|our|your)\s+\w+\b` per 100w
  CLOSE_SENSORY      — `\b(he|she|they|i|we|you)\s+(saw|felt|heard|noticed|
                       sensed|smelled|tasted)\b` per 100w
  CLOSE_COGNITIVE    — `\b(he|she|they|i|we|you)\s+(knew|thought|wondered|
                       realized|understood|believed|remembered|considered|
                       hoped|feared)\b` per 100w  [overlaps P64 telling — that
                       is intentional; both signals count this as close-camera]

  DISTANT_LABEL      — `\bthe\s+(man|woman|warrior|dwarf|elf|halfling|drow|
                       ranger|barbarian|wizard|priest|king|stranger|figure)\b`
                       per 100w
  DISTANT_EXISTENTIAL — `\bthere\s+(was|were|came|stood|lay|sat|seemed)\b`
                       per 100w
  DISTANT_AERIAL     — `\b(across|throughout|beyond|along|over)\s+the\s+\w+\b`
                       per 100w

Per beat:
  sum_close   = CLOSE_POSSESSIVE + CLOSE_SENSORY + CLOSE_COGNITIVE
  sum_distant = DISTANT_LABEL + DISTANT_EXISTENTIAL + DISTANT_AERIAL
  closeness_ratio = sum_close / (sum_distant + 0.1)

The 0.1 floor is the spec convention (mirrors P64 showing-vs-telling) — it
compresses zero-distant beats into a finite range while preserving ordering.

Per (book, kind) we aggregate both per-beat means and length-pooled densities.

Distant-marker reality check
----------------------------
The hypothesis admits a degenerate possibility: if distant markers fire at
< 0.1 / 100w everywhere, the distant-camera mode is effectively absent and
Salvatore is uniformly close. We report per-book per-kind distant density;
if max < 0.1/100w per kind, we tag the cell as `distant_absent` and note the
finding in the verdict prose.

Cross-book gate (per spec)
--------------------------
  PASS         — per-kind closeness ratio ORDERING reproduces 3/3 books AND
                 total closeness ratio cross-book spread ≤30%.
  PASS_PARTIAL — 2/3 books reproduce.
  DIVERGE      — unstable.

Outputs
-------
  - JSON timestamped artifact
        novels/salvatore-icewind-dale/structure-calibration/
            crystal_shard.<YYYYMMDDTHHMMSS>.camera-closeness.json
  - Atomic-append section to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert row to docs/harness-tuning-roadmap.md before the
    `\\n**Sequencing` anchor (fcntl flock; pattern number = 67)
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean, pstdev

sys.path.insert(0, str(Path(__file__).parent / "lib"))
from atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)


PATTERN_ID = 67
PATTERN_NAME = "Camera/POV closeness per beat-kind (close-third vs distant-third lexical signatures)"

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

ACTIVE_KINDS = ("action", "dialogue", "interiority", "description")
BOOKS = ("crystal_shard", "streams_of_silver", "halflings_gem")

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------

# CLOSE markers
# Possessive pronoun + noun. Match the word immediately following an English
# possessive determiner. We use a generous \w+ for the noun (some hits will
# include adjectives like "his cold hand" → counts the adjective; for density
# the choice is fine — we're measuring how often the camera anchors via the
# POV's possessions/body-frame).
CLOSE_POSSESSIVE_RE = re.compile(
    r"\b(?:his|her|their|its|my|our|your)\s+[A-Za-z]+\b",
    flags=re.IGNORECASE,
)

# Subject-pronoun + sensory verb. Order verbs from longest to shortest to
# avoid partial-match ambiguities.
CLOSE_SENSORY_RE = re.compile(
    r"\b(?:he|she|they|i|we|you)\s+"
    r"(?:noticed|sensed|smelled|tasted|heard|felt|saw)\b",
    flags=re.IGNORECASE,
)

# Subject-pronoun + cognitive/internal-state verb. Includes the explicit
# `felt that` cognitive frame which P64 routes to telling — by P67 design
# it's a close-camera marker (direct cognitive access from within the POV).
CLOSE_COGNITIVE_RE = re.compile(
    r"\b(?:he|she|they|i|we|you)\s+"
    r"(?:remembered|understood|considered|wondered|realized|believed|"
    r"thought|knew|hoped|feared)\b",
    flags=re.IGNORECASE,
)

# DISTANT markers
# "the <role-label>" — POV named from outside. Only specific role/identity
# nouns count; generic "the door" / "the table" are NOT distant-camera
# markers (those are descriptive, not POV-labeling).
DISTANT_LABEL_RE = re.compile(
    r"\bthe\s+"
    r"(?:halfling|barbarian|stranger|warrior|wizard|woman|ranger|priest|"
    r"figure|dwarf|drow|king|man|elf)\b",
    flags=re.IGNORECASE,
)

# Existential "there was / were / came / stood / lay / sat / seemed".
DISTANT_EXISTENTIAL_RE = re.compile(
    r"\bthere\s+(?:seemed|were|stood|came|was|lay|sat)\b",
    flags=re.IGNORECASE,
)

# Aerial spatial: "<prep> the <noun>" — fly-over framing.
DISTANT_AERIAL_RE = re.compile(
    r"\b(?:throughout|across|beyond|along|over)\s+the\s+[A-Za-z]+\b",
    flags=re.IGNORECASE,
)

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


def load_beats() -> list[dict]:
    beats = []
    with BEATS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            beats.append(json.loads(line))
    return beats


def density_per_100w(count: int, words: int) -> float:
    if words <= 0:
        return 0.0
    return 100.0 * count / words


def count_markers(text: str) -> dict[str, int]:
    """Return raw counts for each of the six marker classes."""
    return {
        "close_possessive": len(CLOSE_POSSESSIVE_RE.findall(text)),
        "close_sensory": len(CLOSE_SENSORY_RE.findall(text)),
        "close_cognitive": len(CLOSE_COGNITIVE_RE.findall(text)),
        "distant_label": len(DISTANT_LABEL_RE.findall(text)),
        "distant_existential": len(DISTANT_EXISTENTIAL_RE.findall(text)),
        "distant_aerial": len(DISTANT_AERIAL_RE.findall(text)),
    }


CLOSE_KEYS = ("close_possessive", "close_sensory", "close_cognitive")
DISTANT_KEYS = ("distant_label", "distant_existential", "distant_aerial")


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


def analyze(beats: list[dict]) -> dict:
    # Per-beat hits + per-(book, kind) accumulators.
    per_beat: list[dict] = []
    cell_counts: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {k: 0 for k in CLOSE_KEYS + DISTANT_KEYS}
    )
    cell_words: dict[tuple[str, str], int] = defaultdict(int)
    cell_n: dict[tuple[str, str], int] = defaultdict(int)

    # Per-beat density / ratio arrays (for mean-of-mean aggregation).
    cell_close_d: dict[tuple[str, str], list[float]] = defaultdict(list)
    cell_distant_d: dict[tuple[str, str], list[float]] = defaultdict(list)
    cell_ratio: dict[tuple[str, str], list[float]] = defaultdict(list)
    cell_marker_d: dict[tuple[str, str], dict[str, list[float]]] = defaultdict(
        lambda: {k: [] for k in CLOSE_KEYS + DISTANT_KEYS}
    )

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

        counts = count_markers(text)

        per_marker_density = {
            k: round(density_per_100w(counts[k], words), 4)
            for k in CLOSE_KEYS + DISTANT_KEYS
        }
        sum_close = sum(counts[k] for k in CLOSE_KEYS)
        sum_distant = sum(counts[k] for k in DISTANT_KEYS)
        close_d = density_per_100w(sum_close, words)
        distant_d = density_per_100w(sum_distant, words)
        ratio = close_d / (distant_d + 0.1)

        per_beat.append({
            "book": book,
            "chapter": b.get("chapter"),
            "scene_id": b.get("scene_id"),
            "beat_idx": b.get("beat_idx"),
            "kind": kind,
            "words": words,
            "marker_hits": counts,
            "marker_density_per_100w": per_marker_density,
            "close_density_per_100w": round(close_d, 4),
            "distant_density_per_100w": round(distant_d, 4),
            "closeness_ratio": round(ratio, 4),
        })

        key = (book, kind)
        for k in CLOSE_KEYS + DISTANT_KEYS:
            cell_counts[key][k] += counts[k]
            cell_marker_d[key][k].append(per_marker_density[k])
        cell_close_d[key].append(close_d)
        cell_distant_d[key].append(distant_d)
        cell_ratio[key].append(ratio)
        cell_words[key] += words
        cell_n[key] += 1

    # Aggregate cell stats
    cells: dict[str, dict[str, dict]] = defaultdict(dict)
    for (book, kind), n_beats in cell_n.items():
        words = cell_words[(book, kind)]
        counts = cell_counts[(book, kind)]
        # Length-pooled densities
        pooled_close_d = density_per_100w(
            sum(counts[k] for k in CLOSE_KEYS), words
        )
        pooled_distant_d = density_per_100w(
            sum(counts[k] for k in DISTANT_KEYS), words
        )
        cells[book][kind] = {
            "n_beats": n_beats,
            "words": words,
            "marker_hits_total": dict(counts),
            "mean_marker_density_per_100w": {
                k: round(mean(cell_marker_d[(book, kind)][k]), 4)
                for k in CLOSE_KEYS + DISTANT_KEYS
            },
            "pooled_marker_density_per_100w": {
                k: round(density_per_100w(counts[k], words), 4)
                for k in CLOSE_KEYS + DISTANT_KEYS
            },
            "mean_close_density_per_100w": round(
                mean(cell_close_d[(book, kind)]), 4
            ),
            "mean_distant_density_per_100w": round(
                mean(cell_distant_d[(book, kind)]), 4
            ),
            "mean_closeness_ratio": round(mean(cell_ratio[(book, kind)]), 4),
            "pooled_close_density_per_100w": round(pooled_close_d, 4),
            "pooled_distant_density_per_100w": round(pooled_distant_d, 4),
            "pooled_closeness_ratio": round(
                pooled_close_d / (pooled_distant_d + 0.1), 4
            ),
        }

    # Per-kind ranking by mean closeness ratio. Each book gets an ordered
    # list of kinds (closest-camera-first → most-distant-first).
    kind_ranking: dict[str, list[tuple[str, float]]] = {}
    for book in BOOKS:
        if book not in cells:
            continue
        scores = sorted(
            ((k, cells[book][k]["mean_closeness_ratio"]) for k in cells[book]),
            key=lambda kv: kv[1],
            reverse=True,
        )
        kind_ranking[book] = scores

    # Per-kind cross-book ratio stability + per-component spreads
    per_kind_ratios: dict[str, dict[str, float]] = defaultdict(dict)
    per_kind_close_density: dict[str, dict[str, float]] = defaultdict(dict)
    per_kind_distant_density: dict[str, dict[str, float]] = defaultdict(dict)
    for book in BOOKS:
        if book not in cells:
            continue
        for k in cells[book]:
            per_kind_ratios[k][book] = cells[book][k]["mean_closeness_ratio"]
            per_kind_close_density[k][book] = cells[book][k][
                "mean_close_density_per_100w"
            ]
            per_kind_distant_density[k][book] = cells[book][k][
                "mean_distant_density_per_100w"
            ]

    def _spread_pct(values: list[float]) -> float | None:
        if not values:
            return None
        v_min = min(values)
        v_max = max(values)
        if v_min <= 0:
            # Indeterminate — distant-density can be zero; treat as None and
            # downstream renderers display "—". For the close-density and
            # ratio side we never expect zero (close markers fire heavily
            # corpus-wide).
            return None
        return round((v_max / v_min - 1.0) * 100.0, 2)

    per_kind_stability: dict[str, dict] = {}
    for k in ACTIVE_KINDS:
        ratios = list(per_kind_ratios.get(k, {}).values())
        close_vals = list(per_kind_close_density.get(k, {}).values())
        distant_vals = list(per_kind_distant_density.get(k, {}).values())
        ratio_spread = _spread_pct(ratios)
        per_kind_stability[k] = {
            "per_book_mean_ratio": per_kind_ratios.get(k, {}),
            "per_book_mean_close_density": per_kind_close_density.get(k, {}),
            "per_book_mean_distant_density": per_kind_distant_density.get(k, {}),
            "ratio_min": round(min(ratios), 4) if ratios else None,
            "ratio_max": round(max(ratios), 4) if ratios else None,
            "ratio_mean": round(mean(ratios), 4) if ratios else None,
            "ratio_spread_pct": ratio_spread,
            "ratio_spread_le_30pct": (
                bool(ratio_spread is not None and ratio_spread <= 30.0)
            ),
            "close_spread_pct": _spread_pct(close_vals),
            "distant_spread_pct": _spread_pct(distant_vals),
        }

    # Cross-book ordering reproduction
    orderings = {
        book: tuple(k for k, _ in kind_ranking[book])
        for book in kind_ranking
    }
    if len(orderings) >= 3:
        ref = next(iter(orderings.values()))
        match = sum(1 for v in orderings.values() if v == ref)
    else:
        ref = ()
        match = 0

    # Top-1 and top-2 set agreement (lower bar than full ordering)
    top1_per_book = {b: o[0] for b, o in orderings.items()}
    top2_per_book = {b: set(o[:2]) for b, o in orderings.items()}
    top1_agreement = (
        len(set(top1_per_book.values())) == 1
        if len(top1_per_book) >= 2 else False
    )
    if len(top2_per_book) >= 2:
        sets = list(top2_per_book.values())
        top2_intersection = set.intersection(*sets)
    else:
        top2_intersection = set()

    # Total per-book closeness ratio (overall across kinds) for the
    # "total closeness ratio stable ≤30% spread" gate component.
    per_book_total_ratio: dict[str, float] = {}
    for book in BOOKS:
        if book not in cells:
            continue
        total_close = sum(
            cells[book][k]["marker_hits_total"][m]
            for k in cells[book]
            for m in CLOSE_KEYS
        )
        total_distant = sum(
            cells[book][k]["marker_hits_total"][m]
            for k in cells[book]
            for m in DISTANT_KEYS
        )
        total_words = sum(cells[book][k]["words"] for k in cells[book])
        if total_words > 0:
            close_d = density_per_100w(total_close, total_words)
            distant_d = density_per_100w(total_distant, total_words)
            per_book_total_ratio[book] = round(close_d / (distant_d + 0.1), 4)

    total_ratio_vals = list(per_book_total_ratio.values())
    total_ratio_spread_pct = _spread_pct(total_ratio_vals)
    total_ratio_spread_le_30pct = bool(
        total_ratio_spread_pct is not None and total_ratio_spread_pct <= 30.0
    )

    # Distant-marker reality check — flag cells where total distant density
    # is below 0.1/100w (effectively absent at production granularity).
    distant_absent_cells: list[dict] = []
    for book in BOOKS:
        if book not in cells:
            continue
        for kind in ACTIVE_KINDS:
            if kind not in cells[book]:
                continue
            d = cells[book][kind]["mean_distant_density_per_100w"]
            if d < 0.1:
                distant_absent_cells.append({
                    "book": book,
                    "kind": kind,
                    "mean_distant_density_per_100w": d,
                })

    # Per-kind aggregate closeness ratio (cross-book mean of per-beat means)
    kind_ratio_aggregate: dict[str, float] = {}
    for k in ACTIVE_KINDS:
        vals = list(per_kind_ratios.get(k, {}).values())
        kind_ratio_aggregate[k] = round(mean(vals), 4) if vals else 0.0
    aggregate_kind_ranking = sorted(
        kind_ratio_aggregate.items(),
        key=lambda kv: kv[1],
        reverse=True,
    )

    # Verdict
    if match >= 3 and total_ratio_spread_le_30pct:
        overall_verdict = "PASS"
        verdict_summary = (
            "Per-kind closeness-ratio ordering reproduces 3/3 books AND "
            "total per-book closeness ratio cross-book spread ≤30%."
        )
    elif match >= 3:
        overall_verdict = "PASS_PARTIAL"
        verdict_summary = (
            "Per-kind ordering reproduces 3/3 books but total-corpus "
            "closeness-ratio spread exceeds 30% across books."
        )
    elif match == 2:
        overall_verdict = "PASS_PARTIAL"
        verdict_summary = (
            "Per-kind ordering reproduces 2/3 books — borderline-stable "
            "signal."
        )
    else:
        overall_verdict = "DIVERGE"
        verdict_summary = (
            "Per-kind ordering is unstable across books — closeness ratio "
            "is not a reliable cross-book voice prior at the kind granularity."
        )

    # Corpus-aggregate per-beat statistics
    close_arr = [b["close_density_per_100w"] for b in per_beat]
    distant_arr = [b["distant_density_per_100w"] for b in per_beat]
    ratio_arr = [b["closeness_ratio"] for b in per_beat]
    corpus_close_mean = mean(close_arr) if close_arr else 0.0
    corpus_distant_mean = mean(distant_arr) if distant_arr else 0.0
    corpus_ratio_mean = mean(ratio_arr) if ratio_arr else 0.0
    corpus_close_sd = pstdev(close_arr) if close_arr else 0.0
    corpus_distant_sd = pstdev(distant_arr) if distant_arr else 0.0
    corpus_ratio_sd = pstdev(ratio_arr) if ratio_arr else 0.0

    # Distant-cluster: beats with distant_density > 2× corpus mean
    threshold = 2.0 * corpus_distant_mean
    distant_cluster_beats = [
        b for b in per_beat if b["distant_density_per_100w"] > threshold
    ]
    cluster_kind_dist: dict[str, int] = defaultdict(int)
    cluster_book_dist: dict[str, int] = defaultdict(int)
    for b in distant_cluster_beats:
        cluster_kind_dist[b["kind"]] += 1
        cluster_book_dist[b["book"]] += 1

    return {
        "books": list(BOOKS),
        "active_kinds": list(ACTIVE_KINDS),
        "skipped_beats": skipped,
        "n_beats_used": len(per_beat),
        "cells": cells,
        "kind_ranking_per_book": {
            b: [{"kind": k, "mean_closeness_ratio": round(v, 4)} for k, v in arr]
            for b, arr in kind_ranking.items()
        },
        "kind_orderings_per_book": {b: list(o) for b, o in orderings.items()},
        "kind_orderings_match_count": match,
        "top1_per_book": top1_per_book,
        "top1_agreement": top1_agreement,
        "top2_per_book": {b: sorted(s) for b, s in top2_per_book.items()},
        "top2_3way_intersection": sorted(top2_intersection),
        "aggregate_kind_ranking": [
            {"kind": k, "aggregate_mean_ratio": v} for k, v in aggregate_kind_ranking
        ],
        "per_kind_stability": per_kind_stability,
        "per_book_total_closeness_ratio": per_book_total_ratio,
        "total_closeness_ratio_spread_pct": total_ratio_spread_pct,
        "total_closeness_ratio_spread_le_30pct": total_ratio_spread_le_30pct,
        "distant_absent_cells": distant_absent_cells,
        "corpus_close_mean_per_100w": round(corpus_close_mean, 4),
        "corpus_distant_mean_per_100w": round(corpus_distant_mean, 4),
        "corpus_closeness_ratio_mean": round(corpus_ratio_mean, 4),
        "corpus_close_sd_per_100w": round(corpus_close_sd, 4),
        "corpus_distant_sd_per_100w": round(corpus_distant_sd, 4),
        "corpus_closeness_ratio_sd": round(corpus_ratio_sd, 4),
        "distant_cluster_threshold_per_100w": round(threshold, 4),
        "distant_cluster_n_beats": len(distant_cluster_beats),
        "distant_cluster_share_pct": round(
            100.0 * len(distant_cluster_beats) / max(1, len(per_beat)), 2
        ),
        "distant_cluster_kind_dist": dict(cluster_kind_dist),
        "distant_cluster_book_dist": dict(cluster_book_dist),
        "distant_cluster_kind_share_pct": {
            k: round(100.0 * v / len(distant_cluster_beats), 2)
            for k, v in cluster_kind_dist.items()
        } if distant_cluster_beats else {},
        "overall_verdict": overall_verdict,
        "verdict_summary": verdict_summary,
    }


# ---------------------------------------------------------------------------
# Conclusions section + roadmap row renderers
# ---------------------------------------------------------------------------


def build_conclusions_section(result: dict, json_path: Path, commit: str) -> str:
    cells = result["cells"]
    stability = result["per_kind_stability"]
    aggregate_rank = result["aggregate_kind_ranking"]
    overall = result["overall_verdict"]

    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_ID}: {PATTERN_NAME}")
    lines.append("")
    lines.append(
        f"_Pure-compute lexical density across 3 books × 4 active beat-kinds. "
        f"Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")

    lines.append("### Methodology")
    lines.append("")
    lines.append(
        "Six word-boundary, case-insensitive marker classes — three CLOSE-third, "
        "three DISTANT-third:"
    )
    lines.append("")
    lines.append(
        "- **CLOSE_POSSESSIVE** — `<his|her|their|its|my|our|your> <noun>` — POV's "
        "body / belongings frame (overlaps Pattern 56 body-part vocabulary)."
    )
    lines.append(
        "- **CLOSE_SENSORY** — `<he|she|they|i|we|you> <saw|felt|heard|noticed|"
        "sensed|smelled|tasted>` — subject-anchored sensory perception."
    )
    lines.append(
        "- **CLOSE_COGNITIVE** — `<he|she|they|i|we|you> <knew|thought|wondered|"
        "realized|understood|believed|remembered|considered|hoped|feared>` — "
        "direct cognitive access from inside the POV. Overlaps Pattern 64 "
        "telling-lexicon — that is intentional; both signals count this as a "
        "close-camera marker (the shared verb stems are doing different work in "
        "the two patterns)."
    )
    lines.append(
        "- **DISTANT_LABEL** — `the <man|woman|warrior|dwarf|elf|halfling|drow|"
        "ranger|barbarian|wizard|priest|king|stranger|figure>` — POV named "
        "from outside (omniscient / cinematic frame)."
    )
    lines.append(
        "- **DISTANT_EXISTENTIAL** — `there <was|were|came|stood|lay|sat|seemed>` "
        "— existential / scene-painting constructions."
    )
    lines.append(
        "- **DISTANT_AERIAL** — `<across|throughout|beyond|along|over> the "
        "<noun>` — aerial-view spatial framing."
    )
    lines.append("")
    lines.append(
        "Per beat: `close_density = 100 × sum_close_hits / words`, similarly "
        "for distant. **Closeness ratio per beat = "
        "`close_density / (distant_density + 0.1)`** (0.1 floor avoids "
        "division-by-zero on distant-free beats while preserving ordering — "
        "spec convention, mirrors Pattern 64)."
    )
    lines.append("")
    lines.append(
        f"Skipped: {result['skipped_beats']} beats (singleton "
        f"`stakes_recalibration` kind + zero-word/empty-text). "
        f"n={result['n_beats_used']} beats analyzed."
    )
    lines.append("")

    # Per-book per-kind table
    lines.append("### Per-book per-kind densities (mean per beat)")
    lines.append("")
    lines.append(
        "| book | kind | n | words | close/100w | distant/100w | "
        "closeness ratio |"
    )
    lines.append("|---|---|---:|---:|---:|---:|---:|")
    for book in BOOKS:
        if book not in cells:
            continue
        for kind in ACTIVE_KINDS:
            if kind not in cells[book]:
                continue
            c = cells[book][kind]
            lines.append(
                f"| {book} | {kind} | {c['n_beats']} | {c['words']:,} | "
                f"{c['mean_close_density_per_100w']:.3f} | "
                f"{c['mean_distant_density_per_100w']:.3f} | "
                f"**{c['mean_closeness_ratio']:.2f}** |"
            )
    lines.append("")

    # Per-marker-class breakdown
    lines.append("### Per-book per-kind marker-class density breakdown (mean per beat, /100w)")
    lines.append("")
    lines.append(
        "| book | kind | poss | sensory | cognitive | label | exist | aerial |"
    )
    lines.append("|---|---|---:|---:|---:|---:|---:|---:|")
    for book in BOOKS:
        if book not in cells:
            continue
        for kind in ACTIVE_KINDS:
            if kind not in cells[book]:
                continue
            c = cells[book][kind]["mean_marker_density_per_100w"]
            lines.append(
                f"| {book} | {kind} | "
                f"{c['close_possessive']:.3f} | "
                f"{c['close_sensory']:.3f} | "
                f"{c['close_cognitive']:.3f} | "
                f"{c['distant_label']:.3f} | "
                f"{c['distant_existential']:.3f} | "
                f"{c['distant_aerial']:.3f} |"
            )
    lines.append("")

    # Per-book per-kind ranking
    lines.append("### Per-book closeness ranking (closest → most distant, by mean ratio)")
    lines.append("")
    for book in BOOKS:
        if book not in result["kind_ranking_per_book"]:
            continue
        order = result["kind_ranking_per_book"][book]
        order_str = " > ".join(
            f"{e['kind']} ({e['mean_closeness_ratio']:.2f})" for e in order
        )
        lines.append(f"- **{book}** → {order_str}")
    lines.append("")

    # Aggregate kind ranking
    lines.append("### Aggregate per-kind closeness ranking (cross-book mean of per-beat means)")
    lines.append("")
    lines.append("| Kind | Aggregate closeness ratio | Hypothesized direction |")
    lines.append("|---|---:|---|")
    interpretation = {
        "interiority": "expected closest (interior monologue, direct cognitive access)",
        "action": "expected close (sensory anchors + possessive body frame)",
        "dialogue": "mixed (camera observes from close + descriptive tags)",
        "description": "expected most distant (aerial / scene-painting frame)",
    }
    for entry in aggregate_rank:
        k = entry["kind"]
        v = entry["aggregate_mean_ratio"]
        lines.append(f"| {k} | {v:.2f} | {interpretation.get(k, '')} |")
    lines.append("")

    # Per-kind cross-book ratio stability
    lines.append("### Per-kind cross-book ratio stability")
    lines.append("")
    lines.append(
        "| Kind | Book ratios | min | max | mean | spread % | ≤30%? |"
    )
    lines.append("|---|---|---:|---:|---:|---:|---:|")
    for kind in ACTIVE_KINDS:
        s = stability[kind]
        ratios = s["per_book_mean_ratio"]
        per_book_str = ", ".join(
            f"{b}={ratios.get(b, 0.0):.2f}" for b in BOOKS if b in ratios
        )
        spread_str = (
            f"{s['ratio_spread_pct']}%"
            if s["ratio_spread_pct"] is not None else "—"
        )
        ok = "PASS" if s["ratio_spread_le_30pct"] else "FAIL"
        lines.append(
            f"| {kind} | {per_book_str} | {s['ratio_min']} | "
            f"{s['ratio_max']} | {s['ratio_mean']} | {spread_str} | "
            f"**{ok}** |"
        )
    lines.append("")

    # Per-component spread
    lines.append("### Per-kind component-density cross-book spread (close / distant)")
    lines.append("")
    lines.append("| Kind | close-density spread % | distant-density spread % |")
    lines.append("|---|---:|---:|")
    for kind in ACTIVE_KINDS:
        s = stability[kind]
        cs = (
            f"{s['close_spread_pct']}%"
            if s["close_spread_pct"] is not None else "—"
        )
        ds = (
            f"{s['distant_spread_pct']}%"
            if s["distant_spread_pct"] is not None else "—"
        )
        lines.append(f"| {kind} | {cs} | {ds} |")
    lines.append("")

    # Cross-book ordering match
    lines.append("### Cross-book ordering reproduction")
    lines.append("")
    for book, order in result["kind_orderings_per_book"].items():
        lines.append(f"- **{book}** → {' > '.join(order)}")
    lines.append("")
    lines.append(
        f"**Books with identical ordered ranking:** "
        f"{result['kind_orderings_match_count']}/3"
    )
    lines.append(
        f"**Top-1 (closest-camera kind) agreement across books:** "
        f"{result['top1_agreement']} "
        f"(per-book top-1: "
        + ", ".join(
            f"{b}={k}" for b, k in result["top1_per_book"].items()
        )
        + ")"
    )
    lines.append(
        f"**Top-2 3-way intersection:** "
        f"{', '.join(result['top2_3way_intersection']) or 'none'}"
    )
    lines.append("")

    # Total per-book closeness ratio
    lines.append("### Total per-book closeness ratio (across kinds, length-pooled)")
    lines.append("")
    lines.append("| Book | total close/distant ratio |")
    lines.append("|---|---:|")
    for book, v in result["per_book_total_closeness_ratio"].items():
        lines.append(f"| {book} | {v:.2f} |")
    if result["total_closeness_ratio_spread_pct"] is not None:
        lines.append("")
        lines.append(
            f"**Cross-book total-ratio spread:** "
            f"{result['total_closeness_ratio_spread_pct']}% "
            f"(≤30%? **{result['total_closeness_ratio_spread_le_30pct']}**)."
        )
    lines.append("")

    # Distant-marker reality check
    if result["distant_absent_cells"]:
        lines.append("### Distant-marker reality check — cells with distant density < 0.1/100w")
        lines.append("")
        lines.append("| Book | Kind | mean distant/100w |")
        lines.append("|---|---|---:|")
        for c in result["distant_absent_cells"]:
            lines.append(
                f"| {c['book']} | {c['kind']} | "
                f"{c['mean_distant_density_per_100w']:.4f} |"
            )
        lines.append("")
        lines.append(
            f"**Note:** {len(result['distant_absent_cells'])} of "
            f"{len(BOOKS) * len(ACTIVE_KINDS)} (book × kind) cells fall below "
            f"the 0.1/100w threshold for distant-camera markers — meaning "
            f"distant-camera mode is effectively absent in those cells. This is "
            f"itself a finding: Salvatore's prose is heavily close-anchored "
            f"corpus-wide, and the kind-level closeness ranking is largely a "
            f"function of how MUCH close-anchoring fires per kind, not whether "
            f"distant-camera is materially present."
        )
        lines.append("")
    else:
        lines.append("### Distant-marker reality check")
        lines.append("")
        lines.append(
            "All (book × kind) cells fire distant-camera markers above "
            "0.1/100w — distant-camera mode is materially present across "
            "the corpus, not vestigial."
        )
        lines.append("")

    # Distant-cluster signature
    lines.append("### Distant-cluster signature (beats with distant-density > 2× corpus mean)")
    lines.append("")
    lines.append(
        f"**Threshold:** distant_density > 2× corpus mean = "
        f"{result['distant_cluster_threshold_per_100w']:.3f}/100w "
        f"(corpus mean distant = {result['corpus_distant_mean_per_100w']:.3f}/100w, "
        f"σ = {result['corpus_distant_sd_per_100w']:.3f})."
    )
    lines.append("")
    lines.append(
        f"**Beats above threshold:** {result['distant_cluster_n_beats']} "
        f"({result['distant_cluster_share_pct']}% of all analyzed beats)."
    )
    lines.append("")
    if result["distant_cluster_kind_share_pct"]:
        lines.append("**Per-kind share of distant-cluster:**")
        lines.append("")
        lines.append("| Kind | n in cluster | % of cluster |")
        lines.append("|---|---:|---:|")
        kind_n = result["distant_cluster_kind_dist"]
        for kind, share in sorted(
            result["distant_cluster_kind_share_pct"].items(),
            key=lambda kv: kv[1], reverse=True,
        ):
            lines.append(f"| {kind} | {kind_n.get(kind, 0)} | {share}% |")
        lines.append("")
    if result["distant_cluster_book_dist"]:
        lines.append("**Per-book share of distant-cluster:**")
        lines.append("")
        lines.append("| Book | n in cluster |")
        lines.append("|---|---:|")
        for book, n in sorted(
            result["distant_cluster_book_dist"].items(),
            key=lambda kv: kv[1], reverse=True,
        ):
            lines.append(f"| {book} | {n} |")
        lines.append("")

    # Verdict
    lines.append("### Cross-book directional verdict")
    lines.append("")
    lines.append(f"**{overall}** — {result['verdict_summary']}")
    lines.append("")

    # Findings interpretation
    lines.append("### Findings")
    lines.append("")
    findings = _build_findings(result)
    for f in findings:
        lines.append(f"- {f}")
    lines.append("")

    # Proposed levers
    lines.append("### Proposed harness levers")
    lines.append("")
    levers = _build_levers(result)
    for i, l in enumerate(levers, 1):
        lines.append(f"{i}. {l}")
    lines.append("")

    return "\n".join(lines) + "\n"


def _build_findings(result: dict) -> list[str]:
    aggregate = result["aggregate_kind_ranking"]
    stability = result["per_kind_stability"]
    overall = result["overall_verdict"]
    cluster_kinds = result["distant_cluster_kind_share_pct"]

    out: list[str] = []

    rank_str = " > ".join(
        f"{e['kind']} ({e['aggregate_mean_ratio']:.2f})" for e in aggregate
    )
    out.append(
        f"**Aggregate per-kind closeness ranking** (closest → most distant): "
        f"{rank_str}."
    )

    # Hypothesis check
    hypothesized = ["interiority", "action", "dialogue", "description"]
    actual = [e["kind"] for e in aggregate]
    if actual == hypothesized:
        out.append(
            "**Hypothesized ordering interiority > action > dialogue > "
            "description matches the corpus aggregate exactly.** Camera "
            "distance varies systematically with beat-kind in the predicted "
            "direction."
        )
    else:
        # Look for partial matches: top-1 hypothesis (interiority closest)
        if actual and actual[0] == "interiority":
            out.append(
                "**Top-1 hypothesis confirmed:** interiority is the "
                "closest-camera kind — direct cognitive access drives the "
                "highest close-marker density."
            )
        # Bottom-1: description most distant
        if actual and actual[-1] == "description":
            out.append(
                "**Bottom-1 hypothesis confirmed:** description is the "
                "most-distant-camera kind — aerial / existential framing "
                "fires highest here."
            )
        if actual != hypothesized:
            out.append(
                f"**Aggregate ordering deviates from the predicted "
                f"interiority > action > dialogue > description sequence.** "
                f"Actual: {' > '.join(actual)}. Interpret cautiously — the "
                f"deviation tells you which kinds the heuristic mis-models."
            )

    # Closest vs most-distant gap
    if len(aggregate) >= 2:
        top = aggregate[0]
        bot = aggregate[-1]
        if bot["aggregate_mean_ratio"] > 0:
            gap = top["aggregate_mean_ratio"] / bot["aggregate_mean_ratio"]
            out.append(
                f"**Camera-distance gap.** {top['kind']} closeness ratio "
                f"{top['aggregate_mean_ratio']:.2f} ÷ {bot['kind']} "
                f"{bot['aggregate_mean_ratio']:.2f} = **{gap:.2f}×**. "
                f"This is the magnitude of the kind-driven camera "
                f"separation — generated prose that flattens this gap "
                f"(e.g., description beats with closeness ratio matching "
                f"interiority) loses kind-discriminative POV signal."
            )

    # Cross-book ordering finding
    if result["kind_orderings_match_count"] >= 3:
        out.append(
            "**Per-kind ordering reproduces 3/3 books** — the camera-"
            "closeness axis is a stable cross-book voice signature."
        )
    elif result["kind_orderings_match_count"] == 2:
        out.append(
            "**Per-kind ordering reproduces 2/3 books** — borderline-stable; "
            "one book reorders mid-rank."
        )
    else:
        out.append(
            f"**Per-kind ordering does NOT reproduce across books** — "
            f"{result['kind_orderings_match_count']}/3 books match the "
            f"reference ordering. Per-book orderings: "
            + "; ".join(
                f"{b}: {' > '.join(o)}"
                for b, o in result["kind_orderings_per_book"].items()
            )
            + "."
        )

    # Top-1 stability (lower bar)
    if result["top1_agreement"]:
        top1_set = list(result["top1_per_book"].values())
        out.append(
            f"**Top-1 (closest-camera kind) is stable across all 3 books**: "
            f"`{top1_set[0]}` is the closest-camera kind in every book. "
            "Even when full ordering wobbles, the closest pole is reliably "
            "the same kind."
        )
    else:
        out.append(
            f"**Top-1 (closest-camera kind) drifts across books**: "
            + ", ".join(
                f"{b}={k}" for b, k in result["top1_per_book"].items()
            )
            + ". Closest-camera identity is not a stable cross-book pole."
        )

    # Total ratio stability
    total_spread = result["total_closeness_ratio_spread_pct"]
    if total_spread is not None and total_spread <= 30.0:
        out.append(
            f"**Total per-book closeness ratio is stable** "
            f"({total_spread}% spread ≤30%). Per-book totals: "
            + ", ".join(
                f"{b}={v:.2f}"
                for b, v in result["per_book_total_closeness_ratio"].items()
            )
            + ". Salvatore's overall close-vs-distant balance is "
            "consistent across the trilogy."
        )
    elif total_spread is not None:
        out.append(
            f"**Total per-book closeness ratio drifts across books** "
            f"({total_spread}% spread > 30%). Per-book: "
            + ", ".join(
                f"{b}={v:.2f}"
                for b, v in result["per_book_total_closeness_ratio"].items()
            )
            + "."
        )

    # Per-kind spread
    pass_kinds = [
        k for k in ACTIVE_KINDS
        if stability[k]["ratio_spread_le_30pct"]
    ]
    fail_kinds = [
        k for k in ACTIVE_KINDS
        if not stability[k]["ratio_spread_le_30pct"]
        and stability[k]["ratio_spread_pct"] is not None
    ]
    if pass_kinds:
        out.append(
            f"**Cross-book ratio spread ≤30% on:** {', '.join(pass_kinds)}."
        )
    if fail_kinds:
        spreads = ", ".join(
            f"{k} ({stability[k]['ratio_spread_pct']}%)" for k in fail_kinds
        )
        out.append(
            f"**Cross-book ratio spread >30% on:** {spreads} — these kinds "
            f"have closeness drift across the trilogy."
        )

    # Distant-absent finding
    n_absent = len(result["distant_absent_cells"])
    n_total = len(BOOKS) * len(ACTIVE_KINDS)
    if n_absent == 0:
        out.append(
            "**Distant-camera markers fire materially across all (book × "
            "kind) cells** (≥0.1/100w everywhere). Distant-third mode is a "
            "live mode in the prose, not a vestigial signal."
        )
    elif n_absent == n_total:
        out.append(
            "**Distant-camera markers are vestigial across the entire "
            "corpus** (every cell <0.1/100w). Salvatore is uniformly close-"
            "third — the kind-level ratio differences are driven entirely "
            "by close-marker density variation, not by genuine distant-"
            "camera mode-switching."
        )
    else:
        absent_summary = "; ".join(
            f"{c['book']}/{c['kind']} ({c['mean_distant_density_per_100w']:.3f})"
            for c in result["distant_absent_cells"]
        )
        out.append(
            f"**Distant-camera markers are below 0.1/100w in "
            f"{n_absent}/{n_total} cells** ({absent_summary}). In those "
            f"cells the closeness ratio is dominated by the 0.1 floor — "
            f"interpret those rows as 'effectively pure close-camera' "
            f"rather than 'extremely high closeness ratio'."
        )

    # Distant-cluster finding
    if cluster_kinds:
        cluster_top = sorted(
            cluster_kinds.items(), key=lambda kv: kv[1], reverse=True
        )
        top_kind = cluster_top[0]
        if top_kind[0] == "description":
            interp = (
                "This matches the hypothesis: distant-camera mode is the "
                "legitimate function of description beats (aerial / "
                "scene-painting framing)."
            )
        else:
            interp = (
                "**Counter-hypothesis:** description is NOT the cluster "
                f"leader — `{top_kind[0]}` is. Inspect those beats; they "
                f"may be using distant-camera framing in a kind-purpose "
                f"the heuristic doesn't cleanly predict."
            )
        out.append(
            f"**Distant-cluster (>2× corpus distant mean) is dominated by "
            f"`{top_kind[0]}` beats** — {top_kind[1]}% of cluster-beats are "
            f"`{top_kind[0]}`-kind. " + interp
        )

    # Verdict gloss
    if overall == "PASS":
        out.append(
            "**Overall directional gate: PASS.** Camera-closeness per kind "
            "is a stable, kind-discriminative writer-prompt voice prior "
            "across the trilogy."
        )
    elif overall == "PASS_PARTIAL":
        out.append(
            "**Overall directional gate: PASS_PARTIAL.** Stable axis "
            "(top-1 closest-camera kind, or 2/3 ordering) ships as soft "
            "writer-prompt prior; defer absolute ratio targets until the "
            "unstable component is explained or controlled for."
        )
    else:
        out.append(
            "**Overall directional gate: DIVERGE.** Per-kind closeness ratio "
            "is not a reliable cross-book voice prior; only corpus-aggregate "
            "signals usable."
        )

    return out


def _build_levers(result: dict) -> list[str]:
    aggregate = result["aggregate_kind_ranking"]
    stability = result["per_kind_stability"]
    overall = result["overall_verdict"]
    cluster_kinds = result["distant_cluster_kind_share_pct"]
    n_absent = len(result["distant_absent_cells"])
    n_total = len(BOOKS) * len(ACTIVE_KINDS)

    levers: list[str] = []

    # 1. Writer-prompt per-kind closeness prior
    close_targets: dict[str, str] = {}
    distant_targets: dict[str, str] = {}
    for kind in ACTIVE_KINDS:
        s = stability[kind]
        per_book_close = s["per_book_mean_close_density"]
        per_book_distant = s["per_book_mean_distant_density"]
        if per_book_close:
            lo = min(per_book_close.values())
            hi = max(per_book_close.values())
            close_targets[kind] = f"{lo:.2f}–{hi:.2f}"
        if per_book_distant:
            lo = min(per_book_distant.values())
            hi = max(per_book_distant.values())
            distant_targets[kind] = f"{lo:.2f}–{hi:.2f}"
    target_str = "; ".join(
        f"{kind}: close {close_targets.get(kind, '?')}, distant "
        f"{distant_targets.get(kind, '?')}"
        for kind in ACTIVE_KINDS
    )
    if aggregate:
        gap_text = ""
        if len(aggregate) >= 2 and aggregate[-1]["aggregate_mean_ratio"] > 0:
            gap = (
                aggregate[0]["aggregate_mean_ratio"]
                / aggregate[-1]["aggregate_mean_ratio"]
            )
            gap_text = (
                f" The {aggregate[0]['kind']}↔{aggregate[-1]['kind']} "
                f"closeness gap (~{gap:.1f}× in this corpus) is the load-"
                f"bearing camera-distance signature."
            )
    else:
        gap_text = ""
    levers.append(
        f"**Writer-prompt per-kind close/distant density priors (Salvatore "
        f"voice route via `WRITER_GENRE_PACKS`).** Targets per 100w: "
        f"{target_str}.{gap_text}"
    )

    # 2. Lint rule: distant-camera bleed in interiority
    if "interiority" in stability:
        s = stability["interiority"]
        per_book_distant = s["per_book_mean_distant_density"]
        if per_book_distant:
            ceiling = max(per_book_distant.values()) * 1.5
            levers.append(
                f"**Lint rule: distant-camera bleed in interiority.** Flag "
                f"interiority beats where `distant_density > {ceiling:.3f}/100w` "
                f"(150% of per-book maximum, max="
                f"{max(per_book_distant.values()):.3f}). Interiority is the "
                f"closest-camera kind by hypothesis and aggregate finding; "
                f"distant-camera markers in interiority break the kind's "
                f"core function (direct cognitive access) and produce "
                f"narrator-from-outside prose where the POV's interior should "
                f"speak."
            )

    # 3. Lint rule: low-closeness action beat
    if "action" in stability:
        s = stability["action"]
        per_book_close = s["per_book_mean_close_density"]
        if per_book_close:
            floor = min(per_book_close.values()) * 0.6
            levers.append(
                f"**Lint rule: low-closeness action beat.** Flag action "
                f"beats with `close_density < {floor:.2f}/100w` (60% of "
                f"per-book minimum, min={min(per_book_close.values()):.2f}). "
                f"Action beats below this floor have lost the possessive + "
                f"sensory + body-frame signature — likely degraded into "
                f"summary / aerial-view prose. Composes with Pattern 64 "
                f"`low-showing-action-beat` lint."
            )

    # 4. Quality-redraft signal
    levers.append(
        "**Quality-redraft detector `pov-camera-collapse`.** Add to "
        "`src/lint/quality-detectors.ts`: fires when (a) beat `kind ∈ "
        "{interiority, action}`, (b) `closeness_ratio < 1.0` (close < distant + "
        "0.1), (c) distant-density is in the >2× corpus-mean cluster. On "
        "fire, redraft from blank context (per the existing quality-redraft "
        "convention) — distant-camera bleed in close-camera kinds is "
        "structural, not patchable with a local edit."
    )

    # 5. Voice fewshot
    if aggregate:
        closest_kind = aggregate[0]["kind"]
        levers.append(
            f"**Voice fewshot subset.** Pull 8–12 Salvatore beats with the "
            f"highest closeness ratios from the closest-camera kind "
            f"(`{closest_kind}`) into the writer-prompt voice fewshot — "
            f"they're the canonical examples of close-third interiority. "
            f"Mirror with 4–6 description beats with the lowest closeness "
            f"ratios (legitimate distant-camera scene-painting examples) so "
            f"the writer learns both poles, not just the close pole. "
            f"Composes with Pattern 64 fewshot subset."
        )

    # 6. Planner-level: kind-specific camera tag
    levers.append(
        "**Planner-level: tag beats with camera-distance expectation.** "
        "`planning-beats` already emits per-beat `kind`. Add a one-line "
        "camera prompt note keyed off kind:"
        " for interiority — 'closest camera; possessive body-frame + cognitive "
        "anchors; avoid `the man` / `there was` / aerial framing'."
        " For description — 'wider camera ok; aerial / existential framing "
        "permitted; do not lose POV anchor entirely'. "
        "For action — 'close camera; possessive body-frame + sensory verbs "
        "carry the weight'. The planner sees `kind`; this is a free dictionary "
        "lookup at writer-prompt assembly time."
    )

    # 7. Distant-marker reality caveat
    if n_absent == n_total:
        levers.append(
            "**Distant-camera floor: do not fabricate.** Every (book × kind) "
            "cell fires distant markers at <0.1/100w. Salvatore's prose is "
            "uniformly close — do NOT introduce a distant-density floor "
            "lint rule (a `should fire X distant markers per 100w` ceiling "
            "would push generated prose AWAY from the corpus signature)."
        )
    elif n_absent > 0:
        levers.append(
            f"**Distant-marker floor caveat: respect the absent cells.** "
            f"{n_absent}/{n_total} (book × kind) cells fall below 0.1/100w "
            f"distant markers. Lint rules that target distant-density "
            f"floors must EXEMPT those kinds (interpret 'distant-camera "
            f"effectively absent' as the corpus norm for those slots, not "
            f"as a defect)."
        )

    # Verdict-conditioned ship status
    if overall == "PASS":
        levers.append(
            "**Ship status:** PASS — these levers move from DRAFT to ship-"
            "ready. Roll into `WRITER_GENRE_PACKS` Salvatore-cluster "
            "fantasy alongside Patterns 53 / 55 / 57 / 64."
        )
    elif overall == "PASS_PARTIAL":
        levers.append(
            "**Ship status:** PASS_PARTIAL — ship the stable signal "
            "(top-1 closest-camera kind, or 2/3 ordering) as a soft "
            "writer-prompt prior; defer absolute density floors until the "
            "unstable component is explained or controlled for."
        )
    else:
        levers.append(
            "**Ship status:** DIVERGE — do NOT codify per-kind closeness "
            "targets. Aggregate-only signals usable; per-kind signals not "
            "yet shippable."
        )

    return levers


def build_roadmap_row(result: dict, commit: str) -> str:
    overall = result["overall_verdict"]
    aggregate = result["aggregate_kind_ranking"]
    stability = result["per_kind_stability"]
    rank_str = " > ".join(
        f"{e['kind']}({e['aggregate_mean_ratio']:.2f})" for e in aggregate
    )

    pass_kinds = [
        k for k in ACTIVE_KINDS
        if stability[k]["ratio_spread_le_30pct"]
    ]
    fail_kinds = [
        k for k in ACTIVE_KINDS
        if not stability[k]["ratio_spread_le_30pct"]
        and stability[k]["ratio_spread_pct"] is not None
    ]
    fail_str = ", ".join(
        f"{k}({stability[k]['ratio_spread_pct']}%)" for k in fail_kinds
    ) if fail_kinds else "none"

    n_absent = len(result["distant_absent_cells"])
    n_total = len(BOOKS) * len(ACTIVE_KINDS)
    distant_note = (
        f"distant-marker absent in {n_absent}/{n_total} cells"
        if n_absent > 0 else "distant markers materially present in all cells"
    )

    cluster_top = ""
    if result["distant_cluster_kind_share_pct"]:
        top = max(
            result["distant_cluster_kind_share_pct"].items(),
            key=lambda kv: kv[1],
        )
        cluster_top = (
            f"distant-cluster ({result['distant_cluster_share_pct']}% of beats) "
            f"top-kind {top[0]}({top[1]}%)"
        )
    else:
        cluster_top = "no distant-cluster"

    findings = (
        f"aggregate closeness ranking {rank_str}; "
        f"per-kind ordering reproduces {result['kind_orderings_match_count']}/3 books; "
        f"top-1 closest-kind agreement={result['top1_agreement']}; "
        f"total per-book closeness-ratio spread="
        + (
            f"{result['total_closeness_ratio_spread_pct']}%"
            if result["total_closeness_ratio_spread_pct"] is not None
            else "—"
        )
        + f"; ≤30% spread PASS={','.join(pass_kinds) or 'none'}; "
        f">30% spread on {fail_str}; "
        f"{distant_note}; {cluster_top}"
    )

    lever = (
        "writer-prompt per-kind close/distant density targets via "
        "`WRITER_GENRE_PACKS`; lint rule `distant_camera_bleed_in_interiority` "
        "(interiority beat with distant-density above ceiling = camera-"
        "collapse anti-pattern); lint rule `low-closeness-action-beat` "
        "(action beat with close-density below floor = degraded-summary "
        "anti-pattern); quality-redraft detector `pov-camera-collapse` for "
        "interiority+action; voice fewshot top-decile-closeness-ratio beat "
        "subset; planner prompt with kind-specific camera-distance directive; "
        "respect distant-absent cells (no distant-density floor)"
    )

    if overall == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship per-kind close/distant density priors + "
            "distant-camera-bleed lint + quality-redraft detector"
        )
    elif overall == "PASS_PARTIAL":
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship top-1 closest-kind / 2-of-3 ordering as soft prior + "
            "distant-bleed lint; defer absolute density floors pending "
            "unstable-component explanation"
        )
    elif overall == "DIVERGE":
        verdict_short = "HOLD"
        recommend = (
            "do not codify per-kind closeness targets; revisit at finer "
            "granularity (per-character / per-scene-pace bucket)"
        )
    else:
        verdict_short = "KILL"
        recommend = "no signal at this granularity"

    row = (
        f"| {PATTERN_ID} | **{PATTERN_NAME}** (`{commit}`): {findings} | "
        f"{lever} | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | "
        f"**{verdict_short}** — {recommend} |\n"
    )
    return row


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------


def main() -> int:
    print(f"=== Pattern {PATTERN_ID}: {PATTERN_NAME} ===")
    print()

    commit = commit_short()
    beats = load_beats()
    print(f"loaded {len(beats)} beats; commit={commit}")
    print()

    result = analyze(beats)

    # Terse stdout summary
    print("--- per-book per-kind mean closeness ratio ---")
    for book in BOOKS:
        if book not in result["cells"]:
            continue
        for kind in ACTIVE_KINDS:
            if kind not in result["cells"][book]:
                continue
            c = result["cells"][book][kind]
            print(
                f"  {book}/{kind}: n={c['n_beats']:>4d}  "
                f"close={c['mean_close_density_per_100w']:.3f}/100w  "
                f"distant={c['mean_distant_density_per_100w']:.3f}/100w  "
                f"ratio={c['mean_closeness_ratio']:.2f}"
            )
    print()

    print("--- aggregate per-kind closeness ranking (closest → most distant) ---")
    for entry in result["aggregate_kind_ranking"]:
        print(f"  {entry['kind']:>12s}: {entry['aggregate_mean_ratio']:.2f}")
    print()

    print(
        f"per-kind cross-book ordering: "
        f"{result['kind_orderings_match_count']}/3 books match"
    )
    for book, order in result["kind_orderings_per_book"].items():
        print(f"  {book}: {' > '.join(order)}")
    print()

    print(f"top-1 closest-camera kind agreement: {result['top1_agreement']}")
    for book, kind in result["top1_per_book"].items():
        print(f"  {book}: top-1 = {kind}")
    print()

    print("--- per-kind cross-book ratio spread ---")
    for kind in ACTIVE_KINDS:
        s = result["per_kind_stability"][kind]
        ok = "PASS" if s["ratio_spread_le_30pct"] else "FAIL"
        print(
            f"  {kind:>12s}: spread={s['ratio_spread_pct']}% "
            f"({ok}; min={s['ratio_min']}, max={s['ratio_max']})"
        )
    print()

    print("--- per-book total closeness ratio ---")
    for book, v in result["per_book_total_closeness_ratio"].items():
        print(f"  {book}: {v:.2f}")
    print(
        f"  cross-book total spread: "
        f"{result['total_closeness_ratio_spread_pct']}% "
        f"(≤30%? {result['total_closeness_ratio_spread_le_30pct']})"
    )
    print()

    print("--- distant-marker reality check ---")
    n_absent = len(result["distant_absent_cells"])
    n_total = len(BOOKS) * len(ACTIVE_KINDS)
    if n_absent == 0:
        print("  all cells fire distant markers ≥0.1/100w")
    else:
        print(
            f"  {n_absent}/{n_total} cells <0.1/100w distant; "
            "interpret as effectively pure close-camera"
        )
        for c in result["distant_absent_cells"]:
            print(
                f"    {c['book']}/{c['kind']}: "
                f"{c['mean_distant_density_per_100w']:.4f}/100w"
            )
    print()

    print(
        f"distant-cluster: {result['distant_cluster_n_beats']} beats "
        f"({result['distant_cluster_share_pct']}% above 2× corpus mean "
        f"{result['corpus_distant_mean_per_100w']:.3f}/100w)"
    )
    if result["distant_cluster_kind_share_pct"]:
        for k, v in sorted(
            result["distant_cluster_kind_share_pct"].items(),
            key=lambda kv: kv[1], reverse=True,
        ):
            print(f"  cluster-kind {k}: {v}%")
    print()

    print(f"=== VERDICT: {result['overall_verdict']} ===")
    print(f"  {result['verdict_summary']}")
    print()

    # Build payload, write timestamped JSON
    payload = {
        "pattern_id": PATTERN_ID,
        "pattern_name": PATTERN_NAME,
        "commit": commit,
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        "regex_patterns": {
            "close_possessive": CLOSE_POSSESSIVE_RE.pattern,
            "close_sensory": CLOSE_SENSORY_RE.pattern,
            "close_cognitive": CLOSE_COGNITIVE_RE.pattern,
            "distant_label": DISTANT_LABEL_RE.pattern,
            "distant_existential": DISTANT_EXISTENTIAL_RE.pattern,
            "distant_aerial": DISTANT_AERIAL_RE.pattern,
        },
        "methodology": {
            "ratio_floor": 0.1,
            "ratio_formula": "close_density / (distant_density + 0.1)",
            "active_kinds": list(ACTIVE_KINDS),
            "books": list(BOOKS),
            "cross_book_gate": {
                "PASS": "ordering 3/3 + total per-book closeness-ratio spread ≤30%",
                "PASS_PARTIAL": "ordering 3/3 (with total-ratio spread fail) OR 2/3 ordering",
                "DIVERGE": "ordering unstable",
            },
            "distant_absent_threshold_per_100w": 0.1,
        },
        **result,
    }
    out_path = write_timestamped_json(
        OUT_DIR,
        slug="camera-closeness",
        content=payload,
        prefix="crystal_shard",
    )
    print(f"JSON written: {out_path}")

    # Atomic-append conclusions section
    section_md = build_conclusions_section(result, out_path, commit)
    atomic_append_section(CONCLUSIONS_PATH, section_md)
    print(f"Appended section: {CONCLUSIONS_PATH}")

    # Atomic insert roadmap row
    row_md = build_roadmap_row(result, commit)
    atomic_insert_row_before_anchor(
        ROADMAP_PATH,
        row_md,
        anchor="\n**Sequencing",
    )
    print(f"Inserted roadmap row: {ROADMAP_PATH}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
