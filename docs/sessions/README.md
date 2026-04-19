# Session retrospectives

Per-session retrospective docs capturing what shipped, what was superseded, what got caught in review, and what patterns recurred. Written at the end of each meaningful multi-hour session by a Sonnet doc-subagent (per CLAUDE.md rule 11) using `TEMPLATE.md` as the starting shape.

## Why this exists

47-commit sessions produce supersession chains (approach A → problem → approach B) that lose context within hours if only commit messages record them. These retrospectives:

- Cite specific commit SHAs + Codex thread IDs so claims are anchored
- Surface class-of-bug patterns that deserve elevation into `docs/patterns/`
- Give the next session's operator (Claude or human) enough context to continue without re-reading the commit history
- Let `docs/patterns/` docs back-link to every session where a pattern recurred

## Naming

`YYYY-MM-DD-{short-slug}.md` where slug describes the primary architectural theme. E.g., `2026-04-19-exhaustion-handler.md`, not `2026-04-19-tuesday-work.md`.

## Required content

Every retrospective MUST include:

1. **What shipped** — 150-word summary + canonical design-doc link + Codex final-verdict thread ID
2. **Architectural iterations with supersession chains** — minimum 3, each with initial → problem → fix → commit refs → lesson
3. **Codex back-and-forth exchanges** — at least 2 threads with what was flagged vs what shipped
4. **Class-of-bug patterns** — distilled lessons that should feed `docs/patterns/`
5. **Process observations** — tying patterns to session workflow (parallel subagents, review cadence, etc.)
6. **Open questions / next-session focus** — pointer to `next-session-plan.md` + `todo.md`

## How to generate

At end-of-session, spawn a Sonnet subagent briefed with:

- `git log --oneline --since='YYYY-MM-DD'`
- Codex thread IDs from the session
- `docs/sessions/TEMPLATE.md`
- Source material: `docs/decisions.md`, `docs/lessons-learned.md`, `docs/exhaustion-handler-design.md`, `docs/current-state.md`, any session-specific design memos

Subagent writes into `docs/sessions/{slug}.md`, reports back, coordinator reviews + commits as `[docs] Session retrospective {slug}`.

## Pattern elevation

If the retrospective surfaces a recurring class of bug (e.g., appears in 2+ sessions), write or update a `docs/patterns/{pattern-slug}.md` entry and back-link from the session doc. Patterns docs are reusable across the project's lifetime; session docs are point-in-time.

## Index

- [2026-04-19 — exhaustion-handler](2026-04-19-exhaustion-handler.md) — non-blind-retry architecture, debug-injection MVP, test campaign; Codex final verdict `a252aecbb785a0eb3` conditional-pass
