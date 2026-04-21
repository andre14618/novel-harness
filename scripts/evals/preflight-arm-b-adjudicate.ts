#!/usr/bin/env bun
/**
 * Arm B preflight adjudication helper per `docs/charters/arm-b-detector-preflight.md`
 * §7. Two modes:
 *
 * ── emit ────────────────────────────────────────────────────────────────
 *
 * Reads the run's `eval_results` rows (by `set_name`), constructs
 * hypothesis-masked adjudication packets, and writes three artifacts:
 *
 *   1. packets.md        — human-readable bundle; one packet per fire +
 *                          3 non-fire audits per arm + 4 silent retests
 *                          of randomly sampled fires. Packets are
 *                          randomized in order; arm identity is NOT
 *                          revealed in the packet (only implicitly via
 *                          presence of the ENRICHED CONTEXT block).
 *   2. labels-template.tsv — one row per packet_id with empty label
 *                           column + reason column for the adjudicator
 *                           to fill in. Label vocabulary: TP / FP /
 *                           UNCLEAR (with required reason on UNCLEAR).
 *   3. mapping.json      — secret: packet_id → {eval_result_id, arm,
 *                          is_fire, retest_of}. Consumed only by
 *                          --ingest; never shown to the adjudicator.
 *
 * ── ingest ──────────────────────────────────────────────────────────────
 *
 * Reads the filled-in labels.tsv, joins against mapping.json, detects
 * retest flips (same underlying row labeled twice with different
 * labels), updates `eval_results.expected_label_json` for each fire,
 * computes precision per arm with UNCLEAR excluded, and prints the
 * GO / CAUTION / NO-GO / INCONCLUSIVE verdict per §7.
 *
 * Usage:
 *   bun scripts/evals/preflight-arm-b-adjudicate.ts --emit \
 *     --set-name arm-b-preflight-v1 \
 *     --out output/evals/arm-b-preflight-packets/v1
 *
 *   # (edit output/evals/arm-b-preflight-packets/v1/labels.tsv)
 *
 *   bun scripts/evals/preflight-arm-b-adjudicate.ts --ingest \
 *     --bundle output/evals/arm-b-preflight-packets/v1
 */

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import db from "../../src/db/connection"

// ── Types ──────────────────────────────────────────────────────────────

type Arm = "A-baseline" | "B-enriched"

interface EvalResultRow {
  id: number
  beat_id: string
  cell_label: Arm
  generated_prose: string | null
  /**
   * JSONB column; Bun's postgres driver returns it as a STRING that needs
   * JSON.parse, not as an already-parsed object. Normalize via
   * `parseLabelJson` before inspecting the `pass` field.
   */
  actual_label_json: string | { pass: boolean; issues: string[] } | null
  error_text: string | null
}

function parseLabelJson(
  raw: EvalResultRow["actual_label_json"],
): { pass: boolean; issues: string[] } | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return raw
}

interface PacketMapping {
  packet_id: string
  eval_result_id: number
  arm: Arm
  is_fire: boolean     // true: detector fired; false: sampled non-fire for FN audit
  retest_of: string | null  // packet_id of the original if this is a silent retest
}

interface LabelRow {
  packet_id: string
  label: "TP" | "FP" | "UNCLEAR" | ""
  reason: string
}

export interface ArmCounts {
  tp: number
  fp: number
  unclear: number
  non_fire_fn: number
  non_fire_tn: number
}

export interface VerdictResult {
  verdict: "GO" | "CAUTION" | "NO-GO" | "INCONCLUSIVE"
  reason: string
  action: string
  precision_a: number | null  // null if adjudicableA === 0
  precision_b: number | null
  adjudicable_a: number
  adjudicable_b: number
  unclear_rate_a: number
  unclear_rate_b: number
  delta_pt: number | null  // null if either precision is null
}

/**
 * Pure verdict computation from per-arm counts per charter §7 outcome
 * table (top-down mutually exclusive). Exported for unit testing.
 */
export function computeVerdict(a: ArmCounts, b: ArmCounts): VerdictResult {
  const precA = a.tp + a.fp > 0 ? a.tp / (a.tp + a.fp) : null
  const precB = b.tp + b.fp > 0 ? b.tp / (b.tp + b.fp) : null
  const adjudicableA = a.tp + a.fp
  const adjudicableB = b.tp + b.fp
  const totalFiresA = adjudicableA + a.unclear
  const totalFiresB = adjudicableB + b.unclear
  const unclearRateA = totalFiresA > 0 ? a.unclear / totalFiresA : 0
  const unclearRateB = totalFiresB > 0 ? b.unclear / totalFiresB : 0
  const delta = precA !== null && precB !== null ? (precB - precA) * 100 : null

  const shared = {
    precision_a: precA,
    precision_b: precB,
    adjudicable_a: adjudicableA,
    adjudicable_b: adjudicableB,
    unclear_rate_a: unclearRateA,
    unclear_rate_b: unclearRateB,
    delta_pt: delta,
  }

  if (adjudicableA < 8 || adjudicableB < 8) {
    return {
      ...shared,
      verdict: "INCONCLUSIVE",
      reason: `adjudicable fires below 8-per-arm floor (A=${adjudicableA}, B=${adjudicableB})`,
      action: "Re-charter with higher-fire-prior stratum or different detector.",
    }
  }
  if (unclearRateA > 0.25 || unclearRateB > 0.25) {
    return {
      ...shared,
      verdict: "INCONCLUSIVE",
      reason: `UNCLEAR rate >25% on one arm (A=${(unclearRateA * 100).toFixed(1)}%, B=${(unclearRateB * 100).toFixed(1)}%)`,
      action: "Adjudication policy — not detector — drives the signal. Re-adjudicate UNCLEAR set with second-pass protocol.",
    }
  }
  if (delta! < -25) {
    return {
      ...shared,
      verdict: "NO-GO",
      reason: `precision_B drops >25pt vs precision_A (Δ=${delta!.toFixed(1)}pt)`,
      action: "Detector-as-primary-oracle not viable on Arm B. Redesign replay-ladder-v1 Arm B oracle to human-adjudication primary.",
    }
  }
  if (delta! < -12.5) {
    return {
      ...shared,
      verdict: "CAUTION",
      reason: `precision drop in 12.5–25pt band (Δ=${delta!.toFixed(1)}pt)`,
      action: "Proceed to replay-ladder-v1 but downgrade Arm B detector evidence to secondary; add 10-beat human sidecar on Arm B for prose quality.",
    }
  }
  return {
    ...shared,
    verdict: "GO",
    reason: `precision_B within 12.5pt of precision_A (Δ=${delta!.toFixed(1)}pt)`,
    action: "Proceed to revise replay-ladder-v1 with detector as primary oracle on Arm B (retain other blockers' fixes from the ladder's §10).",
  }
}

/** Pure labels.tsv parser. Exported for unit testing. */
export function parseLabelsTsv(text: string): LabelRow[] {
  const out: LabelRow[] = []
  const lines = text.split("\n").filter(l => l.trim().length > 0)
  for (let i = 1; i < lines.length; i++) {  // skip header
    const [packet_id, label, reason] = lines[i].split("\t")
    if (!packet_id) continue
    const normalized = (label ?? "").trim().toUpperCase()
    if (normalized !== "TP" && normalized !== "FP" && normalized !== "UNCLEAR" && normalized !== "") continue
    out.push({
      packet_id: packet_id.trim(),
      label: normalized as LabelRow["label"],
      reason: (reason ?? "").trim(),
    })
  }
  return out
}

// ── Emit mode ──────────────────────────────────────────────────────────

function randomPacketId(): string {
  return createHash("sha256").update(crypto.randomUUID()).digest("hex").slice(0, 12)
}

function shuffle<T>(arr: T[], seed?: string): T[] {
  // Deterministic shuffle when seeded so re-runs are reproducible.
  const copy = arr.slice()
  const rng = seed
    ? mulberry32(hashToInt(seed))
    : Math.random
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashToInt(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h >>> 0
}

function renderPacket(
  packetId: string,
  row: EvalResultRow,
  isFire: boolean,
): string {
  const parsed = parseLabelJson(row.actual_label_json)
  const issues = parsed?.issues ?? []
  const kind = isFire ? "FIRE" : "NON-FIRE (FN audit sample)"
  const lines: string[] = []
  lines.push(`### Packet ${packetId}`)
  lines.push("")
  lines.push(`**Kind:** ${kind}`)
  if (isFire && issues.length > 0) {
    lines.push("")
    lines.push(`**Detector reported:**`)
    for (const iss of issues) lines.push(`  - ${iss}`)
  }
  lines.push("")
  lines.push("**Generated prose:**")
  lines.push("")
  lines.push(row.generated_prose ?? "(no prose — writer errored)")
  lines.push("")
  lines.push("---")
  return lines.join("\n")
}

async function runEmit(
  setName: string,
  outDir: string,
): Promise<void> {
  console.log(`[emit] set_name=${setName}`)
  const rows = await db<EvalResultRow[]>`
    SELECT id, beat_id, cell_label, generated_prose, actual_label_json, error_text
    FROM eval_results
    WHERE set_name = ${setName}
    ORDER BY id ASC
  `
  if (rows.length === 0) {
    console.error(`No eval_results for set_name=${setName}`)
    process.exit(2)
  }
  console.log(`[emit] loaded ${rows.length} eval_results rows`)

  // Partition. JSONB comes back as a STRING from the pg driver (even though
  // the column type is jsonb), so we parse up front.
  const parsedRows = rows.map(r => ({ ...r, parsed: parseLabelJson(r.actual_label_json) }))
  const fires = parsedRows.filter(
    r => r.parsed !== null && !r.parsed.pass && !r.error_text,
  )
  const nonFires = parsedRows.filter(
    r => r.parsed !== null && r.parsed.pass && !r.error_text,
  )
  const firesA = fires.filter(r => r.cell_label === "A-baseline")
  const firesB = fires.filter(r => r.cell_label === "B-enriched")
  const nonFiresA = nonFires.filter(r => r.cell_label === "A-baseline")
  const nonFiresB = nonFires.filter(r => r.cell_label === "B-enriched")
  console.log(`[emit] fires: A=${firesA.length} B=${firesB.length}`)
  console.log(`[emit] non-fires: A=${nonFiresA.length} B=${nonFiresB.length}`)

  // Build packets
  const mapping: PacketMapping[] = []

  // All fires → one packet each
  for (const row of fires) {
    mapping.push({
      packet_id: randomPacketId(),
      eval_result_id: row.id,
      arm: row.cell_label,
      is_fire: true,
      retest_of: null,
    })
  }

  // Sample 3 non-fires per arm for FN audit
  const fnSampleSeed = `${setName}:fn-audit`
  const nonFireSampleA = shuffle(nonFiresA, fnSampleSeed).slice(0, 3)
  const nonFireSampleB = shuffle(nonFiresB, fnSampleSeed + ":b").slice(0, 3)
  for (const row of [...nonFireSampleA, ...nonFireSampleB]) {
    mapping.push({
      packet_id: randomPacketId(),
      eval_result_id: row.id,
      arm: row.cell_label,
      is_fire: false,
      retest_of: null,
    })
  }

  // 4 silent retests — randomly sampled from fires only (policy consistency
  // check targets the fire adjudications, which drive the precision metric).
  const retestSeed = `${setName}:retest`
  const retestSources = shuffle(
    mapping.filter(p => p.is_fire),
    retestSeed,
  ).slice(0, 4)
  for (const source of retestSources) {
    mapping.push({
      packet_id: randomPacketId(),
      eval_result_id: source.eval_result_id,
      arm: source.arm,
      is_fire: source.is_fire,
      retest_of: source.packet_id,
    })
  }

  // Final packet order: shuffled deterministically so the adjudicator
  // can't infer retests by position.
  const ordered = shuffle(mapping, `${setName}:order`)

  // Render packets.md
  const rowById = new Map(rows.map(r => [r.id, r]))
  const packetTexts = ordered.map(p =>
    renderPacket(p.packet_id, rowById.get(p.eval_result_id)!, p.is_fire),
  )

  const mdLines: string[] = []
  mdLines.push(`# Arm B Detector Preflight — Adjudication Packets`)
  mdLines.push("")
  mdLines.push(`**Set:** ${setName}`)
  mdLines.push(`**Packets:** ${ordered.length} (${fires.length} fires + ${nonFireSampleA.length + nonFireSampleB.length} non-fire audit + ${retestSources.length} silent retests)`)
  mdLines.push("")
  mdLines.push(`## Adjudication rubric (per docs/charters/arm-b-detector-preflight.md §7)`)
  mdLines.push("")
  mdLines.push("For each FIRE packet, assign one label:")
  mdLines.push("- **TP** — the fired entity is genuinely ungrounded given the full context. Detector was correct.")
  mdLines.push("- **FP** — the entity is grounded by something visible in the context. Detector was wrong.")
  mdLines.push("- **UNCLEAR** — the grounding is ambiguous; write a one-sentence reason. Required.")
  mdLines.push("")
  mdLines.push("For each NON-FIRE packet, assign one label:")
  mdLines.push("- **TP** — the detector correctly passed; no ungrounded entity present. (\"TP\" reused as \"true-negative-equivalent\" to keep the label vocabulary small.)")
  mdLines.push("- **FP** — the detector missed an ungrounded entity (false negative). Mark FP and note the entity in the reason column.")
  mdLines.push("- **UNCLEAR** — ambiguous; write a reason.")
  mdLines.push("")
  mdLines.push("The generated prose is ALL the evidence you have for grounding decisions — there is no separate context pane in this bundle. If a proper noun appears in the prose but you cannot tell from the prose alone whether it is grounded, mark UNCLEAR with \"no visible grounding context\".")
  mdLines.push("")
  mdLines.push("Fill in labels.tsv. Do NOT edit mapping.json or this file.")
  mdLines.push("")
  mdLines.push("---")
  mdLines.push("")
  mdLines.push(packetTexts.join("\n\n"))

  // Render labels-template.tsv
  const tsvLines = ["packet_id\tlabel\treason"]
  for (const p of ordered) tsvLines.push(`${p.packet_id}\t\t`)

  // Write all three files
  await mkdir(path.resolve(outDir), { recursive: true })
  await writeFile(path.resolve(outDir, "packets.md"), mdLines.join("\n") + "\n")
  await writeFile(path.resolve(outDir, "labels.tsv"), tsvLines.join("\n") + "\n")
  await writeFile(
    path.resolve(outDir, "mapping.json"),
    JSON.stringify({ set_name: setName, packets: mapping, ordered_packet_ids: ordered.map(p => p.packet_id) }, null, 2),
  )
  console.log(`[emit] wrote ${ordered.length} packets to ${outDir}`)
  console.log(`  packets.md — review in your editor`)
  console.log(`  labels.tsv — fill in label + reason column, then run --ingest`)
  console.log(`  mapping.json — do not edit`)
}

// ── Ingest mode ────────────────────────────────────────────────────────

async function runIngest(bundleDir: string): Promise<void> {
  const labelsRaw = await readFile(path.resolve(bundleDir, "labels.tsv"), "utf8")
  const mappingRaw = await readFile(path.resolve(bundleDir, "mapping.json"), "utf8")
  const mappingFile = JSON.parse(mappingRaw) as {
    set_name: string
    packets: PacketMapping[]
    ordered_packet_ids: string[]
  }
  const labels = parseLabelsTsv(labelsRaw)
  const labelByPacket = new Map(labels.map(l => [l.packet_id, l]))
  const mappingByPacket = new Map(mappingFile.packets.map(p => [p.packet_id, p]))

  console.log(`[ingest] set_name=${mappingFile.set_name}`)
  console.log(`[ingest] labels filled: ${labels.filter(l => l.label !== "").length}/${mappingFile.packets.length}`)

  // Verify label coverage
  const unfilled = mappingFile.packets.filter(p => {
    const l = labelByPacket.get(p.packet_id)
    return !l || l.label === ""
  })
  if (unfilled.length > 0) {
    console.error(`[ingest] ERROR: ${unfilled.length} packet(s) have no label:`)
    for (const p of unfilled.slice(0, 10)) console.error(`  ${p.packet_id}`)
    process.exit(2)
  }

  // Retest consistency check (§3 / §7 — kill if ≥2 flips on the 4 retests)
  let retestCount = 0
  let retestFlips = 0
  const retestDiffs: Array<{ original: string; retest: string; original_label: string; retest_label: string }> = []
  for (const p of mappingFile.packets) {
    if (!p.retest_of) continue
    retestCount++
    const origLabel = labelByPacket.get(p.retest_of)!.label
    const retestLabel = labelByPacket.get(p.packet_id)!.label
    if (origLabel !== retestLabel) {
      retestFlips++
      retestDiffs.push({
        original: p.retest_of,
        retest: p.packet_id,
        original_label: origLabel,
        retest_label: retestLabel,
      })
    }
  }
  console.log(`[ingest] retests: ${retestCount} total, ${retestFlips} flips`)
  if (retestFlips > 0) {
    for (const d of retestDiffs) {
      console.log(`  flip: ${d.original}(${d.original_label}) vs ${d.retest}(${d.retest_label})`)
    }
  }
  if (retestFlips >= 2) {
    console.log(`[ingest] VERDICT: INCONCLUSIVE (≥2/${retestCount} retest flips — §3 adjudicator reliability kill)`)
    process.exit(1)
  }
  if (retestFlips === 1) {
    console.log(`[ingest] WARNING: 1 retest flip — continuing but flag in writeup`)
  }

  // Persist expected_label_json on fire rows (skip retest duplicates)
  let updates = 0
  for (const p of mappingFile.packets) {
    if (p.retest_of) continue  // retests don't get DB writes (same underlying row)
    if (!p.is_fire) continue   // non-fire audit is descriptive only per §3
    const label = labelByPacket.get(p.packet_id)!
    const payload = {
      adjudicated: label.label,
      reason: label.reason || null,
      adjudicated_at: new Date().toISOString(),
    }
    await db`
      UPDATE eval_results
      SET expected_label_json = ${JSON.stringify(payload)}
      WHERE id = ${p.eval_result_id}
    `
    updates++
  }
  console.log(`[ingest] persisted ${updates} expected_label_json updates`)

  // Count adjudicable fires + compute precision per arm via pure helper
  const perArm: Record<Arm, ArmCounts> = {
    "A-baseline": { tp: 0, fp: 0, unclear: 0, non_fire_fn: 0, non_fire_tn: 0 },
    "B-enriched": { tp: 0, fp: 0, unclear: 0, non_fire_fn: 0, non_fire_tn: 0 },
  }
  for (const p of mappingFile.packets) {
    if (p.retest_of) continue
    const label = labelByPacket.get(p.packet_id)!.label
    const bucket = perArm[p.arm]
    if (p.is_fire) {
      if (label === "TP") bucket.tp++
      else if (label === "FP") bucket.fp++
      else if (label === "UNCLEAR") bucket.unclear++
    } else {
      if (label === "TP") bucket.non_fire_tn++
      else if (label === "FP") bucket.non_fire_fn++
      // UNCLEAR on non-fires is descriptive; ignore
    }
  }

  const verdict = computeVerdict(perArm["A-baseline"], perArm["B-enriched"])

  console.log("")
  console.log(`[ingest] per-arm adjudication breakdown:`)
  console.log(`  Arm A (baseline):  TP=${perArm["A-baseline"].tp} FP=${perArm["A-baseline"].fp} UNCLEAR=${perArm["A-baseline"].unclear}  FN-audit_FN=${perArm["A-baseline"].non_fire_fn}/${perArm["A-baseline"].non_fire_tn + perArm["A-baseline"].non_fire_fn}`)
  console.log(`  Arm B (enriched):  TP=${perArm["B-enriched"].tp} FP=${perArm["B-enriched"].fp} UNCLEAR=${perArm["B-enriched"].unclear}  FN-audit_FN=${perArm["B-enriched"].non_fire_fn}/${perArm["B-enriched"].non_fire_tn + perArm["B-enriched"].non_fire_fn}`)
  console.log("")
  console.log(`[ingest] precision (UNCLEAR excluded):`)
  console.log(`  precision_A = ${verdict.precision_a === null ? "N/A" : (verdict.precision_a * 100).toFixed(1) + "%"}  (adjudicable fires: ${verdict.adjudicable_a})`)
  console.log(`  precision_B = ${verdict.precision_b === null ? "N/A" : (verdict.precision_b * 100).toFixed(1) + "%"}  (adjudicable fires: ${verdict.adjudicable_b})`)
  console.log(`  UNCLEAR rate: A=${(verdict.unclear_rate_a * 100).toFixed(1)}%  B=${(verdict.unclear_rate_b * 100).toFixed(1)}%`)
  if (verdict.delta_pt !== null) {
    console.log(`  precision delta (B − A): ${verdict.delta_pt.toFixed(1)}pt`)
  }
  console.log("")
  console.log(`[ingest] VERDICT: ${verdict.verdict} — ${verdict.reason}`)
  console.log(`  Action: ${verdict.action}`)
}

// ── CLI ───────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2)
  const has = (flag: string) => argv.includes(flag)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  return {
    emit: has("--emit"),
    ingest: has("--ingest"),
    setName: get("--set-name"),
    out: get("--out"),
    bundle: get("--bundle"),
  }
}

async function main() {
  const args = parseArgs()
  if (args.emit) {
    if (!args.setName || !args.out) {
      console.error("usage: --emit --set-name <name> --out <dir>")
      process.exit(2)
    }
    await runEmit(args.setName, args.out)
    return
  }
  if (args.ingest) {
    if (!args.bundle) {
      console.error("usage: --ingest --bundle <dir>")
      process.exit(2)
    }
    await runIngest(args.bundle)
    return
  }
  console.error("usage: --emit --set-name <name> --out <dir> OR --ingest --bundle <dir>")
  process.exit(2)
}

if (import.meta.main) {
  main().catch(e => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1) })
}
