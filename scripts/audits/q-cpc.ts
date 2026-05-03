/**
 * Pull script for chapter-plan-checker TP/FP/GRAY audit.
 *
 * Pulls the 25 most recent pass=false chapter-plan-checker calls.
 * Includes: id, timestamp, novel_id, chapter, user_prompt (plan + prose),
 * response_content (checker verdict + deviations).
 *
 * Run: bun scripts/_q-cpc.ts > chapter-plan-checker-fp-sample.json
 */
import db from "../src/db/connection"

const rows = await db`
  SELECT
    id,
    timestamp,
    novel_id,
    chapter,
    beat_index,
    attempt,
    user_prompt,
    response_content
  FROM llm_calls
  WHERE agent = 'chapter-plan-checker'
    AND (response_content::jsonb->>'pass')::boolean = false
    AND json_extraction_success = true
  ORDER BY timestamp DESC
  LIMIT 25
`

process.stdout.write(JSON.stringify(rows, null, 2))
