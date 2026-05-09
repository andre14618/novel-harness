import { describe, expect, test } from "bun:test"

import { corpusRecreationVariantLabel } from "./corpus-recreation-variant"

describe("corpus-recreation-variant", () => {
  test("keeps baseline writer context out of the visible label", () => {
    expect(corpusRecreationVariantLabel({ plannerVariant: "materiality-v1", writerContextMode: "baseline" })).toBe("materiality-v1")
    expect(corpusRecreationVariantLabel({ plannerVariant: "materiality-v1" })).toBe("materiality-v1")
  })

  test("adds non-baseline writer context to the visible label", () => {
    expect(corpusRecreationVariantLabel({ plannerVariant: "baseline", writerContextMode: "thread-context-v1" }))
      .toBe("baseline + thread-context-v1")
  })

  test("adds non-default writer expansion to the visible label", () => {
    expect(corpusRecreationVariantLabel({
      plannerVariant: "causal-materiality-v2",
      writerContextMode: "baseline",
      writerExpansionMode: "retry-short-scenes-v1",
    })).toBe("causal-materiality-v2 + retry-short-scenes-v1")
  })

  test("adds non-default planner contract retry to the visible label", () => {
    expect(corpusRecreationVariantLabel({
      plannerVariant: "causal-materiality-v2",
      plannerContractRetryMode: "structural-v1",
      writerContextMode: "baseline",
      writerExpansionMode: "none",
    })).toBe("causal-materiality-v2 + planner-contract-structural-v1")
  })
})
