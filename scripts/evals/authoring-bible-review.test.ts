import { describe, expect, test } from "bun:test"

import { normalizeAuthoringBibleReviewEvidencePayload } from "./authoring-bible-review"

describe("authoring-bible-review evidence normalization", () => {
  test("keeps object evidence unchanged", () => {
    expect(normalizeAuthoringBibleReviewEvidencePayload({
      proseMoment: "Kael prices the risk.",
      satisfaction: "The rule is visible.",
    })).toEqual({
      proseMoment: "Kael prices the risk.",
      satisfaction: "The rule is visible.",
    })
  })

  test("accepts common DeepSeek evidence strings and arrays", () => {
    expect(normalizeAuthoringBibleReviewEvidencePayload("direct evidence")).toEqual({
      satisfaction: "direct evidence",
    })
    expect(normalizeAuthoringBibleReviewEvidencePayload(["one", "two"])).toEqual({
      satisfaction: "one; two",
    })
  })
})
