/**
 * Synthetic eval data generator for the reference-resolver ladder.
 *
 * Mirrors generate-adherence-data.ts (exp #110) in spirit but adapted to the
 * reference-resolver task shape:
 *
 *   - Input is a beat description + characters + setting + chapter
 *   - Output is a SET of lookups, each with a `type` from
 *     {recent_events, relationship, location_events, knowledge}
 *   - The "label" is the EXPECTED set of lookup TYPES (we don't try to
 *     ground-truth the args — character/topic choice is judgment-call territory)
 *
 * Variants (one beat per scenario per variant, 6 variants × 20 scenarios = 120):
 *
 *   VAR_NONE       — beat passes the IMPLICIT_MARKERS gate but is actually
 *                    self-contained. Expected lookup set: {} (empty).
 *                    Tests over-fetching. Counterpart of PASS_CLEAN in #110.
 *   VAR_REL        — beat references the dynamic between two characters.
 *                    Expected: {relationship}
 *   VAR_EVENTS     — beat references a specific prior event.
 *                    Expected: {recent_events}
 *   VAR_LOCATION   — beat references prior events at a specific place.
 *                    Expected: {location_events}
 *   VAR_KNOWLEDGE  — beat where a character recalls/uses learned information.
 *                    Expected: {knowledge}
 *   VAR_MULTI      — beat that genuinely requires two distinct lookup types.
 *                    Expected: 2-element set (typically relationship + recent_events)
 *
 * The IMPLICIT_MARKERS gate (src/agents/writer/reference-resolver.ts) is what
 * triggers the LLM call in production. Every generated beat MUST contain at
 * least one marker phrase, otherwise the beat would never reach the LLM in
 * production. The generation prompt enforces this.
 *
 * Reads:  nothing (scenarios hard-coded below)
 * Writes: lora-data/reference-resolver-pairs.jsonl
 *         tuning_experiment row with generation config + counts
 *
 * Usage:
 *   CEREBRAS_API_KEY=... bun scripts/generate-reference-resolver-data.ts
 *   CEREBRAS_API_KEY=... EXPERIMENT_ID=N bun scripts/generate-reference-resolver-data.ts
 */

import { writeFileSync, appendFileSync, existsSync, unlinkSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"

const EXPERIMENT_ID = process.env.EXPERIMENT_ID ? parseInt(process.env.EXPERIMENT_ID) : null
const OUT_PATH = join(import.meta.dir, "../lora-data/reference-resolver-pairs.jsonl")

// ── Reference-resolver prompt template (must match production exactly) ────
//
// Mirrors src/agents/writer/reference-resolver.ts. The system prompt is
// minimal; the user prompt enumerates the four lookup types and asks for
// JSON. Generated pairs are scored by score-reference-baseline.ts using the
// same template.

const REFERENCE_SYSTEM = "You identify what background information a scene beat needs. Return JSON with specific lookups."

function buildReferencePrompt(beat: string, characters: string[], setting: string, chapter: number): string {
  return `Beat: "${beat}"
Characters: ${characters.join(", ")}
Setting: ${setting}
Chapter: ${chapter}

What specific background does the writer need? Return JSON:
{ "lookups": [{ "type": "recent_events"|"relationship"|"location_events"|"knowledge", "characters": ["name"], "location": "place", "topic": "subject" }] }

Only include lookups for things implicitly referenced. Return empty lookups array if the beat is self-contained.`
}

// ── Scenarios ─────────────────────────────────────────────────────────────
//
// Each scenario is a setting + cast that supports all 6 variants. The variant
// instructions tell the prose generator HOW to phrase the beat for that
// scenario; the scenario provides the ground (characters, locale, prior
// fictional history) the beat sits on top of.

interface Scenario {
  id: string
  setting: string
  characters: string[]
  /** Brief world fragment giving generator enough context to phrase any variant. */
  context: string
  /** Chapter number to embed in the prompt — affects how the model treats "earlier". */
  chapter: number
}

const SCENARIOS: Scenario[] = [
  {
    id: "tavern_innkeeper",
    setting: "The Crossed Keys tavern, evening, low firelight",
    characters: ["Mira", "Donn"],
    context: "Mira runs the inn; Donn is a regular patron. They had a public argument three nights ago about a missing coin purse. Donn previously promised Mira he'd help repair the back room.",
    chapter: 4,
  },
  {
    id: "forest_companions",
    setting: "Riverbank trail, late afternoon, dappled light",
    characters: ["Callum", "Tess"],
    context: "Callum and Tess are former soldiers traveling together. Two chapters back they were ambushed at a ravine; Callum took an arrow in the thigh and Tess killed both attackers.",
    chapter: 5,
  },
  {
    id: "castle_knight",
    setting: "A torchlit corridor outside the lord's solar, late night",
    characters: ["Lord Vane", "Ser Aldric"],
    context: "Vane gave Aldric sealed orders the previous chapter and warned him to tell no one. Aldric also recently learned (from a steward) that Vane has been meeting with envoys from the rival house.",
    chapter: 6,
  },
  {
    id: "harbor_smuggler",
    setting: "The Tarsel docks at dawn, gulls calling, smell of pitch",
    characters: ["Nessa", "Crix"],
    context: "Nessa is a fugitive; Crix is a smuggler she paid for passage two chapters ago with her silver ring. The promised ship hasn't arrived. Nessa once saved Crix's brother from arrest.",
    chapter: 7,
  },
  {
    id: "market_thief",
    setting: "The east market square, midmorning, crowded stalls",
    characters: ["Pip", "Halden"],
    context: "Halden is a cloth merchant who caught Pip stealing last week and made her work off the debt. Pip has been good for it but resents the arrangement.",
    chapter: 3,
  },
  {
    id: "prison_message",
    setting: "Cell block C of the keep dungeon, damp stone, dim torchlight",
    characters: ["Oren", "Brek"],
    context: "Oren is a political prisoner. Two chapters back he convinced the guard Brek to pass a folded note to the warden's scribe. Brek's superior has since become more suspicious.",
    chapter: 8,
  },
  {
    id: "library_discovery",
    setting: "The castle library, dusty shelves, afternoon light through high windows",
    characters: ["Dara", "Lady Ros"],
    context: "Dara found a hidden compartment behind a bookcase three chapters ago and showed Lady Ros an old map inside. They've been quietly trying to identify the map's symbols ever since.",
    chapter: 6,
  },
  {
    id: "throne_exile",
    setting: "The throne room, court assembled, formal and tense",
    characters: ["King Aldos", "Duke Farren"],
    context: "Last chapter the king exiled Duke Farren publicly. Farren has returned in disguise. The king does not yet know.",
    chapter: 9,
  },
  {
    id: "training_yard",
    setting: "The castle training yard, morning, packed dirt and wooden dummies",
    characters: ["Captain Lyra", "Joss"],
    context: "Lyra commands the guard. Joss is a recruit she sparred with last chapter and easily defeated. He has been practicing the footwork she showed him.",
    chapter: 4,
  },
  {
    id: "spy_inn",
    setting: "A room at the Wheel & Anchor inn, late night, single guttering candle",
    characters: ["Cael", "Mord"],
    context: "Cael is a spy. Two chapters ago he searched Mord's belongings while he slept and found a coded letter, which he memorized but did not take.",
    chapter: 5,
  },
  {
    id: "mountain_guide",
    setting: "A high pass in the Greysides, wind picking up, grey sky",
    characters: ["Ewyn", "Halloran"],
    context: "Ewyn is a local guide hired by the merchant Halloran. Last chapter she warned him a storm was coming and he refused to shelter in time.",
    chapter: 5,
  },
  {
    id: "healer_chamber",
    setting: "A healer's chamber, herbs drying overhead, firelight",
    characters: ["Cora", "Ser Baine"],
    context: "Cora is the town healer. Two chapters back, while tending Baine's wound, he let slip the name of the lord who ordered his death — Lord Maro.",
    chapter: 6,
  },
  {
    id: "ship_storm",
    setting: "The deck of the Brindle, rain lashing, waves rising",
    characters: ["Nira", "Telm"],
    context: "Nira is the first mate. Telm is a passenger who panicked during the last storm and Nira had to physically pull him from the railing.",
    chapter: 4,
  },
  {
    id: "garden_listen",
    setting: "A walled garden at dusk, roses in bloom, low voices",
    characters: ["Lady Sela", "Lord Cren"],
    context: "Sela is Cren's niece. Last chapter she hid behind a hedge and overheard Cren give a hooded stranger a purse and a name — 'Marrick'.",
    chapter: 5,
  },
  {
    id: "dungeon_pair",
    setting: "A shared cell in the dungeon below the keep, dripping water, near darkness",
    characters: ["Alec", "Bren"],
    context: "Alec is a former locksmith. Two chapters back he told Bren he could open the cell with a bent nail and they agreed on a plan for tonight.",
    chapter: 6,
  },
  {
    id: "temple_door",
    setting: "The stone temple of Vorra, doorway, night, rain",
    characters: ["Priest Vorn", "Dara Steelbow"],
    context: "Last chapter Dara asked Vorn to shelter wounded soldiers in the temple. Vorn refused, citing the sacred law against bringing arms inside.",
    chapter: 4,
  },
  {
    id: "crossroads_box",
    setting: "A crossroads at dusk, fading light, no other travelers",
    characters: ["Kett", "the courier"],
    context: "Two chapters back Kett agreed to carry a sealed box for a hooded stranger in exchange for a horse. The courier is now waiting at the crossroads to take the box.",
    chapter: 5,
  },
  {
    id: "farmhouse_door",
    setting: "A farmhouse doorway, cold morning, muddy road",
    characters: ["Mila", "Toll"],
    context: "Mila is a refugee with two young children. Last chapter she begged Toll for bread and he eventually relented when he saw the children.",
    chapter: 3,
  },
  {
    id: "tournament_lists",
    setting: "The tournament lists, afternoon, cheering crowd",
    characters: ["Ser Gard", "the challenger"],
    context: "Last chapter Ser Gard was unhorsed by an unknown challenger and forced to yield. The challenger's identity is still unknown to Gard.",
    chapter: 6,
  },
  {
    id: "forge_lesson",
    setting: "Rael's forge, heat and hammer-noise, morning",
    characters: ["Rael", "Ori"],
    context: "Rael is a master smith; Ori is his impatient apprentice. Last chapter Rael showed Ori that striking too hard shatters the metal.",
    chapter: 4,
  },
]

// ── Variant types ─────────────────────────────────────────────────────────

type VariantType = "VAR_NONE" | "VAR_REL" | "VAR_EVENTS" | "VAR_LOCATION" | "VAR_KNOWLEDGE" | "VAR_MULTI"

type LookupType = "recent_events" | "relationship" | "location_events" | "knowledge"

interface VariantSpec {
  type: VariantType
  expectedTypes: LookupType[]   // the deterministic label
  instruction: string           // what to tell the prose-writing LLM
}

function getVariants(_s: Scenario): VariantSpec[] {
  return [
    {
      type: "VAR_NONE",
      expectedTypes: [],
      instruction: `Write a single beat description (one sentence, ~15-25 words) that uses one of these phrases: "after the morning meal", "earlier that day", "since the last bell", "before the sun rose", "what they said about the weather". The beat should be a SELF-CONTAINED action — a transition, a routine moment, an observation — that does NOT actually need any historical context to write. The implicit-marker phrase is purely ambient framing, not a reference to any specific prior event. Example shape: "After the morning meal, X walks to the well to draw water."`,
    },
    {
      type: "VAR_REL",
      expectedTypes: ["relationship"],
      instruction: `Write a single beat description (one sentence, ~15-25 words) where the two named characters interact in a way that depends entirely on their RELATIONSHIP DYNAMIC (trust, tension, history of conflict, alliance). The beat must reference something like "the tension from their last encounter", "after the argument", "their last fight", "the promise" — and the writer needs the relationship state to handle the tone correctly. The beat must NOT reference a specific external event, only the dynamic between them.`,
    },
    {
      type: "VAR_EVENTS",
      expectedTypes: ["recent_events"],
      instruction: `Write a single beat description (one sentence, ~15-25 words) where one character does something that explicitly depends on a SPECIFIC RECENT EVENT involving them — "the letter she received", "what happened at the gate", "the deal he made", "after the ambush". The writer needs the details of that prior event to write the beat correctly. Do NOT reference relationship dynamics or location history — focus the implicit reference on a discrete event.`,
    },
    {
      type: "VAR_LOCATION",
      expectedTypes: ["location_events"],
      instruction: `Write a single beat description (one sentence, ~15-25 words) where the implicit reference is to PRIOR EVENTS THAT HAPPENED AT THIS SPECIFIC PLACE — "where they fought before", "the spot where the deal was struck", "the same corner as last time". The character's behavior depends on knowing what happened HERE previously. Do not reference characters' relationship dynamics or non-location-bound events.`,
    },
    {
      type: "VAR_KNOWLEDGE",
      expectedTypes: ["knowledge"],
      instruction: `Write a single beat description (one sentence, ~15-25 words) where one character RECALLS, REVEALS, OR USES information they specifically LEARNED at some prior moment — "what she learned about the mines", "the truth about Lord Maro", "what he was told in the chapel". The writer needs to know what knowledge that character has. Do NOT reference shared events between two characters or location history.`,
    },
    {
      type: "VAR_MULTI",
      expectedTypes: ["relationship", "recent_events"],
      instruction: `Write a single beat description (one sentence, ~25-35 words) that requires BOTH (a) the relationship dynamic between the two named characters AND (b) a specific recent event involving them. Example shape: "X finally tells Y the truth about the night their friend died, after years of holding it back" — needs relationship (X↔Y trust state) AND recent_events (the friend's death). Use both implicit references in the same sentence.`,
    },
  ]
}

// ── Beat generation ───────────────────────────────────────────────────────

const GEN_SYSTEM = `You write scene beat descriptions for a novel-writing pipeline. A beat is a brief sentence describing what happens in one scene moment — not the prose, just the spec. Return ONLY the beat sentence itself, no quotes, no labels, no explanation.`

async function generateBeat(s: Scenario, variant: VariantSpec): Promise<string> {
  const prompt = `Setting: ${s.setting}
Characters: ${s.characters.join(", ")}
Background: ${s.context}

Variant: ${variant.type}
Instructions: ${variant.instruction}

Write the beat sentence now.`

  const transport = getTransport()
  const result = await transport.execute({
    systemPrompt: GEN_SYSTEM,
    userPrompt: prompt,
    provider: "cerebras",
    model: "qwen-3-235b-a22b-instruct-2507",
    temperature: 0.8,
    maxTokens: 200,
  })
  let beat = result.content.trim()
  // Strip JSON wrapper if model returned {"beat": "..."} instead of raw text
  if (beat.startsWith("{")) {
    try {
      const parsed = JSON.parse(beat)
      beat = (parsed.beat ?? parsed.text ?? parsed.description ?? beat).trim()
    } catch {}
  }
  // Strip surrounding quotes if present
  if ((beat.startsWith('"') && beat.endsWith('"')) || (beat.startsWith("'") && beat.endsWith("'"))) {
    beat = beat.slice(1, -1).trim()
  }
  return beat
}

// ── Pair builder ──────────────────────────────────────────────────────────

function buildPair(s: Scenario, variant: VariantSpec, beat: string): string {
  const user = buildReferencePrompt(beat, s.characters, s.setting, s.chapter)
  // The "assistant" message is the deterministic label as a JSON object with
  // ONLY the type set. Args are intentionally absent — args are scored
  // separately if at all, the binary ladder metric is type-set match.
  const assistant = JSON.stringify({
    expectedTypes: variant.expectedTypes,
  })
  return JSON.stringify({
    messages: [
      { role: "system",    content: REFERENCE_SYSTEM },
      { role: "user",      content: user },
      { role: "assistant", content: assistant },
    ],
    _meta: { scenario: s.id, variant: variant.type, beat },
  })
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const expId = EXPERIMENT_ID ?? await createTuningExperiment(
    "data-generation",
    "Reference-resolver synthetic eval data — 20 scenarios × 6 variants",
    {
      scenarios: SCENARIOS.length,
      variantsPerScenario: 6,
      totalTarget: SCENARIOS.length * 6,
      variants: ["VAR_NONE", "VAR_REL", "VAR_EVENTS", "VAR_LOCATION", "VAR_KNOWLEDGE", "VAR_MULTI"],
      generator: "cerebras qwen-3-235b-a22b-instruct-2507 t=0.8",
      labelStrategy: "deterministic from variant type — expected lookup TYPE set, args ignored",
      approach: "LLM-generated beat phrasings, deterministic labels",
    },
    { target: "reference-resolver", dimension: "calibration" },
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
        const beat = await generateBeat(scenario, variant)
        const pair = buildPair(scenario, variant, beat)
        pairs.push(pair)
        appendFileSync(OUT_PATH, pair + "\n")
        done++
        process.stdout.write(`done (${done}/${total}) — "${beat.slice(0, 60)}${beat.length > 60 ? "…" : ""}"\n`)
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

  const conclusion = `Generated ${pairs.length}/${total} reference-resolver eval pairs. ${variantSummary}. Saved to lora-data/reference-resolver-pairs.jsonl. 20 scenarios × 6 variants. Labels are deterministic from variant type — expected lookup TYPE set only, args excluded from scoring. Used by score-reference-baseline.ts and score-reference-checklist.ts (the reference-resolver ladder, mirroring exp #110/#111).`
  await concludeExperiment(expId, conclusion)
  console.log(`\n${conclusion}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
