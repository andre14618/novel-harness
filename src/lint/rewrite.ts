/**
 * Batched chapter-level lint rewriting.
 *
 * Instead of fixing issues one-at-a-time:
 *   1. Apply deterministic fixes first (free, instant)
 *   2. Annotate remaining issues inline with markers
 *   3. Send ONE LLM call per chapter with all markers
 *   4. Get back the full rewritten chapter
 *   5. Validate (content preservation, length bounds)
 *
 * Much cheaper and more coherent than individual fix calls — the LLM sees
 * the full chapter context and makes fixes that work together (e.g., rhythm
 * variation across the whole chapter, not one window at a time).
 */

import { getTransport } from "../transport"
import { extractJSON } from "../llm"
import type { LintIssue } from "./index"

// ── Deterministic fixes (reused from fix.ts) ──────────────────────────────

interface DetFix {
  category: string
  pattern: RegExp
  fix: (match: string, sentence: string) => string | null
}

// Import the deterministic rules — keep in sync with fix.ts
const DETERMINISTIC_FIXES: DetFix[] = [
  { category: "FILLER_PHRASE", pattern: /\bdue to the fact that\b/gi, fix: () => "because" },
  { category: "FILLER_PHRASE", pattern: /\bin spite of the fact that\b/gi, fix: () => "although" },
  { category: "FILLER_PHRASE", pattern: /\bat this point in time\b/gi, fix: () => "now" },
  { category: "FILLER_PHRASE", pattern: /\bfor the purpose of\b/gi, fix: () => "to" },
  { category: "FILLER_PHRASE", pattern: /\bhas the ability to\b/gi, fix: () => "can" },
  { category: "FILLER_PHRASE", pattern: /\bin order to\b/gi, fix: () => "to" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bwhispered\s+softly\b/gi, fix: () => "whispered" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bshouted\s+loudly\b/gi, fix: () => "shouted" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bmurmured\s+softly\b/gi, fix: () => "murmured" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bcrept\s+quietly\b/gi, fix: () => "crept" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\bgripped\s+firmly\b/gi, fix: () => "gripped" },
  { category: "REDUNDANT_ADVERB_VERB", pattern: /\brushed\s+quickly\b/gi, fix: () => "rushed" },
  { category: "REDUNDANT_BODY", pattern: /\bnodded\s+(his|her|their)\s+head/gi, fix: () => "nodded" },
  { category: "REDUNDANT_BODY", pattern: /\bshrugged\s+(his|her|their)\s+shoulders/gi, fix: () => "shrugged" },
  { category: "REDUNDANT_BODY", pattern: /\bblinked\s+(his|her|their)\s+eyes/gi, fix: () => "blinked" },
  { category: "REDUNDANT_BODY", pattern: /\bsat\s+down\b/gi, fix: () => "sat" },
  { category: "REDUNDANT_BODY", pattern: /\breturned\s+back\b/gi, fix: () => "returned" },
  { category: "REDUNDANT_BODY", pattern: /\brose\s+up\b/gi, fix: () => "rose" },
  { category: "REDUNDANT_BODY", pattern: /\bstood\s+up\b/gi, fix: () => "stood" },
  { category: "FILTER_WORD", pattern: /\bcould\s+feel\b/gi, fix: () => "felt" },
  { category: "FILTER_WORD", pattern: /\bcould\s+see\b/gi, fix: () => "saw" },
  { category: "FILTER_WORD", pattern: /\bcould\s+hear\b/gi, fix: () => "heard" },
  { category: "FILTER_WORD", pattern: /\bseemed\s+to\b/gi, fix: () => "" },
  { category: "SAID_BOOKISM", pattern: /\b(exclaimed|proclaimed|declared|announced|stated|remarked|uttered|intoned|opined|asserted)\b/gi, fix: () => "said" },
  { category: "SAID_BOOKISM", pattern: /\bsaid\s+(softly|loudly|quietly|angrily|sadly|happily|nervously)\b/gi, fix: () => "said" },
]

// ── Result type ───────────────────────────────────────────────────────────

export interface RewriteResult {
  prose: string
  deterministicFixes: number
  llmFixes: number
  unfixed: number
  totalIssues: number
  costUsd: number
  latencyMs: number
}

// ── Annotation ────────────────────────────────────────────────────────────

function annotateIssues(prose: string, issues: LintIssue[]): { annotated: string; issueCount: number } {
  // Sort by offset descending so insertions don't shift earlier offsets
  const sorted = [...issues].sort((a, b) => b.charOffset - a.charOffset)
  let annotated = prose
  let count = 0

  for (const issue of sorted) {
    const matchIdx = annotated.indexOf(issue.match, Math.max(0, issue.charOffset - 20))
    if (matchIdx === -1) continue

    const before = annotated.slice(0, matchIdx)
    const after = annotated.slice(matchIdx + issue.match.length)
    annotated = `${before}⟨FIX:${issue.category}⟩${issue.match}⟨/FIX⟩${after}`
    count++
  }

  return { annotated, issueCount: count }
}

// ── Main batched rewrite ──────────────────────────────────────────────────

export async function rewriteChapter(
  prose: string,
  issues: LintIssue[],
  llmConfig: { provider: string; model: string; temperature?: number },
): Promise<RewriteResult> {
  const totalStart = Date.now()
  let result = prose
  let deterministicFixes = 0
  let unfixed = 0

  // Pass 1: deterministic fixes
  const needsLlm: LintIssue[] = []
  for (const issue of issues) {
    let fixed = false
    for (const rule of DETERMINISTIC_FIXES) {
      if (issue.category !== rule.category) continue
      if (!rule.pattern.test(issue.match)) continue
      const replacement = rule.fix(issue.match, issue.sentence)
      if (replacement === null) break

      const sentenceIdx = result.indexOf(issue.sentence)
      if (sentenceIdx === -1) continue
      const original = result.slice(sentenceIdx, sentenceIdx + issue.sentence.length)
      const fixedSentence = original.replace(new RegExp(escapeRegex(issue.match), "i"), replacement)
      if (fixedSentence !== original) {
        result = result.slice(0, sentenceIdx) + fixedSentence + result.slice(sentenceIdx + issue.sentence.length)
        deterministicFixes++
        fixed = true
      }
      break
    }
    if (!fixed) needsLlm.push(issue)
  }

  if (needsLlm.length === 0) {
    return { prose: result, deterministicFixes, llmFixes: 0, unfixed: 0, totalIssues: issues.length, costUsd: 0, latencyMs: Date.now() - totalStart }
  }

  // Pass 2: annotate all remaining issues and send ONE LLM call
  const { annotated, issueCount } = annotateIssues(result, needsLlm)

  if (issueCount === 0) {
    return { prose: result, deterministicFixes, llmFixes: 0, unfixed: needsLlm.length, totalIssues: issues.length, costUsd: 0, latencyMs: Date.now() - totalStart }
  }

  // Build category-specific fix instructions
  const categories = [...new Set(needsLlm.map(i => i.category))]
  const instructions = categories.map(cat => {
    switch (cat) {
      case "AI_CLICHE": return `AI_CLICHE: Replace with a concrete sensory detail specific to this scene. Use what's physically present — sounds, textures, smells — not abstract metaphors.`
      case "HEDGE_QUALIFIER": return `HEDGE_QUALIFIER: Remove the hedge word or commit to the assertion. "Sort of smiled" → "smiled" or replace with a specific physical description.`
      case "DECLARED_EMOTION": return `DECLARED_EMOTION: Cut the emotion label. If the physical showing before it is adequate, the label is redundant. If not, improve the showing instead.`
      case "EMOTIONAL_ECHO": return `EMOTIONAL_ECHO: The physical indicator already shows the emotion. Cut the follow-up label sentence entirely, or replace it with the character processing/analyzing the emotion (not restating it).`
      case "RHYTHM_MONOTONY": return `RHYTHM_MONOTONY: Vary sentence lengths in this passage. Mix short punchy sentences (3-6 words) with longer flowing ones (20+ words). Use a fragment. Break a compound sentence. Merge two short ones.`
      case "PARAGRAPH_HOMOGENEITY": return `PARAGRAPH_HOMOGENEITY: Vary paragraph lengths. Split a long one or merge short ones. A 1-sentence paragraph creates emphasis; a long paragraph sustains atmosphere.`
      case "FILTER_WORD": return `FILTER_WORD: Remove the perception filter. In close POV, present the sensation directly.`
      default: return `${cat}: Fix the flagged pattern. Preserve meaning and context.`
    }
  }).join("\n")

  try {
    const response = await getTransport().execute({
      systemPrompt: `You are a prose editor. The text below has issues marked with ⟨FIX:CATEGORY⟩...⟨/FIX⟩ tags. Fix each marked region according to the instructions below. Return the COMPLETE rewritten text with all fixes applied and all tags removed.

CRITICAL RULES:
- Fix ONLY the marked regions. Do not change unmarked text.
- Preserve all plot, dialogue, characters, and actions exactly.
- Return the full chapter text, not just the fixed parts.
- Remove all ⟨FIX⟩ and ⟨/FIX⟩ tags from your output.

FIX INSTRUCTIONS BY CATEGORY:
${instructions}`,
      userPrompt: annotated,
      model: llmConfig.model,
      provider: llmConfig.provider as any,
      temperature: llmConfig.temperature ?? 0.3,
      maxTokens: 8192,
    })

    const rewritten = response.content.trim()
      .replace(/⟨\/?FIX(?::[A-Z_]+)?⟩/g, "") // clean any leftover tags

    const promptTokens = response.usage?.prompt_tokens ?? 0
    const completionTokens = response.usage?.completion_tokens ?? 0
    const { getTokenCost } = await import("../models/registry")
    const costUsd = getTokenCost(llmConfig.provider as any, llmConfig.model, promptTokens, completionTokens)

    // Validate: rewrite should preserve most content (within 15% length)
    const lengthDelta = Math.abs(rewritten.length - result.length) / result.length
    if (rewritten.length > 100 && lengthDelta < 0.15) {
      return {
        prose: rewritten,
        deterministicFixes,
        llmFixes: issueCount,
        unfixed: needsLlm.length - issueCount,
        totalIssues: issues.length,
        costUsd,
        latencyMs: Date.now() - totalStart,
      }
    } else {
      // Rewrite diverged too much — reject
      return {
        prose: result, // keep deterministic fixes only
        deterministicFixes,
        llmFixes: 0,
        unfixed: needsLlm.length,
        totalIssues: issues.length,
        costUsd,
        latencyMs: Date.now() - totalStart,
      }
    }
  } catch {
    return {
      prose: result,
      deterministicFixes,
      llmFixes: 0,
      unfixed: needsLlm.length,
      totalIssues: issues.length,
      costUsd: 0,
      latencyMs: Date.now() - totalStart,
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
