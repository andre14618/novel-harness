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

import { buildBeatContextSlots, type BeatContext, type BeatContextResult } from "./beat-context"
import { renderBeatContext } from "./beat-context-render"
import { summarizeBeatContextSurface } from "./context-surface"
import { renderWriterDraftingBrief, selectWriterPromptForDraftingBrief } from "./drafting-brief"
import { buildExpansionPrompt } from "./retry-context"
import type { ChapterOutline } from "../../types"

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
          temporalAnchor: "after closing",
          placeAnchor: "empty archive",
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
    expect(out).toContain("Temporal anchor: after closing")
    expect(out).toContain("Place anchor: empty archive")
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
      beatSpec: {
        ...baseCtx().beatSpec,
        seeds: [{ fact: "The script is dangerous.", factId: "fact-script-danger", landsAtBeat: 3 }],
        payoffsDue: [{ fact: "The ledger seal burns liars.", factId: "fact-ledger-seal", seededAtBeat: 0 }],
        obligations: {
          mustEstablish: [{
            text: "Calla chooses rupture over protection.",
            obligationId: "obl-choice",
            sourceId: "fact-script",
          }],
          mustPayOff: [],
          mustTransferKnowledge: [],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
    }))

    expect(surface.surfaces.sceneContract).toBe(true)
    expect(surface.surfaces.canonFacts).toBe(true)
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
    expect(surface.counts.sceneContractAnchorFields).toBe(0)
    expect(surface.counts.sceneContractDramaticFields).toBe(3)
    expect(surface.counts.sceneContractBudgetFields).toBe(0)
    expect(surface.counts.choiceAlternatives).toBe(2)
    expect(surface.counts.canonSourceRefs).toBe(3)
    expect(surface.counts.storyRefIds).toBe(2)
    expect(surface.counts.activeThreadIds).toBe(1)
    expect(surface.counts.activePromiseIds).toBe(1)
    expect(surface.counts.readerInfoStateChars).toBeGreaterThan(0)
    expect(surface.counts.implicitReferenceMarkers).toBe(1)
    expect(surface.counts.referenceLookups).toBe(2)
    expect(surface.counts.referenceLlmCalls).toBe(1)
  })

  it("renders a production writer drafting brief from the full context surface", () => {
    const out = renderWriterDraftingBrief(
      baseCtx({
        sceneContract: {
          temporalAnchor: "after closing",
          placeAnchor: "empty archive",
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
    expect(out).toContain("- Time: after closing")
    expect(out).toContain("- Place: empty archive")
    expect(out).toContain("- Crisis choice: Trade the script or burn it.")
    expect(out).toContain("- Value shift: compliance -> rupture")
    expect(out).toContain("show the immediate record, custody, access, debt, threat, or relationship change")
    expect(out).toContain("OBLIGATIONS:")
    expect(out).toContain("Preserve status polarity exactly")
    expect(out).toContain("obl-choice")
    expect(out).toContain("source:fact-script")
    expect(out).toContain("Preserve bridge state exactly")
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
    expect(selected.draftingBriefTrace.counts.sceneContractFields).toBe(3)
    expect(selected.draftingBriefTrace.counts.sceneContractAnchorFields).toBe(0)
    expect(selected.draftingBriefTrace.counts.sceneContractDramaticFields).toBe(2)
    expect(selected.draftingBriefTrace.counts.sceneContractBudgetFields).toBe(1)
    expect(selected.draftingBriefTrace.counts.choiceAlternatives).toBe(2)
    expect(selected.draftingBriefTrace.counts.canonSourceRefs).toBe(0)
  })

  it("renders obligation-named witnesses in drafting brief characters present", () => {
    const ctx = baseCtx({
      beatSpec: {
        ...baseCtx().beatSpec,
        charactersPresent: ["Maret", "Arbiter Cassel"],
        obligations: {
          mustEstablish: [],
          mustPayOff: [],
          mustTransferKnowledge: [{
            text: "Journeyman Theo witnesses the true Strength stat",
            characterName: "Journeyman Theo",
            characterId: "char-theo",
            sourceId: "know-theo-learns-true-strength",
            obligationId: "obl-theo-knows",
          }],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
    })
    const full = renderBeatContext(ctx, { compact: false })
    const selected = selectWriterPromptForDraftingBrief({
      ctx,
      mode: "scene-budget-v1",
      fullContextPrompt: full,
      targetWords: 500,
      idRendering: "raw",
    })

    expect(selected.userPrompt).toContain("Characters present: Maret, Arbiter Cassel, Journeyman Theo")
    expect(selected.draftingBriefTrace.counts.characters).toBe(3)
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
    expect(selected.userPrompt).toContain("Land the endpoint through an on-page action")
    expect(selected.userPrompt).toContain("Do not end on only an intention")
    expect(selected.userPrompt).toContain("before cutting endpoint action or consequence")
    expect(selected.userPrompt).toContain("SCENE CONTRACT (dramatize this shape on-page):")
    expect(selected.userPrompt).toContain("Endpoint landing: execute the outcome")
    expect(selected.userPrompt).toContain("If the outcome is delay, investigation, or refusal to decide")
    expect(selected.userPrompt).toContain("CHARACTER MATERIALITY:")
    expect(selected.userPrompt).toContain("Use these details to shape concrete behavior")
    expect(selected.draftingBriefTrace.mode).toBe("scene-turn-v1")
  })

  it("constructs scene-contract anchors for every drafting brief mode", async () => {
    const outline: ChapterOutline = {
      chapterNumber: 2,
      chapterId: "ch-002-unmasking",
      title: "The Unmasking",
      povCharacter: "Maret",
      setting: "Iron Bridge",
      purpose: "Verification exposes Maret.",
      targetWords: 1500,
      charactersPresent: [],
      charactersPresentIds: [],
      scenes: [{
        sceneId: "ch-002-scene-001-bridge",
        description: "Maret arrives for Verification.",
        temporalAnchor: "dawn the next morning",
        placeAnchor: "Iron Bridge",
        characters: [],
        kind: "action",
        requiredPayoffs: [],
        obligations: {
          mustEstablish: [],
          mustPayOff: [],
          mustTransferKnowledge: [],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
      }],
      establishedFacts: [],
      characterStateChanges: [],
      knowledgeChanges: [],
    }

    for (const writerDraftingBriefMode of ["scene-budget-v1", "scene-budget-tight-v1", "scene-turn-v1", "scene-turn-anchored-v1"] as const) {
      const ctx = await buildBeatContextSlots({
        novelId: "unit-novel",
        chapterNumber: 2,
        beatIndex: 0,
        outline,
        characters: [],
        characterStates: [],
        worldBible: { locations: [] },
        writerDraftingBriefMode,
      })
      expect(ctx.sceneContract?.temporalAnchor).toBe("dawn the next morning")
      expect(ctx.sceneContract?.placeAnchor).toBe("Iron Bridge")
    }
  })

  it("renders anchored scene-turn brief anchors and records section telemetry", () => {
    const ctx = baseCtx({
      beatSpec: {
        ...baseCtx().beatSpec,
        obligations: {
          mustEstablish: [{
            text: "The ledger seal burns anyone who lies.",
            obligationId: "obl-ledger-seal",
            sourceId: "fact-ledger-seal",
          }],
          mustPayOff: [],
          mustTransferKnowledge: [{
            text: "Orvath learns Calla copied the warrant.",
            characterName: "Orvath",
            obligationId: "obl-orvath-learns",
            sourceId: "know-orvath-warrant",
          }],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
      transitionBridge: "Calla shut the archive door behind her.",
      landingTarget: "Orvath reaches for the ledger.",
    })
    const full = renderBeatContext(ctx, { compact: false })
    const selected = selectWriterPromptForDraftingBrief({
      ctx,
      mode: "scene-turn-anchored-v1",
      fullContextPrompt: full,
      targetWords: 500,
      idRendering: "raw",
    })

    expect(selected.userPrompt).toContain("FACT AND CONTINUITY ANCHORS:")
    expect(selected.userPrompt).toContain("Make each retained anchor change a choice")
    expect(selected.userPrompt).toContain("Anchor: establish: The ledger seal burns anyone who lies. [source:fact-ledger-seal]")
    expect(selected.userPrompt).toContain("Continue cleanly from the transition bridge")
    expect(selected.userPrompt).toContain("Preserve bridge state exactly")
    expect(selected.draftingBriefTrace.mode).toBe("scene-turn-anchored-v1")
    expect(selected.draftingBriefTrace.sections.factContinuityAnchors).toBe(true)
    expect(selected.draftingBriefTrace.counts.canonSourceRefs).toBe(2)
  })

  it("renders compact status-polarity guidance for already-authorized missing-seal facts", () => {
    const out = renderWriterDraftingBrief(
      baseCtx({
        beatSpec: {
          ...baseCtx().beatSpec,
          obligations: {
            mustEstablish: [{
              text: "The transfer order is already authorized and signed; only Calla's seal remains missing.",
              obligationId: "obl-transfer-status",
              sourceId: "fact-transfer-status",
            }],
            mustPayOff: [],
            mustTransferKnowledge: [],
            mustShowStateChange: [],
            mustNotReveal: [],
            allowedNewEntities: [],
          },
        },
      }),
      { targetWords: 500, idRendering: "raw" },
    )

    expect(out).toContain("Preserve status polarity exactly")
    expect(out).toContain("already/only/not-yet/missing/withheld/authorized/signed")
    expect(out).toContain("The transfer order is already authorized and signed; only Calla's seal remains missing.")
  })

  it("renders tight scene load control without dropping required context telemetry", () => {
    const ctx = baseCtx({
      beatSpec: {
        ...baseCtx().beatSpec,
        obligations: {
          mustEstablish: [{
            text: "The warrant is already signed.",
            obligationId: "obl-warrant-signed",
            sourceId: "fact-warrant-signed",
          }],
          mustPayOff: [],
          mustTransferKnowledge: [],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
    })
    const full = renderBeatContext(ctx, { compact: false })
    const selected = selectWriterPromptForDraftingBrief({
      ctx,
      mode: "scene-budget-tight-v1",
      fullContextPrompt: full,
      targetWords: 500,
      idRendering: "raw",
    })

    expect(selected.userPrompt).toContain("SCENE LOAD CONTROL:")
    expect(selected.userPrompt).toContain("Treat about 500 words as the ceiling")
    expect(selected.userPrompt).toContain("Let one concrete action")
    expect(selected.userPrompt).toContain("Preserve declared character, world, canon, and reader-state obligations")
    expect(selected.userPrompt).toContain("Must establish: The warrant is already signed.")
    expect(selected.draftingBriefTrace.mode).toBe("scene-budget-tight-v1")
    expect(selected.draftingBriefTrace.sections.sceneLoadControl).toBe(true)
    expect(selected.draftingBriefTrace.sections.obligations).toBe(true)
    expect(selected.draftingBriefTrace.counts.obligations).toBe(1)
    expect(selected.draftingBriefTrace.counts.canonSourceRefs).toBe(1)
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
