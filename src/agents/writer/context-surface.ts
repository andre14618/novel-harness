import type { BeatContext } from "./beat-context"
import { collectCanonSourceRefIds, collectStoryRefIds, countCanonSourceRefs, countStoryRefs } from "./context-trace-counts"
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
    sceneEndpointLandingGuidance?: boolean
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
    sceneContractEndpointFields?: number
    sceneContractBudgetFields?: number
    choiceAlternatives?: number
    storyRefIds?: number
    activeThreadIds?: number
    activePromiseIds?: number
    activePayoffIds?: number
    readerInfoStateChars?: number
    implicitReferenceMarkers?: number
    referenceLookups?: number
    referenceLlmCalls?: number
    missingCharacterIds?: number
  }
  ids?: {
    canonSourceRefs?: string[]
    activeThreadIds?: string[]
    activePromiseIds?: string[]
    activePayoffIds?: string[]
  }
}

export function summarizeBeatContextSurface(ctx: BeatContext): WriterContextSurfaceTrace {
  const capsules = ctx.characterContextCapsules ?? null
  const sceneContractShape = ctx.sceneContract ? summarizeSceneContractShape(ctx.sceneContract) : null
  const canonSourceRefs = countCanonSourceRefs(ctx)
  const storyRefs = countStoryRefs(ctx)
  const canonSourceRefIds = collectCanonSourceRefIds(ctx)
  const storyRefIds = collectStoryRefIds(ctx)
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
      sceneEndpointLandingGuidance: (sceneContractShape?.endpointFields ?? 0) > 0,
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
      sceneContractEndpointFields: sceneContractShape?.endpointFields ?? 0,
      sceneContractBudgetFields: sceneContractShape?.budgetFields ?? 0,
      choiceAlternatives: sceneContractShape?.choiceAlternatives ?? 0,
      storyRefIds: storyRefs.total,
      activeThreadIds: storyRefs.threadIds,
      activePromiseIds: storyRefs.promiseIds,
      activePayoffIds: storyRefs.payoffIds,
      readerInfoStateChars: ctx.readerInfoState?.length ?? 0,
      implicitReferenceMarkers: ctx.referenceResolutionTrace?.hasImplicitReference ? 1 : 0,
      referenceLookups: ctx.referenceResolutionTrace?.lookupCount ?? 0,
      referenceLlmCalls: ctx.referenceResolutionTrace?.llmUsed ? 1 : 0,
      missingCharacterIds: capsules?.missingCharacterIds.length ?? 0,
    },
    ids: {
      canonSourceRefs: canonSourceRefIds,
      activeThreadIds: storyRefIds.threadIds,
      activePromiseIds: storyRefIds.promiseIds,
      activePayoffIds: storyRefIds.payoffIds,
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
