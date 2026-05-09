import { describe, expect, test } from "bun:test"

import {
  buildRecreationPacket,
  buildSceneWriterThreadContextReport,
  compareChapterToPlan,
  comparePlanToReference,
  ModelJsonParseError,
  parseJsonResponseContent,
  plannerUserPrompt,
  parseExampleSceneOutput,
  sceneThreadContextForPrompt,
  sceneWriterUserPrompt,
} from "./corpus-recreation-poc"

describe("corpus-recreation-poc", () => {
  test("builds a structural imitation packet from a reference chapter", () => {
    const packet = buildRecreationPacket({
      reference: reference() as any,
      referencePath: "output/reference.json",
      chapterLabel: "1",
      generatedAt: "2026-05-09T00:00:00.000Z",
    })

    expect(packet.target.sceneCount).toBe(2)
    expect(packet.target.beatCount).toBe(5)
    expect(packet.target.chapterPattern.polaritySequence).toEqual(["-", "+"])
    expect(packet.target.sceneBlueprints[0]!.sourceStructuralDigest).toBe("Source scene structural function.")
    expect(packet.originalAnalogSeed.forbiddenSourceTerms).toContain("Drizzt")
  })

  test("compares plan structure against reference sequence and density", () => {
    const packet = buildRecreationPacket({
      reference: reference() as any,
      referencePath: "output/reference.json",
      chapterLabel: "1",
      generatedAt: "2026-05-09T00:00:00.000Z",
    })
    const comparison = comparePlanToReference(plan(), packet)

    expect(comparison.sceneCount.match).toBe(true)
    expect(comparison.valuePolarity.ratio).toBe(1)
    expect(comparison.miceThread.ratio).toBe(1)
    expect(comparison.beatHintShape.actualTotal).toBe(5)
    expect(comparison.sceneContract.choiceAlternativeCount).toBe(2)
    expect(comparison.sceneContract.declaredObligationCount).toBe(2)
    expect(comparison.sceneContract.knownSourceIdCount).toBe(2)
    expect(comparison.sceneContract.knownThreadRefCount).toBe(2)
    expect(comparison.sceneContract.knownPromiseRefCount).toBe(2)
    expect(comparison.sceneContract.knownPayoffRefCount).toBe(2)
    expect(comparison.sceneContract.orphanPayoffRefCount).toBe(0)
    expect(comparison.sceneContract.observableConsequenceCount).toBe(2)
    expect(comparison.sceneContract.materialityTestCount).toBe(2)
    expect(comparison.issues).toEqual([])
  })

  test("materiality-v1 requires obligation materiality tests", () => {
    const packet = buildRecreationPacket({
      reference: reference() as any,
      referencePath: "output/reference.json",
      chapterLabel: "1",
      generatedAt: "2026-05-09T00:00:00.000Z",
      plannerVariant: "materiality-v1",
    })
    const withoutMateriality = structuredClone(plan())
    for (const obligation of withoutMateriality.obligations) delete (obligation as any).materialityTest

    const comparison = comparePlanToReference(withoutMateriality, packet, { requireMaterialityTests: true })

    expect(comparison.sceneContract.materialityTestCount).toBe(0)
    expect(comparison.issues.some(issue => issue.includes("each obligation needs a materialityTest"))).toBe(true)
  })

  test("materiality-v1 prompt adds volatile materiality instructions", () => {
    const packet = buildRecreationPacket({
      reference: reference() as any,
      referencePath: "output/reference.json",
      chapterLabel: "1",
      generatedAt: "2026-05-09T00:00:00.000Z",
      plannerVariant: "materiality-v1",
    })
    const prompt = plannerUserPrompt(packet, "materiality-v1")

    expect(prompt).toContain("Materiality-v1 diagnostic variant")
    expect(prompt).toContain("changed choice, cost, constraint, relationship state, outcome, or future pressure")
    expect(prompt).toContain("\"plannerVariant\": \"materiality-v1\"")
    expect(prompt).not.toContain("writerContextMode")
  })

  test("thread-context writer arm adds compact per-scene context without changing baseline prompt", () => {
    const packet = buildRecreationPacket({
      reference: reference() as any,
      referencePath: "output/reference.json",
      chapterLabel: "1",
      generatedAt: "2026-05-09T00:00:00.000Z",
      writerContextMode: "thread-context-v1",
    })
    const threadedPlan = structuredClone(plan())
    threadedPlan.obligations.push({
      obligationId: "obl-key-aftershock",
      sceneId: "analog-sc02",
      sourceId: "debt-key-cost",
      threadId: "thread-key-cost",
      promiseId: "debt-key-cost",
      requirementText: "The key's public cost continues into the gatehouse scene.",
      materialityTest: "The key cost changes Nara's next route.",
    })

    const baselinePrompt = sceneWriterUserPrompt(packet, threadedPlan, threadedPlan.scenes[0]!)
    const contextPrompt = sceneWriterUserPrompt(packet, threadedPlan, threadedPlan.scenes[0]!, undefined, {
      writerContextMode: "thread-context-v1",
    })
    const context = sceneThreadContextForPrompt(packet, threadedPlan, threadedPlan.scenes[0]!)
    const report = buildSceneWriterThreadContextReport(packet, threadedPlan)

    expect(baselinePrompt).not.toContain("Thread context packet")
    expect(contextPrompt).toContain("Thread context packet (diagnostic writer-context arm)")
    expect(contextPrompt).toContain("\"activeThreads\"")
    expect(contextPrompt).toContain("\"thread-key-cost\"")
    expect(context.futureImpactPreview).toEqual(expect.arrayContaining([
      expect.objectContaining({
        refKind: "thread",
        ref: "thread-key-cost",
        affectedSceneIds: ["analog-sc02"],
      }),
    ]))
    expect(report.mode).toBe("thread-context-v1")
    expect(report.sceneCount).toBe(threadedPlan.scenes.length)
    expect(report.contexts[0]).toEqual(context)
  })

  test("does not infer pressure from seed word overlap", () => {
    const packet = buildRecreationPacket({
      reference: reference() as any,
      referencePath: "output/reference.json",
      chapterLabel: "1",
      generatedAt: "2026-05-09T00:00:00.000Z",
    })
    const planWithoutObligations = { ...plan(), obligations: [] }

    const comparison = comparePlanToReference(planWithoutObligations, packet)

    expect(comparison.sceneContract.declaredObligationCount).toBe(0)
    expect(comparison.sceneContract.knownSourceIdCount).toBe(0)
    expect(comparison.issues.some(issue => issue.includes("scene lacks explicit obligation sourceIds"))).toBe(true)
  })

  test("flags missing or mismatched thread and payoff refs deterministically", () => {
    const packet = buildRecreationPacket({
      reference: reference() as any,
      referencePath: "output/reference.json",
      chapterLabel: "1",
      generatedAt: "2026-05-09T00:00:00.000Z",
    })
    const badPlan = structuredClone(plan())
    delete (badPlan.obligations[0] as any).threadId
    badPlan.obligations[1] = {
      ...badPlan.obligations[1]!,
      threadId: "thread-missing",
      promiseId: "debt-oathmark",
      payoffId: "payoff-key-cost-exposure",
    }
    badPlan.obligations.push({
      obligationId: "obl-thread-mismatch",
      sceneId: "analog-sc02",
      sourceId: "char-tovin-ash",
      threadId: "thread-tovin-leverage",
      promiseId: "debt-oathmark",
      payoffId: "payoff-oathmark-public-confession",
      requirementText: "Tovin pressures Nara through a mismatched promise.",
      materialityTest: "Tovin changes Nara's choices through leverage.",
    })

    const comparison = comparePlanToReference(badPlan, packet)

    expect(comparison.sceneContract.knownThreadRefCount).toBe(0)
    expect(comparison.sceneContract.orphanPayoffRefCount).toBe(1)
    expect(comparison.sceneContract.promiseThreadMismatchCount).toBe(1)
    expect(comparison.sceneContract.payoffThreadMismatchCount).toBe(1)
    expect(comparison.issues.some(issue => issue.includes("obligations missing threadId: obl-key-heat"))).toBe(true)
    expect(comparison.issues.some(issue => issue.includes("unknown threadIds: thread-missing"))).toBe(true)
    expect(comparison.issues.some(issue => issue.includes("payoffIds do not belong to declared promiseId: payoff-key-cost-exposure"))).toBe(true)
    expect(comparison.issues.some(issue => issue.includes("promiseIds belong to different threadId: obl-thread-mismatch:debt-oathmark"))).toBe(true)
    expect(comparison.issues.some(issue => issue.includes("payoffIds belong to different threadId: obl-thread-mismatch:payoff-oathmark-public-confession"))).toBe(true)
  })

  test("flags weak upstream scene contracts before prose generation", () => {
    const packet = buildRecreationPacket({
      reference: reference() as any,
      referencePath: "output/reference.json",
      chapterLabel: "1",
      generatedAt: "2026-05-09T00:00:00.000Z",
    })
    const weakPlan = structuredClone(plan())
    weakPlan.scenes[0] = {
      ...weakPlan.scenes[0]!,
      goal: "Nara waits for a chance.",
      opposition: "The weather is difficult.",
      turningPoint: "The path feels dangerous.",
      crisisChoice: "Nara considers what to do next.",
      choiceAlternatives: [],
      climaxAction: "Nara keeps going.",
      outcome: "The situation changes.",
      consequence: "Nara realizes things changed.",
      beatHints: [
        { kind: "description", boundarySignal: "scene_start", gapSize: "medium", purpose: "Nara waits" },
        { kind: "action", boundarySignal: "stakes_recalibration", gapSize: "medium", purpose: "danger rises" },
        { kind: "action", boundarySignal: "stakes_recalibration", gapSize: "medium", purpose: "Nara continues" },
      ],
    }
    weakPlan.obligations = weakPlan.obligations.filter(obligation => obligation.sceneId !== "analog-sc01")

    const comparison = comparePlanToReference(weakPlan, packet)

    expect(comparison.sceneContract.scenes[0]).toMatchObject({
      hasChoiceAlternatives: false,
      hasDeclaredObligation: false,
      hasKnownSourceIds: false,
      hasObservableConsequence: false,
      unknownSourceIds: [],
      promiseThreadMismatchIds: [],
      payoffThreadMismatchIds: [],
    })
    expect(comparison.issues.some(issue => issue.includes("scene contract weak for analog-sc01"))).toBe(true)
  })

  test("flags forbidden source terms in generated chapter", () => {
    const packet = buildRecreationPacket({
      reference: reference() as any,
      referencePath: "output/reference.json",
      chapterLabel: "1",
      generatedAt: "2026-05-09T00:00:00.000Z",
    })
    const comparison = compareChapterToPlan({
      chapterTitle: "Analog",
      scenes: [
        { sceneId: "analog-sc01", prose: "Nara moves through the gate." },
        { sceneId: "analog-sc02", prose: "Drizzt is not allowed here." },
      ],
      fullProse: `${"Nara moves through the gate. ".repeat(60)} Drizzt is not allowed here.`,
    }, plan(), packet)

    expect(comparison.sourceBoundary.forbiddenTermsPresent).toEqual(["Drizzt"])
    expect(comparison.issues.some(issue => issue.includes("source terms"))).toBe(true)
  })

  test("reports per-scene prose advisory floors as warnings", () => {
    const packet = buildRecreationPacket({
      reference: reference() as any,
      referencePath: "output/reference.json",
      chapterLabel: "1",
      generatedAt: "2026-05-09T00:00:00.000Z",
    })
    const comparison = compareChapterToPlan({
      chapterTitle: "Analog",
      scenes: [
        { sceneId: "analog-sc01", prose: "Nara chooses the hard road. ".repeat(120) },
        { sceneId: "analog-sc02", prose: "Nara pauses." },
      ],
      fullProse: "",
    }, plan(), packet)

    expect(comparison.sceneWordCounts[0]!.meetsMinimum).toBe(true)
    expect(comparison.sceneWordCounts[1]!.meetsMinimum).toBe(false)
    expect(comparison.issues.some(issue => issue.includes("scene prose below"))).toBe(false)
    expect(comparison.warnings.some(warning => warning.includes("scene prose below advisory floor"))).toBe(true)
  })

  test("wraps malformed model JSON as retryable parse evidence", () => {
    expect(() => parseJsonResponseContent("scene", "{\"sceneId\":\"x\""))
      .toThrow(ModelJsonParseError)
  })

  test("scene parser strips harmless model echoes while enforcing scene id", () => {
    const parsed = parseExampleSceneOutput({
      sceneId: "scene-a",
      prose: "Nara chooses the hard road while the bells shake frost from the gatehouse stones.",
      minimumWords: 120,
    }, "scene-a")

    expect(parsed).toEqual({
      sceneId: "scene-a",
      prose: "Nara chooses the hard road while the bells shake frost from the gatehouse stones.",
    })
    expect(() => parseExampleSceneOutput({
      sceneId: "scene-b",
      prose: "Nara chooses the hard road while the bells shake frost from the gatehouse stones.",
    }, "scene-a")).toThrow("scene output id mismatch")
  })
})

function reference() {
  return {
    schemaVersion: "1.0",
    generatedAt: "2026-05-09T00:00:00.000Z",
    source: {
      novel: "test",
      book: "test_book",
      scenesPath: "scenes",
      beatsPath: "beats",
      valueChargePath: null,
      micePath: null,
      mckeeGapPath: null,
    },
    mode: { includeSummaries: true },
    aggregate: {
      chapterCount: 1,
      sceneCount: 2,
      beatCount: 5,
      wordCount: 1000,
      medianScenesPerChapter: 2,
      medianBeatsPerScene: 2.5,
      medianWordsPerScene: 500,
      medianWordsPerBeat: 100,
      meanScenesPerChapter: 2,
      meanBeatsPerScene: 2.5,
      meanWordsPerScene: 500,
      meanWordsPerBeat: 100,
    },
    chapters: [{
      chapterLabel: "1",
      chapterIndex: 1,
      sceneCount: 2,
      beatCount: 5,
      wordCount: 1000,
      averageBeatsPerScene: 2.5,
      beatKindCounts: {},
      boundarySignalCounts: {},
      scenePolarityCounts: {},
      micePrimaryCounts: {},
      gapSizeCounts: {},
      scenes: [
        {
          sceneId: "source-sc01",
          chapterLabel: "1",
          sceneOrdinal: 0,
          wordCount: 600,
          beatCount: 3,
          beatKindCounts: { description: 1, action: 2 },
          boundarySignalCounts: { scene_start: 1, stakes_recalibration: 2 },
          gapSizeCounts: { medium: 2 },
          valueShift: { valueIn: "+", valueOut: "-", lifeValue: "power-weakness", polarity: "-" },
          mice: { primaryThread: "M", secondaryThread: null, opensThread: true, closesThread: false },
          plotPointSummary: "Source scene structural function.",
          beatSummaries: ["setup pressure", "turn pressure", "outcome pressure"],
        },
        {
          sceneId: "source-sc02",
          chapterLabel: "1",
          sceneOrdinal: 1,
          wordCount: 400,
          beatCount: 2,
          beatKindCounts: { dialogue: 2 },
          boundarySignalCounts: { scene_start: 1, action_shift: 1 },
          gapSizeCounts: { large: 1 },
          valueShift: { valueIn: "-", valueOut: "+", lifeValue: "hope-despair", polarity: "+" },
          mice: { primaryThread: "C", secondaryThread: null, opensThread: true, closesThread: false },
        },
      ],
    }],
  }
}

function plan() {
  return {
    chapterId: "analog-ch01",
    title: "The First Gate",
    targetWords: 1000,
    chapterFunction: "Open the artifact pressure and force Nara into public risk.",
    endpointOrHook: "Nara crosses the ward line knowing the bells may expose her.",
    scenes: [
      {
        sceneId: "analog-sc01",
        referenceSceneOrdinal: 0,
        targetWords: 600,
        structuralRole: "Establish pressure and reverse safety.",
        povCharacterId: "char-nara-venn",
        locationOrArena: "frontier road",
        goal: "Nara wants quiet entry.",
        opposition: "The key heats and Tovin watches.",
        turningPoint: "The road opens toward danger.",
        crisisChoice: "Hide the key for a clean escape or risk the gate to protect her oathmark.",
        choiceAlternatives: [
          "Hide the key for a clean escape",
          "risk the gate to protect her oathmark",
        ],
        climaxAction: "Nara uses the key.",
        outcome: "The key exposes danger.",
        consequence: "The ward may reveal her.",
        valueIn: "+",
        valueOut: "-",
        miceThread: "M",
        beatHints: [
          { kind: "description", boundarySignal: "scene_start", gapSize: "medium", purpose: "setup" },
          { kind: "action", boundarySignal: "stakes_recalibration", gapSize: "medium", purpose: "turn" },
          { kind: "action", boundarySignal: "stakes_recalibration", gapSize: "medium", purpose: "outcome" },
        ],
      },
      {
        sceneId: "analog-sc02",
        referenceSceneOrdinal: 1,
        targetWords: 400,
        structuralRole: "Make a character choice visible.",
        povCharacterId: "char-nara-venn",
        locationOrArena: "gatehouse",
        goal: "Nara wants entry.",
        opposition: "Kael demands a name.",
        turningPoint: "Mirel offers witness.",
        crisisChoice: "Confess the lost convoy before witnesses or lose entry.",
        choiceAlternatives: [
          "confess the lost convoy before witnesses",
          "lose entry and preserve secrecy",
        ],
        climaxAction: "Nara names the convoy.",
        outcome: "The bell quiets.",
        consequence: "Tovin gains public leverage over her route.",
        valueIn: "-",
        valueOut: "+",
        miceThread: "C",
        beatHints: [
          { kind: "dialogue", boundarySignal: "scene_start", gapSize: "large", purpose: "demand" },
          { kind: "dialogue", boundarySignal: "action_shift", gapSize: "large", purpose: "choice" },
        ],
      },
    ],
    obligations: [
      {
        obligationId: "obl-key-heat",
        sceneId: "analog-sc01",
        sourceId: "world-sun-metal-key",
        threadId: "thread-key-cost",
        promiseId: "debt-key-cost",
        payoffId: "payoff-key-cost-exposure",
        requirementText: "The sun-metal key must pressure Nara's choice at the gate.",
        materialityTest: "The key changes whether Nara can risk a clean escape or must face the gate.",
      },
      {
        obligationId: "obl-tovin-leverage",
        sceneId: "analog-sc02",
        sourceId: "char-tovin-ash",
        threadId: "thread-tovin-leverage",
        requirementText: "Tovin must gain leverage from Nara's public choice.",
        materialityTest: "Tovin gains public leverage that changes Nara's available route.",
      },
    ],
  }
}
