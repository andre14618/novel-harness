import type { ChapterOutline, SceneBeat, BeatObligationsContract } from "../types"
import type { PayoffLink } from "../schemas/shared"
import { recommendedSceneCountForTarget } from "./scene-counts"

// Deterministic calibrated scene-packing for the `calibrated:packed` cohort
// variant (decision L086). Reduces a chapter outline's scene-entry count to a
// per-chapter budget derived from target words while preserving every
// authored obligation and every forward-looking payoff link.
//
// Constraints (per L086 + 2026-05-06 review):
//   1. First and last source scene entries are anchors and must survive packing,
//      so the chapter opener and endpoint/turn are preserved.
//   2. `budget = recommendedSceneCountForTarget(targetWords)`. If the source
//      already has <= budget scene entries, the helper is a no-op (still emits an
//      audit entry).
//   3. If anchor count > budget the helper yields `budgetExceeded: true`
//      and keeps every must-keep entry rather than destroying structure.
//   4. Reduction merges adjacent middle entries by lowest combined
//      obligation density; merging never drops obligations or payoffs.
//   5. Merged descriptions use a structured "Packed from source
//      scenes X-Y:" bullet list so the writer sees clear sub-actions.
//
// This helper is experiment-only. It is invoked from
// `scripts/evals/semantic-gate-baseline.ts` when the variant pack-strategy
// is `calibrated`. It must not be wired into production planning.

export interface PackedSceneAudit {
  packedIndex: number
  sourceIndices: number[]
  sourceSceneIds: string[]
  obligationKeysBefore: string[]
  obligationKeysAfter: string[]
  droppedObligationKeys: string[]
  merged: boolean
}

export interface ChapterScenePackingAudit {
  chapterNumber: number
  targetWords: number
  budget: number
  sourceSceneCount: number
  packedSceneCount: number
  noOp: boolean
  budgetExceeded: boolean
  endpointPreserved: boolean
  openerPreserved: boolean
  droppedPayoffLinks: number
  mapping: PackedSceneAudit[]
}

export interface PackChapterResult {
  outline: ChapterOutline
  audit: ChapterScenePackingAudit
}

const PACKED_DESCRIPTION_PREFIX = "Packed from source scenes"

export function packChapterScenesToBudget(outline: ChapterOutline): PackChapterResult {
  const targetWords = outline.targetWords ?? 1000
  const budget = recommendedSceneCountForTarget(targetWords)
  const scenes = outline.scenes ?? []
  const sourceSceneCount = scenes.length

  // Each "group" represents one packed scene entry. Initially every source
  // entry is its own group.
  let groups: number[][] = scenes.map((_, idx) => [idx])

  const mustKeepIndices = sourceSceneCount > 0
    ? sourceSceneCount === 1 ? [0] : [0, sourceSceneCount - 1]
    : []
  const mustKeepCount = mustKeepIndices.length

  let budgetExceeded = false
  let noOp = false

  if (sourceSceneCount === 0 || sourceSceneCount <= budget) {
    noOp = true
  } else if (mustKeepCount > budget) {
    // Cannot satisfy budget without dropping anchors — keep every must-keep
    // entry (which here is just first + last) and merge the middle into one
    // group. budgetExceeded flags the result so the cohort report can flag
    // the arm even if it completes.
    budgetExceeded = true
    if (sourceSceneCount > 2) {
      groups = [[0], scenes.slice(1, -1).map((_, i) => i + 1), [sourceSceneCount - 1]]
    }
  } else {
    groups = mergeGroupsToBudget(groups, scenes, budget, mustKeepIndices)
  }

  const sourceIndexToGroup = new Map<number, number>()
  for (let g = 0; g < groups.length; g++) {
    for (const sourceIdx of groups[g]!) sourceIndexToGroup.set(sourceIdx, g)
  }

  const packedScenes: SceneBeat[] = []
  const auditMapping: PackedSceneAudit[] = []
  let droppedPayoffLinks = 0

  for (let g = 0; g < groups.length; g++) {
    const indices = groups[g]!
    const sourceScenes = indices.map(idx => scenes[idx]!)
    const obligationKeysBefore = sourceScenes.flatMap(beat => obligationKeysOf(beat))

    const merged = sourceScenes.length > 1
    const description = merged
      ? renderPackedDescription(indices, sourceScenes)
      : sourceScenes[0]!.description

    const remappedPayoffs = remapPayoffLinks(
      sourceScenes.flatMap(beat => beat.requiredPayoffs ?? []),
      sourceIndexToGroup,
      g,
    )
    droppedPayoffLinks += remappedPayoffs.dropped

    const remappedObligations = remapObligations(
      mergeObligations(sourceScenes.map(beat => beat.obligations)),
      sourceIndexToGroup,
    )

    const packed: SceneBeat = {
      ...sourceScenes[0]!,
      description,
      characters: unionStrings(sourceScenes.flatMap(beat => beat.characters ?? [])),
      kind: sourceScenes[0]!.kind,
      beatId: sourceScenes[0]!.beatId,
      requiredPayoffs: remappedPayoffs.links,
      obligations: remappedObligations,
      lifeValueAxes: unionStrings(sourceScenes.flatMap(beat => beat.lifeValueAxes ?? [])) as SceneBeat["lifeValueAxes"],
      miceActive: unionStrings(sourceScenes.flatMap(beat => beat.miceActive ?? [])) as SceneBeat["miceActive"],
      miceOpens: unionStrings(sourceScenes.flatMap(beat => beat.miceOpens ?? [])) as SceneBeat["miceOpens"],
      miceCloses: unionStrings(sourceScenes.flatMap(beat => beat.miceCloses ?? [])) as SceneBeat["miceCloses"],
      valueShifted: sourceScenes.some(beat => beat.valueShifted === true) ? true
        : sourceScenes.every(beat => beat.valueShifted === false) ? false
        : sourceScenes[0]!.valueShifted,
      gapPresent: sourceScenes.some(beat => beat.gapPresent === true) ? true
        : sourceScenes.every(beat => beat.gapPresent === false) ? false
        : sourceScenes[0]!.gapPresent,
    }
    packedScenes.push(packed)

    const obligationKeysAfter = obligationKeysOf(packed)
    const before = new Set(obligationKeysBefore)
    const after = new Set(obligationKeysAfter)
    const droppedObligationKeys = [...before].filter(key => !after.has(key))

    auditMapping.push({
      packedIndex: g,
      sourceIndices: indices.slice(),
      sourceSceneIds: sourceScenes.map(beat => beat.beatId ?? ""),
      obligationKeysBefore,
      obligationKeysAfter,
      droppedObligationKeys,
      merged,
    })
  }

  const openerPreserved = auditMapping.length > 0 && auditMapping[0]!.sourceIndices[0] === 0
  const endpointPreserved = auditMapping.length > 0 &&
    auditMapping[auditMapping.length - 1]!.sourceIndices.at(-1) === sourceSceneCount - 1

  const audit: ChapterScenePackingAudit = {
    chapterNumber: outline.chapterNumber,
    targetWords,
    budget,
    sourceSceneCount,
    packedSceneCount: packedScenes.length,
    noOp,
    budgetExceeded,
    endpointPreserved: sourceSceneCount === 0 ? true : endpointPreserved,
    openerPreserved: sourceSceneCount === 0 ? true : openerPreserved,
    droppedPayoffLinks,
    mapping: auditMapping,
  }

  return {
    outline: { ...outline, scenes: packedScenes },
    audit,
  }
}

function obligationDensityOfBeat(beat: SceneBeat): number {
  const obligations = beat.obligations
  return (
    (obligations?.mustEstablish?.length ?? 0) +
    (obligations?.mustPayOff?.length ?? 0) +
    (obligations?.mustTransferKnowledge?.length ?? 0) +
    (obligations?.mustShowStateChange?.length ?? 0) +
    (obligations?.mustNotReveal?.length ?? 0) +
    (beat.requiredPayoffs?.length ?? 0)
  )
}

function obligationDensityOfGroup(group: number[], scenes: SceneBeat[]): number {
  return group.reduce((sum, idx) => sum + obligationDensityOfBeat(scenes[idx]!), 0)
}

function mergeGroupsToBudget(
  initialGroups: number[][],
  scenes: SceneBeat[],
  budget: number,
  mustKeepIndices: number[],
): number[][] {
  const mustKeep = new Set(mustKeepIndices)
  const groups = initialGroups.map(group => group.slice())

  while (groups.length > budget) {
    let pickIndex = -1
    let pickScore = Number.POSITIVE_INFINITY
    let pickMergedSize = Number.POSITIVE_INFINITY

    for (let i = 0; i < groups.length - 1; i++) {
      const left = groups[i]!
      const right = groups[i + 1]!
      // A pair is mergeable iff at most one of the two groups contains a
      // must-keep source entry. Anchors merge into adjacent middle entries but
      // never into each other.
      const leftHasAnchor = left.some(idx => mustKeep.has(idx))
      const rightHasAnchor = right.some(idx => mustKeep.has(idx))
      if (leftHasAnchor && rightHasAnchor) continue

      const score = obligationDensityOfGroup(left, scenes) +
        obligationDensityOfGroup(right, scenes)
      const mergedSize = left.length + right.length
      // Primary: lowest combined obligation density. Secondary: smallest
      // resulting merged group, so tied scores spread merges across the
      // chapter rather than collapsing into a single front-loaded group.
      // Tertiary: lowest index for stable, deterministic output.
      const better = score < pickScore ||
        (score === pickScore && mergedSize < pickMergedSize)
      if (better) {
        pickScore = score
        pickMergedSize = mergedSize
        pickIndex = i
      }
    }

    // Defensive: with mustKeepCount <= budget there is always a mergeable
    // pair, but if invariants ever break we stop rather than spin.
    if (pickIndex === -1) break

    const merged = [...groups[pickIndex]!, ...groups[pickIndex + 1]!]
    groups.splice(pickIndex, 2, merged)
  }

  return groups
}

function renderPackedDescription(indices: number[], beats: SceneBeat[]): string {
  const first = (indices[0] ?? 0) + 1
  const last = (indices.at(-1) ?? 0) + 1
  const range = first === last ? `${first}` : `${first}-${last}`
  const bullets = beats
    .map(beat => `- ${beat.description.trim()}`)
    .join("\n")
  return `${PACKED_DESCRIPTION_PREFIX} ${range}:\n${bullets}`
}

function unionStrings<T extends string>(values: T[]): T[] {
  const seen = new Set<T>()
  const out: T[] = []
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

function mergeObligations(
  contracts: BeatObligationsContract[],
): BeatObligationsContract {
  return {
    mustEstablish: contracts.flatMap(c => c.mustEstablish ?? []),
    mustPayOff: contracts.flatMap(c => c.mustPayOff ?? []),
    mustTransferKnowledge: contracts.flatMap(c => c.mustTransferKnowledge ?? []),
    mustShowStateChange: contracts.flatMap(c => c.mustShowStateChange ?? []),
    mustNotReveal: contracts.flatMap(c => c.mustNotReveal ?? []),
    allowedNewEntities: unionStrings(contracts.flatMap(c => c.allowedNewEntities ?? [])),
  }
}

function remapObligations(
  contract: BeatObligationsContract,
  sourceIndexToGroup: Map<number, number>,
): BeatObligationsContract {
  const remapItem = <T extends { seededAtBeat?: number; untilBeat?: number }>(item: T): T => ({
    ...item,
    seededAtBeat: typeof item.seededAtBeat === "number"
      ? sourceIndexToGroup.get(item.seededAtBeat) ?? item.seededAtBeat
      : item.seededAtBeat,
    untilBeat: typeof item.untilBeat === "number"
      ? sourceIndexToGroup.get(item.untilBeat) ?? item.untilBeat
      : item.untilBeat,
  })
  return {
    mustEstablish: contract.mustEstablish.map(remapItem),
    mustPayOff: contract.mustPayOff.map(remapItem),
    mustTransferKnowledge: contract.mustTransferKnowledge.map(remapItem),
    mustShowStateChange: contract.mustShowStateChange.map(remapItem),
    mustNotReveal: contract.mustNotReveal.map(remapItem),
    allowedNewEntities: contract.allowedNewEntities.slice(),
  }
}

function remapPayoffLinks(
  links: PayoffLink[],
  sourceIndexToGroup: Map<number, number>,
  ownGroupIndex: number,
): { links: PayoffLink[]; dropped: number } {
  const remapped: PayoffLink[] = []
  let dropped = 0
  const seen = new Set<string>()
  for (const link of links) {
    const targetGroup = sourceIndexToGroup.get(link.payoff_beat) ?? link.payoff_beat
    // Drop self-payoffs (the source's payoff beat collapsed into its setup
    // beat) and any backward-pointing payoff that survives the remap.
    if (targetGroup <= ownGroupIndex) {
      dropped++
      continue
    }
    const key = `${link.fact_id}:${targetGroup}`
    if (seen.has(key)) continue
    seen.add(key)
    remapped.push({ fact_id: link.fact_id, payoff_beat: targetGroup })
  }
  return { links: remapped, dropped }
}

function obligationKeysOf(beat: SceneBeat): string[] {
  const keys: string[] = []
  const obligations = beat.obligations
  const collect = (kind: string, items: Array<{ obligationId?: string; sourceId?: string; text?: string }>) => {
    for (const item of items ?? []) {
      const id = item.obligationId ?? item.sourceId ?? `${kind}:${(item.text ?? "").slice(0, 40)}`
      keys.push(`${kind}:${id}`)
    }
  }
  collect("establish", obligations?.mustEstablish ?? [])
  collect("payoff", obligations?.mustPayOff ?? [])
  collect("knowledge", obligations?.mustTransferKnowledge ?? [])
  collect("state", obligations?.mustShowStateChange ?? [])
  collect("avoid", obligations?.mustNotReveal ?? [])
  for (const link of beat.requiredPayoffs ?? []) {
    keys.push(`payoff-link:${link.fact_id}`)
  }
  return keys
}
