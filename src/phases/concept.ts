import type { SeedInput, WorldBible } from "../types"
import { worldBibleSchema, characterProfilesSchema, storySpineSchema } from "../types"
import {
  saveWorldBible, getWorldBible, saveCharacter, getCharacters,
  saveStorySpine, getStorySpine, updatePhase,
  saveWorldSystem, saveCulture, saveCharacterCulture, saveCharacterSystemAwareness,
  getWorldSystems, getCultures,
} from "../db"
import { callAgent } from "../llm"
import { WORLD_BUILDER_PROMPT, CHARACTER_AGENT_PROMPT, PLOTTER_AGENT_PROMPT } from "../prompts"
import { buildConceptContext } from "../context"
import { buildContext as buildCharContext } from "../agents/character-agent/context"
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

  // Step 1: World-builder runs first (character-agent needs systems/cultures)
  let worldBible: WorldBible | null = existingWorld
  if (needsWorld) {
    console.log("\n  [1/3] World Builder...")
    worldBible = await runConceptAgent(
      novelId, "world-builder", WORLD_BUILDER_PROMPT, contexts.world,
      worldBibleSchema, "concept:world-bible", "World Bible", formatWorldBible,
    )
    saveWorldBible(novelId, worldBible)
    // Save structured systems and cultures to dedicated tables
    saveWorldKnowledgeGraph(novelId, worldBible)
    log(novelId, "checkpoint", "World bible saved")
  } else {
    console.log("\n  [1/3] World Bible — already saved, skipping")
  }

  // Step 2: Character-agent + plotter run in parallel (both need world bible)
  const pending: Promise<void>[] = []

  if (needsChars) {
    console.log("  [2/3] Character Agent...")
    const charContext = buildCharContext(seed, worldBible)
    pending.push(
      runConceptAgent(
        novelId, "character-agent", CHARACTER_AGENT_PROMPT, charContext,
        characterProfilesSchema, "concept:characters", "Character Profiles",
        (output: any) => formatCharacterProfiles(output.characters),
      ).then(output => {
        for (const char of output.characters) {
          saveCharacter(novelId, char)
          saveCharacterKnowledgeGraph(novelId, char, worldBible)
        }
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

/** Save world bible systems and cultures to dedicated knowledge graph tables */
function saveWorldKnowledgeGraph(novelId: string, worldBible: WorldBible): void {
  for (const sys of worldBible.systems ?? []) {
    saveWorldSystem(novelId, {
      id: sys.id, name: sys.name, type: sys.type,
      description: sys.description, rules: sys.rules,
      manifestations: sys.manifestations, vocabulary: sys.vocabulary,
      constraints: sys.constraints,
    })
  }
  for (const cult of worldBible.cultures ?? []) {
    saveCulture(novelId, {
      id: cult.id, name: cult.name, description: cult.description,
      values: cult.values, taboos: cult.taboos,
      speechInfluences: cult.speechInfluences, customs: cult.customs,
      systemViews: cult.systemViews,
    })
  }
}

/** Save character's cultural memberships and system awareness to knowledge graph */
function saveCharacterKnowledgeGraph(novelId: string, char: any, worldBible: WorldBible | null): void {
  if (!worldBible) return

  const systems = getWorldSystems(novelId)
  const cultures = getCultures(novelId)

  // Match cultural background by name to culture ids
  for (const cb of char.culturalBackground ?? []) {
    const culture = cultures.find(c => c.name.toLowerCase() === cb.cultureName.toLowerCase())
    if (culture) {
      saveCharacterCulture(novelId, {
        characterId: char.id,
        cultureId: culture.id,
        relationship: cb.relationship || "native",
      })
    }
  }

  // Match system awareness by name to system ids
  for (const sa of char.systemAwareness ?? []) {
    const system = systems.find(s => s.name.toLowerCase() === sa.systemName.toLowerCase())
    if (system) {
      saveCharacterSystemAwareness(novelId, {
        characterId: char.id,
        systemId: system.id,
        awarenessLevel: sa.level || "aware",
        perspective: sa.perspective || "",
        chapterEstablished: 0,
      })
    }
  }
}
