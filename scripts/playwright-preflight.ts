#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export interface PlaywrightPreflightArgs {
  surface: string
  novel: string | null
  session: string | null
  url: string | null
  checklist: string | null
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
  checklistPath: string
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
    checklist: null,
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
    else if (arg === "--checklist") args.checklist = requireValue(argv, ++i, arg)
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
    checklistPath: join(evidenceDir, "CHECKLIST.md"),
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
  await writeFile(plan.checklistPath, renderChecklist(plan), "utf8")
  await writeFile(plan.consolePath, "# Console Capture\n\nPending Playwright MCP capture.\n", "utf8")
  await writeFile(plan.networkPath, "# Network Capture\n\nPending Playwright MCP capture.\n", "utf8")
  await writeFile(plan.manifestPath, `${JSON.stringify({
    surface: args.surface,
    novel: args.novel,
    session: args.session,
    baseUrl: args.baseUrl,
    startingUrl: plan.startingUrl,
    checklist: checklistKind(args),
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
- CHECKLIST.md with each applicable item marked pass/fail/blocked
- console-final.md
- network-final.md

## MCP Steps

1. Use Playwright MCP browser tools to open the starting URL.
2. Use only disposable/test data.
3. Capture screenshots into this evidence directory.
4. Mark each applicable item in CHECKLIST.md as pass/fail/blocked.
5. Record console errors and failed network requests in the files above.
6. Report pass/fail and blockers in the handoff.
7. Close the Playwright MCP tab/session when finished.
8. Stop any app server started only for this run.
`
}

function renderChecklist(plan: PlaywrightPreflightPlan): string {
  const kind = checklistKind(plan.args)
  const items = checklistItems(kind)
  return [
    "# Browser Evidence Checklist",
    "",
    `Surface: ${plan.args.surface}`,
    `Checklist: ${kind}`,
    `Starting URL: ${plan.startingUrl ?? "fill in before browser run"}`,
    "",
    "Mark each line `[x] pass`, `[!] fail`, or `[?] blocked/untested` before handoff.",
    "",
    ...items.map(item => `- [ ] ${item}`),
    "",
  ].join("\n")
}

function checklistKind(args: PlaywrightPreflightArgs): string {
  if (args.checklist?.trim()) return slug(args.checklist)
  const surface = args.surface.toLowerCase()
  if (surface.includes("canon")) return "canon-proposals"
  if (surface.includes("artifact")) return "artifact-patches"
  if (surface.includes("planning") || surface.includes("studio")) return "planning-studio"
  if (surface.includes("traceability")) return "traceability"
  if (surface.includes("chapter-health")) return "chapter-health"
  return "generic"
}

function checklistItems(kind: string): string[] {
  if (kind === "canon-proposals") {
    return [
      "Pending proposal list loads on disposable data.",
      "Single approve resolves one pending proposal and records the updated row.",
      "Single reject resolves one pending proposal and records the updated row.",
      "Modify-with-edits creates a modified resolution and visible before/after state.",
      "Pending, approved, rejected, and all status tabs/filters render correctly.",
      "Bulk approve/reject works only on disposable selected proposals and shows a capped summary.",
      "Console capture has no unexpected errors; network capture has no unexpected failed API calls.",
    ]
  }
  if (kind === "artifact-patches") {
    return [
      "Studio artifact proposal cards load persisted pending envelopes.",
      "Single approve/reject resolves disposable artifact patch envelopes.",
      "Stale-precondition envelope shows safe regenerate or stale handling UI.",
      "Bulk quick actions resolve only disposable selected envelopes.",
      "Resolved envelopes appear in audit history/status tabs.",
      "Console capture has no unexpected errors; network capture has no unexpected failed API calls.",
    ]
  }
  if (kind === "planning-studio") {
    return [
      "Target navigation loads chapter, beat, obligation, directive, character, world, and spine targets that exist in the fixture.",
      "Impact preview updates deterministically for the selected target.",
      "Proposal creation writes a pending envelope with a visible before/after diff.",
      "Approve, reject, and modify-before-approve paths work on disposable proposals.",
      "Status tabs/grouping show pending and resolved proposal history.",
      "Console capture has no unexpected errors; network capture has no unexpected failed API calls.",
    ]
  }
  if (kind === "traceability") {
    return [
      "Traceability page loads the requested chapter.",
      "Source registry and upstream target refs render with stable IDs.",
      "Writer/checker/event evidence expands without layout overlap.",
      "Adjacent navigation back to chapter health or proposal evidence works when present.",
      "Console capture has no unexpected errors; network capture has no unexpected failed API calls.",
    ]
  }
  if (kind === "chapter-health") {
    return [
      "Chapter health page loads the requested novel.",
      "Status filters update the visible chapter set.",
      "Evidence expansion shows checker/proposal/trace details.",
      "Mobile viewport keeps cards, filters, and action links readable.",
      "Console capture has no unexpected errors; network capture has no unexpected failed API calls.",
    ]
  }
  return [
    "Baseline page load succeeds on disposable/test data.",
    "Primary golden-path action for this surface succeeds.",
    "One relevant edge case or empty/error state is exercised.",
    "One adjacent navigation or regression-prone surface is checked.",
    "Console capture has no unexpected errors; network capture has no unexpected failed API calls.",
  ]
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
    "  --checklist <kind>     Optional checklist kind; inferred from --surface by default.",
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
