/**
 * Fine-tuning training data API routes.
 *
 * All routes under /api/finetune/*. Handles:
 * - Listing and filtering training pairs
 * - Reviewing/approving/rejecting pairs
 * - Exporting approved data as JSONL
 * - Triggering dataset generation
 */

import {
  getTrainingPairs,
  getTrainingPair,
  updateTrainingPair,
  getTrainingStats,
  getTrainingStatsByTask,
  exportApproved,
} from "../db/finetune"

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"

/**
 * Handle all /api/finetune/* routes. Returns null if the path doesn't match.
 */
export async function handleFinetuneRoute(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname

  // ── List pairs ──────────────────────────────────────────────────────
  if (path === "/api/finetune/pairs" && req.method === "GET") {
    try {
      const task = url.searchParams.get("task") || undefined
      const status = url.searchParams.get("status") || undefined
      const limit = parseInt(url.searchParams.get("limit") ?? "50")
      const offset = parseInt(url.searchParams.get("offset") ?? "0")
      const pairs = await getTrainingPairs(task, status, limit, offset)
      return Response.json({ pairs })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Stats ───────────────────────────────────────────────────────────
  if (path === "/api/finetune/stats" && req.method === "GET") {
    try {
      const task = url.searchParams.get("task") || undefined
      const totals = await getTrainingStats(task)
      const byTask = await getTrainingStatsByTask()
      return Response.json({ totals, byTask })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Export approved as JSONL ─────────────────────────────────────────
  if (path === "/api/finetune/export" && req.method === "GET") {
    const task = url.searchParams.get("task")
    if (!task) {
      return Response.json({ error: "task parameter required" }, { status: 400 })
    }
    try {
      const rows = await exportApproved(task)
      const jsonl = rows.map(r => JSON.stringify(r)).join("\n") + "\n"
      return new Response(jsonl, {
        headers: {
          "Content-Type": "application/jsonl",
          "Content-Disposition": `attachment; filename="${task}-approved.jsonl"`,
        },
      })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Generate data (trigger background script) ───────────────────────
  if (path === "/api/finetune/generate" && req.method === "POST") {
    try {
      const body = await req.json() as { task: string; limit?: number }
      if (!body.task) {
        return Response.json({ error: "task is required" }, { status: 400 })
      }
      const limit = body.limit ?? 50
      const cmd = `bun scripts/finetune/build-finetune-data.ts --task ${body.task} --limit ${limit}`

      const proc = Bun.spawn(["bash", "-c", cmd], {
        cwd: HARNESS_ROOT,
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      })

      // Fire and forget — don't await
      proc.exited.then(code => {
        if (code !== 0) console.error(`[finetune] generate exited with code ${code}`)
        else console.log(`[finetune] generate completed for task=${body.task}`)
      })

      return Response.json({ ok: true, task: body.task, limit, pid: proc.pid })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Single pair ─────────────────────────────────────────────────────
  const pairMatch = path.match(/^\/api\/finetune\/pairs\/([^/]+)$/)
  if (pairMatch && req.method === "GET") {
    const id = pairMatch[1]
    try {
      const pair = await getTrainingPair(id)
      if (!pair) return Response.json({ error: "Not found" }, { status: 404 })
      return Response.json(pair)
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Update pair ─────────────────────────────────────────────────────
  if (pairMatch && req.method === "PUT") {
    const id = pairMatch[1]
    try {
      const body = await req.json() as { gold_output?: string; status?: string; reviewer_notes?: string }
      const updated = await updateTrainingPair(id, body)
      if (!updated) return Response.json({ error: "Not found" }, { status: 404 })
      return Response.json(updated)
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  return null
}
