/**
 * Validation: do the revised events + character prompts fix the Sonnet
 * calibration gap we measured in the production eval?
 *
 * Runs 235B oracle + Sonnet-as-teacher on the SAME production pairs using:
 *   - OLD prompts (copied verbatim from adherence-checker.ts)
 *   - NEW prompts (revised scope)
 *
 * For each call type (events, character), reports:
 *   agreement(Sonnet-old, oracle) vs agreement(Sonnet-new, oracle)
 *
 * If new > old by meaningful margin → prompt fix confirmed, proceed to re-label.
 */
import db from "../data/connection.ts"
import { getTransport } from "../src/transport.ts"

const ORACLE = { provider: "cerebras" as const, model: "qwen-3-235b-a22b-instruct-2507" }
const SONNET = { provider: "openrouter" as const, model: "anthropic/claude-sonnet-4-5" }

// ── OLD PROMPTS (verbatim from production adherence-checker.ts) ──────────

const EVENTS_OLD = `You verify whether the prose ENACTS a specific scene beat on-page.

Find the passage where the beat's action happens — characters performing the action, dialogue, narration of the action as it occurs in scene.

Rules:
- "Enacted" means the action happens IN SCENE during this prose. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized in narration as backstory) does NOT count as enacted.
- Characters being merely present in the scene is NOT enough — the beat's specific action must occur.
- If you cannot find a passage where the beat is enacted, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

const CHARACTER_OLD = `You verify whether characters in the prose behave consistently with their roles in a scene beat.

A character "acts contrary to their role" when they do something the beat says they should NOT do, or when they take an action that reverses the beat's intended dynamic (e.g., the beat calls for the character to refuse but the prose has them immediately agree, or the beat calls for confrontation but the prose has them stay silent).

Do NOT flag normal creative interpretation: dialogue rewording, gesture additions, emotional shading, or pacing variation. Only flag clear contradictions.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where contradiction occurs, or empty string>",
  "reasoning": "<one sentence>"
}`

// ── NEW PROMPTS (revised scope) ───────────────────────────────────────────

const EVENTS_NEW = `You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- If ANY key action from the beat is missing, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage proving enactment, or description of what is missing>",
  "reasoning": "<one sentence>"
}`

const CHARACTER_NEW = `You verify whether the characters in the prose match what the beat specifies for them.

Check each of the following:

1. PRESENCE — Every character named in the beat appears in the prose. No major named characters appear who are absent from the beat (unnamed background extras are fine).

2. ACTIONS — Each character performs what the beat says they do. If the beat says a character refuses, the prose shows refusal — not acceptance or silence. If the beat says a character reads a note, the prose shows them reading it — not skipping past it.

3. DYNAMICS — The interpersonal dynamic matches the beat's intent. Confrontation means confrontation — not friendly agreement. Comfort means comfort — not indifference. A character described as laughing lightly should not laugh harshly.

4. PHYSICAL CONSISTENCY — No character does something impossible given the beat's setup. Examples: holding an object they already gave away, moving freely when the beat says they are restrained, being present in a scene after the beat says they left.

What is NOT a character mismatch — do NOT flag:
- Dialogue rewording or paraphrase (same meaning, different words)
- Added gestures, body language, or sensory detail
- Emotional depth or interiority beyond what the beat specifies
- Atmospheric or pacing additions
- Slight tonal variation that preserves the beat's intent

Return character_contradiction=true if ANY of the four checks above fails.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where mismatch occurs, or empty string>",
  "reasoning": "<one sentence>"
}`

// ── Pairs ─────────────────────────────────────────────────────────────────

async function getPairs(limit: number) {
  const chapters = await db`
    SELECT cd.chapter_number, cd.prose, co.outline_json
    FROM chapter_drafts cd
    JOIN chapter_outlines co ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
    WHERE cd.status = 'approved'
    ORDER BY RANDOM()
    LIMIT ${limit}
  `
  const pairs: Array<{ beatDesc: string; chars: string; setting: string; prose: string; label: string }> = []
  for (const ch of chapters as any[]) {
    const outline = typeof ch.outline_json === "string" ? JSON.parse(ch.outline_json) : ch.outline_json
    const scenes = outline?.scenes || []
    const paragraphs = (ch.prose as string).split("\n\n").filter((p: string) => p.trim())
    if (!scenes.length || !paragraphs.length) continue
    const parasPerBeat = Math.ceil(paragraphs.length / scenes.length)
    for (let i = 0; i < Math.min(scenes.length, 3); i++) {
      const start = i * parasPerBeat
      const prose = paragraphs.slice(start, Math.min(start + parasPerBeat, paragraphs.length)).join("\n\n").slice(0, 2000)
      if (prose.length < 50) continue
      pairs.push({
        beatDesc: scenes[i]?.description || JSON.stringify(scenes[i]),
        chars: (scenes[i]?.characters || []).join(", "),
        setting: outline?.setting || "",
        prose,
        label: `ch${ch.chapter_number}/beat${i}`,
      })
    }
  }
  return pairs
}

type CallType = "events" | "character"

async function call(
  callType: CallType,
  system: string,
  pair: Awaited<ReturnType<typeof getPairs>>[number],
  model: typeof ORACLE,
): Promise<any> {
  const transport = getTransport()
  const userPrompt = callType === "events"
    ? `BEAT: ${pair.beatDesc}\nCHARACTERS EXPECTED: ${pair.chars}\n\nPROSE:\n---\n${pair.prose}\n---`
    : `BEAT: ${pair.beatDesc}\nCHARACTERS EXPECTED: ${pair.chars}\n\nPROSE:\n---\n${pair.prose}\n---`
  try {
    const res = await transport.execute({
      systemPrompt: system,
      userPrompt,
      model: model.model,
      provider: model.provider,
      temperature: 0.1,
      maxTokens: 512,
      responseFormat: { type: "json_object" },
    })
    return JSON.parse(res.content)
  } catch {
    return { _error: true }
  }
}

function getFlag(callType: CallType, result: any): boolean | undefined {
  if (!result || result._error) return undefined
  return callType === "events" ? result.events_present : result.character_contradiction
}

async function runComparison(callType: CallType, oldPrompt: string, newPrompt: string, pairs: Awaited<ReturnType<typeof getPairs>>) {
  let oldAgree = 0, newAgree = 0, total = 0
  let oldFP = 0, oldFN = 0, newFP = 0, newFN = 0

  const disagreements: Array<{ label: string; oracle: boolean; old: boolean | undefined; new: boolean | undefined; oldReason: string; newReason: string }> = []

  for (const pair of pairs) {
    const [oracleRes, oldRes, newRes] = await Promise.all([
      call(callType, callType === "events" ? EVENTS_OLD : CHARACTER_OLD, pair, ORACLE), // oracle uses OLD prompt (our established ground truth)
      call(callType, oldPrompt, pair, SONNET),
      call(callType, newPrompt, pair, SONNET),
    ])

    const oFlag = getFlag(callType, oracleRes)
    const oldFlag = getFlag(callType, oldRes)
    const newFlag = getFlag(callType, newRes)

    if (oFlag === undefined || oldFlag === undefined || newFlag === undefined) continue
    total++

    if (oldFlag === oFlag) oldAgree++
    else {
      if (oldFlag && !oFlag) oldFP++
      if (!oldFlag && oFlag) oldFN++
    }

    if (newFlag === oFlag) newAgree++
    else {
      if (newFlag && !oFlag) newFP++
      if (!newFlag && oFlag) newFN++
      disagreements.push({
        label: pair.label,
        oracle: oFlag,
        old: oldFlag,
        new: newFlag,
        oldReason: oldRes.reasoning || "",
        newReason: newRes.reasoning || "",
      })
    }
  }

  const pct = (n: number) => total ? `${Math.round(n / total * 100)}%` : "n/a"

  console.log(`\n═══ ${callType.toUpperCase()} CALL ═══`)
  console.log(`pairs: ${total}`)
  console.log(`Sonnet OLD prompt: ${oldAgree}/${total} (${pct(oldAgree)})  FP:${oldFP}  FN:${oldFN}`)
  console.log(`Sonnet NEW prompt: ${newAgree}/${total} (${pct(newAgree)})  FP:${newFP}  FN:${newFN}`)
  console.log(`delta: ${newAgree - oldAgree > 0 ? "+" : ""}${newAgree - oldAgree} (${pct(newAgree - oldAgree)} improvement)`)

  if (disagreements.length > 0) {
    console.log(`\nNew-prompt disagreements with oracle (${disagreements.length}):`)
    for (const d of disagreements.slice(0, 6)) {
      console.log(`  ${d.label}: oracle=${d.oracle} new=${d.new}`)
      console.log(`    new reasoning: ${d.newReason.slice(0, 120)}`)
    }
  }
}

async function main() {
  console.log("Fetching 15 chapters...")
  const pairs = await getPairs(15)
  console.log(`Got ${pairs.length} beat/prose pairs\n`)

  await runComparison("character", CHARACTER_OLD, CHARACTER_NEW, pairs)
  await runComparison("events", EVENTS_OLD, EVENTS_NEW, pairs)

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
