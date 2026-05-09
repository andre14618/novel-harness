import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"

export interface WriterCharacterContextCard {
  characterId: string
  name: string
  role: string
  sceneRole: "pov" | "supporting"
  want?: string
  need?: string
  lie?: string
  truth?: string
  drives?: string
  fears?: string
  avoids?: string
  conflict?: string
  voice?: string
  state?: string
  sourceObligationIds: string[]
  activeThreadIds: string[]
  activePromiseIds: string[]
  activePayoffIds: string[]
}

export interface WriterCharacterContextCapsules {
  mode: "thread-character-context-v1"
  scope: "beat" | "chapter"
  chapterId?: string
  beatId?: string
  beatNumber?: number
  povCharacterId?: string
  povPersonalStake?: string
  activeThreadIds: string[]
  activePromiseIds: string[]
  activePayoffIds: string[]
  cards: WriterCharacterContextCard[]
  missingCharacterIds: string[]
}

export interface WriterCharacterContextTrace {
  mode: "thread-character-context-v1"
  scope: "beat" | "chapter"
  chapterId?: string
  beatId?: string
  beatNumber?: number
  povCharacterId?: string
  povPersonalStakePresent: boolean
  characterIds: string[]
  sourceObligationIds: string[]
  activeThreadIds: string[]
  activePromiseIds: string[]
  activePayoffIds: string[]
  missingCharacterIds: string[]
}

type ObligationItem = {
  text?: string
  obligationId?: string
  sourceId?: string
  characterId?: string
  characterName?: string
  threadId?: string
  promiseId?: string
  payoffId?: string
}

export function buildBeatCharacterContextCapsules(args: {
  outline: ChapterOutline
  beat: SceneBeat
  beatIndex: number
  characters: CharacterProfile[]
  characterStates: any[]
}): WriterCharacterContextCapsules | null {
  const { outline, beat, beatIndex, characters, characterStates } = args
  const obligations = collectBeatObligations(beat)
  const selected = selectBeatCharacterIds({ outline, beat, obligations, characters })
  const activeRefs = collectActiveStoryRefs(obligations)
  const cards = selected.ids
    .map(characterId => {
      const character = characters.find(c => c.id === characterId)
      if (!character) return null
      return buildCharacterCard(character, {
        povCharacterId: outline.povCharacterId,
        obligations,
        characterStates,
      })
    })
    .filter((card): card is WriterCharacterContextCard => Boolean(card))

  const povPersonalStake = cleanString(beat.povPersonalStake)
  if (cards.length === 0 && !povPersonalStake && !hasActiveStoryRefs(activeRefs)) return null

  return {
    mode: "thread-character-context-v1",
    scope: "beat",
    ...(outline.chapterId ? { chapterId: outline.chapterId } : {}),
    ...(beat.beatId ? { beatId: beat.beatId } : {}),
    beatNumber: beatIndex + 1,
    ...(outline.povCharacterId ? { povCharacterId: outline.povCharacterId } : {}),
    ...(povPersonalStake ? { povPersonalStake } : {}),
    ...activeRefs,
    cards,
    missingCharacterIds: selected.missingCharacterIds,
  }
}

export function buildChapterCharacterContextCapsules(args: {
  outline: ChapterOutline
  relevantCharacters: CharacterProfile[]
  allCharacters: CharacterProfile[]
  characterStates: any[]
}): WriterCharacterContextCapsules | null {
  const { outline, relevantCharacters, allCharacters, characterStates } = args
  const obligations = outline.scenes.flatMap(collectBeatObligations)
  const activeRefs = collectActiveStoryRefs(obligations)
  const selectedIds = uniqueStrings([
    outline.povCharacterId ?? "",
    ...outline.charactersPresentIds,
    ...relevantCharacters.map(c => c.id),
    ...obligations.map(o => o.characterId ?? "").filter(Boolean),
  ])
  const missingCharacterIds = selectedIds.filter(id => !allCharacters.some(c => c.id === id))
  const cards = selectedIds
    .map(characterId => {
      const character = allCharacters.find(c => c.id === characterId)
      if (!character) return null
      return buildCharacterCard(character, {
        povCharacterId: outline.povCharacterId,
        obligations,
        characterStates,
      })
    })
    .filter((card): card is WriterCharacterContextCard => Boolean(card))

  if (cards.length === 0 && !hasActiveStoryRefs(activeRefs)) return null

  return {
    mode: "thread-character-context-v1",
    scope: "chapter",
    ...(outline.chapterId ? { chapterId: outline.chapterId } : {}),
    ...(outline.povCharacterId ? { povCharacterId: outline.povCharacterId } : {}),
    ...activeRefs,
    cards,
    missingCharacterIds,
  }
}

export function renderCharacterContextCapsules(ctx: WriterCharacterContextCapsules): string {
  const lines = ["CHARACTER CONTEXT CAPSULES:"]
  const activeThreadIds = ctx.activeThreadIds ?? []
  const activePromiseIds = ctx.activePromiseIds ?? []
  const activePayoffIds = ctx.activePayoffIds ?? []
  lines.push(`Mode: ${ctx.mode}`)
  lines.push(`Scope: ${ctx.scope}`)
  if (ctx.chapterId) lines.push(`Chapter ID: ${ctx.chapterId}`)
  if (ctx.beatId) lines.push(`Beat ID: ${ctx.beatId}`)
  if (ctx.beatNumber != null) lines.push(`Beat number: ${ctx.beatNumber}`)
  if (ctx.povCharacterId) lines.push(`POV character ID: ${ctx.povCharacterId}`)
  if (ctx.povPersonalStake) lines.push(`POV personal stake: ${ctx.povPersonalStake}`)
  if (activeThreadIds.length > 0) lines.push(`Active thread refs: ${activeThreadIds.join(", ")}`)
  if (activePromiseIds.length > 0) lines.push(`Active promise refs: ${activePromiseIds.join(", ")}`)
  if (activePayoffIds.length > 0) lines.push(`Active payoff refs: ${activePayoffIds.join(", ")}`)
  if (ctx.missingCharacterIds.length > 0) lines.push(`Missing character IDs: ${ctx.missingCharacterIds.join(", ")}`)

  for (const card of ctx.cards) {
    lines.push("")
    lines.push(`- ${card.name} [${card.characterId}] (${card.sceneRole}; ${card.role})`)
    if (card.want) lines.push(`  Want: ${card.want}`)
    if (card.need) lines.push(`  Need: ${card.need}`)
    if (card.lie) lines.push(`  Lie: ${card.lie}`)
    if (card.truth) lines.push(`  Truth: ${card.truth}`)
    if (card.drives) lines.push(`  Drives: ${card.drives}`)
    if (card.fears) lines.push(`  Fears: ${card.fears}`)
    if (card.avoids) lines.push(`  Avoids: ${card.avoids}`)
    if (card.conflict) lines.push(`  Conflict: ${card.conflict}`)
    if (card.voice) lines.push(`  Voice: ${card.voice}`)
    if (card.state) lines.push(`  State: ${card.state}`)
    if (card.sourceObligationIds.length > 0) lines.push(`  Source obligations: ${card.sourceObligationIds.join(", ")}`)
    if (card.activeThreadIds.length > 0) lines.push(`  Active threads: ${card.activeThreadIds.join(", ")}`)
    if (card.activePromiseIds.length > 0) lines.push(`  Active promises: ${card.activePromiseIds.join(", ")}`)
    if (card.activePayoffIds.length > 0) lines.push(`  Active payoffs: ${card.activePayoffIds.join(", ")}`)
  }

  return lines.join("\n")
}

export function summarizeCharacterContextCapsules(ctx: WriterCharacterContextCapsules): WriterCharacterContextTrace {
  const activeThreadIds = ctx.activeThreadIds ?? []
  const activePromiseIds = ctx.activePromiseIds ?? []
  const activePayoffIds = ctx.activePayoffIds ?? []
  return {
    mode: ctx.mode,
    scope: ctx.scope,
    ...(ctx.chapterId ? { chapterId: ctx.chapterId } : {}),
    ...(ctx.beatId ? { beatId: ctx.beatId } : {}),
    ...(ctx.beatNumber != null ? { beatNumber: ctx.beatNumber } : {}),
    ...(ctx.povCharacterId ? { povCharacterId: ctx.povCharacterId } : {}),
    povPersonalStakePresent: Boolean(ctx.povPersonalStake),
    characterIds: ctx.cards.map(card => card.characterId),
    sourceObligationIds: uniqueStrings(ctx.cards.flatMap(card => card.sourceObligationIds)),
    activeThreadIds: uniqueStrings([...activeThreadIds, ...ctx.cards.flatMap(card => card.activeThreadIds)]),
    activePromiseIds: uniqueStrings([...activePromiseIds, ...ctx.cards.flatMap(card => card.activePromiseIds)]),
    activePayoffIds: uniqueStrings([...activePayoffIds, ...ctx.cards.flatMap(card => card.activePayoffIds)]),
    missingCharacterIds: ctx.missingCharacterIds,
  }
}


function selectBeatCharacterIds(args: {
  outline: ChapterOutline
  beat: SceneBeat
  obligations: ObligationItem[]
  characters: CharacterProfile[]
}): { ids: string[]; missingCharacterIds: string[] } {
  const { outline, beat, obligations, characters } = args
  const ids: string[] = []
  const missingCharacterIds: string[] = []
  const byName = new Map(characters.map(c => [c.name.toLowerCase(), c]))
  const byId = new Map(characters.map(c => [c.id, c]))

  const addId = (id: string | undefined) => {
    const clean = cleanString(id)
    if (!clean) return
    ids.push(clean)
    if (!byId.has(clean)) missingCharacterIds.push(clean)
  }
  const addName = (name: string | undefined) => {
    const clean = cleanString(name)
    if (!clean) return
    const match = byName.get(clean.toLowerCase())
    if (match) ids.push(match.id)
  }

  addId(outline.povCharacterId)
  addName(outline.povCharacter)
  for (const name of beat.characters) addName(name)
  for (const obligation of obligations) {
    addId(obligation.characterId)
    addName(obligation.characterName)
    if (obligation.sourceId && byId.has(obligation.sourceId)) addId(obligation.sourceId)
  }

  if (ids.length === 0) {
    for (const id of outline.charactersPresentIds) addId(id)
  }

  return {
    ids: uniqueStrings(ids).filter(id => byId.has(id)),
    missingCharacterIds: uniqueStrings(missingCharacterIds),
  }
}

function buildCharacterCard(
  character: CharacterProfile,
  args: { povCharacterId?: string; obligations: ObligationItem[]; characterStates: any[] },
): WriterCharacterContextCard {
  const { povCharacterId, obligations, characterStates } = args
  const sourceObligations = obligations.filter(obligation =>
    obligation.characterId === character.id || obligation.sourceId === character.id,
  )
  const state = characterStates.find(
    cs => cs.characterId === character.id || cs.characterId?.toLowerCase() === character.name.toLowerCase(),
  )
  return {
    characterId: character.id,
    name: character.name,
    role: character.role,
    sceneRole: character.id === povCharacterId ? "pov" : "supporting",
    ...(cleanString(character.want) ? { want: cleanString(character.want) } : {}),
    ...(cleanString(character.need) ? { need: cleanString(character.need) } : {}),
    ...(cleanString(character.lie) ? { lie: cleanString(character.lie) } : {}),
    ...(cleanString(character.truth) ? { truth: cleanString(character.truth) } : {}),
    ...(cleanString(character.goals) ? { drives: cleanString(character.goals) } : {}),
    ...(cleanString(character.fears) ? { fears: cleanString(character.fears) } : {}),
    ...(cleanString(character.avoids) ? { avoids: cleanString(character.avoids) } : {}),
    ...(cleanString(character.internalConflict) ? { conflict: cleanString(character.internalConflict) } : {}),
    ...(cleanString(character.speechPattern) ? { voice: cleanString(character.speechPattern) } : {}),
    ...(cleanString(state?.emotionalState) ? { state: cleanString(state.emotionalState) } : {}),
    sourceObligationIds: compactUniqueStrings(sourceObligations.map(o => cleanString(o.obligationId))),
    activeThreadIds: compactUniqueStrings(sourceObligations.map(o => cleanString(o.threadId))),
    activePromiseIds: compactUniqueStrings(sourceObligations.map(o => cleanString(o.promiseId))),
    activePayoffIds: compactUniqueStrings(sourceObligations.map(o => cleanString(o.payoffId))),
  }
}

function collectBeatObligations(beat: SceneBeat): ObligationItem[] {
  const obligations = beat.obligations
  return [
    ...obligations.mustEstablish,
    ...obligations.mustPayOff,
    ...obligations.mustTransferKnowledge,
    ...obligations.mustShowStateChange,
    ...obligations.mustNotReveal,
  ] as ObligationItem[]
}

function collectActiveStoryRefs(obligations: ObligationItem[]): {
  activeThreadIds: string[]
  activePromiseIds: string[]
  activePayoffIds: string[]
} {
  return {
    activeThreadIds: compactUniqueStrings(obligations.map(o => cleanString(o.threadId))),
    activePromiseIds: compactUniqueStrings(obligations.map(o => cleanString(o.promiseId))),
    activePayoffIds: compactUniqueStrings(obligations.map(o => cleanString(o.payoffId))),
  }
}

function hasActiveStoryRefs(refs: { activeThreadIds: string[]; activePromiseIds: string[]; activePayoffIds: string[] }): boolean {
  return refs.activeThreadIds.length > 0 || refs.activePromiseIds.length > 0 || refs.activePayoffIds.length > 0
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function compactUniqueStrings(values: Array<string | undefined>): string[] {
  return uniqueStrings(values.filter((value): value is string => Boolean(value)))
}
