/**
 * Novel Harness Orchestrator — single service.
 *
 * Runs on LXC 307 (port 3006). Combines:
 * - Batch API polling (every 30 min)
 * - Improvement daemon (manual trigger only)
 * - Dashboard (HTML status page)
 * - REST API for status queries
 *
 * Entry point: bun src/orchestrator/server.ts
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve, basename } from "node:path"
import { migrate } from "./db"
import { handleNovelRoute } from "./novel-routes"
import { handleFinetuneRoute } from "./finetune-routes"
import { handlePrefEvalRoute } from "./pref-eval-routes"
import { overviewPageHtml } from "./overview-page"

await migrate()

const API_KEY = process.env.ORCHESTRATOR_API_KEY
if (!API_KEY) throw new Error("ORCHESTRATOR_API_KEY not set")

const PASSWORD = process.env.ORCHESTRATOR_PASSWORD
if (!PASSWORD) throw new Error("ORCHESTRATOR_PASSWORD not set")

// Session token — HMAC of the password, used as cookie value so the raw
// password is never stored client-side.
const SESSION_TOKEN = new Bun.CryptoHasher("sha256").update(PASSWORD).update(API_KEY).digest("hex")

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get("cookie") ?? ""
  const cookies: Record<string, string> = {}
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k) cookies[k] = v.join("=")
  }
  return cookies
}

function checkAuth(req: Request): Response | null {
  // API callers: header or query param (API key)
  const apiKey = req.headers.get("x-api-key") || new URL(req.url).searchParams.get("key")
  if (apiKey === API_KEY) return null
  // Browser sessions: cookie (session token)
  const cookie = parseCookies(req).nh_session
  if (cookie === SESSION_TOKEN) return null
  return Response.json({ error: "Unauthorized" }, { status: 401 })
}

function isAuthed(req: Request): boolean {
  const apiKey = req.headers.get("x-api-key") || new URL(req.url).searchParams.get("key")
  if (apiKey === API_KEY) return true
  const cookie = parseCookies(req).nh_session
  return cookie === SESSION_TOKEN
}

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"

// ── Process management ──────────────────────────────────────────────────

interface TrackedProcess {
  proc: ReturnType<typeof Bun.spawn>
  type: "novel"
  label: string
  startedAt: string
  stdout: string[]
  exitCode: number | null
}

const processes = new Map<number, TrackedProcess>()
const MAX_TRACKED = 20

function trackProcess(proc: ReturnType<typeof Bun.spawn>, label: string): number {
  const pid = proc.pid
  const tracked: TrackedProcess = {
    proc, type: "novel", label,
    startedAt: new Date().toISOString(),
    stdout: [],
    exitCode: null,
  }
  processes.set(pid, tracked)

  if (proc.stdout) {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    ;(async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const lines = decoder.decode(value).split("\n")
          for (const line of lines) {
            if (line.trim()) tracked.stdout.push(line)
          }
          if (tracked.stdout.length > 300) tracked.stdout.splice(0, tracked.stdout.length - 300)
        }
      } catch {}
    })()
  }

  proc.exited.then(code => { tracked.exitCode = code })

  if (processes.size > MAX_TRACKED) {
    for (const [oldPid, p] of processes) {
      if (p.exitCode !== null) { processes.delete(oldPid); break }
    }
  }

  return pid
}

function spawnNovel(seed?: string): number {
  let cmd = "bun src/index.ts --auto"
  if (seed) cmd += ` --seed ${seed}`

  const proc = Bun.spawn(["bash", "-c", cmd], {
    cwd: HARNESS_ROOT,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  })

  return trackProcess(proc, seed ? `novel (${seed})` : "novel")
}

function getProcessStatus(pid: number) {
  const p = processes.get(pid)
  if (!p) return null
  return {
    pid,
    type: p.type,
    label: p.label,
    startedAt: p.startedAt,
    running: p.exitCode === null,
    exitCode: p.exitCode,
    stdoutLines: p.stdout.length,
    stdout: p.stdout.slice(-100).join("\n"),
  }
}

function getActiveRuns() {
  return [...processes.entries()]
    .map(([pid]) => getProcessStatus(pid)!)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20)
}


// ── HTTP Server ─────────────────────────────────────────────────────────

const server = Bun.serve({
  port: 3006,
  hostname: "0.0.0.0",

  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // ── Login page ───────────────────────────────────────────────────
    if (path === "/login" && req.method === "GET") {
      return new Response(loginPageHtml(), { headers: { "Content-Type": "text/html" } })
    }

    if (path === "/login" && req.method === "POST") {
      try {
        const body = await req.json() as { password?: string }
        if (!body.password || body.password !== PASSWORD) {
          return Response.json({ error: "Invalid password" }, { status: 401 })
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": `nh_session=${SESSION_TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
          },
        })
      } catch {
        return Response.json({ error: "Bad request" }, { status: 400 })
      }
    }

    if (path === "/logout" && req.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "nh_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        },
      })
    }

    // Public overview page — no auth required
    if (path === "/overview" && req.method === "GET") {
      return new Response(overviewPageHtml(), { headers: { "Content-Type": "text/html" } })
    }

    // Redirect legacy pages
    if (path === "/" && req.method === "GET") {
      return Response.redirect("/app", 302)
    }
    if (path === "/panel" && req.method === "GET") {
      return Response.redirect("/app", 302)
    }

    // Health — unauthenticated, CORS allowed (for homelab dashboard status checks)
    if (path === "/health") return Response.json(
      { status: "ok", service: "novel-harness-orchestrator" },
      { headers: { "Access-Control-Allow-Origin": "*" } },
    )

    // React app — static assets unauthenticated, pages require cookie/key auth
    const UI_DIST = resolve(import.meta.dir, "../../ui/dist")
    if (path.startsWith("/app")) {
      // Static assets (JS/CSS/SVG) — no auth needed
      if (path.startsWith("/app/assets/")) {
        const filePath = resolve(UI_DIST, path.replace("/app/", ""))
        const file = Bun.file(filePath)
        if (await file.exists()) {
          const ext = filePath.split(".").pop()
          const contentType = ext === "js" ? "application/javascript"
            : ext === "css" ? "text/css"
            : ext === "svg" ? "image/svg+xml"
            : "application/octet-stream"
          return new Response(file, { headers: { "Content-Type": contentType } })
        }
      }
      // HTML pages — require auth, redirect to /login if missing
      if (!isAuthed(req)) {
        return Response.redirect("/login", 302)
      }
      const indexFile = Bun.file(resolve(UI_DIST, "index.html"))
      if (await indexFile.exists()) {
        return new Response(indexFile, { headers: { "Content-Type": "text/html" } })
      }
      return new Response("React app not built. Run: cd ui && bun install && bunx vite build", { status: 503 })
    }

    // Everything else requires auth
    const authErr = checkAuth(req)
    if (authErr) return authErr

    // ── Process spawning ────────────────────────────────────────────
    if (path === "/api/run/novel" && req.method === "POST") {
      try {
        const body = await req.json() as { seed?: string }
        const pid = spawnNovel(body.seed)
        return Response.json({ ok: true, pid, seed: body.seed, startedAt: new Date().toISOString() })
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 })
      }
    }

    if (path === "/api/run/active" && req.method === "GET") {
      return Response.json(getActiveRuns())
    }

    const runStatusMatch = path.match(/^\/api\/run\/status\/(\d+)$/)
    if (runStatusMatch && req.method === "GET") {
      const pid = parseInt(runStatusMatch[1])
      const status = getProcessStatus(pid)
      if (!status) return Response.json({ error: "Not found" }, { status: 404 })
      return Response.json(status)
    }

    // ── Experiments ─────────────────────────────────────────────────

    if (path === "/api/experiments" && req.method === "GET") {
      try {
        const { getAllExperiments } = await import("../../data/db")
        const limit = parseInt(url.searchParams.get("limit") ?? "50")
        return Response.json(await getAllExperiments(limit))
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    const experimentDetailMatch = path.match(/^\/api\/experiments\/(\d+)$/)
    if (experimentDetailMatch && req.method === "GET") {
      try {
        const id = parseInt(experimentDetailMatch[1])
        const { getExperimentRuns, getExperimentScores, getExperimentCost, getExperimentLintSummary } = await import("../../data/db")
        const [runs, scores, cost, lint] = await Promise.all([
          getExperimentRuns(id), getExperimentScores(id), getExperimentCost(id), getExperimentLintSummary(id),
        ])
        // Get lineage
        const lineage = await (await import("./db")).default`
          SELECT el.*, te.description, te.target, te.dimension
          FROM experiment_lineage el
          JOIN tuning_experiments te ON te.id = el.parent_experiment_id
          WHERE el.experiment_id = ${id}
          ORDER BY el.created_at
        `
        return Response.json({ runs, scores, cost, lint, lineage })
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Experiment generations (prose + scores + lint)
    const experimentGensMatch = path.match(/^\/api\/experiments\/(\d+)\/generations$/)
    if (experimentGensMatch && req.method === "GET") {
      try {
        const id = parseInt(experimentGensMatch[1])
        const limit = parseInt(url.searchParams.get("limit") ?? "20")
        const offset = parseInt(url.searchParams.get("offset") ?? "0")
        const { getExperimentGenerations } = await import("../../data/db")
        return Response.json(await getExperimentGenerations(id, limit, offset))
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Experiment diff (git show for commit)
    const experimentDiffMatch = path.match(/^\/api\/experiments\/(\d+)\/diff$/)
    if (experimentDiffMatch && req.method === "GET") {
      try {
        const id = parseInt(experimentDiffMatch[1])
        const compareId = url.searchParams.get("compare")
        const [exp] = await (await import("./db")).default`
          SELECT commit_hash FROM tuning_experiments WHERE id = ${id}
        ` as any[]
        if (!exp?.commit_hash) return Response.json({ diff: null, reason: "no commit hash" })

        if (compareId) {
          const [other] = await (await import("./db")).default`
            SELECT commit_hash FROM tuning_experiments WHERE id = ${parseInt(compareId)}
          ` as any[]
          if (!other?.commit_hash) return Response.json({ diff: null, reason: "compare experiment has no commit hash" })
          const proc = Bun.spawn(["git", "diff", `${other.commit_hash}..${exp.commit_hash}`, "--", "src/agents/"], { stdout: "pipe", stderr: "pipe" })
          const diff = await new Response(proc.stdout).text()
          return Response.json({ diff, hashA: other.commit_hash, hashB: exp.commit_hash })
        } else {
          const proc = Bun.spawn(["git", "show", exp.commit_hash, "--stat", "--format=%H%n%s%n%ai"], { stdout: "pipe", stderr: "pipe" })
          const output = await new Response(proc.stdout).text()
          return Response.json({ diff: output, hash: exp.commit_hash })
        }
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Experiment markdown summary (for copy-to-clipboard)
    const experimentSummaryMatch = path.match(/^\/api\/experiments\/(\d+)\/summary$/)
    if (experimentSummaryMatch && req.method === "GET") {
      try {
        const id = parseInt(experimentSummaryMatch[1])
        const { getExperimentScores, getExperimentCost, getExperimentLintSummary } = await import("../../data/db")
        const [exp] = await (await import("./db")).default`
          SELECT id, experiment_type, description, conclusion, timestamp, commit_hash, target, dimension
          FROM tuning_experiments WHERE id = ${id}
        ` as any[]
        if (!exp) return Response.json({ error: "Not found" }, { status: 404 })

        const [scores, cost, lint] = await Promise.all([
          getExperimentScores(id), getExperimentCost(id), getExperimentLintSummary(id),
        ])

        // Build markdown table
        const variants = [...new Set(scores.map((s: any) => s.variantLabel))]
        const dimensions = [...new Set(scores.map((s: any) => s.dimension))]
        const totalCost = cost.reduce((s: number, c: any) => s + (c.totalCost ?? 0), 0)

        let md = `## Experiment #${exp.id}: ${exp.description}\n`
        md += `Commit: ${exp.commit_hash ?? "n/a"} | Cost: $${totalCost.toFixed(4)} | ${new Date(exp.timestamp).toLocaleDateString()}\n\n`

        if (variants.length > 0 && dimensions.length > 0) {
          md += `| Variant | ${dimensions.join(" | ")} |\n`
          md += `|${"-|".repeat(dimensions.length + 1)}\n`
          for (const v of variants) {
            const cells = dimensions.map(d => {
              const s = scores.find((x: any) => x.variantLabel === v && x.dimension === d)
              return s ? String(s.avg) : "n/a"
            })
            md += `| ${v} | ${cells.join(" | ")} |\n`
          }
        }

        // Lint summary
        const lintByVariant = new Map<string, number>()
        for (const l of lint as any[]) {
          lintByVariant.set(l.variantLabel, (lintByVariant.get(l.variantLabel) ?? 0) + l.count)
        }
        if (lintByVariant.size > 0) {
          md += `\nLint: ${[...lintByVariant.entries()].map(([v, c]) => `${v}: ${c}`).join(", ")}\n`
        }

        if (exp.conclusion) md += `\nConclusion: ${exp.conclusion}\n`

        return Response.json({ markdown: md })
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Model registry for experiment builder
    if (path === "/api/models" && req.method === "GET") {
      try {
        const { MODELS } = await import("../../models/registry")
        const { isModelHidden } = await import("../../models/hidden")
        const models = MODELS
          .filter(m => !isModelHidden(m.provider, m.id))
          .map(m => ({
            id: m.id, label: m.label, provider: m.provider,
            pricing: m.pricing, maxOutput: (m as any).maxOutput,
          }))
        return Response.json(models)
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }


    // ── Retrieval Config API ─────────────────────────────────────────
    if (path === "/api/retrieval-config/defaults" && req.method === "GET") {
      const { DEFAULT_CONFIG } = await import("../db/retrieval")
      return Response.json({ novelId: "defaults", ...DEFAULT_CONFIG })
    }

    const retrievalMatch = path.match(/^\/api\/retrieval-config\/([^/]+)$/)
    if (retrievalMatch && req.method === "GET") {
      const novelId = decodeURIComponent(retrievalMatch[1])
      const { getRetrievalConfig } = await import("../db/retrieval")
      const config = await getRetrievalConfig(novelId)
      return Response.json({ novelId, ...config })
    }

    if (retrievalMatch && req.method === "PUT") {
      const novelId = decodeURIComponent(retrievalMatch[1])
      const body = await req.json() as Record<string, any>
      const { saveRetrievalConfig } = await import("../db/retrieval")
      await saveRetrievalConfig(novelId, body)
      return Response.json({ ok: true })
    }

    // ── Deterministic Config API ──────────────────────────────────────
    if (path === "/api/deterministic-config/defaults" && req.method === "GET") {
      const { DEFAULT_DETERMINISTIC_CONFIG } = await import("../harness/deterministic")
      return Response.json({ novelId: "defaults", ...DEFAULT_DETERMINISTIC_CONFIG })
    }

    const detMatch = path.match(/^\/api\/deterministic-config\/([^/]+)$/)
    if (detMatch && req.method === "GET") {
      const novelId = decodeURIComponent(detMatch[1])
      const { getDeterministicConfig } = await import("../harness/deterministic")
      const config = await getDeterministicConfig(novelId)
      return Response.json({ novelId, ...config })
    }

    if (detMatch && req.method === "PUT") {
      const novelId = decodeURIComponent(detMatch[1])
      const body = await req.json() as Record<string, any>
      const { saveDeterministicConfig } = await import("../harness/deterministic")
      await saveDeterministicConfig(novelId, body)
      return Response.json({ ok: true })
    }

    // ── Context Templates API ──────────────────────────────────────
    if (path === "/api/context-templates" && req.method === "GET") {
      const { getAllContextTemplates } = await import("../db/context-templates")
      const templates = await getAllContextTemplates()
      return Response.json({ templates })
    }

    const ctxTplMatch = path.match(/^\/api\/context-templates\/([^/]+)$/)
    if (ctxTplMatch && req.method === "PUT") {
      const key = decodeURIComponent(ctxTplMatch[1])
      const body = await req.json() as { template: string }
      const { saveContextTemplate } = await import("../db/context-templates")
      await saveContextTemplate(key, body.template)
      return Response.json({ ok: true })
    }

    // ── Agent Generation Config API ──────────────────────────────────
    if (path === "/api/generation-config" && req.method === "GET") {
      const { getGenerationConfig, loadGenerationConfig } = await import("../../models/roles")
      await loadGenerationConfig()
      const agents = ["writer", "rewriter", "planning-plotter", "fact-extractor", "summary-extractor", "character-state", "relationship-timeline", "graph-linker"]
      const configs: Record<string, any> = {}
      for (const a of agents) {
        configs[a] = await getGenerationConfig(a)
      }
      return Response.json({ configs })
    }

    const genMatch = path.match(/^\/api\/generation-config\/([^/]+)$/)
    if (genMatch && req.method === "PUT") {
      const agentName = decodeURIComponent(genMatch[1])
      const body = await req.json() as { temperature?: number; maxTokens?: number }
      const { saveGenerationConfig } = await import("../../models/roles")
      await saveGenerationConfig(agentName, body)
      return Response.json({ ok: true })
    }

    // ── Embedding Templates API ──────────────────────────────────────
    if (path === "/api/embedding-templates" && req.method === "GET") {
      const { getAllEmbeddingTemplates } = await import("../db/embed")
      const templates = await getAllEmbeddingTemplates()
      return Response.json({ templates })
    }

    const embedMatch = path.match(/^\/api\/embedding-templates\/([^/]+)$/)
    if (embedMatch && req.method === "GET") {
      const sourceType = decodeURIComponent(embedMatch[1])
      const { getEmbeddingTemplate } = await import("../db/embed")
      const template = await getEmbeddingTemplate(sourceType)
      return Response.json({ sourceType, template })
    }

    if (embedMatch && req.method === "PUT") {
      const sourceType = decodeURIComponent(embedMatch[1])
      const body = await req.json() as { template: string }
      const { saveEmbeddingTemplate } = await import("../db/embed")
      await saveEmbeddingTemplate(sourceType, body.template)
      return Response.json({ ok: true })
    }

    // ── Docs API ────────────────────────────────────────────────────
    if (path === "/api/docs" && req.method === "GET") {
      try {
        const docsDir = resolve(import.meta.dir, "../../docs")
        const files = readdirSync(docsDir)
          .filter(f => f.endsWith(".md"))
          .map(f => {
            const filePath = resolve(docsDir, f)
            const stat = Bun.file(filePath)
            // Extract title from first heading or use filename
            const content = readFileSync(filePath, "utf-8")
            const titleMatch = content.match(/^#\s+(.+)/m)
            return {
              filename: f,
              title: titleMatch?.[1] ?? f.replace(/\.md$/, ""),
              size: stat.size,
            }
          })
          .sort((a, b) => {
            const pinned = ["todo.md", "decisions.md", "lessons-learned.md"]
            const ai = pinned.indexOf(a.filename)
            const bi = pinned.indexOf(b.filename)
            if (ai !== -1 && bi !== -1) return ai - bi
            if (ai !== -1) return -1
            if (bi !== -1) return 1
            return a.title.localeCompare(b.title)
          })
        return Response.json({ docs: files })
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    const docsMatch = path.match(/^\/api\/docs\/(.+)$/)
    if (docsMatch && req.method === "GET") {
      try {
        const filename = decodeURIComponent(docsMatch[1])
        // Prevent path traversal
        if (filename.includes("..") || filename.includes("/")) {
          return Response.json({ error: "Invalid filename" }, { status: 400 })
        }
        const filePath = resolve(import.meta.dir, "../../docs", filename)
        const file = Bun.file(filePath)
        if (!await file.exists()) return Response.json({ error: "Not found" }, { status: 404 })
        const content = await file.text()
        const titleMatch = content.match(/^#\s+(.+)/m)
        return Response.json({
          filename,
          title: titleMatch?.[1] ?? filename.replace(/\.md$/, ""),
          content,
        })
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // ── Preference evaluation API ──────────────────────────────────
    const prefEvalResponse = await handlePrefEvalRoute(req, url)
    if (prefEvalResponse) return prefEvalResponse

    // ── Fine-tuning data API ───────────────────────────────────────
    const finetuneResponse = await handleFinetuneRoute(req, url)
    if (finetuneResponse) return finetuneResponse

    // ── Novel step-through API ──────────────────────────────────────
    const novelResponse = await handleNovelRoute(req, url)
    if (novelResponse) return novelResponse

    return Response.json({ error: "Not found" }, { status: 404 })
  },
})

console.log(`Orchestrator running at http://localhost:${server.port}`)
console.log(`Novel UI: http://localhost:${server.port}/app?key=${API_KEY}`)
