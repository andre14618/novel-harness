-- 040_proposal_envelopes_policy_resolution.sql
--
-- Phase 6 commit 2 — record policy decision + version + reasons on every
-- proposal envelope resolution.
--
-- Charter: docs/charters/world-bible-architecture.md
-- Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 6 — Approval Policy Engine"
--
-- ## Why these columns
--
-- Phase 6 commit 1 shipped the deterministic `evaluatePolicy(envelope, policy)`
-- helper. Phase 6's design acceptance — "record policy decision and policy
-- version on every proposal resolution" — requires that every resolved row
-- carry not just the operator's status but ALSO what the active approval
-- policy decided. This is the audit-trail piece Phase 7's replay harness
-- will compare against operator decisions for autonomy metrics.
--
-- Three columns:
--   - `resolution_policy_decision`  — `queue` / `approve` / `reject` / `shadow`
--   - `resolution_policy_version`   — opaque string from the `ApprovalPolicy`
--   - `resolution_policy_reasons`   — JSONB array of strings
--
-- All NULL for compat: rows resolved before this migration carry no policy
-- evaluation. The resolve route fills these on every new resolution. The
-- evaluation is recorded for AUDIT — the operator's decision (status field)
-- still drives what actually applied. A future commit will add an autonomous
-- decide path where the policy decision drives the apply directly.
--
-- The producer's `policyRecommendation` (existing `policy_decision` +
-- `policy_reasons` columns) is a different thing: it captures the producer's
-- self-reported confidence. The new `resolution_*` columns capture what the
-- policy ENGINE decided at the moment of resolution. Both surface in the
-- audit trail.

ALTER TABLE proposal_envelopes
  ADD COLUMN IF NOT EXISTS resolution_policy_decision TEXT,
  ADD COLUMN IF NOT EXISTS resolution_policy_version  TEXT,
  ADD COLUMN IF NOT EXISTS resolution_policy_reasons  JSONB;
