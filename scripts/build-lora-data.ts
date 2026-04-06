#!/usr/bin/env bun
/**
 * Downloads Robert E. Howard sword-and-sorcery stories from Project Gutenberg,
 * strips boilerplate, chunks into 300-500 word segments, filters dialogue-heavy
 * chunks, and outputs JSONL for LoRA fine-tuning.
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const RAW_DIR = join(import.meta.dir, "../lora-data/raw");
const OUTPUT_FILE = join(import.meta.dir, "../lora-data/howard-training.jsonl");

// All sword-and-sorcery Howard on Gutenberg (Conan, Solomon Kane, Kull)
const STORIES: { id: number; title: string }[] = [
  // Conan / Hyborian Age
  { id: 42243, title: "The Hour of the Dragon" },
  { id: 32759, title: "Red Nails" },
  { id: 42254, title: "Beyond the Black River" },
  { id: 42259, title: "The People of the Black Circle" },
  { id: 42227, title: "A Witch Shall Be Born" },
  { id: 42183, title: "Queen of the Black Coast" },
  { id: 42236, title: "Jewels of Gwahlur" },
  { id: 42196, title: "Shadows in Zamboula" },
  { id: 42188, title: "Shadows in the Moonlight" },
  { id: 42209, title: "The Devil in Iron" },
  { id: 42664, title: "Gods of the North" },
  // Solomon Kane
  { id: 70570, title: "Red Shadows" },
  { id: 70540, title: "Skulls in the Stars" },
  { id: 70653, title: "Rattle of Bones" },
  { id: 77605, title: "The Moon of Skulls" },
  { id: 77603, title: "The Hills of the Dead" },
  // Kull
  { id: 70830, title: "The Shadow Kingdom" },
  { id: 70879, title: "The Mirrors of Tuzun Thune" },
  { id: 77604, title: "Kings of the Night" },
  // Horror/weird fiction with sword-and-sorcery elements
  { id: 71268, title: "Skull-Face" },
  { id: 71085, title: "The Fire of Asshurbanipal" },
  { id: 71168, title: "Black Canaan" },
  { id: 71109, title: "Black Hound of Death" },
  { id: 71180, title: "The Grisly Horror" },
];

// --- Download ---

async function downloadStory(id: number, title: string): Promise<string> {
  const cacheFile = join(RAW_DIR, `${id}.txt`);
  if (existsSync(cacheFile)) {
    return readFileSync(cacheFile, "utf-8");
  }

  // Gutenberg redirects ebooks/N.txt.utf-8 → cache/epub/N/pgN.txt
  const url = `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;
  console.log(`  Downloading: ${title} (${id})...`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  FAILED ${title}: ${res.status}`);
    return "";
  }

  const text = await res.text();
  writeFileSync(cacheFile, text);
  return text;
}

// --- Strip Gutenberg boilerplate ---

function stripBoilerplate(text: string): string {
  // Find start marker
  const startMatch = text.match(/\*\*\* ?START OF (?:THE |THIS )?PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  const endMatch = text.match(/\*\*\* ?END OF (?:THE |THIS )?PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);

  if (startMatch?.index !== undefined) {
    text = text.slice(startMatch.index + startMatch[0].length);
  }
  if (endMatch?.index !== undefined) {
    text = text.slice(0, endMatch.index);
  }

  return text.trim();
}

// --- Filter metadata/editorial content ---

const SKIP_PATTERNS = [
  /^\s*(chapter|part)\s+[ivxlcdm\d]+/i,         // Chapter headings
  /^\s*\d+\.\s*$/,                                // Bare numbers
  /^\s*\*\s*\*\s*\*\s*\*?\s*\*?\s*$/,             // Scene breaks (asterisks)
  /^\s*_{3,}\s*$/,                                 // Underline breaks
  /^\s*-{3,}\s*$/,                                 // Dash breaks
  /^\[transcriber/i,                               // Transcriber notes
  /^\[illustration/i,                              // Illustration notes
  /^\[editor/i,                                    // Editor notes
  /^publisher'?s? note/i,                          // Publisher notes
  /^_?originally published/i,                      // Publication info
  /^copyright/i,                                   // Copyright notices
  /^printed in/i,                                  // Print info
  /^\s*THE END\s*$/i,                              // End markers
  /^\s*FINIS\s*$/i,
  /^\s*by\s+robert\s+e\.?\s+howard\s*$/i,         // Author attribution
  /^\s*\[.+\]\s*$/,                                // Any bracketed editorial note
  /^\s*illustration/i,                             // Illustration references
];

function isMetadata(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  return SKIP_PATTERNS.some((p) => p.test(trimmed));
}

// --- Split into paragraphs ---

function splitParagraphs(text: string): string[] {
  // Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Gutenberg wraps at ~70 chars. Unwrap lines within paragraphs:
  // A paragraph break is 2+ consecutive newlines.
  const rawParagraphs = text.split(/\n{2,}/);

  return rawParagraphs
    .map((p) => {
      // Unwrap hard line breaks within a paragraph
      return p
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(" ");
    })
    .filter((p) => p.length > 0);
}

// --- Word count ---

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

// --- Dialogue percentage ---

function dialoguePercentage(text: string): number {
  // Match text inside quotation marks (both straight and curly)
  const dialogueMatches = text.match(/[""\u201C]([^""\u201D]*?)[""\u201D]/g) || [];
  const dialogueWords = dialogueMatches.reduce((sum, m) => sum + wordCount(m), 0);
  const totalWords = wordCount(text);
  return totalWords > 0 ? dialogueWords / totalWords : 0;
}

// --- Chunk paragraphs into 300-500 word segments with 1-paragraph overlap ---

function chunkParagraphs(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentWords = 0;

  const MIN_WORDS = 300;
  const MAX_WORDS = 500;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const paraWords = wordCount(para);

    // If adding this paragraph would exceed max AND we already have enough
    if (currentWords + paraWords > MAX_WORDS && currentWords >= MIN_WORDS) {
      // Emit chunk
      chunks.push(currentChunk.join("\n\n"));

      // Start new chunk with last paragraph as overlap
      const lastPara = currentChunk[currentChunk.length - 1];
      currentChunk = [lastPara];
      currentWords = wordCount(lastPara);
    }

    currentChunk.push(para);
    currentWords += paraWords;
  }

  // Emit final chunk if it has reasonable content (allow shorter for last chunk)
  if (currentWords >= MIN_WORDS * 0.7) {
    chunks.push(currentChunk.join("\n\n"));
  } else if (chunks.length > 0 && currentChunk.length > 0) {
    // Merge remainder into the last chunk if it's too short
    // But only if combined doesn't get too long
    const lastChunkWords = wordCount(chunks[chunks.length - 1]);
    if (lastChunkWords + currentWords <= MAX_WORDS * 1.3) {
      // Remove the overlap paragraph from currentChunk (it's already in last chunk)
      const extraParas = currentChunk.slice(1);
      if (extraParas.length > 0) {
        chunks[chunks.length - 1] += "\n\n" + extraParas.join("\n\n");
      }
    }
  }

  return chunks;
}

// --- Main ---

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });

  console.log("=== Howard LoRA Training Data Builder ===\n");
  console.log(`Downloading ${STORIES.length} stories from Project Gutenberg...\n`);

  // Download all stories
  const rawTexts: { title: string; text: string }[] = [];
  for (const story of STORIES) {
    const text = await downloadStory(story.id, story.title);
    if (text) {
      rawTexts.push({ title: story.title, text });
    }
    // Small delay to be polite to Gutenberg
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDownloaded ${rawTexts.length} stories.\n`);

  // Process each story
  let allChunks: string[] = [];
  const storyStats: { title: string; paragraphs: number; chunks: number }[] = [];

  for (const { title, text } of rawTexts) {
    // Strip boilerplate
    const stripped = stripBoilerplate(text);

    // Split into paragraphs
    let paragraphs = splitParagraphs(stripped);

    // Filter short paragraphs (< 20 words) — headings, scene breaks, dialogue tags
    paragraphs = paragraphs.filter((p) => wordCount(p) >= 20);

    // Filter metadata/editorial
    paragraphs = paragraphs.filter((p) => !isMetadata(p));

    // Chunk
    const chunks = chunkParagraphs(paragraphs);

    // Filter dialogue-heavy chunks (> 70% dialogue)
    const filteredChunks = chunks.filter((c) => dialoguePercentage(c) <= 0.7);

    const removed = chunks.length - filteredChunks.length;
    storyStats.push({
      title,
      paragraphs: paragraphs.length,
      chunks: filteredChunks.length,
    });

    if (removed > 0) {
      console.log(`  ${title}: ${filteredChunks.length} chunks (${removed} dialogue-heavy removed)`);
    } else {
      console.log(`  ${title}: ${filteredChunks.length} chunks`);
    }

    allChunks.push(...filteredChunks);
  }

  // Final filter: remove any chunks that still contain chapter headings embedded in text
  allChunks = allChunks.filter((c) => {
    const firstLine = c.split("\n")[0].trim();
    // Skip if the chunk starts with a standalone title-like line
    if (/^[A-Z\s]{10,}$/.test(firstLine) && wordCount(firstLine) <= 6) return false;
    return true;
  });

  // Write JSONL
  const jsonlLines = allChunks.map((chunk) => JSON.stringify({ text: chunk }));
  writeFileSync(OUTPUT_FILE, jsonlLines.join("\n") + "\n");

  // --- Stats ---
  const wordCounts = allChunks.map(wordCount);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  const avgWords = Math.round(totalWords / allChunks.length);
  const minWords = Math.min(...wordCounts);
  const maxWords = Math.max(...wordCounts);
  // Rough token estimate: ~1.3 tokens per word for English prose
  const estimatedTokens = Math.round(totalWords * 1.3);

  console.log("\n" + "=".repeat(60));
  console.log("STATS SUMMARY");
  console.log("=".repeat(60));
  console.log(`Stories processed:    ${rawTexts.length}`);
  console.log(`Total chunks:         ${allChunks.length}`);
  console.log(`Average word count:   ${avgWords}`);
  console.log(`Word count range:     ${minWords} - ${maxWords}`);
  console.log(`Total words:          ${totalWords.toLocaleString()}`);
  console.log(`Estimated tokens:     ~${estimatedTokens.toLocaleString()}`);
  console.log(`Output file:          ${OUTPUT_FILE}`);
  console.log(`File size:            ${(jsonlLines.join("\n").length / 1024).toFixed(1)} KB`);

  console.log("\n" + "=".repeat(60));
  console.log("PER-STORY BREAKDOWN");
  console.log("=".repeat(60));
  for (const s of storyStats) {
    console.log(`  ${s.title.padEnd(35)} ${String(s.paragraphs).padStart(4)} paragraphs → ${String(s.chunks).padStart(3)} chunks`);
  }

  // Print first 3 chunks for quality verification
  console.log("\n" + "=".repeat(60));
  console.log("FIRST 3 CHUNKS (for quality verification)");
  console.log("=".repeat(60));

  for (let i = 0; i < Math.min(3, allChunks.length); i++) {
    console.log(`\n--- CHUNK ${i + 1} (${wordCount(allChunks[i])} words, ${Math.round(dialoguePercentage(allChunks[i]) * 100)}% dialogue) ---`);
    console.log(allChunks[i]);
    console.log();
  }

  // Print verification prompts
  console.log("=".repeat(60));
  console.log("VERIFICATION PROMPTS (test base vs LoRA model)");
  console.log("=".repeat(60));
  const prompts = [
    "Write a scene where a lone warrior enters an abandoned temple at dusk. Something waits in the shadows.",
    "Describe a sword fight between two skilled opponents on a rain-slicked stone bridge.",
    "A thief moves through a sleeping city at night, approaching a tower that locals say is cursed.",
  ];
  for (const p of prompts) {
    console.log(`\n  → "${p}"`);
  }
  console.log();
}

main().catch(console.error);
