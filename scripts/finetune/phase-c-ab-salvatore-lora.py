#!/usr/bin/env python3
"""Phase C: A/B validation — DeepSeek V3.2 vs salvatore-1988-v1 LoRA.

Takes 5 real Salvatore briefs (dialogue + action + description mix), generates
at 120w target via both models, scores against the Salvatore aggregate baseline.

Winner has the lower normalized Δ-sum vs the baseline:
  abs(sent-18.3)/10 + abs(dial-0.28) + abs(clause-0.62) + abs(sens-1.56)/2

Usage:
  export DEEPSEEK_API_KEY=... WANDB_API_KEY=...
  python3 scripts/finetune/phase-c-ab-salvatore-lora.py \
    --input scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl \
    --output scripts/lora-data/phase-c-salvatore-ab-results.jsonl \
    --n 5 --concurrency 4
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

TARGET_WORDS = 120

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

MODELS = [
    {
        "label": "deepseek-baseline",
        "url": "https://api.deepseek.com/v1/chat/completions",
        "env_key": "DEEPSEEK_API_KEY",
        "model": "deepseek-v4-flash",
    },
    {
        "label": "salvatore-1988-v1",
        "url": "https://api.inference.wandb.ai/v1/chat/completions",
        "env_key": "WANDB_API_KEY",
        "model": "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v1",
    },
]


def format_brief_prompt(brief: dict) -> str:
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
        f"**Target words:** ~{TARGET_WORDS}\n"
        f"**Summary:** {brief.get('summary', '')}\n"
    )


def load_key(env_key: str) -> str:
    v = os.environ.get(env_key)
    if v:
        return v
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith(f"{env_key}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(f"ERROR: {env_key} not set")


def call_sync(model_cfg: dict, system: str, user: str) -> str:
    body = json.dumps({
        "model": model_cfg["model"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.7,
        "max_tokens": 500,
    }).encode()
    req = urllib.request.Request(
        model_cfg["url"],
        data=body,
        headers={
            "Authorization": f"Bearer {load_key(model_cfg['env_key'])}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) harness-eval/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.load(resp)
        return data["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")[:300]
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e


async def call(model_cfg: dict, system: str, user: str, sem: asyncio.Semaphore) -> str:
    async with sem:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, call_sync, model_cfg, system, user)


async def run_one(brief: dict, model_cfg: dict, sem: asyncio.Semaphore) -> dict:
    prompt = format_brief_prompt(brief)
    try:
        prose = await call(model_cfg, SYSTEM_PROMPT, prompt, sem)
    except Exception as e:
        return {"beat_id": brief["beat_id"], "model": model_cfg["label"], "error": str(e)}
    style = compute_style(prose)
    return {
        "beat_id": brief["beat_id"],
        "kind": brief["kind"],
        "model": model_cfg["label"],
        "target_words": TARGET_WORDS,
        "recon_words": len(prose.split()),
        "style": style,
        "prose": prose,
    }


def delta_sum(style: dict) -> float:
    return (
        abs(style["avg_sentence_words"] - SALVATORE_BASELINE["avg_sentence_words"]) / 10.0
        + abs(style["dialogue_ratio"] - SALVATORE_BASELINE["dialogue_ratio"])
        + abs(style["clause_complexity"] - SALVATORE_BASELINE["clause_complexity"])
        + abs(style["sensory_density"] - SALVATORE_BASELINE["sensory_density"]) / 2.0
    )


async def main_async(args):
    random.seed(args.seed)
    pairs = [json.loads(l) for l in open(args.input)]

    by_kind = {}
    for p in pairs:
        k = p["brief"].get("kind", "?")
        if k not in {"dialogue", "action", "description"}:
            continue
        by_kind.setdefault(k, []).append(p["brief"])

    # Stratified: try to get 2 dialogue, 2 action, 1 description for n=5
    per_kind = max(1, args.n // 3)
    sample = []
    for k in ("dialogue", "action", "description"):
        bucket = by_kind.get(k, [])
        random.shuffle(bucket)
        take = per_kind + (1 if k == "dialogue" and len(sample) + per_kind * 3 < args.n else 0)
        sample.extend(bucket[:take])
    sample = sample[: args.n]

    sem = asyncio.Semaphore(args.concurrency)
    tasks = [run_one(b, m, sem) for b in sample for m in MODELS]
    print(f"Running {len(tasks)} calls ({len(sample)} briefs × {len(MODELS)} models, concurrency {args.concurrency})")

    results = []
    for coro in asyncio.as_completed(tasks):
        r = await coro
        results.append(r)
        sys.stdout.write("!" if "error" in r else ".")
        sys.stdout.flush()
    print()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")

    # Analysis
    by_model = {m["label"]: [] for m in MODELS}
    errors = 0
    for r in results:
        if "error" in r:
            errors += 1
            print(f"\n[ERROR] {r['model']} beat={r['beat_id']}: {r['error'][:200]}")
            continue
        by_model[r["model"]].append(r)

    print(f"\n=== Phase C: DeepSeek vs salvatore-1988-v1 (target {TARGET_WORDS}w) ===")
    print(f"Successful calls: {len(results) - errors}/{len(results)} (errors: {errors})")
    print(f"\nBaseline (Salvatore 777-beat corpus):")
    for k, v in SALVATORE_BASELINE.items():
        print(f"  {k:>20}: {v:.2f}")

    print(f"\n{'model':>22} {'n':>3} {'words':>7} {'sent':>6} {'dial':>6} {'clause':>7} {'sens':>6} | Δ-sum")
    scores = {}
    for m in MODELS:
        bucket = by_model[m["label"]]
        if not bucket:
            continue
        avg_w = sum(r["recon_words"] for r in bucket) / len(bucket)
        avg_sent = sum(r["style"]["avg_sentence_words"] for r in bucket) / len(bucket)
        avg_dial = sum(r["style"]["dialogue_ratio"] for r in bucket) / len(bucket)
        avg_clause = sum(r["style"]["clause_complexity"] for r in bucket) / len(bucket)
        avg_sens = sum(r["style"]["sensory_density"] for r in bucket) / len(bucket)
        agg_style = {
            "avg_sentence_words": avg_sent,
            "dialogue_ratio": avg_dial,
            "clause_complexity": avg_clause,
            "sensory_density": avg_sens,
        }
        delta = delta_sum(agg_style)
        scores[m["label"]] = delta
        print(f"{m['label']:>22} {len(bucket):>3} {avg_w:>7.1f} {avg_sent:>6.1f} {avg_dial:>6.2f} {avg_clause:>7.2f} {avg_sens:>6.2f} | {delta:.2f}")

    if len(scores) == 2:
        ds = scores.get("deepseek-baseline")
        lv = scores.get("salvatore-1988-v1")
        if ds is not None and lv is not None:
            print(f"\nDeepSeek baseline Δ-sum:  {ds:.2f}")
            print(f"Salvatore LoRA  Δ-sum:  {lv:.2f}")
            if lv < ds:
                print(f"→ LoRA WINS by {ds - lv:.2f} (lower = closer to Salvatore baseline)")
            elif lv > ds:
                print(f"→ DeepSeek wins by {lv - ds:.2f}")
            else:
                print("→ TIE")
    print(f"\nOutput: {args.output}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--seed", type=int, default=43)
    args = ap.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
