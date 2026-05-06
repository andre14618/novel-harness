import type { FactRole } from "../types"

export const FACT_ROLES = ["operational", "reference", "hidden"] as const satisfies readonly FactRole[]

export type FactRoleSurface = "legacy" | "writer" | "continuity-blocking"

export const FACT_ROLES_BY_SURFACE: Record<FactRoleSurface, readonly FactRole[]> = {
  legacy: FACT_ROLES,
  writer: ["operational", "reference"],
  "continuity-blocking": ["operational"],
}

export interface FactRoleTagged {
  role?: FactRole | string | null
}

export interface FactRolePartition<T> {
  operational: T[]
  reference: T[]
  hidden: T[]
}

export function normalizeFactRole(value: unknown): FactRole {
  if (value === "operational" || value === "reference" || value === "hidden") return value
  return "operational"
}

export function factRoleOf(fact: FactRoleTagged): FactRole {
  return normalizeFactRole(fact.role)
}

export function filterFactsByRole<T extends FactRoleTagged>(
  facts: readonly T[],
  allowedRoles: Iterable<FactRole>,
): T[] {
  const allowed = new Set(allowedRoles)
  return facts.filter((fact) => allowed.has(factRoleOf(fact)))
}

export function selectFactsForSurface<T extends FactRoleTagged>(
  facts: readonly T[],
  surface: FactRoleSurface = "legacy",
): T[] {
  return filterFactsByRole(facts, FACT_ROLES_BY_SURFACE[surface])
}

export function partitionFactsByRole<T extends FactRoleTagged>(
  facts: readonly T[],
): FactRolePartition<T> {
  const partition: FactRolePartition<T> = {
    operational: [],
    reference: [],
    hidden: [],
  }

  for (const fact of facts) {
    partition[factRoleOf(fact)].push(fact)
  }

  return partition
}

export function isWriterVisibleFact(fact: FactRoleTagged): boolean {
  return FACT_ROLES_BY_SURFACE.writer.includes(factRoleOf(fact))
}

export function isContinuityBlockingFact(fact: FactRoleTagged): boolean {
  return FACT_ROLES_BY_SURFACE["continuity-blocking"].includes(factRoleOf(fact))
}

export function isReferenceFact(fact: FactRoleTagged): boolean {
  return factRoleOf(fact) === "reference"
}

export function isHiddenFact(fact: FactRoleTagged): boolean {
  return factRoleOf(fact) === "hidden"
}
