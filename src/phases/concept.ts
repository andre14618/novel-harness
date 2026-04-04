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
  displayPhaseHeader, presentForApproval, getRevisionNotes,
  formatWorldBible, formatCharacterProfiles, formatStorySpine,
} from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import { pipeline } from "../config/pipeline"

function tryGet<T>(fn: () => T): T | null {
  try { return fn() } catch { return null }
}

/**
 * Run a concept agent with human gate. Supports approve, reject (full regen),
 * and revise (regen with revision notes appended to context).
 */
async function runConceptAgent<T>(
  novelId: string,
  agentName: string,
  prompt: string,
  context: string,
  schema: any,
  gateId: string,
  gateTitle: string,
  formatFn: (output: T) => string,
): Promise<T> {
  let currentContext = context

  for (let attempt = 1; attempt <= pipeline.maxDraftAttempts; attempt++) {
    try {
      const retrying = attempt > 1
      emit(novelId, {
        type: "progress",
        data: { step: agentName, status: retrying ? "retrying" : "running", attempt },
      })

      const result = await callAgent({
        novelId,
        agentName: retrying ? `${agentName}-retry` : agentName,
        systemPrompt: prompt,
        userPrompt: currentContext,
        schema,
      })

      emit(novelId, { type: "progress", data: { step: agentName, status: "complete" } })

      const decision = await presentForApproval(
        novelId, gateId, gateTitle, formatFn(result.output),
      )

      if (decision === "approve") {
        return result.output
      }

      if (decision === "revise") {
        const notes = await getRevisionNotes()
        if (notes.length > 0) {
          currentContext = context + "\n\nREVISION NOTES — please address these in your regeneration:\n" +
            notes.map(n => `- ${n}`).join("\n")
        }
        log(novelId, "info", `${gateTitle} revision requested: ${notes.length} notes`)
        emit(novelId, { type: "progress", data: { step: agentName, status: "revising", notes: notes.length } })
        // Loop — will regenerate with notes
        continue
      }

      // reject — regenerate from scratch (original context, retry agent)
      log(novelId, "info", `${gateTitle} rejected, regenerating`)
      emit(novelId, { type: "progress", data: { step: agentName, status: "retrying" } })
      currentContext = context // reset to original context
      continue

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(novelId, "error", `${agentName} attempt ${attempt}/${pipeline.maxDraftAttempts} failed: ${msg}`)
      console.error(`  ${agentName} attempt ${attempt} failed: ${msg}`)
      if (attempt === pipeline.maxDraftAttempts) throw err
    }
  }

  throw new Error(`${agentName} failed after ${pipeline.maxDraftAttempts} attempts`)
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

  const needsWorld = !existingWorld
  const needsChars = existingChars.length === 0
  const needsSpine = !existingSpine

  // Run all 3 concept agents — they run in parallel but gates serialize user interaction
  const pending: Promise<void>[] = []

  if (needsWorld) {
    console.log("\n  [1/3] World Builder...")
    pending.push(
      runConceptAgent(
        novelId, "world-builder", WORLD_BUILDER_PROMPT, contexts.world,
        worldBibleSchema, "concept:world-bible", "World Bible", formatWorldBible,
      ).then(output => {
        saveWorldBible(novelId, output)
        log(novelId, "checkpoint", "World bible saved")
      }),
    )
  } else {
    console.log("\n  [1/3] World Bible — already saved, skipping")
  }

  if (needsChars) {
    console.log("  [2/3] Character Agent...")
    pending.push(
      runConceptAgent(
        novelId, "character-agent", CHARACTER_AGENT_PROMPT, contexts.character,
        characterProfilesSchema, "concept:characters", "Character Profiles",
        (output: any) => formatCharacterProfiles(output.characters),
      ).then(output => {
        for (const char of output.characters) saveCharacter(novelId, char)
        log(novelId, "checkpoint", "Character profiles saved")
      }),
    )
  } else {
    console.log("  [2/3] Characters — already saved, skipping")
  }

  if (needsSpine) {
    console.log("  [3/3] Plotter Agent...")
    pending.push(
      runConceptAgent(
        novelId, "plotter", PLOTTER_AGENT_PROMPT, contexts.plotter,
        storySpineSchema, "concept:story-spine", "Story Spine", formatStorySpine,
      ).then(output => {
        saveStorySpine(novelId, output)
        log(novelId, "checkpoint", "Story spine saved")
      }),
    )
  } else {
    console.log("  [3/3] Story Spine — already saved, skipping")
  }

  await Promise.all(pending)

  updatePhase(novelId, "planning")
  emit(novelId, { type: "phase:changed", data: { phase: "planning" } })
  log(novelId, "checkpoint", "Concept phase complete → planning")
  console.log("\n  Concept phase complete. Advancing to Planning.\n")
}
