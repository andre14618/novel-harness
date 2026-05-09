import { expect, test } from "bun:test"

import { buildBeatContext } from "./beat-context"
import {
  buildBeatCharacterContextCapsules,
  renderCharacterContextCapsules,
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
      mustEstablish: [],
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
  expect(rendered).toContain("Active threads: thread-inquiry")
})

test("buildBeatContext keeps legacy prompt shape unless writerContextMode opts in", async () => {
  const baseInput = {
    novelId: "novel-test",
    chapterNumber: 1,
    beatIndex: 0,
    outline: OUTLINE,
    characters: CHARACTERS,
    characterStates: [],
    worldBible: { locations: [] },
    compactMode: true,
    preResolvedRefs: { context: "", lookupCount: 0, llmUsed: false },
  }

  const legacy = await buildBeatContext(baseInput)
  expect(legacy.userPrompt).not.toContain("CHARACTER CONTEXT CAPSULES:")

  const upgraded = await buildBeatContext({
    ...baseInput,
    writerContextMode: "thread-character-context-v1",
  })
  expect(upgraded.userPrompt).toContain("CHARACTER CONTEXT CAPSULES:")
  expect(upgraded.userPrompt).toContain("POV character ID: char-noor")
})
