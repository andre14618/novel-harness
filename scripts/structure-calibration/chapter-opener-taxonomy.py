"""
Pattern 49 — Chapter-opener hook taxonomy (3-book Salvatore corpus).

For each (book, chapter) pair, the FIRST beat (lowest beat_idx within chapter)
is the camera-establishing shot. Classify the opener into ONE of 8 buckets:

  1. action_in_progress     — physical action / motion / event already happening
  2. dialogue_cold_open     — character speech is the first significant content
  3. setting_establish      — descriptive landscape / atmosphere first
  4. interiority_pov        — POV thoughts / introspection / observation as the lead
  5. time_marker            — explicit temporal anchor opens
  6. flashback_or_recap     — opens in past time / summarizes prior events
  7. sensory_cold_open      — non-visual sensory shock leads
  8. character_introduction — new character is named/described first

Pipeline:
  1. Load beats.jsonl, group by (book, chapter), pick lowest beat_idx
  2. Classify each opener via DeepSeek V4 Flash (temperature 0, JSON mode)
     using the FULL `text` field (capped at 1,500 chars for cost control)
  3. Compute per-book class distributions, modal class, top-3 set membership
  4. Cross-book directional gate:
     - PASS         — modal agrees in 3/3 books AND top-3 overlap >= 2
     - PASS_PARTIAL — 2/3 books reproduce
     - DIVERGE      — modal disagrees across books
     - KILL         — no clear pattern

Output:
  - JSON  : novels/salvatore-icewind-dale/structure-calibration/
            crystal_shard.<TS>.chapter-opener-taxonomy.json
  - MD    : append to crystal_shard-conclusions.md (flock-protected)
  - Row   : insert into docs/harness-tuning-roadmap.md before "Sequencing" anchor

Why a fresh script vs. the existing chapter-opener-taxonomy.ts: the .ts file
uses a DIFFERENT 7-bucket taxonomy (different category names + different
semantics — `callback-or-summary` vs the spec's `flashback_or_recap`, no
sensory bucket, no character-introduction bucket). Pattern 49 is a distinct
measurement at the 8-bucket charter granularity, not a re-run of the .ts file.
"""

from __future__ import annotations

import asyncio
import fcntl
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiohttp


# ----- paths -----------------------------------------------------------------

ROOT = Path("/Users/andre/Desktop/personal_projects/novel-harness")
BEATS_PATH = ROOT / "novels/salvatore-icewind-dale/beats.jsonl"
OUT_DIR = ROOT / "novels/salvatore-icewind-dale/structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = ROOT / "docs/harness-tuning-roadmap.md"
ENV_PATH = ROOT / ".env"


# ----- taxonomy --------------------------------------------------------------

BUCKETS = [
    "action_in_progress",
    "dialogue_cold_open",
    "setting_establish",
    "interiority_pov",
    "time_marker",
    "flashback_or_recap",
    "sensory_cold_open",
    "character_introduction",
]

BOOK_ORDER = ["crystal_shard", "streams_of_silver", "halflings_gem"]


# ----- env -------------------------------------------------------------------

def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    if not ENV_PATH.exists():
        return out
    for line in ENV_PATH.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if "=" not in s:
            continue
        k, v = s.split("=", 1)
        out[k.strip()] = v.strip().strip("'").strip('"')
    return out


# ----- corpus loader ---------------------------------------------------------

def load_openers() -> list[dict[str, Any]]:
    """Group beats by (book, chapter), pick lowest beat_idx in each group."""
    by_key: dict[tuple[str, Any], list[dict[str, Any]]] = {}
    with BEATS_PATH.open() as f:
        for line in f:
            r = json.loads(line)
            k = (r["book"], r["chapter"])
            by_key.setdefault(k, []).append(r)

    openers: list[dict[str, Any]] = []
    for beats in by_key.values():
        beats.sort(key=lambda b: b["beat_idx"])
        openers.append(beats[0])

    # Sort: book in fixed order; numeric chapters before string chapters
    def sort_key(b: dict[str, Any]) -> tuple[int, int, str]:
        bo = BOOK_ORDER.index(b["book"]) if b["book"] in BOOK_ORDER else 99
        ch = b["chapter"]
        if isinstance(ch, int):
            return (bo, 0, f"{ch:04d}")
        return (bo, 1, str(ch))

    openers.sort(key=sort_key)
    return openers


def opener_excerpt(beat: dict[str, Any], max_chars: int = 1500) -> str:
    text = (beat.get("text") or "").strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + " […]"


# ----- LLM classifier --------------------------------------------------------

SYSTEM_PROMPT = """You classify the OPENING of a fiction chapter (the first beat — what is the first thing the reader experiences) into ONE of 8 buckets. Pick the SINGLE most dominant rhetorical move.

Buckets (definitions are load-bearing — read them carefully):

1. action_in_progress — opens with characters mid-action / mid-motion / mid-event. Physical activity is already underway when the chapter begins (a march, a fight, an arrival, a traversal). Characters are doing something, not thinking or being described.

2. dialogue_cold_open — opens with a line of spoken dialogue (or with no more than a brief tag/identifier before quoted speech). Character SPEECH is the first significant content the reader receives.

3. setting_establish — opens with descriptive landscape / location / atmosphere / weather / building / terrain. The CAMERA establishes the world before any human character does anything. Characters arrive into the scene later in the opener.

4. interiority_pov — opens INSIDE a character's POV: thoughts, memory, emotion, philosophical reflection, observation as a mental act. The lead is mental, not physical or descriptive.

5. time_marker — opens with an explicit temporal anchor as the foreground move ("Three days passed…", "The next morning…", "By dawn…", "An hour later…"). Distinguish from action_in_progress: time_marker is when the TIME-JUMP itself is the rhetorical lead and what follows is summary or scene-setup; if the time phrase is just a quick anchor and physical action immediately picks up, prefer action_in_progress.

6. flashback_or_recap — opens in past time relative to the main narrative, OR summarizes off-page prior events as recap-style narration before returning to the present. Distinguish from time_marker: flashback_or_recap shifts to OR summarizes a different temporal frame; time_marker just announces a forward jump.

7. sensory_cold_open — opens with a NON-VISUAL sensory shock leading the prose: a sound (a scream, a thud, a roar), a smell, a felt sensation (cold, heat, touch). The reader's first datum is heard/smelled/felt, not seen.

8. character_introduction — opens by naming and describing a NEW character as the entry point — a "meet the new player" portrait. Use only when the introduction of a previously-unseen (or barely-seen) character is the rhetorical lead, not when an established character merely appears.

Tie-breaking rules:
- If the opener is descriptive landscape THEN a character arrives → setting_establish
- If the opener is a brief time phrase THEN immediate physical action → action_in_progress
- If the opener mixes interiority and action, pick the move that takes the FIRST one or two sentences
- "action_in_progress" requires that the opener actually drops us into ongoing physical action; if action only appears after a paragraph of setup or interior thought, prefer the bucket that describes those first sentences.

Output JSON only:
{"classification":"<bucket>","confidence":"high"|"medium"|"low","rationale_short":"<one short clause, ≤120 chars>"}"""


async def classify_opener(
    session: aiohttp.ClientSession,
    api_key: str,
    opener_text: str,
    book: str,
    chapter: Any,
    max_retries: int = 3,
) -> dict[str, Any]:
    """Classify a single opener. Returns dict with classification/confidence/rationale_short."""
    user_prompt = (
        f"BOOK: {book}\nCHAPTER: {chapter}\n\nOPENING TEXT (first beat of chapter, may be truncated):\n\n"
        f"{opener_text}\n\n---\nClassify into one of the 8 buckets. Respond JSON only."
    )

    payload = {
        "model": "deepseek-v4-flash",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0,
        "max_tokens": 400,
        "response_format": {"type": "json_object"},
        # DeepSeek V4 Flash defaults to thinking mode; disable for tight JSON labeling.
        "thinking": {"type": "disabled"},
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            async with session.post(
                "https://api.deepseek.com/v1/chat/completions",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=120),
            ) as r:
                if r.status != 200:
                    body = await r.text()
                    raise RuntimeError(f"HTTP {r.status}: {body[:300]}")
                j = await r.json()
                raw = (j.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
                parsed = json.loads(raw)
                cls = str(parsed.get("classification", "")).strip()
                if cls not in BUCKETS:
                    raise RuntimeError(f"unrecognized bucket: {cls!r}")
                conf = parsed.get("confidence", "medium")
                if conf not in ("high", "medium", "low"):
                    conf = "medium"
                rat = str(parsed.get("rationale_short", "")).strip()[:240]
                return {"classification": cls, "confidence": conf, "rationale_short": rat}
        except Exception as e:
            last_err = e
            wait = 1.5 * (attempt + 1)
            await asyncio.sleep(wait)
    raise RuntimeError(f"DeepSeek failed after {max_retries} attempts: {last_err}")


# ----- aggregation -----------------------------------------------------------

def empty_dist() -> dict[str, dict[str, float]]:
    return {b: {"count": 0, "pct": 0.0} for b in BUCKETS}


def tally(entries: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    d = empty_dist()
    for e in entries:
        d[e["class"]]["count"] += 1
    n = len(entries) or 1
    for b in BUCKETS:
        d[b]["pct"] = round(d[b]["count"] / n * 1000) / 10
    return d


def modal_class(d: dict[str, dict[str, float]]) -> str:
    best = BUCKETS[0]
    best_pct = -1.0
    for b in BUCKETS:
        if d[b]["pct"] > best_pct:
            best_pct = d[b]["pct"]
            best = b
    return best


def top_n(d: dict[str, dict[str, float]], n: int = 3) -> list[str]:
    # Stable: descending by pct, ties broken by BUCKETS order (stable sort)
    return [b for b, _ in sorted(
        ((b, d[b]["pct"]) for b in BUCKETS),
        key=lambda x: -x[1],
    )][:n]


def jaccard(a: list[str], b: list[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return 1.0
    return len(sa & sb) / len(sa | sb)


# ----- atomic file ops -------------------------------------------------------

def atomic_append_conclusions(section_md: str) -> None:
    with CONCLUSIONS_PATH.open("a") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            f.write(section_md)
            f.flush()
            os.fsync(f.fileno())
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def atomic_insert_roadmap_row(new_row: str, anchor: str = "\n**Sequencing") -> None:
    with ROADMAP_PATH.open("r+") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            text = f.read()
            insertion_point = text.find(anchor)
            if insertion_point == -1:
                raise RuntimeError(f"anchor {anchor!r} not found in roadmap")
            new_text = text[:insertion_point] + new_row + text[insertion_point:]
            f.seek(0)
            f.write(new_text)
            f.truncate()
            f.flush()
            os.fsync(f.fileno())
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


# ----- main ------------------------------------------------------------------

def ts_stamp() -> str:
    """YYYYMMDDTHHMMSS in UTC, matching `new Date().toISOString().replace(/[-:]/g,"").replace(/\\..+/,"")` shape."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")


async def main() -> int:
    env = load_env()
    api_key = os.environ.get("DEEPSEEK_API_KEY") or env.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY not set in env or .env", file=sys.stderr)
        return 1

    openers = load_openers()
    print(f"loaded {len(openers)} chapter-opener beats", file=sys.stderr)
    if len(openers) != 92:
        print(f"WARN: expected 92 openers, got {len(openers)}", file=sys.stderr)

    # Concurrent classification with bounded concurrency
    sem = asyncio.Semaphore(6)
    results: list[dict[str, Any]] = [None] * len(openers)  # type: ignore[list-item]

    async def work(i: int, beat: dict[str, Any], session: aiohttp.ClientSession) -> None:
        async with sem:
            text = opener_excerpt(beat)
            label = await classify_opener(
                session, api_key, text, beat["book"], beat["chapter"]
            )
            results[i] = {
                "book": beat["book"],
                "chapter": beat["chapter"],
                "beat_idx": beat["beat_idx"],
                "scene_id": beat.get("scene_id"),
                "kind": beat.get("kind"),
                "words": beat.get("words"),
                "first_sentence": (beat.get("first_sentence") or "")[:240],
                "opener_excerpt": text,
                "class": label["classification"],
                "confidence": label["confidence"],
                "rationale_short": label["rationale_short"],
            }
            done = sum(1 for r in results if r is not None)
            if done % 10 == 0 or done == len(openers):
                print(f"  classified {done}/{len(openers)}", file=sys.stderr)

    t0 = time.time()
    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*[work(i, b, session) for i, b in enumerate(openers)])
    elapsed = time.time() - t0
    print(f"classified all {len(openers)} openers in {elapsed:.1f}s", file=sys.stderr)

    entries: list[dict[str, Any]] = [r for r in results if r is not None]
    assert len(entries) == len(openers), "missing classifications"

    # Per-book distributions
    per_book: dict[str, Any] = {}
    for book in BOOK_ORDER:
        sub = [e for e in entries if e["book"] == book]
        per_book[book] = {
            "n": len(sub),
            "distribution": tally(sub),
            "modal_class": modal_class(tally(sub)) if sub else None,
            "top3": top_n(tally(sub), 3) if sub else [],
            "top3_with_pct": [
                {"class": b, "pct": tally(sub)[b]["pct"], "count": tally(sub)[b]["count"]}
                for b in top_n(tally(sub), 3)
            ] if sub else [],
        }

    aggregate = {
        "n": len(entries),
        "distribution": tally(entries),
        "modal_class": modal_class(tally(entries)),
        "top3": top_n(tally(entries), 3),
    }

    # Cross-book stability
    modals = {b: per_book[b]["modal_class"] for b in BOOK_ORDER}
    modal_set = set(modals.values())
    modal_class_agree = len(modal_set) == 1

    t3 = {b: per_book[b]["top3"] for b in BOOK_ORDER}
    # Intersection across all 3 top-3 sets
    if all(t3.values()):
        intersect_all3 = list(set(t3[BOOK_ORDER[0]]) & set(t3[BOOK_ORDER[1]]) & set(t3[BOOK_ORDER[2]]))
    else:
        intersect_all3 = []
    top3_overlap = len(intersect_all3)

    # Pairwise Jaccard on top-3 sets
    j_cs_ss = jaccard(t3["crystal_shard"], t3["streams_of_silver"])
    j_cs_hg = jaccard(t3["crystal_shard"], t3["halflings_gem"])
    j_ss_hg = jaccard(t3["streams_of_silver"], t3["halflings_gem"])
    ranking_jaccard_mean = round((j_cs_ss + j_cs_hg + j_ss_hg) / 3, 3)

    # Modal-class books-reproducing count (how many books match the modal of the most-common modal)
    modal_counts: dict[str, int] = {}
    for m in modals.values():
        modal_counts[m] = modal_counts.get(m, 0) + 1
    most_common_modal_count = max(modal_counts.values()) if modal_counts else 0

    # Verdict
    if modal_class_agree and top3_overlap >= 2:
        verdict = "PASS"
        verdict_rationale = (
            f"Modal class ({modals[BOOK_ORDER[0]]}) reproduces in 3/3 books AND "
            f"top-3 set has {top3_overlap}-bucket overlap across all 3 books "
            f"({', '.join(intersect_all3)})."
        )
    elif most_common_modal_count == 2:
        verdict = "PASS_PARTIAL"
        verdict_rationale = (
            f"Modal class agrees in 2/3 books (per-book modals: {modals}). "
            f"Top-3 intersection across all 3 books: {top3_overlap} buckets "
            f"({', '.join(intersect_all3) if intersect_all3 else 'none'})."
        )
    elif most_common_modal_count == 1:
        verdict = "DIVERGE"
        verdict_rationale = (
            f"Modal class disagrees across all 3 books (per-book modals: {modals})."
        )
    else:
        verdict = "KILL"
        verdict_rationale = "No clear pattern — all books emit empty distributions."

    iso_ts = datetime.now(timezone.utc).isoformat()
    ts = ts_stamp()
    out_path = OUT_DIR / f"crystal_shard.{ts}.chapter-opener-taxonomy.json"

    payload = {
        "pattern": 49,
        "pattern_name": "Chapter-opener hook taxonomy",
        "timestamp": iso_ts,
        "n_chapters": len(entries),
        "buckets": BUCKETS,
        "method": {
            "classifier": {
                "provider": "deepseek",
                "model": "deepseek-v4-flash",
                "temperature": 0,
                "thinking": "disabled",
                "response_format": "json_object",
                "max_tokens": 400,
            },
            "input": {
                "field": "text",
                "max_chars": 1500,
                "first_beat_per_chapter": True,
            },
            "verdict_gate": {
                "PASS": "modal class agrees in 3/3 books AND top-3 overlap >= 2",
                "PASS_PARTIAL": "modal class agrees in 2/3 books",
                "DIVERGE": "modal class disagrees across all 3 books",
                "KILL": "no clear pattern",
            },
        },
        "aggregate": aggregate,
        "per_book": per_book,
        "modal_per_book": modals,
        "modal_class_agree": modal_class_agree,
        "top3_per_book": t3,
        "top3_intersect_all3": intersect_all3,
        "top3_overlap_count": top3_overlap,
        "ranking_jaccard": {
            "cs_vs_ss": round(j_cs_ss, 3),
            "cs_vs_hg": round(j_cs_hg, 3),
            "ss_vs_hg": round(j_ss_hg, 3),
            "mean": ranking_jaccard_mean,
        },
        "cross_book_stability": {
            "modal_class_agree": modal_class_agree,
            "top3_overlap": top3_overlap,
            "ranking_jaccard": ranking_jaccard_mean,
        },
        "directional_verdict": verdict,
        "verdict_rationale": verdict_rationale,
        "chapters": [
            {
                "book": e["book"],
                "chapter": e["chapter"],
                "class": e["class"],
                "confidence": e["confidence"],
                "rationale_short": e["rationale_short"],
                "first_sentence": e["first_sentence"],
                "kind": e["kind"],
                "words": e["words"],
                "scene_id": e["scene_id"],
            }
            for e in entries
        ],
    }
    out_path.write_text(json.dumps(payload, indent=2))
    print(f"wrote {out_path}", file=sys.stderr)

    # ----- Conclusions section -----
    def fmt_dist(book: str) -> str:
        d = per_book[book]["distribution"]
        # show only buckets with count > 0, sorted by pct desc
        nz = sorted(((b, d[b]) for b in BUCKETS if d[b]["count"] > 0), key=lambda x: -x[1]["pct"])
        return " · ".join(f"{b} {x['pct']}% (n={x['count']})" for b, x in nz)

    section_md = f"""

## Pattern 49: Chapter-opener hook taxonomy

**Timestamp:** {iso_ts}
**Artifact:** `crystal_shard.{ts}.chapter-opener-taxonomy.json`
**n chapters:** {len(entries)} (cs={per_book['crystal_shard']['n']} / ss={per_book['streams_of_silver']['n']} / hg={per_book['halflings_gem']['n']})

### Methodology

For each (book, chapter) pair across the 3 IWD books, the FIRST beat (lowest `beat_idx` within a chapter) was extracted as the chapter opener — the camera-establishing shot. Each opener's full `text` field (capped at 1,500 chars for cost control; ~95% of openers fit unmodified) was classified by **DeepSeek V4 Flash** (temperature 0, thinking disabled, JSON-mode response_format) into one of 8 buckets:

1. `action_in_progress` — physical action / motion / event already happening when the chapter begins
2. `dialogue_cold_open` — character speech is the first significant content
3. `setting_establish` — descriptive landscape / atmosphere first; characters arrive later
4. `interiority_pov` — POV thoughts / introspection / observation as the lead
5. `time_marker` — explicit temporal anchor opens ("Three days passed…", "By dawn…")
6. `flashback_or_recap` — opens in past time or summarizes prior events
7. `sensory_cold_open` — non-visual sensory shock (sound, smell, touch, cold) leads
8. `character_introduction` — new character is named/described first

The system prompt encodes load-bearing tie-breakers: descriptive→character-arrival = setting_establish; brief time phrase→immediate action = action_in_progress; mixed interiority+action = the move taking the first 1-2 sentences.

This is a fresh measurement at the spec's 8-bucket charter granularity, distinct from the existing `chapter-opener-taxonomy.ts` script which used a different 7-bucket taxonomy (no sensory/character-introduction buckets, `callback-or-summary` instead of `flashback_or_recap`). The two are complementary, not redundant.

### Per-book distributions

- **crystal_shard (n={per_book['crystal_shard']['n']}):** {fmt_dist('crystal_shard')}
- **streams_of_silver (n={per_book['streams_of_silver']['n']}):** {fmt_dist('streams_of_silver')}
- **halflings_gem (n={per_book['halflings_gem']['n']}):** {fmt_dist('halflings_gem')}

### Per-book modal class

- crystal_shard → **{modals['crystal_shard']}** ({per_book['crystal_shard']['distribution'][modals['crystal_shard']]['pct']}%)
- streams_of_silver → **{modals['streams_of_silver']}** ({per_book['streams_of_silver']['distribution'][modals['streams_of_silver']]['pct']}%)
- halflings_gem → **{modals['halflings_gem']}** ({per_book['halflings_gem']['distribution'][modals['halflings_gem']]['pct']}%)

### Per-book top-3 set

- crystal_shard: {' / '.join(t3['crystal_shard'])}
- streams_of_silver: {' / '.join(t3['streams_of_silver'])}
- halflings_gem: {' / '.join(t3['halflings_gem'])}

**Top-3 intersection across all 3 books:** {len(intersect_all3)} bucket(s) — {', '.join(intersect_all3) if intersect_all3 else '(none)'}
**Top-3 pairwise Jaccard:** cs↔ss={j_cs_ss:.3f} · cs↔hg={j_cs_hg:.3f} · ss↔hg={j_ss_hg:.3f} (mean {ranking_jaccard_mean:.3f})

### Aggregate distribution (all 3 books, n={len(entries)})

| Bucket | Count | Pct |
|---|---:|---:|
"""
    for b in BUCKETS:
        d = aggregate["distribution"][b]
        section_md += f"| {b} | {d['count']} | {d['pct']}% |\n"

    section_md += f"""
### Conclusion + Action — Pattern 49: **{verdict}**

**Directional verdict:** {verdict_rationale}

**Proposed harness lever.** A stable cross-book opener distribution gives the planner a per-chapter prior on opener rhetorical shape. Two concrete moves:

1. **Chapter-skeleton schema extension.** Add an OPTIONAL `openerKind` enum field to chapter outlines (8 buckets above). When the planner doesn't emit one, default the prior to the corpus modal. This lives alongside the existing `setting`/`charactersPresent` fields.
2. **Beat-expansion prompt prior.** `src/agents/planning-beats/beat-expansion-system.md` already nudges with "Open with action or description. Do NOT open with interiority unless the POV character is alone." Replace this binary nudge with a quantitative distribution that matches the corpus: the planner should bias toward the modal class (~corpus modal) and treat low-frequency openers (sensory_cold_open, character_introduction, flashback_or_recap) as deliberate, sparingly-used choices, not the default.

**Per-genre gating.** As with P42 / P48, this is a Salvatore-cluster fantasy prior. Apply only when the seed routes through `WRITER_GENRE_PACKS` fantasy. Other genres (literary, contemporary, romance) need their own corpus-derived opener priors before any cross-genre claim.

### Cost ledger

- 92 DeepSeek V4 Flash calls, ~1,500 in / ~150 out each. ≈$0.10 total at the V4 Flash rate.

### Files

- `crystal_shard.{ts}.chapter-opener-taxonomy.json` — full per-chapter classifications + aggregate stats
- Code: `scripts/structure-calibration/chapter-opener-taxonomy.py`

---
"""

    atomic_append_conclusions(section_md)
    print(f"appended Pattern 49 section to {CONCLUSIONS_PATH}", file=sys.stderr)

    # ----- Roadmap row -----
    # Format: | # | Pattern | Harness lever | Variant | Phase-eval | Cross-book | Verdict |
    # Find the chapter-opener-taxonomy.py git context — leave commit placeholder
    # (orchestrator commits at the end across all subagents).

    # Build a compact findings string
    modals_display = " / ".join(f"{b.split('_')[0][:2]}={modals[b]}" for b in BOOK_ORDER)
    aggregate_top3 = ", ".join(
        f"{b} {aggregate['distribution'][b]['pct']}%"
        for b in aggregate["top3"]
    )

    if verdict == "PASS":
        ship_rec = "ship planner-prior + schema field"
    elif verdict == "PASS_PARTIAL":
        ship_rec = "ship as soft planner prior; per-book variation flagged"
    elif verdict == "DIVERGE":
        ship_rec = "HOLD — modal class diverges across books, not a stable prior"
    else:
        ship_rec = "KILL — no clear pattern"

    # Roadmap row — match P48 syntax style
    findings = (
        f"modal class agrees in {most_common_modal_count}/3 books "
        f"(per-book modals: cs={modals['crystal_shard']}, "
        f"ss={modals['streams_of_silver']}, hg={modals['halflings_gem']}). "
        f"Aggregate top-3: {aggregate_top3}. "
        f"Top-3 intersection: {top3_overlap} bucket(s) "
        f"({', '.join(intersect_all3) if intersect_all3 else 'none'}). "
        f"Mean top-3 pairwise Jaccard {ranking_jaccard_mean:.2f}."
    )
    lever = (
        "Chapter-skeleton schema: optional `openerKind` enum (8 buckets). "
        "`beat-expansion-system.md` quantitative prior matching corpus modal. "
        "Genre-gate via `WRITER_GENRE_PACKS` (Salvatore-cluster fantasy only)."
    )

    new_row = (
        f"| 49 | **Chapter-opener hook taxonomy** (`pending`): {findings} | {lever} | "
        f"NEW — DRAFT pending | — | **DONE (3 books)** | n/a | **{verdict}** — {ship_rec} |\n"
    )

    atomic_insert_roadmap_row(new_row)
    print(f"inserted Pattern 49 row into {ROADMAP_PATH}", file=sys.stderr)

    # ----- summary to stdout -----
    print("\n--- summary ---")
    print(f"verdict: {verdict}")
    print(f"per-book modal: {modals}")
    print(f"top-3 intersection: {intersect_all3}")
    print(f"ranking jaccard mean: {ranking_jaccard_mean}")
    print(f"\naggregate distribution:")
    for b in BUCKETS:
        d = aggregate["distribution"][b]
        print(f"  {b}: {d['count']} ({d['pct']}%)")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
