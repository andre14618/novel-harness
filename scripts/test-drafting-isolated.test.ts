import { expect, test, describe } from "bun:test"
import { parseArgs, flagsForArm, WRITER_ARM_NAMES } from "./test-drafting-isolated"

describe("test-drafting-isolated parseArgs", () => {
  test("requires --source", () => {
    expect(() => parseArgs(["--target-prefix", "ab"])).toThrow(/--source.*required/i)
  })

  test("requires --target-prefix", () => {
    expect(() => parseArgs(["--source", "n"])).toThrow(/--target-prefix.*required/i)
  })

  test("defaults to baseline + scene-call-v1 arms", () => {
    const args = parseArgs(["--source", "n", "--target-prefix", "ab"])
    expect(args.arms).toEqual(["baseline", "scene-call-v1"])
  })

  test("accepts the five supported arms in any combination", () => {
    const args = parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--writer-arms", "baseline,id-suppress,contract-render-only,scene-call-no-expansion,scene-call-v1",
    ])
    expect(args.arms).toEqual(["baseline", "id-suppress", "contract-render-only", "scene-call-no-expansion", "scene-call-v1"])
  })

  test("rejects unknown arm names", () => {
    expect(() => parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--writer-arms", "baseline,foo",
    ])).toThrow(/--writer-arms entries must be one of/)
  })

  test("rejects empty arm list", () => {
    expect(() => parseArgs([
      "--source", "n",
      "--target-prefix", "ab",
      "--writer-arms", "",
    ])).toThrow(/empty arm list/)
  })

  test("--writer-only defaults to false and enables when present", () => {
    expect(parseArgs(["--source", "n", "--target-prefix", "ab"]).writerOnly).toBe(false)
    expect(parseArgs(["--source", "n", "--target-prefix", "ab", "--writer-only"]).writerOnly).toBe(true)
  })

  test("--prose-semantic-eval is opt-in and can dry-run", () => {
    const defaults = parseArgs(["--source", "n", "--target-prefix", "ab"])
    expect(defaults.proseSemanticEval).toBe(false)
    expect(defaults.proseSemanticDryRun).toBe(false)

    const live = parseArgs(["--source", "n", "--target-prefix", "ab", "--prose-semantic-eval", "--prose-semantic-concurrency", "2"])
    expect(live.proseSemanticEval).toBe(true)
    expect(live.proseSemanticDryRun).toBe(false)
    expect(live.proseSemanticConcurrency).toBe(2)

    const dry = parseArgs(["--source", "n", "--target-prefix", "ab", "--prose-semantic-dry-run"])
    expect(dry.proseSemanticEval).toBe(true)
    expect(dry.proseSemanticDryRun).toBe(true)
  })

  test("--prose-semantic-concurrency rejects non-positive / non-numeric values", () => {
    expect(() => parseArgs(["--source", "n", "--target-prefix", "ab", "--prose-semantic-concurrency", "0"])).toThrow(/positive integer/)
    expect(() => parseArgs(["--source", "n", "--target-prefix", "ab", "--prose-semantic-concurrency", "abc"])).toThrow(/positive integer/)
  })

  test("--per-arm-timeout-ms defaults to null and parses positive integers", () => {
    expect(parseArgs(["--source", "n", "--target-prefix", "ab"]).perArmTimeoutMs).toBeNull()
    expect(parseArgs(["--source", "n", "--target-prefix", "ab", "--per-arm-timeout-ms", "60000"]).perArmTimeoutMs).toBe(60000)
  })

  test("--per-arm-timeout-ms rejects non-positive / non-numeric values", () => {
    expect(() => parseArgs(["--source", "n", "--target-prefix", "ab", "--per-arm-timeout-ms", "0"])).toThrow(/positive integer/)
    expect(() => parseArgs(["--source", "n", "--target-prefix", "ab", "--per-arm-timeout-ms", "-1"])).toThrow(/positive integer/)
    expect(() => parseArgs(["--source", "n", "--target-prefix", "ab", "--per-arm-timeout-ms", "abc"])).toThrow(/positive integer/)
  })
})

describe("flagsForArm", () => {
  test("baseline arm preserves production defaults across all four flags", () => {
    expect(flagsForArm("baseline")).toEqual({
      sceneCallWriterV1: false,
      writerExpansionMode: "off",
      forceRenderSceneContractWhenAvailable: false,
      writerPromptIdRendering: "raw",
    })
  })

  test("id-suppress arm flips ONLY the writer-prompt ID rendering flag", () => {
    const flags = flagsForArm("id-suppress")
    expect(flags.writerPromptIdRendering).toBe("suppress")
    // The other three flags must match baseline so the ablation isolates
    // the prompt-rendering effect.
    expect(flags.sceneCallWriterV1).toBe(false)
    expect(flags.writerExpansionMode).toBe("off")
    expect(flags.forceRenderSceneContractWhenAvailable).toBe(false)
  })

  test("contract-render-only arm flips ONLY the scene-contract-render flag", () => {
    const flags = flagsForArm("contract-render-only")
    expect(flags.forceRenderSceneContractWhenAvailable).toBe(true)
    expect(flags.sceneCallWriterV1).toBe(false)
    expect(flags.writerExpansionMode).toBe("off")
    expect(flags.writerPromptIdRendering).toBe("raw")
  })

  test("scene-call-v1 arm enables scene-call writer + expansion-retry; ID rendering stays raw", () => {
    const flags = flagsForArm("scene-call-v1")
    expect(flags.sceneCallWriterV1).toBe(true)
    expect(flags.writerExpansionMode).toBe("retry-short-scenes-v1")
    expect(flags.writerPromptIdRendering).toBe("raw")
  })

  test("scene-call-no-expansion isolates scene-call from expansion retry", () => {
    const flags = flagsForArm("scene-call-no-expansion")
    expect(flags.sceneCallWriterV1).toBe(true)
    expect(flags.writerExpansionMode).toBe("off")
    expect(flags.forceRenderSceneContractWhenAvailable).toBe(false)
    expect(flags.writerPromptIdRendering).toBe("raw")
  })

  test("WRITER_ARM_NAMES enumerates the five supported arms in declaration order", () => {
    expect(WRITER_ARM_NAMES).toEqual(["baseline", "id-suppress", "contract-render-only", "scene-call-no-expansion", "scene-call-v1"])
  })
})
