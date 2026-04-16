#!/usr/bin/env python3
"""Phase C.3: Generalization test for salvatore-1988-v1 LoRA.

Runs the LoRA on briefs the adapter never saw during training. Two modes:

  --mode val       Held-out val split (74 beats from same books). Tests
                   within-distribution generalization.
  --mode original  Original-character briefs (Salvatore-adjacent fantasy
                   but no trained lore). Tests cross-distribution — this
                   is the test that predicts harness behavior.

For each brief, runs the LoRA + DeepSeek-bare + DeepSeek+primer (A/B/C
matching Phase C.2) so we can see whether voice transfer holds when the
brief isn't a training leak.

Outputs style features, Δ-sum, and 5-gram overlap with ground truth (val
mode only — memorization heuristic).

Usage:
  python3 scripts/finetune/phase-c3-generalization.py \
    --briefs /tmp/salvatore-val-briefs.jsonl \
    --primer src/agents/writer/style-primer-salvatore.md \
    --mode val \
    --output scripts/lora-data/phase-c3-val-results.jsonl \
    --concurrency 4
"""

import argparse
import asyncio
import json
import os
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
    words = brief.get("words", TARGET_WORDS)
    return (
        f"**Characters:** {chars}\n"
        f"**POV:** {pov}\n"
        f"**Setting:** {brief.get('setting', '')}\n"
        f"**Tone:** {brief.get('tone', '')}\n"
        f"**Kind:** {brief.get('kind', '')}\n"
        f"**Transition in:** {brief.get('transition_in', '')}\n"
        f"**Boundary signal:** {brief.get('boundary_signal', '')}\n"
        f"**Target words:** ~{words}\n"
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
        return {"beat_id": brief.get("beat_id","?"), "cell": cell["label"], "error": str(e)}
    style = compute_style(prose)
    return {
        "beat_id": brief.get("beat_id","?"),
        "kind": brief.get("kind","?"),
        "cell": cell["label"],
        "target_words": brief.get("words", TARGET_WORDS),
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


def ngrams(text: str, n: int = 5) -> set:
    words = text.lower().split()
    return set(" ".join(words[i:i+n]) for i in range(len(words) - n + 1))


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


async def main_async(args):
    briefs = []
    gt_prose = {}
    for line in open(args.briefs):
        if not line.strip():
            continue
        row = json.loads(line)
        b = row.get("brief", row)  # allow plain briefs or {brief,...}
        briefs.append(b)
        if "ground_truth_prose" in row:
            gt_prose[b.get("beat_id","?")] = row["ground_truth_prose"]

    primer_text = args.primer.read_text() if args.primer else ""
    primed_system = BARE_SYSTEM + "\n\n" + primer_text if primer_text else BARE_SYSTEM

    cells = []
    if args.cells in ("all", "AC") or args.cells == "all":
        cells.append({
            "label": "A-deepseek-bare",
            "url": "https://api.deepseek.com/v1/chat/completions",
            "env_key": "DEEPSEEK_API_KEY",
            "model": "deepseek-chat",
            "system": BARE_SYSTEM,
        })
    if args.cells == "all":
        cells.append({
            "label": "B-deepseek-primer",
            "url": "https://api.deepseek.com/v1/chat/completions",
            "env_key": "DEEPSEEK_API_KEY",
            "model": "deepseek-chat",
            "system": primed_system,
        })
    cells.append({
        "label": "C-salvatore-lora",
        "url": "https://api.inference.wandb.ai/v1/chat/completions",
        "env_key": "WANDB_API_KEY",
        "model": "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v1",
        "system": BARE_SYSTEM,
    })

    sem = asyncio.Semaphore(args.concurrency)
    tasks = [run_one(b, c, sem) for b in briefs for c in cells]
    print(f"Phase C.3 ({args.mode}): {len(briefs)} briefs x {len(cells)} cells = {len(tasks)} calls")

    results = []
    for coro in asyncio.as_completed(tasks):
        r = await coro
        results.append(r)
        sys.stdout.write("!" if "error" in r else ".")
        sys.stdout.flush()
    print()

    # Attach memorization signal (5-gram overlap with ground truth)
    if gt_prose:
        for r in results:
            if "error" in r:
                continue
            gt = gt_prose.get(r["beat_id"])
            if gt:
                r["ngram_jaccard_vs_gt"] = round(jaccard(ngrams(r["prose"]), ngrams(gt)), 4)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")

    by_cell = {}
    for r in results:
        by_cell.setdefault(r["cell"], []).append(r)

    print(f"\n=== Phase C.3: {args.mode} generalization (n={len(briefs)} briefs) ===\n")
    print(f"{'cell':>22} {'n':>3} {'words':>7} {'sent':>6} {'dial':>6} {'clause':>7} {'sens':>6} {'Δsum':>6} {'5gram':>7}")
    for cell in cells:
        bucket = [r for r in by_cell.get(cell["label"], []) if "error" not in r]
        if not bucket:
            continue
        avg = lambda k: sum(r["style"][k] for r in bucket) / len(bucket)
        agg = {
            "avg_sentence_words": avg("avg_sentence_words"),
            "dialogue_ratio": avg("dialogue_ratio"),
            "clause_complexity": avg("clause_complexity"),
            "sensory_density": avg("sensory_density"),
        }
        avg_w = sum(r["recon_words"] for r in bucket) / len(bucket)
        d = delta_sum(agg)
        ng = [r.get("ngram_jaccard_vs_gt") for r in bucket if r.get("ngram_jaccard_vs_gt") is not None]
        ng_avg = sum(ng) / len(ng) if ng else 0.0
        ng_max = max(ng) if ng else 0.0
        ng_str = f"{ng_avg:.3f}" if ng else "—"
        print(f"{cell['label']:>22} {len(bucket):>3} {avg_w:>7.1f} {agg['avg_sentence_words']:>6.1f} {agg['dialogue_ratio']:>6.2f} {agg['clause_complexity']:>7.2f} {agg['sensory_density']:>6.2f} {d:>6.2f} {ng_str:>7}")
        if ng:
            print(f"{'':>22}  (n-gram vs GT  mean={ng_avg:.3f}  max={ng_max:.3f})")

    errors = [r for r in results if "error" in r]
    if errors:
        print(f"\n{len(errors)} errors:")
        for e in errors[:10]:
            print(f"  {e['cell']} beat={e['beat_id']}: {e['error'][:200]}")

    print(f"\nOutput: {args.output}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--briefs", required=True, type=Path)
    ap.add_argument("--primer", type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--mode", choices=["val", "original"], required=True)
    ap.add_argument("--cells", choices=["C-only", "all"], default="all")
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
