import { describe, expect, test } from "bun:test"

import {
  factRoleOf,
  filterFactsByRole,
  isContinuityBlockingFact,
  isHiddenFact,
  isReferenceFact,
  isWriterVisibleFact,
  normalizeFactRole,
  partitionFactsByRole,
  selectFactsForSurface,
} from "./fact-roles"
import type { FactRole } from "../types"

interface TestFact {
  id: string
  role?: FactRole | string | null
}

const facts: TestFact[] = [
  { id: "operational", role: "operational" },
  { id: "reference", role: "reference" },
  { id: "hidden", role: "hidden" },
  { id: "missing" },
  { id: "unknown", role: "archival" },
]

describe("fact role helpers", () => {
  test("normalizes missing and unknown roles to operational", () => {
    expect(normalizeFactRole("operational")).toBe("operational")
    expect(normalizeFactRole("reference")).toBe("reference")
    expect(normalizeFactRole("hidden")).toBe("hidden")
    expect(normalizeFactRole(undefined)).toBe("operational")
    expect(normalizeFactRole(null)).toBe("operational")
    expect(normalizeFactRole("archival")).toBe("operational")
    expect(factRoleOf({})).toBe("operational")
  })

  test("legacy surface preserves all currently loaded facts", () => {
    const selected = selectFactsForSurface(facts)

    expect(selected.map((fact) => fact.id)).toEqual([
      "operational",
      "reference",
      "hidden",
      "missing",
      "unknown",
    ])
    expect(selected[0]).toBe(facts[0])
  })

  test("writer surface includes operational and reference facts but excludes hidden", () => {
    const selected = selectFactsForSurface(facts, "writer")

    expect(selected.map((fact) => fact.id)).toEqual([
      "operational",
      "reference",
      "missing",
      "unknown",
    ])
    expect(selected.every(isWriterVisibleFact)).toBe(true)
    expect(isWriterVisibleFact({ role: "hidden" })).toBe(false)
  })

  test("continuity-blocking surface includes only operational facts", () => {
    const selected = selectFactsForSurface(facts, "continuity-blocking")

    expect(selected.map((fact) => fact.id)).toEqual([
      "operational",
      "missing",
      "unknown",
    ])
    expect(selected.every(isContinuityBlockingFact)).toBe(true)
    expect(isContinuityBlockingFact({ role: "reference" })).toBe(false)
    expect(isContinuityBlockingFact({ role: "hidden" })).toBe(false)
  })

  test("filters arbitrary allowed role sets without mutating order", () => {
    const before = facts.map((fact) => ({ ...fact }))
    const selected = filterFactsByRole(facts, ["reference"])

    expect(selected.map((fact) => fact.id)).toEqual(["reference"])
    expect(facts).toEqual(before)
  })

  test("partitions by normalized role", () => {
    const partition = partitionFactsByRole(facts)

    expect(partition.operational.map((fact) => fact.id)).toEqual([
      "operational",
      "missing",
      "unknown",
    ])
    expect(partition.reference.map((fact) => fact.id)).toEqual(["reference"])
    expect(partition.hidden.map((fact) => fact.id)).toEqual(["hidden"])
    expect(isReferenceFact(partition.reference[0])).toBe(true)
    expect(isHiddenFact(partition.hidden[0])).toBe(true)
  })
})
