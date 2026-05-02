/**
 * Shared test helpers for DB-touching tests.
 *
 * The DB-reachability check needs to be a real ping, not just an env-var
 * presence check — local `bun test` runs may have DATABASE_URL set in the
 * shell but no Postgres listening at that address. The env-var-only skip
 * pattern produces 4 false-positive failures on a fresh local checkout
 * (caught by Codex review of d055f60).
 */

import db from "./connection"

/**
 * Returns true if Postgres is actually reachable. Performs a `SELECT 1`
 * with a short timeout. Safe to call from beforeAll — the test will skip
 * cleanly if the DB is down or unconfigured.
 *
 * Why a real ping (not just env-var presence): tests that SHOULD skip
 * when the DB is unreachable would otherwise FAIL with
 * ERR_POSTGRES_CONNECTION_CLOSED, masking real test failures.
 *
 * Cached per-process: the first call pings; subsequent calls return the
 * cached result. This prevents per-test ping cost in a file with many
 * tests.
 */
let cachedReachable: boolean | null = null

export async function dbReachable(timeoutMs = 2000): Promise<boolean> {
  if (cachedReachable !== null) return cachedReachable
  if (!(process.env.DATABASE_URL ?? process.env.ORCHESTRATOR_DB_URL)) {
    cachedReachable = false
    return false
  }
  try {
    const ping = db`SELECT 1`
    const result = await Promise.race([
      ping,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DB ping timeout")), timeoutMs)),
    ])
    cachedReachable = Array.isArray(result) && result.length > 0
    return cachedReachable
  } catch {
    cachedReachable = false
    return false
  }
}

/**
 * Reset the cached reachability decision. Test infrastructure only —
 * lets a test that mutates the connection (e.g. close + reconnect) start
 * the next file with a fresh check.
 */
export function _resetDbReachableCache(): void {
  cachedReachable = null
}
