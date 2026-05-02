#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { laneIdFromPath } from "./lane-core"

export interface FinalizeDocsArgs {
  lanePath: string | null
  result: string | null
  commits: string[]
  evidence: string[]
  cost: string | null
  message: string | null
  model: string
  variant: string
  dryRun: boolean
}

function usage(): string {
  return [
    "Usage: bun scripts/agent/finalize-docs.ts <docs/sessions/lane.md> --result <classification> [options]",
    "",
    "Hands lane documentation finalization to the OpenCode docs-finalizer agent on DeepSeek V4 Flash.",
    "The agent updates relevant durable docs and commits docs-only changes after checks pass.",
    "",
    "Options:",
    "  --result <text>       pass|refuted|new blocker|regression|infra failure|human-needed",
    "  --commit <sha>        Commit SHA/range to document; repeatable",
    "  --evidence <ref>      Evidence ref (experiment, novel, DB row, log path); repeatable",
    "  --cost <text>         Cost string to record when available",
    "  --message <text>      Commit message for docs-finalizer to use",
    "  --model <model>       OpenCode model (default: deepseek/deepseek-v4-flash)",
    "  --variant <variant>   Reasoning variant (default: high)",
    "  --dry-run             Print the opencode command and prompt without executing",
  ].join("\n")
}

export function parseArgs(argv: string[]): FinalizeDocsArgs {
  const out: FinalizeDocsArgs = {
    lanePath: null,
    result: null,
    commits: [],
    evidence: [],
    cost: null,
    message: null,
    model: "deepseek/deepseek-v4-flash",
    variant: "high",
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--result") out.result = argv[++i] ?? null
    else if (a === "--commit") out.commits.push(argv[++i] ?? "")
    else if (a === "--evidence" || a === "--ref") out.evidence.push(argv[++i] ?? "")
    else if (a === "--cost") out.cost = argv[++i] ?? null
    else if (a === "--message") out.message = argv[++i] ?? null
    else if (a === "--model") out.model = argv[++i] ?? out.model
    else if (a === "--variant") out.variant = argv[++i] ?? out.variant
    else if (a === "--dry-run") out.dryRun = true
    else if (a === "--help" || a === "-h") {
      console.log(usage())
      process.exit(0)
    } else if (!a.startsWith("--")) {
      if (!out.lanePath) out.lanePath = a
      else throw new Error(`unexpected positional argument: ${a}`)
    } else {
      throw new Error(`unknown option: ${a}`)
    }
  }
  out.commits = out.commits.map(value => value.trim()).filter(Boolean)
  out.evidence = out.evidence.map(value => value.trim()).filter(Boolean)
  if (!out.lanePath) throw new Error("finalize-docs requires a lane/session doc path")
  if (!out.result?.trim()) throw new Error("finalize-docs requires --result")
  if (!out.message?.trim()) out.message = `[docs] finalize ${laneIdFromPath(out.lanePath)} documentation`
  return out
}

export function buildPrompt(args: FinalizeDocsArgs): string {
  const lanePath = args.lanePath!
  return [
    `Finalize Novel Harness documentation for ${lanePath}.`,
    "",
    "You are authorized to update and commit docs-only changes for this finalization task.",
    "Use the repo-local docs-finalizer instructions exactly.",
    "",
    "Inputs:",
    `- Lane/session doc: ${lanePath}`,
    `- Result classification: ${args.result}`,
    `- Commit(s) to document: ${args.commits.length > 0 ? args.commits.join(", ") : "(not supplied; inspect lane/doc/git if needed)"}`,
    `- Evidence refs: ${args.evidence.length > 0 ? args.evidence.join(", ") : "(not supplied; ask/stop if required)"}`,
    `- Cost: ${args.cost ?? "(not supplied)"}`,
    `- Docs commit message: ${args.message}`,
    "",
    "Required behavior:",
    "- Read the lane/session doc and durable docs listed in .opencode/agent/docs-finalizer.md.",
    "- Update all relevant durable docs, not just the lane doc, when the result affects current state, decisions, lessons, or pending todo items.",
    "- Run `bun scripts/preflight-docs-impact.ts --strict` and `git diff --check`.",
    "- Commit only allowed documentation files. Do not include runtime code, tests, package manifests, generated artifacts, output artifacts, secrets, or unrelated dirty files.",
    "- Do not push.",
    "- Return the docs-finalizer output contract with the commit SHA.",
  ].join("\n")
}

export function buildOpencodeArgs(args: FinalizeDocsArgs): string[] {
  const out = [
    "run",
    "--agent", "docs-finalizer",
    "--model", args.model,
    "--variant", args.variant,
    "--title", `docs-finalizer ${laneIdFromPath(args.lanePath!)}`,
    buildPrompt(args),
  ]
  return out
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  const opencodeArgs = buildOpencodeArgs(args)
  if (args.dryRun) {
    console.log(`opencode ${opencodeArgs.map(value => JSON.stringify(value)).join(" ")}`)
    console.log("\n--- prompt ---\n")
    console.log(buildPrompt(args))
    return 0
  }
  const result = spawnSync("opencode", opencodeArgs, { stdio: "inherit" })
  return result.status ?? 1
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    console.error(`[finalize-docs] error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}
