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
