import { initDB, createNovel, getNovel } from "./db"
import { collectSeedInput, closeInput, setAutoMode, setResolverMode } from "./cli"
import { getMode } from "./gates"
import { runNovel } from "./state-machine"
import { initNovelRun } from "./logger"
import { getRunConfig, logRunConfig, type RunConfig } from "./config/run"
import type { SeedInput } from "./types"

function applyRunOverrides(seed: SeedInput, config: RunConfig): void {
  if (config.qualityRedraft) {
    seed.pipelineOverrides = { ...(seed.pipelineOverrides ?? {}), qualityRedraftEnabled: true }
  }
}

async function loadSeed(name: string): Promise<SeedInput> {
  const path = new URL(`./seeds/${name}.json`, import.meta.url).pathname
  const file = Bun.file(path)
  if (!await file.exists()) {
    console.error(`Seed file not found: src/seeds/${name}.json`)
    process.exit(1)
  }
  return file.json()
}

async function main() {
  const config = getRunConfig()

  if (config.auto) setAutoMode(true)
  setResolverMode(getMode(config.auto))

  let novelId: string

  if (config.resumeId) {
    novelId = config.resumeId
    console.log(`\nResuming novel: ${novelId}`)
    await initDB(novelId)

    try {
      const novel = await getNovel(novelId)
      console.log(`  Phase: ${novel.phase}`)
      console.log(`  Progress: chapter ${novel.currentChapter}/${novel.totalChapters}`)
    } catch {
      console.error(`Error: Novel "${novelId}" not found`)
      process.exit(1)
    }
  } else if (config.auto) {
    const seed = await loadSeed(config.seed)
    if (config.chapters) seed.chapterCount = config.chapters
    applyRunOverrides(seed, config)

    novelId = `novel-${Date.now()}`
    await initDB(novelId)
    await createNovel(novelId, seed)
    console.log(`\nCreated novel (auto mode, seed: ${config.seed}): ${novelId}`)
    logRunConfig(config)
    console.log(`  Premise: ${seed.premise.slice(0, 80)}...`)
  } else {
    const seed = await collectSeedInput()
    if (config.chapters) seed.chapterCount = config.chapters
    applyRunOverrides(seed, config)

    novelId = `novel-${Date.now()}`
    await initDB(novelId)
    await createNovel(novelId, seed)
    console.log(`\nCreated novel: ${novelId}`)
  }

  const runId = await initNovelRun(novelId)
  console.log(`  Central DB run: ${runId}`)

  try {
    const result = await runNovel(novelId)
    if (result.outcome === "paused") {
      console.log(`\nPaused at ${result.phase}: ${result.reason}`)
      console.log(`Resume with: bun src/index.ts --resume ${novelId}`)
    }
  } catch (err) {
    console.error("\nError:", err instanceof Error ? err.message : err)
    console.log(`\nYou can resume with: bun src/index.ts --resume ${novelId}`)
  } finally {
    closeInput()
  }
}

main()
