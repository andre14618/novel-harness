/**
 * L26 probe — verify allowedNewEntities mapper behavior.
 *
 * For each seed, runs concept + planning (mapper included), then analyzes
 * every beat's `obligations.allowedNewEntities` list for:
 *
 *   1. Non-empty rate — what fraction of beats have at least one entry
 *   2. Duplication FP — entities that already appear in the beat's own
 *      `scene.characters` list (= mapper duplicated an existing character)
 *   3. Qualitative sample — first few entries per chapter to sanity-check
 *      whether entries look like walk-ons/props/locations vs hallucinated
 *      proper nouns or existing story characters
 *
 * Usage:
 *
 *   bun scripts/phase-eval/probe-mapper-allowed-entities.ts \
 *     --seeds=fantasy-debt,fantasy-system-heretic,fantasy-inscription \
 *     --chapters-per-seed=3 \
 *     --output-dir=/abs/path/to/output \
 *     [--exp-id=N] \
 *     [--persist]
 *
 * Writes:
 *   <output-dir>/summary-<ts>.json — raw per-seed + per-chapter metrics
 *   <output-dir>/verdict-<ts>.txt  — human-readable verdict table
 *
 * Cleanup: created novels are removed after analysis (concept + planning
 * runs are ephemeral probes, not production data).
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { chapterBeatsSchema } from "../../src/agents/planning-beats/schema"
import { persistPhaseEvalRun, currentGitCommit } from "./persist-run"

// ── Argument parsing ──────────────────────────────────────────────────

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
    console.error(
      "usage: bun probe-mapper-allowed-entities.ts \\\n" +
      "  --seeds=<seed1,seed2,...> \\\n" +
      "  --chapters-per-seed=<N> \\\n" +
      "  --output-dir=<abs-path> \\\n" +
      "  [--exp-id=N] [--persist]"
    )
    process.exit(2)
  }
  const seeds = seedsRaw.split(",").map(s => s.trim()).filter(Boolean)
  const chaptersPerSeed = Number(chaptersRaw)
  if (!Number.isInteger(chaptersPerSeed) || chaptersPerSeed < 1) {
    console.error(`--chapters-per-seed must be a positive integer`)
    process.exit(2)
  }
  const outputDir = isAbsolute(outputRaw) ? outputRaw : resolve(process.cwd(), outputRaw)
  const expIdRaw = map["exp-id"] as string | undefined
  const expId = expIdRaw === undefined ? undefined : Number(expIdRaw)
  return { seeds, chaptersPerSeed, outputDir, persist: map["persist"] === true, expId }
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

// ── Novel lifecycle ───────────────────────────────────────────────────

async function runConceptPhase(seed: string, chaptersPerSeed: number, novelId: string): Promise<void> {
  console.error(`[L26] concept → seed=${seed} chapters=${chaptersPerSeed} novel_id=${novelId}`)
  const { setAutoMode, setResolverMode } = await import("../../src/cli")
  setAutoMode(true)
  setResolverMode("auto")

  const { runConceptPhase: runConcept } = await import("../../src/phases/concept")
  const { createNovel } = await import("../../src/db/novels")

  const seedPath = resolve(process.cwd(), "src", "seeds", `${seed}.json`)
  if (!existsSync(seedPath)) throw new Error(`seed not found: ${seedPath}`)
  const seedJson = JSON.parse(readFileSync(seedPath, "utf-8"))
  seedJson.chapterCount = chaptersPerSeed

  await createNovel(novelId, seedJson)
  const result = await runConcept(novelId, seedJson)
  if (result.kind !== "complete") throw new Error(`concept phase paused: ${result.reason}`)

  const { default: db } = await import("../../src/db/connection")
  await db`UPDATE novels SET phase = 'planning', updated_at = now() WHERE id = ${novelId}`
  console.error(`[L26]   concept done: chars=${result.output.characterCount}`)
}

function cloneForVariant(source: string, target: string): void {
  console.error(`[L26] clone ${source} → ${target}`)
  const result = spawnSync("bun", [
    "scripts/variant/clone-for-variant.ts",
    "--source", source,
    "--target", target,
    "--target-phase", "concept-done",
  ], { stdio: ["ignore", "inherit", "inherit"] })
  if (result.status !== 0) throw new Error(`clone-for-variant failed (exit ${result.status})`)
}

function runPlanningVariant(novelId: string, outputDir: string, expId?: number): void {
  // Use the default state-mapper prompt (no override — we're testing production behavior)
  const variantPromptPath = resolve(
    process.cwd(),
    "scripts/phase-eval/variants/planning-state-mapper/default.md"
  )
  console.error(`[L26] run planning → novel=${novelId} output=${outputDir}`)
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PLANNING_STATE_MAPPER_PROMPT_OVERRIDE: variantPromptPath,
  }
  if (expId !== undefined) env.EXPERIMENT_ID = String(expId)
  const result = spawnSync("bun", [
    "scripts/phase-eval/run-variant.ts",
    `--novel-id=${novelId}`,
    `--output-dir=${outputDir}`,
  ], { env, stdio: ["ignore", "inherit", "inherit"] })
  if (result.status !== 0) throw new Error(`run-variant failed for novel=${novelId} (exit ${result.status})`)
}

async function cleanupNovel(novelId: string): Promise<void> {
  try {
    const { clearNovelState } = await import("../../tests/phase-parity/db-snapshot")
    await clearNovelState(novelId)
    console.error(`[L26] cleaned up ${novelId}`)
  } catch (e: any) {
    console.error(`[L26] WARN: cleanup failed for ${novelId}: ${e?.message ?? e}`)
  }
}

// ── allowedNewEntities analysis ───────────────────────────────────────

interface BeatAnalysis {
  beatIndex: number
  beatId?: string
  beatDescription: string
  beatCharacters: string[]
  allowedNewEntities: string[]
  duplicationFPs: string[]   // entities already in beatCharacters
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
  chapterLevelDupFPs: string[]  // entities already in charactersPresent
}

interface SeedAnalysis {
  seed: string
  novelId: string
  ok: boolean
  reason?: string
  chapters: ChapterAnalysis[]
  totalBeats: number
  beatsWithEntries: number
  totalEntities: number
  beatLevelDupFPs: number
  chapterLevelDupFPs: number
  nonEmptyRate: number
  sampleEntities: string[]  // first 10 entities across all chapters
}

function analyzeOutlines(seed: string, novelId: string, outlinesPath: string, expectedChapters: number): SeedAnalysis {
  const empty: SeedAnalysis = {
    seed, novelId, ok: false,
    chapters: [], totalBeats: 0, beatsWithEntries: 0, totalEntities: 0,
    beatLevelDupFPs: 0, chapterLevelDupFPs: 0, nonEmptyRate: 0, sampleEntities: [],
  }

  if (!existsSync(outlinesPath)) return { ...empty, reason: `outlines.json not found: ${outlinesPath}` }

  let blob: any
  try {
    blob = JSON.parse(readFileSync(outlinesPath, "utf-8"))
  } catch (e: any) {
    return { ...empty, reason: `JSON parse error: ${e?.message}` }
  }

  const raw = (blob.outlines ?? []) as unknown[]
  if (raw.length !== expectedChapters) {
    return { ...empty, reason: `expected ${expectedChapters} chapters, got ${raw.length}` }
  }

  const chapters: ChapterAnalysis[] = []
  let totalBeats = 0
  let beatsWithEntries = 0
  let totalEntities = 0
  let beatLevelDupFPs = 0
  let chapterLevelDupFPs = 0
  const allEntitySamples: string[] = []

  for (let ci = 0; ci < raw.length; ci++) {
    // Read raw fields first — chapterBeatsSchema doesn't declare title/chapterNumber/charactersPresent
    // (they're in chapterOutlineSchema), so we pull them from the raw JSON before schema parse.
    const rawChap = raw[ci] as Record<string, any>
    const rawTitle: string = rawChap?.title ?? `Chapter ${ci + 1}`
    const rawChapterNumber: number = rawChap?.chapterNumber ?? (ci + 1)
    const rawCharactersPresent: string[] = Array.isArray(rawChap?.charactersPresent) ? rawChap.charactersPresent : []

    const result = chapterBeatsSchema.safeParse(raw[ci])
    if (!result.success) {
      return { ...empty, reason: `chapter ${ci + 1} schema fail: ${result.error.issues[0]?.message}` }
    }
    const outline = result.data
    const cpSet = new Set(rawCharactersPresent.map((n: string) => n.toLowerCase()))

    const beats: BeatAnalysis[] = []
    for (let bi = 0; bi < outline.scenes.length; bi++) {
      const scene = outline.scenes[bi]!
      const beatCharsSet = new Set((scene.characters ?? []).map(n => n.toLowerCase()))
      const allowed = (scene.obligations?.allowedNewEntities ?? []) as string[]
      const allowedClean = allowed.map(e => (typeof e === "string" ? e.trim() : "")).filter(Boolean)

      // Beat-level duplication: already in the beat's own characters list
      const beatDups = allowedClean.filter(e => beatCharsSet.has(e.toLowerCase()))
      // Chapter-level duplication: already in the chapter's charactersPresent
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
        for (const e of allowedClean) {
          if (allEntitySamples.length < 15) allEntitySamples.push(`ch${ci + 1}b${bi}: ${e}`)
        }
      }
    }

    const chAllEntities = beats.flatMap(b => b.allowedNewEntities)
    const chChapterDupStrs = chAllEntities.filter(e => cpSet.has(e.toLowerCase()))

    chapters.push({
      chapterNumber: rawChapterNumber,
      title: rawTitle,
      charactersPresent: rawCharactersPresent,
      beats,
      beatsWithEntries: beats.filter(b => b.hasEntries).length,
      totalBeats: beats.length,
      allEntities: chAllEntities,
      chapterLevelDupFPs: chChapterDupStrs,
    })
  }

  const nonEmptyRate = totalBeats > 0 ? beatsWithEntries / totalBeats : 0

  return {
    seed, novelId, ok: true,
    chapters, totalBeats, beatsWithEntries, totalEntities,
    beatLevelDupFPs, chapterLevelDupFPs, nonEmptyRate, sampleEntities: allEntitySamples,
  }
}

// ── Qualitative classifier ────────────────────────────────────────────
// Simple heuristic: walk-on/prop/location vs generic-placeholder vs
// suspicious-proper-noun. NOT meant to be precise — just a rough signal
// for the verdict.

function classifyEntry(entity: string): "plausible-walkOn" | "plausible-prop" | "plausible-location" | "suspicious" | "empty" {
  if (!entity.trim()) return "empty"
  const lower = entity.toLowerCase()
  // Location keywords
  if (/\b(inn|tavern|market|square|district|alley|hall|keep|gate|field|road|shop|street|village|city|fortress|camp|room|chamber|tower|bridge|docks?|port|arena|temple|shrine|forest|river|lake|valley|hills?|mountain|cave|mine|ruins?)\b/.test(lower)) return "plausible-location"
  // Prop/artifact keywords
  if (/\b(sword|dagger|blade|staff|scroll|tome|artifact|coin|ring|amulet|pendant|shield|armor|helmet|gem|crystal|orb|vial|potion|letter|map|ledger|seal|token|badge|crown|wand|bow|arrow|cloak)\b/.test(lower)) return "plausible-prop"
  // Generic walk-on titles/roles
  if (/\b(innkeeper|merchant|guard|soldier|clerk|scribe|servant|herald|messenger|attendant|traveler|pilgrim|peasant|farmer|fisherman|blacksmith|priest|mage|wizard|bard|thief|bandit|captain|officer|patrol|vendor|trader|broker|guildsman|apprentice|laborer|dockhand|courier)\b/.test(lower)) return "plausible-walkOn"
  // Looks like a named person (capitalized word(s), no obvious role/type)
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(entity)) return "suspicious"
  return "plausible-walkOn"  // default: give benefit of the doubt for short entries
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  const runTag = ts()
  mkdirSync(args.outputDir, { recursive: true })

  const createdNovelIds: string[] = []
  const seedResults: SeedAnalysis[] = []

  try {
    for (const seed of args.seeds) {
      const conceptId = `l26-concept-${seed}-${runTag}`
      await runConceptPhase(seed, args.chaptersPerSeed, conceptId)
      createdNovelIds.push(conceptId)

      const planningId = `l26-planning-${seed}-${runTag}`
      cloneForVariant(conceptId, planningId)
      createdNovelIds.push(planningId)

      const seedOutputDir = join(args.outputDir, seed)
      mkdirSync(seedOutputDir, { recursive: true })
      runPlanningVariant(planningId, seedOutputDir, args.expId)

      const outlinesPath = join(seedOutputDir, "outlines.json")
      const analysis = analyzeOutlines(seed, planningId, outlinesPath, args.chaptersPerSeed)
      seedResults.push(analysis)
      console.error(`[L26] ${seed}: ok=${analysis.ok} beats=${analysis.totalBeats} non-empty=${analysis.beatsWithEntries} (${(analysis.nonEmptyRate * 100).toFixed(0)}%) entities=${analysis.totalEntities} beatDupFPs=${analysis.beatLevelDupFPs} chDupFPs=${analysis.chapterLevelDupFPs}`)
    }

    // ── Aggregate stats ───────────────────────────────────────────────
    const okResults = seedResults.filter(r => r.ok)
    const totalBeats = okResults.reduce((a, r) => a + r.totalBeats, 0)
    const beatsWithEntries = okResults.reduce((a, r) => a + r.beatsWithEntries, 0)
    const totalEntities = okResults.reduce((a, r) => a + r.totalEntities, 0)
    const totalBeatDupFPs = okResults.reduce((a, r) => a + r.beatLevelDupFPs, 0)
    const totalChDupFPs = okResults.reduce((a, r) => a + r.chapterLevelDupFPs, 0)
    const overallNonEmptyRate = totalBeats > 0 ? beatsWithEntries / totalBeats : 0

    // Qualitative classification of all entities
    const allEntities = okResults.flatMap(r => r.chapters.flatMap(c => c.allEntities))
    const classCounts: Record<string, number> = {}
    for (const e of allEntities) {
      const cls = classifyEntry(e)
      classCounts[cls] = (classCounts[cls] ?? 0) + 1
    }
    const suspiciousEntities = okResults.flatMap(r =>
      r.chapters.flatMap(c =>
        c.allEntities.filter(e => classifyEntry(e) === "suspicious")
      )
    )

    // ── Verdict ───────────────────────────────────────────────────────
    // Criteria for "functioning well":
    //   1. Non-empty rate across all seeds >= 10% (mapper actually uses the field)
    //   2. Beat-level dup FPs == 0 (no entity already in beat.characters)
    //   3. Qualitative: suspicious-class entities < 50% of all entities
    const criteriaPassNonEmpty = overallNonEmptyRate >= 0.10
    const criteriaPassNoDups = totalBeatDupFPs === 0
    const suspiciousRate = allEntities.length > 0 ? suspiciousEntities.length / allEntities.length : 0
    const criteriaPassQuality = suspiciousRate < 0.50

    const verdict = criteriaPassNonEmpty && criteriaPassNoDups && criteriaPassQuality
      ? "PASS"
      : "FAIL"

    const verdictReasons: string[] = []
    if (!criteriaPassNonEmpty) verdictReasons.push(`non-empty rate ${(overallNonEmptyRate * 100).toFixed(1)}% < 10% threshold (mapper under-emitting)`)
    if (!criteriaPassNoDups) verdictReasons.push(`${totalBeatDupFPs} beat-level duplication FPs (mapper duplicating existing beat characters)`)
    if (!criteriaPassQuality) verdictReasons.push(`${suspiciousEntities.length}/${allEntities.length} (${(suspiciousRate * 100).toFixed(0)}%) entities look like proper nouns (possible hallucination or existing character duplication)`)

    // ── Report ─────────────────────────────────────────────────────────
    const lines: string[] = [
      `L26 — mapper allowedNewEntities verification`,
      `Run: ${runTag}  Seeds: ${args.seeds.join(", ")}  Chapters/seed: ${args.chaptersPerSeed}`,
      ``,
      `OVERALL: ${verdict}${verdictReasons.length ? ` — ` + verdictReasons.join("; ") : ""}`,
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
      lines.push(`  ${cls}: ${count} (${allEntities.length > 0 ? (count / allEntities.length * 100).toFixed(0) : 0}%)`)
    }
    if (suspiciousEntities.length > 0) {
      lines.push(`  Suspicious samples: ${suspiciousEntities.slice(0, 10).join(", ")}`)
    }
    lines.push(``)
    lines.push(`Per-seed table:`)
    lines.push(`  Seed                    | ok  | beats | non-empty | entities | beatDupFPs | chDupFPs | non-empty%`)
    lines.push(`  ----------------------- | --- | ----- | --------- | -------- | ---------- | -------- | ----------`)
    for (const r of seedResults) {
      const pct = r.totalBeats > 0 ? (r.nonEmptyRate * 100).toFixed(0) + "%" : "n/a"
      lines.push(`  ${r.seed.padEnd(23)} | ${r.ok ? "yes" : "no "} | ${String(r.totalBeats).padStart(5)} | ${String(r.beatsWithEntries).padStart(9)} | ${String(r.totalEntities).padStart(8)} | ${String(r.beatLevelDupFPs).padStart(10)} | ${String(r.chapterLevelDupFPs).padStart(8)} | ${pct}`)
    }
    lines.push(``)
    lines.push(`Sample entities per seed:`)
    for (const r of seedResults) {
      lines.push(`  ${r.seed}: ${r.sampleEntities.slice(0, 8).join(" | ") || "(none)"}`)
    }
    lines.push(``)
    lines.push(`Per-chapter detail:`)
    for (const r of seedResults) {
      if (!r.ok) {
        lines.push(`  ${r.seed}: FAILED — ${r.reason}`)
        continue
      }
      for (const ch of r.chapters) {
        const allE = ch.allEntities.join(", ") || "(none)"
        const dupFPs = ch.beats.flatMap(b => b.duplicationFPs)
        const dupStr = dupFPs.length > 0 ? ` [DUP FPs: ${dupFPs.join(", ")}]` : ""
        lines.push(`  ${r.seed} ch${ch.chapterNumber} "${ch.title.slice(0, 40)}" — ${ch.beatsWithEntries}/${ch.totalBeats} beats non-empty; entities: ${allE}${dupStr}`)
      }
    }
    lines.push(``)
    lines.push(`Conclusion:`)
    if (verdict === "PASS") {
      lines.push(`  mapper emits allowedNewEntities on legitimate walk-ons/props/locations without duplicating existing characters.`)
      lines.push(`  Non-empty rate ${(overallNonEmptyRate * 100).toFixed(1)}% — field is actively used.`)
      lines.push(`  Beat-level dup FPs: 0 — no existing beat characters leaked into allowedNewEntities.`)
      lines.push(`  Chapter-level dups: ${totalChDupFPs} — ${totalChDupFPs === 0 ? "none" : "some chapter-wide characters appear (expected if they debut in a beat and are then listed at chapter level)"}.`)
      lines.push(`  Action: close todo §7 item. No L27 mapper-fix loop needed.`)
    } else {
      lines.push(`  mapper allowedNewEntities behavior has issues:`)
      for (const r of verdictReasons) lines.push(`  - ${r}`)
      lines.push(`  Action: open L27 to fix mapper prompt behavior. Do NOT modify prompt in this loop.`)
    }

    const reportText = lines.join("\n")
    console.log(reportText)

    // ── Write files ───────────────────────────────────────────────────
    const summaryPath = join(args.outputDir, `summary-${runTag}.json`)
    const verdictPath = join(args.outputDir, `verdict-${runTag}.txt`)
    const summary = {
      runTag, seeds: args.seeds, chaptersPerSeed: args.chaptersPerSeed,
      verdict, verdictReasons,
      aggregate: {
        totalBeats, beatsWithEntries, overallNonEmptyRate, totalEntities,
        totalBeatDupFPs, totalChDupFPs, suspiciousRate,
        classCounts, suspiciousEntities: suspiciousEntities.slice(0, 20),
      },
      seedResults: seedResults.map(r => ({
        ...r,
        // Truncate beat descriptions in the JSON to keep it readable
        chapters: r.chapters.map(c => ({
          ...c,
          beats: c.beats.map(b => ({ ...b, beatDescription: b.beatDescription.slice(0, 80) })),
        })),
      })),
    }
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
    writeFileSync(verdictPath, reportText)
    console.error(`[L26] wrote summary: ${summaryPath}`)
    console.error(`[L26] wrote verdict: ${verdictPath}`)

    // ── Persist to phase_eval_runs ────────────────────────────────────
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
          notes: `L26 mapper allowedNewEntities verification — ${verdict}`,
        })
        console.log(`[L26] persisted phase_eval_runs.id=${runId}`)
      } catch (e: any) {
        console.error(`[L26] WARN: persist failed: ${e?.message}`)
      }
    }

  } finally {
    // Always cleanup
    for (const id of createdNovelIds) {
      await cleanupNovel(id)
    }
  }
}

main().catch(err => {
  console.error("[L26] fatal:", err)
  process.exit(1)
})
