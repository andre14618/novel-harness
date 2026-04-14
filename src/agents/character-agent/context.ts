import type { SeedInput, WorldBible } from "../../types"
import { renderDirectivesForConcept } from "../../schemas/planning-directives"

export function buildContext(seed: SeedInput, worldBible?: WorldBible | null): string {
  const charList = seed.characters
    .map(c => `- ${c.name} (${c.role}): ${c.description}`)
    .join("\n")

  const directives = seed.directives ? renderDirectivesForConcept(seed.directives) : ""

  let ctx = `Genre: ${seed.genre}\n\nPremise: ${seed.premise}\n\nCharacters:\n${charList}${directives}`

  if (worldBible?.systems?.length || worldBible?.cultures?.length) {
    if (worldBible.systems.length > 0) {
      ctx += `\n\nWORLD SYSTEMS (assign awareness levels for each character):`
      for (const sys of worldBible.systems) {
        ctx += `\n- ${sys.name} (${sys.type}): ${sys.description}`
      }
    }
    if (worldBible.cultures.length > 0) {
      ctx += `\n\nCULTURES (assign cultural background for each character):`
      for (const cult of worldBible.cultures) {
        ctx += `\n- ${cult.name}: ${cult.description}`
        if (cult.speechInfluences) ctx += ` Speech: ${cult.speechInfluences}`
      }
    }
    ctx += `\n\nAssign EVERY character a culturalBackground (which cultures they belong to and their relationship) and systemAwareness (their awareness level and personal perspective on EACH world system).`
  }

  ctx += `\n\nDevelop these character sketches into full profiles. Ensure each character has a unique voice and clear motivations. Create relationships between them.`

  return ctx
}
