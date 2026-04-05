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

  let result
  try {
    result = await callAgent({
      novelId, agentName: "planning-plotter",
      systemPrompt: PLANNING_PLOTTER_PROMPT,
      userPrompt: context,
      schema: chapterOutlinesSchema,
    })
    log(novelId, "info", `Planning agent generated ${result.output.chapters.length} chapter outlines`)
    emit(novelId, { type: "progress", data: { step: "planning-plotter", status: "complete", chapters: result.output.chapters.length } })
  } catch (err) {
    log(novelId, "error", `Planning agent failed: ${err}`)
    emit(novelId, { type: "error", data: { step: "planning-plotter", error: String(err) } })
    throw err
  }

  // ── Deterministic enforcement: chapter count and numbering ──────────
  let chapters = result.output.chapters

  if (targetChapters) {
    if (chapters.length > targetChapters) {
      log(novelId, "info", `Trimming ${chapters.length} chapters to target ${targetChapters}`)
      chapters = chapters.slice(0, targetChapters)
    } else if (chapters.length < targetChapters) {
      // Re-generate with stronger instruction
      log(novelId, "warn", `Got ${chapters.length} chapters, need ${targetChapters}. Regenerating.`)
      console.log(`  Got ${chapters.length} chapters, need ${targetChapters}. Regenerating...`)
      const retryContext = context + `\n\nCRITICAL: You MUST produce exactly ${targetChapters} chapters. You produced ${chapters.length} last time which is not enough.`
      const retry = await callAgent({
        novelId, agentName: "planning-plotter",
        systemPrompt: PLANNING_PLOTTER_PROMPT,
        userPrompt: retryContext,
        schema: chapterOutlinesSchema,
      })
      chapters = retry.output.chapters.slice(0, targetChapters)
    }
  }

  // Enforce sequential chapter numbering (1, 2, 3, ...)
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].chapterNumber = i + 1
  }

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
      systemPrompt: PLANNING_PLOTTER_PROMPT,
      userPrompt: context,
      schema: chapterOutlinesSchema,
    })
    let retryChapters = retry.output.chapters
    if (targetChapters) retryChapters = retryChapters.slice(0, targetChapters)
    for (let i = 0; i < retryChapters.length; i++) retryChapters[i].chapterNumber = i + 1

    for (const outline of retryChapters) await saveChapterOutline(novelId, outline)
    await updateTotalChapters(novelId, retryChapters.length)
    log(novelId, "info", `Outline regenerated: ${retryChapters.length} chapters`)
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
