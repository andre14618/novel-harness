---
status: active
updated: 2026-04-30
owner: writer-route-migration
---

# Writer Fine-Tune Retirement Remediation Plan

## Decision

The writer-layer fine-tune route is no longer the strategic target.
Salvatore v4 remains a temporary production fallback only because the first
base-DeepSeek validation was run inside a LoRA-shaped route and exposed other
pipeline defects. Do not spend more cycles proving or defending the LoRA route.

## Why

Exp #265 showed that the first Track A run was not a clean test of base
DeepSeek as the fantasy writer. It tested base DeepSeek inside the
`WRITER_GENRE_PACKS` Salvatore shell, where pack membership implied compact
LoRA context, Salvatore prompt shape, structural priors, and leak-check gating.

The run also exposed two writer-independent blockers:

- The lint-fixer can corrupt approved prose after the raw draft was acceptable.
- The planner/continuity loop can permit impossible knowledge or role states.

Those defects must be fixed before another writer-route verdict is meaningful.

## Non-Goals

- No new writer LoRA training.
- No v2 voice-shaping charter until the remediation blockers are fixed.
- No Salvatore-vs-DeepSeek bake-off whose purpose is to defend keeping the LoRA.
- No migration decision based only on surface voice metrics or linted approved prose.

## Implementation Status

- Slice 1 code path is implemented: `WRITER_GENRE_PACKS` now carries explicit `compactContext` and `leakProfile` metadata. Runtime base-model overrides keep fantasy structural priors but clear LoRA-specific compact context and Salvatore leak checks unless explicitly overridden.
- Slice 2 code path is implemented: lint-fixed prose is guarded by deterministic integrity checks before it can replace the raw draft. The exp #265 corruption shapes (`blade.She`, `againShe`, `.ind her`) are covered by tests.
- Slice 3 clean validation ran as exp #268 (`novel-1777580634348`) and returned NO-SHIP for checker/approval-policy reasons, not for word count. Route decoupling was verified (`beat-writer|deepseek|deepseek-v4-flash`, `compact=false`, `leak=none`), but unresolved beat-check issues, continuity blockers, malformed dialogue, duplicate seams, and location drift still reached approval. See `docs/base-deepseek-clean-validation-268.md`.
- Slice 4 checker-policy remediation started in exp #269: unresolved beat-check blockers and continuity blockers now stop approval, and deterministic final-prose integrity blocks duplicate spans / malformed quotes before approval. Still pending: an independent chapter-level oracle fixture for stitched-beat coherence and named-entity/lore grounding.

## Remediation Slices

### Slice 1 — Decouple Genre Packs From Writer Route

Goal: make `WRITER_GENRE_PACKS` stop implying “LoRA route.”

Tasks:

- Split pack responsibilities into explicit fields: structural priors, writer model, system prompt, compact-context mode, and checker/leak profile.
- Make compact context an explicit boolean, not `!!writerPack`.
- Ensure the base-DeepSeek fantasy route uses rich/default beat context unless explicitly configured otherwise.
- Add tests that verify fantasy structural priors can apply while the writer still uses default rich context.

Exit gate:

- A fantasy seed can route planning priors through the Salvatore-derived pack while `beat-writer` receives base DeepSeek plus default rich context.

### Slice 2 — Guard The Lint-Fixer

Goal: approved prose must never be worse than raw prose due to lint fixing.

Tasks:

- Add a deterministic post-fix integrity check before saving the lint-fixed version.
- Reject fixes with fused sentence boundaries, dropped spaces, duplicated fragments, or malformed paragraph joins.
- If the guard fails, keep the raw draft approved and log/trace the lint rejection.
- Add regression fixtures from exp #265: `blade.She`, `againShe`, `.ind her`, and adjacent duplicate fragments.

Exit gate:

- The exp #265 corruption patterns are rejected and cannot become approved prose.

### Slice 3 — Clean Base-DeepSeek Validation Run

Goal: get a real verdict on base DeepSeek as the fantasy writer, not on the LoRA shell.

Status: complete, NO-SHIP on exp #268. The route was clean, but the approval policy was not.

Tasks:

- Run a 3-chapter fantasy seed with base DeepSeek using rich/default beat context.
- Preserve raw and approved prose separately in the read-through notes.
- Read raw pre-lint prose first, then approved prose after lint guard.
- Record blockers by source: planner, writer, checker, lint-fixer, or route wiring.

Exit gate:

- Full-novel read-through has no severe role/relationship errors, no malformed prose, and no unresolved plan/continuity contradiction that changes the story logic.

### Slice 4 — Planner/Continuity Remediation

Goal: impossible knowledge, role/location state drift, and caught-but-unresolved checker blockers must be stopped before approval.

Tasks:

- Use exp #265 as a fixture for Aldric’s impossible knowledge reveal and Elara’s role drift.
- Use exp #268 as a fixture for accepted unresolved checker blockers, continuity blockers approved as diagnostics, malformed dialogue, duplicate seams, and Wren/Istra location drift.
- Decide whether the fix belongs in planning-beats prompt constraints, chapter-plan-checker scope, continuity prompt scope, or deterministic state validation.
- Add the smallest guard that catches the class without expanding into broad prose judging.

Exit gate:

- The Aldric/Elara failure class is blocked or revised before chapter approval.

## Ship Criteria For Retiring The Writer LoRA

Retire Salvatore v4 from fantasy routing only when:

- Base DeepSeek fantasy route uses rich/default context, not compact LoRA context.
- Lint-fixer integrity guard is active.
- At least one 3-chapter fantasy validation novel passes raw and approved read-through.
- The decision is recorded in `docs/decisions.md` with experiment ID, novel ID, and commit hash.

## Fallback Policy

Until those gates clear, Salvatore v4 can stay in production as a fallback.
That is operational risk management, not a strategic endorsement of writer
fine-tuning.
