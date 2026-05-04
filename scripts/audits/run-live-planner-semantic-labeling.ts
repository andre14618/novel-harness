/**
 * Step 2C runner: overlap DeepSeek V4 Flash / V4 Pro semantic labels over
 * actual planner/state-mapper source IDs from chapter_outlines.outline_json.
 *
 * Usage:
 *   bun scripts/audits/run-live-planner-semantic-labeling.ts --latest
 *   bun scripts/audits/run-live-planner-semantic-labeling.ts --novel-id=<id>
 *   bun scripts/audits/run-live-planner-semantic-labeling.ts --latest --item-limit=3 --flash-samples=1 --pro-samples=1
 */

import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { mkdirSync } from "node:fs"
import db from "../../src/db/connection"
import { getApprovedDraft } from "../../src/db/drafts"
import { callAgent } from "../../src/llm"
import { initNovelRun, getRunId } from "../../src/logger"
import { chapterOutlineSchema, type ChapterOutline } from "../../src/agents/planning-plotter/schema"
import { enrichOutlineIds } from "../../src/harness/ids"
import {
  runPlannerCanonDeltaAudit,
  type PlannerCanonDeltaReport,
  type PlannerCanonDeltaSourceItem,
} from "../../src/canon/planner-canon-delta"
import {
  aggregatePlannerSemanticPanel,
  plannerMissingCanonItemsSchema,
  plannerSemanticItemLabelSchema,
  PLANNER_SEMANTIC_LABEL_SCHEMA_VERSION,
  type PlannerMissingCanonItems,
  type PlannerSemanticItemLabel,
  type PlannerSemanticPanelCall,
  type PlannerSemanticPanelReport,
} from "../../src/canon/planner-semantic-labeling"

type Route = "flash" | "pro"

interface Args {
  novelId: string | null
  latest: boolean
  json: boolean
  outPath: string | null
  flashSamples: number
  proSamples: number
  itemLimit: number | null
  maxConcurrency: number
  maxProseChars: number
}

interface NovelRow {
  id: string
  phase: string
  seed_json: { genre?: string; premise?: string; chapterCount?: number } | null
  current_chapter: number
  total_chapters: number
  created_at: Date
}

interface OutlineRow {
  chapter_number: number
  outline_json: unknown
}

interface ApprovedDraftSnapshot {
  chapterN: number
  version: number
  wordCount: number
  prose: string
  truncated: boolean
}

interface LlmUsageSummary {
  runId: number | null
  llmCallIds: number[]
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  cost: number
  cacheHitRatio: number
  failedRows: number
}

interface PanelArtifact {
  schemaVersion: string
  createdAt: string
  novel: NovelRow
  args: Args
  runId: number | null
  prompt: {
    systemPromptHash: string
    stableUserPrefixHash: string
    systemPromptChars: number
    stableUserPrefixChars: number
    maxProseChars: number
  }
  deltaReport: PlannerCanonDeltaReport
  approvedDrafts: Array<Omit<ApprovedDraftSnapshot, "prose">>
  calls: PlannerSemanticPanelCall[]
  aggregate: PlannerSemanticPanelReport
  humanQueue: HumanQueueItem[]
  llmUsage: LlmUsageSummary
}

interface HumanQueueItem {
  kind: "item" | "missing"
  reason: string
  itemId?: string
  candidateKey?: string
  chapterN: number
  text?: string
}

interface SemanticTaskBase {
  taskIndex: number
  novelId: string
  route: Route
  sampleIndex: number
  chapterN: number
}

interface ItemSemanticTask extends SemanticTaskBase {
  task: "item"
  item: PlannerCanonDeltaSourceItem
  userPrompt: string
}

interface MissingSemanticTask extends SemanticTaskBase {
  task: "missing"
  userPrompt: string
  emittedSourceKeys: string[]
}

type SemanticTask = ItemSemanticTask | MissingSemanticTask

const ROUTE_AGENT: Record<Route, string> = {
  flash: "planner-semantic-label-flash",
  pro: "planner-semantic-label-pro",
}

const DEFAULT_FLASH_SAMPLES = 3
const DEFAULT_PRO_SAMPLES = 1
const DEFAULT_MAX_CONCURRENCY = 3
const DEFAULT_MAX_PROSE_CHARS = 16_000

const SYSTEM_PROMPT = `You are a semantic audit judge for Novel Harness planner Canon source items.

This is an offline validation surface, not creative writing. Deterministic code already verified that stable IDs exist and are mechanically referenced. Your job is to judge whether the content attached to each emitted ID is semantically safe for Canon.

Use only the supplied audit packet. Do not use outside story knowledge. Do not repair or rewrite the story. Do not infer hidden facts beyond the outline, beat obligations, payoff links, and approved prose excerpts in the packet.

Evidence tiers:
- required: chapter outline, emitted source item catalog, beat descriptions, beat obligations, payoff links, and approved prose excerpts when present.
- supporting: gate results and task metadata.
- inventory: cross-chapter catalog context that prevents duplicate or missing-item mistakes.

Verdict rules for item labeling:
- correct: the target item is concrete, planner-visible, supported by the packet, and useful as Canon for later chapters.
- incorrect: the target item contradicts the packet or states something the plan/prose does not support.
- partial: the target item has a valid core but is too broad, conflates multiple claims, uses the wrong character, or needs editing before Canon.
- unsupported: the target item may be plausible but lacks packet evidence.
- needs_human: packet evidence is ambiguous or the decision depends on editorial judgment.

Canon safety rules:
- direct_write: only when planVerdict is correct, confidence is high, evidence quotes support the claim, and the exact target text can enter Canon unchanged.
- human_review: use for partial, ambiguous, important, or wording-sensitive rows.
- reject: use for incorrect or unsupported rows that should not enter Canon as written.

Missing-item task rules:
- Identify planner-eligible Canon facts, knowledge changes, or character-state changes that are present in the packet but absent from the emitted source item catalog.
- Do not list style notes, prose quality, generic emotions, or facts already represented by an emitted source item.
- Return at most 10 missing items for the requested chapter. Omit uncertain candidates instead of padding.

Output must be one valid JSON object matching the requested task schema. Evidence quotes must be exact substrings from the packet. The deterministic post-validator rejects mismatched IDs, kinds, chapters, invalid enum values, direct_write without correct verdict, and exact duplicate missing items.`

function parseArgs(): Args {
  const novelId = valueArg("--novel-id=")
  return {
    novelId,
    latest: process.argv.includes("--latest"),
    json: process.argv.includes("--json"),
    outPath: valueArg("--out="),
    flashSamples: intArg("--flash-samples=", DEFAULT_FLASH_SAMPLES),
    proSamples: intArg("--pro-samples=", DEFAULT_PRO_SAMPLES),
    itemLimit: optionalIntArg("--item-limit="),
    maxConcurrency: intArg("--max-concurrency=", DEFAULT_MAX_CONCURRENCY),
    maxProseChars: intArg("--max-prose-chars=", DEFAULT_MAX_PROSE_CHARS),
  }
}

async function main(): Promise<void> {
  const args = parseArgs()
  if (!args.latest && !args.novelId) {
    console.error("usage: bun scripts/audits/run-live-planner-semantic-labeling.ts --latest|--novel-id=<id> [--json] [--out=<path>] [--flash-samples=N] [--pro-samples=N] [--item-limit=N]")
    process.exit(2)
  }
  if (args.flashSamples <= 0 && args.proSamples <= 0) throw new Error("At least one route sample is required")
  if (args.maxConcurrency <= 0) throw new Error("--max-concurrency must be positive")

  const novel = args.latest
    ? await fetchLatestNovelWithOutlines()
    : await fetchNovel(args.novelId!)
  if (!novel) throw new Error(args.latest ? "No novel with chapter_outlines found" : `Novel not found: ${args.novelId}`)

  await initNovelRun(novel.id)
  const outlineRows = await fetchOutlines(novel.id)
  const outlines = parseOutlines(outlineRows)
  const deltaReport = runPlannerCanonDeltaAudit(novel.id, outlines)
  if (!deltaReport.summary.idGraphGateClear) {
    throw new Error(`ID graph is not clean; run Step 2B first. recommendation=${deltaReport.summary.recommendation}`)
  }

  const approvedDrafts = await fetchApprovedDrafts(novel.id, outlines, args.maxProseChars)
  const stableUserPrefix = buildStableUserPrefix(novel, outlines, deltaReport, approvedDrafts)
  const sourceItems = selectedSourceItems(deltaReport, args.itemLimit)
  const tasks = buildTasks(novel.id, sourceItems, deltaReport, stableUserPrefix, args)

  console.log(`Step 2C semantic labeling: novel=${novel.id} items=${sourceItems.length}/${deltaReport.sourceItems.length} calls=${tasks.length} flash=${args.flashSamples} pro=${args.proSamples}`)
  console.log(`Stable prefix: system=${SYSTEM_PROMPT.length} chars user=${stableUserPrefix.length} chars hash=${sha256(stableUserPrefix).slice(0, 12)}`)

  const calls = await runTasksWithRouteWarmup(tasks, args.maxConcurrency)
  const aggregate = aggregatePlannerSemanticPanel(calls)
  const humanQueue = buildHumanQueue(aggregate, deltaReport)
  const llmUsage = await fetchLlmUsage(getRunId())

  const artifact: PanelArtifact = {
    schemaVersion: PLANNER_SEMANTIC_LABEL_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    novel,
    args,
    runId: getRunId(),
    prompt: {
      systemPromptHash: sha256(SYSTEM_PROMPT),
      stableUserPrefixHash: sha256(stableUserPrefix),
      systemPromptChars: SYSTEM_PROMPT.length,
      stableUserPrefixChars: stableUserPrefix.length,
      maxProseChars: args.maxProseChars,
    },
    deltaReport,
    approvedDrafts: approvedDrafts.map(({ prose: _prose, ...draft }) => draft),
    calls,
    aggregate,
    humanQueue,
    llmUsage,
  }

  const outPath = args.outPath ?? defaultOutPath(novel.id)
  mkdirSync(dirname(outPath), { recursive: true })
  await Bun.write(outPath, JSON.stringify(artifact, null, 2) + "\n")

  if (args.json) {
    console.log(JSON.stringify({ outPath, ...artifact }, null, 2))
  } else {
    printHumanReport(novel, outPath, artifact)
  }
}

async function runTasksWithRouteWarmup(
  tasks: readonly SemanticTask[],
  maxConcurrency: number,
): Promise<PlannerSemanticPanelCall[]> {
  const warmIndexes = new Set<number>()
  const warmTasks: SemanticTask[] = []
  for (const route of ["flash", "pro"] as const) {
    const first = tasks.find((task) => task.route === route)
    if (first) {
      warmIndexes.add(first.taskIndex)
      warmTasks.push(first)
    }
  }

  const calls: PlannerSemanticPanelCall[] = []
  let completed = 0
  const execute = async (task: SemanticTask): Promise<PlannerSemanticPanelCall> => {
    const call = await runSemanticTask(task)
    completed++
    if (!call.ok || completed === tasks.length || completed % 5 === 0) {
      const label = call.task === "item" ? `${call.itemId}` : `missing-ch${call.chapterN}`
      console.log(`  [panel] ${completed}/${tasks.length} ${call.route}#${call.sampleIndex} ${call.task} ${label} ${call.ok ? "ok" : "failed"}`)
    }
    return call
  }

  for (const task of warmTasks) calls.push(await execute(task))
  const remaining = tasks.filter((task) => !warmIndexes.has(task.taskIndex))
  calls.push(...await runLimited(remaining, maxConcurrency, execute))
  return calls.sort(compareCalls)
}

async function runSemanticTask(task: SemanticTask): Promise<PlannerSemanticPanelCall> {
  try {
    if (task.task === "item") {
      const result = await callAgent({
        agentName: ROUTE_AGENT[task.route],
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: task.userPrompt,
        schema: plannerSemanticItemLabelSchema,
        novelId: task.novelId,
        chapter: task.chapterN,
        attempt: task.sampleIndex,
        logMetadata: logMetadata(task),
      })
      validateItemLabel(task.item, result.output)
      return {
        task: "item",
        route: task.route,
        sampleIndex: task.sampleIndex,
        itemId: task.item.id,
        itemKind: task.item.kind,
        chapterN: task.chapterN,
        ok: true,
        label: result.output,
        llmCallId: result.llmCallId ?? null,
      }
    }

    const result = await callAgent({
      agentName: ROUTE_AGENT[task.route],
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: task.userPrompt,
      schema: plannerMissingCanonItemsSchema,
      novelId: task.novelId,
      chapter: task.chapterN,
      attempt: task.sampleIndex,
      logMetadata: logMetadata(task),
    })
    validateMissingResult(task.chapterN, result.output, new Set(task.emittedSourceKeys))
    return {
      task: "missing",
      route: task.route,
      sampleIndex: task.sampleIndex,
      chapterN: task.chapterN,
      ok: true,
      result: result.output,
      llmCallId: result.llmCallId ?? null,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (task.task === "item") {
      return {
        task: "item",
        route: task.route,
        sampleIndex: task.sampleIndex,
        itemId: task.item.id,
        itemKind: task.item.kind,
        chapterN: task.chapterN,
        ok: false,
        error,
        llmCallId: null,
      }
    }
    return {
      task: "missing",
      route: task.route,
      sampleIndex: task.sampleIndex,
      chapterN: task.chapterN,
      ok: false,
      error,
      llmCallId: null,
    }
  }
}

function buildTasks(
  novelId: string,
  sourceItems: readonly PlannerCanonDeltaSourceItem[],
  deltaReport: PlannerCanonDeltaReport,
  stableUserPrefix: string,
  args: Args,
): SemanticTask[] {
  const tasks: SemanticTask[] = []
  let taskIndex = 0
  const emittedSourceKeysByChapter = new Map(deltaReport.chapters.map((chapter) => [
    chapter.chapterN,
    chapter.sourceItems.map((item) => duplicateKey(item.kind, item.text)),
  ]))
  for (const item of sourceItems) {
    for (const route of ["flash", "pro"] as const) {
      const samples = route === "flash" ? args.flashSamples : args.proSamples
      for (let sampleIndex = 1; sampleIndex <= samples; sampleIndex++) {
        tasks.push({
          task: "item",
          taskIndex: taskIndex++,
          novelId,
          route,
          sampleIndex,
          chapterN: item.chapterN,
          item,
          userPrompt: buildItemUserPrompt(stableUserPrefix, item),
        })
      }
    }
  }

  for (const chapter of deltaReport.chapters) {
    for (const route of ["flash", "pro"] as const) {
      const samples = route === "flash" ? args.flashSamples : args.proSamples
      for (let sampleIndex = 1; sampleIndex <= samples; sampleIndex++) {
        tasks.push({
          task: "missing",
          taskIndex: taskIndex++,
          novelId,
          route,
          sampleIndex,
          chapterN: chapter.chapterN,
          emittedSourceKeys: emittedSourceKeysByChapter.get(chapter.chapterN) ?? [],
          userPrompt: buildMissingUserPrompt(stableUserPrefix, chapter.chapterN),
        })
      }
    }
  }
  return tasks
}

function buildStableUserPrefix(
  novel: NovelRow,
  outlines: readonly ChapterOutline[],
  deltaReport: PlannerCanonDeltaReport,
  approvedDrafts: readonly ApprovedDraftSnapshot[],
): string {
  const draftsByChapter = new Map(approvedDrafts.map((draft) => [draft.chapterN, draft]))
  const itemsByChapter = groupBy(deltaReport.sourceItems, (item) => item.chapterN)
  const obligationsByChapter = groupBy(deltaReport.obligations, (item) => item.chapterN)
  const payoffsByChapter = groupBy(deltaReport.payoffLinks, (item) => item.chapterN)
  const packet = {
    schemaVersion: PLANNER_SEMANTIC_LABEL_SCHEMA_VERSION,
    evidenceTiers: {
      required: {
        novel: {
          id: novel.id,
          phase: novel.phase,
          genre: novel.seed_json?.genre ?? "",
          premise: novel.seed_json?.premise ?? "",
          currentChapter: novel.current_chapter,
          totalChapters: novel.total_chapters,
        },
        chapters: outlines.map((outline) => {
          const draft = draftsByChapter.get(outline.chapterNumber)
          return {
            chapterN: outline.chapterNumber,
            title: outline.title,
            chapterId: outline.chapterId,
            povCharacter: outline.povCharacter,
            setting: outline.setting,
            purpose: outline.purpose,
            charactersPresent: outline.charactersPresent,
            sourceItems: itemsByChapter.get(outline.chapterNumber) ?? [],
            beats: (outline.scenes ?? []).map((beat, beatIndex) => ({
              beatIndex,
              beatId: beat.beatId,
              kind: beat.kind,
              description: beat.description,
              characters: beat.characters,
              requiredPayoffs: beat.requiredPayoffs,
              obligations: compactObligations(beat.obligations),
            })),
            payoffLinks: payoffsByChapter.get(outline.chapterNumber) ?? [],
            approvedProse: draft ? {
              version: draft.version,
              wordCount: draft.wordCount,
              truncated: draft.truncated,
              prose: draft.prose,
            } : null,
          }
        }),
      },
      supporting: {
        sourceName: deltaReport.sourceName,
        idGraphGateClear: deltaReport.summary.idGraphGateClear,
        artifactGateClear: deltaReport.summary.artifactGateClear,
        recommendation: deltaReport.summary.recommendation,
        instruction: "Judge semantic Canon safety of emitted planner IDs. Mechanical ID integrity is already checked; do not relitigate ID format unless target metadata mismatches.",
      },
      inventory: {
        sourceItemCatalog: deltaReport.sourceItems,
        obligationCatalog: deltaReport.obligations,
        payoffCatalog: deltaReport.payoffLinks,
        obligationCountsByChapter: Object.fromEntries(
          [...obligationsByChapter.entries()].map(([chapterN, rows]) => [String(chapterN), rows.length]),
        ),
      },
    },
  }
  return `STABLE_AUDIT_PACKET_JSON\n${JSON.stringify(packet, null, 2)}\n\n`
}

function buildItemUserPrompt(stableUserPrefix: string, item: PlannerCanonDeltaSourceItem): string {
  return `${stableUserPrefix}VOLATILE_TASK_JSON\n${JSON.stringify({
    task: "label_item",
    targetItem: item,
    outputShape: {
      itemId: "must equal targetItem.id",
      itemKind: "fact | knowledge | state",
      chapterN: "must equal targetItem.chapterN",
      planVerdict: "correct | incorrect | partial | unsupported | needs_human",
      canonSafety: "direct_write | human_review | reject",
      confidence: "0..1",
      evidence: [{ source: "chapter_outline | beat_description | beat_obligation | approved_prose | absence", quote: "exact packet quote", explanation: "short" }],
      reason: "short rationale",
      caveats: ["optional"],
    },
  }, null, 2)}\n\nReturn only the JSON object for this target item.`
}

function buildMissingUserPrompt(stableUserPrefix: string, chapterN: number): string {
  return `${stableUserPrefix}VOLATILE_TASK_JSON\n${JSON.stringify({
    task: "find_missing_planner_eligible_canon_items",
    chapterN,
    outputShape: {
      chapterN: "must equal requested chapterN",
      missingItems: [{
        kind: "fact | knowledge | state",
        chapterN: "requested chapterN",
        proposedId: "optional stable-id-style suggestion or empty string",
        text: "missing Canon item text",
        characterName: "required for knowledge/state when relevant, else empty string",
        whyPlannerEligible: "why this should have been in emitted source items",
        confidence: "0..1",
        evidence: [{ source: "chapter_outline | beat_description | beat_obligation | approved_prose | absence", quote: "exact packet quote", explanation: "short" }],
      }],
    },
  }, null, 2)}\n\nReturn only the JSON object for this missing-item pass.`
}

function validateItemLabel(target: PlannerCanonDeltaSourceItem, label: PlannerSemanticItemLabel): void {
  const errors: string[] = []
  if (label.itemId !== target.id) errors.push(`itemId mismatch: got ${label.itemId}, expected ${target.id}`)
  if (label.itemKind !== target.kind) errors.push(`itemKind mismatch: got ${label.itemKind}, expected ${target.kind}`)
  if (label.chapterN !== target.chapterN) errors.push(`chapterN mismatch: got ${label.chapterN}, expected ${target.chapterN}`)
  if (label.canonSafety === "direct_write" && label.planVerdict !== "correct") {
    errors.push(`direct_write requires correct verdict, got ${label.planVerdict}`)
  }
  if (label.canonSafety === "direct_write" && label.confidence < 0.7) {
    errors.push(`direct_write confidence too low: ${label.confidence}`)
  }
  if (label.canonSafety === "direct_write" && label.evidence.length === 0) {
    errors.push("direct_write requires at least one evidence quote")
  }
  if (label.evidence.some((evidence) => evidence.quote.trim().length === 0)) {
    errors.push("evidence quotes must be non-empty")
  }
  if (errors.length) throw new Error(`post-validation failed for ${target.id}: ${errors.join("; ")}`)
}

function validateMissingResult(chapterN: number, result: PlannerMissingCanonItems, emittedSourceKeys: Set<string>): void {
  const errors: string[] = []
  if (result.chapterN !== chapterN) errors.push(`chapterN mismatch: got ${result.chapterN}, expected ${chapterN}`)
  for (const [index, item] of result.missingItems.entries()) {
    if (item.chapterN !== chapterN) errors.push(`missingItems[${index}].chapterN mismatch: got ${item.chapterN}`)
    if (!item.text.trim()) errors.push(`missingItems[${index}].text is empty`)
    if (!item.whyPlannerEligible.trim()) errors.push(`missingItems[${index}].whyPlannerEligible is empty`)
    if (emittedSourceKeys.has(duplicateKey(item.kind, item.text))) {
      errors.push(`missingItems[${index}] duplicates an emitted ${item.kind} source item: ${item.text}`)
    }
  }
  if (errors.length) throw new Error(`missing-item post-validation failed for ch${chapterN}: ${errors.join("; ")}`)
}

function selectedSourceItems(
  deltaReport: PlannerCanonDeltaReport,
  itemLimit: number | null,
): PlannerCanonDeltaSourceItem[] {
  const sorted = [...deltaReport.sourceItems].sort((a, b) => {
    if (a.chapterN !== b.chapterN) return a.chapterN - b.chapterN
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
    return a.id.localeCompare(b.id)
  })
  return itemLimit === null ? sorted : sorted.slice(0, itemLimit)
}

async function fetchNovel(novelId: string): Promise<NovelRow | null> {
  const rows = await db<NovelRow[]>`
    SELECT id, phase, seed_json, current_chapter, total_chapters, created_at
    FROM novels
    WHERE id = ${novelId}
  `
  return rows[0] ?? null
}

async function fetchLatestNovelWithOutlines(): Promise<NovelRow | null> {
  const rows = await db<NovelRow[]>`
    SELECT n.id, n.phase, n.seed_json, n.current_chapter, n.total_chapters, n.created_at
    FROM novels n
    WHERE EXISTS (
      SELECT 1 FROM chapter_outlines o WHERE o.novel_id = n.id
    )
    ORDER BY n.created_at DESC
    LIMIT 1
  `
  return rows[0] ?? null
}

async function fetchOutlines(novelId: string): Promise<OutlineRow[]> {
  return await db<OutlineRow[]>`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  `
}

async function fetchApprovedDrafts(
  novelId: string,
  outlines: readonly ChapterOutline[],
  maxProseChars: number,
): Promise<ApprovedDraftSnapshot[]> {
  const out: ApprovedDraftSnapshot[] = []
  for (const outline of outlines) {
    const draft = await getApprovedDraft(novelId, outline.chapterNumber)
    if (!draft) continue
    out.push({
      chapterN: outline.chapterNumber,
      version: draft.version,
      wordCount: draft.wordCount,
      prose: draft.prose.length > maxProseChars ? draft.prose.slice(0, maxProseChars) : draft.prose,
      truncated: draft.prose.length > maxProseChars,
    })
  }
  return out
}

function parseOutlines(rows: readonly OutlineRow[]): ChapterOutline[] {
  const out: ChapterOutline[] = []
  for (const row of rows) {
    const parsed = chapterOutlineSchema.safeParse(row.outline_json)
    if (!parsed.success) {
      throw new Error(`chapter_outlines ch${row.chapter_number} failed schema parse: ${parsed.error.message}`)
    }
    const outline = cloneOutline(parsed.data)
    enrichOutlineIds(outline)
    out.push(outline)
  }
  return out
}

async function fetchLlmUsage(runId: number | null): Promise<LlmUsageSummary> {
  if (!runId) return emptyUsage(null)
  const rows = await db<Array<{
    id: number
    prompt_tokens: number
    completion_tokens: number
    cached_tokens: number
    cost: number
    failed: boolean
  }>>`
    SELECT id, prompt_tokens, completion_tokens, cached_tokens, cost, failed
    FROM llm_calls
    WHERE run_id = ${runId}
      AND agent IN (${ROUTE_AGENT.flash}, ${ROUTE_AGENT.pro})
    ORDER BY id
  `
  const promptTokens = rows.reduce((sum, row) => sum + Number(row.prompt_tokens ?? 0), 0)
  const completionTokens = rows.reduce((sum, row) => sum + Number(row.completion_tokens ?? 0), 0)
  const cachedTokens = rows.reduce((sum, row) => sum + Number(row.cached_tokens ?? 0), 0)
  return {
    runId,
    llmCallIds: rows.map((row) => Number(row.id)),
    promptTokens,
    completionTokens,
    cachedTokens,
    cost: rows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0),
    cacheHitRatio: promptTokens === 0 ? 0 : cachedTokens / promptTokens,
    failedRows: rows.filter((row) => row.failed).length,
  }
}

function emptyUsage(runId: number | null): LlmUsageSummary {
  return {
    runId,
    llmCallIds: [],
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cost: 0,
    cacheHitRatio: 0,
    failedRows: 0,
  }
}

function buildHumanQueue(
  aggregate: PlannerSemanticPanelReport,
  deltaReport: PlannerCanonDeltaReport,
): HumanQueueItem[] {
  const textById = new Map(deltaReport.sourceItems.map((item) => [item.id, item.text]))
  const queue: HumanQueueItem[] = []
  for (const item of aggregate.items) {
    if (item.needsHuman) {
      queue.push({
        kind: "item",
        reason: "model_disagreement_or_human_review",
        itemId: item.itemId,
        chapterN: item.chapterN,
        text: textById.get(item.itemId),
      })
    }
  }
  for (const item of aggregate.missing) {
    if (item.needsHuman) {
      queue.push({
        kind: "missing",
        reason: "missing_candidate_lacks_cross_route_support",
        candidateKey: item.candidateKey,
        chapterN: item.chapterN,
        text: item.text,
      })
    }
  }

  const directWrite = aggregate.items
    .filter((item) => !item.needsHuman && item.consensusSafety === "direct_write")
    .sort((a, b) => a.itemId.localeCompare(b.itemId))
  const spotCheckCount = directWrite.length === 0 ? 0 : Math.min(directWrite.length, Math.max(2, Math.ceil(directWrite.length * 0.1)))
  for (const item of directWrite.slice(0, spotCheckCount)) {
    queue.push({
      kind: "item",
      reason: "spot_check_direct_write_agreement",
      itemId: item.itemId,
      chapterN: item.chapterN,
      text: textById.get(item.itemId),
    })
  }
  return queue
}

function compactObligations(obligations: ChapterOutline["scenes"][number]["obligations"]): Record<string, unknown[]> {
  return {
    mustEstablish: compactObligationItems(obligations?.mustEstablish ?? []),
    mustPayOff: compactObligationItems(obligations?.mustPayOff ?? []),
    mustTransferKnowledge: compactObligationItems(obligations?.mustTransferKnowledge ?? []),
    mustShowStateChange: compactObligationItems(obligations?.mustShowStateChange ?? []),
    mustNotReveal: compactObligationItems(obligations?.mustNotReveal ?? []),
  }
}

function compactObligationItems(items: readonly any[]): unknown[] {
  return items.map((item) => ({
    obligationId: item.obligationId,
    sourceId: item.sourceId,
    sourceKind: item.sourceKind,
    characterId: item.characterId,
    text: item.text,
  }))
}

function logMetadata(task: SemanticTask): Record<string, unknown> {
  return {
    audit: "planner-semantic-labeling",
    schemaVersion: PLANNER_SEMANTIC_LABEL_SCHEMA_VERSION,
    task: task.task,
    route: task.route,
    sampleIndex: task.sampleIndex,
    targetItemId: task.task === "item" ? task.item.id : undefined,
    targetItemKind: task.task === "item" ? task.item.kind : undefined,
  }
}

async function runLimited<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await run(items[index])
    }
  }
  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function compareCalls(a: PlannerSemanticPanelCall, b: PlannerSemanticPanelCall): number {
  if (a.chapterN !== b.chapterN) return a.chapterN - b.chapterN
  if (a.task !== b.task) return a.task.localeCompare(b.task)
  if (a.route !== b.route) return a.route.localeCompare(b.route)
  if (a.sampleIndex !== b.sampleIndex) return a.sampleIndex - b.sampleIndex
  const aId = a.task === "item" ? a.itemId : ""
  const bId = b.task === "item" ? b.itemId : ""
  return aId.localeCompare(bId)
}

function groupBy<T, K>(items: readonly T[], keyFn: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const group = out.get(key) ?? []
    group.push(item)
    out.set(key, group)
  }
  return out
}

function printHumanReport(novel: NovelRow, outPath: string, artifact: PanelArtifact): void {
  const summary = artifact.aggregate.summary
  console.log("=".repeat(76))
  console.log(`Step 2C live planner semantic labeling - ${novel.id}`)
  console.log("=".repeat(76))
  console.log(`artifact:                  ${outPath}`)
  console.log(`runId:                     ${artifact.runId ?? "none"}`)
  console.log(`calls ok/failed:           ${summary.okCallCount}/${summary.failedCallCount}`)
  console.log(`items:                     ${summary.itemCount}`)
  console.log(`direct/human/reject:       ${summary.directWriteCandidates}/${summary.humanReviewCandidates}/${summary.rejectCandidates}`)
  console.log(`needsHumanItems:           ${summary.needsHumanItems}`)
  console.log(`safetyAgreementRate:       ${summary.crossRouteSafetyAgreementRate.toFixed(3)}`)
  console.log(`verdictAgreementRate:      ${summary.crossRouteVerdictAgreementRate.toFixed(3)}`)
  console.log(`missing candidates:        ${summary.missingCandidateCount}`)
  console.log(`missing needs human:       ${summary.missingNeedsHumanCount}`)
  console.log(`human queue:               ${artifact.humanQueue.length}`)
  console.log(`tokens prompt/completion:  ${artifact.llmUsage.promptTokens}/${artifact.llmUsage.completionTokens}`)
  console.log(`cachedTokens/cacheRatio:   ${artifact.llmUsage.cachedTokens}/${artifact.llmUsage.cacheHitRatio.toFixed(3)}`)
  console.log(`cost:                      $${artifact.llmUsage.cost.toFixed(4)}`)
  console.log()
  console.log("HUMAN QUEUE")
  console.log("-".repeat(76))
  for (const item of artifact.humanQueue.slice(0, 25)) {
    const id = item.itemId ?? item.candidateKey ?? ""
    console.log(`  ch${item.chapterN} ${item.kind} ${item.reason} ${id} - ${item.text ?? ""}`)
  }
  if (artifact.humanQueue.length > 25) console.log(`  ... ${artifact.humanQueue.length - 25} more`)
}

function defaultOutPath(novelId: string): string {
  return resolve(join("docs", "artifacts", `planner-semantic-labeling-${novelId}-${fileTimestamp()}.json`))
}

function fileTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "").replace(/Z$/, "Z")
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

const DUPLICATE_STOP_WORDS = new Set(["a", "an", "the"])

function duplicateKey(kind: string, text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !DUPLICATE_STOP_WORDS.has(token))
    .join(" ")
  return `${kind}:${normalized}`
}

function cloneOutline(outline: ChapterOutline): ChapterOutline {
  return JSON.parse(JSON.stringify(outline)) as ChapterOutline
}

function valueArg(prefix: string): string | null {
  return process.argv
    .map((arg) => arg.startsWith(prefix) ? arg.slice(prefix.length) : undefined)
    .find((value): value is string => Boolean(value?.trim())) ?? null
}

function intArg(prefix: string, defaultValue: number): number {
  return optionalIntArg(prefix) ?? defaultValue
}

function optionalIntArg(prefix: string): number | null {
  const value = valueArg(prefix)
  if (value === null) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${prefix} requires a non-negative integer`)
  return parsed
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
