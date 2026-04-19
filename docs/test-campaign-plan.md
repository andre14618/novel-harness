---
status: draft
updated: 2026-04-19
---

# Test campaign — exhaustion-handler end-to-end verification

Goal: verify every feature shipped in the non-blind-retry + exhaustion-handler session by **forcibly triggering** each path instead of waiting for natural exhaustion.

Features to test (in ship-order):

| # | Feature | Commits |
|---|---|---|
| F1 | `migrate()` path fix | `ce64e28` |
| F2 | Reviser single-escalation guarantee (per-chapter hard cap) | `73542f8`, `6eb9bd9` |
| F3 | Path (C) — validation-driven reviser escalation | `e829b81`, `8ee7e3f` |
| F4 | Auto-mode `PipelineBailError` → `lastRunError` shape | `2f012de`, `bd61f96` |
| F5 | Web-mode `edit-plan` decision | `5767ab9`, `8fd2097`, `e75ee01` |
| F6 | Web-mode `override` decision + DB persistence | `5767ab9`, `8fd2097` |
| F7 | Web-mode `abort` decision → phase stays `drafting`, novel stops | `5767ab9` |
| F8 | `chapter_exhaustions` telemetry rows (fire + resolve lifecycle) | `22fd021`, `1d1b4e1` |
| F9 | ExhaustionsPanel SSE-driven refresh | `22fd021`, `1d1b4e1` |
| F10 | OutlineEditor structured ↔ raw-JSON round-trip | `e75ee01`, `1d1b4e1` |
| F11 | Override persistence survives process restart | `5767ab9` |

## Problem — natural exhaustion is too slow

A real novel only exhausts after beat-writer burns its retry budget, plan-check settle loop exhausts, reviser runs, and the reviser-hard-cap skip path fires. That's 10+ LLM calls per attempt × 3 attempts before we even get a gate. Most seeds complete without ever exhausting.

**Solution: debug env flags** short-circuit specific check outcomes so we can drive exhaustion in seconds instead of hours. They ONLY affect code paths on the check/reviser layer — beat-writer and everything upstream of it runs normally, so we still exercise the real wiring.

## Debug injection — proposed env flags

Read once per-attempt in `src/phases/drafting.ts`:

| Flag | Effect |
|---|---|
| `DEBUG_FORCE_PLAN_CHECK=fail` | Synthesize `{pass:false, deviations:[{description:"forced plan-check failure",beat_index:0}]}` instead of calling `chapter-plan-checker`. Drives F2/F4/F5/F6/F7/F8. |
| `DEBUG_FORCE_VALIDATION=pov` | Force `validateChapterDraft` to return `{passed:false, blockers:['POV character "X" never mentioned in draft']}`. Drives F3. |
| `DEBUG_FORCE_VALIDATION=word-count` | Same, with word-count blocker. Alternate F3 trigger. |
| `DEBUG_FORCE_REVISER=reject` | Make reviser return a plan with 1 beat (fails beat-floor sanity) — forces `kind="reviser-rejected"` on the gate. Drives F5 variant. |
| `DEBUG_FORCE_REVISER=throw` | Make reviser throw — tests the error path. |

All flags are no-op when unset (production behavior unchanged). Gated behind a single check at the top of the attempt loop; adds ~5 lines per check site.

## Test runs

Each run creates a fresh short novel (3 chapters, ~500w target — runs to chapter 1 exhaustion in <1 min).

### R1 — Auto-mode bail via plan-check (F4, F8)

```
DEBUG_FORCE_PLAN_CHECK=fail POST /api/novel/start mode=auto
```

**Expected:**
- Chapter 1 attempt 1: beat-writer runs, plan-check fails (forced), settle exhausts, reviser fires + accepts revision, attempt 2 starts
- Chapter 1 attempt 2: plan-check fails again, reviser skipped (revisionUsed=true), `pendingExhaustion` populated with `kind="plan-check-exhausted"`
- Gate fires in auto mode → `await logExhaustionFired` → `throw PipelineBailError`
- Orchestrator catches, writes structured `lastRunError`

**Pass criteria:**
- `GET /api/novel/:id/state` → `lastRunError.kind === "plan-assist-bail"`, `bailKind === "plan-check-exhausted"`, `chapter === 1`
- `SELECT * FROM chapter_exhaustions WHERE novel_id = $1` → one row with `kind='plan-check-exhausted'`, `resolver_mode='auto'`, `decision IS NULL`
- `SELECT * FROM chapter_revisions WHERE novel_id = $1` → one row with `outcome='accepted'` (reviser fired once)

### R2 — Web-mode override (F5-variant, F6, F8, F11)

Same trigger as R1 but mode=web. Gate opens. We resolve via API.

- Submit `POST /api/novel/:id/plan-assist/1/decide` body `{action:"override"}`
- **Pass:** `chapter_outlines.plan_check_overridden === true`, subsequent attempts log `[OVERRIDE] plan-check skipped`, no further gate fires
- Restart orchestrator mid-run, resume novel, confirm `plan_check_overridden` still true (F11)

### R3 — Web-mode edit-plan (F5)

Same trigger. Gate opens.

- Submit edit-plan with a revised outline (3 beats valid shape)
- **Pass:** `chapter_outlines.outline_json` now has the submitted scenes, next attempt uses revised plan, `chapter_exhaustions.decision='edit-plan'`, `decision_details` matches submitted outline

### R4 — Web-mode abort (F7)

Same trigger. Gate opens.

- Submit abort
- **Pass:** `novels.phase === 'drafting'`, `activeRuns.has(novelId) === false`, log line "Chapter 1 aborted by user"

### R5 — Validation-path reviser (F3)

```
DEBUG_FORCE_VALIDATION=pov POST /api/novel/start mode=auto
```

**Expected:** validation settle loop exhausts → validation-driven reviser fires → accepts or rejects → auto-mode bails after revisionUsed

**Pass:** `chapter_revisions` row with `rejection_reason LIKE '[validation]%'` (if rejected) OR `outcome='accepted'` on a validation-path invocation. `chapter_exhaustions.kind='reviser-rejected'` or `'plan-check-exhausted'`.

### R6 — Reviser-rejected gate kind (F5, F8 variant)

```
DEBUG_FORCE_PLAN_CHECK=fail DEBUG_FORCE_REVISER=reject
```

**Expected:** reviser fires, returns 1-beat plan, sanity-check rejects it, `pendingExhaustion` populated with `kind="reviser-rejected"` + `reviserHistory.attemptedScenes`, gate fires

**Pass:** `chapter_exhaustions` row has `kind='reviser-rejected'`, `reviser_history` JSONB non-null, decision matches submitted action.

### R7 — Reviser single-escalation (F2 prod-check)

```
DEBUG_FORCE_PLAN_CHECK=fail mode=auto  # same as R1
```

**Pass:** across all 3 attempts, exactly one reviser call lands in `chapter_revisions` with `outcome` ≠ skip variants; attempts 2 and 3 produce `skip_already_revised` rows.

### R8 — UI manual tests (F9, F10)

Open Studio with an R2/R3-style active gate. Manual verifications:

- F9: resolve via API in one tab; ExhaustionsPanel in another tab updates within 1s (SSE refresh)
- F10: open edit-plan panel, toggle structured ↔ Raw JSON several times, verify no edits lost

### R9 — Migration stability (F1 prod-check)

Already verified post-deploy — `_migrations` table stable at 30 rows, no "Applying migration:" re-application in logs across the session's 6 deploys.

## Infrastructure work

Small:

1. **Add debug flags to `src/phases/drafting.ts`** — 3 `if (process.env.DEBUG_FORCE_*)` branches in the plan-check call, validation call, and reviser-accept sanity path. ~30 lines total.
2. **Add a test-runner script** — `scripts/test/exhaustion-handler-campaign.ts` that runs R1-R7 sequentially, asserts DB state, prints pass/fail table.
3. **Wire flag documentation** — comment block at top of `drafting.ts` listing the DEBUG_FORCE_* flags and their effects.

R8 stays manual (UI test).

## Analysis + Codex cross-check

After tests run:
1. Collect pass/fail per feature
2. For any FAIL, root-cause: is it a real bug in the implementation, or a test harness bug?
3. Send full results + any surprising findings to Codex for an independent read
4. File any real bugs as new commits with regression coverage

## Open questions for Codex before executing

1. **Missing coverage** — any feature F1-F11 this plan doesn't actually exercise end-to-end?
2. **Additional forced triggers needed** — any code path that the `DEBUG_FORCE_*` envs don't reach?
3. **Test-runner shape** — bun script vs shell-scripted curl vs pytest-style framework?
4. **Concurrency risks** — running R1-R7 serially against the same orchestrator: any state-bleed (e.g., stale `activeRuns` map entries) that would poison later tests?
5. **DB cleanup** — leave the 7 test novels in `public.novels`, or auto-cleanup at the end of the campaign? Lean toward keeping them so post-hoc analysis is possible; user can `DELETE ... WHERE seed_json->>'title' LIKE 'test-exhaustion-%'` if they bother them.
6. **Anything we'd want instrumented to make the tests stronger** — e.g., structured log lines at key branch points that the test runner can grep?

## Execution (MVP)

The script `scripts/test/exhaustion-campaign.ts` automates **R0, R1, R5, R6, R7**. R2/R3/R4 require human interaction with the web UI (web-mode gate decisions) and cannot be scripted. R8 (UI/SSE panel) stays manual.

### Env flag protocol

Each test group requires different `DEBUG_FORCE_*` flags set on the **orchestrator process** (not the local machine). The cleanest approach is one deployment per flag combination:

| Tests | Required flags on orchestrator |
|-------|-------------------------------|
| R1, R7 | `DEBUG_FORCE_PLAN_CHECK=fail` |
| R5 | `DEBUG_FORCE_VALIDATION=pov` |
| R6 | `DEBUG_FORCE_PLAN_CHECK=fail DEBUG_FORCE_REVISER=reject` |

Because these flags conflict (R5 vs R1), run each group in its own deploy:

```bash
# R0 smoke — no flags needed
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/test/exhaustion-campaign.ts --skip-env-tests"

# R1 + R7 — plan-check forced fail
DEBUG_FORCE_PLAN_CHECK=fail bash scripts/deploy-lxc.sh
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/test/exhaustion-campaign.ts --assume-env"
# (R5 and R6 will show [SKIP] — that's expected; run them in separate passes)

# R5 — validation forced fail
DEBUG_FORCE_VALIDATION=pov bash scripts/deploy-lxc.sh
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/test/exhaustion-campaign.ts --assume-env"

# R6 — plan-check + reviser forced reject
DEBUG_FORCE_PLAN_CHECK=fail DEBUG_FORCE_REVISER=reject bash scripts/deploy-lxc.sh
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/test/exhaustion-campaign.ts --assume-env"
```

After testing, redeploy without debug flags to restore production behavior:

```bash
bash scripts/deploy-lxc.sh
```

### Test novels

The runner creates one novel per test run (named `test-exhaustion-<timestamp>-<random>`). They are NOT auto-cleaned — inspect with:

```sql
SELECT id, phase, seed_json->>'title' as title, created_at
FROM novels
WHERE seed_json->>'title' LIKE 'test-exhaustion-%'
ORDER BY created_at DESC;
```

Delete when done: `DELETE FROM novels WHERE seed_json->>'title' LIKE 'test-exhaustion-%';`

### R2, R3, R4 — web-mode manual steps

These require opening the orchestrator's Studio UI while a gate is open:

**R2 (override):** Deploy with `DEBUG_FORCE_PLAN_CHECK=fail`, start a novel in web mode, wait for the plan-assist panel to appear in Studio, then `POST /api/novel/:id/plan-assist/1/decide` with `{action:"override"}`. Verify `chapter_outlines.plan_check_overridden=true`. Restart orchestrator mid-run to test F11 persistence.

**R3 (edit-plan):** Same trigger, decide body `{action:"edit-plan", outline:{scenes:[...3 valid beats...]}}`. Verify `chapter_outlines.outline_json` updated and `chapter_exhaustions.decision='edit-plan'`.

**R4 (abort):** Same trigger, decide body `{action:"abort"}`. Verify `novels.phase='drafting'` and run is no longer active.

### R8 — UI/SSE manual steps

Open Studio in two tabs. Trigger a gate in one tab via R2-style flow. Confirm ExhaustionsPanel in the second tab updates within 1s (F9). Open the edit-plan panel and toggle structured/Raw JSON repeatedly to verify round-trip fidelity (F10).
