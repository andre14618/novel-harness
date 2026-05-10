---
status: proposal
date: 2026-05-10
reviewed: 2026-05-10
role: spend-plan
scope: POC acceleration, engineering throughput, quality evidence
---

# Quality Acceleration Spend Plan

This proposal answers a narrow question: how should Novel Harness spend more
tokens, model calls, and engineering-agent time to get to better writing
functionality faster?

The answer is not "buy more infrastructure." The answer is:

1. Generate more reader-visible artifacts per day.
2. Compare more alternatives side-by-side.
3. Use narrow diagnostic judges to reduce how much prose the operator must
   read manually.
4. Parallelize engineering work by ownership.
5. Promote only the slices whose artifacts prove value.

This plan is subordinate to L090 and L100:

- Runtime model policy remains DeepSeek V4 Flash / DeepSeek V4 Pro only.
- POC work may move quickly under `poc/`, but production defaults do not change
  without a production decision and verification gate.
- Traceability IDs stay mandatory in state, DB, telemetry, diagnostics, audit,
  and artifacts.
- L101 authorizes aggressive goal-driven evidence loops, parallel engineering
  agents, and broader off-runtime research/judgment harness use.

## Review Verdict

The original spend memo had the right instinct but needed tightening:

- It relied on private "memory:" references that another harness cannot load.
- It mixed runtime model policy with engineering-agent usage.
- It included precise-looking cost estimates that can go stale and should be
  replaced by actual token/cost telemetry from each run.
- It was still too cautious for the user's stated goal: buy acceleration now.
- It spent too much space rebutting an external tier list instead of giving
  coding agents a clear execution loop.

This revision keeps the useful direction and turns it into operational rules.

## Core Principle

Spend is justified when it increases one of these:

- **Artifact throughput:** more complete chapters/scenes/static review pages.
- **Comparison power:** more arms over the same input, with traceable deltas.
- **Judgment quality:** fewer operator-read pages before a useful decision.
- **Engineering parallelism:** independent slices completed at the same time.
- **Promotion confidence:** clearer evidence for or against a production change.

Spend is not justified when it creates:

- generic infrastructure before a reader-visible artifact needs it;
- new production defaults before POC evidence;
- broad semantic judges without calibration;
- UI polish before the writing/planning question is settled;
- custom autonomous coding infrastructure inside this repo.

## Proposed Spend Posture

These are standing operating rules for the active POC lane under L101.

| Spend class | Proposed default | Rule |
| --- | --- | --- |
| Routine POC run | proceed without stopping | Use when it produces a reviewable artifact or diagnostic report. |
| Full fixture/arm sweep | proceed if the command, inputs, and expected artifact are named | Record output path and actual usage. |
| Engineering subagents | use aggressively when write scopes are separable | Assign ownership; avoid duplicate edits. |
| Strong review/adjudication agents | use at coherent stop gates | Prefer review of artifacts, diffs, and promotion choices. |
| Large one-off research/eval batch | require a named question and stop gate | Do not run broad research without a decision it can change. |
| Production default flip | never spend-through | Requires production change packet, decision record, and verification. |
| Uncalibrated semantic diagnostic | proceed as diagnostic | Persist output; never treat as blocker or promotion gate. |

Replace dollar guesses with observed data wherever possible:

- Capture provider token usage and cost when available.
- Record run IDs, model role, cache-hit fields, wall time, output path, and
  failure reason.
- If actual cost or latency is more than 3x the estimate, update the runbook
  before repeating the sweep.

## Highest-Return Lanes

### Lane A: POC Artifact Throughput

Current active target: `poc/scene-first-novella/`.

Spend here first. The fastest way to improve the harness is to produce more
complete, traceable short fiction artifacts and inspect what failed.

Immediate work:

- Run the P3 clean fixture end to end.
- Expand to P1/P2/P4 after the P3 artifact is reviewable.
- Produce static HTML for every run: scene contract, prose, trace IDs,
  diagnostics, and artifacts side-by-side.
- Keep checkers post-hoc unless the POC is explicitly testing blockers.
- Preserve `runId`, `novelId`, `chapterId`, `sceneId`, `obligationId`,
  `sourceId`, `characterId`, `threadId`, `promiseId`, and `payoffId` when
  available.

Acceleration rule:

- Do not stop after one artifact if the next fixture can run with the same
  command shape.
- Do not wait for UI/Playwright unless the artifact itself is UI behavior.
- Do not harden production code until the artifact shows a reader-visible gain.

### Lane B: Multi-Arm Comparison

Use spend to compare alternatives on the same plan instead of debating them in
the abstract.

Preferred arms for scene-first evidence:

- baseline production path;
- scene-call writer;
- scene-contract rendered into writer context;
- ID-rendering ablation where raw prompt IDs are suppressed but trace metadata
  is preserved.

Each multi-arm run should emit:

- one output directory per run;
- a manifest naming source fixture, model roles, flags, and arms;
- per-arm prose;
- per-arm diagnostics;
- per-arm token/cost/latency where available;
- a side-by-side HTML review page.

Promotion signal:

- An arm should not win on word count alone.
- Prefer arms that improve endpoint landing, character agency,
  scene-dramaturgy, obligation satisfaction, and operator readability without
  losing traceability.

### Lane C: Narrow Diagnostic Judges

Use LLM judges as diagnostic filters, not production blockers.

Start with the smallest useful dimensions:

- endpoint landing: did the scene/chapter arrive at the planned story result?
- scene dramaturgy: did the scene have goal, opposition, turn, choice,
  consequence?
- character agency: did named characters make motivated choices rather than
  merely appear?

Judge shape:

- one excerpt;
- one dimension;
- one rubric;
- evidence-first output;
- explicit "not applicable" option;
- no broad pairwise "which is better?" prompt without AB/BA controls.

Calibration shape:

- Build a small gold panel with both pass and fail examples.
- Check self-consistency before trusting aggregate scores.
- Treat ties/unclear judgments as data, not as promotion evidence.
- Persist judge outputs in eval artifacts or POC output manifests.

Spend here reduces operator burden. It does not replace operator review for
promotion decisions.

### Lane D: Engineering Parallelism

Use coding agents aggressively, but only where ownership is separable.

Good parallel packets:

- one agent builds a runner while another builds static HTML;
- one agent writes fixture loaders while another writes docs/runbooks;
- one agent reviews generated artifacts while another fixes runner bugs;
- one agent ports diagnostics while another adds manifest/cost capture.

Bad parallel packets:

- two agents editing the same prompt file;
- two agents touching the same runner control flow;
- research agents producing long reports with no decision they can affect;
- UI agents polishing surfaces before artifact evidence exists.

Default implementation loop:

1. Pick the highest-value item from `docs/sessions/lane-queue.md`.
2. Name the phase/surface, exact change, expected benefit, downstream
   projection, and evidence gate.
3. Split independent write scopes if parallelism helps.
4. Build the smallest runnable vertical artifact.
5. Run targeted verification.
6. Commit the coherent slice on `main`.
7. Update lane/session docs with artifact paths and lessons.
8. Continue to the next independent item while long runs execute.

Do not stop merely because a commit landed, a summary was written, or a review
request was sent. Stop when a human decision is required, an environment is
blocked, a production-default risk appears, or every useful next item is gated.

### Lane E: Bounded Research For Implementation Decisions

Research is useful when it changes what the harness will build next.

Good research packets:

- compare two scene-planning methods and produce an implementation choice;
- survey craft structures only to extract planner-testable obligations;
- inspect generated artifacts and propose which context field is missing;
- evaluate judge designs against known bias/failure modes;
- identify corpus distributions that should become deterministic warnings.

Bad research packets:

- broad market reports with no implementation decision;
- long lists of craft advice that do not become planner contracts;
- model-vs-model essays without an artifact or evaluation shape;
- repeating previous research without a new question.

Research output should be short enough to be used: decision, evidence, proposed
slice, stop gate, and files likely affected.

### Lane F: Corpus And Lint Calibration

This is a useful support lane after the POC artifact loop is moving.

Goal:

- distinguish deterministic prose/style flags that correlate with real quality
  from regex noise that triggers phantom failures.

Shape:

- gather corpus distributions for each lint pattern;
- cite corpus/source assumptions;
- convert hard blockers into warnings when they do not predict quality;
- keep semantic/story issues in judge or operator-review lanes, not regex
  heuristics.

This should be a bounded ticket, not an open-ended craft-research lane.

### Lane G: World And Character Context Depth

This is likely a major quality lane after scene-first artifacts prove the
writing path is worth hardening.

Hypothesis:

- richer character/world context and cleaner scoped retrieval will improve
  prose coherence more than adding more blockers.

Do not start by building a large UI or policy layer. Start with a POC:

- one richer character bible shape;
- one richer world/context shape;
- one scene-first drafting run;
- diagnostics comparing character agency, world pressure, and plan adherence.

## Items To Reject For Now

- Voice LoRA / writer-pack training unless a new decision explicitly reopens
  fine-tuning.
- Runtime routing outside DeepSeek V4 Flash / V4 Pro.
- Generic per-checker precision/recall projects for noisy LLM checkers.
- Synthetic reader-persona promotion gates.
- Audiobook/video/music/content-channel work.
- Custom autonomous coding supervisor infrastructure inside this repo.
- UI/browser work that does not directly support a current artifact review.

## Goal Queue

Use this queue instead of day-based timelines. Run the next loop as soon as its
inputs are available.

### Goal 1: Produce Reviewable Artifacts

Actions:

- Finish the current scene-first novella POC run.
- Render the static review page.
- Run the next fixture with the same command shape.
- Record actual token/cost/latency in the run manifest where available.

Exit condition:

- The operator can open a side-by-side artifact and judge whether the harness is
  moving toward useful fiction.

Next loop trigger:

- If one artifact renders, immediately run the next fixture unless it requires a
  new code path or operator decision.

### Goal 2: Compare Runtime Arms

Actions:

- Add or finish multi-arm support in the POC runner.
- Run baseline vs scene-call vs contract-render vs ID-suppressed variants on at
  least two fixtures.
- Capture diagnostics, side-by-side prose, and usage stats.

Exit condition:

- There is a concrete winner, loser, or no-difference result with prose and
  diagnostics visible.

Next loop trigger:

- If the result is unclear, add one more fixture or one narrower semantic
  diagnostic before debating architecture.

### Goal 3: Expand Semantic Diagnostics

Actions:

- Run scoped judges for endpoint landing, scene dramaturgy, character agency,
  obligation satisfaction, world/context pressure, and promise/payoff movement.
- Keep each judge narrow and evidence-first.
- Add judge summaries to the static review artifact.
- Build small gold/self-consistency panels for any judge that appears useful.

Exit condition:

- Judge output helps prioritize what the operator reads, or the judge is marked
  not useful and removed from the active diagnostic set.

Next loop trigger:

- If a judge finds a repeated failure class, create either a planner-context
  slice, writer-context slice, or deterministic validator proposal.

### Goal 4: Promote One Proven Slice

Actions:

- Pick one POC result with clear artifact-level value.
- Write a production change packet.
- Freeze or delete duplicate experimental substrate.
- Run production verification gates.

Exit condition:

- One net-positive slice moves from POC to production path, or a documented
  no-go decision prevents waste.

Next loop trigger:

- Return to artifact generation with the promoted slice held constant.

### Goal 5: Attack The Next Quality Bottleneck

Choose based on evidence:

- character/world context depth if prose lacks agency or world pressure;
- planner template work if scenes lack goals/turns/consequences;
- diagnostic judge expansion if operator-review burden remains the bottleneck;
- lint/corpus calibration if deterministic style flags waste retries;
- lineage/thread/promise scaffolding if payoff movement is hard to trace.

Do not pursue all five at once. Pick the bottleneck shown by the latest
artifacts and diagnostics.

## Metrics That Matter

Track these weekly:

- complete reviewable artifacts produced;
- fixtures and arms run;
- average time from idea to artifact;
- operator-read pages avoided by diagnostics;
- semantic diagnostic dimensions attempted, retained, and retired;
- repeated failure classes discovered;
- production slices promoted from POC;
- production defaults changed without evidence: target zero;
- traceability regressions: target zero.

## Bottom Line

Spend more, but spend it on throughput and discrimination:

- more POC runs;
- more side-by-side alternatives;
- more narrow diagnostic judging;
- more parallel engineering;
- more actual usage telemetry.

Do not spend it on speculative infrastructure before the current scene-first
artifact loop proves what should be hardened.
