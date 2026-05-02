/**
 * Shared Postgres connection (lazy).
 *
 * Single connection used by both the harness DB layer (data/db.ts) and the
 * orchestrator (src/orchestrator/db.ts). All tables live in one Postgres DB.
 *
 * Connection is created on first use via a Proxy, not at import time.
 * This lets modules that transitively import this file load without a DB.
 *
 * Trade-offs:
 * - `db instanceof SQL` returns false (proxy, not real instance). No code uses this.
 * - Missing DATABASE_URL errors on first query, not at startup. Mitigated by
 *   orchestrator calling migrate() immediately, and CLI commands hitting DB early.
 *
 * Connection string: DATABASE_URL env var.
 */

import { SQL } from "bun"
import { readdir } from "node:fs/promises"
import { resolve } from "node:path"

const DB_URL = process.env.DATABASE_URL ?? process.env.ORCHESTRATOR_DB_URL

let _db: SQL | null = null

function getDB(): SQL {
  if (!_db) {
    if (!DB_URL) throw new Error("DATABASE_URL not set")
    _db = new SQL(DB_URL)
  }
  return _db
}

// Detect Postgres connection-loss errors so we can transparently reconnect.
// Bun.SQL surfaces these as `code === "ERR_POSTGRES_CONNECTION_CLOSED"`; we
// also match common message variants in case future Bun versions reshape the
// error class (defensive, since this is the recovery path).
export function isConnectionClosed(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const code = (err as { code?: unknown }).code
  if (code === "ERR_POSTGRES_CONNECTION_CLOSED") return true
  const message = (err as { message?: unknown }).message
  return typeof message === "string" && /connection (closed|terminated|reset|ended)/i.test(message)
}

// Run `call` once; if it throws a connection-closed error, drop the singleton
// and retry once. Subsequent failures bubble up unchanged. We retry exactly
// once because (a) repeated immediate retries usually mean the server is
// unreachable, not just stale, and (b) callers above can implement their own
// outer retry policy if they need more.
//
// The `onReset` hook lets the test seam observe the singleton reset without
// exposing `_db`. Production callers don't need it.
export async function withReconnect<T>(
  call: () => T | Promise<T>,
  onReset?: () => void,
): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (!isConnectionClosed(err)) throw err
    _db = null
    onReset?.()
    return await call()
  }
}

const RETRY_METHODS = new Set(["unsafe", "begin", "transaction"])

// Proxy that forwards tagged template calls and property access to the lazy
// connection. Must wrap a function so the `apply` trap fires for db`...`
// syntax. The `apply` trap and `unsafe`/`begin` methods retry once on a
// closed-connection error so long-lived processes survive idle disconnects.
const db = new Proxy(function () {} as unknown as SQL, {
  apply(_target, _thisArg, args) {
    return withReconnect(() => (getDB() as any)(...args))
  },
  get(_target, prop) {
    const real = getDB()
    const val = (real as any)[prop]
    if (typeof val !== "function") return val
    if (typeof prop === "string" && RETRY_METHODS.has(prop)) {
      return (...args: unknown[]) => withReconnect(() => {
        const fresh = getDB()
        return (fresh as any)[prop](...args)
      })
    }
    return val.bind(real)
  },
})

export default db

// ── API compatibility ───────────────────────────────────────────────────
// Postgres doesn't need per-novel initialization. Kept as a no-op so callers
// don't need to change when migrating from SQLite.
export async function initDB(_novelId: string): Promise<void> {}

// ── Migration runner ────────────────────────────────────────────────────

async function ensureMigrationsTable() {
  await db`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const rows = await db`SELECT name FROM _migrations`
  return new Set(rows.map((r: any) => r.name))
}

export async function migrate() {
  await ensureMigrationsTable()
  const applied = await getAppliedMigrations()
  const sqlDir = resolve(import.meta.dir, "../../sql")

  let files: string[]
  try {
    files = (await readdir(sqlDir)).filter((f) => f.endsWith(".sql")).sort()
  } catch {
    console.log("No sql/ directory found, skipping migrations")
    return
  }

  for (const file of files) {
    if (applied.has(file)) continue
    console.log(`Applying migration: ${file}`)
    const content = await Bun.file(resolve(sqlDir, file)).text()
    await db.unsafe(content)
    await db`INSERT INTO _migrations (name) VALUES (${file})`
    console.log(`  Applied: ${file}`)
  }
}
