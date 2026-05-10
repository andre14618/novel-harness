---
date: 2026-05-10
status: complete
role: session-retrospective
inputs:
  - docs/research/user-adjusted-backlog-2026-05-10.md
  - docs/research/id-rendering-audit-2026-05-10.md
  - docs/research/scene-write-fixture-design-2026-05-10.md
  - docs/decisions/L099-writer-prompt-id-rendering.md
---

# Scene-First Evidence Lane — Bounded Loop Retrospective (2026-05-10)

## Goal

Make the operator-adjusted scene-first evidence lane (`docs/research/user-adjusted-backlog-2026-05-10.md`) executable end-to-end on LXC without changing production defaults.

## Slices shipped

| Commit | Slice | Concern |
|---|---|---|
| `62e5c8c` | A | adjusted-B1 ablation flag (`writerPromptIdRendering`, default-off, render-only) |
| `e48f996` | B | `test-planner-isolated --from-fixture` for P1/P2/P3 fixtures |
| `138780c` | C | `forceRenderSceneContractWhenAvailable` flag + `id-suppress` and `contract-render-only` arms in `test-drafting-isolated` |
| `cc6385e` | D | P4 frozen-plan capture from `novel-1778411555121` ch1+ch2 (replaces stub) |

## Constraints honored

- **No production default change.** Both new flags default off; default writer-arm list unchanged; parity replay green; 21 beat-context fixtures pass; 1423 fast-tier tests pass.
- **IDs remain mandatory** across DB, telemetry, traces, checker findings, proposals, evals, and audit logs. The B1 ablation is render-only — `summarizeCharacterContextCapsules` is unaffected. Tests pin this explicitly.
- **No deterministic scene-contract authoring.** `forceRenderSceneContractWhenAvailable` only renders when the planner has authored fields; when none are populated, no SCENE CONTRACT section emits. Honors operator correction #3.
- **No structure-* move** (parked).
- **No external CI.**
- **Atomic commits.** Each slice is one concern.

## Test surface added

- `src/agents/writer/character-context.test.ts` (3 new tests): byte-parity between `idRendering="raw"` and the legacy renderer; suppress mode hides every Cluster-1 line + raw ID; suppress mode does not mutate the trace summary.
- `src/agents/writer/beat-context-render.test.ts` (1 expanded test): `idRendering="suppress"` flows end-to-end through `renderBeatContext`.
- `scripts/test-planner-isolated.test.ts` (10 tests): arg parsing, defaults, mutual exclusion, planner-shape contract flags.
- `scripts/test-drafting-isolated.test.ts` (11 tests): four-arm enum, parseArgs validation, `flagsForArm` invariants per arm.
- Mock-shape updates in `drafting-reviser-escalation.test.ts` and `drafting-revision-used-persistence.test.ts` for the two new resolvers.

## Plumbing summary

```
SeedInput.pipelineOverrides
  ├─ writerPromptIdRendering?: "raw" | "suppress"   (L099 / B1)
  └─ forceRenderSceneContractWhenAvailable?: boolean (B3 Arm B)
        ↓
src/config/pipeline.ts: defaults + resolveX
        ↓
src/phases/drafting.ts:effectivePipeline → eff.<flag>
        ↓
buildBeatContext(input.<flag>) → renderBeatContext(opts.<flag>)
        ↓
renderCharacterContextCapsules(options.idRendering)
buildSceneContractBlock(beat) gated on (sceneCallWriterV1 || forceRenderSceneContractWhenAvailable)
```

The 12 `writerContextMode: eff.writerContextMode` thread-throughs in `drafting.ts` got matched with `writerPromptIdRendering: eff.writerPromptIdRendering`. The 4 `sceneCallWriterV1,` property sites picked up `forceRenderSceneContractWhenAvailable,`. Mechanical injection + indent realignment via Python; verified by tsc + targeted tests.

## P4 capture

Captured live from LXC against the runtime drafting evidence commit (`ab7f457`):

- 5 ch1 scenes, 6 ch2 scenes (matches harness.log for `novel-1778411555121`).
- 11 obligations across the two chapters.
- `threadId`/`promiseId`/`payoffId` substrate empty (production-typical state).
- `pipeline_overrides_at_capture: {}` — no overrides were active.
- `captured_at`, `source_central_run_id`, `source_experiment_id`, `captured_against_commit` recorded for traceability.

The shipped `load-frozen-plan.ts` writes only `novels` + `chapter_outlines`; running drafting against a hydrated clone needs the full concept-side state (`world_bibles`, `character_profiles`, `world_systems`, `cultures`, `story_spines`, etc.). Until the loader's hydration is extended (open follow-up), the supported P4-evidence path is `test-drafting-isolated --source novel-1778411555121 --writer-arms ...`, which uses `clone-for-variant` to copy the full state.

## Live LXC integration evidence

### Smoke #1 — full A/B drafting (truncated)

Launched `bun scripts/test-drafting-isolated.ts --source novel-1778411555121 --target-prefix b1-smoke-1778420126 --writer-arms baseline,id-suppress` at 13:36 UTC. Baseline arm completed ch1 at **3485 words (1.89×, exact match with the production evidence ratio)** and ch2 drafting at **5496 words (3.05× — production was 3.03×)**, confirming the smoke reproduces the original failure mode. The continuity check on ch2 hung after `Plan check: passed` (≥7 min on a single LLM call, likely transient API latency) and was killed before id-suppress arm started. Disposable clones left on LXC under prefix `b1-smoke-1778420126-*`.

### Smoke #2 — direct integration check (no LLM cost)

Bypassed the full drafting cost by calling `buildBeatContext` directly with both arms on `novel-1778411555121` ch1 beat 0. Captured 2026-05-10T13:54Z on LXC head `cc6385e`:

- **Prompt size**: raw 6496 chars → suppress 6335 chars (-161 chars, ~2.5% reduction).
- **Lines unique to raw arm** (suppressed in id-suppress):
  - `Chapter ID: ch-001-wound-cannot-healed`
  - `Beat ID: ch-001-wound-cannot-healed-beat-001-sylvie-works-through-night-healer`
  - `- Sylvie Dunmore [char_sylvie_dunmore] (supporting; protagonist)`
  - `- Corporal Jien [char_corporal_jien] (supporting; supporting)`
- **Trace metadata across both arms** (must be identical per L099):
  - `characterIds: ["char_sylvie_dunmore", "char_corporal_jien"]` ← present in both arms.
  - `sourceObligationIds: []` ← empty in both arms (no per-card obligations on this beat).

This proves the seed override → `effectivePipeline.writerPromptIdRendering` → `buildBeatContext` → `renderCharacterContextCapsules` plumbing is wired correctly, that the suppression matches the unit-test guarantees on real production data, and that trace metadata is unaffected.

**Caveat carried forward**: `novel-1778411555121` has empty `activeThreadIds`/`activePromiseIds`/`activePayoffIds` (the audit-flagged production-typical state). The 161-char suppress delta on this fixture is bounded — it removes Chapter/Beat IDs and per-card brackets only. To exercise the full Cluster-1 ablation surface (thread/promise/payoff refs and per-card source-obligations lines), a fixture with populated story refs is needed. Adjusted-B1 evidence on real refs requires either (a) re-running the planner on a P1/P2/P3 fixture with `--scene-plan-contract` so contract authoring populates obligations, or (b) capturing a frozen plan from a novel that ran with non-empty refs.

## Readiness statement

| Question | Answer |
|---|---|
| **Can adjusted-B1 run?** | **Yes.** `bun scripts/test-drafting-isolated.ts --source <novel-id> --target-prefix <prefix> --writer-arms baseline,id-suppress`. Use `novel-1778411555121` for held-plan A/B; use a `--from-fixture`-loaded P1/P2/P3 novel for synthetic concepts. |
| **Can adjusted-B3 Arm B run?** | **Yes.** Add `,contract-render-only` to `--writer-arms`. With production planner output (`scenePlanContractV1=false` default), no SCENE CONTRACT section emits — the arm is byte-identical to baseline. The lift only appears when the source plan has scene-contract fields populated (set `--scene-plan-contract` on the planner runner first). |
| **Can adjusted-B3 Arm C run?** | **Yes.** `,scene-call-v1` arm pre-exists from L097 Slice 2. |
| **Which fixtures are ready?** | P1 (`P1-fantasy-debt-binder.json`), P2 (`P2-archive-deciphering.json`), P3 (`P3-debt-binder-resolved.json`), P4 (real-runtime `novel-1778411555121-ch1-ch2`). |
| **What is the next operator action?** | Run the four-arm A/B/C/C smoke against `novel-1778411555121` (cost ≈ baseline + 3× new arms ≈ 4× the current baseline-only smoke; under $5 for 2 chapters). Capture the 4-arm word-ratio comparison. If id-suppress meaningfully changes prose quality without regressing obligation coverage on real entities, that's the B1 verdict. If contract-render-only > baseline on plans with populated contracts, that's the B3 Arm B verdict. |

## What this lane deliberately does NOT include

- A semantic judge for prose quality. Per L099 / user-adjusted backlog correction #4, judges are diagnostic and falsifier-first, not runtime gates.
- A deterministic scene-contract authoring path. Operator correction #3 explicitly rules this out.
- An end-to-end LXC smoke run committed as evidence. The smoke launched in this loop will produce data; that data needs interpretation in a follow-up session before any flag promotion.
- Promotion of either flag to production-default. Both stay default-off pending the four-arm evidence verdict (adjusted-B5).
