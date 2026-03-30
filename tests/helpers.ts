import { rmSync } from "node:fs"
import { initDB, createNovel } from "../src/db"
import type {
  SeedInput, WorldBible, CharacterProfile, StorySpine,
  ChapterOutline, SceneBeat,
} from "../src/types"

// Track test DBs for cleanup
const testDirs: string[] = []

export function setupTestDB(novelId?: string): string {
  const id = novelId ?? `test-${crypto.randomUUID()}`
  initDB(id)
  testDirs.push(`output/${id}`)
  return id
}

export function setupTestNovel(novelId?: string): string {
  const id = setupTestDB(novelId)
  createNovel(id, makeSeedInput())
  return id
}

export function cleanupTestDBs(): void {
  for (const dir of testDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
  testDirs.length = 0
}

// ── Fixtures ───────────────────────────────────────────────────────────────

export function makeSeedInput(): SeedInput {
  return {
    premise: "In a crumbling desert city, a disgraced general discovers the empire she served is built on a lie.",
    genre: "epic fantasy",
    characters: [
      { name: "Kael", role: "protagonist", description: "A disgraced general haunted by the siege she led. Sharp mind, bitter tongue." },
      { name: "Rina", role: "antagonist", description: "The empire's spymaster who knows the truth and will kill to keep it hidden." },
    ],
  }
}

export function makeWorldBible(): WorldBible {
  return {
    setting: "The Ashen Expanse — a vast desert continent dominated by the Solaran Empire",
    timePeriod: "Post-imperial decline, roughly analogous to late Roman Empire",
    rules: [
      "Magic is drawn from sunlight and costs physical vitality",
      "The desert is expanding due to overuse of solar magic",
    ],
    locations: [
      { name: "Dust Throne", description: "The crumbling capital city, half-buried in sand" },
      { name: "The Glass Wastes", description: "A region of fused sand from an ancient magical catastrophe" },
    ],
    culture: "A rigid caste system based on proximity to the Sun Court. Lower castes live in underground warrens.",
    history: "The Solaran Empire conquered the continent 300 years ago using solar magic. The original inhabitants were driven underground.",
  }
}

export function makeCharacterProfile(overrides?: Partial<CharacterProfile>): CharacterProfile {
  return {
    id: "char_kael",
    name: "Kael",
    role: "protagonist",
    backstory: "Kael rose through the ranks of the Solaran military through sheer tactical brilliance. She led the Siege of Ashveil, which broke the last free city. The victory haunts her — she saw what the empire did to the survivors. When she questioned the emperor's orders, she was stripped of rank and exiled to the frontier.",
    traits: ["strategically brilliant", "bitter and self-punishing", "fiercely loyal to individuals but distrustful of institutions", "drinks too much", "never backs down from an argument"],
    speechPattern: "Short, clipped sentences. Military jargon bleeds into casual speech. Uses dark humor as a shield. Never says 'please'.",
    goals: "Expose the empire's founding lie and bring down the Sun Court",
    fears: "That she's too late — that the lie has become the truth and nothing she does will matter",
    relationships: [
      { characterName: "Rina", nature: "Former comrade turned enemy — they served together before Kael's disgrace" },
    ],
    ...overrides,
  }
}

export function makeCharacterProfileRina(): CharacterProfile {
  return {
    id: "char_rina",
    name: "Rina",
    role: "antagonist",
    backstory: "Rina grew up in the underground warrens and clawed her way into the Sun Court through intelligence work. She knows the empire's secrets and has decided that the lie is necessary to prevent collapse.",
    traits: ["calculating", "patient", "believes the ends justify the means", "lonely", "respects competence"],
    speechPattern: "Formal, precise language. Never raises her voice. Asks questions instead of making accusations.",
    goals: "Maintain the empire's stability at any cost",
    fears: "Chaos — she remembers the warrens and will do anything to prevent a return to that",
    relationships: [
      { characterName: "Kael", nature: "Former comrade — respects her but considers her dangerously naive" },
    ],
  }
}

export function makeStorySpine(): StorySpine {
  return {
    acts: [
      { number: 1, name: "The Discovery", summary: "Kael finds evidence of the founding lie while investigating a border incident. Rina becomes aware of Kael's investigation.", emotionalArc: "curiosity building to dread" },
      { number: 2, name: "The Pursuit", summary: "Kael gathers allies and evidence while Rina closes in. The truth is worse than Kael imagined.", emotionalArc: "determination crumbling into despair" },
      { number: 3, name: "The Reckoning", summary: "Kael must choose between exposing the truth (which could collapse the empire) or burying it (which perpetuates the injustice).", emotionalArc: "resolve through sacrifice" },
    ],
    centralConflict: "Truth vs. stability — is a just empire built on a lie worth preserving?",
    theme: "The cost of complicity",
    endingDirection: "Bittersweet — the truth comes out but the cost is devastating",
  }
}

export function makeChapterOutline(overrides?: Partial<ChapterOutline>): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Sand and Ashes",
    povCharacter: "Kael",
    setting: "Dust Throne",
    purpose: "Introduce Kael in exile, establish the world, plant the first clue about the lie",
    scenes: [
      {
        description: "Kael drinks alone in a frontier tavern when a messenger arrives with orders to return to the capital",
        characters: ["Kael"],
        emotionalShift: "resignation → reluctant curiosity",
      },
      {
        description: "Kael arrives at the Dust Throne and meets Rina, who warns her to leave the investigation alone",
        characters: ["Kael", "Rina"],
        emotionalShift: "guarded → suspicious",
      },
    ],
    targetWords: 2500,
    charactersPresent: ["Kael", "Rina"],
    ...overrides,
  }
}

export function makeChapterDraft(wordTarget: number = 2500): string {
  const base = `Kael sat alone at the bar, nursing a drink that tasted like sand and regret. The frontier tavern was half-empty, as it always was this time of year. She traced a finger along the rim of her glass and thought about the siege.

Rina appeared at the doorway, her shadow stretching long across the dusty floor. "General," she said, though the title no longer applied. "You look terrible."

"I feel worse," Kael replied. She didn't look up. "What do you want?"

"The Sun Court has questions. About the border incident." Rina sat down across from her, uninvited. Her eyes were sharp, calculating, the way they'd always been. "You should come back to the capital."

Kael finally met her gaze. "And if I don't?"

"Then I'll have to be less polite about it." Rina smiled, but it didn't reach her eyes. "We served together once, Kael. I'm trying to do this the easy way."

The wind howled outside, carrying dust through the cracks in the walls. Kael thought about the documents she'd found — the ones that didn't match the official histories. The ones that suggested everything she'd fought for was built on a foundation of lies.`

  const baseWords = base.split(/\s+/).filter(Boolean).length
  if (baseWords >= wordTarget) return base

  // Pad with filler paragraphs
  const filler = "The desert stretched endlessly beyond the city walls, its dunes shifting in patterns that seemed almost deliberate. Ancient ruins dotted the landscape, half-buried monuments to a civilization the empire claimed never existed. Kael had walked among those ruins during her exile, reading inscriptions that contradicted everything the Sun Court taught. "
  const fillerWords = filler.split(/\s+/).filter(Boolean).length
  const repeats = Math.ceil((wordTarget - baseWords) / fillerWords)

  return base + "\n\n" + Array(repeats).fill(filler).join("\n\n")
}

// ── LLM Mock Helpers ───────────────────────────────────────────────────────

export function makeLLMResponse(body: object | string, status: number = 200): Response {
  const content = typeof body === "string" ? body : JSON.stringify(body)
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export function makeLLMErrorResponse(status: number, message: string = "error"): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
