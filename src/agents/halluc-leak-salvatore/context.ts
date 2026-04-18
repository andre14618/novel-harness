/**
 * Render the per-writer leak check prompt. Prose-only by design — the
 * adapter was trained on prose alone (see
 * `scripts/hallucination/format-v3-two-adapters.ts`, LEAK_SYSTEM +
 * leak-set builder) because a token-list rubric doesn't need beat /
 * world-bible / speaker context. Adding more context here would drift
 * from the training distribution.
 */
export function buildContext(prose: string): string {
  return `PROSE:\n${prose}`
}
