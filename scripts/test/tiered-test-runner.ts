#!/usr/bin/env bun
import { SQL } from "bun"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

export type Tier = "fast" | "db" | "db-full" | "replay" | "archive"

interface Args {
  tier: Tier | "all" | null
  list: boolean
}

export interface TestFile {
  path: string
  tier: Tier
  reason: string
}

export interface TestCommand {
  cmd: string[]
  reason: string
}

const FAST_CHUNK_SIZE = 40
const DB_TIMEOUT_MS = "30000"
const FAST_TIMEOUT_MS = "30000"
const REPLAY_TIMEOUT_MS = "120000"
const DB_HEALTH_TIMEOUT_MS = 2_000

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

const DB_SMOKE_COMMANDS: TestCommand[] = [
  {
    cmd: ["bun", "scripts/test/planning-proposal-db-smoke.ts"],
    reason: "planning proposal create/resolve/apply lineage smoke",
  },
  {
    cmd: ["bun", "test", "--timeout", DB_TIMEOUT_MS, "src/db/proposal-envelopes.test.ts"],
    reason: "proposal envelope persistence smoke",
  },
  {
    cmd: ["bun", "test", "--timeout", DB_TIMEOUT_MS, "src/db/planning-mutation-lineage.test.ts"],
    reason: "planning mutation lineage persistence smoke",
  },
  {
    cmd: [
      "bun",
      "test",
      "--timeout",
      DB_TIMEOUT_MS,
      "--test-name-pattern",
      "approved characterUpdate applies patch|stale precondition|concurrent same-envelope resolves",
      "src/orchestrator/proposal-envelope-routes.test.ts",
    ],
    reason: "artifact patch proposal route transaction smoke",
  },
  {
    cmd: [
      "bun",
      "test",
      "--timeout",
      DB_TIMEOUT_MS,
      "--test-name-pattern",
      "approved span edit: live hash matches|approved span edit: stale precondition|rejected: persists status",
      "src/orchestrator/prose-edit-routes.test.ts",
    ],
    reason: "prose edit proposal route transaction smoke",
  },
  {
    cmd: [
      "bun",
      "test",
      "--timeout",
      DB_TIMEOUT_MS,
      "--test-name-pattern",
      "returns 30 pending|approves multiple in one request|POST resolve approve",
      "src/orchestrator/canon-proposal-routes.test.ts",
    ],
    reason: "canon proposal route transaction smoke",
  },
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

const FAST_ISOLATED_FILES = new Map<string, string>([
  [
    "src/phases/drafting-reviser-escalation.test.ts",
    "process-global bun:test mocks for phase dependencies",
  ],
  [
    "src/phases/drafting-revision-used-persistence.test.ts",
    "process-global bun:test mocks for phase dependencies",
  ],
])

if (import.meta.main) {
  await main(process.argv.slice(2))
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  const allFiles = await discoverTestFiles(".")
  const classified = await classifyFiles(allFiles)

  if (args.list) {
    printInventory(classified)
    process.exit(0)
  }

  const tier = args.tier ?? "fast"
  if (tier === "all") {
    await runTier("fast", classified)
    await runTier("db-full", classified)
    await runTier("replay", classified)
    await runTier("archive", classified)
  } else {
    await runTier(tier, classified)
  }
}

export function parseArgs(argv: string[]): Args {
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
  return value === "fast" || value === "db" || value === "db-full" || value === "replay" || value === "archive" || value === "all"
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

export async function classifyFile(path: string): Promise<TestFile> {
  if (path.startsWith(ARCHIVE_PREFIX)) {
    return { path, tier: "archive", reason: "archived eval/history" }
  }
  for (const [pattern, reason] of REPLAY_PATTERNS) {
    if (pattern.test(path)) return { path, tier: "replay", reason }
  }
  const fastReason = FAST_OVERRIDES.get(path)
  if (fastReason) return { path, tier: "fast", reason: fastReason }
  for (const [pattern, reason] of DB_PATTERNS) {
    if (pattern.test(path)) return { path, tier: "db-full", reason }
  }

  const content = await readFile(path, "utf8").catch(() => "")
  for (const [marker, reason] of DB_CONTENT_MARKERS) {
    if (marker.test(content)) return { path, tier: "db-full", reason }
  }
  return { path, tier: "fast", reason: "pure/default test" }
}

function printInventory(files: TestFile[]): void {
  console.log("\n[db] smoke")
  for (const command of DB_SMOKE_COMMANDS) {
    console.log(`${command.cmd.join(" ")}\t${command.reason}`)
  }

  for (const tier of ["fast", "db-full", "replay", "archive"] as const) {
    const tierFiles = files.filter((file) => file.tier === tier)
    console.log(`\n[${tier}] ${tierFiles.length}`)
    for (const file of tierFiles) {
      console.log(`${file.path}\t${file.reason}`)
    }
  }
}

async function runTier(tier: Tier, files: TestFile[]): Promise<void> {
  const tierFiles = files.filter((file) => file.tier === tier).map((file) => file.path)
  if (tier === "db") {
    console.log(`[test:db] ${DB_SMOKE_COMMANDS.length} smoke commands`)
    await assertDbReachable()
    for (const command of DB_SMOKE_COMMANDS) {
      runCommand(command.cmd[0], command.cmd.slice(1), {
        ...process.env,
        BUN_SQL_MAX: process.env.BUN_SQL_MAX ?? "1",
      })
    }
    return
  }

  console.log(`[test:${tier}] ${tierFiles.length} files`)
  if (tier === "db-full") {
    await assertDbReachable()
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

  for (const command of planFileTestCommands(tier, tierFiles)) {
    runCommand(command.cmd[0], command.cmd.slice(1), process.env)
  }
}

async function assertDbReachable(): Promise<void> {
  const rawUrl = process.env.DATABASE_URL ?? process.env.ORCHESTRATOR_DB_URL
  if (!rawUrl) {
    console.error("[test:db] DATABASE_URL or ORCHESTRATOR_DB_URL is not set")
    process.exit(1)
  }

  const sql = new SQL(rawUrl, { max: 1 })
  try {
    await Promise.race([
      sql`SELECT 1`,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DB health check timeout")), DB_HEALTH_TIMEOUT_MS)),
    ])
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[test:db] Postgres unreachable at ${describeDbUrl(rawUrl)}: ${detail}`)
    console.error("[test:db] Check the local Postgres listener or SSH tunnel before running DB tiers.")
    process.exit(1)
  } finally {
    await sql.close().catch(() => {})
  }
}

function describeDbUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    const port = url.port ? `:${url.port}` : ""
    const database = url.pathname && url.pathname !== "/" ? url.pathname : ""
    return `${url.hostname}${port}${database}`
  } catch {
    return "configured database URL"
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

export function planFileTestCommands(tier: Tier, tierFiles: string[]): TestCommand[] {
  const timeout = tier === "replay" ? REPLAY_TIMEOUT_MS : FAST_TIMEOUT_MS
  if (tier !== "fast") {
    return chunked(tierFiles, FAST_CHUNK_SIZE).map((chunk) => ({
      cmd: ["bun", "test", "--timeout", timeout, ...chunk],
      reason: `${tier} chunk`,
    }))
  }

  const regularFiles: string[] = []
  const isolatedFiles: string[] = []
  for (const file of tierFiles) {
    if (FAST_ISOLATED_FILES.has(file)) isolatedFiles.push(file)
    else regularFiles.push(file)
  }

  return [
    ...chunked(regularFiles, FAST_CHUNK_SIZE).map((chunk) => ({
      cmd: ["bun", "test", "--timeout", timeout, ...chunk],
      reason: "fast chunk",
    })),
    ...isolatedFiles.map((file) => ({
      cmd: ["bun", "test", "--timeout", timeout, file],
      reason: FAST_ISOLATED_FILES.get(file) ?? "isolated fast test",
    })),
  ]
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}
