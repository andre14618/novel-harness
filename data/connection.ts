/**
 * Shared Postgres connection.
 *
 * Single connection used by both the harness DB layer (data/db.ts) and the
 * orchestrator (src/orchestrator/db.ts). All tables live in one Postgres DB.
 *
 * Connection string: DATABASE_URL env var.
 */

import { SQL } from "bun"
import { readdir } from "node:fs/promises"
import { resolve } from "node:path"

const DB_URL = process.env.DATABASE_URL ?? process.env.ORCHESTRATOR_DB_URL
if (!DB_URL) throw new Error("DATABASE_URL not set")

const db = new SQL(DB_URL)
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
