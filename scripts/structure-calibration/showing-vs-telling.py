#!/usr/bin/env python3
"""Pattern 64 — Showing-vs-telling proxy via concrete sensory verbs vs abstract
reporting / cognitive verbs in the Salvatore Icewind Dale 3-book corpus.

Hypothesis
----------
"Showing" prose uses concrete sensory + motion verbs (saw, heard, felt, gripped,
swung, lurched). "Telling" prose uses abstract reporting / cognitive verbs
(knew, understood, realized, decided, was angry, felt sad). The per-beat-kind
ratio is a writer-prompt voice prior:

  * action      → high showing (concrete sensory + motion verbs dominate)
  * description → moderate showing (sensory-perceiving verbs)
  * dialogue    → bounded by quoted text; ratio mostly inherited from tag/beat narration
  * interiority → high telling (abstract cognitive verbs are the LEGITIMATE function
                  of interiority — but excessive telling is a craft anti-pattern)

The per-kind ratio + cross-book stability is what we measure.

Methodology — pure-compute lexicon density
------------------------------------------
Three lexicons, all word-boundary-anchored, case-insensitive:

  SHOWING    — concrete sensory + motion verbs (saw, heard, felt, gripped,
               swung, struck, leapt, ran, turned ...)
  TELLING    — abstract reporting / cognitive verbs (knew, realized, understood,
               decided, thought, considered, believed, seemed, appeared ...)
  STATE_BE   — state-of-being verbs (was, were, is, are, am, be, been, being)
               — tracked SEPARATELY because they're pervasive in normal English
               and would dominate any aggregated "telling" count even when
               their use is mechanical (it was, there was, he was). Tracked
               so we can report `was`-as-percentage as a passive/state-heavy
               prose proxy without distorting the showing-to-telling ratio.

Per beat:
  showing_density   = 100 * showing_hits   / words
  telling_density   = 100 * telling_hits   / words
  state_be_density  = 100 * state_be_hits  / words
  ratio_show_tell   = showing_density / (telling_density + 0.1)  (0.1 floor to avoid div/0)

Note the 0.1 floor. A beat with telling_density = 0.0 and showing_density = 2.0
gives ratio = 2.0 / 0.1 = 20.0; a beat with telling_density = 1.0 and
showing_density = 2.0 gives ratio = 2.0 / 1.1 ≈ 1.82. The floor compresses
zero-telling beats into a finite range while preserving ordering — the 0.1
choice is the spec convention.

Special-case: `felt` is BOTH a showing verb (concrete physical/touch sensation)
AND a telling-frame when followed by a clause-marker (`felt that`, `felt sure`,
`felt certain`). The script counts the bare-verb hit (`felt`) into SHOWING but
ALSO checks the explicit clause-marker phrases `felt that` / `felt sure` /
`felt certain` and reclassifies those into TELLING by subtracting from
showing and adding to telling. This way we don't double-count.

Per (book, kind) we aggregate both per-beat means and length-pooled densities.

Cross-book gate (per spec)
--------------------------
  PASS         — per-kind showing-to-telling ratio ORDERING reproduces 3/3 books
                 AND per-kind ratio cross-book spread ≤30% on each kind
  PASS_PARTIAL — 2/3 books reproduce OR ordering 3/3 but spread fails on ≥1 kind
  DIVERGE      — unstable ordering across books

Outputs
-------
  - JSON timestamped artifact
        novels/salvatore-icewind-dale/structure-calibration/
            crystal_shard.<YYYYMMDDTHHMMSS>.showing-vs-telling.json
  - Atomic-append section to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert row to docs/harness-tuning-roadmap.md before the
    `\\n**Sequencing` anchor (fcntl flock; pattern number = 64)
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


PATTERN_ID = 64
PATTERN_NAME = "Showing-vs-telling proxy (concrete vs abstract verb ratio)"

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

ACTIVE_KINDS = ("action", "dialogue", "interiority", "description")
BOOKS = ("crystal_shard", "streams_of_silver", "halflings_gem")

# ---------------------------------------------------------------------------
# Lexicons
# ---------------------------------------------------------------------------

SHOWING_LEXICON: list[str] = [
    # sight-perception verbs
    "saw", "see", "seen", "looked", "watch", "watched", "glanced", "peered",
    "stared", "gazed",
    # sound-perception verbs
    "heard", "listened", "sound", "sounded", "echoed",
    # touch-perception + grasp verbs
    "felt", "gripped", "grasped", "clutched", "held", "pulled", "pushed",
    "shoved", "struck",
    # combat / motion verbs (high concrete physical action)
    "swung", "slashed", "thrust", "parried", "blocked", "dodged", "leapt",
    "jumped",
    # body-motion verbs
    "fell", "dropped", "rolled", "crawled", "ran", "walked", "strode",
    "stalked", "raced",
    # body-orientation verbs
    "turned", "spun", "twisted", "bent", "leaned", "crouched", "lunged",
]

# TELLING — abstract cognitive / reporting verbs. Per the spec we add the
# explicit "felt that / felt sure / felt certain" clause-marker phrases as a
# SEPARATE bucket; the bare `felt` is in SHOWING above. The clause-marker
# variants are subtracted from SHOWING (since they were already counted there
# as `felt`) and added into TELLING.
TELLING_LEXICON: list[str] = [
    "knew", "know", "knows", "knowing",
    "realized", "realizes", "realizing",
    "understood", "understands", "understanding",
    "decided", "decides", "deciding",
    "thought", "thinks", "thinking", "considered", "considers", "considering",
    "believed", "believes", "believing",
    "seemed", "seems", "seeming",
    "appeared", "appears", "appearing",
]

# State-of-being verbs — tracked separately
STATE_BE_LEXICON: list[str] = [
    "was", "were", "is", "are", "am", "be", "been", "being",
]

# Phrases that count as telling (clause-marker `felt`)
FELT_CLAUSE_MARKERS: list[str] = [
    "felt that",
    "felt sure",
    "felt certain",
]

# Compile word-boundary regex for each lexicon, case-insensitive.
def _compile_lexicon(terms: list[str]) -> re.Pattern:
    return re.compile(
        r"\b(?:" + "|".join(re.escape(t) for t in terms) + r")\b",
        flags=re.IGNORECASE,
    )


SHOWING_RE = _compile_lexicon(SHOWING_LEXICON)
TELLING_RE = _compile_lexicon(TELLING_LEXICON)
STATE_BE_RE = _compile_lexicon(STATE_BE_LEXICON)

# `felt that|felt sure|felt certain` — case-insensitive, allow flexible whitespace
FELT_CLAUSE_RE = re.compile(
    r"\bfelt\s+(?:that|sure|certain)\b",
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


def count_lexicons(text: str) -> tuple[int, int, int, int]:
    """Return (showing, telling, state_be, felt_clause).

    `showing` already has `felt_clause` SUBTRACTED out (because bare `felt`
    is counted in SHOWING_LEXICON, and the clause-marker variants are
    re-routed to telling).
    `telling` already has `felt_clause` ADDED in.
    `felt_clause` is reported separately for transparency.
    """
    showing = len(SHOWING_RE.findall(text))
    telling = len(TELLING_RE.findall(text))
    state_be = len(STATE_BE_RE.findall(text))
    felt_clause = len(FELT_CLAUSE_RE.findall(text))

    # Reclassify `felt that|sure|certain` from showing -> telling
    showing_adj = max(0, showing - felt_clause)
    telling_adj = telling + felt_clause
    return showing_adj, telling_adj, state_be, felt_clause


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


def analyze(beats: list[dict]) -> dict:
    # Per-beat, accumulate densities into (book, kind) cells.
    per_beat: list[dict] = []
    cell_show: dict[tuple[str, str], list[float]] = defaultdict(list)
    cell_tell: dict[tuple[str, str], list[float]] = defaultdict(list)
    cell_state: dict[tuple[str, str], list[float]] = defaultdict(list)
    cell_ratio: dict[tuple[str, str], list[float]] = defaultdict(list)

    cell_show_count: dict[tuple[str, str], int] = defaultdict(int)
    cell_tell_count: dict[tuple[str, str], int] = defaultdict(int)
    cell_state_count: dict[tuple[str, str], int] = defaultdict(int)
    cell_words: dict[tuple[str, str], int] = defaultdict(int)
    cell_n: dict[tuple[str, str], int] = defaultdict(int)
    cell_felt_clause: dict[tuple[str, str], int] = defaultdict(int)

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
        show_n, tell_n, state_n, felt_clause_n = count_lexicons(text)
        show_d = density_per_100w(show_n, words)
        tell_d = density_per_100w(tell_n, words)
        state_d = density_per_100w(state_n, words)
        ratio = show_d / (tell_d + 0.1)

        per_beat.append({
            "book": book,
            "chapter": b.get("chapter"),
            "scene_id": b.get("scene_id"),
            "beat_idx": b.get("beat_idx"),
            "kind": kind,
            "words": words,
            "showing_hits": show_n,
            "telling_hits": tell_n,
            "state_be_hits": state_n,
            "felt_clause_hits": felt_clause_n,
            "showing_density_per_100w": round(show_d, 4),
            "telling_density_per_100w": round(tell_d, 4),
            "state_be_density_per_100w": round(state_d, 4),
            "ratio_show_tell": round(ratio, 4),
        })

        cell_show[(book, kind)].append(show_d)
        cell_tell[(book, kind)].append(tell_d)
        cell_state[(book, kind)].append(state_d)
        cell_ratio[(book, kind)].append(ratio)
        cell_show_count[(book, kind)] += show_n
        cell_tell_count[(book, kind)] += tell_n
        cell_state_count[(book, kind)] += state_n
        cell_words[(book, kind)] += words
        cell_n[(book, kind)] += 1
        cell_felt_clause[(book, kind)] += felt_clause_n

    # Aggregate cell stats
    cells: dict[str, dict[str, dict]] = defaultdict(dict)
    for (book, kind), n_beats in cell_n.items():
        words = cell_words[(book, kind)]
        cells[book][kind] = {
            "n_beats": n_beats,
            "words": words,
            "showing_hits_total": cell_show_count[(book, kind)],
            "telling_hits_total": cell_tell_count[(book, kind)],
            "state_be_hits_total": cell_state_count[(book, kind)],
            "felt_clause_hits_total": cell_felt_clause[(book, kind)],
            "mean_showing_density_per_100w": round(mean(cell_show[(book, kind)]), 4),
            "mean_telling_density_per_100w": round(mean(cell_tell[(book, kind)]), 4),
            "mean_state_be_density_per_100w": round(mean(cell_state[(book, kind)]), 4),
            "mean_ratio_show_tell": round(mean(cell_ratio[(book, kind)]), 4),
            # Length-pooled (totals / total words). The pooled ratio is computed
            # from the length-pooled densities + 0.1 floor for parity.
            "pooled_showing_density_per_100w": round(
                density_per_100w(cell_show_count[(book, kind)], words), 4),
            "pooled_telling_density_per_100w": round(
                density_per_100w(cell_tell_count[(book, kind)], words), 4),
            "pooled_state_be_density_per_100w": round(
                density_per_100w(cell_state_count[(book, kind)], words), 4),
            "pooled_ratio_show_tell": round(
                density_per_100w(cell_show_count[(book, kind)], words)
                / (density_per_100w(cell_tell_count[(book, kind)], words) + 0.1),
                4),
        }

    # Per-kind ranking by mean ratio show-to-tell. Each book gets an ordered
    # list of kinds (most-showing-first → most-telling-first).
    kind_ranking: dict[str, list[tuple[str, float]]] = {}
    for book in BOOKS:
        if book not in cells:
            continue
        scores = sorted(
            ((k, cells[book][k]["mean_ratio_show_tell"]) for k in cells[book]),
            key=lambda kv: kv[1],
            reverse=True,
        )
        kind_ranking[book] = scores

    # Per-kind cross-book ratio stability
    per_kind_ratios: dict[str, dict[str, float]] = defaultdict(dict)
    per_kind_show_density: dict[str, dict[str, float]] = defaultdict(dict)
    per_kind_tell_density: dict[str, dict[str, float]] = defaultdict(dict)
    per_kind_state_density: dict[str, dict[str, float]] = defaultdict(dict)
    for book in BOOKS:
        if book not in cells:
            continue
        for k in cells[book]:
            per_kind_ratios[k][book] = cells[book][k]["mean_ratio_show_tell"]
            per_kind_show_density[k][book] = cells[book][k]["mean_showing_density_per_100w"]
            per_kind_tell_density[k][book] = cells[book][k]["mean_telling_density_per_100w"]
            per_kind_state_density[k][book] = cells[book][k]["mean_state_be_density_per_100w"]

    def _spread_ratio(values: list[float]) -> float:
        """Max/min - 1 expressed as fraction. Returns 0 if min==0."""
        if not values:
            return 0.0
        v_min = min(values)
        v_max = max(values)
        if v_min <= 0:
            # Indeterminate; treat as huge spread
            return float("inf")
        return v_max / v_min - 1.0

    per_kind_stability: dict[str, dict] = {}
    for k in ACTIVE_KINDS:
        ratios = list(per_kind_ratios.get(k, {}).values())
        show_vals = list(per_kind_show_density.get(k, {}).values())
        tell_vals = list(per_kind_tell_density.get(k, {}).values())
        state_vals = list(per_kind_state_density.get(k, {}).values())
        spread = _spread_ratio(ratios)
        per_kind_stability[k] = {
            "per_book_mean_ratio": per_kind_ratios.get(k, {}),
            "per_book_mean_showing_density": per_kind_show_density.get(k, {}),
            "per_book_mean_telling_density": per_kind_tell_density.get(k, {}),
            "per_book_mean_state_be_density": per_kind_state_density.get(k, {}),
            "ratio_min": round(min(ratios), 4) if ratios else None,
            "ratio_max": round(max(ratios), 4) if ratios else None,
            "ratio_mean": round(mean(ratios), 4) if ratios else None,
            "ratio_spread_pct": (
                round(spread * 100.0, 2) if spread != float("inf") else None
            ),
            "ratio_spread_le_30pct": bool(spread <= 0.30) if spread != float("inf") else False,
            "showing_spread_pct": round(_spread_ratio(show_vals) * 100.0, 2) if show_vals and _spread_ratio(show_vals) != float("inf") else None,
            "telling_spread_pct": round(_spread_ratio(tell_vals) * 100.0, 2) if tell_vals and _spread_ratio(tell_vals) != float("inf") else None,
            "state_be_spread_pct": round(_spread_ratio(state_vals) * 100.0, 2) if state_vals and _spread_ratio(state_vals) != float("inf") else None,
        }

    # Cross-book ordering reproduction: does the ordered ranking of kinds by
    # ratio reproduce in 3/3 books?
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

    # Verdict
    spreads_ok = all(
        per_kind_stability[k]["ratio_spread_le_30pct"]
        for k in ACTIVE_KINDS
        if per_kind_stability[k]["ratio_spread_pct"] is not None
    )
    if match >= 3 and spreads_ok:
        overall_verdict = "PASS"
        verdict_summary = (
            "Per-kind showing-to-telling ratio ordering reproduces 3/3 books "
            "AND per-kind ratio spread ≤30% on all kinds."
        )
    elif match >= 3:
        overall_verdict = "PASS_PARTIAL"
        verdict_summary = (
            "Per-kind ordering reproduces 3/3 books but cross-book ratio spread "
            "exceeds 30% on at least one kind."
        )
    elif match == 2:
        overall_verdict = "PASS_PARTIAL"
        verdict_summary = (
            "Per-kind ordering reproduces 2/3 books — borderline-stable signal."
        )
    else:
        overall_verdict = "DIVERGE"
        verdict_summary = (
            "Per-kind ordering is unstable across books — the ratio is not a "
            "reliable cross-book voice prior at the kind granularity."
        )

    # Telling-cluster signature: beats with telling_density > 2× corpus mean
    show_arr = [b["showing_density_per_100w"] for b in per_beat]
    tell_arr = [b["telling_density_per_100w"] for b in per_beat]
    state_arr = [b["state_be_density_per_100w"] for b in per_beat]

    corpus_show_mean = mean(show_arr) if show_arr else 0.0
    corpus_tell_mean = mean(tell_arr) if tell_arr else 0.0
    corpus_state_mean = mean(state_arr) if state_arr else 0.0
    corpus_show_sd = pstdev(show_arr) if show_arr else 0.0
    corpus_tell_sd = pstdev(tell_arr) if tell_arr else 0.0
    corpus_state_sd = pstdev(state_arr) if state_arr else 0.0

    threshold = 2.0 * corpus_tell_mean
    cluster_beats = [b for b in per_beat if b["telling_density_per_100w"] > threshold]
    cluster_kind_dist: dict[str, int] = defaultdict(int)
    cluster_book_dist: dict[str, int] = defaultdict(int)
    for b in cluster_beats:
        cluster_kind_dist[b["kind"]] += 1
        cluster_book_dist[b["book"]] += 1

    # Was/were-as-percentage check
    was_density_per_book: dict[str, float] = {}
    for book in BOOKS:
        if book not in cells:
            continue
        total_state = sum(cells[book][k]["state_be_hits_total"] for k in cells[book])
        total_words = sum(cells[book][k]["words"] for k in cells[book])
        if total_words > 0:
            was_density_per_book[book] = round(100.0 * total_state / total_words, 4)
    was_vals = list(was_density_per_book.values())
    was_spread_pct = (
        round((max(was_vals) / min(was_vals) - 1.0) * 100.0, 2)
        if was_vals and min(was_vals) > 0 else None
    )

    # Per-kind ratio rank: which kind has highest showing? lowest?
    kind_ratio_aggregate: dict[str, float] = {}
    for k in ACTIVE_KINDS:
        vals = list(per_kind_ratios.get(k, {}).values())
        kind_ratio_aggregate[k] = round(mean(vals), 4) if vals else 0.0
    aggregate_kind_ranking = sorted(
        kind_ratio_aggregate.items(),
        key=lambda kv: kv[1],
        reverse=True,
    )

    return {
        "books": list(BOOKS),
        "active_kinds": list(ACTIVE_KINDS),
        "skipped_beats": skipped,
        "n_beats_used": len(per_beat),
        "cells": cells,
        "kind_ranking_per_book": {
            b: [{"kind": k, "mean_ratio_show_tell": round(v, 4)} for k, v in arr]
            for b, arr in kind_ranking.items()
        },
        "kind_orderings_per_book": {b: list(o) for b, o in orderings.items()},
        "kind_orderings_match_count": match,
        "aggregate_kind_ranking": [
            {"kind": k, "aggregate_mean_ratio": v} for k, v in aggregate_kind_ranking
        ],
        "per_kind_stability": per_kind_stability,
        "corpus_showing_mean_per_100w": round(corpus_show_mean, 4),
        "corpus_telling_mean_per_100w": round(corpus_tell_mean, 4),
        "corpus_state_be_mean_per_100w": round(corpus_state_mean, 4),
        "corpus_showing_sd_per_100w": round(corpus_show_sd, 4),
        "corpus_telling_sd_per_100w": round(corpus_tell_sd, 4),
        "corpus_state_be_sd_per_100w": round(corpus_state_sd, 4),
        "telling_cluster_threshold_per_100w": round(threshold, 4),
        "telling_cluster_n_beats": len(cluster_beats),
        "telling_cluster_share_pct": round(
            100.0 * len(cluster_beats) / max(1, len(per_beat)), 2),
        "telling_cluster_kind_dist": dict(cluster_kind_dist),
        "telling_cluster_book_dist": dict(cluster_book_dist),
        "telling_cluster_kind_share_pct": {
            k: round(100.0 * v / len(cluster_beats), 2)
            for k, v in cluster_kind_dist.items()
        } if cluster_beats else {},
        "was_density_per_book_per_100w": was_density_per_book,
        "was_density_spread_pct": was_spread_pct,
        "overall_verdict": overall_verdict,
        "verdict_summary": verdict_summary,
    }


# ---------------------------------------------------------------------------
# Conclusions section + roadmap row
# ---------------------------------------------------------------------------


def build_conclusions_section(result: dict, json_path: Path, commit: str) -> str:
    cells = result["cells"]
    stability = result["per_kind_stability"]
    cluster_kinds = result["telling_cluster_kind_share_pct"]
    cluster_books = result["telling_cluster_book_dist"]
    aggregate_rank = result["aggregate_kind_ranking"]
    overall = result["overall_verdict"]

    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_ID}: {PATTERN_NAME}")
    lines.append("")
    lines.append(
        f"_Pure-compute lexicon density across 3 books × 4 active beat-kinds. "
        f"Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")

    lines.append("### Methodology")
    lines.append("")
    lines.append(
        "Three word-boundary, case-insensitive lexicons (full lists in JSON):"
    )
    lines.append("")
    lines.append(
        f"- **SHOWING** ({len(SHOWING_LEXICON)} terms) — concrete sensory + "
        "motion verbs (saw / heard / felt / gripped / swung / struck / leapt / "
        "ran / turned ...)."
    )
    lines.append(
        f"- **TELLING** ({len(TELLING_LEXICON)} terms) — abstract reporting / "
        "cognitive verbs (knew / realized / understood / decided / thought / "
        "considered / believed / seemed / appeared ...)."
    )
    lines.append(
        f"- **STATE_BE** ({len(STATE_BE_LEXICON)} terms) — state-of-being verbs "
        "(was / were / is / are / am / be / been / being). Tracked SEPARATELY: "
        "they're pervasive in normal English and would dominate any aggregated "
        "telling count even when their use is mechanical (`it was`, `there was`)."
    )
    lines.append("")
    lines.append(
        "**`felt`-disambiguation.** `felt` is in SHOWING (concrete touch/sensation), "
        "but the explicit clause-marker phrases `felt that` / `felt sure` / "
        "`felt certain` are an interiority-frame and re-routed: subtracted from "
        "showing, added to telling. Bare `felt X` (e.g., `felt the cold steel`) "
        "stays in showing."
    )
    lines.append("")
    lines.append(
        "Per beat: `showing_density = 100 × showing_hits / words`, similarly for "
        "telling and state_be. **Showing-to-telling ratio per beat = "
        "`showing_density / (telling_density + 0.1)`** (0.1 floor avoids "
        "division-by-zero on telling-free beats while preserving ordering)."
    )
    lines.append("")
    lines.append(
        f"Skipped: {result['skipped_beats']} beats (singleton "
        f"`stakes_recalibration` kind + zero-word/empty-text). "
        f"n={result['n_beats_used']} beats analyzed."
    )
    lines.append("")

    # Per-book per-kind table (mean ratio + densities)
    lines.append("### Per-book per-kind densities (mean per beat)")
    lines.append("")
    lines.append("| book | kind | n | words | showing/100w | telling/100w | state_be/100w | ratio show/tell |")
    lines.append("|---|---|---:|---:|---:|---:|---:|---:|")
    for book in BOOKS:
        if book not in cells:
            continue
        for kind in ACTIVE_KINDS:
            if kind not in cells[book]:
                continue
            c = cells[book][kind]
            lines.append(
                f"| {book} | {kind} | {c['n_beats']} | {c['words']:,} | "
                f"{c['mean_showing_density_per_100w']:.3f} | "
                f"{c['mean_telling_density_per_100w']:.3f} | "
                f"{c['mean_state_be_density_per_100w']:.3f} | "
                f"**{c['mean_ratio_show_tell']:.2f}** |"
            )
    lines.append("")

    # Per-book per-kind ranking
    lines.append("### Per-book showing-bias ranking (most-showing → most-telling, by mean ratio)")
    lines.append("")
    for book in BOOKS:
        if book not in result["kind_ranking_per_book"]:
            continue
        order = result["kind_ranking_per_book"][book]
        order_str = " > ".join(
            f"{e['kind']} ({e['mean_ratio_show_tell']:.2f})" for e in order
        )
        lines.append(f"- **{book}** → {order_str}")
    lines.append("")

    # Aggregate kind ranking
    lines.append("### Aggregate per-kind ratio ranking (cross-book mean of mean-per-beat ratios)")
    lines.append("")
    lines.append("| Kind | Aggregate ratio show/tell | Interpretation |")
    lines.append("|---|---:|---|")
    interpretation = {
        "action": "should be highest (concrete physical verbs dominate)",
        "description": "moderate — sensory-perceiving verbs",
        "dialogue": "bounded by quoted text; reflects narration around tags",
        "interiority": "should be lowest (abstract cognitive verbs are the legitimate function)",
    }
    for entry in aggregate_rank:
        k = entry["kind"]
        v = entry["aggregate_mean_ratio"]
        lines.append(f"| {k} | {v:.2f} | {interpretation.get(k, '')} |")
    lines.append("")

    # Cross-book stability
    lines.append("### Per-kind cross-book stability")
    lines.append("")
    lines.append("| Kind | Book ratios | min | max | mean | spread % | ≤30% spread? |")
    lines.append("|---|---|---:|---:|---:|---:|---:|")
    for kind in ACTIVE_KINDS:
        s = stability[kind]
        ratios = s["per_book_mean_ratio"]
        per_book_str = ", ".join(f"{b}={ratios.get(b, 'n/a'):.2f}" for b in BOOKS if b in ratios)
        spread_str = f"{s['ratio_spread_pct']}%" if s["ratio_spread_pct"] is not None else "—"
        ok = "PASS" if s["ratio_spread_le_30pct"] else "FAIL"
        lines.append(
            f"| {kind} | {per_book_str} | {s['ratio_min']} | {s['ratio_max']} | "
            f"{s['ratio_mean']} | {spread_str} | **{ok}** |"
        )
    lines.append("")

    # Per-component spread
    lines.append("### Per-kind component-density cross-book spread (showing / telling / state_be)")
    lines.append("")
    lines.append("| Kind | showing spread % | telling spread % | state_be spread % |")
    lines.append("|---|---:|---:|---:|")
    for kind in ACTIVE_KINDS:
        s = stability[kind]
        lines.append(
            f"| {kind} | "
            f"{s['showing_spread_pct'] if s['showing_spread_pct'] is not None else '—'} | "
            f"{s['telling_spread_pct'] if s['telling_spread_pct'] is not None else '—'} | "
            f"{s['state_be_spread_pct'] if s['state_be_spread_pct'] is not None else '—'} |"
        )
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
    lines.append("")

    # Telling-cluster signature
    lines.append("### Telling-cluster signature")
    lines.append("")
    lines.append(
        f"**Threshold:** beat `telling_density > 2× corpus mean = "
        f"{result['telling_cluster_threshold_per_100w']:.3f}/100w` "
        f"(corpus mean telling = {result['corpus_telling_mean_per_100w']:.3f}/100w, "
        f"σ = {result['corpus_telling_sd_per_100w']:.3f})."
    )
    lines.append("")
    lines.append(
        f"**Beats above threshold:** {result['telling_cluster_n_beats']} "
        f"({result['telling_cluster_share_pct']}% of all analyzed beats)."
    )
    lines.append("")
    if cluster_kinds:
        lines.append("**Per-kind share of telling-cluster:**")
        lines.append("")
        lines.append("| Kind | n in cluster | % of cluster |")
        lines.append("|---|---:|---:|")
        kind_n = result["telling_cluster_kind_dist"]
        for kind, share in sorted(cluster_kinds.items(), key=lambda kv: kv[1], reverse=True):
            lines.append(f"| {kind} | {kind_n.get(kind, 0)} | {share}% |")
        lines.append("")
    if cluster_books:
        lines.append("**Per-book share of telling-cluster:**")
        lines.append("")
        lines.append("| Book | n in cluster |")
        lines.append("|---|---:|")
        for book, n in sorted(cluster_books.items(), key=lambda kv: kv[1], reverse=True):
            lines.append(f"| {book} | {n} |")
        lines.append("")

    # was/were-as-percentage check
    lines.append("### `was`/`were`/state-of-being density per book")
    lines.append("")
    lines.append("| Book | state_be density (per 100w) |")
    lines.append("|---|---:|")
    for book, v in result["was_density_per_book_per_100w"].items():
        lines.append(f"| {book} | {v:.3f} |")
    if result["was_density_spread_pct"] is not None:
        lines.append("")
        lines.append(
            f"**Cross-book state_be spread:** {result['was_density_spread_pct']}%."
        )
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
    cluster_kinds = result["telling_cluster_kind_share_pct"]
    overall = result["overall_verdict"]

    out: list[str] = []

    # Aggregate ordering finding
    rank_str = " > ".join(f"{e['kind']} ({e['aggregate_mean_ratio']:.2f})" for e in aggregate)
    out.append(
        f"**Aggregate per-kind ratio ordering** (most-showing → most-telling): {rank_str}."
    )

    # Action vs interiority gap finding
    action_ratio = next((e["aggregate_mean_ratio"] for e in aggregate if e["kind"] == "action"), None)
    inter_ratio = next((e["aggregate_mean_ratio"] for e in aggregate if e["kind"] == "interiority"), None)
    if action_ratio and inter_ratio and inter_ratio > 0:
        gap = action_ratio / inter_ratio
        out.append(
            f"**Action vs interiority gap.** action ratio {action_ratio:.2f} ÷ "
            f"interiority ratio {inter_ratio:.2f} = **{gap:.2f}×**. The two beat-kinds "
            f"sit on opposite ends of the showing-vs-telling axis — action is the "
            f"showing-pole, interiority is the telling-pole, with a {gap:.1f}× "
            f"separation. This is the load-bearing voice signature of the corpus."
        )

    # Description vs dialogue interpretation
    desc_ratio = next((e["aggregate_mean_ratio"] for e in aggregate if e["kind"] == "description"), None)
    dial_ratio = next((e["aggregate_mean_ratio"] for e in aggregate if e["kind"] == "dialogue"), None)
    if desc_ratio is not None and dial_ratio is not None:
        if desc_ratio > dial_ratio:
            out.append(
                f"**Description outranks dialogue on showing-bias** ({desc_ratio:.2f} vs "
                f"{dial_ratio:.2f}) — dialogue beats inherit telling from the narration "
                f"AROUND the quotes (he wondered / she thought) more than description beats do."
            )
        else:
            out.append(
                f"**Dialogue outranks description on showing-bias** ({dial_ratio:.2f} vs "
                f"{desc_ratio:.2f}) — dialogue tag-narration is denser in concrete physical "
                f"verbs (she gripped / he turned) than the static-state language of description."
            )

    # Cross-book ordering finding
    if result["kind_orderings_match_count"] >= 3:
        out.append(
            f"**Per-kind ordering reproduces 3/3 books** — the showing-vs-telling "
            f"axis is a stable cross-book voice signature, not corpus-specific noise."
        )
    elif result["kind_orderings_match_count"] == 2:
        out.append(
            f"**Per-kind ordering reproduces 2/3 books** — borderline-stable; one book "
            f"breaks the ranking."
        )
    else:
        out.append(
            f"**Per-kind ordering does NOT reproduce across books** — the per-kind "
            f"ratio is unstable; only aggregate-level signals are usable."
        )

    # Per-kind spread finding
    pass_kinds = [k for k in ACTIVE_KINDS if stability[k]["ratio_spread_le_30pct"]]
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
            f"have ratio drift across the trilogy."
        )

    # Telling-cluster finding
    if cluster_kinds:
        cluster_top = sorted(cluster_kinds.items(), key=lambda kv: kv[1], reverse=True)
        top_kind = cluster_top[0]
        if top_kind[0] == "interiority":
            interp = (
                "This matches expectation: the legitimate function of "
                "interiority IS abstract cognitive language; the cluster is "
                "a sanity check, not a craft anti-pattern (provided density "
                "is bounded — see lever rules)."
            )
        else:
            interp = (
                "**Counter-finding to the simple craft heuristic.** The naïve "
                "expectation is that interiority would dominate the telling-"
                "cluster (interiority's legitimate function is abstract "
                "cognitive language). Instead `"
                + top_kind[0]
                + "` tops the cluster — these are the load-bearing 'tell, "
                "don't show' rewrite candidates because their kind-purpose is "
                "NOT to deliver cognition. For dialogue specifically, telling-"
                "cluster membership often means the AROUND-quote narration is "
                "doing inferential work the speech itself should do (he "
                "wondered why she had refused / she realized what he meant)."
            )
        out.append(
            f"**Telling-cluster (>2× corpus telling mean) is dominated by "
            f"`{top_kind[0]}` beats** — {top_kind[1]}% of cluster-beats are "
            f"`{top_kind[0]}`-kind. " + interp
        )
        non_inter_share = sum(
            s for k, s in cluster_kinds.items() if k != "interiority"
        )
        if "interiority" in cluster_kinds:
            out.append(
                f"**Beats outside interiority that fall in the telling-cluster** "
                f"({non_inter_share:.1f}% of cluster) are the harness's high-"
                f"priority anti-pattern target — action / dialogue / description "
                f"beats with telling-density >2× corpus mean are the load-bearing "
                f"'tell, don't show' rewrite candidates. The interiority share of "
                f"the cluster ({cluster_kinds.get('interiority', 0)}%) is "
                f"legitimate-tell territory and should not be flagged."
            )

    # State-be finding
    state_spread = result["was_density_spread_pct"]
    if state_spread is not None and state_spread <= 30:
        out.append(
            f"**State-of-being (`was`/`were`/etc.) density is stable across books** "
            f"({state_spread}% spread ≤30%). Per-book densities: "
            + ", ".join(f"{b}={v:.2f}/100w" for b, v in result["was_density_per_book_per_100w"].items())
            + ". This is a pervasive prose-rhythm baseline, not a tellingness signal — "
            "Salvatore's narrator uses state-of-being verbs at a stable rate that "
            "should NOT be aggressively reduced (over-aggressive rewriting risks "
            "Yoda-prose)."
        )
    elif state_spread is not None:
        out.append(
            f"**State-of-being density drifts across books** "
            f"({state_spread}% spread > 30%). Per-book: "
            + ", ".join(f"{b}={v:.2f}/100w" for b, v in result["was_density_per_book_per_100w"].items())
            + "."
        )

    # Verdict gloss
    if overall == "PASS":
        out.append(
            "**Overall directional gate: PASS.** The showing-vs-telling proxy is a "
            "stable, kind-discriminative writer-prompt prior across the trilogy."
        )
    elif overall == "PASS_PARTIAL":
        out.append(
            "**Overall directional gate: PASS_PARTIAL.** Stable axis ships as soft "
            "writer-prompt prior; defer the unstable component."
        )
    else:
        out.append(
            "**Overall directional gate: DIVERGE.** Per-kind ratio is not a reliable "
            "cross-book voice prior; only corpus-aggregate signals usable."
        )

    return out


def _build_levers(result: dict) -> list[str]:
    aggregate = result["aggregate_kind_ranking"]
    stability = result["per_kind_stability"]
    cells = result["cells"]
    cluster_kinds = result["telling_cluster_kind_share_pct"]
    overall = result["overall_verdict"]

    levers: list[str] = []

    # 1. Writer-prompt per-kind ratio prior (soft)
    show_targets: dict[str, str] = {}
    tell_targets: dict[str, str] = {}
    for kind in ACTIVE_KINDS:
        s = stability[kind]
        per_book_show = s["per_book_mean_showing_density"]
        per_book_tell = s["per_book_mean_telling_density"]
        if per_book_show:
            lo = min(per_book_show.values())
            hi = max(per_book_show.values())
            show_targets[kind] = f"{lo:.2f}–{hi:.2f}"
        if per_book_tell:
            lo = min(per_book_tell.values())
            hi = max(per_book_tell.values())
            tell_targets[kind] = f"{lo:.2f}–{hi:.2f}"
    target_str = "; ".join(
        f"{kind}: showing {show_targets.get(kind, '?')}, telling {tell_targets.get(kind, '?')}"
        for kind in ACTIVE_KINDS
    )
    levers.append(
        f"**Writer-prompt per-kind density priors (Salvatore voice route via "
        f"`WRITER_GENRE_PACKS`).** Targets per 100w: {target_str}. The action↔"
        f"interiority gap (~{(aggregate[0]['aggregate_mean_ratio'] / aggregate[-1]['aggregate_mean_ratio']):.1f}× "
        f"in this corpus) is the load-bearing voice signature — generated prose "
        f"that flattens this gap (e.g., interiority beats with showing-density "
        f"matching action) loses the kind-discriminative voice signal."
    )

    # 2. Lint rule: telling-cluster outside interiority
    levers.append(
        f"**Lint rule: telling-cluster outside interiority.** Flag any beat where "
        f"`telling_density > 2× corpus mean ({result['telling_cluster_threshold_per_100w']:.2f}/100w)` "
        f"AND `kind ≠ interiority`. Action / dialogue / description beats above "
        f"this threshold are the canonical 'tell, don't show' rewrite targets — "
        f"per the cluster analysis, ~"
        f"{sum(s for k, s in cluster_kinds.items() if k != 'interiority'):.0f}% of "
        f"the corpus's >2×-telling cluster IS interiority (legitimate use); the "
        f"remainder is the actionable defect."
    )

    # 3. Lint rule: low-showing action beat
    show_action = stability["action"]["per_book_mean_showing_density"]
    if show_action:
        floor = min(show_action.values()) * 0.6  # 40% below per-book minimum
        levers.append(
            f"**Lint rule: low-showing action beat.** Flag action-kind beats with "
            f"showing-density < {floor:.2f}/100w (60% of per-book minimum, "
            f"min={min(show_action.values()):.2f}). Action beats below this floor "
            f"have lost the concrete physical-verb signature — likely degraded into "
            f"summary / 'after the fight ended' telling, the highest-impact "
            f"action-prose anti-pattern."
        )

    # 4. Quality-redraft signal
    levers.append(
        f"**Quality-redraft detector.** Add a `low-showing-bias` defect to "
        f"`src/lint/quality-detectors.ts` that fires when (a) beat `kind ∈ "
        f"{{action, description}}`, (b) `ratio_show_tell < 1.0`, (c) telling-density "
        f"is in the >2× corpus-mean cluster. On fire, redraft from blank context "
        f"(per the existing quality-redraft gate convention) rather than critique-"
        f"based rewrite — telling-heavy prose typically can't be patched with a "
        f"local edit; it needs structural replacement."
    )

    # 5. Voice fewshot subset
    levers.append(
        f"**Voice fewshot subset.** Pull 8–12 Salvatore beats with the highest "
        f"showing-to-telling ratios (corpus top-decile per-beat ratio) into the "
        f"writer-prompt voice fewshot — they're the canonical examples of "
        f"showing-pole prose. Mirror with 4–6 high-quality interiority beats that "
        f"sit in the cluster (legitimate-telling examples) so the writer learns "
        f"both poles, not just the showing pole."
    )

    # 6. State_be policy
    levers.append(
        f"**State-of-being density: leave alone.** Cross-book spread on `was`/`were`/"
        f"etc. is "
        + (f"{result['was_density_spread_pct']}%" if result["was_density_spread_pct"] is not None else "n/a")
        + (
            " (≤30%)" if (result["was_density_spread_pct"] is not None and result["was_density_spread_pct"] <= 30) else " (>30%)"
        )
        + " — the corpus uses state-of-being verbs at a stable, baseline-pervasive "
        f"rate (~{result['corpus_state_be_mean_per_100w']:.2f}/100w corpus mean). "
        f"Do NOT introduce a `was`-density floor or ceiling lint rule — they're "
        f"prose-rhythm baseline and over-aggressive reduction breaks readability."
    )

    # 7. Planner-level: tag interiority beats explicitly
    levers.append(
        f"**Planner-level: tag interiority beats with cognitive-density expectation.** "
        f"`planning-scenes` already emits per-entry `kind`. Add a planner-level "
        f"prompt note for interiority entries: 'this entry's purpose is direct "
        f"cognitive access; abstract cognitive verbs (knew / realized / "
        f"understood) are the legitimate vehicle, but each cognitive verb should "
        f"be paired with a concrete sensory anchor (gesture, sensation, fragmentary "
        f"image) so the interior moment grounds in the body.' This is the "
        f"compositional fix to the 'pure-telling interiority' anti-pattern."
    )

    # Verdict-conditioned bonus lever
    if overall == "PASS":
        levers.append(
            "**Ship status:** PASS — these levers move from DRAFT to ship-ready. "
            "Roll into `WRITER_GENRE_PACKS` Salvatore-cluster fantasy alongside "
            "Patterns 53 / 55 / 57."
        )
    elif overall == "PASS_PARTIAL":
        levers.append(
            "**Ship status:** PASS_PARTIAL — ship the stable signal (per-kind "
            "ordering or top-1 kind extreme) as a soft writer-prompt prior; "
            "defer absolute density floors until the unstable component is "
            "explained or controlled for."
        )
    else:
        levers.append(
            "**Ship status:** DIVERGE — do NOT codify per-kind ratio targets. "
            "Aggregate-only signals usable; per-kind signals not yet shippable."
        )

    return levers


def build_roadmap_row(result: dict, commit: str) -> str:
    overall = result["overall_verdict"]
    aggregate = result["aggregate_kind_ranking"]
    stability = result["per_kind_stability"]
    rank_str = " > ".join(f"{e['kind']}({e['aggregate_mean_ratio']:.2f})" for e in aggregate)

    pass_kinds = [k for k in ACTIVE_KINDS if stability[k]["ratio_spread_le_30pct"]]
    fail_kinds = [
        k for k in ACTIVE_KINDS
        if not stability[k]["ratio_spread_le_30pct"]
        and stability[k]["ratio_spread_pct"] is not None
    ]
    fail_str = ", ".join(
        f"{k}({stability[k]['ratio_spread_pct']}%)" for k in fail_kinds
    ) if fail_kinds else "none"

    findings = (
        f"aggregate ratio ranking {rank_str}; "
        f"per-kind ordering reproduces {result['kind_orderings_match_count']}/3 books; "
        f"≤30% spread PASS={','.join(pass_kinds) or 'none'}; "
        f">30% spread on {fail_str}; "
        f"telling-cluster ({result['telling_cluster_share_pct']}% of beats above 2× corpus mean) "
        f"dominated by interiority-kind ("
        f"{result['telling_cluster_kind_share_pct'].get('interiority', 0)}% of cluster)"
    )

    lever = (
        "writer-prompt per-kind showing/telling density targets via "
        "`WRITER_GENRE_PACKS`; lint rule `telling_cluster_outside_interiority` "
        "(non-interiority beat with telling-density >2× corpus mean = rewrite "
        "candidate); lint rule `low-showing-action-beat` (action beat with "
        "showing-density below floor = degraded-summary anti-pattern); "
        "quality-redraft detector `low-showing-bias` for action+description; "
        "voice fewshot top-decile-showing-ratio beat subset; planner prompt "
        "for interiority beats requires sensory anchor pair-up; leave state-"
        "of-being density alone (prose-rhythm baseline)"
    )

    if overall == "PASS":
        verdict_short = "SHIP"
        recommend = "ship per-kind density priors + lint rules + quality-redraft detector"
    elif overall == "PASS_PARTIAL":
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship per-kind ordering as soft prior + telling-cluster lint; defer "
            "absolute density floors pending unstable-component explanation"
        )
    elif overall == "DIVERGE":
        verdict_short = "HOLD"
        recommend = (
            "do not codify per-kind ratio targets; revisit at finer granularity "
            "(per-character / per-scene-pace bucket)"
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
    print("--- per-book per-kind mean ratio show/tell ---")
    for book in BOOKS:
        if book not in result["cells"]:
            continue
        for kind in ACTIVE_KINDS:
            if kind not in result["cells"][book]:
                continue
            c = result["cells"][book][kind]
            print(
                f"  {book}/{kind}: n={c['n_beats']:>4d}  "
                f"show={c['mean_showing_density_per_100w']:.3f}/100w  "
                f"tell={c['mean_telling_density_per_100w']:.3f}/100w  "
                f"state_be={c['mean_state_be_density_per_100w']:.3f}/100w  "
                f"ratio={c['mean_ratio_show_tell']:.2f}"
            )
    print()

    print("--- aggregate per-kind ranking (most-showing → most-telling) ---")
    for entry in result["aggregate_kind_ranking"]:
        print(f"  {entry['kind']:>12s}: {entry['aggregate_mean_ratio']:.2f}")
    print()

    print(f"per-kind cross-book ordering: {result['kind_orderings_match_count']}/3 books match")
    for book, order in result["kind_orderings_per_book"].items():
        print(f"  {book}: {' > '.join(order)}")
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

    print(
        f"telling-cluster: {result['telling_cluster_n_beats']} beats "
        f"({result['telling_cluster_share_pct']}% above 2× corpus mean "
        f"{result['corpus_telling_mean_per_100w']:.3f}/100w)"
    )
    if result["telling_cluster_kind_share_pct"]:
        for k, v in sorted(result["telling_cluster_kind_share_pct"].items(), key=lambda kv: kv[1], reverse=True):
            print(f"  cluster-kind {k}: {v}%")
    print()

    print("--- state_be density per book ---")
    for book, v in result["was_density_per_book_per_100w"].items():
        print(f"  {book}: {v:.3f}/100w")
    if result["was_density_spread_pct"] is not None:
        print(f"  cross-book spread: {result['was_density_spread_pct']}%")
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
        "lexicons": {
            "showing": SHOWING_LEXICON,
            "telling": TELLING_LEXICON,
            "state_be": STATE_BE_LEXICON,
            "felt_clause_markers": FELT_CLAUSE_MARKERS,
        },
        "methodology": {
            "ratio_floor": 0.1,
            "ratio_formula": "showing_density / (telling_density + 0.1)",
            "felt_disambiguation": (
                "bare 'felt' counts as showing; 'felt that|sure|certain' "
                "counts as telling (subtracted from showing, added to telling)"
            ),
            "active_kinds": list(ACTIVE_KINDS),
            "books": list(BOOKS),
            "cross_book_gate": {
                "PASS": "ordering 3/3 + per-kind spread ≤30% on all kinds",
                "PASS_PARTIAL": "ordering 3/3 OR 2/3 (or with one spread fail)",
                "DIVERGE": "ordering unstable",
            },
        },
        **result,
    }
    out_path = write_timestamped_json(
        OUT_DIR,
        slug="showing-vs-telling",
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
