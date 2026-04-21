#!/usr/bin/env python3
"""
Submit a LoRA fine-tune job to Together AI for small-model checker POCs.

Use case: training small bases (Qwen3-1.7B, Qwen3-4B, Llama-3.2-3B) on our
existing checker training data. W&B ART serverless rejects bases outside
its 4-model whitelist; Together supports the sub-8B range.

After training, download the LoRA adapter for local serving via MLX:
    together fine-tuning download <job_id> --checkpoint-type merged

Usage:
    python3 scripts/finetune/train-together-small.py \\
        --name hallucination-checker-v2-qwen17b \\
        --base Qwen/Qwen3-1.7B \\
        --data finetune-data/halluc-checker-v2-train-nometa.jsonl \\
        [--epochs 3] [--batch-size max] [--lr 2e-4] [--lora-r 16]
"""
import argparse
import asyncio
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Project-local DB helpers (via bun-side TS is cleaner but this keeps it pythonic)
# Shell out to record experiment, or use psycopg. Simpler: pass experiment_id via CLI.


def parse_args():
    p = argparse.ArgumentParser(description="Submit a LoRA fine-tune to Together")
    p.add_argument("--name", required=True, help="Adapter suffix, e.g. hallucination-checker-v2-qwen17b")
    p.add_argument("--base", required=True, help="HF base model ID, e.g. Qwen/Qwen3-1.7B")
    p.add_argument("--data", required=True, help="Local JSONL path. Uploaded fresh on every run by default — Together's filename-based reuse is unsafe because a regenerated dataset keeps the same basename but differs in content. Pass --reuse-file-id to explicitly reuse a known-good upload.")
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--batch-size", default="max", help='"max" or integer')
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--lora-r", type=int, default=16)
    p.add_argument("--lora-alpha", type=int, default=32)
    p.add_argument("--experiment-id", type=int, default=None, help="Existing tuning_experiments.id to link to — provenance manifest is written under finetune-data/together-runs/<experiment_id>.json when supplied.")
    p.add_argument("--reuse-file-id", default=None, help="Skip upload and submit against this Together file_id. Caller is responsible for confirming the file matches the local data hash. Use when re-running a failed job without re-uploading.")
    return p.parse_args()


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_manifest(manifest_dir: Path, key: str, payload: dict) -> Path:
    manifest_dir.mkdir(parents=True, exist_ok=True)
    path = manifest_dir / f"{key}.json"
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path


def main():
    args = parse_args()

    try:
        from together import Together
    except ImportError:
        print("together SDK not installed. Run: pip install --user --break-system-packages together")
        sys.exit(1)

    api_key = os.environ.get("TOGETHER_API_KEY")
    if not api_key:
        print("TOGETHER_API_KEY not set. source .env first.")
        sys.exit(1)
    c = Together(api_key=api_key)

    # 1. Resolve training file. Default is fresh upload — Together's file
    #    listing only exposes filename (not content hash), and the prior
    #    basename-match reuse silently trained on stale data whenever a
    #    local JSONL was regenerated. --reuse-file-id is the explicit
    #    opt-in for skipping upload (e.g. re-submitting a failed job).
    data_path = Path(args.data)
    if not data_path.exists():
        print(f"Data file not found: {args.data}")
        sys.exit(1)

    data_sha = sha256_of(data_path)
    data_bytes = data_path.stat().st_size
    print(f"Local data: {data_path.name} ({data_bytes:,} bytes, sha256={data_sha[:16]}…)")

    if args.reuse_file_id:
        training_file_id = args.reuse_file_id
        print(f"Reusing file_id (explicit): {training_file_id}")
        print("  NOTE: caller asserted this file matches the local data hash above.")
    else:
        print(f"Uploading {data_path}...")
        f = c.files.upload(file=str(data_path), purpose="fine-tune")
        training_file_id = f.id
        print(f"  uploaded: {training_file_id}")

    # 2. Submit fine-tune job
    print(f"\nSubmitting fine-tune:")
    print(f"  base     : {args.base}")
    print(f"  suffix   : {args.name}")
    print(f"  epochs   : {args.epochs}")
    print(f"  lr       : {args.lr}")
    print(f"  LoRA r/α : {args.lora_r} / {args.lora_alpha}")

    bs = args.batch_size
    if bs != "max":
        bs = int(bs)

    job = c.fine_tuning.create(
        training_file=training_file_id,
        model=args.base,
        n_epochs=args.epochs,
        n_checkpoints=1,
        batch_size=bs,
        learning_rate=args.lr,
        lora=True,
        lora_r=args.lora_r,
        lora_alpha=args.lora_alpha,
        suffix=args.name,
    )

    print(f"\n✓ Job submitted: {job.id}")
    print(f"  status       : {job.status}")
    print(f"  output model : {job.output_name if hasattr(job, 'output_name') else '(pending)'}")
    print(f"\nTrack via:")
    print(f"  python3 -c 'from together import Together; import os; c=Together(api_key=os.environ[\"TOGETHER_API_KEY\"]); print(c.fine_tuning.retrieve(\"{job.id}\"))'")
    print(f"\nOr on the web: https://api.together.xyz/finetune/{job.id}")

    # Provenance manifest — always written, experiment-id-keyed when
    # supplied so the record can be joined to tuning_experiments later.
    manifest_dir = Path("finetune-data/together-runs")
    manifest_key = f"exp-{args.experiment_id}" if args.experiment_id is not None else f"job-{job.id}"
    manifest = {
        "job_id": job.id,
        "status": job.status,
        "output_name": getattr(job, "output_name", None),
        "experiment_id": args.experiment_id,
        "training_file_id": training_file_id,
        "training_file_reused_via": "--reuse-file-id" if args.reuse_file_id else "fresh-upload",
        "data_path": str(data_path),
        "data_basename": data_path.name,
        "data_bytes": data_bytes,
        "data_sha256": data_sha,
        "base_model": args.base,
        "adapter_suffix": args.name,
        "hyperparameters": {
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "learning_rate": args.lr,
            "lora_r": args.lora_r,
            "lora_alpha": args.lora_alpha,
        },
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }
    manifest_path = write_manifest(manifest_dir, manifest_key, manifest)
    print(f"\nProvenance manifest: {manifest_path}")
    if args.experiment_id is not None:
        print(f"  Join key: tuning_experiments.id = {args.experiment_id}")
        print(f"  Paste into concludeExperiment() description when the job finishes.")


if __name__ == "__main__":
    main()
