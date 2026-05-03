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

Close §0a stop gate check 4 (aggregate mean recall ≥80% across ≥40 labeled canon queries spanning all 3 categories) by building a manual canon for Salvatore Crystal Shard chapters 1–5 and validating the scoping rules from session-2. Precision and token-cap signals are reported in the validation report but are observability metrics, not gates — the gate is recall.

This is the Salvatore PoC vehicle (per 2026-05-03 user direction): existing corpus is OK for now; architecture is genre-neutral so Salvatore validation generalizes to romance / pulp / LitRPG.

Component scope:

- **`tests/canon/fixtures/salvatore-crystal-shard.canon.json`** — manual canon: ~50–80 CanonFacts, ~20–30 Entities, ~10–15 CharacterStates, ~5–10 StoryPromises. Built by parallel canon-extraction subagents reading the existing `novels/salvatore-icewind-dale/scenes.jsonl` and `beats.jsonl` decompositions.
- **`tests/canon/fixtures/salvatore-crystal-shard.queries.json`** — ≥40 labeled queries with relevant-canon-sets, across the three required categories.
- **`src/canon/recall-validation.ts`** — pure-function validation harness: format validators for the fixtures (canon + queries), per-chapter packet assembly (one `assembleL1` call per chapter using hints from the QueryFixture's `chapters` manifest, cached and shared across every query about that chapter — mirrors the production rule that one bundle is reused by writer + K judges), recall/precision/token-count computer over namespaced relevant IDs.
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

- ≥40 labeled queries built across entity-grounding / character-state-at-time / active-promises-and-payoffs (all three categories represented; uneven distribution OK as long as none is empty).
- Per-chapter manifest defined in the queries fixture — one `ChapterManifest` entry per chapter the queries reference, carrying the same hints (POV, charactersPresent, chapterEntityIds) the production chapter contract would carry.
- Validation harness runs against the canon + queries fixtures; `runValidation` returns `recallGateClear: true`.
- Aggregate mean recall ≥80% (PRIMARY gate; mechanically enforced by `recallGateClear` together with the sample-size and category-coverage requirements).
- Precision and token-cap-exceeded counts reported for visibility — non-gate observability. Pathological numbers (e.g., precision <0.1, or a packet over the 60K-token defensive ceiling) should trigger investigation of the scoping rules, not bundle trimming.
- §0a stop gate check 4 closes (or is explicitly re-opened with a documented v2 rule revision driven by the missed-IDs from the recall failures).

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

1. Build the per-chapter `chapters` manifest in the queries fixture — one entry per chapter (1–5), hints reflecting what the production chapter contract would supply (POV, charactersPresent, chapterEntityIds). One `assembleL1` call per chapter; queries are different lenses on the same packet.
2. Build ≥40 labeled queries with namespaced `relevantIds` (`fact:` / `entity:` / `state:` / `promise:`), distributed across all three categories. Roughly 14 entity-grounding, 13 character-state-at-time, 13 active-promises-and-payoffs is a reasonable target balance.
3. Run validation harness; inspect `missedIds` first, not aggregate precision. The recall floor is the gate; precision/token-cap are observability.
4. If `recallGateClear: true`: §0a stop gate check 4 closes; advance to §0b/bootstrap or §0d/Step 1 substrate.
5. If recall misses: drive a v2 scoping rule revision narrowly from the specific `missedIds` (especially knowledge_change subject typing and chapter entity manifests); iterate.

## Results

(to fill at session-3a completion)

## Stop gate fired

(TBD)

## Evidence

- Codex review round 2 (post-bed2b47): no HIGH; MEDIUM 1/2/3 + LOW 1 closed by the round-2 cleanup commit (validate ChapterManifest.hints fields; cross-check snapshotVersion in runValidation; lane doc gate semantics rewritten to current charter; bundle.ts packetHash JSDoc corrected). 88 canon tests pass; tsc clean.
- Codex LOW residual deferred to Step 1 substrate: CharacterState and StoryPromise carry no provenance/approvalStatus, so the no-ghost-canon rule is enforced for facts/entities only. Documented at the type definitions in `src/canon/api.ts` so Step 1 substrate work either guarantees committed-only at the DB layer or extends the types.

## Cost

| line | spend |
|---|---|
| Canon-extraction subagents (×2, sonnet) | TBD |
| **total** | **TBD** |

## Commits

(TBD)
