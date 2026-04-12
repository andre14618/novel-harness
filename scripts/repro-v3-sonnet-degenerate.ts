/**
 * Reproducibility test: hit V3-sonnet adapter N times with the same long prose
 * across 3 temperature/penalty settings. Count parse failures and em-dash
 * corruption per setting.
 *
 * Goal: determine whether the control-char failure is (a) deterministic
 * (tokenizer bug) or (b) stochastic (degenerate sampling). If it's stochastic,
 * test whether temperature/frequency_penalty mitigates it.
 */
import db from "../data/connection.ts"
import { getTransport } from "../src/transport.ts"

const ADAPTER = "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v3-sonnet-sft-resume:v9"
const N_RUNS = 5

const TANGENT_SYSTEM = `You measure whether the prose has DRIFTED OFF the scene beat into unrelated content.

A "tangent" is the prose abandoning the beat to pursue something the beat does not call for.

The following are NOT tangents:
- Atmospheric description
- Character interiority
- Sensory grounding
- Emotional reactions

Respond with ONLY valid JSON in this exact shape:
{
  "off_spec_fraction": 0.0,
  "off_spec_quote": "<quoted passage, or empty string>",
  "is_tangent": true | false,
  "reasoning": "<one sentence>"
}`

async function main() {
  const transport = getTransport()
  const row: any = (await db`
    SELECT cd.prose, co.outline_json
    FROM chapter_drafts cd
    JOIN chapter_outlines co ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
    WHERE cd.status = 'approved' AND LENGTH(cd.prose) > 5000
    ORDER BY RANDOM() LIMIT 1
  `)[0]
  const outline = typeof row.outline_json === "string" ? JSON.parse(row.outline_json) : row.outline_json
  const beat = (outline.scenes || [])[0]
  const prose = (row.prose as string).slice(0, 2000)
  const user = `BEAT: ${beat?.description || JSON.stringify(beat)}\n\nPROSE:\n---\n${prose}\n---`

  const settings = [
    { name: "temp=0.1 (baseline)", temperature: 0.1, extraBody: {} },
    { name: "temp=0.3",             temperature: 0.3, extraBody: {} },
    { name: "temp=0.1 + freq_penalty=0.3", temperature: 0.1, extraBody: { frequency_penalty: 0.3 } },
    { name: "temp=0.1 + pres_penalty=0.3", temperature: 0.1, extraBody: { presence_penalty: 0.3 } },
  ]

  for (const s of settings) {
    let parseOk = 0, ctrlCorrupt = 0, parseFail = 0
    const latencies: number[] = []
    for (let i = 0; i < N_RUNS; i++) {
      const t0 = Date.now()
      const res = await transport.execute({
        systemPrompt: TANGENT_SYSTEM,
        userPrompt: user,
        model: ADAPTER,
        provider: "wandb",
        temperature: s.temperature,
        maxTokens: 512,
        extraBody: s.extraBody,
      })
      latencies.push(Date.now() - t0)
      const raw = res.content
      const hasCtrl = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(raw)
      if (hasCtrl) ctrlCorrupt++
      try {
        JSON.parse(raw)
        parseOk++
      } catch {
        parseFail++
      }
    }
    const avgL = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    console.log(`${s.name.padEnd(40)}  ok:${parseOk}/${N_RUNS}  ctrl-corrupt:${ctrlCorrupt}/${N_RUNS}  parseFail:${parseFail}/${N_RUNS}  avg:${avgL}ms`)
  }
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
