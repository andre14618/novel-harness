# Novel Harness

AI-assisted novel creation harness. Deterministic code drives flow; LLMs are leaf-node function calls. This file is the glossary — when code, docs, or PRs talk about the system, these are the names.

## Language

### Pipeline

**Novel**:
The unit of pipeline execution and the artifact it produces — one row in `novels`, one path through the phases.
_Avoid_: run, job, execution.

**Phase**:
One of five sequential states a Novel passes through: `concept | planning | drafting | validation | done`.
_Avoid_: stage, step.

**Seed**:
The user-supplied input that initiates a Novel: premise, genre, characters, chapter count, and optional pipeline overrides.
_Avoid_: prompt, brief (corpus uses "brief" for something else).

**Gate**:
A human-decision pause point in the Pipeline with three actions — approve, revise, reject — implemented today as scaffolding for future use.
_Avoid_: approval, checkpoint, prompt.

**Plan-Assist Gate**:
The specific Gate that fires when Drafting exhausts automated repair (Settle Loop + Reviser both fail), letting the author edit-plan, override, or abort.
_Avoid_: exhaustion gate, override gate.

### Plan

**Chapter Skeleton**:
The Phase-1 output of `planning-plotter` — chapter title, POV, target word count, beat list with descriptions only, no scenes or facts.
_Avoid_: outline (reserved for the expanded form).

**Chapter Plan**:
The Phase-2 expanded form of a Chapter Skeleton — beats, scenes, established facts, character state changes, knowledge changes; persisted as `ChapterOutline`.
_Avoid_: outline (informal — say `ChapterOutline` for the type, Chapter Plan for the concept), skeleton.

**World Bible**:
The global world-building artifact produced in Concept — magic systems, cultures, geography, relationships.
_Avoid_: world doc, lore.

**Story Spine**:
The high-level plot arc produced in Concept — acts, turning points, thematic throughline.
_Avoid_: outline, plot skeleton.

**Established Fact**:
A world-state assertion declared in the plan or observed in prose ("Aragorn is King," "the sword is hidden").
_Avoid_: fact (too generic), assertion.

**Knowledge Change**:
A fact a specific character learns in a chapter — character ID, knowledge text, source, falsity flag.
_Avoid_: character learning, reveal.

### Drafting

**Beat**:
A planned dramatic unit (~100 words) within a Chapter Plan — description, POV, setting, characters present, kind. Beats are drafted serially in Drafting.
_Avoid_: scene, section, paragraph.

**Beat Context**:
The selective bundle assembled per Beat before writing — Beat spec, Transition Bridge, Landing Target, Character Snapshots, Setting.
_Avoid_: context, prompt.

**Transition Bridge**:
The last 2–3 sentences of the prior Beat's prose, injected into Beat Context to maintain continuity.
_Avoid_: handoff, lead-in.

**Landing Target**:
The first sentence of the next Beat's description, injected into Beat Context to align where the current Beat must end.
_Avoid_: outro, anchor.

**Character Snapshot**:
A Beat-scoped view of a character — speech pattern, behavioral drivers, current emotional/location state, relationship to POV, doesn't-know constraints.
_Avoid_: character context, character profile.

**Settle Loop**:
The check → route-failures-to-issues → targeted-rewrite → recheck loop that runs after a Chapter Plan is checked or a Beat is written.
_Avoid_: retry loop, rewrite loop.

**Retry Context**:
The string built by `buildRetryPrompt` and appended to a Beat prompt on checker failure — prior prose, issue list, optional alignment note.
_Avoid_: retry prompt, rewrite context.

**Targeted Rewrite**:
A Beat-scoped regeneration triggered by a checker failure, carrying Retry Context.
_Avoid_: retry, redraft.

**Quality Redraft**:
A blank-context regeneration of a Beat triggered by a Detector firing (repetition or underlength), distinct from Targeted Rewrite.
_Avoid_: redraft, regenerate.

### Discipline Checks

**Adherence**:
The property "prose conforms to the Chapter Plan." Two scopes — **Beat Adherence** (per-beat, the `adherence-events` agent) and **Plan Adherence** (per-chapter, the `chapter-plan-checker` agent).
_Avoid_: validation, fidelity.

**Continuity**:
The property "prose conforms to world state" — facts, character knowledge, locations — checked by the `continuity` agent.
_Avoid_: consistency.

**Hallucination**:
The property "prose introduces no ungrounded content" — checked by `halluc-ungrounded` (corpus-agnostic) and per-writer leak checkers (e.g. `halluc-leak-salvatore`).
_Avoid_: groundedness.

**Checker**:
An LLM-based discipline agent — Adherence, Continuity, Hallucination checkers all qualify.
_Avoid_: validator, gate.

**Detector**:
A pure-code structural finding (e.g. quality detectors for repetition, underlength). No LLM involved.
_Avoid_: linter (lint is its own thing), check.

**Validator**:
The Validation phase only — diagnostic-only deterministic pass after Drafting completes. Logs issues; does not rewrite.
_Avoid_: checker.

**Reviser**:
The escalation agent (`chapter-plan-reviser`) that edits a Chapter Plan when the Settle Loop exhausts on Plan Adherence failures.
_Avoid_: editor, plan-fixer.

### Writing — Voice and Models

**Adapter**:
Any fine-tuned LoRA artifact tracked in `adapter_registry` — Voice LoRAs, Adherence SFTs, Hallucination SFTs all qualify.
_Avoid_: LoRA (informal, use Adapter), model (too generic).

**Voice LoRA**:
The subclass of Adapter trained to imprint author voice on the writer (e.g. `salvatore-1988-v3`).
_Avoid_: style adapter, tonal LoRA.

**Writer Pack**:
The per-genre runtime config (`WriterGenrePack`) that wires a Voice LoRA + system prompt + Structural Priors + Conditioning Mode for the writer.
_Avoid_: genre pack (use Writer Pack), pack.

**Structural Priors**:
Genre-specific planning constraints inside a Writer Pack — beat-kind distribution, sustain ranges, opener/closer kinds, max active characters, beats-per-chapter ranges.
_Avoid_: genre priors, structural constraints.

**Conditioning Mode**:
How example lines are sampled into a Beat prompt — `fixed` (preset always) or `rotation` (cycle per beat).
_Avoid_: example mode, sampling mode.

### Lint

**Lint**:
Deterministic prose detectors plus targeted LLM rewrites for narrow defects (cliché, hedging, emotional echo, rhythm). Distinct from Discipline Checks — Lint is style cleanup, not plan-following.
_Avoid_: linting (use Lint), prose check.

### Corpus

**Corpus**:
A published novel ingested for training, decomposed into a Bundle.
_Avoid_: training data.

**Bundle**:
A self-contained corpus artifact at `novels/<key>/` — canonical text, scenes, Corpus Beats, Briefs, training Pairs.
_Avoid_: corpus pack, dataset.

**Corpus Beat**:
A dramatic unit *extracted from* published prose during corpus decomposition. Distinct from Beat (which is *planned*).
_Avoid_: scene, beat (without the Corpus prefix — they are different domains).

**Brief**:
The metadata-only representation of a Corpus Beat — description, characters, setting, kind — paired with the original prose for training.
_Avoid_: spec, beat metadata.

**Pair**:
A `(Brief, prose)` tuple used to train a Voice LoRA. Brief is the condition; prose is the target.
_Avoid_: example, sample.

## Relationships

- A **Novel** moves through **Phases** in order: concept → planning → drafting → validation → done.
- A **Phase** may pause at a **Gate** before advancing.
- **Concept** produces a **World Bible**, characters, and a **Story Spine**.
- **Planning** produces a **Chapter Skeleton** per chapter (Phase 1), then expands each into a **Chapter Plan** (Phase 2).
- A **Chapter Plan** contains many **Beats** plus **Established Facts**, character state changes, and **Knowledge Changes**.
- **Drafting** writes prose **Beat** by **Beat**, assembling a **Beat Context** for each.
- After every **Beat**, **Beat Adherence** runs; on failure, a **Targeted Rewrite** fires inside the **Settle Loop** carrying a **Retry Context**.
- A **Detector** firing triggers a **Quality Redraft** instead of a Targeted Rewrite.
- After every chapter, **Plan Adherence** and **Continuity** run; **Plan Adherence** failures route to **Beat**-targeted rewrites; on Settle Loop exhaustion, the **Reviser** edits the **Chapter Plan** once.
- On Reviser failure, the **Plan-Assist Gate** fires.
- The **Validator** runs once after Drafting completes — diagnostic only.
- A **Writer Pack** selects a **Voice LoRA** for the writer based on the **Novel**'s genre.
- A **Corpus** is decomposed into a **Bundle** of **Corpus Beats**, **Briefs**, and **Pairs**; **Pairs** train a **Voice LoRA**.

## Example dialogue

> **Dev:** "When Beat Adherence fails on beat 4, what reruns?"
> **Domain:** "Just beat 4 — that's a Targeted Rewrite inside the Settle Loop. The Beat Context gets the Retry Context appended. We don't touch the Chapter Plan."

> **Dev:** "And if it fails three times?"
> **Domain:** "Settle Loop exhausts. Beat Adherence doesn't escalate to the Reviser — only Plan Adherence does. Beat-level exhaustion just throws."

> **Dev:** "Is the Salvatore corpus a Writer Pack?"
> **Domain:** "No — it's a Corpus, decomposed into a Bundle. The Bundle's Pairs trained the Salvatore Voice LoRA. The Writer Pack is the runtime config that *selects* that Voice LoRA when a fantasy Novel runs."

## Flagged ambiguities

- **"Beat" alone always means the planned-runtime kind.** Extracted-from-prose beats are **Corpus Beats**, never just "beats."
- **"Outline" is informal.** The persisted type is `ChapterOutline`; the concept is **Chapter Plan**. The Phase-1 stripped form is **Chapter Skeleton**, not an outline.
- **"Primer" is retired.** Howard primer methodology was retired 2026-04-16; code surfaces (`STYLE_PRIMER`, the on-demand `/tonal-pass` endpoint) survive for legacy novels but the live mechanism is **Voice LoRA** routed via **Writer Pack**. Do not introduce "primer" as a live concept.
- **"Check" the verb is overloaded.** Three nouns disambiguate: **Checker** (LLM), **Detector** (pure code), **Validator** (the diagnostic phase).
- **"Adherence" was historically used for both the property and the per-beat agent.** Resolved: **Adherence** is the property; **Beat Adherence** and **Plan Adherence** are its two scopes.
- **"LoRA" is informal.** The canonical term is **Adapter**; **Voice LoRA** is the specific sub-kind. `adapter_registry` is the source of truth.
- **"Run" is not a Novel-Harness term.** A Novel is the execution and the artifact. If those ever decouple, we'll add Run.
