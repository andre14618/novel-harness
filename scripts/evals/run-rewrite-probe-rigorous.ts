#!/usr/bin/env bun

/**
 * run-rewrite-probe-rigorous.ts
 *
 * Rigorous follow-up to run-rewrite-probe-exploratory.ts. Same 20 beats,
 * same V1 source prose (rotation arm from conditioning-floor triplets),
 * same regex-based critique generation. The ONLY difference: arm (b) now
 * invokes buildRetryPrompt (the production retry-context builder,
 * src/agents/writer/retry-context.ts, extracted from drafting.ts), NOT
 * a hand-built simplified shape.
 *
 * Purpose: disambiguate the exploratory signal (rewrite lost to redraft
 * 12-6 on repetition). If the rigorous rerun also shows rewrite losing,
 * the capability gap is real and not a prompt-shape artifact.
 *
 * Cost: ~$0.10 writer + 0 Sonnet judge. Wall clock ~5 min.
 *
 * No circularity: critique still comes from regex detectors only, not
 * from an LLM. Sonnet is only the judge.
 *
 * Usage:
 *   bun scripts/evals/run-rewrite-probe-rigorous.ts
 */

import { createHash } from "node:crypto"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import db from "../../src/db/connection"
import { getChapterOutline } from "../../src/db/outlines"
import { getCharacters, getWorldBible } from "../../src/db/world"
import { getCharacterStatesAtChapter } from "../../src/db/character-states"
import { buildBeatContext } from "../../src/agents/writer/beat-context"
import { resolveReferences } from "../../src/agents/writer/reference-resolver"
import { resolveWriterPack } from "../../src/models/roles"
import { executeAndLog } from "../../src/llm"
import { getTokenCost } from "../../src/models/registry"
import { buildRetryPrompt } from "../../src/agents/writer/retry-context"
import { detectRepetition, detectUnderlength } from "../../src/lint/quality-detectors"
import type { LLMRequest } from "../../src/transport"

type Triplet = {
  pair_id: string
  pov_character: string
  characters_present: string[]
  beat_description: string
  rotation_prose: string
  words_rotation: number
}

function parseArgs() {
  const argv = process.argv.slice(2)
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  return {
    triplets: get("--triplets") ?? "output/evals/conditioning-floor-pilot-v1-triplets.json",
    out: get("--out") ?? "output/evals/rewrite-probe-rigorous-pairs.jsonl",
    sourceNovelId: get("--source") ?? "pp2-floor__prompt__fantasy-debt__1776710485411",
    pairsPath: get("--pairs") ?? "output/evals/conditioning-floor-pairs-v1.jsonl",
  }
}

function renderCritique(defects: Array<{ kind: string; description: string }>): string[] {
  if (defects.length === 0) {
    return ["Sharpen the distinction between each speaking character's voice in diction, cadence, and register."]
  }
  return defects.map(d => d.description)
}

async function main() {
  const args = parseArgs()
  console.log(`[probe-rigorous] loading triplets from ${args.triplets}`)
  const wrap = JSON.parse(await readFile(args.triplets, "utf8"))
  const triplets: Triplet[] = wrap.triplets ?? wrap

  const pairsRaw = await readFile(args.pairsPath, "utf8")
  const pairsByPairId = new Map<string, { chapter_number: number; beat_index_in_chapter: number; pov_character: string; characters_present: string[]; description: string }>()
  for (const line of pairsRaw.split("\n").filter(Boolean)) {
    const row = JSON.parse(line)
    const pairId = `${row.novel_id_source}-ch${row.chapter_number}-b${row.beat_index_in_chapter}`
    pairsByPairId.set(pairId, row)
  }

  const novelRow = await db<Array<{ seed_json: Record<string, unknown> }>>`SELECT seed_json FROM novels WHERE id = ${args.sourceNovelId}`
  const genre = (novelRow[0].seed_json as { genre?: string }).genre ?? "fantasy"
  const pack = resolveWriterPack(genre)!
  const systemPromptFile = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../src/agents/writer", pack.systemPromptFile)
  const systemPrompt = await readFile(systemPromptFile, "utf8")

  delete process.env.WRITER_CONDITIONING

  const pairs: Array<Record<string, unknown>> = []
  let totalCost = 0

  for (const t of triplets) {
    const meta = pairsByPairId.get(t.pair_id)
    if (!meta) { console.warn(`[skip] no meta for ${t.pair_id}`); continue }

    console.log(`\n[beat] ${t.pair_id.split("__").pop()} (ch${meta.chapter_number} b${meta.beat_index_in_chapter}) — V1=${t.words_rotation}w`)

    // Critique via regex detectors (no LLM → no circularity)
    const defects = [
      ...detectRepetition(t.rotation_prose),
      ...detectUnderlength(t.rotation_prose, 100),
    ]
    const issues = renderCritique(defects)
    console.log(`  defects: ${defects.length > 0 ? defects.map(d => d.kind).join(",") : "(none — generic)"}`)

    // Shared BeatContext
    const outline = await getChapterOutline(args.sourceNovelId, meta.chapter_number)
    const characters = await getCharacters(args.sourceNovelId)
    const characterStates = await getCharacterStatesAtChapter(args.sourceNovelId, meta.chapter_number)
    const worldBible = await getWorldBible(args.sourceNovelId)
    const beatSpec = outline.scenes[meta.beat_index_in_chapter]
    if (!beatSpec) continue
    const preResolvedRefs = await resolveReferences(beatSpec, outline, args.sourceNovelId, meta.chapter_number, characters)

    let previousBeatProse: string | undefined
    if (meta.beat_index_in_chapter > 0) {
      const priorRows = await db<Array<{ response_content: string }>>`
        SELECT response_content FROM llm_calls
        WHERE novel_id = ${args.sourceNovelId} AND agent='beat-writer'
          AND chapter=${meta.chapter_number} AND beat_index=${meta.beat_index_in_chapter - 1}
          AND failed IS NOT TRUE AND response_content IS NOT NULL
        ORDER BY id ASC LIMIT 1
      `
      if (priorRows.length > 0) {
        const sentences = priorRows[0].response_content.split(/(?<=[.!?])\s+/).filter(s => s.trim())
        previousBeatProse = sentences.slice(-3).join(" ")
      }
    }

    const beatCtx = await buildBeatContext({
      novelId: args.sourceNovelId,
      chapterNumber: meta.chapter_number,
      beatIndex: meta.beat_index_in_chapter,
      previousBeatProse,
      outline, characters, characterStates, worldBible,
      preResolvedRefs, compactMode: true, genre,
    })

    // Arm (a) — fresh redraft, no V1, no critique
    const requestA: LLMRequest = {
      systemPrompt,
      userPrompt: beatCtx.userPrompt,
      model: pack.model.model,
      provider: pack.model.provider,
      temperature: pack.model.temperature ?? 0.8,
      maxTokens: pack.model.maxTokens ?? 4000,
      responseFormat: { type: "text" },
      noRetries: true,
    }

    // Arm (b) — PRODUCTION retry shape via buildRetryPrompt
    const retry = buildRetryPrompt({
      beatContext: beatCtx,
      systemPrompt,
      v1Prose: t.rotation_prose,
      issues,
      attempt: 2,
      priorBeatProse: previousBeatProse,
    })
    const requestB: LLMRequest = {
      systemPrompt: retry.systemPrompt,
      userPrompt: retry.userPrompt,
      model: pack.model.model,
      provider: pack.model.provider,
      temperature: pack.model.temperature ?? 0.8,
      maxTokens: pack.model.maxTokens ?? 4000,
      responseFormat: { type: "text" },
      noRetries: true,
    }

    let armAProse = "", armBProse = "", errorA: string | undefined, errorB: string | undefined
    try {
      console.log("  [A] redraft…")
      const ra = await executeAndLog(requestA, undefined, "rewrite-probe-rigorous-redraft", { chapter: meta.chapter_number, beatIndex: meta.beat_index_in_chapter, attempt: 1 }, { meta: { probe: "rigorous-arm-a-redraft", pair_id: t.pair_id } })
      armAProse = ra.content
      totalCost += getTokenCost(pack.model.provider, pack.model.model, ra.usage.prompt_tokens, ra.usage.completion_tokens, ra.usage.cached_tokens)
    } catch (e) { errorA = e instanceof Error ? e.message : String(e); console.warn("  [A] FAIL") }

    try {
      console.log("  [B] rewrite (production retry shape)…")
      const rb = await executeAndLog(requestB, undefined, "rewrite-probe-rigorous-rewrite", { chapter: meta.chapter_number, beatIndex: meta.beat_index_in_chapter, attempt: 2 }, { meta: { probe: "rigorous-arm-b-rewrite", pair_id: t.pair_id, issues } })
      armBProse = rb.content
      totalCost += getTokenCost(pack.model.provider, pack.model.model, rb.usage.prompt_tokens, rb.usage.completion_tokens, rb.usage.cached_tokens)
    } catch (e) { errorB = e instanceof Error ? e.message : String(e); console.warn("  [B] FAIL") }

    // Seeded A/B shuffle
    const seed = "rewrite-probe-rigorous-v1"
    const digest = createHash("sha256").update(`${seed}:${t.pair_id}`).digest()
    const swap = digest.readUInt32BE(0) % 2 === 0
    const proseA = swap ? armBProse : armAProse
    const proseB = swap ? armAProse : armBProse
    const labelA = swap ? "rewrite" : "redraft"
    const labelB = swap ? "redraft" : "rewrite"
    const wA = armAProse.trim().split(/\s+/).filter(Boolean).length
    const wB = armBProse.trim().split(/\s+/).filter(Boolean).length

    pairs.push({
      pair_id: t.pair_id,
      pov_character: t.pov_character,
      characters_present: t.characters_present,
      beat_description: t.beat_description,
      v1_rotation_prose: t.rotation_prose,
      v1_rotation_words: t.words_rotation,
      issues_applied: issues,
      defects: defects.map(d => d.kind),
      arm_a_prose: proseA,
      arm_b_prose: proseB,
      arm_a_label: labelA,
      arm_b_label: labelB,
      words_redraft: wA,
      words_rewrite: wB,
      error_redraft: errorA,
      error_rewrite: errorB,
    })
    console.log(`  [OK] redraft=${wA}w rewrite=${wB}w (cost=$${totalCost.toFixed(5)})`)
  }

  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true })
  await writeFile(path.resolve(args.out), pairs.map(p => JSON.stringify(p)).join("\n") + "\n", "utf8")
  console.log(`\n[probe-rigorous] wrote ${pairs.length} pairs to ${args.out} (cost $${totalCost.toFixed(5)})`)
}

if (import.meta.main) {
  main().catch(e => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1) })
}
