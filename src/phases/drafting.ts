import { chapterDraftSchema } from "../types"
import {
  getNovel, getChapterOutline, getCharacters, getFactsUpToChapter,
  getCharacterStatesAtChapter, getAllCharacterStatesBeforeChapter, getWorldBible,
  saveChapterDraft, approveChapterDraft, getApprovedDraft,
  saveIssue, updateCurrentChapter, updatePhase,
} from "../db"
import { callAgent, executeAndLog } from "../llm"
import { getTransport } from "../transport"
import { WRITER_AGENT_PROMPT, BEAT_WRITER_PROMPT, CHAPTER_PLAN_CHECKER_PROMPT } from "../prompts"
import { buildContext as buildWriterContext } from "../agents/writer/context"
import { buildBeatContext } from "../agents/writer/beat-context"
import { resolveReferences } from "../agents/writer/reference-resolver"
import { runBeatChecks, summarizeIssues } from "./beat-checks"
import { checkContinuity } from "../agents/continuity/check"
import { buildContext as buildChapterPlanCheckContext } from "../agents/chapter-plan-checker/context"
import { chapterPlanCheckSchema } from "../agents/chapter-plan-checker/schema"
import { buildContext as buildChapterPlanReviseContext } from "../agents/chapter-plan-reviser/context"
import { chapterBeatsSchema as chapterPlanReviseSchema, prompt as CHAPTER_PLAN_REVISER_PROMPT } from "../agents/chapter-plan-reviser"
import { validateChapterDraft } from "../validation"
import { displayPhaseHeader, displayProgress, presentForApproval, getRevisionNotes } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import { trace } from "../trace"
import { savePlannedState } from "../planned-state"
import { diffPlanAgainstState, type PriorCharacterState } from "../state-diff"
import { pipeline } from "../config/pipeline"
import * as gates from "../gates"
import { lintProse } from "../lint"
import { fixLintIssues } from "../lint/fix"
import { getModelForAgent, resolveWriterPack, type WriterGenrePack } from "../models/roles"
import { loadGenrePackPrompt } from "../agents/writer"
import type { ChapterOutline } from "../types"

/**
 * Route validation blockers to specific beat indices for targeted rewrites.
 * Drafting-mode blockers come in two flavors (see src/validation.ts:21-37):
 *   - word-count blockers: "Chapter too short: …" / "Chapter far below target: …"
 *   - pov-missing blocker: 'POV character "X" never mentioned in draft'
 *
 * Heuristics (no LLM call):
 *   - word-count → expand the two shortest beats
 *   - pov-missing → rewrite the beat that plans the POV character with the
 *     smallest cast size (tie-break earliest index)
 */
function routeValidationBlockers(
  blockers: string[],
  outline: ChapterOutline,
  beatProses: string[],
): Map<number, string[]> {
  const perBeat = new Map<number, string[]>()
  const addTo = (idx: number, desc: string) => {
    if (idx < 0 || idx >= outline.scenes.length) return
    const list = perBeat.get(idx) ?? []
    list.push(desc)
    perBeat.set(idx, list)
  }

  for (const blocker of blockers) {
    if (blocker.includes("too short") || blocker.includes("far below target")) {
      const withLen = beatProses
        .map((p, i) => ({ i, len: p.split(/\s+/).filter(Boolean).length }))
        .sort((a, b) => a.len - b.len)
      const targets = withLen.slice(0, Math.min(2, withLen.length))
      for (const t of targets) {
        addTo(t.i, `Chapter is under the target word count — expand this beat with additional description, interiority, or dialogue as the beat's purpose allows.`)
      }
    } else if (blocker.startsWith("POV character") && blocker.includes("never mentioned")) {
      const pov = outline.povCharacter
      const candidates = outline.scenes
        .map((s, i) => ({ i, castSize: s.characters?.length ?? 0, hasPov: s.characters?.includes(pov) }))
        .filter(c => c.hasPov)
        .sort((a, b) => a.castSize - b.castSize || a.i - b.i)
      const target = candidates[0] ?? { i: 0 }
      addTo(target.i, `POV character "${pov}" must be dramatized — ensure this beat puts "${pov}" on the page by name or clear referent.`)
    } else {
      // Unknown blocker type — append to beat 0 as last resort
      addTo(0, `Validation issue: ${blocker}`)
    }
  }

  return perBeat
}

export async function runDraftingPhase(novelId: string): Promise<void> {
  displayPhaseHeader("Drafting — Writing chapters")
  emit(novelId, { type: "phase:changed", data: { phase: "drafting" } })

  const novel = await getNovel(novelId)
  const totalChapters = novel.totalChapters

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
      return
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
    let revisionUsed = false
    let lastUnresolvedSig = ""

    while (!approved && attempts < maxAttempts) {
      attempts++
      console.log(`\n  --- Chapter ${ch}: "${outline.title}" (attempt ${attempts}/${maxAttempts}) ---`)
      log(novelId, "info", `Chapter ${ch} "${outline.title}" attempt ${attempts}`)

      // 1-2. Context assembly + writer (beat-level or chapter-level)
      let prose: string
      let wordCount: number
      // Hoisted so the chapter-plan-checker settle loop (further down) can
      // run targeted beat rewrites without rebuilding state.
      let beatProses: string[] = []
      let writerPack: WriterGenrePack | null = null
      let packPrompt: string | null = null

      if (pipeline.beatLevelWriting && outline.scenes.length > 0) {
        // ── Beat-level generation ───────────────────────────────────────
        try {
          console.log(`  Writing ${outline.scenes.length} beats...`)
          emit(novelId, { type: "progress", data: { step: "beat-writer", chapter: ch, attempt: attempts, status: "running" } })

          // Genre-scoped writer pack — routes this novel's beat-writer to a
          // voice LoRA when its genre matches. Falls back to the default
          // BEAT_WRITER_PROMPT + configured `beat-writer` model otherwise.
          writerPack = resolveWriterPack(novel.seed?.genre)
          packPrompt = writerPack
            ? await loadGenrePackPrompt(writerPack.systemPromptFile, writerPack.usePrimer)
            : null
          if (writerPack) {
            console.log(`  Writer pack: ${writerPack.label} (${writerPack.model.model})`)
            log(novelId, "info", `Beat-writer routed to genre pack "${writerPack.label}" for genre "${novel.seed?.genre}"`)
          }

          const characters = await getCharacters(novelId)
          const charStates = await getCharacterStatesAtChapter(novelId, ch)
          const worldBible = await getWorldBible(novelId)

          // Pre-resolve all beat references in parallel before the serial writing loop.
          // Kept for all writer routes — exp #200 regressed when we skipped this
          // for voice-LoRA routes; world-fact requirements travel through the
          // resolved-references section and the writer can't establish them
          // without it. See docs/beat-writer-architecture.md §6.
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
              // Voice-LoRA routes use compact prompts (no runtime state
              // fields, one-line character snapshots, no resolved-refs
              // block). See docs/beat-writer-architecture.md.
              compactMode: !!writerPack,
            })

            let beatProse: string | null = null
            const beatWriterModel = writerPack?.model ?? getModelForAgent("beat-writer")
            const beatSystemPrompt = packPrompt ?? BEAT_WRITER_PROMPT
            const beatSpec = outline.scenes[bi]
            let previousProse: string | null = null
            let previousIssues: string[] = []
            for (let retry = 0; retry <= pipeline.maxBeatRetries; retry++) {
              let retryContext = ""
              if (retry > 0 && previousProse && previousIssues.length > 0) {
                const hasEventIssue = previousIssues.some(i => i.includes("not enacted"))
                const priorBeatProse = bi > 0 ? beatProses[bi - 1] : null
                const alignmentNote = hasEventIssue && priorBeatProse
                  ? `\nNote: The previous beat's prose (below) may already cover some of this beat's actions — this is natural prose flow. Focus on actions NOT yet dramatized. Do not duplicate what the prior beat already covered.\n\nPrevious beat's prose (last 500 chars):\n---\n${priorBeatProse.slice(-500)}\n---\n`
                  : ""
                retryContext = `\n\n--- TARGETED REWRITE ---\nYour previous prose for this beat:\n---\n${previousProse.slice(0, 2000)}\n---\nIssues found:\n${previousIssues.map(i => `- ${i}`).join("\n")}${alignmentNote}\nRewrite this beat to address the issues above while preserving what works.`
              }
              try {
                const response = await executeAndLog(
                  {
                    systemPrompt: beatSystemPrompt,
                    userPrompt: beatCtx.userPrompt + retryContext,
                    model: beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507",
                    provider: beatWriterModel?.provider ?? "cerebras",
                    temperature: beatWriterModel?.temperature ?? 0.8,
                    maxTokens: beatWriterModel?.maxTokens ?? 4000,
                    responseFormat: { type: "text" },
                  },
                  novelId,
                  "beat-writer",
                  { chapter: ch, beatIndex: bi, attempt: retry + 1 },
                  {
                    stream: true,
                    meta: {
                      beatDescription: beatSpec.description,
                      beatCharacters: beatSpec.characters,
                      totalBeats: outline.scenes.length,
                      chapterTitle: outline.title,
                    },
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
                  writerPackLabel: writerPack?.label ?? null,
                  tags: { novelId, chapter: ch, beatIndex: bi, attempt: retry + 1 },
                })
                if (checks.pass || retry === pipeline.maxBeatRetries) {
                  beatProse = prose
                  if (!checks.pass) {
                    log(novelId, "warn", `Beat ${bi + 1} issues accepted after max retries: ${summarizeIssues(checks.issues)}`)
                  }
                  break
                }
                previousProse = prose
                previousIssues = checks.retryLines
                log(novelId, "info", `Beat ${bi + 1} retry ${retry + 1}: ${summarizeIssues(checks.issues)}`)
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
          } else {
            // Fallback to chapter-level
            console.log("  Beat generation incomplete, falling back to chapter-level...")
            log(novelId, "info", `Beat fallback → chapter-level for chapter ${ch}`)
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
        pipeline.chapterPlanCheck
          ? callAgent({
              novelId, agentName: "chapter-plan-checker",
              chapter: ch, attempt: attempts,
              systemPrompt: CHAPTER_PLAN_CHECKER_PROMPT,
              userPrompt: buildChapterPlanCheckContext(prose, outline),
              schema: chapterPlanCheckSchema,
            })
          : Promise.resolve(null),
        (async () => {
          const facts = await getFactsUpToChapter(novelId, ch)
          const charStates = await getCharacterStatesAtChapter(novelId, ch)
          return checkContinuity(prose, facts, charStates, { novelId, chapter: ch, attempt: attempts })
        })(),
      ])

      const validation = validateChapterDraft(prose, outline)
      await trace(novelId, {
        eventType: "validation-check", chapter: ch,
        payload: { passed: validation.passed, blockers: validation.blockers, warnings: validation.warnings },
      })
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
      if (pipeline.chapterPlanCheck) {
        if (planCheckSettled.status === "fulfilled" && planCheckSettled.value !== null) {
          let out = planCheckSettled.value.output
          let rewritePass = 0
          const canSettle = beatProses.length === outline.scenes.length

          while (!out.pass && rewritePass < pipeline.maxChapterPlanRewritePasses && canSettle) {
            const devs = out.deviations ?? []
            devs.forEach(d => console.log(`    DEVIATION (beat ${d.beat_index ?? "chapter-level"}): ${d.description}`))

            // Map deviations → Map<beatIdx, string[]>
            const perBeat = new Map<number, string[]>()
            const addTo = (idx: number, desc: string) => {
              if (idx < 0 || idx >= outline.scenes.length) return
              const list = perBeat.get(idx) ?? []
              list.push(desc)
              perBeat.set(idx, list)
            }
            for (const d of devs) {
              if (d.beat_index != null) {
                addTo(d.beat_index, d.description)
              }
            }
            // Heuristic routing for chapter-level issues (no beat_index)
            const hasChapterLevel = devs.some(d => d.beat_index == null)
            if (hasChapterLevel || (out.setting_match && !out.setting_match.matches)) {
              if (out.setting_match && !out.setting_match.matches) {
                addTo(0, `Chapter setting mismatch — planned "${out.setting_match.planned}" but prose observed "${out.setting_match.observed}"`)
              }
            }
            if (out.emotional_arc_correct === false) {
              const lastN = outline.scenes.length >= 12 ? 3 : 2
              for (let i = outline.scenes.length - lastN; i < outline.scenes.length; i++) {
                addTo(i, "Emotional arc reversed from plan — the closing beats should land the planned emotion direction, not invert it")
              }
            }
            // Any remaining chapter-level deviation strings get appended to beat 0 as a last resort
            for (const d of devs) {
              if (d.beat_index == null && out.setting_match?.matches !== false && out.emotional_arc_correct !== false) {
                addTo(0, d.description)
              }
            }

            if (perBeat.size === 0) {
              log(novelId, "warn", "Plan check failed but no beat mapping — escalating to full restart")
              bail = true
              break
            }

            rewritePass++
            console.log(`  Plan check pass ${rewritePass}/${pipeline.maxChapterPlanRewritePasses}: rewriting ${perBeat.size} beats (${[...perBeat.keys()].sort((a, b) => a - b).join(",")})`)
            log(novelId, "info", `Plan-check settle pass ${rewritePass}: targeted rewrite of beats [${[...perBeat.keys()].sort((a, b) => a - b).join(",")}]`)

            // Rewrite each affected beat — reuses the beat-writer TARGETED REWRITE
            // prompt shape from the per-beat retry loop above.
            const beatWriterModel = writerPack?.model ?? getModelForAgent("beat-writer")
            const beatSystemPrompt = packPrompt ?? BEAT_WRITER_PROMPT
            const characters = await getCharacters(novelId)
            const charStates = await getCharacterStatesAtChapter(novelId, ch)
            const worldBible = await getWorldBible(novelId)

            for (const [bi, issueDescriptions] of [...perBeat.entries()].sort(([a], [b]) => a - b)) {
              const beatSpec = outline.scenes[bi]
              const preResolved = await resolveReferences(beatSpec, outline, novelId, ch, characters)
                .catch(() => ({ context: "", lookupCount: 0, llmUsed: false }))
              const beatCtx = await buildBeatContext({
                novelId, chapterNumber: ch, beatIndex: bi,
                previousBeatProse: beatProses[bi - 1],
                outline, characters, characterStates: charStates, worldBible,
                preResolvedRefs: preResolved,
                compactMode: !!writerPack,
              })
              const priorProse = beatProses[bi]
              const retryContext = `\n\n--- TARGETED REWRITE (chapter-plan check) ---\nYour previous prose for this beat:\n---\n${priorProse.slice(0, 2000)}\n---\nChapter-plan issues found:\n${issueDescriptions.map(s => `- ${s}`).join("\n")}\nRewrite this beat to address the issues above while preserving what works.`
              try {
                const response = await executeAndLog(
                  {
                    systemPrompt: beatSystemPrompt,
                    userPrompt: beatCtx.userPrompt + retryContext,
                    model: beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507",
                    provider: beatWriterModel?.provider ?? "cerebras",
                    temperature: beatWriterModel?.temperature ?? 0.8,
                    maxTokens: beatWriterModel?.maxTokens ?? 4000,
                    responseFormat: { type: "text" },
                  },
                  novelId,
                  "beat-writer",
                  { chapter: ch, beatIndex: bi, attempt: attempts + rewritePass * 10 },
                  {
                    stream: true,
                    meta: {
                      beatDescription: beatSpec.description,
                      beatCharacters: beatSpec.characters,
                      totalBeats: outline.scenes.length,
                      chapterTitle: outline.title,
                      rewriteSource: "chapter-plan-check",
                    },
                  },
                )
                const rewritten = response.content?.trim()
                if (rewritten && rewritten.length >= 50) {
                  beatProses[bi] = rewritten
                }
              } catch (err) {
                log(novelId, "warn", `Beat ${bi + 1} plan-check rewrite failed: ${err instanceof Error ? err.message : err}`)
              }
            }

            // Rebuild prose from the updated beat list and re-run plan check
            prose = beatProses.join("\n\n")
            wordCount = prose.split(/\s+/).filter(Boolean).length
            console.log(`  Rewrite complete — re-running plan check on ${wordCount}w prose`)
            const recheck = await callAgent({
              novelId, agentName: "chapter-plan-checker",
              chapter: ch, attempt: attempts + rewritePass * 10,
              systemPrompt: CHAPTER_PLAN_CHECKER_PROMPT,
              userPrompt: buildChapterPlanCheckContext(prose, outline),
              schema: chapterPlanCheckSchema,
            })
            out = recheck.output
          }

          if (!out.pass) {
            out.deviations?.forEach(d => console.log(`    UNRESOLVED DEVIATION (beat ${d.beat_index ?? "chapter-level"}): ${d.description}`))

            // Planner escalation — pass unresolved issues back to the
            // chapter-plan-reviser ONCE per chapter. If the reviser produces
            // a new plan, replace outline.scenes + restart drafting for this
            // chapter attempt. If we already revised or the issue signature
            // is identical to a prior revision's input, skip (bounded loop).
            const issueSig = (out.deviations ?? []).map(d => `${d.beat_index ?? "c"}:${d.description}`).sort().join("|")
            const canRevise = !revisionUsed && issueSig !== lastUnresolvedSig && canSettle

            if (canRevise) {
              console.log(`  Escalating to chapter-plan-reviser (persistent issues)`)
              log(novelId, "info", `Invoking chapter-plan-reviser for chapter ${ch}: ${(out.deviations ?? []).length} unresolved issues`)
              try {
                const reviseCtx = buildChapterPlanReviseContext(
                  outline,
                  prose,
                  (out.deviations ?? []).map(d => `[beat ${d.beat_index ?? "chapter-level"}] ${d.description}`),
                )
                const revised = await callAgent({
                  novelId, agentName: "chapter-plan-reviser",
                  chapter: ch, attempt: attempts,
                  systemPrompt: CHAPTER_PLAN_REVISER_PROMPT,
                  userPrompt: reviseCtx,
                  schema: chapterPlanReviseSchema,
                })
                // Merge skeleton fields + replace plan fields. Cast through
                // unknown because chapterBeatsSchema's z.infer resolves some
                // defaulted fields as optional while chapterOutlineSchema
                // resolves them as required; both produce the same runtime
                // shape after parse, so the cast is safe.
                outline = {
                  ...outline,
                  scenes: revised.output.scenes,
                  establishedFacts: revised.output.establishedFacts ?? outline.establishedFacts,
                  characterStateChanges: revised.output.characterStateChanges ?? outline.characterStateChanges,
                  knowledgeChanges: revised.output.knowledgeChanges ?? outline.knowledgeChanges,
                } as ChapterOutline
                revisionUsed = true
                lastUnresolvedSig = issueSig
                log(novelId, "info", `Chapter plan revised: ${outline.scenes.length} beats (was ${beatProses.length})`)
                console.log(`  Revised plan: ${outline.scenes.length} beats. Restarting chapter draft with revised plan.`)
                bail = true
              } catch (err) {
                log(novelId, "error", `Chapter-plan-reviser failed for chapter ${ch}: ${err instanceof Error ? err.message : err}`)
                console.error(`  Reviser error: ${err instanceof Error ? err.message : err}`)
                bail = true
              }
            } else {
              const reason = revisionUsed
                ? "already revised this attempt"
                : issueSig === lastUnresolvedSig
                  ? "identical issue signature as last revision"
                  : "beat-level state not available"
              log(novelId, "warn", `Plan check still failing — not escalating to reviser (${reason}); falling through to chapter restart`)
              bail = true
            }

            emit(novelId, { type: "progress", data: { step: "plan-check", chapter: ch, status: "failed" } })
          } else {
            if (rewritePass > 0) {
              console.log(`  Plan check: passed after ${rewritePass} targeted rewrite pass(es)`)
              log(novelId, "info", `Plan check passed after ${rewritePass} targeted rewrite pass(es)`)
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
      // chapter restart. Drafting-mode blockers (word-count + pov-missing)
      // route to beats via routeValidationBlockers(), then we call
      // beat-writer on only those beats with issue descriptions.
      if (!validation.passed) {
        console.log(`  Validation FAILED:`)
        validation.blockers.forEach(b => console.log(`    BLOCKER: ${b}`))
        validation.warnings.forEach(w => console.log(`    WARNING: ${w}`))
        log(novelId, "warn", `Validation failed: ${validation.blockers.join("; ")}`)

        let validationPass = 0
        const canSettle = beatProses.length === outline.scenes.length
        let currentBlockers = validation.blockers

        while (currentBlockers.length > 0 && validationPass < pipeline.maxChapterPlanRewritePasses && canSettle) {
          const perBeat = routeValidationBlockers(currentBlockers, outline, beatProses)
          if (perBeat.size === 0) break

          validationPass++
          console.log(`  Validation pass ${validationPass}/${pipeline.maxChapterPlanRewritePasses}: rewriting ${perBeat.size} beats (${[...perBeat.keys()].sort((a, b) => a - b).join(",")})`)
          log(novelId, "info", `Validation settle pass ${validationPass}: targeted rewrite of beats [${[...perBeat.keys()].sort((a, b) => a - b).join(",")}]`)

          const beatWriterModel = writerPack?.model ?? getModelForAgent("beat-writer")
          const beatSystemPrompt = packPrompt ?? BEAT_WRITER_PROMPT
          const characters = await getCharacters(novelId)
          const charStates = await getCharacterStatesAtChapter(novelId, ch)
          const worldBible = await getWorldBible(novelId)

          for (const [bi, issueDescriptions] of [...perBeat.entries()].sort(([a], [b]) => a - b)) {
            const beatSpec = outline.scenes[bi]
            const preResolved = await resolveReferences(beatSpec, outline, novelId, ch, characters)
              .catch(() => ({ context: "", lookupCount: 0, llmUsed: false }))
            const beatCtx = await buildBeatContext({
              novelId, chapterNumber: ch, beatIndex: bi,
              previousBeatProse: beatProses[bi - 1],
              outline, characters, characterStates: charStates, worldBible,
              preResolvedRefs: preResolved,
              compactMode: !!writerPack,
            })
            const priorProse = beatProses[bi]
            const retryContext = `\n\n--- TARGETED REWRITE (validation) ---\nYour previous prose for this beat:\n---\n${priorProse.slice(0, 2000)}\n---\nValidation issues found:\n${issueDescriptions.map(s => `- ${s}`).join("\n")}\nRewrite this beat to address the issues above while preserving what works.`
            try {
              const response = await executeAndLog(
                {
                  systemPrompt: beatSystemPrompt,
                  userPrompt: beatCtx.userPrompt + retryContext,
                  model: beatWriterModel?.model ?? "qwen-3-235b-a22b-instruct-2507",
                  provider: beatWriterModel?.provider ?? "cerebras",
                  temperature: beatWriterModel?.temperature ?? 0.8,
                  maxTokens: beatWriterModel?.maxTokens ?? 4000,
                  responseFormat: { type: "text" },
                },
                novelId,
                "beat-writer",
                { chapter: ch, beatIndex: bi, attempt: attempts + validationPass * 20 },
                {
                  stream: true,
                  meta: {
                    beatDescription: beatSpec.description,
                    beatCharacters: beatSpec.characters,
                    totalBeats: outline.scenes.length,
                    chapterTitle: outline.title,
                    rewriteSource: "validation",
                  },
                },
              )
              const rewritten = response.content?.trim()
              if (rewritten && rewritten.length >= 50) {
                beatProses[bi] = rewritten
              }
            } catch (err) {
              log(novelId, "warn", `Beat ${bi + 1} validation rewrite failed: ${err instanceof Error ? err.message : err}`)
            }
          }

          // Re-validate after rewrites
          prose = beatProses.join("\n\n")
          wordCount = prose.split(/\s+/).filter(Boolean).length
          const recheck = validateChapterDraft(prose, outline)
          currentBlockers = recheck.blockers
          if (currentBlockers.length === 0) {
            console.log(`  Validation: passed after ${validationPass} targeted rewrite pass(es)`)
            log(novelId, "info", `Validation passed after ${validationPass} targeted rewrite pass(es)`)
          } else {
            console.log(`  Validation still failing (${currentBlockers.length} blockers remain)`)
          }
        }

        if (currentBlockers.length > 0) {
          currentBlockers.forEach(b => console.log(`    UNRESOLVED BLOCKER: ${b}`))
          log(novelId, "warn", `Validation still failing after ${validationPass} targeted rewrite pass(es) — escalating to chapter restart`)
          bail = true
        }
      } else if (validation.warnings.length > 0) {
        validation.warnings.forEach(w => console.log(`    WARNING: ${w}`))
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
            prose = fixResult.prose
            wordCount = prose.split(/\s+/).filter(Boolean).length
            await saveChapterDraft(novelId, ch, prose, wordCount)
            console.log(`  Fixed: ${fixResult.deterministicFixes} deterministic, ${fixResult.llmFixes} LLM (${fixResult.unfixed} unfixed, $${fixResult.costUsd.toFixed(4)})`)
            log(novelId, "info", `Lint fixed ${totalFixed}/${lintResult.totalIssues} issues ($${fixResult.costUsd.toFixed(4)})`)
          }

          lintSummary = `\n\n--- LINT (${lintResult.totalIssues} found, ${totalFixed} fixed, ${fixResult.unfixed} remaining) ---\n` +
            Object.entries(lintResult.counts).map(([cat, count]) => `  ${cat}: ${count}`).join("\n")
        } else {
          console.log("  Lint: clean")
        }
        emit(novelId, { type: "progress", data: { step: "lint", chapter: ch, status: "complete" } })
      } catch (err) {
        log(novelId, "warn", `Lint/fix failed for chapter ${ch}: ${err}`)
        console.log(`  Lint failed (non-blocking): ${err instanceof Error ? err.message : err}`)
      }

      // 5. Human gate
      let displayContent = prose
      if (issues.length > 0) {
        displayContent += `\n\n--- CONTINUITY ISSUES ---\n${issues.map((i: any) => `[${i.severity}] ${i.description}`).join("\n")}`
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

    if (!approved) {
      log(novelId, "error", `Chapter ${ch} failed after ${maxAttempts} attempts`)
      console.log(`\n  Chapter ${ch} failed after ${maxAttempts} attempts.`)
      console.log("  Stopping drafting. Resume later with --resume flag.")
      return
    }
  }

  await updatePhase(novelId, "validation")
  emit(novelId, { type: "phase:changed", data: { phase: "validation" } })
  log(novelId, "info", "All chapters drafted. Advancing to validation.")
  console.log("\n  All chapters drafted. Advancing to Validation.\n")
}
