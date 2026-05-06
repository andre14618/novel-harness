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

## Acceleration Follow-Up

The first attempt to increase sample size exposed an infrastructure limit, not
a harness-quality signal. Running six sources by three variants at
`--parallel-sources 3 --parallel-variants 3` without a per-process Bun SQL pool
cap caused Postgres clone failures:

- `sorry, too many clients already`
- `remaining connection slots are reserved for roles with the SUPERUSER attribute`

Those failures came from subprocess fanout opening too many idle DB clients.
They should be classified as experiment-runner throughput failures, not as
semantic-gate failures.

Two fixes were applied:

- Eval runners now default `BUN_SQL_MAX=1` for baseline, matrix, and cohort
  children, while preserving explicit operator overrides.
- The LXC Postgres config at
  `/etc/postgresql/16/main/conf.d/99-novel-harness-experiments.conf` now raises
  experiment capacity:
  - `max_connections = 300`
  - `shared_buffers = 1GB`
  - `effective_cache_size = 6GB`
  - `maintenance_work_mem = 256MB`
  - `work_mem = 8MB`

After restarting Postgres, `max_connections=300` and `shared_buffers=1GB` were
active. The higher-throughput cohort then ran:

```bash
bun run diagnostics:semantic-gate-cohort-matrix -- \
  --candidate-report output/evals/semantic-gate-candidates/accelerated-20260506T200315Z-drafted-top10.json \
  --candidate-limit 10 \
  --chapters 1 \
  --variant capped4:beats=4 \
  --variant capped5:beats=5 \
  --variant control:source \
  --parallel-sources 8 \
  --parallel-variants 3 \
  --child-timeout-minutes 10 \
  --continuity-editorial-flag-proposals \
  --output-base output/evals/semantic-gate-cohort-matrix/accelerated-top10-p8-20260506T200315Z
```

Result:

| Variant | Completed | Clean Pass | Mean Risk | Mean Word Ratio | Cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| `control:source` | 7/10 | 7 | 425.58 | 3.57 | `$0.2096` |
| `capped5:beats=5` | 7/10 | 4 | 530.11 | 1.37 | `$0.0905` |
| `capped4:beats=4` | 7/10 | 3 | 534.89 | 0.98 | `$0.0726` |

Artifacts:

- `output/evals/semantic-gate-cohort-matrix/accelerated-top10-p8-20260506T200315Z/summary.json`
- `output/evals/semantic-gate-cohort-matrix/accelerated-top10-p8-20260506T200315Z/report.md`

Interpretation:

- Higher concurrency is now viable. The N=10 run produced 30 variant arms with
  no failed summaries, no DB-slot failures, 1,228 LLM calls, and `$0.3727`
  total cost.
- Source-outline control still has the strongest clean-pass count in this
  cohort, but at a severe length/cost penalty: mean word ratio `3.57` and more
  than twice the capped5 cost.
- Beat caps reduce length and cost materially, but they introduce more
  Plan-Assist/plan-drift risk in the current implementation. That means the
  next product lever should not be "hard cap beats globally." The better
  hypothesis is calibrated plan-shape selection plus preserving enough planned
  causal turns for semantic closure.
- Future accelerated sweeps should keep `BUN_SQL_MAX=1`, use the tuned LXC DB,
  and prefer larger cohorts over single-run anecdotes before changing runtime
  defaults.
