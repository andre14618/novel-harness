---
status: active
updated: 2026-05-09
role: session-record
lane: upstream-planning-methodology
---

# Corpus Structure Recreation POC Slice

## Change Packet

- Optimized layer: upstream concept/planning methodology.
- Exact change: create a diagnostic path for turning the local corpus novel's
  Stage 6 structural annotations into a chapter/scene reference scaffold.
- Held constant: production planner, writer, checker policy, UI, proposals,
  and runtime defaults.
- Expected benefit: make the intended planner granularity concrete before
  testing new planner prompts or prose generation.
- Downstream projection: if the planner can recreate comparable structure from
  compressed premise/context, then scene-first writing and scene-scoped
  checking have a realistic target.
- Evidence gate: local reference report first, then planner recreation
  attempt, then operator side-by-side review, then optional prose POC.

## Implemented

- Added `docs/charters/corpus-structure-recreation-poc.md`.
- Added `scripts/evals/corpus-structure-reference.ts`.
- Added `diagnostics:corpus-structure-reference`.
- Added a focused unit test for the reference aggregation.
- Updated methodology docs to treat corpus structure recreation as a high-value
  diagnostic option while keeping old corpus beats as annotation granularity,
  not the future writer call unit.

## Source Boundary

The corpus reference may include source-derived plot summaries only in ignored
`output/` artifacts. Committed docs describe the method, schema, metrics, and
decision gates, not the source novel's full outline.

## First Local Run

Metrics-only command:

```bash
bun run diagnostics:corpus-structure-reference -- \
  --novel salvatore-icewind-dale \
  --book crystal_shard \
  --output-dir output/corpus-structure-reference/crystal_shard
```

Private structural-review command:

```bash
bun run diagnostics:corpus-structure-reference -- \
  --novel salvatore-icewind-dale \
  --book crystal_shard \
  --include-summaries \
  --output-dir output/corpus-structure-reference/crystal_shard-with-summaries
```

## Next

Run the reference report, inspect the chapter/scene granularity, then design a
default-off planner recreation diagnostic:

```text
compressed corpus premise/context
  -> generated chapter/scene planner contract
  -> structural comparison against the reference
  -> operator side-by-side decision
```

## Continued Slice

User direction: make the scaffold sufficient to remake by plan and write an
example imitative chapter. Interpreted as full structural imitation, not source
prose/style copying.

Added `diagnostics:corpus-recreation-poc`, which:

- reads a local corpus reference, preferably the `--include-summaries` version;
- builds an original analog seed with different names, premise, artifact,
  world rules, and story debts;
- asks DeepSeek to create a scene-first chapter plan matching the reference
  chapter's scene count, scene sizes, value-turn cadence, MICE/thread sequence,
  gap/beat-hint density, and structural-function hints;
- optionally drafts one original example chapter from that plan;
- writes all detailed artifacts to ignored `output/`;
- emits deterministic plan/prose comparison JSON plus a compact report.

Command:

```bash
bun run diagnostics:corpus-recreation-poc -- --live --write --scene-calls \
  --reference output/corpus-structure-reference/crystal_shard-with-summaries/reference.json \
  --chapter 1 \
  --model deepseek-v4-flash \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls
```

## Live Evidence

Whole-chapter JSON writing preserved the plan shape but compressed prose. The
best whole-chapter run matched 4/4 scenes with no source leakage, but landed
below the target prose length and failed the deterministic prose-shape check.

Scene-call writing passed the first usable scaffold gate:

```text
output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls-r4/report.md
```

Result:

- target: 4 scenes, 1832 reference words, 19 annotation beats;
- plan fit: 4/4 scenes, 4/4 polarity sequence, 4/4 MICE/thread sequence,
  19/19 beat-hint shape, no plan issues;
- prose fit: 4/4 scenes, 1583/1832 words, all scene minimums met;
- source boundary: no forbidden source terms found.

Implementation note: the scene writer uses per-scene calls, deterministic
scene word minimums, prior-prose expansion on retry, best-attempt retention,
and a bounded retry for invalid JSON. This is diagnostic scaffolding only. It
does not change production planner or writer routing.
