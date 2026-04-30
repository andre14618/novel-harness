"""
Reference template for new pattern-mining scripts.

Copy this file to `scripts/structure-calibration/<pattern-slug>.py`, fill in
the per-pattern logic at the marked extension points, and run. The template
is intentionally runnable as-is — it produces a no-op JSON artifact + a
no-op markdown section + a no-op roadmap row, so you can verify the wiring
end-to-end before plugging in real analysis logic.

==============================================================================
What this template gives you
==============================================================================

  - Loading beats.jsonl + scenes.jsonl into in-memory lists
  - Per-book aggregation skeleton (group beats by book, by chapter, etc.)
  - Calling `directional_gate` library to compute the verdict
  - Writing JSON via `atomic_io.write_timestamped_json` (never-overwrite)
  - Appending a markdown section via `atomic_io.atomic_append_section`
    (parallel-safe — uses fcntl flock)
  - Inserting a roadmap row via `atomic_io.atomic_insert_row_before_anchor`

==============================================================================
What this template does NOT give you
==============================================================================

  - The pattern logic itself (you write `analyze()`).
  - LLM classification — if your pattern needs an LLM call, see
    `scripts/structure-calibration/chapter-opener-taxonomy.py` for the
    aiohttp + asyncio Semaphore pattern. The template is pure-compute only.
  - Anchor stability validation — for stochastic-schema dims (LLM
    classifications), your pattern must run a Sonnet self-consistency check
    BEFORE shipping a verdict. See `docs/lessons-learned.md` 2026-04-30
    "Cross-model F1 ≠ anchor stability" + "Small-sample anchor Jaccard is a
    screening tool, not a ship gate."

==============================================================================
Calling convention
==============================================================================

The template runs as a script with no arguments:

  python3 scripts/structure-calibration/<your-pattern>.py

It prints a verdict summary to stdout, writes a JSON to
`novels/<corpus>/structure-calibration/`, appends a section to the
conclusions doc, and inserts a row into the roadmap.

==============================================================================
Workflow (also documented in `docs/pattern-mining-framework.md`)
==============================================================================

  1. Add a row to `docs/harness-tuning-roadmap.md` with verdict `pending`.
  2. Copy this template to `<pattern-slug>.py`.
  3. Fill in `PATTERN_NUMBER`, `PATTERN_NAME`, `PATTERN_SLUG`, and the body
     of `analyze()`.
  4. Run the script.
  5. Verify outputs (JSON, markdown section, roadmap row).
  6. Update `pattern-registry.json` with the verdict.
  7. Commit.
"""
from __future__ import annotations

import datetime as _dt
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

# Add the lib dir to sys.path so the imports below resolve when this script
# is run from the repo root via `python3 scripts/structure-calibration/...`.
_LIB_DIR = Path(__file__).resolve().parent
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from directional_gate import (  # noqa: E402
    Verdict,
    combine_gates,
    gate_density_spread,
    gate_modal_class,
    gate_ranking_jaccard,
    gate_sign_of_effect,
    gate_top_k_overlap,
)
from atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)

# ---------------------------------------------------------------------------
# Pattern identity — fill these in
# ---------------------------------------------------------------------------

PATTERN_NUMBER: int = 0  # roadmap row number, e.g. 99
PATTERN_NAME: str = "Pattern Template (no-op)"
PATTERN_SLUG: str = "pattern-template-noop"  # filename slug

# ---------------------------------------------------------------------------
# Paths — defaults target the Salvatore Icewind Dale corpus
# ---------------------------------------------------------------------------

REPO = Path("/Users/andre/Desktop/personal_projects/novel-harness")
CORPUS_KEY = "salvatore-icewind-dale"
BUNDLE = REPO / "novels" / CORPUS_KEY
BEATS_PATH = BUNDLE / "beats.jsonl"
SCENES_PATH = BUNDLE / "scenes.jsonl"
OUT_DIR = BUNDLE / "structure-calibration"
CONCLUSIONS_PATH = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_PATH = REPO / "docs" / "harness-tuning-roadmap.md"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BOOK_ORDER = ["crystal_shard", "streams_of_silver", "halflings_gem"]
ROADMAP_ANCHOR = "\n**Sequencing"


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_beats() -> list[dict[str, Any]]:
    """Load beats.jsonl into memory. Each beat has fields:
        book, chapter, scene_id, beat_idx, kind, words, text, first_sentence
    """
    out: list[dict[str, Any]] = []
    with BEATS_PATH.open() as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def load_scenes() -> list[dict[str, Any]]:
    """Load scenes.jsonl into memory. Each scene has fields:
        book, chapter, scene_idx, boundary, words, beats, ...
    """
    out: list[dict[str, Any]] = []
    with SCENES_PATH.open() as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def commit_short() -> str:
    """Best-effort short git SHA — used to anchor the JSON / markdown row to
    the runtime code state. Never fails the run."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


# ---------------------------------------------------------------------------
# Pattern logic — REPLACE this with your real analysis
# ---------------------------------------------------------------------------


def analyze(beats: list[dict[str, Any]]) -> dict[str, Any]:
    """The pure-compute body of the pattern.

    The template demonstrates the per-book aggregation skeleton:
      1. Bucket inputs by `book`.
      2. Compute per-book metrics (here: simple beat-count and mean words).
      3. Call the appropriate gate(s) on the per-book results.
      4. Combine gates if multiple.

    Replace the body with your real computation. Return a dict suitable
    for JSON serialization. Required keys (used by `render_conclusions_md`
    and `render_roadmap_row`):
      - `per_book`: dict[book → per-book stats]
      - `verdict`: Verdict literal (PASS / PASS_PARTIAL / DIVERGE / KILL)
      - `gates_used`: list[str] for the registry (e.g., ["modal_class"])
      - `findings_short`: ≤ 240-char summary for the roadmap row
    """
    # Step 1: per-book bucketing
    by_book: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for b in beats:
        by_book[b["book"]].append(b)

    # Step 2: per-book metrics (template: just count beats)
    per_book: dict[str, dict[str, Any]] = {}
    per_book_density: dict[str, float] = {}
    for book in BOOK_ORDER:
        sub = by_book.get(book, [])
        per_book[book] = {
            "n_beats": len(sub),
            "mean_words": (
                round(sum(b.get("words", 0) for b in sub) / len(sub), 2)
                if sub else 0.0
            ),
        }
        per_book_density[book] = per_book[book]["mean_words"]

    # Step 3: gate(s) — template uses density_spread on mean_words
    # Replace with whatever gate matches your pattern.
    spread_verdict: Verdict = gate_density_spread(per_book_density, threshold_pct=20.0)

    # Step 4: combine if multiple — template only has one gate
    overall: Verdict = combine_gates([spread_verdict])

    return {
        "per_book": per_book,
        "verdict": overall,
        "gates_used": ["density_spread"],
        "spread_verdict": spread_verdict,
        "findings_short": (
            f"per-book mean beat-words density spread → {spread_verdict}; "
            f"per-book counts: "
            + ", ".join(
                f"{b}={per_book[b]['n_beats']}/{per_book[b]['mean_words']}w"
                for b in BOOK_ORDER
            )
        ),
    }


# ---------------------------------------------------------------------------
# Markdown section renderer
# ---------------------------------------------------------------------------


def render_conclusions_md(result: dict[str, Any], json_path: Path, commit: str) -> str:
    """Build the markdown section that gets atomic-appended to the
    conclusions doc. Caller-overridable; default is a generic shape that
    works for almost any pattern."""
    lines: list[str] = []
    lines.append("")
    lines.append("")
    lines.append(f"## Pattern {PATTERN_NUMBER}: {PATTERN_NAME}")
    lines.append("")
    lines.append(
        f"_Commit `{commit}`. JSON: `{json_path.relative_to(REPO)}`. "
        f"Verdict: **{result['verdict']}**._"
    )
    lines.append("")
    lines.append("### Per-book stats")
    lines.append("")
    for book in BOOK_ORDER:
        stats = result["per_book"].get(book, {})
        if stats:
            kvs = ", ".join(f"{k}={v}" for k, v in stats.items())
            lines.append(f"- **{book}** → {kvs}")
    lines.append("")
    lines.append(f"### Conclusion + Action — Pattern {PATTERN_NUMBER}: **{result['verdict']}**")
    lines.append("")
    lines.append(result["findings_short"])
    lines.append("")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Roadmap row renderer
# ---------------------------------------------------------------------------


def render_roadmap_row(result: dict[str, Any], commit: str) -> str:
    """Build a single roadmap row. Format must match the existing table in
    `docs/harness-tuning-roadmap.md` — 8 columns:

      | # | Pattern | Harness target | Variant drafted? | Probe run? | Cross-book? | Point-estimate verdict | Directional verdict |
    """
    verdict = result["verdict"]
    if verdict == "PASS":
        ship = "ship"
    elif verdict == "PASS_PARTIAL":
        ship = "ship soft prior; full ranking may not be load-bearing"
    elif verdict == "DIVERGE":
        ship = "HOLD — does not reproduce across books"
    elif verdict == "KILL":
        ship = "KILL — no signal"
    else:
        ship = f"INCOMPLETE — {verdict}"

    findings = result["findings_short"]
    lever = "TODO — fill in the harness lever this pattern feeds"

    return (
        f"| {PATTERN_NUMBER} | **{PATTERN_NAME}** (`{commit}`): {findings} | "
        f"{lever} | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | "
        f"**{verdict}** — {ship} |\n"
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    commit = commit_short()
    print(
        f"[pattern-{PATTERN_NUMBER}] starting; "
        f"slug={PATTERN_SLUG}; commit={commit}",
        file=sys.stderr,
    )

    beats = load_beats()
    print(f"[pattern-{PATTERN_NUMBER}] loaded {len(beats)} beats", file=sys.stderr)

    # Run the analysis.
    result = analyze(beats)

    # Wrap with metadata for the JSON artifact.
    payload: dict[str, Any] = {
        "pattern_number": PATTERN_NUMBER,
        "pattern_name": PATTERN_NAME,
        "slug": PATTERN_SLUG,
        "commit": commit,
        "timestamp_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        **result,
    }

    # Write the JSON artifact (never overwrites).
    json_path = write_timestamped_json(OUT_DIR, PATTERN_SLUG, payload)
    print(f"[pattern-{PATTERN_NUMBER}] JSON → {json_path}", file=sys.stderr)

    # Append the conclusions section.
    section_md = render_conclusions_md(result, json_path, commit)
    atomic_append_section(CONCLUSIONS_PATH, section_md)
    print(
        f"[pattern-{PATTERN_NUMBER}] appended → {CONCLUSIONS_PATH}",
        file=sys.stderr,
    )

    # Insert the roadmap row.
    row_md = render_roadmap_row(result, commit)
    atomic_insert_row_before_anchor(ROADMAP_PATH, row_md, ROADMAP_ANCHOR)
    print(
        f"[pattern-{PATTERN_NUMBER}] inserted row → {ROADMAP_PATH}",
        file=sys.stderr,
    )

    # Terse stdout summary so the orchestrator can grep verdict lines easily.
    print(f"\n=== Pattern {PATTERN_NUMBER} — {PATTERN_NAME} ===")
    print(f"verdict: {result['verdict']}")
    print(f"gates: {result['gates_used']}")
    print(f"findings: {result['findings_short']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
