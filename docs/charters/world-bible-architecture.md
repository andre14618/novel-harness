---
status: active
date: 2026-05-03
owner: andre
companion-audit: docs/checker-quality-audit-2026-05-03.md
companion-audit-cpc: docs/checker-quality-audit-2026-05-03-chapter-plan-checker.md
adversarial-review: round-1-complete-2026-05-03
experiment: 403
lane-doc: docs/sessions/2026-05-03-world-bible-architecture-step-0.md
---

# World-Bible / Character-Bible Architecture

## North Star

Move semantic responsibility upstream. Build a structured, versioned, queryable canon substrate (world bible + character bible + plot bible + canon timeline) that grows as the novel is written. Feed scoped subsets of it into the writer pre-emptively. Keep the drafting middle layer mechanical and deterministic. Move LLM semantic review to a downstream chapter-level editorial pass that flags rather than gates, with a milestone-level audit at act breaks and final draft.

## Why Now (Empirical Anchor)

This charter's "why" is established by `docs/checker-quality-audit-2026-05-03.md`. Summary of the load-bearing findings:

- **All five LLM checkers** in the drafting layer (`halluc-ungrounded`, `continuity-*`, `adherence-events`, `functional-state-checker`, `chapter-plan-checker`) measure TP rates of 0%–44% on n=23–28 production fires. Effective TP at the gate-decision level is even lower after stochasticity adjustment.
- **Chapter-plan-checker K=3 four-arm sweep** (the highest-performing LLM checker at 44% single-grader TP) showed effective TP converges to ~36% across all four practical arms (K=1 control, K=3-AND control, K=1 v2, K=3-AND v2). Only 16% of original-fire cases produced unanimous K=3 re-fires. **Operating-point tuning — prompts, voting, severity thresholds — cannot lift past break-even at this granularity.**
- **The dominant FP class is implicit-vs-explicit delivery**, appearing in 4 of 5 checkers. Root cause: per-beat / per-chapter granularity has no model of wider story state. The local `(plan, prose)` pair lacks the bible-level context that would resolve "is this a real omission or a paraphrased delivery."

This charter does **not** claim the replacement architecture works. It claims:

1. The current drafting LLM blockers are low-leverage and high-FP.
2. The replacement architecture must prove itself through shadow-mode chapter review and canon-quality evaluations *before* any current gate is retired.
3. No broad LLM checker should remain a long-term drafting blocker.

## Architecture Shape

Three layers, distinct methodologies:

| Layer | Job | Methodology | LLM role |
|---|---|---|---|
| **Upstream** (Story Development) | Build canon substrate | Structured, versioned, provenance-rich | Bounded planner calls, human-curated |
| **Middle** (Mechanical Drafting Conveyor) | Feed writer + validate structure | Deterministic only | Writer call only |
| **Downstream** (Editorial Review) | Flag, reconcile, polish | Multi-LLM chapter-level + milestone audit | Multiple judges, no gating |

## Sequencing

The plan is gated. Each step has explicit prerequisites and stop conditions; no step ships without the prior step's evidence.

### Step 0 — Bootstrap & Retrieval Prereqs

Before any new drafting architecture lands, four prerequisites must clear:

#### 0a. Retrieval reactivation (or deterministic fallback)

`embeddings: false` in `src/config/pipeline.ts:28`. Semantic retrieval was retired per `docs/context-engineering.md`. The pgvector + RRF code at `src/db/retrieval.ts` is idle. Two viable paths:

- **Reactivate semantic retrieval.** Re-enable embedding generation for canon facts/entities; validate hybrid RRF returns useful scoped subsets on novel content; calibrate retrieval against manual ground-truth queries.
- **Deterministic scoped lookup alternative.** If semantic retrieval doesn't validate, fall back to deterministic indexing on entity IDs, chapter ranges, and structured fact types — no embeddings, no similarity search. Worse retrieval quality but bounded behavior.

**Stop gate (precision + recall + token cap, not recall-only).** Retrieval cannot ship by returning the whole bible. The validation requires:

- **Labeled query set size:** ≥40 queries across at least three categories (entity-grounding, character-state-at-time, active-promises-and-payoffs). Each query has a human-curated relevant-canon-set.
- **Recall@K floor:** at K=20 retrieved facts, ≥80% of the relevant set is in the top-K.
- **Precision floor:** ≥50% of retrieved facts at K=20 are judged relevant by the same grader (i.e., precision@20 ≥ 0.50). This is what blocks the prompt-blob escape hatch.
- **Context-token cap:** retrieved-bible-per-writer-call must fit in ≤4,000 tokens after templating, and ≤6,000 tokens for editorial-pass calls. Hard cap; if precision can't fit relevant facts inside the cap, retrieval is failing.
- **Deterministic fallback scoring:** if the deterministic-lookup path is taken instead of semantic retrieval, the same metrics apply — recall@K is computed against the entity-ID/chapter-range index's hits, precision against the same labeled query set, token cap unchanged.

If any of recall@K, precision@K, or token-cap thresholds fail, retrieval is not ready — the architecture cannot ship. Returning the whole bible trivially fails the precision floor and the token cap. This is the explicit prompt-blob guard.

#### 0b. Initial bible bootstrap path

On chapter 1 of a brand-new novel, the bible is whatever the planner declared plus whatever the human curated. Define the bootstrap shape:

- **Planner-declared seed.** Existing planner output (`establishedFacts`, character profiles, world-builder JSON) populates the initial bible at chapter-1 generation time.
- **Human curation hook.** Operator can edit the bootstrap bible before drafting begins, adding/removing/marking-canonical entries.
- **Optional corpus import.** For novels in established universes (or explicit homage), import bible from corpus exemplars per `docs/todo.md` §13 source-acquisition work (Sanderson hard-magic, Erikson cosmology, etc.).

The post-draft extraction pass starts contributing on chapter 2; chapter 1's bible is bootstrap-only.

#### 0c. Explicit act/milestone planner outputs

Macro-pass review (Step 5) is gated on act-break boundaries. The current planner produces chapters + beats; act-level abstraction may be implicit only. **Verify** whether the planner emits explicit act/milestone markers; if not, add them as a small planner schema extension before Step 5 can run. This is a planner change, not architecture.

#### 0d. Canon API design

The bible needs an API surface, not just rows in a table. Required functions:

- `getCanonForChapter(chapterN): Canon` — returns the bible state as it was at the time chapter N was being written
- `getCharacterStateAt(charId, chapter, beat): CharacterState` — point-in-time character knowledge/state
- `getActivePromises(): Promise[]` — open promises with payoff target chapter
- `getEntityRegistry(): Entity[]` — full named-entity registry
- `proposeCanonUpdate(source, fact, confidence): CanonUpdateProposal` — extraction or human edit produces a proposal, not a write
- `commitCanonUpdate(proposalId, status: approved | rejected | modified)` — human or automated approval

Each function is what the writer/editor agents will actually call. This is real infrastructure, not data design.

#### 0e. Pre-Step-4 cost probe (early kill-gate)

Cost is a charter-level stop gate (see (d) below). Measuring it during Step 4 is too late — by then 4–5 weeks of Step 0/1/2/3 work have already shipped. The cost probe runs **as part of Step 0** with mock judges (or stub LLM calls returning structured fixtures) over a representative `(canon-prefix + chapter)` payload. Measure:

- cache-hit input cost per judge call (warm prefix, second through Nth call)
- cache-miss input cost per judge call (cold prefix, first call in a TTL window)
- output-token cost per judge call (output is NOT cache-discounted; this is the real ceiling)
- per-chapter cost at K=5 and K=10 judges
- per-chapter cost on V4 Flash vs V4 Pro

Probe scope: ~50 simulated judge calls against representative payloads. Cost: ~$0.10–$0.50.

**Stop gate.** If projected per-chapter editorial cost at K=5 with V4 Flash exceeds $0.50/chapter, the architecture is uneconomic at production scale (a 50-chapter novel would cost $25+/run for editorial alone, before drafting). Either reduce judge count, escalate to V4 Flash only, redesign the prefix, or kill the charter. Decision happens before Step 1 starts, not after Step 4 finishes.

**Step 0 ships as a single decision record + a working retrieval surface + a stub canon API + a cost-probe results doc. No bible content yet.**

### Step 1 — Canon Substrate

Build the structured, versioned canon. Schema requirements per fact:

- **source:** which artifact produced this fact (planner-output, state-mapper, post-draft-extraction, human-edit, corpus-import)
- **chapter/beat/version:** when this fact entered canon, and which version of the extractor/planner produced it
- **confidence:** extractor-reported confidence (0–1) plus human-marked-canonical flag
- **human approval status:** auto-extracted, human-approved, human-edited, contested
- **supersession history:** if this fact superseded a prior one, link to the prior version
- **planned-vs-observed distinction:** facts that were *planned* (planner asserted as canon) vs facts that were *observed in approved prose* (extracted post-draft). These have different trust levels.
- **conflict handling:** when two sources disagree on the same fact slot, what's the resolution rule?

The substrate is **versioned**, not just timestamped. Retroactive correction (human edits a fact in chapter 12) needs to be evaluable: did the edit invalidate prose in earlier chapters? Versioning + supersession history lets the editorial layer answer this.

**Stop gate.** Schema must support `getCanonForChapter(N)` returning what was canonical *at the time chapter N was written*, regardless of subsequent edits. If the schema can't do that, redesign before populating.

### Step 2 — Bible-Input Integrity

This step is load-bearing. **Bad canon makes downstream "full-context" review worse than current checkers**, because reviewers will trust a corrupt bible and miss real issues.

Audit and guard every input that feeds canon:

- **planner** — TP/FP-grade planner output for established_facts, knowledge_changes, character_state_changes
- **planning-state-mapper** — TP/FP-grade obligation placement
- **planning-state-repair** — TP/FP-grade repair operations
- **human edits** — provenance + audit trail (this is structurally trusted; no LLM grading needed)
- **post-chapter extraction** — TP/FP-grade the extractor against manual ground-truth bible from known novels (Salvatore decomposition is the gold-standard reference)
- **chapter-plan-checker residue** — if it remains in any form, grade it

Each source needs a measured precision/recall before it's allowed to write canon. Sources below threshold either get fixed, get a human-in-the-loop approval gate before their writes commit, or get their canon writes excluded.

**This is the same TP/FP grading methodology as the audit; same Sonnet-subagent + sample-grading pipeline. New ground-truth requirement: a manual canon for at least one known novel (likely Salvatore-decomposed) to grade extractors against. The grader must judge against the *complete* set of facts the chapter contains, not just sample what the source produced — this is what makes the recall measurement meaningful.**

**Stop gate (precision + recall + F1, with sample-size floor).** No source writes to canon until it clears all of:

- **Sample size floor:** ≥30 graded items per source, drawn from at least 3 distinct chapters/contexts.
- **Coverage expectation:** the grader's complete-fact reference set for each graded chapter must enumerate every canon-eligible fact the chapter establishes, so missing facts are visible in the recall denominator.
- **Precision floor:** ≥80% of the source's emitted canon facts judged correct.
- **Recall floor:** ≥60% of the chapter's canon-eligible facts are emitted by the source.
- **F1 floor:** ≥0.70 (compound metric; sources can trade precision/recall but not collapse either).

Below any of these, the source either gets fixed, gets a human-in-the-loop approval gate before writes commit, or has its canon writes excluded. A source writing 1 correct fact and omitting 29 (precision=1.0, recall=0.03, F1=0.06) fails outright — the F1 floor catches the precision-only escape hatch.

### Step 3 — Mechanical Middle (Target-State Preparation)

**Step 3 is target-state design + mechanical preparation, not retirement.** The current LLM drafting blockers remain in place during Step 3 and Step 4 shadow-mode rollout. Retirement happens only after Step 4's shadow-mode validation gate clears (see Step 4 acceptance criteria). This step builds the deterministic-only middle layer *alongside* the existing gates so the architecture is ready to switch over once shadow-mode validates.

**Build:**

- deterministic context assembly (writer packets per §0d)
- stable-ID validation
- schema checks
- exact obligation coverage (deterministic, fixture-driven)
- prose integrity (the L40–L72 ladder surface — already exists, preserved)
- payoff-link structural checks (deterministic — already exists, preserved)
- retry plumbing
- cache-shaped context packets (stable prefix → curated bible slice → chapter contract → volatile beat input)

**Targeted for retirement at Step 4 cutover** (NOT during Step 3):

- `halluc-ungrounded` per-beat blocker
- `continuity-*` chapter-level blocker
- `adherence-events` per-beat blocker (including the `obligations_count ≥ 1` interim narrow option — under this thesis even narrow LLM gates in the middle are smell-tests for unfinished upstream work)
- `functional-state-checker`
- `chapter-plan-checker` post-draft prose-vs-plan gate

These remain operational as drafting blockers throughout Step 3. Once Step 4 ships and shadow-mode validates against the criteria below, the cutover commit retires all five in a single coherent change. **No gate retires before Step 4's stop gate clears.**

### Step 4 — Chapter-Level Editorial Loop

Runs after every chapter. Inputs: full chapter prose + current canon-as-of-chapter-N + chapter contract + retrieved scoped context. Outputs: flags, never automatic blockers.

**Modules (initial set, can grow):**

- canon/entity reconciliation (post-draft NER-vs-bible diff + LLM triage; the reborn halluc surface)
- character reaction plausibility (does the chapter's character behavior match the character bible?)
- chapter-contract coverage (were the chapter's required reveals, state deltas, emotional turn delivered?)
- continuity against canon (deterministic fact-table cross-reference + LLM triage on flags)
- prose polish/repetition (rhythm, repetition heuristics + LLM polish suggestions)

**Flag triage buckets** (each flag classified by an LLM judge):

- **real issue** → operator/editor action required
- **stylistic choice** → ignore, store as negative example
- **bible update candidate** → propose canon update via `proposeCanonUpdate()`
- **human decision needed** → escalated to operator
- **polish suggestion** → optional enhancement, not load-bearing

**Adjudication semantics: how unresolved flags interact with chapter N+1 drafting.** Editorial flags do not auto-block, but unresolved flags from chapter N do affect chapter N+1's behavior. Per-bucket rule:

| Flag bucket | Default state if unresolved at start of chapter N+1 | Visible to writer at chapter N+1? |
|---|---|---|
| **real issue** | **Drafting pauses** at chapter N+1 until operator decides. Severity-weighted: a continuity-violation real issue blocks; a polish real issue does not. Severity is set by the judge module. | No — un-adjudicated real issues do not enter writer context. |
| **bible update candidate** | Drafting proceeds with the *un-updated* bible. Candidate update is held in a `pending_canon_updates` queue; only commits to canon when operator approves. | No — pending updates are not in writer context. |
| **human decision needed** | Drafting pauses if the decision affects canon (e.g., "is this fact true or not?"). Drafting proceeds if the decision is purely editorial (e.g., "do we like this stylistic choice?"). The judge module classifies which kind. | No — un-adjudicated decisions do not enter writer context. |
| **stylistic choice** | No effect on N+1. Stored in rejected-flags corpus. | N/A |
| **polish suggestion** | No effect on N+1. Stored as optional polish backlog. | N/A |

**Auto-adjudication TTL.** Unresolved flags older than 24h that have not been touched are auto-classified `human decision needed` and surfaced via the operator-summary script's stale-gate channel (matching the existing stale-gate pattern in `scripts/operator-summary.ts --stale-gates`). The pause behavior continues; the TTL just makes them visible.

**No "ghost canon."** Pending updates never appear in writer context. The bible the writer sees at chapter N+1 is exactly what's been committed. This is what prevents the editorial layer from poisoning the well with un-adjudicated extraction proposals.

**Cache economics.** A judge set runs over `(canon + chapter)` as a stable prefix. DeepSeek V4 Flash with cached-prefix pricing makes 5–10 judges per chapter economically viable in one TTL window. **Concrete cost model required:** measure cache-hit cost vs. cache-miss cost vs. output-token cost (output is not discounted) for both V4 Flash and V4 Pro on a representative chapter; estimate per-chapter pass cost at K=5 and K=10 judges. Numbers go in the Step 4 results doc.

**Shadow-mode validation gate (load-bearing, sample-size-floored).** Before any current drafting gate retires, the editorial loop must run in shadow against a backlog of recent accepted/rejected chapters and demonstrate:

- **Sample-size floor.** ≥30 labeled true-positive issues (cases where the current gates correctly caught a real defect) AND ≥50 clean chapters (chapters that passed cleanly under existing gates and are confirmed clean by manual review). Below either floor, the gate cannot be called — the rates below are statistically meaningless on small samples. Pulling 30 TP issues from production may require widening the window to 30+ days.
- **Catch-overlap with the existing gates:** of the labeled TPs, ≥90% are also flagged by the editorial loop. Measures whether the new layer catches what the old layer caught.
- **False-positive rate on clean chapters:** ≤30% of clean chapters get a `real issue`-bucketed flag. Measures whether the new layer is going to generate alert fatigue for operators.
- **Miss rate on labeled TPs:** ≤10% (complement of catch-overlap).
- **Bucket-precision:** of flags placed into the `real issue` bucket, ≥70% judged correct by independent review. (A high miss rate is recoverable — operators can still find issues. A low bucket-precision is not — operators stop trusting the layer.)

Acceptance: all five thresholds clear simultaneously before any existing gate retires. Below any threshold, fix the editorial layer first; do not retire gates on faith.

### Step 5 — Milestone / Novel-Level Review

Runs at act breaks (per §0c) and full-draft.

**Modules:**

- arc consistency (character arcs, theme arc, plot arc against bible)
- promise/payoff closure (open promises from `getActivePromises()` resolved at appropriate beats?)
- thematic drift (does the novel's theme as written match the planned theme?)
- macro pacing (chapter-length distribution, scene-length distribution, tension curve)
- repeated prose habits (cross-chapter repetition that chapter-level review doesn't catch)
- unresolved thread inventory (any planned threads with no payoff?)

Outputs: same flag triage as Step 4. Milestone-level flags can propose larger interventions (re-plan an act, rewrite a chapter, drop a thread) that chapter-level flags cannot.

### Step 6 — Preference / Feedback Corpora (Four Streams)

Each editorial decision feeds a different agent. Do not collapse these into one bucket:

| Stream | Source | Consumer | Use |
|---|---|---|---|
| **rejected flags** | editorial loop flagged it; operator said "not a real issue" | future editor/reviewer agent | few-shot context: don't flag patterns like this |
| **accepted/modified flags** | editorial loop flagged it; operator accepted or modified the rewrite | future editor agent | few-shot context: this is what good catches/fixes look like |
| **human canon edits** | operator edited a canon fact directly | planner / context builder | signal that upstream substrate was missing or wrong; informs future planner outputs |
| **polish edits** | operator approved a polish suggestion or wrote their own | prose polish modules | few-shot for prose-style preferences |

Each stream is its own corpus, versioned, with provenance. Corpora become few-shot context for the relevant agents on subsequent chapters; if/when a stream accumulates sufficient signal, it *could* feed DPO training under a separate decision (not part of this charter).

## Anti-Patterns Explicitly Called Out

1. **"Giant prompt blob" bible.** The bible's leverage is in being structured, queryable, scoped. If retrieval breaks down to "concatenate everything we know into the system prompt," we've recreated the same ambiguity at larger scale. Step 0a's stop gate explicitly guards against this.
2. **Bad canon as trusted truth.** The editorial layer trusts the bible. If Step 2 doesn't gate canon writes by precision, the editorial layer becomes a high-confidence noise generator. Worse than current checkers because operators will believe its output.
3. **Skipping shadow-mode validation.** Retiring current gates before the editorial layer proves itself is faith-based architecture. Step 4's validation gate is non-negotiable.
4. **Single feedback bucket.** Collapsing the four feedback streams into one corpus mixes signals that should inform different agents. Don't.
5. **LLM committees inside drafting.** Multi-LLM judging is fine downstream where it doesn't gate generation. Inside drafting it's the same operating-point treadmill the audit already refuted.

## What This Retires

| Surface | Status under charter |
|---|---|
| `halluc-ungrounded` (per-beat LLM blocker) | retired Step 3; reborn as Step 4 canon/entity reconciliation module |
| `continuity-state` / `continuity-facts` | retired Step 3; reborn as Step 4 continuity module |
| `adherence-events` (per-beat LLM blocker) | retired Step 3; chapter-contract coverage subsumes |
| `functional-state-checker` | retired Step 3; bible-extraction (Step 2) subsumes |
| `chapter-plan-checker` (post-draft prose-vs-plan LLM) | retired Step 3; chapter-contract coverage subsumes |
| Prose integrity / lint (deterministic) | preserved as drafting blocker |
| `payoff-link` (deterministic) | preserved as drafting blocker |
| `chapter-plan-reviser` | preserved if chapter-plan-checker has any drafting role; otherwise retired |

## Cost & Schedule Envelope

This is multi-week, charter-class scope. Rough size (informational, not commitment):

- Step 0: ~1 week (retrieval reactivation is the dominant cost)
- Step 1: ~1 week (schema + canon API stub)
- Step 2: ~2 weeks (audit each input source; build human-in-the-loop hook)
- Step 3: ~3–5 days (mostly subtractive code work)
- Step 4: ~2 weeks (initial module set + shadow-mode validation)
- Step 5: ~1 week (after Step 4 lands)
- Step 6: ~3 days (storage + provenance; agents consume corpora as they grow)

Total: ~6–8 weeks of focused engineering. Parallelizable across some steps once Step 0 lands. Steps 0 + 1 + 2 are gating; Step 3 + 4 can run in parallel after Step 2 ships.

**Cost ceiling for the editorial layer at runtime:** TBD, gated on the concrete cost model in Step 4. Charter does not commit to an architecture that costs more per-chapter than the current pipeline + integrity-ladder maintenance.

## Stop Gates

Charter-level stop gates that can pause or kill the architecture:

- **(a) Retrieval doesn't validate** at Step 0a → architecture cannot ship; revisit deterministic-only fallback or kill charter.
- **(b) Bible-input integrity below threshold** at Step 2 → no canon writes from sub-threshold sources; if no source clears, charter is unworkable.
- **(c) Shadow-mode validation fails** at Step 4 → editorial layer is not ready; current drafting gates remain; iterate Step 4 or kill charter.
- **(d) Cost model exceeds envelope.** Primary measurement at §0e pre-Step-4 cost probe (early kill-gate before Step 1 starts); confirmed against real production payloads at Step 4. If §0e projects per-chapter cost above $0.50 at K=5 with V4 Flash, reduce judge count, redesign prefix, or kill charter. If Step 4 measurement diverges materially from §0e projection, re-evaluate.
- **(e) Independent reviewer rejects the architectural premise** (audit reviewer brief, currently in flight) → return to architectural drawing board before Step 0 starts.

## Charter Prerequisites Before Implementation Starts

These exist outside the step-by-step plan and must clear before Step 0:

1. **Independent reviewer audit complete.** The reviewer brief from `docs/checker-quality-audit-2026-05-03.md` round 1 returned 2026-05-03; HIGH and MEDIUM findings have been addressed in the charter. Round 2 (post-fix) is optional but recommended before promotion.
2. **Charter audit findings round 1 addressed.** The charter has been updated to address: HIGH retrieval gate (precision + recall@K + token cap, not recall-only); MEDIUM Step 2 precision-only gate (now precision + recall + F1 + sample size + coverage); MEDIUM Step 3 retirement wording (now target-state preparation, retirement deferred to Step 4 cutover); MEDIUM Step 4 adjudication semantics (per-bucket rules + auto-adjudication TTL + no-ghost-canon rule); MEDIUM cost-gate timing (now §0e pre-Step-4 cost probe); LOW Step 4 sample-size floor (now ≥30 TPs + ≥50 clean chapters); LOW experiment bookkeeping (this list).
3. **Decision record committed.** `docs/decisions.md` §"Checker quality audit (2026-05-03)" landed 2026-05-03. ✓
4. **Source-acquisition for corpus exemplars** (`docs/todo.md` §13). Identifying 3–5 established-author sources for the bible-extraction calibration ground-truth set. Can run in parallel with Step 0 but must complete before Step 2 calibrates.
5. **Charter experiment row + lane doc.** Per CLAUDE.md commit/experiment discipline, every tracked work item goes in the DB via `harness.experiments.createTuningExperiment("charter", ...)` before any code lands. The frontmatter `experiment: TBD-charter-row-required-before-step-0` field gets populated with the actual row ID once created. A session/lane doc (`docs/sessions/<date>-world-bible-architecture-step-0.md`) captures the goal/measurable signal/stop gates per the session-start contract before Step 0 work begins.
6. **User-explicit charter approval.** This charter is `proposed`; user must promote to `active` before Step 0 starts.

## Companion Documents

- `docs/checker-quality-audit-2026-05-03.md` — empirical anchor (why now)
- `docs/checker-quality-audit-2026-05-03-chapter-plan-checker.md` — chapter-plan-checker companion + K=3 sweep
- `docs/decisions.md` §"Checker quality audit (2026-05-03)" — directional decision record
- `docs/lessons-learned.md` §"Checker Audit Methodology" — methodology lessons from the audit
- Memory: `project_world_bible_architecture_priority.md` — standing user direction

## Status

- **Proposed**, not active.
- Open for adversarial review (as a unit) before promotion.
- No code changes in flight.
- Owner: andre.
