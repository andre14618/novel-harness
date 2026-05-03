---
status: active
updated: 2026-05-03
role: lane
session: 2026-05-03-world-bible-architecture-step-0a-session-3
charter: docs/charters/world-bible-architecture.md
experiment: 403
parent-lane: docs/sessions/2026-05-03-world-bible-architecture-step-0a.md
predecessor: docs/sessions/2026-05-03-world-bible-architecture-step-0a-session-2.md
---

# Lane — Charter §0a Session 3: Salvatore Manual Canon + Recall Validation

## Session-Start Contract

### 1. Goal + component

Close §0a stop gate check 4 (recall ≥80% / precision ≥50% / token cap ≤6K against ≥40 labeled canon queries) by building a manual canon for Salvatore Crystal Shard chapters 1–5 and validating the scoping rules from session-2.

This is the Salvatore PoC vehicle (per 2026-05-03 user direction): existing corpus is OK for now; architecture is genre-neutral so Salvatore validation generalizes to romance / pulp / LitRPG.

Component scope:

- **`tests/canon/fixtures/salvatore-crystal-shard.canon.json`** — manual canon: ~50–80 CanonFacts, ~20–30 Entities, ~10–15 CharacterStates, ~5–10 StoryPromises. Built by parallel canon-extraction subagents reading the existing `novels/salvatore-icewind-dale/scenes.jsonl` and `beats.jsonl` decompositions.
- **`tests/canon/fixtures/salvatore-crystal-shard.queries.json`** — ≥40 labeled queries with relevant-canon-sets, across the three required categories.
- **`src/canon/recall-validation.ts`** — pure-function validation harness: format validators for the fixtures, query runner that calls `assembleL1` with appropriate scoping hints per query, recall/precision/token-count computer.
- **`src/canon/recall-validation.test.ts`** — exercises the harness against the fixture; reports per-query and aggregate metrics.

### 2. Why

§0a session-2 landed the scoping rules v1 but they're untested against real-shaped content. The recall/precision floors are the empirical gate that says "v1 rules work on production-like data" or "they don't, iterate." Without this, we don't know if the deterministic-scoped path is recall-acceptable; without that, charter stop gate (a) cannot fully close.

User direction (2026-05-03): "easiest proof of concept comes from doing some kind of Salvatore imitation project." Salvatore is the gold-standard reference per `project_corpus_pipeline` memory. L1 is genre-neutral by design (per `project_genre_flexibility`), so a Salvatore validation is a real test of the architecture, not a fantasy-only one.

### 3. What is measurable

**Pass criteria for session-3a (this session):**

- Lane doc landed.
- Canon fixture format spec + labeled query format spec defined (TypeScript types).
- Validation harness scaffold built (format validators + query runner + metrics computer).
- 2 canon-extraction subagents spawned in parallel; integrated output produces valid `salvatore-crystal-shard.canon.json` covering Crystal Shard prelude + chapters 1–5.
- `bunx tsc --noEmit` clean.

**Pass criteria for session-3b (follow-on):**

- ≥40 labeled queries built across entity-grounding / character-state-at-time / active-promises-and-payoffs.
- Validation harness runs against the canon + queries fixtures.
- Recall ≥80% across ≥40 labeled queries (or report failures + propose v2 scoping rules).
- Precision ≥50%.
- Token cap ≤6K on assembled bundles.
- §0a stop gate check 4 closes (or is explicitly re-opened with a documented v2 rule revision).

### 4. Validated gates

- **(a) Clean pass (session-3a):** lane doc + format specs + harness scaffold + integrated canon fixture; tsc clean.
- **(b) New dominant blocker:** subagent canon extraction produces unusable output (e.g., schema violations across all chapters), OR the existing scoping rules clearly cannot satisfy basic recall on hand-traced examples. Investigate; redesign rules or extraction approach.
- **(c) Regression:** N/A — additive work.
- **(d) Infrastructure failure:** subagents hit limits or fail; pause.
- **(e) Budget cap:** subagent runs are bounded by Claude's per-task budget. No runtime LLM calls from this session's harness work.

## Command Plan

This session (3a):

1. Define canon fixture format (`src/canon/recall-validation.ts` exports types matching §0d schema).
2. Define labeled query format.
3. Build harness scaffold: JSON-schema validators + query runner + metrics computer.
4. Spawn 2 canon-extraction subagents in parallel:
   - Subagent A: Crystal Shard prelude + chapters 1–2
   - Subagent B: Crystal Shard chapters 3–5
5. While subagents run: small follow-on harness tests against synthetic fixture.
6. Subagent output integration: merge into single `salvatore-crystal-shard.canon.json`; resolve any conflicts (entity-ID collisions, fact-ID duplicates).
7. Validate fixture against the harness's format validators.
8. Update lane Results; commit.

Session 3b (next):

1. Build ≥40 labeled queries (possibly with a query-authoring subagent producing first drafts; user-reviewed).
2. Run validation harness; measure recall/precision/token-count.
3. If thresholds clear: §0a stop gate check 4 closes.
4. If thresholds miss: propose v2 scoping rules; iterate.

## Results

(to fill at session-3a completion)

## Stop gate fired

(TBD)

## Evidence

(TBD)

## Cost

| line | spend |
|---|---|
| Canon-extraction subagents (×2, sonnet) | TBD |
| **total** | **TBD** |

## Commits

(TBD)
