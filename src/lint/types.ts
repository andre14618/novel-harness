/**
 * Shared types for the lint system.
 */

export interface LintPattern {
  id: number
  tier: number
  category: string
  pattern: string
  flags: string
  fix_template: string
  dialogue_ok: number
  enabled: number
  rationale: string | null
  edge_cases: string | null
}

export interface LintIssue {
  patternId: number
  charOffset: number
  category: string
  match: string
  sentence: string
  fixTemplate: string
}

export interface LintResult {
  issues: LintIssue[]
  counts: Record<string, number>
  totalIssues: number
}

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
