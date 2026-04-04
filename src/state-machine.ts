import { getNovel } from "./db"
import { runConceptPhase } from "./phases/concept"
import { runPlanningPhase } from "./phases/planning"
import { runDraftingPhase } from "./phases/drafting"
import { runValidationPhase } from "./phases/validation"
import { getTokenUsage } from "./llm"
import { emit } from "./events"

export async function runNovel(novelId: string): Promise<void> {
  let novel = getNovel(novelId)

  while (novel.phase !== "done") {
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
    novel = getNovel(novelId)
  }

  const usage = getTokenUsage()
  console.log(`\n╔══════════════════════════════════════╗`)
  console.log(`║          NOVEL COMPLETE               ║`)
  console.log(`╚══════════════════════════════════════╝`)
  console.log(`  Output: output/${novelId}/`)
  console.log(`  Tokens used: ${usage.prompt + usage.completion} (${usage.prompt} prompt + ${usage.completion} completion)`)

  emit(novelId, { type: "done", data: { novelId, tokens: usage } })
}
