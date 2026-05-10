---
job: 7
title: Synthesis - Ranked Implementation Backlog with Conflicts Resolved
date: 2026-05-10
model: opus
status: draft (decision artifact, not promotion-ready)
inputs:
  - opus-harness-autopsy.md
  - opus-craft-market-synthesis.md
  - opus-method-pack-candidates.md
  - opus-semantic-judge-plan.md
  - opus-overbuild-critique.md
  - opus-layer-bottleneck.md
---

# Synthesis — Ranked Implementation Backlog with Conflicts Resolved

## Section 1 — The Picture After All Six Reads

The harness ships clean prose at the floor and fails at the ceiling in one consistent place: **the scene as a unit of dramatic change.** Sentences are good, paragraphs are anchored, the writer prompt is the most disciplined artifact in the repo, and the L094 character-context capsules are real lift. But the 2026-05-10 fantasy-healer run (1.89×/3.03× word ratio, `endpointIssues=2`, `weakStoryTurnBeats=3`, `threadId=0/promiseId=0/payoffId=0`, 11 halluc-ungrounded retries on writer-coined officers) is the dominant evidence: the planner emits beats keyed to facts/knowledge/state continuity, the writer is asked to dramatize Goal→Conflict→Disaster from a 1–2 sentence beat description, and there is no contract that says where one scene ends and the next begins. The L097 `SCENE CONTRACT` block exists, the L093 thread/promise/payoff substrate exists, the planner-discernment dimensions are 100% exact in calibration — none of it is wired into the default writer prompt path. Job 6 is right: B (scene-level planning + writing) is the bottleneck.

What is genuinely over-built (per Job 5): Phase 7 ApprovalPolicy (no live consumer), the five corpus-extractor structure agents masquerading as a planner toolkit (R12 in autopsy), zombie schema fields like `materialityTest` / `structureSlotId` / `sceneTurnId` shipped ahead of consumers, ID metadata rendered into the writer's prompt as a tax on prompt tokens, and at least eight default-off flags creating substrate-ahead-of-validation drift. Eight of twelve concrete surfaces audited are at-most-partly-consumed.

The single most-leveraged direction: **flip the L097 SCENE CONTRACT block on by default with deterministic field-population fallback, run it on a writer-undershoots fixture authored to make the lever visible, and freeze every other lane until B's evidence gate clears.** This is autopsy R1, layer-bottleneck R1, and corpus-recreation POC's already-validated stack converging on the same intervention.

The primary tension this synthesis resolves: Jobs 1, 2, 3, 4 collectively propose ~30 additive interventions (new judges, new method packs, new templates, new schema fields, new diagnostics). Job 5 makes the structural argument that the harness's repeated failure pattern is "build substrate ahead of consumer," and that adding 30 more is wrong-direction without removing or freezing 8 existing ones first. **Synthesis position: Job 5 is right on direction, but Job 6 names the one additive that *is* a load-bearing consumer for substrate already built.** The backlog's job is to ship that one additive (B's scene contract) on the cheapest possible evidence, while subtracting the substrate-without-consumers Job 5 audited and explicitly deferring the 7 method packs, the 12 craft templates, and the 7-judge prose panel until B has cleared. Where Jobs 1–4 said "add N", we add 1, freeze 4, and remove 3.

Two additional integrating positions: (a) The autopsy's R11 (operator oracle dataset, ~50 chapters) is the *prerequisite header* for any LLM-judge-as-runtime-blocker promotion, not a co-equal sibling — every "promote J1 to blocker" path runs through it. (b) The fantasy-healer evidence pins the immediate bottleneck at scene contracts; if R11 lands first, we can wire J1/J2 as warning-class falsifiers for B, which is exactly the role Job 6 R2 specifies.

---

## Section 2 — Conflict Resolutions

### Conflict C1: opus-harness-autopsy.md:R1 vs. opus-overbuild-critique.md:P1
- **What Jobs 1–4 proposed**: Promote scene contract into the default writer-prompt path. Flip `sceneCallWriterV1` semantics; populate fields deterministically from existing mapper output. Job 6 R1 echoes this with the same framing.
- **What Job 5 pushed back with**: V4 Flash compliance ceiling (L096 evidence: r1 22 failures, r2 7 failures, r3 22 failures with no convergence). Slice 2.5 A/B was inconclusive on wrong fixture. Lane-queue requires "writer-undershoots fixture + pre-resolved entities" before redo. Bundling four failure modes into one change violates L087 single-lever discipline.
- **Synthesis position**: Adopt the recommendation, but **only after authoring the writer-undershoots fixture set first** (Job 6 R4). Sequence dependency, not rejection.
- **Why**: The autopsy is right that B is the bottleneck. The over-build critique is right that Slice 2.5 was an inconclusive A/B because the fixture profile was wrong. Job 6's R4 is already the explicit fix; the layer-bottleneck pre-mortem item #7 names this exact failure mode. The synthesis is "build the fixture first, run the A/B second, ship the contract on evidence." V4 Flash compliance is mitigated by graceful degradation (render whatever fields exist, leave others null) — Job 5's pushback assumes binary on/off, but partial fill is the design.
- **Implication for backlog**: Item B2 is the writer-undershoots fixture set. Item B3 is the scene-contract default-on A/B against B2. They are sequenced, not parallel.

### Conflict C2: opus-harness-autopsy.md:R2 + opus-semantic-judge-plan.md:R1 vs. opus-overbuild-critique.md:P2
- **What Jobs 1–4 proposed**: Wire `sceneDramaturgy` and `endpointLanding` calibrated judges (J1, J2) as runtime warning-class checkers on prose. Deploy the 7-judge panel after 60-day operator review.
- **What Job 5 pushed back with**: User memory `feedback_dont_calibrate_noisy_llm_checkers` directly applies. The dimensions saturate at level 2 on real data; level-1 fires risk becoming constant noise. The 60-day operator review IS the labor-intensive labeling work the user has flagged as wrong-direction.
- **Synthesis position**: Modified compromise. **Run J1 and J2 as one-shot falsifiers for the B lane (Item B3), not as ongoing runtime checkers.** Defer all other prose-side judges (J3–J7) until the autopsy R11 oracle dataset is built.
- **Why**: A judge used once to score a planned A/B is not a "calibrated noisy checker" — it is the falsifier the over-build critique itself says should exist for any layer change. Wiring J1/J2 as continuous warning-class runtime checkers is the failure mode Job 5 names. Using J1/J2 to score 20 chapters in arm A vs 20 chapters in arm B and never speaking of them again is the disciplined use of a calibrated dimension. Job 6 already implicitly takes this position by listing J1 + sceneDramaturgy as B's promotion gate, not as a runtime checker.
- **Implication for backlog**: Item B3 uses J1/J2 as one-shot falsifiers. Item B4 (the oracle dataset) gates all later runtime-checker promotions of any judge.

### Conflict C3: opus-craft-market-synthesis.md:R1+R3+R5+R7+R9+R12 vs. opus-overbuild-critique.md:P3+P4+P6
- **What Jobs 1–4 proposed**: 24-chapter CFA template, romantasy template, paired STC + Story Grid genre directive, 7 method packs, mystery clue ledger, two-endings thriller, `seed.market` knob, and the cumulative schema expansion across these (~9 new seed fields, ~70 pack-specific fields).
- **What Job 5 pushed back with**: CFA v1 is `HOLD` (mean delta +0.2, win rate 50%, endpoint regression 53→44%). Adding 7 more packs each with its own evidence gate violates the "one primary lane" discipline. Genre flexibility memory (2026-05-03) explicitly says "L1 genre-neutral, L2+planner-beats parameterize by genre" — adding a 10×12 = 120 genre matrix to the seed is the opposite. None of the proposed packs has a winning head-to-head against CFA v1 yet.
- **Synthesis position**: Adopt Job 5. **Archive the entire 7-pack proposal as `parking-lot/`** and the market knob proposal as deferred. Pick *one* method pack family to validate after B ships, sequenced behind the oracle dataset.
- **Why**: Job 6 already disagrees with the method-pack artifact's framing: "method packs become valuable *after* B ships, when scene-contract field population gives them somewhere to land. Adding more method packs before B is solving the upstream input problem when the downstream pipe is the constraint." This is the exact dependency Job 6 names. The sequencing is fixed: B → oracle → one pack → maybe more. Not 7 in parallel.
- **Implication for backlog**: Item B7 is "one method pack, post-B, post-oracle" — and the choice between CMF/RMT/PFA is left as an explicit operator decision (Section 6 Q4). Items B8–B10 do not include any other packs.

### Conflict C4: opus-method-pack-candidates.md:R5 (magicCostLedger) vs. opus-overbuild-critique.md:P5
- **What Jobs 1–4 proposed**: Pull magic-cost ledger schema from THF/LRP/HST drafts into a shared L2 diagnostic fired by `magicSystemStance: hard`.
- **What Job 5 pushed back with**: `magicSystemStance` is not a field on any current seed schema. None of THF/LRP/HST has shipped. The shared diagnostic is being lifted out of three artifacts that don't exist. Recommendation-on-recommendation; the dependency chain is fictional.
- **Synthesis position**: Adopt Job 5 fully. **Drop both.**
- **Why**: This is the cleanest example of the "build substrate ahead of consumer" failure pattern. The cheapest test of the magic-cost question (Job 5's instead-do) is a single LLM-judged check on existing fantasy-healer prose. That doesn't make the backlog as its own item — it can be an operator one-off after B ships.
- **Implication for backlog**: Drop both. Not in backlog.

### Conflict C5: opus-craft-market-synthesis.md:R2 (chapter-1 hook checker) vs. opus-overbuild-critique.md:P9
- **What Jobs 1–4 proposed**: A `chapter-1-hook-checker` LLM validator on the first 150 words; route to `editorial_flag`. Job 2 calls this "the most defensible recommendation in the entire 4-doc set."
- **What Job 5 pushed back with**: Job 5 *agrees* the rec is defensible, but pushes back on shipping it now because the failure mode it catches isn't a documented harness symptom. The 5 sampled chapter-1s show interiority openings, not weather-report openings. Spending budget on a hook checker for openings that probably already pass is wrong-direction.
- **Synthesis position**: Modified compromise. **Defer the hook checker as a standalone build, but include "score the existing 5 chapter-1s with J1 endpoint-landing on the first 250 words" as a $0.10 evidence-gathering item (Item B5).** If endpoint-landing is the dominant chapter-1 problem (autopsy expects yes), the hook checker is wrong-target. If it isn't, the hook checker becomes load-bearing.
- **Why**: Job 5's framing ("do *one* thing first") is correct: gather evidence to decide between two plausible-looking interventions. The hook checker is a real candidate; just not yet.
- **Implication for backlog**: Item B5 is the cheap evidence-gathering call. Hook checker is not in the top 10.

### Conflict C6: opus-harness-autopsy.md:R5 (PromiseRegistry, reuse structure-promise) vs. opus-overbuild-critique.md:P8 + opus-overbuild-critique.md:R2 (move corpus extractors)
- **What Jobs 1–4 proposed**: Stand up a PromiseRegistry; reuse the `structure-promise` agent's prompt against generated chapter outlines.
- **What Job 5 pushed back with**: All five structure agents' prompts begin with "you read the chapter-by-chapter beat sequence of a *published* novel." Reusing them for in-progress outlines is a prompt rewrite, not a 1-line invocation. The autopsy's own R12 says audit-and-freeze structure agents; R5 contradicts R12.
- **Synthesis position**: Adopt Job 5. **Pick R12 over R5.** Move the corpus extractors to `src/agents/corpus-extractors/`. Defer any planner-shaped promise/payoff agent until B ships and a real scene-contract-shaped need surfaces.
- **Why**: The autopsy's R5 is internally inconsistent with R12. Job 5 named it; the synthesis resolves it. The simpler answer is to clean the namespace first (subtraction), then build a planner-shaped promise agent only if the post-B retrospective demonstrates a need.
- **Implication for backlog**: Item B6 is the corpus-extractor relocation (subtraction). No PromiseRegistry build in the backlog.

### Conflict C7: opus-semantic-judge-plan.md:R4 (remove cliché blocklist) + R7 (A/B Salvatore blocklist) vs. opus-overbuild-critique.md:P7
- **What Jobs 1–4 proposed**: Remove the cliché blocklist from `prose-writer-system.md`; replace with positive directive + deterministic post-lint. A/B Salvatore blocklist before any change.
- **What Job 5 pushed back with**: The 5-chapter sample shows zero electricity-as-tension violations and zero "let out a breath" instances. The blocklist is *not* being repeatedly violated. Re-running an A/B on a problem that's not a current symptom is using compute on the wrong question.
- **Synthesis position**: Adopt Job 5. **No backlog item for this.** Defer until a cliché violation actually fires on production prose.
- **Why**: Per `feedback_priming_suppression_ab` memory, removing the blocklist on the Salvatore route doubled fire rate (+10.5 pts worse). The conservative move on a non-symptom is to keep the blocklist and not spend the A/B budget. Job 4's R7 even says "do NOT auto-promote without an A/B" — the synthesis takes that further: don't even queue the A/B.
- **Implication for backlog**: Not in backlog.

### Conflict C8: Job 5 push-back P10 ("every recommendation adds; none subtracts") vs. cumulative direction of Jobs 1–4
- **What Jobs 1–4 proposed**: ~30 additive interventions across the four documents.
- **What Job 5 pushed back with**: The harness's repeated pattern is substrate-ahead-of-consumer. Adding 30 more without removing any of the 8 existing under-consumed surfaces drops the average load-bearing-ness. CLAUDE.md Strategic Constraints is a *list of retired things*; the four artifacts re-introduce things that resemble retired paths.
- **Synthesis position**: **Adopt P10 as a structural rule on the backlog.** At least 2 of the top 10 items must be subtractions; at least 1 must be evidence-gathering. Every additive item must specify what it does NOT replace (so we don't pretend an additive is a subtraction in disguise). Per Job 5's "removal pair" framing, every additive in the backlog should sit next to a frozen surface that prevents new sprawl on the same axis.
- **Why**: This is the single most important governance rule the synthesis applies. The autopsy alone has 12 recommendations; honoring all of them in parallel reproduces exactly the failure pattern Job 5 names.
- **Implication for backlog**: Items B6, B8, B10 are subtractions. Item B5 is evidence-gathering. Items B1, B7 are additive but each names a frozen surface alongside.

### Conflict C9: opus-method-pack-candidates.md:R10 (sequence PFA/CMF/RMT first) vs. opus-layer-bottleneck.md (defer all packs until post-B)
- **What Jobs 1–4 proposed**: First-wave method packs PFA + CMF + RMT, with EPI/HST second and LRP third (per genre flexibility constraint).
- **What Job 6 said**: All A-layer work is shadowed during the B lane. Method packs should not run as primary lanes during B because they create attribution confounds.
- **Synthesis position**: Adopt Job 6. The sequencing inside Job 3 is internally fine, but it's gated behind B. The synthesis position chooses **one** pack to validate after B and the oracle, not three.
- **Why**: Job 6's pre-mortem item #5 specifically names "concept under-specification masks the lever" as a B kill-condition. If method-pack work runs in parallel to B, you cannot tell whether the lift came from the pack or the contract. Single-lever discipline (CLAUDE.md) blocks parallel cohorts.
- **Implication for backlog**: Item B7 is "one pack, post-B, post-oracle." The pack choice is an open question (Section 6).

### Conflict C10: opus-craft-market-synthesis.md:R6 (midpoint mirror-moment validator) and R10 (stakes-collision check) vs. layer-bottleneck pre-mortem item #4 (per-beat checker scope mismatch)
- **What Jobs 1–4 proposed**: Add a `midpoint-mirror-moment-checker` and a `stakes-collision check` on climax chapter.
- **What Job 6 implicitly says (and Job 5 explicitly extends)**: New checkers introduced during the B lane create attribution confounds. The scene-call shape change may mean checker calls operate at the wrong scope; layering more checkers compounds this.
- **Synthesis position**: Adopt Job 6/5. **Defer both.** Re-evaluate after B ships and the oracle dataset (Item B4) demonstrates which dimensions are precision-≥0.85 at level-0.
- **Why**: Both checks are reasonable in isolation. They are not the bottleneck; they are layer-E enrichment. They do not run before B.
- **Implication for backlog**: Not in backlog.

### Conflict C11: opus-method-pack-candidates.md:R3 (deterministic noNewEntitiesPostSPP) vs. opus-overbuild-critique.md (no new diagnostics until consumer audit)
- **What Jobs 1–4 proposed**: A deterministic checker that diffs entities/world-facts across slots and flags any introduced after 75%. "Brooks's hardest deterministic rule."
- **What Job 5 implies**: This is one of the cheaper proposals (deterministic, no LLM cost) but still adds a runtime path before B clears.
- **Synthesis position**: Modified compromise. **Add the deterministic check as a planner-side validator only (warning-class), gated to only run after B ships.** It's deterministic so it doesn't add LLM cost or noise; the wait is purely about not introducing new validators while B is the active lane.
- **Why**: Deterministic ≠ free of attribution risk. But the rule is well-grounded in published craft references and runs at $0 LLM cost; it's the cheapest A-layer enrichment available. Sequenced after B as a low-risk addition.
- **Implication for backlog**: Item B9 — "deterministic no-new-entities-post-75% planner validator," post-B.

---

## Section 3 — The Ranked 10-Item Backlog

### Backlog Item B1: Strip ID metadata from the writer-rendered prompt
- **Layer optimized**: subtraction across L3 (writer context rendering)
- **Source artifacts**: opus-harness-autopsy.md:R7; opus-overbuild-critique.md:R1; opus-overbuild-critique.md:O15
- **Conflict resolution embedded**: C8 (subtract before add). This is the single cheapest, most reversible, most concretely-evidenced subtraction available — Job 5's open-question #5 explicitly says "if the user has time for one removal, start with O15."
- **Exact proposed change**: In `renderCharacterContextCapsules` (`src/agents/writer/character-context.ts:147–183`) and `renderBeatSpec` (`beat-context-render.ts:87`), suppress lines emitting `Chapter ID:`, `Beat ID:`, `Beat number:`, `POV character ID:`, `Active thread refs:`, `Active promise refs:`, `Active payoff refs:`, `Source obligations:`, `Active threads:`, `Active promises:`, `Active payoffs:`. Replace ID-shaped active-thread lines with one prose-shaped sentence per active thread ("Active reader expectations: Maret's hidden ability remains undiscovered"). Keep all IDs in trace artifacts/`summarizeCharacterContextCapsules` for telemetry.
- **Expected storytelling benefit**: Frees ~150–400 prompt tokens per writer call. Those tokens become available for the SCENE CONTRACT block in B3 without growing prompt size. No reader-visible delta on its own; this is the precondition for B3's prompt-budget headroom.
- **Downstream risks**: Byte-parity tests fail (expected). Trace consumers continue to receive IDs. Risk: writer subtly leans on IDs to disambiguate references — undetected because the autopsy didn't sample for it.
- **How to test it cheaply**: Byte-parity diff on rendered prompt; token-count delta on N=4 fixtures; 4-chapter A/B on word-ratio variance and semantic-review low-finding rate using `scripts/test-drafting-isolated.ts` with `--plan-from`. Cost <$0.50.
- **What data would prove value**: Token reduction ≥10%; no semantic-review low-finding regression (warning-class delta within ±10%); trace artifacts continue to carry full ID set verified via `summarizeCharacterContextCapsules` round-trip; no halluc-ungrounded retry-rate increase.
- **What should remain unchanged**: All slot-builder code; trace structures; orchestrator telemetry; functional-state-checker contracts; halluc-ungrounded contracts; `thread-character-context-v1` capsule mode rendering of *content*; `summarizeCharacterContextCapsules` output schema.
- **Sequencing dependency**: None. This runs first because it's reversible, unblocks B3's token budget, and is byte-parity bounded.
- **Kill condition**: Token reduction <5% (means the IDs weren't a real cost) OR semantic-review low-finding regression >15% (means something was load-bearing about the IDs). Either kills the change; revert.

---

### Backlog Item B2: Author the writer-undershoots fixture set + over-target companions
- **Layer optimized**: support / fixture engineering (precondition for B3)
- **Source artifacts**: opus-layer-bottleneck.md:R4; opus-layer-bottleneck.md pre-mortem item #7; lane-queue 2026-05-09 follow-up note
- **Conflict resolution embedded**: C1 (sequence the fixture *before* the contract A/B; Job 5's structural critique of Slice 2.5).
- **Exact proposed change**: Author 10 disposable fixture seeds intentionally shaped to produce baseline writer ratios <1.0 (undershoot target). Pre-resolve all named entities (officers, NPCs, locations, items) with proper names + voice + relationships in the seed character bibles so halluc-ungrounded plan-assist gates do not bail. Author 5 over-target companions (baseline ratio ≥1.5) for variance testing. Tag fixtures with `expectedBaselineRatio`, `seedComplexity`, `entityRichness`. Persist in `docs/fixtures/scene-first/writer-undershoots/`. 5 of 10 undershoot fixtures should be lifted from real production novel concepts that historically undershot.
- **Expected storytelling benefit**: Indirect — B3's evidence gate becomes runnable. The fixture set is the artifact that proves or disproves the contract-default-on hypothesis. Without it, B3 fails the same way Slice 2.5 did.
- **Downstream risks**: Fixture authoring is 4–6 hours of operator time. Risk: fixtures are not representative of real production seeds (mitigated: 5/10 sampled from real production novels). Risk: fixture-shaped fixture-shaped over-fitting (B3 ships, doesn't replicate on real seeds). Mitigated by including over-target companions to test variance both directions.
- **How to test it cheaply**: Run 1 chapter per fixture (no A/B) to verify baseline ratio matches the tag. Cost <$0.50.
- **What data would prove value**: ≥7 of 10 undershoot fixtures produce baseline ratio ≤1.0; ≥4 of 5 over-target fixtures produce ratio ≥1.5; no halluc-ungrounded plan-assist gate bails on any fixture's baseline arm.
- **What should remain unchanged**: Production planner, writer, checker, world-builder, character-agent prompts. Only adds disposable fixture artifacts under `docs/fixtures/`.
- **Sequencing dependency**: None — pure authoring task. Can run in parallel with B1.
- **Kill condition**: <5 of 10 undershoot fixtures hit ratio ≤1.0 after authoring + 1 calibration pass. Means the fantasy-healer over-target shape is the modal production behavior and the undershoot lever doesn't reliably exist; B3's hypothesis ("contract closes scenes that undershoot") becomes unfalsifiable on the cheap fixture path.

---

### Backlog Item B3: Render SCENE CONTRACT block by default with deterministic field-population fallback
- **Layer optimized**: B (scene-level planning + writing)
- **Source artifacts**: opus-harness-autopsy.md:R1; opus-layer-bottleneck.md:R1; corpus-recreation POC (2026-05-09); 2026-05-10 runtime evidence
- **Conflict resolution embedded**: C1 (the central B-lane intervention, sequenced after B2). C2 (uses J1/J2 as one-shot falsifiers). C8 (one carefully-chosen additive, freezes adjacent lanes).
- **Exact proposed change**: Remove `sceneCallWriterV1` flag gate from `renderSceneContract` invocation in `beat-context-render.ts`. Add `populateSceneContractFromMapperOutput()` step in planner-state-mapper that produces a partial `SceneContractBlock` from existing fields: `goal` from beat description's leading verb-noun, `valueIn`/`valueOut` from `valueShifted` + `lifeValueAxes`, `turningPoint` from beat description's final clause, `crisisChoice` from chapter `purpose` decision verb, `povPersonalStake` from POV character LTWN composite. Leave `opposition`, `outcome`, `consequence`, `choiceAlternatives` null when planner doesn't supply. Render the block *with whatever exists*; null fields print as `Goal: ?` lines (visible-but-honest, graceful degradation). Keep `causal-motivation-v3`-style upstream prompting available as a richer source when fixtures opt in. Do NOT add a new "follow the scene contract" instruction to the writer prompt (per Job 5 NB-8).
- **Expected storytelling benefit**: Word-ratio variance reduced ≥30%; `sceneDramaturgy` mean rises from ~2.0 to ≥2.5; `endpointLanding` mean rises from 2.17 to ≥2.5; halluc-ungrounded retry rate drops ≥30% (writer fills less structural under-specification with name-coining); per-beat motif-repetition (chapter-1 "Seventeen / Twenty-three" pattern) drops because scenes have distinct goal/turn content.
- **Downstream risks**: V4 Flash compliance ceiling on planner-side prompted contract emission (mitigated: deterministic fallback population doesn't depend on planner compliance — partial fill is the design). Writer over-mechanizes Goal/Conflict/Disaster (mitigated: render contract as guidance, keep beat description as primary creative brief). Per-beat checker scope mismatch under scene-call shape (mitigated: this slice does NOT change the writer call unit; scene-call promotion is a separate later lane). Promotion-on-no-regression confusion (mitigated: kill-condition below requires improvement on a primary signal, not just absence of regression).
- **How to test it cheaply**: Use B2's fixture set with `scripts/test-drafting-isolated.ts --plan-from` to hold plans constant. Two arms: A = no-contract-render (current default), B = contract-render-with-deterministic-fallback. N=10 chapters each, paired by fixture. Score with J1 (endpointLanding) and J2 (sceneDramaturgy) as one-shot falsifiers — these dimensions calibrated 100% exact in fixture. Cost <$1 (B3 itself) + <$0.50 (J1/J2 scoring) = <$1.50.
- **What data would prove value**: All five must hit for promotion. (1) Word-ratio variance reduction ≥30% on N=10. (2) `sceneDramaturgy` mean ≥2.5 (vs baseline ≤2.0). (3) `endpointLanding` mean ≥2.5 (vs baseline 2.17). (4) Halluc-ungrounded retry-rate reduction ≥30%. (5) No semantic-review low-finding regression; no checker-blocker class introduced.
- **What should remain unchanged**: `prose-writer-system.md`, `beat-writer-system.md`, all checker prompts, ApprovalPolicy, manual-review default, `thread-character-context-v1` capsule rendering (already L094-default), halluc-ungrounded prompt, functional-state-checker prompt, F-layer ID substrate, world-bible/character-profile schemas, lint surface, integrity loops. The writer call unit stays beat-shaped (scene-call writer promotion is deliberately deferred to a later lane).
- **Sequencing dependency**: B2 (fixtures must exist) and B1 (token budget headroom). Parallel-safe with B5 (data only) and B6 (file move only).
- **Kill condition**: Hit any one of: (a) <50% of scene contracts populated to ≥4 fields after deterministic fallback; (b) `sceneDramaturgy` regression ≥0.3 in treatment arm (writer over-mechanizes); (c) word-ratio variance reduction <20%; (d) any single checker's retry rate doubles vs baseline; (e) operator side-by-side preference <40% for treatment arm. Any one = no promotion; revert flag default and document failure mode.

---

### Backlog Item B4: Build the operator-labeled oracle dataset (50 chapters × 6 dimensions)
- **Layer optimized**: L6 (calibration substrate; gating dependency for any LLM-judge-as-runtime-blocker promotion)
- **Source artifacts**: opus-harness-autopsy.md:R11; opus-overbuild-critique.md open-question #4; opus-semantic-judge-plan.md:R9
- **Conflict resolution embedded**: C2 (R11 is the gating dependency for promoting J1–J7 from warning-class to runtime-blocker, and the over-build critique correctly names it as a *prerequisite header*, not a co-equal sibling). C8 (this is the only labor-intensive build, but it unblocks B7 and B8).
- **Exact proposed change**: Hand-label 50 generated harness chapters across the 6 most-load-bearing calibrated discernment dimensions (`sceneDramaturgy`, `endpointLanding`, `motivationSpecificity`, `characterMateriality`, `worldFactPressure`, `relationshipDelta`). Persist to `eval_briefs` / `eval_results`. Dual-label 10% (5 chapters) with a second labeler (Codex-rescue gpt-5.5 high-effort) to compute κ. Use this as the gold for promoting any LLM judge from warning-class to blocker-class. Codify the "infer-first then compare to declared" pattern (Job 4 R2) into `docs/evals/judge-design-principles.md` (Job 4 R8) as the labeling rubric.
- **Expected storytelling benefit**: Indirect — unlocks the rest of the prose-judge promotion path. Without an oracle, every LLM judge stays warning-class permanently and the autopsy's CL-3 pattern (findings flow up but don't gate prose) cannot break.
- **Downstream risks**: Operator time cost (estimate: 1.5 operator-days; not API cost). Risk: operator labels are themselves biased (mitigated: 10% dual-label with κ floor 0.6; abandon any dimension with κ<0.6).
- **How to test it cheaply**: This *is* the test. The deliverable is the labeled set; cost is operator time, not API cost. Marginal API cost: ≤$0.50 for re-running J1/J2/J3 against the labeled set to measure judge precision.
- **What data would prove value**: Inter-rater κ ≥0.6 on 5/6 dimensions; J1 + J2 precision ≥0.85 at level-0/level-1 boundary against operator labels on N=50. If precision <0.85, the judge stays warning-class indefinitely (per `feedback_dont_calibrate_noisy_llm_checkers`).
- **What should remain unchanged**: All current checkers; calibration fixture; eval infrastructure schema; existing planner-discernment dimensions.
- **Sequencing dependency**: B3 must complete first — the labeled set should be drawn from the post-B3 production distribution, not the pre-B3 distribution, otherwise we calibrate on prose that won't exist after B3 ships.
- **Kill condition**: After labeling 20 chapters, κ on any 3 dimensions <0.5. Means the dimensions don't have inter-rater stability and additional labeling is throwing money at noise. Stop and re-derive dimensions before continuing.

---

### Backlog Item B5: Score existing chapter-1 samples with J1 + J2 to decide hook-checker fate
- **Layer optimized**: evidence-gathering (gates the hook-checker decision)
- **Source artifacts**: opus-craft-market-synthesis.md:R2; opus-overbuild-critique.md:P9
- **Conflict resolution embedded**: C5 (gather evidence to decide between two plausible-looking interventions; do *one* thing first per Job 5).
- **Exact proposed change**: Run J1 (endpoint-landing, prose) and J2 (scene-dramaturgy, prose) on the existing `output/semantic-gate-baseline-*` chapter-1 prose samples (5 chapters: Maret, Maren×2, Sylvie, Noor) plus the 2026-05-10 fantasy-healer ch1+ch2. Manually rate operator preference "would I keep reading" Y/N on first 250 words for each. Compute three things: (a) what fraction of chapter-1s score ENDPOINT-0/1 vs ENDPOINT-2/3, (b) operator agreement with J1 verdict, (c) whether weather-report-style openings appear (the failure mode the hook checker would catch). Cost <$0.10.
- **Expected storytelling benefit**: Indirect — answers the "is the hook checker the right next chapter-1 intervention" question. If endpoint-landing dominates chapter-1 problems, the hook checker is wrong-target and the budget belongs in scene contracts. If openings *are* the dominant problem, the hook checker becomes Item B11 next cycle.
- **Downstream risks**: Operator-labeling-shaped subjectivity (acceptable — N=7 chapters is small enough for the operator to label personally).
- **How to test it cheaply**: This *is* the test. Single one-shot run.
- **What data would prove value**: Either result has decision value. If ≥60% of chapter-1s score ENDPOINT-0/1 → endpoint-landing is the dominant chapter-1 problem; ship B3, do not ship hook checker. If ≤30% score ENDPOINT-0/1 *and* operator finds 3+ weather-report-shape openings → hook checker becomes a real candidate for B11 in the next cycle.
- **What should remain unchanged**: Nothing — pure evidence-gathering, no code changes.
- **Sequencing dependency**: None. Can run in parallel with B1 and B2.
- **Kill condition**: J1 abstain-rate >40% on these chapters (means the dimension can't apply at chapter-1 prose granularity reliably; need granularity-stability re-check before relying on it). If kill, re-scope and re-attempt after B4.

---

### Backlog Item B6: Move corpus-extractor structure agents under `src/agents/corpus-extractors/`
- **Layer optimized**: subtraction across L0 / L1 (artifact ergonomics)
- **Source artifacts**: opus-harness-autopsy.md:R12; opus-overbuild-critique.md:R2; opus-overbuild-critique.md:O2
- **Conflict resolution embedded**: C6 (pick R12 over R5 — clean the namespace before any planner-shaped promise/payoff agent decision).
- **Exact proposed change**: Relocate `src/agents/structure-promise/`, `structure-mice/`, `structure-mckee-gap/`, `structure-character-arcs/`, `structure-value-charge/` into `src/agents/corpus-extractors/`. Update corpus pipeline imports. Drop `mice-system-v2-draft.md` and `value-charge-system-v2-draft.md` (draft-state artifacts; re-introduce when a corpus-pipeline change requires them). After move, audit `llm_calls` table: if any non-corpus novel has invoked any of these agents, that's a bug to fix.
- **Expected storytelling benefit**: Indirect — clarifies runtime agent inventory. Removes the "we have a promise agent available" temptation that makes autopsy R5 / craft-market R4 / method-pack R3-R4 sound cheaper than they are. Each future "live planner promise/mice agent" proposal must explicitly justify writing a new agent rather than reusing a corpus extractor whose prompt opens with "you read a *published* novel."
- **Downstream risks**: Corpus pipeline imports break unless updated (mitigated: simple grep+rename PR with `bun run corpus:extract:smoke` validation).
- **How to test it cheaply**: Post-move, run corpus pipeline against Crystal Shard end-to-end (existing fixture). Confirm byte-identical output. Cost: free (deterministic + corpus extraction reuses cache).
- **What data would prove value**: Corpus pipeline produces byte-identical output post-move; `llm_calls` for `structure-promise`/`structure-mice`/`structure-mckee-gap`/`structure-value-charge`/`structure-character-arcs` against any non-corpus novel = 0.
- **What should remain unchanged**: Agent prompts; agent schemas; corpus pipeline contract.
- **Sequencing dependency**: None. Parallel-safe with everything (file-move only).
- **Kill condition**: Corpus pipeline output diverges post-move (means there's a hidden runtime dependency the audit missed). Revert.

---

### Backlog Item B7: One method-pack framework-to-prose POC (post-B3, post-B4)
- **Layer optimized**: A (one carefully-chosen pack tested at the framework-to-prose boundary)
- **Source artifacts**: opus-method-pack-candidates.md:R6; opus-method-pack-candidates.md:R10; opus-craft-market-synthesis.md:R3 (or R7); opus-layer-bottleneck.md (sequence)
- **Conflict resolution embedded**: C3 (one pack, not seven). C9 (post-B-lane closure, not parallel). The pack choice itself is left as Section 6 Q4.
- **Exact proposed change**: After B3 ships and B4 produces the oracle dataset, pick *one* method pack (CMF v0 / RMT v0 / PFA v0 — Section 6 Q4) and run a single framework-to-prose POC: planner emits with the pack's slot template, writer drafts chapters 1–3 with B3's scene contract default-on, control arm uses CFA v1 baseline. Compare on the 6 oracle dimensions plus operator side-by-side review on N=3 chapters per arm. The pack itself is *not* promoted to a default planner template; it is tested as a feeder of richer contract fields to the now-default scene contract.
- **Expected storytelling benefit**: Tests whether stronger A-layer feeders compound with B3's contract rendering. If yes, this becomes the proof-of-concept for the *next* lane (one more pack at a time). If no, method packs are confirmed as the wrong abstraction and Job 3's entire artifact stays in `parking-lot/`.
- **Downstream risks**: Cost ≥$2/run (per CLAUDE.md autonomy threshold, requires check-in). Risk: pack-shape over-fits to fixture concept (mitigated: use 2 distinct concepts within the pack family). Risk: if the chosen pack regresses, treats as evidence about the pack, not the method-pack approach overall.
- **How to test it cheaply**: ~$1.50/chapter × 3 chapters × 2 arms × 2 concepts = ~$18. **Pre-authorization required** per CLAUDE.md cost-threshold rule.
- **What data would prove value**: J1/J2 mean improvement ≥0.3 in pack arm vs CFA v1 baseline arm on the same B3-default-on substrate; operator side-by-side preference ≥2:1 on chapter-by-chapter review; checker-blocker rate not worse on pack arm; oracle-dimension means improve on at least 3 of 6 dimensions.
- **What should remain unchanged**: Writer model, checker thresholds, model policy, B3 scene-contract behavior. Only adds opt-in pack metadata in the seed strategy packet.
- **Sequencing dependency**: B3 (scene contract must be default-on first), B4 (oracle must exist for J1/J2 promotion), and pack choice resolution from Section 6 Q4.
- **Kill condition**: Pack arm regresses on ≥3 of 6 oracle dimensions OR operator side-by-side preference <40%. Means the pack approach is wrong-direction; defer additional packs indefinitely. Document and update `docs/decisions.md`.

---

### Backlog Item B8: Freeze Phase 7 ApprovalPolicy expansion lane
- **Layer optimized**: subtraction across process / O1 in Job 5 audit
- **Source artifacts**: opus-overbuild-critique.md:R7; opus-overbuild-critique.md:O1
- **Conflict resolution embedded**: C8 (subtract substrate-without-consumer; this is the largest single review-attention budget item in the repo).
- **Exact proposed change**: Status-flag L074, L075, L076, L077, L078 as "stable; no expansion lane" in `docs/decisions.md`. Refuse new proposal `kind`s, new replay sources, new policy tiers, and external-CI promotion guard until a non-fixture novel exhibits a proposal flow end-to-end (produced by a runtime checker, reviewed by an operator, applied via the approval-policy engine, with the outcome routed through `proposal_resolution_outcomes`). Existing Phase 7 code, tests, and local promotion-guard tier all stay.
- **Expected storytelling benefit**: Indirect — frees the largest single review-attention budget item in the repo. Concrete: 30 days post-freeze, count Phase 7 commits/discussion-volume to confirm attention has shifted to scene-contract / oracle / pack lanes.
- **Downstream risks**: A future autonomy lane has to thaw the freeze (acceptable — the freeze is a status flag, not a deletion).
- **How to test it cheaply**: Doc edit + lane-queue revision. Cost: free.
- **What data would prove value**: 30 days post-freeze, Phase 7 commit count <10% of overall commit count (vs current ~40% of recent decision velocity per L074–L098 burst). Stop signal: a real operator-driven proposal flow that cannot be supported by the frozen substrate (would un-freeze).
- **What should remain unchanged**: All Phase 7 code; local promotion-guard tier; existing tests; existing approval-policy semantics.
- **Sequencing dependency**: None. Process commitment only — can run in parallel with everything.
- **Kill condition**: A real non-fixture proposal flow surfaces and cannot be supported by the frozen substrate within 30 days (means the substrate was load-bearing and the freeze was wrong). Document and re-open.

---

### Backlog Item B9: Add deterministic `noNewEntitiesPostSPP` planner-side validator (warning-class, post-B3)
- **Layer optimized**: A / L1 (deterministic structural gate)
- **Source artifacts**: opus-method-pack-candidates.md:R3; opus-craft-market-synthesis.md:R5 (mechanical-genre-compliance flag)
- **Conflict resolution embedded**: C11 (deterministic, $0 LLM cost, but sequenced after B3 to preserve attribution).
- **Exact proposed change**: Deterministic planner-output validator that diffs `establishedFacts`, `charactersPresent`, and `worldFactId` references across chapter slots and flags any introduced after the slot mapped to ~75% of the spine. Brooks's deterministic rule. Warning-class only; routes to `editorial_flag` envelope. Allow planner-declared `late_introduced_with_hint_ref: <hint_ref_id>` to suppress the flag (planner must justify late introduction by pointing to an earlier hint).
- **Expected storytelling benefit**: Catches the "late-introduced helper / late-introduced rule" failure mode at planner output, before drafting consumes the malformed plan. Reader-visible: at scale, fewer chapters with deus-ex-machina helpers.
- **Downstream risks**: False positives on legitimate red-herring reveals (where a character hinted earlier becomes named late) — mitigated by the `late_introduced_with_hint_ref` escape hatch. False positives on serial open arcs / multi-book series — mitigated by `series_carrying: true` flag respect.
- **How to test it cheaply**: Run on existing planner outputs (5 disposable novels); compare flagged plans against operator review. Cost <$0.25 (deterministic; no LLM).
- **What data would prove value**: ≥70% of operator-flagged "late-introduced" plans caught; ≤10% false-positive rate against operator-approved plans; deterministic check completes in <100ms per chapter.
- **What should remain unchanged**: Planner prompts; the check fires post-plan as a warning-class diagnostic; existing chapter-plan-checker; halluc-ungrounded; continuity; functional-state-checker.
- **Sequencing dependency**: B3 must ship first (per single-lever discipline; do not add validator while B is the active lane).
- **Kill condition**: False-positive rate >25% on N=5 disposable novels. Means the rule is too rigid for the harness's plan distribution; defer or re-scope.

---

### Backlog Item B10: Skip continuity checker on chapters 1–2 + drop functional-state checker from runtime bundle
- **Layer optimized**: subtraction across L5 (checker bundle)
- **Source artifacts**: opus-overbuild-critique.md:R5; opus-overbuild-critique.md:R6; opus-overbuild-critique.md:O12; opus-overbuild-critique.md:O13
- **Conflict resolution embedded**: C8 (the second concrete subtraction; honors `feedback_dont_calibrate_noisy_llm_checkers` by removing a checker the user has already named as wrong-direction).
- **Exact proposed change**: Two coupled changes shipped together. (a) In chapter-validation pass, skip continuity LLM call when `chapterNumber <= 2 || establishedFacts.length < 5` — continuity errors are by definition cross-chapter; firing on chapter 1 has 0% TP per L83. (b) Remove `functional-state-checker` from default checker call sequence in `src/phases/functional-checks.ts`. Replace with a deterministic substring-presence check on `establishedFacts[*].fact` against chapter prose. Keep agent code in repo (no deletion).
- **Expected storytelling benefit**: Indirect — saves ~2 LLM calls per chapter on warning-class checkers whose findings are not promoted to blockers and whose oracle calibration is not coming. Reduces operator-review-queue noise. Frees budget envelope for B3, B4, B7.
- **Downstream risks**: A chapter-1 fact contradicted within chapter 1 goes undetected (mitigated: deterministic fact-string-presence check catches gross cases). A planned-state item addressed obliquely (paraphrased) is missed by deterministic substring match (acceptable; the LLM checker's "mention satisfies" semantics already reward paraphrase loosely).
- **How to test it cheaply**: Two parallel arms on 6-chapter shadow run: full bundle vs reduced bundle. Compare planned-state miss rate and continuity miss rate against operator review. Cost <$0.30.
- **What data would prove value**: Deterministic substring check catches ≥80% of cases the functional-state LLM checker caught; zero new chapter-1 continuity blockers in the last 90 days of `pipeline_events` (predict: query result is near zero, confirming the skip is safe).
- **What should remain unchanged**: chapter-plan-checker; halluc-ungrounded; deterministic validation; downstream rewrite routing; chapter ≥3 continuity behavior; the functional-state-checker prompt and schema (kept in repo).
- **Sequencing dependency**: B3 must ship first (single-lever discipline; do not change checker bundle while B is the active lane). Can run in parallel with B7/B8/B9 once B3 closes.
- **Kill condition**: Deterministic substring check catches <60% of LLM-functional-state findings on the 6-chapter shadow run, OR a chapter-1 within-chapter contradiction surfaces in the next 30 days that the deterministic check misses but continuity would have caught. Either kills the change; restore the checker bundle.

---

## Section 4 — What the Backlog Deliberately Does NOT Include

Salient ideas from Jobs 1–4 that did not make the top 10, with why:

1. **Recommended 7 method-pack charters (PFA / EPI / THF / CMF / LRP / RMT / HST) but didn't include because** CFA v1 itself is `HOLD` after the 2026-05-08 cohort showed mean delta +0.2 with endpoint regression. Adding 7 packs each with its own evidence gate violates single-lever discipline. B7 picks *one* pack, post-B3, post-B4. Job 3's artifact archived as `parking-lot/`.

2. **Recommended `seed.market` knob (6 markets × chapter-length × hook-strictness × obligatory-scene checklists) but didn't include because** the harness's commercial focus is fantasy + gamelit per `project_fantasy_genre_focus` memory. Parameterizing across 6 markets before any single market profile has demonstrated runtime impact violates `project_genre_flexibility` (L1 stays genre-neutral). Defer until at least one market profile wins a head-to-head.

3. **Recommended paired STC + Story Grid genre directive (10×12 = 120 combinations) but didn't include because** the same memory constraint applies and the cross-pack diagnostic that supposedly motivates it is itself diagnostic-only with no promotion path. The combinatorial overhead is not justified by current evidence.

4. **Recommended chapter-1 hook checker but didn't include in top 10 because** the failure mode it catches is not currently a documented harness symptom (5 sampled chapter-1s show interiority openings, not weather-report). Item B5 gathers the evidence cheaply; if endpoint-landing turns out *not* to be the dominant chapter-1 problem, the hook checker is the next-cycle B11.

5. **Recommended midpoint mirror-moment validator and stakes-collision check but didn't include because** new checkers introduced during the B lane create attribution confounds. Both are reasonable in isolation; both gate on B4 (oracle dataset) before runtime promotion. Re-evaluate after B7 closes.

6. **Recommended PromiseRegistry from reusing structure-promise corpus extractor but didn't include because** the structure-promise prompt opens with "you read a *published* novel" — reuse is a prompt rewrite, not a 1-line invocation. B6 cleans the namespace; any planner-shaped promise agent must be written fresh and only after a real scene-contract-shaped need surfaces post-B3.

7. **Recommended A/B Salvatore writer-prompt blocklist but didn't include because** zero electricity-as-tension violations across 5 sampled chapters means the blocklist is not a current symptom. Per `feedback_priming_suppression_ab`, removing the blocklist on the Salvatore route doubled fire rate. Defer until a violation actually fires.

8. **Recommended MICE thread-typed chapter purposes (Job 4 R5) and balanced-parens validator (Job 2 R4) but didn't include because** they require the planner to commit to MICE structure that does not currently appear in production seeds (`threadId=0`, `promiseId=0`, `payoffId=0` on 2026-05-10). The substrate is empty; building validators for it is wrong-order. After B3 ships and concept-level threading shows up in real fixtures, re-evaluate.

9. **Recommended decoupling beat-description length from "writer creative latitude" framing (Job 4 R3) and removing cliché blocklist (Job 4 R4) but didn't include because** these are writer-prompt edits during the B lane. Job 6 explicitly freezes D (writer prose) during B; introducing prompt edits creates confound. Re-evaluate post-B3.

10. **Recommended magicCostLedger shared L2 diagnostic but didn't include because** the schema field and packs it lifts from don't exist. Recommendation-on-recommendation; dropped fully per Conflict C4.

---

## Section 5 — Sequencing and Capacity

### Serial timeline

If the user runs all 10 items strictly serial: ~6–9 weeks. Driver: B4 (oracle dataset) is the labor-intensive item (~1.5 operator-days plus dual-labeling pass), and B3 needs 2–3 days of run-and-iterate to clear the kill conditions.

| Item | Estimated effort | Estimated duration |
|------|------------------|--------------------|
| B1 | 1 day | <1 day (byte-parity bounded) |
| B2 | 4–6h authoring + 0.5d calibration | 2 days |
| B3 | 2–3 days run + iterate | 1 week |
| B4 | 1.5 operator-days + dual-label | 2 weeks (counting operator availability) |
| B5 | <1 day | <1 day |
| B6 | <1 day (file move + smoke test) | <1 day |
| B7 | 2–3 days planner + drafting + review | 1 week |
| B8 | <1 day (doc-only) | <1 day |
| B9 | 1–2 days | 2 days |
| B10 | 1 day code + 6-chapter shadow | 3 days |

### Parallelization-safe pairs

- **B1 + B2 + B5 + B6 + B8** can all run in parallel — different surfaces, no shared layer of intervention. B1 is writer-rendering. B2 is fixture authoring. B5 is data-only scoring. B6 is a file move. B8 is a doc edit. None of these confound each other.
- **B3 must run alone** as the single primary lane until its evidence gate clears. This is the most important sequencing rule. Per single-lever discipline, no other runtime-behavior change runs concurrently with B3.
- **B4 can start once B3 ships** (oracle should be drawn from post-B3 prose distribution, not pre-B3).
- **B7, B9, B10 can run in parallel after B3 + B4 close.** B7 is method-pack feeder testing; B9 is deterministic planner validator; B10 is checker bundle subtraction. Different layers, no shared intervention.

### Confound risks

- **B3 + B7 concurrent = confound.** Cannot tell if a quality lift came from the scene contract or the method pack. **Sequence: B3 → close → B7.**
- **B3 + B10 concurrent = confound.** Cannot tell if reduced LLM-call budget broke quality or if scene contracts compensated. **Sequence: B3 → close → B10.**
- **B3 + B9 concurrent = confound.** Cannot tell if reduced late-entity issues came from B3 (writer better-resourced) or B9 (planner gated). **Sequence: B3 → close → B9.**
- **B4 + B7 concurrent = mild confound.** B7 wants to use J1/J2 against operator labels; if labels aren't yet at κ≥0.6, B7's evidence is weaker. **Sequence: B4 reaches 30 chapters labeled → start B7 in parallel.**
- **B5 + B3 concurrent = safe.** B5 is read-only on existing prose; B3 is a write-path change. No shared state.

### Budget envelope

| Item | API cost | Operator time |
|------|---------:|---------------|
| B1 | <$0.50 | 0.5 day |
| B2 | <$0.50 (calibration) | 0.5–1 day authoring |
| B3 | <$1.50 (incl. J1/J2 scoring) | 2–3 days |
| B4 | <$0.50 (judge re-runs) | 1.5 operator-days |
| B5 | <$0.10 | 0.5 day |
| B6 | $0 | <0.5 day |
| B7 | ~$18 (REQUIRES PRE-AUTHORIZATION per CLAUDE.md ≥$2/run) | 2–3 days |
| B8 | $0 | <0.5 day |
| B9 | <$0.25 | 1–2 days |
| B10 | <$0.30 | 1 day |
| **Total** | **~$22** | **~12 operator-days** |

The $18 line item (B7) is the only one above the $2 autonomy threshold. Items B1–B6 + B8–B10 sum to ~$4 — well within autonomous run authorization.

### First kill-gate

**B3's evidence gate.** If B3 fails any of its 5 kill conditions (especially a/b — V4 Flash compliance ceiling re-triggers with <50% field population; or writer over-mechanizes with `sceneDramaturgy` regression ≥0.3), the entire backlog needs re-planning. The autopsy's central thesis (B is the bottleneck), Job 6's pick (B as the priority lane), and the corpus-recreation POC's predictions (0.70→0.94 word-ratio lift) all converge on B3. If B3 fails, the synthesis position itself is wrong and items B4 through B10 should be reconsidered before execution. The over-build critique's instead-position becomes the fallback: "build the writer-undershoots fixture first" succeeded, so the failure isn't fixture-shape; it's substrate-shape, which means C (character/world bibles, NPC roster) becomes the next bottleneck candidate.

---

## Section 6 — Open Questions for the User

1. **B3 promotion gate sensitivity.** The kill conditions require ALL FIVE signals to hit (variance reduction ≥30%, sceneDramaturgy ≥2.5, endpointLanding ≥2.5, halluc retry ≥30% reduction, no semantic regression). Are you willing to ship a default-on scene contract on, say, 4-of-5 with a documented partial-promotion, or do you require 5-of-5 strict before flipping the default? The over-build critique would say strict; the corpus POC results suggest 4-of-5 is achievable with one borderline.

2. **B4 oracle-dataset model.** Will you personally label the 50 chapters across 6 dimensions over 1.5 operator-days, or do you want this delegated to a Sonnet/Codex subagent panel with you adjudicating disagreements? `feedback_sonnet_subagents` says all Sonnet teacher labeling uses Claude Code subagents; that pattern fits here. But the user-as-primary-labeler with a Codex dual-label adversary may give higher-trust labels at lower elapsed time. Pick one.

3. **B7 budget authorization.** B7's $18 estimate exceeds CLAUDE.md's $2-per-run autonomy threshold. Do you want to pre-authorize the full $18 contingent on B3 + B4 closing, or do you want a check-in at B7 kick-off with the actual N=3-chapter cost recomputed? My recommendation: pre-authorize contingent on the gate.

4. **B7 method-pack choice.** CMF (cozy mystery fantasy — most distinctive failure modes, least overlap with CFA, but commercial-fit risk for harness's fantasy/gamelit focus), RMT (romantasy — largest current KU market segment, but adds the romance arc complexity), or PFA (portal fantasy — closest structural fit to the existing fantasy-healer seed shape)? Job 3's R10 sequencing puts PFA + CMF + RMT first-wave; Job 6 says one at a time. Pick one.

5. **B8 scope.** Freezing Phase 7 is a process commitment, not a code change. Are you willing to take this on as a documented stance and defend it against future "but this autonomy lane needs a new proposal kind" requests, or would you rather keep Phase 7 nominally-active and depend on the lane-queue prioritization to keep it stale? My recommendation: explicit freeze, because nominally-active substrate keeps drawing review attention regardless of priority.

6. **Hook-checker fate after B5.** If B5's data shows endpoint-landing dominates chapter-1 problems (the predicted result), do you want the hook-checker permanently parked, or held for a future cycle if reader-retention data ever shows a chapter-1 problem the harness isn't currently catching? The synthesis defaults to permanently parked unless evidence revives it.

7. **What constitutes "B3 closure" before B7/B9/B10 unlock?** The 4-fixture A/B is N=10 chapters. Do you want a follow-up live N≥20 panel before declaring closure (would add ~3 days and ~$2 to B3), or do you accept N=10-fixture as sufficient if all 5 kill conditions clear cleanly? My recommendation: N=10 is sufficient for closure if all 5 hit; require N≥20 only if any signal is borderline (e.g., variance reduction lands at 25–30%).
