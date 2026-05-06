import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { handleSemanticGateCohortMatrixRoute } from "./semantic-gate-cohort-matrix-routes"

const tempRoots: string[] = []

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function tempBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nh-semantic-gate-cohort-matrix-"))
  tempRoots.push(root)
  return root
}

async function invoke(
  baseDir: string,
  method: string,
  path: string,
): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  return handleSemanticGateCohortMatrixRoute(new Request(url, { method }), url, { baseDir })
}

async function json(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

describe("handleSemanticGateCohortMatrixRoute", () => {
  test("returns null for non-matching paths and non-GET methods", async () => {
    const baseDir = await tempBase()

    expect(await invoke(baseDir, "POST", "/api/diagnostics/semantic-gate-cohort-matrix/run-1")).toBeNull()
    expect(await invoke(baseDir, "GET", "/api/diagnostics/not-semantic-gate-cohort-matrix")).toBeNull()
  })

  test("loads summary.json and optional report.md for a run detail", async () => {
    const baseDir = await tempBase()
    await writeRun(baseDir, "existing-summary-smoke-20260506T160425", {
      summary: cohortSummary({
        generatedAt: "2026-05-06T16:04:25.469Z",
        outputBase: "/tmp/cohort",
      }),
      markdown: "# Semantic Gate Cohort Matrix\n\nEvidence.",
    })

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-cohort-matrix/existing-summary-smoke-20260506T160425"),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.runId).toBe("existing-summary-smoke-20260506T160425")
    expect(body.summaryPath).toEndWith("/existing-summary-smoke-20260506T160425/summary.json")
    expect(body.reportPath).toEndWith("/existing-summary-smoke-20260506T160425/report.md")
    expect(body.report.generatedAt).toBe("2026-05-06T16:04:25.469Z")
    expect(body.reportMarkdown).toBe("# Semantic Gate Cohort Matrix\n\nEvidence.")
  })

  test("returns null report fields when report.md is absent", async () => {
    const baseDir = await tempBase()
    await writeRun(baseDir, "run-without-markdown", {
      summary: cohortSummary({ generatedAt: "2026-05-06T17:00:00.000Z" }),
    })

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-cohort-matrix/run-without-markdown"),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.reportPath).toBeNull()
    expect(body.reportMarkdown).toBeNull()
  })

  test("lists compact summaries without full report or markdown", async () => {
    const baseDir = await tempBase()
    await writeRun(baseDir, "older-run", {
      summary: cohortSummary({ generatedAt: "2026-05-06T15:00:00.000Z" }),
      markdown: "# Older",
      mtime: new Date("2026-05-06T15:00:00.000Z"),
    })
    await writeRun(baseDir, "newer-run", {
      summary: cohortSummary({
        generatedAt: "2026-05-06T16:00:00.000Z",
        matrixRuns: 2,
        reportedMatrices: 1,
        failedMatrices: 1,
        variantRuns: 5,
        completedVariantRuns: 3,
        cleanPass: 1,
        costUsd: 0.1234,
        topVariantLabel: "beats 5",
        topMeanRiskScore: 42.5,
        topCompleted: 2,
        topReasons: [
          "1 plan-drift chapter(s) (2)",
          "2 writer-expansion chapter(s) (1)",
          "completed without semantic-gate signals (1)",
          "pending plan-assist gate (1)",
          "extra reason not included",
        ],
        topRiskDrivers: [
          "plan drift (160)",
          "writer expansion (30)",
          "pending plan-assist (20)",
          "proposals/actions (10)",
          "extra driver not included",
        ],
      }),
      markdown: "# Newer",
      mtime: new Date("2026-05-06T16:00:00.000Z"),
    })

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-cohort-matrix?limit=1"),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0].runId).toBe("newer-run")
    expect(body.runs[0].generatedAt).toBe("2026-05-06T16:00:00.000Z")
    expect(body.runs[0].matrixRuns).toBe(2)
    expect(body.runs[0].reportedMatrices).toBe(1)
    expect(body.runs[0].failedMatrices).toBe(1)
    expect(body.runs[0].variantRuns).toBe(5)
    expect(body.runs[0].completedVariantRuns).toBe(3)
    expect(body.runs[0].cleanPass).toBe(1)
    expect(body.runs[0].costUsd).toBe(0.1234)
    expect(body.runs[0].topVariantLabel).toBe("beats 5")
    expect(body.runs[0].topMeanRiskScore).toBe(42.5)
    expect(body.runs[0].topCompleted).toBe(2)
    expect(body.runs[0].topRuns).toBe(1)
    expect(body.runs[0].topReasons).toEqual([
      "1 plan-drift chapter(s) (2)",
      "2 writer-expansion chapter(s) (1)",
      "completed without semantic-gate signals (1)",
      "pending plan-assist gate (1)",
    ])
    expect(body.runs[0].topRiskDrivers).toEqual([
      "plan drift (160)",
      "writer expansion (30)",
      "pending plan-assist (20)",
      "proposals/actions (10)",
    ])
    expect(body.runs[0].summaryPath).toEndWith("/newer-run/summary.json")
    expect(body.runs[0].reportPath).toEndWith("/newer-run/report.md")
    expect(body.runs[0].mtimeMs).toBeGreaterThan(0)
    expect(body.runs[0]).not.toHaveProperty("report")
    expect(body.runs[0]).not.toHaveProperty("reportMarkdown")
  })

  test("uses null and empty compact fields when summary fields are malformed or absent", async () => {
    const baseDir = await tempBase()
    await writeRun(baseDir, "malformed-summary-run", {
      summary: {
        generatedAt: 42,
        totals: {
          matrixRuns: "two",
          reportedMatrices: Number.POSITIVE_INFINITY,
          costUsd: "expensive",
        },
        ranking: [{
          label: false,
          meanRiskScore: "high",
          completed: true,
          topReasons: ["ok", 12],
          topRiskDrivers: "driver",
        }],
      },
      markdown: "# Malformed",
    })

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-cohort-matrix"),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0].generatedAt).toBeNull()
    expect(body.runs[0].matrixRuns).toBeNull()
    expect(body.runs[0].reportedMatrices).toBeNull()
    expect(body.runs[0].failedMatrices).toBeNull()
    expect(body.runs[0].variantRuns).toBeNull()
    expect(body.runs[0].completedVariantRuns).toBeNull()
    expect(body.runs[0].cleanPass).toBeNull()
    expect(body.runs[0].costUsd).toBeNull()
    expect(body.runs[0].topVariantLabel).toBeNull()
    expect(body.runs[0].topMeanRiskScore).toBeNull()
    expect(body.runs[0].topCompleted).toBeNull()
    expect(body.runs[0].topRuns).toBeNull()
    expect(body.runs[0].topReasons).toEqual([])
    expect(body.runs[0].topRiskDrivers).toEqual([])
    expect(body.runs[0]).not.toHaveProperty("report")
    expect(body.runs[0]).not.toHaveProperty("reportMarkdown")
  })

  test("validates list limit", async () => {
    const baseDir = await tempBase()

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-cohort-matrix?limit=0"),
    )

    expect(status).toBe(400)
    expect(body).toEqual({ ok: false, error: "invalid limit query parameter" })
  })

  test("rejects traversal, encoded slash, and encoded backslash runIds", async () => {
    const baseDir = await tempBase()

    for (const suffix of ["..%2Fsecret", "nested%5Csecret", "bad..run"]) {
      const { status, body } = await json(
        await invoke(baseDir, "GET", `/api/diagnostics/semantic-gate-cohort-matrix/${suffix}`),
      )
      expect(status).toBe(400)
      expect(body).toEqual({ ok: false, error: "invalid runId" })
    }
  })

  test("rejects symlink escapes from the artifact root", async () => {
    const baseDir = await tempBase()
    const outside = await tempBase()
    await writeRun(outside, "outside-run", {
      summary: cohortSummary({ generatedAt: "2026-05-06T17:30:00.000Z" }),
    })
    await symlink(join(outside, "outside-run"), join(baseDir, "escape-run"))

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-cohort-matrix/escape-run"),
    )

    expect(status).toBe(400)
    expect(body).toEqual({ ok: false, error: "invalid runId" })
  })

  test("rejects summary and report symlink escapes from a run directory", async () => {
    const baseDir = await tempBase()
    const outside = await tempBase()
    await writeFile(join(outside, "summary.json"), JSON.stringify(cohortSummary({}), null, 2))
    await writeFile(join(outside, "report.md"), "# Outside")

    await mkdir(join(baseDir, "summary-escape-run"), { recursive: true })
    await symlink(join(outside, "summary.json"), join(baseDir, "summary-escape-run", "summary.json"))

    await writeRun(baseDir, "report-escape-run", {
      summary: cohortSummary({ generatedAt: "2026-05-06T17:40:00.000Z" }),
    })
    await symlink(join(outside, "report.md"), join(baseDir, "report-escape-run", "report.md"))

    const summaryEscape = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-cohort-matrix/summary-escape-run"),
    )
    expect(summaryEscape.status).toBe(400)
    expect(summaryEscape.body).toEqual({ ok: false, error: "invalid run artifact path" })

    const reportEscape = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-cohort-matrix/report-escape-run"),
    )
    expect(reportEscape.status).toBe(400)
    expect(reportEscape.body).toEqual({ ok: false, error: "invalid run artifact path" })
  })

  test("returns an empty list when the artifact base directory is missing", async () => {
    const root = await tempBase()
    const missingBaseDir = join(root, "missing")

    const { status, body } = await json(
      await invoke(missingBaseDir, "GET", "/api/diagnostics/semantic-gate-cohort-matrix"),
    )

    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, runs: [] })
  })
})

async function writeRun(
  baseDir: string,
  runId: string,
  input: { summary: unknown; markdown?: string; mtime?: Date },
): Promise<void> {
  const runDir = join(baseDir, runId)
  await mkdir(runDir, { recursive: true })
  const summaryPath = join(runDir, "summary.json")
  await writeFile(summaryPath, JSON.stringify(input.summary, null, 2))
  if (input.markdown !== undefined) {
    await writeFile(join(runDir, "report.md"), input.markdown)
  }
  if (input.mtime) {
    await utimes(summaryPath, input.mtime, input.mtime)
  }
}

function cohortSummary(input: {
  generatedAt?: unknown
  outputBase?: unknown
  matrixRuns?: unknown
  reportedMatrices?: unknown
  failedMatrices?: unknown
  variantRuns?: unknown
  completedVariantRuns?: unknown
  cleanPass?: unknown
  costUsd?: unknown
  topVariantLabel?: unknown
  topMeanRiskScore?: unknown
  topCompleted?: unknown
  topReasons?: unknown
  topRiskDrivers?: unknown
}): unknown {
  return {
    generatedAt: input.generatedAt ?? "2026-05-06T16:04:25.469Z",
    chapters: 2,
    outputBase: input.outputBase ?? "/tmp/cohort",
    variantSpecs: ["beats=4", "beats=5"],
    runs: [],
    variants: [],
    ranking: [{
      variantId: "beats-5",
      label: input.topVariantLabel ?? "beats 5",
      meanRiskScore: input.topMeanRiskScore ?? 113.45,
      completed: input.topCompleted ?? 1,
      runs: 1,
      cleanPass: 0,
      meanWordRatio: 1.35,
      totalCostUsd: 0.0241,
      topReasons: input.topReasons ?? ["1 plan-drift chapter(s) (1)"],
      topRiskDrivers: input.topRiskDrivers ?? ["plan drift (80)"],
    }],
    totals: {
      matrixRuns: input.matrixRuns ?? 1,
      reportedMatrices: input.reportedMatrices ?? 1,
      failedMatrices: input.failedMatrices ?? 0,
      variantRuns: input.variantRuns ?? 2,
      completedVariantRuns: input.completedVariantRuns ?? 2,
      failedVariantRuns: 0,
      cleanPass: input.cleanPass ?? 0,
      costUsd: input.costUsd ?? 0.0494,
      llmCalls: 144,
    },
  }
}
