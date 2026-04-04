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
      // AI_CLICHE and DECLARED_EMOTION need creative rewriting — advisory only, skip LLM
      const advisoryCategories = ["AI_CLICHE", "DECLARED_EMOTION"]
      if (advisoryCategories.includes(issue.category)) {
        unfixed++
      } else {
        needsLlm.push(issue)
      }
    }
  }

  // Pass 2: LLM per-sentence for remaining issues
  let llmFixes = 0
  let llmCalls = 0
  let costUsd = 0

  if (needsLlm.length > 0 && llmConfig) {
    // Group by sentence to minimize calls
    const bySentence = new Map<string, LintIssue[]>()
    for (const issue of needsLlm) {
      // Re-find sentence in the (possibly modified) text
      const sentenceInText = result.includes(issue.sentence) ? issue.sentence : null
      if (!sentenceInText) { unfixed++; continue }
      if (!bySentence.has(sentenceInText)) bySentence.set(sentenceInText, [])
      bySentence.get(sentenceInText)!.push(issue)
    }

    for (const [sentence, sentenceIssues] of bySentence) {
      const issueList = sentenceIssues
        .map(i => `- "${i.match}" → ${i.fixTemplate}`)
        .join("\n")

      try {
        const response = await getTransport().execute({
          systemPrompt: "Fix the flagged patterns in this sentence. Return ONLY the corrected sentence — no JSON, no explanation, no quotes. Preserve everything else exactly.",
          userPrompt: `PATTERNS TO FIX:\n${issueList}\n\nSENTENCE:\n${sentence}`,
          model: llmConfig.model,
          provider: llmConfig.provider as any,
          temperature: llmConfig.temperature ?? 0.2,
          maxTokens: 512,
        })

        const fixed = response.content.trim().replace(/^["']|["']$/g, "")
        llmCalls++

        const promptTokens = response.usage?.prompt_tokens ?? 0
        const completionTokens = response.usage?.completion_tokens ?? 0
        const { getTokenCost } = await import("../models/registry")
        costUsd += getTokenCost(llmConfig.provider as any, llmConfig.model, promptTokens, completionTokens)

        if (fixed && fixed !== sentence) {
          const idx = result.indexOf(sentence)
          if (idx !== -1) {
            result = result.slice(0, idx) + fixed + result.slice(idx + sentence.length)
            llmFixes += sentenceIssues.length
          } else {
            unfixed += sentenceIssues.length
          }
        } else {
          unfixed += sentenceIssues.length
        }
      } catch {
        unfixed += sentenceIssues.length
      }
    }
  } else {
    unfixed += needsLlm.length
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
