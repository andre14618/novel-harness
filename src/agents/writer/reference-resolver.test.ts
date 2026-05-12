import { describe, expect, test } from "bun:test"

import { beatDescriptionHasImplicitReference } from "./reference-resolver"

describe("reference-resolver implicit reference detection", () => {
  test("does not flag self-contained opening-hour temporal anchors", () => {
    expect(beatDescriptionHasImplicitReference(
      "Doryn Vesh enters the Main Reading Room before dawn to complete the climate and schedule checks before the Hall opens.",
    )).toBe(false)
  })

  test("still flags real implicit prior-context markers", () => {
    expect(beatDescriptionHasImplicitReference(
      "Maren forces Halric to open the ledger because of their last encounter.",
    )).toBe(true)
    expect(beatDescriptionHasImplicitReference(
      "Maren enters after the council vote and demands the ledger.",
    )).toBe(true)
  })
})
