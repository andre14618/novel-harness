---
status: design
updated: 2026-04-19
---

# Exhaustion-handler design memo

Three places in `src/phases/drafting.ts` currently fall through to a blind
outer-attempt restart (`bail = true; continue`). A blind restart replays the
same failure with no new context and wastes a full chapter's LLM budget. This
memo specs targeted handlers for each.

Scope: design only. Implementation is a separate PR. Aligned with Codex
gpt-5.4 review 2026-04-19 (see `docs/non-blind-retry-session-plan.md` §"Corrections from Codex review").

## Today's exhaustion paths

| # | Path | Trigger | Current behavior | File:line |
|---|---|---|---|---|
| A | Plan-check exhausted | `chapter-plan-checker` still `pass=false` after targeted rewrites AND (revisionUsed \|\| duplicate sig \|\| !canSettle) | `bail=true`, outer loop restarts with unchanged plan | drafting.ts:655-676 |
| B | Reviser rejected | Post-revision sanity checks fail (beat floor or new characters) | `bail=true`, outer loop restarts with unchanged plan | drafting.ts:593-614 |
| C | Validation exhausted | Word-count / pov-missing blockers survive targeted rewrite settle loop | `bail=true`, outer loop restarts with unchanged plan | drafting.ts:781-785 |

All three are "automated repair has run out of moves." A blind re-attempt has
no signal the next round will fire different beats or land a different prose
shape.

## Path (A) + (B) — `plan-assist` human gate (unified)

One gate type, two payload discriminators. The user's decision space is the
same in both cases (manually edit plan, override and draft against existing
plan, or abort chapter) — the payload differs only in what caused the halt.

### Gate payload schema

```ts
type PlanAssistGatePayload = {
  kind: "plan-check-exhausted" | "reviser-rejected"
  novelId: string
  chapter: number
  outline: ChapterOutline            // current (original if A, rejected-new if B)
  prose: string                      // last-attempt prose
  unresolvedDeviations: Deviation[]  // what plan-check was still flagging
  reviserHistory?: {                 // only present on kind=reviser-rejected
    attemptedScenes: SceneBeat[]
    rejectionReason: string          // "beat floor" | "new characters: X,Y"
  }
}
```

### User options surfaced by the gate

1. **Supply edited outline** — user pastes a JSON patch or full replacement.
   Validated against `chapterOutlineSchema`, persisted via `saveChapterOutline`,
   outer loop restarts with the new plan.
2. **Override and draft** — bypass the plan check entirely for this chapter.
   Sets `planCheckOverride=true` for this chapter in-memory; next attempt
   drafts and skips plan-check. Warning logged; approval gate still fires
   at end.
3. **Abort chapter** — stop the drafting phase with a clear error. Novel
   stays in `drafting` phase; user can resume later after manual fix.

### Auto-mode behavior (Codex feedback — critical)

`src/cli.ts:99-102` makes `presentForApproval` auto-approve in `resolverMode ===
"auto"`. Plan-assist must NOT auto-approve — silently approving "override and
draft" on an unattended run defeats the purpose of the exhaustion detection.

Recommended: `presentForApproval` (or a new `presentForExhaustion`) recognizes
the gate kind and, when `resolverMode === "auto"`, **throws a
`PipelineBailError`** with the unresolved context instead of returning a
decision. The run halts loudly; the user sees the novel stuck in `drafting`
with a recorded exhaustion event.

Alternative considered and rejected: auto-pick "abort chapter" in auto mode.
Discarded because it changes pipeline semantics for already-running unattended
runs — current behavior is "retry until maxDraftAttempts exhausted then stop,"
not "bail at first exhaustion." The throw path is more conservative.

### Telemetry

New `chapter_exhaustions` table (or extend `chapter_revisions` with an
`exhaustion_kind` column) recording every (A)/(B) gate fire. Needed for
§1 runbook (measure how often handlers fire per seed/chapter) and future
active-learning harvest (disagreements between user override and plan-check
become reviser training data).

## Path (C) — validation-driven reviser escalation (not a gate)

Word-count and pov-missing blockers are deterministic chapter-shape problems.
They fail because the planned beat list can't physically produce the required
output shape (too few beats for target word count, POV character not cast into
any beat that ended up surviving rewrites). The existing
`chapter-plan-reviser` pattern is the right fit.

### Proposed agent

`chapter-plan-reviser` stays one agent, but the context builder diverges:

- `buildContext(outline, prose, planCheckDeviations: string[])` — existing,
  plan-check path.
- `buildContextForValidation(outline, prose, validationBlockers: ValidationBlocker[])` — new.

Different context shape because validation blockers are deterministic facts,
not LLM-judgment deviations. Feeding them through the plan-check deviation
path would contaminate the reviser's prompt contract.

### Guard rail

`revisionUsed` currently tracks plan-check-driven revisions only. Extend to
track BOTH plan-check AND validation-driven revisions per chapter —
otherwise a single chapter could fire two revisers (one from plan-check,
one from validation), which defeats the hard-cap guarantee the Task 3 test
enforces.

Suggested shape:

```ts
let revisionUsed = false  // unchanged semantics: one reviser call per chapter, ANY source
```

Both the plan-check and validation escalation paths check and set the same
flag.

### Failure mode — reviser rejected on validation path

If the validation-driven reviser's output fails the post-revision sanity
checks (beat floor, no new characters), the target end-state is to fall
through to the `plan-assist` gate (path B) — same human-decision surface,
payload `kind: "reviser-rejected"` with `reviserHistory.rejectionReason`
populated from the validation attempt.

**Ordering caveat** (per Codex review 2026-04-19): if path (C) ships before
the `plan-assist` gate scaffolding, its reviser-rejected fallback stays as
the current blind-bail behavior (i.e., `bail = true; continue` → blind
outer restart). Explicit TODO in `drafting.ts` to rewire to the gate once
A/B land. This preserves the "fail as current system does" contract for
the intermediate shipping state instead of requiring gate infra on day 1.

## Shared infrastructure

1. **New SSE event** `gate:plan-assist` — emitted from the orchestrator side
   when the gate opens. Payload matches `PlanAssistGatePayload`.
2. **New gate type in `src/gates.ts`** — extends the existing gate
   mechanism (CLI readline / web POST / throw-on-auto).
3. **UI panel** — Studio adds a `PlanAssistPanel` when the current gate is
   `gate:plan-assist`. Shows unresolved deviations, last-attempt prose, and
   the three decision buttons. Outline editor is a JSON textarea for now;
   full visual editor is future work.
4. **Extend `presentForApproval`** or add `presentForExhaustion` — same
   plumbing as current approval gate but with the auto-mode-throws semantics
   from §"Auto-mode behavior."
5. **Extend `revisionUsed` semantics** — document that it caps the TOTAL
   reviser calls per chapter across plan-check + validation paths.

## Implementation order (for next session)

1. **Path (C) with scoped no-gate fallback** — `buildContextForValidation` +
   validation-driven reviser escalation. Reviser-accepted → outer restart with
   revised plan (existing pattern). Reviser-rejected OR reviser-threw → blind
   bail (current behavior), with `TODO(exhaustion-gate)` comment marking the
   rewire point. No new gate, no UI, no new telemetry table; ~40 lines of
   additions in drafting.ts mirroring the plan-check escalation pattern.
2. `plan-assist` gate scaffolding — new gate type, SSE event, throw-on-auto
   behavior. No UI yet; CLI mode prompts work end-to-end.
3. Wire paths (A) + (B) to the gate, and rewire path (C)'s reviser-rejected
   fallback from step 1's blind-bail to the gate.
4. UI — `PlanAssistPanel` in Studio.
5. `chapter_exhaustions` telemetry table + query surface.

Steps 1-3 unblock the "exhaustion never silently restarts" invariant. Steps
4-5 polish the observability surface. Codex review 2026-04-19 validated
this ordering (step 1 cannot fully realize its spec without step 2, so step
1 explicitly scopes to the no-fallback case as a shipping-checkpoint state).

### Step 3 caveat (flagged by Codex review a0e0567af62b0fb9a)

Step 2 adds the backend surface (`pendingPlanAssist` on /list + /:id/state,
`POST /api/novel/:id/plan-assist/:chapter/decide`), but Studio does not
render or decide on plan-assist gates yet. When step 3 wires the gate into
`drafting.ts`, the web-mode flow will silently stall unless either:
(a) step 3 also ships a minimal `decidePlanAssist()` API client + a
`PlanAssistPanel` stub (or extends `GatePanel` with a plan-assist branch),
or (b) step 3 is explicitly scoped to CLI-mode-only until step 4 lands the
full UI panel. Option (a) is preferred — keeps web users from getting into
a dead gate state.

## Open questions

1. **How many times can "override and draft" fire per chapter?** Currently
   `revisionUsed` guards reviser calls; override isn't a reviser call, so it's
   unbounded. Suggest a separate `planCheckOverrides: number` counter capped at
   1 per chapter — otherwise a user could loop forever.
2. **Should path (C) reviser-rejected also surface `reviserHistory`?**
   I think yes — helpful for the user to see what the validation reviser
   tried. But payload inflation. Lean: yes, include.
3. **Does `maxPhaseRestarts` (currently 2) need updating?** Plan-assist gates
   may sit waiting for user input for hours; the pipeline's outer restart cap
   shouldn't trip on an idle gate. Likely no change needed — gates block the
   pipeline cleanly without consuming an attempt — but verify when
   implementing.
