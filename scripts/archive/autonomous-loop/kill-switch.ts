/**
 * Shared kill-switch check. Every stage of every iteration must call
 * `assertNotKilled()` before starting its work. Touching
 * `/tmp/context-loop-stop` asks the loop to exit cleanly at the next
 * check — nothing in-flight gets ripped out, but no new work starts.
 *
 * Path is overridable via KILL_SWITCH_FILE env var for testing.
 */

const KILL_FILE = process.env.KILL_SWITCH_FILE ?? "/tmp/context-loop-stop"

export class LoopKilledError extends Error {
  constructor() {
    super(`kill switch present at ${KILL_FILE}; loop exiting cleanly`)
    this.name = "LoopKilledError"
  }
}

export async function isKilled(): Promise<boolean> {
  try {
    return await Bun.file(KILL_FILE).exists()
  } catch {
    return false
  }
}

export async function assertNotKilled(): Promise<void> {
  if (await isKilled()) throw new LoopKilledError()
}
