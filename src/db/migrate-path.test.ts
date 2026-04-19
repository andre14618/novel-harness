import { test, expect } from "bun:test"
import { readdir } from "node:fs/promises"
import { resolve } from "node:path"

test("migrate() path resolves to repo-root sql/ (not src/sql/)", async () => {
  const sqlDir = resolve(import.meta.dir, "../../sql")
  const files = (await readdir(sqlDir)).filter(f => f.endsWith(".sql"))
  // Lower bound grows as migrations land; bump with each new sql file
  // so CI catches ordering/naming regressions (Codex review
  // aab899143d8326c77 Q9).
  expect(files.length).toBeGreaterThanOrEqual(31)
  expect(files).toContain("001_initial.sql")
  expect(files).toContain("028_chapter_revisions.sql")
  expect(files).toContain("029_plan_check_overridden.sql")
  expect(files).toContain("030_chapter_exhaustions.sql")
  expect(files).toContain("031_chapter_outlines_revision_used.sql")

  // migrate() applies files in lexical sort order. All files must follow
  // the `NNN_description.sql` convention so their lexical order matches
  // their semantic order. Assert via sorted numeric-prefix array: strictly
  // increasing, unique. If someone adds `031a_foo.sql` or a non-prefixed
  // file, this catches it.
  const sorted = [...files].sort()
  const prefixes = sorted.map(f => {
    const m = f.match(/^(\d{3})_/)
    if (!m) throw new Error(`Migration file does not follow NNN_ convention: ${f}`)
    return parseInt(m[1], 10)
  })
  for (let i = 1; i < prefixes.length; i++) {
    expect(prefixes[i]).toBeGreaterThan(prefixes[i - 1])
  }
})
