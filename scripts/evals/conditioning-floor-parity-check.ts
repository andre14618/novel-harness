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

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import db from "../../src/db/connection"
import { getChapterOutline } from "../../src/db/outlines"
import { getCharacters, getWorldBible } from "../../src/db/world"
import { getCharacterStatesAtChapter } from "../../src/db/character-states"
import { buildBeatContext } from "../../src/agents/writer/beat-context"
import { resolveReferences } from "../../src/agents/writer/reference-resolver"
import { resolveWriterPack } from "../../src/models/roles"
import { buildWriterRequest, computePresetSelection } from "./run-conditioning-floor-replay"

type Arm = "raw" | "fixed" | "rotation"

type Args = {
  sourceNovelId: string
  chapter: number
  beatIndex: number
  arm: Arm
  experimentId: number | null
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
  const armStr = get("--arm") ?? "raw"
  const experimentIdStr = get("--experiment-id")
  if (!source || !chapterStr || !beatStr) {
    console.error("usage: bun scripts/evals/conditioning-floor-parity-check.ts --source <novel-id> --chapter <n> --beat-index <n> [--arm raw|fixed|rotation] [--experiment-id <n>]")
    process.exit(1)
  }
  if (armStr !== "raw" && armStr !== "fixed" && armStr !== "rotation") {
    console.error(`--arm must be one of raw|fixed|rotation, got "${armStr}"`)
    process.exit(1)
  }
  return {
    sourceNovelId: source,
    chapter: Number.parseInt(chapterStr, 10),
    beatIndex: Number.parseInt(beatStr, 10),
    arm: armStr,
    experimentId: experimentIdStr ? Number.parseInt(experimentIdStr, 10) : null,
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
  const row = rows[0]
  // request_json is stored as a JSON-encoded string; parse it so downstream
  // summarizeRequest() can read responseFormat (camelCase) mechanically.
  if (typeof row.request_json === "string") {
    try {
      row.request_json = JSON.parse(row.request_json as unknown as string) as Record<string, unknown>
    } catch {
      row.request_json = null
    }
  }
  return row
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
  // per derivePriorBeatCoords. Uses timestamp-anchored lookup so the replay
  // sees the same prior-beat prose the live drafter had in beatProses[bi-1]
  // at the target beat's FIRST attempt (matching the runner's
  // getBeatProseFromLLMCalls flow).
  let previousBeatProse: string | undefined
  if (args.beatIndex > 0) {
    const tsRows = await db<Array<{ timestamp: Date }>>`
      SELECT timestamp
      FROM llm_calls
      WHERE novel_id = ${args.sourceNovelId}
        AND agent = 'beat-writer'
        AND chapter = ${args.chapter}
        AND beat_index = ${args.beatIndex}
      ORDER BY timestamp ASC
      LIMIT 1
    `
    const anchor = tsRows.length > 0 ? new Date(tsRows[0].timestamp) : null
    let rows: Array<{ response_content: string }>
    if (anchor !== null) {
      rows = await db<Array<{ response_content: string }>>`
        SELECT response_content
        FROM llm_calls
        WHERE novel_id = ${args.sourceNovelId}
          AND agent = 'beat-writer'
          AND chapter = ${args.chapter}
          AND beat_index = ${args.beatIndex - 1}
          AND response_content IS NOT NULL
          AND failed IS NOT TRUE
          AND timestamp < ${anchor.toISOString()}
        ORDER BY timestamp DESC
        LIMIT 1
      `
    } else {
      rows = await db<Array<{ response_content: string }>>`
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
    }
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
  response_format: string
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
    response_format?: { type: string } | undefined
    request_json?: Record<string, unknown> | null
  },
): ComparableRequest {
  // Extract response_format mechanically. Live side: look at request_json
  // (transport serializes responseFormat into the request body). Replay side:
  // response_format is a direct field on the built request. Normalize both to
  // a string so the diff is mechanical. Added per Codex round-8 blocker #2.
  let responseFormat = "unspecified"
  if (src.response_format?.type) {
    responseFormat = src.response_format.type
  } else if (src.request_json && typeof src.request_json === "object") {
    // request_json uses camelCase `responseFormat` (from the LLMRequest
    // envelope). Check both camelCase (typical) and snake_case (in case a
    // future transport serializes differently) for robustness.
    const rj = src.request_json as {
      responseFormat?: { type?: string }
      response_format?: { type?: string }
    }
    const t = rj.responseFormat?.type ?? rj.response_format?.type
    if (t) responseFormat = t
  }

  return {
    model: src.model,
    provider: src.provider,
    // Round to 6 decimals to paper over Postgres real-column FP32 roundtrip.
    // Live-side is stored as 4-byte float so 0.8 reads back as 0.800000011920929.
    temperature: Math.round(src.temperature * 1_000_000) / 1_000_000,
    max_tokens: src.max_tokens,
    response_format: responseFormat,
    system_prompt: src.system_prompt,
    user_prompt: src.user_prompt,
  }
}

function diffFields(
  live: ComparableRequest,
  replay: ComparableRequest,
  arm: Arm,
  chapter: number,
  beatIndex: number,
): string[] {
  const diffs: string[] = []
  const simple: Array<"model" | "provider" | "temperature" | "max_tokens" | "response_format"> = [
    "model", "provider", "temperature", "max_tokens", "response_format",
  ]
  for (const f of simple) {
    if (live[f] !== replay[f]) {
      // Codex round-8 blocker #2 — response_format is now in the diff.
      // A live-side "unspecified" (not stored in request_json) vs
      // replay-side "text" is a real mismatch we want to see, not hide.
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

  // User-prompt comparison is structured-segment-aware after Codex round-7
  // blocker #3. For non-raw arms, the ONLY allowed delta is inside the
  // per-character "Example voiced lines:" blocks. Everywhere else (beat
  // spec, transition bridge, landing target, character profile fields other
  // than example lines, setting, background) must match live byte-for-byte.
  if (arm === "raw") {
    // Raw arm: strict byte-equality required.
    if (live.user_prompt !== replay.user_prompt) {
      diffs.push(buildUserPromptDiffEntry(live.user_prompt, replay.user_prompt, "user_prompt (raw arm — strict byte-equality required)"))
    }
  } else {
    // Non-raw: mask the example-lines blocks, then require strict byte-
    // equality on the masked strings. Additionally, each replay block must
    // be a valid subset of the corresponding live block (same entries, just
    // fewer of them — matches what pickExampleLineSubset does).
    const liveBlocks = extractExampleLineBlocks(live.user_prompt)
    const replayBlocks = extractExampleLineBlocks(replay.user_prompt)
    const liveMasked = maskExampleLineBlocks(live.user_prompt, liveBlocks)
    const replayMasked = maskExampleLineBlocks(replay.user_prompt, replayBlocks)

    if (liveMasked !== replayMasked) {
      diffs.push(buildUserPromptDiffEntry(
        liveMasked,
        replayMasked,
        `user_prompt (${arm} arm — non-exampleLines section drift; masked diff)`,
      ))
    }

    if (liveBlocks.length !== replayBlocks.length) {
      diffs.push(`  - user_prompt: example-line block COUNT mismatch (live=${liveBlocks.length}, replay=${replayBlocks.length}) — suggests a per-character rendering change outside the subset logic`)
    } else {
      // Each replay block must match the EXACT ordered preset subset
      // predicted by computePresetSelection for this (arm, chapter, beat,
      // live_block_length). Codex round-8 blocker #1: a simple "subset"
      // check accepted empty / duplicated / reordered blocks. We now derive
      // the expected indexes and assert element-wise equality in order.
      for (let i = 0; i < liveBlocks.length; i++) {
        const liveEntries = parseExampleLineEntries(liveBlocks[i].content)
        const replayEntries = parseExampleLineEntries(replayBlocks[i].content)
        const { preset_name, preset_indexes } = computePresetSelection(
          arm, chapter, beatIndex, liveEntries.length,
        )
        if (preset_indexes === null) {
          // Fall back to byte-equality if we can't compute a preset (e.g.,
          // <4-line characters — the runner returns slice unchanged).
          if (liveEntries.join("\n") !== replayEntries.join("\n")) {
            diffs.push(
              `  - user_prompt: block #${i + 1} (no preset computable, char has ${liveEntries.length} lines) — replay entries do not match live entries\n` +
              `      live:   ${JSON.stringify(liveEntries)}\n` +
              `      replay: ${JSON.stringify(replayEntries)}`,
            )
          }
          continue
        }
        const expected = preset_indexes
          .map(idx => liveEntries[idx])
          .filter((v): v is string => typeof v === "string")
        const matches =
          expected.length === replayEntries.length &&
          expected.every((e, k) => e === replayEntries[k])
        if (!matches) {
          diffs.push(
            `  - user_prompt: block #${i + 1} (${arm} arm) does NOT match the expected preset subset (${preset_name}, indexes ${JSON.stringify(preset_indexes)})\n` +
            `      expected: ${JSON.stringify(expected)}\n` +
            `      replay:   ${JSON.stringify(replayEntries)}\n` +
            `      live (all ${liveEntries.length}): ${JSON.stringify(liveEntries)}`,
          )
        }
      }
    }

    // Show the verified expected delta so humans can eyeball on pass.
    if (liveMasked === replayMasked && diffs.filter(d => d.includes("user_prompt")).length === 0) {
      console.log(`\n── EXPECTED delta: ${arm} arm exampleLines exactly match preset subset ──`)
      for (let i = 0; i < liveBlocks.length; i++) {
        const liveEntries = parseExampleLineEntries(liveBlocks[i].content)
        const replayEntries = parseExampleLineEntries(replayBlocks[i]?.content ?? "")
        const { preset_name } = computePresetSelection(arm, chapter, beatIndex, liveEntries.length)
        console.log(`  block #${i + 1}: live=${liveEntries.length} lines, replay=${replayEntries.length} lines (preset=${preset_name ?? "raw"})`)
      }
    }
  }
  return diffs
}

function buildUserPromptDiffEntry(a: string, b: string, label: string): string {
  const firstDiff = findFirstDivergence(a, b)
  return (
    `  - ${label}: differs (live=${a.length}ch, replay=${b.length}ch)\n` +
    `      first divergence at char ${firstDiff}:\n` +
    `        live:   ${JSON.stringify(a.slice(firstDiff, firstDiff + 160))}\n` +
    `        replay: ${JSON.stringify(b.slice(firstDiff, firstDiff + 160))}`
  )
}

function findFirstDivergence(a: string, b: string): number {
  const min = Math.min(a.length, b.length)
  for (let i = 0; i < min; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return i
  }
  return min
}

/**
 * Locate every "Example voiced lines:" block in a prompt. A block starts at
 * the marker line and includes all following indented numbered-entry lines
 * (`    N. "..."`) until a line that doesn't match that pattern. Returns
 * start/end offsets + content for each block.
 */
function extractExampleLineBlocks(prompt: string): Array<{ start: number; end: number; content: string }> {
  const marker = "Example voiced lines:"
  const entryRegex = /^\s{4,}\d+\.\s/
  const blocks: Array<{ start: number; end: number; content: string }> = []
  let searchFrom = 0
  while (true) {
    const markerIdx = prompt.indexOf(marker, searchFrom)
    if (markerIdx === -1) break
    // Find the line start containing the marker, so the block's start is at
    // the beginning of that line (usually "  Example voiced lines:").
    const lineStart = prompt.lastIndexOf("\n", markerIdx) + 1
    // Advance past the marker line.
    let cursor = prompt.indexOf("\n", markerIdx)
    if (cursor === -1) {
      // No newline after marker — block is just the marker line.
      blocks.push({ start: lineStart, end: prompt.length, content: prompt.slice(lineStart) })
      break
    }
    cursor += 1
    // Accumulate indented entry lines.
    while (cursor < prompt.length) {
      const nextNl = prompt.indexOf("\n", cursor)
      const lineEnd = nextNl === -1 ? prompt.length : nextNl
      const line = prompt.slice(cursor, lineEnd)
      if (!entryRegex.test(line)) break
      cursor = nextNl === -1 ? prompt.length : nextNl + 1
    }
    blocks.push({ start: lineStart, end: cursor, content: prompt.slice(lineStart, cursor) })
    searchFrom = cursor
  }
  return blocks
}

/**
 * Replace every exampleLines block with a fixed placeholder so we can
 * byte-compare the NON-exampleLines sections across arms. If the replay has
 * drifted anywhere outside the blocks, the masked strings will differ and
 * the parity check will fail — this is the tightening Codex round-7 wanted.
 */
function maskExampleLineBlocks(prompt: string, blocks: Array<{ start: number; end: number }>): string {
  if (blocks.length === 0) return prompt
  // Walk backwards so earlier splice operations don't invalidate later offsets.
  let result = prompt
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    result = result.slice(0, b.start) + "<EXAMPLE_LINES_BLOCK>\n" + result.slice(b.end)
  }
  return result
}

/**
 * Parse a block's entry lines into a canonical string list (unquoted,
 * unnumbered) so two blocks can be compared as sets regardless of numbering
 * or surrounding whitespace.
 */
function parseExampleLineEntries(blockContent: string): string[] {
  const entries: string[] = []
  for (const line of blockContent.split("\n")) {
    const match = line.match(/^\s{4,}\d+\.\s+"(.*)"\s*$/)
    if (match) entries.push(match[1])
  }
  return entries
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
  console.log(`[parity] Target beat:   ch=${args.chapter} beat_index=${args.beatIndex}`)
  console.log(`[parity] Arm:           ${args.arm}\n`)

  // Toggle WRITER_CONDITIONING based on requested arm. raw = unset. Save and
  // restore the original value around the replay build.
  const originalConditioning = process.env.WRITER_CONDITIONING
  try {
    if (args.arm === "raw") {
      delete process.env.WRITER_CONDITIONING
    } else {
      process.env.WRITER_CONDITIONING = args.arm
    }

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
    const diffs = diffFields(liveSummary, replaySummary, args.arm, args.chapter, args.beatIndex)

  console.log("── Live vs replay (compared fields) ────────────")
  console.log(`  model:       ${liveSummary.model}`)
  console.log(`  provider:    ${liveSummary.provider}`)
  console.log(`  temperature: ${liveSummary.temperature}`)
  console.log(`  max_tokens:  ${liveSummary.max_tokens}`)
  console.log(`  system_prompt: live=${liveSummary.system_prompt.length}ch replay=${replaySummary.system_prompt.length}ch`)
  console.log(`  user_prompt:   live=${liveSummary.user_prompt.length}ch replay=${replaySummary.user_prompt.length}ch`)
  console.log("")
  // response_format is now part of the mechanical diff above (read from
  // request_json.responseFormat camelCase). Prior versions relied on code
  // inspection because the harness didn't parse request_json — that gap is
  // closed per Codex round-8 blocker #2.


    const passed = diffs.length === 0
    if (passed) {
      console.log(`✓ PARITY OK — ${args.arm} arm matches live request surface for the compared fields.`)
    } else {
      console.log("✗ PARITY BROKEN — the following fields differ between live and replay:")
      for (const d of diffs) console.log(d)
      console.log(`\n${diffs.length} field(s) differ. Fix the replay path before running the pilot.`)
    }

    // Persist durable pass/fail record per Codex telemetry audit #5.
    // When --experiment-id is supplied, write one eval_results row per
    // invocation so a later audit can SQL-prove "parity ran and passed on
    // this commit / arm / beat" rather than relying on stdout screenshots.
    if (args.experimentId !== null) {
      try {
        const commitHash = (await $`git rev-parse HEAD`.text()).trim()
        const livePromptHash = createHash("sha256").update(live.system_prompt + "\n" + live.user_prompt).digest("hex")
        const replayPromptHash = createHash("sha256").update(replay.system_prompt + "\n" + replay.user_prompt).digest("hex")
        await db`
          INSERT INTO eval_results (
            experiment_id, set_name, beat_id, adapter_uri, cell_label,
            correct, error_text, actual_label_json
          ) VALUES (
            ${args.experimentId},
            ${`conditioning-floor-parity-${args.arm}`},
            ${`${args.sourceNovelId}-ch${args.chapter}-b${args.beatIndex}`},
            ${live.model},
            ${passed ? "parity-pass" : "parity-fail"},
            ${passed},
            ${passed ? null : diffs.join("\n")},
            ${{
              commit_hash: commitHash,
              arm: args.arm,
              source_novel_id: args.sourceNovelId,
              chapter: args.chapter,
              beat_index: args.beatIndex,
              live_prompt_sha256: livePromptHash,
              replay_prompt_sha256: replayPromptHash,
              live_user_prompt_length: live.user_prompt.length,
              replay_user_prompt_length: replay.user_prompt.length,
              verified_at: new Date().toISOString(),
            }}
          )
        `
        console.log(`[telemetry] parity record persisted to eval_results (experiment_id=${args.experimentId}, set_name=conditioning-floor-parity-${args.arm})`)
      } catch (err) {
        console.warn(`[telemetry] parity persistence failed: ${err instanceof Error ? err.message : err}`)
      }
    }

    process.exit(passed ? 0 : 1)
  } finally {
    // Restore original WRITER_CONDITIONING
    if (originalConditioning === undefined) {
      delete process.env.WRITER_CONDITIONING
    } else {
      process.env.WRITER_CONDITIONING = originalConditioning
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
