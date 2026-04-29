/**
 * Phase parity — fixture recorder.
 *
 * Run on the LXC against a DirectTransport. Captures (request, response)
 * pairs from a real Novel run, plus the post-run normalized DB snapshot.
 * Writes both to `tests/phase-parity/fixtures/reference-run/`.
 *
 * Usage:
 *
 *   ssh novel-harness-lxc \
 *     "cd ~/apps/novel-harness && bun tests/phase-parity/record-fixture.ts romance-drama-v1"
 *
 * The argument is the novel id (also used as the seed key — see
 * `src/seeds/`). The recorder:
 *   1. Clears existing DB state for that novel.
 *   2. Loads the seed JSON.
 *   3. Sets RecordTransport(DirectTransport()) globally.
 *   4. Runs `runNovel(novelId)` to completion.
 *   5. Flushes the transport log to `transport-fixture.json`.
 *   6. Captures + normalizes the post-run snapshot to `expected-snapshot.json`.
 *   7. Writes the seed to `seed.json` for the test to re-seed.
 *
 * Re-running the recorder OVERWRITES the previous fixture. Commit fixtures
 * deliberately — they are the parity baseline.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { setTransport } from "../../src/transport"
import { setAutoMode, setResolverMode } from "../../src/cli"
import { RecordTransport } from "./replay-transport"
import { captureSnapshot, clearNovelState } from "./db-snapshot"
import { normalize, serialize } from "./normalize"

async function main() {
  const novelId = process.argv[2]
  if (!novelId) {
    console.error("usage: bun tests/phase-parity/record-fixture.ts <novelId>")
    process.exit(2)
  }

  const seedPath = join(import.meta.dir, "..", "..", "src", "seeds", `${novelId}.json`)
  if (!existsSync(seedPath)) {
    console.error(`seed not found at ${seedPath}`)
    process.exit(2)
  }
  const { default: seed } = await import(seedPath)

  const fixtureDir = join(import.meta.dir, "fixtures", "reference-run")
  mkdirSync(fixtureDir, { recursive: true })

  const recorder = new RecordTransport()
  setTransport(recorder)
  setAutoMode(true)
  setResolverMode("auto")

  const { runNovel } = await import("../../src/state-machine")
  const { createNovel } = await import("../../src/db/novels")

  await clearNovelState(novelId)
  await createNovel(novelId, seed)
  await runNovel(novelId)

  recorder.flushTo(join(fixtureDir, "transport-fixture.json"))

  const raw = await captureSnapshot(novelId)
  writeFileSync(join(fixtureDir, "expected-snapshot.json"), serialize(normalize(raw)))
  writeFileSync(join(fixtureDir, "seed.json"), JSON.stringify({ novelId, seed }, null, 2))

  console.log(`recorded ${recorder.calls.length} LLM calls; snapshot written to ${fixtureDir}`)
}

main().catch(err => { console.error(err); process.exit(1) })
