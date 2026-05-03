/**
 * Fork-writer comparison: generate one novel's concept + planning, then
 * for every beat in chapters 1–3, call v3 AND v4 with the same system
 * prompt + user context. Emit side-by-side prose.
 *
 * Pipeline up to drafting is shared (same world, same characters, same
 * chapter plan). Only the beat-writer LoRA varies.
 */
import { initDB, createNovel, getNovel, getWorldBible, getCharacters, getStorySpine, getChapterOutline } from "../../src/db"
import { setAutoMode, setResolverMode } from "../../src/cli"
import { getMode } from "../../src/gates"
import { runConceptPhase } from "../../src/phases/concept"
import { runPlanningPhase } from "../../src/phases/planning"
import { buildBeatContext } from "../../src/agents/writer/beat-context"
import { initNovelRun } from "../../src/logger"
import type { SeedInput, ChapterOutline } from "../../src/types"
import db from "../../src/db/connection"

const V3 = "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v3"
const V4 = "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4"

async function loadSeed(name: string): Promise<SeedInput> {
  const path = new URL(`../src/seeds/${name}.json`, import.meta.url).pathname
  return Bun.file(path).json() as Promise<SeedInput>
}

async function callLoRA(model: string, systemPrompt: string, userPrompt: string, targetWords: number): Promise<string> {
  const key = process.env.WANDB_API_KEY!
  const r = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      temperature: 0.8,
      max_tokens: Math.max(600, Math.round(targetWords * 2)),
    }),
  })
  if (!r.ok) return `ERROR ${r.status}: ${(await r.text()).slice(0, 200)}`
  const j = await r.json() as any
  return (j.choices?.[0]?.message?.content ?? "").trim()
}

async function main() {
  const seedName = process.argv[2] ?? "fantasy-healer"
  const chapters = parseInt(process.argv[3] ?? "3", 10)
  const outPath = `/tmp/fork-writer-${seedName}-${Date.now()}.md`

  setAutoMode(true)
  setResolverMode(getMode(true))

  const seed = await loadSeed(seedName)
  seed.chapterCount = chapters

  const novelId = `fork-writer-${seedName}-${Date.now()}`
  console.log(`Novel: ${novelId}, seed: ${seedName}, chapters: ${chapters}`)
  await initDB(novelId)
  await createNovel(novelId, seed)
  await initNovelRun(novelId)

  console.log("▸ concept phase...")
  await runConceptPhase(novelId, seed)
  console.log("▸ planning phase...")
  await runPlanningPhase(novelId)

  const worldBible = await getWorldBible(novelId)
  const characters = await getCharacters(novelId)
  const spine = await getStorySpine(novelId)
  const novel = await getNovel(novelId)

  const systemPromptPath = new URL("../src/agents/writer/beat-writer-system-salvatore.md", import.meta.url).pathname
  const systemPrompt = await Bun.file(systemPromptPath).text()

  const outlines: ChapterOutline[] = []
  for (let i = 1; i <= chapters; i++) {
    outlines.push(await getChapterOutline(novelId, i))
  }

  const lines: string[] = []
  lines.push(`# Fork-writer comparison: ${seedName} (${chapters} chapters)`)
  lines.push(``)
  lines.push(`- Novel ID: ${novelId}`)
  lines.push(`- Seed premise: ${seed.premise}`)
  lines.push(`- Characters with exampleLines: ${characters.filter((c: any) => c.exampleLines?.length > 0).length}/${characters.length}`)
  lines.push(``)
  // Show the characters and their exampleLines for visibility
  lines.push(`## Characters (generated at concept phase)`)
  for (const c of characters as any[]) {
    lines.push(`\n### ${c.name} — ${c.role}`)
    lines.push(`- **Voice**: ${c.speechPattern}`)
    if (c.exampleLines?.length) {
      lines.push(`- **Example lines**:`)
      for (const line of c.exampleLines) lines.push(`  - "${line}"`)
    } else {
      lines.push(`- **Example lines**: (none generated)`)
    }
  }
  lines.push(``)

  for (let chIdx = 0; chIdx < outlines.length; chIdx++) {
    const outline = outlines[chIdx]
    lines.push(`\n---\n\n## Chapter ${outline.chapterNumber}: ${outline.title}`)
    lines.push(`- POV: ${outline.povCharacter}`)
    lines.push(`- Setting: ${outline.setting}`)
    lines.push(`- Purpose: ${outline.purpose}`)
    lines.push(`- Target words: ${outline.targetWords}`)
    lines.push(`- Beats: ${outline.scenes.length}`)

    let prevBeatProseV3: string | undefined
    let prevBeatProseV4: string | undefined

    for (let beatIdx = 0; beatIdx < outline.scenes.length; beatIdx++) {
      const beat = outline.scenes[beatIdx]
      console.log(`  ch${outline.chapterNumber} beat ${beatIdx + 1}/${outline.scenes.length}: ${beat.description.slice(0, 60)}...`)

      // Build context (use v3's transition bridge for itself, v4's for itself)
      const ctxV3 = await buildBeatContext({
        novelId, chapterNumber: outline.chapterNumber, beatIndex: beatIdx,
        previousBeatProse: prevBeatProseV3, outline, characters,
        characterStates: [], worldBible, compactMode: true,
      })
      const ctxV4 = await buildBeatContext({
        novelId, chapterNumber: outline.chapterNumber, beatIndex: beatIdx,
        previousBeatProse: prevBeatProseV4, outline, characters,
        characterStates: [], worldBible, compactMode: true,
      })

      const [v3Prose, v4Prose] = await Promise.all([
        callLoRA(V3, systemPrompt, ctxV3.userPrompt, ctxV3.targetWords),
        callLoRA(V4, systemPrompt, ctxV4.userPrompt, ctxV4.targetWords),
      ])

      prevBeatProseV3 = v3Prose.startsWith("ERROR") ? prevBeatProseV3 : v3Prose
      prevBeatProseV4 = v4Prose.startsWith("ERROR") ? prevBeatProseV4 : v4Prose

      lines.push(`\n### Beat ${beatIdx + 1}: ${beat.kind ?? "?"} — ${beat.description.slice(0, 100)}`)
      lines.push(`Speakers: ${(beat.characters ?? []).join(", ") || "(none listed)"}`)
      lines.push(`\n**v3**:\n\n${v3Prose}`)
      lines.push(`\n**v4**:\n\n${v4Prose}`)
      lines.push(``)
    }
  }

  await Bun.write(outPath, lines.join("\n"))
  console.log(`\nOutput → ${outPath}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
