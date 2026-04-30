/**
 * Stage 5 SFT formatter for hallucination-checker-v2.
 *
 * Reads raw pairs + Sonnet combined.jsonl, flips labels on mismatches
 * (teacher verdict wins — see conversation 2026-04-18), and splits by the
 * scenario-level train/val assignment authored in scenarios-draft.ts.
 *
 * Output:
 *   finetune-data/halluc-checker-v2-train.jsonl        (scenarios with split=train)
 *   finetune-data/halluc-checker-v2-val-synth.jsonl    (scenarios with split=val)
 *
 * Also upserts rows to eval_briefs under set_name="hallucination-val-synth-v1"
 * so Stage 7 eval can replay the same prose against the trained adapter.
 *
 * Usage (local or LXC):
 *   EXPERIMENT_ID=<parent-data-gen-exp> bun scripts/hallucination/format-v2-sft.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import db from "../../src/db/connection"
import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"

const RAW_PATH = "finetune-data/halluc-checker-v2-pairs-raw.jsonl"
const SONNET_PATH = "/tmp/halluc-label/combined.jsonl"
const TRAIN_PATH = "finetune-data/halluc-checker-v2-train.jsonl"
const VAL_PATH = "finetune-data/halluc-checker-v2-val-synth.jsonl"
const VAL_SET_NAME = "hallucination-val-synth-v1"

interface SonnetResult {
  idx: number
  scenario: string
  variant: string
  subcase: string | null
  found: { pass: boolean; issues: Array<{ entity: string; excerpt: string }> }
  expected: { pass: boolean; issues: Array<{ entity: string; excerpt: string }> }
  match: boolean
  note: string | null
}

interface RawPair {
  messages: Array<{ role: string; content: string }>
  _meta: {
    scenario: string
    variant: string
    subcase: string | null
    pass: boolean
    picked: string | null
    genre: string
    split: "train" | "val"
    regen?: boolean
  }
  _idx?: number
}

async function main() {
  // 1. Load raw pairs (keyed by scenario+variant for lookup)
  const rawLines = readFileSync(RAW_PATH, "utf8").trim().split("\n").filter(Boolean)
  const rawPairs = rawLines.map(l => JSON.parse(l) as RawPair)
  console.log(`Loaded ${rawPairs.length} raw pairs`)

  // 2. Load Sonnet verdicts
  const sonnetLines = readFileSync(SONNET_PATH, "utf8").trim().split("\n").filter(Boolean)
  const sonnetByKey = new Map<string, SonnetResult>()
  for (const l of sonnetLines) {
    const r = JSON.parse(l) as SonnetResult
    sonnetByKey.set(`${r.scenario}:${r.variant}`, r)
  }
  console.log(`Loaded ${sonnetByKey.size} Sonnet verdicts`)

  // 3. Flip labels where mismatched; track stats
  let flipped = 0, kept = 0, missingSonnet = 0
  const finalPairs: Array<RawPair & { _sonnet_match: boolean }> = []
  for (const p of rawPairs) {
    const key = `${p._meta.scenario}:${p._meta.variant}`
    const s = sonnetByKey.get(key)
    if (!s) {
      missingSonnet++
      console.warn(`  missing Sonnet result for ${key} — keeping original label`)
      finalPairs.push({ ...p, _sonnet_match: true })
      continue
    }
    if (s.match) {
      kept++
      finalPairs.push({ ...p, _sonnet_match: true })
    } else {
      flipped++
      // Overwrite assistant message with Sonnet's verdict
      const newAssistant = JSON.stringify({ pass: s.found.pass, issues: s.found.issues })
      p.messages = p.messages.map(m => m.role === "assistant" ? { ...m, content: newAssistant } : m)
      p._meta.pass = s.found.pass
      finalPairs.push({ ...p, _sonnet_match: false })
    }
  }
  console.log(`Kept ${kept}, flipped ${flipped}, missing Sonnet ${missingSonnet}`)

  // 4. Split by scenario-level split
  const train = finalPairs.filter(p => p._meta.split === "train")
  const val = finalPairs.filter(p => p._meta.split === "val")
  console.log(`Split: ${train.length} train / ${val.length} val`)

  // Class balance
  const tallyClass = (arr: typeof finalPairs) => ({
    pass: arr.filter(p => p._meta.pass).length,
    fail: arr.filter(p => !p._meta.pass).length,
  })
  console.log(`  train class: ${JSON.stringify(tallyClass(train))}`)
  console.log(`  val class:   ${JSON.stringify(tallyClass(val))}`)

  // 5. Write SFT files
  mkdirSync("finetune-data", { recursive: true })
  const stripInternal = (p: any) => {
    const { _sonnet_match, ...rest } = p
    return rest
  }
  writeFileSync(TRAIN_PATH, train.map(p => JSON.stringify(stripInternal(p))).join("\n") + "\n")
  writeFileSync(VAL_PATH, val.map(p => JSON.stringify(stripInternal(p))).join("\n") + "\n")
  console.log(`Wrote ${TRAIN_PATH} (${train.length} rows)`)
  console.log(`Wrote ${VAL_PATH} (${val.length} rows)`)

  // 6. Seed eval_briefs for val-synth set
  let briefsInserted = 0
  for (const p of val) {
    const beatId = `${p._meta.scenario}_${p._meta.variant.toLowerCase()}`
    const brief = {
      user: p.messages.find(m => m.role === "user")!.content,
      expected: JSON.parse(p.messages.find(m => m.role === "assistant")!.content),
      meta: p._meta,
    }
    const res = await db`
      INSERT INTO eval_briefs (set_name, beat_id, brief_json, notes)
      VALUES (${VAL_SET_NAME}, ${beatId}, ${brief as any}, ${"synthetic balanced val from Cerebras + Sonnet flipping (stage 5, 2026-04-18)"})
      ON CONFLICT (set_name, beat_id) DO UPDATE SET brief_json = EXCLUDED.brief_json
      RETURNING id
    `
    if ((res as any[]).length > 0) briefsInserted++
  }
  console.log(`Upserted ${briefsInserted} eval_briefs under ${VAL_SET_NAME}`)

  // 7. Record experiment
  const parentExpId = process.env.EXPERIMENT_ID ? Number(process.env.EXPERIMENT_ID) : null
  const expId = await createTuningExperiment(
    "data-generation",
    `Hallucination v2 Stage 5 SFT formatter — label flipping + train/val split (${train.length}/${val.length})`,
    {
      source_raw_file: RAW_PATH,
      sonnet_labels_file: SONNET_PATH,
      train_pairs: train.length,
      val_pairs: val.length,
      flipped_labels: flipped,
      kept_labels: kept,
      missing_sonnet: missingSonnet,
      train_class_balance: tallyClass(train),
      val_class_balance: tallyClass(val),
      eval_brief_set: VAL_SET_NAME,
      parent_experiment_id: parentExpId,
    },
    { target: "hallucination-checker-v2", dimension: "data-format" },
  )
  const summary = `Formatted ${finalPairs.length} pairs (${flipped} flipped, ${kept} kept). Train: ${train.length} (${JSON.stringify(tallyClass(train))}). Val: ${val.length} (${JSON.stringify(tallyClass(val))}). eval_briefs: ${VAL_SET_NAME} × ${briefsInserted}.`
  await concludeExperiment(expId, summary)
  console.log(`\nExperiment ${expId} concluded:\n  ${summary}`)
  process.exit(0)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
