#!/usr/bin/env python3
"""
LoRA fine-tuning script for novel-harness adapters.

Uses W&B Serverless SFT (ART framework) to train on OpenPipe/Qwen3-14B-Instruct.
Training is free during W&B public preview. Adapter is served via W&B Inference
at $0.05/$0.22 per 1M tokens.

Automatic post-training cleanup deletes intermediate checkpoints, train-state,
and dataset artifacts from W&B to stay under the 5 GB free storage tier.
Only the final serving adapter is kept. Use --no-cleanup to skip.

Usage:
    python3 scripts/train-lora.py \\
        --name howard-tonal-v4 \\
        --data lora-data/howard-tonal-pairs-curated.jsonl \\
        [--epochs 3] [--batch-size 2] [--lr 2e-4] [--dry-run]

After training, the adapter artifact URI is printed. Add it to models/registry.ts as:
    {
      id: "wandb-artifact:///{entity}/{project}/{name}:latest",
      provider: "wandb",
      ...
    }

See: docs/fine-tuning-strategy.md
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train a LoRA adapter via W&B Serverless SFT")
    p.add_argument("--name",       required=True, help="Adapter name, e.g. howard-tonal-v4")
    p.add_argument("--data",       required=True, help="Path to JSONL training file")
    p.add_argument("--project",    default="novel-harness", help="W&B project name")
    p.add_argument("--entity",     default=None, help="W&B entity (defaults to API key owner)")
    p.add_argument("--base-model", default="OpenPipe/Qwen3-14B-Instruct",
                   help="Base model to fine-tune")
    p.add_argument("--epochs",     type=int,   default=3)
    p.add_argument("--batch-size", type=int,   default=2)
    p.add_argument("--lr",         type=float, default=2e-4, help="Peak learning rate")
    p.add_argument("--schedule",   default="cosine", choices=["cosine", "linear", "constant"])
    p.add_argument("--warmup",     type=float, default=0.1, help="Warmup ratio")
    p.add_argument("--dry-run",    action="store_true",
                   help="Validate data and print plan without kicking off training")
    p.add_argument("--no-cleanup", action="store_true",
                   help="Skip post-training artifact cleanup (keeps all checkpoints)")
    return p.parse_args()


def validate_data(path: str) -> tuple[int, int]:
    """
    Validate JSONL format and return (total_rows, skipped_rows).
    Each line must have {"messages": [{role, content}, ...]} with the last
    message from the assistant (ART masks all non-assistant tokens).
    """
    data_path = Path(path)
    if not data_path.exists():
        print(f"ERROR: data file not found: {path}", file=sys.stderr)
        sys.exit(1)

    total = 0
    skipped = 0
    errors: list[str] = []

    with open(data_path) as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            total += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"line {i}: invalid JSON — {e}")
                skipped += 1
                continue

            messages = obj.get("messages")
            if not isinstance(messages, list) or len(messages) < 2:
                errors.append(f"line {i}: 'messages' must be a list with ≥2 entries")
                skipped += 1
                continue

            if messages[-1].get("role") != "assistant":
                errors.append(f"line {i}: last message must be from 'assistant'")
                skipped += 1
                continue

    if errors:
        print("Data validation errors (first 5):", file=sys.stderr)
        for e in errors[:5]:
            print(f"  {e}", file=sys.stderr)
        if len(errors) > 5:
            print(f"  ... and {len(errors) - 5} more", file=sys.stderr)
        if skipped == total:
            print("ERROR: all rows invalid — aborting", file=sys.stderr)
            sys.exit(1)

    return total, skipped


def fmt_bytes(n: int) -> str:
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    if n < 1024 * 1024 * 1024:
        return f"{n / (1024 * 1024):.1f} MB"
    return f"{n / (1024 * 1024 * 1024):.2f} GB"


async def cleanup_training_artifacts(model, args: argparse.Namespace) -> None:
    """Delete intermediate checkpoints, train-state, and dataset artifacts.

    After training, W&B stores ~3.7 GB of artifacts per run:
      - Identity LoRA v0 (~123 MB)
      - Intermediate LoRA checkpoints v1-v8 (~134 MB each)
      - Train-state checkpoints v0-v9 (~246 MB each)
      - Dataset artifact (~50-65 MB)

    Only the final LoRA adapter (~134 MB) is needed for serving.
    This function deletes everything else.
    """
    import wandb as wandb_sdk

    print("Post-training cleanup: removing intermediate artifacts...")

    api = wandb_sdk.Api()
    entity = args.entity or api.default_entity
    project = args.project
    name = args.name
    freed = 0
    deleted = 0

    # 1. Clean serving-side checkpoints (keeps latest + best)
    try:
        await model.delete_checkpoints()
        print("  Cleaned serving-side checkpoints.")
    except Exception as e:
        print(f"  Warning: delete_checkpoints() failed: {e}")

    # 2. Delete intermediate LoRA artifact versions (keep only the final/latest)
    for coll_name in [name, f"{name}-sft-resume"]:
        try:
            versions = list(api.artifacts("lora", f"{entity}/{project}/{coll_name}"))
        except Exception:
            continue

        # Find the version with 'latest' alias — that's the serving one
        latest_ver = None
        for v in versions:
            if v.aliases and "latest" in v.aliases:
                latest_ver = v.name
                break

        for v in versions:
            if v.name == latest_ver:
                print(f"  KEEP {v.name} (serving)")
                continue
            size = v.size or 0
            try:
                if v.aliases:
                    v.aliases = []
                    v.save()
                v.delete()
                freed += size
                deleted += 1
                print(f"  Deleted {v.name} ({fmt_bytes(size)})")
            except Exception as e:
                print(f"  Warning: failed to delete {v.name}: {e}")

    # 3. Delete ALL train-state artifacts (not needed once training is done)
    for suffix in ["-train-state", "-train-state-sft-resume"]:
        coll_name = f"{name}{suffix}"
        try:
            versions = list(api.artifacts("train-state", f"{entity}/{project}/{coll_name}"))
        except Exception:
            continue
        for v in versions:
            size = v.size or 0
            try:
                if v.aliases:
                    v.aliases = []
                    v.save()
                v.delete()
                freed += size
                deleted += 1
                print(f"  Deleted {v.name} ({fmt_bytes(size)})")
            except Exception as e:
                print(f"  Warning: failed to delete {v.name}: {e}")

    # 4. Delete dataset artifact (training data already lives in lora-data/)
    try:
        for atype in api.artifact_types(f"{entity}/{project}"):
            if atype.name != "dataset":
                continue
            for coll in atype.collections():
                if not coll.name.startswith(name):
                    continue
                for v in coll.artifacts():
                    size = v.size or 0
                    try:
                        if v.aliases:
                            v.aliases = []
                            v.save()
                        v.delete()
                        freed += size
                        deleted += 1
                        print(f"  Deleted {v.name} ({fmt_bytes(size)})")
                    except Exception as e:
                        print(f"  Warning: failed to delete {v.name}: {e}")
    except Exception as e:
        print(f"  Warning: dataset cleanup failed: {e}")

    print(f"\n  Cleanup done: deleted {deleted} artifacts, freed ~{fmt_bytes(freed)}.")


async def train(args: argparse.Namespace) -> None:
    import art
    from art import TrainableModel, ServerlessBackend
    from art.utils.sft import train_sft_from_file

    api_key = os.environ.get("WANDB_API_KEY")
    if not api_key:
        print("ERROR: WANDB_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    data_path = str(Path(args.data).resolve())
    total, skipped = validate_data(data_path)
    valid = total - skipped

    print(f"Training plan:")
    print(f"  adapter name : {args.name}")
    print(f"  project      : {args.project}")
    print(f"  base model   : {args.base_model}")
    print(f"  data file    : {args.data}")
    print(f"  rows         : {valid} valid / {total} total ({skipped} skipped)")
    print(f"  epochs       : {args.epochs}")
    print(f"  batch size   : {args.batch_size}")
    print(f"  peak lr      : {args.lr}")
    print(f"  schedule     : {args.schedule}")
    print(f"  warmup ratio : {args.warmup}")
    print()

    if args.dry_run:
        print("DRY RUN — stopping before register/train.")
        print("Re-run without --dry-run to kick off training.")
        return

    print("Registering model with W&B Serverless backend...")
    backend = ServerlessBackend(api_key=api_key)

    model = TrainableModel(
        name=args.name,
        project=args.project,
        entity=args.entity,
        base_model=args.base_model,
    )
    await model.register(backend)
    print("  registered.")

    print(f"Starting SFT training on {valid} examples...")
    await train_sft_from_file(
        model=model,
        file_path=data_path,
        epochs=args.epochs,
        batch_size=args.batch_size,
        peak_lr=args.lr,
        schedule_type=args.schedule,
        warmup_ratio=args.warmup,
        verbose=True,
    )
    print("Training complete.")

    # W&B ServerlessBackend uses wandb-artifact:/// URIs for inference.
    # get_inference_name() returns the fully-qualified artifact path.
    inference_name = model.get_inference_name()
    print()
    print("=" * 60)
    print(f"Adapter inference name: {inference_name}")
    print()
    print("Add to models/registry.ts:")
    print(f"""  {{
    id: "{inference_name}",
    label: "{args.name}",
    provider: "wandb",
    params: "14B",
    pricing: {{ input: 0.05, output: 0.22 }},
    baseModel: "{args.base_model}",
  }},""")
    print("=" * 60)

    # ── Post-training cleanup ────────────────────────────────────────────
    # Delete intermediate checkpoints, train-state, and dataset artifacts
    # to stay under the 5 GB W&B free storage tier. Only the final serving
    # adapter (~134 MB) is kept.
    if not args.no_cleanup:
        print()
        await cleanup_training_artifacts(model, args)


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(train(args))
