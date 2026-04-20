import { describe, expect, test } from "bun:test"
import {
  buildVoiceCardForGeneration,
  shufflePairDeterministic,
  type ArmConfig
} from "./run-salvatore-distinctness-v1"

type Sample = Parameters<typeof shufflePairDeterministic>[0]
type VoiceCard = Sample["voice_card"]

function makeSample(character: Sample["character"], character_id: Sample["character_id"], beat_id: string): Sample {
  return {
    arm_label: "test-arm",
    adapter: "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4",
    preset: "preset-a",
    beat_id,
    character,
    character_id,
    beat_archetype: "threat",
    prompt: "test prompt",
    output: `${character} sample`,
    voice_card: {
      name: character,
      canonical_lines: [],
      tics: ["test tic"],
      avoid: ["test avoid"]
    }
  }
}

describe("shufflePairDeterministic", () => {
  const left = makeSample("Drizzt", "drizzt", "salvatore-distinct-v1-drizzt-threat")
  const right = makeSample("Entreri", "entreri", "salvatore-distinct-v1-entreri-threat")

  test("same seed yields identical output", () => {
    const first = shufflePairDeterministic(left, right, "same-seed")
    const second = shufflePairDeterministic(left, right, "same-seed")
    expect(first.output_a.character).toBe(second.output_a.character)
    expect(first.output_b.character).toBe(second.output_b.character)
  })

  test("different seeds likely produce different orderings", () => {
    const seeds = ["seed-a", "seed-b", "seed-c", "seed-d", "seed-e", "seed-f"]
    const orderings = new Set(
      seeds.map((seed) => shufflePairDeterministic(left, right, seed).output_a.character)
    )
    expect(orderings.size).toBeGreaterThan(1)
  })
})

describe("buildVoiceCardForGeneration — profile-rotation mode", () => {
  const baseCard: VoiceCard = {
    name: "Drizzt",
    canonical_lines: [
      { line: "line-0", book: "t", chapter: 1, speaker: "Drizzt", source_type: "direct" },
      { line: "line-1", book: "t", chapter: 1, speaker: "Drizzt", source_type: "direct" },
      { line: "line-2", book: "t", chapter: 1, speaker: "Drizzt", source_type: "direct" },
      { line: "line-3", book: "t", chapter: 1, speaker: "Drizzt", source_type: "direct" },
      { line: "line-4", book: "t", chapter: 1, speaker: "Drizzt", source_type: "direct" }
    ],
    tics: ["tic-0", "tic-1", "tic-2", "tic-3"],
    avoid: ["avoid-0", "avoid-1", "avoid-2", "avoid-3"]
  }

  const profileRotationArm: ArmConfig = {
    label: "v4-profile-rotation",
    adapter: "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4",
    preset: "preset-a",
    conditioning: "profile-rotation"
  }

  test("holds canonical_lines at preset-a across rotation", () => {
    const first = buildVoiceCardForGeneration(profileRotationArm, baseCard, 0)
    const second = buildVoiceCardForGeneration(profileRotationArm, baseCard, 1)
    const third = buildVoiceCardForGeneration(profileRotationArm, baseCard, 2)
    const expectedLines = ["line-0", "line-1", "line-2"]
    expect(first.card.canonical_lines.map((r) => r.line)).toEqual(expectedLines)
    expect(second.card.canonical_lines.map((r) => r.line)).toEqual(expectedLines)
    expect(third.card.canonical_lines.map((r) => r.line)).toEqual(expectedLines)
  })

  test("rotates tics/avoid across preset-a -> b -> c", () => {
    const first = buildVoiceCardForGeneration(profileRotationArm, baseCard, 0)
    const second = buildVoiceCardForGeneration(profileRotationArm, baseCard, 1)
    const third = buildVoiceCardForGeneration(profileRotationArm, baseCard, 2)
    expect(first.preset).toBe("preset-a")
    expect(first.card.tics).toEqual(["tic-0", "tic-1", "tic-2"])
    expect(first.card.avoid).toEqual(["avoid-0", "avoid-1", "avoid-2"])
    expect(second.preset).toBe("preset-b")
    expect(second.card.tics).toEqual(["tic-0", "tic-1", "tic-3"])
    expect(second.card.avoid).toEqual(["avoid-0", "avoid-1", "avoid-3"])
    expect(third.preset).toBe("preset-c")
    expect(third.card.tics).toEqual(["tic-1", "tic-2", "tic-3"])
    expect(third.card.avoid).toEqual(["avoid-1", "avoid-2", "avoid-3"])
  })

  test("rotation cycles back to preset-a after 3 calls", () => {
    const fourth = buildVoiceCardForGeneration(profileRotationArm, baseCard, 3)
    expect(fourth.preset).toBe("preset-a")
    expect(fourth.card.tics).toEqual(["tic-0", "tic-1", "tic-2"])
  })
})

describe("buildVoiceCardForGeneration — existing modes unchanged", () => {
  const baseCard: VoiceCard = {
    name: "Drizzt",
    canonical_lines: [
      { line: "line-0", book: "t", chapter: 1, speaker: "Drizzt", source_type: "direct" },
      { line: "line-1", book: "t", chapter: 1, speaker: "Drizzt", source_type: "direct" },
      { line: "line-2", book: "t", chapter: 1, speaker: "Drizzt", source_type: "direct" },
      { line: "line-3", book: "t", chapter: 1, speaker: "Drizzt", source_type: "direct" },
      { line: "line-4", book: "t", chapter: 1, speaker: "Drizzt", source_type: "direct" }
    ],
    tics: ["tic-0", "tic-1", "tic-2", "tic-3"],
    avoid: ["avoid-0", "avoid-1", "avoid-2", "avoid-3"]
  }

  test("rotation mode rotates canonical_lines and renders tics/avoid in full", () => {
    const arm: ArmConfig = {
      label: "v4-rotation",
      adapter: "x",
      preset: "preset-a",
      conditioning: "rotation"
    }
    const first = buildVoiceCardForGeneration(arm, baseCard, 0)
    const second = buildVoiceCardForGeneration(arm, baseCard, 1)
    expect(first.card.canonical_lines.map((r) => r.line)).toEqual(["line-0", "line-1", "line-2"])
    expect(second.card.canonical_lines.map((r) => r.line)).toEqual(["line-0", "line-3", "line-4"])
    expect(first.card.tics).toHaveLength(4)
    expect(first.card.avoid).toHaveLength(4)
  })

  test("profile-only mode strips example lines", () => {
    const arm: ArmConfig = {
      label: "sonnet-profile",
      adapter: "anthropic/claude-sonnet-4.6",
      preset: "preset-a",
      conditioning: "profile-only"
    }
    const result = buildVoiceCardForGeneration(arm, baseCard, 0)
    expect(result.card.canonical_lines).toEqual([])
    expect(result.card.tics).toHaveLength(4)
  })
})
