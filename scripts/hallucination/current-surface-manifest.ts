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
  "src/harness/beat-obligations.ts",
  "src/harness/enforce.ts",
  "src/harness/ids.ts",
  "src/harness/stable-id-trace.ts",
  "src/phases/planning.ts",
  "src/phases/drafting.ts",
  "src/phases/scene-checks.ts",
  "src/agents/planning-plotter/chapter-outline-system.md",
  "src/agents/planning-plotter/context.ts",
  "src/agents/planning-plotter/schema.ts",
  "src/agents/planning-scenes/scene-expansion-system.md",
  "src/agents/planning-scenes/context.ts",
  "src/agents/planning-scenes/schema.ts",
  "src/agents/planning-state-mapper/state-mapper-system.md",
  "src/agents/planning-state-mapper/context.ts",
  "src/agents/planning-state-mapper/schema.ts",
  "src/agents/planning-state-repair/state-repair-system.md",
  "src/agents/planning-state-repair/context.ts",
  "src/agents/planning-state-repair/schema.ts",
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
    field: "scene.obligations",
    plannerOutput: true,
    writerVisible: "rendered_as_BEAT_OBLIGATIONS",
    hallucCheckerVisible: "derived_entities_only",
    adherenceCheckerVisible: true,
    notes: "Writer-visible writer/checker shared surface (added 2026-05-01 via stable-ID contract). Each obligation's text + sourceKind + characterId/characterName is rendered into the BEAT OBLIGATIONS section of the beat-writer prompt and the adherence-events checker context. obligationId/sourceId are persisted in llm_calls.request_json for inspector drill-down but not rendered into prose-facing prompt bytes.",
  },
  {
    field: "establishedFacts",
    plannerOutput: true,
    writerVisible: "via_obligations_or_payoff_links",
    hallucCheckerVisible: "proper_nouns_from_facts",
    adherenceCheckerVisible: false,
    notes: "Each fact's stable id MUST appear as the sourceId of a mustEstablish/mustPayOff obligation OR a requiredPayoffs link, per planning-state-mapper coverage rules. Writer sees the fact's text via the linked obligation's text field, not the chapter-level array directly.",
  },
  {
    field: "characterStateChanges",
    plannerOutput: true,
    writerVisible: "via_mustShowStateChange_obligations",
    hallucCheckerVisible: false,
    adherenceCheckerVisible: true,
    notes: "Each state change's stable id MUST appear as the sourceId of at least one mustShowStateChange obligation. Writer sees the state change via the linked obligation's text + characterName, not the chapter-level array. characterStateChanges entries that escape coverage validation cannot reach the writer.",
  },
  {
    field: "knowledgeChanges",
    plannerOutput: true,
    writerVisible: "via_mustTransferKnowledge_obligations",
    hallucCheckerVisible: false,
    adherenceCheckerVisible: true,
    notes: "Each knowledge change's stable id MUST appear as the sourceId of exactly one mustTransferKnowledge obligation. Writer sees the knowledge change via the linked obligation's text + characterName. knowledgeChanges entries that escape coverage validation cannot reach the writer.",
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

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

async function main() {
  const { out } = parseArgs()
  const root = resolve(import.meta.dir, "../..")
  const gitCommit = await git(["rev-parse", "HEAD"])
  const gitStatus = await git(["status", "--short"])
  const deployedMarkerPath = resolve(root, ".deployed_commit")
  const deployedCommitMarker = existsSync(deployedMarkerPath)
    ? readFileSync(deployedMarkerPath, "utf8").trim()
    : null
  const surfaceFiles = SURFACE_FILES.map(path => ({
    path,
    sha256: sha256(resolve(root, path)),
  }))
  const surfaceFingerprint = hashText(JSON.stringify(surfaceFiles))

  const manifest = {
    manifest_version: "current-surface-v1",
    created_at: new Date().toISOString(),
    // On LXC, deploy is rsync-based and the checked-out git HEAD can be stale.
    // `deployed_commit_marker` is the canonical deployed commit when present;
    // `surface_fingerprint` is the prompt/context hash that score-bearing evals
    // should use for exact surface equality.
    canonical_commit: deployedCommitMarker ?? gitCommit,
    git_commit: gitCommit,
    deployed_commit_marker: deployedCommitMarker,
    surface_fingerprint: surfaceFingerprint,
    dirty_worktree: Boolean(gitStatus),
    beat_entity_list_variant: process.env.BEAT_ENTITY_LIST_VARIANT ?? "v1",
    writer_conditioning: process.env.WRITER_CONDITIONING ?? null,
    model_roles: Object.fromEntries(
      [
        "planning-plotter",
        "planning-scenes",
        "reference-resolver",
        "beat-writer",
        "adherence-events",
        "halluc-ungrounded",
      ].map(agent => [agent, AGENT_MODELS[agent]]),
    ),
    surface_files: surfaceFiles,
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
