---
status: active
date: 2026-05-06
decision: continuity-diagnostic-drafting-gates
---

# L84 Continuity Findings Are Diagnostic For Drafting Gates

## Decision

Continuity checker findings remain visible diagnostics and review evidence, but
they do not create Drafting Plan-Assist blockers by themselves.

`buildCheckerBlockerDeviations()` continues to promote accepted beat-check
blockers and functional blockers into Plan-Assist deviations. It no longer
promotes `continuityIssues[]`, even when a continuity checker labels an issue
`blocker`.

## Why

Continuity findings are useful for operator review, but they are not yet a
stable enough automatic stop signal for drafting. Recent evidence showed a mix
of real catches, gray-zone support echoes, and state warnings that can reflect
reasonable off-page or planned movement. Blocking Drafting on that class turns
checker calibration uncertainty into full run interruption.

The safer product shape is:

- keep the finding in telemetry, diagnostics, and future editorial/proposal
  surfaces;
- keep semantic Beat/plan blockers load-bearing where they are tied to the
  active Beat or plan contract;
- defer automatic continuity rewrites or blocking until a narrower class has
  replay/A-B evidence.

## Evidence

- L81 continuity gray-zone panel showed continuity-facts is mixed but not
  uniformly reliable enough to treat every flagged blocker as a drafting stop.
- L83 continuity-state warning follow-up showed raw state warnings are
  diagnostic/UI noise, not production stop evidence.
- Fresh action evidence for historical candidates surfaced continuity
  support-echo samples inside pending gates, including findings whose reasoning
  said the prose was consistent with the fact.

## Implications

- Continuity checker rows still appear in `diagnostics:checker-warnings`,
  `diagnostics:semantic-gate`, action evidence, and stored LLM call history.
- A real continuity problem should become an operator-visible editorial flag or
  proposal-backed edit, not an automatic drafting gate, until a narrower
  blocker subclass earns promotion evidence.
- This does not relax halluc-ungrounded, Plan Adherence, prose-integrity,
  validation, or functional-state blockers.
- Future work should add proposal/UI surfacing for high-confidence continuity
  findings instead of silently discarding them.

## Related

- Supersedes the runtime-gating implication in
  `docs/decisions/L083-continuity-state-warning-panel-2026-05-06.md`.
- Parent diagnostics: `docs/sessions/2026-05-06-semantic-gate-diagnostics.md`.
