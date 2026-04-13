/**
 * Run the adherence-checker-v3-sonnet adapter on a handful of inputs and
 * dump the COMPLETE raw output, with explicit byte-level inspection of any
 * control characters. Goal: figure out whether the control-char garbage is
 * (a) at end after valid JSON (stop-token failure),
 * (b) interleaved inside strings (training data contamination),
 * (c) at start/middle (format collapse),
 * and whether it's consistent across call types.
 */
import { getTransport } from "../src/transport.ts"
import db from "../data/connection.ts"

const ADAPTER = {
  provider: "wandb" as const,
  model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v3-sonnet-sft-resume:v9",
}
const BASE = {
  provider: "wandb" as const,
  model: "OpenPipe/Qwen3-14B-Instruct",
}

const CASES = [
  {
    label: "tangent — short",
    system: `You measure whether the prose has DRIFTED OFF the scene beat into unrelated content.

Respond with ONLY valid JSON in this exact shape:
{
  "off_spec_fraction": 0.0,
  "off_spec_quote": "<quoted passage, or empty string>",
  "is_tangent": true | false,
  "reasoning": "<one sentence>"
}`,
    user: `BEAT: Jem reads the warning note in the kitchen.

PROSE:
---
Jem unfolded the note with fingers that would not steady. The paper was cheap, the ink blotted where the writer had pressed too hard. He read it twice.
---`,
  },
  {
    label: "character — short",
    system: `You verify whether characters in the prose behave consistently with their roles in a scene beat.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where contradiction occurs, or empty string>",
  "reasoning": "<one sentence>"
}`,
    user: `BEAT: Jem reads a warning note. Nadia watches from the hearth.
CHARACTERS EXPECTED: Jem, Nadia

PROSE:
---
Jem read the note. Nadia stood at the hearth, arms crossed. "That's not real," she said.
---`,
  },
]

function describeBytes(s: string): string {
  const counts: Record<number, number> = {}
  for (const ch of s) {
    const o = ch.codePointAt(0)!
    if (o < 32 && ch !== "\n" && ch !== "\t" && ch !== "\r") {
      counts[o] = (counts[o] || 0) + 1
    }
  }
  const entries = Object.entries(counts).map(([k, v]) => `\\u${Number(k).toString(16).padStart(4, "0")}=${v}`)
  return entries.length ? entries.join(", ") : "(none)"
}

// Pull a real production prose sample and add it to the cases
async function addProductionCases() {
  const rows: any[] = await db`
    SELECT cd.prose, co.outline_json
    FROM chapter_drafts cd
    JOIN chapter_outlines co ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
    WHERE cd.status = 'approved' AND LENGTH(cd.prose) > 5000
    ORDER BY RANDOM() LIMIT 2
  `
  for (const r of rows) {
    const outline = typeof r.outline_json === "string" ? JSON.parse(r.outline_json) : r.outline_json
    const scenes = outline?.scenes || []
    if (!scenes.length) continue
    const prose = (r.prose as string).slice(0, 2000)
    const beat = scenes[0]
    const chars = (beat?.characters || []).join(", ")
    const setting = outline?.setting || ""

    CASES.push({
      label: `production tangent — ${prose.length} chars`,
      system: `You measure whether the prose has DRIFTED OFF the scene beat into unrelated content.

A "tangent" is the prose abandoning the beat to pursue something the beat does not call for: an unrelated subplot, scene drift to another character's storyline, lengthy unrelated backstory dump, or the prose pivoting away from the beat entirely.

The following are NOT tangents — they are normal prose craft and must NOT be flagged:
- Atmospheric description (weather, sensory details, environmental texture)
- Character interiority (POV character's thoughts, feelings, memories triggered by what's happening)
- Sensory grounding (what the character sees, hears, smells, touches)
- Emotional reactions to the beat's action

Respond with ONLY valid JSON in this exact shape:
{
  "off_spec_fraction": 0.0,
  "off_spec_quote": "<quoted passage, or empty string>",
  "is_tangent": true | false,
  "reasoning": "<one sentence>"
}`,
      user: `BEAT: ${beat?.description || JSON.stringify(beat)}\n\nPROSE:\n---\n${prose}\n---`,
    })
    CASES.push({
      label: `production character — ${prose.length} chars`,
      system: `You verify whether characters in the prose behave consistently with their roles in a scene beat.

Do NOT flag normal creative interpretation: dialogue rewording, gesture additions, emotional shading, or pacing variation. Only flag clear contradictions.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where contradiction occurs, or empty string>",
  "reasoning": "<one sentence>"
}`,
      user: `BEAT: ${beat?.description || JSON.stringify(beat)}\nCHARACTERS EXPECTED: ${chars}\n\nPROSE:\n---\n${prose}\n---`,
    })
  }
}

async function run() {
  await addProductionCases()
  const transport = getTransport()
  for (const c of CASES) {
    for (const [label, cfg] of [["ADAPTER", ADAPTER], ["BASE", BASE]] as const) {
      console.log(`\n════════════════════════════════════════════`)
      console.log(`${c.label}  [${label}]`)
      console.log(`════════════════════════════════════════════`)
      const t0 = Date.now()
      const res = await transport.execute({
        systemPrompt: c.system,
        userPrompt: c.user,
        model: cfg.model,
        provider: cfg.provider,
        temperature: 0.1,
        maxTokens: 512,
      })
      const ms = Date.now() - t0
      const raw = res.content
      console.log(`latency: ${ms}ms  usage: ${res.usage.prompt_tokens} in / ${res.usage.completion_tokens} out`)
      console.log(`length: ${raw.length} chars`)
      console.log(`control chars: ${describeBytes(raw)}`)
      console.log(`--- RAW (with ␀ markers for ctrl) ---`)
      // Replace control chars with visible markers for printing
      const visible = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (m) => `\u27e6${m.charCodeAt(0).toString(16)}\u27e7`)
      console.log(visible.slice(0, 2000))
      if (raw.length > 2000) console.log(`...(${raw.length - 2000} more chars)...`)
    }
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
