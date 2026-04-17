import {
  getNovel, getChapterOutline, getApprovedDraft, getOpenIssues,
  saveIssue, saveValidationPass,
  updatePhase, saveTonalPassDraft,
} from "../db"
import { runTonalPass } from "../agents/tonal-pass/run"
import { validateChapterDraft } from "../validation"
import { displayPhaseHeader } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import { trace } from "../trace"
import { pipeline } from "../config/pipeline"

const MAX_PASSES = pipeline.maxValidationPasses

// Validation phase is now diagnostic-only (2026-04-17). The chapter-level
// rewriter was removed because:
// 1. Beat-writer retry in drafting is the quality gate (targeted rewrites
//    per beat, ~400w shape that 14B handles reliably).
// 2. Chapter-level rewriting (1200w in/out) caused 63-78% collateral
//    damage per docs/lessons-learned.md.
// 3. With narrow-strip compact context + structural priors, the drafting
//    phase passes chapters at high enough rates that validation-phase
//    rewriting rarely fired.
//
// Validation still runs deterministic checks and logs issues. Tonal pass
// (on-demand) still works for existing novels.

export async function runValidationPhase(novelId: string): Promise<void> {
  displayPhaseHeader("Validation — Cross-chapter consistency check")
  log(novelId, "info", "Validation phase started")
  emit(novelId, { type: "phase:changed", data: { phase: "validation" } })

  const novel = await getNovel(novelId)
  const totalChapters = novel.totalChapters

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    console.log(`\n  --- Validation pass ${pass}/${MAX_PASSES} ---`)
    log(novelId, "info", `Validation pass ${pass} started`)

    let allPassed = true

    for (let ch = 1; ch <= totalChapters; ch++) {
      const draft = await getApprovedDraft(novelId, ch)
      if (!draft) {
        log(novelId, "error", `No approved draft for chapter ${ch}`)
        console.log(`  Chapter ${ch}: no approved draft — skipping`)
        continue
      }

      const outline = await getChapterOutline(novelId, ch)
      const result = validateChapterDraft(draft.prose, outline, "validation")
      await trace(novelId, {
        eventType: "validation-check", chapter: ch,
        payload: { passed: result.passed, blockers: result.blockers, warnings: result.warnings, pass },
      })

      if (!result.passed) {
        for (const blocker of result.blockers) {
          await saveIssue(novelId, { severity: "blocker", description: blocker, chapter: ch })
        }
        await saveValidationPass(novelId, pass, ch, "has_issues", result.blockers.length)
        console.log(`  Chapter ${ch}: ${result.blockers.length} blockers (logged, no rewrite)`)
        log(novelId, "warn", `Pass ${pass} ch${ch}: ${result.blockers.join("; ")}`)
        allPassed = false
      } else {
        if (result.warnings.length > 0) {
          console.log(`  Chapter ${ch}: passed (${result.warnings.length} warnings)`)
        } else {
          console.log(`  Chapter ${ch}: passed`)
        }
        await saveValidationPass(novelId, pass, ch, "passed", 0)
      }
    }

    if (allPassed) {
      console.log(`\n  All chapters passed validation on pass ${pass}.`)
      log(novelId, "info", `Validation converged on pass ${pass}`)
      break
    }

    // Log remaining issues but don't attempt chapter-level rewrites.
    // Beat-writer retry in drafting was the quality gate.
    if (pass === MAX_PASSES) {
      const remainingIssues = await getOpenIssues(novelId)
      if (remainingIssues.length > 0) {
        console.log(`\n  ${remainingIssues.length} open issue(s) remain after ${MAX_PASSES} validation passes (no rewriter).`)
        log(novelId, "warn", `Validation: ${remainingIssues.length} issues remain — rewriter removed, issues logged only`)
      }
    }
  }

  // ── Tonal pass (per-paragraph voice rewrite) ─────────────────────────
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
          await saveTonalPassDraft(novelId, ch, result.prose, wordCount)
          const outline = await getChapterOutline(novelId, ch)
          const dir = `output/${novelId}`
          await Bun.write(`${dir}/chapter-${ch}.md`, `# Chapter ${ch}: ${outline.title}\n\n${result.prose}`)
          console.log(`  Chapter ${ch}: ${result.paragraphsRewritten}/${result.paragraphsTotal} paragraphs rewritten (${result.paragraphsSkipped} dialogue skipped)`)
        } else {
          console.log(`  Chapter ${ch}: no changes needed`)
        }
      } catch (err) {
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
