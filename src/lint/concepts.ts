/**
 * Lint concept registry.
 *
 * Maps each lint category to its reference documentation and craft source.
 * Used by discovery and improvement passes to provide deep, focused context
 * on ONE concept at a time instead of shallow multi-concept prompts.
 *
 * Each concept has:
 *   - categories: which lint_patterns categories it covers
 *   - referenceDoc: path to deep reference doc (if exists)
 *   - summary: condensed explanation when no full doc exists
 *   - craftSource: citation for the underlying craft principle
 *   - whatAIGetsWrong: why AI models specifically produce this defect
 */

import { readFileSync, existsSync } from "node:fs"

const HARNESS_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")

export interface LintConcept {
  id: string
  name: string
  categories: string[]
  referenceDoc?: string   // path relative to HARNESS_ROOT
  summary: string         // used when no referenceDoc, or as a quick version
  craftSource: string
  whatAIGetsWrong: string
}

export const CONCEPTS: LintConcept[] = [
  {
    id: "ai-cliches",
    name: "AI Clichés & Purple Prose",
    categories: ["AI_CLICHE"],
    referenceDoc: "docs/ai-tells-cliches-purple-prose.md",
    summary: "Statistically overrepresented phrases in AI output: weight metaphors ('the weight of silence'), personified silence ('silence stretched'), vague internal shifts ('something shifted inside'), flickering emotions, charged air, objects hanging in air. These appear 10-50x more often in AI prose than published fiction.",
    craftSource: "Observed across GPT/Claude/Llama outputs; corroborated by AI prose analysis research",
    whatAIGetsWrong: "RLHF training rewards 'literary-sounding' phrasing. The model learns that metaphors involving weight, silence, and air are associated with 'good writing' in training data, so it overuses them. Published authors use these occasionally; AI uses them in nearly every emotional beat.",
  },
  {
    id: "hedging",
    name: "Hedge Qualifiers",
    categories: ["HEDGE_QUALIFIER"],
    referenceDoc: "docs/ai-tells-hedging-qualifying.md",
    summary: "Words that weaken assertions: 'perhaps,' 'sort of,' 'kind of,' 'somewhat,' 'almost as if,' 'something like,' 'couldn't help but.' In fiction, hedging undermines conviction. Characters who 'sort of smiled' are less vivid than those who 'smiled.'",
    craftSource: "Strunk & White, 'Elements of Style' (Rule 17: Omit needless words); Browne & King, 'Self-Editing for Fiction Writers' (Ch. 7)",
    whatAIGetsWrong: "RLHF penalizes overconfident assertions, training the model to hedge. In factual contexts this is appropriate, but in fiction it produces characters and narrators who seem uncertain about their own experiences.",
  },
  {
    id: "emotional-echo",
    name: "Emotional Echo (Show-Then-Tell)",
    categories: ["EMOTIONAL_ECHO", "DECLARED_EMOTION"],
    referenceDoc: "docs/ai-tells-emotional-echo.md",
    summary: "Physical showing in one sentence followed by redundant emotion label in the next: 'Her hands trembled. She was terrified.' The trembling already shows terror; naming it undermines the showing and breaks psychic distance.",
    craftSource: "Browne & King, 'Self-Editing for Fiction Writers' (R.U.E.); Swain, 'Techniques of the Selling Writer' (MRU); Gardner, 'The Art of Fiction' (psychic distance)",
    whatAIGetsWrong: "RLHF rewards clarity and completeness. The model treats unnamed emotions as 'incomplete' — having shown fear through trembling, it assigns high probability to an explicit fear label to be 'thorough.' It has no concept of trust between writer and reader.",
  },
  {
    id: "rhythm",
    name: "Rhythm & Paragraph Homogeneity",
    categories: ["RHYTHM_MONOTONY", "PARAGRAPH_HOMOGENEITY"],
    referenceDoc: "docs/ai-tells-rhythm-homogeneity.md",
    summary: "Monotonous sentence/paragraph structure: uniform sentence lengths (CV < 0.30), repeated openings ('She... She... She...'), compound sentence dominance (>60%), uniform paragraph lengths. Published fiction CV typically 0.4-0.8; AI output 0.15-0.30.",
    craftSource: "Gary Provost, '100 Ways to Improve Your Writing'; Roy Peter Clark, 'Writing Tools' (Tool #18); stylometric research on authorship attribution",
    whatAIGetsWrong: "Trained on averaged patterns across millions of texts, AI produces the statistical mean of all rhythmic signatures — rhythmically bland prose that sounds like no one. It lacks the deliberate rhythm control that makes published prose feel alive.",
  },
  {
    id: "filter-words",
    name: "Filter Words",
    categories: ["FILTER_WORD"],
    summary: "'She could see the fire' → 'The fire.' In close POV, the character IS the perceiving lens. Naming the perception ('could see,' 'seemed to,' 'felt') inserts unnecessary distance between reader and experience.",
    craftSource: "Browne & King, 'Self-Editing for Fiction Writers' (Ch. 1: Show and Tell)",
    whatAIGetsWrong: "The model defaults to explicit attribution of perception because training data contains both close and distant POV. Without understanding that the POV is already established, it re-establishes it every few sentences.",
  },
  {
    id: "filler-phrases",
    name: "Filler Phrases",
    categories: ["FILLER_PHRASE", "EMPTY_TRANSITION"],
    summary: "'In order to' → 'to.' 'Due to the fact that' → 'because.' 'And then' at sentence start. These add words without meaning. Fiction should be tight — every word earns its place.",
    craftSource: "Strunk & White, 'Elements of Style' (Rule 17); Zinsser, 'On Writing Well' (Ch. 3: Clutter)",
    whatAIGetsWrong: "Language models predict the most probable next token. Filler phrases are high-probability completions because they appear frequently in training data (especially non-fiction). The model reaches for them as 'safe' connective tissue.",
  },
  {
    id: "redundancy",
    name: "Redundant Body Language & Adverbs",
    categories: ["REDUNDANT_BODY", "REDUNDANT_ADVERB_VERB"],
    summary: "'Nodded his head' (what else?), 'whispered softly' (how else?), 'shrugged her shoulders.' The verb already implies the body part or manner. The redundant word adds nothing.",
    craftSource: "Ackerman & Puglisi, 'The Emotion Thesaurus' (2012); King, 'On Writing' (adverb avoidance)",
    whatAIGetsWrong: "The model has seen both 'nodded' and 'nodded his head' in training data. Without understanding that the body part is implied, it produces the longer form because it's a valid, frequent completion.",
  },
  {
    id: "said-bookisms",
    name: "Said Bookisms",
    categories: ["SAID_BOOKISM"],
    summary: "'Said' is invisible to readers. 'Exclaimed,' 'proclaimed,' 'opined,' 'intoned' draw attention to the tag instead of the dialogue. 'Said softly' tells instead of showing through rhythm and word choice.",
    craftSource: "King, 'On Writing'; Browne & King, 'Self-Editing for Fiction Writers' (Ch. 3: Dialogue Mechanics)",
    whatAIGetsWrong: "The model treats dialogue tags as opportunities for variety, cycling through synonyms to avoid repetition. But 'said' repetition is invisible; tag variety is visible and distracting.",
  },
]

/**
 * Load the full reference doc for a concept, or fall back to its summary.
 * Returns a focused context string suitable for a single-concept LLM pass.
 */
export function loadConceptContext(concept: LintConcept): string {
  let context = `# ${concept.name}\n\n`
  context += `Craft source: ${concept.craftSource}\n\n`
  context += `Why AI gets this wrong: ${concept.whatAIGetsWrong}\n\n`

  if (concept.referenceDoc) {
    const fullPath = `${HARNESS_ROOT}/${concept.referenceDoc}`
    if (existsSync(fullPath)) {
      const doc = readFileSync(fullPath, "utf-8")
      // Extract the executive summary + proposed patterns sections (skip background theory)
      const execStart = doc.indexOf("## Executive Summary")
      const patternsStart = doc.indexOf("## Proposed Patterns")
      const implStart = doc.indexOf("## Implementation Sketch")

      if (execStart !== -1) {
        const execEnd = doc.indexOf("\n## ", execStart + 5)
        context += doc.slice(execStart, execEnd !== -1 ? execEnd : execStart + 1500) + "\n\n"
      }
      if (patternsStart !== -1) {
        const patternsEnd = implStart !== -1 ? implStart : doc.indexOf("\n## Pattern Summary", patternsStart + 5)
        // Limit to first 2000 chars of patterns section
        context += doc.slice(patternsStart, Math.min(patternsEnd !== -1 ? patternsEnd : patternsStart + 2000, patternsStart + 2000)) + "\n\n"
      }
    } else {
      context += concept.summary + "\n\n"
    }
  } else {
    context += concept.summary + "\n\n"
  }

  return context
}

/** Get concept by lint category name */
export function getConceptForCategory(category: string): LintConcept | undefined {
  return CONCEPTS.find(c => c.categories.includes(category))
}
