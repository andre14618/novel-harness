#!/usr/bin/env python3
"""Load a JSONL brief file into the eval_briefs DB table.

Usage:
  python3 scripts/finetune/load-eval-briefs.py \\
    --input /tmp/salvatore-original-briefs-expanded.jsonl \\
    --set-name salvatore-original-v1 \\
    --notes "18 original-character briefs. No Salvatore lore. POV-diverse, kind-diverse. Used as cross-distribution eval for voice LoRAs."

Expected input JSONL shape (one of):
  {"brief": {"beat_id": "...", ...}}                      # brief-only
  {"brief": {...}, "ground_truth_prose": "..."}           # brief + GT prose
  {"brief": {...}, "ground_truth_prose": "...",
   "ground_truth_style": {...}}                           # + precomputed style

Upserts by (set_name, beat_id). Running twice with same set_name updates
briefs rather than duplicating.
"""

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import psycopg
except ImportError:
    sys.exit("pip install psycopg[binary] first")


def load_db_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("ERROR: DATABASE_URL not set")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--set-name", required=True)
    ap.add_argument("--notes", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = []
    for line in args.input.open():
        if not line.strip():
            continue
        obj = json.loads(line)
        brief = obj.get("brief", obj)
        beat_id = brief.get("beat_id")
        if not beat_id:
            print(f"WARN: row missing beat_id, skipping: {brief.get('setting', '?')[:40]}", file=sys.stderr)
            continue
        rows.append({
            "set_name": args.set_name,
            "beat_id": beat_id,
            "brief_json": json.dumps(brief),
            "ground_truth_prose": obj.get("ground_truth_prose"),
            "ground_truth_style": json.dumps(obj["ground_truth_style"]) if "ground_truth_style" in obj else None,
            "notes": args.notes,
        })

    print(f"Prepared {len(rows)} rows for set_name='{args.set_name}'")

    if args.dry_run:
        print("DRY RUN — not writing. First row:")
        print(json.dumps(rows[0], indent=2)[:600] if rows else "  (empty)")
        return

    with psycopg.connect(load_db_url()) as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO eval_briefs (set_name, beat_id, brief_json, ground_truth_prose, ground_truth_style, notes)
                VALUES (%(set_name)s, %(beat_id)s, %(brief_json)s::jsonb, %(ground_truth_prose)s,
                        CASE WHEN %(ground_truth_style)s IS NOT NULL THEN %(ground_truth_style)s::jsonb ELSE NULL END,
                        %(notes)s)
                ON CONFLICT (set_name, beat_id) DO UPDATE SET
                  brief_json = EXCLUDED.brief_json,
                  ground_truth_prose = EXCLUDED.ground_truth_prose,
                  ground_truth_style = EXCLUDED.ground_truth_style,
                  notes = EXCLUDED.notes
                """,
                rows,
            )
        conn.commit()

    # Report
    with psycopg.connect(load_db_url()) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM eval_briefs WHERE set_name = %s", (args.set_name,))
            n = cur.fetchone()[0]
    print(f"✓ eval_briefs now has {n} rows under set_name='{args.set_name}'")


if __name__ == "__main__":
    main()
