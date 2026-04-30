// Pattern 27 — Try/fail cycle structure across 3 Icewind Dale books.
//
// Methodology defensively designed: a "try at the primary goal" is a subjective
// boundary that risks the same anchor-stability failure mode that killed the
// mice rubric (Sonnet J<0.85 on multi-class subjective dims). We bind to a
// BINARY tag (`is_try_at_primary_goal`: yes/no) per chapter and gate the full
// corpus pass on a calibration step:
//
//   1. Sample n=10 chapters per book (=30 total). Run DeepSeek V4 Flash twice
//      on each chapter (same prompt, temperature 0, two independent calls).
//      Compute Jaccard agreement on the binary `is_try` tag.
//   2. If Jaccard < 0.7, STOP and report a methodological negative result
//      (the rubric is too soft to ship).
//   3. If Jaccard >= 0.7, run a single pass over all 92 chapters and report
//      distributions, escalation patterns, cross-book directional comparison.
//
// Per CLAUDE.md and the 2026-04-30 binary-collapse SOP, we do NOT use a
// multi-class taxonomy (try/fail/setback/escalation/success).
//
// Per-book primary goals (used to anchor the labeling task):
//   - crystal_shard:    Defeat Akar Kessell + protect Ten-Towns
//   - streams_of_silver: Find Mithril Hall (Bruenor's ancestral home)
//   - halflings_gem:    Rescue Regis from Pasha Pook
//
// Output:
//   - Timestamped JSON: novels/salvatore-icewind-dale/structure-calibration/
//                       crystal_shard.<TS>.try-fail-cycles.json
//   - Conclusions append to crystal_shard-conclusions.md (append-only)

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// ----- types -----------------------------------------------------------------

type Beat = {
  beat_idx: number
  words: number
  kind: string
  boundary_signal: string
  summary: string
  first_sentence: string
  last_sentence: string
  text: string
  scene_id: string
  book: string
  chapter: number | string
}

type ChapterDigest = {
  book: string
  chapter: number | string
  beat_summaries: string[]
  total_beats: number
  total_words: number
  stakes_recalibration_count: number
  position_in_book: number // 0..1 (chapter position in numeric chapters)
  is_special: boolean // prelude/epilogue/parts
}

const PRIMARY_GOALS: Record<string, string> = {
  crystal_shard: "DEFEAT AKAR KESSELL AND PROTECT TEN-TOWNS — defeat or thwart the wizard Akar Kessell who wields the Crystal Shard (Crenshinibon) and is mustering an army of goblins/orcs/giants/barbarians against Ten-Towns; protect the towns of Ten-Towns from the impending invasion. Note that this is the BOOK-LEVEL primary goal — earlier chapters with subgoals (defeating the barbarian invasion under Heafstaag, Drizzt securing alliances, gathering the dwarves, etc.) count as tries at the primary goal IF and ONLY IF the chapter's action functionally advances toward defeating Kessell or protecting Ten-Towns. Pure character-introduction chapters or backstory chapters do not.",
  streams_of_silver:
    "FIND MITHRIL HALL — Bruenor Battlehammer's ancestral dwarven home, lost long ago and Bruenor's lifelong quest. The Companions (Drizzt, Bruenor, Wulfgar, Regis, and later Catti-brie) journey from Ten-Towns south and east through Luskan, Longsaddle, Silverymoon, etc., seeking clues to its location and ultimately attempting to reach and reclaim it. Subordinate threats (assassins, pursuers, hostile cities) count as tries at the primary goal IF the chapter's action moves the search/journey forward; pure pursuer-side scenes (Entreri, Sydney, Dendybar) typically do NOT count unless they collide with the quest party.",
  halflings_gem:
    "RESCUE REGIS FROM PASHA POOK — Regis the halfling has been taken/pursued by the assassin Artemis Entreri at the behest of Pasha Pook of Calimport, who wants Regis killed for stealing the ruby pendant. The Companions (Drizzt, Bruenor, Wulfgar, Catti-brie) pursue Entreri across the Realms — through Mithril Hall, the seas, into Calimshan and ultimately Calimport — to free Regis. Chapters where the Companions actively pursue, prepare to rescue, or directly confront Pook/Entreri count as tries; pursuer-side or villain-internal scenes generally do NOT count unless they involve direct rescue-relevant action.",
}

// ----- chapter ordering helpers ---------------------------------------------

const SPECIAL_ORDER: Record<string, number> = {
  prelude: -1,
  epilogue: 1000,
  epilogue2: 1001,
  epilogue3: 1002,
  part1: 100,
  part2: 200,
  part3: 300,
}

function chapterSortKey(c: number | string): number {
  if (typeof c === "number") return c
  if (c in SPECIAL_ORDER) return SPECIAL_ORDER[c]!
  // Fallback: hash-ish string sort, push to end
  return 9999
}

function isNumericChapter(c: number | string): c is number {
  return typeof c === "number"
}

// ----- digest builder --------------------------------------------------------

function buildChapterDigests(beatsPath: string): ChapterDigest[] {
  const lines = readFileSync(beatsPath, "utf8").trim().split("\n")
  const byKey = new Map<string, Beat[]>()
  for (const line of lines) {
    const r = JSON.parse(line) as Beat
    const k = `${r.book}|${r.chapter}`
    let arr = byKey.get(k)
    if (!arr) {
      arr = []
      byKey.set(k, arr)
    }
    arr.push(r)
  }

  // Number chapters within each book to compute position-in-book.
  const numericChaptersPerBook: Record<string, number[]> = {}
  for (const [k] of byKey) {
    const [book, chRaw] = k.split("|")
    if (!book) continue
    const ch = /^-?\d+$/.test(chRaw!) ? Number(chRaw) : chRaw!
    if (typeof ch === "number") {
      if (!numericChaptersPerBook[book]) numericChaptersPerBook[book] = []
      numericChaptersPerBook[book].push(ch)
    }
  }
  for (const arr of Object.values(numericChaptersPerBook)) arr.sort((a, b) => a - b)

  const digests: ChapterDigest[] = []
  for (const [k, beats] of byKey) {
    beats.sort((a, b) => a.beat_idx - b.beat_idx)
    const [book, chRaw] = k.split("|")
    if (!book) continue
    const ch = /^-?\d+$/.test(chRaw!) ? Number(chRaw) : chRaw!
    const isNum = typeof ch === "number"
    const numChs = numericChaptersPerBook[book] ?? []
    const position = isNum && numChs.length > 1
      ? (numChs.indexOf(ch) / (numChs.length - 1))
      : (isNum ? 0 : -1)

    const stakeCount = beats.filter((b) => b.boundary_signal === "stakes_recalibration").length
    digests.push({
      book,
      chapter: ch,
      beat_summaries: beats.map((b) => b.summary).filter((s) => !!s),
      total_beats: beats.length,
      total_words: beats.reduce((acc, b) => acc + (b.words || 0), 0),
      stakes_recalibration_count: stakeCount,
      position_in_book: position,
      is_special: !isNum,
    })
  }

  // Sort: book order, then chapter sort key
  const bookOrder = ["crystal_shard", "streams_of_silver", "halflings_gem"]
  digests.sort((a, b) => {
    const bo = bookOrder.indexOf(a.book) - bookOrder.indexOf(b.book)
    if (bo !== 0) return bo
    return chapterSortKey(a.chapter) - chapterSortKey(b.chapter)
  })

  return digests
}

// ----- prompt + LLM call -----------------------------------------------------

const SYSTEM_PROMPT = `You label fiction chapters from R.A. Salvatore's Icewind Dale Trilogy with a single binary tag: is the chapter a TRY at the named book-level PRIMARY GOAL?

Definition of TRY (yes):
A chapter is a TRY when its primary action functionally advances, attempts, or directly confronts the named book-level primary goal — the protagonist(s) take action toward the goal, attempt a step that bears on it, or fail/succeed at a step that bears on it. Both successful steps and failed/setback steps count as TRY (because both are attempts).

Definition of NOT-A-TRY (no):
A chapter is NOT a TRY when its action does not functionally advance the named primary goal — examples include:
- Pure character introduction or backstory establishment with no primary-goal action
- Villain/antagonist internal scenes that do not collide with the protagonist's progress
- Setting-the-stage / world-establishing chapters
- Side adventures or sub-quests that do not bear on the primary goal
- Aftermath/recovery scenes after a primary-goal action concludes

If the chapter contains BOTH primary-goal action and non-primary-goal material, label TRY (yes) when the primary-goal action is the chapter's dominant move; label NOT-A-TRY (no) when the primary-goal action is incidental.

Output JSON only:
{ "is_try": true | false, "confidence": "high" | "medium" | "low", "reason": "<one short clause, <=160 chars>" }`

type LlmLabel = { is_try: boolean; confidence: "high" | "medium" | "low"; reason: string }

// Token usage tracking
type Usage = { prompt: number; completion: number; calls: number }
const USAGE: Usage = { prompt: 0, completion: 0, calls: 0 }

async function callDeepSeekTracked(
  digest: ChapterDigest,
  primaryGoal: string,
  key: string,
): Promise<LlmLabel> {
  const summariesBlock = digest.beat_summaries
    .map((s, i) => `[beat ${i}] ${s}`)
    .join("\n")

  const userPrompt = `BOOK: ${digest.book}
CHAPTER: ${digest.chapter}
BOOK-LEVEL PRIMARY GOAL:
${primaryGoal}

CHAPTER BEAT SUMMARIES (sorted by beat_idx):
${summariesBlock}

---
Question: Is this chapter a TRY at the named book-level primary goal? Respond JSON only.`

  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    }),
  })
  if (!r.ok) throw new Error(`DeepSeek HTTP ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as any
  if (j.usage) {
    USAGE.prompt += j.usage.prompt_tokens || 0
    USAGE.completion += j.usage.completion_tokens || 0
  }
  USAGE.calls += 1
  const raw = (j.choices?.[0]?.message?.content ?? "").trim()
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`DeepSeek non-JSON: ${raw.slice(0, 200)}`)
  }
  if (typeof parsed.is_try !== "boolean") {
    throw new Error(`is_try not boolean: ${JSON.stringify(parsed).slice(0, 200)}`)
  }
  const conf =
    parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "medium"
  return {
    is_try: parsed.is_try,
    confidence: conf,
    reason: String(parsed.reason || "").slice(0, 240),
  }
}

// ----- bounded-parallel runner -----------------------------------------------

async function labelDigests(
  digests: ChapterDigest[],
  key: string,
  concurrency = 8,
): Promise<Map<string, LlmLabel>> {
  const out = new Map<string, LlmLabel>()
  const queue = digests.slice()
  let done = 0

  async function worker() {
    while (queue.length > 0) {
      const d = queue.shift()
      if (!d) return
      const goal = PRIMARY_GOALS[d.book]
      if (!goal) {
        out.set(`${d.book}|${d.chapter}`, {
          is_try: false,
          confidence: "low",
          reason: "no primary goal mapped for book",
        })
        done += 1
        continue
      }
      try {
        const label = await callDeepSeekTracked(d, goal, key)
        out.set(`${d.book}|${d.chapter}`, label)
      } catch (err) {
        out.set(`${d.book}|${d.chapter}`, {
          is_try: false,
          confidence: "low",
          reason: `LLM error: ${(err as Error).message.slice(0, 120)}`,
        })
        console.error(`LLM error on ${d.book}|${d.chapter}: ${(err as Error).message.slice(0, 200)}`)
      }
      done += 1
      if (done % 10 === 0) console.log(`  progress: ${done}/${digests.length}`)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return out
}

// ----- Jaccard ---------------------------------------------------------------

function jaccardBinary(
  run1: Map<string, LlmLabel>,
  run2: Map<string, LlmLabel>,
): { agree: number; n: number; agreeRate: number; jaccard: number; classes: any } {
  const keys = new Set([...run1.keys(), ...run2.keys()])
  let agree = 0
  let intersectTrue = 0
  let unionTrue = 0
  let r1True = 0
  let r2True = 0
  for (const k of keys) {
    const a = run1.get(k)?.is_try
    const b = run2.get(k)?.is_try
    if (a === b) agree += 1
    if (a === true) r1True += 1
    if (b === true) r2True += 1
    if (a === true && b === true) intersectTrue += 1
    if (a === true || b === true) unionTrue += 1
  }
  const n = keys.size
  return {
    agree,
    n,
    agreeRate: n === 0 ? 0 : agree / n,
    jaccard: unionTrue === 0 ? 1.0 : intersectTrue / unionTrue,
    classes: {
      true: { run1: r1True, run2: r2True },
      false: { run1: n - r1True, run2: n - r2True },
    },
  }
}

// ----- run-cycle analysis ---------------------------------------------------

type ChapterAtom = { chapter: number | string; isTry: boolean; stakeBeats: number; totalBeats: number; words: number; reason: string }

type CycleStats = {
  book: string
  numericChaptersN: number
  totalChaptersN: number // includes prelude/epilogue/parts
  triesN: number
  triesPct: number
  // Cycle = a TRY chapter (treat each TRY chapter as one cycle unit when consecutive
  // TRY chapters are merged into one streak, modeling them as a single "extended attempt").
  // We report BOTH chapter-level cycle counts AND merged streak-level cycle counts.
  tryStreaks: number
  meanChaptersPerStreak: number
  meanGapBetweenStreaks: number
  finalStreakIsLastChapter: boolean
  earlyMidLateTryPct: { early: number; mid: number; late: number }
  // Stake-recalibration density per try-streak as a proxy for stakes intensity
  meanStakeBeatsPerTryChapter: number
  // Escalation: stakes-density of streaks ordered first-to-last; report
  // first-streak vs last-streak ratio + monotone-rising count
  streakStakesSequence: number[] // mean stakes_beats / try-chapter, per streak
  finalAttemptDirection: "rising" | "falling" | "flat" | "n/a"
}

function analyzeBook(
  book: string,
  digests: ChapterDigest[],
  labels: Map<string, LlmLabel>,
): CycleStats {
  // Numeric-only chapter sequence first; prelude/epilogue tracked separately.
  const numeric = digests
    .filter((d) => d.book === book && typeof d.chapter === "number")
    .sort((a, b) => (a.chapter as number) - (b.chapter as number))
  const all = digests.filter((d) => d.book === book)

  const atoms: ChapterAtom[] = numeric.map((d) => {
    const lbl = labels.get(`${d.book}|${d.chapter}`)
    return {
      chapter: d.chapter,
      isTry: lbl?.is_try === true,
      stakeBeats: d.stakes_recalibration_count,
      totalBeats: d.total_beats,
      words: d.total_words,
      reason: lbl?.reason || "",
    }
  })

  const triesN = atoms.filter((a) => a.isTry).length
  const triesPct = atoms.length === 0 ? 0 : triesN / atoms.length

  // Streaks of consecutive TRY chapters
  const streaks: { startCh: number; endCh: number; length: number; stakesPerCh: number }[] = []
  let i = 0
  while (i < atoms.length) {
    if (!atoms[i]!.isTry) {
      i += 1
      continue
    }
    let j = i
    let stakeSum = 0
    while (j < atoms.length && atoms[j]!.isTry) {
      stakeSum += atoms[j]!.stakeBeats
      j += 1
    }
    const length = j - i
    streaks.push({
      startCh: atoms[i]!.chapter as number,
      endCh: atoms[j - 1]!.chapter as number,
      length,
      stakesPerCh: length === 0 ? 0 : stakeSum / length,
    })
    i = j
  }

  const tryStreaks = streaks.length
  const meanChaptersPerStreak =
    tryStreaks === 0 ? 0 : streaks.reduce((acc, s) => acc + s.length, 0) / tryStreaks

  // Gap between streaks (in chapters) — gap from end of streak k to start of streak k+1
  const gaps: number[] = []
  for (let k = 1; k < streaks.length; k += 1) {
    gaps.push(streaks[k]!.startCh - streaks[k - 1]!.endCh - 1)
  }
  const meanGapBetweenStreaks = gaps.length === 0 ? 0 : gaps.reduce((a, b) => a + b, 0) / gaps.length

  // Final-streak position
  const finalStreakIsLastChapter =
    streaks.length > 0 && streaks[streaks.length - 1]!.endCh === atoms[atoms.length - 1]!.chapter

  // Early/mid/late distribution: split numeric chapters into 3 thirds
  const third = Math.max(1, Math.floor(atoms.length / 3))
  const earlySlice = atoms.slice(0, third)
  const midSlice = atoms.slice(third, 2 * third)
  const lateSlice = atoms.slice(2 * third)
  const tryPctIn = (slice: ChapterAtom[]) =>
    slice.length === 0 ? 0 : slice.filter((a) => a.isTry).length / slice.length
  const earlyMidLateTryPct = {
    early: tryPctIn(earlySlice),
    mid: tryPctIn(midSlice),
    late: tryPctIn(lateSlice),
  }

  // Stake density per TRY chapter
  const tryAtoms = atoms.filter((a) => a.isTry)
  const meanStakeBeatsPerTryChapter =
    tryAtoms.length === 0
      ? 0
      : tryAtoms.reduce((acc, a) => acc + a.stakeBeats, 0) / tryAtoms.length

  // Stakes-density per streak; final-attempt direction: monotonic check on
  // first->last streak's stakesPerCh.
  const streakStakesSequence = streaks.map((s) => Math.round(s.stakesPerCh * 100) / 100)
  let finalAttemptDirection: "rising" | "falling" | "flat" | "n/a" = "n/a"
  if (streakStakesSequence.length >= 2) {
    const first = streakStakesSequence[0]!
    const last = streakStakesSequence[streakStakesSequence.length - 1]!
    if (last > first + 0.1) finalAttemptDirection = "rising"
    else if (last < first - 0.1) finalAttemptDirection = "falling"
    else finalAttemptDirection = "flat"
  }

  return {
    book,
    numericChaptersN: atoms.length,
    totalChaptersN: all.length,
    triesN,
    triesPct: Math.round(triesPct * 1000) / 10,
    tryStreaks,
    meanChaptersPerStreak: Math.round(meanChaptersPerStreak * 100) / 100,
    meanGapBetweenStreaks: Math.round(meanGapBetweenStreaks * 100) / 100,
    finalStreakIsLastChapter,
    earlyMidLateTryPct: {
      early: Math.round(earlyMidLateTryPct.early * 1000) / 10,
      mid: Math.round(earlyMidLateTryPct.mid * 1000) / 10,
      late: Math.round(earlyMidLateTryPct.late * 1000) / 10,
    },
    meanStakeBeatsPerTryChapter: Math.round(meanStakeBeatsPerTryChapter * 100) / 100,
    streakStakesSequence,
    finalAttemptDirection,
  }
}

// ----- main ------------------------------------------------------------------

const ROOT = "/Users/andre/Desktop/personal_projects/novel-harness"
const BEATS_PATH = join(ROOT, "novels/salvatore-icewind-dale/beats.jsonl")
const OUT_DIR = join(ROOT, "novels/salvatore-icewind-dale/structure-calibration")
const CONCLUSIONS_PATH = join(OUT_DIR, "crystal_shard-conclusions.md")

function tsStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  )
}

// Deterministic sample: pick n=10 numeric chapters per book, evenly spaced.
function sampleForCalibration(digests: ChapterDigest[], perBook = 10): ChapterDigest[] {
  const sample: ChapterDigest[] = []
  for (const book of ["crystal_shard", "streams_of_silver", "halflings_gem"]) {
    const numeric = digests
      .filter((d) => d.book === book && typeof d.chapter === "number")
      .sort((a, b) => (a.chapter as number) - (b.chapter as number))
    if (numeric.length === 0) continue
    // Evenly spaced indices, deterministic
    const step = numeric.length / perBook
    const seen = new Set<number>()
    for (let i = 0; i < perBook; i += 1) {
      const idx = Math.min(numeric.length - 1, Math.floor(i * step))
      if (seen.has(idx)) continue
      seen.add(idx)
      sample.push(numeric[idx]!)
    }
  }
  return sample
}

function estCostUSD(promptTok: number, completionTok: number): number {
  // DeepSeek V4 Flash priced per registry; rough estimate at $0.14/$0.28 per 1M
  // (using V3.2-Flash quoted rates; V4 Flash is the same family). Slightly
  // upper-bounded so we do not under-report cost.
  const inUSD = (promptTok / 1_000_000) * 0.14
  const outUSD = (completionTok / 1_000_000) * 0.28
  return Math.round((inUSD + outUSD) * 10000) / 10000
}

async function main() {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error("DEEPSEEK_API_KEY not set in env")

  const allDigests = buildChapterDigests(BEATS_PATH)
  console.log(`loaded ${allDigests.length} chapter digests`)
  const cs = allDigests.filter((d) => d.book === "crystal_shard").length
  const ss = allDigests.filter((d) => d.book === "streams_of_silver").length
  const hg = allDigests.filter((d) => d.book === "halflings_gem").length
  console.log(`  per book: cs=${cs} ss=${ss} hg=${hg}`)

  // ----- CALIBRATION PHASE -----
  console.log("\n=== Calibration phase: n=30 chapters, 2 runs ===")
  const calibSample = sampleForCalibration(allDigests, 10)
  console.log(`calibration sample: ${calibSample.length} chapters`)

  console.log("calibration run 1...")
  const run1 = await labelDigests(calibSample, key, 8)
  console.log("calibration run 2...")
  const run2 = await labelDigests(calibSample, key, 8)

  const jac = jaccardBinary(run1, run2)
  console.log(
    `calibration: agree ${jac.agree}/${jac.n} (${(jac.agreeRate * 100).toFixed(1)}%), Jaccard=${jac.jaccard.toFixed(3)}`,
  )
  console.log(`  classes: ${JSON.stringify(jac.classes)}`)

  const calibTokens = { prompt: USAGE.prompt, completion: USAGE.completion, calls: USAGE.calls }
  const calibCostUSD = estCostUSD(calibTokens.prompt, calibTokens.completion)
  console.log(`calibration cost so far: $${calibCostUSD} (${calibTokens.calls} calls)`)

  const calibVerdict: "PASS" | "FAIL" = jac.jaccard >= 0.7 ? "PASS" : "FAIL"
  console.log(`calibration verdict: ${calibVerdict}`)

  const ts = tsStamp()
  const isoTs = new Date().toISOString()
  const outPath = join(OUT_DIR, `crystal_shard.${ts}.try-fail-cycles.json`)

  const calibPayload = {
    sampleSize: calibSample.length,
    sampleKeys: calibSample.map((d) => `${d.book}|${d.chapter}`),
    jaccard: jac.jaccard,
    agreeRate: jac.agreeRate,
    classes: jac.classes,
    threshold: 0.7,
    verdict: calibVerdict,
    run1: Object.fromEntries(run1),
    run2: Object.fromEntries(run2),
    tokens: calibTokens,
    estCostUSD: calibCostUSD,
  }

  if (calibVerdict === "FAIL") {
    const failPayload = {
      pattern: "27",
      name: "Try/fail cycle structure across 3 IWD books",
      timestamp: isoTs,
      stage: "calibration_failed",
      reason: `Jaccard ${jac.jaccard.toFixed(3)} < 0.7 threshold; binary 'is_try_at_primary_goal' tag is too unstable to ship`,
      calibration: calibPayload,
      primary_goals: PRIMARY_GOALS,
      method: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        thinking: "disabled",
        temperature: 0,
        responseFormat: "json_object",
        binaryTag: "is_try_at_primary_goal",
        calibrationSample: "n=10 per book, evenly-spaced numeric chapters",
        notes:
          "Per the 2026-04-30 binary-collapse SOP, this rubric was bound to a binary y/n tag. Multi-class taxonomies were avoided to reduce subjective-axis instability. Despite the binary collapse, the rubric did not pass the J >= 0.7 ship gate.",
      },
    }
    writeFileSync(outPath, JSON.stringify(failPayload, null, 2))
    console.log(`wrote ${outPath}`)

    const md = `

## 2026-04-30 — Pattern 27 (Try/fail cycle structure) — METHODOLOGICAL NEGATIVE RESULT

### Methodology

For each of the 92 chapters across 3 Icewind Dale books, define a binary tag \`is_try_at_primary_goal\`: yes/no — does the chapter functionally advance the named book-level primary goal? Per-book primary goals: crystal_shard = defeat Akar Kessell + protect Ten-Towns; streams_of_silver = find Mithril Hall; halflings_gem = rescue Regis from Pasha Pook.

**Per the 2026-04-30 binary-collapse SOP** (mice rubric J<0.85 multi-class failure), this analysis was a-priori bound to a binary tag rather than the original try/fail/setback/escalation/success multi-class taxonomy.

**Calibration design.** Before running the full 92-chapter pass, a calibration check ran the same DeepSeek V4 Flash prompt twice (temperature 0, two independent API calls) on n=10 evenly-spaced numeric chapters per book = 30 chapters total. Ship gate: Jaccard >= 0.7 on the binary \`is_try\` agreement.

### Calibration result — FAIL

| Metric | Value |
|---|---|
| n | ${jac.n} |
| Agreement | ${jac.agree}/${jac.n} (${(jac.agreeRate * 100).toFixed(1)}%) |
| Jaccard | ${jac.jaccard.toFixed(3)} |
| Threshold | 0.7 |
| Verdict | **FAIL** |
| run1 true/false | ${jac.classes.true.run1}/${jac.classes.false.run1} |
| run2 true/false | ${jac.classes.true.run2}/${jac.classes.false.run2} |

### Conclusion + Action

The binary \`is_try_at_primary_goal\` tag is **too subjective to ship as a planner prior**, even after binary collapse. Two independent DeepSeek V4 Flash labelings of the same chapters disagreed on ${jac.n - jac.agree}/${jac.n} chapters; Jaccard ${jac.jaccard.toFixed(3)} < 0.7 ship gate.

This reproduces the failure mode from the mice rubric and the value-charge / mckee-gap multi-class probes from earlier in this session — chapter-level "is this a try at the primary goal" is genuinely ambiguous in the corpus, especially for:
- Mid-act villain-side scenes (counts? doesn't count?)
- Subgoal chapters that bear on the primary goal indirectly (gathering allies, training, intelligence-gathering)
- Aftermath / preparation / interlude chapters

**No harness target shipped.** This pattern does not produce a planner prior. Recorded as a **load-bearing methodological negative result** so future sessions don't re-discover it. If we want planner-side cycle structure as a prior, the next probe should bind to a more structurally-grounded signal (e.g., \`stakes_recalibration\` count thresholds, or chapter-level POV-vs-antagonist ratio) rather than a goal-relevance subjective binary.

### Cost & telemetry

- ${calibTokens.calls} calibration LLM calls, $${calibCostUSD.toFixed(4)} total
- ${calibTokens.prompt} prompt tokens / ${calibTokens.completion} completion tokens
- Full corpus pass NOT run (calibration gate failed)

Artifact: \`crystal_shard.${ts}.try-fail-cycles.json\`
Script: \`scripts/structure-calibration/try-fail-cycles.ts\`

---
`

    const existing = readFileSync(CONCLUSIONS_PATH, "utf8")
    writeFileSync(CONCLUSIONS_PATH, existing + md)
    console.log(`appended FAILURE conclusions section to ${CONCLUSIONS_PATH}`)
    console.log("\n=== STOPPING — calibration failed; full corpus pass not run ===")
    return
  }

  // ----- FULL PASS -----
  console.log("\n=== Calibration PASSED — full corpus labeling ===")
  // Reuse the calibration labels (run1) for the sample chapters; need only
  // label the residual 62 chapters.
  const sampleKeys = new Set(calibSample.map((d) => `${d.book}|${d.chapter}`))
  const residual = allDigests.filter((d) => !sampleKeys.has(`${d.book}|${d.chapter}`))
  console.log(`residual labeling: ${residual.length} chapters`)

  const residualLabels = await labelDigests(residual, key, 8)

  const allLabels = new Map<string, LlmLabel>()
  // Use run1 for sample chapters; residual labels for the rest
  for (const [k, v] of run1.entries()) allLabels.set(k, v)
  for (const [k, v] of residualLabels.entries()) allLabels.set(k, v)

  console.log(`total labels: ${allLabels.size}`)
  const totalTokens = { prompt: USAGE.prompt, completion: USAGE.completion, calls: USAGE.calls }
  const totalCost = estCostUSD(totalTokens.prompt, totalTokens.completion)
  console.log(`total cost: $${totalCost} (${totalTokens.calls} calls)`)

  // Per-book analysis
  const perBook = ["crystal_shard", "streams_of_silver", "halflings_gem"].map((book) =>
    analyzeBook(book, allDigests, allLabels),
  )

  // Cross-book directional comparison
  const triesPctValues = perBook.map((p) => p.triesPct)
  const triesPctRange = Math.max(...triesPctValues) - Math.min(...triesPctValues)
  const earlyMidLateRising = perBook.map((p) => p.earlyMidLateTryPct.late >= p.earlyMidLateTryPct.early - 5)
  const allLateRising = earlyMidLateRising.every((x) => x)
  const finalStreakAtEnd = perBook.map((p) => p.finalStreakIsLastChapter)
  const allFinalAtEnd = finalStreakAtEnd.every((x) => x)
  const stakesDirections = perBook.map((p) => p.finalAttemptDirection)
  const stakesAllRising = stakesDirections.every((d) => d === "rising")

  const directional = {
    triesPctRange,
    triesPctStable: triesPctRange <= 15,
    allLateRising,
    allFinalAtEnd,
    stakesDirections,
    stakesAllRising,
  }

  // Build output payload
  const successPayload = {
    pattern: "27",
    name: "Try/fail cycle structure across 3 IWD books",
    timestamp: isoTs,
    stage: "calibration_passed_full_pass_complete",
    primary_goals: PRIMARY_GOALS,
    calibration: calibPayload,
    method: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      thinking: "disabled",
      temperature: 0,
      responseFormat: "json_object",
      binaryTag: "is_try_at_primary_goal",
      cycleDef:
        "A 'try-streak' is a maximal run of consecutive numeric chapters labeled is_try=true. Each streak counts as one try-cycle unit.",
      stakeProxy: "chapter beats with boundary_signal == 'stakes_recalibration'",
      notes:
        "Calibration n=30 (10/book) gated on Jaccard>=0.7 binary agreement; full pass labels all 92 chapters. Special chapters (prelude/epilogue/parts) are labeled but excluded from cycle structure (numeric chapters only).",
    },
    perBook,
    aggregate: {
      tries_total: perBook.reduce((a, b) => a + b.triesN, 0),
      numeric_chapters_total: perBook.reduce((a, b) => a + b.numericChaptersN, 0),
      tryStreaks_total: perBook.reduce((a, b) => a + b.tryStreaks, 0),
    },
    directional,
    chapter_labels: Object.fromEntries(
      Array.from(allLabels.entries()).map(([k, v]) => {
        const dig = allDigests.find((d) => `${d.book}|${d.chapter}` === k)
        return [
          k,
          {
            ...v,
            position_in_book: dig?.position_in_book ?? null,
            stakes_recalibration_count: dig?.stakes_recalibration_count ?? null,
            total_beats: dig?.total_beats ?? null,
            total_words: dig?.total_words ?? null,
            is_special: dig?.is_special ?? false,
          },
        ]
      }),
    ),
    tokens: totalTokens,
    estCostUSD: totalCost,
  }

  writeFileSync(outPath, JSON.stringify(successPayload, null, 2))
  console.log(`wrote ${outPath}`)

  // Build conclusions markdown
  const fmt = (p: CycleStats) =>
    `${p.book} (numeric n=${p.numericChaptersN}): tries ${p.triesN} (${p.triesPct}%) · streaks ${p.tryStreaks} · mean-streak-len ${p.meanChaptersPerStreak} · mean-gap ${p.meanGapBetweenStreaks} · early/mid/late ${p.earlyMidLateTryPct.early}%/${p.earlyMidLateTryPct.mid}%/${p.earlyMidLateTryPct.late}% · stakes-density seq [${p.streakStakesSequence.join(", ")}] · final-attempt direction ${p.finalAttemptDirection} · final-streak-at-end ${p.finalStreakIsLastChapter}`

  const md = `

## 2026-04-30 — Pattern 27 (Try/fail cycle structure across 3 IWD books)

### Methodology

For each of 92 chapters across the 3 IWD books, label a binary tag \`is_try_at_primary_goal\` (yes/no) using DeepSeek V4 Flash (temperature 0, JSON-mode, thinking disabled). Per-book primary goals: crystal_shard = defeat Kessell + protect Ten-Towns; streams_of_silver = find Mithril Hall; halflings_gem = rescue Regis from Pasha Pook.

**Per the 2026-04-30 binary-collapse SOP**, this analysis was a-priori bound to a binary tag rather than the original try/fail/setback/escalation/success multi-class taxonomy.

**Calibration gate.** Before the full pass: 30 chapters (10 per book, evenly spaced numeric chapters), labeled twice via DeepSeek (same prompt, two independent API calls). **Calibration Jaccard = ${jac.jaccard.toFixed(3)}** (agreement ${jac.agree}/${jac.n} = ${(jac.agreeRate * 100).toFixed(1)}%) — **${calibVerdict}** vs the J>=0.7 ship gate. Class balance run1/run2: true=${jac.classes.true.run1}/${jac.classes.true.run2}, false=${jac.classes.false.run1}/${jac.classes.false.run2}.

**Cycle definition.** A *try-streak* is a maximal run of consecutive numeric chapters labeled \`is_try=true\` (i.e., consecutive try-chapters merged into a single attempt unit). Special chapters (prelude/epilogue/parts) are labeled but excluded from streak structure. Stake-density per try-streak uses \`boundary_signal == 'stakes_recalibration'\` beat counts as a proxy for in-chapter intensity.

### Per-book results

- ${fmt(perBook[0]!)}
- ${fmt(perBook[1]!)}
- ${fmt(perBook[2]!)}

### Cross-book directional verdict

| Property | crystal_shard | streams_of_silver | halflings_gem | Stable across all 3? |
|---|---|---|---|---|
| Try-rate (% chapters tagged TRY) | ${perBook[0]!.triesPct}% | ${perBook[1]!.triesPct}% | ${perBook[2]!.triesPct}% | ${directional.triesPctStable ? "Yes (range ≤15pt)" : "No (range " + directional.triesPctRange.toFixed(1) + "pt)"} |
| Try-streaks per book | ${perBook[0]!.tryStreaks} | ${perBook[1]!.tryStreaks} | ${perBook[2]!.tryStreaks} | — |
| Mean chapters per streak | ${perBook[0]!.meanChaptersPerStreak} | ${perBook[1]!.meanChaptersPerStreak} | ${perBook[2]!.meanChaptersPerStreak} | — |
| Mean gap (chapters) between streaks | ${perBook[0]!.meanGapBetweenStreaks} | ${perBook[1]!.meanGapBetweenStreaks} | ${perBook[2]!.meanGapBetweenStreaks} | — |
| Try-rate trends rising late→early? | ${perBook[0]!.earlyMidLateTryPct.early}→${perBook[0]!.earlyMidLateTryPct.mid}→${perBook[0]!.earlyMidLateTryPct.late}% | ${perBook[1]!.earlyMidLateTryPct.early}→${perBook[1]!.earlyMidLateTryPct.mid}→${perBook[1]!.earlyMidLateTryPct.late}% | ${perBook[2]!.earlyMidLateTryPct.early}→${perBook[2]!.earlyMidLateTryPct.mid}→${perBook[2]!.earlyMidLateTryPct.late}% | ${directional.allLateRising ? "Late tier ≥ early tier in all 3" : "Mixed"} |
| Final streak ends on last chapter? | ${perBook[0]!.finalStreakIsLastChapter} | ${perBook[1]!.finalStreakIsLastChapter} | ${perBook[2]!.finalStreakIsLastChapter} | ${directional.allFinalAtEnd ? "Yes" : "No"} |
| Stakes-density direction (first→last streak) | ${perBook[0]!.finalAttemptDirection} | ${perBook[1]!.finalAttemptDirection} | ${perBook[2]!.finalAttemptDirection} | ${directional.stakesAllRising ? "All rising" : "Mixed"} |

### Conclusion + Action

${
  directional.triesPctStable && directional.allFinalAtEnd
    ? "**Directionally stable cross-book signal** on (a) try-rate and (b) final-attempt-at-end. The try/fail cycle structure in Salvatore IWD trilogy is consistent enough to ship as a planner prior."
    : "**Mixed directional signal.** Some axes are stable across books, others vary — see table above."
} The harness target depends on which axes shipped as stable:

- **Try-rate prior:** target ~${(perBook.reduce((a, b) => a + b.triesPct, 0) / 3).toFixed(0)}% of chapters labeled as TRY (corpus mean across 3 books). Planner can encode this as a soft prior on chapter \`purpose\` — N% of chapters should describe primary-goal-advancing action.
- **Final-attempt-at-end:** ${directional.allFinalAtEnd ? "shipped — every IWD book's last numeric chapter is part of the final try-streak. Plotter should land its final TRY chapter at the end of the chapter list (currently no explicit prior)." : "NOT shipped — varies by book."}
- **Streak structure (mean ${(perBook.reduce((a, b) => a + b.meanChaptersPerStreak, 0) / 3).toFixed(1)} chapters per try-streak, mean gap ${(perBook.reduce((a, b) => a + b.meanGapBetweenStreaks, 0) / 3).toFixed(1)} chapters):** Salvatore alternates blocks of try-chapters with non-try-chapters (subplot/villain/setup); planner could encode an alternation prior at the chapter-skeleton level, but cross-book stability of streak length is mixed.
- **Stakes-density per streak:** ${directional.stakesAllRising ? "all 3 books show rising stakes density from first to final streak — escalation is corpus-real and could ship as a complement to Pattern 20 (within-chapter stakes-escalation curve)." : "directions diverge across books; do NOT ship as a planner prior."}

### Cost & telemetry

- ${totalTokens.calls} LLM calls (${calibTokens.calls} calibration + ${totalTokens.calls - calibTokens.calls} residual)
- $${totalCost.toFixed(4)} total cost
- ${totalTokens.prompt} prompt tokens / ${totalTokens.completion} completion tokens

Artifact: \`crystal_shard.${ts}.try-fail-cycles.json\`
Script: \`scripts/structure-calibration/try-fail-cycles.ts\`

---
`

  const existing = readFileSync(CONCLUSIONS_PATH, "utf8")
  writeFileSync(CONCLUSIONS_PATH, existing + md)
  console.log(`appended SUCCESS conclusions section to ${CONCLUSIONS_PATH}`)
  console.log("\n=== Done ===")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
