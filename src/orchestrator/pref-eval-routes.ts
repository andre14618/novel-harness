/**
 * Preference evaluation API routes.
 *
 * Routes under /api/pref-eval/:evalName:
 *   GET  /api/pref-eval/:evalName         — load saved ratings (paragraph_index + chosen_model)
 *   POST /api/pref-eval/:evalName         — upsert a single rating
 *   GET  /api/pref-eval/:evalName/export  — DPO JSONL download
 */

import { upsertPref, getPrefs, exportDpo } from "../db/pref-eval"

export async function handlePrefEvalRoute(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname

  // ── Load ratings ─────────────────────────────────────────────────────
  const loadMatch = path.match(/^\/api\/pref-eval\/([^/]+)$/)
  if (loadMatch && req.method === "GET") {
    try {
      const evalName = decodeURIComponent(loadMatch[1])
      const rows = await getPrefs(evalName)
      return Response.json({ ratings: rows })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Save a rating ─────────────────────────────────────────────────────
  if (loadMatch && req.method === "POST") {
    try {
      const evalName = decodeURIComponent(loadMatch[1])
      const body = await req.json()
      await upsertPref(evalName, {
        paragraphIndex: body.paragraphIndex,
        inputText:      body.inputText,
        chosenText:     body.chosenText,
        rejectedText:   body.rejectedText,
        chosenModel:    body.chosenModel,
        rejectedModel:  body.rejectedModel,
      })
      return Response.json({ ok: true })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Export DPO JSONL ──────────────────────────────────────────────────
  const exportMatch = path.match(/^\/api\/pref-eval\/([^/]+)\/export$/)
  if (exportMatch && req.method === "GET") {
    try {
      const evalName = decodeURIComponent(exportMatch[1])
      const jsonl = await exportDpo(evalName)
      return new Response(jsonl, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": `attachment; filename="${evalName}-dpo.jsonl"`,
        },
      })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  return null
}
