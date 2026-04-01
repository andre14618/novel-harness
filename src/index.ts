import { initDB, createNovel, getNovel } from "./db"
import { collectSeedInput, closeInput, setAutoMode } from "./cli"
import { runNovel } from "./state-machine"
import { initNovelRun } from "./logger"
import type { SeedInput } from "./types"

// Load seed from file — default to epic-fantasy, or pass --seed <name>
async function loadSeed(name: string = "epic-fantasy"): Promise<SeedInput> {
  const path = new URL(`./seeds/${name}.json`, import.meta.url).pathname
  const file = Bun.file(path)
  if (!await file.exists()) {
    console.error(`Seed file not found: src/seeds/${name}.json`)
    process.exit(1)
  }
  return file.json()
}

async function main() {
  const isAuto = process.argv.includes("--auto")
  if (isAuto) setAutoMode(true)

  const resumeIdx = process.argv.indexOf("--resume")
  const seedIdx = process.argv.indexOf("--seed")
  let novelId: string

  if (resumeIdx !== -1 && process.argv[resumeIdx + 1]) {
    novelId = process.argv[resumeIdx + 1]
    console.log(`\nResuming novel: ${novelId}`)
    initDB(novelId)

    try {
      const novel = getNovel(novelId)
      console.log(`  Phase: ${novel.phase}`)
      console.log(`  Progress: chapter ${novel.currentChapter}/${novel.totalChapters}`)
    } catch {
      console.error(`Error: Novel "${novelId}" not found in output/${novelId}/novel.db`)
      process.exit(1)
    }
  } else if (isAuto) {
    const seedName = seedIdx !== -1 ? process.argv[seedIdx + 1] : "epic-fantasy"
    const seed = await loadSeed(seedName)
    novelId = `novel-${Date.now()}`
    initDB(novelId)
    createNovel(novelId, seed)
    console.log(`\nCreated novel (auto mode, seed: ${seedName}): ${novelId}`)
    console.log(`  Premise: ${seed.premise.slice(0, 80)}...`)
  } else {
    const seed = await collectSeedInput()
    novelId = `novel-${Date.now()}`
    initDB(novelId)
    createNovel(novelId, seed)
    console.log(`\nCreated novel: ${novelId}`)
  }

  // Register this novel run in the central DB with current model config
  const runId = initNovelRun(novelId)
  console.log(`  Central DB run: ${runId}`)

  try {
    await runNovel(novelId)
  } catch (err) {
    console.error("\nError:", err instanceof Error ? err.message : err)
    console.log(`\nYou can resume with: bun src/index.ts --resume ${novelId}`)
  } finally {
    closeInput()
  }
}

main()
