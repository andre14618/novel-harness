import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, relative, resolve } from "node:path"

export interface RunManifestArtifact {
  role: string
  path: string
  sha256: string
  bytes: number
}

export interface RunManifest {
  schemaVersion: "1.0"
  generatedAt: string
  laneId: string
  phase: string
  runId: string
  rootRunId: string
  parentRunId: string | null
  variantId: string
  command: {
    name: string
    argv: string[]
  }
  model: {
    provider: string
    model: string
    thinking?: boolean
  } | null
  inputs: RunManifestArtifact[]
  outputs: RunManifestArtifact[]
  relatedRunIds: string[]
  metadata: Record<string, unknown>
}

export interface BuildRunManifestInput {
  generatedAt: string
  laneId: string
  phase: string
  variantId: string
  runId?: string | null
  rootRunId?: string | null
  parentRunId?: string | null
  command: RunManifest["command"]
  model?: RunManifest["model"]
  inputs?: RunManifestArtifact[]
  outputs?: RunManifestArtifact[]
  relatedRunIds?: string[]
  metadata?: Record<string, unknown>
  discriminator?: string
}

export const RUN_MANIFEST_FILENAME = "run-manifest.json"

export function buildRunManifest(input: BuildRunManifestInput): RunManifest {
  const relatedRunIds = uniqueStrings(input.relatedRunIds ?? [])
  const runId = input.runId ?? makeDiagnosticRunId({
    phase: input.phase,
    variantId: input.variantId,
    generatedAt: input.generatedAt,
    discriminator: input.discriminator,
  })
  return {
    schemaVersion: "1.0",
    generatedAt: input.generatedAt,
    laneId: input.laneId,
    phase: input.phase,
    runId,
    rootRunId: input.rootRunId ?? input.parentRunId ?? runId,
    parentRunId: input.parentRunId ?? null,
    variantId: input.variantId,
    command: input.command,
    model: input.model ?? null,
    inputs: input.inputs ?? [],
    outputs: input.outputs ?? [],
    relatedRunIds,
    metadata: input.metadata ?? {},
  }
}

export function makeDiagnosticRunId(input: {
  phase: string
  variantId: string
  generatedAt: string
  discriminator?: string | null
}): string {
  return [
    safeSlug(input.phase),
    safeSlug(input.variantId),
    input.discriminator ? safeSlug(input.discriminator) : null,
    timestampToken(input.generatedAt),
  ].filter(Boolean).join("-").slice(0, 180)
}

export function artifactRef(path: string, role: string, cwd = process.cwd()): RunManifestArtifact {
  const absolute = resolve(cwd, path)
  const data = readFileSync(absolute)
  const stat = statSync(absolute)
  return {
    role,
    path: repoRelativePath(absolute, cwd),
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: stat.size,
  }
}

export function existingArtifactRefs(
  paths: Array<{ path: string; role: string }>,
  cwd = process.cwd(),
): RunManifestArtifact[] {
  const refs: RunManifestArtifact[] = []
  for (const item of paths) {
    if (existsSync(resolve(cwd, item.path))) refs.push(artifactRef(item.path, item.role, cwd))
  }
  return refs
}

export function readRunManifestIfExists(path: string, cwd = process.cwd()): RunManifest | null {
  const absolute = resolve(cwd, path)
  if (!existsSync(absolute)) return null
  const parsed = JSON.parse(readFileSync(absolute, "utf8")) as RunManifest
  const errors = validateRunManifest(parsed)
  if (errors.length > 0) throw new Error(`invalid run manifest ${repoRelativePath(absolute, cwd)}: ${errors.join("; ")}`)
  return parsed
}

export function writeRunManifest(path: string, manifest: RunManifest, cwd = process.cwd()): void {
  const errors = validateRunManifest(manifest)
  if (errors.length > 0) throw new Error(`invalid run manifest: ${errors.join("; ")}`)
  const absolute = resolve(cwd, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(manifest, null, 2)}\n`)
}

export function validateRunManifest(manifest: RunManifest): string[] {
  const errors: string[] = []
  if (manifest.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0")
  for (const [field, value] of [
    ["generatedAt", manifest.generatedAt],
    ["laneId", manifest.laneId],
    ["phase", manifest.phase],
    ["runId", manifest.runId],
    ["rootRunId", manifest.rootRunId],
    ["variantId", manifest.variantId],
    ["command.name", manifest.command?.name],
  ] as Array<[string, unknown]>) {
    if (typeof value !== "string" || value.trim() === "") errors.push(`${field} is required`)
  }
  if (manifest.parentRunId !== null && (typeof manifest.parentRunId !== "string" || manifest.parentRunId.trim() === "")) {
    errors.push("parentRunId must be null or non-empty string")
  }
  for (const collectionName of ["inputs", "outputs"] as const) {
    const paths = new Set<string>()
    for (const artifact of manifest[collectionName]) {
      if (!artifact.role) errors.push(`${collectionName} artifact missing role`)
      if (!artifact.path) errors.push(`${collectionName} artifact missing path`)
      if (!/^[a-f0-9]{64}$/u.test(artifact.sha256)) errors.push(`${collectionName} ${artifact.path || "artifact"} missing sha256`)
      if (!Number.isFinite(artifact.bytes) || artifact.bytes < 0) errors.push(`${collectionName} ${artifact.path || "artifact"} has invalid bytes`)
      if (artifact.path) {
        if (paths.has(artifact.path)) errors.push(`${collectionName} duplicate artifact path: ${artifact.path}`)
        paths.add(artifact.path)
      }
    }
  }
  return errors
}

export function parentManifestForPocDir(pocDir: string, cwd = process.cwd()): RunManifest | null {
  return readRunManifestIfExists(resolve(cwd, pocDir, RUN_MANIFEST_FILENAME), cwd)
}

export function manifestPathForSidecar(outputPath: string): string {
  return `${outputPath}.manifest.json`
}

export function repoRelativePath(path: string, cwd = process.cwd()): string {
  const relativePath = relative(cwd, resolve(cwd, path)) || "."
  return relativePath.split(/[\\/]/u).join("/")
}

export function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "run"
}

function timestampToken(value: string): string {
  const date = new Date(value)
  const iso = Number.isNaN(date.getTime()) ? value : date.toISOString()
  return iso.replace(/[^0-9]/gu, "").slice(0, 17) || "00000000000000000"
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(value => typeof value === "string" && value.trim() !== ""))]
}
