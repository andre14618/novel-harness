#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

import {
  RUN_MANIFEST_FILENAME,
  type RunManifest,
  type RunManifestSetEntry,
  validateRunManifestSet,
} from "./run-manifest"

interface Args {
  paths: string[]
  cwd: string
  strictParentLinks: boolean
  verifyArtifacts: boolean
  json: boolean
}

interface ValidationReport {
  ok: boolean
  manifestCount: number
  issues: string[]
  manifestPaths: string[]
}

export function buildRunManifestValidationReport(args: Args): ValidationReport {
  const manifestPaths = uniqueStrings(args.paths.flatMap(path => collectManifestPaths(path, args.cwd)))
  const entries: RunManifestSetEntry[] = []
  const issues: string[] = []

  for (const manifestPath of manifestPaths) {
    try {
      entries.push({
        path: repoRelativePath(manifestPath, args.cwd),
        manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as RunManifest,
      })
    } catch (error) {
      issues.push(`${repoRelativePath(manifestPath, args.cwd)}: failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  issues.push(...validateRunManifestSet(entries, {
    cwd: args.cwd,
    strictParentLinks: args.strictParentLinks,
    verifyArtifacts: args.verifyArtifacts,
  }))

  return {
    ok: issues.length === 0,
    manifestCount: entries.length,
    issues,
    manifestPaths: entries.map(entry => entry.path ?? entry.manifest.runId),
  }
}

export function renderRunManifestValidationReport(report: ValidationReport): string {
  const lines: string[] = []
  lines.push("# Run Manifest Validation")
  lines.push("")
  lines.push(`Status: ${report.ok ? "PASS" : "FAIL"}`)
  lines.push(`Manifests: ${report.manifestCount}`)
  lines.push("")
  if (report.issues.length === 0) {
    lines.push("No manifest schema, lineage, or artifact-hash issues found.")
  } else {
    lines.push("## Issues")
    lines.push("")
    for (const issue of report.issues) lines.push(`- ${issue}`)
  }
  return `${lines.join("\n")}\n`
}

function collectManifestPaths(inputPath: string, cwd: string): string[] {
  const absolute = resolve(cwd, inputPath)
  if (!existsSync(absolute)) throw new Error(`path does not exist: ${inputPath}`)
  const stat = statSync(absolute)
  if (stat.isFile()) return [absolute]
  if (!stat.isDirectory()) return []

  const paths: string[] = []
  for (const name of readdirSync(absolute)) {
    const child = join(absolute, name)
    const childStat = statSync(child)
    if (childStat.isDirectory()) {
      paths.push(...collectManifestPaths(child, cwd))
    } else if (name === RUN_MANIFEST_FILENAME || name.endsWith(".manifest.json")) {
      paths.push(child)
    }
  }
  return paths
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const paths: string[] = []
  let cwd = process.cwd()
  let strictParentLinks = false
  let verifyArtifacts = true
  let json = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === "--cwd") {
      const value = argv[++index]
      if (!value) throw new Error("--cwd requires a path")
      cwd = resolve(value)
    } else if (arg === "--strict-parent-links") {
      strictParentLinks = true
    } else if (arg === "--no-artifact-verify") {
      verifyArtifacts = false
    } else if (arg === "--json") {
      json = true
    } else if (arg === "--help" || arg === "-h") {
      usage()
      process.exit(0)
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown arg: ${arg}`)
    } else {
      paths.push(arg)
    }
  }

  if (paths.length === 0) throw new Error("at least one manifest file or directory is required")
  return { paths, cwd, strictParentLinks, verifyArtifacts, json }
}

function usage(): void {
  console.log(`Usage:
  bun scripts/evals/run-manifest-validate.ts <manifest-or-dir> [<manifest-or-dir> ...]

Options:
  --strict-parent-links   require every parentRunId to appear in the validated set
  --no-artifact-verify    check schema/lineage only; skip on-disk hash verification
  --cwd <path>            resolve manifest artifact paths relative to this repo root
  --json                  print machine-readable JSON
`)
}

function repoRelativePath(path: string, cwd: string): string {
  const relativePath = relative(cwd, resolve(path))
  return relativePath.startsWith("..") ? path : relativePath.split(/[\\/]/u).join("/") || "."
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const report = buildRunManifestValidationReport(args)
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      process.stdout.write(renderRunManifestValidationReport(report))
    }
    if (!report.ok) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
