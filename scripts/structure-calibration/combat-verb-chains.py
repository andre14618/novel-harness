#!/usr/bin/env python3
"""Pattern 66 — Combat verb-chain sequence patterns in the Salvatore Icewind
Dale 3-book corpus.

Hypothesis
----------
P34b mined Salvatore's top-frequency action verbs (turn / move / look / fall /
hold / start / pull). This pattern measures what comes NEXT — within an
action-kind beat, what's the typical verb-CLASS TRANSITION sequence? Example
chains:

  - Body-positioning → strike → reaction (turned → swung → fell back)
  - Approach → contact → withdraw         (moved toward → grabbed → pulled away)
  - Sense → respond → strike               (saw → ducked → thrust)

If verb-class transitions are stable cross-book, that's a writer-prompt prior
for action-beat composition: "scenes follow this rhythm pattern, not random
verb order."

Methodology
-----------
1. **Verb-class lexicon.** Eight classes:

      POSITIONING — turn / move / step / lean / crouch / bend / twist / spin / shift / rise (+ past tenses)
      APPROACH    — walk / run / stride / charge / race / rush / leap / jump / dive / lunge / advance / approach
      STRIKE      — swing / slash / thrust / stab / hit / strike / punch / kick / smash / slam / crash
      GRIP        — grab / grasp / clutch / hold / seize / snatch / pull / push / drag / lift / heft
      FALL        — fall / drop / collapse / tumble / sink
      SENSE       — see / hear / feel / watch / look / gaze / listen / glance / peer / notice / spot
      REACT       — dodge / parry / block / deflect / evade / duck / recoil
      COGNITIVE   — realize / think / know / decide / understand / remember

   Each class lists base + past forms (turn/turned, move/moved, ...). Verbs
   that fall into multiple classes in principle (e.g. `crash` in STRIKE +
   FALL) are routed to a single primary class — STRIKE for `crash` because
   it's used as collision-impact verb in IWD action sequences. The full
   mapping is in `VERB_CLASS` below.

2. **Per-beat verb-class sequence.** For each action-kind beat:
     - tokenize text (lowercase word-boundary regex)
     - walk left-to-right; emit a class tag whenever a token matches a
       lexicon entry
     - skip beats with fewer than 3 tagged verbs (sequence too short for
       a trigram)

3. **Trigram counts.** For each beat, slide a window of 3 consecutive tags
   and tally `(class_A, class_B, class_C)`. Aggregate per book.

4. **Top-10 trigrams per book.** Compare cross-book: how many of book A's
   top-10 also appear in book B's top-10? (3-way intersection size, pairwise
   intersection size).

5. **Bigram transition matrix.** For each beat, slide a window of 2 and tally
   `(class_A → class_B)`. Per book, compute row-normalized transition
   probabilities (P(B | A)). Identify the **top-3 most-frequent transitions**
   per book; check 3-way overlap.

6. **Class-position priors.** For each beat's verb-class sequence, normalize
   the index of each occurrence to [0, 1] (position / max_index). Aggregate
   per class to produce a position distribution; derive `top-1 position
   tertile` (start [0, 0.33] / mid [0.33, 0.67] / end [0.67, 1.0]) and check
   whether the modal tertile per class is stable across books.

7. **Cross-book gate.**
     PASS         — top-3 transitions reproduce 3/3 books AND class-position
                    modal tertile reproduces 3/3 for ≥6 of 8 classes
     PASS_PARTIAL — top-3 transitions reproduce 2/3 OR class-position 4-5/8
     DIVERGE      — unstable
     KILL         — no signal (top-3 0/3 AND class-position ≤ 3/8)

Output deliverables
-------------------
1. JSON timestamped artifact:
     novels/salvatore-icewind-dale/structure-calibration/
       crystal_shard.<YYYYMMDDTHHMMSS>.combat-verb-chains.json
2. Atomic-append section to crystal_shard-conclusions.md (fcntl flock).
3. Atomic insert roadmap row above the `\\n**Sequencing` anchor (fcntl flock,
   pattern 66, 7-column).

Design notes
------------
* **Why verb classes, not raw verbs?** P34b already covered raw frequencies.
  This pattern asks: when Salvatore writes action, does he sequence the
  verb TYPES in a learnable rhythm? Class abstraction is what would let a
  writer-prompt impose structure ("position → strike → react") without
  binding to specific lexemes.
* **Why 3+ tagged verbs minimum?** A 2-verb beat can give one bigram but no
  trigram. Filtering to 3+ keeps trigram + bigram sample sizes coupled.
* **Why action-kind only?** The hypothesis is specifically about combat
  rhythm. Description / interiority / dialogue beats use these verbs in
  different rhetorical positions and would dilute the signal.
* **Past-tense bias.** Salvatore writes in narrative past, so the lexicon
  emphasises past forms (`turned`, `swung`, `fell`). Bare base forms are
  also kept for inside-dialogue verbs / present-tense narration outliers.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean

# Local lib for atomic write helpers (parallel-subagent-safe).
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)

# ---------------------------------------------------------------------------
# Paths + constants
# ---------------------------------------------------------------------------

PATTERN_ID = 66
PATTERN_NAME = "Combat verb-chain sequences"

REPO = Path(__file__).resolve().parents[2]
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

BOOKS = ("crystal_shard", "streams_of_silver", "halflings_gem")
ACTIVE_KIND = "action"
MIN_VERBS_PER_BEAT = 3

CLASSES = (
    "POSITIONING",
    "APPROACH",
    "STRIKE",
    "GRIP",
    "FALL",
    "SENSE",
    "REACT",
    "COGNITIVE",
)

# ---------------------------------------------------------------------------
# Verb-class lexicon
# ---------------------------------------------------------------------------
# Each class lists case-insensitive verb lemmas + past tenses + a few
# common participles. Where a verb could plausibly fall into two classes
# we pick the one that matches its dominant Salvatore use.
#   - `crash` lives in STRIKE (collision-impact) but `crashed down` is
#     occasionally a fall-tense use; we keep it in STRIKE because the
#     spec listed it under STRIKE first.
#   - `dive`/`dove`/`dived` lives in APPROACH (closing distance toward).
#   - `look`/`looked` lives in SENSE (perceiving), even though `look at`
#     is sometimes a body orientation. SENSE is the dominant function.
#   - `start`/`started` is intentionally OMITTED — it's a high-frequency
#     auxiliary ("started to run") and would noise-dominate APPROACH if
#     mapped there.

VERB_CLASS_GROUPS: dict[str, list[str]] = {
    "POSITIONING": [
        "turn", "turned", "turning", "turns",
        "move", "moved", "moving", "moves",
        "step", "stepped", "stepping", "steps",
        "lean", "leaned", "leaning", "leans",
        "crouch", "crouched", "crouching", "crouches",
        "bend", "bent", "bending", "bends",
        "twist", "twisted", "twisting", "twists",
        "spin", "spun", "spinning", "spins",
        "shift", "shifted", "shifting", "shifts",
        "rise", "rose", "risen", "rising", "rises",
        "wheel", "wheeled", "wheeling", "wheels",
    ],
    "APPROACH": [
        "walk", "walked", "walking", "walks",
        "run", "ran", "running", "runs",
        "stride", "strode", "striding", "strides",
        "charge", "charged", "charging", "charges",
        "race", "raced", "racing", "races",
        "rush", "rushed", "rushing", "rushes",
        "leap", "leaped", "leapt", "leaping", "leaps",
        "jump", "jumped", "jumping", "jumps",
        "dive", "dived", "dove", "diving", "dives",
        "lunge", "lunged", "lunging", "lunges",
        "advance", "advanced", "advancing", "advances",
        "approach", "approached", "approaching", "approaches",
        "spring", "sprang", "sprung", "springing", "springs",
    ],
    "STRIKE": [
        "swing", "swung", "swinging", "swings",
        "slash", "slashed", "slashing", "slashes",
        "thrust", "thrusting", "thrusts",
        "stab", "stabbed", "stabbing", "stabs",
        "hit", "hitting", "hits",
        "strike", "struck", "striking", "strikes",
        "punch", "punched", "punching", "punches",
        "kick", "kicked", "kicking", "kicks",
        "smash", "smashed", "smashing", "smashes",
        "slam", "slammed", "slamming", "slams",
        "crash", "crashed", "crashing", "crashes",
        "drove",
    ],
    "GRIP": [
        "grab", "grabbed", "grabbing", "grabs",
        "grasp", "grasped", "grasping", "grasps",
        "clutch", "clutched", "clutching", "clutches",
        "hold", "held", "holding", "holds",
        "seize", "seized", "seizing", "seizes",
        "snatch", "snatched", "snatching", "snatches",
        "pull", "pulled", "pulling", "pulls",
        "push", "pushed", "pushing", "pushes",
        "drag", "dragged", "dragging", "drags",
        "lift", "lifted", "lifting", "lifts",
        "heft", "hefted", "hefting", "hefts",
        "raise", "raised", "raising", "raises",
        "lower", "lowered", "lowering", "lowers",
    ],
    "FALL": [
        "fall", "fell", "fallen", "falling", "falls",
        "drop", "dropped", "dropping", "drops",
        "collapse", "collapsed", "collapsing", "collapses",
        "tumble", "tumbled", "tumbling", "tumbles",
        "sink", "sank", "sunk", "sinking", "sinks",
        "topple", "toppled", "toppling", "topples",
    ],
    "SENSE": [
        "see", "saw", "seen", "seeing", "sees",
        "hear", "heard", "hearing", "hears",
        "feel", "felt", "feeling", "feels",
        "watch", "watched", "watching", "watches",
        "look", "looked", "looking", "looks",
        "gaze", "gazed", "gazing", "gazes",
        "listen", "listened", "listening", "listens",
        "glance", "glanced", "glancing", "glances",
        "peer", "peered", "peering", "peers",
        "notice", "noticed", "noticing", "notices",
        "spot", "spotted", "spotting", "spots",
    ],
    "REACT": [
        "dodge", "dodged", "dodging", "dodges",
        "parry", "parried", "parrying", "parries",
        "block", "blocked", "blocking", "blocks",
        "deflect", "deflected", "deflecting", "deflects",
        "evade", "evaded", "evading", "evades",
        "duck", "ducked", "ducking", "ducks",
        "recoil", "recoiled", "recoiling", "recoils",
        "flinch", "flinched", "flinching", "flinches",
    ],
    "COGNITIVE": [
        "realize", "realized", "realizing", "realizes",
        "think", "thought", "thinking", "thinks",
        "know", "knew", "known", "knowing", "knows",
        "decide", "decided", "deciding", "decides",
        "understand", "understood", "understanding", "understands",
        "remember", "remembered", "remembering", "remembers",
    ],
}

# Build lookup: token -> class label (None if unmapped)
VERB_CLASS: dict[str, str] = {}
for cls, words in VERB_CLASS_GROUPS.items():
    for w in words:
        if w in VERB_CLASS and VERB_CLASS[w] != cls:
            raise ValueError(
                f"Lexicon collision: {w!r} listed under both "
                f"{VERB_CLASS[w]!r} and {cls!r}; pick one"
            )
        VERB_CLASS[w] = cls

# Word-boundary token regex (lowercase only, alpha tokens)
_TOKEN_RE = re.compile(r"\b[a-z]+\b")


# ---------------------------------------------------------------------------
# Loading + sequence extraction
# ---------------------------------------------------------------------------


def commit_short() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(REPO),
            stderr=subprocess.DEVNULL,
        )
        return out.decode().strip()
    except subprocess.CalledProcessError:
        return "unknown"


def load_beats() -> list[dict]:
    beats: list[dict] = []
    with BEATS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            beats.append(json.loads(line))
    return beats


def tag_sequence(text: str) -> list[str]:
    """Tokenize text and emit class tags in token order.

    Returns: list of class labels (one per matching token), in left-to-right
    order. Tokens not in the lexicon are dropped (they don't get a tag).
    """
    if not text:
        return []
    toks = _TOKEN_RE.findall(text.lower())
    tags = []
    for t in toks:
        cls = VERB_CLASS.get(t)
        if cls is not None:
            tags.append(cls)
    return tags


# ---------------------------------------------------------------------------
# Trigram / bigram / position aggregation
# ---------------------------------------------------------------------------


def trigrams(seq: list[str]) -> list[tuple[str, str, str]]:
    return [(seq[i], seq[i + 1], seq[i + 2]) for i in range(len(seq) - 2)]


def bigrams(seq: list[str]) -> list[tuple[str, str]]:
    return [(seq[i], seq[i + 1]) for i in range(len(seq) - 1)]


def position_tertile(idx: int, n: int) -> str:
    """Bucket a token index in [0, n-1] into start/mid/end tertile.

    A sequence of length n has indices 0..n-1; we normalize to position =
    idx / max(1, n - 1) and bucket on [0, 0.33] / (0.33, 0.67] / (0.67, 1.0].
    For n == 1 we treat it as 'start' (degenerate). Sequences with n == 2
    bucket index 0 to 'start' and index 1 to 'end' (no mid by construction).
    """
    if n <= 1:
        return "start"
    pos = idx / (n - 1)
    if pos <= 1 / 3 + 1e-9:
        return "start"
    elif pos <= 2 / 3 + 1e-9:
        return "mid"
    else:
        return "end"


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


def analyze(beats: list[dict]) -> dict:
    # Per-book containers
    sequences_per_book: dict[str, list[list[str]]] = {b: [] for b in BOOKS}
    trigram_counts: dict[str, Counter] = {b: Counter() for b in BOOKS}
    bigram_counts: dict[str, Counter] = {b: Counter() for b in BOOKS}
    position_counts: dict[str, dict[str, Counter]] = {
        b: {c: Counter() for c in CLASSES} for b in BOOKS
    }
    class_counts_per_book: dict[str, Counter] = {b: Counter() for b in BOOKS}

    n_action_total = 0
    n_action_used = 0
    n_action_skipped_short = 0
    skipped_books: Counter = Counter()

    for b in beats:
        if b.get("kind") != ACTIVE_KIND:
            continue
        n_action_total += 1
        book = b.get("book")
        if book not in sequences_per_book:
            # Out-of-corpus or unknown — skip
            continue
        text = b.get("text", "") or ""
        seq = tag_sequence(text)
        if len(seq) < MIN_VERBS_PER_BEAT:
            n_action_skipped_short += 1
            skipped_books[book] += 1
            continue
        n_action_used += 1
        sequences_per_book[book].append(seq)

        # Trigrams + bigrams + per-class counts
        for tri in trigrams(seq):
            trigram_counts[book][tri] += 1
        for bi in bigrams(seq):
            bigram_counts[book][bi] += 1
        for cls in seq:
            class_counts_per_book[book][cls] += 1

        # Positions
        n = len(seq)
        for idx, cls in enumerate(seq):
            tertile = position_tertile(idx, n)
            position_counts[book][cls][tertile] += 1

    # ---- Top-10 trigrams per book ---------------------------------------
    top_trigrams_per_book: dict[str, list[dict]] = {}
    for book in BOOKS:
        items = trigram_counts[book].most_common(10)
        top_trigrams_per_book[book] = [
            {"trigram": " → ".join(tri), "count": cnt}
            for tri, cnt in items
        ]

    # 3-way intersection of top-10 trigrams (by tuple)
    sets_top10 = [set(t for t, _ in trigram_counts[b].most_common(10)) for b in BOOKS]
    trigram_3way_intersection = sets_top10[0] & sets_top10[1] & sets_top10[2] if all(sets_top10) else set()
    trigram_pairwise = {
        f"{BOOKS[i]}∩{BOOKS[j]}": list(
            {" → ".join(t) for t in (sets_top10[i] & sets_top10[j])}
        )
        for i in range(3) for j in range(i + 1, 3)
    }

    # ---- Bigram transition matrix per book ------------------------------
    transition_p: dict[str, dict[str, dict[str, float]]] = {}
    for book in BOOKS:
        from_totals: Counter = Counter()
        for (a, b_), cnt in bigram_counts[book].items():
            from_totals[a] += cnt
        m: dict[str, dict[str, float]] = {}
        for cls_from in CLASSES:
            row: dict[str, float] = {}
            tot = from_totals.get(cls_from, 0)
            if tot == 0:
                for cls_to in CLASSES:
                    row[cls_to] = 0.0
            else:
                for cls_to in CLASSES:
                    cnt = bigram_counts[book].get((cls_from, cls_to), 0)
                    row[cls_to] = cnt / tot
            m[cls_from] = row
        transition_p[book] = m

    # Top-3 bigrams per book (by RAW count)
    top_bigrams_per_book: dict[str, list[dict]] = {}
    for book in BOOKS:
        items = bigram_counts[book].most_common(3)
        top_bigrams_per_book[book] = [
            {"bigram": f"{a} → {b_}", "count": cnt}
            for (a, b_), cnt in items
        ]

    # 3-way intersection of top-3 bigrams (by tuple)
    sets_top3_bg = [set(t for t, _ in bigram_counts[b].most_common(3)) for b in BOOKS]
    bigram_3way_intersection = (
        sets_top3_bg[0] & sets_top3_bg[1] & sets_top3_bg[2]
        if all(sets_top3_bg) else set()
    )
    bigram_pairwise = {
        f"{BOOKS[i]}∩{BOOKS[j]}": list(
            {f"{a} → {b_}" for (a, b_) in (sets_top3_bg[i] & sets_top3_bg[j])}
        )
        for i in range(3) for j in range(i + 1, 3)
    }

    # ---- Class-position concentration -----------------------------------
    # For each (book, class), compute the modal tertile (start/mid/end)
    # and the share of that tertile in the class's total occurrences.
    position_modal_per_book: dict[str, dict[str, dict]] = {}
    for book in BOOKS:
        out: dict[str, dict] = {}
        for cls in CLASSES:
            counts = position_counts[book][cls]
            total = sum(counts.values())
            if total == 0:
                out[cls] = {
                    "modal_tertile": None,
                    "share": None,
                    "tertile_counts": {"start": 0, "mid": 0, "end": 0},
                    "n": 0,
                }
                continue
            tert_counts = {
                "start": counts.get("start", 0),
                "mid": counts.get("mid", 0),
                "end": counts.get("end", 0),
            }
            modal = max(tert_counts, key=lambda k: tert_counts[k])
            share = tert_counts[modal] / total
            out[cls] = {
                "modal_tertile": modal,
                "share": round(share, 4),
                "tertile_counts": tert_counts,
                "n": total,
            }
        position_modal_per_book[book] = out

    # Per-class cross-book modal-tertile agreement (3/3, 2/3, 1/3)
    position_modal_agreement: dict[str, dict] = {}
    n_classes_modal_3of3 = 0
    n_classes_modal_2of3 = 0
    n_classes_modal_1or0 = 0
    for cls in CLASSES:
        per_book_modal = {
            book: position_modal_per_book[book][cls]["modal_tertile"]
            for book in BOOKS
        }
        # Agreement count: most common modal among 3 books
        modals_present = [v for v in per_book_modal.values() if v is not None]
        if not modals_present:
            position_modal_agreement[cls] = {
                "per_book_modal": per_book_modal,
                "consensus_tertile": None,
                "consensus_count": 0,
                "agreement": "n/a",
            }
            n_classes_modal_1or0 += 1
            continue
        ctr = Counter(modals_present)
        consensus, cnt = ctr.most_common(1)[0]
        if cnt == 3:
            label = "3/3"
            n_classes_modal_3of3 += 1
        elif cnt == 2:
            label = "2/3"
            n_classes_modal_2of3 += 1
        else:
            label = "1/3"
            n_classes_modal_1or0 += 1
        position_modal_agreement[cls] = {
            "per_book_modal": per_book_modal,
            "consensus_tertile": consensus,
            "consensus_count": cnt,
            "agreement": label,
        }

    # ---- Class-density per book (sanity, not gating) --------------------
    class_density_per_book: dict[str, dict[str, float]] = {}
    for book in BOOKS:
        cnts = class_counts_per_book[book]
        total = sum(cnts.values())
        class_density_per_book[book] = {
            cls: round(cnts.get(cls, 0) / total, 4) if total else 0.0
            for cls in CLASSES
        }

    # ---- Cross-book gate ------------------------------------------------
    bigram_top3_3way_count = len(bigram_3way_intersection)
    trigram_top10_3way_count = len(trigram_3way_intersection)

    # Verdict policy:
    if bigram_top3_3way_count == 3 and n_classes_modal_3of3 >= 6:
        verdict = "PASS"
    elif (bigram_top3_3way_count >= 2) or (n_classes_modal_3of3 >= 4):
        verdict = "PASS_PARTIAL"
    elif bigram_top3_3way_count == 0 and n_classes_modal_3of3 <= 3:
        verdict = "KILL"
    else:
        verdict = "DIVERGE"

    verdict_summary = (
        f"Top-3 bigrams 3-way intersection={bigram_top3_3way_count}/3; "
        f"top-10 trigrams 3-way intersection={trigram_top10_3way_count}; "
        f"class-position modal-tertile 3/3 agreement={n_classes_modal_3of3}/8 "
        f"(2/3={n_classes_modal_2of3}, 1/3-or-missing={n_classes_modal_1or0})."
    )

    return {
        "n_action_beats_total": n_action_total,
        "n_action_beats_used": n_action_used,
        "n_action_beats_skipped_short": n_action_skipped_short,
        "skipped_short_per_book": dict(skipped_books),
        "min_verbs_per_beat": MIN_VERBS_PER_BEAT,
        "n_classes": len(CLASSES),
        "classes": list(CLASSES),
        "class_density_per_book": class_density_per_book,
        "class_counts_per_book": {
            b: dict(class_counts_per_book[b]) for b in BOOKS
        },
        "top_trigrams_per_book": top_trigrams_per_book,
        "trigram_top10_3way_intersection": [
            " → ".join(t) for t in trigram_3way_intersection
        ],
        "trigram_top10_pairwise_intersection": trigram_pairwise,
        "trigram_top10_3way_count": trigram_top10_3way_count,
        "top_bigrams_per_book": top_bigrams_per_book,
        "bigram_top3_3way_intersection": [
            f"{a} → {b_}" for (a, b_) in bigram_3way_intersection
        ],
        "bigram_top3_pairwise_intersection": bigram_pairwise,
        "bigram_top3_3way_count": bigram_top3_3way_count,
        "transition_probabilities_per_book": transition_p,
        "position_modal_per_book": position_modal_per_book,
        "position_modal_agreement": position_modal_agreement,
        "n_classes_modal_3of3": n_classes_modal_3of3,
        "n_classes_modal_2of3": n_classes_modal_2of3,
        "n_classes_modal_1or0": n_classes_modal_1or0,
        "overall_verdict": verdict,
        "verdict_summary": verdict_summary,
    }


# ---------------------------------------------------------------------------
# Conclusions section + roadmap row
# ---------------------------------------------------------------------------


def fmt_pct(x: float | None) -> str:
    return f"{x*100:.1f}%" if x is not None else "—"


def build_conclusions_section(result: dict, json_path: Path, commit: str) -> str:
    overall = result["overall_verdict"]

    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_ID}: {PATTERN_NAME}")
    lines.append("")
    lines.append(
        f"_Pure-compute verb-class sequence analysis across 3 books × `{ACTIVE_KIND}`-kind beats. "
        f"Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")

    lines.append("### Methodology")
    lines.append("")
    lines.append(
        "Eight verb classes (POSITIONING / APPROACH / STRIKE / GRIP / FALL / "
        "SENSE / REACT / COGNITIVE) are tagged per `action`-kind beat. Tokens "
        "not in the lexicon are dropped. The remaining ordered class-tags form "
        "the **verb-class sequence** for the beat."
    )
    lines.append("")
    lines.append(
        "Per beat we extract:"
    )
    lines.append("")
    lines.append(
        "- **Trigrams** of consecutive class tags `(A, B, C)` — top-10 per book."
    )
    lines.append(
        "- **Bigrams** `(A → B)` — row-normalized into a transition matrix `P(B | A)` per book; top-3 raw-count transitions per book."
    )
    lines.append(
        "- **Class-position tertile** — for each occurrence of class `c`, the index in the sequence is normalized to `[0,1]` and bucketed into start `[0, 0.33]` / mid `(0.33, 0.67]` / end `(0.67, 1.0]`. Modal tertile per (book, class) is the cross-book stability check."
    )
    lines.append("")
    lines.append(
        f"Beats with fewer than `{MIN_VERBS_PER_BEAT}` lexicon-tagged verbs are skipped "
        f"(no trigram possible). Skipped: {result['n_action_beats_skipped_short']} of "
        f"{result['n_action_beats_total']} action beats "
        f"({result['n_action_beats_skipped_short'] * 100 / max(1, result['n_action_beats_total']):.1f}%); "
        f"n={result['n_action_beats_used']} action beats analyzed."
    )
    lines.append("")
    lines.append("**Cross-book gate:**")
    lines.append("")
    lines.append(
        "- **PASS** — top-3 bigrams reproduce 3/3 books AND class-position modal tertile reproduces 3/3 for ≥6 of 8 classes"
    )
    lines.append(
        "- **PASS_PARTIAL** — top-3 bigrams reproduce 2/3 OR class-position modal 4–5 of 8"
    )
    lines.append(
        "- **DIVERGE** — neither floor met"
    )
    lines.append(
        "- **KILL** — top-3 bigrams 0/3 AND class-position modal ≤3 of 8"
    )
    lines.append("")

    # ---- Per-book class density ----
    lines.append("### Per-book class density (share of tagged-verb tokens by class)")
    lines.append("")
    header = "| book | " + " | ".join(CLASSES) + " | total tags |"
    sep = "|---|" + "|".join(["---:"] * (len(CLASSES) + 1)) + "|"
    lines.append(header)
    lines.append(sep)
    for book in BOOKS:
        tot = sum(result["class_counts_per_book"][book].values())
        cells = [
            f"{result['class_density_per_book'][book].get(cls, 0)*100:.1f}%"
            for cls in CLASSES
        ]
        lines.append(f"| {book} | " + " | ".join(cells) + f" | {tot} |")
    lines.append("")

    # ---- Top-10 trigrams per book ----
    lines.append("### Top-10 verb-class trigrams per book")
    lines.append("")
    for book in BOOKS:
        lines.append(f"**{book}**")
        lines.append("")
        lines.append("| Rank | Trigram | Count |")
        lines.append("|---:|---|---:|")
        for i, entry in enumerate(result["top_trigrams_per_book"][book], 1):
            lines.append(f"| {i} | `{entry['trigram']}` | {entry['count']} |")
        lines.append("")

    inter_3way = result["trigram_top10_3way_intersection"]
    lines.append(
        f"**3-way trigram top-10 intersection ({len(inter_3way)} item(s)):** "
        + (", ".join(f"`{t}`" for t in inter_3way) if inter_3way else "_none_")
    )
    lines.append("")
    lines.append("**Pairwise trigram top-10 intersections:**")
    lines.append("")
    for pair, terms in result["trigram_top10_pairwise_intersection"].items():
        terms_str = ", ".join(f"`{t}`" for t in terms) if terms else "_none_"
        lines.append(f"- {pair} ({len(terms)}): {terms_str}")
    lines.append("")

    # ---- Top-3 bigrams per book ----
    lines.append("### Top-3 bigram transitions per book (raw count)")
    lines.append("")
    lines.append("| Book | #1 | #2 | #3 |")
    lines.append("|---|---|---|---|")
    for book in BOOKS:
        bgs = result["top_bigrams_per_book"][book]
        cells = []
        for i in range(3):
            if i < len(bgs):
                cells.append(f"`{bgs[i]['bigram']}` ({bgs[i]['count']})")
            else:
                cells.append("—")
        lines.append(f"| {book} | " + " | ".join(cells) + " |")
    lines.append("")

    bg_3way = result["bigram_top3_3way_intersection"]
    lines.append(
        f"**3-way top-3 bigram intersection ({len(bg_3way)} item(s)):** "
        + (", ".join(f"`{t}`" for t in bg_3way) if bg_3way else "_none_")
    )
    lines.append("")
    lines.append("**Pairwise top-3 bigram intersections:**")
    lines.append("")
    for pair, terms in result["bigram_top3_pairwise_intersection"].items():
        terms_str = ", ".join(f"`{t}`" for t in terms) if terms else "_none_"
        lines.append(f"- {pair} ({len(terms)}): {terms_str}")
    lines.append("")

    # ---- Transition-probability matrix (per book) ----
    lines.append("### Transition probability `P(next | from)` per book")
    lines.append("")
    lines.append(
        "Row sums to 1.0 (or 0 if class never starts a bigram). Cells show "
        "the probability of the next-class given the from-class. Useful for "
        "writer-prompt rhythm priors (e.g. given `STRIKE`, what's the modal "
        "follow-on class?)."
    )
    lines.append("")
    for book in BOOKS:
        lines.append(f"**{book}**")
        lines.append("")
        header = "| from \\ to | " + " | ".join(CLASSES) + " |"
        sep = "|---|" + "|".join(["---:"] * len(CLASSES)) + "|"
        lines.append(header)
        lines.append(sep)
        m = result["transition_probabilities_per_book"][book]
        for cls_from in CLASSES:
            row = m[cls_from]
            cells = [f"{row.get(cls_to, 0.0):.2f}" for cls_to in CLASSES]
            lines.append(f"| {cls_from} | " + " | ".join(cells) + " |")
        lines.append("")

    # ---- Class-position modal tertile per book ----
    lines.append("### Per-book class-position modal tertile (start / mid / end)")
    lines.append("")
    lines.append(
        "For each class, the position-modal tertile = the third of the beat-"
        "sequence where this class most-often falls. `share` is the proportion "
        "of class-occurrences in that modal tertile."
    )
    lines.append("")
    for book in BOOKS:
        lines.append(f"**{book}**")
        lines.append("")
        lines.append("| Class | Modal | Share | n | start | mid | end |")
        lines.append("|---|---|---:|---:|---:|---:|---:|")
        for cls in CLASSES:
            cell = result["position_modal_per_book"][book][cls]
            modal = cell["modal_tertile"] or "—"
            share = fmt_pct(cell["share"])
            n = cell["n"]
            tc = cell["tertile_counts"]
            lines.append(
                f"| {cls} | {modal} | {share} | {n} | {tc['start']} | {tc['mid']} | {tc['end']} |"
            )
        lines.append("")

    # ---- Class-position cross-book agreement ----
    lines.append("### Class-position modal-tertile cross-book agreement")
    lines.append("")
    lines.append("| Class | crystal_shard | streams_of_silver | halflings_gem | Consensus | Agreement |")
    lines.append("|---|---|---|---|---|---:|")
    for cls in CLASSES:
        agree = result["position_modal_agreement"][cls]
        per = agree["per_book_modal"]
        lines.append(
            f"| {cls} | {per.get('crystal_shard') or '—'} | "
            f"{per.get('streams_of_silver') or '—'} | "
            f"{per.get('halflings_gem') or '—'} | "
            f"{agree['consensus_tertile'] or '—'} | "
            f"**{agree['agreement']}** |"
        )
    lines.append("")
    lines.append(
        f"**Modal-tertile cross-book agreement summary:** "
        f"3/3={result['n_classes_modal_3of3']}, "
        f"2/3={result['n_classes_modal_2of3']}, "
        f"1/3-or-missing={result['n_classes_modal_1or0']} "
        f"(of {len(CLASSES)} classes)."
    )
    lines.append("")

    # ---- Verdict ----
    lines.append("### Verdict")
    lines.append("")
    lines.append(f"**Overall verdict: `{overall}`**")
    lines.append("")
    lines.append(result["verdict_summary"])
    lines.append("")

    # ---- Proposed harness levers (verdict-aware) ----
    lines.append("### Proposed harness levers")
    lines.append("")
    levers = build_levers(result)
    for i, lev in enumerate(levers, 1):
        lines.append(f"{i}. {lev}")
    lines.append("")

    # ---- Conclusion + Action ----
    lines.append("### Conclusion + Action")
    lines.append("")
    lines.append(
        f"**Conclusion.** {result['verdict_summary']} The 3-way top-3 bigram "
        f"intersection of {result['bigram_top3_3way_count']}/3 and "
        f"{result['n_classes_modal_3of3']}/8 cross-book modal-tertile "
        f"agreements together yield verdict **`{overall}`**."
    )
    lines.append("")
    if overall == "PASS":
        action = (
            "**Action.** Promote DRAFT → SHIP under `WRITER_GENRE_PACKS` "
            "Salvatore-cluster fantasy. Codify the cross-book-stable transition pairs as "
            "writer-prompt rhythm priors and ship the class-position priors as soft expectations."
        )
    elif overall == "PASS_PARTIAL":
        action = (
            "**Action.** Ship the cross-book-stable subset of transitions and modal-tertile "
            "priors as a soft writer-prompt prior; defer absolute class-density floors and any "
            "lint rule that would fire on missing transitions until the unstable subset is "
            "explained or controlled for. Useful as a directional hint to the writer, not a "
            "blocking gate."
        )
    elif overall == "DIVERGE":
        action = (
            "**Action.** HOLD on codifying transition or class-position priors. Aggregate "
            "class-density numbers remain usable as a coarse prior; per-transition / per-class "
            "priors are not yet shippable without finer stratification (per-character / "
            "per-scene-pace bucket)."
        )
    else:  # KILL
        action = (
            "**Action.** No signal. Action-beat verb-class sequencing is NOT a Salvatore-stable "
            "writer-prompt prior at this granularity. Drop the lever; do not retest at this "
            "abstraction."
        )
    lines.append(action)
    lines.append("")

    return "\n".join(lines)


def build_levers(result: dict) -> list[str]:
    overall = result["overall_verdict"]
    levers: list[str] = []

    # Lever 1 — top-3 bigram cross-book intersection priors
    bg_3way = result["bigram_top3_3way_intersection"]
    if bg_3way:
        levers.append(
            "**Writer-prompt action-beat rhythm prior** — codify the cross-book-stable "
            f"top-3 bigram transition(s) as a soft prior: {', '.join(f'`{t}`' for t in bg_3way)}. "
            "Insert into `WRITER_GENRE_PACKS` Salvatore-cluster fantasy: 'When writing a combat "
            "or kinetic action beat, anchor your sentence-level rhythm to these verb-class "
            "transitions; the corpus uses them as the dominant beat-rhythm.' Soft prior — does "
            "NOT preclude other transitions, but biases the modal cadence."
        )
    else:
        levers.append(
            "**Writer-prompt action-beat rhythm prior** — no 3-way-stable bigram emerged at this "
            "granularity. The pattern doesn't yield a transition-level prompt prior. Drop this lever "
            "or attempt at a finer slice (per-POV / per-character action style)."
        )

    # Lever 2 — class-position priors (start/mid/end)
    stable_classes = [
        cls for cls in CLASSES
        if result["position_modal_agreement"][cls]["agreement"] == "3/3"
    ]
    if stable_classes:
        modal_per_class = {
            cls: result["position_modal_agreement"][cls]["consensus_tertile"]
            for cls in stable_classes
        }
        modal_str = "; ".join(f"`{cls}`→{modal}" for cls, modal in modal_per_class.items())
        levers.append(
            "**Class-position writer-prompt prior** — the following classes have a "
            f"3/3-stable modal tertile in action beats: {modal_str}. Use this as a "
            "compositional hint to the writer ('SENSE typically opens; STRIKE typically "
            "lands mid-beat; FALL typically lands at end'); the prior is not a hard rule "
            "but matches the corpus rhythm. Maps directly into `WRITER_GENRE_PACKS` "
            "fantasy-Salvatore action-beat composition guidance."
        )
    else:
        levers.append(
            "**Class-position writer-prompt prior** — no class achieved 3/3 modal-tertile "
            "agreement. Position-within-beat rhythm is not stable enough to codify as a "
            "compositional prior."
        )

    # Lever 3 — voice fewshot exemplars (top-trigram-rich beats)
    if result["trigram_top10_3way_count"] > 0:
        ex_strs = ", ".join(f"`{t}`" for t in result["trigram_top10_3way_intersection"])
        levers.append(
            f"**Voice-fewshot exemplars** — beats whose tagged sequence contains any "
            f"of the 3-way intersection trigrams ({ex_strs}) are high-signal exemplars "
            "for action-beat fewshot pools. Filter to top-decile-trigram-density action "
            "beats and attach to the Salvatore-cluster fewshot bank."
        )
    else:
        levers.append(
            "**Voice-fewshot exemplars** — no 3-way-stable trigram. Use the per-book top-10 "
            "trigrams (above) as PER-BOOK exemplar-selection signals only, not as a "
            "cross-corpus prior."
        )

    # Lever 4 — quality-redraft detector candidates
    if overall in ("PASS", "PASS_PARTIAL"):
        levers.append(
            "**Quality-redraft detector candidates** — `low_action_verb_density` (action "
            "beat with fewer than `MIN_VERBS_PER_BEAT` lexicon-tagged verbs = degraded "
            "summary anti-pattern, redraft from blank context). Composes with the "
            "Pattern 64 `low-showing-action-beat` detector. Both fire on the same beats "
            "where Salvatore would have used concrete kinetic verbs."
        )
    else:
        levers.append(
            "**Quality-redraft detector candidates** — at this verdict, do NOT add a "
            "verb-density detector; the corpus signal isn't tight enough to support a "
            "regeneration trigger. Defer until per-character / per-scene-pace stratification "
            "tightens the per-class density bands."
        )

    # Lever 5 — composition with neighbor patterns
    levers.append(
        "**Pattern composition.** Pattern 66 stacks with Pattern 64 (showing-vs-telling), "
        "Pattern 53 (sensory-mode density), Pattern 56 (body-part vocabulary anchor), and "
        "Pattern 31 (beat-cluster sequence n-grams) — all four describe action-beat "
        "composition from different angles. Use Pattern 66's class-transition prior as the "
        "BACKBONE of action-beat fewshot selection; Pattern 64 as the showing-density "
        "filter; Pattern 56 as the camera-anchor selector."
    )

    # Lever 6 — caveats
    levers.append(
        "**Caveats.** (a) Lexicon coverage is partial — Salvatore's full action vocabulary "
        "is larger than the 8-class shortlist; verbs not in the lexicon are dropped, so "
        "the trigram counts are LOWER bounds, not exhaustive. (b) Past-tense bias matches "
        "Salvatore's narrative tense; the lexicon will undercount any action beats narrated "
        "in present tense. (c) Bigrams are unsmoothed raw counts; small-sample bigrams "
        "(fewer than 5 occurrences) should not feed shipping decisions, only directional "
        "hints. (d) `crash` is in STRIKE despite occasional FALL use; the choice biases "
        "STRIKE-density slightly upward."
    )

    # Verdict-conditioned ship status
    if overall == "PASS":
        levers.append(
            "**Ship status:** PASS — promote levers 1, 2, 3, 4 from DRAFT to ship-ready. "
            "Roll into `WRITER_GENRE_PACKS` Salvatore-cluster fantasy alongside Patterns "
            "64 / 65 / 53."
        )
    elif overall == "PASS_PARTIAL":
        levers.append(
            "**Ship status:** PASS_PARTIAL — ship the stable subset (3-way-intersection "
            "transitions + 3/3-modal classes); defer the unstable subset until finer "
            "stratification or a per-character split lands."
        )
    elif overall == "DIVERGE":
        levers.append(
            "**Ship status:** DIVERGE — do not codify per-transition / per-class-position "
            "priors. Aggregate class-density numbers remain usable as a coarse prior."
        )
    else:
        levers.append(
            "**Ship status:** KILL — no usable transition or position signal. Drop the "
            "lever; do not retest at this abstraction granularity."
        )

    return levers


def build_roadmap_row(result: dict, commit: str) -> str:
    overall = result["overall_verdict"]
    bg_3way = result["bigram_top3_3way_intersection"]
    tg_3way = result["trigram_top10_3way_intersection"]

    # Per-book top-1 bigram for compact summary
    top1_bg = []
    for book in BOOKS:
        bgs = result["top_bigrams_per_book"][book]
        if bgs:
            top1_bg.append(f"{book}={bgs[0]['bigram']}({bgs[0]['count']})")

    # Class-position 3/3 stable list
    stable_classes = [
        f"{cls}→{result['position_modal_agreement'][cls]['consensus_tertile']}"
        for cls in CLASSES
        if result["position_modal_agreement"][cls]["agreement"] == "3/3"
    ]

    findings = (
        f"action-beat verb-class sequence analysis on n="
        f"{result['n_action_beats_used']} action beats "
        f"(skipped {result['n_action_beats_skipped_short']} sub-{MIN_VERBS_PER_BEAT}-verb); "
        f"per-book top-1 bigram " + " / ".join(top1_bg) + "; "
        f"top-3 bigram 3-way intersection={result['bigram_top3_3way_count']}/3 "
        + (f"({', '.join(bg_3way)})" if bg_3way else "(none)")
        + f"; top-10 trigram 3-way intersection={result['trigram_top10_3way_count']} "
        + (f"({', '.join(tg_3way)})" if tg_3way else "(none)")
        + f"; class-position modal-tertile 3/3 agreement="
        f"{result['n_classes_modal_3of3']}/{len(CLASSES)} "
        + (f"(stable: {', '.join(stable_classes)})" if stable_classes else "(none stable)")
    )

    lever = (
        "writer-prompt action-beat rhythm prior via `WRITER_GENRE_PACKS` "
        "Salvatore-cluster (cross-book-stable bigram transitions + modal-tertile "
        "class-position hints); voice-fewshot exemplar selection via 3-way "
        "intersection trigrams; quality-redraft `low_action_verb_density` "
        "detector candidate; composes with Pattern 64 showing-density + "
        "Pattern 53 sensory-density + Pattern 56 body-part-anchor + Pattern 31 "
        "beat-cluster n-grams"
    )

    if overall == "PASS":
        verdict_short = "SHIP"
        recommend = (
            "ship cross-book-stable bigram transitions + modal-tertile class priors "
            "as soft writer-prompt rhythm prior under WRITER_GENRE_PACKS fantasy-Salvatore"
        )
    elif overall == "PASS_PARTIAL":
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship 3-way-stable subset (transitions + modal classes) as soft prior; "
            "defer unstable subset pending per-character/per-scene-pace stratification"
        )
    elif overall == "DIVERGE":
        verdict_short = "HOLD"
        recommend = (
            "do not codify per-transition or per-class-position priors at this granularity; "
            "aggregate class-density usable as coarse prior only"
        )
    else:
        verdict_short = "KILL"
        recommend = (
            "no signal; drop verb-class transition lever; do not retest at this abstraction"
        )

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
    print(f"action beats total = {result['n_action_beats_total']}; "
          f"used = {result['n_action_beats_used']}; "
          f"skipped (sub-{MIN_VERBS_PER_BEAT}-verb) = {result['n_action_beats_skipped_short']}")
    print()

    print("--- per-book class density (% of tagged tokens) ---")
    for book in BOOKS:
        cells = result["class_density_per_book"][book]
        cell_str = "  ".join(f"{cls}={cells[cls]*100:.1f}%" for cls in CLASSES)
        print(f"  {book}: {cell_str}")
    print()

    print("--- top-3 bigram transitions per book ---")
    for book in BOOKS:
        print(f"  {book}:")
        for entry in result["top_bigrams_per_book"][book]:
            print(f"    {entry['bigram']}  (count={entry['count']})")
    print()

    print(f"top-3 bigram 3-way intersection: {result['bigram_top3_3way_count']}/3")
    if result["bigram_top3_3way_intersection"]:
        for t in result["bigram_top3_3way_intersection"]:
            print(f"  {t}")
    print()

    print("--- top-10 trigrams per book (top-5 shown) ---")
    for book in BOOKS:
        print(f"  {book}:")
        for entry in result["top_trigrams_per_book"][book][:5]:
            print(f"    {entry['trigram']}  (count={entry['count']})")
    print()

    print(f"top-10 trigram 3-way intersection: {result['trigram_top10_3way_count']}")
    for t in result["trigram_top10_3way_intersection"]:
        print(f"  {t}")
    print()

    print("--- class-position modal-tertile cross-book agreement ---")
    for cls in CLASSES:
        agree = result["position_modal_agreement"][cls]
        per = agree["per_book_modal"]
        print(
            f"  {cls:>11s}: "
            f"CS={per.get('crystal_shard') or '—':<5s}  "
            f"SoS={per.get('streams_of_silver') or '—':<5s}  "
            f"HG={per.get('halflings_gem') or '—':<5s}  "
            f"consensus={agree['consensus_tertile']} ({agree['agreement']})"
        )
    print()
    print(f"modal-tertile 3/3 agreement: {result['n_classes_modal_3of3']}/{len(CLASSES)} classes")
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
        "lexicon": VERB_CLASS_GROUPS,
        "lexicon_size_per_class": {
            cls: len(words) for cls, words in VERB_CLASS_GROUPS.items()
        },
        "lexicon_total_unique_tokens": len(VERB_CLASS),
        "methodology": {
            "active_kind": ACTIVE_KIND,
            "min_verbs_per_beat": MIN_VERBS_PER_BEAT,
            "books": list(BOOKS),
            "classes": list(CLASSES),
            "tertile_buckets": {
                "start": "[0, 0.33]",
                "mid": "(0.33, 0.67]",
                "end": "(0.67, 1.0]",
            },
            "cross_book_gate": {
                "PASS": "top-3 bigrams 3/3 AND class-position modal-tertile 3/3 for >=6 of 8 classes",
                "PASS_PARTIAL": "top-3 bigrams >=2/3 OR class-position modal 4-5 of 8",
                "KILL": "top-3 bigrams 0/3 AND class-position modal <=3 of 8",
                "DIVERGE": "neither floor met",
            },
        },
        **result,
    }
    out_path = write_timestamped_json(
        OUT_DIR,
        slug="combat-verb-chains",
        content=payload,
        prefix="crystal_shard",
    )
    print(f"JSON written: {out_path}")

    # Atomic-append conclusions section
    section_md = build_conclusions_section(result, out_path, commit)
    atomic_append_section(CONCLUSIONS_PATH, section_md)
    print(f"Appended section: {CONCLUSIONS_PATH}")

    # Atomic insert roadmap row before the Sequencing anchor
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
