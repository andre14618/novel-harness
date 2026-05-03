---
status: active
updated: 2026-05-03
role: lane
session: 2026-05-03-world-bible-architecture-step-0
charter: docs/charters/world-bible-architecture.md
experiment: 403
---

# Lane — World-Bible Architecture Step 0 Prereqs

## Session-Start Contract

### 1. Goal + component

Land Step 0 prerequisites of the world-bible architecture charter (`docs/charters/world-bible-architecture.md`). Step 0 is bootstrap + retrieval reactivation work that must clear before any architecture-bearing code lands. Five sub-prereqs:

- **§0a** retrieval reactivation (or deterministic fallback) with precision@K + recall@K + token cap stop gate
- **§0b** initial bible bootstrap path (planner-declared seed + human curation hook + optional corpus import)
- **§0c** explicit act/milestone planner outputs verification
- **§0d** canon API design (function signatures + stub implementation)
- **§0e** pre-Step-4 cost probe (early kill-gate)

This lane scopes to §0c + §0d + §0e in the immediate session (read-only verification, design stubs, bounded LLM probe). §0a (retrieval reactivation) and §0b (bootstrap path) are deferred to follow-on lanes — §0a is multi-day work that warrants its own lane and possibly user input on the deterministic-fallback decision.

### 2. Why

Charter prerequisites #5 (experiment row + lane doc) and #6 (user-explicit charter approval — "loop through implementing items on the charter," 2026-05-03 user message). The five-checker audit (`docs/checker-quality-audit-2026-05-03.md`) plus the K=3 stochasticity sweep (gate-decision-level TP converges to ~36% across all four practical arms on chapter-plan-checker) is the empirical anchor; charter §"Why Now" carries the evidence chain. Charter row #403 created 2026-05-03; status promoted `proposed → active`.

### 3. What is measurable

Per Step 0 sub-prereq:

- **§0c verification artifact:** a one-paragraph finding in this doc stating whether the planner currently emits act/milestone markers (yes / no / partial) with file:line citations from the planner agent code. Pass criterion: clear yes/no answer with code evidence.
- **§0d design artifact:** TypeScript interface stubs at `src/canon/api.ts` (or equivalent — TBD location) covering the six required functions (`getCanonForChapter`, `getCharacterStateAt`, `getActivePromises`, `getEntityRegistry`, `proposeCanonUpdate`, `commitCanonUpdate`). Stubs return placeholder values; no live data. Pass criterion: stubs compile under `bunx tsc --noEmit` and document the data each function will eventually return.
- **§0e cost probe results:** per-chapter editorial cost projections at K=5 and K=10 judges, V4 Flash and V4 Pro, cache-hit and cache-miss costs, output-token cost separately. Saved to `docs/sessions/2026-05-03-world-bible-architecture-step-0-cost-probe-results.md` or appended to this doc. Pass criterion: numbers fit inside or violate the $0.50/chapter ceiling at K=5 V4 Flash; if violation, charter stop gate (d) fires.

### 4. Validated gates

- **(a) Clean pass:** §0c verification produces a clear answer; §0d stubs compile; §0e cost probe lands with concrete numbers; this doc updated with Results section. Verification: `bunx tsc --noEmit` clean on touched files; cost probe results doc exists.
- **(b) New dominant blocker:** charter stop gate (d) fires — projected per-chapter editorial cost at K=5 V4 Flash exceeds $0.50/chapter. Lane stops; cost-mitigation options (reduce judge count, V4 Flash only, redesign prefix) get a fresh lane or kill the charter.
- **(c) Regression:** N/A — read-only + stub-only work; no runtime behavior changes.
- **(d) Infrastructure failure:** §0e probe can't run because DeepSeek API or transport is broken. Pause; investigate; resume in a follow-on lane.
- **(e) Budget cap:** §0e probe is bounded ~$0.10–$0.50 per charter §0e estimate. If actual exceeds $1.00, pause and investigate.

## Command Plan

In order:

1. §0c — Read planner agent code (`src/agents/planning-plotter/`, `src/agents/planning-beats/`, `src/schemas/`) to determine whether act/milestone markers are emitted. Document finding here.
2. §0d — Design canon API interface in TypeScript. Write stubs at `src/canon/api.ts` (or similar). Compile clean.
3. §0e — Build cost probe script (mock judges over a representative `(canon-prefix + chapter)` payload). Run ~50 simulated judge calls. Capture per-chapter cost projections at K=5 and K=10 across V4 Flash and V4 Pro. Save results doc.
4. Update this doc's Results section + conclude experiment row + commit.

## Results

**Outcome:** Stop gate (a) clean pass on §0c, §0d, §0e. §0a and §0b deferred to follow-on lanes.

### §0c — Planner act/milestone outputs verification

**Finding: PARTIAL — acts are emitted at concept-phase, derived position-based at chapter level. No planner schema change required for charter Step 5.**

- `actSchema` defined at `src/schemas/shared.ts:16-22` with shape `{ number, name, summary, emotionalArc, turningPoint? }`.
- The `plotter` agent (concept-phase) emits `acts: actSchema[]` as part of the story spine — see `src/agents/plotter/schema.ts:5`.
- Story spine is consumed by the planning-plotter at `src/agents/planning-plotter/context.ts:80` (rendered into the chapter-skeleton prompt).
- Chapter outlines do NOT carry a per-chapter `actNumber` field — see `chapterOutlineSchema` in `src/agents/planning-plotter/schema.ts`.
- Writer derives `currentAct` at call time by dividing chapter number by chapters-per-act (`src/agents/writer/context.ts:451-454`).

**Implication for charter Step 5 (Milestone / Novel-Level Review):** position-based act-break derivation is sufficient. Step 5 milestone runner can read `storySpine.acts[]` + `chapter_outlines` and compute act boundaries deterministically. No planner schema extension needed.

### §0d — Canon API design

**Stub at `src/canon/api.ts`. Compiles clean (`bunx tsc --noEmit`).**

Six required functions stubbed with signatures, return shapes, and provenance/versioning types:

- `getCanonForChapter(novelId, chapterN)` → `{ facts: CanonFact[]; entities: Entity[] }` returning canon-as-of-chapter-N (retroactive-edit-aware)
- `getCharacterStateAt(novelId, charId, chapter, beat?)` → `CharacterState`
- `getActivePromises(novelId, asOfChapter?)` → `StoryPromise[]` (renamed from `Promise` to avoid shadowing the JS built-in)
- `getEntityRegistry(novelId, asOfChapter?)` → `Entity[]`
- `proposeCanonUpdate(novelId, proposal)` → `CanonUpdateProposal` (proposal, not write)
- `commitCanonUpdate(proposalId, status, opts?)` → `{ committedFact? }` (resolves proposal; honors no-ghost-canon rule)

Domain types: `CanonFact`, `CharacterState`, `StoryPromise`, `Entity`, `CanonUpdateProposal`, plus full `Provenance` interface covering `source`, `chapter/beat`, `extractorVersion`, `confidence`, `approvalStatus`, `origin` (planned vs. observed), `supersedes`, `createdAt`/`updatedAt`. All bodies throw `notImplemented()` per Step-0 stub contract.

**Implication for charter Step 1:** the schema requirements from §1 are now expressed as TypeScript types. Step 1 implementation lands the actual storage + queries; downstream charter work can wire against the stubbed API without waiting.

### §0e — Pre-Step-4 cost probe

**Verdict: PASS. Charter stop gate (d) does not fire.**

- Probe script: `scripts/_step0e-cost-probe.ts`. 10 sequential V4 Flash calls on a synthetic ~4K-token (canon-prefix + chapter) payload. Total spend $0.0012.
- Cache hit ratio on warm calls: **99.2%**.
- Per-chapter projection at K=5 V4 Flash warm: **$0.0008/chapter** vs the $0.50 threshold (~600× under).
- Headroom analysis at 50K-token full-novel bible + V4 Pro promo + K=10 judges: ~$0.03/chapter (~17× under threshold).

Full results: `docs/sessions/2026-05-03-step-0e-cost-probe-results.md`.

### §0a — Retrieval reactivation

**Deferred to follow-on lane.** Multi-day work; warrants its own session-start contract and possibly user input on the deterministic-fallback decision (charter §0a offers two viable paths). Not blocking for the work landed in this lane (§0c, §0d, §0e are independent of retrieval).

### §0b — Initial bible bootstrap path

**Deferred.** Design work; lower priority than retrieval. Will be addressed once §0a's path is decided, since the bootstrap path differs slightly between semantic-retrieval and deterministic-lookup architectures.

## Stop gate fired

(a) clean pass — §0c verification + §0d compile-clean stubs + §0e probe-pass landed; lane doc updated; cost-probe results doc written.

## Evidence

- §0c: file:line citations in this doc (planner schema + writer derivation paths)
- §0d: `src/canon/api.ts` (220 lines, tsc-clean)
- §0e: `docs/sessions/2026-05-03-step-0e-cost-probe-results.md`, `/tmp/step0e-results.json`, `scripts/_step0e-cost-probe.ts`

## Cost

| line | spend |
|---|---|
| §0e cost probe (10 V4 Flash calls) | $0.0012 |
| **total** | **$0.0012** |

Well under the lane's bounded ~$0.50 budget.

## Commits

To be added when this lane is committed.

## Review

Lane is single-component (charter Step 0 prereq landing) and atomic. Self-review only — no Codex/external review at this scope; lane work is design + measurement, no runtime behavior change.

## Next Lanes

Charter Step 0 follow-ons in priority order:

1. **§0a — Retrieval reactivation.** Multi-day. Two paths to evaluate (semantic vs. deterministic). User input on path selection appropriate before opening.
2. **§0b — Bootstrap path.** Design work, depends on §0a's choice. Smaller lane.
3. **Charter Step 1 — Canon Substrate.** Larger lane. Schema implementation + DB tables + API bodies. Gated on §0a.

Recommend pausing here for user check-in on §0a path selection (semantic retrieval reactivation vs. deterministic-lookup fallback) before opening the next lane. The choice has multi-week implications and a one-way-door quality.
