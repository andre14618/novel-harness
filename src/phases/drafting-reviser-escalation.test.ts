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
let overrideInitial = false
let overrideSetCount = 0
let reviserCallCount = 0
let planCheckCallCount = 0
let saveChapterOutlineCallCount = 0
let gateFires: { kind: string; chapter: number }[] = []
let logCalls: string[] = []
let consoleLines: string[] = []

// ── Invariant #4 (exp #243) shared mock state ───────────────────────
// When `useRealPresentForExhaustion` is true, the `../cli` mock replicates
// the real `src/cli.ts:179-222 presentForExhaustion` logic, branching on
// `invariant4ResolverMode` and delegating to the `../gates` mock's
// `requestPlanAssist` (which the test swaps per-mode). When false (default),
// existing tests keep their `{action:"override"}` stub behavior.
//
// State kept on `globalThis` rather than module-local vars because
// bun:test's module-mock registry is process-global: when both
// `drafting-revision-used-persistence.test.ts` and this file run in the
// same invocation, drafting ends up bound to whichever file's `../cli`
// mock was registered first, and module-local vars in the other file's
// mock body would be unreachable. A globalThis-keyed flag + helper is the
// one place both files' mocks can read from without import cycles.
type InvariantFourState = {
  useRealPresentForExhaustion: boolean
  resolverMode: "auto" | "cli" | "web"
  emittedEvents: { type: string; data: unknown }[]
  requestPlanAssistPayloads: { kind: string; chapter: number; mode: string }[]
  planAssistDecision: { action: "override" | "abort" | "edit-plan"; outline?: unknown }
}
declare global {
  // eslint-disable-next-line no-var
  var __invariant4State: InvariantFourState | undefined
}
function getInvariant4State(): InvariantFourState {
  if (!globalThis.__invariant4State) {
    globalThis.__invariant4State = {
      useRealPresentForExhaustion: false,
      resolverMode: "cli",
      emittedEvents: [],
      requestPlanAssistPayloads: [],
      planAssistDecision: { action: "abort" },
    }
  }
  return globalThis.__invariant4State
}

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

mock.module("../events", () => ({
  emit: (_novelId: string, event: { type: string; data: unknown }) => {
    const s = getInvariant4State()
    if (s.useRealPresentForExhaustion) {
      s.emittedEvents.push({ type: event.type, data: event.data })
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
  // `overrideInitial` is the persisted value at the TOP of each attempt.
  // A test that wants "override effective from attempt 1" sets it true
  // via beforeEach override. The real DB would flip this to true on the
  // NEXT attempt after setPlanCheckOverridden fires; we track writes
  // via overrideSetCount for assertion without re-reading.
  isPlanCheckOverridden: async () => overrideInitial,
  setPlanCheckOverridden: async (_n: string, _c: number, _v: boolean) => { overrideSetCount++ },
  // revisionUsed persistence (sql/031) — start false so existing tests
  // exercise the same fresh-chapter path as before the DB-backed init.
  isRevisionUsed: async () => false,
  setRevisionUsed: async () => {},
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
  // Two modes:
  //   - Default (useRealPresentForExhaustion=false): the legacy stub used
  //     by all pre-invariant-#4 tests — returns `{action:"override"}` so
  //     attempts 2 and 3 continue through the skip path, and records each
  //     gate fire for wire-in assertions.
  //   - Invariant #4 (useRealPresentForExhaustion=true): replicates the
  //     real `src/cli.ts:179-222 presentForExhaustion` logic so the
  //     resolver-mode branching inside gates.requestPlanAssist is actually
  //     exercised. The real function's body is short enough to inline
  //     without creating a new module-import dance.
  presentForExhaustion: async (payload: any) => {
    const s = getInvariant4State()
    if (s.useRealPresentForExhaustion) {
      const { requestPlanAssist } = await import("../gates")
      // Real presentForExhaustion just calls requestPlanAssist(payload, mode)
      // and returns whatever it resolves/throws. No other branching lives
      // there — CLI readline happens further down and doesn't apply to
      // auto/web paths under test.
      return await requestPlanAssist(payload, s.resolverMode as any)
    }
    gateFires.push({ kind: payload.kind, chapter: payload.chapter })
    return { action: "override" }
  },
  getRevisionNotes: async () => [],
  // Expose the mode-setters so existing-test contracts aren't broken;
  // the invariant-#4 test uses the globalThis state object directly.
  setResolverMode: (mode: "auto" | "cli" | "web") => { getInvariant4State().resolverMode = mode },
  getResolverMode: () => getInvariant4State().resolverMode,
}))
mock.module("../planned-state", () => ({ savePlannedState: async () => {} }))
mock.module("../state-diff", () => ({
  diffPlanAgainstState: () => ({ ok: true, conflicts: [] }),
}))
// Minimal PipelineBailError shim — matches the real `../gates` export shape
// enough for drafting.ts's `import { PipelineBailError } from "../gates"` and
// the test's catch-instanceof check. Only relevant in invariant #4 tests.
class InvariantFourPipelineBailError extends Error {
  constructor(
    public readonly kind: string,
    public readonly novelId: string,
    public readonly chapter: number,
    public readonly payload: unknown,
  ) {
    super(`Pipeline bailed at plan-assist gate (chapter ${chapter}, kind ${kind})`)
    this.name = "PipelineBailError"
  }
}
mock.module("../gates", () => ({
  getPending: () => null,
  getPendingPlanAssist: () => null,
  resolvePlanAssist: () => false,
  PipelineBailError: InvariantFourPipelineBailError,
  requestPlanAssist: async (payload: { kind: string; chapter: number }, mode: string) => {
    const s = getInvariant4State()
    if (!s.useRealPresentForExhaustion) {
      // Existing tests never exercise this path — the `../cli`
      // stub short-circuits before reaching gates.requestPlanAssist.
      throw new Error("gates.requestPlanAssist called from an existing test path (unexpected)")
    }
    s.requestPlanAssistPayloads.push({
      kind: payload.kind,
      chapter: payload.chapter,
      mode,
    })
    // Replicate real `src/gates.ts:requestPlanAssist` event emission in ALL
    // modes — the invariant asserts event-type parity across modes, so this
    // MUST fire the same `gate:plan-assist` event regardless of branch.
    s.emittedEvents.push({
      type: "gate:plan-assist",
      data: { kind: payload.kind, chapter: payload.chapter },
    })
    if (mode === "auto") {
      throw new InvariantFourPipelineBailError(payload.kind, "test-novel", payload.chapter, payload)
    }
    return s.planAssistDecision
  },
}))
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
  overrideInitial = false
  overrideSetCount = 0
  reviserCallCount = 0
  planCheckCallCount = 0
  saveChapterOutlineCallCount = 0
  gateFires = []
  logCalls = []
  consoleLines = []
  // Invariant #4 state — reset so existing tests see the legacy stub path
  const s = getInvariant4State()
  s.useRealPresentForExhaustion = false
  s.resolverMode = "cli"
  s.emittedEvents = []
  s.requestPlanAssistPayloads = []
  s.planAssistDecision = { action: "abort" }
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

  // Gate wire-in — attempts 2 and 3 hit the exhausted path and fire the
  // plan-assist gate with kind=plan-check-exhausted. Attempt 1 accepts
  // the reviser revision, so no gate fires there.
  expect(gateFires.length).toBe(2)
  expect(gateFires.every(g => g.kind === "plan-check-exhausted")).toBe(true)
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

  // Gate wire-in — attempt 1 fires reviser-rejected (reviser threw),
  // attempts 2 and 3 fire plan-check-exhausted. Three fires total.
  expect(gateFires.length).toBe(3)
  expect(gateFires[0].kind).toBe("reviser-rejected")
  expect(gateFires[1].kind).toBe("plan-check-exhausted")
  expect(gateFires[2].kind).toBe("plan-check-exhausted")
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

  // Gate wire-in for validation path — attempts 2 and 3 fire
  // plan-check-exhausted via the validation branch (revisionUsed=true,
  // so the validation-reviser can't run; the unified plan-assist gate
  // fires via the "else" fall-through).
  expect(gateFires.length).toBe(2)
  expect(gateFires.every(g => g.kind === "plan-check-exhausted")).toBe(true)
})

// ── Invariant #4 (exp #243) — branch-symmetric event emission ────────
//
// The auto vs. web divergence at the plan-assist exhaustion gate was the
// root cause of commit a2118e1. The real fault lived in
// `src/cli.ts:179-222 presentForExhaustion` and the module-level
// `resolverMode` state — NOT a `pipeline.mode` toggle. This test exercises
// the real `presentForExhaustion` logic (replicated in the `../cli` mock
// above) against a mocked `../gates.requestPlanAssist` that throws
// PipelineBailError in auto mode and resolves a canned decision in web
// mode. Event-type sequences emitted during the gate-fire transition MUST
// be identical across modes. Payload details (timestamps, modes) may differ.
test("Invariant #4: plan-assist gate fires the same event sequence in auto and web modes", async () => {
  // Shared driver: plan-check persistently fails → attempt 1 accepts
  // reviser revision; attempt 2 hits the "already revised" skip path and
  // sets pendingExhaustion=plan-check-exhausted → fires the plan-assist gate.
  planCheckBehavior = "fail"
  validateBehavior = "pass"
  reviserBehavior = "accept"

  // ── A. Auto mode ────────────────────────────────────────────────────
  const st = getInvariant4State()
  st.useRealPresentForExhaustion = true
  st.resolverMode = "auto"
  st.emittedEvents = []
  st.requestPlanAssistPayloads = []

  let autoBailCaught = false
  try {
    await runDraftingPhase("test-novel")
  } catch (err) {
    // PipelineBailError instance check — the invariant-four shim class is
    // what BOTH mock files export as `PipelineBailError`; whichever file's
    // `../gates` mock wins in bun's global registry, the thrown class has
    // `.name === "PipelineBailError"`.
    autoBailCaught = err instanceof Error && (err as Error).name === "PipelineBailError"
  }
  expect(autoBailCaught).toBe(true)

  const autoEvents = [...st.emittedEvents]
  const autoRequestPayloads = [...st.requestPlanAssistPayloads]

  // ── B. Web mode ─────────────────────────────────────────────────────
  // Reset counters + shared state for the second entry. Keep
  // useRealPresentForExhaustion=true — we want the same real-replication path.
  reviserBehavior = "accept"
  planCheckBehavior = "fail"
  validateBehavior = "pass"
  overrideInitial = false
  overrideSetCount = 0
  reviserCallCount = 0
  planCheckCallCount = 0
  saveChapterOutlineCallCount = 0
  gateFires = []
  logCalls = []
  consoleLines = []
  st.emittedEvents = []
  st.requestPlanAssistPayloads = []
  st.resolverMode = "web"
  st.planAssistDecision = { action: "abort" } // drafting returns after abort

  await runDraftingPhase("test-novel")

  const webEvents = [...st.emittedEvents]
  const webRequestPayloads = [...st.requestPlanAssistPayloads]

  // ── The invariant: event-type sequences match ───────────────────────
  // Both modes must emit at least one `gate:plan-assist` event — this is
  // the event type that flipped between modes in the a2118e1 class of bug.
  const autoGateEventTypes = autoEvents
    .filter(e => e.type.startsWith("gate:"))
    .map(e => e.type)
    .join("|")
  const webGateEventTypes = webEvents
    .filter(e => e.type.startsWith("gate:"))
    .map(e => e.type)
    .join("|")

  expect(autoGateEventTypes.length).toBeGreaterThan(0)
  expect(webGateEventTypes).toBe(autoGateEventTypes)

  // Both modes invoked requestPlanAssist with the same `kind`. The
  // resolver-mode param naturally differs (auto vs web) — but the gate
  // kind is the structural signal the orchestrator uses downstream.
  expect(autoRequestPayloads.length).toBeGreaterThan(0)
  expect(webRequestPayloads.length).toBeGreaterThan(0)
  expect(autoRequestPayloads[0].kind).toBe(webRequestPayloads[0].kind)
  expect(autoRequestPayloads[0].chapter).toBe(webRequestPayloads[0].chapter)

  // And the resolver-mode param that reached requestPlanAssist DID branch
  // per the test's driver — confirming real `presentForExhaustion` was
  // actually exercised (not the legacy stub).
  expect(autoRequestPayloads[0].mode).toBe("auto")
  expect(webRequestPayloads[0].mode).toBe("web")
})

test("plan-check override suppresses plan-check + validation-reviser when persisted", async () => {
  // Simulates "override was set on a prior session and persisted;
  // now drafting resumes for this chapter." isPlanCheckOverridden
  // returns true at the top of EVERY attempt, so plan-check must never
  // fire, validation blockers must not bail, and no gate ever opens.
  overrideInitial = true
  planCheckBehavior = "fail"   // would fail if called — must not be called
  validateBehavior = "fail-pov" // blockers present but must not bail

  await runDraftingPhase("test-novel")

  expect(planCheckCallCount).toBe(0)
  expect(reviserCallCount).toBe(0)
  expect(gateFires.length).toBe(0)
  expect(overrideSetCount).toBe(0) // no new override writes

  const overrideLogs = logCalls.filter(l => l.includes("plan-check override active"))
  expect(overrideLogs.length).toBe(3) // one per attempt (3 attempts)
})
