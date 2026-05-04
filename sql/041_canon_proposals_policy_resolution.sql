-- 041_canon_proposals_policy_resolution.sql
--
-- Phase 6 commit 4 — record policy decision + version + reasons +
-- resolved-by-kind on every canon_proposals resolution.
--
-- Charter: docs/charters/world-bible-architecture.md
-- Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 6 — Approval Policy Engine"
--
-- ## Why these columns
--
-- Phase 6 commits 2-3 added these audit-trail fields to `proposal_envelopes`
-- (the artifact_patch / prose_edit / editorial_flag table). Canon proposals
-- live in a separate, older table (`canon_proposals`) — the substrate
-- predates the unified envelope model. To make Phase 7's replay harness
-- complete across all four proposal kinds, we add the same columns here.
--
-- Four columns this time (one more than `proposal_envelopes`):
--   - `resolution_policy_decision`  — `queue` / `approve` / `reject` / `shadow`
--   - `resolution_policy_version`   — opaque string from the `ApprovalPolicy`
--   - `resolution_policy_reasons`   — JSONB array of strings
--   - `resolved_by_kind`            — `human` / `policy` / `script` / `test`
--
-- The `resolved_by_kind` column is new for canon_proposals. The existing
-- `proposal_envelopes` table has had it since Phase 3 commit 4. It
-- distinguishes operator-driven decisions from policy-driven ones, which
-- is the load-bearing audit signal for autonomy metrics.
--
-- All NULL for compat: rows resolved before this migration carry no policy
-- evaluation. The resolve route fills these on every new resolution. The
-- design's "manual for Canon" safe default means most canon_update rows
-- will see decision=queue (the policy returns queue for canon_update by
-- the manualKinds default), but the audit signal still matters: it
-- distinguishes "policy was evaluated and said queue" from "no policy
-- attached" (NULL).

ALTER TABLE canon_proposals
  ADD COLUMN IF NOT EXISTS resolution_policy_decision TEXT,
  ADD COLUMN IF NOT EXISTS resolution_policy_version  TEXT,
  ADD COLUMN IF NOT EXISTS resolution_policy_reasons  JSONB,
  ADD COLUMN IF NOT EXISTS resolved_by_kind           TEXT;
