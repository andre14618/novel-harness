import { test, expect } from "bun:test"
import { readdir } from "node:fs/promises"
import { resolve } from "node:path"

test("migrate() path resolves to repo-root sql/ (not src/sql/)", async () => {
  const sqlDir = resolve(import.meta.dir, "../../sql")
  const files = (await readdir(sqlDir)).filter(f => f.endsWith(".sql"))
  expect(files.length).toBeGreaterThanOrEqual(28)
  expect(files).toContain("001_initial.sql")
  expect(files).toContain("028_chapter_revisions.sql")
})
