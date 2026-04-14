/**
 * Spot-check inspector for synthetic eval pairs.
 *
 * Reads lora-data/chapter-plan-checker-pairs.jsonl, filters to a single variant
 * (FAIL_MISSING_BEAT by default), and writes a markdown file with each pair's
 * scenario, the beat-that-should-be-missing, the full prose, and a "keyword leak"
 * heuristic that flags content words from the beat 1 description that ALSO appear
 * in the prose. High leak = writer papered over with references; zero leak = clean
 * omission.
 *
 * The point: figure out whether the FAIL_MISSING_BEAT pairs the gpt-oss-120b
 * checker classified as PASS in exp #119 are actually mis-labeled (writer
 * referenced beat 1 as past events, which is a defensible PASS under the rubric)
 * or genuinely missed by the model.
 *
 * Usage:
 *   bun scripts/inspect-pair-variant.ts                    # FAIL_MISSING_BEAT (default)
 *   bun scripts/inspect-pair-variant.ts FAIL_REVERSED_ARC  # any other variant
 *   bun scripts/inspect-pair-variant.ts --pairs lora-data/adherence-checker-pairs.jsonl FAIL_TANGENT
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const PAIRS_ARG_IDX = process.argv.indexOf("--pairs")
const PAIRS_PATH = PAIRS_ARG_IDX !== -1
  ? process.argv[PAIRS_ARG_IDX + 1]
  : join(import.meta.dir, "../../lora-data/chapter-plan-checker-pairs.jsonl")

const variantArg = process.argv.find((a, i) =>
  i >= 2 && !a.startsWith("--") && process.argv[i - 1] !== "--pairs"
)
const VARIANT = variantArg ?? "FAIL_MISSING_BEAT"

const OUT_PATH = join(import.meta.dir, `../../lora-data/inspect-${VARIANT.toLowerCase()}.md`)

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

const STOP_WORDS = new Set([
  "the","that","this","with","from","into","onto","then","than","when","what",
  "which","there","their","they","them","were","have","been","will","would",
  "could","should","might","must","does","done","said","says","like","just",
  "only","very","over","under","after","before","while","until","because","about",
  "where","through","first","last","other","some","each","more","most","such",
])

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w))
}

function extractBeatDescription(userContent: string, beatNum: number): string | null {
  const re = new RegExp(`Beat ${beatNum}: (.+?)\\n`)
  const m = userContent.match(re)
  return m?.[1] ?? null
}

function extractProse(userContent: string): string {
  const marker = "CHAPTER PROSE:\n"
  const idx = userContent.indexOf(marker)
  if (idx === -1) {
    // Fallback for adherence-checker pairs (different format)
    const altMarker = "PROSE:\n"
    const altIdx = userContent.indexOf(altMarker)
    if (altIdx !== -1) return userContent.slice(altIdx + altMarker.length).trim()
    return userContent
  }
  return userContent.slice(idx + marker.length).trim()
}

function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  const pairs: Pair[] = lines.map(l => JSON.parse(l))
  const filtered = pairs.filter(p => p._meta.variant === VARIANT)

  console.log(`Pairs file: ${PAIRS_PATH}`)
  console.log(`Total pairs: ${pairs.length}`)
  console.log(`${VARIANT} pairs: ${filtered.length}\n`)

  if (filtered.length === 0) {
    console.error(`No pairs match variant=${VARIANT}.`)
    console.error(`Available variants: ${[...new Set(pairs.map(p => p._meta.variant))].join(", ")}`)
    process.exit(1)
  }

  const sections: string[] = []
  sections.push(`# ${VARIANT} spot-check`)
  sections.push(``)
  sections.push(`Source: \`${PAIRS_PATH}\``)
  sections.push(`${filtered.length} pairs.`)
  sections.push(``)
  if (VARIANT === "FAIL_MISSING_BEAT") {
    sections.push(`Each pair was generated with the instruction: "skip beat 1, no oblique references."`)
    sections.push(`The deterministic label is FAIL. The question: did the writer actually obey, or did`)
    sections.push(`it paper over with in-medias-res references that the checker is reasonably treating`)
    sections.push(`as PASS?`)
    sections.push(``)
    sections.push(`**Keyword-leak heuristic:** content words ≥4 chars from the beat 1 description that`)
    sections.push(`ALSO appear in the prose. High leak suggests the writer referenced the beat rather`)
    sections.push(`than dropping it. Zero leak is the cleanest FAIL case. Note this is noisy because`)
    sections.push(`some keywords are scene props that naturally appear in other beats.`)
    sections.push(``)
    sections.push(`**The most diagnostic signal is the OPENING of the prose** — what's the first`)
    sections.push(`paragraph? If it's beat 2 starting cold, the writer obeyed. If it's the character`)
    sections.push(`already in the scene with beat 1's events referenced as past, the writer papered over.`)
    sections.push(``)
  }
  sections.push(`---`)
  sections.push(``)

  interface LeakStat {
    scenario: string
    beatDesc: string
    leakCount: number
    totalKeywords: number
    leaked: string[]
    proseFirst200: string
  }
  const leakStats: LeakStat[] = []

  for (const pair of filtered) {
    const userContent = pair.messages[1].content
    const beat1 = extractBeatDescription(userContent, 1)
    const prose = extractProse(userContent)
    const proseFirst200 = prose.split(/\s+/).slice(0, 200).join(" ")

    let leaked: string[] = []
    let beatKeywords: string[] = []
    if (beat1) {
      beatKeywords = [...new Set(extractKeywords(beat1))]
      const proseLower = prose.toLowerCase()
      leaked = beatKeywords.filter(k => new RegExp(`\\b${k}\\b`, "i").test(proseLower))
    }

    leakStats.push({
      scenario: pair._meta.scenario,
      beatDesc: beat1 ?? "(could not parse)",
      leakCount: leaked.length,
      totalKeywords: beatKeywords.length,
      leaked,
      proseFirst200,
    })

    sections.push(`## ${pair._meta.scenario}`)
    sections.push(``)
    if (beat1) {
      sections.push(`**Beat 1 (should be missing):** _${beat1}_`)
      sections.push(``)
      sections.push(`**Keyword leak:** ${leaked.length}/${beatKeywords.length} → ${leaked.length > 0 ? "`" + leaked.join("`, `") + "`" : "_none — clean drop_"}`)
      sections.push(``)
    }
    sections.push(`**Opening (first 200 words):**`)
    sections.push(``)
    sections.push(`> ${proseFirst200.replace(/\n/g, "\n> ")}`)
    sections.push(``)
    sections.push(`<details><summary>Full prose</summary>`)
    sections.push(``)
    sections.push("```")
    sections.push(prose)
    sections.push("```")
    sections.push(``)
    sections.push(`</details>`)
    sections.push(``)
    sections.push(`---`)
    sections.push(``)
  }

  // Insert summary table after the header block
  const summary: string[] = [
    `## Leak summary`,
    ``,
    `| scenario | leak | leaked keywords | beat 1 |`,
    `|---|---:|---|---|`,
  ]
  for (const s of leakStats) {
    summary.push(`| ${s.scenario} | ${s.leakCount}/${s.totalKeywords} | ${s.leaked.join(", ") || "_none_"} | ${s.beatDesc.slice(0, 70)}${s.beatDesc.length > 70 ? "..." : ""} |`)
  }
  summary.push(``)
  const totalLeak = leakStats.reduce((a, s) => a + s.leakCount, 0)
  const totalKw = leakStats.reduce((a, s) => a + s.totalKeywords, 0)
  summary.push(`**Total keyword leak: ${totalLeak}/${totalKw} (${Math.round(100 * totalLeak / totalKw)}%)**`)
  summary.push(``)

  const headerEnd = sections.findIndex(s => s === "---")
  sections.splice(headerEnd, 0, ...summary)

  writeFileSync(OUT_PATH, sections.join("\n"))
  console.log(`Wrote ${OUT_PATH} (${sections.join("\n").length} bytes)\n`)

  console.log("Leak summary (sorted by leak count desc):")
  const sorted = [...leakStats].sort((a, b) => b.leakCount - a.leakCount)
  for (const s of sorted) {
    console.log(`  ${s.scenario.padEnd(28)} ${s.leakCount}/${s.totalKeywords}  ${s.leaked.join(", ")}`)
  }
  console.log(`\nTotal: ${totalLeak}/${totalKw} keywords leaked across ${filtered.length} pairs`)
}

main()
