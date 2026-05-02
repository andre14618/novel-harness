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
      // L38-F writer-discipline rule: READER-INFO STATE must be binding for
      // POV/actor characters; "Reader already knows" facts cannot be drafted
      // as first-time discoveries. See docs/sessions/2026-05-02-L38-F-reader-info-adherence.md.
      expect(prompt).toContain("READER-INFO STATE is binding when present")
      expect(prompt).toContain("first-time discoveries")
      expect(prompt).toContain("Hidden from {that character}")
      // L38-G writer-discipline rule: same-chapter physical-state continuity
      // must persist across beats; writers should prefer ambiguity over
      // inventing visible details that earlier beats may already have changed.
      // See docs/sessions/2026-05-02-L38-G-intra-chapter-state.md.
      expect(prompt).toContain("Same-chapter physical-state continuity is binding")
      expect(prompt).toContain("persists across beats once a prior beat in this chapter establishes it")
      expect(prompt).toContain("prefer ambiguity over naming a specific detail")
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
