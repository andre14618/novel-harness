/**
 * LLM per-sentence lint fixer.
 *
 * Sends each flagged sentence to an LLM with scene context.
 * Returns JSON {fixed: "..."} for reliable extraction.
 * Skips dialogue lines. Validates fixes preserve content.
 */

import { getTransport } from "../../transport"
import type { LintIssue } from "../types"

interface FixConfig {
  provider: string
  model: string
  temperature?: number
}

interface PerSentenceResult {
  prose: string
  fixed: number
  unfixed: number
  llmCalls: number
  costUsd: number
}

export async function applyPerSentenceFixes(
  prose: string,
  issues: LintIssue[],
  config: FixConfig,
): Promise<PerSentenceResult> {
  let result = prose
  let fixed = 0
  let unfixed = 0
  let llmCalls = 0
  let costUsd = 0

  // Process in reverse offset order so replacements don't shift later positions
  const sorted = [...issues].sort((a, b) => b.charOffset - a.charOffset)

  for (const issue of sorted) {
    // Skip dialogue lines (dialogue has its own voice)
    const isDialogueLine = issue.sentence.trim().startsWith('"') || issue.sentence.trim().startsWith('\u201C')
    if (isDialogueLine) { unfixed++; continue }

    // Find the sentence in current text
    const sentenceIdx = result.indexOf(issue.sentence)
    if (sentenceIdx === -1) { unfixed++; continue }

    // Extract surrounding context (1 paragraph before and after)
    const before = result.lastIndexOf("\n\n", sentenceIdx)
    const afterEnd = result.indexOf("\n\n", sentenceIdx + issue.sentence.length)
    const contextStart = before !== -1 ? before : Math.max(0, sentenceIdx - 300)
    const contextEnd = afterEnd !== -1 ? Math.min(result.length, afterEnd) : Math.min(result.length, sentenceIdx + issue.sentence.length + 300)
    const context = result.slice(contextStart, contextEnd).trim()

    try {
      const response = await getTransport().execute({
        systemPrompt: `Fix ONLY the flagged pattern in the target sentence. Rules:
- If the sentence contains dialogue (quoted text), preserve all dialogue exactly — only change the narrative part.
- Do NOT add or remove quotation marks.
- Do NOT duplicate any text.
- The fix should be minimal — change as few words as possible.
- Preserve the sentence's meaning, all character names, objects, and actions.
Return JSON: {"fixed": "the corrected sentence"}`,
        userPrompt: `PATTERN TO FIX: "${issue.match}" → ${issue.fixTemplate.slice(0, 150)}\n\nCONTEXT:\n${context}\n\nSENTENCE TO FIX:\n${issue.sentence}`,
        model: config.model,
        provider: config.provider as any,
        temperature: config.temperature ?? 0.2,
        maxTokens: 512,
        responseFormat: { type: "json_object" },
      })

      let fixedText: string
      try {
        const json = JSON.parse(response.content)
        fixedText = (json.fixed ?? json.sentence ?? "").trim()
      } catch { unfixed++; continue }
      llmCalls++

      const promptTokens = response.usage?.prompt_tokens ?? 0
      const completionTokens = response.usage?.completion_tokens ?? 0
      const { getTokenCost } = await import("../../../models/registry")
      costUsd += getTokenCost(config.provider as any, config.model, promptTokens, completionTokens)

      // Validate
      if (!fixedText || fixedText === issue.sentence) { unfixed++; continue }
      if (fixedText.length > issue.sentence.length * 1.5 || fixedText.length < issue.sentence.length * 0.5) { unfixed++; continue }

      // Reject duplicated phrases
      const words = fixedText.split(/\s+/)
      const trigrams = words.slice(2).map((w, i) => `${words[i]} ${words[i + 1]} ${w}`)
      const hasDupes = trigrams.some((t, i) => trigrams.indexOf(t) !== i && t.split(/\s+/).every(w => w.length > 2))
      if (hasDupes) { unfixed++; continue }

      // Reject if quotes were added/removed
      const origQuotes = (issue.sentence.match(/["\u201C\u201D]/g) || []).length
      const fixQuotes = (fixedText.match(/["\u201C\u201D]/g) || []).length
      if (origQuotes !== fixQuotes) { unfixed++; continue }

      // Apply
      result = result.slice(0, sentenceIdx) + fixedText + result.slice(sentenceIdx + issue.sentence.length)
      fixed++

    } catch {
      unfixed++
    }
  }

  return { prose: result, fixed, unfixed, llmCalls, costUsd }
}
