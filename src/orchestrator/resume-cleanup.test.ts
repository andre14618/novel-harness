/**
 * Regression guard for the /api/novel/resume orphan-cleanup wiring.
 *
 * The resume route handler calls `cleanOrphanedExhaustionsForNovel` via a
 * dynamic import to avoid pulling DB modules at orchestrator boot. A
 * refactor / rename / import-path break would surface as a 500 at resume
 * time rather than a build/test failure (Codex finding LOW on d055f60).
 *
 * This test asserts BOTH:
 *   (a) The helper exists at the import path the route uses (catches
 *       rename / module move).
 *   (b) The route source still contains the call site (catches a refactor
 *       that drops the cleanup call entirely).
 *
 * It is a lightweight wiring test — it does NOT spin up the orchestrator
 * server or auth a request. Full end-to-end resume behavior is covered by
 * integration runs against the LXC orchestrator.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("resume-route orphan-cleanup wiring", () => {
  test("cleanOrphanedExhaustionsForNovel is exported at the path the route imports", async () => {
    // The route does `await import("../db/chapter-exhaustions")`. If that
    // module no longer exports the helper, this import throws at test time.
    const mod = await import("../db/chapter-exhaustions")
    expect(typeof mod.cleanOrphanedExhaustionsForNovel).toBe("function")
    // Signature check: (novelId: string, reason: string) — function.length
    // counts non-default required params.
    expect(mod.cleanOrphanedExhaustionsForNovel.length).toBeGreaterThanOrEqual(2)
  })

  test("novel-routes.ts source still calls cleanOrphanedExhaustionsForNovel from the resume handler", () => {
    const routesPath = join(import.meta.dir, "novel-routes.ts")
    const src = readFileSync(routesPath, "utf8")

    // Import statement (dynamic import inside the resume block).
    expect(src).toContain("cleanOrphanedExhaustionsForNovel")
    expect(src).toContain('"../db/chapter-exhaustions"')

    // The call site must be inside the /api/novel/resume handler body.
    // Line-based check: the cleanup call line must fall between the
    // resume handler's `if (path === "/api/novel/resume" ...)` opener
    // and the NEXT route handler in the file. Char-based proximity
    // breaks when the handler body grows; line-bracketing is durable.
    const lines = src.split("\n")
    const resumeLine = lines.findIndex(l => l.includes('"/api/novel/resume"'))
    const cleanupLine = lines.findIndex(l => l.includes("cleanOrphanedExhaustionsForNovel("))
    expect(resumeLine).toBeGreaterThan(-1)
    expect(cleanupLine).toBeGreaterThan(-1)
    expect(cleanupLine).toBeGreaterThan(resumeLine)

    // Find the next `if (path === "..."` handler after the resume handler.
    // The cleanup call must come BEFORE it (i.e. inside the resume body).
    const nextHandlerLine = lines.findIndex((l, i) =>
      i > resumeLine && /if \(path === "\/api\//.test(l)
    )
    expect(nextHandlerLine).toBeGreaterThan(-1)
    expect(cleanupLine).toBeLessThan(nextHandlerLine)
  })
})
