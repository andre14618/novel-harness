import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { handleSemanticGateBaselineRoute } from "./semantic-gate-baseline-routes"

const tempRoots: string[] = []

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function tempBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nh-semantic-gate-baseline-"))
  tempRoots.push(root)
  return root
}

async function invoke(
  baseDir: string,
  method: string,
  path: string,
): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  return handleSemanticGateBaselineRoute(new Request(url, { method }), url, { baseDir })
}

async function json(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

describe("handleSemanticGateBaselineRoute", () => {
  test("returns null for non-matching paths and non-GET methods", async () => {
    const baseDir = await tempBase()

    expect(await invoke(baseDir, "POST", "/api/diagnostics/semantic-gate-baseline/run-1")).toBeNull()
    expect(await invoke(baseDir, "GET", "/api/diagnostics/not-semantic-gate-baseline")).toBeNull()
  })

  test("loads summary.json and report.md for a run detail", async () => {
    const baseDir = await tempBase()
    await writeRun(baseDir, "fantasy-system-heretic-capped-20260506T-current", {
      summary: baselineSummary({
        generatedAt: "2026-05-06T12:17:43.816Z",
        sourceNovelId: "fantasy-system-heretic",
        novelId: "semantic-gate-baseline-20260506T121213224-fantasy-system-heretic",
      }),
      markdown: "# Semantic Gate Baseline\n\nEvidence.",
    })

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-baseline/fantasy-system-heretic-capped-20260506T-current"),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.runId).toBe("fantasy-system-heretic-capped-20260506T-current")
    expect(body.summaryPath).toEndWith("/fantasy-system-heretic-capped-20260506T-current/summary.json")
    expect(body.reportPath).toEndWith("/fantasy-system-heretic-capped-20260506T-current/report.md")
    expect(body.report.sourceNovelId).toBe("fantasy-system-heretic")
    expect(body.reportMarkdown).toBe("# Semantic Gate Baseline\n\nEvidence.")
  })

  test("lists compact summaries without full report or markdown", async () => {
    const baseDir = await tempBase()
    await writeRun(baseDir, "older-run", {
      summary: baselineSummary({
        generatedAt: "2026-05-06T11:00:00.000Z",
        sourceNovelId: "older",
        novelId: "older-disposable",
        terminalStatus: "completed",
      }),
      markdown: "# Older",
      mtime: new Date("2026-05-06T11:00:00.000Z"),
    })
    await writeRun(baseDir, "newer-run", {
      summary: baselineSummary({
        generatedAt: "2026-05-06T12:00:00.000Z",
        sourceNovelId: "newer",
        novelId: "newer-disposable",
        chapters: 2,
        maxBeatsPerChapter: 5,
        terminalStatus: "pending-plan-assist",
        terminalReason: "stopped at pending plan-assist gate: chapter 2, kind plan-check-exhausted",
        approvedChapters: 1,
        latestChapters: 1,
        totalWords: 2321,
        llmCalls: 48,
        costUsd: 0.013553,
        proposalTotal: 3,
      }),
      markdown: "# Newer",
      mtime: new Date("2026-05-06T12:00:00.000Z"),
    })

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-baseline?limit=1"),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0].runId).toBe("newer-run")
    expect(body.runs[0].sourceNovelId).toBe("newer")
    expect(body.runs[0].generatedAt).toBe("2026-05-06T12:00:00.000Z")
    expect(body.runs[0].novelId).toBe("newer-disposable")
    expect(body.runs[0].chapters).toBe(2)
    expect(body.runs[0].maxBeatsPerChapter).toBe(5)
    expect(body.runs[0].terminalStatus).toBe("pending-plan-assist")
    expect(body.runs[0].terminalReason).toBe("stopped at pending plan-assist gate: chapter 2, kind plan-check-exhausted")
    expect(body.runs[0].approvedChapters).toBe(1)
    expect(body.runs[0].latestChapters).toBe(1)
    expect(body.runs[0].totalWords).toBe(2321)
    expect(body.runs[0].llmCalls).toBe(48)
    expect(body.runs[0].costUsd).toBe(0.013553)
    expect(body.runs[0].proposalTotal).toBe(3)
    expect(body.runs[0].summaryPath).toEndWith("/newer-run/summary.json")
    expect(body.runs[0].reportPath).toEndWith("/newer-run/report.md")
    expect(body.runs[0].mtimeMs).toBeGreaterThan(0)
    expect(body.runs[0]).not.toHaveProperty("report")
    expect(body.runs[0]).not.toHaveProperty("reportMarkdown")
  })

  test("uses null compact fields when summary fields are malformed or absent", async () => {
    const baseDir = await tempBase()
    await writeRun(baseDir, "malformed-summary-run", {
      summary: {
        generatedAt: 42,
        terminal: { status: false },
        drafts: { totalWords: Number.POSITIVE_INFINITY },
        llm: { calls: "many" },
        proposals: {},
      },
      markdown: "# Malformed",
    })

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-baseline"),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0].sourceNovelId).toBeNull()
    expect(body.runs[0].generatedAt).toBeNull()
    expect(body.runs[0].novelId).toBeNull()
    expect(body.runs[0].chapters).toBeNull()
    expect(body.runs[0].maxBeatsPerChapter).toBeNull()
    expect(body.runs[0].terminalStatus).toBeNull()
    expect(body.runs[0].terminalReason).toBeNull()
    expect(body.runs[0].approvedChapters).toBeNull()
    expect(body.runs[0].latestChapters).toBeNull()
    expect(body.runs[0].totalWords).toBeNull()
    expect(body.runs[0].llmCalls).toBeNull()
    expect(body.runs[0].costUsd).toBeNull()
    expect(body.runs[0].proposalTotal).toBeNull()
    expect(body.runs[0]).not.toHaveProperty("report")
    expect(body.runs[0]).not.toHaveProperty("reportMarkdown")
  })

  test("validates list limit", async () => {
    const baseDir = await tempBase()

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-baseline?limit=101"),
    )

    expect(status).toBe(400)
    expect(body).toEqual({ ok: false, error: "invalid limit query parameter" })
  })

  test("rejects traversal, encoded slash, and encoded backslash runIds", async () => {
    const baseDir = await tempBase()

    for (const suffix of ["..%2Fsecret", "nested%5Csecret", "bad..run"]) {
      const { status, body } = await json(
        await invoke(baseDir, "GET", `/api/diagnostics/semantic-gate-baseline/${suffix}`),
      )
      expect(status).toBe(400)
      expect(body).toEqual({ ok: false, error: "invalid runId" })
    }
  })

  test("rejects symlink escapes from the artifact root", async () => {
    const baseDir = await tempBase()
    const outside = await tempBase()
    await writeRun(outside, "outside-run", {
      summary: baselineSummary({ generatedAt: "2026-05-06T15:30:00.000Z" }),
    })
    await symlink(join(outside, "outside-run"), join(baseDir, "escape-run"))

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-baseline/escape-run"),
    )

    expect(status).toBe(400)
    expect(body).toEqual({ ok: false, error: "invalid runId" })
  })

  test("rejects report symlink escapes from a run directory", async () => {
    const baseDir = await tempBase()
    const outside = await tempBase()
    await writeFile(join(outside, "report.md"), "# Outside")
    await writeRun(baseDir, "report-escape-run", {
      summary: baselineSummary({ generatedAt: "2026-05-06T15:40:00.000Z" }),
    })
    await symlink(join(outside, "report.md"), join(baseDir, "report-escape-run", "report.md"))

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-baseline/report-escape-run"),
    )

    expect(status).toBe(400)
    expect(body).toEqual({ ok: false, error: "invalid run artifact path" })
  })

  test("returns an empty list when the artifact base directory is missing", async () => {
    const root = await tempBase()
    const missingBaseDir = join(root, "missing")

    const { status, body } = await json(
      await invoke(missingBaseDir, "GET", "/api/diagnostics/semantic-gate-baseline"),
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

function baselineSummary(input: {
  generatedAt?: unknown
  sourceNovelId?: unknown
  novelId?: unknown
  chapters?: unknown
  maxBeatsPerChapter?: unknown
  terminalStatus?: unknown
  terminalReason?: unknown
  approvedChapters?: unknown
  latestChapters?: unknown
  totalWords?: unknown
  llmCalls?: unknown
  costUsd?: unknown
  proposalTotal?: unknown
}): unknown {
  return {
    generatedAt: input.generatedAt ?? "2026-05-06T12:17:43.816Z",
    sourceNovelId: input.sourceNovelId ?? "fantasy-system-heretic",
    novelId: input.novelId ?? "semantic-gate-baseline-test",
    chapters: input.chapters ?? 2,
    maxBeatsPerChapter: input.maxBeatsPerChapter ?? null,
    terminal: {
      status: input.terminalStatus ?? "completed",
      reason: input.terminalReason ?? "completed requested chapters",
    },
    drafts: {
      approvedChapters: input.approvedChapters ?? 2,
      latestChapters: input.latestChapters ?? 2,
      totalWords: input.totalWords ?? 4200,
    },
    llm: {
      calls: input.llmCalls ?? 30,
      costUsd: input.costUsd ?? 0.01,
    },
    proposals: {
      total: input.proposalTotal ?? 0,
    },
    checker: {
      semanticGate: {
        chapters: [],
      },
    },
  }
}
