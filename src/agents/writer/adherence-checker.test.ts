import { expect, test, mock, beforeEach } from "bun:test"

// ── Stage-gating mocks ──────────────────────────────────────────────────
//
// The two-stage adherence checker (2026-05-01, exp #317) requires that
// Stage 2 (per-event enumeration) only fires when Stage 1 returns
// `events_present: false`. Tests below assert that contract by spying on
// `callAgent` invocations: each call's system prompt identifies which
// stage was invoked.
//
// `callAgentResponses` is a queue of stubbed outputs; the mocked
// `callAgent` shifts one per call. `callAgentInvocations` records the
// system prompt of every call so tests can detect "stage 1 only" vs
// "stage 1 + stage 2".

let callAgentResponses: any[] = []
const callAgentInvocations: Array<{ systemPrompt: string }> = []

mock.module("../../llm", () => ({
  callAgent: async (config: any) => {
    callAgentInvocations.push({ systemPrompt: config.systemPrompt })
    if (callAgentResponses.length === 0) {
      throw new Error(`adherence-checker.test: callAgent invoked with no stubbed response (stage prompt: ${config.systemPrompt.slice(0, 60)}…)`)
    }
    const next = callAgentResponses.shift()
    if (next instanceof Error) throw next
    return { output: next, tokensUsed: { prompt: 0, completion: 0 } }
  },
}))

mock.module("../../trace", () => ({
  trace: async () => {},
}))

import { characterMentionedInProse, checkBeatAdherence, findMissingCharacterMentions } from "./adherence-checker"
import type { BeatObligationsContract, ChapterOutline, CharacterProfile, SceneBeat } from "../../types"

const emptyObligations: BeatObligationsContract = {
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
}

const STAGE1_PROMPT_PREFIX = "You verify whether the prose ENACTS the scene beat on-page."
const STAGE2_PROMPT_PREFIX = "You enumerate which obligated events from a beat description are missing from the prose."

beforeEach(() => {
  callAgentResponses = []
  callAgentInvocations.length = 0
})

test("character presence accepts possessive relationship labels with curly apostrophes", () => {
  expect(characterMentionedInProse(
    "Wren's grandmother",
    "Wren’s grandmother gripped the doorframe and whispered a prayer.",
  )).toBe(true)
})

test("character presence does not satisfy possessive relationship labels with owner only", () => {
  expect(characterMentionedInProse(
    "Wren's grandmother",
    "Wren gripped the doorframe and whispered a prayer.",
  )).toBe(false)
})

test("character presence ignores title words when checking titled names", () => {
  expect(characterMentionedInProse("Captain Wren", "The captain waited in the rain.")).toBe(false)
  expect(characterMentionedInProse("Captain Wren", "Wren waited in the rain.")).toBe(true)
})

test("deterministic character presence does not require spelling out the POV character", () => {
  const issues = findMissingCharacterMentions(
    "She walked toward the isolation room door. The handle was cold when she touched it.",
    beat({ characters: ["Istra Vellian"] }),
    outline({ povCharacter: "Istra Vellian" }),
  )

  expect(issues).not.toContain('Character "Istra Vellian" not found in prose')
})

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  // Cast: SceneBeat is z.infer<typeof sceneBeatSchema>, and obligations is
  // a Zod-inferred shape with `objectOutputType<...>` generics. TypeScript
  // sometimes treats two structurally-identical Zod-inferred types as
  // unrelated when the inference path differs (z.infer reaches the same
  // shape via slightly different generic instantiations). The runtime
  // shape is correct; the cast bypasses the nominal-identity check.
  return {
    description: "Istra walks toward the isolation room door.",
    characters: ["Istra Vellian"],
    kind: "action",
    requiredPayoffs: [],
    obligations: emptyObligations,
    ...overrides,
  } as SceneBeat
}

function outline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Test",
    povCharacter: "Istra Vellian",
    setting: "Clinic",
    purpose: "Test",
    scenes: [],
    targetWords: 1000,
    charactersPresent: ["Istra Vellian"],
    charactersPresentIds: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  }
}

// ── Two-stage gating tests (exp #317) ───────────────────────────────────

const PASS_PROSE = "Istra crossed the corridor and pushed open the isolation room door. The handle was cold under her palm."
const FAIL_PROSE = "Istra stood by the corridor window, watching the rain. She thought about the door but did not move."

test("two-stage: PASS path makes ONLY the binary stage-1 call (no stage 2)", async () => {
  // Stage 1 returns events_present=true → stage 2 must be skipped.
  callAgentResponses = [{ events_present: true, evidence: "pushed open the isolation room door", reasoning: "door action enacted" }]

  const result = await checkBeatAdherence(
    PASS_PROSE,
    beat({ description: "Istra opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(true)
  expect(result.issues).toEqual([])
  expect(callAgentInvocations).toHaveLength(1)
  expect(callAgentInvocations[0].systemPrompt.startsWith(STAGE1_PROMPT_PREFIX)).toBe(true)
})

test("two-stage: FAIL path fires stage 2 and returns per-event detail with quote evidence", async () => {
  // Stage 1 says fail; stage 2 enumerates two events, one missing one enacted.
  callAgentResponses = [
    { events_present: false, evidence: "stood by the corridor window", reasoning: "no door action on-page" },
    {
      obligated_events: [
        { event: "Istra opens the isolation room door", enacted: false, evidence_quote: "thought about the door but did not move" },
        { event: "Istra crosses the corridor", enacted: true, evidence_quote: "stood by the corridor window" },
      ],
      reasoning: "door open is missing; corridor crossing implied",
    },
  ]

  const result = await checkBeatAdherence(
    FAIL_PROSE,
    beat({ description: "Istra crosses the corridor and opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(false)
  expect(callAgentInvocations).toHaveLength(2)
  expect(callAgentInvocations[0].systemPrompt.startsWith(STAGE1_PROMPT_PREFIX)).toBe(true)
  expect(callAgentInvocations[1].systemPrompt.startsWith(STAGE2_PROMPT_PREFIX)).toBe(true)

  // Only the unenacted event surfaces in issues, with its quote.
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0]).toContain("Beat event missing: Istra opens the isolation room door")
  expect(result.issues[0]).toContain('thought about the door but did not move')
})

test("two-stage: stage 2 with no missing events falls back to generic stage-1 message (does not lose the verdict)", async () => {
  // Stage 1 says fail; stage 2 disagrees and reports all enacted. Per the
  // exp #305 calibration, stage 1's binary disposition was correct in
  // every disagreement on the labeled panel — preserve the blocker via
  // the generic fallback instead of dropping the issue.
  callAgentResponses = [
    { events_present: false, evidence: "no door action", reasoning: "door open never happens" },
    {
      obligated_events: [
        { event: "Istra opens the door", enacted: true, evidence_quote: "(disagreement)" },
      ],
      reasoning: "actually fine",
    },
  ]

  const result = await checkBeatAdherence(
    FAIL_PROSE,
    beat({ description: "Istra opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(false)
  expect(callAgentInvocations).toHaveLength(2)
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0]).toBe("Beat events not enacted on-page: door open never happens")
})

test("two-stage: stage 2 transport failure falls back to generic stage-1 message", async () => {
  callAgentResponses = [
    { events_present: false, evidence: "no door action", reasoning: "door open never happens" },
    new Error("simulated stage-2 transport failure"),
  ]

  const result = await checkBeatAdherence(
    FAIL_PROSE,
    beat({ description: "Istra opens the isolation room door." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(false)
  expect(callAgentInvocations).toHaveLength(2)
  expect(result.issues).toEqual(["Beat events not enacted on-page: door open never happens"])
})

test("two-stage: stage 2 emits one issue per missing event when multiple events are absent", async () => {
  callAgentResponses = [
    { events_present: false, evidence: "", reasoning: "two events missing" },
    {
      obligated_events: [
        { event: "Istra crosses the corridor", enacted: false, evidence_quote: "" },
        { event: "Istra opens the isolation room door", enacted: false, evidence_quote: "thought about the door" },
        { event: "Istra steps inside", enacted: true, evidence_quote: "stepped over the threshold" },
      ],
      reasoning: "two of three events missing",
    },
  ]

  const result = await checkBeatAdherence(
    FAIL_PROSE,
    beat({ description: "Istra crosses the corridor, opens the door, and steps inside." }),
    outline(),
    [] as CharacterProfile[],
  )

  expect(result.pass).toBe(false)
  expect(result.issues).toHaveLength(2)
  // Issue without quote evidence omits the closest-prose suffix.
  expect(result.issues[0]).toBe("Beat event missing: Istra crosses the corridor")
  // Issue with quote evidence includes the closest-prose suffix.
  expect(result.issues[1]).toContain("Beat event missing: Istra opens the isolation room door")
  expect(result.issues[1]).toContain('thought about the door')
})
