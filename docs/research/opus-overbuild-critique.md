---
job: 5
title: Over-Scaffolding Critique and Run/Thread/ID Lineage Audit
date: 2026-05-10
model: opus
status: draft (decision artifact, not promotion-ready)
---

# Over-Scaffolding Critique and Run/Thread/ID Lineage Audit

This is the contrarian artifact in the Job 1–5 set. The other four propose
adding things — scene contracts, semantic judges, seven new method packs,
twelve template recommendations. This one names what the harness has already
built that probably should not be there, and what should not be built next.

If the user reads only one section, read §3: most of what jobs 1–4 want to
ship is downstream of unfinished work, mis-attributable inside the current
proposal model, or already retired by a memorized constraint. The harness's
problem in May 2026 is not "we don't have enough structures"; it is
"the scaffolds we have are not load-bearing, and we keep adding more."

---

## Section 1 — Already-Built That's Probably Worth Less Than Its Cost

Fifteen surfaces, ranked roughly by how much complexity budget they consume
vs how often they change a runtime decision.

### O1: Phase 7 ApprovalPolicy / Replay / Promotion-Guard substrate

- **What it does**: Persists proposals (`artifact_patch`, `prose_edit`,
  `editorial_flag`, `canon_update`, `planning_edit`) as durable envelopes,
  replays them against historical fixtures, and gates "promotion" of a
  policy change behind dev/assisted/autonomous tiers (`minRows`,
  `minAutoPrecision`).
- **Where it lives**: `src/canon/approval-policy.ts` (222 lines),
  `src/canon/approval-policy-replay.ts` (501), `src/canon/editorial-proposal.ts`
  (388), `src/canon/planning-edit-proposal.ts` (732), `src/canon/proposal-envelope.ts`
  (293), `src/db/approval-policy-replay.ts`, `src/db/proposal-resolution-outcomes.ts`,
  `src/db/proposal-envelopes.ts`, `scripts/approval-policy-promotion-guard.ts`,
  `scripts/approval-policy-replay-report.ts`, plus 4 orchestrator route files
  and 5 SQL migrations (`sql/042` through `sql/044`). ~3,036 non-test lines
  on the core path; multiples of that with tests + UI.
- **Approximate cost carried**: largest single subsystem in `src/canon`. Two
  default-off pipeline flags (`lintProseEditProposals=false`,
  `editorialBeatCoverageProposals=false`, `continuityEditorialFlagProposals=false`)
  exist precisely to suppress this path. CLAUDE.md adds an "Accepted autonomy
  posture" caveat that *manual review remains default*. Three promotion tiers
  are defined; only `dev` is exercised. External CI for the promotion guard is
  "on hold indefinitely" per the lane-queue. The replay harness is "no longer
  the active implementation lane" per `docs/current-state.md` line 230.
- **Evidence it's not paying back**: `current-state.md` lines 47–53: "Runtime
  default remains manual review. Assisted autonomy is limited to deterministic
  mechanical prose edits. Autonomous approval is limited to scheduler/eval
  lanes for low-risk artifact/prose proposals." Lines 226–230 confirm
  artifact/Canon checker observation sources are *backlog* — i.e. the
  attribution layer this whole substrate exists to enable does not have
  observed inputs yet. The 2026-05-10 evidence run produced zero applied
  proposals. The autopsy's open question #3 (`opus-harness-autopsy.md` §6) is
  exactly this: "are these prose chapters going through the proposal layer
  at all, or is the proposal layer parallel work that hasn't yet integrated
  into the drafting feedback loop?"
- **What I'd remove or downgrade**: do not remove. Stop building. Archive
  L074–L078 to "stable-frozen" status, freeze all default-off proposal
  hooks, and decline new proposal-shape work until a runtime path actually
  produces or consumes a proposal in normal drafting. Do not promote any of
  the three default-off flags. Do not stand up the artifact/Canon observer
  backlog. Do not add new proposal `kind`s.
- **What this frees up**: review attention; one fewer system to argue about
  in change-packets; the implicit framing that "the next layer is more
  proposal coverage" gets removed from the operator's headspace. Concretely:
  the promotion guard's `--tier autonomous minRows=100, minAutoPrecision=0.98`
  bar requires data the system does not produce on its own; freezing the
  feature stops that bar from being a phantom blocker on planner work.
- **Risk of removing**: Phase 7 is documented as the substrate that lets
  ApprovalPolicy changes be safe. Freezing it means a future autonomy lane
  has to either thaw it or build its own gate. Acceptable; that's a future
  problem. We are explicitly not pursuing autonomy expansion (CLAUDE.md
  "Strategic Constraints" + L84/L82 hold posture).
- **Cheapest way to confirm before removing**: query
  `proposal_envelopes` and `proposal_resolution_outcomes` row counts grouped
  by `producer` and `kind` for the last 30 days. If artifact_patch and
  canon_update counts on real (non-fixture) novels are near zero, the
  apparatus exists to support paths nothing is using. (This is a 1-line
  SQL query, not an experiment.)

### O2: Five corpus-extractor "structure" agents wired into role routing

- **What it does**: `structure-promise`, `structure-mice`, `structure-mckee-gap`,
  `structure-character-arcs`, `structure-value-charge` extract structural
  annotations from existing prose. Their system prompts (see e.g.
  `src/agents/structure-promise/promise-open-system.md`) explicitly say
  "you read the chapter-by-chapter beat sequence of a published novel" —
  they are corpus-shaped, not in-progress-novel-shaped.
- **Where it lives**: `src/agents/structure-*/`, each with a `system.md`,
  `schema.ts`, `context.ts`, `index.ts`. Routing entries in
  `src/models/roles.ts` lines 183–187 (extractor configs) plus 206+
  (judge configs). `mice-system-v2-draft.md` and `value-charge-system-v2-draft.md`
  are also present — *two of these have a v2 draft on disk*.
- **Approximate cost carried**: ~5 agents × ~5 files = 25 source files;
  5 routing entries + 5 judge routing entries; 2 draft prompt rewrites
  in flight. They appear to be live runtime agents based on the role
  registry.
- **Evidence it's not paying back**: A grep shows the only files importing
  these is `scripts/corpus/extract-*.ts` (corpus pipeline). No
  `src/phases/`, `src/orchestrator/`, or `src/agents/` (other than self)
  uses them. They never run during a normal novel run. The autopsy
  R12 names this exact gap.
- **What I'd remove or downgrade**: move all five agent directories under
  a `src/agents/corpus-extractors/` subdirectory; remove their entries
  from `roles.ts` if `roles.ts` is consumed only by runtime planner/writer/
  checker paths (verify). Delete the `*-v2-draft.md` files. Stop treating
  these as active runtime agents in change-packets; they are corpus tooling.
- **What this frees up**: clarifies the runtime agent inventory from
  ~22 to ~17. Removes the "we already have a promise agent" temptation
  that makes some of `opus-craft-market-synthesis.md` R5 (PromiseRegistry
  promotion) sound cheaper than it is — the existing prompt is corpus-shaped
  and would need a planner-shaped rewrite anyway.
- **Risk of removing**: corpus extraction breaks if the moves are botched.
  Mitigation: move only, don't delete; keep the corpus pipeline contract
  unchanged.
- **Cheapest way to confirm before removing**: `bun scripts/corpus/extract-structure.ts --help`
  works post-move; existing corpus pipeline still produces the
  `output/corpus-structure-reference/crystal_shard/` artifacts.

### O3: `materialityTest` mandatory field with no consumer

- **What it does**: The state-mapper prompt
  (`src/agents/planning-state-mapper/context.ts:89`) requires the LLM to
  emit `materialityTest` on every beat obligation: "names how the exact
  source ID changes choice, cost, constraint, relationship state, outcome,
  or future pressure."
- **Where it lives**: `src/agents/planning-state-mapper/context.ts:89`,
  `src/schemas/shared.ts:100` (optional schema field).
- **Approximate cost carried**: every mapper call is paying ~30–80 output
  tokens per obligation (and 23 obligations × 2 chapters = 46 fields in the
  2026-05-10 run) for a field that no downstream code reads. At
  ~$0.04/run with 23+ obligations, this is order ~$0.005–0.010/run of pure
  prompt overhead. Per-run cost is tiny. The real cost is operator confusion:
  the field is required at extraction time and absent from every consumer's
  type checking.
- **Evidence it's not paying back**: grep across writer, all 4 checkers,
  and validation routing finds zero references to `materialityTest`. The
  field exists only in mapper context + tests of mapper context.
- **What I'd remove or downgrade**: remove the `materialityTest` requirement
  from the mapper system prompt. Keep the schema field optional (it's
  already optional). If the planner-discernment dimension that motivated
  this field is `motivationSpecificity`, route that signal through the
  diagnostic discernment harness, not as a per-obligation prompt requirement.
- **What this frees up**: smaller mapper prompts (the prompt currently has
  to enumerate the 6-axis taxonomy of materiality), faster mapper runs,
  and one less "what does this field do?" failure mode for new contributors.
- **Risk of removing**: if some future agent intends to read this field,
  it has to re-add the requirement. Acceptable; it can be re-added cheaper
  than it is being maintained.
- **Cheapest way to confirm before removing**: search downstream for any
  obligation-aware filtering that hashes or checks `materialityTest`.
  None exists at the time of this audit.

### O4: `structureSlotId` schema field with zero producers and zero consumers

- **What it does**: Optional `structureSlotId` on every beat obligation
  (`src/schemas/shared.ts:92`).
- **Where it lives**: schema only. The only references in `src/` are the
  schema definition itself and one unit test that hard-codes
  `slot-confrontation-open` (`src/harness/ids-propagation.test.ts:102`).
- **Approximate cost carried**: low — but illustrative of the over-built
  pattern. The field is part of the "method-pack" template vision (see
  `opus-method-pack-candidates.md` cross-pack conventions) but no agent
  emits it and no checker reads it.
- **Evidence it's not paying back**: see grep above. The autopsy notes the
  same gap: "Structural priors live in the prompt, not in the schema —
  they are generation-time advice with no validator." `structureSlotId`
  is the *opposite* problem: schema slot exists, prompt does not produce
  it.
- **What I'd remove or downgrade**: remove the field from the schema
  until the first method-pack experiment that actually emits it lands.
  When that experiment lands, re-introduce the field in the same commit
  that wires its emitter and its first consumer.
- **What this frees up**: one less zombie schema field; clarifies that the
  current planner does not have a structural-slot vocabulary.
- **Risk of removing**: trivial — the test using it would need updating;
  nothing else references it.
- **Cheapest way to confirm before removing**: the grep results in this
  audit are the confirmation.

### O5: `sceneTurnId` schema field — same shape as O4

- **What it does**: Optional `sceneTurnId` on beat obligations
  (`src/schemas/shared.ts:91`).
- **Where it lives**: schema only.
- **Approximate cost carried**: low; same pattern as O4.
- **Evidence it's not paying back**: zero producers, zero consumers in
  `src/agents/`, `src/phases/`, `src/harness/` (verified by grep).
- **What I'd remove or downgrade**: same as O4. Remove until first emitter
  + first consumer ship together.
- **What this frees up**: clarifies that the harness has no scene-turn
  vocabulary at runtime.
- **Risk of removing**: trivial.
- **Cheapest way to confirm**: grep done.

### O6: Two-paragraph beat hint floor that is dead under default flags

- **What it does**: `writerExpansionMode = "retry-short-scenes-v1"` is the
  L097 expansion path that retries the writer up to 3 times when the produced
  word count is below an advisory floor.
- **Where it lives**: `src/config/pipeline.ts:97`,
  `src/phases/drafting.ts` resolveWriterExpansionMode + retry loop, plus
  L097 retrospective. Flag is default-off; activates only under
  `sceneCallWriterV1=true`.
- **Approximate cost carried**: code path + tests + retry-context fixture
  generation infrastructure (`src/agents/writer/retry-context.ts`).
- **Evidence it's not paying back**: 2026-05-09 retrospective: "Slice 2.5
  inconclusive A/B; no writer-expansion events fired in either arm." The
  2026-05-10 fantasy-healer evidence run hit 1.89× and 3.03× target *over* —
  the retry path is gated behind `sceneCallWriterV1`, which is also
  default-off, so even on the over-shoot path the expansion path is
  unreachable. It is dead code on the production runtime today.
- **What I'd remove or downgrade**: do not remove. Tag the path as "covered
  by no production fixture" in the lane-queue. Stop treating it as a
  shippable feature in change-packets; treat it as an experimental scaffold
  whose first job is to fire on a production fixture before any further
  evidence is collected. Block the "Slice 2.5 redo" item in the lane-queue
  Next list until a writer-undershoot fixture exists, per the queue's own
  note.
- **What this frees up**: stops the operator from interpreting
  "writerExpansionMode" as a live lever. Removes one phantom dimension
  from the cohort design space.
- **Risk of removing**: none if it's just a status downgrade.
- **Cheapest way to confirm**: `SELECT count(*) FROM pipeline_events WHERE
  event_type LIKE 'writer-expansion%' AND created_at > now() - interval '30
  days';` — confirm zero, freeze the path.

### O7: Five-axis "lifeValueAxes" + miceActive/Opens/Closes soft priors that no consumer reads

- **What it does**: Per-beat soft priors on the McKee value axis and Sanderson
  MICE thread state, calibrated against Crystal Shard and validated to
  J ≥ 0.85 at beat granularity (`src/schemas/shared.ts:134–242`).
- **Where it lives**: schema, planning-beats prompt, structure-extractor
  agents.
- **Approximate cost carried**: dozens of lines of schema comment,
  calibration evidence in lessons-learned, and downstream "prompt asks
  for these fields, planner emits, mapper ignores" overhead.
- **Evidence it's not paying back**: the autopsy's F-L1-1 names this
  exactly: "the planner-beats output's `valueShifted`/`gapPresent`/
  `miceActive` are soft prior booleans the mapper does not consume." The
  state-mapper prompt does not consume them. The writer prompt does not
  consume them. The five active checkers do not consume them. They appear
  to exist for telemetry — but the diagnostic harness reads them out of
  outline rows post-hoc, which means the planner could emit empty arrays
  and the system would behave identically.
- **What I'd remove or downgrade**: keep emitting (the calibration is
  real and the data is useful for *future* work) but stop calling them
  "load-bearing planner output." In change-packets, stop treating
  `miceCloses` discipline as available leverage; it is a label, not a
  constraint. If a craft-market recommendation hangs on MICE thread
  enforcement (e.g. `opus-craft-market-synthesis.md` R4 balanced-parens
  validator), the validator has to be added — *the data is not enough*.
- **What this frees up**: realistic accounting of what the planner
  currently constrains. The fact that these fields exist is not the same
  as them being load-bearing.
- **Risk of removing**: don't remove the fields. The audit is about how
  they're treated in planning, not about their existence.
- **Cheapest way to confirm before removing**: per-beat
  `miceActive`/`miceCloses` distribution on the 2026-05-10 run vs the
  Crystal Shard reference distribution. Predict: harness output is
  approximately uniformly empty arrays on most beats. (Easy DB query.)

### O8: Reference-resolver sub-agent on every beat with implicit-reference markers

- **What it does**: Detects 24 hardcoded English-language phrases in beat
  descriptions ("the letter", "consequences of", "tension from", "the
  argument", "what they said", etc.) and dispatches a separate LLM call
  to determine which DB lookups to run before assembling beat context.
- **Where it lives**: `src/agents/writer/reference-resolver.ts`
  (full agent + LLM call); called from `beat-context.ts` per beat.
- **Approximate cost carried**: one extra LLM call per beat that contains
  any of 24 trigger phrases. On the 2026-05-10 run, this would fire on
  several beats per chapter. Adds latency and cost.
- **Evidence it's not paying back**: the markers are deterministic English
  phrases; whether they trigger has no relationship to whether the
  resolved-reference text is read by the writer (it appends to the prompt;
  the writer may use it or not). The autopsy's L3 finding is that "what
  the writer reads but ignores" is a recurring pattern. There is no
  measurement showing reference-resolver output changed prose.
- **What I'd remove or downgrade**: replace the 24-phrase deterministic
  trigger with a rule: only run reference-resolver when the beat description
  contains a noun phrase that exact-matches a known character-name or
  location-name from the world bible. The current trigger is too broad;
  ~half the harness's beats contain "the letter" / "what happened" /
  "earlier" type phrasing.
- **What this frees up**: one cheaper-to-call LLM, a deterministic-only
  fallback path that is faster, and one fewer "did the resolver fire?"
  variable in cohort attribution.
- **Risk of removing**: the resolver does sometimes generate useful
  background. Mitigation: A/B against a deterministic-only path on 4
  chapters; if semantic-review lows are equal, narrow the trigger.
- **Cheapest way to confirm before removing**: query
  `llm_calls WHERE agent='reference-resolver'` count and cost per chapter
  on the 2026-05-10 run; compare prose semantic-review lows for chapters
  where the resolver fired vs didn't.

### O9: Both `prose-writer-system.md` AND `beat-writer-system.md` system prompts in active use

- **What it does**: Two writer system prompts, one per granularity
  (whole-chapter and per-beat). Both encode the GOAL → CONFLICT → DISASTER
  scaffold.
- **Where it lives**: `src/agents/writer/prose-writer-system.md` (whole-
  chapter mode), `src/agents/writer/beat-writer-system.md` (per-beat mode).
  Plus `beat-writer-system-salvatore.md` as a Salvatore-specific variant.
- **Approximate cost carried**: maintenance burden — three writer system
  prompts that have to stay synchronized on craft rules (no electricity-as-
  tension, no filter words, GOAL→CONFLICT→DISASTER).
- **Evidence it's not paying back**: `prose-writer-system.md` is whole-
  chapter; the runtime default is per-beat (`beatLevelWriting: true`).
  Per the autopsy, the runtime default writer is `beat-writer-system.md`.
  When does `prose-writer-system.md` get loaded? On the chapter-scope
  redraft path or the whole-chapter rewrite path. Both are marginal in
  current usage. The Salvatore variant is corpus-recreation-only.
- **What I'd remove or downgrade**: consolidate. Keep `beat-writer-system.md`
  as the runtime default. Move `prose-writer-system.md` to
  `src/agents/writer/legacy/` and only load it when an opt-in flag selects
  the chapter-scope path. Leave Salvatore variant alone (corpus-recreation
  has its own contract).
- **What this frees up**: one craft-prompt source of truth. Reduces
  drift between the two prompts that are alleged to encode the same
  Goal/Conflict/Disaster discipline.
- **Risk of removing**: chapter-scope redraft path may break. Mitigation:
  unit test loading `prose-writer-system.md` from legacy/ if redraft path
  is exercised.
- **Cheapest way to confirm before removing**: `git log
  src/agents/writer/prose-writer-system.md`; check the last 90 days of
  llm_calls for `agent='writer'` with chapter-scope context. Likely small.

### O10: Eleven calibrated "discernment" dimensions sitting in fixture-only mode

- **What it does**: 11 single-dimension narrow judges
  (`endpointLanding`, `causalMomentum`, `sceneDramaturgy`,
  `motivationSpecificity`, `characterMateriality`, `worldFactPressure`,
  `relationshipDelta`, `promiseProgress`, `characterAgency`,
  `proseReadiness`, plus the recently added `arcStatePerBeat`) calibrated to
  100% exact on dimension-specific anchors.
- **Where it lives**: `docs/evals/planner-discernment-calibration-v0.md`,
  `docs/evals/planner-discernment-real-data-v0.md`,
  `scripts/evals/planner-discernment-real-data.ts`.
- **Approximate cost carried**: 11 calibrated rubrics + their fixtures.
- **Evidence it's not paying back**: all 11 are diagnostic-only. None gates
  prose acceptance, planner acceptance, or rewrite. The autopsy's CL-3
  ("findings flow up; constraints don't flow down") is exactly this
  pattern. The 2026-05-07 calibration session record explicitly says
  "use one excerpt, one dimension, one rubric before prose tests" — i.e.
  prose-shaped use is deferred. Real-data pilots show the dimensions
  saturate at level 2 on production planner output.
- **What I'd remove or downgrade**: stop adding new dimensions. Pick the
  one or two that have the cleanest "level-0/level-1 = real failure"
  story and wire them as warning-class checkers on prose. Per the autopsy
  R2: `endpointLanding` and `sceneDramaturgy` are the highest-leverage
  candidates. Don't promote any of them to *blocker* without an oracle
  dataset (per memory entry "Don't calibrate noisy LLM checkers"; per the
  semantic-judge plan §R10 60-day operator-review guard).
- **What this frees up**: one fewer "we have lots of measurement, we
  must be measuring something useful" cognitive bias.
- **Risk of removing**: don't remove. Stop expanding. The dimensions are
  fine as a hypothesis bank; the over-build is treating the bank size as
  evidence of progress.
- **Cheapest way to confirm before removing**: status downgrade via doc
  edit; no code change.

### O11: Seven-value `storyDebtStage` enum with `complicate` / `escalation` only emitted under default-off flag

- **What it does**: enum widened from 5 to 7 values to admit `complicate`
  and `escalation` (`src/schemas/shared.ts:88–90`).
- **Where it lives**: schema only. The new values "are emitted only when
  `scenePlanContractV1` is on (Slice 1)" per the schema comment. That flag
  is default-off.
- **Approximate cost carried**: low (two new enum values).
- **Evidence it's not paying back**: under the default runtime, these
  values are never emitted; their existence in the enum is harmless but
  illustrative — the harness routinely widens schemas in advance of
  consumers.
- **What I'd remove or downgrade**: keep the enum. Stop the pattern: when
  introducing a schema enum value gated behind a default-off flag, also
  introduce the test that fails until the flag is default-on. Without
  that, schema changes accumulate ahead of consumer changes.
- **What this frees up**: process discipline.
- **Risk of removing**: none.
- **Cheapest way to confirm**: enumerate all default-off feature flags
  (`scenePlanContractV1`, `sceneCallWriterV1`, `writerExpansionMode`,
  `sceneSatisfactionCheckerV1`, `lintProseEditProposals`,
  `editorialBeatCoverageProposals`, `continuityEditorialFlagProposals`,
  `qualityRedraftEnabled`, `factRoleContextPolicy=role-aware`) — that's
  9 default-off levers. Audit which have schema fields that exist solely
  because of them. Consider applying the same "test fails until default-on"
  rule.

### O12: Functional-state checker covering established/knowledge/state with "mention satisfies" semantics

- **What it does**: Verifies that `establishedFacts`/`knowledgeChanges`/
  `characterStateChanges` are present in the chapter prose. Per its system
  prompt, mention anywhere in the chapter satisfies coverage.
- **Where it lives**: `src/agents/functional-state-checker/`.
- **Approximate cost carried**: one full-chapter LLM call per chapter,
  per attempt. Findings are warning-class until oracle calibration; oracle
  calibration was deferred indefinitely (per memory:
  `feedback_dont_calibrate_noisy_llm_checkers`).
- **Evidence it's not paying back**: the autopsy F-L5-5 names the failure
  mode: "Mention satisfies coverage; the writer can drop a state change
  in narration and pass coverage without dramatizing it." A checker that
  passes on narration is rewarding the failure mode the planner work is
  trying to fix.
- **What I'd remove or downgrade**: drop functional-state-checker from
  the runtime checker bundle. Keep its prompt and schema in the repo as
  reference for a future planner-state oracle, but stop calling it on
  every chapter. The evidence run shows it firing 0 blockers in 2 chapters
  of fantasy-healer; the cost is one LLM call per chapter for marginal
  signal.
- **What this frees up**: ~$0.005/chapter and one more checker call's
  latency. More importantly: removes one of the four "checker tightening"
  surfaces that distract from upstream planner work, per L84 + the
  user's memorized direction (world-bible-architecture-priority).
- **Risk of removing**: continuity drift on planned-state items goes
  unmonitored. Mitigation: deterministic check that all
  `establishedFacts[i].fact` substrings appear in the prose (string match)
  catches the gross failure mode at zero LLM cost.
- **Cheapest way to confirm before removing**: query
  `llm_calls WHERE agent='functional-state-checker'` for the last 30
  days; count distinct `pipeline_events` where its findings caused a
  rewrite. Predict: very low rewrite-firing rate.

### O13: Continuity checker on every chapter despite L84 demoting it

- **What it does**: Detects direct contradictions of established facts.
- **Where it lives**: `src/agents/continuity/`.
- **Approximate cost carried**: one LLM call per chapter (sometimes per
  validation pass).
- **Evidence it's not paying back**: L84 demoted continuity findings out
  of Drafting Plan-Assist gates. L83 found 0% TP / 88% FP / 12% AMB on
  continuity-state warnings (N=50). User memory:
  "Continuity Deprioritized — stop citing continuity as 7k-token heavy
  checker; deprioritized in roadmap, don't propose expansion work." Fact-
  scoped blockers can optionally persist as `editorial_flag` envelopes —
  i.e. they are review items, not gates. Yet the agent still fires on
  every chapter as part of the standard checker bundle.
- **What I'd remove or downgrade**: rate-limit continuity to chapter ≥
  3 (continuity errors are by definition cross-chapter). Skip on chapters
  1 and 2 unless an explicit operator override fires it. Skip when
  `establishedFacts.length < 5` (nothing to contradict).
- **What this frees up**: one fewer LLM call on every early chapter.
  Also reduces the in-prompt token footprint of the checker bundle.
- **Risk of removing**: a chapter-1 fact that gets contradicted in
  chapter-1 prose goes undetected. Acceptable; continuity TP at 0% on
  state warnings means even when it fires, it's mostly noise.
- **Cheapest way to confirm before removing**: query
  `pipeline_events WHERE producer='continuity' AND severity='blocker'
  AND chapter_number <= 2` — count rewrites caused. Predict: very few.

### O14: Halluc-ungrounded multi-call vote (`HALLUC_UNGROUNDED_VOTE_N`) gated by env var

- **What it does**: When >1, runs N parallel halluc-ungrounded calls per
  beat and unions LLM-confirmed flagged entities.
- **Where it lives**: `src/config/pipeline.ts:121` resolves at module
  load time from `HALLUC_UNGROUNDED_VOTE_N`.
- **Approximate cost carried**: when >1, multiplies the halluc-ungrounded
  cost by N per beat.
- **Evidence it's not paying back**: this is L68 / G-D Grounding Lever
  history. The mechanism exists because of stochasticity in single-call
  output. Whether N=2 actually changes the union meaningfully on real
  data is not in the lane-queue or current-state. Default is 1.
- **What I'd remove or downgrade**: leave default at 1; do not raise
  without a paneled comparison. Add a lint rule blocking
  `HALLUC_UNGROUNDED_VOTE_N` in commit messages without a linked
  experiment ID.
- **What this frees up**: prevents accidental cost scaling on a path that
  has no recent measured win.
- **Risk of removing**: trivial.
- **Cheapest way to confirm**: count llm_calls grouped by
  `agent='halluc-ungrounded'` and inspect cost variance over the last
  60 days.

### O15: Active thread/promise/payoff IDs rendered into the writer prompt as ID strings

- **What it does**: `renderCharacterContextCapsules`
  (`src/agents/writer/character-context.ts:147–183`) emits
  `Active thread refs: thread-archive-truth`, `Active promise refs:
  debt-archive-betrayal`, `Active payoff refs: payoff-...`, and per-card
  `Source obligations: obl-001-...`, `Active threads: ...`, etc. — when
  the v1 capsule mode is on (which is the production default per L094).
- **Where it lives**: `character-context.ts:159–161`, 178–180.
- **Approximate cost carried**: ~50–200 prompt tokens per beat in IDs that
  the model is being asked to consume textually. The autopsy's R7 names
  this cost.
- **Evidence it's not paying back**: the writer is being shown
  `obl-001-ch-001-must-establish-archive-keepers` strings as if they were
  prose-relevant. They are dispatching keys; they are not story content.
  In `output/novel-1778411555121/` the 2026-05-10 evidence shows
  threadId/promiseId/payoffId are *empty* on the obligations that did
  flow through, so the IDs being shown are mostly obligation-IDs and
  source-IDs — pure dispatching keys.
- **What I'd remove or downgrade**: per autopsy R7 — strip all `*Id:` and
  `Active *refs:` lines from the writer-rendered prompt. Keep them in the
  trace artifact for telemetry. If the goal is to bias the writer toward
  carrying named threads, render the *thread label* ("the archive truth
  arc") not the thread ID slug.
- **What this frees up**: 5–15% of the per-beat prompt budget on a path
  that the autopsy already names as the live pressure point (writer
  context is rich on identity, sparse on conflict).
- **Risk of removing**: byte-parity tests will fail on the change. Acceptable;
  a deliberate prompt-shape commit is correct.
- **Cheapest way to confirm before removing**: byte-parity diff after the
  change; a small A/B (4 chapters) measuring word ratio variance and
  semantic-review lows.

---

## Section 2 — Run/Thread/ID Lineage Audit

### What's declared, what's consumed, what's enforced

The IDs in question:

- **`runId` / `rootRunId` / `parentRunId` / `variantId`**: execution
  lineage (Job 1 H12 hypothesis).
- **`chapterId` / `sceneId` / `beatId`**: planning artifact identity.
- **`obligationId` / `sourceId` / `sourceKind`**: per-obligation refs.
- **`threadId` / `promiseId` / `payoffId` / `payoffEventId`**: narrative
  story-debt refs (L093).
- **`structureSlotId` / `sceneTurnId`**: method-pack-shaped slots.
- **`characterId` / `worldFactId`**: registry refs.

#### Lineage table

| ID | Declared by | Consumed by | Persisted | Enforcement | Status |
|---|---|---|---|---|---|
| `chapterId` | `enrichOutlineIds`; planning-plotter schema | drafting, writer beat-context, all 4 checkers, validation, plan-readiness, planning-edit proposals, traceability route, chapter-health route | yes (`outlines`, `chapter_drafts`, `llm_calls.chapter_id`) | strict in persisted-outline schema (audit source of truth) | **load-bearing** |
| `sceneId` | `enrichOutlineIds`; sceneBeatSchema; scene-first runtime | drafting (resolves `sceneId` for chapter-plan-checker deviations); writer telemetry; scene replay/parity diagnostic scripts | yes (`llm_calls.scene_id`) | additive; not blocking | **partly load-bearing** — telemetry yes; planner/writer/checker logic still beat-shaped under default flags |
| `beatId` | enrichOutlineIds; sceneBeatSchema | writer beat-context renders `Beat ID:`; `llm_calls.beat_id`; chapter-plan-checker deviations; legacy beat-shaped paths | yes | additive | **legacy load-bearing** — still consumed but documented as legacy/beat-specific only (L092/L095) |
| `obligationId` | enrichOutlineIds | beat-context render emits `Source obligations: obl-...`; structured findings carry `obligationIds` (L098 wiring); routing helper | yes | warning-only routing (L098) | **partly load-bearing** — routing helper exists; closes a silent-no-op path; still optional |
| `sourceId` / `sourceKind` | mapper prompt | validator: "an obligation without a well-formed sourceId is an unknown obligation" (`src/schemas/shared.ts:73–74`) | yes | semi-strict in validator | **load-bearing** |
| `threadId` | planning-extractor; planning-directives normalize; mapper prompt | beat-context renders to writer prompt; `story-refs.ts` validates against declared threads with warning-only `unknown_thread_id` | yes (`outline.scenes[*].obligations[*].threadId`) | warning-only, never blocks | **cosmetic-on-this-runtime** — declared in directives, validator can fire warnings, but the 2026-05-10 evidence run had `threadId=0` on every obligation |
| `promiseId` | mapper prompt; planning-directives normalize | beat-context render; story-refs.ts warning | yes | warning-only | **cosmetic-on-this-runtime** — same: `promiseId=0` on 2026-05-10 |
| `payoffId` | mapper prompt | beat-context render; story-refs.ts | yes | warning-only; deterministic mint when stage demands and ID missing (`src/harness/ids.ts:298+`) | **cosmetic-on-this-runtime** — 2026-05-10 had `payoffId=0` |
| `payoffEventId` | mapper prompt (only when `payoffId` set on partial/final stages) | not consumed by writer/checker code | yes | mapper schema validates pairing | **orphan** — required-when-paired by mapper prompt, no downstream reader |
| `structureSlotId` | nobody | nobody | only via tests | none | **orphan** — schema-only |
| `sceneTurnId` | nobody | nobody | only via tests | none | **orphan** — schema-only |
| `worldFactId` | sceneBeatSchema (optional) | halluc-ungrounded entity-ref machinery indirectly via `entityRefs[]` for `world_system`/`culture`/`character` | partly | additive on findings | **load-bearing in checker output** but planner emission rate is unknown |
| `characterId` | character-agent + enrichOutlineIds | beat-context character cards; checker character refs; entity resolution | yes | strict in character cards | **load-bearing** |
| `runId` family | n/a — there is no run-id substrate in the runtime checker/writer path | central run telemetry uses `central run` (e.g. 839 in 2026-05-10 record) but the runtime drafting code does not propagate `runId` / `rootRunId` / `parentRunId` / `variantId` through the agent calls | partly (in pipeline_events / experiments) | none at agent call site | **declared as H12 ambition; not implemented at the agent-context layer** |

#### Top three cosmetic lineage gaps

**Cosmetic Gap CG-1: thread/promise/payoff IDs declared everywhere, populated by no live planner.**

- **What's cosmetic**: `threadId` / `promiseId` / `payoffId` are required by
  the mapper system prompt, validated by `story-refs.ts`, rendered into the
  writer prompt, persisted to DB, and surfaced in writer telemetry.
- **What's missing**: a planner that *creates* a thread/promise. The
  planning-extractor agent (concept phase) accepts threads/debts/payoffs
  as author-supplied — and per its system prompt, "Extract only author-stated
  story debts." The default fantasy-healer seed does not declare any. The
  2026-05-10 evidence run confirmed: 23 obligations, all with
  `threadId=0`, `promiseId=0`, `payoffId=0`. The 2026-05-09 lane-queue
  Next item explicitly calls this out: "fixture or prompt path that emits
  real threadId/promiseId/payoffId refs so lineage can be tested."
- **Cost**: writer prompt carries empty `Active thread refs: ` lines (or
  hides the lines if empty, per the rendering code's `if length > 0` gates,
  which is fine). The cosmetic cost is in the *belief* that the harness has
  a promise/payoff substrate. It does not, in any normal-seed-shape run.
- **Proposed action**: choose (b) — remove or strongly downgrade until a
  path needs them. Specifically:
  - Stop treating L093 as "shipped lineage substrate." It is *one half* of
    the substrate (the consumer half). The producer half is missing.
  - Move story-refs.ts validator to "advisory; emits zero issues by default"
    until at least one fixture exercises non-empty thread refs.
  - Block `opus-craft-market-synthesis.md` R4 (MICE balanced-parens
    validator) until thread refs flow through a real seed. Without thread
    refs, the validator has nothing to walk.

**Cosmetic Gap CG-2: `obligationId` flows to writer prompt as a dispatching key.**

- **What's cosmetic**: the writer prompt receives strings like
  `Source obligations: obl-001-ch-001-must-establish-archive-keepers`.
- **What's missing**: a reason for the writer to *care* about the ID.
  Writers don't dispatch on IDs; they dramatize content. The autopsy F-L3-2
  ("ID noise crowds the dramatic surface") is exactly this — the IDs
  flow because the trace needs them, but the writer is the wrong place to
  surface them.
- **Cost**: ~50–200 prompt tokens per beat call.
- **Proposed action**: option (a) — make load-bearing on a specific path:
  the operator-review traceability path needs IDs in the *trace*; remove
  them from the *writer prompt*. Concretely: keep the
  `summarizeCharacterContextCapsules` trace; strip the rendering of
  `Source obligations: ...`, `Active threads: ...`, `Active promises:
  ...`, `Active payoffs: ...`, `Beat ID:`, `Chapter ID:`, and `POV
  character ID:` from `renderCharacterContextCapsules`.

**Cosmetic Gap CG-3: `runId` / `rootRunId` / `parentRunId` / `variantId` exist as a hypothesis (H12) but are not propagated through the agent context.**

- **What's cosmetic**: the H12 hypothesis declares the goal; the harness
  does not propagate execution lineage IDs through `callAgent` invocations.
  Per `docs/sessions/2026-05-09-thread-map-multichapter-smoke.md` and
  `2026-05-09-planner-thread-ref-smoke.md`, the thread-map work has
  produced manifests and validators — but execution lineage at the agent
  call site is not threaded through `BeatContextInput`, mapper context,
  or checker context.
- **What's missing**: the actual run-substrate at the agent call site. If
  H12 is "execution lineage and narrative thread refs travel together,"
  the execution half is not in place.
- **Cost**: zero today (because nothing depends on it). The cosmetic cost
  is in the framing — H12 is presented as advancing, but only the
  diagnostic side is moving.
- **Proposed action**: option (b) — remove until a path needs them. Move
  H12 from "active" to "deferred" in `docs/authoring-methodology-hypotheses.md`
  until either (i) a paired-replay harness needs `parentRunId` for
  attribution or (ii) a multi-variant cohort needs `variantId`. Until
  one of those exists, the hypothesis is not paying for the operator
  attention it consumes.

#### Additional lineage observations

- **The strict vs permissive schema split** is the right pattern but is
  cosmetic for `outline.scenes[*].obligations` because the strict variant
  is only invoked on the `generate-from-outline` Canon-proposal route —
  i.e. an audit-only path. The drafting runtime uses the permissive
  schema; bad obligations silently default to empty arrays. The pattern
  prevents one specific class of bug; it does not prevent the broader
  "obligation is well-formed but unread" pattern that O3/O4/O5 exemplify.

- **`payoffEventId` is the worst-case orphan**: required by the mapper
  prompt when `payoffId` is set on partial/final stages, validated for
  pairing in mapper schema, and consumed by *no* downstream code.
  Suspect this is anticipating a future payoff-event-resolution checker
  that does not exist. Recommend: drop the requirement until that
  checker ships.

- **`additive / warning-only` posture has accumulated.** L093
  ("warning-only ref validation"), L098 ("warning-only routing"), L96
  ("validator demoted to advisory"), L84 ("continuity findings remain
  diagnostic/review evidence"), L82 ("hold; role-aware A/B-only").
  Five active decisions in the last 30 days demote a finding to
  warning-class or advisory. The cumulative effect: most new lineage
  data is observational. The harness has lost the ability to *enforce*.
  This is the cross-cutting pattern Jobs 1–4 keep proposing more
  observation against, when subtraction (fewer warning-class signals,
  one or two enforced ones) would be the higher-leverage move.

---

## Section 3 — Push-Backs Against the Other Four Opus Artifacts

Every push-back cites a specific recommendation by R-number and source.

### Push-back P1: against `opus-harness-autopsy.md` R1 "Promote scene contract into the default writer-prompt path"

- **What the rec proposes**: flip `sceneCallWriterV1` semantics so the
  scene-contract block always renders, even partially, with `?`
  placeholders for missing fields. Change the default behavior of the
  state-mapper to populate scene-contract fields from existing beat
  descriptions.
- **Why this is premature**: the L096 retrospective explicitly demoted
  the scene-contract validator to advisory because *V4 Flash could not
  reliably comply with the multi-field contract*. R1 acknowledges this
  and proposes "make the contract visible to the writer rather than
  enforced by validator," which is a reasonable fallback — but the
  underlying question is: does V4 Flash *as the writer* improve on
  beat-shaped output when the contract is partially populated, or does
  it now have two competing structural anchors (the beat description
  AND a partial scene contract) and pick the one it understands? The
  Slice 2.5 A/B was inconclusive (wrong fixture profile); the lane-queue
  now requires a "writer-undershoots fixture + pre-resolved entities"
  before the redo. Promoting the contract to default-on without that
  fixture violates the lane-queue's own gate.
- **What I'd do instead**: build the writer-undershoots fixture first
  (Slice 2.5 redo). Then run the A/B on it. Then decide whether to
  default-on. R1's framing "this addresses F-L2-1, F-L2-3, F-L4-1, F-L4-2
  simultaneously" is a feature flag promotion that bundles four failure
  modes into one change — the L087 single-lever discipline says don't.

### Push-back P2: against `opus-harness-autopsy.md` R2 + `opus-semantic-judge-plan.md` J1 / R1 "Wire scene-dramaturgy / endpoint-landing as a runtime checker on prose"

- **What the rec proposes**: take the calibrated `sceneDramaturgy` and
  `endpointLanding` discernment dimensions (currently fixture-only) and
  fire them as warning-class checkers on generated prose.
- **Why this is premature**:
  1. User memory `feedback_dont_calibrate_noisy_llm_checkers`: "TP/FP
     panels for LLM continuity/halluc/grayzone checkers are wrong-direction;
     strategic answer is deterministic plans + scoped AI-friendly checks,
     not measuring noisy checker gray zones." This is *exactly* the
     pattern the recommendation revives.
  2. The autopsy itself notes (Sample 19) that the dimensions saturate
     at level 2 on real data; "the dimensions catch broken (level 0/1)
     cleanly but cannot separate decent from excellent at the live
     ceiling." Adding a warning-class checker that fires on level 0/1
     is fine if level 0/1 is rare; if it is common (autopsy expects ≥40%
     of harness chapters at SCENE-1/ENDPOINT-1), the checker becomes
     constant noise and the operator stops reading findings.
  3. The semantic-judge-plan R10 already says "hold all multi-judge
     prose panels behind operator review for the first 60 days" — so
     the rec is self-gating to 60 days of operator labeling, which is
     exactly the labor-intensive operation the user has flagged as
     wrong-direction in the feedback memory.
- **What I'd do instead**: nothing yet. Wait for a load-bearing trigger:
  either (a) an oracle dataset exists (R11 of autopsy, which is the
  precondition the recs themselves admit) or (b) the planner has been
  changed in a way where *that planner change* needs validation, and
  the dramaturgy judge gets used once on that change. Don't promote a
  warning-class checker to runtime "because it will be useful eventually."

### Push-back P3: against `opus-craft-market-synthesis.md` R5 "Paired STC-genre + Story-Grid-genre planner directive"

- **What the rec proposes**: require concept seeds to declare both
  `stcGenre` (10-way) and `storyGridGenre` (12-way external). Map
  combinations to obligatory-scene checklists.
- **Why this is premature**: the user memory
  `project_genre_flexibility` (2026-05-03) says: "design for genre swap
  (romance/pulp/LitRPG); L1 is genre-neutral, L2+planner-beats parameterize
  by genre; LitRPG no longer assumed proving ground." The recommendation
  proposes hard-coding 10×12 = 120 genre combinations into the seed
  contract, before the harness has a *single* genre pack that has won a
  head-to-head against CFA v1. The CFA v1 cohort is `HOLD` (Method-Pack
  Flash N=18 paired cells, character materiality / world relevance /
  endpoint landing did not improve over no-method control).
- **What I'd do instead**: run *one* genre profile to win against CFA v1
  before committing to a 120-combination matrix. The cross-pack diagnostic
  that supposedly motivates the matrix (`opus-method-pack-candidates.md`
  §12) is itself diagnostic-only with no promotion path. The user has
  named this exact failure mode in
  `feedback_pilot_checkers_in_production`: synthetic eval rates are a
  lower bound; validate with a 3-chapter romance-drama run.

### Push-back P4: against `opus-method-pack-candidates.md` (entire artifact, all 7 packs)

- **What the rec proposes**: 7 new method-pack charters (PFA / EPI / THF /
  CMF / LRP / RMT / HST), each with full slot maps, scene contracts,
  diagnostics, anti-patterns, and synthetic golden examples. ~1,800 lines
  of charter prose.
- **Why this is premature**:
  1. CFA v1 is itself `HOLD` per lane-queue. Adding 7 more packs each
     of which has a "v1 evidence gate" path means *eight* unfinished
     evidence gates in flight. The lane-queue currently bounds active
     work to one primary lane (CLAUDE.md "Default improvement-loop
     shape"). Eight pack gates in parallel violates that.
  2. The packs collectively introduce ~70 new pack-specific schema
     fields (each pack adds 0–6 fields). The audit pattern in §1 (O3,
     O4, O5, O11) is *zombie schema fields ahead of consumers*. Adding
     70 more without first burning down the existing zombies multiplies
     the problem.
  3. The recommendation R8 of that artifact ("Keep CFA at v1; do not
     produce v2 until ≥2 genre-specific packs clear the v1 evidence
     gate") is essentially a self-reinforcing loop: build 7 packs, hope
     2 clear, then build v2. The simpler answer is: clear CFA v1 first.
- **What I'd do instead**: archive the whole artifact as `parking-lot/`.
  When and if CFA v1 clears its evidence gate and the harness needs a
  *second* method pack, return to this document and pick *one* (CMF or
  RMT, both highlighted in the artifact's own R6 / R10 sequencing). Do
  not author 7 charter files yet.

### Push-back P5: against `opus-method-pack-candidates.md` R5 "Promote magicCostLedger from THF/LRP/HST into shared L2 diagnostic"

- **What the rec proposes**: pull the magic-cost ledger schema from three
  pack drafts into a shared diagnostic that fires when
  `magicSystemStance: hard`.
- **Why this is premature**: `magicSystemStance` is not a field on any
  current concept seed schema. None of the THF/LRP/HST packs have shipped.
  The shared diagnostic is being lifted out of three artifacts that don't
  exist yet. This is recommendation-on-recommendation; the chain of
  dependencies is fictional.
- **What I'd do instead**: do not promote. If the magic-cost question
  is real, the cheapest test is a single LLM-judged check on the existing
  fantasy-healer prose: "every magic transfer in this chapter has a
  named cost." One judge, two chapters, $0.02. Compare to operator
  review. That tells you whether the ledger is needed before any pack
  ships.

### Push-back P6: against `opus-craft-market-synthesis.md` R12 "Subgenre-overlay knob for `seed.market`"

- **What the rec proposes**: add `seed.market: ku_commercial_fantasy |
  ku_romantasy | ku_progression | ku_cozy | indie_general | trad_literary`,
  affecting chapter-length targets, opening-hook strictness, obligatory-
  scene checklists, and sequel-hook expectation defaults.
- **Why this is premature**: the harness's commercial focus is "fantasy
  + gamelit/litrpg" per memory `project_fantasy_genre_focus`. Adding a
  6-way market knob proposes parameterizing across markets the harness
  has not committed to. The first-paragraph hook checker (R2 of the same
  artifact) is the same kind of intervention but narrower; if it works,
  *that* tells you whether KU-shape is a meaningful runtime distinction.
- **What I'd do instead**: defer the market knob. If R2 (first-para
  hook checker) clears its evidence gate on `seed.market = ku_commercial_fantasy`
  data, *then* propose the knob as the way to enable/disable the checker
  per market. Don't introduce the knob and hope to find checks for it.

### Push-back P7: against `opus-semantic-judge-plan.md` R7 "A/B Salvatore writer-prompt blocklist before any change"

- **What the rec proposes**: do an A/B before removing the cliché
  blocklist from `prose-writer-system.md`.
- **Why this is fine in spirit but premature in operational priority**:
  the priming-suppression A/B discipline (memory:
  `feedback_priming_suppression_ab`) is real, and the doc cites it. The
  push-back is on *priority*: the entire 2026-04-20 priming finding
  was that *removing* the blocklist made things worse on a Salvatore
  panel. The corresponding question is whether the blocklist is
  load-bearing at the *runtime* writer level (DeepSeek V4 Flash on a
  generic fantasy seed). The samples in the autopsy show no electricity-
  as-tension violations across 5 chapters — i.e. the blocklist is *not*
  being repeatedly violated anyway. Re-running an A/B on a problem
  that's not a current symptom is using compute on the wrong question.
- **What I'd do instead**: skip. Mark the A/B as deferred until a
  cliché violation actually fires on production prose. The 2026-04-20
  Salvatore-corpus result was the answer for the route that mattered;
  re-running on the V4 Flash route is recommendation-driven, not
  evidence-driven.

### Push-back P8: against `opus-harness-autopsy.md` R5 "Promote one structure agent (Promise/Payoff) from corpus-extractor to live planner constraint"

- **What the rec proposes**: stand up a `PromiseRegistry` table; reuse
  the `structure-promise` agent's prompt against generated chapter
  outlines during planning.
- **Why this is premature**: the `structure-promise` agent's prompt is
  corpus-extraction-shaped. Per audit O2, all five structure agents
  begin with "you read the chapter-by-chapter beat sequence of a
  *published* novel." Reusing the prompt against in-progress outlines
  is not a 1-line invocation change — it's a prompt rewrite. The R12
  recommendation in the same artifact (audit-and-freeze structure
  agents) is correct and conflicts with R5; the artifact does not
  reconcile them.
- **What I'd do instead**: pick R12 over R5. If a planner-side promise
  agent is needed, scope it as a new agent with a planner-shaped prompt,
  not a reuse of the corpus extractor. Sequence: do R12 first (clean
  separation), then *if and when* a planner-promise agent is needed,
  build it as new — don't pretend the existing one transfers.

### Push-back P9: against `opus-craft-market-synthesis.md` R2 "First-paragraph hook checker on chapter-1 prose"

- **What the rec proposes**: add a `chapter-1-hook-checker` LLM validator
  that reads only the first ~150 words and outputs `hook_present: bool`,
  `hook_type: enum`, `failure_reason: string`. Routes to `editorial_flag`
  envelope if missing.
- **Why this is premature** (qualified): I think this is *the most
  defensible* recommendation in the entire 4-doc set, and yet I'd still
  push back on shipping it now, because the failure mode it catches is
  not currently a documented harness symptom. The autopsy's chapter-1
  samples (5 chapters across the 5 sampled novels) do not show "weather
  report" openings — they show interiority openings. Whether KU readers
  prefer interiority over weather-report is a different question than
  whether the harness produces weather-report openings to begin with.
- **What I'd do instead**: do *one* thing first. Run the proposed
  semantic-judge-plan J1 (`endpointLanding`) on the existing
  `output/semantic-gate-baseline-*` chapter-1 prose. If endpoint-landing
  is the dominant first-chapter problem (which the CFA-v1 cohort says
  it is at the chapter-purpose level), spending the budget on a hook
  checker for openings that probably already pass is wrong-direction.
  If openings *are* a problem, then ship R2.

### Push-back P10: against the cumulative direction of all four artifacts — "every recommendation adds; none subtracts"

- **What the recs collectively propose**: roughly 30 new diagnostics,
  judges, packs, and templates across the four documents. Across all
  four, *zero* recommend removing or freezing an existing system.
- **Why this is the highest-priority pushback**: the harness's repeated
  pattern is "build a substrate ahead of consumer." Phase 7 (O1), the
  five corpus extractors (O2), `materialityTest` (O3), `structureSlotId`
  (O4), `sceneTurnId` (O5), expansion mode (O6), discernment dimensions
  (O10), the seven default-off flags. Eight of the twelve concrete
  surfaces in §1 are at-most-partly-consumed. Adding 30 new
  diagnostics/judges/packs *to* this pattern, without removing any of
  the existing eight, drops the average load-bearing-ness of the
  harness further. CLAUDE.md "Strategic Constraints" is a *list of
  retired things* — the operator has good muscle memory for retiring
  paths; the four artifacts collectively re-introduce things that
  resemble retired paths (LoRA-derived voice rules, Salvatore-route
  blocklists, extended checker tightening) under new framing.
- **What I'd do instead**: every artifact in the set should specify
  its *removal pair*. If `chapter-1-hook-checker` ships, what does it
  replace? If `J1` ships, what does it replace? If a method pack ships,
  which existing default-off flag is also retired in the same commit?
  The artifacts are written assuming the harness can absorb additions
  without subtractions; the §1 audit shows it cannot.

---

## Section 4 — Things NOT to Build Next

A negative backlog. Twelve directions the harness *could* go but
shouldn't yet. Each cites the artifact or constraint that says don't.

### NB-1: Do not upgrade the writer model before scene contracts are wired.

User memory `project_context_engineering_priority` (2026-04-21) explicitly
points to "context engineering + editing passes > conditioning tricks;
writer-model upgrade is on the table." The autopsy CL-5 names the writer
prompt as assuming a contract the planner doesn't produce — i.e. the
problem is upstream. Upgrading the writer to a stronger model before
fixing the planner-to-writer contract gap puts a smarter model on a
malformed input. Defer.

### NB-2: Do not add genre-pack auto-selection before any genre pack has won a head-to-head.

`opus-method-pack-candidates.md` R2 proposes a deterministic
seed→pack selector with operator confirmation. CFA v1 is `HOLD` per
lane-queue (Method-Pack Flash N=18 cohort). Adding selection logic
ahead of a winning pack is recommendation-on-recommendation.

### NB-3: Do not calibrate new noisy LLM checkers.

User memory `feedback_dont_calibrate_noisy_llm_checkers` (2026-05-05).
This blocks the entire prose-side judge promotion path of
`opus-semantic-judge-plan.md` until an oracle dataset exists. The
semantic-judge plan's R10 60-day operator review is itself a noisy-LLM-
checker calibration in disguise.

### NB-4: Do not build a UI surface for any judge that isn't gating runtime decisions.

Per L78 ("UI/browser CI posture") and the lane-queue rule "Visibility/
interactivity foundation is at scope ceiling for now." The Diagnostics
UI already exposes risk drivers, candidate artifacts, etc. — adding new
judge surfaces without runtime decisions to expose is decoration.

### NB-5: Do not build a lineage graph database before the cosmetic-vs-load-bearing audit (this document) is acted on.

H12 in `authoring-methodology-hypotheses.md` says "treat Option B as
lineage fields, not graph implementation." The §2 audit shows three
of the most-discussed lineage IDs (`threadId`, `promiseId`, `payoffId`)
are populated by no live planner on the production seed shape. Building
graph infrastructure on top of empty fields is wrong-order.

### NB-6: Do not re-run corpus-leak / Salvatore-route detection.

CLAUDE.md "Strategic Constraints": "Salvatore route-specific leak
detection [...] retired from runtime unless explicitly re-authorized."
None of the four prior artifacts proposes this directly, but the
priming-suppression A/B (semantic-judge plan R7) is adjacent. Confirm
no new corpus-leak surface is added.

### NB-7: Do not retrain LoRAs.

CLAUDE.md "Strategic Constraints": "Writer-layer LoRA routing, tonal/
voice LoRA generation [...] retired." User memory
`project_fine_tune_free_direction`. The four artifacts do not propose
this; the constraint is named here for completeness (so a later
"why don't we just LoRA the Goal-Conflict-Disaster anchor in" is
pre-rejected).

### NB-8: Do not introduce a new prompt that asks the writer to "follow the scene contract" while the contract is partially populated.

The L096 retrospective demoted the validator to advisory because V4
Flash could not comply with the multi-field contract. Adding a writer-
side instruction to comply with a contract the *upstream* couldn't
generate is dispensing the responsibility downstream — exactly the
pattern the autopsy CL-5 names as the planner-writer contract gap.

### NB-9: Do not promote `lintProseEditProposals` / `editorialBeatCoverageProposals` / `continuityEditorialFlagProposals` from default-off to default-on without an operator-review feedback loop that consumes the proposals.

These three flags (per `current-state.md` Phase 7 detail) are
proposal-emit hooks. Per O1, the proposal model has no live consumer.
Promoting any of these without a consumer pumps three new emit paths
into a queue nothing reads.

### NB-10: Do not raise `HALLUC_UNGROUNDED_VOTE_N` above 1 without a paneled comparison.

Per O14. The vote mechanism is sound; the cost increase is multiplicative.
The 2026-05-10 evidence run did not name halluc-ungrounded as a
pressure point.

### NB-11: Do not add `seed.market` or `seed.directives.bookEndingShape` or `seed.directives.burnRate` flags before any of the existing seed-level levers (genre, voice, world-pressure-rule) has demonstrated runtime impact.

Per push-back P6. The seed-level surface is already fairly broad; the
fact that the four Opus artifacts collectively propose ~9 new seed
fields suggests the artifacts are treating the seed as a place to
declare intent rather than to constrain runtime.

### NB-12: Do not consolidate `prose-writer-system.md` and `beat-writer-system.md` craft rules without a paneled comparison.

Per O9 — I propose moving prose-writer-system.md to legacy/. That's a
file move, not a rule consolidation. The craft-rule consolidation
question (which prompt is the source of truth for "speech is law" /
"no electricity-as-tension" / "minimum dialogue exchanges") is a
separate operation with its own A/B requirement. Don't bundle.

---

## Section 5 — Removal/Subtraction Recommendations

Eight subtractions. Same structured shape as the prior artifacts, but
each recommendation removes, downgrades, or defers rather than adds.

### Recommendation R1: Strip ID metadata from the writer-rendered prompt

- **Layer optimized**: L3 (writer context rendering).
- **Exact proposed change**: in `renderCharacterContextCapsules`
  (`src/agents/writer/character-context.ts:147–183`), suppress lines
  that emit `Chapter ID:`, `Beat ID:`, `Beat number:`, `POV character
  ID:`, `Active thread refs:`, `Active promise refs:`, `Active payoff
  refs:`, `Source obligations:`, `Active threads:`, `Active promises:`,
  `Active payoffs:`. Keep them in the trace artifact for telemetry/
  lineage; remove from the writer's prompt entirely. Same change as
  autopsy R7 — listed here because subtraction is the framing.
- **Expected storytelling benefit**: indirect — frees ~50–200 prompt
  tokens per beat call. Named target: those tokens become available
  for the SCENE CONTRACT block when (and if) it goes default-on.
- **Downstream risks**: byte-parity tests fail; expected. Trace
  consumers continue to receive IDs through `summarizeCharacterContextCapsules`,
  no telemetry regression.
- **How to test it cheaply**: byte-parity diff on the rendered prompt;
  4-chapter A/B on word-ratio variance and semantic-review lows.
  Cost: <$0.50.
- **What data would prove value**: token reduction ≥10%; no semantic-
  review regression; trace artifacts continue to carry full ID set.
- **What should remain unchanged**: all slot-builder code; trace
  structures; orchestrator telemetry; `summarizeCharacterContextCapsules`
  output schema; checker contracts.

### Recommendation R2: Move corpus-extractor structure agents under `src/agents/corpus-extractors/`

- **Layer optimized**: L0 (artifact ergonomics) — corresponds to O2.
- **Exact proposed change**: relocate `structure-promise/`,
  `structure-mice/`, `structure-mckee-gap/`, `structure-character-arcs/`,
  `structure-value-charge/` into `src/agents/corpus-extractors/`. Update
  the corpus pipeline imports. Drop `mice-system-v2-draft.md` and
  `value-charge-system-v2-draft.md` (they are draft-state artifacts; if
  needed, re-introduce when a corpus-pipeline change requires them).
- **Expected storytelling benefit**: indirect — clarifies the runtime
  agent inventory. Named target: removes the "we have a promise agent
  available" temptation that makes autopsy R5 / craft-market R4 sound
  cheaper than they are.
- **Downstream risks**: corpus pipeline imports break unless updated.
  Mitigation: a simple grep+rename PR with `bun run corpus:extract:smoke`
  validation.
- **How to test it cheaply**: post-move, run the corpus pipeline against
  Crystal Shard end-to-end (existing fixture). Cost: free
  (deterministic + corpus extraction reuses cache).
- **What data would prove value**: the corpus pipeline produces
  byte-identical output to the pre-move run.
- **What should remain unchanged**: agent prompts; agent schemas; the
  corpus pipeline contract.

### Recommendation R3: Drop `materialityTest` requirement from the state-mapper prompt

- **Layer optimized**: L1 (mapper prompt) — corresponds to O3.
- **Exact proposed change**: remove the
  "Every beat obligation MUST include a 'materialityTest' string"
  requirement from `src/agents/planning-state-mapper/context.ts:89`.
  Keep the schema field optional. Update mapper-context tests to no
  longer assert presence.
- **Expected storytelling benefit**: indirect — smaller mapper prompts,
  faster mapper runs. Named target: planner-quality work where mapper
  prompt size is a constraint.
- **Downstream risks**: a future obligation-aware checker that wants
  to read materialityTest needs to re-add the requirement. Acceptable.
- **How to test it cheaply**: re-run the 2026-05-10 fantasy-healer
  evidence shape; verify mapper still emits all required fields and
  drafting still produces a valid chapter. Cost: ~$0.05 for one chapter.
- **What data would prove value**: mapper output round-trips through
  obligation persistence, beat-context render, and checker input
  with no errors.
- **What should remain unchanged**: schema field (optional); the
  mapper's obligation taxonomy; downstream checkers.

### Recommendation R4: Remove `structureSlotId` and `sceneTurnId` from the obligation schema

- **Layer optimized**: L1 (schema cleanup) — corresponds to O4 + O5.
- **Exact proposed change**: remove the two optional fields from
  `src/schemas/shared.ts:91–92`. Update the one test that uses
  `structureSlotId` (`src/harness/ids-propagation.test.ts:102`).
  Re-introduce the fields in the same commit as their first emitter
  + first consumer.
- **Expected storytelling benefit**: indirect — schema does not
  promise affordances the system does not provide. Named target:
  one less zombie field cited as evidence of "method-pack readiness."
- **Downstream risks**: trivial.
- **How to test it cheaply**: schema unit tests + the
  ids-propagation.test.ts update.
- **What data would prove value**: post-change, no agent prompts or
  consumer code references the removed fields.
- **What should remain unchanged**: all other obligation refs; method-
  pack documents (which can keep proposing the field; they are
  charters, not contracts).

### Recommendation R5: Skip continuity checker on chapters 1–2

- **Layer optimized**: L5 (checker bundle) — corresponds to O13.
- **Exact proposed change**: in the chapter-validation pass, skip the
  continuity LLM call when `chapterNumber <= 2 || establishedFacts.length
  < 5`. Continuity errors are by definition cross-chapter; firing on
  chapter 1 has 0% TP per L83.
- **Expected storytelling benefit**: indirect — saves one LLM call per
  early chapter; reduces operator review queue noise.
- **Downstream risks**: a chapter-1 fact contradicted within chapter 1
  goes undetected. Mitigation: deterministic fact-string-presence check
  (existing functional-state semantic) catches gross cases.
- **How to test it cheaply**: rerun the 2026-05-10 evidence shape with
  the skip in place; confirm no new chapter-2 continuity blockers fire
  that would have been caught by chapter-1 continuity calls.
  Cost: ~$0.03/run.
- **What data would prove value**: zero chapter-1 continuity blockers
  in the last 90 days of `pipeline_events`. Predict: query result is
  near zero.
- **What should remain unchanged**: continuity prompt; continuity
  schema; downstream proposal envelope mapping; chapter ≥ 3 behavior.

### Recommendation R6: Drop functional-state-checker from the runtime checker bundle

- **Layer optimized**: L5 (checker bundle) — corresponds to O12.
- **Exact proposed change**: remove `functional-state-checker` from the
  default checker call sequence in `src/phases/functional-checks.ts`
  (or wherever it's invoked). Keep the agent code in the repo. Replace
  with a deterministic substring-presence check on
  `establishedFacts[*].fact` against the chapter prose.
- **Expected storytelling benefit**: indirect — one fewer LLM call per
  chapter on a checker whose findings are warning-class until oracle
  calibration that is not coming. Named target: budget for the
  scene-shape work the autopsy R1/R2 names.
- **Downstream risks**: a planned-state item that the prose addresses
  obliquely (paraphrased) is missed by deterministic substring match;
  the LLM checker would have caught it. Acceptable; the LLM checker's
  "mention satisfies" semantics already reward paraphrase.
- **How to test it cheaply**: 6-chapter shadow run (parallel arms:
  with vs without functional-state-checker). Compare planned-state
  miss rate against operator review. Cost: ~$0.30.
- **What data would prove value**: deterministic substring check
  catches ≥80% of cases the LLM checker caught at zero LLM cost.
  Acceptable lower-bound for the trade.
- **What should remain unchanged**: chapter-plan-checker;
  halluc-ungrounded; deterministic validation; downstream rewrite
  routing.

### Recommendation R7: Freeze Phase 7 ApprovalPolicy expansion until a runtime path produces or consumes a proposal in normal drafting

- **Layer optimized**: process — corresponds to O1.
- **Exact proposed change**: status-flag L074, L075, L076, L077, L078
  as "stable; no expansion lane" in `docs/decisions.md`. Refuse new
  proposal `kind`s, new replay sources, new policy tiers, and the
  external-CI promotion guard until a non-fixture novel exhibits a
  proposal flow end-to-end (produced by a runtime checker, reviewed
  by an operator, applied via the approval-policy engine, with the
  outcome routed through `proposal_resolution_outcomes`).
- **Expected storytelling benefit**: indirect — frees the largest
  single review-attention budget item in the repo. Named target:
  the upstream planning methodology lane (current-state §Active Work)
  gets uncontested headroom.
- **Downstream risks**: a future autonomy lane has to thaw the freeze.
  Acceptable; the freeze is a status flag, not a deletion.
- **How to test it cheaply**: doc edit + lane-queue revision.
  Cost: free.
- **What data would prove value**: 30 days post-freeze, a count of
  Phase 7 commits and discussion-volume confirms attention has
  shifted. Stop signal: a real operator-driven proposal flow that
  cannot be supported by the frozen substrate.
- **What should remain unchanged**: all existing Phase 7 code; the
  local promotion-guard tier; all existing tests.

### Recommendation R8: Tighten reference-resolver trigger from 24-phrase English-language match to entity-name match

- **Layer optimized**: L3 (reference resolution) — corresponds to O8.
- **Exact proposed change**: replace the `IMPLICIT_MARKERS` array
  in `src/agents/writer/reference-resolver.ts:28–35` with a check
  that the beat description contains a noun phrase exact-matching a
  known character or location name from the world bible (case-
  insensitive, word-boundary). If no entity is named, skip the resolver
  entirely (zero LLM call). If an entity is named, run the resolver
  with the entity as the topic anchor.
- **Expected storytelling benefit**: indirect — fewer reference-resolver
  calls; faster drafting. Named target: cohort attribution stops
  being polluted by "did the resolver fire?" variance.
- **Downstream risks**: legitimately implicit-reference beats that
  don't name an entity ("after the conversation we had earlier") get
  no resolver assist. Mitigation: small operator-review on 4 chapters
  comparing prose semantic-review lows pre/post.
- **How to test it cheaply**: 4-chapter A/B (current trigger vs entity-
  match trigger). Cost: ~$0.20.
- **What data would prove value**: resolver fire rate drops ≥40%;
  semantic-review lows hold steady; per-chapter cost drops measurably.
- **What should remain unchanged**: resolver schema; downstream
  background-injection rendering; the resolver's output shape.

---

## Open questions and notes

1. **Are the eight default-off flags the right inventory?** This audit
   counted: `scenePlanContractV1`, `sceneCallWriterV1`,
   `writerExpansionMode`, `sceneSatisfactionCheckerV1`,
   `lintProseEditProposals`, `editorialBeatCoverageProposals`,
   `continuityEditorialFlagProposals`, `qualityRedraftEnabled`. Plus
   `factRoleContextPolicy="role-aware"` (A/B-only). Plus
   `nativePlanningContractV1=true` (default-on but with seed-override
   rollback path). The pattern in §1 O11 is "schema field exists ahead
   of consumer"; would benefit from a single audit-and-status table
   in `docs/current-state.md`.

2. **Does the `enrichOutlineIds` post-mapper pass produce IDs that
   downstream code relies on as immutable?** The strict variant of
   `chapterOutlineSchema` exists for the audit path
   (`generate-from-outline`). Drafting uses the permissive variant.
   The audit didn't trace whether ID stability is contractually
   guaranteed across replay vs live runs.

3. **The decision-log meta-pattern:** L93, L94, L95, L96, L97, L98
   shipped in two days (2026-05-09). All six are scene-substrate
   slices, all default-off or warning-only. This is high commit volume
   and low promotion volume. Worth examining as its own pattern in a
   session retrospective.

4. **The autopsy's R11 (operator-labeled oracle dataset) is the
   gating dependency for half the recommendations across all four
   docs.** R11 is the right work. The wrong move is treating R11
   as one of N parallel recommendations; it is *the* recommendation
   that unblocks four others. Recommend re-shaping the autopsy R-list
   so R11 is the prerequisite header, not a co-equal sibling.

5. **The user's standing question — where is the harness spending
   complexity budget that doesn't pay back?** The §1 ranking proposes
   the answer in priority order: O1 (Phase 7) is the largest single
   over-build; O2 (corpus extractors masquerading as planner agents)
   is the highest leverage to fix; O15 (writer-prompt ID rendering) is
   the cheapest concrete win. If the user has time for one removal,
   start with O15 (this is autopsy R7 + this artifact's R1) — it is
   reversible, byte-parity-bounded, and frees prompt budget for the
   scene-contract work the rest of the artifact set wants to do.

---

## What this artifact does NOT recommend

Mirroring the discipline of the four prior artifacts, but inverted:

- No new diagnostics. Every recommendation in §5 removes or freezes.
- No new schema fields. Three of the eight recommendations (R3, R4, plus
  parts of R1) remove fields.
- No new agents.
- No new flags.
- No new packs.
- No new prose-side judges promoted from fixture-only.
- No re-running of retired paths (per CLAUDE.md Strategic Constraints).
- No expansion of UI surfaces.
- No re-calibration of warning-class checkers.

The single exception is the deterministic substring-presence check
proposed in R6 as a replacement for the LLM functional-state checker.
It is additive in code volume but subtractive in LLM-call count and
operator-review noise; counted as net subtraction.

---

## Sources

Local docs read in full or substantial part:

- `CLAUDE.md`, `AGENTS.md`, `docs/current-state.md`, `docs/decisions.md`,
  `docs/sessions/lane-queue.md`.
- `docs/sessions/2026-05-10-runtime-drafting-evidence.md`.
- `docs/authoring-methodology-hypotheses.md`.
- `docs/research/opus-harness-autopsy.md`,
  `docs/research/opus-craft-market-synthesis.md`,
  `docs/research/opus-method-pack-candidates.md`,
  `docs/research/opus-semantic-judge-plan.md`.
- `output/novel-1778411555121/chapter-1.md`,
  `output/novel-1778411555121/chapter-2.md`,
  `output/novel-1778411555121/harness.log`.

Code surfaces inspected:

- `src/agents/planning-state-mapper/{schema.ts, context.ts,
  state-mapper-system.md}`.
- `src/agents/planning-plotter/schema.ts`.
- `src/agents/planning-beats/schema.ts`.
- `src/agents/writer/{schema.ts, beat-context.ts, beat-context-render.ts,
  character-context.ts, reference-resolver.ts}`.
- `src/agents/structure-*/`.
- `src/schemas/shared.ts`, `src/schemas/planning-directives.ts`.
- `src/harness/{ids.ts, story-refs.ts, plan-readiness.ts}`.
- `src/canon/{approval-policy.ts, approval-policy-replay.ts,
  editorial-proposal.ts, planning-edit-proposal.ts, proposal-envelope.ts}`.
- `src/db/{approval-policy-replay.ts, proposal-envelopes.ts,
  proposal-resolution-outcomes.ts}`.
- `src/config/pipeline.ts`.
- `src/models/roles.ts`.
- `scripts/approval-policy-{promotion-guard,replay-report}.ts`.

User memory entries cited:

- `feedback_dont_calibrate_noisy_llm_checkers`
- `project_world_bible_architecture_priority`
- `project_genre_flexibility`
- `project_context_engineering_priority`
- `project_fine_tune_free_direction`
- `project_fantasy_genre_focus`
- `feedback_pilot_checkers_in_production`
- `feedback_priming_suppression_ab`
- `feedback_continuity_deprioritized`
- `feedback_style_primer_salvatore_only`
- `feedback_no_overwrite_runs`
- `feedback_document_conclusions`
- `feedback_gold_stability_first`
