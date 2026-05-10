---
status: active
updated: 2026-05-06
role: operator-how-to
---

# Semantic Gate Experiments

Use this guide when running accelerated disposable experiments over planner,
writer, or checker variants.

## What The Variants Mean

- `control:source`: use each source novel's stored outline exactly as-is. This
  is not a fixed beat count. In recent cohorts, control source outlines were
  often 13-15 beats.
- `capped4:beats=4`: run a disposable clone with a 4-beat planning cap.
- `capped5:beats=5`: run a disposable clone with a 5-beat planning cap.

Do not read `reported` as `completed`:

- `reported`: the arm wrote a summary artifact.
- `completed`: the requested chapter was approved.
- `cleanPass`: the completed arm avoided semantic-gate signals under the
  matrix assessment.

## Throughput Defaults

Eval runners default child processes to `BUN_SQL_MAX=1`. Keep that default for
cohorts unless you are intentionally testing DB fanout.

The LXC Postgres host has been tuned for local experiment fanout:

```text
max_connections = 300
shared_buffers = 1GB
effective_cache_size = 6GB
maintenance_work_mem = 256MB
work_mem = 8MB
```

Before a large run:

```bash
nc -z 127.0.0.1 15432
ps -o pid,ppid,stat,etime,command -ax | rg "semantic-gate-(cohort-matrix|matrix|baseline)|src/index" || true
```

## Candidate Scan

```bash
bun run diagnostics:semantic-gate-candidates -- \
  --limit 20 \
  --scan-limit 100 \
  --output output/evals/semantic-gate-candidates/<run-id>.json
```

For beat-shape experiments, prefer drafted sources:

```bash
jq '{totals, candidates: [.candidates[] | select(.phase != "concept" and .chapters.drafted > 0)][0:10]}' \
  output/evals/semantic-gate-candidates/<run-id>.json \
  > output/evals/semantic-gate-candidates/<run-id>-drafted-top10.json
```

## Accelerated Cohort

```bash
bun run diagnostics:semantic-gate-cohort-matrix -- \
  --allow-disposable-cohort \
  --candidate-report output/evals/semantic-gate-candidates/<run-id>-drafted-top10.json \
  --candidate-limit 10 \
  --chapters 1 \
  --variant capped4:beats=4 \
  --variant capped5:beats=5 \
  --variant control:source \
  --parallel-sources 8 \
  --parallel-variants 3 \
  --child-timeout-minutes 10 \
  --continuity-editorial-flag-proposals \
  --output-base output/evals/semantic-gate-cohort-matrix/<run-id>
```

Expected high-throughput shape on the tuned LXC DB:

- no `too many clients already`;
- no missing summaries from clone failure;
- all arms should at least report, even when they time out or stop at
  Plan-Assist.

## Interpretation Rules

- Treat DB-slot failures as infrastructure failures, not semantic failures.
- Treat `process-timeout` as evidence that the arm is too expensive or stuck
  under the configured timeout.
- Compare completion and clean pass against word ratio and cost. A semantically
  stable arm that writes 3x target length is not a product win.
- Do not promote a creative runtime lever from one cohort. Use a larger cohort
  or repeat on a fresh candidate set before changing defaults.

## Current Lesson

The N=10 accelerated cohort showed that hard beat caps reduce cost and length,
but increase plan-drift and Plan-Assist risk. Source outlines are more stable
but often massively overlong.

The follow-up calibrated-packing cohort showed that deterministic obligation
packing can preserve source obligations while reducing length, but it remains
diagnostic evidence. It repairs an unrealistic downstream outline shape after
the fact.

Per L088, the next product-relevant experiments should move upstream into
concept/planning: author native chapter contracts and story-turn beats, then
score endpoint landing, character materiality, obligation health, drafting
word ratio, and semantic-gate behavior. Do not use hard caps or
`calibrated:packed` as runtime defaults.

Under L106, live semantic-gate baseline/matrix/cohort commands require explicit
disposable flags before they create cloned novels. Summary-only cohort
aggregation remains read-only and does not need the flag.
