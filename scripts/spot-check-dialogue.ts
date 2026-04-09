/**
 * Spot-check dialogue detection on a specific chapter.
 * Usage: bun scripts/spot-check-dialogue.ts
 */
import db from "../data/connection.ts";

// Get a chapter with high speech verb count but previously low dialogue detection
const samples = await db`
  SELECT cd.novel_id, cd.chapter_number, cd.prose, cd.word_count,
         n.seed_json->>${"genre"} as genre
  FROM chapter_drafts cd
  JOIN novels n ON n.id = cd.novel_id
  WHERE cd.status = ${"approved"}
  ORDER BY cd.novel_id, cd.chapter_number
  LIMIT 3
`;

for (const s of samples as any[]) {
  const prose: string = s.prose;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Novel ${s.novel_id.slice(-8)} Ch ${s.chapter_number} (${s.genre})`);

  // Double quote matches
  const doubleQuotes = prose.match(/[""\u201C][^""\u201D]+[""\u201D]/g) || [];
  console.log(`\nDouble quote matches: ${doubleQuotes.length}`);
  for (const q of doubleQuotes.slice(0, 5)) {
    console.log(`  D>> ${q.slice(0, 100)}`);
  }

  // Single quote matches
  const singleQuotes =
    prose.match(/(?:^|[\s(—–])'([^']{5,})'(?=[.,!?;\s\n—–)]|$)/gm) || [];
  console.log(`\nSingle quote matches: ${singleQuotes.length}`);
  for (const q of singleQuotes.slice(0, 10)) {
    console.log(`  S>> ${q.slice(0, 100)}`);
  }

  // Lines containing single-quoted dialogue candidates
  const lines = prose.split("\n").filter((l) => l.trim());
  const singleQuoteLines = lines.filter((l) => /'[^']{5,}'/.test(l));
  console.log(`\nLines with potential single-quote dialogue: ${singleQuoteLines.length}`);
  for (const l of singleQuoteLines.slice(0, 10)) {
    console.log(`  >> ${l.slice(0, 130)}`);
  }

  // Lines with speech verbs
  const speechLines = lines.filter((l) =>
    /\b(said|asked|replied|whispered|shouted|muttered|called|yelled|answered|exclaimed|murmured|growled|hissed|snapped|demanded|offered|suggested|warned)\b/i.test(l)
  );
  console.log(`\nLines with speech verbs: ${speechLines.length}`);
  for (const l of speechLines.slice(0, 10)) {
    console.log(`  >> ${l.slice(0, 130)}`);
  }

  // Contraction false positive check
  const contractionCandidates = prose.match(
    /\b\w+'(t|s|d|ll|ve|re|m)\b/g
  ) || [];
  console.log(
    `\nContractions found: ${contractionCandidates.length} (first 10: ${contractionCandidates.slice(0, 10).join(", ")})`
  );
}

process.exit(0);
