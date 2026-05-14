---
status: active
date: 2026-05-14
---

# L113: Lint Detect-Only Default

## Decision

Production drafting keeps lint detection telemetry on by default, but automatic
LLM style lint repair is opt-in behind `pipeline.lintAutoFixEnabled`.

Deterministic prose-integrity repair and checking remain active. The drafting
path still detects and records style lint counts through `lint-detect`, then
continues to quote/duplicate mechanical repair and full prose-integrity checks.

## Rationale

The bounded Rillgate production run showed that style lint repair was not
earning its runtime cost:

- Chapter 4 and chapter 6 LLM lint repairs introduced fused sentence boundaries.
- Chapter 5 attempt 1 gained a quote-integrity defect after lint repair.
- Chapters 2 and 5 needed deterministic duplicate cleanup after lint/drafting.

The guard prevented corrupted prose from landing, but the repair layer created
unnecessary retries, rejected fixes, and paid calls for low-confidence style
signals such as rhythm monotony.

## Implications

- `lintProse` remains useful telemetry.
- `fixLintIssues` remains available for deliberate experiments or review lanes.
- Inline lint fix traces (`lint-fix-*`, `lint-fix-rejected`) should disappear
  from default runs unless a seed explicitly sets `lintAutoFixEnabled: true`.
- Future prose improvement work should focus on upstream planning/writer shape
  or bounded review proposals, not automatic full-run style rewrites.
