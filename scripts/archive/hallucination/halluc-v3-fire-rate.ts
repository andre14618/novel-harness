/**
 * Halluc V3 production fire-rate analysis.
 *
 * Per docs/hallucination-v3-wire-in-plan.md §8:
 *   1. Query llm_calls for beat-writer, adherence-events, halluc-ungrounded, halluc-leak-salvatore.
 *   2. Group by (novel_id, chapter, beat_index, attempt).
 *   3. Compute per-adapter fire + co-fire rates.
 *   4. Sample solo fires.
 *   5. Confirm halluc-leak-salvatore fires only on Salvatore-routed beats.
 *
 * Usage:
 *   bun scripts/hallucination/halluc-v3-fire-rate.ts [novel-id ...]
 *
 * If no novel IDs are passed, analyzes all post-wire-in (>= 2026-04-19 14:00)
 * novels that have no chapter_exhaustions or chapter_revisions (i.e. natural
 * non-force-injected runs).
 *
 * Known undercounts (bounded, documented for honesty):
 *   - adherence-checker has a deterministic pre-LLM short-circuit when ≥2 character-presence
 *     issues exist; those early-fires never reach llm_calls and are invisible here. Rare but real.
 *   - If response_content survived validation but fails JSON.parse here (e.g. fenced JSON that
 *     extractJSON() stripped during the live call but left in the raw log), safeParse returns
 *     null and the verdict is dropped. Also rare; check the "no-verdict" bucket if suspicious.
 */

import db from "../../../src/db/connection.ts"

const WIRE_IN_TIMESTAMP = "2026-04-19 14:00"

async function pickCleanNovels(): Promise<string[]> {
  const rows = await db`
    SELECT n.id
    FROM novels n
    WHERE n.created_at > ${WIRE_IN_TIMESTAMP}
      AND n.id NOT LIKE 'pp2-floor%'
      AND (SELECT COUNT(*) FROM chapter_exhaustions WHERE novel_id = n.id) = 0
      AND (SELECT COUNT(*) FROM chapter_revisions WHERE novel_id = n.id) = 0
      AND (SELECT COUNT(*) FROM llm_calls WHERE novel_id = n.id AND agent = 'halluc-ungrounded') > 0
    ORDER BY n.created_at DESC
  `
  return rows.map((r: any) => r.id as string)
}

type Verdict = true | false | null // true = fired, false = passed, null = no call
type BeatGroup = {
  novel_id: string
  chapter: number
  beat_index: number
  attempt: number
  bw_present: boolean
  adh: Verdict
  hu: Verdict
  hl: Verdict
}

function safeParse(s: string | null | undefined): any {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function huVerdict(resp: string | null): Verdict {
  const p = safeParse(resp)
  if (!p) return null
  if (typeof p.pass === "boolean") return p.pass ? false : true
  return null
}

function hlVerdict(resp: string | null): Verdict {
  const p = safeParse(resp)
  if (!p) return null
  if (typeof p.has_leak === "boolean") return p.has_leak ? true : false
  return null
}

function adhVerdict(resp: string | null): Verdict {
  const p = safeParse(resp)
  if (!p) return null
  // adherence-events schema (src/agents/writer/adherence-checker.ts): {events_present, evidence, reasoning}
  // Fire = required events NOT present in prose.
  if (typeof p.events_present === "boolean") return p.events_present ? false : true
  return null
}

async function analyze(novelIds: string[]) {
  const ids = novelIds.join(",")
  console.log(`Panel: ${novelIds.length} novels`)
  for (const id of novelIds) console.log(`  - ${id}`)
  console.log()

  // Pull all relevant calls in one sweep.
  // Note: we INCLUDE failed=true rows. Per beat-checks wrappers, transport/schema failures are
  // converted into blocker issues ("fires"), so filtering them out would undercount.
  const rows = await db`
    SELECT novel_id, chapter, beat_index, attempt, agent, response_content, failed
    FROM llm_calls
    WHERE novel_id IN ${db(novelIds)}
      AND agent IN ('beat-writer', 'adherence-events', 'halluc-ungrounded', 'halluc-leak-salvatore')
    ORDER BY novel_id, chapter, beat_index, attempt, agent
  `

  const beats = new Map<string, BeatGroup>()
  for (const r of rows as any[]) {
    if (r.beat_index === null || r.beat_index === undefined) continue
    const key = `${r.novel_id}|${r.chapter}|${r.beat_index}|${r.attempt ?? 1}`
    let b = beats.get(key)
    if (!b) {
      b = {
        novel_id: r.novel_id,
        chapter: r.chapter,
        beat_index: r.beat_index,
        attempt: r.attempt ?? 1,
        bw_present: false,
        adh: null,
        hu: null,
        hl: null,
      }
      beats.set(key, b)
    }
    if (r.agent === "beat-writer") b.bw_present = true
    else if (r.agent === "adherence-events") b.adh = r.failed ? true : adhVerdict(r.response_content)
    else if (r.agent === "halluc-ungrounded") b.hu = r.failed ? true : huVerdict(r.response_content)
    else if (r.agent === "halluc-leak-salvatore") b.hl = r.failed ? true : hlVerdict(r.response_content)
  }

  // Report
  let totalBeats = 0
  let anyChecker = 0
  let writerOnly = 0
  let adhFired = 0, adhPass = 0
  let huFired = 0, huPass = 0
  let hlFired = 0, hlPass = 0
  let anyFired = 0
  let coHuHl = 0, coHuAdh = 0, coHlAdh = 0, coAll3 = 0
  let soloHu = 0, soloHl = 0, soloAdh = 0

  const perNovel = new Map<string, { bw: number; hu: number; hl: number; adh: number; fires: number }>()
  for (const b of beats.values()) {
    if (!b.bw_present) continue
    totalBeats++
    const key = b.novel_id
    const pn = perNovel.get(key) ?? { bw: 0, hu: 0, hl: 0, adh: 0, fires: 0 }
    pn.bw++

    if (b.hu === null && b.hl === null && b.adh === null) { writerOnly++; perNovel.set(key, pn); continue }
    anyChecker++
    if (b.hu === true) { huFired++; pn.hu++ } else if (b.hu === false) huPass++
    if (b.hl === true) { hlFired++; pn.hl++ } else if (b.hl === false) hlPass++
    if (b.adh === true) { adhFired++; pn.adh++ } else if (b.adh === false) adhPass++
    const firedCount = [b.hu === true, b.hl === true, b.adh === true].filter(Boolean).length
    if (firedCount > 0) { anyFired++; pn.fires++ }
    if (b.hu === true && b.hl === true) coHuHl++
    if (b.hu === true && b.adh === true) coHuAdh++
    if (b.hl === true && b.adh === true) coHlAdh++
    if (b.hu === true && b.hl === true && b.adh === true) coAll3++
    if (firedCount === 1) {
      if (b.hu === true) soloHu++
      if (b.hl === true) soloHl++
      if (b.adh === true) soloAdh++
    }
    perNovel.set(key, pn)
  }

  const pct = (n: number, d: number) => (d === 0 ? "n/a" : ((100 * n) / d).toFixed(1) + "%")

  console.log("=== Halluc V3 Fire-Rate Report ===")
  console.log(`Total beat attempts (with beat-writer call): ${totalBeats}`)
  console.log(`  With at least one checker call:            ${anyChecker}`)
  console.log(`  Writer-only (no checker ran):              ${writerOnly}`)
  console.log()
  console.log("Per-adapter fire rate:")
  console.log(`  adherence-events:       ${adhFired} fires / ${adhFired + adhPass} verdicts  (${pct(adhFired, adhFired + adhPass)})`)
  console.log(`  halluc-ungrounded:      ${huFired} fires / ${huFired + huPass} verdicts  (${pct(huFired, huFired + huPass)})`)
  console.log(`  halluc-leak-salvatore:  ${hlFired} fires / ${hlFired + hlPass} verdicts  (${pct(hlFired, hlFired + hlPass)})`)
  console.log()
  console.log(`Any checker fired on this beat attempt: ${anyFired}/${anyChecker} (${pct(anyFired, anyChecker)})`)
  console.log()
  console.log("Solo fires (only one checker flagged this beat):")
  console.log(`  solo adherence:   ${soloAdh}`)
  console.log(`  solo ungrounded:  ${soloHu}`)
  console.log(`  solo leak:        ${soloHl}`)
  console.log("Co-fires:")
  console.log(`  ungrounded + leak:          ${coHuHl}`)
  console.log(`  ungrounded + adherence:     ${coHuAdh}`)
  console.log(`  leak + adherence:           ${coHlAdh}`)
  console.log(`  all three:                  ${coAll3}`)
  console.log()
  console.log("Per-novel breakdown (bw / hu-fires / hl-fires / adh-fires / any-fire):")
  for (const [nid, pn] of perNovel) {
    console.log(`  ${nid}: bw=${pn.bw} huF=${pn.hu} hlF=${pn.hl} adhF=${pn.adh} anyF=${pn.fires} (${pct(pn.fires, pn.bw)})`)
  }

  // Retry clearance: for each fired beat attempt N, does attempt N+1 exist and clear the same checker?
  console.log()
  console.log("=== Retry clearance ===")
  let huRetryClear = 0, huRetryStillFired = 0, huRetryNone = 0
  let hlRetryClear = 0, hlRetryStillFired = 0, hlRetryNone = 0
  let adhRetryClear = 0, adhRetryStillFired = 0, adhRetryNone = 0
  for (const b of beats.values()) {
    if (!b.bw_present) continue
    const nextKey = `${b.novel_id}|${b.chapter}|${b.beat_index}|${b.attempt + 1}`
    const next = beats.get(nextKey)
    for (const [fired, verdictProp, inc, incStill, incNone] of [
      [b.hu === true, "hu", (v: Verdict) => v === false, (v: Verdict) => v === true, null],
      [b.hl === true, "hl", (v: Verdict) => v === false, (v: Verdict) => v === true, null],
      [b.adh === true, "adh", (v: Verdict) => v === false, (v: Verdict) => v === true, null],
    ] as const) {
      if (!fired) continue
      if (!next) {
        if (verdictProp === "hu") huRetryNone++
        if (verdictProp === "hl") hlRetryNone++
        if (verdictProp === "adh") adhRetryNone++
        continue
      }
      const v = (next as any)[verdictProp] as Verdict
      const cleared = inc(v)
      const stillFired = incStill(v)
      if (cleared) {
        if (verdictProp === "hu") huRetryClear++
        if (verdictProp === "hl") hlRetryClear++
        if (verdictProp === "adh") adhRetryClear++
      } else if (stillFired) {
        if (verdictProp === "hu") huRetryStillFired++
        if (verdictProp === "hl") hlRetryStillFired++
        if (verdictProp === "adh") adhRetryStillFired++
      } else {
        // Next attempt exists but checker didn't emit verdict (e.g., writer-only retry)
        if (verdictProp === "hu") huRetryNone++
        if (verdictProp === "hl") hlRetryNone++
        if (verdictProp === "adh") adhRetryNone++
      }
    }
  }
  console.log("Of fired beats, next attempt verdict:")
  console.log(`  adherence   -> clear ${adhRetryClear} / still-fired ${adhRetryStillFired} / no-verdict ${adhRetryNone}`)
  console.log(`  ungrounded  -> clear ${huRetryClear} / still-fired ${huRetryStillFired} / no-verdict ${huRetryNone}`)
  console.log(`  leak        -> clear ${hlRetryClear} / still-fired ${hlRetryStillFired} / no-verdict ${hlRetryNone}`)

  process.exit(0)
}

const explicit = process.argv.slice(2).filter(a => !a.startsWith("-"))
const novelIds = explicit.length > 0 ? explicit : await pickCleanNovels()
if (novelIds.length === 0) {
  console.error("No novels to analyze.")
  process.exit(1)
}
await analyze(novelIds)
