/**
 * Render a persisted planner outline as a lightweight local HTML artifact.
 *
 * Usage:
 *   bun scripts/render-planner-outline-html.ts --novel <novel-id> [--out output/path/plan.html] [--open]
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { getChapterOutlines } from "../src/db/outlines"
import type { ChapterOutline, SceneBeat } from "../src/types"

export interface PlannerOutlineHtmlArgs {
  novelId: string
  outPath: string | null
  open: boolean
}

export function parseArgs(argv: string[]): PlannerOutlineHtmlArgs {
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

  if (!novelId) throw new Error("--novel <id> is required")
  return { novelId, outPath, open }
}

export async function writePlannerOutlineHtmlFromDb(args: {
  novelId: string
  outPath?: string | null
  open?: boolean
}): Promise<{ outPath: string; chapterCount: number; sceneCount: number }> {
  const chapters = await getChapterOutlines(args.novelId)
  if (chapters.length === 0) throw new Error(`no chapter outlines found for novel ${args.novelId}`)

  const outPath = args.outPath ?? `output/planner-outlines/${args.novelId}/plan.html`
  mkdirSync(dirname(outPath), { recursive: true })
  const html = renderPlannerOutlineHtml(args.novelId, chapters)
  writeFileSync(outPath, html)

  if (args.open) openPath(outPath)

  return {
    outPath,
    chapterCount: chapters.length,
    sceneCount: chapters.reduce((sum, chapter) => sum + (chapter.scenes?.length ?? 0), 0),
  }
}

export function renderPlannerOutlineHtml(novelId: string, chapters: readonly ChapterOutline[]): string {
  const sceneCount = chapters.reduce((sum, chapter) => sum + (chapter.scenes?.length ?? 0), 0)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(novelId)} Planner Outline</title>
  <style>
    :root { color-scheme: light; --ink:#1e252b; --muted:#5b6570; --line:#d8dde3; --soft:#f5f7f8; --accent:#265b75; }
    body { margin: 0; font: 16px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #fff; }
    header { padding: 28px 34px 18px; border-bottom: 1px solid var(--line); background: var(--soft); position: sticky; top: 0; z-index: 1; }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
    .meta { color: var(--muted); font-size: 13px; }
    main { max-width: 1120px; margin: 0 auto; padding: 24px 28px 60px; }
    article { border-bottom: 1px solid var(--line); padding: 24px 0; }
    h2 { margin: 0 0 8px; font-size: 21px; }
    .chapter-meta { color: var(--muted); margin: 0 0 12px; }
    .purpose { margin: 0 0 16px; }
    ol { padding-left: 24px; margin: 0; }
    li { margin: 0 0 15px; }
    .scene-head { display: flex; gap: 10px; align-items: baseline; justify-content: space-between; color: var(--accent); font-weight: 650; }
    code { font-size: 11px; color: var(--muted); white-space: nowrap; }
    p { margin: 5px 0; }
    dl { display: grid; grid-template-columns: 110px 1fr; gap: 4px 10px; margin: 8px 0 0; font-size: 14px; }
    dt { color: var(--muted); font-weight: 650; }
    dd { margin: 0; }
  </style>
</head>
<body>
  <header>
    <h1>Planner Outline</h1>
    <div class="meta">Novel ID: ${escapeHtml(novelId)} &middot; ${chapters.length} chapters &middot; ${sceneCount} scene entries</div>
  </header>
  <main>
${chapters.map(renderChapter).join("\n")}
  </main>
</body>
</html>
`
}

function renderChapter(chapter: ChapterOutline): string {
  return `    <article>
      <h2>Chapter ${escapeHtml(chapter.chapterNumber)}: ${escapeHtml(chapter.title)}</h2>
      <div class="chapter-meta">POV: ${escapeHtml(chapter.povCharacter)} &middot; Setting: ${escapeHtml(chapter.setting)} &middot; Target: ${escapeHtml(chapter.targetWords)} words &middot; Scenes: ${chapter.scenes?.length ?? 0}</div>
      <p class="purpose"><strong>Purpose:</strong> ${escapeHtml(chapter.purpose)}</p>
      <ol>
${(chapter.scenes ?? []).map(renderScene).join("\n")}
      </ol>
    </article>`
}

function renderScene(scene: SceneBeat, index: number): string {
  return `        <li>
          <div class="scene-head"><span>${index + 1}. ${escapeHtml(scene.kind ?? "scene")}</span>${scene.sceneId ? `<code>${escapeHtml(scene.sceneId)}</code>` : ""}</div>
          <p>${escapeHtml(scene.description)}</p>
${renderSceneTurnFields(scene)}
        </li>`
}

function renderSceneTurnFields(scene: SceneBeat): string {
  const rows = [
    ["Goal", scene.goal],
    ["Opposition", scene.opposition],
    ["Outcome", scene.outcome],
    ["Consequence", scene.consequence],
  ].filter((row): row is [string, string] => typeof row[1] === "string" && row[1].trim().length > 0)

  if (rows.length === 0) return ""
  return `          <dl>
${rows.map(([label, value]) => `            <dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join("\n")}
          </dl>`
}

function openPath(outPath: string): void {
  if (process.platform !== "darwin") {
    console.log(`open in browser: file://${resolve(outPath)}`)
    return
  }
  spawnSync("open", [outPath], { stdio: "ignore" })
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
  })[ch]!)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const result = await writePlannerOutlineHtmlFromDb({
    novelId: args.novelId,
    outPath: args.outPath,
    open: args.open,
  })
  console.log(`HTML rendered: ${result.outPath} (${result.chapterCount} chapters, ${result.sceneCount} scenes)`)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
