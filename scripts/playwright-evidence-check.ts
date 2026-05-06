#!/usr/bin/env bun

import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

export interface PlaywrightEvidenceCheckArgs {
  dir: string | null
  json: boolean
}

export type EvidenceRunStatus = "clear" | "not-clear" | "incomplete"
export type EvidenceCheckStatus = "pass" | "fail"
export type EvidenceCheckFailureKind = "not-clear" | "incomplete"

export interface EvidenceCheckResult {
  name: string
  status: EvidenceCheckStatus
  detail: string
  failureKind?: EvidenceCheckFailureKind
}

export interface ChecklistSummary {
  total: number
  passed: number
  failed: number
  blocked: number
  unchecked: number
}

export interface PlaywrightEvidenceReport {
  evidenceDir: string
  status: EvidenceRunStatus
  checks: EvidenceCheckResult[]
  checklist: ChecklistSummary
  screenshots: string[]
  manifest: Record<string, unknown> | null
}

export function parseArgs(argv: string[]): PlaywrightEvidenceCheckArgs {
  const args: PlaywrightEvidenceCheckArgs = {
    dir: null,
    json: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--dir") args.dir = resolve(requireValue(argv, ++i, arg))
    else if (arg === "--json") args.json = true
    else if (arg === "--help" || arg === "-h") throw new UsageError(usage(), 0)
    else throw new UsageError(`unknown arg: ${arg}\n\n${usage()}`, 1)
  }

  if (!args.dir) throw new UsageError(`missing required --dir\n\n${usage()}`, 1)
  return args
}

export async function inspectPlaywrightEvidence(evidenceDir: string): Promise<PlaywrightEvidenceReport> {
  const dir = resolve(evidenceDir)
  const checks: EvidenceCheckResult[] = []

  const dirExists = await isDirectory(dir)
  checks.push({
    name: "evidence directory",
    status: dirExists ? "pass" : "fail",
    detail: dirExists ? dir : "directory not found",
    failureKind: dirExists ? undefined : "incomplete",
  })
  if (!dirExists) {
    return finishReport(dir, checks, emptyChecklist(), [], null)
  }

  const files = await readdir(dir)
  const requiredFiles = ["RUNBOOK.md", "CHECKLIST.md", "console-final.md", "network-final.md", "manifest.json"]
  for (const file of requiredFiles) {
    checks.push({
      name: `required file ${file}`,
      status: files.includes(file) ? "pass" : "fail",
      detail: files.includes(file) ? "present" : "missing",
      failureKind: files.includes(file) ? undefined : "incomplete",
    })
  }

  const manifest = await readManifest(join(dir, "manifest.json"))
  checks.push({
    name: "manifest parse",
    status: manifest ? "pass" : "fail",
    detail: manifest ? manifestDetail(manifest) : "manifest.json missing or invalid JSON",
    failureKind: manifest ? undefined : "incomplete",
  })
  if (manifest) checks.push(manifestCompletenessCheck(manifest))

  const checklistText = await readText(join(dir, "CHECKLIST.md"))
  const checklist = parseChecklist(checklistText ?? "")
  const checklistFailure = checklistFailureKind(checklist)
  checks.push({
    name: "checklist completion",
    status: checklistFailure ? "fail" : "pass",
    detail: `total=${checklist.total}, passed=${checklist.passed}, failed=${checklist.failed}, blocked=${checklist.blocked}, unchecked=${checklist.unchecked}`,
    failureKind: checklistFailure,
  })

  const imageFiles = files.filter(file => /\.(png|jpe?g|webp)$/i.test(file))
  const screenshots = (await nonEmptyFiles(dir, imageFiles)).sort((a, b) => a.localeCompare(b))
  const baselineScreenshots = screenshots.filter(file => file.toLowerCase().includes("baseline"))
  const interactionScreenshots = screenshots.filter(file => !file.toLowerCase().includes("baseline"))
  checks.push({
    name: "baseline screenshot",
    status: baselineScreenshots.length > 0 ? "pass" : "fail",
    detail: baselineScreenshots.length > 0 ? baselineScreenshots.join(", ") : "no screenshot filename contains baseline",
    failureKind: baselineScreenshots.length > 0 ? undefined : "incomplete",
  })
  checks.push({
    name: "screenshot inventory",
    status: screenshots.length > 0 ? "pass" : "fail",
    detail: `${screenshots.length} non-empty image file(s)`,
    failureKind: screenshots.length > 0 ? undefined : "incomplete",
  })
  checks.push({
    name: "interaction screenshot",
    status: interactionScreenshots.length > 0 ? "pass" : "fail",
    detail: interactionScreenshots.length > 0 ? interactionScreenshots.join(", ") : "no non-baseline screenshot found",
    failureKind: interactionScreenshots.length > 0 ? undefined : "incomplete",
  })

  checks.push(await captureFileCheck("console capture", join(dir, "console-final.md")))
  checks.push(await captureFileCheck("network capture", join(dir, "network-final.md")))

  return finishReport(dir, checks, checklist, screenshots, manifest)
}

export function renderPlaywrightEvidenceReport(report: PlaywrightEvidenceReport): string {
  const lines: string[] = []
  lines.push(`Playwright evidence check: ${report.status}`)
  lines.push(`Evidence directory: ${report.evidenceDir}`)
  if (report.manifest) {
    lines.push(`Surface: ${String(report.manifest.surface ?? "?")}`)
    lines.push(`Starting URL: ${String(report.manifest.startingUrl ?? "?")}`)
  }
  lines.push(
    `Checklist: ${report.checklist.passed}/${report.checklist.total} passed, ` +
      `${report.checklist.failed} failed, ${report.checklist.blocked} blocked, ${report.checklist.unchecked} unchecked`,
  )
  lines.push(`Screenshots: ${report.screenshots.length}`)
  lines.push("")
  for (const check of report.checks) {
    const mark = check.status === "pass" ? "PASS" : "FAIL"
    const kind = check.failureKind ? `/${check.failureKind}` : ""
    lines.push(`- ${mark}${kind} ${check.name}: ${check.detail}`)
  }
  return lines.join("\n")
}

function finishReport(
  evidenceDir: string,
  checks: EvidenceCheckResult[],
  checklist: ChecklistSummary,
  screenshots: string[],
  manifest: Record<string, unknown> | null,
): PlaywrightEvidenceReport {
  const status = checks.some(check => check.failureKind === "incomplete")
    ? "incomplete"
    : checks.some(check => check.status === "fail")
      ? "not-clear"
      : "clear"
  return {
    evidenceDir,
    status,
    checks,
    checklist,
    screenshots,
    manifest,
  }
}

function checklistFailureKind(checklist: ChecklistSummary): EvidenceCheckFailureKind | undefined {
  if (checklist.total === 0 || checklist.unchecked > 0) return "incomplete"
  if (checklist.failed > 0 || checklist.blocked > 0) return "not-clear"
  return undefined
}

function parseChecklist(text: string): ChecklistSummary {
  const summary = emptyChecklist()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*-\s*\[([ xX!?])\]\s+/.exec(line)
    if (!match) continue
    summary.total++
    const status = match[1]
    if (status === "x" || status === "X") summary.passed++
    else if (status === "!") summary.failed++
    else if (status === "?") summary.blocked++
    else summary.unchecked++
  }
  return summary
}

function emptyChecklist(): ChecklistSummary {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    unchecked: 0,
  }
}

async function captureFileCheck(name: string, path: string): Promise<EvidenceCheckResult> {
  const text = await readText(path)
  if (text === null) {
    return { name, status: "fail", detail: `${basename(path)} missing`, failureKind: "incomplete" }
  }
  if (/Pending Playwright MCP capture/i.test(text)) {
    return { name, status: "fail", detail: `${basename(path)} still contains placeholder text`, failureKind: "incomplete" }
  }
  if (!text.trim()) {
    return { name, status: "fail", detail: `${basename(path)} is empty`, failureKind: "incomplete" }
  }
  return { name, status: "pass", detail: `${basename(path)} captured` }
}

function manifestCompletenessCheck(manifest: Record<string, unknown>): EvidenceCheckResult {
  const requiredStringFields = ["surface", "baseUrl", "startingUrl", "evidenceDir", "createdAt"]
  const missing = requiredStringFields.filter(field => typeof manifest[field] !== "string" || !String(manifest[field]).trim())
  const server = typeof manifest.server === "object" && manifest.server !== null && !Array.isArray(manifest.server)
    ? manifest.server as Record<string, unknown>
    : null
  if (server?.ok !== true) missing.push("server.ok")
  return {
    name: "manifest completeness",
    status: missing.length === 0 ? "pass" : "fail",
    detail: missing.length === 0 ? "required fields present" : `missing/invalid: ${missing.join(", ")}`,
    failureKind: missing.length === 0 ? undefined : "incomplete",
  }
}

async function readManifest(path: string): Promise<Record<string, unknown> | null> {
  const text = await readText(path)
  if (text === null) return null
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function manifestDetail(manifest: Record<string, unknown>): string {
  const surface = typeof manifest.surface === "string" ? manifest.surface : "?"
  const startingUrl = typeof manifest.startingUrl === "string" ? manifest.startingUrl : "?"
  return `surface=${surface}, startingUrl=${startingUrl}`
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function nonEmptyFiles(dir: string, files: string[]): Promise<string[]> {
  const out: string[] = []
  for (const file of files) {
    try {
      const s = await stat(join(dir, file))
      if (s.isFile() && s.size > 0) out.push(file)
    } catch {
      // Ignore missing files between readdir and stat.
    }
  }
  return out
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new UsageError(`missing value for ${flag}\n\n${usage()}`, 1)
  }
  return value
}

function usage(): string {
  return [
    "Usage:",
    "  bun run ui:evidence-check -- --dir output/playwright/<date>/<surface-novel>",
    "",
    "Options:",
    "  --dir <path>       Required evidence directory.",
    "  --json             Emit JSON instead of text.",
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
    const args = parseArgs(process.argv.slice(2))
    const report = await inspectPlaywrightEvidence(args.dir!)
    console.log(args.json ? JSON.stringify(report, null, 2) : renderPlaywrightEvidenceReport(report))
    process.exit(report.status === "clear" ? 0 : 1)
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message)
      process.exit(err.exitCode)
    }
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
