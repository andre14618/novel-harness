import { expect, test, describe } from "bun:test"
import { parseArgs, deriveNovelIdFromFixture } from "./load-concept-fixture"

describe("load-concept-fixture parseArgs", () => {
  test("requires --fixture", () => {
    expect(() => parseArgs([])).toThrow(/--fixture <path> is required/)
  })

  test("parses --fixture with a path", () => {
    const args = parseArgs(["--fixture", "docs/fixtures/scene-first/concepts/over-target/p1.json"])
    expect(args.fixturePath).toBe("docs/fixtures/scene-first/concepts/over-target/p1.json")
    expect(args.novelIdOverride).toBeNull()
    expect(args.quiet).toBe(false)
  })

  test("parses optional --novel-id and --quiet", () => {
    const args = parseArgs([
      "--fixture", "x.json",
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

describe("load-concept-fixture deriveNovelIdFromFixture", () => {
  test("uses the basename and timestamps the id", () => {
    const id = deriveNovelIdFromFixture(
      "docs/fixtures/scene-first/concepts/over-target/P1-fantasy-debt-binder.json",
      "P1-over-target",
      1778500000000,
    )
    expect(id).toBe("fixture-P1-fantasy-debt-binder-1778500000000")
  })

  test("prefixes profile when filename does not lead with profile id", () => {
    const id = deriveNovelIdFromFixture(
      "docs/fixtures/scene-first/concepts/undershoot/some-other-name.json",
      "P2-undershoot",
      1778500000000,
    )
    expect(id).toBe("fixture-P2-some-other-name-1778500000000")
  })
})
