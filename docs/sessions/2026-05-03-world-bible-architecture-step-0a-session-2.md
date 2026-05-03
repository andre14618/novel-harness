---
status: active
updated: 2026-05-03
role: lane
session: 2026-05-03-world-bible-architecture-step-0a-session-2
charter: docs/charters/world-bible-architecture.md
experiment: 403
parent-lane: docs/sessions/2026-05-03-world-bible-architecture-step-0a.md
---

# Lane — Charter §0a Session 2: Scoping Rules + Salvatore PoC Setup

## Session-Start Contract

### 1. Goal + component

Land the scoping rules layer of the §0a deterministic bundle builder. Session-1 shipped the cascade composer + packet hash + boundary assertion + tests, but the assembler currently consumes whatever the CanonSource returns and serializes it. **Production canon will exceed the 6K-token L1 cap once the bible grows; the assembler needs explicit scoping that picks the right subset for chapter N.**

Scope:

- **`src/canon/scope.ts`** — pure-function scoping module: `scopeCanonForChapter(rawCanon, hints) → scopedCanon` applying the rules below.
- **`src/canon/scope.test.ts`** — unit tests covering each rule + interaction tests.
- **`src/canon/bundle.ts`** integration — `assembleL1` accepts an optional `scopingHints` parameter; when provided, scopes before serializing. Backward-compatible with session-1 callers.

User direction (2026-05-03): Salvatore is the first PoC corpus. The scoping rules are designed against Salvatore-shaped inputs (POV character, characters-present, established facts) but are genre-neutral (per `project_genre_flexibility.md` — L1 doesn't know it's fantasy).

### 2. Why

§0a stop gate check 4 (recall ≥80% against ≥40 labeled canon queries) cannot be evaluated on the session-1 assembler because it has no scoping logic to validate. Without scoping rules, "recall" is trivially 100% on a small bible and trivially fails the precision floor on a large one. Real validation requires: real scoping rules + manual canon + labeled queries → measure recall/precision against the rules.

This session lands the scoping rules. The next sub-session builds the manual canon + labeled query set + validation harness against Salvatore Crystal Shard chapters.

### 3. What is measurable

**Scoping rules (v1) — what the bundle MUST include for chapter N:**

1. **POV character + their known characters.** The chapter's `povCharacterId`'s CharacterState + the CharacterState of every character listed in `charactersPresentIds`.
2. **Active promises overlapping chapter N.** Every StoryPromise where `status === "open"` AND `setupChapter ≤ N` AND (`expectedPayoffChapter` is undefined OR `N ≤ expectedPayoffChapter + windowSlackChapters`).
3. **Chapter-contract entities.** Any Entity whose `id` appears in `povCharacterId` or `charactersPresentIds` from the chapter outline.
4. **Recent canon-events.** Facts whose `provenance.chapter` is in `[N - recencyWindow, N - 1]` (default `recencyWindow = 5`).
5. **Established world facts.** All facts where `kind === "established_fact"` AND `provenance.origin === "planned"` (foundational world rules — always included).
6. **Knowledge-change facts attached to POV character or characters-present.** Any `kind === "knowledge_change"` fact whose payload references one of the in-scope characters (best-effort heuristic; refined by labeled-query feedback).

**Scoping rules — what the bundle MUST NOT include for chapter N:**

- Facts with `provenance.chapter > N` (future canon — point-in-time correctness).
- StoryPromises with `status !== "open"`.
- Entities with `firstAppearedChapter > N` (entities not yet in story).
- Facts with `provenance.approvalStatus === "rejected"`.

**Pass criteria for this session:**

- `bunx tsc --noEmit` clean.
- `bun test src/canon/scope.test.ts` passes.
- Each of the 6 inclusion rules has a dedicated test verifying inclusion when applicable + exclusion when not.
- Each of the 4 exclusion rules has a dedicated test.
- Integration test: `assembleL1` with scoping hints produces a strict subset of the unscoped output (same facts/entities/states/promises but filtered) AND the resulting packet is byte-identical on rerun.
- Lane doc Results section filled.

### 4. Validated gates

- **(a) Clean pass:** rules implemented, all tests pass, integration with `assembleL1` clean, deterministic. Charter §0a stop gate checks 1, 2, 3, 5, 6, 7 still hold. Check 4 (labeled-query recall) remains deferred to session-3.
- **(b) New dominant blocker:** rules can't produce a deterministic subset (e.g., dependency on object-identity for filtering produces different bytes on rerun). Investigate; redesign.
- **(c) Regression:** session-1's `assembleL1(source, novelId, chapterN)` (no hints) must continue to produce byte-identical output to before. Backward-compat regression test.
- **(d) Infrastructure failure:** N/A.
- **(e) Budget cap:** $0 (no LLM calls).

## Command Plan

1. Build `src/canon/scope.ts`:
   - `ScopingHints` interface (POV char ID + charactersPresent IDs + recencyWindow + windowSlackChapters + optional include/exclude lists)
   - `scopeCanonForChapter(raw: L1Sections, hints, chapterN) → L1Sections` pure function applying the 6 inclusion + 4 exclusion rules
   - Stable, deterministic — no Math.random, no clocks, no insertion-order-sensitive ops
2. Update `src/canon/bundle.ts`:
   - `assembleL1` accepts optional `scopingHints` parameter
   - When provided, scoping runs after fetch and before serialization
   - When absent, behavior is unchanged from session-1 (backward compat)
3. Build `src/canon/scope.test.ts` covering all 10 rules + integration with `assembleL1`.
4. Verify: `bunx tsc --noEmit` clean, `bun test src/canon/` passes (including session-1's bundle.test.ts unchanged).
5. Update lane Results + commit.
6. Defer: manual Salvatore canon + ≥40 labeled queries + recall validation → session-3.

## Results

**Outcome:** Stop gate (a) clean pass on the in-scope §0a session-2 work. Scoping rules v1 land as a pure-function module integrated with `assembleL1` via an optional `scopingHints` parameter; backward-compat preserved.

### Scoping module at `src/canon/scope.ts`

`scopeCanonForChapter(raw, hints, chapterN) → L1Sections` applies rules v1 deterministically:

**Inclusion rules (any one admits):**
- Rule 1: POV character + characters-present CharacterStates (filtered by `asOfChapter ≤ N`).
- Rule 2: open StoryPromises with setup ≤ N AND (no expectedPayoffChapter OR N ≤ expectedPayoffChapter + windowSlackChapters; default slack 2).
- Rule 3: Entities for POV/characters-present/force-include list (filtered by `firstAppearedChapter ≤ N`).
- Rule 4: facts with `provenance.chapter ∈ [N - recencyWindow, N - 1]` (default window 5).
- Rule 5: planned `established_fact` facts (foundational world rules — always included regardless of recency).
- Rule 6: `knowledge_change` facts whose data references in-scope characters via candidate field heuristics (`characterId`, `character_id`, `characterName`, `knower`, `knowerId`, plus arrays `characterIds`/`participantIds`/`knowerIds`).

**Exclusion rules (any one rejects, override inclusion):**
- Future-canon: facts/states/entities with timestamp > N.
- `approvalStatus === "rejected"`.
- Force-exclude list (`excludeFactIds`).

**Force-include lists** (`includeFactIds`, `includeEntityIds`) lift entries through inclusion rules — but never past the future-canon exclusion (operator can't teleport future facts to the writer).

### Integration with `assembleL1`

- New optional 4th param `scopingHints?: ScopingHints`. When provided: scope-then-serialize. When absent: backward-compat with session-1 (whole-snapshot serialization).
- Scoped packets get a different SHA-256 packet hash than unscoped (different content → different bytes → different hash, by design).
- Determinism: scoped output is byte-identical on rerun for the same `(source-snapshot, novelId, chapterN, hints)`.

### Tests at `src/canon/scope.test.ts` — 32/32 pass

Coverage by rule:
- Rule 1 (3 tests): includes POV + present chars; excludes out-of-scope; excludes future states.
- Rule 2 (6 tests): active inside window; excluded resolved; excluded future-setup; open-ended included; stale-past-slack excluded; stale-inside-slack included.
- Rule 3 (4 tests): includes POV/present entities; excludes not-yet-appeared; force-include lifts; force-include respects not-yet-appeared.
- Rule 4 (4 tests): inside-window included; outside-window excluded; custom recencyWindow respected; chapter-N exclusive (not [N-recency, N]).
- Rule 5 (2 tests): always includes world rules; works at chapter 100.
- Rule 6 (3 tests): POV knowledge included; characters-present knowledge included; out-of-scope-character knowledge excluded.
- Exclusions (3 tests): future-canon, rejected facts, force-exclude.
- Force-include (1 test): lifts otherwise-unadmitted facts.
- Determinism (2 tests): byte-identical reruns; output sorted by stable IDs.
- Integration (4 tests): subset property of unscoped output; byte-identical rerun with hints; backward-compat (no hints behaves like session-1); different content → different hash.

**Plus session-1's 15 bundle tests** (unchanged): total **47 tests / 80 expects / 65ms / 0 fail**.

### Verification

- `bunx tsc --noEmit` clean (no errors anywhere in repo).
- `bun test src/canon/` — 47 pass / 0 fail.

### What this enables

The bundle assembler now has real scoping logic. Session-3 can:
- Build a manual canon for Salvatore Crystal Shard chapters 1–5.
- Build ≥40 labeled queries (entity-grounding / character-state-at-time / active-promises-and-payoffs).
- Run the validation harness: feed each query's chapter context as `ScopingHints`, assemble L1, grade against the labeled relevant-canon-set.
- Measure recall (≥80%?) + precision (≥50%?) + token cap (≤6K).
- If v1 rules fail to clear thresholds, iterate (v2 might tighten rule 6's heuristic, expand rule 2's slack, etc.). Empirical loop.

## Stop gate fired

(a) clean pass — scoping rules v1 implemented; 47/47 tests pass; backward compat preserved; lane doc + commit ready.

## Evidence

- `src/canon/scope.ts` (~210 lines)
- `src/canon/scope.test.ts` (32 tests)
- `src/canon/bundle.ts` updated to accept `scopingHints` (backward-compat)
- Test run: 47 pass / 0 fail / 80 expects / 65ms
- Type check: `bunx tsc --noEmit` clean

## Cost

| line | spend |
|---|---|
| (no LLM calls expected) | $0.00 |

## Commits

(TBD)

## Next Lanes

After session-2 clean pass:

1. **§0a session-3: Salvatore manual canon + labeled query set + recall validation.** Build a manual canon for Salvatore Crystal Shard chapters 1–5: ~50–80 CanonFacts, ~20–30 Entities, ~10–15 CharacterStates, ~5–10 StoryPromises. Build ≥40 labeled queries across entity-grounding, character-state-at-time, active-promises-and-payoffs categories. Validate recall ≥80%, precision ≥50%, token cap ≤6,000. Closes §0a stop gate check 4.
2. **§0a session-4: integration with §0d canon API.** Wire `assembleL1` through the (still-stubbed) canon API so Step 1 substrate work picks up cleanly.
3. **§0b — Bootstrap path** (separate lane, smaller).
4. **Charter Step 1 — Canon Substrate.** Replaces mock CanonSource with Postgres-backed storage.
