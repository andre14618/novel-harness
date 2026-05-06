import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { resolve, relative, isAbsolute } from "node:path"

export interface SemanticGateCohortMatrixRouteOptions {
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
  generatedAt: string | null
  matrixRuns: number | null
  reportedMatrices: number | null
  failedMatrices: number | null
  variantRuns: number | null
  completedVariantRuns: number | null
  cleanPass: number | null
  costUsd: number | null
  topVariantLabel: string | null
  topMeanRiskScore: number | null
  topCompleted: number | null
  topRuns: number | null
  topReasons: string[]
  topRiskDrivers: string[]
  mtimeMs: number
}

export async function handleSemanticGateCohortMatrixRoute(
  req: Request,
  url: URL,
  options: SemanticGateCohortMatrixRouteOptions = {},
): Promise<Response | null> {
  if (req.method !== "GET") return null

  const listMatch = /^\/api\/diagnostics\/semantic-gate-cohort-matrix\/?$/.exec(url.pathname)
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
        { ok: false, error: `semantic-gate-cohort-matrix list failed: ${errorMessage(err)}` },
        { status: 500 },
      )
    }
  }

  const detailMatch = /^\/api\/diagnostics\/semantic-gate-cohort-matrix\/([^/]+)\/?$/.exec(url.pathname)
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
      { ok: false, error: `semantic-gate-cohort-matrix failed: ${errorMessage(err)}` },
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
    throw new RouteLookupError("semantic-gate-cohort-matrix run not found", 404)
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

function baseDirFor(options: SemanticGateCohortMatrixRouteOptions): string {
  if (options.baseDir) return resolve(options.baseDir)
  const harnessRoot = process.env.HARNESS_ROOT ?? resolve(import.meta.dir, "../..")
  return resolve(harnessRoot, "output/evals/semantic-gate-cohort-matrix")
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
  const totals = object.totals && typeof object.totals === "object" ? object.totals as Record<string, unknown> : {}
  return {
    generatedAt: stringValue(object.generatedAt),
    matrixRuns: numberValue(totals.matrixRuns),
    reportedMatrices: numberValue(totals.reportedMatrices),
    failedMatrices: numberValue(totals.failedMatrices),
    variantRuns: numberValue(totals.variantRuns),
    completedVariantRuns: numberValue(totals.completedVariantRuns),
    cleanPass: numberValue(totals.cleanPass),
    costUsd: numberValue(totals.costUsd),
    ...summarizeTopRankedVariant(object.ranking),
  }
}

function summarizeTopRankedVariant(ranking: unknown): Pick<
  ListRunSummary,
  "topVariantLabel" | "topMeanRiskScore" | "topCompleted" | "topRuns" | "topReasons" | "topRiskDrivers"
> {
  const first = Array.isArray(ranking) ? ranking[0] : null
  const top = first && typeof first === "object" ? first as Record<string, unknown> : {}

  return {
    topVariantLabel: stringValue(top.label),
    topMeanRiskScore: numberValue(top.meanRiskScore),
    topCompleted: numberValue(top.completed),
    topRuns: numberValue(top.runs),
    topReasons: stringArray(top.topReasons, 4),
    topRiskDrivers: stringArray(top.topRiskDrivers, 4),
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string")
    ? value.slice(0, limit)
    : []
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
