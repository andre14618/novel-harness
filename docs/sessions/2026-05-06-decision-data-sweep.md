---
status: recorded
updated: 2026-05-06
role: session-record
---

# Decision Data Sweep — 2026-05-06

This record captures a bounded evidence pass used to decide whether the next
authoring-harness work should add more scaffolding or gather stronger decision
data from existing diagnostics.

## Question

The active concern was overscaffolding: the repo already has substantial
visibility, proposal, lineage, and diagnostic infrastructure. Before adding
more surfaces, the useful question was whether existing evidence identifies a
specific authoring bottleneck strongly enough to justify the next implementation
slice.

## Commands

Candidate scan:

```bash
bun run diagnostics:semantic-gate-candidates -- \
  --limit 10 \
  --scan-limit 50 \
  --output output/evals/semantic-gate-candidates/decision-data-20260506T183549Z.json
```

Disposable cohort over the top two candidates:

```bash
bun run diagnostics:semantic-gate-cohort-matrix -- \
  --candidate-report output/evals/semantic-gate-candidates/decision-data-20260506T183549Z.json \
  --candidate-limit 2 \
  --chapters 1 \
  --variant capped:beats=4 \
  --variant control:source \
  --parallel-sources 2 \
  --parallel-variants 2 \
  --child-timeout-minutes 15 \
  --continuity-editorial-flag-proposals \
  --output-base output/evals/semantic-gate-cohort-matrix/decision-data-20260506T183549Z
```

Artifacts:

- `output/evals/semantic-gate-candidates/decision-data-20260506T183549Z.json`
- `output/evals/semantic-gate-cohort-matrix/decision-data-20260506T183549Z/summary.json`
- `output/evals/semantic-gate-cohort-matrix/decision-data-20260506T183549Z/report.md`

## Result

The candidate scan selected ten novels from fifty inspected rows: five high
priority and five medium priority. The top lens was mostly `plan_shape`, with
`writer_expansion` secondary. Load-bearing checker blockers were not the top
signal after continuity discounts.

The cohort ran four disposable one-chapter variant arms across two source
novels.

| Variant | Completed | Clean Pass | Mean Risk | Mean Word Ratio | Calls | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `capped:beats=4` | 2/2 | 1 | 51.67 | 1.42 | 48 | `$0.0177` |
| `control:source` | 0/2 | 0 | 1333.14 | 3.31 | 276 | `$0.0831` |

Control outcomes:

- `novel-1777761636607`: timed out after 900 seconds with a 13-beat source
  outline, 4,382 draft words against a 1,500-word target, 162 LLM calls, and
  unresolved plan/length pressure.
- `novel-1777721066908`: stopped at a pending Plan-Assist gate with a 13-beat
  source outline, 5,559 draft words against a 1,500-word target, 114 LLM calls,
  and a halluc-ungrounded blocker on `"Framework"`.

Capped outcomes:

- `novel-1777761636607`: completed and approved Chapter 1 at 1,748 words. It
  required targeted Plan Adherence rewrites because the emotional arc reversed
  near the end of the chapter.
- `novel-1777721066908`: completed and approved Chapter 1 at 2,504 words. It
  still carried writer-expansion pressure and one targeted integrity rewrite
  for duplicated prose.

## Interpretation

This is not enough evidence to make `beats=4` a production default. It is only
two source novels and one chapter each.

It is enough evidence to stop broad scaffolding for the next slice. The strongest
current signal is that source outlines with 13 beats overload the present writer
and checker loop. That overload creates long chapters, more retries, more LLM
calls, timeout risk, and more opportunities for semantic drift.

The `Framework` Plan-Assist gate may point at semantic source registration or
allowed-entity handling, but it surfaced only in an overloaded 13-beat control
arm. Do not build a new semantic registry surface from that single example.
Track whether known concepts are repeatedly flagged as ungrounded in capped or
otherwise healthy runs before changing that layer.

Continuity was not load-bearing in this cohort. With L84 active, continuity
remains diagnostic/review evidence unless an opt-in editorial flag proposal is
created.

Mechanical lint/integrity remains worth improving only where a deterministic
repair is local and traceable. It is not the dominant blocker in this pass.

## Next Slice

Use existing diagnostics before adding new architecture:

1. Run a larger bounded cohort over four to six candidate sources, still one
   chapter first, comparing source outline shape against capped/calibrated beat
   shapes.
2. Keep planning beat-cap behavior default-off until a larger cohort or replay
   sample shows better completion, lower cost, and no worse semantic drift.
3. If the signal repeats, implement the runtime candidate as a planner shape
   calibration, not as a writer/checker prompt nudge: derive beat ranges from
   target length and observed words per beat, enforce a cap, and preserve
   explicit A/B override evidence.
4. Investigate semantic source registration only after repeated evidence shows
   known planned concepts being flagged as hallucinated in otherwise healthy
   runs.
5. Return to richer character/world/plot context after the basic plan-shape,
   traceability, and evidence loop can reliably produce comparable outputs.

The immediate repository principle remains L079: prove value with replay,
cohort, or A/B evidence before wiring creative heuristics into production
defaults.
