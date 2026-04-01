import type { SeedInput } from "../../types"

export function buildContext(seed: SeedInput): string {
  const charList = seed.characters
    .map(c => `- ${c.name} (${c.role}): ${c.description}`)
    .join("\n")

  return `Genre: ${seed.genre}\n\nPremise: ${seed.premise}\n\nCharacters:\n${charList}\n\nCreate a detailed world bible for this story. Make the world feel specific and lived-in.`
}
