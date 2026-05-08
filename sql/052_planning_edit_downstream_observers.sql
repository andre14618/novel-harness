-- 052_planning_edit_downstream_observers.sql
--
-- Planning edits now participate in exact draft/checker attribution. A
-- planning edit changes upstream plan state; when drafting later approves a
-- chapter produced from that changed plan, the harness records a draft impact
-- context keyed by the approved draft hash. Existing validation observers can
-- then attach checker observations without timing-based inference.

ALTER TABLE proposal_resolution_impacts
  DROP CONSTRAINT IF EXISTS proposal_resolution_impacts_proposal_kind_check;

ALTER TABLE proposal_resolution_impacts
  ADD CONSTRAINT proposal_resolution_impacts_proposal_kind_check CHECK (
    proposal_kind IN (
      'artifact_patch',
      'prose_edit',
      'editorial_flag',
      'canon_update',
      'planning_edit'
    )
  );

ALTER TABLE proposal_checker_observations
  DROP CONSTRAINT IF EXISTS proposal_checker_observations_proposal_kind_check;

ALTER TABLE proposal_checker_observations
  ADD CONSTRAINT proposal_checker_observations_proposal_kind_check CHECK (
    proposal_kind IN (
      'artifact_patch',
      'prose_edit',
      'editorial_flag',
      'canon_update',
      'planning_edit'
    )
  );
