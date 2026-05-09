---
status: active
updated: 2026-05-09
kind: experiment-charter
lane: upstream-planning-methodology
---

# Corpus Structure Recreation POC

## Question

Can Novel Harness recreate the significant structural shape of a proven corpus
novel at the right planning granularity before it writes prose?

This means recreating chapter and scene functions, plot turns, promise
movement, character pressure, world constraints, value shifts, and endpoint
propulsion. It does not mean copying prose, voice, phrasing, or full expressive
outline text.

## Change Packet

- Optimized layer: upstream concept/planning methodology.
- Exact change: add a diagnostic reference scaffold that reads local
  corpus-structure annotations and turns them into chapter/scene granularity
  targets.
- Held constant: production planner, writer, checker policy, proposal flow, UI,
  and runtime defaults.
- Expected benefit: make the target granularity visible before prompt changes,
  so planner experiments can be judged against meaningful scene/chapter
  structure rather than beat count.
- Downstream projection: if the planner can recreate this reference structure
  from compressed premise/context, then scene-first writing and scene-scoped
  checking have a concrete target.
- Evidence gate: local reference report, then planner recreation attempt, then
  side-by-side operator review, then optional prose POC.

## Source Boundary

The corpus source is local and copyrighted. Committed docs and fixtures should
contain metrics, schemas, and methodology only. Full reconstructed structural
outlines or plot summaries belong in ignored `output/` artifacts unless the
operator explicitly chooses to curate a non-expressive abstraction for commit.

The working distinction:

- allowed in committed docs: counts, schema fields, metric summaries,
  diagnostic commands, non-expressive conclusions;
- allowed in ignored local artifacts: corpus-derived beat summaries and
  chapter/scene reference rows for private comparison;
- not allowed as a committed target: prose imitation, copied passages, or a
  detailed expressive retelling of the source novel.

## Method

1. Build a local structural reference from existing Stage 6 corpus outputs:
   scenes, beats, value-charge tags, MICE tags, and McKee-gap tags.
2. Treat scenes as the planner target unit.
3. Treat corpus beats as annotation granularity inside scenes, not as the
   writer call unit.
4. Ask the planner to recreate a comparable chapter/scene contract shape from
   compressed upstream premise/context.
5. Compare against the reference on structural fidelity:
   - chapter count and function cadence;
   - scene count per chapter;
   - plot-point coverage at scene granularity;
   - value-shift and MICE/thread movement;
   - promise/story-debt opens, progress, and payoff;
   - character agency/materiality;
   - operational world constraints;
   - chapter endpoint propulsion.

## First Command

Metrics-only, safe to inspect and summarize:

```bash
bun run diagnostics:corpus-structure-reference -- \
  --novel salvatore-icewind-dale \
  --book crystal_shard \
  --output-dir output/corpus-structure-reference/crystal_shard
```

Private structural-review mode, still ignored by git:

```bash
bun run diagnostics:corpus-structure-reference -- \
  --novel salvatore-icewind-dale \
  --book crystal_shard \
  --include-summaries \
  --output-dir output/corpus-structure-reference/crystal_shard-with-summaries
```

Outputs:

- `reference.json`
- `reference.md`

## Success Criteria

The reference scaffold is useful if it lets us answer these questions without
reading the source prose during planner review:

- What is the scene/chapter granularity of the corpus novel?
- Which scenes are load-bearing rather than transitional?
- Where do value turns, promise movement, and MICE/thread events cluster?
- What would a planner need to emit for a writer/checker pair to attempt a
  similar commercial structure?

The planner recreation attempt is useful if it can match the structural target
well enough for an operator to say the plan is aiming at the right kind of
story shape, even if names, events, and prose are original.

## Non-Goals

- Do not train or route a writer from this POC.
- Do not promote corpus beat size back into the writer interface.
- Do not use a hard beat-count win as success.
- Do not change UI or checker gating policy.
- Do not commit source-derived detailed plot outlines.

## Next Slice

Use the reference scaffold to create a default-off planner recreation
diagnostic:

```text
compressed corpus premise/context
  -> planner scene/chapter contract
  -> structural comparison against reference
  -> operator side-by-side review
```

Only after that should the lane consider a prose POC.

## Recreation POC Command

Build the reference with summaries first so the planner sees the source
chapter's structural functions, then translate those functions into the
original analog seed:

```bash
bun run diagnostics:corpus-structure-reference -- \
  --novel salvatore-icewind-dale \
  --book crystal_shard \
  --include-summaries \
  --output-dir output/corpus-structure-reference/crystal_shard-with-summaries
```

Then run the plan-and-write POC:

```bash
bun run diagnostics:corpus-recreation-poc -- --live --write --scene-calls \
  --reference output/corpus-structure-reference/crystal_shard-with-summaries/reference.json \
  --chapter 1 \
  --model deepseek-v4-flash \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls
```

Outputs:

- `packet.json`: the structural imitation packet.
- `plan.json`: the original analog chapter/scene plan.
- `plan-comparison.json`: deterministic fit against the reference scaffold.
- `chapter.md`: the generated original example chapter.
- `chapter-comparison.json`: deterministic prose-shape checks.
- `report.md`: compact operator review summary.

Promotion requires operator review. A single imitative chapter is a baseline,
not proof that runtime planning or writing should change.

## First POC Evidence

The first passing local run used scene-level writer calls rather than one
chapter-level JSON writer call. Whole-chapter writing preserved scene count but
compressed the prose too aggressively. Scene calls made the plan-to-prose
contract observable per scene.

Passing artifact:

```text
output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls-r4/report.md
```

Result:

- plan fit: 4/4 scenes, 4/4 polarity sequence, 4/4 MICE/thread sequence,
  19/19 beat-hint shape;
- prose fit: 4/4 scenes, 1583/1832 words, all scene minimums met;
- source boundary: no forbidden source terms found;
- conclusion: scaffold is sufficient for an operator to review an original
  structural analog chapter beside the private reference.

This supports a next diagnostic cohort, not a production promotion. The next
question is whether multiple chapters and multiple source chapters still show
the same scene-level plan/write stability.

## Methodology Conclusion

The POC supports a scene-first direction, not a return to beat-level writing.
The corpus-derived beats are useful as annotation granularity: they capture
turns, obligations, value movement, and source-linked structure inside scenes.
They should not be promoted as the default writer-call unit just because they
can be enumerated.

Existing semantic checks are still relevant. The harness already has
`adherence-events`, `halluc-ungrounded`, chapter-plan checking, and
planner-discernment diagnostics. The conclusion is not that semantic checking
is missing; it is that those checks currently target legacy beat/chapter
surfaces. The next diagnostic should adapt the same narrow semantic-call shape
to scene contract plus scene prose before creating new checkers.

Initial scene semantic review should ask:

- does the prose enact the scene goal, opposition, turn, outcome, and
  consequence?
- do required character/world/story obligations materially affect the scene?
- do beat hints land somewhere in the scene without forcing beat-by-beat prose?
- does the scene preserve structural function without copying source events?

## Word Count And Source Boundary

Scene and chapter word counts are pacing diagnostics, not hard approval gates,
for this POC. A short scene should be reported as a warning so the operator can
notice synopsis-level compression, but it should not force retries by itself.
Retries should be reserved for malformed output, missing required structure, or
source-boundary failures.

`source leakage` means forbidden source terms, names, places, or exact source
events appear in the generated analog artifact. It is not a synonym for "the
scene has the same structural function." Structural imitation is the point of
this diagnostic; literal copied source details remain hard failures.

When side-by-side review is available, review the actual chapter next to the
plan, deterministic comparison, and semantic review before adding more prompt
knobs. If the prose reads like summary despite acceptable word ratios, add a
narrow scene-completeness semantic diagnostic rather than reintroducing hard
word-count retry loops.

## Static Review Artifact

Use a static local HTML report for operator review before building a React
surface:

```bash
bun run diagnostics:corpus-recreation-review -- \
  --poc-dir output/corpus-recreation-poc/<run> \
  --output output/corpus-recreation-poc/<run>/review.html
```

The report is read-only. It displays the private reference shape, generated
scene contract, generated prose, deterministic issues/warnings, and semantic
findings side by side. It does not call a model, create proposals, add gates,
or promote a runtime method.

When a review artifact is generated for the operator, open it locally before
handoff and also report the path.

## Scene Semantic Review Diagnostic

Use the default-off semantic review adapter after a plan/write POC run:

```bash
bun run diagnostics:corpus-recreation-semantic-review -- --live \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls-r4 \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls-r4/semantic-review-live \
  --model deepseek-v4-flash \
  --mode evidence-first \
  --concurrency 4
```

Purpose:

- compare scene contract against scene prose at a scope small enough for a
  cheap judge to show discernment;
- surface weak scene choices, generic motivation, unused world pressure, and
  missing relationship movement;
- preserve beats as internal annotations and trace refs, not as the writer
  call or checker unit;
- feed operator discussion before changing planner prompts, writer prompts, or
  production checkers.

This diagnostic must not auto-rewrite, block, or promote a methodology by
itself. Promotion still requires operator review plus downstream prose evidence.

## Aggregate Diagnostic

When multiple local POC runs exist, aggregate them instead of hand-reading each
report:

```bash
bun run diagnostics:corpus-recreation-aggregate -- \
  --poc-dir output/corpus-recreation-poc/<run-a> \
  --poc-dir output/corpus-recreation-poc/<run-b> \
  --output output/corpus-recreation-poc/<aggregate>.md \
  --json output/corpus-recreation-poc/<aggregate>.json
```

The aggregate joins deterministic plan/prose checks with semantic review
summaries. Use it to decide what needs operator review or another controlled
sample. Do not treat it as production promotion proof.

Low semantic findings can be converted into manual review candidates:

```bash
bun run diagnostics:corpus-recreation-readiness -- \
  --poc-dir output/corpus-recreation-poc/<run-a> \
  --output output/corpus-recreation-poc/<readiness>.md \
  --json output/corpus-recreation-poc/<readiness>.json
```

This preserves exact IDs and asks operator disposition questions. It should
feed Plan Readiness Review, not automatic rewrites.

## Materiality Variant

The planner POC supports a default-off prompt variant:

```bash
--planner-variant materiality-v1
```

This asks the planner to attach `materialityTest` to each obligation: the
specific choice, cost, constraint, relationship state, outcome, or future
pressure that the exact source ID must change. Use it only as a diagnostic arm
against a baseline run. It is not a runtime default.
