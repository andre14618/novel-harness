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
  // Codex review ac9d7f95 Q1: PID alone is not durable across host reboots
  // (same PID can be reused; LXC may have restarted between launch and check).
  // verify_pattern is a pgrep fragment that Phase -1 uses for deterministic
  // health checks. host_boot_id captures the host's kernel boot session so
  // "PID exists but boot_id changed" signals the original process died.
  verify_pattern?: string              // e.g. "organic-run-verify" — passed to `pgrep -f`
  host_boot_id?: string                // /proc/sys/kernel/random/boot_id on host at launch
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

/**
 * Cross-check an entry against the live host. Returns a health verdict.
 * - alive: process matches verify_pattern AND host_boot_id hasn't changed
 * - ghost: entry still registered but process is gone (likely crashed or completed silently)
 * - reboot: host_boot_id changed since launch → any PID claim is stale
 * - unchecked: not enough info (no verify_pattern / wrong host) — caller decides
 *
 * Codex review ac9d7f95 Q5: top risk for the registry is ghost entries
 * accumulating until operators distrust it. `prune` + verdict output gives
 * a deterministic cleanup path.
 */
export async function verifyEntry(entry: InFlightEntry): Promise<"alive" | "ghost" | "reboot" | "unchecked"> {
  if (entry.host !== "lxc") return "unchecked" // only LXC health-check implemented
  if (!entry.verify_pattern) return "unchecked"

  const $ = Bun.$
  try {
    if (entry.host_boot_id) {
      const bootIdRes = await $`ssh novel-harness-lxc 'cat /proc/sys/kernel/random/boot_id'`.quiet().text()
      const currentBoot = bootIdRes.trim()
      if (currentBoot && currentBoot !== entry.host_boot_id) return "reboot"
    }
    const pgrepRes = await $`ssh novel-harness-lxc ${`pgrep -f ${entry.verify_pattern}`}`.quiet().nothrow()
    return pgrepRes.exitCode === 0 ? "alive" : "ghost"
  } catch {
    return "unchecked"
  }
}

// CLI:
//   bun scripts/lib/in-flight.ts list
//   bun scripts/lib/in-flight.ts add '<json>'
//   bun scripts/lib/in-flight.ts remove <run_id>
//   bun scripts/lib/in-flight.ts prune        (remove ghosts + reboots; preserve alive + unchecked)
if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2)
  switch (cmd) {
    case "prune": {
      const entries = await listInFlight()
      if (entries.length === 0) { console.log("(registry empty)"); break }
      const keep: InFlightEntry[] = []
      for (const e of entries) {
        const verdict = await verifyEntry(e)
        console.log(`  ${e.run_id}  [${verdict}]  ${e.description}`)
        if (verdict === "alive" || verdict === "unchecked") keep.push(e)
      }
      await save(keep)
      console.log(`\npruned ${entries.length - keep.length} entries (${keep.length} remain)`)
      break
    }
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
