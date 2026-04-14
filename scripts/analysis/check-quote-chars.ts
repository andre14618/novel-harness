/**
 * Check the actual Unicode characters used for quotes in the prose.
 */
import db from "../../src/db/connection";

const all = await db`
  SELECT cd.novel_id, cd.chapter_number, cd.prose
  FROM chapter_drafts cd
  WHERE cd.status = ${"approved"}
`;

// Aggregate quote char usage across ALL chapters
const globalQuoteChars = new Map<string, number>();
let chaptersWithCurly = 0;
let chaptersWithAscii = 0;

for (const ch of all as any[]) {
  const prose: string = ch.prose || "";
  let hasCurly = false;
  let hasAscii = false;

  for (const c of prose) {
    const code = c.charCodeAt(0);
    if (
      code === 0x27 ||
      code === 0x22 ||
      code === 0x2018 ||
      code === 0x2019 ||
      code === 0x201c ||
      code === 0x201d
    ) {
      const key = `U+${code.toString(16).padStart(4, "0")}`;
      globalQuoteChars.set(key, (globalQuoteChars.get(key) || 0) + 1);
      if (code === 0x2018 || code === 0x2019) hasCurly = true;
      if (code === 0x27) hasAscii = true;
    }
  }
  if (hasCurly) chaptersWithCurly++;
  if (hasAscii) chaptersWithAscii++;
}

console.log("=== Global quote character usage ===");
const labels: Record<string, string> = {
  "U+0027": "' ASCII apostrophe/single quote",
  "U+0022": '" ASCII double quote',
  "U+2018": "\u2018 left single curly",
  "U+2019": "\u2019 right single curly",
  "U+201c": "\u201C left double curly",
  "U+201d": "\u201D right double curly",
};
for (const [code, count] of globalQuoteChars) {
  console.log(`  ${code} ${labels[code] || ""}: ${count} occurrences`);
}
console.log(`\nChapters with curly single quotes: ${chaptersWithCurly}/${all.length}`);
console.log(`Chapters with ASCII single quotes: ${chaptersWithAscii}/${all.length}`);

// Show a dialogue line from a curly-quote chapter
for (const ch of all as any[]) {
  const prose: string = ch.prose || "";
  if (prose.includes("\u2018") || prose.includes("\u2019")) {
    const lines = prose.split("\n").filter((l) => l.trim());
    const dlgLine = lines.find(
      (l) => (l.includes("\u2018") || l.includes("\u2019")) && /\bsaid\b/i.test(l)
    );
    if (dlgLine) {
      console.log(`\nExample curly-quote dialogue from ${ch.novel_id.slice(-8)} Ch${ch.chapter_number}:`);
      console.log(`  ${dlgLine.slice(0, 150)}`);
      // Show hex of first 60 chars
      const hex = [...dlgLine.slice(0, 60)]
        .map((c) => {
          const code = c.charCodeAt(0);
          return code > 127
            ? `[U+${code.toString(16).padStart(4, "0")}]`
            : c;
        })
        .join("");
      console.log(`  hex: ${hex}`);
      break;
    }
  }
}

process.exit(0);
