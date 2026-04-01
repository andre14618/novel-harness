import type { SeedInput } from "../../types"

export function buildContext(seed: SeedInput): string {
  const charList = seed.characters
    .map(c => `- ${c.name} (${c.role}): ${c.description}`)
    .join("\n")

  return `Genre: ${seed.genre}\n\nPremise: ${seed.premise}\n\nCharacters:\n${charList}\n\nDevelop these character sketches into full profiles. Ensure each character has a unique voice and clear motivations. Create relationships between them.`
}
