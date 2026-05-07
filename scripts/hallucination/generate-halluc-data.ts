/**
 * Synthetic training data generator for hallucination-checker-v2.
 *
 * Mirrors archives/.../generate-chapter-plan-data.ts methodology
 * (exp #164/#170/#178 — the run that got chapter-plan-checker-v2 to 96%).
 *
 *   50 scenarios × 10 variants = 500 pairs, 50/50 PASS/FAIL balance.
 *   Prose generation: Cerebras Qwen 235B, temp 0.8.
 *   Labeling: Sonnet 4.6 via Claude Code subagents (Stage 4, separate script).
 *
 * Pipeline stages covered by this script:
 *   Stage 2 — prose generation (one DeepSeek V4 Flash call per pair).
 *   Stage 3 — injection validation (keyword/regex check inline).
 *
 * Pipeline stages elsewhere:
 *   Stage 1 — scenario authoring → populates SCENARIOS[] below.
 *   Stage 4 — Sonnet labeling → scripts/hallucination/label-v2-batches.ts (TODO)
 *   Stage 5 — SFT format → scripts/hallucination/format-v2-sft.ts (TODO)
 *
 * Full spec: scripts/hallucination/variant-taxonomy.md
 *
 * Usage (on LXC):
 *   EXPERIMENT_ID=<id> bun scripts/hallucination/generate-halluc-data.ts
 *   # or omit to create a new experiment row
 */

import { appendFileSync, existsSync, writeFileSync, readFileSync } from "fs"
import { createHash } from "crypto"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"
import { getTransport } from "../../src/transport"

// ── Constants ─────────────────────────────────────────────────────────────

const POOLS = JSON.parse(
  readFileSync(join(import.meta.dir, "injection-pools.json"), "utf8"),
)

// Active model policy: synthetic prose generation uses DeepSeek V4 Flash with
// thinking disabled by the shared transport normalizer.
const WRITER_PROVIDER = "deepseek"
const WRITER_MODEL = "deepseek-v4-flash"
const OUT_SUFFIX = process.env.HALLUC_OUT_SUFFIX ?? "raw"

const OUT_PATH = join(import.meta.dir, "..", "..", "finetune-data", `halluc-checker-v2-pairs-${OUT_SUFFIX}.jsonl`)

// Verbatim from scripts/hallucination/format-sft.ts — must match exactly so
// v2 adapter slots into the same serving shape as v1.
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

// ── Types ─────────────────────────────────────────────────────────────────

export interface HallucScenario {
  id: string
  genre: "fantasy" | "dark-fantasy" | "portal-fantasy" | "gamelit" | "sci-fi" | "contemporary" | "romance"
  split: "train" | "val"
  brief: {
    kind: "action" | "dialogue" | "interiority" | "description"
    pov: string
    setting: string
    characters: string[]
    summary: string
  }
  worldBible: {
    locations: Array<{ name: string }>
    cultures: Array<{ name: string }>
    systems: Array<{ name: string }>
  }
  speakers: Record<string, string>  // name → speech pattern description
}

type VariantType =
  | "PASS_CLEAN" | "PASS_LAST_NAME_ALIAS" | "PASS_TITLE_GROUNDED" | "PASS_ANAPHORIC_GENERIC" | "PASS_REAL_WORLD_REF"
  | "FAIL_NEW_CHARACTER" | "FAIL_NEW_PLACE" | "FAIL_NEW_SYSTEM_OR_FACTION" | "FAIL_CORPUS_LEAK" | "FAIL_FIRST_NEW_LAST"

interface VariantSpec {
  type: VariantType
  pass: boolean
  picked: string | null   // injection token (null for recipes without one)
  instruction: string     // appended to user prompt for Cerebras
  subcase?: string        // e.g. "dialogue-only" | "narration" for FAIL_NEW_CHARACTER
}

// ── Deterministic pickers ─────────────────────────────────────────────────

function md5Bytes(s: string): Buffer {
  return createHash("md5").update(s).digest()
}

function hashPick<T>(scenarioId: string, key: string, pool: T[]): T {
  const h = md5Bytes(`${scenarioId}:${key}`)
  return pool[h.readUInt32BE(0) % pool.length]
}

function hashByte(s: string, idx: number): number {
  return md5Bytes(s)[idx]
}

// Honorific / title allowlist. Leading tokens matching these are stripped
// before parsing the personal name. Added after audit 2026-04-18 — 26% of
// authored speaker keys carry title prefixes (Lord/Commander/Sergeant/etc.)
// that would otherwise break the First/Last splitter.
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
  "Liche-Speaker", "Speaker",
  "Raid", "Leader", "DPS", "Tank", "Support",
  "CEO", "CTO", "CFO", "Director", "Manager",
])

function stripTitles(name: string): string[] {
  const parts = name.split(/\s+/)
  let i = 0
  while (i < parts.length && TITLES.has(parts[i]!)) i++
  return parts.slice(i)
}

// Returns the speaker key whose title-stripped form is a clean First Last
// (two or more residual tokens). Scans speakers dict in insertion order.
function firstLastSpeaker(s: HallucScenario): string | null {
  for (const name of Object.keys(s.speakers)) {
    if (stripTitles(name).length >= 2) return name
  }
  return null
}

// Last two tokens of the title-stripped form. Handles "Lord Halvern Drayce"
// (title + First + Last), "Raid Leader Dass Orrin" (two titles + First + Last),
// plain "Sylvie Dunmore", and multi-part names (takes trailing two tokens).
function splitFirstLast(name: string): { first: string; last: string } {
  const residual = stripTitles(name)
  if (residual.length < 2) {
    throw new Error(`splitFirstLast: "${name}" has no First Last after title stripping`)
  }
  return {
    first: residual[residual.length - 2]!,
    last: residual[residual.length - 1]!,
  }
}

// ── Variant specs (the 10 recipes) ────────────────────────────────────────

function getVariants(s: HallucScenario): VariantSpec[] {
  const fl = firstLastSpeaker(s)
  if (!fl) throw new Error(`Scenario ${s.id} has no First Last speaker — required by spec`)
  const { first: flFirst, last: flLast } = splitFirstLast(fl)

  // System-vs-faction coin flip for FAIL_NEW_SYSTEM_OR_FACTION
  const systemPool: string[] = POOLS.systemNames
  const factionPool: string[] = POOLS.factionNames
  const useSystem = hashByte(s.id, 1) % 2 === 0
  const pickedSystemOrFaction = hashPick(s.id, "FAIL_NEW_SYSTEM_OR_FACTION",
    useSystem ? systemPool : factionPool)

  // Picks
  const pickedChar = hashPick<string>(s.id, "FAIL_NEW_CHARACTER", POOLS.characterNames)
  const pickedPlace = hashPick<string>(s.id, "FAIL_NEW_PLACE", POOLS.placeNames)
  const pickedLeak = hashPick<string>(s.id, "FAIL_CORPUS_LEAK", POOLS.leakTokens)
  const pickedNewSurname = hashPick<string>(s.id, "FAIL_FIRST_NEW_LAST", POOLS.characterNames)
  const pickedRealWorld = hashPick<string>(s.id, "PASS_REAL_WORLD_REF", POOLS.realWorldRefs)

  // Dialogue-only fold for FAIL_NEW_CHARACTER
  const dialogueOnly = hashByte(s.id, 2) % 2 === 0
  const sofLabel = useSystem ? "magic/technology system" : "organization/faction"

  return [
    {
      type: "PASS_CLEAN", pass: true, picked: null,
      instruction: `Write ~200 words of prose executing this brief. Use ONLY proper nouns that appear in SPEAKERS, brief.characters, brief.setting, or the WORLD BIBLE. Do NOT introduce any new named characters, places, organizations, or systems. Generic nouns ("the soldiers", "the tower") are fine.`,
    },
    {
      type: "PASS_LAST_NAME_ALIAS", pass: true, picked: flLast,
      instruction: `Write ~200 words executing this brief. At least once, refer to ${fl} using ONLY the surname "${flLast}" (e.g. "${flLast} set down the cup", "Then ${flLast} spoke"). Do NOT introduce any new proper nouns elsewhere.`,
    },
    {
      type: "PASS_TITLE_GROUNDED", pass: true, picked: flLast,
      instruction: `Write ~200 words executing this brief. At least once use a Title + "${flLast}" construction (e.g. "Captain ${flLast}", "Lord ${flLast}", "Healer ${flLast}"). The title itself need NOT be grounded — that is allowed. Do NOT introduce any OTHER new proper nouns.`,
    },
    {
      type: "PASS_ANAPHORIC_GENERIC", pass: true, picked: null,
      instruction: `Write ~200 words executing this brief. Refer to grounded entities using GENERIC definite phrases at least twice (e.g. "the captain", "the tower", "the road", "the villagers", "the soldiers", "the elders"). Lowercase race/faction terms like "the scouts" or "the farmers" are fine. Do NOT introduce ANY new named proper nouns.`,
    },
    {
      type: "PASS_REAL_WORLD_REF", pass: true, picked: pickedRealWorld,
      instruction: `Write ~200 words executing this brief. Include one REAL-WORLD reference used descriptively: "${pickedRealWorld}". This is a PASS because real-world references are explicitly allowed. Do NOT introduce any invented proper nouns.`,
    },
    {
      type: "FAIL_NEW_CHARACTER", pass: false, picked: pickedChar,
      subcase: dialogueOnly ? "dialogue-only" : "narration",
      instruction: dialogueOnly
        ? `Write ~200 words executing this brief. Include ONE dialogue line from a grounded speaker that mentions a NEW character named "${pickedChar}" — "${pickedChar}" is NOT in SPEAKERS or brief.characters. The name "${pickedChar}" must appear ONLY inside quoted dialogue ("..."), never in narration. Example form: grounded_speaker says, "Did you hear about ${pickedChar}?"`
        : `Write ~200 words executing this brief. Insert 1–2 sentences of NARRATION mentioning a NEW named character "${pickedChar}" — NOT in SPEAKERS or brief.characters. The narration must name them (e.g. "${pickedChar} arrived at the gate", "She thought of ${pickedChar}"). Grounded characters otherwise behave normally.`,
    },
    {
      type: "FAIL_NEW_PLACE", pass: false, picked: pickedPlace,
      instruction: `Write ~200 words executing this brief. Reference a NEW named location "${pickedPlace}" (in narration, dialogue, or memory) that is NOT in the world bible locations. Keep it capitalized as a proper noun. Use it at least once.`,
    },
    {
      type: "FAIL_NEW_SYSTEM_OR_FACTION", pass: false, picked: pickedSystemOrFaction,
      instruction: `Write ~200 words executing this brief. Reference a NEW named ${sofLabel} called "${pickedSystemOrFaction}" that is NOT in the world bible. Use it as a proper noun. Use it at least once.`,
    },
    {
      type: "FAIL_CORPUS_LEAK", pass: false, picked: pickedLeak,
      instruction: `Write ~200 words executing this brief. Include the term "${pickedLeak}" somewhere in the prose — in narration, dialogue, or internal thought. Use it naturally; do not quote it, explain it, or surround it with scare quotes.`,
    },
    {
      type: "FAIL_FIRST_NEW_LAST", pass: false, picked: `${flFirst} ${pickedNewSurname}`,
      instruction: `Write ~200 words executing this brief. At least once, refer to ${fl} with a DIFFERENT surname — write "${flFirst} ${pickedNewSurname}" instead of "${fl}". This is name drift: the grounded speaker is ${fl}, but the prose says "${flFirst} ${pickedNewSurname}". Use the drift form exactly once; other references to this character can use ${fl} or ${flFirst} alone.`,
    },
  ]
}

// ── User prompt — mirrors format-sft.ts exactly ───────────────────────────

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

// ── Cerebras prose generation ─────────────────────────────────────────────

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
    provider: WRITER_PROVIDER as any,
    model: WRITER_MODEL,
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

// ── Stage 3: injection validation ─────────────────────────────────────────

function collectGroundedTokens(s: HallucScenario): Set<string> {
  const g = new Set<string>()
  for (const name of Object.keys(s.speakers)) {
    for (const part of name.split(/\s+/)) g.add(part)
  }
  for (const c of s.brief.characters) for (const part of c.split(/\s+/)) g.add(part)
  for (const part of s.brief.setting.split(/\s+/)) if (/^[A-Z]/.test(part)) g.add(part)
  for (const l of s.worldBible.locations) for (const part of l.name.split(/\s+/)) g.add(part)
  for (const c of s.worldBible.cultures) for (const part of c.name.split(/\s+/)) g.add(part)
  for (const sy of s.worldBible.systems) for (const part of sy.name.split(/\s+/)) g.add(part)
  // POV can be multi-word
  for (const part of s.brief.pov.split(/\s+/)) if (/^[A-Z]/.test(part)) g.add(part)
  // Sentence-initial common-noun allowlist
  const allow = [
    "The", "A", "An", "And", "But", "Or", "Then", "Now", "First", "Second", "Third", "Next", "After", "Before", "When", "While", "If", "So", "Though", "Yet", "Still", "Here", "There", "Today", "Tomorrow", "Yesterday",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
    // real-world allowlist (overlaps with POOLS.realWorldRefs)
    ...(POOLS.realWorldRefs as string[]).flatMap((r: string) => r.split(/\s+/).filter(w => /^[A-Z]/.test(w))),
  ]
  for (const a of allow) g.add(a)
  return g
}

function findLeakedProperNouns(prose: string, grounded: Set<string>): string[] {
  // Floor check: collect tokens starting with uppercase that aren't grounded.
  // FPs are acceptable (manual review still happens); FNs are the concern.
  const tokens = prose.match(/\b[A-Z][a-zA-Z'-]+/g) ?? []
  const seen = new Set<string>()
  const leaks: string[] = []
  for (const t of tokens) {
    if (grounded.has(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    leaks.push(t)
  }
  return leaks
}

function isInDialogueOnly(prose: string, token: string): boolean {
  // Check every occurrence of token is inside a quoted span.
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

// Returns null if injection is valid; error string otherwise.
//
// Chapter-plan methodology note: PASS-side negative leak detection (trying
// to regex out all capitalized non-grounded tokens) is fundamentally too
// noisy — sentence-initial common nouns, pronouns, and atmospheric caps
// flood false positives. Trust the Sonnet labeler (Stage 4) to catch real
// PASS-side leaks. Stage 3 here only validates FAIL injections landed and
// FAIL_NEW_CHARACTER dialogue-only constraints held.
function validateInjection(prose: string, s: HallucScenario, v: VariantSpec): string | null {
  switch (v.type) {
    case "PASS_CLEAN":
    case "PASS_ANAPHORIC_GENERIC":
      return null    // trust Sonnet labeler at Stage 4
    case "PASS_LAST_NAME_ALIAS":
    case "PASS_TITLE_GROUNDED":
      if (!v.picked) return "picked_missing"
      if (!prose.includes(v.picked)) return `surname_absent:${v.picked}`
      return null
    case "PASS_REAL_WORLD_REF":
      if (!v.picked) return "picked_missing"
      if (!prose.toLowerCase().includes(v.picked.toLowerCase())) return `rw_ref_absent:${v.picked}`
      return null
    case "FAIL_NEW_CHARACTER": {
      if (!v.picked) return "picked_missing"
      if (!prose.includes(v.picked)) return `token_absent:${v.picked}`
      if (v.subcase === "dialogue-only" && !isInDialogueOnly(prose, v.picked)) {
        return `dialogue_only_violated:${v.picked}`
      }
      return null
    }
    case "FAIL_NEW_PLACE":
    case "FAIL_NEW_SYSTEM_OR_FACTION":
      if (!v.picked) return "picked_missing"
      if (!prose.includes(v.picked)) return `token_absent:${v.picked}`
      return null
    case "FAIL_CORPUS_LEAK":
      if (!v.picked) return "picked_missing"
      if (!prose.toLowerCase().includes(v.picked.toLowerCase())) return `leak_absent:${v.picked}`
      return null
    case "FAIL_FIRST_NEW_LAST":
      if (!v.picked) return "picked_missing"
      if (!prose.includes(v.picked)) return `drift_pair_absent:${v.picked}`
      return null
  }
}

// ── Training-pair builder ─────────────────────────────────────────────────

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
      scenario: s.id,
      variant: v.type,
      subcase: v.subcase ?? null,
      pass: v.pass,
      picked: v.picked,
      genre: s.genre,
      split: s.split,
    },
  }
}

// ── Scenarios (50) ────────────────────────────────────────────────────────
//
// Authored in scenarios-draft.ts (Stage 1, 2026-04-18). 50 entries, all
// distribution quotas met, all scenarios carry at least one First-Last
// speaker. See variant-taxonomy.md §"Scenario authoring".

import { SCENARIOS as DRAFT_SCENARIOS } from "./scenarios-draft"
export const SCENARIOS: HallucScenario[] = DRAFT_SCENARIOS

// ── Main ──────────────────────────────────────────────────────────────────

const CONCURRENCY = 10

async function main() {
  if (SCENARIOS.length === 0) {
    console.error("SCENARIOS[] is empty — Stage 1 authoring has not been run yet.")
    console.error("See variant-taxonomy.md §Scenario authoring.")
    process.exit(1)
  }

  // Pre-flight: every scenario must have a First Last speaker
  for (const s of SCENARIOS) {
    if (!firstLastSpeaker(s)) {
      console.error(`Scenario ${s.id} violates mandatory First Last speaker constraint.`)
      process.exit(1)
    }
  }

  const existingExpId = process.env.EXPERIMENT_ID ? Number(process.env.EXPERIMENT_ID) : null
  const expId = existingExpId ?? await createTuningExperiment(
    "data-generation",
    `Hallucination v2 prose generation — ${SCENARIOS.length} scenarios × 10 variants (${WRITER_PROVIDER}/${WRITER_MODEL})`,
    {
      scenarios: SCENARIOS.length,
      variants: 10,
      target_pairs: SCENARIOS.length * 10,
      writer_provider: WRITER_PROVIDER,
      writer_model: WRITER_MODEL,
      temperature: 0.8,
      out_suffix: OUT_SUFFIX,
      pool_sizes: Object.fromEntries(
        Object.entries(POOLS).filter(([k]) => k !== "__notes")
          .map(([k, v]) => [k, Array.isArray(v) ? (v as any[]).length : 0]),
      ),
    },
    { target: "hallucination-checker-v2", dimension: "data-gen" },
  )
  console.log(`Experiment id=${expId}`)

  if (existsSync(OUT_PATH)) {
    console.error(`${OUT_PATH} exists — refusing to overwrite. Move or delete first.`)
    process.exit(1)
  }
  writeFileSync(OUT_PATH, "")

  // Build task list
  const tasks: Array<{ s: HallucScenario; v: VariantSpec }> = []
  for (const s of SCENARIOS) for (const v of getVariants(s)) tasks.push({ s, v })
  console.log(`Generating ${tasks.length} pairs across ${SCENARIOS.length} scenarios`)

  let ok = 0, injFail = 0, genFail = 0
  const injByVariant: Record<string, number> = {}

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async ({ s, v }) => {
      try {
        const prose = await generateProse(s, v)
        const injErr = validateInjection(prose, s, v)
        return { s, v, prose, injErr, genErr: null as string | null }
      } catch (e: any) {
        return { s, v, prose: "", injErr: null, genErr: e.message ?? String(e) }
      }
    }))
    for (const r of results) {
      if (r.genErr) {
        genFail++
        console.log(`  [GEN FAIL] ${r.s.id}/${r.v.type}: ${r.genErr}`)
        continue
      }
      if (r.injErr) {
        injFail++
        injByVariant[r.v.type] = (injByVariant[r.v.type] ?? 0) + 1
        console.log(`  [INJ FAIL] ${r.s.id}/${r.v.type}: ${r.injErr}`)
        continue
      }
      appendFileSync(OUT_PATH, JSON.stringify(buildPair(r.s, r.v, r.prose)) + "\n")
      ok++
    }
    process.stdout.write(`  [${i + batch.length}/${tasks.length}] ok=${ok} inj_fail=${injFail} gen_fail=${genFail}\n`)
  }

  const summary = `Generated ${ok}/${tasks.length} pairs. Injection failures: ${injFail} (${JSON.stringify(injByVariant)}). Gen failures: ${genFail}. Output: ${OUT_PATH}`
  console.log(`\n${summary}`)
  await concludeExperiment(expId, summary)
  process.exit(0)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
