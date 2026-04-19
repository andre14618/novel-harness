---
pattern: in-memory-state-restart-data-loss
status: active
first-seen: 2026-04-19 (docs/sessions/2026-04-19-exhaustion-handler.md)
last-seen: 2026-04-19
---

# In-memory state + restart = data loss

## Characterization

Any in-memory-only state (JS `Map`, module-level `let`, `const` cached across calls) that the pipeline depends on for correctness will silently fail when the orchestrator restarts. Worst failure mode is NOT a crash — it's continuing with a fresh default and producing different behavior than the pre-restart process.

Symptoms:
- Behavior differs between "full clean run" and "resumed after restart"
- Flags/counters/maps that should be one-time reset themselves
- Correctness invariants (hard caps, uniqueness) break across restart boundaries

## Sessions where seen

- 2026-04-19 — [exhaustion-handler session](../sessions/2026-04-19-exhaustion-handler.md) — three instances:
  - `revisionUsed` flag in `runDraftingPhase()` local scope — restart resets → second reviser invocation violates the per-chapter hard cap. Observed anomaly on `novel-1776616563937`.
  - `pendingPlanAssistGates: Map` in `src/gates.ts:84` — restart loses pending gates; novel run stops with no recovery path.
  - Auto-mode `activeRuns: Map` in `src/orchestrator/novel-routes.ts:29` — not formally "data loss" but similar class: the run dies with the process.

## Canonical fix

**Persist the state to the DB with a pre-read at the top of each operation.** Not "persist on every change" (too much write traffic) but "on each dependent read, check the DB as source of truth."

Example shape (from next-session-plan.md Tier 1a):
```ts
// Before: local let
let revisionUsed = false

// After: DB-backed pre-read
let revisionUsed = await isRevisionUsed(novelId, ch)
// ... later, when flipping to true:
revisionUsed = true
await setRevisionUsed(novelId, ch, true)
```

Column lives on the existing per-entity row (e.g., `chapter_outlines.revision_used`) — cheap lookup, one row per operation scope, no new table needed.

**For gate-like state** (where the process was actively awaiting a Promise), full recovery requires more than persistence. The MVP is orphan-detection (surface the stale state on startup + provide cleanup endpoints); full recovery requires the consumer (e.g., `drafting.ts` attempt loop) to re-enter the awaiting code path on resume.

Reference: commit `13f8143` shipped MVP orphan detection for plan-assist gates + `chapter_outlines.plan_check_overridden` column is a working precedent for the persistence pattern.

## Anti-patterns

- **"It's only for this session; restart is rare"** — restart happens on every deploy, every systemd restart, every crash. Frequency is NOT the bug; latent incorrectness is.
- **"Auto-resume on startup"** — requires the pipeline to be able to restore in-flight Promises, which JS can't do. Better: let consumer code re-enter from scratch on user-triggered resume.
- **"Serialize the Map to disk"** — write-heavy, race-prone, doesn't handle cross-host scenarios. DB is the right layer.

## Related patterns

- [Initial-call-only injection](initial-call-only-injection.md) — different class but same "missed coverage" genus.
- Forthcoming: `pattern-gate-lifecycle-across-process-boundary.md` if gate-recovery becomes its own pattern after next session.
