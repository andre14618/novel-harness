import type { SeedInput } from "../types"
import { worldBibleSchema, characterProfilesSchema, storySpineSchema } from "../types"
import {
  saveWorldBible, getWorldBible, saveCharacter, getCharacters,
  saveStorySpine, getStorySpine, updatePhase,
} from "../db"
import { callAgent } from "../llm"
import { WORLD_BUILDER_PROMPT, CHARACTER_AGENT_PROMPT, PLOTTER_AGENT_PROMPT } from "../prompts"
import { buildConceptContext } from "../context"
import {
  displayPhaseHeader, presentForApproval,
  formatWorldBible, formatCharacterProfiles, formatStorySpine,
} from "../cli"
import { log } from "../logger"

function tryGet<T>(fn: () => T): T | null {
  try { return fn() } catch { return null }
}

export async function runConceptPhase(novelId: string, seed: SeedInput): Promise<void> {
  displayPhaseHeader("Concept — Building your world, characters, and story")
  log(novelId, "info", `Concept phase started. Premise: ${seed.premise.slice(0, 100)}`)

  const contexts = buildConceptContext(seed)

  // Check what's already saved (for resume)
  const existingWorld = tryGet(() => getWorldBible(novelId))
  const existingChars = getCharacters(novelId)
  const existingSpine = tryGet(() => getStorySpine(novelId))

  // 1. World Bible
  if (!existingWorld) {
    console.log("\n  [1/3] World Builder...")
    const worldResult = await callAgent({
      systemPrompt: WORLD_BUILDER_PROMPT, userPrompt: contexts.world,
      schema: worldBibleSchema, temperature: 0.7,
    })
    const decision = await presentForApproval("World Bible", formatWorldBible(worldResult.output))
    if (decision === "reject") {
      const retry = await callAgent({ systemPrompt: WORLD_BUILDER_PROMPT, userPrompt: contexts.world, schema: worldBibleSchema, temperature: 0.8 })
      saveWorldBible(novelId, retry.output)
    } else {
      saveWorldBible(novelId, worldResult.output)
    }
    log(novelId, "checkpoint", "World bible saved")
  } else {
    console.log("\n  [1/3] World Bible — already saved, skipping")
  }

  // 2. Characters
  if (existingChars.length === 0) {
    console.log("  [2/3] Character Agent...")
    const charResult = await callAgent({
      systemPrompt: CHARACTER_AGENT_PROMPT, userPrompt: contexts.character,
      schema: characterProfilesSchema, temperature: 0.7,
    })
    const decision = await presentForApproval("Character Profiles", formatCharacterProfiles(charResult.output.characters))
    if (decision === "reject") {
      const retry = await callAgent({ systemPrompt: CHARACTER_AGENT_PROMPT, userPrompt: contexts.character, schema: characterProfilesSchema, temperature: 0.8 })
      for (const char of retry.output.characters) saveCharacter(novelId, char)
    } else {
      for (const char of charResult.output.characters) saveCharacter(novelId, char)
    }
    log(novelId, "checkpoint", `Character profiles saved`)
  } else {
    console.log("  [2/3] Characters — already saved, skipping")
  }

  // 3. Story Spine
  if (!existingSpine) {
    console.log("  [3/3] Plotter Agent...")
    const spineResult = await callAgent({
      systemPrompt: PLOTTER_AGENT_PROMPT, userPrompt: contexts.plotter,
      schema: storySpineSchema, temperature: 0.7,
    })
    const decision = await presentForApproval("Story Spine", formatStorySpine(spineResult.output))
    if (decision === "reject") {
      const retry = await callAgent({ systemPrompt: PLOTTER_AGENT_PROMPT, userPrompt: contexts.plotter, schema: storySpineSchema, temperature: 0.8 })
      saveStorySpine(novelId, retry.output)
    } else {
      saveStorySpine(novelId, spineResult.output)
    }
    log(novelId, "checkpoint", "Story spine saved")
  } else {
    console.log("  [3/3] Story Spine — already saved, skipping")
  }

  updatePhase(novelId, "planning")
  log(novelId, "checkpoint", "Concept phase complete → planning")
  console.log("\n  Concept phase complete. Advancing to Planning.\n")
}
