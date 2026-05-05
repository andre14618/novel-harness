#!/usr/bin/env bun
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

type Tier = "fast" | "db" | "replay" | "archive"

interface Args {
  tier: Tier | "all" | null
  list: boolean
}

interface TestFile {
  path: string
  tier: Tier
  reason: string
}

const FAST_CHUNK_SIZE = 40
const DB_TIMEOUT_MS = "30000"
const FAST_TIMEOUT_MS = "30000"
const REPLAY_TIMEOUT_MS = "120000"

const DB_PATTERNS: Array<[RegExp, string]> = [
  [/^src\/db\//, "db-layer test"],
  [/^src\/orchestrator\/.*routes.*\.test\.ts$/, "orchestrator route test"],
  [/^src\/harness\/canon-proposal-telemetry\.test\.ts$/, "canon proposal telemetry persistence"],
  [/^src\/harness\/planner-canon-proposals\.test\.ts$/, "planner canon proposal persistence"],
  [/^src\/canon\/substrate-equivalence\.test\.ts$/, "postgres canon substrate equivalence"],
  [/^src\/canon\/planning-snapshot\.test\.ts$/, "planning snapshot DB assertions"],
  [/^tests\/persist-phase-eval-run\.test\.ts$/, "phase eval persistence"],
  [/^scripts\/phase-eval\/promotion-check\.test\.ts$/, "promotion check persistence"],
]

const DB_CONTENT_MARKERS: Array<[RegExp, string]> = [
  [/\bdbReachable\s*\(/, "dbReachable gate"],
  [/\bPostgresCanonSubstrate\b/, "Postgres canon substrate"],
  [/from ["'].*db\/connection["']/, "direct db connection import"],
  [/from ["']\.\.?\/db["']/, "db module import"],
]

const ARCHIVE_PREFIX = "scripts/archive/"
const REPLAY_PATTERNS: Array<[RegExp, string]> = [
  [/^tests\/phase-parity\//, "phase parity replay fixture"],
]
const FAST_OVERRIDES = new Map<string, string>([
  ["src/orchestrator/planning-proposal-routes.test.ts", "fast non-DB route validation"],
])

const args = parseArgs(process.argv.slice(2))
const allFiles = await discoverTestFiles(".")
const classified = await classifyFiles(allFiles)

if (args.list) {
  printInventory(classified)
  process.exit(0)
}

const tier = args.tier ?? "fast"
if (tier === "all") {
  await runTier("fast", classified)
  await runTier("db", classified)
  await runTier("replay", classified)
  await runTier("archive", classified)
} else {
  await runTier(tier, classified)
}

function parseArgs(argv: string[]): Args {
  let tier: Args["tier"] = null
  let list = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--list") {
      list = true
    } else if (arg === "--tier") {
      const value = argv[++i]
      if (!isTierArg(value)) throw new Error(`invalid --tier ${value}`)
      tier = value
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return { tier, list }
}

function isTierArg(value: string | undefined): value is Tier | "all" {
  return value === "fast" || value === "db" || value === "replay" || value === "archive" || value === "all"
}

async function discoverTestFiles(root: string): Promise<string[]> {
  const out: string[] = []
  await walk(root, out)
  return out
    .map((path) => path.replace(/^\.\//, ""))
    .filter((path) => /(^|\/)[^/]+\.(test|spec)\.ts$/.test(path))
    .filter((path) => !path.includes("/node_modules/"))
    .sort()
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "output") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path, out)
    else out.push(path)
  }
}

async function classifyFiles(paths: string[]): Promise<TestFile[]> {
  const files: TestFile[] = []
  for (const path of paths) {
    files.push(await classifyFile(path))
  }
  return files
}

async function classifyFile(path: string): Promise<TestFile> {
  if (path.startsWith(ARCHIVE_PREFIX)) {
    return { path, tier: "archive", reason: "archived eval/history" }
  }
  for (const [pattern, reason] of REPLAY_PATTERNS) {
    if (pattern.test(path)) return { path, tier: "replay", reason }
  }
  const fastReason = FAST_OVERRIDES.get(path)
  if (fastReason) return { path, tier: "fast", reason: fastReason }
  for (const [pattern, reason] of DB_PATTERNS) {
    if (pattern.test(path)) return { path, tier: "db", reason }
  }

  const content = await readFile(path, "utf8").catch(() => "")
  for (const [marker, reason] of DB_CONTENT_MARKERS) {
    if (marker.test(content)) return { path, tier: "db", reason }
  }
  return { path, tier: "fast", reason: "pure/default test" }
}

function printInventory(files: TestFile[]): void {
  for (const tier of ["fast", "db", "replay", "archive"] as const) {
    const tierFiles = files.filter((file) => file.tier === tier)
    console.log(`\n[${tier}] ${tierFiles.length}`)
    for (const file of tierFiles) {
      console.log(`${file.path}\t${file.reason}`)
    }
  }
}

async function runTier(tier: Tier, files: TestFile[]): Promise<void> {
  const tierFiles = files.filter((file) => file.tier === tier).map((file) => file.path)
  console.log(`[test:${tier}] ${tierFiles.length} files`)
  if (tier === "db") {
    runCommand("bun", ["scripts/test/planning-proposal-db-smoke.ts"], {
      ...process.env,
      BUN_SQL_MAX: process.env.BUN_SQL_MAX ?? "1",
    })
    for (const file of tierFiles) {
      runCommand("bun", ["test", "--timeout", DB_TIMEOUT_MS, file], {
        ...process.env,
        BUN_SQL_MAX: process.env.BUN_SQL_MAX ?? "1",
      })
    }
    return
  }

  const timeout = tier === "replay" ? REPLAY_TIMEOUT_MS : FAST_TIMEOUT_MS
  for (const chunk of chunked(tierFiles, FAST_CHUNK_SIZE)) {
    runCommand("bun", ["test", "--timeout", timeout, ...chunk], process.env)
  }
}

function runCommand(command: string, cmdArgs: string[], env: Record<string, string | undefined>): void {
  console.log(`$ ${[command, ...cmdArgs].join(" ")}`)
  const result = Bun.spawnSync({
    cmd: [command, ...cmdArgs],
    stdout: "inherit",
    stderr: "inherit",
    env,
  })
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}
