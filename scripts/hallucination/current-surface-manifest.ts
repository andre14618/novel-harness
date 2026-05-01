#!/usr/bin/env bun
/**
 * Freeze the current planner -> writer -> checker surface for checker datasets.
 *
 * Usage:
 *   bun scripts/hallucination/current-surface-manifest.ts
 *   bun scripts/hallucination/current-surface-manifest.ts --out /tmp/current-surface.json
 */

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { AGENT_MODELS } from "../../src/models/roles"

const SURFACE_FILES = [
  "src/models/roles.ts",
  "src/config/pipeline.ts",
  "src/schemas/shared.ts",
  "src/harness/enforce.ts",
  "src/phases/planning.ts",
  "src/phases/drafting.ts",
  "src/phases/beat-checks.ts",
  "src/agents/planning-plotter/chapter-outline-system.md",
  "src/agents/planning-plotter/context.ts",
  "src/agents/planning-plotter/schema.ts",
  "src/agents/planning-beats/beat-expansion-system.md",
  "src/agents/planning-beats/context.ts",
  "src/agents/planning-beats/schema.ts",
  "src/agents/writer/beat-writer-system.md",
  "src/agents/writer/beat-context.ts",
  "src/agents/writer/beat-context-render.ts",
  "src/agents/writer/retry-context.ts",
  "src/agents/writer/reference-resolver.ts",
  "src/agents/writer/adherence-checker.ts",
  "src/agents/halluc-ungrounded/halluc-ungrounded-system.md",
  "src/agents/halluc-ungrounded/context.ts",
  "src/agents/halluc-ungrounded/index.ts",
  "src/phases/beat-entity-list.ts",
] as const

const SURFACED_FIELDS = [
  {
    field: "scene.description",
    plannerOutput: true,
    writerVisible: true,
    hallucCheckerVisible: true,
    adherenceCheckerVisible: true,
    notes: "Primary beat brief text.",
  },
  {
    field: "scene.characters",
    plannerOutput: true,
    writerVisible: true,
    hallucCheckerVisible: true,
    adherenceCheckerVisible: true,
    notes: "Rendered as present characters and drives character snapshots/checks.",
  },
  {
    field: "scene.kind",
    plannerOutput: true,
    writerVisible: true,
    hallucCheckerVisible: true,
    adherenceCheckerVisible: true,
    notes: "Rendered as Kind.",
  },
  {
    field: "scene.requiredPayoffs",
    plannerOutput: true,
    writerVisible: "resolved_fact_text_only",
    hallucCheckerVisible: "derived_entities_only",
    adherenceCheckerVisible: false,
    notes: "Writer sees SEEDS/PAYOFFS DUE fact text after fact_id resolution; raw ids are not writer-facing.",
  },
  {
    field: "establishedFacts",
    plannerOutput: true,
    writerVisible: "only_via_descriptions_or_payoff_links",
    hallucCheckerVisible: "proper_nouns_from_facts",
    adherenceCheckerVisible: false,
    notes: "Full list is checker-visible later, but not directly rendered to the beat writer.",
  },
  {
    field: "characterStateChanges",
    plannerOutput: true,
    writerVisible: false,
    hallucCheckerVisible: false,
    adherenceCheckerVisible: false,
    notes: "Current chapter end-state is not writer-visible; beat writer sees persisted state entering the chapter.",
  },
  {
    field: "knowledgeChanges",
    plannerOutput: true,
    writerVisible: false,
    hallucCheckerVisible: false,
    adherenceCheckerVisible: false,
    notes: "Must be encoded in beat descriptions if the writer is expected to dramatize it.",
  },
  {
    field: "valueShifted",
    plannerOutput: true,
    writerVisible: false,
    hallucCheckerVisible: false,
    adherenceCheckerVisible: false,
    notes: "Soft structural prior accepted by schema but not in active writer/checker prompts.",
  },
  {
    field: "gapPresent",
    plannerOutput: true,
    writerVisible: false,
    hallucCheckerVisible: false,
    adherenceCheckerVisible: false,
    notes: "Soft structural prior accepted by schema but not in active writer/checker prompts.",
  },
  {
    field: "lifeValueAxes",
    plannerOutput: true,
    writerVisible: false,
    hallucCheckerVisible: false,
    adherenceCheckerVisible: false,
    notes: "Soft structural prior accepted by schema but not in active writer/checker prompts.",
  },
  {
    field: "miceActive/miceOpens/miceCloses",
    plannerOutput: true,
    writerVisible: false,
    hallucCheckerVisible: false,
    adherenceCheckerVisible: false,
    notes: "Soft structural prior accepted by schema but not in active writer/checker prompts.",
  },
]

function parseArgs(): { out?: string } {
  const args = process.argv.slice(2)
  let out: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i]
  }
  return { out }
}

async function git(args: string[]): Promise<string | null> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" })
  const code = await proc.exited
  if (code !== 0) return null
  return (await new Response(proc.stdout).text()).trim()
}

function sha256(path: string): string {
  const data = readFileSync(path)
  return createHash("sha256").update(data).digest("hex")
}

async function main() {
  const { out } = parseArgs()
  const root = resolve(import.meta.dir, "../..")
  const gitCommit = await git(["rev-parse", "HEAD"])
  const gitStatus = await git(["status", "--short"])
  const deployedMarkerPath = resolve(root, ".deployed_commit")

  const manifest = {
    manifest_version: "current-surface-v1",
    created_at: new Date().toISOString(),
    git_commit: gitCommit,
    deployed_commit_marker: existsSync(deployedMarkerPath)
      ? readFileSync(deployedMarkerPath, "utf8").trim()
      : null,
    dirty_worktree: Boolean(gitStatus),
    beat_entity_list_variant: process.env.BEAT_ENTITY_LIST_VARIANT ?? "v1",
    writer_conditioning: process.env.WRITER_CONDITIONING ?? null,
    model_roles: Object.fromEntries(
      [
        "planning-plotter",
        "planning-beats",
        "reference-resolver",
        "beat-writer",
        "adherence-events",
        "halluc-ungrounded",
      ].map(agent => [agent, AGENT_MODELS[agent]]),
    ),
    surface_files: SURFACE_FILES.map(path => ({
      path,
      sha256: sha256(resolve(root, path)),
    })),
    surfaced_fields: SURFACED_FIELDS,
  }

  const text = JSON.stringify(manifest, null, 2) + "\n"
  if (out) {
    const outPath = resolve(out)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, text)
    console.log(`Wrote ${outPath}`)
  } else {
    process.stdout.write(text)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
