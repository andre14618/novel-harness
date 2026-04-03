/**
 * One-time migration: SQLite (data/harness.db) → Postgres.
 *
 * Reads all rows from the SQLite DB and bulk-inserts into Postgres.
 * Run on LXC after deploying the new schema (sql/003_harness_tables.sql).
 *
 * Usage: DATABASE_URL=postgres://... bun scripts/migrate-sqlite-to-postgres.ts
 */

import { Database } from "bun:sqlite"
import { SQL } from "bun"

const SQLITE_PATH = process.env.SQLITE_PATH ?? "data/harness.db"
const PG_URL = process.env.DATABASE_URL ?? process.env.ORCHESTRATOR_DB_URL
if (!PG_URL) { console.error("DATABASE_URL not set"); process.exit(1) }

const sqlite = new Database(SQLITE_PATH, { readonly: true })
const pg = new SQL(PG_URL)

async function migrateTable(name: string, transform?: (row: any) => any) {
  const rows = sqlite.query(`SELECT * FROM ${name}`).all() as any[]
  if (rows.length === 0) {
    console.log(`  ${name}: 0 rows (skip)`)
    return
  }

  // Check if Postgres already has data
  const [pgCount] = await pg`SELECT count(*)::int as c FROM ${pg(name)}`
  if (pgCount.c > 0) {
    console.log(`  ${name}: ${pgCount.c} rows already in Postgres (skip)`)
    return
  }

  const transformed = transform ? rows.map(transform) : rows
  const cols = Object.keys(transformed[0])

  // Batch insert 500 at a time
  let inserted = 0
  for (let i = 0; i < transformed.length; i += 500) {
    const batch = transformed.slice(i, i + 500)
    // Use pg.unsafe for bulk insert with VALUES
    const placeholders = batch.map((_, bi) =>
      `(${cols.map((_, ci) => `$${bi * cols.length + ci + 1}`).join(",")})`
    ).join(",")
    const values = batch.flatMap(row => cols.map(c => row[c]))
    await pg.unsafe(
      `INSERT INTO ${name} (${cols.join(",")}) VALUES ${placeholders}`,
      values,
    )
    inserted += batch.length
  }

  // Reset sequence to max ID
  if (cols.includes("id")) {
    await pg.unsafe(`SELECT setval(pg_get_serial_sequence('${name}', 'id'), (SELECT COALESCE(MAX(id), 0) FROM ${name}))`)
  }

  console.log(`  ${name}: ${inserted} rows migrated`)
}

// Boolean conversion for SQLite 0/1 → Postgres boolean
function boolify(row: any, ...fields: string[]) {
  const r = { ...row }
  for (const f of fields) {
    if (r[f] !== undefined && r[f] !== null) r[f] = !!r[f]
  }
  return r
}

// JSON string → object for JSONB columns
function jsonify(row: any, ...fields: string[]) {
  const r = { ...row }
  for (const f of fields) {
    if (typeof r[f] === "string") {
      try { r[f] = JSON.parse(r[f]) } catch {}
    }
  }
  return r
}

async function main() {
  console.log(`Migrating: ${SQLITE_PATH} → Postgres`)
  console.log()

  // Order matters — FK dependencies
  await migrateTable("tuning_experiments", r => jsonify(r, "config"))
  await migrateTable("runs", r => jsonify(r, "model_config"))
  await migrateTable("run_agents")
  await migrateTable("llm_calls", r => boolify(r, "json_extraction_success", "json_extraction_retried", "zod_validation_success"))
  await migrateTable("generations", r => boolify(r, "passed"))
  await migrateTable("scores")
  await migrateTable("baselines")
  await migrateTable("lint_patterns", r => boolify(r, "dialogue_ok", "enabled"))
  await migrateTable("lint_issues")
  await migrateTable("batches")
  await migrateTable("batch_requests")
  await migrateTable("pairwise_matchups")
  await migrateTable("tuning_results", r => boolify(r, "failed"))

  console.log("\nVerifying row counts...")
  const tables = [
    "tuning_experiments", "runs", "run_agents", "llm_calls", "generations",
    "scores", "baselines", "lint_patterns", "lint_issues", "batches",
    "batch_requests", "pairwise_matchups", "tuning_results",
  ]
  let allMatch = true
  for (const t of tables) {
    const sqliteCount = (sqlite.query(`SELECT COUNT(*) as c FROM ${t}`).get() as any).c
    const [pgRow] = await pg`SELECT count(*)::int as c FROM ${pg(t)}`
    const match = sqliteCount === pgRow.c
    if (!match) allMatch = false
    console.log(`  ${t}: SQLite=${sqliteCount} Postgres=${pgRow.c} ${match ? "✓" : "✗ MISMATCH"}`)
  }

  console.log(allMatch ? "\nAll tables match." : "\nSome tables have mismatches — investigate.")

  sqlite.close()
  process.exit(allMatch ? 0 : 1)
}

main()
