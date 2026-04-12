/**
 * Focused analysis: WHY does v3-sonnet-teacher score 61% on the character call
 * when v2-curated hits 82%? Run oracle + v2 + v3-sonnet on ~20 character-call
 * pairs and dump full responses with reasoning so we can categorize:
 *   - FP: model says contradiction, oracle says no
 *   - FN: model says no contradiction, oracle says yes
 *   - What reasoning does v3-sonnet give when it's wrong?
 */
import db from "../data/connection.ts"
import { getTransport } from "../src/transport.ts"

const SYSTEM = `You verify whether characters in the prose behave consistently with their roles in a scene beat.

A character "acts contrary to their role" when they do something the beat says they should NOT do, or when they take an action that reverses the beat's intended dynamic (e.g., the beat calls for the character to refuse but the prose has them immediately agree, or the beat calls for confrontation but the prose has them stay silent).

Do NOT flag normal creative interpretation: dialogue rewording, gesture additions, emotional shading, or pacing variation. Only flag clear contradictions.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where contradiction occurs, or empty string>",
  "reasoning": "<one sentence>"
}`

const MODELS = {
  "oracle-235b": { provider: "cerebras" as const, model: "qwen-3-235b-a22b-instruct-2507", extraBody: {} },
  "v2-curated": { provider: "wandb" as const, model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v2-sft-resume:v9", extraBody: {} },
  "v3-sonnet": { provider: "wandb" as const, model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v3-sonnet-sft-resume:v9", extraBody: { frequency_penalty: 0.3 } },
}

async function main() {
  const chapters = await db`
    SELECT cd.novel_id, cd.chapter_number, cd.prose, co.outline_json
    FROM chapter_drafts cd
    JOIN chapter_outlines co ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
    WHERE cd.status = 'approved'
    ORDER BY RANDOM()
    LIMIT 10
  `

  const pairs: Array<{ beatDesc: string; chars: string; prose: string; label: string }> = []
  for (const ch of chapters as any[]) {
    const outline = typeof ch.outline_json === "string" ? JSON.parse(ch.outline_json) : ch.outline_json
    const scenes = outline?.scenes || []
    const paragraphs = (ch.prose as string).split("\n\n").filter((p: string) => p.trim())
    if (!scenes.length || !paragraphs.length) continue
    const parasPerBeat = Math.ceil(paragraphs.length / scenes.length)
    for (let i = 0; i < Math.min(scenes.length, 3); i++) {
      const start = i * parasPerBeat
      const end = Math.min(start + parasPerBeat, paragraphs.length)
      const beatProse = paragraphs.slice(start, end).join("\n\n")
      if (beatProse.length < 50) continue
      pairs.push({
        beatDesc: scenes[i]?.description || JSON.stringify(scenes[i]),
        chars: (scenes[i]?.characters || []).join(", "),
        prose: beatProse.slice(0, 2000),
        label: `ch${ch.chapter_number}/beat${i}`,
      })
    }
  }

  console.log(`Analyzing ${pairs.length} character-call pairs across 3 models...\n`)
  const transport = getTransport()

  let v2Agree = 0, v3Agree = 0, total = 0
  let v3FP = 0, v3FN = 0

  for (let pi = 0; pi < pairs.length; pi++) {
    const p = pairs[pi]
    const userPrompt = `BEAT: ${p.beatDesc}\nCHARACTERS EXPECTED: ${p.chars}\n\nPROSE:\n---\n${p.prose}\n---`

    const results: Record<string, any> = {}
    await Promise.all(
      Object.entries(MODELS).map(async ([name, cfg]) => {
        try {
          const res = await transport.execute({
            systemPrompt: SYSTEM,
            userPrompt,
            model: cfg.model,
            provider: cfg.provider,
            temperature: 0.1,
            maxTokens: 512,
            responseFormat: { type: "json_object" },
            extraBody: cfg.extraBody,
          })
          results[name] = JSON.parse(res.content)
        } catch {
          results[name] = { _error: true }
        }
      })
    )

    const oracle = results["oracle-235b"]
    const v2 = results["v2-curated"]
    const v3 = results["v3-sonnet"]

    if (oracle?._error || v2?._error || v3?._error) continue
    total++

    const oFlag = !!oracle.character_contradiction
    const v2Flag = !!v2.character_contradiction
    const v3Flag = !!v3.character_contradiction

    if (v2Flag === oFlag) v2Agree++
    if (v3Flag === oFlag) v3Agree++

    const v3Wrong = v3Flag !== oFlag
    if (v3Wrong) {
      if (v3Flag && !oFlag) v3FP++
      if (!v3Flag && oFlag) v3FN++
    }

    // Only print details when v3 disagrees with oracle
    if (v3Wrong) {
      const type = v3Flag ? "FP (v3 says contradiction, oracle says no)" : "FN (v3 says no contradiction, oracle says yes)"
      console.log(`════ ${p.label} — ${type} ════`)
      console.log(`beat: ${p.beatDesc.slice(0, 120)}`)
      console.log(`chars: ${p.chars}`)
      console.log(`oracle: contradiction=${oFlag}  reasoning: ${oracle.reasoning}`)
      console.log(`v2:     contradiction=${v2Flag}  reasoning: ${v2.reasoning}`)
      console.log(`v3:     contradiction=${v3Flag}  reasoning: ${v3.reasoning}`)
      if (v3.evidence) console.log(`v3 evidence: ${v3.evidence.slice(0, 200)}`)
      console.log()
    }
  }

  console.log(`\n═══ SUMMARY ═══`)
  console.log(`total pairs:    ${total}`)
  console.log(`v2 agreement:   ${v2Agree}/${total} (${Math.round(v2Agree/total*100)}%)`)
  console.log(`v3 agreement:   ${v3Agree}/${total} (${Math.round(v3Agree/total*100)}%)`)
  console.log(`v3 false positives (over-strict): ${v3FP}`)
  console.log(`v3 false negatives (too lenient):  ${v3FN}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
