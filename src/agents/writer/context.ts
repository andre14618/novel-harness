import {
  getChapterOutline, getCharacters, getWorldBible,
  getRecentSummaries, getCharacterStatesAtChapter, getOpenIssues,
  getStorySpine, getNovel,
  getCharacterCultures, getCharacterSystemAwareness,
  getRelationshipBetween, getRelationshipStatesAtChapter,
  getRecentEventsForCharacters, getEventsAtLocation,
  getCharacterKnowledgeUpToChapter,
  getWorldSystems, getCultures,
  getFactsUpToChapter,
} from "../../db"
import type { StorySpine, NovelState, CharacterProfile } from "../../types"
import type { WorldSystem } from "../../db/world-systems"

function tryGet<T>(fn: () => T): T | null {
  try { return fn() } catch { return null }
}

export function buildContext(novelId: string, chapterNum: number): string {
  const outline = getChapterOutline(novelId, chapterNum)
  const allChars = getCharacters(novelId)
  const worldBible = getWorldBible(novelId)
  const storySpine = tryGet(() => getStorySpine(novelId))
  const novel = tryGet(() => getNovel(novelId))
  const worldSystems = tryGet(() => getWorldSystems(novelId)) ?? []
  const cultures = tryGet(() => getCultures(novelId)) ?? []

  // Filter characters to only those in this chapter
  const chapterCharNames = outline.charactersPresent.map(n => n.toLowerCase())
  const relevantChars = allChars.filter(c => chapterCharNames.includes(c.name.toLowerCase()))
  const povChar = relevantChars.find(c => c.name.toLowerCase() === outline.povCharacter?.toLowerCase()) ?? relevantChars[0]

  const sections: string[] = []

  // ── LAYER 1: Scene Setup ───────────────────────────────────────────────
  sections.push(formatSceneSetup(outline))

  // ── LAYER 2: POV Character's World View ────────────────────────────────
  if (povChar) {
    sections.push(formatPOVWorldView(novelId, povChar, worldSystems, cultures))
  }

  // ── LAYER 3: Character Profiles + Evolving Relationships ───────────────
  sections.push(formatCharacterProfiles(novelId, povChar, relevantChars, chapterNum))

  // ── LAYER 4: Relevant World Systems (at POV awareness level) ───────────
  if (povChar && worldSystems.length > 0) {
    const systemSection = formatWorldSystemsForPOV(novelId, povChar, worldSystems)
    if (systemSection) sections.push(systemSection)
  }

  // ── LAYER 5: Setting & Atmosphere ──────────────────────────────────────
  sections.push(formatSetting(novelId, worldBible, outline, chapterNum))

  // ── LAYER 6: Story Context (theme, act, open threads) ──────────────────
  sections.push(formatStoryContext(novelId, storySpine, novel, chapterNum))

  // ── LAYER 7: Recent History (timeline events for present characters) ───
  const recentEvents = formatRecentTimeline(novelId, chapterNum, relevantChars)
  if (recentEvents) sections.push(recentEvents)

  // ── LAYER 8: Character States ──────────────────────────────────────────
  const charStates = getCharacterStatesAtChapter(novelId, chapterNum)
  const presentStates = charStates.filter(cs =>
    chapterCharNames.includes(cs.characterId.toLowerCase()) ||
    relevantChars.some(c => c.id === cs.characterId)
  )
  if (presentStates.length > 0) {
    sections.push(`CHARACTER STATES (as of end of previous chapter):\n${presentStates.map(cs => `${cs.characterId}:
  Location: ${cs.location}
  Carrying: ${cs.emotionalState} (show through behavior, NEVER state directly)
  Knows: ${cs.knows.join("; ")}
  Doesn't know: ${cs.doesNotKnow.join("; ")}`).join("\n\n")}`)
  }

  // ── LAYER 9: Continuity (filtered facts + open issues) ─────────────────
  sections.push(formatContinuity(novelId, chapterNum, relevantChars, outline))

  // ── LAYER 10: Craft Reminders ──────────────────────────────────────────
  sections.push(formatCraftReminders(povChar, relevantChars))

  return sections.filter(Boolean).join("\n\n")
}

// ── Layer Formatters ──────────────────────────────────────────────────────

function formatSceneSetup(outline: any): string {
  return `CHAPTER ${outline.chapterNumber}: "${outline.title}"
POV Character: ${outline.povCharacter}
Setting: ${outline.setting}
Purpose: ${outline.purpose}
Target: ~${outline.targetWords} words

SCENE BEATS (follow in order):
${outline.scenes.map((s: any, i: number) => `${i + 1}. ${s.description}
   Characters: ${s.characters.join(", ")}
   Emotional shift: ${s.emotionalShift}`).join("\n\n")}`
}

function formatPOVWorldView(novelId: string, povChar: CharacterProfile, worldSystems: WorldSystem[], cultures: any[]): string {
  const parts: string[] = [`POV WORLD VIEW (${povChar.name}'s perception shapes the narration):`]

  // Cultural background
  const charCultures = tryGet(() => getCharacterCultures(novelId, povChar.id)) ?? []
  if (charCultures.length > 0) {
    for (const cc of charCultures) {
      const c = cc.culture
      parts.push(`  Culture: ${c.name} (${cc.relationship})`)
      parts.push(`    ${c.description}`)
      if (c.speechInfluences) parts.push(`    Speech influence: ${c.speechInfluences}`)
      if (c.values.length > 0) parts.push(`    Values: ${c.values.join(", ")}`)
      if (c.taboos.length > 0) parts.push(`    Taboos: ${c.taboos.join(", ")}`)
    }
  } else if (povChar.culturalBackground?.length > 0) {
    // Fallback to inline cultural data from character profile
    for (const cb of povChar.culturalBackground) {
      const culture = cultures.find(c => c.name.toLowerCase() === cb.cultureName.toLowerCase())
      if (culture) {
        parts.push(`  Culture: ${culture.name} (${cb.relationship})`)
        parts.push(`    ${culture.description}`)
        if (culture.speechInfluences) parts.push(`    Speech influence: ${culture.speechInfluences}`)
      }
    }
  }

  if (parts.length === 1) return "" // No cultural data available
  return parts.join("\n")
}

function formatCharacterProfiles(novelId: string, povChar: CharacterProfile | undefined, relevantChars: CharacterProfile[], chapterNum: number): string {
  const profiles = relevantChars.map(c => {
    let profile = `${c.name} (${c.role}):\n  Speech pattern: ${c.speechPattern}`
    if (c.backstory) profile += `\n  Backstory: ${c.backstory}`
    if (c.internalConflict) profile += `\n  Internal conflict: ${c.internalConflict}`
    if (c.avoids) profile += `\n  Avoids: ${c.avoids}`
    profile += `\n  Traits: ${c.traits.join(", ")}`
    profile += `\n  Goals: ${c.goals}`
    profile += `\n  Fears: ${c.fears}`

    // Static relationships (from character profile)
    if (c.relationships?.length) {
      const presentNames = relevantChars.map(rc => rc.name.toLowerCase())
      const relevantRels = c.relationships.filter(r => presentNames.includes(r.characterName.toLowerCase()))
      if (relevantRels.length > 0) {
        profile += `\n  Relationships: ${relevantRels.map(r => `${r.characterName} — ${r.nature}`).join("; ")}`
      }
    }

    // Evolving relationship state (from knowledge graph)
    if (povChar && c.id !== povChar.id) {
      const relState = tryGet(() => getRelationshipBetween(novelId, povChar.id, c.id, chapterNum))
      if (relState) {
        profile += `\n  Current dynamic with ${povChar.name}: [${relState.trustLevel}] ${relState.dynamic}`
        if (relState.tension) profile += `\n    Tension: ${relState.tension}`
        if (relState.recentShift) profile += `\n    Recent shift: ${relState.recentShift}`
      }
    }

    return profile
  })

  return `CHARACTER PROFILES:\n${profiles.join("\n\n")}`
}

function formatWorldSystemsForPOV(novelId: string, povChar: CharacterProfile, worldSystems: WorldSystem[]): string | null {
  const awareness = tryGet(() => getCharacterSystemAwareness(novelId, povChar.id)) ?? []
  if (awareness.length === 0 && worldSystems.length === 0) return null

  const parts: string[] = []

  for (const sys of worldSystems) {
    const charAwareness = awareness.find(a => a.systemId === sys.id)
    const level = charAwareness?.awarenessLevel ?? "ignorant"

    // Filter context by awareness level
    if (level === "ignorant") continue

    let entry = ""
    switch (level) {
      case "rumors":
        entry = `${sys.name}: People whisper about ${sys.description.split(".")[0].toLowerCase()}. ${povChar.name} has heard stories but has no direct experience.`
        break
      case "aware":
        entry = `${sys.name} (${sys.type}): ${sys.description}`
        if (sys.rules.length > 0) entry += `\n    Public knowledge: ${sys.rules.slice(0, 2).join("; ")}`
        break
      case "practitioner":
        entry = `${sys.name} (${sys.type}): ${sys.description}`
        if (sys.rules.length > 0) entry += `\n    Rules: ${sys.rules.join("; ")}`
        if (sys.vocabulary.length > 0) entry += `\n    Vocabulary: ${sys.vocabulary.join(", ")}`
        if (sys.manifestations.length > 0) entry += `\n    Manifestations: ${sys.manifestations.join("; ")}`
        break
      case "expert":
        entry = `${sys.name} (${sys.type}): ${sys.description}`
        if (sys.rules.length > 0) entry += `\n    Rules: ${sys.rules.join("; ")}`
        if (sys.vocabulary.length > 0) entry += `\n    Vocabulary: ${sys.vocabulary.join(", ")}`
        if (sys.manifestations.length > 0) entry += `\n    Manifestations: ${sys.manifestations.join("; ")}`
        if (sys.constraints.length > 0) entry += `\n    Limitations: ${sys.constraints.join("; ")}`
        break
    }

    if (charAwareness?.perspective) {
      entry += `\n    ${povChar.name}'s perspective: ${charAwareness.perspective}`
    }

    if (entry) parts.push(entry)
  }

  if (parts.length === 0) return null
  return `WORLD SYSTEMS (as ${povChar.name} understands them):\n${parts.join("\n\n")}`
}

function formatSetting(novelId: string, worldBible: any, outline: any, chapterNum: number): string {
  const parts: string[] = []

  // Match locations
  const relevantLocations = worldBible.locations.filter(
    (l: any) => l.name.toLowerCase().includes(outline.setting.toLowerCase()) ||
         outline.setting.toLowerCase().includes(l.name.toLowerCase())
  )

  if (relevantLocations.length > 0) {
    parts.push(`SETTING DETAILS:\n${relevantLocations.map((l: any) =>
      `${l.name}: ${l.description}${l.sensoryDetails ? `\n  Sensory: ${l.sensoryDetails}` : ""}`
    ).join("\n")}`)
  }

  // Location history
  const locationEvents = tryGet(() => getEventsAtLocation(novelId, outline.setting, chapterNum)) ?? []
  if (locationEvents.length > 0) {
    const recentLocationEvents = locationEvents.slice(-5)
    parts.push(`WHAT HAS HAPPENED HERE:\n${recentLocationEvents.map(e =>
      `- Ch${e.chapterNumber}: ${e.event}`
    ).join("\n")}`)
  }

  if (worldBible.sensoryPalette) {
    parts.push(`WORLD SENSORY PALETTE: ${worldBible.sensoryPalette}`)
  }

  if (worldBible.technologyConstraints) {
    parts.push(`TECHNOLOGY/MAGIC CONSTRAINTS: ${worldBible.technologyConstraints}`)
  }

  parts.push(`WORLD RULES:\n${worldBible.rules.map((r: string) => `- ${r}`).join("\n")}`)

  return parts.join("\n\n")
}

function formatStoryContext(novelId: string, storySpine: StorySpine | null, novel: NovelState | null, chapterNum: number): string {
  const parts: string[] = []

  // Previous chapters + open threads
  const recentSummaries = getRecentSummaries(novelId, chapterNum, 5)
  if (recentSummaries.length > 0) {
    parts.push(`PREVIOUS CHAPTERS:\n${recentSummaries.map(s => {
      let entry = `Chapter ${s.chapterNumber}: ${s.summary}`
      if (s.emotionalState) entry += `\n   Emotional throughline: ${s.emotionalState}`
      return entry
    }).join("\n\n")}`)

    // Open threads from the most recent summary
    const lastSummary = recentSummaries[recentSummaries.length - 1]
    if (lastSummary?.openThreads?.length > 0) {
      parts.push(`OPEN THREADS (unresolved from previous chapters — weave in or advance):\n${lastSummary.openThreads.map(t => `- ${t}`).join("\n")}`)
    }
  }

  // Story spine
  if (storySpine) {
    let spineSection = `STORY CONTEXT:\nTheme: ${storySpine.theme}\nCentral conflict: ${storySpine.centralConflict}\nEnding direction: ${storySpine.endingDirection}`

    const totalChapters = novel?.totalChapters || storySpine.acts.length
    const chaptersPerAct = Math.ceil(totalChapters / storySpine.acts.length)
    const actIndex = Math.min(Math.floor((chapterNum - 1) / chaptersPerAct), storySpine.acts.length - 1)
    const currentAct = storySpine.acts[actIndex]
    if (currentAct) {
      spineSection += `\nCurrent act: Act ${currentAct.number} — ${currentAct.name}`
      spineSection += `\n  Arc: ${currentAct.summary}`
      spineSection += `\n  Emotional arc: ${currentAct.emotionalArc}`
      if (currentAct.turningPoint) spineSection += `\n  Turning point: ${currentAct.turningPoint}`
    }

    parts.push(spineSection)
  }

  return parts.join("\n\n")
}

function formatRecentTimeline(novelId: string, chapterNum: number, relevantChars: CharacterProfile[]): string | null {
  const charNames = relevantChars.map(c => c.name)
  const events = tryGet(() => getRecentEventsForCharacters(novelId, chapterNum, charNames, 10)) ?? []
  if (events.length === 0) return null

  return `RECENT EVENTS (involving characters present):\n${events.map(e =>
    `- Ch${e.chapterNumber}: ${e.event}${e.consequences ? ` → ${e.consequences}` : ""}`
  ).join("\n")}`
}

function formatContinuity(novelId: string, chapterNum: number, relevantChars: CharacterProfile[], outline: any): string {
  const parts: string[] = []

  // Filtered facts — prioritize by relevance, cap at ~80
  const allFacts = tryGet(() => getFactsUpToChapter(novelId, chapterNum)) ?? []
  if (allFacts.length > 0) {
    const charNames = new Set(relevantChars.map(c => c.name.toLowerCase()))
    const setting = outline.setting.toLowerCase()

    // Score facts by relevance
    const scored = allFacts.map(f => {
      const factLower = f.fact.toLowerCase()
      let score = 0
      // Present characters mentioned
      for (const name of charNames) {
        if (factLower.includes(name)) score += 3
      }
      // Current location
      if (factLower.includes(setting) || setting.includes(factLower.slice(0, 20))) score += 2
      // Category priority
      const categoryPriority: Record<string, number> = {
        relationship: 4, knowledge: 4, identity: 3, rule: 3,
        action: 2, dialogue: 2, temporal: 1, physical: 1, sensory: 0, emotional: 1,
      }
      score += categoryPriority[f.category] ?? 0
      // Recency bonus (last 5 chapters)
      if (f.establishedInChapter >= chapterNum - 5) score += 2
      // World rules always relevant
      if (f.category === "rule") score += 5
      return { fact: f, score }
    })

    // Sort by score, take top 80
    scored.sort((a, b) => b.score - a.score)
    const topFacts = scored.slice(0, 80)

    if (topFacts.length > 0) {
      // Group by chapter for readability
      const byChapter = new Map<number, string[]>()
      for (const { fact } of topFacts) {
        const ch = fact.establishedInChapter
        if (!byChapter.has(ch)) byChapter.set(ch, [])
        byChapter.get(ch)!.push(`[${fact.category}] ${fact.fact}`)
      }
      const factLines = [...byChapter.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([ch, facts]) => facts.map(f => `  ch${ch}: ${f}`).join("\n"))
        .join("\n")
      parts.push(`ESTABLISHED FACTS (${topFacts.length} most relevant of ${allFacts.length}):\n${factLines}`)
    }
  }

  // Open issues
  const openIssues = getOpenIssues(novelId, chapterNum)
  if (openIssues.length > 0) {
    parts.push(`ISSUES TO ADDRESS:\n${openIssues.map(i => `- [${i.severity}] ${i.description}`).join("\n")}`)
  }

  return parts.join("\n\n")
}

function formatCraftReminders(povChar: CharacterProfile | undefined, relevantChars: CharacterProfile[]): string {
  let section = `CRAFT REMINDERS:`
  if (povChar) {
    section += `\n- POV character speech pattern: "${povChar.speechPattern}" — maintain this in ALL their dialogue AND color the narration with their worldview`
    if (povChar.avoids) section += `\n- POV character avoids: "${povChar.avoids}" — this shapes what they deflect from, refuse to name, or talk around`
  }
  if (relevantChars.length > 1) {
    const voiceContrasts = relevantChars.map(c => `${c.name}: ${c.speechPattern?.split(".")[0] || c.traits[0]}`).join(" | ")
    section += `\n- VOICE CONTRAST — each character must sound distinct: ${voiceContrasts}`
  }
  section += `\n- Show emotion through action and body language, NEVER through narrator statements`
  section += `\n- Any documents/letters in the scene must be written out for the reader, not summarized`
  section += `\n- Every scene needs spoken dialogue — characters interact, they don't just observe`
  return section
}

export const buildWriterContext = buildContext
