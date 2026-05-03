/**
 * Offline eval: replay the halluc-ungrounded-v2 adapter on the 20 adjudicated
 * samples with the NEW context shape ("From-brief:" line added to WORLD BIBLE),
 * without spending LXC novel-generation cycles.
 *
 * For each sample:
 *   1. Parse the original halluc_ungrounded_user_prompt to extract BEAT BRIEF
 *      Summary / Setting / Characters text.
 *   2. Run extractProperNouns() on that text.
 *   3. Rewrite the user_prompt with a "From-brief:" line appended to the
 *      WORLD BIBLE block (dedupe against the existing names-only list).
 *   4. Call the adapter with the new prompt.
 *   5. Compare verdict against the original fired verdict AND the human
 *      adjudication (TP/FP/Borderline).
 *
 * Output: scripts/hallucination/replay-results.jsonl + a summary table.
 *
 * Usage (on LXC):
 *   bun scripts/hallucination/replay-with-new-context.ts
 */

import { readFileSync, writeFileSync } from "node:fs"
import { extractProperNouns } from "../../src/agents/halluc-ungrounded/context.ts"
import { HALLUC_UNGROUNDED_SYSTEM, hallucUngroundedSchema } from "../../src/agents/halluc-ungrounded/index.ts"
import { callAgent } from "../../src/llm.ts"

// Human adjudication from the 2026-04-20 subagent pass, keyed by
// (novel_id, chapter, beat_index, attempt). TP = correct fire, FP = false
// positive, B = borderline (lean FP). Drawn from the 4 Sonnet subagent
// reports; see docs/archive/2026-04/halluc-v3-production-report-2026-04-20.md.
const ADJUDICATION: Record<string, "TP" | "FP" | "B"> = {
  // chunk aa
  "novel-1776608639218|2|14|1": "TP",   // Bremen's Run (Salvatore leak)
  "novel-1776608639218|3|5|1":  "FP",   // Heartstone — in brief summary
  "novel-1776608639218|1|4|1":  "FP",   // Baldur's Gate — in brief
  "novel-1776608819617|1|2|3":  "TP",   // Northland (attempt 3)
  "novel-1776608819617|1|2|2":  "TP",   // Northland (attempt 2)
  // chunk ab
  "novel-1776608819617|1|4|1":  "TP",   // Vale Settlements, Snowhold Gap
  "novel-1776609267761|1|0|1":  "FP",   // Baldur's Gate/Spine-of-the-World/etc — all in brief
  "novel-1776609267761|1|3|1":  "B",    // Lake Communities — transition bridge
  "novel-1776609267761|1|3|3":  "B",    // Lake Communities — same
  "novel-1776611156855|1|10|1": "TP",   // Balennar Keep
  // chunk ac
  "novel-1776611156855|1|2|1":  "FP",   // Syndicate — in brief
  "novel-1776612087459|1|0|1":  "TP",   // Lake Communities (no brief mention here)
  "novel-1776612087459|1|3|1":  "TP",   // Northland
  "novel-1776612087459|1|4|1":  "FP",   // Frostbite Citadel + Council — both in brief
  // chunk ad
  "novel-1776614270831|1|11|1": "TP",   // Harpells (Salvatore leak)
  "novel-1776614270831|1|0|1":  "TP",   // Rimeport + Stoneborn (borderline)
  "novel-1776614270831|1|1|1":  "TP",   // Stoneborn, Southhold
  "novel-1776627411728|1|5|1":  "TP",   // Orc Kingdoms
  "novel-1776627411728|1|5|3":  "TP",   // Orc Kingdoms (retry)
  // note: 1 chunk-ac sample didn't fit cleanly; using 19 samples here
}

// Regex to peel BEAT BRIEF Summary / Setting lines out of the recorded prompt.
function parseBriefSources(prompt: string): { summary: string; setting: string } {
  const s = prompt
  const sum = /\n\s*Summary:\s*(.+?)(?:\n\s*Kind:|\n\s*POV:|\n\s*Characters:|\n\s*Setting:|\n\n)/s.exec(s)
  const set = /\n\s*Setting:\s*(.+?)(?:\n\n|\n[A-Z])/s.exec(s)
  return {
    summary: sum?.[1]?.trim() ?? "",
    setting: set?.[1]?.trim() ?? "",
  }
}

// Parse the existing bible names-only block so we can dedupe against it.
function parseBibleNames(prompt: string): Set<string> {
  const names = new Set<string>()
  for (const label of ["Locations", "Cultures", "Systems"]) {
    const re = new RegExp(`\\n\\s*${label}:\\s*(.+?)\\n`, "s")
    const m = re.exec(prompt)
    if (!m) continue
    const list = m[1].split(/,\s*/).map(x => x.trim()).filter(x => x && x !== "(none)")
    for (const n of list) names.add(n.toLowerCase())
  }
  return names
}

// Inject a "From-brief:" line after the Systems: line within the WORLD BIBLE block.
function injectFromBrief(prompt: string, fromBrief: string[]): string {
  const bulletValue = fromBrief.length > 0 ? fromBrief.join(", ") : "(none)"
  // Insert after the "Systems:" line (with whatever surrounding whitespace).
  return prompt.replace(
    /(\n\s*Systems:\s*[^\n]*)\n/,
    `$1\n  From-brief: ${bulletValue}\n`,
  )
}

async function main() {
  const raw = readFileSync("scripts/hallucination/solo-ungrounded-samples.jsonl", "utf-8").trim().split("\n")
  const samples = raw.map(l => JSON.parse(l))

  console.log(`Replaying ${samples.length} samples with new context shape...`)

  const results: Array<{
    novel_id: string
    chapter: number
    beat_index: number
    attempt: number
    adjudication: string | null
    original_fired: boolean
    new_fired: boolean
    from_brief_added: string[]
    new_issues: Array<{ entity: string; excerpt: string }>
  }> = []

  let i = 0
  for (const s of samples) {
    i++
    const key = `${s.novel_id}|${s.chapter}|${s.beat_index}|${s.attempt}`
    const adj = ADJUDICATION[key] ?? null

    const brief = parseBriefSources(s.halluc_ungrounded_user_prompt)
    const bibleKnown = parseBibleNames(s.halluc_ungrounded_user_prompt)
    const allCandidates = extractProperNouns([brief.summary, brief.setting].join(" \n "))
    const fromBrief = allCandidates.filter(e => !bibleKnown.has(e.toLowerCase()))

    const newPrompt = injectFromBrief(s.halluc_ungrounded_user_prompt, fromBrief)

    let newFired = false
    let newIssues: Array<{ entity: string; excerpt: string }> = []
    try {
      const out = await callAgent({
        agentName: "halluc-ungrounded" as const,
        systemPrompt: HALLUC_UNGROUNDED_SYSTEM,
        userPrompt: newPrompt,
        schema: hallucUngroundedSchema,
      })
      newFired = out.output.pass === false
      newIssues = (out.output.issues ?? []) as Array<{ entity: string; excerpt: string }>
    } catch (err) {
      console.error(`[${i}/${samples.length}] ${key} — error:`, err instanceof Error ? err.message : err)
      continue
    }

    const row = {
      novel_id: s.novel_id,
      chapter: s.chapter,
      beat_index: s.beat_index,
      attempt: s.attempt,
      adjudication: adj,
      original_fired: true, // all 20 samples were solo-ungrounded fires
      new_fired: newFired,
      from_brief_added: fromBrief,
      new_issues: newIssues,
    }
    results.push(row)
    console.log(`[${i}/${samples.length}] ${key} adj=${adj ?? "?"} new_fired=${newFired} +brief=[${fromBrief.slice(0, 4).join(", ")}${fromBrief.length > 4 ? "..." : ""}]`)
  }

  writeFileSync("scripts/hallucination/replay-results.jsonl", results.map(r => JSON.stringify(r)).join("\n") + "\n")

  // Summary
  const adjGroups: Record<string, { n: number; stillFired: number; flipped: number }> = {
    TP: { n: 0, stillFired: 0, flipped: 0 },
    FP: { n: 0, stillFired: 0, flipped: 0 },
    B:  { n: 0, stillFired: 0, flipped: 0 },
    "?": { n: 0, stillFired: 0, flipped: 0 },
  }
  for (const r of results) {
    const g = adjGroups[r.adjudication ?? "?"]
    g.n++
    if (r.new_fired) g.stillFired++
    else g.flipped++
  }
  console.log("\n=== Replay Summary ===")
  console.log("Adjudication | n | still-fired (original rate) | flipped-to-pass")
  for (const [k, v] of Object.entries(adjGroups)) {
    if (v.n === 0) continue
    console.log(`  ${k.padEnd(3)} | ${v.n} | ${v.stillFired} | ${v.flipped}`)
  }
  console.log("\nDesired: TP stays high (true positives should still fire), FP+B drop to 0 or low.")
  process.exit(0)
}

main()
