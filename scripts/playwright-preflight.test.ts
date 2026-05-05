import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import {
  buildPlan,
  parseArgs,
  preparePlaywrightPreflight,
} from "./playwright-preflight"

let tempRoots: string[] = []

afterEach(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true })
  tempRoots = []
})

describe("playwright-preflight parseArgs", () => {
  test("requires a surface", () => {
    expect(() => parseArgs([])).toThrow(/missing required --surface/)
  })

  test("parses surface, novel, URL, and date", () => {
    const args = parseArgs([
      "--surface", "Planning Studio",
      "--novel", "novel-1",
      "--url", "/app/studio/novel-1",
      "--date", "2026-05-05",
      "--skip-server-check",
    ])

    expect(args.surface).toBe("Planning Studio")
    expect(args.novel).toBe("novel-1")
    expect(args.url).toBe("/app/studio/novel-1")
    expect(args.date).toBe("2026-05-05")
    expect(args.skipServerCheck).toBe(true)
  })

  test("rejects malformed dates", () => {
    expect(() => parseArgs(["--surface", "studio", "--date", "05-05-2026"]))
      .toThrow(/invalid --date/)
  })
})

describe("playwright-preflight plan", () => {
  test("builds stable evidence directory and starting URL", () => {
    const args = parseArgs([
      "--surface", "Planning Studio",
      "--novel", "novel-1",
      "--url", "/app/studio/novel-1",
      "--date", "2026-05-05",
      "--root", "/tmp/repo",
    ])
    const plan = buildPlan(args)

    expect(plan.sessionSlug).toBe("planning-studio-novel-1")
    expect(plan.evidenceDir).toBe("/tmp/repo/output/playwright/2026-05-05/planning-studio-novel-1")
    expect(plan.startingUrl).toBe("http://localhost:3006/app/studio/novel-1")
  })

  test("writes runbook, console, network, and manifest files", async () => {
    const root = await mkdtemp(join(tmpdir(), "nh-playwright-preflight-"))
    tempRoots.push(root)
    const args = parseArgs([
      "--surface", "Planning Studio",
      "--novel", "novel-1",
      "--url", "/app/studio/novel-1",
      "--date", "2026-05-05",
      "--root", root,
      "--skip-server-check",
    ])
    const { plan } = await preparePlaywrightPreflight(args)

    const runbook = await readFile(plan.runbookPath, "utf8")
    const consoleCapture = await readFile(plan.consolePath, "utf8")
    const networkCapture = await readFile(plan.networkPath, "utf8")
    const manifest = JSON.parse(await readFile(plan.manifestPath, "utf8"))

    expect(runbook).toContain("Surface: Planning Studio")
    expect(runbook).toContain("Starting URL: http://localhost:3006/app/studio/novel-1")
    expect(runbook).toContain("Close the Playwright MCP tab/session")
    expect(consoleCapture).toContain("Pending Playwright MCP capture")
    expect(networkCapture).toContain("Pending Playwright MCP capture")
    expect(manifest.surface).toBe("Planning Studio")
    expect(manifest.server.ok).toBe(true)
  })
})
