import { expect, test, describe } from "bun:test"
import { parseArgs } from "./test-planner-isolated"

describe("test-planner-isolated parseArgs", () => {
  test("defaults to fantasy-healer when no positional or flag is given", () => {
    const args = parseArgs([])
    expect(args.seedNames).toEqual(["fantasy-healer"])
    expect(args.novelId).toBeNull()
    expect(args.fixturePath).toBeNull()
  })

  test("parses a positional seed name", () => {
    const args = parseArgs(["fantasy-archive"])
    expect(args.seedNames).toEqual(["fantasy-archive"])
  })

  test("parses comma-separated positional seed names", () => {
    const args = parseArgs(["fantasy-archive,fantasy-cartographer"])
    expect(args.seedNames).toEqual(["fantasy-archive", "fantasy-cartographer"])
  })

  test("parses --novel <id>", () => {
    const args = parseArgs(["--novel", "novel-1234"])
    expect(args.novelId).toBe("novel-1234")
    expect(args.seedNames).toEqual([])
  })

  test("parses --from-fixture <path>", () => {
    const args = parseArgs([
      "--from-fixture",
      "docs/fixtures/scene-first/concepts/over-target/P1-fantasy-debt-binder.json",
    ])
    expect(args.fixturePath).toBe("docs/fixtures/scene-first/concepts/over-target/P1-fantasy-debt-binder.json")
    expect(args.seedNames).toEqual([])
    expect(args.novelId).toBeNull()
  })

  test("parses planner-shape contract flags", () => {
    const args = parseArgs(["fantasy-healer", "--native-planning-contract", "--scene-plan-contract"])
    expect(args.nativePlanningContract).toBe(true)
    expect(args.scenePlanContract).toBe(true)
  })

  test("rejects passing both --novel and a seed name", () => {
    expect(() => parseArgs(["fantasy-healer", "--novel", "n"])).toThrow(/exactly one of/i)
  })

  test("rejects passing both --novel and --from-fixture", () => {
    expect(() => parseArgs(["--novel", "n", "--from-fixture", "x.json"])).toThrow(/exactly one of/i)
  })

  test("rejects passing both seed name and --from-fixture", () => {
    expect(() => parseArgs(["fantasy-healer", "--from-fixture", "x.json"])).toThrow(/exactly one of/i)
  })

  test("rejects --from-fixture without a path value", () => {
    expect(() => parseArgs(["--from-fixture"])).toThrow(/requires a path/i)
  })

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["--what"])).toThrow(/unknown arg: --what/)
  })
})
