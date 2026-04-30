#!/usr/bin/env python3
"""
Pattern 53 — Sensory mode distribution per beat-kind.

Hypothesis: Salvatore distributes the 5 sensory modes (sight, sound, touch,
smell, taste) at stable per-kind ratios across books. Sight dominates
description; sound dominates dialogue; touch is action-heavy; smell/taste
are background/sparse. Per-kind sensory ordering should be a writer-prompt
prior.

Methodology: pure compute lexicon density.
  1. Per beat: count word-boundary matches per category, normalize per 100w
  2. Per (book, kind) cell: aggregate mean density per category
  3. Per-kind across books: rank senses 1..5
  4. Cross-book directional verdict on top-2 stability per kind
  5. Per-kind dominant share check (>=2x runner-up)

Outputs:
  - JSON: novels/salvatore-icewind-dale/structure-calibration/
          crystal_shard.<TS>.sensory-mode-density.json
  - Atomic-append to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert into docs/harness-tuning-roadmap.md (fcntl flock)
"""

from __future__ import annotations

import datetime as _dt
import fcntl
import json
import os
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

# ---------------------------------------------------------------------------
# Lexicons (lowercase, word-boundary matched)
# ---------------------------------------------------------------------------
# Per the charter spec; no additions required (terms already cover the
# common Salvatore-prose surface for each modality).

LEXICONS: dict[str, list[str]] = {
    "sight": [
        "see", "saw", "seen", "look", "looked", "looking", "watch", "watched",
        "watching", "gaze", "gazed", "glance", "glanced", "stare", "stared",
        "staring", "peer", "peered", "eye", "eyes", "view", "viewed",
        "glimpse", "glimpsed", "dark", "light", "bright", "gleam", "gleamed",
        "flash", "flashed", "color", "glitter", "glittered", "shine", "shone",
        "shadow", "shadows",
    ],
    "sound": [
        "hear", "heard", "hearing", "listen", "listened", "sound", "sounded",
        "voice", "voices", "echo", "echoed", "scream", "screamed", "shout",
        "shouted", "whisper", "whispered", "roar", "roared", "snarl",
        "snarled", "growl", "growled", "click", "clicked", "crash", "crashed",
        "silence", "silent", "music", "song", "hum", "hummed", "ring", "rang",
        "bang", "banged",
    ],
    "touch": [
        "feel", "felt", "feeling", "touch", "touched", "touching", "grip",
        "gripped", "grasp", "grasped", "hold", "held", "push", "pushed",
        "pull", "pulled", "cold", "cool", "warm", "warmth", "hot", "heat",
        "smooth", "rough", "soft", "hard", "wet", "dry", "sharp", "blunt",
        "weight", "weighty",
    ],
    "smell": [
        "smell", "smelled", "smelt", "scent", "scented", "aroma", "odor",
        "stench", "stink", "stank", "fragrant", "sniff", "sniffed", "reek",
        "reeked",
    ],
    "taste": [
        "taste", "tasted", "tasting", "flavor", "flavored", "sweet", "bitter",
        "salt", "salty", "sour", "savory", "savor", "savored", "lick",
        "licked",
    ],
}
LEXICON_ADDITIONS: dict[str, list[str]] = {
    # Document any additions here. (None for v1.)
}

CATEGORIES = list(LEXICONS.keys())

# Compile regexes per category. Each pattern is the OR of \bterm\b for terms
# in the lexicon; case-insensitive. Word boundary on both sides keeps
# substrings (e.g. "soundless" vs "sound") under control.
COMPILED: dict[str, re.Pattern] = {
    cat: re.compile(
        r"\b(?:" + "|".join(re.escape(t) for t in terms) + r")\b",
        flags=re.IGNORECASE,
    )
    for cat, terms in LEXICONS.items()
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ACTIVE_KINDS = ("action", "dialogue", "interiority", "description")


def count_category(text: str, cat: str) -> int:
    return len(COMPILED[cat].findall(text))


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
    # Per-beat densities accumulated under (book, kind, category).
    cell_densities: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    cell_counts: dict[tuple[str, str], int] = defaultdict(int)
    cell_words: dict[tuple[str, str], int] = defaultdict(int)
    cell_token_totals: dict[tuple[str, str, str], int] = defaultdict(int)

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
        cell_counts[(book, kind)] += 1
        cell_words[(book, kind)] += words
        for cat in CATEGORIES:
            n = count_category(text, cat)
            d = density_per_100w(n, words)
            cell_densities[(book, kind, cat)].append(d)
            cell_token_totals[(book, kind, cat)] += n

    # Compute mean density per (book, kind, category).
    mean_density: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    pooled_density: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    for (book, kind, cat), arr in cell_densities.items():
        mean_density[book][kind][cat] = float(mean(arr)) if arr else 0.0
        # Pooled = total category hits / total words * 100 (length-weighted)
        words = cell_words[(book, kind)]
        hits = cell_token_totals[(book, kind, cat)]
        pooled_density[book][kind][cat] = density_per_100w(hits, words)

    # Per (book, kind), produce ordered ranking by mean_density.
    rankings: dict[str, dict[str, list[tuple[str, float]]]] = defaultdict(dict)
    for book in mean_density:
        for kind in mean_density[book]:
            row = mean_density[book][kind]
            ordering = sorted(row.items(), key=lambda kv: kv[1], reverse=True)
            rankings[book][kind] = ordering

    # Cross-book per-kind verdict: do top-2 senses agree across books?
    books = sorted(mean_density.keys())
    per_kind_verdict: dict[str, dict] = {}
    for kind in ACTIVE_KINDS:
        # collect each book's ordered ranking for this kind
        per_book_top2: dict[str, list[str]] = {}
        for book in books:
            if kind in rankings.get(book, {}):
                per_book_top2[book] = [c for c, _ in rankings[book][kind][:2]]

        if len(per_book_top2) < 3:
            verdict = "INSUFFICIENT_BOOKS"
            agree = 0
        else:
            # Compare ordered top-2 (sense at rank 1 & rank 2 must match)
            vals = list(per_book_top2.values())
            ref = vals[0]
            agree_set = sum(1 for v in vals if v == ref)
            agree_top1 = sum(1 for v in vals if v[0] == ref[0])
            if agree_set == 3:
                verdict = "PASS"
            elif agree_set == 2:
                verdict = "PASS_PARTIAL"
            elif agree_top1 == 3:
                # top-1 stable but top-2 drifts → still partial
                verdict = "PASS_PARTIAL_TOP1"
            elif agree_top1 == 2:
                verdict = "DIVERGE"
            else:
                verdict = "KILL"
            agree = agree_set

        # Dominant share check using mean of per-book top-1 mean densities
        dominant_ratios: list[float] = []
        for book in books:
            if kind in rankings.get(book, {}):
                ordering = rankings[book][kind]
                top_val = ordering[0][1]
                run_val = ordering[1][1] if len(ordering) > 1 else 0.0
                if run_val > 0:
                    dominant_ratios.append(top_val / run_val)
                else:
                    dominant_ratios.append(float("inf"))
        # Use median rather than mean to avoid inf blowing up the average
        median_ratio = (
            sorted(dominant_ratios)[len(dominant_ratios) // 2]
            if dominant_ratios
            else 0.0
        )
        per_kind_verdict[kind] = {
            "per_book_top2": per_book_top2,
            "books_with_matching_top2": agree,
            "verdict": verdict,
            "median_dominant_ratio_top1_over_top2": (
                None if median_ratio == float("inf") else round(median_ratio, 3)
            ),
            "dominant_2x_ratio_met": (
                bool(median_ratio >= 2.0) if median_ratio != float("inf") else True
            ),
        }

    # Cross-book overall verdict (worst per-kind result across the 4 kinds)
    severity = {
        "PASS": 0, "PASS_PARTIAL": 1, "PASS_PARTIAL_TOP1": 2,
        "DIVERGE": 3, "KILL": 4, "INSUFFICIENT_BOOKS": 5,
    }
    worst = max(per_kind_verdict.values(), key=lambda v: severity[v["verdict"]])
    overall_verdict = worst["verdict"]

    # Stability summary: best-case across-kinds agreement at top-1 only
    top1_stability: dict[str, dict] = {}
    for kind in ACTIVE_KINDS:
        per_book_top1 = {
            book: rankings[book][kind][0][0]
            for book in books
            if kind in rankings.get(book, {})
        }
        unique = set(per_book_top1.values())
        top1_stability[kind] = {
            "per_book_top1": per_book_top1,
            "unique_top1_count": len(unique),
            "stable_top1": len(unique) == 1,
        }

    return {
        "books": books,
        "active_kinds": list(ACTIVE_KINDS),
        "skipped_beats_or_outliers": skipped,
        "per_book_per_kind_count": {
            f"{b}/{k}": cell_counts[(b, k)] for (b, k) in cell_counts
        },
        "per_book_per_kind_words": {
            f"{b}/{k}": cell_words[(b, k)] for (b, k) in cell_words
        },
        "mean_density_per_100w": mean_density,
        "pooled_density_per_100w": pooled_density,
        "rankings": {
            b: {k: [{"sense": c, "mean_density_per_100w": round(v, 4)}
                    for c, v in rankings[b][k]] for k in rankings[b]}
            for b in rankings
        },
        "per_kind_verdict": per_kind_verdict,
        "top1_stability": top1_stability,
        "overall_verdict": overall_verdict,
    }


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------


def write_json(result: dict, ts: str) -> Path:
    path = OUT_DIR / f"crystal_shard.{ts}.sensory-mode-density.json"
    payload = {
        "pattern_number": 53,
        "pattern_name": "Sensory mode distribution per beat-kind",
        "timestamp": ts,
        "commit": commit_short(),
        "lexicons": LEXICONS,
        "lexicon_additions": LEXICON_ADDITIONS,
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        **result,
    }
    path.write_text(json.dumps(payload, indent=2, default=str))
    return path


def append_conclusions(result: dict, json_path: Path, commit: str) -> None:
    target = CONCLUSIONS_PATH

    books = result["books"]
    rankings = result["rankings"]
    per_kind_verdict = result["per_kind_verdict"]

    # Build per-kind density tables
    def fmt_density_row(book: str, kind: str) -> str:
        ordering = rankings[book][kind]
        cells = ", ".join(
            f"{e['sense']} {e['mean_density_per_100w']:.3f}" for e in ordering
        )
        return f"  - **{book} / {kind}** → {cells}"

    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append("## Pattern 53: Sensory mode distribution per beat-kind")
    lines.append("")
    lines.append(
        f"_Pure-compute lexicon density across 3 books, 4 active beat-kinds, 5 sensory modes. "
        f"Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")
    lines.append("### Methodology")
    lines.append(
        "- Word-boundary regex per category (sight / sound / touch / smell / taste); "
        "lexicons listed verbatim in the JSON."
    )
    lines.append(
        "- Per beat: count category matches; normalize by beat words → density per 100w."
    )
    lines.append(
        "- Aggregate per `(book, kind, category)` as the mean of per-beat densities."
    )
    lines.append(
        "- Cross-book verdict per kind: PASS if top-2 ordered ranking matches in 3/3 books, "
        "PASS_PARTIAL in 2/3, PASS_PARTIAL_TOP1 if only top-1 sense is stable, DIVERGE if even top-1 wobbles."
    )
    lines.append(
        f"- `stakes_recalibration` outlier (1 beat) excluded; {result['skipped_beats_or_outliers']} beat(s) skipped."
    )
    lines.append("")
    lines.append("### Per-book per-kind sensory ordering (mean density per 100w)")
    lines.append("")
    for kind in ACTIVE_KINDS:
        lines.append(f"- **{kind.upper()}**")
        for book in books:
            if kind in rankings.get(book, {}):
                lines.append(fmt_density_row(book, kind))
    lines.append("")

    lines.append("### Per-kind cross-book verdict (top-2 ordered top-2 ranking stability)")
    lines.append("")
    lines.append("| Kind | Book top-2 | Books agreeing | Median top1/top2 ratio | Verdict |")
    lines.append("|------|------------|----------------|------------------------|---------|")
    for kind in ACTIVE_KINDS:
        v = per_kind_verdict[kind]
        per_book = "; ".join(
            f"{b}: {' > '.join(senses)}" for b, senses in v["per_book_top2"].items()
        )
        ratio = v["median_dominant_ratio_top1_over_top2"]
        ratio_str = f"{ratio:.2f}×" if ratio is not None else "—"
        lines.append(
            f"| {kind} | {per_book} | {v['books_with_matching_top2']}/3 | "
            f"{ratio_str} | **{v['verdict']}** |"
        )
    lines.append("")
    lines.append(f"**Overall verdict:** {result['overall_verdict']}")
    lines.append("")

    lines.append("### Top-1 sense stability per kind")
    lines.append("")
    for kind in ACTIVE_KINDS:
        s = result["top1_stability"][kind]
        per_book = ", ".join(f"{b}={c}" for b, c in s["per_book_top1"].items())
        lines.append(
            f"- **{kind}** → {per_book} (stable_top1={s['stable_top1']})"
        )
    lines.append("")

    lines.append("### Findings")
    lines.append("")
    findings: list[str] = []
    # Generate readable findings about sight dominance, sound for dialogue, touch for action.
    for kind in ACTIVE_KINDS:
        v = per_kind_verdict[kind]
        # build a "sight > sound > touch" style string for the median-book top-3
        ref_book = books[0]
        ranking = rankings[ref_book][kind]
        order_str = " > ".join(e["sense"] for e in ranking)
        ratio = v["median_dominant_ratio_top1_over_top2"]
        ratio_str = f"~{ratio:.2f}× runner-up" if ratio else "no margin"
        findings.append(
            f"- **{kind}** — `{order_str}` ({v['verdict']}; median top-1 share {ratio_str}; "
            f"dominant_2x_ratio_met={v['dominant_2x_ratio_met']})."
        )
    lines.extend(findings)
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
    per_kind_verdict = result["per_kind_verdict"]
    rankings = result["rankings"]
    ref_book = result["books"][0]

    # Build a compact findings snippet for the roadmap row
    pass_kinds = [k for k, v in per_kind_verdict.items() if v["verdict"] == "PASS"]
    partial_kinds = [
        k for k, v in per_kind_verdict.items()
        if v["verdict"] in ("PASS_PARTIAL", "PASS_PARTIAL_TOP1")
    ]
    diverge_kinds = [
        k for k, v in per_kind_verdict.items() if v["verdict"] in ("DIVERGE", "KILL")
    ]

    # describe top-1 senses per kind for readability
    top1_by_kind = {
        kind: rankings[ref_book][kind][0]["sense"]
        for kind in ACTIVE_KINDS
        if kind in rankings.get(ref_book, {})
    }
    top1_str = ", ".join(f"{k}→{s}" for k, s in top1_by_kind.items())

    findings = (
        f"top-1 senses per kind ({top1_str}); "
        f"PASS={len(pass_kinds)}/4, PASS_PARTIAL={len(partial_kinds)}/4, "
        f"DIVERGE/KILL={len(diverge_kinds)}/4 across 3 books"
    )

    if overall == "PASS":
        verdict_short = "SHIP"
        recommend = "ship as writer-prompt per-kind sensory-target priors"
    elif overall in ("PASS_PARTIAL", "PASS_PARTIAL_TOP1"):
        verdict_short = "PASS_PARTIAL"
        recommend = "ship top-1 sense per kind as soft writer-prompt prior; defer rank-2 ordering"
    elif overall == "DIVERGE":
        verdict_short = "HOLD"
        recommend = "do not codify per-kind ordering as a prior; revisit with finer lexicon"
    else:
        verdict_short = "KILL"
        recommend = "no signal; drop as a writer-prompt prior"

    lever = (
        "writer-prompt per-kind sensory-target priors "
        "(e.g. description→sight-dominant; dialogue→sound-dominant; action→touch-blend); "
        "optional lint rule: warn when top-1 sense for kind is absent in beat"
    )

    new_row = (
        f"| 53 | **Sensory mode distribution per beat-kind** (`{commit}`): {findings} | "
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
    print(f"[pattern-53] {len(beats)} beats loaded; commit={commit}; ts={ts}")

    result = analyze(beats)
    json_path = write_json(result, ts)
    print(f"[pattern-53] JSON → {json_path}")

    append_conclusions(result, json_path, commit)
    print(f"[pattern-53] appended → {CONCLUSIONS_PATH}")

    insert_roadmap_row(result, json_path, commit)
    print(f"[pattern-53] inserted row → {ROADMAP_PATH}")

    # Print a terse summary to stdout
    print("\n=== Pattern 53 — overall verdict ===")
    print(f"verdict: {result['overall_verdict']}")
    for kind in ACTIVE_KINDS:
        v = result["per_kind_verdict"][kind]
        print(
            f"  {kind:>12s} → {v['verdict']:<22s} "
            f"agree={v['books_with_matching_top2']}/3 "
            f"top1/top2={v['median_dominant_ratio_top1_over_top2']}"
        )


if __name__ == "__main__":
    main()
