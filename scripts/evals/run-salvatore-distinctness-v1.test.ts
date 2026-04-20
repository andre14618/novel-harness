import { describe, expect, test } from "bun:test"
import { shufflePairDeterministic } from "./run-salvatore-distinctness-v1"

type Sample = Parameters<typeof shufflePairDeterministic>[0]

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
