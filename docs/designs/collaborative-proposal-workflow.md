---
status: draft
updated: 2026-05-03
role: design
charter: docs/charters/world-bible-architecture.md
session: docs/sessions/2026-05-03-collaborative-proposal-workflow-plan.md
depends-on:
  - docs/designs/canon-substrate-step1.md
  - docs/sessions/2026-05-03-step-2c-live-planner-semantic-labeling.md
---

# Collaborative Proposal Workflow

## Summary

Use **proposal flow** as the shared interaction model for planning, Canon ingest, editing, and autonomy.

The user-facing product should feel collaborative: the author directs ideation, world-building, plot adjustment, and editorial judgment through conversations and scoped review cards. The under-the-hood mechanics should remain deterministic: stable IDs, provenance, version hashes, proposal status, safe patch application, and no pending content entering writer context. Autonomous mode should use the same proposal mechanics with a different approval policy, not a separate pipeline.

This plan deliberately avoids making planner direct auto-commit a prerequisite. Planner-origin state can become **pending proposals** once it is mechanically proposal-safe. Promotion to fully automatic committed Canon remains a later optimization that requires precision/recall/F1 evidence.

## Current Assets

The repo already has enough pieces to make this incremental.

| Surface | Current file(s) | Useful property | Gap |
|---|---|---|---|
| Planning chat | `src/orchestrator/novel-routes.ts` `/api/novel/director/chat`; `ui/src/components/DirectorChat.tsx` | Human can brainstorm with a Planning Director before generation. | Conversation output only compiles to directives; it is not part of a durable proposal/review model. |
| Directive extraction | `planning-extractor`; `PlanningDirectives` | Transcript can become structured planner constraints. | No review history or proposal provenance beyond local UI state. |
| Artifact adjustment | `/api/novel/:id/adjust`; `artifact-adjuster`; `ArtifactPreviews.tsx` `AdjustPanel` | LLM proposes world/character/spine patches and UI applies them. | Patches are transient, “apply all” only, no version precondition, no proposal queue, no per-patch accept/reject/modify. |
| Planner stable IDs | `chapter_outlines.outline_json`; `src/harness/ids.ts`; `src/canon/planner-canon-delta.ts` | Facts/knowledge/state carry stable IDs and obligations reference them. | IDs are not yet preserved into Canon proposals/writes. |
| Canon substrate | `src/canon/api.ts`; `src/harness/canon-substrate.ts`; `src/db/canon-substrate.ts`; `sql/035*`; `sql/036*` | Proposal lifecycle exists and committed Canon is versioned. | Proposal type is `CanonFact`-only, no operator review UI, no planner proposal writer wired. |
| Gate/review pattern | `GatePanel`, `PlanAssistPanel`, `decideGate` routes | Human approve/revise/reject pattern exists in product. | Pattern is gate-specific, not generalized to planning/Canon/edit proposals. |
| LLM telemetry | `llm_calls`, `pipeline_events`, trace UI | Autonomous/eval runs can be audited. | Proposal decisions are not yet first-class telemetry. |

## Core Thesis

The system should distinguish four concerns that currently overlap.

| Concern | Question | Owner | Output |
|---|---|---|---|
| Mechanical integrity | Is the artifact structurally valid and ID-safe? | Deterministic code | Pass/fail, warnings, proposal-safe flag |
| Adherence | Did prose satisfy the local beat/chapter contract? | Narrow checker or editorial module | Issue or edit proposal |
| Canon ingest | Should this statement enter committed Canon? | Human/LLM review policy | Canon proposal decision |
| Editorial direction | What should change for taste, intent, clarity, pacing, or continuity? | Human + LLM editor | Scoped artifact/prose proposal |

The overlap is reduced by making semantics explicit. If the question is “is this true, useful, duplicate, too broad, or worth committing,” it belongs in proposal review, not in a deterministic validator and not in adherence.

## Vocabulary

| Term | Meaning |
|---|---|
| Proposal | A proposed change with target, evidence, provenance, status, and an apply/commit path. |
| Proposal envelope | Common UI/API projection for all proposal kinds. It is not necessarily one physical table in the first slice. |
| Artifact proposal | Proposed patch to planning artifacts such as world bible, characters, story spine, chapter outlines, or directives. |
| Canon proposal | Proposed committed Canon fact/state/knowledge/promise. Existing substrate already supports `CanonFact` proposals. |
| Prose edit proposal | Proposed patch against draft prose, anchored by chapter/version/span or beat. |
| Editorial flag proposal | A downstream editorial issue that may become a prose edit, Canon update, ignored style choice, or human decision. |
| Approval policy | The mode-specific rule deciding whether a proposal waits for human review, auto-applies, or stays shadow-only. |
| Proposal-safe | Mechanically safe to create as pending proposal. This does not mean semantically safe to auto-commit. |
| Auto-commit-safe | Semantically validated enough to commit without human review under a declared policy. |

## Proposal Envelope

The first implementation should not start with a universal table migration. Start with a shared TypeScript projection used by UI and services, then persist each proposal kind in the smallest appropriate backing store.

```ts
interface ReviewProposalEnvelope {
  id: string
  kind: "artifact_patch" | "canon_update" | "prose_edit" | "editorial_flag"
  novelId: string
  target: ProposalTargetRef
  source: ProposalSourceRef
  status: "pending" | "approved" | "rejected" | "modified" | "shadowed" | "expired"
  risk: "mechanical" | "low" | "medium" | "high"
  summary: string
  rationale: string
  evidence: ProposalEvidence[]
  payload: unknown
  precondition: ProposalPrecondition
  policyRecommendation: ProposalPolicyRecommendation
  createdAt: string
  resolvedAt?: string
  resolvedBy?: "human" | "policy" | "script" | "test"
}
```

Target references should be stable and machine-checkable.

| Target kind | Required target fields |
|---|---|
| Planning directive | directive field path, current directives hash |
| World bible | world record id, field path, current artifact version/hash |
| Character | character id, field path, current artifact version/hash |
| Story spine | spine field path, current artifact version/hash |
| Chapter outline | chapter number, outline id/hash, optional beat id/source item id |
| Canon fact | logical Canon id or proposed new id, current canon generation |
| Prose span | chapter number, draft version, span offsets or beat index, current prose hash |

Preconditions are mandatory. A proposal must fail closed if the target changed after the proposal was generated.

```ts
interface ProposalPrecondition {
  artifactVersion?: number
  artifactHash?: string
  canonGeneration?: number
  draftVersion?: number
  draftHash?: string
}
```

## Approval Policies

Modes should change policy only. The proposal generation and apply paths stay the same.

| Mode | Behavior | Intended use |
|---|---|---|
| Manual | Every semantic proposal waits for human approval. Mechanical validations can run automatically. | Collaborative writing and planning. |
| Assisted | Auto-apply mechanical/low-risk proposals; queue semantic, high-impact, or ambiguous proposals. | Normal authoring with reduced clicks. |
| Autonomous | Auto-approve proposals that pass declared deterministic and LLM-panel gates; queue or reject the rest. | Smoke tests and batch runs where speed matters. |
| Eval | Execute autonomous decisions in shadow or isolated test rows and log every decision. | Measuring whether autonomy is safe before enabling it on real projects. |

Initial policy defaults should be conservative.

| Proposal kind | Manual | Assisted | Autonomous | Eval |
|---|---|---|---|---|
| Artifact patch | queue | queue unless single-field low-risk | auto if schema-valid and precondition holds | shadow + log |
| Planner Canon proposal | queue | queue | auto only after future source-quality gate | shadow + log |
| Post-draft observed Canon proposal | queue | queue | auto only after future extractor gate | shadow + log |
| Prose edit | queue | auto only for deterministic mechanical fixes | auto for low-risk edits with tests/guards | shadow + log |
| Editorial flag | queue | bucket low-risk style as optional | auto-triage only; do not silently commit Canon | shadow + log |

## Non-Goals

- Do not replace the existing Studio UI in one pass.
- Do not retire existing drafting blockers as part of this plan.
- Do not require planner direct Canon auto-commit before wiring planner proposals.
- Do not build a custom autonomous coding supervisor inside the repo.
- Do not use fuzzy deterministic normalization for semantic deduplication.
- Do not let pending proposals enter writer Canon context.
- Do not begin with a generic proposal-table mega-migration unless a tracer bullet proves the projection layer is insufficient.

## Invariants

These are the rules that make the workflow safe.

| Invariant | Enforcement |
|---|---|
| Pending proposals never appear in writer Canon bundles. | `CanonSubstrate` reads committed-only; packet assembler uses committed snapshot only. |
| Every proposal has provenance. | Source id, model/agent name, prompt/schema version, artifact hash, chapter/beat/source item id where available. |
| Every proposal applies against a precondition. | Version/hash check before mutation; stale proposal moves to `expired` or requires regeneration. |
| Mechanical validators do not make semantic judgments. | ID graph checks return proposal-safe only, not auto-commit-safe. |
| Semantic review is explicit and auditable. | Review proposals carry evidence quotes and reviewer/model decisions. |
| Human edits are structurally trusted but still versioned. | `source=human-edit`, approval status `human-edited`, transactionally committed. |
| Autonomous decisions are policy decisions. | Same proposal rows/cards; `resolvedBy=policy` and policy version logged. |
| Eval mode is reproducible. | Freeze artifact hashes, policy version, model routes, and prompt schema versions. |

## Target User Flows

### Flow A — Collaborative Planning

1. Author opens Studio and chats with Planning Director.
2. Director asks questions and clarifies constraints.
3. Compile creates `PlanningDirectives` as it does today.
4. Directives render as reviewable cards with field-level provenance from the transcript.
5. Author edits or accepts directives.
6. Planner generates world/characters/spine/outlines from accepted directives.
7. Generated artifacts render as proposal-friendly cards, not opaque JSON.
8. Author can ask: “make the magic system harsher,” “combine these two characters,” or “make Maret more complicit.”
9. `artifact-adjuster` returns one proposal per patch, each with target field, current version hash, summary, and rationale.
10. Author accepts, rejects, modifies, or asks for alternatives per proposal.
11. Accepted artifact patches apply transactionally and refresh artifact hashes.
12. Planner source facts/knowledge/state become pending Canon proposals with stable source IDs preserved.

Success criterion: planning becomes a conversation plus review cards, not a one-shot black box.

### Flow B — Planner Canon Proposal Review

1. After planning/state mapping, deterministic audit verifies the live ID graph.
2. A service converts each planner source item into a `CanonFact` proposal.
3. `fact` maps to `kind="established_fact"`.
4. `knowledge` maps to `kind="knowledge_change"` with character id/name in `data`.
5. `state` maps to `kind="character_state"` with location/emotion/knows/doesNotKnow in `data`.
6. Proposal id and proposed fact id preserve the planner source item id where possible.
7. Provenance records source artifact, chapter, source item id, prompt/schema version, confidence, and `origin="planned"`.
8. Pending proposals are visible in review UI.
9. Approved proposals commit to Canon.
10. Rejected proposals remain as rejected examples.
11. Modified proposals commit the edited version and retain the original proposal payload.

Success criterion: planner output can feed Canon review without being auto-trusted.

### Flow C — Collaborative Editing

1. Chapter draft is produced.
2. Editorial modules run over prose plus the same deterministic chapter bundle the writer saw.
3. Each issue becomes an editorial flag proposal with evidence and suggested action.
4. Low-level deterministic lint fixes may become prose edit proposals.
5. LLM editor can produce scoped patch alternatives for a selected issue.
6. UI shows issue cards anchored to chapter, beat, prose span, and relevant Canon IDs.
7. Author accepts, rejects, modifies, or asks for alternatives.
8. Accepted prose edits apply against draft version/hash.
9. After chapter approval, observed facts can become Canon proposals.

Success criterion: editing becomes LLM-driven but scoped and reversible, with human intervention at the issue/patch level.

### Flow D — Autonomous Testing

1. Same proposal generators run under an approval policy.
2. Policy auto-approves only proposal classes that meet deterministic and configured LLM gates.
3. All decisions persist with policy version and evidence.
4. Eval mode can run the same path in shadow, isolated from committed Canon or production prose.
5. Metrics compare policy decisions against later human review or gold fixtures.

Success criterion: autonomy accelerates testing without creating a second architecture.

## Implementation Plan

### Phase 0 — Boundary Reset And Documentation

Goal: stop treating planner direct auto-commit as the next blocker.

Work:

- Update `docs/charters/world-bible-architecture.md` Step 2 language to distinguish proposal-safe from auto-commit-safe.
- Add `proposal-safe` and `auto-commit-safe` to project vocabulary.
- Move Step 2C from blocking gate to source-quality risk probe.
- Keep planner direct auto-commit as future optimization behind precision/recall/F1.

Acceptance:

- Docs state that planner-origin items may become pending proposals after mechanical validation.
- Docs state that committed Canon remains human/policy-approved only.
- No runtime behavior changes.

### Phase 1 — Planner Source Items To Pending Canon Proposals — CLEARED 2026-05-03

Status: CLEARED 2026-05-03 by `docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-1.md`. Service: `src/harness/planner-canon-proposals.ts` (pure `buildPlannerCanonProposals` + DB-writing `generatePlannerCanonProposals`). Idempotency keyed on `planner:<novelId>:<sourceItemId>:<schemaVersion>` via `INSERT … ON CONFLICT (id) DO NOTHING`. Phase-1 acceptance gates all green: 18-test harness suite + 196 canon equivalence tests passing, no-ghost-canon proven, mechanical-gate fail-closed proven, idempotency proven (re-run = 0 rows), tsc clean, recall 0.927.

Goal: create the first useful tracer bullet without a UI overhaul.

Work:

- Add a service under `src/harness/` that reads a parsed `ChapterOutline` and emits `CanonUpdateProposal` inputs.
- Reuse `runPlannerCanonDeltaAudit` as the mechanical gate.
- Convert `fact`, `knowledge`, and `state` source items into `CanonFact` proposal payloads.
- Store planner source item id in the proposed fact id and in `data.sourceItemId`.
- Preserve character id/name for knowledge/state rows in `data`.
- Set provenance source to `planner-output` or `planning-state-mapper` according to source item kind and available pipeline metadata.
- Set `origin="planned"` and `approvalStatus` through the existing proposal lifecycle, not directly on committed facts.
- Add an idempotency guard so rerunning proposal generation does not create duplicate pending proposals for the same `(novelId, sourceItemId, schemaVersion)`.

Acceptance:

- Given `novel-1777786463873`, the service creates 30 pending Canon proposals after the Step 2B mechanical gate passes.
- Pending proposals do not appear in `getCanonForChapter` or L1 bundle reads.
- Rerunning the service is idempotent.
- Existing canon substrate equivalence tests still pass.

Why this is narrow:

- It uses the existing fact proposal lifecycle because `CanonFact.kind` already covers established facts, knowledge changes, and character states.
- It does not require typed proposal tables for entities/states/promises yet.
- It does not require semantic auto-commit.

### Phase 2 — Canon Proposal Review API And Minimal UI

Goal: make pending Canon proposals reviewable.

Work:

- Add API endpoints to list pending proposals by novel/chapter/source.
- Add API endpoints to approve, reject, and modify proposals using `PostgresCanonSubstrate.resolveProposal`.
- Add a minimal proposal review panel in Studio or a dedicated Canon page.
- Show target id, kind, text, source item id, chapter, evidence/rationale when available, and current status.
- Support per-card approve/reject and edit-before-approve.
- Add stale-precondition handling if the proposal target has changed.
- Add telemetry events for proposal creation and resolution.

Acceptance:

- Operator can review planner-origin proposals from a generated outline.
- Approved proposal appears in committed Canon snapshot for later chapters.
- Rejected proposal never appears in committed Canon reads.
- Modified proposal commits edited text and records operator note.
- UI can handle dozens of proposals without forcing “apply all.”

### Phase 3 — Artifact Patch Proposal Cards

Goal: upgrade the existing `artifact-adjuster` flow without changing its model task.

Work:

- Wrap adjuster outputs in `ReviewProposalEnvelope` cards.
- Split “Apply all” into per-patch approve/reject/modify.
- Add artifact hash/version precondition to each patch.
- Add patch regeneration when preconditions expire.
- Persist adjustment conversations and proposals enough to resume the session.
- Add quick actions: accept all low-risk, reject all, ask for alternatives, explain patch.

Acceptance:

- User can collaboratively adjust world, characters, and spine one proposal at a time.
- Stale patches cannot overwrite newer human edits.
- Existing direct editable fields still work.
- No Canon changes are implied by artifact patch approval unless explicitly proposed separately.

### Phase 4 — Planning Snapshot Review Before Drafting

Goal: make pre-drafting human-in-the-loop a coherent checkpoint.

Work:

- Add a “Planning Snapshot” screen or panel that groups directives, world, characters, spine, outlines, and planner Canon proposals.
- Show mechanical health: ID graph valid, obligation coverage, duplicate IDs, unknown references.
- Allow user to lock the snapshot for drafting.
- Store snapshot hash/version once locked.
- Require redraft/replan if locked planning artifacts change.
- Allow autonomous mode to lock if policy permits and mechanical gates pass.

Acceptance:

- Drafting starts from a named planning snapshot.
- The snapshot hash appears in downstream provenance.
- Human mode can pause at this checkpoint.
- Autonomous mode can proceed through this checkpoint with a logged policy decision.

### Phase 5 — Editorial Proposal Workbench

Goal: move editing toward scoped proposals instead of opaque gate failure loops.

Work:

- Define `EditorialFlagProposal` schema with issue type, severity, evidence quotes, beat/chapter refs, Canon refs, and suggested action.
- Define `ProseEditProposal` schema with draft version, span/beat target, replacement text, and rationale.
- Convert existing deterministic lint fixes into proposal cards where useful.
- Add one LLM editorial module as a tracer bullet, preferably chapter-contract coverage or continuity-against-Canon after the writer has a bundle.
- Add patch application with draft hash precondition.
- Keep existing blockers active until editorial shadow-mode gates clear.

Acceptance:

- User can accept/reject a scoped prose edit proposal.
- Accepted edits produce a new draft version or patch record.
- Rejected proposals become negative examples.
- Editorial proposals do not silently commit Canon.

### Phase 6 — Approval Policy Engine

Goal: make manual, assisted, autonomous, and eval modes share one proposal path.

Work:

- Add `ApprovalPolicy` config with mode, policy version, allowed auto-approve classes, required checks, and max risk.
- Create a deterministic policy evaluator that returns `queue`, `approve`, `reject`, or `shadow` with reasons.
- Record policy decision and policy version on every proposal resolution.
- Add safe defaults: manual for Canon, assisted for deterministic mechanical prose fixes only.
- Add autonomous test mode that can auto-resolve proposals in isolated runs.

Acceptance:

- Same proposal can be processed manually or by policy.
- Policy cannot auto-approve high-risk semantic Canon proposals unless an explicit future gate enables it.
- Eval mode logs what it would have done without mutating committed Canon.

### Phase 7 — Autonomous Evaluation Loop

Goal: make autonomy measurable instead of vibes-based.

Work:

- Build a replay harness that runs proposal generators and policy evaluator on frozen artifacts.
- Compare policy decisions to human decisions or gold fixtures.
- Report precision by proposal kind and risk class.
- Track intervention rate: percent of proposals queued for human.
- Track downstream impact: approval rate, checker fire rate, edit churn, Canon conflict rate.
- Add a promotion rule for policy changes.

Acceptance:

- A policy change cannot ship without a replay report.
- Autonomous mode can be tested against historical novels without touching production state.
- Metrics are separated by proposal kind; Canon, artifact patches, and prose edits are not pooled.

## Minimal Tracer Bullet

The smallest useful end-to-end slice is:

1. Generate pending Canon proposals from planner source items for one existing novel.
2. List those proposals in a simple UI or CLI.
3. Approve/reject/modify one proposal.
4. Verify committed Canon snapshot includes approved/modified only.
5. Verify pending/rejected proposals do not appear in writer packet assembly.

This tracer bullet proves the architecture without touching collaborative editing, autonomous policy, or broad proposal tables.

## Tests And Guards

| Surface | Test |
|---|---|
| Planner proposal generation | Fixture converts fact/knowledge/state source items into expected `CanonFact` proposals. |
| Mechanical gate | Proposal generation refuses outlines with duplicate IDs, invalid IDs, or unknown source refs. |
| Idempotency | Running generation twice produces no duplicate pending proposals. |
| No ghost Canon | Pending/rejected planner proposals are absent from `getCanonForChapter` and L1 packets. |
| Approval lifecycle | Approve/reject/modify planner proposals through Postgres adapter and verify snapshots. |
| Stale patch guard | Artifact/prose patch fails if artifact hash or draft version changed. |
| Policy evaluator | Manual queues semantic proposals; assisted does not auto-commit Canon; eval shadows. |
| UI behavior | Proposal cards support per-card approve/reject/modify and do not require apply-all. |

## Data Migration Strategy

Phase 1 can likely avoid a new table because `canon_proposals` already exists for `CanonFact` payloads.

Near-term additions may be needed:

- Add structured source metadata to `canon_proposals` if `proposed_payload.data.sourceItemId` is not queryable enough.
- Add unique idempotency index over `(novel_id, source, source_artifact_id, source_item_id, schema_version)` if using dedicated columns.
- Add proposal resolution telemetry if `pipeline_events` is not enough.

Defer generic proposal storage until Phase 3 or Phase 5 proves multiple proposal kinds need durable queues with shared filtering. Until then, use a shared envelope at the API/UI layer and keep storage kind-specific.

## LLM Surface Rules

Any LLM-generated proposal surface must follow the cache/context discipline already used in Step 2C.

| Rule | Requirement |
|---|---|
| Stable prefix | Role contract, schema, enum values, evidence rules, and validator disclosure are byte-identical. |
| Volatile tail | Specific artifact/proposal target, current version hash, and user instruction. |
| Evidence tiers | Required evidence separated from supporting context and inventory. |
| Post-validator | Schema, target existence, precondition, enum, and evidence quote checks. |
| Retry ladder | Retry schema failures; do not silently convert invalid output into approval. |
| No hidden semantic normalization | Paraphrase clustering is explicit LLM/human adjudication, never token-overlap code. |

## Risks

| Risk | Mitigation |
|---|---|
| Big-bang generic proposal refactor | Start with planner Canon proposals using existing substrate. |
| UI complexity | Start with one proposal list and per-card decisions. |
| Pending proposals poison writer context | Enforce committed-only reads; add tests. |
| LLM proposals feel authoritative | Display status as pending, show evidence, require approval policy. |
| Autonomous mode commits bad semantics | Default policy queues semantic Canon; auto-commit stays gated. |
| Human review becomes a bottleneck | Assisted mode auto-applies low-risk mechanical proposals and batches review. |
| Proposal drift after artifact edits | Version/hash preconditions fail stale proposals closed. |
| Metrics get pooled across unlike tasks | Report by proposal kind and risk class only. |

## Open Questions

1. Should planner Canon proposals be generated immediately after planning, after chapter approval, or both with different `origin`/status?
2. Should planned Canon proposals feed the writer as chapter contract context even while pending, or only through the existing outline/obligation surface?
3. Is `CanonFact.kind="character_state"` sufficient for early character-state Canon, or should typed `CharacterState` proposals be pulled forward sooner?
4. Should artifact patch proposals persist in Postgres from Phase 3, or is local/session state enough until editing workbench lands?
5. What is the first editorial tracer bullet: chapter-contract coverage, continuity-against-Canon, or prose polish?
6. Should autonomous mode be available from Studio, CLI-only, or both?
7. What is the minimum review evidence needed before assisted mode can auto-approve any semantic non-Canon proposal?

## Recommended Next Lane

Phase 1 cleared 2026-05-03 (see lane note `docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-1.md`). Phase 2 — Canon Proposal Review API + minimal UI — is the next narrow lane: list/approve/reject/modify endpoints over `PostgresCanonSubstrate.resolveProposal`, plus a Studio review panel that surfaces pending planner-origin proposals for an authored outline.

Working hypothesis (re-evaluate at Phase 2 lane open): the fact-only proposal lifecycle cleanly carries knowledge/state for Phase 1 because `CanonFact.kind` already enumerates `knowledge_change` and `character_state`. Typed `Entity` / `CharacterState` / `StoryPromise` proposal payloads are deferred to a follow-on charter and not load-bearing for Phase 2.
