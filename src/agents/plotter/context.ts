import type { SeedInput } from "../../types"
import { renderDirectivesForConcept } from "../../schemas/planning-directives"

export function buildContext(seed: SeedInput): string {
  const charList = seed.characters
    .map(c => `- ${c.name} (${c.role}): ${c.description}`)
    .join("\n")

  const directives = seed.directives ? renderDirectivesForConcept(seed.directives) : ""

  return `Genre: ${seed.genre}\n\nPremise: ${seed.premise}\n\nCharacters:\n${charList}${directives}\n\nDesign a 3-act story structure for this premise. Ensure escalating tension and a satisfying arc.`
}
