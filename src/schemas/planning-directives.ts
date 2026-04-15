import { z } from "zod"

// Reject archetype placeholders ("the cannibal", "the mentor", "a scholar",
// "protagonist") as names. Major characters must have proper names so the
// writer can attribute dialogue and the reader can track them. Role words
// belong in `role` or `mustHaveTraits`, not `name`.
const ARCHETYPE_NAME_RE = /^(the|a|an)\s+\w+$/i
const ROLE_WORDS = new Set([
  "protagonist", "antagonist", "narrator", "hero", "heroine", "villain",
  "mentor", "sidekick", "rival", "lover", "love interest", "ally", "foil",
])
export function isValidCharacterName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  if (ARCHETYPE_NAME_RE.test(trimmed)) return false
  if (ROLE_WORDS.has(trimmed.toLowerCase())) return false
  // Must contain at least one capitalized word (proper noun).
  if (!/[A-Z][a-zA-Z'\-]+/.test(trimmed)) return false
  return true
}
const properNameSchema = z.string().refine(isValidCharacterName, {
  message: "Character name must be a proper name, not an archetype ('the cannibal', 'the mentor') or role word. Put role descriptions in `role` or `mustHaveTraits` instead.",
})

export const lockedCharacterSchema = z.object({
  name: properNameSchema,
  role: z.string().default(""),
  mustHaveTraits: z.array(z.string()).default([]),
  mustHaveArc: z.string().default(""),
})
export type LockedCharacter = z.infer<typeof lockedCharacterSchema>

export const requiredBeatSchema = z.object({
  chapter: z.number().optional(),
  description: z.string(),
  mustInclude: z.array(z.string()).default([]),
})
export type RequiredBeat = z.infer<typeof requiredBeatSchema>

// Coerce string→number on the numeric fields — LLMs frequently emit "3" instead
// of 3 for chapterCount / targetWordsPerChapter. Empty strings become undefined.
const coerceOptionalNumber = z.preprocess(
  (v) => {
    if (v === "" || v === null || v === undefined) return undefined
    if (typeof v === "string") {
      const n = Number(v.trim())
      return Number.isFinite(n) ? n : undefined
    }
    return v
  },
  z.number().optional(),
)

export const structuralConstraintsSchema = z.object({
  chapterCount: coerceOptionalNumber,
  povRotation: z.string().default(""),
  pacing: z.string().default(""),
  targetWordsPerChapter: coerceOptionalNumber,
})
export type StructuralConstraints = z.infer<typeof structuralConstraintsSchema>

export const planningDirectivesSchema = z.object({
  lockedCharacters: z.array(lockedCharacterSchema).default([]),
  requiredBeats: z.array(requiredBeatSchema).default([]),
  forbidden: z.array(z.string()).default([]),
  tonalAnchors: z.array(z.string()).default([]),
  structuralConstraints: structuralConstraintsSchema.default({}),
  rawNotes: z.string().default(""),
})
export type PlanningDirectives = z.infer<typeof planningDirectivesSchema>

export const directorTurnSchema = z.object({
  assistantMessage: z.string(),
  directives: planningDirectivesSchema,
  readyToPlan: z.boolean().default(false),
})
export type DirectorTurn = z.infer<typeof directorTurnSchema>

export const schema = directorTurnSchema

export const emptyDirectives: PlanningDirectives = {
  lockedCharacters: [],
  requiredBeats: [],
  forbidden: [],
  tonalAnchors: [],
  structuralConstraints: {
    povRotation: "",
    pacing: "",
  },
  rawNotes: "",
}

export function renderDirectivesForPlanner(d: PlanningDirectives): string {
  const sections: string[] = []

  if (d.lockedCharacters.length) {
    sections.push(
      `LOCKED CHARACTERS (must appear, preserve these attributes):\n${
        d.lockedCharacters.map(c => {
          const parts = [`- ${c.name}${c.role ? ` (${c.role})` : ""}`]
          if (c.mustHaveTraits.length) parts.push(`  Traits: ${c.mustHaveTraits.join(", ")}`)
          if (c.mustHaveArc) parts.push(`  Arc: ${c.mustHaveArc}`)
          return parts.join("\n")
        }).join("\n")
      }`,
    )
  }

  if (d.requiredBeats.length) {
    sections.push(
      `REQUIRED BEATS (must appear somewhere in the outline):\n${
        d.requiredBeats.map(b => {
          const where = b.chapter !== undefined ? `Ch ${b.chapter}` : "any chapter"
          const inc = b.mustInclude.length ? ` [must include: ${b.mustInclude.join(", ")}]` : ""
          return `- (${where}) ${b.description}${inc}`
        }).join("\n")
      }`,
    )
  }

  if (d.forbidden.length) {
    sections.push(`FORBIDDEN (do NOT include any of these):\n${d.forbidden.map(f => `- ${f}`).join("\n")}`)
  }

  if (d.tonalAnchors.length) {
    sections.push(`TONAL ANCHORS: ${d.tonalAnchors.join("; ")}`)
  }

  const sc = d.structuralConstraints
  const scParts: string[] = []
  if (sc.chapterCount) scParts.push(`Chapter count: ${sc.chapterCount}`)
  if (sc.povRotation) scParts.push(`POV rotation: ${sc.povRotation}`)
  if (sc.pacing) scParts.push(`Pacing: ${sc.pacing}`)
  if (sc.targetWordsPerChapter) scParts.push(`Target words/chapter: ${sc.targetWordsPerChapter}`)
  if (scParts.length) sections.push(`STRUCTURAL CONSTRAINTS:\n${scParts.map(p => `- ${p}`).join("\n")}`)

  if (d.rawNotes.trim()) sections.push(`AUTHOR NOTES:\n${d.rawNotes.trim()}`)

  if (!sections.length) return ""
  return `\n\nDIRECTIVES (author-specified, override planner defaults where they conflict):\n${sections.join("\n\n")}`
}

/**
 * Render directives for concept-phase agents (world-builder, character-agent, plotter).
 * Narrower than the planner version — concept agents only need author intent that shapes
 * world/character/structure decisions. Required beats are planner-only.
 */
export function renderDirectivesForConcept(d: PlanningDirectives): string {
  const sections: string[] = []

  if (d.lockedCharacters.length) {
    sections.push(
      `LOCKED CHARACTERS (author has specified these — preserve names, roles, traits, and arcs):\n${
        d.lockedCharacters.map(c => {
          const parts = [`- ${c.name}${c.role ? ` (${c.role})` : ""}`]
          if (c.mustHaveTraits.length) parts.push(`  Traits: ${c.mustHaveTraits.join(", ")}`)
          if (c.mustHaveArc) parts.push(`  Arc: ${c.mustHaveArc}`)
          return parts.join("\n")
        }).join("\n")
      }`,
    )
  }

  if (d.forbidden.length) {
    sections.push(`FORBIDDEN (do NOT include any of these):\n${d.forbidden.map(f => `- ${f}`).join("\n")}`)
  }

  if (d.tonalAnchors.length) {
    sections.push(`TONAL ANCHORS: ${d.tonalAnchors.join("; ")}`)
  }

  const sc = d.structuralConstraints
  const scParts: string[] = []
  if (sc.chapterCount) scParts.push(`Chapter count: ${sc.chapterCount}`)
  if (sc.povRotation) scParts.push(`POV rotation: ${sc.povRotation}`)
  if (sc.pacing) scParts.push(`Pacing: ${sc.pacing}`)
  if (scParts.length) sections.push(`STRUCTURAL CONSTRAINTS:\n${scParts.map(p => `- ${p}`).join("\n")}`)

  if (d.rawNotes.trim()) sections.push(`AUTHOR NOTES:\n${d.rawNotes.trim()}`)

  if (!sections.length) return ""
  return `\n\nAUTHOR DIRECTIVES (from pre-planning chat — honor these over any generic defaults):\n${sections.join("\n\n")}`
}

export function isEmpty(d: PlanningDirectives): boolean {
  return (
    d.lockedCharacters.length === 0 &&
    d.requiredBeats.length === 0 &&
    d.forbidden.length === 0 &&
    d.tonalAnchors.length === 0 &&
    !d.structuralConstraints.chapterCount &&
    !d.structuralConstraints.povRotation &&
    !d.structuralConstraints.pacing &&
    !d.structuralConstraints.targetWordsPerChapter &&
    !d.rawNotes.trim()
  )
}
