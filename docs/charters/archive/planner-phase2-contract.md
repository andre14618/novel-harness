---
status: superseded
kind: experiment-charter
experiment-family: planner-phase2-contract
proposed-by: claude (main thread)
proposed-date: 2026-04-18
adversary-verdict: RED
adversary-reviewed: 2026-04-18
superseded_by: docs/charters/planner-phase2-payoff-floor.md
archived: 2026-04-18
---

> **Archived 2026-04-18** — superseded by [`planner-phase2-payoff-floor.md`](../planner-phase2-payoff-floor.md). Retained here for historical audit trail per `docs/commit-conventions.md` "Superseded Documents." See [`docs/charters/archive/README.md`](README.md) for the full index.

# Experiment Charter — `planner-phase2-contract-v1`

Top priority from the 2026-04-18 Codex directional review (session `019da256-1273-78a2-9569-4543c735612e`). Motivated by `docs/current-state.md`'s stated ordering "planner expressiveness > beat-context delivery > narrow checker calibration > writer LoRA upgrades" and by `docs/todo.md` §3 "Planner Phase-2 enrichment."

## 1. Question

Does enriching the Phase-2 planner output with structured setup/payoff links, per-speaker content directives, and thematic/subplot tags measurably reduce chapter-plan-checker deviation rate and beat-level adherence retries on fantasy seeds — without blowing the planner's 8K output ceiling?

## 2. Hypothesis

**If** Phase-2 beats gain `establishedFact.id` (stable IDs), per-beat `requiredPayoffs: [{fact_id, payoff_beat}]`, per-beat `speaker_directives` (per-character content obligations, not voice), per-beat `subplot_id`, and per-beat `thematic_focus`, **then** chapter-plan-checker deviation rate on matched fantasy seeds **will drop** by ≥30% relative and beat-level adherence first-attempt pass **will rise** by ≥5 absolute percentage points, **because** the writer receives explicit per-beat content obligations it was previously expected to infer from description prose alone, and because adherence-events + chapter-plan-checker now have structured anchors to verify rather than natural-language descriptions to interpret.

## 3. Falsification threshold

If chapter-plan-checker deviation rate moves <10% relative AND adherence first-attempt pass moves <2 absolute points, the mechanism ("richer structured plan → more on-plan writing") is wrong. Likely causes: (a) writer ignores structured fields when a natural-language description is also present, (b) Phase-2 output hits the 8K ceiling and truncates, (c) fields are too abstract for 14B checkers to verify. If falsified, **abandon schema enrichment as the lever**; redirect to item #2 (cross-chapter state propagation) or item #3 (hallucination wire-in).

## 4. Baseline ladder

| Slot | Model / config | Purpose |
|------|----------------|---------|
| Floor | Phase-2 schema without new fields (prompt-only nudge: "describe payoffs in beat descriptions") | Cheapest prompt-only counterfactual — rules out pure prompt engineering |
| Current prod | Current Phase-2 schema (no new fields, no prompt nudge) | Live baseline at 2026-04-18 |
| V1a (this experiment — minimal) | `requiredPayoffs[]` + `establishedFact.id` only | Smallest field set that can carry the payoff-link mechanism |
| V1b | V1a + `speaker_directives` | Adds per-character content obligation layer |
| V1c | V1b + `subplot_id` + `thematic_focus` | Full field set from `docs/todo.md` §3 |
| Ceiling | Human-authored chapter outline with all fields filled by hand on one seed | Upper bound on "what structured planning enables" — not shippable, diagnostic only |

**Phasing discipline:** ship V1a first, measure, only proceed to V1b if V1a clears §7 ITERATE threshold. `thematic_focus` and `subplot_id` are lowest-leverage and are gated on V1a+V1b success.

## 5. Cheapest counterfactuals considered

| Lever | Estimated cost | Rejected because |
|-------|----------------|------------------|
| Prompt-only nudge on existing schema ("make sure every setup is described in a payoff beat") | $0 | **MUST BE MEASURED as the Floor rung.** `docs/agents/planning-beats/beat-expansion-system.md:44-45` already contains a weaker version of this directive. If a strengthened prompt alone clears the §7 ITERATE threshold, schema churn is not warranted. |
| Inference-time: adherence-events infers setups/payoffs from description text via NER-style prompting | $0–0.01/beat | Fragile on 14B checker per `docs/lessons-learned.md` "14B can't handle complex single-call checklists"; would violate the decomposition feedback. Also doesn't help the writer — the signal arrives too late. |
| Single-field V1: ship only `requiredPayoffs` + `establishedFact.id` (V1a above) | 1–2 days | **This is the V1a plan.** Kept in-scope as the minimal mechanism test; full 5-field expansion is gated on V1a results. |
| Give planner more tokens (raise 8K ceiling via model swap, e.g. DeepSeek → Sonnet-tier) | ~$0.05/chapter | Rejected for V1: doesn't change the information the writer receives. Considered for a future V2 if V1a/V1b succeeds but output-ceiling-truncation is the blocker. |

The prompt-only floor **must** run as part of V1a measurement, not as a separate experiment. If prompt-only matches V1a within the §3 falsification threshold, kill V1a.

## 6. Distribution match

- **Train set:** Not applicable — this is a schema + prompt change, not a fine-tune. No training data required.
- **Eval set (pilot):** 3 fantasy seeds currently running cleanly on Salvatore voice LoRA route (`fantasy-healer`, `fantasy-debt`, `dark-fantasy`). Each seed run 2× (old schema, new schema V1a) for paired measurement. 3-chapter target per run.
- **Production distribution (real planner outputs in `llm_calls`):** sampled from last 5–10 completed novels via the `adherence-events` and `chapter-plan-checker` agent calls. Pilot seed set must sit within that distribution on chapter length + beat count, not extreme tails.

**Mismatch flag:** 3-seed pilot is small. If variance in chapter-plan-checker deviation rate across seeds exceeds the 30% relative target, escalate to 5–7 seeds before declaring ship/kill. Per `docs/lessons-learned.md` "Pilot checkers in production," synthetic-only signal is a lower bound; production pilot is the load-bearing measurement.

## 7. Success criteria

| Outcome | Condition | Action |
|---------|-----------|--------|
| SHIP V1a | Chapter-plan-checker deviation rate −30% relative AND adherence first-attempt pass +5 abs pts on 3-seed pilot, P<0.05 paired; planner output stays <7.5K tokens on all chapters | Promote schema + prompt changes, update `docs/current-state.md`, queue V1b charter |
| ITERATE V1a | Directional improvement on at least one metric, but below SHIP threshold; or output truncation on ≥1 chapter | Revise schema shape (fewer/simpler fields, different wording) and re-run |
| KILL | Falsification threshold (§3) hit: both metrics move <target | Abandon schema enrichment; redirect to item #2 (cross-chapter state) per `docs/current-state.md` improvement ordering |

V1b and V1c have their own charters — this charter commits only to V1a.

## 8. Budget

- **Spend cap:** ~$5 — 3 seeds × 2 runs × 3 chapters ≈ 18 chapters on DeepSeek V3.2 + Salvatore voice LoRA + checker adapter calls.
- **Time cap:** 3 days wall-clock for schema + prompt changes + pilot runs + measurement.
- **Stop if:** planner output truncates on ≥2 pilot chapters (indicates 8K-ceiling breach — revise schema before continuing); any pilot run fails to complete for non-schema reasons (infra, model outage).

## 9. Linked context

- Prior experiments:
  - #221 (planner Phase-1 strict skeleton schema) — resolved the 8K truncation on a 10-chapter scale by splitting skeleton from beats. This charter inherits that architecture.
  - Structural priors (committed 2026-04-17 as part of the fantasy-structural-context-engineering work) — already live in `WRITER_GENRE_PACKS`; V1a adds to, does not replace, those priors.
- Related decisions: `docs/decisions.md` → "Context-engineering-forward architecture" (2026-04-18), "Two-phase planner" (2026-04-17).
- Related directional review: session `019da256-1273-78a2-9569-4543c735612e` — Codex placed this at #1.
- Code to commit before run (one change per commit per `commit-conventions.md`):
  1. Schema additions in `src/schemas/shared.ts` (+ `src/agents/planning-beats/schema.ts`)
  2. Prompt updates in `src/agents/planning-beats/beat-expansion-system.md`
  3. Beat-context surfacing in `src/agents/writer/beat-context.ts` + `src/agents/writer/context.ts`
  4. Adherence-events payoff verification in `src/agents/adherence-events/` (stretch — may land as V1a.1 if scope creeps)
  5. Chapter-plan-checker acknowledgment of new fields in `src/agents/chapter-plan-checker/context.ts`
  6. Update `docs/current-state.md` in the Phase-2 commit that ships the schema (per the Docs Impact Rule)
- `tuning_experiment` ID: **#TBD — allocate via `createTuningExperiment()` before the pilot run**.

## 10. Adversary review

Primary reviewer is Codex via `/charter-review` → `/codex:adversarial-review`. Block on YELLOW or RED. Iterate the charter, not the run.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT, direct) — primary | **RED** | 2026-04-18 | Session `019da279-313c-7863-aad8-f483ff08e9d7`. 5 blocking, 2 warnings. Revise-required. Verdict recorded in §10.a. |
| `/codex:adversarial-review` (GPT, rescue-forwarded) — independent duplicate | **RED** | 2026-04-18 | Concurring verdict from a parallel Codex run — same RED, same core critique. No dissent across the two reviews. |
| `experiment-adversary` (Opus) — fallback only | — | — | Not run — Codex primary returned a decisive RED with an independent duplicate agreeing |

### 10.a Adversary verdict summary (Codex, 2026-04-18)

**RED.** The charter cannot be run as written. Worse: **parts of V1a already landed on `main` before this verdict came back**, which makes a clean baseline measurement newly expensive.

Blocking issues (each cites `docs/experiment-design-rules.md §N.M`):

1. **§2.1 / §2.2 — Effect-size targets ungrounded.** §2's "−30% relative deviation" and "+5 abs pts adherence first-attempt" are not backed by matched baseline rows for the actual pilot seeds. `dark-fantasy` is already at 100% first-attempt pass on adherence-events and chapter-plan in exp #191 (see `docs/decisions.md:626`); there is no headroom for the stated +5 pt claim on that seed. `fantasy-healer` and `fantasy-debt` are uncited — numbers read as vibes, not baselines. Fix: attach matched baseline rows for all three pilot seeds on the exact eval window, or delete the numeric ship/falsification thresholds.
2. **§9.3 / §11.1 — Floor rung sandbagged; inference-time counterfactual skipped.** §4's Floor ("describe payoffs in beat descriptions") is *weaker* than the live Phase-2 prompt, which already says "Required facts must live IN beat descriptions" with explicit setup→payoff rules and orphan-fact prohibition (see `src/agents/planning-beats/beat-expansion-system.md:47-61`). §5 also omits the inference-time extraction pass explicitly flagged in the charter's own §11. V1a would look artificially good because the Floor was sandbagged. Fix: block until the strongest prompt-only Floor AND a measurement-only inference-time extraction pass are both measured on the frozen pre-V1a surface.
3. **§3.3 / §7.1 / §9.1 — Sample underpowered by ~4 orders of magnitude.** §6 = 3 seeds × 2 runs × 3 chapters = 9 paired chapter observations. Codex ran the actual paired-binary power calc: for a 30% relative deviation reduction at §7's "P<0.05 paired" claim, power is ~0.000003 at 20% baseline deviation, ~0.000012 at 25%, ~0.000634 at 50%. Effectively zero. Fix: expand the paired sample by an order of magnitude and pre-declare the statistical unit/test, or drop all p-value language and reclassify as exploratory.
4. **§3.1 / §4.4 / §11.5 — Measuring instrument moves with the mechanism.** §2 says the gain comes from "adherence-events + chapter-plan-checker now have structured anchors to verify," but §9.4 classifies adherence-events payoff verification as "stretch" and §11.4 admits `adherence-checker-v4` was trained without payoff signals. If the verifier is updated during V1a, any lift is "new checker rubric" not "better writing." If it isn't, the metric may miss the mechanism entirely. Fix: freeze verifier surfaces for V1a, or move verifier updates into a separate charter.
5. **§1.2 / §11.5 — Baseline contamination: V1a already partially landed on `main`.** `docs/current-state.md:54-55` already declares "Phase-2 planner output carries structured payoff links (V1a, 2026-04-18)." The planning prompt (`src/agents/planning-beats/beat-expansion-system.md:10-18,51-61`) already requests `requiredPayoffs` and `establishedFact.id`. Schemas in `src/schemas/shared.ts` accept them. That means the "pre-V1a baseline" required for a clean A/B is no longer on `main` — anyone running the pilot today is running V1a-on-V1a. Fix: either (a) freeze and tag a pre-V1a baseline commit + re-run from that ref, (b) revert the V1a implementation commits until the Floor+inference-time counterfactuals land and are measured, or (c) stop claiming this charter tests *only* V1a.

Warnings:

- §8 treats the 8K output-ceiling check as a mid-pilot stop-loss instead of a pre-run shape gate, even though the 2026-04-17 two-phase-planner decision made output ceiling a first-class constraint. Discovering token-budget invalidity two chapters in is wasted pilot spend. §9.1.
- §4's "human-authored one-seed ceiling" is never required by §7 to run before interpreting V1a. A ladder rung that can be skipped is not a ladder rung. §§2.1, 2.3.

Cheapest untried counterfactual per adversary: **aggressive prompt-only Floor on the frozen pre-V1a schema**, ~$0, expected to erase most or all of the claimed V1a lift if the real mechanism is "put payoff obligation explicitly into the beat description" rather than "add new JSON fields." The live prompt already demonstrates that stronger wording is available.

Recommended next action: **RUN CHEAPER COUNTERFACTUAL** (§5; rules §9.3, §11.1).

### 10.b Pending revise actions

- [ ] **Establish a clean pre-V1a baseline.** Either (a) tag the pre-V1a commit (the parent of `27e9dfb`) as `pre-planner-phase2-v1a`, or (b) revert commits `27e9dfb`, `28c3b8a`, `f7f3865`, `02448bc`, `c418fba` until the counterfactual measurement completes. Decision is user-level — implicates how much current-state doc drifts.
- [ ] Measure the strongest-possible prompt-only Floor (drop-in swap of the beat-expansion system prompt with aggressive payoff-obligation wording, no schema use) on the three pilot seeds. Expected: matches or erases V1a's claimed lift.
- [ ] Measure the inference-time extraction counterfactual ("did this beat realize an earlier setup?") on production prose without any Phase-2 schema use.
- [ ] Attach matched baseline rows for `fantasy-healer` and `fantasy-debt` (dark-fantasy already at 100% — effectively ceilinged on adherence, use a different primary for it or drop it).
- [ ] Expand pilot to at least 30–90 paired observations before making any significance claim, or reclassify as exploratory.
- [ ] Freeze the verifier stack for the V1a measurement window — no adherence-events or chapter-plan-checker retraining during pilot.
- [ ] Convert §8 truncation-risk into a pre-run shape gate: estimate expected token delta per chapter × beat count × field count ahead of time, and gate pilot launch on that estimate coming in under budget.

## 11. Open questions for adversary review

Flagged here so the reviewer hits them:

1. **Is the prompt-only Floor rung strong enough?** A weak prompt nudge will make V1a look artificially good. The Floor prompt must be as aggressive as a reasonable engineer would try before reaching for schema change.
2. **Are 3 fantasy seeds enough?** `fantasy-healer` / `fantasy-debt` / `dark-fantasy` — is cross-seed variance likely to swamp a 30% effect? If yes, escalate pilot size in §6.
3. **Does `speaker_directives` double-count against `characters[]`?** The existing `sceneBeatSchema` already carries a character list. The distinction ("characters = who is present" vs "directives = what each advances/reveals") must be concrete enough that the planner doesn't just copy one into the other.
4. **Is adherence-events capable of verifying payoffs without retraining?** The current V4 adapter was trained on 2,134 pairs that didn't include payoff signals. A structured payoff-reference field may pass through unused. Retraining the checker is a separate experiment and must not be smuggled into this charter.
5. **8K output-ceiling risk:** adding 5 fields per beat to ~14 beats per chapter = meaningful token overhead. The stop-condition in §8 is the safety net, but the charter should estimate the expected token delta ahead of time.
