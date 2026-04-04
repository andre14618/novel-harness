/**
 * Hybrid lint fixer: deterministic replacements where possible,
 * LLM per-sentence for patterns that need judgment.
 *
 * Deterministic fixes handle subtractive patterns (remove a word/phrase).
 * LLM fixes handle creative replacements (AI clichés, declared emotions).
 */

import { getTransport } from "../transport"
import { extractJSON } from "../llm"
import type { LintIssue } from "./index"

// ── Deterministic fix rules ───────────────────────────────────────────
// Each rule maps a category + regex to a replacement function.
// The function receives the matched text and returns the fix.
// Returns null if deterministic fix isn't possible for this match.

interface DetFix {
  category: string
  pattern: RegExp
  fix: (match: string, sentence: string) => string | null
}

const DETERMINISTIC_FIXES: DetFix[] = [
  // FILLER_PHRASE — simple substitutions
  { category: "FILLER_PHRASE", pattern: /\bdue to the fact that\b/gi, fix: () => "because" },
  { category: "FILLER_PHRASE", pattern: /\bin spite of the fact that\b/gi, fix: () => "although" },
  { category: "FILLER_PHRASE", pattern: /\bat this point in time\b/gi, fix: () => "now" },
  { category: "FILLER_PHRASE", pattern: /\bfor the purpose of\b/gi, fix: () => "to" },
  { category: "FILLER_PHRASE", pattern: /\bhas the ability to\b/gi, fix: () => "can" },
  { category: "FILLER_PHRASE", pattern: /\bin order to\b/gi, fix: () => "to" },
  { category: "FILLER_PHRASE", pattern: /\bthe fact that\b/gi, fix: () => null }, // needs context — LLM

  // FILLER_PHRASE — revving-up verbs: "began to run" → "ran"
  // Too context-dependent for deterministic — sometimes "began to" is intentional. → LLM

  // REDUNDANT_ADVERB_VERB — remove the adverb
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bwhispered\s+softly\b/gi, fix: () => "whispered" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bshouted\s+loudly\b/gi, fix: () => "shouted" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bscreamed\s+loudly\b/gi, fix: () => "screamed" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bmurmured\s+softly\b/gi, fix: () => "murmured" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bcrept\s+quietly\b/gi, fix: () => "crept" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bstrolled\s+leisurely\b/gi, fix: () => "strolled" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bgripped\s+firmly\b/gi, fix: () => "gripped" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\brushed\s+quickly\b/gi, fix: () => "rushed" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bhurried\s+quickly\b/gi, fix: () => "hurried" },

  // REDUNDANT_BODY — remove the redundant part
  { category: "REDUNDANT_BODY", pattern: /\bnodded\s+(his|her|their)\s+head/gi, fix: () => "nodded" },
  { category: "REDUNDANT_BODY", pattern: /\bshrugged\s+(his|her|their)\s+shoulders/gi, fix: () => "shrugged" },
  { category: "REDUNDANT_BODY", pattern: /\bblinked\s+(his|her|their)\s+eyes/gi, fix: () => "blinked" },
  { category: "REDUNDANT_BODY", pattern: /\bsat\s+down\b/gi, fix: () => "sat" },
  { category: "REDUNDANT_BODY", pattern: /\breturned\s+back\b/gi, fix: () => "returned" },
  { category: "REDUNDANT_BODY", pattern: /\brose\s+up\b/gi, fix: () => "rose" },

  // "stood up" — needs subject check, pattern includes pronoun
  { category: "REDUNDANT_BODY", pattern: /\bstood\s+up\b/gi, fix: () => "stood" },

  // FILTER_WORD — remove the filter, keep the perception
  { category: "FILTER_WORD", pattern: /\bcould\s+feel\b/gi, fix: () => "felt" },
  { category: "FILTER_WORD", pattern: /\bcould\s+see\b/gi, fix: () => "saw" },
  { category: "FILTER_WORD", pattern: /\bcould\s+hear\b/gi, fix: () => "heard" },
  { category: "FILTER_WORD", pattern: /\bcould\s+smell\b/gi, fix: () => "smelled" },
  { category: "FILTER_WORD", pattern: /\bcould\s+taste\b/gi, fix: () => "tasted" },
  { category: "FILTER_WORD", pattern: /\bseemed\s+to\b/gi, fix: () => "" },

  // HEDGE_QUALIFIER — simple removals
  { category: "HEDGE_QUALIFIER", pattern: /\bcouldn't\s+help\s+but\b/gi, fix: () => "" },
  { category: "HEDGE_QUALIFIER", pattern: /\b(sort|kind)\s+of\b/gi, fix: () => "" },
  { category: "HEDGE_QUALIFIER", pattern: /\bsomething\s+(like|akin\s+to)\b/gi, fix: () => "" },
  { category: "HEDGE_QUALIFIER", pattern: /\balmost\s+as\s+if\b/gi, fix: () => "as if" },
  { category: "HEDGE_QUALIFIER", pattern: /\bit\s+was\s+as\s+(though|if)\b/gi, fix: () => null }, // needs restructure → LLM

  // EMPTY_TRANSITION — cut the transition word
  { category: "EMPTY_TRANSITION", pattern: /(?:^|(?<=\.\s{1,2}))And then\b/gi, fix: () => "" },
  { category: "EMPTY_TRANSITION", pattern: /(?:^|(?<=\.\s{1,2}))After that\b/gi, fix: () => "" },
  { category: "EMPTY_TRANSITION", pattern: /(?:^|(?<=\.\s{1,2}))All of a sudden\b/gi, fix: () => "" },

  // SAID_BOOKISM — replace with "said"
  { category: "SAID_BOOKISM", pattern: /\b(exclaimed|proclaimed|declared|announced|stated|remarked|uttered|intoned|opined|asserted)\b/gi, fix: () => "said" },
  // said + adverb — remove the adverb
  { category: "SAID_BOOKISM", pattern: /\bsaid\s+(softly|loudly|quietly|angrily|sadly|happily|nervously|anxiously|cheerfully|sarcastically|bitterly|wearily|eagerly|reluctantly|firmly|gently|coldly|warmly)\b/gi, fix: () => "said" },
]

// ── Deterministic fixer ───────────────────────────────────────────────

export interface FixResult {
  prose: string
  deterministicFixes: number
  llmFixes: number
  llmCalls: number
  unfixed: number
  totalIssues: number
  costUsd: number
  latencyMs: number
}

export async function fixLintIssues(
  prose: string,
  issues: LintIssue[],
  llmConfig?: { provider: string; model: string; temperature?: number },
): Promise<FixResult> {
  let result = prose
  let deterministicFixes = 0
  let unfixed = 0
  const needsLlm: LintIssue[] = []
  const totalStart = Date.now()

  // Pass 1: deterministic fixes (applied directly to the text)
  for (const issue of issues) {
    let fixed = false
    for (const rule of DETERMINISTIC_FIXES) {
      if (issue.category !== rule.category) continue
      if (!rule.pattern.test(issue.match)) continue

      const replacement = rule.fix(issue.match, issue.sentence)
      if (replacement === null) { break } // this pattern needs LLM

      // Apply fix in the original sentence context to avoid false matches
      const sentenceIdx = result.indexOf(issue.sentence)
      if (sentenceIdx === -1) continue

      const originalSentence = result.slice(sentenceIdx, sentenceIdx + issue.sentence.length)
      const fixedSentence = originalSentence.replace(new RegExp(escapeRegex(issue.match), "i"), replacement)

      if (fixedSentence !== originalSentence) {
        result = result.slice(0, sentenceIdx) + fixedSentence + result.slice(sentenceIdx + issue.sentence.length)
        deterministicFixes++
        fixed = true
      }
      break
    }

    if (!fixed) {
      // Rhythm/paragraph issues can't be fixed per-sentence — skip for now
      if (issue.category === "RHYTHM_MONOTONY" || issue.category === "PARAGRAPH_HOMOGENEITY") {
        unfixed++
      } else {
        needsLlm.push(issue)
      }
    }
  }

  // Pass 2: LLM per-match for remaining issues
  // Uses charOffset for precise replacement (no ambiguous string search).
  // Skips dialogue lines. Validates fixes preserve content.
  let llmFixes = 0
  let llmCalls = 0
  let costUsd = 0

  if (needsLlm.length > 0 && llmConfig) {
    // Track offset shifts from prior replacements
    let offsetShift = 0
    // Process in reverse offset order so replacements don't shift later offsets
    const sorted = [...needsLlm].sort((a, b) => b.charOffset - a.charOffset)

    for (const issue of sorted) {
      // Skip if the match is inside dialogue (dialogue has its own voice)
      const hasQuotes = /["\u201C\u201D]/.test(issue.sentence)
      const isDialogueLine = issue.sentence.trim().startsWith('"') || issue.sentence.trim().startsWith('\u201C')
      if (isDialogueLine) { unfixed++; continue }

      // For said-bookisms inside dialogue attribution, do a targeted tag-only fix
      if (issue.category === "SAID_BOOKISM" && hasQuotes) {
        // Just replace the bookism word with "said" — don't rewrite the whole sentence
        const matchIdx = result.indexOf(issue.match)
        if (matchIdx !== -1) {
          result = result.slice(0, matchIdx) + "said" + result.slice(matchIdx + issue.match.length)
          deterministicFixes++
        } else {
          unfixed++
        }
        continue
      }

      // Find the exact match in current text using the sentence as anchor
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
          model: llmConfig.model,
          provider: llmConfig.provider as any,
          temperature: llmConfig.temperature ?? 0.2,
          maxTokens: 512,
          responseFormat: { type: "json_object" },
        })

        let fixed: string
        try {
          const json = JSON.parse(response.content)
          fixed = (json.fixed ?? json.sentence ?? "").trim()
        } catch { unfixed++; continue }
        llmCalls++

        const promptTokens = response.usage?.prompt_tokens ?? 0
        const completionTokens = response.usage?.completion_tokens ?? 0
        const { getTokenCost } = await import("../../models/registry")
        costUsd += getTokenCost(llmConfig.provider as any, llmConfig.model, promptTokens, completionTokens)

        // Validate the fix
        if (!fixed || fixed === issue.sentence) { unfixed++; continue }

        // Reject if fix is drastically different length (likely hallucinated)
        if (fixed.length > issue.sentence.length * 1.5 || fixed.length < issue.sentence.length * 0.5) { unfixed++; continue }

        // Reject if fix contains duplicated phrases (common LLM error)
        const words = fixed.split(/\s+/)
        const trigrams = words.slice(2).map((w, i) => `${words[i]} ${words[i+1]} ${w}`)
        const hasDupes = trigrams.some((t, i) => trigrams.indexOf(t) !== i && t.split(/\s+/).every(w => w.length > 2))
        if (hasDupes) { unfixed++; continue }

        // Reject if quotes were added/removed (dialogue corruption)
        const origQuotes = (issue.sentence.match(/["\u201C\u201D]/g) || []).length
        const fixQuotes = (fixed.match(/["\u201C\u201D]/g) || []).length
        if (origQuotes !== fixQuotes) { unfixed++; continue }

        // Apply at the exact sentence position
        result = result.slice(0, sentenceIdx) + fixed + result.slice(sentenceIdx + issue.sentence.length)
        llmFixes++

      } catch (err) {
        console.log(`  [lint-fix] LLM error: ${err instanceof Error ? err.message : err}`)
        unfixed++
      }
    }
  } else {
    unfixed += needsLlm.length
  }

  // Pass 3: rhythm rewriting — iterate until no more windows improve
  if (llmConfig) {
    const hasRhythmIssues = issues.some(i =>
      i.category === "RHYTHM_MONOTONY" || i.category === "PARAGRAPH_HOMOGENEITY"
    )
    if (hasRhythmIssues) {
      const { fixRhythm } = await import("./fix-rhythm")
      const MAX_RHYTHM_PASSES = 3
      for (let pass = 0; pass < MAX_RHYTHM_PASSES; pass++) {
        const rhythmResult = await fixRhythm(result, {
          provider: llmConfig.provider,
          model: llmConfig.model,
          temperature: llmConfig.temperature ?? 0.4,
        }, { maxFixes: 3 })

        result = rhythmResult.prose
        llmFixes += rhythmResult.windowsFixed
        llmCalls += rhythmResult.llmCalls
        costUsd += rhythmResult.costUsd

        if (rhythmResult.windowsFixed === 0) {
          unfixed += rhythmResult.windowsSkipped
          break // no more windows can be improved
        }
        // Fixed some — loop to catch newly-exposed or shifted windows
      }
    }
  }

  return {
    prose: result,
    deterministicFixes,
    llmFixes,
    llmCalls,
    unfixed,
    totalIssues: issues.length,
    costUsd,
    latencyMs: Date.now() - totalStart,
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
