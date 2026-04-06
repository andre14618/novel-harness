/**
 * Writer context assembly — fixed skeleton + dynamic semantic retrieval.
 *
 * Fixed sections (always included via direct DB lookups):
 *   1. Scene Setup — chapter outline, beats, POV
 *   2. POV World View — cultural background, values, taboos
 *   3. Character Profiles — present characters with relationship arcs
 *   10. Craft Reminders — speech patterns, voice contrast, rules
 *
 * Dynamic sections (semantic retrieval via hybrid RRF search):
 *   Retrieved based on scene relevance, weighted by the retrieval_config.
 *   Includes: world systems, setting, story context, timeline, causal chains,
 *   character knowledge, facts.
 *
 * Falls back to minimal assembly if no embeddings exist (safety net only).
 */

import {
  getChapterOutline, getCharacters, getWorldBible,
  getRecentSummaries, getCharacterStatesAtChapter, getOpenIssues,
  getStorySpine, getNovel,
  getCharacterCultures, getCharacterSystemAwareness,
  getRelationshipBetween,
  getWorldSystems, getCultures,
  getFactsUpToChapter,
} from "../../db"
import {
  hasEmbeddings, searchForScene, buildSceneQuery, getRetrievalConfig,
  getCausalChain, getRelationshipArc, getKnowledgeGraph,
} from "../../db/retrieval"
import { getContextTemplate, interpolate as tplInterp } from "../../db/context-templates"
import type { StorySpine, NovelState, CharacterProfile } from "../../types"
import type { WorldSystem } from "../../db/world-systems"

/** Attempt a DB lookup that may legitimately return no data (novel hasn't reached that stage yet).
 *  Only catches "not found" style errors. Real errors (connection, schema) propagate. */
async function tryGet<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn() }
  catch (err: any) {
    // "not found" or empty result — legitimate missing data
    if (err?.code === "PGRST116" || err?.message?.includes("not found") || err?.message?.includes("no rows")) return null
    // Postgres "undefined_table" or "undefined_column" — schema issue, propagate
    if (err?.code === "42P01" || err?.code === "42703") throw err
    // Connection errors — propagate
    if (err?.code === "ECONNREFUSED" || err?.code === "ETIMEDOUT") throw err
    // Unknown — log and return null (preserves existing behavior for edge cases)
    console.warn(`[context] tryGet warning: ${err?.message ?? err}`)
    return null
  }
}

export async function buildContext(novelId: string, chapterNum: number): Promise<string> {
  const outline = await getChapterOutline(novelId, chapterNum)
  const allChars = await getCharacters(novelId)
  const worldBible = await getWorldBible(novelId)
  const storySpine = await tryGet(() => getStorySpine(novelId))
  const novel = await tryGet(() => getNovel(novelId))
  const worldSystems = await tryGet(() => getWorldSystems(novelId)) ?? []
  const cultures = await tryGet(() => getCultures(novelId)) ?? []

  const chapterCharNames = outline.charactersPresent.map(n => n.toLowerCase())
  const relevantChars = allChars.filter(c => chapterCharNames.includes(c.name.toLowerCase()))
  const povChar = relevantChars.find(c => c.name.toLowerCase() === outline.povCharacter?.toLowerCase()) ?? relevantChars[0]

  const sections: string[] = []

  // ── FIXED: Scene Setup ──────────────────────────────────────────────���──
  sections.push(formatSceneSetup(outline))

  // ── FIXED: POV World View ──────────────────────────────────────────────
  if (povChar) {
    const pov = await formatPOVWorldView(novelId, povChar, cultures)
    if (pov) sections.push(pov)
  }

  // ── FIXED: Character Profiles + Relationship Arcs ──────────────────────
  sections.push(await formatCharacterProfiles(novelId, povChar, relevantChars, chapterNum))

  // ── DYNAMIC: Semantic retrieval or minimal fallback ─────────────────────
  const embedsReady = await hasEmbeddings(novelId)

  if (embedsReady) {
    const dynamicSections = await buildDynamicSections(
      novelId, chapterNum, outline, povChar, relevantChars,
      worldBible, worldSystems, storySpine, novel,
    )
    sections.push(...dynamicSections)
  } else {
    console.warn(`[context] No embeddings for novel ${novelId} — using minimal fallback`)
    const fallbackSections = await buildMinimalFallback(
      novelId, chapterNum, outline, povChar, relevantChars,
      worldBible, worldSystems, storySpine, novel,
    )
    sections.push(...fallbackSections)
  }

  // ── FIXED: Craft Reminders ─────────────────────────────────────────────
  sections.push(formatCraftReminders(povChar, relevantChars))

  return sections.filter(Boolean).join("\n\n")
}

// ── Dynamic Context (semantic retrieval) ──────────────────────────────────

async function buildDynamicSections(
  novelId: string, chapterNum: number, outline: any, povChar: CharacterProfile | undefined,
  relevantChars: CharacterProfile[], worldBible: any, worldSystems: WorldSystem[],
  storySpine: StorySpine | null, novel: NovelState | null,
): Promise<string[]> {
  const sections: string[] = []
  const config = await getRetrievalConfig(novelId)
  const sceneQuery = await buildSceneQuery(outline, povChar)

  // Run semantic search across all 6 tables
  const results = await searchForScene({
    novelId, sceneQuery, maxChapter: chapterNum - 1,
    characters: relevantChars.map(c => c.name),
    location: outline.setting,
    config,
  })

  // ── World Systems (only if relevant results found) ─────────────────���─
  if (povChar && worldSystems.length > 0) {
    const systemSection = await formatWorldSystemsForPOV(novelId, povChar, worldSystems)
    if (systemSection) sections.push(systemSection)
  }

  // ── Setting & Atmosphere ─────────────────────────────────────────────
  sections.push(formatSettingFromWorldBible(worldBible, outline))

  // ── Story Context (semantically relevant summaries) ──────────────────
  if (results.summaries.length > 0) {
    const summaryTpl = await getContextTemplate("summary_line")
    const headerTpl = await getContextTemplate("section_summaries")
    const summaryLines = results.summaries.map(r => {
      const s = r.content
      return tplInterp(summaryTpl, { chapter: String(s.chapter_number), summary: s.summary, emotionalState: s.emotional_state ?? "" })
    })
    sections.push(`${headerTpl}\n${summaryLines.join("\n\n")}`)
  }

  // Open threads from most recent summary
  const recentSummaries = await getRecentSummaries(novelId, chapterNum, 1)
  if (recentSummaries.length > 0 && recentSummaries[0].openThreads?.length > 0) {
    const threadHeader = await getContextTemplate("section_threads")
    sections.push(`${threadHeader}\n${recentSummaries[0].openThreads.map(t => `- ${t}`).join("\n")}`)
  }

  // Story spine context (act, theme — always from direct lookup)
  if (storySpine) {
    const spineSection = formatStorySpine(storySpine, novel, chapterNum)
    if (spineSection) sections.push(spineSection)
  }

  // ── Causal Context (graph traversal) ─────────────────────────────────
  if (results.events.length > 0) {
    const eventTpl = await getContextTemplate("event_line")
    const causalTpl = await getContextTemplate("causal_chain")
    const eventHeader = await getContextTemplate("section_events")
    const eventLines: string[] = []
    for (const r of results.events.slice(0, 8)) {
      let line = tplInterp(eventTpl, { chapter: String(r.content.chapter_number), event: r.content.event, consequences: r.content.consequences ?? "" })

      const chain = await tryGet(() => getCausalChain(novelId, r.id, 3))
      if (chain && chain.length > 0) {
        const seen = new Set<string>()
        const deduped = chain.filter(c => {
          const key = `ch${c.chapterNumber}:${c.event.slice(0, 60)}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        if (deduped.length > 0) {
          const chainStr = deduped.map(c => `ch${c.chapterNumber}: ${c.event}`).join(" ← ")
          line += `\n    ${tplInterp(causalTpl, { chain: chainStr })}`
        }
      }
      eventLines.push(`- ${line}`)
    }
    sections.push(`${eventHeader}\n${eventLines.join("\n")}`)
  }

  // ── Character Knowledge (POV-aware) ──────────────────────────────────
  if (povChar) {
    const knowledge = await tryGet(() => getKnowledgeGraph(novelId, povChar.id, chapterNum))
    if (knowledge && knowledge.length > 0) {
      const knowledgeTpl = await getContextTemplate("knowledge_line")
      const knowledgeHeader = await getContextTemplate("section_knowledge")
      const knowsLines: string[] = []
      const suspectedLines: string[] = []
      for (const k of knowledge) {
        const source = k.fromCharacterId ? `from ${k.fromCharacterId}, ` : ""
        const line = tplInterp(knowledgeTpl, { knowledge: k.knowledge, source, chapter: String(k.chapterLearned) })
        if (k.isFalse) {
          knowsLines.push(`${line} [BELIEVES BUT FALSE]`)
        } else if (k.confidence < 0.7) {
          suspectedLines.push(`${line} [SUSPECTS, confidence ${k.confidence}]`)
        } else {
          knowsLines.push(line)
        }
      }
      const header = tplInterp(knowledgeHeader, { povName: povChar.name.toUpperCase() })
      const parts: string[] = [header]
      if (knowsLines.length > 0) parts.push(knowsLines.map(l => `  - ${l}`).join("\n"))
      if (suspectedLines.length > 0) parts.push(`  SUSPECTS:\n${suspectedLines.map(l => `  - ${l}`).join("\n")}`)

      const charStates = await getCharacterStatesAtChapter(novelId, chapterNum)
      const povState = charStates.find(cs => cs.characterId === povChar.id || cs.characterId.toLowerCase() === povChar.name.toLowerCase())
      if (povState?.doesNotKnow?.length > 0) {
        parts.push(`  DOESN'T KNOW:\n${povState.doesNotKnow.map(d => `  - ${d}`).join("\n")}`)
      }

      sections.push(parts.join("\n"))
    }
  }

  // ── Established Facts (semantically relevant) ────────────────────────
  if (results.facts.length > 0) {
    const factTpl = await getContextTemplate("fact_line")
    const factHeader = await getContextTemplate("section_facts")
    const byChapter = new Map<number, string[]>()
    for (const r of results.facts) {
      const ch = r.content.established_in_chapter
      if (!byChapter.has(ch)) byChapter.set(ch, [])
      byChapter.get(ch)!.push(tplInterp(factTpl, { chapter: String(ch), category: r.content.category, fact: r.content.fact }))
    }
    const factLines = [...byChapter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ch, facts]) => facts.map(f => `  ${f}`).join("\n"))
      .join("\n")
    sections.push(`${tplInterp(factHeader, { count: String(results.facts.length) })}\n${factLines}`)
  }

  // ── Open Issues ──────────────────────────────────────────────────────
  const openIssues = await getOpenIssues(novelId, chapterNum)
  if (openIssues.length > 0) {
    const issueHeader = await getContextTemplate("section_issues")
    sections.push(`${issueHeader}\n${openIssues.map(i => `- [${i.severity}] ${i.description}`).join("\n")}`)
  }

  return sections
}

// ── Minimal Fallback (no embeddings — safety net) ───────────────────────────

async function buildMinimalFallback(
  novelId: string, chapterNum: number, outline: any, povChar: CharacterProfile | undefined,
  relevantChars: CharacterProfile[], worldBible: any, worldSystems: WorldSystem[],
  storySpine: StorySpine | null, novel: NovelState | null,
): Promise<string[]> {
  const sections: string[] = []
  const config = await getRetrievalConfig(novelId)

  // World systems (POV-filtered)
  if (povChar && worldSystems.length > 0) {
    const systemSection = await formatWorldSystemsForPOV(novelId, povChar, worldSystems)
    if (systemSection) sections.push(systemSection)
  }

  sections.push(formatSettingFromWorldBible(worldBible, outline))

  // Last 3 summaries + open threads
  const recentSummaries = await getRecentSummaries(novelId, chapterNum, 3)
  if (recentSummaries.length > 0) {
    sections.push(`PREVIOUS CHAPTERS:\n${recentSummaries.map(s =>
      `Chapter ${s.chapterNumber}: ${s.summary}`
    ).join("\n\n")}`)
    const lastSummary = recentSummaries[recentSummaries.length - 1]
    if (lastSummary?.openThreads?.length > 0) {
      sections.push(`OPEN THREADS:\n${lastSummary.openThreads.map(t => `- ${t}`).join("\n")}`)
    }
  }

  if (storySpine) {
    const spineSection = formatStorySpine(storySpine, novel, chapterNum)
    if (spineSection) sections.push(spineSection)
  }

  // Facts — recency-ordered, using same limit as retrieval config
  const allFacts = await tryGet(() => getFactsUpToChapter(novelId, chapterNum)) ?? []
  if (allFacts.length > 0) {
    const topFacts = allFacts
      .sort((a, b) => b.establishedInChapter - a.establishedInChapter)
      .slice(0, config.maxFacts)
    const factLines = topFacts.map(f =>
      `  ch${f.establishedInChapter}: [${f.category}] ${f.fact}`
    ).join("\n")
    sections.push(`ESTABLISHED FACTS (${topFacts.length} most recent, no embeddings):\n${factLines}`)
  }

  const openIssues = await getOpenIssues(novelId, chapterNum)
  if (openIssues.length > 0) {
    const issueHeader = await getContextTemplate("section_issues")
    sections.push(`${issueHeader}\n${openIssues.map(i => `- [${i.severity}] ${i.description}`).join("\n")}`)
  }

  return sections
}

// ── Fixed Layer Formatters ────────────────────────────────────────────────

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

async function formatPOVWorldView(novelId: string, povChar: CharacterProfile, cultures: any[]): Promise<string | null> {
  const parts: string[] = [`POV WORLD VIEW (${povChar.name}'s perception shapes the narration):`]

  const charCultures = await tryGet(() => getCharacterCultures(novelId, povChar.id)) ?? []
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
    for (const cb of povChar.culturalBackground) {
      const culture = cultures.find(c => c.name.toLowerCase() === cb.cultureName.toLowerCase())
      if (culture) {
        parts.push(`  Culture: ${culture.name} (${cb.relationship})`)
        parts.push(`    ${culture.description}`)
        if (culture.speechInfluences) parts.push(`    Speech influence: ${culture.speechInfluences}`)
      }
    }
  }

  if (parts.length === 1) return null
  return parts.join("\n")
}

async function formatCharacterProfiles(novelId: string, povChar: CharacterProfile | undefined, relevantChars: CharacterProfile[], chapterNum: number): Promise<string> {
  const profiles = await Promise.all(relevantChars.map(async c => {
    let profile = `${c.name} (${c.role}):\n  Speech pattern: ${c.speechPattern}`
    if (c.backstory) profile += `\n  Backstory: ${c.backstory}`
    if (c.internalConflict) profile += `\n  Internal conflict: ${c.internalConflict}`
    if (c.avoids) profile += `\n  Avoids: ${c.avoids}`
    profile += `\n  Traits: ${c.traits.join(", ")}`
    profile += `\n  Goals: ${c.goals}`
    profile += `\n  Fears: ${c.fears}`

    if (c.relationships?.length) {
      const presentNames = relevantChars.map(rc => rc.name.toLowerCase())
      const relevantRels = c.relationships.filter(r => presentNames.includes(r.characterName.toLowerCase()))
      if (relevantRels.length > 0) {
        profile += `\n  Relationships: ${relevantRels.map(r => `${r.characterName} — ${r.nature}`).join("; ")}`
      }
    }

    // Relationship arc (full trajectory, not just latest snapshot)
    if (povChar && c.id !== povChar.id) {
      const arc = await tryGet(() => getRelationshipArc(novelId, povChar.id, c.id, chapterNum))
      if (arc && arc.length > 0) {
        const latest = arc[arc.length - 1]
        profile += `\n  Current dynamic with ${povChar.name}: [${latest.trustLevel}] ${latest.dynamic}`
        if (latest.tension) profile += `\n    Tension: ${latest.tension}`
        if (arc.length > 1) {
          const trajectory = arc.map(s => s.trustLevel).join(" → ")
          profile += `\n    Arc: ${trajectory}`
        }
      } else {
        const relState = await tryGet(() => getRelationshipBetween(novelId, povChar.id, c.id, chapterNum))
        if (relState) {
          profile += `\n  Current dynamic with ${povChar.name}: [${relState.trustLevel}] ${relState.dynamic}`
          if (relState.tension) profile += `\n    Tension: ${relState.tension}`
        }
      }
    }

    return profile
  }))

  return `CHARACTER PROFILES:\n${profiles.join("\n\n")}`
}

async function formatWorldSystemsForPOV(novelId: string, povChar: CharacterProfile, worldSystems: WorldSystem[]): Promise<string | null> {
  const awareness = await tryGet(() => getCharacterSystemAwareness(novelId, povChar.id)) ?? []
  if (awareness.length === 0 && worldSystems.length === 0) return null

  const parts: string[] = []
  for (const sys of worldSystems) {
    const charAwareness = awareness.find(a => a.systemId === sys.id)
    const level = charAwareness?.awarenessLevel ?? "ignorant"
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
    if (charAwareness?.perspective) entry += `\n    ${povChar.name}'s perspective: ${charAwareness.perspective}`
    if (entry) parts.push(entry)
  }

  if (parts.length === 0) return null
  return `WORLD SYSTEMS (as ${povChar.name} understands them):\n${parts.join("\n\n")}`
}

function formatSettingFromWorldBible(worldBible: any, outline: any): string {
  const parts: string[] = []

  const relevantLocations = worldBible.locations?.filter(
    (l: any) => l.name.toLowerCase().includes(outline.setting.toLowerCase()) ||
         outline.setting.toLowerCase().includes(l.name.toLowerCase())
  ) ?? []

  if (relevantLocations.length > 0) {
    parts.push(`SETTING:\n${relevantLocations.map((l: any) =>
      `${l.name}: ${l.description}${l.sensoryDetails ? `\n  Sensory: ${l.sensoryDetails}` : ""}`
    ).join("\n")}`)
  }

  if (worldBible.sensoryPalette) parts.push(`WORLD SENSORY PALETTE: ${worldBible.sensoryPalette}`)
  if (worldBible.technologyConstraints) parts.push(`CONSTRAINTS: ${worldBible.technologyConstraints}`)
  if (worldBible.rules?.length > 0) parts.push(`WORLD RULES:\n${worldBible.rules.map((r: string) => `- ${r}`).join("\n")}`)

  return parts.join("\n\n")
}

function formatStorySpine(storySpine: StorySpine, novel: NovelState | null, chapterNum: number): string | null {
  let section = `STORY CONTEXT:\nTheme: ${storySpine.theme}\nCentral conflict: ${storySpine.centralConflict}\nEnding direction: ${storySpine.endingDirection}`

  const totalChapters = novel?.totalChapters || storySpine.acts.length
  const chaptersPerAct = Math.ceil(totalChapters / storySpine.acts.length)
  const actIndex = Math.min(Math.floor((chapterNum - 1) / chaptersPerAct), storySpine.acts.length - 1)
  const currentAct = storySpine.acts[actIndex]
  if (currentAct) {
    section += `\nCurrent act: Act ${currentAct.number} — ${currentAct.name}`
    section += `\n  Arc: ${currentAct.summary}`
    section += `\n  Emotional arc: ${currentAct.emotionalArc}`
    if (currentAct.turningPoint) section += `\n  Turning point: ${currentAct.turningPoint}`
  }
  return section
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
