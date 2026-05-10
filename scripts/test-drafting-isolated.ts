/**
 * Drafting-isolated A/B harness — L097 Slice 2.5 + adjusted-B1/B3 lane.
 *
 * Takes a planning-done source novel id, clones it once per requested
 * writer arm via `scripts/variant/clone-for-variant.ts`, sets per-arm
 * pipelineOverrides via UPDATE on seed_json, runs `runDraftingPhase` on
 * each clone, and prints a per-chapter word-count comparison plus pairwise
 * deltas. The plan never changes between arms — clones inherit the same
 * chapter_outlines.
 *
 * Arms:
 *   baseline           — current production writer (sceneCallWriterV1=false,
 *                        writerExpansionMode="off",
 *                        writerPromptIdRendering="raw")
 *   id-suppress        — adjusted-B1 ablation: same writer as baseline, but
 *                        Cluster-1 raw-ID lines suppressed in the
 *                        prose-writer prompt (writerPromptIdRendering=
 *                        "suppress"). Trace metadata, DB rows, telemetry,
 *                        checker findings, proposals, evals, and audit
 *                        logs are unaffected — the flag is render-only.
 *                        See docs/decisions/L099-writer-prompt-id-rendering.md.
 *   contract-render-only — adjusted-B3 Arm B preparation: render the
 *                        SCENE CONTRACT block whenever the planner has
 *                        populated scene-contract fields, without
 *                        switching to scene-call writer mode. Requires
 *                        the new `forceRenderSceneContractWhenAvailable`
 *                        pipeline override (default-off). When the
 *                        underlying plan has no scene-contract fields
 *                        (the common production case while
 *                        scenePlanContractV1 stays default-off), the
 *                        rendered prompt remains byte-identical to
 *                        baseline.
 *   scene-call-v1      — L097 Slice 2: scene-call writer + retry-short-
 *                        scenes-v1 expansion path. The full B3 Arm C.
 *
 * Usage:
 *   bun scripts/test-drafting-isolated.ts \
 *     --source <planning-done-novel-id> \
 *     --target-prefix <prefix>                                   # e.g. "ab-1778378900"
 *     [--writer-arms baseline,id-suppress,contract-render-only,scene-call-v1]
 *                                                                # default: baseline,scene-call-v1
 *
 * Each arm becomes a clone novel id `<target-prefix>-<arm>`. Arms run
 * sequentially (parallel runs would race on shared DB resources).
 */

import { spawn } from "node:child_process"
import db from "../src/db/connection"
import { runDraftingPhase } from "../src/phases/drafting"
import { initNovelRun } from "../src/logger"
import { setAutoMode, setResolverMode } from "../src/cli"
import { getMode } from "../src/gates"

interface Args {
  source: string
  targetPrefix: string
  arms: ArmName[]
}

export const WRITER_ARM_NAMES = [
  "baseline",
  "id-suppress",
  "contract-render-only",
  "scene-call-v1",
] as const

export type ArmName = typeof WRITER_ARM_NAMES[number]

interface ArmResult {
  arm: ArmName
  novelId: string
  chapters: Array<{ chapter: number; words: number; targetWords: number; ratio: number }>
  totalWords: number
  totalTarget: number
  meanRatio: number
  expansionEvents: number
  error?: string
}

async function ensureSourceExists(source: string): Promise<void> {
  const [{ exists } = { exists: false }] = await db`
    SELECT EXISTS (SELECT 1 FROM novels WHERE id = ${source}) AS exists
  ` as any
  if (!exists) throw new Error(`Source novel ${source} not found`)
  // Drafting reads chapter_outlines from the source; reject sources that
  // have no plan yet. Phase string is permissive — `test-planner-isolated`
  // leaves novels at phase='concept' but with chapter_outlines populated;
  // drafting will run successfully on those.
  const [{ outline_count } = { outline_count: 0 }] = await db`
    SELECT COUNT(*)::int AS outline_count FROM chapter_outlines WHERE novel_id = ${source}
  ` as any
  if ((outline_count ?? 0) === 0) {
    throw new Error(`Source novel ${source} has no chapter_outlines; planning must complete before this script can run drafting`)
  }
}

function runCloneSubprocess(source: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["scripts/variant/clone-for-variant.ts", "--source", source, "--target", target], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", c => { stdout += c.toString() })
    child.stderr.on("data", c => { stderr += c.toString() })
    child.on("close", code => {
      if (code === 0) {
        if (stdout.trim()) console.log(stdout.trim().split("\n").map(l => `    [clone] ${l}`).join("\n"))
        resolve()
      } else {
        reject(new Error(`clone-for-variant exited ${code}: ${stderr.trim() || stdout.trim()}`))
      }
    })
    child.on("error", err => reject(err))
  })
}

interface ArmFlags {
  sceneCallWriterV1: boolean
  writerExpansionMode: "off" | "retry-short-scenes-v1"
  forceRenderSceneContractWhenAvailable: boolean
  writerPromptIdRendering: "raw" | "suppress"
}

export function flagsForArm(arm: ArmName): ArmFlags {
  switch (arm) {
    case "baseline":
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: false,
        writerPromptIdRendering: "raw",
      }
    case "id-suppress":
      // adjusted-B1 ablation: same writer + plan path as baseline; only the
      // prose-writer prompt's Cluster-1 raw-ID lines are suppressed.
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: false,
        writerPromptIdRendering: "suppress",
      }
    case "contract-render-only":
      // adjusted-B3 Arm B preparation: render the scene contract block
      // when populated, but keep the beat-shaped writer call unit. No
      // expansion-retry path. ID rendering stays raw so this arm is a
      // pure isolation of "contract rendering effect."
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: true,
        writerPromptIdRendering: "raw",
      }
    case "scene-call-v1":
      // L097 Slice 2: scene-call writer + expansion-retry. The full B3 Arm C.
      return {
        sceneCallWriterV1: true,
        writerExpansionMode: "retry-short-scenes-v1",
        forceRenderSceneContractWhenAvailable: false, // implied by sceneCallWriterV1=true
        writerPromptIdRendering: "raw",
      }
  }
}

async function setWriterFlags(novelId: string, arm: ArmName): Promise<void> {
  const flags = flagsForArm(arm)
  await db`
    UPDATE novels
    SET seed_json = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(seed_json, '{}'::jsonb),
                  '{pipelineOverrides}',
                  COALESCE(seed_json->'pipelineOverrides', '{}'::jsonb),
                  true
                ),
                '{pipelineOverrides,sceneCallWriterV1}',
                to_jsonb(${flags.sceneCallWriterV1}::boolean),
                true
              ),
              '{pipelineOverrides,writerExpansionMode}',
              to_jsonb(${flags.writerExpansionMode}::text),
              true
            ),
            '{pipelineOverrides,forceRenderSceneContractWhenAvailable}',
            to_jsonb(${flags.forceRenderSceneContractWhenAvailable}::boolean),
            true
          ),
          '{pipelineOverrides,writerPromptIdRendering}',
          to_jsonb(${flags.writerPromptIdRendering}::text),
          true
        ),
        updated_at = now()
    WHERE id = ${novelId}
  `
}

async function collectArmResult(arm: ArmName, novelId: string): Promise<Pick<ArmResult, "chapters" | "totalWords" | "totalTarget" | "meanRatio" | "expansionEvents">> {
  const chapterRows = await db`
    SELECT cd.chapter_number, cd.word_count, cd.version,
           (co.outline_json->>'targetWords')::int AS target_words
    FROM chapter_drafts cd
    JOIN chapter_outlines co ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
    WHERE cd.novel_id = ${novelId}
    ORDER BY cd.chapter_number ASC, cd.version DESC
  ` as Array<{ chapter_number: number; word_count: number; version: number; target_words: number }>

  const seenChapters = new Set<number>()
  const chapters: ArmResult["chapters"] = []
  for (const r of chapterRows) {
    if (seenChapters.has(r.chapter_number)) continue
    seenChapters.add(r.chapter_number)
    const target = r.target_words ?? 0
    chapters.push({
      chapter: r.chapter_number,
      words: r.word_count ?? 0,
      targetWords: target,
      ratio: target > 0 ? (r.word_count ?? 0) / target : 0,
    })
  }
  chapters.sort((a, b) => a.chapter - b.chapter)

  const totalWords = chapters.reduce((s, c) => s + c.words, 0)
  const totalTarget = chapters.reduce((s, c) => s + c.targetWords, 0)
  const meanRatio = chapters.length > 0
    ? chapters.reduce((s, c) => s + c.ratio, 0) / chapters.length
    : 0

  const expansionRows = await db`
    SELECT count(*)::int AS n FROM pipeline_events
    WHERE novel_id = ${novelId} AND event_type = 'writer-expansion'
  ` as Array<{ n: number }>
  const expansionEvents = expansionRows[0]?.n ?? 0

  return { chapters, totalWords, totalTarget, meanRatio, expansionEvents }
}

async function runArm(arm: ArmName, source: string, targetPrefix: string): Promise<ArmResult> {
  const novelId = `${targetPrefix}-${arm}`
  console.log(`\n━━━ arm: ${arm} ━━━`)
  console.log(`  cloning ${source} → ${novelId}`)
  try {
    await runCloneSubprocess(source, novelId)
  } catch (err) {
    return {
      arm, novelId, chapters: [], totalWords: 0, totalTarget: 0, meanRatio: 0,
      expansionEvents: 0, error: `clone failed: ${err instanceof Error ? err.message : err}`,
    }
  }

  console.log(`  setting writer flags (sceneCallWriterV1=${arm === "scene-call-v1"})`)
  await setWriterFlags(novelId, arm)

  await initNovelRun(novelId)
  console.log(`  drafting ...`)
  try {
    const result = await runDraftingPhase(novelId)
    if (result.kind !== "complete") {
      return {
        arm, novelId, chapters: [], totalWords: 0, totalTarget: 0, meanRatio: 0,
        expansionEvents: 0, error: `drafting did not complete: ${result.kind}`,
      }
    }
  } catch (err) {
    return {
      arm, novelId, chapters: [], totalWords: 0, totalTarget: 0, meanRatio: 0,
      expansionEvents: 0, error: err instanceof Error ? err.message : String(err),
    }
  }

  const collected = await collectArmResult(arm, novelId)
  return { arm, novelId, ...collected }
}

export function parseArgs(argv: string[]): Args {
  let source: string | null = null
  let targetPrefix: string | null = null
  let armsRaw: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--source") { source = argv[++i] ?? null; continue }
    if (a === "--target-prefix") { targetPrefix = argv[++i] ?? null; continue }
    if (a === "--writer-arms") { armsRaw = argv[++i] ?? null; continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!source) throw new Error("--source <planning-done-novel-id> is required")
  if (!targetPrefix) throw new Error("--target-prefix <prefix> is required")
  const arms: ArmName[] = (armsRaw ?? "baseline,scene-call-v1")
    .split(",").map(s => s.trim()).filter(Boolean) as ArmName[]
  for (const arm of arms) {
    if (!WRITER_ARM_NAMES.includes(arm)) {
      throw new Error(`--writer-arms entries must be one of ${WRITER_ARM_NAMES.join(", ")}; got ${arm}`)
    }
  }
  if (arms.length === 0) throw new Error("--writer-arms produced an empty arm list")
  return { source, targetPrefix, arms }
}

async function main() {
  setAutoMode(true)
  setResolverMode(getMode(true))

  const args = parseArgs(process.argv.slice(2))
  console.log(`source: ${args.source}`)
  console.log(`target prefix: ${args.targetPrefix}`)
  console.log(`arms: ${args.arms.join(", ")}`)

  await ensureSourceExists(args.source)

  const results: ArmResult[] = []
  for (const arm of args.arms) {
    results.push(await runArm(arm, args.source, args.targetPrefix))
  }

  console.log(`\n\n━━━━━━━━━━ A/B SUMMARY ━━━━━━━━━━`)
  for (const r of results) {
    console.log(`\n${r.arm} (${r.novelId})`)
    if (r.error) {
      console.log(`  FAILED: ${r.error}`)
      continue
    }
    console.log(`  chapters drafted: ${r.chapters.length}`)
    console.log(`  total words: ${r.totalWords} / target ${r.totalTarget}`)
    console.log(`  mean per-chapter ratio: ${r.meanRatio.toFixed(3)}`)
    console.log(`  writer-expansion events: ${r.expansionEvents}`)
    for (const c of r.chapters) {
      console.log(`    ch${c.chapter}: ${c.words}/${c.targetWords} (${c.ratio.toFixed(2)})`)
    }
  }

  const baseline = results.find(r => r.arm === "baseline")
  if (baseline && !baseline.error) {
    console.log(`\n━━━━━━━━━━ DELTAS vs baseline ━━━━━━━━━━`)
    for (const r of results) {
      if (r.arm === "baseline") continue
      if (r.error) {
        console.log(`  ${r.arm}: FAILED — ${r.error}`)
        continue
      }
      const delta = r.meanRatio - baseline.meanRatio
      const sign = delta >= 0 ? "+" : ""
      console.log(`  ${r.arm} − baseline: ${sign}${delta.toFixed(3)} (expansion events: ${r.expansionEvents})`)
      if (r.arm === "scene-call-v1") {
        // L097 POC magnitude check applies only to the scene-call-v1 arm
        // (the original POC compared baseline vs scene-call+expansion).
        if (delta >= 0.10) console.log(`    ✓ POC-magnitude improvement (≥0.10)`)
        else if (delta >= 0.05) console.log(`    ⚠ partial improvement (≥0.05 but <0.10) — sub-POC magnitude`)
        else console.log(`    ✗ insufficient improvement (<0.05) — does not match POC evidence`)
      }
    }
  }

  process.exit(0)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack : err)
    process.exit(1)
  })
}
