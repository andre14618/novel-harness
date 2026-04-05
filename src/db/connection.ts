/**
 * Novel DB connection — delegates to the shared Postgres connection.
 *
 * Previously this module managed per-novel SQLite databases.
 * Now all novel data lives in the central Postgres DB (novel_harness_orchestrator).
 *
 * initDB() is kept for API compatibility but is a no-op — the Postgres
 * schema is managed by data/connection.ts migrations.
 */

import db from "../../data/connection"

// Re-export the shared Postgres connection as the novel DB
export { db }

/** No-op — Postgres schema is managed by data/connection.ts migrations */
export async function initDB(_novelId: string): Promise<void> {
  // Previously created a per-novel SQLite file.
  // Now all novels share the central Postgres DB.
  // Ensure the novel row exists (created by createNovel).
}
