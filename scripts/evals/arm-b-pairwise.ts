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

// Arm label is the `cell_label` column of eval_results. Two arm-label
// strings are expected per set; the emitter auto-detects which two are
// present and pairs them. The pair convention is "left-arm vs right-arm"
// where the two are sorted alphabetically (so A-baseline < B-enriched,
// A-salvatore-v4 < D-deepseek-v3.2, etc.) — this is purely for
// deterministic naming; the arm identity is hypothesis-masked in packets.
type Arm = string
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
  /**
   * Revision 2 addition per Codex round-1 warning (1): calibration
   * packets where BOTH sides are the same arm's prose. Expected label
   * is TIE; if the adjudicator picks a winner, it signals preference
   * priors decoupled from arm identity. Primary pairs have this null.
   */
  calibration_kind: "A-vs-A" | "B-vs-B" | null
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
  // Decisive = a_wins + b_wins (ties excluded from the binomial denominator
  // per Codex round-1 YELLOW blocker #1, job `ae40043cc3262a8b2`). Ties
  // as 0.5 breaks the binomial model: can't have fractional successes.
  decisive_pairs: number
  retest_flips: number
  retest_count: number
}

// ── Verdict (pure, tested) ────────────────────────────────────────────

/**
 * Decisive-win threshold at p ≤ 0.025 one-tailed binomial. Ties are
 * excluded from the denominator (they're uninformative about direction
 * and fractional-successes break the binomial model).
 *
 * Exact thresholds (computed from the binomial distribution):
 *   N_decisive = 10 → 9 decisive wins (p ≈ 0.011)
 *   N_decisive = 15 → 12 (p ≈ 0.018)
 *   N_decisive = 20 → 15 (p ≈ 0.021)  ← charter default
 *   N_decisive = 25 → 18 (p ≈ 0.022)
 *   N_decisive = 30 → 20 (p ≈ 0.049 — above threshold; use 21: p ≈ 0.021)
 *
 * For N_decisive outside the table we fall back to the normal
 * approximation `ceil(N/2 + 1.96·√(N/4))`, which is conservative in
 * this range. The charter's default path is N=20 where 15 is exact.
 */
function decisiveThreshold(nDecisive: number): number {
  // Exact table entries, keyed by N_decisive
  const EXACT: Record<number, number> = {
    10: 9, 11: 9, 12: 10, 13: 10, 14: 11, 15: 12,
    16: 12, 17: 13, 18: 13, 19: 14, 20: 15,
    21: 15, 22: 16, 23: 16, 24: 17, 25: 18,
    26: 18, 27: 19, 28: 19, 29: 20, 30: 21,
    31: 21, 32: 22, 33: 23, 34: 23, 35: 24,
    36: 24, 37: 25, 38: 26, 39: 26, 40: 27,
  }
  if (EXACT[nDecisive] !== undefined) return EXACT[nDecisive]
  // Normal approximation fallback for N outside [10, 40]
  return Math.ceil(nDecisive / 2 + 1.96 * Math.sqrt(nDecisive / 4))
}

/**
 * Minimum decisive-pair count required before a GO/NO-GO verdict is
 * even computable. If ties dominate, the test is underpowered and we
 * must return CAUTION regardless of the decisive win ratio.
 *
 * At N_primary=20, requiring ≥14 decisive pairs means ties can account
 * for at most 6/20 = 30% of primary packets — matching the spirit of
 * the per-fire charter's 25% UNCLEAR abort threshold.
 */
const MIN_DECISIVE_FRACTION = 0.70

export function computePairwiseVerdict(
  aWins: number,
  bWins: number,
  ties: number,
  retestFlips: number,
  retestCount: number,
): PairwiseVerdict {
  const totalPrimary = aWins + bWins + ties
  const decisive = aWins + bWins
  const threshold = decisiveThreshold(decisive)
  const minDecisive = Math.ceil(MIN_DECISIVE_FRACTION * totalPrimary)

  const shared = {
    a_wins: aWins, b_wins: bWins, ties,
    total_pairs: totalPrimary,
    decisive_pairs: decisive,
    retest_flips: retestFlips, retest_count: retestCount,
  }

  // INCONCLUSIVE evaluated FIRST — position-bias check dominates all outcomes
  if (retestCount > 0 && retestFlips >= 2) {
    return {
      ...shared,
      verdict: "INCONCLUSIVE",
      reason: `adjudicator-position bias: ${retestFlips}/${retestCount} retest flips exceeds 2-flip kill threshold`,
      action: "Adjudicator-position bias dominates. Do not report a verdict. Larger N or second adjudicator required.",
    }
  }

  // Underpowered: too many ties to compute a directional verdict
  if (decisive < minDecisive) {
    return {
      ...shared,
      verdict: "CAUTION",
      reason: `underpowered: only ${decisive}/${totalPrimary} decisive pairs (ties=${ties}). Need ≥${minDecisive} decisive (${Math.round(MIN_DECISIVE_FRACTION * 100)}% of N) for a directional test.`,
      action: "Tie rate too high for the binomial test. Expand N, tighten the adjudication rubric, or treat as null and move capital to another lever.",
    }
  }

  if (bWins >= threshold) {
    return {
      ...shared,
      verdict: "GO",
      reason: `Arm B wins ${bWins}/${decisive} decisive pairs ≥ ${threshold} threshold (one-tailed binomial p ≤ 0.025, ties excluded)`,
      action: "Context engineering stays on the board. Proceed to a simplified replay-ladder that excludes detector-as-primary-oracle.",
    }
  }
  if (aWins >= threshold) {
    return {
      ...shared,
      verdict: "NO-GO",
      reason: `Arm A wins ${aWins}/${decisive} decisive pairs ≥ ${threshold} threshold (one-tailed binomial p ≤ 0.025, ties excluded)`,
      action: "Enriched context is net-negative for this corpus. Retire the package; consider alternate enrichment designs before re-charter.",
    }
  }
  return {
    ...shared,
    verdict: "CAUTION",
    reason: `middle range: A=${aWins}, B=${bWins}, T=${ties} — neither arm clears the ${threshold}-of-${decisive}-decisive threshold at N=${totalPrimary}`,
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
  labelA: Arm,
): string {
  // eval_result_id_a always corresponds to labelA; eval_result_id_b to labelB.
  // Pick the id for whichever arm is shown as Version 1.
  const v1EvalId =
    mapping.version_1_is === labelA
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

  // Auto-detect the two arm labels present in this set. For the charter
  // to be valid, exactly TWO distinct cell_labels must appear (e.g.,
  // A-baseline / B-enriched for arm-b-direct-pairwise; A-salvatore-v4 /
  // D-deepseek-v3.2 for arm-d-writer-upgrade).
  const distinctLabels = [...new Set(rows.map(r => r.cell_label))].sort()
  if (distinctLabels.length !== 2) {
    console.error(`[emit-pairwise] expected exactly 2 cell_labels in set ${setName}; found ${distinctLabels.length}: ${distinctLabels.join(", ")}`)
    process.exit(2)
  }
  const [labelA, labelB] = distinctLabels
  console.log(`[emit-pairwise] detected arms: ${labelA} vs ${labelB}`)

  // Group by beat_id; keep only beats with both arms present with prose and no errors
  const byBeat = new Map<string, { a?: EvalRow; b?: EvalRow }>()
  for (const r of rows) {
    if (!r.generated_prose || r.error_text) continue
    const entry = byBeat.get(r.beat_id) ?? {}
    if (r.cell_label === labelA) entry.a = r
    else if (r.cell_label === labelB) entry.b = r
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

  // Build primary mappings (one per complete beat).
  // Per-pair A/B-side seed is distinct from packet-order seed per
  // charter §6 dual-seed discipline (revision 2, Codex round-1
  // warning 2).
  const mappings: PacketMapping[] = completeBeats.map(b => {
    const aIsV1 = seededShuffleBoolean(`${setName}:${b.beat_id}:side`)
    return {
      packet_id: randomPacketId(),
      beat_id: b.beat_id,
      version_1_is: aIsV1 ? labelA : labelB,
      version_2_is: aIsV1 ? labelB : labelA,
      eval_result_id_a: b.a.id,
      eval_result_id_b: b.b.id,
      retest_of: null,
      calibration_kind: null,
    }
  })

  // 4 silent retests, with version order SWAPPED vs original
  const retestSources = shuffle(mappings, `${setName}:retest`).slice(
    0,
    Math.min(4, mappings.length),
  )
  const retests: PacketMapping[] = retestSources.map(src => ({
    packet_id: randomPacketId(),
    beat_id: src.beat_id,
    version_1_is: src.version_2_is,   // swapped
    version_2_is: src.version_1_is,
    eval_result_id_a: src.eval_result_id_a,
    eval_result_id_b: src.eval_result_id_b,
    retest_of: src.packet_id,
    calibration_kind: null,
  }))

  // 5 calibration packets (revision 2, Codex round-1 warning 1):
  // 3 A-vs-A, 2 B-vs-B, sampled deterministically from the primary
  // pool. Both sides show the SAME arm's prose — any non-TIE label
  // is evidence of adjudicator preference-priors decoupled from arm
  // identity. The INCONCLUSIVE rule in §7 kicks in at ≥ 2/5
  // calibration failures.
  const calibSources = shuffle(completeBeats, `${setName}:calibration`).slice(
    0,
    Math.min(5, completeBeats.length),
  )
  const calibrations: PacketMapping[] = calibSources.map((src, i) => {
    const kind: "A-vs-A" | "B-vs-B" = i < 3 ? "A-vs-A" : "B-vs-B"
    const arm: Arm = kind === "A-vs-A" ? labelA : labelB
    const evalId = kind === "A-vs-A" ? src.a.id : src.b.id
    return {
      packet_id: randomPacketId(),
      beat_id: src.beat_id,
      version_1_is: arm,
      version_2_is: arm,
      eval_result_id_a: evalId,
      eval_result_id_b: evalId,
      retest_of: null,
      calibration_kind: kind,
    }
  })

  const allPackets = [...mappings, ...retests, ...calibrations]
  // Packet-order seed is distinct from the per-pair side seed above
  const ordered = shuffle(allPackets, `${setName}:packet-order`)

  const mappingByPacket = new Map(allPackets.map(m => [m.packet_id, m]))
  const packetTexts = ordered.map(p =>
    renderPacket(p.packet_id, mappingByPacket.get(p.packet_id)!, proseByEvalId, !!p.retest_of, labelA),
  )

  // Insert a visible mid-run break marker after the 12th non-calibration
  // packet in ordered. Helps pacing per charter §8; adjudicator can stop
  // there, take a break, resume. Calibration packets are not natural
  // break points (adjudicator can't distinguish them from primary pairs).
  const breakPosition = (() => {
    let nonCalib = 0
    for (let i = 0; i < ordered.length; i++) {
      if (!ordered[i].calibration_kind) nonCalib++
      if (nonCalib === 12) return i + 1  // after this packet
    }
    return -1
  })()
  const packetTextsWithBreak = packetTexts.slice()
  if (breakPosition > 0 && breakPosition < packetTextsWithBreak.length) {
    packetTextsWithBreak.splice(
      breakPosition,
      0,
      "## — Suggested mid-session break —\n\nRest your eyes for a few minutes before continuing. Fatigue-correlated drift is a known pairwise-adjudication hazard.\n\n---",
    )
  }

  const md = [
    `# Arm B Direct Pairwise — Adjudication Packets`,
    "",
    `**Set:** ${setName}`,
    `**Packets:** ${ordered.length} = ${mappings.length} primary + ${retests.length} silent retests + ${calibrations.length} calibration`,
    "",
    "## Adjudication rubric (per docs/charters/arm-b-direct-pairwise.md §7)",
    "",
    "For each packet, read Version 1 and Version 2 back-to-back and pick the one you'd want to see in the finished novel. Label one of:",
    "",
    "- **VERSION-1-WINS** — Version 1 is meaningfully better.",
    "- **VERSION-2-WINS** — Version 2 is meaningfully better.",
    "- **TIE** — Genuinely indistinguishable or effectively equal.",
    "",
    "**Notes column required on primary pairs (1–2 sentences):** what drove the call (voice, grounding, pacing, specificity, dialogue, setting detail, etc.). Preserves auditability without collapsing into a checklist. Empty notes are acceptable only for TIE packets and for repeats that feel identical to an earlier decision.",
    "",
    "**Embedded controls:**",
    "- Four silent retests with swapped version order — if you flip the winner on any, that's position-bias; the verdict script flags ≥2 flips as INCONCLUSIVE.",
    "- Five calibration packets where BOTH sides are the same arm's prose — expected label is TIE. ≥2 non-TIE labels across the five routes the run to INCONCLUSIVE per charter §3.",
    "",
    "You do NOT know which packets are retests or calibrations. Judge every packet on its own merits.",
    "",
    "Fill in labels.tsv. Do NOT edit mapping.json or this file.",
    "",
    "---",
    "",
    packetTextsWithBreak.join("\n\n"),
  ].join("\n")

  const tsv = ["packet_id\tlabel\tnotes", ...ordered.map(p => `${p.packet_id}\t\t`)].join("\n")

  await mkdir(path.resolve(outDir), { recursive: true })
  await writeFile(path.resolve(outDir, "packets.md"), md + "\n")
  await writeFile(path.resolve(outDir, "labels.tsv"), tsv + "\n")
  await writeFile(
    path.resolve(outDir, "mapping.json"),
    JSON.stringify({
      set_name: setName,
      arm_a_label: labelA,
      arm_b_label: labelB,
      packets: allPackets,
      ordered_packet_ids: ordered.map(p => p.packet_id),
    }, null, 2),
  )
  console.log(`[emit-pairwise] wrote ${ordered.length} packets to ${outDir}`)
}

// ── Ingest ────────────────────────────────────────────────────────────

async function runIngest(bundleDir: string): Promise<void> {
  const labelsText = await readFile(path.resolve(bundleDir, "labels.tsv"), "utf8")
  const mappingText = await readFile(path.resolve(bundleDir, "mapping.json"), "utf8")
  const mappingFile = JSON.parse(mappingText) as {
    set_name: string
    arm_a_label?: Arm   // present in bundles emitted after 2026-04-21
    arm_b_label?: Arm
    packets: PacketMapping[]
    ordered_packet_ids: string[]
  }
  // Backward-compat: older bundles (e.g. arm-b-direct-pairwise-v1)
  // didn't persist arm labels in mapping.json; derive from the packets'
  // version_1_is / version_2_is values.
  const labelSet = new Set<Arm>()
  for (const p of mappingFile.packets) {
    labelSet.add(p.version_1_is)
    labelSet.add(p.version_2_is)
  }
  const allLabels = [...labelSet].sort()
  const labelA = mappingFile.arm_a_label ?? allLabels[0]
  const labelB = mappingFile.arm_b_label ?? allLabels[1]
  console.log(`[ingest-pairwise] arms: ${labelA} (Arm A / first-sorted) vs ${labelB} (Arm B / second-sorted)`)

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
  let calibrationCount = 0, calibrationFails = 0

  for (const p of mappingFile.packets) {
    const label = labelByPacket.get(p.packet_id)!.label

    // Calibration packets (A-vs-A or B-vs-B) — expected TIE; any
    // non-TIE label is a calibration failure per charter §3.
    if (p.calibration_kind) {
      calibrationCount++
      if (label !== "TIE") calibrationFails++
      continue
    }

    // Silent retests — compare winner against the original packet
    if (p.retest_of) {
      retestCount++
      const origLabel = labelByPacket.get(p.retest_of)!.label
      const origP = mappingByPacket.get(p.retest_of)!
      const origWinner = winnerArm(origP, origLabel)
      const retestWinner = winnerArm(p, label)
      if (origWinner !== retestWinner) retestFlips++
      continue
    }

    // Primary pairs — the only packets whose winners count toward the
    // binomial test
    const winner = winnerArm(p, label)
    if (winner === "TIE") ties++
    else if (winner === labelA) aWins++
    else bWins++
  }

  // Calibration-check kill per charter §3 (Codex round-1 warning 1):
  // ≥ 2/5 calibration packets labeled non-TIE signals adjudicator
  // preference priors decoupled from arm identity — INCONCLUSIVE.
  const calibrationFailsThreshold = 2
  const calibrationFailed =
    calibrationCount > 0 && calibrationFails >= calibrationFailsThreshold

  let verdict = computePairwiseVerdict(aWins, bWins, ties, retestFlips, retestCount)
  if (calibrationFailed) {
    verdict = {
      ...verdict,
      verdict: "INCONCLUSIVE",
      reason: `calibration check failed: ${calibrationFails}/${calibrationCount} same-arm packets labeled non-TIE (threshold: ≥ ${calibrationFailsThreshold}). Adjudicator is manufacturing preferences from identical prose.`,
      action: "Adjudicator preference priors dominate. Do not report a verdict. Tighten the rubric or use a different adjudicator before retry.",
    }
  }

  console.log("")
  console.log(`[ingest-pairwise] ${mappingFile.set_name}`)
  console.log(`  primary pairs (retests+calibration excluded): A=${aWins}  B=${bWins}  TIE=${ties}  total=${aWins + bWins + ties}`)
  console.log(`  decisive pairs (ties excluded): ${verdict.decisive_pairs}`)
  console.log(`  retests: ${retestFlips}/${retestCount} flips`)
  console.log(`  calibration: ${calibrationFails}/${calibrationCount} non-TIE (threshold: ≥${calibrationFailsThreshold})`)
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
