/**
 * Build the JSON fed into the React Voice Compare page.
 *
 * Merges Phase C.2 A/B results with their matching briefs + original
 * Salvatore ground-truth prose. Adds cheap deterministic adherence
 * flags (characters mentioned in output, word-count delta vs target).
 *
 * Input:  scripts/lora-data/phase-c2-capability-vs-tuning-results.jsonl
 *         scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl
 * Output: ui/public/phase-c2-view.json
 *
 * Run: bun scripts/finetune/build-phase-c2-view.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"

const RESULTS_PATH = resolve(import.meta.dir, "../../scripts/lora-data/phase-c2-capability-vs-tuning-results.jsonl")
const PAIRS_PATH = resolve(import.meta.dir, "../../scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl")
const OUT_PATH = resolve(import.meta.dir, "../../ui/public/phase-c2-view.json")

type Style = {
  avg_sentence_words: number
  dialogue_ratio: number
  clause_complexity: number
  sensory_density: number
  [k: string]: number
}
type Result = {
  beat_id: string
  kind: string
  cell: string
  target_words: number
  recon_words: number
  style: Style
  prose: string
  error?: string
}
type Brief = {
  beat_id: string
  book?: string
  characters?: string[]
  pov?: string
  setting?: string
  tone?: string
  kind?: string
  transition_in?: string
  boundary_signal?: string
  summary?: string
  words?: number
}
type Pair = { brief: Brief; prose: string; style?: Style }

function loadJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l) as T)
}

function countMatches(prose: string, chars: string[]): { name: string; mentioned: boolean }[] {
  const lower = prose.toLowerCase()
  return chars.map(name => {
    const first = name.split(/\s+/)[0].toLowerCase()
    const full = name.toLowerCase()
    return { name, mentioned: lower.includes(first) || lower.includes(full) }
  })
}

const SALVATORE_BASELINE = {
  avg_sentence_words: 18.3,
  dialogue_ratio: 0.28,
  clause_complexity: 0.62,
  sensory_density: 1.56,
}

function deltaSum(s: Style): number {
  return (
    Math.abs(s.avg_sentence_words - SALVATORE_BASELINE.avg_sentence_words) / 10 +
    Math.abs(s.dialogue_ratio - SALVATORE_BASELINE.dialogue_ratio) +
    Math.abs(s.clause_complexity - SALVATORE_BASELINE.clause_complexity) +
    Math.abs(s.sensory_density - SALVATORE_BASELINE.sensory_density) / 2
  )
}

function main() {
  const results = loadJsonl<Result>(RESULTS_PATH)
  const pairs = loadJsonl<Pair>(PAIRS_PATH)
  const byId = new Map<string, Pair>()
  for (const p of pairs) byId.set(p.brief.beat_id, p)

  // Group results by beat_id
  const byBeat = new Map<string, Result[]>()
  for (const r of results) {
    if (!byBeat.has(r.beat_id)) byBeat.set(r.beat_id, [])
    byBeat.get(r.beat_id)!.push(r)
  }

  const briefs = [...byBeat.keys()].map(id => {
    const rs = byBeat.get(id)!
    const pair = byId.get(id)
    if (!pair) throw new Error(`No brief for ${id}`)
    const brief = pair.brief
    const chars = brief.characters ?? []

    const cells = rs.map(r => {
      const adherence = {
        characters: countMatches(r.prose, chars),
        wordDelta: r.recon_words - r.target_words,
        wordPctOff: Math.round(((r.recon_words - r.target_words) / r.target_words) * 100),
      }
      return {
        cell: r.cell,
        prose: r.prose,
        recon_words: r.recon_words,
        target_words: r.target_words,
        style: r.style,
        delta_sum: deltaSum(r.style),
        adherence,
      }
    })

    // Sort cells in fixed A,B,C order
    const order = ["A-deepseek-bare", "B-deepseek-primer", "C-salvatore-lora"]
    cells.sort((x, y) => order.indexOf(x.cell) - order.indexOf(y.cell))

    return {
      beat_id: id,
      brief,
      ground_truth: {
        prose: pair.prose,
        style: pair.style,
        words: pair.prose.split(/\s+/).filter(Boolean).length,
      },
      cells,
    }
  })

  // Aggregate scores per cell across all briefs
  const cellLabels = ["A-deepseek-bare", "B-deepseek-primer", "C-salvatore-lora"] as const
  const aggregate = cellLabels.map(label => {
    const rows = results.filter(r => r.cell === label)
    const n = rows.length
    const avg = (k: keyof Style) =>
      rows.reduce((s, r) => s + (r.style[k] as number), 0) / n
    const style = {
      avg_sentence_words: avg("avg_sentence_words"),
      dialogue_ratio: avg("dialogue_ratio"),
      clause_complexity: avg("clause_complexity"),
      sensory_density: avg("sensory_density"),
    }
    return {
      cell: label,
      n,
      avg_words: rows.reduce((s, r) => s + r.recon_words, 0) / n,
      style,
      delta_sum: deltaSum(style as Style),
    }
  })

  const view = {
    generated_at: new Date().toISOString(),
    experiment_id: 193,
    baseline: SALVATORE_BASELINE,
    target_words: 120,
    cell_meta: {
      "A-deepseek-bare": {
        label: "A · DeepSeek bare",
        base: "DeepSeek V3.2",
        voice_mechanism: "bare system prompt",
        description: "Baseline — no exemplars, no tuning",
      },
      "B-deepseek-primer": {
        label: "B · DeepSeek + primer",
        base: "DeepSeek V3.2",
        voice_mechanism: "+10k-token Salvatore primer (31 passages)",
        description: "In-context learning — exemplars, no tuning",
      },
      "C-salvatore-lora": {
        label: "C · salvatore-1988-v1 LoRA",
        base: "OpenPipe/Qwen3-14B-Instruct",
        voice_mechanism: "fine-tuned LoRA (r=16, 703 pairs, 3 epochs)",
        description: "Tuning — no exemplars at inference time",
      },
    },
    aggregate,
    briefs,
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(view, null, 2))

  console.log(`Wrote ${OUT_PATH}`)
  console.log(`  Briefs: ${briefs.length}`)
  console.log(`  Cells per brief: ${briefs[0]?.cells.length ?? 0}`)
  for (const agg of aggregate) {
    console.log(`  ${agg.cell.padEnd(22)} n=${agg.n} Δ-sum=${agg.delta_sum.toFixed(2)}`)
  }
}

main()
