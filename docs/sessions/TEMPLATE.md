---
status: retrospective
updated: YYYY-MM-DD
duration: ~Xh
commits: N
subagents_spawned: M
---

# {Session theme} — YYYY-MM-DD

## 1. What shipped (≤150 words)

One paragraph. Reference the canonical design doc (`docs/{design-memo}.md`), the final Codex verdict thread ID, and any conditional/confidence markers.

## 2. Architectural iterations with supersession chains

For each major pivot:

### Chain {Letter}: {topic}

- **Initial approach:** what we first thought (commit `sha`)
- **Problem discovered:** what broke it
- **Superseded by:** the fix (commit `sha`)
- **Commit refs:** SHA + one-line description
- **Lesson:** generalizable pattern (→ elevate to `docs/patterns/{slug}.md` if it recurs)

Minimum 3 chains per session.

## 3. Codex back-and-forth exchanges

Numbered list. Each entry:

- **Thread:** `axxxxxxxx` (full Codex agent ID)
- **Original commit claim:** what was stated
- **Codex found:** what was flagged
- **Fix:** commit SHA + one-line
- **Sufficient?** yes / ongoing / deferred to next session

Minimum 2 exchanges.

## 4. Class-of-bug patterns

Bullet list of pattern-level lessons. Format: **{pattern name}** — one-sentence characterization + "seen at {count} sites this session". Flag any pattern that recurs ≥2 times for elevation to `docs/patterns/{slug}.md`.

## 5. Process observations

200-300 words. Tie patterns to session-level workflow: parallel subagent usage, Codex review cadence, doc subagent pattern, act-on-consensus pattern, anything non-obvious about how the work got done.

## 6. Open questions / next-session focus

Pointer to `docs/next-session-plan.md` (if it exists for this session) and any items that didn't fit into the plan. End with a short "if you're reading this on the next session, start here" paragraph.
