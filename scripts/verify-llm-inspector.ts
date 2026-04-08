/**
 * One-shot verification for the LLM Call Inspector always-log path.
 *
 * Drives:
 *   1. A real successful callAgent against a cheap model with a fake novelId
 *      → expects exactly one llm_calls row with failed=false, prompts populated,
 *        request_json populated.
 *   2. A real failure (invalid model id) against the same cheap provider
 *      → expects exactly one llm_calls row with failed=true, error_text populated,
 *        request_json populated.
 *
 * Reads both rows back and prints which inspector fields are populated so we
 * can confirm the always-log guarantee end-to-end without running a full novel.
 *
 * Run on LXC: ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/verify-llm-inspector.ts"
 */

import { z } from "zod"
import { callAgent } from "../src/llm"
import db from "../data/connection"
import { initNovelRun } from "../src/logger"
import { createNovel } from "../src/db"

const NOVEL_ID = `verify-${Date.now()}`

async function main() {
  console.log(`\nVerification novel id: ${NOVEL_ID}\n`)

  // Need a real run row so logLLMCallStructured has a run_id to attach to.
  await createNovel(NOVEL_ID, {
    premise: "verification",
    genre: "test",
    chapterCount: 1,
    characters: [],
  } as any)
  const runId = await initNovelRun(NOVEL_ID)
  console.log(`run_id: ${runId}`)

  // ── 1. Success path ────────────────────────────────────────────────────
  console.log("\n[1/2] Driving successful call (groq/llama-3.1-8b-instant)…")
  let successId: number | null = null
  try {
    await callAgent({
      novelId: NOVEL_ID,
      agentName: "verify-success",
      chapter: 99,
      beatIndex: 7,
      attempt: 1,
      provider: "groq",
      model: "llama-3.1-8b-instant",
      temperature: 0.1,
      maxTokens: 50,
      systemPrompt: "Reply with valid JSON: {\"ok\": true}",
      userPrompt: "ping",
      schema: z.object({ ok: z.boolean() }),
    })
    console.log("  ✓ call returned")
  } catch (err) {
    console.log(`  ✗ unexpected error: ${err instanceof Error ? err.message : err}`)
  }

  // ── 2. Failure path ────────────────────────────────────────────────────
  console.log("\n[2/2] Driving failure call (groq/nonexistent-model-xyz)…")
  try {
    await callAgent({
      novelId: NOVEL_ID,
      agentName: "verify-failure",
      chapter: 99,
      beatIndex: 8,
      attempt: 1,
      provider: "groq",
      model: "nonexistent-model-xyz-zzz",
      temperature: 0.1,
      maxTokens: 50,
      systemPrompt: "Reply with valid JSON: {\"ok\": true}",
      userPrompt: "ping",
      schema: z.object({ ok: z.boolean() }),
    })
    console.log("  ✗ unexpected success — failure path did not trigger")
  } catch (err) {
    console.log(`  ✓ threw as expected: ${err instanceof Error ? err.message.slice(0, 80) : err}`)
  }

  // ── Read both rows back ───────────────────────────────────────────────
  console.log("\nReading rows for novel_id =", NOVEL_ID, "…\n")
  const rows = await db`
    SELECT id, agent, novel_id, chapter, beat_index, attempt, failed,
           system_prompt IS NOT NULL as has_sys,
           user_prompt   IS NOT NULL as has_user,
           response_content IS NOT NULL as has_resp,
           request_json  IS NOT NULL as has_req,
           error_text    IS NOT NULL as has_err,
           LENGTH(error_text) as err_len,
           prompt_tokens, completion_tokens, latency_ms
      FROM llm_calls WHERE novel_id = ${NOVEL_ID} ORDER BY id`

  if (rows.length === 0) {
    console.log("✗ NO ROWS WRITTEN. Logging is broken.")
    process.exit(1)
  }

  for (const r of rows) {
    console.log(`row id=${r.id} agent=${r.agent}`)
    console.log(`  novel=${r.novel_id} ch=${r.chapter} beat=${r.beat_index} attempt=${r.attempt}`)
    console.log(`  failed=${r.failed} sys=${r.has_sys} user=${r.has_user} resp=${r.has_resp} req=${r.has_req} err=${r.has_err}${r.err_len ? ` (err_len=${r.err_len})` : ""}`)
    console.log(`  tokens: ${r.prompt_tokens}+${r.completion_tokens}, latency=${r.latency_ms}ms`)
    console.log("")
  }

  // ── Sanity gate ───────────────────────────────────────────────────────
  const success = rows.find(r => r.agent === "verify-success")
  const failure = rows.find(r => r.agent === "verify-failure")

  const checks: { name: string; ok: boolean }[] = [
    { name: "success row exists", ok: !!success },
    { name: "success row has failed=false", ok: success?.failed === false },
    { name: "success row has system_prompt", ok: !!success?.has_sys },
    { name: "success row has user_prompt", ok: !!success?.has_user },
    { name: "success row has response_content", ok: !!success?.has_resp },
    { name: "success row has request_json", ok: !!success?.has_req },
    { name: "success row has chapter=99", ok: success?.chapter === 99 },
    { name: "success row has beat_index=7", ok: success?.beat_index === 7 },
    { name: "failure row exists", ok: !!failure },
    { name: "failure row has failed=true", ok: failure?.failed === true },
    { name: "failure row has error_text", ok: !!failure?.has_err },
    { name: "failure row has request_json", ok: !!failure?.has_req },
    { name: "failure row has chapter=99", ok: failure?.chapter === 99 },
    { name: "failure row has beat_index=8", ok: failure?.beat_index === 8 },
  ]

  console.log("─── checks ───")
  let allOk = true
  for (const c of checks) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}`)
    if (!c.ok) allOk = false
  }

  // Cleanup — delete in FK-safe order. Skip with --keep to leave rows for
  // API/UI testing.
  if (!process.argv.includes("--keep")) {
    await db`DELETE FROM llm_calls WHERE novel_id = ${NOVEL_ID}`
    await db`DELETE FROM run_agents WHERE run_id = ${runId}`
    await db`DELETE FROM runs WHERE id = ${runId}`
    await db`DELETE FROM novels WHERE id = ${NOVEL_ID}`
    console.log("\nCleaned up test rows.")
  } else {
    console.log(`\nKept rows. novel_id=${NOVEL_ID} run_id=${runId}`)
    console.log(`Cleanup with: DELETE FROM llm_calls WHERE novel_id='${NOVEL_ID}'; DELETE FROM run_agents WHERE run_id=${runId}; DELETE FROM runs WHERE id=${runId}; DELETE FROM novels WHERE id='${NOVEL_ID}';`)
  }

  process.exit(allOk ? 0 : 1)
}

main().catch(err => {
  console.error("verification script crashed:", err)
  process.exit(1)
})
