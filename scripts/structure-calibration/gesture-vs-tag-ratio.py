#!/usr/bin/env python3
"""
Pattern 73 — Body-language-vs-verbal-attribution ratio in dialogue.

Hypothesis. When Salvatore breaks a dialogue exchange, the break can take two
forms:

  - VERBAL TAG   — direct speech attribution: `Drizzt said`, `Bruenor growled`,
                   `Catti-brie whispered`, etc.
  - GESTURE BEAT — physical action that interrupts speech: `Drizzt turned his
                   head`, `Bruenor crossed his arms`, `Catti-brie's lips
                   tightened`. The reader infers continued attribution from the
                   immediately-prior context.

The RATIO of gesture-beats to verbal-tags within dialogue scenes is a writer-
prompt rhythm lever — orthogonal to P48 (tag-creativity, what verbs are used)
and P56 (body-part lexicon, what parts are referenced). This is about WHEN to
insert a gesture vs a tag.

Predictions:

  - Action beats carry more gesture-attributed dialogue
  - Interiority beats carry fewer breaks overall (POV speaks once or twice with
    attribution); when broken, more verbal-tags
  - Per-character: Bruenor likely gesture-heavy (crossing arms, gripping axe
    haft); Drizzt likely tag-heavy (stable speech); Wulfgar mixed

==============================================================================
Methodology — pure compute, $0
==============================================================================

For each beat with at least one quoted string, we identify each quoted line via
regex on `"..."` and (less commonly) `'...'`. For every quoted line, we
inspect the words 0..30 BEFORE and 0..30 AFTER the quote and classify the
attribution context using two lexicons:

  - TAG_VERBS    — finite forms of `said|asked|replied|growled|whispered|...`.
                   If a tag verb appears within 5 words of either quote
                   boundary, the line gets a VERBAL_TAG vote.
  - GESTURE_VERBS — finite forms of body-action verbs from the P34b/P56
                    families: `turned|moved|stepped|crossed|gripped|...`.
                    If a gesture verb appears within 10 words of either quote
                    boundary AND no tag verb appears within 5 words, the line
                    gets a GESTURE_BEAT vote.
  - BARE         — neither verb in the inspected window — quote is a clean
                   handoff to/from another quoted line (rapid back-and-forth).
  - MIXED        — both a tag verb (≤5w) and a gesture verb (≤10w) — counted
                   as half-credit toward GESTURE in the ratio (and full credit
                   toward TAG).

Per (book, kind, character) we count VERBAL_TAG / GESTURE_BEAT / BARE / MIXED
and compute:

    gesture_ratio = (GESTURE_BEAT + 0.5 × MIXED)
                  / (VERBAL_TAG + GESTURE_BEAT + MIXED)

==============================================================================
Cross-book gates (combined)
==============================================================================

  Gate A — per-kind gesture_ratio ordering reproduces (sign-of-effect that
           action carries the highest gesture_ratio across books) → PASS if
           3/3 books place action top.
  Gate B — BARE rate cross-book stable (≤25% relative spread).

  PASS         — both gates PASS
  PASS_PARTIAL — 2/3 reproduce on either gate
  DIVERGE      — neither gate stable

Per-character (Bruenor vs Drizzt) is reported as a secondary ranking gate
(top-2 set stability across the 5 fellowship characters, by gesture_ratio).

==============================================================================
Output
==============================================================================

  - timestamped JSON at
      novels/salvatore-icewind-dale/structure-calibration/
        crystal_shard.<TS>.gesture-vs-tag-ratio.json
  - atomic-append section to
      novels/salvatore-icewind-dale/structure-calibration/
        crystal_shard-conclusions.md
  - atomic-insert roadmap row before `\n**Sequencing` anchor in
      docs/harness-tuning-roadmap.md
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

# Add the lib dir to sys.path so the imports below resolve when this script is
# run from the repo root via `python3 scripts/structure-calibration/...`.
_LIB_DIR = Path(__file__).resolve().parent / "lib"
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from directional_gate import (  # noqa: E402
    Verdict,
    combine_gates,
    gate_density_spread,
    gate_modal_class,
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

PATTERN_NUMBER: int = 73
PATTERN_NAME: str = "Body-language-vs-verbal-attribution ratio in dialogue"
PATTERN_SLUG: str = "gesture-vs-tag-ratio"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
CORPUS_KEY = "salvatore-icewind-dale"
BUNDLE = REPO / "novels" / CORPUS_KEY
BEATS_PATH = BUNDLE / "beats.jsonl"
DIALOGUE_EXTRACT_PATH = BUNDLE / "analysis" / "dialogue-extract.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BOOK_ORDER = ["crystal_shard", "streams_of_silver", "halflings_gem"]
KIND_ORDER = ["action", "dialogue", "interiority", "description"]
FELLOWSHIP = ["Drizzt", "Bruenor", "Wulfgar", "Catti-brie", "Regis"]
ROADMAP_ANCHOR = "\n**Sequencing"

# Tag-verb families. We expand canonical attribution verbs to include common
# inflections (-ed, -s, -ing). We DO NOT include modal/auxiliaries.
TAG_VERB_LEMMAS = [
    "said", "say", "says", "saying",
    "ask", "asks", "asked", "asking",
    "reply", "replies", "replied", "replying",
    "growl", "growls", "growled", "growling",
    "whisper", "whispers", "whispered", "whispering",
    "mutter", "mutters", "muttered", "muttering",
    "cry", "cries", "cried", "crying",
    "shout", "shouts", "shouted", "shouting",
    "spat", "spit", "spits", "spitting",
    "hiss", "hisses", "hissed", "hissing",
    "murmur", "murmurs", "murmured", "murmuring",
    "bark", "barks", "barked", "barking",
    "snarl", "snarls", "snarled", "snarling",
    "add", "adds", "added", "adding",
    "continue", "continues", "continued", "continuing",
    "answer", "answers", "answered", "answering",
    "interrupt", "interrupts", "interrupted", "interrupting",
    "exclaim", "exclaims", "exclaimed", "exclaiming",
    "state", "states", "stated", "stating",
    "declare", "declares", "declared", "declaring",
    "muse", "muses", "mused", "musing",
    "sigh", "sighs", "sighed", "sighing",
    "call", "calls", "called", "calling",
    "shoot", "shoots", "shot", "shooting",  # "shot back"
    "retort", "retorts", "retorted", "retorting",
    "warn", "warns", "warned", "warning",
    "agree", "agrees", "agreed", "agreeing",
    "remark", "remarks", "remarked", "remarking",
    "scoff", "scoffs", "scoffed", "scoffing",
    "snap", "snaps", "snapped", "snapping",
    "rumble", "rumbles", "rumbled", "rumbling",
    "boom", "booms", "boomed", "booming",
    "demand", "demands", "demanded", "demanding",
    "offer", "offers", "offered", "offering",
    "insist", "insists", "insisted", "insisting",
    "echo", "echoes", "echoed", "echoing",
    "stammer", "stammers", "stammered", "stammering",
    "stutter", "stutters", "stuttered", "stuttering",
    "whine", "whines", "whined", "whining",
    "groan", "groans", "groaned", "groaning",
    "moan", "moans", "moaned", "moaning",
    "snicker", "snickers", "snickered", "snickering",
    "chuckle", "chuckles", "chuckled", "chuckling",
    "laugh", "laughs", "laughed", "laughing",
    "yell", "yells", "yelled", "yelling",
    "scream", "screams", "screamed", "screaming",
    "called",  # "called out"
]

# Gesture / body-action verbs. Expanded from P56 + P34b families.
GESTURE_VERB_LEMMAS = [
    "turn", "turns", "turned", "turning",
    "move", "moves", "moved", "moving",
    "step", "steps", "stepped", "stepping",
    "cross", "crosses", "crossed", "crossing",
    "grip", "grips", "gripped", "gripping",
    "clench", "clenches", "clenched", "clenching",
    "nod", "nods", "nodded", "nodding",
    "shake", "shakes", "shook", "shaking",
    "lean", "leans", "leaned", "leaning", "leant",
    "crouch", "crouches", "crouched", "crouching",
    "raise", "raises", "raised", "raising",
    "lower", "lowers", "lowered", "lowering",
    "narrow", "narrows", "narrowed", "narrowing",
    "tighten", "tightens", "tightened", "tightening",
    "purse", "purses", "pursed", "pursing",
    "smile", "smiles", "smiled", "smiling",
    "frown", "frowns", "frowned", "frowning",
    "scowl", "scowls", "scowled", "scowling",
    "shrug", "shrugs", "shrugged", "shrugging",
    "gesture", "gestures", "gestured", "gesturing",
    "point", "points", "pointed", "pointing",
    "brush", "brushes", "brushed", "brushing",
    "wave", "waves", "waved", "waving",
    "tilt", "tilts", "tilted", "tilting",
    "cock", "cocks", "cocked", "cocking",
    "draw", "draws", "drew", "drawing", "drawn",
    "sheathe", "sheathes", "sheathed", "sheathing",
    "sit", "sits", "sat", "sitting",
    "stand", "stands", "stood", "standing",
    "pace", "paces", "paced", "pacing",
    "walk", "walks", "walked", "walking",
    "stride", "strides", "strode", "striding", "stridden",
    "stomp", "stomps", "stomped", "stomping",
    "stamp", "stamps", "stamped", "stamping",
    "rise", "rises", "rose", "rising", "risen",
    "stiffen", "stiffens", "stiffened", "stiffening",
    "flinch", "flinches", "flinched", "flinching",
    "wince", "winces", "winced", "wincing",
    "bow", "bows", "bowed", "bowing",
    "kneel", "kneels", "knelt", "kneeled", "kneeling",
    "swing", "swings", "swung", "swinging",
    "slap", "slaps", "slapped", "slapping",
    "clap", "claps", "clapped", "clapping",
    "wipe", "wipes", "wiped", "wiping",
    "rub", "rubs", "rubbed", "rubbing",
    "scratch", "scratches", "scratched", "scratching",
    "tap", "taps", "tapped", "tapping",
    "drop", "drops", "dropped", "dropping",
    "lift", "lifts", "lifted", "lifting",
    "hold", "holds", "held", "holding",
    "put", "puts", "putting",
    "place", "places", "placed", "placing",
    "set", "sets", "setting",
    "stare", "stares", "stared", "staring",
    "glance", "glances", "glanced", "glancing",
    "look", "looks", "looked", "looking",
    "glare", "glares", "glared", "glaring",
    "peer", "peers", "peered", "peering",
    "watch", "watches", "watched", "watching",
    "regard", "regards", "regarded", "regarding",
    "blink", "blinks", "blinked", "blinking",
    "gaze", "gazes", "gazed", "gazing",
    "spin", "spins", "spun", "spinning",
    "twist", "twists", "twisted", "twisting",
    "approach", "approaches", "approached", "approaching",
    "back", "backs", "backed", "backing",
    "retreat", "retreats", "retreated", "retreating",
    "advance", "advances", "advanced", "advancing",
    "halt", "halts", "halted", "halting",
    "stop", "stops", "stopped", "stopping",
    "freeze", "freezes", "froze", "freezing", "frozen",
    "duck", "ducks", "ducked", "ducking",
    "dodge", "dodges", "dodged", "dodging",
    "lunge", "lunges", "lunged", "lunging",
    "rush", "rushes", "rushed", "rushing",
    "hurry", "hurries", "hurried", "hurrying",
    "dart", "darts", "darted", "darting",
    "slip", "slips", "slipped", "slipping",
    "slide", "slides", "slid", "sliding", "slidden",
    "settle", "settles", "settled", "settling",
    "lay", "lays", "laid", "laying",
    "lie", "lies", "lay", "lying", "lain",
    "fold", "folds", "folded", "folding",
    "unfold", "unfolds", "unfolded", "unfolding",
    "open", "opens", "opened", "opening",
    "close", "closes", "closed", "closing",
    "shut", "shuts", "shutting",
    "shove", "shoves", "shoved", "shoving",
    "push", "pushes", "pushed", "pushing",
    "pull", "pulls", "pulled", "pulling",
    "yank", "yanks", "yanked", "yanking",
    "tug", "tugs", "tugged", "tugging",
    "kick", "kicks", "kicked", "kicking",
    "punch", "punches", "punched", "punching",
    "strike", "strikes", "struck", "striking", "stricken",
    "hit", "hits", "hitting",
    "wield", "wields", "wielded", "wielding",
    "hoist", "hoists", "hoisted", "hoisting",
    "heft", "hefts", "hefted", "hefting",
    "extend", "extends", "extended", "extending",
    "reach", "reaches", "reached", "reaching",
    "bend", "bends", "bent", "bending",
    "fix", "fixes", "fixed", "fixing",
    "fall", "falls", "fell", "falling", "fallen",
]

TAG_SET = set(TAG_VERB_LEMMAS)
GESTURE_SET = set(GESTURE_VERB_LEMMAS)

# Window sizes (words from the quote boundary)
TAG_WINDOW = 5
GESTURE_WINDOW = 10

# Quote regex — matches a quoted span with paired smart-quotes or straight
# quotes. We deliberately avoid matching apostrophes inside contractions by
# requiring at least one space inside the quoted span (or any character that
# isn't a single letter+apostrophe boundary).
#
# Salvatore's prose uses straight ASCII quotes throughout. Single-quote
# dialogue is rare; we focus on double-quote (straight) which covers ~all
# attributed quotes per dialogue-extract.jsonl.
QUOTE_PATTERN = re.compile(r'"([^"\n]+?)"', re.DOTALL)

# Word-tokenize a context window to count words. We use a simple regex —
# tokenization quality only needs to be sufficient to count words (for the
# 5-word / 10-word adjacency check); we don't need POS or lemmatization.
WORD_PATTERN = re.compile(r"\b[\w'\-]+\b")


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_beats() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with BEATS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def load_dialogue_extract() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with DIALOGUE_EXTRACT_PATH.open() as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


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
# Per-line attribution-context classifier
# ---------------------------------------------------------------------------


def _tokens_in_window(text: str) -> list[str]:
    """Return lower-case word tokens found in `text` (a context window)."""
    return [m.group(0).lower() for m in WORD_PATTERN.finditer(text)]


def _has_verb_within(
    text_before: str,
    text_after: str,
    verb_set: set[str],
    window_words: int,
) -> bool:
    """Return True if any token in either window matches `verb_set`.

    We tokenize words from each side, take the LAST `window_words` tokens
    from `text_before` (closest to the quote) and the FIRST `window_words`
    tokens from `text_after`, and look up each in `verb_set`.
    """
    pre = _tokens_in_window(text_before)[-window_words:]
    post = _tokens_in_window(text_after)[:window_words]
    return any(t in verb_set for t in pre) or any(t in verb_set for t in post)


def classify_line(
    text_before: str,
    text_after: str,
) -> str:
    """Classify a single quoted line's attribution context.

    Returns one of: VERBAL_TAG | GESTURE_BEAT | BARE | MIXED.

    Order of operations:
      1. tag_present  = any tag verb within ±TAG_WINDOW words
      2. gest_present = any gesture verb within ±GESTURE_WINDOW words

      - tag and gesture both present       → MIXED
      - tag only                            → VERBAL_TAG
      - gesture only (and no tag)           → GESTURE_BEAT
      - neither                             → BARE
    """
    tag_present = _has_verb_within(
        text_before, text_after, TAG_SET, TAG_WINDOW,
    )
    gest_present = _has_verb_within(
        text_before, text_after, GESTURE_SET, GESTURE_WINDOW,
    )
    if tag_present and gest_present:
        return "MIXED"
    if tag_present:
        return "VERBAL_TAG"
    if gest_present:
        return "GESTURE_BEAT"
    return "BARE"


# ---------------------------------------------------------------------------
# Scan a beat for quoted lines and their classifications
# ---------------------------------------------------------------------------


def classify_beat_lines(beat_text: str) -> list[dict[str, Any]]:
    """Find every quoted span in a beat and classify each.

    Returns a list of dicts: {label, span_start, span_end, quote_text}.
    """
    out: list[dict[str, Any]] = []
    matches = list(QUOTE_PATTERN.finditer(beat_text))
    for m in matches:
        # Skip "quotes" that are actually nested-apostrophe contractions or
        # other false positives (heuristic: a quote with no spaces and only
        # 1-3 chars is almost certainly not dialogue).
        body = m.group(1).strip()
        if len(body) < 2:
            continue
        # Note: we DO accept very short quotes like "Bah!" / "Aye!" — these
        # are real Salvatore dialogue.

        text_before = beat_text[: m.start()]
        text_after = beat_text[m.end():]

        label = classify_line(text_before, text_after)

        out.append({
            "label": label,
            "span_start": m.start(),
            "span_end": m.end(),
            "quote_text": body,
        })
    return out


# ---------------------------------------------------------------------------
# Per-character speaker mapping (uses dialogue-extract.jsonl ground truth)
# ---------------------------------------------------------------------------


def build_quote_speaker_index(
    dialogue_extract: list[dict[str, Any]],
) -> dict[str, list[tuple[str, str]]]:
    """Build a map from beat_id → list of (quote_text, speaker).

    Quote text comparison uses normalized whitespace so we match the regex
    span content (which has interior whitespace collapsed differently from
    the LLM-attributed quote).
    """
    out: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for q in dialogue_extract:
        bid = q.get("beat_id")
        if not bid:
            continue
        out[bid].append((normalize_quote(q["quote"]), q["char"]))
    return out


def normalize_quote(s: str) -> str:
    """Lower-case + whitespace-collapse for fuzzy matching across line breaks."""
    return re.sub(r"\s+", " ", s.strip().lower())


def attribute_speaker(
    quote_text: str,
    speaker_index: list[tuple[str, str]],
) -> str | None:
    """Return the most likely speaker for `quote_text` from the index, or None.

    Strategy:
      1. exact normalized match
      2. substring match (the regex-extracted quote is a fragment of the
         LLM-attributed quote, or vice versa) — this handles the case where
         the LLM extracted a multi-sentence quote and our regex split it,
         or where smart-quote / linebreak handling differs.

    Returns the speaker name (one of the 5 fellowship + maybe others) or
    None if no match.
    """
    norm = normalize_quote(quote_text)
    if not norm:
        return None
    # 1. exact
    for q_norm, ch in speaker_index:
        if q_norm == norm:
            return ch
    # 2. substring (either direction)
    for q_norm, ch in speaker_index:
        if not q_norm:
            continue
        if norm in q_norm or q_norm in norm:
            return ch
    return None


# ---------------------------------------------------------------------------
# Pattern logic
# ---------------------------------------------------------------------------


def analyze(
    beats: list[dict[str, Any]],
    dialogue_extract: list[dict[str, Any]],
) -> dict[str, Any]:
    # Build beat_id → speaker index for per-character attribution
    speaker_index_by_beat = build_quote_speaker_index(dialogue_extract)

    # Per-(book, kind) line classification counts
    # counts[book][kind] = {"VERBAL_TAG": n, "GESTURE_BEAT": n, "BARE": n, "MIXED": n}
    counts: dict[str, dict[str, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(int))
    )
    # Per-(book, character) classification counts (from any beat kind)
    counts_char: dict[str, dict[str, dict[str, int]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(int))
    )
    # Aggregate per-book classification counts (across kinds)
    counts_book: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )

    # Total quoted lines per book — used as the BARE-rate denominator
    n_lines_per_book: dict[str, int] = defaultdict(int)

    # Attribution-coverage diagnostics
    n_quotes_total = 0
    n_quotes_attributed = 0

    for b in beats:
        beat_text = b.get("text", "")
        if not beat_text:
            continue
        kind = b.get("kind", "")
        book = b.get("book", "")
        scene_id = b.get("scene_id", "")
        beat_idx = b.get("beat_idx", -1)
        beat_id = f"{scene_id}_b{beat_idx}"

        line_records = classify_beat_lines(beat_text)
        if not line_records:
            continue

        speaker_idx = speaker_index_by_beat.get(beat_id, [])

        for rec in line_records:
            label = rec["label"]
            counts[book][kind][label] += 1
            counts_book[book][label] += 1
            n_lines_per_book[book] += 1
            n_quotes_total += 1

            speaker = attribute_speaker(rec["quote_text"], speaker_idx)
            if speaker:
                n_quotes_attributed += 1
                counts_char[book][speaker][label] += 1

    # Compute per-book per-kind ratios
    per_book_kind_ratios: dict[str, dict[str, dict[str, Any]]] = {}
    for book in BOOK_ORDER:
        per_book_kind_ratios[book] = {}
        for kind in KIND_ORDER:
            c = counts[book][kind]
            verbal = c.get("VERBAL_TAG", 0)
            gesture = c.get("GESTURE_BEAT", 0)
            mixed = c.get("MIXED", 0)
            bare = c.get("BARE", 0)
            attributed_total = verbal + gesture + mixed
            denom_all = verbal + gesture + mixed + bare
            gesture_ratio = (
                round((gesture + 0.5 * mixed) / attributed_total, 4)
                if attributed_total > 0 else None
            )
            bare_rate = (
                round(bare / denom_all, 4) if denom_all > 0 else None
            )
            per_book_kind_ratios[book][kind] = {
                "verbal_tag": verbal,
                "gesture_beat": gesture,
                "mixed": mixed,
                "bare": bare,
                "n_lines": denom_all,
                "gesture_ratio": gesture_ratio,
                "bare_rate": bare_rate,
            }

    # Per-book aggregate (across kinds)
    per_book_aggregate: dict[str, dict[str, Any]] = {}
    for book in BOOK_ORDER:
        c = counts_book[book]
        verbal = c.get("VERBAL_TAG", 0)
        gesture = c.get("GESTURE_BEAT", 0)
        mixed = c.get("MIXED", 0)
        bare = c.get("BARE", 0)
        attributed_total = verbal + gesture + mixed
        denom_all = verbal + gesture + mixed + bare
        gesture_ratio = (
            round((gesture + 0.5 * mixed) / attributed_total, 4)
            if attributed_total > 0 else None
        )
        bare_rate = round(bare / denom_all, 4) if denom_all > 0 else None
        per_book_aggregate[book] = {
            "verbal_tag": verbal,
            "gesture_beat": gesture,
            "mixed": mixed,
            "bare": bare,
            "n_lines": denom_all,
            "gesture_ratio": gesture_ratio,
            "bare_rate": bare_rate,
        }

    # Per-character ratios per book + pooled across books
    per_book_char_ratios: dict[str, dict[str, dict[str, Any]]] = {}
    for book in BOOK_ORDER:
        per_book_char_ratios[book] = {}
        for ch in FELLOWSHIP:
            c = counts_char[book].get(ch, {})
            verbal = c.get("VERBAL_TAG", 0)
            gesture = c.get("GESTURE_BEAT", 0)
            mixed = c.get("MIXED", 0)
            bare = c.get("BARE", 0)
            attributed_total = verbal + gesture + mixed
            denom_all = verbal + gesture + mixed + bare
            gesture_ratio = (
                round((gesture + 0.5 * mixed) / attributed_total, 4)
                if attributed_total > 0 else None
            )
            bare_rate = (
                round(bare / denom_all, 4) if denom_all > 0 else None
            )
            per_book_char_ratios[book][ch] = {
                "verbal_tag": verbal,
                "gesture_beat": gesture,
                "mixed": mixed,
                "bare": bare,
                "n_lines": denom_all,
                "gesture_ratio": gesture_ratio,
                "bare_rate": bare_rate,
            }

    pooled_char_ratios: dict[str, dict[str, Any]] = {}
    for ch in FELLOWSHIP:
        verbal = sum(counts_char[bk].get(ch, {}).get("VERBAL_TAG", 0) for bk in BOOK_ORDER)
        gesture = sum(counts_char[bk].get(ch, {}).get("GESTURE_BEAT", 0) for bk in BOOK_ORDER)
        mixed = sum(counts_char[bk].get(ch, {}).get("MIXED", 0) for bk in BOOK_ORDER)
        bare = sum(counts_char[bk].get(ch, {}).get("BARE", 0) for bk in BOOK_ORDER)
        attributed_total = verbal + gesture + mixed
        denom_all = verbal + gesture + mixed + bare
        gesture_ratio = (
            round((gesture + 0.5 * mixed) / attributed_total, 4)
            if attributed_total > 0 else None
        )
        bare_rate = round(bare / denom_all, 4) if denom_all > 0 else None
        pooled_char_ratios[ch] = {
            "verbal_tag": verbal,
            "gesture_beat": gesture,
            "mixed": mixed,
            "bare": bare,
            "n_lines": denom_all,
            "gesture_ratio": gesture_ratio,
            "bare_rate": bare_rate,
        }

    # ---------------------------------------------------------------
    # Gate A — per-kind gesture_ratio ordering: action top in 3/3 books?
    # We model this as a modal_class gate: per book, what is the "top kind
    # by gesture_ratio"? PASS if all books say `action`.
    # ---------------------------------------------------------------
    per_book_top_kind: dict[str, str] = {}
    per_book_kind_ranking: dict[str, list[str]] = {}
    for book in BOOK_ORDER:
        ranked = sorted(
            [
                (kind, per_book_kind_ratios[book][kind].get("gesture_ratio"))
                for kind in KIND_ORDER
                if per_book_kind_ratios[book][kind].get("gesture_ratio") is not None
            ],
            key=lambda t: t[1],
            reverse=True,
        )
        if ranked:
            per_book_top_kind[book] = ranked[0][0]
            per_book_kind_ranking[book] = [t[0] for t in ranked]

    gate_a_verdict: Verdict = gate_modal_class(per_book_top_kind)

    # ---------------------------------------------------------------
    # Gate B — BARE rate cross-book stability (≤25% relative spread)
    # ---------------------------------------------------------------
    per_book_bare_rates = {
        bk: per_book_aggregate[bk]["bare_rate"]
        for bk in BOOK_ORDER
        if per_book_aggregate[bk]["bare_rate"] is not None
    }
    gate_b_verdict: Verdict = gate_density_spread(
        per_book_bare_rates, threshold_pct=25.0
    )

    # ---------------------------------------------------------------
    # Gate C — per-character top-2 by gesture_ratio (cross-book stability)
    # ---------------------------------------------------------------
    per_book_char_top2: dict[str, set] = {}
    for book in BOOK_ORDER:
        ranked = sorted(
            [
                (ch, per_book_char_ratios[book][ch].get("gesture_ratio"))
                for ch in FELLOWSHIP
                if per_book_char_ratios[book][ch].get("gesture_ratio") is not None
                and per_book_char_ratios[book][ch].get("n_lines", 0) >= 20
                # min-sample threshold so we don't rank a 3-line character
            ],
            key=lambda t: t[1],
            reverse=True,
        )
        if ranked:
            per_book_char_top2[book] = set(t[0] for t in ranked[:2])

    char_overlap_size, gate_c_verdict = gate_top_k_overlap(
        per_book_char_top2, top_n=2, min_shared_pairs=2,
    )

    # ---------------------------------------------------------------
    # Combined verdict (Gate A + Gate B are the binding gates per the
    # ticket; Gate C is reported separately as character signal).
    # ---------------------------------------------------------------
    overall_verdict: Verdict = combine_gates([gate_a_verdict, gate_b_verdict])

    # ---------------------------------------------------------------
    # Finding-shorts
    # ---------------------------------------------------------------
    fs_kind = " ".join(
        f"{bk}={per_book_top_kind.get(bk, 'n/a')}({per_book_kind_ratios[bk].get(per_book_top_kind.get(bk,''),{}).get('gesture_ratio','?')})"
        for bk in BOOK_ORDER
    )
    fs_bare = ", ".join(
        f"{bk}={per_book_aggregate[bk]['bare_rate']}"
        for bk in BOOK_ORDER
    )
    findings_short = (
        f"per-book top-kind by gesture_ratio: {fs_kind}; "
        f"BARE rates: {fs_bare}; "
        f"per-char top-2 stable across books: {char_overlap_size}/2 (Gate C={gate_c_verdict})"
    )

    # ---------------------------------------------------------------
    # Diagnostics
    # ---------------------------------------------------------------
    attribution_coverage = (
        round(n_quotes_attributed / n_quotes_total, 4) if n_quotes_total else 0.0
    )

    return {
        "per_book_kind_ratios": per_book_kind_ratios,
        "per_book_aggregate": per_book_aggregate,
        "per_book_char_ratios": per_book_char_ratios,
        "pooled_char_ratios": pooled_char_ratios,
        "per_book_top_kind_by_gesture_ratio": per_book_top_kind,
        "per_book_kind_ranking_by_gesture_ratio": per_book_kind_ranking,
        "per_book_bare_rates": per_book_bare_rates,
        "per_book_char_top2_by_gesture_ratio": {
            bk: sorted(list(s)) for bk, s in per_book_char_top2.items()
        },
        "gate_a_per_kind_top": gate_a_verdict,
        "gate_b_bare_rate_spread": gate_b_verdict,
        "gate_c_char_top2_overlap_verdict": gate_c_verdict,
        "gate_c_char_top2_overlap_size": char_overlap_size,
        "verdict": overall_verdict,
        "gates_used": [
            "modal_class[per-kind top by gesture_ratio]",
            "density_spread[BARE rate ≤25%]",
            "top_k_overlap[per-character top-2]",
        ],
        "n_quotes_total": n_quotes_total,
        "n_quotes_attributed_to_speaker": n_quotes_attributed,
        "speaker_attribution_coverage": attribution_coverage,
        "n_quote_lines_per_book": dict(n_lines_per_book),
        "findings_short": findings_short,
    }


# ---------------------------------------------------------------------------
# Markdown section renderer
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
        "Hypothesis: dialogue exchanges break with either a verbal-tag "
        "(`said`/`growled`/`whispered`) or a gesture-beat (`turned his head`, "
        "`crossed his arms`). The ratio is a writer-prompt rhythm lever "
        "orthogonal to P48 (tag-creativity, what verbs are used) and P56 "
        "(body-part lexicon, what parts are referenced)."
    )
    lines.append("")
    lines.append("### Methodology (pure compute)")
    lines.append("")
    lines.append(
        f"For each beat with at least one quoted line, we run a regex over "
        f'`"..."` spans and inspect the ±{TAG_WINDOW} word window around each '
        f"quote for tag verbs ({len(TAG_VERB_LEMMAS)} canonical lemmas + "
        f"inflections), and the ±{GESTURE_WINDOW} word window for gesture "
        f"verbs ({len(GESTURE_VERB_LEMMAS)} body-action lemmas + inflections). "
        f"Each line is classified as VERBAL_TAG / GESTURE_BEAT / BARE / MIXED. "
        f"The gesture_ratio = (GESTURE_BEAT + 0.5 × MIXED) / (VERBAL_TAG + "
        f"GESTURE_BEAT + MIXED). The BARE rate = BARE / total quoted lines. "
        f"Per-character speaker attribution is taken from "
        f"`analysis/dialogue-extract.jsonl` (LLM-attributed, normalized "
        f"substring match)."
    )
    lines.append("")

    # Quotes processed
    lines.append("### Quote-line totals + attribution coverage")
    lines.append("")
    lines.append(
        f"- Total quoted lines processed: **{result['n_quotes_total']}**"
    )
    lines.append(
        f"- Speaker-attributed (matched against dialogue-extract.jsonl): "
        f"**{result['n_quotes_attributed_to_speaker']}** "
        f"({result['speaker_attribution_coverage']*100:.1f}% coverage)"
    )
    lines.append("- Quote-lines per book:")
    for bk in BOOK_ORDER:
        lines.append(
            f"  - **{bk}**: {result['n_quote_lines_per_book'].get(bk, 0)}"
        )
    lines.append("")

    # Per-book aggregate counts table
    lines.append("### Per-book aggregate counts + ratios (across all kinds)")
    lines.append("")
    lines.append(
        "| Book | VERBAL_TAG | GESTURE_BEAT | MIXED | BARE | total | "
        "gesture_ratio | BARE rate |"
    )
    lines.append(
        "|------|-----------:|-------------:|------:|-----:|------:|--------------:|----------:|"
    )
    for bk in BOOK_ORDER:
        a = result["per_book_aggregate"][bk]
        lines.append(
            f"| {bk} | {a['verbal_tag']} | {a['gesture_beat']} | {a['mixed']} | "
            f"{a['bare']} | {a['n_lines']} | {a['gesture_ratio']} | {a['bare_rate']} |"
        )
    lines.append("")

    # Per-book per-kind gesture_ratio
    lines.append("### Per-book per-kind gesture_ratio")
    lines.append("")
    lines.append(
        "| Book | action | dialogue | interiority | description | top kind |"
    )
    lines.append(
        "|------|-------:|---------:|------------:|------------:|---------|"
    )
    for bk in BOOK_ORDER:
        kr = result["per_book_kind_ratios"][bk]
        top = result["per_book_top_kind_by_gesture_ratio"].get(bk, "n/a")
        lines.append(
            f"| {bk} | {kr['action']['gesture_ratio']} | {kr['dialogue']['gesture_ratio']} "
            f"| {kr['interiority']['gesture_ratio']} | {kr['description']['gesture_ratio']} "
            f"| **{top}** |"
        )
    lines.append("")

    # Per-book per-kind BARE rate
    lines.append("### Per-book per-kind BARE rate (rapid back-and-forth signal)")
    lines.append("")
    lines.append(
        "| Book | action | dialogue | interiority | description |"
    )
    lines.append(
        "|------|-------:|---------:|------------:|------------:|"
    )
    for bk in BOOK_ORDER:
        kr = result["per_book_kind_ratios"][bk]
        lines.append(
            f"| {bk} | {kr['action']['bare_rate']} | {kr['dialogue']['bare_rate']} "
            f"| {kr['interiority']['bare_rate']} | {kr['description']['bare_rate']} |"
        )
    lines.append("")

    # Per-character pooled gesture_ratio
    lines.append("### Per-character gesture_ratio (pooled across 3 books)")
    lines.append("")
    lines.append(
        "| Character | n_lines | VERBAL_TAG | GESTURE_BEAT | MIXED | BARE | "
        "gesture_ratio | BARE rate |"
    )
    lines.append(
        "|-----------|--------:|-----------:|-------------:|------:|-----:|--------------:|----------:|"
    )
    char_ranked = sorted(
        FELLOWSHIP,
        key=lambda c: (result["pooled_char_ratios"][c]["gesture_ratio"] or 0.0),
        reverse=True,
    )
    for ch in char_ranked:
        p = result["pooled_char_ratios"][ch]
        lines.append(
            f"| {ch} | {p['n_lines']} | {p['verbal_tag']} | {p['gesture_beat']} | "
            f"{p['mixed']} | {p['bare']} | {p['gesture_ratio']} | {p['bare_rate']} |"
        )
    lines.append("")

    # Per-character per-book ratios
    lines.append("### Per-character gesture_ratio (per book)")
    lines.append("")
    lines.append(
        "| Character | crystal_shard | streams_of_silver | halflings_gem | "
        "top-2 stable across books? |"
    )
    lines.append(
        "|-----------|--------------:|------------------:|--------------:|---------------------------|"
    )
    top2_per_book = result["per_book_char_top2_by_gesture_ratio"]
    for ch in FELLOWSHIP:
        rs = []
        in_top2 = []
        for bk in BOOK_ORDER:
            r = result["per_book_char_ratios"][bk][ch].get("gesture_ratio")
            n = result["per_book_char_ratios"][bk][ch].get("n_lines", 0)
            rs.append(f"{r} (n={n})")
            if ch in top2_per_book.get(bk, []):
                in_top2.append(bk)
        lines.append(
            f"| {ch} | {rs[0]} | {rs[1]} | {rs[2]} | "
            f"{len(in_top2)}/3 books in top-2 |"
        )
    lines.append("")

    # Gates
    lines.append("### Gate verdicts")
    lines.append("")
    lines.append(
        f"- **Gate A** (per-kind top by gesture_ratio, modal-class agreement): "
        f"`{result['gate_a_per_kind_top']}` "
        f"— per-book top kind: " + ", ".join(
            f"{bk}={result['per_book_top_kind_by_gesture_ratio'].get(bk, 'n/a')}"
            for bk in BOOK_ORDER
        )
    )
    lines.append(
        f"- **Gate B** (BARE rate cross-book spread ≤25%): "
        f"`{result['gate_b_bare_rate_spread']}` — per-book BARE rates: "
        + ", ".join(
            f"{bk}={result['per_book_aggregate'][bk]['bare_rate']}"
            for bk in BOOK_ORDER
        )
    )
    lines.append(
        f"- **Gate C** (per-character top-2 by gesture_ratio overlap, ≥20-line floor): "
        f"`{result['gate_c_char_top2_overlap_verdict']}` "
        f"(intersection size = {result['gate_c_char_top2_overlap_size']}/2)"
    )
    lines.append("")

    # Conclusion
    verdict = result["verdict"]
    lines.append(f"### Conclusion + Action — Pattern {PATTERN_NUMBER}: **{verdict}**")
    lines.append("")
    if verdict == "PASS":
        action = (
            "Ship the per-kind gesture-ratio prior into the writer-prompt: when "
            "drafting an action-kind beat with embedded dialogue, prefer "
            "GESTURE_BEAT attribution; when drafting interiority/description with "
            "dialogue, prefer VERBAL_TAG. Per-character priors (top-2 gesture-"
            "heavy speakers) ship as fewshot scaffolding."
        )
    elif verdict == "PASS_PARTIAL":
        action = (
            "Ship the stable axis (whichever gate PASSed) as a soft writer-"
            "prompt prior; defer the unstable axis. The kind-level gesture-"
            "ratio ordering remains directional; the BARE-rate cross-book "
            "spread is a per-book stylistic dial rather than a corpus prior."
        )
    elif verdict == "DIVERGE":
        action = (
            "HOLD — gesture-vs-tag rhythm does not reproduce as a corpus-wide "
            "prior. Revisit with finer-grained quote attribution (e.g., per-"
            "scene tracking that preserves multi-line dialogue continuity)."
        )
    else:
        action = "KILL — no gesture-vs-tag signal."
    lines.append(action)
    lines.append("")
    lines.append(result["findings_short"])
    lines.append("")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Roadmap row renderer
# ---------------------------------------------------------------------------


def render_roadmap_row(result: dict[str, Any], commit: str) -> str:
    verdict = result["verdict"]
    if verdict == "PASS":
        ship = (
            "ship per-kind gesture-ratio prior + per-character top-2 fewshot "
            "block into writer-prompt under WRITER_GENRE_PACKS fantasy-Salvatore"
        )
    elif verdict == "PASS_PARTIAL":
        ship = (
            "ship the stable axis (whichever gate PASSed) as soft writer-prompt "
            "prior; defer the unstable axis to per-book voice tier"
        )
    elif verdict == "DIVERGE":
        ship = "HOLD — gesture-vs-tag rhythm does not reproduce across books"
    elif verdict == "KILL":
        ship = "KILL — no signal"
    else:
        ship = f"INCOMPLETE — {verdict}"

    findings = result["findings_short"]

    lever = (
        "writer-prompt dialogue-attribution rhythm prior (per-kind gesture_ratio "
        "preference: action-kind → GESTURE_BEAT-leaning attribution; interiority "
        "/ description with dialogue → VERBAL_TAG-leaning); BARE-rate corpus floor "
        "for rapid-back-and-forth dialogue cadence; per-character top-2 gesture-"
        "heavy speakers ship as fewshot scaffolding under WRITER_GENRE_PACKS "
        "fantasy-Salvatore. Composes with P48 (said-ratio archetypes), P56 (body-"
        "part lexicon), P65 (per-character voice signature)."
    )

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
        f"[pattern-{PATTERN_NUMBER}] starting; "
        f"slug={PATTERN_SLUG}; commit={commit}",
        file=sys.stderr,
    )

    beats = load_beats()
    print(
        f"[pattern-{PATTERN_NUMBER}] loaded {len(beats)} beats", file=sys.stderr
    )
    dialogue_extract = load_dialogue_extract()
    print(
        f"[pattern-{PATTERN_NUMBER}] loaded {len(dialogue_extract)} dialogue-"
        f"extract rows",
        file=sys.stderr,
    )

    result = analyze(beats, dialogue_extract)

    payload: dict[str, Any] = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": PATTERN_NAME,
        "slug": PATTERN_SLUG,
        "commit": commit,
        "timestamp_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        "dialogue_extract_path": str(DIALOGUE_EXTRACT_PATH.relative_to(REPO)),
        "windows": {
            "tag_window_words": TAG_WINDOW,
            "gesture_window_words": GESTURE_WINDOW,
        },
        "lexicons": {
            "tag_verb_lemmas_count": len(TAG_VERB_LEMMAS),
            "gesture_verb_lemmas_count": len(GESTURE_VERB_LEMMAS),
            "tag_verb_lemmas_sample": sorted(TAG_VERB_LEMMAS)[:30],
            "gesture_verb_lemmas_sample": sorted(GESTURE_VERB_LEMMAS)[:30],
        },
        **result,
    }

    json_path = write_timestamped_json(OUT_DIR, PATTERN_SLUG, payload)
    print(f"[pattern-{PATTERN_NUMBER}] JSON -> {json_path}", file=sys.stderr)

    section_md = render_conclusions_md(result, json_path, commit)
    atomic_append_section(CONCLUSIONS_PATH, section_md)
    print(
        f"[pattern-{PATTERN_NUMBER}] appended -> {CONCLUSIONS_PATH}",
        file=sys.stderr,
    )

    row_md = render_roadmap_row(result, commit)
    atomic_insert_row_before_anchor(ROADMAP_PATH, row_md, ROADMAP_ANCHOR)
    print(
        f"[pattern-{PATTERN_NUMBER}] inserted row -> {ROADMAP_PATH}",
        file=sys.stderr,
    )

    print(f"\n=== Pattern {PATTERN_NUMBER} — {PATTERN_NAME} ===")
    print(f"verdict: {result['verdict']}")
    print(f"gates: {result['gates_used']}")
    print(
        f"  gate A (per-kind top, modal): {result['gate_a_per_kind_top']} -- "
        + ", ".join(
            f"{bk}={result['per_book_top_kind_by_gesture_ratio'].get(bk, 'n/a')}"
            for bk in BOOK_ORDER
        )
    )
    print(
        f"  gate B (BARE rate spread ≤25%): {result['gate_b_bare_rate_spread']} -- "
        + ", ".join(
            f"{bk}={result['per_book_aggregate'][bk]['bare_rate']}"
            for bk in BOOK_ORDER
        )
    )
    print(
        f"  gate C (char top-2 overlap): {result['gate_c_char_top2_overlap_verdict']} "
        f"(size={result['gate_c_char_top2_overlap_size']}/2)"
    )
    print(f"\nfindings: {result['findings_short']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
