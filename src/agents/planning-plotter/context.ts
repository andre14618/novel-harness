import type { SeedInput } from "../../types"
import type { WorldBible } from "../world-builder/schema"
import type { CharacterProfile } from "../character-agent/schema"
import type { StorySpine } from "../plotter/schema"

export function buildContext(
  worldBible: WorldBible,
  characters: CharacterProfile[],
  spine: StorySpine,
  seed: SeedInput,
): string {
  const worldSection = `WORLD BIBLE:
Setting: ${worldBible.setting}
Time Period: ${worldBible.timePeriod}
Rules:
${worldBible.rules.map(r => `- ${r}`).join("\n")}
Locations:
${worldBible.locations.map(l => `- ${l.name}: ${l.description}`).join("\n")}
Culture: ${worldBible.culture}
History: ${worldBible.history}`

  const charSection = `CHARACTER PROFILES:
${characters.map(c => `${c.name} (${c.role}):
  Backstory: ${c.backstory}
  Traits: ${c.traits.join(", ")}
  Speech: ${c.speechPattern}
  Goals: ${c.goals}
  Fears: ${c.fears}
  Relationships: ${c.relationships.map(r => `${r.characterName} — ${r.nature}`).join("; ")}`).join("\n\n")}`

  const spineSection = `STORY SPINE:
Central Conflict: ${spine.centralConflict}
Theme: ${spine.theme}
Ending Direction: ${spine.endingDirection}
Acts:
${spine.acts.map(a => `  Act ${a.number} — ${a.name}: ${a.summary} [${a.emotionalArc}]`).join("\n")}`

  return `Genre: ${seed.genre}
Premise: ${seed.premise}

${worldSection}

${charSection}

${spineSection}

Create a detailed chapter-by-chapter outline. Each chapter should have specific scene beats that advance the plot and develop characters.`
}

export const buildPlanningContext = buildContext
