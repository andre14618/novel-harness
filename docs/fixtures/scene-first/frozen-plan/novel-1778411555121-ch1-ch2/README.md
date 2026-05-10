# P4 Frozen-Plan Fixture — Capture Procedure

This directory holds the P4 fixture for adjusted-B2: a frozen plan
captured from `novel-1778411555121` (the 2026-05-10 evidence run).

`chapter-outlines.json` ships as a STUB (`is_stub: true`). The loader
(`scripts/fixture/load-frozen-plan.ts`) refuses to hydrate stub
manifests. The capture procedure below replaces the stub with a real
manifest before the operator can run drafting against P4.

## Why this is a stub

P4 is the only profile where the planner output must be held *literally*
fixed across A/B/C arms. Capturing the planner output requires reading
`chapter_outlines.outline_json` for `novel-1778411555121` (chapters 1-2
only), plus the concept-side artifacts the writer reads (`world_bibles`,
`character_profiles`). That data lives on the LXC Postgres DB
(`novel_harness_orchestrator`); the local repo cannot author it
synthetically.

## Capture procedure

Run on LXC. Replace `<commit-sha>` with the harness commit at the time
of the original 2026-05-10 run (visible in `git log --before=2026-05-10`).

```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun -e '
  import db from \"./src/db/connection\";
  const novelId = \"novel-1778411555121\";
  const outlines = await db\`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = \${novelId} AND chapter_number IN (1, 2)
    ORDER BY chapter_number ASC\` as any[];
  const seedRow = await db\`
    SELECT seed_json FROM novels WHERE id = \${novelId}\` as any[];
  const overrides = seedRow[0]?.seed_json?.pipelineOverrides ?? {};
  console.log(JSON.stringify({
    fixture_metadata: {
      profile: \"P4-real-runtime\",
      expected_baseline_ratio: \"1.89-3.03\",
      expected_baseline_failures: [
        \"ch1 ratio approx 1.89x; ch2 ratio approx 3.03x\",
        \"halluc-ungrounded retries on writer-coined officers; baseline observed 11\",
        \"stage-2 adherence rescues; baseline observed 5/11\",
        \"ch2 plan deviation flagged by chapter-plan-checker\"
      ],
      source_novel_id: novelId,
      source_central_run_id: 839,
      source_experiment_id: 480,
      captured_at: new Date().toISOString(),
      captured_against_commit: \"<commit-sha>\",
      pipeline_overrides_at_capture: overrides
    },
    outlines: outlines.map(r => ({
      chapterNumber: r.chapter_number,
      outline_json: typeof r.outline_json === \"string\" ? JSON.parse(r.outline_json) : r.outline_json
    }))
  }, null, 2));
'" > docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2/chapter-outlines.captured.json
```

Validate the captured file before replacing the stub:

```bash
bun -e '
  import { parseFrozenPlanManifest } from "./scripts/fixture/scene-first-fixture-schema";
  const path = "docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2/chapter-outlines.captured.json";
  const json = await Bun.file(path).json();
  const m = parseFrozenPlanManifest(json, path);
  console.log("ok:", m.outlines.length, "outline rows");
'
```

If the validation prints `ok: 2 outline rows`, replace the stub:

```bash
mv docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2/chapter-outlines.captured.json \
   docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2/chapter-outlines.json
```

Commit the captured manifest separately from any other change so the
capture provenance is traceable.

## What this fixture does NOT carry

The capture above writes only the chapter outline rows. World-bible and
character-profile rows are NOT captured in v0. The loader hydrates only
the `chapter_outlines` rows (plus the seed concept). This is acceptable
because:

- Drafting reads world bibles + character profiles via deterministic
  helpers that derive their context from the seed and the outline. The
  derivation is not byte-equal to a fresh planner re-run on the seed,
  but it is *closer* than re-planning would be.
- Hydrating the full concept-side state would duplicate the work
  `clone-for-variant.ts --target-phase drafting` already does for live
  novels. Adjusted-B2 v0 keeps the loader minimal; richer hydration is
  a follow-up if A/B/C results show the partial hydration is
  confounding.

If P4 hydration is found to confound the experiment (e.g. Arm A's
behavior on the hydrated fixture diverges materially from the original
2026-05-10 run on `novel-1778411555121`), file a follow-up to capture
`world_bibles`, `characters`, `world_systems`, `cultures`, `story_spines`
rows alongside the outlines.
