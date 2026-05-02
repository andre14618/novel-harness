#!/usr/bin/env bun
import {
  buildLaneStatusReport,
  normalizePanels,
  renderLaneStatus,
  type MonitorPanel,
} from "./lane-core"

export interface Args {
  lanePath: string | null
  watch: boolean
  append: boolean
  intervalSeconds: number
  staleMinutes: number
  harnessMode: "none" | "latest" | "novel"
  novelId?: string
  panels: MonitorPanel[]
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    lanePath: null,
    watch: false,
    append: false,
    intervalSeconds: 5,
    staleMinutes: 10,
    harnessMode: "none",
    panels: ["all"],
  }
  const panelValues: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--watch") out.watch = true
    else if (a === "--append") out.append = true
    else if (a === "--interval-sec") {
      const value = Number(argv[++i])
      if (!Number.isFinite(value) || value <= 0) throw new Error("--interval-sec must be a positive number")
      out.intervalSeconds = value
    }
    else if (a === "--stale-minutes") {
      const value = Number(argv[++i])
      if (!Number.isFinite(value) || value < 0) throw new Error("--stale-minutes must be a non-negative number")
      out.staleMinutes = value
    }
    else if (a === "--latest-novel") out.harnessMode = "latest"
    else if (a === "--novel") {
      const value = argv[++i]
      if (!value || value.startsWith("--")) throw new Error("--novel requires a novel id")
      out.harnessMode = "novel"
      out.novelId = value
    }
    else if (a === "--panel") {
      const value = argv[++i]
      if (!value || value.startsWith("--")) throw new Error("--panel requires a value")
      panelValues.push(value)
    }
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun scripts/agent/lane-dashboard.ts <docs/sessions/lane.md> [options]\n\n" +
          "Options:\n" +
          "  --watch                Refresh until interrupted with stable in-place redraw\n" +
          "  --append               Append snapshots instead of redrawing in place\n" +
          "  --interval-sec <n>     Watch refresh interval (default: 5)\n" +
          "  --stale-minutes <n>    Mark heartbeat stale after n minutes (default: 10)\n" +
          "  --latest-novel         Include inside-harness summary from newest novel\n" +
          "  --novel <id>           Include inside-harness summary for a specific novel\n" +
          "  --panel <name>         Panel to show: all,outside,coordination,inside,evidence,hygiene,process (default: all)\n",
      )
      process.exit(0)
    } else if (!a.startsWith("--")) {
      out.lanePath = a
    }
  }
  if (!out.lanePath) throw new Error("lane-dashboard requires a lane session doc path")
  out.panels = normalizePanels(panelValues)
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function renderSnapshot(args: Args): string {
  const report = buildLaneStatusReport({
    lanePath: args.lanePath!,
    staleMinutes: args.staleMinutes,
    harnessMode: args.harnessMode,
    novelId: args.novelId,
    panels: args.panels,
  })
  return renderLaneStatus(report)
}

function printOnce(args: Args): void {
  console.log(renderSnapshot(args))
}

export function renderWatchFrame(snapshot: string, args: Pick<Args, "append" | "intervalSeconds">, renderMs: number): string {
  return [
    snapshot,
    "",
    "Monitor:",
    `  mode: ${args.append ? "append snapshots" : "stable in-place redraw"}`,
    `  refresh: every ${args.intervalSeconds}s; stop: Ctrl-C; render_ms=${renderMs}`,
    args.append ? null : "  note: snapshot is collected before redraw, so slow probes do not blank the screen",
  ].filter((line): line is string => line !== null).join("\n")
}

export function renderInPlaceFrame(frame: string): string {
  return `\x1b[H\x1b[2J${frame}\x1b[J`
}

export function shouldRenderSingleSnapshotInsteadOfWatch(append: boolean, stdoutIsTty = Boolean(process.stdout.isTTY)): boolean {
  return !append && !stdoutIsTty
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  if (!args.watch) {
    printOnce(args)
    return 0
  }
  if (shouldRenderSingleSnapshotInsteadOfWatch(args.append)) {
    const started = Date.now()
    console.log(renderWatchFrame(renderSnapshot(args), args, Date.now() - started))
    console.error("[lane-dashboard] stdout is not a TTY; rendered one snapshot instead of repeating watch frames. Use --append to force repeated snapshots.")
    return 0
  }
  if (!args.append) {
    process.stdout.write("\x1b[?1049h\x1b[?25l")
    const restoreCursor = () => {
      process.stdout.write("\x1b[?25h\x1b[?1049l\n")
      process.exit(0)
    }
    process.on("SIGINT", restoreCursor)
    process.on("SIGTERM", restoreCursor)
  }
  for (;;) {
    const started = Date.now()
    const snapshot = renderSnapshot(args)
    const frame = renderWatchFrame(snapshot, args, Date.now() - started)
    if (args.append) {
      process.stdout.write(`\n--- refresh ${new Date().toISOString()} ---\n`)
      console.log(frame)
    } else {
      process.stdout.write(renderInPlaceFrame(frame))
    }
    await sleep(args.intervalSeconds * 1000)
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => {
      console.error(`[lane-dashboard] error: ${err instanceof Error ? err.message : err}`)
      process.exit(2)
    })
}
