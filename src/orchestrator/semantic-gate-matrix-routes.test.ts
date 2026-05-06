import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { handleSemanticGateMatrixRoute } from "./semantic-gate-matrix-routes"

const tempRoots: string[] = []

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function tempBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nh-semantic-gate-matrix-"))
  tempRoots.push(root)
  return root
}

async function invoke(
  baseDir: string,
  method: string,
  path: string,
): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`)
  return handleSemanticGateMatrixRoute(new Request(url, { method }), url, { baseDir })
}

async function json(res: Response | null): Promise<{ status: number; body: any }> {
  expect(res).not.toBeNull()
  return { status: res!.status, body: await res!.json() }
}

describe("handleSemanticGateMatrixRoute", () => {
  test("returns null for non-matching paths and non-GET methods", async () => {
    const baseDir = await tempBase()

    expect(await invoke(baseDir, "POST", "/api/diagnostics/semantic-gate-matrix/run-1")).toBeNull()
    expect(await invoke(baseDir, "GET", "/api/diagnostics/not-semantic-gate-matrix")).toBeNull()
  })

  test("loads summary.json and optional report.md for a run", async () => {
    const baseDir = await tempBase()
    await writeRun(baseDir, "fantasy-system-heretic-20260506T142441023", {
      summary: {
        generatedAt: "2026-05-06T14:24:41.023Z",
        sourceNovelId: "fantasy-system-heretic",
        totals: { variants: 2, completed: 1 },
      },
      markdown: "# Semantic Gate Matrix\n\nEvidence.",
    })

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-matrix/fantasy-system-heretic-20260506T142441023"),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.runId).toBe("fantasy-system-heretic-20260506T142441023")
    expect(body.summaryPath).toEndWith("/fantasy-system-heretic-20260506T142441023/summary.json")
    expect(body.reportPath).toEndWith("/fantasy-system-heretic-20260506T142441023/report.md")
    expect(body.report.sourceNovelId).toBe("fantasy-system-heretic")
    expect(body.reportMarkdown).toBe("# Semantic Gate Matrix\n\nEvidence.")
  })

  test("returns null report fields when report.md is absent", async () => {
    const baseDir = await tempBase()
    await writeRun(baseDir, "run-without-markdown", {
      summary: { generatedAt: "2026-05-06T15:00:00.000Z", totals: { variants: 1 } },
    })

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-matrix/run-without-markdown"),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.reportPath).toBeNull()
    expect(body.reportMarkdown).toBeNull()
  })

  test("rejects encoded traversal before reading artifacts", async () => {
    const baseDir = await tempBase()

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-matrix/..%2Fsecret"),
    )

    expect(status).toBe(400)
    expect(body).toEqual({ ok: false, error: "invalid runId" })
  })

  test("rejects symlink escapes from the artifact root", async () => {
    const baseDir = await tempBase()
    const outside = await tempBase()
    await writeRun(outside, "outside-run", {
      summary: { generatedAt: "2026-05-06T15:30:00.000Z" },
    })
    await symlink(join(outside, "outside-run"), join(baseDir, "escape-run"))

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-matrix/escape-run"),
    )

    expect(status).toBe(400)
    expect(body).toEqual({ ok: false, error: "invalid runId" })
  })

  test("lists recent run summaries without markdown bodies", async () => {
    const baseDir = await tempBase()
    await writeRun(baseDir, "older-run", {
      summary: { generatedAt: "2026-05-06T14:00:00.000Z", sourceNovelId: "older" },
      markdown: "# Older",
    })
    await writeRun(baseDir, "newer-run", {
      summary: { generatedAt: "2026-05-06T15:00:00.000Z", sourceNovelId: "newer" },
      markdown: "# Newer",
    })

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-matrix?limit=1"),
    )

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0].runId).toBe("newer-run")
    expect(body.runs[0].sourceNovelId).toBe("newer")
    expect(body.runs[0].generatedAt).toBe("2026-05-06T15:00:00.000Z")
    expect(body.runs[0].variants).toBeNull()
    expect(body.runs[0].reportPath).toEndWith("/newer-run/report.md")
    expect(body.runs[0]).not.toHaveProperty("report")
    expect(body.runs[0]).not.toHaveProperty("reportMarkdown")
  })

  test("validates list limit", async () => {
    const baseDir = await tempBase()

    const { status, body } = await json(
      await invoke(baseDir, "GET", "/api/diagnostics/semantic-gate-matrix?limit=0"),
    )

    expect(status).toBe(400)
    expect(body).toEqual({ ok: false, error: "invalid limit query parameter" })
  })
})

async function writeRun(
  baseDir: string,
  runId: string,
  input: { summary: unknown; markdown?: string },
): Promise<void> {
  const runDir = join(baseDir, runId)
  await mkdir(runDir, { recursive: true })
  await writeFile(join(runDir, "summary.json"), JSON.stringify(input.summary, null, 2))
  if (input.markdown !== undefined) {
    await writeFile(join(runDir, "report.md"), input.markdown)
  }
}
