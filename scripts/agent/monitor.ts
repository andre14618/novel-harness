#!/usr/bin/env bun
/**
 * Convenience wrapper for the lane dashboard.
 *
 * Defaults:
 *   - latest non-template docs/sessions/*.md lane with a complete Loop Contract
 *   - --watch
 *   - outside/coordination/process panels only
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { isLaneContractComplete, normalizePanels, parseLaneDoc, type MonitorPanel } from "./lane-core"

interface Args {
  lanePath: string | null
  watch: boolean
  append: boolean
  latestNovel: boolean
  novelId: string | null
  intervalSec: string | null
  staleMinutes: string | null
  panels: MonitorPanel[]
}

const DEFAULT_MONITOR_PANELS: MonitorPanel[] = ["outside", "coordination", "process"]

export function findLatestLaneDoc(sessionsDir = "docs/sessions", requireComplete = true): string | null {
  const entries = readdirSync(sessionsDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name.endsWith(".md"))
    .filter(name => name !== "overnight-loop-context-template.md")
    .map(name => {
      const path = join(sessionsDir, name)
      return { path, mtimeMs: statSync(path).mtimeMs }
    })
    .filter(entry => {
      if (!requireComplete) return true
      try {
        return isLaneContractComplete(parseLaneDoc(readFileSync(entry.path, "utf8"), entry.path))
      } catch {
        return false
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return entries[0]?.path ?? null
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    lanePath: null,
    watch: true,
    append: false,
    latestNovel: false,
    novelId: null,
    intervalSec: null,
    staleMinutes: null,
    panels: [...DEFAULT_MONITOR_PANELS],
  }
  const panelValues: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--once") out.watch = false
    else if (a === "--watch") out.watch = true
    else if (a === "--append") out.append = true
    else if (a === "--full") {
      out.latestNovel = true
      panelValues.length = 0
      panelValues.push("all")
    }
    else if (a === "--no-latest-novel") out.latestNovel = false
    else if (a === "--latest-novel") {
      out.latestNovel = true
      out.novelId = null
    }
    else if (a === "--novel") {
      const value = argv[++i]
      if (!value || value.startsWith("--")) throw new Error("--novel requires a novel id")
      out.latestNovel = false
      out.novelId = value
    }
    else if (a === "--interval-sec") {
      const value = argv[++i]
      if (!value || value.startsWith("--")) throw new Error("--interval-sec requires a value")
      out.intervalSec = value
    }
    else if (a === "--stale-minutes") {
      const value = argv[++i]
      if (!value || value.startsWith("--")) throw new Error("--stale-minutes requires a value")
      out.staleMinutes = value
    }
    else if (a === "--panel") {
      const value = argv[++i]
      if (!value || value.startsWith("--")) throw new Error("--panel requires a value")
      panelValues.push(value)
    }
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: monitor [docs/sessions/lane.md] [options]\n\n" +
          "Defaults to latest complete non-template docs/sessions/*.md, --watch, --no-latest-novel, and outside/coordination/process panels.\n\n" +
          "Options:\n" +
          "  --once                 Render once instead of watching\n" +
          "  --watch                Watch until interrupted (default)\n" +
          "  --append               Append snapshots instead of redrawing in place\n" +
          "  --full                 Show all panels and latest novel summary\n" +
          "  --latest-novel         Include latest novel summary\n" +
          "  --no-latest-novel      Hide inside-harness novel summary (default)\n" +
          "  --novel <id>           Include specific novel summary\n" +
          "  --panel <name>         Panel to show: all,outside,coordination,inside,evidence,hygiene,process (default: outside,coordination,process)\n" +
          "  --interval-sec <n>     Watch refresh interval\n" +
          "  --stale-minutes <n>    Heartbeat stale threshold\n",
      )
      process.exit(0)
    } else if (!a.startsWith("--")) {
      out.lanePath = a
    } else {
      throw new Error(`unknown option: ${a}`)
    }
  }
  out.panels = panelValues.length > 0 ? normalizePanels(panelValues) : out.panels
  return out
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  return await runMonitor(args)
}

function dashboardArgsFor(args: Args, lanePath: string): string[] {
  const dashboardArgs = ["scripts/agent/lane-dashboard.ts", lanePath]
  if (args.watch) dashboardArgs.push("--watch")
  if (args.append) dashboardArgs.push("--append")
  if (args.latestNovel) dashboardArgs.push("--latest-novel")
  if (args.novelId) dashboardArgs.push("--novel", args.novelId)
  if (args.intervalSec) dashboardArgs.push("--interval-sec", args.intervalSec)
  if (args.staleMinutes) dashboardArgs.push("--stale-minutes", args.staleMinutes)
  if (!(args.panels.length === 1 && args.panels[0] === "all")) dashboardArgs.push("--panel", args.panels.join(","))
  return dashboardArgs
}

function renderWaiting(args: Args): string {
  const interval = args.intervalSec ?? "5"
  return [
    `Monitor waiting  ${new Date().toISOString()}`,
    "state: WAITING  reason: no active lane doc with a complete Loop Contract found",
    "",
    "Create a lane doc from docs/sessions/overnight-loop-context-template.md, fill the Loop Contract, and monitor will attach automatically.",
    "Or pass an explicit legacy doc path if you want to inspect an old session.",
    "",
    `poll interval: ${interval}s`,
    "stop: Ctrl-C",
  ].join("\n")
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForLane(args: Args): Promise<number> {
  const intervalMs = Number(args.intervalSec ?? "5") * 1000
  const append = args.append
  if (!append && !process.stdout.isTTY) {
    console.log(renderWaiting(args))
    console.error("[monitor] stdout is not a TTY; rendered one waiting snapshot instead of repeating watch frames. Use --append to force repeated snapshots.")
    return 2
  }
  if (!append) {
    process.stdout.write("\x1b[?1049h\x1b[?25l")
    const restore = () => {
      process.stdout.write("\x1b[?25h\x1b[?1049l\n")
      process.exit(0)
    }
    process.on("SIGINT", restore)
    process.on("SIGTERM", restore)
  }

  for (;;) {
    const lanePath = findLatestLaneDoc()
    if (lanePath) {
      if (!append) process.stdout.write("\x1b[?25h\x1b[?1049l\n")
      const result = spawnSync("bun", dashboardArgsFor(args, lanePath), { stdio: "inherit" })
      return result.status ?? 1
    }
    if (append) process.stdout.write(`\n--- monitor waiting ${new Date().toISOString()} ---\n`)
    else process.stdout.write("\x1b[H\x1b[J")
    console.log(renderWaiting(args))
    await sleep(intervalMs)
  }
}

async function runMonitor(args: Args): Promise<number> {
  const lanePath = args.lanePath ?? findLatestLaneDoc()
  if (!lanePath) {
    if (args.watch) {
      return await waitForLane(args)
    }
    console.error("[monitor] error: no active lane doc with a complete Loop Contract found.")
    console.error("Create one from docs/sessions/overnight-loop-context-template.md, or pass an explicit legacy doc path.")
    return 2
  }

  const result = spawnSync("bun", dashboardArgsFor(args, lanePath), { stdio: "inherit" })
  return result.status ?? 1
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => {
      console.error(`[monitor] error: ${err instanceof Error ? err.message : err}`)
      process.exit(2)
    })
}
