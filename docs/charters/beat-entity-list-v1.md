---
status: shipped
kind: experiment-charter
name: beat-entity-list-v1
owner: andre
date: 2026-04-20
revision: 6 (post-Codex-YELLOW round 5 — 2026-04-20)
shipped: 2026-04-20 (exp #254 — V1 cleared all 5 gates; V2/V3/V4 skipped per §7)
---

**Outcome (2026-04-20):** V1 SHIPPED. Fire rate 44.9% (V0) → 28.9% (V1),
Δ=−16.0 pts (ch2+3 clean: −22.8 pts). Precision 87.5% (14 TP / 2 FP
via 10-fire Sonnet adjudication). Adherence 0% both variants. Class-B
17% (below 50% kill). Degenerate 0%. `BEAT_ENTITY_LIST_VARIANT=v1` is
now the default in `src/agents/halluc-ungrounded/index.ts`. V2/V3/V4 not
run per §7 skip rules. See `docs/decisions.md` "beat-entity-list V1
shipped (2026-04-20)".


# Experiment Charter — `beat-entity-list-v1`

Revision 2 addresses Codex RED verdict on revision 1 (session `a9f8d084fbcb105d2`): charter now runs a fixed-seed ablation ladder, separates cheaper variants from the expensive planner-schema change, and adds a mechanism-level falsifier.

## 1. Question

Does closing the context-surface mismatch between writer and halluc-ungrounded checker — via any of three increasingly-expensive interventions — reduce the ungrounded fire rate without regressing adherence or checker precision? At which intervention level does the mechanism actually fire?

## 2. Hypothesis

**Mechanism:** The checker's `beat.description` + world-bible-names grounded surface is narrower than the writer's (writer sees the full chapter outline object + previous-beat description as transition continuity + established facts). When the writer's prose legitimately continues a thread from those wider sources, the checker correctly flags entities it's never been shown.

**If** we align the two surfaces by projecting a single `mentionedEntities` list into both the writer's prompt (`ALLOWED ENTITIES:` block) and the checker's prompt (new sub-line inside `WORLD BIBLE (names only)`), **then** ungrounded fire rate drops from the post-2026-04-20-fix baseline on the same seed, **because** entities the writer legitimately references from wider context become grounded from the checker's view.

**Graduated variants (each tests the mechanism from a cheaper angle):**

| Variant | Source of the list | Planner-schema change? | Writer change? | Checker change? |
|---------|--------------------|------------------------|----------------|-----------------|
| V0 baseline | — | — | — | — |
| V1 (checker-only, derived) | Extracted at check-time from `outline.establishedFacts.fact` text + prior beat's `description` via the existing `extractProperNouns` helper. | no | no | yes |
| V2 (writer-only, derived) | Same source, extracted at writer-context assembly time. | no | yes | no |
| V3 (full stack, derived) | Same source, extracted once in a shared helper consumed by both. | no | yes | yes |
| V4 (full stack, planner-emitted) | Planner outputs `sceneBeat.mentionedEntities: string[]` explicitly. | **yes** (schema + prompt) | yes | yes |

V1 and V2 are new — promoted from Codex's "cheaper counterfactuals you missed." V4 is the original revision-1 target. The ladder tests whether V1/V2/V3 hit the target before committing to V4's schema change.

**Primary metric prediction:** V3 cuts fire rate ≥15 pts vs V0 on the same seed. If yes, V4 is unnecessary and is not run.

## 3. Falsification threshold

Stated before results.

**Mechanism falsifier — the central test (with source-level provenance):**

For every halluc-ungrounded fire across all variants, record which *specific source* contributed each entity to the grounded surface, not just whether it was in the union. Per-entity provenance tags: `bible`, `from_brief`, `derived_outline_fact`, `derived_prior_beat`, `planner_emitted`. The fired entity is checked against each tag independently.

Instrumentation: written into `llm_calls.request_json` (JSONB, sql/018 migration — already queryable) as `{..., groundedSources: {bible: [...], from_brief: [...], derived: [...], planner: [...]}}`. Mechanism script joins `llm_calls` (parsed response `issues[].entity`) against `request_json -> groundedSources` and reports per-source attribution.

**Per-fire classification (preserved at decision level — no collapse to aggregate).** For each fire, compute independently:

- `in_writer_ctx`: entity appears in ANY context surface fed to beat-writer — `beat.description`, `beat.characters`, `outline.setting`, `outline.establishedFacts[*].fact`, `outline.povCharacter`, writer's transition bridge text, writer's `ALLOWED ENTITIES:` block if variant provides it, character profiles, resolved references.
- `in_checker_ctx`: entity appears in ANY context surface fed to halluc-ungrounded — BEAT BRIEF Summary + Setting, `WORLD BIBLE (names only)` sub-lines (Locations/Cultures/Systems/From-brief/Beat-entities for the variant), SPEAKERS.
- `source_tags`: any non-empty subset of `{bible, from_brief, derived_outline_fact, derived_prior_beat, planner_emitted}` for the fired entity in the CHECKER's context. Empty tags set + `in_checker_ctx=false` means the checker never saw it.

Three mutually-exclusive failure classes (V3 vs V0 on same frozen plan):

| Class | Condition | Interpretation | Action |
|---|---|---|---|
| A. Checker-surface failure | `in_writer_ctx=true`, `in_checker_ctx=false` | The writer legitimately sourced the entity; the checker's expanded surface failed to cover it. Extraction pool too narrow. | Class-A fraction on V3 ≥30% → V4 (planner-emitted) is the next lever; derivation alone insufficient. |
| B. Adapter-attention failure | `in_writer_ctx=true`, `in_checker_ctx=true` | Both sides see it; adapter still fires. Surface expansion isn't attended to. | Class-B fraction on V3 ≥50% → KILL the derived-source lever family. Next charter retrains adapter with widened-surface training data. Do NOT run V4. |
| C. Writer-invention | `in_writer_ctx=false` | Writer produced an entity absent from every context surface it saw. True hallucination; checker correctly fires regardless of surface. | Class-C fires count against the writer's capacity, not the surface expansion. Orthogonal signal. No action on this lever. |

Mechanism is falsified when Class B dominates Class A on V3 AND overall fire rate hasn't dropped ≥5 pts vs V0 — the expansion doesn't matter to the adapter. Mechanism is confirmed-but-incomplete when Class A dominates AND fire rate drops but misses the 15-pt gate — extraction coverage is the issue, V4 is on-ramp.

**Magnitude gates:**

- V3 fire rate drops <5 pts vs V0 → mechanism broken (surface expansion doesn't matter at all). KILL entire lever family.
- V3 adherence fire rate rises ≥3 pts → over-correcting, writer is refusing to name entities it should. KILL.
- V3 precision drops below 80% (measured by solo-ungrounded sampling vs adjudication) → checker is now trusting the surface too eagerly and missing real ungrounded fires. KILL.
- Degenerate extraction (V1/V2/V3 produces empty list on ≥15% of beats where V0 fires ≥1 entity) → extraction pool is too narrow to cover writer behavior. Budget **exactly one** widening iteration (add one additional source to the extractor — e.g., `beat.transitionBridge` text if surfaced by planner, or chapter `purpose` field). If the second pass still trips the 15% degenerate floor, escalate to V4 (planner-emitted) or KILL the lever family. No third iteration.

## 4. Baseline ladder

Real ladder on the same seed; all cells measured on identical inputs.

| Slot | Config | On-seed fire rate prior | Purpose |
|------|--------|--------------------------|---------|
| Floor | halluc-ungrounded wired off (pre-2026-04-18) | N/A (no gate) | Rules out "gate just burns retries" — V0 should be ≥ floor on completion rate |
| V0 (current prod) | Shipped 2026-04-20 commits `1bdc422` + `4471cac`: From-brief extraction + retry-wording fix | Measured live on seed during this run (plus existing 7-novel production panel for external context: 46.7% fire rate, 9% retry clearance) | The real baseline |
| V1 (checker-derived) | Extract `outline.establishedFacts.fact` proper nouns + prior beat description proper nouns into halluc-ungrounded grounded surface | — | Tests mechanism cheaply |
| V2 (writer-derived) | Same extraction, surfaced to writer as `ALLOWED ENTITIES:` | — | Tests if aligning writer-side alone suffices |
| V3 (both-derived) | V1 + V2 | — | Tests full surface alignment without schema change |
| V4 (planner-emitted) | Schema: `sceneBeat.mentionedEntities`; planner prompt asks for the list | — | Only run if V3 plateaus short of the magnitude gate |
| Ceiling | GPT-OSS-4.5 writer + Opus adherence oracle | N/A | Calibration only |

**Frozen-plan discipline (required).** All cells run on the SAME fantasy seed (`fantasy-debt`), 3 chapters. The planner is invoked **exactly once**; its output (concept + chapter_outlines + all derived state) is frozen to a dedicated source novel_id. V1–V4 run from CLONES of that source novel: drafting reads all inputs from the cloned rows only.

**Tables that must be deep-copied by `scripts/variant/clone-for-variant.ts`** (per `src/planned-state.ts` + drafting-phase reads + retrieval layer):

- `novels` — seed_json, phase reset to "drafting"
- `characters` — character profiles
- `world_bibles` — world-bible JSON
- `chapter_outlines` — frozen plans (row per chapter)
- `facts` — materialized establishedFacts (written by `savePlannedState()`)
- `character_states` — materialized characterStateChanges
- `character_knowledge` — materialized knowledgeChanges
- `relationship_states` — **defensive** (no current write-site in `savePlannedState()` per round-4 audit, but copy to guard against a future helper being added without updating this charter)
- `timeline_events` — **defensive** (same rationale — no current write-site)
- Any additional `save*` helper added to `savePlannedState()` going forward — clone script references the authoritative write-sites (`src/db/facts.ts:4-7` for `facts`, `src/db/character-states.ts:4-7` for `character_states`, `src/db/knowledge.ts:27-31` for `character_knowledge`, invoked from `src/planned-state.ts:26-67`). The commit landing `clone-for-variant.ts` must enumerate each `save*` helper it mirrors with exact file:line citations so future write-sites force a clone-script audit.

Eliminates within-seed planner stochasticity entirely. The only variable across V1–V4 is context-assembly + schema at drafting time.

Script must be committed AND the "tables to copy" list must be verified by grepping `src/planned-state.ts` during the clone-script commit. Charter gate: the commit landing `clone-for-variant.ts` must include a comment enumerating every write-site in `savePlannedState()` that it mirrors.

Per-beat checker decisions per variant: ~80–100 (3 chapters × 25–35 beats). With 4 variants × ~90 decisions = 360 decisions ground-truthed against the same plan — sufficient N for fire-rate deltas at the 15-pt magnitude gate even assuming 5-pt per-variant noise.

## 5. Cheapest counterfactuals considered

| Lever | Estimated cost | Rejected / promoted |
|-------|----------------|---------------------|
| Harder retry-wording alone | $0 | Rejected — already shipped 2026-04-20; retry clearance 9% shows wording alone can't close the surface gap. |
| Regex strip ungrounded entities | $0 | Rejected — breaks referential chains in downstream beats. |
| Widen checker context at inference via transition bridge (no training) | $0 | **Promoted to V1** (was Codex's missing counterfactual #6). If V1 hits target, no further work needed. |
| Writer-only allowlist derived from existing beat context | $0 | **Promoted to V2** (was Codex's missing counterfactual #7). |
| Retrain halluc-ungrounded with widened surface | ~$10–15 + labeling | Rejected for this charter — gated on V1/V2/V3 plateauing. |
| Constrain writer to beat-brief-only entities via prompt | $0 | Rejected — fights writer's continuity goal. |

V1/V2/V3 now form the experiment. V4 is contingent on V3 underperforming.

## 6. Distribution match + attribution control

- **Training set stratification:** N/A — no training. Schema/prompt/context changes only.
- **Eval set stratification:** 1 fixed fantasy seed (`fantasy-debt`), 3 chapters, run once per variant. Non-fantasy is explicitly out of scope (Salvatore voice-LoRA route is the measured surface; leak adapter gates on `writerPack.label === "salvatore-fantasy"`). Global schema/context code changes affect non-fantasy only if that route later activates the halluc-ungrounded gate, which it already does — so the V1–V3 context changes apply cleanly to any fantasy writer path.
- **Production distribution reference:** 7-novel production panel from `docs/halluc-v3-production-report-2026-04-20.md` provides external context (46.7% fire rate, 9% retry clearance), but within-seed comparison on `fantasy-debt` is the load-bearing attribution signal, not the 7-novel panel.
- **Attribution isolation:** each variant is a single-flag code toggle (env var `BEAT_ENTITY_LIST_VARIANT=v0|v1|v2|v3|v4`). Other code paths and adapter versions held constant. Planner stochasticity between variant runs is the main confound — mitigated by comparing per-beat-attempt decisions (N ~80–100 per variant) rather than aggregate-novel stats alone, and by recording the plan SHA per run so any planner-output divergence across variants is visible in the report.
- **Adapter-side off-distribution risk:** the halluc-ungrounded v2 adapter was trained on a specific grounded-surface shape (`WORLD BIBLE` with 3 sub-lines). The 2026-04-20 From-brief fix added a 4th bullet; V1/V3/V4 add a 5th. `experiment-design-rules.md` §7.1 budgets 5–10 pt penalty on off-distribution context shape; the charter's 15-pt magnitude gate absorbs this.

## 7. Success criteria

Explicit thresholds. Graduated promotion — pick the cheapest variant that meets SHIP; do not run more expensive variants unnecessarily.

All SHIP actions below also require precision ≥85% AND adherence within ±2 pts vs V0 (measured per §7 adjudication + existing adherence-events fires). Any SHIP that violates those gates demotes to ITERATE or KILL per the overall bundle.

Full V1 × V2 outcome matrix. Rows are V1 outcome; columns are V2 outcome when/if V2 is run. Thresholds: "improves" = fire rate drops ≥5 pts (or drops ≥15 for "ship" cells); "flat" = ±5 pts; "worsens" = rises ≥5 pts.

| V1 outcome | V2 improves ≥5 pts | V2 flat (±5 pts) | V2 worsens ≥5 pts |
|---|---|---|---|
| V1 drops ≥15 pts | SHIP V1 — do NOT run V2 (V1 alone hits the gate). | SHIP V1 — do NOT run V2 (V1 alone hits the gate). | SHIP V1 — do NOT run V2 (V1 alone hits the gate). |
| V1 improves 5–15 pts | Run V3 to test combined lever. If V3 ≥15 pts, SHIP V3. Otherwise SHIP the better of V1/V2 subject to gates. | SHIP V1 (writer-side adds nothing; checker-side alone is the active lever). Skip V3. | SHIP V1. Writer-side is a regression — do NOT bundle. Skip V3. |
| V1 flat (±5 pts) | Run V3 ONLY IF Class-A proportion in §3 is dominant AND V2 improvement <15 pts (otherwise SHIP V2). If V3 adds ≥5 pts over V2, SHIP V3; else SHIP V2. | KILL lever family. Neither side moves the needle. Skip V3 AND V4. | SHIP V0 (current prod unchanged); writer-side regression is real. KILL writer-side. Checker-side neutral. |
| V1 worsens ≥5 pts | SHIP V2 subject to gates. Do NOT run V3 — combining a regression with an improvement bundles risk. | KILL lever family. Derived checker surface actively hurts; writer-side alone isn't enough. | KILL lever family — both sides regress. Next charter: retrain with widened surface. |

Skip-V2 shortcut: V1 drops ≥15 pts means the checker-side lever alone hits the magnitude gate; running V2 cannot improve the SHIP decision (it's already SHIP V1) and only adds noise if V2 silently regresses something. When V1 drops ≥15 pts, do NOT run V2.

| Outcome on V3 | Action |
|---|---|
| V3 fire rate drops ≥15 pts vs V0, precision ≥85%, adherence within ±2 pts, degenerate-list ≤15% | SHIP V3. V4 (planner schema) deferred as unnecessary. |
| V3 drops 5–15 pts | Run V4 (planner-emitted). |
| V3 drops <5 pts | KILL entire lever. Write up mechanism failure. Next charter targets adapter attention (retrain). |

| Outcome on V4 | Action |
|---|---|
| V4 fire rate ≤25% AND ≥10-pt improvement over V3 | SHIP V4. |
| V4 within ±3 pts of V3 | SHIP V3 (V4 schema cost not justified). |
| V4 adherence rises ≥3 pts or precision <80% | KILL V4; revert schema. Ship V3 if V3 met gates. |

**Precision floor (applied to all SHIP verdicts):** adjudicate 10 solo-ungrounded fires from the winning variant by parallel Sonnet subagents reading the actual halluc-ungrounded user_prompt (the calibrated method — not writer-context drift from 2026-04-20). Require precision ≥85%.

**Degenerate-list floor:** fraction of beats where the extracted/emitted list is empty must stay below 15%. Tracked in the run report.

## 8. Budget

- **Spend cap:** ≤$8 total.
  - 4 variant runs × $1.50 each = $6 (V1, V2, V3, and V0 measured within same run for clean within-seed pairing).
  - Up to 1 V4 re-run if V3 falls short = $1.50.
  - Sonnet adjudication (10 samples × 4 parallel subagents each × $0.01) ≈ $0.50.
- **Time cap:** 6 hours wall-clock. (4 × 30-min novels ≈ 2 hours with orchestrator parallelism; analysis + per-cell mechanism-falsifier report ≈ 3 hours; V4 contingent 1 hour.)
- **Stop if:** degenerate-list rate >20% on V1 (extraction pool too narrow — charter invalid), or orchestrator instability blocks parallel runs, or per-beat attribution instrumentation breaks before V1 completes.

## 9. Linked context

- Prior experiments / artifacts:
  - Halluc-v3 wiring-in: commits `1bdc422` + `4471cac`. Report: `docs/halluc-v3-production-report-2026-04-20.md`.
  - Planner Phase-2 payoff floor: `docs/charters/planner-phase2-payoff-floor.md` (precedent for structured per-beat planner metadata; V4 would follow this pattern).
  - Adapter: `halluc-ungrounded-v2:v1` in `adapter_registry`.
- Related decisions:
  - `docs/decisions.md` → "Context-engineering-forward architecture" (2026-04-18)
  - `docs/decisions.md` → "Hallucination-checker v3 two-adapter architecture" (2026-04-18)
- Code to commit before variant runs (one commit per variant — separate variants must be independently revertable):
  - Shared helper: `src/phases/beat-entity-list.ts` — `deriveBeatEntities(beat, outline, prevBeat?) → string[]` using existing `extractProperNouns` logic.
  - V1 toggle: `src/agents/halluc-ungrounded/context.ts` reads env, prepends derived list to From-brief.
  - V2 toggle: `src/agents/writer/beat-context.ts` renders `ALLOWED ENTITIES:` block.
  - V3 is V1+V2 via the same env var (`=v3`).
  - V4 (contingent): `src/schemas/shared.ts` + `src/agents/planning-beats/beat-expansion-system.md` + `src/agents/planning-beats/schema.ts`.
  - Instrumentation: `llm_calls.request_json` is `JSONB` (sql/018_llm_call_errors.sql:25, added via `ALTER TABLE ... ADD COLUMN request_json JSONB`). Write a `groundedSources: {bible, from_brief, derived_outline_fact, derived_prior_beat, planner_emitted}` object into the halluc-ungrounded request body at callAgent time; mechanism-falsifier script joins `request_json -> 'groundedSources'` against parsed `response_content.issues[].entity` via standard Postgres JSONB operators. No schema migration required.
  - Plan-freeze infrastructure: `scripts/variant/clone-for-variant.ts` clones `novels`, `characters`, `world_bibles`, `chapter_outlines`, and applicable `planned_state` rows from a source novel_id to a target novel_id. Ships before V1 run.
- `tuning_experiment` IDs: one per variant shipped.

## 10. Adversary review

Primary: Codex via `/codex:adversarial-review`. Opus `experiment-adversary` fallback only.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT-5.4 high) — primary, round 1 | RED | 2026-04-20 | Session `a9f8d084fbcb105d2`. 8 critiques addressed: (§2) mechanism tightened with explicit aggregation sources; (§3) mechanism falsifier added + was-entity-in-surface check; (§4) ladder rewritten with 5 cells on same seed; (§5) Codex's missing counterfactuals #6 and #7 promoted to V1/V2; (§6) same-seed ablation with plan-SHA attribution control; (§7) precision floor added, prose regression replaced with quantified adherence+precision gates; (§8) expanded budget for ablation + adjudication; (§9) fixed broken file citation. |
| `/codex:adversarial-review` (GPT-5.4 high) — primary, round 2 | RED | 2026-04-20 | Session `a913edd1f34f0b384`. Four remaining critiques: (1) union-membership falsifier doesn't isolate source, (2) single-seed still confounded by planner stochasticity, (3) unbounded iterate-on-degenerate hedge, (4) `request_json` schema not cited. All addressed in revision 3: source-level provenance tags in §3, frozen-plan discipline + clone-for-variant script in §6, iteration cap in §3, sql/018 schema citation in §9. V1/V2 antagonistic-outcome rule added to §7. |
| `/codex:adversarial-review` (GPT-5.4 high) — primary, round 3 | RED | 2026-04-20 | Session `a600e0894b45065d6`. Three residuals: (a) provenance collapsed to `{derived, planner}` at decision level; (b) clone list missing `facts`/`character_states`/`character_knowledge`/`relationship_states`/`timeline_events`; (c) §7 antagonistic rule gaps (V1 flat + V2 flat, V1 flat + V2 improves). Addressed in revision 4 via: Class-A/B/C pass/fail preserving 5-tag + `in_writer_ctx` vs `in_checker_ctx` split; authoritative clone list keyed to `src/planned-state.ts`; full-matrix V1×V2 outcome table. |
| `/codex:adversarial-review` (GPT-5.4 high) — primary, round 4 | YELLOW | 2026-04-20 | Session `af54e843f6eee06ec`. Confirmed Class A/B/C partitions failure space; clone-table list verified complete against `src/planned-state.ts`. Two residuals: (1) §7 missing `V1 improves × V2 {improves, flat, worsens}` row; (2) line-citation anchor for `planned-state.ts:10,26` was imports/loop-start, not write-sites. Both fixed in revision 5 — full V1×V2 matrix with V1-improves row; citations moved to helper `src/db/*.ts` write-sites. |
| `/codex:adversarial-review` (GPT-5.4 high) — primary, round 5 | YELLOW | 2026-04-20 | Session `af9bd971aa3eac43a`. §6 citations confirmed valid; §7 matrix complete. Single residual: V1-drops-≥15-pts row used `same` shorthand in V2 columns; Codex asked for explicit text in all three cells. Fixed in revision 6 — each cell spells out "SHIP V1 — do NOT run V2". |
| `/codex:adversarial-review` (GPT-5.4 high) — primary, round 6 | **GREEN** | 2026-04-20 | Session `a7dbc0c16502a5afc`. All residuals closed. Charter unblocks V1 implementation. |
| `experiment-adversary` (Opus) — fallback only | — | — | — |

Block on YELLOW/RED. Iterate the charter, not the run.
