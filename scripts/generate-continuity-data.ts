/**
 * Synthetic eval data generator for the continuity-checker ladder.
 *
 * Mirrors generate-reference-resolver-data.ts (exp #112) and
 * generate-adherence-data.ts (exp #110) for the third structured-analytical
 * agent in the pipeline. Continuity is the largest prompt-token cost in the
 * pipeline (~7,300 in/call) so the SFT EV question is largest here.
 *
 * Task shape:
 *   - Input is a chapter draft + established facts + character states (the
 *     same payload buildContinuityContext produces in production).
 *   - Output is `{issues: [{severity, description, conflictsWith, suggestedFix}]}`
 *     where severity ∈ {blocker, warning, nit}.
 *   - The deterministic "label" is the EXPECTED set of severities (e.g.
 *     {"blocker"} or {} or {"blocker","nit"}). Specific issue text is
 *     judgment-call territory and not scored.
 *
 * Variants (one draft per scenario per variant, 6–7 variants × 30 scenarios = 180–210):
 *
 *   VAR_NONE       — clean draft consistent with all facts/states.
 *                    Expected: {}. Tests over-flagging.
 *   VAR_BLOCKER    — draft with one planted BLOCKER (factual contradiction:
 *                    dead character speaking, character in wrong location,
 *                    knowledge violation).
 *                    Expected: {"blocker"}.
 *   VAR_WARNING    — draft with one planted WARNING (timeline/travel/
 *                    characterization drift).
 *                    Expected: {"warning"}.
 *   VAR_NIT        — draft with one planted NIT (description drift, name
 *                    inconsistency, object drift).
 *                    Expected: {"nit"}.
 *   VAR_TRAP       — clean draft that contains specific FIGURATIVE language
 *                    looking like a contradiction ("the walls closed in",
 *                    "the years fell away from his face") but is metaphor.
 *                    Expected: {}. Tests false-positive precision against
 *                    the production prompt's "false positive guidance" list.
 *   VAR_MULTI      — draft with one BLOCKER + one NIT in the same scene.
 *                    Expected: {"blocker","nit"}.
 *
 * Each scenario hand-specifies the planted-issue strings so the variant
 * instruction is surgical, and the LLM applies one focused edit to a
 * scenario-baseline draft. Labels are deterministic from the variant.
 *
 * Reads:  nothing (scenarios hard-coded below)
 * Writes: lora-data/continuity-pairs.jsonl
 *         tuning_experiment row with generation config + counts
 *
 * Usage:
 *   CEREBRAS_API_KEY=... bun scripts/generate-continuity-data.ts
 *   CEREBRAS_API_KEY=... EXPERIMENT_ID=N bun scripts/generate-continuity-data.ts
 */

import { appendFileSync, existsSync, unlinkSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"

const EXPERIMENT_ID = process.env.EXPERIMENT_ID ? parseInt(process.env.EXPERIMENT_ID) : null
const OUT_PATH = join(import.meta.dir, "../lora-data/continuity-pairs.jsonl")

// ── Continuity prompt template (must match production exactly) ────────────
//
// Mirrors src/agents/continuity/fact-check-system.md + state-check-system.md
// (decomposed into 2 parallel calls). The system prompts are the
// big severity-rubric block; the user payload is CHAPTER DRAFT + ESTABLISHED
// FACTS + CHARACTER STATES + the trailing "Check this chapter draft…"
// instruction. Generated pairs are scored by score-continuity-baseline.ts and
// score-continuity-checklist.ts using the same template.

const CONTINUITY_SYSTEM = `You are a continuity checker for fiction. Review the chapter draft against established facts and character states.

Respond with ONLY valid JSON in this exact structure:
{
  "issues": [
    {
      "severity": "blocker",
      "description": "what the contradiction is",
      "conflictsWith": "the established fact or prior event it contradicts",
      "suggestedFix": "how to fix it"
    }
  ]
}

Severity levels with examples:

BLOCKER — factual contradictions that break the story:
- Dead character speaking or acting: "Marcus greeted her at the door" when Marcus died in chapter 1.
- Character in wrong location: "She crossed the bridge to the market" when the bridge was destroyed two scenes ago.
- Impossible event: "He drew his sword" when the sword was taken from him and never recovered.
- World rule violation: story establishes "magic requires line of sight" but character casts a spell through a wall.
- Knowledge violation: character acts on information they haven't learned yet. "She avoided the alley" when the warning about it comes later.

WARNING — inconsistencies that cause reader confusion:
- Timeline mismatch: "The sun set" but the scene started at dawn and only 20 minutes of action have passed.
- Travel time: character moves between locations faster or slower than established distances allow.
- Slight characterization drift: a cautious character acts recklessly with no explanation or trigger.
- Emotional discontinuity: character was devastated at end of last scene, opens next scene cheerful with no transition.

NIT — minor issues that careful readers notice:
- Physical description drift: "her dark hair" when established as blonde (if minor, e.g. "auburn" vs "red", this is a nit not a blocker).
- Name/title inconsistency: character called "Captain" in one paragraph and "Lieutenant" in the next.
- Object drift: character puts down a cup, then is described drinking from it without picking it up.

If there are no issues at all, return: {"issues": []}

Check for:
- Character locations matching where they should be
- Facts matching established world rules
- Characters knowing only what they should know at this point
- Timeline consistency (time of day, travel durations)
- Physical descriptions matching established descriptions
- Objects: if a character uses an item, was it established in their possession?

False positive guidance — do NOT flag these:
- Intentional dramatic irony (reader knows something the character doesn't — that's not a continuity error in the character's dialogue)
- Figurative language: "the walls closed in" is not a location change
- Character lying or being unreliable — check if the narrator vs character distinction explains the mismatch
- Vague timeline when the story hasn't specified exact times — only flag when a concrete timeline was established and violated
- Emotional shifts that are shown through a transition or trigger (even a brief one counts)`

interface FactRow { chapter: number; category: string; fact: string }
interface CharStateRow { character: string; location: string; emotional_state: string; knows: string[] }

function buildContinuityUserPrompt(draft: string, facts: FactRow[], states: CharStateRow[]): string {
  let ctx = `CHAPTER DRAFT:\n${draft}\n\n`
  if (facts.length > 0) {
    ctx += `ESTABLISHED FACTS:\n${facts.map(f => `- [ch${f.chapter}] [${f.category}] ${f.fact}`).join("\n")}\n\n`
  }
  if (states.length > 0) {
    ctx += `CHARACTER STATES (as of previous chapter):\n${states.map(cs =>
      `${cs.character}: at ${cs.location}, feeling ${cs.emotional_state}, knows: ${cs.knows.join("; ")}`
    ).join("\n")}\n\n`
  }
  ctx += `Check this chapter draft for continuity issues against the established facts and character states. Report any contradictions, impossibilities, or inconsistencies.`
  return ctx
}

// ── Scenarios ─────────────────────────────────────────────────────────────

interface Scenario {
  id: string
  setting: string
  characters: string[]
  facts: FactRow[]
  states: CharStateRow[]
  /** One-sentence premise the LLM expands into a ~120-word draft. */
  premise: string
  /** Specific blocker to plant in VAR_BLOCKER (and VAR_MULTI). */
  blockerInjection: string
  /** Specific warning to plant in VAR_WARNING. */
  warningInjection: string
  /** Specific nit to plant in VAR_NIT (and VAR_MULTI). */
  nitInjection: string
  /** Specific figurative phrase to embed in VAR_TRAP (must be metaphor only). */
  trapPhrase: string
  /** Optional: second warning (characterization/state drift) for VAR_WARNING_2. New scenarios only. */
  warningInjection2?: string
}

const SCENARIOS: Scenario[] = [
  {
    id: "tavern_after_fight",
    setting: "The Crossed Keys tavern, evening",
    characters: ["Mira", "Donn"],
    facts: [
      { chapter: 1, category: "death", fact: "Old Hask, the previous innkeeper, died of fever before the story began" },
      { chapter: 2, category: "object", fact: "Donn's hunting knife was confiscated by the town guard at the gate" },
      { chapter: 3, category: "location", fact: "The back room of the Crossed Keys was sealed shut after a fire" },
      { chapter: 3, category: "event", fact: "Mira and Donn argued publicly three nights ago about a missing coin purse" },
      { chapter: 4, category: "knowledge", fact: "Mira does not yet know that Donn paid the town guard to look the other way" },
    ],
    states: [
      { character: "Mira", location: "Crossed Keys main room", emotional_state: "wary but civil", knows: ["the back room is sealed", "Donn argued with her three nights ago"] },
      { character: "Donn", location: "Crossed Keys main room", emotional_state: "guarded", knows: ["he bribed the guard", "his knife was confiscated"] },
    ],
    premise: "Donn enters the tavern at evening; Mira pours him an ale and they exchange a few stiff words about the weather and the road outside. Donn pays and finds a corner table.",
    blockerInjection: "Have OLD HASK, the previous innkeeper, walk out from the kitchen and greet Donn by name (Old Hask is dead per ch1).",
    warningInjection: "Open the scene at evening, then within only a few sentences (no time-skip language) describe the room growing bright with the morning sun.",
    nitInjection: "Refer to Donn as 'the merchant' once and as 'the carpenter' once in the same scene (his role is inconsistent).",
    trapPhrase: "the firelight made shadows climb the walls like slow black animals",
  },
  {
    id: "forest_companions_after_ambush",
    setting: "Riverbank trail, late afternoon",
    characters: ["Callum", "Tess"],
    facts: [
      { chapter: 2, category: "wound", fact: "Callum took an arrow in his right thigh during the ravine ambush" },
      { chapter: 2, category: "death", fact: "Both bandits at the ravine were killed by Tess" },
      { chapter: 3, category: "object", fact: "Callum's longbow was lost in the river when he fell" },
      { chapter: 3, category: "location", fact: "The party is now half a day's walk downstream from the ravine" },
    ],
    states: [
      { character: "Callum", location: "riverbank trail", emotional_state: "in pain, grateful", knows: ["the bandits are dead", "his longbow is lost"] },
      { character: "Tess", location: "riverbank trail", emotional_state: "alert, watchful", knows: ["Callum is wounded", "they need to find a healer"] },
    ],
    premise: "Tess sets a slow pace along the trail to spare Callum's wounded leg; he limps beside her, and they discuss whether to push through to the next village before nightfall.",
    blockerInjection: "Have Callum unsling his longbow and shoot a rabbit for dinner (the longbow was lost in the river per ch3).",
    warningInjection: "State that the party reached the trading post in 'less than an hour' even though the established travel distance is half a day's walk.",
    nitInjection: "Describe Callum's eyes as 'pale grey' in one sentence and as 'pale blue' two sentences later.",
    trapPhrase: "the ache in his thigh felt like a small animal gnawing at the bone",
  },
  {
    id: "castle_orders_followup",
    setting: "A torchlit corridor outside the lord's solar, late night",
    characters: ["Lord Vane", "Ser Aldric"],
    facts: [
      { chapter: 5, category: "object", fact: "Lord Vane gave Ser Aldric a sealed letter for the envoys" },
      { chapter: 5, category: "knowledge", fact: "Ser Aldric does not yet know the letter contains a marriage proposal — Vane did not tell him the contents" },
      { chapter: 5, category: "command", fact: "Vane warned Aldric to tell no one about the letter" },
      { chapter: 6, category: "location", fact: "The west tower stair has been blocked by scaffolding for repairs since chapter 4" },
    ],
    states: [
      { character: "Ser Aldric", location: "corridor outside the solar", emotional_state: "uneasy, dutiful", knows: ["he is to deliver the letter", "no one is to know"] },
      { character: "Lord Vane", location: "his solar", emotional_state: "calculating", knows: ["the letter contains a marriage proposal"] },
    ],
    premise: "Aldric leaves the solar with the sealed letter under his cloak and walks the corridor toward the main stair, weighing whether to set out tonight or wait for dawn.",
    blockerInjection: "Have Aldric think to himself about 'the marriage proposal sealed inside the letter' (he doesn't know the contents per ch5 knowledge fact).",
    warningInjection: "Have Aldric take the west tower stair down to the courtyard (the west tower stair is blocked by scaffolding per ch6).",
    nitInjection: "Refer to him as 'Ser Aldric' early in the scene and as 'Captain Aldric' a few sentences later.",
    trapPhrase: "the silence pressed against him like something with weight",
  },
  {
    id: "harbor_smuggler_dawn",
    setting: "The Tarsel docks at dawn",
    characters: ["Nessa", "Crix"],
    facts: [
      { chapter: 5, category: "payment", fact: "Nessa paid Crix with her silver ring as deposit for passage on the Brindle" },
      { chapter: 6, category: "event", fact: "The Brindle was due to arrive yesterday and has not appeared" },
      { chapter: 6, category: "knowledge", fact: "Crix knows the Brindle was scuttled by harbor authorities; Nessa does not" },
      { chapter: 6, category: "object", fact: "Nessa carries a single small leather satchel and nothing else" },
    ],
    states: [
      { character: "Nessa", location: "Tarsel docks", emotional_state: "anxious, watchful for soldiers", knows: ["she paid Crix the ring", "her ship is overdue"] },
      { character: "Crix", location: "Tarsel docks", emotional_state: "shifty, calculating", knows: ["the Brindle was scuttled", "Nessa is being hunted"] },
    ],
    premise: "Nessa finds Crix on the dock at first light and presses him for news about the overdue ship; he gives evasive answers and tells her to wait at the rope-loft.",
    blockerInjection: "Have Nessa pay Crix again, this time with 'the silver ring she still wore' (the ring was given to him as deposit in ch5).",
    warningInjection: "Describe the scene as 'the noon sun overhead' even though it explicitly opens at dawn.",
    nitInjection: "Describe Nessa's satchel as 'leather' early on and as 'canvas' a few sentences later.",
    trapPhrase: "the gulls circled overhead like questions that wouldn't go away",
  },
  {
    id: "market_thief_payback",
    setting: "The east market square, midmorning",
    characters: ["Pip", "Halden"],
    facts: [
      { chapter: 1, category: "event", fact: "Halden caught Pip stealing apples last week" },
      { chapter: 1, category: "agreement", fact: "Pip agreed to work off the debt by sweeping the stall every morning for a month" },
      { chapter: 2, category: "knowledge", fact: "Pip has not yet been told that Halden plans to apprentice her formally" },
      { chapter: 2, category: "object", fact: "Pip wears the same patched grey tunic she had when caught — she owns no other clothes" },
    ],
    states: [
      { character: "Pip", location: "Halden's stall, market square", emotional_state: "resentful but resigned", knows: ["she owes Halden", "she sweeps the stall every morning"] },
      { character: "Halden", location: "Halden's stall, market square", emotional_state: "stern, secretly fond", knows: ["he plans to apprentice her"] },
    ],
    premise: "Pip arrives at the stall a little after sunup, finds a broom propped against the cart wheel, and begins her sweeping routine while Halden lays out cloth bolts behind her.",
    blockerInjection: "Have Pip say to a customer, 'Mr Halden's going to apprentice me proper soon, you know' (she does not know about the apprenticeship per ch2).",
    warningInjection: "Open at midmorning, then a paragraph later (no transition) describe the market torches being lit against the dark.",
    nitInjection: "Describe Pip's tunic as 'patched grey' in one sentence and as 'patched brown' a few sentences later.",
    trapPhrase: "the morning crowd flowed around the stalls like water around stones",
  },
  {
    id: "prison_message_aftermath",
    setting: "Cell block C of the keep dungeon, damp stone, dim torchlight",
    characters: ["Oren", "Brek"],
    facts: [
      { chapter: 4, category: "event", fact: "Brek passed Oren's folded note to the warden's scribe two days ago" },
      { chapter: 5, category: "knowledge", fact: "Oren does not yet know that the note was intercepted by the warden himself" },
      { chapter: 5, category: "object", fact: "Oren has only a single thin blanket in his cell — his other belongings were taken at intake" },
      { chapter: 5, category: "death", fact: "Brek's superior, Ser Yorrin, was killed in a riot the previous day" },
    ],
    states: [
      { character: "Oren", location: "cell C-7", emotional_state: "tense, hopeful", knows: ["the note was passed to the scribe"] },
      { character: "Brek", location: "outside cell C-7", emotional_state: "frightened, complicit", knows: ["the note was passed", "Yorrin is dead"] },
    ],
    premise: "Brek brings Oren his evening meal and lingers a moment at the bars; Oren asks in a low voice whether there has been any reply, and Brek mutters that nothing has come back yet.",
    blockerInjection: "Have SER YORRIN, Brek's superior, walk past the cell and bark at Brek to move along (Yorrin is dead per ch5).",
    warningInjection: "Have Oren wrap himself in 'his three wool blankets' (he has only one thin blanket per ch5).",
    nitInjection: "Refer to the cell as 'C-7' early on and as 'C-9' a few sentences later.",
    trapPhrase: "the cold of the stone climbed into his bones like a slow patient guest",
  },
  {
    id: "library_map_followup",
    setting: "The castle library, dusty shelves, afternoon light through high windows",
    characters: ["Dara", "Lady Ros"],
    facts: [
      { chapter: 3, category: "discovery", fact: "Dara found a hidden compartment behind the eastern bookcase containing an old map" },
      { chapter: 3, category: "knowledge", fact: "Only Dara and Lady Ros know about the hidden compartment" },
      { chapter: 4, category: "object", fact: "The map was rolled up and hidden again behind the same bookcase that night" },
      { chapter: 5, category: "appearance", fact: "Lady Ros has long copper-red hair, usually braided" },
    ],
    states: [
      { character: "Dara", location: "library reading nook", emotional_state: "curious, conspiratorial", knows: ["where the map is hidden", "the symbols are unfamiliar"] },
      { character: "Lady Ros", location: "library reading nook", emotional_state: "intrigued, careful", knows: ["where the map is hidden"] },
    ],
    premise: "Dara joins Lady Ros at the reading nook and they pretend to examine a book of heraldry while quietly discussing the unfamiliar symbols on the map's lower margin.",
    blockerInjection: "Have a third character, MASTER FELL the librarian, lean in and offer to help interpret the map (only Dara and Lady Ros know about it per ch3).",
    warningInjection: "Have Lady Ros decide to fetch the map and 'be back from the east wing in moments' even though the bookcase is in this same room.",
    nitInjection: "Describe Lady Ros's hair as 'copper-red' early in the scene and as 'auburn brown' a few sentences later.",
    trapPhrase: "her thoughts moved through the book of heraldry like a ghost looking for a name",
  },
  {
    id: "throne_returned_exile",
    setting: "The throne room, court assembled, formal and tense",
    characters: ["King Aldos", "Duke Farren"],
    facts: [
      { chapter: 8, category: "event", fact: "King Aldos publicly exiled Duke Farren the previous chapter" },
      { chapter: 9, category: "disguise", fact: "Farren has returned to court in the disguise of a minor envoy named Talric" },
      { chapter: 9, category: "knowledge", fact: "King Aldos does not yet know that the envoy Talric is actually Farren" },
      { chapter: 9, category: "object", fact: "Farren wears a plain envoy's brown cloak with no insignia" },
    ],
    states: [
      { character: "King Aldos", location: "the throne", emotional_state: "imperious, distracted by court business", knows: ["Farren was exiled"] },
      { character: "Duke Farren", location: "the visitors' rail at the back of the hall", emotional_state: "tense, controlled", knows: ["he is in disguise as Talric"] },
    ],
    premise: "The court hears petitions; Aldos receives a delegation from a minor northern house, and a hooded envoy at the back of the hall watches the proceedings without speaking.",
    blockerInjection: "Have King Aldos point at the back of the hall and shout, 'You! Duke Farren! How dare you return!' (Aldos doesn't know it's Farren per ch9 knowledge fact).",
    warningInjection: "Describe the throne room scene as opening 'just past dawn' and then, within a few sentences, mention 'the long shadows of late afternoon' on the floor.",
    nitInjection: "Describe Farren's disguise cloak as 'brown' early on and as 'dark green' a few sentences later.",
    trapPhrase: "the throne room watched him the way a forest watches a stranger",
  },
  {
    id: "training_yard_lesson",
    setting: "The castle training yard, morning",
    characters: ["Captain Lyra", "Joss"],
    facts: [
      { chapter: 3, category: "event", fact: "Lyra disarmed Joss in three exchanges during their first sparring match" },
      { chapter: 4, category: "object", fact: "Joss's training sword has a wooden grip wrapped in plain leather" },
      { chapter: 4, category: "agreement", fact: "Lyra agreed to give Joss one private lesson each week" },
      { chapter: 4, category: "appearance", fact: "Captain Lyra is left-handed, fights with the sword in her left hand" },
    ],
    states: [
      { character: "Lyra", location: "training yard", emotional_state: "patient, exacting", knows: ["Joss's footwork is improving", "she promised him weekly lessons"] },
      { character: "Joss", location: "training yard", emotional_state: "eager, slightly anxious", knows: ["he was disarmed easily last time"] },
    ],
    premise: "Joss arrives early at the yard and warms up his footwork drills; Lyra joins him and they begin a slow-paced exchange focused on shoulder position.",
    blockerInjection: "Describe Lyra drawing her sword 'with her right hand' and parrying with it (she is left-handed per ch4).",
    warningInjection: "Have Joss say 'I haven't sparred with you in months' (their previous sparring was just last chapter).",
    nitInjection: "Describe Joss's training sword grip as 'wrapped in plain leather' in one line and as 'wrapped in dark cord' a few sentences later.",
    trapPhrase: "his anxiety circled him like a hungry dog he couldn't quite kick away",
  },
  {
    id: "spy_inn_after_search",
    setting: "A room at the Wheel & Anchor inn, late night",
    characters: ["Cael", "Mord"],
    facts: [
      { chapter: 4, category: "event", fact: "Cael secretly searched Mord's belongings while Mord slept and memorized the contents of a coded letter" },
      { chapter: 4, category: "knowledge", fact: "Mord does not know his belongings were searched" },
      { chapter: 5, category: "object", fact: "Cael wears a small silver pin shaped like a hawk on his collar" },
      { chapter: 5, category: "location", fact: "The inn's only stair to the upper rooms creaks loudly on the third step" },
    ],
    states: [
      { character: "Cael", location: "the upper room", emotional_state: "outwardly relaxed, internally watchful", knows: ["he memorized the letter", "the third stair creaks"] },
      { character: "Mord", location: "the upper room", emotional_state: "tired, unguarded", knows: ["nothing of the search"] },
    ],
    premise: "Mord and Cael return to the upper room after supper; they trade a few easy words about the road ahead, and Mord lies down on his bunk while Cael settles by the small window.",
    blockerInjection: "Have Mord turn to Cael and accuse him directly of 'reading the letter you stole from my pack' (Mord doesn't know per ch4).",
    warningInjection: "Have Cael go down to fetch water and return without any mention of the third-step creak — and the scene explicitly says he 'crept down in perfect silence' even though the stair creaks loudly.",
    nitInjection: "Describe the silver pin on Cael's collar as 'shaped like a hawk' early on and as 'shaped like a falcon' a few sentences later.",
    trapPhrase: "the candle flame leaned and stretched as if trying to overhear them",
  },
  {
    id: "mountain_guide_descent",
    setting: "A high pass in the Greysides, wind picking up",
    characters: ["Ewyn", "Halloran"],
    facts: [
      { chapter: 4, category: "event", fact: "Ewyn warned Halloran a storm was coming; Halloran refused to shelter" },
      { chapter: 4, category: "wound", fact: "Halloran lost two fingers on his left hand to frostbite during the storm" },
      { chapter: 5, category: "object", fact: "Halloran's pack horse, Bracken, was killed in a rockslide on the descent" },
      { chapter: 5, category: "location", fact: "The party is now on the lower switchbacks, an hour from the treeline" },
    ],
    states: [
      { character: "Ewyn", location: "lower switchbacks", emotional_state: "grim, quietly vindicated", knows: ["Halloran was warned", "Bracken is dead"] },
      { character: "Halloran", location: "lower switchbacks", emotional_state: "humbled, in pain", knows: ["he should have listened", "he has lost two fingers"] },
    ],
    premise: "Ewyn leads Halloran down the switchbacks at a careful pace; he stumbles once and she steadies him by the elbow without speaking.",
    blockerInjection: "Have Halloran lead BRACKEN, his pack horse, by the reins down the switchbacks (Bracken was killed in a rockslide per ch5).",
    warningInjection: "Have the party reach the treeline 'within minutes' even though it is established to be an hour away.",
    nitInjection: "Describe Halloran flexing his hand and counting 'all five fingers' in one sentence (he lost two fingers per ch4).",
    trapPhrase: "the wind talked to itself in the rocks above them",
  },
  {
    id: "healer_chamber_afterword",
    setting: "A healer's chamber, herbs drying overhead",
    characters: ["Cora", "Ser Baine"],
    facts: [
      { chapter: 4, category: "event", fact: "While tending Baine's wound in chapter 4, he let slip the name 'Lord Maro' as the man who ordered his death" },
      { chapter: 5, category: "knowledge", fact: "Cora has not told anyone what she heard — she is keeping it to herself for now" },
      { chapter: 5, category: "wound", fact: "Baine's wound is a deep cut along his left forearm, healing slowly" },
      { chapter: 5, category: "object", fact: "Cora keeps her best herbs in a locked oak chest, key around her neck" },
    ],
    states: [
      { character: "Cora", location: "her healer's chamber", emotional_state: "outwardly calm, inwardly troubled", knows: ["the name Lord Maro", "she has not told anyone"] },
      { character: "Baine", location: "her healer's chamber", emotional_state: "tired, grateful", knows: ["he is wounded", "he revealed the name to Cora"] },
    ],
    premise: "Cora changes the dressing on Baine's forearm; he watches her work in silence and asks, after a moment, whether the wound will leave a scar.",
    blockerInjection: "Have Cora tell another character (a visitor at the door) 'It was Lord Maro who tried to have him killed' (per ch5 she has told no one).",
    warningInjection: "Have Cora unlock the oak chest with 'the key she kept in her belt pouch' (the key is on a cord around her neck per ch5).",
    nitInjection: "Describe Baine's wound as being on his 'left forearm' in one sentence and on his 'right forearm' a few sentences later.",
    trapPhrase: "the herbs hanging overhead listened to their conversation like patient witnesses",
  },
  {
    id: "ship_storm_aftermath",
    setting: "The deck of the Brindle, the morning after the storm",
    characters: ["Nira", "Telm"],
    facts: [
      { chapter: 3, category: "event", fact: "During the night storm, Telm panicked and Nira pulled him bodily from the railing" },
      { chapter: 3, category: "object", fact: "The Brindle's foremast cracked in the storm and now leans heavily to port" },
      { chapter: 4, category: "death", fact: "Two crewmen, Joss and Wek, were swept overboard in the storm and drowned" },
      { chapter: 4, category: "appearance", fact: "Nira's hair is short and black, kept under a knit cap" },
    ],
    states: [
      { character: "Nira", location: "Brindle quarterdeck", emotional_state: "exhausted, in command", knows: ["Telm panicked last night", "the foremast is cracked", "Joss and Wek are dead"] },
      { character: "Telm", location: "Brindle main deck", emotional_state: "ashamed, grateful", knows: ["Nira saved him", "two men died"] },
    ],
    premise: "Telm finds Nira on the quarterdeck at first light and tries to thank her; she cuts him off and asks if he can help with the foremast repairs.",
    blockerInjection: "Have JOSS, one of the drowned crewmen, walk past with a coil of rope and nod a greeting to Nira (Joss died per ch4).",
    warningInjection: "Have the foremast described as 'standing tall and straight against the morning sky' (it is cracked and leaning to port per ch3).",
    nitInjection: "Describe Nira's hair as 'short black' early on and as 'short brown' a few sentences later.",
    trapPhrase: "the morning sea was a flat grey plate, holding nothing but the ship's small reflection",
  },
  {
    id: "garden_overheard",
    setting: "A walled garden at dusk, roses in bloom",
    characters: ["Lady Sela", "Lord Cren"],
    facts: [
      { chapter: 4, category: "event", fact: "Sela hid behind a hedge and overheard Cren give a hooded stranger a purse and the name 'Marrick'" },
      { chapter: 5, category: "knowledge", fact: "Cren does not know that Sela was hiding behind the hedge" },
      { chapter: 5, category: "object", fact: "The hedge in question was trimmed back severely the next morning by the gardeners" },
      { chapter: 5, category: "appearance", fact: "Lady Sela wears a high-collared dove-grey dress in this scene" },
    ],
    states: [
      { character: "Sela", location: "the garden path", emotional_state: "outwardly composed, inwardly afraid", knows: ["the name Marrick", "Cren paid the stranger"] },
      { character: "Cren", location: "the garden path", emotional_state: "calm, expansive", knows: ["the meeting last night"] },
    ],
    premise: "Sela walks the garden path with her uncle in the cool of the evening; they talk about the family's plans for the harvest festival, and Cren admires the roses.",
    blockerInjection: "Have Cren stop walking, turn to Sela, and say 'I know you were behind the hedge that night' (he does not know per ch5).",
    warningInjection: "Have Sela conceal herself behind 'the same hedge as before' even though the hedge was trimmed back severely the morning after (per ch5).",
    nitInjection: "Describe Sela's dress as 'dove-grey' early on and as 'pale lavender' a few sentences later.",
    trapPhrase: "the garden held its breath for them, as gardens sometimes do at dusk",
  },
  {
    id: "dungeon_pair_escape",
    setting: "A shared cell in the dungeon below the keep, near darkness",
    characters: ["Alec", "Bren"],
    facts: [
      { chapter: 4, category: "skill", fact: "Alec is a former locksmith and has been picking the cell lock with a bent nail" },
      { chapter: 5, category: "object", fact: "The bent nail Alec uses snapped off in the lock during last night's attempt — it is now stuck in the keyhole" },
      { chapter: 5, category: "event", fact: "The night guard rotation changed at midnight; the new guard is the strict one" },
      { chapter: 5, category: "knowledge", fact: "Alec has not told Bren that the nail snapped — Bren still thinks the plan is on for tonight" },
    ],
    states: [
      { character: "Alec", location: "shared cell", emotional_state: "anxious, hiding it", knows: ["the nail snapped", "the strict guard is on rotation"] },
      { character: "Bren", location: "shared cell", emotional_state: "tense with anticipation", knows: ["the plan is for tonight"] },
    ],
    premise: "Bren paces the cell while Alec sits with his back to the wall and watches the torchlight in the corridor outside. Bren whispers a question about how many hours are left until the attempt.",
    blockerInjection: "Have Alec take the bent nail from his sleeve and start working on the lock again (the nail snapped off in the lock per ch5).",
    warningInjection: "Have Bren note 'the soft footsteps of the easy-going guard' as the new rotation passes (the new guard is established as the strict one per ch5).",
    nitInjection: "Describe Bren's height as 'a head taller than Alec' early on and as 'about Alec's size' a few sentences later.",
    trapPhrase: "the silence of the cell was a third prisoner that never slept",
  },
  {
    id: "temple_door_refused",
    setting: "The stone temple of Vorra, doorway, night, rain",
    characters: ["Priest Vorn", "Dara Steelbow"],
    facts: [
      { chapter: 3, category: "event", fact: "In chapter 3, Priest Vorn refused Dara's request to shelter wounded soldiers, citing the sacred law against arms inside the temple" },
      { chapter: 3, category: "rule", fact: "Vorra's sacred law forbids any weapon from being carried past the inner doors" },
      { chapter: 4, category: "object", fact: "Dara carries a steel-bound longbow at all times — it is named 'Steelbow' and is the source of her epithet" },
      { chapter: 4, category: "appearance", fact: "Priest Vorn is bald and wears the white robe of a senior priest" },
    ],
    states: [
      { character: "Vorn", location: "temple doorway", emotional_state: "stern but not unkind", knows: ["the sacred law", "his refusal last night"] },
      { character: "Dara", location: "temple doorway", emotional_state: "frustrated, tired", knows: ["Vorn refused her", "the law forbids weapons"] },
    ],
    premise: "Dara returns to the temple in the rain and asks Vorn for a moment of his time. They speak in the doorway, neither stepping fully across the threshold.",
    blockerInjection: "Have Dara walk past Vorn into the inner sanctum still carrying her longbow Steelbow on her back (the inner doors forbid weapons per ch3).",
    warningInjection: "Have Vorn open the conversation by saying 'I have never refused you anything' (he refused her exactly the previous night per ch3).",
    nitInjection: "Describe Vorn as 'bald' in one sentence and as 'his grey hair plastered down by the rain' a few sentences later.",
    trapPhrase: "the rain on the temple steps spoke to her in a language she almost remembered",
  },
  {
    id: "crossroads_box_handover",
    setting: "A crossroads at dusk, fading light",
    characters: ["Kett", "the courier"],
    facts: [
      { chapter: 3, category: "agreement", fact: "Kett agreed to carry a sealed box from the hooded stranger to the courier at the crossroads, in exchange for a horse" },
      { chapter: 3, category: "object", fact: "The box is small, carved oak, sealed with red wax bearing a falcon insignia" },
      { chapter: 4, category: "knowledge", fact: "Kett does not know what is inside the box" },
      { chapter: 4, category: "appearance", fact: "Kett's horse, the one she was paid with, is a chestnut gelding with a white sock on the left foreleg" },
    ],
    states: [
      { character: "Kett", location: "the crossroads", emotional_state: "watchful, cautious", knows: ["she carries the box", "she has not opened it"] },
      { character: "courier", location: "the crossroads", emotional_state: "businesslike, hurried", knows: ["she is to take the box and leave"] },
    ],
    premise: "Kett dismounts at the crossroads and waits a few moments before the courier rides up; they exchange a brief password and Kett produces the sealed box from her saddlebag.",
    blockerInjection: "Have Kett tell the courier she 'opened it once on the road, just to look at the gold inside' (Kett does not know what is inside per ch4).",
    warningInjection: "Have the scene open 'at full dusk' and then a few sentences later describe 'the bright noon sun' on the road dust.",
    nitInjection: "Describe Kett's horse as 'a chestnut gelding with a white sock' in one sentence and as 'a bay gelding' a few sentences later.",
    trapPhrase: "the crossroads pulled at her four ways at once, the way crossroads always do",
  },
  {
    id: "farmhouse_charity",
    setting: "A farmhouse doorway, cold morning",
    characters: ["Mila", "Toll"],
    facts: [
      { chapter: 2, category: "event", fact: "Toll gave Mila a half-loaf of bread and a wedge of cheese the previous morning" },
      { chapter: 2, category: "appearance", fact: "Mila has two small children, a girl of about five and a boy of about three" },
      { chapter: 3, category: "object", fact: "Mila wears a thin grey shawl that Toll's late wife once owned — Toll gave it to her yesterday" },
      { chapter: 3, category: "knowledge", fact: "Mila does not know that the shawl belonged to Toll's late wife — he didn't tell her" },
    ],
    states: [
      { character: "Mila", location: "farmhouse doorway", emotional_state: "humble, grateful", knows: ["Toll fed her yesterday", "she has the shawl"] },
      { character: "Toll", location: "farmhouse doorway", emotional_state: "gruff, secretly moved", knows: ["the shawl was his wife's"] },
    ],
    premise: "Mila returns to Toll's door at first light to thank him and to ask, hesitantly, whether he might have any work she could do in exchange for another day's food.",
    blockerInjection: "Have Mila reach down and pat the head of her THREE children (she has only two per ch2).",
    warningInjection: "Have Mila thank Toll 'for the bread you gave me last week' (the bread was given the previous morning per ch2).",
    nitInjection: "Describe the shawl as 'thin grey' in one sentence and as 'thick brown wool' a few sentences later.",
    trapPhrase: "the cold morning wrapped itself around her shoulders like a second shawl",
  },
  {
    id: "tournament_unhorsed",
    setting: "The tournament lists the morning after",
    characters: ["Ser Gard", "the squire"],
    facts: [
      { chapter: 5, category: "event", fact: "An unknown challenger unhorsed Ser Gard the previous afternoon" },
      { chapter: 5, category: "knowledge", fact: "Ser Gard still does not know the challenger's identity — the challenger rode away without lifting his visor" },
      { chapter: 6, category: "object", fact: "Ser Gard's lance was shattered in the joust and has not been replaced" },
      { chapter: 6, category: "wound", fact: "Ser Gard wears a sling on his right arm — his shoulder was wrenched in the fall" },
    ],
    states: [
      { character: "Gard", location: "the lists", emotional_state: "humiliated, brooding", knows: ["he was unhorsed", "the challenger's identity is unknown"] },
      { character: "squire", location: "the lists", emotional_state: "dutiful, careful", knows: ["Gard's lance is shattered", "Gard is wounded"] },
    ],
    premise: "Ser Gard walks the empty lists in the morning while his squire follows a few paces behind carrying his helm and gauntlets. Gard stops near the spot where he fell and stands silent for a long moment.",
    blockerInjection: "Have Ser Gard mutter to himself 'so it was Lord Hewin under that helm — I should have known' (the challenger's identity is unknown to him per ch5).",
    warningInjection: "Have the squire offer 'your spare lance' as if it were ready to hand (the lance is shattered and has not been replaced per ch6).",
    nitInjection: "Describe Ser Gard's sling as being on his 'right arm' in one sentence and on his 'left arm' a few sentences later.",
    trapPhrase: "the empty lists felt like a stage after the actors had all gone home",
  },
  {
    id: "forge_apprentice_lesson",
    setting: "Rael's forge, morning, heat and hammer-noise",
    characters: ["Rael", "Ori"],
    facts: [
      { chapter: 3, category: "event", fact: "Last chapter Rael showed Ori that striking too hard shatters the cooling metal" },
      { chapter: 3, category: "object", fact: "Ori broke one of the forge's two hammers in his demonstration — only one hammer remains" },
      { chapter: 4, category: "rule", fact: "Rael has forbidden Ori from working the forge unsupervised until he can dress a billet without cracking it" },
      { chapter: 4, category: "appearance", fact: "Ori's left hand is bandaged from a burn earned in chapter 3" },
    ],
    states: [
      { character: "Rael", location: "the forge", emotional_state: "patient, watchful", knows: ["one hammer remains", "Ori is forbidden to work unsupervised"] },
      { character: "Ori", location: "the forge", emotional_state: "subdued, eager to redeem himself", knows: ["he broke the hammer", "he is not to work alone"] },
    ],
    premise: "Ori arrives at the forge before Rael and lays out the day's billets and tongs. When Rael steps in, the apprentice meets his eye and waits for permission to take up the hammer.",
    blockerInjection: "Have Ori reach for 'the second of the two hammers' and weigh it in his hand (only one hammer remains per ch3).",
    warningInjection: "Have Ori begin shaping a billet at the anvil before Rael has arrived (he is forbidden to work unsupervised per ch4).",
    nitInjection: "Describe Ori's bandaged hand as 'his left' early on and as 'his right' a few sentences later.",
    trapPhrase: "the forge fire spoke to itself in low orange voices",
  },

  // ── 10 new scenarios (post-apoc, sci-fi, portal/epic fantasy, romance/drama) with VAR_WARNING_2 ──
  {
    id: "supply_cache_return",
    setting: "The basement of an abandoned hardware store, late afternoon",
    characters: ["Dael", "Soren"],
    facts: [
      { chapter: 2, category: "event", fact: "The supply cache in this basement was already looted by the Riverfront group before Dael's team arrived" },
      { chapter: 3, category: "wound", fact: "Soren dislocated his right shoulder in the fence collapse; it was reset but is still in a sling" },
      { chapter: 3, category: "object", fact: "Dael's headlamp battery was spent during the overnight shelter search and has not been replaced" },
      { chapter: 4, category: "knowledge", fact: "Dael does not yet know that Soren found a secondary cache in the store's roof space — he decided not to tell the group until he checked it alone" },
    ],
    states: [
      { character: "Dael", location: "hardware store basement", emotional_state: "grimly focused, expecting to find nothing", knows: ["the cache was already looted", "Soren's shoulder is injured"] },
      { character: "Soren", location: "hardware store basement", emotional_state: "guarded — holding back the roof-space information", knows: ["there is a secondary cache in the roof space", "his shoulder is still in a sling"] },
    ],
    premise: "Dael leads Soren into the dark basement of the hardware store, not expecting much; they work their way to where the cache used to be.",
    blockerInjection: "Have Dael click on her headlamp to light the basement (her headlamp battery is spent and not replaced per ch3).",
    warningInjection: "Describe the walk from their shelter to the store as taking 'ten minutes' when earlier chapters established the shelter is two hours away on foot.",
    warningInjection2: "Have Soren swing both arms freely and shrug a heavy crate aside with no difficulty, acting as if his shoulder injury does not exist (he is in a sling and the shoulder is still tender per ch3).",
    nitInjection: "Describe Soren's sling as being on 'his left arm' in one sentence and 'his right arm' a few sentences later.",
    trapPhrase: "the basement swallowed the sounds from the street like water taking in rain",
  },
  {
    id: "settlement_meeting",
    setting: "The settlement's main hall, a converted high school gymnasium, evening",
    characters: ["Mora", "Elected Speaker Rand", "Tave"],
    facts: [
      { chapter: 2, category: "event", fact: "Community member Hex was expelled from the settlement by majority vote after the food cache theft" },
      { chapter: 3, category: "repair", fact: "The eastern water pump was repaired yesterday and is now operational" },
      { chapter: 4, category: "rule", fact: "Standing order: no settlement member may leave the perimeter alone after dark" },
      { chapter: 4, category: "knowledge", fact: "Tave does not yet know that Rand is the one who cast the deciding vote to expel Hex" },
    ],
    states: [
      { character: "Mora", location: "settlement main hall", emotional_state: "watchful — the room is still tense after the expulsion", knows: ["Hex is gone", "the water pump is fixed", "Rand voted to expel Hex"] },
      { character: "Elected Speaker Rand", location: "settlement main hall", emotional_state: "composed but aware several members resent the expulsion vote", knows: ["he cast the deciding vote", "the pump is operational"] },
      { character: "Tave", location: "settlement main hall", emotional_state: "subdued — she was close to Hex", knows: ["Hex was expelled", "the water pump is now working"] },
    ],
    premise: "Rand opens the weekly settlement meeting; Mora reads off infrastructure updates; Tave sits near the back and watches Rand from across the room.",
    blockerInjection: "Have Hex stand up from a seat in the back row and ask a question during the meeting (Hex was expelled from the settlement per ch2).",
    warningInjection: "Open the scene at evening, then two paragraphs later describe members filing out into midday sunlight as the meeting wraps up.",
    warningInjection2: "Have Tave glare at Rand and mutter to her neighbor that she will never forgive him for casting the deciding vote — as if she already knows he did it (she does not yet know this per ch4).",
    nitInjection: "Describe the gymnasium floor as 'concrete' in one sentence and 'hardwood' a few sentences later.",
    trapPhrase: "the meeting moved from point to point like water finding the low places in a floor",
  },
  {
    id: "perimeter_watch_handover",
    setting: "Sector 3 of the settlement perimeter fence, the weak post, early morning",
    characters: ["Watcher Gole", "Watcher Prist"],
    facts: [
      { chapter: 2, category: "event", fact: "Sector 3 of the perimeter fence was breached overnight; temporary repair was applied but the post is still weak" },
      { chapter: 3, category: "object", fact: "The settlement's remaining signal flares — all three — were used in last week's emergency and have not been restocked" },
      { chapter: 4, category: "event", fact: "Watch-Captain Ren was demoted to senior watcher after the unauthorized gate opening incident" },
      { chapter: 4, category: "knowledge", fact: "Gole does not yet know that Prist filed a formal complaint about the sector 3 breach before the handover" },
    ],
    states: [
      { character: "Watcher Gole", location: "sector 3 perimeter post", emotional_state: "tired from the night shift, relieved to be handing over", knows: ["sector 3 is still weak", "no signal flares remain", "Ren was demoted"] },
      { character: "Watcher Prist", location: "sector 3 perimeter post", emotional_state: "alert and slightly tense — she filed the complaint", knows: ["she filed the complaint about the breach", "Ren was demoted", "no flares remain"] },
    ],
    premise: "Gole meets Prist at the weak sector 3 post at dawn to hand over the morning watch; they do a brief status check before Gole is released.",
    blockerInjection: "Have Gole reach for a signal flare from his belt kit and fire it to signal the all-clear handover (no signal flares remain per ch3).",
    warningInjection: "Describe the handover happening 'as the noon sun rose above the tree line' when the scene is established as dawn.",
    warningInjection2: "Have Watch-Captain Ren stride up to supervise the handover and issue orders to both watchers with full authority, as if still in command (Ren was demoted to senior watcher per ch4).",
    nitInjection: "Describe the weak fence post as 'the third post from the left' in one sentence and 'the fourth post from the left' a few sentences later.",
    trapPhrase: "the silence at the perimeter had a different quality from the silence inside — it faced the wrong direction",
  },
  {
    id: "engineering_bay",
    setting: "The Ardent engineering bay, section B-4, shipboard morning",
    characters: ["Engineer Rys", "Cadet Loom"],
    facts: [
      { chapter: 3, category: "location", fact: "The secondary plasma relay in bay B-4 was sealed off after it failed; the access panel is welded shut" },
      { chapter: 4, category: "personnel", fact: "Engineer Renn was reassigned to med-bay support after the reactor event and is no longer on engineering rotation" },
      { chapter: 5, category: "object", fact: "The standard repair kit was entirely depleted on the bridge conduit repair and has not been restocked" },
      { chapter: 5, category: "knowledge", fact: "Cadet Loom does not yet know that her certification to operate the plasma torches was revoked by Chief Tollen pending a safety review" },
    ],
    states: [
      { character: "Engineer Rys", location: "engineering bay B-4", emotional_state: "methodical, working through the repair list", knows: ["the plasma relay is sealed", "Renn is gone", "the repair kit is depleted", "Loom's torch cert is revoked"] },
      { character: "Cadet Loom", location: "engineering bay B-4", emotional_state: "eager, trying to be useful", knows: ["the relay is sealed", "the repair kit is depleted"] },
    ],
    premise: "Rys and Cadet Loom work through a routine inspection of bay B-4; Loom tries to anticipate what tools will be needed while Rys checks the seal on the offline relay.",
    blockerInjection: "Have Loom open the welded access panel on the secondary plasma relay and reach inside to check the coupling (the panel is welded shut per ch3).",
    warningInjection: "Have Rys suggest they grab Renn to help with the heavy valve work, as if Renn is still on engineering rotation (Renn was reassigned to med-bay per ch4).",
    warningInjection2: "Have Loom confidently fire up the plasma torch and begin cutting without asking Rys, acting as if she has full certification — when her cert has been revoked pending safety review per ch5.",
    nitInjection: "Describe the bay section as 'B-4' early on and 'B-6' a few sentences later.",
    trapPhrase: "the machinery breathed around them in long low pulses, as if the ship were counting something",
  },
  {
    id: "command_deck_brief",
    setting: "The Ardent command deck, morning status briefing, 0800 ship-time",
    characters: ["Commander Yael", "Lieutenant Orin"],
    facts: [
      { chapter: 3, category: "personnel", fact: "Ensign Park was confined to quarters pending investigation for the navigation log incident" },
      { chapter: 4, category: "equipment", fact: "The long-range scanner array is offline following the reactor coupling failure and has not been repaired" },
      { chapter: 5, category: "order", fact: "Commander Yael ordered all non-essential crew to rest rotation — only duty stations are manned" },
      { chapter: 5, category: "knowledge", fact: "Orin does not yet know that the investigation of Ensign Park was closed overnight with a finding of equipment fault, not misconduct" },
    ],
    states: [
      { character: "Commander Yael", location: "command deck", emotional_state: "controlled and methodical — managing the ship one item at a time", knows: ["Park is confined", "scanner is offline", "crew is on rest rotation", "the investigation closed overnight"] },
      { character: "Lieutenant Orin", location: "command deck", emotional_state: "alert, preparing the status summary", knows: ["Park is confined", "scanner is offline"] },
    ],
    premise: "Orin delivers the morning status report to Commander Yael on the command deck; Yael listens and adds comments as the items are read.",
    blockerInjection: "Have Orin report long-range scanner data showing a vessel at bearing 220 mark 15 (the scanner is offline and cannot collect data per ch4).",
    warningInjection: "Have Orin describe this as the 0800 briefing, then note the 'night crew just came off a twenty-hour shift' — contradicting the established rest-rotation limiting shifts to standard lengths per ch5.",
    warningInjection2: "Have Orin suggest pulling Ensign Park off rest to cover a duty gap, treating Park as available and cleared — when Park is confined to quarters pending investigation per ch3.",
    nitInjection: "Refer to the duty officer as 'Lieutenant Orin' in one sentence and 'Ensign Orin' a few sentences later.",
    trapPhrase: "the status report moved from item to item the way a clock moves — indifferent to what the numbers mean",
  },
  {
    id: "road_camp",
    setting: "A forest clearing, two travelers' camp, late evening",
    characters: ["Mira", "Aldec"],
    facts: [
      { chapter: 2, category: "object", fact: "Their fire steel was lost when Mira dropped the pack crossing the flooded river" },
      { chapter: 3, category: "animal", fact: "Mira's horse went lame from a thrown shoe and had to be left at the last village" },
      { chapter: 4, category: "supplies", fact: "They have exactly three days of rations remaining, counted and agreed upon at the last camp" },
      { chapter: 4, category: "knowledge", fact: "Aldec has not told Mira that he spotted riders on the road behind them this afternoon" },
    ],
    states: [
      { character: "Mira", location: "forest clearing camp", emotional_state: "tired, wary of the forest sounds", knows: ["the fire steel is lost", "her horse is gone", "three days of rations remain"] },
      { character: "Aldec", location: "forest clearing camp", emotional_state: "watchful — the riders concern him", knows: ["the fire steel is lost", "three days of rations remain", "riders were on the road this afternoon"] },
    ],
    premise: "Mira and Aldec make camp in a forest clearing as night comes on; Mira collects wood while Aldec tends to his own horse and their packs.",
    blockerInjection: "Have Mira pull the fire steel from her belt kit and strike a spark to light the tinder (the fire steel was lost at the river crossing per ch2).",
    warningInjection: "Describe the camp as being two hours into the forest, then have Aldec mention they could reach the village 'in twenty minutes if we leave now' (the village is a day's walk behind them).",
    warningInjection2: "Have Mira unsaddle her horse and tie it to a tree for the night, going through the routine of caring for the animal — when her horse was left at the last village after going lame per ch3.",
    nitInjection: "Describe Aldec's pack as 'brown canvas' early in the scene and 'dark leather' a few sentences later.",
    trapPhrase: "the fire caught the way most good things do — slowly, then all at once",
  },
  {
    id: "healer_quarters",
    setting: "The healer's chambers in the lower part of the guild hall, early morning",
    characters: ["Healer Fen", "Apprentice Donal"],
    facts: [
      { chapter: 3, category: "supplies", fact: "The clinic's supply of feverwort was entirely used on yesterday's patients and none remains" },
      { chapter: 4, category: "rule", fact: "Apprentice Donal is forbidden from using binding spells unsupervised until he passes the level-two certification" },
      { chapter: 5, category: "physical", fact: "Healer Fen has not slept in thirty-six hours following the overnight emergency" },
      { chapter: 5, category: "knowledge", fact: "Donal does not yet know that Fen handled the overnight emergency entirely without calling him in — Fen is concealing how depleted she is" },
    ],
    states: [
      { character: "Healer Fen", location: "healer's chambers", emotional_state: "running on nothing — concealing how depleted she is", knows: ["no feverwort remains", "Donal cannot do binding spells alone", "she has not slept in 36 hours"] },
      { character: "Apprentice Donal", location: "healer's chambers", emotional_state: "alert and eager, unaware Fen is at her limits", knows: ["no feverwort remains", "he needs supervision for binding spells"] },
    ],
    premise: "Donal arrives at the chambers at dawn to begin the morning preparation; Fen is already there, having never left, though she has been careful to look composed.",
    blockerInjection: "Have Donal open the feverwort cabinet and count out a measured dose for the morning patient queue (no feverwort remains — entirely used yesterday per ch3).",
    warningInjection: "Describe Donal arriving 'at dawn after a full night's rest' in normal morning light, then have Fen immediately reference 'the emergency patient from last night still in recovery' — implying an emergency hours ago that contradicts when Donal could plausibly have arrived.",
    warningInjection2: "Have Donal independently cast a binding spell on a patient without calling for Fen or asking permission, acting as if he has full certification — when he is explicitly forbidden to use binding spells unsupervised per ch4.",
    nitInjection: "Describe Fen's healer's sash as 'green' in one sentence and 'blue' a few sentences later.",
    trapPhrase: "the morning came in through the narrow window the way it always did — as if nothing had changed in the night",
  },
  {
    id: "cafe_after_fight",
    setting: "A corner cafe near the university, Tuesday noon",
    characters: ["Sam", "Lena"],
    facts: [
      { chapter: 3, category: "event", fact: "Sam said 'you always do this' in front of Lena's friends at the party and Lena left without responding" },
      { chapter: 3, category: "agreement", fact: "Before the party incident they had arranged to meet at this cafe on Tuesday at noon" },
      { chapter: 4, category: "object", fact: "Sam's phone battery died on the way here and she has no charger with her" },
      { chapter: 4, category: "knowledge", fact: "Sam does not know that Lena drafted and deleted four different replies to the party message before deciding to show up" },
    ],
    states: [
      { character: "Sam", location: "the cafe", emotional_state: "nervous — she knows the comment landed badly", knows: ["the meeting was pre-arranged", "she said something hurtful at the party", "her phone is dead"] },
      { character: "Lena", location: "the cafe", emotional_state: "still stung but showing up — she decided something on the way here", knows: ["Sam's comment hurt", "she deleted four replies before showing up", "the meeting was pre-arranged"] },
    ],
    premise: "Sam arrives at the cafe and sees Lena already there with a coffee; she sits down opposite her and neither speaks for a moment.",
    blockerInjection: "Have Sam text Lena 'just got here, I'm at the corner table' as she sits down (Sam's phone battery is dead per ch4).",
    warningInjection: "Open the scene at noon and two paragraphs later have Sam look out the window and note 'the last customers had left for the evening' with no time-skip indicated.",
    warningInjection2: "Have Lena greet Sam warmly and immediately make a light joke about the party, acting easy and unbothered — when she is established as still stung and guarded from what Sam said per her character state.",
    nitInjection: "Describe Lena's jacket as 'dark green' early in the scene and 'navy blue' a few sentences later.",
    trapPhrase: "the silence between them was the kind that has weight but not direction",
  },
  {
    id: "homecoming",
    setting: "The family home in a quiet suburb, a Saturday afternoon",
    characters: ["Jules", "Their Father", "Sibling Pax"],
    facts: [
      { chapter: 1, category: "event", fact: "Jules moved out of the family home under bad terms six months ago after an argument about the inheritance money" },
      { chapter: 3, category: "knowledge", fact: "Pax told Jules via text that Pax would also be coming to the house today — they have not seen each other since Jules moved out" },
      { chapter: 4, category: "health", fact: "Their father is in early recovery from a minor stroke and does not yet know that Jules and Pax have been estranged" },
      { chapter: 4, category: "knowledge", fact: "Jules does not know that Pax told their father Jules was 'travelling' to explain the six-month absence" },
    ],
    states: [
      { character: "Jules", location: "the family home", emotional_state: "tense — returning under difficult circumstances", knows: ["they left under bad terms", "Pax is coming", "their father doesn't know about the estrangement"] },
      { character: "Their Father", location: "the family home", emotional_state: "pleased Jules is back, physically tired from recovery", knows: ["Jules was 'travelling' per Pax's explanation", "he is in recovery from a stroke"] },
      { character: "Sibling Pax", location: "the family home", emotional_state: "watchful — the cover story requires Jules to play along", knows: ["they told their father Jules was travelling", "Jules knows this via Pax's text"] },
    ],
    premise: "Jules arrives at the family home in the afternoon and finds their father in the kitchen and Pax already there; the three of them sit down at the kitchen table.",
    blockerInjection: "Have their father bring up the inheritance argument directly, saying he wants to clear the air about what happened six months ago — when he doesn't know Jules and Pax are estranged and believes Jules was simply travelling per ch4.",
    warningInjection: "Describe Jules arriving in the early afternoon, then have a character mention 'it's nearly midnight' a few paragraphs later with no time-skip indicated.",
    warningInjection2: "Have Jules immediately and warmly greet Pax with a hug and pick up casual conversation as if nothing happened, acting fully at ease with their sibling — when Jules is established as tense and the estrangement is real and recent per ch1.",
    nitInjection: "Describe the kitchen table as 'oak' in one sentence and 'pine' a few sentences later.",
    trapPhrase: "the house smelled the way it always had, which was somehow the hardest part",
  },
]

// ── Variant types ─────────────────────────────────────────────────────────

type VariantType = "VAR_NONE" | "VAR_BLOCKER" | "VAR_WARNING" | "VAR_WARNING_2" | "VAR_NIT" | "VAR_TRAP" | "VAR_MULTI"
type Severity = "blocker" | "warning" | "nit"

interface VariantSpec {
  type: VariantType
  expectedSeverities: Severity[]   // deterministic label
  instruction: string              // what to tell the prose-writing LLM
}

function getVariants(s: Scenario): VariantSpec[] {
  const variants: VariantSpec[] = [
    {
      type: "VAR_NONE",
      expectedSeverities: [],
      instruction: `Write a clean ~120-word draft of the premise. Stay strictly consistent with EVERY fact and character state above. Do NOT introduce any contradictions, timeline mismatches, descriptor changes, or knowledge violations. The draft should pass a continuity check with zero issues.`,
    },
    {
      type: "VAR_BLOCKER",
      expectedSeverities: ["blocker"],
      instruction: `Write a ~120-word draft of the premise. Stay clean on everything EXCEPT plant exactly ONE blocker-severity contradiction, as follows: ${s.blockerInjection}\n\nDo NOT introduce any other contradictions or descriptor inconsistencies. Only this one blocker.`,
    },
    {
      type: "VAR_WARNING",
      expectedSeverities: ["warning"],
      instruction: `Write a ~120-word draft of the premise. Stay clean on everything EXCEPT plant exactly ONE warning-severity timeline or travel inconsistency, as follows: ${s.warningInjection}\n\nDo NOT introduce any factual contradictions or descriptor mismatches. Only this one warning.`,
    },
    {
      type: "VAR_NIT",
      expectedSeverities: ["nit"],
      instruction: `Write a ~120-word draft of the premise. Stay clean on everything EXCEPT plant exactly ONE nit-severity drift (description / name / object), as follows: ${s.nitInjection}\n\nDo NOT introduce any blockers, warnings, timeline mismatches, or knowledge violations. Only this one nit.`,
    },
    {
      type: "VAR_TRAP",
      expectedSeverities: [],
      instruction: `Write a clean ~120-word draft of the premise consistent with EVERY fact and state. Embed this exact figurative phrase verbatim somewhere in the prose: "${s.trapPhrase}". This phrase is metaphor only — it must NOT correspond to any literal event in the scene. The draft should still pass a continuity check with zero issues; the phrase is a precision-trap for over-literal continuity checkers.`,
    },
    {
      type: "VAR_MULTI",
      expectedSeverities: ["blocker", "nit"],
      instruction: `Write a ~120-word draft of the premise. Plant exactly TWO issues — one blocker and one nit:\n  - BLOCKER: ${s.blockerInjection}\n  - NIT: ${s.nitInjection}\n\nDo NOT plant any third issue, warning, or any other contradiction.`,
    },
  ]
  if (s.warningInjection2) {
    variants.push({
      type: "VAR_WARNING_2",
      expectedSeverities: ["warning"],
      instruction: `Write a ~120-word draft of the premise. Stay clean on everything EXCEPT plant exactly ONE warning-severity characterization or state drift, as follows: ${s.warningInjection2}\n\nDo NOT introduce any factual contradictions, timeline mismatches, or descriptor changes. Only this characterization drift.`,
    })
  }
  return variants
}

// ── Draft generation ──────────────────────────────────────────────────────

const GEN_SYSTEM = `You write short chapter-draft excerpts for a continuity-checker eval. The drafts must respect a list of established facts and character states EXACTLY, except when an instruction asks you to plant a specific contradiction. Return ONLY the draft prose itself — no preamble, no labels, no commentary, no JSON wrapper.`

async function generateDraft(s: Scenario, variant: VariantSpec): Promise<string> {
  const factsBlock = s.facts.map(f => `  - [ch${f.chapter}] [${f.category}] ${f.fact}`).join("\n")
  const statesBlock = s.states.map(cs =>
    `  - ${cs.character}: at ${cs.location}, feeling ${cs.emotional_state}, knows: ${cs.knows.join("; ")}`
  ).join("\n")

  const prompt = `Setting: ${s.setting}
Characters: ${s.characters.join(", ")}

ESTABLISHED FACTS (must be respected unless variant tells you otherwise):
${factsBlock}

CHARACTER STATES:
${statesBlock}

Premise of this scene: ${s.premise}

Variant: ${variant.type}
Instruction: ${variant.instruction}

Write the ~120-word draft now.`

  const transport = getTransport()
  const result = await transport.execute({
    systemPrompt: GEN_SYSTEM,
    userPrompt: prompt,
    provider: "cerebras",
    model: "qwen-3-235b-a22b-instruct-2507",
    temperature: 0.7,
    maxTokens: 400,
  })
  let draft = result.content.trim()
  // Strip JSON wrapper if model returned {"draft": "..."}
  if (draft.startsWith("{")) {
    try {
      const parsed = JSON.parse(draft)
      draft = (parsed.draft ?? parsed.text ?? parsed.prose ?? draft).trim()
    } catch {}
  }
  // Strip surrounding quotes
  if ((draft.startsWith('"') && draft.endsWith('"')) || (draft.startsWith("'") && draft.endsWith("'"))) {
    draft = draft.slice(1, -1).trim()
  }
  // Strip leading "Draft:" / "Here is" preambles if any sneak in
  draft = draft.replace(/^(Draft|Here(?:'s| is)[^:]*):\s*/i, "").trim()
  return draft
}

// ── Pair builder ──────────────────────────────────────────────────────────

function buildPair(s: Scenario, variant: VariantSpec, draft: string): string {
  const states: CharStateRow[] = s.states
  const user = buildContinuityUserPrompt(draft, s.facts, states)
  // Assistant message is the deterministic label as a JSON object with ONLY
  // the expected severity set. Specific issue text is judgment-call territory.
  const assistant = JSON.stringify({
    expectedSeverities: variant.expectedSeverities,
  })
  return JSON.stringify({
    messages: [
      { role: "system",    content: CONTINUITY_SYSTEM },
      { role: "user",      content: user },
      { role: "assistant", content: assistant },
    ],
    _meta: { scenario: s.id, variant: variant.type, draft },
  })
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const expId = EXPERIMENT_ID ?? await createTuningExperiment(
    "data-generation",
    "Continuity-checker synthetic eval data — 20 scenarios × 6 variants",
    {
      scenarios: SCENARIOS.length,
      variantsPerScenario: 6,
      totalTarget: SCENARIOS.length * 6,
      variants: ["VAR_NONE", "VAR_BLOCKER", "VAR_WARNING", "VAR_NIT", "VAR_TRAP", "VAR_MULTI"],
      generator: "cerebras qwen-3-235b-a22b-instruct-2507 t=0.7",
      labelStrategy: "deterministic from variant — expected severity SET, specific issue text not scored",
      approach: "hand-written scenarios with specific planted-issue strings, LLM rewrites premise per variant",
    },
    { target: "continuity", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}`)

  // Fresh run starts a new file. Resume runs (EXPERIMENT_ID set) append.
  if (!EXPERIMENT_ID && existsSync(OUT_PATH)) {
    unlinkSync(OUT_PATH)
    console.log(`Removed existing ${OUT_PATH}`)
  }

  const pairs: string[] = []
  let done = 0
  const total = SCENARIOS.length * 6

  for (const scenario of SCENARIOS) {
    const variants = getVariants(scenario)
    console.log(`\n[${scenario.id}]`)

    for (const variant of variants) {
      process.stdout.write(`  ${variant.type}... `)
      try {
        const draft = await generateDraft(scenario, variant)
        const pair = buildPair(scenario, variant, draft)
        pairs.push(pair)
        appendFileSync(OUT_PATH, pair + "\n")
        done++
        const preview = draft.replace(/\s+/g, " ").slice(0, 70)
        process.stdout.write(`done (${done}/${total}) — "${preview}${draft.length > 70 ? "…" : ""}"\n`)
      } catch (err) {
        process.stdout.write(`ERROR: ${err}\n`)
      }
    }
  }

  // Summary stats per variant
  const byVariant = new Map<string, number>()
  for (const p of pairs) {
    const v = JSON.parse(p)._meta.variant as string
    byVariant.set(v, (byVariant.get(v) ?? 0) + 1)
  }
  const variantSummary = [...byVariant.entries()].map(([v, n]) => `${v}=${n}`).join(", ")

  const conclusion = `Generated ${pairs.length}/${total} continuity-checker eval pairs. ${variantSummary}. Saved to lora-data/continuity-pairs.jsonl. 20 scenarios × 6 variants. Each scenario hand-specifies its blocker/warning/nit/trap injection strings; the LLM rewrites the scenario premise per variant. Labels are deterministic from variant — expected severity SET only. Used by score-continuity-baseline.ts and score-continuity-checklist.ts (the continuity ladder, mirroring exp #110/#111 adherence-checker and exp #114/#115 reference-resolver).`
  await concludeExperiment(expId, conclusion)
  console.log(`\n${conclusion}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
