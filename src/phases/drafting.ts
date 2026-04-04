import { chapterDraftSchema, continuityCheckSchema } from "../types"
import {
  getNovel, getChapterOutline, getFactsUpToChapter,
  getCharacterStatesAtChapter, saveChapterDraft, approveChapterDraft,
  saveIssue, updateCurrentChapter, updatePhase,
} from "../db"
import { callAgent } from "../llm"
import { WRITER_AGENT_PROMPT, CONTINUITY_AGENT_PROMPT } from "../prompts"
import { buildWriterContext, buildContinuityContext } from "../context"
import { validateChapterDraft } from "../validation"
import { displayPhaseHeader, displayProgress, presentForApproval, getRevisionNotes } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import { updateStateAfterChapter } from "../state-extraction"
import { pipeline } from "../config/pipeline"
import * as gates from "../gates"

export async function runDraftingPhase(novelId: string): Promise<void> {
  displayPhaseHeader("Drafting — Writing chapters")
  emit(novelId, { type: "phase:changed", data: { phase: "drafting" } })

  const novel = getNovel(novelId)
  const startChapter = novel.currentChapter  // 1-based
  const totalChapters = novel.totalChapters

  console.log(`  Starting from chapter ${startChapter} of ${totalChapters}\n`)
  log(novelId, "info", `Drafting phase: chapters ${startChapter}-${totalChapters}`)

  for (let ch = startChapter; ch <= totalChapters; ch++) {
    displayProgress(ch - 1, totalChapters, `Chapter ${ch}`)
    emit(novelId, { type: "progress", data: { step: "drafting", chapter: ch, totalChapters, status: "starting" } })

    let outline
    try {
      outline = getChapterOutline(novelId, ch)
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

      // 1. Context assembly
      let writerContext: string
      try {
        writerContext = buildWriterContext(novelId, ch)
      } catch (err) {
        log(novelId, "error", `Context assembly failed for chapter ${ch}: ${err}`)
        console.error(`  Error assembling context: ${err instanceof Error ? err.message : err}`)
        continue
      }

      // 2. Writer agent
      let prose: string
      let wordCount: number
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
        const facts = getFactsUpToChapter(novelId, ch)
        const charStates = getCharacterStatesAtChapter(novelId, ch)
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
      saveChapterDraft(novelId, ch, prose, wordCount)
      log(novelId, "checkpoint", `Draft saved for chapter ${ch} v${attempts}`)

      // 5. Human gate
      let displayContent = prose
      if (issues.length > 0) {
        displayContent += `\n\n--- CONTINUITY ISSUES ---\n${issues.map((i: any) => `[${i.severity}] ${i.description}`).join("\n")}`
      }
      if (validation.warnings.length > 0) {
        displayContent += `\n\n--- VALIDATION WARNINGS ---\n${validation.warnings.join("\n")}`
      }

      const decision = await presentForApproval(
        novelId,
        `drafting:chapter-${ch}`,
        `Chapter ${ch}: "${outline.title}" (${wordCount} words)`,
        displayContent,
      )

      if (decision === "approve") {
        approved = true
        approveChapterDraft(novelId, ch)

        try {
          emit(novelId, { type: "progress", data: { step: "state-extraction", chapter: ch, status: "running" } })
          await updateStateAfterChapter(novelId, ch, prose)
          emit(novelId, { type: "progress", data: { step: "state-extraction", chapter: ch, status: "complete" } })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log(novelId, "error", `State extraction failed for chapter ${ch}: ${msg}. Facts/summaries may be incomplete for subsequent chapters.`)
          console.error(`  ⚠ State extraction failed for chapter ${ch}: ${msg}`)
          console.error(`    Chapter is approved but facts/summaries may be missing. Subsequent chapters may have degraded context.`)
        }

        updateCurrentChapter(novelId, ch + 1)
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
          saveIssue(novelId, { severity: "blocker", description: note, chapter: ch })
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

  updatePhase(novelId, "validation")
  emit(novelId, { type: "phase:changed", data: { phase: "validation" } })
  log(novelId, "info", "All chapters drafted. Advancing to validation.")
  console.log("\n  All chapters drafted. Advancing to Validation.\n")
}
