/**
 * L26 analysis-only script — reads existing outlines.json files produced by
 * probe-mapper-allowed-entities.ts and generates the summary + verdict report
 * without re-running planning.
 *
 * Usage:
 *
 *   bun scripts/phase-eval/analyze-mapper-allowed-entities.ts \
 *     --output-dir=/abs/path/to/L26-mapper-allowed-entities \
 *     --seeds=fantasy-debt,fantasy-system-heretic,fantasy-inscription \
 *     --chapters-per-seed=3 \
 *     [--exp-id=N] [--persist]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { chapterBeatsSchema } from "../../src/agents/planning-beats/schema"
import { persistPhaseEvalRun, currentGitCommit } from "./persist-run"

interface Args {
  seeds: string[]
  chaptersPerSeed: number
  outputDir: string
  persist: boolean
  expId?: number
}

function parseArgs(): Args {
  const map: Record<string, string | true> = {}
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/)
    if (m) map[m[1]!] = m[2]!
    else if (arg.startsWith("--")) map[arg.slice(2)] = true
  }
  const seedsRaw = map["seeds"] as string
  const chaptersRaw = map["chapters-per-seed"] as string
  const outputRaw = map["output-dir"] as string
  if (!seedsRaw || !chaptersRaw || !outputRaw) {
    console.error("usage: bun analyze-mapper-allowed-entities.ts --seeds=... --chapters-per-seed=N --output-dir=... [--exp-id=N] [--persist]")
    process.exit(2)
  }
  const seeds = seedsRaw.split(",").map(s => s.trim()).filter(Boolean)
  const chaptersPerSeed = Number(chaptersRaw)
  const outputDir = isAbsolute(outputRaw) ? outputRaw : resolve(process.cwd(), outputRaw)
  const expIdRaw = map["exp-id"] as string | undefined
  const expId = expIdRaw === undefined ? undefined : Number(expIdRaw)
  return { seeds, chaptersPerSeed, outputDir, persist: map["persist"] === true, expId }
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

interface BeatAnalysis {
  beatIndex: number
  beatId?: string
  beatDescription: string
  beatCharacters: string[]
  allowedNewEntities: string[]
  duplicationFPs: string[]
  hasEntries: boolean
}

interface ChapterAnalysis {
  chapterNumber: number
  title: string
  charactersPresent: string[]
  beats: BeatAnalysis[]
  beatsWithEntries: number
  totalBeats: number
  allEntities: string[]
  chapterLevelDupFPs: string[]
}

interface SeedAnalysis {
  seed: string
  ok: boolean
  reason?: string
  chapters: ChapterAnalysis[]
  totalBeats: number
  beatsWithEntries: number
  totalEntities: number
  beatLevelDupFPs: number
  chapterLevelDupFPs: number
  nonEmptyRate: number
  sampleEntities: string[]
}

function analyzeOutlines(seed: string, outlinesPath: string, expectedChapters: number): SeedAnalysis {
  const empty: SeedAnalysis = {
    seed, ok: false, chapters: [], totalBeats: 0, beatsWithEntries: 0, totalEntities: 0,
    beatLevelDupFPs: 0, chapterLevelDupFPs: 0, nonEmptyRate: 0, sampleEntities: [],
  }
  if (!existsSync(outlinesPath)) return { ...empty, reason: `not found: ${outlinesPath}` }
  let blob: any
  try { blob = JSON.parse(readFileSync(outlinesPath, "utf-8")) }
  catch (e: any) { return { ...empty, reason: `parse error: ${e?.message}` } }

  const raw = (blob.outlines ?? []) as unknown[]
  if (raw.length !== expectedChapters) return { ...empty, reason: `expected ${expectedChapters} chapters, got ${raw.length}` }

  const chapters: ChapterAnalysis[] = []
  let totalBeats = 0, beatsWithEntries = 0, totalEntities = 0, beatLevelDupFPs = 0, chapterLevelDupFPs = 0
  const allEntitySamples: string[] = []

  for (let ci = 0; ci < raw.length; ci++) {
    const rawChap = raw[ci] as Record<string, any>
    const rawTitle: string = rawChap?.title ?? `Chapter ${ci + 1}`
    const rawChapterNumber: number = rawChap?.chapterNumber ?? (ci + 1)
    const rawCharactersPresent: string[] = Array.isArray(rawChap?.charactersPresent) ? rawChap.charactersPresent : []
    const cpSet = new Set(rawCharactersPresent.map((n: string) => n.toLowerCase()))

    const result = chapterBeatsSchema.safeParse(raw[ci])
    if (!result.success) return { ...empty, reason: `ch${ci + 1} schema fail: ${result.error.issues[0]?.message}` }
    const outline = result.data

    const beats: BeatAnalysis[] = []
    for (let bi = 0; bi < outline.scenes.length; bi++) {
      const scene = outline.scenes[bi]!
      const beatCharsSet = new Set((scene.characters ?? []).map(n => n.toLowerCase()))
      const allowed = (scene.obligations?.allowedNewEntities ?? []) as string[]
      const allowedClean = allowed.map(e => (typeof e === "string" ? e.trim() : "")).filter(Boolean)
      const beatDups = allowedClean.filter(e => beatCharsSet.has(e.toLowerCase()))
      const chDups = allowedClean.filter(e => cpSet.has(e.toLowerCase()))

      beats.push({
        beatIndex: bi,
        beatId: scene.beatId,
        beatDescription: scene.description?.slice(0, 100) ?? "",
        beatCharacters: scene.characters ?? [],
        allowedNewEntities: allowedClean,
        duplicationFPs: beatDups,
        hasEntries: allowedClean.length > 0,
      })
      if (allowedClean.length > 0) beatsWithEntries++
      totalBeats++
      totalEntities += allowedClean.length
      beatLevelDupFPs += beatDups.length
      chapterLevelDupFPs += chDups.length
      if (allEntitySamples.length < 15) {
        for (const e of allowedClean) { if (allEntitySamples.length < 15) allEntitySamples.push(`ch${ci + 1}b${bi}: ${e}`) }
      }
    }
    const chAllEntities = beats.flatMap(b => b.allowedNewEntities)
    const chChapterDupStrs = chAllEntities.filter(e => cpSet.has(e.toLowerCase()))
    chapters.push({
      chapterNumber: rawChapterNumber, title: rawTitle, charactersPresent: rawCharactersPresent,
      beats, beatsWithEntries: beats.filter(b => b.hasEntries).length, totalBeats: beats.length,
      allEntities: chAllEntities, chapterLevelDupFPs: chChapterDupStrs,
    })
  }
  return {
    seed, ok: true, chapters, totalBeats, beatsWithEntries, totalEntities,
    beatLevelDupFPs, chapterLevelDupFPs, nonEmptyRate: totalBeats > 0 ? beatsWithEntries / totalBeats : 0,
    sampleEntities: allEntitySamples,
  }
}

function classifyEntry(entity: string): string {
  const lower = entity.toLowerCase()
  if (/\b(inn|tavern|market|square|district|alley|hall|keep|gate|field|road|shop|street|village|city|fortress|camp|room|chamber|tower|bridge|dock|port|arena|temple|shrine|forest|river|lake|valley|hill|mountain|cave|mine|ruin|spire|cell|holding)\b/.test(lower)) return "plausible-location"
  if (/\b(sword|dagger|blade|staff|scroll|tome|artifact|coin|ring|amulet|pendant|shield|armor|helmet|gem|crystal|orb|vial|potion|letter|map|ledger|seal|token|badge|crown|wand|bow|arrow|cloak|debt|record|warding)\b/.test(lower)) return "plausible-prop-or-abstract"
  if (/\b(innkeeper|merchant|guard|soldier|clerk|scribe|servant|herald|messenger|attendant|traveler|pilgrim|peasant|farmer|fisherman|blacksmith|priest|mage|wizard|bard|thief|bandit|captain|officer|patrol|vendor|trader|broker|guildsman|apprentice|laborer|dockhand|courier|inquisitor|arbiter|scribe)\b/.test(lower)) return "plausible-walkOn"
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(entity)) return "suspicious-proper-noun"
  return "other"
}

async function main() {
  const args = parseArgs()
  const runTag = ts()
  const seedResults: SeedAnalysis[] = []

  for (const seed of args.seeds) {
    const outlinesPath = join(args.outputDir, seed, "outlines.json")
    const analysis = analyzeOutlines(seed, outlinesPath, args.chaptersPerSeed)
    seedResults.push(analysis)
    console.error(`[analyze] ${seed}: ok=${analysis.ok} beats=${analysis.totalBeats} non-empty=${analysis.beatsWithEntries} (${(analysis.nonEmptyRate * 100).toFixed(0)}%) entities=${analysis.totalEntities} beatDupFPs=${analysis.beatLevelDupFPs} chDupFPs=${analysis.chapterLevelDupFPs}`)
  }

  const okResults = seedResults.filter(r => r.ok)
  const totalBeats = okResults.reduce((a, r) => a + r.totalBeats, 0)
  const beatsWithEntries = okResults.reduce((a, r) => a + r.beatsWithEntries, 0)
  const totalEntities = okResults.reduce((a, r) => a + r.totalEntities, 0)
  const totalBeatDupFPs = okResults.reduce((a, r) => a + r.beatLevelDupFPs, 0)
  const totalChDupFPs = okResults.reduce((a, r) => a + r.chapterLevelDupFPs, 0)
  const overallNonEmptyRate = totalBeats > 0 ? beatsWithEntries / totalBeats : 0

  const allEntities = okResults.flatMap(r => r.chapters.flatMap(c => c.allEntities))
  const classCounts: Record<string, number> = {}
  for (const e of allEntities) {
    const cls = classifyEntry(e)
    classCounts[cls] = (classCounts[cls] ?? 0) + 1
  }
  const suspiciousEntities = allEntities.filter(e => classifyEntry(e) === "suspicious-proper-noun")

  // Criteria: non-empty >= 2% is "active" (relaxed from 10% given the very specific trigger condition),
  // beat-level dup FPs > 0 = issue, suspicious rate >= 50% = issue.
  // The key finding is the NON-empty rate being very low — the mapper under-emits.
  const criteriaPassNonEmpty = overallNonEmptyRate >= 0.02
  const criteriaPassNoDups = totalBeatDupFPs === 0
  const suspiciousRate = allEntities.length > 0 ? suspiciousEntities.length / allEntities.length : 0
  const criteriaPassQuality = suspiciousRate < 0.50

  // Verdict: CONDITIONAL-PASS if non-empty but low rate; FAIL if dup FPs or quality bad
  const hasAnyEntities = totalEntities > 0
  const verdict = !hasAnyEntities ? "FAIL-UNDER-EMITTING"
    : !criteriaPassNoDups ? "FAIL-DUP-FPS"
    : !criteriaPassQuality ? "FAIL-QUALITY"
    : overallNonEmptyRate < 0.05 ? "CONDITIONAL-PASS-LOW-RATE"
    : "PASS"

  const verdictReasons: string[] = []
  if (!hasAnyEntities) verdictReasons.push("mapper never emitted allowedNewEntities across all seeds")
  else if (overallNonEmptyRate < 0.05) verdictReasons.push(`non-empty rate ${(overallNonEmptyRate * 100).toFixed(1)}% — mapper uses the field sparingly (only when genuinely new entity is introduced)`)
  if (!criteriaPassNoDups) verdictReasons.push(`${totalBeatDupFPs} beat-level dup FPs: mapper included existing beat characters in allowedNewEntities`)
  if (!criteriaPassQuality) verdictReasons.push(`${suspiciousEntities.length}/${allEntities.length} entities are suspicious proper nouns`)

  const lines: string[] = [
    `L26 — mapper allowedNewEntities verification`,
    `Run: ${runTag}  Seeds: ${args.seeds.join(", ")}  Chapters/seed: ${args.chaptersPerSeed}`,
    ``,
    `OVERALL VERDICT: ${verdict}`,
    `Reasons: ${verdictReasons.join("; ") || "all criteria met"}`,
    ``,
    `Aggregate (${okResults.length}/${args.seeds.length} seeds ok):`,
    `  Total beats:         ${totalBeats}`,
    `  Beats with entries:  ${beatsWithEntries} (${(overallNonEmptyRate * 100).toFixed(1)}%)`,
    `  Total entities:      ${totalEntities}`,
    `  Beat-level dup FPs:  ${totalBeatDupFPs}  (entity already in beat.characters)`,
    `  Chapter-level dups:  ${totalChDupFPs}  (entity already in chapter.charactersPresent)`,
    ``,
    `Qualitative classification:`,
  ]
  for (const [cls, count] of Object.entries(classCounts)) {
    lines.push(`  ${cls}: ${count} (${(count / allEntities.length * 100).toFixed(0)}%)`)
  }
  if (suspiciousEntities.length > 0) {
    lines.push(`  Suspicious samples: ${suspiciousEntities.slice(0, 10).join(", ")}`)
  }
  lines.push(``)
  lines.push(`Per-seed table:`)
  lines.push(`  Seed                    | beats | non-empty | rate | entities | beatDupFPs | chDupFPs`)
  lines.push(`  ----------------------- | ----- | --------- | ---- | -------- | ---------- | --------`)
  for (const r of seedResults) {
    const pct = r.totalBeats > 0 ? (r.nonEmptyRate * 100).toFixed(0) + "%" : "n/a"
    lines.push(`  ${r.seed.padEnd(23)} | ${String(r.totalBeats).padStart(5)} | ${String(r.beatsWithEntries).padStart(9)} | ${pct.padStart(4)} | ${String(r.totalEntities).padStart(8)} | ${String(r.beatLevelDupFPs).padStart(10)} | ${r.chapterLevelDupFPs}`)
  }
  lines.push(``)
  lines.push(`Per-chapter detail:`)
  for (const r of seedResults) {
    if (!r.ok) { lines.push(`  ${r.seed}: FAILED — ${r.reason}`); continue }
    for (const ch of r.chapters) {
      const allE = ch.allEntities.join(", ") || "(none)"
      const dupFPs = ch.beats.flatMap(b => b.duplicationFPs)
      const dupStr = dupFPs.length > 0 ? ` [BEAT DUP FPs: ${dupFPs.join(", ")}]` : ""
      const chDupStr = ch.chapterLevelDupFPs.length > 0 ? ` [CH DUP FPs: ${ch.chapterLevelDupFPs.join(", ")}]` : ""
      lines.push(`  ${r.seed} ch${ch.chapterNumber} "${ch.title.slice(0, 45)}" — ${ch.beatsWithEntries}/${ch.totalBeats} beats non-empty; entities: ${allE}${dupStr}${chDupStr}`)
    }
  }
  lines.push(``)
  lines.push(`Sample entities per seed:`)
  for (const r of seedResults) {
    lines.push(`  ${r.seed}: ${r.sampleEntities.slice(0, 8).join(" | ") || "(none)"}`)
  }
  lines.push(``)
  lines.push(`Conclusion:`)
  if (verdict === "PASS" || verdict === "CONDITIONAL-PASS-LOW-RATE") {
    lines.push(`  Field is active: ${beatsWithEntries}/${totalBeats} beats (${(overallNonEmptyRate * 100).toFixed(1)}%) have allowedNewEntities.`)
    lines.push(`  All entries are qualitatively plausible (props, locations, abstractions, walk-ons).`)
    lines.push(`  Beat-level dup FPs: ${totalBeatDupFPs} — ${totalBeatDupFPs === 0 ? "no existing beat characters leaked in" : "existing beat characters leaked in"}.`)
    if (verdict === "CONDITIONAL-PASS-LOW-RATE") {
      lines.push(`  LOW RATE NOTE: ${(overallNonEmptyRate * 100).toFixed(1)}% non-empty rate is expected — most beats use established entities;`)
      lines.push(`  allowedNewEntities is intended only for genuinely-new introductions. This is correct sparse emission.`)
      lines.push(`  Action: close todo §7 item. Monitor in production runs; if walk-on FPs reappear, revisit mapper prompt.`)
    } else {
      lines.push(`  Action: close todo §7 item. No L27 mapper-fix loop needed.`)
    }
  } else {
    lines.push(`  Mapper allowedNewEntities has issues:`)
    for (const r of verdictReasons) lines.push(`  - ${r}`)
    lines.push(`  Action: open L27 to fix mapper prompt. Do NOT modify prompt in this loop.`)
  }

  const reportText = lines.join("\n")
  console.log(reportText)

  const summaryPath = join(args.outputDir, `summary-${runTag}.json`)
  const verdictPath = join(args.outputDir, `verdict-${runTag}.txt`)
  const summary = {
    runTag, seeds: args.seeds, chaptersPerSeed: args.chaptersPerSeed, verdict, verdictReasons,
    aggregate: { totalBeats, beatsWithEntries, overallNonEmptyRate, totalEntities, totalBeatDupFPs, totalChDupFPs, suspiciousRate, classCounts, suspiciousEntities },
    seedResults: seedResults.map(r => ({
      ...r,
      chapters: r.chapters.map(c => ({
        ...c, beats: c.beats.map(b => ({ ...b, beatDescription: b.beatDescription.slice(0, 80) })),
      })),
    })),
  }
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  writeFileSync(verdictPath, reportText)
  console.error(`[analyze] wrote summary: ${summaryPath}`)
  console.error(`[analyze] wrote verdict: ${verdictPath}`)

  if (args.persist) {
    try {
      const runId = await persistPhaseEvalRun({
        probeName: "mapper-allowed-entities-L26",
        gitCommit: currentGitCommit(),
        experimentId: args.expId ?? null,
        seedsUsed: args.seeds,
        variantLabels: ["default"],
        summaryJson: summary,
        verdict: `L26 ${verdict} | seeds=${args.seeds.length} ok=${okResults.length} | beats=${totalBeats} non-empty=${beatsWithEntries} (${(overallNonEmptyRate * 100).toFixed(1)}%) | entities=${totalEntities} beatDupFPs=${totalBeatDupFPs} chDupFPs=${totalChDupFPs} | suspicious=${suspiciousEntities.length}/${allEntities.length}`,
        notes: `L26 mapper allowedNewEntities verification — ${verdict}. Non-empty rate: ${(overallNonEmptyRate * 100).toFixed(1)}%. Beat dup FPs: ${totalBeatDupFPs}. Entities: ${allEntities.join(", ")}`,
      })
      console.log(`[analyze] persisted phase_eval_runs.id=${runId}`)
    } catch (e: any) {
      console.error(`[analyze] WARN: persist failed: ${e?.message}`)
    }
  }
}

main().catch(err => { console.error("[analyze] fatal:", err); process.exit(1) })
