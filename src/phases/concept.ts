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
import { emit } from "../events"
import { log } from "../logger"
import { pipeline } from "../config/pipeline"

function tryGet<T>(fn: () => T): T | null {
  try { return fn() } catch { return null }
}

export async function runConceptPhase(novelId: string, seed: SeedInput): Promise<void> {
  displayPhaseHeader("Concept — Building your world, characters, and story")
  log(novelId, "info", `Concept phase started. Premise: ${seed.premise.slice(0, 100)}`)
  emit(novelId, { type: "phase:changed", data: { phase: "concept" } })

  const contexts = buildConceptContext(seed)

  // Check what's already saved (for resume)
  const existingWorld = tryGet(() => getWorldBible(novelId))
  const existingChars = getCharacters(novelId)
  const existingSpine = tryGet(() => getStorySpine(novelId))

  // Run all 3 concept agents in parallel — no cross-dependencies, all derive from seed
  const needsWorld = !existingWorld
  const needsChars = existingChars.length === 0
  const needsSpine = !existingSpine

  const pending: Promise<void>[] = []

  if (needsWorld) {
    console.log("\n  [1/3] World Builder...")
    pending.push((async () => {
      for (let attempt = 1; attempt <= pipeline.maxDraftAttempts; attempt++) {
        try {
          emit(novelId, { type: "progress", data: { step: "world-builder", status: "running", attempt } })
          const worldResult = await callAgent({
            novelId, agentName: "world-builder",
            systemPrompt: WORLD_BUILDER_PROMPT, userPrompt: contexts.world,
            schema: worldBibleSchema,
          })
          emit(novelId, { type: "progress", data: { step: "world-builder", status: "complete" } })
          const decision = await presentForApproval(novelId, "concept:world-bible", "World Bible", formatWorldBible(worldResult.output))
          if (decision === "reject") {
            emit(novelId, { type: "progress", data: { step: "world-builder", status: "retrying" } })
            const retry = await callAgent({ novelId, agentName: "world-builder-retry", systemPrompt: WORLD_BUILDER_PROMPT, userPrompt: contexts.world, schema: worldBibleSchema })
            saveWorldBible(novelId, retry.output)
          } else {
            saveWorldBible(novelId, worldResult.output)
          }
          log(novelId, "checkpoint", "World bible saved")
          return
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log(novelId, "error", `World builder attempt ${attempt}/${pipeline.maxDraftAttempts} failed: ${msg}`)
          console.error(`  World builder attempt ${attempt} failed: ${msg}`)
          if (attempt === pipeline.maxDraftAttempts) throw err
        }
      }
    })())
  } else {
    console.log("\n  [1/3] World Bible — already saved, skipping")
  }

  if (needsChars) {
    console.log("  [2/3] Character Agent...")
    pending.push((async () => {
      for (let attempt = 1; attempt <= pipeline.maxDraftAttempts; attempt++) {
        try {
          emit(novelId, { type: "progress", data: { step: "character-agent", status: "running", attempt } })
          const charResult = await callAgent({
            novelId, agentName: "character-agent",
            systemPrompt: CHARACTER_AGENT_PROMPT, userPrompt: contexts.character,
            schema: characterProfilesSchema,
          })
          emit(novelId, { type: "progress", data: { step: "character-agent", status: "complete" } })
          const decision = await presentForApproval(novelId, "concept:characters", "Character Profiles", formatCharacterProfiles(charResult.output.characters))
          if (decision === "reject") {
            emit(novelId, { type: "progress", data: { step: "character-agent", status: "retrying" } })
            const retry = await callAgent({ novelId, agentName: "character-agent-retry", systemPrompt: CHARACTER_AGENT_PROMPT, userPrompt: contexts.character, schema: characterProfilesSchema })
            for (const char of retry.output.characters) saveCharacter(novelId, char)
          } else {
            for (const char of charResult.output.characters) saveCharacter(novelId, char)
          }
          log(novelId, "checkpoint", "Character profiles saved")
          return
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log(novelId, "error", `Character agent attempt ${attempt}/${pipeline.maxDraftAttempts} failed: ${msg}`)
          console.error(`  Character agent attempt ${attempt} failed: ${msg}`)
          if (attempt === pipeline.maxDraftAttempts) throw err
        }
      }
    })())
  } else {
    console.log("  [2/3] Characters — already saved, skipping")
  }

  if (needsSpine) {
    console.log("  [3/3] Plotter Agent...")
    pending.push((async () => {
      for (let attempt = 1; attempt <= pipeline.maxDraftAttempts; attempt++) {
        try {
          emit(novelId, { type: "progress", data: { step: "plotter", status: "running", attempt } })
          const spineResult = await callAgent({
            novelId, agentName: "plotter",
            systemPrompt: PLOTTER_AGENT_PROMPT, userPrompt: contexts.plotter,
            schema: storySpineSchema,
          })
          emit(novelId, { type: "progress", data: { step: "plotter", status: "complete" } })
          const decision = await presentForApproval(novelId, "concept:story-spine", "Story Spine", formatStorySpine(spineResult.output))
          if (decision === "reject") {
            emit(novelId, { type: "progress", data: { step: "plotter", status: "retrying" } })
            const retry = await callAgent({ novelId, agentName: "plotter-retry", systemPrompt: PLOTTER_AGENT_PROMPT, userPrompt: contexts.plotter, schema: storySpineSchema })
            saveStorySpine(novelId, retry.output)
          } else {
            saveStorySpine(novelId, spineResult.output)
          }
          log(novelId, "checkpoint", "Story spine saved")
          return
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log(novelId, "error", `Plotter attempt ${attempt}/${pipeline.maxDraftAttempts} failed: ${msg}`)
          console.error(`  Plotter attempt ${attempt} failed: ${msg}`)
          if (attempt === pipeline.maxDraftAttempts) throw err
        }
      }
    })())
  } else {
    console.log("  [3/3] Story Spine — already saved, skipping")
  }

  await Promise.all(pending)

  updatePhase(novelId, "planning")
  emit(novelId, { type: "phase:changed", data: { phase: "planning" } })
  log(novelId, "checkpoint", "Concept phase complete → planning")
  console.log("\n  Concept phase complete. Advancing to Planning.\n")
}
