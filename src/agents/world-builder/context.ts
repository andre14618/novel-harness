import type { SeedInput } from "../../types"
import { renderDirectivesForConcept } from "../../schemas/planning-directives"

export function buildContext(seed: SeedInput): string {
  const charList = seed.characters
    .map(c => `- ${c.name} (${c.role}): ${c.description}`)
    .join("\n")

  const directives = seed.directives ? renderDirectivesForConcept(seed.directives) : ""

  return `Genre: ${seed.genre}

Premise: ${seed.premise}

Characters:
${charList}${directives}

Create a detailed world bible for this story. Every field you produce will be used by other agents — the plotter uses rules and political structure to build conflict, the writer uses locations and sensory palette to ground scenes, and the continuity checker uses rules and locations to catch contradictions. Make the world feel specific and lived-in.`
}
