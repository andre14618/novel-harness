/**
 * Emotional Echo detector (R.U.E. violations).
 *
 * Catches: physical indicator in sentence N → redundant emotion label in sentence N+1/N+2.
 * Example: "Her hands trembled." → "She was terrified." (the trembling already shows terror)
 *
 * Two-pass heuristic:
 *   Pass 1: Find sentences with physical/behavioral indicators, tag with emotion families
 *   Pass 2: Check next 1-2 sentences for explicit emotion labels matching those families
 *   Filter: Skip if follow-up contains cognitive verbs (analytical extension, not echo)
 *
 * Based on: Browne & King (R.U.E.), Swain (MRU), Ackerman & Puglisi (Emotion Thesaurus)
 * See: docs/ai-tells-emotional-echo.md
 */

import type { LintIssue } from "./index"

// ── Physical indicator lexicon ────────────────────────────────────────────

interface IndicatorDef {
  regex: RegExp
  emotionFamilies: string[]
}

const PHYSICAL_INDICATORS: IndicatorDef[] = [
  // EE-1: Trembling/shaking
  { regex: /\b(hands?|fingers?|body|lip|lips|voice)\s+(trembl\w*|shak\w*|shook|quiver\w*)\b/gi, emotionFamilies: ["fear", "anxiety", "anger", "grief"] },
  { regex: /\btrembl\w+\s+(hands?|fingers?|lip|lips|voice)\b/gi, emotionFamilies: ["fear", "anxiety", "anger", "grief"] },

  // EE-2: Jaw/fist clenching
  { regex: /\b(jaw|teeth|fists?|hands?)\s+(clench\w*|tighten\w*|grind\w*|gritted|balled|set)\b/gi, emotionFamilies: ["anger", "fear"] },
  { regex: /\bclenched\s+(his|her|their)\s+(jaw|fists?|teeth)\b/gi, emotionFamilies: ["anger", "fear"] },
  { regex: /\b(fists?\s+balled|hands?\s+curled\s+into\s+fists?)\b/gi, emotionFamilies: ["anger", "fear"] },

  // EE-3: Heart racing/pounding
  { regex: /\b(heart|pulse)\s+(pound\w*|rac\w*|hammer\w*|skip\w*|thud\w*|flutter\w*)\b/gi, emotionFamilies: ["fear", "anxiety", "excitement"] },
  { regex: /\bpounding\s+(heart|pulse)\b/gi, emotionFamilies: ["fear", "anxiety", "excitement"] },

  // EE-4: Stomach/gut distress
  { regex: /\b(stomach|gut)\s+(churn\w*|drop\w*|knot\w*|twist\w*|tighten\w*|roil\w*|clench\w*|flip\w*|lurch\w*|sank)\b/gi, emotionFamilies: ["anxiety", "fear", "disgust", "dread"] },

  // EE-5: Breath catching/holding
  { regex: /\b(breath|breathing)\s+(catch\w*|caught|hitch\w*|held|stop\w*|quicken\w*|froze)\b/gi, emotionFamilies: ["fear", "surprise", "shock", "anxiety"] },
  { regex: /\bheld\s+(his|her|their)\s+breath\b/gi, emotionFamilies: ["fear", "surprise", "anxiety"] },

  // EE-6: Freezing/stiffening
  { regex: /\b(froze|stiffened|went\s+(rigid|still|cold|pale)|rooted\s+to)\b/gi, emotionFamilies: ["fear", "shock", "surprise"] },
  { regex: /\bblood\s+(ran|went|turned)\s+cold\b/gi, emotionFamilies: ["fear", "dread"] },
]

// ── Emotion label lexicon ─────────────────────────────────────────────────

interface EmotionLabelDef {
  regex: RegExp
  family: string
}

const EMOTION_LABELS: EmotionLabelDef[] = [
  { regex: /\b(afraid|scared|terrified|frightened|panicked|fearful|petrified)\b/gi, family: "fear" },
  { regex: /\b(angry|furious|enraged|irate|livid|incensed|seething|rage)\b/gi, family: "anger" },
  { regex: /\b(anxious|nervous|worried|apprehensive|uneasy|agitated)\b/gi, family: "anxiety" },
  { regex: /\b(shocked|stunned|astonished|startled|dumbfounded)\b/gi, family: "surprise" },
  { regex: /\b(shocked|stunned)\b/gi, family: "shock" },
  { regex: /\b(disgusted|revolted|repulsed|sickened|nauseated|appalled)\b/gi, family: "disgust" },
  { regex: /\b(dread|dreading|dreaded)\b/gi, family: "dread" },
  { regex: /\b(excited|thrilled|elated|exhilarated)\b/gi, family: "excitement" },
  { regex: /\b(sad|heartbroken|devastated|grief|grieving|sorrowful|bereft)\b/gi, family: "grief" },
]

// Declared-emotion constructions that confirm the label is telling, not dialogue
const TELL_CONSTRUCTIONS = [
  /\b(she|he|they|[A-Z][a-z]+)\s+(was|were|felt)\s+/i,
  /\b(a\s+)?(wave|surge|pang|jolt|rush|stab|flash)\s+of\s+/i,
  /\b(fear|anger|anxiety|dread|terror|shock|rage|grief|disgust)\s+(grip\w*|seized?|wash\w*|cours\w*|flood\w*|fill\w*|swell\w*|settled?|crept|rose)\b/i,
]

// ── Analytical extension filters ──────────────────────────────────────────

const COGNITIVE_VERBS = /\b(realized?|understood|wondered|hadn.t expected|didn.t know|surprised|couldn.t believe|recognized|told (herself|himself|themselves)|reminded|remembered|knew|learned|discovered)\b/i
const NEGATION_REFRAME = /\bnot\s+(from|because\s+of)\b|\bwasn.t\s+(anger|fear|grief|sadness|joy|love|surprise|shock)\b|\bit\s+wasn.t\b/i
const COMPARISON_MARKERS = /\b(like the time|the same (way|feeling)|reminded (her|him|them) of|as (she|he|they) had|before every)\b/i

// ── Sentence splitting ────────────────────────────────────────────────────

function splitSentences(text: string): { text: string; offset: number }[] {
  const sentences: { text: string; offset: number }[] = []
  const re = /[^.!?\n]+[.!?\n]*/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const s = match[0].trim()
    if (s.length > 0) sentences.push({ text: s, offset: match.index })
  }
  return sentences
}

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

// ── Main detector ─────────────────────────────────────────────────────────

export function lintEmotionalEcho(prose: string, patternId: number): LintIssue[] {
  const sentences = splitSentences(prose)
  const issues: LintIssue[] = []

  // Pass 1: Find physical indicators
  const indicatorHits: { idx: number; families: string[]; match: string }[] = []
  for (let i = 0; i < sentences.length; i++) {
    if (isInDialogue(prose, sentences[i].offset)) continue

    for (const indicator of PHYSICAL_INDICATORS) {
      indicator.regex.lastIndex = 0
      const m = indicator.regex.exec(sentences[i].text)
      if (m) {
        indicatorHits.push({ idx: i, families: indicator.emotionFamilies, match: m[0] })
        break // one indicator per sentence
      }
    }
  }

  // Pass 2: Check proximity window for emotion labels
  for (const hit of indicatorHits) {
    let found = false

    for (let offset = 1; offset <= 2 && !found; offset++) {
      const checkIdx = hit.idx + offset
      if (checkIdx >= sentences.length) break

      const checkSentence = sentences[checkIdx]
      if (isInDialogue(prose, checkSentence.offset)) continue

      // Check for emotion labels matching the indicator's families
      for (const label of EMOTION_LABELS) {
        if (!hit.families.includes(label.family)) continue
        label.regex.lastIndex = 0
        const labelMatch = label.regex.exec(checkSentence.text)
        if (!labelMatch) continue

        // Verify it's in a tell construction (not just the emotion word in dialogue or action)
        const isTellConstruction = TELL_CONSTRUCTIONS.some(p => p.test(checkSentence.text))
        if (!isTellConstruction) continue

        // Apply analytical extension filters — these are legitimate, not echo
        if (COGNITIVE_VERBS.test(checkSentence.text)) continue
        if (NEGATION_REFRAME.test(checkSentence.text)) continue
        if (COMPARISON_MARKERS.test(checkSentence.text)) continue

        issues.push({
          patternId,
          charOffset: sentences[hit.idx].offset,
          category: "EMOTIONAL_ECHO",
          match: `${sentences[hit.idx].text.trim()} → ${checkSentence.text.trim()}`,
          sentence: sentences[hit.idx].text.trim(),
          fixTemplate: `Physical detail already shows ${label.family}. Cut the emotion label unless it adds analytical depth (surprise at the emotion, its source, or contrast with expectation).`,
        })
        found = true
        break
      }
    }

    // Also check same sentence after semicolon or em-dash
    if (!found) {
      const sameText = sentences[hit.idx].text
      const splitPoint = sameText.search(/[;—–]/)
      if (splitPoint > 0) {
        const secondHalf = sameText.slice(splitPoint + 1)
        for (const label of EMOTION_LABELS) {
          if (!hit.families.includes(label.family)) continue
          label.regex.lastIndex = 0
          if (!label.regex.exec(secondHalf)) continue
          if (!TELL_CONSTRUCTIONS.some(p => p.test(secondHalf))) continue
          if (COGNITIVE_VERBS.test(secondHalf)) continue

          issues.push({
            patternId,
            charOffset: sentences[hit.idx].offset,
            category: "EMOTIONAL_ECHO",
            match: sameText.trim(),
            sentence: sameText.trim(),
            fixTemplate: `Physical detail already shows ${label.family}. Cut the emotion label after the semicolon/dash unless it adds new information.`,
          })
          break
        }
      }
    }
  }

  return issues
}
