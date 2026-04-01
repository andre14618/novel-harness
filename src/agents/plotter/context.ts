import type { SeedInput } from "../../types"

export function buildContext(seed: SeedInput): string {
  const charList = seed.characters
    .map(c => `- ${c.name} (${c.role}): ${c.description}`)
    .join("\n")

  return `Genre: ${seed.genre}\n\nPremise: ${seed.premise}\n\nCharacters:\n${charList}\n\nDesign a 3-act story structure for this premise. Ensure escalating tension and a satisfying arc.`
}
