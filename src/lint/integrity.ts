/**
 * Post-fix integrity guard for lint rewrites.
 *
 * The lint fixer is allowed to change local wording, but it must not create
 * malformed prose. Keep this deterministic and conservative: if a suspicious
 * artifact is newly introduced by the fixed text, reject the whole lint pass
 * and keep the raw draft.
 */

export interface LintFixIntegrityIssue {
  kind: "fused-boundary" | "camel-fusion" | "duplicate-sentence"
  excerpt: string
}

export interface LintFixIntegrityResult {
  pass: boolean
  issues: LintFixIntegrityIssue[]
}

export function validateLintFixIntegrity(original: string, fixed: string): LintFixIntegrityResult {
  const issues: LintFixIntegrityIssue[] = []

  for (const issue of detectFusedBoundaries(fixed)) {
    if (!original.includes(issue.excerpt)) issues.push(issue)
  }
  for (const issue of detectCamelFusions(fixed)) {
    if (!original.includes(issue.excerpt)) issues.push(issue)
  }
  for (const issue of detectNewDuplicateSentences(original, fixed)) {
    issues.push(issue)
  }

  return { pass: issues.length === 0, issues }
}

function detectFusedBoundaries(text: string): LintFixIntegrityIssue[] {
  const issues: LintFixIntegrityIssue[] = []
  for (let i = 0; i < text.length - 1; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (!".!?".includes(ch)) continue
    if (!/[A-Za-z]/.test(next)) continue
    if (ch === "." && text[i - 1] === ".") continue
    issues.push({ kind: "fused-boundary", excerpt: contextExcerpt(text, i) })
  }
  return dedupeIssues(issues)
}

function detectCamelFusions(text: string): LintFixIntegrityIssue[] {
  const issues: LintFixIntegrityIssue[] = []
  const re = /\b[a-z]{4,}[A-Z][a-z]{2,}\b/g
  for (const match of text.matchAll(re)) {
    issues.push({ kind: "camel-fusion", excerpt: match[0] })
  }
  return dedupeIssues(issues)
}

function detectNewDuplicateSentences(original: string, fixed: string): LintFixIntegrityIssue[] {
  const issues: LintFixIntegrityIssue[] = []
  const originalNorm = normalizeSentenceStream(original)
  const sentences = extractSentences(fixed)
  for (let i = 1; i < sentences.length; i++) {
    const prev = normalizeSentence(sentences[i - 1].text)
    const cur = normalizeSentence(sentences[i].text)
    if (!prev || prev !== cur) continue
    const pairNorm = `${prev} ${cur}`
    if (originalNorm.includes(pairNorm)) continue
    issues.push({ kind: "duplicate-sentence", excerpt: sentences[i].text.trim().slice(0, 120) })
  }
  return dedupeIssues(issues)
}

function extractSentences(text: string): Array<{ text: string; offset: number }> {
  const sentences: Array<{ text: string; offset: number }> = []
  const re = /[^.!?]+[.!?]+/g
  for (const match of text.matchAll(re)) {
    sentences.push({ text: match[0], offset: match.index ?? 0 })
  }
  return sentences
}

function normalizeSentenceStream(text: string): string {
  return extractSentences(text).map(s => normalizeSentence(s.text)).filter(Boolean).join(" ")
}

function normalizeSentence(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function contextExcerpt(text: string, index: number): string {
  return text.slice(Math.max(0, index - 20), Math.min(text.length, index + 24)).replace(/\s+/g, " ").trim()
}

function dedupeIssues(issues: LintFixIntegrityIssue[]): LintFixIntegrityIssue[] {
  const seen = new Set<string>()
  const result: LintFixIntegrityIssue[] = []
  for (const issue of issues) {
    const key = `${issue.kind}:${issue.excerpt}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(issue)
  }
  return result
}
