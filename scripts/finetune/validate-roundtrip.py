#!/usr/bin/env python3
"""Stage 6: Round-trip brief→prose validation.

Tests whether the structured brief contains enough information for a writer
model to reconstruct prose matching the original's length, style, and beats.

Two modes:
  prepare: writes per-beat writer prompts to a dir (one prompt per file)
  merge:   combines writer reconstructions with originals + scores them

Score delta per beat (original vs reconstruction):
  - length_delta_pct: |orig_words - recon_words| / orig_words
  - sent_len_delta:   |orig avg sentence words - recon avg|
  - dial_ratio_delta: |orig dialogue ratio - recon dialogue ratio|
  - clause_delta:     |orig clause complexity - recon clause complexity|
  - sensory_delta:    |orig sensory density - recon sensory density|
  - ngram_overlap_4:  Jaccard 4-gram overlap (0-1) — note: high overlap is
                      not the goal; we want style match, not verbatim recall

Stratified sampling picks N beats per kind (default 5 each; dialogue, action,
interiority, description) for 20 beats total.

Usage:
  # Step 1: Prepare prompts + sample manifest
  python3 scripts/finetune/validate-roundtrip.py prepare \
    --input scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl \
    --prompt-dir /tmp/roundtrip-prompts \
    --per-kind 5 \
    --seed 42

  # Step 2: (Claude Code runs writer sub-agents — Sonnet as reference ceiling)

  # Step 3: Score
  python3 scripts/finetune/validate-roundtrip.py score \
    --input scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl \
    --results-dir /tmp/roundtrip-results \
    --prompt-dir /tmp/roundtrip-prompts \
    --output scripts/lora-data/salvatore-1988-roundtrip-scores.jsonl
"""

import argparse
import json
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from style_features import compute_style  # noqa: E402


WRITER_PROMPT = """You are writing a single beat of prose for an Icewind Dale Trilogy-style fantasy novel. The target voice is R.A. Salvatore's 1988 action-pulp: direct sentences, physical specificity, dialogue-driven.

## Beat brief

- **Characters present:** {characters}
- **POV:** {pov}
- **Setting:** {setting}
- **Tone:** {tone}
- **Kind:** {kind}
- **Transition in:** {transition_in}
- **Boundary signal:** {boundary_signal}
- **Summary:** {summary}

## Target rhythm

Write approximately **{words} words**. Aim for ~18w average sentences. {kind_guidance}

## Rules

- Write ONLY the prose. No preamble, no commentary, no header.
- Third-person {pov_mode}.
- Do not quote, reference, or acknowledge this prompt.
- Match the beat's dramatic function described in the summary.

Write the beat now.
"""

KIND_GUIDANCE = {
    "dialogue": "Heavy quoted exchanges with brief action tags. Target ~0.65 dialogue ratio.",
    "action": "Physical movement, combat, environmental beats. Keep dialogue to a minimum (<0.2 ratio).",
    "interiority": "POV character's reflection, decision, or emotional shift. Minimal dialogue.",
    "description": "Setting, atmosphere, sensory texture. Longer sentences (~22w), high clause complexity.",
}


def cmd_prepare(args):
    random.seed(args.seed)
    pairs = [json.loads(l) for l in open(args.input)]

    by_kind = {}
    for p in pairs:
        k = p["brief"].get("kind", "?")
        if k not in {"dialogue", "action", "interiority", "description"}:
            continue
        by_kind.setdefault(k, []).append(p)

    sample = []
    for k in ("dialogue", "action", "interiority", "description"):
        bucket = by_kind.get(k, [])
        random.shuffle(bucket)
        sample.extend(bucket[: args.per_kind])

    prompt_dir = Path(args.prompt_dir)
    prompt_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    for i, p in enumerate(sample):
        b = p["brief"]
        pov = b.get("pov", "omniscient")
        pov_mode = "limited" if pov != "omniscient" else "omniscient"
        prompt = WRITER_PROMPT.format(
            characters=", ".join(b.get("characters", [])) or "(none specified)",
            pov=pov,
            setting=b.get("setting", ""),
            tone=b.get("tone", ""),
            kind=b.get("kind", ""),
            transition_in=b.get("transition_in", ""),
            boundary_signal=b.get("boundary_signal", ""),
            summary=b.get("summary", ""),
            words=b.get("words", 100),
            kind_guidance=KIND_GUIDANCE.get(b.get("kind", ""), ""),
            pov_mode=pov_mode,
        )
        prompt_file = prompt_dir / f"sample_{i:02d}_{b['beat_id']}.txt"
        prompt_file.write_text(prompt)
        manifest.append({
            "sample_idx": i,
            "beat_id": b["beat_id"],
            "kind": b.get("kind", ""),
            "prompt_file": str(prompt_file),
            "target_words": b.get("words", 0),
        })

    (prompt_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Prepared {len(sample)} round-trip prompts ({args.per_kind} per kind)")
    print(f"Manifest: {prompt_dir / 'manifest.json'}")


WORD_RE = re.compile(r"\b[a-zA-Z']+\b")


def ngram_jaccard(a: str, b: str, n: int = 4) -> float:
    def grams(text):
        words = WORD_RE.findall(text.lower())
        return {tuple(words[i:i+n]) for i in range(len(words) - n + 1)}
    ga, gb = grams(a), grams(b)
    if not ga or not gb:
        return 0.0
    return round(len(ga & gb) / len(ga | gb), 3)


def cmd_score(args):
    pairs = [json.loads(l) for l in open(args.input)]
    beat_map = {p["brief"]["beat_id"]: p for p in pairs}

    manifest = json.load(open(Path(args.prompt_dir) / "manifest.json"))
    results_dir = Path(args.results_dir)

    scores = []
    missing = 0
    for entry in manifest:
        beat_id = entry["beat_id"]
        result_file = results_dir / f"sample_{entry['sample_idx']:02d}_{beat_id}.txt"
        if not result_file.exists():
            missing += 1
            print(f"MISSING: {result_file}")
            continue

        recon = result_file.read_text().strip()
        orig_pair = beat_map[beat_id]
        orig_prose = orig_pair["prose"]
        orig_style = orig_pair["brief"]["style"]
        recon_style = compute_style(recon)

        orig_words = len(orig_prose.split())
        recon_words = len(recon.split())

        scores.append({
            "beat_id": beat_id,
            "kind": entry["kind"],
            "target_words": entry["target_words"],
            "orig_words": orig_words,
            "recon_words": recon_words,
            "length_delta_pct": round(abs(orig_words - recon_words) / max(orig_words, 1), 3),
            "sent_len_delta": round(abs(orig_style["avg_sentence_words"] - recon_style["avg_sentence_words"]), 2),
            "dial_ratio_delta": round(abs(orig_style["dialogue_ratio"] - recon_style["dialogue_ratio"]), 2),
            "clause_delta": round(abs(orig_style["clause_complexity"] - recon_style["clause_complexity"]), 2),
            "sensory_delta": round(abs(orig_style["sensory_density"] - recon_style["sensory_density"]), 2),
            "ngram_overlap_4": ngram_jaccard(orig_prose, recon, 4),
            "orig_style": orig_style,
            "recon_style": recon_style,
            "orig_prose": orig_prose,
            "reconstruction": recon,
        })

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w") as f:
        for s in scores:
            f.write(json.dumps(s) + "\n")

    print(f"\n=== Round-trip scores ({len(scores)} beats, missing {missing}) ===")
    by_kind = {}
    for s in scores:
        by_kind.setdefault(s["kind"], []).append(s)

    def avg(xs):
        return sum(xs) / len(xs) if xs else 0

    print(f"{'kind':>12} {'n':>3} {'len%':>7} {'sent':>7} {'dial':>7} {'clause':>7} {'sens':>7} {'4gram':>7}")
    for k in ("dialogue", "action", "interiority", "description"):
        xs = by_kind.get(k, [])
        if not xs:
            continue
        print(f"{k:>12} {len(xs):>3} "
              f"{avg([x['length_delta_pct'] for x in xs]):>7.2f} "
              f"{avg([x['sent_len_delta'] for x in xs]):>7.2f} "
              f"{avg([x['dial_ratio_delta'] for x in xs]):>7.2f} "
              f"{avg([x['clause_delta'] for x in xs]):>7.2f} "
              f"{avg([x['sensory_delta'] for x in xs]):>7.2f} "
              f"{avg([x['ngram_overlap_4'] for x in xs]):>7.3f}")

    print(f"\nOutput: {output}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")

    prep = sub.add_parser("prepare")
    prep.add_argument("--input", required=True, type=Path)
    prep.add_argument("--prompt-dir", required=True, type=Path)
    prep.add_argument("--per-kind", type=int, default=5)
    prep.add_argument("--seed", type=int, default=42)

    sc = sub.add_parser("score")
    sc.add_argument("--input", required=True, type=Path)
    sc.add_argument("--results-dir", required=True, type=Path)
    sc.add_argument("--prompt-dir", required=True, type=Path)
    sc.add_argument("--output", required=True, type=Path)

    args = ap.parse_args()
    if args.cmd == "prepare":
        cmd_prepare(args)
    elif args.cmd == "score":
        cmd_score(args)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
