/**
 * Regression test for `revisionUsed` persistence across process restarts
 * (docs/archive/2026-04/next-session-plan.md §Tier 1a, Codex review a252aecbb785a0eb3).
 *
 * Before sql/031 + the DB-backed init, `let revisionUsed = false` reset on
 * every process startup, allowing a second reviser invocation after restart.
 * Observed on novel-1776616563937: chapter 1 had 2 non-skip chapter_revisions
 * rows because the orchestrator restarted between drafting attempts.
 *
 * Two invariants tested:
 *
 * (a) Fresh chapter: isRevisionUsed returns false → plan-check reviser fires
 *     → setRevisionUsed(true) is called before the reviser LLM call →
 *     revisionUsed is true for the rest of the attempt.
 *
 * (b) Resumed chapter (simulates restart): isRevisionUsed returns true →
 *     plan-check branch takes the skip path WITHOUT calling the reviser →
 *     a skip_already_revised chapter_revisions row is logged.
 *
 * Mocks at the module boundary — no LLM or DB state is touched.
 */
import { mock, test, expect, beforeEach, afterEach } from "bun:test"
import { buildBeatChecksMock } from "./beat-checks.mock-shape"

// ── Shared mock state (reset per test) ─────────────────────────────────
let isRevisionUsedInitial = false
// Tracks the exact sequence of interesting calls so tests can assert
// "setRevisionUsed(true) was called BEFORE the reviser LLM call"
// (Codex review D: ordering invariant).
let callOrder: string[] = []
let setRevisionUsedCalls: boolean[] = []
let setRevisionUsedShouldReject = false
let reviserCallCount = 0
let planCheckBehavior: "fail" | "pass" = "fail"
let logRevisionOutcomes: string[] = []
let logCalls: string[] = []
let consoleLines: string[] = []
let gateFires: { kind: string; chapter: number }[] = []
let saveChapterOutlineCallCount = 0

// ── Module mocks ────────────────────────────────────────────────────────
mock.module("../config/pipeline", () => ({
  pipeline: {
    maxDraftAttempts: 2,
    beatLevelWriting: true,
    maxBeatRetries: 0,
    chapterPlanCheck: true,
    maxChapterPlanRewritePasses: 1,
    embeddings: false,
    defaultTargetWords: 500,
    minWords: 300,
    tonalPass: false,
    sceneCallWriterV1: false,
    writerExpansionMode: "off",
    forceRenderSceneContractWhenAvailable: false,
    writerPromptIdRendering: "raw",
    draftCaptureModeV1: false,
  },
  resolveSceneCallWriterV1: () => false,
  resolveWriterExpansionMode: () => "off",
  resolveForceRenderSceneContractWhenAvailable: () => false,
  resolveWriterPromptIdRendering: () => "raw",
  resolveDraftCaptureModeV1: () => false,
}))

mock.module("../logger", () => ({
  log: (_n: string, _l: string, msg: string) => { logCalls.push(msg) },
}))

// Invariant #4 cross-file compatibility: the sibling
// `drafting-reviser-escalation.test.ts` parks an `__invariant4State` slot
// on `globalThis` so EITHER file's `../events` / `../gates` / `../cli`
// mock can route through the real-replication path. This file never
// enables that path (its `useRealPresentForExhaustion` stays false), but
// we must not step on the sibling's state when both files run in the
// same `bun test` invocation (bun's module-mock registry is process-global
// and drafting binds to whichever mock registered first).
mock.module("../events", () => ({
  emit: (_novelId: string, event: { type: string; data: unknown }) => {
    const state = (globalThis as any).__invariant4State
    if (state && state.useRealPresentForExhaustion) {
      state.emittedEvents.push({ type: event.type, data: event.data })
    }
  },
}))
mock.module("../trace", () => ({ trace: async () => {} }))
mock.module("../db/chapter-exhaustions", () => ({
  logExhaustionFired: async () => 0,
  logExhaustionResolved: async () => true,
}))

mock.module("../db", () => ({
  getNovel: async () => ({
    id: "test-novel", phase: "drafting", currentChapter: 1, totalChapters: 1,
    seed: { genre: "sci-fi" },
  }),
  getChapterOutline: async () => ({
    chapter: 1, title: "Test Chapter", povCharacter: "Alice",
    setting: "Lab", targetWords: 500, charactersPresent: ["Alice"],
    scenes: [
      { description: "Alice begins.", characters: ["Alice"], pov: "Alice", kind: "description", setting: "Lab" },
      { description: "Alice reflects.", characters: ["Alice"], pov: "Alice", kind: "interiority", setting: "Lab" },
      { description: "Alice decides.", characters: ["Alice"], pov: "Alice", kind: "action", setting: "Lab" },
    ],
    establishedFacts: [], characterStateChanges: [], knowledgeChanges: [],
  }),
  getChapterOutlines: async () => [{
    chapter: 1, title: "Test Chapter", povCharacter: "Alice",
    setting: "Lab", targetWords: 500, charactersPresent: ["Alice"],
    scenes: [
      { description: "Alice begins.", characters: ["Alice"], pov: "Alice", kind: "description", setting: "Lab" },
      { description: "Alice reflects.", characters: ["Alice"], pov: "Alice", kind: "interiority", setting: "Lab" },
      { description: "Alice decides.", characters: ["Alice"], pov: "Alice", kind: "action", setting: "Lab" },
    ],
    establishedFacts: [], characterStateChanges: [], knowledgeChanges: [],
  }],
  saveChapterOutline: async () => { saveChapterOutlineCallCount++ },
  getCharacters: async () => [{ id: "alice", name: "Alice", role: "protagonist" }],
  getFactsUpToChapter: async () => [],
  getCharacterStatesAtChapter: async () => [],
  getAllCharacterStatesBeforeChapter: async () => [],
  getWorldBible: async () => ({}),
  saveChapterDraft: async () => {},
  approveChapterDraft: async () => {},
  getApprovedDraft: async () => null,
  saveIssue: async () => {},
  updateCurrentChapter: async () => {},
  updatePhase: async () => {},
  logRevision: async (input: any) => { logRevisionOutcomes.push(input.outcome) },
  canonicalizeDeviations: (devs: any[]) => JSON.stringify(devs),
  isPlanCheckOverridden: async () => false,
  setPlanCheckOverridden: async () => {},
  // The persistence pair under test — isRevisionUsedInitial is set per-test
  // to simulate fresh vs. resumed chapter state.
  isRevisionUsed: async () => isRevisionUsedInitial,
  setRevisionUsed: async (_n: string, _c: number, v: boolean) => {
    callOrder.push(`setRevisionUsed(${v})`)
    setRevisionUsedCalls.push(v)
    if (setRevisionUsedShouldReject) {
      throw new Error("simulated DB write failure")
    }
  },
}))

mock.module("../llm", () => ({
  callAgent: async (config: any) => {
    if (config.agentName === "chapter-plan-checker") {
      return { output: planCheckBehavior === "pass"
        ? { pass: true, deviations: [], setting_match: null, emotional_arc_correct: null }
        : { pass: false, deviations: [{ description: "persistent deviation", beat_index: 0 }], setting_match: null, emotional_arc_correct: null }
      }
    }
    if (config.agentName === "chapter-plan-reviser") {
      callOrder.push("reviserCall")
      reviserCallCount++
      // Return a valid plan with enough beats to clear the sanity checks
      return { output: {
        scenes: [
          { description: "Rev beat 0.", characters: ["Alice"], pov: "Alice", kind: "description", setting: "Lab" },
          { description: "Rev beat 1.", characters: ["Alice"], pov: "Alice", kind: "action", setting: "Lab" },
          { description: "Rev beat 2.", characters: ["Alice"], pov: "Alice", kind: "interiority", setting: "Lab" },
        ],
        establishedFacts: [], characterStateChanges: [], knowledgeChanges: [],
      } }
    }
    throw new Error(`Unexpected callAgent: ${config.agentName}`)
  },
  executeAndLog: async () => ({ content: "Beat prose content. ".repeat(20) }),
}))

mock.module("../transport", () => ({ getTransport: () => ({}) }))
mock.module("../agents/writer/context", () => ({ buildContext: async () => "ctx" }))
mock.module("../agents/writer/beat-context", () => ({
  buildBeatContext: async () => ({ userPrompt: "user prompt" }),
}))
mock.module("../agents/writer/reference-resolver", () => ({
  resolveReferences: async () => ({ context: "", lookupCount: 0, llmUsed: false }),
}))
// NOTE: `bun:test` module mocks are process-global. See comment in
// drafting-reviser-escalation.test.ts — shape lives in `./beat-checks.mock-shape.ts`.
mock.module("./beat-checks", buildBeatChecksMock)
mock.module("../agents/continuity/check", () => ({
  checkContinuity: async () => ({ issues: [] }),
}))
mock.module("../agents/chapter-plan-checker/context", () => ({ buildContext: () => "ctx" }))
mock.module("../agents/chapter-plan-checker/schema", () => ({
  chapterPlanCheckSchema: {
    parse: (value: any) => ({
      ...value,
      deviations: (value.deviations ?? []).map((d: any) =>
        typeof d === "string" ? { description: d, beat_index: null } : d,
      ),
    }),
  },
  attachChapterPlanDeviationBeatIds: (result: any, outline: any) => ({
    ...result,
    deviations: (result.deviations ?? []).map((d: any) => {
      const beatId = d.beat_index == null ? undefined : outline?.scenes?.[d.beat_index]?.beatId
      return beatId ? { ...d, beatId } : { ...d }
    }),
  }),
  resolveDeviationBeatId: (outline: any, beatIndex: number | null) =>
    beatIndex == null ? undefined : outline?.scenes?.[beatIndex]?.beatId,
}))
mock.module("../agents/chapter-plan-reviser/context", () => ({
  buildContext: () => "ctx",
  buildContextForValidation: () => "ctx-validation",
}))
mock.module("../agents/chapter-plan-reviser", () => ({
  chapterBeatsSchema: {},
  prompt: "reviser-prompt",
}))
mock.module("../validation", () => ({
  validateChapterDraft: () => ({ passed: true, blockers: [], warnings: [] }),
}))
mock.module("../cli", () => ({
  displayPhaseHeader: () => {},
  displayProgress: () => {},
  presentForApproval: async () => "reject",
  presentForExhaustion: async (payload: any) => {
    // Sibling-invariant-#4 route: delegate to the real-replication path
    // when the sibling test file has flipped the global flag. See
    // drafting-reviser-escalation.test.ts for the orchestration.
    const state = (globalThis as any).__invariant4State
    if (state && state.useRealPresentForExhaustion) {
      const { requestPlanAssist } = await import("../gates")
      return await (requestPlanAssist as any)(payload, state.resolverMode)
    }
    gateFires.push({ kind: payload.kind, chapter: payload.chapter })
    return { action: "override" }
  },
  getRevisionNotes: async () => [],
}))
mock.module("../planned-state", () => ({ savePlannedState: async () => {} }))
mock.module("../state-diff", () => ({
  diffPlanAgainstState: () => ({ ok: true, conflicts: [] }),
}))
// NOTE: `../gates` is intentionally NOT mocked (Codex review a01385f5 HIGH
// #2). Persistence tests never trip the plan-assist gate themselves — they
// go through the `{action: "override"}` stub in the `../cli` mock above.
// The sibling file's invariant-#4 test DOES exercise real gates, so
// leaving the module unmocked here keeps behavior consistent if bun's
// global registry routes drafting.ts through this file's mocks.
mock.module("../lint", () => ({
  lintProse: async () => ({ totalIssues: 0, counts: {}, issues: [] }),
}))
mock.module("../lint/fix", () => ({
  fixLintIssues: async () => ({ prose: "", deterministicFixes: 0, llmFixes: 0, unfixed: 0, llmCalls: 0, costUsd: 0 }),
}))
mock.module("../models/roles", () => ({
  getModelForAgent: () => ({ provider: "deepseek", model: "deepseek-v4-flash", temperature: 0.8, maxTokens: 4000 }),
}))
mock.module("../prompts", () => ({
  WRITER_AGENT_PROMPT: "w", BEAT_WRITER_PROMPT: "bw", CHAPTER_PLAN_CHECKER_PROMPT: "pc",
}))
mock.module("../types", () => ({ chapterDraftSchema: {} }))
// Phase 4 commit 5 — short-circuit the snapshot gate. Test fixtures don't
// seed a planning_snapshots row, and the real `assertDraftableSnapshot`
// would hit the DB to recompute the live hash. The mock returns a clean
// "no lock" pass-through, matching the contract for novels without a lock.
mock.module("../canon/planning-snapshot", () => ({
  assertDraftableSnapshot: async () => ({
    ok: true,
    locked: false,
    drift: false,
    liveHash: "0".repeat(64),
    reason: "",
  }),
}))

const { runDraftingPhase } = await import("./drafting")

// ── Test lifecycle ─────────────────────────────────────────────────────
const originalConsoleLog = console.log
const originalConsoleError = console.error

beforeEach(() => {
  isRevisionUsedInitial = false
  callOrder = []
  setRevisionUsedCalls = []
  setRevisionUsedShouldReject = false
  reviserCallCount = 0
  planCheckBehavior = "fail"
  logRevisionOutcomes = []
  logCalls = []
  consoleLines = []
  gateFires = []
  saveChapterOutlineCallCount = 0
  // Ensure the sibling invariant-#4 global state is OFF during this file's
  // tests — they use the legacy {action:"override"} stub path.
  const state = (globalThis as any).__invariant4State
  if (state) state.useRealPresentForExhaustion = false
  console.log = (...args: any[]) => { consoleLines.push(args.map(a => String(a)).join(" ")) }
  console.error = (...args: any[]) => { consoleLines.push(args.map(a => String(a)).join(" ")) }
})

afterEach(() => {
  console.log = originalConsoleLog
  console.error = originalConsoleError
})

// ── Tests ──────────────────────────────────────────────────────────────

test("(a) fresh chapter: reviser fires and setRevisionUsed(true) is called before the LLM call", async () => {
  // Simulate a fresh chapter — no prior restart.
  // isRevisionUsed returns false → reviser must fire.
  isRevisionUsedInitial = false
  planCheckBehavior = "fail"

  await runDraftingPhase("test-novel")

  // Reviser fired exactly once
  expect(reviserCallCount).toBe(1)

  // setRevisionUsed was called with true — the DB write must happen
  // (the local flag flip alone is not sufficient for restart protection)
  const trueWrites = setRevisionUsedCalls.filter(v => v === true)
  expect(trueWrites.length).toBeGreaterThanOrEqual(1)

  // ORDERING INVARIANT (Codex review D, HIGH): setRevisionUsed(true) MUST
  // be AWAITED before the reviser LLM call. If this order reverses, a
  // restart after a successful reviser call but before the (fire-and-forget)
  // DB write would let the reviser fire again.
  const firstSet = callOrder.indexOf("setRevisionUsed(true)")
  const firstReviser = callOrder.indexOf("reviserCall")
  expect(firstSet).toBeGreaterThanOrEqual(0)
  expect(firstReviser).toBeGreaterThanOrEqual(0)
  expect(firstSet).toBeLessThan(firstReviser)

  // The log message confirming reviser invocation must appear
  const invokeLogs = logCalls.filter(l => l.includes("Invoking chapter-plan-reviser"))
  expect(invokeLogs.length).toBe(1)

  // No "persisted from prior attempt" startup log — this is a fresh chapter
  const persistedLogs = logCalls.filter(l => l.includes("persisted from prior attempt"))
  expect(persistedLogs.length).toBe(0)
})

test("(c) DB write failure: setRevisionUsed rejects → reviser is NOT called", async () => {
  // Regression for Codex review A (HIGH): prior fire-and-forget shape let
  // the reviser run even when the persistence write failed, leaving a
  // durable revision_used=FALSE after a successful revision. After the
  // await-before-reviser fix, the reviser must NOT fire.
  isRevisionUsedInitial = false
  planCheckBehavior = "fail"
  setRevisionUsedShouldReject = true

  // runDraftingPhase may swallow or rethrow the error — we don't care about
  // the final state, only that the reviser didn't run.
  await runDraftingPhase("test-novel").catch(() => { /* expected */ })

  // Reviser must NOT have fired — the guard couldn't be persisted
  expect(reviserCallCount).toBe(0)

  // setRevisionUsed was attempted (the await threw)
  expect(setRevisionUsedCalls.length).toBeGreaterThanOrEqual(1)

  // callOrder should have the setRevisionUsed attempt but NOT a reviserCall
  // following it in the same attempt sequence
  expect(callOrder).toContain("setRevisionUsed(true)")
  expect(callOrder).not.toContain("reviserCall")
})

test("(b) resumed chapter: isRevisionUsed=true suppresses reviser — skip_already_revised logged", async () => {
  // Simulate restart: the prior session had already called the reviser and
  // persisted revision_used=true to chapter_outlines. On resume,
  // isRevisionUsed returns true → the reviser must NOT fire.
  isRevisionUsedInitial = true
  planCheckBehavior = "fail"

  await runDraftingPhase("test-novel")

  // Reviser must never fire — the hard cap holds across restart
  expect(reviserCallCount).toBe(0)

  // The startup log confirms the persisted flag was detected
  const persistedLogs = logCalls.filter(l => l.includes("persisted from prior attempt"))
  expect(persistedLogs.length).toBe(1)

  // The skip path must have logged at least one skip_already_revised
  // chapter_revisions row
  const skipRevisions = logRevisionOutcomes.filter(o => o === "skip_already_revised")
  expect(skipRevisions.length).toBeGreaterThanOrEqual(1)

  // Correspondingly, the skip-path log message must appear in the warn log
  const skipLogs = logCalls.filter(l => l.includes("already revised this chapter"))
  expect(skipLogs.length).toBeGreaterThanOrEqual(1)

  // No new DB write — the flag is already true, no reason to re-set it
  expect(setRevisionUsedCalls.length).toBe(0)
})

// ── Invariant #1 (exp #243) — restart persistence regression belt ────
//
// Simulates process-restart BETWEEN reviser-fire and outcome-log completion.
// The DB-backed `isRevisionUsed` / `setRevisionUsed` pair must ensure that
// across pre-restart + post-restart drafting entries, the total non-skip
// chapter_revisions write count is EXACTLY 1. A regression of commit a2118e1
// (in-memory-only flag) would let the post-restart entry fire a second
// reviser call and log a second non-skip outcome.
test("Invariant #1: reviser-then-restart → total non-skip chapter_revisions writes stays at 1", async () => {
  // ── Pre-restart attempt ─────────────────────────────────────────────
  // Fresh chapter, plan-check fails, reviser fires once, outcome logged.
  isRevisionUsedInitial = false
  planCheckBehavior = "fail"

  await runDraftingPhase("test-novel")

  const preRestartReviserCalls = reviserCallCount
  const preRestartNonSkipOutcomes = logRevisionOutcomes.filter(
    o => o !== "skip_already_revised"
      && o !== "skip_duplicate_sig"
      && o !== "skip_no_beat_state",
  ).length

  // Reviser fired once; one non-skip outcome was logged in the pre-restart
  // session (setRevisionUsed(true) completed before the "restart").
  expect(preRestartReviserCalls).toBe(1)
  expect(preRestartNonSkipOutcomes).toBe(1)

  // ── Simulate process restart ────────────────────────────────────────
  // The DB persisted revision_used=true. All in-memory state is cleared,
  // but the cumulative non-skip outcome count carries forward (we're
  // checking the invariant across BOTH attempts).
  isRevisionUsedInitial = true
  planCheckBehavior = "fail"
  reviserCallCount = 0
  setRevisionUsedCalls = []
  callOrder = []
  logCalls = []
  consoleLines = []
  gateFires = []
  saveChapterOutlineCallCount = 0
  // Do NOT reset logRevisionOutcomes — we're asserting on the cumulative
  // total. A second reviser firing would push a second non-skip outcome.

  await runDraftingPhase("test-novel")

  // ── Assertions — the invariant ─────────────────────────────────────
  // Post-restart: reviser must NOT fire a second time.
  expect(reviserCallCount).toBe(0)

  // setRevisionUsed(true) must NOT be called again (flag already persisted).
  expect(setRevisionUsedCalls.length).toBe(0)

  // Startup log for resumed chapter confirms the persisted flag was detected.
  const persistedLogs = logCalls.filter(l => l.includes("persisted from prior attempt"))
  expect(persistedLogs.length).toBe(1)

  // THE INVARIANT: cumulative non-skip chapter_revisions writes across both
  // pre-restart and post-restart sessions MUST remain at exactly 1.
  // A regression of commit a2118e1 would push this to >= 2.
  const cumulativeNonSkip = logRevisionOutcomes.filter(
    o => o !== "skip_already_revised"
      && o !== "skip_duplicate_sig"
      && o !== "skip_no_beat_state",
  ).length
  expect(cumulativeNonSkip).toBe(1)

  // And the post-restart attempt must have logged at least one skip_already_revised
  // row — proving the skip path actually fired.
  const postRestartSkips = logRevisionOutcomes.filter(o => o === "skip_already_revised")
  expect(postRestartSkips.length).toBeGreaterThanOrEqual(1)
})
