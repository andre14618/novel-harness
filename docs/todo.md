---
status: active
updated: 2026-04-21
---

# To Do

Pending action items only. Ordered by impact. Completed items and decision rationale live in `docs/decisions.md`.

## Current Priorities (2026-04-21)

### NEW — Late 2026-04-21 voice-LoRA pivot + voice-shaping ablation

- [ ] **Voice-shaping ablation v1 results synthesis.** Run executing on LXC as of 2026-04-21 (pid 356545, set_name `voice-shaping-ablation-v1`). After completion: decomposed audit (voice-shape metric distance per arm per beat vs Salvatore reference, word-count residualization check, halluc-leak gate on D2, character-distinctness Sonnet audit), aggregation into `docs/charters/voice-shaping-ablation-v1-results.md`, verdict, and final pass on the 2026-04-21 retrospective (flip `status: draft` → `status: complete`). Charter: `docs/charters/voice-shaping-ablation-v1.md` (revision 2). If any arm clears the SHIP candidate bar, follow-on v2 charter with D4/D5 isolation controls.
- [x] **Successor to `arm-b-detector-preflight`** — SUPERSEDED by the LoRA-track pivot (2026-04-21). The preflight arc → arm-b-direct-pairwise (CAUTION) → arm-d-writer-upgrade → pivot to DeepSeek + voice-shaping-ablation-v1. The replay-ladder-v1 charter remains RED-blocked but is deprioritized: the voice-shaping program answers the same "where should next $N go" question under the new architecture. Re-open the ladder only if voice-shaping produces a SHIP-candidate arm and the full ladder becomes the right follow-on.

- [x] **Measure `qualityRedraftEnabled` in production** — DONE 2026-04-21 (novel PID 315593 complete, 93 beats, 29 retries = 31%, $0.0462). **Outcome: 0 redraft fires across the run** despite flag on. Inconclusive as a gate-value measurement; more likely finding is that the detector thresholds (`detectRepetition` + `detectUnderlength(<100w)`) are too strict to ever trigger on real Salvatore-route production prose. Flag stays default OFF. Counted as signal #3 in the 2026-04-21 LoRA-track-evidence retrospective (`docs/retrospectives/2026-04-21-lora-track-evidence.md`).
- [ ] **rewrite-capability-probe charter: round-2 re-review or formal withdrawal.** Charter (`docs/charters/rewrite-capability-probe.md`) got a round-1 RED verdict (commit `d36bfae`). Session context: the rigorous probe (commit `eb3e7c8`) provided the decisive evidence that was needed. The directional signal (LoRA cannot rewrite with critique) is now clear enough to consider the charter's research question answered, making round-2 review optional. Options: (a) write a brief "verdict: answered" addendum to the charter and close, or (b) run round-2 re-review focused only on whether the redraft-gate design adequately addresses the probe's findings. Decision call for next session.
- [ ] **`salvatore-v5-corpus-expansion` charter** — DRAFT landed 2026-04-23 at `docs/charters/salvatore-v5-corpus-expansion.md`. Status stays `draft` until pre-gate cleared: PDFs for 3-5 Legacy-of-the-Drow-series novels on disk. Charter implements Option D from the "Salvatore voice LoRA" section (Icewind Dale + Legacy of the Drow, same training config, measure distinctness before adding archetype tags). Cheapest-counterfactual detection plan: POV distribution analysis at Stage 3 catches Drizzt-POV > 60% imbalance before training spend. Adversary review gated on PDF acquisition; re-read the v1 Codex review in `docs/decisions.md` before submitting.
- [ ] **Context-engineering priority items (from CLAUDE.md strategic direction).** Session set the direction: context engineering + editing passes + writer-model upgrade over more conditioning tricks. Specific items: (a) `speaker_directives` per beat (V1b — gated on completed 4-arm V1a pilot), (b) reader-information state tracker, (c) world-expansion budget per chapter. See §3 and §4 below.
- [ ] **Concurrent-Codex invocation research (low priority).** The `codex exec` subprocess pool hung on the conditioning-floor cross-judge run (16+ min, zero returns). Investigate whether a Codex CLI flag or wrapper pattern enables safe sequential-batch invocation for eval automation, or confirm Agent subagents are the only safe parallel path. See `docs/lessons-learned.md` "codex exec does not compose under concurrency."
- [x] **tier-ordering-validation-v1 charter** — CONCLUDED 2026-04-21 (exp #264, commits `db9d8f6` → `b4426fb`). Full lifecycle: roadmap v2 → RED adversary review → terrain survey killed v1 lever (`establishedFacts` density vacuous per `beat-context.ts:255-281` render surface) → pivoted to v2 lever (`requiredPayoffs` density) → probe FLAT within noise (88.5% → 80.8%, McNemar p ≈ 0.68 at n=26/cell, actual cost $0.028 = 21× under $0.60 budget). Charter and revised lever both killed; 3-tier sequential ordering promoted to "working hypothesis, revisit if Tier 1 winners collapse under Tier 2 writer swaps." Results: `docs/charters/tier-ordering-validation-v1-results.md`. Retrospective: `docs/sessions/2026-04-21-tier-ordering-probe.md`.
- [ ] **Ship Tier 1B writer-visible threading.** The terrain survey established that most "planner-side structural state" assumed writer-visible in the roadmap doesn't actually reach the writer. Tier 1B is the un-shipped glue that would change that:
  - Bulk `establishedFacts` injection into `src/agents/writer/beat-context.ts` (today: only `requiredPayoffs`-linked facts render as SEEDS / PAYOFFS DUE)
  - `worldExpansionBudget` wiring per chapter (count new named entities; surface as a constraint to the writer)
  - `priorBeatEstablishedFacts` threading via `getFactsUpToChapter` (today: no prior-chapter fact state reaches the writer at all)
  Requires a production code change in the writer context surface, NOT just a planner-prompt intervention. Measurement via decomposed audit at full-novel scale (not chapter-probe — that instrument bottomed out at n=26/cell per exp #264 noise-floor finding). Sequence against the `voice-shaping-ablation-v1` result before scoping a charter.

### Housekeeping findings from Codex code audit (2026-04-21, job `ba3olk3os`)

Codex audit raised four issues unrelated to today's experiments but worth fixing before they affect future runs:

- [x] **[high] Together fine-tune submitter reuses stale uploads by basename match** — FIXED 2026-04-21 (`scripts/finetune/train-together-small.py`). Default behavior is now fresh upload every time (no basename-match reuse — Together's file listing only exposes filename, not content hash, so the old path silently trained on stale data after any local regeneration). `--reuse-file-id <id>` is the explicit opt-in for re-submitting a failed job against a known-good upload. Always computes + logs `sha256` of the local data file; emits a provenance manifest under `finetune-data/together-runs/{exp-<id>|job-<id>}.json` with job_id, file_id, data path/bytes/sha256, base model, hyperparams, and UTC submission time. Manifest key uses `--experiment-id` when supplied so the record joins to `tuning_experiments` downstream. Script compiles + `--help` renders clean.
- [x] **[high] Leak formatter throws away Sonnet label corrections** — FIXED 2026-04-21 (`scripts/hallucination/format-v3-two-adapters.ts`). `toLeakPair()` now derives `has_leak` + `leaks[]` from two sources UNION'd: (1) `regexLeakMatches(prose)` from the canonical `src/agents/halluc-leak-salvatore/regex-leak.ts` token list; (2) the corrected assistant payload's `issues[].entity` list, filtered to entries matching a `LEAK_TOKEN` via possessive-tolerant lookup. Variant-agnostic — a Sonnet-flipped PASS on a FAIL_CORPUS_LEAK variant now correctly labels as `has_leak=false`, and an accidental leak in a non-FAIL_CORPUS_LEAK variant now gets caught. Smoke-tested the four corner cases. Any leak training/eval artifacts derived from the prior formatter must be regenerated before the next `halluc-leak-salvatore` retrain (tied to the deferred v2 SFT ticket below).
- [x] **[medium] Natural leak val auto-labels generic names as positives** — FIXED 2026-04-21 (`scripts/hallucination/build-natural-leak-val.ts`). Replaced hand-maintained `LEAK_TERMS` + case-insensitive `.includes()` with (a) `regexLeakMatches` from `src/agents/halluc-leak-salvatore/regex-leak.ts` (inference-parity, word-boundary), (b) post-filter against benign injection-pool names (`injection-pools.json.characterNames` ∪ `realWorldRefs`) — specifically handles the `Cassius` overlap Codex called out, plus all other potential benign-pool collisions. Dropped tokens are logged per-beat (`_meta.dropped_benign_overlaps`) and aggregated in the run summary. Smoke-tested: `Cassius`-only prose now correctly labels negative; `drowsy`/`crowded` no longer trip a `drow` substring false positive. The prior `halluc-leak-salvatore-natural-val.jsonl` artifact must be regenerated before it's used for any new eval.
- [x] **[medium] `qualityRedraftEnabled` flag is process-wide, not per-run** — FIXED 2026-04-21. Env-var read removed from `src/config/pipeline.ts`; `SeedInput.pipelineOverrides?.qualityRedraftEnabled` added as the per-novel scope point; `--quality-redraft` CLI flag in `src/config/run.ts` + `src/index.ts` writes the override into the seed before `createNovel`; `src/phases/drafting.ts` reads once via `effectivePipeline(novel.seed)` at the top of `runDraftingPhase`. HTTP `POST /api/novel/start` with `customSeed.pipelineOverrides` works the same way. Drafting tests pass.

## Current Priorities (2026-04-18)

**Architectural direction locked:** context-engineering-forward. Planner expressiveness + beat-context delivery are the quality lever. Checkers are narrow (adherence + hallucination). Craft is a model-weights problem. See `docs/decisions.md` "Context-engineering-forward architecture."

### 0. Preflight invariants — DONE (exp #243, 2026-04-19)

Five starting blocking preflight invariants shipped per `docs/invariants.md` registry. Canonical invocation: `bun scripts/preflight.ts`. Codex final verdict PASS after 2 fix-pass iterations.

- [x] **Invariant #1** — revisionUsed restart persistence (runtime). Commit `10ce979`.
- [x] **Invariant #2** — Seam-recheck symmetry (AST). Commits `ce6452c` + `7afe4dd` + `dedc0b6`.
- [x] **Invariant #3** — Trace-seeded watcher for post-start event assertions (AST lint). Commit `ce6452c`.
- [x] **Invariant #4** — Branch-symmetric event emission (runtime, narrow). Commits `10ce979` + `7afe4dd`.
- [x] **Invariant #5** — Body-already-used detection (regex). Commit `ce6452c`.
- [x] **Registry doc** — `docs/invariants.md` updated with shipped statuses. Commit `2c29b91`.

Follow-ups (low priority):

- [x] **Widen invariant #5 to AST-based detection** — DONE (T1, exp #244, 2026-04-19). `scripts/lint/invariants-check.ts` now uses a `typescript` compiler API walk to flag any source-ordered pair of body-consuming calls (`.text()` / `.json()` / `.arrayBuffer()` / `.blob()`) on the same receiver within one enclosing function, method-name-agnostic. Reachability heuristic suppresses pairs where the first call sits in a branch that unconditionally terminates (throw/return/continue/break, including try-blocks where both try-last and catch-last return). Fresh-object receivers (`new Response(...).text()`) are excluded from grouping. Regression belt: `body-already-used.ts` (template) + `body-already-used-sequential.ts` + `body-already-used-json-first.ts`.
- [x] **Refactor the 4 HEAD allowlist entries for invariant #5** — DONE (T1, exp #244, 2026-04-19). Subsumed by the widen ticket. AST reachability heuristic sees the `if (!res.ok) throw ... ${await res.text()}` short-circuit and correctly marks the `.json()` sibling as safe; all 4 entries removed from `.claude/invariants-allowlist.yaml` (now `entries: []`).
- [x] **Tighten `BASELINE_TEST_FAILURES` to 0** — DONE (T3, exp #246, commits to follow 477bc04). Extended the two `mock.module("./beat-checks", ...)` bodies in `src/phases/drafting-reviser-escalation.test.ts` and `src/phases/drafting-revision-used-persistence.test.ts` to re-export the full beat-checks shape (`aggregateIssues` + `formatRetryLine` + `summarizeIssues` with real-signature parity). `bun test src/` now 71/0; preflight baseline dropped from 1 to 0 so any new failure fails preflight immediately.

### 1. Hallucination checker v3 — wire decomposed adapters into retry loop

**v2 rejected (2026-04-18):** pure-synth training hit 95%+ synth-val but regressed to 77.8%/51.2% natural-val. Distribution-shift. See `docs/decisions.md` 2026-04-18.

**v3 architecture shipped + wired (2026-04-18):** decomposed into two parallel narrow adapters (see `docs/decisions.md` 2026-04-18 "v3 two-adapter architecture"):
- [x] `halluc-ungrounded-v2` — grounded-context check, 1273 pairs (Cerebras + DeepSeek + v1 natural merged). Synth 96.8%/88.2%; natural val combined with leak: 77.8%/85.4%/81.4% F1.
- [x] `halluc-leak-salvatore-v1` — per-writer Salvatore-leak check, prose-only input. Synth 100%/90%; natural strict-§A val 80%/40%.
- [x] Combined via OR logic matches v1 baseline F1 (81.4 vs 82.1) with different trade-off (+7.4 recall, −8.7 precision).
- [x] `format-v3-two-adapters.ts` builds both training sets from shared pool; `eval-combined-v3.ts` runs both adapters in parallel.
- [x] **Wired into `drafting.ts`** (2026-04-18) — `runBeatChecks()` in `src/phases/beat-checks.ts` fans out adherence + ungrounded (always) + leak (Salvatore-route only), aggregates into unified `BeatIssue[]`, OR-gates retries. Leak gating is by `WRITER_GENRE_PACKS` label. See commits `1bf119d` → `df2c5f0` and `docs/hallucination-v3-wire-in-plan.md`.
- [x] **Measure production fire rate per adapter over 7 clean novels.** Done 2026-04-20 on panel of 7 natural Salvatore-routed novels (261 beat attempts). Full report: `docs/halluc-v3-production-report-2026-04-20.md`. Headline: adherence 10.8%, ungrounded 46.7% (precision 60–75% on solo fires; dominant FP is adapter overfiring on brief-grounded proper nouns), leak 15.7%. Retry clearance poor (9–28%) → prescribed action per runbook §8.10 is retry-wording fix + context tweak before retraining.
- [x] **Retry-wording + From-brief context fix** — SHIPPED 2026-04-20. `src/phases/beat-checks.ts` `formatRetryLine` now tells the writer the valid resolution space; `src/agents/halluc-ungrounded/context.ts` now extracts proper-noun candidates from `beat.description` + `outline.setting` and adds a `From-brief:` line to the WORLD BIBLE block. Offline replay on 20 samples: flipped 1/1 of the true in-scope FPs (Heartstone); 19 "FPs" from the original adjudication were actually context-surface mismatches (see below), not adapter issues.
- [x] **Measure retry clearance + FP rate on next 3-5 natural novels** with the shipped fixes. Subsumed by the beat-entity-list charter (§1 below) which ran a within-seed V0/V1 pair on `fantasy-debt`; V0 on shipped prod code measured 44.9% fire rate (close to the 7-novel panel 46.7%), V1 drops to 28.9%.
- [x] **Context-surface mismatch between writer and checker** — root cause of the 46.7% fire rate. **Fixed 2026-04-20 via beat-entity-list-v1** (exp #254, commit `ff555bc`). Shipped the cheapest fix on the ladder (option b equivalent — widened the checker's grounded surface at check time via derived entities from `outline.establishedFacts` + prior-beat `description`, surfaced as a new `Beat-entities:` sub-line in the WORLD BIBLE block). `BEAT_ENTITY_LIST_VARIANT=v1` is now default. See `docs/decisions.md` "beat-entity-list V1 shipped" and `docs/charters/beat-entity-list-v1.md`. Option (a) — enriching `beat.description` at plan-time — deferred; V4 (`sceneBeat.mentionedEntities` planner-emitted) remains on the shelf if V1 plateaus.
- [x] **Non-Salvatore-route verification** — DONE 2026-04-20 (exp #255, novel-1776702712258, seed `coastal-mystery` genre "literary thriller"). After 7 beat-level gate firings: halluc-ungrounded called 7/7 with `groundedSources.variant='v1'` (new default via commit `620dc71`); halluc-leak-salvatore called 0 times — correctly gated by `WRITER_GENRE_PACKS.label` null. V1 changes are safe on non-fantasy routes.
- [ ] Active-learning harvest from production for v4: 76 solo-ungrounded fires in the current panel are candidate v4 training seeds; combine with adapter disagreement + human-accept signal. Beat-entity-list charter Class-B residual (~17% of V1 fires — all "Aldric" overfires despite grounding) is also a training seed for a surface-widened retrain.
- [x] **halluc-leak-salvatore recall gap — CLOSED via regex OR-combine** (2026-04-20, commit `cc57752`). Rung 0 measurement (`docs/rung-0-regex-ceiling-results.md`) on 3,081 production calls: regex OR-combine adds +31.6% recall (158 → 208 beats flagged). Top adapter misses caught: Harpells (35), Baldur's Gate (32), Waterdeep (15). Spot-check ≥95% precision on regex-only catches. No SFT spend. `src/agents/halluc-leak-salvatore/regex-leak.ts` is the token list; keep in sync with `scripts/hallucination/rung-0-regex-ceiling.ts` when widening.
- [x] **halluc-leak-salvatore regex FN follow-up** — DONE 2026-04-23. Widened `src/agents/halluc-leak-salvatore/regex-leak.ts` LEAK_TOKENS (+dark elves/dark elf/drow elves/drow elf/mithril) and `buildRegex` possessive-suffix group `(?:'s?|s')?` after each alternation. `scripts/hallucination/rung-0-regex-ceiling.ts` synced. Alternation ordering is load-bearing — longer variants placed before bare `drow`/`dark` so the regex engine doesn't prefer the shorter prefix. 13/13 synthetic tests pass (possessive × 2, dark-elf × 4, lowercase-mithril × 1, regressions × 6).
- [ ] **halluc-leak-salvatore v2 SFT training (deferred).** Addresses **weight-level** leakage (writer LoRA leaking tokens before detector runs) rather than detection. Distinct from Rung 0. Scoped at `docs/scoping/halluc-leak-salvatore-v2.md`. Re-open only if Rung 0 + regex-widen followup fail to keep production leak below threshold.
- [ ] Paired leak adapter for non-Salvatore writers when those LoRAs ship (Gemmell, Cook, etc.).

### 2. Unified issue aggregator (partially shipped 2026-04-18)

- [x] Refactor `drafting.ts` so adherence + hallucination emit issues to a common queue per beat. Lives at `src/phases/beat-checks.ts` (`BeatIssue[]` + `runBeatChecks()` + `aggregateIssues()`).
- [x] Single targeted-rewrite call addresses ALL flagged issues at once (not per-checker retries). `previousIssues` in drafting's retry loop now carries the merged `retryLines` from every fired checker.
- [ ] Fold continuity-v2 into the same aggregator once the cross-chapter state charter resolves (currently invoked per-chapter, not per-beat, and deprioritized per `docs/current-state.md`).
- [ ] Severity tags — infrastructure exists (`BeatIssue.severity: "blocker" | "warning"`) but every current checker emits only `blocker`. Reserved for future voting / soft-signal modes; revisit after the production-telemetry runbook (§1 above) gives data on false-positive rates.

### 3. Planner Phase-2 enrichment (next experiment after checker wired)

Add to chapter outline output. **V1a shipped 2026-04-18** per `docs/current-state.md:59` — pilot measurement gated on an adversary-GREEN verdict on `docs/charters/planner-phase2-contract.md`; V1b/V1c gated on V1a pilot results.

- [x] `establishedFact.id` as stable identifiers for cross-referencing — shipped V1a. `src/schemas/shared.ts:32` `payoffLinkSchema`.
- [x] `requiredPayoffs: [{fact_id, payoff_beat}]` — planner links setups to payoffs explicitly. Shipped V1a. `src/schemas/shared.ts:45`.
- [x] Update `beat-context.ts` to surface new fields to the writer — shipped V1a with SEEDS / PAYOFFS DUE blocks. `src/agents/writer/beat-context.ts`.
- [~] **V1a mini-pilot — PARTIAL (exp #256, 2026-04-20).** 2 of 4 arms run. Baseline + prompt on 3 seeds × 5 chapters = 15 slots. Mean paired Δ retry_ratio = −0.0309, prompt 6/baseline 8/tie 1; ITERATE per charter §7. Next-session action below.
- [ ] **Complete V1a pilot — run the two missing arms.** Charter §4 specifies 4 arms; session 2026-04-20 under-scoped to 2. Next session must run:
  - `extractor` arm (measurement-only inference extractor, `pre-planner-phase2-v1a` tag) on same 3 seeds × 5 chapters. Isolates verifier sensitivity.
  - `mainv1a` observational arm (current `main` with V1a in production) on same 3 seeds × 5 chapters. Anchors prompt arm to actual current-prod. Caveat per charter §2: 2026-04-18 hallucination v3 wire-in means `mainv1a` runs with 3 beat-level checkers vs tag's 1 — compare on adherence-only failing-chapter count. Full report in `docs/pp2-floor-pilot-results.md`. After 4-arm data: Codex adversary re-review, then V1b/V1c decision.
- [ ] `subplot_id` per beat — tags which narrative thread advances. **V1c — gated on V1a pilot results.**
- [ ] `speaker_directives` per beat — per-character: what each speaker specifically advances/reveals/conceals (content, not voice). **V1b — gated on V1a pilot results.**
- [ ] `thematic_focus` — which aspect of theme this beat leans on. **V1c — gated on V1a pilot results.**
- [ ] Extend adherence-events to verify payoffs land and directives are honored — gated on V1b/V1c shipping.

### 4. Context-engineering direction — other items

- [ ] Reader-information state tracker — "what has the narrative revealed so far" separate from character_knowledge
- [ ] World-expansion budget per chapter (count new named entities; alert on overload)

### 5. Non-blind-retry architecture — follow-through (2026-04-19)

Shipped: chapter-plan-checker swap to DeepSeek V3.2 base (commit `1e52baf`),
beat-targeted rewrites for plan-check + validation (`892944f`, `1125287`),
chapter-plan-reviser agent + escalation (`5d8e5d3`), post-revision sanity
checks (`1c367d6`), revision persistence (`a1476b7`), revision telemetry
+ `/api/novel/:id/revisions` + RevisionsPanel (`18f4444..343b266`).

Codex review (session ac8df7a8 + ac7442d6) flagged remaining work:

- [x] **Stub test — reviser escalation fires exactly once per chapter.**
  Shipped 2026-04-19 in `src/phases/drafting-reviser-escalation.test.ts`
  (commits `73542f8` + `6eb9bd9`). Covers both accepted and thrown reviser-call paths.
- [x] **Fix `migrate()` pathing bug.** Shipped 2026-04-19 (commits `ce64e28` + `6eb9bd9`).
  Path resolves `../../sql` from `src/db/`. Regression test in
  `src/db/migrate-path.test.ts`. `_migrations` backfilled on LXC with
  rows 021-025, 028 (had been applied manually) before the fix deployed
  so the migrator would not re-run destructive 022/023.
- [x] **Human gate for plan-check-exhausted** — shipped as `plan-assist` gate
  (commits `2f012de`..`e75ee01`). Web-mode: `PlanAssistPanel` with override/edit-plan/abort decisions. Auto-mode: `PipelineBailError` thrown, `lastRunError` written to state.
- [x] **Upstream escalation for validation-exhausted** — shipped path (C)
  (commits `e829b81` + `8ee7e3f`). `buildContextForValidation` + validation-driven reviser escalation.
- [x] **Human gate for reviser-rejected plans** — same `plan-assist` gate covers
  both `kind="plan-check-exhausted"` and `kind="reviser-rejected"` (commits `5767ab9` + `8fd2097`).
- [x] **`chapter_exhaustions` telemetry** — shipped (commit `22fd021`). Table, `GET /api/novel/:id/exhaustions`, `ExhaustionsPanel`. UI live in commit `1d1b4e1`.
- [x] **Debug-injection MVP** — shipped (commits `7d53dac`..`4ad2413`). `src/config/debug-injection.ts` with `DEBUG_FORCE_PLAN_CHECK`, `DEBUG_FORCE_VALIDATION`, `DEBUG_FORCE_REVISER` flags.
- [x] **Fresh end-to-end validation run (no DEBUG_FORCE_* flags)** — DONE 2026-04-20 on the 7-novel natural panel used for the halluc-v3 measurement pass. 0 `chapter_exhaustions`, 0 `chapter_revisions`, 0 `PipelineBailError` across 261 beat attempts; chapter-plan-checker reject rate 0% (vs 35–44% pp2-floor baseline). Non-blind-retry handlers are silent on clean novels. Full evidence in `docs/halluc-v3-production-report-2026-04-20.md`. Verification queries still apply once the novel completes:
  - chapter-plan-checker reject rate per chapter (target: <10%, down from
    35-44% pre-fix baseline on pp2-floor__* novels) — query `llm_calls`
    WHERE agent='chapter-plan-checker' AND novel_id=<new-id>,
    count rows where `response_content` contains `"pass":false`.
  - reviser invocation + acceptance rate — `SELECT outcome, COUNT(*) FROM
    chapter_revisions WHERE novel_id=<new-id> GROUP BY outcome`.
  - retry_ratio (rows with attempt>1 / total) on beat-writer calls,
    compared to the 3 pp2-floor fantasy-debt cells.
  - Inspect RevisionsPanel at `/app/<new-id>` — renders real telemetry?
  - If reject rate still high OR reviser acceptance low: root-cause before
    declaring the non-blind-retry architecture validated.
- [ ] **V2 transport interceptor** — recommended by Codex (review ae23f96a5f5cf8247)
  as follow-on to the debug-injection MVP. Cleaner seam than env flags for
  injecting faults at the transport layer. Full spec at
  `docs/debug-injection-v2-spec.md` (Codex a892e3f5b4c79a3ea).
- [ ] **`src/invariants/debug.ts`** — recommended by Codex (review ae23f96a5f5cf8247)
  as a centralized invariant-assertion module replacing the scattered `DEBUG_FORCE_*` checks.
- [x] **Orphan plan-assist gate detection (MVP)** — shipped 2026-04-19 in commit
  `13f8143`. Startup sweep in `src/orchestrator/server.ts` logs every pending
  row older than 60s. `GET /api/novel/orphaned-gates` + `POST /api/novel/:id/
  plan-assist/:chapter/mark-orphaned` for cleanup. ExhaustionDecision now
  includes "orphaned".
- [ ] **Full restart recovery for plan-assist gates** — MVP orphan detection
  shipped above. Full auto-recovery (re-fire the gate on resume so drafting
  loop can re-await) needs drafting.ts attempt-loop changes to re-enter the
  exhaustion branch on novel resume. Flagged by Codex review a252aecbb785a0eb3.
- [x] **`revisionUsed` persisted to chapter_outlines.revision_used** — shipped
  2026-04-19 in commit `0c9b1ef` (migration sql/031 + `isRevisionUsed` /
  `setRevisionUsed` in `src/db/outlines.ts` + await-then-flip at both reviser
  invocation sites in `src/phases/drafting.ts`). Two-case regression test
  in `drafting-revision-used-persistence.test.ts` plus a DB-reject case
  proving the reviser doesn't fire when persistence fails (Codex review
  aad6d35 HIGH A, fix commit `0c9fa3b`).
- [x] **Propagate `callerId` into transport** — shipped 2026-04-19 in commit
  `13f8143`. src/llm.ts makeRequest threads agentName; executeAndLog sets
  callerId on the effectiveRequest. Timeout log `[LLM] TIMEOUT:` now names
  the agent reliably.
- [x] **Clean no-forced-flags validation run** — DONE 2026-04-20 (see the "Fresh end-to-end validation run" item above — same panel, same evidence).
- [ ] **Continuity-throws stays blind** — by design per Codex (transport
  instability, not content failure; human intervention cost too high for
  a transient checker outage). No change needed.
- [ ] **Historical-superseded doc pass** — recommended by Codex (review ac11a277b179df8b0). Several docs contain current-tense statements that are now stale: `decisions.md` (references to chapter-plan-checker-v2 as deployed, Howard primer as "under evaluation"), `adapter-changelog.md`, `lessons-learned.md` earlier sections, `fine-tuning-strategy.md`, `adapter-training-reference.md`, `retry-surface-audit.md`. Pass: add inline "Superseded by …" callouts, not rewrites. Separate commit from code changes.
- [x] **Kill-orphan helper** — shipped 2026-04-19 in commit `83ffce0` as
  `scripts/cleanup-orphans.ts`. Cascade delete across 26 novel-scoped tables
  (22 with FK → novels(id) + 4 no-FK telemetry); default dry-run, `--apply`
  required; pattern defaults to `test-*`; excludes novels with approved
  drafts; active-phase novels need 2-hour idle guard; per-novel transaction.
  Codex review aad6d35 HIGH C flagged 4 missing FK tables in the initial
  list — fixed in commit `0c9fa3b`; dry-run on live DB finds 5 stale test
  novels and queries all 26 tables without error.

---

## Corpus Pipeline — Salvatore bundle (STAGES 1-4 DONE)

Reference bundle validating the canonical corpus-pipeline architecture (`docs/corpus-pipeline.md`, `novels/salvatore-icewind-dale/`):

- [x] **Stage 1 — ingestion** — 3 books canonicalized (~307K words total)
- [x] **Stage 2 — scene extraction** — 352 scenes across all 3 books, every chapter covered
- [x] **Stage 3 — beat segmentation** — 2,470 beats via 71 parallel Sonnet subagents, zero failures
- [x] **Stage 4 — brief extraction** — **2,470/2,470 training pairs** across all 3 books (124 parallel subagents: 43 for Crystal Shard + 81 for Streams/Halfling's Gem). End-to-end verify CLEAN (2026-04-17).
- [ ] **Stage 5 — analysis** — 10 analyzers declared in `config.yml` (structural / voice / dialogue / dialogue-density / tension / chapter-hooks / sensory / sentence-rhythm / pov-rotation / metaphor). Plugin framework not yet built. Wave 1 wiring (structural, voice, dialogue, tension, dialogue-density, chapter-hooks) directly addresses known harness weaknesses.
- [x] **14 conservation invariants pass** end-to-end. Salvatore bundle is now training-ready.

## Archetype-Pass POC — exp #220 (COMPLETED 2026-04-17)

- [x] Dialogue extraction + training-pair build + 14B LoRA training (`archetype-poc-v1`)
- [x] 3-way comparison: LoRA vs DeepSeek+profile vs Sonnet+profile — 300 Opus pairwise judgments
- [x] **Verdict: Sonnet+profile wins 55% / LoRA 33% / DeepSeek 8%.** Decision tree resolved: LoRA-zoo architecture rejected; voice-as-data via exampleLines + in-context few-shot is the pattern. See `docs/decisions.md` "Context-engineering-forward architecture."
- [x] Follow-up (reframed) test: DeepSeek + 5 few-shot examples matches archetype-poc-v1 LoRA on per-line dialogue voice. Confirms context-first approach.
- [x] Learning baked into v4 writer LoRA (exp #222) — per-speaker exampleLines injected at training-time AND inference-time.



## Fantasy Structural Context Engineering — TOP PRIORITY

**Genre focus (2026-04-16 directive):** laser-focused on fantasy genre exclusively. All harness building targets action-pulp fantasy (Salvatore voice) and eventually gamelit/litrpg. Lessons learned will inform future genre expansion; we are NOT building a generalizable AI harness right now.

### Planner structural priors (from `docs/salvatore-structural-analysis.md`) — SHIPPED 2026-04-17

Salvatore corpus structural signature is now rendered into the planner prompt via `renderStructuralPriorsForPlanner()` (genre-matched through `WRITER_GENRE_PACKS`). Items marked below reflect what's live:

- [x] **Beat-type budget per chapter**: rendered in priors (~34% action / 31% dialogue / 22% interiority / 14% description).
- [x] **Opener/closer rules**: rendered (open with description/action; close with action/interiority, never description).
- [x] **Cluster-sustain rule**: rendered (action sequences sustain 3–5 beats; dialogue 2–4).
- [x] **Scene size guidance**: rendered (3–8 beats per scene, mean 5.5 soft cap).
- [x] **Active character cap**: rendered (≤3 named active characters per beat).
- [x] **Beats-per-chapter floor enforced**: two-phase planner emits per-chapter `ceil(targetWords / 150)` beats minimum, with targeted re-expansion on miss — validated on fantasy-healer + fantasy-cultivation-void 2026-04-17.
- [ ] **Per-beat drives** (proposed): planner authors one-line situational drives per character per beat instead of writer translating stable traits. Deferred pending compact-mode validation.

### Tension/pacing curve extraction

- [ ] Build tension scorer (heuristic from sentence compression + action-verb density + stakes-language)
- [ ] Plot tension curve for Salvatore corpus → extract characteristic shape
- [ ] Build fantasy-tension-template as a planner constraint ("by chapter 5 of 10, tension should be 0.7")

### Plot arc position tagging

- [ ] Tag each Salvatore chapter with arc position (setup / rising / midpoint / escalation / dark_night / climax / resolution)
- [ ] Verify position distribution matches three-act structure norms for fantasy
- [ ] Build arc-position checker (evaluates planner output for structural pacing)

### Additional corpus ingestion (same pipeline, more fantasy)

- [ ] Ingest a second fantasy author (Gemmell Drenai series or Cook Black Company) for cross-author structural comparison
- [ ] Run structural analysis on second corpus → compare transition matrices, beat-type budgets, opener/closer patterns
- [ ] Identify genre-universal vs author-specific structural signatures

---

## Writer Imitation Benchmark — Salvatore deconstruction (TRAINING IN FLIGHT)

Treat writer quality as an engineering problem with a measurable ground truth. Deconstruct the Icewind Dale Trilogy into beat-level training pairs, build a permanent quality oracle that scores every methodology (model swap, primer change, generation unit change, SFT adapter) against actual published prose for the same beats.

**Full plan:** `docs/writer-imitation-benchmark.md` (measurement layer) + `docs/writer-style-imitation-design-space.md` (method layer). Phase A + B results in `docs/corpus-structural-analysis.md`. Decisions in `docs/decisions.md` ("Writer Voice Imprinting").

**Status (2026-04-16):**
- Phase A (corpus decomposition): **DONE** — 777 paired (brief, prose) beats, 83,641 prose words, 703/74 train/val
- Phase B (chunk-size A/B on DeepSeek baseline): **DONE** — 120w wins (Δ-sum 1.81); identifies the rhythm + sensory-density gaps the LoRA must close
- Phase C (LoRA training + validation): **DONE** — `salvatore-1988-v1` trained and validated; Δ-sum 0.45 vs DeepSeek 2.45 (exp #192 concluded)
- Phase C.2 (capability vs tuning, 3-cell A/B): **DONE** — exp #193. Tuning beats ICL by ~2.7×: primer 0.73 Δ-sum improvement; LoRA an additional 1.96. Sentence rhythm does not transfer via ICL on DeepSeek. See `docs/decisions.md` "Phase C.2 verdict."

### Phase D — production validation (DONE 2026-04-16/17)

- v3 + narrow-strip compact context passed all 3 chapters of `fantasy-echo-mage` in 5 attempts (exp #201)
- 17-seed validation sweep completed: 6 of 13 LoRA-routed seeds completed all chapters; word-count + required-fact-miss patterns identified and addressed via structural priors + planner-level fix
- Howard primer methodology retired 2026-04-16; per-genre voice LoRAs replace universal primer
- Chapter-level rewriter removed 2026-04-17 — validation is diagnostic-only; beat-writer retry is the quality gate
- See `docs/decisions.md` + `docs/voice-lora-salvatore.md` + `docs/beat-writer-architecture.md`

**Next:** monitor 3-seed re-run (dark-fantasy, fantasy-healer, fantasy-debt) with structural priors + planner fact fix deployed. If word-count issue resolves with more beats/chapter, structural priors are confirmed effective.

---

## Lint fixer (conditional deprecation candidate)

Voice LoRA may make lint patterns irrelevant — Salvatore corpus prose doesn't contain AI-fiction tells. Before SFT'ing a lint-fixer, measure lint-fire rate on voice-LoRA output. If ≤1 issue/chapter, retire instead of migrate. See `docs/pipeline-14b-consolidation.md` Tier 1 conditional-deprecation gate.

## W&B Storage Management

**Resolved (2026-04-12):** Purged 20.8 GB of superseded artifacts (21.81 → 1.02 GB). Required enabling "models write access" in W&B team settings (was restricted by default on pay-as-you-go plan). Aliases must be stripped before deletion (`v.aliases = []; v.save(); v.delete()`). `train-lora.py` now auto-cleans after each training run. Cleanup script: `python3 scripts/finetune/cleanup-wandb-storage.py --delete`.

**Ongoing:** Each training run creates ~3.7 GB of intermediate artifacts. Post-training auto-cleanup keeps it under 5 GB free tier. Train one adapter at a time. No checkpoint frequency controls exist in ART — this is server-side, not configurable. Modal is the fallback if W&B becomes untenable.

## Beat Architecture — DONE

Dramatic beats + dramatize writer + no-prescribed-dialogue rule shipped and validated (exp #173, #176). 5-novel validation (50 chapters): echo 0.35→0.20 (target met), dialogue 11.8%→17-28% (genre-dependent, target met for sci-fi/romance), first-attempt 79%→73-100% (target met). Full evidence in `docs/decisions.md` under "Beat Architecture."

**Remaining known issues (tracked elsewhere):**
- **Interiority** still near-zero (0.1-0.3/100w). Writer prompt issue, not beat architecture. Tracked under Structural Diversity.
- **Fantasy-siege low dialogue** (13.7%). Genre-specific. Tracked under Character Voice & Dialogue Phase 1.
- **Continuity location violations** from planner's chapter-level settings. Tracked under Planner Setting Coherence.

## SFT Data Distribution Shift (Beat Architecture)

All existing SFT training data was generated with screenplay-style beats (pre-exp #173/#176). Now that the pipeline uses dramatic-style beats, training data for future adapter versions should be regenerated:
- **Adherence checker** — 2,134 pairs (V4) trained on screenplay beats. V4 handles dramatic beats without retraining (validated exp #161), but V5+ should be regenerated with dramatic beat distribution.
- **Chapter plan checker** — 520 pairs (V2 dataset) trained on screenplay beats. V2 Sonnet relabeling (in progress) should use dramatic-style plans as input.
- **Continuity checker** — 253 pairs trained on screenplay beats. V2 deployed and working. V3 data generation should use dramatic-style plans.
- **Not urgent** — current adapters work. Regeneration is for the next training round of each checker.

## Adherence Checker — V4 DEPLOYED

- **V4 deployed and concluded** (exp #161, 2026-04-12) — `adherence-checker-v4` live at 512 token budget. Production eval: 79% first-attempt pass (23/30 beats), all failures resolved on retry, zero false positives. V2 config removed from `models/roles.ts` (dead — never invoked at runtime, only `adherence-events` is called). See `docs/decisions.md`.
- **GRPO/RL reward loop** (conditional, post-V4 validation) — adherence-checker is the only pipeline agent with a clean automatic reward signal (deterministic checks + synthetic labels). Design a GRPO loop on W&B/ART. Now unblocked since V4 is validated.

## Chapter Plan Checker — REVERTED to DeepSeek V3.2 base (2026-04-18)

**SFT adapter `chapter-plan-checker-v2:v1` removed from active duty 2026-04-18** after planner-phase2 pilot audit revealed ~92% false-positive rate on real fantasy plans (12-row dual-oracle audit by Sonnet + Codex gpt-5.4 — both flagged 11/12 verdicts as wrong). The adapter hallucinated a "required fact must be verbatim" failure mode not present in its system prompt; validated 96% accuracy from exp #178 did not generalize to live fantasy-genre plans. Distribution drift between training scenarios and production output. Now using DeepSeek V3.2 with the same system prompt — handles the 3-question yes/no check natively.

### Low-priority — SFT recalibration (deferred until after context engineering work)

- Don't re-open without evidence DeepSeek V3.2 is creating real friction (cost or latency budget exceeded).
- Context engineering takes precedence over local-model SFT experimentation. The whole "small model offline harness" north-star is downstream of having clean baselines and a working context-engineering layer first.
- If we revisit: regenerate training data on real harness output (not synthetic scenarios), explicitly punish "missing fact" rejections that are actually paraphrased, expand variant set beyond the original 8.
- V1 pilot (exp #154) and V2 (exp #170/#178) datasets retained for reference.

## Continuity — DEPRIORITIZED (2026-04-18)

Continuity checker is de-emphasized in the current roadmap. The context-engineering shifts (beat-level context, trimmed state feed) mean continuity no longer operates on ~7,300-token dumps — inputs are now substantially smaller, and beat-level adherence + hallucination checks subsume most of its role. `continuity-v2:v1` remains wired in `drafting.ts` as a per-chapter check but is not an optimization focus. Phase 2 (scale to 300 pairs) and Phase 3 (compact diff format) are on hold — don't re-open without evidence the checker is catching something adherence + hallucination miss.

## Tonal Pass

- **Together AI now Tier 2 hot standby** — V3 tonal-pass on Together retired (V4 on W&B preferred, pref eval 2026-04-11). All 4 adapters retraining on Together's Qwen 3.5 9B (submitted 2026-04-12) as Tier 2 fallback. Keep `TOGETHER_API_KEY`. Once training completes, verify adapter quality against W&B baselines before declaring Tier 2 ready.
- **Tonal pass expansion** — v3/v4 training data is dark-fantasy-specific (Howard corpus). Multi-genre corpus needed before tonal pass is usable as a general pipeline stage. Public domain candidates: Hemingway (pre-1929), London, Cather, Fitzgerald.

## Open Experiments (need concludeExperiment())

- **Exp #154** (chapter-plan-checker-v1) — superseded by V2. Conclude with note: "V1 pilot on gpt-oss labels superseded by chapter-plan-checker-v2 (Sonnet labels, 96% accuracy, exp #170/#178). V1 not evaluated."
- **Exp #155** (continuity-v1) — superseded by V2. Conclude with note: "V1 pilot superseded by continuity-v2 (253 pairs, 99% Sonnet accuracy, exp #175). V1 not evaluated."
- **Exp #159** (adherence-v3-sonnet) — partial eval done (character 61% regression documented). Conclude with notes.

## Fine-Tuning (Other)

### Small-model local checker POC (NEW 2026-04-18)

Research question: can we distill the current 14B checkers down to 2B or 4B bases and run them locally on Apple Silicon, with accuracy within 2-3 points of the 14B baseline? Motivation is NOT cost (savings are trivial) — it's serving independence (no W&B dependency), latency floor (50-100ms warm on MLX vs 200-600ms W&B), and headroom to run multiple checkers co-resident on 24GB RAM.

**Infrastructure reality (confirmed 2026-04-18 from ART docs):**

| Path | Supports 2B/4B? | Notes |
|---|---|---|
| **W&B ServerlessBackend (zero-ops)** | **No** | ART-on-W&B serverless supports only `OpenPipe/Qwen3-14B-Instruct` and `Qwen3-30B-A3B-Instruct`. Anything smaller requires LocalBackend. |
| **W&B deploy_wandb() (for inference hosting)** | **No** | Separate whitelist of 4 models: Llama-3.1-{8B,70B}, Qwen3-14B, Qwen2.5-14B. |
| **ART LocalBackend** (requires user-supplied GPUs) | **Yes** | Explicitly supports Llama-3.2-{1B,3B}, Qwen2.5-7B, plus "Qwen3 family" with vLLM (likely Qwen3-1.7B). |

**Split-path POC is viable but training runs outside W&B Serverless:**
- **Training** — ART LocalBackend on **Modal** (A100 on-demand, ~$1-3/run) or rented GPU. Can use Llama-3.2-1B, Llama-3.2-3B, or Qwen3-1.7B-Instruct. Gemma-2-2B, Phi-3.5-mini, Phi-4-mini not explicitly listed — Discord/support confirmation needed before commitment.
- **Serving** — MLX on Apple Silicon locally. Skip W&B Inference entirely; it can't host a LoRA on any sub-8B base anyway. Ollama as operational fallback.

- [ ] **2B POC — adherence-events first**. Target base: `Qwen3-1.7B-Instruct` or `Gemma-2-2B`. Task: closed binary classification, 2,134 existing training pairs + 3,000 synthetic extension via Cerebras 235B. Train on Modal/Unsloth, serve on MLX, eval head-to-head vs `adherence-checker-v4` using the `eval_results` checker columns. **Decision gate:** accuracy within 2 points AND JSON validity ≥99% → ship as a local-inference candidate in parallel with W&B (not replacement).
- [ ] **4B POC — same task, bigger base for cross-hop reasoning**. Target base: `microsoft/Phi-3.5-mini` (3.8B) or `microsoft/Phi-4-mini-instruct` (3.8B, also served by W&B Inference so head-to-head is easier). Run after 2B result is known.
- [ ] **Grammar-constrained decoding** — hidden risk: smaller models fail JSON schema more often. MLX supports grammar constraints; budget for either that or a lightweight retry-on-malformed parser. Spike before committing to small-model serving path.
- [ ] **Local-inference harness integration** — `src/transport.ts` needs a `local` provider talking to MLX/Ollama. Already logged as Tier 4 evaluation elsewhere; small-model POC unblocks it.
- [ ] **Hallucination on 2B — second POC target after adherence**. Distill hallucination-checker-v2 (once v2 ships). NER + grounding is a classic distillation target and the 2B attempt is cheap (~$15-30 all-in).

Skip continuity for this experiment — it's deprioritized (see Continuity section) and the long-context task is the least favorable shape for a 2B base anyway.

### Other

- **Beat writer SFT** (opportunistic, high risk) — 7.8× cost reduction if it works. Shadow-run in parallel with 235B. Validation bar: adherence rate ≥ 235B baseline, lint counts ≤ baseline, 2 full novels without regression. Blocked until structural diversity in the training corpus is addressed.

## Planner Setting Coherence

- **Beat specs assign wrong settings when scenes cross locations** — production data (563 adherence-setting calls, 24 flags = 4.3%) shows the planner assigns a chapter-level setting to all beats even when the narrative naturally transitions mid-chapter (e.g., "Drowned Row Gym" assigned but prose correctly moves to "Statless Hideout"). This is a planner-level bug, not a writer-level bug. The beat writer can't fix it by rewriting.
  - **Investigation**: query `llm_calls` for adherence-setting flags, cross-reference with chapter outlines to identify which planning patterns produce stale settings on mid/late beats.
  - **Fix options**: (1) planner outputs per-beat settings instead of chapter-level; (2) post-plan validation that checks beat descriptions against their assigned settings for location transitions; (3) beat context assembly detects setting shifts from prior beat prose and overrides the stale plan setting.
  - **Chapter plan checker already has `setting_match`** — once beat-level setting checks are removed (done), the chapter plan checker is the only remaining setting gate. Consider whether it should validate setting coherence *across* beats rather than per-beat.

## Pipeline Tuning

- **Word count below target** — 550–770w vs 800–1100w target. Measure pre- vs post-tonal-pass word counts to isolate cause (model, prompt, beat granularity, or tonal pass shortening).
- **Re-evaluate lint system role** — if tonal pass LoRA already reduces AI clichés, lint becomes a safety net rather than a pipeline stage. Test: run lint on tonal-pass outputs vs base outputs.
- **Strip anti-pattern list from rewriter prompt** — rewriter can't self-police clichés (proven). Lint + tonal pass handles this.
- **Skip re-extraction for prose-only rewrites** — if a rewrite fixes only cosmetic issues, extraction results remain valid.

## Structural Diversity — PARTIALLY ADDRESSED

- **Structural priors deployed (2026-04-17)** — planner now receives beat-type distribution targets + cluster-sustain rules + opener/closer patterns + scene-size guidance for fantasy genres via `StructuralPriors` config in genre packs. Salvatore-derived targets: 35% action / 30% dialogue / 20% interiority / 15% description.
- **Beat-kind labeling added** — planner now emits `kind` per beat (action/dialogue/interiority/description). Writer sees `Kind: X` in beat spec header.
- **Monitoring:** compare pipeline output structure against `docs/salvatore-structural-analysis.md` baseline after the current re-run. Track improvement via `scripts/analysis/beat-sequence-analysis.py` on new novels.

## Seeds & Data Diversity

- **Run 10–15 novels across new seeds** — 30 seeds created (2026-04-09): 8 post-apoc, 7 sci-fi, 7 epic fantasy, 4 portal fantasy, plus 6 originals. All 131 approved chapters come from only 5 premises. Chapter-plan-checker and continuity SFT need plan/world-state diversity synthetic generation can't provide.

## Character Voice & Dialogue

### Phase 1 — Context engineering (no training required, build now)
- **Structured `SpeechProfile` schema** — replace the free-text `speechPattern` field in character snapshots with concrete attributes: `register`, `sentenceLength`, `vocabulary[]`, `forbiddenPhrases[]`, `syntacticPatterns[]`, `emotionalExpression`. Render in beat context as a structured block with 2–3 example lines, not attribute lists. Q14B follows examples far better than abstract descriptions.
- **Forbidden phrase lint (character-scoped)** — extend the deterministic lint layer to flag per-character `forbiddenPhrases` in dialogue. Same mechanism as existing cliché patterns, scoped by character name. Zero model cost.
- **Planner dialogue quantity guidance** — add explicit dialogue beat targets to the planning-plotter prompt. At least 2 of 4–6 scene beats should be primarily dialogue-driven. Current output: 15.7% dialogue vs 25–50% published norm. Measure with `scripts/analysis/analyze-structure.ts` before and after.

### Phase 2 — Archetype library (no training required)
- **15–20 named archetypes** with structured speech profiles and 3–5 canonical example dialogue lines each. Map every generated character to an archetype at concept time; beat context gets examples automatically. Target archetypes: `stoic_warrior`, `scheming_noble`, `earnest_apprentice`, `reluctant_hero`, `cynical_mentor`, `naive_innocent`, `calculating_villain`, `world_weary_professional`, `hot_tempered_youth`, `diplomatic_deceiver`, `hard_boiled_detective`, `theatrical_authority`.

### Salvatore voice LoRA — multi-character distinctness options (2026-04-17)

**Context:** Current Salvatore v3 trains on 777 beats from the Icewind Dale Trilogy only. It produces excellent Salvatore cadence but multi-character voice discrimination is limited because the training corpus is narrow. Below are options ordered roughly by cost; the diagnostic question is whether multi-character voice is corpus-limited (fixable cheap) or model-capacity-limited (needs 70B).

- [ ] **Option A — Expand Salvatore corpus to full bibliography.** Current v3: 777 beats, one arc, Drizzt/Wulfgar/Bruenor dominant. Salvatore has 30+ novels with radically distinct voices already in-corpus (Jarlaxle's theatrical charm, Zaknafein's clipped menace, Cattie-brie's rural warmth). Ingest 3–5 more books → ~3000+ beats → retrain same 14B. Cost: ~$5–10 on W&B + ~1 day corpus-ingestion work via `scripts/finetune/ingest-corpus.py`. Risk: minimal — Salvatore's voice is consistent across his career. Expected effect: same voice, meaningfully better multi-character discrimination because the LoRA has now seen examples of him ventriloquizing many characters.
- [ ] **Option B — Archetype-tagged training (prefix conditioning) on the expanded corpus.** Re-label each beat in the expanded corpus with an explicit archetype tag in the user prompt (`ARCHETYPE: STOIC_WARRIOR | FERAL_ROGUE | COLD_NOBLE | GRUFF_MENTOR | …`, ~8–12 total). Planner maps each POV character to the closest archetype; the tag injects into beat-writer context. Single LoRA, single call, but archetype-conditioned output. Cost: ~$10–15 training + ~2 days of labeling (Sonnet labels the corpus, human spot-checks). Risk: mushy archetype boundaries — if labeling quality is low, the model won't learn to switch cleanly. Works cleanly with the existing 3-char/beat cap (≤2 dominant archetypes per beat keeps per-class signal strong).
- [ ] **Option C — Jump base model to 70B.** Train a LoRA on Qwen2.5-72B-Instruct or Llama-3.3-70B with same corpus (or expanded). More attention heads + better instruction-following → stronger character discrimination even from the same training signal. Keeps Salvatore voice because the LoRA targets Salvatore data. Cost: ~$50–150 training + 2–4× inference cost **per beat forever** (permanent economics tax, not a one-time fix). Risk: overkill if the real issue is training-data breadth, not base-model capacity. Only worth pursuing if (A) and (B) plateau.
- [ ] **Option D — Stacked path: do (A) first, add (B) if needed, hold (C) in reserve.** Train Salvatore v5 on the expanded corpus as a baseline measurement. If v5 alone materially improves multi-character distinctness on evals, we're done cheap. If v5 plateaus, add archetype tags for v6. Only escalate to 70B if v6 still can't discriminate.

**Recommendation:** start (A). Lowest cost, lowest risk, likeliest single-variable fix. The 14B should be able to ventriloquize multiple voices if it's seen enough varied training examples — and it hasn't, really.

### Deep-authoring mode — human-in-the-loop world + planning layer (2026-04-17)

**Intent:** A separate UX track from the seed-driven harness-validation flow. The harness mode runs 8 seeds in parallel unattended for capability testing. Deep-authoring mode is for novels the user actually cares about, where upfront world-building and character commitment matter more than throughput.

**Scope clarification (2026-04-17):** This is a world/planning exercise, not a different writer. Salvatore voice LoRA stays. Howard-style tonal passes are NOT revived (they under-performed vs generation-time voice). The extra value comes from feeding the planner + beat-writer *richer committed material* that the user has explicitly shaped, rather than LLM extrapolation from a premise.

- [ ] **Specialized conversational chats in sequence:** (1) per-character deep-dive chat for each major character (protagonist + antagonist + 1-2 supporting) building structured `SpeechProfile` + behavioral drivers + relationship nuance, (2) world/magic-system chat committing rules and constraints, (3) plot-spine chat shaping the arc. Each stage's structured output feeds the next as context, so planner lands with fully-committed material.
- [ ] **Archetype-mapping at character-chat conclusion:** once the character is defined, map to nearest archetype (from Phase 2 archetype library above) for beat-writer voice routing. This is how deep-authoring mode and the voice LoRA stay coupled.
- [ ] **UX trade-off:** deep-authoring is 45–90 min of human time per novel before generation starts. Not appropriate for harness validation, essential for commercial-quality output. Both paths coexist — pick at Studio entry.
- [ ] **Context-engineering question (open):** how to elegantly pass the richer per-character material into the beat-writer without blowing out the LoRA's trained attention scope (~1500 input tokens). Likely answer: structured `SpeechProfile` + 2-3 canonical example lines per POV character, not prose paragraphs. The 3-char/beat cap keeps the context compact even for dense scenes.

### Phase 2 data — Dialogue pattern ingestion (feeds Phase 3)
- **Archetype pattern research + synthetic generation** — study modern fiction freely to extract archetype speech patterns (what a `stoic_warrior` or `scheming_noble` sounds like is a pattern, not a copyrightable expression). Use 235B to generate synthetic training pairs from those patterns: `(flat_dialogue + archetype_profile) → (voiced_dialogue)`. Do not use verbatim copyrighted dialogue lines as training targets — extract the pattern, generate the examples. Modern genre fiction is more relevant than public domain for the seeds the pipeline targets (post-apoc, sci-fi, fantasy). Target: 400–500 pairs across 10–12 archetypes. ~$3–5 at 235B rates.

### Phase 3 — Voice-pass LoRA (after Phase 1+2 in production)
- **Beats-compatible voice-pass adapter** on W&B Qwen3-14B. Beat-writer generates voice-agnostic prose; voice-pass rewrites dialogue-only paragraphs conditioned on the character's `SpeechProfile`. Training format: `[system: voice-pass] [user: CHARACTER_PROFILE: {...} DIALOGUE: "..." CONTEXT: "..."] [assistant: "voiced dialogue"]`. Train `voice-pass-archetype-v1` once 400+ pairs assembled from the ingestion pipeline above. Blocked on Phase 1 infrastructure.

### Future — Character voice checker (blocked on Phase 1)
- Per-beat classifier checking whether dialogue matches the character's `SpeechProfile`. Train from `(dialogue_line, speech_profile, matches: bool)` once voice-pass infrastructure generates labeled examples naturally.

## Studio

- **Chat-driven creation flow** — Studio was rebuilt as a pipeline-first interface (compact creation bar + inline pipeline view with narrative activity feed, 2026-04-11). Next step: replace the form-based seed input with a conversational chat interface where an LLM (Cerebras Qwen 235B) shapes user input into `CustomSeed` format, asks for confirmation, then kicks off the pipeline.

### Chat-based Planning Control (three intervention points)

The chat UI is a reusable shell; the question is *where in the pipeline* it plugs in. Ship #1 first (additive, no schema changes), add #2 once the UX is proven, defer #3 until gates are ready.

#### Option 1 — Pre-planning directives — SHIPPED 2026-04-14
- Two-agent split: `planning-conversationalist` (Groq Qwen3-32B, guided 8-phase Q&A with sparsity detection) + `planning-extractor` (Cerebras Qwen 235B, one-shot compile of transcript → `PlanningDirectives`).
- Directives live on the seed (`SeedInput.directives`), persisted via `seed_json` — no new table.
- Injected into concept phase (world-builder, character-agent, plotter) via `renderDirectivesForConcept()` and into the planner via `renderDirectivesForPlanner()` (includes required beats).
- UI: `DirectorChat.tsx` two-pane (transcript + live directives chips). Endpoints `POST /api/novel/director/chat` (plain text) and `POST /api/novel/director/compile` (structured).
- **Next**: chip-edit (inline quick edit + AI-modify scoped call), validate guided flow produces well-formed directives on 2–3 real runs.

#### Option 2 — Post-planning editing
- **Where it plugs in**: after `runPlanningPhase()` produces chapter outlines, before `presentForApproval()` transitions to drafting. New "Edit Plan" gate in the Studio pipeline view.
- **Model**: chat agent emits a structured diff against the `chapter_outlines` rows — add/remove/edit beat, swap POV, re-order beats, change chapter-level setting. Diffs are applied transactionally; a plain regeneration of affected chapters is the fallback when the diff is ambiguous.
- **Requires**:
  - Diff schema covering beat/outline mutations (new Zod schema in `src/schemas/`)
  - Apply layer in `src/harness/novels.ts` that mutates `chapter_outlines` + keeps `planned_state` consistent (character state / knowledge changes may need recomputation)
  - UI: plan tree on the left, chat on the right, pending-diff preview at the bottom with Apply/Discard
  - Re-runs of the `chapter-plan-checker` after each apply so the user sees whether edits broke cross-beat coherence
- **Risk**: medium. Edits to `chapter_outlines` after approval can desync `planned_state` tables. Needs careful transaction boundaries.

#### Option 3 — Mid-run steering
- **Where it plugs in**: at every existing gate (`src/gates.ts`) and optionally at custom breakpoints (end of chapter, before tonal pass). Steering message is injected into the *next* agent's context.
- **Requires**:
  - Gate extension: `presentForApproval` returns `{ decision, steeringMessage? }` instead of just decision
  - Per-phase context hooks that accept an optional steering blob and render it into the agent prompt
  - SSE event types for "gate:chat-open" / "gate:chat-message" so the UI can slide in a chat panel when the pipeline pauses
  - Transcript persisted per gate event for audit / daemon training data
- **Risk**: high. Every agent site that calls `callAgent` needs to accept/route steering. Steering can contradict already-persisted `planned_state`, so drafting-phase steering may need partial plan invalidation. Defer until #1 and #2 have validated the chat UX.

## Autonomous Improvement Loop (post-daemon)

Old `Improvement Daemon` deleted. Replacement in progress on the
`autonomous-harness-loop` branch. See `docs/designs/autonomous-context-loop.md`
(revision 2, Codex-reviewed) and `docs/harness-optimization-inventory.md`
(revision 2, Codex-amended). Phase 0 gating work tracked in
`scripts/autonomous-loop/README.md` "Prerequisites" section:

- Migrate 4 env-var writer overrides to `seed.pipelineOverrides.*`
- Build the calibration-substrate drift detector
- Run Codex's cheapest-counterfactual: 5-chapter planner-only A/B
- Build held-out 10-beat replay set on a second novel

## Local Apple Silicon Inference (Tier 4 Evaluation)

Evaluate running LoRA adapters locally on MacBook Air M4 24GB instead of W&B.

**Cost savings are minimal** (~$3/year) — adapter calls are already ~$0.004/novel on W&B. The value is zero provider dependency and unlimited experimentation at zero marginal cost.

**Evaluation steps:**
1. Install MLX or Ollama, download Qwen 3.5 9B Q4/Q8
2. Convert Together-trained LoRA adapters (SafeTensors) to MLX format
3. Run all 4 adapters on quantized local base and compare accuracy to W&B (FP16 base) — adherence, chapter-plan, continuity, tonal
4. If quality holds: register as `local` provider in `models/registry.ts`, add transport support for local endpoint
5. Benchmark latency on real pipeline calls (expect ~3-10s/call vs 157-609ms W&B)
6. Test Mac Mini 16GB with 9B Q4 under sustained load (memory pressure risk)

**Together AI training (2026-04-12):** All 4 adapters submitted for LoRA training on `Qwen/Qwen3.5-9B` (r=16, alpha=32). Check status: `ssh novel-harness-lxc "cd ~/apps/novel-harness && python3 scripts/train-together.py --status"`. Once complete, these adapters can serve double duty — Together Tier 2 inference AND local Tier 4 inference (same SafeTensors format).

**GPU rental benchmarked (2026-04-12):** Per-second analysis against 20 real novels. GPU rental is 3-5x more expensive than current API setup. Break-even requires ~530 novels/day. Viable for batch jobs (SFT data gen, eval sweeps) but not per-novel pipeline. Full report: `docs/gpu-rental-analysis.md`.

## Infrastructure

### Adapter registry (HIGH PRIORITY 2026-04-18 — schema + seed + CLI SHIPPED)

**The gap (closed by `sql/027`):** previously `tuning_experiments`, `experiment_lineage`, `eval_briefs`, `eval_results` existed but no single row-per-adapter table. "What's deployed and how was it built" required grepping `src/models/roles.ts` + `docs/adapter-changelog.md` + joining tuning_experiments manually.

- [x] **New table `adapter_registry`** via `sql/027_adapter_registry.sql` — applied on LXC 2026-04-18. Columns: uri (PK), name, slot, base_model, training_experiment_id → tuning_experiments, eval_experiment_ids INT[], status (deployed|candidate|retired|rejected), deployed_at, retired_at, headline_metrics JSONB, training_data_path, training_data_sha256, supersedes (self-FK for lineage), notes.
- [x] **Seeded** with 8 adapters via `scripts/finetune/seed-adapter-registry.ts`: 5 deployed (adherence-v4, chapter-plan-v2, continuity-v2, salvatore-v4, howard-tonal-v4), 1 candidate (hallucination-v1), 1 retired (salvatore-v3), 1 rejected (archetype-poc-v1).
- [x] **CLI `bun scripts/finetune/adapter-status.ts`** — prints slate grouped by status with headline metrics; `--deployed` and `--slot <name>` filters.
- [ ] Cross-reference from `src/models/roles.ts`: every W&B adapter URI in roles must exist in `adapter_registry` with `status='deployed'`. Add a startup assertion that reads the registry and validates roles.ts against it.
- [ ] UI: `/app/finetune` currently renders a static adapter table — make it query `adapter_registry` instead.
- [ ] **Registry update hooks** — when `train-lora.py` completes, insert a `candidate` row automatically. When `concludeExperiment()` fires on a checker-eval experiment, patch `headline_metrics` on the referenced adapter. Avoids manual reseeding as new adapters land.

### Experiment-lineage hardening (complements the registry)

- [ ] **Training-data SHA256 in `tuning_experiments.config`** (2026-04-16) — add `train_file_sha256` and `val_file_sha256` fields at submission time. Finetune files on LXC (`finetune-data/*.jsonl`) can be overwritten across runs; without a content hash the `config.train_file` path becomes a dead reference once the file changes. Cheap to compute at `train-lora.py` submission time. Enables "exactly what bytes produced this adapter" verification via `sha256sum` against the file on disk or an archived copy. Back-patch existing experiments by computing hashes from current on-disk files and noting drift.
- [ ] **Formatter-pipeline provenance in `tuning_experiments.config`** (2026-04-16) — add a `formatter` section recording `{script, script_commit, args, input_corpus_file, input_corpus_sha256, output_file, generated_at}`. Right now `config.train_file` points at the output but we can't tell *what produced it* without grepping git log around `commit_hash`. With this field, `bun scripts/finetune/provenance-report.ts` can print the full chain: corpus → formatter script → formatter args → training file → adapter. Back-patch v1/v2/v3/v4/v5 experiments manually with the correct formatter references.
- [ ] **Actively use `experiment_lineage`** — link v2 training experiments to their v1 parent at `createTuningExperiment` time. Currently the table exists but is rarely populated. A simple `linkExperiment(newId, parentId, "supersedes")` call in training-submission scripts.
- [ ] **Backfill checker eval rows** — `adherence-checker-v4`, `chapter-plan-checker-v2:v1`, `continuity-v2:v1` have headline accuracy numbers in docs but no rows in `eval_results`. Re-run their evals under the new `sql/026_checker_eval_columns.sql` schema so the whole slate is queryable from one place.

### Other infra

- **Extend LLM call inspector tags** — `chapter` / `beat_index` / `attempt` populated for beat-writer and adherence-checker. Need to thread through reference-resolver, continuity, chapter-plan-checker, rewriter, and planner. Columns already exist; each agent's `callAgent` site needs the tags. See `docs/llm-call-inspector.md`.

## Pipeline Stability

- **Deduplicate timeline events** — rewrite re-extractions create duplicate timeline events in DB.
- **Clean up stale DB data** — incomplete novels, orphan benchmark runs, experiments without conclusions.

### Character-name normalization in planner + beat writer — LOW PRIORITY (2026-04-18)

Not blocking anything in production today. Logged because the Stage 1 hallucination-authoring bug (scenarios carrying titled keys like `"Lord Halvern Drayce"` that broke naive first/last splitters) has a shape that could recur any time production-pipeline code starts caring about "first name" vs "surname" — e.g. a future voice adapter keyed on surname, a dialogue-attribution lint pattern, a character-knowledge graph query. For now the hallucination-checker rubric already handles title+grounded-surname cleanly via the rubric itself, and the Stage 2 generator uses a local title allowlist.

When this becomes load-bearing:
- [ ] Split title from personal name in `CharacterProfile` — `title?: string` + `firstName: string` + `lastName: string`; display form reconstructs to `"Captain Voss Marin"`.
- [ ] Planner schema + instructions to emit structured name fields instead of a single titled string.
- [ ] Beat-writer context renders display form but exposes canonical `firstName lastName` as grounded lookup key.
- [ ] Centralize the title allowlist in `src/lib/name-normalizer.ts` so training-data generation and production code share one source of truth. Reference audit at `scripts/hallucination/audit-speaker-names.ts`.

## Future

- **Worldbuilding Workbench** (separate project) — interactive chat frontend backed by the knowledge graph. Author converses with their world, modifies plotlines, generates beats, adjusts world state. Output is a structured plan that feeds the harness. Same Postgres tables, different interface. Entirely separate from the prose generation pipeline.
