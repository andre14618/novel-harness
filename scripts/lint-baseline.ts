/**
 * Lint baseline calibration — run patterns against published fiction.
 *
 * Downloads public domain novels from Project Gutenberg and runs all
 * enabled lint regex patterns against them. Reports hits per 1,000 words
 * per pattern, giving a human-prose baseline to compare against AI output.
 *
 * Usage:
 *   bun scripts/lint-baseline.ts                    # run against 3 novels
 *   bun scripts/lint-baseline.ts --ai-run 225       # compare against one AI run
 *   bun scripts/lint-baseline.ts --ai-all-prose      # pool all prose-type runs
 */

import { parseArgs } from "node:util"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import db from "../data/connection"
import { getEnabledPatterns } from "../src/lint/detectors/regex"
import type { LintPattern } from "../src/lint/types"

const { values } = parseArgs({
  options: {
    "ai-run": { type: "string" },
    "ai-all-prose": { type: "boolean", default: false },
  },
})

// ── Gutenberg novels ──────────────────────────────────────────────────

const NOVELS = [
  {
    id: "christie-secret-adversary",
    title: "The Secret Adversary",
    author: "Agatha Christie",
    year: 1922,
    url: "https://www.gutenberg.org/cache/epub/1155/pg1155.txt",
  },
  {
    id: "christie-murder-links",
    title: "The Murder on the Links",
    author: "Agatha Christie",
    year: 1923,
    url: "https://www.gutenberg.org/cache/epub/58866/pg58866.txt",
  },
  {
    id: "cather-my-antonia",
    title: "My Ántonia",
    author: "Willa Cather",
    year: 1918,
    url: "https://www.gutenberg.org/cache/epub/242/pg242.txt",
  },
]

const CACHE_DIR = new URL("../.cache/baseline-novels", import.meta.url).pathname

// ── Download / cache novels ───────────────────────────────────────────

async function loadNovel(novel: typeof NOVELS[0]): Promise<string> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })

  const cachePath = `${CACHE_DIR}/${novel.id}.txt`
  if (existsSync(cachePath)) {
    return readFileSync(cachePath, "utf-8")
  }

  console.log(`  Downloading: ${novel.title}...`)
  const resp = await fetch(novel.url)
  if (!resp.ok) throw new Error(`Failed to download ${novel.title}: ${resp.status}`)
  let text = await resp.text()

  // Strip Gutenberg header/footer
  const startMarkers = ["*** START OF THE PROJECT GUTENBERG", "*** START OF THIS PROJECT GUTENBERG"]
  const endMarkers = ["*** END OF THE PROJECT GUTENBERG", "*** END OF THIS PROJECT GUTENBERG"]

  for (const marker of startMarkers) {
    const idx = text.indexOf(marker)
    if (idx !== -1) {
      text = text.slice(text.indexOf("\n", idx) + 1)
      break
    }
  }
  for (const marker of endMarkers) {
    const idx = text.indexOf(marker)
    if (idx !== -1) {
      text = text.slice(0, idx)
      break
    }
  }

  writeFileSync(cachePath, text.trim())
  return text.trim()
}

// ── Dialogue detection (same as regex detector) ───────────────────────

function isInDialogue(text: string, position: number): boolean {
  let inQuote = false
  for (let i = 0; i < position && i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === '\u201C' || ch === '\u201D') {
      if (ch === '\u201C') inQuote = true
      else if (ch === '\u201D') inQuote = false
      else inQuote = !inQuote
    }
  }
  return inQuote
}

// ── Run patterns against text ─────────────────────────────────────────

interface PatternHits {
  patternId: number
  category: string
  pattern: string
  hits: number
  samples: string[]
}

function runPatterns(text: string, patterns: LintPattern[]): PatternHits[] {
  const results: PatternHits[] = []

  for (const pat of patterns) {
    if (pat.pattern === "-- heuristic --") continue
    const regex = new RegExp(pat.pattern, pat.flags)
    let hits = 0
    const samples: string[] = []
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      if (!pat.dialogue_ok && isInDialogue(text, match.index)) continue
      hits++
      if (samples.length < 3) {
        const start = Math.max(0, match.index - 30)
        const end = Math.min(text.length, match.index + match[0].length + 30)
        samples.push(text.slice(start, end).replace(/\n/g, " ").trim())
      }
    }

    results.push({ patternId: pat.id, category: pat.category, pattern: pat.pattern, hits, samples })
  }

  return results
}

// ── Load AI prose for comparison ──────────────────────────────────────

async function loadAIProse(runId?: number): Promise<{ text: string; wordCount: number }> {
  const rows = runId
    ? await db`SELECT prose FROM generations WHERE run_id = ${runId} AND prose IS NOT NULL ORDER BY id` as { prose: string }[]
    : await db`SELECT g.prose FROM generations g JOIN runs r ON r.id = g.run_id WHERE r.run_type = 'prose' AND g.prose IS NOT NULL ORDER BY g.id` as { prose: string }[]
  const text = rows.map(r => r.prose).join("\n\n")
  return { text, wordCount: text.split(/\s+/).length }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(70))
  console.log("  LINT BASELINE CALIBRATION — Human vs AI pattern density")
  console.log("=".repeat(70))

  // Load patterns
  let patterns = await getEnabledPatterns()
  patterns = patterns.filter(p => p.pattern !== "-- heuristic --")
  console.log(`  Patterns: ${patterns.length} regex rules\n`)

  // Load novels
  const novelData: { novel: typeof NOVELS[0]; text: string; wordCount: number }[] = []
  for (const novel of NOVELS) {
    const text = await loadNovel(novel)
    const wordCount = text.split(/\s+/).length
    novelData.push({ novel, text, wordCount })
    console.log(`  ${novel.title} (${novel.author}, ${novel.year}): ${wordCount.toLocaleString()} words`)
  }

  // Run patterns against each novel
  const humanResults = new Map<number, { category: string; pattern: string; totalHits: number; hitsPerK: number; samples: string[] }>()

  let totalHumanWords = 0
  for (const { novel, text, wordCount } of novelData) {
    totalHumanWords += wordCount
    const hits = runPatterns(text, patterns)
    for (const h of hits) {
      const existing = humanResults.get(h.patternId) ?? {
        category: h.category, pattern: h.pattern, totalHits: 0, hitsPerK: 0, samples: [],
      }
      existing.totalHits += h.hits
      if (existing.samples.length < 3) existing.samples.push(...h.samples.slice(0, 3 - existing.samples.length))
      humanResults.set(h.patternId, existing)
    }
  }

  // Compute per-1k rates
  for (const r of humanResults.values()) {
    r.hitsPerK = (r.totalHits / totalHumanWords) * 1000
  }

  // Optionally load AI prose
  let aiResults: Map<number, { totalHits: number; hitsPerK: number }> | null = null
  let totalAIWords = 0
  const useAI = values["ai-run"] || values["ai-all-prose"]
  if (useAI) {
    const aiRunId = values["ai-run"] ? parseInt(values["ai-run"]!) : undefined
    const { text, wordCount } = await loadAIProse(aiRunId)
    totalAIWords = wordCount
    const label = aiRunId ? `AI run #${aiRunId}` : "All prose runs"
    console.log(`\n  ${label}: ${wordCount.toLocaleString()} words`)
    const hits = runPatterns(text, patterns)
    aiResults = new Map()
    for (const h of hits) {
      aiResults.set(h.patternId, { totalHits: h.hits, hitsPerK: (h.hits / wordCount) * 1000 })
    }
  }

  // ── Report ──────────────────────────────────────────────────────────

  console.log(`\n  Total human corpus: ${totalHumanWords.toLocaleString()} words`)
  if (aiResults) console.log(`  Total AI corpus: ${totalAIWords.toLocaleString()} words`)

  console.log("\n" + "─".repeat(100))
  const header = "Category".padEnd(22) +
    "Pattern".padEnd(32) +
    "Human/1k".padStart(10) +
    (aiResults ? "AI/1k".padStart(10) + "Ratio".padStart(8) : "")
  console.log(header)
  console.log("─".repeat(100))

  // Sort by human hits/k descending
  const sorted = [...humanResults.entries()]
    .sort((a, b) => b[1].hitsPerK - a[1].hitsPerK)

  for (const [patId, r] of sorted) {
    if (r.totalHits === 0 && (!aiResults || !aiResults.get(patId)?.totalHits)) continue

    const patDisplay = r.pattern.length > 30 ? r.pattern.slice(0, 27) + "..." : r.pattern
    let line = r.category.padEnd(22) +
      patDisplay.padEnd(32) +
      r.hitsPerK.toFixed(2).padStart(10)

    if (aiResults) {
      const ai = aiResults.get(patId)
      const aiRate = ai?.hitsPerK ?? 0
      const ratio = r.hitsPerK > 0 ? (aiRate / r.hitsPerK).toFixed(1) : aiRate > 0 ? "∞" : "—"
      line += aiRate.toFixed(2).padStart(10) + String(ratio).padStart(8)
    }

    console.log(line)
  }

  // ── Flagged patterns (high human rate = likely FP-prone) ────────────

  const highHuman = sorted.filter(([, r]) => r.hitsPerK >= 0.5)
  if (highHuman.length > 0) {
    console.log("\n" + "=".repeat(70))
    console.log("  HIGH HUMAN-RATE PATTERNS (≥0.5/1k words — review for FP)")
    console.log("=".repeat(70))

    for (const [, r] of highHuman) {
      console.log(`\n  ${r.category}: /${r.pattern}/`)
      console.log(`  Human rate: ${r.hitsPerK.toFixed(2)}/1k words (${r.totalHits} total hits)`)
      for (const s of r.samples.slice(0, 3)) {
        console.log(`    "${s.slice(0, 100)}"`)
      }
    }
  }

  // ── AI-amplified patterns (high ratio = real signal) ────────────────

  if (aiResults) {
    const amplified = sorted
      .filter(([patId, r]) => {
        const ai = aiResults!.get(patId)
        return ai && r.hitsPerK > 0 && (ai.hitsPerK / r.hitsPerK) >= 3
      })
      .sort((a, b) => {
        const ratioA = (aiResults!.get(a[0])?.hitsPerK ?? 0) / a[1].hitsPerK
        const ratioB = (aiResults!.get(b[0])?.hitsPerK ?? 0) / b[1].hitsPerK
        return ratioB - ratioA
      })

    if (amplified.length > 0) {
      console.log("\n" + "=".repeat(70))
      console.log("  AI-AMPLIFIED PATTERNS (≥3x human rate — strongest signals)")
      console.log("=".repeat(70))

      for (const [patId, r] of amplified) {
        const ai = aiResults.get(patId)!
        console.log(`  ${r.category}: /${r.pattern.slice(0, 50)}/  — ${(ai.hitsPerK / r.hitsPerK).toFixed(1)}x human rate`)
      }
    }
  }

  console.log()
}

main().catch(err => {
  console.error("Baseline calibration failed:", err)
  process.exit(1)
})
