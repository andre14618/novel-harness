#!/usr/bin/env bun
import {
  buildLaneStatusReport,
  exitCodeForState,
  normalizePanels,
  renderLaneStatus,
  type MonitorPanel,
} from "./lane-core"

interface Args {
  lanePath: string | null
  json: boolean
  staleMinutes: number
  harnessMode: "none" | "latest" | "novel"
  novelId?: string
  panels: MonitorPanel[]
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { lanePath: null, json: false, staleMinutes: 10, harnessMode: "none", panels: ["outside"] }
  const panelValues: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--json") out.json = true
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
        "Usage: bun scripts/agent/lane-status.ts <docs/sessions/lane.md> [options]\n\n" +
          "Options:\n" +
          "  --json                 Print machine-readable JSON\n" +
          "  --stale-minutes <n>    Block if the latest heartbeat is older than n minutes (default: 10)\n" +
          "  --latest-novel         Include inside-harness summary from newest novel\n" +
          "  --novel <id>           Include inside-harness summary for a specific novel\n" +
          "  --panel <name>         Panel to show: all,outside,inside,evidence,hygiene,process (default: outside)\n",
      )
      process.exit(0)
    } else if (!a.startsWith("--")) {
      out.lanePath = a
    }
  }
  if (!out.lanePath) throw new Error("lane-status requires a lane session doc path")
  if (panelValues.length > 0) out.panels = normalizePanels(panelValues)
  return out
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  const report = buildLaneStatusReport({
    lanePath: args.lanePath!,
    staleMinutes: args.staleMinutes,
    harnessMode: args.harnessMode,
    novelId: args.novelId,
    panels: args.panels,
  })
  if (args.json) console.log(JSON.stringify(report, null, 2))
  else console.log(renderLaneStatus(report))
  return exitCodeForState(report.assessment.state)
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    console.error(`[lane-status] error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}
