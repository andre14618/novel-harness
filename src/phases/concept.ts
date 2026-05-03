import type { SeedInput, WorldBible } from "../types"
import { worldBibleSchema, characterProfilesSchema, storySpineSchema } from "../types"
import {
  saveWorldBible, getWorldBible, saveCharacter, getCharacters,
  saveStorySpine, getStorySpine, updatePhase,
  saveWorldSystem, saveCulture, saveCharacterCulture, saveCharacterSystemAwareness,
  getWorldSystems, getCultures,
} from "../db"
import type { Phase, PhaseResult, ConceptOutput } from "./contract"
import { callAgent } from "../llm"
// Import each prompt directly from its agent module instead of the broad
// `../prompts` barrel. The barrel re-exports planning-beats / writer /
// chapter-plan-checker prompts via top-level await; pulling the barrel
// into concept.ts loaded those prompts as a side effect into any process
// that imported runConceptPhase. The phase-eval probe parent imports
// runConceptPhase directly and would otherwise cache planning-beats's
// default prompt before child processes get a chance to set their
// PLANNING_BEATS_PROMPT_OVERRIDE env var. Direct imports keep concept.ts's
// surface to the three prompts it actually uses.
import { prompt as WORLD_BUILDER_PROMPT } from "../agents/world-builder"
import { prompt as CHARACTER_AGENT_PROMPT } from "../agents/character-agent"
import { prompt as PLOTTER_AGENT_PROMPT } from "../agents/plotter"
import { buildContext as buildWorldContext } from "../agents/world-builder/context"
import { buildContext as buildPlotterContext } from "../agents/plotter/context"
import { buildContext as buildCharContext } from "../agents/character-agent/context"
import {
  displayPhaseHeader, presentForApproval, getRevisionNotes,
  formatWorldBible, formatCharacterProfiles, formatStorySpine,
} from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import { pipeline } from "../config/pipeline"

async function tryGet<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn() } catch { return null }
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
        attempt,
        systemPrompt: prompt,
        userPrompt: currentContext,
        schema,
      })
      // schema is typed `any` so callAgent infers T=unknown here; the caller
      // supplies the real T via runConceptAgent's generic, so the cast is safe.
      const output = result.output as T

      emit(novelId, { type: "progress", data: { step: agentName, status: "complete" } })

      const decision = await presentForApproval(
        novelId, gateId, gateTitle, formatFn(output),
      )

      if (decision === "approve") {
        return output
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

/** Concept phase implementation. Kept exported for scripts that compose
 *  phases outside the runNovel driver (3 callers:
 *  scripts/archive/fork-writer-test.ts, scripts/archive/fork-writer-v4-llama.ts,
 *  test-planner-isolated.ts). Driver consumers should use `conceptPhase`
 *  (the Phase<I,O> wrapper) instead. */
export async function runConceptPhase(novelId: string, seed: SeedInput): Promise<PhaseResult<ConceptOutput>> {
  displayPhaseHeader("Concept — Building your world, characters, and story")
  log(novelId, "info", `Concept phase started. Premise: ${seed.premise.slice(0, 100)}`)
  emit(novelId, { type: "phase:changed", data: { phase: "concept" } })

  const contexts = {
    world: buildWorldContext(seed),
    plotter: buildPlotterContext(seed),
  }

  // Check what's already saved (for resume)
  const existingWorld = await tryGet(() => getWorldBible(novelId))
  const existingChars = await getCharacters(novelId)
  const existingSpine = await tryGet(() => getStorySpine(novelId))

  const needsWorld = !existingWorld
  const needsChars = existingChars.length === 0
  const needsSpine = !existingSpine

  // Step 1: World-builder runs first (character-agent needs systems/cultures)
  let worldBible: WorldBible
  if (needsWorld) {
    console.log("\n  [1/3] World Builder...")
    worldBible = await runConceptAgent<WorldBible>(
      novelId, "world-builder", WORLD_BUILDER_PROMPT, contexts.world,
      worldBibleSchema, "concept:world-bible", "World Bible", formatWorldBible,
    )
    await saveWorldBible(novelId, worldBible)
    // Save structured systems and cultures to dedicated tables
    await saveWorldKnowledgeGraph(novelId, worldBible)
    log(novelId, "checkpoint", "World bible saved")
  } else {
    console.log("\n  [1/3] World Bible — already saved, skipping")
    // `existingWorld` is non-null because needsWorld was false.
    worldBible = existingWorld!
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
      ).then(async output => {
        for (const char of output.characters) {
          await saveCharacter(novelId, char)
          await saveCharacterKnowledgeGraph(novelId, char, worldBible)
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
      ).then(async output => {
        await saveStorySpine(novelId, output)
        log(novelId, "checkpoint", "Story spine saved")
      }),
    )
  } else {
    console.log("  [3/3] Story Spine — already saved, skipping")
  }

  await Promise.all(pending)

  // P6b1: phase transition (updatePhase + matching emit) is now driver-owned.
  // The phase-complete log + console message stays here; the driver writes the
  // novels.phase row and emits phase:changed for the next phase on its own
  // entry.
  log(novelId, "checkpoint", "Concept phase complete → planning")
  console.log("\n  Concept phase complete. Advancing to Planning.\n")

  const output = await loadConceptOutput(novelId)
  return { kind: "complete", output }
}

/** Reconstruct ConceptOutput from DB. Called on resume by the typed driver
 *  (P6b1+). Only called when novel.phase has advanced past concept — at that
 *  point all artifacts MUST exist; throws otherwise (treated as schema
 *  invariant violation, not a control-flow path). */
export async function loadConceptOutput(novelId: string): Promise<ConceptOutput> {
  const world = await tryGet(() => getWorldBible(novelId))
  if (!world) {
    throw new Error(`loadConceptOutput(${novelId}): world_bibles row missing — concept phase did not complete`)
  }
  const spine = await tryGet(() => getStorySpine(novelId))
  if (!spine) {
    throw new Error(`loadConceptOutput(${novelId}): story_spines row missing — concept phase did not complete`)
  }
  const chars = await getCharacters(novelId)
  const systems = await getWorldSystems(novelId)
  const cultures = await getCultures(novelId)
  return {
    hasWorldBible: true,
    characterCount: chars.length,
    hasStorySpine: true,
    worldSystemsCount: systems.length,
    culturesCount: cultures.length,
  }
}

/** P2 — Phase<SeedInput, ConceptOutput> wrapper. Not yet consumed by the
 *  state-machine; P6b1 flips the driver to use it. */
export const conceptPhase: Phase<SeedInput, ConceptOutput> = {
  name: "concept",
  async run(_input, ctx) {
    // The typed pipe gives us SeedInput as the first phase's input, but
    // PhaseCtx.seed is the immutable snapshot the driver constructed once.
    // They're identical for Concept; we use ctx.seed for clarity.
    return runConceptPhase(ctx.novelId, ctx.seed)
  },
  async loadOutput(novelId) {
    return loadConceptOutput(novelId)
  },
}

/** Save world bible systems and cultures to dedicated knowledge graph tables */
async function saveWorldKnowledgeGraph(novelId: string, worldBible: WorldBible): Promise<void> {
  for (const sys of worldBible.systems ?? []) {
    await saveWorldSystem(novelId, {
      id: sys.id, name: sys.name, type: sys.type,
      description: sys.description, rules: sys.rules,
      manifestations: sys.manifestations, vocabulary: sys.vocabulary,
      constraints: sys.constraints,
    })
  }
  for (const cult of worldBible.cultures ?? []) {
    await saveCulture(novelId, {
      id: cult.id, name: cult.name, description: cult.description,
      values: cult.values, taboos: cult.taboos,
      speechInfluences: cult.speechInfluences, customs: cult.customs,
      systemViews: cult.systemViews,
    })
  }
}

/** Save character's cultural memberships and system awareness to knowledge graph */
async function saveCharacterKnowledgeGraph(novelId: string, char: any, worldBible: WorldBible | null): Promise<void> {
  if (!worldBible) return

  const systems = await getWorldSystems(novelId)
  const cultures = await getCultures(novelId)

  // Match cultural background by name to culture ids
  for (const cb of char.culturalBackground ?? []) {
    const culture = cultures.find(c => c.name.toLowerCase() === cb.cultureName.toLowerCase())
    if (culture) {
      await saveCharacterCulture(novelId, {
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
      await saveCharacterSystemAwareness(novelId, {
        characterId: char.id,
        systemId: system.id,
        awarenessLevel: sa.level || "aware",
        perspective: sa.perspective || "",
        chapterEstablished: 0,
      })
    }
  }
}
