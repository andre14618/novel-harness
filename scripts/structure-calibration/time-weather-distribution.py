"""
Pattern 38 — Time-of-day and weather distribution per beat (3-book Icewind Dale).

Pure-compute regex pass over `novels/salvatore-icewind-dale/beats.jsonl`.

Output:
  novels/salvatore-icewind-dale/structure-calibration/
    crystal_shard.<TIMESTAMP>.time-weather-distribution.json

Method:
  - Time-of-day classification: regex-anchored match on 9 buckets
    (morning / midday / afternoon / evening / dusk / night /
     midnight / dawn / unspecified).
  - Weather classification: regex-anchored match on 8 buckets
    (clear / cloudy / rain / snow / storm / wind / fog / unspecified).
  - First-match-wins per beat (single label). Multi-label counts are
    also tracked for cross-check.
  - Anchor lists are word-boundary regexes; multi-word phrases handled
    where useful (e.g. "clear sky", "first light").
  - Per-book distributions, arc-position thirds, within-chapter early/
    mid/late thirds, cross-book stability (range-of-rates) for both
    axes.
"""

import json
import re
import os
import datetime
from collections import Counter, defaultdict

CORPUS = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/beats.jsonl"
OUT_DIR = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/structure-calibration"

TIMESTAMP = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S")
OUT_PATH = os.path.join(OUT_DIR, f"crystal_shard.{TIMESTAMP}.time-weather-distribution.json")

# ---------- Lexicons ----------
# Each bucket is a list of regex alternatives. First-match-wins ordering
# in the iteration over buckets matters for ambiguous text — order is
# chosen to bias toward the more specific label (e.g. midnight before
# night, dawn before morning, dusk/twilight before evening).

TIME_BUCKETS = [
    ("midnight", [r"\bmidnight\b", r"\bdead of night\b", r"\bwitching hour\b"]),
    ("dawn", [
        r"\bdawn\b",
        r"\bdaybreak\b",
        r"\bsunrise\b",
        r"\bfirst light\b",
        r"\bearly light\b",
        r"\bbreak of day\b",
        r"\bcock(?:s)? crow\b",
    ]),
    ("dusk", [
        r"\bdusk\b",
        r"\btwilight\b",
        r"\bsundown\b",
        r"\bsunset\b",
        r"\bgloaming\b",
        r"\bnightfall\b",
        r"\bsetting sun\b",
    ]),
    ("morning", [
        r"\bmorning\b",
        r"\bmorn\b",
        r"\bdaylight\b",
        r"\bthe sun rose\b",
        r"\brising sun\b",
        r"\bearly hours\b",
    ]),
    ("midday", [
        r"\bmidday\b",
        r"\bnoon\b",
        r"\bnoonday\b",
        r"\bnoontide\b",
        r"\bhigh sun\b",
        r"\bmiddle of the day\b",
    ]),
    ("afternoon", [r"\bafternoon\b", r"\blate(?:r)? day\b"]),
    ("evening", [
        r"\bevening\b",
        r"\beventide\b",
        r"\bsupper(?: time| hour)?\b",
        r"\bend of (?:the )?day\b",
    ]),
    ("night", [
        r"\bnight\b",
        r"\bnighttime\b",
        r"\bnightfall\b",  # also caught above; ordering favours dusk
        r"\bdark of night\b",
        r"\bunder the stars?\b",
        r"\bmoonlit\b",
        r"\bmoonlight\b",
        r"\bnocturnal\b",
        r"\bafter dark\b",
    ]),
]

WEATHER_BUCKETS = [
    ("storm", [
        r"\bstorm(?:s|ed|ing|y)?\b",
        r"\btempest(?:s|uous)?\b",
        r"\bblizzard(?:s|ing)?\b",
        r"\bgale(?:s)?\b",
        r"\bsquall(?:s)?\b",
        r"\bthunderstorm(?:s)?\b",
        r"\bthunder\b",
        r"\blightning\b",
    ]),
    ("snow", [
        r"\bsnow(?:s|ed|ing|y|fall|drift|flake|flakes)?\b",
        r"\bsnowstorm(?:s)?\b",  # storm wins by ordering
        r"\bsleet(?:s|ing|y)?\b",
        r"\bhail(?:s|ed|ing|stones?)?\b",
        r"\bicy wind\b",
        r"\bfrozen rain\b",
    ]),
    ("rain", [
        r"\brain(?:s|ed|ing|y|drops?|water|fall)?\b",
        r"\bdownpour(?:s)?\b",
        r"\bdrizzl(?:e|es|ed|ing|y)\b",
        r"\bshower(?:s|ed|ing)?\b",  # generic; will overcount slightly
        r"\bdeluge(?:s|d)?\b",
    ]),
    ("wind", [
        r"\bwind(?:s|y|swept|blown)?\b",
        r"\bbreez(?:e|es|y)\b",
        r"\bgust(?:s|ed|ing|y)?\b",
        r"\bhowling wind\b",
    ]),
    ("fog", [
        r"\bfog(?:s|gy|ged|ging)?\b",
        r"\bmist(?:s|y|ed|ing)?\b",
        r"\bhaz(?:e|y|es)\b",
        r"\bvapour(?:s)?\b",
        r"\bvapor(?:s)?\b",
    ]),
    ("cloudy", [
        r"\bcloud(?:s|y|ed|ing)?\b",
        r"\bovercast\b",
        r"\bgrey sky\b",
        r"\bgray sky\b",
        r"\bgloom(?:y)?\b",
    ]),
    ("clear", [
        r"\bclear sky\b",
        r"\bclear skies\b",
        r"\bblue sky\b",
        r"\bblue skies\b",
        r"\bsunny\b",
        r"\bsunshine\b",
        r"\bbright sun\b",
        r"\bcloudless\b",
        r"\bbrilliant sun\b",
    ]),
]


def compile_buckets(buckets):
    out = []
    for name, patterns in buckets:
        joined = "|".join(patterns)
        out.append((name, re.compile(joined, re.IGNORECASE)))
    return out


TIME_RE = compile_buckets(TIME_BUCKETS)
WEATHER_RE = compile_buckets(WEATHER_BUCKETS)


def first_match_label(text, compiled):
    """Return the first bucket whose regex matches; else 'unspecified'."""
    for name, rx in compiled:
        if rx.search(text):
            return name
    return "unspecified"


def all_match_labels(text, compiled):
    """Return every bucket whose regex matches (multi-label count)."""
    return [name for name, rx in compiled if rx.search(text)]


# ---------- Load corpus ----------
beats = []
with open(CORPUS, "r", encoding="utf-8") as f:
    for line in f:
        beats.append(json.loads(line))

# Group by (book, chapter) for arc-position math.
by_book = defaultdict(list)
for b in beats:
    by_book[b["book"]].append(b)

books_in_order = ["crystal_shard", "streams_of_silver", "halflings_gem"]


def chapter_sort_key(ch):
    """Total ordering across heterogeneous chapter values.

    Explicit narrative ordering: prelude < int chapters < part1/2/3 <
    epilogue < epilogue2 < epilogue3.
    """
    if isinstance(ch, int):
        return (1, ch, "")
    s = str(ch)
    if s == "prelude":
        return (0, 0, s)
    if s.startswith("part"):
        # part1 / part2 / part3 — between numbered chapters and epilogue.
        try:
            return (2, int(s[4:]), s)
        except ValueError:
            return (2, 0, s)
    if s == "epilogue":
        return (3, 0, s)
    if s.startswith("epilogue"):
        try:
            return (3, int(s[len("epilogue"):]), s)
        except ValueError:
            return (3, 0, s)
    return (4, 0, s)


def chapter_range(book_beats):
    chapters = sorted({b["chapter"] for b in book_beats}, key=chapter_sort_key)
    return chapters


def thirds(n):
    """Return (early_end_exclusive, mid_end_exclusive). Splits 1..n into thirds."""
    e = max(1, n // 3)
    m = max(2, (2 * n) // 3)
    if e == m:
        m = e + 1
    return e, m


def chapter_third(chapter_idx, total_chapters):
    """0-indexed chapter_idx in [0, total_chapters). Returns 'early' / 'mid' / 'late'."""
    e, m = thirds(total_chapters)
    if chapter_idx < e:
        return "early"
    if chapter_idx < m:
        return "mid"
    return "late"


def beat_third(beat_idx_in_chapter, total_beats_in_chapter):
    """Within-chapter early/mid/late thirds."""
    e, m = thirds(total_beats_in_chapter)
    if beat_idx_in_chapter < e:
        return "early"
    if beat_idx_in_chapter < m:
        return "mid"
    return "late"


def safe_pct(num, den):
    return round(100.0 * num / den, 2) if den else 0.0


def dist_to_pct(counter, total, labels):
    return {lbl: safe_pct(counter.get(lbl, 0), total) for lbl in labels}


# ---------- Per-beat label pass ----------
labelled = []  # list of dicts with first-match labels + multi-match labels.

# Build chapter-position metadata once per book.
book_chapter_lists = {}  # book -> sorted unique chapter ints
chapter_beat_counts = {}  # (book, chapter) -> total beats

for book in books_in_order:
    bb = by_book[book]
    book_chapter_lists[book] = sorted({b["chapter"] for b in bb}, key=chapter_sort_key)
    counts = Counter()
    for b in bb:
        counts[(b["book"], b["chapter"])] += 1
    chapter_beat_counts.update(counts)

# Within-chapter beat index — per (book, chapter), reset and assign.
beat_local_idx = {}  # scene_id -> idx
chap_running = defaultdict(int)
for b in beats:
    key = (b["book"], b["chapter"])
    beat_local_idx[id(b)] = chap_running[key]
    chap_running[key] += 1


for b in beats:
    text = b.get("text", "") or ""
    summary = b.get("summary", "") or ""
    # Use the prose text + summary for matching (summary often holds the
    # most direct setting cue, e.g. "morning attack on the camp").
    haystack = f"{summary}\n{text}"

    time_label = first_match_label(haystack, TIME_RE)
    time_multi = all_match_labels(haystack, TIME_RE)
    weather_label = first_match_label(haystack, WEATHER_RE)
    weather_multi = all_match_labels(haystack, WEATHER_RE)

    book = b["book"]
    chapter = b["chapter"]
    chap_list = book_chapter_lists[book]
    chap_idx_in_book = chap_list.index(chapter)
    book_chap_third = chapter_third(chap_idx_in_book, len(chap_list))

    local_idx = beat_local_idx[id(b)]
    in_chap_total = chapter_beat_counts[(book, chapter)]
    in_chap_third = beat_third(local_idx, in_chap_total)

    labelled.append({
        "scene_id": b.get("scene_id"),
        "book": book,
        "chapter": chapter,
        "chap_idx_in_book": chap_idx_in_book,
        "book_chap_third": book_chap_third,
        "local_beat_idx": local_idx,
        "in_chap_total": in_chap_total,
        "in_chap_third": in_chap_third,
        "kind": b.get("kind"),
        "words": b.get("words"),
        "time_label": time_label,
        "weather_label": weather_label,
        "time_multi": time_multi,
        "weather_multi": weather_multi,
    })


TIME_LABELS = [n for n, _ in TIME_BUCKETS] + ["unspecified"]
WEATHER_LABELS = [n for n, _ in WEATHER_BUCKETS] + ["unspecified"]


# ---------- Aggregations ----------
def per_book_distribution(labels, axis):
    """labels: list of all labelled records. axis: 'time_label' or 'weather_label'."""
    out = {}
    for book in books_in_order:
        rows = [r for r in labels if r["book"] == book]
        n = len(rows)
        cnt = Counter(r[axis] for r in rows)
        out[book] = {
            "n_beats": n,
            "counts": {lbl: cnt.get(lbl, 0) for lbl in (TIME_LABELS if axis == "time_label" else WEATHER_LABELS)},
            "pct": dist_to_pct(cnt, n, TIME_LABELS if axis == "time_label" else WEATHER_LABELS),
            "modal": cnt.most_common(1)[0][0] if cnt else None,
            "modal_excl_unspecified": (
                next(((k, v) for k, v in cnt.most_common() if k != "unspecified"), (None, 0))
            ),
        }
    return out


def arc_position_distribution(labels, axis, position_key):
    """Group by (book, position_key) -> distribution."""
    out = {}
    pos_values = ["early", "mid", "late"]
    for book in books_in_order:
        out[book] = {}
        for pos in pos_values:
            rows = [r for r in labels if r["book"] == book and r[position_key] == pos]
            n = len(rows)
            cnt = Counter(r[axis] for r in rows)
            out[book][pos] = {
                "n_beats": n,
                "pct": dist_to_pct(cnt, n, TIME_LABELS if axis == "time_label" else WEATHER_LABELS),
                "counts": {lbl: cnt.get(lbl, 0) for lbl in (TIME_LABELS if axis == "time_label" else WEATHER_LABELS)},
            }
    return out


def cross_book_directional(per_book, axis):
    """Range-of-rate per label across books. Verdict at 15pt threshold per
    project convention used elsewhere in this conclusions doc."""
    labels = TIME_LABELS if axis == "time_label" else WEATHER_LABELS
    rows = []
    for lbl in labels:
        pcts = [per_book[book]["pct"][lbl] for book in books_in_order]
        rng = max(pcts) - min(pcts)
        verdict = "STABLE" if rng <= 15.0 else "DIVERGES"
        rows.append({
            "label": lbl,
            "crystal_shard_pct": pcts[0],
            "streams_of_silver_pct": pcts[1],
            "halflings_gem_pct": pcts[2],
            "range_pt": round(rng, 2),
            "verdict_15pt": verdict,
        })
    return rows


def darkness_concentration(labels):
    """Are 'dark' (night/midnight/dusk) and 'stormy' (storm/rain/snow/fog)
    concentrated in the late book third?"""
    DARK_TIME = {"night", "midnight", "dusk"}
    DARK_WEATHER = {"storm", "rain", "snow", "fog"}
    out = {}
    for book in books_in_order:
        out[book] = {}
        for pos in ["early", "mid", "late"]:
            rows = [r for r in labels if r["book"] == book and r["book_chap_third"] == pos]
            n = len(rows)
            dark_t = sum(1 for r in rows if r["time_label"] in DARK_TIME)
            dark_w = sum(1 for r in rows if r["weather_label"] in DARK_WEATHER)
            either = sum(1 for r in rows if r["time_label"] in DARK_TIME or r["weather_label"] in DARK_WEATHER)
            out[book][pos] = {
                "n_beats": n,
                "dark_time_pct": safe_pct(dark_t, n),
                "dark_weather_pct": safe_pct(dark_w, n),
                "either_pct": safe_pct(either, n),
            }
    return out


def within_chapter_drift(labels):
    """Per-position rates of dark-time and bright-time labels."""
    BRIGHT_TIME = {"morning", "midday", "dawn", "afternoon"}
    DARK_TIME = {"night", "midnight", "dusk", "evening"}
    DARK_WEATHER = {"storm", "rain", "snow", "fog"}
    out = {}
    for book in books_in_order:
        out[book] = {}
        for pos in ["early", "mid", "late"]:
            rows = [r for r in labels if r["book"] == book and r["in_chap_third"] == pos]
            n = len(rows)
            bright = sum(1 for r in rows if r["time_label"] in BRIGHT_TIME)
            dark_t = sum(1 for r in rows if r["time_label"] in DARK_TIME)
            dark_w = sum(1 for r in rows if r["weather_label"] in DARK_WEATHER)
            out[book][pos] = {
                "n_beats": n,
                "bright_time_pct": safe_pct(bright, n),
                "dark_time_pct": safe_pct(dark_t, n),
                "dark_weather_pct": safe_pct(dark_w, n),
            }
    return out


def aggregate_distribution(labels, axis):
    rows = labels
    n = len(rows)
    cnt = Counter(r[axis] for r in rows)
    return {
        "n_beats": n,
        "pct": dist_to_pct(cnt, n, TIME_LABELS if axis == "time_label" else WEATHER_LABELS),
        "counts": {lbl: cnt.get(lbl, 0) for lbl in (TIME_LABELS if axis == "time_label" else WEATHER_LABELS)},
    }


def multi_label_overlap(labels, axis_multi, label_set):
    """How often does a beat match more than one bucket on the multi-label
    pass? Counts per book."""
    out = {}
    for book in books_in_order:
        rows = [r for r in labels if r["book"] == book]
        n = len(rows)
        zero = sum(1 for r in rows if not r[axis_multi])
        one = sum(1 for r in rows if len(r[axis_multi]) == 1)
        two = sum(1 for r in rows if len(r[axis_multi]) == 2)
        threeplus = sum(1 for r in rows if len(r[axis_multi]) >= 3)
        out[book] = {
            "n_beats": n,
            "zero_match_pct": safe_pct(zero, n),
            "one_match_pct": safe_pct(one, n),
            "two_match_pct": safe_pct(two, n),
            "three_plus_match_pct": safe_pct(threeplus, n),
        }
    return out


def scene_start_anchoring(labels, raw_beats, axis):
    """How much higher is the specified-rate on scene_start beats vs.
    interior beats? Tests the 'Salvatore tags time-of-day at scene
    starts and lets it inherit through the rest of the scene'
    hypothesis."""
    boundary_by_id = {id(b): b.get("boundary_signal") for b in raw_beats}
    out = {}
    for book in books_in_order:
        rows = [r for r in labels if r["book"] == book]
        # Re-link to raw beat boundary_signal via scene_id ordering — the
        # labels list preserves order from the raw scan, so match by index.
        # Simpler: rebuild by zipping with raw_beats (same order).
        pass
    # Rebuild via parallel iteration since labels and raw_beats are in
    # the same order.
    by_book_split = defaultdict(lambda: {
        "start_total": 0, "start_specified": 0,
        "interior_total": 0, "interior_specified": 0,
    })
    for r, raw in zip(labels, raw_beats):
        book = r["book"]
        is_start = raw.get("boundary_signal") == "scene_start"
        spec = r[axis] != "unspecified"
        bucket = by_book_split[book]
        if is_start:
            bucket["start_total"] += 1
            if spec:
                bucket["start_specified"] += 1
        else:
            bucket["interior_total"] += 1
            if spec:
                bucket["interior_specified"] += 1

    out = {}
    for book in books_in_order:
        s = by_book_split[book]
        out[book] = {
            "scene_start_n": s["start_total"],
            "scene_start_specified_pct": safe_pct(s["start_specified"], s["start_total"]),
            "interior_n": s["interior_total"],
            "interior_specified_pct": safe_pct(s["interior_specified"], s["interior_total"]),
            "lift_pt": round(
                safe_pct(s["start_specified"], s["start_total"])
                - safe_pct(s["interior_specified"], s["interior_total"]),
                2,
            ),
        }
    return out


def coverage_summary(labels):
    """Per-book: % of beats that received any time-of-day label and any
    weather label. Tells us how much of the corpus is 'unspecified' on
    each axis."""
    out = {}
    for book in books_in_order:
        rows = [r for r in labels if r["book"] == book]
        n = len(rows)
        time_specified = sum(1 for r in rows if r["time_label"] != "unspecified")
        weather_specified = sum(1 for r in rows if r["weather_label"] != "unspecified")
        out[book] = {
            "n_beats": n,
            "time_specified_pct": safe_pct(time_specified, n),
            "weather_specified_pct": safe_pct(weather_specified, n),
        }
    return out


# ---------- Compute ----------
per_book_time = per_book_distribution(labelled, "time_label")
per_book_weather = per_book_distribution(labelled, "weather_label")

agg_time = aggregate_distribution(labelled, "time_label")
agg_weather = aggregate_distribution(labelled, "weather_label")

arc_time = arc_position_distribution(labelled, "time_label", "book_chap_third")
arc_weather = arc_position_distribution(labelled, "weather_label", "book_chap_third")

within_chap_time = arc_position_distribution(labelled, "time_label", "in_chap_third")
within_chap_weather = arc_position_distribution(labelled, "weather_label", "in_chap_third")

cross_time = cross_book_directional(per_book_time, "time_label")
cross_weather = cross_book_directional(per_book_weather, "weather_label")

darkness = darkness_concentration(labelled)
in_chap_drift = within_chapter_drift(labelled)

multi_time = multi_label_overlap(labelled, "time_multi", TIME_LABELS)
multi_weather = multi_label_overlap(labelled, "weather_multi", WEATHER_LABELS)

coverage = coverage_summary(labelled)

scene_anchoring_time = scene_start_anchoring(labelled, beats, "time_label")
scene_anchoring_weather = scene_start_anchoring(labelled, beats, "weather_label")


# ---------- Top-2 modes by book (excluding unspecified) ----------
def top_modes(per_book_dist, k=2):
    out = {}
    for book in books_in_order:
        pct = per_book_dist[book]["pct"]
        items = sorted(
            ((lbl, p) for lbl, p in pct.items() if lbl != "unspecified"),
            key=lambda x: -x[1],
        )
        out[book] = items[:k]
    return out


top_time = top_modes(per_book_time, k=3)
top_weather = top_modes(per_book_weather, k=3)


# ---------- Spot-check examples ----------
def sample_examples(labels, axis, target_label, k=3):
    rows = [r for r in labels if r[axis] == target_label]
    return [
        {
            "scene_id": r["scene_id"],
            "book": r["book"],
            "chapter": r["chapter"],
            "kind": r["kind"],
        }
        for r in rows[:k]
    ]


examples = {
    "time_storm_examples": sample_examples(labelled, "weather_label", "storm", k=5),
    "time_dawn_examples": sample_examples(labelled, "time_label", "dawn", k=5),
    "time_midnight_examples": sample_examples(labelled, "time_label", "midnight", k=5),
}


# ---------- Build payload ----------
payload = {
    "pattern": 38,
    "name": "Time-of-day and weather distribution per beat",
    "corpus": "salvatore-icewind-dale (3 books)",
    "method": {
        "labeler": "regex first-match per beat over (summary + text)",
        "time_buckets": [n for n, _ in TIME_BUCKETS] + ["unspecified"],
        "weather_buckets": [n for n, _ in WEATHER_BUCKETS] + ["unspecified"],
        "ordering_note": (
            "First-match-wins. Specific labels come before generic ones — "
            "midnight before night, dawn before morning, dusk/twilight before "
            "evening. Storm before snow/rain (so 'snowstorm' lands as 'storm', "
            "'thunderstorm' lands as 'storm'). Multi-label counts are also "
            "reported (multi_label_overlap) so the regression to single label "
            "is auditable."
        ),
        "scope": "summary field + text field concatenated; whole-beat regex search",
        "stability_threshold_pt": 15,
    },
    "n_beats_total": len(labelled),
    "n_beats_per_book": {b: per_book_time[b]["n_beats"] for b in books_in_order},
    "coverage": coverage,
    "per_book_time": per_book_time,
    "per_book_weather": per_book_weather,
    "aggregate_time": agg_time,
    "aggregate_weather": agg_weather,
    "top_modes_time_excl_unspecified": top_time,
    "top_modes_weather_excl_unspecified": top_weather,
    "arc_position_time_book_thirds": arc_time,
    "arc_position_weather_book_thirds": arc_weather,
    "within_chapter_time_thirds": within_chap_time,
    "within_chapter_weather_thirds": within_chap_weather,
    "darkness_concentration_per_book_third": darkness,
    "within_chapter_drift": in_chap_drift,
    "cross_book_directional_time": cross_time,
    "cross_book_directional_weather": cross_weather,
    "multi_label_overlap_time": multi_time,
    "multi_label_overlap_weather": multi_weather,
    "scene_start_anchoring_time": scene_anchoring_time,
    "scene_start_anchoring_weather": scene_anchoring_weather,
    "examples": examples,
}

os.makedirs(OUT_DIR, exist_ok=True)
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)

print(f"Wrote {OUT_PATH}")
print(f"n_beats: {len(labelled)}")
print(f"per-book: {payload['n_beats_per_book']}")
print(f"coverage: {coverage}")
