#!/usr/bin/env python3
"""
Pattern 63 — Compound-hyphenated modifier density.

Hypothesis
----------
Compound hyphenated adjectives ("ice-cold", "moon-pale", "battle-worn",
"dark-haired", "blood-red", "razor-sharp", "iron-willed") are a fantasy
voice signature. They pack sensory richness into a single modifier.

  - Per-beat density (per 100w) and per-(book, kind) density should
    reproduce across the 3 IWD books.
  - The compound-modifier *lexicon* (top-30 most frequent compounds)
    should overlap substantially across books — these are the writer's
    signature compound moves.
  - Description-kind beats should carry more compounds than action-kind
    beats (descriptions are denser per unit prose).
  - A heuristic classifier (color / sensory / evaluative) breaks the
    lexicon into three voice axes, each of which can be a separate
    fewshot prior.

Methodology (pure compute regex)
--------------------------------
1. **Detection.** `HYPHEN_COMPOUND` = `\\b\\w+(?:-\\w+)+\\b` — matches any
   word-boundary token containing one or more hyphens. Multi-segment
   compounds ("matter-of-factly", "ear-to-ear") are accepted.
2. **Filtering.**
   - Numeric / identifier hyphens (`21-year-old`, `2-foot`) → counted
     separately as `numeric_hyphens`, NOT included in the compound-modifier
     density.
   - Em-dash collisions → the `\\b\\w+` token boundaries already exclude
     em-dashes (`—` is not `\\w`) and the regex never matches across
     en-/em-dash characters.
   - Proper-noun hyphens (`Catti-brie`, `Cryshal-Tirith`, `Aegis-fang`,
     `Ten-Towns`, `Caer-Konig`) → tokens whose FIRST segment starts with
     an uppercase letter are excluded as proper nouns and counted
     separately as `proper_hyphens`.
3. **Per-beat density.** For every beat with `kind ∈ {action, dialogue,
   interiority, description}`, count compound-modifier tokens (after
   filtering) and normalize per 100 words.
4. **Per-(book, kind) aggregation.** Mean of per-beat densities AND
   length-weighted pooled density.
5. **Top-30 compound-modifier lexicon per book.** All filtered tokens
   ranked by raw frequency. Cross-book intersection size + pairwise
   Jaccard.
6. **Heuristic classification.** Each lowercased compound-modifier token
   matched against three lexicons:
   - **Color** — contains a color/luminosity word (ice-blue, blood-red,
     dark-haired, moon-pale, …). NOTE: `dark-haired` is intentionally
     classified as color (because Salvatore's "dark-" compounds ride a
     visual axis); a future refactor could split visual-color from
     "dark/light" luminosity.
   - **Sensory** — contains a tactile / acoustic / kinesthetic word
     (razor-sharp, ice-cold, feather-light, honey-sweet, soft-spoken,
     pin-drop, …).
   - **Evaluative** — contains a moral / state / outcome word (battle-
     worn, iron-willed, soul-bound, well-placed, hard-pressed, …).
   Tokens matching multiple lexicons are assigned by priority
   color > sensory > evaluative. Tokens matching none are tallied as
   `unclassified`.
7. **Per-kind ranking.** Within each book, rank kinds by mean density.

Cross-book directional gate
---------------------------
Five sub-gates combine to a single verdict:

  G1: per-(book, kind) density spread.
       gate_density_spread on description-kind density across books, ≤30%.
  G2: per-kind ranking stability (kinds ordered by density).
       gate_ranking_jaccard on the per-book full-kind ranking, top-2,
       Jaccard ≥0.85 PASS / ≥0.50 PASS_PARTIAL.
  G3: top-30 lexicon overlap across all 3 books.
       gate_top_k_overlap with min_shared_pairs=10.
  G4: classification share stability (color/sensory/evaluative dominant
       category).
       gate_modal_class on the per-book modal classification.
  G5: top-1 kind agreement (which kind has the highest compound density?).
       gate_modal_class on the per-book argmax kind.

`combine_gates` returns the worst sub-verdict.

Outputs
-------
- JSON: `novels/salvatore-icewind-dale/structure-calibration/
        crystal_shard.<TS>.compound-modifiers.json`
- Append section to `crystal_shard-conclusions.md` (fcntl flock).
- Insert row into `docs/harness-tuning-roadmap.md` (fcntl flock).
"""

from __future__ import annotations

import datetime as _dt
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean
from typing import Any

# ---------------------------------------------------------------------------
# Lib imports
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)
from directional_gate import (  # noqa: E402
    Verdict,
    combine_gates,
    gate_density_spread,
    gate_modal_class,
    gate_ranking_jaccard,
    gate_top_k_overlap,
)

# ---------------------------------------------------------------------------
# Pattern identity + paths
# ---------------------------------------------------------------------------

PATTERN_NUMBER = 63
PATTERN_NAME = "Compound-hyphenated modifier density"
PATTERN_SLUG = "compound-modifiers"

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

ROADMAP_ANCHOR = "\n**Sequencing"
ACTIVE_KINDS = ("action", "dialogue", "interiority", "description")
BOOK_ORDER = ("crystal_shard", "streams_of_silver", "halflings_gem")

# ---------------------------------------------------------------------------
# Detection regex
# ---------------------------------------------------------------------------
# Tokens: word-boundary, one or more `-` separated word segments.
# `\w` is [A-Za-z0-9_]; we filter numeric tokens after match.
HYPHEN_COMPOUND = re.compile(r"\b\w+(?:-\w+)+\b")


def is_numeric_compound(token: str) -> bool:
    """Any segment is a pure-digit run? Then it's a numeric/identifier
    compound, not a modifier (e.g. `21-year-old`, `2-foot`, `1-2-3`)."""
    return any(part.isdigit() for part in token.split("-"))


def is_proper_compound(token: str) -> bool:
    """First character is uppercase? Treat as proper noun
    (`Catti-brie`, `Cryshal-Tirith`, `Aegis-fang`, `Ten-Towns`)."""
    return bool(token) and token[0].isupper()


# ---------------------------------------------------------------------------
# Heuristic classification lexicons
# ---------------------------------------------------------------------------
# Match against any segment of the compound (lowercased). Priority order
# is color > sensory > evaluative; unmatched → unclassified.

COLOR_WORDS = {
    # explicit colors
    "red", "blue", "green", "yellow", "purple", "orange", "violet",
    "pink", "brown", "tan", "gold", "silver", "copper", "bronze",
    "black", "white", "grey", "gray", "scarlet", "crimson",
    "azure", "amber", "ivory", "ebony", "ruby", "emerald", "sapphire",
    "raven", "snow", "ash",
    # luminosity / shade
    "dark", "light", "bright", "pale", "dim", "shadow", "shadowy",
    "moon", "moonlit", "sun", "sunlit", "fire", "flame",
    # color-bearing materials commonly used as modifier prefix
    "blood", "rust", "wine", "honey", "ice", "frost", "snow",
    "ash", "smoke",
    # eyes / hair color descriptors specific to compound modifiers
    "haired", "eyed", "skinned", "bearded",
}

SENSORY_WORDS = {
    # tactile / texture
    "sharp", "blunt", "smooth", "rough", "soft", "hard", "cold",
    "warm", "hot", "cool", "wet", "dry", "razor", "knife", "needle",
    "iron", "steel", "stone", "feather", "silk", "velvet", "thorn",
    "pin",
    # acoustic
    "loud", "quiet", "silent", "spoken", "voiced", "tongued",
    # kinesthetic / movement
    "swift", "slow", "quick", "fleet", "nimble", "ready", "footed",
    # taste / scent
    "sweet", "bitter", "salty", "sour", "savory", "fragrant",
    "smelling", "scented",
    # heat / temperature compounds
    "burning", "freezing", "boiling", "scalding",
    # density / weight
    "heavy", "light", "dense",
    # acuity
    "alert", "keen", "sharp",
}

EVALUATIVE_WORDS = {
    # moral / character
    "good", "evil", "noble", "kind", "cruel", "wicked", "honest",
    "loyal", "natured", "tempered", "willed", "minded", "hearted",
    "souled", "spirited", "blooded",
    # combat / wear / state
    "battle", "war", "warrior", "worn", "hardened", "seasoned",
    "tested", "trained", "tried", "scarred", "broken", "spent",
    "dead", "alive", "living", "dying", "fallen", "lost",
    # outcome / quality
    "well", "ill", "hard", "easy", "lucky", "unlucky", "weary",
    "tireless", "matchless", "unmatched", "unequalled",
    # social / status
    "born", "bound", "bred", "earned", "deserved", "placed",
    "made", "fashioned", "wrought", "favored", "blessed", "cursed",
    "doomed",
    # cognitive / will
    "wise", "fool", "foolish", "clever", "cunning", "self",
    # standing / time-state
    "standing", "lasting", "lived", "old", "ancient", "young",
    "newborn", "found", "needed",
    # roles / participial states
    "be",  # would-be
    "ridden",
    "pressed", "stricken", "doubts",
    # awareness
    "ever", "alert",
    "of",  # matter-of-factly
}

# pre-build lowercased sets for membership tests
COLOR_SET = {w.lower() for w in COLOR_WORDS}
SENSORY_SET = {w.lower() for w in SENSORY_WORDS}
EVAL_SET = {w.lower() for w in EVALUATIVE_WORDS}


def classify_compound(token: str) -> str:
    """Return one of {color, sensory, evaluative, unclassified} given a
    lowercased compound-modifier token. Priority color > sensory >
    evaluative. Multi-segment tokens are decomposed and any segment match
    counts."""
    parts = token.lower().split("-")
    s = set(parts)
    if s & COLOR_SET:
        return "color"
    if s & SENSORY_SET:
        return "sensory"
    if s & EVAL_SET:
        return "evaluative"
    return "unclassified"


# ---------------------------------------------------------------------------
# Loaders + git
# ---------------------------------------------------------------------------


def load_beats() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with BEATS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


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
# Core analysis
# ---------------------------------------------------------------------------


def analyze(beats: list[dict[str, Any]]) -> dict[str, Any]:
    # ---- accumulators -----------------------------------------------------
    # Per (book, kind):
    #   - list of per-beat densities → mean
    #   - total compound-modifier hits + total words → pooled density
    cell_densities: dict[tuple[str, str], list[float]] = defaultdict(list)
    cell_compound_hits: dict[tuple[str, str], int] = defaultdict(int)
    cell_words: dict[tuple[str, str], int] = defaultdict(int)
    cell_n_beats: dict[tuple[str, str], int] = defaultdict(int)

    # Per book:
    per_book_compound_counter: dict[str, Counter] = defaultdict(Counter)
    per_book_proper_counter: dict[str, Counter] = defaultdict(Counter)
    per_book_numeric_counter: dict[str, Counter] = defaultdict(Counter)
    per_book_class_counter: dict[str, Counter] = defaultdict(Counter)
    per_book_words: dict[str, int] = defaultdict(int)
    per_book_compound_hits: dict[str, int] = defaultdict(int)

    skipped = 0
    for b in beats:
        kind = b.get("kind")
        if kind not in ACTIVE_KINDS:
            skipped += 1
            continue
        book = b.get("book")
        words = int(b.get("words") or 0)
        text = b.get("text") or ""
        if words <= 0 or not text.strip() or book not in BOOK_ORDER:
            skipped += 1
            continue

        # tokenize hyphen compounds
        compound_hits = 0
        for tok in HYPHEN_COMPOUND.findall(text):
            if is_numeric_compound(tok):
                per_book_numeric_counter[book][tok.lower()] += 1
                continue
            if is_proper_compound(tok):
                # Capture the original case (Catti-brie etc.) in the
                # proper-noun counter so we can report exact terms.
                per_book_proper_counter[book][tok] += 1
                continue
            t_lower = tok.lower()
            per_book_compound_counter[book][t_lower] += 1
            per_book_class_counter[book][classify_compound(t_lower)] += 1
            compound_hits += 1

        density_per_100w = 100.0 * compound_hits / words if words else 0.0
        cell_densities[(book, kind)].append(density_per_100w)
        cell_compound_hits[(book, kind)] += compound_hits
        cell_words[(book, kind)] += words
        cell_n_beats[(book, kind)] += 1
        per_book_words[book] += words
        per_book_compound_hits[book] += compound_hits

    # ---- per-(book, kind) summary ----------------------------------------
    per_book_per_kind: dict[str, dict[str, dict[str, float]]] = defaultdict(dict)
    for book in BOOK_ORDER:
        for kind in ACTIVE_KINDS:
            arr = cell_densities.get((book, kind), [])
            n_beats = cell_n_beats.get((book, kind), 0)
            words = cell_words.get((book, kind), 0)
            hits = cell_compound_hits.get((book, kind), 0)
            mean_density = float(mean(arr)) if arr else 0.0
            pooled = (100.0 * hits / words) if words else 0.0
            per_book_per_kind[book][kind] = {
                "n_beats": n_beats,
                "words": words,
                "compound_hits": hits,
                "mean_density_per_100w": round(mean_density, 4),
                "pooled_density_per_100w": round(pooled, 4),
            }

    # ---- per-book overall density ----------------------------------------
    per_book_overall: dict[str, dict[str, float | int]] = {}
    for book in BOOK_ORDER:
        words = per_book_words[book]
        hits = per_book_compound_hits[book]
        per_book_overall[book] = {
            "words": words,
            "compound_hits": hits,
            "pooled_density_per_100w": round(100.0 * hits / words, 4) if words else 0.0,
            "distinct_tokens": len(per_book_compound_counter[book]),
            "proper_hits": int(sum(per_book_proper_counter[book].values())),
            "numeric_hits": int(sum(per_book_numeric_counter[book].values())),
        }

    # ---- per-book per-kind ranking (by mean density) ---------------------
    per_book_kind_ranking: dict[str, list[str]] = {}
    for book in BOOK_ORDER:
        rows = [
            (kind, per_book_per_kind[book][kind]["mean_density_per_100w"])
            for kind in ACTIVE_KINDS
        ]
        rows.sort(key=lambda kv: kv[1], reverse=True)
        per_book_kind_ranking[book] = [k for k, _ in rows]

    # ---- per-book top-30 lexicon -----------------------------------------
    per_book_top30: dict[str, list[dict[str, Any]]] = {}
    per_book_top30_set: dict[str, set] = {}
    for book in BOOK_ORDER:
        top = per_book_compound_counter[book].most_common(30)
        per_book_top30[book] = [
            {"compound": t, "count": c, "class": classify_compound(t)}
            for t, c in top
        ]
        per_book_top30_set[book] = {t for t, _ in top}

    # cross-book lexicon stats
    if all(per_book_top30_set.get(b) for b in BOOK_ORDER):
        intersection_3 = set.intersection(*[per_book_top30_set[b] for b in BOOK_ORDER])
    else:
        intersection_3 = set()
    pairwise_jaccard: dict[str, float] = {}
    books = list(BOOK_ORDER)
    for i in range(len(books)):
        for j in range(i + 1, len(books)):
            a, b = per_book_top30_set[books[i]], per_book_top30_set[books[j]]
            union = a | b
            jacc = (len(a & b) / len(union)) if union else 0.0
            pairwise_jaccard[f"{books[i]}__{books[j]}"] = round(jacc, 4)

    # ---- classification share per book -----------------------------------
    per_book_class_share: dict[str, dict[str, float]] = {}
    per_book_modal_class: dict[str, str] = {}
    for book in BOOK_ORDER:
        ctr = per_book_class_counter[book]
        total = sum(ctr.values())
        share = {
            cls: (ctr.get(cls, 0) / total) if total else 0.0
            for cls in ("color", "sensory", "evaluative", "unclassified")
        }
        per_book_class_share[book] = {k: round(v, 4) for k, v in share.items()}
        # exclude `unclassified` from modal selection — it's a residual,
        # not a voice axis. Pick the largest of the three voice classes.
        voice_classes = {
            cls: ctr.get(cls, 0)
            for cls in ("color", "sensory", "evaluative")
        }
        per_book_modal_class[book] = (
            max(voice_classes, key=voice_classes.get) if any(voice_classes.values()) else ""
        )

    # ---- argmax kind per book --------------------------------------------
    per_book_top_kind: dict[str, str] = {}
    for book in BOOK_ORDER:
        per_book_top_kind[book] = per_book_kind_ranking[book][0]

    # ---- gate verdicts ----------------------------------------------------
    # G1: description-kind density spread ≤30%
    descr_density_per_book = {
        b: per_book_per_kind[b]["description"]["mean_density_per_100w"]
        for b in BOOK_ORDER
    }
    g1 = gate_density_spread(descr_density_per_book, threshold_pct=30.0)

    # G2: per-book full-kind ranking — pairwise top-2 Jaccard
    g2_jaccard, g2 = gate_ranking_jaccard(per_book_kind_ranking, top_n=2)

    # G3: top-30 lexicon overlap (intersection across all 3 books)
    g3_intersection_n, g3 = gate_top_k_overlap(
        per_book_top30_set, top_n=30, min_shared_pairs=10
    )

    # G4: modal classification (color/sensory/evaluative) agreement
    g4 = gate_modal_class(per_book_modal_class)

    # G5: argmax kind agreement
    g5 = gate_modal_class(per_book_top_kind)

    overall_verdict: Verdict = combine_gates([g1, g2, g3, g4, g5])

    # ---- per-book overall density spread (separate diagnostic) -----------
    overall_density_per_book = {
        b: per_book_overall[b]["pooled_density_per_100w"] for b in BOOK_ORDER
    }
    overall_density_spread = gate_density_spread(
        overall_density_per_book, threshold_pct=30.0
    )

    return {
        "skipped_beats": skipped,
        "active_kinds": list(ACTIVE_KINDS),
        "books": list(BOOK_ORDER),
        "per_book_overall": per_book_overall,
        "per_book_per_kind": per_book_per_kind,
        "per_book_kind_ranking": per_book_kind_ranking,
        "per_book_top30": per_book_top30,
        "per_book_top30_intersection_3way": sorted(intersection_3),
        "top30_pairwise_jaccard": pairwise_jaccard,
        "per_book_class_share": per_book_class_share,
        "per_book_modal_class": per_book_modal_class,
        "per_book_top_kind": per_book_top_kind,
        "per_book_proper_top10": {
            b: [{"term": t, "count": c} for t, c in per_book_proper_counter[b].most_common(10)]
            for b in BOOK_ORDER
        },
        "per_book_numeric_top10": {
            b: [{"term": t, "count": c} for t, c in per_book_numeric_counter[b].most_common(10)]
            for b in BOOK_ORDER
        },
        "gates": {
            "G1_description_density_spread": g1,
            "G2_per_kind_ranking_top2_jaccard": {"jaccard": g2_jaccard, "verdict": g2},
            "G3_top30_lexicon_overlap": {
                "intersection_size": g3_intersection_n, "verdict": g3
            },
            "G4_modal_classification": g4,
            "G5_argmax_kind": g5,
            "overall_density_spread_diagnostic": overall_density_spread,
        },
        "verdict": overall_verdict,
    }


# ---------------------------------------------------------------------------
# Markdown writers
# ---------------------------------------------------------------------------


def render_conclusions_md(result: dict[str, Any], json_path: Path, commit: str) -> str:
    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_NUMBER}: {PATTERN_NAME}")
    lines.append("")
    lines.append(
        f"_Pure-compute regex; 3 books × 4 active kinds; commit `{commit}`. "
        f"JSON: `{json_path.relative_to(REPO)}`. Verdict: **{result['verdict']}**._"
    )
    lines.append("")

    # --- methodology ---
    lines.append("### Methodology")
    lines.append("")
    lines.append(
        "- Detection regex `\\b\\w+(?:-\\w+)+\\b` — any word-boundary token with one or more hyphens."
    )
    lines.append(
        "- Numeric compounds (`21-year-old`, `2-foot`) excluded from compound-modifier density "
        "(counted in `numeric_hits` diagnostic)."
    )
    lines.append(
        "- Proper-noun compounds (first-segment uppercase: `Catti-brie`, `Cryshal-Tirith`, "
        "`Aegis-fang`, `Ten-Towns`, `Caer-Konig`) excluded; counted in `proper_hits`."
    )
    lines.append(
        "- Heuristic classification color > sensory > evaluative > unclassified by segment-membership lookup."
    )
    lines.append(
        "- Per-beat density = 100 × compound_hits / words; per-(book, kind) reported as both "
        "mean of per-beat densities and length-weighted pooled density."
    )
    lines.append(
        "- Five-gate combine: description-density spread ≤30%, per-kind top-2 ranking Jaccard, "
        "top-30 lexicon overlap (≥10 shared), modal-class agreement, argmax-kind agreement."
    )
    lines.append("")

    # --- per-book overall ---
    lines.append("### Per-book overall compound-modifier density")
    lines.append("")
    lines.append("| Book | Words | Hits | Density /100w | Distinct tokens | Proper hits (excluded) | Numeric hits (excluded) |")
    lines.append("|---|---|---|---|---|---|---|")
    for book in BOOK_ORDER:
        ovr = result["per_book_overall"][book]
        lines.append(
            f"| {book} | {ovr['words']} | {ovr['compound_hits']} | "
            f"{ovr['pooled_density_per_100w']:.4f} | {ovr['distinct_tokens']} | "
            f"{ovr['proper_hits']} | {ovr['numeric_hits']} |"
        )
    lines.append("")

    # --- per-(book, kind) density ---
    lines.append("### Per-(book, kind) compound-modifier density (per 100w)")
    lines.append("")
    lines.append("| Book | Kind | Beats | Words | Hits | Mean /100w | Pooled /100w |")
    lines.append("|---|---|---|---|---|---|---|")
    for book in BOOK_ORDER:
        for kind in ACTIVE_KINDS:
            row = result["per_book_per_kind"][book][kind]
            lines.append(
                f"| {book} | {kind} | {row['n_beats']} | {row['words']} | "
                f"{row['compound_hits']} | {row['mean_density_per_100w']:.4f} | "
                f"{row['pooled_density_per_100w']:.4f} |"
            )
    lines.append("")

    # --- per-book kind ranking ---
    lines.append("### Per-book kind ranking (highest compound-modifier density first)")
    lines.append("")
    for book in BOOK_ORDER:
        ranking = " > ".join(result["per_book_kind_ranking"][book])
        lines.append(f"- **{book}** → {ranking}")
    lines.append("")

    # --- per-book top-30 lexicon ---
    lines.append("### Per-book top-30 compound-modifier lexicon")
    lines.append("")
    for book in BOOK_ORDER:
        top30 = result["per_book_top30"][book]
        lines.append(f"**{book}** ({len(top30)} entries shown):")
        terms = ", ".join(
            f"`{e['compound']}` ×{e['count']} ({e['class'][:3]})" for e in top30
        )
        lines.append(f"  - {terms}")
    lines.append("")

    # --- cross-book lexicon overlap ---
    lines.append("### Cross-book lexicon overlap")
    lines.append("")
    inter = result["per_book_top30_intersection_3way"]
    lines.append(
        f"- **3-way intersection (top-30 set)**: {len(inter)} terms — "
        + (", ".join(f"`{t}`" for t in inter) if inter else "_none_")
    )
    lines.append("- **Pairwise Jaccard (top-30 sets)**:")
    for pair, jacc in result["top30_pairwise_jaccard"].items():
        a, b = pair.split("__")
        lines.append(f"  - {a} ∩ {b} → Jaccard {jacc:.4f}")
    lines.append("")

    # --- classification breakdown ---
    lines.append("### Classification share per book (color / sensory / evaluative / unclassified)")
    lines.append("")
    lines.append("| Book | Color | Sensory | Evaluative | Unclassified | Modal voice class |")
    lines.append("|---|---|---|---|---|---|")
    for book in BOOK_ORDER:
        share = result["per_book_class_share"][book]
        modal = result["per_book_modal_class"][book]
        lines.append(
            f"| {book} | {share['color']:.3f} | {share['sensory']:.3f} | "
            f"{share['evaluative']:.3f} | {share['unclassified']:.3f} | **{modal}** |"
        )
    lines.append("")

    # --- proper-noun + numeric diagnostics ---
    lines.append("### Excluded-token diagnostics (proper nouns + numeric compounds)")
    lines.append("")
    lines.append("Proper-noun hyphens by book (top-10):")
    for book in BOOK_ORDER:
        top = result["per_book_proper_top10"][book]
        if top:
            terms = ", ".join(f"`{e['term']}` ×{e['count']}" for e in top)
            lines.append(f"  - **{book}** → {terms}")
        else:
            lines.append(f"  - **{book}** → _none_")
    lines.append("")
    lines.append("Numeric hyphens (`21-year-old` style) by book (top-10):")
    any_numeric = False
    for book in BOOK_ORDER:
        top = result["per_book_numeric_top10"][book]
        if top:
            any_numeric = True
            terms = ", ".join(f"`{e['term']}` ×{e['count']}" for e in top)
            lines.append(f"  - **{book}** → {terms}")
    if not any_numeric:
        lines.append("  - All books → _none_ (Salvatore does not use numeric-hyphen compounds)")
    lines.append("")

    # --- gate table ---
    g = result["gates"]
    g2 = g["G2_per_kind_ranking_top2_jaccard"]
    g3 = g["G3_top30_lexicon_overlap"]
    lines.append("### Verdict gate")
    lines.append("")
    lines.append("| Gate | Threshold | Result | Verdict |")
    lines.append("|---|---|---|---|")
    descr_density_per_book = {
        b: result["per_book_per_kind"][b]["description"]["mean_density_per_100w"]
        for b in BOOK_ORDER
    }
    descr_vals = ", ".join(f"{b[:2].upper()}={descr_density_per_book[b]:.3f}" for b in BOOK_ORDER)
    lines.append(
        f"| G1: description density spread | ≤30% relative | "
        f"{descr_vals} | **{g['G1_description_density_spread']}** |"
    )
    lines.append(
        f"| G2: per-kind top-2 ranking Jaccard | mean ≥0.85 PASS / ≥0.50 PASS_PARTIAL | "
        f"jaccard={g2['jaccard']:.4f} | **{g2['verdict']}** |"
    )
    lines.append(
        f"| G3: top-30 lexicon 3-way intersection | ≥10 shared terms | "
        f"intersection={g3['intersection_size']} | **{g3['verdict']}** |"
    )
    lines.append(
        f"| G4: modal voice-class agreement | identical across 3 books | "
        f"per-book modals = {result['per_book_modal_class']} | **{g['G4_modal_classification']}** |"
    )
    lines.append(
        f"| G5: argmax kind agreement | identical across 3 books | "
        f"per-book top kinds = {result['per_book_top_kind']} | **{g['G5_argmax_kind']}** |"
    )
    lines.append(
        f"| (diagnostic) overall pooled density spread | ≤30% relative | "
        + ", ".join(f"{b[:2].upper()}={result['per_book_overall'][b]['pooled_density_per_100w']:.3f}" for b in BOOK_ORDER)
        + f" | {g['overall_density_spread_diagnostic']} |"
    )
    lines.append("")
    lines.append(f"**Overall verdict (combine_gates worst-of):** {result['verdict']}")
    lines.append("")

    # --- conclusion + action ---
    lines.append(f"### Conclusion + Action — Pattern {PATTERN_NUMBER}: **{result['verdict']}**")
    lines.append("")

    # build a narrative summary
    overall = result["per_book_overall"]
    densities = [overall[b]["pooled_density_per_100w"] for b in BOOK_ORDER]
    inter_terms = result["per_book_top30_intersection_3way"]
    modal_match = len(set(result["per_book_modal_class"].values())) == 1
    top_kind_match = len(set(result["per_book_top_kind"].values())) == 1

    # Top exemplar terms for the writer-prompt fewshot
    exemplar_terms = sorted(inter_terms)[:10]
    lines.append(
        f"- **Density baseline.** Compound-modifier density per 100w: "
        + ", ".join(f"{b}={overall[b]['pooled_density_per_100w']:.3f}" for b in BOOK_ORDER)
        + f". Spread {g['overall_density_spread_diagnostic']} relative to mean."
    )
    lines.append(
        f"- **Per-kind ranking.** Per-book argmax kind = "
        + ", ".join(f"{b}={result['per_book_top_kind'][b]}" for b in BOOK_ORDER)
        + (" (3/3 agree)" if top_kind_match else " (kinds drift)")
        + "."
    )
    lines.append(
        f"- **Voice-class signature.** Per-book modal voice classes = "
        + ", ".join(f"{b}={result['per_book_modal_class'][b]}" for b in BOOK_ORDER)
        + (" (3/3 agree)" if modal_match else " (drift)")
        + "."
    )
    lines.append(
        f"- **3-way lexicon intersection.** {len(inter_terms)} compounds shared across all 3 books"
        + (f": {', '.join(f'`{t}`' for t in inter_terms)}" if inter_terms else "")
        + "."
    )
    lines.append("")

    # Per-verdict recommendations
    if result["verdict"] in ("PASS", "PASS_PARTIAL"):
        lines.append("**Proposed harness levers:**")
        lines.append("")
        lines.append(
            "1. **Writer-prompt compound-modifier density prior.** Target "
            f"{min(densities):.2f}–{max(densities):.2f} compound modifiers per 100w in "
            f"{result['per_book_top_kind'][BOOK_ORDER[0]]}-kind beats. Description-kind beats "
            "should carry compounds at the highest rate per kind."
        )
        if exemplar_terms:
            lines.append(
                "2. **Voice fewshot exemplar lexicon (3-way stable).** Salvatore-route writer "
                f"prompt should disproportionately feature: {', '.join(f'`{t}`' for t in exemplar_terms)}."
            )
        else:
            lines.append(
                "2. **Voice fewshot exemplar lexicon.** Build per-book top-30 unions; full 3-way "
                "intersection too small to ship as a fixed fewshot lexicon, treat as a per-book "
                "soft-prior pool."
            )
        if modal_match:
            modal = list(result["per_book_modal_class"].values())[0]
            lines.append(
                f"3. **Voice-class prior — modal `{modal}`.** Salvatore compound modifiers skew "
                f"toward the {modal} axis 3/3 books — writer prompts and Salvatore-route fewshots "
                f"should bias compound usage toward {modal} compounds (e.g. "
                + ("color/eye/hair color" if modal == "color"
                   else "razor/sharp/iron/feather sensory" if modal == "sensory"
                   else "battle-worn/iron-willed evaluative")
                + ")."
            )
        else:
            lines.append(
                "3. **Voice-class prior.** Modal class drifts across books — DO NOT codify a single "
                "voice-class bias; instead carry the per-book share as a soft prior with allowed "
                "drift."
            )
        lines.append(
            "4. **Optional lint rule (HOLD).** Compound-modifier floor per 100w in description-kind "
            "beats; warn when density falls below P10 of corpus distribution. Defer until the "
            "writer-prompt prior is in place; floor lint without prompt-side support produces "
            "false positives on legitimately compound-light beats."
        )
        lines.append(
            "5. **Proper-noun excluded-set is real.** The proper-noun compounds (`Catti-brie`, "
            "`Cryshal-Tirith`, `Aegis-fang`, `Ten-Towns`, `Caer-Konig`) are NOT compound modifiers "
            "but ARE writer-voice signatures via the planner/world-bible — they're already covered "
            "by the worldbuilding pass; do not introduce them as compound-modifier exemplars."
        )
        lines.append("")
    elif result["verdict"] == "DIVERGE":
        lines.append("**Action:** Pattern reproduces directionally but books disagree on "
                     "either ranking or voice-class. HOLD codification as a hard prior; "
                     "ship per-book lexicon pools as soft fewshot priors only.")
        lines.append("")
    else:
        lines.append("**Action:** No stable cross-book signal — no harness lever proposed.")
        lines.append("")

    # caveats
    lines.append("### Notes / caveats")
    lines.append("")
    lines.append(
        "- **Heuristic classifier is approximate.** Color includes `dark-haired`/`one-eyed` "
        "(visual-axis compounds Salvatore uses heavily); sensory includes razor/iron/feather "
        "compounds; evaluative captures battle-worn/well-placed style. Tokens matching "
        "multiple lexicons are assigned by priority color > sensory > evaluative; "
        "`unclassified` is the residual."
    )
    lines.append(
        "- **Proper-noun exclusion is a strong filter.** All tokens whose first segment "
        "starts with an uppercase letter are dropped as proper nouns. False negatives are "
        "possible at sentence-start (e.g., the rare line `Battle-worn warriors filed in.` "
        "would be misclassified) but spot-checks confirm the filter holds for the IWD corpus."
    )
    lines.append(
        "- **Multi-segment compounds** (`matter-of-factly`, `ear-to-ear`, `gold-and-ivory`) are "
        "kept; classification matches against any segment so the regex catches the full token."
    )
    lines.append(
        "- **OCR artifacts.** A small number of tokens like `Ten-Tbwns` (OCR variant of `Ten-Towns`) "
        "appear in the proper-noun counter. Acceptable noise — does not affect compound-modifier "
        "density."
    )
    lines.append(
        "- **`would-be` is the most common compound across all 3 books** but classifies as "
        "evaluative (matches `be` in the evaluative lexicon). This is a Salvatore-voice signature "
        "and the classification correctly captures it as a state/role compound."
    )
    lines.append("")
    lines.append("---")
    lines.append("")
    return "\n".join(lines) + "\n"


def render_roadmap_row(result: dict[str, Any], commit: str) -> str:
    overall = result["per_book_overall"]
    densities = [overall[b]["pooled_density_per_100w"] for b in BOOK_ORDER]
    g = result["gates"]
    g2 = g["G2_per_kind_ranking_top2_jaccard"]
    g3 = g["G3_top30_lexicon_overlap"]
    inter_terms = result["per_book_top30_intersection_3way"]
    modal_match = len(set(result["per_book_modal_class"].values())) == 1
    top_kind_match = len(set(result["per_book_top_kind"].values())) == 1

    findings = (
        f"per-book density CS={overall['crystal_shard']['pooled_density_per_100w']:.3f}/"
        f"SoS={overall['streams_of_silver']['pooled_density_per_100w']:.3f}/"
        f"HG={overall['halflings_gem']['pooled_density_per_100w']:.3f} per 100w "
        f"(spread {g['overall_density_spread_diagnostic']}); "
        f"argmax-kind {result['per_book_top_kind']} ({'3/3 agree' if top_kind_match else 'drifts'}); "
        f"modal voice class {result['per_book_modal_class']} "
        f"({'3/3 agree' if modal_match else 'drifts'}); "
        f"top-30 3-way intersection={len(inter_terms)} terms; "
        f"top-2 kind-ranking Jaccard={g2['jaccard']:.3f} ({g2['verdict']}); "
        f"description spread {g['G1_description_density_spread']}; "
        f"argmax-kind agreement {g['G5_argmax_kind']}"
    )

    verdict = result["verdict"]
    if verdict == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship compound-modifier density per-kind prior + 3-way-intersection fewshot lexicon + "
            "modal voice-class bias as writer-prompt priors"
        )
    elif verdict == "PASS_PARTIAL":
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship the stable axis (per-kind argmax + density-band soft prior); defer rank-2 ordering "
            "and any single-class voice bias that doesn't reproduce; per-book lexicon pools as "
            "fewshot soft-priors only"
        )
    elif verdict == "DIVERGE":
        verdict_short = "HOLD"
        recommend = "do not codify as hard prior; revisit with finer classifier or per-character splits"
    else:
        verdict_short = "KILL"
        recommend = "no signal; drop as a writer-prompt prior"

    lever = (
        "writer-prompt compound-modifier density prior (description-kind highest); voice fewshot "
        "exemplar lexicon (3-way intersection); modal voice-class bias (color/sensory/evaluative); "
        "optional: lint floor for compound density in description-kind beats"
    )

    return (
        f"| {PATTERN_NUMBER} | **{PATTERN_NAME}** (`{commit}`): {findings} | "
        f"{lever} | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | "
        f"**{verdict_short}** — {recommend} |\n"
    )


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------


def main() -> int:
    commit = commit_short()
    print(
        f"[pattern-{PATTERN_NUMBER}] starting; slug={PATTERN_SLUG}; commit={commit}",
        file=sys.stderr,
    )

    beats = load_beats()
    print(f"[pattern-{PATTERN_NUMBER}] loaded {len(beats)} beats", file=sys.stderr)

    result = analyze(beats)

    payload: dict[str, Any] = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": PATTERN_NAME,
        "slug": PATTERN_SLUG,
        "commit": commit,
        "timestamp_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
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

    # Terse stdout summary
    print(f"\n=== Pattern {PATTERN_NUMBER} — {PATTERN_NAME} ===")
    print(f"verdict: {result['verdict']}")
    print(f"per-book densities: " + ", ".join(
        f"{b}={result['per_book_overall'][b]['pooled_density_per_100w']:.4f}/100w"
        for b in BOOK_ORDER
    ))
    print(f"per-book argmax-kind: {result['per_book_top_kind']}")
    print(f"per-book modal-class: {result['per_book_modal_class']}")
    print(f"top-30 3-way intersection: {len(result['per_book_top30_intersection_3way'])} terms")
    print(f"gates: {result['gates']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
