/**
 * Fork-writer: v4 LoRA vs Llama 3.3 70B on Groq (with exampleLines few-shot).
 *
 * Same concept + planning as the fantasy seed's pipeline run. Every beat
 * in chapters 1-3 is generated TWICE with byte-identical system + user
 * context. Only the writer model varies.
 */
import { initDB, createNovel, getNovel, getWorldBible, getCharacters, getChapterOutline } from "../src/db"
import { setAutoMode, setResolverMode } from "../src/cli"
import { getMode } from "../src/gates"
import { runConceptPhase } from "../src/phases/concept"
import { runPlanningPhase } from "../src/phases/planning"
import { buildBeatContext } from "../src/agents/writer/beat-context"
import { initNovelRun } from "../src/logger"
import type { SeedInput, ChapterOutline } from "../src/types"

const V4_MODEL = "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4"
const LLAMA_MODEL = "llama-3.3-70b-versatile"

async function loadSeed(name: string): Promise<SeedInput> {
  const path = new URL(`../src/seeds/${name}.json`, import.meta.url).pathname
  return Bun.file(path).json() as Promise<SeedInput>
}

async function callV4(system: string, user: string, maxTokens: number): Promise<string> {
  const r = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.WANDB_API_KEY}` },
    body: JSON.stringify({ model: V4_MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.8, max_tokens: maxTokens }),
  })
  if (!r.ok) return `ERROR ${r.status}: ${(await r.text()).slice(0, 150)}`
  return (((await r.json()) as any).choices?.[0]?.message?.content ?? "").trim()
}

async function callLlama(system: string, user: string, maxTokens: number): Promise<string> {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: LLAMA_MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.8, max_tokens: maxTokens }),
  })
  if (!r.ok) return `ERROR ${r.status}: ${(await r.text()).slice(0, 150)}`
  return (((await r.json()) as any).choices?.[0]?.message?.content ?? "").trim()
}

async function main() {
  const seedName = process.argv[2] ?? "fantasy-healer"
  const chapters = parseInt(process.argv[3] ?? "3", 10)

  setAutoMode(true)
  setResolverMode(getMode(true))

  const seed = await loadSeed(seedName)
  seed.chapterCount = chapters
  const novelId = `fork-v4-llama-${seedName}-${Date.now()}`
  console.log(`Novel: ${novelId}`)
  await initDB(novelId)
  await createNovel(novelId, seed)
  await initNovelRun(novelId)

  console.log("▸ concept...")
  await runConceptPhase(novelId, seed)
  console.log("▸ planning...")
  await runPlanningPhase(novelId)

  const worldBible = await getWorldBible(novelId)
  const characters = await getCharacters(novelId)
  const novel = await getNovel(novelId)

  const systemPromptPath = new URL("../src/agents/writer/beat-writer-system-salvatore.md", import.meta.url).pathname
  const systemPrompt = await Bun.file(systemPromptPath).text()

  const outlines: ChapterOutline[] = []
  for (let i = 1; i <= chapters; i++) outlines.push(await getChapterOutline(novelId, i))

  const lines: string[] = []
  lines.push(`# Fork-writer: v4 vs Llama 3.3 70B (${seedName}, ${chapters} chapters)`)
  lines.push(``)
  lines.push(`- **B** = Salvatore v4 LoRA (14B SFT)`)
  lines.push(`- **L** = Llama 3.3 70B + exampleLines few-shot (no fine-tune)`)
  lines.push(`- Identical concept + planning; identical beat-context for both.`)
  lines.push(`- Novel ID: \`${novelId}\``)
  lines.push(``)
  lines.push(`## Characters (with exampleLines from concept phase)`)
  for (const c of characters as any[]) {
    lines.push(`\n### ${c.name} — ${c.role}`)
    lines.push(`- **Voice**: ${c.speechPattern}`)
    if (c.exampleLines?.length) {
      lines.push(`- **Example lines**:`)
      for (const l of c.exampleLines) lines.push(`  - "${l}"`)
    }
  }
  lines.push(``)

  let prevB: string | undefined, prevL: string | undefined
  const latencies: { v4: number[]; llama: number[] } = { v4: [], llama: [] }

  for (const outline of outlines) {
    lines.push(`\n---\n\n## Chapter ${outline.chapterNumber}: ${outline.title}`)
    lines.push(`- POV: ${outline.povCharacter} | Setting: ${outline.setting}`)
    lines.push(`- Purpose: ${outline.purpose}`)
    lines.push(`- Beats: ${outline.scenes.length}`)

    prevB = undefined; prevL = undefined  // reset bridges per chapter

    for (let beatIdx = 0; beatIdx < outline.scenes.length; beatIdx++) {
      const beat = outline.scenes[beatIdx]
      console.log(`  ch${outline.chapterNumber} beat ${beatIdx + 1}/${outline.scenes.length}: ${beat.description.slice(0, 50)}...`)

      const ctxB = await buildBeatContext({ novelId, chapterNumber: outline.chapterNumber, beatIndex: beatIdx, previousBeatProse: prevB, outline, characters, characterStates: [], worldBible, compactMode: true })
      const ctxL = await buildBeatContext({ novelId, chapterNumber: outline.chapterNumber, beatIndex: beatIdx, previousBeatProse: prevL, outline, characters, characterStates: [], worldBible, compactMode: true })

      const maxTok = Math.max(600, Math.round(ctxB.targetWords * 2))
      const t0 = performance.now()
      const [b, l] = await Promise.all([
        (async () => { const s = performance.now(); const x = await callV4(systemPrompt, ctxB.userPrompt, maxTok); latencies.v4.push(performance.now() - s); return x })(),
        (async () => { const s = performance.now(); const x = await callLlama(systemPrompt, ctxL.userPrompt, maxTok); latencies.llama.push(performance.now() - s); return x })(),
      ])

      prevB = b.startsWith("ERROR") ? prevB : b
      prevL = l.startsWith("ERROR") ? prevL : l

      lines.push(`\n### Beat ${beatIdx + 1}: ${beat.kind ?? "?"} — ${beat.description.slice(0, 100)}`)
      lines.push(`Speakers: ${(beat.characters ?? []).join(", ") || "(none listed)"}`)
      lines.push(`\n**B (v4)**:\n\n${b}`)
      lines.push(`\n**L (Llama 70B)**:\n\n${l}`)
      lines.push(``)
    }
  }

  const outPath = `/tmp/fork-v4-llama-${seedName}-${Date.now()}.md`
  const avgV4 = latencies.v4.reduce((a,b)=>a+b,0) / latencies.v4.length
  const avgLlama = latencies.llama.reduce((a,b)=>a+b,0) / latencies.llama.length
  lines.push(`\n---\n\n## Latency summary`)
  lines.push(`- v4 avg: ${Math.round(avgV4)}ms/beat  (${latencies.v4.length} beats)`)
  lines.push(`- Llama 70B avg: ${Math.round(avgLlama)}ms/beat  (${latencies.llama.length} beats)`)
  lines.push(`- Speed ratio: Llama is ${(avgV4 / avgLlama).toFixed(1)}× faster`)

  await Bun.write(outPath, lines.join("\n"))
  console.log(`\nLatency: v4 ${Math.round(avgV4)}ms | Llama 70B ${Math.round(avgLlama)}ms (${(avgV4/avgLlama).toFixed(1)}× faster)`)
  console.log(`Output → ${outPath}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
