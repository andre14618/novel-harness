import {
  getNovel, getChapterOutline, getApprovedDraft, getOpenIssues,
  saveIssue, saveValidationPass,
} from "../db"
import db from "../db/connection"
import { recordDraftCheckerObservationForHash } from "../db/proposal-resolution-outcomes"
import { validateChapterDraft } from "../validation"
import { displayPhaseHeader } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import { trace } from "../trace"
import { pipeline } from "../config/pipeline"
import type { Phase, PhaseResult, ValidationOutput, DraftingOutput } from "./contract"
import { createHash } from "crypto"

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
// Validation still runs deterministic checks and logs issues.

/** Validation phase implementation. Kept exported for symmetry with the
 *  other phases; no external callers today. Driver consumers should use
 *  `validationPhase` (the Phase<I,O> wrapper) instead. */
export async function runValidationPhase(novelId: string): Promise<PhaseResult<ValidationOutput>> {
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
        payload: { passed: result.passed, blockers: result.blockers, warnings: result.warnings, findings: result.findings ?? [], pass },
      })
      await recordDraftCheckerObservationForHash({
        novelId,
        chapterNumber: ch,
        resultHash: computeProseHash(draft.prose),
        checkerName: "validation-check",
        fired: !result.passed,
        observedAt: new Date().toISOString(),
        details: {
          pass,
          blockers: result.blockers,
          warnings: result.warnings,
          findings: result.findings ?? [],
        },
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

  // P6b1: phase transition is driver-owned.
  log(novelId, "checkpoint", "Validation phase complete → done")
  console.log("\n  Validation phase complete.\n")

  const output = await loadValidationOutput(novelId)
  return { kind: "complete", output }
}

function computeProseHash(prose: string): string {
  return createHash("sha256").update(prose, "utf8").digest("hex")
}

/** Reconstruct ValidationOutput from DB. Called on resume by the typed
 *  driver (P6b1+). Only invoked when novel.phase has advanced to 'done'. */
export async function loadValidationOutput(novelId: string): Promise<ValidationOutput> {
  const novel = await getNovel(novelId)
  const totalChapters = novel.totalChapters

  const passRow = ((await db.unsafe(
    `SELECT COALESCE(MAX(pass_number), 0)::int AS n FROM validation_passes WHERE novel_id = $1`,
    [novelId],
  )) as Array<{ n: number }>)[0]
  const passes = passRow?.n ?? 0

  // Inline query for chapter column — `getOpenIssues()` returns
  // ContinuityIssue which doesn't carry chapter (db/issues.ts:13-18 strips
  // it). The contract's openIssuesAtEnd needs (chapter, description,
  // severity); pulling raw is simpler than widening the existing helper.
  const openIssueRows = (await db.unsafe(
    `SELECT chapter, severity, description FROM issues WHERE novel_id = $1 AND status = 'open' ORDER BY chapter, description`,
    [novelId],
  )) as Array<{ chapter: number; severity: string; description: string }>

  const tonalRows = (await db.unsafe(
    `SELECT DISTINCT chapter_number FROM chapter_drafts WHERE novel_id = $1 AND status = 'tonal-pass' ORDER BY chapter_number`,
    [novelId],
  )) as Array<{ chapter_number: number }>

  return {
    totalChapters,
    passes,
    openIssuesAtEnd: openIssueRows.map(r => ({
      chapter: r.chapter,
      description: r.description,
      severity: r.severity,
    })),
    tonalPassChapters: tonalRows.map(r => r.chapter_number),
  }
}

/** P5 — Phase<DraftingOutput, ValidationOutput> wrapper. Not yet consumed
 *  by the state-machine; P6b1 flips the driver to use it. */
export const validationPhase: Phase<DraftingOutput, ValidationOutput> = {
  name: "validation",
  async run(_input, ctx) {
    return runValidationPhase(ctx.novelId)
  },
  async loadOutput(novelId) {
    return loadValidationOutput(novelId)
  },
}
