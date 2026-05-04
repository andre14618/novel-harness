-- 037_proposal_envelopes.sql
--
-- Persistence for review proposal envelopes (Phase 3 commit 4).
--
-- Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 3"
-- Lane:    Phase 3 of the collaborative-proposal-workflow design
--
-- Phase 3 commit 1 introduced the `ReviewProposalEnvelope<TPayload>`
-- TypeScript projection. Commits 2 + 2.5 + 3 shipped per-envelope resolve
-- (atomic compare-and-apply, hash-precondition, regenerate-on-stale)
-- without persistence — envelopes were body-carried by the UI between
-- /adjust and /resolve.
--
-- This migration adds the smallest persistence shape that covers:
--   1. Cross-session resumability — close the AdjustPanel mid-batch,
--      come back later, see the same pending envelopes.
--   2. Audit trail — `status` transitions from `pending` to one of
--      `approved` / `rejected` / `modified` / `shadowed` / `expired`,
--      with `resolved_at` + `resolved_by` capturing who/when.
--   3. Server-side regeneration provenance (deferred to commit 4.5):
--      `parent_envelope_id` will let regen track its lineage.
--
-- The schema is intentionally generic across envelope `kind` values
-- (`artifact_patch` | `canon_update` | `prose_edit` | `editorial_flag`)
-- per the design doc's §Proposal Envelope. The `payload`,
-- `target_*`, and `precondition_*` fields are JSONB / TEXT so each
-- kind can store its own shape without schema branching.
--
-- No FK to novels — matches the canon_* / chapter_revisions /
-- chapter_exhaustions convention. Orphan cleanup is deferred.

-- ── proposal_envelopes ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proposal_envelopes (
  id                     TEXT NOT NULL PRIMARY KEY,
  novel_id               TEXT NOT NULL,
  kind                   TEXT NOT NULL,
  -- Target ref (per design §Proposal Envelope.target).
  target_kind            TEXT NOT NULL,
  target_ref             TEXT NOT NULL,
  target_field_path      TEXT,
  target_current_version TEXT NOT NULL,
  -- Source ref.
  source_agent           TEXT NOT NULL,
  source_user_message    TEXT,
  parent_envelope_id     TEXT,
  -- Lifecycle.
  status                 TEXT NOT NULL DEFAULT 'pending',
  risk                   TEXT NOT NULL,
  summary                TEXT NOT NULL,
  rationale              TEXT NOT NULL,
  evidence               JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload                JSONB NOT NULL,
  precondition_kind      TEXT NOT NULL,
  precondition_hash      TEXT NOT NULL,
  policy_decision        TEXT NOT NULL,
  policy_reasons         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Resolution.
  resolved_at            TIMESTAMPTZ,
  resolved_by_kind       TEXT,
  resolved_by_ref        TEXT,
  resolved_note          TEXT,
  modified_payload       JSONB,
  -- Timestamps.
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- List queries always filter by novel_id; pending-only is the hot path.
CREATE INDEX IF NOT EXISTS proposal_envelopes_novel_status_idx
  ON proposal_envelopes (novel_id, status, created_at);

-- Lineage queries (commit 4.5 server-side regen) need the parent index.
CREATE INDEX IF NOT EXISTS proposal_envelopes_parent_idx
  ON proposal_envelopes (parent_envelope_id)
  WHERE parent_envelope_id IS NOT NULL;
