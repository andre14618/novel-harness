-- Fine-tuning training data storage for LoRA dataset curation.
-- Pairs base model outputs with human-corrected gold outputs.

CREATE TABLE IF NOT EXISTS finetune_training_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task TEXT NOT NULL,                    -- fact-extractor, adherence-checker, chapter-plan-checker, tonal-pass
  status TEXT NOT NULL DEFAULT 'pending', -- pending, reviewed, approved, rejected
  novel_id TEXT,
  chapter_number INTEGER,
  system_prompt TEXT NOT NULL,
  user_content TEXT NOT NULL,            -- chapter text or beat+prose
  base_output TEXT NOT NULL,             -- base model's extraction (JSON string)
  gold_output TEXT,                      -- human-corrected version (JSON string, null until reviewed)
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX idx_finetune_task_status ON finetune_training_data(task, status);
