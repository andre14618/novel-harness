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
The writer-context trace also records `cacheStablePrefix` chars/hash, with the
boundary set immediately before `WRITER DRAFTING BRIEF`; isolated-run reports
summarize average prefix length and distinct prefix hashes.

## Prefix Ordering

The current order is:

1. Stable system prompt, outside the user prompt.
2. `SCENE EXECUTION FLOOR`, stable for the writer arm/mode.
3. `AUTHORING BIBLE STABLE PRELUDE`, byte-identical for baseline story, sensory,
   and voice rules selected by stable reasons.
4. `WRITER DRAFTING BRIEF`, the first volatile scene boundary.
5. Scene budget/load control, scene contract, scene-local authoring-bible slice,
   obligations, anchors, character context, references, reader state, and setting.

This is the cache-maximizing order that does not starve the writer of needed
local context: stable global material moves before the volatile scene boundary;
scene-specific task, contract, obligations, character, reader-state, and setting
stay after it. The split also avoids duplicating stable bible rules in the
scene-local slice.

## Inclusion Constraint

Prefix stability is not permission to overinclude context. The stable prelude
must be made from writer-useful material already selected for the arm, not from
extra cards or rules added only because they would cache well. Scene-local
character, relationship, world-system, obligation, reference, reader-state, and
setting context should stay local unless evidence shows the writer needs a
stable global rule. If a future slice wants a larger stable prefix, it should
prove that the added context improves prose or harness behavior, not only cache
tokens.

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
- Unit tests now assert exact byte-identical stable prefixes across different
  scene briefs and require volatile fields to appear only after the prefix
  boundary.

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
