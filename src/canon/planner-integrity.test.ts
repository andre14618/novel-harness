import { describe, expect, test } from "bun:test"
import {
  canonReferenceItems,
  plannedOriginProxyItems,
  runPlannerIntegrity,
  type PlannerIntegrityItem,
} from "./planner-integrity"
import type { CanonFixture } from "./recall-validation"

const CANON: CanonFixture = {
  novelId: "test",
  snapshotVersion: "v1",
  facts: [
    {
      id: "fact-planned",
      kind: "established_fact",
      text: "Planned fact.",
      provenance: provenance(1, "planned"),
    },
    {
      id: "fact-observed",
      kind: "established_fact",
      text: "Observed fact.",
      provenance: provenance(1, "observed"),
    },
    {
      id: "knowledge-observed",
      kind: "knowledge_change",
      text: "A character learns something.",
      data: { characterId: "hero" },
      provenance: provenance(2, "observed"),
    },
    {
      id: "state-observed",
      kind: "character_state",
      text: "Hero is wounded.",
      data: { characterId: "hero" },
      provenance: provenance(3, "observed"),
    },
    {
      id: "promise-planned",
      kind: "promise",
      text: "A promise is opened.",
      provenance: provenance(3, "planned"),
    },
  ],
  entities: [],
  characterStates: [],
  promises: [
    {
      id: "story-promise",
      setupChapter: 2,
      expectedPayoffChapter: 5,
      status: "open",
      promiseFactId: "promise-planned",
      provenance: provenance(2, "planned"),
    },
  ],
}

function provenance(chapter: number, origin: "planned" | "observed") {
  return {
    source: "post-draft-extraction" as const,
    chapter,
    extractorVersion: "test-v1",
    approvalStatus: "human-approved" as const,
    origin,
    createdAt: "2026-05-03T00:00:00Z",
    updatedAt: "2026-05-03T00:00:00Z",
  }
}

describe("planner integrity fixture builders", () => {
  test("canonReferenceItems builds complete reference items from fact kinds and promises", () => {
    const items = canonReferenceItems(CANON)
    expect(items.map((i) => i.id)).toEqual([
      "fact:fact-observed",
      "fact:fact-planned",
      "fact:knowledge-observed",
      "promise:story-promise",
      "fact:state-observed",
      "fact:promise-planned",
    ])
    expect(items.map((i) => i.category)).toEqual([
      "established_fact",
      "established_fact",
      "knowledge_change",
      "story_promise",
      "character_state",
      "promise",
    ])
  })

  test("plannedOriginProxyItems selects planned-origin facts and structured promises", () => {
    const items = plannedOriginProxyItems(CANON)
    expect(items.map((i) => i.id)).toEqual([
      "fact:fact-planned",
      "promise:story-promise",
      "fact:promise-planned",
    ])
  })

  test("chapter filter applies to both reference and planned proxy builders", () => {
    expect(canonReferenceItems(CANON, { chapters: [1] }).map((i) => i.id)).toEqual([
      "fact:fact-observed",
      "fact:fact-planned",
    ])
    expect(plannedOriginProxyItems(CANON, { chapters: [1] }).map((i) => i.id)).toEqual([
      "fact:fact-planned",
    ])
  })
})

describe("runPlannerIntegrity", () => {
  test("computes TP/FP/FN precision recall and F1", () => {
    const emitted: PlannerIntegrityItem[] = [
      item("fact:a", "established_fact", 1),
      item("fact:b", "established_fact", 1),
      item("fact:extra", "established_fact", 1),
    ]
    const reference: PlannerIntegrityItem[] = [
      item("fact:a", "established_fact", 1),
      item("fact:b", "established_fact", 1),
      item("fact:missing", "established_fact", 2),
    ]
    const report = runPlannerIntegrity({ sourceName: "test", emitted, reference })
    expect(report.overall.truePositives.map((i) => i.id)).toEqual(["fact:a", "fact:b"])
    expect(report.overall.falsePositives.map((i) => i.id)).toEqual(["fact:extra"])
    expect(report.overall.falseNegatives.map((i) => i.id)).toEqual(["fact:missing"])
    expect(report.overall.precision).toBeCloseTo(2 / 3)
    expect(report.overall.recall).toBeCloseTo(2 / 3)
    expect(report.overall.f1).toBeCloseTo(2 / 3)
  })

  test("returns insufficient-sample when Step 2 sample floor is not met", () => {
    const report = runPlannerIntegrity({
      sourceName: "small",
      emitted: [item("fact:a", "established_fact", 1)],
      reference: [item("fact:a", "established_fact", 1)],
    })
    expect(report.thresholds.sampleGateClear).toBe(false)
    expect(report.thresholds.recommendation).toBe("insufficient-sample")
  })

  test("returns direct-canon-writes-ok only when all Step 2 gates clear", () => {
    const emitted: PlannerIntegrityItem[] = []
    const reference: PlannerIntegrityItem[] = []
    for (let i = 0; i < 36; i++) {
      const chapterN = (i % 3) + 1
      const category = i % 2 === 0 ? "established_fact" : "knowledge_change"
      const it = item(`fact:${i}`, category, chapterN)
      emitted.push(it)
      reference.push(it)
    }
    const report = runPlannerIntegrity({ sourceName: "passing", emitted, reference })
    expect(report.thresholds.sampleGateClear).toBe(true)
    expect(report.thresholds.allGatesClear).toBe(true)
    expect(report.thresholds.recommendation).toBe("direct-canon-writes-ok")
  })

  test("does not promote planned-origin proxy evidence to direct writes", () => {
    const emitted: PlannerIntegrityItem[] = []
    const reference: PlannerIntegrityItem[] = []
    for (let i = 0; i < 36; i++) {
      const chapterN = (i % 3) + 1
      const it = item(`fact:${i}`, "established_fact", chapterN)
      emitted.push(it)
      reference.push(it)
    }
    const report = runPlannerIntegrity({
      sourceName: "proxy",
      evidenceKind: "planned-origin-proxy",
      emitted,
      reference,
    })
    expect(report.thresholds.sampleGateClear).toBe(true)
    expect(report.thresholds.precisionGateClear).toBe(true)
    expect(report.thresholds.recallGateClear).toBe(true)
    expect(report.thresholds.f1GateClear).toBe(true)
    expect(report.thresholds.sourceEvidenceGateClear).toBe(false)
    expect(report.thresholds.allGatesClear).toBe(false)
    expect(report.thresholds.recommendation).toBe("insufficient-sample")
  })

  test("returns human-review-required when sample clears but quality gates miss", () => {
    const emitted: PlannerIntegrityItem[] = []
    const reference: PlannerIntegrityItem[] = []
    for (let i = 0; i < 36; i++) {
      const chapterN = (i % 3) + 1
      reference.push(item(`fact:ref-${i}`, "established_fact", chapterN))
      if (i < 10) emitted.push(item(`fact:ref-${i}`, "established_fact", chapterN))
    }
    const report = runPlannerIntegrity({ sourceName: "low-recall", emitted, reference })
    expect(report.thresholds.sampleGateClear).toBe(true)
    expect(report.thresholds.recallGateClear).toBe(false)
    expect(report.thresholds.recommendation).toBe("human-review-required")
  })
})

function item(
  id: string,
  category: PlannerIntegrityItem["category"],
  chapterN: number,
): PlannerIntegrityItem {
  return { id, category, chapterN, text: id, source: "test" }
}
