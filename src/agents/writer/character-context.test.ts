import { expect, test } from "bun:test"

import {
  buildBeatCharacterContextCapsules,
  renderCharacterContextCapsules,
  summarizeCharacterContextCapsules,
} from "./character-context"
import type { ChapterOutline, CharacterProfile } from "../../types"

const CHARACTERS: CharacterProfile[] = [
  {
    id: "char-noor",
    name: "Noor",
    role: "protagonist",
    backstory: "",
    traits: ["precise"],
    speechPattern: "Careful, clipped questions.",
    internalConflict: "She wants certainty but survives by doubt.",
    avoids: "Admitting she needs help.",
    goals: "Preserve forbidden records.",
    fears: "Being erased from the archive.",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: ["If the margin wrote itself, it wanted a witness."],
    lie: "Truth can be preserved alone.",
    truth: "Truth needs witnesses.",
    want: "Recover the missing folio.",
    need: "Trust another keeper.",
  },
  {
    id: "char-cassius",
    name: "Cassius",
    role: "supporting",
    backstory: "",
    traits: ["guarded"],
    speechPattern: "Dry warnings with precise archival vocabulary.",
    goals: "Survive the library's tests.",
    fears: "The Compiler noticing him.",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: ["The stacks do not forget. They rearrange."],
  },
]

const OUTLINE: ChapterOutline = {
  chapterNumber: 1,
  title: "The Deep Stacks",
  chapterId: "ch-001-deep-stacks",
  povCharacter: "Noor",
  povCharacterId: "char-noor",
  setting: "Deep Stacks",
  purpose: "Noor learns the library is changing history.",
  targetWords: 1500,
  charactersPresent: ["Noor", "Cassius"],
  charactersPresentIds: ["char-noor", "char-cassius"],
  establishedFacts: [],
  characterStateChanges: [],
  knowledgeChanges: [],
  scenes: [{
    beatId: "beat-001-trust-choice",
    description: "Noor chooses whether to trust Cassius with the folio.",
    povPersonalStake: "Noor's need to be useful conflicts with her fear of being erased.",
    characters: ["Noor", "Cassius"],
    kind: "dialogue",
    requiredPayoffs: [],
    obligations: {
      mustEstablish: [{
        text: "The folio's red marginalia predicts a succession crime.",
        obligationId: "obl-folio-promise",
        threadId: "thread-inquiry",
        promiseId: "debt-folio",
        payoffId: "payoff-folio-prediction",
      } as any],
      mustPayOff: [],
      mustTransferKnowledge: [{
        text: "Noor learns Cassius has survived the library's tests.",
        obligationId: "obl-noor-learns-cassius",
        characterId: "char-noor",
        threadId: "thread-inquiry",
        promiseId: "debt-folio",
      } as any],
      mustShowStateChange: [{
        text: "Cassius shifts from warning Noor away to helping her.",
        obligationId: "obl-cassius-helps",
        characterId: "char-cassius",
        threadId: "thread-relationship",
      } as any],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
  }],
}

test("beat character capsules surface exact IDs, LTWN fields, stakes, and obligation links", () => {
  const capsules = buildBeatCharacterContextCapsules({
    outline: OUTLINE,
    beat: OUTLINE.scenes[0]!,
    beatIndex: 0,
    characters: CHARACTERS,
    characterStates: [{ characterId: "char-noor", emotionalState: "alert and isolated" }],
  })

  expect(capsules).not.toBeNull()
  expect(capsules?.povPersonalStake).toContain("need to be useful")
  const rendered = renderCharacterContextCapsules(capsules!)
  expect(rendered).toContain("CHARACTER CONTEXT CAPSULES:")
  expect(rendered).toContain("- Noor [char-noor] (pov; protagonist)")
  expect(rendered).toContain("Want: Recover the missing folio.")
  expect(rendered).toContain("Need: Trust another keeper.")
  expect(rendered).toContain("Lie: Truth can be preserved alone.")
  expect(rendered).toContain("Truth: Truth needs witnesses.")
  expect(rendered).toContain("Source obligations: obl-noor-learns-cassius")
  expect(rendered).toContain("Active thread refs: thread-inquiry, thread-relationship")
  expect(rendered).toContain("Active promise refs: debt-folio")
  expect(rendered).toContain("Active payoff refs: payoff-folio-prediction")
  expect(rendered).toContain("Active threads: thread-inquiry")
  expect(summarizeCharacterContextCapsules(capsules!)).toMatchObject({
    mode: "thread-character-context-v1",
    scope: "beat",
    chapterId: "ch-001-deep-stacks",
    beatId: "beat-001-trust-choice",
    povPersonalStakePresent: true,
    characterIds: ["char-noor", "char-cassius"],
    sourceObligationIds: ["obl-noor-learns-cassius", "obl-cassius-helps"],
    activeThreadIds: ["thread-inquiry", "thread-relationship"],
    activePromiseIds: ["debt-folio"],
    activePayoffIds: ["payoff-folio-prediction"],
  })
})

test("beat character capsules attach obligation IDs by characterName when source IDs drift", () => {
  const beat = {
    ...OUTLINE.scenes[0]!,
    characters: ["Noor"],
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [{
        text: "Cassius witnesses the folio burn.",
        obligationId: "obl-cassius-witnesses",
        characterId: "char-cassius-legacy",
        characterName: "Cassius",
      } as any],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
  }
  const capsules = buildBeatCharacterContextCapsules({
    outline: OUTLINE,
    beat,
    beatIndex: 0,
    characters: CHARACTERS,
    characterStates: [],
  })

  expect(capsules).not.toBeNull()
  expect(capsules?.missingCharacterIds).toContain("char-cassius-legacy")
  expect(summarizeCharacterContextCapsules(capsules!).sourceObligationIds).toEqual([
    "obl-cassius-witnesses",
  ])
  expect(renderCharacterContextCapsules(capsules!)).toContain("Source obligations: obl-cassius-witnesses")
})

test("renderCharacterContextCapsules with idRendering='raw' is byte-identical to no option (parity)", () => {
  const capsules = buildBeatCharacterContextCapsules({
    outline: OUTLINE,
    beat: OUTLINE.scenes[0]!,
    beatIndex: 0,
    characters: CHARACTERS,
    characterStates: [{ characterId: "char-noor", emotionalState: "alert and isolated" }],
  })
  expect(capsules).not.toBeNull()
  const legacy = renderCharacterContextCapsules(capsules!)
  const withRaw = renderCharacterContextCapsules(capsules!, { idRendering: "raw" })
  expect(withRaw).toBe(legacy)
})

test("renderCharacterContextCapsules with idRendering='suppress' omits Cluster-1 raw-ID lines but keeps semantic content", () => {
  const capsules = buildBeatCharacterContextCapsules({
    outline: OUTLINE,
    beat: OUTLINE.scenes[0]!,
    beatIndex: 0,
    characters: CHARACTERS,
    characterStates: [{ characterId: "char-noor", emotionalState: "alert and isolated" }],
  })
  expect(capsules).not.toBeNull()
  const rendered = renderCharacterContextCapsules(capsules!, { idRendering: "suppress" })

  // Cluster-1 raw-ID lines must be suppressed.
  expect(rendered).not.toContain("Chapter ID:")
  expect(rendered).not.toContain("Beat ID:")
  expect(rendered).not.toContain("POV character ID:")
  expect(rendered).not.toContain("Active thread refs:")
  expect(rendered).not.toContain("Active promise refs:")
  expect(rendered).not.toContain("Active payoff refs:")
  expect(rendered).not.toContain("Missing character IDs:")
  expect(rendered).not.toContain("[char-noor]")
  expect(rendered).not.toContain("[char-cassius]")
  expect(rendered).not.toContain("Source obligations:")
  expect(rendered).not.toContain("Active threads:")
  expect(rendered).not.toContain("Active promises:")
  expect(rendered).not.toContain("Active payoffs:")
  // Raw obligation/thread/promise/payoff IDs must not appear anywhere in the prompt.
  expect(rendered).not.toContain("obl-noor-learns-cassius")
  expect(rendered).not.toContain("thread-inquiry")
  expect(rendered).not.toContain("debt-folio")
  expect(rendered).not.toContain("payoff-folio-prediction")

  // Semantic content stays — character names + want/need/lie/truth/voice/state.
  expect(rendered).toContain("CHARACTER CONTEXT CAPSULES:")
  expect(rendered).toContain("Mode: thread-character-context-v1")
  expect(rendered).toContain("- Noor (pov; protagonist)")
  expect(rendered).toContain("- Cassius (supporting; supporting)")
  expect(rendered).toContain("Want: Recover the missing folio.")
  expect(rendered).toContain("Need: Trust another keeper.")
  expect(rendered).toContain("Lie: Truth can be preserved alone.")
  expect(rendered).toContain("Truth: Truth needs witnesses.")
  expect(rendered).toContain("POV personal stake: Noor")
})

test("renderCharacterContextCapsules suppress mode does NOT mutate the trace summary (IDs stay in metadata)", () => {
  // Per L099: traceability IDs are mandatory infrastructure across DB,
  // telemetry, traces, checker findings, proposals, evals, and audit logs.
  // The ablation flag is render-only; the trace summarizer is unaffected.
  const capsules = buildBeatCharacterContextCapsules({
    outline: OUTLINE,
    beat: OUTLINE.scenes[0]!,
    beatIndex: 0,
    characters: CHARACTERS,
    characterStates: [{ characterId: "char-noor", emotionalState: "alert and isolated" }],
  })
  expect(capsules).not.toBeNull()
  // Render in suppress mode — output drops IDs, but the trace below MUST keep them.
  renderCharacterContextCapsules(capsules!, { idRendering: "suppress" })
  const trace = summarizeCharacterContextCapsules(capsules!)
  expect(trace.chapterId).toBe("ch-001-deep-stacks")
  expect(trace.beatId).toBe("beat-001-trust-choice")
  expect(trace.characterIds).toEqual(["char-noor", "char-cassius"])
  expect(trace.activeThreadIds).toEqual(["thread-inquiry", "thread-relationship"])
  expect(trace.activePromiseIds).toEqual(["debt-folio"])
  expect(trace.activePayoffIds).toEqual(["payoff-folio-prediction"])
  expect(trace.sourceObligationIds).toEqual(["obl-noor-learns-cassius", "obl-cassius-helps"])
})

test("beat character capsules keep story refs even without character cards", () => {
  const beat = {
    ...OUTLINE.scenes[0]!,
    characters: [],
    povPersonalStake: undefined,
    obligations: {
      mustEstablish: [{
        text: "The folio promise moves forward.",
        obligationId: "obl-folio-thread",
        threadId: "thread-inquiry",
        promiseId: "debt-folio",
      } as any],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
  }

  const capsules = buildBeatCharacterContextCapsules({
    outline: { ...OUTLINE, povCharacter: "", povCharacterId: undefined, charactersPresentIds: [] },
    beat,
    beatIndex: 0,
    characters: CHARACTERS,
    characterStates: [],
  })

  expect(capsules?.cards).toEqual([])
  expect(summarizeCharacterContextCapsules(capsules!)).toMatchObject({
    activeThreadIds: ["thread-inquiry"],
    activePromiseIds: ["debt-folio"],
  })
})
