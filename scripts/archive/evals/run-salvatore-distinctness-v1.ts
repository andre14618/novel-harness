#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { createTuningExperiment } from "../../../src/db/ops"
import { initExperimentRun } from "../../../src/logger"
import { executeAndLog, extractJSON, type ProviderName } from "../../../src/llm"

type CharacterName =
  | "Drizzt"
  | "Bruenor"
  | "Catti-brie"
  | "Entreri"
  | "Jarlaxle"
  | "Zaknafein"

type CharacterId =
  | "drizzt"
  | "bruenor"
  | "catti-brie"
  | "entreri"
  | "jarlaxle"
  | "zaknafein"

type BeatArchetype = "threat" | "reassurance" | "tactical_planning" | "banter"
type PairId = "drizzt_vs_entreri" | "bruenor_vs_catti-brie" | "jarlaxle_vs_zaknafein"
type PresetName = "preset-a" | "preset-b" | "preset-c"
type ConditioningMode = "fixed" | "rotation" | "profile-rotation" | "profile-only"

type BeatRow = {
  id: string
  character: CharacterName
  beat_archetype: BeatArchetype
  prompt: string
  target_voice_card_id: CharacterId
}

type CanonicalLine = {
  line: string
  book: string
  chapter: number
  speaker: string
  source_type: "direct" | "nearest_match"
  note?: string
}

type VoiceCard = {
  name: CharacterName
  canonical_lines: CanonicalLine[]
  tics: string[]
  avoid: string[]
}

type VoiceCardMap = Record<CharacterId, VoiceCard>

/**
 * Stable arm-config JSON schema for `docs/evals/arm-configs/*.json`.
 *
 * Required fields:
 * - `label`: human-readable arm name for reports
 * - `adapter`: target model identifier. Supported here:
 *   - `wandb-artifact:///...` for W&B-served adapters
 *   - plain model ids such as `anthropic/claude-sonnet-4.6`
 * - `preset`: one frozen sweep id from `docs/evals/salvatore-distinctness-v1.md`
 *   (`preset-a`, `preset-b`, `preset-c`). This is the fixed subset for
 *   `conditioning: "fixed"`, the starting sweep for `conditioning: "rotation"`,
 *   and the sweep tag carried through reports for `conditioning: "profile-only"`.
 * - `conditioning`:
 *   - `fixed`: lock the chosen preset for every generation call (applies to
 *     example lines; tics/avoid rendered in full)
 *   - `rotation`: rotate `canonical_lines` subsets deterministically across
 *     `preset-a -> preset-b -> preset-c` on successive generation calls,
 *     starting from `preset`. `tics` and `avoid` render in full.
 *   - `profile-rotation`: rotate `tics`/`avoid` subsets deterministically
 *     across the same preset cycle starting from `preset`, while holding
 *     `canonical_lines` FIXED at `preset-a`. Isolates the profile-field
 *     contribution to conditioning (charter H2).
 *   - `profile-only`: render profile (`tics`/`avoid`) only; omit example
 *     lines entirely. `tics` and `avoid` render in full at the chosen
 *     `preset` slot.
 *
 * Optional fields:
 * - `notes`: free-form operator note persisted into the experiment config
 *
 * Generation settings are intentionally NOT configurable per file. This eval
 * resolves them from the frozen preset surface so callers do not invent
 * run-local temperatures or max-token values.
 */
export type ArmConfig = {
  label: string
  adapter: string
  preset: PresetName
  conditioning: ConditioningMode
  notes?: string
}

type PairTask = {
  pair_id: PairId
  beat_archetype: BeatArchetype
  left: BeatRow
  right: BeatRow
}

type GeneratedSample = {
  arm_label: string
  adapter: string
  preset: PresetName
  beat_id: string
  character: CharacterName
  character_id: CharacterId
  beat_archetype: BeatArchetype
  prompt: string
  output: string
  voice_card: VoiceCard
}

type JudgeAssignment = {
  output_a_character: CharacterName
  output_b_character: CharacterName
  left_score: 0 | 1
  right_score: 0 | 1
  verdict: boolean
  reasoning?: string
}

type PairJudgment = {
  pair_id: PairId
  beat_archetype: BeatArchetype
  expected: {
    output_a: CharacterName
    output_b: CharacterName
  }
  judged: {
    output_a: CharacterName
    output_b: CharacterName
  }
  exact_assignment_cells: 0 | 2
  shuffled: {
    output_a_character: CharacterName
    output_b_character: CharacterName
  }
  voice_card_ids: [CharacterId, CharacterId]
  outputs: {
    output_a: string
    output_b: string
  }
  reasoning?: string
}

type ConfusionMatrix = Record<BeatArchetype, Record<CharacterName, Record<CharacterName, number>>>

type ArmReport = {
  label: string
  adapter: string
  preset: PresetName
  total_exact_assignment_cells: number
  pairwise_calls_correct: number
  pairwise_calls_total: number
  per_pair_scores: Record<PairId, { exact_assignment_cells: number; pairwise_calls_correct: number; pairwise_calls_total: number }>
  judgments: PairJudgment[]
  per_beat_confusion_matrix: ConfusionMatrix
}

type EvalReport = {
  eval_id: "salvatore-distinctness-v1"
  judge_model: string
  generated_at: string
  exp_id: number
  inputs: {
    beats_path: string
    voice_cards_path: string
    arm_a_config_path: string
    arm_b_config_path: string
    seed: string
    pair_limit?: number
  }
  arms: {
    arm_a: ArmReport
    arm_b: ArmReport
  }
  delta: {
    exact_assignment_cells: number
    pairwise_calls_correct: number
  }
}

type ParsedArgs = {
  armAConfigPath: string
  armBConfigPath: string
  judgeModel: string
  out: string
  seed: string
  pairLimit?: number
}

const BEATS_PATH = new URL("../../docs/evals/salvatore-distinctness-v1-beats.jsonl", import.meta.url)
const VOICE_CARDS_PATH = new URL("../../docs/evals/salvatore-distinctness-v1-voice-cards.json", import.meta.url)
const WRITER_SYSTEM_PROMPT_PATH = new URL("../../src/agents/writer/beat-writer-system-salvatore.md", import.meta.url)

const HARD_PAIRS: Array<{ pair_id: PairId; left: CharacterName; left_id: CharacterId; right: CharacterName; right_id: CharacterId }> = [
  { pair_id: "drizzt_vs_entreri", left: "Drizzt", left_id: "drizzt", right: "Entreri", right_id: "entreri" },
  { pair_id: "bruenor_vs_catti-brie", left: "Bruenor", left_id: "bruenor", right: "Catti-brie", right_id: "catti-brie" },
  { pair_id: "jarlaxle_vs_zaknafein", left: "Jarlaxle", left_id: "jarlaxle", right: "Zaknafein", right_id: "zaknafein" }
]

const ALL_CHARACTERS: CharacterName[] = ["Drizzt", "Bruenor", "Catti-brie", "Entreri", "Jarlaxle", "Zaknafein"]
const ALL_BEATS: BeatArchetype[] = ["threat", "reassurance", "tactical_planning", "banter"]
const PRESET_SEQUENCE: PresetName[] = ["preset-a", "preset-b", "preset-c"]
const PRESET_SETTINGS: Record<PresetName, { temperature: number; maxTokens: number }> = {
  "preset-a": { temperature: 0.8, maxTokens: 4000 },
  "preset-b": { temperature: 0.8, maxTokens: 4000 },
  "preset-c": { temperature: 0.8, maxTokens: 4000 }
}

function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag)
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "usage: bun scripts/evals/run-salvatore-distinctness-v1.ts " +
      "--arm-a-config <path> --arm-b-config <path> --judge-model <name> " +
      "[--out <path>] [--seed <string>] [--pair-limit <n>]"
    )
    process.exit(0)
  }

  const armAConfigPath = get("--arm-a-config")
  const armBConfigPath = get("--arm-b-config")
  const judgeModel = get("--judge-model")
  const out = get("--out") ?? "output/evals/salvatore-distinctness-v1-report.json"
  const seed = get("--seed") ?? "salvatore-distinctness-v1"
  const pairLimitRaw = get("--pair-limit")
  const pairLimit = pairLimitRaw ? Number.parseInt(pairLimitRaw, 10) : undefined

  if (!armAConfigPath || !armBConfigPath || !judgeModel) {
    console.error(
      "usage: bun scripts/evals/run-salvatore-distinctness-v1.ts " +
      "--arm-a-config <path> --arm-b-config <path> --judge-model <name> " +
      "[--out <path>] [--seed <string>] [--pair-limit <n>]"
    )
    process.exit(1)
  }

  if (pairLimit !== undefined && (!Number.isInteger(pairLimit) || pairLimit < 1)) {
    throw new Error(`--pair-limit must be a positive integer, got ${pairLimitRaw}`)
  }

  return { armAConfigPath, armBConfigPath, judgeModel, out, seed, pairLimit }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8")
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

export function validateArmConfig(config: unknown, filePath: string): ArmConfig {
  if (!config || typeof config !== "object") {
    throw new Error(`Arm config ${filePath} must be a JSON object`)
  }

  const row = config as Record<string, unknown>
  const preset = row.preset
  const conditioning = row.conditioning

  if (typeof row.label !== "string" || row.label.trim() === "") {
    throw new Error(`Arm config ${filePath} missing non-empty string field "label"`)
  }
  if (typeof row.adapter !== "string" || row.adapter.trim() === "") {
    throw new Error(`Arm config ${filePath} missing non-empty string field "adapter"`)
  }
  if (preset !== "preset-a" && preset !== "preset-b" && preset !== "preset-c") {
    throw new Error(`Arm config ${filePath} has invalid "preset": ${String(preset)}`)
  }
  if (
    conditioning !== "fixed" &&
    conditioning !== "rotation" &&
    conditioning !== "profile-rotation" &&
    conditioning !== "profile-only"
  ) {
    throw new Error(`Arm config ${filePath} has invalid "conditioning": ${String(conditioning)}`)
  }
  if (row.notes !== undefined && typeof row.notes !== "string") {
    throw new Error(`Arm config ${filePath} field "notes" must be a string when present`)
  }

  return {
    label: row.label,
    adapter: row.adapter,
    preset,
    conditioning,
    notes: row.notes as string | undefined
  }
}

function keyFor(character: CharacterName, beat: BeatArchetype) {
  return `${character}::${beat}`
}

function buildBeatIndex(rows: BeatRow[]) {
  const index = new Map<string, BeatRow>()
  for (const row of rows) {
    index.set(keyFor(row.character, row.beat_archetype), row)
  }
  return index
}

function buildPairTasks(beats: BeatRow[]): PairTask[] {
  const index = buildBeatIndex(beats)
  const tasks: PairTask[] = []

  for (const beat of ALL_BEATS) {
    for (const pair of HARD_PAIRS) {
      const left = index.get(keyFor(pair.left, beat))
      const right = index.get(keyFor(pair.right, beat))
      if (!left || !right) {
        throw new Error(`Missing beat rows for ${pair.pair_id} / ${beat}`)
      }
      tasks.push({ pair_id: pair.pair_id, beat_archetype: beat, left, right })
    }
  }

  return tasks
}

function validateArtifacts(beats: BeatRow[], voiceCards: VoiceCardMap) {
  if (beats.length !== 24) {
    throw new Error(`Expected 24 beat rows, found ${beats.length}`)
  }

  for (const character of ALL_CHARACTERS) {
    for (const beat of ALL_BEATS) {
      const found = beats.find((row) => row.character === character && row.beat_archetype === beat)
      if (!found) throw new Error(`Missing beat row for ${character} / ${beat}`)
    }
  }

  for (const pair of HARD_PAIRS) {
    for (const characterId of [pair.left_id, pair.right_id]) {
      const card = voiceCards[characterId]
      if (!card) throw new Error(`Missing voice card: ${characterId}`)
      if (card.canonical_lines.length !== 5) {
        throw new Error(`Expected 5 canonical lines for ${characterId}, found ${card.canonical_lines.length}`)
      }
    }
  }
}

const CANONICAL_LINE_PRESET_INDEXES: Record<PresetName, number[]> = {
  "preset-a": [0, 1, 2],
  "preset-b": [0, 3, 4],
  "preset-c": [1, 3, 4]
}

const PROFILE_FIELD_PRESET_INDEXES: Record<PresetName, number[]> = {
  "preset-a": [0, 1, 2],
  "preset-b": [0, 1, 3],
  "preset-c": [1, 2, 3]
}

function selectVoiceCard(card: VoiceCard, preset: PresetName): VoiceCard {
  const picked = CANONICAL_LINE_PRESET_INDEXES[preset].map((index) => card.canonical_lines[index])
  return { ...card, canonical_lines: picked }
}

function selectProfileSubset(card: VoiceCard, preset: PresetName): VoiceCard {
  const indexes = PROFILE_FIELD_PRESET_INDEXES[preset]
  const tics = indexes.map((i) => card.tics[i]).filter((v): v is string => typeof v === "string")
  const avoid = indexes.map((i) => card.avoid[i]).filter((v): v is string => typeof v === "string")
  return { ...card, tics, avoid }
}

function stripExampleLines(card: VoiceCard): VoiceCard {
  return { ...card, canonical_lines: [] }
}

function presetForGeneration(arm: ArmConfig, generationIndex: number): PresetName {
  if (arm.conditioning !== "rotation" && arm.conditioning !== "profile-rotation") {
    return arm.preset
  }

  const startIndex = PRESET_SEQUENCE.indexOf(arm.preset)
  return PRESET_SEQUENCE[(startIndex + generationIndex) % PRESET_SEQUENCE.length]
}

export function buildVoiceCardForGeneration(arm: ArmConfig, baseCard: VoiceCard, generationIndex: number): { card: VoiceCard; preset: PresetName } {
  const preset = presetForGeneration(arm, generationIndex)

  if (arm.conditioning === "profile-rotation") {
    // Hold exampleLines fixed at preset-a; rotate tics/avoid across a/b/c
    // starting from `preset`. Isolates profile-field contribution.
    const withFixedLines = selectVoiceCard(baseCard, "preset-a")
    return { card: selectProfileSubset(withFixedLines, preset), preset }
  }

  const selected = selectVoiceCard(baseCard, preset)
  if (arm.conditioning === "profile-only") {
    return { card: stripExampleLines(selected), preset }
  }
  return { card: selected, preset }
}

function renderCharacterProfile(card: VoiceCard): string {
  const lines = [`${card.name}:`, `  Voice: ${card.tics.join("; ")}`, `  Avoids: ${card.avoid.join("; ")}`]
  if (card.canonical_lines.length > 0) {
    lines.push("  Example voiced lines:")
    card.canonical_lines.forEach((row, index) => {
      lines.push(`    ${index + 1}. "${row.line.replace(/^"|"$/g, "")}"`)
    })
  }
  return lines.join("\n")
}

function buildGenerationPrompt(beat: BeatRow, card: VoiceCard): string {
  return [
    "BEAT 1 of 1",
    `POV: ${beat.character}`,
    "Setting: (unspecified)",
    "Kind: dialogue",
    "",
    beat.prompt,
    `Characters present: ${beat.character}`,
    "",
    `CHARACTERS:\n${renderCharacterProfile(card)}`
  ].join("\n")
}

function inferProvider(modelOrAdapter: string): ProviderName {
  if (modelOrAdapter.startsWith("wandb-artifact:///")) return "wandb"
  if (modelOrAdapter.startsWith("anthropic/")) return "openrouter"
  if (modelOrAdapter.startsWith("gpt-")) return "openai"
  if (modelOrAdapter.startsWith("deepseek-")) return "deepseek"
  if (modelOrAdapter.startsWith("qwen/") || modelOrAdapter.startsWith("google/") || modelOrAdapter.startsWith("moonshotai/")) {
    return "openrouter"
  }
  throw new Error(`Unable to infer provider for model/adapter "${modelOrAdapter}"`)
}

async function loadWriterSystemPrompt(): Promise<string> {
  return readFile(WRITER_SYSTEM_PROMPT_PATH, "utf8")
}

async function generateSample(
  arm: ArmConfig,
  beat: BeatRow,
  card: VoiceCard,
  preset: PresetName
): Promise<GeneratedSample> {
  const settings = PRESET_SETTINGS[preset]
  const systemPrompt = await loadWriterSystemPrompt()
  const userPrompt = buildGenerationPrompt(beat, card)
  const response = await executeAndLog(
    {
      systemPrompt,
      userPrompt,
      model: arm.adapter,
      provider: inferProvider(arm.adapter),
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      responseFormat: { type: "text" }
    },
    undefined,
    "salvatore-distinctness-generate",
    undefined,
    {
      meta: {
        evalId: "salvatore-distinctness-v1",
        armLabel: arm.label,
        conditioning: arm.conditioning,
        beatId: beat.id,
        beatArchetype: beat.beat_archetype,
        character: beat.character,
        preset
      }
    }
  )

  return {
    arm_label: arm.label,
    adapter: arm.adapter,
    preset,
    beat_id: beat.id,
    character: beat.character,
    character_id: beat.target_voice_card_id,
    beat_archetype: beat.beat_archetype,
    prompt: beat.prompt,
    output: response.content.trim(),
    voice_card: card
  }
}

async function generateArmCorpus(
  arm: ArmConfig,
  beats: BeatRow[],
  voiceCards: VoiceCardMap
): Promise<Map<string, GeneratedSample>> {
  const out = new Map<string, GeneratedSample>()

  for (const [index, beat] of beats.entries()) {
    const resolved = buildVoiceCardForGeneration(arm, voiceCards[beat.target_voice_card_id], index)
    const sample = await generateSample(arm, beat, resolved.card, resolved.preset)
    out.set(beat.id, sample)
  }

  return out
}

function buildDeterministicPairId(left: GeneratedSample, right: GeneratedSample): string {
  return [left.beat_id, right.beat_id].sort().join("::")
}

export function shufflePairDeterministic(
  left: GeneratedSample,
  right: GeneratedSample,
  seed: string
): { output_a: GeneratedSample; output_b: GeneratedSample } {
  const pairId = buildDeterministicPairId(left, right)
  const digest = createHash("sha256")
    .update(`${seed}:${pairId}`)
    .digest()
  const pick = digest.readUInt32BE(0)
  return pick % 2 === 0
    ? { output_a: left, output_b: right }
    : { output_a: right, output_b: left }
}

function buildVoiceCardJudgeSection(card: VoiceCard): string {
  const lines = [
    `VOICE CARD — ${card.name}`,
    "Tics:",
    ...card.tics.map((row) => `- ${row}`),
    "Avoid:",
    ...card.avoid.map((row) => `- ${row}`)
  ]

  if (card.canonical_lines.length > 0) {
    lines.push("Canonical lines:")
    card.canonical_lines.forEach((row, index) => {
      lines.push(`${index + 1}. "${row.line.replace(/^"|"$/g, "")}"`)
    })
  }

  return lines.join("\n")
}

function normalizeCharacterName(raw: string, allowed: CharacterName[]): CharacterName {
  const match = allowed.find((row) => row.toLowerCase() === raw.trim().toLowerCase())
  if (!match) {
    throw new Error(`Judge returned character "${raw}" outside allowed set ${allowed.join(", ")}`)
  }
  return match
}

async function judgePair(
  judgeModel: string,
  task: PairTask,
  shuffled: { output_a: GeneratedSample; output_b: GeneratedSample },
  voiceCards: [VoiceCard, VoiceCard]
): Promise<JudgeAssignment> {
  const pairCharacters = [task.left.character, task.right.character].sort()
  const systemPrompt = [
    "You are scoring a frozen pairwise voice-assignment eval.",
    "You will be shown two anonymized outputs, both intended voice cards, and the hard pair only as an unordered identity set.",
    "Assign Output A and Output B to the correct character using diction, cadence, dialect, tone, rhythm, and the frozen voice-card cues.",
    "A judgment is exact-assignment only: either fully right or fully swapped.",
    `Respond with ONLY valid JSON in this exact shape: {"output_a_character":"${pairCharacters[0]}","output_b_character":"${pairCharacters[1]}","reasoning":"..."}`,
    `Only these character names are valid for this call: ${pairCharacters.join(", ")}.`
  ].join("\n")

  const userPrompt = [
    `PAIR (unordered target identities): ${pairCharacters.join(" / ")}`,
    `BEAT ARCHETYPE: ${task.beat_archetype}`,
    "",
    buildVoiceCardJudgeSection(voiceCards[0]),
    "",
    buildVoiceCardJudgeSection(voiceCards[1]),
    "",
    "Output A:",
    shuffled.output_a.output,
    "",
    "Output B:",
    shuffled.output_b.output
  ].join("\n")

  const response = await executeAndLog(
    {
      systemPrompt,
      userPrompt,
      model: judgeModel,
      provider: inferProvider(judgeModel),
      temperature: 0,
      maxTokens: 512,
      responseFormat: { type: "json_object" }
    },
    undefined,
    "salvatore-distinctness-judge",
    undefined,
    {
      meta: {
        evalId: "salvatore-distinctness-v1",
        pairId: task.pair_id,
        beatArchetype: task.beat_archetype,
        judgeModel
      }
    }
  )

  const parsed = JSON.parse(extractJSON(response.content)) as {
    output_a_character?: string
    output_b_character?: string
    reasoning?: string
  }

  if (!parsed.output_a_character || !parsed.output_b_character) {
    throw new Error(`Judge returned incomplete assignment: ${response.content}`)
  }

  const outputA = normalizeCharacterName(parsed.output_a_character, [task.left.character, task.right.character])
  const outputB = normalizeCharacterName(parsed.output_b_character, [task.left.character, task.right.character])
  if (outputA === outputB) {
    throw new Error(`Judge assigned both outputs to ${outputA}`)
  }

  const leftScore = outputA === shuffled.output_a.character ? 1 : 0
  const rightScore = outputB === shuffled.output_b.character ? 1 : 0

  return {
    output_a_character: outputA,
    output_b_character: outputB,
    left_score: leftScore,
    right_score: rightScore,
    verdict: leftScore === 1 && rightScore === 1,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined
  }
}

function buildEmptyConfusionMatrix(): ConfusionMatrix {
  const matrix = {} as ConfusionMatrix
  for (const beat of ALL_BEATS) {
    matrix[beat] = {} as Record<CharacterName, Record<CharacterName, number>>
    for (const expected of ALL_CHARACTERS) {
      matrix[beat][expected] = {} as Record<CharacterName, number>
      for (const predicted of ALL_CHARACTERS) {
        matrix[beat][expected][predicted] = 0
      }
    }
  }
  return matrix
}

function exactAssignmentCells(expectedA: CharacterName, expectedB: CharacterName, judged: JudgeAssignment): 0 | 2 {
  return expectedA === judged.output_a_character && expectedB === judged.output_b_character ? 2 : 0
}

async function scoreArm(
  arm: ArmConfig,
  generated: Map<string, GeneratedSample>,
  tasks: PairTask[],
  judgeModel: string,
  seed: string
): Promise<ArmReport> {
  const judgments: PairJudgment[] = []
  const perPairScores: ArmReport["per_pair_scores"] = {
    drizzt_vs_entreri: { exact_assignment_cells: 0, pairwise_calls_correct: 0, pairwise_calls_total: 0 },
    "bruenor_vs_catti-brie": { exact_assignment_cells: 0, pairwise_calls_correct: 0, pairwise_calls_total: 0 },
    jarlaxle_vs_zaknafein: { exact_assignment_cells: 0, pairwise_calls_correct: 0, pairwise_calls_total: 0 }
  }
  const confusion = buildEmptyConfusionMatrix()

  for (const task of tasks) {
    const left = generated.get(task.left.id)
    const right = generated.get(task.right.id)
    if (!left || !right) {
      throw new Error(`Missing generated samples for ${task.pair_id} / ${task.beat_archetype} in arm ${arm.label}`)
    }

    const shuffled = shufflePairDeterministic(left, right, `${seed}:${arm.label}:${task.pair_id}:${task.beat_archetype}`)
    const judged = await judgePair(
      judgeModel,
      task,
      shuffled,
      [shuffled.output_a.voice_card, shuffled.output_b.voice_card]
    )

    const exact = exactAssignmentCells(
      shuffled.output_a.character,
      shuffled.output_b.character,
      judged
    )

    const record: PairJudgment = {
      pair_id: task.pair_id,
      beat_archetype: task.beat_archetype,
      expected: {
        output_a: shuffled.output_a.character,
        output_b: shuffled.output_b.character
      },
      judged: {
        output_a: judged.output_a_character,
        output_b: judged.output_b_character
      },
      exact_assignment_cells: exact,
      shuffled: {
        output_a_character: shuffled.output_a.character,
        output_b_character: shuffled.output_b.character
      },
      voice_card_ids: [task.left.target_voice_card_id, task.right.target_voice_card_id],
      outputs: {
        output_a: shuffled.output_a.output,
        output_b: shuffled.output_b.output
      },
      reasoning: judged.reasoning
    }

    judgments.push(record)
    perPairScores[task.pair_id].exact_assignment_cells += exact
    perPairScores[task.pair_id].pairwise_calls_total += 1
    if (judged.verdict) perPairScores[task.pair_id].pairwise_calls_correct += 1

    confusion[task.beat_archetype][record.expected.output_a][record.judged.output_a] += 1
    confusion[task.beat_archetype][record.expected.output_b][record.judged.output_b] += 1
  }

  const totalExactAssignmentCells = judgments.reduce((sum, row) => sum + row.exact_assignment_cells, 0)
  const pairwiseCallsCorrect = judgments.filter((row) => row.exact_assignment_cells === 2).length

  return {
    label: arm.label,
    adapter: arm.adapter,
    preset: arm.preset,
    total_exact_assignment_cells: totalExactAssignmentCells,
    pairwise_calls_correct: pairwiseCallsCorrect,
    pairwise_calls_total: judgments.length,
    per_pair_scores: perPairScores,
    judgments,
    per_beat_confusion_matrix: confusion
  }
}

function uniqueBeatRowsForTasks(tasks: PairTask[]): BeatRow[] {
  const seen = new Set<string>()
  const rows: BeatRow[] = []
  for (const task of tasks) {
    for (const row of [task.left, task.right]) {
      if (!seen.has(row.id)) {
        seen.add(row.id)
        rows.push(row)
      }
    }
  }
  return rows
}

export async function runSalvatoreDistinctnessEval(args: ParsedArgs): Promise<{ report: EvalReport; expId: number }> {
  const beatsPath = BEATS_PATH.pathname
  const voiceCardsPath = VOICE_CARDS_PATH.pathname
  const [beats, voiceCards, armARaw, armBRaw] = await Promise.all([
    readJsonLines<BeatRow>(beatsPath),
    readJson<VoiceCardMap>(voiceCardsPath),
    readJson<unknown>(path.resolve(args.armAConfigPath)),
    readJson<unknown>(path.resolve(args.armBConfigPath))
  ])

  validateArtifacts(beats, voiceCards)
  const armA = validateArmConfig(armARaw, path.resolve(args.armAConfigPath))
  const armB = validateArmConfig(armBRaw, path.resolve(args.armBConfigPath))

  const allTasks = buildPairTasks(beats)
  const tasks = args.pairLimit ? allTasks.slice(0, args.pairLimit) : allTasks
  const beatsToGenerate = uniqueBeatRowsForTasks(tasks)

  const expId = await createTuningExperiment(
    "infrastructure",
    `salvatore-distinctness-v1 eval orchestration: ${armA.label} vs ${armB.label}`,
    {
      eval_id: "salvatore-distinctness-v1",
      judge_model: args.judgeModel,
      arm_a: armA,
      arm_b: armB,
      beats_path: beatsPath,
      voice_cards_path: voiceCardsPath,
      out_path: path.resolve(args.out),
      seed: args.seed,
      pair_limit: args.pairLimit ?? null
    },
    { target: "salvatore-distinctness-conditioning-floor", dimension: "conditioning" }
  )
  console.log(`exp_id=${expId}`)

  // Persist llm_calls per Codex consult `a67d200f4fe05168a` (2026-04-21).
  const runId = await initExperimentRun(expId, "eval", `distinctness-${armA.label}-vs-${armB.label}`, `salvatore-distinctness-v1 ${armA.label} vs ${armB.label}`)
  console.log(`[distinctness] initialized run #${runId} (llm_calls persistence enabled)`)

  const [armACorpus, armBCorpus] = await Promise.all([
    generateArmCorpus(armA, beatsToGenerate, voiceCards),
    generateArmCorpus(armB, beatsToGenerate, voiceCards)
  ])

  const [armAReport, armBReport] = await Promise.all([
    scoreArm(armA, armACorpus, tasks, args.judgeModel, args.seed),
    scoreArm(armB, armBCorpus, tasks, args.judgeModel, args.seed)
  ])

  const report: EvalReport = {
    eval_id: "salvatore-distinctness-v1",
    judge_model: args.judgeModel,
    generated_at: new Date().toISOString(),
    exp_id: expId,
    inputs: {
      beats_path: beatsPath,
      voice_cards_path: voiceCardsPath,
      arm_a_config_path: path.resolve(args.armAConfigPath),
      arm_b_config_path: path.resolve(args.armBConfigPath),
      seed: args.seed,
      pair_limit: args.pairLimit
    },
    arms: {
      arm_a: armAReport,
      arm_b: armBReport
    },
    delta: {
      exact_assignment_cells: armBReport.total_exact_assignment_cells - armAReport.total_exact_assignment_cells,
      pairwise_calls_correct: armBReport.pairwise_calls_correct - armAReport.pairwise_calls_correct
    }
  }

  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true })
  await writeFile(path.resolve(args.out), JSON.stringify(report, null, 2) + "\n", "utf8")
  console.log(`Wrote ${path.resolve(args.out)}`)

  return { report, expId }
}

async function main() {
  await runSalvatoreDistinctnessEval(parseArgs())
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(1)
  })
}
