import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()

function readPrompt(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8")
}

describe("writer prompt guardrails", () => {
  test("beat writer prompts align on named-entity and verbal-action rules", () => {
    const defaultBeat = readPrompt("src/agents/writer/beat-writer-system.md")
    const salvatoreBeat = readPrompt("src/agents/writer/beat-writer-system-salvatore.md")

    for (const prompt of [defaultBeat, salvatoreBeat]) {
      expect(prompt).toContain("CHARACTERS")
      expect(prompt).toContain("Allowed-new-entities")
      expect(prompt).toContain("natural, subtextual wording")
      expect(prompt).toContain("does not satisfy a verbal-action beat")
    }
  })

  test("chapter-level prose writer carries walk-on and verbal-action discipline", () => {
    const proseWriter = readPrompt("src/agents/writer/prose-writer-system.md")

    expect(proseWriter).toContain("Allowed-new-entities")
    expect(proseWriter).toContain("ambient walk-ons")
    expect(proseWriter).toContain("natural, subtextual wording")
    expect(proseWriter).toContain("enact it in direct dialogue on the page")
  })
})
