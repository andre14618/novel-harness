import { describe, expect, test } from "bun:test"
import { parseArgs } from "./plan-readiness-import"

describe("plan-readiness-import", () => {
  test("parseArgs requires novel and aggregate paths", () => {
    expect(() => parseArgs([])).toThrow("--novel is required")
    expect(() => parseArgs(["--novel", "n"])).toThrow("--aggregate is required")
  })

  test("parseArgs accepts import controls", () => {
    expect(parseArgs([
      "--novel", "n",
      "--aggregate", "readiness.json",
      "--imported-by-ref", "scene-semantic-review:test",
      "--no-refresh-staleness",
      "--json",
    ])).toEqual({
      novelId: "n",
      aggregatePath: "readiness.json",
      importedByRef: "scene-semantic-review:test",
      refreshStaleness: false,
      json: true,
    })
  })
})
