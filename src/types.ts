import { z } from "zod"

// ── Phase ──────────────────────────────────────────────────────────────────

export type Phase = "concept" | "planning" | "drafting" | "done"

// ── Seed Input (collected from user) ───────────────────────────────────────

export interface CharacterSketch {
  name: string
  role: "protagonist" | "antagonist" | "supporting"
  description: string
}

export interface SeedInput {
  premise: string
  genre: string
  characters: CharacterSketch[]
}

// ── Phase 1 Outputs ────────────────────────────────────────────────────────

export const locationSchema = z.object({
  name: z.string(),
  description: z.string(),
})

export const worldBibleSchema = z.object({
  setting: z.string(),
  timePeriod: z.string(),
  rules: z.array(z.string()),
  locations: z.array(locationSchema),
  culture: z.string(),
  history: z.string(),
})
export type WorldBible = z.infer<typeof worldBibleSchema>

export const relationshipSchema = z.object({
  characterName: z.string(),
  nature: z.string(),
})

export const characterProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  backstory: z.string().default(""),
  traits: z.array(z.string()).default([]),
  speechPattern: z.string().default(""),
  goals: z.string().default(""),
  fears: z.string().default(""),
  relationships: z.array(relationshipSchema).default([]),
})
export type CharacterProfile = z.infer<typeof characterProfileSchema>

export const characterProfilesSchema = z.object({
  characters: z.array(characterProfileSchema),
})

export const actSchema = z.object({
  number: z.number(),
  name: z.string(),
  summary: z.string(),
  emotionalArc: z.string(),
})

export const storySpineSchema = z.object({
  acts: z.array(actSchema),
  centralConflict: z.string(),
  theme: z.string(),
  endingDirection: z.string(),
})
export type StorySpine = z.infer<typeof storySpineSchema>

// ── Phase 2 Output ─────────────────────────────────────────────────────────

export const sceneBeatSchema = z.object({
  description: z.string(),
  characters: z.array(z.string()).default([]),
  emotionalShift: z.string().default(""),
})
export type SceneBeat = z.infer<typeof sceneBeatSchema>

export const chapterOutlineSchema = z.object({
  chapterNumber: z.number(),
  title: z.string(),
  povCharacter: z.string().default(""),
  setting: z.string().default(""),
  purpose: z.string().default(""),
  scenes: z.array(sceneBeatSchema).default([]),
  targetWords: z.number().default(2500),
  charactersPresent: z.array(z.string()).default([]),
})
export type ChapterOutline = z.infer<typeof chapterOutlineSchema>

export const chapterOutlinesSchema = z.object({
  chapters: z.array(chapterOutlineSchema),
})

// ── Phase 3 State ──────────────────────────────────────────────────────────

export const chapterDraftSchema = z.object({
  prose: z.string(),
})

export const continuityIssueSchema = z.object({
  severity: z.enum(["blocker", "warning", "nit"]).default("nit"),
  description: z.string(),
  conflictsWith: z.string().optional(),
  suggestedFix: z.string().optional(),
})
export type ContinuityIssue = z.infer<typeof continuityIssueSchema>

export const continuityCheckSchema = z.object({
  issues: z.array(continuityIssueSchema),
})

export const chapterSummarySchema = z.object({
  summary: z.string(),
  keyEvents: z.array(z.string()).default([]),
  emotionalState: z.string().default(""),
  openThreads: z.array(z.string()).default([]),
})

export const factExtractionSchema = z.object({
  facts: z.array(z.object({
    fact: z.string(),
    category: z.enum(["physical", "rule", "relationship", "knowledge"]),
  })),
})

export const characterStateUpdateSchema = z.object({
  characters: z.array(z.object({
    name: z.string(),
    location: z.string().default("unknown"),
    emotionalState: z.string().default(""),
    knows: z.array(z.string()).default([]),
    doesNotKnow: z.array(z.string()).default([]),
  })).default([]),
})

// ── Stored types (DB rows) ─────────────────────────────────────────────────

export interface Fact {
  id: string
  fact: string
  category: string
  establishedInChapter: number
}

export interface CharacterState {
  characterId: string
  chapterNumber: number
  location: string
  emotionalState: string
  knows: string[]
  doesNotKnow: string[]
}

export interface ChapterSummary {
  chapterNumber: number
  summary: string
  keyEvents: string[]
}

// ── Novel State (top-level) ────────────────────────────────────────────────

export interface NovelState {
  id: string
  phase: Phase
  seed: SeedInput
  currentChapter: number
  totalChapters: number
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  passed: boolean
  blockers: string[]
  warnings: string[]
}
