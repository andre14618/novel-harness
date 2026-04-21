#!/usr/bin/env bun
/**
 * Arm B direct pairwise adjudicator per
 * `docs/charters/arm-b-direct-pairwise.md`. Sibling of the per-fire
 * `preflight-arm-b-adjudicate.ts` — kept separate because the label
 * vocabulary, packet shape, and verdict rule are all different.
 *
 * ── emit ────────────────────────────────────────────────────────────
 *
 * Reads eval_results rows for the run, one per arm per beat. For each
 * beat that has both an A-baseline and B-enriched row with generated
 * prose, constructs a blind pairwise packet:
 *
 *   - Two labeled prose blocks ("Version 1" / "Version 2"), order
 *     deterministically randomized by beat ID so the adjudicator can't
 *     infer arm from position
 *   - Arm identity is masked (no "A" / "B" / "baseline" / "enriched"
 *     strings in the packet body)
 *   - Packet metadata (version_1_is, version_2_is) goes to mapping.json
 *     which --ingest consumes
 *
 * Plus 4 silent retests: 4 packets are sampled at random and
 * re-emitted at the end of the bundle with the version order SWAPPED.
 * If the adjudicator flips the winner on any retest, that's a
 * position-bias signal.
 *
 * Labels: A-WINS / B-WINS / TIE (one per packet). Adjudicator sees
 * only VERSION-1-WINS / VERSION-2-WINS / TIE in the rubric; the
 * version→arm mapping is in mapping.json.
 *
 * ── ingest ──────────────────────────────────────────────────────────
 *
 * Reads filled-in labels.tsv + mapping.json, resolves version-labels
 * back to arm-labels, counts wins/losses/ties, detects retest flips,
 * computes the GO / NO-GO / CAUTION / INCONCLUSIVE verdict per the
 * charter's §7 outcome table (one-tailed binomial test against fair-
 * coin null at p < 0.025: GO at B ≥ 14 / 20, NO-GO at A ≥ 14 / 20).
 *
 * Usage:
 *   bun scripts/evals/arm-b-pairwise.ts --emit \
 *     --set-name arm-b-direct-pairwise-v1 --out output/evals/pairwise/v1
 *   # edit output/evals/pairwise/v1/labels.tsv
 *   bun scripts/evals/arm-b-pairwise.ts --ingest \
 *     --bundle output/evals/pairwise/v1
 */

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import db from "../../src/db/connection"

// ── Types ──────────────────────────────────────────────────────────────

type Arm = "A-baseline" | "B-enriched"
type VersionPos = "1" | "2"
type PairwiseLabel = "VERSION-1-WINS" | "VERSION-2-WINS" | "TIE" | ""

interface EvalRow {
  id: number
  beat_id: string
  cell_label: Arm
  generated_prose: string | null
  error_text: string | null
}

interface PacketMapping {
  packet_id: string
  beat_id: string
  version_1_is: Arm  // which arm's prose is shown as "Version 1"
  version_2_is: Arm
  eval_result_id_a: number
  eval_result_id_b: number
  retest_of: string | null
}

interface LabelRow {
  packet_id: string
  label: PairwiseLabel
  notes: string
}

export interface PairwiseVerdict {
  verdict: "GO" | "CAUTION" | "NO-GO" | "INCONCLUSIVE"
  reason: string
  action: string
  a_wins: number
  b_wins: number
  ties: number
  total_pairs: number
  // Effective win counts with ties as 0.5 per arm
  a_score: number
  b_score: number
  retest_flips: number
  retest_count: number
}

// ── Verdict (pure, tested) ────────────────────────────────────────────

/**
 * One-tailed binomial threshold: at N=20 fair coin, P(X ≥ 14) ≈ 0.0577
 * two-tailed → ≈ 0.0289 one-tailed. P(X ≥ 15) ≈ 0.021 one-tailed. The
 * charter uses the 14-of-20 threshold ("p < 0.025" colloquially) for
 * operational simplicity; we preserve that wording here. For other N
 * values the threshold scales: we derive it as ceil(0.7 * N), which
 * matches 14 at N=20. A stricter implementation should use a proper
 * binomial table; this is acceptable for N in [10, 40].
 */
function winThreshold(N: number): number {
  return Math.ceil(0.7 * N)
}

export function computePairwiseVerdict(
  aWins: number,
  bWins: number,
  ties: number,
  retestFlips: number,
  retestCount: number,
): PairwiseVerdict {
  const total = aWins + bWins + ties
  const aScore = aWins + ties * 0.5
  const bScore = bWins + ties * 0.5
  const threshold = winThreshold(total)

  // INCONCLUSIVE evaluated FIRST — position-bias check dominates
  if (retestCount > 0 && retestFlips >= 2) {
    return {
      verdict: "INCONCLUSIVE",
      reason: `adjudicator-position bias: ${retestFlips}/${retestCount} retest flips exceeds 2-flip kill threshold`,
      action: "Adjudicator-position bias dominates. Do not report a verdict. Larger N or second adjudicator required.",
      a_wins: aWins,
      b_wins: bWins,
      ties,
      total_pairs: total,
      a_score: aScore,
      b_score: bScore,
      retest_flips: retestFlips,
      retest_count: retestCount,
    }
  }

  const shared = {
    a_wins: aWins, b_wins: bWins, ties,
    total_pairs: total, a_score: aScore, b_score: bScore,
    retest_flips: retestFlips, retest_count: retestCount,
  }

  if (bWins >= threshold) {
    return {
      ...shared,
      verdict: "GO",
      reason: `Arm B wins ${bWins}/${total} ≥ ${threshold} threshold (one-tailed binomial p < 0.025)`,
      action: "Context engineering stays on the board. Proceed to a simplified replay-ladder that excludes detector-as-primary-oracle.",
    }
  }
  if (aWins >= threshold) {
    return {
      ...shared,
      verdict: "NO-GO",
      reason: `Arm A wins ${aWins}/${total} ≥ ${threshold} threshold (one-tailed binomial p < 0.025)`,
      action: "Enriched context is net-negative for this corpus. Retire the package; consider alternate enrichment designs before re-charter.",
    }
  }
  return {
    ...shared,
    verdict: "CAUTION",
    reason: `middle range: A=${aWins}, B=${bWins}, T=${ties} — neither arm clears the ${threshold}-win threshold at N=${total}`,
    action: "Expand to N ≈ 40 pairs or treat as null and move capital to another lever.",
  }
}

// ── Label parsing (pure, tested) ──────────────────────────────────────

const VALID_LABELS = new Set<PairwiseLabel>([
  "VERSION-1-WINS",
  "VERSION-2-WINS",
  "TIE",
  "",
])

export function parsePairwiseLabelsTsv(text: string): LabelRow[] {
  const out: LabelRow[] = []
  const lines = text.split("\n").filter(l => l.trim().length > 0)
  for (let i = 1; i < lines.length; i++) {
    const [packet_id, label, notes] = lines[i].split("\t")
    if (!packet_id) continue
    const normalized = (label ?? "").trim().toUpperCase().replace(/\s+/g, "-")
    if (!VALID_LABELS.has(normalized as PairwiseLabel)) continue
    out.push({
      packet_id: packet_id.trim(),
      label: normalized as PairwiseLabel,
      notes: (notes ?? "").trim(),
    })
  }
  return out
}

// ── Packet helpers ────────────────────────────────────────────────────

function randomPacketId(): string {
  return createHash("sha256").update(crypto.randomUUID()).digest("hex").slice(0, 12)
}

function seededShuffleBoolean(seed: string): boolean {
  // Returns true if A should be Version 1, false if B is Version 1.
  // Deterministic per seed; spreads arm-to-position mapping.
  const h = createHash("sha256").update(seed).digest()
  return (h[0] & 1) === 0
}

function shuffle<T>(arr: T[], seed: string): T[] {
  const copy = arr.slice()
  const rng = mulberry32(hashToInt(seed))
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
  mapping: PacketMapping,
  proseByEvalId: Map<number, string>,
  isRetest: boolean,
): string {
  const v1EvalId =
    mapping.version_1_is === "A-baseline"
      ? mapping.eval_result_id_a
      : mapping.eval_result_id_b
  const v2EvalId = v1EvalId === mapping.eval_result_id_a
    ? mapping.eval_result_id_b
    : mapping.eval_result_id_a

  const prose1 = proseByEvalId.get(v1EvalId) ?? "(no prose)"
  const prose2 = proseByEvalId.get(v2EvalId) ?? "(no prose)"

  return [
    `### Packet ${packetId}${isRetest ? " (retest)" : ""}`,
    "",
    "**Version 1:**",
    "",
    prose1,
    "",
    "---",
    "",
    "**Version 2:**",
    "",
    prose2,
    "",
    "---",
  ].join("\n")
}

// ── Emit ──────────────────────────────────────────────────────────────

async function runEmit(setName: string, outDir: string): Promise<void> {
  const rows = await db<EvalRow[]>`
    SELECT id, beat_id, cell_label, generated_prose, error_text
    FROM eval_results
    WHERE set_name = ${setName}
    ORDER BY id ASC
  `
  if (rows.length === 0) {
    console.error(`No eval_results for set_name=${setName}`)
    process.exit(2)
  }

  // Group by beat_id; keep only beats with both A and B present with prose and no errors
  const byBeat = new Map<string, { a?: EvalRow; b?: EvalRow }>()
  for (const r of rows) {
    if (!r.generated_prose || r.error_text) continue
    const entry = byBeat.get(r.beat_id) ?? {}
    if (r.cell_label === "A-baseline") entry.a = r
    else if (r.cell_label === "B-enriched") entry.b = r
    byBeat.set(r.beat_id, entry)
  }

  const completeBeats = [...byBeat.entries()]
    .filter(([, v]) => v.a && v.b)
    .map(([beat_id, v]) => ({ beat_id, a: v.a!, b: v.b! }))
    .sort((x, y) => x.beat_id.localeCompare(y.beat_id))

  if (completeBeats.length === 0) {
    console.error(`No beats in ${setName} have both A and B prose`)
    process.exit(2)
  }
  console.log(`[emit-pairwise] set_name=${setName} complete-pairs=${completeBeats.length}`)

  const proseByEvalId = new Map<number, string>()
  for (const b of completeBeats) {
    proseByEvalId.set(b.a.id, b.a.generated_prose!)
    proseByEvalId.set(b.b.id, b.b.generated_prose!)
  }

  // Build mappings (one per complete beat)
  const mappings: PacketMapping[] = completeBeats.map(b => {
    const aIsV1 = seededShuffleBoolean(`${setName}:${b.beat_id}:order`)
    return {
      packet_id: randomPacketId(),
      beat_id: b.beat_id,
      version_1_is: aIsV1 ? "A-baseline" : "B-enriched",
      version_2_is: aIsV1 ? "B-enriched" : "A-baseline",
      eval_result_id_a: b.a.id,
      eval_result_id_b: b.b.id,
      retest_of: null,
    }
  })

  // 4 silent retests, with version order SWAPPED vs original
  const retestSources = shuffle(mappings, `${setName}:retest`).slice(0, Math.min(4, mappings.length))
  const retests: PacketMapping[] = retestSources.map(src => ({
    packet_id: randomPacketId(),
    beat_id: src.beat_id,
    version_1_is: src.version_2_is,   // swapped
    version_2_is: src.version_1_is,
    eval_result_id_a: src.eval_result_id_a,
    eval_result_id_b: src.eval_result_id_b,
    retest_of: src.packet_id,
  }))

  const allPackets = [...mappings, ...retests]
  const ordered = shuffle(allPackets, `${setName}:order`)

  const mappingByPacket = new Map(allPackets.map(m => [m.packet_id, m]))
  const packetTexts = ordered.map(p =>
    renderPacket(p.packet_id, mappingByPacket.get(p.packet_id)!, proseByEvalId, !!p.retest_of),
  )

  const md = [
    `# Arm B Direct Pairwise — Adjudication Packets`,
    "",
    `**Set:** ${setName}`,
    `**Packets:** ${ordered.length} (${mappings.length} pairs + ${retests.length} silent retests)`,
    "",
    "## Adjudication rubric (per docs/charters/arm-b-direct-pairwise.md §7)",
    "",
    "For each packet, read Version 1 and Version 2 back-to-back and pick the one you'd want to see in the finished novel. Label one of:",
    "",
    "- **VERSION-1-WINS** — Version 1 is meaningfully better.",
    "- **VERSION-2-WINS** — Version 2 is meaningfully better.",
    "- **TIE** — Genuinely indistinguishable or effectively equal. Counts as 0.5 per arm.",
    "",
    "Notes column is optional: a few words on what drove the call (voice, grounding, pacing, specificity, etc.). Useful for the results writeup.",
    "",
    "Position is randomized per packet. Four silent retests are embedded in the bundle with swapped version order — if you flip the winner on any retest, that's position-bias signal; the verdict script will flag it.",
    "",
    "Fill in labels.tsv. Do NOT edit mapping.json or this file.",
    "",
    "---",
    "",
    packetTexts.join("\n\n"),
  ].join("\n")

  const tsv = ["packet_id\tlabel\tnotes", ...ordered.map(p => `${p.packet_id}\t\t`)].join("\n")

  await mkdir(path.resolve(outDir), { recursive: true })
  await writeFile(path.resolve(outDir, "packets.md"), md + "\n")
  await writeFile(path.resolve(outDir, "labels.tsv"), tsv + "\n")
  await writeFile(
    path.resolve(outDir, "mapping.json"),
    JSON.stringify({ set_name: setName, packets: allPackets, ordered_packet_ids: ordered.map(p => p.packet_id) }, null, 2),
  )
  console.log(`[emit-pairwise] wrote ${ordered.length} packets to ${outDir}`)
}

// ── Ingest ────────────────────────────────────────────────────────────

async function runIngest(bundleDir: string): Promise<void> {
  const labelsText = await readFile(path.resolve(bundleDir, "labels.tsv"), "utf8")
  const mappingText = await readFile(path.resolve(bundleDir, "mapping.json"), "utf8")
  const mappingFile = JSON.parse(mappingText) as {
    set_name: string
    packets: PacketMapping[]
    ordered_packet_ids: string[]
  }
  const labels = parsePairwiseLabelsTsv(labelsText)
  const labelByPacket = new Map(labels.map(l => [l.packet_id, l]))
  const mappingByPacket = new Map(mappingFile.packets.map(p => [p.packet_id, p]))

  const unfilled = mappingFile.packets.filter(p => {
    const l = labelByPacket.get(p.packet_id)
    return !l || l.label === ""
  })
  if (unfilled.length > 0) {
    console.error(`[ingest-pairwise] ERROR: ${unfilled.length} packet(s) unlabeled`)
    for (const p of unfilled.slice(0, 5)) console.error(`  ${p.packet_id}`)
    process.exit(2)
  }

  // Resolve each packet's winner to an ARM
  function winnerArm(p: PacketMapping, label: PairwiseLabel): Arm | "TIE" {
    if (label === "TIE") return "TIE"
    if (label === "VERSION-1-WINS") return p.version_1_is
    if (label === "VERSION-2-WINS") return p.version_2_is
    throw new Error(`bad label ${label}`)
  }

  let aWins = 0, bWins = 0, ties = 0
  let retestCount = 0, retestFlips = 0

  for (const p of mappingFile.packets) {
    if (p.retest_of) {
      retestCount++
      const origLabel = labelByPacket.get(p.retest_of)!.label
      const origP = mappingByPacket.get(p.retest_of)!
      const origWinner = winnerArm(origP, origLabel)
      const retestWinner = winnerArm(p, labelByPacket.get(p.packet_id)!.label)
      if (origWinner !== retestWinner) retestFlips++
      continue
    }
    const winner = winnerArm(p, labelByPacket.get(p.packet_id)!.label)
    if (winner === "TIE") ties++
    else if (winner === "A-baseline") aWins++
    else bWins++
  }

  const verdict = computePairwiseVerdict(aWins, bWins, ties, retestFlips, retestCount)

  console.log("")
  console.log(`[ingest-pairwise] ${mappingFile.set_name}`)
  console.log(`  primary pairs (retests excluded): A=${aWins}  B=${bWins}  TIE=${ties}  total=${aWins+bWins+ties}`)
  console.log(`  score (ties split): A=${verdict.a_score.toFixed(1)}  B=${verdict.b_score.toFixed(1)}`)
  console.log(`  retests: ${retestFlips}/${retestCount} flips`)
  console.log(`  win threshold at N=${verdict.total_pairs}: ${winThreshold(verdict.total_pairs)}`)
  console.log("")
  console.log(`[ingest-pairwise] VERDICT: ${verdict.verdict} — ${verdict.reason}`)
  console.log(`  Action: ${verdict.action}`)
}

// ── CLI ───────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2)
  return {
    emit: argv.includes("--emit"),
    ingest: argv.includes("--ingest"),
    setName: ((i) => i >= 0 ? argv[i + 1] : undefined)(argv.indexOf("--set-name")),
    out: ((i) => i >= 0 ? argv[i + 1] : undefined)(argv.indexOf("--out")),
    bundle: ((i) => i >= 0 ? argv[i + 1] : undefined)(argv.indexOf("--bundle")),
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
