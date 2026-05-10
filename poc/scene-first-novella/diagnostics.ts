/**
 * Scene-first novella POC — post-hoc diagnostics.
 *
 * Reads the artifacts captured by run.ts (chapter-N.md +
 * chapter-N.scene-contracts.json) under
 * poc/scene-first-novella/output/<runId>/, runs three V4 Flash judges
 * over the prose, and writes chapter-N.diagnostics.json per chapter.
 *
 * Pragmatic, NOT calibrated. Output is for operator review, not
 * promotion. The three dimensions are taken from
 * `docs/research/opus-semantic-judge-plan.md` J1-J3 with simplified
 * binary-leaning rubrics.
 *
 *   J1 endpoint-landing      → chapter granularity
 *   J2 scene-dramaturgy      → scene granularity
 *   J3 character-agency      → scene granularity
 *
 * Nonblocking: any failed judge call records the error in the
 * diagnostics output and the run continues.
 *
 * Usage:
 *   bun poc/scene-first-novella/diagnostics.ts \
 *     --run-dir poc/scene-first-novella/output/poc-scene-first-<ts>
 */

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { callAgent } from "../../src/llm"
import { initNovelRun } from "../../src/logger"
import { setAutoMode, setResolverMode } from "../../src/cli"
import { getMode } from "../../src/gates"

interface Args {
  runDir: string
  // Cap on total scenes (across all chapters) the diagnostics will judge.
  // Used during dev to bound cost; production runs use a high cap.
  maxScenes: number
}

function parseArgs(argv: string[]): Args {
  let runDir: string | null = null
  let maxScenes = 100
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--run-dir") { runDir = argv[++i] ?? null; continue }
    if (a === "--max-scenes") { maxScenes = Number.parseInt(argv[++i] ?? "100", 10); continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!runDir) throw new Error("--run-dir <path> is required")
  return { runDir, maxScenes }
}

// ── Schemas ─────────────────────────────────────────────────────────────

const endpointLandingSchema = z.object({
  declared_endpoint: z.string().describe("Restate the planner's declared chapter purpose / endpoint in one sentence to anchor the assessment."),
  arrived: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).describe("0=missed, 1=glanced, 2=close, 3=landed cleanly"),
  evidence: z.string().describe("One direct quote (≤30 words) from the chapter prose that demonstrates the assessment, OR a brief phrase 'no evidence found' if 0."),
  reasoning: z.string().describe("≤2 sentences explaining the score against the declared endpoint."),
})

const sceneDramaturgySchema = z.object({
  prose_span_summary: z.string().describe("≤30 words summarising which prose span you read as 'this scene' (helps the operator audit your span selection)."),
  value_shift: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).describe("0=no shift, 1=weak/cosmetic, 2=clear, 3=strong"),
  conflict_visible: z.boolean().describe("Is there visible conflict (interpersonal, internal, or environmental) in the scene prose?"),
  decision_or_revelation: z.boolean().describe("Does the scene contain a meaningful character decision OR a revelation that changes what the reader knows?"),
  evidence: z.string().describe("One direct quote (≤30 words) supporting the strongest of the three signals above."),
})

const characterAgencySchema = z.object({
  protagonist_name: z.string().describe("Restate the POV character's name as you read them in the prose."),
  agency: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).describe("0=passive (events happen TO them), 1=reactive (responds without driving), 2=choosing (active choices visible), 3=driving (causes consequences others react to)"),
  named_choice_or_action: z.string().describe("Name the most agency-bearing choice or action the protagonist makes in this scene, OR 'none' if 0."),
  evidence: z.string().describe("One direct quote (≤30 words) supporting the agency assessment."),
})

// ── Prompts ─────────────────────────────────────────────────────────────

const ENDPOINT_LANDING_SYSTEM = `You are a craft diagnostic judge for prose chapters. Score whether a generated chapter actually arrives at the endpoint its planner declared.

Score 0-3:
  3 — landed: the chapter's final pages clearly resolve the declared endpoint with concrete prose evidence.
  2 — close: the endpoint is reachable from the prose but only via inference; the writer drifted near it but did not commit.
  1 — glanced: the endpoint is mentioned or hinted but not actually staged dramatically.
  0 — missed: the chapter ends elsewhere; declared endpoint is absent or contradicted.

Be strict on 3. Most chapters that "address the endpoint" actually score 1 or 2. Only score 3 when the prose unambiguously stages the endpoint.

Respond as JSON conforming to the schema. Quote prose in the evidence field; do not paraphrase.`

const SCENE_DRAMATURGY_SYSTEM = `You are a craft diagnostic judge for individual scenes inside a chapter. The chapter prose is concatenated; you are given the planner's description of one scene and must locate the matching span in the prose, then assess its dramatic completeness.

Three binary-leaning signals:
  value_shift: did the scene's value-charge shift? (life→death, hope→despair, trust→suspicion, etc.). 0 no, 1 weak/cosmetic, 2 clear, 3 strong.
  conflict_visible: is there visible conflict? interpersonal/internal/environmental.
  decision_or_revelation: meaningful choice or revelation that changes the chapter's trajectory?

Most "OK" scenes score value_shift=1 or 2, conflict_visible=true, decision_or_revelation=false. Reserve value_shift=3 for scenes whose ending materially changes the protagonist's situation.

Respond as JSON conforming to the schema. Quote prose in the evidence field.`

const CHARACTER_AGENCY_SYSTEM = `You are a craft diagnostic judge for character agency at scene granularity. Given a chapter's prose and one scene's planner description, locate the matching span and assess whether the POV protagonist actually drives the scene's events.

Score 0-3:
  3 — driving: protagonist's choice or action is the cause; other characters react.
  2 — choosing: protagonist makes a visible choice but the scene is partly driven by external pressure.
  1 — reactive: protagonist responds to others' actions without taking initiative; their choice is delayed or implicit.
  0 — passive: events happen to the protagonist; their will does not appear on the page.

A scene with strong protagonist interiority (ruminating, observing, recalling) but no on-page choice or action scores 1 at most. Agency is what shows up in the prose, not what the protagonist could feel.

Respond as JSON conforming to the schema. Quote prose in the evidence field.`

// ── Diagnostic helpers ──────────────────────────────────────────────────

interface ChapterArtifact {
  chapterNumber: number
  prose: string
  contracts: any
}

async function loadChapterArtifact(runDir: string, ch: number): Promise<ChapterArtifact | null> {
  const proseFile = Bun.file(join(runDir, `chapter-${ch}.md`))
  const contractFile = Bun.file(join(runDir, `chapter-${ch}.scene-contracts.json`))
  if (!await proseFile.exists() || !await contractFile.exists()) return null
  const proseRaw = await proseFile.text()
  const contracts = await contractFile.json()
  // Strip the markdown header (first paragraph block) so the judge reads
  // the actual prose, not the metadata heading.
  const stripped = proseRaw.replace(/^# Chapter [^\n]*\n\n(?:\*[^\n]*\n)+\n/m, "")
  return { chapterNumber: ch, prose: stripped, contracts }
}

async function judgeEndpointLanding(novelId: string, ch: ChapterArtifact): Promise<{ result?: z.infer<typeof endpointLandingSchema>; error?: string }> {
  const declared = ch.contracts.purpose ?? ch.contracts.title ?? "(no declared endpoint)"
  const userPrompt = [
    `CHAPTER NUMBER: ${ch.chapterNumber}`,
    `DECLARED PURPOSE / ENDPOINT (from planner):`,
    declared,
    ``,
    `CHAPTER PROSE:`,
    ch.prose,
  ].join("\n")
  try {
    const res = await callAgent({
      novelId,
      agentName: "poc-judge-endpoint-landing",
      chapter: ch.chapterNumber,
      systemPrompt: ENDPOINT_LANDING_SYSTEM,
      userPrompt,
      schema: endpointLandingSchema,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      temperature: 0.1,
      maxTokens: 600,
    })
    return { result: res.output }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function judgeSceneDramaturgy(novelId: string, ch: ChapterArtifact, sceneIdx: number): Promise<{ result?: z.infer<typeof sceneDramaturgySchema>; error?: string }> {
  const scene = ch.contracts.scenes[sceneIdx]
  if (!scene) return { error: `scene index ${sceneIdx} out of range` }
  const userPrompt = [
    `CHAPTER NUMBER: ${ch.chapterNumber}`,
    `SCENE INDEX (within chapter): ${sceneIdx + 1}/${ch.contracts.scenes.length}`,
    `SCENE PLANNER DESCRIPTION:`,
    scene.description ?? "(no description)",
    ``,
    `SCENE CONTRACT (planner-authored, may be partial):`,
    JSON.stringify(scene.contract ?? {}, null, 2),
    ``,
    `FULL CHAPTER PROSE (locate the scene span yourself):`,
    ch.prose,
  ].join("\n")
  try {
    const res = await callAgent({
      novelId,
      agentName: "poc-judge-scene-dramaturgy",
      chapter: ch.chapterNumber,
      sceneId: scene.sceneId ?? undefined,
      beatIndex: sceneIdx,
      systemPrompt: SCENE_DRAMATURGY_SYSTEM,
      userPrompt,
      schema: sceneDramaturgySchema,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      temperature: 0.1,
      maxTokens: 500,
    })
    return { result: res.output }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function judgeCharacterAgency(novelId: string, ch: ChapterArtifact, sceneIdx: number): Promise<{ result?: z.infer<typeof characterAgencySchema>; error?: string }> {
  const scene = ch.contracts.scenes[sceneIdx]
  if (!scene) return { error: `scene index ${sceneIdx} out of range` }
  const userPrompt = [
    `POV CHARACTER (from planner): ${ch.contracts.povCharacter}`,
    `CHAPTER NUMBER: ${ch.chapterNumber}`,
    `SCENE INDEX: ${sceneIdx + 1}/${ch.contracts.scenes.length}`,
    `SCENE PLANNER DESCRIPTION:`,
    scene.description ?? "(no description)",
    ``,
    `FULL CHAPTER PROSE (locate the scene span yourself):`,
    ch.prose,
  ].join("\n")
  try {
    const res = await callAgent({
      novelId,
      agentName: "poc-judge-character-agency",
      chapter: ch.chapterNumber,
      sceneId: scene.sceneId ?? undefined,
      beatIndex: sceneIdx,
      systemPrompt: CHARACTER_AGENCY_SYSTEM,
      userPrompt,
      schema: characterAgencySchema,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      temperature: 0.1,
      maxTokens: 500,
    })
    return { result: res.output }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  console.log(`run dir: ${args.runDir}`)

  setAutoMode(true)
  setResolverMode(getMode(true))

  // Tag the diagnostics calls with the run id so llm_calls rows are
  // queryable per run. The run id is the directory basename.
  const runId = args.runDir.replace(/\/$/, "").split("/").pop() ?? "poc-unknown"
  await initNovelRun(runId)

  // Discover chapters by scanning for chapter-*.md
  const chapters: ChapterArtifact[] = []
  for (let ch = 1; ch <= 50; ch++) {
    const art = await loadChapterArtifact(args.runDir, ch)
    if (art) chapters.push(art)
    else if (ch > 1) break // stop at first gap
  }
  console.log(`loaded ${chapters.length} chapters`)
  if (chapters.length === 0) throw new Error("no chapter artifacts found in run dir")

  let scenesJudged = 0
  for (const ch of chapters) {
    console.log(`\n━━━ chapter ${ch.chapterNumber} ━━━`)
    const endpoint = await judgeEndpointLanding(runId, ch)
    console.log(`  endpoint-landing: ${endpoint.result ? `arrived=${endpoint.result.arrived}` : `ERROR ${endpoint.error}`}`)

    const scenes: any[] = []
    const totalScenes = ch.contracts.scenes.length
    for (let i = 0; i < totalScenes; i++) {
      if (scenesJudged >= args.maxScenes) {
        scenes.push({ sceneIndex: i, sceneId: ch.contracts.scenes[i]?.sceneId, skipped: "max-scenes cap reached" })
        continue
      }
      const dram = await judgeSceneDramaturgy(runId, ch, i)
      const agency = await judgeCharacterAgency(runId, ch, i)
      console.log(`  scene ${i + 1}/${totalScenes}: dramaturgy=${dram.result ? `value_shift=${dram.result.value_shift}/conflict=${dram.result.conflict_visible}/d-or-r=${dram.result.decision_or_revelation}` : `ERROR`}; agency=${agency.result ? `${agency.result.agency}` : `ERROR`}`)
      scenes.push({
        sceneIndex: i,
        sceneId: ch.contracts.scenes[i]?.sceneId ?? null,
        beatId: ch.contracts.scenes[i]?.beatId ?? null,
        description: ch.contracts.scenes[i]?.description ?? null,
        sceneDramaturgy: dram.result ?? null,
        sceneDramaturgyError: dram.error ?? null,
        characterAgency: agency.result ?? null,
        characterAgencyError: agency.error ?? null,
      })
      scenesJudged++
    }

    const diagnostics = {
      runId,
      chapterNumber: ch.chapterNumber,
      chapterId: ch.contracts.chapterId ?? null,
      povCharacter: ch.contracts.povCharacter,
      endpointLanding: endpoint.result ?? null,
      endpointLandingError: endpoint.error ?? null,
      scenes,
      ranAt: new Date().toISOString(),
    }
    await writeFile(
      join(args.runDir, `chapter-${ch.chapterNumber}.diagnostics.json`),
      JSON.stringify(diagnostics, null, 2),
      "utf8",
    )
  }

  console.log(`\n✓ diagnostics complete; ${scenesJudged} scenes judged`)
  console.log(`  next: bun poc/scene-first-novella/render-html.ts --run-dir ${args.runDir}`)
  process.exit(0)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
