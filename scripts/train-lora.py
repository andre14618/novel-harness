#!/usr/bin/env python3
"""
LoRA fine-tuning script for novel-harness adapters.

Uses W&B Serverless SFT (ART framework) to train on OpenPipe/Qwen3-14B-Instruct.
Training is free during W&B public preview. Adapter is served via W&B Inference
at $0.05/$0.22 per 1M tokens.

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


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(train(args))
