# Authoring-Bible Production Validation

Date: 2026-05-15
Status: active evidence
Source: `rillgate-ch4-endpoint-hygiene-1778723371`

## Goal

Validate whether the authoring-bible production writer path is ready for a
larger coherent candidate draft by checking selector/context inclusion, bounded
drafting behavior, character voice differentiation, and selected-rule
fulfillment.

## Evidence

Deterministic selector/context audit:

- Command: `bun scripts/audits/authoring-bible-selector-audit.ts --novel rillgate-ch4-endpoint-hygiene-1778723371 --pack-ids rillgate-contrast-v1 --output-dir output/authoring-bible-selector-audit/rillgate-authoring-bible-full-source-1778809989 --json`
- Artifact: `output/authoring-bible-selector-audit/rillgate-authoring-bible-full-source-1778809989/authoring-bible-selector-audit.md`
- Result: 49/49 scenes selected a slice, 1,292 selected rules, 0 errors, 2 warnings.
- Cache-stable prelude: one stable hash across all 49 scenes.
- Warnings: chapter 10 scenes 1-2 selected 33 rules, just above the 32-rule warning threshold, because Kael/Tessa/Orin are all present and pull three character clusters plus reciprocal relationship rows.

Bounded drafting A/B:

- Command: `bun scripts/test-drafting-isolated.ts --source rillgate-ch4-endpoint-hygiene-1778723371 --target-prefix rillgate-authoring-bible-ab-1778809999 --writer-arms drafting-brief-tight-anchored-v1,drafting-brief-authoring-bible-v1 --writer-only --chapter-start 1 --chapter-limit 3 --per-arm-timeout-ms 1800000 --report-dir output/drafting-isolated/rillgate-authoring-bible-ab-1778809999`
- Artifact: `output/drafting-isolated/rillgate-authoring-bible-ab-1778809999/drafting-isolated-report.md`
- Tight anchored: 3/3 chapters, 8,945/9,300 words, mean ratio 0.962, Plan-Assist 0, checker readiness 0.
- Authoring bible: 3/3 chapters, 9,474/9,300 words, mean ratio 1.019, Plan-Assist 0, checker readiness 0.
- Cache prefix telemetry: authoring-bible arm averaged 2,826 stable-prefix chars with one exact hash across 15 writer calls; tight anchored averaged 898 stable-prefix chars with one exact hash.

Character voice differentiation:

- Artifacts:
  - `output/character-voice-differentiation/rillgate-authoring-bible-ab-1778809999/tight-anchored/character-voice-differentiation-review.md`
  - `output/character-voice-differentiation/rillgate-authoring-bible-ab-1778809999/authoring-bible/character-voice-differentiation-review.md`
- Result: tight anchored 9/9 pass, authoring bible 9/9 pass on multi-character scenes.
- Judge hardening: DeepSeek returned useful concepts but inconsistent JSON shape on the first attempt, so the evaluator now normalizes keyed `characterSignals`, snake-case fields, and string booleans into binary/categorical gates.

Selected authoring-bible rule review:

- Command: `bun scripts/evals/authoring-bible-review.ts --novel rillgate-authoring-bible-ab-1778809999-drafting-brief-authoring-bible-v1 --chapters 1-3 --live --pack-ids rillgate-contrast-v1 --max-rules-per-scene 30 --concurrency 8 --set-name rillgate-authoring-bible-ab-1778809999-authoring-bible --output-dir output/authoring-bible-review/rillgate-authoring-bible-ab-1778809999/authoring-bible --json`
- Artifact: `output/authoring-bible-review/rillgate-authoring-bible-ab-1778809999/authoring-bible/authoring-bible-review.md`
- Result: 360/360 pass, repair layer `none`.

## Non-Blocking Finding

Both drafting arms carried the same low planning-context readiness item:

- Label: `REFERENCE-CONTEXT-UNRESOLVED`
- Target: `scene_plan:ch-002-cheap-contract-scene-002-kael-weighs-risk-against-mira:description`
- Meaning: the scene references `fact-kael-signs-contract`, but resolved reader-info context did not reach the writer prompt.
- Assessment: not authoring-bible-specific and not a blocker for the next candidate draft; it is a source/context hygiene follow-up if the next broader draft shows a real prose consequence.

## Decision

The authoring-bible path is ready for a larger candidate draft attempt as a
default-off production writer arm. This does not justify flipping
`authoringBibleMode="v1"` on globally because the A/B was bounded to chapters
1-3 and used writer-only draft capture to isolate writer behavior from settle
loops.

Recommended next run: full Rillgate candidate draft through the production
path with `drafting-brief-authoring-bible-v1`, normal checker settle loops, and
quality telemetry enabled as advisory evidence.

## Verification

- `bun test scripts/audits/authoring-bible-selector-audit.test.ts src/harness/authoring-bible.test.ts`
- `bun test scripts/evals/character-voice-differentiation-review.test.ts`
- `./node_modules/.bin/tsc --noEmit --pretty false`
- `git diff --check`
