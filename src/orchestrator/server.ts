/**
 * Novel Harness Orchestrator — single service.
 *
 * Runs on LXC 307 (port 3006). Combines:
 * - Batch API polling (every 30 min)
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
import { handleCanonProposalRoute } from "./canon-proposal-routes"
import { handleProposalEnvelopeRoute } from "./proposal-envelope-routes"
import { handlePlanningSnapshotRoute } from "./planning-snapshot-routes"
import { overviewPageHtml } from "./overview-page"

await migrate()

// ── V1 → V2 debug-injection bridge ───────────────────────────────────────────
// Translates legacy DEBUG_FORCE_PLAN_CHECK / DEBUG_FORCE_REVISER env vars into
// equivalent V2 transport-interceptor rules. See `src/debug/v1-bridge.ts`
// for scope (forceValidation deliberately stays at V1 until D4b) and
// `docs/plans/2026-04-28-drafting-deepenings.md` D4a for the architecture
// rationale (one interception site, not two). Best-effort: a failure here
// must never block boot.
;(() => {
  try {
    const { applyV1EnvVarsAsV2Rules } = require("../debug/v1-bridge") as typeof import("../debug/v1-bridge")
    const report = applyV1EnvVarsAsV2Rules()
    if (report.translated > 0) {
      console.log(
        `[startup][v1-bridge] translated ${report.translated} env-var rule(s)` +
        (report.enabledMasterGate ? " (auto-enabled DEBUG_ENABLE_INJECTION)" : ""),
      )
      for (const r of report.reasons) console.log(`[startup][v1-bridge]   • ${r}`)
    }
  } catch (err) {
    console.warn(`[startup][v1-bridge] bridge failed: ${err instanceof Error ? err.message : err}`)
  }
})()

// ── Startup orphan sweep ─────────────────────────────────────────────────────
// Surface any plan-assist gate rows that are still pending (decided_at IS NULL)
// from before this process started. These are irrecoverable in this session —
// the in-memory Promise that was waiting for a decision died with the previous
// process. We log them so operators know to resume those novels.
//
// We do NOT auto-mark them as orphaned here: the operator may choose to let the
// novel run resume naturally (which will re-open the gate), or call
// POST /api/novel/:id/plan-assist/:chapter/mark-orphaned to close them out.
;(async () => {
  try {
    const { listOrphanedExhaustions } = await import("../db/chapter-exhaustions")
    const orphans = await listOrphanedExhaustions(60_000)
    if (orphans.length === 0) return

    // Aggregate by novel rather than emitting one log line per gate. With
    // many novels accumulating gates over weeks, the per-row form becomes
    // a wall of text on every restart; a per-novel summary with counts +
    // oldest age is more operator-actionable.
    const byNovel = new Map<string, { count: number; oldestMs: number; chapters: Set<number> }>()
    const nowMs = Date.now()
    for (const row of orphans) {
      const ageMs = nowMs - new Date(row.firedAt).getTime()
      const cur = byNovel.get(row.novelId)
      if (cur) {
        cur.count++
        cur.chapters.add(row.chapter)
        if (ageMs > cur.oldestMs) cur.oldestMs = ageMs
      } else {
        byNovel.set(row.novelId, { count: 1, oldestMs: ageMs, chapters: new Set([row.chapter]) })
      }
    }

    const novels = Array.from(byNovel.entries()).sort((a, b) => b[1].oldestMs - a[1].oldestMs)
    const oldestDays = Math.round(novels[0]![1].oldestMs / (1000 * 60 * 60 * 24))
    console.warn(
      `[startup] Orphan plan-assist gates: ${orphans.length} across ${novels.length} novel(s) (oldest ${oldestDays}d). Resume any novel below to clean its gates.`
    )
    for (const [novelId, stats] of novels) {
      const days = Math.round(stats.oldestMs / (1000 * 60 * 60 * 24))
      const chs = Array.from(stats.chapters).sort((a, b) => a - b).join(",")
      console.warn(`[startup]   ${novelId}: ${stats.count} gate(s) ch=${chs} oldest=${days}d`)
    }
  } catch (err) {
    // Non-fatal: orphan detection is best-effort at startup
    console.warn(`[startup] Orphan sweep failed: ${err instanceof Error ? err.message : err}`)
  }
})()

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

// Machine clients: `x-api-key` header. Browser sessions: nh_session cookie
// from /login. The previous `?key=...` query-param fallback leaked the API
// key into browser history, logs, and any URL copy/paste, so it's gone.
function checkAuth(req: Request): Response | null {
  const apiKey = req.headers.get("x-api-key")
  if (apiKey === API_KEY) return null
  const cookie = parseCookies(req).nh_session
  if (cookie === SESSION_TOKEN) return null
  return Response.json({ error: "Unauthorized" }, { status: 401 })
}

function isAuthed(req: Request): boolean {
  const apiKey = req.headers.get("x-api-key")
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
  stderr: string[]
  exitCode: number | null
}

const processes = new Map<number, TrackedProcess>()
const MAX_TRACKED = 20

// Bun types proc.stdout/stderr as `number | ReadableStream | undefined`
// depending on how the stream was requested. When "pipe" is used the runtime
// hands back a real ReadableStream, but the static type union still includes
// `number`, so narrow before calling getReader().
function pipeToBuffer(stream: unknown, buffer: string[], maxLines = 300): void {
  if (!stream || typeof stream === "number" || !(stream instanceof ReadableStream)) return
  const reader = (stream as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  ;(async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value).split("\n")
        for (const line of lines) {
          if (line.trim()) buffer.push(line)
        }
        if (buffer.length > maxLines) buffer.splice(0, buffer.length - maxLines)
      }
    } catch {}
  })()
}

function trackProcess(proc: ReturnType<typeof Bun.spawn>, label: string): number {
  const pid = proc.pid
  const tracked: TrackedProcess = {
    proc, type: "novel", label,
    startedAt: new Date().toISOString(),
    stdout: [],
    stderr: [],
    exitCode: null,
  }
  processes.set(pid, tracked)

  pipeToBuffer(proc.stdout, tracked.stdout)
  pipeToBuffer(proc.stderr, tracked.stderr)

  proc.exited.then(code => { tracked.exitCode = code })

  if (processes.size > MAX_TRACKED) {
    for (const [oldPid, p] of processes) {
      if (p.exitCode !== null) { processes.delete(oldPid); break }
    }
  }

  return pid
}

const SEED_NAME = /^[a-z0-9][a-z0-9_-]*$/i

function spawnNovel(seed?: string): number {
  const args = ["bun", "src/index.ts", "--auto"]
  if (seed) {
    // Reject anything that isn't a plain seed-name token before it ever
    // reaches the filesystem, then confirm the seed file exists.
    if (!SEED_NAME.test(seed)) {
      throw new Error(`Invalid seed name: ${seed}`)
    }
    const seedPath = resolve(HARNESS_ROOT, "src/seeds", `${seed}.json`)
    if (!existsSync(seedPath)) {
      throw new Error(`Unknown seed: ${seed}`)
    }
    args.push("--seed", seed)
  }

  const proc = Bun.spawn(args, {
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
    stderrLines: p.stderr.length,
    stderr: p.stderr.slice(-50).join("\n"),
  }
}

function getActiveRuns() {
  return [...processes.entries()]
    .map(([pid]) => getProcessStatus(pid)!)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20)
}


function loginPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Novel Harness — Sign in</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: system-ui, sans-serif; background: #0e1117; color: #e6edf3;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0 }
  form { background: #161b22; padding: 32px; border-radius: 8px; border: 1px solid #30363d;
         min-width: 320px; display: flex; flex-direction: column; gap: 12px }
  h1 { font-size: 18px; margin: 0 0 8px 0 }
  input { background: #0d1117; color: #e6edf3; border: 1px solid #30363d;
          padding: 8px 10px; border-radius: 6px; font: inherit }
  button { background: #238636; color: white; border: 0; padding: 9px 16px;
           border-radius: 6px; cursor: pointer; font: inherit }
  button:disabled { opacity: 0.6; cursor: default }
  .err { color: #f85149; font-size: 13px; min-height: 1em }
</style>
</head>
<body>
<form id="f">
  <h1>Novel Harness</h1>
  <input id="pw" type="password" autocomplete="current-password" placeholder="Password" autofocus required />
  <button id="b" type="submit">Sign in</button>
  <div class="err" id="e"></div>
</form>
<script>
  const f = document.getElementById("f");
  const pw = document.getElementById("pw");
  const b = document.getElementById("b");
  const e = document.getElementById("e");
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    b.disabled = true; e.textContent = "";
    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw.value }),
      });
      if (res.ok) { location.href = "/app"; return; }
      const j = await res.json().catch(() => ({}));
      e.textContent = j.error || "Sign in failed";
    } catch (err) {
      e.textContent = String(err);
    } finally {
      b.disabled = false;
    }
  });
</script>
</body>
</html>`
}

// ── HTTP Server ─────────────────────────────────────────────────────────

const server = Bun.serve({
  port: 3006,
  hostname: "0.0.0.0",
  // Disable the Bun default idleTimeout for SSE long-polling. Without
  // this, connections drop ~10s into silent periods (e.g., concept-phase
  // LLM calls) even with keepalive frames. Per Codex review
  // a2d16769d75b1d9cc Q4 — the structural fix vs the keepalive workaround.
  idleTimeout: 0,

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
    }

    // Public JSON assets bundled into ui/public (copied to ui/dist at build time)
    if (path.endsWith(".json") && !path.startsWith("/api/")) {
      const jsonFile = Bun.file(resolve(UI_DIST, path.replace(/^\//, "")))
      if (await jsonFile.exists()) {
        return new Response(jsonFile, { headers: { "Content-Type": "application/json" } })
      }
    }

    if (path.startsWith("/app")) {
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
        const { getAllExperiments } = await import("../db/ops")
        const limit = parseInt(url.searchParams.get("limit") ?? "50")
        return Response.json(await getAllExperiments(limit))
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // ── Pairwise adjudication (arm-b-direct-pairwise) ──────────────────
    // Per `docs/charters/arm-b-direct-pairwise.md`. Serves the blinded
    // packet bundle + label read/write + ingest verdict to the React UI.
    // Arm identity stays server-side (mapping.json is never exposed to
    // the client — only resolved to Version-1 / Version-2 prose).

    const pairwiseBundleMatch = path.match(/^\/api\/pairwise\/([a-zA-Z0-9_-]+)\/(state|label|ingest)$/)
    if (pairwiseBundleMatch) {
      const bundleName = pairwiseBundleMatch[1]
      const action = pairwiseBundleMatch[2]
      const bundleDir = resolve(HARNESS_ROOT, "output/evals/pairwise", bundleName)
      const packetsPath = resolve(bundleDir, "packets.md")
      const mappingPath = resolve(bundleDir, "mapping.json")
      const labelsPath = resolve(bundleDir, "labels.tsv")

      try {
        if (action === "state" && req.method === "GET") {
          // Parse packets.md into {packet_id, version_1_prose, version_2_prose, is_retest_or_calibration_hint}.
          // The hint is false for every packet — UI never distinguishes
          // primary / retest / calibration. That blindness is load-bearing.
          const packetsMd = await Bun.file(packetsPath).text()
          const sections = packetsMd.split(/^### Packet /m).slice(1)
          const packets = sections.map(s => {
            const idMatch = s.match(/^([a-f0-9]{12})/)
            const packetId = idMatch ? idMatch[1] : ""
            // Split "**Version 1:**\n\n...\n\n---\n\n**Version 2:**\n\n...\n\n---"
            const v1Match = s.match(/\*\*Version 1:\*\*\s*\n\n([\s\S]*?)\n\n---\n\n\*\*Version 2:\*\*/)
            const v2Match = s.match(/\*\*Version 2:\*\*\s*\n\n([\s\S]*?)\n\n---\s*$/)
            return {
              packet_id: packetId,
              version_1_prose: v1Match ? v1Match[1].trim() : "",
              version_2_prose: v2Match ? v2Match[1].trim() : "",
            }
          }).filter(p => p.packet_id)

          // Load current labels (may not exist yet if adjudicator hasn't touched it)
          const labelsFile = Bun.file(labelsPath)
          const labels: Record<string, { label: string; notes: string }> = {}
          if (await labelsFile.exists()) {
            const text = await labelsFile.text()
            const lines = text.split("\n").slice(1)  // skip header
            for (const line of lines) {
              if (!line.trim()) continue
              const [pid, label, notes] = line.split("\t")
              if (pid) labels[pid.trim()] = { label: (label ?? "").trim(), notes: (notes ?? "").trim() }
            }
          }

          return Response.json({ bundle: bundleName, packets, labels })
        }

        if (action === "label" && req.method === "PUT") {
          const body = await req.json() as { packet_id: string; label: string; notes?: string }
          if (!body.packet_id) return Response.json({ error: "packet_id required" }, { status: 400 })
          // Load current labels.tsv, update or insert the row, write back
          const file = Bun.file(labelsPath)
          const text = (await file.exists()) ? await file.text() : "packet_id\tlabel\tnotes\n"
          const lines = text.split("\n")
          const header = lines[0]
          const rows: Record<string, string> = {}
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i]
            if (!line.trim()) continue
            const pid = line.split("\t")[0]?.trim()
            if (pid) rows[pid] = line
          }
          rows[body.packet_id] = `${body.packet_id}\t${body.label ?? ""}\t${body.notes ?? ""}`
          const out = [header, ...Object.values(rows)].join("\n") + "\n"
          await Bun.write(labelsPath, out)
          return Response.json({ ok: true })
        }

        if (action === "ingest" && req.method === "POST") {
          // Shell out to the ingest CLI — keep the verdict logic in one place.
          // `process.execPath` resolves to the running Bun binary; under
          // systemd the default PATH doesn't include `bun` so passing the
          // literal string fails with "Executable not found".
          const proc = Bun.spawn(
            [process.execPath, "scripts/evals/arm-b-pairwise.ts", "--ingest", "--bundle", bundleDir],
            { cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe" },
          )
          const stdout = await new Response(proc.stdout).text()
          const stderr = await new Response(proc.stderr).text()
          await proc.exited
          return Response.json({
            exit_code: proc.exitCode ?? -1,
            stdout,
            stderr,
          })
        }
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    }

    const experimentDetailMatch = path.match(/^\/api\/experiments\/(\d+)$/)
    if (experimentDetailMatch && req.method === "GET") {
      try {
        const id = parseInt(experimentDetailMatch[1])
        const { getExperimentRuns, getExperimentScores, getExperimentCost, getExperimentLintSummary } = await import("../db/ops")
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
        const { getExperimentGenerations } = await import("../db/ops")
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
        const { getExperimentScores, getExperimentCost, getExperimentLintSummary } = await import("../db/ops")
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
        const { MODELS } = await import("../models/registry")
        const { isModelHidden } = await import("../models/hidden")
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


    // Experiment families — charter-linked rollups over tuning_experiments
    if (path === "/api/experiment-families" && req.method === "GET") {
      try {
        const { experimentFamilies } = await import("../harness")
        const rows = await experimentFamilies.listFamilies()
        return Response.json(rows)
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    const famMatch = path.match(/^\/api\/experiment-families\/([^/]+)$/)
    if (famMatch && req.method === "GET") {
      try {
        const { experimentFamilies } = await import("../harness")
        const fam = await experimentFamilies.getFamily(decodeURIComponent(famMatch[1]))
        if (!fam) return Response.json({ error: "not found" }, { status: 404 })
        return Response.json(fam)
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Charter browser — frontmatter-parsed views over docs/charters/*.md
    if (path === "/api/charters" && req.method === "GET") {
      try {
        const { charters } = await import("../harness")
        const list = await charters.listCharters()
        return Response.json(list)
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    const charterMatch = path.match(/^\/api\/charters\/([a-zA-Z0-9_-]+)$/)
    if (charterMatch && req.method === "GET") {
      try {
        const { charters } = await import("../harness")
        const c = await charters.getCharter(charterMatch[1])
        if (!c) return Response.json({ error: "not found" }, { status: 404 })
        return Response.json(c)
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Adapter registry — deployed slate + provenance for FinetunePage
    if (path === "/api/adapters" && req.method === "GET") {
      try {
        const { adapters } = await import("../harness")
        const rows = await adapters.listAdapters()
        return Response.json(rows)
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
      const { getGenerationConfig, loadGenerationConfig } = await import("../models/roles")
      await loadGenerationConfig()
      const agents = ["writer", "planning-plotter"]
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
      const { saveGenerationConfig } = await import("../models/roles")
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
        const showHidden = url.searchParams.get("showHidden") === "true"
        const docsDir = resolve(import.meta.dir, "../../docs")
        const files = readdirSync(docsDir)
          .filter(f => f.endsWith(".md"))
          .map(f => {
            const filePath = resolve(docsDir, f)
            const stat = Bun.file(filePath)
            const content = readFileSync(filePath, "utf-8")
            const titleMatch = content.match(/^#\s+(.+)/m)
            // Parse YAML frontmatter for hidden flag
            const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
            const hidden = fmMatch ? /^hidden:\s*true\s*$/m.test(fmMatch[1]!) : false
            return {
              filename: f,
              title: titleMatch?.[1] ?? f.replace(/\.md$/, ""),
              size: stat.size,
              hidden,
            }
          })
          .filter(d => showHidden || !d.hidden)
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

    // Toggle the `hidden:` frontmatter flag on a doc. Behind the authed
    // surface (the `checkAuth` gate above gates every route past /api/run).
    const docsHiddenMatch = path.match(/^\/api\/docs\/(.+)\/hidden$/)
    if (docsHiddenMatch && req.method === "POST") {
      try {
        const filename = decodeURIComponent(docsHiddenMatch[1]!)
        if (filename.includes("..") || filename.includes("/")) {
          return Response.json({ error: "Invalid filename" }, { status: 400 })
        }
        const body = await req.json() as { hidden?: boolean }
        const desired = body.hidden !== false   // default to hidden=true if omitted
        const filePath = resolve(import.meta.dir, "../../docs", filename)
        const file = Bun.file(filePath)
        if (!await file.exists()) return Response.json({ error: "Not found" }, { status: 404 })
        let content = await file.text()

        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
        if (fmMatch) {
          const fm = fmMatch[1]!
          let newFm: string
          if (/^hidden:/m.test(fm)) {
            newFm = fm.replace(/^hidden:.*$/m, `hidden: ${desired}`)
          } else {
            newFm = fm + `\nhidden: ${desired}`
          }
          content = content.replace(fmMatch[0], `---\n${newFm}\n---`)
        } else {
          content = `---\nhidden: ${desired}\n---\n\n` + content
        }
        await Bun.write(filePath, content)
        return Response.json({ filename, hidden: desired })
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

    // ── Canon Proposal Review API (Phase 2A — collaborative proposal workflow) ──
    const canonProposalResponse = await handleCanonProposalRoute(req, url)
    if (canonProposalResponse) return canonProposalResponse

    // ── Proposal Envelope Resolve API (Phase 3 commit 2 — collaborative proposal workflow) ──
    const proposalEnvelopeResponse = await handleProposalEnvelopeRoute(req, url)
    if (proposalEnvelopeResponse) return proposalEnvelopeResponse

    // ── Planning Snapshot API (Phase 4 commit 3 — collaborative proposal workflow) ──
    const planningSnapshotResponse = await handlePlanningSnapshotRoute(req, url)
    if (planningSnapshotResponse) return planningSnapshotResponse

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
console.log(`Novel UI: http://localhost:${server.port}/app  (sign in at /login)`)
