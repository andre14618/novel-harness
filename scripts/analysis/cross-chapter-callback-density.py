#!/usr/bin/env python3
"""
Pattern 41 — Cross-chapter callback density.

Pure compute over `novels/salvatore-icewind-dale/beats.jsonl`. For each chapter
inside each book, count callbacks to prior-chapter content via two channels:

  1. Named-entity reuse: distinct named entities (proper-noun-class tokens)
     first introduced in chapter N that reappear in chapter M (M > N).

  2. Time-progression markers: anchor-class regex hits ("yesterday",
     "earlier", "previously", "before", "weeks ago", "after their <X>",
     "since they had", "last we saw", "when last", "two days ago", etc.).

Per-chapter outputs:
  - distinct_prior_referents: count of distinct named-entity referents
    first-introduced in any earlier chapter that appear here (NOT total
    occurrences — distinct heads).
  - prior_referent_occurrences: total occurrences (sums multiple mentions
    of the same prior-chapter entity inside this chapter).
  - time_marker_count: count of anchor-class regex hits.
  - words_in_chapter: total prose-words in the chapter (using the corpus
    pipeline `text` field, whitespace-tokenised).
  - callback_density_per_1k: (distinct_prior_referents + time_marker_count) / words * 1000.

Per-book output: distribution by chapter-position quartile; Spearman
rank-correlation of callback density vs chapter position; cross-book
directional comparison.

OUTPUT: timestamped JSON in
novels/salvatore-icewind-dale/structure-calibration/.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale")
BEATS_PATH = ROOT / "beats.jsonl"
OUT_DIR = ROOT / "structure-calibration"

# ---------- Tokenisation + named-entity heuristics ----------

# Identify capitalized-word candidates. Allow apostrophes (e.g., "Drizzt's"
# strips later) and hyphens (e.g., "Catti-brie", "Cryshal-Tirith").
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*")
SENT_END_RE = re.compile(r"[.!?][\"')\]\s]*$")

# Sentence-initial words that are capitalised by virtue of starting a sentence
# but are not proper nouns. The proper-noun heuristic *also* requires a
# non-sentence-initial occurrence somewhere in the book, so this list is
# defence-in-depth — it just suppresses pure-stopword candidates from
# polluting the first-appearance index even before the cross-context check.
COMMON_LEADERS = {
    "the","a","an","he","she","it","they","we","you","i","his","her","its","their","our","your","my",
    "and","but","or","so","yet","for","nor","because","although","though","while","when","whenever",
    "after","before","during","since","until","unless","if","whether","that","this","these","those",
    "as","at","by","in","on","up","down","out","off","over","under","through","into","onto","upon",
    "from","with","without","about","above","below","between","among","across",
    "no","not","never","ever","still","also","too","both","each","every","some","any","many","much",
    "few","more","less","most","least","one","two","three","four","five","six","seven","eight","nine",
    "ten","first","second","third","last","next","then","there","here","where","what","why","how",
    "who","which","whose","whom","yes","really","perhaps","maybe","indeed","of","to","is","was",
    "were","are","be","been","being","had","have","has","do","did","does","may","might","must",
    "shall","should","will","would","can","could","let","make","made","get","got","go","went",
    "come","came","take","took","give","gave","know","knew","think","thought","see","saw","look",
    "looked","feel","felt","seem","seemed","find","found","just","only","even","again","once","now",
    "soon","later","early","late","ago","quite","very","much","such","other","another","same",
    "well","here's","there's","i'll","i've","i'm","i'd","you'll","you've","we'll","we've","they'll",
    "they've","he'll","she'll","that's","it's","don't","didn't","won't","can't","couldn't","wouldn't",
    "shouldn't","isn't","aren't","wasn't","weren't","hasn't","haven't","hadn't","ain't","mustn't",
    # narrative manner adverbs that often start sentences
    "suddenly","slowly","quickly","finally","carefully","cautiously","quietly","silently","gently",
    "instantly","immediately","then","meanwhile","afterward","afterwards","still","again",
}


def tokenise_with_position(text: str):
    """Yield (token, is_sentence_initial) for every word-token in text.

    Sentence-initial tracking is heuristic: a token is sentence-initial if
    the prior non-whitespace string ended with [.!?] (allowing close-quote /
    paren). The first token of any input is sentence-initial.
    """
    pos = 0
    sentence_open = True
    for m in WORD_RE.finditer(text):
        # snapshot of text from previous token end up to this match start
        gap = text[pos:m.start()]
        if SENT_END_RE.search(gap) or pos == 0:
            initial = True
        elif "\n" in gap and (gap.strip().endswith(".") or gap.strip() == ""):
            # paragraph break heuristic: blank-line-ish gap implies sentence boundary
            initial = sentence_open
        else:
            initial = sentence_open
        token = m.group(0)
        yield token, initial
        # next token: in-sentence unless the trailing punctuation closed it
        # We update sentence_open below by re-checking the post-token text.
        sentence_open = False
        pos = m.end()
    # nothing more


def split_sentences(text: str):
    """Cheap sentence splitter (period/!?/newline) — robust enough for proper-noun detection."""
    return re.split(r"(?<=[.!?])\s+|\n+", text)


def collect_proper_noun_index(book_beats):
    """Return dict[token_key] -> first_chapter_label, restricted to proper-noun-class tokens.

    A token is treated as proper-noun-class if it is capitalised AND appears
    in non-sentence-initial position somewhere in the book. Otherwise it is
    discarded as a sentence-leader common noun.

    `token_key` is the token canonicalised: trailing "'s" stripped, lowercase
    folded for stopword check, but the *original* mixed-case form is kept as
    the index key so "Drizzt" and "drizzt" do not collide. Hyphenated proper
    nouns (Catti-brie, Cryshal-Tirith) are treated as single tokens.
    """
    # Pass 1: count per-token (token_form, sentence_initial) occurrences.
    cap_token_init_count = Counter()       # (token_form,) -> initial-position occurrences
    cap_token_noninit_count = Counter()    # (token_form,) -> non-initial occurrences
    # Pass 2 will iterate beats by chapter to find first-chapter for each
    # surviving proper noun.
    for beat in book_beats:
        text = beat.get("text") or ""
        # Split into sentences then tokenise per-sentence to make sentence-initial
        # detection trivial.
        for sent in split_sentences(text):
            sent_stripped = sent.strip()
            if not sent_stripped:
                continue
            words = WORD_RE.findall(sent_stripped)
            for i, raw in enumerate(words):
                # canonical: strip trailing apostrophe-s / apostrophe
                canon = raw.rstrip("'")
                if canon.lower().endswith("'s"):
                    canon = canon[:-2]
                if not canon or not canon[0].isalpha():
                    continue
                if not canon[0].isupper():
                    continue
                if canon.lower() in COMMON_LEADERS:
                    continue
                # require minimum length to drop one-char artefacts ("I", "A")
                if len(canon) < 2:
                    continue
                if i == 0:
                    cap_token_init_count[canon] += 1
                else:
                    cap_token_noninit_count[canon] += 1

    proper_nouns = set()
    for canon, c in cap_token_noninit_count.items():
        if c >= 1:  # appeared mid-sentence at least once → proper-noun-class
            proper_nouns.add(canon)

    # Pass 2: assign first chapter for each proper noun. Iterate beats in
    # document order (the JSONL order matches scene_id order).
    first_chapter = {}
    for beat in book_beats:
        ch = beat["chapter"]
        text = beat.get("text") or ""
        seen_in_beat = set()
        for sent in split_sentences(text):
            for raw in WORD_RE.findall(sent):
                canon = raw.rstrip("'")
                if canon.lower().endswith("'s"):
                    canon = canon[:-2]
                if not canon or not canon[0].isupper() or len(canon) < 2:
                    continue
                if canon not in proper_nouns:
                    continue
                seen_in_beat.add(canon)
        for canon in seen_in_beat:
            if canon not in first_chapter:
                first_chapter[canon] = ch
    return first_chapter, proper_nouns


# ---------- Time-progression markers ----------
# Anchor-class only: phrases that *explicitly invoke prior content*. We do NOT
# count generic "after" / "before" used as preposition; we require a temporal
# context that scopes back across narrative time.

TIME_MARKER_PATTERNS = [
    # absolute back-references
    r"\byesterday\b",
    r"\blast\s+(?:we\s+saw|night|week|month|time|year|spring|summer|autumn|winter)\b",
    r"\bwhen\s+last\b",
    r"\bearlier\b",
    r"\bpreviously\b",
    r"\bonce\s+(?:before|again|more)\b",
    # quantified prior intervals
    r"\b(?:a\s+)?(?:few|many|several|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:days?|weeks?|months?|years?|hours?|moments?|nights?)\s+(?:ago|earlier|before|prior|past)\b",
    r"\bdays?\s+(?:ago|earlier)\b",
    r"\bweeks?\s+(?:ago|earlier)\b",
    r"\bmonths?\s+(?:ago|earlier)\b",
    r"\byears?\s+(?:ago|earlier)\b",
    r"\bhours?\s+(?:ago|earlier)\b",
    # narrative back-anchors
    r"\bafter\s+(?:their|his|her|the|its|our)\s+(?:departure|arrival|encounter|escape|battle|journey|defeat|victory|meeting|conversation|talk|fight|return|flight|reunion|parting|stay)\b",
    r"\bsince\s+(?:they|he|she|it|we|the\s+\w+)\s+(?:had|left|departed|arrived|met|spoke|fought|escaped|saw|encountered|first|last)\b",
    r"\bsince\s+(?:that|the)\s+(?:day|night|moment|encounter|battle|departure|meeting|fight|time)\b",
    r"\bbefore\s+(?:they|he|she|it|we)\s+(?:had|left|departed|arrived|met|spoke|saw)\b",
    r"\bprior\s+to\s+(?:their|his|her|the|its)\b",
    # explicit recall verbs scoped to prior chapter content
    r"\b(?:remembered|recalled|thought\s+back|remembering|recalling)\s+(?:to|the|that|how|when|of)\b",
    r"\bbrought\s+(?:to\s+)?mind\b",
    r"\bcome\s+to\s+think\s+of\s+it\b",
    # explicit forward-reach back-anchors
    r"\bas\s+(?:they|he|she|it|we)\s+had\s+(?:done|said|told|promised|vowed|sworn|seen|heard|learned|agreed|planned)\b",
    r"\bas\s+(?:they|he|she|it|we)\s+(?:had\s+)?(?:before|previously)\b",
    r"\bas\s+had\s+been\b",
    # temporal cuts across the chapter break
    r"\bsome\s+time\s+(?:later|after|earlier)\b",
    r"\bmuch\s+(?:later|earlier)\b",
    r"\bnot\s+long\s+(?:after|before|ago)\b",
    r"\blong\s+(?:after|before|ago)\b",
]
TIME_MARKER_RE = re.compile("|".join(TIME_MARKER_PATTERNS), re.IGNORECASE)


def count_time_markers(text: str) -> tuple[int, list[str]]:
    """Return (count, sample_hits[:6]) for time-progression markers."""
    hits = TIME_MARKER_RE.findall(text)
    # Convert tuple-of-empty-strings (from alternation groups) to literal
    # match-strings via finditer:
    hits_text = [m.group(0).strip() for m in TIME_MARKER_RE.finditer(text)]
    return len(hits_text), hits_text[:6]


# ---------- Chapter ordering ----------

def chapter_sort_key(label):
    """
    Standard book ordering:
      prelude → 1, 2, 3, ..., N → part1, part2, part3 (interludes after numerics) → epilogue, epilogue2, epilogue3
    Returns a sortable tuple. Numeric chapters get bucket 1; preludes 0;
    parts 2; epilogues 3.
    """
    if label == "prelude":
        return (0, 0)
    if isinstance(label, int):
        return (1, label)
    if isinstance(label, str) and label.isdigit():
        return (1, int(label))
    if isinstance(label, str) and label.startswith("part"):
        suffix = label[len("part"):]
        try:
            return (2, int(suffix))
        except ValueError:
            return (2, 0)
    if isinstance(label, str) and label.startswith("epilogue"):
        suffix = label[len("epilogue"):]
        if suffix == "":
            return (3, 0)
        try:
            return (3, int(suffix))
        except ValueError:
            return (3, 0)
    # safety fallback
    return (4, 0)


# ---------- Spearman ----------

def spearman(xs, ys):
    """Spearman rank correlation between two equal-length lists."""
    if len(xs) < 3:
        return None
    def rank(vals):
        order = sorted(range(len(vals)), key=lambda i: vals[i])
        ranks = [0.0] * len(vals)
        i = 0
        while i < len(vals):
            j = i
            while j + 1 < len(vals) and vals[order[j + 1]] == vals[order[i]]:
                j += 1
            avg_rank = (i + j) / 2 + 1
            for k in range(i, j + 1):
                ranks[order[k]] = avg_rank
            i = j + 1
        return ranks
    rx = rank(xs)
    ry = rank(ys)
    n = len(xs)
    mean_rx = sum(rx) / n
    mean_ry = sum(ry) / n
    num = sum((rx[i] - mean_rx) * (ry[i] - mean_ry) for i in range(n))
    dx = sum((r - mean_rx) ** 2 for r in rx) ** 0.5
    dy = sum((r - mean_ry) ** 2 for r in ry) ** 0.5
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


# ---------- Main ----------

def main():
    out_ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    out_path = OUT_DIR / f"crystal_shard.{out_ts}.cross-chapter-callback-density.json"

    beats_by_book = defaultdict(list)
    with BEATS_PATH.open() as f:
        for line in f:
            obj = json.loads(line)
            beats_by_book[obj["book"]].append(obj)

    out = {
        "pattern": "41",
        "name": "Cross-chapter callback density",
        "computedAt": datetime.now(timezone.utc).isoformat(),
        "corpus": "salvatore-icewind-dale",
        "books": list(beats_by_book.keys()),
        "rationale": (
            "Series-engineering vision (project_series_engineering_vision) targets multi-book novels where later chapters "
            "must remember earlier ones. P41 measures the corpus's actual cross-chapter callback rhythm: how often does a "
            "later chapter explicitly reference earlier-chapter content (named entities + time-progression markers)? "
            "Output drives a planner-prior on minimum 'callback density' per chapter, particularly toward act 3."
        ),
        "methodology": {
            "named_entity_detection": (
                "Capitalized-word tokens (regex [A-Za-z][A-Za-z'-]*) that appear at least once in non-sentence-initial "
                "position within the book. This is the standard mixed-case-prose heuristic for distinguishing proper nouns "
                "from sentence-leader common nouns. Hyphenated tokens are kept whole (Catti-brie, Cryshal-Tirith). Trailing "
                "possessive 's stripped. A defensive COMMON_LEADERS stopword list of ~140 sentence-initial words filters "
                "true stopwords (And/But/The/...) so they cannot enter the proper-noun pool."
            ),
            "first_appearance_index": (
                "Per-book pass over all beats in document order; the chapter where each surviving proper-noun token first "
                "appears is its index entry. Subsequent appearances in any later chapter (chapter-sort-key strictly greater) "
                "are counted as callbacks."
            ),
            "callback_count_per_chapter": (
                "distinct_prior_referents = count of distinct proper-noun tokens whose first-appearance chapter is strictly "
                "earlier than this chapter. prior_referent_occurrences = total occurrences (sums multiple mentions of the "
                "same earlier-chapter entity inside this chapter)."
            ),
            "time_marker_detection": (
                "Anchor-class regex over chapter `text`. Patterns require explicit prior-content scoping: yesterday, "
                "earlier, previously, last we saw, when last, weeks/days/months/years ago, since they had X, after their "
                "departure/arrival/encounter from Y, prior to their, as they had done, etc. Generic 'after'/'before' as "
                "preposition (after the door, before the wall) is NOT counted; only patterns where the token sits next to a "
                "narrative-time anchor."
            ),
            "callback_density_per_1k": (
                "(distinct_prior_referents + time_marker_count) / chapter_words * 1000. Distinct entity referents (not "
                "occurrences) avoid double-counting multi-mention beats; time markers add the explicit-recall channel."
            ),
            "chapter_position_normalisation": (
                "Per book: 'position_index' is the 0-based rank in the chapter_sort_key order (prelude → numerics → parts → "
                "epilogues). 'position_pct' = position_index / (n_chapters - 1) for n_chapters >= 2, else 0.0. Quartile "
                "bins are computed on position_pct: q1=[0,0.25), q2=[0.25,0.5), q3=[0.5,0.75), q4=[0.75,1.0]."
            ),
            "tradeoffs": (
                "Capitalized-token heuristic over-reports for hyphenated common nouns when they appear with sentence-medial "
                "capitalisation (rare in narrative prose but possible — e.g. 'Goblin-of-the-Tribe' as a chapter-label). "
                "Sub-tokens of compound proper nouns (e.g. 'Mithral' inside 'Mithral Hall') are tracked separately, which "
                "may inflate distinct-referent counts when they recur. We do NOT NER-coreference Drizzt with 'the drow', "
                "so pronoun-only references back to a prior-chapter character do NOT add to distinct_prior_referents — that "
                "is intentionally conservative (the planner consumer is interested in explicit textual hooks, not implicit "
                "ones)."
            ),
        },
        "per_book": {},
    }

    for book, beats in beats_by_book.items():
        first_chapter_idx, proper_pool = collect_proper_noun_index(beats)
        # Group beats by chapter
        beats_by_ch = defaultdict(list)
        for beat in beats:
            beats_by_ch[beat["chapter"]].append(beat)
        chapter_labels = sorted(beats_by_ch.keys(), key=chapter_sort_key)
        n_chapters = len(chapter_labels)

        per_chapter = []
        for idx, ch in enumerate(chapter_labels):
            beats_in_ch = beats_by_ch[ch]
            text_full = " ".join((b.get("text") or "") for b in beats_in_ch)
            ch_words = len(WORD_RE.findall(text_full))

            # Per-chapter capture of proper noun occurrences
            per_chapter_token_counts = Counter()
            for sent in split_sentences(text_full):
                for raw in WORD_RE.findall(sent):
                    canon = raw.rstrip("'")
                    if canon.lower().endswith("'s"):
                        canon = canon[:-2]
                    if not canon or not canon[0].isupper() or len(canon) < 2:
                        continue
                    if canon not in proper_pool:
                        continue
                    per_chapter_token_counts[canon] += 1

            # Restrict to entities first-introduced in a strictly earlier chapter
            distinct_prior = []
            occ_prior = 0
            for canon, occ in per_chapter_token_counts.items():
                first_ch = first_chapter_idx.get(canon)
                if first_ch is None:
                    continue
                # strict-earlier comparison via chapter_sort_key
                if chapter_sort_key(first_ch) < chapter_sort_key(ch):
                    distinct_prior.append(canon)
                    occ_prior += occ

            tm_count, tm_sample = count_time_markers(text_full)
            callback_density_per_1k = (
                (len(distinct_prior) + tm_count) / ch_words * 1000.0 if ch_words > 0 else 0.0
            )
            position_pct = idx / (n_chapters - 1) if n_chapters > 1 else 0.0
            quartile = (
                "q1" if position_pct < 0.25 else
                "q2" if position_pct < 0.5 else
                "q3" if position_pct < 0.75 else
                "q4"
            )
            top_callbacks = sorted(
                ((c, per_chapter_token_counts[c]) for c in distinct_prior),
                key=lambda x: -x[1],
            )[:5]
            per_chapter.append({
                "chapter": ch,
                "position_index": idx,
                "position_pct": round(position_pct, 4),
                "quartile": quartile,
                "words": ch_words,
                "n_beats": len(beats_in_ch),
                "distinct_prior_referents": len(distinct_prior),
                "prior_referent_occurrences": occ_prior,
                "time_marker_count": tm_count,
                "time_marker_samples": tm_sample,
                "callback_density_per_1k": round(callback_density_per_1k, 4),
                "top_callbacks": [{"entity": c, "occurrences": cnt} for c, cnt in top_callbacks],
            })

        # Quartile aggregates (skip the prelude/first chapter where no priors exist)
        # Note: chapter at position_index=0 has no possible callbacks; we keep it
        # in the dump but exclude it from the quartile aggregate.
        eligible = [c for c in per_chapter if c["position_index"] > 0]
        quart_agg = {}
        for q in ("q1","q2","q3","q4"):
            chs = [c for c in eligible if c["quartile"] == q]
            if not chs:
                quart_agg[q] = None
                continue
            n = len(chs)
            mean_dist = sum(c["distinct_prior_referents"] for c in chs) / n
            mean_occ = sum(c["prior_referent_occurrences"] for c in chs) / n
            mean_tm = sum(c["time_marker_count"] for c in chs) / n
            mean_density = sum(c["callback_density_per_1k"] for c in chs) / n
            mean_words = sum(c["words"] for c in chs) / n
            quart_agg[q] = {
                "n_chapters": n,
                "mean_distinct_prior_referents": round(mean_dist, 2),
                "mean_prior_referent_occurrences": round(mean_occ, 2),
                "mean_time_marker_count": round(mean_tm, 2),
                "mean_callback_density_per_1k": round(mean_density, 3),
                "mean_words": round(mean_words, 1),
            }

        # Spearman: position_pct vs callback_density_per_1k (eligible only)
        if len(eligible) >= 3:
            xs = [c["position_pct"] for c in eligible]
            ys = [c["callback_density_per_1k"] for c in eligible]
            spearman_rho = spearman(xs, ys)
        else:
            spearman_rho = None

        # Spearman: position_pct vs distinct_prior_referents (eligible only)
        if len(eligible) >= 3:
            xs = [c["position_pct"] for c in eligible]
            ys = [c["distinct_prior_referents"] for c in eligible]
            spearman_rho_distinct = spearman(xs, ys)
        else:
            spearman_rho_distinct = None

        # Spearman: position_pct vs time_marker_count
        if len(eligible) >= 3:
            xs = [c["position_pct"] for c in eligible]
            ys = [c["time_marker_count"] for c in eligible]
            spearman_rho_time = spearman(xs, ys)
        else:
            spearman_rho_time = None

        # Halves: first vs last 50% of chapters (eligible only)
        if len(eligible) >= 4:
            mid_idx = len(eligible) // 2
            ordered = sorted(eligible, key=lambda c: c["position_index"])
            first_half = ordered[:mid_idx]
            last_half = ordered[mid_idx:]
            def stats(group):
                if not group:
                    return None
                n = len(group)
                return {
                    "n_chapters": n,
                    "mean_distinct_prior_referents": round(sum(c["distinct_prior_referents"] for c in group) / n, 2),
                    "mean_time_marker_count": round(sum(c["time_marker_count"] for c in group) / n, 2),
                    "mean_callback_density_per_1k": round(sum(c["callback_density_per_1k"] for c in group) / n, 3),
                }
            half_stats = {
                "first_half": stats(first_half),
                "last_half": stats(last_half),
            }
        else:
            half_stats = None

        # Top 10 callback-densest chapters in this book
        top_chapters = sorted(eligible, key=lambda c: -c["callback_density_per_1k"])[:10]

        out["per_book"][book] = {
            "n_chapters": n_chapters,
            "n_chapters_eligible_for_callback": len(eligible),
            "n_proper_nouns_in_pool": len(proper_pool),
            "n_proper_nouns_with_first_chapter": len(first_chapter_idx),
            "per_chapter": per_chapter,
            "by_quartile": quart_agg,
            "halves": half_stats,
            "spearman_rho_density_vs_position": (
                round(spearman_rho, 4) if spearman_rho is not None else None
            ),
            "spearman_rho_distinct_referents_vs_position": (
                round(spearman_rho_distinct, 4) if spearman_rho_distinct is not None else None
            ),
            "spearman_rho_time_markers_vs_position": (
                round(spearman_rho_time, 4) if spearman_rho_time is not None else None
            ),
            "top10_densest_chapters": [
                {"chapter": c["chapter"], "position_pct": c["position_pct"],
                 "callback_density_per_1k": c["callback_density_per_1k"],
                 "distinct_prior_referents": c["distinct_prior_referents"],
                 "time_marker_count": c["time_marker_count"]}
                for c in top_chapters
            ],
        }

    # Cross-book directional comparison
    rho_density = {b: out["per_book"][b]["spearman_rho_density_vs_position"] for b in out["per_book"]}
    rho_distinct = {b: out["per_book"][b]["spearman_rho_distinct_referents_vs_position"] for b in out["per_book"]}
    rho_time = {b: out["per_book"][b]["spearman_rho_time_markers_vs_position"] for b in out["per_book"]}

    def signs(d):
        s = []
        for b, v in d.items():
            if v is None:
                s.append((b, None))
            else:
                s.append((b, "positive" if v > 0 else "negative" if v < 0 else "zero"))
        return s

    cross_book = {
        "spearman_density_per_book": rho_density,
        "spearman_density_signs": dict(signs(rho_density)),
        "all_three_books_positive_density": all(v is not None and v > 0 for v in rho_density.values()),
        "all_three_books_negative_density": all(v is not None and v < 0 for v in rho_density.values()),
        "spearman_distinct_referents_per_book": rho_distinct,
        "spearman_distinct_referents_signs": dict(signs(rho_distinct)),
        "all_three_books_positive_distinct": all(v is not None and v > 0 for v in rho_distinct.values()),
        "spearman_time_markers_per_book": rho_time,
        "spearman_time_markers_signs": dict(signs(rho_time)),
        "all_three_books_positive_time": all(v is not None and v > 0 for v in rho_time.values()),
    }
    # Pick a directional verdict
    if cross_book["all_three_books_positive_density"]:
        cross_book["verdict_density"] = "ALL_POSITIVE"
    elif cross_book["all_three_books_negative_density"]:
        cross_book["verdict_density"] = "ALL_NEGATIVE"
    else:
        cross_book["verdict_density"] = "MIXED"
    out["cross_book_directional"] = cross_book

    # Aggregate chapter-density distribution across all books (eligible only)
    all_eligible = []
    for b, d in out["per_book"].items():
        for c in d["per_chapter"]:
            if c["position_index"] > 0:
                all_eligible.append({"book": b, **c})
    densities = [c["callback_density_per_1k"] for c in all_eligible]
    if densities:
        densities_sorted = sorted(densities)
        n = len(densities_sorted)
        def pct(p):
            if n == 0:
                return None
            k = max(0, min(n - 1, int(round(p * (n - 1)))))
            return densities_sorted[k]
        out["aggregate"] = {
            "n_chapters": n,
            "mean_density_per_1k": round(sum(densities) / n, 3),
            "median_density_per_1k": pct(0.50),
            "p25": pct(0.25),
            "p75": pct(0.75),
            "p10": pct(0.10),
            "p90": pct(0.90),
            "min": min(densities),
            "max": max(densities),
        }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"WROTE {out_path}")

    # quick report to stdout (Andre will read in commit log)
    print()
    print("=== P41 cross-chapter callback density — summary ===")
    for b, d in out["per_book"].items():
        print(f"\n{b}: n_chapters={d['n_chapters']} eligible={d['n_chapters_eligible_for_callback']}")
        print(f"  proper-noun pool size: {d['n_proper_nouns_in_pool']}")
        print(f"  Spearman ρ (density vs position): {d['spearman_rho_density_vs_position']}")
        print(f"  Spearman ρ (distinct referents vs position): {d['spearman_rho_distinct_referents_vs_position']}")
        print(f"  Spearman ρ (time markers vs position): {d['spearman_rho_time_markers_vs_position']}")
        print(f"  Quartile means (callback_density_per_1k):")
        for q, qstats in d["by_quartile"].items():
            if qstats:
                print(f"    {q}: n={qstats['n_chapters']} density={qstats['mean_callback_density_per_1k']:.2f}/1k "
                      f"distinct={qstats['mean_distinct_prior_referents']:.1f} tm={qstats['mean_time_marker_count']:.1f}")
        if d["halves"]:
            fh, lh = d["halves"]["first_half"], d["halves"]["last_half"]
            print(f"  First half: n={fh['n_chapters']} density={fh['mean_callback_density_per_1k']:.2f}/1k")
            print(f"  Last half:  n={lh['n_chapters']} density={lh['mean_callback_density_per_1k']:.2f}/1k")
    print()
    print(f"Cross-book directional verdict (density): {out['cross_book_directional']['verdict_density']}")
    print(f"Aggregate (all books): mean={out['aggregate']['mean_density_per_1k']:.2f}/1k "
          f"median={out['aggregate']['median_density_per_1k']:.2f} p25={out['aggregate']['p25']:.2f} p75={out['aggregate']['p75']:.2f}")


if __name__ == "__main__":
    main()
