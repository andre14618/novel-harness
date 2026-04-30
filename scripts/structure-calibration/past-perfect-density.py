"""
Pattern 55 — Past-perfect ("had X-ed") density distribution
(3-book Icewind Dale corpus).

Pure-compute regex pass over `novels/salvatore-icewind-dale/beats.jsonl`
+ `novels/salvatore-icewind-dale/scenes.jsonl`.

Hypothesis: Past-perfect tense ("had walked", "had been") is an
explicit narrator marker for prior-events / flashback / state-of-
knowledge. Density should:
  - Cluster in interiority beats more than action (interiority renders
    backstory).
  - Drop sharply in dialogue (characters speak in present + simple
    past).
  - Spike at chapter openings (recap function) AND at flashback
    markers (often paired with P54 time-skip lexicon).
  - Be a stable per-kind ratio across books (writer voice signature).

Methodology:
  - Detect `had` (lowercase, word-boundary, including `hadn't`/`had
    not`) followed within 0-3 intervening words by a past-participle-
    shaped token. Past participle detection:
      * regular: -ed (`walked`, `talked`, `crossed`)
      * irregular -en: `taken`, `given`, `eaten`, `broken`, `spoken`,
        `stolen`, `forgotten`, `ridden`, `written`, `seen`, `chosen`,
        `frozen`, `drawn`, `flown`, `grown`, `known`, `shown`,
        `sworn`, `worn`, `torn`, `fallen`, `risen`, `arisen`, `borne`,
        `forsworn`, ...
      * irregular -t: `felt`, `kept`, `slept`, `left`, `lost`,
        `meant`, `dealt`, `burnt`, `learnt`, `dreamt`, `crept`,
        `wept`, `swept`, `bent`, `lent`, `sent`, `spent`, `built`,
        `dwelt`, ...
      * -ne / -ne-form: `done`, `gone`, `won`
      * -ought / -aught: `thought`, `fought`, `brought`, `bought`,
        `caught`, `taught`, `sought`, `wrought`
      * other irregulars: `been`, `had`, `come`, `become`, `run`,
        `stood`, `understood`, `held`, `bound`, `found`, `wound`,
        `hung`, `sung`, `sprung`, `swung`, `clung`, `flung`, `stung`,
        `strung`, `stunk`, `sunk`, `drunk`, `shrunk`, `struck`,
        `stuck`, `cast`, `set`, `put`, `cut`, `let`, `hit`, `hurt`,
        `read`, `said`, `paid`, `laid`, `made`, `lit`, `met`, `bled`,
        `fled`, `led`, `bred`, `spread`, `shed`, `spun`, `sat`, `lay`,
        `bit`, `bit`, `lit`, `slit`, `quit`, `split`, `slunk`, `shrunk`
  - Filter out `had` followed by determiners / quantifiers / common
    NP openers — these are simple-past possessive uses ("had a" /
    "had no" / "had to" etc.), NOT past-perfect.
  - Per beat: count past-perfect occurrences, normalize by beat words
    -> density per 100 words.
  - Per (book, kind): aggregate mean density per kind. 4 kinds x 3
    books = 12 cells (we ignore the singleton stakes_recalibration
    bucket in the main analysis but report it for completeness).
  - Per-kind across all books: which kind has highest density? Stable
    cross-book?
  - Position analysis (chapter-open vs internal) via `scenes.jsonl`
    `boundary` field joined on scene_id.
  - Pair-with-P54 check: when a beat carries a P54 time-skip marker,
    is past-perfect density higher? Compute density_with /
    density_without ratio.
  - Cross-book directional gate (PASS / PASS_PARTIAL / DIVERGE / KILL).

Verdict gate (per spec):
  PASS         — per-kind ordering (top-2) reproduces 3/3 books AND
                 chapter-open density spike (>=1.3x internal) reproduces
                 3/3
  PASS_PARTIAL — 2/3 reproduce
  DIVERGE      — different orderings or no spike
  KILL         — no signal
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
OUT_PATH = os.path.join(OUT_DIR, f"crystal_shard.{TIMESTAMP}.past-perfect-density.json")

BOOKS_IN_ORDER = ["crystal_shard", "streams_of_silver", "halflings_gem"]


# ----------------------------------------------------------------------
# P54 lexicon (for pair-with-time-skip analysis). Mirror of the lexicon
# used in time-skip-markers.py. Frozen here because the source script
# computes a JSON output but does not export the lexicon as a module.
# ----------------------------------------------------------------------

P54_EXPLICIT_DURATION = [
    "hours later", "days later", "weeks later", "months later",
    "years later", "a few hours later", "a few days",
    "a few minutes later", "many hours", "many days", "many years",
    "some hours later", "some days", "some time later",
    "half an hour later", "half a day", "an hour later",
    "a moment later",
]
P54_ABSOLUTE_TIME = [
    "the next morning", "the next day", "the next night",
    "the next afternoon", "the following morning",
    "the following day", "by dawn", "by morning", "by noon",
    "by sunset", "by nightfall", "by midnight", "at dawn", "at dusk",
    "at sunset", "at midnight", "at sunrise", "early the next",
    "late that night", "that evening", "that night",
    "in the morning", "in the evening",
]
P54_ELAPSED_NARRATIVE = [
    "for hours", "for days", "for weeks", "for months", "for years",
    "throughout the night", "all night", "all day", "all morning",
    "long after", "long before",
]
P54_ALL = P54_EXPLICIT_DURATION + P54_ABSOLUTE_TIME + P54_ELAPSED_NARRATIVE
P54_COMPILED = [re.compile(r"\b" + re.escape(m) + r"\b", re.IGNORECASE) for m in P54_ALL]


def beat_has_p54_marker(text):
    if not text:
        return False
    for rx in P54_COMPILED:
        if rx.search(text):
            return True
    return False


# ----------------------------------------------------------------------
# Past-perfect detection.
#
# Strategy (documented per spec): detect `\b(had|hadn't|had\s+not)\b`
# followed within 0-3 intervening tokens by a token whose surface form
# is a past-participle. We define participle membership as either:
#   (a) explicit irregular in IRREGULAR_PARTICIPLES set, OR
#   (b) suffix-shape match against PARTICIPLE_SUFFIXES, with a small
#       blacklist of suffix-collisions that are NOT participles (e.g.
#       `red`, `bed`, `bread`, `forhead`, `instead`, `bored`, `tired`,
#       `cured`, `wired` -- adjective-y -ed words; we don't filter
#       these because they're rare adjectival uses and over-filtering
#       loses real participles like `tired` ("had tired of...") that
#       are participial here. Spec said "either method is acceptable;
#       document your choice." We document the choice and accept the
#       small adjectival false-positive rate.)
#
# Stopword filter: when `had` is immediately followed by a word in
# HAD_STOPWORDS (no participle search), it's NOT past-perfect — it's
# possessive/quasi-modal use ("had a", "had no", "had to", "had any").
# These are explicitly REJECTED (we don't even scan within 0-3 words).
#
# Adverb pass-through: we allow up to 3 "filler" tokens (typical
# adverbs / negators) between `had` and the participle, e.g.
# "had not yet seen", "had just barely managed", "had only briefly
# considered". We do NOT require these fillers to be -ly adverbs — we
# allow any token that is NOT itself a verb-form starter (we keep this
# permissive; over-strict filler matching would lose real participles).
# ----------------------------------------------------------------------

HAD_STOPWORDS = {
    # Determiners / articles / quantifiers — clear NP openers
    "a", "an", "the", "no", "some", "any", "many", "few", "several",
    "every", "each", "all", "both", "either", "neither", "much",
    "more", "most", "less", "fewer", "enough", "such",
    "this", "that", "these", "those",
    "his", "her", "hers", "its", "their", "theirs", "our", "ours",
    "my", "your", "yours", "mine",
    # Numerals as raw words
    "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "twelve", "twenty", "fifty", "hundred", "thousand",
    # Quasi-modal / fixed: "had to" = obligation; "had better" = modal;
    # "had rather" archaic modal.
    "to", "better", "rather",
    # Possessive uses with names/pronouns rare but include common.
    "him", "her", "them", "us", "me", "you",
}

# Explicit irregular past participles. Capture forms that don't fit
# any suffix rule.
IRREGULAR_PARTICIPLES = {
    "been", "had", "come", "become", "overcome", "run", "outrun",
    "done", "gone", "undergone", "won", "outwon",
    "thought", "fought", "brought", "bought", "caught", "taught",
    "sought", "wrought",
    "made", "remade", "unmade", "said", "paid", "laid", "led",
    "fled", "bled", "bred", "shed", "spread", "wed", "sped",
    "stood", "withstood", "understood", "misunderstood",
    "held", "withheld", "beheld", "upheld",
    "bound", "found", "wound", "ground", "rebound", "unwound",
    "hung", "sung", "rung", "sprung", "stung", "swung", "clung",
    "flung", "strung", "stunk", "sunk", "drunk", "shrunk", "slung",
    "wrung",
    "struck", "stuck", "shaken", "taken", "mistaken", "given",
    "forgiven", "eaten", "ridden", "written", "rewritten", "driven",
    "broken", "spoken", "stolen", "forgotten", "frozen", "chosen",
    "drawn", "flown", "grown", "known", "shown", "sworn", "worn",
    "torn", "fallen", "risen", "arisen", "borne", "forsworn",
    "blown", "bitten", "hidden", "beaten", "forbidden", "forsaken",
    "stricken", "thrown", "withdrawn", "outdrawn", "redrawn",
    "begotten", "gotten", "begun", "spun", "rewritten",
    "felt", "kept", "slept", "wept", "swept", "left", "lost",
    "meant", "dealt", "burnt", "learnt", "dreamt", "crept", "leapt",
    "knelt", "bent", "lent", "sent", "spent", "built", "dwelt",
    "spoilt", "spilt", "smelt", "lit", "met", "bit", "slit", "quit",
    "split", "shut", "spat", "shot", "got", "forgot", "set", "put",
    "cut", "let", "hit", "hurt", "cost", "burst", "thrust",
    "cast", "broadcast", "forecast", "miscast", "outcast",
    "read",  # past form is also "read"
    "sat", "lay", "lain", "swam", "swum", "sang",
    "saw", "seen",
    "heard", "rid", "shod", "trod", "trodden", "ridden", "smitten",
    "stridden", "thriven",
    "awoken", "awaken", "borne", "broadcast", "outshone", "shone",
}

# Past-participle suffix detector (regex). Checked AFTER irregular
# match. We require at least 3 chars to avoid noise.
PARTICIPLE_SUFFIX_RX = re.compile(
    r"^[A-Za-z]{2,}("
    r"ed|"      # walked, opened, hesitated, asked, gestured
    r"ied|"     # tried, denied, replied
    r"ked|"     # asked, walked, balked  (covered by 'ed' but kept explicit)
    r"en|"      # spoken, broken, taken, forgotten
    r"ne|"      # gone, done — but these are caught by IRREGULAR
    r"ought|"   # thought, brought, bought, fought, sought, wrought
    r"aught"    # caught, taught
    r")$",
    re.IGNORECASE,
)

# Suffix-collision blacklist (non-participles ending in -ed/-en/etc.
# that fire the suffix detector). Conservative: only words with very
# high certainty of being non-participles in `had ___` slot.
SUFFIX_COLLISION_BLACKLIST = {
    # -ed nouns / adjectives (NOT participles)
    "red", "bed", "bread", "forehead", "instead", "shed",
    # but `shed` is also a participle ("had shed blood") — so we
    # OMIT it from the blacklist.
    "fed", "wed", "led",
    # Actually `fed` `wed` `led` ARE participles. Re-omit.
    # The truly safe blacklist is very small:
    "thoroughbred", "watershed",
    # -en nouns / adjectives that aren't participles
    "men", "women", "children", "oxen", "brethren", "kindred",
    "garden", "wooden", "golden", "silken", "linen", "raven",
    "haven", "heaven", "siren", "even", "open", "olden",
    "broken",  # IS participle ("had broken") — keep OMITTED
}
# Resanitize: remove any blacklist entry that is a real irregular
# participle.
SUFFIX_COLLISION_BLACKLIST = SUFFIX_COLLISION_BLACKLIST - IRREGULAR_PARTICIPLES
# Also drop near-empty list of -ed/-en confusables that have legit
# participial use; we keep only the ones that virtually never appear
# as participles in this context.
SUFFIX_COLLISION_BLACKLIST = {
    "men", "women", "children", "oxen", "brethren",
    "garden", "wooden", "golden", "silken", "linen",
    "raven", "haven", "heaven", "siren", "open", "olden",
    "thoroughbred", "watershed", "instead", "forehead",
    "even",  # "had even" -- adverb, not participle
}


def is_past_participle(token):
    t = token.lower().strip(".,!?;:\"')(]}[{«»“”‘’")
    if not t or len(t) < 3:
        return False
    if t in SUFFIX_COLLISION_BLACKLIST:
        return False
    if t in IRREGULAR_PARTICIPLES:
        return True
    return bool(PARTICIPLE_SUFFIX_RX.match(t))


# Tokenize on whitespace + punctuation gaps, preserving order.
TOKEN_RX = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")


def find_past_perfect_occurrences(text):
    """Scan text for past-perfect constructions. Return list of
    (had_form, participle, gap, context_window) tuples for each hit.
    """
    if not text:
        return []
    tokens = TOKEN_RX.findall(text)
    # Lowercase for matching but keep original for context.
    lowers = [t.lower() for t in tokens]

    hits = []
    i = 0
    n = len(lowers)
    while i < n:
        tok = lowers[i]
        # Detect "had", "hadn't", or "had not" at position i
        if tok == "had":
            had_form = "had"
            start_after = i + 1
        elif tok == "hadn" and i + 1 < n and lowers[i + 1] == "t":
            # "hadn't" tokenized as ["hadn", "t"]
            had_form = "hadn't"
            start_after = i + 2
        elif tok == "hadn":
            # "hadn" preserved with '
            had_form = "hadn"
            start_after = i + 1
        else:
            i += 1
            continue

        # Handle "had not" -> shift start_after past "not"
        if had_form == "had" and start_after < n and lowers[start_after] == "not":
            had_form = "had not"
            start_after += 1

        # Stopword check at start_after (immediate next token)
        if start_after >= n:
            i = start_after
            continue
        next_tok = lowers[start_after]
        if next_tok in HAD_STOPWORDS:
            i = start_after
            continue

        # Search up to 3 tokens ahead for a participle
        # (start_after, start_after+1, start_after+2, start_after+3)
        gap = None
        participle = None
        for j in range(start_after, min(start_after + 4, n)):
            cand = lowers[j]
            if is_past_participle(cand):
                participle = cand
                gap = j - start_after
                break
            # Stop if we hit obvious sentence-end words / connectors
            # (keeps us from matching across clause boundaries that
            # tokenization missed)
            if cand in {"and", "but", "or", "so", "because", "when",
                        "while", "after", "before", "though", "although",
                        "yet"}:
                break

        if participle is not None:
            ctx_start = max(0, i - 2)
            ctx_end = min(n, j + 3)
            context = " ".join(tokens[ctx_start:ctx_end])
            hits.append({
                "had_form": had_form,
                "participle": participle,
                "gap": gap,
                "context": context,
                "i": i,
            })
            i = j + 1
        else:
            i = start_after

    return hits


# ----------------------------------------------------------------------
# Load corpus
# ----------------------------------------------------------------------
beats = []
with open(BEATS_PATH, "r", encoding="utf-8") as f:
    for line in f:
        beats.append(json.loads(line))

scenes = []
with open(SCENES_PATH, "r", encoding="utf-8") as f:
    for line in f:
        scenes.append(json.loads(line))

scene_boundary = {s["scene_id"]: s.get("boundary") for s in scenes}


def safe_pct(num, den):
    return round(100.0 * num / den, 2) if den else 0.0


def safe_per_100(num, den_words):
    """Return density per 100 words."""
    return round(100.0 * num / den_words, 4) if den_words else 0.0


def safe_ratio(num, den, ndigits=3):
    return round(num / den, ndigits) if den else None


# ----------------------------------------------------------------------
# Per-beat pass — count past-perfect + position + p54 marker presence
# ----------------------------------------------------------------------
labelled = []
for b in beats:
    text = b.get("text", "") or ""
    summary = b.get("summary", "") or ""
    # We deliberately scan ONLY the prose `text` for past-perfect (not
    # summary, which is paraphrase metadata and would over-count). We
    # use summary only when prose is empty (defensive — should not
    # happen in this corpus).
    haystack = text if text else summary

    hits = find_past_perfect_occurrences(haystack)

    sid = b.get("scene_id")
    s_boundary = scene_boundary.get(sid)
    is_first_in_scene = b.get("beat_idx") == 0

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

    has_p54 = beat_has_p54_marker(haystack)

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
        "n_pp_hits": len(hits),
        "pp_hits": hits,
        "has_p54_marker": has_p54,
    })


# ----------------------------------------------------------------------
# Aggregations
# ----------------------------------------------------------------------
def aggregate_density(rows):
    n_beats = len(rows)
    total_words = sum(r["words"] for r in rows)
    total_hits = sum(r["n_pp_hits"] for r in rows)
    beats_with_any = sum(1 for r in rows if r["n_pp_hits"] > 0)
    return {
        "n_beats": n_beats,
        "total_words": total_words,
        "total_pp_hits": total_hits,
        "beats_with_any_pp": beats_with_any,
        "beats_with_any_pct": safe_pct(beats_with_any, n_beats),
        "pp_per_100_words": safe_per_100(total_hits, total_words),
        "pp_per_beat": round(total_hits / n_beats, 4) if n_beats else 0.0,
    }


# Per-book aggregates
per_book = {}
for book in BOOKS_IN_ORDER:
    rows = [r for r in labelled if r["book"] == book]
    agg = aggregate_density(rows)
    # Top participles per book
    pcount = Counter()
    had_form_count = Counter()
    gap_count = Counter()
    for r in rows:
        for h in r["pp_hits"]:
            pcount[h["participle"]] += 1
            had_form_count[h["had_form"]] += 1
            gap_count[h["gap"]] += 1
    agg["top_participles"] = pcount.most_common(15)
    agg["had_form_distribution"] = dict(had_form_count)
    agg["gap_distribution"] = dict(gap_count)
    per_book[book] = agg


# Per-kind (collapsed across all books) + per-kind-per-book
def kind_breakdown(rows_filter):
    out = {}
    kinds = sorted({r["kind"] for r in labelled if r["kind"]})
    for kind in kinds:
        krows = [r for r in labelled if r["kind"] == kind and rows_filter(r)]
        out[kind] = aggregate_density(krows)
    return out


per_kind_aggregate = kind_breakdown(lambda r: True)

per_kind_per_book = {}
for book in BOOKS_IN_ORDER:
    per_kind_per_book[book] = kind_breakdown(lambda r, _b=book: r["book"] == _b)


# Per-position (chapter-open vs scene-bounded vs scene-unbounded vs
# chapter-close vs chapter-internal). Aggregate + per-book.
def position_breakdown(rows_filter):
    positions = ["chapter-open", "scene-bounded", "scene-unbounded",
                 "chapter-close", "chapter-internal"]
    out = {}
    for pos in positions:
        prows = [r for r in labelled if r["position"] == pos and rows_filter(r)]
        out[pos] = aggregate_density(prows)
    return out


position_aggregate = position_breakdown(lambda r: True)
position_per_book = {b: position_breakdown(lambda r, _b=b: r["book"] == _b)
                     for b in BOOKS_IN_ORDER}


# Boundary vs internal helper (combine all "first-of-scene" buckets)
def boundary_vs_internal(scope):
    boundary_n = sum(scope[p]["n_beats"] for p in
                     ["chapter-open", "scene-bounded", "scene-unbounded", "chapter-close"])
    boundary_w = sum(scope[p]["total_words"] for p in
                     ["chapter-open", "scene-bounded", "scene-unbounded", "chapter-close"])
    boundary_h = sum(scope[p]["total_pp_hits"] for p in
                     ["chapter-open", "scene-bounded", "scene-unbounded", "chapter-close"])
    internal = scope["chapter-internal"]
    return {
        "boundary": {
            "n_beats": boundary_n,
            "total_words": boundary_w,
            "total_pp_hits": boundary_h,
            "pp_per_100_words": safe_per_100(boundary_h, boundary_w),
        },
        "internal": {
            "n_beats": internal["n_beats"],
            "total_words": internal["total_words"],
            "total_pp_hits": internal["total_pp_hits"],
            "pp_per_100_words": internal["pp_per_100_words"],
        },
        "ratio_boundary_over_internal": safe_ratio(
            safe_per_100(boundary_h, boundary_w),
            internal["pp_per_100_words"],
        ),
    }


position_aggregate["__boundary_vs_internal__"] = boundary_vs_internal(position_aggregate)
for book in BOOKS_IN_ORDER:
    position_per_book[book]["__boundary_vs_internal__"] = boundary_vs_internal(position_per_book[book])


# Chapter-open spike check — chapter-open vs chapter-internal density,
# per book and aggregate. Spec gate: chapter-open density >= 1.3x
# internal in 3/3.
def chapter_open_vs_internal(scope):
    co = scope["chapter-open"]
    ci = scope["chapter-internal"]
    ratio = safe_ratio(co["pp_per_100_words"], ci["pp_per_100_words"])
    return {
        "chapter_open_per_100": co["pp_per_100_words"],
        "chapter_internal_per_100": ci["pp_per_100_words"],
        "ratio": ratio,
        "spike_ge_1_3": ratio is not None and ratio >= 1.3,
    }


def chapter_close_vs_internal(scope):
    cc = scope["chapter-close"]
    ci = scope["chapter-internal"]
    ratio = safe_ratio(cc["pp_per_100_words"], ci["pp_per_100_words"])
    return {
        "chapter_close_per_100": cc["pp_per_100_words"],
        "chapter_internal_per_100": ci["pp_per_100_words"],
        "ratio": ratio,
        "spike_ge_1_3": ratio is not None and ratio >= 1.3,
    }


def boundary_vs_internal_gate_check(scope):
    bvi = scope["__boundary_vs_internal__"]
    ratio = bvi["ratio_boundary_over_internal"]
    return {
        "boundary_per_100": bvi["boundary"]["pp_per_100_words"],
        "internal_per_100": bvi["internal"]["pp_per_100_words"],
        "ratio": ratio,
        "spike_ge_1_3": ratio is not None and ratio >= 1.3,
    }


chapter_open_aggregate = chapter_open_vs_internal(position_aggregate)
chapter_open_per_book = {b: chapter_open_vs_internal(position_per_book[b])
                         for b in BOOKS_IN_ORDER}

chapter_close_aggregate = chapter_close_vs_internal(position_aggregate)
chapter_close_per_book = {b: chapter_close_vs_internal(position_per_book[b])
                          for b in BOOKS_IN_ORDER}

boundary_gate_aggregate = boundary_vs_internal_gate_check(position_aggregate)
boundary_gate_per_book = {b: boundary_vs_internal_gate_check(position_per_book[b])
                          for b in BOOKS_IN_ORDER}


# ----------------------------------------------------------------------
# P54 pairing analysis
# ----------------------------------------------------------------------
def p54_pairing(rows_filter):
    with_marker = [r for r in labelled if r["has_p54_marker"] and rows_filter(r)]
    without_marker = [r for r in labelled if not r["has_p54_marker"] and rows_filter(r)]
    agg_with = aggregate_density(with_marker)
    agg_without = aggregate_density(without_marker)
    return {
        "with_p54_marker": agg_with,
        "without_p54_marker": agg_without,
        "ratio_density_with_over_without": safe_ratio(
            agg_with["pp_per_100_words"],
            agg_without["pp_per_100_words"],
        ),
    }


p54_pairing_aggregate = p54_pairing(lambda r: True)
p54_pairing_per_book = {b: p54_pairing(lambda r, _b=b: r["book"] == _b)
                        for b in BOOKS_IN_ORDER}


# ----------------------------------------------------------------------
# Cross-book stability
# ----------------------------------------------------------------------
# Per-kind ordering: rank kinds by pp_per_100_words within each book.
# Compute the top-2 kinds per book and check intersection.
kind_ranking_per_book = {}
for book in BOOKS_IN_ORDER:
    ranks = sorted(
        [(k, per_kind_per_book[book][k]["pp_per_100_words"])
         for k in per_kind_per_book[book]
         if per_kind_per_book[book][k]["n_beats"] >= 5],
        key=lambda x: -x[1],
    )
    kind_ranking_per_book[book] = ranks

# Top-2 per book and intersection
top2_per_book = {b: [k for k, _ in kind_ranking_per_book[b][:2]] for b in BOOKS_IN_ORDER}
top2_intersection_3way = (
    set(top2_per_book["crystal_shard"])
    & set(top2_per_book["streams_of_silver"])
    & set(top2_per_book["halflings_gem"])
)
# Strict gate: top-2 set IDENTICAL across all 3 books
top2_identical_3of3 = (
    set(top2_per_book["crystal_shard"])
    == set(top2_per_book["streams_of_silver"])
    == set(top2_per_book["halflings_gem"])
)

# Top-1 per book
top1_per_book = {b: kind_ranking_per_book[b][0][0] if kind_ranking_per_book[b] else None
                 for b in BOOKS_IN_ORDER}
top1_identical_3of3 = (top1_per_book["crystal_shard"]
                       == top1_per_book["streams_of_silver"]
                       == top1_per_book["halflings_gem"])

# Density spread per 100w across books
densities = [per_book[b]["pp_per_100_words"] for b in BOOKS_IN_ORDER]
d_min, d_max = min(densities), max(densities)
density_spread = (d_max - d_min) / d_min if d_min else float("inf")

# Chapter-open spike: gate is >=1.3x in 3/3 (per spec)
spike_holds_per_book = {b: chapter_open_per_book[b]["spike_ge_1_3"]
                        for b in BOOKS_IN_ORDER}
spike_holds_count = sum(1 for v in spike_holds_per_book.values() if v)

# Bonus structural gates (post-hoc — not in spec verdict gate but
# captured for the lever decision):
#   * chapter-close >= 1.3x internal in 3/3 — alternative recap site
#   * boundary (open + close + scene-bounded + scene-unbounded) >=
#     1.3x internal in 3/3 — broadly "narrator at structural seam"
close_spike_holds_per_book = {b: chapter_close_per_book[b]["spike_ge_1_3"]
                              for b in BOOKS_IN_ORDER}
close_spike_holds_count = sum(1 for v in close_spike_holds_per_book.values() if v)

boundary_spike_holds_per_book = {b: boundary_gate_per_book[b]["spike_ge_1_3"]
                                 for b in BOOKS_IN_ORDER}
boundary_spike_holds_count = sum(1 for v in boundary_spike_holds_per_book.values() if v)


# ----------------------------------------------------------------------
# Verdict
# ----------------------------------------------------------------------
# Spec gate:
#   PASS         — top-2 ordering reproduces 3/3 books AND chapter-
#                  open spike (>=1.3x) reproduces 3/3
#   PASS_PARTIAL — 2/3 reproduce
#   DIVERGE      — different orderings or no spike
#   KILL         — no signal

# Top-2 cross-book reproduction count: how many books share top-2 with
# the modal top-2? Use the modal set (most common pair) and count how
# many books match.
top2_sets = [tuple(sorted(top2_per_book[b])) for b in BOOKS_IN_ORDER]
top2_set_counter = Counter(top2_sets)
modal_top2_set, modal_top2_count = top2_set_counter.most_common(1)[0]
top2_books_matching_modal = modal_top2_count  # 1, 2, or 3

# Pass-criteria:
top2_pass_3of3 = top2_books_matching_modal == 3
spike_pass_3of3 = spike_holds_count == 3

if top2_pass_3of3 and spike_pass_3of3:
    verdict = "PASS"
    verdict_note = (
        "Per-kind top-2 ordering reproduces 3/3 books AND chapter-open "
        f">=1.3x internal spike reproduces 3/3 (top-2 set: {sorted(modal_top2_set)})."
    )
elif (top2_books_matching_modal >= 2 and spike_holds_count >= 2):
    verdict = "PASS_PARTIAL"
    verdict_note = (
        f"Top-2 ordering matches {top2_books_matching_modal}/3 books; "
        f"chapter-open spike holds in {spike_holds_count}/3. At least one "
        f"axis reproduces 3/3 but not both."
    )
elif top2_books_matching_modal >= 2 or spike_holds_count >= 2:
    verdict = "PASS_PARTIAL"
    verdict_note = (
        f"Mixed: top-2 ordering {top2_books_matching_modal}/3, "
        f"spike {spike_holds_count}/3. One axis weakly stable, the other diverges."
    )
elif sum(per_book[b]["total_pp_hits"] for b in BOOKS_IN_ORDER) >= 100:
    verdict = "DIVERGE"
    verdict_note = (
        "Past-perfect occurs in volume but per-kind ordering and chapter-open "
        "spike both vary across books — no clean shippable prior."
    )
else:
    verdict = "KILL"
    verdict_note = "Past-perfect volume too low or no consistent signal."


# ----------------------------------------------------------------------
# Spot-check examples
# ----------------------------------------------------------------------
def examples_at_position(position, k=5):
    rows = [r for r in labelled if r["position"] == position and r["n_pp_hits"] > 0]
    return [
        {
            "scene_id": r["scene_id"],
            "book": r["book"],
            "chapter": r["chapter"],
            "kind": r["kind"],
            "words": r["words"],
            "n_pp_hits": r["n_pp_hits"],
            "examples": [{"had_form": h["had_form"],
                          "participle": h["participle"],
                          "gap": h["gap"],
                          "context": h["context"]}
                         for h in r["pp_hits"][:3]],
        }
        for r in rows[:k]
    ]


def examples_for_kind(kind, k=5):
    rows = [r for r in labelled if r["kind"] == kind and r["n_pp_hits"] > 0]
    return [
        {
            "scene_id": r["scene_id"],
            "book": r["book"],
            "chapter": r["chapter"],
            "words": r["words"],
            "n_pp_hits": r["n_pp_hits"],
            "examples": [{"had_form": h["had_form"],
                          "participle": h["participle"],
                          "gap": h["gap"],
                          "context": h["context"]}
                         for h in r["pp_hits"][:3]],
        }
        for r in rows[:k]
    ]


examples = {
    "chapter_open_examples": examples_at_position("chapter-open", k=6),
    "scene_bounded_examples": examples_at_position("scene-bounded", k=4),
    "chapter_internal_examples": examples_at_position("chapter-internal", k=4),
    "interiority_examples": examples_for_kind("interiority", k=5),
    "dialogue_examples": examples_for_kind("dialogue", k=5),
    "action_examples": examples_for_kind("action", k=5),
    "description_examples": examples_for_kind("description", k=5),
}


# ----------------------------------------------------------------------
# Build payload
# ----------------------------------------------------------------------
payload = {
    "pattern": 55,
    "name": "Past-perfect ('had X-ed') density distribution",
    "corpus": "salvatore-icewind-dale (3 books)",
    "method": {
        "labeler": (
            "Token-level scan: detect 'had' / 'hadn't' / 'had not' "
            "followed within 0-3 tokens by an explicit irregular past "
            "participle (curated set ~180 forms) OR a token matching "
            "PARTICIPLE_SUFFIX_RX (-ed, -ied, -en, -ne, -ought, -aught), "
            "with a small SUFFIX_COLLISION_BLACKLIST. Stopword filter "
            "rejects 'had' followed by a determiner / quantifier / "
            "common NP opener (a, an, the, no, some, to, ...). Permits "
            "0-3 filler tokens (typical adverbs / negators) between "
            "'had' and the participle, with early-stop on conjunctions "
            "to avoid clause crossing."
        ),
        "scope": "prose `text` field only (summary excluded); per-beat findall, all hits sum",
        "had_stopwords_count": len(HAD_STOPWORDS),
        "irregular_participles_count": len(IRREGULAR_PARTICIPLES),
        "suffix_collision_blacklist_count": len(SUFFIX_COLLISION_BLACKLIST),
        "max_gap_tokens": 3,
        "p54_lexicon_terms": len(P54_ALL),
        "stability_gates": {
            "top2_kind_ordering": "top-2 kinds by density per 100w identical across 3/3 books",
            "chapter_open_spike": "chapter-open density >= 1.3x chapter-internal density, in 3/3 books",
        },
    },
    "n_beats_total": len(labelled),
    "n_beats_per_book": {b: per_book[b]["n_beats"] for b in BOOKS_IN_ORDER},
    "aggregate": aggregate_density(labelled),
    "per_book": per_book,
    "per_kind_aggregate": per_kind_aggregate,
    "per_kind_per_book": per_kind_per_book,
    "position_aggregate": position_aggregate,
    "position_per_book": position_per_book,
    "chapter_open_vs_internal_aggregate": chapter_open_aggregate,
    "chapter_open_vs_internal_per_book": chapter_open_per_book,
    "chapter_close_vs_internal_aggregate": chapter_close_aggregate,
    "chapter_close_vs_internal_per_book": chapter_close_per_book,
    "boundary_vs_internal_gate_aggregate": boundary_gate_aggregate,
    "boundary_vs_internal_gate_per_book": boundary_gate_per_book,
    "structural_spike_summary": {
        "chapter_open_spike_holds_per_book": spike_holds_per_book,
        "chapter_open_spike_holds_count": spike_holds_count,
        "chapter_close_spike_holds_per_book": close_spike_holds_per_book,
        "chapter_close_spike_holds_count": close_spike_holds_count,
        "boundary_spike_holds_per_book": boundary_spike_holds_per_book,
        "boundary_spike_holds_count": boundary_spike_holds_count,
    },
    "p54_pairing_aggregate": p54_pairing_aggregate,
    "p54_pairing_per_book": p54_pairing_per_book,
    "cross_book_stability": {
        "kind_ranking_per_book": {b: kind_ranking_per_book[b] for b in BOOKS_IN_ORDER},
        "top1_per_book": top1_per_book,
        "top1_identical_3of3": top1_identical_3of3,
        "top2_per_book": top2_per_book,
        "top2_set_per_book": {b: list(top2_sets[i]) for i, b in enumerate(BOOKS_IN_ORDER)},
        "top2_intersection_3way": sorted(top2_intersection_3way),
        "top2_identical_3of3": top2_identical_3of3,
        "modal_top2_set": list(modal_top2_set),
        "top2_books_matching_modal": top2_books_matching_modal,
        "spike_ge_1_3_per_book": spike_holds_per_book,
        "spike_holds_count": spike_holds_count,
        "densities_per_100": dict(zip(BOOKS_IN_ORDER, densities)),
        "density_min_per_100": d_min,
        "density_max_per_100": d_max,
        "density_spread_fraction_max_over_min": round(density_spread, 3),
    },
    "verdict": verdict,
    "verdict_note": verdict_note,
    "examples": examples,
}


os.makedirs(OUT_DIR, exist_ok=True)
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)

print(f"Wrote {OUT_PATH}")
print(f"n_beats: {len(labelled)}")
print(f"aggregate hits: {payload['aggregate']['total_pp_hits']}")
print(f"aggregate density per 100w: {payload['aggregate']['pp_per_100_words']}")
print()
print("Per-book densities (per 100w):")
for b in BOOKS_IN_ORDER:
    pb = per_book[b]
    print(f"  {b}: density={pb['pp_per_100_words']}/100w | beats_with_any={pb['beats_with_any_pct']}% | n_hits={pb['total_pp_hits']}")

print()
print("Per-kind aggregate density (per 100w):")
for kind in sorted(per_kind_aggregate.keys()):
    pk = per_kind_aggregate[kind]
    print(f"  {kind:24s} {pk['pp_per_100_words']}/100w | n_beats={pk['n_beats']} | n_hits={pk['total_pp_hits']}")

print()
print("Per-kind per-book density (per 100w):")
header = f"  {'kind':24s} | " + " | ".join(f"{b:18s}" for b in BOOKS_IN_ORDER)
print(header)
for kind in sorted(per_kind_aggregate.keys()):
    cells = []
    for b in BOOKS_IN_ORDER:
        pk = per_kind_per_book[b][kind]
        cells.append(f"{pk['pp_per_100_words']:5.3f} (n={pk['n_beats']:3d})")
    print(f"  {kind:24s} | " + " | ".join(f"{c:18s}" for c in cells))

print()
print("Top-1 per book:", top1_per_book)
print("Top-2 per book:", top2_per_book)
print("Top-2 books matching modal:", top2_books_matching_modal)

print()
print("Chapter-open vs internal spike per book (spec gate):")
for b in BOOKS_IN_ORDER:
    co = chapter_open_per_book[b]
    print(f"  {b}: open={co['chapter_open_per_100']}/100w internal={co['chapter_internal_per_100']}/100w ratio={co['ratio']} spike_ge_1.3={co['spike_ge_1_3']}")

print()
print("Chapter-CLOSE vs internal spike per book (post-hoc bonus gate):")
for b in BOOKS_IN_ORDER:
    cc = chapter_close_per_book[b]
    print(f"  {b}: close={cc['chapter_close_per_100']}/100w internal={cc['chapter_internal_per_100']}/100w ratio={cc['ratio']} spike_ge_1.3={cc['spike_ge_1_3']}")
print(f"  -> chapter-close spike >= 1.3x internal holds in {close_spike_holds_count}/3 books")

print()
print("BOUNDARY (any first-of-scene) vs internal spike per book (post-hoc bonus gate):")
for b in BOOKS_IN_ORDER:
    bg = boundary_gate_per_book[b]
    print(f"  {b}: boundary={bg['boundary_per_100']}/100w internal={bg['internal_per_100']}/100w ratio={bg['ratio']} spike_ge_1.3={bg['spike_ge_1_3']}")
print(f"  -> boundary spike >= 1.3x internal holds in {boundary_spike_holds_count}/3 books")

print()
print("P54 pairing — density when P54 marker present vs absent:")
agg = p54_pairing_aggregate
print(f"  aggregate: with={agg['with_p54_marker']['pp_per_100_words']}/100w "
      f"(n={agg['with_p54_marker']['n_beats']}) "
      f"vs without={agg['without_p54_marker']['pp_per_100_words']}/100w "
      f"(n={agg['without_p54_marker']['n_beats']}) "
      f"ratio={agg['ratio_density_with_over_without']}")
for b in BOOKS_IN_ORDER:
    pb = p54_pairing_per_book[b]
    print(f"  {b}: with={pb['with_p54_marker']['pp_per_100_words']}/100w "
          f"(n={pb['with_p54_marker']['n_beats']}) "
          f"vs without={pb['without_p54_marker']['pp_per_100_words']}/100w "
          f"ratio={pb['ratio_density_with_over_without']}")

print()
print(f"VERDICT: {verdict}")
print(f"  note: {verdict_note}")
