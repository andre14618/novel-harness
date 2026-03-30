import {
  chapterDraftSchema, continuityCheckSchema, chapterSummarySchema,
  factExtractionSchema, characterStateUpdateSchema,
} from "../types"
import {
  getNovel, getChapterOutline, getCharacters, getFactsUpToChapter,
  getCharacterStatesAtChapter, saveChapterDraft, approveChapterDraft,
  saveChapterSummary, saveFact, saveCharacterState, saveIssue,
  resolveIssuesForChapter, updateCurrentChapter, updatePhase,
} from "../db"
import { callAgent } from "../llm"
import {
  WRITER_AGENT_PROMPT, CONTINUITY_AGENT_PROMPT,
  SUMMARY_EXTRACTOR_PROMPT, FACT_EXTRACTOR_PROMPT, CHARACTER_STATE_PROMPT,
} from "../prompts"
import {
  buildWriterContext, buildContinuityContext,
  buildSummaryContext, buildFactExtractionContext, buildCharacterStateContext,
} from "../context"
import { validateChapterDraft } from "../validation"
import { displayPhaseHeader, displayProgress, presentForApproval, getRevisionNotes } from "../cli"
import { log } from "../logger"

async function updateStateAfterChapter(novelId: string, chapterNum: number, prose: string): Promise<void> {
  log(novelId, "info", `Extracting state for chapter ${chapterNum}...`)

  const characters = getCharacters(novelId)

  // Run sequentially to avoid rate limits on free tier
  const summaryResult = await callAgent({
    systemPrompt: SUMMARY_EXTRACTOR_PROMPT,
    userPrompt: buildSummaryContext(prose),
    schema: chapterSummarySchema,
    temperature: 0.2,
  })
  const factResult = await callAgent({
    systemPrompt: FACT_EXTRACTOR_PROMPT,
    userPrompt: buildFactExtractionContext(prose),
    schema: factExtractionSchema,
    temperature: 0.1,
  })
  const charStateResult = await callAgent({
    systemPrompt: CHARACTER_STATE_PROMPT,
    userPrompt: buildCharacterStateContext(prose, characters),
    schema: characterStateUpdateSchema,
    temperature: 0.1,
  })

  saveChapterSummary(
    novelId, chapterNum,
    summaryResult.output.summary,
    summaryResult.output.keyEvents,
  )

  for (const f of factResult.output.facts) {
    saveFact(novelId, { fact: f.fact, category: f.category, establishedInChapter: chapterNum })
  }

  for (const cs of charStateResult.output.characters) {
    const char = characters.find(c => c.name.toLowerCase() === cs.name.toLowerCase())
    if (char) {
      saveCharacterState(novelId, char.id, chapterNum, {
        characterId: char.id,
        chapterNumber: chapterNum,
        location: cs.location,
        emotionalState: cs.emotionalState,
        knows: cs.knows,
        doesNotKnow: cs.doesNotKnow,
      })
    }
  }

  resolveIssuesForChapter(novelId, chapterNum)

  log(novelId, "info", `State updated: summary, ${factResult.output.facts.length} facts, ${charStateResult.output.characters.length} character states`)
  console.log(`  State updated: summary, ${factResult.output.facts.length} facts, ${charStateResult.output.characters.length} character states`)
}

export async function runDraftingPhase(novelId: string): Promise<void> {
  displayPhaseHeader("Drafting — Writing chapters")

  const novel = getNovel(novelId)
  const startChapter = novel.currentChapter  // 1-based
  const totalChapters = novel.totalChapters

  console.log(`  Starting from chapter ${startChapter} of ${totalChapters}\n`)
  log(novelId, "info", `Drafting phase: chapters ${startChapter}-${totalChapters}`)

  for (let ch = startChapter; ch <= totalChapters; ch++) {
    displayProgress(ch - 1, totalChapters, `Chapter ${ch}`)

    let outline
    try {
      outline = getChapterOutline(novelId, ch)
    } catch (err) {
      log(novelId, "error", `Failed to load outline for chapter ${ch}: ${err}`)
      console.error(`  Error loading outline for chapter ${ch}. Stopping.`)
      return
    }

    let approved = false
    let attempts = 0
    const maxAttempts = 3

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
        const draftResult = await callAgent({
          systemPrompt: WRITER_AGENT_PROMPT,
          userPrompt: writerContext,
          schema: chapterDraftSchema,
          temperature: 0.8,
          maxTokens: 8192,
        })
        prose = draftResult.output.prose
        wordCount = prose.split(/\s+/).filter(Boolean).length
        console.log(`  Draft: ${wordCount} words`)
        log(novelId, "info", `Draft generated: ${wordCount} words`)
      } catch (err) {
        log(novelId, "error", `Writer agent failed for chapter ${ch}: ${err}`)
        console.error(`  Writer agent error: ${err instanceof Error ? err.message : err}`)
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
        const facts = getFactsUpToChapter(novelId, ch)
        const charStates = getCharacterStatesAtChapter(novelId, ch)
        const continuityResult = await callAgent({
          systemPrompt: CONTINUITY_AGENT_PROMPT,
          userPrompt: buildContinuityContext(prose, facts, charStates),
          schema: continuityCheckSchema,
          temperature: 0.2,
        })
        issues = continuityResult.output.issues

        if (issues.length > 0) {
          console.log(`  Continuity: ${issues.length} issues`)
          issues.forEach(i => console.log(`    [${i.severity}] ${i.description}`))
        } else {
          console.log("  Continuity: no issues found")
        }
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
        `Chapter ${ch}: "${outline.title}" (${wordCount} words)`,
        displayContent,
      )

      if (decision === "approve") {
        approved = true
        approveChapterDraft(novelId, ch)

        try {
          await updateStateAfterChapter(novelId, ch, prose)
        } catch (err) {
          log(novelId, "error", `State update failed for chapter ${ch}: ${err}`)
          console.error(`  State update error (chapter still approved): ${err instanceof Error ? err.message : err}`)
          // Don't block — the draft is approved, state extraction can be retried
        }

        updateCurrentChapter(novelId, ch + 1)
        log(novelId, "checkpoint", `Chapter ${ch} approved. currentChapter → ${ch + 1}`)

        // Write to file
        const dir = `output/${novelId}`
        await Bun.write(`${dir}/chapter-${ch}.md`, `# Chapter ${ch}: ${outline.title}\n\n${prose}`)
        console.log(`  Chapter ${ch} approved and saved.`)

      } else if (decision === "revise") {
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

  updatePhase(novelId, "done")
  log(novelId, "info", "All chapters drafted. Novel complete.")
  console.log("\n  All chapters drafted! Novel complete.")
}
