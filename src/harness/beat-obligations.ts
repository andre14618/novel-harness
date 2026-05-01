import type { ChapterOutline, SceneBeat } from "../types"

export type BeatObligationKind =
  | "establish"
  | "payoff"
  | "knowledge"
  | "state"
  | "avoid"

export type BeatObligationConfidence = "explicit" | "inferred"

export interface BeatObligationItem {
  kind: BeatObligationKind
  text: string
  confidence: BeatObligationConfidence
  source: string
  factId?: string
  characterName?: string
  seededAtBeat?: number
}

export interface BeatObligations {
  mustEstablish: BeatObligationItem[]
  mustPayOff: BeatObligationItem[]
  mustTransferKnowledge: BeatObligationItem[]
  mustShowStateChange: BeatObligationItem[]
  mustNotReveal: BeatObligationItem[]
  allowedNewEntities: string[]
}

export interface BeatObligationShadowPlan {
  beats: BeatObligations[]
  warnings: string[]
  summary: {
    factCount: number
    knowledgeCount: number
    stateChangeCount: number
    orphanFacts: number
    orphanKnowledgeChanges: number
    orphanStateChanges: number
    overloadedBeats: number
  }
}

const EMPTY_OBLIGATIONS = (): BeatObligations => ({
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
})

const STOPWORDS = new Set([
  "about", "after", "again", "against", "being", "before", "chapter", "could",
  "every", "from", "have", "into", "must", "only", "over", "that", "their",
  "there", "they", "this", "through", "under", "when", "where", "while", "with",
  "would",
])

export function deriveBeatObligations(outline: ChapterOutline): BeatObligationShadowPlan {
  const beats = outline.scenes.map(() => EMPTY_OBLIGATIONS())
  const warnings: string[] = []
  const factAssignments = new Map<string, Set<number>>()
  const factById = new Map((outline.establishedFacts ?? [])
    .filter(f => f.id?.trim())
    .map(f => [f.id.trim(), f.fact]))

  for (let beatIndex = 0; beatIndex < outline.scenes.length; beatIndex++) {
    const beat = outline.scenes[beatIndex]
    beats[beatIndex].allowedNewEntities = deriveAllowedNewEntities(beat, outline)

    for (const link of beat.requiredPayoffs ?? []) {
      const factId = link.fact_id?.trim()
      const fact = factId ? factById.get(factId) : null
      if (!factId || !fact) continue

      addObligation(beats[beatIndex].mustEstablish, {
        kind: "establish",
        text: fact,
        confidence: "explicit",
        source: "requiredPayoffs.seed",
        factId,
      })
      assignFact(factAssignments, factId, beatIndex)

      if (Number.isInteger(link.payoff_beat) && link.payoff_beat >= 0 && link.payoff_beat < beats.length) {
        addObligation(beats[link.payoff_beat].mustPayOff, {
          kind: "payoff",
          text: fact,
          confidence: "explicit",
          source: "requiredPayoffs.payoff",
          factId,
          seededAtBeat: beatIndex,
        })
        assignFact(factAssignments, factId, link.payoff_beat)
      }
    }
  }

  for (const fact of outline.establishedFacts ?? []) {
    const factId = fact.id?.trim()
    if (!factId || factAssignments.has(factId)) continue

    const match = bestBeatMatch(outline.scenes, fact.fact, { minScore: 2, minCoverage: 0.25 })
    if (match) {
      addObligation(beats[match.beatIndex].mustEstablish, {
        kind: "establish",
        text: fact.fact,
        confidence: "inferred",
        source: "establishedFacts.text-match",
        factId,
      })
      assignFact(factAssignments, factId, match.beatIndex)
    } else {
      warnings.push(`Chapter ${outline.chapterNumber}: establishedFact "${factId}" is not assigned to any beat obligation`)
    }
  }

  let orphanKnowledgeChanges = 0
  for (const change of outline.knowledgeChanges ?? []) {
    const match = bestBeatMatch(outline.scenes, change.knowledge, {
      characterName: change.characterName,
      minScore: 2,
      minCoverage: 0.25,
    })
    if (match) {
      addObligation(beats[match.beatIndex].mustTransferKnowledge, {
        kind: "knowledge",
        text: change.knowledge,
        confidence: "inferred",
        source: "knowledgeChanges.text-match",
        characterName: change.characterName,
      })
    } else {
      orphanKnowledgeChanges++
      warnings.push(`Chapter ${outline.chapterNumber}: knowledgeChange for "${change.characterName}" is not assigned to any beat obligation`)
    }
  }

  let orphanStateChanges = 0
  for (const change of outline.characterStateChanges ?? []) {
    const text = [
      change.location,
      change.emotionalState,
      ...(change.knows ?? []),
    ].filter(Boolean).join(" ")
    if (!text.trim()) continue

    const match = bestBeatMatch(outline.scenes, text, {
      characterName: change.name,
      minScore: 2,
      minCoverage: 0.2,
    })
    if (match) {
      addObligation(beats[match.beatIndex].mustShowStateChange, {
        kind: "state",
        text: summarizeStateChange(change),
        confidence: "inferred",
        source: "characterStateChanges.text-match",
        characterName: change.name,
      })
    } else {
      orphanStateChanges++
      warnings.push(`Chapter ${outline.chapterNumber}: characterStateChange for "${change.name}" is not assigned to any beat obligation`)
    }
  }

  let overloadedBeats = 0
  for (let i = 0; i < beats.length; i++) {
    const hardCount = countHardObligations(beats[i])
    if (hardCount > 5) {
      overloadedBeats++
      warnings.push(`Chapter ${outline.chapterNumber} beat ${i + 1}: ${hardCount} inferred/explicit obligations may overload the writer`)
    }
  }

  return {
    beats,
    warnings,
    summary: {
      factCount: outline.establishedFacts?.length ?? 0,
      knowledgeCount: outline.knowledgeChanges?.length ?? 0,
      stateChangeCount: outline.characterStateChanges?.length ?? 0,
      orphanFacts: (outline.establishedFacts ?? []).filter(f => f.id?.trim() && !factAssignments.has(f.id.trim())).length,
      orphanKnowledgeChanges,
      orphanStateChanges,
      overloadedBeats,
    },
  }
}

export function renderBeatObligations(obligations: BeatObligations): string {
  const sections: string[] = []
  pushSection(sections, "Must establish", obligations.mustEstablish)
  pushSection(sections, "Must pay off", obligations.mustPayOff)
  pushSection(sections, "Must transfer knowledge", obligations.mustTransferKnowledge)
  pushSection(sections, "Must show state change", obligations.mustShowStateChange)
  pushSection(sections, "Must not reveal", obligations.mustNotReveal)
  if (obligations.allowedNewEntities.length > 0) {
    sections.push(`Allowed new named entities:\n${obligations.allowedNewEntities.map(e => `- ${e}`).join("\n")}`)
  }
  if (sections.length === 0) return ""
  return `BEAT OBLIGATIONS:\n${sections.join("\n\n")}`
}

function pushSection(sections: string[], title: string, items: BeatObligationItem[]): void {
  if (items.length === 0) return
  sections.push(`${title}:\n${items.map(item => `- ${item.text}`).join("\n")}`)
}

function addObligation(items: BeatObligationItem[], item: BeatObligationItem): void {
  if (items.some(existing => existing.kind === item.kind && existing.text === item.text && existing.characterName === item.characterName)) return
  items.push(item)
}

function assignFact(assignments: Map<string, Set<number>>, factId: string, beatIndex: number): void {
  const existing = assignments.get(factId) ?? new Set<number>()
  existing.add(beatIndex)
  assignments.set(factId, existing)
}

function bestBeatMatch(
  scenes: SceneBeat[],
  targetText: string,
  opts: { characterName?: string; minScore: number; minCoverage: number },
): { beatIndex: number; score: number; coverage: number } | null {
  const targetTokens = meaningfulTokens(targetText)
  if (targetTokens.length === 0) return null

  let best: { beatIndex: number; score: number; coverage: number } | null = null
  for (let i = 0; i < scenes.length; i++) {
    const beat = scenes[i]
    if (opts.characterName && !beatIncludesCharacter(beat, opts.characterName)) continue
    const beatTokens = new Set(meaningfulTokens(`${beat.description} ${beat.characters.join(" ")}`))
    let score = 0
    for (const token of targetTokens) if (beatTokens.has(token)) score++
    const coverage = score / targetTokens.length
    if (score < opts.minScore || coverage < opts.minCoverage) continue
    if (!best || score > best.score || (score === best.score && coverage > best.coverage)) {
      best = { beatIndex: i, score, coverage }
    }
  }
  return best
}

function meaningfulTokens(text: string): string[] {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? []) {
    const token = raw.replace(/[’']/g, "")
    if (token.length < 4 || STOPWORDS.has(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
  }
  return tokens
}

function beatIncludesCharacter(beat: SceneBeat, characterName: string): boolean {
  const normalized = characterName.toLowerCase()
  return beat.characters.some(name => name.toLowerCase() === normalized || normalized.includes(name.toLowerCase()) || name.toLowerCase().includes(normalized))
}

function summarizeStateChange(change: { location?: string; emotionalState?: string; knows?: string[] }): string {
  const parts: string[] = []
  if (change.location) parts.push(`location: ${change.location}`)
  if (change.emotionalState) parts.push(`state: ${change.emotionalState}`)
  if (change.knows?.length) parts.push(`knows: ${change.knows.join("; ")}`)
  return parts.join("; ")
}

function countHardObligations(obligations: BeatObligations): number {
  return obligations.mustEstablish.length
    + obligations.mustPayOff.length
    + obligations.mustTransferKnowledge.length
    + obligations.mustShowStateChange.length
}

function deriveAllowedNewEntities(beat: SceneBeat, outline: ChapterOutline): string[] {
  const known = new Set([
    ...beat.characters,
    outline.povCharacter,
    outline.setting,
  ].filter(Boolean).map(v => v.toLowerCase()))
  const entities = extractProperNouns(beat.description)
  return entities.filter(entity => !known.has(entity.toLowerCase()))
}

function extractProperNouns(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of text.matchAll(/\b[A-Z][A-Za-z'’-]*(?:\s+(?:of|the|and|de|la|le|du|von|'s|[A-Z][A-Za-z'’-]*))*\b/g)) {
    const value = match[0].trim()
    if (value.length < 3 || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}
