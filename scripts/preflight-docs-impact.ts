#!/usr/bin/env bun
/**
 * Preflight check for docs-impact discipline.
 *
 * Per `docs/commit-conventions.md`: any commit that touches **runtime**
 * surfaces (agents, phases, llm/transport, lint, model registry, pipeline
 * config, SQL migrations) should either:
 *   (a) update `docs/current-state.md` in the same commit, OR
 *   (b) include the footer `docs-impact: none` in the commit body.
 *
 * This script inspects staged changes (or a target commit) and warns when
 * a runtime change is staged without either marker. Intended to wire into
 * a local pre-commit hook OR to be invoked manually before `git commit`.
 *
 * USAGE
 *
 *   bun scripts/preflight-docs-impact.ts            # check staged files
 *   bun scripts/preflight-docs-impact.ts --strict   # exit 1 on warnings
 *   bun scripts/preflight-docs-impact.ts --commit HEAD  # check HEAD's diff
 *                                                       # + message
 *
 * Pre-commit hook integration (opt-in, not tracked in git by default):
 *
 *   echo 'bun scripts/preflight-docs-impact.ts || exit 1' >> .git/hooks/pre-commit
 *   chmod +x .git/hooks/pre-commit
 *
 * Why pre-commit and not post-commit: the message footer `docs-impact: none`
 * is only checkable AFTER the message is composed. For staged-only mode
 * (default), this script is more conservative — it warns whenever runtime
 * files are staged without `docs/current-state.md` co-staged. Operators
 * who intentionally ship `docs-impact: none` can run with `--commit HEAD`
 * after the fact to confirm the decision held.
 *
 * Closes §12 "Add a preflight check for docs-impact discipline" todo.
 */

import { spawnSync } from "node:child_process"

// ── Runtime surface globs (anchored to repo root) ─────────────────────────
//
// Mirrors `CLAUDE.md` "Required deploy surfaces" + a small extension for
// SQL migrations. Patterns are evaluated as path prefixes / wildcards.
//
// Keep this list in sync with CLAUDE.md when surfaces change.
const RUNTIME_SURFACE_PATTERNS = [
  /^src\/agents\//,
  /^src\/phases\//,
  /^src\/lint\//,
  /^src\/models\/(roles|registry)\.ts$/,
  /^src\/config\/pipeline\.ts$/,
  /^src\/llm\.ts$/,
  /^src\/transport\.ts$/,
  /^sql\//,
]

// Doc files whose update satisfies the discipline.
const DOC_PATHS_THAT_COUNT = [
  "docs/current-state.md",
  // decisions.md does NOT count — it can change without runtime impact.
  // Only current-state.md is the authoritative live-system doc.
]

// Footer marker (case-insensitive prefix match on a line).
const NO_DOCS_FOOTER_REGEX = /^docs-impact:\s*none\s*$/im

// ── Pure helpers (exported for tests) ─────────────────────────────────────

export function isRuntimeFile(path: string): boolean {
  if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return false
  return RUNTIME_SURFACE_PATTERNS.some(re => re.test(path))
}

export function classifyStagedFiles(paths: string[]): {
  runtime: string[]
  docs: string[]
} {
  const runtime: string[] = []
  const docs: string[] = []
  for (const p of paths) {
    if (isRuntimeFile(p)) runtime.push(p)
    if (DOC_PATHS_THAT_COUNT.includes(p)) docs.push(p)
  }
  return { runtime, docs }
}

export function commitMessageDeclaresNoDocs(message: string): boolean {
  return NO_DOCS_FOOTER_REGEX.test(message)
}

export interface CheckResult {
  ok: boolean
  runtimeFiles: string[]
  docFiles: string[]
  hasFooter: boolean
  reason: string
}

export function evaluate(args: {
  stagedFiles: string[]
  commitMessage?: string | null
}): CheckResult {
  const { runtime, docs } = classifyStagedFiles(args.stagedFiles)
  if (runtime.length === 0) {
    return {
      ok: true,
      runtimeFiles: [],
      docFiles: docs,
      hasFooter: false,
      reason: "no runtime files staged — discipline not applicable",
    }
  }
  if (docs.length > 0) {
    return {
      ok: true,
      runtimeFiles: runtime,
      docFiles: docs,
      hasFooter: false,
      reason: `runtime change co-staged with ${docs.join(", ")}`,
    }
  }
  const hasFooter = args.commitMessage
    ? commitMessageDeclaresNoDocs(args.commitMessage)
    : false
  if (hasFooter) {
    return {
      ok: true,
      runtimeFiles: runtime,
      docFiles: [],
      hasFooter: true,
      reason: "commit message declares `docs-impact: none`",
    }
  }
  return {
    ok: false,
    runtimeFiles: runtime,
    docFiles: [],
    hasFooter: false,
    reason: args.commitMessage
      ? "runtime files staged; no doc co-stage and commit message lacks `docs-impact: none` footer"
      : "runtime files staged; no doc co-stage (commit message not yet available — add `docs-impact: none` if intentional)",
  }
}

// ── Git helpers (impure; only called from main()) ─────────────────────────

function stagedFiles(): string[] {
  const r = spawnSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" })
  if (r.status !== 0) {
    throw new Error(`git diff --cached failed: ${r.stderr}`)
  }
  return (r.stdout ?? "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
}

function commitDiffFiles(ref: string): string[] {
  const r = spawnSync("git", ["show", "--name-only", "--pretty=format:", ref], { encoding: "utf8" })
  if (r.status !== 0) {
    throw new Error(`git show failed for ${ref}: ${r.stderr}`)
  }
  return (r.stdout ?? "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
}

function commitMessage(ref: string): string {
  const r = spawnSync("git", ["log", "-1", "--pretty=%B", ref], { encoding: "utf8" })
  if (r.status !== 0) {
    throw new Error(`git log failed for ${ref}: ${r.stderr}`)
  }
  return r.stdout ?? ""
}

// ── CLI ───────────────────────────────────────────────────────────────────

interface Args {
  strict: boolean
  commit: string | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = { strict: false, commit: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--strict") out.strict = true
    else if (a === "--commit") out.commit = argv[++i] ?? "HEAD"
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun scripts/preflight-docs-impact.ts [--strict] [--commit <ref>]\n\n" +
          "Default mode: inspect staged changes (`git diff --cached`).\n" +
          "  --strict        Exit 1 when discipline is violated (default: warn-only).\n" +
          "  --commit <ref>  Inspect the commit at <ref> instead, including its message.",
      )
      process.exit(0)
    }
  }
  return out
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  let files: string[]
  let message: string | null = null
  if (args.commit) {
    files = commitDiffFiles(args.commit)
    message = commitMessage(args.commit)
  } else {
    files = stagedFiles()
  }
  const r = evaluate({ stagedFiles: files, commitMessage: message })
  if (r.ok) {
    console.log(`[docs-impact] OK — ${r.reason}`)
    return 0
  }
  const lines: string[] = [
    "[docs-impact] WARN — runtime files staged without docs co-stage:",
    ...r.runtimeFiles.map(f => `  ${f}`),
    "",
    "Resolution options:",
    "  (a) co-stage `docs/current-state.md` with the runtime change, OR",
    "  (b) add `docs-impact: none` footer to the commit message body.",
  ]
  for (const l of lines) console.log(l)
  return args.strict ? 1 : 0
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)))
}
