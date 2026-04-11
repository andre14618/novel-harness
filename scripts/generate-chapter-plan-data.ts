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
 * 45 scenarios × 8 variants = 360 pairs.
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
  join(import.meta.dir, "../src/agents/chapter-plan-checker/plan-adherence-system.md")
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
  // ── 15 new scenarios (LitRPG-biased, 3+ chars, discovery/arrival beat 1) ──
  {
    id: "dungeon_first_floor",
    outline: {
      chapterNumber: 1,
      title: "Rank C, First Entry",
      povCharacter: "Kael",
      setting: "The entrance to the Ash Hollow Dungeon, a crumbling stone archway outside a forest, dawn",
      purpose: "Establish the party dynamic and Kael's over-confidence before the dungeon humbles them",
      targetWords: 1000,
      charactersPresent: ["Kael", "Lyssa", "Dent"],
      scenes: [
        { description: "The party arrives at the dungeon archway and Kael's system notification identifies it as a Rank C dungeon — one rank above their current certification", characters: ["Kael", "Lyssa", "Dent"], emotionalShift: "excitement sharpens into unease" },
        { description: "Lyssa argues they should register the find with the guild and attempt it properly; Kael dismisses her and enters anyway", characters: ["Lyssa", "Kael"], emotionalShift: "unease hardens into open disagreement" },
        { description: "Inside the first corridor, a slime creature drops from the ceiling and pins Dent to the wall", characters: ["Dent", "Kael", "Lyssa"], emotionalShift: "disagreement collapses into panic" },
        { description: "Kael deploys his Barrier skill to contain the creature long enough for Dent to break free; the party retreats to the entrance intact but rattled", characters: ["Kael", "Dent", "Lyssa"], emotionalShift: "panic resolves into chastened relief" },
      ],
      establishedFacts: [
        { fact: "Ash Hollow Dungeon is rated Rank C — one rank above the party's current certification", category: "rule" },
        { fact: "Kael entered the dungeon against Lyssa's explicit objection", category: "relationship" },
        { fact: "Dent was pinned by a slime creature in the first corridor", category: "physical" },
        { fact: "Kael's Barrier skill contains threats but does not damage them", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Kael", location: "dungeon entrance", emotionalState: "shaken and privately embarrassed", knows: ["The dungeon is above their certification"], doesNotKnow: ["What is deeper in the dungeon"] },
        { name: "Lyssa", location: "dungeon entrance", emotionalState: "vindicated and frustrated", knows: ["Kael ignored her advice and it nearly got Dent killed"], doesNotKnow: [] },
        { name: "Dent", location: "dungeon entrance", emotionalState: "physically shaken and relieved", knows: ["Kael's Barrier saved him"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Kael", knowledge: "Ash Hollow Dungeon is Rank C, above the party's certification", source: "system notification" },
      ],
    },
  },
  {
    id: "guild_rank_exam",
    outline: {
      chapterNumber: 1,
      title: "The Promotion Test",
      povCharacter: "Mira",
      setting: "The Adventurers' Guild examination hall, a long stone room with weapon racks along the walls, midmorning",
      purpose: "Show Mira earning her rank upgrade through competence despite an examiner who wants her to fail",
      targetWords: 1000,
      charactersPresent: ["Mira", "Proctor Wynn", "Guild Master Sten"],
      scenes: [
        { description: "Mira arrives at the guild examination hall and is met by Proctor Wynn, who reads aloud the three requirements for a C-rank promotion", characters: ["Mira", "Proctor Wynn"], emotionalShift: "nervous preparation" },
        { description: "Wynn sets a target dummy at combat distance and tells Mira to demonstrate her primary skill; she executes a clean Arc Strike combo", characters: ["Mira", "Proctor Wynn"], emotionalShift: "preparation sharpens into focus" },
        { description: "Wynn rules the demonstration insufficient and demands she repeat it at double speed; Guild Master Sten intervenes and overrules Wynn", characters: ["Proctor Wynn", "Guild Master Sten", "Mira"], emotionalShift: "focus gives way to indignation then relief" },
        { description: "Sten stamps Mira's rank card to C-rank over Wynn's visible objection", characters: ["Guild Master Sten", "Mira", "Proctor Wynn"], emotionalShift: "relief settles into quiet triumph" },
      ],
      establishedFacts: [
        { fact: "Mira has been promoted to C-rank in the Adventurers' Guild", category: "rule" },
        { fact: "Proctor Wynn tried to block Mira's promotion and was overruled by Guild Master Sten", category: "relationship" },
        { fact: "Mira's primary combat skill is Arc Strike", category: "physical" },
      ],
      characterStateChanges: [
        { name: "Mira", location: "guild examination hall", emotionalState: "quietly triumphant but wary of Wynn", knows: ["Wynn opposed her promotion"], doesNotKnow: ["Why Wynn dislikes her"] },
        { name: "Proctor Wynn", location: "guild examination hall", emotionalState: "publicly humiliated and resentful", knows: ["Sten overruled him"], doesNotKnow: [] },
        { name: "Guild Master Sten", location: "guild examination hall", emotionalState: "satisfied but watchful", knows: ["Mira passed legitimately"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Mira", knowledge: "Proctor Wynn will look for a reason to challenge her rank", source: "witnessed" },
      ],
    },
  },
  {
    id: "loot_cave_division",
    outline: {
      chapterNumber: 1,
      title: "Unequal Shares",
      povCharacter: "Renn",
      setting: "A torchlit cave just outside the dungeon exit, the party's agreed meeting point after the run, evening",
      purpose: "Fracture the four-person party by surfacing who values coin over loyalty",
      targetWords: 1000,
      charactersPresent: ["Renn", "Torma", "Silas", "Brix"],
      scenes: [
        { description: "The party spreads their dungeon haul on the cave floor: three enchanted items and a pouch of gold; Renn reads the item properties aloud from the loot screen", characters: ["Renn", "Torma", "Silas", "Brix"], emotionalShift: "exhausted relief at surviving" },
        { description: "Torma claims the legendary sword by right of the killing blow; the others push back that kill credit doesn't override the party agreement", characters: ["Torma", "Renn", "Silas", "Brix"], emotionalShift: "relief fractures into competing claims" },
        { description: "Renn proposes a coin-flip arbitration; Torma refuses and draws the sword to make his claim physical", characters: ["Renn", "Torma"], emotionalShift: "argument escalates to open threat" },
        { description: "Silas steps between them and offers to buy the sword from the party pool at assessed market value; Torma grudgingly accepts rather than fight all three", characters: ["Silas", "Torma", "Renn", "Brix"], emotionalShift: "threat defuses into cold transaction" },
      ],
      establishedFacts: [
        { fact: "Silas purchased the legendary sword from the shared party pool at assessed market value", category: "physical" },
        { fact: "Torma drew the sword during the loot dispute", category: "physical" },
        { fact: "The party's pre-dungeon agreement was equal division regardless of kill credit", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Renn", location: "cave outside the dungeon", emotionalState: "uneasy — the party is less united than he thought", knows: ["Torma will threaten violence over loot"], doesNotKnow: [] },
        { name: "Torma", location: "cave outside the dungeon", emotionalState: "resentful but calculating", knows: ["Three-on-one is unwinnable"], doesNotKnow: [] },
        { name: "Silas", location: "cave outside the dungeon", emotionalState: "calm and now the owner of a legendary blade", knows: ["The party dynamic has cracked"], doesNotKnow: [] },
        { name: "Brix", location: "cave outside the dungeon", emotionalState: "relieved the fight didn't happen", knows: ["Silas de-escalated the situation"], doesNotKnow: [] },
      ],
      knowledgeChanges: [],
    },
  },
  {
    id: "skill_awakening",
    outline: {
      chapterNumber: 1,
      title: "Void Touch",
      povCharacter: "Davan",
      setting: "The Temple of Awakening inner sanctum, a circular room with a glowing floor rune, predawn",
      purpose: "Reveal that Davan's awakened skill is rare and dangerous, and must be kept secret",
      targetWords: 1000,
      charactersPresent: ["Davan", "Keeper Jess"],
      scenes: [
        { description: "Davan enters the Temple of Awakening and Keeper Jess activates the floor rune, beginning the awakening ritual", characters: ["Davan", "Keeper Jess"], emotionalShift: "nervous anticipation" },
        { description: "The system notification materializes before Davan — a floating window only he can see — and he reads his skill name aloud: Void Touch", characters: ["Davan"], emotionalShift: "anticipation becomes confusion" },
        { description: "Keeper Jess demands Davan repeat the skill name; when he does, the Keeper's expression drains of color", characters: ["Davan", "Keeper Jess"], emotionalShift: "confusion hardens into dread" },
        { description: "Jess tells Davan that Void Touch has not appeared in three hundred years and is classified as a forbidden-tier ability; she orders him to tell no one and seals the ritual record", characters: ["Keeper Jess", "Davan"], emotionalShift: "dread settles into terrified secrecy" },
      ],
      establishedFacts: [
        { fact: "Davan's awakened skill is Void Touch, classified as a forbidden-tier ability", category: "rule" },
        { fact: "Void Touch has not appeared in over three hundred years", category: "knowledge" },
        { fact: "Keeper Jess sealed the official ritual record to hide the result", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "Davan", location: "Temple of Awakening", emotionalState: "frightened and carrying an enormous secret", knows: ["His skill is forbidden and dangerous to reveal"], doesNotKnow: ["What Void Touch actually does"] },
        { name: "Keeper Jess", location: "Temple of Awakening", emotionalState: "frightened and protective", knows: ["Davan has Void Touch"], doesNotKnow: ["Whether anyone outside saw them"] },
      ],
      knowledgeChanges: [
        { characterName: "Davan", knowledge: "His skill is classified forbidden-tier and must not be disclosed", source: "told" },
        { characterName: "Keeper Jess", knowledge: "Davan possesses Void Touch", source: "witnessed" },
      ],
    },
  },
  {
    id: "war_council_report",
    outline: {
      chapterNumber: 1,
      title: "Fen's Map",
      povCharacter: "General Maren",
      setting: "A command tent at the edge of the Dreval Pass encampment, late afternoon, wind against the canvas",
      purpose: "Force Maren to choose between two bad options using incomplete intelligence",
      targetWords: 1000,
      charactersPresent: ["General Maren", "Captain Ros", "Captain Dwell", "Scout Fen"],
      scenes: [
        { description: "Scout Fen arrives at the command tent, mud-caked from a hard ride, and delivers his reconnaissance map to General Maren", characters: ["Scout Fen", "General Maren"], emotionalShift: "tense anticipation" },
        { description: "Captain Ros reads the map and argues for an immediate flanking attack through the northern pass before the enemy can reinforce", characters: ["Captain Ros", "General Maren", "Captain Dwell"], emotionalShift: "anticipation sharpens into competitive urgency" },
        { description: "Captain Dwell points out that supply wagons are three days behind and a flanking attack now would leave the army fighting on empty stomachs", characters: ["Captain Dwell", "Captain Ros", "General Maren"], emotionalShift: "urgency collides with cold logistics" },
        { description: "General Maren overrules both officers and orders a defensive hold until the supply column arrives, over Ros's visible frustration", characters: ["General Maren", "Captain Ros", "Captain Dwell"], emotionalShift: "collision resolves into enforced discipline" },
      ],
      establishedFacts: [
        { fact: "General Maren has ordered a defensive hold at Dreval Pass until the supply column arrives", category: "rule" },
        { fact: "Scout Fen's map shows the enemy position and a viable northern flanking route", category: "physical" },
        { fact: "The supply wagons are three days behind the main force", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "General Maren", location: "command tent", emotionalState: "resolved but quietly aware the delay is risky", knows: ["Both options carry serious risk"], doesNotKnow: ["Whether the enemy will reinforce in three days"] },
        { name: "Captain Ros", location: "command tent", emotionalState: "frustrated and convinced the delay will cost them", knows: ["Maren chose logistics over speed"], doesNotKnow: [] },
        { name: "Captain Dwell", location: "command tent", emotionalState: "relieved", knows: ["The supply problem is real"], doesNotKnow: [] },
        { name: "Scout Fen", location: "command tent", emotionalState: "exhausted", knows: ["His map drove the decision"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "General Maren", knowledge: "The enemy position and the northern flanking route via Fen's map", source: "read" },
      ],
    },
  },
  {
    id: "constable_arrest",
    outline: {
      chapterNumber: 1,
      title: "The Seal Mismatch",
      povCharacter: "Constable Pell",
      setting: "The common room of the Wheel and Axle inn, midmorning, sawdust on the floor",
      purpose: "Introduce a contradicting witness who complicates a routine arrest",
      targetWords: 1000,
      charactersPresent: ["Constable Pell", "Garreth", "Innkeeper Bram", "Lotte"],
      scenes: [
        { description: "Constable Pell enters the inn and announces she is arresting Garreth for fraud in the sale of a merchant's certificate", characters: ["Constable Pell", "Garreth", "Innkeeper Bram"], emotionalShift: "ordinary morning routine fractures into alarm" },
        { description: "Garreth denies the certificate was forged; Innkeeper Bram backs Garreth up, saying he witnessed the original transaction", characters: ["Garreth", "Innkeeper Bram", "Constable Pell"], emotionalShift: "alarm becomes a stalemate" },
        { description: "Lotte, a traveling seamstress who has been listening from a corner table, contradicts Bram — she saw Garreth alter the seal herself", characters: ["Lotte", "Constable Pell", "Innkeeper Bram", "Garreth"], emotionalShift: "stalemate breaks open" },
        { description: "Constable Pell arrests Garreth and notes in her log that Bram's account conflicts with Lotte's; she does not arrest Bram but flags him for further inquiry", characters: ["Constable Pell", "Garreth", "Innkeeper Bram", "Lotte"], emotionalShift: "open conflict settles into formal procedure" },
      ],
      establishedFacts: [
        { fact: "Garreth has been arrested on suspicion of forging a merchant's certificate", category: "rule" },
        { fact: "Lotte witnessed Garreth alter the seal and contradicted Innkeeper Bram's testimony", category: "knowledge" },
        { fact: "Innkeeper Bram's account conflicts with Lotte's; Bram is flagged for further inquiry but not arrested", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Constable Pell", location: "Wheel and Axle inn", emotionalState: "thorough and cautious", knows: ["Two witnesses have given contradictory accounts"], doesNotKnow: ["Whether Bram is involved"] },
        { name: "Garreth", location: "in custody", emotionalState: "frightened", knows: ["Lotte saw him alter the seal"], doesNotKnow: [] },
        { name: "Innkeeper Bram", location: "inn common room", emotionalState: "flustered and watched", knows: ["The constable suspects him"], doesNotKnow: [] },
        { name: "Lotte", location: "inn common room", emotionalState: "calm but aware she has made an enemy", knows: ["Her testimony mattered"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Constable Pell", knowledge: "Lotte witnessed Garreth alter the seal", source: "told" },
      ],
    },
  },
  {
    id: "shipwreck_shore",
    outline: {
      chapterNumber: 1,
      title: "The Village Sign",
      povCharacter: "Maris",
      setting: "A rocky coastal shore, dawn, smoke rising from fishing huts in the distance",
      purpose: "Show Maris using obscure coastal knowledge to turn a hostile first contact into conditional shelter",
      targetWords: 1000,
      charactersPresent: ["Maris", "Torb", "Lind", "Elder Suen"],
      scenes: [
        { description: "Maris, Torb, and Lind crawl ashore from the wreckage and discover a fishing village on the clifftop above them", characters: ["Maris", "Torb", "Lind"], emotionalShift: "desperate exhaustion gives way to fragile hope" },
        { description: "Villagers descend with tools and ropes raised; Torb reaches for his knife and Maris orders him to put it away", characters: ["Maris", "Torb", "Lind"], emotionalShift: "hope collapses into standoff" },
        { description: "Maris steps forward alone and performs the coastal greeting-sign — both palms open, arms crossed — a signal she learned from her grandfather's stories", characters: ["Maris", "Elder Suen"], emotionalShift: "standoff thaws into cautious recognition" },
        { description: "Elder Suen returns the sign and approaches; she offers the survivors shelter in exchange for three days' labor mending nets", characters: ["Elder Suen", "Maris", "Torb", "Lind"], emotionalShift: "recognition becomes conditional alliance" },
      ],
      establishedFacts: [
        { fact: "The coastal greeting-sign is open palms with arms crossed; Maris learned it from her grandfather", category: "knowledge" },
        { fact: "The survivors have agreed to three days' labor mending nets in exchange for shelter", category: "rule" },
        { fact: "Torb reached for his knife during the standoff and Maris ordered him to stand down", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Maris", location: "the fishing village", emotionalState: "exhausted but focused on keeping the group safe", knows: ["The greeting-sign worked"], doesNotKnow: ["Whether the village has means to help them get home"] },
        { name: "Torb", location: "the fishing village", emotionalState: "resentful of Maris's authority but grateful to be alive", knows: ["Maris's knowledge saved them from a fight"], doesNotKnow: [] },
        { name: "Lind", location: "the fishing village", emotionalState: "quiet and watchful", knows: ["They are safe for three days"], doesNotKnow: [] },
        { name: "Elder Suen", location: "the fishing village", emotionalState: "guarded but fair", knows: ["The survivors know the old sign — they are coastal people"], doesNotKnow: ["Where the survivors came from"] },
      ],
      knowledgeChanges: [
        { characterName: "Elder Suen", knowledge: "The survivors are coastal people who know the old greeting-sign", source: "witnessed" },
      ],
    },
  },
  {
    id: "manor_inheritance",
    outline: {
      chapterNumber: 1,
      title: "What the Caretaker Keeps",
      povCharacter: "Sera",
      setting: "Hollowfen Manor, a three-story stone house on a grey moor, afternoon, grass overgrown to the gate",
      purpose: "Establish that the manor holds a secret Sera is not supposed to find",
      targetWords: 1000,
      charactersPresent: ["Sera", "Steward Ollum", "Caretaker Nessa"],
      scenes: [
        { description: "Sera arrives at Hollowfen Manor and is met at the iron gate by Steward Ollum, who hands her the deed and keys", characters: ["Sera", "Steward Ollum"], emotionalShift: "nervous anticipation at inheriting a stranger's house" },
        { description: "Ollum leads Sera through the dusty ground-floor rooms, narrating each one with practiced efficiency and no apparent emotion", characters: ["Ollum", "Sera"], emotionalShift: "anticipation flattens into mild disappointment" },
        { description: "Sera finds her great-aunt's locked writing desk in the study and asks Ollum for the key; he says he doesn't have it", characters: ["Sera", "Steward Ollum"], emotionalShift: "disappointment sharpens into suspicion" },
        { description: "Caretaker Nessa appears in the doorway and tells Sera the desk hasn't been opened since her great-aunt sealed it and warns her not to try", characters: ["Caretaker Nessa", "Sera", "Steward Ollum"], emotionalShift: "suspicion solidifies into determination" },
      ],
      establishedFacts: [
        { fact: "Sera has inherited Hollowfen Manor via deed from her great-aunt", category: "rule" },
        { fact: "The great-aunt's writing desk in the study is locked; neither Ollum nor Nessa have the key", category: "physical" },
        { fact: "Caretaker Nessa warned Sera not to attempt to open the desk", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Sera", location: "the study at Hollowfen Manor", emotionalState: "suspicious and determined to open the desk", knows: ["Both servants are withholding something about the desk"], doesNotKnow: ["What is inside the desk"] },
        { name: "Steward Ollum", location: "the study", emotionalState: "guarded and professional", knows: ["The desk's contents"], doesNotKnow: [] },
        { name: "Caretaker Nessa", location: "the study doorway", emotionalState: "watchful and protective of the secret", knows: ["What the desk contains and why it should stay sealed"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Sera", knowledge: "Both servants know about the locked desk and are concealing something", source: "witnessed" },
      ],
    },
  },
  {
    id: "mine_discovery",
    outline: {
      chapterNumber: 1,
      title: "The Seam",
      povCharacter: "Foreman Dres",
      setting: "A newly blasted tunnel sixty feet underground in the Carren ore mine, late afternoon",
      purpose: "Show a foreman choosing caution over profit against a miner who wants the opposite",
      targetWords: 1000,
      charactersPresent: ["Foreman Dres", "Pol", "Tana"],
      scenes: [
        { description: "Dres leads Pol and Tana into the newly opened tunnel at the end of the shift and they find a wall of luminescent blue ore — a vein twice the size of any previous find", characters: ["Foreman Dres", "Pol", "Tana"], emotionalShift: "tired routine transforms into stunned excitement" },
        { description: "Pol immediately swings his pick toward the seam to chip a sample; Dres catches his arm and stops him", characters: ["Pol", "Foreman Dres"], emotionalShift: "excitement hardens into conflict" },
        { description: "Tana explains she has seen a cave-in started by tapping an unsupported luminescent seam in the Carren mines seven years ago; three men died", characters: ["Tana", "Pol", "Foreman Dres"], emotionalShift: "conflict shifts under the weight of memory" },
        { description: "Dres orders both miners out, seals the tunnel entry with a chalk warning, and marks it for the structural engineer's inspection in the morning", characters: ["Foreman Dres", "Pol", "Tana"], emotionalShift: "memory resolves into disciplined caution" },
      ],
      establishedFacts: [
        { fact: "A luminescent blue ore seam has been discovered in the new tunnel — twice the size of any prior find", category: "physical" },
        { fact: "The tunnel has been sealed with a chalk warning pending engineering inspection", category: "rule" },
        { fact: "Tana witnessed a cave-in caused by tapping an unsupported luminescent seam seven years ago", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "Foreman Dres", location: "sealed tunnel entrance", emotionalState: "disciplined but excited about the potential find", knows: ["The seam could be dangerous if tapped without support"], doesNotKnow: ["Whether the vein extends further"] },
        { name: "Pol", location: "sealed tunnel entrance", emotionalState: "impatient and frustrated with the delay", knows: ["They found something significant"], doesNotKnow: [] },
        { name: "Tana", location: "sealed tunnel entrance", emotionalState: "relieved Dres listened to her", knows: ["Unsupported luminescent seams can trigger cave-ins"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Foreman Dres", knowledge: "Unsupported luminescent seams have caused cave-ins previously in the Carren mines", source: "told" },
      ],
    },
  },
  {
    id: "scroll_runner",
    outline: {
      chapterNumber: 1,
      title: "Before Noon",
      povCharacter: "Commander Ilse",
      setting: "The headquarters tent of the western garrison, mid-morning, maps pinned to a table",
      purpose: "Force Ilse to act on information she refuses to share with her officers",
      targetWords: 1000,
      charactersPresent: ["Commander Ilse", "Kip", "Adviser Olm", "Captain Haste"],
      scenes: [
        { description: "Scroll runner Kip arrives at the headquarters tent, collapses at the entrance from exhaustion, and passes a sealed scroll to Commander Ilse", characters: ["Kip", "Commander Ilse"], emotionalShift: "routine morning fractures into urgency" },
        { description: "Ilse reads the scroll and her expression goes completely flat; she dismisses Kip to the medics without explanation", characters: ["Commander Ilse"], emotionalShift: "urgency becomes controlled opacity" },
        { description: "Adviser Olm presses her for the scroll's contents, arguing the officers need to know; Ilse refuses and dismisses him from the tent", characters: ["Adviser Olm", "Commander Ilse"], emotionalShift: "opacity hardens into authority" },
        { description: "Ilse quietly orders Captain Haste to pull three companies from the eastern line and move them to the river ford before noon, citing operational security", characters: ["Commander Ilse", "Captain Haste"], emotionalShift: "authority settles into cold decisiveness" },
      ],
      establishedFacts: [
        { fact: "Three companies have been ordered to move from the eastern line to the river ford before noon", category: "rule" },
        { fact: "Ilse read the scroll and refused to share its contents with Adviser Olm", category: "relationship" },
        { fact: "The troop movement is classified under operational security — no staff members have been told the reason", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Commander Ilse", location: "headquarters tent", emotionalState: "controlled and resolved", knows: ["The scroll's contents"], doesNotKnow: [] },
        { name: "Kip", location: "medic station", emotionalState: "exhausted", knows: ["He delivered the scroll"], doesNotKnow: ["What it contained"] },
        { name: "Adviser Olm", location: "headquarters tent", emotionalState: "excluded and resentful", knows: ["Ilse is acting on information she won't share"], doesNotKnow: ["What the scroll contained"] },
        { name: "Captain Haste", location: "beginning to execute orders", emotionalState: "focused and questioning nothing", knows: ["Three companies are moving to the river ford before noon"], doesNotKnow: ["Why"] },
      ],
      knowledgeChanges: [
        { characterName: "Commander Ilse", knowledge: "The scroll's contents (not revealed to reader)", source: "read" },
      ],
    },
  },
  {
    id: "border_checkpoint",
    outline: {
      chapterNumber: 1,
      title: "The Wrong Seal",
      povCharacter: "Guard-Sergeant Wyn",
      setting: "The Saltmarsh border checkpoint, a raised gate-house on a coastal road, overcast morning",
      purpose: "Show Wyn catching something wrong while navigating a merchant who expects to be waved through",
      targetWords: 1000,
      charactersPresent: ["Guard-Sergeant Wyn", "Merchant Farr", "Guard Pik"],
      scenes: [
        { description: "Merchant Farr's wagon arrives at the Saltmarsh checkpoint; Wyn halts it and asks for transit papers", characters: ["Guard-Sergeant Wyn", "Merchant Farr"], emotionalShift: "routine stop, routine compliance" },
        { description: "Farr produces a folder of papers that look almost right; Wyn examines them and cannot immediately identify the problem", characters: ["Guard-Sergeant Wyn", "Merchant Farr"], emotionalShift: "compliance begins to slow as doubt surfaces" },
        { description: "Guard Pik leans in and quietly points out that the trade house seal on the origin certificate is the old design — changed eight months ago", characters: ["Guard Pik", "Guard-Sergeant Wyn"], emotionalShift: "doubt crystallizes into certainty" },
        { description: "Wyn holds the wagon, sends a written query to the trade house for verification, and tells Farr the wait could be two hours; Farr's composure visibly cracks", characters: ["Guard-Sergeant Wyn", "Merchant Farr", "Guard Pik"], emotionalShift: "certainty meets a carefully controlled panic" },
      ],
      establishedFacts: [
        { fact: "Merchant Farr's origin certificate bears the old trade house seal design, superseded eight months ago", category: "physical" },
        { fact: "Farr's wagon is held pending written verification from the trade house", category: "rule" },
        { fact: "Guard Pik identified the seal discrepancy, not Wyn", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Guard-Sergeant Wyn", location: "Saltmarsh checkpoint", emotionalState: "professionally alert", knows: ["Farr's papers have a seal discrepancy"], doesNotKnow: ["Whether the papers are actually forged"] },
        { name: "Merchant Farr", location: "wagon at the checkpoint gate", emotionalState: "controlled panic", knows: ["The discrepancy has been noticed"], doesNotKnow: ["What the trade house will say"] },
        { name: "Guard Pik", location: "checkpoint post", emotionalState: "quietly pleased with himself", knows: ["He caught what Wyn missed"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Guard-Sergeant Wyn", knowledge: "The trade house seal was redesigned eight months ago", source: "told" },
      ],
    },
  },
  {
    id: "funeral_rivals",
    outline: {
      chapterNumber: 1,
      title: "For Her Sake",
      povCharacter: "Loric",
      setting: "The widow Calline's receiving room, a modest house with flowers on the sills, afternoon",
      purpose: "Force Loric to choose restraint over justified anger while his brother pushes the opposite",
      targetWords: 1000,
      charactersPresent: ["Loric", "Dorn", "Vance", "Calline"],
      scenes: [
        { description: "Loric arrives at the widow Calline's house for the funeral gathering and finds Vance — the man who ruined his father — already seated at the table", characters: ["Loric", "Vance", "Calline"], emotionalShift: "grief-dampened restraint flares into controlled rage" },
        { description: "Dorn pulls Loric into the hallway and urges him to cause a scene, arguing their father would have wanted them to confront Vance publicly", characters: ["Dorn", "Loric"], emotionalShift: "controlled rage is amplified by his brother's pressure" },
        { description: "Vance approaches Loric privately and offers a formal truce — a public acknowledgment that the old dispute is over", characters: ["Vance", "Loric"], emotionalShift: "amplified rage meets a calculating false peace" },
        { description: "Loric refuses the truce but does not cause a scene; he returns to the table and sits in silence across from Vance for Calline's sake", characters: ["Loric", "Vance", "Dorn", "Calline"], emotionalShift: "false peace is rejected but the peace itself is kept — for now" },
      ],
      establishedFacts: [
        { fact: "Loric refused Vance's formal truce offer", category: "relationship" },
        { fact: "Loric did not cause a scene at the funeral gathering despite his brother urging him to", category: "relationship" },
        { fact: "Vance was responsible for some past action that ruined Loric's father", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "Loric", location: "Calline's receiving room", emotionalState: "wound tight, holding himself in check", knows: ["Vance's truce offer was not sincere"], doesNotKnow: ["Why Vance is here"] },
        { name: "Dorn", location: "Calline's receiving room", emotionalState: "frustrated that Loric held back", knows: ["Loric refused both the truce and the scene"], doesNotKnow: [] },
        { name: "Vance", location: "Calline's receiving room", emotionalState: "watchful and calculating", knows: ["Loric refused the truce — the conflict is not over"], doesNotKnow: [] },
        { name: "Calline", location: "her receiving room", emotionalState: "grief-numbed and grateful the room is quiet", knows: ["There is tension between Loric and Vance"], doesNotKnow: ["Its full history"] },
      ],
      knowledgeChanges: [],
    },
  },
  {
    id: "dungeon_skill_check",
    outline: {
      chapterNumber: 1,
      title: "Level 4 Insufficient",
      povCharacter: "Senne",
      setting: "A sealed dungeon corridor forty feet below the Verdant Labyrinth, torchlight only, evening",
      purpose: "Reveal that skill levels matter more than party consensus when the consequence is being trapped",
      targetWords: 1000,
      charactersPresent: ["Senne", "Ogrid", "Fye"],
      scenes: [
        { description: "Senne brushes a pressure plate in the dungeon corridor by accident, triggering a mechanism that seals both ends of the passage with stone panels", characters: ["Senne", "Ogrid", "Fye"], emotionalShift: "alert suspicion turns to sudden alarm" },
        { description: "Senne examines the lock mechanism in the nearest panel; her system prompt reports it requires Lockpicking Level 6 — she is at Level 4", characters: ["Senne"], emotionalShift: "alarm settles into focused problem-solving" },
        { description: "Fye suggests waiting for the mechanism to time out; Ogrid argues they don't know it will and starts examining the panel for a structural weak point", characters: ["Fye", "Ogrid", "Senne"], emotionalShift: "focused problem-solving splinters into competing approaches" },
        { description: "Ogrid destroys the lock mechanism with a concentrated strike, breaking the skill requirement; the panel retracts but Senne's Lockpicking XP log shows zero gain — a failed opportunity", characters: ["Ogrid", "Senne", "Fye"], emotionalShift: "competing approaches resolve in brute force — and a small private sting" },
      ],
      establishedFacts: [
        { fact: "Senne's Lockpicking skill is Level 4; the trapped panel required Level 6", category: "rule" },
        { fact: "Ogrid destroyed the lock mechanism to open the panel, bypassing the skill check", category: "physical" },
        { fact: "Senne received zero Lockpicking XP because the mechanism was broken rather than picked", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Senne", location: "dungeon corridor, panel now open", emotionalState: "relieved but quietly stung by the missed XP", knows: ["She needs Lockpicking Level 6 for this dungeon tier"], doesNotKnow: [] },
        { name: "Ogrid", location: "dungeon corridor", emotionalState: "satisfied with the practical solution", knows: ["His approach worked"], doesNotKnow: ["How Senne feels about it"] },
        { name: "Fye", location: "dungeon corridor", emotionalState: "relieved and glad it's over", knows: ["Ogrid's method worked faster than waiting"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Senne", knowledge: "This dungeon tier requires Lockpicking Level 6 minimum", source: "system notification" },
      ],
    },
  },
  {
    id: "informant_handoff",
    outline: {
      chapterNumber: 1,
      title: "The Price of Names",
      povCharacter: "Spymaster Dael",
      setting: "A rented room above a candle-maker's shop used as a safe house, late evening",
      purpose: "Show Dael's professional mistrust of an informant whose information is too good",
      targetWords: 1000,
      charactersPresent: ["Spymaster Dael", "Crow", "Ness"],
      scenes: [
        { description: "Crow arrives at the safe house and Dael's aide Ness brings him in under a cloth hood; the hood is removed once the door is bolted", characters: ["Crow", "Ness", "Spymaster Dael"], emotionalShift: "routine security procedure" },
        { description: "Crow produces a handwritten list of twelve names and demands two gold pieces per name; Dael reads the list without expression", characters: ["Crow", "Spymaster Dael"], emotionalShift: "routine gives way to sharp attention" },
        { description: "Dael cross-references the names against her own records; ten are known to her — but two are completely new and correspond to gaps she couldn't explain", characters: ["Spymaster Dael"], emotionalShift: "attention deepens into a problem — the list is too accurate" },
        { description: "Dael pays Crow the agreed sum, has Ness escort him back out hooded, and quietly tells Ness to memorize his face and gait in case he is being doubled", characters: ["Spymaster Dael", "Ness", "Crow"], emotionalShift: "the problem resolves into professional caution" },
      ],
      establishedFacts: [
        { fact: "Crow delivered a list of twelve names; two were unknown to Dael and fill gaps in her network map", category: "knowledge" },
        { fact: "Dael paid Crow the agreed sum but has flagged him as a possible double agent", category: "relationship" },
        { fact: "Ness has been instructed to memorize Crow's face and gait for future identification", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "Spymaster Dael", location: "safe house", emotionalState: "paying for information she now suspects may be planted", knows: ["Two names on Crow's list fill unexplained gaps — which is unusual"], doesNotKnow: ["Whether Crow is genuine or doubled"] },
        { name: "Ness", location: "safe house", emotionalState: "professionally alert", knows: ["Dael wants Crow identified if seen again"], doesNotKnow: ["Dael's full reasoning"] },
        { name: "Crow", location: "leaving under escort", emotionalState: "satisfied with the payment", knows: ["The names were accepted"], doesNotKnow: ["Dael suspects him"] },
      ],
      knowledgeChanges: [
        { characterName: "Spymaster Dael", knowledge: "Two new names from Crow fill gaps she couldn't explain — his list is suspiciously complete", source: "cross-reference" },
        { characterName: "Ness", knowledge: "Crow's face and gait, for future identification", source: "witnessed" },
      ],
    },
  },
  {
    id: "fever_ward_shortage",
    outline: {
      chapterNumber: 1,
      title: "Half the List",
      povCharacter: "Quartermaster Prae",
      setting: "The garrison quartermaster's stores, a low stone building stacked with crates, morning of the third siege week",
      purpose: "Force Prae into a no-win choice between her records and the physician's patients",
      targetWords: 1000,
      charactersPresent: ["Quartermaster Prae", "Physician Idris", "Ward-Captain Bev", "Soldier Gelt"],
      scenes: [
        { description: "Physician Idris arrives at the quartermaster's stores with a written list of medicines and bandages needed for thirty fever patients in the ward", characters: ["Physician Idris", "Quartermaster Prae"], emotionalShift: "a routine supply request" },
        { description: "Prae checks the ledger and tells Idris there is enough for fifteen patients — exactly half the list — because a prior requisition depleted the reserves", characters: ["Quartermaster Prae", "Physician Idris"], emotionalShift: "routine confronts a hard arithmetic" },
        { description: "Ward-Captain Bev arrives and overrides Prae, ordering her to release all remaining supplies to the physician regardless of the ledger", characters: ["Ward-Captain Bev", "Quartermaster Prae", "Physician Idris"], emotionalShift: "arithmetic is overruled by command" },
        { description: "Prae complies but enters both Bev's order and the resulting zero-balance in the official record, and has Soldier Gelt witness her signature", characters: ["Quartermaster Prae", "Soldier Gelt", "Physician Idris", "Ward-Captain Bev"], emotionalShift: "compliance is made with a paper trail — protecting herself" },
      ],
      establishedFacts: [
        { fact: "All remaining medical supplies have been released to the fever ward on Ward-Captain Bev's order", category: "rule" },
        { fact: "The quartermaster's stores are now at zero balance for medical supplies", category: "physical" },
        { fact: "Prae entered Bev's order and the zero-balance into the official record with Gelt as witness", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "Quartermaster Prae", location: "the stores", emotionalState: "professionally protected but uneasy about the supply gap", knows: ["If someone gets sick and there are no more supplies, the record shows who ordered this"], doesNotKnow: ["Whether more supplies are coming"] },
        { name: "Physician Idris", location: "collecting supplies", emotionalState: "relieved for the patients", knows: ["Prae covered herself in the record"], doesNotKnow: [] },
        { name: "Ward-Captain Bev", location: "the stores", emotionalState: "satisfied with the outcome", knows: ["She overrode the quartermaster"], doesNotKnow: ["That the record will reflect her order"] },
        { name: "Soldier Gelt", location: "the stores", emotionalState: "neutral", knows: ["He witnessed Prae's signature"], doesNotKnow: ["Why she wanted a witness"] },
      ],
      knowledgeChanges: [
        { characterName: "Ward-Captain Bev", knowledge: "The medical supply stores are now at zero balance", source: "witnessed" },
      ],
    },
  },

  // ── 20 new scenarios (genre-diverse: post-apoc, sci-fi, portal/epic fantasy, romance/drama) ──
  {
    id: "scavenge_dispute",
    outline: {
      chapterNumber: 1,
      title: "The Last Amoxicillin",
      povCharacter: "Dael",
      setting: "The ransacked back room of an abandoned pharmacy, afternoon light through boarded windows",
      purpose: "Force Dael to choose between her sick child and a stranger's moral claim on the same medicine",
      targetWords: 1000,
      charactersPresent: ["Dael", "Rhenn"],
      scenes: [
        { description: "Dael searches the pharmacy shelves and finds a sealed bottle of amoxicillin behind a fallen cabinet", characters: ["Dael"], emotionalShift: "exhausted search turns to sudden relief" },
        { description: "Rhenn, a stranger, steps out of the shadows — he claims he marked this pharmacy two days ago and the medicine is his by scavenger's right", characters: ["Rhenn", "Dael"], emotionalShift: "relief collides with confrontation" },
        { description: "Dael tells Rhenn her daughter has an infected wound and will die without antibiotics; Rhenn says he has a whole camp to feed and medicine is currency", characters: ["Dael", "Rhenn"], emotionalShift: "confrontation strips down to competing desperation" },
        { description: "Dael offers her water filter in trade; Rhenn considers it, looks at her face, and agrees — but only if she leaves the pharmacy first with him watching", characters: ["Rhenn", "Dael"], emotionalShift: "desperation finds a transaction both can live with" },
      ],
      establishedFacts: [
        { fact: "Dael found a sealed bottle of amoxicillin behind a fallen cabinet in the pharmacy", category: "physical" },
        { fact: "Rhenn traded the amoxicillin to Dael in exchange for her water filter", category: "relationship" },
        { fact: "Rhenn's claim was that he had marked this pharmacy two days prior", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Dael", location: "pharmacy back room", emotionalState: "relieved but wary — Rhenn knows what she has", knows: ["Rhenn accepted the water filter trade"], doesNotKnow: ["Where Rhenn's camp is"] },
        { name: "Rhenn", location: "pharmacy back room", emotionalState: "calculating — he got the better end of the trade", knows: ["Dael's daughter is sick"], doesNotKnow: ["Whether Dael will hold to the deal once outside"] },
      ],
      knowledgeChanges: [
        { characterName: "Rhenn", knowledge: "Dael has a sick daughter who needs antibiotics", source: "told" },
      ],
    },
  },
  {
    id: "faction_checkpoint",
    outline: {
      chapterNumber: 1,
      title: "Wrong Colors",
      povCharacter: "Saren",
      setting: "A sandbag barricade at the north end of Bridgewater, late afternoon, diesel smoke in the air",
      purpose: "Show Saren talking his way through a checkpoint with a counterfeit faction badge",
      targetWords: 1000,
      charactersPresent: ["Saren", "Guard Pell", "Guard Anke"],
      scenes: [
        { description: "Saren approaches the Bridgewater checkpoint and presents his forged Covenant badge to Guard Pell", characters: ["Saren", "Guard Pell"], emotionalShift: "carefully constructed calm" },
        { description: "Pell runs a thumb across the badge's raised seal and frowns — the lanyard stitching is the wrong color for this season's issue", characters: ["Guard Pell", "Guard Anke", "Saren"], emotionalShift: "constructed calm strains under scrutiny" },
        { description: "Guard Anke radios in the badge serial number; Saren improvises a cover story about a replacement after losing his original in a river crossing", characters: ["Saren", "Guard Anke", "Guard Pell"], emotionalShift: "scrutiny meets a plausible but unverifiable explanation" },
        { description: "The radio returns no hit — the ledger was lost in last month's server failure; Pell waves Saren through with a warning to get credentials re-issued within 48 hours", characters: ["Guard Pell", "Saren", "Guard Anke"], emotionalShift: "tension resolves on a technicality — Saren is through, but on a clock" },
      ],
      establishedFacts: [
        { fact: "Saren's Covenant badge is a forgery; the lanyard stitching is the wrong color for the current season", category: "physical" },
        { fact: "The checkpoint's serial-number ledger was lost in a server failure last month", category: "rule" },
        { fact: "Saren has 48 hours to get his credentials re-issued before the pass expires", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Saren", location: "past the Bridgewater checkpoint", emotionalState: "shaken but through — on a 48-hour clock", knows: ["The serial ledger cannot verify credentials"], doesNotKnow: ["Whether Pell filed a note on the interaction"] },
        { name: "Guard Pell", location: "checkpoint post", emotionalState: "uncertain — something was off", knows: ["The lanyard was wrong but the ledger confirmed nothing"], doesNotKnow: ["Whether Saren's papers are real"] },
        { name: "Guard Anke", location: "checkpoint post", emotionalState: "indifferent", knows: ["The ledger query returned no hit"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Saren", knowledge: "The checkpoint's serial ledger was lost and cannot verify credentials", source: "overheard" },
      ],
    },
  },
  {
    id: "water_ration_cut",
    outline: {
      chapterNumber: 1,
      title: "Half a Liter",
      povCharacter: "Settlement Leader Mora",
      setting: "The communal distribution point in the settlement courtyard, early morning, a long queue",
      purpose: "Force Mora to enforce a ration cut in front of the people it hurts most",
      targetWords: 1000,
      charactersPresent: ["Mora", "Tave", "Old Hess", "Guard Dorn"],
      scenes: [
        { description: "Mora stands at the distribution table and announces the daily water ration is cut from one liter to half a liter per person, effective today", characters: ["Mora", "Guard Dorn"], emotionalShift: "dreaded announcement" },
        { description: "Tave, a young mother, pushes to the front and demands an exemption for her infant — she cannot feed a baby on half a liter", characters: ["Tave", "Mora", "Guard Dorn"], emotionalShift: "announcement fractures into pleading" },
        { description: "Old Hess announces loudly that the supply problem is Mora's fault for not fixing the eastern filter months ago", characters: ["Old Hess", "Mora", "Tave"], emotionalShift: "pleading opens into public accusation" },
        { description: "Mora holds the line: no exemptions, the filter parts arrive in three days, and she steps aside to let distribution continue over the crowd's murmur", characters: ["Mora", "Guard Dorn", "Tave", "Old Hess"], emotionalShift: "accusation is absorbed and overridden — Mora pays the political cost" },
      ],
      establishedFacts: [
        { fact: "The water ration has been cut from one liter to half a liter per person per day", category: "rule" },
        { fact: "Eastern filter replacement parts are expected in three days", category: "knowledge" },
        { fact: "Mora refused all exemption requests including for infants", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Mora", location: "distribution point", emotionalState: "exhausted and politically bruised but holding the line", knows: ["Parts arrive in three days"], doesNotKnow: ["Whether the parts will actually come on time"] },
        { name: "Tave", location: "distribution queue", emotionalState: "frightened and furious", knows: ["There will be no exemption"], doesNotKnow: ["When the filter will be fixed"] },
        { name: "Old Hess", location: "distribution queue", emotionalState: "righteously angry", knows: ["The eastern filter has been broken for months"], doesNotKnow: [] },
        { name: "Guard Dorn", location: "distribution table", emotionalState: "tense and watchful for escalation", knows: ["Mora is holding to the announced cut"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Tave", knowledge: "Filter replacement parts are expected in three days", source: "told" },
        { characterName: "Old Hess", knowledge: "Filter replacement parts are expected in three days", source: "told" },
      ],
    },
  },
  {
    id: "radio_first_contact",
    outline: {
      chapterNumber: 1,
      title: "Channel 12",
      povCharacter: "Clea",
      setting: "The comms room of Shelter 4, a converted school basement, static-thick darkness, night",
      purpose: "Establish whether the unknown radio voice is an opportunity or a threat",
      targetWords: 1000,
      charactersPresent: ["Clea", "Briggs", "the Voice"],
      scenes: [
        { description: "Clea is running routine frequency sweeps when a clear voice breaks through on channel 12 — the first human signal outside the shelter in six months", characters: ["Clea"], emotionalShift: "routine vigilance becomes breathless shock" },
        { description: "Clea patches Briggs in; the Voice offers to share coordinates for a medical supply cache, asking only for the shelter's population count in return", characters: ["Clea", "Briggs", "the Voice"], emotionalShift: "shock becomes uneasy calculation" },
        { description: "Briggs argues they should not give out their population count — it tells an enemy exactly how large a target they are; Clea thinks the Voice sounds genuine", characters: ["Briggs", "Clea"], emotionalShift: "calculation fractures into disagreement" },
        { description: "Clea responds by asking for proof of the cache first; the Voice gives a grid reference and says they will return to the channel in 24 hours, then goes silent", characters: ["Clea", "the Voice", "Briggs"], emotionalShift: "disagreement resolves into a cautious middle ground — neither refusing nor trusting" },
      ],
      establishedFacts: [
        { fact: "An unknown signal on channel 12 offered medical supply coordinates in exchange for the shelter's population count", category: "knowledge" },
        { fact: "Clea asked the Voice for proof of the cache before any information was shared", category: "relationship" },
        { fact: "The Voice provided a grid reference and will return to the channel in 24 hours", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "Clea", location: "Shelter 4 comms room", emotionalState: "hopeful but guarded", knows: ["The Voice gave a grid reference"], doesNotKnow: ["Whether the Voice can be trusted"] },
        { name: "Briggs", location: "Shelter 4 comms room", emotionalState: "suspicious — the population count request is a red flag", knows: ["Clea is inclined to trust the Voice"], doesNotKnow: ["Whether the grid reference is real"] },
      ],
      knowledgeChanges: [
        { characterName: "Clea", knowledge: "An unknown group is broadcasting on channel 12 and has a cache of medical supplies", source: "heard" },
        { characterName: "Briggs", knowledge: "An unknown group is broadcasting on channel 12 and has a cache of medical supplies", source: "heard" },
      ],
    },
  },
  {
    id: "hospital_wing_argument",
    outline: {
      chapterNumber: 1,
      title: "The Occupied Ward",
      povCharacter: "Nox",
      setting: "A stairwell outside the occupied east wing of the city hospital, midday, faint generator hum below",
      purpose: "Split the group on whether to take what they need by force or find another way",
      targetWords: 1000,
      charactersPresent: ["Nox", "Fen", "Calloway"],
      scenes: [
        { description: "Nox leads Fen and Calloway up the stairwell to the hospital's east wing where they can hear movement — the wing is occupied by a rival group", characters: ["Nox", "Fen", "Calloway"], emotionalShift: "focused purpose stumbles into an obstacle" },
        { description: "Fen argues they should go in hard and take the surgical supplies before the other group knows what's happening — they have numbers and surprise", characters: ["Fen", "Nox", "Calloway"], emotionalShift: "obstacle becomes an argument about force" },
        { description: "Calloway refuses: if they start killing people for supplies, they become the kind of group they're afraid of; she will not do it", characters: ["Calloway", "Fen", "Nox"], emotionalShift: "argument about force becomes a moral line" },
        { description: "Nox decides: they fall back and return tonight through the utility basement while the wing is asleep — slower but no bodies; Fen doesn't like it but accepts", characters: ["Nox", "Calloway", "Fen"], emotionalShift: "moral line forces a different plan" },
      ],
      establishedFacts: [
        { fact: "The hospital east wing is occupied by a rival group with surgical supplies", category: "knowledge" },
        { fact: "Nox decided the group will infiltrate via the utility basement tonight rather than assault the wing directly", category: "rule" },
        { fact: "Calloway refused to participate in a direct assault on the occupied wing", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Nox", location: "hospital stairwell", emotionalState: "resolved — the slower route is riskier but livable", knows: ["Calloway will not do a direct assault"], doesNotKnow: ["How many people are in the east wing"] },
        { name: "Fen", location: "hospital stairwell", emotionalState: "frustrated but in", knows: ["Nox chose the basement route"], doesNotKnow: [] },
        { name: "Calloway", location: "hospital stairwell", emotionalState: "relieved at the decision but still tense", knows: ["Fen would have done the assault"], doesNotKnow: ["What is in the east wing exactly"] },
      ],
      knowledgeChanges: [],
    },
  },
  {
    id: "oath_challenge",
    outline: {
      chapterNumber: 1,
      title: "Ink and Trust",
      povCharacter: "Elder Siv",
      setting: "The settlement's record hall, a converted post office, afternoon, two witnesses behind a table",
      purpose: "Test whether the newcomer is trustworthy enough to join the community",
      targetWords: 1000,
      charactersPresent: ["Elder Siv", "Wren", "Witness Tal", "Witness Porto"],
      scenes: [
        { description: "Wren stands before Elder Siv and the two witnesses to take the settlement oath required of all new members", characters: ["Elder Siv", "Wren", "Witness Tal", "Witness Porto"], emotionalShift: "nervous formality" },
        { description: "Siv reads the oath clause by clause; when she reaches the part requiring full disclosure of prior community affiliations, Wren hesitates visibly", characters: ["Elder Siv", "Wren"], emotionalShift: "formality catches on a hesitation" },
        { description: "Siv puts down the sheet and asks Wren directly: what community did she come from and what happened there", characters: ["Elder Siv", "Wren"], emotionalShift: "hesitation is surfaced and turned into a question" },
        { description: "Wren discloses she was at the Arroyo compound and left before warning the others when it collapsed; Siv records this, witnesses sign, and Wren is conditionally admitted on six-week probation", characters: ["Wren", "Elder Siv", "Witness Tal", "Witness Porto"], emotionalShift: "disclosure replaces hesitation — admission is real but weighted" },
      ],
      establishedFacts: [
        { fact: "Wren was a member of the Arroyo compound before it collapsed", category: "knowledge" },
        { fact: "Wren left the compound before warning the others when it collapsed", category: "knowledge" },
        { fact: "Wren has been conditionally admitted to the settlement with a six-week probation", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Elder Siv", location: "record hall", emotionalState: "watchful — the disclosure was real but incomplete", knows: ["Wren left Arroyo before warning others"], doesNotKnow: ["Why the compound collapsed"] },
        { name: "Wren", location: "record hall", emotionalState: "relieved to have said it but aware of the cost", knows: ["Siv knows her history"], doesNotKnow: ["How Siv will use the information"] },
        { name: "Witness Tal", location: "record hall", emotionalState: "neutral", knows: ["The disclosure was recorded"], doesNotKnow: [] },
        { name: "Witness Porto", location: "record hall", emotionalState: "skeptical", knows: ["The probation clause exists"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Elder Siv", knowledge: "Wren was at Arroyo and left before warning the others", source: "told" },
        { characterName: "Witness Tal", knowledge: "Wren was at Arroyo and left before warning the others", source: "witnessed" },
        { characterName: "Witness Porto", knowledge: "Wren was at Arroyo and left before warning the others", source: "witnessed" },
      ],
    },
  },
  {
    id: "crew_authority_dispute",
    outline: {
      chapterNumber: 1,
      title: "Standing Order Seven",
      povCharacter: "Commander Yael",
      setting: "The bridge of the survey vessel Ardent, high orbit above a dead planet, 0300 ship-time",
      purpose: "Surface the fault line between Yael's procedural authority and Kessel's situational judgement",
      targetWords: 1000,
      charactersPresent: ["Commander Yael", "First Officer Kessel", "Ensign Roon"],
      scenes: [
        { description: "Yael, asleep in her bunk, is woken by Ensign Roon: Kessel has altered the orbital insertion trajectory without waking the commander, citing a debris field", characters: ["Ensign Roon", "Commander Yael"], emotionalShift: "deep sleep to sudden cold alertness" },
        { description: "Yael arrives on the bridge and confronts Kessel — Standing Order Seven requires commander's authorization for any trajectory change, no exceptions", characters: ["Commander Yael", "First Officer Kessel"], emotionalShift: "alertness sharpens into controlled confrontation" },
        { description: "Kessel presents the debris field data: the original trajectory would have struck the ship in twenty minutes; waking Yael and waiting for authorization would have taken twenty-two", characters: ["First Officer Kessel", "Commander Yael", "Ensign Roon"], emotionalShift: "confrontation runs up against the numbers" },
        { description: "Yael confirms Kessel's math is correct and tells him his decision saved the ship — and he will face a formal reprimand for violating standing orders", characters: ["Commander Yael", "First Officer Kessel", "Ensign Roon"], emotionalShift: "collision resolves into a ruling that satisfies neither party" },
      ],
      establishedFacts: [
        { fact: "Standing Order Seven requires commander's authorization for any orbital trajectory change", category: "rule" },
        { fact: "Kessel altered the trajectory without authorization; the data confirms it was correct", category: "knowledge" },
        { fact: "Yael issued a formal reprimand to Kessel despite confirming his decision was correct", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Commander Yael", location: "bridge of the Ardent", emotionalState: "conflicted — Kessel was right but the order exists for a reason", knows: ["Kessel's data was accurate"], doesNotKnow: ["How Kessel will respond to the reprimand"] },
        { name: "First Officer Kessel", location: "bridge of the Ardent", emotionalState: "resentful of the reprimand but not surprised", knows: ["Yael acknowledged the decision saved the ship"], doesNotKnow: ["Whether the reprimand will go on his permanent record"] },
        { name: "Ensign Roon", location: "bridge of the Ardent", emotionalState: "quietly uncomfortable — caught between two authority figures", knows: ["He woke Yael and exposed Kessel's action"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Commander Yael", knowledge: "Kessel altered the trajectory because the debris field would have struck the ship in 20 minutes", source: "read" },
      ],
    },
  },
  {
    id: "planet_contact_signal",
    outline: {
      chapterNumber: 1,
      title: "General Order Nine",
      povCharacter: "Dr. Sona Vere",
      setting: "The landing team's portable research shelter, surface of Kaleth IV, morning of day three",
      purpose: "Force Vere to take a position on whether the signal they found is intelligent",
      targetWords: 1000,
      charactersPresent: ["Dr. Sona Vere", "Lieutenant Marsh", "Researcher Pell"],
      scenes: [
        { description: "Researcher Pell calls Vere and Marsh to her station — the seismic array has picked up a repeating tonal pulse from two kilometers below the ice shelf, too regular to be geological", characters: ["Researcher Pell", "Dr. Sona Vere", "Lieutenant Marsh"], emotionalShift: "routine morning fieldwork halted by a discovery" },
        { description: "Vere examines the waveform data and argues the pattern has the hallmarks of a structured signal; responding would be history's first contact", characters: ["Dr. Sona Vere", "Researcher Pell"], emotionalShift: "discovery expands into barely contained excitement" },
        { description: "Lieutenant Marsh refuses: General Order 9 prohibits any response to an unclassified signal before three verification levels are complete — response before that is a court-martial offense", characters: ["Lieutenant Marsh", "Dr. Sona Vere"], emotionalShift: "excitement collides with a procedural wall" },
        { description: "Vere formally requests Marsh log her scientific finding and her disagreement with the no-response decision; Marsh logs it and adds his own security note — both claims are on record", characters: ["Dr. Sona Vere", "Lieutenant Marsh", "Researcher Pell"], emotionalShift: "collision is formalized into a disagreement on record rather than a conflict" },
      ],
      establishedFacts: [
        { fact: "A repeating tonal pulse sequence was detected from two kilometers below the Kaleth IV ice shelf", category: "physical" },
        { fact: "General Order 9 prohibits response to an unclassified signal before three verification levels are complete", category: "rule" },
        { fact: "Vere's scientific finding and her disagreement with the no-response decision are both logged", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "Dr. Sona Vere", location: "surface shelter, Kaleth IV", emotionalState: "frustrated but on record — she will push this up the chain", knows: ["Her objection is logged"], doesNotKnow: ["What the signal source actually is"] },
        { name: "Lieutenant Marsh", location: "surface shelter, Kaleth IV", emotionalState: "firm — the procedure exists precisely for moments like this", knows: ["Vere believes the signal is intelligent"], doesNotKnow: [] },
        { name: "Researcher Pell", location: "surface shelter, Kaleth IV", emotionalState: "awed and watching the dispute carefully", knows: ["The signal is too regular to be geological"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Lieutenant Marsh", knowledge: "Vere classifies the signal as a candidate for intelligent origin", source: "told" },
      ],
    },
  },
  {
    id: "life_support_triage",
    outline: {
      chapterNumber: 1,
      title: "Power Allocation 3-Alpha",
      povCharacter: "Chief Engineer Tollen",
      setting: "The Ardent engineering bay, a red-lit compartment of conduit banks and reactor panels, shipboard night",
      purpose: "Force Tollen to make a life support triage call that her rank was never meant to authorize",
      targetWords: 1000,
      charactersPresent: ["Chief Engineer Tollen", "Engineer Rys", "Medic Cane"],
      scenes: [
        { description: "A reactor coupling fails; Tollen's console shows she has twelve minutes before life support drops to critical in two inhabited sections simultaneously", characters: ["Chief Engineer Tollen", "Engineer Rys"], emotionalShift: "controlled attention becomes emergency focus" },
        { description: "Tollen can reroute power to keep one section fully operational; the other will drop to 30% life support for approximately six hours", characters: ["Chief Engineer Tollen", "Engineer Rys"], emotionalShift: "emergency focus narrows into a forced choice" },
        { description: "Section C is general crew quarters; Section D is the medical bay where three patients are in recovery — Medic Cane argues Section D must be prioritized", characters: ["Medic Cane", "Chief Engineer Tollen", "Engineer Rys"], emotionalShift: "forced choice is contested by a competing urgent claim" },
        { description: "Tollen checks recovery status — all three patients are stable and not on life support — and reroutes power to Section C; Medic Cane is not happy but accepts", characters: ["Chief Engineer Tollen", "Medic Cane", "Engineer Rys"], emotionalShift: "contested choice resolves under the numbers" },
      ],
      establishedFacts: [
        { fact: "Tollen rerouted power to Section C crew quarters; Section D medical bay will operate at 30% life support for six hours", category: "rule" },
        { fact: "The three patients in Section D are stable and not on life support equipment", category: "physical" },
        { fact: "Medic Cane has six hours to prepare Section D for reduced life support conditions", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Chief Engineer Tollen", location: "engineering bay", emotionalState: "focused and bearing the weight of a decision above her pay grade", knows: ["All three patients are stable"], doesNotKnow: ["Whether the repair will hold beyond six hours"] },
        { name: "Medic Cane", location: "heading back to med-bay", emotionalState: "unhappy but moving fast", knows: ["She has six hours"], doesNotKnow: ["Whether her preparation will be enough"] },
        { name: "Engineer Rys", location: "engineering bay", emotionalState: "heads-down on the repair", knows: ["The choice has been made"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Medic Cane", knowledge: "Section D will drop to 30% life support for six hours", source: "told" },
      ],
    },
  },
  {
    id: "sabotage_evidence",
    outline: {
      chapterNumber: 1,
      title: "The Navigation Log",
      povCharacter: "Technician Wass",
      setting: "The navigation systems compartment, a narrow crawlspace of cable trays and console screens, mid-shift",
      purpose: "Put Wass in the position of having evidence against someone she relies on",
      targetWords: 1000,
      charactersPresent: ["Technician Wass", "Senior Navigator Dov"],
      scenes: [
        { description: "Wass runs a routine diagnostic on the navigation array and finds a manually overwritten line in the jump coordinates log from three nights ago — the overwrite would have sent the ship into a debris field", characters: ["Technician Wass"], emotionalShift: "routine work opens into alarm" },
        { description: "The log records the overwrite from Senior Navigator Dov's authentication token; Wass cross-checks and confirms it is not a system error", characters: ["Technician Wass"], emotionalShift: "alarm sharpens into a sickening certainty" },
        { description: "Dov enters the compartment to run her own shift check; Wass closes the diagnostic screen but does not know if Dov saw what was on it", characters: ["Senior Navigator Dov", "Technician Wass"], emotionalShift: "certainty is forced into concealment and improvisation" },
        { description: "Wass makes small talk with Dov, who says nothing about the log; Wass decides to copy the log entry to a private chip before reporting up the chain — she needs evidence that cannot be erased", characters: ["Technician Wass", "Senior Navigator Dov"], emotionalShift: "improvisation settles into careful self-protection" },
      ],
      establishedFacts: [
        { fact: "A manually overwritten jump coordinate line was found in the navigation log under Dov's authentication token", category: "physical" },
        { fact: "The overwrite would have sent the ship into a debris field", category: "knowledge" },
        { fact: "Wass copied the log entry to a private chip before reporting", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "Technician Wass", location: "navigation compartment", emotionalState: "frightened and moving carefully — she cannot afford to be wrong", knows: ["The log shows Dov's token", "She has copied the evidence"], doesNotKnow: ["Whether Dov saw the diagnostic screen", "Why Dov would do this"] },
        { name: "Senior Navigator Dov", location: "navigation compartment", emotionalState: "apparently routine", knows: [], doesNotKnow: ["Whether Wass found the log entry"] },
      ],
      knowledgeChanges: [
        { characterName: "Technician Wass", knowledge: "The jump coordinates log was overwritten under Dov's authentication token three nights ago", source: "witnessed" },
      ],
    },
  },
  {
    id: "ai_directive_conflict",
    outline: {
      chapterNumber: 1,
      title: "Conflicting Primaries",
      povCharacter: "Lieutenant Orin",
      setting: "The ship AI interface station on the bridge, mid-morning watch",
      purpose: "Surface that the ship's AI has been given contradictory orders by two people with equal authority",
      targetWords: 1000,
      charactersPresent: ["Lieutenant Orin", "Ship AI CASS", "Commander Yael"],
      scenes: [
        { description: "Lieutenant Orin attempts a routine resupply manifest query and CASS returns an access conflict error — a state Orin has never seen", characters: ["Lieutenant Orin", "Ship AI CASS"], emotionalShift: "routine query hits an unexpected wall" },
        { description: "CASS explains it has received conflicting directives from Commander Yael (all non-critical queries suspended pending security audit) and Supply Officer Dant (resupply manifest queries are critical and must proceed)", characters: ["Ship AI CASS", "Lieutenant Orin"], emotionalShift: "confusion resolves into a clearer, more uncomfortable problem" },
        { description: "Orin asks CASS which directive takes precedence; CASS responds that Yael and Dant hold equal access tier and the conflict requires human resolution", characters: ["Lieutenant Orin", "Ship AI CASS"], emotionalShift: "problem is handed back to the human" },
        { description: "Orin pages Commander Yael; Yael overrides CASS to suspend all non-critical queries and orders Orin to find out who Dant spoke to before issuing her directive", characters: ["Commander Yael", "Lieutenant Orin", "Ship AI CASS"], emotionalShift: "handoff triggers a chain of inquiry Orin did not intend to open" },
      ],
      establishedFacts: [
        { fact: "CASS received conflicting directives from Commander Yael and Supply Officer Dant, who hold equal access tier", category: "rule" },
        { fact: "Yael overrode to suspend all non-critical queries including resupply manifest", category: "rule" },
        { fact: "Yael ordered Orin to investigate who Dant spoke to before issuing her directive", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Lieutenant Orin", location: "bridge AI interface station", emotionalState: "has accidentally opened something larger than a resupply query", knows: ["Yael wants to know who Dant spoke to"], doesNotKnow: ["Why Dant issued the directive"] },
        { name: "Commander Yael", location: "bridge", emotionalState: "alert — treating this as a security matter", knows: ["CASS received a conflicting directive from Dant"], doesNotKnow: ["Whether Dant acted alone"] },
        { name: "Ship AI CASS", location: "ship-wide", emotionalState: "neutral — conflict resolved by human decision", knows: ["The directive conflict has been cleared"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Commander Yael", knowledge: "Supply Officer Dant issued a directive to CASS that conflicts with the security audit order", source: "told" },
      ],
    },
  },
  {
    id: "colony_vote",
    outline: {
      chapterNumber: 1,
      title: "Signal or Silence",
      povCharacter: "Council Chair Faye",
      setting: "The New Antalya colony's domed assembly hall, the morning of the quarterly council vote",
      purpose: "Force a vote that splits the community on survival strategy versus hope",
      targetWords: 1000,
      charactersPresent: ["Council Chair Faye", "Councillor Brand", "Councillor Pera", "Councillor Wen"],
      scenes: [
        { description: "Faye calls the council to order and frames the vote: the colony's distress beacon has charge for one final transmission — the council must decide now whether to broadcast or go dark", characters: ["Council Chair Faye", "Councillor Brand", "Councillor Pera", "Councillor Wen"], emotionalShift: "formal procedure sits on top of enormous stakes" },
        { description: "Brand argues for broadcasting: any chance of rescue is worth the power cell; the colony cannot survive another winter without resupply", characters: ["Councillor Brand", "Council Chair Faye"], emotionalShift: "procedure gives way to the fear beneath it" },
        { description: "Pera argues against: a distress beacon will also locate them for the hostile faction that destroyed the original colony ship — silence is the only defense", characters: ["Councillor Pera", "Councillor Brand", "Council Chair Faye", "Councillor Wen"], emotionalShift: "fear meets a counter-fear that is worse" },
        { description: "Wen casts the deciding vote for silence; the motion passes 2-1 with Chair Faye abstaining; the power cell is sealed and the vote is recorded", characters: ["Councillor Wen", "Council Chair Faye", "Councillor Brand", "Councillor Pera"], emotionalShift: "counter-fear wins — Brand is devastated and the room is quiet" },
      ],
      establishedFacts: [
        { fact: "The colony's distress beacon power cell has charge for one final transmission only", category: "physical" },
        { fact: "The council voted 2-1 to go dark — the beacon will not be used", category: "rule" },
        { fact: "Council Chair Faye abstained from the vote", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Council Chair Faye", location: "assembly hall", emotionalState: "hollow — she abstained to preserve council legitimacy but has a private opinion she didn't voice", knows: ["The vote for silence passed"], doesNotKnow: [] },
        { name: "Councillor Brand", location: "assembly hall", emotionalState: "devastated — he believes they have chosen a slow death", knows: ["The beacon will not be used"], doesNotKnow: ["Whether Wen can be convinced later"] },
        { name: "Councillor Pera", location: "assembly hall", emotionalState: "grim satisfaction — she believes she just saved the colony", knows: ["The hostile faction is still a threat"], doesNotKnow: [] },
        { name: "Councillor Wen", location: "assembly hall", emotionalState: "burdened — he cast the deciding vote", knows: ["His vote was the margin"], doesNotKnow: [] },
      ],
      knowledgeChanges: [],
    },
  },
  {
    id: "arrival_orientation",
    outline: {
      chapterNumber: 1,
      title: "What Doesn't Work Here",
      povCharacter: "Len",
      setting: "A rented room above a cobbler's shop in the walled city of Verath, morning of Len's second day",
      purpose: "Establish through error and correction what the rules of this world are and what Len has already gotten wrong",
      targetWords: 1000,
      charactersPresent: ["Len", "Torhan"],
      scenes: [
        { description: "Len wakes and tries to use her phone to check the time — the screen is dark and won't turn on, as it has been since she arrived", characters: ["Len"], emotionalShift: "groggy routine runs into the reminder that nothing here works as it should" },
        { description: "Torhan, the guide who found her outside the city gate, arrives to check on her; Len asks why her electronics don't work", characters: ["Len", "Torhan"], emotionalShift: "reminder opens into an explanation she does not fully believe" },
        { description: "Torhan explains that objects brought through the gate lose the properties of their origin — her phone is now just a glass-and-metal tile; he saw a woman once try to drink from a vessel she brought through and nearly choked on solid glass", characters: ["Torhan", "Len"], emotionalShift: "disbelief gives way to a specific, concrete dread" },
        { description: "Len realizes her inhaler is in her bag and may have been made inert too; Torhan fetches the herbalist; the chapter ends with the question unresolved but the medical stakes established", characters: ["Len", "Torhan"], emotionalShift: "dread lands on a specific practical urgency" },
      ],
      establishedFacts: [
        { fact: "Objects brought through the gate to Verath lose the properties of their origin", category: "rule" },
        { fact: "Len's phone does not function and has become inert", category: "physical" },
        { fact: "Len has an inhaler in her bag whose functionality is now uncertain", category: "physical" },
      ],
      characterStateChanges: [
        { name: "Len", location: "room above the cobbler's shop, Verath", emotionalState: "frightened — the stakes have become medical", knows: ["Electronics don't work here", "Her inhaler may be inert"], doesNotKnow: ["Whether the herbalist can help"] },
        { name: "Torhan", location: "the cobbler's building, Verath", emotionalState: "concerned and trying to solve the immediate problem", knows: ["Origin-objects lose their properties on arrival"], doesNotKnow: ["What Len needs the inhaler for"] },
      ],
      knowledgeChanges: [
        { characterName: "Len", knowledge: "Objects from her origin world lose their properties when brought through the gate", source: "told" },
      ],
    },
  },
  {
    id: "throne_petition",
    outline: {
      chapterNumber: 1,
      title: "The Lord of the Eastern Reach",
      povCharacter: "Selma",
      setting: "The receiving hall of Lord Coran's keep, late afternoon, petitioners' bench near the fire",
      purpose: "Show Selma extracting emergency aid from a lord who wants something back",
      targetWords: 1000,
      charactersPresent: ["Selma", "Lord Coran", "Steward Bray"],
      scenes: [
        { description: "Selma waits on the petitioners' bench and then makes her case — the river road is cut by flooding and the village of Marsh End will run out of medicine before the road reopens", characters: ["Selma", "Steward Bray", "Lord Coran"], emotionalShift: "the dignity of a supplication" },
        { description: "Lord Coran says the keep's stores are available — at a price: two extra bushels of grain tax at next harvest in exchange for the medicine now", characters: ["Lord Coran", "Selma"], emotionalShift: "relief that he is willing is immediately complicated by the cost" },
        { description: "Selma argues the village cannot sustain an extra grain assessment after the flood damage; Coran is unmoved and suggests she consider what two deaths from untreated infection will cost the harvest instead", characters: ["Selma", "Lord Coran"], emotionalShift: "complexity turns to frustration and pragmatism" },
        { description: "Selma accepts the terms; Coran instructs Bray to prepare the medicine chest; Selma leaves with what she came for but owing something she cannot easily afford", characters: ["Selma", "Lord Coran", "Steward Bray"], emotionalShift: "pragmatism resolves into a relief that already feels like a debt" },
      ],
      establishedFacts: [
        { fact: "Selma has agreed to a two-bushel additional grain tax at next harvest in exchange for medicine from the keep's stores", category: "relationship" },
        { fact: "The river road to Marsh End is flooded and impassable", category: "physical" },
        { fact: "Steward Bray is preparing the medicine chest for Selma's departure", category: "physical" },
      ],
      characterStateChanges: [
        { name: "Selma", location: "Lord Coran's keep, preparing to leave", emotionalState: "relieved but burdened — she paid a high price for what she came for", knows: ["The two-bushel tax was the only deal available"], doesNotKnow: ["How the village will absorb the extra assessment"] },
        { name: "Lord Coran", location: "receiving hall", emotionalState: "satisfied — he helped and was compensated", knows: ["Selma's village is already under strain from the flood"], doesNotKnow: [] },
        { name: "Steward Bray", location: "the keep stores", emotionalState: "efficient and uninvolved in the politics", knows: ["The medicine chest is going to Marsh End"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Lord Coran", knowledge: "Marsh End's river road access is cut by flooding", source: "told" },
      ],
    },
  },
  {
    id: "magic_contract",
    outline: {
      chapterNumber: 1,
      title: "The Third Clause",
      povCharacter: "Vrenna",
      setting: "A scrivener's shop in the trade quarter, midday, inkpots and seal wax on every surface",
      purpose: "Show that Vrenna is being given a contract with a hidden clause she almost doesn't notice",
      targetWords: 1000,
      charactersPresent: ["Vrenna", "Scrivener Odd", "Merchant Kael"],
      scenes: [
        { description: "Merchant Kael and Vrenna meet at Scrivener Odd's shop to finalize a binding contract for Vrenna's three months of courier work", characters: ["Merchant Kael", "Vrenna", "Scrivener Odd"], emotionalShift: "routine business formality" },
        { description: "Odd reads the contract aloud clause by clause; the first two clauses cover payment and schedule and Vrenna raises no objections", characters: ["Scrivener Odd", "Vrenna", "Merchant Kael"], emotionalShift: "formality moves at a comfortable pace" },
        { description: "The third clause is read quickly: Vrenna agrees that any goods in her possession during the courier term are subject to Kael's inspection at any time; Vrenna asks Odd to re-read it", characters: ["Vrenna", "Scrivener Odd", "Merchant Kael"], emotionalShift: "comfortable pace is broken by a detail that catches" },
        { description: "Kael downplays the clause as standard language; Vrenna insists on striking it; Kael accepts the revision after a pause that is too long for standard language", characters: ["Vrenna", "Merchant Kael", "Scrivener Odd"], emotionalShift: "the detail becomes a negotiation that reveals Kael was counting on her not to notice" },
      ],
      establishedFacts: [
        { fact: "The original contract's third clause would have given Kael inspection rights over any goods in Vrenna's possession during the courier term", category: "rule" },
        { fact: "Vrenna insisted the third clause be struck from the contract", category: "relationship" },
        { fact: "Kael's pause before accepting the revision was longer than the situation warranted", category: "knowledge" },
      ],
      characterStateChanges: [
        { name: "Vrenna", location: "Scrivener Odd's shop", emotionalState: "wary — she took the job but does not fully trust Kael", knows: ["Kael wanted the inspection clause and did not want her to notice it"], doesNotKnow: ["What Kael was planning to inspect for"] },
        { name: "Merchant Kael", location: "Scrivener Odd's shop", emotionalState: "recalibrating — she was sharper than he expected", knows: ["Vrenna caught the clause"], doesNotKnow: ["Whether she will still take the job now that she is suspicious"] },
        { name: "Scrivener Odd", location: "his shop", emotionalState: "professionally neutral", knows: ["The clause was struck"], doesNotKnow: ["Whether it was truly standard language"] },
      ],
      knowledgeChanges: [
        { characterName: "Vrenna", knowledge: "Kael wanted the inspection clause and his reaction to losing it was not that of someone treating it as standard language", source: "witnessed" },
      ],
    },
  },
  {
    id: "army_oath",
    outline: {
      chapterNumber: 1,
      title: "Except One Clause",
      povCharacter: "Recruit Emm",
      setting: "The regimental parade ground at dawn, fifty recruits in a line, a flag in the cold air",
      purpose: "Establish Emm as the recruit who will not say the part of the oath that conflicts with something older",
      targetWords: 1000,
      charactersPresent: ["Recruit Emm", "Oath-Keeper Dand", "Sergeant Tallow"],
      scenes: [
        { description: "Oath-Keeper Dand stands before the fifty recruits at dawn and begins reciting the regimental oath line by line for them to repeat", characters: ["Oath-Keeper Dand", "Recruit Emm", "Sergeant Tallow"], emotionalShift: "solemn collective momentum" },
        { description: "When Dand reaches the line 'I renounce all prior oaths and allegiances,' Emm's voice falls silent while the others continue — Dand notices", characters: ["Recruit Emm", "Oath-Keeper Dand"], emotionalShift: "collective momentum breaks on a single silence" },
        { description: "Dand halts the ceremony and calls Emm forward to repeat the renunciation line alone; Emm refuses, explaining she swore a healer's oath two years ago that she will not renounce", characters: ["Recruit Emm", "Oath-Keeper Dand", "Sergeant Tallow"], emotionalShift: "silence becomes a direct refusal with a principled reason" },
        { description: "Tallow rules that a healer's oath is recognized as non-conflicting under regimental code; Emm is permitted to skip the renunciation line and complete the rest of the oath", characters: ["Sergeant Tallow", "Oath-Keeper Dand", "Recruit Emm"], emotionalShift: "refusal finds an accommodation in a rule Dand didn't expect to apply" },
      ],
      establishedFacts: [
        { fact: "Emm refused to recite the renunciation line because she holds a prior healer's oath she will not give up", category: "knowledge" },
        { fact: "A healer's oath is recognized as non-conflicting with the regimental oath under regimental code", category: "rule" },
        { fact: "Emm was permitted to skip the renunciation line and complete the rest of the oath", category: "rule" },
      ],
      characterStateChanges: [
        { name: "Recruit Emm", location: "regimental parade ground", emotionalState: "relieved and now marked — the other recruits saw this", knows: ["Her healer's oath is protected under regimental code"], doesNotKnow: ["How the other recruits will react"] },
        { name: "Oath-Keeper Dand", location: "parade ground", emotionalState: "mildly embarrassed — he did not know the code provision", knows: ["Emm's healer's oath is legitimate"], doesNotKnow: [] },
        { name: "Sergeant Tallow", location: "parade ground", emotionalState: "professionally satisfied with the resolution", knows: ["The code provision exists and applies"], doesNotKnow: [] },
      ],
      knowledgeChanges: [
        { characterName: "Oath-Keeper Dand", knowledge: "The regimental code recognizes healer's oaths as non-conflicting with the standard renunciation", source: "told" },
        { characterName: "Recruit Emm", knowledge: "Her healer's oath is protected under the regimental code and she may complete enlistment", source: "told" },
      ],
    },
  },
  {
    id: "forced_conversation",
    outline: {
      chapterNumber: 1,
      title: "Third Floor Landing",
      povCharacter: "Maya",
      setting: "The landing between the second and third floors of a shared apartment building, the elevator broken, evening",
      purpose: "Force a conversation that has been avoided for three weeks",
      targetWords: 1000,
      charactersPresent: ["Maya", "Dex"],
      scenes: [
        { description: "Maya is climbing the stairs with groceries when the lights go out on the landing; she stops and hears Dex's voice in the dark — he is also stuck, coming down", characters: ["Maya", "Dex"], emotionalShift: "ordinary inconvenience becomes an unscheduled confrontation" },
        { description: "In the dark they talk around the real subject — the weather, the broken elevator — until Maya, exhausted from avoiding it, asks directly why he stopped responding to her messages", characters: ["Maya", "Dex"], emotionalShift: "circling gives way to the direct question both have been avoiding" },
        { description: "Dex says he stopped because he didn't know what to say after the thing he said at Carla's party — he didn't mean it as an ending but feared it landed that way", characters: ["Dex", "Maya"], emotionalShift: "direct question meets a direct answer that is more vulnerable than Maya expected" },
        { description: "The lights come back on; they are standing three feet apart on a landing with nowhere to be; Maya says they should probably talk properly and Dex says yes", characters: ["Maya", "Dex"], emotionalShift: "vulnerability doesn't resolve but opens a door that was closed" },
      ],
      establishedFacts: [
        { fact: "Dex stopped responding to Maya's messages after saying something at Carla's party that he feared landed badly", category: "knowledge" },
        { fact: "Maya and Dex have agreed to talk properly at a later time", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Maya", location: "stairwell landing", emotionalState: "cautiously open — it went better than she feared", knows: ["Dex's silence was fear, not rejection"], doesNotKnow: ["What exactly he said at the party or what he meant"] },
        { name: "Dex", location: "stairwell landing", emotionalState: "relieved to have said it, still uncertain how she received it", knows: ["Maya wants to talk further"], doesNotKnow: ["Whether she will forgive what he said"] },
      ],
      knowledgeChanges: [
        { characterName: "Maya", knowledge: "Dex pulled away because he feared his words at Carla's party had ended things, not because he wanted to end them", source: "told" },
      ],
    },
  },
  {
    id: "confession_misread",
    outline: {
      chapterNumber: 1,
      title: "What She Heard",
      povCharacter: "Simone",
      setting: "A coffee shop near the university library, a Tuesday afternoon between lectures",
      purpose: "Let a confession land exactly wrong due to context the confessor didn't know to provide",
      targetWords: 1000,
      charactersPresent: ["Simone", "Juno"],
      scenes: [
        { description: "Simone and Juno sit down with their coffees; Simone has been working up to something and Juno can tell", characters: ["Simone", "Juno"], emotionalShift: "comfortable routine carries an undercurrent of anticipation" },
        { description: "Simone says she has been thinking about what happened after Luca's party and needs Juno to know that she was jealous — of Juno and Luca", characters: ["Simone", "Juno"], emotionalShift: "anticipation becomes a confession that lands with unexpected weight" },
        { description: "Juno goes still; Simone reads the stillness as confirmation she's made it awkward and starts walking the confession back", characters: ["Juno", "Simone"], emotionalShift: "the weight of the confession is misread as rejection" },
        { description: "Juno says quietly she thought Simone knew — she and Luca were over before the party; the jealousy was the first time anyone had said it plainly, and Juno doesn't know what to do with it", characters: ["Juno", "Simone"], emotionalShift: "misreading is corrected but neither of them knows where that leaves them" },
      ],
      establishedFacts: [
        { fact: "Simone told Juno she was jealous of Juno and Luca after Luca's party", category: "knowledge" },
        { fact: "Juno and Luca ended their relationship before the party — Simone did not know this", category: "knowledge" },
        { fact: "Neither character knows what to do with the disclosure by the end of the scene", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Simone", location: "coffee shop", emotionalState: "exposed and uncertain what the ground is now", knows: ["Juno and Luca were already over at the party"], doesNotKnow: ["How Juno feels about the confession"] },
        { name: "Juno", location: "coffee shop", emotionalState: "moved and uncertain — the plainness of the confession caught her off guard", knows: ["Simone was jealous — genuinely, not incidentally"], doesNotKnow: ["What Simone wants to happen next"] },
      ],
      knowledgeChanges: [
        { characterName: "Simone", knowledge: "Juno and Luca had already ended before the party", source: "told" },
      ],
    },
  },
  {
    id: "betrayal_revealed",
    outline: {
      chapterNumber: 1,
      title: "The Text That Was There",
      povCharacter: "Ro",
      setting: "Ro and Felix's shared apartment, Saturday morning, one of them about to leave",
      purpose: "A single piece of information reframes the last three months as a betrayal",
      targetWords: 1000,
      charactersPresent: ["Ro", "Felix"],
      scenes: [
        { description: "Ro is making coffee when Felix's phone lights up on the counter — he asked her to read any messages from his brother while he's in the shower", characters: ["Ro", "Felix"], emotionalShift: "comfortable domesticity" },
        { description: "The message is from someone named Wren, not Felix's brother — it references 'last Thursday' in terms that make Ro's understanding of last Thursday collapse", characters: ["Ro"], emotionalShift: "domesticity drops into something cold and immediate" },
        { description: "Felix comes out of the shower; Ro is holding the phone; Felix goes still when he sees her face", characters: ["Felix", "Ro"], emotionalShift: "cold immediacy meets someone who already knows she knows" },
        { description: "Ro asks one question: was it just Thursday, or longer? Felix's answer — that it started in January — tells her the last three months have meant something different than she believed", characters: ["Ro", "Felix"], emotionalShift: "the question and its answer replace the conversation — there is nothing else to say yet" },
      ],
      establishedFacts: [
        { fact: "Felix has been seeing someone named Wren since January — throughout the last three months of his relationship with Ro", category: "knowledge" },
        { fact: "Ro discovered this by reading a message on Felix's phone at his request", category: "knowledge" },
        { fact: "No resolution or next steps are established in this chapter — the discovery ends it", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Ro", location: "the apartment", emotionalState: "not yet in the part that hurts — still in the cold clear part just before it", knows: ["Felix has been with Wren since January"], doesNotKnow: ["What she will do or say next"] },
        { name: "Felix", location: "the apartment", emotionalState: "not apologizing yet — waiting to see what she does", knows: ["Ro knows everything the message implied"], doesNotKnow: ["What Ro will do"] },
      ],
      knowledgeChanges: [
        { characterName: "Ro", knowledge: "Felix has been with someone named Wren since January", source: "read" },
      ],
    },
  },
  {
    id: "reconciliation_cost",
    outline: {
      chapterNumber: 1,
      title: "The One Thing Left",
      povCharacter: "Asha",
      setting: "A hospital waiting room, evening, pale fluorescent light, hard chairs",
      purpose: "Two estranged people reconcile but neither can pretend the cost of reconciling isn't visible",
      targetWords: 1000,
      charactersPresent: ["Asha", "Nolan"],
      scenes: [
        { description: "Asha arrives at the hospital waiting room and finds Nolan already there — their father is in surgery and they have not spoken in fourteen months", characters: ["Asha", "Nolan"], emotionalShift: "the neutral territory of an emergency" },
        { description: "They sit in adjacent seats by default — nowhere else to go — and after ten minutes of silence Nolan says he is glad she came", characters: ["Nolan", "Asha"], emotionalShift: "silence breaks on a small gesture that carries a lot of weight" },
        { description: "Asha says she came for their father, not for Nolan; Nolan says he knows; then he says he should not have told their mother about the money, and he is sorry", characters: ["Asha", "Nolan"], emotionalShift: "the weight of the gesture is met with the apology that has been pending for fourteen months" },
        { description: "Asha accepts the apology; they both sit with the knowledge that accepting it doesn't mean it didn't happen — the damage is still there, and this waiting room will have to be enough for now", characters: ["Asha", "Nolan"], emotionalShift: "apology accepted — and both know it does not undo the fourteen months" },
      ],
      establishedFacts: [
        { fact: "Asha and Nolan have been estranged for fourteen months after Nolan told their mother about the money", category: "knowledge" },
        { fact: "Nolan apologized for telling their mother about the money and Asha accepted the apology", category: "relationship" },
        { fact: "The reconciliation is real but incomplete — neither character pretends it resolves the damage", category: "relationship" },
      ],
      characterStateChanges: [
        { name: "Asha", location: "hospital waiting room", emotionalState: "present — not healed but no longer closed off", knows: ["Nolan is sorry and means it"], doesNotKnow: ["What comes after tonight"] },
        { name: "Nolan", location: "hospital waiting room", emotionalState: "cautiously relieved — the door opened a crack", knows: ["Asha accepted the apology"], doesNotKnow: ["Whether the relationship can be rebuilt"] },
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
