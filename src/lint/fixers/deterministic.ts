/**
 * Deterministic lint fixes.
 *
 * Pure string replacement — no LLM calls. Handles subtractive patterns
 * where the fix is "remove this word" or "replace with a simpler word."
 * Near-zero collateral damage (0.1% word-level change).
 */

import type { LintIssue } from "../types"

interface DetFix {
  category: string
  pattern: RegExp
  fix: (match: string, sentence: string) => string | null
}

export const DETERMINISTIC_FIXES: DetFix[] = [
  // FILLER_PHRASE
  { category: "FILLER_PHRASE", pattern: /\bdue to the fact that\b/gi, fix: () => "because" },
  { category: "FILLER_PHRASE", pattern: /\bin spite of the fact that\b/gi, fix: () => "although" },
  { category: "FILLER_PHRASE", pattern: /\bat this point in time\b/gi, fix: () => "now" },
  { category: "FILLER_PHRASE", pattern: /\bfor the purpose of\b/gi, fix: () => "to" },
  { category: "FILLER_PHRASE", pattern: /\bhas the ability to\b/gi, fix: () => "can" },
  { category: "FILLER_PHRASE", pattern: /\bin order to\b/gi, fix: () => "to" },
  { category: "FILLER_PHRASE", pattern: /\bthe fact that\b/gi, fix: () => null },

  // REDUNDANT_ADVERB_VERB
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bwhispered\s+softly\b/gi, fix: () => "whispered" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bshouted\s+loudly\b/gi, fix: () => "shouted" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bscreamed\s+loudly\b/gi, fix: () => "screamed" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bmurmured\s+softly\b/gi, fix: () => "murmured" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bcrept\s+quietly\b/gi, fix: () => "crept" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bstrolled\s+leisurely\b/gi, fix: () => "strolled" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bgripped\s+firmly\b/gi, fix: () => "gripped" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\brushed\s+quickly\b/gi, fix: () => "rushed" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bhurried\s+quickly\b/gi, fix: () => "hurried" },

  // REDUNDANT_BODY
  { category: "REDUNDANT_BODY", pattern: /\bnodded\s+(his|her|their)\s+head/gi, fix: () => "nodded" },
  { category: "REDUNDANT_BODY", pattern: /\bshrugged\s+(his|her|their)\s+shoulders/gi, fix: () => "shrugged" },
  { category: "REDUNDANT_BODY", pattern: /\bblinked\s+(his|her|their)\s+eyes/gi, fix: () => "blinked" },
  { category: "REDUNDANT_BODY", pattern: /\bsat\s+down\b/gi, fix: () => "sat" },
  { category: "REDUNDANT_BODY", pattern: /\breturned\s+back\b/gi, fix: () => "returned" },
  { category: "REDUNDANT_BODY", pattern: /\brose\s+up\b/gi, fix: () => "rose" },
  { category: "REDUNDANT_BODY", pattern: /\bstood\s+up\b/gi, fix: () => "stood" },

  // FILTER_WORD
  { category: "FILTER_WORD", pattern: /\bcould\s+feel\b/gi, fix: () => "felt" },
  { category: "FILTER_WORD", pattern: /\bcould\s+see\b/gi, fix: () => "saw" },
  { category: "FILTER_WORD", pattern: /\bcould\s+hear\b/gi, fix: () => "heard" },
  { category: "FILTER_WORD", pattern: /\bcould\s+smell\b/gi, fix: () => "smelled" },
  { category: "FILTER_WORD", pattern: /\bcould\s+taste\b/gi, fix: () => "tasted" },
  { category: "FILTER_WORD", pattern: /\bseemed\s+to\b/gi, fix: () => "" },

  // HEDGE_QUALIFIER
  { category: "HEDGE_QUALIFIER", pattern: /\bcouldn't\s+help\s+but\b/gi, fix: () => "" },
  { category: "HEDGE_QUALIFIER", pattern: /\b(sort|kind)\s+of\b/gi, fix: () => "" },
  { category: "HEDGE_QUALIFIER", pattern: /\bsomething\s+(like|akin\s+to)\b/gi, fix: () => "" },
  { category: "HEDGE_QUALIFIER", pattern: /\balmost\s+as\s+if\b/gi, fix: () => "as if" },
  { category: "HEDGE_QUALIFIER", pattern: /\bit\s+was\s+as\s+(though|if)\b/gi, fix: () => null },

  // EMPTY_TRANSITION
  { category: "EMPTY_TRANSITION", pattern: /(?:^|(?<=\.\s{1,2}))And then\b/gi, fix: () => "" },
  { category: "EMPTY_TRANSITION", pattern: /(?:^|(?<=\.\s{1,2}))After that\b/gi, fix: () => "" },
  { category: "EMPTY_TRANSITION", pattern: /(?:^|(?<=\.\s{1,2}))All of a sudden\b/gi, fix: () => "" },

  // SAID_BOOKISM
  { category: "SAID_BOOKISM", pattern: /\b(exclaimed|proclaimed|declared|announced|stated|remarked|uttered|intoned|opined|asserted)\b/gi, fix: () => "said" },
  { category: "SAID_BOOKISM", pattern: /\bsaid\s+(softly|loudly|quietly|angrily|sadly|happily|nervously|anxiously|cheerfully|sarcastically|bitterly|wearily|eagerly|reluctantly|firmly|gently|coldly|warmly)\b/gi, fix: () => "said" },
]

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Apply deterministic fixes to prose. Returns modified text and count.
 * Issues that can't be fixed deterministically are returned as `remaining`.
 */
export function applyDeterministicFixes(
  prose: string,
  issues: LintIssue[],
): { prose: string; fixed: number; remaining: LintIssue[] } {
  let result = prose
  let fixed = 0
  const remaining: LintIssue[] = []

  for (const issue of issues) {
    // Skip structural categories (need different fix approach)
    if (issue.category === "RHYTHM_MONOTONY" || issue.category === "PARAGRAPH_HOMOGENEITY") {
      remaining.push(issue)
      continue
    }

    let didFix = false
    for (const rule of DETERMINISTIC_FIXES) {
      if (issue.category !== rule.category) continue
      if (!rule.pattern.test(issue.match)) continue

      const replacement = rule.fix(issue.match, issue.sentence)
      if (replacement === null) break

      const sentenceIdx = result.indexOf(issue.sentence)
      if (sentenceIdx === -1) continue

      const originalSentence = result.slice(sentenceIdx, sentenceIdx + issue.sentence.length)
      const fixedSentence = originalSentence.replace(new RegExp(escapeRegex(issue.match), "i"), replacement)

      if (fixedSentence !== originalSentence) {
        result = result.slice(0, sentenceIdx) + fixedSentence + result.slice(sentenceIdx + issue.sentence.length)
        fixed++
        didFix = true
      }
      break
    }

    if (!didFix) {
      // Said-bookisms in dialogue: deterministic tag swap
      const hasQuotes = /["\u201C\u201D]/.test(issue.sentence)
      if (issue.category === "SAID_BOOKISM" && hasQuotes) {
        const matchIdx = result.indexOf(issue.match)
        if (matchIdx !== -1) {
          result = result.slice(0, matchIdx) + "said" + result.slice(matchIdx + issue.match.length)
          fixed++
          continue
        }
      }
      remaining.push(issue)
    }
  }

  return { prose: result, fixed, remaining }
}
