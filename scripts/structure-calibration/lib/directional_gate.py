"""
Directional gate library — corpus-pattern verdicts via per-book reproduction tests.

This module codifies the directional gate methodology that emerged organically
across 30+ corpus-pattern mining sessions on the Salvatore Icewind Dale 3-book
corpus (`novels/salvatore-icewind-dale/structure-calibration/`). Each pattern
script previously hand-rolled its own gate logic; this module consolidates the
five gate shapes that recurred:

  1. modal-class agreement across books
  2. ranking Jaccard (top-N overlap, set semantics)
  3. sign-of-effect agreement (rising / falling / flat)
  4. density spread (per-book magnitude band)
  5. top-K overlap (paired-set intersection size)

Plus `combine_gates()` which takes the LEAST-favorable verdict across multiple
gates (PASS only if all PASS; KILL if any KILL; otherwise PASS_PARTIAL).

==============================================================================
WHY per-book gating is mandatory
==============================================================================

Per `docs/lessons-learned.md` 2026-04-30 "Aggregate-only patterns can survive
while per-book patterns fail" (Pattern 32 anti-finding):

  > Pattern 32 (chapter-seam transition shape) join produced a strongest
  > aggregate independence-outlier of `foreshadow → time-cut-announcement` at
  > 3.6× over marginal. Per-book breakdown: 3 in crystal_shard, 0 in
  > streams_of_silver, 0 in halflings_gem. The aggregate signal is *entirely
  > book-1-driven* — a planner rule built from the aggregate would encode a
  > pattern that two of three books actively don't reproduce.

The rule: cross-book / cross-corpus patterns must reproduce in EACH book
independently. Aggregate effects are necessary but not sufficient. Every gate
in this module operates on a per-book input dict and computes the verdict
from per-book agreement, not from pooled aggregates.

==============================================================================
Verdict semantics (PASS / PASS_PARTIAL / DIVERGE / KILL)
==============================================================================

  PASS         — pattern reproduces in ALL books at the gate's stability bar
  PASS_PARTIAL — pattern reproduces in MOST books (e.g., 2/3) but not all
  DIVERGE      — books disagree on direction / modal / ordering — not stable
  KILL         — no signal at all (all books null / empty / undefined)

The verdict is purely directional. It does NOT speak to magnitude precision.
Per the user's standing rule (2026-04-30): "≥ 90% confident a pattern reproduces
qualitatively is sufficient to ship as a planner prior." Tight quantitative
CIs are NOT required (see `docs/harness-tuning-roadmap.md` "Ship gate framing").

==============================================================================
Caller contract
==============================================================================

Each gate function takes a per-book input dict keyed by book identifier (the
caller picks the convention; "crystal_shard" / "streams_of_silver" /
"halflings_gem" is the IWD convention). All gates require ≥ 2 books to emit
anything other than INSUFFICIENT_BOOKS (treated like KILL for combine purposes
but distinguished as a separate string).

Each gate returns either a Verdict literal OR a tuple of (numeric_detail,
Verdict) — the numeric detail is the supporting statistic for the conclusion
(e.g., Jaccard score, modal_set_size). Caller is expected to log both.

`combine_gates([...])` produces the worst verdict across multiple gate
results. Use it when a single pattern emits multiple gates (e.g., modal-class
AND top-3 Jaccard) and the ship decision should be the conjunction.
"""
from __future__ import annotations

from typing import Literal

# ---------------------------------------------------------------------------
# Verdict enum (string literals for JSON-friendliness)
# ---------------------------------------------------------------------------

Verdict = Literal[
    "PASS",
    "PASS_PARTIAL",
    "DIVERGE",
    "KILL",
    "INSUFFICIENT_BOOKS",
]

# Severity ordering for combine_gates(). Higher = worse.
SEVERITY: dict[str, int] = {
    "PASS": 0,
    "PASS_PARTIAL": 1,
    "DIVERGE": 2,
    "KILL": 3,
    "INSUFFICIENT_BOOKS": 4,  # treated as worse than KILL because it's incomplete data
}

SignOfEffect = Literal["positive", "negative", "flat"]


# ---------------------------------------------------------------------------
# Gate 1: modal-class agreement
# ---------------------------------------------------------------------------


def gate_modal_class(per_book_modal_classes: dict[str, str]) -> Verdict:
    """Verdict on whether the modal class agrees across books.

    Per `docs/lessons-learned.md` 2026-04-30 (Pattern 26 chapter-title shape +
    Pattern 32 chapter-seam transitions): aggregate modal class is misleading
    because it's pooled over books with potentially different distributions.
    The gate is on per-book modals, not pooled.

    Args:
        per_book_modal_classes: dict mapping book id → its modal-class name
            (the most-frequent class for that book). Must be non-empty.

    Returns:
        PASS         if all books share the same modal class
        PASS_PARTIAL if at least 2/3+ of books share the same modal class
        DIVERGE      if every book has a different modal class
        KILL         if no books reported a modal (all empty / null)
        INSUFFICIENT_BOOKS if fewer than 2 books reported

    Examples:
        >>> gate_modal_class({"a": "x", "b": "x", "c": "x"})
        'PASS'
        >>> gate_modal_class({"a": "x", "b": "x", "c": "y"})
        'PASS_PARTIAL'
        >>> gate_modal_class({"a": "x", "b": "y", "c": "z"})
        'DIVERGE'
    """
    modals = [m for m in per_book_modal_classes.values() if m]
    if len(modals) < 2:
        if not modals:
            return "KILL"
        return "INSUFFICIENT_BOOKS"

    counts: dict[str, int] = {}
    for m in modals:
        counts[m] = counts.get(m, 0) + 1
    most_common = max(counts.values())
    n = len(modals)

    if most_common == n:
        return "PASS"
    if most_common >= max(2, (n + 1) // 2):
        # 2/3, 3/4, 3/5 — majority but not unanimous
        return "PASS_PARTIAL"
    return "DIVERGE"


# ---------------------------------------------------------------------------
# Gate 2: ranking Jaccard (top-N overlap as a set)
# ---------------------------------------------------------------------------


def gate_ranking_jaccard(
    per_book_rankings: dict[str, list[str]],
    top_n: int = 3,
) -> tuple[float, Verdict]:
    """Verdict on whether the top-N elements of an ordered ranking are stable.

    Computes pairwise Jaccard between each pair of books' top-N sets, returns
    the MEAN pairwise Jaccard. Set semantics — order within top-N is ignored
    by this gate (use `gate_top_k_overlap` if you need ordered comparison or
    `gate_modal_class` if you only care about rank-1).

    The 0.85 / 0.50 thresholds match the methodology in pattern scripts
    (`scripts/structure-calibration/chapter-opener-taxonomy.py` and similar):
    a top-N set with high pairwise Jaccard is safe to ship as a soft prior;
    PASS_PARTIAL means the set has ≥ half overlap but isn't full agreement.

    Args:
        per_book_rankings: dict mapping book id → ordered list of class
            identifiers (most frequent first). The gate only inspects the
            first `top_n` elements.
        top_n: how many top-ranked elements to compare. Defaults to 3.

    Returns:
        (mean_pairwise_jaccard, verdict) tuple.
            PASS         if mean Jaccard ≥ 0.85 (essentially same top-N set)
            PASS_PARTIAL if mean Jaccard ≥ 0.50 (substantial overlap)
            DIVERGE      if mean Jaccard < 0.50
            KILL         if no rankings reported
            INSUFFICIENT_BOOKS if fewer than 2 books reported

    Examples:
        >>> gate_ranking_jaccard({"a": ["x", "y", "z"], "b": ["x", "y", "z"]})
        (1.0, 'PASS')
        >>> gate_ranking_jaccard({"a": ["x", "y", "z"], "b": ["x", "y", "w"]})[1]
        'PASS_PARTIAL'
    """
    rankings = {b: r[:top_n] for b, r in per_book_rankings.items() if r}
    if len(rankings) < 2:
        if not rankings:
            return 0.0, "KILL"
        return 0.0, "INSUFFICIENT_BOOKS"

    books = list(rankings.keys())
    sets = {b: set(rankings[b]) for b in books}

    pairs: list[float] = []
    for i in range(len(books)):
        for j in range(i + 1, len(books)):
            sa, sb = sets[books[i]], sets[books[j]]
            union = sa | sb
            if not union:
                continue
            pairs.append(len(sa & sb) / len(union))

    if not pairs:
        return 0.0, "KILL"

    mean = sum(pairs) / len(pairs)

    if mean >= 0.85:
        return round(mean, 4), "PASS"
    if mean >= 0.50:
        return round(mean, 4), "PASS_PARTIAL"
    return round(mean, 4), "DIVERGE"


# ---------------------------------------------------------------------------
# Gate 3: sign-of-effect agreement
# ---------------------------------------------------------------------------


def gate_sign_of_effect(
    per_book_signs: dict[str, SignOfEffect],
) -> Verdict:
    """Verdict on whether the sign of an effect (rising / falling / flat) is stable.

    Used for trends like "action density rises q0→q4" or "callback density
    rises across chapter position." The pattern only ships if the sign of
    the effect is consistent across books — magnitude can vary.

    Per `docs/harness-tuning-roadmap.md` Pattern 4-action / 4-description /
    Pattern 41 (callback density): "sign-of-effect (rising) reproduces in all
    3 books" is the load-bearing claim; the rate at which it rises does not
    need to match book-to-book.

    Args:
        per_book_signs: dict mapping book id → "positive" | "negative" | "flat".

    Returns:
        PASS         if all books share the same non-flat sign
        PASS_PARTIAL if all-but-one books share the sign and the dissenter is "flat"
        DIVERGE      if signs disagree (one positive, one negative)
        KILL         if all books are flat (no effect)
        INSUFFICIENT_BOOKS if fewer than 2 books reported

    Examples:
        >>> gate_sign_of_effect({"a": "positive", "b": "positive", "c": "positive"})
        'PASS'
        >>> gate_sign_of_effect({"a": "positive", "b": "positive", "c": "flat"})
        'PASS_PARTIAL'
        >>> gate_sign_of_effect({"a": "positive", "b": "negative", "c": "flat"})
        'DIVERGE'
    """
    signs = list(per_book_signs.values())
    if len(signs) < 2:
        return "INSUFFICIENT_BOOKS"

    # All flat → no effect signal
    if all(s == "flat" for s in signs):
        return "KILL"

    non_flat = [s for s in signs if s != "flat"]
    unique_directions = set(non_flat)

    if len(unique_directions) == 1 and len(non_flat) == len(signs):
        # All books non-flat AND agree
        return "PASS"
    if len(unique_directions) == 1 and len(non_flat) >= max(2, len(signs) - 1):
        # All-but-one book agree; dissenter is flat (not opposing)
        return "PASS_PARTIAL"
    if len(unique_directions) > 1:
        # Direction conflicts (positive in one book, negative in another)
        return "DIVERGE"
    # Only one non-flat — too thin to call a directional pattern
    return "DIVERGE"


# ---------------------------------------------------------------------------
# Gate 4: density spread (per-book magnitudes within a band)
# ---------------------------------------------------------------------------


def gate_density_spread(
    per_book_densities: dict[str, float],
    threshold_pct: float,
) -> Verdict:
    """Verdict on whether per-book densities cluster within a tolerance band.

    Used for "rate" patterns: chapter length, beat density, sentence length,
    etc. The gate measures the relative spread between max and min per-book
    densities; if the spread is within `threshold_pct` (relative to the mean),
    the pattern is "tight enough" to ship as a quantitative prior.

    Per `docs/harness-tuning-roadmap.md` Pattern 1 (length): max diff 18.5%
    PASSED; Pattern 51 (scene-break density): single-scene-chapter spread
    16.6pp missed ≤15pp gate by 1.6pp. The gate is a function of the
    *relative* spread, not absolute — caller passes the threshold appropriate
    to the metric (15pp for proportions, 20% for raw counts, etc.).

    Args:
        per_book_densities: dict mapping book id → numeric density value.
            Values may be rates (0..1), counts per 1k words, or any other
            magnitude — but they must be on the same scale across books.
        threshold_pct: relative tolerance band as a percentage (e.g., 20.0
            means "max-min within 20% of the mean = PASS"). Caller picks
            the threshold based on the metric's natural variance.

    Returns:
        PASS         if (max - min) / mean ≤ threshold_pct / 100
        PASS_PARTIAL if (max - min) / mean ≤ 2× threshold_pct / 100
        DIVERGE      if (max - min) / mean > 2× threshold
        KILL         if all densities zero or no books reported
        INSUFFICIENT_BOOKS if fewer than 2 books reported

    Examples:
        >>> gate_density_spread({"a": 0.20, "b": 0.21, "c": 0.22}, 20.0)
        'PASS'
        >>> gate_density_spread({"a": 0.10, "b": 0.20, "c": 0.30}, 20.0)
        'DIVERGE'
    """
    densities = [v for v in per_book_densities.values() if v is not None]
    if len(densities) < 2:
        if not densities:
            return "KILL"
        return "INSUFFICIENT_BOOKS"

    mean = sum(densities) / len(densities)
    if mean == 0:
        # All zero → nothing to compare
        return "KILL"

    spread_pct = 100.0 * (max(densities) - min(densities)) / abs(mean)

    if spread_pct <= threshold_pct:
        return "PASS"
    if spread_pct <= 2 * threshold_pct:
        return "PASS_PARTIAL"
    return "DIVERGE"


# ---------------------------------------------------------------------------
# Gate 5: top-K overlap (set intersection across books)
# ---------------------------------------------------------------------------


def gate_top_k_overlap(
    per_book_topk_sets: dict[str, set],
    top_n: int = 3,
    min_shared_pairs: int = 3,
) -> tuple[int, Verdict]:
    """Verdict on whether per-book top-K sets share enough common elements.

    Distinct from `gate_ranking_jaccard`: this gate looks at the SIZE of the
    cross-book intersection, not the pairwise mean Jaccard. Useful when the
    pattern shape is "the top-N set is mostly stable but the ordering shuffles"
    — e.g., Pattern 7 (beat boundary signals: top-4 set stable, rank-1 differs).

    Args:
        per_book_topk_sets: dict mapping book id → set of class names that
            appeared in that book's top-N. (Caller pre-truncates to top-N
            before passing in.)
        top_n: documentary; the size of each per-book set caller is expected
            to have truncated to. Used in default min_shared_pairs heuristics
            but not enforced.
        min_shared_pairs: PASS threshold — the intersection across ALL books
            must contain at least this many elements. Defaults to 3 (matches
            `chapter-opener-taxonomy.py` PASS rule).

    Returns:
        (intersection_size, verdict) tuple.
            PASS         if intersection size ≥ min_shared_pairs
            PASS_PARTIAL if intersection size ≥ 1 but < min_shared_pairs
            DIVERGE      if intersection size == 0
            KILL         if no books reported
            INSUFFICIENT_BOOKS if fewer than 2 books reported

    Examples:
        >>> gate_top_k_overlap({"a": {"x","y","z"}, "b": {"x","y","z"}}, top_n=3)
        (3, 'PASS')
        >>> gate_top_k_overlap({"a": {"x","y","z"}, "b": {"a","b","c"}}, top_n=3)
        (0, 'DIVERGE')
    """
    sets = [s for s in per_book_topk_sets.values() if s]
    if len(sets) < 2:
        if not sets:
            return 0, "KILL"
        return 0, "INSUFFICIENT_BOOKS"

    intersection = set.intersection(*sets)
    n = len(intersection)

    if n >= min_shared_pairs:
        return n, "PASS"
    if n >= 1:
        return n, "PASS_PARTIAL"
    return n, "DIVERGE"


# ---------------------------------------------------------------------------
# combine_gates — least-favorable verdict across multiple gate results
# ---------------------------------------------------------------------------


def combine_gates(gates: list[Verdict]) -> Verdict:
    """Combine multiple gate verdicts into the LEAST-favorable result.

    PASS only if all gates PASS; KILL if any gate KILLs; INSUFFICIENT_BOOKS
    if any gate reports it (treated as worse than KILL because it indicates
    incomplete data rather than a real null verdict). Otherwise PASS_PARTIAL
    or DIVERGE per the worst gate.

    This is the operational semantics behind every multi-gate ship decision
    in `crystal_shard-conclusions.md`: a pattern with PASS modal-class +
    PASS_PARTIAL ranking-Jaccard ships as PASS_PARTIAL because the secondary
    gate is the binding constraint.

    Args:
        gates: non-empty list of Verdict literals.

    Returns:
        The Verdict with the highest SEVERITY across the input list.

    Examples:
        >>> combine_gates(["PASS", "PASS"])
        'PASS'
        >>> combine_gates(["PASS", "PASS_PARTIAL"])
        'PASS_PARTIAL'
        >>> combine_gates(["PASS", "DIVERGE"])
        'DIVERGE'
        >>> combine_gates(["PASS_PARTIAL", "KILL"])
        'KILL'
        >>> combine_gates([])
        Traceback (most recent call last):
            ...
        ValueError: combine_gates requires at least one gate verdict
    """
    if not gates:
        raise ValueError("combine_gates requires at least one gate verdict")
    return max(gates, key=lambda v: SEVERITY[v])
