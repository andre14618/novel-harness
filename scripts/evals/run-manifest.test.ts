import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  artifactRef,
  buildRunManifest,
  makeDiagnosticRunId,
  readRunManifestIfExists,
  validateRunManifest,
  writeRunManifest,
} from "./run-manifest"

describe("run-manifest", () => {
  test("builds a deterministic diagnostic run id and hashes artifact refs", () => {
    const root = mkdtempSync(join(tmpdir(), "run-manifest-"))
    try {
      const artifactPath = join(root, "packet.json")
      writeFileSync(artifactPath, "{\"ok\":true}\n")

      const ref = artifactRef(artifactPath, "packet")
      expect(ref.role).toBe("packet")
      expect(ref.path.endsWith("packet.json")).toBe(true)
      expect(ref.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(ref.bytes).toBe(12)

      const runId = makeDiagnosticRunId({
        phase: "Corpus Recreation POC",
        variantId: "materiality-v1",
        discriminator: "chapter 1",
        generatedAt: "2026-05-09T12:34:56.789Z",
      })
      expect(runId).toBe("corpus-recreation-poc-materiality-v1-chapter-1-20260509123456789")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("validates and round-trips a manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "run-manifest-"))
    try {
      mkdirSync(join(root, "out"), { recursive: true })
      writeFileSync(join(root, "out", "report.md"), "# Report\n")
      const manifest = buildRunManifest({
        generatedAt: "2026-05-09T12:34:56.789Z",
        laneId: "run-thread-id-drafting-coherence",
        phase: "corpus-recreation-review",
        variantId: "baseline",
        parentRunId: "parent-run",
        command: { name: "diagnostics:corpus-recreation-review", argv: ["--poc-dir", "out"] },
        outputs: [artifactRef(join(root, "out", "report.md"), "report")],
      })

      expect(manifest.rootRunId).toBe("parent-run")
      expect(validateRunManifest(manifest)).toEqual([])

      const manifestPath = join(root, "out", "run-manifest.json")
      writeRunManifest(manifestPath, manifest)
      expect(readRunManifestIfExists(manifestPath)).toEqual(manifest)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("flags duplicate artifact paths and malformed hashes", () => {
    const manifest = buildRunManifest({
      generatedAt: "2026-05-09T12:34:56.789Z",
      laneId: "run-thread-id-drafting-coherence",
      phase: "phase",
      variantId: "baseline",
      command: { name: "cmd", argv: [] },
      inputs: [
        { role: "a", path: "same.json", sha256: "bad", bytes: 1 },
        { role: "b", path: "same.json", sha256: "0".repeat(64), bytes: 1 },
      ],
    })

    const errors = validateRunManifest(manifest)
    expect(errors.some(error => error.includes("missing sha256"))).toBe(true)
    expect(errors.some(error => error.includes("duplicate artifact path"))).toBe(true)
  })
})
