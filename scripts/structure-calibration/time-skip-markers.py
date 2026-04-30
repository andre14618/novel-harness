"""
Pattern 54 — Time-skip / temporal-leap marker distribution
(3-book Icewind Dale corpus).

Pure-compute regex pass over `novels/salvatore-icewind-dale/beats.jsonl`
+ `novels/salvatore-icewind-dale/scenes.jsonl`.

Hypothesis: Salvatore uses a stable lexicon of time-skip markers
("hours later", "the next morning", "by dawn") and they cluster at
specific structural positions — chapter openings, scene-break
(`bounded`) boundaries, and chapter quartile transitions. The
time-skip lexicon is a writer-prompt prior; the distribution gives a
planner cue ("expect time-skip markers at scene breaks, especially
chapter-open").

Methodology:
  - Marker lexicon: 3 categories (EXPLICIT_DURATION / ABSOLUTE_TIME /
    ELAPSED_NARRATIVE) with case-insensitive word-boundary regexes.
  - Per-beat: count marker occurrences (each marker counts
    independently, all hits sum across markers).
  - Per-marker totals across the trilogy + per-book breakdown.
  - Structural-position analysis:
    * chapter-open beats (first beat of a `chapter-open` scene)
    * scene-bounded beats (first beat of a `bounded` scene)
    * scene-unbounded beats (first beat of an `unbounded` scene)
    * scene-close beats (first beat of a `chapter-close` scene)
    * chapter-internal beats (everything else, i.e. NOT first beat of
      any scene)
    Compute marker-rate (per beat, per 1k words) for each position.
    Ratio: scene-boundary / chapter-internal — is the lever there?
  - Per-kind distribution: marker rate per beat-kind.
  - Top markers per book (top-5 by raw count).
  - Cross-book directional gate (PASS / PASS_PARTIAL / DIVERGE /
    KILL).
"""

import json
import re
import os
import datetime
from collections import Counter, defaultdict

CORPUS_DIR = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale"
BEATS_PATH = os.path.join(CORPUS_DIR, "beats.jsonl")
SCENES_PATH = os.path.join(CORPUS_DIR, "scenes.jsonl")
OUT_DIR = os.path.join(CORPUS_DIR, "structure-calibration")

TIMESTAMP = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S")
OUT_PATH = os.path.join(OUT_DIR, f"crystal_shard.{TIMESTAMP}.time-skip-markers.json")

# ---------- Marker lexicon ----------
# Each marker is its own regex token. Word-boundary anchored,
# case-insensitive. Multiple markers in one beat each count
# independently.

EXPLICIT_DURATION = [
    "hours later",
    "days later",
    "weeks later",
    "months later",
    "years later",
    "a few hours later",
    "a few days",
    "a few minutes later",
    "many hours",
    "many days",
    "many years",
    "some hours later",
    "some days",
    "some time later",
    "half an hour later",
    "half a day",
    "an hour later",
    "a moment later",
]

ABSOLUTE_TIME = [
    "the next morning",
    "the next day",
    "the next night",
    "the next afternoon",
    "the following morning",
    "the following day",
    "by dawn",
    "by morning",
    "by noon",
    "by sunset",
    "by nightfall",
    "by midnight",
    "at dawn",
    "at dusk",
    "at sunset",
    "at midnight",
    "at sunrise",
    "early the next",
    "late that night",
    "that evening",
    "that night",
    "in the morning",
    "in the evening",
]

ELAPSED_NARRATIVE = [
    "for hours",
    "for days",
    "for weeks",
    "for months",
    "for years",
    "throughout the night",
    "all night",
    "all day",
    "all morning",
    "long after",
    "long before",
]

# Additions for misses spotted in pre-scan:
#   None — initial lexicon kept as-is. Documented additions list.
LEXICON_ADDITIONS = []

CATEGORY_MAP = {}
for m in EXPLICIT_DURATION:
    CATEGORY_MAP[m] = "EXPLICIT_DURATION"
for m in ABSOLUTE_TIME:
    CATEGORY_MAP[m] = "ABSOLUTE_TIME"
for m in ELAPSED_NARRATIVE:
    CATEGORY_MAP[m] = "ELAPSED_NARRATIVE"

ALL_MARKERS = EXPLICIT_DURATION + ABSOLUTE_TIME + ELAPSED_NARRATIVE


def compile_marker(marker):
    # Word-boundary on both ends, multi-word phrases get \b on first/last word.
    # Use re.escape on the marker text and wrap with word boundaries.
    escaped = re.escape(marker)
    return re.compile(r"\b" + escaped + r"\b", re.IGNORECASE)


COMPILED = [(m, compile_marker(m)) for m in ALL_MARKERS]


def count_markers_in_text(text):
    """Return list of (marker, count) for each marker that fires.
    Each occurrence counted (re.findall length)."""
    if not text:
        return []
    out = []
    for marker, rx in COMPILED:
        hits = rx.findall(text)
        if hits:
            out.append((marker, len(hits)))
    return out


# ---------- Load corpus ----------
beats = []
with open(BEATS_PATH, "r", encoding="utf-8") as f:
    for line in f:
        beats.append(json.loads(line))

scenes = []
with open(SCENES_PATH, "r", encoding="utf-8") as f:
    for line in f:
        scenes.append(json.loads(line))

# scene_id -> scene boundary
scene_boundary = {s["scene_id"]: s.get("boundary") for s in scenes}

books_in_order = ["crystal_shard", "streams_of_silver", "halflings_gem"]


def safe_pct(num, den):
    return round(100.0 * num / den, 2) if den else 0.0


def safe_per_1k(num, den_words):
    return round(1000.0 * num / den_words, 3) if den_words else 0.0


# ---------- Per-beat marker pass ----------
labelled = []  # one record per beat with marker counts and structural meta.

for b in beats:
    text = b.get("text", "") or ""
    summary = b.get("summary", "") or ""
    haystack = f"{summary}\n{text}"

    hits = count_markers_in_text(haystack)
    total_hits = sum(c for _, c in hits)
    cats = Counter()
    for marker, c in hits:
        cats[CATEGORY_MAP[marker]] += c

    sid = b.get("scene_id")
    s_boundary = scene_boundary.get(sid)
    is_first_in_scene = b.get("beat_idx") == 0

    # Position label:
    #   chapter-open      -> first beat of a chapter-open scene
    #   scene-bounded     -> first beat of a bounded scene
    #   scene-unbounded   -> first beat of an unbounded scene
    #   chapter-close     -> first beat of a chapter-close scene
    #   chapter-internal  -> any non-first beat of a scene
    if is_first_in_scene:
        if s_boundary == "chapter-open":
            position = "chapter-open"
        elif s_boundary == "bounded":
            position = "scene-bounded"
        elif s_boundary == "unbounded":
            position = "scene-unbounded"
        elif s_boundary == "chapter-close":
            position = "chapter-close"
        else:
            position = f"first-of-scene:{s_boundary}"
    else:
        position = "chapter-internal"

    labelled.append({
        "scene_id": sid,
        "book": b.get("book"),
        "chapter": b.get("chapter"),
        "kind": b.get("kind"),
        "words": b.get("words", 0),
        "beat_idx": b.get("beat_idx"),
        "is_first_in_scene": is_first_in_scene,
        "scene_boundary": s_boundary,
        "position": position,
        "hits": hits,
        "total_hits": total_hits,
        "cat_counts": dict(cats),
    })


# ---------- Aggregations ----------
def per_marker_totals(labels):
    out = Counter()
    for r in labels:
        for marker, c in r["hits"]:
            out[marker] += c
    return out


def per_book_marker_breakdown(labels):
    out = {}
    for book in books_in_order:
        rows = [r for r in labels if r["book"] == book]
        n_beats = len(rows)
        total_words = sum(r["words"] for r in rows)
        marker_counter = Counter()
        cat_counter = Counter()
        beats_with_any = 0
        for r in rows:
            if r["total_hits"] > 0:
                beats_with_any += 1
            for marker, c in r["hits"]:
                marker_counter[marker] += c
                cat_counter[CATEGORY_MAP[marker]] += c
        total_hits = sum(marker_counter.values())
        out[book] = {
            "n_beats": n_beats,
            "total_words": total_words,
            "total_marker_hits": total_hits,
            "beats_with_any_marker": beats_with_any,
            "beats_with_any_pct": safe_pct(beats_with_any, n_beats),
            "markers_per_1k_words": safe_per_1k(total_hits, total_words),
            "markers_per_beat": round(total_hits / n_beats, 4) if n_beats else 0.0,
            "by_category": dict(cat_counter),
            "by_category_per_1k": {
                cat: safe_per_1k(c, total_words)
                for cat, c in cat_counter.items()
            },
            "marker_counts": dict(marker_counter),
            "top_markers": marker_counter.most_common(10),
        }
    return out


def per_position_analysis(labels):
    """Marker rate per structural position. Includes per-book breakdowns."""
    positions = [
        "chapter-open",
        "scene-bounded",
        "scene-unbounded",
        "chapter-close",
        "chapter-internal",
    ]
    out_aggregate = {}
    out_per_book = {b: {} for b in books_in_order}

    for pos in positions:
        rows = [r for r in labels if r["position"] == pos]
        n_beats = len(rows)
        total_words = sum(r["words"] for r in rows)
        total_hits = sum(r["total_hits"] for r in rows)
        beats_with_any = sum(1 for r in rows if r["total_hits"] > 0)
        out_aggregate[pos] = {
            "n_beats": n_beats,
            "total_words": total_words,
            "total_marker_hits": total_hits,
            "beats_with_any_marker": beats_with_any,
            "beats_with_any_pct": safe_pct(beats_with_any, n_beats),
            "markers_per_1k_words": safe_per_1k(total_hits, total_words),
            "markers_per_beat": round(total_hits / n_beats, 4) if n_beats else 0.0,
        }

        for book in books_in_order:
            brows = [r for r in rows if r["book"] == book]
            bn = len(brows)
            bw = sum(r["words"] for r in brows)
            bh = sum(r["total_hits"] for r in brows)
            ba = sum(1 for r in brows if r["total_hits"] > 0)
            out_per_book[book][pos] = {
                "n_beats": bn,
                "total_words": bw,
                "total_marker_hits": bh,
                "beats_with_any_marker": ba,
                "beats_with_any_pct": safe_pct(ba, bn),
                "markers_per_1k_words": safe_per_1k(bh, bw),
                "markers_per_beat": round(bh / bn, 4) if bn else 0.0,
            }

    # Boundary vs internal ratio (combine all "first-in-scene" categories
    # into a single "scene-boundary" rate, then divide by internal).
    def boundary_vs_internal(scope):
        boundary_h = sum(
            scope[p]["total_marker_hits"]
            for p in ["chapter-open", "scene-bounded", "scene-unbounded", "chapter-close"]
        )
        boundary_n = sum(
            scope[p]["n_beats"]
            for p in ["chapter-open", "scene-bounded", "scene-unbounded", "chapter-close"]
        )
        boundary_w = sum(
            scope[p]["total_words"]
            for p in ["chapter-open", "scene-bounded", "scene-unbounded", "chapter-close"]
        )
        internal = scope["chapter-internal"]
        return {
            "boundary": {
                "n_beats": boundary_n,
                "total_words": boundary_w,
                "total_marker_hits": boundary_h,
                "markers_per_1k_words": safe_per_1k(boundary_h, boundary_w),
                "markers_per_beat": round(boundary_h / boundary_n, 4) if boundary_n else 0.0,
            },
            "internal": {
                "n_beats": internal["n_beats"],
                "total_words": internal["total_words"],
                "total_marker_hits": internal["total_marker_hits"],
                "markers_per_1k_words": internal["markers_per_1k_words"],
                "markers_per_beat": internal["markers_per_beat"],
            },
            "ratio_boundary_over_internal_per_1k": round(
                safe_per_1k(boundary_h, boundary_w) / internal["markers_per_1k_words"], 3
            ) if internal["markers_per_1k_words"] else None,
            "ratio_boundary_over_internal_per_beat": round(
                (boundary_h / boundary_n) / internal["markers_per_beat"], 3
            ) if (boundary_n and internal["markers_per_beat"]) else None,
        }

    out_aggregate["__boundary_vs_internal__"] = boundary_vs_internal(out_aggregate)
    for book in books_in_order:
        out_per_book[book]["__boundary_vs_internal__"] = boundary_vs_internal(out_per_book[book])

    return {
        "aggregate": out_aggregate,
        "per_book": out_per_book,
    }


def per_kind_analysis(labels):
    out = {}
    kinds = sorted({r["kind"] for r in labels if r["kind"]})
    for kind in kinds:
        rows = [r for r in labels if r["kind"] == kind]
        n_beats = len(rows)
        total_words = sum(r["words"] for r in rows)
        total_hits = sum(r["total_hits"] for r in rows)
        beats_with_any = sum(1 for r in rows if r["total_hits"] > 0)
        out[kind] = {
            "n_beats": n_beats,
            "total_words": total_words,
            "total_marker_hits": total_hits,
            "beats_with_any_marker": beats_with_any,
            "beats_with_any_pct": safe_pct(beats_with_any, n_beats),
            "markers_per_1k_words": safe_per_1k(total_hits, total_words),
            "markers_per_beat": round(total_hits / n_beats, 4) if n_beats else 0.0,
        }
    return out


def per_kind_per_book_analysis(labels):
    """Marker rate per beat-kind, per book — to see if the kind
    distribution holds cross-book."""
    out = {}
    kinds = sorted({r["kind"] for r in labels if r["kind"]})
    for book in books_in_order:
        out[book] = {}
        for kind in kinds:
            rows = [r for r in labels if r["book"] == book and r["kind"] == kind]
            n_beats = len(rows)
            total_words = sum(r["words"] for r in rows)
            total_hits = sum(r["total_hits"] for r in rows)
            out[book][kind] = {
                "n_beats": n_beats,
                "total_words": total_words,
                "total_marker_hits": total_hits,
                "markers_per_1k_words": safe_per_1k(total_hits, total_words),
                "markers_per_beat": round(total_hits / n_beats, 4) if n_beats else 0.0,
            }
    return out


def top_markers_per_book(labels, k=5):
    out = {}
    for book in books_in_order:
        c = Counter()
        for r in labels:
            if r["book"] != book:
                continue
            for marker, n in r["hits"]:
                c[marker] += n
        out[book] = c.most_common(k)
    return out


def cross_book_stability(per_book, top_per_book):
    """Per the gate spec:
      PASS — top-3 marker set overlaps >=2 across all 3 books AND
             density per 1k words stable (<=30% spread max-vs-min)
             AND structural-position ratio (boundary > internal)
             holds in 3/3
      PASS_PARTIAL — 2/3 books reproduce
      DIVERGE — different lexicons or unstable density
      KILL — no consistent signal
    """
    # Top-3 set per book.
    top3_sets = {b: {m for m, _ in top_per_book[b][:3]} for b in books_in_order}
    pairwise_overlap = {}
    pairs = [
        ("crystal_shard", "streams_of_silver"),
        ("crystal_shard", "halflings_gem"),
        ("streams_of_silver", "halflings_gem"),
    ]
    for a, b in pairs:
        pairwise_overlap[f"{a} vs {b}"] = {
            "overlap_count": len(top3_sets[a] & top3_sets[b]),
            "shared": sorted(top3_sets[a] & top3_sets[b]),
            "only_in_first": sorted(top3_sets[a] - top3_sets[b]),
            "only_in_second": sorted(top3_sets[b] - top3_sets[a]),
        }
    # Three-way intersection
    three_way = top3_sets["crystal_shard"] & top3_sets["streams_of_silver"] & top3_sets["halflings_gem"]
    # Stability gate: top-3 overlaps >=2 across all 3 books (every pair has >=2 shared)
    pairs_with_2plus = sum(1 for v in pairwise_overlap.values() if v["overlap_count"] >= 2)

    # Density stability per 1k words.
    densities = [per_book[b]["markers_per_1k_words"] for b in books_in_order]
    d_min, d_max = min(densities), max(densities)
    spread = (d_max - d_min) / d_min if d_min else float("inf")
    density_stable = spread <= 0.30

    return {
        "top3_per_book": {b: list(top3_sets[b]) for b in books_in_order},
        "pairwise_top3_overlap": pairwise_overlap,
        "three_way_top3_intersection": sorted(three_way),
        "pairs_with_2plus_overlap": pairs_with_2plus,
        "densities_per_1k": dict(zip(books_in_order, densities)),
        "density_min": d_min,
        "density_max": d_max,
        "density_spread_fraction_max_over_min": round(spread, 3),
        "density_stable_le_30pct": density_stable,
    }


# ---------- Compute ----------
agg_marker_totals = per_marker_totals(labelled)
per_book_data = per_book_marker_breakdown(labelled)
position_data = per_position_analysis(labelled)
kind_data = per_kind_analysis(labelled)
kind_per_book_data = per_kind_per_book_analysis(labelled)
top_per_book = top_markers_per_book(labelled, k=10)

cross = cross_book_stability(per_book_data, top_per_book)

# Structural-position cross-book check: boundary > internal in 3/3?
boundary_vs_internal_per_book_holds = []
for book in books_in_order:
    bvi = position_data["per_book"][book]["__boundary_vs_internal__"]
    boundary_rate = bvi["boundary"]["markers_per_1k_words"]
    internal_rate = bvi["internal"]["markers_per_1k_words"]
    holds = boundary_rate > internal_rate
    boundary_vs_internal_per_book_holds.append({
        "book": book,
        "boundary_per_1k": boundary_rate,
        "internal_per_1k": internal_rate,
        "ratio": bvi["ratio_boundary_over_internal_per_1k"],
        "boundary_gt_internal": holds,
    })
boundary_holds_count = sum(1 for r in boundary_vs_internal_per_book_holds if r["boundary_gt_internal"])

# Final verdict
top3_overlap_pass = cross["pairs_with_2plus_overlap"] == 3
density_pass = cross["density_stable_le_30pct"]
structural_pass = boundary_holds_count == 3
structural_partial = boundary_holds_count >= 2

# 3-of-3 on all gates -> PASS
# 2-of-3 reproduce on key axes -> PASS_PARTIAL
# Otherwise DIVERGE / KILL based on signal magnitude
gates_passed = sum([top3_overlap_pass, density_pass, structural_pass])
gates_partial = sum([
    top3_overlap_pass or cross["pairs_with_2plus_overlap"] >= 2,
    density_pass,
    structural_partial,
])

if gates_passed == 3:
    verdict = "PASS"
    verdict_note = (
        "Top-3 markers reproduce in 3/3 pairwise comparisons (>=2 shared each), "
        "density per 1k words stable (<=30pp spread), boundary>internal in 3/3 books."
    )
elif gates_passed >= 2 or gates_partial >= 2:
    verdict = "PASS_PARTIAL"
    verdict_note = (
        f"{gates_passed}/3 strict gates pass, {gates_partial}/3 partial gates pass — "
        "stable on the majority of axes but at least one cross-book divergence."
    )
elif agg_marker_totals and sum(agg_marker_totals.values()) >= 30:
    verdict = "DIVERGE"
    verdict_note = (
        "Markers exist in volume but lexicons or density unstable across books — "
        "no clean shippable prior."
    )
else:
    verdict = "KILL"
    verdict_note = "Marker volume too low or no consistent signal."


# ---------- Spot-check examples ----------
def sample_examples_at_position(labels, position, k=5):
    rows = [r for r in labels if r["position"] == position and r["total_hits"] > 0]
    return [
        {
            "scene_id": r["scene_id"],
            "book": r["book"],
            "chapter": r["chapter"],
            "kind": r["kind"],
            "hits": r["hits"],
        }
        for r in rows[:k]
    ]


examples = {
    "chapter_open_examples": sample_examples_at_position(labelled, "chapter-open", k=5),
    "scene_bounded_examples": sample_examples_at_position(labelled, "scene-bounded", k=5),
    "internal_examples": sample_examples_at_position(labelled, "chapter-internal", k=5),
}


# ---------- Build payload ----------
payload = {
    "pattern": 54,
    "name": "Time-skip / temporal-leap marker distribution",
    "corpus": "salvatore-icewind-dale (3 books)",
    "method": {
        "labeler": "regex word-boundary case-insensitive over (summary + text)",
        "categories": {
            "EXPLICIT_DURATION": EXPLICIT_DURATION,
            "ABSOLUTE_TIME": ABSOLUTE_TIME,
            "ELAPSED_NARRATIVE": ELAPSED_NARRATIVE,
        },
        "lexicon_additions": LEXICON_ADDITIONS,
        "all_marker_count": len(ALL_MARKERS),
        "scope": "summary + text concatenated; per-marker findall (each occurrence counts independently, all markers can fire on the same beat)",
        "stability_gates": {
            "top3_overlap": ">=2 shared in all pairwise top-3 sets",
            "density_spread": "<=30% (max-vs-min over per-1k-words rate)",
            "structural": "boundary marker rate > internal marker rate, in 3/3 books",
        },
    },
    "n_beats_total": len(labelled),
    "n_beats_per_book": {b: per_book_data[b]["n_beats"] for b in books_in_order},
    "aggregate_total_hits": sum(agg_marker_totals.values()),
    "aggregate_marker_totals_top20": agg_marker_totals.most_common(20),
    "per_book": per_book_data,
    "top_markers_per_book": top_per_book,
    "structural_position_analysis": position_data,
    "boundary_vs_internal_per_book": boundary_vs_internal_per_book_holds,
    "boundary_holds_count": boundary_holds_count,
    "per_kind_analysis": kind_data,
    "per_kind_per_book_analysis": kind_per_book_data,
    "cross_book_stability": cross,
    "verdict": verdict,
    "verdict_note": verdict_note,
    "examples": examples,
}

os.makedirs(OUT_DIR, exist_ok=True)
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)

print(f"Wrote {OUT_PATH}")
print(f"n_beats: {len(labelled)}")
print(f"aggregate hits: {sum(agg_marker_totals.values())}")
print(f"per-book densities (per 1k): " + ", ".join(
    f"{b}={per_book_data[b]['markers_per_1k_words']}" for b in books_in_order
))
print(f"top-3 per book:")
for b in books_in_order:
    top3 = top_per_book[b][:3]
    print(f"  {b}: {top3}")
print(f"verdict: {verdict}")
print(f"  note: {verdict_note}")
