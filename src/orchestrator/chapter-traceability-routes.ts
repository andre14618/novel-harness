import {
  ChapterTraceabilityLookupError,
  loadChapterTraceabilityReport,
} from "../harness/chapter-traceability"

export async function handleChapterTraceabilityRoute(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/novel\/([^/]+)\/traceability\/chapter\/([^/]+)$/)
  if (!match || req.method !== "GET") return null

  const novelId = decodeURIComponent(match[1])
  const chapter = parseChapter(decodeURIComponent(match[2]))
  if (chapter === null) {
    return Response.json(
      { ok: false, error: "invalid chapter path parameter" },
      { status: 400 },
    )
  }

  try {
    return Response.json(await loadChapterTraceabilityReport(novelId, chapter))
  } catch (err) {
    if (err instanceof ChapterTraceabilityLookupError) {
      return Response.json({ ok: false, error: err.message }, { status: err.status })
    }
    const message = err instanceof Error ? err.message : String(err)
    const status = /^Novel .+ not found/.test(message) ? 404 : 500
    return Response.json(
      { ok: false, error: `chapter-traceability failed: ${message}` },
      { status },
    )
  }
}

function parseChapter(value: string): number | null {
  if (value.trim() === "") return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== value.trim()) return null
  return parsed
}
