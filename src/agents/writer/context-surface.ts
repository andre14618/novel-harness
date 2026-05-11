import type { BeatContext } from "./beat-context"
import { summarizeSceneContractShape } from "./scene-contract-shape"

export interface WriterContextSurfaceTrace {
  path: "beat" | "chapter"
  surfaces: {
    sceneSetup?: boolean
    beatSpec?: boolean
    sceneContract?: boolean
    canonFacts?: boolean
    characterProfiles?: boolean
    characterSnapshots?: boolean
    characterContextCapsules?: boolean
    worldBible?: boolean
    setting?: boolean
    storySpine?: boolean
    implicitReferences?: boolean
    resolvedReferences?: boolean
    readerInfoState?: boolean
    transitionBridge?: boolean
    landingTarget?: boolean
    povWorldView?: boolean
    craftReminders?: boolean
    semanticRetrieval?: boolean
    minimalFallback?: boolean
  }
  counts: {
    charactersPresent?: number
    characterProfiles?: number
    characterSnapshots?: number
    characterContextCards?: number
    obligations?: number
    canonSourceRefs?: number
    sceneContractFields?: number
    sceneContractAnchorFields?: number
    sceneContractDramaticFields?: number
    sceneContractBudgetFields?: number
    choiceAlternatives?: number
    activeThreadIds?: number
    activePromiseIds?: number
    activePayoffIds?: number
    implicitReferenceMarkers?: number
    referenceLookups?: number
    referenceLlmCalls?: number
    missingCharacterIds?: number
  }
}

export function summarizeBeatContextSurface(ctx: BeatContext): WriterContextSurfaceTrace {
  const capsules = ctx.characterContextCapsules ?? null
  const sceneContractShape = ctx.sceneContract ? summarizeSceneContractShape(ctx.sceneContract) : null
  const canonSourceRefs = countCanonSourceRefs(ctx)
  return {
    path: "beat",
    surfaces: {
      beatSpec: true,
      sceneContract: Boolean(ctx.sceneContract),
      canonFacts: canonSourceRefs > 0,
      characterProfiles: ctx.characterSnapshots.length > 0,
      characterSnapshots: ctx.characterSnapshots.length > 0,
      characterContextCapsules: Boolean(capsules),
      worldBible: Boolean(ctx.setting),
      setting: Boolean(ctx.setting),
      implicitReferences: Boolean(ctx.referenceResolutionTrace?.hasImplicitReference),
      resolvedReferences: Boolean(ctx.resolvedReferencesText),
      readerInfoState: Boolean(ctx.readerInfoState),
      transitionBridge: Boolean(ctx.transitionBridge),
      landingTarget: Boolean(ctx.landingTarget),
    },
    counts: {
      charactersPresent: ctx.beatSpec.charactersPresent.length,
      characterProfiles: ctx.characterSnapshots.length,
      characterSnapshots: ctx.characterSnapshots.length,
      characterContextCards: capsules?.cards.length ?? 0,
      obligations: countObligations(ctx.beatSpec.obligations),
      canonSourceRefs,
      sceneContractFields: sceneContractShape?.fieldCount ?? 0,
      sceneContractAnchorFields: sceneContractShape?.anchorFields ?? 0,
      sceneContractDramaticFields: sceneContractShape?.dramaticFields ?? 0,
      sceneContractBudgetFields: sceneContractShape?.budgetFields ?? 0,
      choiceAlternatives: sceneContractShape?.choiceAlternatives ?? 0,
      activeThreadIds: capsules?.activeThreadIds.length ?? 0,
      activePromiseIds: capsules?.activePromiseIds.length ?? 0,
      activePayoffIds: capsules?.activePayoffIds.length ?? 0,
      implicitReferenceMarkers: ctx.referenceResolutionTrace?.hasImplicitReference ? 1 : 0,
      referenceLookups: ctx.referenceResolutionTrace?.lookupCount ?? 0,
      referenceLlmCalls: ctx.referenceResolutionTrace?.llmUsed ? 1 : 0,
      missingCharacterIds: capsules?.missingCharacterIds.length ?? 0,
    },
  }
}

function countCanonSourceRefs(ctx: BeatContext): number {
  const ids = new Set<string>()
  for (const seed of ctx.beatSpec.seeds) if (seed.factId) ids.add(seed.factId)
  for (const due of ctx.beatSpec.payoffsDue) if (due.factId) ids.add(due.factId)
  for (const item of [
    ...ctx.beatSpec.obligations.mustEstablish,
    ...ctx.beatSpec.obligations.mustPayOff,
    ...ctx.beatSpec.obligations.mustTransferKnowledge,
    ...ctx.beatSpec.obligations.mustShowStateChange,
    ...ctx.beatSpec.obligations.mustNotReveal,
  ]) {
    if (item.sourceId) ids.add(item.sourceId)
  }
  return ids.size
}

function countObligations(obligations: BeatContext["beatSpec"]["obligations"]): number {
  return obligations.mustEstablish.length
    + obligations.mustPayOff.length
    + obligations.mustTransferKnowledge.length
    + obligations.mustShowStateChange.length
    + obligations.mustNotReveal.length
    + obligations.allowedNewEntities.length
}
