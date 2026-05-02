---
loop: L23a
status: shipped
started: 2026-05-02
completed: 2026-05-02
experiment: 342
branch: synthesis-bundle-v1
---

# L23a — NER Initials + Capitalized-First-Only Extractor Classes

## Objective

L22 (exp #340, doc `docs/l22-smoke-l20-validation-2026-05-01.md`) found chapter 1 plan-assist fired on 4 NEW unresolved entities outside L20's fix class. Two of those are deterministic NER blind spots that L23a addresses:

1. **`T.C.`** — initials/abbreviation pattern (single-token with periods). Existing NER extractors require multi-token capitalized sequences.
2. **`Aether waste`** — capitalized-first-only domain term (`[Cap] [lowercase]+`). Existing capitalized-multi-word requires `[Cap] [Cap]+`.

Add two new extractor classes that close these patterns deterministically without lifting FP rate on the labeled or expanded panels.

## Acceptance Criteria

- Both classes fire on the L22 entities (T.C., Aether waste)
- 0 FP regressions on labeled panel + L12 expanded synthetic panel + L4-followup-2 calibration panels
- F1 holds or improves
- 5+ unit tests per class with edge cases
- Existing 80/80 tests still pass

## Parallel Loop

L23b (semantic fixes: v5 prompt + title derivation) dispatched in parallel. L23a owns:
- `src/lint/entity-candidates.ts` — new extractor classes + `deriveInitials` helper
- `src/lint/entity-candidates.test.ts` — new unit tests
- `src/agents/halluc-ungrounded/schema.ts` — NerFinding class enum extension

L23b should NOT touch `schema.ts` class enum (L23a owns this file).

## Class Specs

### `initials`
- Regex: `\b[A-Z]\.[A-Z]\.(?:[A-Z]\.)?(?=[\s,;:!?]|$)`
- Matches: `T.C.`, `J.R.R.`, `K.J.`
- Must NOT match when in grounded set (e.g. `U.S.A.` if in world-bible)
- Derived-initials helper: `deriveInitials("Taryn Coombs Vey")` → `["T.C.V.", "T.C.", "T.V."]`
- Grounding: match against derived initials from character_roster names

### `capitalized-first-only`
- Regex: `\b[A-Z][a-z]+ [a-z]+(?:[a-z-]+)?\b`
- Matches: `Aether waste`, `Crystal lattice`, `Soul fire`
- HIGH FP RISK — sentence-initial capitalization
- SAFE FALLBACK: only emit if first word is in the grounded set (first word grounded → emit, ungrounded → skip)

## Source Files

- `src/lint/entity-candidates.ts` — 5 extractor classes post-L15 (title-pair, capitalized-multi-word, suffix-class, x-of-y-capitalized, number-word-tail)
- `src/lint/entity-candidates.test.ts` — 80 tests passing (commit `74171d5`/`ccec328`)
- `src/agents/halluc-ungrounded/schema.ts` — NerFinding.class enum
- `src/agents/halluc-ungrounded/index.ts` — `runNerPrepass`, `buildNerGroundedSet`

## Progress Log

| Time | Event |
|------|-------|
| 2026-05-02 start | Reading entity-candidates.ts, tests, schema.ts, index.ts, L22 doc |
| 2026-05-02 | Implementing initials + capitalized-first-only classes |
| | |

## Key Decisions

- `capitalized-first-only` gated on first-word grounded: prevents sentence-initial FPs (e.g. "Aether" must appear in worldBible.systems for "Aether waste" to fire). The gating happens in `runNerPrepass` after extraction, not inside `extractEntityCandidates`, because the grounded set is not available in the pure extraction layer.
- `initials` extracts via regex then grounds against derived initials from character_roster entries. `deriveInitials` exported so `buildNerGroundedSet` can populate the grounded surface.
- `extractEntityCandidates` signature is unchanged (pure function, no grounded-set param). The cap-first-only class emits candidates unconditionally; gating in `runNerPrepass` avoids coupling the extractor to runtime context.
