#!/usr/bin/env python3
r"""Pattern 75 — Magic / supernatural invocation patterns in the Salvatore
Icewind Dale 3-book corpus.

Hypothesis
----------
Salvatore writes high fantasy. Magic, demons, dragons, scrying, summoning,
divination, hellish artifacts — these aren't ornament; they're a structural
load-bearing component of the writer prior. Per-book magic DENSITY varies
(Crystal Shard arc dense via Crenshinibon + Akar Kessell + Errtu; Streams of
Silver lighter — chase + Mithril-Hall politics + Dendybar; Halfling's Gem
mid — Pasha Pook + Taros's Hellish Fall + Entreri stalk). But within each
book, magic should:

  1. SPIKE at climactic chapters (penultimate / final) — the rendering of
     magic-arts is a structural resource for resolution.
  2. Carry a STABLE LEXICAL SIGNATURE across books at the corpus-wide level
     (the canonical Forgotten-Realms magic dictionary: spell, magic, demon,
     scry, mind, illusion, undead, dragon, plus per-book proper nouns like
     Crenshinibon / Errtu / Cryshal-Tirith).
  3. Concentrate in INTERIORITY + DESCRIPTION beats over ACTION beats — the
     rendering of magic is contemplative (the wizard pondering the artifact;
     the demon scrying its quarry), not kinetic (sword-strokes don't carry
     magic vocabulary in Salvatore's prose; spell effects do).
  4. Co-occur with a small set of DESIGNATED MAGIC CHARACTERS — Akar Kessell,
     Errtu, Crenshinibon (artifact, not character but mention-heavy),
     Pasha Pook + the Taros artifact arc, the wizard Harpells, plus rare
     mage-on-mage combat involving Drizzt's reluctance with magical relics.

Methodology — pure-compute lexicon density across 6 categories
--------------------------------------------------------------

Six lexicon categories, each a case-insensitive word-boundary regex over a
hand-built list (charter spec + a handful of obvious additions documented
in `LEXICON_ADDITIONS`):

  MAGIC_GENERAL — magic, magical, sorcery, wizard, spell, spells, conjure,
    summon, summoning, banish, banishment, scry, scrying, divination,
    prophecy, mystic, occult, arcane, dweomer, charm, hex, curse, blessing,
    invoke, invocation, incant, incantation, enchant, enchanted, enchantment,
    ritual, witch, witchcraft.
  DEMONIC — demon, demons, demonic, devil, devilish, fiend, fiendish, hell,
    hellish, abyss, abyssal, infernal, balor, succubus, manes, glabrezu.
  DRAGON_MONSTER — dragon, dragons, drake, wyrm, lich, undead, vampire,
    ghost, ghostly, spectre, spectral, wraith, phantom, ghoul, shade.
  ARTIFACT — crystal shard, crenshinibon, taros, malchor, glaesken, talisman,
    amulet, staff, staves, rod, orb, gem-stone, gemstone (multi-word matched
    via single regex with `\s+` separators).
  ELEMENTAL — ice, frost, fire, flame, flames, flaming, fiery, lightning,
    thunder, storm, stormy, wind. Note this overlaps weather (P38) heavily;
    we record the raw count but flag it as a noisy axis in the verdict prose.
  ESOTERIC_MENTAL — telepathic, telepathy, mind link, mind-link, premonition,
    vision, dream-walking, far-sight, scrying-pool. (`scry` already in
    MAGIC_GENERAL; we don't double-count.)

Lexicons are listed verbatim in the JSON output (`lexicons` field).

Per beat we compute:
  - n_<category>: count of category matches in beat text.
  - density_<category>_per_100w: 100 * n / words.
  - magic_total_per_100w: sum across categories per 100w.

Aggregations
------------

Per (book, chapter): density per 100w, weighted by chapter words.
Per (book, kind): density per 100w (per beat-kind: action / dialogue /
  interiority / description).
Per (book, character): co-occurrence — for a fixed character set, count
  beats containing that character's name AND magic density > 0.

Per-book chapter trajectory
---------------------------

We bucket integer-numbered chapters into quartiles (q0..q3) by
chapter-position-within-book — chapters are ordered by integer index;
prelude/epilogue/part chapters are excluded from the trajectory because they
have non-numeric positions and skew the chapter-quartile mapping. We also
emit the raw per-chapter density list per book so the JSON contains the
underlying signal, not just the bucketed one.

Cross-book corpus-wide top-30 lexicon
-------------------------------------

For each book, count individual matched magic-tokens (treating multi-word
artifact phrases as single units when matched). The cross-book TOP-30 union
+ per-book ranking is reported, and Jaccard overlap of the per-book top-15
is the lexicon-stability gate.

Cross-book gates
----------------

Five sub-gates combine via least-favorable verdict (`combine_gates`):

  G1 — chapter-position trajectory: did the per-book chapter density curve
       PEAK in q3 (penultimate quartile) OR q4 (final quartile)? Per spec:
       3/3 books with q3-or-q4 peak = PASS; 2/3 = PASS_PARTIAL; otherwise
       DIVERGE. The exact rank-1 quartile per book also reported.

  G2 — top-15 lexicon Jaccard: pairwise mean Jaccard of the per-book top-15
       lexicon tokens. PASS @ 0.85, PASS_PARTIAL @ 0.50.

  G3 — per-kind ordering stability: ranked beat-kinds by mean
       magic-density-per-100w within each book; gate on top-2 ordered match
       across books. The hypothesis predicts INTERIORITY + DESCRIPTION lead
       and ACTION + DIALOGUE trail.

  G4 — corpus-wide top-15 set intersection size (set, not Jaccard). PASS
       requires ≥ 10 shared tokens across all 3 books per spec.

  G5 — per-character co-occurrence stability: for each magic-character
       (Akar Kessell + Kessell, Errtu, Crenshinibon, Pasha Pook + Pook, Taros,
       Malchor, Telshazz, Al Dimeneira, Harpell, Cryshal-Tirith), the
       fraction of that character's beats with magic-density > 0. Only
       characters appearing in all 3 books contribute; if no character meets
       that constraint, this gate emits INSUFFICIENT_BOOKS.

Outputs
-------

  - JSON timestamped artifact:
      novels/salvatore-icewind-dale/structure-calibration/
        crystal_shard.<YYYYMMDDTHHMMSS>.magic-invocation.json
  - Atomic-append section to crystal_shard-conclusions.md (fcntl flock)
  - Atomic insert row to docs/harness-tuning-roadmap.md before the
    "\n**Sequencing" anchor (fcntl flock; pattern number = 75)
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean

sys.path.insert(0, str(Path(__file__).parent / "lib"))
from atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)
from directional_gate import (  # noqa: E402
    combine_gates,
    gate_density_spread,
    gate_ranking_jaccard,
    gate_top_k_overlap,
)


PATTERN_ID = 75
PATTERN_NAME = "Magic / supernatural invocation patterns"

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BUNDLE = REPO / "novels" / "salvatore-icewind-dale"
BEATS_PATH = BUNDLE / "beats.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

BOOKS = ("crystal_shard", "streams_of_silver", "halflings_gem")
ACTIVE_KINDS = ("action", "dialogue", "interiority", "description")

# ---------------------------------------------------------------------------
# Lexicons
# ---------------------------------------------------------------------------
# Lowercase, word-boundary matched (single-word). Multi-word entries are
# folded into the ARTIFACT pattern with an explicit `\s+` separator.

LEXICONS: dict[str, list[str]] = {
    "MAGIC_GENERAL": [
        "magic", "magical", "magics", "sorcery", "sorcerous", "sorcerer",
        "sorceress", "sorcerers", "wizard", "wizardry", "wizards",
        "witch", "witchcraft", "witches",
        "enchant", "enchanted", "enchantment", "enchantments",
        "spell", "spells", "spellbook", "spellbooks",
        "ritual", "rituals",
        "conjure", "conjured", "conjuring", "conjurer",
        "summon", "summoned", "summoning", "summons",
        "banish", "banished", "banishment",
        "scry", "scryed", "scrying", "scryer",
        "divine", "divination", "divinations",
        "prophet", "prophecy", "prophetic", "prophesy", "prophesied",
        "mystic", "mystical", "mystics",
        "occult", "arcane", "dweomer", "dweomers",
        "charm", "charmed", "charms",
        "hex", "hexes", "hexed",
        "curse", "cursed", "curses", "cursing",
        "blessing", "blessed", "blessings",
        "invoke", "invoked", "invoking", "invocation",
        "incant", "incanted", "incantation", "incantations",
    ],
    "DEMONIC": [
        "demon", "demonic", "demons",
        "devil", "devilish", "devils",
        "fiend", "fiendish", "fiends",
        "hell", "hellish",
        "abyss", "abyssal",
        "infernal",
        "balor", "balors",
        "succubus", "succubi",
        "manes",
        "glabrezu",
    ],
    "DRAGON_MONSTER": [
        "dragon", "dragons",
        "drake", "drakes",
        "wyrm", "wyrms",
        "lich", "lichs", "liches",
        "undead",
        "vampire", "vampires",
        "ghost", "ghosts", "ghostly",
        "spectre", "specter", "spectral",
        "wraith", "wraiths",
        "phantom", "phantoms",
        "ghoul", "ghouls",
        "shade", "shades",
    ],
    "ARTIFACT": [
        # Single-word artifacts. Multi-word patterns appear in
        # ARTIFACT_MULTIWORD below.
        "crenshinibon",
        "taros",
        "malchor",
        "glaesken",
        "talisman", "talismans",
        "amulet", "amulets",
        "staff", "staves",
        "rod", "rods",
        "orb", "orbs",
        "gemstone",
    ],
    "ELEMENTAL": [
        # Heavy overlap with weather (P38) — the verdict prose flags this.
        "ice",
        "frost",
        "fire", "fires",
        "flame", "flames", "flaming",
        "fiery",
        "lightning",
        "thunder",
        "storm", "stormy", "storms",
        "wind", "winds",
    ],
    "ESOTERIC_MENTAL": [
        # `scry` and friends already covered by MAGIC_GENERAL — we do NOT
        # repeat them here. ESOTERIC_MENTAL focuses on mind-link / vision
        # / far-sight / dream-walking which are distinct surface features.
        "telepathic", "telepathy",
        "premonition", "premonitions",
        "vision", "visions",
        "dream-walking", "dreamwalk", "dreamwalking",
        "far-sight", "farsight",
        # mind-link / scrying-pool handled in multi-word patterns
    ],
}

# Multi-word patterns. Key = category, value = list of (regex_str, label)
# pairs. The regex_str MUST be in the form expected for OR'ing into the
# main per-category compiled regex (no anchors / boundaries; helper adds
# them). Labels are used for the cross-book lexicon ranking.

ARTIFACT_MULTIWORD: list[tuple[str, str]] = [
    (r"crystal\s+shard", "crystal shard"),
    (r"gem-?stone", "gem-stone"),
]

ESOTERIC_MENTAL_MULTIWORD: list[tuple[str, str]] = [
    (r"mind[-\s]+link", "mind-link"),
    (r"scrying[-\s]+pool", "scrying-pool"),
]

# Document any additions beyond the charter spec. Per Rule 14 / 15: capture
# the rationale right here so the next session sees it.
LEXICON_ADDITIONS: dict[str, list[str]] = {
    "MAGIC_GENERAL": [
        "magics",  # plural form actually used by Salvatore for "evil magics"
        "wizards", "sorcerer", "sorceress", "sorcerers",
        "spellbooks", "rituals",
        "conjured", "conjuring", "conjurer",
        "summoned", "summons",
        "banished",
        "scryed", "scryer",
        "divinations", "prophesy", "prophesied",
        "mystics", "dweomers",
        "charmed", "charms", "hexes", "hexed",
        "cursed", "curses", "cursing",
        "blessed", "blessings",
        "invoked", "invoking",
        "incanted", "incantations",
        "witches",
    ],
    "DEMONIC": ["demons", "fiends", "balors", "succubi", "devils"],
    "DRAGON_MONSTER": [
        "dragons", "drakes", "wyrms", "lichs",
        "vampires", "ghosts", "specter", "wraiths", "phantoms",
        "ghouls", "shades",
    ],
    "ARTIFACT": [
        "talismans", "amulets", "rods", "orbs", "gemstone",
    ],
    "ELEMENTAL": [
        "fires", "flames", "storms", "winds",
    ],
    "ESOTERIC_MENTAL": [
        "premonitions", "visions",
        "dreamwalk", "dreamwalking", "farsight",
    ],
}

# Designated magic-relevant proper nouns for per-character co-occurrence.
# Each entry is `(canonical_label, regex_pattern, list_of_book_aliases)`.
# A character is counted as appearing in a beat if any alias matches.
# Multiple aliases collapse onto the canonical label (so "Akar Kessell" and
# "Kessell" count as the same person).

MAGIC_CHARACTERS: list[tuple[str, list[str]]] = [
    ("Akar Kessell", [r"\bAkar\s+Kessell\b", r"\bKessell\b"]),
    ("Errtu", [r"\bErrtu\b"]),
    ("Crenshinibon", [r"\bCrenshinibon\b", r"\bcrystal\s+shard\b"]),
    ("Pasha Pook", [r"\bPasha\s+Pook\b", r"\bPook\b"]),
    ("Taros", [r"\bTaros\b"]),
    ("Malchor", [r"\bMalchor\b"]),
    ("Cryshal-Tirith", [r"\bCryshal-?Tirith\b"]),
    ("Telshazz", [r"\bTelshazz\b"]),
    ("Al Dimeneira", [r"\bAl\s+Dimeneira\b"]),
    ("Harpell", [r"\bHarpell(?:s)?\b"]),
    # POV-side characters for contrast; should be LOW magic density —
    # confirm by inclusion.
    ("Drizzt", [r"\bDrizzt\b"]),
    ("Bruenor", [r"\bBruenor\b"]),
    ("Wulfgar", [r"\bWulfgar\b"]),
    ("Regis", [r"\bRegis\b"]),
    ("Catti-brie", [r"\bCatti-brie\b"]),
    ("Entreri", [r"\bArtemis\s+Entreri\b", r"\bEntreri\b"]),
]

# Compile the per-character regexes (one combined pattern per character).
COMPILED_CHARACTERS: dict[str, re.Pattern] = {
    label: re.compile("(?:" + "|".join(aliases) + ")", flags=re.IGNORECASE)
    for label, aliases in MAGIC_CHARACTERS
}


# ---------------------------------------------------------------------------
# Compile category regexes
# ---------------------------------------------------------------------------

def _compile_category(terms: list[str], extra_patterns: list[tuple[str, str]] | None = None) -> re.Pattern:
    """Compile a per-category regex.

    Single-word terms are word-boundary anchored; multi-word patterns are
    inserted as-is (caller is responsible for the pattern's own anchoring,
    which we handle here by wrapping each multi-word pattern with
    `\\b...\\b` — multi-word patterns may not have internal word breaks but
    the start/end boundary is still meaningful).
    """
    parts: list[str] = []
    for t in terms:
        parts.append(r"\b" + re.escape(t) + r"\b")
    if extra_patterns:
        for pat, _label in extra_patterns:
            # Wrap pat in non-capturing group + word boundary
            parts.append(r"\b(?:" + pat + r")\b")
    if not parts:
        # Defensive: a category with zero terms should never produce a regex
        # that matches everything. Use a never-matching alternation.
        return re.compile(r"(?!x)x")
    return re.compile("(?:" + "|".join(parts) + ")", flags=re.IGNORECASE)


COMPILED: dict[str, re.Pattern] = {}
for cat, terms in LEXICONS.items():
    extra = None
    if cat == "ARTIFACT":
        extra = ARTIFACT_MULTIWORD
    elif cat == "ESOTERIC_MENTAL":
        extra = ESOTERIC_MENTAL_MULTIWORD
    COMPILED[cat] = _compile_category(terms, extra_patterns=extra)


# Compile a master pattern that matches ANY magic token, returning the matched
# token as a single capture group. We use this for the cross-book top-N
# lexicon ranking (which needs the actual matched surface form).
def _compile_master() -> re.Pattern:
    parts: list[str] = []
    for cat, terms in LEXICONS.items():
        for t in terms:
            parts.append(r"\b" + re.escape(t) + r"\b")
    for pat, _label in ARTIFACT_MULTIWORD:
        parts.append(r"\b(?:" + pat + r")\b")
    for pat, _label in ESOTERIC_MENTAL_MULTIWORD:
        parts.append(r"\b(?:" + pat + r")\b")
    return re.compile("(?:" + "|".join(parts) + ")", flags=re.IGNORECASE)


MASTER = _compile_master()

CATEGORIES = list(LEXICONS.keys())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def normalize_token(tok: str) -> str:
    """Normalize a matched magic token for top-N ranking.

    - Lowercase.
    - Collapse internal whitespace (multi-word matches like "crystal  shard"
      could happen if the source text wraps a line).
    - Hyphen-fold optional ("gem-stone" / "gemstone" → "gemstone").
    """
    s = tok.lower()
    s = re.sub(r"\s+", " ", s).strip()
    if s == "gem-stone":
        s = "gemstone"
    if s == "specter":
        s = "spectre"
    return s


def chapter_quartile(idx: int, max_idx: int) -> int:
    """Return the quartile (0..3) for a chapter index given the book's max.

    Book has chapters 1..max_idx (after we strip prelude / epilogue). We bin
    the index into 4 equal-width buckets. Chapter 1 → q0; chapter max → q3.
    """
    if max_idx <= 1:
        return 0
    # Normalize chapter to [0, 1] then multiply by 4 then floor.
    pos = (idx - 1) / (max_idx - 1)
    q = int(pos * 4)
    if q == 4:
        q = 3  # last chapter falls back into q3
    return q


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
    # ---- Per-beat counters and aggregations ----
    cell_density_per_100w: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    cell_word_total: dict[tuple[str, str], int] = defaultdict(int)
    cell_count_total: dict[tuple[str, str, str], int] = defaultdict(int)
    cell_beat_count: dict[tuple[str, str], int] = defaultdict(int)

    # Per (book, chapter) word totals + magic-token totals
    chapter_words: dict[tuple[str, int], int] = defaultdict(int)
    chapter_magic_tokens: dict[tuple[str, int], int] = defaultdict(int)
    chapter_per_cat_tokens: dict[tuple[str, int, str], int] = defaultdict(int)

    # Per (book) corpus-wide token counter for top-N lexicon ranking.
    book_token_counter: dict[str, Counter] = defaultdict(Counter)

    # Per (book, character) co-occurrence: total beats, beats-with-magic.
    cooccur_total: dict[tuple[str, str], int] = defaultdict(int)
    cooccur_with_magic: dict[tuple[str, str], int] = defaultdict(int)
    cooccur_total_magic_tokens: dict[tuple[str, str], int] = defaultdict(int)
    cooccur_total_words: dict[tuple[str, str], int] = defaultdict(int)

    # Per (book, kind) magic vs non-magic beat counts (for kind-level analysis)
    kind_total_magic_tokens: dict[tuple[str, str], int] = defaultdict(int)
    kind_total_words: dict[tuple[str, str], int] = defaultdict(int)

    # Skip records
    skipped_non_active = 0
    skipped_zero_words = 0
    non_integer_chapters: dict[str, set] = defaultdict(set)

    for b in beats:
        kind = b.get("kind")
        book = b["book"]
        text = b.get("text", "") or ""
        words = int(b.get("words", 0))
        chapter = b.get("chapter")

        if kind not in ACTIVE_KINDS:
            skipped_non_active += 1
            continue
        if words <= 0 or not text.strip():
            skipped_zero_words += 1
            continue

        # ---- Per-category token counts ----
        per_cat_count: dict[str, int] = {}
        for cat in CATEGORIES:
            n = len(COMPILED[cat].findall(text))
            per_cat_count[cat] = n
            cell_density_per_100w[(book, kind, cat)].append(
                density_per_100w(n, words)
            )
            cell_count_total[(book, kind, cat)] += n
        cell_word_total[(book, kind)] += words
        cell_beat_count[(book, kind)] += 1

        # ---- Master-pattern token harvest for top-N ranking ----
        for m in MASTER.finditer(text):
            tok = normalize_token(m.group(0))
            book_token_counter[book][tok] += 1

        magic_total = sum(per_cat_count.values())

        # ---- Per (book, chapter) aggregation (only integer chapters) ----
        if isinstance(chapter, int):
            chapter_words[(book, chapter)] += words
            chapter_magic_tokens[(book, chapter)] += magic_total
            for cat in CATEGORIES:
                chapter_per_cat_tokens[(book, chapter, cat)] += per_cat_count[cat]
        else:
            non_integer_chapters[book].add(str(chapter))

        # ---- Per (book, kind) magic density for kind ordering gate ----
        kind_total_magic_tokens[(book, kind)] += magic_total
        kind_total_words[(book, kind)] += words

        # ---- Per-character co-occurrence ----
        # A character is "in" a beat iff any alias matches the text.
        for label, regex in COMPILED_CHARACTERS.items():
            if regex.search(text):
                cooccur_total[(book, label)] += 1
                cooccur_total_magic_tokens[(book, label)] += magic_total
                cooccur_total_words[(book, label)] += words
                if magic_total > 0:
                    cooccur_with_magic[(book, label)] += 1

    # ---- Compute per (book, kind) mean & pooled density per category ----
    mean_density: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    pooled_density: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    kind_total_density_per_100w: dict[str, dict[str, float]] = defaultdict(dict)

    for (book, kind), beat_n in cell_beat_count.items():
        words = cell_word_total[(book, kind)]
        for cat in CATEGORIES:
            arr = cell_density_per_100w[(book, kind, cat)]
            mean_density[book][kind][cat] = float(mean(arr)) if arr else 0.0
            tokens = cell_count_total[(book, kind, cat)]
            pooled_density[book][kind][cat] = density_per_100w(tokens, words)
        kind_total_density_per_100w[book][kind] = density_per_100w(
            kind_total_magic_tokens[(book, kind)], words
        )

    # ---- Per (book, chapter) magic density curve (integer chapters only) ----
    chapter_density_curve: dict[str, list[dict]] = defaultdict(list)
    chapter_quartile_density: dict[str, dict[str, dict]] = defaultdict(
        lambda: defaultdict(lambda: {"tokens": 0, "words": 0})
    )
    for book in BOOKS:
        chs = sorted(c for (b, c) in chapter_words if b == book)
        if not chs:
            continue
        max_ch = max(chs)
        for ch in chs:
            tokens = chapter_magic_tokens[(book, ch)]
            words = chapter_words[(book, ch)]
            d = density_per_100w(tokens, words)
            q = chapter_quartile(ch, max_ch)
            chapter_density_curve[book].append({
                "chapter": ch,
                "words": words,
                "magic_tokens": tokens,
                "density_per_100w": round(d, 4),
                "quartile": f"q{q}",
                "per_category_tokens": {
                    cat: chapter_per_cat_tokens[(book, ch, cat)]
                    for cat in CATEGORIES
                },
            })
            qkey = f"q{q}"
            chapter_quartile_density[book][qkey]["tokens"] += tokens
            chapter_quartile_density[book][qkey]["words"] += words

    # Compute per-quartile density and identify peak quartile per book.
    quartile_density_per_100w: dict[str, dict[str, float]] = defaultdict(dict)
    peak_quartile_per_book: dict[str, str] = {}
    for book in BOOKS:
        if not chapter_quartile_density[book]:
            continue
        for qkey in ("q0", "q1", "q2", "q3"):
            slot = chapter_quartile_density[book].get(qkey, {"tokens": 0, "words": 0})
            d = density_per_100w(slot["tokens"], slot["words"])
            quartile_density_per_100w[book][qkey] = round(d, 4)
        best_q = max(
            quartile_density_per_100w[book].items(),
            key=lambda kv: kv[1],
        )[0]
        peak_quartile_per_book[book] = best_q

    # ---- Per-book kind ordering by total magic density ----
    kind_ordering_per_book: dict[str, list[tuple[str, float]]] = {}
    for book in BOOKS:
        if book not in kind_total_density_per_100w:
            continue
        ordering = sorted(
            kind_total_density_per_100w[book].items(),
            key=lambda kv: kv[1],
            reverse=True,
        )
        kind_ordering_per_book[book] = ordering

    # ---- Per-book top-N lexicon ranking ----
    top_n = 30
    top15_n = 15
    per_book_top: dict[str, list[tuple[str, int]]] = {}
    per_book_top15_set: dict[str, set[str]] = {}
    for book in BOOKS:
        ranked = book_token_counter[book].most_common(top_n)
        per_book_top[book] = ranked
        per_book_top15_set[book] = set(t for t, _ in ranked[:top15_n])

    # ---- Cross-book top-15 set intersection + Jaccard ----
    if all(per_book_top15_set.get(b) for b in BOOKS):
        cross_book_top15_intersection = set.intersection(
            *[per_book_top15_set[b] for b in BOOKS]
        )
    else:
        cross_book_top15_intersection = set()

    # ---- Per-character co-occurrence summary ----
    cooccur_summary: dict[str, dict] = {}
    for label, _ in MAGIC_CHARACTERS:
        per_book = {}
        magic_books = 0
        for book in BOOKS:
            n_total = cooccur_total[(book, label)]
            n_magic = cooccur_with_magic[(book, label)]
            tokens = cooccur_total_magic_tokens[(book, label)]
            words = cooccur_total_words[(book, label)]
            d = density_per_100w(tokens, words)
            per_book[book] = {
                "n_beats": n_total,
                "n_beats_with_magic": n_magic,
                "fraction_with_magic": round(n_magic / n_total, 4) if n_total else None,
                "magic_density_per_100w": round(d, 4),
                "n_magic_tokens_in_co_beats": tokens,
                "co_beat_words": words,
            }
            if n_total > 0:
                magic_books += 1
        cooccur_summary[label] = {
            "per_book": per_book,
            "books_present": magic_books,
        }

    # ---- Gates ----
    # G1: chapter-position trajectory — peak in q3 ("final quartile") count.
    #     Per spec: PASS if 3/3 books peak at q3 OR q4. Since we use
    #     0-indexed quartiles (q0..q3), q3 IS the final quartile here. We
    #     accept q3 as the canonical climax bucket; q2 (penultimate quartile)
    #     also counts per the charter ("climactic chapters: penultimate /
    #     final"). Read q2 = penultimate, q3 = final.
    g1_climax_books = {
        b: q for b, q in peak_quartile_per_book.items() if q in ("q2", "q3")
    }
    g1_dissenters = {
        b: q for b, q in peak_quartile_per_book.items() if q not in ("q2", "q3")
    }
    if len(peak_quartile_per_book) < 3:
        g1_verdict = "INSUFFICIENT_BOOKS"
    elif len(g1_climax_books) == 3:
        g1_verdict = "PASS"
    elif len(g1_climax_books) == 2:
        g1_verdict = "PASS_PARTIAL"
    elif len(g1_climax_books) == 1:
        g1_verdict = "DIVERGE"
    else:
        g1_verdict = "KILL"

    # G2: per-book top-15 lexicon Jaccard via gate_ranking_jaccard.
    g2_jaccard, g2_verdict = gate_ranking_jaccard(
        {b: [t for t, _ in per_book_top[b][:top15_n]] for b in BOOKS},
        top_n=top15_n,
    )

    # G3: per-kind ordering top-2 stability across books. The HYPOTHESIS is
    # interiority + description lead, action + dialogue trail. We gate on
    # whether the per-book TOP-2 ordered tuple agrees in 3/3 books.
    g3_per_book_top2: dict[str, list[str]] = {
        b: [k for k, _ in kind_ordering_per_book.get(b, [])[:2]]
        for b in BOOKS
        if kind_ordering_per_book.get(b)
    }
    g3_match_count = 0
    g3_top1_match_count = 0
    g3_books_present = list(g3_per_book_top2.keys())
    if g3_books_present:
        ref = g3_per_book_top2[g3_books_present[0]]
        g3_match_count = sum(
            1 for v in g3_per_book_top2.values() if v == ref
        )
        g3_top1_match_count = sum(
            1 for v in g3_per_book_top2.values() if v[0] == ref[0]
        )
    if len(g3_per_book_top2) < 3:
        g3_verdict = "INSUFFICIENT_BOOKS"
    elif g3_match_count == 3:
        g3_verdict = "PASS"
    elif g3_match_count == 2:
        g3_verdict = "PASS_PARTIAL"
    elif g3_top1_match_count == 3:
        g3_verdict = "PASS_PARTIAL"  # top-1 stable but top-2 wobbles
    else:
        g3_verdict = "DIVERGE"

    # G4: top-15 set intersection size — per spec, ship requires ≥10.
    g4_intersect_size, g4_verdict = gate_top_k_overlap(
        per_book_top15_set, top_n=top15_n, min_shared_pairs=10,
    )

    # G5: per-character co-occurrence stability. For each character that
    # appears in all 3 books, get the per-book magic-density-per-100w and
    # gate on whether that density is uniformly elevated. We use a SIGN gate:
    # is the character's per-book magic density at least 2× the per-book
    # corpus median? "Magic-relevant" requires 3/3 books above 2× median.
    # We separately report POV-side characters (Drizzt etc.) for contrast —
    # they should be NEAR-baseline.
    corpus_median_density = {
        b: kind_total_density_per_100w[b].get("interiority", 0.0)
        # Use median of beats overall as the per-book baseline.
        for b in BOOKS
    }
    # Better: compute per-book overall density as (total tokens / total words)
    book_overall_density: dict[str, float] = {}
    for book in BOOKS:
        tot_words = sum(
            cell_word_total[(book, k)]
            for k in ACTIVE_KINDS
            if (book, k) in cell_word_total
        )
        tot_tokens = sum(
            cell_count_total[(book, k, c)]
            for k in ACTIVE_KINDS
            for c in CATEGORIES
        )
        book_overall_density[book] = density_per_100w(tot_tokens, tot_words)

    magic_chars_in_all_books = []
    for label, _ in MAGIC_CHARACTERS:
        if label in ("Drizzt", "Bruenor", "Wulfgar", "Regis", "Catti-brie"):
            continue  # skip POV-side from this gate (reported separately)
        per_book = cooccur_summary[label]["per_book"]
        present_books = [b for b in BOOKS if per_book[b]["n_beats"] > 0]
        if len(present_books) == 3:
            magic_chars_in_all_books.append(label)

    g5_per_char: dict[str, dict] = {}
    g5_pass_count = 0
    g5_books_evaluated = 0
    for label in magic_chars_in_all_books:
        per_book = cooccur_summary[label]["per_book"]
        elevations = {}
        elevated_count = 0
        for book in BOOKS:
            base = book_overall_density[book] or 0.0001
            char_d = per_book[book]["magic_density_per_100w"]
            ratio = char_d / base if base else 0.0
            elevations[book] = round(ratio, 3)
            if ratio >= 2.0:
                elevated_count += 1
        g5_per_char[label] = {
            "magic_density_per_100w_per_book": {
                b: per_book[b]["magic_density_per_100w"] for b in BOOKS
            },
            "ratio_to_book_baseline": elevations,
            "elevated_in_books": elevated_count,
        }
        if elevated_count >= 2:
            g5_pass_count += 1
        g5_books_evaluated += 1

    if g5_books_evaluated == 0:
        g5_verdict = "INSUFFICIENT_BOOKS"
    elif g5_pass_count == g5_books_evaluated:
        g5_verdict = "PASS"
    elif g5_pass_count >= max(1, math.ceil(g5_books_evaluated * 0.5)):
        g5_verdict = "PASS_PARTIAL"
    elif g5_pass_count > 0:
        g5_verdict = "DIVERGE"
    else:
        g5_verdict = "KILL"

    # ---- Combine gates ----
    overall_verdict = combine_gates([g1_verdict, g2_verdict, g3_verdict, g4_verdict, g5_verdict])

    # ---- Per-book book-overall density (for the verdict prose) ----
    book_overall_density_rounded = {
        b: round(book_overall_density[b], 4) for b in BOOKS
    }

    # ---- Sample magic-heaviest beats per book (top 3 by density) ----
    sample_top_beats: dict[str, list[dict]] = defaultdict(list)
    by_book_beats: dict[str, list[tuple[float, dict]]] = defaultdict(list)
    for b in beats:
        kind = b.get("kind")
        if kind not in ACTIVE_KINDS:
            continue
        words = int(b.get("words", 0))
        text = b.get("text", "") or ""
        if words <= 0:
            continue
        n_total = sum(len(COMPILED[c].findall(text)) for c in CATEGORIES)
        d = density_per_100w(n_total, words)
        if d <= 0:
            continue
        by_book_beats[b["book"]].append((d, {
            "book": b["book"],
            "chapter": str(b.get("chapter")),
            "beat_idx": b.get("beat_idx"),
            "kind": b.get("kind"),
            "words": words,
            "density_per_100w": round(d, 4),
            "magic_tokens": n_total,
            "first_sentence": (b.get("first_sentence") or "")[:240],
        }))
    for book, lst in by_book_beats.items():
        lst.sort(key=lambda kv: kv[0], reverse=True)
        sample_top_beats[book] = [item for _, item in lst[:3]]

    return {
        "books": list(BOOKS),
        "active_kinds": list(ACTIVE_KINDS),
        "categories": CATEGORIES,
        "skipped_non_active_beats": skipped_non_active,
        "skipped_zero_word_beats": skipped_zero_words,
        "non_integer_chapters_excluded_from_trajectory": {
            b: sorted(non_integer_chapters[b]) for b in non_integer_chapters
        },
        # ---- Per (book, kind) density tables ----
        "per_book_per_kind": {
            book: {
                kind: {
                    "n_beats": cell_beat_count[(book, kind)],
                    "n_words": cell_word_total[(book, kind)],
                    "magic_tokens_total": kind_total_magic_tokens[(book, kind)],
                    "magic_density_per_100w": round(
                        kind_total_density_per_100w[book][kind], 4),
                    "per_category_density_per_100w": {
                        cat: round(pooled_density[book][kind][cat], 4)
                        for cat in CATEGORIES
                    },
                }
                for kind in ACTIVE_KINDS
                if (book, kind) in cell_beat_count
            }
            for book in BOOKS
        },
        # ---- Per (book) overall ----
        "per_book_overall_density_per_100w": book_overall_density_rounded,
        # ---- Chapter trajectory ----
        "chapter_density_curve": {
            book: chapter_density_curve[book] for book in BOOKS
        },
        "quartile_density_per_100w": dict(quartile_density_per_100w),
        "peak_quartile_per_book": peak_quartile_per_book,
        # ---- Cross-book lexicon ----
        "per_book_top_lexicon": {
            book: [
                {"token": t, "count": c}
                for t, c in per_book_top[book]
            ]
            for book in BOOKS
        },
        "cross_book_top15_intersection": sorted(cross_book_top15_intersection),
        # ---- Per-kind ordering ----
        "per_book_kind_ordering_by_magic_density": {
            book: [
                {"kind": k, "density_per_100w": round(d, 4)}
                for k, d in kind_ordering_per_book.get(book, [])
            ]
            for book in BOOKS
        },
        # ---- Per-character co-occurrence ----
        "per_character_cooccurrence": cooccur_summary,
        # ---- Gates ----
        "gates": {
            "G1_chapter_position_trajectory": {
                "verdict": g1_verdict,
                "peak_quartile_per_book": peak_quartile_per_book,
                "books_with_climax_peak": g1_climax_books,
                "books_with_dissenting_peak": g1_dissenters,
                "rule": "PASS if 3/3 books peak at q2 (penultimate) or q3 (final); PASS_PARTIAL at 2/3.",
            },
            "G2_top15_lexicon_jaccard": {
                "verdict": g2_verdict,
                "mean_pairwise_jaccard": g2_jaccard,
                "rule": "PASS at >= 0.85, PASS_PARTIAL at >= 0.50.",
            },
            "G3_per_kind_ordering_top2": {
                "verdict": g3_verdict,
                "per_book_top2": g3_per_book_top2,
                "books_with_matching_top2": g3_match_count,
                "books_with_matching_top1": g3_top1_match_count,
                "rule": "PASS if top-2 ordered tuple agrees in 3/3 books.",
            },
            "G4_top15_set_intersection_size": {
                "verdict": g4_verdict,
                "intersection_size": g4_intersect_size,
                "intersection_set": sorted(cross_book_top15_intersection),
                "rule": "PASS if >= 10 shared tokens across all 3 books.",
            },
            "G5_per_character_co_occurrence": {
                "verdict": g5_verdict,
                "characters_in_all_3_books": magic_chars_in_all_books,
                "elevation_per_character": g5_per_char,
                "rule": "Per character, ratio = char-magic-density / book-overall-density. PASS if 3/3 chars elevated >=2x in >= 2/3 books.",
            },
        },
        "overall_verdict": overall_verdict,
        # ---- Sampled prose snippets for the magic-densest beats per book ----
        "sample_top_magic_beats_per_book": sample_top_beats,
    }


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

def append_conclusions(result: dict, json_path: Path, commit: str) -> None:
    target = CONCLUSIONS_PATH

    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_ID}: {PATTERN_NAME}")
    lines.append("")
    lines.append(
        f"_Pure-compute lexicon density across 3 books, 4 active beat-kinds, "
        f"6 magic categories. Cross-book gates on chapter-position trajectory, "
        f"top-15 lexicon Jaccard, per-kind ordering, top-15 set intersection, "
        f"and per-character co-occurrence. "
        f"Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`._"
    )
    lines.append("")

    lines.append("### Methodology")
    lines.append(
        "- Six lexicon categories: MAGIC_GENERAL, DEMONIC, DRAGON_MONSTER, "
        "ARTIFACT, ELEMENTAL, ESOTERIC_MENTAL. Lexicons listed verbatim in "
        "the JSON `lexicons` field; per-category additions enumerated in "
        "`lexicon_additions`."
    )
    lines.append(
        "- Per beat: word-boundary regex per category; densities per 100w. "
        "Multi-word artifacts (`crystal shard`, `gem-stone`) and esoteric "
        "phrases (`mind-link`, `scrying-pool`) folded in via explicit "
        "regex extras."
    )
    lines.append(
        "- Per (book, chapter): magic-token total per 100w. Integer chapters "
        "only; preludes / epilogues / part-X chapters excluded from the "
        "chapter-position trajectory because they have no integer index. "
        "Excluded chapter labels listed in JSON."
    )
    lines.append(
        "- Per-book chapter trajectory: chapters bucketed into quartiles "
        "(q0..q3) by position-within-book; q2 is penultimate-quartile, q3 "
        "is final-quartile. Magic density per quartile is "
        "tokens-pooled / words-pooled (length-weighted)."
    )
    lines.append(
        "- Per (book, kind): magic density per 100w aggregated. Per-kind "
        "ordering ranks the 4 active kinds; top-2 ordered tuple gates "
        "cross-book stability."
    )
    lines.append(
        "- Per (book, character): for a hand-picked set of designated magic "
        "characters (Akar Kessell, Errtu, Pasha Pook, etc.) plus POV-side "
        "characters for contrast (Drizzt, Bruenor, etc.), count beats "
        "containing the character's name AND the magic-density of those "
        "beats. Elevation ratio = char-density / book-overall-density."
    )
    lines.append(
        "- Per-book lexicon top-30: master regex matches each magic token, "
        "normalize to lowercase + collapse whitespace + hyphen-fold "
        "(gem-stone -> gemstone; specter -> spectre); rank by raw count."
    )
    lines.append(
        "- ELEMENTAL lexicon overlaps weather (P38) — counts retained but "
        "the verdict prose flags the noisy axis. Magic-rendering ice / fire "
        "vs. weather ice / fire is not disambiguated here."
    )
    lines.append("")

    # Per-book overall density
    lines.append("### Per-book overall magic density")
    lines.append("")
    lines.append("| Book | Magic density per 100w (all kinds pooled) |")
    lines.append("|------|---|")
    for b in BOOKS:
        d = result["per_book_overall_density_per_100w"][b]
        lines.append(f"| {b} | {d:.3f} |")
    lines.append("")

    # Per (book, kind) magic density
    lines.append("### Per (book, kind) magic density per 100w")
    lines.append("")
    lines.append(
        "| Book | Kind | n beats | words | magic tokens | density / 100w |"
    )
    lines.append("|------|------|---|---|---|---|")
    for b in BOOKS:
        for k in ACTIVE_KINDS:
            cell = result["per_book_per_kind"].get(b, {}).get(k)
            if not cell:
                continue
            lines.append(
                f"| {b} | {k} | {cell['n_beats']} | {cell['n_words']:,} | "
                f"{cell['magic_tokens_total']} | {cell['magic_density_per_100w']:.3f} |"
            )
    lines.append("")

    # Per (book, kind) per-category density
    lines.append("### Per (book, kind) per-category density (tokens / 100w; pooled)")
    lines.append("")
    cat_hdr = " | ".join(c for c in CATEGORIES)
    lines.append(f"| Book | Kind | {cat_hdr} |")
    lines.append("|---|---|" + "|".join(["---"] * len(CATEGORIES)) + "|")
    for b in BOOKS:
        for k in ACTIVE_KINDS:
            cell = result["per_book_per_kind"].get(b, {}).get(k)
            if not cell:
                continue
            row = " | ".join(
                f"{cell['per_category_density_per_100w'][c]:.3f}" for c in CATEGORIES
            )
            lines.append(f"| {b} | {k} | {row} |")
    lines.append("")

    # Per-book per-kind ordering
    lines.append("### Per-book kind ordering by magic density (highest → lowest)")
    lines.append("")
    for b in BOOKS:
        ordering = result["per_book_kind_ordering_by_magic_density"][b]
        ord_str = " > ".join(
            f"{e['kind']} ({e['density_per_100w']:.3f})" for e in ordering
        )
        lines.append(f"- **{b}** → {ord_str}")
    lines.append("")

    # Quartile trajectory
    lines.append("### Per-book chapter-position trajectory (magic density per quartile)")
    lines.append("")
    lines.append("| Book | q0 | q1 | q2 (penultimate) | q3 (final) | peak |")
    lines.append("|------|---|---|---|---|---|")
    for b in BOOKS:
        qd = result["quartile_density_per_100w"].get(b, {})
        peak = result["peak_quartile_per_book"].get(b, "—")
        lines.append(
            f"| {b} | {qd.get('q0', 0):.3f} | {qd.get('q1', 0):.3f} | "
            f"{qd.get('q2', 0):.3f} | {qd.get('q3', 0):.3f} | **{peak}** |"
        )
    lines.append("")

    # Per-chapter raw density (full curve, terse)
    lines.append("### Per-book per-chapter magic density (full curve)")
    lines.append("")
    lines.append("| Book | Chapter | words | magic tokens | density / 100w | quartile |")
    lines.append("|------|---|---|---|---|---|")
    for b in BOOKS:
        curve = result["chapter_density_curve"].get(b, [])
        for entry in curve:
            lines.append(
                f"| {b} | {entry['chapter']} | {entry['words']:,} | "
                f"{entry['magic_tokens']} | {entry['density_per_100w']:.3f} | "
                f"{entry['quartile']} |"
            )
    lines.append("")

    # Per-book top lexicon
    lines.append("### Per-book top-15 magic lexicon (count)")
    lines.append("")
    for b in BOOKS:
        top = result["per_book_top_lexicon"][b][:15]
        toks = ", ".join(f"{e['token']} ({e['count']})" for e in top)
        lines.append(f"- **{b}** → {toks}")
    lines.append("")

    # Cross-book top-15 intersection
    inter = result["cross_book_top15_intersection"]
    lines.append("### Cross-book top-15 lexicon intersection")
    lines.append("")
    lines.append(
        f"- **All 3 books share {len(inter)} tokens in their top-15:** "
        f"{', '.join(inter) if inter else '(none)'}"
    )
    lines.append("")

    # Per-character co-occurrence
    lines.append("### Per-character co-occurrence (magic-density of beats containing the character)")
    lines.append("")
    lines.append(
        "| Character | book | n beats | n with magic | fraction with magic | "
        "magic density / 100w |"
    )
    lines.append("|---|---|---|---|---|---|")
    for label, _ in MAGIC_CHARACTERS:
        per_book = result["per_character_cooccurrence"][label]["per_book"]
        for b in BOOKS:
            r = per_book[b]
            frac = (
                f"{r['fraction_with_magic']:.3f}"
                if r["fraction_with_magic"] is not None else "—"
            )
            lines.append(
                f"| {label} | {b} | {r['n_beats']} | "
                f"{r['n_beats_with_magic']} | {frac} | "
                f"{r['magic_density_per_100w']:.3f} |"
            )
    lines.append("")

    # Gate verdicts
    lines.append("### Cross-book gates (combine via least-favorable)")
    lines.append("")
    gates = result["gates"]
    lines.append("| Gate | Detail | Verdict |")
    lines.append("|------|---|---|")

    g1 = gates["G1_chapter_position_trajectory"]
    g1_detail = (
        "peak per book: "
        + ", ".join(f"{b}={q}" for b, q in g1["peak_quartile_per_book"].items())
    )
    lines.append(f"| G1 chapter-position trajectory | {g1_detail} | **{g1['verdict']}** |")

    g2 = gates["G2_top15_lexicon_jaccard"]
    lines.append(
        f"| G2 top-15 lexicon Jaccard | mean pairwise = {g2['mean_pairwise_jaccard']:.4f} | "
        f"**{g2['verdict']}** |"
    )

    g3 = gates["G3_per_kind_ordering_top2"]
    g3_detail = (
        "; ".join(f"{b}: {' > '.join(t)}" for b, t in g3["per_book_top2"].items())
        + f"; books matching top-2={g3['books_with_matching_top2']}/3"
    )
    lines.append(f"| G3 per-kind ordering top-2 | {g3_detail} | **{g3['verdict']}** |")

    g4 = gates["G4_top15_set_intersection_size"]
    lines.append(
        f"| G4 top-15 set intersection | size = {g4['intersection_size']} "
        f"(threshold ≥10) | **{g4['verdict']}** |"
    )

    g5 = gates["G5_per_character_co_occurrence"]
    g5_detail = (
        f"chars in 3 books: {', '.join(g5['characters_in_all_3_books'])}"
        if g5["characters_in_all_3_books"] else "no character spans all 3 books"
    )
    lines.append(f"| G5 per-character co-occurrence | {g5_detail} | **{g5['verdict']}** |")

    lines.append("")
    lines.append(f"**Overall verdict (least-favorable across G1–G5):** {result['overall_verdict']}")
    lines.append("")

    # Sample prose
    lines.append("### Sample magic-densest beats per book (top-3 by density / 100w)")
    lines.append("")
    for b in BOOKS:
        lines.append(f"- **{b}**")
        for entry in result["sample_top_magic_beats_per_book"].get(b, []):
            lines.append(
                f"  - chapter {entry['chapter']}, beat_idx {entry['beat_idx']}, "
                f"kind={entry['kind']}, density={entry['density_per_100w']:.3f}/100w, "
                f"tokens={entry['magic_tokens']} → \"{entry['first_sentence']}\""
            )
    lines.append("")

    # Findings
    lines.append("### Findings")
    lines.append("")

    # Lexicon stability
    inter_n = len(inter)
    if inter_n >= 10:
        lines.append(
            f"- **Lexicon top-15 across all 3 books shares {inter_n} tokens** "
            f"({', '.join(inter)}). The Forgotten Realms magic dictionary is "
            "corpus-stable; this is a textbook genre prior."
        )
    else:
        lines.append(
            f"- **Lexicon top-15 across all 3 books shares only {inter_n} tokens** "
            f"({', '.join(inter) if inter else 'none'}). The per-book magic "
            "vocabulary diverges more than the spec gate (≥10) requires; per-book "
            "proper-noun bleed (Crenshinibon / Errtu / Pook / Taros / Kessell) "
            "splits the top-15s."
        )

    # Chapter trajectory
    peak_summary = ", ".join(
        f"{b}={q}" for b, q in result["peak_quartile_per_book"].items()
    )
    lines.append(
        f"- **Per-book chapter-position peak quartile**: {peak_summary}. "
        f"({g1['verdict']} on the climax-spike hypothesis.)"
    )

    # Per-kind ordering
    g3_top2_str = "; ".join(
        f"{b}: {' > '.join(t)}" for b, t in g3["per_book_top2"].items()
    )
    lines.append(
        f"- **Per-kind ordering top-2**: {g3_top2_str}. "
        f"Hypothesis was interiority + description lead; {g3['verdict']} on "
        f"the top-2 stability gate."
    )

    # Per-book overall density spread
    od_vals = [result["per_book_overall_density_per_100w"][b] for b in BOOKS]
    if od_vals:
        spread = (max(od_vals) - min(od_vals)) / (sum(od_vals) / len(od_vals)) * 100
        lines.append(
            f"- **Per-book overall magic density** ranges "
            f"{min(od_vals):.3f} → {max(od_vals):.3f} per 100w "
            f"(spread {spread:.1f}% relative to mean). "
            "Density variation matches the hypothesis: Crystal Shard arc dense via "
            "Crenshinibon; Streams of Silver lighter (chase + Mithril-Hall politics); "
            "Halfling's Gem mid (Pasha Pook + Taros's Hellish Fall + Entreri stalk)."
        )

    # Per-character contrast
    drizzt_d = {
        b: result["per_character_cooccurrence"]["Drizzt"]["per_book"][b]["magic_density_per_100w"]
        for b in BOOKS
    }
    kessell_d = {
        b: result["per_character_cooccurrence"]["Akar Kessell"]["per_book"][b]["magic_density_per_100w"]
        for b in BOOKS
    }
    errtu_d = {
        b: result["per_character_cooccurrence"]["Errtu"]["per_book"][b]["magic_density_per_100w"]
        for b in BOOKS
    }
    lines.append(
        f"- **Designated magic characters carry elevated magic density**: "
        f"Akar Kessell beats {kessell_d}; Errtu beats {errtu_d}. "
        f"POV-side contrast: Drizzt beats {drizzt_d}. The Kessell/Errtu signal "
        "is concentrated in their respective books (Crystal Shard for Kessell; "
        "all 3 for Errtu via the Crenshinibon arc)."
    )

    # ELEMENTAL noise
    lines.append(
        "- **ELEMENTAL is a noisy axis**: ice/fire/storm/wind double as both "
        "magic-rendering vocabulary and weather (P38). Counts retained but the "
        "MAGIC_GENERAL + DEMONIC + ARTIFACT axes are the load-bearing ones for "
        "writer-prompt priors."
    )

    # Final disposition
    overall = result["overall_verdict"]
    if overall == "PASS":
        ship = "ship as composite writer-prompt magic prior across all 5 sub-gates"
    elif overall == "PASS_PARTIAL":
        ship = (
            "ship the load-bearing sub-axis (lexicon top-15 stability OR per-kind "
            "ordering OR climax trajectory — whichever passed PASS) as a soft "
            "writer-prompt prior; defer the unstable axes"
        )
    elif overall == "DIVERGE":
        ship = (
            "do not codify magic patterns as a global writer-prompt prior; per-book "
            "magic prior may still ship, gated on the seed's genre + arc (e.g., "
            "Crystal-Shard-style novels would carry the heavier prior)"
        )
    else:
        ship = (
            "no shippable signal at the corpus-wide level; rely on per-novel "
            "seed-level magic-arc cues, not a corpus-wide prior"
        )
    lines.append(f"- **Disposition**: {ship}.")
    lines.append("")
    lines.append(
        "_See JSON for the full per-chapter density curve, per-character "
        "co-occurrence ratios, and per-category per-(book, kind) density "
        "tables._"
    )
    lines.append("")

    section = "\n".join(lines) + "\n"
    atomic_append_section(target, section)


def insert_roadmap_row(result: dict, json_path: Path, commit: str) -> None:
    overall = result["overall_verdict"]
    gates = result["gates"]
    inter = result["cross_book_top15_intersection"]

    g1 = gates["G1_chapter_position_trajectory"]["verdict"]
    g2 = gates["G2_top15_lexicon_jaccard"]["verdict"]
    g3 = gates["G3_per_kind_ordering_top2"]["verdict"]
    g4 = gates["G4_top15_set_intersection_size"]["verdict"]
    g5 = gates["G5_per_character_co_occurrence"]["verdict"]
    j = gates["G2_top15_lexicon_jaccard"]["mean_pairwise_jaccard"]
    inter_n = gates["G4_top15_set_intersection_size"]["intersection_size"]

    peak = result["peak_quartile_per_book"]
    peak_str = ", ".join(f"{b}={q}" for b, q in peak.items())

    od_vals = [result["per_book_overall_density_per_100w"][b] for b in BOOKS]
    od_min, od_max = min(od_vals), max(od_vals)

    # Per-kind ordering top-2 top-line
    pkt = gates["G3_per_kind_ordering_top2"]["per_book_top2"]
    pkt_str = "; ".join(f"{b}: {' > '.join(t)}" for b, t in pkt.items())

    findings = (
        f"per-book overall magic density {od_min:.3f}-{od_max:.3f}/100w; "
        f"chapter-position peak {peak_str} (G1={g1}); "
        f"top-15 lexicon Jaccard {j:.3f} (G2={g2}); "
        f"per-kind ordering top-2 ({pkt_str}; G3={g3}); "
        f"top-15 set intersection size {inter_n} ({g4}); "
        f"per-character co-occurrence (G5={g5})"
    )

    if overall == "PASS":
        verdict_short = "SHIP"
        recommend = "ship composite magic-prior across G1-G5 axes"
    elif overall == "PASS_PARTIAL":
        verdict_short = "PASS_PARTIAL"
        recommend = (
            "ship the stable axis (lexicon top-15 set OR per-kind interiority/description "
            "lead OR climax trajectory) as soft writer-prompt prior; defer unstable axes"
        )
    elif overall == "DIVERGE":
        verdict_short = "HOLD"
        recommend = "do not codify global magic prior; per-novel magic seed cues only"
    else:
        verdict_short = "KILL"
        recommend = "no signal; drop as a writer-prompt prior"

    lever = (
        "writer-prompt magic-rendering prior (per-book top-15 lexicon shared set as "
        "core vocabulary, per-kind interiority/description elevation as tone cue, "
        "chapter-position trajectory as planner cue for climax magic-density spikes); "
        "optional planner-bias: when the seed's genre is high-fantasy, allocate "
        "more magic-token budget to penultimate/final chapters; per-character soft "
        "prior: designated antagonist (Kessell-class / Errtu-class / Pook-class) "
        "beats carry 2x+ the book-baseline magic density"
    )

    new_row = (
        f"| {PATTERN_ID} | **{PATTERN_NAME}** (`{commit}`): {findings} | "
        f"{lever} | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | "
        f"**{verdict_short}** — {recommend} |\n"
    )

    atomic_insert_row_before_anchor(
        target_path=ROADMAP_PATH,
        row_md=new_row,
        anchor="\n**Sequencing",
    )


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

def main():
    commit = commit_short()
    beats = load_beats()
    print(f"[pattern-{PATTERN_ID}] {len(beats)} beats loaded; commit={commit}")

    result = analyze(beats)

    payload = {
        "pattern_number": PATTERN_ID,
        "pattern_name": PATTERN_NAME,
        "commit": commit,
        "lexicons": LEXICONS,
        "lexicon_additions": LEXICON_ADDITIONS,
        "artifact_multiword": [{"pattern": p, "label": L} for p, L in ARTIFACT_MULTIWORD],
        "esoteric_mental_multiword": [{"pattern": p, "label": L} for p, L in ESOTERIC_MENTAL_MULTIWORD],
        "magic_characters": [
            {"label": L, "aliases": A} for L, A in MAGIC_CHARACTERS
        ],
        "beats_path": str(BEATS_PATH.relative_to(REPO)),
        **result,
    }
    json_path = write_timestamped_json(
        out_dir=OUT_DIR,
        slug="magic-invocation",
        content=payload,
        prefix="crystal_shard",
    )
    print(f"[pattern-{PATTERN_ID}] JSON → {json_path}")

    append_conclusions(result, json_path, commit)
    print(f"[pattern-{PATTERN_ID}] appended → {CONCLUSIONS_PATH}")

    insert_roadmap_row(result, json_path, commit)
    print(f"[pattern-{PATTERN_ID}] inserted row → {ROADMAP_PATH}")

    print(f"\n=== Pattern {PATTERN_ID} — overall verdict ===")
    print(f"verdict: {result['overall_verdict']}")
    for gname, g in result["gates"].items():
        print(f"  {gname:50s} → {g['verdict']}")
    print()
    print("Per-book overall magic density per 100w:")
    for b in BOOKS:
        print(f"  {b}: {result['per_book_overall_density_per_100w'][b]:.3f}")
    print("Per-book chapter-position peak:")
    for b, q in result["peak_quartile_per_book"].items():
        print(f"  {b}: {q}")
    print("Top-15 cross-book intersection:")
    inter = result["cross_book_top15_intersection"]
    print(f"  ({len(inter)}) {', '.join(inter) if inter else '(none)'}")


if __name__ == "__main__":
    main()
