import type { ChapterOutline, CharacterProfile, SceneBeat, StorySpine, WorldBible } from "../types"
import { resolveAuthoringBiblePacks } from "./authoring-bible-packs"

export type AuthoringBibleMode = "off" | "v1"

export type AuthoringBibleRuleKind = "story" | "world" | "character" | "relationship" | "voice"

export interface AuthoringBibleRule {
  id: string
  kind: AuthoringBibleRuleKind
  title: string
  text: string
  appliesWhen: string
  source: string
  characterId?: string
  characterName?: string
  relatedCharacterName?: string
  selectionHints?: string[]
}

export interface AuthoringBiblePacket {
  mode: "authoring-bible-v1"
  genre: string
  packIds: string[]
  storyRules: AuthoringBibleRule[]
  worldRules: AuthoringBibleRule[]
  characterRules: AuthoringBibleRule[]
  relationshipRules: AuthoringBibleRule[]
  voiceRules: AuthoringBibleRule[]
}

export interface AuthoringBibleSlice {
  mode: "authoring-bible-slice-v1"
  sceneId?: string
  chapterNumber: number
  sceneNumber: number
  storyRules: AuthoringBibleRule[]
  worldRules: AuthoringBibleRule[]
  characterRules: AuthoringBibleRule[]
  relationshipRules: AuthoringBibleRule[]
  voiceRules: AuthoringBibleRule[]
}

export interface AuthoringBibleSliceTrace {
  mode: "authoring-bible-slice-v1"
  sceneId?: string
  chapterNumber: number
  sceneNumber: number
  ruleIds: string[]
  storyRuleIds: string[]
  worldRuleIds: string[]
  characterRuleIds: string[]
  relationshipRuleIds: string[]
  voiceRuleIds: string[]
  counts: {
    rules: number
    storyRules: number
    worldRules: number
    characterRules: number
    relationshipRules: number
    voiceRules: number
  }
}

export interface AuthoringBiblePack {
  id: string
  title: string
  description: string
  storyRules?: AuthoringBibleRule[]
  worldRules?: AuthoringBibleRule[]
  characterRules?: AuthoringBibleRule[]
  relationshipRules?: AuthoringBibleRule[]
  voiceRules?: AuthoringBibleRule[]
}

export type AuthoringBibleVerdict = "pass" | "miss" | "uncertain" | "not_applicable"
export type AuthoringBibleRepairLayer = "none" | "planning" | "character_bible" | "voice_bible" | "prose"

export interface AuthoringBibleBinaryGates {
  applicable: boolean | null
  proseEvidencePresent: boolean
  ruleSatisfied: boolean | null
  contradictionPresent: boolean
  evidenceSpecific: boolean
  judgeAbstained?: boolean
}

export interface AuthoringBibleGateReview {
  ruleId: string
  gates: AuthoringBibleBinaryGates
  repairLayer: AuthoringBibleRepairLayer
  evidence: {
    ruleText?: string
    proseMoment?: string
    mismatch?: string
    satisfaction?: string
  }
}

export interface AuthoringBibleGateOutcome extends AuthoringBibleGateReview {
  verdict: AuthoringBibleVerdict
}

export function buildAuthoringBiblePacket(args: {
  genre?: string
  worldBible?: WorldBible | null
  storySpine?: StorySpine | null
  characters: CharacterProfile[]
  packIds?: string[]
}): AuthoringBiblePacket {
  const genre = args.genre?.trim() ?? ""
  const packs = resolveAuthoringBiblePacks(args.packIds ?? [])
  return {
    mode: "authoring-bible-v1",
    genre,
    packIds: packs.map(pack => pack.id),
    storyRules: uniqueRules([
      ...buildStoryRules(genre, args.worldBible, args.storySpine),
      ...packs.flatMap(pack => pack.storyRules ?? []),
    ]),
    worldRules: uniqueRules([
      ...buildWorldRules(args.worldBible),
      ...packs.flatMap(pack => pack.worldRules ?? []),
    ]),
    characterRules: uniqueRules([
      ...args.characters.flatMap(buildCharacterRules),
      ...packs.flatMap(pack => pack.characterRules ?? []),
    ]),
    relationshipRules: uniqueRules([
      ...args.characters.flatMap(buildRelationshipRules),
      ...packs.flatMap(pack => pack.relationshipRules ?? []),
    ]),
    voiceRules: uniqueRules([
      ...buildVoiceRules(genre, args.worldBible),
      ...packs.flatMap(pack => pack.voiceRules ?? []),
    ]),
  }
}

export function selectAuthoringBibleSlice(args: {
  packet: AuthoringBiblePacket
  outline: ChapterOutline
  scene: SceneBeat
  sceneIndex: number
}): AuthoringBibleSlice | null {
  const { packet, outline, scene, sceneIndex } = args
  const sceneNames = [outline.povCharacter, ...(scene.characters ?? [])]
    .map(name => name?.trim() ?? "")
    .filter(Boolean)
  const sceneNameKeys = new Set(
    [outline.povCharacter, ...(scene.characters ?? [])]
      .map(name => cleanKey(name))
      .filter(Boolean),
  )
  const storyRules = packet.storyRules
    .filter(rule => storyRuleApplies(rule, scene, sceneIndex, outline.scenes.length))
    .slice(0, 4)
  const worldRules = packet.worldRules
    .filter(rule => worldRuleApplies(rule, scene))
    .slice(0, 5)
  const characterRules = packet.characterRules
    .filter(rule => nameAppearsInScene(rule.characterName, sceneNames, sceneNameKeys))
    .slice(0, 12)
  const relationshipRules = packet.relationshipRules
    .filter(rule =>
      nameAppearsInScene(rule.characterName, sceneNames, sceneNameKeys) &&
      nameAppearsInScene(rule.relatedCharacterName, sceneNames, sceneNameKeys)
    )
    .slice(0, 6)
  const voiceRules = packet.voiceRules.slice(0, 6)

  if (
    storyRules.length === 0 &&
    worldRules.length === 0 &&
    characterRules.length === 0 &&
    relationshipRules.length === 0 &&
    voiceRules.length === 0
  ) {
    return null
  }

  return {
    mode: "authoring-bible-slice-v1",
    ...(scene.sceneId ? { sceneId: scene.sceneId } : {}),
    chapterNumber: outline.chapterNumber,
    sceneNumber: sceneIndex + 1,
    storyRules,
    worldRules,
    characterRules,
    relationshipRules,
    voiceRules,
  }
}

export function renderAuthoringBibleSlice(slice: AuthoringBibleSlice): string {
  const sections = ["AUTHORING BIBLE SLICE:"]
  pushRuleSection(sections, "Story engine", slice.storyRules)
  pushRuleSection(sections, "World", slice.worldRules)
  pushRuleSection(sections, "Character", slice.characterRules)
  pushRuleSection(sections, "Relationship", slice.relationshipRules)
  pushRuleSection(sections, "Voice", slice.voiceRules)
  return sections.join("\n")
}

export function summarizeAuthoringBibleSlice(slice: AuthoringBibleSlice): AuthoringBibleSliceTrace {
  const storyRuleIds = slice.storyRules.map(rule => rule.id)
  const worldRuleIds = slice.worldRules.map(rule => rule.id)
  const characterRuleIds = slice.characterRules.map(rule => rule.id)
  const relationshipRuleIds = slice.relationshipRules.map(rule => rule.id)
  const voiceRuleIds = slice.voiceRules.map(rule => rule.id)
  const ruleIds = [
    ...storyRuleIds,
    ...worldRuleIds,
    ...characterRuleIds,
    ...relationshipRuleIds,
    ...voiceRuleIds,
  ]
  return {
    mode: "authoring-bible-slice-v1",
    ...(slice.sceneId ? { sceneId: slice.sceneId } : {}),
    chapterNumber: slice.chapterNumber,
    sceneNumber: slice.sceneNumber,
    ruleIds,
    storyRuleIds,
    worldRuleIds,
    characterRuleIds,
    relationshipRuleIds,
    voiceRuleIds,
    counts: {
      rules: ruleIds.length,
      storyRules: storyRuleIds.length,
      worldRules: worldRuleIds.length,
      characterRules: characterRuleIds.length,
      relationshipRules: relationshipRuleIds.length,
      voiceRules: voiceRuleIds.length,
    },
  }
}

export function deriveAuthoringBibleVerdict(gates: AuthoringBibleBinaryGates): AuthoringBibleVerdict {
  if (gates.applicable === false) return "not_applicable"
  if (gates.judgeAbstained || gates.applicable !== true) return "uncertain"
  if (!gates.proseEvidencePresent || !gates.evidenceSpecific || gates.ruleSatisfied === null) return "uncertain"
  if (gates.contradictionPresent) return "miss"
  return gates.ruleSatisfied ? "pass" : "miss"
}

export function deriveAuthoringBibleOutcome(review: AuthoringBibleGateReview): AuthoringBibleGateOutcome {
  return {
    ...review,
    verdict: deriveAuthoringBibleVerdict(review.gates),
  }
}

function buildStoryRules(
  genre: string,
  worldBible: WorldBible | null | undefined,
  storySpine: StorySpine | null | undefined,
): AuthoringBibleRule[] {
  const rules: AuthoringBibleRule[] = [
    {
      id: "story-rule:scene-pressure-consequence",
      kind: "story",
      title: "Scene pressure creates consequence",
      text: "Each load-bearing scene should convert pressure into an observable cost, changed option, relationship state, debt, threat, or next conflict.",
      appliesWhen: "Any scene with a declared goal, opposition, outcome, consequence, obligation, or chapter endpoint.",
      source: "authoring-bible-default",
    },
  ]
  const lowerGenre = genre.toLowerCase()
  if (/mercenary|guild|contract|adventure|progression|fantasy/.test(lowerGenre)) {
    rules.push(
      {
        id: "story-rule:mission-contract-loop",
        kind: "story",
        title: "Mission contract loop",
        text: "Keep the job, contract, bounty, guild pressure, patron demand, or mission objective active as operational pressure rather than background premise.",
        appliesWhen: "Scenes in a mission-based progression/adventure fantasy lane.",
        source: "genre-method:mercenary-progression-adventure",
      },
      {
        id: "story-rule:earned-progression-payoff",
        kind: "story",
        title: "Earned progression payoff",
        text: "Progression gains should be earned through a tactic, risk, sacrifice, discovery, ally shift, or consequence, not simply announced.",
        appliesWhen: "Scenes that use training, rank, skill, resource, salvage, magic, or tactical advancement.",
        source: "genre-method:mercenary-progression-adventure",
      },
      {
        id: "story-rule:faction-worldstate-consequence",
        kind: "story",
        title: "Faction/world-state consequence",
        text: "Mission outcomes should alter faction leverage, legal standing, reputation, resource access, or future danger.",
        appliesWhen: "Scenes that touch guild law, rank, patrons, rivals, salvage, contracts, or political/world systems.",
        source: "genre-method:mercenary-progression-adventure",
      },
    )
  }
  if (storySpine?.centralConflict) {
    rules.push({
      id: "story-rule:central-conflict-pressure",
      kind: "story",
      title: "Central conflict pressure",
      text: `Scene choices should remain legible against the central conflict: ${storySpine.centralConflict}`,
      appliesWhen: "Scenes that make a strategic choice, reveal, escalation, alliance, betrayal, or irreversible movement.",
      source: "story_spine.centralConflict",
    })
  }
  for (const system of (worldBible?.systems ?? []).slice(0, 3)) {
    const constraints = system.constraints?.filter(Boolean).join("; ")
    const ruleText = constraints
      ? `${system.name} should constrain available options through: ${constraints}`
      : `${system.name} should affect choices as an active ${system.type} system, not only as terminology.`
    rules.push({
      id: `story-rule:world-system:${slug(system.id || system.name)}`,
      kind: "story",
      title: `${system.name} pressure`,
      text: ruleText,
      appliesWhen: `Scenes using ${system.name}, its institutions, rules, vocabulary, or practitioners.`,
      source: "world_bible.systems",
      selectionHints: worldSystemSelectionHints(system),
    })
  }
  return uniqueRules(rules)
}

function buildWorldRules(
  worldBible: WorldBible | null | undefined,
): AuthoringBibleRule[] {
  const rules: AuthoringBibleRule[] = []
  for (const system of (worldBible?.systems ?? []).slice(0, 4)) {
    const constraints = system.constraints?.filter(Boolean).join("; ")
    const vocabulary = system.vocabulary?.filter(Boolean).join(", ")
    rules.push({
      id: `world-rule:system:${slug(system.id || system.name)}`,
      kind: "world",
      title: `${system.name} operational pressure`,
      text: [
        `${system.name} should change what characters can try, risk, prove, buy, enter, claim, or survive.`,
        constraints ? `Constraints: ${constraints}.` : "",
        vocabulary ? `Use vocabulary only when it has consequence: ${vocabulary}.` : "",
      ].filter(Boolean).join(" "),
      appliesWhen: `Scenes invoking ${system.name}, its institutions, vocabulary, practitioners, law, resources, or consequences.`,
      source: "world_bible.systems",
      selectionHints: worldSystemSelectionHints(system),
    })
  }
  if (worldBible?.sensoryPalette) {
    rules.push({
      id: "world-rule:sensory-palette-operational",
      kind: "world",
      title: "Operational sensory palette",
      text: `World texture should carry pressure, not wallpaper. Sensory palette: ${worldBible.sensoryPalette}`,
      appliesWhen: "Scenes that ground location, danger, travel, combat, work, rank, law, magic, or fatigue.",
      source: "world_bible.sensoryPalette",
    })
  }
  return uniqueRules(rules)
}

function buildCharacterRules(character: CharacterProfile): AuthoringBibleRule[] {
  const rules: AuthoringBibleRule[] = []
  const driver = [
    character.want ? `want=${character.want}` : "",
    character.need ? `need=${character.need}` : "",
    character.goals ? `goals=${character.goals}` : "",
    character.fears ? `fears=${character.fears}` : "",
    character.avoids ? `avoids=${character.avoids}` : "",
    character.internalConflict ? `conflict=${character.internalConflict}` : "",
  ].filter(Boolean).join("; ")
  if (driver) {
    rules.push({
      id: `char-rule:${slug(character.id)}:driver`,
      kind: "character",
      title: `${character.name} driver`,
      text: `Under scene pressure, ${character.name}'s choices, tactics, refusals, or concessions should reflect ${driver}.`,
      appliesWhen: `${character.name} is POV, present, obligated, or materially affects the scene.`,
      source: "characters.profile_json",
      characterId: character.id,
      characterName: character.name,
    })
  }
  const arc = [
    character.lie ? `lie=${character.lie}` : "",
    character.truth ? `truth=${character.truth}` : "",
    character.arc_resolution ? `arc=${character.arc_resolution}` : "",
  ].filter(Boolean).join("; ")
  if (arc) {
    rules.push({
      id: `char-rule:${slug(character.id)}:arc`,
      kind: "character",
      title: `${character.name} arc pressure`,
      text: `${character.name}'s scene behavior should create pressure around ${arc}; the scene does not need to resolve the arc, but it should not flatten or contradict it.`,
      appliesWhen: `${character.name} makes, resists, witnesses, or pays for a meaningful choice.`,
      source: "characters.profile_json",
      characterId: character.id,
      characterName: character.name,
    })
  }
  if (character.speechPattern || character.exampleLines?.length) {
    const sample = character.exampleLines?.[0] ? ` Example: "${character.exampleLines[0].replace(/^"|"$/g, "")}"` : ""
    rules.push({
      id: `char-rule:${slug(character.id)}:voice`,
      kind: "character",
      title: `${character.name} dialogue posture`,
      text: `${character.name}'s dialogue/interiority should preserve this voice posture: ${character.speechPattern || "use character-specific phrasing."}${sample}`,
      appliesWhen: `${character.name} speaks, thinks, bargains, refuses, confesses, threatens, jokes, or judges another character.`,
      source: "characters.profile_json",
      characterId: character.id,
      characterName: character.name,
    })
  }
  return rules
}

function buildRelationshipRules(character: CharacterProfile): AuthoringBibleRule[] {
  return (character.relationships ?? []).flatMap(rel => {
    const related = rel.characterName?.trim()
    const nature = rel.nature?.trim()
    if (!related || !nature) return []
    return [{
      id: `rel-rule:${slug(character.name)}:${slug(related)}`,
      kind: "relationship" as const,
      title: `${character.name} / ${related}`,
      text: `When ${character.name} and ${related} share scene pressure, their interaction should preserve or intentionally shift this relationship posture: ${nature}.`,
      appliesWhen: `Both ${character.name} and ${related} are present, referenced, or the scene changes their trust, leverage, debt, rivalry, intimacy, or obligation.`,
      source: "characters.profile_json.relationships",
      characterId: character.id,
      characterName: character.name,
      relatedCharacterName: related,
    }]
  })
}

function buildVoiceRules(genre: string, worldBible: WorldBible | null | undefined): AuthoringBibleRule[] {
  const lowerGenre = genre.toLowerCase()
  const rules: AuthoringBibleRule[] = [
    {
      id: "voice-rule:close-pov-tactical",
      kind: "voice",
      title: "Close tactical POV",
      text: "Keep prose anchored in what the POV can perceive, decide, risk, and misread; prefer concrete pressure and tactical implication over essay-like explanation.",
      appliesWhen: "All drafted scenes.",
      source: "authoring-bible-default",
    },
    {
      id: "voice-rule:cost-over-abstraction",
      kind: "voice",
      title: "Cost over abstraction",
      text: "Express stakes through visible cost, changed leverage, bodily risk, resource loss, reputation, or relationship pressure before abstract summary.",
      appliesWhen: "Scenes with danger, choices, social pressure, progression, or consequences.",
      source: "authoring-bible-default",
    },
  ]
  if (/fantasy|magic|progression|adventure/.test(lowerGenre) || worldBible?.sensoryPalette) {
    const sensory = worldBible?.sensoryPalette ? ` Sensory palette: ${worldBible.sensoryPalette}` : ""
    rules.push({
      id: "voice-rule:fantasy-specificity",
      kind: "voice",
      title: "Fantasy specificity",
      text: `Make world terms, magic, rank, salvage, guild law, or factions concrete through action, constraint, texture, and consequence.${sensory}`,
      appliesWhen: "Scenes invoking world systems, location texture, progression, law, rank, or factions.",
      source: "genre/world_bible",
    })
  }
  return rules
}

function storyRuleApplies(
  rule: AuthoringBibleRule,
  scene: SceneBeat,
  sceneIndex: number,
  totalScenes: number,
): boolean {
  if (rule.id === "story-rule:scene-pressure-consequence") return true
  const text = sceneSearchText(scene)
  if (rule.selectionHints?.length) return selectionHintsMatch(rule.selectionHints, text)
  if (rule.id === "story-rule:mission-contract-loop") {
    return /contract|guild|job|mission|bounty|patron|rank|salvage|witness|debt|toll/.test(text)
  }
  if (rule.id === "story-rule:earned-progression-payoff") {
    const resultText = normalizeSearchText([
      scene.turningPoint,
      scene.outcome,
      scene.consequence,
    ].filter(Boolean).join(" "))
    if (/\b(no|without)\s+(rank|progress|gain|gains|promotion|new tactic)|\bnot\s+(gain|gained|earned)/u.test(resultText)) {
      return false
    }
    return /skill|progress|learn|train|core|salvage|resource|magic|tactic|trial|gain|iron thread|iron-thread|rank/.test(text) &&
      /earn|earned|gain|gains|learn|learns|unlock|use|uses|promot|advance|survive|sacrifice|cost|discovers|tactic|iron thread|salvage/.test(resultText)
  }
  if (rule.id === "story-rule:faction-worldstate-consequence") {
    return /guild|faction|rank|law|patron|buyer|rival|contract|standing|reputation|witness/.test(text)
  }
  if (rule.id === "story-rule:central-conflict-pressure") return sceneIndex === 0 || sceneIndex === totalScenes - 1 || Boolean(scene.outcome || scene.consequence)
  if (rule.id.startsWith("story-rule:world-system:")) {
    const systemName = rule.title.replace(/\s+pressure$/u, "").toLowerCase()
    return text.includes(systemName) || systemName.split(/\s+/u).some(part => part.length > 3 && text.includes(part))
  }
  return true
}

function worldRuleApplies(rule: AuthoringBibleRule, scene: SceneBeat): boolean {
  const text = sceneSearchText(scene)
  if (rule.id === "world-rule:sensory-palette-operational") return true
  if (rule.selectionHints?.length) return selectionHintsMatch(rule.selectionHints, text)
  const titleTerms = rule.title
    .toLowerCase()
    .replace(/\b(operational|pressure|world|rule|system)\b/gu, "")
    .split(/[^a-z0-9]+/u)
    .filter(term => term.length > 3)
  if (titleTerms.length === 0) return true
  return titleTerms.every(term => text.includes(term))
}

function pushRuleSection(lines: string[], label: string, rules: AuthoringBibleRule[]): void {
  if (rules.length === 0) return
  lines.push(`${label}:`)
  for (const rule of rules) {
    lines.push(`- [${rule.id}] ${rule.text}`)
  }
}

function uniqueRules(rules: AuthoringBibleRule[]): AuthoringBibleRule[] {
  const seen = new Set<string>()
  const out: AuthoringBibleRule[] = []
  for (const rule of rules) {
    if (seen.has(rule.id)) continue
    seen.add(rule.id)
    out.push(rule)
  }
  return out
}

function cleanKey(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? ""
}

function sceneSearchText(scene: SceneBeat): string {
  const obligations = scene.obligations
  return normalizeSearchText([
    scene.description,
    scene.goal,
    scene.opposition,
    scene.turningPoint,
    scene.outcome,
    scene.consequence,
    scene.placeAnchor,
    scene.temporalAnchor,
    ...(scene.characters ?? []),
    ...flattenSearchItems(obligations?.mustEstablish),
    ...flattenSearchItems(obligations?.mustPayOff),
    ...flattenSearchItems(obligations?.mustTransferKnowledge),
    ...flattenSearchItems(obligations?.mustShowStateChange),
    ...flattenSearchItems(obligations?.mustNotReveal),
    ...flattenSearchItems(obligations?.allowedNewEntities),
  ].filter(Boolean).join(" "))
}

function flattenSearchItems(values: unknown[] | undefined): string[] {
  return (values ?? []).flatMap(value => {
    if (typeof value === "string") return [value]
    if (value && typeof value === "object") {
      return Object.values(value as Record<string, unknown>)
        .filter((entry): entry is string => typeof entry === "string")
    }
    return []
  })
}

function normalizeSearchText(value: string): string {
  return ` ${value
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()} `
}

function selectionHintsMatch(hints: readonly string[], normalizedText: string): boolean {
  return hints.some(hint => selectionHintMatches(hint, normalizedText))
}

function selectionHintMatches(hint: string, normalizedText: string): boolean {
  const clean = normalizeSearchText(hint).trim()
  if (!clean) return false
  const terms = clean.split(/\s+/u).filter(Boolean)
  if (terms.length >= 2) return normalizedText.includes(` ${clean} `)
  const term = terms[0]
  if (!term || weakSingleHintTerms.has(term)) return false
  return normalizedText.includes(` ${term} `)
}

const weakSingleHintTerms = new Set([
  "cost",
  "law",
  "line",
  "paper",
  "pressure",
  "proof",
  "standing",
  "trigger",
])

function worldSystemSelectionHints(system: NonNullable<WorldBible["systems"]>[number]): string[] {
  const id = slug(system.id || system.name)
  const lower = `${system.id ?? ""} ${system.name}`.toLowerCase()
  if (id.includes("brine-ward") || lower.includes("brine ward")) {
    return uniqueStrings([
      system.name,
      "brine ward",
      "brine wards",
      "ward line",
      "salt bloom",
      "brine cloud",
      "chemical seal",
      "mine wall",
      "inscribed symbol",
      "stolen core",
    ])
  }
  if (id.includes("iron-thread") || lower.includes("iron thread")) {
    return uniqueStrings([
      system.name,
      "iron thread",
      "iron-thread",
      "thread binding",
      "pressure draw",
      "brine hook",
      "monster pressure",
      "body heat",
      "internal bruising",
    ])
  }
  if (id.includes("debt-market") || lower.includes("debt market")) {
    return uniqueStrings([
      system.name,
      "debt market",
      "debt board",
      "debt marker",
      "marker",
      "sale date",
      "creditor",
      "protection",
    ])
  }
  if (id.includes("guild-rank") || lower.includes("guild rank")) {
    return uniqueStrings([
      system.name,
      "guild rank",
      "rank law",
      "rank token",
      "bronze token",
      "silver seal",
      "gold badge",
      "witness",
      "contract rights",
      "rank promotion",
    ])
  }
  if (id.includes("guild-law") || lower.includes("guild law")) {
    return uniqueStrings([
      system.name,
      "guild law",
      "guild contract",
      "contract",
      "witness",
      "witnessed contract",
      "unwitnessed",
      "salvage rights",
      "ranked contract",
    ])
  }
  return uniqueStrings([
    system.name,
    system.id?.replace(/[_-]+/gu, " "),
    ...(system.vocabulary ?? []),
    ...(system.manifestations ?? []),
  ].filter((value): value is string => Boolean(value?.trim())))
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function nameAppearsInScene(
  value: string | undefined | null,
  sceneNames: readonly string[],
  sceneNameKeys: ReadonlySet<string>,
): boolean {
  const key = cleanKey(value)
  if (!key) return false
  if (sceneNameKeys.has(key)) return true
  const parts = key.split(/\s+/u).filter(part => part.length > 1)
  for (const sceneName of sceneNames) {
    const sceneKey = cleanKey(sceneName)
    if (!sceneKey) continue
    if (key.includes(sceneKey) || sceneKey.includes(key)) return true
    if (parts.some(part => sceneKey === part || sceneKey.includes(part))) return true
  }
  return false
}

function slug(value: string): string {
  const clean = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return clean || "unknown"
}
