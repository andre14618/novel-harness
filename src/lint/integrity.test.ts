import { describe, expect, test } from "bun:test"
import { validateLintFixIntegrity } from "./integrity"

describe("validateLintFixIntegrity", () => {
  test("passes unchanged prose", () => {
    const prose = "She lifted the blade. She waited again."
    expect(validateLintFixIntegrity(prose, prose).pass).toBe(true)
  })

  test("rejects exp #265 fused-boundary corruption", () => {
    const original = "She lifted the blade. She waited again."
    const fixed = "She lifted the blade.She waited again."
    const result = validateLintFixIntegrity(original, fixed)

    expect(result.pass).toBe(false)
    expect(result.issues.some(i => i.kind === "fused-boundary" && i.excerpt.includes("blade.She"))).toBe(true)
  })

  test("rejects exp #265 dropped-space camel fusion", () => {
    const original = "She waited again. She listened."
    const fixed = "She waited againShe listened."
    const result = validateLintFixIntegrity(original, fixed)

    expect(result.pass).toBe(false)
    expect(result.issues.some(i => i.kind === "camel-fusion" && i.excerpt === "againShe")).toBe(true)
  })

  test("rejects exp #265 malformed fragment join", () => {
    const original = "She turned to find her hand empty."
    const fixed = "She turned to f.ind her hand empty."
    const result = validateLintFixIntegrity(original, fixed)

    expect(result.pass).toBe(false)
    expect(result.issues.some(i => i.kind === "fused-boundary" && i.excerpt.includes(".ind her"))).toBe(true)
  })

  test("rejects newly introduced adjacent duplicate sentences", () => {
    const original = "She crossed the threshold. The hall narrowed."
    const fixed = "She crossed the threshold. The hall narrowed. The hall narrowed."
    const result = validateLintFixIntegrity(original, fixed)

    expect(result.pass).toBe(false)
    expect(result.issues.some(i => i.kind === "duplicate-sentence")).toBe(true)
  })

  test("does not reject duplicate sentence pairs that already existed", () => {
    const original = "The hall narrowed. The hall narrowed. She stopped."
    const fixed = "The hall narrowed. The hall narrowed. She paused."
    const result = validateLintFixIntegrity(original, fixed)

    expect(result.issues.some(i => i.kind === "duplicate-sentence")).toBe(false)
  })
})
