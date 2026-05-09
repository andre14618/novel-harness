import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

describe("semantic proof boundary", () => {
  test("scene-recreation contract diagnostics do not infer pressure from text overlap", () => {
    const source = read("scripts/evals/corpus-recreation-poc.ts")

    expect(source).toContain("knownPressureSourceIds")
    expect(source).toContain("sourceId exactly matches")
    expect(source).not.toContain("seedPressureTerms")
    expect(source).not.toContain("characterSpecificTerms")
    expect(source).not.toContain("keywordTerms")
    expect(source).not.toContain("CONTRACT_STOPWORDS")
  })

  test("scene semantic-review applicability is exact-ID only", () => {
    const source = read("scripts/evals/corpus-recreation-semantic-review.ts")

    expect(source).toContain("sourceIds.has(fact.worldFactId)")
    expect(source).toContain("sourceIds.has(character.characterId)")
    expect(source).not.toContain("keywordTerms")
    expect(source).not.toContain("STOPWORDS")
    expect(source).not.toContain("normalizeSearchText")
  })

  test("planner-discernment semantic dimensions are not skipped by keyword pressure regexes", () => {
    const source = read("scripts/evals/planner-discernment-real-data.ts")

    expect(source).not.toContain("RELATIONSHIP_PRESSURE_PATTERN")
    expect(source).not.toContain("relationship-pressure signal")
  })

  test("deterministic method-pack lift points to semantic review, not production promotion", () => {
    const diagnostic = read("scripts/evals/method-pack-planner-diagnostic.ts")
    const cohort = read("scripts/evals/method-pack-planner-cohort.ts")

    expect(diagnostic).toContain("semantic review")
    expect(cohort).toContain("semantic review")
    expect(diagnostic).toContain("diagnostic lift")
  })
})

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8")
}
