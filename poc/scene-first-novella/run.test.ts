import { expect, test } from "bun:test"
import { parseArgs } from "./run"

test("defaults POC writer expansion to retry-short-scenes-v1", () => {
  const args = parseArgs(["--run-id", "poc-test"])

  expect(args.writerExpansionMode).toBe("retry-short-scenes-v1")
})

test("allows expansion-off POC runs for writer expansion isolation", () => {
  const args = parseArgs([
    "--fixture",
    "docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-density-cap.json",
    "--chapters",
    "3",
    "--run-id",
    "poc-test",
    "--writer-expansion-mode",
    "off",
  ])

  expect(args.fixturePath).toBe("docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-density-cap.json")
  expect(args.chapters).toBe(3)
  expect(args.writerExpansionMode).toBe("off")
})

test("rejects unknown writer expansion modes", () => {
  expect(() => parseArgs(["--run-id", "poc-test", "--writer-expansion-mode", "always"])).toThrow(
    /--writer-expansion-mode/,
  )
})
