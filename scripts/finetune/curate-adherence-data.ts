#!/usr/bin/env bun
/**
 * Curate adherence-checker SFT training data.
 *
 * Reads the raw JSONL (with _meta), applies principled filters to remove
 * cross-contaminated and noisy examples, writes a clean training JSONL.
 *
 * Cross-contamination: FAIL variants designed to test ONE dimension often
 * trip other dimensions too (e.g., FAIL_MISSING → character contradiction
 * is the oracle conflating "action missing" with "character behaves wrong").
 * These are noisy signal for the non-target dimension and should be removed.
 *
 * Principle: for each FAIL variant, the INTENDED dimension's label is always
 * kept. Non-target dimensions are kept ONLY when their label is the "clean"
 * value (pass/true/false). When the oracle flags a non-target dimension on
 * a FAIL variant, that's cross-contamination → remove the example.
 *
 * PASS variants: always kept — organic drift from weaker writers is genuine
 * training signal.
 *
 * Usage:
 *   bun scripts/curate-adherence-data.ts [--dry-run]
 */

import { readFileSync, writeFileSync } from "fs"

const INPUT = process.env.CURATE_INPUT || "scripts/lora-data/adherence-checker-v3-mixed-teacher.jsonl"
const OUTPUT = process.env.CURATE_OUTPUT || "scripts/lora-data/adherence-checker-v3-curated.jsonl"

const dryRun = process.argv.includes("--dry-run")

// ── Types ──────────────────────────────────────────────────────────────

interface Example {
  messages: Array<{ role: string; content: string }>
  _meta: {
    scenario: string
    variant: string
    call_type: "events" | "setting" | "tangent" | "character"
    writer: string
  }
}

type Reason = "cross-contamination" | "ambiguous-tangent"

// ── Cross-contamination rules ──────────────────────────────────────────
//
// For each FAIL variant, define which (call_type, flag_value) combos are
// cross-contamination. "flag_value" is the oracle's flagged output.
//
// Logic: if the variant is FAIL_MISSING and the call_type is "character"
// and the oracle says character_contradiction=true, that's cross-contamination
// because the "contradiction" is really just the missing action — the events
// dimension's job, not the character dimension's.

interface CrossContamRule {
  variants: string[]
  callType: string
  isFlagged: (parsed: any) => boolean
}

const CROSS_CONTAM_RULES: CrossContamRule[] = [
  // FAIL_MISSING: character flags are cross-contamination from missing events
  {
    variants: ["FAIL_MISSING", "FAIL_MISSING_SUBTLE"],
    callType: "character",
    isFlagged: (p) => p.character_contradiction === true,
  },
  // FAIL_MISSING: tangent flags are cross-contamination (prose stays on-topic, just missing the action)
  {
    variants: ["FAIL_MISSING", "FAIL_MISSING_SUBTLE"],
    callType: "tangent",
    isFlagged: (p) => p.is_tangent === true,
  },
  // FAIL_TANGENT: events flags are cross-contamination (events are "missing" because prose tangented)
  {
    variants: ["FAIL_TANGENT", "FAIL_TANGENT_HARD"],
    callType: "events",
    isFlagged: (p) => p.events_present === false,
  },
  // FAIL_TANGENT: character flags are cross-contamination (character "contradiction" is really the tangent)
  {
    variants: ["FAIL_TANGENT", "FAIL_TANGENT_HARD"],
    callType: "character",
    isFlagged: (p) => p.character_contradiction === true,
  },
  // FAIL_CHAR: events flags are cross-contamination (character acting differently → beat "didn't happen")
  {
    variants: ["FAIL_CHAR"],
    callType: "events",
    isFlagged: (p) => p.events_present === false,
  },
]

// ── Ambiguous tangent filter ───────────────────────────────────────────
// Tangent examples where off_spec_fraction is in the ambiguous zone (0.3-0.7)
// teach the model a fuzzy threshold. Keep only clear cases.

const TANGENT_AMBIGUOUS_LOW = 0.3
const TANGENT_AMBIGUOUS_HIGH = 0.7

// ── Main ───────────────────────────────────────────────────────────────

const lines = readFileSync(INPUT, "utf8").trim().split("\n")
const kept: string[] = []
const removed: Array<{ example: Example; reason: Reason }> = []

const stats = {
  total: 0,
  kept: 0,
  crossContam: 0,
  ambiguousTangent: 0,
  byVariant: {} as Record<string, { total: number; kept: number; removed: number }>,
  byCallType: {} as Record<string, { total: number; kept: number; removed: number }>,
  byRule: {} as Record<string, number>,
}

for (const line of lines) {
  const obj = JSON.parse(line) as Example
  stats.total++

  const v = obj._meta.variant
  const ct = obj._meta.call_type

  // Init stat buckets
  if (!stats.byVariant[v]) stats.byVariant[v] = { total: 0, kept: 0, removed: 0 }
  if (!stats.byCallType[ct]) stats.byCallType[ct] = { total: 0, kept: 0, removed: 0 }
  stats.byVariant[v].total++
  stats.byCallType[ct].total++

  // Parse oracle output
  const asstContent = obj.messages.find((m) => m.role === "assistant")!.content
  let parsed: any
  try {
    parsed = JSON.parse(asstContent)
  } catch {
    // Malformed oracle output — remove
    removed.push({ example: obj, reason: "cross-contamination" })
    stats.byVariant[v].removed++
    stats.byCallType[ct].removed++
    stats.crossContam++
    continue
  }

  // Check cross-contamination rules
  let isCrossContam = false
  for (const rule of CROSS_CONTAM_RULES) {
    if (rule.variants.includes(v) && rule.callType === ct && rule.isFlagged(parsed)) {
      isCrossContam = true
      const ruleKey = `${v}/${ct}`
      stats.byRule[ruleKey] = (stats.byRule[ruleKey] || 0) + 1
      break
    }
  }

  if (isCrossContam) {
    removed.push({ example: obj, reason: "cross-contamination" })
    stats.byVariant[v].removed++
    stats.byCallType[ct].removed++
    stats.crossContam++
    continue
  }

  // Check ambiguous tangent threshold
  if (ct === "tangent" && parsed.off_spec_fraction !== undefined) {
    const frac = parsed.off_spec_fraction
    if (frac >= TANGENT_AMBIGUOUS_LOW && frac <= TANGENT_AMBIGUOUS_HIGH) {
      removed.push({ example: obj, reason: "ambiguous-tangent" })
      stats.byVariant[v].removed++
      stats.byCallType[ct].removed++
      stats.ambiguousTangent++
      continue
    }
  }

  // Keep
  stats.kept++
  stats.byVariant[v].kept++
  stats.byCallType[ct].kept++

  // Strip _meta for training output
  const clean = { messages: obj.messages }
  kept.push(JSON.stringify(clean))
}

// ── Report ─────────────────────────────────────────────────────────────

console.log("═".repeat(70))
console.log("ADHERENCE DATA CURATION REPORT")
console.log("═".repeat(70))
console.log()
console.log(`  Total examples:        ${stats.total}`)
console.log(`  Kept:                  ${stats.kept} (${Math.round((stats.kept / stats.total) * 100)}%)`)
console.log(`  Removed:               ${stats.total - stats.kept}`)
console.log(`    Cross-contamination: ${stats.crossContam}`)
console.log(`    Ambiguous tangent:   ${stats.ambiguousTangent}`)
console.log()

console.log("By variant:")
const variants = Object.keys(stats.byVariant).sort()
console.log("  " + "variant".padEnd(22) + "total".padStart(8) + "kept".padStart(8) + "removed".padStart(8) + "kept%".padStart(8))
for (const v of variants) {
  const s = stats.byVariant[v]
  console.log("  " + v.padEnd(22) + String(s.total).padStart(8) + String(s.kept).padStart(8) + String(s.removed).padStart(8) + (Math.round((s.kept / s.total) * 100) + "%").padStart(8))
}
console.log()

console.log("By call type:")
const callTypes = Object.keys(stats.byCallType).sort()
console.log("  " + "call_type".padEnd(14) + "total".padStart(8) + "kept".padStart(8) + "removed".padStart(8) + "kept%".padStart(8))
for (const ct of callTypes) {
  const s = stats.byCallType[ct]
  console.log("  " + ct.padEnd(14) + String(s.total).padStart(8) + String(s.kept).padStart(8) + String(s.removed).padStart(8) + (Math.round((s.kept / s.total) * 100) + "%").padStart(8))
}
console.log()

console.log("Cross-contamination removals by rule:")
for (const [rule, count] of Object.entries(stats.byRule).sort()) {
  console.log(`  ${rule}: ${count}`)
}
console.log()

// ── Per-call-type label balance ──────────────────────────────────────

console.log("Label balance in curated data (flagged vs clean per call type):")
const balanceStats: Record<string, { flagged: number; clean: number }> = {}
for (const jsonStr of kept) {
  const obj = JSON.parse(jsonStr)
  // We stripped _meta, so we need to infer call_type from system prompt
  const sys = obj.messages[0].content as string
  let ct: string
  if (sys.includes("ENACTS")) ct = "events"
  else if (sys.includes("CONTRADICTS the expected setting")) ct = "setting"
  else if (sys.includes("DRIFTED OFF")) ct = "tangent"
  else ct = "character"

  if (!balanceStats[ct]) balanceStats[ct] = { flagged: 0, clean: 0 }
  const asst = JSON.parse(obj.messages[2].content)
  const flagged =
    (ct === "events" && !asst.events_present) ||
    (ct === "setting" && !asst.setting_matches) ||
    (ct === "tangent" && asst.is_tangent) ||
    (ct === "character" && asst.character_contradiction)
  if (flagged) balanceStats[ct].flagged++
  else balanceStats[ct].clean++
}

console.log("  " + "call_type".padEnd(14) + "flagged".padStart(10) + "clean".padStart(10) + "ratio".padStart(10))
for (const [ct, b] of Object.entries(balanceStats).sort()) {
  const total = b.flagged + b.clean
  console.log("  " + ct.padEnd(14) + String(b.flagged).padStart(10) + String(b.clean).padStart(10) + (Math.round((b.flagged / total) * 100) + "% flag").padStart(10))
}
console.log()

if (dryRun) {
  console.log("DRY RUN — no file written.")
} else {
  writeFileSync(OUTPUT, kept.join("\n") + "\n")
  const sizeMB = (Buffer.byteLength(kept.join("\n") + "\n") / 1024 / 1024).toFixed(1)
  console.log(`Wrote ${kept.length} curated examples to ${OUTPUT} (${sizeMB} MB)`)
}
