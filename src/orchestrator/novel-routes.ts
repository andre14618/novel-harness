/**
 * Novel step-through API routes.
 *
 * All routes under /api/novel/*. Handles:
 * - Listing seeds and existing novels
 * - Starting/resuming novel runs (in-process, not spawned)
 * - Reading intermediate state (world bible, characters, outlines, drafts)
 * - Gate decisions (approve/reject/revise)
 * - SSE event streams for real-time updates
 */

import { readdirSync, existsSync } from "node:fs"
import { resolve, basename } from "node:path"
import { Database } from "bun:sqlite"
import { subscribeSSE } from "../events"
import * as gates from "../gates"
import { initDB, createNovel, getNovel } from "../db"
import { setAutoMode, setResolverMode } from "../cli"
import { runNovel } from "../state-machine"
import { initNovelRun } from "../logger"
import type { SeedInput } from "../types"

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"

// Track in-process novel runs
const activeRuns = new Map<string, { startedAt: string; error?: string }>()

/**
 * Open a per-novel SQLite DB read-only for content queries.
 * Returns null if the novel DB doesn't exist.
 */
function openNovelDB(novelId: string): Database | null {
  const dbPath = resolve(HARNESS_ROOT, `output/${novelId}/novel.db`)
  if (!existsSync(dbPath)) return null
  return new Database(dbPath, { readonly: true })
}

/**
 * Handle all /api/novel/* routes. Returns null if the path doesn't match.
 */
export async function handleNovelRoute(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname

  // ── Models config (available models + current agent assignments) ────
  if (path === "/api/novel/config" && req.method === "GET") {
    try {
      const { MODELS, PROVIDERS } = await import("../../models/registry")
      const { getAgentConfig, getAgentOverrides, AGENT_MODELS } = await import("../../models/roles")

      const models = MODELS.map(m => ({
        label: m.label,
        id: m.id,
        provider: m.provider,
        pricing: m.pricing,
      }))

      const providers = Object.keys(PROVIDERS)

      // Group agents by role for the UI
      const agentGroups: Record<string, { label: string; description: string; agents: string[] }> = {
        writers: { label: "Writers", description: "Creative prose generation", agents: ["writer", "rewriter", "prose-polish"] },
        planners: { label: "Planners", description: "World, characters, plot, chapter outlines", agents: ["world-builder", "character-agent", "plotter", "planning-plotter"] },
        extractors: { label: "Extractors", description: "Structured extraction from prose", agents: ["summary-extractor", "fact-extractor", "character-state"] },
        validators: { label: "Validators", description: "Continuity and quality checks", agents: ["continuity", "cross-chapter-continuity", "prose-quality"] },
        judges: { label: "Judges", description: "Benchmark scoring and pairwise comparison", agents: ["judge", "pairwise-judge", "benchmark-judge"] },
        benchmark: { label: "Benchmark", description: "Independent benchmark pipeline agents", agents: ["benchmark-writer"] },
        improvement: { label: "Improvement", description: "Autonomous prompt tuning daemon", agents: ["improver"] },
      }

      // Effective assignments (static + overrides merged)
      const assignments: Record<string, any> = {}
      for (const agentName of Object.keys(AGENT_MODELS)) {
        const effective = getAgentConfig(agentName)
        if (effective) {
          assignments[agentName] = {
            provider: effective.provider,
            model: effective.model,
            temperature: effective.temperature,
            maxTokens: effective.maxTokens,
          }
        }
      }

      return Response.json({
        models,
        providers,
        agentGroups,
        assignments,
        overrides: getAgentOverrides(),
      })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Set agent override ─────────────────────────────────────────────
  const agentConfigMatch = path.match(/^\/api\/novel\/config\/agent\/([^/]+)$/)
  if (agentConfigMatch && req.method === "PUT") {
    const agentName = decodeURIComponent(agentConfigMatch[1])
    try {
      const { MODELS, PROVIDERS } = await import("../../models/registry")
      const { AGENT_MODELS, setAgentOverride, getAgentConfig } = await import("../../models/roles")

      if (!AGENT_MODELS[agentName]) {
        return Response.json({ error: `Unknown agent: ${agentName}` }, { status: 404 })
      }

      const body = await req.json() as Record<string, any>
      const override: Record<string, any> = {}

      if (body.provider) {
        if (!PROVIDERS[body.provider as keyof typeof PROVIDERS]) {
          return Response.json({ error: `Unknown provider: ${body.provider}` }, { status: 400 })
        }
        override.provider = body.provider
      }

      if (body.model) {
        const provider = body.provider ?? AGENT_MODELS[agentName].provider
        const exists = MODELS.some(m => m.id === body.model && m.provider === provider)
        if (!exists) {
          return Response.json({ error: `Model ${body.model} not found for provider ${provider}` }, { status: 400 })
        }
        override.model = body.model
      }

      if (body.temperature !== undefined) {
        override.temperature = Math.max(0, Math.min(2, parseFloat(body.temperature)))
      }

      if (body.maxTokens !== undefined) {
        override.maxTokens = Math.max(1, Math.min(131072, parseInt(body.maxTokens)))
      }

      setAgentOverride(agentName, override)
      const effective = getAgentConfig(agentName)

      return Response.json({ ok: true, agentName, effective })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 400 })
    }
  }

  // ── Persist overrides to roles.ts ────────────────────────────────
  if (path === "/api/novel/config/persist" && req.method === "POST") {
    try {
      const { persistOverrides } = await import("../../models/roles")
      const result = await persistOverrides()
      return Response.json({ ok: true, ...result })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Clear agent override ───────────────────────────────────────────
  if (agentConfigMatch && req.method === "DELETE") {
    const agentName = decodeURIComponent(agentConfigMatch[1])
    try {
      const { AGENT_MODELS, clearAgentOverride, getAgentConfig } = await import("../../models/roles")

      if (!AGENT_MODELS[agentName]) {
        return Response.json({ error: `Unknown agent: ${agentName}` }, { status: 404 })
      }

      clearAgentOverride(agentName)
      const effective = getAgentConfig(agentName)

      return Response.json({ ok: true, agentName, effective })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 400 })
    }
  }

  // ── List seeds ─────────────────────────────────────────────────────
  if (path === "/api/novel/seeds" && req.method === "GET") {
    try {
      const seedDir = resolve(HARNESS_ROOT, "src/seeds")
      const seeds = readdirSync(seedDir)
        .filter(f => f.endsWith(".json"))
        .map(f => basename(f, ".json"))
      return Response.json({ seeds })
    } catch (err) {
      return Response.json({ error: "Failed to read seeds directory" }, { status: 500 })
    }
  }

  // ── List existing novels ───────────────────────────────────────────
  if (path === "/api/novel/list" && req.method === "GET") {
    try {
      const outputDir = resolve(HARNESS_ROOT, "output")
      if (!existsSync(outputDir)) return Response.json({ novels: [] })

      const dirs = readdirSync(outputDir).filter(d =>
        d.startsWith("novel-") && existsSync(resolve(outputDir, d, "novel.db"))
      )

      const novels = dirs.map(d => {
        const db = new Database(resolve(outputDir, d, "novel.db"), { readonly: true })
        try {
          const row = db.prepare("SELECT id, phase, current_chapter, total_chapters, created_at FROM novels LIMIT 1").get() as any
          if (!row) return null
          const pending = gates.getPending(row.id)
          return {
            id: row.id,
            phase: row.phase,
            currentChapter: row.current_chapter,
            totalChapters: row.total_chapters,
            createdAt: row.created_at,
            active: activeRuns.has(row.id),
            pendingGate: pending ? { gateId: pending.gateId, title: pending.title } : null,
          }
        } finally {
          db.close()
        }
      }).filter(Boolean)

      return Response.json({ novels })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Start novel ────────────────────────────────────────────────────
  if (path === "/api/novel/start" && req.method === "POST") {
    try {
      const body = await req.json() as { seed?: string; customSeed?: SeedInput; mode?: "interactive" | "auto" }
      const mode = body.mode ?? "interactive"

      // Load seed
      let seed: SeedInput
      if (body.customSeed) {
        seed = body.customSeed
      } else {
        const seedName = body.seed ?? "epic-fantasy"
        const seedPath = resolve(HARNESS_ROOT, `src/seeds/${seedName}.json`)
        if (!existsSync(seedPath)) {
          return Response.json({ error: `Seed not found: ${seedName}` }, { status: 400 })
        }
        seed = await Bun.file(seedPath).json()
      }

      const novelId = `novel-${Date.now()}`

      // Configure for web mode
      setAutoMode(mode === "auto")
      setResolverMode(mode === "auto" ? "auto" : "web")

      // Init DB and create novel
      initDB(novelId)
      createNovel(novelId, seed)

      // Register in central DB
      const runId = await initNovelRun(novelId)

      activeRuns.set(novelId, { startedAt: new Date().toISOString() })

      // Start pipeline as floating promise (fire-and-forget)
      runNovel(novelId)
        .then(() => {
          const run = activeRuns.get(novelId)
          if (run) activeRuns.delete(novelId)
          console.log(`[novel-api] Novel ${novelId} completed`)
        })
        .catch(err => {
          const run = activeRuns.get(novelId)
          if (run) run.error = String(err)
          console.error(`[novel-api] Novel ${novelId} failed:`, err)
        })

      return Response.json({ ok: true, novelId, runId, mode })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 400 })
    }
  }

  // ── Resume novel ───────────────────────────────────────────────────
  if (path === "/api/novel/resume" && req.method === "POST") {
    const body = await req.json() as { novelId: string; mode?: "interactive" | "auto" }
    const { novelId } = body
    const mode = body.mode ?? "interactive"

    if (activeRuns.has(novelId)) {
      return Response.json({ error: "Novel is already running" }, { status: 409 })
    }

    setAutoMode(mode === "auto")
    setResolverMode(mode === "auto" ? "auto" : "web")

    initDB(novelId)
    try {
      getNovel(novelId)
    } catch {
      return Response.json({ error: `Novel ${novelId} not found` }, { status: 404 })
    }

    activeRuns.set(novelId, { startedAt: new Date().toISOString() })

    runNovel(novelId)
      .then(() => { activeRuns.delete(novelId) })
      .catch(err => {
        const run = activeRuns.get(novelId)
        if (run) run.error = String(err)
      })

    return Response.json({ ok: true, novelId, mode })
  }

  // ── Novel state ────────────────────────────────────────────────────
  const stateMatch = path.match(/^\/api\/novel\/([^/]+)\/state$/)
  if (stateMatch && req.method === "GET") {
    const novelId = stateMatch[1]
    const db = openNovelDB(novelId)
    if (!db) return Response.json({ error: "Novel not found" }, { status: 404 })

    try {
      const row = db.prepare("SELECT * FROM novels WHERE id = ?").get(novelId) as any
      if (!row) return Response.json({ error: "Novel not found" }, { status: 404 })

      const pending = gates.getPending(novelId)

      return Response.json({
        id: row.id,
        phase: row.phase,
        currentChapter: row.current_chapter,
        totalChapters: row.total_chapters,
        createdAt: row.created_at,
        active: activeRuns.has(novelId),
        activeError: activeRuns.get(novelId)?.error,
        pendingGate: pending ? { gateId: pending.gateId, title: pending.title, content: pending.content } : null,
      })
    } finally {
      db.close()
    }
  }

  // ── World bible ────────────────────────────────────────────────────
  const worldMatch = path.match(/^\/api\/novel\/([^/]+)\/world-bible$/)
  if (worldMatch && req.method === "GET") {
    const novelId = worldMatch[1]
    const db = openNovelDB(novelId)
    if (!db) return Response.json({ error: "Novel not found" }, { status: 404 })

    try {
      const row = db.prepare("SELECT content_json FROM world_bibles WHERE novel_id = ?").get(novelId) as any
      if (!row) return Response.json(null)
      return Response.json(JSON.parse(row.content_json))
    } finally {
      db.close()
    }
  }

  // ── Characters ─────────────────────────────────────────────────────
  const charsMatch = path.match(/^\/api\/novel\/([^/]+)\/characters$/)
  if (charsMatch && req.method === "GET") {
    const novelId = charsMatch[1]
    const db = openNovelDB(novelId)
    if (!db) return Response.json({ error: "Novel not found" }, { status: 404 })

    try {
      const rows = db.prepare("SELECT profile_json FROM characters WHERE novel_id = ?").all(novelId) as any[]
      return Response.json(rows.map(r => JSON.parse(r.profile_json)))
    } finally {
      db.close()
    }
  }

  // ── Story spine ────────────────────────────────────────────────────
  const spineMatch = path.match(/^\/api\/novel\/([^/]+)\/story-spine$/)
  if (spineMatch && req.method === "GET") {
    const novelId = spineMatch[1]
    const db = openNovelDB(novelId)
    if (!db) return Response.json({ error: "Novel not found" }, { status: 404 })

    try {
      const row = db.prepare("SELECT content_json FROM story_spines WHERE novel_id = ?").get(novelId) as any
      if (!row) return Response.json(null)
      return Response.json(JSON.parse(row.content_json))
    } finally {
      db.close()
    }
  }

  // ── Chapter outlines ───────────────────────────────────────────────
  const outlinesMatch = path.match(/^\/api\/novel\/([^/]+)\/outlines$/)
  if (outlinesMatch && req.method === "GET") {
    const novelId = outlinesMatch[1]
    const db = openNovelDB(novelId)
    if (!db) return Response.json({ error: "Novel not found" }, { status: 404 })

    try {
      const rows = db.prepare("SELECT outline_json FROM chapter_outlines WHERE novel_id = ? ORDER BY chapter_number").all(novelId) as any[]
      return Response.json(rows.map(r => JSON.parse(r.outline_json)))
    } finally {
      db.close()
    }
  }

  // ── Chapter draft ──────────────────────────────────────────────────
  const draftMatch = path.match(/^\/api\/novel\/([^/]+)\/chapter\/(\d+)\/draft$/)
  if (draftMatch && req.method === "GET") {
    const novelId = draftMatch[1]
    const ch = parseInt(draftMatch[2])
    const db = openNovelDB(novelId)
    if (!db) return Response.json({ error: "Novel not found" }, { status: 404 })

    try {
      const row = db.prepare(
        "SELECT prose, word_count, version, status FROM chapter_drafts WHERE novel_id = ? AND chapter_number = ? ORDER BY version DESC LIMIT 1"
      ).get(novelId, ch) as any
      if (!row) return Response.json(null)
      return Response.json({ prose: row.prose, wordCount: row.word_count, version: row.version, status: row.status })
    } finally {
      db.close()
    }
  }

  // ── Issues ─────────────────────────────────────────────────────────
  const issuesMatch = path.match(/^\/api\/novel\/([^/]+)\/issues$/)
  if (issuesMatch && req.method === "GET") {
    const novelId = issuesMatch[1]
    const db = openNovelDB(novelId)
    if (!db) return Response.json({ error: "Novel not found" }, { status: 404 })

    try {
      const rows = db.prepare("SELECT * FROM issues WHERE novel_id = ? AND status = 'open' ORDER BY chapter, created_at").all(novelId) as any[]
      return Response.json(rows)
    } finally {
      db.close()
    }
  }

  // ── Gate decide ────────────────────────────────────────────────────
  const gateMatch = path.match(/^\/api\/novel\/([^/]+)\/gate\/([^/]+)\/decide$/)
  if (gateMatch && req.method === "POST") {
    const novelId = gateMatch[1]
    const gateId = decodeURIComponent(gateMatch[2])

    const body = await req.json() as { action: "approve" | "revise" | "reject"; notes?: string[] }
    if (!["approve", "revise", "reject"].includes(body.action)) {
      return Response.json({ error: "Invalid action" }, { status: 400 })
    }

    const resolved = gates.resolve(novelId, gateId, { action: body.action, notes: body.notes })
    if (!resolved) {
      return Response.json({ error: "No pending gate with that ID" }, { status: 404 })
    }

    return Response.json({ ok: true, gateId, action: body.action })
  }

  // ── SSE event stream ───────────────────────────────────────────────
  const eventsMatch = path.match(/^\/api\/novel\/([^/]+)\/events$/)
  if (eventsMatch && req.method === "GET") {
    const novelId = eventsMatch[1]
    const stream = subscribeSSE(novelId)

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  }

  // ── Delete novel ────────────────────────────────────────────────────
  const deleteMatch = path.match(/^\/api\/novel\/([^/]+)$/)
  if (deleteMatch && req.method === "DELETE") {
    const novelId = deleteMatch[1]
    const novelDir = resolve(HARNESS_ROOT, `output/${novelId}`)

    if (!existsSync(novelDir)) {
      return Response.json({ error: "Novel not found" }, { status: 404 })
    }

    if (activeRuns.has(novelId)) {
      return Response.json({ error: "Cannot delete a running novel" }, { status: 409 })
    }

    // Move to archive directory instead of hard delete
    const archiveDir = resolve(HARNESS_ROOT, "output/.archive")
    if (!existsSync(archiveDir)) {
      const { mkdirSync } = await import("node:fs")
      mkdirSync(archiveDir, { recursive: true })
    }

    const { renameSync } = await import("node:fs")
    renameSync(novelDir, resolve(archiveDir, novelId))

    return Response.json({ ok: true, novelId, archived: true })
  }

  // ── Pending gates (for polling) ────────────────────────────────────
  if (path === "/api/novel/gates" && req.method === "GET") {
    return Response.json({ gates: gates.listPending() })
  }

  return null
}
