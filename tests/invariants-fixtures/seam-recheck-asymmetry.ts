// expected-invariant-failure: seam-recheck-symmetry
//
// A chapter-plan-checker recheck call with no paired DEBUG seam guard
// anywhere within the text window around the call site. Mirrors the
// fed9e4a regression class. Invariant #2 MUST fire on this file.
//
// Not run — intentionally malformed relative to drafting.ts. Fed only
// via `scripts/lint/invariants-check.ts --self-test`.

// @ts-nocheck
/* eslint-disable */

declare const callAgent: (args: unknown) => Promise<{ output: { pass: boolean; deviations: unknown[] } }>
declare const buildChapterPlanCheckContext: (prose: string, outline: unknown) => string
declare const CHAPTER_PLAN_CHECKER_PROMPT: string
declare const chapterPlanCheckSchema: unknown
declare const trace: (id: string, ev: unknown) => Promise<void>

// Single unguarded recheck site. No paired guard anywhere in this file.
// Must trip invariant #2.
async function driveRecheck(novelId: string, ch: number, outline: unknown, prose: string) {
  const attempts = 0
  const rewritePass = 1
  const recheck = await callAgent({
    novelId,
    agentName: "chapter-plan-checker",
    chapter: ch,
    attempt: attempts + rewritePass * 10,
    systemPrompt: CHAPTER_PLAN_CHECKER_PROMPT,
    userPrompt: buildChapterPlanCheckContext(prose, outline),
    schema: chapterPlanCheckSchema,
  })
  const out = recheck.output
  await trace(novelId, {
    eventType: "plan-check-outcome",
    chapter: ch,
    payload: { pass: out.pass, source: "recheck" },
  })
  return out
}

export { driveRecheck }
