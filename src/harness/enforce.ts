/**
 * Deterministic enforcement layer.
 *
 * Structural guarantees the code enforces regardless of LLM output.
 * These are not suggestions — they are hard constraints. If the LLM
 * can't meet them, the pipeline stops with a clear error.
 *
 * Principle: code owns structure, LLM owns creativity.
 */

import type { CharacterProfile, ChapterOutline, SceneBeat } from "../types"
import type { BeatObligationItem } from "../schemas/shared"
import { assessBeatCountForTarget, planningBeatCountPolicy } from "./beat-counts"

// ── Planning Phase ────────────────────────────────────────────────────────

export interface PlanningEnforcement {
  valid: boolean
  chapters: ChapterOutline[]
  errors: string[]
  warnings: string[]
}

export interface PlanningEnforcementOptions {
  maxBeatsPerChapter?: number | null
  nativePlanningContractV1?: boolean
  scenePlanContractV1?: boolean
}

/**
 * Enforce chapter count and structural requirements on planner output.
 * Returns validated chapters or errors explaining what failed.
 */
export function enforcePlanningOutput(
  chapters: ChapterOutline[],
  targetChapters: number | null,
  characters: CharacterProfile[],
  options: PlanningEnforcementOptions = {},
): PlanningEnforcement {
  const errors: string[] = []
  const warnings: string[] = []
  const charNames = new Set(characters.map(c => c.name.toLowerCase()))

  // Enforce chapter count
  if (targetChapters) {
    if (chapters.length < targetChapters) {
      errors.push(`Need ${targetChapters} chapters, got ${chapters.length}`)
    } else if (chapters.length > targetChapters) {
      warnings.push(`Trimming ${chapters.length} chapters to ${targetChapters}`)
      chapters = chapters.slice(0, targetChapters)
    }
  }

  // Enforce sequential numbering
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].chapterNumber = i + 1
  }

  // Enforce every chapter has a POV character that exists
  for (const ch of chapters) {
    if (!ch.povCharacter) {
      errors.push(`Chapter ${ch.chapterNumber} has no POV character`)
    } else if (!charNames.has(ch.povCharacter.toLowerCase())) {
      warnings.push(`Chapter ${ch.chapterNumber} POV "${ch.povCharacter}" not in character list`)
    }
  }

  // Enforce every chapter has at least one plan entry. Legacy/native beat
  // plans still use the calibrated count floor as a hard structural guard;
  // scene-contract plans keep word-derived count guidance advisory per L102.
  for (const ch of chapters) {
    const scenePlanContractV1 = options.scenePlanContractV1 ?? false
    if (!ch.scenes || ch.scenes.length === 0) {
      errors.push(`Chapter ${ch.chapterNumber} has no ${scenePlanContractV1 ? "scene contracts" : "scene beats"}`)
      continue
    }
    const target = ch.targetWords ?? 1000
    const policy = planningBeatCountPolicy(target, options.maxBeatsPerChapter)
    const assessment = assessBeatCountForTarget(target, ch.scenes.length)
    const effectiveMaxEntries = scenePlanContractV1
      ? normalizeExplicitEntryMax(options.maxBeatsPerChapter)
      : policy.effectiveMaxBeats
    if (!scenePlanContractV1 && ch.scenes.length < assessment.minRecommendedBeats) {
      errors.push(`Chapter ${ch.chapterNumber}: ${ch.scenes.length} beats below floor ${assessment.minRecommendedBeats} for ${target}w target`)
    } else if (scenePlanContractV1 && assessment.underPlanned) {
      warnings.push(
        `Chapter ${ch.chapterNumber}: ${ch.scenes.length} scene contracts below rough scope guide ` +
          `${assessment.minRecommendedBeats} for ${target}w target`,
      )
    }
    if (effectiveMaxEntries !== null && ch.scenes.length > effectiveMaxEntries) {
      const unit = scenePlanContractV1 ? "scene contracts" : "beats"
      errors.push(`Chapter ${ch.chapterNumber}: ${ch.scenes.length} ${unit} above planning max ${effectiveMaxEntries} for ${target}w target`)
    }
    if (options.nativePlanningContractV1 && !scenePlanContractV1) {
      if (assessment.overPlanned) {
        errors.push(
          `Chapter ${ch.chapterNumber}: ${ch.scenes.length} beats above native planning budget ` +
            `${assessment.recommendedBeats}+1 for ${target}w target`,
        )
      }
    } else if (scenePlanContractV1 && assessment.overPlanned) {
      warnings.push(
        `Chapter ${ch.chapterNumber}: ${ch.scenes.length} scene contracts above rough scope guide ` +
          `${assessment.recommendedBeats}+1 for ${target}w target`,
      )
    }
  }

  // Enforce every chapter has a setting
  for (const ch of chapters) {
    if (!ch.setting || ch.setting.trim().length === 0) {
      errors.push(`Chapter ${ch.chapterNumber} has no setting`)
    }
  }

  // Payoff links are optional scaffolding. Invalid links should not survive into
  // drafting, where they become deterministic approval blockers.
  for (const ch of chapters) sanitizePayoffLinks(ch, warnings)

  return { valid: errors.length === 0, chapters, errors, warnings }
}

function normalizeExplicitEntryMax(value: number | null | undefined): number | null {
  if (typeof value !== "number") return null
  if (!Number.isInteger(value) || value <= 0) return null
  return value
}

function sanitizePayoffLinks(ch: ChapterOutline, warnings: string[]): void {
  const factIds = new Set(
    (ch.establishedFacts ?? [])
      .map(f => f.id?.trim())
      .filter((id): id is string => Boolean(id)),
  )

  for (let beatIndex = 0; beatIndex < ch.scenes.length; beatIndex++) {
    const beat = ch.scenes[beatIndex]
    const original = beat.requiredPayoffs ?? []
    if (original.length === 0) continue

    const kept: typeof original = []
    for (const link of original) {
      const factId = link.fact_id?.trim()
      let reason: string | null = null
      if (!factId) {
        reason = "empty fact_id"
      } else if (!factIds.has(factId)) {
        reason = `missing establishedFact "${factId}"`
      } else if (!Number.isInteger(link.payoff_beat) || link.payoff_beat < 0 || link.payoff_beat >= ch.scenes.length) {
        reason = `invalid payoff beat ${String(link.payoff_beat)}`
      } else if (link.payoff_beat <= beatIndex) {
        reason = `non-forward payoff beat ${link.payoff_beat + 1}`
      }

      if (reason) {
        warnings.push(`Chapter ${ch.chapterNumber} beat ${beatIndex + 1}: dropped payoff link (${reason})`)
      } else {
        kept.push(link)
      }
    }

    if (kept.length !== original.length) beat.requiredPayoffs = kept
  }
}

// ── Scene Plan Contract (L095 Slice 0) ────────────────────────────────────
//
// Pure structural validators ported from POC `assessSceneContract`
// (`scripts/evals/corpus-recreation-poc.ts:748-1034`). These are presence
// checks: they prove the planner filled the field, they cannot prove the
// field has narrative value. Do not call this from any phase in Slice 0;
// Slice 1 wires it into `runPlanningPhase` after `enforcePlanningOutput`.

export interface ScenePlanContractEnforcementOptions {
  /**
   * When true, every obligation across every scene must declare a
   * `materialityTest` of at least 8 characters. Off-flag this is skipped.
   */
  requireMaterialityTests?: boolean
  /**
   * When true, every scene must declare a `povPersonalStake` of at least 8
   * characters. Off-flag this is skipped.
   */
  requirePovPersonalStake?: boolean
}

export interface ScenePlanContractEnforcement {
  valid: boolean
  errors: string[]
}

const PAYOFF_DEBT_STAGES = new Set(["partial_payoff", "final_payoff"])

/**
 * Validate a chapter outline against the scene plan contract. Pure function;
 * no IO. This is a scene-contract validator, not a legacy-outline validator:
 * it reports missing `choiceAlternatives` even on old beat-shaped entries.
 * Runtime planning therefore calls it only under `scenePlanContractV1` and,
 * after L096 calibration, treats failures as advisory signal rather than as
 * phase blockers. Use this only after `enforcePlanningOutput` has cleared
 * structural beat-count rules so scene-level errors are surfaced against a
 * well-formed entry list.
 *
 * Reuses `BeatObligationItem` from `src/schemas/shared.ts` for typing the
 * collected obligation list.
 */
export function enforceScenePlanContract(
  ch: ChapterOutline,
  options: ScenePlanContractEnforcementOptions = {},
): ScenePlanContractEnforcement {
  const errors: string[] = []
  const requireMaterialityTests = options.requireMaterialityTests ?? false
  const requirePovPersonalStake = options.requirePovPersonalStake ?? false

  const scenes = ch.scenes ?? []
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]
    const sceneRef = scene.sceneId ?? scene.beatId ?? `ch${ch.chapterNumber}-entry-${i + 1}`

    // (1) choiceAlternatives must declare at least two options.
    const alts = scene.choiceAlternatives ?? []
    if (alts.length < 2) {
      errors.push(
        `Scene ${sceneRef}: choiceAlternatives must declare at least two options (got ${alts.length})`,
      )
    }

    // (2) povPersonalStake (when required by flag).
    if (requirePovPersonalStake) {
      const stake = (scene.povPersonalStake ?? "").trim()
      if (stake.length < 8) {
        errors.push(
          `Scene ${sceneRef}: povPersonalStake must name the personal pressure behind crisisChoice (≥8 chars)`,
        )
      }
    }

    // (3) Scenes that declare a `crisisChoice` are being treated as full
    //     scene contracts and must have at least one obligation with an exact
    //     sourceId — that's what makes the choice operationally pressured by
    //     a known character/world/story-debt source. Entries without a
    //     crisisChoice are transit/establishment beats in the production
    //     mixed-granularity reality and are exempt from this check. Mirrors
    //     POC `hasDeclaredObligation` intent while accommodating production
    //     beats that haven't fully migrated to scene-shape.
    const allObligations = collectSceneObligations(scene)
    const declaresCrisis = (scene.crisisChoice ?? "").trim().length > 0
    if (declaresCrisis) {
      const sourcedObligations = allObligations.filter(o => {
        const sid = (o.sourceId ?? "").trim()
        return sid.length > 0
      })
      if (sourcedObligations.length === 0) {
        errors.push(
          `Scene ${sceneRef}: declares a crisisChoice but no obligation with an exact sourceId — declared scene contracts must point at a known character/world/story-debt source`,
        )
      }
    }

    // (4) Observable consequence: when both fields are present, the
    //     consequence must not simply restate the outcome.
    const outcome = (scene.outcome ?? "").trim()
    const consequence = (scene.consequence ?? "").trim()
    if (outcome.length > 0 && consequence.length > 0 && outcome === consequence) {
      errors.push(
        `Scene ${sceneRef}: consequence must differ from outcome (consequence is the observable downstream effect, not a restatement)`,
      )
    }

    // (5) materialityTest on every source-grounded obligation (when
    //     required by flag). `mustNotReveal` items are skipped: they have no
    //     upstream `sourceId` by design (per `harness/ids.ts:194`) — they
    //     are avoidance constraints, not source-grounded materials. There is
    //     no "concrete story effect this obligation must change" to declare
    //     for an avoidance; the materiality is the avoidance itself.
    if (requireMaterialityTests) {
      for (const o of allObligations) {
        const sid = (o.sourceId ?? "").trim()
        if (sid.length === 0) continue
        const mt = (o.materialityTest ?? "").trim()
        if (mt.length < 8) {
          errors.push(
            `Scene ${sceneRef} obligation ${o.obligationId ?? "(no id)"} (sourceId=${sid}): materialityTest must declare how the source ID changes choice/cost/relationship/outcome (≥8 chars)`,
          )
        }
      }
    }

    // (6) Payoff-stage / payoffEventId / payoffId consistency. Mirrors POC
    //     `corpus-recreation-poc.ts:945-1002`. Always enforced when any
    //     payoff-shaped fields are present, regardless of flag.
    for (const o of allObligations) {
      const stage = o.storyDebtStage
      const hasPayoffRef = Boolean((o.payoffId ?? "").trim())
      const hasPayoffEventId = Boolean((o.payoffEventId ?? "").trim())
      if (stage && !PAYOFF_DEBT_STAGES.has(stage) && hasPayoffRef) {
        errors.push(
          `Scene ${sceneRef} obligation ${o.obligationId ?? "(no id)"}: non-payoff storyDebtStage "${stage}" carries payoffId (only partial_payoff/final_payoff stages should)`,
        )
      }
      if (stage && PAYOFF_DEBT_STAGES.has(stage) && !hasPayoffEventId) {
        errors.push(
          `Scene ${sceneRef} obligation ${o.obligationId ?? "(no id)"}: payoff stage "${stage}" missing payoffEventId (each concrete payoff event must have a unique child id)`,
        )
      }
      if (hasPayoffEventId && !hasPayoffRef) {
        errors.push(
          `Scene ${sceneRef} obligation ${o.obligationId ?? "(no id)"}: payoffEventId set without parent payoffId`,
        )
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

function collectSceneObligations(scene: SceneBeat): BeatObligationItem[] {
  const list: BeatObligationItem[] = []
  const o = scene.obligations
  if (!o) return list
  const keys = [
    "mustEstablish", "mustPayOff", "mustTransferKnowledge", "mustShowStateChange", "mustNotReveal",
  ] as const
  for (const key of keys) {
    const items = o[key] as BeatObligationItem[] | undefined
    if (items && items.length > 0) list.push(...items)
  }
  return list
}

/**
 * Lightweight validation for phase-1 skeleton output. Scenes/state are NOT
 * yet populated (phase 2 does that), so we only check skeleton-tier fields.
 */
export function enforceSkeletons(
  chapters: ChapterOutline[],
  targetChapters: number | null,
  characters: CharacterProfile[],
): PlanningEnforcement {
  const errors: string[] = []
  const warnings: string[] = []
  const charNames = new Set(characters.map(c => c.name.toLowerCase()))

  if (targetChapters) {
    if (chapters.length < targetChapters) {
      errors.push(`Need ${targetChapters} chapters, got ${chapters.length}`)
    } else if (chapters.length > targetChapters) {
      warnings.push(`Trimming ${chapters.length} chapters to ${targetChapters}`)
      chapters = chapters.slice(0, targetChapters)
    }
  }

  for (let i = 0; i < chapters.length; i++) chapters[i].chapterNumber = i + 1

  for (const ch of chapters) {
    if (!ch.povCharacter) {
      errors.push(`Chapter ${ch.chapterNumber} has no POV character`)
    } else if (!charNames.has(ch.povCharacter.toLowerCase())) {
      warnings.push(`Chapter ${ch.chapterNumber} POV "${ch.povCharacter}" not in character list`)
    }
    if (!ch.setting || ch.setting.trim().length === 0) {
      errors.push(`Chapter ${ch.chapterNumber} has no setting`)
    }
    if (!ch.purpose || ch.purpose.trim().length === 0) {
      errors.push(`Chapter ${ch.chapterNumber} has no purpose`)
    }
    if (!ch.targetWords || ch.targetWords < 300) {
      warnings.push(`Chapter ${ch.chapterNumber}: targetWords ${ch.targetWords ?? 0} unusually low`)
    }
  }

  return { valid: errors.length === 0, chapters, errors, warnings }
}

// ── Extraction Phase ──────────────────────────────────────────────────────

export interface ExtractionEnforcement {
  warnings: string[]
}

/**
 * Validate extraction completeness. Logs warnings for missing data
 * but doesn't block — extraction is best-effort with visibility.
 */
export function enforceExtractionCompleteness(
  chapterNum: number,
  outlineCharacters: string[],
  extractedCharNames: string[],
  factCount: number,
  hasSummary: boolean,
): ExtractionEnforcement {
  const warnings: string[] = []

  if (!hasSummary) {
    warnings.push(`Chapter ${chapterNum}: no summary extracted`)
  }

  if (factCount === 0) {
    warnings.push(`Chapter ${chapterNum}: zero facts extracted`)
  }

  // Check that all characters in the outline got state extracted
  const extractedLower = new Set(extractedCharNames.map(n => n.toLowerCase()))
  for (const name of outlineCharacters) {
    if (!extractedLower.has(name.toLowerCase())) {
      warnings.push(`Chapter ${chapterNum}: no state extracted for "${name}"`)
    }
  }

  return { warnings }
}

/**
 * Fuzzy match a name from LLM output to known characters.
 * Returns the character or null with a warning message.
 */
export function matchCharacter(
  llmName: string,
  characters: CharacterProfile[],
): { char: CharacterProfile | null; warning: string | null } {
  // Exact match (case-insensitive)
  const exact = characters.find(c => c.name.toLowerCase() === llmName.toLowerCase())
  if (exact) return { char: exact, warning: null }

  // Partial match — LLM might return "Nadia Kovacs" when character is "Nadia"
  const partial = characters.find(c =>
    llmName.toLowerCase().includes(c.name.toLowerCase()) ||
    c.name.toLowerCase().includes(llmName.toLowerCase())
  )
  if (partial) return { char: partial, warning: `Fuzzy matched "${llmName}" → "${partial.name}"` }

  return { char: null, warning: `No character match for "${llmName}"` }
}

// ── Draft Validation ──────────────────────────────────────────────────────

export interface DraftEnforcement {
  valid: boolean
  blockers: string[]
  warnings: string[]
}

/**
 * Hard structural requirements for a chapter draft.
 * These block the chapter from being approved.
 */
export function enforceDraftRequirements(
  prose: string,
  outline: ChapterOutline,
  characters: CharacterProfile[],
): DraftEnforcement {
  const blockers: string[] = []
  const warnings: string[] = []
  const wordCount = prose.split(/\s+/).filter(Boolean).length
  const proseLower = prose.toLowerCase()

  // Hard minimum word count
  if (wordCount < 500) {
    blockers.push(`${wordCount} words — minimum 500 required`)
  }

  // POV character must appear in the text
  if (outline.povCharacter) {
    if (!proseLower.includes(outline.povCharacter.toLowerCase())) {
      blockers.push(`POV character "${outline.povCharacter}" not found in prose`)
    }
  }

  // Must contain dialogue (at least one quoted line)
  const dialogueMatch = prose.match(/[""][^""]+[""]|'[^']+'/g)
  if (!dialogueMatch || dialogueMatch.length === 0) {
    blockers.push("No dialogue found — every chapter needs spoken dialogue")
  }

  // Target word count check (warning, not blocker)
  if (outline.targetWords && wordCount < outline.targetWords * 0.5) {
    blockers.push(`${wordCount} words is less than 50% of target ${outline.targetWords}`)
  } else if (outline.targetWords && wordCount < outline.targetWords * 0.7) {
    warnings.push(`${wordCount} words (${Math.round(wordCount / outline.targetWords * 100)}% of target ${outline.targetWords})`)
  }

  // Characters present should appear
  for (const name of outline.charactersPresent ?? []) {
    if (!proseLower.includes(name.toLowerCase())) {
      warnings.push(`Listed character "${name}" not found in prose`)
    }
  }

  return { valid: blockers.length === 0, blockers, warnings }
}
