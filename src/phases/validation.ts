import { crossChapterContinuitySchema, proseQualitySchema, rewriterOutputSchema } from "../types"
import {
  getNovel, getChapterOutline, getApprovedDraft, getOpenIssues,
  saveIssue, resolveIssuesForChapter, unapproveChapterDraft,
  saveChapterDraft, approveChapterDraft, saveValidationPass,
  getValidationAttempts, clearFactsForChapter, clearCharacterStatesForChapter,
  updatePhase,
} from "../db"
import { callAgent } from "../llm"
import { CROSS_CHAPTER_CONTINUITY_PROMPT, PROSE_QUALITY_PROMPT, REWRITER_AGENT_PROMPT } from "../prompts"
import { buildContext as buildCrossChapterContext } from "../agents/cross-chapter-continuity/context"
import { buildContext as buildProseQualityContext } from "../agents/prose-quality/context"
import { buildContext as buildRewriterContext } from "../agents/rewriter/context"
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

    // Step 2: LLM checks (only if deterministic passed for all)
    // Both continuity and prose quality run — their issues merge for the rewriter
    if (chaptersWithIssues.length === 0) {
      // 2a: Cross-chapter continuity
      console.log("\n  Running cross-chapter continuity check...")
      log(novelId, "info", `Pass ${pass}: running LLM continuity + prose quality`)

      try {
        const ctx = await buildCrossChapterContext(novelId, totalChapters)
        const llmResult = await callAgent({
          novelId, agentName: "cross-chapter-continuity",
          systemPrompt: CROSS_CHAPTER_CONTINUITY_PROMPT,
          userPrompt: ctx,
          schema: crossChapterContinuitySchema,
        })

        const issues = llmResult.output.issues.filter(i => i.severity === "blocker" || i.severity === "warning")

        if (issues.length > 0) {
          console.log(`  Continuity: ${issues.length} issues found`)
          for (const issue of issues) {
            await saveIssue(novelId, {
              severity: issue.severity,
              description: issue.description,
              chapter: issue.chapter,
              conflictsWith: issue.conflictsWith,
              suggestedFix: issue.suggestedFix,
            })
            if (!chaptersWithIssues.includes(issue.chapter)) {
              chaptersWithIssues.push(issue.chapter)
            }
            console.log(`    [${issue.severity}] ch${issue.chapter}: ${issue.description}`)
          }
        } else {
          console.log("  Continuity: no issues found")
        }
      } catch (err) {
        log(novelId, "warn", `Cross-chapter continuity check failed: ${err}`)
        console.log(`  Continuity check failed (non-blocking): ${err instanceof Error ? err.message : err}`)
      }

      // 2b: Per-chapter prose quality (show-don't-tell + cliches)
      console.log("\n  Running prose quality checks...")

      for (let ch = 1; ch <= totalChapters; ch++) {
        const draft = await getApprovedDraft(novelId, ch)
        if (!draft) continue

        try {
          const ctx = await buildProseQualityContext(draft.prose, ch, novelId)
          const qualityResult = await callAgent({
            novelId, agentName: "prose-quality",
            systemPrompt: PROSE_QUALITY_PROMPT,
            userPrompt: ctx,
            schema: proseQualitySchema,
          })

          const issues = qualityResult.output.issues
          if (issues.length > 0) {
            console.log(`  Chapter ${ch}: ${issues.length} prose quality issues`)
            for (const issue of issues) {
              await saveIssue(novelId, {
                severity: "warning",
                description: `[prose] ${issue.issue}: "${issue.excerpt}"`,
                chapter: ch,
                suggestedFix: issue.suggestedFix,
              })
              console.log(`    ${issue.issue}: "${issue.excerpt.slice(0, 60)}..."`)
            }
            if (!chaptersWithIssues.includes(ch)) {
              chaptersWithIssues.push(ch)
            }
          } else {
            console.log(`  Chapter ${ch}: prose quality clean`)
          }
        } catch (err) {
          log(novelId, "warn", `Prose quality check failed for ch${ch}: ${err}`)
          console.log(`  Chapter ${ch}: prose quality check failed (non-blocking)`)
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

  await updatePhase(novelId, "done")
  emit(novelId, { type: "phase:changed", data: { phase: "done" } })
  log(novelId, "checkpoint", "Validation phase complete → done")
  console.log("\n  Validation phase complete.\n")
}
