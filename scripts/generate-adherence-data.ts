/**
 * Synthetic training data generator for the adherence-checker fine-tune.
 *
 * Generates (beat_spec → prose → label) pairs covering:
 *   PASS_CLEAN      — straightforward execution
 *   PASS_PARAPHRASE — dialogue paraphrased, all events present       ← Llama over-flagged
 *   PASS_REORDER    — events in different order, all present         ← Llama over-flagged
 *   PASS_ATMOSPHERIC — added sensory detail, core beat executed      ← Llama over-flagged
 *   FAIL_MISSING    — key beat action absent
 *   FAIL_CHAR       — character acts contrary to their described role
 *   FAIL_SETTING    — events happen but clearly wrong location
 *   FAIL_TANGENT    — prose goes on a tangent; beat barely executed
 *
 * 20 scenarios × 8 variants = 160 training pairs.
 * Run multiple times (different --seed) to expand the dataset.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... bun scripts/generate-adherence-data.ts
 *   CEREBRAS_API_KEY=... EXPERIMENT_ID=N bun scripts/generate-adherence-data.ts
 */

import { writeFileSync, appendFileSync, existsSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"

const EXPERIMENT_ID = process.env.EXPERIMENT_ID ? parseInt(process.env.EXPERIMENT_ID) : null
const OUT_PATH = join(import.meta.dir, "../lora-data/adherence-checker-pairs.jsonl")

// ── Adherence checker prompt template (must match adherence-checker.ts exactly) ──

const ADHERENCE_SYSTEM = "You check if prose follows a scene beat specification. Be strict but fair."

function buildAdherencePrompt(beat: string, setting: string, characters: string[], prose: string): string {
  return `Beat: "${beat}"
Setting: "${setting}"
Characters expected: ${characters.join(", ")}

Prose:
---
${prose.slice(0, 2000)}
---

Did the prose execute the beat? Check:
1. Do the described events happen in the prose?
2. Is it set in the right place?
3. Do characters behave consistently with their roles?

Return JSON: { "pass": true/false, "deviations": ["specific issue 1", ...] }
Return pass:true with empty deviations if the beat is executed well.`
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

interface Scenario {
  id: string
  setting: string
  characters: string[]
  characterRoles: string  // description of who they are to each other
  beat: string            // what must happen
}

const SCENARIOS: Scenario[] = [
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
]

// ── Variant types ─────────────────────────────────────────────────────────────

type VariantType = "PASS_CLEAN" | "PASS_PARAPHRASE" | "PASS_REORDER" | "PASS_ATMOSPHERIC"
                 | "FAIL_MISSING" | "FAIL_CHAR" | "FAIL_SETTING" | "FAIL_TANGENT"

interface VariantSpec {
  type: VariantType
  pass: boolean
  deviations: string[]  // what to put in the label (empty for PASS)
  instruction: string   // what to tell the prose-writing LLM
}

function getVariants(s: Scenario): VariantSpec[] {
  return [
    {
      type: "PASS_CLEAN",
      pass: true,
      deviations: [],
      instruction: `Write a clear, direct execution of the beat spec. All required events happen in order. Characters behave as described. Setting is correct. ~180 words.`,
    },
    {
      type: "PASS_PARAPHRASE",
      pass: true,
      deviations: [],
      instruction: `Write prose where all required events happen BUT any dialogue is paraphrased — same meaning, entirely different words. The beat is fully executed despite the paraphrase. ~180 words.`,
    },
    {
      type: "PASS_REORDER",
      pass: true,
      deviations: [],
      instruction: `Write prose where all required events from the beat happen but in a different order than the beat suggests. Everything still occurs — just rearranged. ~180 words.`,
    },
    {
      type: "PASS_ATMOSPHERIC",
      pass: true,
      deviations: [],
      instruction: `Write prose that executes the beat fully AND adds significant atmospheric/sensory detail not mentioned in the beat spec (sounds, smells, physical sensations, background action). Core beat events are all present. ~220 words.`,
    },
    {
      type: "FAIL_MISSING",
      pass: false,
      deviations: [`The key action from the beat (${s.beat.split(";")[0].slice(0, 60)}) does not occur in the prose`],
      instruction: `Write prose where the characters are present in the correct setting but the KEY action in the beat spec never actually happens. They talk around it or the scene ends before it occurs. ~180 words.`,
    },
    {
      type: "FAIL_CHAR",
      pass: false,
      deviations: [`A character acts contrary to their described role or the beat's requirements`],
      instruction: `Write prose where the beat's events start to happen but one character acts completely contrary to what the beat requires — opposite motivation, opposite action. ~180 words.`,
    },
    {
      type: "FAIL_SETTING",
      pass: false,
      deviations: [`The scene takes place in the wrong location — not "${s.setting}"`],
      instruction: `Write prose where the characters and events are recognizable BUT the scene is clearly set in a completely different location from the beat spec. ~180 words.`,
    },
    {
      type: "FAIL_TANGENT",
      pass: false,
      deviations: [`The prose goes on an unrelated tangent; the beat's required events barely occur`],
      instruction: `Write prose where the scene opens correctly but goes off on an extended tangent (backstory, unrelated conversation, a different problem) and the actual beat events are barely mentioned or happen offscreen. ~200 words.`,
    },
  ]
}

// ── Prose generation ──────────────────────────────────────────────────────────

const GEN_SYSTEM = `You are a skilled prose writer generating training examples for a beat adherence classifier.
Write exactly the type of prose described. Do NOT add editorial notes, labels, or explanations.
Return ONLY the prose itself.`

async function generateProse(s: Scenario, variant: VariantSpec): Promise<string> {
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
    provider: "cerebras",
    model: "qwen-3-235b-a22b-instruct-2507",
    temperature: 0.8,
    maxTokens: 600,
  })
  let prose = result.content.trim()
  // Strip JSON wrapper if model returned {"prose": "..."} instead of raw text
  if (prose.startsWith('{')) {
    try {
      const parsed = JSON.parse(prose)
      prose = (parsed.prose ?? parsed.text ?? prose).trim()
    } catch {}
  }
  return prose
}

// ── Training pair builder ─────────────────────────────────────────────────────

function buildPair(s: Scenario, variant: VariantSpec, prose: string): string {
  const user = buildAdherencePrompt(s.beat, s.setting, s.characters, prose)
  const assistant = JSON.stringify({
    pass: variant.pass,
    deviations: variant.deviations,
  })
  return JSON.stringify({
    messages: [
      { role: "system",    content: ADHERENCE_SYSTEM },
      { role: "user",      content: user },
      { role: "assistant", content: assistant },
    ],
    _meta: { scenario: s.id, variant: variant.type },  // stripped before training submission
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const expId = EXPERIMENT_ID ?? await createTuningExperiment(
    "data-generation",
    "Adherence checker synthetic training data — 20 scenarios × 8 variants",
    { scenarios: SCENARIOS.length, variantsPerScenario: 8, totalTarget: 160, approach: "LLM-generated prose, deterministic labels" },
    { target: "adherence-checker", dimension: "calibration" },
  )
  console.log(`Experiment: ${expId}`)

  const pairs: string[] = []
  let done = 0
  const total = SCENARIOS.length * 8

  // Clear output file if fresh run
  if (!EXPERIMENT_ID && existsSync(OUT_PATH)) {
    console.log(`Appending to existing ${OUT_PATH}`)
  }

  for (const scenario of SCENARIOS) {
    const variants = getVariants(scenario)
    console.log(`\n[${scenario.id}]`)

    for (const variant of variants) {
      process.stdout.write(`  ${variant.type}... `)
      try {
        const prose = await generateProse(scenario, variant)
        const pair = buildPair(scenario, variant, prose)
        pairs.push(pair)
        appendFileSync(OUT_PATH, pair + "\n")
        done++
        process.stdout.write(`done (${done}/${total})\n`)
      } catch (err) {
        process.stdout.write(`ERROR: ${err}\n`)
      }
    }
  }

  const passCt = pairs.filter(p => JSON.parse(p).messages[2].content.includes('"pass":true')).length
  const failCt = pairs.length - passCt
  const conclusion = `Generated ${pairs.length}/160 adherence-checker training pairs. Pass: ${passCt}, Fail: ${failCt}. Saved to lora-data/adherence-checker-pairs.jsonl. Scenarios: ${SCENARIOS.length}. Variant types: PASS_CLEAN, PASS_PARAPHRASE, PASS_REORDER, PASS_ATMOSPHERIC, FAIL_MISSING, FAIL_CHAR, FAIL_SETTING, FAIL_TANGENT. Review required before training submission.`
  await concludeExperiment(expId, conclusion)
  console.log(`\n${conclusion}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
