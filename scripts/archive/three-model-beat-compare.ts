/**
 * Three-way beat-level comparison at the writer slot.
 *   B — v4 LoRA (current fantasy default, wandb artifact)
 *   L — Llama 3.3 70B on Groq (larger base, same few-shot context)
 *   D — DeepSeek V3.2 (MoE ~37B active, same few-shot context)
 *
 * All three receive byte-identical system + user prompts from
 * buildBeatContext. Only the model varies. Tests whether raw capacity
 * with few-shot matches v4 SFT, and whether 70B dedicated base beats
 * the MoE.
 *
 * Reuses an existing novel's concept + planning to save time.
 *
 * Usage:
 *   bun scripts/three-model-beat-compare.ts <novelId> <sampleSize>
 */
import { getNovel, getWorldBible, getCharacters, getStorySpine, getChapterOutline } from "../../src/db"
import { buildBeatContext } from "../../src/agents/writer/beat-context"
import type { ChapterOutline } from "../../src/types"

const V4    = "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4"
const LLAMA = "llama-3.3-70b-versatile"
const DS    = "deepseek-v4-flash"

interface ProviderCfg { url: string; key: string; model: string }

async function callModel(cfg: ProviderCfg, system: string, user: string, maxTokens: number): Promise<string> {
  const r = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.8,
      max_tokens: maxTokens,
    }),
  })
  if (!r.ok) return `ERROR ${r.status}: ${(await r.text()).slice(0, 200)}`
  const j = await r.json() as any
  return (j.choices?.[0]?.message?.content ?? "").trim()
}

async function main() {
  const novelId = process.argv[2] ?? "fork-writer-fantasy-healer-1776469917596"
  const sampleSize = parseInt(process.argv[3] ?? "10", 10)

  const novel = await getNovel(novelId)
  const worldBible = await getWorldBible(novelId)
  const characters = await getCharacters(novelId)
  const spine = await getStorySpine(novelId)

  const systemPromptPath = new URL("../src/agents/writer/beat-writer-system-salvatore.md", import.meta.url).pathname
  const systemPrompt = await Bun.file(systemPromptPath).text()

  // Gather chapter outlines
  const outlines: ChapterOutline[] = []
  for (let ch = 1; ch <= novel.totalChapters; ch++) {
    try { outlines.push(await getChapterOutline(novelId, ch)) } catch { /* missing */ }
  }

  // Flatten beats with metadata and filter to dialogue-heavy (2+ speakers)
  interface BeatRef { chapter: number; beatIndex: number; outline: ChapterOutline; beat: any }
  const allBeats: BeatRef[] = []
  for (const outline of outlines) {
    for (let i = 0; i < outline.scenes.length; i++) {
      const beat = outline.scenes[i]
      if ((beat.characters?.length ?? 0) >= 2 && (beat.kind === "dialogue" || (beat.kind !== "description" && beat.kind !== "interiority"))) {
        allBeats.push({ chapter: outline.chapterNumber, beatIndex: i, outline, beat })
      }
    }
  }
  // Prefer kind=dialogue
  allBeats.sort((a, b) => (b.beat.kind === "dialogue" ? 1 : 0) - (a.beat.kind === "dialogue" ? 1 : 0))

  const step = Math.max(1, Math.floor(allBeats.length / sampleSize))
  const sample = Array.from({ length: sampleSize }, (_, i) => allBeats[i * step]).filter(Boolean)
  console.log(`Novel: ${novelId}`)
  console.log(`Total dialogue-heavy beats: ${allBeats.length}; sampling ${sample.length}`)

  const WANDB = { url: "https://api.inference.wandb.ai/v1/chat/completions", key: process.env.WANDB_API_KEY!, model: V4 }
  const GROQ  = { url: "https://api.groq.com/openai/v1/chat/completions",      key: process.env.GROQ_API_KEY!,  model: LLAMA }
  const DSEEK = { url: "https://api.deepseek.com/v1/chat/completions",         key: process.env.DEEPSEEK_API_KEY!, model: DS }

  const outLines: string[] = [`# Three-model beat comparison`, ``, `Novel: ${novelId}`, `- **B (v4)**: ${V4.split("/").pop()}`, `- **L (70B)**: ${LLAMA}`, `- **D (DeepSeek)**: ${DS}`, ``, `All three receive the same system + user prompt built by buildBeatContext. Temperature 0.8.`, ``, `---`, ``]

  for (let i = 0; i < sample.length; i++) {
    const { chapter, beatIndex, outline, beat } = sample[i]
    process.stdout.write(`[${i + 1}/${sample.length}] ch${chapter} beat ${beatIndex + 1} (${beat.kind})... `)

    const ctx = await buildBeatContext({
      novelId, chapterNumber: chapter, beatIndex,
      previousBeatProse: undefined,  // don't need transition for isolated comparison
      outline, characters, characterStates: [],
      worldBible, compactMode: true,
    })

    const maxTok = Math.max(600, Math.round(ctx.targetWords * 2))
    const [b, l, d] = await Promise.all([
      callModel(WANDB, systemPrompt, ctx.userPrompt, maxTok),
      callModel(GROQ,  systemPrompt, ctx.userPrompt, maxTok),
      callModel(DSEEK, systemPrompt, ctx.userPrompt, maxTok),
    ])
    process.stdout.write("done\n")

    outLines.push(`## Ch${chapter} Beat ${beatIndex + 1} (${beat.kind}) — ${beat.characters?.join(", ")}`)
    outLines.push(``)
    outLines.push(`**Brief**: ${beat.description}`)
    outLines.push(``)
    outLines.push(`### B — v4 (14B SFT):`)
    outLines.push(``)
    outLines.push(b)
    outLines.push(``)
    outLines.push(`### L — Llama 3.3 70B + few-shot:`)
    outLines.push(``)
    outLines.push(l)
    outLines.push(``)
    outLines.push(`### D — DeepSeek V3.2 + few-shot:`)
    outLines.push(``)
    outLines.push(d)
    outLines.push(``)
    outLines.push(`---`)
    outLines.push(``)
  }

  const outPath = `/tmp/three-model-beats-${Date.now()}.md`
  await Bun.write(outPath, outLines.join("\n"))
  console.log(`\nOutput → ${outPath}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
