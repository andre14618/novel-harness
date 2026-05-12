/**
 * Phase-eval probe — multi-seed planning-scenes variance measurement.
 *
 * Sibling of `probe-planning-scenes.ts`. Same child-process model
 * (`run-variant.ts`), same prompt-override env var contract, same
 * `clone-for-variant --target-phase=concept-done` reuse pattern.
 * The single-seed probe stays as the historical paired-variant comparison
 * shape; this script answers a different question: **for a single
 * fixed prompt, how does variance behave across (seeds × reruns)?**
 *
 * Closes `docs/todo.md` §9: "Compare 1 seed × 10 chapters vs 3 seeds × 5
 * chapters." Picks the default future probe shape by measured variance,
 * not intuition.
 *
 * Shape:
 *
 *   For each seed in --seeds:
 *     1. Load src/seeds/<seed>.json, override chapterCount=<chapters-per-seed>.
 *     2. Run concept ONCE → concept-snapshot novel.
 *     3. For r in 1..<reruns-per-seed>:
 *        a. clone-for-variant concept-snapshot → rerun novel.
 *        b. Spawn run-variant.ts child with the chosen variant prompt.
 *        c. Collect outlines.json from disk.
 *
 *   Aggregate across all (seed, rerun) cells:
 *     - Per-cell metrics (facts_median, know_median, total_scenes, etc.)
 *     - Per-seed variance (std deviation across reruns for each seed)
 *     - Across-seed variance (std deviation across seed-medians)
 *     - Across-cell variance (std deviation across all reruns from all seeds)
 *
 * Why a separate script (not a flag on probe-planning-scenes.ts):
 * - The single-seed probe's verdict shape (G1-G5 control-vs-test) is
 *   completely different from a variance scan. Forcing one script to do
 *   both would tangle the verdict logic. Sibling scripts let each
 *   stay narrow.
 * - The single-seed shape stays as the historical probe shape per
 *   user instruction.
 *
 * Usage:
 *
 *   bun scripts/phase-eval/probe-planning-scenes-multiseed.ts \
 *     --seeds=fantasy-debt,fantasy-system-heretic,fantasy-inscription \
 *     --chapters-per-seed=5 \
 *     --reruns-per-seed=3 \
 *     --variant=default \
 *     --variant-dir=scripts/phase-eval/variants/planning-scenes \
 *     --output-base=output/phase-eval/multiseed-<run-tag> \
 *     [--prompt-env=PLANNING_SCENES_PROMPT_OVERRIDE] \
 *     [--persist] [--exp-id=<n>] [--note='...']
 *     [--keep-novels]   (default: cleanup created novels at end)
 *
 * `--variant-dir` must contain `<variant>.md`. Only ONE variant is run
 * (the variance question is about a fixed prompt across seeds and reruns
 * — paired comparison is for the single-seed probe).
 *
 * Cost note: each seed pays concept ONCE plus N planning runs.
 *   3 seeds × 5 chapters × 3 reruns ≈ 3 × ($0.012 concept + 3 × $0.07 planning)
 *   ≈ $0.66. Budget cap on the calling loop is $6.
 *
 * Persistence (`--persist`): writes one row to `phase_eval_runs` with
 * probe_name='multi-seed-probe-shape-comparison', seeds_used=<seed list>,
 * variant_labels=[variant_id], summary_json containing per-cell metrics,
 * per-seed aggregates, and across-seed/across-cell variance numbers.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve, basename } from "node:path"
import { chapterScenePlanSchema } from "../../src/agents/planning-scenes/schema"
import { validateBeatObligationCoverage } from "../../src/harness/beat-obligations"

// ── Argument parsing ─────────────────────────────────────────────────

interface Args {
  seeds: string[]
  chaptersPerSeed: number
  rerunsPerSeed: number
  variant: string
  variantDir: string
  outputBase: string
  /** Env var the child run-variant should use to override the system prompt.
   *  Defaults to PLANNING_SCENES_PROMPT_OVERRIDE — the only mode this
   *  variance probe is designed for today. The single-seed probe supports
   *  more; keep this one narrow. */
  promptEnv: string
  keepNovels: boolean
  persist: boolean
  expId?: number
  note?: string
}

const SUPPORTED_PROMPT_ENVS = new Set([
  "PLANNING_SCENES_PROMPT_OVERRIDE",
  "PLANNING_PLOTTER_PROMPT_OVERRIDE",
  "PLANNING_STATE_MAPPER_PROMPT_OVERRIDE",
])

function parseArgs(): Args {
  const map: Record<string, string | true> = {}
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/)
    if (m) map[m[1]!] = m[2]!
    else if (arg.startsWith("--")) map[arg.slice(2)] = true
  }
  const seedsRaw = map["seeds"] as string
  const chaptersRaw = map["chapters-per-seed"] as string
  const rerunsRaw = map["reruns-per-seed"] as string
  const variant = map["variant"] as string
  const variantDir = map["variant-dir"] as string
  const outputBase = map["output-base"] as string
  if (!seedsRaw || !chaptersRaw || !rerunsRaw || !variant || !variantDir || !outputBase) {
    console.error(
      "usage: bun probe-planning-scenes-multiseed.ts \\\n" +
      "  --seeds=<seed1,seed2,seed3> \\\n" +
      "  --chapters-per-seed=<N> \\\n" +
      "  --reruns-per-seed=<M> \\\n" +
      "  --variant=<variant-id> \\\n" +
      "  --variant-dir=<dir-with-{variant}.md-file> \\\n" +
      "  --output-base=<absolute-output-dir> \\\n" +
      "  [--prompt-env=PLANNING_SCENES_PROMPT_OVERRIDE|PLANNING_PLOTTER_PROMPT_OVERRIDE|PLANNING_STATE_MAPPER_PROMPT_OVERRIDE] \\\n" +
      "  [--persist] [--exp-id=<n>] [--note='...']\\\n" +
      "  [--keep-novels]   (default: cleanup created novels at end)"
    )
    process.exit(2)
  }
  const seeds = seedsRaw.split(",").map(s => s.trim()).filter(Boolean)
  if (seeds.length < 2) {
    console.error("--seeds must list at least 2 seeds")
    process.exit(2)
  }
  const chaptersPerSeed = Number(chaptersRaw)
  const rerunsPerSeed = Number(rerunsRaw)
  if (!Number.isInteger(chaptersPerSeed) || chaptersPerSeed <= 0) {
    console.error(`--chapters-per-seed must be a positive integer, got: ${chaptersRaw}`)
    process.exit(2)
  }
  if (!Number.isInteger(rerunsPerSeed) || rerunsPerSeed <= 0) {
    console.error(`--reruns-per-seed must be a positive integer, got: ${rerunsRaw}`)
    process.exit(2)
  }
  const promptEnv = (map["prompt-env"] as string | undefined)?.trim() || "PLANNING_SCENES_PROMPT_OVERRIDE"
  if (!SUPPORTED_PROMPT_ENVS.has(promptEnv)) {
    console.error(`--prompt-env must be one of: ${[...SUPPORTED_PROMPT_ENVS].join(", ")} (got '${promptEnv}')`)
    process.exit(2)
  }
  const expIdRaw = map["exp-id"] as string | undefined
  const expId = expIdRaw === undefined ? undefined : Number(expIdRaw)
  if (expIdRaw !== undefined && !Number.isFinite(expId)) {
    console.error(`--exp-id must be an integer, got: ${expIdRaw}`)
    process.exit(2)
  }
  const outputBaseAbs = isAbsolute(outputBase) ? outputBase : resolve(process.cwd(), outputBase)
  const variantDirAbs = isAbsolute(variantDir) ? variantDir : resolve(process.cwd(), variantDir)
  return {
    seeds,
    chaptersPerSeed,
    rerunsPerSeed,
    variant,
    variantDir: variantDirAbs,
    outputBase: outputBaseAbs,
    promptEnv,
    keepNovels: map["keep-novels"] === true,
    persist: map["persist"] === true,
    expId,
    note: map["note"] as string | undefined,
  }
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

// ── Concept setup with chapterCount override ─────────────────────────

/** Run concept once for a seed, persisting an in-memory chapterCount
 *  override into the novel's seed_json. The planner reads
 *  novel.seed.chapterCount to set its target chapter count, so mutating
 *  the in-memory seed before createNovel is sufficient — no on-disk seed
 *  file modification, no probe-only branch in the planner. */
async function setupConceptSnapshot(seed: string, chaptersPerSeed: number): Promise<string> {
  const novelId = `phase-eval-multiseed-concept-${seed}-c${chaptersPerSeed}-${ts()}`
  console.error(`[probe-ms] concept setup → seed=${seed} chapters=${chaptersPerSeed} novel_id=${novelId}`)

  const { setAutoMode, setResolverMode } = await import("../../src/cli")
  setAutoMode(true)
  setResolverMode("auto")

  const { runConceptPhase } = await import("../../src/phases/concept")
  const { createNovel } = await import("../../src/db/novels")

  const seedPath = resolve(process.cwd(), "src", "seeds", `${seed}.json`)
  if (!existsSync(seedPath)) throw new Error(`seed not found: ${seedPath}`)
  const seedJson = JSON.parse(readFileSync(seedPath, "utf-8"))
  const originalChapterCount = seedJson.chapterCount
  seedJson.chapterCount = chaptersPerSeed
  console.error(`[probe-ms]   seed.chapterCount: ${originalChapterCount} → ${chaptersPerSeed} (in-memory override for probe)`)
  await createNovel(novelId, seedJson)

  const result = await runConceptPhase(novelId, seedJson)
  if (result.kind !== "complete") throw new Error(`concept phase paused: ${result.reason}`)
  // Move row from default phase='concept' to 'planning' so
  // clone-for-variant --target-phase=concept-done finds it in the right
  // state. Same dance as probe-planning-scenes.ts.
  const { default: db } = await import("../../src/db/connection")
  await db`UPDATE novels SET phase = 'planning', updated_at = now() WHERE id = ${novelId}`
  console.error(`[probe-ms]   concept complete: characters=${result.output.characterCount} systems=${result.output.worldSystemsCount} cultures=${result.output.culturesCount}`)
  return novelId
}

function cloneForVariant(source: string, target: string): void {
  console.error(`[probe-ms] clone ${source} → ${target}`)
  const result = spawnSync("bun", [
    "scripts/variant/clone-for-variant.ts",
    "--source", source,
    "--target", target,
    "--target-phase", "concept-done",
  ], { stdio: ["ignore", "inherit", "inherit"] })
  if (result.status !== 0) {
    throw new Error(`clone-for-variant failed for target=${target} (exit ${result.status})`)
  }
}

function runVariantChild(novelId: string, promptFile: string, variantOutputDir: string, promptEnv: string, expId?: number): void {
  console.error(`[probe-ms] run-variant → ${novelId} ${promptEnv}=${basename(promptFile)}`)
  const env: Record<string, string> = { ...process.env as Record<string, string>, [promptEnv]: promptFile }
  if (expId !== undefined) env.EXPERIMENT_ID = String(expId)
  const result = spawnSync("bun", [
    "scripts/phase-eval/run-variant.ts",
    `--novel-id=${novelId}`,
    `--output-dir=${variantOutputDir}`,
  ], { env, stdio: ["ignore", "inherit", "inherit"] })
  if (result.status !== 0) {
    throw new Error(`run-variant failed for novel=${novelId} (exit ${result.status})`)
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────

async function cleanupNovels(novelIds: string[], reason: string): Promise<void> {
  if (novelIds.length === 0) return
  console.error(`[probe-ms] cleanup (${reason}): clearing ${novelIds.length} novel(s)`)
  const { clearNovelState } = await import("../../tests/phase-parity/db-snapshot")
  for (const id of novelIds) {
    try {
      await clearNovelState(id)
      console.error(`[probe-ms]   cleared ${id}`)
    } catch (e: any) {
      console.error(`[probe-ms]   FAILED to clear ${id}: ${e?.message ?? e}`)
    }
  }
}

// ── Per-cell metrics ─────────────────────────────────────────────────

interface CellMetrics {
  seed: string
  rerun: number
  novelId: string
  ok: boolean
  reason?: string
  facts_median: number
  knowledge_median: number
  state_median: number
  total_scenes: number
  total_obligations: number
  total_orphans: number
  overloaded_entries: number
  chapters_total: number
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length
}

/** Sample standard deviation (n-1 denominator). Returns 0 for n<2. */
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const mu = mean(xs)
  const variance = xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

function computeCellMetrics(seed: string, rerun: number, novelId: string, outlinesPath: string, expectedChapters: number): CellMetrics {
  const empty = {
    seed, rerun, novelId, ok: false,
    facts_median: 0, knowledge_median: 0, state_median: 0, total_scenes: 0,
    total_obligations: 0, total_orphans: 0, overloaded_entries: 0, chapters_total: 0,
  }
  if (!existsSync(outlinesPath)) {
    return { ...empty, reason: `outlines.json not found: ${outlinesPath}` }
  }
  let blob: any
  try {
    blob = JSON.parse(readFileSync(outlinesPath, "utf-8"))
  } catch (e: any) {
    return { ...empty, reason: `JSON parse error: ${e?.message ?? e}` }
  }
  const raw = (blob.outlines ?? []) as unknown[]
  if (raw.length !== expectedChapters) {
    return { ...empty, reason: `expected ${expectedChapters} chapters, got ${raw.length}` }
  }
  const outlines: ReturnType<typeof chapterScenePlanSchema.parse>[] = []
  for (let i = 0; i < raw.length; i++) {
    const result = chapterScenePlanSchema.safeParse(raw[i])
    if (!result.success) {
      return { ...empty, reason: `chapter ${i + 1} fails schema: ${result.error.issues.slice(0, 2).map(e => `${e.path.join(".")}: ${e.message}`).join("; ")}` }
    }
    outlines.push(result.data)
  }
  const facts = outlines.map(o => o.establishedFacts.length)
  const knowledge = outlines.map(o => o.knowledgeChanges.length)
  const state = outlines.map(o => o.characterStateChanges.length)
  const sceneCounts = outlines.map(o => o.scenes.length)
  const coverage = outlines.map(o => validateBeatObligationCoverage(o))
  const totalObligations = sum(outlines.map(o =>
    sum(o.scenes.map(s =>
      s.obligations.mustEstablish.length +
      s.obligations.mustPayOff.length +
      s.obligations.mustTransferKnowledge.length +
      s.obligations.mustShowStateChange.length +
      s.obligations.mustNotReveal.length
    ))
  ))
  return {
    seed, rerun, novelId, ok: true,
    facts_median: median(facts),
    knowledge_median: median(knowledge),
    state_median: median(state),
    total_scenes: sum(sceneCounts),
    total_obligations: totalObligations,
    total_orphans: sum(coverage.map(c => c.summary.orphanFacts + c.summary.orphanKnowledgeChanges + c.summary.orphanStateChanges)),
    overloaded_entries: sum(coverage.map(c => c.summary.overloadedBeats)),
    chapters_total: outlines.length,
  }
}

interface SeedAggregate {
  seed: string
  reruns: number
  ok_count: number
  facts_medians: number[]
  knowledge_medians: number[]
  total_scenes: number[]
  facts_median_mean: number
  facts_median_stddev: number
  facts_median_range: number
  knowledge_median_mean: number
  knowledge_median_stddev: number
  knowledge_median_range: number
  total_scenes_mean: number
  total_scenes_stddev: number
  total_scenes_range: number
}

function aggregateSeed(cells: CellMetrics[]): SeedAggregate {
  const ok = cells.filter(c => c.ok)
  const facts = ok.map(c => c.facts_median)
  const know = ok.map(c => c.knowledge_median)
  const scenes = ok.map(c => c.total_scenes)
  const range = (xs: number[]) => xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs)
  return {
    seed: cells[0]!.seed,
    reruns: cells.length,
    ok_count: ok.length,
    facts_medians: facts,
    knowledge_medians: know,
    total_scenes: scenes,
    facts_median_mean: mean(facts),
    facts_median_stddev: stddev(facts),
    facts_median_range: range(facts),
    knowledge_median_mean: mean(know),
    knowledge_median_stddev: stddev(know),
    knowledge_median_range: range(know),
    total_scenes_mean: mean(scenes),
    total_scenes_stddev: stddev(scenes),
    total_scenes_range: range(scenes),
  }
}

interface AcrossSeedAggregate {
  seeds: string[]
  /** All ok cells flat (every rerun from every seed). */
  all_facts_medians: number[]
  all_knowledge_medians: number[]
  all_total_scenes: number[]
  /** Across-cell variance: std dev across all seed-rerun cells (the
   *  "if you ran the multi-seed probe once, how variable would the
   *  result be?" answer). */
  across_cell_facts_stddev: number
  across_cell_knowledge_stddev: number
  across_cell_total_scenes_stddev: number
  /** Across-seed variance: std dev across per-seed means (the
   *  "how much do seeds disagree on the typical value?" answer). */
  across_seed_facts_stddev: number
  across_seed_knowledge_stddev: number
  across_seed_total_scenes_stddev: number
}

function aggregateAcross(seedAggs: SeedAggregate[]): AcrossSeedAggregate {
  const allFacts = seedAggs.flatMap(s => s.facts_medians)
  const allKnow = seedAggs.flatMap(s => s.knowledge_medians)
  const allScenes = seedAggs.flatMap(s => s.total_scenes)
  const seedMeansFacts = seedAggs.map(s => s.facts_median_mean)
  const seedMeansKnow = seedAggs.map(s => s.knowledge_median_mean)
  const seedMeansScenes = seedAggs.map(s => s.total_scenes_mean)
  return {
    seeds: seedAggs.map(s => s.seed),
    all_facts_medians: allFacts,
    all_knowledge_medians: allKnow,
    all_total_scenes: allScenes,
    across_cell_facts_stddev: stddev(allFacts),
    across_cell_knowledge_stddev: stddev(allKnow),
    across_cell_total_scenes_stddev: stddev(allScenes),
    across_seed_facts_stddev: stddev(seedMeansFacts),
    across_seed_knowledge_stddev: stddev(seedMeansKnow),
    across_seed_total_scenes_stddev: stddev(seedMeansScenes),
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  mkdirSync(args.outputBase, { recursive: true })

  const promptFile = join(args.variantDir, `${args.variant}.md`)
  if (!existsSync(promptFile)) throw new Error(`variant prompt not found: ${promptFile}`)

  const createdNovelIds: string[] = []
  const cells: CellMetrics[] = []
  const runTag = ts()

  try {
    for (const seed of args.seeds) {
      // Concept once per seed.
      const conceptId = await setupConceptSnapshot(seed, args.chaptersPerSeed)
      createdNovelIds.push(conceptId)

      // M reruns per seed.
      for (let rerun = 1; rerun <= args.rerunsPerSeed; rerun++) {
        const targetNovelId = `phase-eval-multiseed-${seed}-${args.variant}-r${rerun}-${runTag}`
        cloneForVariant(conceptId, targetNovelId)
        createdNovelIds.push(targetNovelId)
        const cellOutputDir = join(args.outputBase, seed, `r${rerun}`)
        runVariantChild(targetNovelId, promptFile, cellOutputDir, args.promptEnv, args.expId)
        const outlinesPath = join(cellOutputDir, "outlines.json")
        const cell = computeCellMetrics(seed, rerun, targetNovelId, outlinesPath, args.chaptersPerSeed)
        cells.push(cell)
        console.error(`[probe-ms] cell seed=${seed} r${rerun} → ok=${cell.ok} facts=${cell.facts_median} know=${cell.knowledge_median} scenes=${cell.total_scenes}${cell.reason ? ` (${cell.reason})` : ""}`)
      }
    }

    // Aggregate per seed + across seeds.
    const seedAggs: SeedAggregate[] = []
    for (const seed of args.seeds) {
      seedAggs.push(aggregateSeed(cells.filter(c => c.seed === seed)))
    }
    const across = aggregateAcross(seedAggs)

    // Print summary.
    console.log()
    console.log(`Multi-seed probe-shape variance — variant=${args.variant} chapters=${args.chaptersPerSeed} reruns=${args.rerunsPerSeed}`)
    console.log(`Seeds: ${args.seeds.join(", ")}`)
    console.log()
    console.log("Per-cell metrics:")
    for (const c of cells) {
      console.log(`  ${c.seed} r${c.rerun}: facts=${c.facts_median} know=${c.knowledge_median} scenes=${c.total_scenes} chapters=${c.chapters_total} ok=${c.ok}${c.reason ? ` (${c.reason})` : ""}`)
    }
    console.log()
    console.log("Per-seed aggregates (mean ± stddev across reruns):")
    for (const s of seedAggs) {
      console.log(`  ${s.seed} (n=${s.ok_count}): facts ${s.facts_median_mean.toFixed(2)} ± ${s.facts_median_stddev.toFixed(2)} (range ${s.facts_median_range})  know ${s.knowledge_median_mean.toFixed(2)} ± ${s.knowledge_median_stddev.toFixed(2)} (range ${s.knowledge_median_range})  scenes ${s.total_scenes_mean.toFixed(1)} ± ${s.total_scenes_stddev.toFixed(1)} (range ${s.total_scenes_range})`)
    }
    console.log()
    console.log(`Across-cell stddev (all ${cells.filter(c => c.ok).length} ok cells): facts=${across.across_cell_facts_stddev.toFixed(3)} know=${across.across_cell_knowledge_stddev.toFixed(3)} scenes=${across.across_cell_total_scenes_stddev.toFixed(2)}`)
    console.log(`Across-seed stddev (n=${seedAggs.length} seed means): facts=${across.across_seed_facts_stddev.toFixed(3)} know=${across.across_seed_knowledge_stddev.toFixed(3)} scenes=${across.across_seed_total_scenes_stddev.toFixed(2)}`)
    console.log()

    // Write summary.json.
    const summary = {
      probeName: "multi-seed-probe-shape-comparison",
      runTag,
      variant: args.variant,
      promptEnv: args.promptEnv,
      promptFile,
      chaptersPerSeed: args.chaptersPerSeed,
      rerunsPerSeed: args.rerunsPerSeed,
      seeds: args.seeds,
      cells,
      seedAggregates: seedAggs,
      across,
    }
    const summaryPath = join(args.outputBase, "summary.json")
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
    console.error(`[probe-ms] wrote summary: ${summaryPath}`)

    // Persist (optional).
    if (args.persist) {
      const { persistPhaseEvalRun, currentGitCommit } = await import("./persist-run")
      const okCount = cells.filter(c => c.ok).length
      const verdict = `MULTISEED-VARIANCE — variant=${args.variant} seeds=${args.seeds.length} reruns=${args.rerunsPerSeed} chapters=${args.chaptersPerSeed} ok_cells=${okCount}/${cells.length} | facts_stddev across_cell=${across.across_cell_facts_stddev.toFixed(3)} across_seed=${across.across_seed_facts_stddev.toFixed(3)} | know_stddev across_cell=${across.across_cell_knowledge_stddev.toFixed(3)} across_seed=${across.across_seed_knowledge_stddev.toFixed(3)} | scenes_stddev across_cell=${across.across_cell_total_scenes_stddev.toFixed(2)} across_seed=${across.across_seed_total_scenes_stddev.toFixed(2)}`
      try {
        const runId = await persistPhaseEvalRun({
          probeName: "multi-seed-probe-shape-comparison",
          gitCommit: currentGitCommit(),
          experimentId: args.expId ?? null,
          seedsUsed: args.seeds,
          variantLabels: [args.variant],
          summaryJson: summary,
          verdict,
          notes: args.note ?? null,
        })
        console.log(`Persisted as phase_eval_runs.id=${runId}`)
      } catch (err) {
        console.error(`[probe-ms] WARN: --persist failed: ${(err as Error).message}`)
      }
    }

    if (!args.keepNovels) {
      await cleanupNovels(createdNovelIds, "success-default")
    } else {
      console.error(`[probe-ms] --keep-novels set: skipping cleanup. Novels: ${createdNovelIds.join(", ")}`)
    }
  } catch (err) {
    console.error("[probe-ms] fatal:", err)
    await cleanupNovels(createdNovelIds, "failure-cleanup")
    process.exit(1)
  }
}

main().catch(err => {
  console.error("[probe-ms] fatal (outer):", err)
  process.exit(1)
})
