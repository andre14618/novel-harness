#!/usr/bin/env bun

/**
 * conditioning-floor-parity-check.ts
 *
 * Prompt-parity harness for the conditioning-floor slim-live-v1-replay
 * charter. Given a real drafted beat, reconstruct what the replay runner
 * would produce for that same beat (with WRITER_CONDITIONING=fixed), and
 * byte-diff the two writer requests.
 *
 * Empty diff => the replay runner's writer-call surface matches the live
 * drafting path. Non-empty diff => the replay is not measuring what the
 * production writer actually saw, and the charter claim breaks.
 *
 * Codex round-5 counterfactual: this harness is the cheapest way to catch
 * surface mismatches (responseFormat, preResolvedRefs, character ordering,
 * etc.) before any judge spend.
 *
 * Usage:
 *   bun scripts/evals/conditioning-floor-parity-check.ts \
 *     --source <novel-id> \
 *     --chapter <n> \
 *     --beat-index <n>
 *
 * Exit code 0 = parity. Exit code 1 = diff present or target-beat not found.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import db from "../../src/db/connection"
import { getChapterOutline } from "../../src/db/outlines"
import { getCharacters, getWorldBible } from "../../src/db/world"
import { getCharacterStatesAtChapter } from "../../src/db/character-states"
import { buildBeatContext } from "../../src/agents/writer/beat-context"
import { resolveReferences } from "../../src/agents/writer/reference-resolver"
import { resolveWriterPack } from "../../src/models/roles"
import { buildWriterRequest } from "./run-conditioning-floor-replay"

type Args = {
  sourceNovelId: string
  chapter: number
  beatIndex: number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  const source = get("--source")
  const chapterStr = get("--chapter")
  const beatStr = get("--beat-index")
  if (!source || !chapterStr || !beatStr) {
    console.error("usage: bun scripts/evals/conditioning-floor-parity-check.ts --source <novel-id> --chapter <n> --beat-index <n>")
    process.exit(1)
  }
  return {
    sourceNovelId: source,
    chapter: Number.parseInt(chapterStr, 10),
    beatIndex: Number.parseInt(beatStr, 10),
  }
}

/**
 * Fetch the live drafting request for a specific beat. Returns the first
 * (earliest by id) non-failed beat-writer call — matches what the original
 * drafter emitted before any downstream rewrites.
 */
async function fetchLiveRequest(args: Args): Promise<{
  system_prompt: string
  user_prompt: string
  model: string
  provider: string
  temperature: number
  max_tokens: number
  request_json: Record<string, unknown> | null
} | null> {
  const rows = await db<Array<{
    system_prompt: string
    user_prompt: string
    model: string
    provider: string
    temperature: number
    max_tokens: number
    request_json: Record<string, unknown> | null
  }>>`
    SELECT system_prompt, user_prompt, model, provider, temperature, max_tokens, request_json
    FROM llm_calls
    WHERE novel_id = ${args.sourceNovelId}
      AND agent = 'beat-writer'
      AND chapter = ${args.chapter}
      AND beat_index = ${args.beatIndex}
      AND failed IS NOT TRUE
    ORDER BY id ASC
    LIMIT 1
  `
  if (rows.length === 0) return null
  return rows[0]
}

/**
 * Reconstruct the replay runner's writer request for the same beat. Uses
 * the runner's own buildWriterRequest + buildBeatContext + resolveReferences
 * so any drift between the two paths surfaces as a diff.
 */
async function buildReplayRequest(args: Args): Promise<{
  system_prompt: string
  user_prompt: string
  model: string
  provider: string
  temperature: number
  max_tokens: number
  response_format: { type: string } | undefined
} | null> {
  // Guardrail stays OFF — we want to invoke the context-build path but NOT
  // actually call the writer. No env-var override is set in this harness.
  const novelRows = await db<Array<{ seed_json: Record<string, unknown> }>>`
    SELECT seed_json FROM novels WHERE id = ${args.sourceNovelId}
  `
  if (novelRows.length === 0) {
    console.error(`novel ${args.sourceNovelId} not found`)
    return null
  }
  const genre = (novelRows[0].seed_json as { genre?: string }).genre
  if (!genre) {
    console.error(`novel ${args.sourceNovelId} has no genre in seed_json`)
    return null
  }

  const pack = resolveWriterPack(genre)
  if (!pack) {
    console.error(`no writer pack resolved for genre "${genre}"`)
    return null
  }

  // Replay the exact context-build path (match SharedBeatInputs).
  const outline = await getChapterOutline(args.sourceNovelId, args.chapter)
  const characters = await getCharacters(args.sourceNovelId)
  const characterStates = await getCharacterStatesAtChapter(args.sourceNovelId, args.chapter)
  const worldBible = await getWorldBible(args.sourceNovelId)
  const beatSpec = outline.scenes[args.beatIndex]
  if (!beatSpec) {
    console.error(`beat ${args.beatIndex} out of range for chapter ${args.chapter}`)
    return null
  }

  // Reconstruct the bridge the same way the replay runner does so the
  // user_prompt parity check actually matches end-to-end. Only chapter > 1
  // beats or beat_index > 0 have a bridge; chapter-opener beats pass null
  // per derivePriorBeatCoords.
  let previousBeatProse: string | undefined
  if (args.beatIndex > 0) {
    const rows = await db<Array<{ response_content: string }>>`
      SELECT response_content
      FROM llm_calls
      WHERE novel_id = ${args.sourceNovelId}
        AND agent = 'beat-writer'
        AND chapter = ${args.chapter}
        AND beat_index = ${args.beatIndex - 1}
        AND response_content IS NOT NULL
        AND failed IS NOT TRUE
      ORDER BY id ASC
      LIMIT 1
    `
    if (rows.length > 0) {
      const raw = rows[0].response_content
      const sentences = raw.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
      previousBeatProse = sentences.slice(-3).join(" ")
    }
  }

  const preResolvedRefs = await resolveReferences(beatSpec, outline, args.sourceNovelId, args.chapter, characters)

  const beatCtx = await buildBeatContext({
    novelId: args.sourceNovelId,
    chapterNumber: args.chapter,
    beatIndex: args.beatIndex,
    previousBeatProse,
    outline,
    characters,
    characterStates,
    worldBible,
    preResolvedRefs,
    compactMode: true,
    genre,
  })

  // Resolve the writer system prompt from the pack, same as the runner does.
  const systemPromptPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../src/agents/writer",
    pack.systemPromptFile,
  )
  const systemPrompt = await readFile(systemPromptPath, "utf8")

  const request = buildWriterRequest(systemPrompt, beatCtx.userPrompt, pack)
  return {
    system_prompt: request.systemPrompt ?? "",
    user_prompt: request.userPrompt,
    model: request.model,
    provider: request.provider ?? "",
    temperature: request.temperature ?? 0,
    max_tokens: request.maxTokens ?? 0,
    response_format: request.responseFormat,
  }
}

type ComparableRequest = {
  model: string
  provider: string
  temperature: number
  max_tokens: number
  system_prompt: string
  user_prompt: string
}

function summarizeRequest(
  src: {
    system_prompt: string
    user_prompt: string
    model: string
    provider: string
    temperature: number
    max_tokens: number
  },
): ComparableRequest {
  return {
    model: src.model,
    provider: src.provider,
    // Round to 6 decimals to paper over Postgres real-column FP32 roundtrip.
    // Live-side is stored as 4-byte float so 0.8 reads back as 0.800000011920929.
    temperature: Math.round(src.temperature * 1_000_000) / 1_000_000,
    max_tokens: src.max_tokens,
    system_prompt: src.system_prompt,
    user_prompt: src.user_prompt,
  }
}

function diffFields(live: ComparableRequest, replay: ComparableRequest): string[] {
  const diffs: string[] = []
  const simple: Array<"model" | "provider" | "temperature" | "max_tokens"> = [
    "model", "provider", "temperature", "max_tokens",
  ]
  for (const f of simple) {
    if (live[f] !== replay[f]) {
      diffs.push(`  - ${f}:\n      live:   ${JSON.stringify(live[f])}\n      replay: ${JSON.stringify(replay[f])}`)
    }
  }
  if (live.system_prompt !== replay.system_prompt) {
    diffs.push(
      `  - system_prompt: differs (live=${live.system_prompt.length}ch, replay=${replay.system_prompt.length}ch)\n` +
      `      live head:   ${JSON.stringify(live.system_prompt.slice(0, 120))}\n` +
      `      replay head: ${JSON.stringify(replay.system_prompt.slice(0, 120))}`,
    )
  }
  if (live.user_prompt !== replay.user_prompt) {
    const firstDiff = findFirstDivergence(live.user_prompt, replay.user_prompt)
    const liveTail = live.user_prompt.slice(-300)
    const replayTail = replay.user_prompt.slice(-300)
    diffs.push(
      `  - user_prompt: differs (live=${live.user_prompt.length}ch, replay=${replay.user_prompt.length}ch)\n` +
      `      first divergence at char ${firstDiff}:\n` +
      `        live:   ${JSON.stringify(live.user_prompt.slice(firstDiff, firstDiff + 160))}\n` +
      `        replay: ${JSON.stringify(replay.user_prompt.slice(firstDiff, firstDiff + 160))}\n` +
      `      trailing 300ch:\n` +
      `        live:   ${JSON.stringify(liveTail)}\n` +
      `        replay: ${JSON.stringify(replayTail)}`,
    )
  }
  return diffs
}

function findFirstDivergence(a: string, b: string): number {
  const min = Math.min(a.length, b.length)
  for (let i = 0; i < min; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return i
  }
  return min
}

async function main(): Promise<void> {
  const args = parseArgs()

  console.log(`[parity] Source novel:  ${args.sourceNovelId}`)
  console.log(`[parity] Target beat:   ch=${args.chapter} beat_index=${args.beatIndex}\n`)

  const live = await fetchLiveRequest(args)
  if (!live) {
    console.error(`error: no live beat-writer call found for ${args.sourceNovelId} ch=${args.chapter} beat_index=${args.beatIndex}`)
    process.exit(1)
  }

  const replay = await buildReplayRequest(args)
  if (!replay) {
    console.error("error: replay request could not be built")
    process.exit(1)
  }

  const liveSummary = summarizeRequest(live)
  const replaySummary = summarizeRequest(replay)
  const diffs = diffFields(liveSummary, replaySummary)

  console.log("── Live vs replay (compared fields) ────────────")
  console.log(`  model:       ${liveSummary.model}`)
  console.log(`  provider:    ${liveSummary.provider}`)
  console.log(`  temperature: ${liveSummary.temperature}`)
  console.log(`  max_tokens:  ${liveSummary.max_tokens}`)
  console.log(`  system_prompt: live=${liveSummary.system_prompt.length}ch replay=${replaySummary.system_prompt.length}ch`)
  console.log(`  user_prompt:   live=${liveSummary.user_prompt.length}ch replay=${replaySummary.user_prompt.length}ch`)
  console.log("")
  console.log("── Note on response_format ─────────────────────")
  console.log("  response_format is NOT stored in llm_calls.request_json so it cannot")
  console.log("  be verified DB-side. Match verified by code inspection:")
  console.log("    - live:   src/phases/drafting.ts:296/575/887 — responseFormat: { type: \"text\" }")
  console.log("    - replay: scripts/evals/run-conditioning-floor-replay.ts buildWriterRequest — responseFormat: { type: \"text\" }")
  console.log("")

  if (diffs.length === 0) {
    console.log("✓ PARITY OK — live vs replay request surface is byte-equivalent for the compared fields.")
    process.exit(0)
  } else {
    console.log("✗ PARITY BROKEN — the following fields differ between live and replay:")
    for (const d of diffs) console.log(d)
    console.log(`\n${diffs.length} field(s) differ. Fix the replay path before running the pilot.`)
    process.exit(1)
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
