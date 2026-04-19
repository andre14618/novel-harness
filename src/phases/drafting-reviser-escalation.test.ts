/**
 * Regression test for the non-blind-retry architecture's reviser-gate invariant
 * (docs/todo.md §5, 2026-04-19): across multiple outer drafting attempts with
 * chapter-plan-checker persistently failing, `chapter-plan-reviser` must fire
 * at most once per chapter — even when the reviser's call throws.
 *
 * The load-bearing piece is `revisionUsed` in `src/phases/drafting.ts` (declared
 * outside the while-attempt loop, set BEFORE the reviser callAgent so a
 * schema/transport error can't trigger a second invocation). This test
 * exercises both happy-path and throwing-path behavior.
 *
 * Mocks at the module boundary — every `callAgent`/`executeAndLog`/DB/gate call
 * is stubbed, so no LLM or DB state is touched.
 */
import { mock, test, expect, beforeEach, afterEach } from "bun:test"

// ── Shared mock state (reset per test) ─────────────────────────────────
let reviserBehavior: "accept" | "throw" = "accept"
let planCheckBehavior: "fail" | "pass" = "fail"
let validateBehavior: "pass" | "fail-pov" = "pass"
let reviserCallCount = 0
let planCheckCallCount = 0
let saveChapterOutlineCallCount = 0
let logCalls: string[] = []
let consoleLines: string[] = []

// ── Module mocks (installed before dynamic import of drafting) ─────────
mock.module("../config/pipeline", () => ({
  pipeline: {
    maxDraftAttempts: 3,
    beatLevelWriting: true,
    maxBeatRetries: 0,
    chapterPlanCheck: true,
    maxChapterPlanRewritePasses: 1,
    embeddings: false,
    defaultTargetWords: 500,
    minWords: 300,
    tonalPass: false,
  },
}))

mock.module("../logger", () => ({
  log: (_n: string, _l: string, msg: string) => { logCalls.push(msg) },
}))

mock.module("../events", () => ({ emit: () => {} }))
mock.module("../trace", () => ({ trace: async () => {} }))

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
    ],
    establishedFacts: [], characterStateChanges: [], knowledgeChanges: [],
  }),
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
  logRevision: async () => {},
  canonicalizeDeviations: (devs: any[]) => JSON.stringify(devs),
}))

mock.module("../llm", () => ({
  callAgent: async (config: any) => {
    if (config.agentName === "chapter-plan-checker") {
      planCheckCallCount++
      return { output: planCheckBehavior === "pass"
        ? { pass: true, deviations: [], setting_match: null, emotional_arc_correct: null }
        : { pass: false, deviations: [{ description: "persistent deviation", beat_index: 0 }], setting_match: null, emotional_arc_correct: null }
      }
    }
    if (config.agentName === "chapter-plan-reviser") {
      reviserCallCount++
      if (reviserBehavior === "throw") throw new Error("reviser stub error")
      // 3 beats clears the minBeats = ceil(500/300) = 2 + hard floor of 3
      // post-revision sanity check.
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
mock.module("./beat-checks", () => ({
  runBeatChecks: async () => ({ pass: true, issues: [], retryLines: [] }),
  summarizeIssues: () => "no issues",
}))
mock.module("../agents/continuity/check", () => ({
  checkContinuity: async () => ({ issues: [] }),
}))
mock.module("../agents/chapter-plan-checker/context", () => ({ buildContext: () => "ctx" }))
mock.module("../agents/chapter-plan-checker/schema", () => ({ chapterPlanCheckSchema: {} }))
mock.module("../agents/chapter-plan-reviser/context", () => ({
  buildContext: () => "ctx",
  buildContextForValidation: () => "ctx-validation",
}))
mock.module("../agents/chapter-plan-reviser", () => ({
  chapterBeatsSchema: {},
  prompt: "reviser-prompt",
}))
mock.module("../validation", () => ({
  validateChapterDraft: () => validateBehavior === "pass"
    ? { passed: true, blockers: [], warnings: [] }
    : { passed: false, blockers: [`POV character "Alice" never mentioned in draft`], warnings: [] },
}))
mock.module("../cli", () => ({
  displayPhaseHeader: () => {},
  displayProgress: () => {},
  presentForApproval: async () => "reject",
  getRevisionNotes: async () => [],
}))
mock.module("../planned-state", () => ({ savePlannedState: async () => {} }))
mock.module("../state-diff", () => ({
  diffPlanAgainstState: () => ({ ok: true, conflicts: [] }),
}))
mock.module("../gates", () => ({ getPending: () => null }))
mock.module("../lint", () => ({
  lintProse: async () => ({ totalIssues: 0, counts: {}, issues: [] }),
}))
mock.module("../lint/fix", () => ({
  fixLintIssues: async () => ({ prose: "", deterministicFixes: 0, llmFixes: 0, unfixed: 0, llmCalls: 0, costUsd: 0 }),
}))
mock.module("../models/roles", () => ({
  getModelForAgent: () => ({ provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507", temperature: 0.8, maxTokens: 4000 }),
  resolveWriterPack: () => null,
}))
mock.module("../agents/writer", () => ({ loadGenrePackPrompt: async () => null }))
mock.module("../prompts", () => ({
  WRITER_AGENT_PROMPT: "w", BEAT_WRITER_PROMPT: "bw", CHAPTER_PLAN_CHECKER_PROMPT: "pc",
}))
mock.module("../types", () => ({ chapterDraftSchema: {} }))

const { runDraftingPhase } = await import("./drafting")

// ── Test lifecycle ─────────────────────────────────────────────────────
const originalConsoleLog = console.log
const originalConsoleError = console.error

beforeEach(() => {
  reviserBehavior = "accept"
  planCheckBehavior = "fail"
  validateBehavior = "pass"
  reviserCallCount = 0
  planCheckCallCount = 0
  saveChapterOutlineCallCount = 0
  logCalls = []
  consoleLines = []
  console.log = (...args: any[]) => { consoleLines.push(args.map(a => String(a)).join(" ")) }
  console.error = (...args: any[]) => { consoleLines.push(args.map(a => String(a)).join(" ")) }
})

afterEach(() => {
  console.log = originalConsoleLog
  console.error = originalConsoleError
})

// ── Tests ──────────────────────────────────────────────────────────────

test("reviser fires exactly once across 3 outer attempts when plan-check persistently fails (accepted path)", async () => {
  planCheckBehavior = "fail"
  validateBehavior = "pass"
  reviserBehavior = "accept"
  await runDraftingPhase("test-novel")

  expect(reviserCallCount).toBe(1)

  const escalatingLines = consoleLines.filter(l => l.includes("Escalating to chapter-plan-reviser"))
  expect(escalatingLines.length).toBe(1)

  const invokingLog = logCalls.filter(l => l.includes("Invoking chapter-plan-reviser"))
  expect(invokingLog.length).toBe(1)

  expect(saveChapterOutlineCallCount).toBe(1)

  // Attempts 2 and 3 must each hit the "already revised" skip path —
  // exactly once per attempt, so 2 total. A weaker `>=1` would pass if
  // revisionUsed leaked but one attempt still fired a second reviser.
  const skipLines = logCalls.filter(l => l.includes("already revised this chapter"))
  expect(skipLines.length).toBe(2)

  // plan-check ran at least once per attempt (3 attempts) and additional
  // times inside each attempt's settle loop. Exact count is implementation
  // detail — we just want to confirm multiple attempts happened.
  expect(planCheckCallCount).toBeGreaterThanOrEqual(3)
})

test("reviser fires exactly once across 3 outer attempts when reviser throws (error path)", async () => {
  planCheckBehavior = "fail"
  validateBehavior = "pass"
  reviserBehavior = "throw"
  await runDraftingPhase("test-novel")

  expect(reviserCallCount).toBe(1)

  const escalatingLines = consoleLines.filter(l => l.includes("Escalating to chapter-plan-reviser"))
  expect(escalatingLines.length).toBe(1)

  const reviserErrorLogs = logCalls.filter(l => l.includes("Chapter-plan-reviser failed"))
  expect(reviserErrorLogs.length).toBe(1)

  // revisionUsed is set BEFORE the reviser call, so even though reviser
  // threw, both attempts 2 and 3 must hit the skip path — exactly 2 logs.
  const skipLines = logCalls.filter(l => l.includes("already revised this chapter"))
  expect(skipLines.length).toBe(2)

  expect(saveChapterOutlineCallCount).toBe(0)
})

test("validation path — reviser fires exactly once when validation blockers persist", async () => {
  // Plan-check passes cleanly; validation fails on POV-missing and does
  // not resolve after targeted rewrites. Reviser must be invoked from the
  // validation branch, share the same `revisionUsed` chapter-wide hard cap
  // as the plan-check branch, and skip on attempts 2 and 3.
  planCheckBehavior = "pass"
  validateBehavior = "fail-pov"
  reviserBehavior = "accept"
  await runDraftingPhase("test-novel")

  expect(reviserCallCount).toBe(1)

  const validationInvokes = logCalls.filter(l =>
    l.includes("Invoking chapter-plan-reviser") && l.includes("validation path"),
  )
  expect(validationInvokes.length).toBe(1)

  const escalatingLines = consoleLines.filter(l =>
    l.includes("Escalating to chapter-plan-reviser (persistent validation blockers)"),
  )
  expect(escalatingLines.length).toBe(1)

  expect(saveChapterOutlineCallCount).toBe(1)

  // Attempts 2 and 3 hit the skip path via the SAME revisionUsed flag.
  const skipLines = logCalls.filter(l => l.includes("already revised this chapter"))
  expect(skipLines.length).toBe(2)

  // No plan-check-driven reviser — plan-check is mocked to always pass.
  const planCheckEscalates = consoleLines.filter(l =>
    l.includes("Escalating to chapter-plan-reviser (persistent issues)"),
  )
  expect(planCheckEscalates.length).toBe(0)

  // plan-check ran exactly once per outer attempt (no settle loop kicks
  // because pass=true means the settle precondition `!out.pass` fails).
  expect(planCheckCallCount).toBe(3)
})
