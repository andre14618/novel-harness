/**
 * Find chapters where speech verbs suggest dialogue but no quotes are detected.
 * Helps validate the dialogue regex.
 */
import db from "../../src/db/connection";

const chapters = await db`
  SELECT cd.novel_id, cd.chapter_number, cd.prose, cd.word_count,
         n.seed_json->>${"genre"} as genre
  FROM chapter_drafts cd
  JOIN novels n ON n.id = cd.novel_id
  WHERE cd.status = ${"approved"}
`;

let mismatchCount = 0;
for (const ch of chapters as any[]) {
  const prose: string = ch.prose || "";
  const doubleQ =
    prose.match(/[""\u201C][^""\u201D]+[""\u201D]/g) || [];
  const curlySingleQ =
    prose.match(/\u2018[^\u2018\u2019]+\u2019/g) || [];
  const asciiSingleQ =
    prose.match(/(?:^|[\s(—–])'((?:[^'\n]|'(?=[a-z]))+)'(?=[.,!?;\s—–)]|$)/gm) || [];
  const singleQ = [...curlySingleQ, ...asciiSingleQ];
  const totalQuotes = doubleQ.length + singleQ.length;
  const speechVerbs =
    prose.match(
      /\b(said|asked|replied|whispered|shouted|muttered|called|yelled|answered|exclaimed|murmured|growled|hissed|snapped|demanded|offered|suggested|warned)\b/gi
    ) || [];

  if (speechVerbs.length >= 3 && totalQuotes === 0) {
    mismatchCount++;
    console.log(
      `MISMATCH: ${ch.novel_id.slice(-8)} Ch${ch.chapter_number} (${ch.genre}) - ${speechVerbs.length} speech verbs, 0 quotes`
    );
    const lines = prose.split("\n").filter((l) => l.trim());
    const svLines = lines.filter((l) =>
      /\b(said|asked|whispered|muttered|replied|snapped)\b/i.test(l)
    );
    for (const l of svLines.slice(0, 3)) {
      console.log(`  >> ${l.slice(0, 140)}`);
    }
    console.log("");
  }
}
console.log(
  `Total mismatches (3+ speech verbs, 0 quotes): ${mismatchCount} / ${chapters.length}`
);

process.exit(0);
