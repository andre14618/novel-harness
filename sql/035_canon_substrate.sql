-- 035_canon_substrate.sql
--
-- Canon Substrate (Step 1 production tables) for the world-bible /
-- character-bible architecture.
--
-- Charter: docs/charters/world-bible-architecture.md §1
-- Design:  docs/designs/canon-substrate-step1.md
-- Lane:    docs/sessions/2026-05-03-canon-substrate-postgres-adapter.md
--
-- Six tables back the four canon-typed objects + proposal lifecycle:
--
--   canon_facts            — CanonFact versions
--   canon_entities         — Entity versions
--   canon_character_states — CharacterState versions (logical id = character_id)
--   canon_promises         — StoryPromise versions
--   canon_proposals        — pending/resolved CanonUpdateProposal records
--   canon_snapshot_meta    — per-novel monotonic counter for snapshotVersion()
--
-- Storage model is bitemporal-ish with story time = chapter index. Each
-- logical id can have N committed versions. The active version (the one
-- visible at the latest snapshot) is the row with superseded_by_version
-- IS NULL. Point-in-time reads filter on committed_at_chapter ≤ N AND
-- (superseded_at_chapter IS NULL OR superseded_at_chapter > N).
--
-- approval_status is filtered at read time too (defense-in-depth — the
-- substrate write path only commits human-approved or human-edited rows,
-- but scope.ts re-applies the filter and so do the canon read queries).
--
-- No FKs to novels — matches the chapter_revisions / chapter_exhaustions
-- convention. Orphan cleanup is deferred. The canon_* tables are scoped
-- by novel_id alone.

-- ── canon_facts ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS canon_facts (
  novel_id              TEXT NOT NULL,
  logical_id            TEXT NOT NULL,           -- stable across edits
  version               INT  NOT NULL,           -- monotonic per (novel_id, logical_id)
  kind                  TEXT NOT NULL,           -- FactKind
  text                  TEXT NOT NULL,
  data                  JSONB,                   -- kind-dependent payload (nullable)
  -- provenance (flat columns, not jsonb — reads filter on these)
  source                TEXT NOT NULL,           -- ProvenanceSource
  committed_at_chapter  INT  NOT NULL,
  committed_at_beat     INT,
  extractor_version     TEXT NOT NULL,
  confidence            NUMERIC(4,3),
  approval_status       TEXT NOT NULL,           -- ApprovalStatus
  origin                TEXT NOT NULL,           -- 'planned' | 'observed'
  supersedes_logical_id TEXT,                    -- logical id this version supersedes (null = original)
  -- supersession backreference (set when a later version replaces this one)
  superseded_by_version INT,
  superseded_at_chapter INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (novel_id, logical_id, version)
);

CREATE INDEX IF NOT EXISTS idx_canon_facts_snapshot
  ON canon_facts (novel_id, committed_at_chapter, approval_status)
  WHERE superseded_by_version IS NULL;

CREATE INDEX IF NOT EXISTS idx_canon_facts_active
  ON canon_facts (novel_id, logical_id)
  WHERE superseded_by_version IS NULL;

-- ── canon_entities ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS canon_entities (
  novel_id              TEXT NOT NULL,
  logical_id            TEXT NOT NULL,
  version               INT  NOT NULL,
  name                  TEXT NOT NULL,
  aliases               JSONB NOT NULL DEFAULT '[]',
  kind                  TEXT NOT NULL,           -- EntityKind
  first_appeared_chapter INT,
  data                  JSONB,
  -- provenance
  source                TEXT NOT NULL,
  committed_at_chapter  INT  NOT NULL,
  committed_at_beat     INT,
  extractor_version     TEXT NOT NULL,
  confidence            NUMERIC(4,3),
  approval_status       TEXT NOT NULL,
  origin                TEXT NOT NULL,
  supersedes_logical_id TEXT,
  superseded_by_version INT,
  superseded_at_chapter INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (novel_id, logical_id, version)
);

CREATE INDEX IF NOT EXISTS idx_canon_entities_snapshot
  ON canon_entities (novel_id, committed_at_chapter, approval_status)
  WHERE superseded_by_version IS NULL;

CREATE INDEX IF NOT EXISTS idx_canon_entities_active
  ON canon_entities (novel_id, logical_id)
  WHERE superseded_by_version IS NULL;

-- ── canon_character_states ──────────────────────────────────────────────
--
-- Logical id = character_id. CharacterState has no separate canonical id
-- (it's per-character, anchored to the character's identifier). The
-- versioning + supersession columns live alongside the same way.

CREATE TABLE IF NOT EXISTS canon_character_states (
  novel_id              TEXT NOT NULL,
  character_id          TEXT NOT NULL,           -- logical id
  version               INT  NOT NULL,
  character_name        TEXT NOT NULL,
  known_facts           JSONB NOT NULL DEFAULT '[]',  -- CanonId[]
  state                 JSONB NOT NULL DEFAULT '{}',
  as_of_chapter         INT  NOT NULL,
  as_of_beat            INT,
  -- provenance
  source                TEXT NOT NULL,
  committed_at_chapter  INT  NOT NULL,
  committed_at_beat     INT,
  extractor_version     TEXT NOT NULL,
  confidence            NUMERIC(4,3),
  approval_status       TEXT NOT NULL,
  origin                TEXT NOT NULL,
  supersedes_logical_id TEXT,
  superseded_by_version INT,
  superseded_at_chapter INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (novel_id, character_id, version)
);

CREATE INDEX IF NOT EXISTS idx_canon_states_snapshot
  ON canon_character_states (novel_id, committed_at_chapter, approval_status)
  WHERE superseded_by_version IS NULL;

CREATE INDEX IF NOT EXISTS idx_canon_states_active
  ON canon_character_states (novel_id, character_id)
  WHERE superseded_by_version IS NULL;

-- ── canon_promises ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS canon_promises (
  novel_id                TEXT NOT NULL,
  logical_id              TEXT NOT NULL,
  version                 INT  NOT NULL,
  setup_chapter           INT  NOT NULL,
  setup_beat              INT,
  expected_payoff_chapter INT,
  resolved_at_chapter     INT,
  resolved_at_beat        INT,
  status                  TEXT NOT NULL,         -- 'open' | 'resolved' | 'abandoned'
  promise_fact_id         TEXT NOT NULL,
  -- provenance
  source                  TEXT NOT NULL,
  committed_at_chapter    INT  NOT NULL,
  committed_at_beat       INT,
  extractor_version       TEXT NOT NULL,
  confidence              NUMERIC(4,3),
  approval_status         TEXT NOT NULL,
  origin                  TEXT NOT NULL,
  supersedes_logical_id   TEXT,
  superseded_by_version   INT,
  superseded_at_chapter   INT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (novel_id, logical_id, version)
);

CREATE INDEX IF NOT EXISTS idx_canon_promises_snapshot
  ON canon_promises (novel_id, committed_at_chapter, approval_status)
  WHERE superseded_by_version IS NULL;

CREATE INDEX IF NOT EXISTS idx_canon_promises_active
  ON canon_promises (novel_id, logical_id)
  WHERE superseded_by_version IS NULL;

-- ── canon_proposals ─────────────────────────────────────────────────────
--
-- Pending + resolved proposals. Pending rows NEVER feed reads — the
-- substrate's read methods query the canon_* tables, not this one. Only
-- approved or modified proposals cause a row to land in canon_*; rejected
-- proposals are recorded here for audit only.
--
-- target_logical_id may be NULL when the proposal introduces a brand-new
-- logical id (no supersession).
--
-- proposed_payload is the JSONB-serialized CanonFact/Entity/etc. as
-- submitted by the proposer. modified_payload is the operator-supplied
-- override when the proposal is resolved as 'modified'. Both are kept
-- for audit.

CREATE TABLE IF NOT EXISTS canon_proposals (
  id                  TEXT PRIMARY KEY,
  novel_id            TEXT NOT NULL,
  source              TEXT NOT NULL,            -- ProvenanceSource
  target_logical_id   TEXT,                     -- null = brand-new logical id
  proposed_payload    JSONB NOT NULL,
  modified_payload    JSONB,                    -- only set on status='modified'
  status              TEXT NOT NULL,            -- 'pending' | 'approved' | 'rejected' | 'modified'
  operator_note       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_canon_proposals_pending
  ON canon_proposals (novel_id, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_canon_proposals_novel
  ON canon_proposals (novel_id, status);

-- ── canon_snapshot_meta ─────────────────────────────────────────────────
--
-- Per-novel monotonic counter. Bumped on every commit/reject so consumers
-- caching snapshots can detect state changes. snapshotVersion(novelId)
-- returns "<novel_id>@<generation_counter>".

CREATE TABLE IF NOT EXISTS canon_snapshot_meta (
  novel_id              TEXT PRIMARY KEY,
  generation_counter    BIGINT NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE canon_facts IS
  'Versioned committed CanonFact records. Active version = superseded_by_version IS NULL. '
  'Point-in-time reads: committed_at_chapter <= N AND (superseded_at_chapter IS NULL OR superseded_at_chapter > N).';

COMMENT ON TABLE canon_proposals IS
  'Pending + resolved CanonUpdateProposal records. Pending rows NEVER feed reads — the no-ghost-canon rule.';

COMMENT ON TABLE canon_snapshot_meta IS
  'Per-novel monotonic counter for snapshotVersion(). Bumped on every commit/reject.';
