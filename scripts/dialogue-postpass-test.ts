/**
 * Dialogue post-pass test — takes v4 LoRA dialogue lines from the
 * fork-writer output and runs two voice rewriters on each:
 *   - L: archetype-poc-v1 LoRA (profile only — its training shape)
 *   - D: DeepSeek V3.2 + profile + 5 few-shot example lines
 *
 * Tests the production shape we haven't validated before:
 *   (v4 voiced-but-generic dialogue) → (rewriter) → (character-specific voice)
 *
 * Eyeball output; no judging.
 */
import { readFileSync, writeFileSync } from "fs"

const FORK_MD = "/tmp/fork.md"
const OUT = "/tmp/dialogue-postpass-eyeball.md"

const LORA = "wandb-artifact:///andre14618-/novel-harness/archetype-poc-v1"
const SAMPLE_PER_CHAR = 8  // total: 24 rewrites × 2 rewriters = 48 calls

interface Char { name: string; voice: string; drives: string; avoids: string; conflict: string; examples: string[] }

function parseCharacters(md: string): Record<string, Char> {
  const chars: Record<string, Char> = {}
  const re = /### ([^—\n]+) — (\w+)\n- \*\*Voice\*\*: (.+?)\n(?:[\s\S]*?)- \*\*Example lines\*\*:\n((?:  - "[^"]+"\n?)+)/g
  let m
  while ((m = re.exec(md)) !== null) {
    const name = m[1].trim()
    const profile = md.slice(m.index, m.index + 2000)
    const exMatches = [...m[4].matchAll(/  - "([^"]+)"/g)].map(x => x[1])
    const drivesMatch = profile.match(/Drives[^:]*:\s*(.+?)\n/i)
    const avoidsMatch = profile.match(/Avoids[^:]*:\s*(.+?)\n/i)
    chars[name] = {
      name,
      voice: m[3],
      drives: drivesMatch?.[1] ?? "",
      avoids: avoidsMatch?.[1] ?? "",
      conflict: "",
      examples: exMatches,
    }
  }
  return chars
}

function extractDialogueFromV4(md: string): Array<{ char: string; line: string; beat_id: string }> {
  // Split into beat sections and extract v4 prose
  const lines: Array<{ char: string; line: string; beat_id: string }> = []
  const beatRe = /### Beat \d+:[^\n]+\nSpeakers: ([^\n]+)\n\n\*\*v3\*\*:[\s\S]*?\n\*\*v4\*\*:\n\n([\s\S]*?)(?=\n### |\n## |$)/g
  let m, beatIdx = 0
  while ((m = beatRe.exec(md)) !== null) {
    beatIdx++
    const speakers = m[1].split(",").map(s => s.trim()).filter(s => s && s !== "(none listed)")
    const prose = m[2]
    // Find attributed quotes in prose: "..." (with attribution tag like `Sylvie said`)
    const quotePattern = /"([^"]+)"\s*[\s,]\s*(?:\w+\s+){0,3}(Sylvie Dunmore|Sylvie|Corporal Jien|Jien|General Voss|Voss)\b|\b(Sylvie Dunmore|Sylvie|Corporal Jien|Jien|General Voss|Voss)\s+(?:\w+\s+){0,3}[,:]?\s*"([^"]+)"/g
    let qm
    while ((qm = quotePattern.exec(prose)) !== null) {
      const rawChar = qm[2] ?? qm[3]
      const line = qm[1] ?? qm[4]
      if (!rawChar || !line || line.length < 15) continue
      const fullChar = rawChar.startsWith("Sylvie") ? "Sylvie Dunmore"
                     : rawChar.includes("Jien") ? "Corporal Jien"
                     : rawChar.includes("Voss") ? "General Voss"
                     : rawChar
      lines.push({ char: fullChar, line: line.trim(), beat_id: `beat-${beatIdx}` })
    }
  }
  return lines
}

async function callLora(char: Char, flat: string): Promise<string> {
  const key = process.env.WANDB_API_KEY!
  const nameTag = char.name.split(" ")[0].toUpperCase()  // SYLVIE, JIEN, VOSS
  const system = "You are a voice stylist for character dialogue in action-pulp fantasy."
  const user = `CHARACTER: ${nameTag}
VOICE PROFILE:
  Voice: ${char.voice}
  Drives: ${char.drives}
  Avoids: ${char.avoids}
  Conflict: ${char.conflict}

FLAT DIALOGUE LINE:
"${flat}"

Rewrite in ${char.name.split(" ")[0]}'s voice. Output ONLY the voiced line, no quotes.`

  const r = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ model: LORA, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.7, max_tokens: 120 }),
  })
  if (!r.ok) return `ERR ${r.status}`
  const j = await r.json() as any
  return (j.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "")
}

async function callDeepSeekFewShot(char: Char, flat: string): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY!
  const system = "You are a voice stylist for character dialogue."
  const exampleBlock = char.examples.slice(0, 5).map((e, i) => `  ${i + 1}. "${e}"`).join("\n")
  const user = `CHARACTER: ${char.name}
VOICE PROFILE:
  Voice: ${char.voice}
  Drives: ${char.drives}
  Avoids: ${char.avoids}

EXAMPLE VOICED LINES:
${exampleBlock}

LINE TO REWRITE:
"${flat}"

Rewrite the line in ${char.name}'s voice, preserving the semantic content. Output ONLY the voiced line, no quotes, no commentary.`

  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ model: "deepseek-v4-flash", messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.7, max_tokens: 120 }),
  })
  if (!r.ok) return `ERR ${r.status}`
  const j = await r.json() as any
  return (j.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "")
}

async function main() {
  const md = readFileSync(FORK_MD, "utf8")
  const chars = parseCharacters(md)
  console.log("Parsed characters:", Object.keys(chars).join(", "))
  for (const [n, c] of Object.entries(chars)) console.log(`  ${n}: ${c.examples.length} example lines`)

  const allQuotes = extractDialogueFromV4(md)
  console.log(`\nExtracted ${allQuotes.length} attributed quotes from v4 prose`)
  const byChar: Record<string, typeof allQuotes> = {}
  for (const q of allQuotes) { (byChar[q.char] ??= []).push(q) }
  for (const [n, q] of Object.entries(byChar)) console.log(`  ${n}: ${q.length}`)

  const sample: typeof allQuotes = []
  for (const [charName, quotes] of Object.entries(byChar)) {
    if (!chars[charName]) { console.log(`  ! no profile for ${charName}, skipping`); continue }
    const step = Math.max(1, Math.floor(quotes.length / SAMPLE_PER_CHAR))
    for (let i = 0; i < SAMPLE_PER_CHAR && i * step < quotes.length; i++) sample.push(quotes[i * step])
  }
  console.log(`\nSampled ${sample.length} quotes for rewrite test`)

  const out: string[] = [`# Dialogue post-pass eyeball test`, ``, `Take v4's attributed dialogue and rewrite with two engines:`, `- **L**: archetype-poc-v1 LoRA (profile only)`, `- **D**: DeepSeek + profile + 5 few-shot example lines`, ``, `---`, ``]

  for (let i = 0; i < sample.length; i++) {
    const q = sample[i]
    const char = chars[q.char]
    process.stdout.write(`[${i + 1}/${sample.length}] ${q.char}... `)
    const [lora, ds] = await Promise.all([callLora(char, q.line), callDeepSeekFewShot(char, q.line)])
    process.stdout.write("done\n")
    out.push(`## ${q.char} — ${q.beat_id}`)
    out.push(``)
    out.push(`**v4 (original)**: "${q.line}"`)
    out.push(``)
    out.push(`**L (LoRA rewrite)**: "${lora}"`)
    out.push(``)
    out.push(`**D (DeepSeek+fewshot rewrite)**: "${ds}"`)
    out.push(``)
    out.push(`---`)
    out.push(``)
  }

  writeFileSync(OUT, out.join("\n"))
  console.log(`\nOutput → ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
