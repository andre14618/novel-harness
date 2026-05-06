import { chapterDraftSchema } from "../types"
import {
  getNovel, getChapterOutline, getChapterOutlines, saveChapterOutline, getCharacters, getFactsUpToChapter,
  getCharacterStatesAtChapter, getAllCharacterStatesBeforeChapter, getWorldBible,
  saveChapterDraft, approveChapterDraft, getApprovedDraft,
  saveIssue, updateCurrentChapter, updatePhase,
  logRevision, canonicalizeDeviations,
  isPlanCheckOverridden, setPlanCheckOverridden,
  isRevisionUsed, setRevisionUsed,
} from "../db"
import db from "../db/connection"
import type { Phase, PhaseResult, DraftingOutput, PlanningOutput, RevisionOutcome, ExhaustionKind } from "./contract"
import type { SceneBeat } from "../schemas/shared"
import { callAgent, executeAndLog } from "../llm"
import { getTransport } from "../transport"
import { WRITER_AGENT_PROMPT, BEAT_WRITER_PROMPT, CHAPTER_PLAN_CHECKER_PROMPT } from "../prompts"
import { buildContext as buildWriterContext } from "../agents/writer/context"
import { buildBeatContext } from "../agents/writer/beat-context"
import { resolveReferences } from "../agents/writer/reference-resolver"
import {
  buildRetryPrompt,
  formatChapterIntegrityRetryContext,
  formatChapterUngroundedRetryContext,
  extractUngroundedEntitiesFromDescriptions,
} from "../agents/writer/retry-context"
import { detectSyncDefects } from "../lint/quality-detectors"
import { runBeatChecks, summarizeIssues } from "./beat-checks"
import { checkContinuity } from "../agents/continuity/check"
import { buildContext as buildChapterPlanCheckContext } from "../agents/chapter-plan-checker/context"
import {
  attachChapterPlanDeviationBeatIds,
  chapterPlanCheckSchema,
} from "../agents/chapter-plan-checker/schema"
import {
  buildContext as buildChapterPlanReviseContext,
  buildContextForValidation as buildChapterPlanReviseContextForValidation,
} from "../agents/chapter-plan-reviser/context"
import { chapterBeatsSchema as chapterPlanReviseSchema, prompt as CHAPTER_PLAN_REVISER_PROMPT } from "../agents/chapter-plan-reviser"
import { validateChapterDraft } from "../validation"
import { displayPhaseHeader, displayProgress, presentForApproval, presentForExhaustion, getRevisionNotes } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import { trace } from "../trace"
import { savePlannedState } from "../planned-state"
import { diffPlanAgainstState, type PriorCharacterState } from "../state-diff"
import { assertDraftableSnapshot } from "../canon/planning-snapshot"
import { pipeline } from "../config/pipeline"
import type { SeedInput } from "../types"
import {
  selectContinuityFactsForPolicy,
  selectWriterFactsForPolicy,
} from "../harness/fact-roles"
import { loadInjection, hasAnyInjection, injectionSummary } from "../config/debug-injection"
import * as gates from "../gates"
import { PipelineBailError, type PlanAssistGatePayload } from "../gates"
import {
  attemptRevision,
  type ReviserStrategy,
  type ReviserIssue,
  type ReviserResponse,
} from "./reviser-policy"
import { runSettleLoop } from "./settle-loop"
import { lintProse } from "../lint"
import { fixLintIssues } from "../lint/fix"
import { detectProseIntegrityIssues, offsetToBeatIndex, repairMechanicalQuoteIntegrity, validateLintFixIntegrity } from "../lint/integrity"
import { buildCheckerBlockerDeviations, type AcceptedBeatCheckIssues } from "./checker-blockers"
import { runFunctionalStoryChecks, type FunctionalIssue } from "./functional-checks"
import { checkFunctionalStateGrounding } from "../agents/functional-state-checker"
import { getModelForAgent } from "../models/roles"
import type { ChapterOutline } from "../types"
import { beatStableIdTraceMeta } from "../harness/stable-id-trace"
import { beatCoverageLlmOutputSchema } from "../canon/editorial-beat-coverage"
import {
  persistContinuityEditorialFlagProposals,
  persistEditorialBeatCoverageProposals,
  persistLintProseEditProposals,
} from "./proposal-persistence"
import { routeValidationBlockers } from "./validation-routing"
import {
  normalizePlanAssistReplacementOutline,
  recordPlanAssistOutlineLineage,
  recordPlanAssistOverrideLineage,
} from "./plan-assist-lineage"
import { buildPlanCheckDriftWitnessPayload } from "./plan-check-drift-witness"
import { recordReviserAcceptedLineage } from "./reviser-lineage"

/**
 * Merge per-novel `seed.pipelineOverrides` onto the module-level pipeline
 * defaults. Used only for knobs the orchestrator must scope per-novel
 * (e.g. qualityRedraftEnabled). Read once at the top of `runDraftingPhase`
 * so every beat/chapter in the run sees the same effective config.
 */
export function effectivePipeline(seed: SeedInput): typeof pipeline {
  const o = seed.pipelineOverrides
  if (!o) return pipeline
  return {
    ...pipeline,
    qualityRedraftEnabled: o.qualityRedraftEnabled ?? pipeline.qualityRedraftEnabled,
    qualityRedraftMinWords: o.qualityRedraftMinWords ?? pipeline.qualityRedraftMinWords,
    lintProseEditProposals: o.lintProseEditProposals ?? pipeline.lintProseEditProposals,
    editorialBeatCoverageProposals:
      o.editorialBeatCoverageProposals ?? pipeline.editorialBeatCoverageProposals,
    continuityEditorialFlagProposals:
      o.continuityEditorialFlagProposals ?? pipeline.continuityEditorialFlagProposals,
    factRoleContextPolicy: o.factRoleContextPolicy ?? pipeline.factRoleContextPolicy,
  }
}

export interface BeatLevelFallbackState {
  beatProses: string[]
  acceptedBeatCheckIssues: AcceptedBeatCheckIssues[]
}

export function clearAbandonedBeatLevelState(state: BeatLevelFallbackState): void {
  state.beatProses.length = 0
  state.acceptedBeatCheckIssues.length = 0
}

/** Drafting phase implementation. Kept exported for tests
 *  (drafting-revision-used-persistence.test.ts,
 *  drafting-reviser-escalation.test.ts) that exercise the phase body
 *  directly. Driver consumers should use `draftingPhase` (the Phase<I,O>
 *  wrapper) instead. */
export async function runDraftingPhase(novelId: string): Promise<PhaseResult<DraftingOutput>> {
  displayPhaseHeader("Drafting — Writing chapters")
  emit(novelId, { type: "phase:changed", data: { phase: "drafting" } })

  // Phase 4 commit 5 — replay-on-stale enforcement at draft start.
  // If the operator has locked a planning snapshot for this novel, the
  // live planning state must hash to the same value. If it has drifted,
  // refuse to draft until they roll back planning or re-lock. Novels
  // without a lock pass through (backward compat for pre-Phase-4 work).
  const gate = await assertDraftableSnapshot(novelId)
  if (!gate.ok) {
    log(novelId, "error", gate.reason)
    emit(novelId, {
      type: "error",
      data: {
        step: "drafting",
        error: "planning-snapshot-drift",
        lockedHash: gate.lockedHash,
        liveHash: gate.liveHash,
      },
    })
    return { kind: "paused", reason: gate.reason }
  }

  const novel = await getNovel(novelId)
  const totalChapters = novel.totalChapters
  const eff = effectivePipeline(novel.seed)
  if (eff.qualityRedraftEnabled !== pipeline.qualityRedraftEnabled) {
    log(novelId, "info", `Drafting: pipelineOverrides applied — qualityRedraftEnabled=${eff.qualityRedraftEnabled}`)
  }
  if (eff.lintProseEditProposals !== pipeline.lintProseEditProposals) {
    log(novelId, "info", `Drafting: pipelineOverrides applied — lintProseEditProposals=${eff.lintProseEditProposals}`)
  }
  if (eff.editorialBeatCoverageProposals !== pipeline.editorialBeatCoverageProposals) {
    log(novelId, "info", `Drafting: pipelineOverrides applied — editorialBeatCoverageProposals=${eff.editorialBeatCoverageProposals}`)
  }
  if (eff.continuityEditorialFlagProposals !== pipeline.continuityEditorialFlagProposals) {
    log(novelId, "info", `Drafting: pipelineOverrides applied — continuityEditorialFlagProposals=${eff.continuityEditorialFlagProposals}`)
  }
  if (eff.factRoleContextPolicy !== pipeline.factRoleContextPolicy) {
    log(novelId, "info", `Drafting: pipelineOverrides applied — factRoleContextPolicy=${eff.factRoleContextPolicy}`)
  }

  console.log(`  Drafting ${totalChapters} chapters (approved chapters will be skipped)\n`)
  log(novelId, "info", `Drafting phase: ${totalChapters} chapters`)

  for (let ch = 1; ch <= totalChapters; ch++) {
    const chapterStart = Date.now()

    // Skip chapters that already have an approved draft. Per-chapter redraft
    // works by deleting the target chapter's drafts — this loop then
    // regenerates only the missing one. Safe because cross-chapter prose
    // doesn't flow (beat-writer context is planner-driven and `beatProses`
    // resets at every chapter boundary).
    const existingApproved = await getApprovedDraft(novelId, ch)
    if (existingApproved) {
      log(novelId, "info", `Skipping chapter ${ch} — already approved (v${existingApproved.version})`)
      emit(novelId, { type: "progress", data: { step: "drafting", chapter: ch, totalChapters, status: "skipped-approved" } })
      continue
    }

    displayProgress(ch - 1, totalChapters, `Chapter ${ch}`)
    emit(novelId, { type: "progress", data: { step: "drafting", chapter: ch, totalChapters, status: "starting" } })

    let outline: ChapterOutline
    try {
      outline = await getChapterOutline(novelId, ch)
    } catch (err) {
      log(novelId, "error", `Failed to load outline for chapter ${ch}: ${err}`)
      console.error(`  Error loading outline for chapter ${ch}. Stopping.`)
      emit(novelId, { type: "error", data: { step: "drafting", chapter: ch, error: "Failed to load outline" } })
      return { kind: "paused", reason: `outline-load-failed:ch${ch}` }
    }

    // Pre-write plan-vs-state diff (non-blocking — logs conflicts as warnings).
    // Catches contradictions in the planner's proposed state before generation cost.
    // Uses ALL prior states (not just latest) because the planner emits per-chapter
    // deltas, not cumulative snapshots.
    try {
      const characters = await getCharacters(novelId)
      const priorStates = await getAllCharacterStatesBeforeChapter(novelId, ch)
      const charById = new Map(characters.map(c => [c.id, c.name]))
      const prior: PriorCharacterState[] = priorStates.map(s => ({
        characterName: charById.get(s.characterId) ?? s.characterId,
        chapterNumber: s.chapterNumber,
        knows: s.knows ?? [],
        doesNotKnow: s.doesNotKnow ?? [],
      }))
      const diff = diffPlanAgainstState(outline, prior)
      if (!diff.ok) {
        console.log(`  Plan diff: ${diff.conflicts.length} conflict(s)`)
        for (const c of diff.conflicts) {
          console.log(`    [${c.type}] ${c.detail}`)
          log(novelId, "warn", `Plan diff: [${c.type}] ${c.detail}`)
        }
        emit(novelId, { type: "progress", data: { step: "plan-diff", chapter: ch, status: "warnings", conflictCount: diff.conflicts.length } })
      } else {
        log(novelId, "info", `Plan diff clean for chapter ${ch}`)
        emit(novelId, { type: "progress", data: { step: "plan-diff", chapter: ch, status: "complete" } })
      }
    } catch (err) {
      log(novelId, "warn", `Plan diff skipped (non-blocking): ${err instanceof Error ? err.message : err}`)
    }

    let approved = false
    let attempts = 0
    const maxAttempts = pipeline.maxDraftAttempts
    let revisionUsed = await isRevisionUsed(novelId, ch)
    if (revisionUsed) {
      log(novelId, "info", `Chapter ${ch} revisionUsed=true (persisted from prior attempt) — reviser skip path will fire`)
    }
    let lastUnresolvedSig = ""
    let chapterAborted = false
    // L41 (exp #368): carry the prior chapter-attempt's integrity issues
    // forward so the next attempt's beat-writer prompts include a
    // structural-issue avoidance reminder. Reset per chapter (declared
    // inside the for-each-chapter loop). Each entry is a {kind, excerpt}
    // pair from `detectProseIntegrityIssues` in src/lint/integrity.ts.
    let priorIntegrityIssues: Array<{ kind: string; excerpt: string }> = []
    // L65 (exp #391): same lever, halluc-ungrounded surface. Carry the prior
    // chapter-attempt's LLM-confirmed ungrounded entities forward so the next
    // attempt's beat-writer prompts include an entity-avoidance reminder.
    // Sourced from `acceptedBeatCheckIssues` (entries that survived per-beat
    // retry budget and got accepted-with-warnings into the chapter prose).
    // Reset per chapter alongside `priorIntegrityIssues`.
    let priorUngroundedEntities: Array<{ entity: string; excerpt?: string }> = []

    while (!approved && attempts < maxAttempts && !chapterAborted) {
      attempts++
      console.log(`\n  --- Chapter ${ch}: "${outline.title}" (attempt ${attempts}/${maxAttempts}) ---`)
      log(novelId, "info", `Chapter ${ch} "${outline.title}" attempt ${attempts}`)

      // Per-chapter override — persistent across attempts. When the user
      // picks "override" at a plan-assist gate (see
      // docs/exhaustion-handler-design.md), plan-check and validation-driven
      // reviser escalation are suppressed for this chapter. Validation still
      // runs (cheap, informational) but its blockers don't bail the attempt.
      const planCheckOverridden = await isPlanCheckOverridden(novelId, ch)
      if (planCheckOverridden) {
        console.log(`  [OVERRIDE] plan-check + validation-reviser skipped for chapter ${ch} (persisted flag)`)
        log(novelId, "info", `Chapter ${ch} plan-check override active — skipping blocking checks`)
      }

      // Debug injection — test-campaign-plan.md §"Debug injection".
      // Parsed per-attempt (not at module load) so orchestrator restarts
      // aren't required to change flags mid-session.
      // Strict no-op when no DEBUG_FORCE_* env vars are set.
      const inject = loadInjection()
      if (hasAnyInjection(inject)) {
        log(novelId, "warn", `[DEBUG-INJECT] ${injectionSummary(inject)}`)
        await trace(novelId, { eventType: "debug-inject", chapter: ch, payload: inject as any })
      }

      // Populated at exhaustion sites below; fires a plan-assist gate at
      // the end of the attempt so every cause aggregates into one decision
      // point for the user. Null = no gate needed this attempt.
      let pendingExhaustion: PlanAssistGatePayload | null = null

      // 1-2. Context assembly + writer (beat-level or chapter-level)
      let prose: string
      let wordCount: number
      // Hoisted so the chapter-plan-checker settle loop (further down) can
      // run targeted beat rewrites without rebuilding state.
      let beatProses: string[] = []
      let acceptedBeatCheckIssues: AcceptedBeatCheckIssues[] = []

      if (pipeline.beatLevelWriting && outline.scenes.length > 0) {
        // ── Beat-level generation ───────────────────────────────────────
        try {
          console.log(`  Writing ${outline.scenes.length} beats...`)
          emit(novelId, { type: "progress", data: { step: "beat-writer", chapter: ch, attempt: attempts, status: "running" } })

          const characters = await getCharacters(novelId)
          const charStates = await getCharacterStatesAtChapter(novelId, ch)
          const worldBible = await getWorldBible(novelId)
          // L38-A: prior-chapter facts (chapters 1..ch-1) for the writer's
          // READER-INFO STATE. Empty for chapter 1 by design — the slot
          // builder also gates on chapterNumber > 1, so a non-empty fetch
          // here would be ignored anyway.
          const priorChapterFacts = ch > 1
            ? selectWriterFactsForPolicy(await getFactsUpToChapter(novelId, ch - 1), eff.factRoleContextPolicy)
            : []

          // Pre-resolve all beat references in parallel before the serial writing loop.
          // Kept for all writer routes; world-fact requirements travel through
          // the resolved-references section and the writer can't establish them
          // without it. See docs/archive/2026-04/beat-writer-architecture.md §6.
          const refStart = Date.now()
          const preResolvedRefs = await Promise.all(
            outline.scenes.map(beat =>
              resolveReferences(beat, outline, novelId, ch, characters)
                .catch(err => {
                  log(novelId, "warn", `Reference pre-fetch failed for a beat: ${err instanceof Error ? err.message : err}`)
                  return { context: "", lookupCount: 0, llmUsed: false }
                }),
            ),
          )
          const totalLookups = preResolvedRefs.reduce((s, r) => s + r.lookupCount, 0)
          const llmUsedCount = preResolvedRefs.filter(r => r.llmUsed).length
          await trace(novelId, {
            eventType: "reference-resolution", chapter: ch,
            durationMs: Date.now() - refStart,
            payload: { beats: outline.scenes.length, totalLookups, llmUsedCount },
          })

          beatProses = []
          for (let bi = 0; bi < outline.scenes.length; bi++) {
            const beatCtx = await buildBeatContext({
              novelId, chapterNumber: ch, beatIndex: bi,
              previousBeatProse: beatProses[bi - 1],
              outline, characters, characterStates: charStates, worldBible,
              preResolvedRefs: preResolvedRefs[bi],
              genre: novel.seed?.genre,
              priorChapterFacts,
            })

            let beatProse: string | null = null
            const beatWriterModel = getModelForAgent("beat-writer")
            const beatSystemPrompt = BEAT_WRITER_PROMPT
            const beatSpec = outline.scenes[bi]
            let previousProse: string | null = null
            let previousIssues: string[] = []
            for (let retry = 0; retry <= pipeline.maxBeatRetries; retry++) {
              const { userPrompt: baseUserPrompt } = retry > 0 && previousProse && previousIssues.length > 0
                ? buildRetryPrompt({
                    beatContext: beatCtx,
                    systemPrompt: beatSystemPrompt,
                    v1Prose: previousProse,
                    issues: previousIssues,
                    attempt: retry + 1,
                    priorBeatProse: bi > 0 ? beatProses[bi - 1] : null,
                  })
                : { userPrompt: beatCtx.userPrompt }
              // L41: append chapter-level integrity-issue avoidance context
              // when the prior chapter attempt failed prose integrity. Empty
              // string when no prior failure (attempt 1 of fresh chapter, or
              // attempt N+1 where attempt N's integrity passed).
              // L65: append chapter-level ungrounded-entity avoidance context
              // when the prior chapter-attempt's accepted-with-warnings beat
              // prose carried LLM-confirmed halluc-ungrounded entities.
              const resolvedUserPrompt =
                baseUserPrompt
                + formatChapterIntegrityRetryContext(priorIntegrityIssues)
                + formatChapterUngroundedRetryContext(priorUngroundedEntities)
              try {
                const response = await executeAndLog(
                  {
                    systemPrompt: beatSystemPrompt,
                    userPrompt: resolvedUserPrompt,
                    model: beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507",
                    provider: beatWriterModel?.provider ?? "cerebras",
                    temperature: beatWriterModel?.temperature ?? 0.8,
                    maxTokens: beatWriterModel?.maxTokens ?? 4000,
                    responseFormat: { type: "text" },
                  },
                  novelId,
                  "beat-writer",
                  { chapter: ch, beatIndex: bi, beatId: beatSpec.beatId, attempt: retry + 1 },
                  {
                    stream: true,
                    meta: beatStableIdTraceMeta(outline, beatSpec),
                  },
                )
                const prose = response.content?.trim()
                if (!prose || prose.length < 50) continue

                // Beat-level check fan-out — adherence + hallucination checkers
                // run in parallel and their issues are aggregated. Any blocker
                // from any checker forces retry (OR semantics). All calls are
                // tagged with the same keys as the beat-writer call above so
                // they group together in the inspector view.
                const checks = await runBeatChecks({
                  prose,
                  beat: outline.scenes[bi],
                  outline,
                  characters,
                  worldBible,
                  // Prior beat in the same chapter — consumed by the
                  // halluc-ungrounded checker under the beat-entity-list
                  // charter (v1/v3) to ground legitimate continuity
                  // references.
                  prevBeat: bi > 0 ? outline.scenes[bi - 1] : undefined,
                  tags: { novelId, chapter: ch, beatIndex: bi, beatId: beatSpec.beatId, attempt: retry + 1 },
                })
                // Quality defects (repetition / underlength) detected AFTER existing
                // checker pipeline. Motivated by 2026-04-21 rewrite-capability-probe:
                // the Salvatore LoRA doesn't meaningfully rewrite V1+critique, but
                // it can redraft from scratch. When quality defects fire AND existing
                // checks passed, the next retry iteration uses the pure-redraft path
                // (no V1, no critique) by clearing previousProse/previousIssues.
                // Default disabled; opt-in via pipeline.qualityRedraftEnabled.
                const qualityDefects = eff.qualityRedraftEnabled
                  ? detectSyncDefects(prose, { minWords: eff.qualityRedraftMinWords })
                  : []
                const hasQualityDefect = qualityDefects.length > 0

                if ((checks.pass && !hasQualityDefect) || retry === pipeline.maxBeatRetries) {
                  beatProse = prose
                  if (!checks.pass) {
                    log(novelId, "warn", `Beat ${bi + 1} issues accepted after max retries: ${summarizeIssues(checks.issues)}`)
                    acceptedBeatCheckIssues.push({ beatIndex: bi, beatId: beatSpec.beatId, issues: checks.issues })
                  } else if (hasQualityDefect) {
                    log(novelId, "warn", `Beat ${bi + 1} quality defect(s) accepted after max retries: ${qualityDefects.map(d => d.kind).join(",")}`)
                  }
                  break
                }

                if (!checks.pass) {
                  // Existing retry-with-critique path — same as before.
                  previousProse = prose
                  previousIssues = checks.retryLines
                  log(novelId, "info", `Beat ${bi + 1} retry ${retry + 1}: ${summarizeIssues(checks.issues)}`)
                } else {
                  // Quality-defect redraft path — no V1, no critique. Next loop
                  // iteration's buildRetryPrompt short-circuits to vanilla
                  // beatCtx.userPrompt (since previousIssues is empty).
                  previousProse = null
                  previousIssues = []
                  log(novelId, "info", `Beat ${bi + 1} retry ${retry + 1} (quality redraft): ${qualityDefects.map(d => d.kind).join(",")}`)
                }
              } catch (err) {
                log(novelId, "warn", `Beat ${bi + 1} attempt ${retry + 1} failed: ${err instanceof Error ? err.message : err}`)
              }
            }

            if (!beatProse) {
              log(novelId, "warn", `Beat ${bi + 1} failed after retries, falling back to chapter-level`)
              break
            }

            beatProses.push(beatProse)
            const beatWords = beatProse.split(/\s+/).filter(Boolean).length
            console.log(`    Beat ${bi + 1}/${outline.scenes.length}: ${beatWords}w`)
            emit(novelId, { type: "progress", data: { step: "beat-writer", chapter: ch, beat: bi, totalBeats: outline.scenes.length, status: "complete" } })
          }

          if (beatProses.length === outline.scenes.length) {
            prose = beatProses.join("\n\n")
            wordCount = prose.split(/\s+/).filter(Boolean).length
            console.log(`  Draft (${outline.scenes.length} beats): ${wordCount} words`)
            log(novelId, "info", `Beat-level draft: ${wordCount} words from ${outline.scenes.length} beats`)
            emit(novelId, { type: "progress", data: { step: "beat-writer", chapter: ch, status: "complete", wordCount } })

            // L65: capture LLM-confirmed ungrounded entities accepted-with-warnings
            // into this attempt's prose, so the next chapter-attempt's beat-writer
            // prompts include the avoidance reminder. Empty when the prior attempt
            // had clean grounding. Each subsequent iteration overwrites this list
            // with its own findings, so stale entries don't bleed across attempts.
            // NER-only-warning entries are filtered out by severity before the
            // descriptions reach the parser.
            const ungroundedDescriptions = acceptedBeatCheckIssues.flatMap(b =>
              b.issues
                .filter(i => i.source === "halluc-ungrounded" && i.severity === "blocker")
                .map(i => i.description),
            )
            priorUngroundedEntities = extractUngroundedEntitiesFromDescriptions(ungroundedDescriptions)
          } else {
            // Fallback to chapter-level
            console.log("  Beat generation incomplete, falling back to chapter-level...")
            log(novelId, "info", `Beat fallback → chapter-level for chapter ${ch}`)
            clearAbandonedBeatLevelState({ beatProses, acceptedBeatCheckIssues })
            const writerContext = await buildWriterContext(novelId, ch)
            const draftResult = await callAgent({
              novelId, agentName: "writer",
              chapter: ch, attempt: attempts,
              systemPrompt: WRITER_AGENT_PROMPT,
              userPrompt: writerContext,
              schema: chapterDraftSchema,
            })
            prose = draftResult.output.prose
            wordCount = prose.split(/\s+/).filter(Boolean).length
            console.log(`  Draft (fallback): ${wordCount} words`)
          }
        } catch (err) {
          log(novelId, "error", `Beat-level writing failed for chapter ${ch}: ${err}`)
          console.error(`  Beat writer error: ${err instanceof Error ? err.message : err}`)
          emit(novelId, { type: "error", data: { step: "beat-writer", chapter: ch, error: String(err) } })
          continue
        }
      } else {
        // ── Chapter-level generation (existing path) ────────────────────
        let writerContext: string
        try {
          writerContext = await buildWriterContext(novelId, ch)
        } catch (err) {
          log(novelId, "error", `Context assembly failed for chapter ${ch}: ${err}`)
          console.error(`  Error assembling context: ${err instanceof Error ? err.message : err}`)
          continue
        }

        try {
          console.log("  Writing draft...")
          emit(novelId, { type: "progress", data: { step: "writer", chapter: ch, attempt: attempts, status: "running" } })
          const draftResult = await callAgent({
            novelId, agentName: "writer",
            chapter: ch, attempt: attempts,
            systemPrompt: WRITER_AGENT_PROMPT,
            userPrompt: writerContext,
            schema: chapterDraftSchema,
          })
          prose = draftResult.output.prose
          wordCount = prose.split(/\s+/).filter(Boolean).length
          console.log(`  Draft: ${wordCount} words`)
          log(novelId, "info", `Draft generated: ${wordCount} words`)
          emit(novelId, { type: "progress", data: { step: "writer", chapter: ch, status: "complete", wordCount } })
        } catch (err) {
          log(novelId, "error", `Writer agent failed for chapter ${ch}: ${err}`)
          console.error(`  Writer agent error: ${err instanceof Error ? err.message : err}`)
          emit(novelId, { type: "error", data: { step: "writer", chapter: ch, error: String(err) } })
          continue
        }
      }

      // 2b-4. Post-draft checks: plan check + continuity in parallel (independent
      // reads of the same prose), validation runs synchronously alongside for free.
      // All three results are gathered before deciding whether to retry, so a failing
      // attempt surfaces every problem at once instead of one-at-a-time.
      console.log("  Running checks (plan + continuity in parallel)...")
      emit(novelId, { type: "progress", data: { step: "plan-check", chapter: ch, status: "running" } })
      emit(novelId, { type: "progress", data: { step: "continuity", chapter: ch, status: "running" } })

      const [planCheckSettled, continuitySettled] = await Promise.allSettled([
        (pipeline.chapterPlanCheck && !planCheckOverridden)
          ? callAgent({  // @noninjectable — V1 inject.forcePlanCheck removed in D4a; V2 transport-interceptor + v1-bridge handles forced failures.
              novelId, agentName: "chapter-plan-checker",
              chapter: ch, attempt: attempts,
              systemPrompt: CHAPTER_PLAN_CHECKER_PROMPT,
              userPrompt: buildChapterPlanCheckContext(prose, outline),
              schema: chapterPlanCheckSchema,
            })
          : Promise.resolve(null),
        (async () => {
          const facts = selectContinuityFactsForPolicy(
            await getFactsUpToChapter(novelId, ch),
            eff.factRoleContextPolicy,
          )
          const charStates = await getCharacterStatesAtChapter(novelId, ch)
          return checkContinuity(prose, facts, charStates, { novelId, chapter: ch, attempt: attempts, outline })
        })(),
      ])

      // Seam B — DEBUG_FORCE_VALIDATION=pov|word-count: replace the validation
      // result with a synthesized POV failure or word-count warning. Word count
      // is advisory and must not drive validation rewrites/reviser escalation.
      const _rawValidation = validateChapterDraft(prose, outline)
      const validation = (inject.forceValidation === "pov")
        ? { passed: false as const, blockers: [`POV character "${outline.povCharacter}" never mentioned in draft`], warnings: _rawValidation.warnings, findings: _rawValidation.findings ?? [] }
        : (inject.forceValidation === "word-count")
          ? { passed: _rawValidation.blockers.length === 0, blockers: _rawValidation.blockers, warnings: [`Chapter too short: 100 words (minimum 500)`, ..._rawValidation.warnings], findings: _rawValidation.findings ?? [] }
          : _rawValidation
      await trace(novelId, {
        eventType: "validation-check", chapter: ch,
        payload: { passed: validation.passed, blockers: validation.blockers, warnings: validation.warnings, findings: validation.findings ?? [] },
      })

      let functionalIssues: FunctionalIssue[] = []
      let bail = false

      // Plan check result handling — targeted beat rewrite instead of full
      // chapter restart. When chapter-plan-checker returns pass=false, we
      // route each deviation to the specific beat it references
      // (deviation.beat_index) and call beat-writer only on those beats,
      // then re-run the checker. Up to maxChapterPlanRewritePasses in-place
      // passes before we give up and escalate to bail=true (full restart).
      //
      // Chapter-level issues (beat_index=null) are mapped heuristically:
      //   setting_match=false      → beat 0 (location established early)
      //   emotional_arc_correct=false → last 2 beats (arc lands at closer)
      if (pipeline.chapterPlanCheck && !planCheckOverridden) {
        if (planCheckSettled.status === "fulfilled" && planCheckSettled.value !== null) {
          // V1 inline short-circuit for `DEBUG_FORCE_PLAN_CHECK=fail` was
          // removed in D4a — interception now lives in the V2 transport
          // layer (`src/debug/transport-interceptor.ts`). The
          // `src/debug/v1-bridge.ts` module translates the legacy env var
          // into a `force-result` rule on `chapter-plan-checker` at
          // orchestrator startup, so the chapter-plan-checker callAgent
          // already returns `{ pass: false, ... }` here. The
          // `inject.forcePlanCheck === "fail"` read below stays for
          // telemetry payload parity (campaign R1/R6/R7 SSE matchers
          // assert the `forcedPlanCheck` + `source` fields).
          const initialPlanCheckResult = attachChapterPlanDeviationBeatIds(
            planCheckSettled.value.output,
            outline,
          )
          await trace(novelId, {
            eventType: "plan-check-outcome", chapter: ch,
            payload: {
              pass: initialPlanCheckResult.pass,
              rewritePass: 0,
              forcedPlanCheck: inject.forcePlanCheck === "fail",
              deviationCount: initialPlanCheckResult.deviations?.length ?? 0,
              source: inject.forcePlanCheck === "fail" ? "forced-synth" : "initial",
            },
          })
          const canSettle = beatProses.length === outline.scenes.length
          const planCheckWitnessHistory: Array<typeof initialPlanCheckResult> = [initialPlanCheckResult]

          // D3 settle loop. Caller closures own:
          //   - per-deviation routing (chapter-level fallbacks for
          //     setting_match / emotional_arc_correct, last-resort
          //     append-to-beat-0)
          //   - mutating beatProses[bi] on accepted rewrites and refreshing
          //     prose/wordCount before the next recheck
          // Loop owns: while-loop, budget, single recheck dispatch site,
          // ascending sequential rewriteBeat dispatch, telemetry hooks.
          // V1 inline `forcePlanCheck === "fail"` short-circuit was removed
          // in D4a — see initial-check comment above; the V2
          // transport-interceptor now handles the synthesis at the
          // chapter-plan-checker callAgent boundary.
          let currentRewritePass = 0
          const planSettleOutcome = await runSettleLoop<typeof initialPlanCheckResult>({
            initialResult: initialPlanCheckResult,
            check: async () => {
              prose = beatProses.join("\n\n")
              wordCount = prose.split(/\s+/).filter(Boolean).length
              console.log(`  Rewrite complete — re-running plan check on ${wordCount}w prose`)
              const recheck = await callAgent({
                novelId, agentName: "chapter-plan-checker",
                chapter: ch, attempt: attempts + currentRewritePass * 10,
                systemPrompt: CHAPTER_PLAN_CHECKER_PROMPT,
                userPrompt: buildChapterPlanCheckContext(prose, outline),
                schema: chapterPlanCheckSchema,
              })
              return attachChapterPlanDeviationBeatIds(
                recheck.output as typeof initialPlanCheckResult,
                outline,
              )
            },
            isPass: r => r.pass,
            route: r => {
              const devs = r.deviations ?? []
              devs.forEach(d => console.log(`    DEVIATION (beat ${d.beat_index ?? "chapter-level"}): ${d.description}`))
              const perBeat = new Map<number, string[]>()
              const addTo = (idx: number, desc: string) => {
                if (idx < 0 || idx >= outline.scenes.length) return
                const list = perBeat.get(idx) ?? []
                list.push(desc)
                perBeat.set(idx, list)
              }
              for (const d of devs) {
                if (d.beat_index != null) addTo(d.beat_index, d.description)
              }
              const hasChapterLevel = devs.some(d => d.beat_index == null)
              if (hasChapterLevel || (r.setting_match && !r.setting_match.matches)) {
                if (r.setting_match && !r.setting_match.matches) {
                  addTo(0, `Chapter setting mismatch — planned "${r.setting_match.planned}" but prose observed "${r.setting_match.observed}"`)
                }
              }
              if (r.emotional_arc_correct === false) {
                const lastN = outline.scenes.length >= 12 ? 3 : 2
                for (let i = outline.scenes.length - lastN; i < outline.scenes.length; i++) {
                  addTo(i, "Emotional arc reversed from plan — the closing beats should land the planned emotion direction, not invert it")
                }
              }
              for (const d of devs) {
                if (d.beat_index == null && r.setting_match?.matches !== false && r.emotional_arc_correct !== false) {
                  addTo(0, d.description)
                }
              }
              return perBeat
            },
            rewriteBeat: async (bi, issueDescriptions) => {
              const beatWriterModel = getModelForAgent("beat-writer")
              const beatSystemPrompt = BEAT_WRITER_PROMPT
              const characters = await getCharacters(novelId)
              const charStates = await getCharacterStatesAtChapter(novelId, ch)
              const worldBible = await getWorldBible(novelId)
              const priorChapterFacts = ch > 1
                ? selectWriterFactsForPolicy(await getFactsUpToChapter(novelId, ch - 1), eff.factRoleContextPolicy)
                : []
              const beatSpec = outline.scenes[bi]
              const preResolved = await resolveReferences(beatSpec, outline, novelId, ch, characters)
                .catch(() => ({ context: "", lookupCount: 0, llmUsed: false }))
              const beatCtx = await buildBeatContext({
                novelId, chapterNumber: ch, beatIndex: bi,
                previousBeatProse: beatProses[bi - 1],
                outline, characters, characterStates: charStates, worldBible,
                preResolvedRefs: preResolved,
                genre: novel.seed?.genre,
                priorChapterFacts,
              })
              const priorProse = beatProses[bi]
              const retryContext = `\n\n--- TARGETED REWRITE (chapter-plan check) ---\nYour previous prose for this beat:\n---\n${priorProse.slice(0, 2000)}\n---\nChapter-plan issues found:\n${issueDescriptions.map(s => `- ${s}`).join("\n")}\nRewrite this beat to address the issues above while preserving what works.`
              try {
                const response = await executeAndLog(
                  {
                    systemPrompt: beatSystemPrompt,
                    userPrompt: beatCtx.userPrompt + retryContext + formatChapterIntegrityRetryContext(priorIntegrityIssues) + formatChapterUngroundedRetryContext(priorUngroundedEntities),
                    model: beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507",
                    provider: beatWriterModel?.provider ?? "cerebras",
                    temperature: beatWriterModel?.temperature ?? 0.8,
                    maxTokens: beatWriterModel?.maxTokens ?? 4000,
                    responseFormat: { type: "text" },
                  },
                  novelId,
                  "beat-writer",
                  { chapter: ch, beatIndex: bi, beatId: beatSpec.beatId, attempt: attempts + currentRewritePass * 10 },
                  {
                    stream: true,
                    meta: {
                      ...beatStableIdTraceMeta(outline, beatSpec),
                      rewriteSource: "chapter-plan-check",
                    },
                  },
                )
                const rewritten = response.content?.trim()
                if (rewritten && rewritten.length >= 50) {
                  beatProses[bi] = rewritten
                  return rewritten
                }
                return null
              } catch (err) {
                log(novelId, "warn", `Beat ${bi + 1} plan-check rewrite failed: ${err instanceof Error ? err.message : err}`)
                return null
              }
            },
            budget: pipeline.maxChapterPlanRewritePasses,
            canSettle: () => canSettle,
            onPassStart: async (passNumber, perBeat) => {
              currentRewritePass = passNumber
              console.log(`  Plan check pass ${passNumber}/${pipeline.maxChapterPlanRewritePasses}: rewriting ${perBeat.size} beats (${[...perBeat.keys()].sort((a, b) => a - b).join(",")})`)
              log(novelId, "info", `Plan-check settle pass ${passNumber}: targeted rewrite of beats [${[...perBeat.keys()].sort((a, b) => a - b).join(",")}]`)
            },
            onIteration: async (passNumber, result) => {
              planCheckWitnessHistory.push(result)
              await trace(novelId, {
                eventType: "plan-check-outcome", chapter: ch,
                payload: {
                  pass: result.pass,
                  rewritePass: passNumber,
                  forcedPlanCheck: inject.forcePlanCheck === "fail",
                  deviationCount: result.deviations?.length ?? 0,
                  source: inject.forcePlanCheck === "fail" ? "forced-recheck-synth" : "recheck",
                },
              })
            },
          })

          // Resolve the post-loop `out` from the settle outcome. Mirror the
          // pre-D3 control flow: `no-routing` was a `bail = true; break`
          // followed by the unchanged-out path; `ineligible` corresponds
          // to canSettle=false, where the original loop never ran and the
          // initial result drove escalation; `exhausted` and `accepted`
          // both have a finalResult.
          if (planSettleOutcome.kind === "no-routing") {
            log(novelId, "warn", "Plan check failed but no beat mapping — escalating to full restart")
          }
          const out = planSettleOutcome.kind === "ineligible"
            ? initialPlanCheckResult
            : planSettleOutcome.finalResult

          if (!out.pass) {
            out.deviations?.forEach(d => console.log(`    UNRESOLVED DEVIATION (beat ${d.beat_index ?? "chapter-level"}): ${d.description}`))
            await trace(novelId, {
              eventType: "plan-check-drift-witness",
              chapter: ch,
              payload: { ...buildPlanCheckDriftWitnessPayload({
                result: out,
                outline,
                settleKind: planSettleOutcome.kind,
                rewritePass: currentRewritePass,
                forcedPlanCheck: inject.forcePlanCheck === "fail",
                history: planCheckWitnessHistory,
              }) },
            })

            // Planner escalation — pass unresolved issues back to the
            // chapter-plan-reviser at most ONCE per chapter (across all
            // attempts). `revisionUsed` is chapter-scoped (declared outside
            // the while-attempt loop). The signature check is redundant
            // given the hard cap but kept as a defense-in-depth guard in
            // case the cap is loosened later.
            // Shared canonicalization with the telemetry hash — guarantees
            // skip dedupe and issue_sig stay in sync.
            const issueSig = canonicalizeDeviations(out.deviations ?? [])
            const canRevise = !revisionUsed && issueSig !== lastUnresolvedSig && canSettle

            const planCheckIssues: ReviserIssue[] = (out.deviations ?? []).map(d => ({
              description: `[beat ${d.beat_index ?? "chapter-level"}] ${d.description}`,
              beat_index: d.beat_index,
            }))
            const planCheckStrategy: ReviserStrategy = {
              buildReviserContext: (o, p, issues) =>
                buildChapterPlanReviseContext(o, p, issues.map(i => i.description)),
              telemetryLabel: "plan-check",
            }

            if (canRevise) {
              console.log(`  Escalating to chapter-plan-reviser (persistent issues)`)
              log(novelId, "info", `Invoking chapter-plan-reviser for chapter ${ch}: ${(out.deviations ?? []).length} unresolved issues`)
            } else {
              const reasonText = revisionUsed
                ? "already revised this chapter"
                : issueSig === lastUnresolvedSig
                  ? "identical issue signature as last revision"
                  : "beat-level state not available"
              log(novelId, "warn", `Plan check still failing — not escalating to reviser (${reasonText}); falling through to plan-assist gate`)
            }

            const outcome = await attemptRevision({
              novelId, chapter: ch, attempt: attempts,
              outline, prose,
              issues: planCheckIssues,
              rawDeviations: out.deviations ?? [],
              strategy: planCheckStrategy,
              eligibility: { revisionUsed, lastUnresolvedSig, canSettle, canRevise, issueSig },
              persistAcceptedOutline: (o) => saveChapterOutline(novelId, o),
              logRevision: async (entry) => {
                try {
                  await logRevision(entry as Parameters<typeof logRevision>[0])
                } catch (err) {
                  log(novelId, "warn", `logRevision failed: ${err instanceof Error ? err.message : err}`)
                  throw err
                }
              },
              markRevisionUsed: async () => {
                // Mark revision as used BEFORE the LLM call so a schema/transport
                // failure can't trigger a second revision on the next attempt.
                // AWAIT the DB write — if we can't persist the guard, the reviser
                // must NOT fire. See module docstring + Codex review 5c9e... (Round A).
                await setRevisionUsed(novelId, ch, true)
                revisionUsed = true
                lastUnresolvedSig = issueSig
              },
              callReviser: async (userPrompt) => {
                // V1 DEBUG_FORCE_REVISER short-circuits removed in D4a — V2 transport-interceptor + v1-bridge intercepts at agent boundary.
                return await callAgent({  // @noninjectable
                  novelId, agentName: "chapter-plan-reviser",
                  chapter: ch, attempt: attempts,
                  systemPrompt: CHAPTER_PLAN_REVISER_PROMPT,
                  userPrompt,
                  schema: chapterPlanReviseSchema,
                }) as ReviserResponse
              },
            })

            if (outcome.kind === "accepted") {
              const previousOutline = outline
              outline = outcome.revisedOutline
              await recordReviserAcceptedLineage({
                novelId,
                chapter: ch,
                attempt: attempts,
                source: "plan-check",
                revisionId: outcome.revisionId,
                previousOutline,
                nextOutline: outline,
                issueCount: out.deviations?.length ?? 0,
              }).catch((err) => {
                log(novelId, "warn", `Chapter-plan-reviser lineage failed: ${err instanceof Error ? err.message : err}`)
              })
              log(novelId, "info", `Chapter plan revised: ${outline.scenes.length} beats (was ${beatProses.length}); persisted to chapter_outlines`)
              console.log(`  Revised plan: ${outline.scenes.length} beats. Persisted. Restarting chapter draft with revised plan.`)
              bail = true
            } else if (outcome.kind === "rejected" && outcome.reason === "beat_floor") {
              log(novelId, "warn", `Reviser returned too few beats (${outcome.info.revisedBeatCount} < ${outcome.info.minBeats}) — rejecting revision`)
              console.log(`  Reviser output rejected: ${outcome.info.revisedBeatCount} beats below floor of ${outcome.info.minBeats}`)
              pendingExhaustion = outcome.pendingExhaustion
              bail = true
            } else if (outcome.kind === "rejected" && outcome.reason === "new_characters") {
              log(novelId, "warn", `Reviser introduced new characters [${outcome.info.newCharacters.join(", ")}] — rejecting revision`)
              console.log(`  Reviser output rejected: new characters not in original plan`)
              pendingExhaustion = outcome.pendingExhaustion
              bail = true
            } else if (outcome.kind === "error") {
              log(novelId, "error", `Chapter-plan-reviser failed for chapter ${ch}: ${outcome.error.message}`)
              console.error(`  Reviser error: ${outcome.error.message}`)
              pendingExhaustion = outcome.pendingExhaustion
              bail = true
            } else {
              // ineligible — skip path; pendingExhaustion already constructed by policy
              pendingExhaustion = outcome.pendingExhaustion
              bail = true
            }

            emit(novelId, { type: "progress", data: { step: "plan-check", chapter: ch, status: "failed" } })
          } else {
            const passes = planSettleOutcome.kind === "accepted" ? planSettleOutcome.passes : 0
            if (passes > 0) {
              console.log(`  Plan check: passed after ${passes} targeted rewrite pass(es)`)
              log(novelId, "info", `Plan check passed after ${passes} targeted rewrite pass(es)`)
            } else {
              console.log("  Plan check: passed")
            }
            emit(novelId, { type: "progress", data: { step: "plan-check", chapter: ch, status: "complete" } })
          }
        } else if (planCheckSettled.status === "rejected") {
          log(novelId, "warn", `Plan check failed (non-blocking): ${planCheckSettled.reason instanceof Error ? planCheckSettled.reason.message : planCheckSettled.reason}`)
        }
      }

      // Validation result handling — targeted beat rewrite instead of full
      // chapter restart. Drafting-mode blockers (currently POV-missing)
      // route to beats via routeValidationBlockers(), then we call
      // beat-writer on only those beats with issue descriptions. Word-count
      // findings are warning-only and must not enter this path.
      // Skipped entirely when plan-check override is active — the user
      // explicitly chose to ship this chapter past blocking checks.
      if (!validation.passed && !planCheckOverridden) {
        console.log(`  Validation FAILED:`)
        validation.blockers.forEach(b => console.log(`    BLOCKER: ${b}`))
        validation.warnings.forEach(w => console.log(`    WARNING: ${w}`))
        log(novelId, "warn", `Validation failed: ${validation.blockers.join("; ")}`)

        const canSettle = beatProses.length === outline.scenes.length
        let currentBlockers = validation.blockers
        let currentWarnings = validation.warnings
        let currentFindings = validation.findings ?? []
        let currentValidationPass = 0
        type ValidationCheckResult = ReturnType<typeof validateChapterDraft>

        // D3 settle loop. Caller closures own:
        //   - V1 forceValidation synthesis on the recheck path (Seam B
        //     stays at the caller through D4a)
        //   - per-pass success/failure log lines (was inline at the
        //     pre-D3 site between line 943-948), kept inside `check` so
        //     they fire after every recheck
        // Loop owns: while-loop, budget, single recheck dispatch site,
        // ascending sequential rewriteBeat dispatch, telemetry hooks.
        await runSettleLoop<ValidationCheckResult>({
          initialResult: validation,
          check: async () => {
            prose = beatProses.join("\n\n")
            wordCount = prose.split(/\s+/).filter(Boolean).length
            let recheck: ValidationCheckResult
            if (inject.forceValidation === "pov") {
              recheck = {
                passed: false,
                blockers: [`POV character "${outline.povCharacter}" never mentioned in draft`],
                warnings: [],
              }
            } else if (inject.forceValidation === "word-count") {
              const rawRecheck = validateChapterDraft(prose, outline)
              recheck = {
                ...rawRecheck,
                warnings: [`Chapter too short: 100 words (minimum 500)`, ...rawRecheck.warnings],
              }
            } else {
              recheck = validateChapterDraft(prose, outline)
            }
            currentBlockers = recheck.blockers
            currentWarnings = recheck.warnings
            currentFindings = recheck.findings ?? []
            if (currentBlockers.length === 0) {
              console.log(`  Validation: passed after ${currentValidationPass} targeted rewrite pass(es)`)
              log(novelId, "info", `Validation passed after ${currentValidationPass} targeted rewrite pass(es)`)
            } else {
              console.log(`  Validation still failing (${currentBlockers.length} blockers remain)`)
            }
            return recheck
          },
          isPass: r => r.passed,
          route: r => routeValidationBlockers(r.blockers, outline, beatProses, r.findings ?? []),
          rewriteBeat: async (bi, issueDescriptions) => {
            const beatWriterModel = getModelForAgent("beat-writer")
            const beatSystemPrompt = BEAT_WRITER_PROMPT
            const characters = await getCharacters(novelId)
            const charStates = await getCharacterStatesAtChapter(novelId, ch)
            const worldBible = await getWorldBible(novelId)
            const priorChapterFacts = ch > 1
              ? selectWriterFactsForPolicy(await getFactsUpToChapter(novelId, ch - 1), eff.factRoleContextPolicy)
              : []
            const beatSpec = outline.scenes[bi]
            const preResolved = await resolveReferences(beatSpec, outline, novelId, ch, characters)
              .catch(() => ({ context: "", lookupCount: 0, llmUsed: false }))
            const beatCtx = await buildBeatContext({
              novelId, chapterNumber: ch, beatIndex: bi,
              previousBeatProse: beatProses[bi - 1],
              outline, characters, characterStates: charStates, worldBible,
              preResolvedRefs: preResolved,
              genre: novel.seed?.genre,
              priorChapterFacts,
            })
            const priorProse = beatProses[bi]
            const retryContext = `\n\n--- TARGETED REWRITE (validation) ---\nYour previous prose for this beat:\n---\n${priorProse.slice(0, 2000)}\n---\nValidation issues found:\n${issueDescriptions.map(s => `- ${s}`).join("\n")}\nRewrite this beat to address the issues above while preserving what works.`
            try {
              const response = await executeAndLog(
                {
                  systemPrompt: beatSystemPrompt,
                  userPrompt: beatCtx.userPrompt + retryContext + formatChapterIntegrityRetryContext(priorIntegrityIssues),
                  model: beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507",
                  provider: beatWriterModel?.provider ?? "cerebras",
                  temperature: beatWriterModel?.temperature ?? 0.8,
                  maxTokens: beatWriterModel?.maxTokens ?? 4000,
                  responseFormat: { type: "text" },
                },
                novelId,
                "beat-writer",
                { chapter: ch, beatIndex: bi, beatId: beatSpec.beatId, attempt: attempts + currentValidationPass * 20 },
                {
                  stream: true,
                  meta: {
                    ...beatStableIdTraceMeta(outline, beatSpec),
                    rewriteSource: "validation",
                  },
                },
              )
              const rewritten = response.content?.trim()
              if (rewritten && rewritten.length >= 50) {
                beatProses[bi] = rewritten
                return rewritten
              }
              return null
            } catch (err) {
              log(novelId, "warn", `Beat ${bi + 1} validation rewrite failed: ${err instanceof Error ? err.message : err}`)
              return null
            }
          },
          budget: pipeline.maxChapterPlanRewritePasses,
          canSettle: () => canSettle,
          onPassStart: async (passNumber, perBeat) => {
            currentValidationPass = passNumber
            console.log(`  Validation pass ${passNumber}/${pipeline.maxChapterPlanRewritePasses}: rewriting ${perBeat.size} beats (${[...perBeat.keys()].sort((a, b) => a - b).join(",")})`)
            log(novelId, "info", `Validation settle pass ${passNumber}: targeted rewrite of beats [${[...perBeat.keys()].sort((a, b) => a - b).join(",")}]`)
          },
          onSettleComplete: async () => {
            // Post-settle trace — emit the final validation-settle outcome so
            // test campaigns (organic-run-verify + R5/R6-style exhaustion
            // campaigns) can assert the post-settle state the same way
            // plan-check has `plan-check-outcome` events. Emitted before the
            // reviser escalation block so the sequence is unambiguous:
            //   1. validation-check source=initial (blockers=N)
            //   2. validation-check source=post-settle (settled=true/false,
            //      rewritePassCount=K)
            //   3. [iff !settled] reviser escalation → chapter_revisions row
            await trace(novelId, {
              eventType: "validation-check", chapter: ch,
              payload: {
                source: "post-settle",
                passed: currentBlockers.length === 0,
                blockerCount: currentBlockers.length,
                warningCount: currentWarnings.length,
                blockers: currentBlockers,
                warnings: currentWarnings,
                findings: currentFindings,
                rewritePassCount: currentValidationPass,
                settled: currentBlockers.length === 0,
                forcedValidation: inject.forceValidation ?? null,
              },
            })
          },
        })

        if (currentBlockers.length > 0) {
          currentBlockers.forEach(b => console.log(`    UNRESOLVED BLOCKER: ${b}`))
          log(novelId, "warn", `Validation still failing after ${currentValidationPass} targeted rewrite pass(es)`)

          // Path (C) — validation-driven reviser escalation.
          // See docs/exhaustion-handler-design.md §"Path (C)".
          // revisionUsed is a CHAPTER-SCOPED hard cap shared with the
          // plan-check reviser path, so at most ONE reviser call per chapter
          // regardless of whether it originates from plan-check or validation.
          // Post-revision sanity checks mirror the plan-check branch.
          //
          // TODO(exhaustion-gate): when the plan-assist gate ships (step 2
          // of the design memo), reviser-rejected / reviser-threw branches
          // below should fall through to the gate instead of blind bail.
          const canSettleForRevision = beatProses.length === outline.scenes.length
          // Validation path doesn't dedupe by issue signature (only by
          // revisionUsed + canSettle). Pass dummy non-matching sigs so the
          // policy's skip-reason logic can't land on `skip_duplicate_sig` —
          // validation's only skip reasons are `already_revised` and
          // `no_beat_state`, matching the pre-refactor behavior.
          const validationCanRevise = !revisionUsed && canSettleForRevision
          // Prefix descriptions with "[validation] " so the issue_sig hash
          // namespace can't collide with a future plan-check deviation that
          // happens to land on beat_index=null with matching text. The
          // prompt-side uses the raw currentBlockers (no prefix); only the
          // telemetry rows carry the source tag.
          const blockersAsDeviations = currentBlockers.map(b => ({ description: `[validation] ${b}`, beat_index: null as number | null }))
          const validationIssues: ReviserIssue[] = blockersAsDeviations.map(d => ({ description: d.description, beat_index: d.beat_index }))
          const validationStrategy: ReviserStrategy = {
            // Reviser context uses the unprefixed currentBlockers (per pre-
            // refactor behavior at drafting.ts:985). Strategy ignores the
            // policy's `issues` parameter — they carry the prefixed shape
            // intended for telemetry/payload, not for the prompt.
            buildReviserContext: (o, p) =>
              buildChapterPlanReviseContextForValidation(o, p, currentBlockers),
            telemetryLabel: "validation",
          }

          if (validationCanRevise) {
            console.log(`  Escalating to chapter-plan-reviser (persistent validation blockers)`)
            log(novelId, "info", `Invoking chapter-plan-reviser for chapter ${ch} (validation path): ${currentBlockers.length} unresolved blockers`)
          } else {
            const reason = revisionUsed
              ? "already revised this chapter"
              : "beat-level state not available"
            log(novelId, "warn", `Validation still failing — not escalating to reviser (${reason}); falling through to plan-assist gate`)
          }

          const outcome = await attemptRevision({
            novelId, chapter: ch, attempt: attempts,
            outline, prose,
            issues: validationIssues,
            rawDeviations: blockersAsDeviations,
            strategy: validationStrategy,
            eligibility: {
              revisionUsed,
              // Validation path: pass non-matching sigs so the skip-reason
              // can never land on `skip_duplicate_sig`.
              lastUnresolvedSig: "",
              canSettle: canSettleForRevision,
              canRevise: validationCanRevise,
              issueSig: "validation-path",
            },
            persistAcceptedOutline: (o) => saveChapterOutline(novelId, o),
            logRevision: async (entry) => {
              try {
                await logRevision(entry as Parameters<typeof logRevision>[0])
              } catch (err) {
                log(novelId, "warn", `logRevision failed: ${err instanceof Error ? err.message : err}`)
                throw err
              }
            },
            markRevisionUsed: async () => {
              await setRevisionUsed(novelId, ch, true)
              revisionUsed = true
            },
            callReviser: async (userPrompt) => {
              // V1 DEBUG_FORCE_REVISER short-circuits removed in D4a (see plan-check site above) — V2 transport-interceptor handles throw/reject.
              return await callAgent({  // @noninjectable
                novelId, agentName: "chapter-plan-reviser",
                chapter: ch, attempt: attempts,
                systemPrompt: CHAPTER_PLAN_REVISER_PROMPT,
                userPrompt,
                schema: chapterPlanReviseSchema,
              }) as ReviserResponse
            },
          })

          if (outcome.kind === "accepted") {
            const previousOutline = outline
            outline = outcome.revisedOutline
            await recordReviserAcceptedLineage({
              novelId,
              chapter: ch,
              attempt: attempts,
              source: "validation",
              revisionId: outcome.revisionId,
              previousOutline,
              nextOutline: outline,
              issueCount: currentBlockers.length,
            }).catch((err) => {
              log(novelId, "warn", `Validation chapter-plan-reviser lineage failed: ${err instanceof Error ? err.message : err}`)
            })
            log(novelId, "info", `Chapter plan revised (validation path): ${outline.scenes.length} beats (was ${beatProses.length}); persisted to chapter_outlines`)
            console.log(`  Revised plan: ${outline.scenes.length} beats. Persisted. Restarting chapter draft with revised plan.`)
          } else if (outcome.kind === "rejected" && outcome.reason === "beat_floor") {
            log(novelId, "warn", `Reviser returned too few beats (${outcome.info.revisedBeatCount} < ${outcome.info.minBeats}) — rejecting revision (validation path)`)
            console.log(`  Reviser output rejected: ${outcome.info.revisedBeatCount} beats below floor of ${outcome.info.minBeats}`)
            pendingExhaustion = outcome.pendingExhaustion
          } else if (outcome.kind === "rejected" && outcome.reason === "new_characters") {
            log(novelId, "warn", `Reviser introduced new characters [${outcome.info.newCharacters.join(", ")}] — rejecting revision (validation path)`)
            console.log(`  Reviser output rejected: new characters not in original plan`)
            pendingExhaustion = outcome.pendingExhaustion
          } else if (outcome.kind === "error") {
            log(novelId, "error", `Chapter-plan-reviser failed for chapter ${ch} (validation path): ${outcome.error.message}`)
            console.error(`  Reviser error: ${outcome.error.message}`)
            pendingExhaustion = outcome.pendingExhaustion
          } else {
            // ineligible — skip path
            pendingExhaustion = outcome.pendingExhaustion
          }
          bail = true
        }
      } else if (validation.warnings.length > 0) {
        validation.warnings.forEach(w => console.log(`    WARNING: ${w}`))
      }

      if (!bail) {
        const deterministicFunctionalChecks = runFunctionalStoryChecks({ outline })
        const semanticFunctionalChecks = await checkFunctionalStateGrounding(prose, outline, beatProses, { novelId, chapter: ch, attempt: attempts })
        functionalIssues = [
          ...deterministicFunctionalChecks.issues,
          ...semanticFunctionalChecks.warnings.map(w => ({
            checker: "functional-state-grounding" as const,
            severity: "warning" as const,
            beat_index: w.beat_index,
            description: w.description,
            // Stable-ID coverage (2026-05-04, additive). Forward the durable
            // beatId from the warning when the wrapper resolved it
            // deterministically; FunctionalIssue.beatId is already optional
            // (see src/phases/functional-checks.ts). plannedItemId is not on
            // FunctionalIssue so it stays on the warning shape only.
            ...(w.beatId ? { beatId: w.beatId } : {}),
          })),
        ]
        await trace(novelId, {
          eventType: "functional-check", chapter: ch,
          payload: {
            passed: functionalIssues.every(i => i.severity !== "blocker"),
            blockers: functionalIssues.filter(i => i.severity === "blocker"),
            warnings: functionalIssues.filter(i => i.severity === "warning"),
            semanticCheckerError: semanticFunctionalChecks.error ?? null,
          },
        })
        if (functionalIssues.length > 0) {
          console.log(`  Functional checks: ${functionalIssues.length} issue(s)`)
          functionalIssues.forEach(i => console.log(`    [${i.severity}] ${i.description}`))
        }
      }

      // Continuity result handling
      let issues: any[] = []
      if (continuitySettled.status === "fulfilled") {
        issues = continuitySettled.value.issues
        if (issues.length > 0) {
          console.log(`  Continuity: ${issues.length} issues`)
          issues.forEach(i => console.log(`    [${i.severity}] ${i.description}`))
        } else {
          console.log("  Continuity: no issues found")
        }
        emit(novelId, { type: "progress", data: { step: "continuity", chapter: ch, status: "complete", issueCount: issues.length } })
      } else {
        log(novelId, "error", `Continuity check failed for chapter ${ch}: ${continuitySettled.reason}`)
        console.error(`  Continuity check failed: ${continuitySettled.reason instanceof Error ? continuitySettled.reason.message : continuitySettled.reason}`)
        bail = true
      }

      const checkerBlockers = buildCheckerBlockerDeviations({
        acceptedBeatIssues: acceptedBeatCheckIssues,
        continuityIssues: issues,
        functionalIssues,
      })
      if (checkerBlockers.length > 0) {
        checkerBlockers.forEach(d => console.log(`    CHECKER BLOCKER (beat ${d.beat_index ?? "chapter-level"}): ${d.description}`))
        log(novelId, "warn", `Checker blockers remain after retries: ${checkerBlockers.map(d => d.description).join("; ")}`)
        pendingExhaustion ??= {
          kind: "plan-check-exhausted",
          novelId,
          chapter: ch,
          attempt: attempts,
          outline,
          prose,
          unresolvedDeviations: checkerBlockers,
        }
        bail = true
      }

      // Plan-assist gate — fire ONCE per attempt if any exhaustion site set
      // pendingExhaustion. Aggregates all causes into a single decision
      // point. Auto mode throws PipelineBailError (let it propagate — halts
      // the run loudly). CLI/web mode returns a decision.
      if (pendingExhaustion && bail) {
        const decision = await presentForExhaustion(pendingExhaustion)
        if (decision.action === "edit-plan") {
          // User supplied a full replacement outline. Validated against
          // chapterOutlineSchema at the route. Persist and continue the
          // attempt loop — next attempt uses the new plan.
          const previousOutline = outline
          outline = normalizePlanAssistReplacementOutline(previousOutline, decision.outline)
          await saveChapterOutline(novelId, outline)
          await recordPlanAssistOutlineLineage({
            novelId,
            chapter: ch,
            payload: pendingExhaustion,
            exhaustionId: decision.exhaustionId,
            previousOutline,
            nextOutline: outline,
          }).catch((err) => {
            log(novelId, "warn", `Plan-assist outline lineage failed: ${err instanceof Error ? err.message : err}`)
          })
          log(novelId, "info", `Chapter ${ch} outline edited via plan-assist gate: ${outline.scenes.length} beats`)
          console.log(`  [PLAN-ASSIST] outline edited, restarting attempt with new plan`)
        } else if (decision.action === "override") {
          // Persist the skip flag so subsequent attempts of this chapter
          // (and any later resume) bypass plan-check + validation-reviser
          // without re-firing the gate. The chapter draft will still hit
          // the end-of-chapter approval gate for human sign-off.
          await setPlanCheckOverridden(novelId, ch, true)
          await recordPlanAssistOverrideLineage({
            novelId,
            chapter: ch,
            payload: pendingExhaustion,
            exhaustionId: decision.exhaustionId,
            outline,
            previousValue: planCheckOverridden,
            nextValue: true,
          }).catch((err) => {
            log(novelId, "warn", `Plan-assist override lineage failed: ${err instanceof Error ? err.message : err}`)
          })
          log(novelId, "info", `Chapter ${ch} plan-check overridden via plan-assist gate`)
          console.log(`  [PLAN-ASSIST] override persisted, restarting attempt with checks skipped`)
        } else {
          // Abort — stop this chapter. Novel stays in "drafting" phase so
          // the user can resume after manual intervention.
          log(novelId, "warn", `Chapter ${ch} aborted by user at plan-assist gate (kind=${pendingExhaustion.kind})`)
          console.log(`  [PLAN-ASSIST] chapter aborted by user.`)
          chapterAborted = true
        }
      }

      if (bail) continue

      // Save draft
      await saveChapterDraft(novelId, ch, prose, wordCount)
      log(novelId, "checkpoint", `Draft saved for chapter ${ch} v${attempts}`)

      // 4b. Lint and fix prose
      let lintSummary = ""
      try {
        emit(novelId, { type: "progress", data: { step: "lint", chapter: ch, status: "running" } })
        const lintStart = Date.now()
        const lintResult = await lintProse(prose)
        await trace(novelId, {
          eventType: "lint-detect", chapter: ch,
          durationMs: Date.now() - lintStart,
          payload: { totalIssues: lintResult.totalIssues, counts: lintResult.counts },
        })
        if (lintResult.totalIssues > 0) {
          console.log(`  Lint: ${lintResult.totalIssues} issues (${Object.entries(lintResult.counts).map(([k, v]) => `${k}:${v}`).join(", ")})`)
          log(novelId, "info", `Lint found ${lintResult.totalIssues} issues`)

          if (eff.lintProseEditProposals) {
            const persistStart = Date.now()
            const proposalResult = await persistLintProseEditProposals({
              novelId,
              chapter: ch,
              prose,
              issues: lintResult.issues,
              outline,
              beatProses,
            })
            await trace(novelId, {
              eventType: "lint-prose-edit-proposals", chapter: ch,
              durationMs: Date.now() - persistStart,
              payload: { ...proposalResult },
            })
            console.log(
              `  Lint proposals: ${proposalResult.inserted} inserted, ${proposalResult.skipped} existing, ${proposalResult.errors.length} errors`,
            )
            log(
              novelId,
              proposalResult.errors.length > 0 ? "warn" : "info",
              `Lint prose_edit proposals for chapter ${ch}: generated=${proposalResult.generated} inserted=${proposalResult.inserted} skipped=${proposalResult.skipped} errors=${proposalResult.errors.length}`,
            )
            lintSummary = `\n\n--- LINT (${lintResult.totalIssues} found, proposal mode) ---\n` +
              Object.entries(lintResult.counts).map(([cat, count]) => `  ${cat}: ${count}`).join("\n") +
              `\n  Proposals: ${proposalResult.inserted} inserted, ${proposalResult.skipped} existing, ${proposalResult.errors.length} errors`
            if (proposalResult.errors.length > 0) {
              lintSummary += `\n  Persistence errors: ${proposalResult.errors.map((e) => `${e.envelopeId}: ${e.error}`).join("; ")}`
            }
          } else {
          const fixer = getModelForAgent("lint-fixer")
          const fixStart = Date.now()
          const fixResult = await fixLintIssues(
            prose,
            lintResult.issues,
            fixer ? { provider: fixer.provider, model: fixer.model, temperature: fixer.temperature } : undefined,
            { novelId, chapter: ch },
          )

          if (fixResult.deterministicFixes > 0) {
            await trace(novelId, {
              eventType: "lint-fix-deterministic", chapter: ch,
              payload: { fixed: fixResult.deterministicFixes },
            })
          }
          if (fixResult.llmFixes > 0 || fixResult.llmCalls > 0) {
            await trace(novelId, {
              eventType: "lint-fix-llm", chapter: ch,
              durationMs: Date.now() - fixStart,
              payload: { fixed: fixResult.llmFixes, unfixed: fixResult.unfixed, llmCalls: fixResult.llmCalls, cost: fixResult.costUsd },
            })
          }

          const totalFixed = fixResult.deterministicFixes + fixResult.llmFixes
          if (totalFixed > 0) {
            const integrity = validateLintFixIntegrity(prose, fixResult.prose)
            if (!integrity.pass) {
              await trace(novelId, {
                eventType: "lint-fix-rejected", chapter: ch,
                durationMs: Date.now() - fixStart,
                payload: { issues: integrity.issues },
              })
              const summary = integrity.issues.map(i => `${i.kind}: ${i.excerpt}`).join("; ")
              console.log(`  Lint fix rejected by integrity guard (${integrity.issues.length} issues); keeping raw draft`)
              log(novelId, "warn", `Lint fix rejected for chapter ${ch}: ${summary}`)
              lintSummary = `\n\n--- LINT (${lintResult.totalIssues} found, fix rejected by integrity guard) ---\n` +
                Object.entries(lintResult.counts).map(([cat, count]) => `  ${cat}: ${count}`).join("\n") +
                `\n  Guard: ${summary}`
            } else {
              prose = fixResult.prose
              wordCount = prose.split(/\s+/).filter(Boolean).length
              await saveChapterDraft(novelId, ch, prose, wordCount)
              console.log(`  Fixed: ${fixResult.deterministicFixes} deterministic, ${fixResult.llmFixes} LLM (${fixResult.unfixed} unfixed, $${fixResult.costUsd.toFixed(4)})`)
              log(novelId, "info", `Lint fixed ${totalFixed}/${lintResult.totalIssues} issues ($${fixResult.costUsd.toFixed(4)})`)
            }
          }

          if (!lintSummary) {
            lintSummary = `\n\n--- LINT (${lintResult.totalIssues} found, ${totalFixed} fixed, ${fixResult.unfixed} remaining) ---\n` +
              Object.entries(lintResult.counts).map(([cat, count]) => `  ${cat}: ${count}`).join("\n")
          }
          }
        } else {
          console.log("  Lint: clean")
        }
        emit(novelId, { type: "progress", data: { step: "lint", chapter: ch, status: "complete" } })
      } catch (err) {
        log(novelId, "warn", `Lint/fix failed for chapter ${ch}: ${err}`)
        console.log(`  Lint failed (non-blocking): ${err instanceof Error ? err.message : err}`)
      }

      if (eff.editorialBeatCoverageProposals) {
        try {
          emit(novelId, { type: "progress", data: { step: "editorial-beat-coverage", chapter: ch, status: "running" } })
          const coverageStart = Date.now()
          const proposalResult = await persistEditorialBeatCoverageProposals({
            novelId,
            chapter: ch,
            prose,
            outline,
            callLLM: async ({ systemPrompt, userPrompt }) => {
              const result = await callAgent({
                novelId,
                chapter: ch,
                agentName: "editorial-beat-coverage",
                systemPrompt,
                userPrompt,
                schema: beatCoverageLlmOutputSchema,
              })
              return result.output
            },
          })
          await trace(novelId, {
            eventType: "editorial-beat-coverage-proposals",
            chapter: ch,
            durationMs: Date.now() - coverageStart,
            payload: { ...proposalResult },
          })
          console.log(
            `  Beat-coverage proposals: ${proposalResult.inserted} inserted, ${proposalResult.skipped} existing, ${proposalResult.errors.length} errors`,
          )
          log(
            novelId,
            proposalResult.errors.length > 0 ? "warn" : "info",
            `Editorial beat-coverage proposals for chapter ${ch}: generated=${proposalResult.generated} inserted=${proposalResult.inserted} skipped=${proposalResult.skipped} errors=${proposalResult.errors.length}`,
          )
          emit(novelId, { type: "progress", data: { step: "editorial-beat-coverage", chapter: ch, status: "complete" } })
        } catch (err) {
          log(novelId, "warn", `Editorial beat-coverage proposal persistence failed for chapter ${ch}: ${err}`)
          console.log(`  Beat-coverage proposals failed (non-blocking): ${err instanceof Error ? err.message : err}`)
          emit(novelId, { type: "progress", data: { step: "editorial-beat-coverage", chapter: ch, status: "failed" } })
        }
      }

      const quoteRepair = repairMechanicalQuoteIntegrity(prose)
      if (quoteRepair.fixed > 0) {
        prose = quoteRepair.prose
        wordCount = prose.split(/\s+/).filter(Boolean).length
        await saveChapterDraft(novelId, ch, prose, wordCount)
        await trace(novelId, {
          eventType: "prose-integrity-repair",
          chapter: ch,
          payload: { kind: "quote-integrity", fixed: quoteRepair.fixed },
        })
        console.log(`  Prose integrity repaired deterministically: quote-integrity (${quoteRepair.fixed})`)
        log(novelId, "info", `Prose integrity repaired deterministically for chapter ${ch}: quote-integrity=${quoteRepair.fixed}`)
      }

      let proseIntegrityIssues = detectProseIntegrityIssues(prose)
      if (proseIntegrityIssues.length > 0) {
        await trace(novelId, {
          eventType: "prose-integrity-check", chapter: ch,
          payload: { passed: false, issues: proseIntegrityIssues },
        })

        // L70b / Lever I-D form (a): if all issues are duplicate-* and they
        // map to ≤2 distinct beats with aligned beatProses, attempt a per-
        // beat targeted rewrite (1 settle pass) before falling through to
        // the chapter-attempt retry. No writer-prompt change — just narrower
        // rewrite scope so unaffected beats stay canonical and cannot drift
        // into new failure modes elsewhere (the L70 form (b) regression
        // class). On accepted outcome, the residual issue list goes empty
        // and execution falls through to the success branch below.
        const allDuplicate = proseIntegrityIssues.every(
          i => i.kind === "duplicate-fragment" || i.kind === "duplicate-sentence",
        )
        const beatsAligned = beatProses.length === outline.scenes.length
        const offsetsPresent = proseIntegrityIssues.every(i => typeof i.offset === "number")
        const eligibleForSettle =
          allDuplicate && beatsAligned && offsetsPresent && attempts < maxAttempts

        if (eligibleForSettle) {
          const initialBeatRouting = new Map<number, string[]>()
          for (const issue of proseIntegrityIssues) {
            const beatIdx = offsetToBeatIndex(issue.offset!, beatProses)
            if (beatIdx < 0) continue
            const desc = `Duplicate ${issue.kind === "duplicate-sentence" ? "sentence" : "fragment"} repeats earlier text — first occurrence: "${(issue.firstExcerpt ?? "").slice(0, 200)}"; this beat's repeat: "${issue.excerpt.slice(0, 200)}". Rewrite this beat with different phrasing while preserving the events, emotional beats, and POV.`
            const list = initialBeatRouting.get(beatIdx) ?? []
            list.push(desc)
            initialBeatRouting.set(beatIdx, list)
          }

          if (initialBeatRouting.size > 0 && initialBeatRouting.size <= 2) {
            let integritySettlePass = 0
            const settleOutcome = await runSettleLoop<typeof proseIntegrityIssues>({
              initialResult: proseIntegrityIssues,
              check: async () => {
                prose = beatProses.join("\n\n")
                wordCount = prose.split(/\s+/).filter(Boolean).length
                return detectProseIntegrityIssues(prose)
              },
              isPass: r => r.length === 0,
              route: r => {
                const m = new Map<number, string[]>()
                for (const issue of r) {
                  if (issue.kind !== "duplicate-fragment" && issue.kind !== "duplicate-sentence") continue
                  if (typeof issue.offset !== "number") continue
                  const beatIdx = offsetToBeatIndex(issue.offset, beatProses)
                  if (beatIdx < 0) continue
                  const desc = `Duplicate ${issue.kind === "duplicate-sentence" ? "sentence" : "fragment"} repeats earlier text — first occurrence: "${(issue.firstExcerpt ?? "").slice(0, 200)}"; this beat's repeat: "${issue.excerpt.slice(0, 200)}". Rewrite this beat with different phrasing while preserving the events, emotional beats, and POV.`
                  const list = m.get(beatIdx) ?? []
                  list.push(desc)
                  m.set(beatIdx, list)
                }
                // Cap at 2 beats — if more are involved, the settle path is
                // not the right tool; fall through to chapter-attempt retry.
                return m.size <= 2 ? m : new Map<number, string[]>()
              },
              rewriteBeat: async (bi, issueDescriptions) => {
                const beatWriterModel = getModelForAgent("beat-writer")
                const beatSystemPrompt = BEAT_WRITER_PROMPT
                const characters = await getCharacters(novelId)
                const charStates = await getCharacterStatesAtChapter(novelId, ch)
                const worldBible = await getWorldBible(novelId)
                const priorChapterFacts = ch > 1
                  ? selectWriterFactsForPolicy(await getFactsUpToChapter(novelId, ch - 1), eff.factRoleContextPolicy)
                  : []
                const beatSpec = outline.scenes[bi]
                const preResolved = await resolveReferences(beatSpec, outline, novelId, ch, characters)
                  .catch(() => ({ context: "", lookupCount: 0, llmUsed: false }))
                const beatCtx = await buildBeatContext({
                  novelId, chapterNumber: ch, beatIndex: bi,
                  previousBeatProse: beatProses[bi - 1],
                  outline, characters, characterStates: charStates, worldBible,
                  preResolvedRefs: preResolved,
                  genre: novel.seed?.genre,
                  priorChapterFacts,
                })
                const priorProse = beatProses[bi]
                const retryContext = `\n\n--- TARGETED REWRITE (chapter integrity check) ---\nYour previous prose for this beat:\n---\n${priorProse.slice(0, 2000)}\n---\nIntegrity issues found:\n${issueDescriptions.map(s => `- ${s}`).join("\n")}\nRewrite this beat to address the issues above while preserving what works.`
                try {
                  const response = await executeAndLog(
                    {
                      systemPrompt: beatSystemPrompt,
                      userPrompt: beatCtx.userPrompt + retryContext + formatChapterUngroundedRetryContext(priorUngroundedEntities),
                      model: beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507",
                      provider: beatWriterModel?.provider ?? "cerebras",
                      temperature: beatWriterModel?.temperature ?? 0.8,
                      maxTokens: beatWriterModel?.maxTokens ?? 4000,
                      responseFormat: { type: "text" },
                    },
                    novelId,
                    "beat-writer",
                    { chapter: ch, beatIndex: bi, beatId: beatSpec.beatId, attempt: attempts + 100 + integritySettlePass * 10 },
                    {
                      stream: true,
                      meta: {
                        ...beatStableIdTraceMeta(outline, beatSpec),
                        rewriteSource: "integrity-check",
                      },
                    },
                  )
                  const rewritten = response.content?.trim()
                  if (rewritten && rewritten.length >= 50) {
                    beatProses[bi] = rewritten
                    return rewritten
                  }
                  return null
                } catch (err) {
                  log(novelId, "warn", `Beat ${bi + 1} integrity rewrite failed: ${err instanceof Error ? err.message : err}`)
                  return null
                }
              },
              budget: 1,
              canSettle: () => beatsAligned,
              onPassStart: async (passNumber, perBeat) => {
                integritySettlePass = passNumber
                console.log(`  Integrity settle pass ${passNumber}: rewriting ${perBeat.size} beats (${[...perBeat.keys()].sort((a, b) => a - b).join(",")})`)
                log(novelId, "info", `Integrity settle pass ${passNumber}: targeted rewrite of beats [${[...perBeat.keys()].sort((a, b) => a - b).join(",")}]`)
              },
              onIteration: async (passNumber, result) => {
                await trace(novelId, {
                  eventType: "integrity-settle-recheck", chapter: ch,
                  payload: { passNumber, issueCount: result.length, issues: result },
                })
              },
              onSettleComplete: async (outcome) => {
                await trace(novelId, {
                  eventType: "integrity-settle-complete", chapter: ch,
                  payload: {
                    kind: outcome.kind,
                    passes: "passes" in outcome ? outcome.passes : 0,
                    initialBeatCount: initialBeatRouting.size,
                  },
                })
              },
            })

            if (settleOutcome.kind === "accepted") {
              prose = beatProses.join("\n\n")
              wordCount = prose.split(/\s+/).filter(Boolean).length
              await saveChapterDraft(novelId, ch, prose, wordCount)
              proseIntegrityIssues = []
              // Canonical `prose-integrity-check passed=true` trace fires
              // below at the success branch (line ~1516). The
              // `integrity-settle-complete` trace already records that the
              // pass came via the settle path; emitting two pass-traces
              // would double-count in analytics.
              log(novelId, "info", `Chapter ${ch} integrity cleared via per-beat targeted rewrite (${settleOutcome.passes} pass)`)
              console.log(`  Prose integrity CLEARED via L70b per-beat targeted rewrite`)
            }
          }
        }
      }

      if (proseIntegrityIssues.length > 0) {
        const summary = proseIntegrityIssues.map(i => `${i.kind}: ${i.excerpt}`).join("; ")
        log(novelId, "warn", `Prose integrity failed for chapter ${ch}: ${summary}`)
        console.log(`  Prose integrity FAILED (${proseIntegrityIssues.length} issues); retrying chapter`)
        for (const issue of proseIntegrityIssues) {
          await saveIssue(novelId, {
            severity: "blocker",
            description: `Prose integrity ${issue.kind}: ${issue.excerpt}`,
            chapter: ch,
          })
        }
        // L41: stash the issue list so the next chapter-attempt's beat-writer
        // calls include the avoidance reminder. Cleared on integrity pass below.
        priorIntegrityIssues = proseIntegrityIssues.map(i => ({ kind: i.kind, excerpt: i.excerpt }))

        // L64: on the FINAL attempt, integrity failure routes to the plan-
        // assist gate (`integrity-exhausted` kind) instead of silently
        // continuing to a paused chapter. Mirrors the existing
        // `plan-check-exhausted` dispatch shape so the operator can
        // edit-plan / override / abort instead of being invisible to the
        // chapter exhaustion. Earlier attempts keep the existing retry
        // behavior.
        if (attempts >= maxAttempts) {
          const integrityExhaustionPayload = {
            kind: "integrity-exhausted" as const,
            novelId,
            chapter: ch,
            attempt: attempts,
            outline,
            prose,
            unresolvedDeviations: proseIntegrityIssues.map(i => ({
              description: `Prose integrity ${i.kind}: ${i.excerpt}`,
              beat_index: null as number | null,
            })),
          }
          const decision = await presentForExhaustion(integrityExhaustionPayload)
          if (decision.action === "edit-plan") {
            const previousOutline = outline
            outline = normalizePlanAssistReplacementOutline(previousOutline, decision.outline)
            await saveChapterOutline(novelId, outline)
            await recordPlanAssistOutlineLineage({
              novelId,
              chapter: ch,
              payload: integrityExhaustionPayload,
              exhaustionId: decision.exhaustionId,
              previousOutline,
              nextOutline: outline,
            }).catch((err) => {
              log(novelId, "warn", `Integrity-exhaustion outline lineage failed: ${err instanceof Error ? err.message : err}`)
            })
            log(novelId, "info", `Chapter ${ch} outline edited via integrity-exhaustion gate: ${outline.scenes.length} beats`)
            console.log(`  [PLAN-ASSIST] outline edited at integrity exhaustion; chapter will retry from new plan on resume`)
          } else if (decision.action === "override") {
            await setPlanCheckOverridden(novelId, ch, true)
            await recordPlanAssistOverrideLineage({
              novelId,
              chapter: ch,
              payload: integrityExhaustionPayload,
              exhaustionId: decision.exhaustionId,
              outline,
              previousValue: planCheckOverridden,
              nextValue: true,
            }).catch((err) => {
              log(novelId, "warn", `Integrity-exhaustion override lineage failed: ${err instanceof Error ? err.message : err}`)
            })
            log(novelId, "info", `Chapter ${ch} plan-check overridden via integrity-exhaustion gate`)
            console.log(`  [PLAN-ASSIST] plan-check override persisted; resume will skip strict checks`)
          } else {
            log(novelId, "warn", `Chapter ${ch} aborted by user at integrity-exhaustion gate`)
            console.log(`  [PLAN-ASSIST] chapter aborted by user at integrity-exhaustion gate.`)
            chapterAborted = true
          }
        }
        continue
      }
      await trace(novelId, {
        eventType: "prose-integrity-check", chapter: ch,
        payload: { passed: true, issues: [] },
      })
      // L41: integrity passed → clear the carry-over so subsequent beats
      // don't see stale avoidance context (defensive; the chapter will exit
      // the while-loop on approval shortly).
      priorIntegrityIssues = []

      if (eff.continuityEditorialFlagProposals && issues.length > 0) {
        try {
          emit(novelId, { type: "progress", data: { step: "continuity-editorial-flags", chapter: ch, status: "running" } })
          const continuityProposalStart = Date.now()
          const proposalResult = await persistContinuityEditorialFlagProposals({
            novelId,
            chapter: ch,
            prose,
            issues,
          })
          await trace(novelId, {
            eventType: "continuity-editorial-flag-proposals",
            chapter: ch,
            durationMs: Date.now() - continuityProposalStart,
            payload: { ...proposalResult },
          })
          console.log(
            `  Continuity editorial flags: ${proposalResult.inserted} inserted, ${proposalResult.skipped} existing, ${proposalResult.errors.length} errors`,
          )
          log(
            novelId,
            proposalResult.errors.length > 0 ? "warn" : "info",
            `Continuity editorial_flag proposals for chapter ${ch}: generated=${proposalResult.generated} inserted=${proposalResult.inserted} skipped=${proposalResult.skipped} errors=${proposalResult.errors.length}`,
          )
          emit(novelId, { type: "progress", data: { step: "continuity-editorial-flags", chapter: ch, status: "complete" } })
        } catch (err) {
          log(novelId, "warn", `Continuity editorial flag persistence failed for chapter ${ch}: ${err}`)
          console.log(`  Continuity editorial flags failed (non-blocking): ${err instanceof Error ? err.message : err}`)
          emit(novelId, { type: "progress", data: { step: "continuity-editorial-flags", chapter: ch, status: "failed" } })
        }
      }

      // 5. Human gate
      let displayContent = prose
      if (issues.length > 0) {
        displayContent += `\n\n--- CONTINUITY ISSUES ---\n${issues.map((i: any) => `[${i.severity}] ${i.description}`).join("\n")}`
      }
      if (functionalIssues.length > 0) {
        displayContent += `\n\n--- FUNCTIONAL CHECKS ---\n${functionalIssues.map(i => `[${i.severity}] ${i.description}`).join("\n")}`
      }
      if (validation.warnings.length > 0) {
        displayContent += `\n\n--- VALIDATION WARNINGS ---\n${validation.warnings.join("\n")}`
      }
      if (lintSummary) {
        displayContent += lintSummary
      }

      const decision = await presentForApproval(
        novelId,
        `drafting:chapter-${ch}`,
        `Chapter ${ch}: "${outline.title}" (${wordCount} words)`,
        displayContent,
      )

      if (decision === "approve") {
        approved = true
        await approveChapterDraft(novelId, ch)

        emit(novelId, { type: "progress", data: { step: "state-extraction", chapter: ch, status: "running" } })
        const extractStart = Date.now()
        await savePlannedState(novelId, ch, outline)
        await trace(novelId, {
          eventType: "state-extraction", chapter: ch,
          durationMs: Date.now() - extractStart,
          payload: { mode: "plan" },
        })
        emit(novelId, { type: "progress", data: { step: "state-extraction", chapter: ch, status: "complete" } })

        await updateCurrentChapter(novelId, ch + 1)
        log(novelId, "checkpoint", `Chapter ${ch} approved. currentChapter → ${ch + 1}`)

        // Write to file
        const dir = `output/${novelId}`
        await Bun.write(`${dir}/chapter-${ch}.md`, `# Chapter ${ch}: ${outline.title}\n\n${prose}`)
        console.log(`  Chapter ${ch} approved and saved.`)
        emit(novelId, { type: "progress", data: { step: "drafting", chapter: ch, status: "approved" } })

      } else if (decision === "revise") {
        // Get revision notes — check if the pending gate had notes attached
        const pendingGate = gates.getPending(novelId)
        const gateDecision = pendingGate ? undefined : undefined // gate already resolved
        const notes = await getRevisionNotes()
        for (const note of notes) {
          await saveIssue(novelId, { severity: "blocker", description: note, chapter: ch })
        }
        log(novelId, "info", `Chapter ${ch} revision requested: ${notes.length} notes`)
        console.log(`  ${notes.length} revision notes recorded. Retrying...`)

      } else {
        log(novelId, "info", `Chapter ${ch} rejected, retrying`)
        console.log("  Chapter rejected. Retrying from scratch...")
      }
    }

    await trace(novelId, {
      eventType: "chapter-complete",
      chapter: ch,
      durationMs: Date.now() - chapterStart,
      payload: { approved, attempts },
    })

    if (chapterAborted) {
      log(novelId, "warn", `Chapter ${ch} aborted via plan-assist gate — stopping drafting phase. Resume after manual intervention.`)
      console.log(`\n  Chapter ${ch} aborted by user at plan-assist gate.`)
      console.log("  Stopping drafting. Resume later after manual outline edit or clearing the override.")
      return { kind: "paused", reason: `plan-assist-gate-aborted:ch${ch}` }
    }

    if (!approved) {
      log(novelId, "error", `Chapter ${ch} failed after ${maxAttempts} attempts`)
      console.log(`\n  Chapter ${ch} failed after ${maxAttempts} attempts.`)
      console.log("  Stopping drafting. Resume later with --resume flag.")
      return { kind: "paused", reason: `chapter-attempts-exhausted:ch${ch}` }
    }
  }

  // P6b1: phase transition is driver-owned.
  log(novelId, "info", "All chapters drafted. Advancing to validation.")
  console.log("\n  All chapters drafted. Advancing to Validation.\n")

  const output = await loadDraftingOutput(novelId)
  return { kind: "complete", output }
}

/** Reconstruct DraftingOutput from DB. Called on resume by the typed
 *  driver (P6b1+). Only invoked when novel.phase has advanced past
 *  drafting — at that point all approved chapters have status='approved'
 *  rows in chapter_drafts. Reads from chapter_drafts, chapter_exhaustions,
 *  chapter_revisions, chapter_outlines, facts, character_states,
 *  character_knowledge. */
export async function loadDraftingOutput(novelId: string): Promise<DraftingOutput> {
  const approvedRows = (await db.unsafe(
    `SELECT DISTINCT chapter_number FROM chapter_drafts WHERE novel_id = $1 AND status = 'approved' ORDER BY chapter_number`,
    [novelId],
  )) as Array<{ chapter_number: number }>

  const exhaustionRows = (await db.unsafe(
    `SELECT chapter, kind FROM chapter_exhaustions WHERE novel_id = $1 ORDER BY chapter, attempt`,
    [novelId],
  )) as Array<{ chapter: number; kind: string }>

  // ORDER BY (chapter, invoked_at, id) matches the existing helper at
  // db/chapter-revisions.ts:92-100. Two revisions can share (chapter,
  // attempt) — one from the plan-check path (drafting.ts:740-775) and one
  // from the validation path (drafting.ts:1015-1053). Sorting by attempt
  // alone is non-deterministic across runs; invoked_at preserves the
  // emission order, with id as the in-millisecond tie-breaker.
  const revisionRows = (await db.unsafe(
    `SELECT chapter, outcome FROM chapter_revisions WHERE novel_id = $1 ORDER BY chapter, invoked_at, id`,
    [novelId],
  )) as Array<{ chapter: number; outcome: string }>

  const outlines = await getChapterOutlines(novelId)
  const planCheckOverridden = await Promise.all(
    outlines.map(async o => ({
      ch: o.chapterNumber,
      overridden: await isPlanCheckOverridden(novelId, o.chapterNumber),
    })),
  )

  const factsCount = ((await db.unsafe(
    `SELECT COUNT(*)::int AS n FROM facts WHERE novel_id = $1`,
    [novelId],
  )) as Array<{ n: number }>)[0]?.n ?? 0
  const characterStatesCount = ((await db.unsafe(
    `SELECT COUNT(*)::int AS n FROM character_states WHERE novel_id = $1`,
    [novelId],
  )) as Array<{ n: number }>)[0]?.n ?? 0
  const knowledgeChangesCount = ((await db.unsafe(
    `SELECT COUNT(*)::int AS n FROM character_knowledge WHERE novel_id = $1`,
    [novelId],
  )) as Array<{ n: number }>)[0]?.n ?? 0

  return {
    approvedChapters: approvedRows.map(r => r.chapter_number),
    exhaustions: exhaustionRows.map(r => ({
      chapter: r.chapter,
      kind: r.kind as ExhaustionKind,
    })),
    revisions: revisionRows.map(r => ({
      chapter: r.chapter,
      outcome: r.outcome as RevisionOutcome,
    })),
    planCheckOverridden: planCheckOverridden.filter(p => p.overridden).map(p => p.ch),
    plannedStateWritten: { factsCount, characterStatesCount, knowledgeChangesCount },
  }
}

/** P4 — Phase<PlanningOutput, DraftingOutput> wrapper. Not yet consumed by
 *  the state-machine; P6b1 flips the driver to use it. */
export const draftingPhase: Phase<PlanningOutput, DraftingOutput> = {
  name: "drafting",
  async run(_input, ctx) {
    return runDraftingPhase(ctx.novelId)
  },
  async loadOutput(novelId) {
    return loadDraftingOutput(novelId)
  },
}
