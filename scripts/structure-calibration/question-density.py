#!/usr/bin/env python3
"""
Pattern 59 — Question-mark density per beat-kind.

Hypothesis: Questions (interrogative sentences ending in `?`) cluster
differently per beat-kind:

    dialogue   = highest (characters ask questions)
    interiority = mid     (rhetorical / introspective questions)
    action     = low      (interrogative is rare in active prose)
    description = lowest  (descriptions don't ask)

Salvatore's interior monologue uses rhetorical questions for tension and
uncertainty; the per-kind density and top question-types may be a
writer-prompt prior.

Methodology (pure compute):
  1. Per beat: count `?` characters and extract individual question
     sentences. Density = 100 * count / words.
  2. Per (book, kind) cell: aggregate beat-level density (mean) plus
     pooled (length-weighted) density.
  3. Per-kind ordering: does dialogue > interiority > action > description
     hold cross-book?
  4. Question-type classification (heuristic, first-word-based):
       - wh-question (what/why/how/when/where/who/which/whom/whose)
       - yesno-question (do/did/does/are/is/was/were/can/could/will/would
         /should/shall/may/might/have/has/had/am/be/been/being)
       - tag-question (any sentence ending `, <word>?` of length <=3 words
         after the comma — e.g. "..., right?", "..., didn't he?")
       - other (everything else, including statement-cast and elliptic
         "Then?" / "Why?" -- the latter is wh, but "Indeed?" lands here)
     Tag-question is checked first (override on ANY first-word match).
  5. Clustered sequences: count maximal runs of consecutive `?`-ending
     sentences within a beat (length >= 2).
  6. Position analysis: join beats to scenes via `scene_id`; classify the
     beat's scene boundary (`chapter-open`, `chapter-close`, `bounded`,
     `unbounded`); compare question density at chapter-OPEN vs
     chapter-CLOSE vs internal scene-position.

Cross-book gate:
  PASS         — per-kind ordering reproduces 3/3 books
                 AND density spread <=30% per kind across books
                 AND question-type top-2 stable per kind across books
  PASS_PARTIAL — 2/3 reproduce or one of the 3 conditions stable
  DIVERGE      — unstable
  KILL         — no signal

Outputs:
  - JSON: novels/salvatore-icewind-dale/structure-calibration/
          crystal_shard.<TS>.question-density.json
  - Atomic-append to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert into docs/harness-tuning-roadmap.md (fcntl flock)
"""

from __future__ import annotations

import datetime as _dt
import fcntl
import json
import re
import subprocess
from collections import defaultdict, Counter
from pathlib import Path
from statistics import mean
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
SCENES_PATH = BUNDLE / "scenes.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

# ---------------------------------------------------------------------------
# Type classifier
# ---------------------------------------------------------------------------

ACTIVE_KINDS: Tuple[str, ...] = ("dialogue", "interiority", "action", "description")
EXPECTED_ORDER: Tuple[str, ...] = ("dialogue", "interiority", "action", "description")

WH_WORDS = {
    "what", "why", "how", "when", "where", "who", "which", "whom", "whose",
}
YESNO_WORDS = {
    "do", "did", "does", "are", "is", "was", "were", "can", "could", "will",
    "would", "should", "shall", "may", "might", "have", "has", "had",
    "am", "be", "been", "being", "ain", "aren", "isn", "wasn", "weren",
    "don", "doesn", "didn", "won", "wouldn", "shouldn", "couldn", "cannot",
    "haven", "hasn", "hadn",
}

# Strip leading quote marks, dashes, ellipses, whitespace before grabbing
# the first word for classification.
_LEADING_JUNK_RE = re.compile(
    r"^[\s\"\'‘’“”\-—–…\.\,\;\:]+",
    flags=re.UNICODE,
)
_FIRST_WORD_RE = re.compile(r"[A-Za-z]+(?:[\'’][A-Za-z]+)?")


def _normalize_first_token(s: str) -> str:
    s = _LEADING_JUNK_RE.sub("", s)
    m = _FIRST_WORD_RE.match(s)
    if not m:
        return ""
    tok = m.group(0).lower()
    # collapse contractions to the head ("didn't" -> "didn", "don't" -> "don")
    tok = tok.split("'")[0].split("’")[0]
    return tok


def _is_tag_question(sentence: str) -> bool:
    """Detect tag question: the question portion after the LAST comma is
    short (<=3 words) and ends with `?`. e.g. "..., right?" / "..., didn't he?"
    """
    s = sentence.rstrip()
    if not s.endswith("?"):
        return False
    body = s[:-1]
    if "," not in body:
        return False
    tail = body.rsplit(",", 1)[1].strip(" \"'‘’“”")
    if not tail:
        return False
    word_count = len(re.findall(r"[A-Za-z]+(?:[\'’][A-Za-z]+)?", tail))
    return 1 <= word_count <= 3


def classify_question(sentence: str) -> str:
    """Return one of: 'wh', 'yesno', 'tag', 'other'."""
    if _is_tag_question(sentence):
        return "tag"
    tok = _normalize_first_token(sentence)
    if not tok:
        return "other"
    if tok in WH_WORDS:
        return "wh"
    if tok in YESNO_WORDS:
        return "yesno"
    return "other"


# ---------------------------------------------------------------------------
# Sentence segmentation (lightweight — splits on `?`, `.`, `!` boundaries
# preserving the trailing `?` so we can identify which sentences ARE
# questions.)
# ---------------------------------------------------------------------------

# The text contains hard linebreaks (PDF artifacts). Strip them before
# segmentation. We only care about sentence boundaries marked by ? . !
_LINEBREAK_RE = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    return _LINEBREAK_RE.sub(" ", text or "").strip()


# Split into sentences while keeping the terminating punctuation. We use
# a regex that captures any maximal run of non-terminator chars followed
# by one or more terminators. This is intentionally simple — Salvatore's
# prose has straightforward punctuation; we don't need a full tokenizer.
_SENT_SPLIT_RE = re.compile(r"[^.!?]+[.!?]+|\s*[^.!?]+$")


def split_sentences(text: str) -> List[str]:
    text = normalize_text(text)
    if not text:
        return []
    raw = _SENT_SPLIT_RE.findall(text)
    return [s.strip() for s in raw if s.strip()]


def extract_questions(text: str) -> List[str]:
    """Return all sentence-ish substrings that end with `?`."""
    return [s for s in split_sentences(text) if s.endswith("?")]


# ---------------------------------------------------------------------------
# Cluster (consecutive question runs)
# ---------------------------------------------------------------------------

def question_cluster_runs(text: str) -> List[int]:
    """Return list of run-lengths for consecutive ?-terminated sentence runs
    of length >= 2. e.g. text with [stmt, q, q, stmt, q] -> [2]."""
    sents = split_sentences(text)
    if not sents:
        return []
    flags = [s.endswith("?") for s in sents]
    runs: List[int] = []
    cur = 0
    for f in flags:
        if f:
            cur += 1
        else:
            if cur >= 2:
                runs.append(cur)
            cur = 0
    if cur >= 2:
        runs.append(cur)
    return runs


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

def analyze(beats: List[dict], scenes: List[dict]) -> dict:
    # Map scene_id -> boundary (chapter-open / chapter-close / bounded / unbounded)
    scene_boundary: Dict[str, str] = {
        s["scene_id"]: s.get("boundary", "unknown") for s in scenes
    }

    # Per-cell accumulators
    cell_qmark_counts: Dict[Tuple[str, str], int] = defaultdict(int)
    cell_words: Dict[Tuple[str, str], int] = defaultdict(int)
    cell_beats: Dict[Tuple[str, str], int] = defaultdict(int)
    cell_per_beat_density: Dict[Tuple[str, str], List[float]] = defaultdict(list)
    cell_questions: Dict[Tuple[str, str], List[str]] = defaultdict(list)
    cell_typed: Dict[Tuple[str, str], Counter] = defaultdict(Counter)
    cell_cluster_runs: Dict[Tuple[str, str], List[int]] = defaultdict(list)

    # Position-based accumulators (per beat-kind, classified by beat's scene
    # boundary — this is a per-scene marker, but we use it as the closest
    # "chapter-open / -close / interior" signal available without joining
    # chapter-level structure separately.
    pos_qmark_counts: Dict[Tuple[str, str], int] = defaultdict(int)  # (kind, pos)
    pos_words: Dict[Tuple[str, str], int] = defaultdict(int)
    pos_beats: Dict[Tuple[str, str], int] = defaultdict(int)

    # Also: classify beats as chapter-open vs chapter-close vs internal at
    # the CHAPTER level (not scene). A beat is at chapter-open if it lives
    # in the FIRST scene of its chapter (scene with boundary='chapter-open');
    # at chapter-close if in the LAST scene (boundary='chapter-close');
    # internal otherwise. This is the position lens the methodology asks for.
    # Per-book per-chapter scene grouping lets us map beats to a per-chapter
    # position bucket.
    chapter_open_scenes: set = set()
    chapter_close_scenes: set = set()
    for s in scenes:
        if s.get("boundary") == "chapter-open":
            chapter_open_scenes.add(s["scene_id"])
        elif s.get("boundary") == "chapter-close":
            chapter_close_scenes.add(s["scene_id"])

    chpos_qmark_counts: Dict[Tuple[str, str], int] = defaultdict(int)
    chpos_words: Dict[Tuple[str, str], int] = defaultdict(int)
    chpos_beats: Dict[Tuple[str, str], int] = defaultdict(int)
    chpos_qmark_counts_per_book: Dict[Tuple[str, str, str], int] = defaultdict(int)
    chpos_words_per_book: Dict[Tuple[str, str, str], int] = defaultdict(int)

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
        scene_id = b.get("scene_id")

        n_q = text.count("?")
        d = density_per_100w(n_q, words)

        cell_qmark_counts[(book, kind)] += n_q
        cell_words[(book, kind)] += words
        cell_beats[(book, kind)] += 1
        cell_per_beat_density[(book, kind)].append(d)

        questions = extract_questions(text)
        for q in questions:
            qtype = classify_question(q)
            cell_typed[(book, kind)][qtype] += 1
            # keep up to 12 sample questions per cell (longer truncated)
            if len(cell_questions[(book, kind)]) < 12:
                trimmed = q if len(q) <= 240 else q[:237] + "..."
                cell_questions[(book, kind)].append(
                    {"text": trimmed, "type": qtype}
                )

        runs = question_cluster_runs(text)
        cell_cluster_runs[(book, kind)].extend(runs)

        # Scene-boundary position bucket (kept separately from chapter pos)
        bnd = scene_boundary.get(scene_id, "unknown")
        pos_qmark_counts[(kind, bnd)] += n_q
        pos_words[(kind, bnd)] += words
        pos_beats[(kind, bnd)] += 1

        # Chapter-open vs chapter-close vs internal classification
        if scene_id in chapter_open_scenes:
            chpos = "chapter-open"
        elif scene_id in chapter_close_scenes:
            chpos = "chapter-close"
        else:
            chpos = "internal"
        chpos_qmark_counts[(kind, chpos)] += n_q
        chpos_words[(kind, chpos)] += words
        chpos_beats[(kind, chpos)] += 1
        chpos_qmark_counts_per_book[(book, kind, chpos)] += n_q
        chpos_words_per_book[(book, kind, chpos)] += words

    # ---------- Build per-cell density tables ----------
    books = sorted({b for (b, _k) in cell_words.keys()})
    mean_density: Dict[str, Dict[str, float]] = defaultdict(dict)
    pooled_density: Dict[str, Dict[str, float]] = defaultdict(dict)
    cell_meta: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    for (book, kind), arr in cell_per_beat_density.items():
        mean_density[book][kind] = float(mean(arr)) if arr else 0.0
        pooled_density[book][kind] = density_per_100w(
            cell_qmark_counts[(book, kind)],
            cell_words[(book, kind)],
        )
        cell_meta[book][kind] = {
            "n_beats": cell_beats[(book, kind)],
            "n_words": cell_words[(book, kind)],
            "n_qmarks": cell_qmark_counts[(book, kind)],
            "mean_density_per_100w": round(mean_density[book][kind], 4),
            "pooled_density_per_100w": round(pooled_density[book][kind], 4),
        }

    # ---------- Per-kind ordering check ----------
    # For each book, rank kinds by pooled_density (length-weighted is the
    # right population-level statistic; mean density would over-weight
    # short beats with a single `?`).
    rankings: Dict[str, List[Tuple[str, float]]] = {}
    for book in books:
        ordered = sorted(
            [(k, pooled_density[book].get(k, 0.0)) for k in ACTIVE_KINDS],
            key=lambda kv: kv[1], reverse=True,
        )
        rankings[book] = ordered

    # 3/3 reproduction of the EXPECTED order?
    per_book_kind_order: Dict[str, List[str]] = {
        b: [k for k, _ in rankings[b]] for b in books
    }
    matches_expected = sum(
        1 for b in books if per_book_kind_order[b] == list(EXPECTED_ORDER)
    )
    # Also count common pairwise relationships across books
    relations = ("dialogue>interiority", "interiority>action", "action>description")
    relation_match: Dict[str, int] = {}
    for rel in relations:
        a, _b = rel.split(">")
        b_ = rel.split(">")[1]
        cnt = 0
        for book in books:
            if pooled_density[book].get(a, 0) > pooled_density[book].get(b_, 0):
                cnt += 1
        relation_match[rel] = cnt

    # Density spread per kind across books
    per_kind_spread: Dict[str, Dict[str, float]] = {}
    for kind in ACTIVE_KINDS:
        vals = [pooled_density[b].get(kind, 0.0) for b in books]
        if not vals or max(vals) == 0:
            per_kind_spread[kind] = {
                "min": 0.0, "max": 0.0, "spread_pct": 0.0,
            }
            continue
        mn, mx = min(vals), max(vals)
        # spread as percent of mean
        m = sum(vals) / len(vals)
        spread = 100.0 * (mx - mn) / m if m > 0 else 0.0
        per_kind_spread[kind] = {
            "values_per_book": {b: round(v, 4) for b, v in zip(books, vals)},
            "min": round(mn, 4),
            "max": round(mx, 4),
            "spread_pct_of_mean": round(spread, 2),
        }

    # ---------- Question-type breakdown ----------
    # Aggregate per (book, kind) typed counts; compute share within cell.
    typed_share: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    typed_top2: Dict[str, Dict[str, List[str]]] = defaultdict(dict)
    for (book, kind), counter in cell_typed.items():
        total = sum(counter.values()) or 1
        for t, n in counter.items():
            typed_share[book][kind][t] = round(100.0 * n / total, 2)
        ranked = sorted(counter.items(), key=lambda kv: kv[1], reverse=True)
        typed_top2[book][kind] = [t for t, _ in ranked[:2]]

    # Cross-book stability of top-2 per kind
    typed_top2_stable: Dict[str, dict] = {}
    for kind in ACTIVE_KINDS:
        per_book_top2 = {
            b: typed_top2.get(b, {}).get(kind, [])
            for b in books
        }
        # Set-equality of top-2
        sets = [tuple(sorted(v)) for v in per_book_top2.values()]
        unique_sets = set(sets)
        # Top-1 stability
        top1s = [v[0] if v else None for v in per_book_top2.values()]
        unique_top1 = set(t for t in top1s if t is not None)
        typed_top2_stable[kind] = {
            "per_book_top2": per_book_top2,
            "unique_top2_sets": len(unique_sets),
            "stable_top2": len(unique_sets) == 1,
            "stable_top1": len(unique_top1) == 1,
            "top1_books_agreeing": top1s.count(top1s[0]) if top1s and top1s[0] else 0,
        }

    # Aggregate type counts across the whole corpus per kind
    aggregate_typed: Dict[str, Counter] = {k: Counter() for k in ACTIVE_KINDS}
    for (book, kind), counter in cell_typed.items():
        aggregate_typed[kind].update(counter)
    aggregate_typed_share: Dict[str, Dict[str, float]] = {}
    for kind, counter in aggregate_typed.items():
        total = sum(counter.values()) or 1
        aggregate_typed_share[kind] = {
            t: round(100.0 * n / total, 2) for t, n in counter.items()
        }

    # ---------- Cluster runs ----------
    cluster_summary: Dict[str, Dict[str, dict]] = defaultdict(dict)
    for (book, kind), arr in cell_cluster_runs.items():
        if not arr:
            cluster_summary[book][kind] = {
                "n_clusters_ge2": 0,
                "max_run_length": 0,
                "beats_with_clusters": 0,
            }
            continue
        cluster_summary[book][kind] = {
            "n_clusters_ge2": len(arr),
            "max_run_length": max(arr),
            "mean_run_length": round(sum(arr) / len(arr), 2),
            "run_length_distribution": dict(Counter(arr)),
        }

    # ---------- Position analysis ----------
    # Scene-boundary lens (per kind × boundary)
    scene_pos_density: Dict[str, Dict[str, dict]] = defaultdict(dict)
    for (kind, bnd), n_q in pos_qmark_counts.items():
        words = pos_words[(kind, bnd)]
        scene_pos_density[kind][bnd] = {
            "n_beats": pos_beats[(kind, bnd)],
            "n_words": words,
            "n_qmarks": n_q,
            "density_per_100w": round(density_per_100w(n_q, words), 4),
        }

    # Chapter-position lens (per kind × open/close/internal)
    chapter_pos_density: Dict[str, Dict[str, dict]] = defaultdict(dict)
    for (kind, chpos), n_q in chpos_qmark_counts.items():
        words = chpos_words[(kind, chpos)]
        chapter_pos_density[kind][chpos] = {
            "n_beats": chpos_beats[(kind, chpos)],
            "n_words": words,
            "n_qmarks": n_q,
            "density_per_100w": round(density_per_100w(n_q, words), 4),
        }

    # Per-book chapter-position density (for cross-book stability of the
    # open/close pattern).
    chapter_pos_per_book: Dict[str, Dict[str, Dict[str, dict]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    for (book, kind, chpos), n_q in chpos_qmark_counts_per_book.items():
        words = chpos_words_per_book[(book, kind, chpos)]
        chapter_pos_per_book[book][kind][chpos] = {
            "n_qmarks": n_q,
            "n_words": words,
            "density_per_100w": round(density_per_100w(n_q, words), 4),
        }

    # Aggregate-only chapter-position density (kind-agnostic): is the
    # CHAPTER-OPEN beat more question-rich than CHAPTER-CLOSE / INTERNAL?
    overall_pos: Dict[str, dict] = {}
    for chpos in ("chapter-open", "chapter-close", "internal"):
        n_q = sum(
            chpos_qmark_counts.get((k, chpos), 0) for k in ACTIVE_KINDS
        )
        words = sum(chpos_words.get((k, chpos), 0) for k in ACTIVE_KINDS)
        overall_pos[chpos] = {
            "n_qmarks": n_q,
            "n_words": words,
            "density_per_100w": round(density_per_100w(n_q, words), 4),
        }

    # ---------- Verdict ----------
    # Three sub-signals:
    #   (a) per-kind expected ordering (3/3 books match the canonical order)
    #   (b) per-kind density spread <=30% across books for ALL kinds
    #   (c) per-kind question-type top-2 stable across books for ALL kinds
    expected_order_pass = matches_expected == len(books)
    spread_pass = all(
        per_kind_spread[k]["spread_pct_of_mean"] <= 30.0 for k in ACTIVE_KINDS
    )
    type_top2_pass = all(
        typed_top2_stable[k]["stable_top2"] for k in ACTIVE_KINDS
    )
    type_top1_pass = all(
        typed_top2_stable[k]["stable_top1"] for k in ACTIVE_KINDS
    )

    n_signals_passed = sum(
        [expected_order_pass, spread_pass, type_top2_pass]
    )

    if expected_order_pass and spread_pass and type_top2_pass:
        verdict = "PASS"
    elif (
        matches_expected >= 2 and (spread_pass or type_top1_pass)
    ) or n_signals_passed >= 2:
        verdict = "PASS_PARTIAL"
    elif matches_expected >= 2 or type_top1_pass:
        verdict = "PASS_PARTIAL"
    elif matches_expected == 0 and not type_top1_pass:
        verdict = "KILL"
    else:
        verdict = "DIVERGE"

    return {
        "books": books,
        "active_kinds": list(ACTIVE_KINDS),
        "expected_order": list(EXPECTED_ORDER),
        "skipped_beats": skipped,

        "cell_meta": cell_meta,
        "mean_density_per_100w": mean_density,
        "pooled_density_per_100w": pooled_density,

        "rankings": {
            b: [{"kind": k, "pooled_density_per_100w": round(v, 4)} for k, v in rankings[b]]
            for b in books
        },
        "per_book_kind_order": per_book_kind_order,
        "books_matching_expected_order": matches_expected,
        "expected_order_pass": expected_order_pass,
        "pairwise_relation_matches": relation_match,
        "per_kind_density_spread": per_kind_spread,
        "spread_pass_all_kinds_le30": spread_pass,

        "typed_share_per_book_per_kind": typed_share,
        "typed_top2_per_book_per_kind": typed_top2,
        "typed_top2_stability": typed_top2_stable,
        "type_top2_stable_all_kinds": type_top2_pass,
        "type_top1_stable_all_kinds": type_top1_pass,
        "aggregate_typed_share": aggregate_typed_share,

        "cluster_summary_per_book_per_kind": cluster_summary,

        "scene_position_density": scene_pos_density,
        "chapter_position_density": chapter_pos_density,
        "chapter_position_density_per_book": chapter_pos_per_book,
        "overall_chapter_position_density": overall_pos,

        "sample_questions_per_book_per_kind": {
            b: {
                k: cell_questions.get((b, k), [])
                for k in ACTIVE_KINDS
            }
            for b in books
        },

        "verdict": verdict,
        "verdict_components": {
            "expected_order_pass": expected_order_pass,
            "books_matching_expected_order": matches_expected,
            "spread_pass": spread_pass,
            "type_top2_pass": type_top2_pass,
            "type_top1_pass": type_top1_pass,
            "n_signals_passed": n_signals_passed,
        },
    }


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

def write_json(result: dict, ts: str) -> Path:
    path = OUT_DIR / f"crystal_shard.{ts}.question-density.json"
    payload = {
        "pattern_number": 59,
        "pattern_name": "Question-mark density per beat-kind",
        "timestamp": ts,
        "commit": commit_short(),
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        "scenes_path": str(SCENES_PATH.relative_to(REPO)),
        "wh_words": sorted(WH_WORDS),
        "yesno_words": sorted(YESNO_WORDS),
        "tag_question_rule": (
            "trailing-comma-clause of <=3 words ending with '?'; checked "
            "before first-word classifier."
        ),
        **result,
    }
    path.write_text(json.dumps(payload, indent=2, default=str))
    return path


def append_conclusions(result: dict, json_path: Path, commit: str) -> None:
    target = CONCLUSIONS_PATH

    books = result["books"]
    rankings = result["rankings"]
    pooled = result["pooled_density_per_100w"]
    typed_share = result["typed_share_per_book_per_kind"]
    typed_stab = result["typed_top2_stability"]
    spread = result["per_kind_density_spread"]
    cluster = result["cluster_summary_per_book_per_kind"]
    chpos_per_book = result["chapter_position_density_per_book"]
    overall_pos = result["overall_chapter_position_density"]
    samples = result["sample_questions_per_book_per_kind"]

    lines: List[str] = []
    lines.append("")
    lines.append("")
    lines.append("## Pattern 59: Question-mark density per kind")
    lines.append("")
    lines.append(
        f"_Pure-compute `?` count + heuristic question-type classifier across 3 books, "
        f"4 active beat-kinds. Scene-id join used for chapter-position lens. "
        f"Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")
    lines.append("### Methodology")
    lines.append(
        "- Per beat: `text.count('?')` for raw count; sentence segmentation on `[.!?]+` "
        "for question extraction; density per 100w."
    )
    lines.append(
        "- Per (book, kind): pooled (length-weighted) density used as the population "
        "statistic; per-beat mean reported alongside."
    )
    lines.append(
        "- Question type heuristic on first non-junk word (case-insensitive): "
        "**wh** (what/why/how/when/where/who/which/whom/whose), "
        "**yesno** (do/did/does/are/is/was/were/can/could/will/would/should/shall/may/might/have/has/had/am/be), "
        "**tag** (`, <=3 words?` clause — overrides first-word classification), "
        "**other** (rest)."
    )
    lines.append(
        "- Cluster runs: maximal consecutive `?`-ending sentence runs of length >=2 within a beat."
    )
    lines.append(
        "- Position lens: beat -> scene_id -> scene boundary; chapter-open if scene's "
        "boundary='chapter-open', chapter-close similarly, else internal."
    )
    lines.append(
        "- Verdict gate: PASS = expected order (dialogue>interiority>action>description) holds 3/3 "
        "AND per-kind density spread <=30% AND question-type top-2 stable per kind 3/3."
    )
    lines.append(
        f"- {result['skipped_beats']} beats skipped (non-active kind, e.g. `stakes_recalibration` outlier, or empty)."
    )
    lines.append("")

    # ---------------- Per-book per-kind density ----------------
    lines.append("### Per-book per-kind question density (pooled per 100w)")
    lines.append("")
    lines.append("| Book | dialogue | interiority | action | description |")
    lines.append("|------|----------|-------------|--------|-------------|")
    for book in books:
        row = pooled.get(book, {})
        lines.append(
            f"| {book} | {row.get('dialogue', 0.0):.3f} | "
            f"{row.get('interiority', 0.0):.3f} | "
            f"{row.get('action', 0.0):.3f} | "
            f"{row.get('description', 0.0):.3f} |"
        )
    lines.append("")

    lines.append("### Per-book ranking (highest -> lowest)")
    lines.append("")
    for book in books:
        order = rankings[book]
        as_str = " > ".join(
            f"{e['kind']} {e['pooled_density_per_100w']:.3f}" for e in order
        )
        order_match = (
            "MATCH"
            if [e["kind"] for e in order] == list(EXPECTED_ORDER)
            else "MISS"
        )
        lines.append(f"- **{book}** -> {as_str} (`{order_match}` vs expected dialogue>interiority>action>description)")
    lines.append("")
    lines.append(
        f"**Books matching expected order:** {result['books_matching_expected_order']}/{len(books)} "
        f"(expected_order_pass={result['expected_order_pass']})."
    )
    lines.append("")

    # ---------------- Pairwise relations ----------------
    lines.append("### Pairwise relation cross-book check")
    lines.append("")
    for rel, m in result["pairwise_relation_matches"].items():
        lines.append(f"- `{rel}` -> {m}/{len(books)} books")
    lines.append("")

    # ---------------- Density spread ----------------
    lines.append("### Per-kind density spread across books")
    lines.append("")
    lines.append("| Kind | min | max | spread % of mean | <=30%? |")
    lines.append("|------|-----|-----|------------------|--------|")
    for kind in ACTIVE_KINDS:
        s = spread[kind]
        lines.append(
            f"| {kind} | {s['min']:.3f} | {s['max']:.3f} | "
            f"{s['spread_pct_of_mean']:.1f}% | "
            f"{'yes' if s['spread_pct_of_mean'] <= 30.0 else 'no'} |"
        )
    lines.append("")
    lines.append(
        f"**spread_pass_all_kinds_le30:** {result['spread_pass_all_kinds_le30']}"
    )
    lines.append("")

    # ---------------- Question-type breakdown ----------------
    lines.append("### Question-type share per book per kind (% within cell)")
    lines.append("")
    for kind in ACTIVE_KINDS:
        lines.append(f"- **{kind}**")
        for book in books:
            row = typed_share.get(book, {}).get(kind, {})
            if not row:
                lines.append(f"  - {book}: (no questions in cell)")
                continue
            ordered = sorted(row.items(), key=lambda kv: kv[1], reverse=True)
            cells = ", ".join(f"{t}={v:.1f}%" for t, v in ordered)
            top2 = typed_stab[kind]["per_book_top2"][book]
            lines.append(f"  - {book}: {cells} | top-2={top2}")
    lines.append("")

    lines.append("### Question-type top-2 stability per kind across books")
    lines.append("")
    lines.append("| Kind | per-book top-2 sets | stable_top1 | stable_top2 |")
    lines.append("|------|---------------------|-------------|-------------|")
    for kind in ACTIVE_KINDS:
        s = typed_stab[kind]
        per_book = "; ".join(
            f"{b}={top}" for b, top in s["per_book_top2"].items()
        )
        lines.append(
            f"| {kind} | {per_book} | "
            f"{'yes' if s['stable_top1'] else 'no'} | "
            f"{'yes' if s['stable_top2'] else 'no'} |"
        )
    lines.append("")

    # Aggregate share for context
    lines.append("### Aggregate question-type share (corpus-wide per kind)")
    lines.append("")
    agg = result["aggregate_typed_share"]
    lines.append("| Kind | wh | yesno | tag | other |")
    lines.append("|------|----|-------|-----|-------|")
    for kind in ACTIVE_KINDS:
        row = agg.get(kind, {})
        lines.append(
            f"| {kind} | {row.get('wh', 0.0):.1f}% | "
            f"{row.get('yesno', 0.0):.1f}% | "
            f"{row.get('tag', 0.0):.1f}% | "
            f"{row.get('other', 0.0):.1f}% |"
        )
    lines.append("")

    # ---------------- Cluster sequences ----------------
    lines.append("### Question-cluster sequences (consecutive `?`-sentence runs >= 2 within a beat)")
    lines.append("")
    lines.append("| Book | Kind | n_clusters>=2 | max_run | mean_run | run distribution |")
    lines.append("|------|------|---------------|---------|----------|------------------|")
    for book in books:
        for kind in ACTIVE_KINDS:
            c = cluster.get(book, {}).get(kind, {})
            if not c or c.get("n_clusters_ge2", 0) == 0:
                lines.append(f"| {book} | {kind} | 0 | 0 | - | - |")
                continue
            dist = c.get("run_length_distribution", {})
            dist_str = ", ".join(f"{k}={v}" for k, v in sorted(dist.items()))
            lines.append(
                f"| {book} | {kind} | {c['n_clusters_ge2']} | "
                f"{c['max_run_length']} | "
                f"{c.get('mean_run_length', '-')} | {dist_str} |"
            )
    lines.append("")

    # ---------------- Position analysis ----------------
    lines.append("### Chapter-position lens — question density per 100w")
    lines.append("")
    lines.append("Aggregate (kind-agnostic):")
    lines.append("")
    lines.append("| Position | n_beats? | n_words | n_qmarks | density |")
    lines.append("|----------|----------|---------|----------|---------|")
    for chpos in ("chapter-open", "chapter-close", "internal"):
        p = overall_pos[chpos]
        lines.append(
            f"| {chpos} | (sum of kinds) | {p['n_words']} | "
            f"{p['n_qmarks']} | {p['density_per_100w']:.3f} |"
        )
    lines.append("")
    lines.append("Per book × kind (density per 100w):")
    lines.append("")
    lines.append("| Book | Kind | open | close | internal |")
    lines.append("|------|------|------|-------|----------|")
    for book in books:
        for kind in ACTIVE_KINDS:
            row = chpos_per_book.get(book, {}).get(kind, {})
            o = row.get("chapter-open", {}).get("density_per_100w", 0.0)
            c = row.get("chapter-close", {}).get("density_per_100w", 0.0)
            i = row.get("internal", {}).get("density_per_100w", 0.0)
            lines.append(
                f"| {book} | {kind} | {o:.3f} | {c:.3f} | {i:.3f} |"
            )
    lines.append("")

    # ---------------- Sample questions ----------------
    lines.append("### Sample questions (up to 6 per book × kind)")
    lines.append("")
    for book in books:
        for kind in ACTIVE_KINDS:
            qs = samples.get(book, {}).get(kind, [])[:6]
            if not qs:
                continue
            lines.append(f"- **{book} / {kind}** ({len(qs)} shown)")
            for q in qs:
                t = q["text"].replace("\n", " ").strip()
                lines.append(f"  - [{q['type']}] {t}")
    lines.append("")

    # ---------------- Findings ----------------
    lines.append("### Findings & verdict")
    lines.append("")
    lines.append(
        f"**Overall verdict:** **{result['verdict']}**"
    )
    lines.append("")
    vc = result["verdict_components"]
    lines.append(
        f"- Expected ordering pass: {vc['expected_order_pass']} "
        f"({vc['books_matching_expected_order']}/{len(books)})"
    )
    lines.append(f"- Density spread <=30% all kinds: {vc['spread_pass']}")
    lines.append(f"- Question-type top-2 stable per kind 3/3: {vc['type_top2_pass']}")
    lines.append(f"- Question-type top-1 stable per kind 3/3: {vc['type_top1_pass']}")
    lines.append(f"- Signals passed (of 3): {vc['n_signals_passed']}")
    lines.append("")

    # Compact closing summary lines
    findings: List[str] = []
    for kind in ACTIVE_KINDS:
        per_book_dens = [pooled[b].get(kind, 0.0) for b in books]
        s = spread[kind]
        agg_share = result["aggregate_typed_share"].get(kind, {})
        top2 = sorted(agg_share.items(), key=lambda kv: kv[1], reverse=True)[:2]
        top2_str = ", ".join(f"{t}={v:.0f}%" for t, v in top2)
        findings.append(
            f"- **{kind}** -> "
            f"per-book pooled density {[round(v, 3) for v in per_book_dens]} "
            f"(spread {s['spread_pct_of_mean']:.0f}%); aggregate top-2 type {top2_str}."
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

    pooled = result["pooled_density_per_100w"]
    books = result["books"]
    spread = result["per_kind_density_spread"]
    chpos_per_book = result["chapter_position_density_per_book"]
    overall_pos = result["overall_chapter_position_density"]
    typed_stab = result["typed_top2_stability"]

    # Compose findings snippet
    per_book_dialog = [pooled[b].get("dialogue", 0.0) for b in books]
    per_book_inter = [pooled[b].get("interiority", 0.0) for b in books]
    per_book_action = [pooled[b].get("action", 0.0) for b in books]
    per_book_desc = [pooled[b].get("description", 0.0) for b in books]

    n_match_order = result["books_matching_expected_order"]
    spread_pass = result["spread_pass_all_kinds_le30"]
    type_top2_pass = result["type_top2_stable_all_kinds"]
    type_top1_pass = result["type_top1_stable_all_kinds"]

    open_d = overall_pos["chapter-open"]["density_per_100w"]
    close_d = overall_pos["chapter-close"]["density_per_100w"]
    internal_d = overall_pos["internal"]["density_per_100w"]

    findings = (
        f"per-kind pooled `?`/100w (CS/SoS/HG): "
        f"dialogue {per_book_dialog[0]:.2f}/{per_book_dialog[1]:.2f}/{per_book_dialog[2]:.2f}; "
        f"interiority {per_book_inter[0]:.2f}/{per_book_inter[1]:.2f}/{per_book_inter[2]:.2f}; "
        f"action {per_book_action[0]:.2f}/{per_book_action[1]:.2f}/{per_book_action[2]:.2f}; "
        f"description {per_book_desc[0]:.2f}/{per_book_desc[1]:.2f}/{per_book_desc[2]:.2f}. "
        f"Expected ordering dialogue>interiority>action>description holds {n_match_order}/3 books; "
        f"spread<=30% per kind {'PASS' if spread_pass else 'FAIL'}; "
        f"type top-2 stable per kind {'PASS' if type_top2_pass else 'FAIL'} "
        f"(top-1 stable {'PASS' if type_top1_pass else 'FAIL'}). "
        f"Aggregate chapter-position density: open {open_d:.2f} / close {close_d:.2f} / internal {internal_d:.2f} per 100w."
    )

    verdict = result["verdict"]
    if verdict == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship per-kind question-density priors + question-type top-2 prior "
            "(dialogue=wh+yesno; interiority=wh+other) as writer-prompt prior"
        )
    elif verdict == "PASS_PARTIAL":
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship the stable component(s); defer the components that miss the gate"
        )
    elif verdict == "DIVERGE":
        verdict_short = "HOLD"
        recommend = "do not codify; revisit with a finer classifier or richer corpus"
    else:
        verdict_short = "KILL"
        recommend = "no signal; drop as a writer-prompt prior"

    lever = (
        "writer-prompt per-kind question-density target + question-type mix prior "
        "(e.g. dialogue questions skew wh+yesno; interiority skews wh-rhetorical); "
        "optional lint: warn when interiority beat has zero `?` for a tense scene; "
        "optional lint: dialogue-kind beat with consecutive 3+ `?`-sentences (rare cluster)"
    )

    new_row = (
        f"| 59 | **Question-mark density per kind** (`{commit}`): {findings} | "
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
                raise SystemExit("ERROR: anchor '\\n**Sequencing' not found in roadmap")
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
    beats = load_jsonl(BEATS_PATH)
    scenes = load_jsonl(SCENES_PATH)
    print(f"[pattern-59] {len(beats)} beats / {len(scenes)} scenes loaded; commit={commit}; ts={ts}")

    result = analyze(beats, scenes)
    json_path = write_json(result, ts)
    print(f"[pattern-59] JSON -> {json_path}")

    append_conclusions(result, json_path, commit)
    print(f"[pattern-59] appended -> {CONCLUSIONS_PATH}")

    insert_roadmap_row(result, json_path, commit)
    print(f"[pattern-59] inserted row -> {ROADMAP_PATH}")

    # Terse summary
    print("\n=== Pattern 59 — overall verdict ===")
    print(f"verdict: {result['verdict']}")
    print(f"  books_matching_expected_order: {result['books_matching_expected_order']}/3")
    print(f"  spread_pass_all_kinds_le30: {result['spread_pass_all_kinds_le30']}")
    print(f"  type_top2_stable_all_kinds: {result['type_top2_stable_all_kinds']}")
    print(f"  type_top1_stable_all_kinds: {result['type_top1_stable_all_kinds']}")

    print("\nPer-book pooled density per 100w (kind: dialogue / interiority / action / description):")
    for book in result["books"]:
        d = result["pooled_density_per_100w"][book]
        print(
            f"  {book}: "
            f"dial={d.get('dialogue', 0.0):.3f}, "
            f"inter={d.get('interiority', 0.0):.3f}, "
            f"act={d.get('action', 0.0):.3f}, "
            f"desc={d.get('description', 0.0):.3f}"
        )


if __name__ == "__main__":
    main()
