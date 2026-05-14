import { computePlanningSnapshotHash } from "../canon/planning-snapshot"
import { stableHash } from "../canon/proposal-envelope"
import { getNovel } from "../db/novels"
import { getChapterOutlines } from "../db/outlines"
import { getCharacters, getStorySpine, getWorldBible } from "../db/world"
import { getCultures, getWorldSystems, type Culture, type WorldSystem } from "../db/world-systems"
import {
  listProposalEnvelopeTargetSummaries,
  type ProposalEnvelopeTargetSummary,
} from "../db/proposal-envelopes"
import {
  listProposalResolutionImpactsByTargetRefs,
  type ProposalResolutionImpact,
} from "../db/proposal-resolution-outcomes"
import {
  listPlanningMutationLineageForRefs,
  type PlanningMutationLineage,
} from "../db/planning-mutation-lineage"
import {
  ALLOWED_BEAT_OBLIGATION_FIELD_PATHS,
  ALLOWED_BEAT_PLAN_FIELD_PATHS,
  ALLOWED_STORY_SPINE_FIELD_PATHS,
  ALLOWED_WORLD_BIBLE_FIELD_PATHS,
} from "../canon/planning-edit-proposal"
import { validateBeatObligationCoverage } from "./beat-obligations"
import { enrichOutlineIds } from "./ids"
import type {
  CharacterProfile,
  ChapterOutline,
  SeedInput,
  StorySpine,
  WorldBible,
} from "../types"

export const PLANNING_TARGET_KINDS = [
  "planning_directive",
  "world_bible",
  "world_fact",
  "world_system",
  "culture",
  "character",
  "story_spine",
  "chapter_outline",
  "scene_plan",
  "beat_plan",
  "beat_obligation",
] as const

export type PlanningTargetKind = (typeof PLANNING_TARGET_KINDS)[number]

export interface PlanningTargetRef {
  kind: PlanningTargetKind
  ref: string
  fieldPath?: string
}

export interface PlanningTargetValidationFinding {
  severity: "warning" | "error"
  code: string
  message: string
  path?: string
}

export interface PlanningTargetLocation {
  chapterNumber?: number
  chapterId?: string
  beatIndex?: number
  sceneId?: string
  beatId?: string
}

export interface PlanningTarget {
  kind: PlanningTargetKind
  ref: string
  label: string
  fieldPaths: string[]
  currentVersion: string
  inSnapshot: boolean
  location?: PlanningTargetLocation
  upstreamRefs: PlanningTargetRef[]
  validationFindings: PlanningTargetValidationFinding[]
}

export interface PlanningTargetMap {
  ok: true
  novelId: string
  planningSnapshotVersion: "v2"
  planningSnapshotHash: string
  targets: PlanningTarget[]
  validationFindings: PlanningTargetValidationFinding[]
}

export type PlanningImpactKind =
  | "direct_target"
  | "snapshot_participation"
  | "chapter_reference"
  | "beat_reference"
  | "obligation_reference"
  | "proposal_target"
  | "resolution_impact"
  | "mutation_lineage"

export interface PlanningImpact {
  kind: PlanningImpactKind
  reason: string
  target: PlanningTargetRef
  location?: PlanningTargetLocation
  metadata?: Record<string, unknown>
}

export interface PlanningImpactPreview {
  ok: true
  novelId: string
  planningSnapshotVersion: "v2"
  planningSnapshotHash: string
  target: PlanningTarget
  impacts: PlanningImpact[]
  relatedProposalEnvelopes: ProposalEnvelopeTargetSummary[]
  relatedResolutionImpacts: ProposalResolutionImpact[]
  relatedMutationLineage: PlanningMutationLineage[]
}

export class PlanningTargetLookupError extends Error {
  readonly status: number
  constructor(message: string, status = 404) {
    super(message)
    this.name = "PlanningTargetLookupError"
    this.status = status
  }
}

interface PlanningArtifacts {
  novelId: string
  seed: SeedInput | null
  world: WorldBible | null
  characters: CharacterProfile[]
  spine: StorySpine | null
  outlines: ChapterOutline[]
  worldSystems: WorldSystem[]
  cultures: Culture[]
  planningSnapshotHash: string
}

export async function loadPlanningTargetMap(novelId: string): Promise<PlanningTargetMap> {
  const novel = await getNovel(novelId).catch((err) => {
    throw new PlanningTargetLookupError(String(err), 404)
  })
  const world = await getWorldBible(novelId).catch(() => null)
  const characters = await getCharacters(novelId).catch(() => [])
  const spine = await getStorySpine(novelId).catch(() => null)
  const outlines = await getChapterOutlines(novelId).catch(() => [])
  const worldSystems = await getWorldSystems(novelId).catch(() => [])
  const cultures = await getCultures(novelId).catch(() => [])
  const planningSnapshotHash = await computePlanningSnapshotHash(novelId, "v2")

  return buildPlanningTargetMap({
    novelId,
    seed: novel.seed,
    world,
    characters,
    spine,
    outlines,
    worldSystems,
    cultures,
    planningSnapshotHash,
  })
}

export async function previewPlanningImpact(
  novelId: string,
  requested: PlanningTargetRef,
): Promise<PlanningImpactPreview> {
  const targetMap = await loadPlanningTargetMap(novelId)
  const target = findTarget(targetMap.targets, requested)
  if (!target) {
    throw new PlanningTargetLookupError(
      `planning target not found: ${requested.kind}:${requested.ref}`,
      404,
    )
  }

  const targetRefs = impactTargetRefs(target)
  const relatedProposalEnvelopes = []
  const seenProposalIds = new Set<string>()
  const proposalRefs = new Set([target.ref, requested.ref])
  for (const kind of planningTargetKindAliasesForLookup(requested.kind)) {
    for (const ref of proposalRefs) {
      const summaries = await listProposalEnvelopeTargetSummaries(novelId, { kind, ref })
      for (const summary of summaries) {
        if (seenProposalIds.has(summary.id)) continue
        seenProposalIds.add(summary.id)
        relatedProposalEnvelopes.push(summary)
      }
    }
  }
  const relatedResolutionImpacts = await listProposalResolutionImpactsByTargetRefs(novelId, targetRefs)
  const relatedMutationLineage = await listPlanningMutationLineageForRefs(novelId, targetRefs)

  const impacts = buildDeterministicImpacts(targetMap, target)
  for (const proposal of relatedProposalEnvelopes) {
    impacts.push({
      kind: "proposal_target",
      target: { kind: target.kind, ref: target.ref },
      reason: `proposal envelope ${proposal.id} targets this artifact`,
      metadata: {
        proposalId: proposal.id,
        proposalKind: proposal.kind,
        status: proposal.status,
        risk: proposal.risk,
      },
    })
  }
  for (const impact of relatedResolutionImpacts) {
    impacts.push({
      kind: "resolution_impact",
      target: { kind: target.kind, ref: target.ref },
      reason: `resolved proposal ${impact.proposalId} recorded ${impact.targetKind} impact`,
      location: impact.chapterNumber != null ? { chapterNumber: impact.chapterNumber } : undefined,
      metadata: {
        proposalId: impact.proposalId,
        proposalKind: impact.proposalKind,
        sourceTable: impact.sourceTable,
        impactTargetKind: impact.targetKind,
        impactTargetRef: impact.targetRef,
        priorHash: impact.priorHash,
        resultHash: impact.resultHash,
        resultVersion: impact.resultVersion,
      },
    })
  }
  for (const lineage of relatedMutationLineage) {
    impacts.push({
      kind: "mutation_lineage",
      target: {
        kind: planningTargetKindOrDefault(lineage.targetKind, target.kind),
        ref: lineage.nextRef,
        ...(lineage.fieldPath ? { fieldPath: lineage.fieldPath } : {}),
      },
      reason: `planning mutation ${lineage.proposalId} changed ${lineage.targetKind}:${lineage.previousRef}`,
      metadata: {
        proposalId: lineage.proposalId,
        actorKind: lineage.actorKind,
        previousRef: lineage.previousRef,
        nextRef: lineage.nextRef,
        fieldPath: lineage.fieldPath,
        previousVersion: lineage.previousVersion,
        nextVersion: lineage.nextVersion,
        changedAt: lineage.changedAt,
      },
    })
  }

  return {
    ok: true,
    novelId,
    planningSnapshotVersion: "v2",
    planningSnapshotHash: targetMap.planningSnapshotHash,
    target,
    impacts: dedupeImpacts(impacts),
    relatedProposalEnvelopes,
    relatedResolutionImpacts,
    relatedMutationLineage,
  }
}

export function buildPlanningTargetMap(artifacts: PlanningArtifacts): PlanningTargetMap {
  const targets = new Map<string, PlanningTarget>()
  const globalFindings: PlanningTargetValidationFinding[] = []

  const addTarget = (target: PlanningTarget): void => {
    targets.set(targetKey(target), {
      ...target,
      fieldPaths: [...new Set(target.fieldPaths)].sort(),
      upstreamRefs: dedupeRefs(target.upstreamRefs),
      validationFindings: [...target.validationFindings],
    })
  }
  const addFinding = (
    target: PlanningTarget,
    finding: PlanningTargetValidationFinding,
  ): void => {
    target.validationFindings.push(finding)
    globalFindings.push(finding)
  }

  if (artifacts.seed?.directives) {
    for (const [key, value] of Object.entries(artifacts.seed.directives as Record<string, unknown>)) {
      addTarget({
        kind: "planning_directive",
        ref: key,
        label: `Planning directive: ${key}`,
        fieldPaths: [key],
        currentVersion: stableHash(value ?? null),
        inSnapshot: false,
        upstreamRefs: [],
        validationFindings: [],
      })
    }
  }

  if (artifacts.world) {
    addTarget({
      kind: "world_bible",
      ref: artifacts.novelId,
      label: "World bible",
      fieldPaths: [...ALLOWED_WORLD_BIBLE_FIELD_PATHS],
      currentVersion: stableHash(artifacts.world),
      inSnapshot: true,
      upstreamRefs: [],
      validationFindings: [],
    })
  }

  if (artifacts.spine) {
    addTarget({
      kind: "story_spine",
      ref: artifacts.novelId,
      label: "Story spine",
      fieldPaths: [...ALLOWED_STORY_SPINE_FIELD_PATHS],
      currentVersion: stableHash(artifacts.spine),
      inSnapshot: true,
      upstreamRefs: [],
      validationFindings: [],
    })
  }

  for (const character of artifacts.characters) {
    addTarget({
      kind: "character",
      ref: character.id,
      label: `Character: ${character.name}`,
      fieldPaths: objectFieldPaths(character).filter((path) => path !== "id"),
      currentVersion: stableHash(character),
      inSnapshot: true,
      upstreamRefs: [],
      validationFindings: [],
    })
  }

  for (const system of artifacts.worldSystems) {
    addTarget({
      kind: "world_system",
      ref: system.id,
      label: `World system: ${system.name}`,
      fieldPaths: objectFieldPaths(system).filter((path) => path !== "id"),
      currentVersion: stableHash(system),
      inSnapshot: true,
      upstreamRefs: [{ kind: "world_bible", ref: artifacts.novelId }],
      validationFindings: [],
    })
  }

  for (const culture of artifacts.cultures) {
    addTarget({
      kind: "culture",
      ref: culture.id,
      label: `Culture: ${culture.name}`,
      fieldPaths: objectFieldPaths(culture).filter((path) => path !== "id"),
      currentVersion: stableHash(culture),
      inSnapshot: true,
      upstreamRefs: [{ kind: "world_bible", ref: artifacts.novelId }],
      validationFindings: [],
    })
  }

  for (const rawOutline of artifacts.outlines) {
    const outline = clone(rawOutline)
    const missingChapterId = !rawOutline.chapterId
    const missingSceneIds = (rawOutline.scenes ?? []).map((beat) => !beat.sceneId)
    const missingObligationIds = collectMissingObligationIds(rawOutline)
    const enrichment = enrichOutlineIds(outline)

    const outlineTarget: PlanningTarget = {
      kind: "chapter_outline",
      ref: outline.chapterId ?? `chapter-${outline.chapterNumber}`,
      label: `Chapter ${outline.chapterNumber}: ${outline.title}`,
      fieldPaths: objectFieldPaths(outline).filter((path) => path !== "chapterId"),
      currentVersion: stableHash(outline),
      inSnapshot: true,
      location: {
        chapterNumber: outline.chapterNumber,
        chapterId: outline.chapterId,
      },
      upstreamRefs: [
        ...idsToRefs(outline.charactersPresentIds, "character"),
        ...(outline.povCharacterId ? [{ kind: "character" as const, ref: outline.povCharacterId }] : []),
      ],
      validationFindings: [],
    }
    if (missingChapterId) {
      addFinding(outlineTarget, {
        severity: "warning",
        code: "missing-persisted-chapter-id",
        message: "Persisted outline was missing chapterId; target ref was synthesized in memory.",
        path: "chapterId",
      })
    }

    const coverage = validateBeatObligationCoverage(clone(outline))
    for (const error of coverage.errors) {
      addFinding(outlineTarget, {
        severity: "error",
        code: "beat-obligation-coverage",
        message: error,
      })
    }
    for (const warning of coverage.warnings) {
      addFinding(outlineTarget, {
        severity: "warning",
        code: "beat-obligation-warning",
        message: warning,
      })
    }
    for (const failure of enrichment.obligationLinkFailures) {
      addFinding(outlineTarget, {
        severity: "error",
        code: "missing-obligation-source-id",
        message: failure.reason,
        path: `scenes.${failure.sceneId ?? failure.beatId ?? "unknown-entry"}.obligations.${failure.obligationKey}.${failure.obligationIndex}`,
      })
    }
    addTarget(outlineTarget)

    for (const fact of outline.establishedFacts ?? []) {
      if (!fact.id) continue
      addTarget({
        kind: "world_fact",
        ref: fact.id,
        label: `Chapter ${outline.chapterNumber} fact: ${fact.fact}`,
        fieldPaths: ["fact", "category", "factStatus"],
        currentVersion: stableHash(fact),
        inSnapshot: true,
        location: {
          chapterNumber: outline.chapterNumber,
          chapterId: outline.chapterId,
        },
        upstreamRefs: [{ kind: "chapter_outline", ref: outlineTarget.ref }],
        validationFindings: [],
      })
    }

    for (let beatIndex = 0; beatIndex < (outline.scenes ?? []).length; beatIndex++) {
      const beat = outline.scenes[beatIndex]
      const sceneRef = beat.sceneId ?? beat.beatId ?? `${outlineTarget.ref}-scene-${beatIndex + 1}`
      const beatTarget: PlanningTarget = {
        kind: "scene_plan",
        ref: sceneRef,
        label: `Chapter ${outline.chapterNumber}, scene ${beatIndex + 1}`,
        fieldPaths: scenePlanFieldPaths(beat),
        currentVersion: stableHash(beat),
        inSnapshot: true,
        location: {
          chapterNumber: outline.chapterNumber,
          chapterId: outline.chapterId,
          beatIndex,
          sceneId: beat.sceneId,
          ...(beat.beatId ? { beatId: beat.beatId } : {}),
        },
        upstreamRefs: [
          { kind: "chapter_outline", ref: outlineTarget.ref },
          ...collectBeatSourceRefs(beat),
        ],
        validationFindings: [],
      }
      if (missingSceneIds[beatIndex]) {
        addFinding(beatTarget, {
          severity: "warning",
          code: "missing-persisted-scene-id",
          message: "Persisted scene entry was missing sceneId; target ref was synthesized in memory.",
          path: `scenes.${beatIndex}.sceneId`,
        })
      }
      addTarget(beatTarget)

      forEachObligation(beat, (item, key, itemIndex) => {
        const obligationId = typeof item.obligationId === "string" ? item.obligationId : undefined
        if (!obligationId) return
        const obligationTarget: PlanningTarget = {
          kind: "beat_obligation",
          ref: obligationId,
          label: `Chapter ${outline.chapterNumber}, scene ${beatIndex + 1} ${key}`,
          fieldPaths: [...ALLOWED_BEAT_OBLIGATION_FIELD_PATHS],
          currentVersion: stableHash(item),
          inSnapshot: true,
          location: {
            chapterNumber: outline.chapterNumber,
            chapterId: outline.chapterId,
            beatIndex,
            sceneId: beat.sceneId,
            ...(beat.beatId ? { beatId: beat.beatId } : {}),
          },
          upstreamRefs: [
            { kind: "scene_plan", ref: beatTarget.ref },
            ...sourceRefForObligation(item),
          ],
          validationFindings: [],
        }
        if (missingObligationIds.has(obligationPath(beatIndex, key, itemIndex))) {
          addFinding(obligationTarget, {
            severity: "warning",
            code: "missing-persisted-obligation-id",
            message: "Persisted obligation was missing obligationId; target ref was synthesized in memory.",
            path: `scenes.${beatIndex}.obligations.${key}.${itemIndex}.obligationId`,
          })
        }
        if (!item.sourceId && key !== "mustNotReveal") {
          addFinding(obligationTarget, {
            severity: "error",
            code: "missing-obligation-source-id",
            message: "Obligation has no sourceId, so impact can only be traced to the containing scene entry.",
            path: `scenes.${beatIndex}.obligations.${key}.${itemIndex}.sourceId`,
          })
        }
        addTarget(obligationTarget)
      })
    }
  }

  return {
    ok: true,
    novelId: artifacts.novelId,
    planningSnapshotVersion: "v2",
    planningSnapshotHash: artifacts.planningSnapshotHash,
    targets: Array.from(targets.values()).sort(compareTargets),
    validationFindings: globalFindings,
  }
}

function buildDeterministicImpacts(
  targetMap: PlanningTargetMap,
  target: PlanningTarget,
): PlanningImpact[] {
  const impacts: PlanningImpact[] = [
    {
      kind: "direct_target",
      target: { kind: target.kind, ref: target.ref },
      reason: "requested planning target",
      location: target.location,
    },
  ]

  if (target.inSnapshot) {
    impacts.push({
      kind: "snapshot_participation",
      target: { kind: target.kind, ref: target.ref },
      reason: "target participates in the current planning snapshot hash",
      metadata: {
        planningSnapshotVersion: targetMap.planningSnapshotVersion,
        planningSnapshotHash: targetMap.planningSnapshotHash,
      },
    })
  }

  for (const candidate of targetMap.targets) {
    if (planningTargetRefsSameArtifact(candidate, target)) continue
    const referenced = candidate.upstreamRefs.some(
      (ref) => planningTargetRefsSameArtifact(ref, target),
    )
    if (!referenced) continue
    impacts.push({
      kind: impactKindForCandidate(candidate.kind),
      target: { kind: candidate.kind, ref: candidate.ref },
      reason: `${candidate.kind} references ${target.kind}:${target.ref}`,
      location: candidate.location,
      metadata: { label: candidate.label },
    })
  }

  return dedupeImpacts(impacts)
}

function impactKindForCandidate(kind: PlanningTargetKind): PlanningImpactKind {
  switch (kind) {
    case "chapter_outline":
      return "chapter_reference"
    case "beat_plan":
      return "beat_reference"
    case "scene_plan":
      return "beat_reference"
    case "beat_obligation":
      return "obligation_reference"
    default:
      return "direct_target"
  }
}

function findTarget(
  targets: readonly PlanningTarget[],
  requested: PlanningTargetRef,
): PlanningTarget | null {
  const target = targets.find((candidate) =>
    planningTargetKindsSameArtifact(candidate.kind, requested.kind) &&
    planningTargetRefMatches(candidate, requested) &&
    (requested.fieldPath === undefined || candidate.fieldPaths.includes(requested.fieldPath))
  ) ?? null
  if (!target) return null
  if (requested.kind === "scene_plan" && target.kind === "beat_plan") {
    return {
      ...target,
      kind: "scene_plan",
      label: target.label.replace(/\bbeat\b/iu, "scene"),
      upstreamRefs: target.upstreamRefs.map((ref) =>
        ref.kind === "beat_plan" && ref.ref === target.ref
          ? { ...ref, kind: "scene_plan" as const }
          : ref
      ),
    }
  }
  return target
}

function planningTargetRefMatches(
  candidate: PlanningTarget,
  requested: PlanningTargetRef,
): boolean {
  if (candidate.ref === requested.ref) return true
  if (!planningTargetKindsSameArtifact(candidate.kind, requested.kind)) return false
  if (requested.kind !== "scene_plan" && requested.kind !== "beat_plan") return false
  return candidate.location?.sceneId === requested.ref || candidate.location?.beatId === requested.ref
}

function planningTargetRefsSameArtifact(
  a: Pick<PlanningTargetRef, "kind" | "ref">,
  b: Pick<PlanningTargetRef, "kind" | "ref">,
): boolean {
  return planningTargetKindsSameArtifact(a.kind, b.kind) && a.ref === b.ref
}

function planningTargetKindsSameArtifact(a: string, b: string): boolean {
  return a === b ||
    ((a === "scene_plan" || a === "beat_plan") && (b === "scene_plan" || b === "beat_plan"))
}

function planningTargetKindAliasesForLookup(kind: string): string[] {
  if (kind === "scene_plan") return ["scene_plan", "beat_plan"]
  if (kind === "beat_plan") return ["beat_plan", "scene_plan"]
  return [kind]
}

function compareTargets(a: PlanningTarget, b: PlanningTarget): number {
  return (
    a.kind.localeCompare(b.kind) ||
    (a.location?.chapterNumber ?? 0) - (b.location?.chapterNumber ?? 0) ||
    (a.location?.beatIndex ?? -1) - (b.location?.beatIndex ?? -1) ||
    a.ref.localeCompare(b.ref)
  )
}

function targetKey(target: Pick<PlanningTarget, "kind" | "ref">): string {
  return `${target.kind}:${target.ref}`
}

function objectFieldPaths(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return []
  return Object.keys(value as Record<string, unknown>).sort()
}

function scenePlanFieldPaths(scene: unknown): string[] {
  const fields = new Set([
    ...objectFieldPaths(scene).filter((path) => path !== "sceneId" && path !== "beatId"),
    ...ALLOWED_BEAT_PLAN_FIELD_PATHS,
  ])
  return [...fields].sort()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function idsToRefs(
  ids: readonly string[] | undefined,
  kind: PlanningTargetKind,
): PlanningTargetRef[] {
  return (ids ?? []).filter(Boolean).map((ref) => ({ kind, ref }))
}

const OBLIGATION_KEYS = [
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
  "mustNotReveal",
] as const

type ObligationKey = (typeof OBLIGATION_KEYS)[number]

function forEachObligation(
  beat: { obligations?: Record<string, unknown> },
  fn: (item: Record<string, unknown>, key: ObligationKey, itemIndex: number) => void,
): void {
  const obligations = beat.obligations
  if (!obligations) return
  for (const key of OBLIGATION_KEYS) {
    const list = obligations[key]
    if (!Array.isArray(list)) continue
    for (let index = 0; index < list.length; index++) {
      const item = list[index]
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        fn(item as Record<string, unknown>, key, index)
      }
    }
  }
}

function collectMissingObligationIds(outline: ChapterOutline): Set<string> {
  const missing = new Set<string>()
  for (let beatIndex = 0; beatIndex < (outline.scenes ?? []).length; beatIndex++) {
    forEachObligation(outline.scenes[beatIndex], (item, key, itemIndex) => {
      if (!item.obligationId) missing.add(obligationPath(beatIndex, key, itemIndex))
    })
  }
  return missing
}

function obligationPath(beatIndex: number, key: ObligationKey, itemIndex: number): string {
  return `${beatIndex}:${key}:${itemIndex}`
}

function collectBeatSourceRefs(beat: { obligations?: Record<string, unknown> }): PlanningTargetRef[] {
  const refs: PlanningTargetRef[] = []
  forEachObligation(beat, (item) => {
    refs.push(...sourceRefForObligation(item))
    const characterId = typeof item.characterId === "string" ? item.characterId : undefined
    if (characterId) refs.push({ kind: "character", ref: characterId })
  })
  return dedupeRefs(refs)
}

function sourceRefForObligation(item: Record<string, unknown>): PlanningTargetRef[] {
  const sourceId = typeof item.sourceId === "string" ? item.sourceId : undefined
  const sourceKind = typeof item.sourceKind === "string" ? item.sourceKind : undefined
  if (!sourceId) return []
  if (sourceKind === "fact" || sourceKind === "payoff") {
    return [{ kind: "world_fact", ref: sourceId }]
  }
  if (sourceKind === "knowledge" || sourceKind === "state") {
    const characterId = typeof item.characterId === "string" ? item.characterId : undefined
    return characterId ? [{ kind: "character", ref: characterId }] : []
  }
  return []
}

function dedupeRefs(refs: readonly PlanningTargetRef[]): PlanningTargetRef[] {
  const seen = new Set<string>()
  const out: PlanningTargetRef[] = []
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.ref}:${ref.fieldPath ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref))
}

function dedupeImpacts(impacts: readonly PlanningImpact[]): PlanningImpact[] {
  const seen = new Set<string>()
  const out: PlanningImpact[] = []
  for (const impact of impacts) {
    const key = [
      impact.kind,
      impact.target.kind,
      impact.target.ref,
      impact.location?.chapterNumber ?? "",
      impact.location?.beatIndex ?? "",
      impact.reason,
      String(impact.metadata?.proposalId ?? ""),
    ].join("|")
    if (seen.has(key)) continue
    seen.add(key)
    out.push(impact)
  }
  return out
}

function impactTargetRefs(target: PlanningTarget): string[] {
  switch (target.kind) {
    case "character":
      return [target.ref, `character:${target.ref}`]
    case "world_bible":
      return [target.ref, "world_bible"]
    case "story_spine":
      return [target.ref, "story_spine"]
    case "scene_plan":
      return [target.ref, `scene_plan:${target.ref}`, `beat_plan:${target.ref}`]
    case "beat_plan":
      return [target.ref, `beat_plan:${target.ref}`, `scene_plan:${target.ref}`]
    default:
      return [target.ref, `${target.kind}:${target.ref}`]
  }
}

function planningTargetKindOrDefault(
  kind: string,
  fallback: PlanningTargetKind,
): PlanningTargetKind {
  return (PLANNING_TARGET_KINDS as readonly string[]).includes(kind)
    ? kind as PlanningTargetKind
    : fallback
}
