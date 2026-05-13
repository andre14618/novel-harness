-- 056_chapter_outline_json_object_guard.sql
--
-- Bun.SQL callers must pass objects directly for JSONB columns. Passing
-- JSON.stringify(value)::jsonb stores a JSONB string, which leaves
-- chapter_outlines.outline_json syntactically valid but unusable as an
-- outline object. Repair any historical string-encoded outline objects and
-- prevent the shape from recurring.

UPDATE chapter_outlines
SET outline_json = (outline_json #>> '{}')::jsonb
WHERE jsonb_typeof(outline_json) = 'string'
  AND jsonb_typeof((outline_json #>> '{}')::jsonb) = 'object';

ALTER TABLE chapter_outlines
  DROP CONSTRAINT IF EXISTS chapter_outlines_outline_json_object_chk;

ALTER TABLE chapter_outlines
  ADD CONSTRAINT chapter_outlines_outline_json_object_chk
  CHECK (jsonb_typeof(outline_json) = 'object');
