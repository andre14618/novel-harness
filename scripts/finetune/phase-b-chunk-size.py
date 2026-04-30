#!/usr/bin/env python3
"""Phase B: Chunk-size A/B on DeepSeek V3.2.

Validates the ~100w beat target before committing to LoRA training. Takes
15 real Salvatore briefs (5 per kind: dialogue/action/description), asks
DeepSeek to generate at three chunk sizes (80w / 120w / 160w), and scores
the resulting prose against the Salvatore aggregate style baseline.

Salvatore baseline (from 777-beat corpus):
  avg_sentence_words: 18.3
  dialogue_ratio:     0.28
  clause_complexity:  0.62
  sensory_density:    1.56 hits/100w

The chunk size whose generations land closest to baseline wins, and that
confirms (or rejects) the calibrated ~100w target.

Usage:
  export DEEPSEEK_API_KEY=...  (or source .env)
  python3 scripts/finetune/phase-b-chunk-size.py \
    --input scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl \
    --output scripts/lora-data/phase-b-chunk-size-results.jsonl \
    --per-kind 5 \
    --concurrency 6
"""

import argparse
import asyncio
import json
import os
import random
import sys
from pathlib import Path

import urllib.request
import urllib.error

sys.path.insert(0, str(Path(__file__).parent))
from style_features import compute_style  # noqa: E402

CHUNK_SIZES = [80, 120, 160]

SALVATORE_BASELINE = {
    "avg_sentence_words": 18.3,
    "dialogue_ratio": 0.28,
    "clause_complexity": 0.62,
    "sensory_density": 1.56,
}

SYSTEM_PROMPT = """You are writing a single beat of prose in the action-pulp fantasy voice of R.A. Salvatore's 1988 Icewind Dale Trilogy.

Style targets:
- Direct, declarative sentences with physical specificity
- Dialogue-heavy beats get short tags, interiority beats stay short on speech
- Sentence length averages ~18 words but varies: mix short punchy lines with occasional long cascading sentences
- Sensory grounding in sight, sound, touch — cold, wind, firelight, steel
- No meta-commentary, no preamble, no headers

Write ONLY the prose. Match the word count and dramatic function specified."""


def format_brief_prompt(brief: dict, target_words: int) -> str:
    chars = ", ".join(brief.get("characters", [])) or "(none specified)"
    pov = brief.get("pov", "omniscient")
    return (
        f"**Characters:** {chars}\n"
        f"**POV:** {pov}\n"
        f"**Setting:** {brief.get('setting', '')}\n"
        f"**Tone:** {brief.get('tone', '')}\n"
        f"**Kind:** {brief.get('kind', '')}\n"
        f"**Transition in:** {brief.get('transition_in', '')}\n"
        f"**Boundary signal:** {brief.get('boundary_signal', '')}\n"
        f"**Target words:** ~{target_words}\n"
        f"**Summary:** {brief.get('summary', '')}\n"
    )


def load_api_key() -> str:
    key = os.environ.get("DEEPSEEK_API_KEY")
    if key:
        return key
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("DEEPSEEK_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("ERROR: DEEPSEEK_API_KEY not set and not in .env")


def call_deepseek_sync(api_key: str, system: str, user: str) -> str:
    body = json.dumps({
        "model": "deepseek-v4-flash",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.7,
        "max_tokens": 500,
    }).encode()
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.load(resp)
        return data["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")[:200]
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e


async def call_deepseek(api_key: str, system: str, user: str, sem: asyncio.Semaphore) -> str:
    async with sem:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, call_deepseek_sync, api_key, system, user)


async def run_one(api_key: str, brief: dict, chunk_size: int, sem: asyncio.Semaphore) -> dict:
    prompt = format_brief_prompt(brief, chunk_size)
    try:
        prose = await call_deepseek(api_key, SYSTEM_PROMPT, prompt, sem)
    except Exception as e:
        return {"beat_id": brief["beat_id"], "chunk_size": chunk_size, "error": str(e)}
    style = compute_style(prose)
    return {
        "beat_id": brief["beat_id"],
        "kind": brief["kind"],
        "chunk_size": chunk_size,
        "target_words": chunk_size,
        "recon_words": len(prose.split()),
        "style": style,
        "prose": prose,
    }


async def main_async(args):
    random.seed(args.seed)
    pairs = [json.loads(l) for l in open(args.input)]

    by_kind = {}
    for p in pairs:
        k = p["brief"].get("kind", "?")
        if k not in {"dialogue", "action", "description"}:
            continue
        by_kind.setdefault(k, []).append(p["brief"])

    sample = []
    for k in ("dialogue", "action", "description"):
        bucket = by_kind.get(k, [])
        random.shuffle(bucket)
        sample.extend(bucket[: args.per_kind])

    api_key = load_api_key()
    sem = asyncio.Semaphore(args.concurrency)

    tasks = []
    for brief in sample:
        for size in CHUNK_SIZES:
            tasks.append(run_one(api_key, brief, size, sem))

    print(f"Running {len(tasks)} DeepSeek calls ({len(sample)} briefs × {len(CHUNK_SIZES)} sizes, concurrency {args.concurrency})")
    results = []
    for coro in asyncio.as_completed(tasks):
        r = await coro
        results.append(r)
        mark = "!" if "error" in r else "."
        sys.stdout.write(mark)
        sys.stdout.flush()
    print()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")

    # Analysis
    by_size = {s: [] for s in CHUNK_SIZES}
    errors = 0
    for r in results:
        if "error" in r:
            errors += 1
            continue
        by_size[r["chunk_size"]].append(r)

    print(f"\n=== Phase B: chunk-size A/B on DeepSeek V3.2 ===")
    print(f"Successful calls: {len(results) - errors}/{len(results)} (errors: {errors})")
    print(f"\nBaseline (Salvatore 777-beat corpus):")
    for k, v in SALVATORE_BASELINE.items():
        print(f"  {k:>20}: {v:.2f}")

    print(f"\n{'size':>6} {'n':>3} {'words':>7} {'sent':>6} {'dial':>6} {'clause':>7} {'sens':>6} | Δ-sum")
    best_size = None
    best_delta = float("inf")
    for size in CHUNK_SIZES:
        bucket = by_size[size]
        if not bucket:
            continue
        avg_w = sum(r["recon_words"] for r in bucket) / len(bucket)
        avg_sent = sum(r["style"]["avg_sentence_words"] for r in bucket) / len(bucket)
        avg_dial = sum(r["style"]["dialogue_ratio"] for r in bucket) / len(bucket)
        avg_clause = sum(r["style"]["clause_complexity"] for r in bucket) / len(bucket)
        avg_sens = sum(r["style"]["sensory_density"] for r in bucket) / len(bucket)
        delta = (
            abs(avg_sent - SALVATORE_BASELINE["avg_sentence_words"]) / 10.0
            + abs(avg_dial - SALVATORE_BASELINE["dialogue_ratio"])
            + abs(avg_clause - SALVATORE_BASELINE["clause_complexity"])
            + abs(avg_sens - SALVATORE_BASELINE["sensory_density"]) / 2.0
        )
        if delta < best_delta:
            best_delta = delta
            best_size = size
        print(f"{size:>6} {len(bucket):>3} {avg_w:>7.1f} {avg_sent:>6.1f} {avg_dial:>6.2f} {avg_clause:>7.2f} {avg_sens:>6.2f} | {delta:.2f}")

    print(f"\nBest chunk size: {best_size}w (lowest normalized style delta: {best_delta:.2f})")
    print(f"Output: {args.output}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--per-kind", type=int, default=5)
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
