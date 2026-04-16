#!/usr/bin/env python3
"""Phase C.2: Capability-vs-tuning A/B for Salvatore voice.

Three cells on the SAME 4 stratified briefs at 120w:
  A. DeepSeek V3.2 + bare system prompt                (no Salvatore exemplars)
  B. DeepSeek V3.2 + Salvatore primer (~10k tokens ICL) (exemplars, no tuning)
  C. salvatore-1988-v1 LoRA on Qwen3-14B via W&B        (tuning, no exemplars)

Answers the question Phase C left open: is the LoRA win from tuning, or
would equally rich in-context exemplars on the same (larger) base model
close the gap?

Usage:
  export DEEPSEEK_API_KEY=... WANDB_API_KEY=...
  python3 scripts/finetune/phase-c2-capability-vs-tuning.py \
    --input scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl \
    --primer src/agents/writer/style-primer-salvatore.md \
    --output scripts/lora-data/phase-c2-capability-vs-tuning-results.jsonl \
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

BARE_SYSTEM = """You are writing a single beat of prose in the action-pulp fantasy voice of R.A. Salvatore's 1988 Icewind Dale Trilogy.

Style targets:
- Direct, declarative sentences with physical specificity
- Dialogue-heavy beats get short tags, interiority beats stay short on speech
- Sentence length averages ~18 words but varies: mix short punchy lines with occasional long cascading sentences
- Sensory grounding in sight, sound, touch — cold, wind, firelight, steel
- No meta-commentary, no preamble, no headers

Write ONLY the prose. Match the word count and dramatic function specified."""


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


def call_sync(cell: dict, system: str, user: str) -> str:
    body = json.dumps({
        "model": cell["model"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.7,
        "max_tokens": 500,
    }).encode()
    req = urllib.request.Request(
        cell["url"],
        data=body,
        headers={
            "Authorization": f"Bearer {load_key(cell['env_key'])}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) harness-eval/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            data = json.load(resp)
        return data["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")[:300]
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e


async def call(cell: dict, system: str, user: str, sem: asyncio.Semaphore) -> str:
    async with sem:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, call_sync, cell, system, user)


async def run_one(brief: dict, cell: dict, sem: asyncio.Semaphore) -> dict:
    prompt = format_brief_prompt(brief)
    try:
        prose = await call(cell, cell["system"], prompt, sem)
    except Exception as e:
        return {"beat_id": brief["beat_id"], "cell": cell["label"], "error": str(e)}
    style = compute_style(prose)
    return {
        "beat_id": brief["beat_id"],
        "kind": brief["kind"],
        "cell": cell["label"],
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

    primer_text = args.primer.read_text()
    primed_system = BARE_SYSTEM + "\n\n" + primer_text

    cells = [
        {
            "label": "A-deepseek-bare",
            "url": "https://api.deepseek.com/v1/chat/completions",
            "env_key": "DEEPSEEK_API_KEY",
            "model": "deepseek-chat",
            "system": BARE_SYSTEM,
        },
        {
            "label": "B-deepseek-primer",
            "url": "https://api.deepseek.com/v1/chat/completions",
            "env_key": "DEEPSEEK_API_KEY",
            "model": "deepseek-chat",
            "system": primed_system,
        },
        {
            "label": "C-salvatore-lora",
            "url": "https://api.inference.wandb.ai/v1/chat/completions",
            "env_key": "WANDB_API_KEY",
            "model": "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v1",
            "system": BARE_SYSTEM,
        },
    ]

    by_kind = {}
    for p in pairs:
        k = p["brief"].get("kind", "?")
        if k not in {"dialogue", "action", "description"}:
            continue
        by_kind.setdefault(k, []).append(p["brief"])

    per_kind = max(1, args.n // 3)
    sample = []
    for k in ("dialogue", "action", "description"):
        bucket = by_kind.get(k, [])
        random.shuffle(bucket)
        take = per_kind + (1 if k == "dialogue" and len(sample) + per_kind * 3 < args.n else 0)
        sample.extend(bucket[:take])
    sample = sample[: args.n]

    sem = asyncio.Semaphore(args.concurrency)
    tasks = [run_one(b, c, sem) for b in sample for c in cells]
    print(f"Running {len(tasks)} calls ({len(sample)} briefs × {len(cells)} cells, concurrency {args.concurrency})")
    print(f"Primer size: {len(primer_text):,} chars (~{len(primer_text) // 4:,} tokens)")

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

    by_cell = {c["label"]: [] for c in cells}
    errors = 0
    for r in results:
        if "error" in r:
            errors += 1
            print(f"\n[ERROR] {r['cell']} beat={r['beat_id']}: {r['error'][:300]}")
            continue
        by_cell[r["cell"]].append(r)

    print(f"\n=== Phase C.2: capability-vs-tuning on Salvatore voice (target {TARGET_WORDS}w) ===")
    print(f"Successful calls: {len(results) - errors}/{len(results)} (errors: {errors})")
    print(f"\nBaseline (Salvatore 777-beat corpus):")
    for k, v in SALVATORE_BASELINE.items():
        print(f"  {k:>20}: {v:.2f}")

    print(f"\n{'cell':>22} {'n':>3} {'words':>7} {'sent':>6} {'dial':>6} {'clause':>7} {'sens':>6} | Δ-sum")
    scores = {}
    for c in cells:
        bucket = by_cell[c["label"]]
        if not bucket:
            continue
        avg_w = sum(r["recon_words"] for r in bucket) / len(bucket)
        avg_sent = sum(r["style"]["avg_sentence_words"] for r in bucket) / len(bucket)
        avg_dial = sum(r["style"]["dialogue_ratio"] for r in bucket) / len(bucket)
        avg_clause = sum(r["style"]["clause_complexity"] for r in bucket) / len(bucket)
        avg_sens = sum(r["style"]["sensory_density"] for r in bucket) / len(bucket)
        agg = {
            "avg_sentence_words": avg_sent,
            "dialogue_ratio": avg_dial,
            "clause_complexity": avg_clause,
            "sensory_density": avg_sens,
        }
        d = delta_sum(agg)
        scores[c["label"]] = d
        print(f"{c['label']:>22} {len(bucket):>3} {avg_w:>7.1f} {avg_sent:>6.1f} {avg_dial:>6.2f} {avg_clause:>7.2f} {avg_sens:>6.2f} | {d:.2f}")

    if len(scores) == 3:
        A = scores["A-deepseek-bare"]
        B = scores["B-deepseek-primer"]
        C = scores["C-salvatore-lora"]
        print()
        print(f"A (DeepSeek bare)    Δ-sum: {A:.2f}")
        print(f"B (DeepSeek+primer)  Δ-sum: {B:.2f}  (primer effect: {A-B:+.2f})")
        print(f"C (salvatore LoRA)   Δ-sum: {C:.2f}  (tuning effect vs primer: {B-C:+.2f})")
        print()
        if C < B and (B - C) > 0.3:
            print(f"→ TUNING WINS over ICL: LoRA closes another {B-C:.2f} Δ-sum past primer baseline.")
        elif abs(C - B) <= 0.3:
            print(f"→ ICL MATCHES TUNING within noise ({abs(B-C):.2f} Δ-sum diff). Primer-on-DeepSeek is the cheap path.")
        else:
            print(f"→ ICL WINS over tuning: primer on DeepSeek beats LoRA by {C-B:.2f}.")
    print(f"\nOutput: {args.output}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--primer", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--seed", type=int, default=43)
    args = ap.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
