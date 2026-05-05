#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export interface PlaywrightPreflightArgs {
  surface: string
  novel: string | null
  session: string | null
  url: string | null
  baseUrl: string
  seedCommand: string | null
  date: string
  root: string
  skipServerCheck: boolean
}

export interface PlaywrightPreflightPlan {
  args: PlaywrightPreflightArgs
  sessionSlug: string
  evidenceDir: string
  startingUrl: string | null
  runbookPath: string
  consolePath: string
  networkPath: string
  manifestPath: string
}

export interface ServerCheckResult {
  ok: boolean
  status?: number
  error?: string
}

export function parseArgs(argv: string[], now = new Date()): PlaywrightPreflightArgs {
  const args: PlaywrightPreflightArgs = {
    surface: "",
    novel: null,
    session: null,
    url: null,
    baseUrl: "http://localhost:3006",
    seedCommand: null,
    date: now.toISOString().slice(0, 10),
    root: process.cwd(),
    skipServerCheck: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--surface") args.surface = requireValue(argv, ++i, arg)
    else if (arg === "--novel") args.novel = requireValue(argv, ++i, arg)
    else if (arg === "--session") args.session = requireValue(argv, ++i, arg)
    else if (arg === "--url") args.url = requireValue(argv, ++i, arg)
    else if (arg === "--base-url") args.baseUrl = trimTrailingSlash(requireValue(argv, ++i, arg))
    else if (arg === "--seed-command") args.seedCommand = requireValue(argv, ++i, arg)
    else if (arg === "--date") args.date = requireDate(requireValue(argv, ++i, arg))
    else if (arg === "--root") args.root = resolve(requireValue(argv, ++i, arg))
    else if (arg === "--skip-server-check") args.skipServerCheck = true
    else if (arg === "--help" || arg === "-h") throw new UsageError(usage(), 0)
    else throw new UsageError(`unknown arg: ${arg}\n\n${usage()}`, 1)
  }

  if (!args.surface.trim()) {
    throw new UsageError(`missing required --surface\n\n${usage()}`, 1)
  }
  if (!args.novel && !args.session) {
    args.session = new Date().toISOString().replace(/[:.]/g, "-")
  }
  return args
}

export function buildPlan(args: PlaywrightPreflightArgs): PlaywrightPreflightPlan {
  const suffix = args.novel ?? args.session ?? args.date
  const sessionSlug = `${slug(args.surface)}-${slug(suffix)}`
  const evidenceDir = join(args.root, "output", "playwright", args.date, sessionSlug)
  const startingUrl = args.url ? resolveUrl(args.url, args.baseUrl) : null
  return {
    args,
    sessionSlug,
    evidenceDir,
    startingUrl,
    runbookPath: join(evidenceDir, "RUNBOOK.md"),
    consolePath: join(evidenceDir, "console-final.md"),
    networkPath: join(evidenceDir, "network-final.md"),
    manifestPath: join(evidenceDir, "manifest.json"),
  }
}

export async function preparePlaywrightPreflight(
  args: PlaywrightPreflightArgs,
  opts: { checkServer?: (baseUrl: string) => Promise<ServerCheckResult> } = {},
): Promise<{ plan: PlaywrightPreflightPlan; server: ServerCheckResult; seedExitCode: number | null }> {
  const plan = buildPlan(args)
  await mkdir(plan.evidenceDir, { recursive: true })

  const seedExitCode = args.seedCommand ? runSeedCommand(args.seedCommand) : null
  const server = args.skipServerCheck
    ? { ok: true }
    : await (opts.checkServer ?? checkServer)(args.baseUrl)

  await writeFile(plan.runbookPath, renderRunbook(plan, server, seedExitCode), "utf8")
  await writeFile(plan.consolePath, "# Console Capture\n\nPending Playwright MCP capture.\n", "utf8")
  await writeFile(plan.networkPath, "# Network Capture\n\nPending Playwright MCP capture.\n", "utf8")
  await writeFile(plan.manifestPath, `${JSON.stringify({
    surface: args.surface,
    novel: args.novel,
    session: args.session,
    baseUrl: args.baseUrl,
    startingUrl: plan.startingUrl,
    evidenceDir: plan.evidenceDir,
    seedCommand: args.seedCommand,
    seedExitCode,
    server,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8")

  return { plan, server, seedExitCode }
}

export async function checkServer(baseUrl: string): Promise<ServerCheckResult> {
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function renderRunbook(
  plan: PlaywrightPreflightPlan,
  server: ServerCheckResult,
  seedExitCode: number | null,
): string {
  const args = plan.args
  const serverLine = server.ok
    ? `OK${server.status ? ` (${server.status})` : ""}`
    : `BLOCKED: ${server.error ?? `HTTP ${server.status}`}`
  const seedLine = args.seedCommand
    ? `${args.seedCommand} (exit ${seedExitCode})`
    : "none"
  return `# Playwright MCP Preflight

Surface: ${args.surface}
Novel: ${args.novel ?? "n/a"}
Session: ${args.session ?? plan.sessionSlug}
Base URL: ${args.baseUrl}
Starting URL: ${plan.startingUrl ?? "fill in before browser run"}
Evidence directory: ${plan.evidenceDir}
Server check: ${serverLine}
Seed command: ${seedLine}

## Required Evidence

- baseline.png
- after-action screenshots for each approve/reject/modify/bulk/stale/tab action exercised
- console-final.md
- network-final.md

## MCP Steps

1. Use Playwright MCP browser tools to open the starting URL.
2. Use only disposable/test data.
3. Capture screenshots into this evidence directory.
4. Record console errors and failed network requests in the files above.
5. Report pass/fail and blockers in the handoff.
6. Close the Playwright MCP tab/session when finished.
7. Stop any app server started only for this run.
`
}

function runSeedCommand(command: string): number {
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  })
  return result.status ?? 1
}

function resolveUrl(value: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(value)) return value
  return new URL(value, `${trimTrailingSlash(baseUrl)}/`).toString()
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new UsageError(`missing value for ${flag}\n\n${usage()}`, 1)
  }
  return value
}

function requireDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UsageError(`invalid --date ${value}; expected YYYY-MM-DD`, 1)
  }
  return value
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function slug(value: string): string {
  const out = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return out || "session"
}

function usage(): string {
  return [
    "Usage:",
    "  bun run ui:preflight -- --surface planning-studio --novel test-novel --url /app/studio/test-novel",
    "",
    "Options:",
    "  --surface <name>        Required surface/lane name.",
    "  --novel <id>            Disposable/test novel id.",
    "  --session <slug>        Session slug when no novel id applies.",
    "  --url <url-or-path>     Starting browser URL or path under --base-url.",
    "  --base-url <url>        Defaults to http://localhost:3006.",
    "  --seed-command <cmd>    Optional command to run before writing the runbook.",
    "  --skip-server-check     Do not probe --base-url.",
  ].join("\n")
}

class UsageError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message)
    this.name = "UsageError"
  }
}

if (import.meta.main) {
  try {
    const parsed = parseArgs(process.argv.slice(2))
    const { plan, server, seedExitCode } = await preparePlaywrightPreflight(parsed)
    console.log(`evidenceDir=${plan.evidenceDir}`)
    console.log(`runbook=${plan.runbookPath}`)
    if (plan.startingUrl) console.log(`startingUrl=${plan.startingUrl}`)
    if (!server.ok) console.log(`serverCheck=blocked (${server.error ?? server.status})`)
    if (seedExitCode !== null) console.log(`seedExitCode=${seedExitCode}`)
    if (seedExitCode !== null && seedExitCode !== 0) process.exit(seedExitCode)
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message)
      process.exit(err.exitCode)
    }
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
