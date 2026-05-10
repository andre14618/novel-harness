import type { ChapterOutline, SceneBeat, BeatObligationsContract } from "../../types"
import type { BeatObligationCoverageValidation } from "../../harness/beat-obligations"

interface BuildRepairContextArgs {
  outline: ChapterOutline
  validation: BeatObligationCoverageValidation
}

const OBLIGATION_LISTS = [
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
] as const

export function buildContext(args: BuildRepairContextArgs): string {
  const { outline, validation } = args
  return [
    `CHAPTER: ${outline.chapterNumber} ${outline.chapterId ?? "(missing-chapterId)"} — ${outline.title}`,
    "",
    "VALIDATION ERRORS:",
    validation.errors.map(error => `- ${error}`).join("\n") || "- none",
    "",
    "MISSING SOURCE IDS:",
    validation.missingSourceIds.map(id => `- ${id}`).join("\n") || "- none",
    "",
    "UNKNOWN OBLIGATION SOURCE IDS:",
    validation.unknownObligations.map(item => `- ${formatEntryRef(item)} list=${item.obligationKey} sourceId=${item.sourceId}`).join("\n") || "- none",
    "",
    "SOURCE REGISTRY:",
    renderSources(outline),
    "",
    "SCENES / LEGACY BEAT ENTRIES:",
    (outline.scenes ?? []).map(renderBeat).join("\n"),
    "",
    "EXISTING OBLIGATIONS:",
    (outline.scenes ?? []).map(renderBeatObligations).filter(Boolean).join("\n") || "- none",
    "",
    "Return only the minimal operations needed to make exact-ID obligation coverage pass.",
  ].join("\n")
}

function renderSources(outline: ChapterOutline): string {
  const lines: string[] = []
  for (const fact of outline.establishedFacts ?? []) {
    lines.push(`- kind=fact sourceId=${fact.id || "(missing-id)"} text=${fact.fact}`)
  }
  for (const change of outline.knowledgeChanges ?? []) {
    const id = (change as any).id ?? "(missing-id)"
    const characterId = (change as any).characterId ?? "(missing-characterId)"
    lines.push(`- kind=knowledge sourceId=${id} characterId=${characterId} character=${change.characterName} text=${change.knowledge}`)
  }
  for (const change of outline.characterStateChanges ?? []) {
    const id = (change as any).id ?? "(missing-id)"
    const characterId = (change as any).characterId ?? "(missing-characterId)"
    const state = [
      change.location ? `location=${change.location}` : "",
      change.emotionalState ? `state=${change.emotionalState}` : "",
      change.knows?.length ? `knows=${change.knows.join("; ")}` : "",
    ].filter(Boolean).join("; ") || "state changed"
    lines.push(`- kind=state sourceId=${id} characterId=${characterId} character=${change.name} text=${state}`)
  }
  return lines.join("\n") || "- none"
}

function renderBeat(beat: SceneBeat, index: number): string {
  return `- index=${index} sceneId=${beat.sceneId ?? "(missing-sceneId)"} beatId=${beat.beatId ?? "(none)"} kind=${beat.kind} characters=${(beat.characters ?? []).join(", ") || "none"}\n  description=${beat.description}`
}

function renderBeatObligations(beat: SceneBeat): string {
  const obligations = beat.obligations as BeatObligationsContract | undefined
  if (!obligations) return ""
  const lines: string[] = []
  for (const list of OBLIGATION_LISTS) {
    for (const item of obligations[list] ?? []) {
      lines.push(`- sceneId=${beat.sceneId ?? "(missing-sceneId)"} beatId=${beat.beatId ?? "(none)"} list=${list} obligationId=${(item as any).obligationId ?? "(missing-obligationId)"} sourceId=${(item as any).sourceId ?? "(missing-sourceId)"} sourceKind=${(item as any).sourceKind ?? "(missing-sourceKind)"} characterId=${(item as any).characterId ?? ""} text=${item.text}`)
    }
  }
  return lines.join("\n")
}

function formatEntryRef(item: { sceneId?: string; beatId?: string }): string {
  if (item.sceneId) return `sceneId=${item.sceneId}`
  if (item.beatId) return `beatId=${item.beatId}`
  return "sceneId=(missing-sceneId)"
}
