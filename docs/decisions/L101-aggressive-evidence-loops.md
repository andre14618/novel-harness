---
status: active
date: 2026-05-10
role: decision-record
---

# L101: Aggressive Evidence Loops

## Decision

When the user asks to accelerate Novel Harness development, agents should favor
goal-driven autonomous evidence loops over serialized planning, day-based
timelines, or one-commit handoffs.

The desired unit of progress is a reviewable artifact plus evidence:

- generated prose, plan, diagnostic report, static HTML, or trace bundle;
- side-by-side comparison when a choice exists;
- token/cost/latency/run statistics where available;
- a clear next action or promotion/no-go recommendation.

This amends L100 by making the POC lane more aggressive: spend model calls and
engineering-agent effort to gather evidence faster, provided traceability and
production-default boundaries remain intact.

## Loop Contract

Each active loop names:

- **Goal:** what artifact or decision should improve.
- **Scope:** files, fixtures, run IDs, or harness surface.
- **Signals:** deterministic tests, semantic diagnostics, operator-review
  artifacts, run statistics, or side-by-side outputs.
- **State artifact:** manifest, session note, output directory, eval results,
  or lane-queue update.
- **Stop conditions:** production-default risk, traceability loss, repeated
  same-fingerprint failure, unavailable environment, no independent next item,
  or explicit user decision needed.

Do not stop merely because one commit landed, one artifact rendered, or one
summary was written.

## Model And Harness Use

Runtime Novel Harness calls remain governed by L090: DeepSeek V4 Flash and
DeepSeek V4 Pro only.

Off the runtime path, agents may use the best available harness/model for the
job:

- coding agents for implementation and reviews;
- stronger reasoning models for architectural critique;
- DeepSeek calls for cheap POC sweeps and scoped semantic diagnostics;
- research agents for bounded questions that can change an implementation or
  evaluation choice;
- multiple judge/adjudicator calls when the goal is to measure whether a
  semantic signal is useful.

Research or judging must produce a compact artifact the repo can use. Long
reports with no decision they can change are not acceleration.

## Semantic Diagnostics

More semantic judgment is authorized, but only in narrow, observable shapes:

- one excerpt or scene set;
- one dimension at a time;
- evidence-first output;
- explicit "not applicable" and "unclear" states;
- AB/BA or equivalent bias checks for pairwise comparisons;
- persisted outputs linked to run IDs and source artifact paths.

Semantic diagnostics are filters and decision aids, not production blockers,
unless a later production decision promotes a specific calibrated judge.

Preferred first dimensions:

- endpoint landing;
- scene dramaturgy;
- character agency;
- obligation satisfaction;
- world/context pressure;
- promise/payoff movement.

## Parallelism

Agents should parallelize when write scopes are independent:

- runner implementation vs. static HTML rendering;
- fixture loading vs. diagnostics;
- artifact review vs. manifest/stat capture;
- docs sweep vs. next non-overlapping implementation slice.

Avoid parallel edits to the same prompt, runner control flow, schema file, or
decision record unless one agent owns the final integration.

## Statistics

Every substantive POC or evaluation run should capture available statistics:

- run ID, fixture/source ID, chapter/scene IDs;
- model role and route;
- flags/arms;
- token usage, cache-hit fields, latency, and estimated or reported cost;
- completion status and failure reason;
- artifact output paths;
- diagnostic verdicts and judge agreement where applicable.

If a surface cannot capture these yet, adding manifest/stat capture is a
high-priority support task.

## Promotion Boundary

Aggressive loops do not lower the production bar.

Promotion from POC to production still requires:

- exact phase/surface named;
- artifact evidence cited;
- traceability preserved;
- duplicate experimental substrate frozen or removed;
- production verification run;
- rollback path.

## Implications

- Day-based plans should be replaced with goal queues and loop stop conditions.
- Agents should continue from one independent item to the next until blocked.
- More DeepSeek spend on POC generation and semantic diagnostics is preferred
  over more planning discussion when the next artifact can be generated.
- Engineering parallelism is the default when ownership can be separated.
- Repository docs should distinguish runtime model policy from engineering and
  research harness choices.
