/**
 * Corpus-wide spec echo analysis.
 * Computes bigram overlap between beat descriptions and prose for all
 * approved chapters. Correlates with structural metrics.
 */
import db from "../data/connection"

const rows = await db`
  SELECT co.novel_id, co.chapter_number, co.outline_json, cd.prose, cd.word_count
  FROM chapter_outlines co
  JOIN chapter_drafts cd ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
  WHERE cd.status = 'approved'
  ORDER BY co.novel_id, co.chapter_number
`

console.log("Total approved chapters:", rows.length)

function toBigrams(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean)
  const bg = new Set<string>()
  for (let i = 0; i < words.length - 1; i++) bg.add(words[i] + " " + words[i + 1])
  return bg
}

function specEcho(prose: string, beats: any[]): number {
  const proseBg = toBigrams(prose)
  if (proseBg.size === 0) return 0
  let totalOverlap = 0, totalBg = 0
  for (const b of beats) {
    const descBg = toBigrams(b.description || "")
    if (descBg.size === 0) continue
    let overlap = 0
    for (const bg of descBg) if (proseBg.has(bg)) overlap++
    totalOverlap += overlap
    totalBg += descBg.size
  }
  return totalBg > 0 ? totalOverlap / totalBg : 0
}

function dialoguePct(prose: string): number {
  const allWords = prose.split(/\s+/).filter(Boolean).length
  const matches = prose.match(/["\u201C][^"\u201D]+["\u201D]/g) || []
  const dlgWords = matches.reduce((s, m) => s + m.split(/\s+/).length, 0)
  return allWords > 0 ? dlgWords / allWords : 0
}

function interiority(prose: string): number {
  const allWords = prose.split(/\s+/).filter(Boolean).length
  const matches = prose.match(
    /\b(thought|wondered|realized|felt|remembered|knew|believed|considered|imagined|feared|hoped|wished|noticed|sensed|recalled|suspected|assumed|understood|pondered|reflected|mused)\b/gi
  ) || []
  return allWords > 0 ? matches.length / (allWords / 100) : 0
}

function sentVariety(prose: string) {
  const sents = prose.split(/[.!?]+/).filter((s: string) => s.trim().length > 10)
  const lens = sents.map((s: string) => s.trim().split(/\s+/).length)
  if (lens.length < 2) return { avg: 0, cv: 0 }
  const avg = lens.reduce((a, b) => a + b, 0) / lens.length
  const std = Math.sqrt(lens.reduce((s, l) => s + (l - avg) ** 2, 0) / lens.length)
  return { avg: Math.round(avg * 10) / 10, cv: avg > 0 ? Math.round(std / avg * 100) / 100 : 0 }
}

interface ChResult {
  novel: string; ch: number
  echo: number; dlgPct: number; intPer100: number
  sentAvg: number; sentCV: number
  beats: number; avgDescWords: number; words: number
}

const results: ChResult[] = rows.map((r: any) => {
  const outline = typeof r.outline_json === "string" ? JSON.parse(r.outline_json) : r.outline_json
  const beats = outline.scenes || []
  const prose: string = r.prose || ""
  const echo = specEcho(prose, beats)
  const dlg = dialoguePct(prose)
  const int_ = interiority(prose)
  const sv = sentVariety(prose)
  const avgBeatDescWords = beats.length > 0
    ? beats.reduce((s: number, b: any) => s + (b.description || "").split(/\s+/).length, 0) / beats.length
    : 0
  return {
    novel: r.novel_id.slice(-6), ch: r.chapter_number,
    echo: Math.round(echo * 100) / 100,
    dlgPct: Math.round(dlg * 100),
    intPer100: Math.round(int_ * 10) / 10,
    sentAvg: sv.avg, sentCV: sv.cv,
    beats: beats.length, avgDescWords: Math.round(avgBeatDescWords),
    words: r.word_count,
  }
})

// Bucket by echo level
const low = results.filter(r => r.echo < 0.15)
const mid = results.filter(r => r.echo >= 0.15 && r.echo < 0.30)
const high = results.filter(r => r.echo >= 0.30)

function bucketAvg(arr: ChResult[], key: keyof ChResult): string {
  if (arr.length === 0) return "n/a"
  return (arr.reduce((s, r) => s + (r[key] as number), 0) / arr.length).toFixed(1)
}

console.log("\n=== SPEC ECHO BUCKETS ===")
console.log(`Low echo (<0.15):     n=${low.length}  dlg=${bucketAvg(low, "dlgPct")}%  int=${bucketAvg(low, "intPer100")}/100  sentAvg=${bucketAvg(low, "sentAvg")}w  sentCV=${bucketAvg(low, "sentCV")}  avgDescWords=${bucketAvg(low, "avgDescWords")}`)
console.log(`Mid echo (0.15-0.30): n=${mid.length}  dlg=${bucketAvg(mid, "dlgPct")}%  int=${bucketAvg(mid, "intPer100")}/100  sentAvg=${bucketAvg(mid, "sentAvg")}w  sentCV=${bucketAvg(mid, "sentCV")}  avgDescWords=${bucketAvg(mid, "avgDescWords")}`)
console.log(`High echo (>=0.30):   n=${high.length}  dlg=${bucketAvg(high, "dlgPct")}%  int=${bucketAvg(high, "intPer100")}/100  sentAvg=${bucketAvg(high, "sentAvg")}w  sentCV=${bucketAvg(high, "sentCV")}  avgDescWords=${bucketAvg(high, "avgDescWords")}`)

// Pearson correlations
const n = results.length
function pearson(xKey: keyof ChResult, yKey: keyof ChResult): number {
  const meanX = results.reduce((s, r) => s + (r[xKey] as number), 0) / n
  const meanY = results.reduce((s, r) => s + (r[yKey] as number), 0) / n
  let num = 0, denX = 0, denY = 0
  for (const r of results) {
    num += ((r[xKey] as number) - meanX) * ((r[yKey] as number) - meanY)
    denX += ((r[xKey] as number) - meanX) ** 2
    denY += ((r[yKey] as number) - meanY) ** 2
  }
  return (denX > 0 && denY > 0) ? num / Math.sqrt(denX * denY) : 0
}

console.log("\n=== CORRELATIONS ===")
console.log(`r(echo, dialogue%):        ${pearson("echo", "dlgPct").toFixed(3)}`)
console.log(`r(echo, interiority):      ${pearson("echo", "intPer100").toFixed(3)}`)
console.log(`r(echo, sentCV):           ${pearson("echo", "sentCV").toFixed(3)}`)
console.log(`r(echo, avgDescWords):     ${pearson("echo", "avgDescWords").toFixed(3)}`)
console.log(`r(avgDescWords, dialogue): ${pearson("avgDescWords", "dlgPct").toFixed(3)}`)
console.log(`r(beats, dialogue):        ${pearson("beats", "dlgPct").toFixed(3)}`)
console.log(`r(beats, echo):            ${pearson("beats", "echo").toFixed(3)}`)

// Echo distribution
const echoVals = results.map(r => r.echo).sort((a, b) => a - b)
console.log("\n=== ECHO DISTRIBUTION ===")
console.log(`min=${echoVals[0]}  p25=${echoVals[Math.floor(n * 0.25)]}  median=${echoVals[Math.floor(n * 0.5)]}  p75=${echoVals[Math.floor(n * 0.75)]}  max=${echoVals[n - 1]}`)

// Extremes
console.log("\n=== LOWEST ECHO (most interpretive) ===")
const sorted = [...results].sort((a, b) => a.echo - b.echo)
for (const r of sorted.slice(0, 5)) {
  console.log(`  ${r.novel} ch${r.ch}: echo=${r.echo} dlg=${r.dlgPct}% int=${r.intPer100} beats=${r.beats} descW=${r.avgDescWords}`)
}
console.log("\n=== HIGHEST ECHO (most transcriptive) ===")
for (const r of sorted.slice(-5)) {
  console.log(`  ${r.novel} ch${r.ch}: echo=${r.echo} dlg=${r.dlgPct}% int=${r.intPer100} beats=${r.beats} descW=${r.avgDescWords}`)
}

// Per-novel averages
const byNovel: Record<string, ChResult[]> = {}
for (const r of results) {
  if (!byNovel[r.novel]) byNovel[r.novel] = []
  byNovel[r.novel].push(r)
}
console.log("\n=== PER-NOVEL AVERAGES ===")
console.log("Novel   Chs  Echo   Dlg%  Int/100  SentCV  DescW  Beats")
for (const [novel, chaps] of Object.entries(byNovel)) {
  const avg = (key: keyof ChResult) => (chaps.reduce((s, r) => s + (r[key] as number), 0) / chaps.length).toFixed(1)
  console.log(`${novel}  ${String(chaps.length).padStart(3)}  ${avg("echo").padStart(5)}  ${avg("dlgPct").padStart(5)}  ${avg("intPer100").padStart(7)}  ${avg("sentCV").padStart(6)}  ${avg("avgDescWords").padStart(5)}  ${avg("beats").padStart(5)}`)
}

process.exit(0)
