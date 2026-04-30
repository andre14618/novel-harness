---
status: active
date: 2026-04-30
experiment: 271
supersedes: docs/checker-framework-audit-2026-04-30.md#suggested-build-order
owner: checker-framework-rebuild
---

# Checker Framework Implementation Spec

## North Star

Prose quality waits until the end. The checker framework's job is not to score
style, voice, beauty, or sentence craft. Its job is to prevent broken story
state from being approved.

Runtime checks should be:

- deterministic when possible
- bounded when an LLM is needed
- cheap: DeepSeek V4 Flash non-thinking for runtime checks
- evidence-surface-aware: a checker can only judge against evidence it sees
- oracle-calibrated before it becomes blocking
- source-scoped in policy: a blocker cannot reach approval unless explicitly
  overridden for that checker/source

## Non-Goals

- No broad prose-quality judge.
- No 1-10 scoring.
- No style/lint findings as story-quality blockers.
- No new SFT/fine-tune work.
- No runtime DeepSeek thinking mode for routine checks.
- No blocker-class LLM checker without a labeled sample and quoted oracle
  calibration.

## Contract

Every checker emits the same normalized finding shape.

```ts
type Severity = "blocker" | "warning" | "diagnostic"
type RuntimeAction = "retry" | "revise-plan" | "plan-assist" | "approval-display" | "log-only" | "pause"

interface CheckerFinding {
  source: "integrity" | "beat" | "chapter" | "continuity" | "validation" | "checker-runtime" | "plan-diff"
  checker: string
  severity: Severity
  action: RuntimeAction
  chapter: number
  beatIndex?: number | null
  description: string
  evidenceQuote?: string
  expectedEvidence?: string
  evidenceSurfaceId?: string
  repairKind?: "rewrite-beat" | "revise-plan" | "human-plan-assist" | "regenerate-chapter" | "none"
}
```

Policy rule:

- `blocker` means impossible to reach generic approval.
- `warning` means visible and auto-approvable.
- `diagnostic` means telemetry only.
- checker runtime failures are not story findings; classify them separately.
- overrides are source-scoped and must be visible in approval content.

## Layer 1 — Deterministic Integrity

Purpose: block mechanical corruption and impossible control-flow states.

Initial blocking checks:

- fused punctuation/word boundaries: `blade.She`
- dropped-space camel fusions: `againShe`
- malformed fragments: `.ind her`
- exact adjacent duplicate sentence
- nearby duplicate fragment after calibration
- quote integrity after calibration
- approval with unresolved normalized blocker
- approval under override without visible blocker/override scope

Initial warning/diagnostic checks:

- word-count overshoot
- below-target word count unless catastrophically short/empty
- rhythm/style lint
- dialogue ratio

Accuracy gate before broad blocking:

- 30 clean chapter/excerpt negatives
- 30 corrupted positives seeded from exp #265, exp #268, and synthetic variants
- known-corruption recall must be 100%
- clean false positives must be <= 2/30 before blocker use
- every deterministic fixer replacement needs a before/after fixture

Implementation notes:

- Keep this independent of prose-quality lint.
- The deterministic fixer is a mutator, not a checker. It must remain guarded by
  post-fix integrity and audited replacement fixtures.

## Layer 2 — Local Beat Checks

Purpose: verify the generated beat did the local job.

Runtime model for LLM tasks:

- DeepSeek V4 Flash
- non-thinking
- temperature 0.0-0.2
- small output cap, usually 512-1024 tokens
- strict JSON schema
- no free-form quality scoring

### Beat Event Enactment

Question: did the prose enact the beat's required event(s), or invert/omit them?

Inputs:

- one beat spec
- generated beat prose
- prior beat prose only if needed for transition interpretation

Output:

- missing/inverted required event findings
- evidence quote from prose
- expected beat phrase
- blocker only when the beat's required action is absent or inverted

Out of scope:

- prose quality
- pacing
- whether the prose is beautiful
- whether every detail in the beat appears literally

### Entity Grounding

Question: did the prose introduce a named entity, unique text, institution,
place, date, or lore term that was not available to the writer or introduced
on-page with a role/reason?

Inputs:

- generated beat prose
- typed writer-visible evidence surface
- current beat brief entities
- resolved-reference entities
- setting entities
- character aliases
- prior-beat/transition entities
- planned payoff/fact entities

Output:

- ungrounded named entity findings only
- evidence quote
- allowed-sources seen

Out of scope:

- ordinary unnamed atmospheric detail
- generic nouns
- stylistic vocabulary

This checker must use the same evidence surface as the writer. If the writer saw
something that the checker did not, the checker is under-scoped, not strict.

### Retired Corpus-Leak Profile

Route-specific corpus-leak checking is retired with the Salvatore writer-LoRA
route. It should not re-enter runtime unless a future writer is again trained on
a known copyrighted/named-entity corpus and the leak profile is explicitly part
of that route's risk model.

### Functional Story-State Checks

Question: can the planned state be safely persisted from the approved prose?

Initial deterministic checks:

- payoff links must reference an existing `establishedFact.id`
- payoff links must point at a valid beat index
- payoff links must point to a later beat than the setup beat
- established fact IDs referenced by payoff links must not be duplicated

Initial bounded LLM warning checks until oracle-calibrated:

- planned facts missing from chapter prose
- knowledge changes missing from chapter prose
- character-state changes missing from chapter prose
- planned state contradicted by chapter prose

Runtime model:

- `functional-state-checker`
- DeepSeek V4 Flash non-thinking
- strict JSON
- at most 10 findings
- exact prose quote required for contradiction findings

Runtime gating:

- deterministic payoff graph failures are blockers
- semantic planned-state grounding findings are approval-visible warnings until precision is known

## Layer 3 — Chapter Coherence Checks

Purpose: catch stitched-beat failures that local checks miss.

Runtime model for LLM tasks:

- DeepSeek V4 Flash
- non-thinking
- parallel bounded tasks
- quote-required evidence
- 1024-2048 token output cap per task
- no broad prose-quality rubric

Candidate bounded checks:

### Location Continuity

Question: are characters physically present where the chapter/prose says they
are, with explicit transitions where needed?

Inputs:

- beat settings
- character states entering chapter
- prose snippets by beat

Blocker examples:

- Wren is established as sent home, then appears in Istra's apothecary without
  transition
- same scene is described as both apothecary and tower floor

### Planned State Establishment

Question: did planned facts, knowledge changes, and character-state changes
actually land on-page before being persisted as state?

Inputs:

- planned `establishedFacts`
- planned `knowledgeChanges`
- planned `characterStateChanges`
- prose snippets by beat

Blocker examples:

- planner saves a fact the prose never establishes
- a character is marked as knowing something the prose never reveals to them

### Local Fact Consistency

Question: does the chapter contradict itself on important factual details?

Inputs:

- prose snippets by beat
- optional extracted local fact candidates

Blocker examples:

- Harold's fever breaks now and also broke two days ago
- Wren is actively feverish while the prose says the fever broke three nights
  earlier in a way that changes the medical logic

### Repeated Reveal / Narrative Duplicate

Question: does the chapter rediscover the same major fact/reveal multiple times
as if new?

Inputs:

- prose snippets by beat
- planned reveal/payoff list

Blocker examples:

- the chapter repeatedly “realizes” the same named city/lore revelation with no
  new information

### Impossible Knowledge

Question: does a character act on or state knowledge they should not have?

Inputs:

- character knowledge state entering chapter
- planned knowledge changes
- prose snippets by beat

Blocker examples:

- Aldric or Wren knows hidden cure/plague mechanics before the prose reveals
  them

## Oracle Calibration

Runtime checks do not become blockers until oracled.

Oracle options:

- Sonnet/Codex reviewer subagents for small calibration panels
- DeepSeek V4 Pro thinking for repeatable automated judge panels
- human spot checks for ambiguous borderline categories

Oracle requirements:

- quote-required evidence
- judge against the checker-visible evidence surface, not against everything the
  writer may have seen unless the checker also sees it
- classify `blocker | warning | no issue`
- record false-positive and false-negative class
- preserve transcripts/artifacts in docs or DB-linked output

Minimum gates:

- blocker precision >= 0.85 on natural fires before blocking live
- no known false negatives on mandatory regression fixtures
- at least 20 positive examples for each blocker subclass before claiming that
  subclass is calibrated
- if positives are rare, targeted oversampling beats random sampling

## Eval Sample Plan

### Rung 0 — Deterministic Fixture Belt

- 30 clean negatives
- 30 corrupted positives
- mandatory exp #265 and exp #268 fixtures
- run locally in `bun test`

### Rung 1 — Checker Unit Panels

- 120-160 examples per high-impact checker
- balanced by subclass
- labels judged against each checker evidence surface
- metrics: precision, recall, F1, fire rate, FP/FN class

### Rung 2 — Production Natural Panel

- 5-10 novels or 200-300 beat attempts
- include fantasy and non-fantasy base-DeepSeek routes
- sample fires and passes
- metrics: solo-fire precision, co-fire matrix, retry clearance, accepted blocker
  count, blocker escape count, cost, latency

### Rung 3 — Chapter Oracle Panel

- 40 chapters total
- 20 expected-clean
- 20 known-problematic
- quote-required chapter coherence oracle

### Rung 4 — Policy Integration Tests

- unresolved beat blocker cannot approve
- continuity blocker cannot approve
- prose-integrity blocker cannot approve
- override is source-scoped
- validation blockers under override are visible
- trace/payload records policy action

## Implementation Slices

### Slice A — Policy Contract

Implement normalized `CheckerFinding` and source-scoped override semantics.

Acceptance:

- blocker cannot reach approval in auto mode
- `planCheckOverridden` only affects plan-check unless explicitly widened
- validation blockers are displayed even under override
- plan-assist payload includes blocker source

### Slice B — Deterministic Fixture Belt

Create deterministic checker fixtures and audit existing deterministic mutators.

Acceptance:

- fixture suite covers clean/corrupt cases
- exp #265/#268 fixtures fail without the guard and pass with the guard
- deterministic fixer risky substitutions are removed or fixture-protected

### Slice C — Evidence Surface Unification

Create a shared typed writer-visible evidence surface for beat writer and entity
grounding.

Acceptance:

- hallucination checker labels are judged against the same surface it receives
- base DeepSeek rich context no longer creates avoidable grounding false
  positives

### Slice D — Bounded V4 Flash Checkers

Replace or wrap old LLM checks with narrow V4 Flash non-thinking task surfaces.

Acceptance:

- each checker has one question, one schema, one evidence surface
- parallel fan-out is used only for independent dimensions
- no broad prose-quality task appears in runtime

### Slice E — Oracle Calibration Harness

Build the panel runner and artifact shape for oracle calibration.

Acceptance:

- checker outputs can be sampled with their evidence surfaces
- oracle labels are quote-required
- metrics persist and link to experiments

## Next Concrete Step

Next step: run a base-writer validation with the retired LoRA path removed and
the first functional checks enabled, then sample functional-state warnings before
promoting any semantic grounding finding to blocker status.
