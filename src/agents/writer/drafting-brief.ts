import type { BeatContext, CharacterSnapshot, SceneContractBlock, SettingBlock } from "./beat-context"
import { renderCharacterContextCapsules } from "./character-context"
import type { WriterPromptIdRendering } from "./context-mode"

export type WriterDraftingBriefMode = "off" | "scene-budget-v1" | "scene-turn-v1" | "scene-turn-anchored-v1"

export interface WriterDraftingBriefTrace {
  mode: WriterDraftingBriefMode
  selectedPromptChars: number
  fullContextPromptChars: number
  targetWords: number
  charsDelta: number
  charsRatio: number
  sections: {
    sceneContract: boolean
    obligations: boolean
    transitionBridge: boolean
    landingTarget: boolean
    factContinuityAnchors: boolean
    characterSnapshots: boolean
    characterContextCapsules: boolean
    resolvedReferences: boolean
    readerInfoState: boolean
    setting: boolean
  }
  counts: {
    characters: number
    obligations: number
    sceneContractFields: number
    choiceAlternatives: number
  }
}

export interface SelectWriterPromptInput {
  ctx: BeatContext
  mode: WriterDraftingBriefMode
  fullContextPrompt: string
  targetWords: number
  idRendering?: WriterPromptIdRendering
}

export function selectWriterPromptForDraftingBrief(input: SelectWriterPromptInput): {
  userPrompt: string
  draftingBriefTrace: WriterDraftingBriefTrace
} {
  const userPrompt = input.mode === "scene-budget-v1"
    || input.mode === "scene-turn-v1"
    || input.mode === "scene-turn-anchored-v1"
    ? renderWriterDraftingBrief(input.ctx, {
        targetWords: input.targetWords,
        idRendering: input.idRendering,
        mode: input.mode,
      })
    : input.fullContextPrompt

  return {
    userPrompt,
    draftingBriefTrace: summarizeWriterDraftingBrief({
      ctx: input.ctx,
      mode: input.mode,
      selectedPrompt: userPrompt,
      fullContextPrompt: input.fullContextPrompt,
      targetWords: input.targetWords,
    }),
  }
}

export function renderWriterDraftingBrief(
  ctx: BeatContext,
  opts: { targetWords: number; idRendering?: WriterPromptIdRendering; mode?: WriterDraftingBriefMode },
): string {
  const sections: string[] = [
    renderBriefHeader(ctx, opts),
  ]

  if (opts.mode === "scene-turn-v1" || opts.mode === "scene-turn-anchored-v1") {
    sections.push(renderSceneExecutionFloor(opts.mode))
  }

  if (ctx.sceneContract) sections.push(renderSceneContractBrief(ctx.sceneContract, opts.mode))

  const obligations = renderObligationsBrief(ctx.beatSpec.obligations, opts.idRendering)
  if (obligations) sections.push(`OBLIGATIONS:\n${obligations}`)

  if (opts.mode === "scene-turn-anchored-v1") {
    const factContinuityAnchors = renderFactContinuityAnchors(ctx)
    if (factContinuityAnchors) sections.push(factContinuityAnchors)
  }

  const continuityAnchors = renderContinuityAnchors(ctx)
  if (continuityAnchors) sections.push(continuityAnchors)

  if (ctx.characterSnapshots.length > 0) {
    sections.push(renderCharacterSectionBrief(ctx.characterSnapshots, opts.mode))
  }

  if (ctx.characterContextCapsules) {
    sections.push(renderCharacterContextCapsules(ctx.characterContextCapsules, { idRendering: opts.idRendering }))
  }

  if (ctx.resolvedReferencesText) sections.push(ctx.resolvedReferencesText)
  if (ctx.readerInfoState) sections.push(ctx.readerInfoState)

  const setting = ctx.setting ? renderSettingBrief(ctx.setting) : null
  if (setting) sections.push(setting)

  return sections.filter(Boolean).join("\n\n")
}

function renderBriefHeader(
  ctx: BeatContext,
  opts: { targetWords: number; idRendering?: WriterPromptIdRendering },
): string {
  const spec = ctx.beatSpec
  const showIds = (opts.idRendering ?? "raw") === "raw"
  const lines = [
    "WRITER DRAFTING BRIEF",
    `Scene: ${spec.beatNumber} of ${spec.totalBeats}`,
    `Budget: about ${opts.targetWords} words`,
    `POV: ${spec.pov}`,
    `Setting: ${spec.setting}`,
    `Kind: ${spec.kind}`,
  ]
  if (showIds && spec.sceneId) lines.push(`Scene ID: ${spec.sceneId}`)
  if (showIds && spec.beatId) lines.push(`Beat ID: ${spec.beatId}`)
  lines.push("")
  lines.push(`Task: ${spec.description}`)
  if (spec.charactersPresent.length > 0) {
    lines.push(`Characters present: ${spec.charactersPresent.join(", ")}`)
  }
  return lines.join("\n")
}

function renderSceneExecutionFloor(mode: WriterDraftingBriefMode | undefined): string {
  const lines = [
    "SCENE EXECUTION FLOOR:",
    "- Write a complete scene turn, not a summary of required events.",
    "- Put the pressure, choice/turn, outcome, and consequence on the page.",
    "- Make present characters materially specific through action, dialogue, interiority, or changed behavior.",
  ]
  if (mode === "scene-turn-anchored-v1") {
    lines.push("- Preserve declared timing, location, and fact constraints; do not move future events earlier for convenience.")
  }
  return lines.join("\n")
}

function renderSceneContractBrief(scene: SceneContractBlock, mode: WriterDraftingBriefMode | undefined): string {
  const lines = [
    mode === "scene-turn-v1"
      ? "SCENE CONTRACT (dramatize this shape on-page):"
      : "SCENE CONTRACT:",
  ]
  if (scene.temporalAnchor) lines.push(`- Time: ${scene.temporalAnchor}`)
  if (scene.placeAnchor) lines.push(`- Place: ${scene.placeAnchor}`)
  if (scene.goal) lines.push(`- Goal: ${scene.goal}`)
  if (scene.opposition) lines.push(`- Opposition: ${scene.opposition}`)
  if (scene.turningPoint) lines.push(`- Turning point: ${scene.turningPoint}`)
  if (scene.crisisChoice) lines.push(`- Crisis choice: ${scene.crisisChoice}`)
  if (scene.choiceAlternatives.length > 0) {
    lines.push("- Choice alternatives:")
    for (const alt of scene.choiceAlternatives) lines.push(`  - ${alt}`)
  }
  if (scene.outcome) lines.push(`- Outcome: ${scene.outcome}`)
  if (scene.consequence) lines.push(`- Consequence: ${scene.consequence}`)
  if (scene.povPersonalStake) lines.push(`- POV personal stake: ${scene.povPersonalStake}`)
  if (scene.valueIn || scene.valueOut) {
    lines.push(`- Value shift: ${scene.valueIn ?? "?"} -> ${scene.valueOut ?? "?"}`)
  }
  if (scene.targetWords != null) lines.push(`- Planner word budget: ${scene.targetWords}`)
  return lines.join("\n")
}

function renderObligationsBrief(
  obligations: BeatContext["beatSpec"]["obligations"],
  idRendering: WriterPromptIdRendering | undefined,
): string {
  const lines: string[] = []
  pushObligationItems(lines, "Must establish", obligations.mustEstablish, idRendering)
  pushObligationItems(lines, "Must pay off", obligations.mustPayOff, idRendering)
  pushObligationItems(lines, "Must transfer knowledge", obligations.mustTransferKnowledge, idRendering)
  pushObligationItems(lines, "Must show state change", obligations.mustShowStateChange, idRendering)
  pushObligationItems(lines, "Must not reveal", obligations.mustNotReveal, idRendering)
  if (obligations.allowedNewEntities.length > 0) {
    lines.push(`- Allowed new named entities: ${obligations.allowedNewEntities.join(", ")}`)
  }
  return lines.join("\n")
}

function renderFactContinuityAnchors(ctx: BeatContext): string | null {
  const anchors = operationalAnchorItems(ctx.beatSpec.obligations)
  const lines = [
    "FACT AND CONTINUITY ANCHORS:",
    "- Treat required facts, knowledge, state, and payoff obligations as operational pressure, not background.",
    "- Make each retained anchor change a choice, tactic, constraint, cost, endpoint consequence, or future pressure.",
    "- Preserve the scene's declared timing and location unless the scene task itself says they change.",
  ]
  if (ctx.transitionBridge) lines.push("- Continue cleanly from the transition bridge; do not contradict already-drafted facts.")
  if (ctx.landingTarget) lines.push("- Land toward the next scene without resolving or pre-playing it.")
  for (const anchor of anchors.slice(0, 6)) lines.push(`- Anchor: ${anchor}`)
  return lines.length > 3 ? lines.join("\n") : null
}

function operationalAnchorItems(
  obligations: BeatContext["beatSpec"]["obligations"],
): string[] {
  return [
    ...obligations.mustEstablish.map(item => operationalAnchorText("establish", item)),
    ...obligations.mustPayOff.map(item => operationalAnchorText("pay off", item)),
    ...obligations.mustTransferKnowledge.map(item => operationalAnchorText("transfer", item)),
    ...obligations.mustShowStateChange.map(item => operationalAnchorText("show state", item)),
  ].filter((item): item is string => item !== null)
}

function operationalAnchorText(
  label: string,
  item: { text: string; characterName?: string; sourceId?: string; threadId?: string; promiseId?: string; payoffId?: string },
): string | null {
  const text = item.text.trim()
  if (!text) return null
  const actor = item.characterName ? `${item.characterName}: ` : ""
  const refs = [
    item.sourceId ? `source:${item.sourceId}` : "",
    item.threadId ? `thread:${item.threadId}` : "",
    item.promiseId ? `promise:${item.promiseId}` : "",
    item.payoffId ? `payoff:${item.payoffId}` : "",
  ].filter(Boolean)
  return `${label}: ${actor}${text}${refs.length > 0 ? ` [${refs.join("; ")}]` : ""}`
}

function pushObligationItems(
  lines: string[],
  label: string,
  items: Array<{ text: string; characterName?: string; obligationId?: string; sourceId?: string; threadId?: string; promiseId?: string; payoffId?: string }>,
  idRendering: WriterPromptIdRendering | undefined,
): void {
  const showIds = (idRendering ?? "raw") === "raw"
  for (const item of items) {
    const text = item.text.trim()
    if (!text) continue
    const actor = item.characterName ? `${item.characterName}: ` : ""
    const refs = showIds ? formatObligationRefs(item) : ""
    lines.push(`- ${label}: ${actor}${text}${refs}`)
  }
}

function formatObligationRefs(item: {
  obligationId?: string
  sourceId?: string
  threadId?: string
  promiseId?: string
  payoffId?: string
}): string {
  const refs = [
    item.obligationId ? item.obligationId : "",
    item.sourceId ? `source:${item.sourceId}` : "",
    item.threadId ? `thread:${item.threadId}` : "",
    item.promiseId ? `promise:${item.promiseId}` : "",
    item.payoffId ? `payoff:${item.payoffId}` : "",
  ].filter(Boolean)
  return refs.length > 0 ? ` [${refs.join("; ")}]` : ""
}

function renderContinuityAnchors(ctx: BeatContext): string | null {
  const lines: string[] = []
  if (ctx.transitionBridge) lines.push(`Continue from: ${ctx.transitionBridge}`)
  if (ctx.landingTarget) lines.push(`Land toward next scene: ${ctx.landingTarget}`)
  return lines.length > 0 ? `CONTINUITY ANCHORS:\n${lines.join("\n")}` : null
}

function renderCharacterSectionBrief(
  snapshots: CharacterSnapshot[],
  mode: WriterDraftingBriefMode | undefined,
): string {
  const header = mode === "scene-turn-v1"
    ? "CHARACTER MATERIALITY:\nUse these details to shape concrete behavior under this scene's pressure."
    : "CHARACTER PROFILES/SNAPSHOTS:"
  return `${header}\n${renderCharacterSnapshotsBrief(snapshots)}`
}

function renderCharacterSnapshotsBrief(snapshots: CharacterSnapshot[]): string {
  return snapshots.map(snap => {
    const parts = [
      snap.voice ? `Voice: ${snap.voice}` : "",
      snap.drives ? `Drives: ${snap.drives}` : "",
      snap.avoids ? `Avoids: ${snap.avoids}` : "",
      snap.conflict ? `Conflict: ${snap.conflict}` : "",
      snap.state ? `State: ${snap.state}` : "",
    ].filter(Boolean)
    const lines = [`- ${snap.name}${parts.length > 0 ? `: ${parts.join(" | ")}` : ""}`]
    if (snap.withPov) {
      lines.push(`  With ${snap.povDisplayName ?? "POV"}: [${snap.withPov.trustLevel}] ${snap.withPov.dynamic}`)
      if (snap.withPov.tension) lines.push(`  Tension: ${snap.withPov.tension}`)
    }
    if (snap.doesNotKnow && snap.doesNotKnow.length > 0) {
      lines.push(`  Does not know: ${snap.doesNotKnow.join("; ")}`)
    }
    if (snap.exampleLines.length > 0) {
      lines.push(`  Voice sample: "${snap.exampleLines[0]!.replace(/^"|"$/g, "")}"`)
    }
    return lines.join("\n")
  }).join("\n")
}

function renderSettingBrief(setting: SettingBlock): string {
  const lines = [`SETTING CONTEXT: ${setting.name}`]
  if (setting.description) lines.push(setting.description)
  if (setting.sensoryDetails) lines.push(`Sensory: ${setting.sensoryDetails}`)
  return lines.join("\n")
}

function summarizeWriterDraftingBrief(args: {
  ctx: BeatContext
  mode: WriterDraftingBriefMode
  selectedPrompt: string
  fullContextPrompt: string
  targetWords: number
}): WriterDraftingBriefTrace {
  const selectedPromptChars = args.selectedPrompt.length
  const fullContextPromptChars = args.fullContextPrompt.length
  return {
    mode: args.mode,
    selectedPromptChars,
    fullContextPromptChars,
    targetWords: args.targetWords,
    charsDelta: selectedPromptChars - fullContextPromptChars,
    charsRatio: fullContextPromptChars > 0 ? selectedPromptChars / fullContextPromptChars : 1,
    sections: {
      sceneContract: Boolean(args.ctx.sceneContract),
      obligations: countObligations(args.ctx.beatSpec.obligations) > 0,
      transitionBridge: Boolean(args.ctx.transitionBridge),
      landingTarget: Boolean(args.ctx.landingTarget),
      factContinuityAnchors: args.mode === "scene-turn-anchored-v1" &&
        (operationalAnchorItems(args.ctx.beatSpec.obligations).length > 0 ||
          Boolean(args.ctx.transitionBridge) ||
          Boolean(args.ctx.landingTarget)),
      characterSnapshots: args.ctx.characterSnapshots.length > 0,
      characterContextCapsules: Boolean(args.ctx.characterContextCapsules),
      resolvedReferences: Boolean(args.ctx.resolvedReferencesText),
      readerInfoState: Boolean(args.ctx.readerInfoState),
      setting: Boolean(args.ctx.setting),
    },
    counts: {
      characters: args.ctx.characterSnapshots.length,
      obligations: countObligations(args.ctx.beatSpec.obligations),
      sceneContractFields: args.ctx.sceneContract ? countSceneContractFields(args.ctx.sceneContract) : 0,
      choiceAlternatives: args.ctx.sceneContract?.choiceAlternatives.length ?? 0,
    },
  }
}

function countObligations(obligations: BeatContext["beatSpec"]["obligations"]): number {
  return obligations.mustEstablish.length
    + obligations.mustPayOff.length
    + obligations.mustTransferKnowledge.length
    + obligations.mustShowStateChange.length
    + obligations.mustNotReveal.length
    + obligations.allowedNewEntities.length
}

function countSceneContractFields(scene: SceneContractBlock): number {
  let count = 0
  if (scene.temporalAnchor) count++
  if (scene.placeAnchor) count++
  if (scene.goal) count++
  if (scene.opposition) count++
  if (scene.turningPoint) count++
  if (scene.crisisChoice) count++
  if (scene.outcome) count++
  if (scene.consequence) count++
  if (scene.povPersonalStake) count++
  if (scene.valueIn) count++
  if (scene.valueOut) count++
  if (scene.targetWords != null) count++
  if (scene.choiceAlternatives.length > 0) count++
  return count
}
