"""Paragraph-break normalization for training-corpus prose.

Why this exists
---------------
PDF extraction (pypdf / pdfminer) frequently loses paragraph breaks in dialogue-
heavy prose. Salvatore v1 LoRA was trained on a corpus where this had happened
silently — the model learned wall-of-text output and shipped that bug into
every generation. Always run prose fields through `normalize_breaks()` before
emitting SFT training data.

The function is idempotent: well-formed `\\n\\n`-separated prose is unchanged.
The report helper surfaces coverage so upstream defects are visible at
format-time, not at inference-time.

Used by:
  - scripts/finetune/format-salvatore-sft.py
  - any future SFT-format script
"""

from __future__ import annotations

import re
from dataclasses import dataclass


def normalize_breaks(prose: str) -> str:
    """Restore paragraph breaks in extracted prose.

    Two passes:
      1. Any run of newlines → `\\n\\n`. PDF extraction commonly emits
         one-line-per-turn dialogue where lone `\\n` are real breaks.
      2. Only when ZERO newlines exist (wall-of-text), inject `\\n\\n`
         before any quoted turn that follows a sentence terminator.
         Conservative — does not invent breaks inside pure narration.

    Idempotent: prose already separated by `\\n\\n` is returned unchanged
    (aside from leading/trailing whitespace trim).
    """
    t = prose.strip()
    t = re.sub(r"\n+", "\n\n", t)
    if "\n\n" not in t:
        t = re.sub(r"""([.!?]["']?)\s+(["'][A-Z])""", r"\1\n\n\2", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


@dataclass
class BreakCoverage:
    total: int
    with_blank_breaks: int
    with_any_newline: int
    wall_of_text: int

    @property
    def blank_break_pct(self) -> float:
        return self.with_blank_breaks / max(1, self.total)

    def summary(self) -> str:
        return (
            f"blank-line breaks: {self.with_blank_breaks}/{self.total} "
            f"({self.blank_break_pct * 100:.1f}%)  "
            f"wall-of-text: {self.wall_of_text}"
        )


def measure(prose_list: list[str]) -> BreakCoverage:
    total = len(prose_list)
    blank = sum(1 for p in prose_list if "\n\n" in p)
    anynl = sum(1 for p in prose_list if "\n" in p)
    return BreakCoverage(
        total=total,
        with_blank_breaks=blank,
        with_any_newline=anynl,
        wall_of_text=total - anynl,
    )


def assert_minimum_coverage(
    prose_list: list[str],
    *,
    min_blank_break_pct: float = 0.50,
    dialogue_kinds: list[str] | None = None,
    kinds: list[str] | None = None,
) -> BreakCoverage:
    """Hard gate — raise if paragraph-break coverage looks broken.

    Default threshold is 50%: most author corpora land at 65-85% after
    `normalize_breaks`. If we fall below 50%, the upstream extractor
    probably lost dialogue boundaries and v1 failure mode is reproducing.

    Override with `min_blank_break_pct=0.0` to disable (e.g. for corpora
    that are legitimately single-paragraph-dominant, like interiority-
    only excerpts).

    When `dialogue_kinds` and `kinds` are provided, coverage on the
    dialogue slice is also checked — dialogue beats that lack breaks
    are the strongest failure signal.
    """
    cov = measure(prose_list)
    if cov.blank_break_pct < min_blank_break_pct:
        raise RuntimeError(
            f"paragraph-break coverage {cov.blank_break_pct * 100:.1f}% "
            f"is below the {min_blank_break_pct * 100:.0f}% minimum. "
            f"{cov.wall_of_text} wall-of-text pairs found. "
            f"Upstream extractor likely dropped dialogue boundaries — "
            f"rerun corpus ingestion with a diff-check on `\\n\\n` density "
            f"before training. Use min_blank_break_pct=0.0 to bypass."
        )
    if dialogue_kinds and kinds and len(kinds) == len(prose_list):
        dialog_pairs = [p for p, k in zip(prose_list, kinds) if k in dialogue_kinds]
        if dialog_pairs:
            d = measure(dialog_pairs)
            if d.blank_break_pct < 0.80:
                raise RuntimeError(
                    f"dialogue-kind pairs: {d.blank_break_pct * 100:.1f}% have "
                    f"paragraph breaks (expected ≥80%). Dialogue without breaks "
                    f"is the v1 bug. {d.wall_of_text}/{d.total} wall-of-text "
                    f"dialogue pairs found."
                )
    return cov
