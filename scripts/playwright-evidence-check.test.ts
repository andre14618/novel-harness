import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import {
  inspectPlaywrightEvidence,
  parseArgs,
  renderPlaywrightEvidenceReport,
} from "./playwright-evidence-check"

let tempRoots: string[] = []

afterEach(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true })
  tempRoots = []
})

describe("playwright-evidence-check parseArgs", () => {
  test("requires an evidence directory", () => {
    expect(() => parseArgs([])).toThrow(/missing required --dir/)
  })

  test("parses dir and json", () => {
    const args = parseArgs(["--dir", "output/playwright/run", "--json"])

    expect(args.dir).toContain("output/playwright/run")
    expect(args.json).toBe(true)
  })
})

describe("inspectPlaywrightEvidence", () => {
  test("passes complete evidence with completed checklist and captures", async () => {
    const dir = await evidenceDir()
    await writeCompleteEvidence(dir)

    const report = await inspectPlaywrightEvidence(dir)

    expect(report.status).toBe("clear")
    expect(report.checklist).toMatchObject({
      total: 2,
      passed: 2,
      failed: 0,
      blocked: 0,
      unchecked: 0,
    })
    expect(report.screenshots).toEqual(["after-approve.png", "baseline.png"])
    expect(renderPlaywrightEvidenceReport(report)).toContain("Playwright evidence check: clear")
  })

  test("fails pending preflight placeholders and unchecked checklist items", async () => {
    const dir = await evidenceDir()
    await writeCompleteEvidence(dir, {
      checklist: "- [x] Baseline page load succeeds.\n- [ ] Primary action succeeds.\n",
      console: "# Console Capture\n\nPending Playwright MCP capture.\n",
    })

    const report = await inspectPlaywrightEvidence(dir)

    expect(report.status).toBe("incomplete")
    expect(report.checklist.unchecked).toBe(1)
    expect(report.checks.some(check => check.name === "console capture" && check.status === "fail")).toBe(true)
  })

  test("reports complete-but-not-clear when checklist records a failed item", async () => {
    const dir = await evidenceDir()
    await writeCompleteEvidence(dir, {
      checklist: "- [x] Baseline page load succeeds.\n- [!] Primary action fails with visible blocker.\n",
    })

    const report = await inspectPlaywrightEvidence(dir)

    expect(report.status).toBe("not-clear")
    expect(report.checklist.failed).toBe(1)
    expect(report.checks).toContainEqual({
      name: "checklist completion",
      status: "fail",
      detail: "total=2, passed=1, failed=1, blocked=0, unchecked=0",
      failureKind: "not-clear",
    })
  })

  test("fails when baseline screenshot is missing", async () => {
    const dir = await evidenceDir()
    await writeCompleteEvidence(dir, {
      screenshots: ["after-action.png"],
    })

    const report = await inspectPlaywrightEvidence(dir)

    expect(report.status).toBe("incomplete")
    expect(report.checks).toContainEqual({
      name: "baseline screenshot",
      status: "fail",
      detail: "no screenshot filename contains baseline",
      failureKind: "incomplete",
    })
  })

  test("fails missing evidence directory", async () => {
    const report = await inspectPlaywrightEvidence("/tmp/novel-harness-missing-evidence-dir")

    expect(report.status).toBe("incomplete")
    expect(report.checks[0]).toMatchObject({
      name: "evidence directory",
      status: "fail",
    })
  })
})

async function evidenceDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nh-playwright-evidence-"))
  tempRoots.push(root)
  const dir = join(root, "output", "playwright", "2026-05-06", "surface-novel")
  await mkdir(dir, { recursive: true })
  return dir
}

async function writeCompleteEvidence(
  dir: string,
  overrides: {
    checklist?: string
    console?: string
    network?: string
    screenshots?: string[]
  } = {},
): Promise<void> {
  await writeFile(join(dir, "RUNBOOK.md"), "# Runbook\n", "utf8")
  await writeFile(
    join(dir, "CHECKLIST.md"),
    overrides.checklist ?? "- [x] Baseline page load succeeds.\n- [x] Primary action succeeds.\n",
    "utf8",
  )
  await writeFile(join(dir, "console-final.md"), overrides.console ?? "# Console\n\nNo unexpected errors.\n", "utf8")
  await writeFile(join(dir, "network-final.md"), overrides.network ?? "# Network\n\nNo failed API calls.\n", "utf8")
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify({
    surface: "Planning Studio",
    baseUrl: "http://localhost:3006",
    startingUrl: "http://localhost:3006/app/studio/novel-1",
    evidenceDir: dir,
    createdAt: "2026-05-06T00:00:00.000Z",
    server: { ok: true },
  }, null, 2)}\n`, "utf8")

  for (const screenshot of overrides.screenshots ?? ["baseline.png", "after-approve.png"]) {
    await writeFile(join(dir, screenshot), "not really a png; enough for inventory\n", "utf8")
  }
}
