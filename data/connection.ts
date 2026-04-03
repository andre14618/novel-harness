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

// Proxy that forwards tagged template calls and property access to the lazy connection.
// Must wrap a function so the `apply` trap fires for db`...` syntax.
const db = new Proxy(function () {} as unknown as SQL, {
  apply(_target, _thisArg, args) {
    return (getDB() as any)(...args)
  },
  get(_target, prop) {
    const real = getDB()
    const val = (real as any)[prop]
    return typeof val === "function" ? val.bind(real) : val
  },
})

export default db

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
  const sqlDir = resolve(import.meta.dir, "../sql")

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
