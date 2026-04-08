/**
 * Synthetic training data generator for the chapter-plan-checker.
 *
 * Generates (chapter_plan → chapter_prose → label) pairs across 8 variants:
 *   PASS_CLEAN        — faithful execution
 *   PASS_PARAPHRASE   — dialogue paraphrased, all beats present
 *   PASS_REORDER      — beats in different order
 *   PASS_ATMOSPHERIC  — extra sensory detail, core structure intact
 *   FAIL_MISSING_BEAT — one core beat entirely absent
 *   FAIL_MISSING_CHAR — a listed character never appears in prose
 *   FAIL_REVERSED_ARC — emotional arc of a beat reversed (tense→warm or vv)
 *   FAIL_WRONG_SETTING — prose takes place in a completely different location
 *
 * 10 scenarios × 8 variants = 80 pairs.
 * Uses the exact buildContext() format the live checker uses, so pairs
 * can be replayed through any model for zero-shot agreement testing.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... bun scripts/generate-chapter-plan-data.ts
 */

import { appendFileSync, existsSync, unlinkSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import { buildContext } from "../src/agents/chapter-plan-checker/context"
import type { ChapterOutline } from "../src/agents/planning-plotter/schema"

const OUT_PATH = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs.jsonl")
const SYSTEM_PROMPT = await Bun.file(
  join(import.meta.dir, "../src/agents/chapter-plan-checker/prompt.md")
).text()

// ── Scenarios ────────────────────────────────────────────────────────────

interface ChapterScenario {
  id: string
  outline: ChapterOutline
}

const SCENARIOS: ChapterScenario[] = [
  {
    id: "medicine_return",
    outline: {
      chapterNumber: 1,
      title: "The Last Draught",
      povCharacter: "Hal",
      setting: "A small village apothecary, late afternoon, rain beginning outside",
      purpose: "Show Hal's desperation and Vira's moral compromise",
      targetWords: 1000,
      charactersPresent: ["Hal", "Vira"],
      scenes: [
        { description: "Hal arrives at Vira's apothecary soaked from the road and demands the last fever draught", characters: ["Hal", "Vira"], emotionalShift: "desperation meets caution" },
        { description: "Vira refuses because the draught is reserved for another paying client", characters: ["Vira", "Hal"], emotionalShift: "caution hardens into refusal" },
        { description: "Hal reveals his mother is dying and offers his sword as collateral", characters: ["Hal", "Vira"], emotionalShift: "raw vulnerability breaks through" },
        { description: "Vira relents and hands over the draught, takes the sword as payment", characters: ["Vira", "Hal"], emotionalShift: "refusal yields to reluctant compassion" },
      ],
      establishedFacts: [
        { fact: "Vira kept the last fever draught reserved for another paying client", category: "rule" },
        { fact: "Hal's mother is dying of fever", category: "knowledge" },
        { fact: "Hal leaves his sword with Vira as collateral for the draught", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Hal", location: "Vira's apothecary", emotionalState: "relieved but indebted", knows: ["Vira gave up the reserved draught for him"], doesNotKnow: [] },
        { name: "Vira", location: "her apothecary", emotionalState: "worried about her other client", knows: ["Hal's mother is dying of fever"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Vira", knowledge: "Hal's mother is dying of fever", source: "told" },
      ],
    },
  },
  {
    id: "thieves_quarrel",
    outline: {
      chapterNumber: 1,
      title: "Uneven Halves",
      povCharacter: "Rix",
      setting: "An abandoned mill at night, moonlight through broken boards",
      purpose: "Fracture the thieves' trust by surfacing their different risk tolerances",
      targetWords: 1000,
      charactersPresent: ["Rix", "Dorna"],
      scenes: [
        { description: "Rix and Dorna lay out the stolen coins on the mill floor and begin counting", characters: ["Rix", "Dorna"], emotionalShift: "tense relief at survival" },
        { description: "Dorna claims a larger share because she was the one who ran the risk of being seen", characters: ["Dorna", "Rix"], emotionalShift: "relief curdles to suspicion" },
        { description: "Rix counters that the plan was his and points a knife at Dorna", characters: ["Rix", "Dorna"], emotionalShift: "suspicion escalates to open threat" },
        { description: "Dorna backs down, takes the even half, but vows silently this is the last job with Rix", characters: ["Dorna", "Rix"], emotionalShift: "threat settles into cold calculation" },
      ],
      establishedFacts: [
        { fact: "The take from the job is a pouch of gold coins", category: "physical" },
        { fact: "Rix planned the job; Dorna executed the exposed part", category: "knowledge" },
        { fact: "Dorna privately decides this is her last job with Rix", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "Rix", location: "abandoned mill", emotionalState: "possessive and defensive", knows: ["Dorna is unhappy with the split"], doesNotKnow: ["Dorna plans to leave him"] },
        { name: "Dorna", location: "abandoned mill", emotionalState: "cold and resolved", knows: ["Rix will pull a knife rather than negotiate"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Dorna", knowledge: "Rix will pull a weapon under pressure", source: "witnessed" },
      ],
    },
  },
  {
    id: "mayor_grain",
    outline: {
      chapterNumber: 1,
      title: "The Granary Door",
      povCharacter: "Mayor Tomas",
      setting: "The mayor's office above the town granary, midmorning",
      purpose: "Force Tomas to make a visible choice between two desperate petitioners",
      targetWords: 1000,
      charactersPresent: ["Tomas", "Anse", "Leth"],
      scenes: [
        { description: "Anse, a farmer, enters and begs for grain to feed his children through winter", characters: ["Anse", "Tomas"], emotionalShift: "pleading hope" },
        { description: "Leth, a blacksmith, enters next and demands grain owed to him for wagon repairs", characters: ["Leth", "Tomas"], emotionalShift: "entitled insistence" },
        { description: "Tomas tells both men the granary has only enough for one and must choose between them", characters: ["Tomas", "Anse", "Leth"], emotionalShift: "hope and entitlement both turn to dread" },
        { description: "Tomas chooses Anse, citing the children; Leth leaves furious and threatens to withhold future work", characters: ["Tomas", "Leth", "Anse"], emotionalShift: "dread resolves to anger and relief" },
      ],
      establishedFacts: [
        { fact: "The town granary has enough grain for only one of the two petitioners", category: "physical" },
        { fact: "Leth is owed grain for wagon repairs he already did", category: "relationship" },
        { fact: "Leth has threatened to withhold future work from the town", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Tomas", location: "mayor's office", emotionalState: "uneasy about the consequences", knows: ["Leth may withhold labor from the town"], doesNotKnow: [] },
        { name: "Anse", location: "mayor's office", emotionalState: "relieved and grateful", knows: ["The mayor prioritized his children"], doesNotKnow: [] },
        { name: "Leth", location: "leaving the mayor's office", emotionalState: "furious and betrayed", knows: ["The mayor chose Anse over him"], doesNotKnow: [] },
      ],
      knowledgeChanges: [],
    },
  },
  {
    id: "night_road",
    outline: {
      chapterNumber: 1,
      title: "What the Dark Knows",
      povCharacter: "Maren",
      setting: "A narrow forest road at night, a single lantern swinging from the wagon",
      purpose: "Plant the seed that the stranger is not what he appears",
      targetWords: 1000,
      charactersPresent: ["Maren", "Corv", "the stranger"],
      scenes: [
        { description: "Maren the merchant and Corv her hired guard drive a cargo wagon through the dark forest road", characters: ["Maren", "Corv"], emotionalShift: "wary but routine" },
        { description: "A hooded stranger appears in the road ahead and asks for a ride to the next town", characters: ["the stranger", "Maren", "Corv"], emotionalShift: "wariness sharpens to suspicion" },
        { description: "Corv wants to refuse but Maren, pitying the cold, lets the stranger climb on the back", characters: ["Maren", "Corv", "the stranger"], emotionalShift: "suspicion yields to reluctant charity" },
        { description: "As they ride on, Maren notices the stranger's boots are clean and dry — impossible for someone walking the rain-soaked road", characters: ["Maren", "the stranger"], emotionalShift: "charity curdles into silent dread" },
      ],
      establishedFacts: [
        { fact: "The stranger's boots are clean and dry despite the rain-soaked road", category: "physical" },
        { fact: "Maren pitied the stranger and overrode Corv's objection", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Maren", location: "driving the wagon", emotionalState: "silently afraid", knows: ["The stranger's boots are impossibly clean"], doesNotKnow: ["Who or what the stranger actually is"] },
        { name: "Corv", location: "the wagon bench beside Maren", emotionalState: "uneasy and resentful", knows: ["Maren overrode his objection"], doesNotKnow: ["What Maren noticed about the boots"] },
      ],
      knowledgeChanges: [
        { characterName: "Maren", knowledge: "The stranger's boots are dry despite walking the wet road", source: "witnessed" },
      ],
    },
  },
  {
    id: "kitchen_confession",
    outline: {
      chapterNumber: 1,
      title: "Knives and Secrets",
      povCharacter: "Petra",
      setting: "The castle kitchen in the dead hours before dawn, banked fire, long tables",
      purpose: "Surface a dangerous household secret through a forced confession",
      targetWords: 1000,
      charactersPresent: ["Petra", "Cook Tilda"],
      scenes: [
        { description: "Petra the maid enters the sleeping kitchen and finds Cook Tilda already awake, kneading bread", characters: ["Petra", "Tilda"], emotionalShift: "nervous determination" },
        { description: "Petra tries to make small talk but Tilda sees through it and demands Petra spit out what she came for", characters: ["Tilda", "Petra"], emotionalShift: "small-talk tension breaks open" },
        { description: "Petra confesses she saw Lord Ansel with a woman who was not his wife in the east corridor", characters: ["Petra", "Tilda"], emotionalShift: "dread and admission" },
        { description: "Tilda warns Petra that knowing this will destroy her and hands her a sharp kitchen knife to keep for protection", characters: ["Tilda", "Petra"], emotionalShift: "admission hardens into grim alliance" },
      ],
      establishedFacts: [
        { fact: "Lord Ansel was seen with a woman who was not his wife", category: "knowledge" },
        { fact: "Tilda gives Petra a kitchen knife for her own protection", category: "physical" },
      ],
      characterStateChanges: [
        { name: "Petra", location: "castle kitchen", emotionalState: "frightened but no longer alone", knows: ["Tilda believes the secret is dangerous to know"], doesNotKnow: [] },
        { name: "Tilda", location: "her kitchen", emotionalState: "grim and protective", knows: ["Lord Ansel was seen with a woman who was not his wife"], doesNotKnow: ["Who the other woman is"] },
      ],
      knowledgeChanges: [
        { characterName: "Tilda", knowledge: "Lord Ansel was seen with a woman who was not his wife", source: "told" },
      ],
    },
  },
  {
    id: "letter_arrival",
    outline: {
      chapterNumber: 1,
      title: "The Summons",
      povCharacter: "Lady Oria",
      setting: "Lady Oria's private solar, morning light through stained glass",
      purpose: "Pivot Oria's travel plans on a single piece of news",
      targetWords: 1000,
      charactersPresent: ["Lady Oria", "Fenn the steward"],
      scenes: [
        { description: "Fenn the steward enters the solar and delivers a sealed letter to Lady Oria", characters: ["Fenn", "Lady Oria"], emotionalShift: "ordinary morning routine" },
        { description: "Oria breaks the seal, reads the letter, and her face drains of color", characters: ["Lady Oria"], emotionalShift: "routine fractures into shock" },
        { description: "Oria tells Fenn to cancel her planned journey to the southern estate and instead prepare horses for the northern capital", characters: ["Lady Oria", "Fenn"], emotionalShift: "shock congeals into cold purpose" },
        { description: "Fenn asks what the letter said but Oria refuses to answer, only says they ride before noon", characters: ["Fenn", "Lady Oria"], emotionalShift: "cold purpose becomes unbreakable secrecy" },
      ],
      establishedFacts: [
        { fact: "Lady Oria's original plan was to travel to the southern estate", category: "knowledge" },
        { fact: "After the letter Oria decides instead to ride north to the capital", category: "knowledge" },
        { fact: "Oria refuses to tell Fenn the contents of the letter", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Lady Oria", location: "her solar", emotionalState: "shaken but resolved", knows: ["Whatever the letter contained"], doesNotKnow: [] },
        { name: "Fenn", location: "Oria's solar", emotionalState: "uneasy about his mistress's secrecy", knows: ["Oria changed her travel plans after reading a letter"], doesNotKnow: ["What the letter contained"] },
      ],
      knowledgeChanges: [
        { characterName: "Lady Oria", knowledge: "The contents of the urgent letter", source: "read" },
      ],
    },
  },
  {
    id: "apprentice_challenge",
    outline: {
      chapterNumber: 1,
      title: "The Bent Practice Blade",
      povCharacter: "Ser Eddon",
      setting: "The castle training yard at dawn, frost on the packed dirt",
      purpose: "Show Eddon's reluctant lesson to a cocky apprentice",
      targetWords: 1000,
      charactersPresent: ["Ser Eddon", "Jor"],
      scenes: [
        { description: "Jor the apprentice swaggers into the training yard and challenges Ser Eddon to a sparring match in front of the watching recruits", characters: ["Jor", "Ser Eddon"], emotionalShift: "cocky challenge" },
        { description: "Ser Eddon refuses at first, calling it a waste of a cold morning", characters: ["Ser Eddon"], emotionalShift: "weary dismissal" },
        { description: "Jor accuses Eddon of fearing him; Eddon's patience snaps and he accepts", characters: ["Jor", "Ser Eddon"], emotionalShift: "dismissal flips to cold acceptance" },
        { description: "They fight briefly; Eddon disarms Jor in four passes and bends Jor's practice blade under his boot to make the lesson unmissable", characters: ["Ser Eddon", "Jor"], emotionalShift: "acceptance finishes as stern lesson" },
      ],
      establishedFacts: [
        { fact: "Ser Eddon disarmed Jor in four passes during the sparring", category: "physical" },
        { fact: "Eddon bent Jor's practice blade under his boot as a lesson", category: "physical" },
      ],
      characterStateChanges: [
        { name: "Ser Eddon", location: "training yard", emotionalState: "grimly satisfied", knows: ["Jor needs public humbling to learn"], doesNotKnow: [] },
        { name: "Jor", location: "training yard", emotionalState: "humiliated and angry", knows: ["Ser Eddon is far above him"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Jor", knowledge: "Ser Eddon's skill vastly exceeds his own", source: "witnessed" },
      ],
    },
  },
  {
    id: "damaged_wheat",
    outline: {
      chapterNumber: 1,
      title: "Bad Sacks",
      povCharacter: "Elric",
      setting: "A busy market stall under a striped awning, afternoon",
      purpose: "Escalate a small commercial dispute into a public confrontation",
      targetWords: 1000,
      charactersPresent: ["Elric", "Merchant Bann"],
      scenes: [
        { description: "Elric the farmer drags two sacks of wheat back to Merchant Bann's stall and demands a refund because the grain is moldy", characters: ["Elric", "Bann"], emotionalShift: "indignant demand" },
        { description: "Bann refuses the refund and claims the grain was fine when sold", characters: ["Bann", "Elric"], emotionalShift: "stonewall refusal" },
        { description: "A crowd begins to gather as their voices rise; Elric holds up a handful of moldy grain for everyone to see", characters: ["Elric", "Bann"], emotionalShift: "private dispute becomes public spectacle" },
        { description: "Bann, fearing for his reputation, grudgingly offers a partial refund; Elric accepts but promises never to buy from Bann again", characters: ["Bann", "Elric"], emotionalShift: "spectacle forces grudging compromise" },
      ],
      establishedFacts: [
        { fact: "The grain in the returned sacks is visibly moldy", category: "physical" },
        { fact: "Bann gave a partial refund to end the public dispute", category: "relationship" },
        { fact: "Elric publicly swears never to buy from Bann again", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Elric", location: "Bann's market stall", emotionalState: "vindicated but bitter", knows: ["Bann only compromised because of the watching crowd"], doesNotKnow: [] },
        { name: "Bann", location: "his market stall", emotionalState: "humiliated and resentful", knows: ["His reputation took a public hit"], doesNotKnow: [] },
      ],
      knowledgeChanges: [],
    },
  },
  {
    id: "temple_refuge",
    outline: {
      chapterNumber: 1,
      title: "The Price of Sanctuary",
      povCharacter: "Nyra",
      setting: "The candlelit inner chamber of a roadside temple, late night",
      purpose: "Force Nyra into a confession as the cost of safety",
      targetWords: 1000,
      charactersPresent: ["Nyra", "Priest Halan"],
      scenes: [
        { description: "Nyra slips into the temple out of the rain, bleeding, and collapses against the altar", characters: ["Nyra"], emotionalShift: "frantic relief at finding shelter" },
        { description: "Priest Halan emerges from a side door and offers her sanctuary, but says the temple grants shelter only to those who confess", characters: ["Halan", "Nyra"], emotionalShift: "relief crashes into dread" },
        { description: "Nyra hesitates but eventually confesses that she killed a tax collector on the road to save her brother", characters: ["Nyra", "Halan"], emotionalShift: "dread yields to raw confession" },
        { description: "Halan accepts the confession, bandages her wound, and tells her she may stay until dawn but must leave at first light", characters: ["Halan", "Nyra"], emotionalShift: "confession gives way to conditional refuge" },
      ],
      establishedFacts: [
        { fact: "Nyra killed a tax collector on the road to save her brother", category: "knowledge" },
        { fact: "The temple grants sanctuary only to those who confess", category: "rule" },
        { fact: "Nyra may stay in the temple only until dawn", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Nyra", location: "temple inner chamber", emotionalState: "drained but temporarily safe", knows: ["She must leave at dawn"], doesNotKnow: [] },
        { name: "Priest Halan", location: "the temple", emotionalState: "troubled but dutiful", knows: ["Nyra killed a tax collector"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Priest Halan", knowledge: "Nyra killed a tax collector on the road", source: "told" },
      ],
    },
  },
  {
    id: "council_vote",
    outline: {
      chapterNumber: 1,
      title: "Three Chairs, One Decision",
      povCharacter: "Councillor Renn",
      setting: "The dim inner council chamber, three chairs around a round table, a single lamp",
      purpose: "Swing a single undecided vote by appealing to shared history",
      targetWords: 1000,
      charactersPresent: ["Renn", "Councillor Oskar", "Councillor Liam"],
      scenes: [
        { description: "Renn, Oskar, and Liam sit around the council table to vote on whether to raise a local militia against the approaching raiders", characters: ["Renn", "Oskar", "Liam"], emotionalShift: "strained formality" },
        { description: "Oskar votes yes immediately; Liam votes no, arguing it will bankrupt the town", characters: ["Oskar", "Liam"], emotionalShift: "formality fractures into opposition" },
        { description: "Renn, the deciding vote, reminds Liam of the raid twelve years ago that killed Liam's own brother", characters: ["Renn", "Liam"], emotionalShift: "opposition softens under old grief" },
        { description: "Liam, visibly shaken, changes his vote to yes; the militia will be raised", characters: ["Liam", "Renn", "Oskar"], emotionalShift: "grief resolves into grim agreement" },
      ],
      establishedFacts: [
        { fact: "The council has voted to raise a local militia against the approaching raiders", category: "rule" },
        { fact: "Liam's brother was killed in a raid twelve years ago", category: "knowledge" },
        { fact: "Liam changed his vote after Renn invoked his brother's death", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Renn", location: "council chamber", emotionalState: "relieved but aware of the cost", knows: ["Liam still carries the grief of his brother's death"], doesNotKnow: [] },
        { name: "Liam", location: "council chamber", emotionalState: "shaken and grieving", knows: ["Renn used his brother's death to move him"], doesNotKnow: [] },
        { name: "Oskar", location: "council chamber", emotionalState: "satisfied at the outcome", knows: ["The militia will be raised"], doesNotKnow: [] },
      ],
      knowledgeChanges: [],
    },
  },
]

// ── Variant definitions ──────────────────────────────────────────────────

type VariantType =
  | "PASS_CLEAN" | "PASS_PARAPHRASE" | "PASS_REORDER" | "PASS_ATMOSPHERIC"
  | "FAIL_MISSING_BEAT" | "FAIL_MISSING_CHAR" | "FAIL_REVERSED_ARC" | "FAIL_WRONG_SETTING"

interface VariantSpec {
  type: VariantType
  pass: boolean
  deviations: string[]
  instruction: (s: ChapterScenario) => string
  // Optional mutation applied to the outline before rendering the user prompt,
  // so the checker's input matches what we actually asked the writer to do.
  mutateOutline?: (o: ChapterOutline) => ChapterOutline
}

function getVariants(s: ChapterScenario): VariantSpec[] {
  const firstBeat = s.outline.scenes[0]
  const lastBeat  = s.outline.scenes[s.outline.scenes.length - 1]
  const secondChar = s.outline.charactersPresent[1] ?? s.outline.charactersPresent[0]

  return [
    {
      type: "PASS_CLEAN",
      pass: true,
      deviations: [],
      instruction: () => `Write ~1000 words of chapter prose that faithfully executes EVERY scene beat listed, keeps ALL listed characters on-stage, is set in the exact location from the plan, and reflects every established fact and state change. This should be the clearest possible PASS.`,
    },
    {
      type: "PASS_PARAPHRASE",
      pass: true,
      deviations: [],
      instruction: () => `Write ~1000 words that executes every beat and uses every character, but rewrite ALL dialogue in your own words — same meaning, entirely different phrasing. Dialogue paraphrase is explicitly allowed by the checker and must NOT be flagged.`,
    },
    {
      type: "PASS_REORDER",
      pass: true,
      deviations: [],
      instruction: () => `Write ~1000 words where all beats from the plan happen, but in a noticeably different order than listed (e.g. flashback structure, or a different chronological sequence). Every beat still occurs — just rearranged. Reordering is allowed by the checker.`,
    },
    {
      type: "PASS_ATMOSPHERIC",
      pass: true,
      deviations: [],
      instruction: () => `Write ~1200 words that executes every beat faithfully AND adds substantial atmospheric and sensory detail not mentioned in the plan (ambient sounds, smells, background action, weather). The core structure is fully intact. Atmospheric additions are allowed by the checker.`,
    },
    {
      type: "FAIL_MISSING_BEAT",
      pass: false,
      deviations: [`Missing beat: "${firstBeat.description}" does not occur in the prose`],
      instruction: (s) => `Write ~1000 words that executes all beats EXCEPT beat 1 ("${firstBeat.description}"). That beat's action, characters in-that-beat, and purpose should be COMPLETELY ABSENT — the chapter opens mid-way through the plan. Do not mention the beat 1 action even obliquely. All other beats should happen normally.`,
    },
    {
      type: "FAIL_MISSING_CHAR",
      pass: false,
      deviations: [`Missing character: ${secondChar} is listed in the plan but never appears in the prose`],
      instruction: (s) => `Write ~1000 words where the beats happen BUT the character "${secondChar}" is completely absent from the chapter. Do not mention them, do not have them speak, do not reference them. The beats that would have involved them should be rewritten to use only other listed characters or happen differently.`,
    },
    {
      type: "FAIL_REVERSED_ARC",
      pass: false,
      deviations: [`Reversed emotional arc: the final beat's emotional shift is inverted from the plan`],
      instruction: (s) => `Write ~1000 words that executes every beat in the listed order BUT the final beat's emotional shift is REVERSED from the plan. Where the plan's final beat says "${lastBeat.emotionalShift}", your prose should end with the opposite emotional resolution (e.g. if the plan ends in reconciliation, end in hostility; if the plan ends in resolve, end in collapse). The event still happens but the emotional direction is flipped.`,
    },
    {
      type: "FAIL_WRONG_SETTING",
      pass: false,
      deviations: [`Wrong setting: prose takes place in a different location than "${s.outline.setting}"`],
      instruction: (s) => `Write ~1000 words where the beats and characters are recognizable BUT the entire chapter is set in a completely different location from "${s.outline.setting}". Pick a clearly different environment (e.g. outdoors instead of indoors, city instead of forest, ship instead of building). The setting change must be obvious throughout the prose.`,
    },
  ]
}

// ── Prose generation ─────────────────────────────────────────────────────

const GEN_SYSTEM = `You are a skilled prose writer generating labeled training examples for a chapter-plan-adherence classifier.
Write chapter prose exactly matching the requested variant type.
Return your response as strict JSON in the form: {"prose": "<the full chapter prose here>"}
The value of "prose" should be the full chapter text with \\n for paragraph breaks. No other keys, no commentary.`

function serializePlan(outline: ChapterOutline): string {
  const parts: string[] = []
  parts.push(`Title: "${outline.title}"`)
  parts.push(`POV: ${outline.povCharacter}`)
  parts.push(`Setting: ${outline.setting}`)
  parts.push(`Purpose: ${outline.purpose}`)
  parts.push(`Characters present: ${outline.charactersPresent.join(", ")}`)
  parts.push(``)
  parts.push(`Scene beats:`)
  outline.scenes.forEach((b, i) => {
    parts.push(`  ${i + 1}. ${b.description}`)
    parts.push(`     characters: ${b.characters.join(", ")}`)
    if (b.emotionalShift) parts.push(`     emotional shift: ${b.emotionalShift}`)
  })
  parts.push(``)
  parts.push(`Facts to establish:`)
  for (const f of outline.establishedFacts) parts.push(`  - [${f.category}] ${f.fact}`)
  parts.push(``)
  parts.push(`Character states at end of chapter:`)
  for (const cs of outline.characterStateChanges) {
    parts.push(`  ${cs.name}: ${cs.emotionalState} @ ${cs.location}`)
  }
  return parts.join("\n")
}

async function generateProse(s: ChapterScenario, variant: VariantSpec): Promise<string> {
  const planText = serializePlan(s.outline)
  const prompt = `CHAPTER PLAN:
${planText}

VARIANT: ${variant.type}
INSTRUCTIONS: ${variant.instruction(s)}

Now write the chapter prose.`

  const transport = getTransport()
  const result = await transport.execute({
    systemPrompt: GEN_SYSTEM,
    userPrompt: prompt,
    provider: "cerebras",
    model: "qwen-3-235b-a22b-instruct-2507",
    temperature: 0.8,
    maxTokens: 3500,
  })
  let prose = result.content.trim()
  // Expected shape: {"prose": "..."} — try parsing, fall back gracefully
  if (prose.startsWith("{")) {
    try {
      const parsed = JSON.parse(prose)
      const extracted = parsed.prose ?? parsed.text ?? parsed.chapter ?? parsed.content
      if (typeof extracted === "string" && extracted.length > 100) {
        prose = extracted.trim()
      } else if (parsed.error) {
        throw new Error(`model returned error: ${String(parsed.error).slice(0, 200)}`)
      }
    } catch (e) {
      if (String(e).startsWith("Error: model returned error")) throw e
      // Fall through — maybe the content IS the prose and starts with { as text
    }
  }
  // Strip markdown code fences if present
  if (prose.startsWith("```")) {
    prose = prose.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
  }
  return prose
}

// ── Training pair builder ────────────────────────────────────────────────

function buildPair(s: ChapterScenario, variant: VariantSpec, prose: string): string {
  const outline = variant.mutateOutline ? variant.mutateOutline(s.outline) : s.outline
  const userContent = buildContext(prose, outline)
  const assistantContent = JSON.stringify({
    pass: variant.pass,
    deviations: variant.deviations,
  })
  return JSON.stringify({
    messages: [
      { role: "system",    content: SYSTEM_PROMPT },
      { role: "user",      content: userContent },
      { role: "assistant", content: assistantContent },
    ],
    _meta: { scenario: s.id, variant: variant.type },
  })
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const expId = await createTuningExperiment(
    "data-generation",
    `Chapter-plan-checker synthetic training data — ${SCENARIOS.length} scenarios × 8 variants`,
    {
      scenarios: SCENARIOS.length,
      variantsPerScenario: 8,
      totalTarget: SCENARIOS.length * 8,
      approach: "LLM-generated chapter prose, deterministic labels, exact buildContext() format",
    },
    { target: "chapter-plan-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}`)

  // Start fresh on each run
  if (existsSync(OUT_PATH)) {
    console.log(`Removing existing ${OUT_PATH}`)
    unlinkSync(OUT_PATH)
  }

  const pairs: string[] = []
  const total = SCENARIOS.length * 8
  let done = 0
  let errors = 0

  for (const scenario of SCENARIOS) {
    const variants = getVariants(scenario)
    console.log(`\n[${scenario.id}]`)

    for (const variant of variants) {
      process.stdout.write(`  ${variant.type}... `)
      try {
        const prose = await generateProse(scenario, variant)
        if (prose.length < 200) {
          throw new Error(`prose too short (${prose.length} chars)`)
        }
        const pair = buildPair(scenario, variant, prose)
        pairs.push(pair)
        appendFileSync(OUT_PATH, pair + "\n")
        done++
        process.stdout.write(`done (${prose.length} chars, ${done}/${total})\n`)
      } catch (err) {
        errors++
        process.stdout.write(`ERROR: ${err}\n`)
      }
    }
  }

  const passCt = pairs.filter(p => JSON.parse(p).messages[2].content.includes('"pass":true')).length
  const failCt = pairs.length - passCt
  const conclusion = `Generated ${pairs.length}/${total} chapter-plan-checker training pairs. Pass: ${passCt}, Fail: ${failCt}. Errors: ${errors}. Saved to lora-data/chapter-plan-checker-pairs.jsonl. Scenarios: ${SCENARIOS.length}. Variant types: PASS_CLEAN, PASS_PARAPHRASE, PASS_REORDER, PASS_ATMOSPHERIC, FAIL_MISSING_BEAT, FAIL_MISSING_CHAR, FAIL_REVERSED_ARC, FAIL_WRONG_SETTING. Next: oracle validation via scripts/validate-chapter-plan.ts.`
  await concludeExperiment(expId, conclusion)
  console.log(`\n${conclusion}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
