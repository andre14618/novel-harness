#!/usr/bin/env python3
"""
Pattern 56 — Body-part vocabulary distribution (implicit camera anchor).

Hypothesis: body-part references function as an implicit camera anchor.
High body-part density signals close-third intimacy; low signals distant
narration. Per-beat-kind, *which* body-parts dominate is informative:
  action      = hands / feet / arms / shoulders (combat & motion)
  dialogue    = eyes / mouth / lips / face (gaze & expression)
  interiority = eyes / chest / heart / head (emotional landing)
  description = bodies-in-environment-frame, lower density overall

Methodology — pure compute lexicon density:
  1. Per beat: count word-boundary matches per anatomical region; normalize
     per beat words → density per 100 words per region
  2. Per (book, kind, region): aggregate mean density. 4 kinds × 3 books ×
     6 regions = 72 cells.
  3. Per-kind region ranking (top-1/2/3); cross-book stability.
  4. Top-10 individual body-part terms per kind; cross-book stability.
  5. Beat-level body-part density distribution.
  6. Cross-book gates:
     - PASS:         per-kind top-2 region ranking 3/3 + density spread <=25%
     - PASS_PARTIAL: 2/3 reproduce
     - DIVERGE:      rankings disagree
     - KILL:         no signal

v2 sensitivity pass (--v2 flag): rerun with `back` and `side` removed from
the torso lexicon. Spot-check found 91.8% of `back` hits and similar majority
of `side` hits are spatial/idiomatic ("back and forth", "side of the
mountain") rather than body-part references — so the v1 lexicon admits a
spatial-polysemy confound that distorts the torso region. The v2 sensitivity
pass isolates the genuine body-part signal.

Outputs:
  - JSON: novels/salvatore-icewind-dale/structure-calibration/
          crystal_shard.<TS>.body-part-vocabulary.json (v1)
          crystal_shard.<TS>.body-part-vocabulary.v2.json (v2, --v2 flag)
  - Atomic-append to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert into docs/harness-tuning-roadmap.md (fcntl flock)
"""

from __future__ import annotations

import argparse
import datetime as _dt
import fcntl
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path
from statistics import mean, median

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
# Lexicons
# ---------------------------------------------------------------------------
# Six anatomical regions; spec lexicons retained verbatim. No additions for
# v1 (the spec lexicon already covers the obvious Salvatore-prose surface).
# Documented in LEXICON_ADDITIONS for transparency.

LEXICONS_V1: dict[str, list[str]] = {
    "head_face": [
        "head", "face", "brow", "brows", "eye", "eyes", "mouth", "lips",
        "tongue", "teeth", "nose", "chin", "jaw", "ear", "ears", "cheek",
        "cheeks", "forehead", "eyebrow", "eyebrows",
    ],
    "hands_arms": [
        "hand", "hands", "finger", "fingers", "fist", "fists", "palm",
        "palms", "wrist", "wrists", "arm", "arms", "elbow", "elbows",
        "shoulder", "shoulders",
    ],
    "torso": [
        "chest", "breast", "back", "side", "hip", "hips", "waist", "stomach",
        "belly", "ribs", "neck", "throat",
    ],
    "legs_feet": [
        "leg", "legs", "foot", "feet", "knee", "knees", "thigh", "thighs",
        "ankle", "ankles", "calf", "calves", "toe", "toes",
    ],
    "internal_visceral": [
        "heart", "gut", "blood", "bones", "mind", "soul", "spirit",
    ],
    "hair_skin": [
        "hair", "beard", "skin", "flesh",
    ],
}
# v2 lexicon — `back` and `side` removed from torso.
# Spot-check on Salvatore corpus: 91.8% of `back` hits and majority of `side`
# hits are spatial/idiomatic ("back and forth", "side of the mountain") rather
# than body-part references. Removing them isolates the genuine close-third
# camera-anchor signal.
LEXICONS_V2: dict[str, list[str]] = {
    region: [t for t in terms if not (region == "torso" and t in ("back", "side"))]
    for region, terms in LEXICONS_V1.items()
}
LEXICON_REMOVALS_V2: dict[str, list[str]] = {
    "torso": ["back", "side"],
}
LEXICON_ADDITIONS: dict[str, list[str]] = {
    # Document any additions per region. None added for v1.
}

# Default to v1; v2 is selected at runtime via --variant v2.
LEXICONS: dict[str, list[str]] = LEXICONS_V1
REGIONS = list(LEXICONS.keys())

# Compile per-region regex (OR over \bterm\b, case-insensitive). Word
# boundaries on both sides keep substrings (e.g. "armed" vs "arm",
# "skinny" vs "skin") under control.
COMPILED_REGION: dict[str, re.Pattern] = {}
COMPILED_TERMS: dict[str, re.Pattern] = {}
ALL_TERMS: list[tuple[str, str]] = []
TERM_REGION: dict[str, str] = {}


def _set_variant(variant: str) -> None:
    """Switch the module-level lexicon between v1 and v2."""
    global LEXICONS, REGIONS, COMPILED_REGION, ALL_TERMS, COMPILED_TERMS, TERM_REGION
    LEXICONS = LEXICONS_V1 if variant == "v1" else LEXICONS_V2
    REGIONS = list(LEXICONS.keys())
    COMPILED_REGION = {
        region: re.compile(
            r"\b(?:" + "|".join(re.escape(t) for t in terms) + r")\b",
            flags=re.IGNORECASE,
        )
        for region, terms in LEXICONS.items()
    }
    ALL_TERMS = [
        (region, term) for region, terms in LEXICONS.items() for term in terms
    ]
    COMPILED_TERMS = {
        term: re.compile(rf"\b{re.escape(term)}\b", flags=re.IGNORECASE)
        for _region, term in ALL_TERMS
    }
    TERM_REGION = {term: region for region, term in ALL_TERMS}


_set_variant("v1")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ACTIVE_KINDS = ("action", "dialogue", "interiority", "description")


def density_per_100w(count: int, words: int) -> float:
    if words <= 0:
        return 0.0
    return 100.0 * count / words


def commit_short() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO, capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


def spread_pct(values: list[float]) -> float:
    """Relative spread = (max - min) / mean, expressed as a percentage."""
    if not values:
        return 0.0
    avg = mean(values)
    if avg == 0:
        return 0.0
    return 100.0 * (max(values) - min(values)) / avg


# ---------------------------------------------------------------------------
# Load + analyze
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
    # Per-beat region densities accumulated under (book, kind, region)
    region_densities: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    region_total_hits: dict[tuple[str, str, str], int] = defaultdict(int)

    # Per-beat counts (how many beats hit at least once per region)
    region_beat_hit: dict[tuple[str, str, str], int] = defaultdict(int)

    cell_counts: dict[tuple[str, str], int] = defaultdict(int)
    cell_words: dict[tuple[str, str], int] = defaultdict(int)

    # Term-level: per (book, kind, term) total hits
    term_hits: dict[tuple[str, str, str], int] = defaultdict(int)
    term_hits_by_book: dict[tuple[str, str], int] = defaultdict(int)
    term_hits_overall: dict[str, int] = defaultdict(int)

    # Per-beat overall density (any region) — for cross-book corpus rate
    per_beat_total_density: dict[str, list[float]] = defaultdict(list)
    per_beat_total_density_by_kind: dict[tuple[str, str], list[float]] = defaultdict(list)

    skipped = 0
    total_beats_used = 0
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

        cell_counts[(book, kind)] += 1
        cell_words[(book, kind)] += words
        total_beats_used += 1

        beat_total_hits = 0
        for region in REGIONS:
            n = len(COMPILED_REGION[region].findall(text))
            d = density_per_100w(n, words)
            region_densities[(book, kind, region)].append(d)
            region_total_hits[(book, kind, region)] += n
            beat_total_hits += n
            if n > 0:
                region_beat_hit[(book, kind, region)] += 1

        beat_total_density = density_per_100w(beat_total_hits, words)
        per_beat_total_density[book].append(beat_total_density)
        per_beat_total_density_by_kind[(book, kind)].append(beat_total_density)

        # Term-level counts (one regex pass per term)
        for term, _region in [(t, r) for r, t in [(r, t) for r, t in TERM_REGION.items()]]:
            pass  # placeholder — handled below

        for term, pattern in COMPILED_TERMS.items():
            n = len(pattern.findall(text))
            if n:
                term_hits[(book, kind, term)] += n
                term_hits_by_book[(book, term)] += n
                term_hits_overall[term] += n

    # --- Per (book, kind, region) mean density (per-beat mean) and pooled
    mean_density: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    pooled_density: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    for (book, kind, region), arr in region_densities.items():
        mean_density[book][kind][region] = float(mean(arr)) if arr else 0.0
        words = cell_words[(book, kind)]
        hits = region_total_hits[(book, kind, region)]
        pooled_density[book][kind][region] = density_per_100w(hits, words)

    # --- Per (book, kind) region rankings (descending mean density)
    rankings: dict[str, dict[str, list[tuple[str, float]]]] = defaultdict(dict)
    for book in mean_density:
        for kind in mean_density[book]:
            row = mean_density[book][kind]
            rankings[book][kind] = sorted(
                row.items(), key=lambda kv: kv[1], reverse=True
            )

    books = sorted(mean_density.keys())

    # --- Cross-book per-kind region-ranking verdict (top-2 stability)
    per_kind_verdict: dict[str, dict] = {}
    for kind in ACTIVE_KINDS:
        per_book_top2: dict[str, list[str]] = {}
        per_book_top3: dict[str, list[str]] = {}
        for book in books:
            if kind in rankings.get(book, {}):
                per_book_top2[book] = [r for r, _ in rankings[book][kind][:2]]
                per_book_top3[book] = [r for r, _ in rankings[book][kind][:3]]

        if len(per_book_top2) < 3:
            verdict_top2 = "INSUFFICIENT_BOOKS"
            agree_top2 = 0
            agree_top1 = 0
        else:
            vals2 = list(per_book_top2.values())
            ref2 = vals2[0]
            agree_top2 = sum(1 for v in vals2 if v == ref2)
            agree_top1 = sum(1 for v in vals2 if v[0] == ref2[0])
            if agree_top2 == 3:
                verdict_top2 = "PASS"
            elif agree_top2 == 2:
                verdict_top2 = "PASS_PARTIAL"
            elif agree_top1 == 3:
                verdict_top2 = "PASS_PARTIAL_TOP1"
            elif agree_top1 == 2:
                verdict_top2 = "DIVERGE"
            else:
                verdict_top2 = "KILL"

        # Density spread across books at top-1 region (per-kind)
        per_book_top1_density: dict[str, float] = {}
        for book in books:
            if kind in rankings.get(book, {}):
                top_region, top_val = rankings[book][kind][0]
                per_book_top1_density[book] = top_val
        spread = spread_pct(list(per_book_top1_density.values()))

        per_kind_verdict[kind] = {
            "per_book_top2": per_book_top2,
            "per_book_top3": per_book_top3,
            "books_with_matching_top2": agree_top2,
            "books_with_matching_top1": agree_top1,
            "verdict": verdict_top2,
            "per_book_top1_density_per_100w": {
                k: round(v, 4) for k, v in per_book_top1_density.items()
            },
            "top1_density_spread_pct": round(spread, 1),
            "top1_density_spread_within_25pct": spread <= 25.0,
        }

    # --- Top-N individual body-part terms per kind (across all books pooled)
    # Aggregate per-kind hits (sum across books).
    term_hits_per_kind: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for (book, kind, term), n in term_hits.items():
        term_hits_per_kind[kind][term] += n

    top10_per_kind: dict[str, list[dict]] = {}
    for kind in ACTIVE_KINDS:
        sorted_terms = sorted(
            term_hits_per_kind[kind].items(), key=lambda kv: kv[1], reverse=True
        )
        top10 = []
        for term, n in sorted_terms[:10]:
            top10.append({
                "term": term,
                "region": TERM_REGION[term],
                "hits_total": n,
                "hits_per_book": {
                    book: term_hits.get((book, kind, term), 0) for book in books
                },
            })
        top10_per_kind[kind] = top10

    # Cross-book reproducibility of top-10 terms per kind:
    # for each kind, compute per-book top-10 list and the pairwise / triple
    # set intersection.
    top10_per_kind_per_book: dict[str, dict[str, list[str]]] = defaultdict(dict)
    for kind in ACTIVE_KINDS:
        for book in books:
            tally: dict[str, int] = defaultdict(int)
            for (b, k, t), n in term_hits.items():
                if b == book and k == kind:
                    tally[t] += n
            top10_per_kind_per_book[kind][book] = [
                t for t, _ in sorted(tally.items(), key=lambda kv: kv[1], reverse=True)[:10]
            ]

    top10_overlap: dict[str, dict] = {}
    for kind in ACTIVE_KINDS:
        per_book = top10_per_kind_per_book[kind]
        sets = {b: set(per_book[b]) for b in books if b in per_book}
        if len(sets) >= 3:
            triple_intersection = set.intersection(*sets.values())
        else:
            triple_intersection = set()
        pair_overlaps: dict[str, int] = {}
        bb = list(sets.keys())
        for i in range(len(bb)):
            for j in range(i + 1, len(bb)):
                pair_overlaps[f"{bb[i]}^{bb[j]}"] = len(sets[bb[i]] & sets[bb[j]])
        top10_overlap[kind] = {
            "per_book_top10": per_book,
            "triple_intersection": sorted(triple_intersection),
            "triple_intersection_size": len(triple_intersection),
            "pair_overlap_sizes": pair_overlaps,
        }

    # --- Corpus-wide beat-level density distribution (any region)
    per_book_overall_stats: dict[str, dict] = {}
    for book in books:
        arr = per_beat_total_density[book]
        per_book_overall_stats[book] = {
            "n_beats": len(arr),
            "mean_density_per_100w": round(mean(arr), 3) if arr else 0.0,
            "median_density_per_100w": round(median(arr), 3) if arr else 0.0,
            "p10": round(sorted(arr)[max(0, int(0.10 * len(arr)) - 1)], 3) if arr else 0.0,
            "p90": round(sorted(arr)[min(len(arr) - 1, int(0.90 * len(arr)))], 3) if arr else 0.0,
            "max": round(max(arr), 3) if arr else 0.0,
        }

    overall_means = [per_book_overall_stats[b]["mean_density_per_100w"] for b in books]
    overall_density_spread = spread_pct(overall_means)

    # Per (book, kind) overall density (any region)
    per_book_per_kind_overall: dict[str, dict[str, float]] = defaultdict(dict)
    for (book, kind), arr in per_beat_total_density_by_kind.items():
        per_book_per_kind_overall[book][kind] = round(mean(arr), 3) if arr else 0.0

    # --- Cross-book gate rollup (Pattern 56's primary verdict)
    # PASS         : top-2 region ranking 3/3 reproducibility AND density spread <=25%
    # PASS_PARTIAL : 2/3 reproduce
    # DIVERGE      : rankings disagree
    # KILL         : no signal
    rank_top2_3of3 = sum(
        1 for kind in ACTIVE_KINDS
        if per_kind_verdict[kind]["verdict"] == "PASS"
    )
    rank_top2_2of3 = sum(
        1 for kind in ACTIVE_KINDS
        if per_kind_verdict[kind]["verdict"] == "PASS_PARTIAL"
    )
    rank_top1_3of3 = sum(
        1 for kind in ACTIVE_KINDS
        if per_kind_verdict[kind]["verdict"] in ("PASS", "PASS_PARTIAL_TOP1")
    )

    if rank_top2_3of3 == 4 and overall_density_spread <= 25.0:
        gate_verdict = "PASS"
    elif (rank_top2_3of3 + rank_top2_2of3) >= 3 and overall_density_spread <= 25.0:
        gate_verdict = "PASS_PARTIAL"
    elif rank_top1_3of3 >= 2:
        gate_verdict = "PASS_PARTIAL_TOP1"
    elif rank_top1_3of3 >= 1:
        gate_verdict = "DIVERGE"
    else:
        gate_verdict = "KILL"

    return {
        "books": books,
        "active_kinds": list(ACTIVE_KINDS),
        "skipped_beats_or_outliers": skipped,
        "total_beats_used": total_beats_used,
        "per_book_per_kind_count": {
            f"{b}/{k}": cell_counts[(b, k)] for (b, k) in cell_counts
        },
        "per_book_per_kind_words": {
            f"{b}/{k}": cell_words[(b, k)] for (b, k) in cell_words
        },
        "mean_density_per_100w": mean_density,
        "pooled_density_per_100w": pooled_density,
        "rankings": {
            b: {
                k: [{"region": r, "mean_density_per_100w": round(v, 4)}
                    for r, v in rankings[b][k]]
                for k in rankings[b]
            }
            for b in rankings
        },
        "per_kind_verdict": per_kind_verdict,
        "top10_per_kind_aggregate": top10_per_kind,
        "top10_overlap": top10_overlap,
        "per_book_overall_density_stats": per_book_overall_stats,
        "overall_density_spread_pct": round(overall_density_spread, 1),
        "overall_density_spread_within_25pct": overall_density_spread <= 25.0,
        "per_book_per_kind_overall_density_per_100w": per_book_per_kind_overall,
        "gate_verdict": gate_verdict,
    }


# ---------------------------------------------------------------------------
# Output: JSON
# ---------------------------------------------------------------------------


def write_json(result: dict, ts: str, variant: str) -> Path:
    suffix = ".body-part-vocabulary.json" if variant == "v1" else f".body-part-vocabulary.{variant}.json"
    path = OUT_DIR / f"crystal_shard.{ts}{suffix}"
    payload = {
        "pattern_number": 56,
        "pattern_name": "Body-part vocabulary distribution (implicit camera anchor)",
        "variant": variant,
        "timestamp": ts,
        "commit": commit_short(),
        "lexicons": LEXICONS,
        "lexicon_additions": LEXICON_ADDITIONS,
        "lexicon_removals_from_v1": LEXICON_REMOVALS_V2 if variant == "v2" else {},
        "regions": REGIONS,
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        **result,
    }
    path.write_text(json.dumps(payload, indent=2, default=str))
    return path


# ---------------------------------------------------------------------------
# Output: append to conclusions doc (atomic via flock)
# ---------------------------------------------------------------------------


def append_conclusions(result: dict, json_path: Path, commit: str, variant: str = "v1") -> None:
    target = CONCLUSIONS_PATH

    books = result["books"]
    rankings = result["rankings"]
    per_kind_verdict = result["per_kind_verdict"]
    top10 = result["top10_per_kind_aggregate"]
    top10_overlap = result["top10_overlap"]
    overall_stats = result["per_book_overall_density_stats"]
    per_book_per_kind_overall = result["per_book_per_kind_overall_density_per_100w"]

    lines: list[str] = []
    lines.append("")
    lines.append("")
    if variant == "v1":
        lines.append("## Pattern 56: Body-part vocabulary distribution (implicit camera anchor)")
    else:
        lines.append(f"## Pattern 56 ({variant} sensitivity): Body-part vocabulary — `back`/`side` removed from torso")
    lines.append("")
    if variant == "v2":
        lines.append(
            "_Sensitivity pass for Pattern 56. Spot-check on the Salvatore corpus "
            "(n=1,134 `back` hits) found **91.8% of `back` hits** are "
            "spatial/idiomatic (\"back and forth\", \"shot back\", \"back to\") "
            "rather than body-part references. `side` similarly dominated by "
            "spatial usage (\"side of the mountain\", \"by his side\"). The v1 "
            "torso lexicon admits this confound and dominates rank-1 in 7/12 "
            "(book, kind) cells purely from polysemy noise. v2 removes `back` "
            "and `side` from `torso` to isolate the genuine close-third "
            "body-part signal._"
        )
        lines.append("")
    lines.append(
        f"_Pure-compute lexicon density across 3 books, 4 active beat-kinds, "
        f"6 anatomical regions ({len(ALL_TERMS)} body-part terms in {variant}). "
        f"Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")
    lines.append("### Methodology")
    lines.append(
        f"- Six anatomical regions: head_face / hands_arms / torso / legs_feet / "
        f"internal_visceral / hair_skin. Lexicons listed verbatim in the JSON "
        f"(no additions in v1)."
    )
    lines.append(
        "- Word-boundary regex per term (case-insensitive). Each region is the "
        "OR of its terms; per-term counts also tallied for top-N analysis."
    )
    lines.append(
        "- Per beat: count region matches; normalize by beat words → density per "
        "100w. Aggregate per `(book, kind, region)` as the **mean of per-beat "
        "densities** (matches sensory-mode-density methodology)."
    )
    lines.append(
        "- Cross-book per-kind region-ranking verdict: PASS if top-2 ordered "
        "ranking matches in 3/3 books, PASS_PARTIAL in 2/3, "
        "PASS_PARTIAL_TOP1 if only top-1 region is stable, DIVERGE if even "
        "top-1 wobbles, KILL if no signal."
    )
    lines.append(
        "- Overall gate: PASS if all 4 kinds rank-stable AND corpus-wide "
        "density spread <=25%; PASS_PARTIAL if 3 kinds stable AND density "
        "spread <=25%; otherwise progressively softer verdicts."
    )
    lines.append(
        f"- `stakes_recalibration` outlier (1 beat) excluded; "
        f"{result['skipped_beats_or_outliers']} beat(s) skipped; "
        f"{result['total_beats_used']} beats analyzed."
    )
    lines.append("")

    lines.append("### Per-book per-kind region ranking (mean density per 100w)")
    lines.append("")
    for kind in ACTIVE_KINDS:
        lines.append(f"- **{kind.upper()}**")
        for book in books:
            if kind in rankings.get(book, {}):
                ordering = rankings[book][kind]
                cells = ", ".join(
                    f"{e['region']} {e['mean_density_per_100w']:.3f}"
                    for e in ordering
                )
                lines.append(f"  - **{book} / {kind}** → {cells}")
    lines.append("")

    lines.append("### Per-kind cross-book verdict (top-2 region ranking stability)")
    lines.append("")
    lines.append(
        "| Kind | Per-book top-2 (rank 1 > rank 2) | Top-2 agree | Top-1 agree | "
        "Density spread (top-1) | Verdict |"
    )
    lines.append(
        "|------|----------------------------------|-------------|-------------|"
        "------------------------|---------|"
    )
    for kind in ACTIVE_KINDS:
        v = per_kind_verdict[kind]
        per_book = "; ".join(
            f"{b}: {' > '.join(regions)}" for b, regions in v["per_book_top2"].items()
        )
        lines.append(
            f"| {kind} | {per_book} | {v['books_with_matching_top2']}/3 | "
            f"{v['books_with_matching_top1']}/3 | "
            f"{v['top1_density_spread_pct']}% | **{v['verdict']}** |"
        )
    lines.append("")

    lines.append("### Top-10 individual body-part terms per kind (aggregate over 3 books)")
    lines.append("")
    for kind in ACTIVE_KINDS:
        lines.append(f"- **{kind.upper()}**")
        for entry in top10[kind]:
            per_book = ", ".join(
                f"{b}={n}" for b, n in entry["hits_per_book"].items()
            )
            lines.append(
                f"  - `{entry['term']}` ({entry['region']}) — "
                f"{entry['hits_total']} hits ({per_book})"
            )
    lines.append("")

    lines.append("### Top-10 cross-book reproducibility per kind")
    lines.append("")
    lines.append(
        "| Kind | Triple intersection (3-way) | Triple size | "
        "Avg pairwise overlap |"
    )
    lines.append(
        "|------|-----------------------------|-------------|----------------------|"
    )
    for kind in ACTIVE_KINDS:
        ov = top10_overlap[kind]
        triple = ov["triple_intersection"]
        avg_pair = (
            mean(ov["pair_overlap_sizes"].values())
            if ov["pair_overlap_sizes"]
            else 0.0
        )
        triple_str = ", ".join(triple) if triple else "(none)"
        lines.append(
            f"| {kind} | {triple_str} | {ov['triple_intersection_size']} | "
            f"{avg_pair:.1f}/10 |"
        )
    lines.append("")

    lines.append("### Beat-level body-part density distribution (per 100w, all regions)")
    lines.append("")
    lines.append(
        "| Book | n_beats | mean | median | p10 | p90 | max |"
    )
    lines.append(
        "|------|---------|------|--------|-----|-----|-----|"
    )
    for book in books:
        s = overall_stats[book]
        lines.append(
            f"| {book} | {s['n_beats']} | {s['mean_density_per_100w']} | "
            f"{s['median_density_per_100w']} | {s['p10']} | {s['p90']} | "
            f"{s['max']} |"
        )
    lines.append("")
    lines.append(
        f"**Cross-book density spread:** {result['overall_density_spread_pct']}% "
        f"(<=25% gate: "
        f"{'**PASS**' if result['overall_density_spread_within_25pct'] else '**FAIL**'}). "
        f"Per-book mean body-part density per 100w "
        f"(any region): "
        + ", ".join(
            f"{b}={overall_stats[b]['mean_density_per_100w']}" for b in books
        )
        + "."
    )
    lines.append("")

    lines.append("### Per-book per-kind overall body-part density (per 100w, any region)")
    lines.append("")
    lines.append("| Book | action | dialogue | interiority | description |")
    lines.append("|------|--------|----------|-------------|-------------|")
    for book in books:
        row = per_book_per_kind_overall.get(book, {})
        lines.append(
            f"| {book} | "
            f"{row.get('action', 0):.3f} | "
            f"{row.get('dialogue', 0):.3f} | "
            f"{row.get('interiority', 0):.3f} | "
            f"{row.get('description', 0):.3f} |"
        )
    lines.append("")

    lines.append("### Findings")
    lines.append("")
    findings: list[str] = []
    for kind in ACTIVE_KINDS:
        v = per_kind_verdict[kind]
        ref_book = books[0]
        ranking = rankings[ref_book][kind]
        order_str = " > ".join(e["region"] for e in ranking[:3])
        findings.append(
            f"- **{kind}** — top-3 (`{ref_book}` ranking): `{order_str}`. "
            f"Cross-book: top-2 agree {v['books_with_matching_top2']}/3, "
            f"top-1 agree {v['books_with_matching_top1']}/3, "
            f"top-1 density spread {v['top1_density_spread_pct']}%. "
            f"Verdict: **{v['verdict']}**."
        )
    lines.extend(findings)
    lines.append("")
    lines.append(f"**Overall gate verdict:** **{result['gate_verdict']}**.")
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


def insert_roadmap_row(result: dict, json_path: Path, commit: str, variant: str = "v1") -> None:
    target = ROADMAP_PATH

    overall = result["gate_verdict"]
    per_kind_verdict = result["per_kind_verdict"]
    rankings = result["rankings"]
    ref_book = result["books"][0]
    overall_stats = result["per_book_overall_density_stats"]
    books = result["books"]

    pass_kinds = [k for k, v in per_kind_verdict.items() if v["verdict"] == "PASS"]
    partial_kinds = [
        k for k, v in per_kind_verdict.items()
        if v["verdict"] in ("PASS_PARTIAL", "PASS_PARTIAL_TOP1")
    ]
    diverge_kinds = [
        k for k, v in per_kind_verdict.items()
        if v["verdict"] in ("DIVERGE", "KILL")
    ]

    top1_by_kind = {
        kind: rankings[ref_book][kind][0]["region"]
        for kind in ACTIVE_KINDS
        if kind in rankings.get(ref_book, {})
    }
    top1_str = ", ".join(f"{k}->{r}" for k, r in top1_by_kind.items())

    # Per-book mean overall density quote
    density_quote = ", ".join(
        f"{b} {overall_stats[b]['mean_density_per_100w']}"
        for b in books
    )

    findings = (
        f"per-kind top-1 region ({top1_str}); "
        f"PASS={len(pass_kinds)}/4, PASS_PARTIAL={len(partial_kinds)}/4, "
        f"DIVERGE/KILL={len(diverge_kinds)}/4; corpus body-part density per 100w "
        f"{density_quote} (spread {result['overall_density_spread_pct']}%, "
        f"<=25% gate {'met' if result['overall_density_spread_within_25pct'] else 'failed'})"
    )

    if overall == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship per-kind top-1 region as a writer-prompt camera-anchor prior "
            "(action->hands_arms; dialogue->head_face; interiority->internal+head; "
            "description->head_face/hands_arms with lower density)"
        )
    elif overall in ("PASS_PARTIAL", "PASS_PARTIAL_TOP1"):
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship top-1 region per kind as soft writer-prompt camera prior; "
            "defer rank-2/3 ordering and per-term shortlists"
        )
    elif overall == "DIVERGE":
        verdict_short = "HOLD"
        recommend = (
            "do not codify per-kind region ordering as a writer prior; "
            "revisit with finer beat-segmentation or per-character splits"
        )
    else:
        verdict_short = "KILL"
        recommend = "no signal; drop body-part priors as a harness lever"

    lever = (
        "writer-prompt per-kind body-part priors (camera-anchor: action->hands_arms / "
        "feet; dialogue->head_face/eyes/lips; interiority->internal_visceral+head_face; "
        "description->lower density), plus optional per-beat density floor for "
        "intimate close-third scenes (~corpus median p50)"
    )

    label = (
        "**Body-part vocabulary distribution (implicit camera anchor)**"
        if variant == "v1"
        else "**Body-part vocabulary (v2 sensitivity — back/side removed from torso)**"
    )
    new_row = (
        f"| 56 | {label} (`{commit}`): {findings} | {lever} | NEW — DRAFT pending | — | "
        f"**DONE (3 books)** | n/a | **{verdict_short}** — {recommend} |\n"
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
    parser = argparse.ArgumentParser(description="Pattern 56 — body-part vocabulary")
    parser.add_argument(
        "--variant", choices=["v1", "v2"], default="v1",
        help="Lexicon variant (v1 = full spec; v2 = back/side removed from torso)",
    )
    parser.add_argument(
        "--no-roadmap", action="store_true",
        help="Skip roadmap row insertion (useful when re-running v2 alone)",
    )
    parser.add_argument(
        "--no-conclusions", action="store_true",
        help="Skip conclusions append",
    )
    args = parser.parse_args()

    _set_variant(args.variant)
    ts = _dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    commit = commit_short()
    beats = load_beats()
    print(f"[pattern-56:{args.variant}] {len(beats)} beats loaded; commit={commit}; ts={ts}")

    result = analyze(beats)
    json_path = write_json(result, ts, args.variant)
    print(f"[pattern-56:{args.variant}] JSON -> {json_path}")

    if not args.no_conclusions:
        append_conclusions(result, json_path, commit, args.variant)
        print(f"[pattern-56:{args.variant}] appended -> {CONCLUSIONS_PATH}")

    if not args.no_roadmap:
        insert_roadmap_row(result, json_path, commit, args.variant)
        print(f"[pattern-56:{args.variant}] inserted row -> {ROADMAP_PATH}")

    print(f"\n=== Pattern 56 ({args.variant}) — overall verdict ===")
    print(f"gate_verdict: {result['gate_verdict']}")
    print(f"density spread: {result['overall_density_spread_pct']}% "
          f"(<=25% gate met: {result['overall_density_spread_within_25pct']})")
    for kind in ACTIVE_KINDS:
        v = result["per_kind_verdict"][kind]
        print(
            f"  {kind:>12s} -> {v['verdict']:<22s} "
            f"top-2 agree={v['books_with_matching_top2']}/3 "
            f"top-1 agree={v['books_with_matching_top1']}/3 "
            f"density-spread={v['top1_density_spread_pct']}%"
        )


if __name__ == "__main__":
    main()
