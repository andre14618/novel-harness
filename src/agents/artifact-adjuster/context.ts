import type { WorldBible, CharacterProfile, StorySpine } from "../../types"

export interface AdjusterTurn { role: "user" | "assistant"; content: string }

export interface AdjusterInput {
  world: WorldBible | null
  characters: CharacterProfile[]
  spine: StorySpine | null
  history: AdjusterTurn[]
  userMessage: string
}

export function buildContext(input: AdjusterInput): string {
  const charSummary = input.characters.map(c => ({
    id: c.id,
    name: c.name,
    role: c.role,
    goals: c.goals,
    fears: c.fears,
    internalConflict: c.internalConflict ?? "",
    avoids: c.avoids ?? "",
    backstory: c.backstory ?? "",
    speechPattern: c.speechPattern ?? "",
    traits: c.traits ?? [],
  }))

  const worldSummary = input.world ? {
    setting: input.world.setting,
    timePeriod: input.world.timePeriod,
    geography: input.world.geography,
    politicalStructure: input.world.politicalStructure,
    technologyConstraints: input.world.technologyConstraints,
    sensoryPalette: input.world.sensoryPalette,
    culture: input.world.culture,
    history: input.world.history,
    socialCustoms: input.world.socialCustoms ?? [],
    rules: input.world.rules ?? [],
  } : null

  const spineSummary = input.spine ? {
    centralConflict: (input.spine as any).centralConflict ?? "",
    theme: input.spine.theme,
    endingDirection: (input.spine as any).endingDirection ?? "",
  } : null

  const historyBlock = input.history.length
    ? input.history.map(t => `${t.role === "user" ? "AUTHOR" : "ASSISTANT"}: ${t.content}`).join("\n\n")
    : "(no prior turns)"

  return `CURRENT WORLD:
${worldSummary ? JSON.stringify(worldSummary, null, 2) : "(none)"}

CURRENT CHARACTERS:
${JSON.stringify(charSummary, null, 2)}

CURRENT STORY SPINE:
${spineSummary ? JSON.stringify(spineSummary, null, 2) : "(none)"}

CONVERSATION SO FAR:
${historyBlock}

NEW AUTHOR MESSAGE:
${input.userMessage}

Respond with a single JSON object matching the required shape.`
}
