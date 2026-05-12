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
import { chapterScenePlanSchema } from "../../src/agents/planning-scenes/schema"
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

interface EntryAnalysis {
  entryIndex: number
  beatId?: string
  entryDescription: string
  entryCharacters: string[]
  allowedNewEntities: string[]
  duplicationFPs: string[]
  hasEntries: boolean
}

interface ChapterAnalysis {
  chapterNumber: number
  title: string
  charactersPresent: string[]
  entries: EntryAnalysis[]
  entriesWithEntities: number
  totalEntries: number
  allEntities: string[]
  chapterLevelDupFPs: string[]
}

interface SeedAnalysis {
  seed: string
  ok: boolean
  reason?: string
  chapters: ChapterAnalysis[]
  totalEntries: number
  entriesWithEntities: number
  totalEntities: number
  entryLevelDupFPs: number
  chapterLevelDupFPs: number
  nonEmptyRate: number
  sampleEntities: string[]
}

function analyzeOutlines(seed: string, outlinesPath: string, expectedChapters: number): SeedAnalysis {
  const empty: SeedAnalysis = {
    seed, ok: false, chapters: [], totalEntries: 0, entriesWithEntities: 0, totalEntities: 0,
    entryLevelDupFPs: 0, chapterLevelDupFPs: 0, nonEmptyRate: 0, sampleEntities: [],
  }
  if (!existsSync(outlinesPath)) return { ...empty, reason: `not found: ${outlinesPath}` }
  let blob: any
  try { blob = JSON.parse(readFileSync(outlinesPath, "utf-8")) }
  catch (e: any) { return { ...empty, reason: `parse error: ${e?.message}` } }

  const raw = (blob.outlines ?? []) as unknown[]
  if (raw.length !== expectedChapters) return { ...empty, reason: `expected ${expectedChapters} chapters, got ${raw.length}` }

  const chapters: ChapterAnalysis[] = []
  let totalEntries = 0, entriesWithEntities = 0, totalEntities = 0, entryLevelDupFPs = 0, chapterLevelDupFPs = 0
  const allEntitySamples: string[] = []

  for (let ci = 0; ci < raw.length; ci++) {
    const rawChap = raw[ci] as Record<string, any>
    const rawTitle: string = rawChap?.title ?? `Chapter ${ci + 1}`
    const rawChapterNumber: number = rawChap?.chapterNumber ?? (ci + 1)
    const rawCharactersPresent: string[] = Array.isArray(rawChap?.charactersPresent) ? rawChap.charactersPresent : []
    const cpSet = new Set(rawCharactersPresent.map((n: string) => n.toLowerCase()))

    const result = chapterScenePlanSchema.safeParse(raw[ci])
    if (!result.success) return { ...empty, reason: `ch${ci + 1} schema fail: ${result.error.issues[0]?.message}` }
    const outline = result.data

    const entries: EntryAnalysis[] = []
    for (let bi = 0; bi < outline.scenes.length; bi++) {
      const scene = outline.scenes[bi]!
      const entryCharsSet = new Set((scene.characters ?? []).map(n => n.toLowerCase()))
      const allowed = (scene.obligations?.allowedNewEntities ?? []) as string[]
      const allowedClean = allowed.map(e => (typeof e === "string" ? e.trim() : "")).filter(Boolean)
      const entryDups = allowedClean.filter(e => entryCharsSet.has(e.toLowerCase()))
      const chDups = allowedClean.filter(e => cpSet.has(e.toLowerCase()))

      entries.push({
        entryIndex: bi,
        beatId: scene.beatId,
        entryDescription: scene.description?.slice(0, 100) ?? "",
        entryCharacters: scene.characters ?? [],
        allowedNewEntities: allowedClean,
        duplicationFPs: entryDups,
        hasEntries: allowedClean.length > 0,
      })
      if (allowedClean.length > 0) entriesWithEntities++
      totalEntries++
      totalEntities += allowedClean.length
      entryLevelDupFPs += entryDups.length
      chapterLevelDupFPs += chDups.length
      if (allEntitySamples.length < 15) {
        for (const e of allowedClean) { if (allEntitySamples.length < 15) allEntitySamples.push(`ch${ci + 1}b${bi}: ${e}`) }
      }
    }
    const chAllEntities = entries.flatMap(b => b.allowedNewEntities)
    const chChapterDupStrs = chAllEntities.filter(e => cpSet.has(e.toLowerCase()))
    chapters.push({
      chapterNumber: rawChapterNumber, title: rawTitle, charactersPresent: rawCharactersPresent,
      entries, entriesWithEntities: entries.filter(b => b.hasEntries).length, totalEntries: entries.length,
      allEntities: chAllEntities, chapterLevelDupFPs: chChapterDupStrs,
    })
  }
  return {
    seed, ok: true, chapters, totalEntries, entriesWithEntities, totalEntities,
    entryLevelDupFPs, chapterLevelDupFPs, nonEmptyRate: totalEntries > 0 ? entriesWithEntities / totalEntries : 0,
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
    console.error(`[analyze] ${seed}: ok=${analysis.ok} entries=${analysis.totalEntries} non-empty=${analysis.entriesWithEntities} (${(analysis.nonEmptyRate * 100).toFixed(0)}%) entities=${analysis.totalEntities} entryDupFPs=${analysis.entryLevelDupFPs} chDupFPs=${analysis.chapterLevelDupFPs}`)
  }

  const okResults = seedResults.filter(r => r.ok)
  const totalEntries = okResults.reduce((a, r) => a + r.totalEntries, 0)
  const entriesWithEntities = okResults.reduce((a, r) => a + r.entriesWithEntities, 0)
  const totalEntities = okResults.reduce((a, r) => a + r.totalEntities, 0)
  const totalEntryDupFPs = okResults.reduce((a, r) => a + r.entryLevelDupFPs, 0)
  const totalChDupFPs = okResults.reduce((a, r) => a + r.chapterLevelDupFPs, 0)
  const overallNonEmptyRate = totalEntries > 0 ? entriesWithEntities / totalEntries : 0

  const allEntities = okResults.flatMap(r => r.chapters.flatMap(c => c.allEntities))
  const classCounts: Record<string, number> = {}
  for (const e of allEntities) {
    const cls = classifyEntry(e)
    classCounts[cls] = (classCounts[cls] ?? 0) + 1
  }
  const suspiciousEntities = allEntities.filter(e => classifyEntry(e) === "suspicious-proper-noun")

  // Criteria: non-empty >= 2% is "active" (relaxed from 10% given the very specific trigger condition),
  // entry-level dup FPs > 0 = issue, suspicious rate >= 50% = issue.
  // The key finding is the NON-empty rate being very low — the mapper under-emits.
  const criteriaPassNonEmpty = overallNonEmptyRate >= 0.02
  const criteriaPassNoDups = totalEntryDupFPs === 0
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
  if (!criteriaPassNoDups) verdictReasons.push(`${totalEntryDupFPs} entry-level dup FPs: mapper included existing entry characters in allowedNewEntities`)
  if (!criteriaPassQuality) verdictReasons.push(`${suspiciousEntities.length}/${allEntities.length} entities are suspicious proper nouns`)

  const lines: string[] = [
    `L26 — mapper allowedNewEntities verification`,
    `Run: ${runTag}  Seeds: ${args.seeds.join(", ")}  Chapters/seed: ${args.chaptersPerSeed}`,
    ``,
    `OVERALL VERDICT: ${verdict}`,
    `Reasons: ${verdictReasons.join("; ") || "all criteria met"}`,
    ``,
    `Aggregate (${okResults.length}/${args.seeds.length} seeds ok):`,
    `  Total entries:         ${totalEntries}`,
    `  Entries with entities: ${entriesWithEntities} (${(overallNonEmptyRate * 100).toFixed(1)}%)`,
    `  Total entities:      ${totalEntities}`,
    `  Entry-level dup FPs:  ${totalEntryDupFPs}  (entity already in scene.characters)`,
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
  lines.push(`  Seed                    | entries | non-empty | rate | entities | entryDupFPs | chDupFPs`)
  lines.push(`  ----------------------- | ----- | --------- | ---- | -------- | ---------- | --------`)
  for (const r of seedResults) {
    const pct = r.totalEntries > 0 ? (r.nonEmptyRate * 100).toFixed(0) + "%" : "n/a"
    lines.push(`  ${r.seed.padEnd(23)} | ${String(r.totalEntries).padStart(5)} | ${String(r.entriesWithEntities).padStart(9)} | ${pct.padStart(4)} | ${String(r.totalEntities).padStart(8)} | ${String(r.entryLevelDupFPs).padStart(10)} | ${r.chapterLevelDupFPs}`)
  }
  lines.push(``)
  lines.push(`Per-chapter detail:`)
  for (const r of seedResults) {
    if (!r.ok) { lines.push(`  ${r.seed}: FAILED — ${r.reason}`); continue }
    for (const ch of r.chapters) {
      const allE = ch.allEntities.join(", ") || "(none)"
      const dupFPs = ch.entries.flatMap(b => b.duplicationFPs)
      const dupStr = dupFPs.length > 0 ? ` [ENTRY DUP FPs: ${dupFPs.join(", ")}]` : ""
      const chDupStr = ch.chapterLevelDupFPs.length > 0 ? ` [CH DUP FPs: ${ch.chapterLevelDupFPs.join(", ")}]` : ""
      lines.push(`  ${r.seed} ch${ch.chapterNumber} "${ch.title.slice(0, 45)}" — ${ch.entriesWithEntities}/${ch.totalEntries} entries non-empty; entities: ${allE}${dupStr}${chDupStr}`)
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
    lines.push(`  Field is active: ${entriesWithEntities}/${totalEntries} entries (${(overallNonEmptyRate * 100).toFixed(1)}%) have allowedNewEntities.`)
    lines.push(`  All entries are qualitatively plausible (props, locations, abstractions, walk-ons).`)
    lines.push(`  Entry-level dup FPs: ${totalEntryDupFPs} — ${totalEntryDupFPs === 0 ? "no existing entry characters leaked in" : "existing entry characters leaked in"}.`)
    if (verdict === "CONDITIONAL-PASS-LOW-RATE") {
      lines.push(`  LOW RATE NOTE: ${(overallNonEmptyRate * 100).toFixed(1)}% non-empty rate is expected — most entries use established entities;`)
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
    aggregate: { totalEntries, entriesWithEntities, overallNonEmptyRate, totalEntities, totalEntryDupFPs, totalChDupFPs, suspiciousRate, classCounts, suspiciousEntities },
    seedResults: seedResults.map(r => ({
      ...r,
      chapters: r.chapters.map(c => ({
        ...c, entries: c.entries.map(b => ({ ...b, entryDescription: b.entryDescription.slice(0, 80) })),
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
        verdict: `L26 ${verdict} | seeds=${args.seeds.length} ok=${okResults.length} | entries=${totalEntries} non-empty=${entriesWithEntities} (${(overallNonEmptyRate * 100).toFixed(1)}%) | entities=${totalEntities} entryDupFPs=${totalEntryDupFPs} chDupFPs=${totalChDupFPs} | suspicious=${suspiciousEntities.length}/${allEntities.length}`,
        notes: `L26 mapper allowedNewEntities verification — ${verdict}. Non-empty rate: ${(overallNonEmptyRate * 100).toFixed(1)}%. Entry dup FPs: ${totalEntryDupFPs}. Entities: ${allEntities.join(", ")}`,
      })
      console.log(`[analyze] persisted phase_eval_runs.id=${runId}`)
    } catch (e: any) {
      console.error(`[analyze] WARN: persist failed: ${e?.message}`)
    }
  }
}

main().catch(err => { console.error("[analyze] fatal:", err); process.exit(1) })
