import { loadChapterHealthReport } from "../harness/chapter-health"

export async function handleChapterHealthRoute(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/novel\/([^/]+)\/chapter-health$/)
  if (!match || req.method !== "GET") return null

  const novelId = decodeURIComponent(match[1])
  const chapterParam = url.searchParams.get("chapter")
  const chapter = parseChapter(chapterParam)
  if (chapterParam !== null && chapter === null) {
    return Response.json(
      { ok: false, error: "invalid chapter query parameter" },
      { status: 400 },
    )
  }

  try {
    const report = await loadChapterHealthReport(
      novelId,
      typeof chapter === "number" ? { chapter } : {},
    )
    return Response.json(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = /^Novel .+ not found$/.test(message) ? 404 : 500
    return Response.json(
      { ok: false, error: `chapter-health failed: ${message}` },
      { status },
    )
  }
}

function parseChapter(value: string | null): number | undefined | null {
  if (value === null || value.trim() === "") return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== value.trim()) return null
  return parsed
}
