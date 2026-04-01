import { chapterOutlinesSchema } from "../types"
import {
  getNovel, getWorldBible, getCharacters, getStorySpine,
  saveChapterOutline, updateTotalChapters, updatePhase,
} from "../db"
import { callAgent } from "../llm"
import { PLANNING_PLOTTER_PROMPT } from "../prompts"
import { buildPlanningContext } from "../context"
import { displayPhaseHeader, presentForApproval, formatChapterOutlines } from "../cli"
import { log } from "../logger"

export async function runPlanningPhase(novelId: string): Promise<void> {
  displayPhaseHeader("Planning — Creating chapter-by-chapter outline")
  log(novelId, "info", "Planning phase started")

  const novel = getNovel(novelId)
  const worldBible = getWorldBible(novelId)
  const characters = getCharacters(novelId)
  const spine = getStorySpine(novelId)

  const context = buildPlanningContext(worldBible, characters, spine, novel.seed)

  console.log("  Running Plotter agent...")

  let result
  try {
    result = await callAgent({
      novelId, agentName: "planning-plotter",
      systemPrompt: PLANNING_PLOTTER_PROMPT,
      userPrompt: context,
      schema: chapterOutlinesSchema,
      temperature: 0.6,
      maxTokens: 8192,
    })
    log(novelId, "info", `Planning agent generated ${result.output.chapters.length} chapter outlines`)
  } catch (err) {
    log(novelId, "error", `Planning agent failed: ${err}`)
    throw err
  }

  console.log(`  Generated ${result.output.chapters.length} chapter outlines.\n`)

  const decision = await presentForApproval(
    `Chapter Outline (${result.output.chapters.length} chapters)`,
    formatChapterOutlines(result.output.chapters),
  )

  if (decision === "reject") {
    console.log("  Regenerating chapter outline...")
    const retry = await callAgent({
      novelId, agentName: "planning-plotter-retry",
      systemPrompt: PLANNING_PLOTTER_PROMPT,
      userPrompt: context,
      schema: chapterOutlinesSchema,
      temperature: 0.7,
      maxTokens: 8192,
    })
    for (const outline of retry.output.chapters) saveChapterOutline(novelId, outline)
    updateTotalChapters(novelId, retry.output.chapters.length)
    log(novelId, "info", `Outline regenerated: ${retry.output.chapters.length} chapters`)
  } else {
    for (const outline of result.output.chapters) saveChapterOutline(novelId, outline)
    updateTotalChapters(novelId, result.output.chapters.length)
    log(novelId, "checkpoint", `${result.output.chapters.length} chapter outlines saved`)
  }

  updatePhase(novelId, "drafting")
  log(novelId, "checkpoint", "Planning phase complete → drafting")
  console.log("\n  Planning phase complete. Advancing to Drafting.\n")
}
