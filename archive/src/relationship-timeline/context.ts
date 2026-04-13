import type { CharacterProfile } from "../../types"
import type { RelationshipState } from "../../db/relationships"
import type { WorldSystem } from "../../db/world-systems"

export function buildContext(
  prose: string,
  characters: CharacterProfile[],
  currentRelationships: RelationshipState[],
  worldSystems: WorldSystem[],
): string {
  let ctx = `CHAPTER TEXT:\n${prose}\n`

  ctx += `\nCHARACTERS IN NOVEL:\n${characters.map(c => `- ${c.name} (${c.role})`).join("\n")}\n`

  if (currentRelationships.length > 0) {
    ctx += `\nCURRENT RELATIONSHIP STATES (before this chapter):\n`
    for (const rs of currentRelationships) {
      ctx += `- ${rs.characterA} ↔ ${rs.characterB}: ${rs.trustLevel} — ${rs.dynamic}`
      if (rs.tension) ctx += ` (tension: ${rs.tension})`
      ctx += `\n`
    }
  }

  if (worldSystems.length > 0) {
    ctx += `\nWORLD SYSTEMS (for awareness change tracking):\n`
    for (const sys of worldSystems) {
      ctx += `- ${sys.name} (${sys.type}): ${sys.description}\n`
    }
  }

  ctx += `\nExtract relationship changes, timeline events, knowledge gains, and awareness changes from this chapter.`

  return ctx
}

export const buildRelationshipTimelineContext = buildContext
