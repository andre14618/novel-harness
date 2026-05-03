---
status: active
updated: 2026-05-03
role: operating-model
charter: docs/charters/world-bible-architecture.md
---

# World-Bible Operating Model

This document is the compact mental model for the active world-bible architecture. The detailed charter remains `docs/charters/world-bible-architecture.md`; this file explains how the pieces fit together during a Novel.

## One-Sentence Model

The harness maintains a structured, versioned Canon as the Novel is written; each chapter gets one deterministic Chapter Bundle from the committed Canon Snapshot; the writer and post-draft reviewers reuse that same bundle; approved post-draft discoveries roll forward into the next Canon Snapshot.

## Status

This is the target architecture now being built, not the fully deployed runtime. The deterministic Chapter Bundle proof of concept has cleared charter §0a on the Salvatore fixture. The next load-bearing work is the Step 1 Canon substrate: storage, versioning, approvals, and production adapters.

## Terms

- **Canon:** the structured operational source of truth. It includes World Bible material, character state, entity registry, established facts, knowledge changes, story promises, and timeline data.
- **Canon Snapshot:** the committed Canon view available at a specific chapter/version. Pending proposals are excluded.
- **Chapter Manifest:** the chapter-level scoping input derived from the Chapter Plan: POV, present characters, named entities, and any explicit includes/excludes.
- **Chapter Bundle:** the deterministic L1 packet assembled from a Canon Snapshot plus a Chapter Manifest for one chapter. It is byte-identical for the same inputs and carries a packet hash.
- **Canon Proposal:** a candidate Canon change from post-draft extraction, human edit, or editorial review. It is not Canon until committed.
- **Editorial Flag:** a post-draft finding for an operator/editor. It may become a Canon Proposal, a real issue, a stylistic choice, or a human decision.

## Chapter Lifecycle

### 1. Bootstrap Chapter 1

Before chapter 1, the initial Canon comes from planner-declared material, the Concept-phase World Bible, character profiles, the Chapter Plan, optional human curation, and optional corpus/import material.

Chapter 1 is special: post-draft extraction has not contributed yet. Its Canon Snapshot is bootstrap-only.

### 2. Build The Chapter Bundle

For chapter N, deterministic code asks the Canon substrate for the Canon Snapshot as of chapter N and combines it with the Chapter Manifest.

The output is one Chapter Bundle. It contains the chapter-relevant slice of Canon: established facts, entity rows, latest character states, active promises/payoffs, and chapter contract material.

The bundle is intentionally generous. Recall matters more than precision; extra committed Canon is acceptable when it preserves deterministic reuse.

### 3. Draft With Stable Context

The writer receives the Chapter Bundle as L1, role instructions as L2, and the local Beat task as L3.

L3 changes beat by beat because prior accepted prose grows within the chapter. L1 does not change within the chapter. That is what lets provider prefix caching reuse the expensive Canon prefix without starving the writer of local continuity context.

### 4. Review After The Chapter

After chapter prose exists, downstream editorial modules review the whole chapter against the same Chapter Bundle the writer consumed.

Reviewers flag issues; they do not automatically rewrite Canon and they do not become broad drafting blockers. Initial review modules include canon/entity reconciliation, character reaction plausibility, chapter-contract coverage, continuity against Canon, and prose polish/repetition.

### 5. Propose Canon Updates

Post-draft extraction and editorial review may produce Canon Proposals: new established facts, knowledge changes, character-state changes, promise setup/payoff changes, or corrections to existing canon facts.

Canon Proposals are pending until adjudicated. Pending proposals never enter writer context.

> **Step 1 substrate scope (2026-05-03):** the live `proposeCanonUpdate` / `resolveProposal` lifecycle in `src/canon/api.ts` covers `CanonFact` proposals only (every kind of `FactKind`: `established_fact`, `knowledge_change`, `character_state` (as a fact), `promise`, `payoff`). New `Entity`, `CharacterState`, and `StoryPromise` records enter canon via direct seed (planner output, post-draft extraction with operator approval) — not through the proposal queue. Extending the proposal type to cover those object kinds is a follow-on; until that lands, "Canon Proposals" in the operating model means CanonFact proposals specifically.

### 6. Commit Or Reject Proposals

Approved proposals become part of the committed Canon. Edited proposals become committed Canon with operator modifications. Rejected or contested proposals stay out of writer context.

This is the no-ghost-canon rule: chapter N+1 sees exactly the committed Canon Snapshot, not unreviewed extraction output.

### 7. Build The Next Chapter From The New Snapshot

For chapter N+1, the harness assembles a new Chapter Bundle from the updated Canon Snapshot and the next Chapter Manifest.

The Chapter Bundle changes across chapters because Canon changes across chapters. Within a chapter, the bundle stays byte-identical across writer beats and downstream reviewers.

## Cache Shape

Every writer and reviewer call is assembled in the same cascade:

```text
L1: Chapter Bundle          same bytes for the chapter
L2: role instructions       stable per role
L3: volatile local task     Beat task, prior prose, chapter prose, concern detail
```

The cache does not build the Chapter Bundle. The harness builds the Chapter Bundle, then places it first so provider prefix caching can reuse it.

The `packetHash` proves which L1 packet a call consumed. Writer and reviewer provenance should show the same packet hash for the same chapter.

## Deterministic Versus LLM-Backed

Deterministic code owns:

- Canon Snapshot lookup
- Chapter Manifest interpretation
- Chapter Bundle assembly
- stable ordering and packet hashing
- no-ghost-canon filtering
- structural checks and schema validation

LLMs may help with:

- planner output that seeds Canon
- post-draft extraction into Canon Proposals
- editorial flag classification
- prose polish suggestions

LLMs do not decide which runtime Canon packet each writer/judge call gets. That selection is deterministic.

## What This Replaces

The old center of gravity was per-beat and per-chapter LLM Checkers trying to catch semantic failures during Drafting. The new center of gravity is upstream Canon quality plus downstream chapter-level Editorial Review.

Existing Checkers may remain operational during rollout, but they are not the strategic architecture. They retire or demote only after the post-draft layer clears shadow-mode validation.

## What This Is Not

- Not a giant whole-bible text dump into every prompt.
- Not per-query semantic retrieval at runtime.
- Not an LLM rewriting the whole bible after each chapter.
- Not automatic Canon mutation from generated prose.
- Not a reason to remove writer-local prior prose from L3.

## Validation Gates

The architecture advances only through measured gates:

- **§0a deterministic bundle validation:** one Chapter Bundle per chapter, stable packet hash, high recall against labeled canon queries, precision/token size as observability.
- **Step 1 Canon substrate:** schema must return what was canonical at the time chapter N was written, even after later edits.
- **Step 2 bible-input integrity:** every Canon-writing source needs precision/recall/F1 evidence before direct writes are trusted.
- **Step 4 shadow-mode review:** post-draft Editorial Review must catch enough real issues without unacceptable false-positive load before current drafting gates retire.

## Implementation Map

- `src/canon/api.ts` — current Canon API stubs; Step 1 fills the substrate behind these interfaces.
- `src/canon/bundle.ts` — deterministic Chapter Bundle assembly and packet hash.
- `src/canon/scope.ts` — deterministic scoping rules for Chapter Bundles.
- `src/canon/recall-validation.ts` — deterministic recall validation harness for §0a.
- `tests/canon/fixtures/` — Salvatore proof-of-concept Canon and query fixtures.
- `docs/charters/world-bible-architecture.md` — detailed charter, gates, and rationale.

## Next Load-Bearing Work

Build Step 1 Canon substrate design before deeper runtime wiring. It must settle storage, versioning, approval status, committed-only reads, provenance for character states and promises, and the production `CanonSource` adapter used by Chapter Bundle assembly.
