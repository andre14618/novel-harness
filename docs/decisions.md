---
status: active
updated: 2026-05-10
role: decision-index
archive: decisions/full-log-2026-05-04.md
---

# Decisions

This file is an index, not the full decision log. Keep it small so agents can
load current rationale cheaply.

Full historical log archived at `docs/decisions/full-log-2026-05-04.md`.

## Current Decision Records

| ID | Date | Status | Summary | Detail |
| --- | --- | --- | --- | --- |
| L109 | 2026-05-12 | active | First genre-specific plotline lane is adult guild/mercenary mission progression adventure fantasy; use `mercenary-progression-adventure-v0` to shape a Book 1 contract packet before broad drafting. | `docs/decisions/L109-mercenary-progression-adventure-lane.md` |
| L108 | 2026-05-12 | active | Stable drafting quality telemetry packet: `test-drafting-isolated --quality-telemetry-packet` captures advisory prose and scene semantic data on the production path, persists scene rows artifact-first, and closes further arm-search/word-count loops unless a new plot or writing hypothesis requires evidence. | `docs/decisions/L108-drafting-quality-telemetry-packet.md` |
| L107 | 2026-05-11 | active | Production-path one-offs over POC-to-main loops: test hypotheses through default-off production arms, diagnostics, shared schemas, readiness artifacts, compare/cohort reports, or thin wrappers that reuse production modules; standalone POCs require explicit approval and disposable flags. | `docs/decisions/L107-production-path-one-offs.md` |
| L106 | 2026-05-10 | active | Production path integration over POC branching: validated POC learnings should move into production modules, telemetry, tests, and review artifacts; POC artifacts remain evidence/fixtures unless an explicit disposable experiment is requested. | `docs/decisions/L106-production-path-integration.md` |
| L105 | 2026-05-10 | active | Scene-contract compression hold: conservative clipping preserved endpoints but worsened length to 2.07x, aggressive endpoint-core shortened to 1.78x but regressed endpoints/core coverage; do not promote payload clipping, next target writer-facing drafting briefs with telemetry. | `docs/decisions/L105-scene-contract-compression-hold.md` |
| L104 | 2026-05-10 | active | Scene-first load-control POC hold: prompt-only hard cap cut obligations to 0.89/scene and 1.66x but regressed endpoints, compactor worsened to 2.16x, and mapper-min held endpoints but stayed 1.89x; do not promote load-control defaults, next test endpoint-preserving scene-contract compression. | `docs/decisions/L104-scene-first-load-control-poc-hold.md` |
| L103 | 2026-05-10 | active | Scene-first POC promotion hold: tight scene count, endpoint repair, and lower obligation density improved artifacts, but best evidence remains 1.90x target and fixed-plan expansion A/B recorded zero writer-expansion events; keep scene-first runtime flags default-off and target planner/state-mapper load next. | `docs/decisions/L103-scene-first-poc-promotion-hold.md` |
| L102 | 2026-05-10 | active | Planner scope over word-count control: planning agents should size story content at the chapter/scene-contract layer; word counts are telemetry and rough scope signals, not the primary prose-control mechanism. | `docs/decisions/L102-planner-scope-over-word-count.md` |
| L101 | 2026-05-10 | active | Aggressive evidence loops: when accelerating, agents should run goal-driven autonomous POC/eval loops, spend model calls on artifacts/statistics/semantic diagnostics, parallelize independent engineering work, and continue until a real stop condition while preserving L090 runtime policy, trace IDs, and production-default gates. | `docs/decisions/L101-aggressive-evidence-loops.md` |
| L100 | 2026-05-10 | superseded | POC acceleration lane is superseded by L106 for active posture; keep it as guidance only when the user explicitly requests a disposable experiment. | `docs/decisions/L100-poc-acceleration-lane.md` |
| L99 | 2026-05-10 | active | Traceability IDs are mandatory infrastructure across state, DB, telemetry, checker findings, proposal targets, eval artifacts, and audit logs. The narrow ablation question is whether raw IDs should be visible in the prose-writer prompt; mapper/checker/reviewer/plan-update/disambiguation prompts keep IDs. Adjusted-B1 ablation planned; no runtime change in this record. | `docs/decisions/L099-writer-prompt-id-rendering.md` |
| L98 | 2026-05-09 | active | Scene-satisfaction structural wiring shipped: optional `obligationIds` on `ChapterPlanDeviation` and `ValidationFinding`, `sceneSatisfactionCheckerV1` flag, obligation-aware validation-routing helper that closes a silent-no-op routing bug. LLM judge + parity panel deferred to Slice 3.5. | `docs/decisions/L098-scene-satisfaction-diagnostic.md` |
| L97 | 2026-05-09 | active | Scene-call writer context rendering + retry-short-scenes-v1 expansion shipped behind `sceneCallWriterV1=false` + `writerExpansionMode="off"`. Wiring validated by unit tests + byte-parity replay; LXC drafting fixed-plan A/B explicitly deferred until a `test-drafting-isolated` harness is built. | `docs/decisions/L097-scene-call-writer-rendering.md` |
| L96 | 2026-05-09 | active | Scene contract planner behavior shipped behind `scenePlanContractV1=false`. LXC smoke validated wiring + structural-v1 retry; surfaced real LLM prompt-fidelity gaps (crisisChoice→sourced-obligation, payoffEventId compliance) that block default-on promotion until a follow-up calibration slice closes them. Slice 1.5 amendment demoted validator to advisory mode. | `docs/decisions/L096-scene-contract-planner-behavior.md` |
| L95 | 2026-05-09 | active | Scene contract substrate: optional scene-contract schema fields, widened seven-value `storyDebtStage` enum, `scenePlanContractV1` flag, and `enforceScenePlanContract` helper. Amended 2026-05-10: `sceneId` is the per-entry identity; `beatId` is beat-specific/legacy only. | `docs/decisions/L095-scene-contract-substrate.md` |
| L94 | 2026-05-09 | active | Production drafting defaults to exact-ID character context capsules after fixed-plan POC evidence improved expansion without semantic/prose regressions. | `docs/decisions/L094-production-character-context-default.md` |
| L93 | 2026-05-09 | active | Extend stable-ref traceability into runtime thread/payoff refs: directives, state-mapper obligations, writer context, and telemetry carry IDs without making thread semantics blocking. | `docs/decisions/L093-run-thread-id-drafting-coherence.md` |
| L92 | 2026-05-09 | active | Scene is the next primary plan/write/check unit; beats remain annotation, obligation, and traceability granularity inside scenes while legacy beat checks are adapted upward where useful. | `docs/decisions/L092-scene-first-writing-beat-annotation.md` |
| L91 | 2026-05-07 | active | Plan Readiness Review is the default checkpoint between planner diagnostics and drafting when diagnostics are available; items are conversational/manual and become changes only through `planning_edit` proposals. | `docs/decisions/L091-plan-readiness-review-default.md` |
| L90 | 2026-05-07 | active | Active LLM calls use only DeepSeek V4 Flash or DeepSeek V4 Pro with per-role thinking level; legacy provider/model references are historical, not active routing permission. | `docs/decisions/L090-deepseek-only-active-model-policy.md` |
| L89 | 2026-05-07 | active | Methodology experiments must name the optimized layer and isolate one layer at a time; current product focus is upstream concept/planning templates and plan quality, not broad UI/writer/checker changes. | `docs/decisions/L089-layer-scoped-methodology-experiments.md` |
| L88 | 2026-05-06 | active | Downstream beat calibration/packing is diagnostic evidence only; native chapter contracts and story-turn planning are the production default with legacy rollback. | `docs/decisions/L088-upstream-native-planning-contract.md` |
| L87 | 2026-05-06 | active | Agents must state the changed phase/surface, exact change, expected benefit, downstream projection, and evidence gate before non-trivial implementation. | `docs/decisions/L087-agent-phase-impact-contract.md` |
| L86 | 2026-05-06 | superseded | Accelerated semantic-gate cohorts showed hard beat caps delete context and calibrated packing preserves obligations better, but L88 supersedes downstream packing as product direction. | `docs/decisions/L086-calibrated-planner-shape.md` |
| L85 | 2026-05-06 | active | Development is mainline-first: work directly on `main`, use rollback tags for risky moves, and reserve branches for explicit requests or disposable experiments. | `docs/decisions/L085-mainline-first-workflow.md` |
| L84 | 2026-05-06 | active | Continuity findings remain diagnostic/review evidence and no longer open Drafting Plan-Assist gates by themselves; Beat/plan, halluc-ungrounded, validation, integrity, and functional blockers remain load-bearing. | `docs/decisions/L084-continuity-diagnostic-drafting-gates.md` |
| L83 | 2026-05-06 | superseded | Continuity-state warning N=50 follow-up found 0% TP, 88% FP, 12% AMB. Runtime-gating implication superseded by L84; panel evidence remains relevant. | `docs/decisions/L083-continuity-state-warning-panel-2026-05-06.md` |
| L82 | 2026-05-06 | active | Fact-role live A/B remains hold: role filtering worked, but both arms gated on chapter-2 continuity and role-aware regressed cost/hallucination. Default runtime stays legacy; role-aware remains A/B-only. | `docs/decisions/L082-fact-role-ab-hold.md` |
| L81 | 2026-05-05 | active | Continuity gray-zone panel N=20: continuity-facts blocker/warning is reasonably calibrated (60% TP), continuity-state/warning is the dominant gray zone (20% TP, 80% non-catch), object_emphasis subcategory is well-calibrated. Follow-up needs N≥50 stratified panel before any production checker change. | `docs/decisions/L081-continuity-grayzone-panel-2026-05-05.md` |
| L80 | 2026-05-05 | active | Test and invariant work uses a dedicated support/evidence role with tiered gates, proof-before-blocking, and no hidden broad `bun test` reliance. | `docs/decisions/L080-test-invariant-agent-contract.md` |
| L79 | 2026-05-04 | active | Authoring harness refinement: prioritize visibility/interactivity and deterministic impact awareness; require A/B evidence before production creative-heuristic wiring. | `docs/decisions/L079-authoring-harness-eval-gates.md` |
| L78 | 2026-05-04 | active | UI/browser and CI posture: use Playwright MCP for browser preflight, keep external CI on hold indefinitely, backlog artifact/Canon observer expansion. | `docs/decisions/L078-ui-browser-ci-posture.md` |
| L77 | 2026-05-04 | active | Proposal provenance and downstream checker attribution: proposals are system/user-triggered change requests; checker-fire outcomes require explicit correlation, not inference. | `docs/decisions/L077-proposal-provenance-checker-attribution.md` |
| L76 | 2026-05-04 | active | Phase 7 rollout posture: persist proposal envelopes at review checkpoints, keep Canon manual, use explicit outcome source and promotion tiers. | `docs/decisions/L076-phase-7-policy-rollout-posture.md` |
| L75 | 2026-05-04 | active | Phase 7 local guard, downstream metric shape, and generator replay harness. | `docs/decisions/L075-phase-7-generator-replay-guard.md` |
| L74 | 2026-05-04 | active | Phase 6 review fixes and Phase 7 replay-metrics tracer bullet. | `docs/decisions/L074-phase-7-replay-tracer.md` |

## Earlier History

Earlier decisions remain preserved in the full log:

- `docs/decisions/full-log-2026-05-04.md`

If an older decision becomes active again, extract it into
`docs/decisions/LNNN-short-slug.md`, add a row above, and mark the old archived
entry superseded by the extracted file.

## Maintenance Rules

- Keep this index under 250 lines.
- One table row per active or recently relevant decision.
- Put detailed rationale, evidence, alternatives, and implications in the
  linked decision file.
- Use `status: active | historical | superseded` frontmatter in detail files.
- Run `bun run docs:weight` before closing docs-heavy work.
