#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

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
type PresetName = "fixed" | "preset-a" | "preset-b" | "preset-c"

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

type ArmConfig = {
  label: string
  adapter: string
  preset: PresetName
  temperature?: number
  max_tokens?: number
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
}

type JudgeAssignment = {
  output_a_character: CharacterName
  output_b_character: CharacterName
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
  inputs: {
    beats_path: string
    voice_cards_path: string
    arm_a_config_path: string
    arm_b_config_path: string
    seed: string
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

const BEATS_PATH = new URL("../../docs/evals/salvatore-distinctness-v1-beats.jsonl", import.meta.url)
const VOICE_CARDS_PATH = new URL("../../docs/evals/salvatore-distinctness-v1-voice-cards.json", import.meta.url)

const HARD_PAIRS: Array<{ pair_id: PairId; left: CharacterName; left_id: CharacterId; right: CharacterName; right_id: CharacterId }> = [
  { pair_id: "drizzt_vs_entreri", left: "Drizzt", left_id: "drizzt", right: "Entreri", right_id: "entreri" },
  { pair_id: "bruenor_vs_catti-brie", left: "Bruenor", left_id: "bruenor", right: "Catti-brie", right_id: "catti-brie" },
  { pair_id: "jarlaxle_vs_zaknafein", left: "Jarlaxle", left_id: "jarlaxle", right: "Zaknafein", right_id: "zaknafein" }
]

const ALL_CHARACTERS: CharacterName[] = ["Drizzt", "Bruenor", "Catti-brie", "Entreri", "Jarlaxle", "Zaknafein"]
const ALL_BEATS: BeatArchetype[] = ["threat", "reassurance", "tactical_planning", "banter"]

/*
TODO block for Claude follow-on implementation:
1. Wire `generateSample()` to the real generation backend so an arm config can call the target adapter with the frozen beat prompt and the selected voice-card subset.
2. Wire `judgePair()` to the real judge API call using the named judge model from the frozen spec (`gpt-5.4` by default).
3. Replace `shufflePairDeterministic()` with a real seeded shuffler that is stable across reruns and explicitly logged in the report.
4. Decide the stable arm-config schema on disk; this skeleton expects JSON with at least `{ label, adapter, preset }`.
*/

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const idx = args.indexOf(flag)
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: bun scripts/evals/run-salvatore-distinctness-v1.ts " +
      "--arm-a-config <path> --arm-b-config <path> --judge-model <name> " +
      "[--out <path>] [--seed <string>]"
    )
    process.exit(0)
  }

  const armAConfigPath = get("--arm-a-config")
  const armBConfigPath = get("--arm-b-config")
  const judgeModel = get("--judge-model")
  const out = get("--out") ?? "output/evals/salvatore-distinctness-v1-report.json"
  const seed = get("--seed") ?? "salvatore-distinctness-v1"

  if (!armAConfigPath || !armBConfigPath || !judgeModel) {
    console.error(
      "usage: bun scripts/evals/run-salvatore-distinctness-v1.ts " +
      "--arm-a-config <path> --arm-b-config <path> --judge-model <name> " +
      "[--out <path>] [--seed <string>]"
    )
    process.exit(1)
  }

  return { armAConfigPath, armBConfigPath, judgeModel, out, seed }
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

function selectVoiceCard(card: VoiceCard, preset: PresetName): VoiceCard {
  if (preset === "fixed") return card

  const presetIndexes: Record<Exclude<PresetName, "fixed">, number[]> = {
    "preset-a": [0, 1, 2],
    "preset-b": [0, 3, 4],
    "preset-c": [1, 3, 4]
  }

  const picked = presetIndexes[preset].map((index) => card.canonical_lines[index])
  return { ...card, canonical_lines: picked }
}

async function generateSample(
  arm: ArmConfig,
  beat: BeatRow,
  card: VoiceCard
): Promise<GeneratedSample> {
  void arm
  void beat
  void card
  throw new Error("TODO: wire generation backend in generateSample()")
}

async function generateArmCorpus(
  arm: ArmConfig,
  beats: BeatRow[],
  voiceCards: VoiceCardMap
): Promise<Map<string, GeneratedSample>> {
  const out = new Map<string, GeneratedSample>()

  for (const beat of beats) {
    const card = selectVoiceCard(voiceCards[beat.target_voice_card_id], arm.preset)
    const sample = await generateSample(arm, beat, card)
    out.set(beat.id, sample)
  }

  return out
}

function shufflePairDeterministic(
  left: GeneratedSample,
  right: GeneratedSample,
  seed: string
): { output_a: GeneratedSample; output_b: GeneratedSample } {
  void seed
  throw new Error("TODO: replace shufflePairDeterministic() with a real seeded shuffler")
}

async function judgePair(
  judgeModel: string,
  task: PairTask,
  shuffled: { output_a: GeneratedSample; output_b: GeneratedSample },
  voiceCards: [VoiceCard, VoiceCard]
): Promise<JudgeAssignment> {
  void judgeModel
  void task
  void shuffled
  void voiceCards
  throw new Error("TODO: wire judge API call in judgePair()")
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
  voiceCards: VoiceCardMap,
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
      [
        selectVoiceCard(voiceCards[task.left.target_voice_card_id], arm.preset),
        selectVoiceCard(voiceCards[task.right.target_voice_card_id], arm.preset)
      ]
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
    if (exact === 2) perPairScores[task.pair_id].pairwise_calls_correct += 1

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

async function main() {
  const args = parseArgs()

  const beatsPath = BEATS_PATH.pathname
  const voiceCardsPath = VOICE_CARDS_PATH.pathname
  const [beats, voiceCards, armA, armB] = await Promise.all([
    readJsonLines<BeatRow>(beatsPath),
    readJson<VoiceCardMap>(voiceCardsPath),
    readJson<ArmConfig>(path.resolve(args.armAConfigPath)),
    readJson<ArmConfig>(path.resolve(args.armBConfigPath))
  ])

  validateArtifacts(beats, voiceCards)
  const tasks = buildPairTasks(beats)

  const [armACorpus, armBCorpus] = await Promise.all([
    generateArmCorpus(armA, beats, voiceCards),
    generateArmCorpus(armB, beats, voiceCards)
  ])

  const [armAReport, armBReport] = await Promise.all([
    scoreArm(armA, armACorpus, tasks, voiceCards, args.judgeModel, args.seed),
    scoreArm(armB, armBCorpus, tasks, voiceCards, args.judgeModel, args.seed)
  ])

  const report: EvalReport = {
    eval_id: "salvatore-distinctness-v1",
    judge_model: args.judgeModel,
    generated_at: new Date().toISOString(),
    inputs: {
      beats_path: beatsPath,
      voice_cards_path: voiceCardsPath,
      arm_a_config_path: path.resolve(args.armAConfigPath),
      arm_b_config_path: path.resolve(args.armBConfigPath),
      seed: args.seed
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
