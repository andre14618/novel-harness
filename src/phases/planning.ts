import { chapterOutlinesSchema } from "../types"
import {
  getNovel, getWorldBible, getCharacters, getStorySpine,
  saveChapterOutline, updateTotalChapters, updatePhase,
} from "../db"
import { callAgent } from "../llm"
import { PLANNING_PLOTTER_PROMPT } from "../prompts"
import { buildContext as buildPlanningContext } from "../agents/planning-plotter/context"
import { displayPhaseHeader, presentForApproval, formatChapterOutlines } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import * as harness from "../harness"

export async function runPlanningPhase(novelId: string): Promise<void> {
  displayPhaseHeader("Planning — Creating chapter-by-chapter outline")
  log(novelId, "info", "Planning phase started")
  emit(novelId, { type: "phase:changed", data: { phase: "planning" } })

  const novel = await getNovel(novelId)
  const worldBible = await getWorldBible(novelId)
  const characters = await getCharacters(novelId)
  const spine = await getStorySpine(novelId)
  const targetChapters = novel.seed.chapterCount ?? null

  const context = buildPlanningContext(worldBible, characters, spine, novel.seed)

  console.log(`  Running Plotter agent...${targetChapters ? ` (target: ${targetChapters} chapters)` : ""}`)
  emit(novelId, { type: "progress", data: { step: "planning-plotter", status: "running" } })

  // Generate + enforce — up to 2 attempts. The retry prompt is built from
  // the ACTUAL failure (schema message or enforcement errors), not a generic
  // chapter-count warning, so a targeted fix is possible on attempt 2.
  let chapters: any[] | null = null
  let lastError: string | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    let promptContext = context
    if (attempt > 1 && lastError) {
      promptContext += `\n\n--- PREVIOUS ATTEMPT FAILED ---\n${lastError}\n\nFix the specific issue(s) above.`
      if (targetChapters) {
        promptContext += ` Produce exactly ${targetChapters} chapters.`
      }
    }

    try {
      const result = await callAgent({
        novelId, agentName: "planning-plotter",
        attempt,
        systemPrompt: PLANNING_PLOTTER_PROMPT,
        userPrompt: promptContext,
        schema: chapterOutlinesSchema,
      })

      const enforcement = harness.enforce.enforcePlanningOutput(
        result.output.chapters, targetChapters, characters,
      )

      for (const w of enforcement.warnings) {
        log(novelId, "warn", `Planning: ${w}`)
        console.log(`  Warning: ${w}`)
      }

      if (enforcement.valid) {
        chapters = enforcement.chapters
        log(novelId, "info", `Planning attempt ${attempt}: ${chapters.length} chapters (valid)`)
        emit(novelId, { type: "progress", data: { step: "planning-plotter", status: "complete", chapters: chapters.length } })
        break
      } else {
        for (const e of enforcement.errors) {
          log(novelId, "error", `Planning enforcement: ${e}`)
          console.log(`  Enforcement failed: ${e}`)
        }
        lastError = `Enforcement errors: ${enforcement.errors.join("; ")}`
        if (attempt === 2) {
          throw new Error(`Planning failed structural enforcement after 2 attempts: ${enforcement.errors.join("; ")}`)
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt === 2) throw err
      log(novelId, "warn", `Planning attempt ${attempt} failed: ${lastError}`)
    }
  }

  if (!chapters) throw new Error("Planning produced no valid output")

  console.log(`  ${chapters.length} chapter outlines.\n`)

  const decision = await presentForApproval(
    novelId,
    "planning:outlines",
    `Chapter Outline (${chapters.length} chapters)`,
    formatChapterOutlines(chapters),
  )

  if (decision === "reject") {
    console.log("  Regenerating chapter outline...")
    emit(novelId, { type: "progress", data: { step: "planning-plotter", status: "retrying" } })
    const retry = await callAgent({
      novelId, agentName: "planning-plotter",
      attempt: 3, // user-rejected first plan, this is a manual regeneration
      systemPrompt: PLANNING_PLOTTER_PROMPT,
      userPrompt: context,
      schema: chapterOutlinesSchema,
    })
    const enforcement = harness.enforce.enforcePlanningOutput(retry.output.chapters, targetChapters, characters)
    if (!enforcement.valid) throw new Error(`Regeneration failed enforcement: ${enforcement.errors.join("; ")}`)
    chapters = enforcement.chapters

    for (const outline of chapters) await saveChapterOutline(novelId, outline)
    await updateTotalChapters(novelId, chapters.length)
    log(novelId, "info", `Outline regenerated: ${chapters.length} chapters`)
  } else {
    for (const outline of chapters) await saveChapterOutline(novelId, outline)
    await updateTotalChapters(novelId, chapters.length)
    log(novelId, "checkpoint", `${chapters.length} chapter outlines saved`)
  }

  await updatePhase(novelId, "drafting")
  emit(novelId, { type: "phase:changed", data: { phase: "drafting" } })
  log(novelId, "checkpoint", "Planning phase complete → drafting")
  console.log("\n  Planning phase complete. Advancing to Drafting.\n")
}
