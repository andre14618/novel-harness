/**
 * L097 Slice 2: scene-contract rendering tests.
 *
 * Covers (a) SceneContractBlock construction from a scene-shape entry,
 * (b) byte-shape of the SCENE CONTRACT prompt block, (c) buildExpansionPrompt
 * shape for retry-short-scenes-v1.
 *
 * The byte-parity test for legacy outlines (sceneCallWriterV1 off) lives
 * in `tests/beat-context-parity.test.ts`; this file tests the on-flag
 * surface in isolation.
 */

import { describe, expect, it } from "bun:test"

import type { BeatContext, BeatContextResult } from "./beat-context"
import { renderBeatContext } from "./beat-context-render"
import { summarizeBeatContextSurface } from "./context-surface"
import { renderWriterDraftingBrief, selectWriterPromptForDraftingBrief } from "./drafting-brief"
import { buildExpansionPrompt } from "./retry-context"

function baseCtx(overrides: Partial<BeatContext> = {}): BeatContext {
  return {
    beatSpec: {
      sceneId: "scene-archive-1",
      beatId: "beat-archive-1",
      beatNumber: 1,
      totalBeats: 5,
      pov: "Calla",
      setting: "Imperial Archive",
      kind: "dialogue",
      description: "Calla confronts Orvath.",
      charactersPresent: ["Calla", "Orvath"],
      seeds: [],
      payoffsDue: [],
      obligations: {
        mustEstablish: [],
        mustPayOff: [],
        mustTransferKnowledge: [],
        mustShowStateChange: [],
        mustNotReveal: [],
        allowedNewEntities: [],
      },
    },
    transitionBridge: null,
    landingTarget: null,
    characterSnapshots: [],
    resolvedReferencesText: null,
    readerInfoState: null,
    setting: null,
    sceneContract: null,
    ...overrides,
  }
}

describe("renderBeatContext + scene contract", () => {
  it("omits the SCENE CONTRACT block when sceneContract is null", () => {
    const out = renderBeatContext(baseCtx(), { compact: false })
    expect(out).not.toContain("SCENE CONTRACT")
  })

  it("renders the SCENE CONTRACT block when sceneContract is populated", () => {
    const out = renderBeatContext(
      baseCtx({
        sceneContract: {
          goal: "Force Orvath to confess his deal with the empire.",
          opposition: "Orvath holds Davan's safety as leverage.",
          turningPoint: "Calla realises she is the leverage.",
          crisisChoice: "Trade the script or burn it.",
          choiceAlternatives: [
            "Hand the script over and accept Orvath's protection.",
            "Burn the script and force a public reckoning.",
          ],
          outcome: "Calla burns the script.",
          consequence: "Davan is exiled and the empire begins hunting Calla.",
          povPersonalStake: "Calla cannot let Davan be reduced to leverage again.",
          valueIn: "compliance",
          valueOut: "rupture",
        },
      }),
      { compact: false },
    )

    expect(out).toContain("SCENE CONTRACT")
    expect(out).toContain("Goal: Force Orvath to confess his deal with the empire.")
    expect(out).toContain("Crisis choice: Trade the script or burn it.")
    expect(out).toContain("Choice alternatives the protagonist weighs:")
    expect(out).toContain("- Hand the script over and accept Orvath's protection.")
    expect(out).toContain("- Burn the script and force a public reckoning.")
    expect(out).toContain("Outcome (what happens): Calla burns the script.")
    expect(out).toContain("Consequence (observable downstream pressure — different from outcome): Davan is exiled and the empire begins hunting Calla.")
    expect(out).toContain("POV personal stake: Calla cannot let Davan be reduced to leverage again.")
    expect(out).toContain("Value polarity: compliance → rupture")
  })

  it("omits empty fields and renders value polarity with ? for missing sides", () => {
    const out = renderBeatContext(
      baseCtx({
        sceneContract: {
          choiceAlternatives: ["Stay silent.", "Speak up."],
          valueIn: "compliance",
          // valueOut omitted intentionally
        },
      }),
      { compact: false },
    )

    expect(out).toContain("SCENE CONTRACT")
    expect(out).toContain("Value polarity: compliance → ?")
    expect(out).not.toContain("Goal:")
    expect(out).not.toContain("Opposition:")
  })

  it("places SCENE CONTRACT immediately after BEAT spec and before transition bridge", () => {
    const out = renderBeatContext(
      baseCtx({
        sceneContract: { choiceAlternatives: ["A", "B"], goal: "G" },
        transitionBridge: "Prior beat closing line.",
      }),
      { compact: false },
    )

    const beatIdx = out.indexOf("BEAT 1 of 5")
    const sceneIdx = out.indexOf("SCENE CONTRACT")
    const bridgeIdx = out.indexOf("TRANSITION BRIDGE")
    expect(beatIdx).toBeGreaterThanOrEqual(0)
    expect(sceneIdx).toBeGreaterThan(beatIdx)
    expect(bridgeIdx).toBeGreaterThan(sceneIdx)
  })

  it("summarizes the full writer context surface, not only scene contracts", () => {
    const surface = summarizeBeatContextSurface(baseCtx({
      sceneContract: {
        goal: "Force Orvath to confess.",
        crisisChoice: "Trade the script or burn it.",
        choiceAlternatives: ["Trade.", "Burn."],
      },
      characterSnapshots: [{
        name: "Calla",
        exampleLines: ["No."],
        voice: "Precise and wary.",
      }],
      characterContextCapsules: {
        mode: "thread-character-context-v1",
        scope: "beat",
        chapterId: "ch-1",
        beatId: "scene-1",
        beatNumber: 1,
        povCharacterId: "char-calla",
        povPersonalStake: "Calla cannot let Davan be reduced to leverage again.",
        activeThreadIds: ["thread-reckoning"],
        activePromiseIds: ["promise-script"],
        activePayoffIds: [],
        cards: [{
          characterId: "char-calla",
          name: "Calla",
          role: "protagonist",
          sceneRole: "pov",
          voice: "Precise and wary.",
          sourceObligationIds: ["obl-choice"],
          activeThreadIds: ["thread-reckoning"],
          activePromiseIds: ["promise-script"],
          activePayoffIds: [],
        }],
        missingCharacterIds: [],
      },
      resolvedReferencesText: "RESOLVED REFERENCES:\n- script",
      referenceResolutionTrace: {
        hasImplicitReference: true,
        lookupCount: 2,
        llmUsed: true,
        contextRendered: true,
      },
      readerInfoState: "READER-INFO STATE:\nReader already knows the script is dangerous.",
      setting: { name: "Imperial Archive", sensoryDetails: "ink and stone" },
    }))

    expect(surface.surfaces.sceneContract).toBe(true)
    expect(surface.surfaces.characterProfiles).toBe(true)
    expect(surface.surfaces.characterSnapshots).toBe(true)
    expect(surface.surfaces.characterContextCapsules).toBe(true)
    expect(surface.surfaces.worldBible).toBe(true)
    expect(surface.surfaces.setting).toBe(true)
    expect(surface.surfaces.implicitReferences).toBe(true)
    expect(surface.surfaces.resolvedReferences).toBe(true)
    expect(surface.surfaces.readerInfoState).toBe(true)
    expect(surface.counts.characterContextCards).toBe(1)
    expect(surface.counts.sceneContractFields).toBe(3)
    expect(surface.counts.choiceAlternatives).toBe(2)
    expect(surface.counts.activeThreadIds).toBe(1)
    expect(surface.counts.implicitReferenceMarkers).toBe(1)
    expect(surface.counts.referenceLookups).toBe(2)
    expect(surface.counts.referenceLlmCalls).toBe(1)
  })

  it("renders a production writer drafting brief from the full context surface", () => {
    const out = renderWriterDraftingBrief(
      baseCtx({
        sceneContract: {
          goal: "Force Orvath to confess his deal with the empire.",
          opposition: "Orvath holds Davan's safety as leverage.",
          turningPoint: "Calla realises she is the leverage.",
          crisisChoice: "Trade the script or burn it.",
          choiceAlternatives: ["Trade the script.", "Burn the script."],
          outcome: "Calla burns the script.",
          consequence: "Davan is exiled and the empire begins hunting Calla.",
          povPersonalStake: "Calla cannot let Davan be reduced to leverage again.",
          valueIn: "compliance",
          valueOut: "rupture",
          targetWords: 640,
        },
        transitionBridge: "The archive doors shut behind Calla.",
        landingTarget: "Davan reaches the bridge",
        characterSnapshots: [{
          name: "Calla",
          exampleLines: ["No more bargains."],
          voice: "Precise and wary.",
          drives: "Protect Davan.",
          state: "cornered but focused",
        }],
        characterContextCapsules: {
          mode: "thread-character-context-v1",
          scope: "beat",
          chapterId: "ch-1",
          beatId: "beat-archive-1",
          beatNumber: 1,
          povCharacterId: "char-calla",
          povPersonalStake: "Calla cannot let Davan be reduced to leverage again.",
          activeThreadIds: ["thread-reckoning"],
          activePromiseIds: ["promise-script"],
          activePayoffIds: [],
          cards: [{
            characterId: "char-calla",
            name: "Calla",
            role: "protagonist",
            sceneRole: "pov",
            voice: "Precise and wary.",
            sourceObligationIds: ["obl-choice"],
            activeThreadIds: ["thread-reckoning"],
            activePromiseIds: ["promise-script"],
            activePayoffIds: [],
          }],
          missingCharacterIds: [],
        },
        beatSpec: {
          ...baseCtx().beatSpec,
          obligations: {
            mustEstablish: [{
              text: "Calla chooses rupture over protection.",
              obligationId: "obl-choice",
              sourceId: "fact-script",
              threadId: "thread-reckoning",
              promiseId: "promise-script",
            }],
            mustPayOff: [],
            mustTransferKnowledge: [],
            mustShowStateChange: [],
            mustNotReveal: [],
            allowedNewEntities: ["junior archivist"],
          },
        },
        resolvedReferencesText: "RESOLVED REFERENCES:\n- script",
        readerInfoState: "READER-INFO STATE:\nReader knows Davan is leverage.",
        setting: { name: "Imperial Archive", description: "A sealed record hall.", sensoryDetails: "ink and stone" },
      }),
      { targetWords: 640, idRendering: "raw" },
    )

    expect(out).toContain("WRITER DRAFTING BRIEF")
    expect(out).toContain("Budget: about 640 words")
    expect(out).toContain("Scene ID: scene-archive-1")
    expect(out).toContain("Beat ID: beat-archive-1")
    expect(out).toContain("SCENE CONTRACT:")
    expect(out).toContain("- Crisis choice: Trade the script or burn it.")
    expect(out).toContain("- Value shift: compliance -> rupture")
    expect(out).toContain("OBLIGATIONS:")
    expect(out).toContain("obl-choice")
    expect(out).toContain("source:fact-script")
    expect(out).toContain("CHARACTER PROFILES/SNAPSHOTS:")
    expect(out).toContain("CHARACTER CONTEXT CAPSULES:")
    expect(out).toContain("RESOLVED REFERENCES:")
    expect(out).toContain("READER-INFO STATE:")
    expect(out).toContain("SETTING CONTEXT: Imperial Archive")
  })

  it("selects the drafting brief prompt and records payload telemetry", () => {
    const ctx = baseCtx({
      sceneContract: {
        goal: "Force Orvath to confess.",
        choiceAlternatives: ["Trade.", "Burn."],
        targetWords: 500,
      },
      characterSnapshots: [{ name: "Calla", exampleLines: [], voice: "Precise." }],
    })
    const full = renderBeatContext(ctx, { compact: false })
    const selected = selectWriterPromptForDraftingBrief({
      ctx,
      mode: "scene-budget-v1",
      fullContextPrompt: full,
      targetWords: 500,
      idRendering: "raw",
    })

    expect(selected.userPrompt).toContain("WRITER DRAFTING BRIEF")
    expect(selected.userPrompt).not.toBe(full)
    expect(selected.draftingBriefTrace.mode).toBe("scene-budget-v1")
    expect(selected.draftingBriefTrace.selectedPromptChars).toBe(selected.userPrompt.length)
    expect(selected.draftingBriefTrace.fullContextPromptChars).toBe(full.length)
    expect(selected.draftingBriefTrace.sections.sceneContract).toBe(true)
    expect(selected.draftingBriefTrace.counts.choiceAlternatives).toBe(2)
  })

  it("renders the scene-turn drafting brief floor without changing the budget mode", () => {
    const ctx = baseCtx({
      sceneContract: {
        goal: "Force Orvath to confess.",
        turningPoint: "Calla realizes the ledger is bait.",
        choiceAlternatives: [],
        outcome: "Orvath lies again.",
        consequence: "Calla must choose whether to expose him publicly.",
        targetWords: 500,
      },
      characterSnapshots: [{ name: "Calla", exampleLines: [], voice: "Precise.", drives: "Protect the ledger." }],
    })
    const full = renderBeatContext(ctx, { compact: false })
    const selected = selectWriterPromptForDraftingBrief({
      ctx,
      mode: "scene-turn-v1",
      fullContextPrompt: full,
      targetWords: 500,
      idRendering: "raw",
    })

    expect(selected.userPrompt).toContain("SCENE EXECUTION FLOOR:")
    expect(selected.userPrompt).toContain("Write a complete scene turn")
    expect(selected.userPrompt).toContain("SCENE CONTRACT (dramatize this shape on-page):")
    expect(selected.userPrompt).toContain("CHARACTER MATERIALITY:")
    expect(selected.userPrompt).toContain("Use these details to shape concrete behavior")
    expect(selected.draftingBriefTrace.mode).toBe("scene-turn-v1")
  })
})

describe("buildExpansionPrompt", () => {
  function ctxResult(userPrompt: string): BeatContextResult {
    return { userPrompt, targetWords: 600 }
  }

  it("appends an expansion suffix that names the prior word count and floor", () => {
    const out = buildExpansionPrompt({
      beatContext: ctxResult("BASE PROMPT"),
      systemPrompt: "SYS",
      priorProse: "Short prose.",
      actualWords: 320,
      advisoryFloor: 420,
      attempt: 2,
    })

    expect(out.systemPrompt).toBe("SYS")
    expect(out.userPrompt.startsWith("BASE PROMPT")).toBe(true)
    expect(out.userPrompt).toContain("--- SCENE EXPANSION (attempt 2) ---")
    expect(out.userPrompt).toContain("came in at 320 words")
    expect(out.userPrompt).toContain("the advisory floor is 420 words")
    expect(out.userPrompt).toContain("dramatized action, dialogue, interiority, and consequence without padding")
    expect(out.userPrompt).toContain("Short prose.")
  })

  it("truncates the prior prose to 8000 chars in the expansion suffix", () => {
    const long = "x".repeat(8500)
    const out = buildExpansionPrompt({
      beatContext: ctxResult("BASE PROMPT"),
      systemPrompt: "SYS",
      priorProse: long,
      actualWords: 1200,
      advisoryFloor: 1500,
      attempt: 1,
    })

    // 8000-char cap on the prior-prose excerpt; the surrounding wrapper
    // adds fixed bytes — assert the embedded sample length is bounded.
    const embedded = out.userPrompt.split("---")[3] ?? ""
    expect(embedded.length).toBeLessThanOrEqual(8100)
  })
})
