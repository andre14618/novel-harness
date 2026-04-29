/**
 * Phase-eval probe — planning-beats variant comparison.
 *
 * Runs the experiment defined in
 * `docs/designs/phase-variant-comparison.md` (R5):
 *
 *   1. Generate concept once for a seed (`setup-concept`).
 *      Result: a "concept snapshot" novel id with phase=planning, no
 *      post-concept tables populated.
 *   2. For each variant prompt file, clone the snapshot (clone-for-variant
 *      --target-phase=concept-done) so every variant plans from the SAME
 *      frozen concept state.
 *   3. Spawn run-variant.ts as a child process per variant, with the
 *      PLANNING_BEATS_PROMPT_OVERRIDE env var pointing at that variant's
 *      prompt file. The child runs the planning phase and writes
 *      `outlines.json` to its output dir.
 *   4. Aggregate the per-variant outlines into a single summary.json under
 *      the output base dir for offline scoring (G1-G4 gates per charter).
 *
 * Why a separate process per variant:
 * - `src/agents/planning-beats/index.ts` reads its system prompt at
 *   module-load time. In-process variant cycling would cache the first
 *   variant's prompt and silently apply it to subsequent variants.
 * - `src/logger.ts` and `src/transport.ts` carry singletons that aren't
 *   safe to share across variant runs.
 *
 * Usage:
 *
 *   bun scripts/phase-eval/probe-planning-beats.ts \
 *     --seed=fantasy-system-heretic \
 *     --variants=default,loud \
 *     --variant-dir=scripts/phase-eval/variants/planning-beats \
 *     --output-base=output/phase-eval/<run-tag>
 *
 * `--variant-dir` must contain `<variant>.md` for each id in `--variants`.
 *
 * Cost note: each variant runs concept ONCE (shared) plus planning ONCE,
 * so total LLM cost ≈ concept (~$0.05) + N * planning (~$0.03 per variant
 * on V4 Flash for 5 chapters). The probe is intentionally cheap so we can
 * iterate prompt drafts without committing to the full harness build.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"

interface Args {
  seed: string
  variants: string[]
  variantDir: string
  outputBase: string
  conceptSnapshotId?: string
}

function parseArgs(): Args {
  const map: Record<string, string> = {}
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/)
    if (m) map[m[1]!] = m[2]!
  }
  const seed = map["seed"]
  const variantsRaw = map["variants"]
  const variantDir = map["variant-dir"]
  const outputBase = map["output-base"]
  if (!seed || !variantsRaw || !variantDir || !outputBase) {
    console.error(
      "usage: bun probe-planning-beats.ts \\\n" +
      "  --seed=<seed-key> \\\n" +
      "  --variants=<id1,id2,...> \\\n" +
      "  --variant-dir=<dir-with-{id}.md-files> \\\n" +
      "  --output-base=<absolute-output-dir> \\\n" +
      "  [--concept-snapshot-id=<existing-snapshot-id>]"
    )
    process.exit(2)
  }
  const variants = variantsRaw.split(",").map(s => s.trim()).filter(Boolean)
  if (variants.length < 2) {
    console.error("--variants must list at least 2 ids (control + test)")
    process.exit(2)
  }
  const outputBaseAbs = isAbsolute(outputBase) ? outputBase : resolve(process.cwd(), outputBase)
  const variantDirAbs = isAbsolute(variantDir) ? variantDir : resolve(process.cwd(), variantDir)
  return { seed, variants, variantDir: variantDirAbs, outputBase: outputBaseAbs, conceptSnapshotId: map["concept-snapshot-id"] }
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

async function setupConceptSnapshot(seed: string): Promise<string> {
  const novelId = `phase-eval-concept-${seed}-${ts()}`
  console.error(`[probe] concept setup → novel_id=${novelId}`)

  const { setAutoMode, setResolverMode } = await import("../../src/cli")
  setAutoMode(true)
  setResolverMode("auto")

  const { runConceptPhase } = await import("../../src/phases/concept")
  const { createNovel } = await import("../../src/db/novels")

  const seedPath = resolve(process.cwd(), "src", "seeds", `${seed}.json`)
  if (!existsSync(seedPath)) {
    throw new Error(`seed not found: ${seedPath}`)
  }
  const seedJson = JSON.parse(readFileSync(seedPath, "utf-8"))
  await createNovel(novelId, seedJson)

  const result = await runConceptPhase(novelId, seedJson)
  if (result.kind !== "complete") {
    throw new Error(`concept phase paused: ${result.reason}`)
  }
  console.error(`[probe] concept complete: characters=${result.output.characterCount} systems=${result.output.worldSystemsCount} cultures=${result.output.culturesCount}`)
  return novelId
}

function cloneForVariant(source: string, target: string): void {
  console.error(`[probe] clone ${source} → ${target} (target-phase=concept-done)`)
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

function runVariantChild(novelId: string, promptFile: string, variantOutputDir: string): void {
  console.error(`[probe] run-variant → ${novelId} prompt=${promptFile}`)
  const result = spawnSync("bun", [
    "scripts/phase-eval/run-variant.ts",
    `--novel-id=${novelId}`,
    `--output-dir=${variantOutputDir}`,
  ], {
    env: { ...process.env, PLANNING_BEATS_PROMPT_OVERRIDE: promptFile },
    stdio: ["ignore", "inherit", "inherit"],
  })
  if (result.status !== 0) {
    throw new Error(`run-variant failed for novel=${novelId} (exit ${result.status})`)
  }
}

async function main() {
  const args = parseArgs()
  mkdirSync(args.outputBase, { recursive: true })

  // Step 1: concept snapshot — reuse if provided, else create.
  let conceptSnapshotId: string
  if (args.conceptSnapshotId) {
    conceptSnapshotId = args.conceptSnapshotId
    console.error(`[probe] reusing concept snapshot: ${conceptSnapshotId}`)
  } else {
    conceptSnapshotId = await setupConceptSnapshot(args.seed)
  }

  // Step 2 + 3: per-variant clone + run.
  const runTag = ts()
  const variantNovelIds: Record<string, string> = {}
  for (const variant of args.variants) {
    const promptFile = join(args.variantDir, `${variant}.md`)
    if (!existsSync(promptFile)) {
      throw new Error(`variant prompt not found: ${promptFile}`)
    }
    const targetNovelId = `phase-eval-${args.seed}-${variant}-${runTag}`
    cloneForVariant(conceptSnapshotId, targetNovelId)
    const variantOutputDir = join(args.outputBase, variant)
    runVariantChild(targetNovelId, promptFile, variantOutputDir)
    variantNovelIds[variant] = targetNovelId
  }

  // Step 4: aggregate.
  const summary = {
    seed: args.seed,
    runTag,
    conceptSnapshotId,
    variantDir: args.variantDir,
    variants: args.variants.map(v => ({
      id: v,
      promptFile: join(args.variantDir, `${v}.md`),
      novelId: variantNovelIds[v],
      outlinesPath: join(args.outputBase, v, "outlines.json"),
    })),
  }
  const summaryPath = join(args.outputBase, "summary.json")
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  console.error(`[probe] wrote summary: ${summaryPath}`)
  console.error(`[probe] next: bun scripts/phase-eval/print-screen-verdict.ts --summary=${summaryPath}`)
}

main().catch(err => {
  console.error("[probe] fatal:", err)
  process.exit(1)
})
