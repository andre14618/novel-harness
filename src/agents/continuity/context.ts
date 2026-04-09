import type { Fact, CharacterState } from "../../types"

export function buildContext(
  draft: string,
  facts: Fact[],
  charStates: CharacterState[],
): string {
  let ctx = `CHAPTER DRAFT:\n${draft}\n\n`

  if (facts.length > 0) {
    ctx += `ESTABLISHED FACTS:\n${facts.map(f => `- [ch${f.establishedInChapter}] [${f.category}] ${f.fact}`).join("\n")}\n\n`
  }

  if (charStates.length > 0) {
    ctx += `CHARACTER STATES (as of previous chapter):\n${charStates.map(cs =>
      `${cs.characterId}: at ${cs.location}, feeling ${cs.emotionalState}, knows: ${cs.knows.join("; ")}`
    ).join("\n")}\n\n`
  }

  return ctx
}

export const buildContinuityContext = buildContext
