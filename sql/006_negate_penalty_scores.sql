-- Negate all existing penalty scores so higher=better universally.
-- Penalty dimensions store issue counts as negative numbers after this migration.
-- Score dimensions (1-10 scale) are unchanged.

UPDATE scores SET score = -score
WHERE dimension IN ('telling', 'dead-weight', 'dialogue-problems')
  AND score > 0;
