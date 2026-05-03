---
status: complete
updated: 2026-05-03
role: retrospective
session: 2026-05-03-integrity-ladder-finalization
---

# 2026-05-03 Retrospective — Integrity Ladder Finalization

## Shape of the session

5 commits, 4 experiments (#399–402), $0.50 total LXC spend. Four lanes touched in one continuous loop:

- **L70 form (b)** — prompt escalation; **REVERTED** stop gate (b).
- **L70b form (a)** — per-beat targeted rewrite; **SHIPPED** (`81f372a`).
- **L71** — `chapter-plan-reviser` maxTokens cap; **SHIPPED defensive** (`f6b4aa4`).
- **L72** — duplicate-sentence punctuation false positive; **SHIPPED unit-only** (`11facbd`).
- **exp #402 stack validation** — confirmed lanes compose; ch1 approval 1/3 → 3/3 (`81d31c1`).

## Supersession chain

L70 → L70b is the headline of the session. The reverted prompt-edit attempt directly suggested its replacement: instead of changing what the writer is asked to do (prompt-edit, broad blast radius via cross-surface coupling), change *which beats retry* (routing, narrow blast radius). The two lanes share a target metric but live in different parts of the architecture, and the pivot is mechanically the cleanest example of the "force continued looping" rule paying off this session.

## Lessons captured (`docs/lessons-learned.md`)

1. **Cross-surface coupling on prompt-only changes** — even narrow integrity-prompt edits can shift writer behavior on retries enough to fire detectors on other surfaces. (L70 entry, exp #398.)
2. **Routing-lane stop gates need causal-attribution wording** — "any baseline-approved novel regresses to a bail" inherited from L70 form (b) was the right test there but became false-positive-prone for L70b where the regressed novel's bail was on a code path the lane never executed. The right wording for routing-only lanes is "any novel regresses *where the lane code executed*." (L70b entry, exp #399.)

## What today validates about the methodology

- **The settle-loop helper paid off.** `runSettleLoop` was originally factored out of the chapter-plan-checker rewrite path (D3, 2026-04-28). Reusing it for L70b's integrity-targeted rewrite took ~150 lines of routing + offset metadata instead of rebuilding the control flow. When a lever needs the same shape as an existing one, helper reuse beats inlining.
- **Reading the stored `pairNorm` field caught L72.** The duplicate-sentence false positive was diagnosed by reading the actual normalized form on a `pipeline_events` row (`"no no"` from `"No."` + `"No?"`). Without that stored field the false positive would have been much harder to spot. **Implication:** detector-level metadata that records the *reason* a check fired (not just that it fired) earns its keep on diagnosis.
- **3-novel single-arm A/B has high variance** — L70 lessons #2 already flagged this; L70b's heretic regression and L70b+L71+L72 stack's arch regression both reinforce it. Future small-effect-size lanes should run paired-replay (≥3 runs per arm per seed) when a single-novel regression could fire stop gate (b).

## What today reveals about the roadmap

The 3-novel validation panel's dominant blocker has shifted off the integrity surface (L40–L72 ladder is now at diminishing returns) onto **ch2 `plan-check-exhausted` on continuity + halluc-ungrounded**. Both `fantasy-archive` and `fantasy-system-heretic` hit this independently in exp #402, suggesting it's systematic on these long-tail seeds rather than seed-specific noise.

Open architectural question raised at end-of-session: continue the tagged-context-with-checkers approach, or pivot toward dynamic-state-with-large-context? The continuity surface is exactly where the dynamic-state approach has its strongest theoretical advantage — facts are inherently temporal and grow as the novel grows. Worth a serious reality check before opening L73 with a charter.

## What's parked

- L73 / Continuity candidate — provisional, awaits user direction.
- Architecture reality check on tagged-context vs dynamic-state — discussed end-of-session; no commitment to either direction yet.
- Heretic plan-assist token-cap fix (L71) is shipped but unvalidated against an actual cap-hit case. Future evidence will tell whether 12288 is sufficient.

## Cost summary

| experiment | spend |
|---|---|
| #399 L70b A/B (3 novels × 2 ch) | $0.166 |
| #400 L71 heretic retry (1 novel × 2 ch) | $0.051 |
| #401 L72 unit-only (no LXC) | $0 |
| #402 stack validation (3 novels × 2 ch) | $0.190 |
| **total** | **~$0.41** |

Budget cap held comfortably; lanes were cheap because each was scoped to a single concern with bounded sample shape.
