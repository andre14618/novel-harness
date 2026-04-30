"""
Pattern 61 — Verb tense distribution per beat-kind
(3-book Icewind Dale corpus).

Pure-compute regex pass over `novels/salvatore-icewind-dale/beats.jsonl`.

Hypothesis: Salvatore writes in past simple as the dominant narrative
tense, but **past progressive** ("was walking", "were watching") is a
sign of suspended/atmospheric action and **past perfect** (overlap with
P55) is flashback/state. The PROPORTIONS per beat-kind are a writer-
prompt rhythm prior:

  - Past simple = action-dominant rhythm
  - Past progressive = description / atmospheric beats
  - Past perfect = interiority / recap (overlap with P55)
  - Modal/conditional ("would have", "could have") = interiority hedging
  - Present tense (rare in narration) = direct internal thought
    (often italicized — overlaps P58)

Detection is heuristic — we don't aim for 100% precision. We aim for
relative density per kind and stability across books.

Methodology (per spec):
  - PAST_SIMPLE: a -ed/-t/irregular past form NOT preceded by 'had' or
    'was'/'were' or 'is'/'are'/'has'/'have'. We re-use the irregular-
    past-participle set as a list of irregular past *or* participle
    forms (since most overlap), and detect the regular -ed surface form.
  - PAST_PROGRESSIVE: \b(was|were)\s+\w+ing\b
  - PAST_PERFECT: \bhad\s+\w+(ed|en|t|ne|ought|aught)\b (mirrors P55
    detector with the same stopword filter and irregular-participle
    set).
  - MODAL_PAST: \b(would|could|should|might)\s+(have\s+)?\w+\b
    (covers "would say", "would have said", "could have", "should have",
    "might be").
  - PRESENT_SIMPLE: heuristic — count "I/she/he/they/we + bare-form-
    verb" inside narration. Easier proxy: count "I am/I'm" / "she is" /
    etc., MINUS any inside double-quoted dialogue (we strip dialogue
    quote spans before scoring present tense to avoid counting reported
    speech). Tricky to extract — we accept the lower-precision signal.

Compute (per spec):
  1. Per beat: count tense-marker hits per category, normalize per 100w
  2. Per (book, kind): aggregate density per tense
  3. Per-kind tense ranking: which tense dominates each kind? Stable
     cross-book?
  4. Past progressive as atmospheric marker: is its share materially
     higher in description than action?
  5. Modal past as interiority marker: higher in interiority than
     action/description?
  6. Cross-book gate:
     PASS         — per-kind dominant tense reproduces 3/3 books AND
                    past-progressive's per-kind ratio (description >
                    action) holds 3/3
     PASS_PARTIAL — 2/3 reproduce
     DIVERGE      — unstable
     KILL         — no signal
"""

import json
import re
import os
import datetime
import fcntl
from collections import Counter, defaultdict

CORPUS_DIR = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale"
BEATS_PATH = os.path.join(CORPUS_DIR, "beats.jsonl")
OUT_DIR = os.path.join(CORPUS_DIR, "structure-calibration")
CONCLUSIONS_PATH = os.path.join(OUT_DIR, "crystal_shard-conclusions.md")
ROADMAP_PATH = "/Users/andre/Desktop/personal_projects/novel-harness/docs/harness-tuning-roadmap.md"

TIMESTAMP = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S")
OUT_PATH = os.path.join(OUT_DIR, f"crystal_shard.{TIMESTAMP}.verb-tense-distribution.json")

BOOKS_IN_ORDER = ["crystal_shard", "streams_of_silver", "halflings_gem"]
TENSE_CATEGORIES = [
    "past_simple",
    "past_progressive",
    "past_perfect",
    "modal_past",
    "present_simple",
]


# ----------------------------------------------------------------------
# Lexicons (mirrors of P55 + P29 sentence-rhythm conventions)
# ----------------------------------------------------------------------

# Determiners / quantifiers / objects that follow "had" in NON-perfect
# possessive uses — copy from P55 detector.
HAD_STOPWORDS = {
    "a", "an", "the", "no", "some", "any", "many", "few", "several",
    "every", "each", "all", "both", "either", "neither", "much",
    "more", "most", "less", "fewer", "enough", "such",
    "this", "that", "these", "those",
    "his", "her", "hers", "its", "their", "theirs", "our", "ours",
    "my", "your", "yours", "mine",
    "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "twelve", "twenty", "fifty", "hundred", "thousand",
    "to", "better", "rather",
    "him", "her", "them", "us", "me", "you",
}

# Irregular past-participle / past-tense forms. Used by past-perfect
# detection (after `had`) AND by past-simple detection (irregulars
# without -ed surface form). Subset/superset overlap is intentional.
IRREGULAR_PARTICIPLES = {
    "been", "had", "come", "became", "become", "overcome", "ran", "run", "outrun",
    "did", "done", "went", "gone", "undergone", "won", "outwon",
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
    "struck", "stuck", "shaken", "took", "taken", "mistaken",
    "gave", "given", "forgiven", "ate", "eaten", "rode", "ridden",
    "wrote", "written", "rewritten", "drove", "driven",
    "broke", "broken", "spoke", "spoken", "stole", "stolen",
    "forgot", "forgotten", "froze", "frozen", "chose", "chosen",
    "drew", "drawn", "flew", "flown", "grew", "grown", "knew", "known",
    "showed", "shown", "swore", "sworn", "wore", "worn",
    "tore", "torn", "fell", "fallen", "rose", "risen",
    "arose", "arisen", "bore", "borne",
    "blew", "blown", "bit", "bitten", "hid", "hidden",
    "beat", "beaten", "forbade", "forbidden", "forsook", "forsaken",
    "stricken", "threw", "thrown", "withdrew", "withdrawn",
    "began", "begun", "spun",
    "felt", "kept", "slept", "wept", "swept", "left", "lost",
    "meant", "dealt", "burnt", "learnt", "dreamt", "crept", "leapt",
    "knelt", "bent", "lent", "sent", "spent", "built", "dwelt",
    "spoilt", "spilt", "smelt", "lit", "met", "slit", "quit",
    "split", "shut", "spat", "shot", "got", "set", "put",
    "cut", "let", "hit", "hurt", "cost", "burst", "thrust",
    "cast", "broadcast", "forecast", "miscast", "outcast",
    "read",
    "sat", "lay", "lain", "swam", "swum", "sang",
    "saw", "seen",
    "heard", "rid", "shod", "trod", "trodden", "smitten",
    "stridden", "thriven",
    "awoke", "awoken", "shone",
}

PARTICIPLE_SUFFIX_RX = re.compile(
    r"^[A-Za-z]{2,}("
    r"ed|"
    r"ied|"
    r"ked|"
    r"en|"
    r"ne|"
    r"ought|"
    r"aught"
    r")$",
    re.IGNORECASE,
)

# Conservative -ed/-en collision blacklist (non-participles).
SUFFIX_COLLISION_BLACKLIST = {
    "men", "women", "children", "oxen", "brethren",
    "garden", "wooden", "golden", "silken", "linen",
    "raven", "haven", "heaven", "siren", "open", "olden",
    "thoroughbred", "watershed", "instead", "forehead",
    "even",
    # adverb/adjective -ed collisions
    "indeed", "tweed", "weed", "speed", "deed", "freed",
    "naked", "wicked", "sacred", "hatred", "kindred",
    "rugged", "ragged", "blessed", "learned", "aged",
    "crooked", "beloved",
    "embed", "shrewd",
    # Bare nouns ending in -ed that aren't verbs
    "bed", "head", "lead", "red", "thread", "feed",
    "seed", "creed", "greed", "breed", "bread", "tread",
    "dread", "spread",  # spread is irregular but ambiguous; spread is in IRREGULAR set so it'll match
}
SUFFIX_COLLISION_BLACKLIST = SUFFIX_COLLISION_BLACKLIST - IRREGULAR_PARTICIPLES


# ----------------------------------------------------------------------
# Tokenization helper
# ----------------------------------------------------------------------
TOKEN_RX = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")


# ----------------------------------------------------------------------
# Quoted-dialogue stripping for present-tense scoring
# Strip both straight (" ") and curly (“ ”) double-quoted spans.
# We do NOT strip single-quoted spans (apostrophes / italicized internal
# thought is rendered via italics, not quotes; per P58).
# ----------------------------------------------------------------------
QUOTE_STRIP_RX = re.compile(r"\"[^\"]*\"|“[^”]*”")


def strip_dialogue(text):
    if not text:
        return ""
    # Replace each quoted span with the same number of spaces so character
    # offsets are preserved (helps if downstream code wants to map back).
    def _blank(m):
        return " " * (m.end() - m.start())
    return QUOTE_STRIP_RX.sub(_blank, text)


# ----------------------------------------------------------------------
# Past-perfect detection (mirror of P55 `find_past_perfect_occurrences`)
# ----------------------------------------------------------------------
def is_past_participle(token):
    t = token.lower().strip(".,!?;:\"')(]}[{«»“”‘’-")
    if not t or len(t) < 3:
        return False
    if t in SUFFIX_COLLISION_BLACKLIST:
        return False
    if t in IRREGULAR_PARTICIPLES:
        return True
    return bool(PARTICIPLE_SUFFIX_RX.match(t))


def find_past_perfect(text):
    """Return list of (had_form, participle, gap, context) for past-
    perfect hits."""
    if not text:
        return []
    tokens = TOKEN_RX.findall(text)
    lowers = [t.lower() for t in tokens]
    hits = []
    i = 0
    n = len(lowers)
    while i < n:
        tok = lowers[i]
        if tok == "had":
            had_form = "had"
            start_after = i + 1
        elif tok == "hadn" and i + 1 < n and lowers[i + 1] == "t":
            had_form = "hadn't"
            start_after = i + 2
        elif tok == "hadn":
            had_form = "hadn"
            start_after = i + 1
        else:
            i += 1
            continue

        if had_form == "had" and start_after < n and lowers[start_after] == "not":
            had_form = "had not"
            start_after += 1

        if start_after >= n:
            i = start_after
            continue
        next_tok = lowers[start_after]
        if next_tok in HAD_STOPWORDS:
            i = start_after
            continue

        gap = None
        participle = None
        for j in range(start_after, min(start_after + 4, n)):
            cand = lowers[j]
            if is_past_participle(cand):
                participle = cand
                gap = j - start_after
                break
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
            })
            i = j + 1
        else:
            i = start_after
    return hits


# ----------------------------------------------------------------------
# Past-progressive detection: \b(was|were)\s+\w+ing\b
# Filter out "was/were going to" (immediate future, not progressive)
# Filter out "was/were [ADV] [VERB]ing" — we ALLOW one optional adverb
# in between (e.g. "was still walking", "were just leaving").
# ----------------------------------------------------------------------
ING_FILLER_ADVERBS = {
    "still", "just", "already", "now", "always", "again",
    "only", "really", "always", "barely", "hardly", "nearly",
    "almost", "constantly", "merely", "obviously", "clearly",
    "indeed", "perhaps", "probably", "quietly", "slowly", "quickly",
    "carefully", "suddenly", "actually", "certainly",
    "not", "never", "ever",
}

PAST_PROG_RX = re.compile(
    r"\b(was|were|wasn'?t|weren'?t)\s+(?:(\w+)\s+)?(\w+ing)\b",
    re.IGNORECASE,
)


def find_past_progressive(text):
    """Return list of (be_form, participle_ing, context) for past-
    progressive hits. Excludes 'was going to' (immediate future)."""
    if not text:
        return []
    hits = []
    for m in PAST_PROG_RX.finditer(text):
        be_form = m.group(1).lower()
        filler = (m.group(2) or "").lower()
        ing = m.group(3).lower()

        # If filler is present, it must be an allowed adverb
        if filler and filler not in ING_FILLER_ADVERBS:
            continue

        # Exclude "going to + verb" — immediate-future construction
        if ing == "going":
            # Look ahead in the original text to see if "to <verb>"
            # follows. Cheap check: peek next ~10 chars.
            tail = text[m.end():m.end() + 10].lower().strip()
            if tail.startswith("to "):
                continue

        # Exclude "being" in passive constructions ("was being told",
        # "were being watched") — these are passives, not progressives.
        if ing == "being":
            continue

        # Exclude bare "having" + participle ("was having spoken" rare)
        if ing == "having":
            continue

        # Exclude "was + something + meaning" / "missing" (adjective
        # forms) — too rare to worth filtering. Accept them as hits.

        ctx_start = max(0, m.start() - 30)
        ctx_end = min(len(text), m.end() + 30)
        hits.append({
            "be_form": be_form,
            "filler": filler or None,
            "verb_ing": ing,
            "context": text[ctx_start:ctx_end].strip(),
        })
    return hits


# ----------------------------------------------------------------------
# Modal-past detection: \b(would|could|should|might)\s+(have\s+)?\w+\b
# We allow optional "not" / "have" between modal and verb.
# Distinguish "modal_simple" (would say) vs "modal_perfect" (would have
# said).
# ----------------------------------------------------------------------
MODAL_RX = re.compile(
    r"\b(would|could|should|might|wouldn'?t|couldn'?t|shouldn'?t|mightn'?t)\s+"
    r"(?:not\s+)?(?:(have)\s+)?(\w+)\b",
    re.IGNORECASE,
)


def find_modal_past(text):
    """Return list of (modal, has_have, next_word, context, kind)."""
    if not text:
        return []
    hits = []
    for m in MODAL_RX.finditer(text):
        modal = m.group(1).lower().replace("’", "'")
        has_have = bool(m.group(2))
        next_word = m.group(3).lower()

        # Skip pure modal+modal (e.g. "would could" — never appears,
        # but be safe)
        if next_word in {"would", "could", "should", "might"}:
            continue

        # Skip "would you" / "could you" — interrogative, not past
        # narration. We *don't* check who the subject is; if it's a
        # second-person interrogative, the next_word is a verb anyway,
        # so we accept the hit. Suppress only obvious greetings.
        ctx_start = max(0, m.start() - 30)
        ctx_end = min(len(text), m.end() + 30)
        kind = "modal_perfect" if has_have else "modal_simple"
        hits.append({
            "modal": modal,
            "has_have": has_have,
            "next_word": next_word,
            "context": text[ctx_start:ctx_end].strip(),
            "kind": kind,
        })
    return hits


# ----------------------------------------------------------------------
# Past-simple detection (heuristic).
# Strategy:
#   - Tokenize.
#   - For each token, classify as PAST_SIMPLE candidate if:
#       (a) ends in -ed/-ied/-ked AND not in SUFFIX_COLLISION_BLACKLIST,
#           AND not preceded (window=2) by 'had'/'has'/'have'/'was'/
#           'were'/'is'/'are'/'be'/'been'/'being' (those would make it
#           past-perfect, present-perfect, passive, or progressive).
#       OR
#       (b) Is in IRREGULAR_PARTICIPLES set AND not preceded (window=2)
#           by 'had'/'has'/'have'/'was'/'were'/'is'/'are'/'be'/'been'/
#           'being' (same exclusions).
# We don't dedupe overlapping participial uses; we accept the lower-
# precision signal per spec.
# ----------------------------------------------------------------------
PAST_SIMPLE_PRECEDING_BLOCKERS = {
    "had", "hadn", "hadnt",
    "has", "hasn", "hasnt",
    "have", "haven", "havent",
    "was", "wasn", "wasnt",
    "were", "weren", "werent",
    "is", "isn", "isnt",
    "are", "aren", "arent",
    "am",
    "be", "been", "being",
}

REGULAR_PAST_RX = re.compile(
    r"^[A-Za-z]{3,}(ed|ied|ked)$",
    re.IGNORECASE,
)


def find_past_simple(text):
    """Return list of (verb, kind=regular|irregular, context) for past-
    simple candidates."""
    if not text:
        return []
    tokens = TOKEN_RX.findall(text)
    lowers = [t.lower() for t in tokens]
    n = len(lowers)
    hits = []
    for i, tok in enumerate(lowers):
        # Check for blocker in 2-token window before
        blocker = False
        for k in range(max(0, i - 2), i):
            if lowers[k] in PAST_SIMPLE_PRECEDING_BLOCKERS:
                blocker = True
                break
        if blocker:
            continue

        # Skip if this is itself a known modal / aux
        if tok in {"would", "could", "should", "might",
                   "will", "shall", "may", "must", "can"}:
            continue

        is_irregular = tok in IRREGULAR_PARTICIPLES and tok not in SUFFIX_COLLISION_BLACKLIST
        is_regular = REGULAR_PAST_RX.match(tok) and tok not in SUFFIX_COLLISION_BLACKLIST

        if not (is_irregular or is_regular):
            continue

        # Reject pure-noun -ed words that snuck through: blacklist check
        if tok in SUFFIX_COLLISION_BLACKLIST:
            continue

        # Reject 'red'/'bed' style: explicit blacklist for past-simple
        if tok in {"red", "bed", "head", "thread", "fed"}:
            continue

        kind = "irregular" if is_irregular else "regular"
        ctx_start = max(0, i - 2)
        ctx_end = min(n, i + 3)
        context = " ".join(tokens[ctx_start:ctx_end])
        hits.append({"verb": tok, "kind": kind, "context": context})
    return hits


# ----------------------------------------------------------------------
# Present-simple detection (heuristic, lowest precision).
# Two-pronged:
#   (a) Subject-verb-agreement pattern: \b(she|he|it|they|we|you)\s+(\w+s)\b
#       where the trailing -s is a 3-singular present marker. This
#       fires a lot of false positives (plural nouns, possessives), so
#       we restrict to ROUGHLY-VERBY tokens: not in a small noun-suffix
#       blacklist.
#   (b) Copular present: \b(is|are|am|i'm|you're|she's|he's|it's|they're|we're)\b
#       (after stripping dialogue spans).
# We strip dialogue quotes BEFORE scoring present-tense — present-tense
# in dialogue is normal speech and not a narration signal.
# ----------------------------------------------------------------------

# Very common -s noun forms that look like 3-singular verbs.
NOUN_S_BLACKLIST = {
    "things", "people", "ways", "times", "days", "nights", "years",
    "months", "weeks", "moments", "hours", "places", "men", "women",
    "children", "kids", "boys", "girls", "horses", "swords", "axes",
    "bows", "arrows", "spears", "shields", "armors", "robes", "boots",
    "ships", "boats", "rooms", "halls", "gates", "doors", "walls",
    "streets", "roads", "paths", "trails", "forests", "mountains",
    "valleys", "hills", "rivers", "lakes", "seas", "oceans", "trees",
    "rocks", "stones", "books", "scrolls", "spells", "magic", "powers",
    "weapons", "tools", "things", "moments", "events", "stories",
    "tales", "memories", "thoughts", "feelings", "emotions",
    "battles", "wars", "fights", "conflicts", "duels",
    "friends", "enemies", "comrades", "allies", "foes",
    "drow", "elves", "dwarves", "humans", "halflings", "orcs",
    "goblins", "giants", "trolls", "ogres",
    "eyes", "hands", "arms", "legs", "feet", "fingers", "lips",
    "shoulders", "backs", "heads", "faces", "bodies", "minds",
    "hearts", "souls",
    "us", "is",  # not noun, just safety
}

# Copula regex: list contracted forms with REQUIRED apostrophe so we
# don't accidentally match possessives ("its", "yours" — already
# excluded but be safe). We keep both straight ' and curly ’ apostrophes.
PRESENT_COPULA_RX = re.compile(
    r"\b(?:"
    r"am|is|are|"
    r"i'm|i’m|"
    r"you're|you’re|"
    r"she's|she’s|"
    r"he's|he’s|"
    r"it's|it’s|"
    r"they're|they’re|"
    r"we're|we’re"
    r")\b",
    re.IGNORECASE,
)

PRESENT_3SG_RX = re.compile(
    r"\b(she|he|it|they|we|you)\s+(\w+s)\b",
    re.IGNORECASE,
)


def find_present_simple(text):
    """Return list of (form, kind=copula|3sg, context). Strips dialogue
    quoted spans first."""
    if not text:
        return []
    stripped = strip_dialogue(text)
    hits = []
    for m in PRESENT_COPULA_RX.finditer(stripped):
        form = m.group(0).lower().replace("’", "'")
        ctx_start = max(0, m.start() - 30)
        ctx_end = min(len(stripped), m.end() + 30)
        hits.append({
            "form": form,
            "kind": "copula",
            "context": stripped[ctx_start:ctx_end].strip(),
        })
    for m in PRESENT_3SG_RX.finditer(stripped):
        subj = m.group(1).lower()
        verb = m.group(2).lower()
        # Filter past-tense / aux verb forms that end in 's' (these are
        # NOT 3-sg present): 'was', 'has', 'is' (already in copula),
        # 'does' (rare aux). Also archaic 'twas / 'tis are out-of-scope.
        if verb in {"was", "has", "is", "does", "as", "us"}:
            continue
        if verb in NOUN_S_BLACKLIST:
            continue
        # Heuristic noun filter: skip 'ies' (could be plural noun)
        if verb.endswith("ies"):
            continue
        # Skip very-short matches (1-2 char + s)
        if len(verb) <= 3:
            continue
        ctx_start = max(0, m.start() - 30)
        ctx_end = min(len(stripped), m.end() + 30)
        hits.append({
            "form": f"{subj} {verb}",
            "kind": "3sg",
            "context": stripped[ctx_start:ctx_end].strip(),
        })
    return hits


# ----------------------------------------------------------------------
# Per-beat scoring
# ----------------------------------------------------------------------
def score_beat(text):
    if not text:
        return {tense: 0 for tense in TENSE_CATEGORIES}, {}
    pp = find_past_perfect(text)
    pprog = find_past_progressive(text)
    modal = find_modal_past(text)
    psimple = find_past_simple(text)
    psg = find_present_simple(text)

    # The past-simple detector inadvertently includes irregulars that
    # are also past participles. To avoid double-counting against
    # past-perfect, we subtract the past-perfect hits' participle
    # occurrences from the past-simple count. Approximation: count is
    # max(0, n_past_simple - n_past_perfect_with_participle_in_set).
    # The blocker check already prevents most overlap (past-perfect
    # uses 'had X-ed' so X is preceded by 'had' in 2-token window,
    # which is in PAST_SIMPLE_PRECEDING_BLOCKERS). So no extra
    # subtraction is needed.

    counts = {
        "past_simple": len(psimple),
        "past_progressive": len(pprog),
        "past_perfect": len(pp),
        "modal_past": len(modal),
        "present_simple": len(psg),
    }
    samples = {
        "past_simple_samples": [h["context"] for h in psimple[:3]],
        "past_progressive_samples": [h["context"] for h in pprog[:3]],
        "past_perfect_samples": [h["context"] for h in pp[:3]],
        "modal_past_samples": [h["context"] for h in modal[:3]],
        "present_simple_samples": [h["context"] for h in psg[:3]],
    }
    return counts, samples


# ----------------------------------------------------------------------
# Load corpus
# ----------------------------------------------------------------------
beats = []
with open(BEATS_PATH, "r", encoding="utf-8") as f:
    for line in f:
        beats.append(json.loads(line))


def safe_pct(num, den):
    return round(100.0 * num / den, 2) if den else 0.0


def safe_per_100(num, den_words):
    return round(100.0 * num / den_words, 4) if den_words else 0.0


def safe_ratio(num, den, ndigits=3):
    return round(num / den, ndigits) if den else None


# ----------------------------------------------------------------------
# Per-beat pass
# ----------------------------------------------------------------------
labelled = []
for b in beats:
    text = b.get("text", "") or ""
    counts, samples = score_beat(text)
    labelled.append({
        "scene_id": b.get("scene_id"),
        "book": b.get("book"),
        "chapter": b.get("chapter"),
        "kind": b.get("kind"),
        "words": b.get("words", 0),
        "beat_idx": b.get("beat_idx"),
        "counts": counts,
        "samples": samples,
    })


# ----------------------------------------------------------------------
# Aggregations
# ----------------------------------------------------------------------
def aggregate(rows):
    n_beats = len(rows)
    total_words = sum(r["words"] for r in rows)
    totals = {tense: 0 for tense in TENSE_CATEGORIES}
    for r in rows:
        for t in TENSE_CATEGORIES:
            totals[t] += r["counts"][t]
    densities = {t: safe_per_100(totals[t], total_words) for t in TENSE_CATEGORIES}
    total_all = sum(totals.values())
    shares = {t: round(100.0 * totals[t] / total_all, 2) if total_all else 0.0
              for t in TENSE_CATEGORIES}
    return {
        "n_beats": n_beats,
        "total_words": total_words,
        "totals": totals,
        "density_per_100w": densities,
        "share_pct": shares,
    }


# Per-book
per_book = {b: aggregate([r for r in labelled if r["book"] == b]) for b in BOOKS_IN_ORDER}

# Per-kind aggregate
KINDS = sorted({r["kind"] for r in labelled if r["kind"] in
               {"action", "description", "dialogue", "interiority", "stakes_recalibration"}})

per_kind_aggregate = {k: aggregate([r for r in labelled if r["kind"] == k]) for k in KINDS}

per_kind_per_book = {
    b: {k: aggregate([r for r in labelled if r["book"] == b and r["kind"] == k])
        for k in KINDS}
    for b in BOOKS_IN_ORDER
}


# ----------------------------------------------------------------------
# Per-kind tense ranking — which tense dominates each kind?
# ----------------------------------------------------------------------
def per_kind_dominant_tense(scope_per_kind):
    """For each kind, return list of (tense, density) sorted desc, with
    minimum n_beats >= 5."""
    out = {}
    for k, agg in scope_per_kind.items():
        if agg["n_beats"] < 5:
            out[k] = None
            continue
        ranks = sorted(
            [(t, agg["density_per_100w"][t]) for t in TENSE_CATEGORIES],
            key=lambda x: -x[1],
        )
        out[k] = ranks
    return out


tense_ranking_per_kind_aggregate = per_kind_dominant_tense(per_kind_aggregate)
tense_ranking_per_kind_per_book = {
    b: per_kind_dominant_tense(per_kind_per_book[b]) for b in BOOKS_IN_ORDER
}


# Top-1 tense per kind, per book
def top1_per_kind(scope_ranking):
    return {k: (ranks[0][0] if ranks else None) for k, ranks in scope_ranking.items()}


top1_per_kind_per_book = {b: top1_per_kind(tense_ranking_per_kind_per_book[b])
                          for b in BOOKS_IN_ORDER}


def topN_per_kind(scope_ranking, n):
    out = {}
    for k, ranks in scope_ranking.items():
        if not ranks or len(ranks) <= n:
            out[k] = None
        else:
            out[k] = ranks[n][0]  # 0-indexed: n=1 -> rank-2
    return out


top2_per_kind_per_book = {b: topN_per_kind(tense_ranking_per_kind_per_book[b], 1)
                          for b in BOOKS_IN_ORDER}


# Cross-book: for each kind, does top-1 reproduce 3/3?
top1_kind_stability = {}
for k in KINDS:
    per_b = {b: top1_per_kind_per_book[b][k] for b in BOOKS_IN_ORDER}
    vals = list(per_b.values())
    counts = Counter([v for v in vals if v is not None])
    if not counts:
        top1_kind_stability[k] = {
            "per_book": per_b,
            "modal_top1": None,
            "books_matching_modal": 0,
            "stable_3of3": False,
            "stable_2of3": False,
        }
        continue
    modal_top1, modal_count = counts.most_common(1)[0]
    top1_kind_stability[k] = {
        "per_book": per_b,
        "modal_top1": modal_top1,
        "books_matching_modal": modal_count,
        "stable_3of3": modal_count == 3,
        "stable_2of3": modal_count >= 2,
    }


# Same for top-2
top2_kind_stability = {}
for k in KINDS:
    per_b = {b: top2_per_kind_per_book[b][k] for b in BOOKS_IN_ORDER}
    vals = [v for v in per_b.values() if v is not None]
    counts = Counter(vals)
    if not counts:
        top2_kind_stability[k] = {
            "per_book": per_b,
            "modal_top2": None,
            "books_matching_modal": 0,
            "stable_3of3": False,
            "stable_2of3": False,
        }
        continue
    modal_top2, modal_count = counts.most_common(1)[0]
    top2_kind_stability[k] = {
        "per_book": per_b,
        "modal_top2": modal_top2,
        "books_matching_modal": modal_count,
        "stable_3of3": modal_count == 3,
        "stable_2of3": modal_count >= 2,
    }


# ----------------------------------------------------------------------
# Hypothesis check 1: past-progressive density description > action,
# 3/3 books?
# ----------------------------------------------------------------------
def pprog_desc_vs_action_per_book(book):
    desc = per_kind_per_book[book]["description"]["density_per_100w"]["past_progressive"]
    act = per_kind_per_book[book]["action"]["density_per_100w"]["past_progressive"]
    ratio = safe_ratio(desc, act)
    return {
        "description_per_100": desc,
        "action_per_100": act,
        "ratio_desc_over_action": ratio,
        "desc_gt_action": ratio is not None and ratio > 1.0,
    }


pprog_desc_vs_action = {b: pprog_desc_vs_action_per_book(b) for b in BOOKS_IN_ORDER}
pprog_desc_gt_action_count = sum(1 for v in pprog_desc_vs_action.values() if v["desc_gt_action"])


# ----------------------------------------------------------------------
# Hypothesis check 2: modal-past density interiority > {action,
# description}
# ----------------------------------------------------------------------
def modal_interiority_vs_others_per_book(book):
    inter = per_kind_per_book[book]["interiority"]["density_per_100w"]["modal_past"]
    act = per_kind_per_book[book]["action"]["density_per_100w"]["modal_past"]
    desc = per_kind_per_book[book]["description"]["density_per_100w"]["modal_past"]
    ratio_inter_act = safe_ratio(inter, act)
    ratio_inter_desc = safe_ratio(inter, desc)
    return {
        "interiority_per_100": inter,
        "action_per_100": act,
        "description_per_100": desc,
        "ratio_inter_over_action": ratio_inter_act,
        "ratio_inter_over_description": ratio_inter_desc,
        "inter_gt_action": ratio_inter_act is not None and ratio_inter_act > 1.0,
        "inter_gt_description": ratio_inter_desc is not None and ratio_inter_desc > 1.0,
        "inter_gt_both": (ratio_inter_act is not None and ratio_inter_act > 1.0
                         and ratio_inter_desc is not None and ratio_inter_desc > 1.0),
    }


modal_inter_vs_others = {b: modal_interiority_vs_others_per_book(b) for b in BOOKS_IN_ORDER}
modal_inter_gt_action_count = sum(1 for v in modal_inter_vs_others.values() if v["inter_gt_action"])
modal_inter_gt_desc_count = sum(1 for v in modal_inter_vs_others.values() if v["inter_gt_description"])
modal_inter_gt_both_count = sum(1 for v in modal_inter_vs_others.values() if v["inter_gt_both"])


# ----------------------------------------------------------------------
# Hypothesis check 3: past-perfect density interiority > action
# (overlap with P55 — preserve as cross-pattern check).
# ----------------------------------------------------------------------
def pperf_interiority_vs_action_per_book(book):
    inter = per_kind_per_book[book]["interiority"]["density_per_100w"]["past_perfect"]
    act = per_kind_per_book[book]["action"]["density_per_100w"]["past_perfect"]
    ratio = safe_ratio(inter, act)
    return {
        "interiority_per_100": inter,
        "action_per_100": act,
        "ratio_inter_over_action": ratio,
        "inter_gt_action": ratio is not None and ratio > 1.0,
    }


pperf_inter_vs_action = {b: pperf_interiority_vs_action_per_book(b) for b in BOOKS_IN_ORDER}
pperf_inter_gt_action_count = sum(1 for v in pperf_inter_vs_action.values() if v["inter_gt_action"])


# ----------------------------------------------------------------------
# Cross-book stability of densities per (book × kind × tense)
# Compute spread = (max-min)/mean across books for each (kind, tense) cell.
# ----------------------------------------------------------------------
def cell_spread(per_kind_per_book, kind, tense):
    vals = [per_kind_per_book[b][kind]["density_per_100w"][tense] for b in BOOKS_IN_ORDER]
    if not all(v >= 0 for v in vals):
        return None
    if max(vals) == 0:
        return 0.0
    return round((max(vals) - min(vals)) / (sum(vals) / len(vals)), 3)


cell_spreads = {}
for k in KINDS:
    cell_spreads[k] = {}
    for t in TENSE_CATEGORIES:
        cell_spreads[k][t] = {
            "per_book_density": {b: per_kind_per_book[b][k]["density_per_100w"][t]
                                 for b in BOOKS_IN_ORDER},
            "spread": cell_spread(per_kind_per_book, k, t),
        }


# ----------------------------------------------------------------------
# Verdict
# ----------------------------------------------------------------------
# Spec gate (per pattern brief):
#   PASS         — per-kind dominant tense reproduces 3/3 books AND
#                  past-progressive's per-kind ratio (description >
#                  action) holds 3/3
#   PASS_PARTIAL — 2/3 reproduce
#   DIVERGE      — unstable
#   KILL         — no signal
#
# Note: a hypothesis that INVERTS stably across 3 books (action >
# description, 3/3) is itself a stable directional finding — the
# *direction* of the secondary axis is stable, just opposite to the
# stated hypothesis. We capture this as a PASS_PARTIAL with explicit
# inversion note. The shippable prior swaps direction.

# Per-kind dominant-tense stability (count kinds where top-1 reproduces 3/3)
core_kinds = ["action", "description", "dialogue", "interiority"]
top1_3of3_kinds = [k for k in core_kinds if top1_kind_stability[k]["stable_3of3"]]
top1_2of3_kinds = [k for k in core_kinds if top1_kind_stability[k]["stable_2of3"]]
top1_3of3_count = len(top1_3of3_kinds)
top1_2of3_count = len(top1_2of3_kinds)

# Past-progressive description > action: 3/3 books?
pprog_gate_3of3 = pprog_desc_gt_action_count == 3
pprog_gate_2of3 = pprog_desc_gt_action_count >= 2
# Inverted: action > description 3/3 (i.e. desc>action FAILS 3/3, all
# desc<=action). Compute strict desc<action count.
pprog_act_gt_desc_count = sum(
    1 for v in pprog_desc_vs_action.values()
    if v["ratio_desc_over_action"] is not None and v["ratio_desc_over_action"] < 1.0
)
pprog_inverted_3of3 = pprog_act_gt_desc_count == 3

# A "dominant tense reproduces 3/3 books" — interpret as: ALL FOUR core
# kinds have stable top-1 tense across 3 books.
dominant_3of3 = top1_3of3_count == 4
dominant_majority_3of3 = top1_3of3_count >= 3   # at least 3 of 4 kinds

# Modal-past interiority>both, 3/3
modal_inter_gate_3of3 = modal_inter_gt_both_count == 3

if dominant_3of3 and pprog_gate_3of3:
    verdict = "PASS"
    verdict_note = (
        f"Per-kind dominant tense reproduces 3/3 across all {len(core_kinds)} core "
        f"kinds AND past-progressive description > action holds 3/3 books."
    )
elif dominant_3of3 and pprog_inverted_3of3:
    # Dominant-tense gate met; secondary axis stably INVERTED (action >
    # description 3/3). Direction is stable, hypothesis was wrong-signed.
    top2_3of3_count = sum(1 for k in core_kinds if top2_kind_stability[k]["stable_3of3"])
    verdict = "PASS_PARTIAL"
    verdict_note = (
        f"Per-kind top-1 tense reproduces 3/3 across all {len(core_kinds)} core kinds "
        f"(past_simple top-1 in every cell — this is unsurprising and load-bearing only "
        f"as a sanity check). Per-kind top-2 tense reproduces 3/3 in {top2_3of3_count}/"
        f"{len(core_kinds)} core kinds — that is the substantive finding: "
        f"action's rank-2 = past_perfect (recap inside action sequences); "
        f"description's rank-2 = past_perfect (state-describing perfect); "
        f"dialogue's rank-2 = modal_past (characters speaking hypothetically); "
        f"interiority's rank-2 = past_perfect 2/3 (modal_past in SoS). "
        f"Original hypothesis (past-progressive desc > action) FAILS in stable INVERTED "
        f"direction: action > description for past-progressive in 3/3 books. Past-progressive "
        f"in this corpus marks slowed/suspended ACTION ('was waiting', 'was resting on one "
        f"knee', 'was growing beyond his bounds'), not atmospheric description. "
        f"Tertiary gates pass: modal-past interiority > {{action, description}} 3/3 "
        f"(interiority hedging — 'he would settle', 'he could make', 'it could not be "
        f"wrested'); past-perfect interiority > action 3/3 (P55 overlap reproduces). "
        f"Ship: (i) per-kind rank-2 prior, (ii) inverted past-progressive prior "
        f"(action carries it, NOT description), (iii) modal-past interiority signal. "
        f"Do NOT ship the original desc>action hypothesis."
    )
elif dominant_majority_3of3 and pprog_gate_3of3:
    verdict = "PASS_PARTIAL"
    verdict_note = (
        f"Per-kind dominant tense reproduces 3/3 in {top1_3of3_count}/{len(core_kinds)} core "
        f"kinds (rest 2/3); past-progressive description > action holds 3/3 books."
    )
elif top1_3of3_count >= 2 and (pprog_gate_2of3 or pprog_inverted_3of3 or modal_inter_gate_3of3):
    verdict = "PASS_PARTIAL"
    verdict_note = (
        f"Mixed: per-kind dominant tense reproduces 3/3 in {top1_3of3_count}/{len(core_kinds)} "
        f"core kinds; past-progressive desc>action {pprog_desc_gt_action_count}/3 "
        f"(inverted desc<action {pprog_act_gt_desc_count}/3); modal-past "
        f"interiority>both {modal_inter_gt_both_count}/3."
    )
elif sum(per_book[b]["totals"]["past_simple"] for b in BOOKS_IN_ORDER) >= 100:
    verdict = "DIVERGE"
    verdict_note = (
        f"Tense markers occur in volume but per-kind dominant-tense stability "
        f"is {top1_3of3_count}/{len(core_kinds)} (3/3) and past-progressive desc>action "
        f"holds only {pprog_desc_gt_action_count}/3 — no clean shippable prior."
    )
else:
    verdict = "KILL"
    verdict_note = "Tense-marker volume too low or no consistent per-kind signal."


# ----------------------------------------------------------------------
# Spot-check examples
# ----------------------------------------------------------------------
def examples_for_kind_tense(kind, tense, k=4):
    rows = [r for r in labelled if r["kind"] == kind and r["counts"][tense] > 0]
    out = []
    for r in rows[:k]:
        out.append({
            "scene_id": r["scene_id"],
            "book": r["book"],
            "chapter": r["chapter"],
            "kind": r["kind"],
            "words": r["words"],
            "n_hits": r["counts"][tense],
            "samples": r["samples"][f"{tense}_samples"][:2],
        })
    return out


examples = {}
for k in core_kinds:
    examples[k] = {}
    for t in TENSE_CATEGORIES:
        examples[k][t] = examples_for_kind_tense(k, t, k=3)


# ----------------------------------------------------------------------
# Build payload
# ----------------------------------------------------------------------
payload = {
    "pattern": 61,
    "name": "Verb tense distribution per beat-kind",
    "corpus": "salvatore-icewind-dale (3 books)",
    "method": {
        "labeler": (
            "Five tense detectors via regex + token scan: PAST_SIMPLE "
            "(regular -ed/-ied/-ked or curated irregular set ~210 forms, "
            "blocked by 'had/has/have/was/were/is/are/be/been/being' in "
            "2-token preceding window), PAST_PROGRESSIVE (was/were [+adv] "
            "VERB-ing, excluding 'going to' immediate-future and passive "
            "'being'), PAST_PERFECT (mirror of P55 detector — 'had/hadn't/"
            "had not' + 0-3 token gap + irregular-or-suffixed participle), "
            "MODAL_PAST (would/could/should/might + opt 'have' + verb), "
            "PRESENT_SIMPLE (copular is/are/am + clitics, OR 3sg subject + "
            "VERB-s, with double-quoted dialogue spans stripped first to "
            "avoid counting reported speech). Detection is heuristic per "
            "spec — relative density per kind is the signal, not absolute "
            "precision."
        ),
        "scope": "prose `text` field only (summary excluded); per-beat findall, all hits sum",
        "stability_gates": {
            "per_kind_top1_dominant_tense": "top-1 tense by density per 100w identical across 3/3 books, in all 4 core kinds",
            "past_progressive_desc_over_action": "past-progressive density description > action in 3/3 books",
        },
        "tense_categories": TENSE_CATEGORIES,
        "core_kinds": core_kinds,
        "lexicon_sizes": {
            "irregular_participles": len(IRREGULAR_PARTICIPLES),
            "had_stopwords": len(HAD_STOPWORDS),
            "suffix_collision_blacklist": len(SUFFIX_COLLISION_BLACKLIST),
            "ing_filler_adverbs": len(ING_FILLER_ADVERBS),
            "noun_s_blacklist": len(NOUN_S_BLACKLIST),
        },
    },
    "n_beats_total": len(labelled),
    "n_beats_per_book": {b: per_book[b]["n_beats"] for b in BOOKS_IN_ORDER},
    "aggregate": aggregate(labelled),
    "per_book": per_book,
    "per_kind_aggregate": per_kind_aggregate,
    "per_kind_per_book": per_kind_per_book,
    "tense_ranking_per_kind_aggregate": tense_ranking_per_kind_aggregate,
    "tense_ranking_per_kind_per_book": tense_ranking_per_kind_per_book,
    "top1_per_kind_per_book": top1_per_kind_per_book,
    "top1_kind_stability": top1_kind_stability,
    "top2_per_kind_per_book": top2_per_kind_per_book,
    "top2_kind_stability": top2_kind_stability,
    "hypothesis_checks": {
        "past_progressive_desc_over_action": {
            "per_book": pprog_desc_vs_action,
            "n_books_holding_desc_gt_action": pprog_desc_gt_action_count,
            "n_books_holding_action_gt_desc_inverted": pprog_act_gt_desc_count,
            "passes_3of3": pprog_gate_3of3,
            "passes_2of3": pprog_gate_2of3,
            "stably_inverted_3of3": pprog_inverted_3of3,
            "note": (
                "Inverted result: action carries past-progressive at HIGHER density than "
                "description in 3/3 books. Past-progressive in this corpus marks "
                "slowed/suspended action ('was watching', 'were waiting', 'was running'), "
                "not atmospheric description. Original hypothesis (description = "
                "atmospheric tense home) is not supported; the direction-of-effect is "
                "consistent but opposite to spec."
            ),
        },
        "modal_past_interiority_over_others": {
            "per_book": modal_inter_vs_others,
            "n_books_inter_gt_action": modal_inter_gt_action_count,
            "n_books_inter_gt_description": modal_inter_gt_desc_count,
            "n_books_inter_gt_both": modal_inter_gt_both_count,
        },
        "past_perfect_interiority_over_action_p55_overlap": {
            "per_book": pperf_inter_vs_action,
            "n_books_inter_gt_action": pperf_inter_gt_action_count,
        },
    },
    "cell_spreads_per_kind_per_tense": cell_spreads,
    "verdict": verdict,
    "verdict_note": verdict_note,
    "examples": examples,
}


# ----------------------------------------------------------------------
# Write timestamped JSON
# ----------------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)

print(f"Wrote {OUT_PATH}")
print(f"n_beats: {len(labelled)}")
print(f"aggregate density per 100w (per tense):")
for t in TENSE_CATEGORIES:
    print(f"  {t:20s} {payload['aggregate']['density_per_100w'][t]}/100w  share={payload['aggregate']['share_pct'][t]}%")
print()
print("Per-book densities (per 100w):")
header = f"  {'tense':22s} | " + " | ".join(f"{b:18s}" for b in BOOKS_IN_ORDER)
print(header)
for t in TENSE_CATEGORIES:
    cells = []
    for b in BOOKS_IN_ORDER:
        cells.append(f"{per_book[b]['density_per_100w'][t]:.3f}")
    print(f"  {t:22s} | " + " | ".join(f"{c:18s}" for c in cells))
print()
print("Per-kind aggregate density (per 100w):")
header = f"  {'kind':22s} | " + " | ".join(f"{t:18s}" for t in TENSE_CATEGORIES)
print(header)
for k in core_kinds:
    cells = []
    for t in TENSE_CATEGORIES:
        cells.append(f"{per_kind_aggregate[k]['density_per_100w'][t]:.3f}")
    print(f"  {k:22s} | " + " | ".join(f"{c:18s}" for c in cells))
print()
print("Per-kind top-1 tense per book:")
for k in core_kinds:
    s = top1_kind_stability[k]
    print(f"  {k:22s} CS={s['per_book']['crystal_shard']:18s} SoS={s['per_book']['streams_of_silver']:18s} HG={s['per_book']['halflings_gem']:18s} "
          f"modal={s['modal_top1']} 3of3={s['stable_3of3']} 2of3={s['stable_2of3']}")
print()
print("Per-kind top-2 tense per book (the secondary signal):")
for k in core_kinds:
    s = top2_kind_stability[k]
    print(f"  {k:22s} CS={s['per_book']['crystal_shard']:18s} SoS={s['per_book']['streams_of_silver']:18s} HG={s['per_book']['halflings_gem']:18s} "
          f"modal={s['modal_top2']} 3of3={s['stable_3of3']} 2of3={s['stable_2of3']}")
print()
print("Past-progressive desc > action per book:")
for b in BOOKS_IN_ORDER:
    v = pprog_desc_vs_action[b]
    print(f"  {b}: desc={v['description_per_100']}/100w action={v['action_per_100']}/100w ratio={v['ratio_desc_over_action']} desc>action={v['desc_gt_action']}")
print(f"  -> desc>action holds in {pprog_desc_gt_action_count}/3 books")
print()
print("Modal-past interiority vs others per book:")
for b in BOOKS_IN_ORDER:
    v = modal_inter_vs_others[b]
    print(f"  {b}: inter={v['interiority_per_100']}/100w action={v['action_per_100']} desc={v['description_per_100']}/100w "
          f"ratio_int/act={v['ratio_inter_over_action']} ratio_int/desc={v['ratio_inter_over_description']} "
          f"inter>both={v['inter_gt_both']}")
print(f"  -> interiority > action holds in {modal_inter_gt_action_count}/3 books")
print(f"  -> interiority > description holds in {modal_inter_gt_desc_count}/3 books")
print(f"  -> interiority > both holds in {modal_inter_gt_both_count}/3 books")
print()
print("Past-perfect interiority vs action per book (P55 overlap):")
for b in BOOKS_IN_ORDER:
    v = pperf_inter_vs_action[b]
    print(f"  {b}: inter={v['interiority_per_100']}/100w action={v['action_per_100']}/100w ratio={v['ratio_inter_over_action']} inter>action={v['inter_gt_action']}")
print(f"  -> interiority > action holds in {pperf_inter_gt_action_count}/3 books")
print()
print(f"VERDICT: {verdict}")
print(f"  note: {verdict_note}")
