---
status: active
date: 2026-04-30
experiment: 270
source_experiments: [268, 269]
commit_context: 275e0314d4b5
owner: checker-framework-rebuild
---

# Checker Framework Audit — Blank-Slate Rebuild

## Executive Verdict

The current checker stack should be treated as an evolved patchwork, not as a
validated framework. The recent base-DeepSeek route work changed the writer's
context shape, prose length profile, checker models, and approval policy enough
that old checker assumptions are no longer safe by default.

Do not add a broad prose-quality judge yet. The right rebuild sequence is:

1. Define the checker contract and severity/action policy.
2. Audit deterministic checks against clean and corrupted samples.
3. Rebuild LLM checks as bounded, parallel, evidence-surface-aware tasks.
4. Validate each checker on a labeled sample before making it blocking.
5. Only then add a chapter-level oracle for stitched-beat coherence gaps that
   deterministic and narrow checkers cannot cover.

Word-count overshoot remains warning-class. The production blockers are story
logic, state/knowledge coherence, hallucinated/ungrounded entities, malformed
prose, and unresolved checker findings reaching approval.

## Current Surfaces

| Surface | Type | Current Job | Runtime Action | Audit Verdict |
|---|---|---|---|---|
| `validateChapterDraft` | deterministic | underlength, POV presence, optional validation-mode keyword/dialogue/POV checks | drafting blockers can rewrite; validation phase diagnostic-only | keep only catastrophic underlength + POV presence as blocking; keyword coverage is not an oracle |
| `detectProseIntegrityIssues` | deterministic | fused boundaries, camel fusions, duplicate sentences/fragments, quote integrity | retries chapter before approval | keep, but calibrate quote/fragment false positives |
| `lintProse` regex/emotional/rhythm | deterministic style diagnostics | AI-cliche/style/rhythm issue finding | fixes or displays; not blocker | keep outside core validation framework |
| deterministic lint fixer | deterministic mutator | simple substitutions/removals | can overwrite draft if integrity passes | audit every replacement; some are meaning-changing |
| `detectSyncDefects` | deterministic optional quality-redraft | repetition loops and underlength beats | only if quality-redraft enabled; otherwise inert | reclassify as experimental, not framework core |
| `adherence-events` | LLM + deterministic presence | beat event enactment and character presence | beat rewrite; unresolved blockers now halt approval | keep concept, recalibrate on new route |
| `halluc-ungrounded` | LLM | named entity/world grounding against checker-visible surface | beat rewrite; unresolved blockers now halt approval | keep concept, rebuild evidence surface |
| `halluc-leak-salvatore` | LLM + regex | Salvatore-corpus vocabulary leaks | Salvatore `leakProfile` only | keep for fallback route only; needs user-intent exceptions |
| `chapter-plan-checker` | LLM | cross-beat setting, emotional direction, major contradiction | targeted rewrites, reviser, plan-assist | keep but split or extend axes; currently ignores fact/state establishment |
| `continuity-*` | LLM | prior fact/state contradictions | now blocking if severity `blocker` | do not trust as blocking until revalidated on current route |
| `checker-blockers` | policy | promote unresolved beat/continuity blockers | plan-assist gate | right idea; contract is incomplete |

## What Is Oracled Today

| Surface | Existing Evidence | What It Proves | What It Does Not Prove |
|---|---|---|---|
| lint-fix integrity | exp #265 fixtures and unit tests | catches known corruption like `blade.She`, `againShe`, `.ind her` | false-positive rate on clean chapters |
| final prose integrity | exp #268 fixtures and unit tests | catches known duplicate/quote corruption | whether repeated motifs/dialogue are safely distinguished from seams |
| route decoupling | exp #268 SQL + logs | base DeepSeek can run `compact=false`, `leak=none` | writer quality after checker rebuild |
| adherence-events | old SFT evidence in model-role comments | worked on prior labeled beat cases | accuracy on rich-context base-DeepSeek route |
| halluc-ungrounded | production report + beat-entity-list improvement | context-surface mismatch was real and partially fixable | current precision/recall under new writer context |
| halluc-leak-salvatore | regex OR-combine report | regex catches many Salvatore token misses | user-intended fantasy vocabulary handling |
| continuity | old W&B adapter evidence | adapter can perform narrow fact/state checks on prior distribution | current blocking precision/recall or repair usefulness |
| chapter-plan-checker | anecdotal DeepSeek V4 route plus prior SFT false-positive audit | SFT was not reliable; base model is plausible | calibrated axis-level accuracy today |

Conclusion: current evidence is enough for regression protection on known
failures, not enough to claim the checker framework is accurate.

## High-Risk Findings

### H1 — Evidence-Surface Mismatch Remains The Core LLM Checker Risk

`halluc-ungrounded` does not see the exact same evidence surface the base
writer sees. The writer can see beat brief, transition bridge, landing target,
character snapshots, prior beat prose, resolved references, setting details,
payoff/fact links, and route-specific context. The checker currently sees a
narrower constructed surface plus derived beat entities.

This is the same failure class that caused the earlier ungrounded overfire
problem: the checker can be correct relative to its own prompt while wrong
relative to what the writer was legitimately allowed to use.

Rebuild rule: every LLM checker must declare its evidence surface, and oracle
labels must judge against that same surface.

### H2 — `blocker` Still Does Not Have One System-Wide Meaning

The exp #269 policy work stopped several blocker leaks, but the contract is
still incomplete:

- validation phase is diagnostic-only but still records `severity: "blocker"`
- checker runtime failures have inconsistent policy across plan-check and
  continuity
- plan-assist gate kind conflates plan-check exhaustion with accepted beat or
  continuity blockers
- `planCheckOverridden` can suppress checker blockers beyond plan-check scope
- overridden validation blockers are not clearly displayed as blockers

Rebuild rule: `blocker` means “cannot reach generic approval unless explicitly
overridden for that source.” If a finding is allowed through automatically, it
is not a blocker; call it `warning` or `diagnostic`.

### H3 — Chapter-Plan Checker Sees State Commitments But Does Not Check Them

The chapter-plan checker context includes planned facts, character states, and
knowledge changes, but the live rubric is setting coherence, emotional arc, and
major plot contradiction. It does not directly ask whether the planned facts or
knowledge changes actually landed on-page.

This makes plan-only state persistence risky: the planner can declare state,
the writer can fail to dramatize it, the checker can pass, and `savePlannedState`
then persists the planned state as truth.

Rebuild rule: state/fact/knowledge establishment must be either planner-
validated before writing or chapter-checked after writing. Do not persist
planner-declared state as established if no check confirms it landed.

### H4 — Continuity Is Now Blocking Without Current Calibration

Continuity blockers now halt approval, which is directionally right if the
checker is accurate. But the continuity adapter is old, trained on a small
distribution, and not aligned with the new plan-only / rich-context base writer
route. It also emits chapter-level issues without beat attribution, so repair
routes are weaker than for beat checks.

Rebuild rule: continuity should remain shadow/diagnostic or guarded by human
plan-assist until current-route precision is measured. Promote only calibrated
subclasses to hard blockers.

### H5 — Deterministic Checks Are Not All Equally Safe

Mechanical corruption checks are high-value. Style/rhythm/keyword checks are
not evidence of story correctness. Some deterministic fixes are mutators that
can change meaning and are only guarded against obvious corruption.

Examples to audit before trusting them:

- quote-integrity heuristic may false-positive valid narration-plus-dialogue
- duplicate-fragment heuristic may false-positive intentional refrains
- keyword coverage is not event enactment
- deterministic fixer substitutions may alter meaning

Rebuild rule: deterministic checks need positive and negative fixtures before
they become blocking, even if they look obvious.

## Blank-Slate Framework

### 1. Integrity Layer

Purpose: block mechanically malformed output.

Candidate blocking checks:

- fused punctuation/word boundaries
- dropped-space camel fusions
- exact adjacent duplicate sentences
- nearby duplicate fragments after calibration
- malformed/unbalanced quotes after calibration
- schema/serialization corruption

This layer should be deterministic, high precision, and cheap. It should run
after lint-fixes and before approval.

### 2. Local Beat Layer

Purpose: verify the generated beat did the local job.

Bounded parallel tasks:

- required cast / POV presence
- planned beat event enactment
- named-entity grounding against writer-visible evidence
- route-specific leak profile

Each issue must include source, severity, beat index, evidence quote, and repair
kind. Free-text-only issue lists are not enough for policy and metrics.

### 3. Chapter Coherence Layer

Purpose: catch stitched-beat failures that local beat checks miss.

Bounded parallel tasks:

- scene/location continuity
- repeated reveal / duplicate narrative discovery
- major fact contradiction
- character knowledge / impossible knowledge
- planned fact/state/knowledge establishment
- closing emotional direction if the plan explicitly requires it

This is where a quote-required LLM oracle belongs, but only after deterministic
guards and local beat contracts are validated.

### 4. Policy Layer

Purpose: make severity/action deterministic.

Proposed normalized finding:

```ts
type Severity = "blocker" | "warning" | "diagnostic"
type Action = "retry" | "revise-plan" | "plan-assist" | "approval-display" | "log-only" | "pause"

interface PolicyFinding {
  source: "integrity" | "beat" | "chapter" | "continuity" | "validation" | "checker-runtime" | "plan-diff"
  checker: string
  severity: Severity
  action: Action
  chapter: number
  beatIndex?: number | null
  description: string
  evidence?: string
  evidenceSurface?: string[]
  overrideScope?: "none" | "this-source" | "all-story-blockers"
}
```

Policy rules:

- `blocker` never reaches generic approval unless explicitly overridden for
  that source.
- `warning` is visible and auto-approvable.
- `diagnostic` is telemetry only.
- checker runtime failures are separate from story findings.
- overrides are source-scoped and visible in approval content.
- validation phase must stop using `blocker` for non-blocking diagnostics, or
  it must become blocking.

## Do We Need The Full Current Checker Set?

Not as-is.

Keep immediately:

- integrity layer
- local beat event/adherence concept
- named-entity grounding concept
- per-writer leak profile for Salvatore fallback
- chapter-plan checker/reviser pattern, but narrow the axes

Demote or rebuild before trusting as blocking:

- continuity adapter
- validation-mode keyword coverage
- rhythm/style lint as quality evidence
- quote/duplicate fragment blockers until calibrated on clean prose

Remove from core framework:

- broad prose score judges
- word-count overshoot as quality blocker
- style lint as story-quality evidence
- unimplemented stubs that return clean

## Eval And Oracle Plan

### Rung 0 — Deterministic Fixture Belt

Goal: protect mechanical guardrails.

Initial sample:

- 30 clean approved chapters or chapter excerpts
- 30 synthetic corruptions seeded from real failures
- mandatory fixtures: exp #265 (`blade.She`, `againShe`, `.ind her`) and exp
  #268 duplicate fragment / malformed quote

Pass gates:

- exact/fused/camel corruption recall = 100% on fixture positives
- false-positive rate <= 2/30 on clean negatives before blocking live
- every deterministic fixer replacement has a before/after fixture

### Rung 1 — Checker Unit Panels

Goal: measure individual checker accuracy against its declared evidence surface.

Initial sample:

- 120-160 examples per high-impact checker
- balanced by failure class, not just random production prevalence
- at least 20 positive cases per blocker subclass

Metrics:

- precision / recall / F1 per subclass
- fire rate
- false-positive class
- false-negative class
- evidence-surface mismatch rate

### Rung 2 — Natural Production Panel

Goal: check real current-route behavior.

Initial sample:

- 5-10 novels or 200-300 beat attempts
- include both base DeepSeek route and Salvatore fallback route
- sample both checker fires and checker passes

Metrics:

- solo-fire precision
- co-fire matrix
- retry clearance
- accepted-blocker count
- blocker escape count
- cost and latency per chapter

### Rung 3 — Quote-Required Chapter Oracle

Goal: catch stitched-beat coherence failures.

Initial sample:

- 40 chapters total
- 20 expected-clean chapters
- 20 known/problematic chapters from exp #265, exp #268, and similar runs

Oracle rubric:

- scene/location continuity
- repeated reveal / duplicate narrative discovery
- local fact consistency
- character knowledge / impossible knowledge
- planned fact/state/knowledge establishment
- malformed-prose escaped deterministic guard

Every oracle issue must include quoted evidence and classify `blocker | warning`.

### Rung 4 — Policy Integration Tests

Goal: verify no blocker can be approved accidentally.

Required tests:

- accepted beat-check blocker after max retries opens plan-assist in auto mode
- continuity blocker opens plan-assist in auto mode
- prose-integrity blocker retries chapter and never calls approval
- `planCheckOverridden` does not suppress unrelated checker blockers
- validation-phase diagnostic blockers are either renamed or explicitly tested
  as non-blocking diagnostics
- trace payloads include enough policy metadata to audit blocker handling

## Immediate P0 Follow-Ups

1. Fix override scope: `planCheckOverridden` must not suppress continuity or
   accepted beat-check blockers unless a new explicit all-checker override is
   recorded.
2. Display validation blockers even when the plan-check override is active.
3. Add source-aware gate kinds or payload fields so plan-assist can distinguish
   plan-check exhaustion from checker-blocker exhaustion.
4. Audit deterministic fixer replacements before treating fixed prose as safe
   beyond corruption checks.
5. Build the Rung 0 deterministic fixture belt before another writer-route
   validation run.

## Suggested Build Order

1. Policy contract and P0 override fixes.
2. Deterministic fixture belt.
3. Evidence-surface unification for writer context and `halluc-ungrounded`.
4. Chapter-check axis split: location, fact/state establishment, contradiction.
5. 40-chapter oracle panel.
6. Production shadow run before expanding blocker policy.

This sequence rebuilds the framework without assuming that any existing checker
is accurate merely because it is already wired into runtime.
