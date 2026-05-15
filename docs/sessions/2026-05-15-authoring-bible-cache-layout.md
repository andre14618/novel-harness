# Authoring-Bible Cache Layout

## Change

Production writer drafting briefs now split selected authoring-bible rules into
two rendered sections:

- `AUTHORING BIBLE STABLE PRELUDE` for selected baseline rules whose selector
  reasons are stable across scenes: `always_scene_pressure`,
  `always_sensory_palette`, and `baseline_voice`.
- `AUTHORING BIBLE SCENE SLICE` for selected scene-local story/world/character/
  relationship rules.

The stable prelude renders before the volatile `WRITER DRAFTING BRIEF` scene
header. The scene slice remains after the scene contract. The selected rule set
is unchanged; telemetry now records stable-prelude and scene-slice rule IDs.

## Evidence

Local gates:

```bash
bun test src/harness/authoring-bible.test.ts
bun test src/agents/writer/scene-context-rendering.test.ts
bun test scripts/test-drafting-isolated.test.ts src/config/pipeline.test.ts
./node_modules/.bin/tsc --noEmit --pretty false
git diff --check
```

Production-path ch1 no-retry smoke:

```bash
bun scripts/test-drafting-isolated.ts \
  --source rillgate-ch4-endpoint-hygiene-1778723371 \
  --target-prefix rillgate-authoring-bible-cache-layout-1778807422 \
  --writer-arms drafting-brief-authoring-bible-v1 \
  --chapter-start 1 \
  --chapter-limit 1 \
  --writer-only \
  --per-arm-timeout-ms 1200000 \
  --report-dir output/drafting-isolated/rillgate-authoring-bible-cache-layout-1778807422
```

Result:

- Novel:
  `rillgate-authoring-bible-cache-layout-1778807422-drafting-brief-authoring-bible-v1`
- Ch1 drafted 2768/3100 words.
- Plan-Assist readiness: 0 rows.
- Checker readiness: 0 rows.
- Writer-context events: 5/5 with `authoringBibleStablePrelude=true` and
  `authoringBibleSceneSlice=true`.
- Prompt common prefix across ch1 beat-writer prompts increased from the prior
  layout's 29 chars to 2857 chars.

Authoring-bible live review:

```bash
bun scripts/evals/authoring-bible-review.ts \
  --novel rillgate-authoring-bible-cache-layout-1778807422-drafting-brief-authoring-bible-v1 \
  --chapters 1 \
  --live \
  --model deepseek-v4-flash \
  --concurrency 8 \
  --max-tokens 900 \
  --max-rules-per-scene 30 \
  --output-dir output/authoring-bible-review/rillgate-authoring-bible-cache-layout-1778807422-ch1-live \
  --json
```

Result: 106/106 pass.

## Cache Telemetry

Provider-reported cache tokens are noisy enough that this evidence should not be
read as a proven cost win yet.

- Prior ch1 baseline:
  `rillgate-authoring-bible-selector-fixed-1778805393-drafting-brief-authoring-bible-v1`
  had beat-writer 21,753 prompt / 8,064 cached tokens, ratio 0.371.
- New no-retry ch1:
  `rillgate-authoring-bible-cache-layout-1778807422-drafting-brief-authoring-bible-v1`
  had beat-writer 22,087 prompt / 5,120 cached tokens, ratio 0.232.
- Immediate warm replicate:
  `rillgate-authoring-bible-cache-layout-rep-1778807609-drafting-brief-authoring-bible-v1`
  had beat-writer 28,979 prompt / 14,592 cached tokens, ratio 0.504, but included
  one retry and exact-prompt warmth from the previous run.

Conclusion: the deterministic prefix layout is implemented and verified, but
cache-token promotion should use a larger paired sample before claiming provider
cost savings.
