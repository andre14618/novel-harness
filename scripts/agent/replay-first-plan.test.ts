import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildPlan,
  main,
  parseArgs,
  renderPlan,
  summarizePanel,
} from "./replay-first-plan"

const HALLUC_PANEL = "scripts/hallucination/expanded-fail-classes-panel.jsonl"
const ADHERENCE_PANEL =
  "scripts/hallucination/synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl"

function defaults() {
  return {
    paths: [] as string[],
    label: null as string | null,
    expId: null as number | null,
    note: null as string | null,
    costPerCall: 0,
    json: false,
  }
}

describe("replay-first-plan parseArgs", () => {
  test("collects positional panel paths and option values", () => {
    const args = parseArgs([
      "panel-a.jsonl",
      "panel-b.jsonl",
      "--label",
      "candidate:v1",
      "--exp-id",
      "382",
      "--note",
      "dry-run",
      "--cost-per-call",
      "0.0005",
      "--json",
    ])
    expect(args.paths).toEqual(["panel-a.jsonl", "panel-b.jsonl"])
    expect(args.label).toBe("candidate:v1")
    expect(args.expId).toBe(382)
    expect(args.note).toBe("dry-run")
    expect(args.costPerCall).toBe(0.0005)
    expect(args.json).toBe(true)
  })

  test("rejects malformed exp-id and cost-per-call", () => {
    expect(() => parseArgs(["panel.jsonl", "--exp-id", "0"])).toThrow()
    expect(() => parseArgs(["panel.jsonl", "--cost-per-call", "-1"])).toThrow()
    expect(() => parseArgs(["--label"])).toThrow()
  })

  test("rejects unknown options", () => {
    expect(() => parseArgs(["panel.jsonl", "--persist"])).toThrow()
  })
})

describe("replay-first-plan summarizePanel", () => {
  test("recognises the halluc-ungrounded fixture panel and emits a runner command", () => {
    const summary = summarizePanel(HALLUC_PANEL, { ...defaults(), expId: 382 })
    expect(summary.shape).toBe("halluc-ungrounded-fixture")
    expect(summary.idField).toBe("case_id")
    expect(summary.checkers).toEqual(["halluc-ungrounded"])
    expect(summary.rowCount).toBeGreaterThanOrEqual(20)
    expect(summary.estimatedCalls).toBe(summary.rowCount)
    expect(summary.recommendedCommand).toContain(
      "bun scripts/hallucination/run-expanded-class-panel.ts",
    )
    expect(summary.recommendedCommand).toContain("--exp-id 382")
    expect(summary.recommendedCommand).toContain("--persist")
    expect(summary.warning).toBeNull()
  })

  test("recognises the adherence-events fixture panel and uses two calls per row", () => {
    const summary = summarizePanel(ADHERENCE_PANEL, defaults())
    expect(summary.shape).toBe("adherence-events-fixture")
    expect(summary.idField).toBe("fixture_id")
    expect(summary.checkers).toEqual(["adherence-events"])
    expect(summary.estimatedCalls).toBe(summary.rowCount * 2)
    expect(summary.recommendedCommand).toContain(
      "bun scripts/hallucination/run-partial-enactment-panel.ts",
    )
    expect(Object.keys(summary.oracleLabels).length).toBeGreaterThan(0)
  })

  test("returns a warning for missing files", () => {
    const summary = summarizePanel("/tmp/does-not-exist-replay-panel.jsonl", defaults())
    expect(summary.shape).toBeNull()
    expect(summary.rowCount).toBe(0)
    expect(summary.warning).toBe("panel file not found")
  })

  test("flags an unsupported row schema without crashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "replay-first-"))
    const path = join(dir, "unsupported.jsonl")
    writeFileSync(
      path,
      [
        JSON.stringify({ checker: "some-other-checker", task: {} }),
        JSON.stringify({ checker: "some-other-checker", task: {} }),
      ].join("\n"),
    )
    const summary = summarizePanel(path, defaults())
    expect(summary.shape).toBeNull()
    expect(summary.recommendedCommand).toBeNull()
    expect(summary.warning).toContain("no supported row shape")
  })

  test("flags mixed shapes inside a single panel", () => {
    const dir = mkdtempSync(join(tmpdir(), "replay-first-"))
    const path = join(dir, "mixed.jsonl")
    writeFileSync(
      path,
      [
        JSON.stringify({
          case_id: "h1",
          checker: "halluc-ungrounded",
          task: { checker_request_meta: {} },
          oracle_label: "true_hallucination",
        }),
        JSON.stringify({
          fixture_id: "a1",
          checker: "adherence-events",
          task: { writer_request_meta: { beatDescription: "x" } },
          oracle_label: "events_not_fully_enacted",
        }),
      ].join("\n"),
    )
    const summary = summarizePanel(path, defaults())
    expect(summary.shape).toBeNull()
    expect(summary.warning).toContain("mixed row shapes")
    expect(summary.rowCount).toBe(2)
    expect(summary.oracleLabels.true_hallucination).toBe(1)
    expect(summary.oracleLabels.events_not_fully_enacted).toBe(1)
  })
})

describe("replay-first-plan buildPlan + render", () => {
  test("totals across both tracked panels and reports zero unsupported", () => {
    const plan = buildPlan({
      ...defaults(),
      paths: [HALLUC_PANEL, ADHERENCE_PANEL],
      label: "L59-replay-first-harness:v1",
      expId: 382,
    })
    expect(plan.panels.length).toBe(2)
    expect(plan.totals.unsupportedPanels).toBe(0)
    expect(plan.totals.rowCount).toBe(plan.panels[0]!.rowCount + plan.panels[1]!.rowCount)
    expect(plan.totals.estimatedCalls).toBe(
      plan.panels[0]!.estimatedCalls + plan.panels[1]!.estimatedCalls,
    )
    const rendered = renderPlan(plan)
    expect(rendered).toContain("Replay-first plan")
    expect(rendered).toContain("L59-replay-first-harness:v1")
    expect(rendered).toContain("Experiment ID: 382")
    expect(rendered).toContain("run-expanded-class-panel.ts")
    expect(rendered).toContain("run-partial-enactment-panel.ts")
  })

  test("estimated cost scales with cost-per-call without launching anything", () => {
    const plan = buildPlan({
      ...defaults(),
      paths: [HALLUC_PANEL],
      costPerCall: 0.001,
    })
    const panel = plan.panels[0]!
    expect(panel.estimatedCostUsd).toBeCloseTo(panel.estimatedCalls * 0.001, 6)
    expect(plan.totals.estimatedCostUsd).toBeCloseTo(panel.estimatedCostUsd, 6)
  })
})

describe("replay-first-plan main", () => {
  test("returns exit code 0 with rendered text when both panels classify cleanly", () => {
    const result = main([HALLUC_PANEL, ADHERENCE_PANEL])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("Totals: panels=2")
    expect(result.output).toContain("unsupported=0")
  })

  test("returns exit code 2 and prints usage when no panels are supplied", () => {
    const result = main([])
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("Usage:")
  })

  test("returns exit code 2 when at least one panel has an unsupported schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "replay-first-"))
    const path = join(dir, "unsupported.jsonl")
    writeFileSync(path, JSON.stringify({ checker: "unknown", task: {} }) + "\n")
    const result = main([path])
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("unrecognised schema")
  })

  test("emits JSON when --json is supplied", () => {
    const result = main([HALLUC_PANEL, "--json"])
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output)
    expect(parsed.panels[0].shape).toBe("halluc-ungrounded-fixture")
    expect(parsed.totals.unsupportedPanels).toBe(0)
  })
})
