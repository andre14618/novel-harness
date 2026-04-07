import { getNovel } from "./db"
import { runConceptPhase } from "./phases/concept"
import { runPlanningPhase } from "./phases/planning"
import { runDraftingPhase } from "./phases/drafting"
import { runValidationPhase } from "./phases/validation"
import { getTokenUsage } from "./llm"
import { emit } from "./events"
import { pipeline } from "./config/pipeline"

export async function runNovel(novelId: string): Promise<void> {
  let novel = await getNovel(novelId)
  let prevSignature = ""
  let stuckCount = 0

  while (novel.phase !== "done") {
    // Detect a phase that re-dispatches without making progress (same phase + same chapter
    // as the previous iteration). The inner retry loops have their own caps; this is the
    // outer ceiling that prevents infinite spin if a phase keeps returning early.
    const signature = `${novel.phase}:${novel.currentChapter}`
    if (signature === prevSignature) {
      stuckCount++
      if (stuckCount > pipeline.maxPhaseRestarts) {
        throw new Error(
          `Phase "${novel.phase}" stuck at chapter ${novel.currentChapter} after ${stuckCount} restarts without progress. ` +
          `Increase pipeline.maxPhaseRestarts or investigate why the phase is failing.`,
        )
      }
      console.log(`  [state-machine] Phase "${novel.phase}" did not advance — restart ${stuckCount}/${pipeline.maxPhaseRestarts}`)
    } else {
      stuckCount = 0
    }
    prevSignature = signature

    switch (novel.phase) {
      case "concept":
        await runConceptPhase(novelId, novel.seed)
        break
      case "planning":
        await runPlanningPhase(novelId)
        break
      case "drafting":
        await runDraftingPhase(novelId)
        break
      case "validation":
        await runValidationPhase(novelId)
        break
    }
    novel = await getNovel(novelId)
  }

  const usage = getTokenUsage()
  console.log(`\n╔══════════════════════════════════════╗`)
  console.log(`║          NOVEL COMPLETE               ║`)
  console.log(`╚══════════════════════════════════════╝`)
  console.log(`  Output: output/${novelId}/`)
  console.log(`  Tokens used: ${usage.prompt + usage.completion} (${usage.prompt} prompt + ${usage.completion} completion)`)

  emit(novelId, { type: "done", data: { novelId, tokens: usage } })
}
