import {
  buildPlanReadinessDraftsFromAggregate,
  readinessTargetKey,
  type PlanReadinessImporterKind,
  type PlanReadinessTargetKind,
} from "./plan-readiness"
import {
  markStalePlanReadinessItems,
  markStalePlanReadinessItemsByImportRef,
  upsertPlanReadinessItems,
  type PlanReadinessItem,
} from "../db/plan-readiness"
import { loadPlanningTargetMap } from "./planning-targets"

export interface ImportPlanReadinessAggregateArgs {
  novelId: string
  aggregate: unknown
  importedByKind?: PlanReadinessImporterKind
  importedByRef?: string | null
  refreshStaleness?: boolean
  replaceExistingImport?: boolean
}

export interface ImportPlanReadinessAggregateResult {
  inserted: number
  updated: number
  staleReplaced: number
  skipped: Array<{ reason: string; target?: unknown }>
  items: PlanReadinessItem[]
}

export async function importPlanReadinessAggregateForNovel(
  args: ImportPlanReadinessAggregateArgs,
): Promise<ImportPlanReadinessAggregateResult> {
  const targetVersions = await loadReadinessTargetVersions(args.novelId)
  if (args.refreshStaleness ?? true) {
    await markStalePlanReadinessItems(args.novelId, targetVersionsForStaleness(targetVersions))
  }
  const built = buildPlanReadinessDraftsFromAggregate({
    novelId: args.novelId,
    aggregate: args.aggregate,
    targetVersions,
    importedByKind: args.importedByKind ?? "script",
    importedByRef: args.importedByRef ?? null,
  })
  const replaced = args.replaceExistingImport && args.importedByRef
    ? await markStalePlanReadinessItemsByImportRef(
      args.novelId,
      args.importedByRef,
      built.drafts.map(draft => draft.id),
    )
    : { staleCount: 0, staleIds: [] }
  const result = await upsertPlanReadinessItems(built.drafts)
  return {
    inserted: result.inserted,
    updated: result.updated,
    staleReplaced: replaced.staleCount,
    skipped: built.skipped,
    items: result.items,
  }
}

export async function loadReadinessTargetVersions(novelId: string): Promise<Map<string, string>> {
  const map = await loadPlanningTargetMap(novelId)
  const out = new Map<string, string>()
  for (const target of map.targets) {
    if (target.kind === "beat_obligation") {
      setReadinessVersion(out, target.kind, target.ref, target.currentVersion)
    } else if (target.kind === "chapter_outline" || target.kind === "beat_plan") {
      setReadinessVersion(out, target.kind, target.ref, target.currentVersion)
      if (target.kind === "beat_plan") {
        setReadinessVersion(out, "scene_plan", target.ref, target.currentVersion)
      }
    } else if (target.kind === "scene_plan") {
      setReadinessVersion(out, target.kind, target.ref, target.currentVersion)
      setReadinessVersion(out, "beat_plan", target.ref, target.currentVersion)
      if (target.location?.beatId && target.location.beatId !== target.ref) {
        setReadinessVersion(out, "scene_plan", target.location.beatId, target.currentVersion)
        setReadinessVersion(out, "beat_plan", target.location.beatId, target.currentVersion)
      }
      if (target.location?.sceneId && target.location.sceneId !== target.ref) {
        setReadinessVersion(out, "scene_plan", target.location.sceneId, target.currentVersion)
        setReadinessVersion(out, "beat_plan", target.location.sceneId, target.currentVersion)
      }
    }
  }
  return out
}

function setReadinessVersion(
  out: Map<string, string>,
  kind: PlanReadinessTargetKind,
  ref: string,
  sourceHash: string,
): void {
  out.set(readinessTargetKey({ kind, ref }), sourceHash)
}

export function targetVersionsForStaleness(
  targetVersions: Map<string, string>,
): Array<{ targetKind: PlanReadinessTargetKind; targetRef: string; sourceHash: string }> {
  const out: Array<{ targetKind: PlanReadinessTargetKind; targetRef: string; sourceHash: string }> = []
  for (const [key, sourceHash] of targetVersions.entries()) {
    const [targetKind, ...rest] = key.split(":")
    if (
      targetKind !== "chapter_outline" &&
      targetKind !== "scene_plan" &&
      targetKind !== "beat_plan" &&
      targetKind !== "beat_obligation"
    ) continue
    out.push({ targetKind: targetKind as PlanReadinessTargetKind, targetRef: rest.join(":"), sourceHash })
  }
  return out
}
