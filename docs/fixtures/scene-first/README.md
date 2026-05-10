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

```bash
# 1. Seed the novel from the fixture.
novel_id=$(bun scripts/fixture/load-concept-fixture.ts \
  --fixture docs/fixtures/scene-first/concepts/over-target/P1-fantasy-debt-binder.json \
  --quiet)
echo "novel: $novel_id"

# 2. Run concept + planning. The existing test-planner-isolated.ts
#    seed-name path runs both, but it loads from src/seeds/<name>.json,
#    not from a fixture-loaded novel. Use a small inline driver until a
#    dedicated --novel-from-fixture path lands as a follow-up:
bun -e "
  import { runConceptPhase } from './src/phases/concept';
  import { runPlanningPhase } from './src/phases/planning';
  import { initNovelRun } from './src/logger';
  import { setAutoMode, setResolverMode } from './src/cli';
  import { getMode } from './src/gates';
  import db from './src/db/connection';
  const id = '$novel_id';
  setAutoMode(true); setResolverMode(getMode(true));
  const [{ seed_json }] = await db\`SELECT seed_json FROM novels WHERE id = \${id}\` as any[];
  await initNovelRun(id);
  await runConceptPhase(id, seed_json);
  await runPlanningPhase(id);
  console.log('planning done for', id);
"

# 3. Run drafting A/B (existing baseline vs scene-call-v1 arms).
bun scripts/test-drafting-isolated.ts \
  --source "$novel_id" \
  --target-prefix "ab-$(date +%s)"
```

### P4 (frozen-plan fixture)

```bash
# 0. Capture the frozen plan ONCE per fixture revision.
#    See docs/fixtures/scene-first/frozen-plan/<slug>/README.md for the
#    exact ssh + DB-dump procedure. The default fixture ships as a stub
#    and the loader will refuse to hydrate it until capture completes.

# 1. Hydrate the novel from the captured fixture.
novel_id=$(bun scripts/fixture/load-frozen-plan.ts \
  --fixture docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2 \
  --quiet)
echo "novel: $novel_id"

# 2. Drafting only — the plan is already in place.
bun scripts/test-drafting-isolated.ts \
  --source "$novel_id" \
  --target-prefix "ab-$(date +%s)"
```

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

## Follow-up tickets (NOT in this slice)

1. **`--novel-from-fixture` mode for `test-planner-isolated.ts`** — the
   inline driver above for P1/P2/P3 is workable but should be folded
   into the existing planner runner so a single command can seed +
   run concept + run planning.
2. **Richer P4 hydration** — capture `world_bibles`, `characters`,
   `world_systems`, `cultures`, `story_spines` alongside outlines if A/B
   results show the partial hydration is confounding.
3. **Third writer arm** — `contract-render-only` (current beat-shaped
   writer + scene contract rendered) is part of adjusted-B3, not
   adjusted-B2. Requires a new pipeline override
   (`forceRenderSceneContractWhenAvailable`) plus a runner enum
   extension. Both deferred to the adjusted-B3 implementation slice.
