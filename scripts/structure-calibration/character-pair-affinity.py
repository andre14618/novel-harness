"""
Pattern 74 — Character-pair scene affinity (fellowship-restricted, Jaccard-style).

P22 measured ENSEMBLE SIZE per beat (solo / duo / trio+). P40 measured per-
character DIALOGUE MASS. Neither captures *which character pairs share the
most scenes* — Drizzt+Bruenor vs Drizzt+Wulfgar vs Bruenor+Catti-brie etc.

This pattern computes a fellowship-restricted (5 core members → 10 unordered
pairs) affinity matrix per book. Affinity is Jaccard:

    affinity(X, Y) = |scenes(X) ∩ scenes(Y)| / |scenes(X) ∪ scenes(Y)|

Then it asks three questions:

  1. Top-3 most-affined pairs reproduce 3/3 books?
  2. Top-pair stable cross-book?
  3. Spread between most-affined and least-affined pair stable cross-book?

It also runs a marginal-vs-joint independence test: under independence,
expected_joint(X, Y) = P(X) × P(Y). Pairs whose actual joint rate exceeds
this 1.5× are "stuck-together" (narratively bound); pairs that fall below
are "narratively-separated" (split-mission pairs). Per-book trajectory
inspects whether each pair's affinity rises / falls / stays flat across
the trilogy.

Methodology:
  - Presence detection per scene: regex over scene text (≥2 mentions of any
    canonical alias) OR speaker-attribution hits in the dialogue-extract for
    a beat in that scene. The 2-mention floor matches P22's convention and
    suppresses single-name-drop noise.
  - Pure compute, no LLM call.
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import subprocess
import sys
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any

_LIB_DIR = Path(__file__).resolve().parent / "lib"
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from directional_gate import (  # noqa: E402
    Verdict,
    combine_gates,
    gate_density_spread,
    gate_ranking_jaccard,
    gate_top_k_overlap,
)
from atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)

# ---------------------------------------------------------------------------
# Pattern identity
# ---------------------------------------------------------------------------

PATTERN_NUMBER: int = 74
PATTERN_NAME: str = "Character-pair scene affinity"
PATTERN_SLUG: str = "character-pair-affinity"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
CORPUS_KEY = "salvatore-icewind-dale"
BUNDLE = REPO / "novels" / CORPUS_KEY
BEATS_PATH = BUNDLE / "beats.jsonl"
SCENES_PATH = BUNDLE / "scenes.jsonl"
DIALOGUE_PATH = BUNDLE / "analysis" / "dialogue-extract.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

BOOK_ORDER = ["crystal_shard", "streams_of_silver", "halflings_gem"]
ROADMAP_ANCHOR = "\n**Sequencing"

# ---------------------------------------------------------------------------
# Fellowship registry — 5 canonical Companions of the Hall, with aliases
# ---------------------------------------------------------------------------
#
# Aliases collapsed to the canonical name. `Catti-brie` and `Catti` both
# map to `Catti-brie` (the corpus uses both forms). `Regis` and
# `Rumblebelly` both map to `Regis` (Bruenor's nickname for him).
# Each alias is matched on word-boundary, case-insensitive.

FELLOWSHIP: tuple[str, ...] = ("Drizzt", "Bruenor", "Wulfgar", "Catti-brie", "Regis")

ALIASES: dict[str, list[str]] = {
    "Drizzt": [r"Drizzt", r"Do'Urden"],
    "Bruenor": [r"Bruenor", r"Battlehammer"],
    # Wulfgar has no widespread alternate name; keeping just the canonical
    "Wulfgar": [r"Wulfgar"],
    # Catti-brie appears as "Catti-brie", "Catti" (Bruenor's diminutive form),
    # and on rare occasion just "Catti". The hyphenated form must be matched
    # before the bare one, otherwise "Catti" alone in a "Catti-brie" string
    # would double-count. We resolve this with a single regex per character
    # that is either-or so each text position is matched at most once.
    "Catti-brie": [r"Catti-?brie", r"Catti(?!-?brie)"],
    "Regis": [r"Regis", r"Rumblebelly"],
}

# Compiled per-character regex. We use word-boundary on the leading edge;
# trailing edge is whatever the alternation produces. The negative lookahead
# in the Catti-brie bare-form alias ensures "Catti" alone doesn't fire when
# the source text says "Catti-brie".
PATTERNS: dict[str, re.Pattern[str]] = {
    ch: re.compile(r"\b(?:" + "|".join(aliases) + r")", re.IGNORECASE)
    for ch, aliases in ALIASES.items()
}

# Presence threshold per scene — must match at least this many alias hits
# for the character to be counted as "present in this scene". Matches P22.
PRESENCE_THRESHOLD = 2


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def load_beats() -> list[dict[str, Any]]:
    return _load_jsonl(BEATS_PATH)


def load_scenes() -> list[dict[str, Any]]:
    return _load_jsonl(SCENES_PATH)


def load_dialogue() -> list[dict[str, Any]]:
    if not DIALOGUE_PATH.exists():
        return []
    return _load_jsonl(DIALOGUE_PATH)


def commit_short() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


# ---------------------------------------------------------------------------
# Per-scene character-set computation
# ---------------------------------------------------------------------------


def _beat_id_to_scene_id(beat_id: str) -> str:
    """Strip the trailing `_b<N>` from a beat_id to recover the scene_id.

    Dialogue-extract stores beat_ids like `crystal_shard_ch12_s1_b8`; the
    scene id is `crystal_shard_ch12_s1`. If the suffix is missing, returns
    the input unchanged."""
    m = re.match(r"^(.+?)_b\d+$", beat_id)
    return m.group(1) if m else beat_id


def build_scene_text(beats: list[dict[str, Any]], scenes: list[dict[str, Any]]) -> dict[str, str]:
    """Concatenate beat texts back into a per-scene corpus.

    Uses scenes.jsonl's `text` field as primary source (each scene already
    holds the full prose), falling back to concatenating beats grouped by
    scene_id when the scene-level text is missing.
    """
    scene_text: dict[str, str] = {}
    # Primary: scenes.jsonl has full text per scene.
    for s in scenes:
        sid = s.get("scene_id")
        if not sid:
            continue
        if "text" in s and s["text"]:
            scene_text[sid] = s["text"]
    # Fallback / supplement: append any beat texts whose scene_id isn't
    # present in scenes.jsonl (defensive — shouldn't happen on a healthy bundle).
    by_scene_beats: dict[str, list[str]] = defaultdict(list)
    for b in beats:
        sid = b.get("scene_id")
        if not sid:
            continue
        by_scene_beats[sid].append(b.get("text") or "")
    for sid, parts in by_scene_beats.items():
        if sid not in scene_text:
            scene_text[sid] = "\n".join(p for p in parts if p)
    return scene_text


def detect_scene_characters(
    scene_text: dict[str, str],
    dialogue_speakers_per_scene: dict[str, set[str]],
) -> dict[str, set[str]]:
    """Resolve per-scene canonical character set.

    A character is counted as PRESENT if EITHER:
      (a) their alias regex matches ≥ PRESENCE_THRESHOLD times in the
          scene's prose text, OR
      (b) the dialogue-extract attributes ≥ 1 quote inside the scene to
          them. (Speaker attribution is a strong positive signal — if you
          spoke in the scene, you're present, even at 1 hit.)
    """
    out: dict[str, set[str]] = {}
    for sid, text in scene_text.items():
        present: set[str] = set()
        for ch, pat in PATTERNS.items():
            n_hits = len(pat.findall(text))
            if n_hits >= PRESENCE_THRESHOLD:
                present.add(ch)
        # Union with dialogue-attributed speakers (lower threshold — single
        # quote is enough since attribution implies on-stage presence).
        present.update(dialogue_speakers_per_scene.get(sid, set()))
        out[sid] = present
    return out


def build_dialogue_speakers_per_scene(
    dialogue: list[dict[str, Any]],
) -> dict[str, set[str]]:
    """Map scene_id → set of fellowship speakers attested by dialogue extract."""
    out: dict[str, set[str]] = defaultdict(set)
    for d in dialogue:
        ch = d.get("char")
        bid = d.get("beat_id")
        if not ch or not bid:
            continue
        if ch not in FELLOWSHIP:
            continue
        sid = _beat_id_to_scene_id(bid)
        out[sid].add(ch)
    return out


# ---------------------------------------------------------------------------
# Per-book affinity computation
# ---------------------------------------------------------------------------


def compute_per_book_affinity(
    scene_book: dict[str, str],
    scene_chars: dict[str, set[str]],
) -> dict[str, dict[str, Any]]:
    """For each book, compute the 5×5 fellowship affinity matrix + supporting stats.

    Returns a dict keyed by book name with these fields:
      - n_scenes_total: int (book's total scene count)
      - per_char_scene_count: dict[char → n scenes containing char]
      - per_char_marginal_rate: dict[char → P(char in scene)]
      - per_pair: dict[pair_key → {
            n_intersection, n_union, jaccard,
            actual_joint_rate, expected_joint_rate, lift_over_independent,
            relation: "stuck_together" | "neutral" | "narratively_separated",
        }]
      - top3_pairs_by_jaccard: list[pair_key]
      - top_pair: pair_key | None
      - bottom_pair: pair_key | None
      - jaccard_spread: max - min jaccard across the 10 pairs
    """
    per_book: dict[str, dict[str, Any]] = {}
    # Bucket scenes by book
    scenes_by_book: dict[str, list[str]] = defaultdict(list)
    for sid, book in scene_book.items():
        scenes_by_book[book].append(sid)

    for book in BOOK_ORDER:
        book_scene_ids = scenes_by_book.get(book, [])
        n_scenes_total = len(book_scene_ids)
        # Scenes containing each character
        char_scenes: dict[str, set[str]] = {ch: set() for ch in FELLOWSHIP}
        for sid in book_scene_ids:
            for ch in scene_chars.get(sid, set()):
                if ch in FELLOWSHIP:
                    char_scenes[ch].add(sid)

        per_char_scene_count = {ch: len(char_scenes[ch]) for ch in FELLOWSHIP}
        per_char_marginal_rate = {
            ch: (per_char_scene_count[ch] / n_scenes_total if n_scenes_total else 0.0)
            for ch in FELLOWSHIP
        }

        per_pair: dict[str, dict[str, Any]] = {}
        for a, b in combinations(FELLOWSHIP, 2):
            sa = char_scenes[a]
            sb = char_scenes[b]
            inter = sa & sb
            union = sa | sb
            n_inter = len(inter)
            n_union = len(union)
            jaccard = (n_inter / n_union) if n_union else 0.0
            actual_joint_rate = (n_inter / n_scenes_total) if n_scenes_total else 0.0
            expected_joint_rate = (
                per_char_marginal_rate[a] * per_char_marginal_rate[b]
            )
            lift = (
                (actual_joint_rate / expected_joint_rate)
                if expected_joint_rate > 0
                else None
            )
            if lift is None:
                relation = "indeterminate"
            elif lift >= 1.5:
                relation = "stuck_together"
            elif lift <= 0.67:
                relation = "narratively_separated"
            else:
                relation = "neutral"
            pair_key = "+".join(sorted([a, b]))
            per_pair[pair_key] = {
                "pair": [a, b],
                "n_intersection": n_inter,
                "n_union": n_union,
                "jaccard": round(jaccard, 4),
                "actual_joint_rate": round(actual_joint_rate, 4),
                "expected_joint_rate": round(expected_joint_rate, 4),
                "lift_over_independent": round(lift, 3) if lift is not None else None,
                "relation": relation,
            }

        # Rank pairs by Jaccard
        pair_keys_ranked = sorted(
            per_pair.keys(),
            key=lambda k: per_pair[k]["jaccard"],
            reverse=True,
        )
        top3 = pair_keys_ranked[:3]
        top_pair = pair_keys_ranked[0] if pair_keys_ranked else None
        bottom_pair = pair_keys_ranked[-1] if pair_keys_ranked else None
        jaccard_spread = (
            per_pair[top_pair]["jaccard"] - per_pair[bottom_pair]["jaccard"]
            if top_pair and bottom_pair
            else 0.0
        )

        per_book[book] = {
            "n_scenes_total": n_scenes_total,
            "per_char_scene_count": per_char_scene_count,
            "per_char_marginal_rate": {k: round(v, 4) for k, v in per_char_marginal_rate.items()},
            "per_pair": per_pair,
            "pair_keys_ranked_by_jaccard": pair_keys_ranked,
            "top3_pairs_by_jaccard": top3,
            "top_pair": top_pair,
            "bottom_pair": bottom_pair,
            "jaccard_spread": round(jaccard_spread, 4),
        }
    return per_book


# ---------------------------------------------------------------------------
# Cross-book trajectory analysis
# ---------------------------------------------------------------------------


def compute_trajectories(
    per_book: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """For each pair, build the 3-book Jaccard trajectory + a sign-of-effect tag."""
    trajectories: dict[str, dict[str, Any]] = {}
    for a, b in combinations(FELLOWSHIP, 2):
        pair_key = "+".join(sorted([a, b]))
        per_book_jaccards = [
            per_book[book]["per_pair"][pair_key]["jaccard"] for book in BOOK_ORDER
        ]
        # Sign-of-effect: monotonic up / monotonic down / mixed / flat
        diff_1 = per_book_jaccards[1] - per_book_jaccards[0]
        diff_2 = per_book_jaccards[2] - per_book_jaccards[1]
        # Treat changes < 0.02 in absolute terms as flat (within typical
        # per-book variance noise).
        FLAT_BAND = 0.02
        if abs(diff_1) < FLAT_BAND and abs(diff_2) < FLAT_BAND:
            sign = "flat"
        elif diff_1 > 0 and diff_2 > 0:
            sign = "monotonic_up"
        elif diff_1 < 0 and diff_2 < 0:
            sign = "monotonic_down"
        elif diff_1 > 0 and diff_2 < 0 and abs(diff_2) < abs(diff_1) and per_book_jaccards[2] > per_book_jaccards[0]:
            sign = "rising_with_dip"
        elif diff_1 < 0 and diff_2 > 0 and per_book_jaccards[2] < per_book_jaccards[0]:
            sign = "falling_with_bump"
        else:
            sign = "mixed"
        trajectories[pair_key] = {
            "pair": [a, b],
            "jaccards": [round(j, 4) for j in per_book_jaccards],
            "delta_b1_to_b2": round(diff_1, 4),
            "delta_b2_to_b3": round(diff_2, 4),
            "sign": sign,
        }
    return trajectories


# ---------------------------------------------------------------------------
# Verdict gating
# ---------------------------------------------------------------------------


def evaluate_gates(per_book: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Run the three pattern gates per the charter:
      G1 — top-3 most-affined pairs reproduce 3/3 books?
      G2 — top-pair stable cross-book?
      G3 — most-affined-vs-least-affined ratio stable (≤30% spread)?
    """
    # Gate 1: top-3 ranking Jaccard across books (set semantics)
    per_book_top3 = {
        book: per_book[book]["top3_pairs_by_jaccard"] for book in BOOK_ORDER
    }
    g1_jaccard, g1_verdict = gate_ranking_jaccard(per_book_top3, top_n=3)

    # Bonus: top-3 set intersection across all 3 books (PASS if all 3
    # books agree on the same 3-pair set; PASS_PARTIAL if 2/3 overlap;
    # DIVERGE if 0 overlap).
    per_book_top3_sets = {
        book: set(per_book[book]["top3_pairs_by_jaccard"]) for book in BOOK_ORDER
    }
    g1_overlap_size, g1_overlap_verdict = gate_top_k_overlap(
        per_book_top3_sets, top_n=3, min_shared_pairs=3
    )

    # Gate 2: top-pair stability — modal-class agreement across the
    # rank-1 pair of each book. We use ranking-jaccard with top_n=1 to
    # leverage the same threshold semantics; equivalently, all 3 books
    # must agree on the rank-1 pair to PASS.
    per_book_top1 = {
        book: per_book[book]["top3_pairs_by_jaccard"][:1] for book in BOOK_ORDER
    }
    g2_top1_jaccard, g2_top1_verdict = gate_ranking_jaccard(per_book_top1, top_n=1)

    # Gate 3: jaccard spread (most-affined - least-affined) per book.
    # Stable if max-min/mean ≤ 30%.
    spread_per_book = {
        book: per_book[book]["jaccard_spread"] for book in BOOK_ORDER
    }
    g3_verdict = gate_density_spread(spread_per_book, threshold_pct=30.0)

    # Combine all three gates
    overall = combine_gates([g1_verdict, g2_top1_verdict, g3_verdict])

    return {
        "gate1_top3_ranking_jaccard": {
            "per_book_top3": per_book_top3,
            "mean_pairwise_jaccard": g1_jaccard,
            "verdict": g1_verdict,
        },
        "gate1_bonus_top3_set_overlap": {
            "intersection_size": g1_overlap_size,
            "verdict": g1_overlap_verdict,
        },
        "gate2_top_pair_stability": {
            "per_book_top1": per_book_top1,
            "mean_pairwise_jaccard": g2_top1_jaccard,
            "verdict": g2_top1_verdict,
        },
        "gate3_jaccard_spread": {
            "spread_per_book": spread_per_book,
            "verdict": g3_verdict,
        },
        "overall": overall,
    }


# ---------------------------------------------------------------------------
# Cross-book summaries
# ---------------------------------------------------------------------------


def summarize_relations(per_book: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Roll up the marginal-vs-joint relation across books, returning the
    pairs that are stuck-together or narratively-separated in N/3 books."""
    pair_relations: dict[str, list[str]] = defaultdict(list)
    pair_lifts: dict[str, list[float | None]] = defaultdict(list)
    for a, b in combinations(FELLOWSHIP, 2):
        key = "+".join(sorted([a, b]))
        for book in BOOK_ORDER:
            entry = per_book[book]["per_pair"][key]
            pair_relations[key].append(entry["relation"])
            pair_lifts[key].append(entry["lift_over_independent"])

    stuck_in_all_3 = sorted(
        k for k, rels in pair_relations.items() if all(r == "stuck_together" for r in rels)
    )
    stuck_in_2_or_more = sorted(
        k for k, rels in pair_relations.items() if sum(1 for r in rels if r == "stuck_together") >= 2
    )
    separated_in_all_3 = sorted(
        k
        for k, rels in pair_relations.items()
        if all(r == "narratively_separated" for r in rels)
    )
    separated_in_2_or_more = sorted(
        k
        for k, rels in pair_relations.items()
        if sum(1 for r in rels if r == "narratively_separated") >= 2
    )
    return {
        "pair_relations_per_book": {k: v for k, v in pair_relations.items()},
        "pair_lifts_per_book": {k: v for k, v in pair_lifts.items()},
        "stuck_together_in_all_3_books": stuck_in_all_3,
        "stuck_together_in_2_or_more_books": stuck_in_2_or_more,
        "narratively_separated_in_all_3_books": separated_in_all_3,
        "narratively_separated_in_2_or_more_books": separated_in_2_or_more,
    }


# ---------------------------------------------------------------------------
# Main analyze
# ---------------------------------------------------------------------------


def analyze() -> dict[str, Any]:
    beats = load_beats()
    scenes = load_scenes()
    dialogue = load_dialogue()

    # scene_id → book mapping (from scenes.jsonl)
    scene_book: dict[str, str] = {
        s["scene_id"]: s["book"] for s in scenes if s.get("scene_id") and s.get("book")
    }
    # Defensive: also ensure beats' scene_ids resolve
    for b in beats:
        sid = b.get("scene_id")
        if sid and sid not in scene_book and b.get("book"):
            scene_book[sid] = b["book"]

    scene_text = build_scene_text(beats, scenes)
    dialogue_per_scene = build_dialogue_speakers_per_scene(dialogue)
    scene_chars = detect_scene_characters(scene_text, dialogue_per_scene)

    per_book = compute_per_book_affinity(scene_book, scene_chars)
    trajectories = compute_trajectories(per_book)
    gates = evaluate_gates(per_book)
    relations = summarize_relations(per_book)

    # Build the human-readable findings_short for the roadmap row.
    overall = gates["overall"]
    g1_v = gates["gate1_top3_ranking_jaccard"]["verdict"]
    g1_j = gates["gate1_top3_ranking_jaccard"]["mean_pairwise_jaccard"]
    g2_v = gates["gate2_top_pair_stability"]["verdict"]
    g3_v = gates["gate3_jaccard_spread"]["verdict"]
    overlap_n = gates["gate1_bonus_top3_set_overlap"]["intersection_size"]

    per_book_top1_pairs = ", ".join(
        f"{b}={per_book[b]['top_pair']}" for b in BOOK_ORDER
    )
    findings_short = (
        f"top-3 cross-book Jaccard={g1_j} ({g1_v}); top-3 set intersection={overlap_n}/3; "
        f"top-pair stability={g2_v} (per-book top-pair: {per_book_top1_pairs}); "
        f"jaccard spread {g3_v}; "
        f"stuck-together-in-3-books={len(relations['stuck_together_in_all_3_books'])}, "
        f"separated-in-3-books={len(relations['narratively_separated_in_all_3_books'])}"
    )

    return {
        "per_book": per_book,
        "trajectories": trajectories,
        "gates": gates,
        "relations": relations,
        "verdict": overall,
        "gates_used": [
            "ranking_jaccard(top3)",
            "ranking_jaccard(top1)",
            "density_spread(jaccard_spread)",
            "top_k_overlap(top3_set)",
        ],
        "findings_short": findings_short,
    }


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------


def render_conclusions_md(result: dict[str, Any], json_path: Path, commit: str) -> str:
    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_NUMBER}: {PATTERN_NAME}")
    lines.append("")
    lines.append(
        f"_Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`. "
        f"Verdict: **{result['verdict']}**._"
    )
    lines.append("")
    lines.append(
        "Pure-compute, fellowship-restricted (5 core members → 10 unordered pairs). "
        "Presence: ≥2 alias hits in scene prose OR any speaker-attributed quote in a scene-beat. "
        "Affinity = Jaccard over per-character scene sets. Lift = actual_joint_rate / expected-by-marginal."
    )
    lines.append("")

    # Per-book Jaccard matrix table
    lines.append("### Per-book Jaccard affinity matrix (10 unordered pairs)")
    lines.append("")
    lines.append("| Pair | crystal_shard | streams_of_silver | halflings_gem |")
    lines.append("|------|---------------|-------------------|---------------|")
    for a, b in combinations(FELLOWSHIP, 2):
        key = "+".join(sorted([a, b]))
        cs = result["per_book"]["crystal_shard"]["per_pair"][key]["jaccard"]
        ss = result["per_book"]["streams_of_silver"]["per_pair"][key]["jaccard"]
        hg = result["per_book"]["halflings_gem"]["per_pair"][key]["jaccard"]
        lines.append(f"| {a}+{b} | {cs:.3f} | {ss:.3f} | {hg:.3f} |")
    lines.append("")

    # Per-book top-3 ranking
    lines.append("### Per-book top-3 most-affined pairs (by Jaccard)")
    lines.append("")
    for book in BOOK_ORDER:
        ranks = result["per_book"][book]["top3_pairs_by_jaccard"]
        rendered = []
        for k in ranks:
            pp = result["per_book"][book]["per_pair"][k]
            rendered.append(f"`{k}` (J={pp['jaccard']:.3f}, lift={pp['lift_over_independent']})")
        lines.append(f"- **{book}** → {' → '.join(rendered)}")
    lines.append("")

    # Per-book bottom-1 (least-affined)
    lines.append("### Per-book least-affined pair (rank-10)")
    lines.append("")
    for book in BOOK_ORDER:
        bp = result["per_book"][book]["bottom_pair"]
        if bp is None:
            continue
        pp = result["per_book"][book]["per_pair"][bp]
        lines.append(
            f"- **{book}** → `{bp}` (J={pp['jaccard']:.3f}, "
            f"lift={pp['lift_over_independent']}, relation={pp['relation']})"
        )
    lines.append("")

    # Marginal-vs-joint relation roll-up
    lines.append("### Marginal-vs-joint independence (lift ≥ 1.5 = stuck_together; lift ≤ 0.67 = narratively_separated)")
    lines.append("")
    relations = result["relations"]
    lines.append(
        f"- **Stuck-together in all 3 books**: {len(relations['stuck_together_in_all_3_books'])} pair(s) → "
        + ", ".join(f"`{k}`" for k in relations["stuck_together_in_all_3_books"]) or "_none_"
    )
    lines.append(
        f"- **Stuck-together in ≥2 books**: {len(relations['stuck_together_in_2_or_more_books'])} pair(s) → "
        + ", ".join(f"`{k}`" for k in relations["stuck_together_in_2_or_more_books"]) or "_none_"
    )
    lines.append(
        f"- **Narratively-separated in all 3 books**: {len(relations['narratively_separated_in_all_3_books'])} pair(s) → "
        + ", ".join(f"`{k}`" for k in relations["narratively_separated_in_all_3_books"]) or "_none_"
    )
    lines.append(
        f"- **Narratively-separated in ≥2 books**: {len(relations['narratively_separated_in_2_or_more_books'])} pair(s) → "
        + ", ".join(f"`{k}`" for k in relations["narratively_separated_in_2_or_more_books"]) or "_none_"
    )
    lines.append("")

    # Per-pair trajectory
    lines.append("### Per-pair Jaccard trajectory across the trilogy")
    lines.append("")
    lines.append("| Pair | book1 | book2 | book3 | Δ b1→b2 | Δ b2→b3 | sign |")
    lines.append("|------|-------|-------|-------|---------|---------|------|")
    # Sort trajectories by book-1 Jaccard descending so the most-affined-in-book1 pairs read first.
    traj_sorted = sorted(
        result["trajectories"].items(),
        key=lambda kv: kv[1]["jaccards"][0],
        reverse=True,
    )
    for k, t in traj_sorted:
        lines.append(
            f"| {k} | {t['jaccards'][0]:.3f} | {t['jaccards'][1]:.3f} | {t['jaccards'][2]:.3f} | "
            f"{t['delta_b1_to_b2']:+.3f} | {t['delta_b2_to_b3']:+.3f} | {t['sign']} |"
        )
    lines.append("")

    # Gate verdicts
    lines.append("### Gate verdicts")
    lines.append("")
    g = result["gates"]
    lines.append(
        f"- **G1 (top-3 ranking Jaccard)** → {g['gate1_top3_ranking_jaccard']['verdict']} "
        f"(mean pairwise J={g['gate1_top3_ranking_jaccard']['mean_pairwise_jaccard']})"
    )
    lines.append(
        f"- **G1-bonus (top-3 cross-book set intersection)** → "
        f"{g['gate1_bonus_top3_set_overlap']['verdict']} "
        f"(|intersection|={g['gate1_bonus_top3_set_overlap']['intersection_size']})"
    )
    lines.append(
        f"- **G2 (top-pair stability, rank-1)** → {g['gate2_top_pair_stability']['verdict']} "
        f"(mean pairwise J={g['gate2_top_pair_stability']['mean_pairwise_jaccard']})"
    )
    lines.append(
        f"- **G3 (jaccard spread max-min vs mean)** → {g['gate3_jaccard_spread']['verdict']}"
    )
    lines.append(
        f"- **Overall (combine_gates)** → **{g['overall']}**"
    )
    lines.append("")

    # Per-book scene counts + marginals (transparency)
    lines.append("### Per-character scene-presence marginals")
    lines.append("")
    lines.append("| Character | crystal_shard | streams_of_silver | halflings_gem |")
    lines.append("|-----------|---------------|-------------------|---------------|")
    for ch in FELLOWSHIP:
        cs = result["per_book"]["crystal_shard"]["per_char_scene_count"][ch]
        ss = result["per_book"]["streams_of_silver"]["per_char_scene_count"][ch]
        hg = result["per_book"]["halflings_gem"]["per_char_scene_count"][ch]
        cs_r = result["per_book"]["crystal_shard"]["per_char_marginal_rate"][ch]
        ss_r = result["per_book"]["streams_of_silver"]["per_char_marginal_rate"][ch]
        hg_r = result["per_book"]["halflings_gem"]["per_char_marginal_rate"][ch]
        lines.append(
            f"| {ch} | {cs} ({cs_r:.2%}) | {ss} ({ss_r:.2%}) | {hg} ({hg_r:.2%}) |"
        )
    lines.append("")
    lines.append(
        "_(per-book scene totals: "
        + ", ".join(
            f"{b}={result['per_book'][b]['n_scenes_total']}" for b in BOOK_ORDER
        )
        + ")_"
    )
    lines.append("")

    # Conclusion + Action
    lines.append(f"### Conclusion + Action — Pattern {PATTERN_NUMBER}: **{result['verdict']}**")
    lines.append("")
    lines.append(result["findings_short"])
    lines.append("")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def render_roadmap_row(result: dict[str, Any], commit: str) -> str:
    verdict = result["verdict"]
    if verdict == "PASS":
        ship = "ship — fellowship pair-affinity matrix as planner staging prior"
    elif verdict == "PASS_PARTIAL":
        ship = (
            "ship soft prior on the stable-axis subset (e.g., stuck-together-in-3-books pairs); "
            "treat unstable axes as per-book voice-LoRA flavor"
        )
    elif verdict == "DIVERGE":
        ship = "HOLD — affinity does not reproduce across books"
    elif verdict == "KILL":
        ship = "KILL — no signal"
    else:
        ship = f"INCOMPLETE — {verdict}"

    lever = (
        "planner.charactersPresent staging prior — when seed locks ≥2 fellowship members, "
        "use per-book pair-affinity matrix as a soft prior on chapter-level pair frequency "
        "(stuck-together pairs over-represented vs by-marginal independent assumption)"
    )
    findings = result["findings_short"]

    return (
        f"| {PATTERN_NUMBER} | **{PATTERN_NAME}** (`{commit}`): {findings} | "
        f"{lever} | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | "
        f"**{verdict}** — {ship} |\n"
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    commit = commit_short()
    print(
        f"[pattern-{PATTERN_NUMBER}] starting; slug={PATTERN_SLUG}; commit={commit}",
        file=sys.stderr,
    )

    result = analyze()

    payload: dict[str, Any] = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": PATTERN_NAME,
        "slug": PATTERN_SLUG,
        "commit": commit,
        "timestamp_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "fellowship": list(FELLOWSHIP),
        "presence_threshold_alias_hits": PRESENCE_THRESHOLD,
        **result,
    }

    json_path = write_timestamped_json(OUT_DIR, PATTERN_SLUG, payload)
    print(f"[pattern-{PATTERN_NUMBER}] JSON → {json_path}", file=sys.stderr)

    section_md = render_conclusions_md(result, json_path, commit)
    atomic_append_section(CONCLUSIONS_PATH, section_md)
    print(f"[pattern-{PATTERN_NUMBER}] appended → {CONCLUSIONS_PATH}", file=sys.stderr)

    row_md = render_roadmap_row(result, commit)
    atomic_insert_row_before_anchor(ROADMAP_PATH, row_md, ROADMAP_ANCHOR)
    print(f"[pattern-{PATTERN_NUMBER}] inserted row → {ROADMAP_PATH}", file=sys.stderr)

    print(f"\n=== Pattern {PATTERN_NUMBER} — {PATTERN_NAME} ===")
    print(f"verdict: {result['verdict']}")
    print(f"gates: {result['gates_used']}")
    print(f"findings: {result['findings_short']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
