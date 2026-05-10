---
status: active
updated: 2026-05-07
role: methodology-hypothesis-bank
---

# Authoring Methodology Hypotheses

This document collects candidate ways to make Novel Harness better at
structuring and telling a novel under operator influence. It is not a backlog
of prompts to wire immediately. Each hypothesis must be tested at the layer it
claims to improve, with adjacent layers held steady unless the experiment is
explicitly measuring downstream projection. See L089.

## Evaluation Rule

Every methodology experiment should declare:

- optimized layer;
- one changed lever;
- fixed inputs and held-constant downstream layers;
- durable IDs or observation refs needed for traceability;
- expected improvement and failure mode;
- evidence gate before promotion.

Prefer upstream diagnostic evidence before drafting changes. Do not use UI
work, checker strictness, or broad writer rewrites as substitutes for plan
quality evidence.

Semantic judges are diagnostic and falsifier-first, not runtime blockers.
A judge is a way to refute a hypothesis cheaply, or to attach a
quality-shape signal to an A/B; it is not a gate that fails a draft. New
LLM-backed runtime blockers require an oracle-calibrated current-surface
panel and an explicit decision record. See L099 and the operator-adjusted
backlog at `docs/research/user-adjusted-backlog-2026-05-10.md`.

Traceability IDs are mandatory across system state, DB rows, telemetry,
checker findings, proposal targets, eval artifacts, and audit logs. Whether
raw IDs are visible inside a particular LLM prompt is a separate, narrower
question evaluated per render site. See L099.

Planner method target: `docs/planner-output-contract.md`.

First candidate method pack:
`docs/method-packs/commercial-fantasy-adventure-v0.md`.

## Hypotheses

| ID | Hypothesis | Optimized Layer | First Evidence Gate | Priority |
| --- | --- | --- | --- | --- |
| H1 | Structure-template macro planning | concept/planning template | planner-quality comparison | high |
| H2 | Scene as plan/write/adherence unit | scene plan / writer interface | scene-contract diagnostic, then A/B draft | high |
| H3 | Native chapter contracts before beats | chapter plan | endpoint/materiality score | high |
| H4 | Planner-owned Promise/Progress/Payoff | story spine / chapter plan | story-debt diagnostic | medium-high |
| H5 | Character materiality and motivation obligations | character plan / chapter plan | character-visible plan score | medium-high |
| H6 | Operational world relevance | world plan / chapter plan | relevance and rule-use diagnostic | medium |
| H7 | Scene-internal craft fields | scene plan | plan-quality diagnostic | medium |
| H8 | Genre/market strategy profiles | concept/planning template | genre-fit planner diagnostic | medium |
| H9 | Human oversight checkpoints | evaluation workflow | side-by-side rubric panel | medium |
| H10 | Chapter-scope draft then revise | writer/reviser | only after H1-H3 evidence | later |
| H11 | Corpus structure recreation | planning reference / diagnostics | chapter-scene reference comparison | high |
| H12 | Run/thread ID interleaving | traceability / context engineering | deterministic run/thread map | high |

## H1 - Structure-Template Macro Planning

Hypothesis: a commercial structure scaffold can make planning better because
the planner has chapter-level story jobs before it starts inventing beats.

Candidate templates:

- flexible 24-chapter commercial outline inspired by Plottr/Derek Murphy style
  chapter functions;
- romance obligatory beats;
- pulp quarter structure;
- LitRPG/progression strategy;
- generic three-act or four-part commercial fantasy scaffold.

First slice:

- Add read-only template definitions as data, not runtime defaults.
- Start with `commercial-fantasy-adventure-v0` as the general method-pack
  charter; keep LitRPG and other specialist genres out of V0.
- Assign `templateId` and `structureSlotId` to chapter skeletons or diagnostic
  rows.
- Score whether each chapter purpose satisfies its intended structural job.
- Hold writer, checker, UI, and proposal behavior fixed.

Expected benefit: chapter plans should have clearer function, stronger
endpoint hooks, and less arbitrary middle-chapter drift before drafting.

Trace needs: `templateId`, `structureSlotId`, `chapterId`, chapter purpose,
endpoint text, protagonist pressure, irreversible change, and hook/outcome.

Evidence gate: compare no-template vs template-guided planning on the same
frozen concept seed. Use planner-quality metrics plus human side-by-side
review before drafting.

Risk: a fixed scaffold can overfit the wrong genre or create formulaic plans.
Mitigation: treat templates as selectable/flexible slots, not a hard 24-chapter
requirement.

Golden example source: authored craft/template structures and corpus-derived
scene/function distributions, not legacy Novel Harness outlines.

## H2 - Scene Plan/Write/Adherence Unit

Hypothesis: DeepSeek-like verbose writers may perform better when asked to
write a complete scene rather than expanding each beat as a separate mini
scene. If scenes become the planning and writing unit, adherence should also
move to the scene contract. Beats should not remain the load-bearing adherence
contract unless they remain the load-bearing planning/writing contract.

Method shape:

- `sceneId` is the primary plan, generation, prose-span, checker, and revision
  unit.
- `obligationId` and `sourceId` are the durable traceability units inside the
  scene.
- `characterId`, `worldFactId`, `structureSlotId`, and promise/payoff refs
  describe why an obligation exists.
- `beatId` is legacy compatibility or an optional internal hint. It is not the
  future primary contract.

Target shape:

```text
chapterId
  sceneId
    scene goal / conflict / outcome / value turn
    obligationIds[]
    sourceIds[]
    character/materiality refs
    structureSlotId
    draft span refs
    scene-contract observations
    obligation-coverage observations
```

First slice:

- Add a diagnostic scene-contract projection from existing chapter outlines.
- Do not change drafting initially.
- Report candidate `sceneId`s, scene goal/conflict/outcome, value turn,
  required obligations/source refs, and whether current beat-shaped outlines
  can be lifted into scene contracts without losing traceability.

Production scene contracts must be **planner-authored** fields (an LLM call
produces the contract as a structured output, or a human authors it).
Deterministic code may validate the *presence* and *shape* of a scene
contract; it must not author its content. Heuristic field population such
as "goal from leading verb-noun" or "turningPoint from final clause" is
acceptable only as a diagnostic fallback to surface gaps, never as the
production authoring path.

Second slice, only if the projection looks coherent:

- Default-off A/B writer arm where the writer drafts one scene from a scene
  contract and obligation/source checklist.
- Validate scene-contract satisfaction and obligation coverage across the
  whole scene. Ordering can differ if causality still works.
- The scene-contract A/B test should include three arms when feasible:
  current beat-shaped writer (no contract); beat-shaped writer with
  contract rendered; scene-call writer with contract. Otherwise the
  contract-rendering effect is confounded with the architecture shift.
  See `docs/research/user-adjusted-backlog-2026-05-10.md` adjusted-B3.

Expected benefit: more natural pacing, fewer stitching artifacts, better prose
rhythm, and fewer over-expanded beat mini-scenes.

Trace needs: future `sceneId`, `obligationId[]`, `sourceId[]`,
`characterId[]`, `structureSlotId`, prose span refs, and scene-contract
observations. Preserve old `beatId`s where available for compatibility, but do
not make them the new assertion surface.

Risk: attribution becomes harder if obligations are vague or too broad.
Mitigation: define scene obligations directly and keep checker verdicts at
`satisfied`, `partially_satisfied`, `missing`, `contradicted`, or
`satisfied_by_valid_merge`; avoid strict beat-index matching.

## H3 - Native Chapter Contracts

Hypothesis: planning improves when each chapter is first described as a story
contract: protagonist pressure, central conflict, irreversible change, endpoint
or hook, and downstream promise. Beat count is secondary.

Current evidence: `nativePlanningContractV1` improved beat budget and mapper
headroom, but planner-quality diagnostics found endpoint and character
materiality risks.

Next slice:

- Strengthen the planner-quality diagnostic before prompt changes.
- Score whether the final beat lands the declared endpoint semantically, not
  just by token overlap.
- Score whether listed supporting characters materially affect the chapter.

Expected benefit: fewer chapters that are mechanically tidy but semantically
thin.

Trace needs: `chapterId`, declared endpoint, final beat/ref, characters
present, character IDs, and materiality observations.

Risk: optimizing the chapter contract can still leave scenes under-specified.
Mitigation: pair with H2/H7 only after chapter-contract quality improves.

## H4 - Planner-Owned Promise/Progress/Payoff

Hypothesis: the harness needs story debt as a planning primitive. Current
adherence checks ask whether planned events occurred, but not whether promises
opened by the story are progressed or paid off.

First slice:

- Diagnostic-only story-debt extraction from story spine and chapter purposes.
- No durable production schema until evidence improves plan coherence.
- Track promise opened, expected progress zone, intended payoff zone, and
  current status.

Expected benefit: stronger plot momentum and fewer dropped setup/payoff chains.

Trace needs: `promiseId`, `structureSlotId`, `chapterId`, optional `sceneId`,
payoff obligation IDs, and status observations.

Risk: a promise ledger can become over-engineered or intrusive. Mitigation:
keep it planner-owned and diagnostic until a side-by-side plan comparison
shows value.

## H12 - Run/Thread ID Interleaving

Hypothesis: drafting coherence improves when the repo's existing run/stable-ref
traceability is extended so execution lineage and narrative thread/payoff refs
travel together from concept through scene writing and review.

First slice:

- Normalize run manifests and deterministic validation in diagnostic
  artifacts, reusing existing run IDs where present.
- Add `threadId`, `promiseId`, and `payoffId` refs to planner contracts before
  changing writer prompts.
- Produce a thread map that shows where story debts open, progress,
  complicate, and pay off.

Expected benefit: fewer stale comparisons, clearer downstream impact analysis,
and writer context that is narrower but more relevant.

Trace needs: `runId`, `rootRunId`, `parentRunId`, `variantId`, `sceneId`,
`obligationId`, `threadId`, `promiseId`, `payoffId`, input/output artifact
hashes, and review observation refs.

Risk: over-building ledgers before proving value. Mitigation: deterministic
diagnostics and static review first; writer-context changes stay default-off.

## H5 - Character Materiality And Motivation

Hypothesis: plans improve when characters are active sources of scene pressure,
not just names attached to beats.

First slice:

- Add planner diagnostics for listed-character materiality, motivation
  pressure, and relationship texture.
- Use existing character IDs where available; fall back to names only for
  legacy rows.
- Do not wire voice/motivation prose nudges yet.

Expected benefit: chapters where characters drive action from goals, fears,
relationships, and arc pressure.

Trace needs: `characterId`, `chapterId`, future `sceneId`, materiality finding,
relationship arc refs, motivation source refs, and beat/obligation refs.

Risk: too many required character obligations can make plans stiff.
Mitigation: keep findings diagnostic, not blocking, and review with human
side-by-side samples.

## H6 - Operational World Relevance

Hypothesis: world-building improves prose only when the planner selects
relevant operational details for the current chapter/scene. Dumping more world
bible context or enforcing every fact creates noise.

First slice:

- Diagnostic relevance score for world facts per chapter/scene.
- Separate `operational`, `reference`, and `hidden` facts.
- Only established operational facts are candidates for future enforcement.

Expected benefit: world details appear because they affect conflict, choices,
costs, or constraints.

Trace needs: `worldFactId`, role, established-in-prose status, `chapterId`,
future `sceneId`, and use/omission observations.

Risk: overly broad world-rule checking drowns the operator. Mitigation:
diagnostic-only until role and established-state evidence is strong.

## H7 - Scene-Internal Craft Fields

Hypothesis: scene-level fields are useful when they describe what the scene
does internally: goal, conflict, outcome, value polarity open/close, and
decision/consequence.

First slice:

- Add these as diagnostic projection fields or template fields, not a broad
  cross-cutting scene-state table.
- Do not add scene-level continuity for location, knowledge propagation, or
  character state yet.

Expected benefit: better detection of "on plot but flat" plans before prose.

Trace needs: future `sceneId`, `chapterId`, value axis, open/close polarity,
goal/conflict/outcome observations, source IDs, and obligation IDs. Do not
require source beat IDs for new methodology work.

Risk: overfitting craft heuristics. Mitigation: score as warnings and compare
against human preference before runtime use.

## H8 - Genre/Market Strategy Profiles

Hypothesis: AI writing is most competitive in specific commercial lanes, so
planning should know the genre and reader contract before choosing structure
or strictness.

Candidate profiles:

- fantasy adventure;
- LitRPG/progression fantasy;
- romance;
- thriller/pulp;
- cozy/mystery variants.

First slice:

- Require declared genre/market strategy in concept diagnostics.
- Map strategy to candidate templates and planner-quality dimensions.
- Do not infer genre automatically as a runtime default.

Expected benefit: fewer generic plans and better alignment with Kindle
Unlimited-style reader expectations.

Trace needs: `genreProfileId`, `templateId`, chapter/scene function refs, and
genre-specific diagnostic observations.

Risk: too many profiles create combinatorial overhead. Mitigation: start with
one or two target markets where AI prose is likely to be competitive.

## H9 - Human Oversight And Side-By-Side Evaluation

Hypothesis: methodology changes need human oversight because the harness can
optimize easy metrics while making the story worse.

First slice:

- Define a compact human review rubric for plan outputs:
  endpoint landed, character agency, relationship texture, world relevance,
  plot momentum, and commercial readability.
- Use side-by-side comparisons for planning variants before drafting.
- Store the chosen variant and rationale as evidence.

Expected benefit: better experiment steering and fewer false wins from
mechanical metrics.

Trace needs: `experimentId`, `variantId`, source seed, reviewer decision,
rubric scores, and linked chapter/template refs.

Risk: human review is slower. Mitigation: use it only at promotion gates, not
for every diagnostic row.

## H10 - Chapter-Scope Draft Then Revise

Hypothesis: a strong model may produce better prose if it drafts a full chapter
from the plan, then a revision pass fixes checklist failures.

Do not test this first. It changes the writer and revision architecture at the
same time, which makes attribution difficult.

Potential later gate:

- H1-H3 show stronger upstream plans.
- H2 provides scene-contract and obligation-coverage observations.
- Revision can target failed spans without rewriting the whole chapter.

Expected benefit: more coherent prose flow across the chapter.

Risk: hardest attribution and largest blast radius. Keep later.

## H11 - Corpus Structure Recreation

Hypothesis: the harness can learn useful planner granularity by attempting to
recreate the structural shape of a proven corpus novel from compressed
premise/context, while keeping prose/style imitation out of scope.

First slice:

- Build a local reference scaffold from existing corpus scene, beat, value,
  MICE/thread, and gap annotations.
- Keep detailed plot summaries in ignored `output/` artifacts only.
- Compare planner outputs against the reference at chapter and scene
  granularity before any prose generation.

Expected benefit: a concrete answer to what the planner should be planning:
chapter functions, scene contracts, promise movement, character pressure,
world constraints, and endpoint propulsion.

Trace needs: `chapterId`, future `sceneId`, source/corpus scene refs,
value-shift refs, MICE/thread refs, promise/story-debt refs, and side-by-side
operator review evidence. Corpus `beatId`s are annotation refs, not the future
primary writing/checking unit.

Risk: overfitting to one author or copying expressive plot/prose. Mitigation:
use this as a structural reference POC, not a runtime template; commit only
schemas, metrics, and conclusions, not detailed source-derived outlines.

## Recommended Sequence

1. **Hypothesis charter:** choose one upstream method to test: structure
   template H1, scene-contract projection H2, chapter-contract scoring H3, or
   corpus structure recreation H11.
2. **Planner contract target:** choose an authored craft/template exemplar
   rather than deriving the target from existing harness outlines.
3. **Diagnostic-only implementation:** add template/scene/contract
   observations linked to IDs, no writer changes.
4. **Controlled planning comparison:** same frozen concept seed, one changed
   layer, planner-quality report plus human side-by-side review.
5. **Legacy baseline, optional:** project old outlines only to understand the
   migration gap, not to define the target.
6. **Promotion decision:** if plan quality improves, decide whether to project
   the winning method into drafting.
7. **Writer experiment:** only then test scene-level or chapter-level writing
   changes.

## What Not To Do Next

- Do not expand UI/Playwright work unless a UI surface changes.
- Do not promote `calibrated:packed` or hard beat caps as runtime defaults.
- Do not add broad checker blockers for micro-tension, scene turns,
  world-detail use, or character agency before diagnostic evidence.
- Do not introduce multiple methodology changes in one cohort.
- Do not treat a shorter chapter as a story-quality win without endpoint,
  character, world, and payoff evidence.
- Do not keep beat-level adherence as the primary checker contract if scenes
  become the planning and writing unit.
