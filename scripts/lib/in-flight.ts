/**
 * In-flight run registry — per-machine runtime state at
 * `.claude/in-flight/active.json`. Tracks what was launched from THIS
 * machine (long LXC runs, background campaigns, evals) so:
 *   (a) a session crash or user switch doesn't lose track of what's running
 *   (b) session-start can render a status dashboard
 *   (c) ScheduleWakeup prompts can cite the registered run_id for self-recovery
 *
 * Scope: LOCAL only. If a run is kicked off from another machine or
 * directly via `ssh novel-harness-lxc`, it is NOT captured here — that's
 * the same visibility gap we already had; this doesn't fix that class.
 *
 * Schema: array of entries, not a map (concurrent runs of the same kind
 * are allowed). File is gitignored (.gitignore: .claude/in-flight/).
 */

import { existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

export interface InFlightEntry {
  run_id: string                       // unique identifier, typically the novel_id or a campaign slug
  kind: "novel-run" | "campaign" | "eval" | "training" | "other"
  exp_id?: number                      // tuning_experiments.id if linked (CLAUDE.md rule 2)
  pid?: number                         // LXC PID if known
  host: "lxc" | "local" | string       // where the process runs
  log_path?: string                    // absolute path ON THE HOST where stdout/stderr land
  launched_at: string                  // ISO timestamp
  expected_finish_at?: string          // ISO timestamp; null for open-ended runs
  description: string                  // one-line human summary
  owner_session?: string               // Claude session ID if captured
}

const REGISTRY_PATH = process.env.INFLIGHT_REGISTRY ??
  resolve(import.meta.dir, "../../.claude/in-flight/active.json")

async function load(): Promise<InFlightEntry[]> {
  if (!existsSync(REGISTRY_PATH)) return []
  try {
    const text = await Bun.file(REGISTRY_PATH).text()
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed as InFlightEntry[] : []
  } catch {
    return []
  }
}

async function save(entries: InFlightEntry[]): Promise<void> {
  if (!existsSync(dirname(REGISTRY_PATH))) {
    mkdirSync(dirname(REGISTRY_PATH), { recursive: true })
  }
  await Bun.write(REGISTRY_PATH, JSON.stringify(entries, null, 2) + "\n")
}

export async function addInFlight(entry: InFlightEntry): Promise<void> {
  const entries = await load()
  // Replace any existing entry with the same run_id (idempotent add).
  const filtered = entries.filter(e => e.run_id !== entry.run_id)
  filtered.push(entry)
  await save(filtered)
}

export async function removeInFlight(runId: string): Promise<boolean> {
  const entries = await load()
  const filtered = entries.filter(e => e.run_id !== runId)
  if (filtered.length === entries.length) return false
  await save(filtered)
  return true
}

export async function listInFlight(): Promise<InFlightEntry[]> {
  return await load()
}

export async function getInFlight(runId: string): Promise<InFlightEntry | null> {
  const entries = await load()
  return entries.find(e => e.run_id === runId) ?? null
}

// CLI:
//   bun scripts/lib/in-flight.ts list
//   bun scripts/lib/in-flight.ts add '<json>'
//   bun scripts/lib/in-flight.ts remove <run_id>
if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2)
  switch (cmd) {
    case "list": {
      const entries = await listInFlight()
      if (entries.length === 0) {
        console.log("(no in-flight runs registered)")
      } else {
        for (const e of entries) {
          console.log(`  ${e.run_id}  [${e.kind}]  exp=${e.exp_id ?? "—"}  pid=${e.pid ?? "—"}  host=${e.host}  launched=${e.launched_at}`)
          console.log(`    ${e.description}`)
          if (e.log_path) console.log(`    log: ${e.log_path}`)
        }
      }
      break
    }
    case "add": {
      const json = args[0]
      if (!json) { console.error("usage: add '<json>'"); process.exit(2) }
      const entry = JSON.parse(json) as InFlightEntry
      if (!entry.run_id || !entry.kind || !entry.host || !entry.launched_at || !entry.description) {
        console.error("entry missing required fields: run_id, kind, host, launched_at, description")
        process.exit(2)
      }
      await addInFlight(entry)
      console.log(`added ${entry.run_id}`)
      break
    }
    case "remove": {
      const runId = args[0]
      if (!runId) { console.error("usage: remove <run_id>"); process.exit(2) }
      const removed = await removeInFlight(runId)
      console.log(removed ? `removed ${runId}` : `not found: ${runId}`)
      break
    }
    default:
      console.error("commands: list | add '<json>' | remove <run_id>")
      process.exit(2)
  }
  process.exit(0)
}
