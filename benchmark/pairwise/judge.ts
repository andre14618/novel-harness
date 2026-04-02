/**
 * Pairwise comparison judge.
 *
 * Given two prose passages for the same scene, determines which is better.
 * Runs each matchup twice (A-first, B-first) to detect position bias.
 */

import { readFileSync } from "node:fs"
import { extractJSON } from "../../src/llm"
import { z } from "zod"
import type { JudgeConfig } from "../config"

const RUBRIC = readFileSync(new URL("./rubric.md", import.meta.url).pathname, "utf-8")

const pairwiseSchema = z.object({
  winner: z.enum(["A", "B", "tie"]),
  confidence: z.enum(["strong", "slight", "tie"]),
  reasoning: z.string(),
})

export type PairwiseResult = z.infer<typeof pairwiseSchema>

export interface MatchupResult {
  /** Result when prose1 = A, prose2 = B */
  forward: PairwiseResult | null
  /** Result when prose1 = B, prose2 = A (labels flipped) */
  reverse: PairwiseResult | null
  /** Canonical winner (accounting for both orderings): 'first', 'second', 'tie', or 'inconsistent' */
  canonical: "first" | "second" | "tie" | "inconsistent"
}

async function callJudge(
  judge: JudgeConfig, proseA: string, proseB: string,
): Promise<{ result: PairwiseResult | null; latencyMs: number }> {
  const start = performance.now()

  const tokenParam = judge.useMaxCompletionTokens
    ? { max_completion_tokens: 2048 }
    : { max_tokens: 2048 }

  try {
    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(judge.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${judge.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: judge.model,
          messages: [
            {
              role: "system",
              content: `${RUBRIC}\n\n---\n\n## Passage A\n\n${proseA}\n\n---\n\n## Passage B\n\n${proseB}`,
            },
            {
              role: "user",
              content: "Compare the two passages above. Which is better? Return the JSON result.",
            },
          ],
          temperature: 0.1,
          ...tokenParam,
          response_format: { type: "json_object" },
          ...judge.extraBody,
        }),
      })
      if (res!.status === 429 || res!.status === 503) {
        if (attempt < 2) { await Bun.sleep(3000 * (attempt + 1)); continue }
      }
      break
    }

    const latencyMs = Math.round(performance.now() - start)

    if (!res!.ok) {
      const text = await res!.text()
      console.log(`  ! pairwise [http ${res!.status}] ${text.slice(0, 100)}`)
      return { result: null, latencyMs }
    }

    const data = await res!.json() as any
    if (data.error) {
      console.log(`  ! pairwise [api] ${JSON.stringify(data.error).slice(0, 100)}`)
      return { result: null, latencyMs }
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.log(`  ! pairwise [empty]`)
      return { result: null, latencyMs }
    }

    let jsonStr: string
    try { jsonStr = extractJSON(content) }
    catch { console.log(`  ! pairwise [json] extraction failed`); return { result: null, latencyMs } }

    let parsed: any
    try { parsed = JSON.parse(jsonStr) }
    catch { console.log(`  ! pairwise [parse] invalid JSON`); return { result: null, latencyMs } }

    const zodResult = pairwiseSchema.safeParse(parsed)
    if (!zodResult.success) {
      console.log(`  ! pairwise [zod] ${zodResult.error.issues.map(i => i.message).join("; ").slice(0, 100)}`)
      return { result: null, latencyMs }
    }

    return { result: zodResult.data, latencyMs }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    console.log(`  ! pairwise [exception] ${err instanceof Error ? err.message : err}`)
    return { result: null, latencyMs }
  }
}

/**
 * Run a pairwise matchup with position-bias detection.
 *
 * Calls the judge twice: once with prose1=A/prose2=B, once reversed.
 * Returns canonical winner accounting for both orderings.
 */
export async function runMatchup(
  judge: JudgeConfig, prose1: string, prose2: string,
): Promise<MatchupResult> {
  // Forward: prose1=A, prose2=B
  const fwd = await callJudge(judge, prose1, prose2)

  // Small delay to avoid rate limits
  await Bun.sleep(500)

  // Reverse: prose2=A, prose1=B
  const rev = await callJudge(judge, prose2, prose1)

  // Determine canonical winner
  let canonical: MatchupResult["canonical"]

  if (!fwd.result || !rev.result) {
    canonical = "tie" // can't determine without both
  } else {
    // Normalize: map forward winner to 'first'/'second'/'tie'
    const fwdWinner = fwd.result.winner === "A" ? "first" : fwd.result.winner === "B" ? "second" : "tie"
    // Reverse is flipped: A in reverse = prose2 = second, B in reverse = prose1 = first
    const revWinner = rev.result.winner === "A" ? "second" : rev.result.winner === "B" ? "first" : "tie"

    if (fwdWinner === revWinner) {
      canonical = fwdWinner
    } else if (fwdWinner === "tie" || revWinner === "tie") {
      // One tie + one winner → marginal win
      canonical = fwdWinner === "tie" ? revWinner : fwdWinner
    } else {
      // Direct contradiction (one says first, other says second)
      canonical = "inconsistent"
    }
  }

  return {
    forward: fwd.result,
    reverse: rev.result ? {
      // Flip the reverse result labels back so it reads from prose1/prose2 perspective
      winner: rev.result.winner === "A" ? "B" : rev.result.winner === "B" ? "A" : "tie",
      confidence: rev.result.confidence,
      reasoning: rev.result.reasoning,
    } : null,
    canonical,
  }
}
