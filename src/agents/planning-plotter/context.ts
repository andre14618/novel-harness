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
  if (c.lie || c.truth || c.want || c.need || c.arc_resolution) {
    const arcParts: string[] = []
    if (c.lie) arcParts.push(`lie="${c.lie}"`)
    if (c.truth) arcParts.push(`truth="${c.truth}"`)
    if (c.want) arcParts.push(`want="${c.want}"`)
    if (c.need) arcParts.push(`need="${c.need}"`)
    if (c.arc_resolution) arcParts.push(`arc=${c.arc_resolution}`)
    profile += `\n  Arc: ${arcParts.join("; ")}`
  }
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
  const nativeContractSection = seed.pipelineOverrides?.nativePlanningContractV1 ? `

UPSTREAM NATIVE PLANNING CONTRACT EXPERIMENT:
For each chapter purpose, name the story function as a native chapter contract:
the protagonist pressure, the irreversible change/reveal/choice, and the
endpoint or hook that downstream beat planning must preserve. Do not hide a
beat list inside the purpose. The downstream beat pass will author a small
number of complete story-turn beats from this contract.` : ""

  return `Genre: ${seed.genre}
Premise: ${seed.premise}

${worldSection}${systemsSection}${culturesSection}

${charSection}

${spineSection}${directivesSection}${structuralSection}${nativeContractSection}

Produce a SKELETON outline${seed.chapterCount ? ` with exactly ${seed.chapterCount} chapters` : ""}. One compact entry per chapter — title, POV, setting, 1–2-sentence purpose, targetWords, charactersPresent. No scene beats, no world-state changes, no knowledge transfers: those come from the downstream per-chapter beat pass.${seed.chapterCount && seed.chapterCount > 5 ? `\n\nWith ${seed.chapterCount} chapters, ensure subplot threads are established early and woven through the middle, rotating POV characters across chapters where the story benefits from multiple perspectives.` : ""}${worldBible.systems?.length ? `\n\nPOV + charactersPresent should reflect that different characters have different awareness of world systems — dramatic tension comes from who-knows-what in each chapter.` : ""}`
}

export const buildPlanningContext = buildContext
