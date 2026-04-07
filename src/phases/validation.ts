import { rewriterOutputSchema } from "../types"
import {
  getNovel, getChapterOutline, getApprovedDraft, getOpenIssues,
  saveIssue, resolveIssuesForChapter, unapproveChapterDraft,
  saveChapterDraft, approveChapterDraft, saveValidationPass,
  getValidationAttempts, clearFactsForChapter, clearCharacterStatesForChapter,
  updatePhase,
} from "../db"
import { callAgent } from "../llm"
import { REWRITER_AGENT_PROMPT } from "../prompts"
import { buildContext as buildRewriterContext } from "../agents/rewriter/context"
import { runTonalPass } from "../agents/tonal-pass/run"
import { validateChapterDraft } from "../validation"
import { updateStateAfterChapter } from "../state-extraction"
import { displayPhaseHeader } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import { pipeline } from "../config/pipeline"

const MAX_PASSES = pipeline.maxValidationPasses
const MAX_CHAPTER_REWRITES = pipeline.maxChapterRewrites

export async function runValidationPhase(novelId: string): Promise<void> {
  displayPhaseHeader("Validation — Cross-chapter consistency check")
  log(novelId, "info", "Validation phase started")
  emit(novelId, { type: "phase:changed", data: { phase: "validation" } })

  const novel = await getNovel(novelId)
  const totalChapters = novel.totalChapters

  let converged = false

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    console.log(`\n  --- Validation pass ${pass}/${MAX_PASSES} ---`)
    log(novelId, "info", `Validation pass ${pass} started`)

    const chaptersWithIssues: number[] = []

    // Step 1: Deterministic validation on all chapters (fail-fast)
    for (let ch = 1; ch <= totalChapters; ch++) {
      const draft = await getApprovedDraft(novelId, ch)
      if (!draft) {
        log(novelId, "error", `No approved draft for chapter ${ch}`)
        console.log(`  Chapter ${ch}: no approved draft — skipping`)
        continue
      }

      const outline = await getChapterOutline(novelId, ch)
      const result = validateChapterDraft(draft.prose, outline, "validation")

      if (!result.passed) {
        for (const blocker of result.blockers) {
          await saveIssue(novelId, { severity: "blocker", description: blocker, chapter: ch })
        }
        chaptersWithIssues.push(ch)
        await saveValidationPass(novelId, pass, ch, "has_issues", result.blockers.length)
        console.log(`  Chapter ${ch}: ${result.blockers.length} blockers (deterministic)`)
        log(novelId, "info", `Pass ${pass} ch${ch}: deterministic blockers: ${result.blockers.join("; ")}`)
      } else {
        if (result.warnings.length > 0) {
          console.log(`  Chapter ${ch}: passed (${result.warnings.length} warnings)`)
        } else {
          console.log(`  Chapter ${ch}: passed deterministic checks`)
        }
      }
    }

    // Record pass status for chapters without issues
    for (let ch = 1; ch <= totalChapters; ch++) {
      if (!chaptersWithIssues.includes(ch)) {
        await saveValidationPass(novelId, pass, ch, "passed", 0)
      }
    }

    // Step 4: Converged?
    if (chaptersWithIssues.length === 0) {
      console.log(`\n  All chapters passed validation on pass ${pass}.`)
      log(novelId, "info", `Validation converged on pass ${pass}`)
      converged = true
      break
    }

    // Step 4: Rewrite chapters with issues
    console.log(`\n  Rewriting ${chaptersWithIssues.length} chapter(s)...`)
    chaptersWithIssues.sort((a, b) => a - b)

    for (const ch of chaptersWithIssues) {
      const attempts = await getValidationAttempts(novelId, ch) + 1

      if (attempts > MAX_CHAPTER_REWRITES) {
        console.log(`  Chapter ${ch}: stuck after ${attempts - 1} rewrites — skipping`)
        log(novelId, "warn", `Chapter ${ch} stuck after ${MAX_CHAPTER_REWRITES} rewrites`)
        await saveValidationPass(novelId, pass, ch, "stuck", 0)
        continue
      }

      const issues = await getOpenIssues(novelId, ch)
      if (issues.length === 0) continue

      console.log(`  Chapter ${ch}: rewriting (attempt ${attempts}/${MAX_CHAPTER_REWRITES})...`)
      log(novelId, "info", `Rewriting chapter ${ch} (attempt ${attempts}): ${issues.length} issues`)

      try {
        const ctx = await buildRewriterContext(novelId, ch, issues)
        const rewriteResult = await callAgent({
          novelId, agentName: "rewriter",
          systemPrompt: REWRITER_AGENT_PROMPT,
          userPrompt: ctx,
          schema: rewriterOutputSchema,
        })

        const newProse = rewriteResult.output.prose
        const wordCount = newProse.split(/\s+/).filter(Boolean).length

        // Deterministic validation on rewrite
        const outline = await getChapterOutline(novelId, ch)
        const rewriteValidation = validateChapterDraft(newProse, outline, "validation")

        if (!rewriteValidation.passed) {
          console.log(`  Chapter ${ch}: rewrite failed deterministic validation — ${rewriteValidation.blockers.join("; ")}`)
          log(novelId, "warn", `Chapter ${ch} rewrite failed validation: ${rewriteValidation.blockers.join("; ")}`)
          await saveValidationPass(novelId, pass, ch, "has_issues", rewriteValidation.blockers.length)
          continue
        }

        // Accept rewrite
        await unapproveChapterDraft(novelId, ch)
        await saveChapterDraft(novelId, ch, newProse, wordCount)
        await approveChapterDraft(novelId, ch)

        // Clear + re-extract state
        await clearFactsForChapter(novelId, ch)
        await clearCharacterStatesForChapter(novelId, ch)
        await updateStateAfterChapter(novelId, ch, newProse)

        // Resolve old issues
        await resolveIssuesForChapter(novelId, ch)

        // Write updated file
        const dir = `output/${novelId}`
        await Bun.write(`${dir}/chapter-${ch}.md`, `# Chapter ${ch}: ${outline.title}\n\n${newProse}`)

        await saveValidationPass(novelId, pass, ch, "rewritten", issues.length)
        console.log(`  Chapter ${ch}: rewritten (${wordCount} words)`)
        log(novelId, "checkpoint", `Chapter ${ch} rewritten: ${wordCount} words, ${issues.length} issues addressed`)

      } catch (err) {
        log(novelId, "error", `Rewrite failed for chapter ${ch}: ${err}`)
        console.log(`  Chapter ${ch}: rewrite failed — ${err instanceof Error ? err.message : err}`)
        await saveValidationPass(novelId, pass, ch, "has_issues", 0)
      }
    }
  }

  if (!converged) {
    const remainingIssues = await getOpenIssues(novelId)
    if (remainingIssues.length > 0) {
      console.log(`\n  Validation did not fully converge after ${MAX_PASSES} passes.`)
      console.log(`  ${remainingIssues.length} open issue(s) remaining.`)
      log(novelId, "warn", `Validation incomplete: ${remainingIssues.length} open issues after ${MAX_PASSES} passes`)
    }
  }

  // ── Tonal pass (per-paragraph voice rewrite) ─────────────────────────
  // Runs after all content/continuity issues are resolved.
  // Only runs if a tonal-pass model is configured (skip if placeholder).
  if (pipeline.tonalPass) {
    console.log("\n  --- Tonal pass: voice rewrite ---")
    log(novelId, "info", "Tonal pass started")
    emit(novelId, { type: "phase:changed", data: { phase: "tonal-pass" } })

    for (let ch = 1; ch <= totalChapters; ch++) {
      const draft = await getApprovedDraft(novelId, ch)
      if (!draft) continue

      console.log(`  Chapter ${ch}: running tonal pass...`)

      try {
        const result = await runTonalPass(novelId, ch, draft.prose)

        if (result.paragraphsRewritten > 0) {
          const wordCount = result.prose.split(/\s+/).filter(Boolean).length

          // Save tonal-pass rewrite as new approved draft
          await unapproveChapterDraft(novelId, ch)
          await saveChapterDraft(novelId, ch, result.prose, wordCount)
          await approveChapterDraft(novelId, ch)

          // Update output file
          const outline = await getChapterOutline(novelId, ch)
          const dir = `output/${novelId}`
          await Bun.write(`${dir}/chapter-${ch}.md`, `# Chapter ${ch}: ${outline.title}\n\n${result.prose}`)

          console.log(`  Chapter ${ch}: ${result.paragraphsRewritten}/${result.paragraphsTotal} paragraphs rewritten (${result.paragraphsSkipped} dialogue skipped)`)
        } else {
          console.log(`  Chapter ${ch}: no changes needed`)
        }
      } catch (err) {
        // Tonal pass is non-blocking — log and continue
        log(novelId, "warn", `Tonal pass failed for ch${ch}: ${err}`)
        console.log(`  Chapter ${ch}: tonal pass failed (non-blocking) — ${err instanceof Error ? err.message : err}`)
      }
    }

    log(novelId, "checkpoint", "Tonal pass complete")
  }

  await updatePhase(novelId, "done")
  emit(novelId, { type: "phase:changed", data: { phase: "done" } })
  log(novelId, "checkpoint", "Validation phase complete → done")
  console.log("\n  Validation phase complete.\n")
}
