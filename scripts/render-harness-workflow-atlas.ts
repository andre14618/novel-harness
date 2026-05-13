/**
 * Render a repeatable, standalone HTML atlas of the Novel Harness workflow.
 *
 * Static mode:
 *   bun scripts/render-harness-workflow-atlas.ts --out output/workflow-atlas/static/index.html
 *
 * Run overlay mode:
 *   bun scripts/render-harness-workflow-atlas.ts --novel <novel-id> --out output/workflow-atlas/<novel-id>/index.html
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import type { ChapterOutline, NovelState } from "../src/types"

export interface WorkflowAtlasArgs {
  novelId: string | null
  outPath: string | null
  open: boolean
}

export interface WorkflowComponent {
  id: string
  name: string
  status: AtlasStatus
  role: string
  sources: string[]
  inputs: string[]
  outputs: string[]
  telemetry: string[]
  decisions: string[]
}

export interface WorkflowLane {
  id: string
  title: string
  summary: string
  components: WorkflowComponent[]
}

export type AtlasStatus =
  | "production-default"
  | "seed-enabled"
  | "default-off"
  | "diagnostic-only"
  | "manual-review"
  | "artifact"

export interface WorkflowEdge {
  from: string
  to: string
  contract: string
  evidence: string
}

export interface NovelRunOverlay {
  novelId: string
  phase: string
  currentChapter: number
  totalChapters: number
  seedGenre: string
  pipelineOverrides: Record<string, unknown>
  chapterCount: number
  sceneCount: number
  draftWordCount: number
  approvedDraftChapters: number
  failedCallCount: number
  totalCallCount: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCostUsd: number
  agentStats: AgentRunStat[]
  eventStats: EventRunStat[]
  chapters: ChapterRunStat[]
  timeline: TimelineEvent[]
}

export interface AgentRunStat {
  agent: string
  phase: string
  calls: number
  failed: number
  promptTokens: number
  completionTokens: number
  costUsd: number
  firstAt: string
  lastAt: string
}

export interface EventRunStat {
  eventType: string
  count: number
  failedLike: number
}

export interface ChapterRunStat {
  chapterNumber: number
  chapterId: string
  title: string
  targetWords: number
  sceneCount: number
  sceneRefs: string[]
  draftWords: number
  draftStatus: string
}

export interface TimelineEvent {
  id: number
  timestamp: string
  eventType: string
  agent: string
  chapter: number | null
  beatIndex: number | null
  llmCallId: number | null
  durationMs: number | null
}

interface BuildOverlayInput {
  novel: NovelState
  chapters: ChapterOutline[]
  llmRows: unknown[]
  eventRows: unknown[]
  draftRows: unknown[]
}

export function parseArgs(argv: string[]): WorkflowAtlasArgs {
  let novelId: string | null = null
  let outPath: string | null = null
  let open = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--novel") {
      const value = argv[++i]
      if (!value) throw new Error("--novel requires a value")
      novelId = value
    } else if (arg === "--out") {
      const value = argv[++i]
      if (!value) throw new Error("--out requires a value")
      outPath = value
    } else if (arg === "--open") {
      open = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }

  return { novelId, outPath, open }
}

export function defaultAtlasOutPath(novelId: string | null): string {
  const slug = novelId ? safeFileSegment(novelId) : "static"
  return `output/workflow-atlas/${slug}/index.html`
}

export async function writeHarnessWorkflowAtlas(args: WorkflowAtlasArgs): Promise<{
  outPath: string
  mode: "static" | "novel"
  componentCount: number
  timelineCount: number
}> {
  const overlay = args.novelId ? await loadNovelRunOverlay(args.novelId) : null
  const outPath = args.outPath ?? defaultAtlasOutPath(args.novelId)
  mkdirSync(dirname(outPath), { recursive: true })
  const html = renderHarnessWorkflowAtlasHtml({ overlay })
  writeFileSync(outPath, html)
  if (args.open) openPath(outPath)
  return {
    outPath,
    mode: args.novelId ? "novel" : "static",
    componentCount: WORKFLOW_ATLAS_LANES.reduce((sum, lane) => sum + lane.components.length, 0),
    timelineCount: overlay?.timeline.length ?? 0,
  }
}

async function loadNovelRunOverlay(novelId: string): Promise<NovelRunOverlay> {
  const [{ getNovel }, { getChapterOutlines }, dbModule] = await Promise.all([
    import("../src/db/novels"),
    import("../src/db/outlines"),
    import("../src/db/connection"),
  ])
  const db = dbModule.default
  const novel = await getNovel(novelId)
  const chapters = await getChapterOutlines(novelId)
  const [llmRows, eventRows, draftRows] = await Promise.all([
    db`
      SELECT agent, COALESCE(phase, '') AS phase,
             COUNT(*)::int AS calls,
             SUM(CASE WHEN failed THEN 1 ELSE 0 END)::int AS failed,
             COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
             COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
             COALESCE(SUM(cost), 0)::float AS cost_usd,
             MIN(timestamp) AS first_at,
             MAX(timestamp) AS last_at
      FROM llm_calls
      WHERE novel_id = ${novelId}
      GROUP BY agent, phase
      ORDER BY calls DESC, agent ASC
    `,
    db`
      SELECT id, timestamp, event_type, agent, chapter, beat_index, llm_call_id, duration_ms
      FROM pipeline_events
      WHERE novel_id = ${novelId}
      ORDER BY timestamp ASC, id ASC
      LIMIT 600
    `,
    db`
      SELECT DISTINCT ON (chapter_number)
             chapter_number, version, word_count, status, created_at
      FROM chapter_drafts
      WHERE novel_id = ${novelId}
      ORDER BY chapter_number, version DESC
    `,
  ])

  return buildNovelRunOverlay({ novel, chapters, llmRows, eventRows, draftRows })
}

export function buildNovelRunOverlay(input: BuildOverlayInput): NovelRunOverlay {
  const draftByChapter = new Map<number, { word_count?: unknown; status?: unknown }>()
  for (const row of input.draftRows) {
    const r = asRecord(row)
    draftByChapter.set(numberOf(r.chapter_number), r)
  }

  const chapters = input.chapters.map(chapter => {
    const draft = draftByChapter.get(chapter.chapterNumber)
    return {
      chapterNumber: chapter.chapterNumber,
      chapterId: chapter.chapterId ?? "",
      title: chapter.title,
      targetWords: numberOf(chapter.targetWords),
      sceneCount: chapter.scenes?.length ?? 0,
      sceneRefs: (chapter.scenes ?? [])
        .map(scene => scene.sceneId || scene.beatId || "")
        .filter(Boolean),
      draftWords: numberOf(draft?.word_count),
      draftStatus: stringOf(draft?.status),
    }
  })

  const agentStats = input.llmRows.map(row => {
    const r = asRecord(row)
    return {
      agent: stringOf(r.agent),
      phase: stringOf(r.phase) || "unknown",
      calls: numberOf(r.calls),
      failed: numberOf(r.failed),
      promptTokens: numberOf(r.prompt_tokens),
      completionTokens: numberOf(r.completion_tokens),
      costUsd: numberOf(r.cost_usd),
      firstAt: dateString(r.first_at),
      lastAt: dateString(r.last_at),
    }
  })

  const eventCounts = new Map<string, EventRunStat>()
  const timeline = input.eventRows.map(row => {
    const r = asRecord(row)
    const eventType = stringOf(r.event_type)
    const current = eventCounts.get(eventType) ?? { eventType, count: 0, failedLike: 0 }
    current.count += 1
    if (/fail|error|block|gate-wait/i.test(eventType)) current.failedLike += 1
    eventCounts.set(eventType, current)
    return {
      id: numberOf(r.id),
      timestamp: dateString(r.timestamp),
      eventType,
      agent: stringOf(r.agent),
      chapter: nullableNumber(r.chapter),
      beatIndex: nullableNumber(r.beat_index),
      llmCallId: nullableNumber(r.llm_call_id),
      durationMs: nullableNumber(r.duration_ms),
    }
  })

  const pipelineOverrides = isRecord(input.novel.seed.pipelineOverrides)
    ? input.novel.seed.pipelineOverrides
    : {}

  return {
    novelId: input.novel.id,
    phase: input.novel.phase,
    currentChapter: input.novel.currentChapter,
    totalChapters: input.novel.totalChapters,
    seedGenre: input.novel.seed.genre,
    pipelineOverrides,
    chapterCount: chapters.length,
    sceneCount: chapters.reduce((sum, chapter) => sum + chapter.sceneCount, 0),
    draftWordCount: chapters.reduce((sum, chapter) => sum + chapter.draftWords, 0),
    approvedDraftChapters: chapters.filter(chapter => chapter.draftStatus === "approved").length,
    failedCallCount: agentStats.reduce((sum, stat) => sum + stat.failed, 0),
    totalCallCount: agentStats.reduce((sum, stat) => sum + stat.calls, 0),
    totalPromptTokens: agentStats.reduce((sum, stat) => sum + stat.promptTokens, 0),
    totalCompletionTokens: agentStats.reduce((sum, stat) => sum + stat.completionTokens, 0),
    totalCostUsd: agentStats.reduce((sum, stat) => sum + stat.costUsd, 0),
    agentStats,
    eventStats: [...eventCounts.values()].sort((a, b) => b.count - a.count || a.eventType.localeCompare(b.eventType)),
    chapters,
    timeline,
  }
}

export function renderHarnessWorkflowAtlasHtml(input: { overlay?: NovelRunOverlay | null } = {}): string {
  const overlay = input.overlay ?? null
  const generatedAt = new Date().toISOString()
  const componentCount = WORKFLOW_ATLAS_LANES.reduce((sum, lane) => sum + lane.components.length, 0)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>${overlay ? `${escapeHtml(overlay.novelId)} ` : ""}Harness Workflow Atlas</title>
  <style>${CSS}</style>
</head>
<body>
  <header class="atlas-header">
    <div>
      <p class="eyebrow">Novel Harness</p>
      <h1>Workflow Atlas</h1>
      <p class="subtitle">A repeatable map of how seeds, planning, drafting, checks, telemetry, proposals, and artifacts move through the production harness.</p>
    </div>
    <div class="header-meta">
      <span>${overlay ? "Run overlay" : "Static harness map"}</span>
      <code>${escapeHtml(generatedAt)}</code>
    </div>
  </header>
  <nav class="atlas-nav" aria-label="Atlas sections">
    <a href="#run">Run</a>
    <a href="#pipeline">Pipeline</a>
    <a href="#lanes">Components</a>
    <a href="#edges">Data Flow</a>
    <a href="#status">Status</a>
    <a href="#commands">Commands</a>
  </nav>
  <main>
    <section id="run" class="section">
      <div class="section-head">
        <h2>Run Overlay</h2>
        <p>${overlay ? "Actual DB-backed telemetry for the selected novel." : "No --novel supplied. This artifact is still useful as a full static workflow reference."}</p>
      </div>
      ${overlay ? renderRunOverlay(overlay) : renderStaticRunPlaceholder()}
    </section>

    <section id="pipeline" class="section">
      <div class="section-head">
        <h2>End-to-End Pipeline</h2>
        <p>Read left to right. Cards are grouped by the layer that owns the decision or artifact.</p>
      </div>
      ${renderPipelineMap()}
    </section>

    <section id="lanes" class="section">
      <div class="section-head">
        <h2>Component Inventory</h2>
        <p>${componentCount} mapped components with ownership, inputs, outputs, telemetry, and source links.</p>
      </div>
      ${WORKFLOW_ATLAS_LANES.map(renderLane).join("\n")}
    </section>

    <section id="edges" class="section">
      <div class="section-head">
        <h2>Data Flow Contracts</h2>
        <p>These are the contracts that prevent context drift: every row names the handoff and the evidence surface that can prove it happened.</p>
      </div>
      ${renderEdges()}
    </section>

    <section id="status" class="section">
      <div class="section-head">
        <h2>Runtime Status Legend</h2>
        <p>This distinguishes the main path from seed-enabled, default-off, diagnostic-only, and manual-review surfaces.</p>
      </div>
      ${renderStatusLegend()}
    </section>

    <section id="commands" class="section">
      <div class="section-head">
        <h2>Repeatable Commands</h2>
        <p>Use these to regenerate the atlas and then drill into the run with existing harness reports.</p>
      </div>
      ${renderCommands(overlay)}
    </section>
  </main>
</body>
</html>
`
}

function renderRunOverlay(overlay: NovelRunOverlay): string {
  return `
    <div class="metric-grid">
      ${metric("Novel", overlay.novelId)}
      ${metric("Phase", overlay.phase)}
      ${metric("Chapters", `${overlay.chapterCount}/${overlay.totalChapters}`)}
      ${metric("Scenes", overlay.sceneCount)}
      ${metric("Draft words", overlay.draftWordCount)}
      ${metric("LLM calls", overlay.totalCallCount)}
      ${metric("Failed calls", overlay.failedCallCount, overlay.failedCallCount > 0 ? "warn" : "good")}
      ${metric("Cost", `$${overlay.totalCostUsd.toFixed(4)}`)}
    </div>
    <div class="two-col">
      <section class="panel">
        <h3>Seed And Flags</h3>
        <dl class="kv">
          <dt>Genre</dt><dd>${escapeHtml(overlay.seedGenre)}</dd>
          <dt>Current chapter</dt><dd>${escapeHtml(overlay.currentChapter)}</dd>
          ${Object.entries(overlay.pipelineOverrides).map(([key, value]) =>
            `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatValue(value))}</dd>`
          ).join("\n")}
        </dl>
      </section>
      <section class="panel">
        <h3>Event Mix</h3>
        ${overlay.eventStats.length ? `<div class="chip-list">${overlay.eventStats.slice(0, 18).map(event =>
          `<span class="chip">${escapeHtml(event.eventType)} <strong>${event.count}</strong></span>`
        ).join("")}</div>` : `<p class="muted">No pipeline_events rows found for this novel.</p>`}
      </section>
    </div>
    <section class="panel">
      <h3>Agent Calls</h3>
      ${overlay.agentStats.length ? `<table>
        <thead><tr><th>Agent</th><th>Phase</th><th>Calls</th><th>Failed</th><th>Prompt</th><th>Completion</th><th>Cost</th><th>Window</th></tr></thead>
        <tbody>
          ${overlay.agentStats.map(stat => `<tr>
            <td>${escapeHtml(stat.agent)}</td>
            <td>${escapeHtml(stat.phase)}</td>
            <td>${stat.calls}</td>
            <td class="${stat.failed ? "warn-text" : "good-text"}">${stat.failed}</td>
            <td>${stat.promptTokens}</td>
            <td>${stat.completionTokens}</td>
            <td>$${stat.costUsd.toFixed(4)}</td>
            <td>${escapeHtml(shortDate(stat.firstAt))} -> ${escapeHtml(shortDate(stat.lastAt))}</td>
          </tr>`).join("\n")}
        </tbody>
      </table>` : `<p class="muted">No llm_calls rows found for this novel.</p>`}
    </section>
    <section class="panel">
      <h3>Chapter Shape</h3>
      <div class="chapter-grid">
        ${overlay.chapters.map(chapter => `<article class="chapter-card">
          <div class="chapter-top"><strong>Ch ${chapter.chapterNumber}</strong><code>${escapeHtml(chapter.chapterId || "no-id")}</code></div>
          <h4>${escapeHtml(chapter.title)}</h4>
          <p>${chapter.sceneCount} scenes / ${chapter.targetWords} target words</p>
          <p>${chapter.draftWords ? `${chapter.draftWords} draft words` : "no draft words"}${chapter.draftStatus ? ` (${escapeHtml(chapter.draftStatus)})` : ""}</p>
          <details><summary>Scene refs</summary><div class="ref-list">${chapter.sceneRefs.map(ref => `<code>${escapeHtml(ref)}</code>`).join("")}</div></details>
        </article>`).join("\n")}
      </div>
    </section>
    <section class="panel">
      <h3>Timeline Sample</h3>
      ${overlay.timeline.length ? `<ol class="timeline">
        ${overlay.timeline.slice(0, 80).map(event => `<li>
          <time>${escapeHtml(shortDate(event.timestamp))}</time>
          <strong>${escapeHtml(event.eventType)}</strong>
          ${event.agent ? `<span>${escapeHtml(event.agent)}</span>` : ""}
          ${event.chapter !== null ? `<code>ch ${event.chapter}</code>` : ""}
          ${event.beatIndex !== null ? `<code>entry ${event.beatIndex}</code>` : ""}
          ${event.durationMs !== null ? `<code>${event.durationMs}ms</code>` : ""}
        </li>`).join("\n")}
      </ol>` : `<p class="muted">No timeline events found for this novel.</p>`}
    </section>
  `
}

function renderStaticRunPlaceholder(): string {
  return `<div class="panel">
    <h3>Static mode</h3>
    <p>Run again with <code>--novel &lt;novel-id&gt;</code> to overlay actual phase, chapter, agent, trace, draft, and token data from the database.</p>
    <pre><code>bun scripts/render-harness-workflow-atlas.ts --novel test-planner-mercenary-rillgate-saltmine-1778674224711 --out output/workflow-atlas/rillgate/index.html --open</code></pre>
  </div>`
}

function renderPipelineMap(): string {
  return `<div class="pipeline-map">
    ${WORKFLOW_ATLAS_LANES.map(lane => `<section class="pipeline-column">
      <h3>${escapeHtml(lane.title)}</h3>
      ${lane.components.slice(0, 4).map(component => `<div class="mini-card ${statusClass(component.status)}">
        <strong>${escapeHtml(component.name)}</strong>
        <span>${escapeHtml(statusLabel(component.status))}</span>
      </div>`).join("\n")}
    </section>`).join("\n")}
  </div>`
}

function renderLane(lane: WorkflowLane): string {
  return `<section class="lane">
    <div class="lane-head">
      <h3>${escapeHtml(lane.title)}</h3>
      <p>${escapeHtml(lane.summary)}</p>
    </div>
    <div class="component-grid">
      ${lane.components.map(renderComponent).join("\n")}
    </div>
  </section>`
}

function renderComponent(component: WorkflowComponent): string {
  return `<article class="component-card">
    <div class="component-title">
      <h4>${escapeHtml(component.name)}</h4>
      <span class="status ${statusClass(component.status)}">${escapeHtml(statusLabel(component.status))}</span>
    </div>
    <p>${escapeHtml(component.role)}</p>
    ${listBlock("Inputs", component.inputs)}
    ${listBlock("Outputs", component.outputs)}
    ${listBlock("Telemetry", component.telemetry)}
    <div class="source-links">
      ${component.sources.map(source => `<a href="${sourceHref(source)}">${escapeHtml(source)}</a>`).join("")}
    </div>
    ${component.decisions.length ? `<div class="decision-links">${component.decisions.map(decision => `<code>${escapeHtml(decision)}</code>`).join("")}</div>` : ""}
  </article>`
}

function renderEdges(): string {
  return `<table>
    <thead><tr><th>From</th><th>To</th><th>Contract</th><th>Evidence</th></tr></thead>
    <tbody>
      ${WORKFLOW_EDGES.map(edge => `<tr>
        <td>${escapeHtml(edge.from)}</td>
        <td>${escapeHtml(edge.to)}</td>
        <td>${escapeHtml(edge.contract)}</td>
        <td>${escapeHtml(edge.evidence)}</td>
      </tr>`).join("\n")}
    </tbody>
  </table>`
}

function renderStatusLegend(): string {
  const rows: Array<[AtlasStatus, string]> = [
    ["production-default", "Runs on the main path without a seed or CLI override."],
    ["seed-enabled", "Production code path, enabled by a seed or run option for a particular novel."],
    ["default-off", "Implemented production module, but not globally enabled."],
    ["diagnostic-only", "Collects evidence or reports; should not block generation by itself."],
    ["manual-review", "Creates/uses artifacts that require operator review before applying changes."],
    ["artifact", "Generated output or UI/report surface for inspection."],
  ]
  return `<div class="legend-grid">${rows.map(([status, description]) =>
    `<div class="legend-card"><span class="status ${statusClass(status)}">${statusLabel(status)}</span><p>${escapeHtml(description)}</p></div>`
  ).join("\n")}</div>`
}

function renderCommands(overlay: NovelRunOverlay | null): string {
  const novel = overlay?.novelId ?? "<novel-id>"
  return `<div class="command-grid">
    <pre><code>bun scripts/render-harness-workflow-atlas.ts --out output/workflow-atlas/static/index.html --open</code></pre>
    <pre><code>bun scripts/render-harness-workflow-atlas.ts --novel ${escapeHtml(novel)} --out output/workflow-atlas/${escapeHtml(safeFileSegment(novel))}/index.html --open</code></pre>
    <pre><code>bun scripts/render-planner-outline-html.ts --novel ${escapeHtml(novel)} --out output/planner-outlines/${escapeHtml(safeFileSegment(novel))}/plan.html --open</code></pre>
    <pre><code>bun scripts/analysis/planning-drafting-context-report.ts --novel ${escapeHtml(novel)}</code></pre>
  </div>`
}

function metric(label: string, value: string | number, tone = ""): string {
  return `<div class="metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function listBlock(label: string, items: readonly string[]): string {
  if (items.length === 0) return ""
  return `<div class="list-block"><strong>${escapeHtml(label)}</strong><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`
}

export const WORKFLOW_ATLAS_LANES: WorkflowLane[] = [
  {
    id: "intent",
    title: "Intent And Configuration",
    summary: "Author intent, seed data, decisions, and feature flags that shape the rest of the run.",
    components: [
      {
        id: "seed",
        name: "Seed Packet",
        status: "production-default",
        role: "Defines genre, premise, chapter count, directives, and per-novel pipeline overrides.",
        sources: ["src/seeds/mercenary-rillgate-saltmine.json", "src/types.ts"],
        inputs: ["Operator story intent", "Method-pack or genre packet", "Pipeline overrides"],
        outputs: ["SeedInput", "Planning directives", "Per-run feature flags"],
        telemetry: ["Novel seed_json", "atlas seed flag overlay"],
        decisions: ["L109", "L111"],
      },
      {
        id: "directives",
        name: "Planning Directives",
        status: "production-default",
        role: "Normalizes locked characters, chapter contracts, story debts, sequence guards, and future-boundary redaction.",
        sources: [
          "src/schemas/planning-directives.ts",
          "src/agents/planning-conversationalist",
          "src/agents/planning-extractor",
        ],
        inputs: ["Seed directives", "Chapter number"],
        outputs: ["Planner directives", "Chapter-scoped expansion directives", "Boundary terms"],
        telemetry: ["Sequence guard retry reasons", "futureEventAnchors diagnostics"],
        decisions: ["L093", "L109", "L111"],
      },
      {
        id: "decisions",
        name: "Decision Index",
        status: "manual-review",
        role: "Keeps the active architecture and runtime posture legible for agents and operators.",
        sources: ["docs/current-state.md", "docs/decisions.md", "docs/sessions/lane-queue.md"],
        inputs: ["Committed decisions", "Run evidence", "Operator goal changes"],
        outputs: ["Active posture", "Current lane", "Verification expectations"],
        telemetry: ["docs:weight", "preflight docs impact"],
        decisions: ["L085", "L106", "L107", "L111"],
      },
    ],
  },
  {
    id: "concept",
    title: "Concept Phase",
    summary: "Builds the initial world, character, and story-spine artifacts used by planning.",
    components: [
      {
        id: "world-builder",
        name: "World Builder",
        status: "production-default",
        role: "Creates world bible, setting rules, locations, and constraints.",
        sources: ["src/agents/world-builder"],
        inputs: ["Seed", "Concept directives"],
        outputs: ["WorldBible"],
        telemetry: ["llm_calls agent=world-builder", "phase-change concept"],
        decisions: ["L090"],
      },
      {
        id: "character-agent",
        name: "Character Agent",
        status: "production-default",
        role: "Creates character profiles, speech patterns, goals, fears, and relationship hooks.",
        sources: ["src/agents/character-agent"],
        inputs: ["Seed", "WorldBible", "Concept directives"],
        outputs: ["CharacterProfile[]"],
        telemetry: ["llm_calls agent=character-agent"],
        decisions: ["L090", "L094"],
      },
      {
        id: "plotter",
        name: "Story Spine Plotter",
        status: "production-default",
        role: "Creates the central conflict, theme, ending direction, and macro story spine.",
        sources: ["src/agents/plotter"],
        inputs: ["Seed", "WorldBible", "Characters"],
        outputs: ["StorySpine"],
        telemetry: ["llm_calls agent=plotter"],
        decisions: ["L088", "L109"],
      },
    ],
  },
  {
    id: "planning",
    title: "Planning Phase",
    summary: "Converts concept artifacts into chapter contracts, scene entries, state changes, and traceable obligations.",
    components: [
      {
        id: "planning-plotter",
        name: "Planning Plotter",
        status: "production-default",
        role: "Builds the skeleton chapter plan: one compact chapter contract per chapter.",
        sources: ["src/agents/planning-plotter/context.ts", "src/phases/planning.ts"],
        inputs: ["WorldBible", "Characters", "StorySpine", "Directives"],
        outputs: ["Chapter skeletons"],
        telemetry: ["llm_calls agent=planning-plotter", "planner isolated report"],
        decisions: ["L088", "L102", "L109"],
      },
      {
        id: "planning-scenes",
        name: "Scene Expansion",
        status: "seed-enabled",
        role: "Expands each chapter skeleton into scene-scale story turns while respecting chapter ownership boundaries.",
        sources: ["src/agents/planning-scenes/context.ts", "src/harness/scene-counts.ts"],
        inputs: ["Chapter skeleton", "Scoped seed context", "Prior chapter state", "Boundary terms"],
        outputs: ["Scene entries", "Scene contract fields when enabled"],
        telemetry: ["scene counts", "sequence guard retries", "future-boundary violations"],
        decisions: ["L092", "L102", "L111"],
      },
      {
        id: "state-mapper",
        name: "Planning State Mapper",
        status: "seed-enabled",
        role: "Maps end-of-chapter state and writer-visible obligations onto existing scene entries.",
        sources: ["src/agents/planning-state-mapper/context.ts", "src/agents/planning-state-repair"],
        inputs: ["Expanded scenes", "Story refs", "World facts", "Characters"],
        outputs: ["Established facts", "Knowledge changes", "Character state changes", "Beat obligations"],
        telemetry: ["state-mapper headroom", "materialityTest coverage", "obligation IDs"],
        decisions: ["L093", "L108", "L111"],
      },
      {
        id: "planning-enforcement",
        name: "Planning Enforcement",
        status: "production-default",
        role: "Applies deterministic chapter count, scene count, payoff-link, and sequence guard checks.",
        sources: ["src/harness/enforce.ts", "src/phases/planning.ts"],
        inputs: ["Chapter outlines", "Planning directives"],
        outputs: ["Valid outline or retry reason"],
        telemetry: ["planning retry reasons", "chapter sequence guard errors"],
        decisions: ["L102", "L111"],
      },
    ],
  },
  {
    id: "drafting",
    title: "Drafting Phase",
    summary: "Assembles writer context, generates prose, checks adherence, repairs, and persists approved chapter drafts.",
    components: [
      {
        id: "writer-context",
        name: "Writer Context Renderer",
        status: "production-default",
        role: "Builds the beat-shaped writer prompt from scene contract, obligations, character state, prior prose, and references.",
        sources: ["src/agents/writer/beat-context.ts", "src/agents/writer/scene-context-rendering.test.ts"],
        inputs: ["Chapter outline", "Scene entry", "Prior prose", "Reference resolver output"],
        outputs: ["BeatContext", "writer-context trace event"],
        telemetry: ["writer-context section counts", "context report"],
        decisions: ["L094", "L099", "L110"],
      },
      {
        id: "drafting-brief",
        name: "Drafting Brief Modes",
        status: "seed-enabled",
        role: "Renders compact writer-facing brief variants such as tight anchored scene-budget mode.",
        sources: ["src/agents/writer/drafting-brief.ts"],
        inputs: ["BeatContext", "writerDraftingBriefMode"],
        outputs: ["Writer prompt brief", "brief telemetry"],
        telemetry: ["diagnostics:writer-context", "quality telemetry packet"],
        decisions: ["L106", "L108", "L110"],
      },
      {
        id: "beat-writer",
        name: "Beat Writer",
        status: "production-default",
        role: "Generates prose for each planned entry using the assembled writer context.",
        sources: ["src/phases/drafting.ts", "src/agents/writer"],
        inputs: ["Writer prompt", "Model role config", "Retry context"],
        outputs: ["Chapter prose", "llm_calls rows"],
        telemetry: ["llm_calls agent=beat-writer", "writer-expansion events"],
        decisions: ["L090", "L108"],
      },
      {
        id: "checkers",
        name: "Writer Checkers",
        status: "production-default",
        role: "Checks adherence, hallucination, plan fit, continuity, functional state, and prose integrity.",
        sources: [
          "src/agents/writer/adherence-checker.test.ts",
          "src/agents/chapter-plan-checker",
          "src/agents/chapter-plan-reviser",
          "src/agents/functional-state-checker",
          "src/agents/halluc-ungrounded",
          "src/agents/continuity",
          "src/agents/lint-discoverer",
          "src/agents/lint-improver",
          "src/phases/validation-routing.ts",
        ],
        inputs: ["Prose", "Plan", "World/character state", "Obligations"],
        outputs: ["Pass/fail findings", "Retry context", "Plan-Assist gates"],
        telemetry: ["checker calls", "checker readiness", "semantic gate reports"],
        decisions: ["L084", "L098", "L108"],
      },
    ],
  },
  {
    id: "review",
    title: "Review And Repair",
    summary: "Manual and semi-automated review surfaces that turn diagnostics into explicit planning or prose changes.",
    components: [
      {
        id: "plan-readiness",
        name: "Plan Readiness",
        status: "manual-review",
        role: "Turns planner diagnostics into reviewable readiness items before drafting or re-drafting.",
        sources: ["scripts/analysis/planning-context-readiness.ts", "scripts/analysis/plan-readiness-review-plan.ts", "src/db/plan-readiness.ts"],
        inputs: ["Planner/context diagnostics", "Semantic lows", "Checker gaps"],
        outputs: ["Plan readiness items", "planning_edit proposals"],
        telemetry: ["plan_readiness_items", "Plan Readiness reports"],
        decisions: ["L091", "L108"],
      },
      {
        id: "planning-proposals",
        name: "Planning Proposals",
        status: "manual-review",
        role: "Applies reviewed plan edits with stale-precondition checks and mutation lineage.",
        sources: ["src/orchestrator/planning-proposal-routes.ts", "src/harness/planning-targets.ts"],
        inputs: ["Planning edit request", "Current planning target version"],
        outputs: ["Updated outline/artifact", "Mutation lineage"],
        telemetry: ["proposal_envelopes", "planning_mutation_lineage"],
        decisions: ["L077", "L091"],
      },
      {
        id: "canon-proposals",
        name: "Canon Proposal Workflow",
        status: "manual-review",
        role: "Routes canon/artifact changes through proposal envelopes rather than direct writes.",
        sources: ["src/orchestrator/canon-proposal-routes.test.ts", "src/canon", "src/agents/artifact-adjuster"],
        inputs: ["Canon/artifact proposal", "Review policy"],
        outputs: ["Accepted/rejected proposal", "Impact observations"],
        telemetry: ["proposal-outcome events", "checker observations"],
        decisions: ["L076", "L084"],
      },
    ],
  },
  {
    id: "telemetry",
    title: "Telemetry And Evaluation",
    summary: "Evidence surfaces used to understand quality, context shape, costs, retries, and checker behavior.",
    components: [
      {
        id: "trace",
        name: "Unified Trace",
        status: "production-default",
        role: "Persists pipeline events and broadcasts live updates.",
        sources: ["src/trace.ts"],
        inputs: ["Phase events", "Agent events", "Checker events", "Proposal events"],
        outputs: ["pipeline_events", "SSE trace updates"],
        telemetry: ["pipeline_events", "TraceTimeline UI"],
        decisions: ["L099", "L108"],
      },
      {
        id: "llm-calls",
        name: "LLM Call Log",
        status: "production-default",
        role: "Records every LLM request/response/error with prompt text, model, tokens, costs, and scene/beat tags.",
        sources: ["src/llm.ts", "src/logger.ts", "src/db/ops.ts"],
        inputs: ["LLM request", "Call metadata"],
        outputs: ["llm_calls"],
        telemetry: ["agent stats", "token/cost reports"],
        decisions: ["L090", "L099"],
      },
      {
        id: "quality-telemetry",
        name: "Quality Telemetry Packet",
        status: "diagnostic-only",
        role: "Captures prose-semantic and scene-semantic diagnostics as fail-open evidence.",
        sources: [
          "scripts/test-drafting-isolated.ts",
          "scripts/analysis",
          "scripts/analysis/prose-semantic-report.ts",
          "scripts/analysis/drafting-run-compare.ts",
        ],
        inputs: ["Drafted prose", "Captured writer calls", "Semantic judges"],
        outputs: ["Semantic reports", "Run compare/cohort artifacts"],
        telemetry: ["endpointLanding", "sceneDramaturgy", "characterMateriality", "worldFactPressure"],
        decisions: ["L108"],
      },
      {
        id: "workflow-atlas",
        name: "Workflow Atlas",
        status: "artifact",
        role: "Renders this repeatable static map plus optional novel run overlay.",
        sources: ["scripts/render-harness-workflow-atlas.ts"],
        inputs: ["Static workflow model", "Optional novel DB rows"],
        outputs: ["Standalone HTML atlas"],
        telemetry: ["Chapter, agent, event, draft, and flag overlay"],
        decisions: ["L106", "L111"],
      },
    ],
  },
  {
    id: "ui",
    title: "Operator Surfaces",
    summary: "Browser and artifact surfaces used to inspect the live pipeline and outputs.",
    components: [
      {
        id: "pipeline-ui",
        name: "Pipeline UI",
        status: "artifact",
        role: "Shows live phase, active agents, prose, gates, and event log.",
        sources: ["ui/src/components", "ui/src/components/PipelineView.tsx", "ui/src/components/PipelineFlow.tsx"],
        inputs: ["SSE events", "Novel API routes"],
        outputs: ["Live operator view"],
        telemetry: ["TraceTimeline", "EventLog"],
        decisions: ["L078"],
      },
      {
        id: "planning-studio",
        name: "Planning Studio",
        status: "artifact",
        role: "Surfaces outlines, snapshots, chapter health, and planning proposal workflows.",
        sources: ["ui/src/components/PlanningStudioPage.tsx", "ui/src/components/PlanningSnapshotPage.tsx", "ui/src/components/ChapterHealthPage.tsx"],
        inputs: ["Planning snapshots", "Chapter health", "Proposal APIs"],
        outputs: ["Operator review and apply paths"],
        telemetry: ["chapter health", "planning snapshot hashes"],
        decisions: ["L091"],
      },
      {
        id: "chapter-traceability",
        name: "Chapter Traceability",
        status: "artifact",
        role: "Shows how obligations, source refs, LLM calls, events, proposals, and lineage connect at chapter level.",
        sources: ["src/harness/chapter-traceability.ts", "ui/src/components/ChapterTraceabilityPage.tsx"],
        inputs: ["chapter_outlines", "llm_calls", "pipeline_events", "proposal lineage"],
        outputs: ["Chapter traceability report"],
        telemetry: ["linked obligations", "missing source refs", "writer/checker calls"],
        decisions: ["L099"],
      },
    ],
  },
]

const WORKFLOW_EDGES: WorkflowEdge[] = [
  {
    from: "Seed Packet",
    to: "Concept Phase",
    contract: "SeedInput controls genre, premise, chapter count, directives, and per-run overrides.",
    evidence: "novels.seed_json and atlas flag overlay",
  },
  {
    from: "Concept Artifacts",
    to: "Planning Plotter",
    contract: "World, characters, and story spine become compact chapter contracts, not scene lists.",
    evidence: "chapter_outlines skeletons; llm_calls planning-plotter",
  },
  {
    from: "Planning Plotter",
    to: "Scene Expansion",
    contract: "Scene expansion fills each chapter contract without borrowing future movement.",
    evidence: "scene count report, sequence guards, L111 boundary redaction tests",
  },
  {
    from: "Scene Expansion",
    to: "State Mapper",
    contract: "Mapper annotates existing entries; it does not rewrite descriptions or add hidden fallback fields.",
    evidence: "planning-state-mapper calls and materiality/obligation diagnostics",
  },
  {
    from: "Chapter Outline",
    to: "Writer Context",
    contract: "Writer receives current entry context, selected obligations, prior prose bridge, and scoped references.",
    evidence: "writer-context trace event and diagnostics:writer-context",
  },
  {
    from: "Writer",
    to: "Checkers",
    contract: "Generated prose is checked against plan, grounding, continuity, functional state, and integrity.",
    evidence: "checker llm_calls, validation findings, plan-check outcomes",
  },
  {
    from: "Diagnostics",
    to: "Plan Readiness",
    contract: "Diagnostics become reviewable items, not hidden automatic rewrites.",
    evidence: "plan_readiness_items and planning_edit proposals",
  },
  {
    from: "Planning Edit",
    to: "Downstream Drafting",
    contract: "Accepted edits carry target refs, versions, and mutation lineage into later draft/checker attribution.",
    evidence: "planning_mutation_lineage and proposal resolution impacts",
  },
  {
    from: "Trace + LLM Calls",
    to: "Workflow Atlas",
    contract: "The atlas overlays actual run behavior without changing runtime behavior.",
    evidence: "pipeline_events, llm_calls, chapter_outlines, chapter_drafts",
  },
]

const STATUS_LABELS: Record<AtlasStatus, string> = {
  "production-default": "production default",
  "seed-enabled": "seed enabled",
  "default-off": "default off",
  "diagnostic-only": "diagnostic only",
  "manual-review": "manual review",
  artifact: "artifact",
}

function statusLabel(status: AtlasStatus): string {
  return STATUS_LABELS[status]
}

function statusClass(status: AtlasStatus): string {
  return `status-${status}`
}

function sourceHref(source: string): string {
  return pathToFileURL(resolve(source)).href
}

function openPath(outPath: string): void {
  if (process.platform !== "darwin") {
    console.log(`open in browser: ${pathToFileURL(resolve(outPath)).href}`)
    return
  }
  spawnSync("open", [outPath], { stdio: "ignore" })
}

function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run"
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringOf(value: unknown): string {
  return value == null ? "" : String(value)
}

function numberOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null
  const parsed = numberOf(value)
  return Number.isFinite(parsed) ? parsed : null
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string") return value
  return ""
}

function shortDate(value: string): string {
  if (!value) return ""
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z")
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
  })[ch]!)
}

const CSS = `
  :root {
    color-scheme: light;
    --ink: #19222a;
    --muted: #64717d;
    --line: #d9e1e7;
    --soft: #f5f7f9;
    --panel: #ffffff;
    --blue: #1f6f9f;
    --green: #287c5b;
    --red: #ad3d3a;
    --gold: #9a6a16;
    --violet: #6b56a5;
    --cyan: #27757f;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #fbfcfd; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .atlas-header { display: flex; justify-content: space-between; gap: 24px; padding: 28px 32px 20px; background: #ffffff; border-bottom: 1px solid var(--line); }
  .eyebrow { margin: 0 0 6px; color: var(--blue); font-weight: 700; text-transform: uppercase; font-size: 12px; }
  h1 { margin: 0; font-size: 30px; letter-spacing: 0; }
  h2, h3, h4 { letter-spacing: 0; }
  .subtitle { max-width: 880px; color: var(--muted); margin: 8px 0 0; }
  .header-meta { align-self: flex-start; min-width: 230px; text-align: right; color: var(--muted); }
  .header-meta span { display: block; color: var(--ink); font-weight: 700; }
  .atlas-nav { position: sticky; top: 0; z-index: 2; display: flex; gap: 6px; padding: 10px 28px; border-bottom: 1px solid var(--line); background: rgba(251, 252, 253, 0.94); backdrop-filter: blur(8px); }
  .atlas-nav a { padding: 6px 10px; border: 1px solid transparent; border-radius: 6px; color: var(--ink); }
  .atlas-nav a:hover { border-color: var(--line); text-decoration: none; background: #fff; }
  main { max-width: 1440px; margin: 0 auto; padding: 22px 26px 70px; }
  .section { margin: 0 0 34px; }
  .section-head { display: flex; justify-content: space-between; gap: 24px; align-items: end; margin: 0 0 12px; }
  .section-head h2 { margin: 0; font-size: 22px; }
  .section-head p { max-width: 760px; margin: 0; color: var(--muted); }
  .panel, .component-card, .lane, .legend-card, .chapter-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
  .panel { padding: 16px; margin: 0 0 14px; }
  .panel h3 { margin: 0 0 10px; }
  .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .metric { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
  .metric span { display: block; color: var(--muted); font-size: 12px; }
  .metric strong { display: block; margin-top: 4px; font-size: 18px; overflow-wrap: anywhere; }
  .metric.good strong, .good-text { color: var(--green); }
  .metric.warn strong, .warn-text { color: var(--red); }
  .two-col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
  .kv { display: grid; grid-template-columns: minmax(120px, 220px) minmax(0, 1fr); gap: 6px 12px; }
  .kv dt { color: var(--muted); font-weight: 700; }
  .kv dd { margin: 0; overflow-wrap: anywhere; }
  .chip-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 4px 8px; background: var(--soft); }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  th { background: var(--soft); font-size: 12px; color: var(--muted); }
  tr:last-child td { border-bottom: 0; }
  .chapter-grid, .component-grid, .legend-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
  .chapter-card { padding: 12px; }
  .chapter-card h4 { margin: 8px 0 6px; }
  .chapter-card p { margin: 4px 0; color: var(--muted); }
  .chapter-top { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
  .ref-list { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 6px; }
  .ref-list code { border: 1px solid var(--line); border-radius: 4px; padding: 2px 4px; }
  .timeline { list-style: none; margin: 0; padding: 0; }
  .timeline li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line); }
  .timeline time { color: var(--muted); min-width: 185px; }
  .pipeline-map { display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 10px; }
  .pipeline-column { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 10px; min-height: 150px; }
  .pipeline-column h3 { margin: 0 0 8px; font-size: 15px; }
  .mini-card { border-left: 4px solid var(--line); padding: 8px; background: var(--soft); border-radius: 6px; margin-bottom: 7px; }
  .mini-card strong, .mini-card span { display: block; }
  .mini-card span { color: var(--muted); font-size: 12px; }
  .lane { padding: 14px; margin-bottom: 14px; }
  .lane-head { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 10px; }
  .lane-head h3 { margin: 0; }
  .lane-head p { margin: 0; color: var(--muted); max-width: 780px; }
  .component-card { padding: 13px; }
  .component-title { display: flex; justify-content: space-between; align-items: start; gap: 10px; }
  .component-title h4 { margin: 0; font-size: 16px; }
  .component-card p { color: var(--muted); margin: 8px 0; }
  .status { display: inline-flex; white-space: nowrap; border-radius: 999px; padding: 3px 7px; font-size: 11px; font-weight: 700; border: 1px solid currentColor; }
  .status-production-default { color: var(--green); }
  .status-seed-enabled { color: var(--blue); }
  .status-default-off { color: var(--gold); }
  .status-diagnostic-only { color: var(--cyan); }
  .status-manual-review { color: var(--violet); }
  .status-artifact { color: #59636d; }
  .list-block strong { display: block; margin-top: 8px; font-size: 12px; color: var(--muted); }
  .list-block ul { margin: 4px 0 0; padding-left: 18px; }
  .source-links, .decision-links { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
  .source-links a, .decision-links code { border: 1px solid var(--line); border-radius: 5px; padding: 3px 5px; background: var(--soft); font-size: 11px; }
  .legend-card { padding: 12px; }
  .legend-card p { margin: 8px 0 0; color: var(--muted); }
  .command-grid { display: grid; gap: 10px; }
  pre { margin: 0; overflow: auto; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: #111820; color: #edf3f7; }
  .muted { color: var(--muted); }
  @media (max-width: 780px) {
    .atlas-header, .section-head, .lane-head, .two-col { display: block; }
    .header-meta { text-align: left; margin-top: 14px; }
    .atlas-nav { overflow-x: auto; }
  }
`

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const result = await writeHarnessWorkflowAtlas(args)
  console.log(`Workflow atlas rendered: ${result.outPath} (${result.mode}, ${result.componentCount} components, ${result.timelineCount} timeline events)`)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
