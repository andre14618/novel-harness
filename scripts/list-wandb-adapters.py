"""List W&B model artifact collections matching our SFT adapter names.

Usage (on LXC):
  set -a; source .env; set +a
  python3 scripts/list-wandb-adapters.py
"""
import os, wandb

api = wandb.Api()
entity = "andre14618-"
project = "novel-harness"

keywords = ["chapter-plan", "continuity", "adherence"]

for t in api.artifact_types(f"{entity}/{project}"):
    for coll in t.collections():
        n = coll.name.lower()
        if any(k in n for k in keywords):
            print(f"coll: {coll.name}  (type: {t.name})")
            try:
                versions = list(coll.artifacts())
            except Exception as e:
                print(f"  ERR listing: {e}")
                continue
            for v in versions:
                aliases = list(v.aliases) if v.aliases else []
                print(f"   {v.name}  aliases={aliases}  state={v.state}  created={v.created_at}")
            print()
