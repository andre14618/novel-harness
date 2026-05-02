#!/usr/bin/env bun
/**
 * Pre-loop gate: validate a lane doc + worktree before launching an
 * unattended Claude/OpenCode runner cycle. Closes todo §L45.
 *
 * Checks:
 *   1. Loop Contract has every REQUIRED_LOOP_FIELDS entry
 *   2. Starting commit resolves via `git rev-parse --verify <sha>^{commit}`
 *   3. Experiment ID parses as a positive integer
 *   4. Files/scripts expected to change is non-empty (deploy implication)
 *   5. Worktree is clean unless `--allow-dirty` is passed
 *
 * Exits 0 on pass, 10 on lane-context failure, 20 on dirty worktree without
 * override, 22 on git/infra failure (commit unresolvable). Mirrors the
 * lane-runner exit-code vocabulary.
 */

import { spawnSync } from "node:child_process"
import {
  field,
  missingRequiredLaneFields,
  readLaneDoc,
  type ParsedLaneDoc,
} from "./lane-core"

export interface PreflightOptions {
  allowDirty: boolean
}

export interface PreflightCheck {
  name: string
  ok: boolean
  message: string
  code: "lane-context" | "dirty-worktree" | "git-infra" | "ok"
}

export interface PreflightContext {
  doc: ParsedLaneDoc
  dirtyFiles: string[]
  resolveCommit: (sha: string) => boolean
}

export interface PreflightResult {
  ok: boolean
  laneId: string
  checks: PreflightCheck[]
  failures: PreflightCheck[]
}

export function runPreflightChecks(ctx: PreflightContext, opts: PreflightOptions): PreflightResult {
  const checks: PreflightCheck[] = []

  const missing = missingRequiredLaneFields(ctx.doc)
  checks.push({
    name: "loop contract complete",
    ok: missing.length === 0,
    message: missing.length === 0
      ? "all required fields present"
      : `missing: ${missing.join("; ")}`,
    code: missing.length === 0 ? "ok" : "lane-context",
  })

  const startingCommit = field(ctx.doc, "loop contract", "starting commit").split(/\s+/)[0] ?? ""
  if (!startingCommit) {
    checks.push({
      name: "starting commit resolves",
      ok: false,
      message: "starting commit field is empty",
      code: "lane-context",
    })
  } else {
    const ok = ctx.resolveCommit(startingCommit)
    checks.push({
      name: "starting commit resolves",
      ok,
      message: ok
        ? `${startingCommit} resolves to a real commit`
        : `cannot rev-parse ${startingCommit} (not in repo history)`,
      code: ok ? "ok" : "git-infra",
    })
  }

  const expRaw = field(ctx.doc, "loop contract", "experiment id")
  const expId = Number(expRaw)
  const expOk = Number.isInteger(expId) && expId > 0
  checks.push({
    name: "experiment id numeric",
    ok: expOk,
    message: expOk
      ? `experiment ${expId}`
      : `experiment id is not a positive integer: ${JSON.stringify(expRaw)}`,
    code: expOk ? "ok" : "lane-context",
  })

  const filesScope = field(ctx.doc, "loop contract", "files/scripts expected to change")
  checks.push({
    name: "files/scripts expected to change declared",
    ok: filesScope.length > 0,
    message: filesScope.length > 0
      ? `scope: ${filesScope.slice(0, 100)}${filesScope.length > 100 ? "..." : ""}`
      : "missing 'Files/scripts expected to change' (deploy implication unclear)",
    code: filesScope.length > 0 ? "ok" : "lane-context",
  })

  const dirtyClean = ctx.dirtyFiles.length === 0
  if (dirtyClean) {
    checks.push({
      name: "worktree clean",
      ok: true,
      message: "no dirty files",
      code: "ok",
    })
  } else if (opts.allowDirty) {
    const preview = ctx.dirtyFiles.slice(0, 4).join(", ")
    checks.push({
      name: "worktree clean",
      ok: true,
      message: `dirty allowed (${ctx.dirtyFiles.length} files: ${preview}${ctx.dirtyFiles.length > 4 ? "..." : ""})`,
      code: "ok",
    })
  } else {
    const preview = ctx.dirtyFiles.slice(0, 4).join(", ")
    checks.push({
      name: "worktree clean",
      ok: false,
      message: `${ctx.dirtyFiles.length} dirty files (use --allow-dirty to override): ${preview}${ctx.dirtyFiles.length > 4 ? "..." : ""}`,
      code: "dirty-worktree",
    })
  }

  const failures = checks.filter(c => !c.ok)
  return { ok: failures.length === 0, laneId: ctx.doc.laneId, checks, failures }
}

export function exitCodeForResult(result: PreflightResult): number {
  if (result.ok) return 0
  const codes = new Set(result.failures.map(f => f.code))
  if (codes.has("git-infra")) return 22
  if (codes.has("dirty-worktree") && codes.size === 1) return 20
  return 10
}

export function renderPreflightResult(result: PreflightResult): string {
  const lines = [`preflight-loop ${result.ok ? "PASS" : "FAIL"} lane=${result.laneId}`]
  for (const check of result.checks) {
    const marker = check.ok ? "✓" : "✗"
    lines.push(`  ${marker} ${check.name}: ${check.message}`)
  }
  return lines.join("\n")
}

interface CliArgs {
  lanePath: string | null
  allowDirty: boolean
  json: boolean
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { lanePath: null, allowDirty: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--allow-dirty") out.allowDirty = true
    else if (a === "--json") out.json = true
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun scripts/agent/preflight-loop.ts <docs/sessions/lane.md> [options]\n\n" +
          "Pre-loop gate: validate lane context + worktree before unattended runs.\n\n" +
          "Options:\n" +
          "  --allow-dirty    Pass even if the worktree has uncommitted changes\n" +
          "  --json           Print machine-readable JSON\n\n" +
          "Exit codes: 0 pass, 10 lane-context, 20 dirty-worktree, 22 git-infra, 2 cli error",
      )
      process.exit(0)
    } else if (!a.startsWith("--")) {
      out.lanePath = a
    } else {
      throw new Error(`unknown arg: ${a}`)
    }
  }
  if (!out.lanePath) throw new Error("preflight-loop requires a lane session doc path")
  return out
}

function readDirtyFilesFromGit(): string[] {
  const r = spawnSync("git", ["status", "--porcelain=v1"], { encoding: "utf8" })
  if (r.status !== 0) {
    throw new Error(`git status failed: ${(r.stderr || r.stdout || "").trim()}`)
  }
  const out: string[] = []
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue
    out.push(line.slice(3).trim())
  }
  return out
}

function commitResolverFromGit(sha: string): boolean {
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return false
  const r = spawnSync("git", ["rev-parse", "--verify", `${sha}^{commit}`], { encoding: "utf8" })
  return r.status === 0
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  const doc = readLaneDoc(args.lanePath!)
  const dirtyFiles = readDirtyFilesFromGit()
  const result = runPreflightChecks(
    { doc, dirtyFiles, resolveCommit: commitResolverFromGit },
    { allowDirty: args.allowDirty },
  )
  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(renderPreflightResult(result))
  }
  return exitCodeForResult(result)
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    console.error(`[preflight-loop] error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}
