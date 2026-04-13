"""Check W&B runs associated with the SFT submissions to see their status.

Usage:
  set -a; source .env; set +a
  python3 scripts/check-wandb-sft-runs.py
"""
import wandb

api = wandb.Api()
entity = "andre14618-"
project = "novel-harness"

# Pull recent runs and look for anything touching our three target names
targets = ["adherence-checker-v3-sonnet", "continuity-v1", "chapter-plan-checker-v1"]

runs = api.runs(f"{entity}/{project}", filters={"createdAt": {"$gte": "2026-04-09"}})
print(f"Recent runs (past 3 days): {len(runs)}\n")

# First pass: list ALL run names so we can see what's there
print("=== all run names ===")
for run in runs:
    print(f"  {run.name}  state={run.state}  created={run.created_at}")
print()

for run in runs:
    name = run.name or ""
    config = run.config or {}
    tags = run.tags or []
    summary = dict(run.summary._json_dict) if hasattr(run.summary, "_json_dict") else dict(run.summary)

    hit = any(t in name for t in targets) or any(t in str(config) for t in targets) or any(t in " ".join(tags) for t in targets)
    if not hit:
        continue

    print(f"run: {run.name}  id={run.id}  url={run.url}")
    print(f"  state: {run.state}")
    print(f"  created: {run.created_at}")
    print(f"  tags: {tags}")
    print(f"  runtime: {summary.get('_runtime', '?')}s")
    print(f"  summary keys: {sorted(summary.keys())}")
    # Print step/loss if available
    for k in ["_step", "train/loss", "train/global_step", "epoch", "loss", "num_tokens", "trainer/global_step", "train_loss"]:
        if k in summary:
            print(f"  {k}: {summary[k]}")
    print()
