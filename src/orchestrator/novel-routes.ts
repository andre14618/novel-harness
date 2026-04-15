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

import { readdirSync, readFileSync, existsSync } from "node:fs"
import { resolve, basename } from "node:path"
import { subscribeSSE } from "../events"
import * as gates from "../gates"
import { initDB, createNovel, getNovel } from "../db"
import { setAutoMode, setResolverMode } from "../cli"
import { runNovel } from "../state-machine"
import { initNovelRun } from "../logger"
import type { SeedInput } from "../types"
import db from "../db/connection"

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"

// Track in-process novel runs
const activeRuns = new Map<string, { startedAt: string; error?: string }>()
// Preserve the last error for a novel after its run has exited, so the UI
// can surface it. Cleared when a new run starts.
const lastRunErrors = new Map<string, { error: string; at: string }>()

/**
 * Handle all /api/novel/* routes. Returns null if the path doesn't match.
 */
export async function handleNovelRoute(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname

  // ── Full model registry (for Models page) ───────────────────────────
  if (path === "/api/models/registry" && req.method === "GET") {
    try {
      const { MODELS, PROVIDERS } = await import("../../models/registry")
      const { getHiddenModels, isModelHidden } = await import("../../models/hidden")
      const providers = Object.fromEntries(
        Object.entries(PROVIDERS).map(([name, p]) => [name, {
          tier: p.tier,
          cache: p.cache ?? null,
          batchApi: p.batchApi ?? null,
        }])
      )
      const models = MODELS.map(m => ({
        id: m.id,
        label: m.label,
        provider: m.provider,
        params: m.params,
        pricing: m.pricing,
        thinking: m.thinking ?? null,
        observedTps: m.observedTps ?? null,
        maxContext: m.maxContext ?? null,
        maxOutput: m.maxOutput ?? null,
        rateLimit: m.rateLimit ?? null,
        providerStatus: m.providerStatus ?? null,
        notes: m.notes ?? null,
        hidden: isModelHidden(m.provider, m.id),
      }))
      return Response.json({ providers, models, hiddenModels: getHiddenModels() })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Toggle model hidden state ──────────────────────────────────────
  if (path === "/api/models/hidden" && req.method === "POST") {
    try {
      const { setModelHidden } = await import("../../models/hidden")
      const { provider, modelId, hidden } = await req.json() as { provider: string; modelId: string; hidden: boolean }
      await setModelHidden(provider, modelId, hidden)
      return Response.json({ ok: true })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 400 })
    }
  }

  // ── Models config (available models + current agent assignments) ────
  if (path === "/api/novel/config" && req.method === "GET") {
    try {
      const { MODELS, PROVIDERS } = await import("../../models/registry")
      const { getAgentConfig, getAgentOverrides, AGENT_MODELS } = await import("../../models/roles")
      const { isModelHidden, getHiddenModels } = await import("../../models/hidden")

      // Only include visible models in dropdown lists
      const models = MODELS.filter(m => !isModelHidden(m.provider, m.id)).map(m => ({
        label: m.label,
        id: m.id,
        provider: m.provider,
        pricing: m.pricing,
      }))

      const providers = Object.keys(PROVIDERS)

      // Group agents by role for the UI
      const agentGroups: Record<string, { label: string; description: string; agents: string[] }> = {
        writers: { label: "Writers", description: "Creative prose generation", agents: ["writer", "beat-writer", "rewriter"] },
        planners: { label: "Planners", description: "World, characters, plot, chapter outlines", agents: ["world-builder", "character-agent", "plotter", "planning-plotter"] },
        beatSupport: { label: "Beat Support", description: "Cheap/fast structural tasks for beat-level writing", agents: ["reference-resolver", "adherence-events"] },
        validators: { label: "Validators", description: "Plan adherence and continuity checks", agents: ["chapter-plan-checker", "continuity-facts", "continuity-state"] },
        lintTonal: { label: "Lint & Tonal", description: "AI-tell detection and style transfer", agents: ["lint-fixer", "tonal-pass"] },
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
        hiddenModels: getHiddenModels(),
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
  // ?all=1 to include hidden seeds
  if (path === "/api/novel/seeds" && req.method === "GET") {
    try {
      const showAll = url.searchParams.get("all") === "1"
      const seedDir = resolve(HARNESS_ROOT, "src/seeds")
      const seeds = readdirSync(seedDir)
        .filter(f => f.endsWith(".json"))
        .filter(f => {
          if (showAll) return true
          try {
            const data = JSON.parse(readFileSync(resolve(seedDir, f), "utf8"))
            return !data.hidden
          } catch { return true }
        })
        .map(f => basename(f, ".json"))
      return Response.json({ seeds })
    } catch (err) {
      return Response.json({ error: "Failed to read seeds directory" }, { status: 500 })
    }
  }

  // ── List existing novels (from Postgres) ──────────────────────────
  if (path === "/api/novel/list" && req.method === "GET") {
    try {
      const rows = await db`SELECT id, phase, current_chapter, total_chapters, created_at, seed_json FROM novels ORDER BY created_at DESC`
      const novels = rows.map(row => {
        const pending = gates.getPending(row.id)
        return {
          id: row.id,
          phase: row.phase,
          currentChapter: row.current_chapter,
          totalChapters: row.total_chapters,
          createdAt: row.created_at,
          active: activeRuns.has(row.id),
          seed: row.seed_json,
          pendingGate: pending ? { gateId: pending.gateId, title: pending.title } : null,
        }
      })
      return Response.json({ novels })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Planning chat (plain text, conversational) ────────────────────
  // Pre-creation brainstorming turn. The conversationalist has no schema —
  // it just asks focused follow-up questions to surface author intent.
  // A separate /compile call later extracts directives from the transcript.
  if (path === "/api/novel/director/chat" && req.method === "POST") {
    try {
      const body = await req.json() as {
        seed: { premise: string; genre: string; chapterCount?: number }
        history?: { role: "user" | "assistant"; content: string }[]
        message: string
      }

      if (!body.message?.trim()) {
        return Response.json({ error: "message required" }, { status: 400 })
      }

      const {
        buildContext: buildChatContext,
        prompt: CHAT_PROMPT,
        config: chatConfig,
      } = await import("../agents/planning-conversationalist")
      const { getAgentConfig } = await import("../models/roles")
      const { getTransport } = await import("../transport")

      const role = getAgentConfig("planning-conversationalist")
      const userPrompt = buildChatContext({
        seed: {
          premise: body.seed.premise ?? "",
          genre: body.seed.genre ?? "",
          chapterCount: body.seed.chapterCount,
        },
        history: body.history ?? [],
        userMessage: body.message,
      })

      // Qwen3 reasoning is ON for this agent — the guided-conversation
      // judgments (coverage tracking, sparsity detection, contradiction
      // catching) benefit from an explicit reasoning pass. Cost delta is
      // ~0.15¢ per 10-turn session; latency adds ~500ms/turn which also
      // helps the UX feel less jarringly fast.
      const response = await getTransport().execute({
        systemPrompt: CHAT_PROMPT,
        userPrompt,
        model: role?.model ?? "qwen/qwen3-32b",
        provider: (role?.provider ?? "groq") as any,
        temperature: role?.temperature ?? chatConfig.temperature,
        maxTokens: role?.maxTokens ?? chatConfig.maxTokens,
        responseFormat: { type: "text" },
      })

      // Strip the <think>…</think> block from the user-visible reply.
      // Handles two failure modes:
      //   1. Normal closed block: <think>…</think>
      //   2. Truncated block (hit maxTokens mid-think, no closing tag):
      //      drop everything from <think> onward and surface a fallback.
      let cleaned = response.content.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim()
      const unclosed = cleaned.indexOf("<think>")
      if (unclosed !== -1) {
        cleaned = cleaned.slice(0, unclosed).trim()
        if (!cleaned) {
          cleaned = "(The model ran out of tokens while reasoning. Try rephrasing or continue the conversation.)"
        }
      }

      return Response.json({ ok: true, assistantMessage: cleaned })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Compile directives from transcript ────────────────────────────
  // One-shot extraction: transcript → PlanningDirectives JSON. Runs on demand
  // when the author clicks "Compile directives" in the UI.
  if (path === "/api/novel/director/compile" && req.method === "POST") {
    try {
      const body = await req.json() as {
        seed: { premise: string; genre: string; chapterCount?: number }
        history?: { role: "user" | "assistant"; content: string }[]
      }

      const {
        buildContext: buildExtractorContext,
        prompt: EXTRACTOR_PROMPT,
        schema: extractorSchema,
      } = await import("../agents/planning-extractor")
      const { callAgent } = await import("../llm")

      const userPrompt = buildExtractorContext({
        seed: {
          premise: body.seed.premise ?? "",
          genre: body.seed.genre ?? "",
          chapterCount: body.seed.chapterCount,
        },
        history: body.history ?? [],
      })

      const result = await callAgent({
        agentName: "planning-extractor",
        systemPrompt: EXTRACTOR_PROMPT,
        userPrompt,
        schema: extractorSchema,
      })

      return Response.json({ ok: true, directives: result.output })
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
      await initDB(novelId)
      await createNovel(novelId, seed)

      // Register in central DB
      const runId = await initNovelRun(novelId)

      lastRunErrors.delete(novelId)
      activeRuns.set(novelId, { startedAt: new Date().toISOString() })

      // Start pipeline as floating promise (fire-and-forget)
      runNovel(novelId)
        .then(() => {
          activeRuns.delete(novelId)
          console.log(`[novel-api] Novel ${novelId} completed`)
        })
        .catch(err => {
          activeRuns.delete(novelId)
          lastRunErrors.set(novelId, { error: String(err), at: new Date().toISOString() })
          console.error(`[novel-api] Novel ${novelId} failed:`, err)
        })

      return Response.json({ ok: true, novelId, runId, mode })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 400 })
    }
  }

  // ── Resume novel ───────────────────────────────────────────────────
  if (path === "/api/novel/resume" && req.method === "POST") {
    const body = await req.json() as { novelId: string; mode?: "interactive" | "auto"; rewindTo?: "concept" | "planning" | "drafting" | "validation" }
    const { novelId, rewindTo } = body
    const mode = body.mode ?? "interactive"

    if (activeRuns.has(novelId)) {
      return Response.json({ error: "Novel is already running" }, { status: 409 })
    }

    setAutoMode(mode === "auto")
    setResolverMode(mode === "auto" ? "auto" : "web")

    await initDB(novelId)
    try {
      await getNovel(novelId)
    } catch {
      return Response.json({ error: `Novel ${novelId} not found` }, { status: 404 })
    }

    if (rewindTo) {
      const { updatePhase } = await import("../db")
      await updatePhase(novelId, rewindTo)
    }

    // Re-init the logger's currentRunId so all downstream LLM calls land in
    // llm_calls. Without this, resumes across an orchestrator restart (or
    // after any path that clears the module-level runId) silently drop every
    // row — pipeline_events still populates via novelId, but llm_calls does not.
    await initNovelRun(novelId)

    lastRunErrors.delete(novelId)
    activeRuns.set(novelId, { startedAt: new Date().toISOString() })

    runNovel(novelId)
      .then(() => { activeRuns.delete(novelId) })
      .catch(err => {
        activeRuns.delete(novelId)
        lastRunErrors.set(novelId, { error: String(err), at: new Date().toISOString() })
        console.error(`[novel-api] Novel ${novelId} resume failed:`, err)
      })

    return Response.json({ ok: true, novelId, mode })
  }

  // ── Per-chapter redraft (delete + resume drafting) ───────────────────
  const redraftMatch = path.match(/^\/api\/novel\/([^/]+)\/chapter\/(\d+)\/redraft$/)
  if (redraftMatch && req.method === "POST") {
    const novelId = redraftMatch[1]
    const chapterNum = parseInt(redraftMatch[2])

    if (activeRuns.has(novelId)) {
      return Response.json({ error: "Novel is already running" }, { status: 409 })
    }

    await initDB(novelId)
    try {
      await getNovel(novelId)
    } catch {
      return Response.json({ error: `Novel ${novelId} not found` }, { status: 404 })
    }

    const { deleteChapterDrafts, updatePhase } = await import("../db")
    await deleteChapterDrafts(novelId, chapterNum)
    await updatePhase(novelId, "drafting")

    await initNovelRun(novelId)

    lastRunErrors.delete(novelId)
    activeRuns.set(novelId, { startedAt: new Date().toISOString() })
    runNovel(novelId)
      .then(() => { activeRuns.delete(novelId) })
      .catch(err => {
        activeRuns.delete(novelId)
        lastRunErrors.set(novelId, { error: String(err), at: new Date().toISOString() })
        console.error(`[novel-api] Novel ${novelId} redraft failed:`, err)
      })

    return Response.json({ ok: true, novelId, chapter: chapterNum })
  }

  // ── Novel state (from Postgres) ────────────────────���───────────────
  const stateMatch = path.match(/^\/api\/novel\/([^/]+)\/state$/)
  if (stateMatch && req.method === "GET") {
    const novelId = stateMatch[1]
    try {
      const rows = await db`SELECT * FROM novels WHERE id = ${novelId}`
      if (!rows.length) return Response.json({ error: "Novel not found" }, { status: 404 })
      const row = rows[0]
      const pending = gates.getPending(novelId)

      return Response.json({
        id: row.id,
        phase: row.phase,
        currentChapter: row.current_chapter,
        totalChapters: row.total_chapters,
        createdAt: row.created_at,
        active: activeRuns.has(novelId),
        activeError: activeRuns.get(novelId)?.error,
        lastRunError: lastRunErrors.get(novelId) ?? null,
        pendingGate: pending ? { gateId: pending.gateId, title: pending.title, content: pending.content } : null,
      })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── World bible (from Postgres) ────────────────────────────────────
  const worldMatch = path.match(/^\/api\/novel\/([^/]+)\/world-bible$/)
  if (worldMatch && req.method === "GET") {
    const novelId = worldMatch[1]
    try {
      const rows = await db`SELECT content_json FROM world_bibles WHERE novel_id = ${novelId}`
      if (!rows.length) return Response.json(null)
      return Response.json(rows[0].content_json)
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Characters (from Postgres) ─────────────────────────────────────
  const charsMatch = path.match(/^\/api\/novel\/([^/]+)\/characters$/)
  if (charsMatch && req.method === "GET") {
    const novelId = charsMatch[1]
    try {
      const rows = await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId}`
      return Response.json(rows.map(r => r.profile_json))
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Story spine (from Postgres) ────────────────────────────────────
  const spineMatch = path.match(/^\/api\/novel\/([^/]+)\/story-spine$/)
  if (spineMatch && req.method === "GET") {
    const novelId = spineMatch[1]
    try {
      const rows = await db`SELECT content_json FROM story_spines WHERE novel_id = ${novelId}`
      if (!rows.length) return Response.json(null)
      return Response.json(rows[0].content_json)
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Artifact edits: character / world / spine ─────────────────────
  const charEditMatch = path.match(/^\/api\/novel\/([^/]+)\/character\/([^/]+)$/)
  if (charEditMatch && req.method === "PUT") {
    const novelId = charEditMatch[1]
    const charId = charEditMatch[2]
    try {
      const body = await req.json() as Record<string, unknown>
      const { updateCharacterFields } = await import("../db")
      const updated = await updateCharacterFields(novelId, charId, body)
      return Response.json({ ok: true, character: updated })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  if (worldMatch && req.method === "PUT") {
    const novelId = worldMatch[1]
    try {
      const body = await req.json() as Record<string, unknown>
      const { updateWorldBibleFields } = await import("../db")
      const updated = await updateWorldBibleFields(novelId, body)
      return Response.json({ ok: true, world: updated })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  if (spineMatch && req.method === "PUT") {
    const novelId = spineMatch[1]
    try {
      const body = await req.json() as Record<string, unknown>
      const { updateStorySpineFields } = await import("../db")
      const updated = await updateStorySpineFields(novelId, body)
      return Response.json({ ok: true, spine: updated })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Conversational adjust (LLM proposes patches; UI applies) ──────
  const adjustMatch = path.match(/^\/api\/novel\/([^/]+)\/adjust$/)
  if (adjustMatch && req.method === "POST") {
    const novelId = adjustMatch[1]
    try {
      const body = await req.json() as {
        message: string
        history?: { role: "user" | "assistant"; content: string }[]
      }
      if (!body.message?.trim()) return Response.json({ error: "message required" }, { status: 400 })

      const { getWorldBible, getCharacters, getStorySpine } = await import("../db")
      const [world, characters, spine] = await Promise.all([
        getWorldBible(novelId).catch(() => null),
        getCharacters(novelId).catch(() => [] as any[]),
        getStorySpine(novelId).catch(() => null),
      ])

      const { buildContext, prompt: ADJUST_PROMPT, config: adjustConfig, adjusterOutputSchema } = await import("../agents/artifact-adjuster")
      const { getAgentConfig } = await import("../models/roles")
      const { getTransport } = await import("../transport")

      const role = getAgentConfig("artifact-adjuster")
      const userPrompt = buildContext({
        world, characters, spine,
        history: body.history ?? [],
        userMessage: body.message,
      })

      const response = await getTransport().execute({
        systemPrompt: ADJUST_PROMPT,
        userPrompt,
        model: role?.model ?? "qwen-3-235b-a22b-instruct-2507",
        provider: (role?.provider ?? "cerebras") as any,
        temperature: role?.temperature ?? adjustConfig.temperature,
        maxTokens: role?.maxTokens ?? adjustConfig.maxTokens,
        responseFormat: { type: "json_object" },
      })

      let parsed
      try {
        const obj = JSON.parse(response.content)
        parsed = adjusterOutputSchema.parse(obj)
      } catch (err) {
        return Response.json({
          ok: false,
          assistantMessage: "(The adjuster returned malformed output. Try rephrasing.)",
          proposedPatches: [],
          error: String(err),
          raw: response.content,
        })
      }

      return Response.json({ ok: true, ...parsed })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Chapter outlines (from Postgres) ───────────────────────────────
  const outlinesMatch = path.match(/^\/api\/novel\/([^/]+)\/outlines$/)
  if (outlinesMatch && req.method === "GET") {
    const novelId = outlinesMatch[1]
    try {
      const rows = await db`SELECT outline_json FROM chapter_outlines WHERE novel_id = ${novelId} ORDER BY chapter_number`
      return Response.json(rows.map(r => r.outline_json))
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Chapter draft (from Postgres) ���─────────────────────────────────
  const draftMatch = path.match(/^\/api\/novel\/([^/]+)\/chapter\/(\d+)\/draft$/)
  if (draftMatch && req.method === "GET") {
    const novelId = draftMatch[1]
    const ch = parseInt(draftMatch[2])
    try {
      const rows = await db`SELECT prose, word_count, version, status FROM chapter_drafts
                            WHERE novel_id = ${novelId} AND chapter_number = ${ch}
                            ORDER BY version DESC LIMIT 1`
      if (!rows.length) return Response.json(null)
      return Response.json({ prose: rows[0].prose, wordCount: rows[0].word_count, version: rows[0].version, status: rows[0].status })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── All chapter drafts (for reader view) ─────────────────────────
  const allDraftsMatch = path.match(/^\/api\/novel\/([^/]+)\/chapters$/)
  if (allDraftsMatch && req.method === "GET") {
    const novelId = allDraftsMatch[1]
    try {
      const rows = await db`
        SELECT DISTINCT ON (chapter_number) chapter_number, prose, word_count, version, status
        FROM chapter_drafts
        WHERE novel_id = ${novelId}
        ORDER BY chapter_number, version DESC`
      return Response.json(rows.map(r => ({
        chapter: r.chapter_number,
        prose: r.prose,
        wordCount: r.word_count,
        version: r.version,
        status: r.status,
      })))
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Per-beat prose (from llm_calls) ─────────────────────────────────
  const beatsMatch = path.match(/^\/api\/novel\/([^/]+)\/beats$/)
  if (beatsMatch && req.method === "GET") {
    const novelId = beatsMatch[1]
    try {
      // Get the latest successful beat-writer call per chapter+beat (highest attempt)
      const rows = await db`
        SELECT DISTINCT ON (chapter, beat_index)
          chapter, beat_index, response_content, prompt_tokens, completion_tokens, latency_ms, timestamp
        FROM llm_calls
        WHERE novel_id = ${novelId}
          AND agent = 'beat-writer'
          AND response_content IS NOT NULL
          AND failed IS NOT TRUE
        ORDER BY chapter, beat_index, attempt DESC`
      return Response.json(rows.map(r => ({
        chapter: r.chapter,
        beatIndex: r.beat_index,
        prose: r.response_content,
        wordCount: r.response_content ? r.response_content.split(/\s+/).filter(Boolean).length : 0,
        promptTokens: r.prompt_tokens,
        completionTokens: r.completion_tokens,
        latencyMs: r.latency_ms,
        timestamp: r.timestamp,
      })))
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Issues (from Postgres) ─────────────────────────────────────────
  const issuesMatch = path.match(/^\/api\/novel\/([^/]+)\/issues$/)
  if (issuesMatch && req.method === "GET") {
    const novelId = issuesMatch[1]
    try {
      const rows = await db`SELECT * FROM issues WHERE novel_id = ${novelId} AND status = 'open' ORDER BY chapter, created_at`
      return Response.json(rows)
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
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

  // ── Pipeline trace timeline ────────────────────────────────────────
  // Returns persistent pipeline_events rows for a novel. Filters:
  //   ?chapter=N  ?beat_index=N  ?event_type=…  ?agent=…  ?limit=N
  const traceMatch = path.match(/^\/api\/novel\/([^/]+)\/trace$/)
  if (traceMatch && req.method === "GET") {
    const novelId = traceMatch[1]
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "500"), 2000)
    const chapter = url.searchParams.get("chapter")
    const beatIndex = url.searchParams.get("beat_index")
    const eventType = url.searchParams.get("event_type")
    const agent = url.searchParams.get("agent")

    try {
      const conditions = [`novel_id = ${novelId}`]
      if (chapter) conditions.push(`chapter = ${parseInt(chapter)}`)
      if (beatIndex) conditions.push(`beat_index = ${parseInt(beatIndex)}`)
      if (eventType) conditions.push(`event_type = ${eventType}`)
      if (agent) conditions.push(`agent = ${agent}`)

      // Build query with optional filters using Bun.sql tagged templates
      let rows
      if (chapter && agent) {
        rows = await db`SELECT * FROM pipeline_events WHERE novel_id = ${novelId} AND chapter = ${parseInt(chapter)} AND agent = ${agent} ORDER BY timestamp ASC LIMIT ${limit}`
      } else if (chapter && eventType) {
        rows = await db`SELECT * FROM pipeline_events WHERE novel_id = ${novelId} AND chapter = ${parseInt(chapter)} AND event_type = ${eventType} ORDER BY timestamp ASC LIMIT ${limit}`
      } else if (chapter) {
        rows = await db`SELECT * FROM pipeline_events WHERE novel_id = ${novelId} AND chapter = ${parseInt(chapter)} ORDER BY timestamp ASC LIMIT ${limit}`
      } else if (eventType) {
        rows = await db`SELECT * FROM pipeline_events WHERE novel_id = ${novelId} AND event_type = ${eventType} ORDER BY timestamp ASC LIMIT ${limit}`
      } else if (agent) {
        rows = await db`SELECT * FROM pipeline_events WHERE novel_id = ${novelId} AND agent = ${agent} ORDER BY timestamp ASC LIMIT ${limit}`
      } else {
        rows = await db`SELECT * FROM pipeline_events WHERE novel_id = ${novelId} ORDER BY timestamp ASC LIMIT ${limit}`
      }

      return Response.json(rows)
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Delete novel ────────────────────────────────────────────────────
  const deleteMatch = path.match(/^\/api\/novel\/([^/]+)$/)
  if (deleteMatch && req.method === "DELETE") {
    const novelId = deleteMatch[1]

    if (activeRuns.has(novelId)) {
      return Response.json({ error: "Cannot delete a running novel" }, { status: 409 })
    }

    // Check novel exists in Postgres
    const rows = await db`SELECT id FROM novels WHERE id = ${novelId}`
    if (!rows.length) {
      return Response.json({ error: "Novel not found" }, { status: 404 })
    }

    // Archive: move output files if they exist, mark novel as archived in DB
    const novelDir = resolve(HARNESS_ROOT, `output/${novelId}`)
    if (existsSync(novelDir)) {
      const archiveDir = resolve(HARNESS_ROOT, "output/.archive")
      if (!existsSync(archiveDir)) {
        const { mkdirSync } = await import("node:fs")
        mkdirSync(archiveDir, { recursive: true })
      }
      const { renameSync } = await import("node:fs")
      renameSync(novelDir, resolve(archiveDir, novelId))
    }

    // Update phase to 'archived' in Postgres
    await db`UPDATE novels SET phase = 'archived', updated_at = now() WHERE id = ${novelId}`

    return Response.json({ ok: true, novelId, archived: true })
  }

  // ── LLM call inspector — list view ───────────────────────────────────
  // Returns metadata only (no prompt text) for the table view. Filters:
  //   ?novel_id=…  ?run_id=…  ?agent=…  ?chapter=N  ?beat_index=N  ?limit=N
  // For full prompt+response text, use /api/novel/llm-calls/:id below.
  if (path === "/api/novel/llm-calls" && req.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500)
    const runId = url.searchParams.get("run_id")
    const novelId = url.searchParams.get("novel_id")
    const agent = url.searchParams.get("agent")
    const chapter = url.searchParams.get("chapter")
    const beatIndex = url.searchParams.get("beat_index")
    const failedOnly = url.searchParams.get("failed")
    try {
      // Build a WHERE clause dynamically. Bun.sql's tagged template doesn't
      // compose AND-fragments cleanly, so we use sql.unsafe for the dynamic
      // bits (parameterised) and keep the column list literal.
      const where: string[] = []
      const params: any[] = []
      const add = (clause: string, val: any) => {
        params.push(val)
        where.push(clause.replace("?", `$${params.length}`))
      }
      if (runId) add("run_id = ?", parseInt(runId))
      if (novelId) add("novel_id = ?", novelId)
      if (agent) add("agent = ?", agent)
      if (chapter) add("chapter = ?", parseInt(chapter))
      if (beatIndex) add("beat_index = ?", parseInt(beatIndex))
      if (failedOnly === "1" || failedOnly === "true") where.push("failed = true")
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
      params.push(limit)
      const limitParam = `$${params.length}`
      const rows = await db.unsafe(
        `SELECT id, run_id, agent, phase, provider, model, temperature,
                prompt_tokens, completion_tokens, latency_ms, tokens_per_sec,
                cost, novel_id, chapter, beat_index, attempt, timestamp,
                failed, error_text
           FROM llm_calls ${whereSql}
          ORDER BY id DESC LIMIT ${limitParam}`,
        params,
      )
      return Response.json(rows)
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── LLM call inspector — distinct agent names (for filter dropdown) ──
  // Must come before the /:id regex below.
  if (path === "/api/novel/llm-calls/agents" && req.method === "GET") {
    const novelId = url.searchParams.get("novel_id")
    try {
      const rows = novelId
        ? await db`SELECT DISTINCT agent FROM llm_calls WHERE novel_id = ${novelId} ORDER BY agent`
        : await db`SELECT DISTINCT agent FROM llm_calls ORDER BY agent`
      return Response.json(rows.map((r: any) => r.agent))
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── LLM call inspector — drill-down (full prompt + response) ─────────
  const llmCallMatch = path.match(/^\/api\/novel\/llm-calls\/(\d+)$/)
  if (llmCallMatch && req.method === "GET") {
    const id = parseInt(llmCallMatch[1])
    try {
      const rows = await db`
        SELECT id, run_id, agent, phase, provider, model, temperature, max_tokens,
               prompt_tokens, completion_tokens, latency_ms, tokens_per_sec, cost,
               novel_id, chapter, beat_index, attempt, timestamp,
               system_prompt, user_prompt, response_content,
               request_json, failed, error_text,
               json_extraction_success, json_extraction_retried,
               zod_validation_success, zod_errors, http_attempts, retry_errors
          FROM llm_calls WHERE id = ${id}`
      if (rows.length === 0) {
        return Response.json({ error: "not found" }, { status: 404 })
      }
      // Bun.sql returns JSONB columns as strings — parse so the UI gets an object
      // and can render with JSON.stringify(...) without escaping.
      const row = rows[0]
      if (typeof row.request_json === "string") {
        try { row.request_json = JSON.parse(row.request_json) } catch { /* leave as string */ }
      }
      return Response.json(row)
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Cost breakdown ─────────────────────────────────────────────────
  if (path === "/api/novel/costs" && req.method === "GET") {
    try {
      const byAgent = await db`
        SELECT agent,
          COUNT(*) as calls,
          ROUND(SUM(cost)::numeric, 6)::float as total_cost,
          SUM(prompt_tokens)::int as total_in,
          SUM(completion_tokens)::int as total_out,
          ROUND(AVG(prompt_tokens))::int as avg_in,
          ROUND(AVG(completion_tokens))::int as avg_out,
          ROUND(AVG(latency_ms))::int as avg_latency_ms
        FROM llm_calls WHERE cost > 0
        GROUP BY agent ORDER BY total_cost DESC`

      const byProvider = await db`
        SELECT provider, model,
          COUNT(*) as calls,
          ROUND(SUM(cost)::numeric, 6)::float as total_cost,
          SUM(prompt_tokens)::int as total_in,
          SUM(completion_tokens)::int as total_out
        FROM llm_calls WHERE cost > 0
        GROUP BY provider, model ORDER BY total_cost DESC`

      const byPhase = await db`
        SELECT COALESCE(phase, 'unknown') as phase,
          COUNT(*) as calls,
          ROUND(SUM(cost)::numeric, 6)::float as total_cost,
          SUM(prompt_tokens)::int as total_in,
          SUM(completion_tokens)::int as total_out
        FROM llm_calls WHERE cost > 0
        GROUP BY phase ORDER BY total_cost DESC`

      const byNovel = await db`
        SELECT l.novel_id, n.total_chapters,
          COUNT(*) as calls,
          ROUND(SUM(l.cost)::numeric, 6)::float as total_cost,
          SUM(l.prompt_tokens)::int as total_in,
          SUM(l.completion_tokens)::int as total_out
        FROM llm_calls l
        LEFT JOIN novels n ON n.id = l.novel_id
        WHERE l.cost > 0 AND l.novel_id IS NOT NULL
        GROUP BY l.novel_id, n.total_chapters
        ORDER BY total_cost DESC`

      const daily = await db`
        SELECT date_trunc('day', timestamp)::date as day,
          COUNT(*) as calls,
          ROUND(SUM(cost)::numeric, 6)::float as total_cost,
          SUM(prompt_tokens)::int as total_in,
          SUM(completion_tokens)::int as total_out
        FROM llm_calls WHERE cost > 0
        GROUP BY day ORDER BY day`

      const [totals] = await db`
        SELECT COUNT(*) as calls,
          ROUND(SUM(cost)::numeric, 6)::float as total_cost,
          SUM(prompt_tokens)::bigint as total_in,
          SUM(completion_tokens)::bigint as total_out
        FROM llm_calls WHERE cost > 0`

      return Response.json({
        totals: { calls: Number(totals.calls), totalCost: totals.total_cost, totalIn: Number(totals.total_in), totalOut: Number(totals.total_out) },
        byAgent, byProvider, byPhase, byNovel, daily,
      })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Pending gates (for polling) ────────────────────────────────────
  if (path === "/api/novel/gates" && req.method === "GET") {
    return Response.json({ gates: gates.listPending() })
  }

  return null
}
