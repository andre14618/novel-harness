/**
 * Rhythm monotony fixer.
 *
 * Identifies monotonous sentence windows in prose and rewrites them
 * with varied rhythm. Works directly with the prose text — no dependency
 * on LintIssue structure (which wasn't designed for window-level fixes).
 *
 * Approach:
 *   1. Split prose into narration sentences (exclude dialogue)
 *   2. Slide a window, compute CV per window
 *   3. For windows below threshold: extract the text span
 *   4. Send to LLM: "Rewrite with varied rhythm, preserve content"
 *   5. Replace the span in the original prose
 *   6. Skip windows that overlap already-fixed regions
 */

import { getTransport } from "../transport"

interface RhythmFixResult {
  prose: string
  windowsFixed: number
  windowsSkipped: number
  llmCalls: number
  costUsd: number
}

// ── Sentence splitting (dialogue-aware) ───────────────────────────────────

function isInDialogue(text: string, position: number): boolean {
  let inQuote = false
  for (let i = 0; i < position && i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === '\u201C' || ch === '\u201D') {
      if (ch === '\u201C') inQuote = true
      else if (ch === '\u201D') inQuote = false
      else inQuote = !inQuote
    }
  }
  return inQuote
}

interface Span { text: string; start: number; end: number; words: number; isDialogue: boolean }

function splitToSpans(prose: string): Span[] {
  const spans: Span[] = []
  const re = /[^.!?\n]+[.!?\n]*/g
  let match: RegExpExecArray | null
  while ((match = re.exec(prose)) !== null) {
    const text = match[0].trim()
    if (text.length < 3) continue
    spans.push({
      text,
      start: match.index,
      end: match.index + match[0].length,
      words: text.split(/\s+/).filter(Boolean).length,
      isDialogue: isInDialogue(prose, match.index),
    })
  }
  return spans
}

function cv(arr: number[]): number {
  if (arr.length < 2) return 999
  const m = arr.reduce((a, b) => a + b, 0) / arr.length
  if (m === 0) return 0
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
  return std / m
}

// ── Main fixer ────────────────────────────────────────────────────────────

export async function fixRhythm(
  prose: string,
  llmConfig: { provider: string; model: string; temperature?: number },
  options: { windowSize?: number; threshold?: number; maxFixes?: number } = {},
): Promise<RhythmFixResult> {
  const { windowSize = 8, threshold = 0.30, maxFixes = 3 } = options
  const spans = splitToSpans(prose)
  const narration = spans.filter(s => !s.isDialogue)

  if (narration.length < windowSize) {
    return { prose, windowsFixed: 0, windowsSkipped: 0, llmCalls: 0, costUsd: 0 }
  }

  // Find monotonous windows
  const monotonousWindows: { start: number; end: number; cvVal: number; sentences: Span[] }[] = []
  for (let i = 0; i <= narration.length - windowSize; i += Math.floor(windowSize / 2)) {
    const window = narration.slice(i, i + windowSize)
    const wordCounts = window.map(s => s.words)
    const cvVal = cv(wordCounts)

    if (cvVal < threshold) {
      monotonousWindows.push({
        start: window[0].start,
        end: window[window.length - 1].end,
        cvVal,
        sentences: window,
      })
    }
  }

  if (monotonousWindows.length === 0) {
    return { prose, windowsFixed: 0, windowsSkipped: 0, llmCalls: 0, costUsd: 0 }
  }

  // Deduplicate overlapping windows — keep the worst CV (most monotonous)
  const deduplicated: typeof monotonousWindows = []
  for (const w of monotonousWindows.sort((a, b) => a.cvVal - b.cvVal)) {
    const overlaps = deduplicated.some(d =>
      (w.start >= d.start && w.start < d.end) || (w.end > d.start && w.end <= d.end)
    )
    if (!overlaps) deduplicated.push(w)
  }

  // Fix worst windows first, up to maxFixes
  let result = prose
  let windowsFixed = 0
  let windowsSkipped = 0
  let llmCalls = 0
  let costUsd = 0
  let offsetShift = 0 // track how replacements shift positions

  for (const window of deduplicated.slice(0, maxFixes)) {
    const adjStart = window.start + offsetShift
    const adjEnd = window.end + offsetShift
    const windowText = result.slice(adjStart, adjEnd)

    if (windowText.length < 50) { windowsSkipped++; continue }

    const wordCounts = window.sentences.map(s => s.words)

    try {
      const response = await getTransport().execute({
        systemPrompt: `Rewrite this passage to vary sentence rhythm. The current sentences are all similar length (${wordCounts.join(", ")} words each, CV=${window.cvVal.toFixed(2)}).

RULES:
- Mix short punchy sentences (2-5 words) with longer flowing ones (20-30 words)
- Use at least one fragment for emphasis
- Break one compound sentence into two short ones
- Merge two short sentences into one flowing sentence
- PRESERVE all content: every character, action, detail, and meaning must remain
- Return JSON: {"rewritten": "the rewritten passage"}`,
        userPrompt: windowText,
        model: llmConfig.model,
        provider: llmConfig.provider as any,
        temperature: llmConfig.temperature ?? 0.4,
        maxTokens: 2048,
        responseFormat: { type: "json_object" },
      })

      llmCalls++
      const promptTokens = response.usage?.prompt_tokens ?? 0
      const completionTokens = response.usage?.completion_tokens ?? 0
      const { getTokenCost } = await import("../../models/registry")
      costUsd += getTokenCost(llmConfig.provider as any, llmConfig.model, promptTokens, completionTokens)

      let rewritten: string
      try {
        const json = JSON.parse(response.content)
        rewritten = (json.rewritten ?? json.fixed ?? json.text ?? "").trim()
      } catch { windowsSkipped++; continue }

      if (!rewritten || rewritten.length < 30) { windowsSkipped++; continue }

      // Validate: length within 20%, content roughly preserved
      const lengthDelta = Math.abs(rewritten.length - windowText.length) / windowText.length
      if (lengthDelta > 0.20) { windowsSkipped++; continue }

      // Verify the rewrite actually varies rhythm
      const newSpans = splitToSpans(rewritten).filter(s => !s.isDialogue)
      const newCv = cv(newSpans.map(s => s.words))
      if (newCv <= window.cvVal) { windowsSkipped++; continue } // didn't improve

      result = result.slice(0, adjStart) + rewritten + result.slice(adjEnd)
      offsetShift += rewritten.length - windowText.length
      windowsFixed++

    } catch { windowsSkipped++ }
  }

  return { prose: result, windowsFixed, windowsSkipped: windowsSkipped + Math.max(0, deduplicated.length - maxFixes), llmCalls, costUsd }
}
