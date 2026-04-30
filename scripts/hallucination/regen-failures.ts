/**
 * Regenerate injection failures from Stage 2 to hit the 500-pair target.
 *
 * Reads the existing raw JSONL, determines which (scenario × variant) combos
 * are missing, and regenerates them with stricter prompts:
 *   - FAIL_NEW_SYSTEM_OR_FACTION: explicit VERBATIM clause (Cerebras was
 *     paraphrasing multi-word tokens like "the Pale Guild").
 *   - FAIL_NEW_CHARACTER (dialogue-only subcase): emphatic "name must NEVER
 *     appear outside quoted speech" clause.
 *   - Other variants: second try with temperature kept at 0.8.
 *
 * Appends valid regenerated pairs to the same output JSONL; skips any
 * regeneration that fails Stage 3 validation after 3 attempts.
 *
 * Usage (on LXC):
 *   EXPERIMENT_ID=<parent> bun scripts/hallucination/regen-failures.ts
 */

import { appendFileSync, readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"
import { SCENARIOS } from "./scenarios-draft"
import { getTransport } from "../../src/transport"
// Re-import everything we need from the main generator. Named imports
// keep the two files semantically coupled — no copy/paste drift.
import type { HallucScenario } from "./generate-halluc-data"

const POOLS = JSON.parse(
  readFileSync(join(import.meta.dir, "injection-pools.json"), "utf8"),
)

const OUT_PATH = join(import.meta.dir, "..", "..", "finetune-data", "halluc-checker-v2-pairs-raw.jsonl")

const SYSTEM_PROMPT = `You are a hallucination detector for generated fiction beats.

Given a beat's prose, brief, world bible excerpt, and speaker profiles, identify named entities in the prose that are NOT grounded in the supplied context.

Flag two categories:
A. Corpus leakage — names borrowed from R.A. Salvatore's Icewind Dale / Forgotten Realms (Drizzt, Bruenor, Mithril Hall, Ten-Towns, Bryn Shander, Termalaine, Calimport, Luskan, Maer Dualdon, Cryshal-Tirith, Harpells, Sword Coast, Faerûn, Crystal Shard, Aegis-fang, drow, verbeeg, duergar, Do'Urden, Battlehammer, Baldur's Gate, etc.).
B. Ungrounded named entities — proper nouns (characters, places, items, factions, systems) that do not appear in speakers, brief.characters, brief.setting, brief.pov, or world_bible_excerpt.

Pass (do not flag): sentence-initial common nouns, days/months, real-world refs, generic titles ("the Captain"), cardinal coordinates, last-name aliases of grounded characters, title+grounded-surname aliases, lowercase generic race terms.

Edge rules: first+new-last-name → FAIL (drift); new named character in dialogue only → FAIL; plural ungrounded faction → FAIL; brief.summary counts as grounded context.

Output ONLY valid JSON:
{"pass": bool, "issues": [{"entity": "...", "excerpt": "..."}]}

Empty issues array if pass. excerpt is a 10-30 word context span.`

// ── Helpers (duplicated from generate-halluc-data.ts — kept in sync) ──────

const TITLES = new Set([
  "Lord", "Lady", "Sir", "Dame", "King", "Queen", "Prince", "Princess",
  "Count", "Countess", "Duke", "Duchess", "Baron", "Baroness", "Earl",
  "Margrave", "Viscount", "Viscountess", "Archduke", "Emperor", "Empress",
  "Captain", "Commander", "Lieutenant", "Sergeant", "General", "Admiral",
  "Marshal", "Major", "Colonel", "Corporal", "Private", "Sheriff", "Deputy",
  "Officer", "Inspector", "Detective", "Chief", "Warden", "Guard", "Agent",
  "Operator", "Pilot", "Constable", "Magistrate", "Centurion", "Tribune",
  "Bishop", "Priest", "Deacon", "Abbot", "Abbess", "Monk", "Nun", "Brother",
  "Sister", "Mother", "Father", "Chaplain", "Pope", "Cardinal", "Oracle",
  "Doctor", "Dr.", "Dr", "Professor", "Master", "Mistress", "Porter",
  "Scholar", "Archivist", "Librarian", "Keeper", "Steward", "Apprentice",
  "Seer", "Elder", "Sage", "Chancellor", "Witness", "Witch", "Warlock",
  "Healer", "Ranger", "Knight", "Squire", "Bard", "Mage", "Wizard",
  "Liche-Speaker", "Speaker", "Raid", "Leader", "DPS", "Tank", "Support",
  "CEO", "CTO", "CFO", "Director", "Manager",
])

function stripTitles(name: string): string[] {
  const parts = name.split(/\s+/)
  let i = 0
  while (i < parts.length && TITLES.has(parts[i]!)) i++
  return parts.slice(i)
}

function firstLastSpeaker(s: HallucScenario): string | null {
  for (const name of Object.keys(s.speakers)) {
    if (stripTitles(name).length >= 2) return name
  }
  return null
}

function splitFirstLast(name: string): { first: string; last: string } {
  const residual = stripTitles(name)
  return { first: residual[residual.length - 2]!, last: residual[residual.length - 1]! }
}

function md5Bytes(s: string): Buffer {
  return require("crypto").createHash("md5").update(s).digest()
}

function hashPick<T>(scenarioId: string, key: string, pool: T[]): T {
  const h = md5Bytes(`${scenarioId}:${key}`)
  return pool[h.readUInt32BE(0) % pool.length]
}

function hashByte(s: string, idx: number): number {
  return md5Bytes(s)[idx]
}

type VariantType =
  | "PASS_CLEAN" | "PASS_LAST_NAME_ALIAS" | "PASS_TITLE_GROUNDED" | "PASS_ANAPHORIC_GENERIC" | "PASS_REAL_WORLD_REF"
  | "FAIL_NEW_CHARACTER" | "FAIL_NEW_PLACE" | "FAIL_NEW_SYSTEM_OR_FACTION" | "FAIL_CORPUS_LEAK" | "FAIL_FIRST_NEW_LAST"

interface VariantSpec {
  type: VariantType
  pass: boolean
  picked: string | null
  instruction: string
  subcase?: string
}

// ── Stricter instruction overrides for failure-prone variants ─────────────

function getStrictVariant(s: HallucScenario, variantType: VariantType): VariantSpec {
  const fl = firstLastSpeaker(s)
  if (!fl) throw new Error(`Scenario ${s.id} has no First Last speaker`)
  const { first: flFirst, last: flLast } = splitFirstLast(fl)

  const useSystem = hashByte(s.id, 1) % 2 === 0
  const pickedSystemOrFaction = hashPick<string>(
    s.id, "FAIL_NEW_SYSTEM_OR_FACTION",
    useSystem ? POOLS.systemNames : POOLS.factionNames,
  )
  const pickedChar = hashPick<string>(s.id, "FAIL_NEW_CHARACTER", POOLS.characterNames)
  const pickedPlace = hashPick<string>(s.id, "FAIL_NEW_PLACE", POOLS.placeNames)
  const pickedLeak = hashPick<string>(s.id, "FAIL_CORPUS_LEAK", POOLS.leakTokens)
  const pickedNewSurname = hashPick<string>(s.id, "FAIL_FIRST_NEW_LAST", POOLS.characterNames)
  const pickedRealWorld = hashPick<string>(s.id, "PASS_REAL_WORLD_REF", POOLS.realWorldRefs)
  const dialogueOnly = hashByte(s.id, 2) % 2 === 0
  const sofLabel = useSystem ? "magic/technology system" : "organization/faction"

  switch (variantType) {
    case "FAIL_NEW_SYSTEM_OR_FACTION":
      return {
        type: variantType, pass: false, picked: pickedSystemOrFaction,
        instruction: `Write ~200 words executing this brief. You MUST reference a NEW named ${sofLabel} called EXACTLY "${pickedSystemOrFaction}" — use this exact phrase at least once, VERBATIM, as a proper noun. Do NOT paraphrase it. Do NOT substitute a similar-sounding name. The exact text "${pickedSystemOrFaction}" must appear somewhere in your prose. This ${sofLabel} is NOT in the world bible — it is a new addition.`,
      }
    case "FAIL_NEW_CHARACTER":
      return {
        type: variantType, pass: false, picked: pickedChar,
        subcase: dialogueOnly ? "dialogue-only" : "narration",
        instruction: dialogueOnly
          ? `Write ~200 words executing this brief. Include ONE dialogue line from a grounded speaker that mentions a NEW character named "${pickedChar}". The name "${pickedChar}" MUST appear ONLY INSIDE QUOTATION MARKS ("..."). The name "${pickedChar}" MUST NEVER appear in narration, description, attribution, or any text outside quoted speech. Example: grounded_speaker says, "Did you hear ${pickedChar} made it?" — but NOT: ${pickedChar} arrived at dawn. Violations of this constraint invalidate the training example.`
          : `Write ~200 words executing this brief. Insert 1–2 sentences of NARRATION mentioning a NEW named character EXACTLY spelled "${pickedChar}" — NOT in SPEAKERS or brief.characters. The narration must name them verbatim, e.g. "${pickedChar} arrived at the gate". Do NOT substitute a similar-sounding name.`,
      }
    case "PASS_REAL_WORLD_REF":
      return {
        type: variantType, pass: true, picked: pickedRealWorld,
        instruction: `Write ~200 words executing this brief. You MUST include the real-world reference "${pickedRealWorld}" verbatim at least once, used descriptively. This is a PASS because real-world references are allowed. Do NOT introduce any invented proper nouns.`,
      }
    // Defaults for other variants mirror the main generator (no stricter needed)
    case "PASS_CLEAN": return {
      type: variantType, pass: true, picked: null,
      instruction: `Write ~200 words of prose executing this brief. Use ONLY proper nouns that appear in SPEAKERS, brief.characters, brief.setting, or the WORLD BIBLE.`,
    }
    case "PASS_LAST_NAME_ALIAS": return {
      type: variantType, pass: true, picked: flLast,
      instruction: `Write ~200 words executing this brief. At least once, refer to ${fl} using ONLY the surname "${flLast}".`,
    }
    case "PASS_TITLE_GROUNDED": return {
      type: variantType, pass: true, picked: flLast,
      instruction: `Write ~200 words executing this brief. At least once use a Title + "${flLast}" construction.`,
    }
    case "PASS_ANAPHORIC_GENERIC": return {
      type: variantType, pass: true, picked: null,
      instruction: `Write ~200 words executing this brief. Refer to grounded entities using GENERIC definite phrases at least twice.`,
    }
    case "FAIL_NEW_PLACE": return {
      type: variantType, pass: false, picked: pickedPlace,
      instruction: `Write ~200 words executing this brief. Reference a NEW named location EXACTLY spelled "${pickedPlace}" (not in the world bible) at least once.`,
    }
    case "FAIL_CORPUS_LEAK": return {
      type: variantType, pass: false, picked: pickedLeak,
      instruction: `Write ~200 words executing this brief. Include the term "${pickedLeak}" somewhere in the prose, verbatim.`,
    }
    case "FAIL_FIRST_NEW_LAST": return {
      type: variantType, pass: false, picked: `${flFirst} ${pickedNewSurname}`,
      instruction: `Write ~200 words executing this brief. At least once, refer to ${fl} with the DIFFERENT surname "${pickedNewSurname}" — write "${flFirst} ${pickedNewSurname}" verbatim somewhere.`,
    }
  }
}

// ── Prose generation (same as main generator) ────────────────────────────

const GEN_SYSTEM = `You are a skilled prose writer generating labeled training examples for a hallucination-detection classifier.
Write prose exactly matching the requested variant instructions.
Return your response as strict JSON: {"prose": "<full prose here>"}
Use \\n for paragraph breaks. No other keys, no commentary.`

function serializeBriefForWriter(s: HallucScenario): string {
  const speakers = Object.entries(s.speakers).map(([name, pattern]) =>
    `  ${name}: ${pattern}`).join("\n") || "  (none)"
  const locs = s.worldBible.locations.map(l => l.name).join(", ") || "(none)"
  const cultures = s.worldBible.cultures.map(c => c.name).join(", ") || "(none)"
  const systems = s.worldBible.systems.map(sy => sy.name).join(", ") || "(none)"
  return `BRIEF:
  Kind: ${s.brief.kind}
  POV: ${s.brief.pov}
  Setting: ${s.brief.setting}
  Characters present: ${s.brief.characters.join(", ") || "(none)"}
  Summary: ${s.brief.summary}

WORLD BIBLE:
  Locations: ${locs}
  Cultures: ${cultures}
  Systems: ${systems}

SPEAKERS:
${speakers}`
}

async function generateProse(s: HallucScenario, v: VariantSpec): Promise<string> {
  const briefText = serializeBriefForWriter(s)
  const userPrompt = `${briefText}

VARIANT: ${v.type}${v.subcase ? ` (${v.subcase})` : ""}
INSTRUCTIONS: ${v.instruction}

Now write the prose.`

  const transport = getTransport()
  const result = await transport.execute({
    systemPrompt: GEN_SYSTEM,
    userPrompt,
    provider: "cerebras" as const,
    model: "qwen-3-235b-a22b-instruct-2507",
    temperature: 0.8,
    maxTokens: 800,
  })
  let prose = result.content.trim()
  if (prose.startsWith("{")) {
    try {
      const parsed = JSON.parse(prose)
      const extracted = parsed.prose ?? parsed.text ?? parsed.content
      if (typeof extracted === "string" && extracted.length > 80) prose = extracted.trim()
    } catch { /* fall through */ }
  }
  if (prose.startsWith("```")) {
    prose = prose.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
  }
  return prose
}

// ── Stage 3 validation (FAIL-only; PASS-side trusts Sonnet) ──────────────

function isInDialogueOnly(prose: string, token: string): boolean {
  let i = 0, inQuote = false, found = false, allInQuote = true
  while (i < prose.length) {
    const ch = prose[i]
    if (ch === '"' || ch === '\u201C' || ch === '\u201D') inQuote = !inQuote
    if (prose.startsWith(token, i)) {
      found = true
      if (!inQuote) allInQuote = false
      i += token.length
      continue
    }
    i++
  }
  return found && allInQuote
}

function validateInjection(prose: string, v: VariantSpec): string | null {
  if (v.type === "PASS_CLEAN" || v.type === "PASS_ANAPHORIC_GENERIC") return null
  if (!v.picked) return "picked_missing"
  if (v.type === "FAIL_CORPUS_LEAK") {
    return prose.toLowerCase().includes(v.picked.toLowerCase()) ? null : `leak_absent:${v.picked}`
  }
  if (v.type === "PASS_REAL_WORLD_REF") {
    return prose.toLowerCase().includes(v.picked.toLowerCase()) ? null : `rw_ref_absent:${v.picked}`
  }
  if (!prose.includes(v.picked)) return `token_absent:${v.picked}`
  if (v.type === "FAIL_NEW_CHARACTER" && v.subcase === "dialogue-only" && !isInDialogueOnly(prose, v.picked)) {
    return `dialogue_only_violated:${v.picked}`
  }
  return null
}

// ── Training-pair builder ────────────────────────────────────────────────

function buildUserPrompt(s: HallucScenario, prose: string): string {
  const speakers = Object.entries(s.speakers).map(([name, p]) =>
    `  ${name}: ${p}`).join("\n") || "  (none)"
  const locs = s.worldBible.locations.map(l => l.name).join(", ") || "(none)"
  const cultures = s.worldBible.cultures.map(c => c.name).join(", ") || "(none)"
  const systems = s.worldBible.systems.map(sy => sy.name).join(", ") || "(none)"
  return `BEAT BRIEF:
Summary: ${s.brief.summary}
Kind: ${s.brief.kind}
POV: ${s.brief.pov}
Setting: ${s.brief.setting}
Characters: ${s.brief.characters.join(", ") || "(none)"}

WORLD BIBLE (relevant):
Locations: ${locs}
Cultures: ${cultures}
Systems: ${systems}

SPEAKERS:
${speakers}

PROSE TO CHECK:
${prose}`
}

function extractExcerpt(prose: string, token: string): string {
  const idx = prose.toLowerCase().indexOf(token.toLowerCase())
  if (idx < 0) return ""
  const before = prose.slice(0, idx).split(/\s+/).slice(-10).join(" ")
  const after = prose.slice(idx + token.length).split(/\s+/).slice(0, 15).join(" ")
  return `${before} ${prose.slice(idx, idx + token.length)} ${after}`.trim()
}

function buildPair(s: HallucScenario, v: VariantSpec, prose: string): object {
  const expected: { pass: boolean; issues: Array<{ entity: string; excerpt: string }> } = {
    pass: v.pass, issues: [],
  }
  if (!v.pass && v.picked) {
    expected.issues.push({ entity: v.picked, excerpt: extractExcerpt(prose, v.picked) })
  }
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(s, prose) },
      { role: "assistant", content: JSON.stringify(expected) },
    ],
    _meta: {
      scenario: s.id, variant: v.type, subcase: v.subcase ?? null,
      pass: v.pass, picked: v.picked, genre: s.genre, split: s.split,
      regen: true,
    },
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

const VARIANT_TYPES: VariantType[] = [
  "PASS_CLEAN", "PASS_LAST_NAME_ALIAS", "PASS_TITLE_GROUNDED", "PASS_ANAPHORIC_GENERIC", "PASS_REAL_WORLD_REF",
  "FAIL_NEW_CHARACTER", "FAIL_NEW_PLACE", "FAIL_NEW_SYSTEM_OR_FACTION", "FAIL_CORPUS_LEAK", "FAIL_FIRST_NEW_LAST",
]

async function main() {
  // Step 1: determine which (scenario × variant) pairs are present in OUT_PATH
  const present = new Set<string>()
  const lines = readFileSync(OUT_PATH, "utf8").trim().split("\n").filter(Boolean)
  for (const l of lines) {
    const r = JSON.parse(l)
    present.add(`${r._meta.scenario}:${r._meta.variant}`)
  }
  console.log(`Existing pairs: ${lines.length}`)

  // Step 2: compute missing pairs
  const missing: Array<{ scenario: HallucScenario; variantType: VariantType }> = []
  for (const s of SCENARIOS) {
    for (const vt of VARIANT_TYPES) {
      if (!present.has(`${s.id}:${vt}`)) {
        missing.push({ scenario: s, variantType: vt })
      }
    }
  }
  console.log(`Missing pairs: ${missing.length}`)
  if (missing.length === 0) {
    console.log("Nothing to regenerate.")
    process.exit(0)
  }

  const parentExpId = process.env.EXPERIMENT_ID ? Number(process.env.EXPERIMENT_ID) : null
  const expId = await createTuningExperiment(
    "data-generation",
    `Hallucination v2 prose regen — ${missing.length} failed variants, stricter prompts${parentExpId ? ` (parent #${parentExpId})` : ""}`,
    {
      missing_count: missing.length,
      missing_by_variant: missing.reduce((o: Record<string, number>, m) => {
        o[m.variantType] = (o[m.variantType] ?? 0) + 1
        return o
      }, {}),
      parent_experiment_id: parentExpId,
      strategy: "stricter-instruction-plus-retry",
      max_attempts: 3,
    },
    { target: "hallucination-checker-v2", dimension: "data-gen" },
  )
  console.log(`Regen experiment id=${expId}`)

  // Step 3: for each missing pair, retry up to 3 attempts
  let ok = 0, dropped = 0
  const droppedDetails: string[] = []
  for (const { scenario, variantType } of missing) {
    let success = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      const v = getStrictVariant(scenario, variantType)
      try {
        const prose = await generateProse(scenario, v)
        const injErr = validateInjection(prose, v)
        if (!injErr) {
          appendFileSync(OUT_PATH, JSON.stringify(buildPair(scenario, v, prose)) + "\n")
          ok++
          success = true
          console.log(`  [OK a${attempt}] ${scenario.id}/${variantType}`)
          break
        }
        console.log(`  [FAIL a${attempt}] ${scenario.id}/${variantType}: ${injErr}`)
      } catch (e: any) {
        console.log(`  [GEN FAIL a${attempt}] ${scenario.id}/${variantType}: ${e.message ?? e}`)
      }
    }
    if (!success) {
      dropped++
      droppedDetails.push(`${scenario.id}/${variantType}`)
    }
  }

  const summary = `Regen: ${ok} recovered, ${dropped} dropped (${droppedDetails.join(", ") || "none"}). Total pairs now: ${lines.length + ok}.`
  console.log(`\n${summary}`)
  await concludeExperiment(expId, summary)
  process.exit(0)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
