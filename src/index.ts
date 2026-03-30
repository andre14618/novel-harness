import { initDB, createNovel, getNovel } from "./db"
import { collectSeedInput, closeInput, setAutoMode } from "./cli"
import { runNovel } from "./state-machine"
import type { SeedInput } from "./types"

const TEST_SEED: SeedInput = {
  premise: "In a crumbling desert city, a disgraced general discovers the empire she served is built on a lie. Now she must choose between exposing the truth — which could collapse the empire — or burying it to protect the people she still loves.",
  genre: "epic fantasy",
  characters: [
    { name: "Kael", role: "protagonist", description: "A disgraced general haunted by the siege she led. Sharp mind, bitter tongue. Exiled to the frontier after questioning the emperor's orders." },
    { name: "Rina", role: "antagonist", description: "The empire's spymaster who knows the founding lie and will kill to keep it hidden. Former comrade of Kael." },
    { name: "Davan", role: "supporting", description: "A young archivist who accidentally uncovered the documents that started everything. Idealistic, terrified, in over his head." },
  ],
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Error: OPENROUTER_API_KEY not set. Copy .env.example to .env and add your key.")
    process.exit(1)
  }

  const isAuto = process.argv.includes("--auto")
  if (isAuto) setAutoMode(true)

  const resumeIdx = process.argv.indexOf("--resume")
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
    // Auto mode with test seed — no interactive input needed
    novelId = `novel-${Date.now()}`
    initDB(novelId)
    createNovel(novelId, TEST_SEED)
    console.log(`\nCreated novel (auto mode): ${novelId}`)
    console.log(`  Premise: ${TEST_SEED.premise.slice(0, 80)}...`)
  } else {
    const seed = await collectSeedInput()
    novelId = `novel-${Date.now()}`
    initDB(novelId)
    createNovel(novelId, seed)
    console.log(`\nCreated novel: ${novelId}`)
  }

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
