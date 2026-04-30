"""
Atomic I/O helpers for parallel-safe pattern mining output.

This module consolidates three parallel-safe write patterns that pattern-mining
scripts have re-implemented ~30 times in
`scripts/structure-calibration/*.py`:

  1. `atomic_append_section()` — append a markdown section to the conclusions
     doc under fcntl flock, used by parallel subagents writing to the same
     append-only narrative log.
  2. `atomic_insert_row_before_anchor()` — read-modify-write a markdown table
     row insert under fcntl flock, used to add roadmap rows above a fixed
     "**Sequencing**" anchor.
  3. `write_timestamped_json()` — generate a unique-by-second timestamped
     filename and write a JSON artifact, never overwriting an existing file.

==============================================================================
WHY this matters
==============================================================================

Per `docs/lessons-learned.md` 2026-04-30 "Parallel subagents writing to the
same append-only doc need atomic write-then-rename, not raw append":

  > Patterns 28 / 32 / 33 / 37 all ran in parallel on 2026-04-30 and all
  > appended to the same `crystal_shard-conclusions.md`. Three race
  > conditions surfaced: (1) P33 found a merge-conflict marker left by P28,
  > (2) P37 found another conflict + concurrent stash, (3) P32's commit
  > accidentally deleted the P28 addendum entirely.

The fcntl.flock-protected append + read-modify-write avoid that class of
bug. Non-Linux/macOS readers should note that `fcntl.flock` is advisory —
all writers must take the same lock for it to work; a writer that bypasses
the API can still corrupt the file.

Per `docs/lessons-learned.md` 2026-04-30 "Preserve every analysis run; never
overwrite — the conclusions doc is append-only" + memory feedback
`feedback_no_overwrite_runs`:

  > Every analysis script writes timestamped output (`<base>.<TS>.ext`).
  > Conclusions docs are append-only — new sessions append, never edit prior
  > sections.

`write_timestamped_json()` enforces this by generating a unique filename
even on per-second collision (via millisecond suffix fallback). Calling
code does NOT need to check existence; the helper does.
"""
from __future__ import annotations

import datetime as _dt
import fcntl
import json
import os
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Conclusions-doc append (parallel-safe)
# ---------------------------------------------------------------------------


def atomic_append_section(target_path: Path, section_md: str) -> None:
    """Append a markdown section to the conclusions doc under fcntl flock.

    The lock is advisory (POSIX flock semantics) and only protects against
    other writers using the same API. The append is atomic at the OS level
    once the lock is held. After the append, fsync is called to flush the
    page cache so a follow-on `git add` sees the content.

    Args:
        target_path: absolute path to the conclusions markdown file. Must
            already exist (the helper does NOT create it).
        section_md: the markdown text to append. Caller is responsible for
            including any leading/trailing newlines that separate the new
            section from the prior content.

    Raises:
        FileNotFoundError: if `target_path` does not exist.
        OSError: if the lock cannot be acquired (rare; flock blocks).

    Example:
        >>> from pathlib import Path
        >>> # atomic_append_section(
        >>> #     Path("/.../crystal_shard-conclusions.md"),
        >>> #     "\\n\\n## Pattern 99\\n\\nFindings...\\n",
        >>> # )
    """
    if not target_path.exists():
        raise FileNotFoundError(
            f"atomic_append_section: target does not exist: {target_path}"
        )

    with target_path.open("a") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            f.write(section_md)
            f.flush()
            os.fsync(f.fileno())
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


# ---------------------------------------------------------------------------
# Roadmap-row insert (read-modify-write, parallel-safe)
# ---------------------------------------------------------------------------


def atomic_insert_row_before_anchor(
    target_path: Path,
    row_md: str,
    anchor: str,
) -> None:
    """Insert a markdown row before a string anchor under fcntl flock.

    Used by pattern scripts to insert a row into `docs/harness-tuning-roadmap.md`
    above the literal `\\n**Sequencing` anchor. The whole file is read,
    modified, and rewritten atomically under the lock; this is safe for the
    ~10 KB roadmap doc but not for large files (read-modify-write loads the
    whole file into memory).

    Args:
        target_path: absolute path to the markdown file.
        row_md: the row to insert (caller includes the trailing newline).
        anchor: the literal string the new row should be inserted BEFORE
            (the row lands immediately before the first occurrence). The
            convention in pattern scripts is `"\\n**Sequencing"`.

    Raises:
        FileNotFoundError: if `target_path` does not exist.
        RuntimeError: if `anchor` is not found in the file (the script
            should NOT silently no-op).
    """
    if not target_path.exists():
        raise FileNotFoundError(
            f"atomic_insert_row_before_anchor: target does not exist: {target_path}"
        )

    with target_path.open("r+") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            text = f.read()
            insertion_point = text.find(anchor)
            if insertion_point == -1:
                raise RuntimeError(
                    f"anchor {anchor!r} not found in {target_path}"
                )
            new_text = text[:insertion_point] + row_md + text[insertion_point:]
            f.seek(0)
            f.write(new_text)
            f.truncate()
            f.flush()
            os.fsync(f.fileno())
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


# ---------------------------------------------------------------------------
# Timestamped JSON writer (never-overwrite)
# ---------------------------------------------------------------------------


def write_timestamped_json(
    out_dir: Path,
    slug: str,
    content: dict[str, Any],
    prefix: str = "crystal_shard",
) -> Path:
    """Write a JSON artifact with a timestamped filename, never overwriting.

    Filename shape: `<prefix>.<YYYYMMDDTHHMMSS>.<slug>.json`. The timestamp
    is generated at call time in UTC. If a file at the resulting path
    already exists (collision within the same second — unlikely but
    possible under high concurrency), millisecond precision is appended:
    `<prefix>.<YYYYMMDDTHHMMSS>_<MMM>.<slug>.json`.

    Args:
        out_dir: the structure-calibration directory for this corpus
            (e.g., `novels/salvatore-icewind-dale/structure-calibration/`).
            Must exist; the helper does NOT mkdir.
        slug: short hyphenated tag for the file (e.g., `"sensory-mode-density"`).
        content: any JSON-serializable dict. The helper passes `default=str`
            so dataclasses / Path objects degrade gracefully.
        prefix: filename prefix; defaults to `"crystal_shard"` to match the
            existing convention in the IWD corpus directory. Pass the corpus
            slug to disambiguate when mining a different corpus into a
            shared directory.

    Returns:
        The path of the written file (Path object).

    Raises:
        FileNotFoundError: if `out_dir` does not exist.
        TypeError: if `content` is not JSON-serializable even with default=str.
    """
    if not out_dir.exists():
        raise FileNotFoundError(
            f"write_timestamped_json: out_dir does not exist: {out_dir}"
        )
    if not out_dir.is_dir():
        raise NotADirectoryError(
            f"write_timestamped_json: out_dir is not a directory: {out_dir}"
        )

    now = _dt.datetime.now(_dt.timezone.utc)
    ts = now.strftime("%Y%m%dT%H%M%S")

    path = out_dir / f"{prefix}.{ts}.{slug}.json"
    if path.exists():
        # Collision within the same UTC second — append milliseconds to
        # disambiguate. Highly unlikely but matches the no-overwrite rule.
        millis = f"{now.microsecond // 1000:03d}"
        path = out_dir / f"{prefix}.{ts}_{millis}.{slug}.json"
        # Edge case: even millis collide. Fall back to a numeric suffix.
        if path.exists():
            n = 1
            while True:
                cand = (
                    out_dir
                    / f"{prefix}.{ts}_{millis}_{n}.{slug}.json"
                )
                if not cand.exists():
                    path = cand
                    break
                n += 1

    path.write_text(json.dumps(content, indent=2, default=str))
    return path
