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

### Writer arms (used by `test-drafting-isolated.ts --writer-arms`)

| Arm | Description | Flag deltas vs production |
|---|---|---|
| `baseline` | Current production writer. | none — preserves all four flags at production defaults. |
| `id-suppress` | adjusted-B1 ablation. Cluster-1 raw-ID lines suppressed in the prose-writer prompt; trace metadata, DB rows, telemetry, and audit logs unaffected. | `writerPromptIdRendering="suppress"` |
| `contract-render-only` | adjusted-B3 Arm B preparation. Renders the SCENE CONTRACT block when populated, without enabling scene-call writer. No effect when the planner has authored no scene-contract field. | `forceRenderSceneContractWhenAvailable=true` |
| `scene-call-v1` | adjusted-B3 Arm C / L097 Slice 2. Full scene-call writer + retry-short-scenes-v1 expansion. | `sceneCallWriterV1=true` + `writerExpansionMode="retry-short-scenes-v1"` |

The first three arms are all beat-shaped writer calls. Differences between
them isolate ablation effects (id-suppress), contract-rendering effects
(contract-render-only), and the architecture shift (scene-call-v1) per
the adjusted-B1/B3 split in `docs/research/user-adjusted-backlog-2026-05-10.md`.

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
