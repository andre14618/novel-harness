import type { BeatContext, SceneContractBlock } from "./beat-context"

export interface WriterContextSurfaceTrace {
  path: "beat" | "chapter"
  surfaces: {
    sceneSetup?: boolean
    beatSpec?: boolean
    sceneContract?: boolean
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
    sceneContractFields?: number
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
  return {
    path: "beat",
    surfaces: {
      beatSpec: true,
      sceneContract: Boolean(ctx.sceneContract),
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
      sceneContractFields: ctx.sceneContract ? countSceneContractFields(ctx.sceneContract) : 0,
      choiceAlternatives: ctx.sceneContract?.choiceAlternatives.length ?? 0,
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
