---
status: active
updated: 2026-05-03
role: lane
session: 2026-05-03-world-bible-architecture-step-0a
charter: docs/charters/world-bible-architecture.md
experiment: 403
parent-lane: docs/sessions/2026-05-03-world-bible-architecture-step-0.md
---

# Lane — Charter §0a Deterministic Per-Chapter Bundle Builder

## Session-Start Contract

### 1. Goal + component

Land the charter's §0a deterministic per-chapter bundle builder: the pure-function assembler that produces L1 (the canon packet) byte-identically from `(canon-state-version, chapter-N)`. This is the architectural keystone — every downstream cache claim in the charter (`$0.0008/chapter` editorial economics, writer/judge bundle reuse, intra-chapter re-run efficiency) rests on the L1 packet being byte-stable and shared across all callers.

Component scope:

- **`src/canon/bundle.ts`** — the assembler module: deterministic L1 composition, stable ordering, SHA-256 packet hash, L1/L2 boundary helper.
- **`src/canon/bundle.test.ts`** — unit tests covering byte-identity on rerun, packet-hash stability, stable ordering under input shuffling, L1/L2 boundary assertion.
- **Labeled query set scaffold** — proposed location `tests/canon/bundle-recall-queries.json` (deferred validation in follow-on session if scope grows).

Out of scope for this lane:

- §0b bootstrap path (separate lane)
- Real canon storage (Step 1 implements; this lane uses a mock canon source)
- Recall/precision validation against ≥40 labeled queries (load-bearing for §0a stop gate; may need its own follow-on session given the manual-canon ground-truth requirement)
- L2 role snapshot tests (small follow-on; runs after the bundle module exports a stable L1/L2 separator API)
- Writer/judge wiring (Step 3/Step 4 cutover)

### 2. Why

Charter `docs/charters/world-bible-architecture.md` §0a + first-class principle ("One deterministic per-chapter context bundle, byte-identical by packet hash, reused by writer and all downstream judges"). The §0e cost probe (2026-05-03) achieved 99.2% prefix-cache hit ratio because every call used identical prefix bytes — that economic projection (`$0.0008/chapter at K=5 V4 Flash warm`) is conditional on the bundle builder producing byte-identical L1 across writer + all K judges in chapter N. If §0a fails, charter stop gate (a) fires.

User direction 2026-05-03: vector retrieval is optional/offline; runtime canon assembly is deterministic-scoped only. Path resolved during the §0 lane; this lane executes the resolution.

### 3. What is measurable

Per the charter §0a stop gate's eight checks:

1. **Deterministic builder** — pure function over `(canon-state-version, chapter-N)`; byte-identical L1 every call. Measurable: `assembleL1(input) === assembleL1(input)` byte-equality test passes.
2. **Stable ordering** — bundle entries sorted by stable keys (entity ID, fact ID, chapter, beat). Measurable: input-shuffle test (shuffle the upstream canon source's record order; output bytes unchanged).
3. **Packet hash** — SHA-256 over the L1 byte stream, recorded in provenance. Measurable: hash-stability test (same input → same hash; different input → different hash).
4. **Recall ≥80%** — against ≥40 labeled canon queries across ≥3 categories. **Deferred** to follow-on session pending labeled query set construction; this lane creates the scaffold.
5. **Precision ≥50% + token cap ≤6,000 tokens** — bundle padding guard + size guard. Measurable in this lane: token-count test on synthetic-canon fixtures.
6. **Byte-identical reruns** — automated test, not manual measurement. Measurable: same as check 1.
7. **L1 → L2 → L3 cascade integrity** — assembler emits L1 with last-byte-offset assertion; per-role L2 snapshot test scaffold. Measurable in this lane: boundary-offset test; L2 snapshot test scaffold (committed snapshot per role added in follow-on as roles wire up).
8. **Writer/judge bundle reuse** — same packet hash consumed by both. **Deferred** until Step 3/4 wiring; this lane exports the API both will call.

This session targets checks 1, 2, 3, 5 (token cap), 6, and 7 (L1/L2 boundary). Checks 4 (labeled-query recall), 7 (L2 snapshot tests), and 8 (writer/judge wiring) are deferred.

### 4. Validated gates

- **(a) Clean pass:** `bunx tsc --noEmit` clean on `src/canon/bundle.ts` + `src/canon/bundle.test.ts`. `bun test src/canon/bundle.test.ts` passes. Tests cover: byte-identity rerun, hash stability, input-shuffle invariance, token-cap guard, L1 last-byte-offset assertion. Charter + lane docs updated.
- **(b) New dominant blocker:** the assembler can't produce byte-identical output (e.g., a JSON serializer with non-deterministic key order, or a structure that holds floating-point state). Investigate; if non-determinism is intrinsic to the §0d stub interface, charter stop gate (a) fires.
- **(c) Regression:** N/A — new module under `src/canon/`, no runtime behavior change yet.
- **(d) Infrastructure failure:** N/A — pure-TS work, no LXC, no LLM calls.
- **(e) Budget cap:** $0 (no LLM calls in this lane).

## Command Plan

In order:

1. Build `src/canon/bundle.ts`:
   - Define `L1Packet` type (the canon-bundle byte stream + SHA-256 packet hash + section byte offsets).
   - Define `CanonSource` interface (the read-side abstraction §0a builds against; satisfied by mock fixtures here, by Step 1 storage later).
   - Implement `assembleL1(source: CanonSource, novelId, chapterN): L1Packet` — pure function: query the structured canon, sort by stable keys, serialize deterministically, hash.
   - Export L1/L2 boundary marker constant + helper `assertL1Boundary(promptBytes, L1Packet)` for the eventual prompt assembler.
2. Build `src/canon/bundle.test.ts`:
   - Synthetic in-memory `CanonSource` fixture for tests.
   - Byte-identity rerun test.
   - Packet-hash stability test.
   - Input-shuffle invariance test (shuffle the source's record iteration order; assembler output byte-identical).
   - Token-cap guard test.
   - L1/L2 boundary-offset test.
3. `bunx tsc --noEmit` clean; `bun test src/canon/bundle.test.ts` passes.
4. Update lane Results section + commit.
5. Defer follow-ons: labeled query set (recall validation), L2 role snapshot tests, writer/judge integration.

## Results

**Outcome:** Stop gate (a) clean pass on the in-scope §0a checks (1, 2, 3, 5 token cap, 6, 7 boundary). Deferred checks (4 recall, 7 L2 snapshot, 8 writer/judge wiring) carry to follow-on sessions.

### Bundle assembler at `src/canon/bundle.ts`

- `assembleL1(source, novelId, chapterN) → L1Packet`. Pure-function over `(CanonSource snapshot, novelId, chapterN)`.
- Sorts every section by stable IDs (`CanonId`, `characterId`) before serialization — the assembler defensively re-sorts, so a non-conforming `CanonSource` cannot break determinism.
- `stableStringify` recursively sorts object keys; arrays preserve order (callers sort first). Throws on non-finite numbers (NaN/Infinity would be silent canon corruption).
- SHA-256 packet hash computed over the L1 byte stream **excluding** the boundary marker — this makes future boundary-versioning orthogonal to canon-content hashes (a marker bump won't invalidate every prior packet hash).
- Token-cap guard: throws if approxTokens > 6,000. Bundle-padding / scope-rule failures fail loudly, not silent truncation.
- Active-promises section filters `status === "open"` (resolved/abandoned never appear in writer context — relevant to §4 "active" semantics in the charter).

### Cascade boundary at `L1_BOUNDARY_MARKER`

- Versioned marker `\n<<<L1_END_v1>>>\n` separates L1 from L2/L3 in assembled prompts.
- `assertL1Boundary(promptBytes, packet)` verifies: prompt starts byte-identically with `packet.bytes`, AND the boundary marker is intact at the expected offset. Call from the prompt assembler before sending.
- Provenance: `L1Packet.sectionOffsets` records per-section byte offsets (factsStart, entitiesStart, characterStatesStart, activePromisesStart, boundaryStart). Useful for debugging and for future provenance queries.

### Tests at `src/canon/bundle.test.ts` — 15/15 pass

Coverage:

- **Determinism (5 tests):** byte-identical reruns; fact-list shuffle invariance; entity-list shuffle invariance; different content → different hash; chapterN pass-through.
- **Promise filtering (1 test):** open-only in `activePromises`.
- **Cascade boundary (3 tests):** marker at end; `boundaryStart` offset correct; section offsets monotonic.
- **assertL1Boundary (3 tests):** passes on valid prompt; fails when prefix doesn't match; fails when marker tampered.
- **Token cap (2 tests):** throws when exceeded; tiny bundle reports plausible approxTokens.
- **Snapshot version (1 test):** flows from CanonSource into packet for downstream provenance.

### Verification

- `bunx tsc --noEmit` clean (no errors anywhere in repo from this lane).
- `bun test src/canon/bundle.test.ts` — 15 pass / 0 fail / 26 expect calls / 18ms.

### What lands in follow-on sessions

- **§0a check 4 (recall ≥80% against ≥40 labeled queries):** load-bearing for charter stop gate (a). Requires manual canon ground-truth (likely Salvatore decomposition per `docs/corpus-pipeline.md`). Multi-day; user input on which novel's manual canon to use.
- **§0a check 7 (L2 snapshot tests per role):** runs after writer/judge roles wire the assembler in. Small per-role test addition.
- **§0a check 8 (writer/judge bundle reuse):** Step 3/4 cutover wiring. Naturally satisfied if both call `assembleL1` and pass the resulting packet through `assertL1Boundary`.

## Stop gate fired

(a) clean pass — in-scope §0a checks land; tests + tsc clean; lane doc + commit ready.

## Evidence

- `src/canon/bundle.ts` (~250 lines)
- `src/canon/bundle.test.ts` (15 tests, all passing)
- Test run: `bun test src/canon/bundle.test.ts` → 15 pass / 0 fail
- Type check: `bunx tsc --noEmit` clean

## Cost

| line | spend |
|---|---|
| (no LLM calls expected) | $0.00 |

## Commits

To be added when this lane is committed.

## Review

Lane is single-component (charter §0a bundle assembler). The architectural decisions (context-first cascade, deterministic-scoped, no vector retrieval, byte-identity gate) are pre-approved in charter + companion docs. Self-review on the implementation; consider Codex review on the test suite if any non-trivial determinism subtlety emerges.

## Next Lanes

After §0a clean pass:

1. **§0a follow-on: labeled query set + recall/precision validation.** Requires a manual canon for at least one novel (Salvatore decomposition is the gold-standard reference per `docs/corpus-pipeline.md` and project memory). Multi-day; may need user input on which novel's manual canon to use.
2. **§0b — Bootstrap path.** Smaller lane. Now cleaner since §0a's data shape is fixed.
3. **Charter Step 1 — Canon Substrate.** Replaces the mock `CanonSource` with real Postgres-backed storage. The bundle assembler from this lane is unchanged — it queries through the same interface.
