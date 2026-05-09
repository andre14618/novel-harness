#!/usr/bin/env bun
/**
 * Build deterministic per-scene character context packets for corpus
 * recreation POC outputs.
 *
 * Diagnostic-only. This previews the compact character-bible capsule a future
 * scene writer experiment could receive. It does not call an LLM, mutate
 * plans, create proposals, or change writer context.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
  buildRunManifest,
  existingArtifactRefs,
  manifestPathForSidecar,
  parentManifestForPocDir,
  writeRunManifest,
} from "./run-manifest"

interface Args {
  pocDir: string
  output: string | null
  json: string | null
}

interface SeedCharacter {
  characterId?: string
  name?: string
  role?: string
  pressure?: string
  want?: string
  need?: string
  lie?: string
  truth?: string
  arc_resolution?: string
  speechPattern?: string
  exampleLines?: string[]
  voiceAnchors?: string[]
}

interface Packet {
  sourceReference?: {
    book?: string
    chapterLabel?: string
  }
  diagnosticConfig?: {
    plannerVariant?: string
  }
  originalAnalogSeed?: {
    protagonist?: SeedCharacter
    supportingCharacters?: SeedCharacter[]
  }
}

interface POCPlan {
  chapterId?: string
  title?: string
  scenes?: Array<{
    sceneId?: string
    povCharacterId?: string
    goal?: string
    opposition?: string
    crisisChoice?: string
    outcome?: string
    consequence?: string
    requiredCharacterIds?: string[]
  }>
  obligations?: Array<{
    obligationId?: string
    sceneId?: string
    sourceId?: string
    threadId?: string
    promiseId?: string
    payoffId?: string
    requirementText?: string
    materialityTest?: string
  }>
}

export interface CharacterContextCard {
  characterId: string
  name: string
  role: string
  sceneRole: "pov" | "supporting"
  want: string | null
  need: string | null
  lie: string | null
  truth: string | null
  pressure: string | null
  speechPattern: string | null
  voiceAnchors: string[]
  sourceObligationIds: string[]
  activeThreadIds: string[]
  activePromiseIds: string[]
  activePayoffIds: string[]
}

export interface SceneCharacterContextPacket {
  sceneId: string
  sceneIndex: number
  povCharacterId: string | null
  sceneGoal: string
  sceneOpposition: string
  sceneChoice: string
  sceneOutcome: string
  sceneConsequence: string
  activeCharacterIds: string[]
  characterCards: CharacterContextCard[]
  currentResponsibilities: string[]
  structuralIssues: string[]
}

export interface CorpusCharacterContextReport {
  generatedAt: string
  pocDir: string
  source: {
    book: string | null
    chapterLabel: string | null
  }
  plannerVariant: string
  sceneCount: number
  contextCount: number
  issueCount: number
  contexts: SceneCharacterContextPacket[]
}

export function buildCorpusRecreationCharacterContext(
  pocDir: string,
  generatedAt = new Date().toISOString(),
): CorpusCharacterContextReport {
  const resolved = resolve(process.cwd(), pocDir)
  const packet = readJson<Packet>(join(resolved, "packet.json"))
  const plan = readJson<POCPlan>(join(resolved, "plan.json"))
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : []
  const characters = characterRegistry(packet)
  const contexts = scenes.map((scene, sceneIndex) => buildSceneCharacterContext({
    plan,
    characters,
    scene,
    sceneId: String(scene.sceneId ?? `scene-${sceneIndex + 1}`),
    sceneIndex,
  }))

  return {
    generatedAt,
    pocDir: resolved,
    source: {
      book: packet.sourceReference?.book ?? null,
      chapterLabel: packet.sourceReference?.chapterLabel ?? null,
    },
    plannerVariant: packet.diagnosticConfig?.plannerVariant ?? "baseline",
    sceneCount: scenes.length,
    contextCount: contexts.length,
    issueCount: contexts.reduce((sum, context) => sum + context.structuralIssues.length, 0),
    contexts,
  }
}

export function renderCorpusRecreationCharacterContext(report: CorpusCharacterContextReport): string {
  const lines: string[] = []
  lines.push("# Corpus Recreation Character Context")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`POC: ${report.pocDir}`)
  lines.push(`Source: ${report.source.book ?? "unknown"} chapter ${report.source.chapterLabel ?? "unknown"}`)
  lines.push(`Variant: ${report.plannerVariant}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(`- Scenes: ${report.sceneCount}`)
  lines.push(`- Context packets: ${report.contextCount}`)
  lines.push(`- Structural issues: ${report.issueCount}`)
  lines.push("")
  lines.push("## Writer Context Boundary")
  lines.push("")
  lines.push("- This is a deterministic preview of compact per-scene character context.")
  lines.push("- It is not injected into the writer and is not promotion evidence by itself.")
  lines.push("- It preserves character IDs and obligation refs so future writer-context A/B arms can be compared without guessing which bible facts were visible.")
  lines.push("")

  for (const context of report.contexts) {
    lines.push(`## Scene ${context.sceneIndex + 1}: ${context.sceneId}`)
    lines.push("")
    lines.push(`POV: ${context.povCharacterId ?? "none"}`)
    lines.push(`Goal: ${context.sceneGoal || "none"}`)
    lines.push(`Opposition: ${context.sceneOpposition || "none"}`)
    lines.push(`Choice: ${context.sceneChoice || "none"}`)
    lines.push(`Outcome: ${context.sceneOutcome || "none"}`)
    lines.push(`Consequence: ${context.sceneConsequence || "none"}`)
    lines.push(`Active characters: ${context.activeCharacterIds.join(", ") || "none"}`)
    lines.push("")
    lines.push("Character cards:")
    for (const card of context.characterCards) {
      lines.push(`- ${card.characterId} (${card.sceneRole}) ${card.name} — ${card.role}`)
      if (card.want) lines.push(`  - Want: ${card.want}`)
      if (card.need) lines.push(`  - Need: ${card.need}`)
      if (card.lie) lines.push(`  - Lie: ${card.lie}`)
      if (card.truth) lines.push(`  - Truth: ${card.truth}`)
      if (card.pressure) lines.push(`  - Pressure: ${card.pressure}`)
      if (card.speechPattern) lines.push(`  - Speech: ${card.speechPattern}`)
      if (card.voiceAnchors.length > 0) lines.push(`  - Voice anchors: ${card.voiceAnchors.join(" | ")}`)
      if (card.sourceObligationIds.length > 0) lines.push(`  - Source obligations: ${card.sourceObligationIds.join(", ")}`)
      if (card.activeThreadIds.length > 0) lines.push(`  - Threads: ${card.activeThreadIds.join(", ")}`)
    }
    lines.push("")
    lines.push("Current responsibilities:")
    lines.push(...formatList(context.currentResponsibilities))
    if (context.structuralIssues.length > 0) {
      lines.push("")
      lines.push("Structural issues:")
      lines.push(...formatList(context.structuralIssues))
    }
    lines.push("")
  }

  return `${lines.join("\n")}\n`
}

function buildSceneCharacterContext(input: {
  plan: POCPlan
  characters: Map<string, SeedCharacter>
  scene: NonNullable<POCPlan["scenes"]>[number]
  sceneId: string
  sceneIndex: number
}): SceneCharacterContextPacket {
  const obligations = (input.plan.obligations ?? []).filter(row => row.sceneId === input.sceneId)
  const povCharacterId = cleanString(input.scene.povCharacterId)
  const characterSourceIds = obligations
    .map(row => cleanString(row.sourceId))
    .filter((sourceId): sourceId is string => Boolean(sourceId && input.characters.has(sourceId)))
  const requiredCharacterIds = (input.scene.requiredCharacterIds ?? []).filter(id => input.characters.has(id))
  const namedCharacterIds = charactersNamedInScene(input.scene, input.characters)
  const activeCharacterIds = unique([
    ...(povCharacterId ? [povCharacterId] : []),
    ...requiredCharacterIds,
    ...characterSourceIds,
    ...namedCharacterIds,
  ])
  const structuralIssues: string[] = []
  if (!povCharacterId) structuralIssues.push(`${input.sceneId}: missing povCharacterId`)
  if (povCharacterId && !input.characters.has(povCharacterId)) structuralIssues.push(`${input.sceneId}: unknown povCharacterId ${povCharacterId}`)
  for (const row of obligations) {
    const sourceId = cleanString(row.sourceId)
    if (sourceId?.startsWith("char-") && !input.characters.has(sourceId)) {
      structuralIssues.push(`${input.sceneId}: ${row.obligationId ?? "obligation"} unknown character sourceId ${sourceId}`)
    }
  }
  for (const characterId of namedCharacterIds) {
    if (characterId === povCharacterId) continue
    if (!requiredCharacterIds.includes(characterId) && !characterSourceIds.includes(characterId)) {
      structuralIssues.push(`${input.sceneId}: character ${characterId} is named in scene contract but missing requiredCharacterIds/source obligation`)
    }
  }
  if (activeCharacterIds.length === 0) structuralIssues.push(`${input.sceneId}: no active character refs`)

  return {
    sceneId: input.sceneId,
    sceneIndex: input.sceneIndex,
    povCharacterId,
    sceneGoal: String(input.scene.goal ?? ""),
    sceneOpposition: String(input.scene.opposition ?? ""),
    sceneChoice: String(input.scene.crisisChoice ?? ""),
    sceneOutcome: String(input.scene.outcome ?? ""),
    sceneConsequence: String(input.scene.consequence ?? ""),
    activeCharacterIds,
    characterCards: activeCharacterIds
      .map(characterId => buildCharacterCard(characterId, input.characters, obligations, povCharacterId))
      .filter((card): card is CharacterContextCard => Boolean(card)),
    currentResponsibilities: obligations.map(formatResponsibility),
    structuralIssues,
  }
}

function buildCharacterCard(
  characterId: string,
  characters: Map<string, SeedCharacter>,
  sceneObligations: NonNullable<POCPlan["obligations"]>,
  povCharacterId: string | null,
): CharacterContextCard | null {
  const character = characters.get(characterId)
  if (!character) return null
  const sourceObligations = sceneObligations.filter(row => row.sourceId === characterId)
  return {
    characterId,
    name: character.name ?? characterId,
    role: character.role ?? "",
    sceneRole: characterId === povCharacterId ? "pov" : "supporting",
    want: cleanString(character.want),
    need: cleanString(character.need),
    lie: cleanString(character.lie),
    truth: cleanString(character.truth),
    pressure: cleanString(character.pressure),
    speechPattern: cleanString(character.speechPattern),
    voiceAnchors: unique([
      ...(character.exampleLines ?? []),
      ...(character.voiceAnchors ?? []),
    ].map(line => String(line).trim()).filter(Boolean)).slice(0, 3),
    sourceObligationIds: sourceObligations.map(row => String(row.obligationId ?? "")).filter(Boolean),
    activeThreadIds: unique(sourceObligations.map(row => String(row.threadId ?? "")).filter(Boolean)),
    activePromiseIds: unique(sourceObligations.map(row => String(row.promiseId ?? "")).filter(Boolean)),
    activePayoffIds: unique(sourceObligations.map(row => String(row.payoffId ?? "")).filter(Boolean)),
  }
}

function characterRegistry(packet: Packet): Map<string, SeedCharacter> {
  const out = new Map<string, SeedCharacter>()
  const seed = packet.originalAnalogSeed ?? {}
  for (const character of [
    seed.protagonist,
    ...(seed.supportingCharacters ?? []),
  ]) {
    const characterId = cleanString(character?.characterId)
    if (!character || !characterId) continue
    out.set(characterId, character)
  }
  return out
}

function charactersNamedInScene(
  scene: NonNullable<POCPlan["scenes"]>[number],
  characters: Map<string, SeedCharacter>,
): string[] {
  const text = [
    scene.goal,
    scene.opposition,
    scene.crisisChoice,
    scene.outcome,
    scene.consequence,
  ].filter(Boolean).join("\n")
  const found: string[] = []
  for (const [characterId, character] of characters) {
    const name = cleanString(character.name)
    if (!name) continue
    if (characterNameAppears(text, name)) found.push(characterId)
  }
  return found
}

function characterNameAppears(text: string, name: string): boolean {
  if (new RegExp(`\\b${escapeRegExp(name)}\\b`, "iu").test(text)) return true
  const parts = name.split(/\s+/u).map(part => part.trim()).filter(part => part.length >= 3)
  return parts.some(part => new RegExp(`\\b${escapeRegExp(part)}\\b`, "u").test(text))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function formatResponsibility(obligation: NonNullable<POCPlan["obligations"]>[number]): string {
  const refs = [
    obligation.sourceId ? `source=${obligation.sourceId}` : "",
    obligation.threadId ? `thread=${obligation.threadId}` : "",
    obligation.promiseId ? `promise=${obligation.promiseId}` : "",
    obligation.payoffId ? `payoff=${obligation.payoffId}` : "",
  ].filter(Boolean).join(" ")
  const materiality = obligation.materialityTest ? ` Materiality: ${obligation.materialityTest}` : ""
  return `${obligation.obligationId ?? "obligation"} ${refs}: ${obligation.requirementText ?? ""}${materiality}`.trim()
}

function parseArgs(argv = process.argv.slice(2)): Args {
  let pocDir: string | null = null
  let output: string | null = null
  let json: string | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--poc-dir") {
      const value = argv[index + 1]
      if (!value) throw new Error("--poc-dir requires a path")
      pocDir = value
      index += 1
    } else if (arg === "--output") {
      const value = argv[index + 1]
      if (!value) throw new Error("--output requires a path")
      output = value
      index += 1
    } else if (arg === "--json") {
      const value = argv[index + 1]
      if (!value) throw new Error("--json requires a path")
      json = value
      index += 1
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown arg: ${arg}`)
    } else {
      pocDir = arg
    }
  }
  if (!pocDir) throw new Error("--poc-dir or positional POC directory is required")
  return { pocDir, output, json }
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/evals/corpus-recreation-character-context.ts --poc-dir <dir>
  bun scripts/evals/corpus-recreation-character-context.ts <dir> --output output/character-context.md --json output/character-context.json
`)
}

function defaultOutputPaths(pocDir: string): { output: string; json: string } {
  return {
    output: join(pocDir, "character-context.md"),
    json: join(pocDir, "character-context.json"),
  }
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writeManifest(args: Args, report: CorpusCharacterContextReport, output: string, json: string): void {
  const parent = parentManifestForPocDir(args.pocDir)
  writeRunManifest(manifestPathForSidecar(json), buildRunManifest({
    generatedAt: report.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-character-context",
    variantId: "character-context",
    parentRunId: parent?.runId ?? null,
    rootRunId: parent?.rootRunId ?? null,
    command: {
      name: "diagnostics:corpus-recreation-character-context",
      argv: process.argv.slice(2),
    },
    inputs: existingArtifactRefs([
      { path: join(resolve(args.pocDir), "run-manifest.json"), role: "parent-run-manifest" },
      { path: join(resolve(args.pocDir), "packet.json"), role: "packet" },
      { path: join(resolve(args.pocDir), "plan.json"), role: "plan" },
    ]),
    outputs: existingArtifactRefs([
      { path: output, role: "character-context-markdown" },
      { path: json, role: "character-context-json" },
    ]),
    relatedRunIds: parent ? [parent.runId] : [],
    discriminator: `contexts-${report.contextCount}`,
    metadata: {
      pocDir: args.pocDir,
      sceneCount: report.sceneCount,
      contextCount: report.contextCount,
      issueCount: report.issueCount,
    },
  }))
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`missing required artifact: ${path}`)
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatList(values: string[]): string[] {
  return values.length > 0 ? values.map(value => `- ${value}`) : ["- none"]
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const defaults = defaultOutputPaths(args.pocDir)
    const output = args.output ?? defaults.output
    const json = args.json ?? defaults.json
    const report = buildCorpusRecreationCharacterContext(args.pocDir)
    const rendered = renderCorpusRecreationCharacterContext(report)
    writeOutput(output, rendered)
    writeOutput(json, `${JSON.stringify(report, null, 2)}\n`)
    writeManifest(args, report, output, json)
    console.log(rendered)
    console.log(`wrote ${resolve(process.cwd(), output)}`)
    console.log(`wrote ${resolve(process.cwd(), json)}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
