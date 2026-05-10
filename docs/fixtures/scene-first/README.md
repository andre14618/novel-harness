# Scene-First Lane Fixtures (adjusted-B2)

Mixed fixture set for the adjusted scene-level plan/write lane defined
in `docs/research/user-adjusted-backlog-2026-05-10.md`. v0 covers four
profiles (P1-P4). This fixture set is the precondition for adjusted-B3
(scene-contract A/B/C). It does not change runtime behavior.

## Profiles

| Profile | Path | Loader | Surfaces |
|---|---|---|---|
| P1 over-target | `concepts/over-target/P1-fantasy-debt-binder.json` | `load-concept-fixture.ts` | live failure profile (1.5x+ word ratio, casting-gap halluc retries, motif repetition) |
| P2 undershoot | `concepts/undershoot/P2-archive-deciphering.json` | `load-concept-fixture.ts` | inverse failure mode; only fixture that fires `retry-short-scenes-v1` |
| P3 pre-resolved | `concepts/pre-resolved/P3-debt-binder-resolved.json` | `load-concept-fixture.ts` | clean attribution; scene-contract delta isolated from hallucination noise |
| P4 real-runtime | `frozen-plan/novel-1778411555121-ch1-ch2/` | `load-frozen-plan.ts` | held-plan generalization probe; STUB until captured per its `README.md` |

Each fixture's `fixture_metadata` block declares expected baseline ratio,
expected baseline failures, scene-contract population target, and
provenance. None of these fields is consumed by the runtime — they are
operator-readable expectations.

## Loaders

Two loader scripts live under `scripts/fixture/`:

- `load-concept-fixture.ts` — reads a concept-level fixture (P1/P2/P3),
  inserts a `novels` row with the concept as the seed, prints the
  novel-id. The concept and planning phases must still run before
  drafting; the loader does not invoke them.
- `load-frozen-plan.ts` — reads a frozen-plan directory (P4), inserts
  a `novels` row plus the captured `chapter_outlines` rows, prints the
  novel-id. Drafting can run directly. Stub manifests are rejected with
  a pointer to the capture procedure.

Both loaders accept `--quiet` for script-friendly novel-id-only output,
and `--novel-id <id>` to override the auto-derived id.

## Operator command examples

### P1 / P2 / P3 (concept-level fixture)

`scripts/test-planner-isolated.ts --from-fixture <path>` reads a parsed
concept fixture, creates a fresh novel with the fixture's concept block
as seed, and runs concept + planning end-to-end. The resulting novel-id
is printed (look for `novel: fixture-...`); chain it into the drafting
runner.

```bash
# 1. Concept + planning from a fixture.
bun scripts/test-planner-isolated.ts \
  --from-fixture docs/fixtures/scene-first/concepts/over-target/P1-fantasy-debt-binder.json \
  --native-planning-contract \
  --scene-plan-contract        # only when adjusted-B3 evidence on a planner-authored contract is wanted
# capture the printed novel-id, e.g. fixture-P1-fantasy-debt-binder-1778500000000

# 2. Drafting A/B/C across the four supported arms.
bun scripts/test-drafting-isolated.ts \
  --source <novel-id-from-step-1> \
  --target-prefix "ab-$(date +%s)" \
  --writer-arms baseline,id-suppress,contract-render-only,scene-call-v1
```

### P4 (frozen-plan fixture)

The shipped P4 fixture is a real captured manifest from
`novel-1778411555121` ch1+ch2. The `load-frozen-plan.ts` loader
hydrates only `novels` + `chapter_outlines`; running drafting against
its hydrated clone needs the rest of the concept-side state
(`world_bibles`, `character_profiles`, `world_systems`, `cultures`,
`story_spines`, etc.). Until the loader is extended (follow-up #2 below),
the supported path for held-plan A/B/C against P4 is to clone the
existing source novel directly via `clone-for-variant.ts` and let
`test-drafting-isolated` orchestrate the clone:

```bash
# Cleanest path while load-frozen-plan.ts hydration is partial:
bun scripts/test-drafting-isolated.ts \
  --source novel-1778411555121 \
  --target-prefix "p4-$(date +%s)" \
  --writer-arms baseline,id-suppress,contract-render-only,scene-call-v1
```

The captured fixture file (`frozen-plan/novel-1778411555121-ch1-ch2/chapter-outlines.json`)
remains the durable provenance record (source novel id, central run id,
experiment id, captured-at timestamp, captured-against commit) so a
future loader extension can rehydrate from it cleanly.

### Hang-resistant operator commands (recommended)

The chapter-level checker settle loops (plan-check, continuity,
validation, halluc-ungrounded routing, integrity / validation reviser)
can hang on slow API calls and block writer-arm evidence collection
even when the writer arm itself ran fine. Two knobs make writer-arm
A/B/C/C runs resistant to that failure shape:

- `--writer-only` sets the per-novel `draftCaptureModeV1` pipeline
  override on every arm. Drafting saves + approves each chapter
  immediately after the writer assembles its prose; checker settle
  loops are skipped. Use this when the experiment cares only about
  writer prose differences across arms; run any checker diagnostics
  post-hoc on the saved drafts.
- `--per-arm-timeout-ms <N>` caps per-arm wallclock. On timeout the
  runner collects whatever `chapter_drafts` did finish, records the
  timeout as the arm's error, and proceeds to the next arm.

Example commands (P4 directly via clone-for-variant):

```bash
# P4 baseline vs id-suppress, writer-only, 30-min per-arm cap
bun scripts/test-drafting-isolated.ts \
  --source novel-1778411555121 \
  --target-prefix "p4-b1-$(date +%s)" \
  --writer-arms baseline,id-suppress \
  --writer-only \
  --per-arm-timeout-ms 1800000

# P4 baseline vs contract-render-only (only meaningful when the source
# plan has scene-contract fields populated; novel-1778411555121 has
# scenePlanContractV1=false, so the prompts are identical there)
bun scripts/test-drafting-isolated.ts \
  --source <novel-id-with-scenePlanContractV1=true> \
  --target-prefix "p4-b3b-$(date +%s)" \
  --writer-arms baseline,contract-render-only \
  --writer-only \
  --per-arm-timeout-ms 1800000

# Four-arm smoke (B1 + B3 Arm B + B3 Arm C, all hang-resistant)
bun scripts/test-drafting-isolated.ts \
  --source novel-1778411555121 \
  --target-prefix "four-arm-$(date +%s)" \
  --writer-arms baseline,id-suppress,contract-render-only,scene-call-v1 \
  --writer-only \
  --per-arm-timeout-ms 1800000
```

Without `--writer-only`, every arm runs the full chapter-level checker
settle loops; useful when the experiment wants the realistic
production-shape pipeline. With `--writer-only` the experiment reduces
to writer-arm prose differences only.

### Writer arms (used by `test-drafting-isolated.ts --writer-arms`)

The harness is migrating from the legacy beat-shaped writer to the
scene-first writer. `scene-call-v1` is the direction; `baseline` is the
legacy control retained for git history and rollback only — it is
**not** the future and should not be optimized as if it were. See
`docs/sessions/2026-05-10-scene-migration-plan.md` for the slice
ordering of the full rename + default flip.

| Arm | Posture | Description | Flag deltas vs production default |
|---|---|---|---|
| `scene-call-v1` | **Direction.** | Scene-first writer — calls the writer once per `outline.scenes[]` entry, surfaces planner-authored scene-contract fields (goal/opposition/turningPoint/crisisChoice/...) as a SCENE CONTRACT block, runs `retry-short-scenes-v1` expansion when output undershoots the advisory floor. Per L092/L095/L097. | `sceneCallWriterV1=true` + `writerExpansionMode="retry-short-scenes-v1"` |
| `contract-render-only` | Intermediate. | Legacy writer call shape with the SCENE CONTRACT block rendered when populated. Lets us isolate "does the contract text help?" from "does the scene-call architecture help?" before the rename completes. No effect when the planner has authored no scene-contract field. | `forceRenderSceneContractWhenAvailable=true` |
| `baseline` | **Legacy control — archived as historical.** | Current production writer (legacy beat-shaped prompt template, no SCENE CONTRACT block). Preserved for git rollback evidence and as a baseline ratio for the cohort that produced `novel-1778411555121`. Was never validated to production-quality bar; do not treat as a target. | none |
| `id-suppress` | Cross-cutting hygiene ablation. | adjusted-B1 — Cluster-1 raw-ID lines suppressed in the prose-writer prompt; trace metadata, DB rows, telemetry, and audit logs unaffected. Combinable with any arm via a follow-up override. | `writerPromptIdRendering="suppress"` |

Active evidence direction (post 2026-05-10 strategic call): the next
fixed-plan A/B should compare **`baseline` vs `scene-call-v1`**, with
`contract-render-only` optional as a sub-decomposition lever. id-suppress
is auxiliary and does not need to be on the critical path.

Recommended hang-resistant scene-direction smoke:

```bash
bun scripts/test-drafting-isolated.ts \
  --source <novel-id-with-scenePlanContractV1=true planning> \
  --target-prefix "scene-first-$(date +%s)" \
  --writer-arms baseline,scene-call-v1 \
  --writer-only \
  --per-arm-timeout-ms 1800000
```

`scene-call-v1` only differs from `baseline` when the planner has
authored scene-contract fields (`scenePlanContractV1=true`). On
`novel-1778411555121` (planned with `scenePlanContractV1=false`), both
arms produce near-identical prompts; to exercise the scene-first arm
meaningfully, plan a P1/P2/P3 fixture with
`bun scripts/test-planner-isolated.ts --from-fixture <path> --scene-plan-contract`
and use the resulting novel-id as `--source`.

## Constraints honored

- No production behavior change. The loaders only INSERT into `novels`
  and `chapter_outlines`; they do not modify any agent prompt, schema,
  or runtime flag default.
- Traceability IDs are mandatory and remain visible in DB / telemetry /
  trace metadata. Adjusted-B1 (writer-prompt ID ablation) is a separate
  ticket. See L099.
- Scene contracts are not promoted. Existing `sceneCallWriterV1=false`
  default is unchanged.
- `structure-*` agents are not moved. The corpus-only namespace is
  audited but un-touched (see `docs/research/structure-agents-namespace-audit-2026-05-10.md`).
- Disposable test data only. Fixtures are concept-shaped JSON the
  operator can re-author without touching production novels. P4 is the
  one fixture sourced from a real runtime artifact, with explicit
  capture provenance in its `fixture_metadata`.

## Follow-up tickets

1. **DONE** — `--from-fixture` mode added to `test-planner-isolated.ts`
   (commit `e48f996`).
2. **OPEN** — Richer P4 hydration. The shipped loader writes only
   `novels` + `chapter_outlines`. Add `world_bibles`, `characters`,
   `world_systems`, `cultures`, `character_cultures`,
   `character_system_awareness`, `story_spines`, `retrieval_config` to
   the captured fixture and to the loader's hydration set so a clone
   can run drafting without depending on the source novel still
   existing. Until then, drive P4 evidence via
   `--source novel-1778411555121` directly (above).
3. **DONE** — Third writer arm `contract-render-only` shipped
   alongside the new `forceRenderSceneContractWhenAvailable` pipeline
   override and the `id-suppress` arm (commit `138780c`). All four
   arms are usable through `test-drafting-isolated.ts --writer-arms`.
