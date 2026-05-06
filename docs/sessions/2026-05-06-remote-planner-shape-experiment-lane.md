---
status: active
updated: 2026-05-06
role: remote-work-packet
---

# Remote Planner Shape Experiment Lane

This packet is written for a remote Claude run on the LXC-backed environment.
It defines what to test, how to run it, what evidence to collect, and how to
interpret the result.

## Question

Can the planner produce chapters that stay near target length without losing
the semantic stability of larger source outlines?

The active hypothesis is L86:

- Hard beat caps reduce cost and length.
- Source outlines are more semantically stable but often 3x target length.
- The next useful planner lever is calibrated obligation packing, not a global
  hard cap.

## Current Runnable Test

Until a calibrated planner-shape variant exists, run a fresh baseline cohort
over the existing arms:

- `control:source`
- `capped4:beats=4`
- `capped5:beats=5`

This establishes the current distribution and verifies the accelerated remote
runner remains healthy.

### Setup

On the remote machine:

```bash
cd ~/apps/novel-harness
git status --short --branch
git pull --ff-only
```

Before starting, verify no semantic-gate children are already running:

```bash
ps -o pid,ppid,stat,etime,command -ax \
  | rg "semantic-gate-(cohort-matrix|matrix|baseline)|src/index" \
  || true
```

Verify Postgres tuning:

```bash
sudo -n -u postgres psql -Atc \
  "SHOW max_connections; SHOW shared_buffers; SHOW work_mem;"
```

Expected:

- `max_connections` is at least `300`.
- `shared_buffers` is at least `1GB` / `131072` 8kB pages.
- `work_mem` is at least `8MB` / `8192` kB.

### Candidate Scan

```bash
RUN_ID="remote-planner-shape-$(date -u +%Y%m%dT%H%M%SZ)"

bun run diagnostics:semantic-gate-candidates -- \
  --limit 30 \
  --scan-limit 150 \
  --output "output/evals/semantic-gate-candidates/${RUN_ID}.json"

jq '{totals, candidates: [.candidates[] | select(.phase != "concept" and .chapters.drafted > 0)][0:12]}' \
  "output/evals/semantic-gate-candidates/${RUN_ID}.json" \
  > "output/evals/semantic-gate-candidates/${RUN_ID}-drafted-top12.json"
```

### Cohort Run

```bash
bun run diagnostics:semantic-gate-cohort-matrix -- \
  --candidate-report "output/evals/semantic-gate-candidates/${RUN_ID}-drafted-top12.json" \
  --candidate-limit 12 \
  --chapters 1 \
  --variant capped4:beats=4 \
  --variant capped5:beats=5 \
  --variant control:source \
  --parallel-sources 8 \
  --parallel-variants 3 \
  --child-timeout-minutes 10 \
  --continuity-editorial-flag-proposals \
  --output-base "output/evals/semantic-gate-cohort-matrix/${RUN_ID}"
```

### Evidence To Return

Return these exact summaries:

```bash
jq '{totals, ranking}' \
  "output/evals/semantic-gate-cohort-matrix/${RUN_ID}/summary.json"
```

```bash
for f in output/evals/semantic-gate-cohort-matrix/${RUN_ID}/matrices/*/summary.json; do
  jq -r '
    .sourceNovelId as $source |
    .variants[] |
    [
      $source,
      .variant.id,
      (.baseline.terminal.status // "missing"),
      (.assessment.completed | tostring),
      (.baseline.checker.semanticGate.chapters[0].plannedBeats // "?"),
      (.baseline.drafts.totalWords // 0),
      (.baseline.checker.semanticGate.chapters[0].targetWords // "?"),
      ((.baseline.checker.semanticGate.chapters[0].signals // []) | join(",")),
      (.assessment.riskScore | tostring)
    ] | @tsv
  ' "$f"
done
```

Also check infrastructure failures:

```bash
find "output/evals/semantic-gate-cohort-matrix/${RUN_ID}" \
  -path '*/matrix.stderr.log' -print \
  | xargs -I{} sh -c 'if rg -q "too many clients|remaining connection slots|429|rate limit" "$1"; then echo "--- $1"; tail -40 "$1"; fi' sh {}
```

## What To Test For

Primary metrics:

- `completed`: requested chapter approved.
- `cleanPass`: completed without semantic-gate signals.
- `meanWordRatio`: actual words divided by target words.
- `pending plan-assist gate`: semantic instability or unresolved checker/gate.
- `plan_adherence_drift`: plan meaning changed or omitted.
- `costUsd` and `llmCalls`.

Infrastructure validity:

- all arms should produce summary artifacts;
- no clone failures from DB connection slots;
- no model-provider rate-limit cluster;
- no orphaned semantic-gate child processes after completion.

## How To Interpret The Existing Arms

Treat `control:source` as semantic-stability reference, not as length reference.
It often uses 13-15 beats and can pass while writing 3x target length.

Treat `capped4` and `capped5` as pressure tests:

- If they reduce length/cost but cause more plan drift, hard caps are too
  blunt.
- If one cap repeatedly wins on clean pass and word ratio across a larger
  cohort, it becomes evidence for the calibrated planner's beat-budget range,
  not automatic proof for a runtime default.

## Next Test After Implementation

Once a calibrated obligation-packed planner variant exists, run the same cohort
with this fourth arm:

```bash
--variant calibrated:packed
```

If the exact variant id differs, use the implemented id and record it in the
report.

The calibrated arm should be judged against these minimum targets:

- completion rate at least as high as the better hard-cap arm;
- clean-pass rate no more than one cohort source behind `control:source`;
- mean word ratio below `1.75`;
- total cost below `70%` of `control:source`;
- plan-drift count no worse than the better hard-cap arm;
- every generated chapter has evidence that required obligations were assigned
  to beats before drafting.

Promotion remains `hold` unless those targets are met on at least one N>=10
cohort and repeated on a fresh source set or multi-chapter sample.

## Report Format

Use this exact structure in the handoff:

```text
Run ID:
Git SHA:
Remote host:

Infrastructure:
- max_connections:
- active child peak:
- failed summaries:
- DB-slot/rate-limit errors:

Aggregate:
- control:
- capped5:
- capped4:
- calibrated, if available:

Interpretation:
- semantic stability:
- length/cost:
- dominant failure class:
- promote / hold:

Artifacts:
- candidate JSON:
- cohort summary:
- cohort report:
```

