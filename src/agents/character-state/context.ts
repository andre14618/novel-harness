import type { CharacterProfile } from "../character-agent/schema"

export function buildContext(draft: string, characters: CharacterProfile[]): string {
  const charNames = characters.map(c => c.name).join(", ")
  return `CHAPTER TEXT:\n${draft}\n\nCharacters who may appear: ${charNames}\n\nFor each character who appeared, describe their state at the END of this chapter.`
}

export const buildCharacterStateContext = buildContext
