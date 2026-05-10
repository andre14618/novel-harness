/**
 * load-frozen-plan.ts — adjusted-B2 P4 readiness for the scene-first lane.
 *
 * Reads a frozen-plan fixture directory of the shape:
 *
 *   docs/fixtures/scene-first/frozen-plan/<slug>/
 *     ├── concept.json              # the original SeedInput
 *     ├── chapter-outlines.json     # manifest carrying outline rows
 *     ├── world-bible.json          # optional
 *     ├── character-profiles.json   # optional
 *     └── README.md                 # capture trace
 *
 * Hydrates a fresh novel by inserting a `novels` row with the captured
 * concept, then writing each chapter outline row from the manifest into
 * `chapter_outlines`. world-bible and character-profiles are NOT
 * hydrated by this loader — adjusted-B2 v0 keeps the loader minimal and
 * accepts that planner-rerun on the operator's side will repopulate
 * those tables. (See docs/fixtures/scene-first/README.md for the full
 * rehydration plan a follow-up ticket may flesh out.)
 *
 * The loader REJECTS stub fixtures (`is_stub: true`) with an explicit
 * error pointing the operator at the capture procedure.
 *
 * No runtime behavior change; loader is invoked only on operator
 * request.
 */

import { join } from "node:path"
import { initDB, createNovel, saveChapterOutline } from "../../src/db"
import {
  parseFrozenPlanManifest,
  type FrozenPlanFixtureManifest,
} from "./scene-first-fixture-schema"
import type { SeedInput } from "../../src/types"

interface Args {
  fixtureDir: string
  novelIdOverride: string | null
  quiet: boolean
}

export function parseArgs(argv: string[]): Args {
  let fixtureDir: string | null = null
  let novelIdOverride: string | null = null
  let quiet = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--fixture") { fixtureDir = argv[++i] ?? null; continue }
    if (a === "--novel-id") { novelIdOverride = argv[++i] ?? null; continue }
    if (a === "--quiet") { quiet = true; continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!fixtureDir) throw new Error("--fixture <fixture-dir> is required")
  return { fixtureDir, novelIdOverride, quiet }
}

export function deriveNovelIdFromFixtureDir(fixtureDir: string, now: number = Date.now()): string {
  const slug = (fixtureDir.replace(/\/$/, "").split("/").pop() ?? "frozen-plan").trim()
  return `fixture-P4-${slug}-${now}`
}

export interface LoadedFrozenPlan {
  manifest: FrozenPlanFixtureManifest
  concept: SeedInput
}

export async function readFrozenPlan(fixtureDir: string): Promise<LoadedFrozenPlan> {
  const manifestPath = join(fixtureDir, "chapter-outlines.json")
  const conceptPath = join(fixtureDir, "concept.json")
  const manifestFile = Bun.file(manifestPath)
  const conceptFile = Bun.file(conceptPath)
  if (!await manifestFile.exists()) {
    throw new Error(`frozen-plan manifest not found: ${manifestPath}`)
  }
  if (!await conceptFile.exists()) {
    throw new Error(`frozen-plan concept not found: ${conceptPath}`)
  }
  const manifestRaw = await manifestFile.json()
  const manifest = parseFrozenPlanManifest(manifestRaw, manifestPath)
  if (manifest.is_stub) {
    throw new Error(
      `${manifestPath} is a stub fixture (is_stub: true). Capture the frozen plan rows from the source novel before invoking this loader.\n`
      + `See docs/fixtures/scene-first/frozen-plan/<slug>/README.md for the capture procedure.`,
    )
  }
  if (manifest.outlines.length === 0) {
    throw new Error(`${manifestPath} has no outline entries to hydrate`)
  }
  const conceptRaw = await conceptFile.json()
  if (!conceptRaw || typeof conceptRaw !== "object" || Array.isArray(conceptRaw)) {
    throw new Error(`${conceptPath} must be a JSON object representing the SeedInput`)
  }
  return { manifest, concept: conceptRaw as SeedInput }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const loaded = await readFrozenPlan(args.fixtureDir)
  const novelId = args.novelIdOverride
    ?? deriveNovelIdFromFixtureDir(args.fixtureDir)

  await initDB(novelId)
  await createNovel(novelId, loaded.concept)
  for (const entry of loaded.manifest.outlines) {
    await saveChapterOutline(novelId, entry.chapterNumber, entry.outline_json as never)
  }

  if (args.quiet) {
    process.stdout.write(`${novelId}\n`)
    return
  }
  console.log(`fixture: ${args.fixtureDir}`)
  console.log(`profile: ${loaded.manifest.fixture_metadata.profile}`)
  console.log(`source: ${loaded.manifest.fixture_metadata.source_novel_id ?? "(not declared)"}`)
  console.log(`captured: ${loaded.manifest.fixture_metadata.captured_at ?? "(not declared)"}`)
  console.log(`outlines hydrated: ${loaded.manifest.outlines.length}`)
  console.log(``)
  console.log(`novel-id: ${novelId}`)
  console.log(``)
  console.log(`next step (drafting only — plan is frozen):`)
  console.log(`  bun scripts/test-drafting-isolated.ts \\`)
  console.log(`    --source ${novelId} \\`)
  console.log(`    --target-prefix ab-${Date.now()}`)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
