/**
 * Phase parity — top-level test.
 *
 * Skipped automatically when no fixture is present (P0 lands the
 * infrastructure; fixtures are recorded on the LXC in a follow-up).
 *
 * When a fixture IS present, the test:
 *   1. Loads the recorded transport fixture.
 *   2. Clears the novel's DB state.
 *   3. Re-seeds the novel from `seed.json`.
 *   4. Runs `runNovel(novelId)` against the ReplayTransport.
 *   5. Captures and normalizes the post-run DB snapshot.
 *   6. Asserts the normalized snapshot byte-equals the recorded expected snapshot.
 *
 * To record a new fixture, run `bun tests/phase-parity/record-fixture.ts <novelId>`
 * on the LXC with a real DirectTransport (the recorder will copy the canonical
 * post-run state and capture all LLM calls).
 *
 * See `README.md` for the recording procedure and discipline.
 */

import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { setTransport } from "../../src/transport"
import { ReplayTransport } from "./replay-transport"
import { captureSnapshot, clearNovelState } from "./db-snapshot"
import { normalize, serialize } from "./normalize"
import { dbReachable } from "../../src/db/test-helpers"

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "reference-run")
const TRANSPORT_PATH = join(FIXTURE_DIR, "transport-fixture.json")
const EXPECTED_PATH = join(FIXTURE_DIR, "expected-snapshot.json")
const SEED_PATH = join(FIXTURE_DIR, "seed.json")

const fixturesPresent = existsSync(TRANSPORT_PATH) && existsSync(EXPECTED_PATH) && existsSync(SEED_PATH)
const reachable = await dbReachable()

describe("phase parity", () => {
  if (!fixturesPresent) {
    test.skip("fixture recording required — see README.md", () => {})
    return
  }
  if (!reachable) {
    test.skip("Postgres unreachable — fixture replay needs a live DB", () => {})
    return
  }

  test("replay produces byte-equal normalized snapshot", async () => {
    const { runNovel } = await import("../../src/state-machine")
    const { createNovel } = await import("../../src/db/novels")

    const seed = JSON.parse(readFileSync(SEED_PATH, "utf8")) as {
      novelId: string
      seed: import("../../src/types").SeedInput
    }

    setTransport(ReplayTransport.fromFile(TRANSPORT_PATH))

    await clearNovelState(seed.novelId)
    await createNovel(seed.novelId, seed.seed)
    await runNovel(seed.novelId)

    const raw = await captureSnapshot(seed.novelId)
    const got = serialize(normalize(raw))
    const expected = readFileSync(EXPECTED_PATH, "utf8")

    expect(got).toBe(expected)
  })
})
