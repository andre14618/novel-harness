/**
 * Rhythm & paragraph homogeneity detector.
 *
 * Statistical heuristics for detecting AI-characteristic prose patterns:
 *   RM-1: Sentence length uniformity (low CV over sliding windows)
 *   RM-2: Sentence opening repetition (3+ consecutive same-word starts)
 *   RM-3: Compound sentence dominance (>60% compound in window)
 *   PH-1: Paragraph length uniformity (4+ paragraphs within 20% of mean)
 *   PH-2: Paragraph opening repetition (3+ consecutive same-word paragraph starts)
 *
 * All patterns start DISABLED — enable after calibrating thresholds against
 * existing corpus. See docs/ai-tells-rhythm-homogeneity.md.
 */

import type { LintIssue } from "./index"

// ── Config ────────────────────────────────────────────────────────────────

export interface RhythmConfig {
  sentenceLengthCV: { enabled: boolean; windowSize: number; stepSize: number; threshold: number }
  openingRepetition: { enabled: boolean; minRun: number; twoWord: boolean }
  compoundDominance: { enabled: boolean; windowSize: number; threshold: number }
  paragraphLengthCV: { enabled: boolean; windowSize: number; tolerance: number }
  paragraphOpeningRepetition: { enabled: boolean; minRunWord: number; minRunPattern: number }
}

export const DEFAULT_RHYTHM_CONFIG: RhythmConfig = {
  sentenceLengthCV:          { enabled: true, windowSize: 8, stepSize: 4, threshold: 0.25 },
  openingRepetition:         { enabled: true, minRun: 3, twoWord: false },
  compoundDominance:         { enabled: false, windowSize: 10, threshold: 0.60 },
  paragraphLengthCV:         { enabled: false, windowSize: 4, tolerance: 0.20 },
  paragraphOpeningRepetition:{ enabled: true, minRunWord: 3, minRunPattern: 4 },
}

// ── Sentence/paragraph splitting ──────────────────────────────────────────

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

interface Sentence { text: string; offset: number; words: number }
interface Paragraph { text: string; offset: number; words: number; sentences: Sentence[] }

function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = []
  const re = /[^.!?\n]+[.!?\n]*/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const s = match[0].trim()
    if (s.length > 2) {
      sentences.push({ text: s, offset: match.index, words: s.split(/\s+/).filter(Boolean).length })
    }
  }
  return sentences
}

function splitParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let offset = 0
  for (const block of text.split(/\n\n+/)) {
    const trimmed = block.trim()
    if (trimmed.length > 0) {
      const sentences = splitSentences(trimmed)
      paragraphs.push({
        text: trimmed,
        offset: text.indexOf(trimmed, offset),
        words: trimmed.split(/\s+/).filter(Boolean).length,
        sentences,
      })
    }
    offset += block.length + 2
  }
  return paragraphs
}

function getNarrationSentences(text: string): Sentence[] {
  return splitSentences(text).filter(s => !isInDialogue(text, s.offset))
}

// ── Stats helpers ─────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

function cv(arr: number[]): number {
  if (arr.length < 2) return 999
  const m = mean(arr)
  if (m === 0) return 0
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
  return std / m
}

// ── RM-1: Sentence length uniformity ──────────────────────────────────────

function detectSentenceLengthUniformity(
  sentences: Sentence[], config: RhythmConfig["sentenceLengthCV"], patternId: number,
): LintIssue[] {
  const issues: LintIssue[] = []
  const { windowSize, stepSize, threshold } = config
  if (sentences.length < windowSize) return issues

  for (let i = 0; i <= sentences.length - windowSize; i += stepSize) {
    const window = sentences.slice(i, i + windowSize)
    const wordCounts = window.map(s => s.words)
    const cvVal = cv(wordCounts)

    if (cvVal < threshold) {
      const avgWords = mean(wordCounts).toFixed(0)
      issues.push({
        patternId,
        charOffset: window[0].offset,
        category: "RHYTHM_MONOTONY",
        match: `${windowSize} sentences, CV=${cvVal.toFixed(2)}, avg ${avgWords}w`,
        sentence: window.map(s => s.text.slice(0, 40)).join(" | "),
        fixTemplate: `Sentence lengths are too uniform (CV=${cvVal.toFixed(2)}, threshold ${threshold}). Vary sentence length: use short punchy sentences for impact, longer ones for reflection. Mix fragments, simple, compound, and complex structures.`,
      })
    }
  }

  return issues
}

// ── RM-2: Sentence opening repetition ─────────────────────────────────────

function detectOpeningRepetition(
  sentences: Sentence[], config: RhythmConfig["openingRepetition"], patternId: number,
): LintIssue[] {
  const issues: LintIssue[] = []
  const { minRun, twoWord } = config

  function getOpening(s: string): string {
    const words = s.split(/\s+/)
    return twoWord ? words.slice(0, 2).join(" ").toLowerCase() : (words[0] || "").toLowerCase()
  }

  let runStart = 0
  let currentOpening = getOpening(sentences[0]?.text || "")
  let runLength = 1

  for (let i = 1; i < sentences.length; i++) {
    const opening = getOpening(sentences[i].text)
    if (opening === currentOpening) {
      runLength++
    } else {
      if (runLength >= minRun) {
        issues.push({
          patternId,
          charOffset: sentences[runStart].offset,
          category: "RHYTHM_MONOTONY",
          match: `${runLength} sentences starting with "${currentOpening}"`,
          sentence: sentences.slice(runStart, runStart + runLength).map(s => s.text.slice(0, 50)).join(" | "),
          fixTemplate: `${runLength} consecutive sentences start with "${currentOpening}". Vary openings: prepositional phrase, adverb, participial phrase, dialogue, or different subject.`,
        })
      }
      currentOpening = opening
      runStart = i
      runLength = 1
    }
  }

  // Check final run
  if (runLength >= minRun) {
    issues.push({
      patternId,
      charOffset: sentences[runStart].offset,
      category: "RHYTHM_MONOTONY",
      match: `${runLength} sentences starting with "${currentOpening}"`,
      sentence: sentences.slice(runStart, runStart + runLength).map(s => s.text.slice(0, 50)).join(" | "),
      fixTemplate: `${runLength} consecutive sentences start with "${currentOpening}". Vary openings.`,
    })
  }

  return issues
}

// ── RM-3: Compound sentence dominance ─────────────────────────────────────

const COMPOUND_PATTERN = /,\s+(and|but|so|yet|or|nor)\s+/i

function detectCompoundDominance(
  sentences: Sentence[], config: RhythmConfig["compoundDominance"], patternId: number,
): LintIssue[] {
  const issues: LintIssue[] = []
  const { windowSize, threshold } = config
  if (sentences.length < windowSize) return issues

  for (let i = 0; i <= sentences.length - windowSize; i += Math.floor(windowSize / 2)) {
    const window = sentences.slice(i, i + windowSize)
    const compoundCount = window.filter(s => COMPOUND_PATTERN.test(s.text)).length
    const ratio = compoundCount / windowSize

    if (ratio > threshold) {
      issues.push({
        patternId,
        charOffset: window[0].offset,
        category: "RHYTHM_MONOTONY",
        match: `${compoundCount}/${windowSize} compound sentences (${(ratio * 100).toFixed(0)}%)`,
        sentence: window[0].text.slice(0, 80),
        fixTemplate: `${(ratio * 100).toFixed(0)}% compound sentences in this passage (threshold: ${(threshold * 100).toFixed(0)}%). Mix in simple ("She ran."), complex (subordinate clauses), and fragmented structures.`,
      })
    }
  }

  return issues
}

// ── PH-1: Paragraph length uniformity ─────────────────────────────────────

function detectParagraphUniformity(
  paragraphs: Paragraph[], config: RhythmConfig["paragraphLengthCV"], patternId: number,
): LintIssue[] {
  const issues: LintIssue[] = []
  const { windowSize, tolerance } = config

  // Filter out very short paragraphs (dialogue tags, whitespace)
  const substantial = paragraphs.filter(p => p.words >= 5)
  if (substantial.length < windowSize) return issues

  for (let i = 0; i <= substantial.length - windowSize; i += 2) {
    const window = substantial.slice(i, i + windowSize)
    const wordCounts = window.map(p => p.words)
    const m = mean(wordCounts)
    const allWithinBand = wordCounts.every(w => Math.abs(w - m) / m <= tolerance)

    if (allWithinBand) {
      issues.push({
        patternId,
        charOffset: window[0].offset,
        category: "PARAGRAPH_HOMOGENEITY",
        match: `${windowSize} paragraphs within ${(tolerance * 100).toFixed(0)}% (${wordCounts.join(", ")} words)`,
        sentence: window[0].text.slice(0, 80),
        fixTemplate: `${windowSize} consecutive paragraphs have similar length (${wordCounts.join(", ")} words). Vary paragraph size: use a short 1-2 sentence paragraph for impact, a longer one for description.`,
      })
    }
  }

  return issues
}

// ── PH-2: Paragraph opening repetition ────────────────────────────────────

function detectParagraphOpeningRepetition(
  paragraphs: Paragraph[], config: RhythmConfig["paragraphOpeningRepetition"], patternId: number,
): LintIssue[] {
  const issues: LintIssue[] = []
  const { minRunWord } = config

  function getFirstWord(p: Paragraph): string {
    return (p.text.split(/\s+/)[0] || "").toLowerCase().replace(/[^a-z]/g, "")
  }

  let runStart = 0
  let current = getFirstWord(paragraphs[0] || { text: "" } as Paragraph)
  let runLength = 1

  for (let i = 1; i < paragraphs.length; i++) {
    const word = getFirstWord(paragraphs[i])
    if (word === current && word.length > 0) {
      runLength++
    } else {
      if (runLength >= minRunWord) {
        issues.push({
          patternId,
          charOffset: paragraphs[runStart].offset,
          category: "PARAGRAPH_HOMOGENEITY",
          match: `${runLength} paragraphs starting with "${current}"`,
          sentence: paragraphs[runStart].text.slice(0, 80),
          fixTemplate: `${runLength} consecutive paragraphs start with "${current}". Vary paragraph openings: setting detail, sensory impression, action, dialogue, subordinate clause.`,
        })
      }
      current = word
      runStart = i
      runLength = 1
    }
  }

  if (runLength >= minRunWord) {
    issues.push({
      patternId,
      charOffset: paragraphs[runStart].offset,
      category: "PARAGRAPH_HOMOGENEITY",
      match: `${runLength} paragraphs starting with "${current}"`,
      sentence: paragraphs[runStart].text.slice(0, 80),
      fixTemplate: `${runLength} consecutive paragraphs start with "${current}". Vary paragraph openings.`,
    })
  }

  return issues
}

// ── Main entry point ──────────────────────────────────────────────────────

export function lintRhythm(
  prose: string,
  patternIds: { rhythmMonotony: number; paragraphHomogeneity: number },
  config: RhythmConfig = DEFAULT_RHYTHM_CONFIG,
): LintIssue[] {
  const issues: LintIssue[] = []
  const narrationSentences = getNarrationSentences(prose)
  const paragraphs = splitParagraphs(prose)

  if (config.sentenceLengthCV.enabled) {
    issues.push(...detectSentenceLengthUniformity(narrationSentences, config.sentenceLengthCV, patternIds.rhythmMonotony))
  }
  if (config.openingRepetition.enabled) {
    issues.push(...detectOpeningRepetition(narrationSentences, config.openingRepetition, patternIds.rhythmMonotony))
  }
  if (config.compoundDominance.enabled) {
    issues.push(...detectCompoundDominance(narrationSentences, config.compoundDominance, patternIds.rhythmMonotony))
  }
  if (config.paragraphLengthCV.enabled) {
    issues.push(...detectParagraphUniformity(paragraphs, config.paragraphLengthCV, patternIds.paragraphHomogeneity))
  }
  if (config.paragraphOpeningRepetition.enabled) {
    issues.push(...detectParagraphOpeningRepetition(paragraphs, config.paragraphOpeningRepetition, patternIds.paragraphHomogeneity))
  }

  return issues
}
