import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  evaluateRoleContextPolicyFixture,
  loadRoleContextPolicyFixture,
  renderRoleContextPolicyEvidence,
} from "./role-context-policy"

const FIXTURE = join(
  import.meta.dir,
  "..",
  "..",
  "tests",
  "role-context-policy-fixtures",
  "reference-hidden-basic.json",
)

describe("role-context-policy eval fixture", () => {
  test("role-aware writer keeps reference facts and omits hidden facts", async () => {
    const evidence = await evaluateRoleContextPolicyFixture(await loadRoleContextPolicyFixture(FIXTURE))

    expect(evidence.passed).toBe(true)
    expect(evidence.writer.legacyPrompt).toContain("Maret is secretly the missing heir to the red ledger.")
    expect(evidence.writer.roleAwarePrompt).toContain("The city still uses the old festival calendar in private ledgers.")
    expect(evidence.writer.roleAwarePrompt).not.toContain("Maret is secretly the missing heir to the red ledger.")
  })

  test("role-aware continuity fixture enforces only operational facts", async () => {
    const evidence = await evaluateRoleContextPolicyFixture(await loadRoleContextPolicyFixture(FIXTURE))

    expect(evidence.continuity.legacyFactIds).toEqual([
      "fact-public-oath",
      "fact-old-calendar",
      "fact-hidden-heir",
    ])
    expect(evidence.continuity.roleAwareFactIds).toEqual(["fact-public-oath"])
  })

  test("renderer produces a concise pass/fail evidence table", async () => {
    const evidence = await evaluateRoleContextPolicyFixture(await loadRoleContextPolicyFixture(FIXTURE))
    const rendered = renderRoleContextPolicyEvidence(evidence)

    expect(rendered).toContain("# Role Context Policy Fixture: reference-hidden-basic")
    expect(rendered).toContain("Result: PASS")
    expect(rendered).toContain("role-aware writer omits")
    expect(rendered).toContain("role-aware continuity ids = fact-public-oath")
  })
})
