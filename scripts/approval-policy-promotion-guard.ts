#!/usr/bin/env bun
/**
 * Phase 7 policy-change promotion guard.
 *
 * Acceptance target: an ApprovalPolicy behavior change must be accompanied by
 * a replay report. This script is CI/pre-commit friendly: it detects changed
 * policy/application files and requires a passing ApprovalPolicy replay report.
 *
 * Usage:
 *   bun scripts/approval-policy-promotion-guard.ts --base origin/main --report /tmp/replay-report.json
 *   bun scripts/approval-policy-promotion-guard.ts --changed-file src/canon/approval-policy.ts --report /tmp/replay.json
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import type { PolicyReplayReport } from "../src/canon/approval-policy-replay"

interface ReplayReportWithGeneratorDrift extends PolicyReplayReport {
  generatorReplay?: {
    missingExpected?: unknown[]
    unexpectedGenerated?: unknown[]
  }
}

export const POLICY_CHANGE_FILES = new Set([
  "src/canon/approval-policy.ts",
  "src/orchestrator/policy-decide-routes.ts",
  "src/orchestrator/proposal-envelope-routes.ts",
  "src/orchestrator/prose-edit-routes.ts",
  "src/orchestrator/canon-proposal-routes.ts",
])

export interface PromotionGuardInput {
  changedFiles: readonly string[]
  reportPath?: string
}

export interface PromotionGuardResult {
  ok: boolean
  policyChanged: boolean
  changedPolicyFiles: string[]
  reasons: string[]
}

export function evaluatePromotionGuard(input: PromotionGuardInput): PromotionGuardResult {
  const changedPolicyFiles = [...new Set(input.changedFiles.map(normalizePath).filter(isPolicyChangeFile))].sort()
  if (changedPolicyFiles.length === 0) {
    return {
      ok: true,
      policyChanged: false,
      changedPolicyFiles,
      reasons: ["no approval-policy behavior files changed"],
    }
  }

  if (!input.reportPath) {
    return {
      ok: false,
      policyChanged: true,
      changedPolicyFiles,
      reasons: ["approval-policy behavior changed; provide --report with a passing replay report"],
    }
  }

  const report = readReplayReport(input.reportPath)
  if (!report.ok) {
    return {
      ok: false,
      policyChanged: true,
      changedPolicyFiles,
      reasons: [report.reason],
    }
  }

  return {
    ok: true,
    policyChanged: true,
    changedPolicyFiles,
    reasons: [`approval-policy behavior changed; replay report passed (${report.report.totalRows} rows)`],
  }
}

export function parseArgs(argv = process.argv.slice(2)): {
  base: string
  reportPath?: string
  changedFiles: string[]
} {
  let base = "HEAD"
  let reportPath: string | undefined
  const changedFiles: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--base") {
      base = requiredValue(argv, ++i, "--base")
    } else if (arg === "--report") {
      reportPath = requiredValue(argv, ++i, "--report")
    } else if (arg === "--changed-file") {
      changedFiles.push(requiredValue(argv, ++i, "--changed-file"))
    } else if (arg === "--changed-files") {
      changedFiles.push(...requiredValue(argv, ++i, "--changed-files").split(",").map((s) => s.trim()).filter(Boolean))
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  return { base, reportPath, changedFiles }
}

export function isPolicyChangeFile(file: string): boolean {
  return POLICY_CHANGE_FILES.has(normalizePath(file))
}

export function changedFilesFromGit(base: string): string[] {
  const proc = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMRT", base], {
    encoding: "utf8",
  })
  if (proc.status !== 0) {
    const detail = proc.stderr?.trim() || proc.stdout?.trim() || `git diff exited ${proc.status}`
    throw new Error(`failed to list changed files: ${detail}`)
  }
  return proc.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
}

function readReplayReport(reportPath: string): { ok: true; report: PolicyReplayReport } | { ok: false; reason: string } {
  if (!existsSync(reportPath)) {
    return { ok: false, reason: `replay report not found: ${reportPath}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(reportPath, "utf8"))
  } catch (err) {
    return {
      ok: false,
      reason: `replay report is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "replay report must be a JSON object" }
  }
  const report = parsed as Partial<ReplayReportWithGeneratorDrift>
  if (typeof report.totalRows !== "number" || report.totalRows <= 0) {
    return { ok: false, reason: "replay report must contain totalRows > 0" }
  }
  if (!Array.isArray(report.byKind) || report.byKind.length === 0) {
    return { ok: false, reason: "replay report must contain non-empty byKind metrics" }
  }
  if (typeof report.promotion !== "object" || report.promotion === null || report.promotion.pass !== true) {
    return { ok: false, reason: "replay report promotion.pass must be true" }
  }

  if (report.generatorReplay !== undefined) {
    const replay = report.generatorReplay
    if (
      typeof replay !== "object" ||
      replay === null ||
      !Array.isArray(replay.missingExpected) ||
      !Array.isArray(replay.unexpectedGenerated)
    ) {
      return { ok: false, reason: "generator replay summary must include missingExpected and unexpectedGenerated arrays" }
    }
    if (replay.missingExpected.length > 0 || replay.unexpectedGenerated.length > 0) {
      return { ok: false, reason: "generator replay report contains envelope drift" }
    }
  }
  return { ok: true, report: report as PolicyReplayReport }
}

function normalizePath(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\//, "")
}

function requiredValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args: ReturnType<typeof parseArgs>
  let result: PromotionGuardResult
  try {
    args = parseArgs(argv)
    const changedFiles = args.changedFiles.length > 0 ? args.changedFiles : changedFilesFromGit(args.base)
    result = evaluatePromotionGuard({
      changedFiles,
      reportPath: args.reportPath,
    })
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 2
  }

  const prefix = result.ok ? "approval-policy-promotion-guard: PASS" : "approval-policy-promotion-guard: FAIL"
  console.log(prefix)
  for (const reason of result.reasons) console.log(`- ${reason}`)
  if (result.changedPolicyFiles.length > 0) {
    console.log(`changed policy files:`)
    for (const file of result.changedPolicyFiles) console.log(`- ${file}`)
  }

  return result.ok ? 0 : 1
}

if (import.meta.main) {
  process.exitCode = await main()
}
