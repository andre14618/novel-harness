import { getNovel } from "./db"
import { runConceptPhase } from "./phases/concept"
import { runPlanningPhase } from "./phases/planning"
import { runDraftingPhase } from "./phases/drafting"
import { getTokenUsage } from "./llm"

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
    }
    novel = getNovel(novelId)
  }

  const usage = getTokenUsage()
  console.log(`\n╔══════════════════════════════════════╗`)
  console.log(`║          NOVEL COMPLETE               ║`)
  console.log(`╚══════════════════════════════════════╝`)
  console.log(`  Output: output/${novelId}/`)
  console.log(`  Tokens used: ${usage.prompt + usage.completion} (${usage.prompt} prompt + ${usage.completion} completion)`)
}
