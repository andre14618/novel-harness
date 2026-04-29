/**
 * Phase-eval probe — planning-beats variant comparison.
 *
 * Runs the experiment defined in
 * `docs/designs/phase-variant-comparison.md` (R5):
 *
 *   1. Generate concept once for a seed (`setup-concept`).
 *      Result: a "concept snapshot" novel id whose row sits at phase=
 *      'planning' (set by an explicit UPDATE after runConceptPhase
 *      returns complete) with no post-concept tables populated.
 *   2. For each variant prompt file, clone the snapshot (clone-for-variant
 *      --target-phase=concept-done) so every variant plans from the SAME
 *      frozen concept state.
 *   3. Spawn run-variant.ts as a child process per variant, with the
 *      PLANNING_BEATS_PROMPT_OVERRIDE env var pointing at that variant's
 *      prompt file. The child runs the planning phase and writes
 *      `outlines.json` to its output dir.
 *   4. Aggregate the per-variant outlines into a single summary.json under
 *      the output base dir for offline scoring (G1-G4 gates per charter).
 *   5. Cleanup created novels (configurable). On any thrown error during
 *      steps 1-4 the parent always cleans up created novels; on success
 *      it cleans them up by default unless --keep-novels is passed (the
 *      DB rows aren't load-bearing — outlines.json on disk has the data).
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
 *     --output-base=output/phase-eval/<run-tag> \
 *     [--concept-snapshot-id=<existing-snapshot-id>] \
 *     [--keep-novels]
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
  keepNovels: boolean
}

function parseArgs(): Args {
  const map: Record<string, string | true> = {}
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/)
    if (m) map[m[1]!] = m[2]!
    else if (arg.startsWith("--")) map[arg.slice(2)] = true
  }
  const seed = map["seed"] as string
  const variantsRaw = map["variants"] as string
  const variantDir = map["variant-dir"] as string
  const outputBase = map["output-base"] as string
  if (!seed || !variantsRaw || !variantDir || !outputBase) {
    console.error(
      "usage: bun probe-planning-beats.ts \\\n" +
      "  --seed=<seed-key> \\\n" +
      "  --variants=<id1,id2,...> \\\n" +
      "  --variant-dir=<dir-with-{id}.md-files> \\\n" +
      "  --output-base=<absolute-output-dir> \\\n" +
      "  [--concept-snapshot-id=<existing-snapshot-id>] \\\n" +
      "  [--keep-novels]   (default: cleanup created novels at end)"
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
  return {
    seed,
    variants,
    variantDir: variantDirAbs,
    outputBase: outputBaseAbs,
    conceptSnapshotId: map["concept-snapshot-id"] as string | undefined,
    keepNovels: map["keep-novels"] === true,
  }
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

/** Update novels.phase to 'planning' so the row's stored state matches
 *  the conceptual "concept-done" snapshot. clone-for-variant inherits
 *  this phase value when targetPhase='concept-done' is in play. */
async function markSnapshotPlanning(novelId: string): Promise<void> {
  const { default: db } = await import("../../src/db/connection")
  await db`UPDATE novels SET phase = 'planning', updated_at = now() WHERE id = ${novelId}`
}

/** Verify a user-supplied conceptSnapshotId is suitable: the novel
 *  exists, sits at phase='concept' or 'planning', and has the
 *  concept-side rows we need to clone (world_bibles + characters at
 *  minimum). Throws on any failed precondition with a precise message. */
async function validateConceptSnapshot(novelId: string): Promise<void> {
  const { default: db } = await import("../../src/db/connection")
  const rows = await db<{ id: string; phase: string }[]>`
    SELECT id, phase FROM novels WHERE id = ${novelId}
  `
  if (rows.length === 0) throw new Error(`--concept-snapshot-id not found in novels: ${novelId}`)
  const phase = rows[0]!.phase
  if (phase !== "concept" && phase !== "planning") {
    throw new Error(`--concept-snapshot-id ${novelId} has phase='${phase}'; expected 'concept' or 'planning'`)
  }
  const [{ n: wbCount } = { n: 0 }] = await db<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM world_bibles WHERE novel_id = ${novelId}
  `
  const [{ n: chCount } = { n: 0 }] = await db<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM characters WHERE novel_id = ${novelId}
  `
  if (Number(wbCount) === 0 || Number(chCount) === 0) {
    throw new Error(`--concept-snapshot-id ${novelId} missing concept rows: world_bibles=${wbCount} characters=${chCount}`)
  }
}

async function setupConceptSnapshot(seed: string): Promise<string> {
  const novelId = `phase-eval-concept-${seed}-${ts()}`
  console.error(`[probe] concept setup → novel_id=${novelId}`)

  const { setAutoMode, setResolverMode } = await import("../../src/cli")
  setAutoMode(true)
  setResolverMode("auto")

  // Lazy imports keep the parent module graph minimal until needed.
  // src/phases/concept.ts only loads the three concept-agent prompts
  // (world-builder, character-agent, plotter) — see commit 7981674's
  // companion change to src/phases/concept.ts which avoids the broad
  // src/prompts.ts barrel that would also pull in planning-beats.
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
  // Move the row from default phase='concept' (set by createNovel) to
  // 'planning' so the stored phase matches the conceptual snapshot
  // state. clone-for-variant --target-phase=concept-done copies this
  // value forward.
  await markSnapshotPlanning(novelId)
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

/** Cleanup novels created by this probe run. Best-effort — logs and
 *  continues on individual failures so a partial cleanup still removes
 *  what it can. clearNovelState handles FK ordering. */
async function cleanupNovels(novelIds: string[], reason: string): Promise<void> {
  if (novelIds.length === 0) return
  console.error(`[probe] cleanup (${reason}): clearing ${novelIds.length} novel(s)`)
  const { clearNovelState } = await import("../../tests/phase-parity/db-snapshot")
  for (const id of novelIds) {
    try {
      await clearNovelState(id)
      console.error(`[probe]   cleared ${id}`)
    } catch (e: any) {
      console.error(`[probe]   FAILED to clear ${id}: ${e?.message ?? e}`)
    }
  }
}

async function main() {
  const args = parseArgs()
  mkdirSync(args.outputBase, { recursive: true })

  // Track every novel we create so the cleanup pass can find them. The
  // concept snapshot is only added when newly created (a passed-in
  // --concept-snapshot-id is owned by the caller).
  const createdNovelIds: string[] = []

  try {
    // Step 1: concept snapshot — reuse if provided, else create.
    let conceptSnapshotId: string
    if (args.conceptSnapshotId) {
      conceptSnapshotId = args.conceptSnapshotId
      console.error(`[probe] reusing concept snapshot: ${conceptSnapshotId}`)
      await validateConceptSnapshot(conceptSnapshotId)
    } else {
      conceptSnapshotId = await setupConceptSnapshot(args.seed)
      createdNovelIds.push(conceptSnapshotId)
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
      // Track the cloned novel BEFORE running planning so that a
      // mid-planning crash still cleans the partial state.
      createdNovelIds.push(targetNovelId)
      const variantOutputDir = join(args.outputBase, variant)
      runVariantChild(targetNovelId, promptFile, variantOutputDir)
      variantNovelIds[variant] = targetNovelId
    }

    // Step 4: aggregate. Paths in summary.json are written relative to the
    // summary file (variant subdir + filename) so the verdict reader can
    // resolve them after rsync between machines.
    const summary = {
      seed: args.seed,
      runTag,
      conceptSnapshotId,
      variantDir: args.variantDir,
      variants: args.variants.map(v => ({
        id: v,
        promptFile: join(args.variantDir, `${v}.md`),
        novelId: variantNovelIds[v],
        outlinesPath: `${v}/outlines.json`,
      })),
    }
    const summaryPath = join(args.outputBase, "summary.json")
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
    console.error(`[probe] wrote summary: ${summaryPath}`)
    console.error(`[probe] next: bun scripts/phase-eval/print-screen-verdict.ts --summary=${summaryPath}`)

    // Step 5: cleanup on success. Default behavior — outlines.json on
    // disk is the load-bearing artifact; DB rows are throwaway.
    if (!args.keepNovels) {
      await cleanupNovels(createdNovelIds, "success-default")
    } else {
      console.error(`[probe] --keep-novels set: skipping success cleanup. Created novels: ${createdNovelIds.join(", ")}`)
    }
  } catch (err) {
    console.error("[probe] fatal:", err)
    // Always cleanup on failure regardless of --keep-novels — the
    // intent of --keep-novels is "preserve successful artifacts for
    // inspection," not "preserve broken half-runs."
    await cleanupNovels(createdNovelIds, "failure-cleanup")
    process.exit(1)
  }
}

main().catch(err => {
  console.error("[probe] fatal (outer):", err)
  process.exit(1)
})
