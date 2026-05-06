import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = readFileSync(join(import.meta.dir, "clone-for-variant.ts"), "utf8")

test("drafting variant clone preserves fact roles for role-aware context A/B runs", () => {
  expect(SOURCE).toContain(
    "INSERT INTO facts (novel_id, fact, category, established_in_chapter, role, created_at)",
  )
  expect(SOURCE).toContain(
    "SELECT ${target}, fact, category, established_in_chapter, role, created_at",
  )
})

test("drafting variant clone carries concept-side state needed by resume rehydration", () => {
  expect(SOURCE).toContain('"story_spines"')
  expect(SOURCE).toContain("INSERT INTO story_spines (novel_id, content_json)")
  expect(SOURCE).toContain('"world_systems"')
  expect(SOURCE).toContain('"retrieval_config"')
})

test("variant clone can set factRoleContextPolicy on target seed pipelineOverrides", () => {
  expect(SOURCE).toContain("--fact-role-context-policy")
  expect(SOURCE).toContain("'{pipelineOverrides,factRoleContextPolicy}'")
  expect(SOURCE).toContain("to_jsonb(${factRoleContextPolicy}::text)")
})
