import { describe, expect, test } from "bun:test"
import {
  aggregatePlannerSemanticPanel,
  type PlannerSemanticPanelCall,
} from "./planner-semantic-labeling"

describe("aggregatePlannerSemanticPanel", () => {
  test("accepts direct-write candidates only on cross-route agreement", () => {
    const calls: PlannerSemanticPanelCall[] = [
      itemCall("flash", 1, "item-a", "correct", "direct_write", 0.92),
      itemCall("flash", 2, "item-a", "correct", "direct_write", 0.9),
      itemCall("pro", 1, "item-a", "correct", "direct_write", 0.95),
      itemCall("flash", 1, "item-b", "correct", "direct_write", 0.86),
      itemCall("pro", 1, "item-b", "partial", "human_review", 0.74),
    ]

    const report = aggregatePlannerSemanticPanel(calls)

    expect(report.summary.itemCount).toBe(2)
    expect(report.summary.directWriteCandidates).toBe(1)
    expect(report.summary.humanReviewCandidates).toBe(0)
    expect(report.summary.needsHumanItems).toBe(1)
    expect(report.summary.crossRouteSafetyAgreementRate).toBe(0.5)
    expect(report.items.find((item) => item.itemId === "item-a")?.needsHuman).toBe(false)
    expect(report.items.find((item) => item.itemId === "item-b")?.needsHuman).toBe(true)
  })

  test("clusters missing candidates and requires cross-route support", () => {
    const calls: PlannerSemanticPanelCall[] = [
      {
        task: "missing",
        route: "flash",
        sampleIndex: 1,
        chapterN: 1,
        ok: true,
        result: {
          chapterN: 1,
          missingItems: [
            missingItem("fact", "Maret requests Theo as a witness."),
            missingItem("state", "Theo is worried about Maret."),
          ],
        },
      },
      {
        task: "missing",
        route: "pro",
        sampleIndex: 1,
        chapterN: 1,
        ok: true,
        result: {
          chapterN: 1,
          missingItems: [missingItem("fact", "Maret requests Theo as witness")],
        },
      },
    ]

    const report = aggregatePlannerSemanticPanel(calls)

    expect(report.summary.missingCandidateCount).toBe(2)
    const supported = report.missing.find((item) => item.kind === "fact")
    expect(supported?.supportCount).toBe(2)
    expect(supported?.needsHuman).toBe(false)
    const flashOnly = report.missing.find((item) => item.kind === "state")
    expect(flashOnly?.needsHuman).toBe(true)
  })

  test("does not cluster semantic paraphrases deterministically", () => {
    const calls: PlannerSemanticPanelCall[] = [
      {
        task: "missing",
        route: "flash",
        sampleIndex: 1,
        chapterN: 1,
        ok: true,
        result: {
          chapterN: 1,
          missingItems: [
            missingItem("fact", "Maret's hand heals almost instantly after being injured by crushing the steel inkwell."),
            missingItem("fact", "Maret's hand rapidly heals after she crushes a steel inkwell."),
          ],
        },
      },
      {
        task: "missing",
        route: "pro",
        sampleIndex: 1,
        chapterN: 1,
        ok: true,
        result: {
          chapterN: 1,
          missingItems: [missingItem("fact", "Maret hand rapidly heals after crushing steel inkwell")],
        },
      },
    ]

    const report = aggregatePlannerSemanticPanel(calls)

    expect(report.summary.missingCandidateCount).toBe(3)
    expect(report.missing.every((item) => item.supportCount === 1)).toBe(true)
    expect(report.missing.every((item) => item.needsHuman)).toBe(true)
  })
})

function itemCall(
  route: "flash" | "pro",
  sampleIndex: number,
  itemId: string,
  planVerdict: "correct" | "incorrect" | "partial" | "unsupported" | "needs_human",
  canonSafety: "direct_write" | "human_review" | "reject",
  confidence: number,
): PlannerSemanticPanelCall {
  return {
    task: "item",
    route,
    sampleIndex,
    itemId,
    itemKind: "fact",
    chapterN: 1,
    ok: true,
    label: {
      itemId,
      itemKind: "fact",
      chapterN: 1,
      planVerdict,
      canonSafety,
      confidence,
      evidence: [],
      reason: "test",
      caveats: [],
    },
  }
}

function missingItem(kind: "fact" | "knowledge" | "state", text: string) {
  return {
    kind,
    chapterN: 1,
    proposedId: "",
    text,
    characterName: "",
    whyPlannerEligible: "test",
    confidence: 0.8,
    evidence: [],
  }
}
