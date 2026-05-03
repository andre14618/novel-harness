#!/usr/bin/env python3
"""Format Salvatore 1988 training pairs into v3 SFT JSONL.

v3 changes over v2 (see docs/voice-lora-salvatore.md §8, exp #195):

1. Harness-shaped user prompts. Production user prompts come from
   src/agents/writer/beat-context.ts:buildBeatContext, which assembles:
     BEAT {n+1} of {total}
     POV: {pov}
     Setting: {setting}
     {beat.description}
     Characters present: {chars}

     TRANSITION BRIDGE (continue from here):
     {last 2-3 sentences of previous beat's prose}

     LANDING TARGET (end connecting toward this):
     Next beat: {first sentence of next beat}

     CHARACTERS:
     {Name}:
       Voice: ...
       Drives: ...
       Avoids: ...
       Conflict: ...

     SETTING: {setting}
     {description}

   v2 trained against a minimal 9-field brief. At inference the LoRA saw
   this richer shape and failed — bridge regurgitation, required-fact
   misses, character-presence gaps. v3 reshapes every training pair to
   this format.

2. Rename augmentation (3 variants per chapter: 1 original + 2 renamed).
   Per-chapter rename tables pull names/world-elements/places/items from
   scripts/finetune/salvatore-rename-pool.json. Each chapter's variant 1
   and variant 2 use fresh rename tables so no single replacement name
   becomes a new memorization target. Decouples voice (preserved byte-
   identical in assistant output modulo proper-noun tokens) from
   entity identity (the LoRA learns "name slot is parametric").

3. Retry variants (~25% of pairs). Synthetic TARGETED REWRITE blocks
   paired with deterministically-degraded prior prose and an issues
   list. Targets the production retry shape from drafting.ts:163. Issue
   types calibrated from production failure analysis (2026-04-16):

     event_not_enacted   40%  strip a sentence enacting a brief requirement
     over_elaboration    25%  insert unrelated embellishment paragraph
     character_missing   20%  regex-remove a character's name mentions
     sequence_reversed    8%  swap two adjacent sentences
     tone_mismatch        7%  inject florid adverb cluster

   Assistant output is the real Salvatore prose — the LoRA learns "here
   is voice-correct but plot-broken prose, fix ONLY the flagged issue
   while preserving everything else."

Paragraph-break guardrail (paragraph_breaks.py) runs before emit.

Usage:
  python3 scripts/finetune/format-salvatore-v3-sft.py \\
    --input scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl \\
    --snapshots scripts/finetune/salvatore-character-snapshots.json \\
    --rename-pool scripts/finetune/salvatore-rename-pool.json \\
    --system-prompt src/agents/writer/beat-writer-system-salvatore.md \\
    --out-dir finetune-data \\
    --val-frac 0.1 --seed 42 \\
    --rename-variants 3 --retry-fraction 0.25
"""

import argparse
import hashlib
import json
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from paragraph_breaks import normalize_breaks, assert_minimum_coverage, measure  # noqa: E402


# ── Harness-shape user-prompt assembly ─────────────────────────────────

def format_characters_section(char_names: list[str], snapshots: dict) -> str:
    """Match src/agents/writer/beat-context.ts::formatCharacterSnapshot.

    Only Voice/Drives/Avoids/Conflict are synthesized here. Production
    adds State/With/Tension/Doesn't-know at runtime when DB state exists
    (usually empty in early chapters — tolerable gap for training)."""
    if not char_names:
        return ""
    lines = ["CHARACTERS:"]
    for i, name in enumerate(char_names):
        snap = snapshots.get(name) or snapshots.get("_default", {})
        lines.append(f"{name}:")
        if snap.get("voice"): lines.append(f"  Voice: {snap['voice']}")
        if snap.get("drives"): lines.append(f"  Drives: {snap['drives']}")
        if snap.get("avoids"): lines.append(f"  Avoids: {snap['avoids']}")
        if snap.get("conflict"): lines.append(f"  Conflict: {snap['conflict']}")
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

    # 2. Transition bridge — skip for scene_start beats (matches inference logic:
    # production only sends bridge when previousBeatProse exists in the chapter,
    # which doesn't happen on scene boundaries).
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

    # 4. Characters
    char_section = format_characters_section(chars, snapshots)
    if char_section:
        sections.append(char_section)

    # 5. Setting (scene_start beats only — matches beatIndex==0-or-location-change)
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
    """Pick a fresh rename for every blocklisted entity present in this chapter.
    Returns {original_token: replacement_token} dict. Only includes entities
    that actually appear in this chapter's prose."""
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
    """Whole-word substitution respecting word boundaries. Case-insensitive
    match but preserves replacement casing from the pool. Longer keys first
    to prevent 'drow' substring-matching inside 'drow elves'."""
    if not table:
        return text
    # Sort by length desc so 'drow elves' beats 'drow' in regex alternation
    keys = sorted(table.keys(), key=len, reverse=True)
    # Build a case-insensitive pattern with word-boundary guards
    pattern = re.compile(
        r"\b(" + "|".join(re.escape(k) for k in keys) + r")\b",
        re.IGNORECASE,
    )

    def replace(match):
        key = match.group(1)
        # Match original's case on a best-effort basis — for proper nouns
        # the pool entries are already correctly cased
        for table_key in keys:
            if table_key.lower() == key.lower():
                return table[table_key]
        return key

    return pattern.sub(replace, text)


def apply_rename_to_brief(brief: dict, table: dict[str, str]) -> dict:
    """Apply rename table to brief's character/setting/summary fields."""
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
    """Find which pool entries appear in this chapter's prose OR any brief
    field (characters / setting / summary / tone / pov). Scanning only the
    prose misses entities like 'Mithril Hall' that appear in the brief's
    setting field but not the paraphrased prose."""
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
    """Strip a sentence from the middle of the prose. Issue points at it."""
    sentences = re.split(r"(?<=[.!?])\s+", prose.strip())
    if len(sentences) < 4:
        return prose, ""
    # Strip from the middle third
    idx = rng.randint(len(sentences) // 3, (2 * len(sentences)) // 3)
    stripped = sentences[idx].strip()[:120]
    degraded = " ".join(sentences[:idx] + sentences[idx + 1:])
    issue = f"Required action never dramatized — the beat calls for {stripped!r} or equivalent, but the prose moves past it."
    return degraded, issue


def degrade_over_elaboration(prose: str, rng: random.Random) -> tuple[str, str]:
    """Insert an unrelated florid paragraph mid-prose."""
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
    """Remove all mentions of one listed character from the prose."""
    if not chars:
        return prose, ""
    victim = rng.choice(chars)
    first = victim.split()[0]
    pattern = re.compile(r"\b" + re.escape(first) + r"\b", re.IGNORECASE)
    if not pattern.search(prose):
        return prose, ""
    degraded = pattern.sub("[redacted]", prose)
    # Clean up any now-awkward sentences
    degraded = re.sub(r"\[redacted\][^.!?]*[.!?]", "", degraded)
    degraded = re.sub(r"\s+", " ", degraded).strip()
    issue = f"Character \"{victim}\" is listed as present in this beat but never appears on the page."
    return degraded, issue


def degrade_sequence_reversed(prose: str, rng: random.Random) -> tuple[str, str]:
    """Swap two adjacent sentences."""
    sentences = re.split(r"(?<=[.!?])\s+", prose.strip())
    if len(sentences) < 4:
        return prose, ""
    idx = rng.randint(1, len(sentences) - 2)
    sentences[idx], sentences[idx + 1] = sentences[idx + 1], sentences[idx]
    return " ".join(sentences), "Sequence of events in the prose does not match the beat's specified order."


def degrade_tone_mismatch(prose: str, rng: random.Random) -> tuple[str, str]:
    """Inject florid adverb clusters into 2 sentences."""
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
    ("character_missing", 0.20, None),  # special — needs character list
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
    """Match the TARGETED REWRITE shape from src/phases/drafting.ts:163."""
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


# ── Main ────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--snapshots", required=True, type=Path)
    ap.add_argument("--rename-pool", required=True, type=Path)
    ap.add_argument("--system-prompt", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--val-frac", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--rename-variants", type=int, default=3,
                    help="Number of per-chapter variants (variant 0 = original). 1 = no augmentation. 3 = original + 2 renamed.")
    ap.add_argument("--retry-fraction", type=float, default=0.25,
                    help="Fraction of base pairs to also emit as a retry-shape variant.")
    ap.add_argument("--min-break-coverage", type=float, default=0.50)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    snapshots = json.loads(args.snapshots.read_text())
    pool = json.loads(args.rename_pool.read_text())
    system_prompt = args.system_prompt.read_text()

    pairs = [json.loads(l) for l in args.input.open() if l.strip()]

    # Paragraph-break normalization + guardrail (same as v2)
    for p in pairs:
        p["prose"] = normalize_breaks(p["prose"])
    assert_minimum_coverage(
        [p["prose"] for p in pairs],
        min_blank_break_pct=args.min_break_coverage,
        dialogue_kinds=["dialogue"],
        kinds=[p["brief"].get("kind", "?") for p in pairs],
    )

    # Group by (book, chapter) so we can find prev/next beats in the same chapter
    # and build per-chapter rename tables.
    by_chapter: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for p in pairs:
        key = (p["brief"].get("book", "?"), p["brief"].get("chapter", -1))
        by_chapter[key].append(p)
    for key in by_chapter:
        by_chapter[key].sort(key=lambda p: (p["brief"].get("scene_id", ""), p["brief"].get("beat_idx", 0)))

    # Build per-chapter rename tables for each non-zero variant
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

    # Emit rows. For each pair, emit N variants (variant 0 original + N-1 renamed).
    rows: list[dict] = []
    retry_rng = random.Random(args.seed ^ 0xC0FFEE)

    for key, chapter_pairs in by_chapter.items():
        total_beats = len(chapter_pairs)
        for i, pair in enumerate(chapter_pairs):
            brief = pair["brief"]
            prose = pair["prose"]
            prev_prose = chapter_pairs[i - 1]["prose"] if i > 0 else None
            next_summary = chapter_pairs[i + 1]["brief"].get("summary") if i + 1 < total_beats else None

            # Variant 0 — original
            variants_to_emit = [(0, {})]
            for v_idx, table in enumerate(chapter_rename_tables[key], start=1):
                variants_to_emit.append((v_idx, table))

            for variant_idx, table in variants_to_emit:
                v_brief = apply_rename_to_brief(brief, table) if table else brief
                v_prose = apply_rename(prose, table) if table else prose
                v_prev = apply_rename(prev_prose, table) if (prev_prose and table) else prev_prose
                v_next_summary = apply_rename(next_summary, table) if (next_summary and table) else next_summary

                user_prompt = build_user_prompt(
                    v_brief,
                    beat_idx=i,
                    total_beats=total_beats,
                    prev_beat_prose=v_prev,
                    next_beat_summary=v_next_summary,
                    snapshots=snapshots,
                )

                rows.append({
                    "_meta": {
                        "beat_id": brief.get("beat_id"),
                        "variant": variant_idx,
                        "kind": "base",
                        "chapter_key": f"{key[0]}_ch{key[1]}",
                    },
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                        {"role": "assistant", "content": v_prose.strip()},
                    ],
                })

                # Optional retry variant — emit on all variants so the TARGETED
                # REWRITE format is represented across rename variants too.
                # Rename-variant retries diversify the prior-prose the model
                # sees in the TARGETED REWRITE block.
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
                                "beat_id": brief.get("beat_id"),
                                "variant": variant_idx,
                                "kind": f"retry:{deg_name}",
                                "chapter_key": f"{key[0]}_ch{key[1]}",
                            },
                            "messages": [
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": build_retry_user_prompt(user_prompt, degraded, issue)},
                                {"role": "assistant", "content": v_prose.strip()},
                            ],
                        })

    # Stratified train/val split — all variants of a chapter go together.
    rng_split = random.Random(args.seed ^ 0xA5A5A5)
    chapter_keys = list(by_chapter.keys())
    rng_split.shuffle(chapter_keys)
    n_val = max(1, int(len(chapter_keys) * args.val_frac))
    val_keys = set(chapter_keys[:n_val])
    train_rows = [r for r in rows if (r["_meta"]["chapter_key"].rsplit("_ch", 1)[0], int(r["_meta"]["chapter_key"].rsplit("_ch", 1)[1])) not in val_keys]
    val_rows = [r for r in rows if (r["_meta"]["chapter_key"].rsplit("_ch", 1)[0], int(r["_meta"]["chapter_key"].rsplit("_ch", 1)[1])) in val_keys]

    rng_split.shuffle(train_rows)
    rng_split.shuffle(val_rows)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    train_path = args.out_dir / "salvatore-1988-v3-sft-train.jsonl"
    val_path = args.out_dir / "salvatore-1988-v3-sft-val.jsonl"

    def emit(rows: list[dict], path: Path):
        with path.open("w") as f:
            for r in rows:
                # Keep _meta alongside messages. ART/W&B SFT reads only the
                # "messages" field; extras are ignored by the trainer but
                # let the validator separate variant 0 (originals, Salvatore
                # tokens expected) from variants 1+ (rename-augmented,
                # Salvatore tokens are a defect).
                out = {"messages": r["messages"], "_meta": r["_meta"]}
                f.write(json.dumps(out) + "\n")

    emit(train_rows, train_path)
    emit(val_rows, val_path)

    # ── Report ──────────────────────────────────────────────────────────

    cov = measure([p["prose"] for p in pairs])
    base_count = sum(1 for r in rows if r["_meta"]["kind"] == "base")
    retry_count = sum(1 for r in rows if r["_meta"]["kind"].startswith("retry:"))
    retry_by_kind = defaultdict(int)
    for r in rows:
        if r["_meta"]["kind"].startswith("retry:"):
            retry_by_kind[r["_meta"]["kind"]] += 1

    print(f"=== Salvatore v3 SFT format ===")
    print(f"Source pairs: {len(pairs)}")
    print(f"Chapters: {len(by_chapter)}")
    print(f"Paragraph-break coverage: {cov.summary()}")
    print(f"Rename variants: {args.rename_variants} (1 original + {args.rename_variants - 1} renamed per chapter)")
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
    print(f"Train → {train_path}")
    print(f"Val   → {val_path}")


if __name__ == "__main__":
    main()
