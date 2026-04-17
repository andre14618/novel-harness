"""Shared utilities for Stage 5 analyzers.

Each analyzer consumes beats.jsonl + pairs.jsonl from a bundle, produces
one JSON artifact at analysis/<name>.json (or .jsonl for line-oriented
output). Analyzers are independent — no analyzer depends on another's
output.
"""
from __future__ import annotations
import json
from pathlib import Path
from typing import Iterator

REPO_ROOT = Path(__file__).resolve().parents[2]
NOVELS_DIR = REPO_ROOT / "novels"


def bundle_path(novel_key: str) -> Path:
    p = NOVELS_DIR / novel_key
    if not p.exists():
        raise FileNotFoundError(f"bundle not found: {p}")
    return p


def load_beats(novel_key: str) -> list[dict]:
    path = bundle_path(novel_key) / "beats.jsonl"
    return [json.loads(l) for l in path.open()]


def load_pairs(novel_key: str) -> list[dict]:
    path = bundle_path(novel_key) / "pairs.jsonl"
    if not path.exists():
        return []
    return [json.loads(l) for l in path.open()]


def write_analysis(novel_key: str, name: str, data: dict | list) -> Path:
    out_dir = bundle_path(novel_key) / "analysis"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{name}.json"
    out.write_text(json.dumps(data, indent=2, default=str))
    return out


def write_analysis_jsonl(novel_key: str, name: str, rows: Iterator[dict]) -> Path:
    out_dir = bundle_path(novel_key) / "analysis"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{name}.jsonl"
    with out.open("w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    return out
