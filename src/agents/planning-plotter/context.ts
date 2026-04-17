import type { SeedInput } from "../../types"
import type { WorldBible } from "../world-builder/schema"
import type { CharacterProfile } from "../character-agent/schema"
import type { StorySpine } from "../plotter/schema"
import { renderDirectivesForPlanner } from "../../schemas/planning-directives"
import { resolveStructuralPriors, renderStructuralPriorsForPlanner } from "../../models/roles"

export function buildContext(
  worldBible: WorldBible,
  characters: CharacterProfile[],
  spine: StorySpine,
  seed: SeedInput,
): string {
  const worldSection = `WORLD BIBLE:
Setting: ${worldBible.setting}
Time Period: ${worldBible.timePeriod}
Geography: ${worldBible.geography ?? ""}
Political Structure: ${worldBible.politicalStructure ?? ""}
Technology/Magic Constraints: ${worldBible.technologyConstraints ?? ""}
${worldBible.socialCustoms?.length ? `Social Customs:\n${worldBible.socialCustoms.map(c => `- ${c}`).join("\n")}` : ""}
Sensory Palette: ${worldBible.sensoryPalette ?? ""}
Rules:
${worldBible.rules.map(r => `- ${r}`).join("\n")}
Locations:
${worldBible.locations.map(l => `- ${l.name}: ${l.description}${l.sensoryDetails ? ` [${l.sensoryDetails}]` : ""}`).join("\n")}
Culture: ${worldBible.culture}
History: ${worldBible.history}`

  // World systems and cultures (if available)
  let systemsSection = ""
  if (worldBible.systems?.length > 0) {
    systemsSection = `\nWORLD SYSTEMS:
${worldBible.systems.map(s => `- ${s.name} (${s.type}): ${s.description}
    Rules: ${s.rules.join("; ")}
    Manifestations: ${s.manifestations.join("; ")}
    Constraints: ${s.constraints.join("; ")}`).join("\n")}`
  }

  let culturesSection = ""
  if (worldBible.cultures?.length > 0) {
    culturesSection = `\nCULTURES:
${worldBible.cultures.map(c => `- ${c.name}: ${c.description}
    Values: ${c.values.join(", ")}
    Taboos: ${c.taboos.join(", ")}
    Speech influences: ${c.speechInfluences}`).join("\n")}`
  }

  const charSection = `CHARACTER PROFILES:
${characters.map(c => {
  let profile = `${c.name} (${c.role}):
  Backstory: ${c.backstory}
  Traits: ${c.traits.join(", ")}
  Speech: ${c.speechPattern}
  ${c.internalConflict ? `Internal conflict: ${c.internalConflict}\n  ` : ""}${c.avoids ? `Avoids: ${c.avoids}\n  ` : ""}Goals: ${c.goals}
  Fears: ${c.fears}
  Relationships: ${c.relationships.map(r => `${r.characterName} — ${r.nature}`).join("; ")}`
  if (c.culturalBackground?.length > 0) {
    profile += `\n  Cultural background: ${c.culturalBackground.map(cb => `${cb.cultureName} (${cb.relationship})`).join(", ")}`
  }
  if (c.systemAwareness?.length > 0) {
    profile += `\n  System awareness: ${c.systemAwareness.map(sa => `${sa.systemName}: ${sa.level}`).join(", ")}`
  }
  return profile
}).join("\n\n")}`

  const spineSection = `STORY SPINE:
Central Conflict: ${spine.centralConflict}
Theme: ${spine.theme}
Ending Direction: ${spine.endingDirection}
Acts:
${spine.acts.map(a => `  Act ${a.number} — ${a.name}: ${a.summary} [${a.emotionalArc}]${a.turningPoint ? `\n    Turning point: ${a.turningPoint}` : ""}`).join("\n")}`

  const directivesSection = seed.directives ? renderDirectivesForPlanner(seed.directives) : ""

  const priors = resolveStructuralPriors(seed.genre)
  const structuralSection = priors ? renderStructuralPriorsForPlanner(priors) : ""

  return `Genre: ${seed.genre}
Premise: ${seed.premise}

${worldSection}${systemsSection}${culturesSection}

${charSection}

${spineSection}${directivesSection}${structuralSection}

Create a detailed chapter-by-chapter outline${seed.chapterCount ? ` with exactly ${seed.chapterCount} chapters` : ""}. Each chapter should have specific scene beats that advance the plot and develop characters.${seed.chapterCount && seed.chapterCount > 5 ? `\n\nWith ${seed.chapterCount} chapters, ensure subplot threads are established early and woven through the middle, rotating POV characters across chapters where the story benefits from multiple perspectives.` : ""}${worldBible.systems?.length ? `\n\nConsider how different characters' awareness of world systems creates opportunities for dramatic tension — a character ignorant of magic witnessing it for the first time, cultural clashes when characters from different backgrounds meet, or characters navigating taboos they don't share.` : ""}`
}

export const buildPlanningContext = buildContext
