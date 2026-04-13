"""
Train LoRA adapters on Together AI using Qwen 3.5 9B as base.

Mirrors the W&B adapters as a Tier 2 hot standby. Uses the same training
data JSONL files, strips _meta keys that Together doesn't accept.

Usage:
    python3 scripts/train-together.py                 # train all 4 adapters
    python3 scripts/train-together.py --adapter adherence  # train one
    python3 scripts/train-together.py --dry-run       # validate + upload only
    python3 scripts/train-together.py --status        # check running jobs

Requires: TOGETHER_API_KEY in environment or .env file
"""

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

# Load .env if present
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

TOGETHER_KEY = os.environ.get("TOGETHER_API_KEY")
if not TOGETHER_KEY:
    print("ERROR: TOGETHER_API_KEY not found in environment or .env")
    sys.exit(1)

BASE_MODEL = "Qwen/Qwen3.5-9B"
LORA_DATA = Path(__file__).parent.parent / "lora-data"

# Adapter definitions — same data as W&B training
ADAPTERS = {
    "adherence": {
        "name": "adherence-checker-v4-together-v2",
        "data": "adherence-checker-v4-events-sonnet.jsonl",
        "description": "Beat adherence events+attribution checker (2,134 Sonnet-labeled pairs)",
        "epochs": 6,  # Compensate for bs=8 vs W&B bs=2: 6ep×267=1600 steps (vs W&B 3201)
    },
    "chapter-plan": {
        "name": "chapter-plan-checker-v2-together-v2",
        "data": "chapter-plan-checker-pairs-sonnet-v2.jsonl",
        "description": "Cross-beat structural plan checker (520 Sonnet-labeled pairs)",
        "epochs": 10,  # Compensate for bs=8: 10ep×65=650 steps (vs W&B 780)
    },
    "continuity": {
        "name": "continuity-v2-together-v2",
        "data": "continuity-pairs-sonnet-labeled.jsonl",
        "description": "Continuity fact/state checker (253 Sonnet-labeled pairs)",
        "epochs": 12,  # Compensate for bs=8: 12ep×31=372 steps (vs W&B 379)
    },
    "tonal": {
        "name": "howard-tonal-v4-together-v2",
        "data": "howard-tonal-pairs-curated.jsonl",
        "description": "Howard tonal pass style transfer (4,497 curated pairs)",
        "epochs": 4,  # Compensate for bs=8: 4ep×562=2248 steps
    },
}

import urllib.request
import urllib.error


def api_request(method, endpoint, data=None, files=None):
    """Make a Together API request."""
    url = f"https://api.together.xyz/v1/{endpoint}"
    headers = {
        "Authorization": f"Bearer {TOGETHER_KEY}",
        "User-Agent": "novel-harness/1.0",
    }

    if files:
        # Multipart upload
        import io
        boundary = "----FormBoundary" + str(int(time.time()))
        body = io.BytesIO()

        for field_name, (filename, filedata, content_type) in files.items():
            body.write(f"--{boundary}\r\n".encode())
            body.write(f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode())
            body.write(f"Content-Type: {content_type}\r\n\r\n".encode())
            body.write(filedata)
            body.write(b"\r\n")

        if data:
            for key, value in data.items():
                body.write(f"--{boundary}\r\n".encode())
                body.write(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
                body.write(f"{value}\r\n".encode())

        body.write(f"--{boundary}--\r\n".encode())
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        req = urllib.request.Request(url, data=body.getvalue(), headers=headers, method=method)
    elif data:
        headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=json.dumps(data).encode(), headers=headers, method=method)
    else:
        req = urllib.request.Request(url, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  API error {e.code}: {body[:500]}")
        return None


def strip_meta(input_path: Path) -> tuple[Path, int, int]:
    """Strip _meta keys from JSONL. Returns (cleaned_path, total, stripped)."""
    lines = input_path.read_text().strip().splitlines()
    total = len(lines)
    stripped = 0
    cleaned = []

    for line in lines:
        row = json.loads(line)
        if "_meta" in row:
            del row["_meta"]
            stripped += 1
        # Validate structure
        if "messages" not in row or len(row["messages"]) < 2:
            continue
        if row["messages"][-1]["role"] != "assistant":
            continue
        cleaned.append(json.dumps(row, ensure_ascii=False))

    tmp = tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w")
    tmp.write("\n".join(cleaned) + "\n")
    tmp.close()
    return Path(tmp.name), total, stripped


def upload_file(cleaned_path: Path, purpose: str = "fine-tune") -> str | None:
    """Upload a JSONL file to Together. Returns file ID."""
    file_data = cleaned_path.read_bytes()
    filename = cleaned_path.name

    result = api_request("POST", "files/upload", files={
        "file": (filename, file_data, "application/jsonl"),
    }, data={"purpose": purpose, "file_name": filename})

    if result and "id" in result:
        return result["id"]
    return None


def start_training(adapter_config: dict, file_id: str) -> str | None:
    """Submit a LoRA fine-tuning job. Returns job ID."""
    payload = {
        "training_file": file_id,
        "model": BASE_MODEL,
        "n_epochs": adapter_config["epochs"],
        "learning_rate": 1e-4,  # Halved from 2e-4 — fewer steps need gentler LR
        "batch_size": 8,  # Together minimum
        "n_checkpoints": 1,
        "suffix": adapter_config["name"],
        "train_on_inputs": "auto",  # Mask non-assistant tokens (match W&B ART behavior)
        "warmup_ratio": 0.1,  # Match W&B ART warmup
        "training_type": {
            "type": "Lora",
            "lora_r": 16,
            "lora_alpha": 32,
            "lora_dropout": 0.05,
        },
    }

    result = api_request("POST", "fine-tunes", data=payload)
    if result and "id" in result:
        return result["id"]
    return None


def check_status():
    """List all fine-tuning jobs."""
    result = api_request("GET", "fine-tunes")
    if not result:
        print("Failed to fetch jobs")
        return

    jobs = result.get("data", [])
    if not jobs:
        print("No fine-tuning jobs found.")
        return

    print(f"\n{'='*70}")
    print(f"  Together AI Fine-Tuning Jobs")
    print(f"{'='*70}\n")

    for job in sorted(jobs, key=lambda j: j.get("created_at", ""), reverse=True)[:10]:
        status = job.get("status", "unknown")
        model = job.get("model", "?")
        suffix = job.get("suffix", "?")
        created = job.get("created_at", "?")
        output = job.get("output_name", "—")
        icon = {"completed": "OK", "running": "..", "failed": "XX", "cancelled": "--"}.get(status, "??")

        print(f"  [{icon}] {suffix}")
        print(f"       Status: {status}  |  Base: {model}")
        print(f"       Created: {created}")
        if output and output != "—":
            print(f"       Output model: {output}")
        print()


def main():
    parser = argparse.ArgumentParser(description="Train LoRA adapters on Together AI")
    parser.add_argument("--adapter", choices=list(ADAPTERS.keys()), help="Train a single adapter (default: all)")
    parser.add_argument("--dry-run", action="store_true", help="Validate and upload data only, don't train")
    parser.add_argument("--status", action="store_true", help="Check status of running jobs")
    args = parser.parse_args()

    if args.status:
        check_status()
        return

    targets = {args.adapter: ADAPTERS[args.adapter]} if args.adapter else ADAPTERS

    print(f"\n{'='*70}")
    print(f"  Together AI LoRA Training — {BASE_MODEL}")
    print(f"  Mode: {'DRY RUN' if args.dry_run else 'TRAINING'}")
    print(f"  Adapters: {', '.join(targets.keys())}")
    print(f"{'='*70}\n")

    for key, config in targets.items():
        data_path = LORA_DATA / config["data"]
        print(f"--- {key}: {config['name']} ---")
        print(f"  Data: {data_path.name}")
        print(f"  Description: {config['description']}")

        if not data_path.exists():
            print(f"  ERROR: {data_path} not found!")
            continue

        # Strip _meta and validate
        print(f"  Cleaning data...")
        cleaned_path, total, stripped = strip_meta(data_path)
        cleaned_lines = len(cleaned_path.read_text().strip().splitlines())
        print(f"  Total rows: {total}, stripped _meta: {stripped}, valid: {cleaned_lines}")

        # Upload
        print(f"  Uploading to Together...")
        file_id = upload_file(cleaned_path)
        os.unlink(cleaned_path)

        if not file_id:
            print(f"  ERROR: Upload failed!")
            continue
        print(f"  File ID: {file_id}")

        if args.dry_run:
            print(f"  [DRY RUN] Would train {config['name']} with {cleaned_lines} rows, {config['epochs']} epochs")
            continue

        # Train
        print(f"  Submitting training job ({config['epochs']} epochs, lr=1e-4, batch=8, train_on_inputs=auto)...")
        job_id = start_training(config, file_id)
        if not job_id:
            print(f"  ERROR: Training submission failed!")
            continue
        print(f"  Job ID: {job_id}")
        print(f"  Training started. Check progress with: python3 scripts/train-together.py --status")
        print()

    if not args.dry_run:
        print(f"\nAll jobs submitted. Monitor with:")
        print(f"  python3 scripts/train-together.py --status")


if __name__ == "__main__":
    main()
