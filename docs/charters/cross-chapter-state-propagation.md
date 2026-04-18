---
status: revise-required
kind: experiment-charter
experiment-family: cross-chapter-state
proposed-by: claude (main thread)
proposed-date: 2026-04-18
adversary-verdict: RED
adversary-reviewed: 2026-04-18
---

# Experiment Charter — `cross-chapter-state-propagation-v1`

Item #2 from the 2026-04-18 Codex directional review (session `019da256-1273-78a2-9569-4543c735612e`). Motivated by Codex's finding that `src/phases/planning.ts:188` hard-codes `priorChapters: []` when expanding Phase-2 beats, so every chapter is expanded without visibility into its predecessors' established facts or character state. The comment on that line asserts "cross-chapter coherence lives in the skeleton tier," but skeletons (Phase 1) carry only POV / setting / purpose / targetWords / charactersPresent — not `establishedFacts` or `characterStateChanges`, which are Phase-2 outputs.

## 1. Question

Does serializing Phase-2 beat expansion across chapters (so each chapter's expansion sees the expanded state of earlier chapters) measurably reduce on-plan and continuity failures — enough to justify the ~N× latency penalty of losing parallel expansion?

## 2. Hypothesis

**If** Phase-2 expansion is serialized and each chapter's `buildContext` call receives `priorChapters: [ch1, ch2, …, ch_{i-1}]` with fully-expanded beats + end-of-chapter state, **then** continuity-v2 deviation rate on the 3-seed fantasy pilot **will drop by ≥25% relative** and adherence first-attempt pass **will rise by ≥3 absolute points** on beats that reference prior-chapter state, **because** the planning-beats model currently has no way to know what was actually established or what a character's state is at the start of a chapter beyond what the skeleton line implies — it's inferring from purpose text alone.

## 3. Falsification threshold

The mechanism is wrong if either:

1. Continuity-v2 deviation moves <10% relative AND adherence first-attempt moves <1 abs pt on the pilot. The prior-chapter state feed isn't being used or isn't the right shape.
2. Planner latency on a 10-chapter novel exceeds **8× the current parallel baseline** without a compensating quality gain ≥20% on the primary metric (continuity deviation). Serialization tax isn't worth it — revisit a partial-order approach (e.g. serialize only adjacent chapters).

If falsified on (1): the mechanism is wrong. Abandon serial expansion. Consider instead a **state-brief Phase-1.5 pass** (plotter emits per-chapter end-state declarations alongside skeletons so Phase 2 has something to read without needing prior-chapter expansion).

If falsified on (2): quality gain is real but cost is too high. Pivot to **bounded serial** (expand chapters 1→k serially with k=3, then fan out the rest in parallel using the first k's state as shared context).

## 4. Baseline ladder

| Slot | Model / config | Purpose |
|------|----------------|---------|
| Floor | Parallel Phase 2 with `priorChapters: []` (current production) | What shipped as of 2026-04-17 |
| Current prod | Same as floor | Live baseline |
| V1 (this experiment) | Serial Phase 2, `priorChapters` = all earlier-expanded chapters | Minimal mechanism test |
| Partial | Bounded serial (first k=3 chapters serial, rest parallel from prefix state) | Fallback if V1 is too slow |
| Ceiling | Human-authored "what's been established / what characters know" brief injected before each Phase-2 call | Upper bound on "what prior-state delivery enables" |

## 5. Cheapest counterfactuals considered

| Lever | Estimated cost | Rejected because |
|-------|----------------|------------------|
| Prompt-only: strengthen skeletons to carry a terse `endsWith: string` note per chapter, leaving Phase 2 parallel | ~$0 | **MUST BE MEASURED as Floor+** rung. If the plotter can emit a 1-line end-state summary per skeleton and that alone feeds Phase 2 well enough, serialization is unnecessary. Skipping this measurement is a §11.2 violation — run it alongside V1. |
| Phase-1.5 state-brief: plotter emits structured `endStateBrief: {facts: string[]; stateChanges: string[]}` per skeleton | ~$0–0.02/chapter (more plotter output tokens) | Strictly more expressive than the 1-line note. Kept as a pivot target if V1 falsifies on cost (§3 prong 2). Not V1 itself because it's additive schema churn — V1 stays minimal. |
| Retrieval-time: at drafting time, fetch prior chapters' saved outlines from DB and merge into beat context | ~$0 | **Already partially supported** — `src/agents/writer/beat-context.ts` reads DB. But this is at drafting, not planning. Can't fix planner hallucinations of "what's been established" after the plan is frozen. |
| Give planner more tokens (Sonnet for Phase 2) | ~$0.15/chapter | Orthogonal to state propagation. Doesn't fix the information gap. |

The prompt-only Floor+ rung (1-line `endsWith` in skeleton output) **must run in the same pilot** as V1 to isolate whether state propagation needs full expanded-prior or just a 1-line hint.

## 6. Distribution match

- **Train set:** Not applicable — no fine-tune, prompt/code change only.
- **Eval set (pilot):** Same 3 fantasy seeds as `planner-phase2-contract-v1` (`fantasy-healer`, `fantasy-debt`, `dark-fantasy`) × 2 runs (parallel baseline, serialized V1) × 3 chapters = 18 data points for paired measurement. Optionally add Floor+ as a 3rd arm for 27 data points.
- **Production distribution:** 10-chapter fantasy novels dominate recent `llm_calls` — the latency tax is most visible there.

**Mismatch flag:** the 3 pilot seeds in use were selected for clean Salvatore voice routing. Cross-chapter state propagation should help *more* on novels with heavier cross-chapter callbacks. The seeds may understate the upside.

## 7. Success criteria

| Outcome | Condition | Action |
|---------|-----------|--------|
| SHIP V1 | Continuity-v2 deviation −25% rel AND adherence +3 abs pts, pilot latency ≤8× parallel baseline | Ship serial Phase 2; update `docs/current-state.md` |
| SHIP Floor+ instead | Floor+ (1-line `endsWith`) clears SHIP threshold within 10% of V1's quality; keeps parallel execution | Ship Floor+; drop V1 serial path |
| ITERATE | Quality directionally positive but below threshold, OR latency >8× | Revisit Phase-1.5 state-brief or bounded-serial per §3 |
| KILL | Falsification §3 prong 1 hit: both quality metrics move <target on both V1 and Floor+ | Abandon cross-chapter state propagation as a lever; redirect to item #3 (hallucination wire-in) |

## 8. Budget

- **Spend cap:** ~$5 — 3 seeds × up to 3 runs × 3 chapters ≈ 27 chapters on DeepSeek V3.2 + Salvatore voice LoRA + checker adapter calls.
- **Time cap:** 2 days wall-clock.
- **Stop if:** planner latency exceeds 15× baseline on a 3-chapter run (indicates serious regression), any seed fails to complete for non-code reasons, or Floor+ decisively wins V1 early (cut V1 short).

## 9. Linked context

- Prior experiments: #221 (planner Phase-1 strict skeleton schema, two-phase planner introduction 2026-04-17). Parallel Phase 2 was orthogonal to the ceiling fix in #221 — worth stating so the adversary doesn't conflate them.
- Related decisions: `docs/decisions.md` → "Two-phase planner" (2026-04-17), "Context-engineering-forward architecture" (2026-04-18).
- Related directional review: Codex session `019da256-1273-78a2-9569-4543c735612e` — item #2.
- Code to commit before run (one change per commit):
  1. Serial-expand variant in `src/phases/planning.ts` (feature-flagged via env var or config so the parallel path can still be A/B-compared in the same pilot harness).
  2. Floor+ 1-line `endsWith` variant — skeleton schema adds optional field, Phase-2 prompt references it.
  3. `docs/current-state.md` update post-pilot reflecting whichever arm ships.
- `tuning_experiment` ID: **#TBD — allocate via `createTuningExperiment()` before the pilot run**.

## 10. Adversary review

Primary reviewer is Codex via `/charter-review`. Block on YELLOW or RED. Iterate the charter, not the run.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — primary | **RED** | 2026-04-18 | 5 blocking, 3 warnings. Charter revise-required before pilot. See session `019da27c-b704-7d23-b1bf-3eb7004b6389` for full verdict. Summary below. |
| `experiment-adversary` (Opus) — fallback only | — | — | Not run — Codex primary returned a decisive RED |

### 10.a Adversary verdict summary (Codex, 2026-04-18)

**RED.** The charter must be revised before any `planning.ts` change lands or pilot runs.

Blocking issues (each cites `docs/experiment-design-rules.md §N.M`):

1. **§3.1 — Primary metric not aligned to current architecture.** The charter uses `continuity-v2` deviation rate as the primary ship signal, but `docs/current-state.md:66-73` explicitly marks continuity as *deprioritized*. A ±25% move on a deprioritized checker doesn't cleanly answer whether cross-chapter state propagation matters. Fix: either prove continuity-v2 is a reliable decision metric on this eval set, or replace it as the primary criterion.
2. **§11.5 / §2.1 — Confound with adjacent experiment.** This charter and `planner-phase2-contract-v1` share the same 3 fantasy seeds and both touch Phase-2 planner behavior. Any measured delta could come from Phase-2 schema (`establishedFact.id`, `requiredPayoffs`, already live per `src/schemas/shared.ts`), from serial prior-state propagation, or both. Fix: isolate the baseline before running on the shared pilot set.
3. **§4.6 — Mechanism / architecture mismatch.** The charter claims V1 tests "fully-expanded beats + end-of-chapter state," but the actual `priorChapters` renderer (`src/agents/planning-beats/context.ts:14-21,56-58`) surfaces only `characterStateChanges` and `establishedFacts` — it *omits* `knowledgeChanges` entirely. Mechanism doesn't match architecture; makes the reader-info split in §11.5 untestable-by-shape. Fix: narrow the mechanism claim to the actual state surface delivered, or accept that results will be uninterpretable.
4. **§6.4 / §7.1 — Seeds biased away from hypothesized failure mode.** §6 admits the 3 pilot seeds were picked for clean Salvatore voice routing, not heavy cross-chapter callbacks. 18–27 chapter samples on low-callback seeds is not decision-grade evidence for a cross-chapter-state lever. Fix: justify the seeds as stress cases or stop treating null/win on them as dispositive.
5. **§11.5 — Self-contradictory comparison protocol.** §5/§11.2 require Floor+ and V1 "in the same pilot," §8 says cut V1 short if Floor+ wins early, and §7 says ship Floor+ if it lands within 10% of V1. No coherent decision rule covers Floor+ vs V1 vs near-tie. Fix: define an interpretable comparison policy up front.

Warnings (non-blocking but address in conclusion):

- The "missing control arm" framing in §11.6 is wrong — the current `Floor` / `Current prod` IS the no-state control (parallel with `priorChapters: []`). The real flaw is the undefined Floor+ vs V1 decision policy.
- `endsWith` at the Phase-1 skeleton surface is cleanly additive; no schema collision with the Phase-2 V1a `establishedFact.id` / `requiredPayoffs` already shipped. Risk is experiment confound (§11.5), not type collision.
- Deferring reader-information state isn't obviously wrong scope discipline, but the current `priorChapters` renderer already mixes some character knowledge (`knows`) while omitting other knowledge surfaces (`knowledgeChanges`). Any conclusion applies only to the partial state feed actually tested.

Cheapest untried counterfactual per adversary: the charter's own Floor+ arm (`endsWith` skeleton hint) against the current parallel baseline, ~$0, expected ~50–80% of V1's quality movement if the real gap is "Phase 2 needs a terse end-state hint" rather than full serialization. Should answer most of the question before paying the serial-latency tax.

Recommended next action: **REVISE CHARTER (§3.1, §4.6, §11.5).**

### 10.b Pending revise actions

- [ ] Drop continuity-v2 as the primary ship signal; replace with a metric tied to the deliberate mechanism (e.g. planner-side fact-reference integrity across chapters, or a chapter-to-chapter contradiction audit that isn't continuity-v2 itself).
- [ ] Either serialize pilot scheduling vs `planner-phase2-contract-v1` (run this experiment strictly *after* the Phase-2 pilot completes and its delta is measured), or change seed set so the two experiments don't share the same 18 chapters.
- [ ] Narrow §2 mechanism language to match what the renderer actually delivers (characterStateChanges + establishedFacts, not knowledgeChanges).
- [ ] Swap or add seeds selected for heavy cross-chapter callbacks, or reduce the scope of the charter's ship/kill claims accordingly.
- [ ] Define a complete decision matrix for Floor+ × V1 × near-tie up front — including what a near-tie does (e.g. default to Floor+ on latency grounds).
- [ ] Ground the 8× latency ceiling in an actual `llm_calls` measurement rather than intuition. Decision 2026-04-17 ("two-phase planner") already predicted ~10× — cite it explicitly or correct it with fresh data.

## 11. Open questions for adversary review

1. **Is 8× latency ceiling (§3 prong 2) the right number?** A 10-chapter novel currently runs Phase 2 in ~30s parallel; serial would be ~300s = 10×. The charter allows up to 8× — hard-coded from intuition, not measurement. What's the actual user-experience tolerance on planner latency?
2. **Should V1 and Floor+ run in the same pilot or sequential?** If Floor+ wins, V1 never runs. If V1 wins marginally, Floor+ might still be preferred for latency. Adversary should attack the sequencing choice.
3. **Cross-chapter coherence signal isolation.** The current continuity-v2 adapter is "deprioritized" per `docs/current-state.md` — is it even reliable enough to detect the ≥25% deviation change this charter hypothesizes? If not, the metric is unreliable.
4. **Is the 3-seed set biased toward seeds that don't stress cross-chapter state?** The distribution-match §6 flag acknowledges this — adversary should attack whether we need to swap seeds or add seeds with heavier callback structure.
5. **Does the charter smuggle in the reader-information state tracker?** Codex's directional-review §2 grouped "reader-information state" and "cross-chapter state" together. This charter covers only the latter. Adversary should confirm the split is clean and reader-state is a genuinely separate charter.
6. **Schema leakage.** V1 requires no schema change, but Floor+ adds a `endsWith` field to skeletons. Is that additive or does it interact with the Planner-Phase-2 V1a `establishedFact.id` work already landed?
