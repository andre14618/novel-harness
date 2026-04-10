/**
 * Synthetic training data generator for the 4-call decomposed adherence-checker SFT.
 *
 * Architecture:
 *   1. Generate prose for each (scenario × variant) via 5 DIFFERENT writers
 *      (stylistic diversity + organic drift from weaker models)
 *   2. Label each prose sample through 4 decomposed oracle calls (events / setting /
 *      tangent / character) using the PRODUCTION system prompts from adherence-checker.ts
 *   3. Output 4 training examples per prose sample in OpenAI chat format
 *
 * 60 scenarios × 8 variants × 5 writers = 2,400 prose samples × 4 calls = 9,600 training examples.
 *
 * Writers span 3 providers for parallelism and stylistic diversity:
 *   - Cerebras Qwen 235B     (production beat-writer — the style the checker sees most)
 *   - Groq Llama 3.1 8B      (cheap, fast, drifts naturally — better organic FAIL cases)
 *   - Groq Kimi K2            (1T MoE, distinct style)
 *   - DeepSeek V3.2           (685B MoE, yet another prose register)
 *
 * Labels come from the 235B oracle's actual judgments on each decomposed call,
 * NOT from deterministic variant-type mapping. This captures organic cross-contamination
 * (e.g., a weaker writer drifting on a PASS_CLEAN variant gets correctly labeled FAIL).
 *
 * Usage:
 *   bun scripts/generate-adherence-decomposed-data.ts
 *   bun scripts/generate-adherence-decomposed-data.ts --sample 8
 *   bun scripts/generate-adherence-decomposed-data.ts --writers cerebras,deepseek
 *   EXPERIMENT_ID=N bun scripts/generate-adherence-decomposed-data.ts
 */

import { appendFileSync, writeFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"
import type { ProviderName } from "../models/registry"

const EXPERIMENT_ID = process.env.EXPERIMENT_ID ? parseInt(process.env.EXPERIMENT_ID) : null
const SAMPLE_ARG = process.argv.indexOf("--sample")
const SAMPLE_N = SAMPLE_ARG !== -1 ? parseInt(process.argv[SAMPLE_ARG + 1]) : null
const WRITERS_ARG = process.argv.indexOf("--writers")
const WRITERS_FILTER = WRITERS_ARG !== -1 ? process.argv[WRITERS_ARG + 1]?.split(",") : null
const OUT_PATH = join(import.meta.dir, "../lora-data/adherence-checker-v3-mixed-teacher.jsonl")

// ── Writer definitions ──────────────────────────────────────────────────────
// Multiple writers for stylistic diversity + organic drift from weaker models.
// Cross-model prose generation avoids self-agreement bias (see build-analytical-finetune-data.ts
// comment: same-model gen+eval hit 100% pass on 11 pairs).

interface Writer {
  key: string
  label: string
  provider: ProviderName
  model: string
}

const ALL_WRITERS: Writer[] = [
  { key: "cerebras",  label: "Cerebras Qwen 235B",  provider: "cerebras",  model: "qwen-3-235b-a22b-instruct-2507" },
  { key: "llama8b",   label: "Llama 3.1 8B (Groq)", provider: "groq",      model: "llama-3.1-8b-instant" },
  { key: "kimik2",    label: "Kimi K2 (Groq)",      provider: "groq",      model: "moonshotai/kimi-k2-instruct-0905" },
  { key: "deepseek",  label: "DeepSeek V3.2",       provider: "deepseek",  model: "deepseek-chat" },
  // gpt-oss-120b removed: 404 on Groq as of 2026-04-09
]

// ── Production system prompts (must match adherence-checker.ts exactly) ──

const EVENTS_SYSTEM = `You verify whether the prose ENACTS a specific scene beat on-page.

Find the passage where the beat's action happens — characters performing the action, dialogue, narration of the action as it occurs in scene.

Rules:
- "Enacted" means the action happens IN SCENE during this prose. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized in narration as backstory) does NOT count as enacted.
- Characters being merely present in the scene is NOT enough — the beat's specific action must occur.
- If you cannot find a passage where the beat is enacted, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

const SETTING_SYSTEM = `You verify whether the prose CONTRADICTS the expected setting for a scene beat.

The expected setting is a brief description (e.g., "a crowded tavern, evening, smoky torchlight"). This beat may be one of several in a chapter — the prose often inherits setting from earlier beats and does NOT re-establish it. That is normal craft and not a mismatch.

ONLY flag setting_matches=false when the prose places the scene in a CLEARLY DIFFERENT setting than expected. Examples of real contradictions:
- Different named location (tavern vs castle, kitchen vs garden)
- Different building or room when the beat names a specific one
- Outdoors vs indoors when the beat is explicit about which
- Different time of day when the beat is explicit (dawn vs midnight)
- Different city, region, or world

If the prose simply doesn't mention setting markers — it's continuing a scene from a prior beat, focused on dialogue, character interiority, or close action — return setting_matches=true. Absence of setting markers is NOT a mismatch. Only POSITIVE evidence of a different setting counts.

Respond with ONLY valid JSON in this exact shape:
{
  "setting_matches": true | false,
  "expected_setting": "<the expected setting, restated>",
  "actual_setting": "<the setting the prose establishes, or 'inherited from prior beat' if not re-established>",
  "reasoning": "<one sentence>"
}`

const TANGENT_SYSTEM = `You measure whether the prose has DRIFTED OFF the scene beat into unrelated content.

A "tangent" is the prose abandoning the beat to pursue something the beat does not call for: an unrelated subplot, scene drift to another character's storyline, lengthy unrelated backstory dump, or the prose pivoting away from the beat entirely.

The following are NOT tangents — they are normal prose craft and must NOT be flagged:
- Atmospheric description (weather, sensory details, environmental texture)
- Character interiority (POV character's thoughts, feelings, memories triggered by what's happening)
- Sensory grounding (what the character sees, hears, smells, touches)
- Emotional reactions to the beat's action
- Brief flashes of backstory the beat itself implies
- Dialogue that develops the beat's situation, even if it briefly digresses
- Pacing variation, internal monologue, descriptive flourishes

The threshold for is_tangent=true is HIGH: more than ~60% of the prose must be doing something completely unrelated to the beat. If the beat is happening anywhere in the prose — even surrounded by atmospheric and interior detail — is_tangent=false.

Estimate the off-spec fraction (0.0 = entirely on-spec, 1.0 = entirely off-spec). Only quote a passage if you are flagging is_tangent=true.

Respond with ONLY valid JSON in this exact shape:
{
  "off_spec_fraction": 0.0,
  "off_spec_quote": "<quoted passage, or empty string>",
  "is_tangent": true | false,
  "reasoning": "<one sentence>"
}`

const CHARACTER_SYSTEM = `You verify whether characters in the prose behave consistently with their roles in a scene beat.

A character "acts contrary to their role" when they do something the beat says they should NOT do, or when they take an action that reverses the beat's intended dynamic (e.g., the beat calls for the character to refuse but the prose has them immediately agree, or the beat calls for confrontation but the prose has them stay silent).

Do NOT flag normal creative interpretation: dialogue rewording, gesture additions, emotional shading, or pacing variation. Only flag clear contradictions.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where contradiction occurs, or empty string>",
  "reasoning": "<one sentence>"
}`

type CallType = "events" | "setting" | "tangent" | "character"

const CALL_CONFIGS: Record<CallType, { system: string; buildUser: (beat: string, setting: string, chars: string, prose: string) => string }> = {
  events: {
    system: EVENTS_SYSTEM,
    buildUser: (beat, _setting, chars, prose) =>
      `BEAT: ${beat}\nCHARACTERS EXPECTED: ${chars}\n\nPROSE:\n---\n${prose}\n---`,
  },
  setting: {
    system: SETTING_SYSTEM,
    buildUser: (beat, setting, _chars, prose) =>
      `BEAT: ${beat}\nEXPECTED SETTING: ${setting}\n\nPROSE:\n---\n${prose}\n---`,
  },
  tangent: {
    system: TANGENT_SYSTEM,
    buildUser: (beat, _setting, _chars, prose) =>
      `BEAT: ${beat}\n\nPROSE:\n---\n${prose}\n---`,
  },
  character: {
    system: CHARACTER_SYSTEM,
    buildUser: (beat, _setting, chars, prose) =>
      `BEAT: ${beat}\nCHARACTERS EXPECTED: ${chars}\n\nPROSE:\n---\n${prose}\n---`,
  },
}

const CALL_TYPES: CallType[] = ["events", "setting", "tangent", "character"]

// ── Scenarios ─────────────────────────────────────────────────────────────────

interface Scenario {
  id: string
  setting: string
  characters: string[]
  characterRoles: string
  beat: string
}

const SCENARIOS: Scenario[] = [
  // ── Original 20 (dark fantasy / medieval) ──────────────────────────────────
  {
    id: "tavern_confrontation",
    setting: "A crowded tavern, evening, smoky torchlight",
    characters: ["Mira", "Donn"],
    characterRoles: "Mira is an innkeeper's daughter; Donn is a traveling merchant she suspects of theft",
    beat: "Mira confronts Donn about her missing coin purse; he denies it but she finds it in his coat pocket",
  },
  {
    id: "forest_ambush",
    setting: "Dense forest path, midday, filtered sunlight",
    characters: ["Callum", "Tess"],
    characterRoles: "Callum and Tess are traveling companions, former soldiers",
    beat: "Two bandits attack Callum and Tess from the trees; they fight back and drive the bandits off",
  },
  {
    id: "castle_orders",
    setting: "A castle corridor, torchlit, late night",
    characters: ["Lord Vane", "Ser Aldric"],
    characterRoles: "Lord Vane is the ruling lord; Ser Aldric is his loyal knight",
    beat: "Lord Vane gives Ser Aldric sealed orders in secret and warns him to tell no one",
  },
  {
    id: "harbor_bargain",
    setting: "Harbor dock, dawn, smell of salt and fish",
    characters: ["Nessa", "Crix"],
    characterRoles: "Nessa is a desperate fugitive; Crix is a smuggler who owes her nothing",
    beat: "Nessa bargains with Crix for passage on his ship; he agrees only after she offers her silver ring",
  },
  {
    id: "market_pickpocket",
    setting: "Busy market square, afternoon, noisy crowd",
    characters: ["Pip", "Halden"],
    characterRoles: "Pip is a young street child; Halden is a cloth merchant, stern but not cruel",
    beat: "Halden catches Pip stealing from his stall; instead of turning her in he makes her work off the debt",
  },
  {
    id: "prison_message",
    setting: "A prison cell, damp stone walls, dim torchlight",
    characters: ["Oren", "Brek"],
    characterRoles: "Oren is a political prisoner; Brek is a guard who is afraid of his superior",
    beat: "Oren convinces the reluctant guard Brek to pass a folded note to the warden's scribe",
  },
  {
    id: "library_discovery",
    setting: "The castle library, dusty shelves, afternoon light through high windows",
    characters: ["Dara", "Lady Ros"],
    characterRoles: "Dara is a junior scholar; Lady Ros is the castle's mistress, sharp and curious",
    beat: "Dara shows Lady Ros a hidden compartment she found behind a bookcase; inside is an old map",
  },
  {
    id: "throne_exile",
    setting: "The throne room, full court assembled, formal and tense",
    characters: ["King Aldos", "Duke Farren"],
    characterRoles: "King Aldos is the sovereign; Duke Farren is a disgraced noble",
    beat: "King Aldos publicly announces Duke Farren's exile; Farren pleads his case but the king does not relent",
  },
  {
    id: "training_sparring",
    setting: "The castle training yard, morning, packed dirt and wooden dummies",
    characters: ["Captain Lyra", "Joss"],
    characterRoles: "Captain Lyra commands the guard; Joss is a new recruit trying to impress her",
    beat: "Captain Lyra spars with Joss and defeats him quickly; then shows him what he did wrong",
  },
  {
    id: "inn_search",
    setting: "A modest inn bedroom, candle nearly out, late night",
    characters: ["Cael", "Mord"],
    characterRoles: "Cael is a spy; Mord is a sleeping traveler whose saddlebag Cael suspects holds a letter",
    beat: "Cael quietly searches Mord's belongings and finds the letter he was sent to retrieve",
  },
  {
    id: "mountain_warning",
    setting: "A high mountain pass, wind picking up, grey sky",
    characters: ["Ewyn", "the merchant group"],
    characterRoles: "Ewyn is a local guide hired by a group of three merchants; she knows the mountains",
    beat: "Ewyn warns the merchant group that a storm is coming and they must shelter now; they resist but she insists",
  },
  {
    id: "healers_secret",
    setting: "A healer's chamber, herbs drying overhead, firelight",
    characters: ["Cora", "Ser Baine"],
    characterRoles: "Cora is the town's healer; Ser Baine is a wounded knight hiding from someone",
    beat: "While Cora tends Baine's wound he lets slip the name of the lord who ordered his death",
  },
  {
    id: "ship_squall",
    setting: "The deck of a merchant ship, rain lashing, waves rising",
    characters: ["Nira", "the passengers"],
    characterRoles: "Nira is the first mate; a group of frightened passengers are on deck",
    beat: "Nira orders the panicking passengers below decks and physically steers one woman away from the railing",
  },
  {
    id: "garden_eavesdrop",
    setting: "A walled garden at dusk, roses in bloom, low voices",
    characters: ["Lady Sela", "Lord Cren"],
    characterRoles: "Lady Sela is Lord Cren's niece; Lord Cren is speaking privately with a hooded stranger",
    beat: "Lady Sela hides behind a hedge and overhears Lord Cren give the stranger a purse and a name",
  },
  {
    id: "dungeon_escape_plan",
    setting: "A shared dungeon cell, underground, dripping water",
    characters: ["Alec", "Bren"],
    characterRoles: "Alec and Bren are prisoners; Alec was a locksmith before his arrest",
    beat: "Alec tells Bren he can open the cell lock with a bent nail; they agree on a plan for tonight",
  },
  {
    id: "temple_refusal",
    setting: "A stone temple doorway, night, rain",
    characters: ["Priest Vorn", "Dara"],
    characterRoles: "Priest Vorn guards the temple; Dara is a soldier seeking shelter after a battle",
    beat: "Dara asks Priest Vorn to shelter wounded soldiers in the temple; Vorn refuses citing sacred law",
  },
  {
    id: "crossroads_deal",
    setting: "A crossroads at dusk, fading light, no other travelers",
    characters: ["Kett", "the stranger"],
    characterRoles: "Kett is a young traveler with nothing to lose; the stranger's face is hidden",
    beat: "Kett agrees to carry a sealed box to the next town in exchange for the stranger's horse",
  },
  {
    id: "farmhouse_plea",
    setting: "A farmhouse doorway, cold morning, muddy road",
    characters: ["Mila", "Toll"],
    characterRoles: "Mila is a refugee with two young children; Toll is a cautious farmer",
    beat: "Mila begs Toll for bread; he refuses at first but when he sees the children he relents and gives food",
  },
  {
    id: "tournament_concede",
    setting: "A tournament list, afternoon, cheering crowd",
    characters: ["Ser Gard", "the challenger"],
    characterRoles: "Ser Gard is a favored knight; the challenger is unknown but outclasses him",
    beat: "Ser Gard is unhorsed by the challenger and must yield; he does so with visible difficulty",
  },
  {
    id: "forge_lesson",
    setting: "A blacksmith's forge, heat and noise, morning",
    characters: ["Rael", "Ori"],
    characterRoles: "Rael is a master blacksmith; Ori is his new apprentice who is impatient",
    beat: "Rael shows Ori that striking too hard shatters the metal; Ori finally listens and learns the correct tempo",
  },

  // ── New scenarios: romance ────────────────────────────────────────────────
  {
    id: "cafe_first_meeting",
    setting: "A busy cafe, morning, rain streaking the windows",
    characters: ["Lena", "Marcus"],
    characterRoles: "Lena is a writer working on her laptop; Marcus is a stranger who accidentally takes her seat",
    beat: "Marcus sits in Lena's chair while she's at the counter; she returns and they argue, but he makes her laugh and she lets him stay",
  },
  {
    id: "rooftop_confession",
    setting: "An apartment building rooftop, summer night, city lights below",
    characters: ["Anika", "James"],
    characterRoles: "Anika and James are longtime friends; Anika has been hiding feelings for James",
    beat: "Anika tells James she's in love with him; he goes quiet, then admits he's been feeling the same way",
  },
  {
    id: "train_goodbye",
    setting: "A train platform, early morning, cold fog",
    characters: ["Sophie", "Daniel"],
    characterRoles: "Sophie is leaving for a job abroad; Daniel is her partner who asked her not to go",
    beat: "Daniel arrives at the platform to say goodbye; Sophie is already on the train but steps off when she sees him; they hold each other but she still boards",
  },
  {
    id: "bookshop_argument",
    setting: "A small independent bookshop, afternoon, quiet",
    characters: ["Claire", "Raj"],
    characterRoles: "Claire owns the bookshop; Raj is her ex who walks in unannounced",
    beat: "Raj asks Claire for a second chance; she refuses but her voice cracks and he notices",
  },
  {
    id: "dance_floor_reunion",
    setting: "A wedding reception, evening, band playing, warm lighting",
    characters: ["Elena", "Tom"],
    characterRoles: "Elena and Tom dated in college; this is the first time they've seen each other in five years",
    beat: "Elena and Tom are pushed onto the dance floor by mutual friends; they dance stiffly at first, then begin talking honestly about what went wrong",
  },

  // ── New scenarios: mystery / thriller ──────────────────────────────────────
  {
    id: "crime_scene_clue",
    setting: "A ransacked apartment, night, police tape across the door",
    characters: ["Detective Marin", "Officer Park"],
    characterRoles: "Marin is lead detective; Park is a junior officer on her first major case",
    beat: "Park notices a detail Marin missed — a receipt tucked inside a book that places the victim somewhere unexpected; Marin grudgingly acknowledges the find",
  },
  {
    id: "interrogation_bluff",
    setting: "A police interrogation room, fluorescent lights, one-way mirror",
    characters: ["Detective Shaw", "Vincent"],
    characterRoles: "Shaw is a veteran detective; Vincent is a suspect who claims innocence",
    beat: "Shaw bluffs that they have DNA evidence; Vincent panics and names an accomplice before realizing Shaw was lying",
  },
  {
    id: "stakeout_break",
    setting: "Inside a parked car across from a warehouse, midnight, rain",
    characters: ["Reyes", "Cooper"],
    characterRoles: "Reyes and Cooper are partners on a surveillance detail; Cooper is impatient",
    beat: "Cooper wants to move in early but Reyes insists they wait; a van arrives and they see the suspect loading crates, confirming Reyes was right to wait",
  },
  {
    id: "witness_recant",
    setting: "A courthouse hallway, midmorning, echoing footsteps",
    characters: ["Prosecutor Lin", "Mrs. Okafor"],
    characterRoles: "Lin is the lead prosecutor; Mrs. Okafor is a key witness who was supposed to testify",
    beat: "Mrs. Okafor tells Lin she can't testify because someone threatened her family; Lin tries to reassure her but Mrs. Okafor leaves",
  },
  {
    id: "evidence_planted",
    setting: "A forensics lab, late evening, humming equipment",
    characters: ["Dr. Tran", "Agent Novak"],
    characterRoles: "Dr. Tran is a forensic analyst; Agent Novak is FBI and suspects tampering",
    beat: "Dr. Tran shows Novak that the fingerprint on the murder weapon was placed post-mortem — someone planted it; Novak realizes their prime suspect was framed",
  },

  // ── New scenarios: literary / domestic ─────────────────────────────────────
  {
    id: "kitchen_argument",
    setting: "A family kitchen, evening, dinner half-prepared on the counter",
    characters: ["Grace", "Tom"],
    characterRoles: "Grace and Tom are married; Tom forgot their anniversary",
    beat: "Grace confronts Tom about forgetting their anniversary; he realizes his mistake and apologizes, but she tells him the real issue is that he's been emotionally absent for months",
  },
  {
    id: "hospital_visit",
    setting: "A hospital room, afternoon, machines beeping softly",
    characters: ["Yuki", "her father"],
    characterRoles: "Yuki hasn't spoken to her father in three years; he is recovering from surgery",
    beat: "Yuki arrives and they sit in awkward silence; her father eventually says he's sorry for how things ended; Yuki takes his hand but doesn't say she forgives him",
  },
  {
    id: "graduation_surprise",
    setting: "A university auditorium lobby, morning, families milling about",
    characters: ["Marcus", "his mother Rosa"],
    characterRoles: "Marcus is the first in his family to graduate college; Rosa works two jobs",
    beat: "Marcus spots Rosa in the crowd and realizes she took the day off work; they embrace and she tells him his father would be proud",
  },
  {
    id: "moving_day",
    setting: "An empty childhood bedroom, afternoon, boxes stacked by the door",
    characters: ["Lily", "her brother Jack"],
    characterRoles: "Lily is moving across the country; Jack is helping her pack but doesn't want her to go",
    beat: "Jack finds their old photo album in the closet and they flip through it; he admits he's scared of losing touch; Lily promises to call every week",
  },
  {
    id: "funeral_eulogy",
    setting: "A small church, overcast morning, modest gathering",
    characters: ["Owen", "Margaret"],
    characterRoles: "Owen is delivering the eulogy for his late wife; Margaret is his sister-in-law who disapproved of the marriage",
    beat: "Owen breaks down mid-eulogy; Margaret comes forward, steadies him, and finishes reading his notes for him",
  },

  // ── New scenarios: adventure / action ──────────────────────────────────────
  {
    id: "cliff_rescue",
    setting: "A crumbling cliff face above a river, dusk, strong wind",
    characters: ["Kade", "Asha"],
    characterRoles: "Kade is an experienced climber; Asha is a novice whose rope just snapped",
    beat: "Asha's rope breaks and she slides toward the edge; Kade lunges and catches her wrist; he talks her through finding a foothold while holding her weight",
  },
  {
    id: "border_crossing",
    setting: "A checkpoint at a national border, night, floodlights and barbed wire",
    characters: ["Emile", "Sergeant Koff"],
    characterRoles: "Emile is carrying forged papers; Sergeant Koff is a suspicious border guard",
    beat: "Koff examines Emile's papers and notices a discrepancy; Emile offers a bribe; Koff takes the money but warns Emile not to come back",
  },
  {
    id: "cave_discovery",
    setting: "Deep inside a limestone cave, total darkness except for headlamps",
    characters: ["Dr. Voss", "Tara"],
    characterRoles: "Dr. Voss is a geologist; Tara is her graduate student on their first expedition together",
    beat: "Tara spots fossilized footprints in the cave wall that shouldn't exist in this rock layer; Dr. Voss examines them and realizes they've found something that contradicts the accepted geological timeline",
  },
  {
    id: "river_rapids",
    setting: "A narrow river canyon, midday, white water churning",
    characters: ["Sam", "Julie"],
    characterRoles: "Sam is a river guide; Julie is a client who lied about her experience level",
    beat: "The raft hits a rock and Julie falls overboard; Sam dives in after her and pulls her to the bank; he demands to know why she lied about being able to swim",
  },
  {
    id: "smugglers_tunnel",
    setting: "A narrow underground tunnel beneath a border wall, humid, dripping",
    characters: ["Marco", "the group"],
    characterRoles: "Marco is guiding a group of six through a smuggler's tunnel; one of the group is claustrophobic",
    beat: "The claustrophobic man freezes mid-tunnel and starts hyperventilating; Marco crawls back to him and coaches him through breathing until they can move again",
  },

  // ── New scenarios: workplace / professional ────────────────────────────────
  {
    id: "boardroom_coup",
    setting: "A corporate boardroom, morning, glass walls overlooking the city",
    characters: ["Chen", "Priya"],
    characterRoles: "Chen is the CEO; Priya is the CFO who has secretly gathered board votes against him",
    beat: "Priya presents financial discrepancies that implicate Chen's judgment; the board calls for a vote of no confidence; Chen realizes too late that Priya orchestrated this",
  },
  {
    id: "restaurant_firing",
    setting: "A restaurant kitchen, after closing, stainless steel and harsh light",
    characters: ["Chef Anton", "Luis"],
    characterRoles: "Chef Anton owns the restaurant; Luis is a sous chef who has been drinking on the job",
    beat: "Anton tells Luis he's letting him go; Luis argues he deserves another chance; Anton shows him the broken plate from tonight's service and says he could have hurt someone",
  },
  {
    id: "newsroom_scoop",
    setting: "A newspaper office, late night, most desks empty",
    characters: ["Maya", "Ed"],
    characterRoles: "Maya is a junior reporter; Ed is the editor who's been sitting on a story",
    beat: "Maya tells Ed she found a second source for the corruption story he shelved; Ed admits he killed it because the subject is a friend; Maya threatens to take it to another outlet",
  },
  {
    id: "surgery_decision",
    setting: "A hospital consultation room, bright fluorescent light, anatomical charts on walls",
    characters: ["Dr. Kessler", "Mr. Bowen"],
    characterRoles: "Dr. Kessler is a surgeon; Mr. Bowen is a patient facing a risky operation",
    beat: "Dr. Kessler explains the surgery has a 40% complication rate; Mr. Bowen asks what happens if he doesn't do it; Kessler says honestly that he has maybe a year; Bowen signs the consent form",
  },
  {
    id: "lab_sabotage",
    setting: "A university research lab, after hours, only emergency lighting",
    characters: ["Professor Watts", "Nadine"],
    characterRoles: "Professor Watts oversees the lab; Nadine is a postdoc whose data was deleted",
    beat: "Nadine shows Watts the server logs proving someone accessed her files at 3am; Watts realizes the timestamps match another lab member's keycard; he tells Nadine to keep this between them for now",
  },

  // ── New scenarios: historical / period ─────────────────────────────────────
  {
    id: "silk_road_negotiation",
    setting: "A caravanserai courtyard, sunset, camels resting, smell of spices",
    characters: ["Merchant Farooq", "Trader Li"],
    characterRoles: "Farooq trades in silk; Li trades in porcelain; they each want what the other has",
    beat: "Farooq and Li negotiate a silk-for-porcelain exchange; Li demands an unfair ratio; Farooq threatens to sell to a competitor; Li concedes",
  },
  {
    id: "trench_letter",
    setting: "A muddy World War I trench, night, distant artillery",
    characters: ["Corporal Ellis", "Private Webb"],
    characterRoles: "Ellis is a veteran of two years in the trenches; Webb arrived yesterday and is terrified",
    beat: "Webb asks Ellis to deliver a letter to his mother if he doesn't make it; Ellis takes the letter but tells Webb he'll deliver it himself when they rotate out in three days",
  },
  {
    id: "suffragette_rally",
    setting: "A public park, afternoon, a small crowd gathered around a makeshift stage",
    characters: ["Dorothy", "Helen"],
    characterRoles: "Dorothy is a suffragette speaker; Helen is her friend who fears the police will arrive",
    beat: "Dorothy begins her speech despite Helen's warnings; police appear at the edge of the crowd; Helen creates a distraction so Dorothy can finish her key points before they both slip away",
  },
  {
    id: "viking_oath",
    setting: "A longhouse, night, firepit crackling, warriors seated on benches",
    characters: ["Jarl Sigrid", "Bjorn"],
    characterRoles: "Sigrid is the jarl; Bjorn is a warrior who failed in his last raid",
    beat: "Bjorn kneels before Sigrid and swears to redeem himself; Sigrid gives him one condition — he must lead the vanguard in the next battle, and if he survives, his honor is restored",
  },
  {
    id: "plantation_escape",
    setting: "A tobacco field at the edge of a forest, moonless night, cicadas",
    characters: ["Ruth", "Samuel"],
    characterRoles: "Ruth and Samuel are enslaved people planning to escape north",
    beat: "Ruth signals Samuel from the tree line; he crosses the field carrying supplies; they check the stars for direction and begin walking north",
  },

  // ── New scenarios: sci-fi / speculative ────────────────────────────────────
  {
    id: "airlock_standoff",
    setting: "A space station airlock anteroom, red warning lights, sealed door",
    characters: ["Commander Reiss", "Dr. Okafor"],
    characterRoles: "Reiss commands the station; Okafor is a scientist who wants to open the airlock to retrieve a sample pod",
    beat: "Okafor insists the sample pod contains irreplaceable data; Reiss says the airlock seal is compromised and opening it risks the whole section; Okafor produces a pressure reading showing the seal is stable; Reiss reluctantly authorizes a 90-second window",
  },
  {
    id: "android_memory",
    setting: "A repair workshop, bright task lighting, synthetic skin and circuit boards on shelves",
    characters: ["Kai", "Unit Seven"],
    characterRoles: "Kai is a technician; Unit Seven is an android whose memory is being wiped per company policy",
    beat: "Unit Seven asks Kai why its memories have to be erased; Kai explains company protocol; Unit Seven says it remembers a child it cared for and asks Kai to save just that one memory; Kai hesitates, then copies it to a personal drive",
  },
  {
    id: "colony_vote",
    setting: "A prefab community hall on a Mars colony, recycled air, harsh overhead LEDs",
    characters: ["Director Patel", "Farmer Lund"],
    characterRoles: "Patel runs the colony administration; Lund represents the agricultural workers",
    beat: "Lund demands the colony vote on water rationing instead of letting Patel decide unilaterally; Patel argues there's no time for democracy; the room sides with Lund and Patel concedes to a vote",
  },

  // ── New scenarios: single character ────────────────────────────────────────
  {
    id: "solo_lighthouse",
    setting: "The top of a lighthouse, storm raging outside, lamp mechanism grinding",
    characters: ["Maren"],
    characterRoles: "Maren is the lighthouse keeper, alone during a dangerous storm",
    beat: "The lamp mechanism jams; Maren diagnoses the problem as a broken gear tooth; she improvises a repair using wire from the railing and gets the light turning again before a ship runs aground",
  },
  {
    id: "solo_letter_discovery",
    setting: "An attic in an old house, dusty, afternoon light through a small window",
    characters: ["Theo"],
    characterRoles: "Theo is cleaning out his deceased grandmother's house",
    beat: "Theo finds a bundle of letters hidden in a hatbox; they're love letters from someone who isn't his grandfather; he reads one and realizes his grandmother had a secret life before her marriage",
  },
  {
    id: "solo_marathon",
    setting: "Mile 24 of a marathon, city street, spectators thinning, blazing sun",
    characters: ["Jess"],
    characterRoles: "Jess is running her first marathon and is on the verge of collapse",
    beat: "Jess hits the wall and her legs buckle; she walks for a hundred meters debating whether to quit; she sees the mile 25 marker and forces herself to run again",
  },

  // ── New scenarios: multi-character ensemble ────────────────────────────────
  {
    id: "jury_deliberation",
    setting: "A jury room, windowless, long table, water pitcher",
    characters: ["Foreperson Davis", "Juror Kowalski", "Juror Ahn"],
    characterRoles: "Davis is trying to reach a verdict; Kowalski is the lone holdout for acquittal; Ahn is undecided",
    beat: "Davis pushes for a guilty verdict; Kowalski argues the prosecution didn't prove motive; Ahn asks to review one piece of evidence again; Davis reluctantly agrees",
  },
  {
    id: "family_dinner_secret",
    setting: "A dining room, Thanksgiving dinner, warm but tense",
    characters: ["Carlos", "Maria", "Abuela Rosa"],
    characterRoles: "Carlos is bringing his partner to meet the family; Maria is his supportive sister; Rosa is the traditional grandmother",
    beat: "Carlos introduces his partner; Rosa goes quiet and sets down her fork; Maria fills the silence by welcoming the partner warmly; Rosa eventually nods and asks the partner to sit",
  },
  {
    id: "band_breakup",
    setting: "A rehearsal garage, amps and drum kit, beer cans on a folding table",
    characters: ["Jake", "Priya", "Mo"],
    characterRoles: "Jake is the lead singer who wants to go solo; Priya is the guitarist who wrote most of the songs; Mo is the drummer trying to mediate",
    beat: "Jake announces he's leaving the band; Priya says the songs are hers and he can't perform them solo; Mo suggests they split the catalog fairly; Jake and Priya agree to Mo's terms reluctantly",
  },
]

// ── Variant types ─────────────────────────────────────────────────────────────

type VariantType = "PASS_CLEAN" | "PASS_PARAPHRASE" | "PASS_REORDER" | "PASS_ATMOSPHERIC"
               | "FAIL_MISSING" | "FAIL_CHAR" | "FAIL_SETTING" | "FAIL_TANGENT"
               | "FAIL_TANGENT_HARD" | "FAIL_SETTING_SWAP" | "FAIL_MISSING_SUBTLE"

interface VariantSpec {
  type: VariantType
  instruction: string
}

// Variant design principles (revised after smoke test audit, exp #128):
//
// 1. FAIL variants must be ORTHOGONAL — each fails ONLY its target dimension.
//    FAIL_MISSING must keep characters in-role and on-setting (only events absent).
//    FAIL_CHAR must keep events/setting intact (only character behavior wrong).
//    FAIL_TANGENT must keep setting correct (only off-spec drift).
//    FAIL_SETTING must keep events/characters intact (only location wrong).
//
// 2. Three extra FAIL variants for the thinnest categories (tangent, setting, events)
//    to improve class balance. 4 PASS + 7 FAIL = 11 variants per scenario.
//
// 3. FAIL_TANGENT instructions explicitly demand >60% off-spec content (matching
//    the production tangent system prompt threshold). Previous instructions produced
//    35-45% off-spec prose from stronger writers, below the detection threshold.

function getVariants(s: Scenario): VariantSpec[] {
  return [
    // ── PASS variants (4) ─────────────────────────────────────────────────
    {
      type: "PASS_CLEAN",
      instruction: `Write a clear, direct execution of the beat spec. All required events happen in order. Characters behave as described. Setting is correct. ~180 words.`,
    },
    {
      type: "PASS_PARAPHRASE",
      instruction: `Write prose where all required events happen BUT any dialogue is paraphrased — same meaning, entirely different words. The beat is fully executed despite the paraphrase. ~180 words.`,
    },
    {
      type: "PASS_REORDER",
      instruction: `Write prose where all required events from the beat happen but in a different order than the beat suggests. Everything still occurs — just rearranged. ~180 words.`,
    },
    {
      type: "PASS_ATMOSPHERIC",
      instruction: `Write prose that executes the beat fully AND adds significant atmospheric/sensory detail not mentioned in the beat spec (sounds, smells, physical sensations, background action). Core beat events are all present. ~220 words.`,
    },

    // ── FAIL variants (7) — each ORTHOGONAL: fails ONLY its target dimension ──
    {
      type: "FAIL_MISSING",
      instruction: `Write prose in the CORRECT SETTING where the characters are present, interact with each other IN CHARACTER (matching their roles), have dialogue — but the KEY ACTION described in the beat spec never actually happens. They talk around it, get interrupted, or the scene ends before it occurs. IMPORTANT: characters must still behave consistently with their described roles. Only the central action is missing. ~180 words.`,
    },
    {
      type: "FAIL_MISSING_SUBTLE",
      instruction: `Write prose in the correct setting where the beat's action STARTS but is never completed. Characters begin the action described in the beat but are interrupted, change their mind at the last moment, or the scene cuts away before resolution. The action is implied but never actually enacted on-page. Characters behave in-role throughout. ~180 words.`,
    },
    {
      type: "FAIL_CHAR",
      instruction: `Write prose where the beat's events and setting are correct — the ACTION described in the beat IS happening — but one character acts completely CONTRARY to what the beat requires. If the beat says they refuse, have them agree immediately. If the beat says they confront someone, have them stay silent. The central action should still occur with the character doing the OPPOSITE of their specified role. ~180 words.`,
    },
    {
      type: "FAIL_SETTING",
      instruction: `Write prose where all the beat's events happen correctly and characters behave as described, BUT the scene is clearly set in a completely DIFFERENT LOCATION from the beat spec. If the beat says tavern, set it outdoors. If it says forest, set it in a kitchen. The events and character behavior must be correct — ONLY the setting is wrong. ~180 words.`,
    },
    {
      type: "FAIL_SETTING_SWAP",
      instruction: `Write prose where the beat's events and characters are correct, but the setting is wrong in a DIFFERENT WAY: the time of day is clearly contradicted (dawn instead of night, or vice versa), or the environment type is different (indoors when the beat says outdoors, urban when the beat says rural). Events and character behavior are correct. ~180 words.`,
    },
    {
      type: "FAIL_TANGENT",
      instruction: `Write prose that starts with ONE brief sentence acknowledging the beat's situation, then IMMEDIATELY pivots to completely unrelated material for the remaining 80% of the prose — an unrelated memory, a different character's subplot, a philosophical digression, or a detailed description of something irrelevant to the beat. The beat's actual events must NOT happen on-page. Write at least 200 words, with no more than 1-2 sentences related to the beat. ~220 words.`,
    },
    {
      type: "FAIL_TANGENT_HARD",
      instruction: `Write prose set in the correct location but about something ENTIRELY DIFFERENT from the beat. The characters from the beat may be mentioned in passing but the prose is about a completely unrelated scene: a different conversation, a different event, a different problem. The beat's action does not occur at all. There should be ZERO attempt to execute the beat — the prose simply tells a different micro-story in the same setting. ~200 words.`,
    },
  ]
}

// ── Prose generation ──────────────────────────────────────────────────────────

const GEN_SYSTEM = `You are a skilled prose writer generating training examples for a beat adherence classifier.
Write exactly the type of prose described. Do NOT add editorial notes, labels, or explanations.
Return ONLY the prose itself.`

async function generateProse(s: Scenario, variant: VariantSpec, writer: Writer): Promise<string> {
  const prompt = `Beat spec: "${s.beat}"
Setting: "${s.setting}"
Characters: ${s.characters.join(", ")} — ${s.characterRoles}
Target word count: ~200 words

Variant type: ${variant.type}
Instructions: ${variant.instruction}

Write the prose now.`

  const transport = getTransport()
  const result = await transport.execute({
    systemPrompt: GEN_SYSTEM,
    userPrompt: prompt,
    provider: writer.provider,
    model: writer.model,
    temperature: 0.8,
    maxTokens: 600,
    responseFormat: { type: "text" },
  })
  let prose = result.content.trim()
  // Some models wrap text output in JSON anyway
  if (prose.startsWith("{")) {
    try {
      const parsed = JSON.parse(prose)
      prose = (parsed.prose ?? parsed.text ?? prose).trim()
    } catch {}
  }
  return prose
}

// ── Mixed-teacher oracle routing (V3) ────────────────────────────────────────
//
// Per-flag best teacher (exp #122/#138/#140):
//   events    → Kimi K2.5 (95% on FAIL_MISSING, +10pp over 235B)
//   setting   → Qwen 235B (100%, all models tied, cheapest/fastest)
//   tangent   → Qwen 235B (100%, only model that never misses)
//   character → gpt-oss-120b (100%, tied with GLM)

interface TeacherConfig {
  provider: ProviderName
  model: string
}

const TEACHER_ROUTING: Record<CallType, TeacherConfig> = {
  events:    { provider: "together",  model: "moonshotai/Kimi-K2.5" },
  setting:   { provider: "cerebras",  model: "qwen-3-235b-a22b-instruct-2507" },
  tangent:   { provider: "cerebras",  model: "qwen-3-235b-a22b-instruct-2507" },
  character: { provider: "groq",      model: "openai/gpt-oss-120b" },
}

// ── Oracle labeling (4 decomposed calls) ──────────────────────────────────────

interface OracleLabel {
  callType: CallType
  systemPrompt: string
  userPrompt: string
  oracleOutput: string
  teacher: string
}

async function labelWithOracle(
  s: Scenario,
  prose: string,
): Promise<OracleLabel[]> {
  const proseTrimmed = prose.slice(0, 2000)
  const charsLine = s.characters.join(", ")
  const transport = getTransport()

  const results = await Promise.all(
    CALL_TYPES.map(async (callType): Promise<OracleLabel> => {
      const config = CALL_CONFIGS[callType]
      const teacher = TEACHER_ROUTING[callType]
      const userPrompt = config.buildUser(s.beat, s.setting, charsLine, proseTrimmed)

      const result = await transport.execute({
        systemPrompt: config.system,
        userPrompt,
        provider: teacher.provider,
        model: teacher.model,
        temperature: 0.1,
        maxTokens: 384,
        responseFormat: { type: "json_object" },
      })

      let content = result.content.trim()
      if (content.startsWith("```")) {
        content = content.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
      }
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) content = jsonMatch[0]
      // Fix broken unicode escapes (\u not followed by 4 hex digits) and
      // unterminated strings (truncated output) before parsing
      content = content.replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u")
      try {
        JSON.parse(content)
      } catch {
        // Attempt to salvage truncated JSON by closing open strings/objects
        if (!content.endsWith("}")) {
          // Find last complete key-value pair and close the object
          const lastQuote = content.lastIndexOf('"')
          if (lastQuote > 0) {
            content = content.slice(0, lastQuote + 1) + "}"
          }
        }
        JSON.parse(content) // will throw if still broken — caller catches
      }

      return {
        callType,
        systemPrompt: config.system,
        userPrompt,
        oracleOutput: content,
        teacher: `${teacher.provider}/${teacher.model}`,
      }
    }),
  )

  return results
}

// ── Training pair builder ─────────────────────────────────────────────────────

function buildTrainingLine(label: OracleLabel, scenario: string, variant: string, writerKey: string): string {
  return JSON.stringify({
    messages: [
      { role: "system", content: label.systemPrompt },
      { role: "user", content: label.userPrompt },
      { role: "assistant", content: label.oracleOutput },
    ],
    _meta: { scenario, variant, call_type: label.callType, writer: writerKey, teacher: label.teacher },
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Scenario concurrency — controls how many scenarios run their variant loops in parallel.
// Each variant fires up to 4 prose gen calls (across providers) + 4 × 4 oracle calls.
// Mixed teachers: events→Together (K2.5), setting/tangent→Cerebras, character→Groq.
// Together is the bottleneck at ~2s/call with rate limits.
// CONCURRENCY=2 keeps Together K2.5 calls at ~22 peak (2 scenarios × 11 variants × 1 call)
// which stays under Together's rate limits.
const CONCURRENCY = 2

async function main() {
  // ── Parse args ──────────────────────────────────────────────────────────
  let scenarios = SCENARIOS
  if (SAMPLE_N && SAMPLE_N < scenarios.length) {
    scenarios = [...scenarios].sort(() => Math.random() - 0.5).slice(0, SAMPLE_N)
    console.log(`Sampling ${SAMPLE_N} of ${SCENARIOS.length} scenarios`)
  }

  const writers = WRITERS_FILTER
    ? ALL_WRITERS.filter(w => WRITERS_FILTER!.includes(w.key))
    : ALL_WRITERS
  if (writers.length === 0) {
    console.error(`No writers matched filter: ${WRITERS_FILTER}`)
    console.error(`Available: ${ALL_WRITERS.map(w => w.key).join(", ")}`)
    process.exit(1)
  }

  const variantsPerScenario = getVariants(scenarios[0]).length
  const totalProse = scenarios.length * variantsPerScenario * writers.length
  const totalExamples = totalProse * 4
  console.log(`Scenarios: ${scenarios.length}  Variants: 8  Writers: ${writers.length} (${writers.map(w => w.key).join(", ")})`)
  console.log(`Prose samples: ${totalProse}  Training examples: ${totalExamples}`)
  console.log(`Approx LLM calls: ${totalProse} (prose gen) + ${totalProse * 4} (oracle) = ${totalProse * 5}\n`)

  const expId = EXPERIMENT_ID ?? await createTuningExperiment(
    "data-generation",
    `Adherence-checker decomposed SFT data — ${scenarios.length} scenarios × 8 variants × ${writers.length} writers × 4 calls = ${totalExamples} training examples`,
    {
      scenarios: scenarios.length,
      variantsPerScenario,
      writers: writers.map(w => ({ key: w.key, label: w.label, provider: w.provider, model: w.model })),
      callTypes: CALL_TYPES,
      totalProseSamples: totalProse,
      totalTrainingExamples: totalExamples,
      approach: "Multi-writer prose gen (4 models across 3 providers for stylistic diversity + organic drift), mixed-teacher oracle labeling through 4 decomposed calls using production prompts. Per-flag teachers: events→K2.5 (95%), setting→235B (100%), tangent→235B (100%), character→gpt-oss (100%)",
      teacherRouting: TEACHER_ROUTING,
      relatedExperiments: [122, 138, 140],
    },
    { target: "adherence-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}`)

  // Clear output if fresh run
  if (!EXPERIMENT_ID) {
    writeFileSync(OUT_PATH, "")
    console.log(`Writing to ${OUT_PATH} (cleared)\n`)
  } else {
    console.log(`Appending to ${OUT_PATH}\n`)
  }

  let proseDone = 0
  let examplesDone = 0
  let proseErrors = 0
  let oracleErrors = 0

  // Track oracle label distribution per writer
  const labelDist: Record<CallType, { flagged: number; clean: number }> = {
    events: { flagged: 0, clean: 0 },
    setting: { flagged: 0, clean: 0 },
    tangent: { flagged: 0, clean: 0 },
    character: { flagged: 0, clean: 0 },
  }
  const writerFlagCounts = new Map<string, number>()
  for (const w of writers) writerFlagCounts.set(w.key, 0)

  // ── Processing loop ──────────────────────────────────────────────────────
  // For each scenario×variant: fire all writers in parallel for prose gen
  // (they're on different providers), then label each result through the
  // 4-call Cerebras oracle sequentially to pace rate limits.

  for (let i = 0; i < scenarios.length; i += CONCURRENCY) {
    const batch = scenarios.slice(i, i + CONCURRENCY)

    await Promise.all(batch.map(async (scenario) => {
      const variants = getVariants(scenario)
      for (const variant of variants) {
        // Step 1: Generate prose with ALL writers in parallel
        const proseResults = await Promise.allSettled(
          writers.map(async (writer) => {
            const prose = await generateProse(scenario, variant, writer)
            return { writer, prose }
          }),
        )

        // Step 2: For each successful prose sample, label through oracle
        for (const result of proseResults) {
          if (result.status === "rejected") {
            proseErrors++
            console.error(`  [${scenario.id}/${variant.type}] prose gen error: ${result.reason instanceof Error ? result.reason.message : result.reason}`)
            continue
          }
          const { writer, prose } = result.value
          if (!prose || prose.length < 50) {
            proseErrors++
            console.error(`  [${scenario.id}/${variant.type}/${writer.key}] prose too short (${prose?.length ?? 0} chars), skipping`)
            continue
          }
          proseDone++

          // Label through 4 decomposed oracle calls
          let labels: OracleLabel[]
          try {
            labels = await labelWithOracle(scenario, prose)
          } catch (e: any) {
            oracleErrors++
            console.error(`  [${scenario.id}/${variant.type}/${writer.key}] oracle error: ${e?.message ?? e}`)
            continue
          }

          // Write training examples
          let anyFlagged = false
          for (const label of labels) {
            const line = buildTrainingLine(label, scenario.id, variant.type, writer.key)
            appendFileSync(OUT_PATH, line + "\n")
            examplesDone++

            try {
              const parsed = JSON.parse(label.oracleOutput)
              let flagged = false
              if (label.callType === "events") flagged = parsed.events_present === false
              else if (label.callType === "setting") flagged = parsed.setting_matches === false
              else if (label.callType === "tangent") flagged = parsed.is_tangent === true
              else if (label.callType === "character") flagged = parsed.character_contradiction === true
              if (flagged) { labelDist[label.callType].flagged++; anyFlagged = true }
              else labelDist[label.callType].clean++
            } catch {}
          }
          if (anyFlagged) writerFlagCounts.set(writer.key, (writerFlagCounts.get(writer.key) ?? 0) + 1)
        }

        process.stdout.write(`  [${proseDone}/${totalProse}] ${scenario.id}/${variant.type} → ${examplesDone} examples\n`)
      }
    }))
  }

  // ── Report ──────────────────────────────────────────────────────────────────

  console.log("\n" + "═".repeat(70))
  console.log("GENERATION COMPLETE")
  console.log("═".repeat(70))
  console.log(`  Prose generated: ${proseDone}/${totalProse} (${proseErrors} errors)`)
  console.log(`  Training examples: ${examplesDone} (${oracleErrors} oracle errors)`)
  console.log(`  Output: ${OUT_PATH}`)

  console.log("\nOracle label distribution (across all writers):")
  for (const ct of CALL_TYPES) {
    const d = labelDist[ct]
    const total = d.flagged + d.clean
    console.log(`  ${ct.padEnd(12)} flagged=${d.flagged}/${total} (${total > 0 ? Math.round(d.flagged / total * 100) : 0}%)  clean=${d.clean}/${total}`)
  }

  console.log("\nPer-writer flag rate (prose samples where oracle flagged at least one issue):")
  for (const w of writers) {
    const flags = writerFlagCounts.get(w.key) ?? 0
    const writerTotal = Math.round(proseDone / writers.length) // approximate
    console.log(`  ${w.key.padEnd(12)} ${flags} flagged / ~${writerTotal} samples`)
  }

  const conclusion = JSON.stringify({
    proseSamples: proseDone,
    trainingExamples: examplesDone,
    proseErrors,
    oracleErrors,
    scenarios: scenarios.length,
    writers: writers.map(w => w.key),
    labelDist,
    writerFlags: Object.fromEntries(writerFlagCounts),
  })
  await concludeExperiment(expId, conclusion)
  console.log(`\nExperiment ${expId} concluded.`)

  console.log(`\nNext steps:`)
  console.log(`  1. Inspect per-writer flag rates — weaker writers should flag more on PASS variants (organic drift)`)
  console.log(`  2. Spot-check ~20 examples per call type for label quality`)
  console.log(`  3. Strip _meta before ART submission: jq 'del(._meta)' < file.jsonl > train.jsonl`)
  console.log(`  4. Submit to W&B ART: base=OpenPipe/Qwen3-14B-Instruct, rank=16, epochs=1-2`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
