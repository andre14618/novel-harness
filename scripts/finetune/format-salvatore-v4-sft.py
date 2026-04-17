#!/usr/bin/env python3
"""Format Salvatore 1988 training pairs into v4 SFT JSONL.

v4 = v3 + per-speaker example voiced quotes injected into each training
user prompt's CHARACTERS section. Teaches voice-conditional dialogue
generation at beat-writing time. Tracking experiment id=222
("voice-baked-beat-writer").

Changes vs v3:

1. New --dialogue-extract CLI arg pointing at
   novels/salvatore-icewind-dale/analysis/dialogue-extract.jsonl.
   Builds a char → [{beat_id, quote}] index at startup.

2. For each training row (for each beat_id), for each character in
   brief.characters who ALSO appears as a speaker in the extract, sample
   up to 3 quotes from OTHER beats (beat_id != current_beat_id —
   anti-leakage). Deterministic RNG seeded on
   (current_beat_id, char, variant_idx) so same beat → same examples
   (reproducibility) while different beats get different examples
   (diversification).

3. format_characters_section() now accepts examples_by_char and appends
   an "Example voiced lines:" block under each character's profile.
   Characters with 0 attributed lines get profile-only, no block.

4. Rename augmentation applied to example lines the same way it is to
   brief/prose (apply_rename).

5. Manifest at finetune-data/salvatore-1988-v4-manifest.json with
   per-char audit stats (total_lines_in_corpus, beats_speaking_in,
   example_source_diversity = distinct beats drawn from across all
   training rows).

Everything else preserved from v3: rename variants (default 3), retry
variants (default 0.25), paragraph-break guardrail, stratified
train/val split by chapter, _meta alongside messages.

Usage:
  python3 scripts/finetune/format-salvatore-v4-sft.py \\
    --input scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl \\
    --dialogue-extract novels/salvatore-icewind-dale/analysis/dialogue-extract.jsonl \\
    --snapshots scripts/finetune/salvatore-character-snapshots.json \\
    --rename-pool scripts/finetune/salvatore-rename-pool.json \\
    --system-prompt src/agents/writer/beat-writer-system-salvatore.md \\
    --out-dir finetune-data \\
    --val-frac 0.1 --seed 42 \\
    --rename-variants 3 --retry-fraction 0.25
"""

import argparse
import json
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from paragraph_breaks import normalize_breaks, assert_minimum_coverage, measure  # noqa: E402


# ── Harness-shape user-prompt assembly ─────────────────────────────────

def format_characters_section(
    char_names: list[str],
    snapshots: dict,
    examples_by_char: dict[str, list[str]] | None = None,
) -> str:
    """Match src/agents/writer/beat-context.ts::formatCharacterSnapshot,
    plus v4 "Example voiced lines:" block per character.

    Only Voice/Drives/Avoids/Conflict are synthesized here. Production
    adds State/With/Tension/Doesn't-know at runtime when DB state exists
    (usually empty in early chapters — tolerable gap for training)."""
    if not char_names:
        return ""
    examples_by_char = examples_by_char or {}
    lines = ["CHARACTERS:"]
    for i, name in enumerate(char_names):
        snap = snapshots.get(name) or snapshots.get("_default", {})
        lines.append(f"{name}:")
        if snap.get("voice"): lines.append(f"  Voice: {snap['voice']}")
        if snap.get("drives"): lines.append(f"  Drives: {snap['drives']}")
        if snap.get("avoids"): lines.append(f"  Avoids: {snap['avoids']}")
        if snap.get("conflict"): lines.append(f"  Conflict: {snap['conflict']}")
        ex = examples_by_char.get(name) or []
        if ex:
            lines.append("  Example voiced lines:")
            for j, q in enumerate(ex, start=1):
                # Normalize whitespace in the quote and wrap in quotes for clarity.
                q_clean = re.sub(r"\s+", " ", q).strip().strip('"').strip("'")
                lines.append(f'    {j}. "{q_clean}"')
        if i < len(char_names) - 1:
            lines.append("")
    return "\n".join(lines)


def extract_last_sentences(prose: str, count: int = 3) -> str:
    """Match extractLastSentences() from beat-context.ts."""
    sentences = re.split(r"(?<=[.!?])\s+", prose.strip())
    sentences = [s for s in sentences if s.strip()]
    if not sentences:
        return ""
    return " ".join(sentences[-count:])


def first_sentence(text: str) -> str:
    parts = re.split(r"[.!?]", text.strip(), maxsplit=1)
    return parts[0].strip() if parts else ""


def build_user_prompt(
    brief: dict,
    *,
    beat_idx: int,
    total_beats: int,
    prev_beat_prose: str | None,
    next_beat_summary: str | None,
    snapshots: dict,
    examples_by_char: dict[str, list[str]] | None = None,
) -> str:
    """Reproduce the structure of beat-context.ts::buildBeatContext."""
    sections = []

    # 1. Beat spec
    beat_lines = [
        f"BEAT {beat_idx + 1} of {total_beats}",
        f"POV: {brief.get('pov', 'omniscient')}",
        f"Setting: {brief.get('setting', '')}",
        "",
        brief.get("summary", ""),
    ]
    chars = brief.get("characters", []) or []
    if chars:
        beat_lines.append(f"Characters present: {', '.join(chars)}")
    sections.append("\n".join(beat_lines))

    # 2. Transition bridge
    boundary = brief.get("boundary_signal", "")
    if prev_beat_prose and boundary != "scene_start":
        bridge = extract_last_sentences(prev_beat_prose, 3)
        if bridge:
            sections.append(f"TRANSITION BRIDGE (continue from here):\n{bridge}")

    # 3. Landing target
    if next_beat_summary:
        fs = first_sentence(next_beat_summary)
        if fs:
            sections.append(f"LANDING TARGET (end connecting toward this):\nNext beat: {fs}")

    # 4. Characters (with v4 example lines)
    char_section = format_characters_section(chars, snapshots, examples_by_char)
    if char_section:
        sections.append(char_section)

    # 5. Setting (scene_start beats only)
    if boundary == "scene_start" and brief.get("setting"):
        sections.append(f"SETTING: {brief['setting']}\n{brief.get('tone', '')}")

    return "\n\n".join(s for s in sections if s)


# ── Rename augmentation ─────────────────────────────────────────────────

def build_rename_table(
    chars_in_chapter: set[str],
    world_elems_in_chapter: set[str],
    places_in_chapter: set[str],
    items_in_chapter: set[str],
    pool: dict,
    rng: random.Random,
) -> dict[str, str]:
    table = {}
    for orig in chars_in_chapter:
        candidates = pool.get("characters", {}).get(orig, [])
        if candidates:
            table[orig] = rng.choice(candidates)
    for orig in world_elems_in_chapter:
        candidates = pool.get("world_elements", {}).get(orig, [])
        if candidates:
            table[orig] = rng.choice(candidates)
    for orig in places_in_chapter:
        candidates = pool.get("places", {}).get(orig, [])
        if candidates:
            table[orig] = rng.choice(candidates)
    for orig in items_in_chapter:
        candidates = pool.get("items", {}).get(orig, [])
        if candidates:
            table[orig] = rng.choice(candidates)
    return table


def apply_rename(text: str, table: dict[str, str]) -> str:
    if not table:
        return text
    keys = sorted(table.keys(), key=len, reverse=True)
    pattern = re.compile(
        r"\b(" + "|".join(re.escape(k) for k in keys) + r")\b",
        re.IGNORECASE,
    )

    def replace(match):
        key = match.group(1)
        for table_key in keys:
            if table_key.lower() == key.lower():
                return table[table_key]
        return key

    return pattern.sub(replace, text)


def apply_rename_to_brief(brief: dict, table: dict[str, str]) -> dict:
    new = dict(brief)
    if new.get("characters"):
        new["characters"] = [apply_rename(c, table) for c in new["characters"]]
    for field in ("setting", "summary", "tone", "pov"):
        if new.get(field):
            new[field] = apply_rename(new[field], table)
    return new


def collect_entities_in_chapter(
    prose_list: list[str],
    briefs: list[dict],
    pool: dict,
) -> tuple[set[str], set[str], set[str], set[str]]:
    all_text_parts = list(prose_list)
    for brief in briefs:
        for c in (brief.get("characters") or []):
            all_text_parts.append(c)
        for field in ("setting", "summary", "tone", "pov"):
            v = brief.get(field)
            if v:
                all_text_parts.append(v)
    all_text_lower = " ".join(all_text_parts).lower()

    def find_hits(category: str) -> set[str]:
        hits = set()
        for key in pool.get(category, {}):
            if re.search(r"\b" + re.escape(key.lower()) + r"\b", all_text_lower):
                hits.add(key)
        return hits

    return (
        find_hits("characters"),
        find_hits("world_elements"),
        find_hits("places"),
        find_hits("items"),
    )


# ── Retry-variant synthesis (deterministic degradation) ─────────────────

def degrade_event_not_enacted(prose: str, rng: random.Random) -> tuple[str, str]:
    sentences = re.split(r"(?<=[.!?])\s+", prose.strip())
    if len(sentences) < 4:
        return prose, ""
    idx = rng.randint(len(sentences) // 3, (2 * len(sentences)) // 3)
    stripped = sentences[idx].strip()[:120]
    degraded = " ".join(sentences[:idx] + sentences[idx + 1:])
    issue = f"Required action never dramatized — the beat calls for {stripped!r} or equivalent, but the prose moves past it."
    return degraded, issue


def degrade_over_elaboration(prose: str, rng: random.Random) -> tuple[str, str]:
    filler = rng.choice([
        "A long moment stretched in the cold air as unspoken thoughts pooled between them, heavy with every unsaid word that had ever drifted between two people standing too close to what they feared.",
        "The light shifted just so, and for the breath of a single heartbeat it seemed the whole world was carved of something older than stone and more patient than any of them could remember.",
        "Somewhere far away, in a place none of them would ever see, a bell was ringing for a different grief, and the resonance of it passed through the walls like a rumor of sorrow.",
        "One could have counted the seconds by the fall of their breath, each one a small surrender against the vast indifference of the weather and the rock.",
    ])
    paragraphs = prose.split("\n\n")
    if len(paragraphs) < 2:
        return prose, ""
    idx = rng.randint(1, len(paragraphs) - 1)
    degraded = "\n\n".join(paragraphs[:idx] + [filler] + paragraphs[idx:])
    issue = "Prose adds atmospheric content not in the beat — the specified action/exchange is buried under unrelated mood."
    return degraded, issue


def degrade_character_missing(
    prose: str,
    chars: list[str],
    rng: random.Random,
) -> tuple[str, str]:
    if not chars:
        return prose, ""
    victim = rng.choice(chars)
    first = victim.split()[0]
    pattern = re.compile(r"\b" + re.escape(first) + r"\b", re.IGNORECASE)
    if not pattern.search(prose):
        return prose, ""
    degraded = pattern.sub("[redacted]", prose)
    degraded = re.sub(r"\[redacted\][^.!?]*[.!?]", "", degraded)
    degraded = re.sub(r"\s+", " ", degraded).strip()
    issue = f"Character \"{victim}\" is listed as present in this beat but never appears on the page."
    return degraded, issue


def degrade_sequence_reversed(prose: str, rng: random.Random) -> tuple[str, str]:
    sentences = re.split(r"(?<=[.!?])\s+", prose.strip())
    if len(sentences) < 4:
        return prose, ""
    idx = rng.randint(1, len(sentences) - 2)
    sentences[idx], sentences[idx + 1] = sentences[idx + 1], sentences[idx]
    return " ".join(sentences), "Sequence of events in the prose does not match the beat's specified order."


def degrade_tone_mismatch(prose: str, rng: random.Random) -> tuple[str, str]:
    sentences = re.split(r"(?<=[.!?])\s+", prose.strip())
    if len(sentences) < 3:
        return prose, ""
    adverbs = ["wildly", "magnificently", "desperately", "gloriously", "tenderly", "furiously", "catastrophically"]
    for _ in range(2):
        idx = rng.randint(0, len(sentences) - 1)
        adv = rng.choice(adverbs)
        sentences[idx] = re.sub(r"^(\S+)", r"\1 " + adv, sentences[idx], count=1)
    return " ".join(sentences), "Tone in the prose runs more florid/dramatic than the beat's restrained specification."


DEGRADATION_DISTRIBUTION = [
    ("event_not_enacted", 0.40, degrade_event_not_enacted),
    ("over_elaboration", 0.25, degrade_over_elaboration),
    ("character_missing", 0.20, None),
    ("sequence_reversed", 0.08, degrade_sequence_reversed),
    ("tone_mismatch", 0.07, degrade_tone_mismatch),
]


def pick_degradation(rng: random.Random):
    r = rng.random()
    cum = 0
    for name, prob, fn in DEGRADATION_DISTRIBUTION:
        cum += prob
        if r < cum:
            return name, fn
    return "event_not_enacted", degrade_event_not_enacted


def build_retry_user_prompt(
    base_user_prompt: str,
    degraded_prose: str,
    issue_text: str,
) -> str:
    return (
        base_user_prompt
        + "\n\n"
        + "--- TARGETED REWRITE ---\n"
        + "Your previous prose for this beat:\n"
        + "---\n"
        + degraded_prose[:2000].strip()
        + "\n---\n"
        + "Issues found:\n"
        + f"- {issue_text}\n"
        + "Rewrite this beat to address the issues above while preserving what works."
    )


# ── v4: example-quote sampling ─────────────────────────────────────────

def load_char_lines(path: Path) -> dict[str, list[dict]]:
    """Build char → [{beat_id, quote}] index from dialogue-extract.jsonl."""
    index: dict[str, list[dict]] = defaultdict(list)
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            char = rec.get("char")
            quote = rec.get("quote")
            beat_id = rec.get("beat_id")
            if not char or not quote:
                continue
            index[char].append({"beat_id": beat_id, "quote": quote})
    return dict(index)


def sample_examples_for_beat(
    chars: list[str],
    current_beat_id: str | None,
    char_lines: dict[str, list[dict]],
    variant_idx: int,
    n: int = 3,
) -> tuple[dict[str, list[str]], list[str]]:
    """For each character in `chars` present in `char_lines`, sample up to n
    quotes from beats other than current_beat_id. Deterministic per
    (current_beat_id, char, variant_idx).

    Returns (examples_by_char, source_beat_ids_used_flat)."""
    out: dict[str, list[str]] = {}
    source_beats_flat: list[str] = []
    for ch in chars:
        pool = char_lines.get(ch)
        if not pool:
            continue
        # Anti-leakage: strictly exclude the current beat.
        candidates = [r for r in pool if r.get("beat_id") != current_beat_id]
        if not candidates:
            continue
        seed_str = f"{current_beat_id}|{ch}|{variant_idx}"
        rng = random.Random(seed_str)
        k = min(n, len(candidates))
        picks = rng.sample(candidates, k)
        out[ch] = [p["quote"] for p in picks]
        source_beats_flat.extend([p["beat_id"] for p in picks if p.get("beat_id")])
    return out, source_beats_flat


# ── Main ────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--dialogue-extract", required=True, type=Path)
    ap.add_argument("--snapshots", required=True, type=Path)
    ap.add_argument("--rename-pool", required=True, type=Path)
    ap.add_argument("--system-prompt", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--val-frac", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--rename-variants", type=int, default=3)
    ap.add_argument("--retry-fraction", type=float, default=0.25)
    ap.add_argument("--min-break-coverage", type=float, default=0.50)
    ap.add_argument("--examples-per-char", type=int, default=3)
    args = ap.parse_args()

    snapshots = json.loads(args.snapshots.read_text())
    pool = json.loads(args.rename_pool.read_text())
    system_prompt = args.system_prompt.read_text()
    char_lines = load_char_lines(args.dialogue_extract)

    pairs = [json.loads(l) for l in args.input.open() if l.strip()]

    for p in pairs:
        p["prose"] = normalize_breaks(p["prose"])
    assert_minimum_coverage(
        [p["prose"] for p in pairs],
        min_blank_break_pct=args.min_break_coverage,
        dialogue_kinds=["dialogue"],
        kinds=[p["brief"].get("kind", "?") for p in pairs],
    )

    by_chapter: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for p in pairs:
        key = (p["brief"].get("book", "?"), p["brief"].get("chapter", -1))
        by_chapter[key].append(p)
    for key in by_chapter:
        by_chapter[key].sort(key=lambda p: (p["brief"].get("scene_id", ""), p["brief"].get("beat_idx", 0)))

    chapter_rename_tables: dict[tuple, list[dict[str, str]]] = {}
    for key, chapter_pairs in by_chapter.items():
        proses = [p["prose"] for p in chapter_pairs]
        briefs = [p["brief"] for p in chapter_pairs]
        chars_hit, world_hit, places_hit, items_hit = collect_entities_in_chapter(
            proses, briefs, pool,
        )
        variants = []
        for v in range(1, args.rename_variants):
            seed_str = f"{args.seed}:{key[0]}:{key[1]}:{v}"
            chapter_rng = random.Random(seed_str)
            table = build_rename_table(chars_hit, world_hit, places_hit, items_hit, pool, chapter_rng)
            variants.append(table)
        chapter_rename_tables[key] = variants

    rows: list[dict] = []
    retry_rng = random.Random(args.seed ^ 0xC0FFEE)

    # Audit accumulators
    rows_with_examples = 0
    example_source_beats_by_char: dict[str, set[str]] = defaultdict(set)

    for key, chapter_pairs in by_chapter.items():
        total_beats = len(chapter_pairs)
        for i, pair in enumerate(chapter_pairs):
            brief = pair["brief"]
            prose = pair["prose"]
            current_beat_id = brief.get("beat_id")
            prev_prose = chapter_pairs[i - 1]["prose"] if i > 0 else None
            next_summary = chapter_pairs[i + 1]["brief"].get("summary") if i + 1 < total_beats else None

            variants_to_emit = [(0, {})]
            for v_idx, table in enumerate(chapter_rename_tables[key], start=1):
                variants_to_emit.append((v_idx, table))

            for variant_idx, table in variants_to_emit:
                v_brief = apply_rename_to_brief(brief, table) if table else brief
                v_prose = apply_rename(prose, table) if table else prose
                v_prev = apply_rename(prev_prose, table) if (prev_prose and table) else prev_prose
                v_next_summary = apply_rename(next_summary, table) if (next_summary and table) else next_summary

                # Sample examples against ORIGINAL character names (char_lines
                # is keyed on canonical Salvatore names), then rename the
                # output keys + quote text so they match v_brief.
                orig_chars = brief.get("characters", []) or []
                raw_examples, source_beats = sample_examples_for_beat(
                    orig_chars,
                    current_beat_id,
                    char_lines,
                    variant_idx,
                    n=args.examples_per_char,
                )
                # Track audit source-diversity on original-name basis
                for ch, quotes in raw_examples.items():
                    # reconstruct which beats this char was sourced from
                    # (we only get source_beats flat, so re-derive here)
                    pass
                # Precisely track per-char source beats (re-sample to get pairs)
                for ch in orig_chars:
                    pool_ = char_lines.get(ch)
                    if not pool_:
                        continue
                    candidates = [r for r in pool_ if r.get("beat_id") != current_beat_id]
                    if not candidates:
                        continue
                    seed_str = f"{current_beat_id}|{ch}|{variant_idx}"
                    rng_ex = random.Random(seed_str)
                    k = min(args.examples_per_char, len(candidates))
                    picks = rng_ex.sample(candidates, k)
                    for p_ in picks:
                        if p_.get("beat_id"):
                            example_source_beats_by_char[ch].add(p_["beat_id"])

                # Apply rename to quote text AND the dict key (char name)
                examples_by_char: dict[str, list[str]] = {}
                for ch, quotes in raw_examples.items():
                    new_ch = apply_rename(ch, table) if table else ch
                    new_quotes = [apply_rename(q, table) if table else q for q in quotes]
                    examples_by_char[new_ch] = new_quotes

                if examples_by_char:
                    rows_with_examples += 1

                user_prompt = build_user_prompt(
                    v_brief,
                    beat_idx=i,
                    total_beats=total_beats,
                    prev_beat_prose=v_prev,
                    next_beat_summary=v_next_summary,
                    snapshots=snapshots,
                    examples_by_char=examples_by_char,
                )

                rows.append({
                    "_meta": {
                        "beat_id": current_beat_id,
                        "variant": variant_idx,
                        "kind": "base",
                        "chapter_key": f"{key[0]}_ch{key[1]}",
                        "n_chars_with_examples": len(examples_by_char),
                    },
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                        {"role": "assistant", "content": v_prose.strip()},
                    ],
                })

                if retry_rng.random() < args.retry_fraction:
                    deg_name, deg_fn = pick_degradation(retry_rng)
                    if deg_name == "character_missing":
                        degraded, issue = degrade_character_missing(
                            v_prose, v_brief.get("characters", []) or [], retry_rng,
                        )
                    else:
                        degraded, issue = deg_fn(v_prose, retry_rng)
                    if issue:
                        rows.append({
                            "_meta": {
                                "beat_id": current_beat_id,
                                "variant": variant_idx,
                                "kind": f"retry:{deg_name}",
                                "chapter_key": f"{key[0]}_ch{key[1]}",
                                "n_chars_with_examples": len(examples_by_char),
                            },
                            "messages": [
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": build_retry_user_prompt(user_prompt, degraded, issue)},
                                {"role": "assistant", "content": v_prose.strip()},
                            ],
                        })

    # Stratified train/val split
    rng_split = random.Random(args.seed ^ 0xA5A5A5)
    chapter_keys = list(by_chapter.keys())
    rng_split.shuffle(chapter_keys)
    n_val = max(1, int(len(chapter_keys) * args.val_frac))
    val_keys = set(chapter_keys[:n_val])

    def meta_key(r):
        ck = r["_meta"]["chapter_key"]
        book, ch = ck.rsplit("_ch", 1)
        # Chapter can be an int ("14") or a string label ("epilogue", "part1");
        # preserve either form — val_keys uses the same coercion.
        try:
            return (book, int(ch))
        except ValueError:
            return (book, ch)

    train_rows = [r for r in rows if meta_key(r) not in val_keys]
    val_rows = [r for r in rows if meta_key(r) in val_keys]
    rng_split.shuffle(train_rows)
    rng_split.shuffle(val_rows)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    train_path = args.out_dir / "salvatore-1988-v4-sft-train.jsonl"
    val_path = args.out_dir / "salvatore-1988-v4-sft-val.jsonl"
    manifest_path = args.out_dir / "salvatore-1988-v4-manifest.json"

    def emit(rows: list[dict], path: Path):
        with path.open("w") as f:
            for r in rows:
                out = {"messages": r["messages"], "_meta": r["_meta"]}
                f.write(json.dumps(out) + "\n")

    emit(train_rows, train_path)
    emit(val_rows, val_path)

    # ── Manifest ────────────────────────────────────────────────────────
    beats_speaking_in: dict[str, set[str]] = defaultdict(set)
    for ch, recs in char_lines.items():
        for r in recs:
            if r.get("beat_id"):
                beats_speaking_in[ch].add(r["beat_id"])

    manifest = {
        "experiment_id": 222,
        "adapter_lineage": "salvatore-1988-v4 (voice-baked-beat-writer)",
        "source_pairs": len(pairs),
        "emitted_rows": len(rows),
        "train_rows": len(train_rows),
        "val_rows": len(val_rows),
        "rows_with_at_least_one_example_block": rows_with_examples,
        "examples_per_char": args.examples_per_char,
        "per_character": {
            ch: {
                "total_lines_in_corpus": len(char_lines.get(ch, [])),
                "beats_speaking_in": len(beats_speaking_in.get(ch, set())),
                "example_source_diversity": len(example_source_beats_by_char.get(ch, set())),
            }
            for ch in sorted(char_lines.keys())
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2))

    # ── Report ──────────────────────────────────────────────────────────
    cov = measure([p["prose"] for p in pairs])
    base_count = sum(1 for r in rows if r["_meta"]["kind"] == "base")
    retry_count = sum(1 for r in rows if r["_meta"]["kind"].startswith("retry:"))
    retry_by_kind: dict[str, int] = defaultdict(int)
    for r in rows:
        if r["_meta"]["kind"].startswith("retry:"):
            retry_by_kind[r["_meta"]["kind"]] += 1

    total_lines = sum(len(v) for v in char_lines.values())
    n_chars = len(char_lines)

    print(f"=== Salvatore v4 SFT format (voice-baked, exp #222) ===")
    print(f"Source pairs: {len(pairs)}")
    print(f"Chapters: {len(by_chapter)}")
    print(f"Paragraph-break coverage: {cov.summary()}")
    print(f"Rename variants: {args.rename_variants} (1 original + {args.rename_variants - 1} renamed per chapter)")
    print()
    print(f"Attributed dialogue: {total_lines} lines across {n_chars} distinct characters")
    top = sorted(char_lines.items(), key=lambda kv: -len(kv[1]))
    count_strs = [f"{ch} {len(recs)}" for ch, recs in top]
    print(f"Per-character line counts: {', '.join(count_strs)}")
    pct = 100.0 * rows_with_examples / max(1, len(rows))
    print(f"Training rows with at-least-one-example-block: {rows_with_examples} of {len(rows)} ({pct:.1f}%)")
    print()
    print(f"Emitted rows: {len(rows)}")
    print(f"  base (brief → prose):  {base_count}")
    print(f"  retry variants:        {retry_count}")
    for k, n in sorted(retry_by_kind.items()):
        print(f"    {k}: {n}")
    print()
    print(f"Train split: {len(train_rows)} rows / {len(chapter_keys) - n_val} chapters")
    print(f"Val split:   {len(val_rows)} rows / {n_val} chapters")
    print()
    print(f"Train    → {train_path}")
    print(f"Val      → {val_path}")
    print(f"Manifest → {manifest_path}")


if __name__ == "__main__":
    main()
