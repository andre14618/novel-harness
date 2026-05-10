/**
 * load-concept-fixture.ts — adjusted-B2 readiness for the scene-first lane.
 *
 * Reads a concept-level fixture JSON from
 * `docs/fixtures/scene-first/concepts/<profile>/<name>.json`, creates a
 * fresh novel row, and writes the fixture's concept block as the seed.
 * The fixture's `fixture_metadata`, `pre_resolved_entities`, and
 * `scene_contract_target` blocks are NOT consumed by the runtime — they
 * are operator-readable expectations stored alongside the concept.
 *
 * The loader does NOT run concept or planning. It only seeds the novel
 * row. The operator chains existing scripts to drive the pipeline:
 *
 *   bun scripts/fixture/load-concept-fixture.ts \
 *     --fixture docs/fixtures/scene-first/concepts/over-target/P1-fantasy-debt-binder.json
 *   # prints novel-id (e.g. fixture-P1-fantasy-debt-binder-1778500000000)
 *
 *   bun scripts/test-planner-isolated.ts \
 *     --novel <novel-id>          # planning only; concept must already be done
 *   # ... or use the seed-name path of test-planner-isolated which runs
 *   # both concept + planning. See the loader's `--mode concept-then-plan`
 *   # workflow described in docs/fixtures/scene-first/README.md.
 *
 *   bun scripts/test-drafting-isolated.ts \
 *     --source <novel-id> --target-prefix <prefix>
 *
 * The loader is read-only on the fixture file and write-only on the
 * `novels` table (single INSERT). It does not touch any other table.
 */

import { initDB, createNovel } from "../../src/db"
import { parseConceptFixture, type ConceptFixture, type FixtureProfile } from "./scene-first-fixture-schema"

interface Args {
  fixturePath: string
  novelIdOverride: string | null
  /** When true, print only the novel-id (script-friendly). */
  quiet: boolean
}

export function parseArgs(argv: string[]): Args {
  let fixturePath: string | null = null
  let novelIdOverride: string | null = null
  let quiet = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--fixture") { fixturePath = argv[++i] ?? null; continue }
    if (a === "--novel-id") { novelIdOverride = argv[++i] ?? null; continue }
    if (a === "--quiet") { quiet = true; continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!fixturePath) throw new Error("--fixture <path> is required")
  return { fixturePath, novelIdOverride, quiet }
}

export function deriveNovelIdFromFixture(fixturePath: string, profile: FixtureProfile, now: number = Date.now()): string {
  // Pull the basename without extension and prefix with the profile id.
  // Example: `docs/.../P1-fantasy-debt-binder.json` → `fixture-P1-fantasy-debt-binder-<ts>`
  const basename = fixturePath.split("/").pop() ?? fixturePath
  const slug = basename.replace(/\.json$/i, "")
  // The profile prefix is already in the filename by convention; fall back to
  // adding it if a fixture was renamed and the profile no longer leads.
  const id = slug.startsWith(profile.split("-")[0]!) ? slug : `${profile.split("-")[0]}-${slug}`
  return `fixture-${id}-${now}`
}

export async function readFixture(fixturePath: string): Promise<ConceptFixture> {
  const file = Bun.file(fixturePath)
  if (!await file.exists()) throw new Error(`fixture not found: ${fixturePath}`)
  const json = await file.json()
  return parseConceptFixture(json, fixturePath)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const fixture = await readFixture(args.fixturePath)
  const novelId = args.novelIdOverride
    ?? deriveNovelIdFromFixture(args.fixturePath, fixture.fixture_metadata.profile)

  await initDB(novelId)
  await createNovel(novelId, fixture.concept)

  if (args.quiet) {
    process.stdout.write(`${novelId}\n`)
    return
  }
  console.log(`fixture: ${args.fixturePath}`)
  console.log(`profile: ${fixture.fixture_metadata.profile}`)
  console.log(`expected baseline ratio: ${fixture.fixture_metadata.expected_baseline_ratio}`)
  if (fixture.fixture_metadata.expected_baseline_failures.length > 0) {
    console.log(`expected baseline failures:`)
    for (const f of fixture.fixture_metadata.expected_baseline_failures) {
      console.log(`  - ${f}`)
    }
  }
  console.log(``)
  console.log(`novel-id: ${novelId}`)
  console.log(``)
  console.log(`next steps:`)
  console.log(`  # 1. Run concept + planning (existing seed-name path of test-planner-isolated`)
  console.log(`  #    expects a name under src/seeds/. For a fixture-loaded novel, the`)
  console.log(`  #    operator currently invokes runConceptPhase + runPlanningPhase via a`)
  console.log(`  #    follow-up script — adjusted-B2 docs/README explains.`)
  console.log(`  bun scripts/test-drafting-isolated.ts \\`)
  console.log(`    --source ${novelId} \\`)
  console.log(`    --target-prefix ab-${Date.now()}`)
  console.log(``)
  console.log(`(this seeds the novel row only; concept + planning still need to run before drafting)`)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
