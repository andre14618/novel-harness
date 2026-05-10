import { expect, test, describe } from "bun:test"
import { parseArgs, deriveNovelIdFromFixtureDir } from "./load-frozen-plan"

describe("load-frozen-plan parseArgs", () => {
  test("requires --fixture", () => {
    expect(() => parseArgs([])).toThrow(/--fixture <fixture-dir> is required/)
  })

  test("parses --fixture with a directory", () => {
    const args = parseArgs(["--fixture", "docs/fixtures/scene-first/frozen-plan/x"])
    expect(args.fixtureDir).toBe("docs/fixtures/scene-first/frozen-plan/x")
    expect(args.novelIdOverride).toBeNull()
    expect(args.quiet).toBe(false)
  })

  test("parses optional --novel-id and --quiet", () => {
    const args = parseArgs([
      "--fixture", "dir",
      "--novel-id", "explicit-id",
      "--quiet",
    ])
    expect(args.novelIdOverride).toBe("explicit-id")
    expect(args.quiet).toBe(true)
  })

  test("rejects unknown args", () => {
    expect(() => parseArgs(["--what", "x"])).toThrow(/unknown arg: --what/)
  })
})

describe("load-frozen-plan deriveNovelIdFromFixtureDir", () => {
  test("derives id from directory basename", () => {
    const id = deriveNovelIdFromFixtureDir(
      "docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2",
      1778500000000,
    )
    expect(id).toBe("fixture-P4-novel-1778411555121-ch1-ch2-1778500000000")
  })

  test("strips trailing slash before computing basename", () => {
    const id = deriveNovelIdFromFixtureDir(
      "docs/fixtures/scene-first/frozen-plan/novel-foo-ch1/",
      1778500000000,
    )
    expect(id).toBe("fixture-P4-novel-foo-ch1-1778500000000")
  })
})
