---
status: stopped
updated: 2026-05-03
role: lane
session: 2026-05-03-step-2b-live-planner-canon-delta
charter: docs/charters/world-bible-architecture.md
experiment: none-local-harness
predecessor: docs/sessions/2026-05-03-step-2a-planner-canon-integrity.md
---

# Lane - Step 2B Live Planner Canon Delta

## Session-Start Contract

### 1. Goal + component

Build a deterministic audit command for actual generated planner/state artifacts that follows stable IDs across chapters and reports the planned Canon delta by ID.

### 2. Why

Step 2A proved the grading machinery but also showed the Salvatore planned-origin proxy is diagnostic only (`sourceEvidenceGateClear=false`, recall 0.562); the architecture target is the real planner ID/state flow, not corpus-derived provenance.

### 3. What is measurable

The lane works if a local command reads real persisted planner artifacts, extracts `establishedFacts`, knowledge changes, character state changes, payoff/promise links, and obligation source references by assigned ID, and reports whether the ID graph is coherent enough to be the next Bible-input integrity target.

### 4. Validated gates

- **(a) Clean pass:** audit command lands, focused tests pass, TypeScript passes, and the command runs on at least one real generated novel artifact.
- **(b) New dominant blocker:** existing persisted artifacts do not retain enough planner/state JSON to reconstruct the live Canon delta; report the fixture-retention blocker rather than using proxy data.
- **(c) Regression:** existing canon tests or §0a recall regress; stop and fix or document as pre-existing.
- **(d) Infrastructure failure:** local DB/artifact access is unavailable; record exact failure and keep the command fixture-friendly.
- **(e) Budget cap:** no LLM/API calls unless explicitly chosen; this lane should use persisted artifacts first.

## Results

- Built `src/canon/planner-canon-delta.ts`, a pure audit over real generated `ChapterOutline` artifacts. It extracts planner/state mapper source items (`establishedFacts`, `knowledgeChanges`, `characterStateChanges`), payoff links, and beat obligation `sourceId` refs, then reports mechanical ID graph health.
- Added `scripts/audits/run-live-planner-canon-delta.ts` with `--latest`, `--novel-id=<id>`, and `--json` modes. The command reads real `chapter_outlines.outline_json` rows from Postgres, not Salvatore/corpus proxy data.
- Added `src/canon/planner-canon-delta.test.ts` for clean graph, duplicate cross-chapter source IDs, missing coverage, and invalid payoff target cases.
- Ran the audit on latest generated novel `novel-1777786463873`.

Latest live artifact result:

| Metric | Value |
|---|---:|
| chapters | 2 |
| beats | 23 |
| sourceItems | 30 |
| facts | 18 |
| knowledge | 8 |
| states | 4 |
| obligations | 30 |
| duplicateSourceIds | 0 |
| invalidSourceIds | 0 |
| missingSourceCoverage | 0 |
| unknownObligationSources | 0 |
| sourceKindMismatches | 0 |
| characterIdMismatches | 0 |
| validationErrors | 0 |
| idGraphGateClear | yes |

Interpretation:

- The real generated planner/state mapper ID graph is mechanically coherent on this latest 2-chapter artifact.
- This is now the right Step 2 target surface: actual assigned IDs and cross-chapter deltas from live generated outlines.
- This is still not semantic truth approval. The next gate is manual/oracle labeling of these actual source items as correct/incorrect/missing, using the live ID graph as the fixture spine.
- Current legacy planned-state tables contain rows for the approved chapter only (`facts=11`, `characterStates=2`, `characterKnowledge=5`) and do not retain planner source IDs. Stable source IDs currently live in `chapter_outlines`, so Canon-substrate wiring must preserve those IDs rather than relying on legacy row IDs.

## Evidence

- `bun test src/canon/planner-canon-delta.test.ts` - 3 pass / 0 fail.
- `bun test src/canon/` - 193 pass / 0 fail.
- `bunx tsc --noEmit` - clean.
- `bun scripts/audits/run-live-planner-canon-delta.ts --latest` - `artifactGateClear=YES`, `idGraphGateClear=YES`, `recommendation=ready-for-semantic-labeling`.
- `git diff --check` - clean.

## Cost

No runtime LLM/API cost planned.
