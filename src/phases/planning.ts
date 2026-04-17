import { chapterOutlinesSchema, type ChapterOutline } from "../types"
import {
  getNovel, getWorldBible, getCharacters, getStorySpine,
  saveChapterOutline, updateTotalChapters, updatePhase,
} from "../db"
import { callAgent } from "../llm"
import { PLANNING_PLOTTER_PROMPT } from "../prompts"
import { buildContext as buildPlanningContext } from "../agents/planning-plotter/context"
import { buildContext as buildBeatContext } from "../agents/planning-beats/context"
import { schema as beatSchema, prompt as PLANNING_BEATS_PROMPT } from "../agents/planning-beats"
import { displayPhaseHeader, presentForApproval, formatChapterOutlines } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import * as harness from "../harness"

export async function runPlanningPhase(novelId: string): Promise<void> {
  displayPhaseHeader("Planning — Creating chapter-by-chapter outline")
  log(novelId, "info", "Planning phase started")
  emit(novelId, { type: "phase:changed", data: { phase: "planning" } })

  const novel = await getNovel(novelId)
  const worldBible = await getWorldBible(novelId)
  const characters = await getCharacters(novelId)
  const spine = await getStorySpine(novelId)
  const targetChapters = novel.seed.chapterCount ?? null

  // ── Phase 1: chapter skeletons ──────────────────────────────────────
  const skeletonContext = buildPlanningContext(worldBible, characters, spine, novel.seed)
  console.log(`  Phase 1/2: chapter skeletons${targetChapters ? ` (target: ${targetChapters} chapters)` : ""}...`)
  emit(novelId, { type: "progress", data: { step: "planning-plotter", status: "running" } })

  let skeletons: ChapterOutline[] | null = null
  let lastError: string | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    let promptContext = skeletonContext
    if (attempt > 1 && lastError) {
      promptContext += `\n\n--- PREVIOUS ATTEMPT FAILED ---\n${lastError}\n\nFix the specific issue(s) above.`
      if (targetChapters) promptContext += ` Produce exactly ${targetChapters} chapters.`
    }

    try {
      const result = await callAgent({
        novelId, agentName: "planning-plotter",
        attempt,
        systemPrompt: PLANNING_PLOTTER_PROMPT,
        userPrompt: promptContext,
        schema: chapterOutlinesSchema,
      })

      const enforcement = harness.enforce.enforceSkeletons(
        result.output.chapters as ChapterOutline[], targetChapters, characters,
      )
      for (const w of enforcement.warnings) {
        log(novelId, "warn", `Planning skeletons: ${w}`)
        console.log(`  Warning: ${w}`)
      }
      if (enforcement.valid) {
        skeletons = enforcement.chapters
        log(novelId, "info", `Skeletons attempt ${attempt}: ${skeletons.length} chapters`)
        break
      } else {
        for (const e of enforcement.errors) {
          log(novelId, "error", `Skeleton enforcement: ${e}`)
          console.log(`  Skeleton failure: ${e}`)
        }
        lastError = `Enforcement errors: ${enforcement.errors.join("; ")}`
        if (attempt === 2) {
          throw new Error(`Skeletons failed after 2 attempts: ${enforcement.errors.join("; ")}`)
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt === 2) throw err
      log(novelId, "warn", `Skeleton attempt ${attempt} failed: ${lastError}`)
    }
  }

  if (!skeletons) throw new Error("Skeleton phase produced no valid output")
  console.log(`  ${skeletons.length} skeletons ready.`)

  // ── Phase 2: per-chapter beat expansion ─────────────────────────────
  console.log(`  Phase 2/2: expanding beats (parallel across ${skeletons.length} chapters)...`)
  emit(novelId, { type: "progress", data: { step: "planning-beats", status: "running", chapters: skeletons.length } })

  const expanded: ChapterOutline[] = new Array(skeletons.length)
  const expansions = skeletons.map((skeleton, idx) =>
    expandChapter(novelId, skeleton, skeletons!, worldBible, characters, spine, novel.seed)
      .then(full => { expanded[idx] = full })
      .catch(err => {
        log(novelId, "error", `Ch ${skeleton.chapterNumber} expansion failed: ${err.message}`)
        // fallback: keep the skeleton with an empty scenes array so downstream
        // enforcement surfaces the miss rather than crashing mid-parallel.
        expanded[idx] = skeleton
      })
  )
  await Promise.all(expansions)

  // Post-expansion enforcement — beat count floor, POV, setting
  const postEnforcement = harness.enforce.enforcePlanningOutput(expanded, targetChapters, characters)
  for (const w of postEnforcement.warnings) {
    log(novelId, "warn", `Planning: ${w}`)
    console.log(`  Warning: ${w}`)
  }

  // Targeted retry: any chapter under its beat-count floor gets re-expanded once
  const retryIdx: number[] = []
  for (let i = 0; i < expanded.length; i++) {
    const ch = expanded[i]
    const floor = Math.max(3, Math.ceil((ch.targetWords ?? 1000) / 150))
    if (!ch.scenes || ch.scenes.length < floor) {
      retryIdx.push(i)
      console.log(`  Ch ${ch.chapterNumber}: ${ch.scenes?.length ?? 0} beats < floor ${floor} — retrying expansion`)
    }
  }

  if (retryIdx.length > 0) {
    emit(novelId, { type: "progress", data: { step: "planning-beats", status: "retrying", chapters: retryIdx.length } })
    const retries = retryIdx.map(i =>
      expandChapter(novelId, skeletons![i], skeletons!, worldBible, characters, spine, novel.seed, 2)
        .then(full => {
          const floor = Math.max(3, Math.ceil((full.targetWords ?? 1000) / 150))
          if (full.scenes && full.scenes.length >= floor) expanded[i] = full
          else log(novelId, "warn", `Ch ${full.chapterNumber}: retry still short (${full.scenes?.length ?? 0} < ${floor})`)
        })
        .catch(err => log(novelId, "warn", `Ch ${skeletons![i].chapterNumber} retry failed: ${err.message}`))
    )
    await Promise.all(retries)
  }

  const finalEnforcement = harness.enforce.enforcePlanningOutput(expanded, targetChapters, characters)
  if (!finalEnforcement.valid) {
    throw new Error(`Planning failed after beat expansion + retry: ${finalEnforcement.errors.join("; ")}`)
  }

  const chapters = finalEnforcement.chapters
  log(novelId, "info", `Planning complete: ${chapters.length} chapters, avg ${Math.round(chapters.reduce((s, c) => s + (c.scenes?.length ?? 0), 0) / chapters.length)} beats/chapter`)
  emit(novelId, { type: "progress", data: { step: "planning-beats", status: "complete", chapters: chapters.length } })

  console.log(`  ${chapters.length} chapter outlines.\n`)

  const decision = await presentForApproval(
    novelId,
    "planning:outlines",
    `Chapter Outline (${chapters.length} chapters)`,
    formatChapterOutlines(chapters),
  )

  if (decision === "reject") {
    console.log("  Regenerating chapter outline...")
    // On reject, we re-run the full two-phase pipeline from scratch.
    await updatePhase(novelId, "planning")
    return runPlanningPhase(novelId)
  }

  for (const outline of chapters) await saveChapterOutline(novelId, outline)
  await updateTotalChapters(novelId, chapters.length)
  log(novelId, "checkpoint", `${chapters.length} chapter outlines saved`)

  await updatePhase(novelId, "drafting")
  emit(novelId, { type: "phase:changed", data: { phase: "drafting" } })
  log(novelId, "checkpoint", "Planning phase complete → drafting")
  console.log("\n  Planning phase complete. Advancing to Drafting.\n")
}

async function expandChapter(
  novelId: string,
  skeleton: ChapterOutline,
  allSkeletons: ChapterOutline[],
  worldBible: any,
  characters: any[],
  spine: any,
  seed: any,
  attempt: number = 1,
): Promise<ChapterOutline> {
  const userPrompt = buildBeatContext({
    targetChapter: skeleton,
    allSkeletons,
    priorChapters: [], // cross-chapter coherence lives in the skeleton tier
    worldBible,
    characters,
    spine,
    seed,
  })

  const result = await callAgent({
    novelId,
    agentName: "planning-beats",
    attempt,
    chapter: skeleton.chapterNumber,
    systemPrompt: PLANNING_BEATS_PROMPT,
    userPrompt,
    schema: beatSchema,
  })

  // Merge skeleton (phase 1) + beats (phase 2) into a full ChapterOutline.
  return {
    ...skeleton,
    scenes: result.output.scenes,
    establishedFacts: result.output.establishedFacts,
    characterStateChanges: result.output.characterStateChanges,
    knowledgeChanges: result.output.knowledgeChanges,
  } as ChapterOutline
}
