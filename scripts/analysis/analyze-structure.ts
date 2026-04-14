/**
 * Deterministic structural analysis of existing novel prose.
 * Measures dialogue density, interiority, action, sentence variety, etc.
 * No LLM calls — pure regex/counting.
 */
import db from "../../src/db/connection";

const chapters = await db`
  SELECT cd.novel_id, cd.chapter_number, cd.prose, cd.word_count,
         n.seed_json->>'genre' as genre
  FROM chapter_drafts cd
  JOIN novels n ON n.id = cd.novel_id
  WHERE cd.status = 'approved'
  ORDER BY cd.novel_id, cd.chapter_number
`;

interface ChapterMetrics {
  novel: string;
  ch: number;
  genre: string;
  words: number;
  dialogueWordPct: number;
  interiorityPer100w: number;
  actionPer100w: number;
  avgSentLen: number;
  sentLenCV: number;
  paragraphs: number;
  avgParaWords: number;
  dialogueExchanges: number;
  speechVerbCount: number;
  longestNonDialogueRun: number;
}

const results: ChapterMetrics[] = chapters.map((ch: any) => {
  const prose: string = ch.prose || "";
  const lines = prose.split("\n").filter((l: string) => l.trim());
  const paragraphs = prose.split("\n\n").filter((p: string) => p.trim());

  // Word count
  const allWords = prose.split(/\s+/).filter(Boolean).length;

  // Dialogue: words inside quotes
  // 1. Double quotes: ASCII " or smart ""
  // 2. Curly single quotes: '\u2018...\u2019' — \u2018 is unambiguous dialogue opener
  // 3. ASCII single quotes: '...' with contraction handling ('re, 't, 's, etc.)
  const doubleQuoteMatches = prose.match(/[""\u201C][^""\u201D]+[""\u201D]/g) || [];
  const curlySingleMatches = prose.match(/\u2018[^\u2018\u2019]+\u2019/g) || [];
  const asciiSingleMatches = prose.match(/(?:^|[\s(—–])'((?:[^'\n]|'(?=[a-z]))+)'(?=[.,!?;\s—–)]|$)/gm) || [];
  const quoteMatches = [...doubleQuoteMatches, ...curlySingleMatches, ...asciiSingleMatches];
  const dialogueWords = quoteMatches.reduce((sum, m) => sum + m.split(/\s+/).length, 0);
  const dialogueWordRatio = allWords > 0 ? dialogueWords / allWords : 0;

  // Count dialogue exchanges (each quoted string is roughly one exchange)
  const dialogueExchanges = quoteMatches.length;

  // Speech verb count as a secondary dialogue signal
  const speechVerbs = prose.match(/\b(said|asked|replied|whispered|shouted|muttered|called|yelled|answered|exclaimed|murmured|growled|hissed|snapped|demanded|pleaded|insisted|offered|suggested|warned)\b/gi) || [];
  const speechVerbCount = speechVerbs.length;

  // Longest run of consecutive paragraphs without dialogue
  let longestNonDialogueRun = 0;
  let currentRun = 0;
  for (const p of paragraphs) {
    // Paragraph has dialogue if it contains any recognizable quote pattern
    const hasDoubleQ = /[""\u201C]/.test(p);
    const hasCurlySingleQ = /\u2018/.test(p);
    const hasAsciiSingleQ = /(?:^|[\s(—–])'[A-Z]/.test(p); // ASCII ' before uppercase = dialogue start
    if (hasDoubleQ || hasCurlySingleQ || hasAsciiSingleQ) {
      currentRun = 0;
    } else {
      currentRun++;
      longestNonDialogueRun = Math.max(longestNonDialogueRun, currentRun);
    }
  }

  // Interiority markers (thought verbs, internal sensory)
  const interiorityMatches =
    prose.match(
      /\b(thought|wondered|realized|felt|remembered|knew|believed|considered|imagined|feared|hoped|wished|noticed|sensed|recalled|suspected|assumed|understood|pondered|reflected|mused)\b/gi
    ) || [];
  const interiorityDensity =
    allWords > 0 ? interiorityMatches.length / (allWords / 100) : 0;

  // Action verb density
  const actionMatches =
    prose.match(
      /\b(ran|jumped|grabbed|pulled|pushed|threw|hit|kicked|ducked|sprinted|lunged|slammed|yanked|dove|charged|swung|blocked|fired|struck|stabbed|climbed|crawled|leaped|darted|hurled|tackled|wrestled|dragged|shoved|bolted|dashed|scrambled)\b/gi
    ) || [];
  const actionDensity =
    allWords > 0 ? actionMatches.length / (allWords / 100) : 0;

  // Sentence stats
  const sentences = prose
    .split(/[.!?]+/)
    .filter((s: string) => s.trim().length > 10);
  const sentLengths = sentences.map(
    (s: string) => s.trim().split(/\s+/).length
  );
  const avgSentLen =
    sentLengths.length > 0
      ? sentLengths.reduce((a: number, b: number) => a + b, 0) /
        sentLengths.length
      : 0;
  const sentLenStdDev =
    sentLengths.length > 1
      ? Math.sqrt(
          sentLengths.reduce(
            (sum: number, l: number) => sum + (l - avgSentLen) ** 2,
            0
          ) / sentLengths.length
        )
      : 0;
  const sentLenCV = avgSentLen > 0 ? sentLenStdDev / avgSentLen : 0;

  const avgParaLen = paragraphs.length > 0 ? allWords / paragraphs.length : 0;

  return {
    novel: ch.novel_id.slice(-6),
    ch: ch.chapter_number,
    genre: ch.genre || "unknown",
    words: ch.word_count,
    dialogueWordPct: Math.round(dialogueWordRatio * 100),
    interiorityPer100w: Math.round(interiorityDensity * 10) / 10,
    actionPer100w: Math.round(actionDensity * 10) / 10,
    avgSentLen: Math.round(avgSentLen * 10) / 10,
    sentLenCV: Math.round(sentLenCV * 100) / 100,
    paragraphs: paragraphs.length,
    avgParaWords: Math.round(avgParaLen),
    dialogueExchanges,
    speechVerbCount,
    longestNonDialogueRun,
  };
});

// ── Per-genre averages ──────────────────────────────────────────────────
const byGenre: Record<string, ChapterMetrics[]> = {};
for (const r of results) {
  if (!byGenre[r.genre]) byGenre[r.genre] = [];
  byGenre[r.genre].push(r);
}

function avg(arr: ChapterMetrics[], key: keyof ChapterMetrics): number {
  return (
    Math.round(
      (arr.reduce((s, x) => s + (x[key] as number), 0) / arr.length) * 10
    ) / 10
  );
}
function range(
  arr: ChapterMetrics[],
  key: keyof ChapterMetrics
): [number, number] {
  const vals = arr.map((x) => x[key] as number);
  return [Math.min(...vals), Math.max(...vals)];
}

console.log("=== PER-GENRE STRUCTURAL AVERAGES ===");
for (const [genre, chaps] of Object.entries(byGenre)) {
  console.log(`\n${genre} (${chaps.length} chapters):`);
  console.log(
    `  dialogue word%:     avg=${avg(chaps, "dialogueWordPct")}%  range=[${range(chaps, "dialogueWordPct").join("–")}]`
  );
  console.log(
    `  dialogue exchanges: avg=${avg(chaps, "dialogueExchanges")}   range=[${range(chaps, "dialogueExchanges").join("–")}]`
  );
  console.log(
    `  speech verbs:       avg=${avg(chaps, "speechVerbCount")}   range=[${range(chaps, "speechVerbCount").join("–")}]`
  );
  console.log(
    `  max non-dlg run:    avg=${avg(chaps, "longestNonDialogueRun")}¶  range=[${range(chaps, "longestNonDialogueRun").join("–")}]`
  );
  console.log(
    `  interiority/100w:   avg=${avg(chaps, "interiorityPer100w")}   range=[${range(chaps, "interiorityPer100w").join("–")}]`
  );
  console.log(
    `  action/100w:        avg=${avg(chaps, "actionPer100w")}   range=[${range(chaps, "actionPer100w").join("–")}]`
  );
  console.log(
    `  avg sent length:    avg=${avg(chaps, "avgSentLen")}w  range=[${range(chaps, "avgSentLen").join("–")}]`
  );
  console.log(
    `  sent length CV:     avg=${avg(chaps, "sentLenCV")}   range=[${range(chaps, "sentLenCV").join("–")}]`
  );
  console.log(
    `  paragraphs:         avg=${avg(chaps, "paragraphs")}   range=[${range(chaps, "paragraphs").join("–")}]`
  );
  console.log(
    `  avg para words:     avg=${avg(chaps, "avgParaWords")}w  range=[${range(chaps, "avgParaWords").join("–")}]`
  );
}

// ── Cross-genre comparison ──────────────────────────────────────────────
console.log("\n=== CROSS-GENRE COMPARISON ===");
console.log(
  "Genre".padEnd(25) +
    "DlgWd%  SpeechV  Int/100  Act/100  SentLen  SentCV  Paras  ParaW"
);
for (const [genre, chaps] of Object.entries(byGenre)) {
  const row = [
    genre.padEnd(25),
    String(avg(chaps, "dialogueWordPct")).padStart(5),
    String(avg(chaps, "speechVerbCount")).padStart(8),
    String(avg(chaps, "interiorityPer100w")).padStart(8),
    String(avg(chaps, "actionPer100w")).padStart(8),
    String(avg(chaps, "avgSentLen")).padStart(8),
    String(avg(chaps, "sentLenCV")).padStart(7),
    String(avg(chaps, "paragraphs")).padStart(6),
    String(avg(chaps, "avgParaWords")).padStart(6),
  ];
  console.log(row.join(""));
}

// ── All-corpus stats ────────────────────────────────────────────────────
console.log(`\n=== CORPUS-WIDE (${results.length} chapters) ===`);
const allMetricKeys: (keyof ChapterMetrics)[] = [
  "dialogueWordPct",
  "dialogueExchanges",
  "speechVerbCount",
  "longestNonDialogueRun",
  "interiorityPer100w",
  "actionPer100w",
  "avgSentLen",
  "sentLenCV",
  "paragraphs",
  "avgParaWords",
];
for (const key of allMetricKeys) {
  const vals = results.map((r) => r[key] as number);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(
    vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
  );
  const cv = mean > 0 ? std / mean : 0;
  console.log(
    `  ${String(key).padEnd(24)} mean=${mean.toFixed(1).padStart(6)}  std=${std.toFixed(1).padStart(6)}  CV=${cv.toFixed(2).padStart(5)}  range=[${Math.min(...vals).toFixed(1)}–${Math.max(...vals).toFixed(1)}]`
  );
}

// ── Chapter-level detail for 3 largest novels ───────────────────────────
console.log("\n=== CHAPTER-LEVEL DETAIL (3 largest novels) ===");
const novelIds = [...new Set(results.map((r) => r.novel))].slice(0, 3);
for (const nid of novelIds) {
  const chaps = results.filter((r) => r.novel === nid);
  console.log(`\nNovel ...${nid} (${chaps[0].genre}):`);
  for (const c of chaps) {
    console.log(
      `  Ch${String(c.ch).padStart(2)}: ${String(c.words).padStart(4)}w | dlg=${String(c.dialogueWordPct).padStart(2)}% ${String(c.dialogueExchanges).padStart(2)}exc ${String(c.speechVerbCount).padStart(2)}sv | int=${c.interiorityPer100w}/100 act=${c.actionPer100w}/100 | sent=${c.avgSentLen}w cv=${c.sentLenCV} | ${c.paragraphs}¶ | maxNoDlg=${c.longestNonDialogueRun}¶`
    );
  }
}

process.exit(0);
