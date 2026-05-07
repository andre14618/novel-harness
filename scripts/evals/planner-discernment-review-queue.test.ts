import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { buildReviewQueue, renderReviewQueue } from "./planner-discernment-review-queue"

describe("planner-discernment-review-queue", () => {
  test("extracts selected labels into operator-review rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "planner-discernment-review-queue-"))
    const reportPath = join(dir, "planner-discernment-real-data-report.json")
    writeFileSync(reportPath, JSON.stringify(report(), null, 2))

    const queue = buildReviewQueue({
      reports: [reportPath],
      labels: ["REL-1", "WFACT-1"],
      outputDir: null,
      limit: null,
      json: false,
    }, "2026-05-07T00:00:00.000Z")

    expect(queue.rowCount).toBe(2)
    expect(queue.rows.map(row => row.label).sort()).toEqual(["REL-1", "WFACT-1"])
    expect(queue.rows[0]!.operatorQuestion).toContain("relationship")

    const rendered = renderReviewQueue(queue)
    expect(rendered).toContain("Operator disposition")
    expect(rendered).toContain("Planner contract implication")
    expect(rendered).toContain("Scene excerpt")
  })
})

function report() {
  return {
    promptMode: "evidence-first",
    results: [
      result("relationshipDelta", "REL-1"),
      result("worldFactPressure", "WFACT-1"),
      result("motivationSpecificity", "MOTIVE-3"),
    ],
  }
}

function result(dimension: string, label: string) {
  return {
    dimension,
    label,
    armId: "test:method",
    methodPackEnabled: true,
    fixtureId: "fixture",
    chapterId: "ch-001",
    sceneId: "scn-001-01",
    text: "Scene excerpt text",
    output: {
      evidence: { excerpt: "Scene excerpt evidence" },
      missingForNextLevel: "missing stronger movement",
    },
  }
}
