import { describe, expect, test } from "bun:test"
import { parseJsonbArray, parseJsonbObject } from "./jsonb"

describe("jsonb helpers", () => {
  test("parseJsonbArray accepts already-parsed arrays", () => {
    expect(parseJsonbArray([{ description: "a" }])).toEqual([{ description: "a" }])
  })

  test("parseJsonbArray parses JSONB strings from Bun/Postgres", () => {
    expect(parseJsonbArray('[{"description":"a","beat_index":4}]')).toEqual([
      { description: "a", beat_index: 4 },
    ])
  })

  test("parseJsonbArray returns empty array for invalid shapes", () => {
    expect(parseJsonbArray(null)).toEqual([])
    expect(parseJsonbArray('{"description":"not-array"}')).toEqual([])
    expect(parseJsonbArray("not json")).toEqual([])
  })

  test("parseJsonbObject parses object strings and rejects arrays", () => {
    expect(parseJsonbObject('{"reason":"orphaned"}')).toEqual({ reason: "orphaned" })
    expect(parseJsonbObject('[{"reason":"array"}]')).toBeNull()
  })
})
