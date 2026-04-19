---
status: draft
updated: 2026-04-19
---

# Steps 4 + 5 plan — polished outline editor + exhaustion telemetry

Final two steps of `docs/exhaustion-handler-design.md`. After these land, we run a test campaign against every feature shipped across the session.

## Step 4 — structured outline editor in `PlanAssistPanel`

**Problem today:** the scaffolding `PlanAssistPanel` (commit `5767ab9`) edits outlines as raw JSON in a textarea. User-hostile: typos break the whole plan, no field-level validation, no structural understanding (the user has to know the full schema shape).

**Goal:** replace the textarea with a structured editor. Minimum viable editor:
- **Beat list** — ordered list of beats with per-beat controls:
  - `kind` dropdown (action / dialogue / interiority / description)
  - `characters` as editable chips (add / remove by name)
  - `description` as an inline textarea (~3 lines tall)
  - Reorder handles (up/down arrows) + delete button per beat
  - "Add beat" button at the bottom
- **Chapter-level header fields** (collapsed by default, expand to edit):
  - `title`, `povCharacter`, `setting`, `purpose`, `targetWords`
- **Raw JSON view toggle** — expert escape hatch for power users. Keeps the current textarea behavior as a fallback.
- **Submit** — builds the full outline object from the editor state and sends to `decidePlanAssist`. Preserves `establishedFacts`, `characterStateChanges`, `knowledgeChanges` from the original payload verbatim. Per Codex review `aab899143d8326c77` Q3: the reviser itself modifies these three fields when it accepts a plan, so they ARE part of the live outline contract. The structured editor shows them as **read-only disclosure** with a note "to edit these, switch to the Raw JSON view." Power users who actually need to touch them can; the structured editor avoids building form UI for every field in the MVP.
- **Preview panel** — shows the JSON that will be POSTed, collapsed behind a disclosure. Always present, not a follow-on PR (Codex Q8). Lets the user sanity-check before submit.

### Files

- `ui/src/components/PlanAssistPanel.tsx` — refactored: split into `<PlanAssistPanel>` shell + `<OutlineEditor outline onChange>` inner component.
- `ui/src/components/OutlineEditor.tsx` — new: the structured editor.
- `ui/src/lib/outline-helpers.ts` — small helpers (reorder, add/remove beat, chip manipulation).

### What this step does NOT do

- **No drag-to-reorder.** Up/down arrows only. Drag handles are polish, not essential.
- **No editing of `establishedFacts` / `characterStateChanges` / `knowledgeChanges`.** Those are preserved verbatim. Adding them later is straightforward; leaving them out of the MVP keeps the editor focused on the beat-shape problem that typically causes exhaustion.
- **No AI-assisted edit suggestions.** Future step.

### Risk

Low. The route-level Zod validation (plus the empty-scenes guardrail from commit `8fd2097`) catches malformed submissions. The editor's job is to make good submissions easy, not to re-validate what the server already validates.

## Step 5 — `chapter_exhaustions` telemetry table

**Problem today:** when plan-assist gates fire we log via `trace()` (pipeline_events) and emit SSE, but there's no dedicated table aggregating gate lifecycle. "How often does chapter N fire a gate? What % of fires pick `override` vs `edit-plan`?" requires digging through `pipeline_events` with JSONB queries.

**Goal:** dedicated table with one row per gate fire + its resolution, plus a minimal list endpoint and Studio surface.

### Schema — `sql/030_chapter_exhaustions.sql`

```sql
CREATE TABLE IF NOT EXISTS chapter_exhaustions (
  id                    SERIAL PRIMARY KEY,
  novel_id              TEXT NOT NULL,
  chapter               INT  NOT NULL,
  attempt               INT  NOT NULL,
  fired_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind                  TEXT NOT NULL,  -- 'plan-check-exhausted' | 'reviser-rejected'
  resolver_mode         TEXT NOT NULL,  -- 'auto' | 'cli' | 'web' (Codex Q7)
  unresolved_deviations JSONB NOT NULL DEFAULT '[]',
  reviser_history       JSONB,
  decided_at            TIMESTAMPTZ,
  decision              TEXT,           -- 'edit-plan' | 'override' | 'abort' | NULL when unresolved
  decision_details      JSONB           -- edited outline payload for edit-plan; NULL otherwise
);

CREATE INDEX IF NOT EXISTS idx_chapter_exhaustions_novel
  ON chapter_exhaustions(novel_id, chapter, fired_at);
```

### Write path

Options considered:

- **A.** Write from `gates.ts` — `requestPlanAssist` inserts the fire row; `resolvePlanAssist` updates with the decision. Couples the gate infra to DB.
- **B.** Write from `drafting.ts` — each exhaustion site that sets `pendingExhaustion` also inserts; the gate-fire epilogue updates on resolution. Keeps `gates.ts` DB-free but couples drafting to telemetry.

**Lean toward A.** The gate is an inherently-stateful object and it's already the natural write-boundary. Keeps drafting-layer lean. Small helper `src/db/chapter-exhaustions.ts` with `logExhaustionFired()` + `logExhaustionResolved()`.

Note: this is the exact opposite of the `chapter_revisions` table (`sql/028`), which writes from drafting.ts rather than the agent. Rationale for diverging: `chapter_revisions` tracks reviser invocations (agent-level telemetry), while `chapter_exhaustions` tracks gate lifecycle (gate-infra-level telemetry). Each stays where its concept lives.

### Read path

- **`GET /api/novel/:id/exhaustions`** — returns all rows for a novel, ordered by `fired_at`.
- Studio surface: new `ExhaustionsPanel.tsx` (parallels `RevisionsPanel.tsx`) — renders recent fires with decision chips + issue summaries. Collapsed by default; zero-state says "No gate fires for this novel."

### What this step does NOT do

- **No cross-novel aggregation view.** Per-novel list only. A leaderboard-style aggregated view can come later once we have enough data to know what dimensions matter.
- **No decision-auditing / who-decided tracking.** Single-user orchestrator for now.
- **No active-learning harvest.** Design memo §1 mentions this — deferred to a separate experiment.

### Risk

Low-medium. Migration is additive. Write-path is fire-and-forget (failure logged as warning, doesn't break the gate flow). Schema is conservatively typed (JSONB for flexibility; no FK constraint to novels so orphan-cleanup is a future concern, matching `chapter_revisions` behavior).

## Codex corrections applied (from `aab899143d8326c77`)

- **Q3** — structured editor shows `establishedFacts`/`characterStateChanges`/`knowledgeChanges` as read-only disclosure; raw-JSON view remains the way to edit them.
- **Q6** — on `abort` decision, gate handler also calls `resolveAllPending(novelId)` to defensively close any other open gates for the same novel.
- **Q7** — schema gains `resolver_mode TEXT NOT NULL` column.
- **Q8** — JSON preview is part of step 4's submit flow, not a follow-on PR.
- **Q9** — `migrate-path.test.ts` updated to expect migration `030` before the step-5 commit lands so CI catches naming/ordering regressions.

## Implementation order

1. Step 5 (telemetry) first — smaller, DB-only, no UI contract to get right. Lets us sanity-check the schema before building the editor that would consume similar data surfaces.
2. Step 4 (editor) second — more surface area but self-contained to `ui/src/`. Can land with a single UI build.

Both can ship as separate commits:
- `[telemetry] chapter_exhaustions table + /exhaustions endpoint + ExhaustionsPanel`
- `[ui] Structured outline editor in PlanAssistPanel`

## Open questions for Codex review

1. **Write-path: A (gates.ts) vs B (drafting.ts)?** I'm leaning A because gates owns the lifecycle. But `chapter_revisions` (sql/028) went B for reviser calls. Is the inconsistency OK given the different concerns, or should they match?

2. **`decision_details` JSONB shape for `edit-plan` — store the whole new outline?** That's a 1-10 KB blob per edit. Over time it grows per-novel. Alternative: store just a diff against the pre-edit outline. Diff is harder; full blob is simpler. Lean toward full blob given the fire rate is expected to be <1 per chapter. Disk is cheap.

3. **Editor scope creep** — do we actually need the raw-JSON escape hatch? Simpler to ship without and add it if users ask. Lean: ship it because it's a small safety net for the "structured editor broke, let me just fix the JSON directly" case.

4. **ExhaustionsPanel surface** — full page (parallel to `RevisionsPanel`) or inline on the Studio main view? Lean inline/collapsed, parallel to how `RevisionsPanel` sits. Could also be on `/app/:novelId` PipelineView.

5. **Abort decision semantics in telemetry** — when user picks "abort," the drafting phase returns. The gate row has `decision='abort'`. Should we also auto-close any other open gates for that novel at that moment? Probably yes (defensive), but might be overkill for a one-gate-at-a-time-in-practice system.

6. **Any prerequisite fixes from prior Codex rounds?** Anything flagged in a0e0567af62b0fb9a / a100db0d7efdc09ee that I should address before adding new surface area?
