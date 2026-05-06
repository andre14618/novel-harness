import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { resolve, relative, isAbsolute } from "node:path"

export interface SemanticGateBaselineRouteOptions {
  baseDir?: string
}

interface RunArtifact {
  ok: true
  runId: string
  summaryPath: string
  reportPath: string | null
  report: unknown
  reportMarkdown: string | null
}

interface ListRunSummary {
  runId: string
  summaryPath: string
  reportPath: string | null
  sourceNovelId: string | null
  generatedAt: string | null
  novelId: string | null
  chapters: number | null
  maxBeatsPerChapter: number | null
  terminalStatus: string | null
  terminalReason: string | null
  approvedChapters: number | null
  latestChapters: number | null
  totalWords: number | null
  llmCalls: number | null
  costUsd: number | null
  proposalTotal: number | null
  mtimeMs: number
}

export async function handleSemanticGateBaselineRoute(
  req: Request,
  url: URL,
  options: SemanticGateBaselineRouteOptions = {},
): Promise<Response | null> {
  if (req.method !== "GET") return null

  const listMatch = /^\/api\/diagnostics\/semantic-gate-baseline\/?$/.exec(url.pathname)
  if (listMatch) {
    const limit = parseLimit(url.searchParams.get("limit"))
    if (limit === null) {
      return Response.json(
        { ok: false, error: "invalid limit query parameter" },
        { status: 400 },
      )
    }

    try {
      const runs = await listRunSummaries(baseDirFor(options), limit)
      return Response.json({ ok: true, runs })
    } catch (err) {
      return Response.json(
        { ok: false, error: `semantic-gate-baseline list failed: ${errorMessage(err)}` },
        { status: 500 },
      )
    }
  }

  const detailMatch = /^\/api\/diagnostics\/semantic-gate-baseline\/([^/]+)\/?$/.exec(url.pathname)
  if (!detailMatch) return null

  const rawRunId = detailMatch[1]!
  if (hasEncodedPathSeparator(rawRunId)) {
    return Response.json({ ok: false, error: "invalid runId" }, { status: 400 })
  }

  let runId: string
  try {
    runId = decodeURIComponent(rawRunId)
  } catch {
    return Response.json({ ok: false, error: "invalid runId" }, { status: 400 })
  }

  const validationError = validateRunId(runId)
  if (validationError) {
    return Response.json({ ok: false, error: validationError }, { status: 400 })
  }

  try {
    return Response.json(await loadRunArtifact(baseDirFor(options), runId))
  } catch (err) {
    if (err instanceof RouteLookupError) {
      return Response.json({ ok: false, error: err.message }, { status: err.status })
    }
    return Response.json(
      { ok: false, error: `semantic-gate-baseline failed: ${errorMessage(err)}` },
      { status: 500 },
    )
  }
}

async function listRunSummaries(baseDir: string, limit: number): Promise<ListRunSummary[]> {
  const baseReal = await realpath(baseDir).catch(() => null)
  if (baseReal === null) return []

  const entries = await readdir(baseReal, { withFileTypes: true })
  const candidates = await Promise.all(entries
    .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
    .map(async (entry): Promise<ListRunSummary | null> => {
      const validationError = validateRunId(entry.name)
      if (validationError) return null
      try {
        const artifact = await loadRunArtifact(baseReal, entry.name, { includeMarkdown: false })
        const summaryStat = await stat(artifact.summaryPath)
        return {
          runId: artifact.runId,
          summaryPath: artifact.summaryPath,
          reportPath: artifact.reportPath,
          ...summarizeReport(artifact.report),
          mtimeMs: summaryStat.mtimeMs,
        }
      } catch {
        return null
      }
    }))

  return candidates
    .filter((run): run is ListRunSummary => run !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.runId.localeCompare(a.runId))
    .slice(0, limit)
}

async function loadRunArtifact(
  baseDir: string,
  runId: string,
  options: { includeMarkdown?: boolean } = {},
): Promise<RunArtifact> {
  const baseReal = await realpath(baseDir).catch(() => null)
  const canonicalBase = baseReal ?? resolve(baseDir)
  const runDir = resolve(canonicalBase, runId)
  if (baseReal && !isInside(baseReal, runDir)) {
    throw new RouteLookupError("invalid runId", 400)
  }

  let runDirReal: string
  try {
    runDirReal = await realpath(runDir)
  } catch {
    throw new RouteLookupError("semantic-gate-baseline run not found", 404)
  }

  if (baseReal && !isInside(baseReal, runDirReal)) {
    throw new RouteLookupError("invalid runId", 400)
  }

  const summaryPath = resolve(runDirReal, "summary.json")
  const reportPath = resolve(runDirReal, "report.md")
  if (!isInside(runDirReal, summaryPath) || !isInside(runDirReal, reportPath)) {
    throw new RouteLookupError("invalid run artifact path", 400)
  }

  let summaryReal: string
  try {
    summaryReal = await realpath(summaryPath)
  } catch (err) {
    if (isMissingFileError(err)) {
      throw new RouteLookupError("summary.json not found", 404)
    }
    throw err
  }
  if (!isInside(runDirReal, summaryReal)) {
    throw new RouteLookupError("invalid run artifact path", 400)
  }
  const summaryFile = await stat(summaryReal)
  if (!summaryFile.isFile()) {
    throw new RouteLookupError("summary.json not found", 404)
  }

  const report: unknown = JSON.parse(await readFile(summaryReal, "utf8"))

  const reportReal = await realpath(reportPath).catch((err) => {
    if (isMissingFileError(err)) return null
    throw err
  })
  if (reportReal !== null && !isInside(runDirReal, reportReal)) {
    throw new RouteLookupError("invalid run artifact path", 400)
  }
  const reportExists = reportReal !== null
    ? await stat(reportReal).then(s => s.isFile(), () => false)
    : false
  const includeMarkdown = options.includeMarkdown ?? true
  const reportMarkdown = reportExists && includeMarkdown
    ? await readFile(reportReal!, "utf8")
    : null

  return {
    ok: true,
    runId,
    summaryPath,
    reportPath: reportExists ? reportPath : null,
    report,
    reportMarkdown,
  }
}

function baseDirFor(options: SemanticGateBaselineRouteOptions): string {
  if (options.baseDir) return resolve(options.baseDir)
  const harnessRoot = process.env.HARNESS_ROOT ?? resolve(import.meta.dir, "../..")
  return resolve(harnessRoot, "output/evals/semantic-gate-baseline")
}

function validateRunId(runId: string): string | null {
  if (runId.trim() === "") return "invalid runId"
  if (runId === "." || runId === "..") return "invalid runId"
  if (runId.includes("\0")) return "invalid runId"
  if (runId.includes("/") || runId.includes("\\")) return "invalid runId"
  if (runId.includes("..")) return "invalid runId"
  return null
}

function hasEncodedPathSeparator(value: string): boolean {
  return /%(?:2f|5c)/i.test(value)
}

function parseLimit(value: string | null): number | null {
  if (value === null || value.trim() === "") return 20
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100 || String(parsed) !== value.trim()) {
    return null
  }
  return parsed
}

function isInside(basePath: string, targetPath: string): boolean {
  const rel = relative(basePath, targetPath)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function summarizeReport(report: unknown): Omit<ListRunSummary, "runId" | "summaryPath" | "reportPath" | "mtimeMs"> {
  const object = report && typeof report === "object" ? report as Record<string, unknown> : {}
  const terminal = object.terminal && typeof object.terminal === "object" ? object.terminal as Record<string, unknown> : {}
  const drafts = object.drafts && typeof object.drafts === "object" ? object.drafts as Record<string, unknown> : {}
  const llm = object.llm && typeof object.llm === "object" ? object.llm as Record<string, unknown> : {}
  const proposals = object.proposals && typeof object.proposals === "object" ? object.proposals as Record<string, unknown> : {}

  return {
    sourceNovelId: stringValue(object.sourceNovelId),
    generatedAt: stringValue(object.generatedAt),
    novelId: stringValue(object.novelId),
    chapters: numberValue(object.chapters),
    maxBeatsPerChapter: nullableNumberValue(object.maxBeatsPerChapter),
    terminalStatus: stringValue(terminal.status),
    terminalReason: stringValue(terminal.reason),
    approvedChapters: numberValue(drafts.approvedChapters),
    latestChapters: numberValue(drafts.latestChapters),
    totalWords: numberValue(drafts.totalWords),
    llmCalls: numberValue(llm.calls),
    costUsd: numberValue(llm.costUsd),
    proposalTotal: numberValue(proposals.total),
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function nullableNumberValue(value: unknown): number | null {
  return value === null ? null : numberValue(value)
}

function isMissingFileError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "ENOENT")
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

class RouteLookupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}
