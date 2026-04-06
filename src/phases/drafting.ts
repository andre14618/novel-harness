import { chapterDraftSchema, continuityCheckSchema } from "../types"
import {
  getNovel, getChapterOutline, getCharacters, getFactsUpToChapter,
  getCharacterStatesAtChapter, getWorldBible, saveChapterDraft, approveChapterDraft,
  saveIssue, updateCurrentChapter, updatePhase,
} from "../db"
import { callAgent } from "../llm"
import { WRITER_AGENT_PROMPT, BEAT_WRITER_PROMPT, CONTINUITY_AGENT_PROMPT } from "../prompts"
import { buildContext as buildWriterContext } from "../agents/writer/context"
import { buildBeatContext } from "../agents/writer/beat-context"
import { buildContext as buildContinuityContext } from "../agents/continuity/context"
import { validateChapterDraft } from "../validation"
import { displayPhaseHeader, displayProgress, presentForApproval, getRevisionNotes } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import { updateStateAfterChapter } from "../state-extraction"
import { pipeline } from "../config/pipeline"
import * as gates from "../gates"
import { lintProse } from "../lint"
import { fixLintIssues } from "../lint/fix"
import { getModelForAgent } from "../../models/roles"

export async function runDraftingPhase(novelId: string): Promise<void> {
  displayPhaseHeader("Drafting — Writing chapters")
  emit(novelId, { type: "phase:changed", data: { phase: "drafting" } })

  const novel = await getNovel(novelId)
  const startChapter = novel.currentChapter  // 1-based
  const totalChapters = novel.totalChapters

  console.log(`  Starting from chapter ${startChapter} of ${totalChapters}\n`)
  log(novelId, "info", `Drafting phase: chapters ${startChapter}-${totalChapters}`)

  for (let ch = startChapter; ch <= totalChapters; ch++) {
    displayProgress(ch - 1, totalChapters, `Chapter ${ch}`)
    emit(novelId, { type: "progress", data: { step: "drafting", chapter: ch, totalChapters, status: "starting" } })

    let outline
    try {
      outline = await getChapterOutline(novelId, ch)
    } catch (err) {
      log(novelId, "error", `Failed to load outline for chapter ${ch}: ${err}`)
      console.error(`  Error loading outline for chapter ${ch}. Stopping.`)
      emit(novelId, { type: "error", data: { step: "drafting", chapter: ch, error: "Failed to load outline" } })
      return
    }

    let approved = false
    let attempts = 0
    const maxAttempts = pipeline.maxDraftAttempts

    while (!approved && attempts < maxAttempts) {
      attempts++
      console.log(`\n  --- Chapter ${ch}: "${outline.title}" (attempt ${attempts}/${maxAttempts}) ---`)
      log(novelId, "info", `Chapter ${ch} "${outline.title}" attempt ${attempts}`)

      // 1-2. Context assembly + writer (beat-level or chapter-level)
      let prose: string
      let wordCount: number

      if (pipeline.beatLevelWriting && outline.scenes.length > 0) {
        // ── Beat-level generation ───────────────────────────────────────
        try {
          console.log(`  Writing ${outline.scenes.length} beats...`)
          emit(novelId, { type: "progress", data: { step: "beat-writer", chapter: ch, attempt: attempts, status: "running" } })

          const characters = await getCharacters(novelId)
          const charStates = await getCharacterStatesAtChapter(novelId, ch)
          const worldBible = await getWorldBible(novelId)

          const beatProses: string[] = []
          for (let bi = 0; bi < outline.scenes.length; bi++) {
            const beatCtx = await buildBeatContext({
              novelId, chapterNumber: ch, beatIndex: bi,
              previousBeatProse: beatProses[bi - 1],
              outline, characters, characterStates: charStates, worldBible,
            })

            let beatProse: string | null = null
            for (let retry = 0; retry <= pipeline.maxBeatRetries; retry++) {
              const retryNote = retry > 0 ? `\nRETRY — previous attempt did not follow the beat. Try again.` : ""
              const result = await callAgent({
                novelId, agentName: "beat-writer",
                systemPrompt: BEAT_WRITER_PROMPT,
                userPrompt: beatCtx.userPrompt + retryNote,
                schema: chapterDraftSchema,
              })
              if (result.output.prose) {
                beatProse = result.output.prose
                break
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

      // 3. Deterministic validation
      const validation = validateChapterDraft(prose, outline)
      if (!validation.passed) {
        console.log(`  Validation FAILED:`)
        validation.blockers.forEach(b => console.log(`    BLOCKER: ${b}`))
        validation.warnings.forEach(w => console.log(`    WARNING: ${w}`))
        log(novelId, "warn", `Validation failed: ${validation.blockers.join("; ")}`)
        continue
      }
      if (validation.warnings.length > 0) {
        validation.warnings.forEach(w => console.log(`    WARNING: ${w}`))
      }

      // 4. Continuity check
      let issues: any[] = []
      try {
        console.log("  Running continuity check...")
        emit(novelId, { type: "progress", data: { step: "continuity", chapter: ch, status: "running" } })
        const facts = await getFactsUpToChapter(novelId, ch)
        const charStates = await getCharacterStatesAtChapter(novelId, ch)
        const continuityResult = await callAgent({
          novelId, agentName: "continuity",
          systemPrompt: CONTINUITY_AGENT_PROMPT,
          userPrompt: buildContinuityContext(prose, facts, charStates),
          schema: continuityCheckSchema,
        })
        issues = continuityResult.output.issues

        if (issues.length > 0) {
          console.log(`  Continuity: ${issues.length} issues`)
          issues.forEach(i => console.log(`    [${i.severity}] ${i.description}`))
        } else {
          console.log("  Continuity: no issues found")
        }
        emit(novelId, { type: "progress", data: { step: "continuity", chapter: ch, status: "complete", issueCount: issues.length } })
      } catch (err) {
        log(novelId, "warn", `Continuity check failed for chapter ${ch}: ${err}`)
        console.log(`  Continuity check failed (non-blocking): ${err instanceof Error ? err.message : err}`)
        // Continue — continuity failure shouldn't block drafting
      }

      // Save draft
      await saveChapterDraft(novelId, ch, prose, wordCount)
      log(novelId, "checkpoint", `Draft saved for chapter ${ch} v${attempts}`)

      // 4b. Lint and fix prose
      let lintSummary = ""
      try {
        emit(novelId, { type: "progress", data: { step: "lint", chapter: ch, status: "running" } })
        const lintResult = await lintProse(prose)
        if (lintResult.totalIssues > 0) {
          console.log(`  Lint: ${lintResult.totalIssues} issues (${Object.entries(lintResult.counts).map(([k, v]) => `${k}:${v}`).join(", ")})`)
          log(novelId, "info", `Lint found ${lintResult.totalIssues} issues`)

          const fixer = getModelForAgent("lint-fixer")
          const fixResult = await fixLintIssues(
            prose,
            lintResult.issues,
            fixer ? { provider: fixer.provider, model: fixer.model, temperature: fixer.temperature } : undefined,
          )

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
        await updateStateAfterChapter(novelId, ch, prose)
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
