import { describe, expect, test } from "bun:test"
import { classifySmokeStop, parseArgs, type ClassifierInput } from "./smoke-stop-classifier"

function baseInput(overrides: Partial<ClassifierInput> = {}): ClassifierInput {
  return {
    novel: { phase: "complete", current_chapter: 3, total_chapters: 3 },
    agentCosts: [{ agent: "writer", calls: 30, failed_calls: 0 }],
    exhaustions: [],
    failedCalls: [],
    ...overrides,
  }
}

describe("classifySmokeStop", () => {
  test("clean_pass on completed novel with no gates and no failures", () => {
    const r = classifySmokeStop(baseInput())
    expect(r.classification).toBe("clean_pass")
    expect(r.reason).toContain("completed 3/3")
  })

  test("new_blocker when pending gate of unknown kind exists", () => {
    const r = classifySmokeStop(
      baseInput({
        novel: { phase: "blocked", current_chapter: 2, total_chapters: 3 },
        exhaustions: [
          { kind: "halluc-ungrounded", decision: null, chapter: 2, attempt: 1 },
        ],
      }),
    )
    expect(r.classification).toBe("new_blocker")
    expect(r.reason).toContain("halluc-ungrounded")
  })

  test("known-kind pending gate is not a new blocker", () => {
    const r = classifySmokeStop(
      baseInput({
        novel: { phase: "blocked", current_chapter: 2, total_chapters: 3 },
        exhaustions: [
          { kind: "halluc-ungrounded", decision: null, chapter: 2, attempt: 1 },
        ],
      }),
      { knownBlockerKinds: new Set(["halluc-ungrounded"]) },
    )
    expect(r.classification).toBe("human_needed")
    expect(r.reason).toContain("known-class gate")
  })

  test("denied gate counts as new_blocker", () => {
    const r = classifySmokeStop(
      baseInput({
        novel: { phase: "blocked", current_chapter: 2, total_chapters: 3 },
        exhaustions: [
          { kind: "continuity-state", decision: "denied", chapter: 2, attempt: 1 },
        ],
      }),
    )
    expect(r.classification).toBe("new_blocker")
    expect(r.reason).toContain("denied")
  })

  test("regression on phase=failed with no pending gate", () => {
    const r = classifySmokeStop(
      baseInput({
        novel: { phase: "failed", current_chapter: 1, total_chapters: 3 },
        exhaustions: [],
      }),
    )
    expect(r.classification).toBe("regression")
    expect(r.reason).toContain("phase=failed")
  })

  test("ambiguous regression: phase=failed but gate pending → human_needed", () => {
    const r = classifySmokeStop(
      baseInput({
        novel: { phase: "failed", current_chapter: 1, total_chapters: 3 },
        exhaustions: [
          { kind: "halluc-ungrounded", decision: null, chapter: 1, attempt: 1 },
        ],
      }),
    )
    expect(r.classification).toBe("human_needed")
    expect(r.reason).toContain("ambiguous")
  })

  test("infra_failure when failed-call ratio exceeds threshold", () => {
    const r = classifySmokeStop(
      baseInput({
        novel: { phase: "blocked", current_chapter: 0, total_chapters: 3 },
        agentCosts: [{ agent: "writer", calls: 20, failed_calls: 8 }],
        failedCalls: [{ agent: "writer", count: 8, error_text: "timeout" }],
      }),
    )
    expect(r.classification).toBe("infra_failure")
    expect(r.reason).toContain("8/20")
  })

  test("infra_failure on absolute threshold even at low ratio", () => {
    const r = classifySmokeStop(
      baseInput({
        novel: { phase: "blocked", current_chapter: 1, total_chapters: 3 },
        agentCosts: [{ agent: "writer", calls: 200, failed_calls: 12 }],
      }),
    )
    expect(r.classification).toBe("infra_failure")
  })

  test("no LLM calls and not complete → human_needed", () => {
    const r = classifySmokeStop(
      baseInput({
        novel: { phase: "drafting", current_chapter: 0, total_chapters: 3 },
        agentCosts: [],
      }),
    )
    expect(r.classification).toBe("human_needed")
    expect(r.reason).toContain("no LLM calls")
  })

  test("partial run with no pending gates is human_needed (not clean_pass)", () => {
    const r = classifySmokeStop(
      baseInput({
        novel: { phase: "drafting", current_chapter: 1, total_chapters: 3 },
        exhaustions: [],
      }),
    )
    expect(r.classification).toBe("human_needed")
  })

  test("evidence is always populated", () => {
    const r = classifySmokeStop(baseInput())
    expect(r.evidence.length).toBeGreaterThanOrEqual(3)
    expect(r.evidence.some(s => s.startsWith("phase="))).toBe(true)
    expect(r.evidence.some(s => s.startsWith("calls="))).toBe(true)
  })
})

describe("parseArgs", () => {
  test("parses --input and --known-kinds", () => {
    const a = parseArgs(["--input", "run.json", "--known-kinds", "halluc-ungrounded,continuity-state"])
    expect(a.inputPath).toBe("run.json")
    expect(a.knownKinds?.has("halluc-ungrounded")).toBe(true)
    expect(a.knownKinds?.has("continuity-state")).toBe(true)
  })

  test("--input requires a value", () => {
    expect(() => parseArgs(["--input"])).toThrow()
    expect(() => parseArgs(["--input", "--json"])).toThrow()
  })

  test("--known-kinds requires a value", () => {
    expect(() => parseArgs(["--known-kinds"])).toThrow()
  })

  test("--json sets flag", () => {
    const a = parseArgs(["--input", "x.json", "--json"])
    expect(a.json).toBe(true)
  })
})
