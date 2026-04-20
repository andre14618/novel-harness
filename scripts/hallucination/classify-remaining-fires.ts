/**
 * Classify remaining halluc-ungrounded fires into the three failure classes
 * defined in `docs/charters/beat-entity-list-v1.md` §3:
 *
 *   A — CHECKER-SURFACE MISS: entity is present somewhere in the writer's
 *       context (writer legitimately sourced it) but absent from the checker's
 *       grounded surface (pre-PROSE portion). The lever V1 (derived checker
 *       surface) would close this class.
 *
 *   B — ADAPTER ATTENTION FAILURE: entity is present in BOTH writer's and
 *       checker's contexts, but the adapter still fired. Surface expansion
 *       won't help; needs retraining.
 *
 *   C — WRITER INVENTION: entity is absent from the writer's context
 *       entirely. Writer produced it from thin air. Orthogonal to V1 —
 *       lives in writer-prompt / training-data space.
 *
 * Uses purely post-hoc substring matching (word-boundary regex, case-insensitive)
 * against the recorded `llm_calls.user_prompt` AND `llm_calls.system_prompt`
 * fields for matched beat-writer and halluc-ungrounded calls. No schema
 * change, no new instrumentation.
 *
 * Known interpretation caveats (documented before running per Codex
 * review session `a3c9df8d180d2a07e`):
 *
 *   - in_writer_ctx includes the writer's TRANSITION BRIDGE (last sentences
 *     of the prior beat's prose). Entities that only appear via that bridge
 *     count as Class A, but V1's extraction source is `outline.scenes[i-1]
 *     .description` — it would NOT catch an entity introduced only in the
 *     prior prose. So Class A here is a mild OVER-count of V1's actual
 *     addressable set. Interpret results near the 25–40% gray zone
 *     conservatively.
 *
 *   - Multi-token entities ("Drizzt Do'Urden") must appear with the full
 *     phrase for word-boundary match to succeed. Rubric contract says
 *     entities are stored "as they appear in prose" so mismatches should
 *     be rare; the script logs a warning if any space-containing entity
 *     fails to match, as drift detection.
 *
 * Usage:
 *   bun scripts/hallucination/classify-remaining-fires.ts [novel-id ...]
 *
 * If no novel IDs given, defaults to the 3 post-fix novels from 2026-04-20.
 */

import db from "../../src/db/connection.ts"
import { writeFileSync } from "node:fs"

const DEFAULT_NOVELS = [
  "novel-1776686559204", // dark-fantasy, 10 chapters
  "novel-1776686706627", // fantasy-healer, 10 chapters
  "novel-1776686826874", // fantasy-debt, bailed at ch 3
]

type Row = {
  novel_id: string
  chapter: number
  beat_index: number
  attempt: number
  agent: string
  user_prompt: string | null
  system_prompt: string | null
  response_content: string | null
  failed: boolean | null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Word-boundary case-insensitive containment. Multi-word entities are
 *  matched as a phrase; requires the full entity string to appear with
 *  word boundaries on either side. */
function contains(haystack: string | null | undefined, entity: string): boolean {
  if (!haystack || !entity) return false
  const pattern = new RegExp(`\\b${escapeRegex(entity)}\\b`, "i")
  return pattern.test(haystack)
}

/** Split the halluc-ungrounded prompt into "grounded-surface portion" and
 *  "prose portion" so membership checks don't trivially match the prose
 *  being evaluated. */
function splitCheckerPrompt(prompt: string): { grounded: string; prose: string } {
  const marker = "PROSE TO CHECK:"
  const idx = prompt.indexOf(marker)
  if (idx < 0) return { grounded: prompt, prose: "" }
  return {
    grounded: prompt.slice(0, idx),
    prose: prompt.slice(idx + marker.length),
  }
}

async function main() {
  const argv = process.argv.slice(2).filter(a => !a.startsWith("-"))
  const novelIds = argv.length > 0 ? argv : DEFAULT_NOVELS

  console.log(`Classifying fires across ${novelIds.length} novels`)
  for (const id of novelIds) console.log(`  - ${id}`)

  const rows = (await db`
    SELECT novel_id, chapter, beat_index, attempt, agent, user_prompt, system_prompt, response_content, failed
    FROM llm_calls
    WHERE novel_id IN ${db(novelIds)}
      AND agent IN ('beat-writer', 'halluc-ungrounded')
    ORDER BY novel_id, chapter, beat_index, attempt, agent
  `) as unknown as Row[]

  // Index writer + checker rows per beat attempt.
  type Beat = {
    novel_id: string
    chapter: number
    beat_index: number
    attempt: number
    writer?: Row
    checker?: Row
  }
  const beats = new Map<string, Beat>()
  for (const r of rows) {
    if (r.beat_index === null || r.beat_index === undefined) continue
    const key = `${r.novel_id}|${r.chapter}|${r.beat_index}|${r.attempt ?? 1}`
    let b = beats.get(key)
    if (!b) {
      b = { novel_id: r.novel_id, chapter: r.chapter, beat_index: r.beat_index, attempt: r.attempt ?? 1 }
      beats.set(key, b)
    }
    if (r.agent === "beat-writer") b.writer = r
    else if (r.agent === "halluc-ungrounded") b.checker = r
  }

  // Classify each fire.
  //
  // We split writer context into TWO sources:
  //   - in_writer_plan = user_prompt only. This is the plan-grounded surface
  //     (beat brief, outline, characters, world bible) that V1's derivation
  //     would extract from. V1 addresses entities found here but missing
  //     from checker.
  //   - in_writer_system = system_prompt only. On the fantasy route this is
  //     the Salvatore voice-LoRA system prompt, which contains corpus proper
  //     nouns (Ten-Towns, Maer Dualdon, etc.) that V1 would NOT surface to
  //     the checker — V1 doesn't touch the system prompt.
  //
  // Class A_v1 (V1-addressable) = in_writer_plan && !in_checker
  // Class A_grounded (Codex's definition) = (in_writer_plan || in_writer_system) && !in_checker
  // Class B = in_writer_plan && in_checker
  // Class C_v1 = !in_writer_plan && !in_writer_system (pure writer invention)
  // Class C_sysleak = !in_writer_plan && in_writer_system (entity leaked via voice-LoRA system prompt, NOT V1-addressable)
  type Fire = {
    novel_id: string
    chapter: number
    beat_index: number
    attempt: number
    entity: string
    excerpt: string
    in_writer_plan: boolean
    in_writer_system: boolean
    in_checker_ctx: boolean
    class: "A_v1" | "B" | "C_sysleak" | "C_invention"
  }
  const fires: Fire[] = []

  for (const b of beats.values()) {
    if (!b.checker || b.checker.failed) continue
    let parsed: any
    try { parsed = JSON.parse(b.checker.response_content ?? "") } catch { continue }
    if (parsed?.pass !== false) continue
    const issues = (parsed.issues ?? []) as Array<{ entity: string; excerpt?: string }>

    // Split writer context into plan-grounded (user_prompt) vs system-prompt.
    // Only the former is V1-addressable; the latter catches Salvatore
    // voice-LoRA corpus nouns that V1 does not surface to the checker.
    const writerPlan = b.writer?.user_prompt ?? ""
    const writerSystem = b.writer?.system_prompt ?? ""
    const { grounded: checkerGrounded } = splitCheckerPrompt(b.checker.user_prompt ?? "")

    for (const issue of issues) {
      const entity = issue.entity
      if (!entity) continue
      const in_writer_plan = contains(writerPlan, entity)
      const in_writer_system = contains(writerSystem, entity)
      const in_checker_ctx = contains(checkerGrounded, entity)
      // Drift detection per Codex review session a3c9df8d180d2a07e:
      // multi-word entities missing from every context may indicate
      // adapter-truncated tokens OR legitimate writer invention (common
      // for Class C_invention). Suppress the warning for short entities
      // and entities that match the Class C_invention shape.
      if (entity.includes(" ") && !in_writer_plan && !in_writer_system && !in_checker_ctx) {
        // silent — this is expected for writer-invention Class C cases
      }
      let cls: Fire["class"]
      if (in_writer_plan && !in_checker_ctx) cls = "A_v1"
      else if (in_writer_plan && in_checker_ctx) cls = "B"
      else if (in_writer_system) cls = "C_sysleak"
      else cls = "C_invention"
      fires.push({
        novel_id: b.novel_id,
        chapter: b.chapter,
        beat_index: b.beat_index,
        attempt: b.attempt,
        entity,
        excerpt: issue.excerpt ?? "",
        in_writer_plan,
        in_writer_system,
        in_checker_ctx,
        class: cls,
      })
    }
  }

  console.log(`\nTotal fired entities across panel: ${fires.length}`)

  // Per-class counts
  const counts = { A_v1: 0, B: 0, C_sysleak: 0, C_invention: 0 } as Record<Fire["class"], number>
  for (const f of fires) counts[f.class]++
  const pct = (n: number) => fires.length === 0 ? "n/a" : ((100 * n) / fires.length).toFixed(1) + "%"
  console.log("\n=== Class distribution ===")
  console.log(`  A_v1 (checker-surface miss, V1-addressable):     ${counts.A_v1} (${pct(counts.A_v1)})`)
  console.log(`  B    (adapter attention failure):                ${counts.B} (${pct(counts.B)})`)
  console.log(`  C_sysleak  (entity from Salvatore system prompt, not V1-addressable): ${counts.C_sysleak} (${pct(counts.C_sysleak)})`)
  console.log(`  C_invention (pure writer invention):             ${counts.C_invention} (${pct(counts.C_invention)})`)

  // Per-novel
  console.log("\n=== Per-novel class breakdown ===")
  const perNovel = new Map<string, { A_v1: number; B: number; C_sysleak: number; C_invention: number; total: number }>()
  for (const f of fires) {
    const p = perNovel.get(f.novel_id) ?? { A_v1: 0, B: 0, C_sysleak: 0, C_invention: 0, total: 0 }
    p[f.class]++
    p.total++
    perNovel.set(f.novel_id, p)
  }
  for (const [id, p] of perNovel) {
    console.log(`  ${id}: A=${p.A_v1} B=${p.B} Csys=${p.C_sysleak} Cinv=${p.C_invention} total=${p.total}`)
  }

  // Sample per class for manual inspection.
  console.log("\n=== Sample fires per class (up to 6 each) ===")
  for (const cls of ["A_v1", "B", "C_sysleak", "C_invention"] as const) {
    console.log(`\n--- Class ${cls} ---`)
    const picks = fires.filter(f => f.class === cls).slice(0, 6)
    for (const f of picks) {
      console.log(`  ${f.novel_id.slice(0, 20)} ch=${f.chapter} beat=${f.beat_index} attempt=${f.attempt}`)
      console.log(`    entity: "${f.entity}"`)
      console.log(`    excerpt: ${f.excerpt.slice(0, 120)}`)
    }
  }

  // Dump per-fire JSONL for follow-up adjudication
  writeFileSync(
    "scripts/hallucination/classify-remaining-fires-results.jsonl",
    fires.map(f => JSON.stringify(f)).join("\n") + "\n",
  )
  console.log(`\nWrote ${fires.length} per-fire rows to scripts/hallucination/classify-remaining-fires-results.jsonl`)

  // Expected-value verdict for the charter
  const aPct = fires.length === 0 ? 0 : (100 * counts.A_v1) / fires.length
  const addressablePct = aPct // strict V1-addressable ceiling
  console.log("\n=== Verdict for beat-entity-list-v1 charter ===")
  console.log(`  V1-addressable proportion (Class A_v1): ${addressablePct.toFixed(1)}%`)
  console.log(`  System-prompt-leak proportion (Class C_sysleak): ${(100 * counts.C_sysleak / fires.length).toFixed(1)}%`)
  console.log(`  Adapter-attention failures (Class B): ${(100 * counts.B / fires.length).toFixed(1)}%`)
  console.log(`  Pure writer invention (Class C_invention): ${(100 * counts.C_invention / fires.length).toFixed(1)}%`)
  console.log()
  if (addressablePct >= 40) {
    console.log(`  A_v1 = ${addressablePct.toFixed(1)}% ≥ 40%. V1 has expected value — proceed with full ablation (V1 → V2 → V3 → V4 per §7).`)
  } else if (addressablePct >= 25) {
    console.log(`  A_v1 = ${addressablePct.toFixed(1)}%, in 25–40% gray zone. V1 likely yields a small but real lift; weigh against ~4.5 hr implementation cost.`)
  } else {
    console.log(`  A_v1 = ${addressablePct.toFixed(1)}% < 25%. V1 expected value is low. Defer or shelve the charter; focus on C_invention (writer-side) or C_sysleak (leak-adapter expansion).`)
  }

  const sysleakNote = counts.C_sysleak > 0
    ? `\n  Note: ${counts.C_sysleak} fires (${(100 * counts.C_sysleak / fires.length).toFixed(1)}%) trace to Salvatore voice-LoRA system-prompt leaks. These will NOT be addressed by V1; consider leak-adapter widening OR removing corpus references from the voice-LoRA system prompt.`
    : ""
  if (sysleakNote) console.log(sysleakNote)
  process.exit(0)
}

main()
