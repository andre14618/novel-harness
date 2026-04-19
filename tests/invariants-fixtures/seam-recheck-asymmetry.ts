// expected-invariant-failure: seam-recheck-symmetry
//
// 60-line excerpt mimicking src/phases/drafting.ts shape. The initial
// chapter-plan-checker call lives in `driveInitial` and is properly guarded
// by inject.forcePlanCheck. The recheck site lives in `driveRecheck` and
// has had its guard deleted, so the Seam-recheck symmetry invariant MUST
// fire on the recheck callAgent(). This mirrors the fed9e4a regression
// class — the recheck site losing the DEBUG_FORCE_* seam its initial
// sibling has.
//
// Not run — intentionally malformed relative to drafting.ts. Referenced
// only via `scripts/lint/invariants-check.ts --self-test`.

// @ts-nocheck
/* eslint-disable */

declare const callAgent: (args: unknown) => Promise<{ output: { pass: boolean; deviations: unknown[] } }>
declare const buildChapterPlanCheckContext: (prose: string, outline: unknown) => string
declare const CHAPTER_PLAN_CHECKER_PROMPT: string
declare const chapterPlanCheckSchema: unknown
declare const inject: { forcePlanCheck?: "fail" }
declare const trace: (id: string, ev: unknown) => Promise<void>

// ── Initial call — guarded by inject.forcePlanCheck. Symmetric. ──
async function driveInitial(novelId: string, ch: number, outline: unknown, prose: string) {
  const attempts = 0
  let out = (inject.forcePlanCheck === "fail")
    ? { pass: false as const, deviations: [{ description: "forced", beat_index: 0 }] }
    : (await callAgent({
        novelId,
        agentName: "chapter-plan-checker",
        chapter: ch,
        attempt: attempts,
        systemPrompt: CHAPTER_PLAN_CHECKER_PROMPT,
        userPrompt: buildChapterPlanCheckContext(prose, outline),
        schema: chapterPlanCheckSchema,
      })).output
  return out
}

// ── Recheck call — UNGUARDED. Must trip invariant #2. ──
async function driveRecheck(novelId: string, ch: number, outline: unknown, prose: string) {
  const attempts = 0
  const rewritePass = 1
  // Missing inject.forcePlanCheck guard on purpose.
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

export { driveInitial, driveRecheck }
