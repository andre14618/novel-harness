---
status: draft
updated: 2026-04-19
codex-verdict: CHANGE (review thread a9032a2688ef3882e — corrections applied inline below)
---

# Next-session implementation plan

Follow-up work after the exhaustion-handler session (Codex final verdict `a252aecbb785a0eb3`: conditional pass, 78% confidence). Plan for Codex review before execution.

**Codex ship/change verdict: CHANGE (see review thread a9032a2688ef3882e). Corrections applied below.**

## Open items (from docs/todo.md + session findings)

1. **Full restart recovery for plan-assist gates + `revisionUsed`** (flagged by Codex `a252aecbb785a0eb3`; corroborated by session anomaly on `novel-1776616563937` showing 2 non-skip reviser invocations when an orchestrator restart reset the in-memory flag).
2. **V2 transport interceptor — Phase 1** (full spec at `docs/debug-injection-v2-spec.md`, ready for implementation).
3. **R3/R4 test-harness race fixes** (architecture passed per DB; test assertions polled too fast).
4. **Clean no-forced-flags validation run** (every scripted test today used `DEBUG_FORCE_*`; verify handlers stay quiet in the organic case).
5. **`src/invariants/debug.ts`** (Codex `ae23f96a5f5cf8247` — narrow, test-only invariants behind DEBUG flag).
6. **Historical-superseded doc pass continuation** (already half-done in commit `522b74d`; check for remaining drift).
7. **Kill-orphan cleanup script** (todo.md note — stale test novels clutter DB).

## Proposed implementation structure

### Tier 1 — HIGH priority, ship next session

#### 1a. `revisionUsed` persistence + gate reconciliation on restart

**Problem:** `revisionUsed` lives as a local `let` in `runDraftingPhase()` (`src/phases/drafting.ts:164`). On process restart mid-run, a resumed novel can fire a second reviser for the same chapter because the flag resets. Same class of bug as the plan-assist-gate in-memory map.

**Why `chapter_outlines`, not `chapter_revisions`:** `chapter_revisions` is post-call telemetry — not a pre-call guard. `revisionUsed` must flip BEFORE the reviser call, but `logRevision` runs AFTER. A restart mid-reviser-call would leave no telemetry row to read, so using it as a guard would fail to block a duplicate invocation. `chapter_outlines.revision_used` is the canonical pre-call guard: one row per chapter, cheap lookup, correct timing. `chapter_exhaustions` is also post-event and unsuitable for the same reason.

**Proposed shape:**
- New DB column `chapter_outlines.revision_used BOOLEAN NOT NULL DEFAULT FALSE`. Mirror of `plan_check_overridden`.
- Two new helpers in `src/db/outlines.ts`: `isRevisionUsed(novelId, chapterNum)`, `setRevisionUsed(novelId, chapterNum, value)`.
- In `drafting.ts`: replace `let revisionUsed = false` with `let revisionUsed = await isRevisionUsed(novelId, ch)` at the start of each chapter. After setting `revisionUsed = true` in the reviser branches, also call `await setRevisionUsed(novelId, ch, true)`.
- Migration `sql/031_chapter_outlines_revision_used.sql`.
- **Update `src/db/migrate-path.test.ts`** when the new migration lands — the test enumerates expected migration files and will fail on new sql/* additions without an explicit update.

**Full gate reconciliation on restart (deeper piece):** when the orchestrator boots AND a novel resumes, if `chapter_exhaustions` has a pending row for the current chapter, we need to either (a) re-fire the gate so the UI can still resolve it, or (b) auto-mark it orphaned and let the drafting loop re-enter the exhaustion check, which will re-fire naturally. **Option (b) is simpler and already partly works** via the MVP orphan-detection shipped in `13f8143` — the startup sweep logs pending rows; the `mark-orphaned` endpoint can close them out. The drafting loop re-entry on resume already re-fires the gate because `revisionUsed` is (after this fix) persisted and correctly drives the skip path.

**Verification:** fresh unit test `src/phases/drafting-revision-used-persistence.test.ts` that mocks DB + drafting flow to confirm resumed chapter sees `revisionUsed=true` and takes the skip path.

**Subagent scope:** one Sonnet subagent, ~60 min.

#### 1b. R3/R4 test-harness race fixes

**Problem:** R3 asserts `chapter_outlines.outline_json->scenes` length too quickly after POST; the drafting-loop `await saveChapterOutline(...)` hasn't landed when the test queries. R4's gate sometimes doesn't appear because of auto-approver + DeepSeek timing interaction.

**Proposed shape:**
- R3: add a post-POST waiter that polls `/state` until `chapter_outlines` scene count matches the submitted outline, with a 30s timeout. Or: subscribe to SSE for `trace:plan-assist-resolve` + a follow-up `chapter-complete` or next `debug-inject` event to confirm drafting loop advanced past the save.
- R4: add a heartbeat-aware check in `startApprovalGateAutoApprover` so the auto-approver doesn't drop events when concept-phase DeepSeek runs long. Surface auto-approve errors to console, not silently.

**Subagent scope:** one Sonnet subagent, ~30 min.

### Tier 2 — MEDIUM priority

#### 2. V2 transport interceptor — Phase 1 (alongside V1)

Per `docs/debug-injection-v2-spec.md`. Key implementation chunks:
- New files: `src/debug/injection-types.ts`, `src/debug/injection-store.ts`, `src/debug/transport-interceptor.ts`.
- `LLMRequest` enriched with optional `debugContext: DebugContext`.
- `DirectTransport.execute()` evaluates rules before each fetch.
- HTTP endpoints in `novel-routes.ts` gated on `DEBUG_ENABLE_INJECTION`.

**Phase 1 does NOT:**
- Replace V1 env flags (both coexist).
- Handle `validateChapterDraft()` (local function; V1 seam stays).
- Touch chapter_revisions / chapter_exhaustions telemetry.

**Subagent scope:** one Sonnet subagent, ~90 min. Higher risk than tier 1 — use `isolation: "worktree"` to keep main clean if something breaks.

#### 3. Clean no-forced-flags validation run

**Problem:** every test today used `DEBUG_FORCE_*`. We haven't proven the exhaustion handlers stay QUIET under normal conditions.

**Proposed shape:**
- Create one test novel with a normal seed (`fantasy-healer` or similar from `src/seeds/`), mode=auto, no DEBUG_FORCE env.
- Expect: novel completes all chapters OR halts on a genuine exhaustion cause (not a forced one). Run to completion or abort at reasonable time budget.
- **Corrected assertion shape (Codex a9032a2688ef3882e):** The original "assert zero plan-check-exhausted rows WHERE plan-check passed" is vacuous — the gate only fires when the check fails, so there are never exhaustion rows where the check actually passed. Correct shape:
  - For non-validation exhaustions: assert that every `chapter_exhaustions` row corresponds to a genuinely failing final `plan-check-outcome` trace entry.
  - **Stronger success condition for a truly clean organic run:** zero `chapter_exhaustions` rows AND no `PipelineBailError` in the logs.
- **Pre-req: add final post-settle `validation-check` trace event in `drafting.ts`** (new subtask). `drafting.ts` currently traces the INITIAL validation result but not the final post-settle validation state. For validation-path false-fire proof, a `validation-check` trace is needed at the post-settle point. Without it, Tier 2.3 has weaker proof for validation-path exhaustions than for plan-check-path exhaustions.
- This is an integration test, not a unit test. Could be a script (`scripts/test/organic-run-verify.ts`) that creates + waits for completion + queries DB.

**Subagent scope:** small (~30 min), BUT runs for ~20-40 min wall-clock because the novel actually drafts. Also blocks on the post-settle trace pre-req if validation proof is required.

### Tier 3 — LOW priority, can defer further

#### 4. `src/invariants/debug.ts`

Behind `DEBUG_INVARIANTS=true` env flag, runtime assertions like:
- "If `DEBUG_FORCE_PLAN_CHECK=fail` is active, every `chapter-plan-checker` `out` must have `pass=false`."
- "Across one chapter's drafting lifetime, at most one `chapter_revisions` row can have non-skip outcome."

These are test-surface assertions that would have caught the seam gaps (`fed9e4a`, `4ad2413`) earlier. Defer until V2 transport interceptor ships because they overlap in coverage.

#### 5. Historical-superseded doc pass continuation

Check the 6 files touched in `522b74d` for any remaining drift. Small, cosmetic.

#### 6. Kill-orphan cleanup script

`bun scripts/cleanup-orphans.ts [--dry-run]` — delete test novels older than N hours with zero approved chapters. Separate from plan-assist gate orphan detection (different concern: DB clutter vs runtime state).

## Dependencies & sequencing

- **1a is prerequisite for the clean validation run (3)** — without `revisionUsed` persistence, any mid-run restart in the organic test would produce the same hard-cap violation we already saw.
- **2 is independent of 1** — can land in parallel.
- **1b is independent of everything** — test-side only.
- **4/5/6 are all independent + low-risk**.

## Parallelizable subagent launch plan

Ship in 2 rounds:

**Round A (parallel):**
- Subagent A1: Tier 1a — revisionUsed persistence + restart recovery. Explicit files: `sql/031_chapter_outlines_revision_used.sql`, `src/db/outlines.ts`, `src/phases/drafting.ts`, `src/phases/drafting-revision-used-persistence.test.ts`, **`src/db/migrate-path.test.ts`** (required — test enumerates migration files and will fail without it).
- Subagent A2: Tier 1b — R3/R4 test-harness race fixes. Primary files: `scripts/test/exhaustion-web-campaign.ts`. Note: R3/R4 fix MAY spill into `scripts/test/lib/sse-watcher.ts` if the race fix requires watcher-side changes. If so, coordinate the scope — or restrict R3/R4 fixes strictly to `scripts/test/exhaustion-web-campaign.ts` only to avoid conflicts.
- Subagent A3: Tier 3 kill-orphan cleanup script (safe, small). See "Missing items" note about orphan telemetry cascade.

**Codex review after Round A**, then Round B (parallel):
- Subagent B1: Tier 2 V2 transport interceptor Phase 1 (worktree isolation)
- Subagent B2: Tier 2 clean no-forced-flags validation run script
- Subagent B3 (optional): Tier 3 historical-superseded doc pass continuation

**Codex final review after Round B.** Tier 3.4 (`invariants/debug.ts`) deferred until V2 is proven.

## Questions for Codex before launching

1. **Is Tier 1a's plan sound?** Specifically: is `chapter_outlines.revision_used` the right storage, or should we use `chapter_exhaustions` (which already tracks reviser attempts)? Weigh the trade-off.

   **RESOLVED (Codex a9032a2688ef3882e):** `chapter_outlines.revision_used` confirmed correct. Rationale added to Tier 1a above.

2. **For the "anomaly" from novel-1776616563937** (2 non-skip reviser invocations) — is this ACTUALLY explained by the restart-reset hypothesis, or is there something else in `drafting.ts` that could cause the flag to reset within a single process lifetime? Dig into the code if needed.

   **RESOLVED (Codex a9032a2688ef3882e):** Confirmed — no in-process reset path exists. `revisionUsed` is declared once before the attempt loop at line ~164 and only ever assigned `true` in the plan-check reviser branch and validation reviser branch. Restart-reset is the sole explanation. Tier 1a's persistence fix closes this class entirely.

3. **Is Phase 1 of V2 safe to ship alongside V1** (both active)? Or should we require at least one item of V1→V2 equivalence to be demonstrated before Phase 1 lands?

4. **Clean validation run (Tier 2.3)** — is there a risk that a real novel fires a legitimate exhaustion gate that we mistake for a false positive? How should the test distinguish "genuine exhaustion that should fire" from "false positive we need to catch"?

5. **Any Tier 2/3 item you'd reorder or drop?** E.g., are there tier-2 items that are actually riskier than the V2 transport interceptor?

6. **Subagent parallelization:** any of the files A1/A2/A3 touch that would conflict? Flag now so we can split correctly.

## Missing items (Codex a9032a2688ef3882e)

Gaps surfaced during Codex review not covered in the original plan:

1. **`src/db/migrate-path.test.ts` update when adding sql/031** — already folded into Tier 1a's file list above. Restated here for visibility: this test enumerates expected migration files; it WILL fail on any new `sql/` addition without an explicit update.

2. **Orphan-novel cleanup cascade for telemetry tables** — `chapter_revisions` and `chapter_exhaustions` have no FK back to `novels`; deleting a novel leaves orphan telemetry rows. The kill-orphan script (Tier 3.6) must handle this explicitly: either cascade-delete by `novel_id` when removing the novel, or leave a documented note that telemetry is intentionally retained for historical analysis even after novel deletion.

3. **Final post-settle validation telemetry** — `drafting.ts` traces the initial validation result but not the final post-settle state. Needed to distinguish validation-path false-fires from genuine exhaustions in Tier 2.3. Covered in Tier 2.3 above; restated here for visibility.

4. **Exhaustion-report as scheduled job** — the current exhaustion anomaly report is ad hoc (manual query or one-off script). Could run nightly and surface anomalies in a summary file or ntfy alert. Worth a tier-3 item in a future session.

5. **Dedicated `/app/exhaustions` cross-novel UI** — `ExhaustionsPanel` exists embedded in `PipelineView.tsx` but there is no top-level route for operators to scan all novels' exhaustion state at once. Worth adding as a tier-3 item (a simple table view wired to `/api/exhaustions` or similar).

## Non-goals for next session

- NOT fixing the "stored-as-string jsonb" pattern on `chapter_exhaustions.decision_details` / `chapter_revisions.outline_before|after` — pre-existing, production code handles it via read-time parse.
- NOT switching any agent to streaming mode (separate optimization).
- NOT shipping per-agent timeout config (one global 5min ceiling is fine for now).
- NOT auto-resuming novels on orchestrator startup (explicit operator action via `/resume` endpoint).
