-- 025_eval_provenance_view.sql
--
-- Single view that flattens the full lineage of every eval_results row:
--   eval_results → eval_briefs (what was asked)
--                → tuning_experiments (what produced the adapter)
--                → training file paths, formatter args, git commit, W&B URL
--
-- Use:
--   SELECT * FROM eval_full_provenance WHERE beat_id = '...' LIMIT 1;
--   SELECT * FROM eval_full_provenance WHERE adapter_uri LIKE '%v3%';

CREATE OR REPLACE VIEW eval_full_provenance AS
SELECT
  -- Result identity
  er.id                             AS result_id,
  er.created_at                     AS eval_at,
  er.set_name,
  er.beat_id,
  er.cell_label,
  er.adapter_uri,

  -- W&B run URL (extractable from adapter URI for wandb-artifact:///entity/project/name:version)
  CASE WHEN er.adapter_uri LIKE 'wandb-artifact:///%' THEN
    'https://wandb.ai/'
    || SUBSTRING(er.adapter_uri FROM 'wandb-artifact:///([^/]+)')
    || '/'
    || SUBSTRING(er.adapter_uri FROM 'wandb-artifact:///[^/]+/([^/:]+)')
    || '/runs/'
    || REGEXP_REPLACE(SUBSTRING(er.adapter_uri FROM '[^/]+$'), ':.*', '')
  END                               AS wandb_run_url,

  -- Eval output metrics
  er.generated_prose,
  er.style_features,
  er.delta_sum,
  er.ngram_jaccard_vs_gt,
  er.paragraph_breaks_count,
  er.word_count,
  er.bridge_repeat_detected,
  er.lore_leak_tokens,
  er.error_text,

  -- Brief provenance
  eb.brief_json                     AS brief,
  eb.ground_truth_prose,
  eb.ground_truth_style,
  eb.notes                          AS brief_notes,
  eb.created_at                     AS brief_loaded_at,

  -- Training experiment lineage
  te.id                             AS experiment_id,
  te.timestamp                      AS training_submitted_at,
  te.experiment_type,
  te.description                    AS experiment_description,
  te.commit_hash                    AS training_code_commit,
  te.status                         AS experiment_status,
  te.conclusion                     AS experiment_conclusion,

  -- Training config unwound
  te.config->>'base_model'          AS base_model,
  te.config->>'adapter_name'        AS adapter_name,
  te.config->>'train_file'          AS train_file_path,
  te.config->>'val_file'            AS val_file_path,
  (te.config->>'lora_rank')::int    AS lora_rank,
  (te.config->>'epochs')::int       AS epochs,
  (te.config->>'batch_size')::int   AS batch_size,
  (te.config->>'lr')::numeric       AS learning_rate,
  (te.config->>'training_pairs')::int  AS training_pairs,
  te.config->'parent_experiment_ids'   AS parent_experiment_ids,

  -- Full config + hypothesis for anyone who wants to drill deeper
  te.config                         AS training_config_full

FROM eval_results er
LEFT JOIN eval_briefs eb
  ON eb.set_name = er.set_name AND eb.beat_id = er.beat_id
LEFT JOIN tuning_experiments te
  ON te.id = er.experiment_id;

COMMENT ON VIEW eval_full_provenance IS 'Complete lineage for every eval_results row: joins eval_briefs and tuning_experiments, extracts W&B run URL, unwinds training config. One row per eval, with the full chain of custody.';
